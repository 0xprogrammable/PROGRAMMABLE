import crypto from "node:crypto";
import fs from "node:fs";
import { canonicalJson } from "./submission-core.mjs";
import { SUBMIT_LAUNCH_REPOSITORY_ID } from "./registry-intake-contract.mjs";
import {
  FEE_POLICY_V2_SCHEMA_ID,
  PROGRAMMABLE_FEE_V2_OWNER,
  UINT256_MAX_V2,
  isCanonicalPositiveUint256DecimalV2
} from "./fee-policy-v2-contract.mjs";

export { FEE_POLICY_V2_SCHEMA_ID };

export const LAUNCH_BUNDLE_INPUT_V2_SCHEMA_ID = "urn:programmable:launch-bundle-input-v2:2.0.0";
export const LAUNCH_BUNDLE_OUTPUT_V2_SCHEMA_ID = "urn:programmable:launch-bundle-output-v2:2.0.0";
export const LAUNCH_BUNDLE_V2_VERSION = "2.0.0";
export const LAUNCH_BUNDLE_V2_STATUS = "NOT_AUTHORIZED";
export const PROGRAMMABLE_FEE_RECIPIENT = PROGRAMMABLE_FEE_V2_OWNER;
export const PROGRAMMABLE_ADMIN_AUTHORIZER = "0x2Bb333d48DFAF1596D9036671d2E43168994249E";

export const APPLICATION_V3_SCHEMA_ID = "https://programmable.money/schemas/public-pr-application-v3.json";
export const SUBMISSION_V2_SCHEMA_ID = "urn:programmable:v4-hook-submission:2.0.0";
export const IDEA_SOURCE_V1_SCHEMA_ID = "urn:programmable:idea-source:1.0.0";
export const INTENT_CONTRACT_V1_SCHEMA_ID = "urn:programmable:intent-contract:1.0.0";
export const ARCHITECTURE_DECISIONS_V1_SCHEMA_ID = "urn:programmable:architecture-decisions:1.0.0";
export const INTENT_FIDELITY_V1_SCHEMA_ID = "urn:programmable:intent-fidelity:1.0.0";
export const SECURITY_V1_SCHEMA_ID = "urn:programmable:open-world-security:1.0.0";
export const EXECUTION_SURFACE_COVERAGE_V1_SCHEMA_ID = "urn:programmable:execution-surface-coverage:1.0.0";
export const REGISTRY_ACCEPTANCE_V3_SCHEMA_ID = "urn:programmable:registry-acceptance-v3:3.0.0";
export const PROGRAMMABLE_REGISTRY_NUMERIC_REPOSITORY_ID = SUBMIT_LAUNCH_REPOSITORY_ID;

export const REVIEW_STATES = new Set(["unresolved", "satisfied", "not-applicable", "conflict"]);
export const REQUIRED_V4_CHECKS = Object.freeze([
  "callbackAuthentication",
  "permissionAddressMatch",
  "deltaConservation",
  "unlockSettlement",
  "customAccountingReview"
]);
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
export const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
export const SAFE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[^\u0000-\u001f\u007f-\u009f]+$/u;
export const REGISTRY_ACCEPTANCE_V3_PATH_PATTERN = /^registry\/acceptances\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([1-9][0-9]*)\.v3\.json$/u;
export const REGISTRY_ACCEPTANCE_V3_MAX_TRUSTED_REVIEW_BYTES = 128 * 1024;
export const REGISTRY_ACCEPTANCE_V3_MAX_REVIEW_BODY_BYTES = 64 * 1024;
export const REGISTRY_ACCEPTANCE_V3_MAX_JSON_DEPTH = 32;
export const REGISTRY_ACCEPTANCE_V3_MAX_JSON_NODES = 4096;
export const REGISTRY_ACCEPTANCE_V3_MAINTAINER_USER_ID = "309941960";
export const REGISTRY_ACCEPTANCE_V3_REVIEW_SELECTION_RULE = "latest-pinned-reviewer-owner-review-for-current-head-v1";
export const REGISTRY_ACCEPTANCE_V3_REVIEW_BODY_CANONICALIZATION = "github-review-body-utf8-v1";
export const REGISTRY_ACCEPTANCE_V3_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u;
export const REGISTRY_ACCEPTANCE_V3_OPAQUE_ID_PATTERN = /^[1-9][0-9]{0,63}$/u;
export const REGISTRY_ACCEPTANCE_V3_PULL_NUMBER_PATTERN = /^[1-9][0-9]{0,9}$/u;
export const REGISTRY_ACCEPTANCE_V3_GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
export const REGISTRY_ACCEPTANCE_V3_GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/u;
export const MAX_UINT256 = UINT256_MAX_V2;
export const registryAcceptanceV3Schema = Object.freeze(JSON.parse(fs.readFileSync(
  new URL("../references/registry-acceptance-v3.schema.json", import.meta.url),
  "utf8"
)));
export const executionSurfaceCoverageV1Schema = Object.freeze(JSON.parse(fs.readFileSync(
  new URL("../references/execution-surface-coverage-v1.schema.json", import.meta.url),
  "utf8"
)));

export function sha256Utf8(value) {
  if (typeof value !== "string") throw new TypeError("sha256Utf8 requires a string");
  return `sha256:${crypto.createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")}`;
}

export function gitBlobObjectIdUtf8(value, algorithm = "sha1") {
  if (typeof value !== "string") throw new TypeError("gitBlobObjectIdUtf8 requires a string");
  if (algorithm !== "sha1" && algorithm !== "sha256") {
    throw new RangeError("Git blob algorithm must be sha1 or sha256");
  }
  const bytes = Buffer.from(value, "utf8");
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return crypto.createHash(algorithm).update(header).update(bytes).digest("hex");
}

/**
 * Pure helper for callers that already know the exact source snapshot. It binds
 * the supplied bytes but performs no filesystem, Git, network or RPC lookup.
 */
export function createExactContentBindingV2({
  id,
  sourceRef,
  path,
  schemaId,
  mediaType = "application/json",
  content,
  evidenceType
}) {
  if (typeof content !== "string" || content.length === 0) {
    throw new TypeError("content must be a non-empty string");
  }
  const binding = {
    id,
    sourceRef,
    path,
    gitBlobObjectId: gitBlobObjectIdUtf8(content, "sha1"),
    schemaId: schemaId ?? null,
    mediaType,
    sha256: sha256Utf8(content),
    byteLength: Buffer.byteLength(content, "utf8"),
    content
  };
  if (evidenceType !== undefined) return { id, evidenceType, ...binding };
  return binding;
}

/**
 * Lightweight structural validation for pure callers. The authoritative JSON
 * Schema remains the complete shape contract; this validator is deliberately
 * defensive so malformed input produces a NOT_AUTHORIZED report, not a crash.
 */
export function bindDeclaredEvidence(refsValue, basePath, evidenceIndex, unresolved, evidenceTracker, localTracker = null) {
  const refs = Array.isArray(refsValue) ? refsValue : [];
  for (const [index, ref] of refs.entries()) {
    const pathMatches = [...evidenceIndex.values()].filter((record) => record.path === ref);
    const matched = evidenceIndex.has(ref) || pathMatches.length === 1;
    if (!matched) {
      addUnresolved(unresolved, localTracker, "EVIDENCE_REF_UNBOUND", `${basePath}[${index}]`, `Evidence reference ${String(ref)} has no exact content binding.`);
      evidenceTracker.unresolved += 1;
    }
  }
}

export function collectEvidenceRefs(value) {
  const refs = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (!isObject(node)) return;
    for (const [key, entry] of Object.entries(node)) {
      if (key === "evidenceRefs" && Array.isArray(entry)) {
        for (const ref of entry) refs.push(ref);
      }
      else visit(entry);
    }
  };
  visit(value);
  return sortedUniqueStrings(refs);
}

export function applyDeclaredState(state, path, prefix, localTracker, conflicts, unresolved) {
  if (state === "conflict") {
    addConflict(conflicts, localTracker, `${prefix}_CONFLICT`, path, "The declared review state is conflict.");
  } else if (state === "unresolved" || !REVIEW_STATES.has(state)) {
    addUnresolved(unresolved, localTracker, `${prefix}_UNRESOLVED`, path, "The declared review state is unresolved.");
  }
}

export function validateSourceSnapshots(value, add) {
  if (!Array.isArray(value) || value.length === 0) {
    add("SOURCES_TYPE", "$.sources", "sources must contain at least one exact repository snapshot.");
    return;
  }
  for (const [index, source] of value.entries()) {
    const path = `$.sources[${index}]`;
    if (!isObject(source)) {
      add("SOURCE_TYPE", path, "Source snapshot must be an object.");
      continue;
    }
    validateSlug(source.id, `${path}.id`, "SOURCE_ID_INVALID", add);
    if (typeof source.repositoryUri !== "string" || source.repositoryUri.length === 0) add("SOURCE_URI_INVALID", `${path}.repositoryUri`, "repositoryUri is required.");
    if (!/^[1-9][0-9]*$/u.test(source.numericRepositoryId ?? "")) add("SOURCE_REPOSITORY_ID_INVALID", `${path}.numericRepositoryId`, "numericRepositoryId must be a positive decimal string.");
    if (!GIT_OBJECT_PATTERN.test(source.revisionObjectId ?? "")) add("SOURCE_REVISION_INVALID", `${path}.revisionObjectId`, "revisionObjectId must be an exact Git object id.");
    if (!GIT_OBJECT_PATTERN.test(source.treeObjectId ?? "")) add("SOURCE_TREE_INVALID", `${path}.treeObjectId`, "treeObjectId must be an exact Git object id.");
  }
}

export function validateArtifactShape(value, add) {
  if (!isObject(value)) {
    add("ARTIFACTS_TYPE", "$.artifacts", "artifacts must be an object.");
    return;
  }
  for (const key of [
    "application",
    "submission",
    "ideaSource",
    "intentContract",
    "architectureDecisions",
    "intentFidelity",
    "feePolicy",
    "security",
    "executionSurfaceCoverage"
  ]) {
    validateContentBindingShape(value[key], `$.artifacts.${key}`, false, add);
  }
  if (!Array.isArray(value.tradeCapabilities)) {
    add("TRADE_CAPABILITIES_ARRAY_TYPE", "$.artifacts.tradeCapabilities", "tradeCapabilities must be an array.");
  } else {
    for (const [index, record] of value.tradeCapabilities.entries()) {
      validateContentBindingShape(record, `$.artifacts.tradeCapabilities[${index}]`, false, add);
    }
  }
  if (value.registryAcceptance !== null) {
    validateContentBindingShape(value.registryAcceptance, "$.artifacts.registryAcceptance", false, add);
  }
  if (!Array.isArray(value.evidence)) {
    add("EVIDENCE_ARRAY_TYPE", "$.artifacts.evidence", "evidence must be an array.");
  } else {
    for (const [index, record] of value.evidence.entries()) validateContentBindingShape(record, `$.artifacts.evidence[${index}]`, true, add);
  }
}

export function validateContentBindingShape(record, path, evidence, add) {
  if (!isObject(record)) {
    add("ARTIFACT_BINDING_TYPE", path, "Content binding must be an object.");
    return;
  }
  validateSlug(record.id, `${path}.id`, "ARTIFACT_ID_INVALID", add);
  validateSlug(record.sourceRef, `${path}.sourceRef`, "ARTIFACT_SOURCE_REF_INVALID", add);
  if (typeof record.path !== "string" || !SAFE_PATH_PATTERN.test(record.path)) add("ARTIFACT_PATH_INVALID", `${path}.path`, "Artifact path must be a safe repository-relative path.");
  if (!GIT_OBJECT_PATTERN.test(record.gitBlobObjectId ?? "")) add("ARTIFACT_GIT_BLOB_INVALID", `${path}.gitBlobObjectId`, "gitBlobObjectId must be an exact Git object id.");
  if ((!evidence && typeof record.schemaId !== "string") || (evidence && record.schemaId !== null && typeof record.schemaId !== "string")) add("ARTIFACT_SCHEMA_ID_INVALID", `${path}.schemaId`, "schemaId has an invalid type.");
  if (!evidence && record.mediaType !== "application/json") add("ARTIFACT_MEDIA_TYPE_INVALID", `${path}.mediaType`, "Machine contract artifacts must use application/json.");
  if (evidence && (typeof record.evidenceType !== "string" || record.evidenceType.length === 0)) add("EVIDENCE_TYPE_INVALID", `${path}.evidenceType`, "Evidence type must be an open non-empty identifier.");
  if (!SHA256_PATTERN.test(record.sha256 ?? "")) add("ARTIFACT_SHA256_INVALID", `${path}.sha256`, "sha256 must be a canonical SHA-256 binding.");
  if (!Number.isSafeInteger(record.byteLength) || record.byteLength < 1) add("ARTIFACT_BYTE_LENGTH_INVALID", `${path}.byteLength`, "byteLength must be a positive safe integer.");
  if (typeof record.content !== "string" || record.content.length === 0) add("ARTIFACT_CONTENT_INVALID", `${path}.content`, "content must be a non-empty string.");
}

export function validateFeeScopeBindingShapes(value, add) {
  for (const [index, binding] of (Array.isArray(value) ? value : []).entries()) {
    const path = `$.feeScopeBindings[${index}]`;
    if (!isObject(binding)) {
      add("FEE_SCOPE_BINDING_TYPE", path, "Fee scope binding must be an object.");
      continue;
    }
    for (const field of ["id", "feeScopeId", "marketRef"]) validateSlug(binding[field], `${path}.${field}`, "FEE_SCOPE_BINDING_ID_INVALID", add);
    if (binding.protocolContextRef !== null) validateSlug(binding.protocolContextRef, `${path}.protocolContextRef`, "FEE_SCOPE_PROTOCOL_REF_INVALID", add);
    if (binding.implementationSourceRef !== null) validateSlug(binding.implementationSourceRef, `${path}.implementationSourceRef`, "FEE_SCOPE_IMPLEMENTATION_SOURCE_INVALID", add);
    if ((binding.implementationRef === null) !== (binding.implementationSourceRef === null)) add("FEE_SCOPE_IMPLEMENTATION_BINDING_PARTIAL", path, "implementationRef and implementationSourceRef must both be null or both be present.");
    if (!canonicalPositiveUint256Decimal(binding.chainId)) add("FEE_SCOPE_CHAIN_ID_INVALID", `${path}.chainId`, "chainId must be one canonical positive uint256 decimal string.");
    if (!BYTES32_PATTERN.test(binding.poolId ?? "")) add("FEE_SCOPE_POOL_ID_INVALID", `${path}.poolId`, "poolId must be bytes32.");
    if (!ADDRESS_PATTERN.test(binding.quoteCurrency ?? "")) add("FEE_SCOPE_QUOTE_CURRENCY_INVALID", `${path}.quoteCurrency`, "quoteCurrency must be an EVM address.");
    if (!REVIEW_STATES.has(binding.state)) add("FEE_SCOPE_STATE_INVALID", `${path}.state`, "state is invalid.");
    if (!Array.isArray(binding.evidenceRefs)) add("FEE_SCOPE_EVIDENCE_REFS_TYPE", `${path}.evidenceRefs`, "evidenceRefs must be an array.");
  }
}

export function validateProtocolContextShapes(value, add) {
  for (const [index, context] of (Array.isArray(value) ? value : []).entries()) {
    const path = `$.protocolContexts[${index}]`;
    if (!isObject(context)) {
      add("PROTOCOL_CONTEXT_TYPE", path, "Protocol context must be an object.");
      continue;
    }
    validateSlug(context.id, `${path}.id`, "PROTOCOL_CONTEXT_ID_INVALID", add);
    if (typeof context.protocolId !== "string" || context.protocolId.length === 0) add("PROTOCOL_ID_INVALID", `${path}.protocolId`, "protocolId must be a non-empty open identifier.");
    for (const field of ["targetRefs", "assetRefs", "marketRefs", "hookRefs", "reviewChecks"]) validateArray(context[field], `${path}.${field}`, "PROTOCOL_ARRAY_TYPE", add);
    if (context.protocolId === "uniswap-v4" && !isObject(context.v4)) add("V4_CONTEXT_TYPE", `${path}.v4`, "An explicit Uniswap v4 context requires v4 invariant states.");
    if (isObject(context.v4)) {
      if (context.v4.poolManagerAddress !== null && !ADDRESS_PATTERN.test(context.v4.poolManagerAddress ?? "")) add("V4_POOL_MANAGER_INVALID", `${path}.v4.poolManagerAddress`, "poolManagerAddress must be null or an EVM address.");
      if (typeof context.v4.nativeAmmMode !== "string" || context.v4.nativeAmmMode.length === 0) add("V4_NATIVE_AMM_MODE_INVALID", `${path}.v4.nativeAmmMode`, "nativeAmmMode must be an explicit open string.");
      if (context.v4.customAccountingUsed !== null && typeof context.v4.customAccountingUsed !== "boolean") add("V4_CUSTOM_ACCOUNTING_USAGE_INVALID", `${path}.v4.customAccountingUsed`, "customAccountingUsed must be boolean or null.");
      for (const field of REQUIRED_V4_CHECKS) {
        if (!isObject(context.v4[field]) || !REVIEW_STATES.has(context.v4[field]?.state)) add("V4_CHECK_INVALID", `${path}.v4.${field}`, `${field} must preserve an explicit review state.`);
      }
    }
    validateReviewRequirementShapes(context.reviewChecks, `${path}.reviewChecks`, add);
  }
}

export function validateReviewRequirementShapes(value, path, add) {
  for (const [index, requirement] of (Array.isArray(value) ? value : []).entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isObject(requirement)) {
      add("REVIEW_REQUIREMENT_TYPE", itemPath, "Review requirement must be an object.");
      continue;
    }
    if (typeof requirement.id !== "string" || requirement.id.length === 0) add("REVIEW_REQUIREMENT_ID_INVALID", `${itemPath}.id`, "Requirement id must be a non-empty open identifier.");
    if (!REVIEW_STATES.has(requirement.state)) add("REVIEW_REQUIREMENT_STATE_INVALID", `${itemPath}.state`, "Requirement state is invalid.");
    if (!Array.isArray(requirement.subjectRefs)) add("REVIEW_REQUIREMENT_SUBJECT_REFS_TYPE", `${itemPath}.subjectRefs`, "subjectRefs must be an array.");
    if (!Array.isArray(requirement.evidenceRefs)) add("REVIEW_REQUIREMENT_EVIDENCE_REFS_TYPE", `${itemPath}.evidenceRefs`, "evidenceRefs must be an array.");
  }
}

export function validSource(source) {
  return isObject(source)
    && validSlug(source.id)
    && typeof source.repositoryUri === "string"
    && source.repositoryUri.length > 0
    && /^[1-9][0-9]*$/u.test(source.numericRepositoryId ?? "")
    && GIT_OBJECT_PATTERN.test(source.revisionObjectId ?? "")
    && GIT_OBJECT_PATTERN.test(source.treeObjectId ?? "");
}

export function protocolHooks(submission, refsValue) {
  const refs = new Set(Array.isArray(refsValue) ? refsValue : []);
  return (Array.isArray(submission?.hooks) ? submission.hooks : []).filter(({ id }) => refs.has(id));
}

export function uniqueMap(values, key, code, path, conflicts, trackerValue) {
  const result = new Map();
  for (const [index, value] of values.entries()) {
    const id = value?.[key];
    if (typeof id !== "string" || id.length === 0) continue;
    if (result.has(id)) addConflict(conflicts, trackerValue, code, `${path}/${index}/${key}`, `Duplicate ${key} ${id}.`);
    else result.set(id, value);
  }
  return result;
}

export function idSet(values) {
  return new Set((Array.isArray(values) ? values : []).map(({ id }) => id).filter((id) => typeof id === "string"));
}

export function sameScalar(left, right, caseInsensitive = false) {
  if (caseInsensitive && typeof left === "string" && typeof right === "string") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

export function architectureSnapshotSha256V2(submission) {
  const snapshot = {
    targets: submission?.targets ?? [],
    assets: submission?.assets ?? [],
    markets: submission?.markets ?? [],
    hooks: submission?.hooks ?? [],
    lifecyclePhases: submission?.lifecyclePhases ?? [],
    components: submission?.components ?? [],
    valueFlows: submission?.valueFlows ?? [],
    authorities: submission?.authorities ?? [],
    capabilityProfiles: submission?.capabilityProfiles ?? [],
    tradeCapability: submission?.tradeCapability ?? null,
    programmableFee: submission?.programmableFee ?? null
  };
  return sha256Utf8(canonicalJson(snapshot));
}

export function tradeCapabilitySupportingRecords(declarationsValue, manifestRecords, evidenceIndex) {
  const declarations = Array.isArray(declarationsValue) ? declarationsValue : [];
  return declarations.map((declaration) => {
    const matches = manifestRecords.filter((record) => [
      record.path === declaration?.manifest?.path,
      record.schemaId === declaration?.manifest?.schemaId,
      record.sha256 === declaration?.manifest?.sha256,
      record.byteLength === declaration?.manifest?.byteLength,
      record.contentMatched === true,
      typeof record.content === "string",
      isObject(record.parsed)
    ].every(Boolean));
    const output = { marketRef: declaration?.marketRef, manifest: null, quoteResults: [], executionResults: [] };
    if (matches.length !== 1) return output;
    const [manifest] = matches;
    output.manifest = { value: manifest.parsed, bytes: Buffer.from(manifest.content, "utf8") };
    for (const [testsKey, resultsKey] of [["quoteTests", "quoteResults"], ["executionTests", "executionResults"]]) {
      const tests = Array.isArray(manifest.parsed?.testEvidence?.[testsKey]) ? manifest.parsed.testEvidence[testsKey] : [];
      output[resultsKey] = tests.map((test) => {
        const records = [...evidenceIndex.values()].filter((record) => [
          record.sourceRef === manifest.sourceRef,
          record.path === test?.resultArtifactPath,
          record.contentMatched === true,
          typeof record.content === "string",
          isObject(record.parsed)
        ].every(Boolean));
        return { testId: test?.id, result: records.length === 1 ? { value: records[0].parsed, bytes: Buffer.from(records[0].content, "utf8") } : null };
      });
    }
    return output;
  });
}

export const TRADE_BINDING_KEYS = Object.freeze([
  "submissionProjection", "applicationReviewRecord", "chain", "poolKey", "route", "router", "quoter",
  "permit2", "hookData", "modes", "slippage", "deadline", "fee", "quoteReceipts", "executionReceipts"
]);

export function tradeFindingBindingKeys(finding) {
  const text = `${String(finding?.code ?? "")}:${String(finding?.path ?? "")}:${String(finding?.message ?? "")}`;
  const matches = [
    ["chain", /CHAIN|referenceBlock|\.chain/u], ["poolKey", /POOL_KEY|poolKey|poolId/u],
    ["hookData", /HOOK_DATA|hookData/u], ["permit2", /PERMIT2|FUNDING|funding|permit2|NATIVE_/u],
    ["modes", /MODE|modeMatrix|\.mode/u], ["slippage", /SLIPPAGE|slippage/u],
    ["deadline", /DEADLINE|deadline/u], ["fee", /FEE|feeBehavior|\.fee/u],
    ["quoter", /QUOTER|QUOTE_PATH|quoter|TRADE_ROUTE_TYPE_MISMATCH/u], ["router", /ROUTER|EXECUTION_PATH|router|TRADE_ROUTE_TYPE_MISMATCH/u],
    ["route", /ROUTE|ADAPTER|ENDPOINT|route\./u]
  ].filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
  return matches;
}

export function inspectTradeApplicationMirror({ kind, origin, schemaId, applicationRecords, applicationSourceRef, evidenceRecords }) {
  const reviews = applicationRecords.map((record, index) => ({ record, index })).filter(({ record }) => [
    record?.kind === kind, record.source === "application-package", record.repositoryRef === null,
    record.path === origin.path, record.mediaType === origin.mediaType,
    record.byteLength === origin.byteLength, record.sha256 === origin.sha256
  ].every(Boolean));
  const mirrors = evidenceRecords.filter((record) => [
    record.sourceRef === applicationSourceRef, record.path === origin.path, record.mediaType === origin.mediaType,
    record.byteLength === origin.byteLength, record.sha256 === origin.sha256
  ].every(Boolean));
  const issues = [];
  if (reviews.length !== 1) issues.push(["TRADE_APPLICATION_REVIEW_CARDINALITY_INVALID", `Source-origin ${kind} bytes require exactly one equal Application V3 application-package review record.`]);
  if (mirrors.length !== 1) issues.push(["TRADE_APPLICATION_MIRROR_CARDINALITY_INVALID", `Application-package ${kind} review bytes require exactly one physical mirror.`]);
  const mirrorInvalid = mirrors.length === 1 && [
    mirrors[0].schemaId !== schemaId,
    mirrors[0].contentMatched !== true,
    mirrors[0].content !== origin.content,
    mirrors[0].evidenceType !== kind
  ].some(Boolean);
  if (mirrorInvalid) {
    issues.push(["TRADE_APPLICATION_MIRROR_CONTENT_INVALID", `Application-package ${kind} mirror must preserve the exact typed source-origin bytes.`]);
  }
  return { reviews, mirrors, issues };
}

export function inspectTradeFeeProjection({ manifest, market, declaration, policyScopes, submissionScopes, inputScopes, evidenceRecords, receiptSchemaId }) {
  const fee = manifest.feeBehavior?.programmableFeeV2;
  const issues = [];
  if (market?.executionClass !== "programmable-canonical") {
    const count = policyScopes.filter(({ id }) => market?.canonicalScopes?.includes(id)).length
      + submissionScopes.filter(({ marketRef }) => marketRef === declaration.marketRef).length
      + inputScopes.filter(({ marketRef }) => marketRef === declaration.marketRef).length;
    if ([market?.executionClass !== "external", fee?.applicability !== "not-applicable", fee?.executionClass !== "external", count !== 0].some(Boolean)) {
      issues.push(["TRADE_CAPABILITY_EXTERNAL_FEE_MISMATCH", "External selected routes require exact not-applicable external Fee V2 behavior and zero platform scopes."]);
    }
    return { issues, receipt: null };
  }
  const ids = Array.isArray(market.canonicalScopes) ? market.canonicalScopes : [];
  const policy = policyScopes.filter(({ id }) => ids.includes(id));
  const submitted = submissionScopes.filter(({ id, marketRef }) => ids.includes(id) && marketRef === declaration.marketRef);
  const bound = inputScopes.filter(({ feeScopeId, marketRef }) => ids.includes(feeScopeId) && marketRef === declaration.marketRef);
  if ([ids.length !== 1, policy.length !== 1, submitted.length !== 1, bound.length !== 1].some(Boolean)) {
    issues.push(["TRADE_CAPABILITY_FEE_SCOPE_CARDINALITY_INVALID", "Canonical trade routes require one exact policy, Submission and Launch Fee V2 scope."]);
    return { issues, receipt: null };
  }
  const fields = ["chainId", "poolId", "quoteCurrency", "collectionProfile"];
  const scopeMismatch = [fee?.applicability !== "applicable", fee?.feeScopeId !== policy[0].id,
    submitted[0].id !== policy[0].id, bound[0].feeScopeId !== policy[0].id,
    fields.some((field) => [fee?.[field] !== policy[0][field], submitted[0][field] !== policy[0][field], bound[0][field] !== policy[0][field]].some(Boolean))
  ].some(Boolean);
  if (scopeMismatch) {
    issues.push(["TRADE_CAPABILITY_FEE_SCOPE_MISMATCH", "Trade fee behavior must equal its exact policy, Submission and Launch Fee V2 scope."]);
  }
  const receipts = evidenceRecords.filter((record) => [record.schemaId === receiptSchemaId, record.path === fee?.receiptPath,
    record.sha256 === fee?.receiptSha256, record.contentMatched === true, record.parsed?.receiptId === fee?.receiptArtifactId].every(Boolean));
  if (receipts.length !== 1) issues.push(["TRADE_CAPABILITY_FEE_RECEIPT_MISMATCH", "Applicable trade fee behavior must resolve to one exact typed Fee V2 conformance receipt."]);
  return { issues, receipt: receipts.length === 1 ? receipts[0] : null };
}

export function issueCollector() {
  const map = new Map();
  return {
    add(code, path, message, evidenceRefs = []) {
      const issue = { code, path, message, evidenceRefs: sortedUniqueStrings(evidenceRefs) };
      map.set(`${code}:${path}:${message}`, issue);
    },
    values() {
      return [...map.values()].sort((left, right) => (
        left.code.localeCompare(right.code) || left.path.localeCompare(right.path) || left.message.localeCompare(right.message)
      ));
    }
  };
}

export function tracker() {
  return { conflicts: 0, unresolved: 0 };
}

export function addConflict(collector, trackerValue, code, path, message, evidenceRefs = []) {
  collector.add(code, path, message, evidenceRefs);
  if (trackerValue) trackerValue.conflicts += 1;
}

export function addUnresolved(collector, trackerValue, code, path, message, evidenceRefs = []) {
  collector.add(code, path, message, evidenceRefs);
  if (trackerValue) trackerValue.unresolved += 1;
}

export function bindingState(trackerValue) {
  if (trackerValue.conflicts > 0) return "CONFLICT";
  if (trackerValue.unresolved > 0) return "UNRESOLVED";
  return "MATCHED";
}

export function requireEqual(actual, expected, code, path, message, collector, trackerValue) {
  if (actual !== expected) addConflict(collector, trackerValue, code, path, message);
}

export function exact(actual, expected, path, code, add) {
  if (actual !== expected) add(code, path, `Expected ${JSON.stringify(expected)}.`);
}

export function validateSlug(value, path, code, add) {
  if (!validSlug(value)) add(code, path, "Expected a lowercase kebab-case identifier.");
}

export function validSlug(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && SLUG_PATTERN.test(value);
}

export function canonicalPositiveUint256Decimal(value) {
  return isCanonicalPositiveUint256DecimalV2(value);
}

export function canonicalPositiveDecimal(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

export function validateArray(value, path, code, add) {
  if (!Array.isArray(value)) add(code, path, "Expected an array.");
}

export function rejectUnknown(value, allowed, path, add) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add("UNKNOWN_INPUT_FIELD", `${path}.${key}`, `Unknown field ${key}.`);
  }
}

export function deduplicateIssues(issues) {
  const map = new Map();
  for (const issue of issues) map.set(`${issue.code}:${issue.path}:${issue.message}`, issue);
  return [...map.values()].sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
}

export function sortedUniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.length > 0))].sort();
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}
