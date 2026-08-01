import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  createGitHubPublicFetchTransportV1,
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError,
  isCanonicalGitHubRepositoryPathV1,
  resolveGitHubPublicSourceV1,
  validateGitHubPublicSourceRequestV1
} from "../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import {
  createAnonymousGitHubExactObjectResolverV1,
  GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1
} from "../skills/programmable-v4-hook-builder/scripts/github-exact-object-resolver.mjs";
import { findUnsupportedPublicClaims } from "../skills/programmable-v4-hook-builder/scripts/public-claims-core.mjs";

export const VALIDATOR_VERSION = "1.6.0";
export const PUBLIC_APPLICATION_SCHEMA_ID = "https://programmable.money/schemas/public-pr-application-v1.json";
export const PUBLIC_BETA_DISCLAIMER =
  "Builder-declared compatibility evidence; not an audit, approval, deployment, Uniswap endorsement, or launch.";
export const PUBLIC_INTAKE_STATES = Object.freeze(["prelaunch", "open", "paused-new", "paused-all"]);
export const MAXIMUM_MAINTAINED_LEGACY_PACKAGES = 32;
export const MAINTAINED_LEGACY_PACKAGE_TIMEOUT_MS = 120_000;

const APPLICATION_FILE = "application.json";
const INTAKE_STATUS_PATH = "docs/builder/intake-status.json";
const MAXIMUM_INTAKE_STATUS_BYTES = 32 * 1024;
const MAXIMUM_CONTINUING_PULL_REQUESTS = 32;
const MAXIMUM_CONTINUATION_COMPANIONS = 8;
const APPLICATION_FILES = Object.freeze([
  APPLICATION_FILE,
  "PROPOSAL.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "compatibility-report.json",
  "evidence-index.json"
]);
export const PUBLIC_APPLICATION_FILES = APPLICATION_FILES;
export const GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1 = Object.freeze({
  maximumProviderRequests: 60,
  maximumSourceRequests: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.anonymousRestRequests,
  maximumTransportRetries: 12,
  minimumIntervalMs: 125,
  maximumRetryDelayMs: 1_000,
  timeoutMs: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs
});
const maximumAnonymousSchedulingDelayMs =
  ((GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumProviderRequests - 1)
    * GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.minimumIntervalMs)
  + (GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumTransportRetries
    * GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumRetryDelayMs);
if (
  GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumSourceRequests
    + GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumTransportRetries
    > GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumProviderRequests
  || maximumAnonymousSchedulingDelayMs >= GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.timeoutMs
) {
  throw new Error("trusted anonymous GitHub request, pacing, retry, and timeout budgets are inconsistent");
}
const GITHUB_PUBLIC_TRANSPORT_DEFAULTS = Object.freeze({
  maximumRetryBodyBytes: 16 * 1024,
  maximumRetryDelayMs: GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumRetryDelayMs,
  minimumIntervalMs: GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.minimumIntervalMs,
  transientRetryDelayMs: 250
});
const REVIEW_FILES = Object.freeze([
  "PROPOSAL.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "compatibility-report.json",
  "evidence-index.json"
]);
const BUILDER_MAINTENANCE_PREFIXES = Object.freeze([
  "docs/builder/",
  "evals/",
  "plugins/marketplace/",
  "scripts/evals/",
  "scripts/test/schema-validator/",
  "skills/programmable-v4-hook-builder/"
]);
const BUILDER_MAINTENANCE_FILES = new Set([
  ".github/CODEOWNERS",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/verify-hook-builder.yml",
  ".github/workflows/verify.yml",
  "BUILDER_PROGRAM.md",
  "CONTRIBUTING.md",
  "README.md",
  "SUPPORT.md",
  "docs/README.md",
  "scripts/check-documentation-links.mjs",
  "scripts/test/check-documentation-links.test.mjs",
  "scripts/verify-public-hook-application-core.mjs",
  "scripts/verify-public-hook-application.mjs",
  "submissions/README.md",
  "skills/README.md"
]);
const SHARED_BUILDER_DOCUMENTATION_FILES = new Set([
  "README.md",
  "SUPPORT.md",
  "docs/README.md",
  "scripts/check-documentation-links.mjs",
  "scripts/test/check-documentation-links.test.mjs"
]);
const APPLICATION_PATH_PATTERN = /^submissions\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([^/]+)$/;
const SHA1_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPAQUE_ID_PATTERN = /^[1-9][0-9]{0,63}$/;
const SAFE_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const APPLICATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVIDENCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FINDING_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const TRUSTED_GIT_TIMEOUT_MS = 30_000;
const CANDIDATE_PREFLIGHT_API_RESPONSE_BYTES = 4 * 1024 * 1024;
const CANDIDATE_PREFLIGHT_FILES_PER_PAGE = 100;
const HYDRATION_API_RESPONSE_BYTES = 1 * 1024 * 1024;
const HYDRATION_ADDITIONAL_REPOSITORY_BYTES = 4 * 1024 * 1024;
const HYDRATION_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const HYDRATION_OUTPUT_BYTES = 64 * 1024;
const HYDRATION_POLL_MS = 25;
const HYDRATION_KILL_GRACE_MS = 250;
const HYDRATION_MAXIMUM_ENTRIES = 65_536;
const CANDIDATE_GIT_ADDRESS_SPACE_BYTES = 512 * 1024 * 1024;
const CANDIDATE_GIT_CPU_SECONDS = 20;
const CANDIDATE_FETCH_FILE_SIZE_BYTES = 32 * 1024 * 1024;
const CANDIDATE_FETCH_REPOSITORY_BYTES = 64 * 1024 * 1024;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const PULL_REQUEST_NUMBER_PATTERN = /^[1-9][0-9]{0,19}$/u;

const DEFAULT_LIMITS = Object.freeze({
  maximumChangedFiles: 256,
  maximumGitEntries: 200_000,
  maximumGitTreeBytes: 64 * 1024 * 1024,
  maximumFindings: 128,
  maximumEvidence: 128,
  maximumEvidenceBlobBytes: 8 * 1024 * 1024,
  maximumEvidenceResolutionBytes: 32 * 1024 * 1024,
  maximumEvidenceRequests: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.anonymousRestRequests,
  maximumEvidenceTreeEntries: 200_000,
  maximumJsonDepth: 16,
  maximumJsonNodes: 20_000,
  maximumPackageBytes: 512 * 1024,
  maximumFileBytes: Object.freeze({
    "application.json": 64 * 1024,
    "compatibility-report.json": 160 * 1024,
    "evidence-index.json": 160 * 1024,
    "PROPOSAL.md": 64 * 1024,
    "THREAT_MODEL.md": 64 * 1024,
    "TEST_PLAN.md": 64 * 1024
  }),
});

export class PublicIntakeError extends Error {
  constructor(code, message, { kind = "candidate" } = {}) {
    super(message);
    this.name = "PublicIntakeError";
    this.code = code;
    this.kind = kind;
  }
}

function reject(code, message) {
  throw new PublicIntakeError(code, message, { kind: "candidate" });
}

function systemBlocked(code, message) {
  throw new PublicIntakeError(code, message, { kind: "system" });
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, sortJson(value[key])]));
}

export function classifyPublicIntakePullRequest({
  baseRoot,
  candidateRoot,
  expectedBaseCommit,
  expectedCandidateCommit,
  expectedMergeCommit,
  limits: limitOverrides = {}
}) {
  const limits = mergeLimits(limitOverrides);
  const comparison = compareGitRevisions({
    baseRoot,
    candidateRoot,
    expectedBaseCommit,
    expectedCandidateCommit,
    expectedMergeCommit,
    limits
  });
  const { changes } = comparison;

  if (changes.length === 0) return { mode: "no-op", ...comparison };

  const submissionChanges = changes.filter((change) => change.path.startsWith("submissions/"));
  const applicationDirectoryChanges = submissionChanges.filter((change) => change.path !== "submissions/README.md");
  if (applicationDirectoryChanges.length > 0) {
    rejectUnsafeChangedEntries(changes);
    if (changes.every((change) => isAllowlistedApplicationPath(change.path))) {
      return { mode: "application", ...comparison };
    }
    reject(
      "CHANGED_PATH_NOT_ALLOWED",
      "A pull request that touches submissions/ must contain only one closed six-file public application package."
    );
  }

  const maintenanceChanges = changes.filter((change) => (
    isBuilderMaintenancePath(change.path)
    && !SHARED_BUILDER_DOCUMENTATION_FILES.has(change.path)
  ));
  if (maintenanceChanges.length === 0) return { mode: "no-op", ...comparison };

  rejectUnsafeChangedEntries(changes);
  if (changes.every((change) => isBuilderMaintenancePath(change.path))) {
    return { mode: "builder-maintenance", ...comparison };
  }

  reject(
    "CHANGED_PATH_NOT_ALLOWED",
    "A builder-maintenance pull request may change only first-party builder infrastructure and documentation."
  );
}

/**
 * Read the intake switch from the trusted base revision before any candidate
 * Git objects are fetched. Closed states inspect only bounded GitHub PR
 * metadata so maintenance and legacy PRs can continue without letting an
 * application consume Git pack/decompression capacity.
 */
export async function preflightPublicApplicationCandidateFetch({
  baseRoot,
  expectedBaseCommit,
  expectedCandidateCommit,
  expectedMergeCommit,
  repository,
  pullRequestNumber,
  readToken,
  limits: limitOverrides = {}
}, dependencies = {}) {
  validateHydrationAuthority({ repository, readToken });
  validateCandidateFetchIdentity({
    pullRequestNumber,
    expectedBaseCommit,
    expectedCandidateCommit,
    expectedMergeCommit
  });
  const limits = mergeLimits(limitOverrides);
  const base = inspectGitRevision(baseRoot, expectedBaseCommit, limits);
  const intakeStatus = readTrustedIntakeStatus(base);
  if (intakeStatus.state === "open") {
    return {
      schemaVersion: 1,
      result: "candidate-fetch-allowed",
      intakeState: intakeStatus.state,
      modeHint: "unclassified"
    };
  }

  const changedFiles = await resolveCentralPullRequestChangedFiles({
    repository,
    pullRequestNumber,
    expectedBaseCommit,
    expectedCandidateCommit,
    expectedMergeCommit,
    readToken,
    maximumChangedFiles: limits.maximumChangedFiles,
    fetchImplementation: dependencies.fetchImplementation ?? globalThis.fetch,
    timeoutMs: dependencies.timeoutMs ?? TRUSTED_GIT_TIMEOUT_MS
  });
  const changedPaths = [];
  for (const file of changedFiles) {
    changedPaths.push(file.path);
    if (file.previousPath !== null) changedPaths.push(file.previousPath);
  }
  const uniquePaths = [...new Set(changedPaths)].sort(compareUtf8);
  const applicationPaths = uniquePaths.filter(
    (entryPath) => entryPath.startsWith("submissions/") && entryPath !== "submissions/README.md"
  );
  if (applicationPaths.length === 0) {
    return {
      schemaVersion: 1,
      result: "candidate-fetch-allowed",
      intakeState: intakeStatus.state,
      modeHint: "non-application"
    };
  }

  if (intakeStatus.state === "prelaunch" || intakeStatus.state === "paused-all") {
    enforceTrustedIntakeStatus({ intakeStatus, isUpdate: false, pullRequestNumber, applicationId: null });
  }

  const applicationIds = new Set();
  for (const entryPath of applicationPaths) {
    const match = APPLICATION_PATH_PATTERN.exec(entryPath);
    if (!match || !APPLICATION_FILES.includes(match[2])) {
      reject(
        "CHANGED_PATH_NOT_ALLOWED",
        "A paused-new pull request may fetch candidate data only for one existing closed application package."
      );
    }
    applicationIds.add(match[1]);
  }
  if (
    applicationIds.size !== 1
    || uniquePaths.some((entryPath) => !isAllowlistedApplicationPath(entryPath))
    || changedFiles.some((file) => file.status === "removed" && applicationPaths.includes(file.path))
  ) {
    reject(
      "CHANGED_PATH_NOT_ALLOWED",
      "A paused-new pull request may fetch candidate data only for one existing closed application package."
    );
  }
  const [applicationId] = applicationIds;
  const isUpdate = classifyTrustedBaseApplication(base, applicationId);
  const continuation = enforceTrustedIntakeStatus({
    intakeStatus,
    isUpdate,
    pullRequestNumber,
    applicationId
  });
  if (!isUpdate) assertNewApplicationChangedFileSet({ changedFiles, applicationId });
  return {
    schemaVersion: 1,
    result: "candidate-fetch-allowed",
    intakeState: intakeStatus.state,
    modeHint: isUpdate ? "application-update" : "application-continuation",
    pullRequestNumber,
    continuationAuthorized: continuation !== null
  };
}

/**
 * Fetch the base repository's exact PR merge ref into a newly-created bare,
 * blobless object store under hard per-file and aggregate storage bounds.
 */
export async function fetchPublicApplicationCandidate({
  baseRoot,
  candidateRoot,
  repository,
  pullRequestNumber,
  expectedBaseCommit,
  expectedCandidateCommit,
  expectedMergeCommit,
  readToken
}, dependencies = {}) {
  validateHydrationAuthority({ repository, readToken });
  validateCandidateFetchIdentity({ pullRequestNumber, expectedBaseCommit, expectedCandidateCommit, expectedMergeCommit });
  await preflightPublicApplicationCandidateFetch({
    baseRoot,
    expectedBaseCommit,
    expectedCandidateCommit,
    expectedMergeCommit,
    repository,
    pullRequestNumber,
    readToken
  }, {
    fetchImplementation: dependencies.fetchImplementation,
    timeoutMs: dependencies.metadataTimeoutMs
  });
  const gitDirectory = validateNewCandidateDirectory(candidateRoot);
  const remoteUrl = dependencies.remoteUrlForTests ?? `https://github.com/${repository}.git`;
  if (typeof remoteUrl !== "string" || remoteUrl.length < 1 || /[\u0000\r\n]/u.test(remoteUrl)) {
    systemBlocked("CANDIDATE_FETCH_REMOTE_INVALID", "The central candidate remote is malformed.");
  }
  const gitExecutable = dependencies.gitExecutable ?? "git";
  let complete = false;
  try {
    const init = childProcess.spawnSync(
      gitExecutable,
      [
        "-c", "init.templateDir=",
        "-c", "core.hooksPath=/dev/null",
        "init", "--quiet", "--bare", "--object-format=sha1", gitDirectory
      ],
      {
        encoding: "utf8",
        shell: false,
        timeout: TRUSTED_GIT_TIMEOUT_MS,
        killSignal: "SIGKILL",
        env: trustedGitEnvironment()
      }
    );
    if (init.status !== 0) {
      systemBlocked("CANDIDATE_FETCH_INIT_FAILED", "The bounded candidate object store could not be initialized.");
    }
    writeCandidateGitConfig(gitDirectory, remoteUrl, readToken);

    const runFetch = dependencies.runFetch ?? runBoundedHydrationGitProcess;
    const result = await runFetch({
      gitExecutable,
      gitDirectory,
      args: [
        "fetch",
        "--force",
        "--no-tags",
        "--no-write-fetch-head",
        "--no-recurse-submodules",
        "--depth=1",
        "--filter=blob:none",
        "origin",
        `+refs/pull/${pullRequestNumber}/merge:refs/heads/candidate-merge`
      ],
      timeoutMs: dependencies.fetchTimeoutMs ?? TRUSTED_GIT_TIMEOUT_MS,
      maximumOutputBytes: HYDRATION_OUTPUT_BYTES,
      maximumFileSizeBytes: dependencies.maximumFileSizeBytes ?? CANDIDATE_FETCH_FILE_SIZE_BYTES,
      maximumRepositoryBytes: dependencies.maximumRepositoryBytes ?? CANDIDATE_FETCH_REPOSITORY_BYTES,
      maximumAddressSpaceBytes: dependencies.maximumAddressSpaceBytes ?? CANDIDATE_GIT_ADDRESS_SPACE_BYTES,
      maximumCpuSeconds: dependencies.maximumCpuSeconds ?? CANDIDATE_GIT_CPU_SECONDS,
      allowFileProtocol: dependencies.allowFileProtocolForTests === true
    });
    if (
      !isBoundedGitProcessResult(result)
      || result.timedOut
      || result.outputExceeded
      || result.repositoryBytesExceeded
      || result.fileSizeExceeded
      || result.addressSpaceExceeded
      || result.cpuExceeded
      || result.status !== 0
    ) {
      systemBlocked("CANDIDATE_FETCH_BOUNDED_FAILURE", "The exact blobless PR merge exceeded trusted fetch bounds or was unavailable.");
    }
    runGit(gitDirectory, ["symbolic-ref", "HEAD", "refs/heads/candidate-merge"], 1024);
    const observedMergeCommit = runGitText(gitDirectory, ["rev-parse", "HEAD^{commit}"], 128).trim();
    if (observedMergeCommit !== expectedMergeCommit) {
      systemBlocked("CANDIDATE_FETCH_ID_MISMATCH", "The base-repository PR merge ref moved after the workflow event.");
    }
    complete = true;
    return {
      schemaVersion: 1,
      result: "exact-blobless-candidate-fetched",
      mergeCommit: observedMergeCommit
    };
  } finally {
    if (!complete && fs.lstatSync(gitDirectory, { throwIfNoEntry: false }) !== undefined) {
      removeCandidateDirectory(gitDirectory);
    }
  }
}

/**
 * Hydrate only the already-classified six-file application package. GitHub's
 * exact tree metadata is checked before any candidate blob is requested, and
 * the bounded Git process is prevented from lazily fetching anything else.
 */
export async function hydratePublicApplicationCandidate({
  baseRoot,
  candidateRoot,
  expectedBaseCommit,
  expectedCandidateCommit,
  expectedMergeCommit,
  pullRequestNumber,
  repository,
  readToken,
  limits: limitOverrides = {}
}, dependencies = {}) {
  const limits = mergeLimits(limitOverrides);
  validateHydrationAuthority({ repository, readToken });
  validateCandidateFetchIdentity({
    pullRequestNumber,
    expectedBaseCommit,
    expectedCandidateCommit,
    expectedMergeCommit
  });
  const classified = classifyPublicIntakePullRequest({
    baseRoot,
    candidateRoot,
    expectedBaseCommit,
    expectedCandidateCommit,
    expectedMergeCommit,
    limits
  });
  const plan = planApplicationHydration(classified, limits);
  const intakeStatus = readTrustedIntakeStatus(classified.base);
  const isUpdate = classifyTrustedBaseApplication(classified.base, plan.applicationId);
  const continuation = enforceTrustedIntakeStatus({
    intakeStatus,
    isUpdate,
    pullRequestNumber,
    applicationId: plan.applicationId
  });
  const gitDirectory = path.resolve(candidateRoot ?? "");
  requireHydrationRemote(
    gitDirectory,
    dependencies.remoteUrlForTests ?? `https://github.com/${repository}.git`
  );
  const packageTreeObjectId = readPackageTreeObjectId(gitDirectory, plan.packageDirectory);
  const metadata = await resolveCandidateTreeMetadata({
    repository,
    readToken,
    packageTreeObjectId,
    fetchImplementation: dependencies.fetchImplementation ?? globalThis.fetch,
    timeoutMs: dependencies.metadataTimeoutMs ?? TRUSTED_GIT_TIMEOUT_MS
  });
  const boundedMetadata = enforceHydrationMetadata(plan, metadata, limits);

  const baselineBytes = measureHydrationDirectory(gitDirectory);
  const maximumAdditionalRepositoryBytes = dependencies.maximumAdditionalRepositoryBytes
    ?? HYDRATION_ADDITIONAL_REPOSITORY_BYTES;
  const maximumFileSizeBytes = dependencies.maximumFileSizeBytes ?? HYDRATION_FILE_SIZE_BYTES;
  validateHydrationProcessLimits(maximumAdditionalRepositoryBytes, maximumFileSizeBytes);
  if (baselineBytes > Number.MAX_SAFE_INTEGER - maximumAdditionalRepositoryBytes) {
    systemBlocked("HYDRATION_STORAGE_INVALID", "Candidate object-store size could not be bounded safely.");
  }

  const sparsePath = path.join(gitDirectory, "info", "sparse-checkout");
  const sparseBytes = Buffer.from(`${plan.entries.map((entry) => `/${entry.path}`).join("\n")}\n`, "utf8");
  let operationFailed = false;
  try {
    fs.mkdirSync(path.dirname(sparsePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(sparsePath, sparseBytes, { mode: 0o600, flag: "w" });
    runHydrationConfig(gitDirectory, ["core.sparseCheckout", "true"]);
    runHydrationConfig(gitDirectory, ["core.sparseCheckoutCone", "false"]);
    const result = await runBoundedHydrationGitProcess({
      gitExecutable: dependencies.gitExecutable ?? "git",
      gitDirectory,
      args: ["backfill", "--sparse"],
      timeoutMs: dependencies.backfillTimeoutMs ?? TRUSTED_GIT_TIMEOUT_MS,
      maximumOutputBytes: HYDRATION_OUTPUT_BYTES,
      maximumFileSizeBytes,
      maximumRepositoryBytes: baselineBytes + maximumAdditionalRepositoryBytes,
      maximumAddressSpaceBytes: CANDIDATE_GIT_ADDRESS_SPACE_BYTES,
      maximumCpuSeconds: CANDIDATE_GIT_CPU_SECONDS,
      allowFileProtocol: dependencies.allowFileProtocolForTests === true
    });
    if (result.timedOut) {
      systemBlocked("HYDRATION_TIMEOUT", "Bounded candidate blob hydration exceeded its trusted timeout.");
    }
    if (
      result.outputExceeded
      || result.repositoryBytesExceeded
      || result.fileSizeExceeded
      || result.addressSpaceExceeded
      || result.cpuExceeded
      || result.status !== 0
    ) {
      systemBlocked("HYDRATION_BOUNDED_FETCH_FAILED", "Git could not hydrate the bounded application blobs within trusted resource limits.");
    }
    verifyHydratedObjects(gitDirectory, plan, boundedMetadata, limits);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      fs.rmSync(sparsePath, { force: true });
      runHydrationConfig(gitDirectory, ["--unset", "core.sparseCheckout"], { allowMissing: true });
      runHydrationConfig(gitDirectory, ["--unset", "core.sparseCheckoutCone"], { allowMissing: true });
    } catch (cleanupError) {
      if (!operationFailed) {
        systemBlocked("HYDRATION_CLEANUP_FAILED", "Trusted sparse hydration state could not be removed.");
      }
    }
  }

  const applicationEntry = plan.entries.find((entry) => path.posix.basename(entry.path) === APPLICATION_FILE);
  const applicationBytes = readGitBlob(
    path.resolve(candidateRoot ?? ""),
    applicationEntry,
    limits.maximumFileBytes[APPLICATION_FILE]
  );
  const application = parseCanonicalJson(applicationBytes, APPLICATION_FILE, limits);
  validateApplicationManifest(application, plan.applicationId, limits);
  enforceTrustedContinuationIdentity({ continuation, application });

  return {
    schemaVersion: 1,
    result: "bounded-application-blobs-hydrated",
    intakeState: intakeStatus.state,
    applicationId: plan.applicationId,
    pullRequestNumber,
    continuationAuthorized: continuation !== null,
    fileCount: plan.entries.length,
    totalBytes: boundedMetadata.totalBytes
  };
}

function validateHydrationAuthority({ repository, readToken }) {
  if (typeof repository !== "string" || !GITHUB_REPOSITORY_PATTERN.test(repository) || repository.length > 202) {
    systemBlocked("HYDRATION_REPOSITORY_INVALID", "The central GitHub repository identity is malformed.");
  }
  if (
    typeof readToken !== "string"
    || readToken.length < 1
    || readToken.length > 4096
    || /[\u0000-\u001f\u007f-\u009f]/u.test(readToken)
  ) {
    systemBlocked("HYDRATION_CREDENTIAL_INVALID", "The central read credential is missing or malformed.");
  }
}

function validateCandidateFetchIdentity({
  pullRequestNumber,
  expectedBaseCommit,
  expectedCandidateCommit,
  expectedMergeCommit
}) {
  if (typeof pullRequestNumber !== "string" || !PULL_REQUEST_NUMBER_PATTERN.test(pullRequestNumber)) {
    systemBlocked("CANDIDATE_FETCH_ID_INVALID", "The pull-request number is missing or malformed.");
  }
  for (const [label, objectId] of [
    ["base", expectedBaseCommit],
    ["head", expectedCandidateCommit],
    ["merge", expectedMergeCommit]
  ]) {
    if (!SHA1_PATTERN.test(objectId ?? "")) {
      systemBlocked("CANDIDATE_FETCH_ID_INVALID", `The expected pull-request ${label} commit is missing or malformed.`);
    }
  }
}

async function resolveCentralPullRequestChangedFiles({
  repository,
  pullRequestNumber,
  expectedBaseCommit,
  expectedCandidateCommit,
  expectedMergeCommit,
  readToken,
  maximumChangedFiles,
  fetchImplementation,
  timeoutMs
}) {
  if (typeof fetchImplementation !== "function") {
    systemBlocked("CANDIDATE_PREFLIGHT_UNAVAILABLE", "The trusted GitHub pull-request metadata transport is unavailable.");
  }
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > TRUSTED_GIT_TIMEOUT_MS
    || !Number.isInteger(maximumChangedFiles)
    || maximumChangedFiles < 1
    || maximumChangedFiles > 1_000
  ) {
    systemBlocked("CANDIDATE_PREFLIGHT_INVALID", "The trusted pull-request metadata limits are invalid.");
  }
  const apiOrigin = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.apiOrigin;
  const deadline = performance.now() + timeoutMs;
  const pullRequestUrl = `${apiOrigin}/repos/${repository}/pulls/${pullRequestNumber}`;
  const pullRequest = await requestCentralCandidateJson({
    url: pullRequestUrl,
    readToken,
    fetchImplementation,
    deadline
  });
  if (
    !isPlainObject(pullRequest)
    || String(pullRequest.number) !== pullRequestNumber
    || pullRequest.state !== "open"
    || pullRequest.base?.sha !== expectedBaseCommit
    || pullRequest.head?.sha !== expectedCandidateCommit
    || pullRequest.merge_commit_sha !== expectedMergeCommit
    || typeof pullRequest.base?.repo?.full_name !== "string"
    || pullRequest.base.repo.full_name.toLowerCase() !== repository.toLowerCase()
    || !Number.isInteger(pullRequest.changed_files)
    || pullRequest.changed_files < 0
  ) {
    systemBlocked("CANDIDATE_PREFLIGHT_ID_MISMATCH", "GitHub pull-request metadata did not match the immutable workflow event.");
  }
  if (pullRequest.changed_files > maximumChangedFiles) {
    reject("TOO_MANY_CHANGED_FILES", "The pull request exceeds the trusted changed-file limit before candidate fetch.");
  }

  const records = [];
  const pages = Math.ceil(pullRequest.changed_files / CANDIDATE_PREFLIGHT_FILES_PER_PAGE);
  for (let page = 1; page <= pages; page += 1) {
    const url = `${pullRequestUrl}/files?per_page=${CANDIDATE_PREFLIGHT_FILES_PER_PAGE}&page=${page}`;
    const document = await requestCentralCandidateJson({
      url,
      readToken,
      fetchImplementation,
      deadline
    });
    const expectedRecords = Math.min(
      CANDIDATE_PREFLIGHT_FILES_PER_PAGE,
      pullRequest.changed_files - records.length
    );
    if (!Array.isArray(document) || document.length !== expectedRecords) {
      systemBlocked("CANDIDATE_PREFLIGHT_INVALID", "GitHub returned an incomplete bounded pull-request file list.");
    }
    records.push(...document);
  }
  if (records.length !== pullRequest.changed_files) {
    systemBlocked("CANDIDATE_PREFLIGHT_INVALID", "GitHub pull-request file metadata did not match its declared count.");
  }

  const supportedStatuses = new Set(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]);
  const observedPaths = new Set();
  return records.map((record) => {
    if (
      !isPlainObject(record)
      || typeof record.filename !== "string"
      || !supportedStatuses.has(record.status)
      || (record.status === "renamed") !== (typeof record.previous_filename === "string")
    ) {
      systemBlocked("CANDIDATE_PREFLIGHT_INVALID", "GitHub returned malformed pull-request file metadata.");
    }
    validateGitPath(record.filename);
    if (observedPaths.has(record.filename)) {
      systemBlocked("CANDIDATE_PREFLIGHT_INVALID", "GitHub returned a duplicate pull-request path.");
    }
    observedPaths.add(record.filename);
    let previousPath = null;
    if (record.status === "renamed") {
      validateGitPath(record.previous_filename);
      previousPath = record.previous_filename;
    }
    return { path: record.filename, previousPath, status: record.status };
  });
}

async function requestCentralCandidateJson({ url, readToken, fetchImplementation, deadline }) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining < 1) {
    systemBlocked("CANDIDATE_PREFLIGHT_TIMEOUT", "Trusted pull-request metadata resolution exceeded its total deadline.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remaining);
  timeout.unref?.();
  let response;
  try {
    response = await fetchImplementation(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${readToken}`,
        "User-Agent": "programmable-public-intake-prefetch-v1",
        "X-GitHub-Api-Version": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion
      }
    });
  } catch {
    systemBlocked("CANDIDATE_PREFLIGHT_UNAVAILABLE", "GitHub pull-request metadata was unavailable before candidate fetch.");
  } finally {
    clearTimeout(timeout);
  }
  if (
    !response
    || response.status !== 200
    || response.redirected === true
    || (typeof response.url === "string" && response.url !== "" && response.url !== url)
  ) {
    systemBlocked("CANDIDATE_PREFLIGHT_UNAVAILABLE", "GitHub did not return exact same-origin pull-request metadata.");
  }
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined) {
    if (
      !/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)
      || Number(declaredLength) > CANDIDATE_PREFLIGHT_API_RESPONSE_BYTES
    ) {
      systemBlocked("CANDIDATE_PREFLIGHT_TOO_LARGE", "GitHub pull-request metadata exceeded its trusted response bound.");
    }
  }
  const bytes = await readBoundedHydrationResponse(response, CANDIDATE_PREFLIGHT_API_RESPONSE_BYTES);
  try {
    return JSON.parse(UTF8_DECODER.decode(bytes));
  } catch {
    systemBlocked("CANDIDATE_PREFLIGHT_INVALID", "GitHub pull-request metadata was not valid bounded UTF-8 JSON.");
  }
}

function validateNewCandidateDirectory(candidateRoot) {
  if (typeof candidateRoot !== "string" || candidateRoot.length < 1 || /[\u0000\r\n]/u.test(candidateRoot)) {
    systemBlocked("CANDIDATE_FETCH_PATH_INVALID", "The candidate object-store path is malformed.");
  }
  const resolved = path.resolve(candidateRoot);
  const parent = path.dirname(resolved);
  if (
    path.basename(resolved) !== "candidate.git"
    || !fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()
    || fs.lstatSync(resolved, { throwIfNoEntry: false }) !== undefined
  ) {
    systemBlocked("CANDIDATE_FETCH_PATH_INVALID", "The candidate object store must be a new candidate.git directory.");
  }
  return resolved;
}

function writeCandidateGitConfig(gitDirectory, remoteUrl, readToken) {
  const basicAuth = Buffer.from(`x-access-token:${readToken}`, "utf8").toString("base64");
  const config = [
    "[core]",
    "\trepositoryformatversion = 0",
    "\tfilemode = true",
    "\tbare = true",
    "\thooksPath = /dev/null",
    "\tattributesFile = /dev/null",
    "[protocol]",
    "\tallow = never",
    "\tversion = 2",
    "[protocol \"https\"]",
    "\tallow = always",
    "[http]",
    "\tfollowRedirects = false",
    "[http \"https://github.com/\"]",
    `\textraheader = AUTHORIZATION: basic ${basicAuth}`,
    "[fetch]",
    "\trecurseSubmodules = false",
    "\tfsckObjects = true",
    "[transfer]",
    "\tfsckObjects = true",
    "[maintenance]",
    "\tauto = false",
    "[gc]",
    "\tauto = 0",
    "[remote \"origin\"]",
    `\turl = ${remoteUrl}`,
    "\tpromisor = true",
    "\tpartialclonefilter = blob:none",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(gitDirectory, "config"), config, { encoding: "utf8", mode: 0o600, flag: "w" });
}

function isBoundedGitProcessResult(value) {
  return isPlainObject(value)
    && Number.isInteger(value.status)
    && typeof value.timedOut === "boolean"
    && typeof value.outputExceeded === "boolean"
    && typeof value.repositoryBytesExceeded === "boolean"
    && typeof value.fileSizeExceeded === "boolean"
    && typeof value.addressSpaceExceeded === "boolean"
    && typeof value.cpuExceeded === "boolean";
}

function removeCandidateDirectory(gitDirectory) {
  const resolved = path.resolve(gitDirectory);
  if (path.basename(resolved) !== "candidate.git" || path.dirname(resolved) === resolved) {
    systemBlocked("CANDIDATE_FETCH_CLEANUP_FAILED", "The failed candidate object-store cleanup target changed identity.");
  }
  try {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  } catch {
    systemBlocked("CANDIDATE_FETCH_CLEANUP_FAILED", "The failed candidate object store and its credential could not be removed.");
  }
}

function planApplicationHydration(classified, limits) {
  if (classified.mode !== "application") {
    reject("APPLICATION_CHANGE_REQUIRED", "Only a closed public application package may hydrate candidate blobs.");
  }
  const applicationIds = new Set();
  for (const change of classified.changes) {
    if (change.status === "deleted") {
      reject("APPLICATION_FILE_DELETED", "Public application files cannot be deleted through the intake workflow.");
    }
    const match = APPLICATION_PATH_PATTERN.exec(change.path);
    if (!match) reject("APPLICATION_PATH_INVALID", "An application path is outside the closed package layout.");
    applicationIds.add(match[1]);
  }
  if (applicationIds.size !== 1) {
    reject("APPLICATION_COUNT_INVALID", "A public application pull request must add or update exactly one application id.");
  }
  const [applicationId] = applicationIds;
  const packageDirectory = `submissions/${applicationId}`;
  const packagePrefix = `${packageDirectory}/`;
  const entries = [...classified.candidate.entries.values()]
    .filter((entry) => entry.path.startsWith(packagePrefix))
    .sort((left, right) => compareUtf8(left.path, right.path));
  const expectedPaths = APPLICATION_FILES.map((fileName) => `${packagePrefix}${fileName}`).sort(compareUtf8);
  if (!arraysEqual(entries.map((entry) => entry.path), expectedPaths)) {
    reject(
      "APPLICATION_PACKAGE_NOT_CLOSED",
      "The application directory must contain exactly the six allowlisted manifest and review-package files."
    );
  }
  for (const entry of entries) {
    assertRegularBlob(entry);
    const maximumBytes = limits.maximumFileBytes[path.posix.basename(entry.path)];
    if (!Number.isInteger(maximumBytes)) {
      systemBlocked("FILE_LIMIT_MISSING", "The trusted validator has no size policy for an allowlisted package file.");
    }
  }
  return { applicationId, packageDirectory, entries };
}

function readPackageTreeObjectId(gitDirectory, packageDirectory) {
  const objectId = runGitText(
    gitDirectory,
    ["rev-parse", "--verify", `HEAD:${packageDirectory}`],
    128
  ).trim();
  if (!SHA1_PATTERN.test(objectId)) {
    systemBlocked("HYDRATION_TREE_INVALID", "The closed application directory did not resolve to an exact Git tree.");
  }
  const objectType = runGitText(gitDirectory, ["cat-file", "-t", objectId], 32).trim();
  if (objectType !== "tree") {
    systemBlocked("HYDRATION_TREE_INVALID", "The closed application directory was not a Git tree.");
  }
  return objectId;
}

function requireHydrationRemote(gitDirectory, expectedRemoteUrl) {
  if (typeof expectedRemoteUrl !== "string" || expectedRemoteUrl.length < 1 || /[\u0000\r\n]/u.test(expectedRemoteUrl)) {
    systemBlocked("HYDRATION_REMOTE_INVALID", "The trusted candidate remote identity is malformed.");
  }
  const remoteNames = runGitText(gitDirectory, ["remote"], 1024).trim().split("\n").filter(Boolean);
  const observedRemoteUrl = runGitText(
    gitDirectory,
    ["config", "--local", "--get", "remote.origin.url"],
    4096
  ).trim();
  if (remoteNames.length !== 1 || remoteNames[0] !== "origin" || observedRemoteUrl !== expectedRemoteUrl) {
    systemBlocked("HYDRATION_REMOTE_INVALID", "The candidate object store is not bound to the central GitHub repository.");
  }
}

async function resolveCandidateTreeMetadata({
  repository,
  readToken,
  packageTreeObjectId,
  fetchImplementation,
  timeoutMs
}) {
  if (typeof fetchImplementation !== "function") {
    systemBlocked("HYDRATION_METADATA_UNAVAILABLE", "The trusted GitHub metadata transport is unavailable.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TRUSTED_GIT_TIMEOUT_MS) {
    systemBlocked("HYDRATION_TIMEOUT_INVALID", "The trusted metadata timeout is outside its closed bound.");
  }
  const requestUrl = `https://api.github.com/repos/${repository}/git/trees/${packageTreeObjectId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  let response;
  try {
    response = await fetchImplementation(requestUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${readToken}`,
        "User-Agent": "programmable-public-intake-hydrator-v1",
        "X-GitHub-Api-Version": "2026-03-10"
      }
    });
  } catch {
    systemBlocked("HYDRATION_METADATA_UNAVAILABLE", "GitHub tree-size metadata was unavailable before candidate hydration.");
  } finally {
    clearTimeout(timeout);
  }
  if (
    !response
    || response.status !== 200
    || response.redirected === true
    || (typeof response.url === "string" && response.url !== "" && response.url !== requestUrl)
  ) {
    systemBlocked("HYDRATION_METADATA_UNAVAILABLE", "GitHub did not return exact same-origin tree-size metadata.");
  }
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > HYDRATION_API_RESPONSE_BYTES) {
      systemBlocked("HYDRATION_METADATA_TOO_LARGE", "GitHub tree-size metadata exceeded its trusted response bound.");
    }
  }
  const bytes = await readBoundedHydrationResponse(response, HYDRATION_API_RESPONSE_BYTES);
  let parsed;
  try {
    parsed = JSON.parse(UTF8_DECODER.decode(bytes));
  } catch {
    systemBlocked("HYDRATION_METADATA_INVALID", "GitHub tree-size metadata was not valid bounded UTF-8 JSON.");
  }
  return { requestUrl, packageTreeObjectId, parsed };
}

async function readBoundedHydrationResponse(response, maximumBytes) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = Buffer.from(value);
        total += bytes.length;
        if (total > maximumBytes) {
          await reader.cancel().catch(() => {});
          systemBlocked("HYDRATION_METADATA_TOO_LARGE", "GitHub tree-size metadata exceeded its trusted response bound.");
        }
        chunks.push(bytes);
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks, total);
  }
  if (typeof response.arrayBuffer !== "function") {
    systemBlocked("HYDRATION_METADATA_INVALID", "GitHub tree-size metadata had no readable response body.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximumBytes) {
    systemBlocked("HYDRATION_METADATA_TOO_LARGE", "GitHub tree-size metadata exceeded its trusted response bound.");
  }
  return bytes;
}

function enforceHydrationMetadata(plan, metadata, limits) {
  const document = metadata.parsed;
  if (
    !isPlainObject(document)
    || document.sha !== metadata.packageTreeObjectId
    || document.truncated !== false
    || !Array.isArray(document.tree)
    || document.tree.length !== plan.entries.length
  ) {
    systemBlocked("HYDRATION_METADATA_INVALID", "GitHub tree-size metadata did not match the exact closed package tree.");
  }
  const expected = new Map(plan.entries.map((entry) => [path.posix.basename(entry.path), entry]));
  const observed = new Set();
  let totalBytes = 0;
  for (const record of document.tree) {
    if (!isPlainObject(record) || typeof record.path !== "string" || observed.has(record.path)) {
      systemBlocked("HYDRATION_METADATA_INVALID", "GitHub tree-size metadata contained an invalid or duplicate entry.");
    }
    observed.add(record.path);
    const entry = expected.get(record.path);
    if (
      !entry
      || record.mode !== entry.mode
      || record.type !== entry.type
      || record.sha !== entry.oid
      || !Number.isSafeInteger(record.size)
      || record.size < 0
    ) {
      systemBlocked("HYDRATION_METADATA_MISMATCH", "GitHub tree-size metadata did not match the fetched exact Git tree.");
    }
    const maximumBytes = limits.maximumFileBytes[record.path];
    if (record.size > maximumBytes) {
      reject("APPLICATION_FILE_TOO_LARGE", "An application package file exceeds its trusted byte limit before hydration.");
    }
    totalBytes += record.size;
    if (totalBytes > limits.maximumPackageBytes) {
      reject("APPLICATION_PACKAGE_TOO_LARGE", "The application review package exceeds its trusted byte limit before hydration.");
    }
  }
  return {
    entries: new Map(document.tree.map((record) => [record.sha, { path: record.path, size: record.size }])),
    totalBytes
  };
}

function validateHydrationProcessLimits(maximumAdditionalRepositoryBytes, maximumFileSizeBytes) {
  for (const [label, value, maximum] of [
    ["additional repository", maximumAdditionalRepositoryBytes, HYDRATION_ADDITIONAL_REPOSITORY_BYTES],
    ["file size", maximumFileSizeBytes, HYDRATION_FILE_SIZE_BYTES]
  ]) {
    if (!Number.isInteger(value) || value < 512 || value > maximum) {
      systemBlocked("HYDRATION_LIMIT_INVALID", `The trusted ${label} hydration limit is invalid.`);
    }
  }
}

function runHydrationConfig(gitDirectory, configArgs, { allowMissing = false } = {}) {
  const result = childProcess.spawnSync(
    "git",
    [
      "-c", "credential.helper=",
      "-c", "core.hooksPath=/dev/null",
      "-C", gitDirectory,
      "config", "--local",
      ...configArgs
    ],
    {
      encoding: "utf8",
      shell: false,
      timeout: TRUSTED_GIT_TIMEOUT_MS,
      killSignal: "SIGKILL",
      env: trustedGitEnvironment()
    }
  );
  if (result.status === 0 || (allowMissing && result.status === 5)) return;
  systemBlocked("HYDRATION_CONFIG_FAILED", "Trusted sparse hydration configuration failed.");
}

function verifyHydratedObjects(gitDirectory, plan, metadata, limits) {
  let totalBytes = 0;
  for (const entry of plan.entries) {
    const type = runGitText(gitDirectory, ["cat-file", "-t", entry.oid], 32).trim();
    const sizeText = runGitText(gitDirectory, ["cat-file", "-s", entry.oid], 128).trim();
    if (type !== "blob" || !/^(?:0|[1-9][0-9]*)$/u.test(sizeText)) {
      systemBlocked("HYDRATION_OBJECT_INVALID", "A bounded application blob was unavailable after sparse hydration.");
    }
    const size = Number(sizeText);
    const expected = metadata.entries.get(entry.oid);
    if (!Number.isSafeInteger(size) || expected?.size !== size || size > limits.maximumFileBytes[expected.path]) {
      systemBlocked("HYDRATION_OBJECT_MISMATCH", "A hydrated blob did not match preflighted GitHub size metadata.");
    }
    totalBytes += size;
  }
  if (totalBytes !== metadata.totalBytes || totalBytes > limits.maximumPackageBytes) {
    systemBlocked("HYDRATION_OBJECT_MISMATCH", "Hydrated application bytes did not match the bounded package metadata.");
  }
}

export async function runBoundedHydrationGitProcess({
  gitExecutable = "git",
  gitDirectory,
  args,
  timeoutMs,
  maximumOutputBytes,
  maximumFileSizeBytes,
  maximumRepositoryBytes,
  maximumAddressSpaceBytes = CANDIDATE_GIT_ADDRESS_SPACE_BYTES,
  maximumCpuSeconds = CANDIDATE_GIT_CPU_SECONDS,
  allowFileProtocol = false
}) {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    systemBlocked("HYDRATION_PLATFORM_UNSUPPORTED", "Bounded Git hydration supports macOS and Linux only.");
  }
  const safeArgs = [
    "-c", "credential.helper=",
    "-c", "credential.interactive=never",
    "-c", "core.hooksPath=/dev/null",
    "-c", "core.attributesFile=/dev/null",
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-c", "protocol.allow=never",
    "-c", "protocol.version=2",
    "-c", "protocol.https.allow=always",
    "-c", `protocol.file.allow=${allowFileProtocol ? "always" : "never"}`,
    "-c", "protocol.ext.allow=never",
    "-c", "protocol.ssh.allow=never",
    "-c", "http.followRedirects=false",
    "-c", "submodule.recurse=false",
    "-c", "fetch.recurseSubmodules=false",
    "-c", "fetch.fsckObjects=true",
    "-c", "transfer.fsckObjects=true",
    "-c", "core.deltaBaseCacheLimit=16m",
    "-c", "core.packedGitWindowSize=16m",
    "-c", "core.packedGitLimit=64m",
    "-c", "pack.deltaCacheLimit=16m",
    "-c", "pack.windowMemory=32m",
    "-c", "pack.threads=1",
    "-c", "index.threads=1",
    "-c", "maintenance.auto=false",
    "-c", "gc.auto=0",
    "-C", gitDirectory,
    ...args
  ];
  // Bash defines ulimit -f in 1024-byte increments on the supported runners.
  const fileLimitBlocks = Math.floor(maximumFileSizeBytes / 1024);
  const addressSpaceLimitKilobytes = process.platform === "linux"
    ? Math.floor(maximumAddressSpaceBytes / 1024)
    : 0;
  if (
    typeof gitExecutable !== "string"
    || gitExecutable.length < 1
    || /[\u0000\r\n]/u.test(gitExecutable)
    || !Array.isArray(args)
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > TRUSTED_GIT_TIMEOUT_MS
    || !Number.isInteger(maximumOutputBytes)
    || maximumOutputBytes < 1
    || !Number.isInteger(maximumRepositoryBytes)
    || maximumRepositoryBytes < 1
    || !Number.isInteger(maximumAddressSpaceBytes)
    || maximumAddressSpaceBytes < 64 * 1024 * 1024
    || maximumAddressSpaceBytes > CANDIDATE_GIT_ADDRESS_SPACE_BYTES
    || !Number.isInteger(maximumCpuSeconds)
    || maximumCpuSeconds < 1
    || maximumCpuSeconds > CANDIDATE_GIT_CPU_SECONDS
    || fileLimitBlocks < 1
  ) {
    systemBlocked("HYDRATION_PROCESS_INVALID", "Bounded Git hydration received invalid trusted process options.");
  }
  return new Promise((resolve, rejectPromise) => {
    // GitHub's production runner is Linux: RLIMIT_AS bounds decompression and
    // delta resolution even when a tiny pack expands far beyond its disk size.
    // Darwin does not implement a settable RLIMIT_AS, so local macOS tests keep
    // the file/CPU/repository/output/wall-clock limits while Linux adds RLIMIT_AS.
    const launcher = [
      'ulimit -f "$1" || exit 125',
      'ulimit -t "$2" || exit 125',
      'if [[ "$3" != "0" ]]; then ulimit -v "$3" || exit 125; fi',
      'shift 3',
      'exec "$@"'
    ].join("; ");
    let child;
    try {
      child = childProcess.spawn(
        "/bin/bash",
        [
          "--noprofile", "--norc", "-c", launcher, "bounded-git",
          String(fileLimitBlocks),
          String(maximumCpuSeconds),
          String(addressSpaceLimitKilobytes),
          gitExecutable,
          ...safeArgs
        ],
        {
          detached: true,
          env: hydrationGitEnvironment(),
          shell: false,
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
    } catch (error) {
      rejectPromise(error);
      return;
    }

    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let outputExceeded = false;
    let repositoryBytesExceeded = false;
    let timedOut = false;
    let terminated = false;
    let settled = false;
    let forceKillTimer = null;

    const killGroup = (signal) => {
      if (!Number.isInteger(child.pid)) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error?.code !== "ESRCH") child.kill(signal);
      }
    };
    const terminate = () => {
      if (terminated) return;
      terminated = true;
      killGroup("SIGTERM");
      forceKillTimer = setTimeout(() => killGroup("SIGKILL"), HYDRATION_KILL_GRACE_MS);
      forceKillTimer.unref?.();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeout.unref?.();
    const sizePoll = setInterval(() => {
      if (settled || repositoryBytesExceeded) return;
      try {
        if (measureHydrationDirectory(gitDirectory) > maximumRepositoryBytes) {
          repositoryBytesExceeded = true;
          terminate();
        }
      } catch {
        repositoryBytesExceeded = true;
        terminate();
      }
    }, HYDRATION_POLL_MS);
    sizePoll.unref?.();

    const collect = (target) => (chunk) => {
      if (outputExceeded) return;
      const bytes = Buffer.from(chunk);
      outputBytes += bytes.length;
      if (outputBytes > maximumOutputBytes) {
        outputExceeded = true;
        terminate();
        return;
      }
      target.push(bytes);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(sizePoll);
      killGroup("SIGKILL");
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      rejectPromise(error);
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(sizePoll);
      // A successful leader must not be allowed to leave a detached helper
      // alive after the bounded operation has finished.
      killGroup("SIGKILL");
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      try {
        if (measureHydrationDirectory(gitDirectory) > maximumRepositoryBytes) repositoryBytesExceeded = true;
      } catch {
        repositoryBytesExceeded = true;
      }
      const stderrBytes = Buffer.concat(stderr);
      const stderrText = stderrBytes.toString("utf8");
      resolve({
        status: Number.isInteger(status) ? status : 1,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: stderrBytes,
        timedOut,
        outputExceeded,
        repositoryBytesExceeded,
        fileSizeExceeded: signal === "SIGXFSZ"
          || status === 153
          || /File size limit exceeded/iu.test(stderrText),
        addressSpaceExceeded: /(?:out of memory|cannot allocate memory|memory exhausted|failed to allocate memory)/iu.test(stderrText),
        cpuExceeded: signal === "SIGXCPU" || status === 152
      });
    });
  });
}

function hydrationGitEnvironment() {
  const environment = Object.create(null);
  for (const name of ["PATH", "TMPDIR", "TMP", "TEMP"]) {
    if (typeof process.env[name] === "string") environment[name] = process.env[name];
  }
  environment.LANG = "C";
  environment.LC_ALL = "C";
  environment.LC_CTYPE = "C";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_LFS_SKIP_SMUDGE = "1";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_LITERAL_PATHSPECS = "1";
  environment.GIT_PROTOCOL_FROM_USER = "0";
  environment.GIT_PAGER = "cat";
  environment.GCM_INTERACTIVE = "Never";
  return environment;
}

function measureHydrationDirectory(directory) {
  const root = path.resolve(directory ?? "");
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    systemBlocked("HYDRATION_STORAGE_INVALID", "The candidate object store is missing.");
  }
  const pending = [root];
  let entries = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > HYDRATION_MAXIMUM_ENTRIES) {
        systemBlocked("HYDRATION_STORAGE_INVALID", "The candidate object store exceeds its trusted entry bound.");
      }
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else {
        const status = fs.lstatSync(entryPath);
        if (status.isFile() || status.isSymbolicLink()) totalBytes += status.size;
      }
      if (!Number.isSafeInteger(totalBytes)) {
        systemBlocked("HYDRATION_STORAGE_INVALID", "The candidate object-store size could not be represented safely.");
      }
    }
  }
  return totalBytes;
}

export async function verifyPublicHookApplication({
  baseRoot,
  candidateRoot,
  expectedBaseCommit,
  pullRequestNumber,
  expectedBuilderLogin,
  expectedBuilderUserId,
  expectedCandidateCommit,
  expectedMergeCommit,
  resolveSource,
  resolveEvidence,
  limits: limitOverrides = {}
}) {
  const limits = mergeLimits(limitOverrides);
  validateCandidateFetchIdentity({
    pullRequestNumber,
    expectedBaseCommit,
    expectedCandidateCommit,
    expectedMergeCommit
  });
  const classified = classifyPublicIntakePullRequest({
    baseRoot,
    candidateRoot,
    expectedBaseCommit,
    expectedCandidateCommit,
    expectedMergeCommit,
    limits
  });
  if (classified.mode !== "application") {
    reject("APPLICATION_CHANGE_REQUIRED", "This validator accepts exactly one closed public application package.");
  }

  const changedApplicationIds = new Set();
  for (const change of classified.changes) {
    if (change.status === "deleted") {
      reject("APPLICATION_FILE_DELETED", "Public application files cannot be deleted through the intake workflow.");
    }
    const match = APPLICATION_PATH_PATTERN.exec(change.path);
    if (!match) reject("APPLICATION_PATH_INVALID", "An application path is outside the closed package layout.");
    changedApplicationIds.add(match[1]);
  }
  if (changedApplicationIds.size !== 1) {
    reject("APPLICATION_COUNT_INVALID", "A public application pull request must add or update exactly one application id.");
  }
  const [applicationId] = changedApplicationIds;
  const packagePrefix = `submissions/${applicationId}/`;
  const isUpdate = classifyTrustedBaseApplication(classified.base, applicationId);
  const intakeStatus = readTrustedIntakeStatus(classified.base);
  const continuation = enforceTrustedIntakeStatus({
    intakeStatus,
    isUpdate,
    pullRequestNumber,
    applicationId
  });

  if (resolveSource !== undefined && typeof resolveSource !== "function") {
    systemBlocked("RESOLVER_UNAVAILABLE", "The trusted public-source resolver is unavailable.");
  }
  if (resolveEvidence !== undefined && typeof resolveEvidence !== "function") {
    systemBlocked("EVIDENCE_RESOLVER_UNAVAILABLE", "The trusted public-evidence resolver is unavailable.");
  }
  const normalizedBuilderLogin = normalizeExpectedBuilderLogin(expectedBuilderLogin);
  const normalizedBuilderUserId = normalizeExpectedBuilderUserId(expectedBuilderUserId);
  const candidatePackageEntries = [...classified.candidate.entries.values()]
    .filter((entry) => entry.path.startsWith(packagePrefix))
    .sort((left, right) => compareUtf8(left.path, right.path));
  const expectedPaths = APPLICATION_FILES.map((fileName) => `${packagePrefix}${fileName}`).sort(compareUtf8);
  const observedPaths = candidatePackageEntries.map((entry) => entry.path);
  if (!arraysEqual(observedPaths, expectedPaths)) {
    reject(
      "APPLICATION_PACKAGE_NOT_CLOSED",
      "The application directory must contain exactly the six allowlisted manifest and review-package files."
    );
  }
  for (const entry of candidatePackageEntries) assertRegularBlob(entry);

  const packageFiles = new Map();
  let packageBytes = 0;
  for (const entry of candidatePackageEntries) {
    const fileName = path.posix.basename(entry.path);
    const maximumBytes = limits.maximumFileBytes[fileName];
    if (!Number.isInteger(maximumBytes)) {
      systemBlocked("FILE_LIMIT_MISSING", "The trusted validator has no size policy for an allowlisted package file.");
    }
    const bytes = readGitBlob(classified.candidate.root, entry, maximumBytes);
    packageFiles.set(fileName, bytes);
    packageBytes += bytes.length;
  }
  if (packageBytes > limits.maximumPackageBytes) {
    reject("APPLICATION_PACKAGE_TOO_LARGE", "The application review package exceeds the trusted byte limit.");
  }

  const { application, compatibility, evidenceIndex } = validatePublicApplicationPackageFiles({
    applicationId,
    packageFiles,
    limits
  });
  enforceTrustedContinuationIdentity({ continuation, application });
  // This authenticated event value proves who opened the central pull request.
  // It does not prove that the author owns any declared public source repository.
  if (application.builder.githubUserId !== normalizedBuilderUserId) {
    reject(
      "BUILDER_ID_PR_AUTHOR_MISMATCH",
      "application.builder.githubUserId must equal the authenticated author id of this pull request."
    );
  }
  if (application.builder.githubLogin.toLowerCase() !== normalizedBuilderLogin) {
    reject(
      "BUILDER_LOGIN_PR_AUTHOR_MISMATCH",
      "application.builder.githubLogin must identify the authenticated author of this pull request."
    );
  }
  validateRevisionChange({ application, applicationId, packagePrefix, classified, limits });

  const blobEvidence = evidenceIndex.evidence.filter((record) =>
    validateGitHubEvidenceUrl(record.url, "evidence.url", application.source.primary) === "blob"
  );
  if (resolveSource === undefined && resolveEvidence === undefined) {
    const session = createTrustedPublicApplicationResolutionSessionV1({
      primary: application.source.primary,
      evidence: blobEvidence
    });
    resolveSource = session.resolveSource;
    resolveEvidence = session.resolveEvidence;
  } else {
    resolveSource ??= resolvePublicGitHubSource;
    resolveEvidence ??= resolvePublicApplicationEvidence;
  }

  let sourceObservation;
  try {
    sourceObservation = await resolveSource(application.source);
  } catch (error) {
    translateSourceResolutionError(error);
  }
  validateSourceObservation(application.source, sourceObservation);

  let blobObservations = [];
  if (blobEvidence.length > 0) {
    try {
      blobObservations = await resolveEvidence({
        primary: application.source.primary,
        evidence: blobEvidence,
        limits
      });
    } catch (error) {
      translateEvidenceResolutionError(error);
    }
  }
  const evidenceBindings = validateEvidenceObservations({
    application,
    compatibility,
    evidenceIndex,
    sourceObservation,
    blobObservations
  });

  return {
    schemaVersion: 1,
    validatorVersion: VALIDATOR_VERSION,
    result: "valid-public-application-package",
    mode: "application",
    intakeState: intakeStatus.state,
    applicationId,
    applicationRevision: application.applicationRevision,
    pullRequestNumber,
    continuationAuthorized: continuation !== null,
    builderIdentity: {
      authentication: "github-pull-request-author",
      immutableGitHubUserId: normalizedBuilderUserId,
      authenticatedLogin: expectedBuilderLogin,
      manifestLogin: application.builder.githubLogin,
      normalizedLogin: normalizedBuilderLogin,
      provesSourceRepositoryOwnership: false
    },
    baseCommit: classified.base.commit,
    candidateCommit: classified.candidate.commit,
    mergeCommit: classified.candidate.mergeCommit,
    sourceBinding: sourceAuthorityProjection(application.source),
    evidenceBindings
  };
}

function readTrustedIntakeStatus(base) {
  const entry = base.entries.get(INTAKE_STATUS_PATH);
  if (!entry) {
    systemBlocked(
      "INTAKE_STATUS_MISSING",
      `The trusted base revision does not contain ${INTAKE_STATUS_PATH}.`
    );
  }
  if (entry.mode !== "100644" || entry.type !== "blob" || !SHA1_PATTERN.test(entry.oid)) {
    systemBlocked(
      "INTAKE_STATUS_INVALID",
      `The trusted base revision's ${INTAKE_STATUS_PATH} must be a non-executable regular Git blob.`
    );
  }

  const declaredSizeText = runGitText(base.root, ["cat-file", "-s", entry.oid], 128).trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(declaredSizeText)) {
    systemBlocked("INTAKE_STATUS_INVALID", "Git returned an invalid trusted intake-status size.");
  }
  const declaredSize = Number(declaredSizeText);
  if (!Number.isSafeInteger(declaredSize) || declaredSize > MAXIMUM_INTAKE_STATUS_BYTES) {
    systemBlocked("INTAKE_STATUS_INVALID", "The trusted intake-status file exceeds its closed byte limit.");
  }
  const bytes = runGit(base.root, ["cat-file", "blob", entry.oid], MAXIMUM_INTAKE_STATUS_BYTES + 1);
  if (bytes.length !== declaredSize) {
    systemBlocked("INTAKE_STATUS_INVALID", "Trusted intake-status bytes do not match their declared Git blob size.");
  }

  let source;
  try {
    source = UTF8_DECODER.decode(bytes);
  } catch {
    systemBlocked("INTAKE_STATUS_INVALID", "The trusted intake-status file is not valid UTF-8.");
  }
  if (CONTROL_OR_BIDI_PATTERN.test(source) || source.includes("\r")) {
    systemBlocked("INTAKE_STATUS_INVALID", "The trusted intake-status file contains unsupported text controls.");
  }

  let status;
  try {
    status = JSON.parse(source);
  } catch {
    systemBlocked("INTAKE_STATUS_INVALID", "The trusted intake-status file is not valid JSON.");
  }
  if (
    !isPlainObject(status)
    || !arraysEqual(
      Object.keys(status).sort(compareUtf8),
      ["continuingPullRequests", "schemaVersion", "state"]
    )
    || status.schemaVersion !== 2
    || !PUBLIC_INTAKE_STATES.includes(status.state)
    || !Array.isArray(status.continuingPullRequests)
    || status.continuingPullRequests.length > MAXIMUM_CONTINUING_PULL_REQUESTS
    || source !== `${canonicalJson(status)}\n`
  ) {
    systemBlocked(
      "INTAKE_STATUS_INVALID",
      "The trusted intake-status file must be closed canonical JSON with schemaVersion 2, a supported state, and a bounded continuation list."
    );
  }
  const continuingPullRequests = validateTrustedContinuations(status.continuingPullRequests);
  if (status.state !== "paused-new" && continuingPullRequests.length !== 0) {
    systemBlocked(
      "INTAKE_STATUS_INVALID",
      "Trusted pull-request continuations may be nonempty only while new application ids are paused."
    );
  }
  return Object.freeze({
    schemaVersion: status.schemaVersion,
    state: status.state,
    continuingPullRequests
  });
}

function validateTrustedContinuations(records) {
  const result = [];
  const pullRequestNumbers = new Set();
  const applicationIds = new Set();
  let previous = null;
  for (const record of records) {
    if (
      !isPlainObject(record)
      || !arraysEqual(Object.keys(record).sort(compareUtf8), [
        "applicationId",
        "builderGitHubUserId",
        "companionNumericRepositoryIds",
        "primaryNumericRepositoryId",
        "pullRequestNumber"
      ])
      || typeof record.applicationId !== "string"
      || !APPLICATION_ID_PATTERN.test(record.applicationId)
      || record.applicationId.length > 80
      || typeof record.builderGitHubUserId !== "string"
      || !OPAQUE_ID_PATTERN.test(record.builderGitHubUserId)
      || typeof record.primaryNumericRepositoryId !== "string"
      || !OPAQUE_ID_PATTERN.test(record.primaryNumericRepositoryId)
      || typeof record.pullRequestNumber !== "string"
      || !PULL_REQUEST_NUMBER_PATTERN.test(record.pullRequestNumber)
      || !Array.isArray(record.companionNumericRepositoryIds)
      || record.companionNumericRepositoryIds.length > MAXIMUM_CONTINUATION_COMPANIONS
    ) {
      systemBlocked("INTAKE_STATUS_INVALID", "A trusted pull-request continuation record is malformed.");
    }
    const companions = record.companionNumericRepositoryIds;
    for (let index = 0; index < companions.length; index += 1) {
      if (
        typeof companions[index] !== "string"
        || !OPAQUE_ID_PATTERN.test(companions[index])
        || (index > 0 && compareUtf8(companions[index - 1], companions[index]) >= 0)
        || companions[index] === record.primaryNumericRepositoryId
      ) {
        systemBlocked(
          "INTAKE_STATUS_INVALID",
          "Trusted continuation companion repository ids must be unique canonical decimal strings in source-contract order."
        );
      }
    }
    if (
      pullRequestNumbers.has(record.pullRequestNumber)
      || applicationIds.has(record.applicationId)
      || (previous !== null && compareContinuations(previous, record) >= 0)
    ) {
      systemBlocked(
        "INTAKE_STATUS_INVALID",
        "Trusted pull-request continuations must be uniquely bound and sorted by pull-request number and application id."
      );
    }
    pullRequestNumbers.add(record.pullRequestNumber);
    applicationIds.add(record.applicationId);
    previous = record;
    result.push(Object.freeze({
      applicationId: record.applicationId,
      builderGitHubUserId: record.builderGitHubUserId,
      companionNumericRepositoryIds: Object.freeze([...companions]),
      primaryNumericRepositoryId: record.primaryNumericRepositoryId,
      pullRequestNumber: record.pullRequestNumber
    }));
  }
  return Object.freeze(result);
}

function enforceTrustedIntakeStatus({ intakeStatus, isUpdate, pullRequestNumber, applicationId }) {
  if (intakeStatus?.state === "open") return null;
  if (intakeStatus?.state === "paused-new" && isUpdate) return null;
  if (intakeStatus?.state === "paused-new" && !isUpdate) {
    const continuation = intakeStatus.continuingPullRequests.find((record) => (
      record.pullRequestNumber === pullRequestNumber && record.applicationId === applicationId
    ));
    if (continuation) return continuation;
  }
  if (intakeStatus?.state === "prelaunch") {
    systemBlocked("INTAKE_PRELAUNCH", "Public Builder Beta applications are not open yet.");
  }
  if (intakeStatus?.state === "paused-new") {
    systemBlocked(
      "INTAKE_PAUSED_NEW",
      "Public Builder Beta intake is paused for new application ids except exact trusted pull-request continuations."
    );
  }
  if (intakeStatus?.state === "paused-all") {
    systemBlocked("INTAKE_PAUSED_ALL", "Public Builder Beta intake is temporarily paused for all application changes.");
  }
  systemBlocked("INTAKE_STATUS_INVALID", "The trusted intake state could not be enforced.");
}

function enforceTrustedContinuationIdentity({ continuation, application }) {
  if (continuation === null) return;
  const companionIds = application.source.companions.map(({ numericRepositoryId }) => numericRepositoryId);
  if (
    application.applicationId !== continuation.applicationId
    || application.builder.githubUserId !== continuation.builderGitHubUserId
    || application.source.primary.numericRepositoryId !== continuation.primaryNumericRepositoryId
    || !arraysEqual(companionIds, continuation.companionNumericRepositoryIds)
  ) {
    reject(
      "INTAKE_CONTINUATION_IDENTITY_MISMATCH",
      "The paused-new continuation changed its trusted builder or repository lineage."
    );
  }
}

function compareContinuations(left, right) {
  const pullRequestOrder = compareDecimalStrings(left.pullRequestNumber, right.pullRequestNumber);
  return pullRequestOrder === 0 ? compareUtf8(left.applicationId, right.applicationId) : pullRequestOrder;
}

function compareDecimalStrings(left, right) {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeExpectedBuilderLogin(value) {
  if (typeof value !== "string" || value.length > 39 || !GITHUB_LOGIN_PATTERN.test(value)) {
    systemBlocked(
      "EXPECTED_BUILDER_LOGIN_INVALID",
      "The trusted GitHub pull-request author login is missing or malformed."
    );
  }
  return value.toLowerCase();
}

function normalizeExpectedBuilderUserId(value) {
  if (typeof value !== "string" || !OPAQUE_ID_PATTERN.test(value)) {
    systemBlocked(
      "EXPECTED_BUILDER_ID_INVALID",
      "The trusted GitHub pull-request author id is missing or malformed."
    );
  }
  return value;
}

export function validatePublicApplicationPackageFiles({ applicationId, packageFiles, limits: limitOverrides = {} }) {
  const limits = mergeLimits(limitOverrides);
  if (
    !(packageFiles instanceof Map)
    || !arraysEqual([...packageFiles.keys()].sort(compareUtf8), [...APPLICATION_FILES].sort(compareUtf8))
  ) {
    reject("APPLICATION_PACKAGE_NOT_CLOSED", "The pure package validator requires exactly the six frozen application files.");
  }
  let packageBytes = 0;
  for (const [fileName, bytes] of packageFiles) {
    if (!Buffer.isBuffer(bytes)) systemBlocked("PACKAGE_BYTES_INVALID", "The pure package validator requires Buffer values.");
    if (bytes.length > limits.maximumFileBytes[fileName]) reject("APPLICATION_FILE_TOO_LARGE", "An application package file exceeds its trusted byte limit.");
    packageBytes += bytes.length;
  }
  if (packageBytes > limits.maximumPackageBytes) {
    reject("APPLICATION_PACKAGE_TOO_LARGE", "The application review package exceeds the trusted byte limit.");
  }
  const application = parseCanonicalJson(packageFiles.get(APPLICATION_FILE), APPLICATION_FILE, limits);
  validateApplicationManifest(application, applicationId, limits);
  const compatibility = parseCanonicalJson(
    packageFiles.get("compatibility-report.json"),
    "compatibility-report.json",
    limits
  );
  const evidenceIndex = parseCanonicalJson(packageFiles.get("evidence-index.json"), "evidence-index.json", limits);
  const evidenceIds = validateEvidenceIndex(evidenceIndex, application, limits);
  validateCompatibilityReport(compatibility, application, evidenceIndex, evidenceIds, limits);
  validateReviewPackageHashes(application, packageFiles);
  const markdownSources = new Map([
    ["PROPOSAL.md", validateMarkdown(packageFiles.get("PROPOSAL.md"), "PROPOSAL.md", "# Proposal")],
    ["THREAT_MODEL.md", validateMarkdown(packageFiles.get("THREAT_MODEL.md"), "THREAT_MODEL.md", "# Threat model")],
    ["TEST_PLAN.md", validateMarkdown(packageFiles.get("TEST_PLAN.md"), "TEST_PLAN.md", "# Test plan")]
  ]);
  validatePublicClaims({ application, compatibility, evidenceIndex, markdownSources });
  return { application, compatibility, evidenceIndex };
}

export function inspectMaintainedSubmissions({
  repositoryRoot,
  maximumLegacyPackages = MAXIMUM_MAINTAINED_LEGACY_PACKAGES
}) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    systemBlocked(
      "MAINTAINED_REPOSITORY_ROOT_INVALID",
      "Maintained submission verification requires an explicit repository root."
    );
  }
  if (!Number.isInteger(maximumLegacyPackages) || maximumLegacyPackages < 0) {
    systemBlocked(
      "MAINTAINED_LEGACY_LIMIT_INVALID",
      "The maintained legacy-package limit must be a non-negative integer."
    );
  }

  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const submissionRoot = path.join(resolvedRepositoryRoot, "submissions");
  const rootStatus = lstatIfPresent(submissionRoot);
  if (!rootStatus || rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    systemBlocked(
      "MAINTAINED_SUBMISSIONS_ROOT_INVALID",
      "The trusted revision must contain a regular submissions directory."
    );
  }

  const applications = [];
  const legacyPackages = [];
  const entries = fs.readdirSync(submissionRoot, { withFileTypes: true })
    .sort((left, right) => compareUtf8(left.name, right.name));

  for (const entry of entries) {
    const entryPath = path.join(submissionRoot, entry.name);
    if (entry.name === "README.md") {
      const readmeStatus = lstatIfPresent(entryPath);
      if (!readmeStatus || readmeStatus.isSymbolicLink() || !readmeStatus.isFile()) {
        systemBlocked(
          "MAINTAINED_SUBMISSION_ENTRY_INVALID",
          "submissions/README.md must be a regular file."
        );
      }
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      systemBlocked(
        "MAINTAINED_SUBMISSION_ENTRY_INVALID",
        `Unexpected maintained intake entry submissions/${entry.name}; only package directories and README.md are allowed.`
      );
    }

    const applicationManifest = path.join(entryPath, APPLICATION_FILE);
    const manifestStatus = lstatIfPresent(applicationManifest);
    if (!manifestStatus) {
      legacyPackages.push({ name: entry.name, path: entryPath });
      continue;
    }
    if (manifestStatus.isSymbolicLink() || !manifestStatus.isFile()) {
      systemBlocked(
        "MAINTAINED_APPLICATION_FILE_INVALID",
        `Maintained application ${entry.name} has a non-regular application.json.`
      );
    }
    assertClosedMaintainedApplication(entryPath, entry.name);
    applications.push({ name: entry.name, path: entryPath });
  }

  if (legacyPackages.length > maximumLegacyPackages) {
    systemBlocked(
      "MAINTAINED_LEGACY_PACKAGE_LIMIT_EXCEEDED",
      `Maintained intake contains ${legacyPackages.length} legacy packages; the trusted validation limit is ${maximumLegacyPackages}.`
    );
  }

  return {
    repositoryRoot: resolvedRepositoryRoot,
    submissionRoot,
    applications,
    legacyPackages
  };
}

export async function verifyMaintainedSubmissions({
  repositoryRoot,
  maximumLegacyPackages = MAXIMUM_MAINTAINED_LEGACY_PACKAGES,
  validateLegacyPackage
}) {
  if (typeof validateLegacyPackage !== "function") {
    systemBlocked(
      "MAINTAINED_LEGACY_VALIDATOR_UNAVAILABLE",
      "Maintained submission verification requires the trusted legacy-package validator."
    );
  }
  const inventory = inspectMaintainedSubmissions({ repositoryRoot, maximumLegacyPackages });
  for (const legacyPackage of inventory.legacyPackages) {
    await validateLegacyPackage({
      repositoryRoot: inventory.repositoryRoot,
      packageName: legacyPackage.name,
      packageRoot: legacyPackage.path
    });
  }
  return {
    schemaVersion: 1,
    result: "valid-maintained-submissions",
    applicationCount: inventory.applications.length,
    legacyPackageCount: inventory.legacyPackages.length,
    validatedLegacyPackages: inventory.legacyPackages.map((entry) => entry.name)
  };
}

function assertClosedMaintainedApplication(packageRoot, applicationId) {
  const entries = fs.readdirSync(packageRoot, { withFileTypes: true })
    .sort((left, right) => compareUtf8(left.name, right.name));
  const observedNames = entries.map((entry) => entry.name);
  const expectedNames = [...APPLICATION_FILES].sort(compareUtf8);
  if (!arraysEqual(observedNames, expectedNames)) {
    systemBlocked(
      "MAINTAINED_APPLICATION_PACKAGE_NOT_CLOSED",
      `Maintained application ${applicationId} must contain exactly the six public application files.`
    );
  }
  for (const entry of entries) {
    const fileStatus = lstatIfPresent(path.join(packageRoot, entry.name));
    if (!fileStatus || fileStatus.isSymbolicLink() || !fileStatus.isFile()) {
      systemBlocked(
        "MAINTAINED_APPLICATION_FILE_INVALID",
        `Maintained application ${applicationId} contains a non-regular package file.`
      );
    }
  }
}

function lstatIfPresent(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function mergeLimits(overrides) {
  if (!isPlainObject(overrides)) systemBlocked("LIMITS_INVALID", "Trusted validator limits must be an object.");
  return {
    ...DEFAULT_LIMITS,
    ...overrides,
    maximumFileBytes: {
      ...DEFAULT_LIMITS.maximumFileBytes,
      ...(isPlainObject(overrides.maximumFileBytes) ? overrides.maximumFileBytes : {})
    }
  };
}

function compareGitRevisions({
  baseRoot,
  candidateRoot,
  expectedBaseCommit,
  expectedCandidateCommit,
  expectedMergeCommit,
  limits
}) {
  const base = inspectGitRevision(baseRoot, expectedBaseCommit, limits);
  const candidate = inspectPullRequestMergeRevision(candidateRoot, {
    expectedBaseCommit,
    expectedCandidateCommit,
    expectedMergeCommit,
    limits
  });
  const allPaths = [...new Set([...base.entries.keys(), ...candidate.entries.keys()])].sort(compareUtf8);
  const changes = [];
  for (const entryPath of allPaths) {
    const before = base.entries.get(entryPath) ?? null;
    const after = candidate.entries.get(entryPath) ?? null;
    if (before && after && before.mode === after.mode && before.type === after.type && before.oid === after.oid) continue;
    changes.push({
      path: entryPath,
      status: before === null ? "added" : after === null ? "deleted" : "modified",
      before,
      after
    });
  }
  if (changes.length > limits.maximumChangedFiles) {
    reject("TOO_MANY_CHANGED_FILES", "The pull request exceeds the trusted changed-file limit.");
  }
  return { base, candidate, changes };
}

function inspectPullRequestMergeRevision(rootInput, {
  expectedBaseCommit,
  expectedCandidateCommit,
  expectedMergeCommit,
  limits
}) {
  for (const [label, commit] of [
    ["base", expectedBaseCommit],
    ["candidate", expectedCandidateCommit],
    ["merge", expectedMergeCommit]
  ]) {
    if (!SHA1_PATTERN.test(commit ?? "")) {
      systemBlocked("EXPECTED_COMMIT_INVALID", `The workflow did not provide an exact lowercase ${label} commit id.`);
    }
  }

  const root = resolveGitRoot(rootInput);
  const checkoutCommit = runGitText(root, ["rev-parse", "HEAD^{commit}"], 1024).trim();
  if (checkoutCommit !== expectedMergeCommit) {
    systemBlocked("CHECKOUT_COMMIT_MISMATCH", "The candidate-data checkout does not match GitHub's immutable PR merge commit.");
  }

  const commitObject = runGitText(root, ["cat-file", "-p", "HEAD^{commit}"], 1024 * 1024);
  const headerEnd = commitObject.indexOf("\n\n");
  if (headerEnd === -1) {
    systemBlocked("PR_MERGE_COMMIT_MALFORMED", "GitHub's PR merge commit has no canonical commit header boundary.");
  }
  const headerLines = commitObject.slice(0, headerEnd).split("\n");
  const treeLines = headerLines.filter((line) => line.startsWith("tree "));
  const parentLines = headerLines.filter((line) => line.startsWith("parent "));
  if (
    treeLines.length !== 1
    || !/^tree [a-f0-9]{40}$/u.test(treeLines[0])
    || parentLines.length !== 2
    || parentLines.some((line) => !/^parent [a-f0-9]{40}$/u.test(line))
  ) {
    systemBlocked("PR_MERGE_PARENT_CONTRACT_INVALID", "GitHub's PR merge commit does not have one tree and exactly two canonical parents.");
  }
  const parents = parentLines.map((line) => line.slice("parent ".length));
  if (parents[0] !== expectedBaseCommit || parents[1] !== expectedCandidateCommit) {
    systemBlocked("PR_MERGE_PARENT_MISMATCH", "GitHub's PR merge parents do not match the event's exact base and head commits.");
  }

  const output = runGit(root, ["ls-tree", "-rz", "--full-tree", "HEAD"], limits.maximumGitTreeBytes);
  const entries = parseGitTree(output, limits);
  return {
    root,
    commit: expectedCandidateCommit,
    mergeCommit: expectedMergeCommit,
    entries
  };
}

function inspectGitRevision(rootInput, expectedCommit, limits) {
  const root = resolveGitRoot(rootInput);
  if (!SHA1_PATTERN.test(expectedCommit ?? "")) {
    systemBlocked("EXPECTED_COMMIT_INVALID", "The workflow did not provide an exact lowercase 40-hex commit id.");
  }
  const commit = runGitText(root, ["rev-parse", "HEAD^{commit}"], 1024).trim();
  if (commit !== expectedCommit) {
    systemBlocked("CHECKOUT_COMMIT_MISMATCH", "A checkout does not match the immutable commit supplied by GitHub.");
  }
  const output = runGit(root, ["ls-tree", "-rz", "--full-tree", "HEAD"], limits.maximumGitTreeBytes);
  const entries = parseGitTree(output, limits);
  return { root, commit, entries };
}

function resolveGitRoot(rootInput) {
  const root = path.resolve(rootInput ?? "");
  if (!rootInput || !fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    systemBlocked("GIT_ROOT_INVALID", "A trusted checkout root is missing or is not a directory.");
  }
  return root;
}

function parseGitTree(output, limits) {
  const entries = new Map();
  let offset = 0;
  while (offset < output.length) {
    const terminator = output.indexOf(0, offset);
    if (terminator === -1) systemBlocked("GIT_TREE_MALFORMED", "The trusted Git tree output is not NUL terminated.");
    const recordBytes = output.subarray(offset, terminator);
    offset = terminator + 1;
    if (recordBytes.length === 0) continue;
    let record;
    try {
      record = UTF8_DECODER.decode(recordBytes);
    } catch {
      reject("GIT_PATH_NOT_UTF8", "A changed Git path is not valid UTF-8.");
    }
    const match = /^(\d{6}) (blob|commit|tree) ([a-f0-9]{40})\t(.+)$/.exec(record);
    if (!match) systemBlocked("GIT_TREE_MALFORMED", "The trusted Git tree output contains an invalid record.");
    const [, mode, type, oid, entryPath] = match;
    validateGitPath(entryPath);
    if (entries.has(entryPath)) systemBlocked("GIT_TREE_DUPLICATE_PATH", "The Git tree contains a duplicate path.");
    entries.set(entryPath, { mode, type, oid, path: entryPath });
    if (entries.size > limits.maximumGitEntries) {
      reject("GIT_TREE_TOO_LARGE", "The candidate tree exceeds the trusted entry limit.");
    }
  }
  return entries;
}

function validateGitPath(entryPath) {
  if (!isCanonicalGitHubRepositoryPathV1(entryPath)) {
    reject("GIT_PATH_UNSAFE", "A changed Git path is outside the safe canonical path subset.");
  }
}

function rejectUnsafeChangedEntries(changes) {
  for (const change of changes) {
    if (change.after && (change.after.mode === "120000" || change.after.type === "commit" || change.after.mode === "160000")) {
      reject("LINKED_CONTENT_FORBIDDEN", "Candidate symlinks and submodules are forbidden in trusted intake paths.");
    }
    if (change.after && (change.after.mode !== "100644" || change.after.type !== "blob")) {
      reject("FILE_MODE_FORBIDDEN", "Changed intake files must be non-executable regular Git blobs.");
    }
  }
}

function isAllowlistedApplicationPath(entryPath) {
  const match = APPLICATION_PATH_PATTERN.exec(entryPath);
  return Boolean(match && APPLICATION_FILES.includes(match[2]));
}

function classifyTrustedBaseApplication(base, applicationId) {
  const packagePrefix = `submissions/${applicationId}/`;
  const entries = [...base.entries.values()]
    .filter((entry) => entry.path.startsWith(packagePrefix))
    .sort((left, right) => compareUtf8(left.path, right.path));
  if (entries.length === 0) return false;
  const expectedPaths = APPLICATION_FILES
    .map((fileName) => `${packagePrefix}${fileName}`)
    .sort(compareUtf8);
  if (!arraysEqual(entries.map(({ path: entryPath }) => entryPath), expectedPaths)) {
    systemBlocked(
      "INTAKE_BASE_APPLICATION_INVALID",
      "The trusted base contains an incomplete or non-closed public application package."
    );
  }
  for (const entry of entries) {
    if (entry.mode !== "100644" || entry.type !== "blob" || !SHA1_PATTERN.test(entry.oid)) {
      systemBlocked(
        "INTAKE_BASE_APPLICATION_INVALID",
        "The trusted base application package contains a non-regular entry."
      );
    }
  }
  return true;
}

function assertNewApplicationChangedFileSet({ changedFiles, applicationId }) {
  const expectedPaths = APPLICATION_FILES
    .map((fileName) => `submissions/${applicationId}/${fileName}`)
    .sort(compareUtf8);
  const observedPaths = changedFiles.map(({ path: entryPath }) => entryPath).sort(compareUtf8);
  if (
    !arraysEqual(observedPaths, expectedPaths)
    || changedFiles.some(({ status, previousPath }) => status !== "added" || previousPath !== null)
  ) {
    reject(
      "CHANGED_PATH_NOT_ALLOWED",
      "A paused-new continuation must add exactly the six frozen files for its trusted application id."
    );
  }
}

function isBuilderMaintenancePath(entryPath) {
  return BUILDER_MAINTENANCE_FILES.has(entryPath)
    || BUILDER_MAINTENANCE_PREFIXES.some((prefix) => entryPath.startsWith(prefix))
    || /^scripts\/test\/verify-public-hook-application(?:-[a-z0-9-]+)?\.test\.mjs$/u.test(entryPath);
}

function assertRegularBlob(entry) {
  if (!entry || entry.mode !== "100644" || entry.type !== "blob" || !SHA1_PATTERN.test(entry.oid)) {
    reject("APPLICATION_FILE_NOT_REGULAR", "Every application package entry must be a non-executable regular Git blob.");
  }
}

function readGitBlob(root, entry, maximumBytes) {
  assertRegularBlob(entry);
  const declaredSizeText = runGitText(root, ["cat-file", "-s", entry.oid], 128).trim();
  if (!/^(?:0|[1-9][0-9]*)$/.test(declaredSizeText)) {
    systemBlocked("GIT_BLOB_SIZE_INVALID", "Git returned an invalid blob size.");
  }
  const declaredSize = Number(declaredSizeText);
  if (!Number.isSafeInteger(declaredSize) || declaredSize > maximumBytes) {
    reject("APPLICATION_FILE_TOO_LARGE", "An application package file exceeds its trusted byte limit.");
  }
  const bytes = runGit(root, ["cat-file", "blob", entry.oid], maximumBytes + 1);
  if (bytes.length !== declaredSize) systemBlocked("GIT_BLOB_SIZE_MISMATCH", "Git blob bytes do not match their declared size.");
  return bytes;
}

function parseCanonicalJson(bytes, documentName, limits) {
  let source;
  try {
    source = UTF8_DECODER.decode(bytes);
  } catch {
    reject("JSON_UTF8_INVALID", `${documentName} is not valid UTF-8.`);
  }
  if (CONTROL_OR_BIDI_PATTERN.test(source) || source.includes("\r")) {
    reject("JSON_TEXT_UNSAFE", `${documentName} contains unsupported control, bidi, or carriage-return characters.`);
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    reject("JSON_PARSE_FAILED", `${documentName} is not valid JSON.`);
  }
  validateJsonTree(value, limits);
  if (source !== `${canonicalJson(value)}\n`) {
    reject("JSON_NOT_CANONICAL", `${documentName} must be sorted, compact canonical JSON followed by one LF.`);
  }
  return value;
}

function validateJsonTree(root, limits) {
  let nodes = 0;
  const visit = (value, depth) => {
    nodes += 1;
    if (nodes > limits.maximumJsonNodes) reject("JSON_NODE_LIMIT", "A JSON document exceeds the trusted node limit.");
    if (depth > limits.maximumJsonDepth) reject("JSON_DEPTH_LIMIT", "A JSON document exceeds the trusted depth limit.");
    if (typeof value === "string") {
      if (CONTROL_OR_BIDI_PATTERN.test(value)) reject("JSON_STRING_UNSAFE", "A JSON string contains unsafe control or bidi characters.");
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") return;
    if (!isPlainObject(value)) reject("JSON_VALUE_UNSUPPORTED", "A JSON document contains an unsupported value type.");
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_JSON_KEYS.has(key)) reject("JSON_KEY_FORBIDDEN", "A JSON document contains a prototype-sensitive key.");
      visit(entry, depth + 1);
    }
  };
  visit(root, 0);
}

function validateApplicationManifest(application, expectedApplicationId, limits) {
  expectClosedObject(application, [
    "applicationId",
    "applicationRevision",
    "builder",
    "declarations",
    "reviewPackage",
    "schemaVersion",
    "source",
    "stage",
    "summary",
    "title"
  ], "application.json");
  expectInteger(application.schemaVersion, 1, 1, "application.schemaVersion");
  expectPattern(application.applicationId, APPLICATION_ID_PATTERN, 80, "application.applicationId");
  if (application.applicationId !== expectedApplicationId) {
    reject("APPLICATION_ID_PATH_MISMATCH", "The manifest application id must equal its submissions directory.");
  }
  expectInteger(application.applicationRevision, 1, 1_000_000, "application.applicationRevision");
  if (!new Set(["proposal", "prototype"]).has(application.stage)) {
    reject("APPLICATION_STAGE_INVALID", "An application stage must be proposal or prototype.");
  }
  expectText(application.title, 3, 120, "application.title");
  expectText(application.summary, 20, 1_000, "application.summary");

  expectClosedObject(application.builder, ["contact", "githubLogin", "githubUserId"], "application.builder");
  expectPattern(application.builder.githubUserId, OPAQUE_ID_PATTERN, 64, "application.builder.githubUserId");
  expectPattern(application.builder.githubLogin, GITHUB_LOGIN_PATTERN, 39, "application.builder.githubLogin");
  if (application.builder.contact !== null) validatePublicHttpsUrl(application.builder.contact, "application.builder.contact");

  expectClosedObject(application.declarations, [
    "noApprovalClaim",
    "noSecretsDeclared",
    "noUniswapEndorsementClaim",
    "publicInformationAcknowledged"
  ], "application.declarations");
  for (const value of Object.values(application.declarations)) {
    if (value !== true) reject("APPLICATION_DECLARATION_REQUIRED", "Every public-beta declaration must be explicitly true.");
  }

  validateApplicationSource(application.source);

  if (!Array.isArray(application.reviewPackage) || application.reviewPackage.length !== REVIEW_FILES.length) {
    reject("REVIEW_PACKAGE_INDEX_INVALID", "The manifest must index every review file exactly once.");
  }
  application.reviewPackage.forEach((record, index) => {
    expectClosedObject(record, ["byteLength", "path", "sha256"], `reviewPackage[${index}]`);
    if (record.path !== REVIEW_FILES[index]) reject("REVIEW_PACKAGE_ORDER_INVALID", "Review package records must use the canonical path order.");
    expectPattern(record.sha256, SHA256_PATTERN, 71, "reviewPackage.sha256");
    expectInteger(record.byteLength, 1, limits.maximumFileBytes[record.path], "reviewPackage.byteLength");
  });
}

function validateEvidenceIndex(index, application, limits) {
  expectClosedObject(index, ["applicationId", "attestation", "evidence", "schemaVersion", "source"], "evidence-index.json");
  expectInteger(index.schemaVersion, 1, 1, "evidenceIndex.schemaVersion");
  if (index.applicationId !== application.applicationId) reject("EVIDENCE_APPLICATION_MISMATCH", "The evidence index is bound to another application id.");
  if (index.attestation !== "builder-declared-untrusted") reject("EVIDENCE_ATTESTATION_INVALID", "Builder evidence must remain explicitly untrusted.");
  validateSourceProjection(index.source, application.source.primary, "evidenceIndex.source");
  if (!Array.isArray(index.evidence) || index.evidence.length < 1 || index.evidence.length > limits.maximumEvidence) {
    reject("EVIDENCE_COUNT_INVALID", "The evidence index must contain at least one record and stay within the trusted record limit.");
  }
  const ids = new Set();
  const urls = new Set();
  const allowedKinds = new Set(["build", "unit", "fuzz", "invariant", "static-analysis", "fork", "ui", "manual-review", "other"]);
  const allowedStatuses = new Set(["passed", "failed", "blocked", "not-run"]);
  let previousId = null;
  index.evidence.forEach((record, recordIndex) => {
    expectClosedObject(record, ["id", "kind", "scope", "sha256", "status", "url"], `evidence[${recordIndex}]`);
    expectPattern(record.id, EVIDENCE_ID_PATTERN, 80, "evidence.id");
    if (ids.has(record.id)) reject("EVIDENCE_ID_DUPLICATE", "Evidence ids must be unique.");
    if (urls.has(record.url)) reject("EVIDENCE_TARGET_DUPLICATE", "Each immutable evidence target may be declared only once.");
    if (previousId !== null && compareUtf8(previousId, record.id) >= 0) reject("EVIDENCE_ORDER_INVALID", "Evidence records must be sorted by id.");
    ids.add(record.id);
    urls.add(record.url);
    previousId = record.id;
    if (!allowedKinds.has(record.kind)) reject("EVIDENCE_KIND_INVALID", "An evidence record has an unsupported kind.");
    if (!allowedStatuses.has(record.status)) reject("EVIDENCE_STATUS_INVALID", "An evidence record has an unsupported status.");
    expectText(record.scope, 12, 500, "evidence.scope");
    const evidenceLocation = validateGitHubEvidenceUrl(record.url, "evidence.url", application.source.primary);
    if (evidenceLocation === "blob" && record.sha256 === null) {
      reject("EVIDENCE_BLOB_HASH_REQUIRED", "Evidence bound to a source blob must declare its SHA-256 digest.");
    }
    if (evidenceLocation === "actions" && record.sha256 !== null) {
      reject("EVIDENCE_ACTION_HASH_INVALID", "A GitHub Actions run page is not immutable content and must use a null SHA-256 field.");
    }
    if (record.sha256 !== null) expectPattern(record.sha256, SHA256_PATTERN, 71, "evidence.sha256");
  });
  return ids;
}

function validateCompatibilityReport(report, application, evidenceIndex, evidenceIds, limits) {
  expectClosedObject(report, ["applicationId", "disclaimer", "findings", "result", "schemaVersion", "source"], "compatibility-report.json");
  expectInteger(report.schemaVersion, 1, 1, "compatibility.schemaVersion");
  if (report.applicationId !== application.applicationId) reject("COMPATIBILITY_APPLICATION_MISMATCH", "The compatibility report is bound to another application id.");
  validateSourceProjection(report.source, application.source.primary, "compatibility.source");
  const allowedResults = new Set(["prototype-ready", "changes-required", "architecture-review-required", "tooling-blocked"]);
  if (!allowedResults.has(report.result)) reject("COMPATIBILITY_RESULT_INVALID", "The compatibility report cannot claim approval, safety, or launch status.");
  if (report.disclaimer !== PUBLIC_BETA_DISCLAIMER) reject("COMPATIBILITY_DISCLAIMER_INVALID", "The required public-beta disclaimer is missing or changed.");
  if (!Array.isArray(report.findings) || report.findings.length > limits.maximumFindings) {
    reject("FINDING_COUNT_INVALID", "The compatibility report exceeds the trusted finding limit.");
  }
  const findingKeys = new Set();
  let previousKey = null;
  report.findings.forEach((finding, index) => {
    expectClosedObject(finding, ["code", "evidenceIds", "path", "remediation", "severity", "summary"], `findings[${index}]`);
    expectPattern(finding.code, FINDING_CODE_PATTERN, 80, "finding.code");
    if (!new Set(["informational", "warning", "blocker", "hard"]).has(finding.severity)) {
      reject("FINDING_SEVERITY_INVALID", "A finding has an unsupported severity.");
    }
    validateFindingPath(finding.path);
    expectText(finding.summary, 12, 800, "finding.summary");
    expectText(finding.remediation, 12, 800, "finding.remediation");
    validateSortedUniqueStrings(finding.evidenceIds, 0, 32, "finding.evidenceIds", (value) => {
      expectPattern(value, EVIDENCE_ID_PATTERN, 80, "finding.evidenceId");
      if (!evidenceIds.has(value)) reject("FINDING_EVIDENCE_UNKNOWN", "A finding references an unknown evidence id.");
    });
    const key = `${finding.code}\u0000${finding.path}`;
    if (findingKeys.has(key)) reject("FINDING_DUPLICATE", "Finding code and path pairs must be unique.");
    if (previousKey !== null && compareUtf8(previousKey, key) >= 0) reject("FINDING_ORDER_INVALID", "Findings must be sorted by code and path.");
    findingKeys.add(key);
    previousKey = key;
  });

  if (application.stage === "proposal" && report.result === "prototype-ready") {
    reject("COMPATIBILITY_STAGE_MISMATCH", "A proposal-stage application cannot claim prototype-ready compatibility.");
  }
  const evidenceStatuses = new Set(evidenceIndex.evidence.map((record) => record.status));
  const findingSeverities = new Set(report.findings.map((finding) => finding.severity));
  const hasActionableFinding = ["warning", "blocker", "hard"].some((severity) => findingSeverities.has(severity));
  if (
    report.result === "prototype-ready"
    && (evidenceIndex.evidence.some((record) => record.status !== "passed") || hasActionableFinding)
  ) {
    reject(
      "COMPATIBILITY_EVIDENCE_MISMATCH",
      "Prototype-ready compatibility requires passed evidence and no warning, blocker, or hard finding."
    );
  }
  if (
    report.result === "prototype-ready"
    && !evidenceIndex.evidence.some((record) =>
      record.status === "passed"
      && validateGitHubEvidenceUrl(record.url, "evidence.url", application.source.primary) === "actions"
    )
  ) {
    reject(
      "COMPATIBILITY_EVIDENCE_MISMATCH",
      "Prototype-ready compatibility requires a declared successful GitHub Actions run for the exact source revision."
    );
  }
  if (report.result === "changes-required" && !evidenceStatuses.has("failed") && !hasActionableFinding) {
    reject(
      "COMPATIBILITY_EVIDENCE_MISMATCH",
      "Changes-required compatibility needs failed evidence or an actionable finding."
    );
  }
  if (
    report.result === "tooling-blocked"
    && !evidenceStatuses.has("blocked")
    && !evidenceStatuses.has("not-run")
  ) {
    reject(
      "COMPATIBILITY_EVIDENCE_MISMATCH",
      "Tooling-blocked compatibility needs blocked or not-run evidence."
    );
  }
  // The six-file public record does not yet let trusted-base code reconstruct
  // the exact review target and every bound source/evidence blob digest.
  if (report.result === "prototype-ready") {
    reject(
      "PROTOTYPE_READY_REQUIRES_TRUSTED_REVIEW_TARGET",
      "Public prototype-ready requires trusted-base reconstruction of the exact review target and source/evidence blob digests; submit this revision for architecture or changes review until that gate is available."
    );
  }
}

function validateSourceProjection(source, primary, label) {
  expectClosedObject(source, ["numericRepositoryId", "revisionObjectId", "treeObjectId"], label);
  if (
    source.numericRepositoryId !== primary.numericRepositoryId
    || source.revisionObjectId !== primary.revisionObjectId
    || source.treeObjectId !== primary.treeObjectId
  ) {
    reject("REVIEW_SOURCE_BINDING_MISMATCH", "Review JSON is not bound to the exact primary source revision.");
  }
}

function validateReviewPackageHashes(application, files) {
  for (const record of application.reviewPackage) {
    const bytes = files.get(record.path);
    if (!bytes) systemBlocked("REVIEW_FILE_MISSING", "An indexed review file is unavailable to the trusted validator.");
    const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
    if (record.byteLength !== bytes.length || record.sha256 !== digest) {
      reject("REVIEW_FILE_BINDING_MISMATCH", "A review file does not match its manifest byte length and SHA-256 digest.");
    }
  }
}

function validateMarkdown(bytes, documentName, requiredHeading) {
  let source;
  try {
    source = UTF8_DECODER.decode(bytes);
  } catch {
    reject("MARKDOWN_UTF8_INVALID", `${documentName} is not valid UTF-8.`);
  }
  if (!source.endsWith("\n") || source.includes("\r") || source.includes("\t") || CONTROL_OR_BIDI_PATTERN.test(source)) {
    reject("MARKDOWN_TEXT_UNSAFE", `${documentName} must be LF-delimited UTF-8 without tabs, controls, or bidi overrides.`);
  }
  if (source.split("\n", 1)[0] !== requiredHeading) {
    reject("MARKDOWN_HEADING_INVALID", `${documentName} is missing its exact first-level heading.`);
  }
  const body = source.slice(requiredHeading.length + 1).trim();
  if (body.length < 40) {
    reject("MARKDOWN_CONTENT_INCOMPLETE", `${documentName} must contain a substantive review body after its heading.`);
  }
  if (/<[!/?A-Za-z]/u.test(source) || /&(?:#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/u.test(source)) {
    reject("MARKDOWN_ACTIVE_CONTENT", `${documentName} contains raw markup, autolinks, or encoded active content.`);
  }
  if (
    /!\[[^\]]*\]\s*(?:\([^)]*\)|\[[^\]]*\])/su.test(source)
    || /(?:javascript|data|file|vbscript)\s*:/iu.test(source)
  ) {
    reject("MARKDOWN_EMBEDDED_CONTENT", `${documentName} contains an image or unsafe URI scheme.`);
  }
  return source;
}

function validatePublicClaims({ application, compatibility, evidenceIndex, markdownSources }) {
  const documents = [
    ["application.json", [application.title, application.summary]],
    [
      "compatibility-report.json",
      compatibility.findings.flatMap((finding) => [finding.summary, finding.remediation])
    ],
    ["evidence-index.json", evidenceIndex.evidence.map((record) => record.scope)],
    ...[...markdownSources].map(([documentName, source]) => [documentName, [source]])
  ];
  for (const [documentName, strings] of documents) {
    for (const value of strings) {
      if (findUnsupportedPublicClaims(value).length > 0) {
        reject(
          "UNSUPPORTED_PUBLIC_CLAIM",
          `${documentName} contains an unsupported approval, audit, safety, deployment, launch, or availability claim.`
        );
      }
    }
  }
}

function validateRevisionChange({ application, applicationId, packagePrefix, classified, limits }) {
  const manifestPath = `${packagePrefix}${APPLICATION_FILE}`;
  const baseEntry = classified.base.entries.get(manifestPath);
  if (!baseEntry) {
    if (application.applicationRevision !== 1) {
      reject("NEW_APPLICATION_REVISION_INVALID", "A new public application must begin at revision 1.");
    }
    return;
  }
  assertRegularBlob(baseEntry);
  const prior = parseCanonicalJson(
    readGitBlob(classified.base.root, baseEntry, limits.maximumFileBytes[APPLICATION_FILE]),
    `base:${manifestPath}`,
    limits
  );
  validateApplicationManifest(prior, applicationId, limits);
  if (application.applicationRevision !== prior.applicationRevision + 1) {
    reject("APPLICATION_REVISION_NOT_INCREMENTED", "An updated application must increment its revision by exactly one.");
  }
  if (application.builder.githubUserId !== prior.builder.githubUserId) {
    reject(
      "BUILDER_IDENTITY_CHANGED",
      "An application update cannot replace its immutable GitHub builder user id."
    );
  }
  const priorPrimary = prior.source.primary;
  const nextPrimary = application.source.primary;
  if (priorPrimary.numericRepositoryId !== nextPrimary.numericRepositoryId) {
    reject("PRIMARY_SOURCE_LINEAGE_CHANGED", "An application update cannot replace its primary public repository lineage.");
  }
  const primaryCommitChanged = priorPrimary.revisionObjectId !== nextPrimary.revisionObjectId;
  const primaryTreeChanged = priorPrimary.treeObjectId !== nextPrimary.treeObjectId;
  if (primaryCommitChanged !== primaryTreeChanged) {
    reject("PRIMARY_SOURCE_REVISION_PARTIAL", "A primary source update must bind both a new commit and its new root tree.");
  }
  if (sameSourceAuthority(prior.source, application.source)) {
    reject("PRIMARY_SOURCE_REVISION_UNCHANGED", "An application update must bind a new primary or companion source authority.");
  }
  for (const requiredChangedFile of ["compatibility-report.json", "evidence-index.json"]) {
    const changed = classified.changes.find((entry) => entry.path === `${packagePrefix}${requiredChangedFile}`);
    if (!changed || changed.status !== "modified") {
      reject("REVIEW_EVIDENCE_NOT_REGENERATED", "A source revision update must regenerate compatibility and evidence JSON.");
    }
  }
}

function sameSourceAuthority(left, right) {
  const leftProjection = sourceAuthorityProjection(left);
  const rightProjection = sourceAuthorityProjection(right);
  return JSON.stringify(leftProjection) === JSON.stringify(rightProjection);
}

/**
 * One application-scoped resolver session shares the anonymous REST transport
 * and retains only exact primary-source blobs that the evidence index already
 * names. Source validation therefore pays for each REST control-plane object
 * once, while evidence reuses the same inert Git bytes without another REST
 * tree walk or another anonymous smart-Git fetch.
 */
export function createTrustedPublicApplicationResolutionSessionV1(
  { primary, evidence },
  {
    exactObjectResolver = createAnonymousGitHubExactObjectResolverV1(),
    transport = createTrustedGitHubActionsPublicTransportV1()
  } = {}
) {
  if (!isPlainObject(primary) || !Array.isArray(evidence)) {
    systemBlocked("EVIDENCE_RESOLUTION_INPUT_INVALID", "Trusted resolution session received malformed inputs.");
  }
  if (typeof exactObjectResolver !== "function" || typeof transport !== "function") {
    systemBlocked("RESOLVER_UNAVAILABLE", "The trusted application resolution session is unavailable.");
  }
  const retainedPaths = new Set(evidence.map((record) => evidenceBlobPath(record.url, primary)));
  const sharedExactObjectResolver = createRetainedExactObjectResolverV1(exactObjectResolver, {
    repositoryUri: primary.repositoryUri,
    revisionObjectId: primary.revisionObjectId,
    treeObjectId: primary.treeObjectId,
    retainedPaths
  });
  return Object.freeze({
    resolveSource(request) {
      return resolvePublicGitHubSource(request, { exactObjectResolver: sharedExactObjectResolver, transport });
    },
    resolveEvidence(request) {
      return resolvePublicApplicationEvidence(request, { exactObjectResolver: sharedExactObjectResolver });
    }
  });
}

function createRetainedExactObjectResolverV1(delegate, authority) {
  const retainedRecords = new Map();
  return async (request) => {
    if (sameExactObjectAuthority(request, authority)) {
      const cached = new Map();
      let cachedBytes = 0;
      for (const filePath of request.paths) {
        const record = retainedRecords.get(filePath);
        if (record === undefined) break;
        cachedBytes += record.bytes.length;
        if (record.bytes.length > request.maximumFileBytes || cachedBytes > request.maximumTotalBytes) break;
        cached.set(filePath, cloneExactObjectRecord(record));
      }
      if (cached.size === request.paths.length) return { records: cached };
    }

    const result = await delegate(request);
    const records = result instanceof Map ? result : result?.records;
    if (sameExactObjectAuthority(request, authority) && records instanceof Map) {
      for (const filePath of authority.retainedPaths) {
        const record = records.get(filePath);
        if (isEvidenceExactObjectRecord(record)) {
          retainedRecords.set(filePath, cloneExactObjectRecord(record));
        }
      }
    }
    return result;
  };
}

function sameExactObjectAuthority(request, authority) {
  return request?.repositoryUri === authority.repositoryUri
    && request?.revisionObjectId === authority.revisionObjectId
    && request?.treeObjectId === authority.treeObjectId;
}

function cloneExactObjectRecord(record) {
  return {
    bytes: Buffer.from(record.bytes),
    mode: record.mode,
    objectId: record.objectId
  };
}

export async function resolvePublicGitHubSource(request, options = {}) {
  const usesDefaultTrustedTransport = options.transport === undefined;
  const resolverOptions = {
    timeoutMs: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs,
    ...options
  };
  if (resolverOptions.transport === undefined) {
    resolverOptions.transport = createTrustedGitHubActionsPublicTransportV1();
  }
  if (resolverOptions.exactObjectResolver === undefined && usesDefaultTrustedTransport) {
    resolverOptions.exactObjectResolver = createAnonymousGitHubExactObjectResolverV1();
  }
  return resolveGitHubPublicSourceV1(request, resolverOptions);
}

export async function resolvePublicApplicationEvidence({ primary, evidence, limits: limitOverrides = {} }, options = {}) {
  if (!isPlainObject(primary) || !Array.isArray(evidence)) {
    systemBlocked("EVIDENCE_RESOLUTION_INPUT_INVALID", "Trusted evidence resolution received malformed inputs.");
  }
  const limits = mergeLimits(limitOverrides);
  const timeoutMs = options.timeoutMs ?? GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTimeoutMs
    || timeoutMs > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs
  ) {
    systemBlocked("EVIDENCE_RESOLUTION_OPTIONS_INVALID", "Trusted evidence resolution received an invalid timeout.");
  }
  const usesDefaultTransport = options.transport === undefined;
  const exactObjectResolver = options.exactObjectResolver === undefined
    ? (usesDefaultTransport ? createAnonymousGitHubExactObjectResolverV1() : null)
    : options.exactObjectResolver;
  if (exactObjectResolver !== null && typeof exactObjectResolver !== "function") {
    systemBlocked("EVIDENCE_RESOLVER_UNAVAILABLE", "The trusted exact evidence resolver is unavailable.");
  }
  if (exactObjectResolver !== null) {
    return resolveEvidenceWithExactObjectResolver({
      primary,
      evidence,
      limits,
      timeoutMs,
      exactObjectResolver
    });
  }

  const transport = options.transport ?? createTrustedGitHubActionsPublicTransportV1();
  if (typeof transport !== "function") {
    systemBlocked("EVIDENCE_RESOLVER_UNAVAILABLE", "The trusted public-evidence transport is unavailable.");
  }
  const repository = new URL(primary.repositoryUri);
  const [owner, repositoryName] = repository.pathname.slice(1).split("/");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("evidence resolution timed out")), timeoutMs);
  const state = {
    controller,
    limits,
    owner,
    repositoryName,
    requests: 0,
    responseBytes: 0,
    transport,
    recursiveTree: null,
    blobCache: new Map()
  };
  try {
    const observations = [];
    for (const record of evidence) {
      const sourcePath = evidenceBlobPath(record.url, primary);
      const resolved = await resolveEvidenceBlob(sourcePath, primary.treeObjectId, state);
      observations.push({
        id: record.id,
        path: sourcePath,
        blobObjectId: resolved.blobObjectId,
        bytes: resolved.bytes
      });
    }
    return observations;
  } catch (error) {
    if (controller.signal.aborted) {
      systemBlocked("GITHUB_TIMEOUT", "Trusted evidence resolution exceeded its deadline.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveEvidenceWithExactObjectResolver({
  primary,
  evidence,
  limits,
  timeoutMs,
  exactObjectResolver
}) {
  const paths = evidence.map((record) => evidenceBlobPath(record.url, primary));
  let result;
  try {
    result = await exactObjectResolver(Object.freeze({
      repositoryUri: primary.repositoryUri,
      revisionObjectId: primary.revisionObjectId,
      treeObjectId: primary.treeObjectId,
      paths: Object.freeze([...paths].sort(compareUtf8)),
      timeoutMs,
      maximumFileBytes: Math.min(
        limits.maximumEvidenceBlobBytes,
        GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumFileBytes
      ),
      maximumTotalBytes: Math.min(
        limits.maximumEvidenceResolutionBytes,
        GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTotalBytes
      )
    }));
  } catch (error) {
    if (error instanceof GitHubPublicSourceError && error.code === "GITHUB_DECLARED_PATH_NOT_FOUND") {
      reject("EVIDENCE_BLOB_UNAVAILABLE", "The declared evidence path is not a regular blob in the exact source tree.");
    }
    if (error instanceof GitHubPublicSourceError && error.code === "GITHUB_RESPONSE_TOO_LARGE") {
      reject("EVIDENCE_RESPONSE_LIMIT", "Declared evidence exceeds the trusted inert-content limit.");
    }
    throw error;
  }

  const records = result instanceof Map ? result : result?.records;
  if (!(records instanceof Map) || records.size !== paths.length) {
    systemBlocked("EVIDENCE_OBSERVATION_INVALID", "The trusted exact evidence resolver returned an invalid path set.");
  }
  const expectedPaths = new Set(paths);
  for (const filePath of records.keys()) {
    if (!expectedPaths.has(filePath)) {
      systemBlocked("EVIDENCE_OBSERVATION_INVALID", "The trusted exact evidence resolver returned an undeclared path.");
    }
  }

  return evidence.map((record, index) => {
    const filePath = paths[index];
    const exactRecord = records.get(filePath);
    if (!isEvidenceExactObjectRecord(exactRecord)) {
      reject("EVIDENCE_BLOB_UNAVAILABLE", "The declared evidence path is not a regular blob in the exact source tree.");
    }
    const bytes = Buffer.from(exactRecord.bytes);
    if (bytes.length > limits.maximumEvidenceBlobBytes) {
      reject("EVIDENCE_BLOB_UNAVAILABLE", "The declared evidence blob exceeds the trusted byte limit.");
    }
    const observedObjectId = crypto.createHash("sha1")
      .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
      .update(bytes)
      .digest("hex");
    if (observedObjectId !== exactRecord.objectId) {
      systemBlocked("EVIDENCE_BLOB_INVALID", "Exact evidence bytes did not match their Git blob object id.");
    }
    return {
      id: record.id,
      path: filePath,
      blobObjectId: exactRecord.objectId,
      bytes
    };
  });
}

function isEvidenceExactObjectRecord(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort(compareUtf8);
  return arraysEqual(keys, ["bytes", "mode", "objectId"])
    && (value.mode === "100644" || value.mode === "100755")
    && SHA1_PATTERN.test(value.objectId ?? "")
    && value.bytes instanceof Uint8Array;
}

async function resolveEvidenceBlob(sourcePath, rootTreeObjectId, state) {
  const entries = await loadEvidenceRecursiveTree(rootTreeObjectId, state);
  const entry = entries.get(sourcePath);
  if (entry?.type !== "blob") {
    reject("EVIDENCE_BLOB_UNAVAILABLE", "The declared evidence path is not a blob in the exact source tree.");
  }
  const blobObjectId = entry.sha;
  const bytes = await loadEvidenceBlob(blobObjectId, state);
  return { blobObjectId, bytes };
}

async function loadEvidenceRecursiveTree(treeObjectId, state) {
  if (state.recursiveTree !== null) return state.recursiveTree;
  const tree = await requestEvidenceGitHubJson(
    `/repos/${state.owner}/${state.repositoryName}/git/trees/${treeObjectId}?recursive=1`,
    8 * 1024 * 1024,
    state
  );
  if (tree.sha !== treeObjectId || tree.truncated !== false || !Array.isArray(tree.tree)) {
    systemBlocked("EVIDENCE_TREE_INVALID", "GitHub could not provide a complete exact tree for REST evidence fallback.");
  }
  if (tree.tree.length > state.limits.maximumEvidenceTreeEntries) {
    reject("EVIDENCE_TREE_TOO_LARGE", "An evidence tree exceeds the trusted entry limit.");
  }
  const entries = new Map();
  for (const entry of tree.tree) {
    if (
      !isPlainObject(entry)
      || typeof entry.path !== "string"
      || entry.path.length === 0
      || !isCanonicalGitHubRepositoryPathV1(entry.path)
      || !new Set(["blob", "tree", "commit"]).has(entry.type)
      || !SHA1_PATTERN.test(entry.sha ?? "")
    ) {
      systemBlocked("EVIDENCE_TREE_INVALID", "GitHub returned a malformed direct tree entry.");
    }
    if (entries.has(entry.path)) {
      systemBlocked("EVIDENCE_TREE_INVALID", "GitHub returned duplicate direct tree entries.");
    }
    entries.set(entry.path, { type: entry.type, sha: entry.sha });
  }
  state.recursiveTree = entries;
  return entries;
}

async function loadEvidenceBlob(blobObjectId, state) {
  if (state.blobCache.has(blobObjectId)) return state.blobCache.get(blobObjectId);
  const blob = await requestEvidenceGitHubJson(
    `/repos/${state.owner}/${state.repositoryName}/git/blobs/${blobObjectId}`,
    Math.min(state.limits.maximumEvidenceResolutionBytes, 12 * 1024 * 1024),
    state
  );
  if (
    blob.sha !== blobObjectId
    || blob.encoding !== "base64"
    || typeof blob.content !== "string"
    || !Number.isSafeInteger(blob.size)
    || blob.size < 0
    || blob.size > state.limits.maximumEvidenceBlobBytes
  ) {
    reject("EVIDENCE_BLOB_UNAVAILABLE", "GitHub did not return a bounded base64 blob for the declared evidence path.");
  }
  const encoded = blob.content.replace(/\n/gu, "");
  if (
    /[^A-Za-z0-9+/=\n]/u.test(blob.content)
    || encoded.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
  ) {
    systemBlocked("EVIDENCE_BLOB_INVALID", "GitHub returned malformed base64 evidence content.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== blob.size || bytes.toString("base64") !== encoded) {
    systemBlocked("EVIDENCE_BLOB_INVALID", "GitHub evidence bytes did not match their declared base64 size.");
  }
  const gitObjectId = crypto.createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
  if (gitObjectId !== blobObjectId) {
    systemBlocked("EVIDENCE_BLOB_INVALID", "GitHub evidence bytes did not match their exact Git blob object id.");
  }
  state.blobCache.set(blobObjectId, bytes);
  return bytes;
}

async function requestEvidenceGitHubJson(apiPath, maximumResponseBytes, state) {
  state.requests += 1;
  if (state.requests > state.limits.maximumEvidenceRequests) {
    systemBlocked(
      "EVIDENCE_REQUEST_LIMIT",
      "The bounded REST evidence fallback exhausted its tooling request budget."
    );
  }
  const url = `https://api.github.com${apiPath}`;
  let response;
  try {
    response = await state.transport({
      url,
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.userAgent,
        "X-GitHub-Api-Version": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion
      },
      redirect: "error",
      signal: state.controller.signal,
      maxResponseBytes: maximumResponseBytes
    });
  } catch (error) {
    if (error instanceof GitHubPublicSourceError || error instanceof PublicIntakeError) throw error;
    systemBlocked("GITHUB_NETWORK_ERROR", "GitHub evidence resolution failed at the transport boundary.");
  }
  if (!isPlainObject(response) || response.redirected === true || response.responseUrl !== url) {
    systemBlocked("GITHUB_PROTOCOL_ERROR", "GitHub evidence resolution received an invalid or redirected response.");
  }
  if (response.status !== 200) {
    if (response.status === 404 || response.status === 422) {
      reject("EVIDENCE_BLOB_UNAVAILABLE", "The declared evidence blob is unavailable from the exact source tree.");
    }
    if (response.status === 403 || response.status === 429) {
      systemBlocked("GITHUB_RATE_LIMITED", "GitHub rate-limited trusted evidence resolution.");
    }
    if (Number.isInteger(response.status) && response.status >= 500) {
      systemBlocked("GITHUB_UNAVAILABLE", "GitHub was unavailable during trusted evidence resolution.");
    }
    systemBlocked("GITHUB_UPSTREAM_REJECTED", "GitHub rejected trusted evidence resolution.");
  }
  let bytes;
  if (typeof response.body === "string") bytes = Buffer.from(response.body, "utf8");
  else if (response.body instanceof Uint8Array) bytes = Buffer.from(response.body);
  else if (response.body instanceof ArrayBuffer) bytes = Buffer.from(response.body);
  else systemBlocked("GITHUB_PROTOCOL_ERROR", "GitHub evidence response bytes were malformed.");
  if (bytes.length > maximumResponseBytes) {
    systemBlocked("GITHUB_RESPONSE_TOO_LARGE", "A GitHub evidence response exceeded its trusted byte limit.");
  }
  state.responseBytes += bytes.length;
  if (state.responseBytes > state.limits.maximumEvidenceResolutionBytes) {
    reject("EVIDENCE_RESPONSE_LIMIT", "Evidence resolution exceeded the trusted aggregate response limit.");
  }
  let source;
  try {
    source = UTF8_DECODER.decode(bytes);
  } catch {
    systemBlocked("GITHUB_PROTOCOL_ERROR", "GitHub evidence JSON was not valid UTF-8.");
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    systemBlocked("GITHUB_PROTOCOL_ERROR", "GitHub evidence response was not valid JSON.");
  }
  if (!isPlainObject(value)) {
    systemBlocked("GITHUB_PROTOCOL_ERROR", "GitHub evidence response was not a JSON object.");
  }
  return value;
}

/**
 * Anonymous, bounded transport for the trusted pull_request_target validator.
 *
 * GitHub documents GITHUB_TOKEN as an installation token whose authority is
 * limited to the workflow repository. It therefore is not a reliable
 * credential for arbitrary external public builder repositories and must not
 * be added here. The underlying public transport pins api.github.com, GET,
 * redirect rejection, fixed public headers, abort signals, and response byte
 * limits. This wrapper only adds serial pacing and one tightly bounded retry.
 */
export function createTrustedGitHubActionsPublicTransportV1({
  fetchImplementation = globalThis.fetch,
  maximumRetryBodyBytes = GITHUB_PUBLIC_TRANSPORT_DEFAULTS.maximumRetryBodyBytes,
  maximumRetryDelayMs = GITHUB_PUBLIC_TRANSPORT_DEFAULTS.maximumRetryDelayMs,
  minimumIntervalMs = GITHUB_PUBLIC_TRANSPORT_DEFAULTS.minimumIntervalMs,
  now = () => Date.now(),
  sleep = abortableDelay,
  transientRetryDelayMs = GITHUB_PUBLIC_TRANSPORT_DEFAULTS.transientRetryDelayMs
} = {}) {
  for (const [label, value, maximum] of [
    ["maximumRetryBodyBytes", maximumRetryBodyBytes, 64 * 1024],
    ["maximumRetryDelayMs", maximumRetryDelayMs, 5_000],
    ["minimumIntervalMs", minimumIntervalMs, 1_000],
    ["transientRetryDelayMs", transientRetryDelayMs, 5_000]
  ]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw new GitHubPublicSourceError("INVALID_OPTIONS", `${label} is outside the trusted transport bounds`);
    }
  }
  if (typeof now !== "function" || typeof sleep !== "function") {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "trusted transport clocks must be functions");
  }
  const maximumConfiguredDelayMs =
    ((GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumProviderRequests - 1) * minimumIntervalMs)
    + (GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumTransportRetries * maximumRetryDelayMs);
  if (maximumConfiguredDelayMs >= GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.timeoutMs) {
    throw new GitHubPublicSourceError(
      "INVALID_OPTIONS",
      "trusted transport pacing and retry delays do not fit the resolver deadline"
    );
  }

  const publicTransport = createGitHubPublicFetchTransportV1(fetchImplementation);
  let earliestNextRequestMs = 0;
  let physicalRequestsRemaining = GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumProviderRequests;
  let retriesRemaining = GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumTransportRetries;
  let schedulingTail = Promise.resolve();

  return async function trustedGitHubActionsPublicTransport(request) {
    let response = await performPublicRequest(request);
    const retryDelayMs = selectTrustedRetryDelay(response, {
      maximumRetryBodyBytes,
      maximumRetryDelayMs,
      transientRetryDelayMs
    });
    if (retryDelayMs === null || retriesRemaining <= 0) return response;

    retriesRemaining -= 1;
    await sleep(retryDelayMs, request.signal);
    response = await performPublicRequest(request);
    return response;
  };

  async function performPublicRequest(request) {
    let releaseSlot;
    const predecessor = schedulingTail;
    schedulingTail = new Promise((resolve) => { releaseSlot = resolve; });
    await predecessor;
    let responsePromise;
    try {
      if (request?.signal?.aborted) throw request.signal.reason ?? new Error("request aborted");
      const currentMs = now();
      const waitMs = Math.max(0, earliestNextRequestMs - currentMs);
      if (waitMs > 0) await sleep(waitMs, request?.signal);
      earliestNextRequestMs = Math.max(currentMs + waitMs, now()) + minimumIntervalMs;
      if (physicalRequestsRemaining <= 0) {
        throw new GitHubPublicSourceError(
          "GITHUB_RATE_LIMITED",
          "The trusted anonymous GitHub REST request budget was exhausted",
          { retryable: true }
        );
      }
      physicalRequestsRemaining -= 1;
      // Invoke fetch while this start slot is still held; release immediately
      // afterwards so response bodies may be in flight concurrently.
      responsePromise = publicTransport(request);
    } finally {
      releaseSlot();
    }
    return responsePromise;
  }
}

function selectTrustedRetryDelay(response, {
  maximumRetryBodyBytes,
  maximumRetryDelayMs,
  transientRetryDelayMs
}) {
  const bodyBytes = responseBodyByteLength(response?.body);
  if (bodyBytes === null || bodyBytes > maximumRetryBodyBytes) return null;

  if (new Set([502, 503, 504]).has(response.status)) {
    return transientRetryDelayMs <= maximumRetryDelayMs ? transientRetryDelayMs : null;
  }
  if (response.status !== 403 && response.status !== 429) return null;

  const remaining = transportHeader(response.headers, "x-ratelimit-remaining");
  if (remaining === "0") return null;
  const retryAfter = transportHeader(response.headers, "retry-after");
  if (typeof retryAfter !== "string" || !/^(?:0|[1-9][0-9]{0,2})$/u.test(retryAfter)) return null;
  const retryDelayMs = Number(retryAfter) * 1_000;
  return retryDelayMs <= maximumRetryDelayMs ? retryDelayMs : null;
}

function responseBodyByteLength(body) {
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return null;
}

function transportHeader(headers, name) {
  if (headers === null || headers === undefined) return null;
  if (typeof headers.get === "function") return headers.get(name);
  if (!isPlainObject(headers)) return null;
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return match?.[1] ?? null;
}

function abortableDelay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("request aborted"));
  return new Promise((resolve, rejectDelay) => {
    const timeout = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timeout);
      rejectDelay(signal.reason ?? new Error("request aborted"));
    }
  });
}

function validateApplicationSource(source) {
  let normalized;
  try {
    normalized = validateGitHubPublicSourceRequestV1(source);
  } catch (error) {
    if (error instanceof GitHubPublicSourceError) {
      reject("SOURCE_CONTRACT_INVALID", "application.source does not satisfy GitHubPublicSourceContractV1.");
    }
    throw error;
  }

  const requestedRepositories = [source.primary, ...source.companions];
  const normalizedRepositories = [normalized.primary, ...normalized.companions];
  for (let index = 0; index < requestedRepositories.length; index += 1) {
    const requested = requestedRepositories[index];
    const canonical = normalizedRepositories[index];
    if (
      requested.numericRepositoryId !== canonical.numericRepositoryId
      || requested.repositoryUri !== canonical.repositoryUri
      || !arraysEqual(requested.sourcePaths ?? [], canonical.sourcePaths)
      || !arraysEqual(requested.contractPaths ?? [], canonical.contractPaths)
      || !arraysEqual(requested.githubActionsRunIds ?? [], canonical.githubActionsRunIds)
    ) {
      reject("SOURCE_CONTRACT_ORDER_INVALID", "application.source arrays and companions must use the contract's unsigned UTF-8 order.");
    }
  }
}

function translateSourceResolutionError(error) {
  if (error instanceof PublicIntakeError) throw error;
  if (!(error instanceof GitHubPublicSourceError)) {
    systemBlocked("SOURCE_RESOLUTION_FAILED", "The trusted GitHubPublicSourceContractV1 resolver failed unexpectedly.");
  }
  if (
    error.code === "GITHUB_UPSTREAM_REJECTED"
    && error.message.startsWith("Exact Git object tooling is unavailable:")
  ) {
    systemBlocked("TOOLING_BLOCKED", "The trusted runner cannot safely resolve exact public Git objects.");
  }
  const candidateCodes = new Set([
    "GITHUB_ACTIONS_RUN_MISMATCH",
    "GITHUB_ACTIONS_RUN_NOT_REACHABLE",
    "GITHUB_ACTIONS_WORKFLOW_NOT_IN_TREE",
    "GITHUB_COMMIT_MISMATCH",
    "GITHUB_COMMIT_NOT_REACHABLE",
    "GITHUB_DECLARED_PATH_NOT_FOUND",
    "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE",
    "GITHUB_REDIRECT_REJECTED",
    "GITHUB_REPOSITORY_ID_MISMATCH",
    "GITHUB_REPOSITORY_LOCATOR_MISMATCH",
    "GITHUB_TREE_MISMATCH",
    "GITHUB_TREE_NOT_REACHABLE",
    "INVALID_REQUEST"
  ]);
  if (candidateCodes.has(error.code)) {
    reject(error.code, "The declared public GitHub source did not resolve to its exact frozen authority.");
  }
  systemBlocked(error.code, "The trusted GitHubPublicSourceContractV1 resolver could not complete.");
}

function translateEvidenceResolutionError(error) {
  if (error instanceof PublicIntakeError) throw error;
  if (error instanceof GitHubPublicSourceError) translateSourceResolutionError(error);
  systemBlocked("EVIDENCE_RESOLUTION_FAILED", "The trusted public-evidence resolver failed unexpectedly.");
}

function validateSourceObservation(request, observation) {
  if (
    !isPlainObject(observation)
    || observation.schemaVersion !== GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion
    || observation.kind !== GITHUB_PUBLIC_SOURCE_CONTRACT_V1.kind
    || observation.canonicalProviderOrigin !== GITHUB_PUBLIC_SOURCE_CONTRACT_V1.canonicalProviderOrigin
    || observation.githubApiVersion !== GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion
    || !Array.isArray(observation.companions)
  ) {
    systemBlocked("SOURCE_OBSERVATION_INVALID", "The trusted resolver returned an invalid GitHubPublicSourceContractV1 observation.");
  }
  const expected = [request.primary, ...request.companions];
  const observed = [observation.primary, ...observation.companions];
  if (expected.length !== observed.length) {
    systemBlocked("SOURCE_OBSERVATION_INVALID", "The trusted resolver returned the wrong number of source observations.");
  }
  expected.forEach((binding, index) => validateRepositoryObservation(binding, observed[index], index === 0 ? "primary" : "companion"));
}

function validateRepositoryObservation(binding, observation, expectedRole) {
  if (!isPlainObject(observation) || !isPlainObject(observation.authority) || !isPlainObject(observation.display)) {
    systemBlocked("SOURCE_OBSERVATION_INVALID", "The trusted resolver returned a malformed repository observation.");
  }
  if (observation.role !== expectedRole) systemBlocked("SOURCE_OBSERVATION_INVALID", "The trusted resolver returned an invalid repository role.");
  if (observation.visibility !== "public") reject("GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE", "Every builder-beta source repository must resolve as public.");
  if (observation.display.repositoryUri !== binding.repositoryUri) reject("GITHUB_REPOSITORY_LOCATOR_MISMATCH", "GitHub resolved a different canonical repository URI.");
  if (observation.authority.numericRepositoryId !== binding.numericRepositoryId) reject("GITHUB_REPOSITORY_ID_MISMATCH", "GitHub resolved a different numeric repository id.");
  if (observation.authority.revisionObjectId !== binding.revisionObjectId) reject("GITHUB_COMMIT_MISMATCH", "GitHub did not resolve the declared source revision.");
  if (observation.authority.treeObjectId !== binding.treeObjectId) reject("GITHUB_TREE_MISMATCH", "GitHub resolved a different root tree for the declared revision.");
  if (
    !arraysEqual(observation.sourcePaths ?? [], binding.sourcePaths ?? [])
    || !arraysEqual(observation.contractPaths ?? [], binding.contractPaths ?? [])
    || !Array.isArray(observation.githubActionsEvidence)
    || observation.githubActionsEvidence.length !== (binding.githubActionsRunIds ?? []).length
  ) {
    systemBlocked("SOURCE_OBSERVATION_INVALID", "The trusted resolver returned incomplete path or Actions observations.");
  }
  observation.githubActionsEvidence.forEach((entry, index) => {
    validateActionsObservation(entry, binding, binding.githubActionsRunIds[index]);
  });
}

function validateActionsObservation(observation, binding, expectedRunId) {
  if (
    !isPlainObject(observation)
    || !OPAQUE_ID_PATTERN.test(observation.runId ?? "")
    || !OPAQUE_ID_PATTERN.test(observation.runAttempt ?? "")
    || !OPAQUE_ID_PATTERN.test(observation.workflowId ?? "")
    || typeof observation.workflowPath !== "string"
    || !SAFE_CODE_PATTERN.test(observation.event ?? "")
    || !SAFE_CODE_PATTERN.test(observation.status ?? "")
    || (observation.conclusion !== null && !SAFE_CODE_PATTERN.test(observation.conclusion ?? ""))
  ) {
    systemBlocked("SOURCE_OBSERVATION_INVALID", "The trusted resolver returned a malformed GitHub Actions observation.");
  }
  try {
    validateSourcePath(observation.workflowPath);
  } catch (error) {
    if (error instanceof PublicIntakeError) {
      systemBlocked("SOURCE_OBSERVATION_INVALID", "The trusted resolver returned an unsafe GitHub Actions workflow path.");
    }
    throw error;
  }
  if (
    !observation.workflowPath.startsWith(".github/workflows/")
    || !/\.ya?ml$/u.test(observation.workflowPath)
  ) {
    systemBlocked("SOURCE_OBSERVATION_INVALID", "The trusted resolver returned an invalid GitHub Actions workflow path.");
  }
  const expectedUrl = `${binding.repositoryUri}/actions/runs/${expectedRunId}`;
  if (
    observation.runId !== expectedRunId
    || observation.headRevision !== binding.revisionObjectId
    || observation.headTree !== binding.treeObjectId
    || observation.htmlUrl !== expectedUrl
  ) {
    reject("GITHUB_ACTIONS_RUN_MISMATCH", "GitHub Actions evidence did not match its exact run, attempt, commit, tree, or repository.");
  }
}

function validateEvidenceObservations({
  application,
  compatibility,
  evidenceIndex,
  sourceObservation,
  blobObservations
}) {
  if (!Array.isArray(blobObservations)) {
    systemBlocked("EVIDENCE_OBSERVATION_INVALID", "The trusted evidence resolver returned a malformed observation list.");
  }
  const primary = application.source.primary;
  const expectedBlobs = evidenceIndex.evidence.filter((record) =>
    validateGitHubEvidenceUrl(record.url, "evidence.url", primary) === "blob"
  );
  if (blobObservations.length !== expectedBlobs.length) {
    systemBlocked("EVIDENCE_OBSERVATION_INVALID", "The trusted evidence resolver returned the wrong number of blob observations.");
  }
  const blobBindings = new Map();
  expectedBlobs.forEach((record, index) => {
    const observation = blobObservations[index];
    const expectedPath = evidenceBlobPath(record.url, primary);
    if (
      !isPlainObject(observation)
      || observation.id !== record.id
      || observation.path !== expectedPath
      || !SHA1_PATTERN.test(observation.blobObjectId ?? "")
      || !Buffer.isBuffer(observation.bytes)
    ) {
      systemBlocked("EVIDENCE_OBSERVATION_INVALID", "The trusted evidence resolver returned a malformed blob observation.");
    }
    const gitObjectId = crypto.createHash("sha1")
      .update(Buffer.from(`blob ${observation.bytes.length}\0`, "utf8"))
      .update(observation.bytes)
      .digest("hex");
    if (gitObjectId !== observation.blobObjectId) {
      systemBlocked("EVIDENCE_OBSERVATION_INVALID", "Resolved evidence bytes do not match their immutable Git blob object id.");
    }
    const digest = `sha256:${crypto.createHash("sha256").update(observation.bytes).digest("hex")}`;
    if (digest !== record.sha256) {
      reject("EVIDENCE_BLOB_DIGEST_MISMATCH", "Resolved GitHub evidence bytes do not match the declared SHA-256 digest.");
    }
    blobBindings.set(record.id, {
      id: record.id,
      kind: record.kind,
      declaredStatus: record.status,
      statusAuthority: "builder-declared-untrusted",
      identityAuthority: "github-observed",
      location: "blob",
      path: expectedPath,
      blobObjectId: observation.blobObjectId,
      sha256: digest
    });
  });

  const actionObservations = new Map(
    sourceObservation.primary.githubActionsEvidence.map((observation) => [observation.runId, observation])
  );
  const actionBindings = new Map();
  for (const record of evidenceIndex.evidence) {
    if (validateGitHubEvidenceUrl(record.url, "evidence.url", primary) !== "actions") continue;
    const runId = record.url.slice(record.url.lastIndexOf("/") + 1);
    const observation = actionObservations.get(runId);
    if (!observation) {
      systemBlocked("EVIDENCE_OBSERVATION_INVALID", "The trusted source resolver omitted a declared GitHub Actions run.");
    }
    validateActionEvidenceStatus(record.status, observation.status, observation.conclusion);
    actionBindings.set(record.id, {
      id: record.id,
      kind: record.kind,
      declaredStatus: record.status,
      statusAuthority: "github-observed",
      identityAuthority: "github-observed",
      location: "github-actions",
      runId: observation.runId,
      runAttempt: observation.runAttempt,
      workflowId: observation.workflowId,
      workflowPath: observation.workflowPath,
      headRevision: observation.headRevision,
      headTree: observation.headTree,
      event: observation.event,
      status: observation.status,
      conclusion: observation.conclusion,
      htmlUrl: observation.htmlUrl
    });
  }
  if (compatibility.result === "prototype-ready" && actionBindings.size === 0) {
    reject(
      "COMPATIBILITY_EVIDENCE_MISMATCH",
      "Prototype-ready compatibility requires an exact successful GitHub Actions observation."
    );
  }
  return evidenceIndex.evidence.map((record) => blobBindings.get(record.id) ?? actionBindings.get(record.id));
}

function validateActionEvidenceStatus(declaredStatus, status, conclusion) {
  const nonCompletedStatuses = new Set(["queued", "in_progress", "pending", "requested", "waiting"]);
  const failedConclusions = new Set(["failure", "startup_failure", "timed_out"]);
  const blockedConclusions = new Set(["action_required", "cancelled", "stale"]);
  let matches = false;
  if (declaredStatus === "passed") matches = status === "completed" && conclusion === "success";
  else if (declaredStatus === "failed") matches = status === "completed" && failedConclusions.has(conclusion);
  else if (declaredStatus === "blocked") {
    matches = (nonCompletedStatuses.has(status) && conclusion === null)
      || (status === "completed" && blockedConclusions.has(conclusion));
  } else if (declaredStatus === "not-run") {
    matches = status === "completed" && conclusion === "skipped";
  }
  if (!matches) {
    reject(
      "EVIDENCE_ACTION_STATUS_MISMATCH",
      "A builder-declared GitHub Actions evidence status does not match the exact run attempt outcome."
    );
  }
}

function sourceAuthorityProjection(source) {
  const project = (repository) => ({
    repositoryUri: repository.repositoryUri,
    numericRepositoryId: repository.numericRepositoryId,
    revisionObjectId: repository.revisionObjectId,
    treeObjectId: repository.treeObjectId
  });
  return {
    schemaVersion: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion,
    primary: project(source.primary),
    companions: source.companions.map(project)
  };
}

function validateSourcePath(value) {
  if (!isCanonicalGitHubRepositoryPathV1(value)) {
    reject("SOURCE_PATH_INVALID", "A declared source path is outside the safe canonical path subset.");
  }
}

function validateFindingPath(value) {
  if (value === "$" || (typeof value === "string" && value.startsWith("$.") && value.length <= 240 && !CONTROL_OR_BIDI_PATTERN.test(value))) return;
  if (typeof value === "string") {
    try {
      validateSourcePath(value);
      return;
    } catch (error) {
      if (!(error instanceof PublicIntakeError)) throw error;
    }
  }
  reject("FINDING_PATH_INVALID", "A finding path is neither a canonical JSON path nor a safe source path.");
}

function validateSortedUniqueStrings(value, minimum, maximum, label, validateEntry) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    reject("ARRAY_LENGTH_INVALID", `${label} has an invalid item count.`);
  }
  let previous = null;
  for (const entry of value) {
    validateEntry(entry);
    if (previous !== null && compareUtf8(previous, entry) >= 0) reject("ARRAY_ORDER_INVALID", `${label} must be sorted and unique.`);
    previous = entry;
  }
}

function expectClosedObject(value, expectedKeys, label) {
  if (!isPlainObject(value)) reject("OBJECT_REQUIRED", `${label} must be an object.`);
  const observed = Object.keys(value).sort(compareUtf8);
  const expected = [...expectedKeys].sort(compareUtf8);
  if (!arraysEqual(observed, expected)) reject("OBJECT_NOT_CLOSED", `${label} has missing or unsupported properties.`);
}

function expectInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject("INTEGER_INVALID", `${label} is outside its integer bounds.`);
}

function expectPattern(value, pattern, maximumLength, label) {
  if (typeof value !== "string" || value.length > maximumLength || !pattern.test(value)) reject("STRING_PATTERN_INVALID", `${label} has an invalid canonical format.`);
}

function expectText(value, minimumLength, maximumLength, label) {
  if (
    typeof value !== "string"
    || value.length < minimumLength
    || value.length > maximumLength
    || value.trim() !== value
    || CONTROL_OR_BIDI_PATTERN.test(value)
  ) {
    reject("TEXT_INVALID", `${label} is empty, oversized, padded, or contains unsafe characters.`);
  }
}

function validatePublicHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    reject("URL_INVALID", `${label} is not a valid public HTTPS URL.`);
  }
  if (value.length > 500 || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    reject("URL_INVALID", `${label} must be a credential-free public HTTPS URL without a fragment.`);
  }
}

function validateGitHubEvidenceUrl(value, label, primary) {
  validatePublicHttpsUrl(value, label);
  const blobUrls = new Set((primary.sourcePaths ?? []).map((sourcePath) =>
    `${primary.repositoryUri}/blob/${primary.revisionObjectId}/${encodeGitHubPath(sourcePath)}`
  ));
  if (blobUrls.has(value)) return "blob";
  const actionUrls = new Set((primary.githubActionsRunIds ?? []).map((runId) =>
    `${primary.repositoryUri}/actions/runs/${runId}`
  ));
  if (actionUrls.has(value)) return "actions";
  reject(
    "EVIDENCE_URL_SOURCE_MISMATCH",
    "Evidence must be an exact primary-repository blob at the declared commit or a declared GitHub Actions run."
  );
}

function evidenceBlobPath(value, primary) {
  for (const sourcePath of primary.sourcePaths ?? []) {
    if (value === `${primary.repositoryUri}/blob/${primary.revisionObjectId}/${encodeGitHubPath(sourcePath)}`) {
      return sourcePath;
    }
  }
  systemBlocked("EVIDENCE_RESOLUTION_INPUT_INVALID", "Trusted blob evidence was not bound to a declared source path.");
}

function encodeGitHubPath(value) {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function runGitText(root, args, maximumBytes) {
  return UTF8_DECODER.decode(runGit(root, args, maximumBytes));
}

function runGit(root, args, maximumBytes) {
  const result = childProcess.spawnSync(
    "git",
    [
      "-c", "core.hooksPath=/dev/null",
      "-c", "credential.helper=",
      "-C", root,
      ...args
    ],
    {
      encoding: null,
      shell: false,
      maxBuffer: maximumBytes,
      timeout: TRUSTED_GIT_TIMEOUT_MS,
      killSignal: "SIGKILL",
      env: trustedGitEnvironment()
    }
  );
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    systemBlocked("GIT_COMMAND_FAILED", "A fixed trusted Git inspection command failed.");
  }
  return result.stdout;
}

function trustedGitEnvironment() {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(?:GIT_|SSH_)/u.test(key))
  );
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0"
  };
}
