import fs from "node:fs";
import { TextDecoder } from "node:util";

import { normalizeBuilderTemplate } from "./builder-template-contract.mjs";
import { validateGitHubPublicSourceRequestV1 } from "./github-public-source-core.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import { parseBoundedStrictJson } from "./strict-json-core.mjs";

import {
  APPLICATION_COMPATIBILITY_RESULTS,
  CENTRAL_APPLICATION_FILES,
  CENTRAL_BASE_BRANCH,
  CENTRAL_REPOSITORY,
  DIGEST_PATTERN,
  GITHUB_APPLICATION_CLIENT_VERSION,
  MAX_CENTRAL_FILE_BYTES,
  MAX_CENTRAL_PACKAGE_BYTES,
  MAX_PREPARED_BYTES
} from "./github-application-constants.mjs";

import {
  arraysEqual,
  compareUtf8,
  fail,
  invalidPrepared,
  isPlainObject,
  normalizeNullableRevision,
  pathsOverlap,
  requireApplicationId,
  requireBoundedMultilineText,
  requireBoundedText,
  requireBranch,
  requireCommit,
  requireGitHubLogin,
  requireGitHubRepositoryUrl,
  requireObject,
  requireOpaqueDecimal,
  requireRepositorySlug,
  requireRevision,
  resolveDirectory,
  resolveRegularFile,
  sha256Bytes,
  sha256Canonical
} from "./github-application-primitives.mjs";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const normalizedPreparedValues = new WeakSet();

export function buildCanonicalApplicationPullRequestBody({
  applicationId,
  stage,
  sourceRepositorySlug,
  sourceRepositoryUrl,
  builderGitHubLogin,
  builderGitHubUserId,
  sourceRepositoryId,
  companionCount,
  centralBaseCommit,
  applicationRevision,
  sourceCommit,
  sourceTree,
  compatibilityResult,
  centralFileCount
}) {
  const checklist = [
    { id: "clean-worktree", checked: true, label: "The exact revision was prepared from a clean Git worktree." },
    { id: "pushed-revision", checked: true, label: "HEAD equals the configured upstream revision." },
    { id: "public-github", checked: true, label: "GitHub independently resolved the numeric repository id, commit and tree." },
    { id: "package-gate", checked: true, label: "The deterministic public intake package gate passed." },
    { id: "human-review", checked: false, label: "I reviewed the generated title, body, source and evidence." },
    { id: "open-draft-pr", checked: false, label: "I explicitly authorize opening the draft pull request." }
  ];
  const body = [
    "## Builder submission",
    "",
    `- Model: \`${applicationId}\``,
    `- Stage: \`${stage}\``,
    `- Source repository: \`${sourceRepositorySlug}\` (${sourceRepositoryUrl})`,
    `- Builder GitHub identity: \`${builderGitHubLogin}\` (immutable user id \`${builderGitHubUserId}\`)`,
    `- GitHub repository id: \`${sourceRepositoryId}\``,
    `- Companion repositories: \`${companionCount}\` exact public bindings`,
    `- Central target: \`${CENTRAL_REPOSITORY}:${CENTRAL_BASE_BRANCH}\` at \`${centralBaseCommit}\``,
    `- Central application target: \`submissions/${applicationId}/application.json\``,
    `- Application revision: \`${applicationRevision}\``,
    `- Source head commit: \`${sourceCommit}\``,
    `- Source head tree: \`${sourceTree}\``,
    `- Application result: \`${compatibilityResult}\``,
    `- Central package: \`${centralFileCount}\` files in frozen validator order`,
    "",
    "## Confirmation checklist",
    "",
    ...checklist.map(({ checked, label }) => `- [${checked ? "x" : " "}] ${label}`),
    "",
    "The complete six-file central package is embedded in the machine-readable output and was not written to the central repository.",
    "This body was prepared locally. No branch was pushed and no pull request was opened by `prepare-pr`.",
    "Passing intake checks is not acceptance, an audit, deployment evidence, routing approval, or availability."
  ].join("\n");
  return Object.freeze({ body, checklist: Object.freeze(checklist.map((entry) => Object.freeze(entry))) });
}

export function loadPreparedApplication(inputPath, { sourceRepositoryRoot = null } = {}) {
  const preparedPath = resolveRegularFile(inputPath, "prepared application result");
  const stat = fs.statSync(preparedPath);
  if (stat.size < 2 || stat.size > MAX_PREPARED_BYTES) {
    fail("PREPARED_RESULT_INVALID", "the prepared application result exceeds the bounded input size");
  }
  if (sourceRepositoryRoot !== null) {
    const repositoryRoot = resolveDirectory(sourceRepositoryRoot, "source repository root");
    if (pathsOverlap(repositoryRoot, preparedPath)) {
      fail(
        "PREPARED_RESULT_PATH_INVALID",
        "the prepare-pr result must be stored completely outside the source repository"
      );
    }
  }
  let document;
  let source;
  try {
    source = utf8Decoder.decode(fs.readFileSync(preparedPath));
    document = parseBoundedStrictJson(source, {
      maxSourceBytes: MAX_PREPARED_BYTES,
      maxDepth: 256,
      maxNodes: 250_000,
      maxNumberCharacters: MAX_PREPARED_BYTES
    });
  } catch {
    fail("PREPARED_RESULT_INVALID", "the prepared application result is not valid UTF-8 JSON");
  }
  if (source !== `${canonicalJson(document)}\n`) {
    fail("PREPARED_RESULT_INVALID", "the prepared application result must be canonical JSON with one final newline");
  }
  return normalizePreparedApplication(document);
}

export function normalizePreparedApplication(input) {
  if (isPlainObject(input) && normalizedPreparedValues.has(input)) return input;
  const document = unwrapPreparePrResult(input);
  if (!isPlainObject(document)) invalidPrepared("the prepare-pr result is not an object");
  if (document.requiresHumanConfirmation !== true) {
    invalidPrepared("the prepare-pr result does not retain the human-confirmation boundary");
  }
  if (!Array.isArray(document.externalActionsPerformed) || document.externalActionsPerformed.length !== 0) {
    invalidPrepared("the prepare-pr result already claims an external action");
  }

  const sourceHead = requireObject(document.sourceHead, "sourceHead");
  const centralTarget = requireObject(document.centralPullRequestTarget, "centralPullRequestTarget");
  const github = requireObject(document.github, "github");
  const submission = requireObject(document.submission, "submission");
  const centralPackage = requireObject(document.centralPackage, "centralPackage");
  const applicationAdapter = requireObject(document.applicationAdapter, "applicationAdapter");
  const applicationId = requireApplicationId(submission.modelId, "submission.modelId");
  const applicationDirectory = `submissions/${applicationId}`;

  if (
    centralTarget.repositorySlug !== CENTRAL_REPOSITORY
    || centralTarget.repositoryUrl !== `https://github.com/${CENTRAL_REPOSITORY}`
    || centralTarget.baseBranch !== CENTRAL_BASE_BRANCH
    || centralTarget.applicationDirectory !== applicationDirectory
    || centralTarget.applicationPath !== `${applicationDirectory}/application.json`
  ) {
    invalidPrepared("the prepare-pr result does not target the fixed Submit a Launch repository and path");
  }
  const centralBaseCommit = requireCommit(centralTarget.baseCommit, "central base commit");
  const centralBaseTree = requireCommit(centralTarget.baseTree, "central base tree");
  const sourceCommit = requireCommit(sourceHead.commit, "source commit");
  const sourceTree = requireCommit(sourceHead.tree, "source tree");
  const sourceBranch = requireBranch(sourceHead.upstreamBranch, "source upstream branch");
  const sourceRepository = requireRepositorySlug(sourceHead.repositorySlug, "source repository");
  const sourceRepositoryUrl = requireGitHubRepositoryUrl(sourceHead.repositoryUrl, sourceRepository);

  if (
    github.repositorySlug !== sourceRepository
    || github.repositoryUrl !== sourceRepositoryUrl
    || github.publicCommitReachable !== true
  ) {
    invalidPrepared("the GitHub source projection disagrees with sourceHead");
  }
  const sourceRepositoryId = requireOpaqueDecimal(github.repositoryId, "source repository id");
  const sourceRequest = requireObject(github.sourceRequest, "github.sourceRequest");
  let canonicalSourceRequest;
  try {
    canonicalSourceRequest = validateGitHubPublicSourceRequestV1(sourceRequest);
  } catch {
    invalidPrepared("the public GitHub source request is not canonical");
  }
  const primarySource = requireObject(canonicalSourceRequest.primary, "github.sourceRequest.primary");
  const sourceWorkflowRunIds = normalizeActionRunIds(
    primarySource.githubActionsRunIds ?? [],
    "primary source GitHub Actions run ids"
  );
  if (
    primarySource.repositoryUri !== sourceRepositoryUrl
    || requireOpaqueDecimal(primarySource.numericRepositoryId, "primary source repository id") !== sourceRepositoryId
    || requireCommit(primarySource.revisionObjectId, "primary source commit") !== sourceCommit
    || requireCommit(primarySource.treeObjectId, "primary source tree") !== sourceTree
  ) {
    invalidPrepared("the primary source request disagrees with the exact source repository, commit, or tree");
  }

  if (
    centralPackage.targetDirectory !== applicationDirectory
    || !APPLICATION_COMPATIBILITY_RESULTS.includes(centralPackage.compatibilityResult)
    || centralPackage.fileCount !== CENTRAL_APPLICATION_FILES.length
    || !arraysEqual(centralPackage.fileOrder, CENTRAL_APPLICATION_FILES)
    || centralPackage.encoding !== "utf8"
    || centralPackage.generated !== true
    || centralPackage.validatorContract !== "public-pr-application-v2"
    || !Array.isArray(centralPackage.files)
    || centralPackage.files.length !== CENTRAL_APPLICATION_FILES.length
  ) {
    invalidPrepared("the central package is not the closed six-file public beta package");
  }

  const files = centralPackage.files.map((record, index) => normalizeCentralFile(record, CENTRAL_APPLICATION_FILES[index]));
  if (files.reduce((total, record) => total + record.byteLength, 0) > MAX_CENTRAL_PACKAGE_BYTES) {
    invalidPrepared("the central package exceeds the trusted public beta package limit");
  }
  const fileMap = new Map(files.map((record) => [record.path, record]));
  const application = parseJsonFile(fileMap.get("application.json"), "application.json");
  const compatibility = parseJsonFile(fileMap.get("compatibility-report.json"), "compatibility-report.json");
  if (compatibility.result !== centralPackage.compatibilityResult) {
    invalidPrepared("the central-package compatibility result disagrees with compatibility-report.json");
  }
  validateApplicationProjection({
    application,
    applicationId,
    files: fileMap,
    sourceRepository,
    sourceRepositoryUrl,
    sourceRepositoryId,
    sourceCommit,
    sourceTree,
    sourceRequest: canonicalSourceRequest,
    centralPackage,
    centralTarget,
    submission,
    applicationAdapter
  });

  const builderGitHubUserId = requireOpaqueDecimal(application.builder?.githubUserId, "builder GitHub user id");
  const builderGitHubLogin = requireGitHubLogin(application.builder?.githubLogin, "builder GitHub login");
  const title = requireBoundedText(document.title, "pull-request title", 200);
  if (title !== `[Builder Beta] ${applicationId}`) {
    invalidPrepared("the pull-request title is not the canonical Builder Beta title");
  }
  const body = requireBoundedMultilineText(document.body, "pull-request body", 64_000);
  const expectedBody = buildCanonicalApplicationPullRequestBody({
    applicationId,
    stage: application.stage,
    sourceRepositorySlug: sourceRepository,
    sourceRepositoryUrl,
    builderGitHubLogin,
    builderGitHubUserId,
    sourceRepositoryId,
    companionCount: canonicalSourceRequest.companions.length,
    centralBaseCommit,
    applicationRevision: application.applicationRevision,
    sourceCommit,
    sourceTree,
    compatibilityResult: centralPackage.compatibilityResult,
    centralFileCount: centralPackage.fileCount
  }).body;
  if (body !== expectedBody) {
    invalidPrepared("the pull-request body is not the canonical application summary");
  }
  const confirmedBody = confirmPreparedBody(body);
  const applicationRevision = application.applicationRevision;
  const branch = requireBranch(`programmable-builder/${applicationId}`, "application branch");
  const companionSources = normalizeCompanionSources(canonicalSourceRequest.companions, sourceRepositoryId);
  const packageFiles = files.map((record) => Object.freeze({
    path: `${applicationDirectory}/${record.path}`,
    relativePath: record.path,
    content: record.content,
    byteLength: record.byteLength,
    sha256: record.sha256
  }));
  const packageDigest = sha256Canonical({
    applicationDirectory,
    applicationRevision,
    files: packageFiles.map(({ relativePath, byteLength, sha256 }) => ({
      path: relativePath,
      byteLength,
      sha256
    }))
  });

  const normalized = Object.freeze({
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    applicationId,
    applicationRevision,
    applicationDirectory,
    title,
    body: confirmedBody,
    bodySha256: sha256Bytes(Buffer.from(confirmedBody, "utf8")),
    branch,
    source: Object.freeze({
      repositorySlug: sourceRepository,
      repositoryUrl: sourceRepositoryUrl,
      numericRepositoryId: sourceRepositoryId,
      branch: sourceBranch,
      commit: sourceCommit,
      tree: sourceTree,
      githubActionsRunIds: sourceWorkflowRunIds,
      writeAccessMeaning: "revision-control-evidence-only-not-repository-admin-ownership"
    }),
    builder: Object.freeze({
      githubUserId: builderGitHubUserId,
      githubLogin: builderGitHubLogin
    }),
    companions: Object.freeze(companionSources),
    central: Object.freeze({
      repositorySlug: CENTRAL_REPOSITORY,
      repositoryUrl: `https://github.com/${CENTRAL_REPOSITORY}`,
      baseBranch: CENTRAL_BASE_BRANCH,
      baseCommit: centralBaseCommit,
      baseTree: centralBaseTree,
      priorApplicationRevision: normalizeNullableRevision(centralTarget.priorApplicationRevision),
      nextApplicationRevision: requireRevision(centralTarget.nextApplicationRevision, "next application revision")
    }),
    package: Object.freeze({
      digest: packageDigest,
      compatibilityResult: centralPackage.compatibilityResult,
      files: Object.freeze(packageFiles)
    })
  });
  normalizedPreparedValues.add(normalized);
  return normalized;
}


function validateApplicationProjection({
  application,
  applicationId,
  files,
  sourceRepositoryUrl,
  sourceRepositoryId,
  sourceCommit,
  sourceTree,
  sourceRequest,
  centralPackage,
  centralTarget,
  submission,
  applicationAdapter
}) {
  if (
    !isPlainObject(application)
    || application.schemaVersion !== 2
    || application.applicationId !== applicationId
    || requireRevision(application.applicationRevision, "application revision") !== centralPackage.applicationRevision
    || application.applicationRevision !== centralTarget.nextApplicationRevision
    || application.applicationRevision !== applicationAdapter.applicationRevision
    || submission.intakeValidated !== true
    || applicationAdapter.publicGitHubApplicationReady !== true
    || applicationAdapter.schemaStatus !== "validator-compatible-six-file-package"
  ) {
    invalidPrepared("application.json disagrees with the prepare-pr application projection");
  }
  try {
    application.builderTemplate = normalizeBuilderTemplate(application.builderTemplate);
  } catch {
    invalidPrepared("application.json contains invalid builder-template provenance");
  }
  const primary = requireObject(application.source, "application source").primary;
  if (
    !isPlainObject(primary)
    || primary.repositoryUri !== sourceRepositoryUrl
    || requireOpaqueDecimal(primary.numericRepositoryId, "application source repository id") !== sourceRepositoryId
    || requireCommit(primary.revisionObjectId, "application source commit") !== sourceCommit
    || requireCommit(primary.treeObjectId, "application source tree") !== sourceTree
    || canonicalJson(application.source) !== canonicalJson(sourceRequest)
  ) {
    invalidPrepared("application.json is not bound to the exact prepared source request");
  }
  if (!Array.isArray(application.reviewPackage) || application.reviewPackage.length !== 5) {
    invalidPrepared("application.json does not bind the five review-package files");
  }
  const expectedReviewFiles = CENTRAL_APPLICATION_FILES.slice(1);
  for (let index = 0; index < expectedReviewFiles.length; index += 1) {
    const record = application.reviewPackage[index];
    const expected = files.get(expectedReviewFiles[index]);
    if (
      !isPlainObject(record)
      || record.path !== expected.path
      || record.byteLength !== expected.byteLength
      || record.sha256 !== expected.sha256
    ) {
      invalidPrepared("application.json review-package hashes disagree with the six-file package");
    }
  }
}

function normalizeCentralFile(record, expectedPath) {
  if (
    !isPlainObject(record)
    || record.path !== expectedPath
    || typeof record.content !== "string"
    || hasForbiddenInvisibleOrBidi(record.path)
    || !Number.isInteger(record.byteLength)
    || record.byteLength < 1
    || record.byteLength > MAX_CENTRAL_FILE_BYTES[expectedPath]
    || !DIGEST_PATTERN.test(record.sha256 ?? "")
  ) {
    invalidPrepared(`the central package file ${expectedPath} is malformed`);
  }
  const bytes = Buffer.from(record.content, "utf8");
  if (bytes.length !== record.byteLength || sha256Bytes(bytes) !== record.sha256) {
    invalidPrepared(`the central package file ${expectedPath} does not match its byte length and SHA-256`);
  }
  if (expectedPath.endsWith(".json")) {
    let document;
    try {
      document = parseBoundedStrictJson(record.content, {
        maxSourceBytes: MAX_CENTRAL_FILE_BYTES[expectedPath],
        maxDepth: 256,
        maxNodes: 100_000,
        maxNumberCharacters: MAX_CENTRAL_FILE_BYTES[expectedPath]
      });
    } catch {
      invalidPrepared(`the central package file ${expectedPath} is not valid JSON`);
    }
    if (record.content !== `${canonicalJson(document)}\n`) {
      invalidPrepared(`the central package file ${expectedPath} is not canonical JSON`);
    }
  }
  return Object.freeze({
    path: expectedPath,
    content: record.content,
    byteLength: record.byteLength,
    sha256: record.sha256
  });
}

function parseJsonFile(record, label) {
  try {
    return parseBoundedStrictJson(record.content, {
      maxSourceBytes: MAX_CENTRAL_PACKAGE_BYTES,
      maxDepth: 256,
      maxNodes: 100_000,
      maxNumberCharacters: MAX_CENTRAL_PACKAGE_BYTES
    });
  } catch {
    invalidPrepared(`${label} is not valid JSON`);
  }
}

function unwrapPreparePrResult(input) {
  if (
    isPlainObject(input)
    && input.command === "prepare-pr"
    && input.ok === true
    && isPlainObject(input.result)
  ) return input.result;
  return input;
}

function confirmPreparedBody(body) {
  const replacements = [
    [
      "- [ ] I reviewed the generated title, body, source and evidence.",
      "- [x] I reviewed the generated title, body, source and evidence."
    ],
    [
      "- [ ] I explicitly authorize opening the draft pull request.",
      "- [x] I explicitly authorize opening the draft pull request."
    ]
  ];
  let result = body;
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) {
      invalidPrepared("the prepare-pr confirmation checklist is missing or ambiguous");
    }
    result = result.replace(before, after);
  }
  return result;
}

function normalizeCompanionSources(companions, primaryRepositoryId) {
  if (!Array.isArray(companions) || companions.length > 8) {
    invalidPrepared("the source request contains an invalid companion list");
  }
  const normalized = companions.map((record) => {
    if (!isPlainObject(record)) invalidPrepared("a companion source request is malformed");
    const repositorySlug = repositorySlugFromCanonicalUri(record.repositoryUri, "companion repository URI");
    return Object.freeze({
      repositorySlug,
      repositoryUrl: record.repositoryUri,
      numericRepositoryId: requireOpaqueDecimal(record.numericRepositoryId, "companion repository id"),
      commit: requireCommit(record.revisionObjectId, "companion source commit"),
      tree: requireCommit(record.treeObjectId, "companion source tree")
    });
  });
  for (let index = 0; index < normalized.length; index += 1) {
    if (
      normalized[index].numericRepositoryId === primaryRepositoryId
      || (index > 0 && compareUtf8(
        normalized[index - 1].numericRepositoryId,
        normalized[index].numericRepositoryId
      ) >= 0)
    ) {
      invalidPrepared("companion repository ids are not unique and canonically ordered");
    }
  }
  return normalized;
}

function normalizeActionRunIds(value, label) {
  if (!Array.isArray(value) || value.length > 16) {
    invalidPrepared(`${label} are malformed`);
  }
  const normalized = value.map((entry) => requireOpaqueDecimal(entry, label));
  for (let index = 1; index < normalized.length; index += 1) {
    if (compareUtf8(normalized[index - 1], normalized[index]) >= 0) {
      invalidPrepared(`${label} must be unique and canonically ordered`);
    }
  }
  return Object.freeze(normalized);
}

function repositorySlugFromCanonicalUri(value, label) {
  if (typeof value !== "string" || !value.startsWith("https://github.com/")) {
    invalidPrepared(`${label} is not a canonical public GitHub repository URI`);
  }
  const repositorySlug = value.slice("https://github.com/".length);
  try {
    requireRepositorySlug(repositorySlug, label);
  } catch {
    invalidPrepared(`${label} is not a canonical public GitHub repository URI`);
  }
  if (value !== `https://github.com/${repositorySlug}`) {
    invalidPrepared(`${label} is not a canonical public GitHub repository URI`);
  }
  return repositorySlug;
}
