import { TextDecoder } from "node:util";
import {
  canonicalJson,
  deriveOpenWorldV2FeeApplicability,
  sha256Bytes
} from "./open-world-v2-core.mjs";
import {
  derivePublicPrApplicationV3PreviousBinding,
  validatePublicPrApplicationV3
} from "./public-pr-application-v3-core.mjs";
import { parseBoundedStrictJson } from "./strict-json-core.mjs";

export const APPLICATION_V3_REVISION_PLAN_CONTRACT = "public-pr-application-v3-revision-plan";
export const APPLICATION_V3_REVISION_PLAN_VERSION = "1.0.0";
export const APPLICATION_V3_SOURCE_BINDING_FIELDS = Object.freeze([
  "id",
  "numericRepositoryId",
  "repositoryUri",
  "revisionObjectId",
  "treeObjectId",
  "sourceClosureMode",
  "sourcePaths",
  "sourceManifest"
]);
// These are the only same-source differences classified as recheck evidence.
// Every other root difference is normative and requires a new source binding.
export const APPLICATION_V3_RECHECK_DIFF_ALLOWLIST = Object.freeze([
  "$.fidelity",
  "$.securityBindings",
  "$.reviewPackage",
  "$.source.verificationReports",
  "$.source.primary.githubActionsRunIds",
  "$.source.companions[*].githubActionsRunIds"
]);

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const SHA256_PATTERN = /^sha256:(?!0{64}$)[0-9a-f]{64}$/u;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/u;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_APPLICATION_BYTES = 8 * 1024 * 1024;
const MAX_SUBMISSION_BYTES = 8 * 1024 * 1024;

export class ApplicationV3PrepareRevisionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApplicationV3PrepareRevisionError";
    this.code = code;
    this.exitCode = 1;
    this.writePerformed = false;
    this.networkAccessed = false;
    this.candidateCodeExecuted = false;
    this.externalActionsPerformed = Object.freeze([]);
    this.approvalGranted = false;
    this.launchAuthorizationGranted = false;
    this.details = Object.freeze({
      writePerformed: false,
      networkAccessed: false,
      candidateCodeExecuted: false,
      externalActionsPerformed: this.externalActionsPerformed,
      approvalGranted: false,
      launchAuthorizationGranted: false
    });
  }
}

/**
 * Derive one Application V3 revision and a content-free transport plan.
 *
 * The caller owns all repository and network I/O. This function accepts only
 * immutable predecessor bytes and never mutates either input.
 */
export function prepareApplicationV3Revision({ applicationDraft, predecessor } = {}) {
  requireApplicationDraft(applicationDraft);
  if (Object.hasOwn(applicationDraft, "applicationRevision")) {
    fail(
      "PREPARE_REVISION_MANUAL_REVISION_FORBIDDEN",
      "applicationRevision is derived and must be absent from the draft"
    );
  }
  if (Object.hasOwn(applicationDraft, "lineage")) {
    fail(
      "PREPARE_REVISION_MANUAL_LINEAGE_FORBIDDEN",
      "lineage is derived and must be absent from the draft"
    );
  }
  const application = cloneCanonical(applicationDraft);
  const derivation = deriveRevision({ applicationDraft: application, predecessor });
  application.applicationRevision = derivation.applicationRevision;
  application.lineage = derivation.lineage;
  if (validatePublicPrApplicationV3(application)?.valid !== true) {
    fail(
      "PREPARE_REVISION_RESULT_INVALID",
      "the derived application does not satisfy the complete Application V3 contract"
    );
  }
  const frozenApplication = deepFreeze(application);
  const planWithoutDigest = {
    contract: APPLICATION_V3_REVISION_PLAN_CONTRACT,
    schemaVersion: APPLICATION_V3_REVISION_PLAN_VERSION,
    mode: derivation.mode,
    applicationId: frozenApplication.applicationId,
    applicationRevision: frozenApplication.applicationRevision,
    lineage: frozenApplication.lineage,
    predecessor: derivation.predecessor,
    sourceChanged: derivation.sourceChanged,
    target: derivation.target,
    preparedDraftSha256: sha256CanonicalWithNewline(frozenApplication),
    dryRun: true,
    readOnly: true,
    writePerformed: false,
    networkAccessed: false,
    candidateCodeExecuted: false,
    externalActionsPerformed: [],
    approvalGranted: false,
    launchAuthorizationGranted: false
  };
  const plan = deepFreeze({
    ...planWithoutDigest,
    planSha256: sha256Canonical(planWithoutDigest)
  });
  return deepFreeze({ application: frozenApplication, plan });
}

function deriveRevision({ applicationDraft, predecessor }) {
  if (!isPlainObject(predecessor) || typeof predecessor.kind !== "string") {
    failPredecessorInvalid();
  }
  if (predecessor.kind === "none") {
    if (!hasOnlyKeys(predecessor, ["kind"])) failPredecessorInvalid();
    return {
      applicationRevision: "1",
      lineage: { kind: "new", previous: null },
      mode: "new-application",
      predecessor: null,
      sourceChanged: null,
      target: { githubNextAction: "submit", pullRequestNumber: null }
    };
  }
  if (predecessor.kind === "v3") {
    return deriveFromV3({ applicationDraft, predecessor });
  }
  if (predecessor.kind === "v2") {
    return deriveFromV2({ applicationDraft, predecessor });
  }
  if (predecessor.kind === "v1") {
    fail(
      "PREPARE_REVISION_PREDECESSOR_UNSUPPORTED",
      "the historical predecessor contract is not supported by revision preparation"
    );
  }
  failPredecessorInvalid();
}

function deriveFromV3({ applicationDraft, predecessor }) {
  const registryKeys = ["kind", "location", "applicationBytes", "packageSha256"];
  const draftKeys = [...registryKeys, "pullRequestNumber"];
  if (
    !["registry-base", "open-draft"].includes(predecessor.location)
    || !SHA256_PATTERN.test(predecessor.packageSha256 ?? "")
    || (predecessor.location === "registry-base" && !hasOnlyKeys(predecessor, registryKeys))
    || (predecessor.location === "open-draft" && !hasOnlyKeys(predecessor, draftKeys))
  ) {
    failPredecessorInvalid();
  }
  const pullRequestNumber = predecessor.location === "open-draft"
    ? requirePullRequestNumber(predecessor.pullRequestNumber)
    : null;
  const previousApplication = parseCanonicalPredecessorBytes(predecessor.applicationBytes);
  if (
    previousApplication?.contract?.id !== "public-pr-application-v3"
    || previousApplication?.contract?.version !== "3.0.0"
    || previousApplication?.schemaVersion !== 3
    || previousApplication.applicationId !== applicationDraft.applicationId
    || previousApplication?.builder?.githubUserId !== applicationDraft?.builder?.githubUserId
  ) {
    fail(
      "PREPARE_REVISION_PREDECESSOR_IDENTITY_MISMATCH",
      "the predecessor does not match the target application identity"
    );
  }
  const predecessorValidation = validatePublicPrApplicationV3(previousApplication);
  if (predecessorValidation?.valid !== true) failPredecessorInvalid();
  const applicationSha256 = sha256Bytes(predecessor.applicationBytes);
  let previousBinding;
  try {
    previousBinding = derivePublicPrApplicationV3PreviousBinding({
      application: previousApplication,
      applicationSha256,
      packageSha256: predecessor.packageSha256
    });
  } catch {
    failPredecessorInvalid();
  }
  requireV3PreviousBinding(previousBinding);

  const comparablePrevious = cloneCanonical(previousApplication);
  delete comparablePrevious.applicationRevision;
  delete comparablePrevious.lineage;
  if (canonicalJson(comparablePrevious) === canonicalJson(applicationDraft)) {
    fail(
      "PREPARE_REVISION_NO_CHANGES",
      "the requested revision has no semantic changes"
    );
  }
  const sourceChanged = canonicalJson(sourceBindingProjection(previousApplication.source))
    !== canonicalJson(sourceBindingProjection(applicationDraft.source));
  if (
    !sourceChanged
    && canonicalJson(normativeProjection(previousApplication))
      !== canonicalJson(normativeProjection(applicationDraft))
  ) {
    fail(
      "PREPARE_REVISION_NORMATIVE_CHANGE_REQUIRES_SOURCE_UPDATE",
      "same-source revisions may change only derived review and security evidence"
    );
  }
  const applicationRevision = incrementCanonicalDecimal(previousApplication.applicationRevision);
  const lineage = {
    kind: sourceChanged ? "source-update" : "recheck",
    previous: cloneCanonical(previousBinding)
  };
  return {
    applicationRevision,
    lineage,
    mode: predecessor.location === "open-draft"
      ? "open-draft-update"
      : "merged-registry-successor",
    predecessor: {
      applicationContract: previousBinding.applicationContract,
      applicationRevision: previousBinding.applicationRevision,
      applicationSha256,
      packageSha256: predecessor.packageSha256,
      location: predecessor.location
    },
    sourceChanged,
    target: {
      githubNextAction: predecessor.location === "open-draft" ? "update" : "submit",
      pullRequestNumber
    }
  };
}

function deriveFromV2({ applicationDraft, predecessor }) {
  const allowedKeys = [
    "kind",
    "location",
    "applicationBytes",
    "submissionBytes",
    "packageSha256"
  ];
  if (
    predecessor.location !== "registry-base"
    || !hasOnlyKeys(predecessor, allowedKeys)
    || !SHA256_PATTERN.test(predecessor.packageSha256 ?? "")
  ) {
    failPredecessorInvalid();
  }
  const previousApplication = parseCanonicalPredecessorBytes(predecessor.applicationBytes);
  const source = previousApplication?.source?.primary;
  const fee = previousApplication?.programmableFee;
  if (
    previousApplication?.schemaVersion !== 2
    || !Number.isInteger(previousApplication.applicationRevision)
    || previousApplication.applicationRevision < 1
    || previousApplication.applicationRevision > 1_000_000
    || previousApplication.applicationId !== applicationDraft.applicationId
    || previousApplication?.builder?.githubUserId !== applicationDraft?.builder?.githubUserId
    || !isPlainObject(source)
    || !/^[1-9][0-9]{0,63}$/u.test(source.numericRepositoryId ?? "")
    || typeof source.repositoryUri !== "string"
    || !GIT_OBJECT_PATTERN.test(source.revisionObjectId ?? "")
    || !GIT_OBJECT_PATTERN.test(source.treeObjectId ?? "")
    || !isPlainObject(fee)
    || fee.policyId !== "programmable-volume-fee-v1"
    || fee.policyVersion !== "1.1.0"
    || !isPlainObject(fee.submissionBinding)
    || typeof fee.submissionBinding.path !== "string"
    || fee.submissionBinding.path.length === 0
    || !SHA256_PATTERN.test(fee.submissionBinding.sha256 ?? "")
  ) {
    failPredecessorInvalid();
  }
  const submission = parseV2SubmissionBytes(predecessor.submissionBytes);
  if (
    sha256Bytes(predecessor.submissionBytes) !== fee.submissionBinding.sha256
    || submission?.$schema !== "urn:programmable:v4-hook-submission:1.6.0"
    || submission?.standardVersion !== "1.6.0"
    || submission?.model?.id !== applicationDraft.applicationId
  ) {
    failV2SubmissionMismatch();
  }
  const applicationSha256 = sha256Bytes(predecessor.applicationBytes);
  const previousBinding = {
    applicationContract: "public-pr-application-v2",
    applicationSchemaVersion: 2,
    applicationRevision: String(previousApplication.applicationRevision),
    applicationSha256,
    packageSha256: predecessor.packageSha256,
    sourceNumericRepositoryId: source.numericRepositoryId,
    sourceCommit: source.revisionObjectId,
    sourceTree: source.treeObjectId,
    submissionSchemaId: submission.$schema,
    submissionStandard: submission.standardVersion,
    submissionPath: fee.submissionBinding.path,
    submissionSha256: fee.submissionBinding.sha256,
    feePolicyId: fee.policyId,
    feePolicyVersion: fee.policyVersion,
    feeApplicability: deriveOpenWorldV2FeeApplicability(submission),
    feePolicyInstanceSha256: null
  };
  const targetSource = applicationDraft?.source?.primary;
  const sourceChanged = !isPlainObject(targetSource) || [
    [targetSource.numericRepositoryId, source.numericRepositoryId],
    [targetSource.repositoryUri, source.repositoryUri],
    [targetSource.revisionObjectId, source.revisionObjectId],
    [targetSource.treeObjectId, source.treeObjectId]
  ].some(([target, previous]) => target !== previous);
  return {
    applicationRevision: incrementCanonicalDecimal(String(previousApplication.applicationRevision)),
    lineage: {
      kind: "schema-migration",
      previous: previousBinding
    },
    mode: "legacy-schema-migration",
    predecessor: {
      applicationContract: "public-pr-application-v2",
      applicationRevision: String(previousApplication.applicationRevision),
      applicationSha256,
      packageSha256: predecessor.packageSha256,
      location: predecessor.location
    },
    sourceChanged,
    target: { githubNextAction: "submit", pullRequestNumber: null }
  };
}

function parseCanonicalPredecessorBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_APPLICATION_BYTES) {
    fail(
      "PREPARE_REVISION_PREDECESSOR_BYTES_INVALID",
      "the predecessor root is not bounded canonical UTF-8 JSON"
    );
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail(
      "PREPARE_REVISION_PREDECESSOR_BYTES_NON_CANONICAL",
      "the predecessor root is not encoded as canonical JSON"
    );
  }
  let source;
  let document;
  try {
    source = strictUtf8.decode(bytes);
    document = parseBoundedStrictJson(source, {
      maxSourceBytes: MAX_APPLICATION_BYTES,
      maxDepth: 256,
      maxNodes: 250_000,
      maxNumberCharacters: MAX_APPLICATION_BYTES
    });
  } catch {
    fail(
      "PREPARE_REVISION_PREDECESSOR_BYTES_INVALID",
      "the predecessor root is not bounded canonical UTF-8 JSON"
    );
  }
  if (!isPlainObject(document) || source !== `${canonicalJson(document)}\n`) {
    fail(
      "PREPARE_REVISION_PREDECESSOR_BYTES_NON_CANONICAL",
      "the predecessor root is not encoded as canonical JSON"
    );
  }
  return document;
}

function parseV2SubmissionBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_SUBMISSION_BYTES) {
    failV2SubmissionMismatch();
  }
  try {
    const document = parseBoundedStrictJson(strictUtf8.decode(bytes), {
      maxSourceBytes: MAX_SUBMISSION_BYTES,
      maxDepth: 256,
      maxNodes: 250_000,
      maxNumberCharacters: MAX_SUBMISSION_BYTES
    });
    if (!isPlainObject(document)) failV2SubmissionMismatch();
    return document;
  } catch (error) {
    if (error instanceof ApplicationV3PrepareRevisionError) throw error;
    failV2SubmissionMismatch();
  }
}

function sourceBindingProjection(source) {
  if (!isPlainObject(source) || !isPlainObject(source.primary) || !Array.isArray(source.companions)) {
    fail(
      "PREPARE_REVISION_DRAFT_INVALID",
      "the application draft does not satisfy the Application V3 preparation boundary"
    );
  }
  return {
    schemaVersion: source.schemaVersion,
    primary: sourceRepositoryBindingProjection(source.primary),
    companions: source.companions.map(sourceRepositoryBindingProjection)
  };
}

function sourceRepositoryBindingProjection(repository) {
  if (!isPlainObject(repository)) {
    fail(
      "PREPARE_REVISION_DRAFT_INVALID",
      "the application draft does not satisfy the Application V3 preparation boundary"
    );
  }
  const projection = {};
  for (const field of APPLICATION_V3_SOURCE_BINDING_FIELDS) {
    if (!Object.hasOwn(repository, field)) {
      fail(
        "PREPARE_REVISION_DRAFT_INVALID",
        "the application draft does not satisfy the Application V3 preparation boundary"
      );
    }
    projection[field] = cloneCanonical(repository[field]);
  }
  return projection;
}

function normativeProjection(application) {
  const projection = cloneCanonical(application);
  delete projection.applicationRevision;
  delete projection.lineage;
  delete projection.fidelity;
  delete projection.securityBindings;
  delete projection.reviewPackage;
  if (isPlainObject(projection.source)) {
    delete projection.source.verificationReports;
    for (const repository of [projection.source.primary, ...(projection.source.companions ?? [])]) {
      if (isPlainObject(repository)) delete repository.githubActionsRunIds;
    }
  }
  return projection;
}

function requireV3PreviousBinding(binding) {
  if (
    !isPlainObject(binding)
    || binding.applicationContract !== "public-pr-application-v3"
    || binding.applicationSchemaVersion !== 3
    || !POSITIVE_DECIMAL_PATTERN.test(binding.applicationRevision ?? "")
    || !SHA256_PATTERN.test(binding.applicationSha256 ?? "")
    || !SHA256_PATTERN.test(binding.packageSha256 ?? "")
    || !/^[1-9][0-9]{0,63}$/u.test(binding.sourceNumericRepositoryId ?? "")
    || !GIT_OBJECT_PATTERN.test(binding.sourceCommit ?? "")
    || !GIT_OBJECT_PATTERN.test(binding.sourceTree ?? "")
    || typeof binding.submissionSchemaId !== "string"
    || typeof binding.submissionStandard !== "string"
    || typeof binding.submissionPath !== "string"
    || binding.submissionPath.length === 0
    || !SHA256_PATTERN.test(binding.submissionSha256 ?? "")
    || typeof binding.feePolicyId !== "string"
    || typeof binding.feePolicyVersion !== "string"
    || !new Set(["unresolved", "applicable", "not-applicable"]).has(binding.feeApplicability)
    || !(binding.feePolicyInstanceSha256 === null || SHA256_PATTERN.test(binding.feePolicyInstanceSha256 ?? ""))
  ) {
    failPredecessorInvalid();
  }
}

function incrementCanonicalDecimal(value) {
  if (!POSITIVE_DECIMAL_PATTERN.test(value ?? "")) failPredecessorInvalid();
  return (BigInt(value) + 1n).toString();
}

function requirePullRequestNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1) failPredecessorInvalid();
  return value;
}

function requireApplicationDraft(value) {
  if (
    !isPlainObject(value)
    || value.schemaVersion !== 3
    || value.contract?.id !== "public-pr-application-v3"
    || value.contract?.version !== "3.0.0"
    || typeof value.applicationId !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.applicationId)
  ) {
    fail(
      "PREPARE_REVISION_DRAFT_INVALID",
      "the application draft does not satisfy the Application V3 preparation boundary"
    );
  }
}

function cloneCanonical(value) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch {
    fail(
      "PREPARE_REVISION_DRAFT_INVALID",
      "the application draft does not satisfy the Application V3 preparation boundary"
    );
  }
}

function sha256CanonicalWithNewline(value) {
  return sha256Bytes(Buffer.from(`${canonicalJson(value)}\n`, "utf8"));
}

function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys);
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function failPredecessorInvalid() {
  fail(
    "PREPARE_REVISION_PREDECESSOR_INVALID",
    "the predecessor snapshot does not satisfy the revision preparation contract"
  );
}

function failV2SubmissionMismatch() {
  fail(
    "PREPARE_REVISION_V2_SUBMISSION_MISMATCH",
    "the V2 predecessor submission does not satisfy its immutable source binding"
  );
}

function fail(code, message) {
  throw new ApplicationV3PrepareRevisionError(code, message);
}
