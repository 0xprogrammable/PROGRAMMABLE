import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";
import { CENTRAL_APPLICATION_FILES } from "./cli-central-package.mjs";
import { validateCompanionClosureReceipts } from "./companion-manifest-contract.mjs";
import {
  createGitHubPublicFetchTransportV1,
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError,
  parseBoundedLosslessJson,
  validateGitHubPublicSourceRequestV1
} from "./github-public-source-core.mjs";
import { CliFailure } from "./cli-runtime.mjs";
import { canonicalJson } from "./submission-core.mjs";

export const CENTRAL_GITHUB_TARGET = Object.freeze({
  owner: "0xprogrammable",
  repository: "programmable",
  repositorySlug: "0xprogrammable/programmable",
  repositoryUrl: "https://github.com/0xprogrammable/programmable"
});

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const APPLICATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const OPAQUE_DECIMAL_PATTERN = /^[1-9][0-9]{0,63}$/u;
const SAFE_BRANCH_PATTERN = /^(?!\/)(?!.*(?:\.\.|\/\/|@\{|\\|[\u0000-\u0020\u007f~^:?*\[]))[A-Za-z0-9._/-]{1,255}(?<![\/.])$/u;
const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const DEFAULT_ATTEMPTS = 3;
const MAX_REQUESTS = 24;
const MAX_COMMIT_RESPONSE_BYTES = 256 * 1024;
const MAX_TREE_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BLOB_RESPONSE_BYTES = 384 * 1024;
const MAX_APPLICATION_REVISION = 1_000_000;
const MAX_PACKAGE_BYTES = 512 * 1024;
const MAX_FILE_BYTES = Object.freeze({
  "application.json": 64 * 1024,
  "PROPOSAL.md": 64 * 1024,
  "TEST_PLAN.md": 64 * 1024,
  "THREAT_MODEL.md": 64 * 1024,
  "compatibility-report.json": 160 * 1024,
  "evidence-index.json": 160 * 1024
});
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function resolveCentralApplicationBase({
  baseBranch,
  applicationId,
  fetchImplementation = globalThis.fetch,
  sleepImplementation = sleep,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTimeoutMs
}) {
  validateInputs({ baseBranch, applicationId, fetchImplementation, sleepImplementation, attempts, timeoutMs });
  const state = createRequestState({ fetchImplementation, sleepImplementation, attempts, timeoutMs });
  const branch = await readCentralBranchHead(baseBranch, state);
  const applicationTree = await findApplicationTree({
    applicationId,
    rootTree: branch.tree,
    state
  });
  const prior = applicationTree === null
    ? null
    : await readPriorPackage({ applicationId, applicationTree, state });
  return Object.freeze({
    ...CENTRAL_GITHUB_TARGET,
    baseBranch,
    baseCommit: branch.commit,
    baseTree: branch.tree,
    applicationDirectory: `submissions/${applicationId}`,
    applicationPath: `submissions/${applicationId}/application.json`,
    existingApplication: prior !== null,
    priorApplicationRevision: prior?.application.applicationRevision ?? null,
    priorApplication: prior?.application ?? null,
    priorCentralPackage: prior?.centralPackage ?? null
  });
}

export async function assertCentralBaseUnchanged({
  observation,
  fetchImplementation = globalThis.fetch,
  sleepImplementation = sleep,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTimeoutMs
}) {
  if (
    observation === null
    || typeof observation !== "object"
    || observation.repositorySlug !== CENTRAL_GITHUB_TARGET.repositorySlug
    || !COMMIT_PATTERN.test(observation.baseCommit ?? "")
    || !COMMIT_PATTERN.test(observation.baseTree ?? "")
  ) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the central base observation is unavailable", { exitCode: 1 });
  }
  validateInputs({
    baseBranch: observation.baseBranch,
    applicationId: observation.applicationDirectory?.split("/").at(-1),
    fetchImplementation,
    sleepImplementation,
    attempts,
    timeoutMs
  });
  const state = createRequestState({ fetchImplementation, sleepImplementation, attempts, timeoutMs });
  const currentCommit = await readCentralBranchReference(observation.baseBranch, state);
  if (currentCommit !== observation.baseCommit) {
    throw new CliFailure(
      "CENTRAL_BASE_MOVED",
      "the central pull-request base moved while prepare-pr was building the package",
      { exitCode: 1 }
    );
  }
  return true;
}

export function deriveApplicationRevision({ applicationId, priorApplication, nextBuilder, nextSource }) {
  validateApplicationId(applicationId);
  const normalizedNextBuilder = normalizeBuilderAuthority(nextBuilder, "next application builder");
  const normalizedNext = normalizeSource(nextSource, "next application source");
  if (priorApplication === null) return 1;
  const prior = validatePriorApplicationManifest(priorApplication, applicationId);
  if (prior.applicationRevision >= MAX_APPLICATION_REVISION) {
    throw new CliFailure("APPLICATION_REVISION_EXHAUSTED", "the central application revision limit is exhausted", { exitCode: 1 });
  }
  if (prior.builder.githubUserId !== normalizedNextBuilder.githubUserId) {
    throw new CliFailure(
      "BUILDER_IDENTITY_CHANGED",
      "an application update cannot replace its immutable GitHub builder user id",
      { exitCode: 1 }
    );
  }
  if (prior.source.primary.numericRepositoryId !== normalizedNext.primary.numericRepositoryId) {
    throw new CliFailure(
      "PRIMARY_SOURCE_LINEAGE_CHANGED",
      "an application update cannot replace its primary numeric GitHub repository lineage",
      { exitCode: 1 }
    );
  }
  if (!hasMaterialSourceChange(prior.source, normalizedNext)) {
    throw new CliFailure(
      "SOURCE_REVISION_UNCHANGED",
      "an application update must change the primary or a companion source revision",
      { exitCode: 1 }
    );
  }
  return prior.applicationRevision + 1;
}

async function findApplicationTree({ applicationId, rootTree, state }) {
  let treeObjectId = rootTree;
  for (const segment of ["submissions", applicationId]) {
    const entries = await readTree(treeObjectId, state);
    const entry = entries.get(segment);
    if (entry === undefined) return null;
    if (entry.type !== "tree" || entry.mode !== "040000") {
      throw new CliFailure("CENTRAL_BASE_INVALID", "the central application path is not a canonical Git directory", { exitCode: 1 });
    }
    treeObjectId = entry.sha;
  }
  return treeObjectId;
}

async function readPriorPackage({ applicationId, applicationTree, state }) {
  const entries = await readTree(applicationTree, state);
  const observedNames = [...entries.keys()].sort(compareUtf8);
  const expectedNames = [...CENTRAL_APPLICATION_FILES].sort(compareUtf8);
  if (!arraysEqual(observedNames, expectedNames)) {
    throw new CliFailure(
      "CENTRAL_BASE_INVALID",
      "the observed central application directory is not the exact frozen six-file package",
      { exitCode: 1 }
    );
  }
  const files = new Map();
  let totalBytes = 0;
  for (const name of CENTRAL_APPLICATION_FILES) {
    const entry = entries.get(name);
    if (entry?.type !== "blob" || entry.mode !== "100644") {
      throw new CliFailure("CENTRAL_BASE_INVALID", "the central prior package contains a non-regular file", { exitCode: 1 });
    }
    const bytes = await readBlob(entry.sha, state);
    if (bytes.length < 1 || bytes.length > MAX_FILE_BYTES[name]) {
      throw new CliFailure("CENTRAL_BASE_INVALID", "a central prior file exceeds its frozen byte limit", { exitCode: 1 });
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new CliFailure("CENTRAL_BASE_INVALID", "the central prior package exceeds its frozen aggregate byte limit", { exitCode: 1 });
    }
    files.set(name, bytes);
  }
  return validateObservedPriorPackage({ applicationId, files });
}

function validateObservedPriorPackage({ applicationId, files }) {
  if (!(files instanceof Map) || !arraysEqual([...files.keys()], CENTRAL_APPLICATION_FILES)) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the central prior package is incomplete or unordered", { exitCode: 1 });
  }
  const applicationBytes = files.get("application.json");
  const application = parseCanonicalApplication(applicationBytes, applicationId);
  const reviewNames = CENTRAL_APPLICATION_FILES.slice(1);
  if (!Array.isArray(application.reviewPackage) || application.reviewPackage.length !== reviewNames.length) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the prior application review index is incomplete", { exitCode: 1 });
  }
  for (let index = 0; index < reviewNames.length; index += 1) {
    const name = reviewNames[index];
    const record = application.reviewPackage[index];
    const bytes = files.get(name);
    if (
      !isExactObject(record, ["byteLength", "path", "sha256"])
      || record.path !== name
      || !Number.isInteger(record.byteLength)
      || record.byteLength < 1
      || record.byteLength !== bytes.length
      || !DIGEST_PATTERN.test(record.sha256 ?? "")
      || record.sha256 !== digest(bytes)
    ) {
      throw new CliFailure("CENTRAL_BASE_INVALID", "the central prior review files do not match application.json", { exitCode: 1 });
    }
  }
  const records = CENTRAL_APPLICATION_FILES.map((name) => {
    const bytes = files.get(name);
    return {
      path: name,
      content: decodeUtf8(bytes, name),
      byteLength: bytes.length,
      sha256: digest(bytes)
    };
  });
  return {
    application,
    centralPackage: Object.freeze({
      targetDirectory: `submissions/${applicationId}`,
      stage: application.stage,
      applicationRevision: application.applicationRevision,
      fileCount: records.length,
      fileOrder: [...CENTRAL_APPLICATION_FILES],
      encoding: "utf8",
      generated: true,
      validatorContract: "public-pr-application-v2",
      files: records
    })
  };
}

function parseCanonicalApplication(bytes, applicationId) {
  const source = decodeUtf8(bytes, "application.json");
  const body = source.endsWith("\n") ? source.slice(0, -1) : source;
  if (CONTROL_OR_BIDI_PATTERN.test(body) || source.includes("\r")) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the prior application manifest contains unsafe text", { exitCode: 1 });
  }
  let application;
  try {
    application = JSON.parse(source);
  } catch {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the prior application manifest is not valid JSON", { exitCode: 1 });
  }
  if (source !== `${canonicalJson(application)}\n`) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the prior application manifest is not exact canonical JSON", { exitCode: 1 });
  }
  return validatePriorApplicationManifest(application, applicationId);
}

function validatePriorApplicationManifest(application, applicationId) {
  const applicationKeys = [
    "applicationId",
    "applicationRevision",
    "builder",
    ...(Object.hasOwn(application ?? {}, "companionClosure") ? ["companionClosure"] : []),
    "declarations",
    "programmableFee",
    "reviewPackage",
    "schemaVersion",
    "source",
    "stage",
    "summary",
    "title"
  ];
  if (
    !isExactObject(application, applicationKeys)
    || application.schemaVersion !== 2
    || application.applicationId !== applicationId
    || !Number.isInteger(application.applicationRevision)
    || application.applicationRevision < 1
    || application.applicationRevision > MAX_APPLICATION_REVISION
    || !new Set(["proposal", "prototype"]).has(application.stage)
  ) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the prior application manifest identity or revision is invalid", { exitCode: 1 });
  }
  const normalizedSource = normalizeSource(application.source, "prior application source");
  let companionClosure;
  if (Object.hasOwn(application, "companionClosure")) {
    try {
      companionClosure = validateCompanionClosureReceipts(application.companionClosure, normalizedSource);
    } catch {
      throw new CliFailure("CENTRAL_BASE_INVALID", "prior application companion closure receipts are invalid", { exitCode: 1 });
    }
    if (canonicalJson(companionClosure) !== canonicalJson(application.companionClosure)) {
      throw new CliFailure("CENTRAL_BASE_INVALID", "prior application companion closure receipts are not canonical", { exitCode: 1 });
    }
  }
  return {
    ...application,
    builder: normalizePriorBuilder(application.builder),
    source: normalizedSource,
    ...(companionClosure === undefined ? {} : { companionClosure })
  };
}

function normalizePriorBuilder(builder) {
  if (!isExactObject(builder, ["contact", "githubLogin", "githubUserId"])) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the prior application builder identity is invalid", { exitCode: 1 });
  }
  const authority = normalizeBuilderAuthority(builder, "prior application builder");
  if (builder.contact !== null) {
    let parsed;
    try {
      parsed = new URL(builder.contact);
    } catch {
      parsed = null;
    }
    if (
      parsed === null
      || builder.contact.length > 500
      || parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.hash !== ""
    ) {
      throw new CliFailure("CENTRAL_BASE_INVALID", "the prior application builder contact is invalid", { exitCode: 1 });
    }
  }
  return { ...authority, contact: builder.contact };
}

function normalizeBuilderAuthority(builder, label) {
  if (
    builder === null
    || typeof builder !== "object"
    || Array.isArray(builder)
    || !OPAQUE_DECIMAL_PATTERN.test(builder.githubUserId ?? "")
    || !GITHUB_LOGIN_PATTERN.test(builder.githubLogin ?? "")
  ) {
    throw new CliFailure("CENTRAL_BASE_INVALID", `${label} identity is not canonical`, { exitCode: 1 });
  }
  return {
    githubUserId: builder.githubUserId,
    githubLogin: builder.githubLogin
  };
}

function normalizeSource(source, label) {
  let normalized;
  try {
    normalized = validateGitHubPublicSourceRequestV1(source);
  } catch {
    throw new CliFailure("CENTRAL_BASE_INVALID", `${label} is not canonical GitHub public source data`, { exitCode: 1 });
  }
  if (canonicalJson(source) !== canonicalJson(normalized)) {
    throw new CliFailure("CENTRAL_BASE_INVALID", `${label} does not use canonical ordering and defaults`, { exitCode: 1 });
  }
  return normalized;
}

function sourceAuthority(source) {
  const project = (repository) => ({
    numericRepositoryId: repository.numericRepositoryId,
    revisionObjectId: repository.revisionObjectId,
    treeObjectId: repository.treeObjectId
  });
  return {
    primary: project(source.primary),
    companions: source.companions.map(project)
  };
}

function hasMaterialSourceChange(priorSource, nextSource) {
  const prior = sourceAuthority(priorSource);
  const next = sourceAuthority(nextSource);
  if (prior.primary.numericRepositoryId !== next.primary.numericRepositoryId) return true;
  const priorCompanionIds = prior.companions.map(({ numericRepositoryId }) => numericRepositoryId);
  const nextCompanionIds = next.companions.map(({ numericRepositoryId }) => numericRepositoryId);
  const companionLineageChanged = !arraysEqual(priorCompanionIds, nextCompanionIds);
  const pairs = [
    [prior.primary, next.primary],
    ...(companionLineageChanged
      ? []
      : prior.companions.map((value, index) => [value, next.companions[index]]))
  ];
  let changed = false;
  for (const [before, after] of pairs) {
    const commitChanged = before.revisionObjectId !== after.revisionObjectId;
    const treeChanged = before.treeObjectId !== after.treeObjectId;
    if (commitChanged !== treeChanged) {
      throw new CliFailure(
        "SOURCE_REVISION_INCOHERENT",
        "a changed source commit and root tree must move together",
        { exitCode: 1 }
      );
    }
    changed ||= commitChanged && treeChanged;
  }
  return companionLineageChanged || changed;
}

async function readCentralBranchHead(baseBranch, state) {
  const commit = await readCentralBranchReference(baseBranch, state);
  const response = await requestJson(
    `/repos/${CENTRAL_GITHUB_TARGET.owner}/${CENTRAL_GITHUB_TARGET.repository}/git/commits/${commit}`,
    MAX_COMMIT_RESPONSE_BYTES,
    state
  );
  const observedCommit = response?.sha;
  const observedTree = response?.tree?.sha;
  if (observedCommit !== commit || !COMMIT_PATTERN.test(observedTree ?? "")) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "GitHub returned an invalid central base commit identity", { exitCode: 1 });
  }
  return { commit, tree: observedTree };
}

async function readCentralBranchReference(baseBranch, state) {
  const encodedBranch = baseBranch.split("/").map(encodeURIComponent).join("/");
  const response = await requestJson(
    `/repos/${CENTRAL_GITHUB_TARGET.owner}/${CENTRAL_GITHUB_TARGET.repository}/git/ref/heads/${encodedBranch}`,
    MAX_COMMIT_RESPONSE_BYTES,
    state
  );
  const commit = response?.object?.sha;
  if (
    response?.ref !== `refs/heads/${baseBranch}`
    || response?.object?.type !== "commit"
    || !COMMIT_PATTERN.test(commit ?? "")
  ) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "GitHub returned an invalid fixed central branch reference", { exitCode: 1 });
  }
  return commit;
}

async function readTree(treeObjectId, state) {
  if (!COMMIT_PATTERN.test(treeObjectId ?? "")) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the central tree identity is invalid", { exitCode: 1 });
  }
  const response = await requestJson(
    `/repos/${CENTRAL_GITHUB_TARGET.owner}/${CENTRAL_GITHUB_TARGET.repository}/git/trees/${treeObjectId}`,
    MAX_TREE_RESPONSE_BYTES,
    state
  );
  if (response?.sha !== treeObjectId || response?.truncated !== false || !Array.isArray(response.tree)) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "GitHub returned an incomplete or mismatched central tree", { exitCode: 1 });
  }
  const entries = new Map();
  for (const entry of response.tree) {
    if (
      entry === null
      || typeof entry !== "object"
      || typeof entry.path !== "string"
      || entry.path.length < 1
      || entry.path.length > 255
      || entry.path.includes("/")
      || CONTROL_OR_BIDI_PATTERN.test(entry.path)
      || !new Set(["blob", "tree", "commit"]).has(entry.type)
      || !/^(?:040000|100644|100755|120000|160000)$/u.test(entry.mode ?? "")
      || !COMMIT_PATTERN.test(entry.sha ?? "")
      || entries.has(entry.path)
    ) {
      throw new CliFailure("CENTRAL_BASE_INVALID", "the central Git tree contains an unsafe or duplicate entry", { exitCode: 1 });
    }
    entries.set(entry.path, { path: entry.path, mode: entry.mode, type: entry.type, sha: entry.sha });
  }
  return entries;
}

async function readBlob(blobObjectId, state) {
  const response = await requestJson(
    `/repos/${CENTRAL_GITHUB_TARGET.owner}/${CENTRAL_GITHUB_TARGET.repository}/git/blobs/${blobObjectId}`,
    MAX_BLOB_RESPONSE_BYTES,
    state
  );
  if (response?.sha !== blobObjectId || response?.encoding !== "base64" || typeof response.content !== "string") {
    throw new CliFailure("CENTRAL_BASE_INVALID", "GitHub returned an invalid central file blob", { exitCode: 1 });
  }
  const compact = response.content.replace(/\n/gu, "");
  if (
    compact.length === 0
    || compact.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(compact)
  ) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "GitHub returned malformed base64 central file bytes", { exitCode: 1 });
  }
  const bytes = Buffer.from(compact, "base64");
  const gitIdentity = crypto
    .createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
  if (gitIdentity !== blobObjectId) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "central file bytes do not match their immutable Git blob identity", { exitCode: 1 });
  }
  return bytes;
}

async function requestJson(pathAndQuery, maximumBytes, state) {
  if (state.requests >= MAX_REQUESTS) {
    throw new CliFailure("CENTRAL_BASE_CHECK_FAILED", "the central GitHub read exceeded its fixed request budget", { exitCode: 1 });
  }
  state.requests += 1;
  const url = `${GITHUB_PUBLIC_SOURCE_CONTRACT_V1.apiOrigin}${pathAndQuery}`;
  let lastError;
  for (let attempt = 1; attempt <= state.attempts; attempt += 1) {
    const remainingMs = Math.floor(state.deadline - performance.now());
    if (remainingMs < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTimeoutMs) {
      throw new CliFailure("CENTRAL_BASE_CHECK_FAILED", "the central GitHub read exceeded its absolute timeout", { exitCode: 1 });
    }
    const controller = new AbortController();
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("central GitHub request timed out"));
      }, remainingMs);
    });
    try {
      const response = await Promise.race([
        state.transport({
          method: "GET",
          url,
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.userAgent,
            "X-GitHub-Api-Version": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion
          },
          redirect: "error",
          signal: controller.signal,
          maxResponseBytes: maximumBytes
        }),
        timeoutPromise
      ]);
      if (response.status === 404) {
        throw new CliFailure("CENTRAL_BASE_UNAVAILABLE", "the fixed central base branch or immutable object is unavailable", { exitCode: 1 });
      }
      if ([403, 429].includes(response.status) || response.status >= 500) {
        lastError = new Error(`transient GitHub status ${response.status}`);
      } else if (response.status < 200 || response.status >= 300) {
        throw new CliFailure("CENTRAL_BASE_CHECK_FAILED", "GitHub rejected the fixed central read", { exitCode: 1 });
      } else {
        try {
          const parsed = parseBoundedLosslessJson(decoder.decode(response.body));
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
          return parsed;
        } catch {
          throw new CliFailure("CENTRAL_BASE_INVALID", "GitHub returned invalid or ambiguous central JSON", { exitCode: 1 });
        }
      }
    } catch (error) {
      if (error instanceof CliFailure) throw error;
      if (error instanceof GitHubPublicSourceError && error.retryable !== true) {
        throw new CliFailure("CENTRAL_BASE_CHECK_FAILED", "the fixed central GitHub transport rejected the response", {
          exitCode: 1,
          details: { reason: error.code }
        });
      }
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < state.attempts) await state.sleepImplementation(250 * (2 ** (attempt - 1)));
  }
  throw new CliFailure("CENTRAL_BASE_CHECK_FAILED", "the bounded central GitHub read failed", {
    exitCode: 1,
    details: { reason: lastError instanceof GitHubPublicSourceError ? lastError.code : "unavailable" }
  });
}

function createRequestState({ fetchImplementation, sleepImplementation, attempts, timeoutMs }) {
  return {
    attempts,
    deadline: performance.now() + timeoutMs,
    requests: 0,
    sleepImplementation,
    transport: createGitHubPublicFetchTransportV1(fetchImplementation)
  };
}

function validateInputs({ baseBranch, applicationId, fetchImplementation, sleepImplementation, attempts, timeoutMs }) {
  if (
    typeof baseBranch !== "string"
    || !SAFE_BRANCH_PATTERN.test(baseBranch)
    || baseBranch.endsWith(".lock")
    || baseBranch.startsWith("refs/")
    || typeof fetchImplementation !== "function"
    || typeof sleepImplementation !== "function"
    || !Number.isInteger(attempts)
    || attempts < 1
    || attempts > 5
    || !Number.isInteger(timeoutMs)
    || timeoutMs < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTimeoutMs
    || timeoutMs > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs
  ) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "central GitHub resolver options are invalid", { exitCode: 1 });
  }
  validateApplicationId(applicationId);
}

function validateApplicationId(applicationId) {
  if (typeof applicationId !== "string" || applicationId.length > 80 || !APPLICATION_ID_PATTERN.test(applicationId)) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "central application id is not canonical", { exitCode: 1 });
  }
}

function decodeUtf8(bytes, name) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new CliFailure("CENTRAL_BASE_INVALID", `${name} is not valid UTF-8`, { exitCode: 1 });
  }
}

function isExactObject(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && arraysEqual(Object.keys(value).sort(compareUtf8), [...keys].sort(compareUtf8));
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
