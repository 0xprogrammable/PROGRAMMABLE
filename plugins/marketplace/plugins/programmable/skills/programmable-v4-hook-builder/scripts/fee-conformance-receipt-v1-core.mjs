import crypto from "node:crypto";

import { canonicalJsonLegacyV1 as canonicalJson } from "./canonical-json-legacy-adapters.mjs";

import {
  COLLECTION_PROFILES_V2,
  FEE_POLICY_V2_HASH,
  FEE_POLICY_V2_HASH_PREIMAGE,
  FEE_POLICY_V2_ID,
  FEE_POLICY_V2_VERSION,
  UINT256_MAX_V2,
  isCanonicalPositiveUint256DecimalV2
} from "./fee-policy-v2-core.mjs";
import {
  FEE_CONFORMANCE_RECEIPT_V1_ASSURANCE,
  FEE_CONFORMANCE_RECEIPT_V1_CONTRACT_ID,
  FEE_CONFORMANCE_RECEIPT_V1_RESULT,
  FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID,
  FEE_CONFORMANCE_RECEIPT_V1_VERSION,
  REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1,
  STANDARD_AMM_QUADRANTS_V1
} from "./fee-conformance-v1-constants.mjs";
import {
  canonicalFeeConformanceVectorSetBytesV1,
  feeConformanceVectorEvidenceDigestsV1,
  validateFeeConformanceVectorSetV1
} from "./fee-conformance-vector-set-v1-core.mjs";

export {
  FEE_CONFORMANCE_RECEIPT_V1_ASSURANCE,
  FEE_CONFORMANCE_RECEIPT_V1_CONTRACT_ID,
  FEE_CONFORMANCE_RECEIPT_V1_RESULT,
  FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID,
  FEE_CONFORMANCE_RECEIPT_V1_VERSION,
  REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1,
  STANDARD_AMM_QUADRANTS_V1
} from "./fee-conformance-v1-constants.mjs";

const COLLECTION_PROFILE_SET = new Set(COLLECTION_PROFILES_V2);
const REQUIRED_ASSERTION_SET = new Set(REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1);
const STANDARD_AMM_QUADRANT_SET = new Set(STANDARD_AMM_QUADRANTS_V1);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REPOSITORY_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[^\u0000-\u001f\u007f-\u009f]+$/u;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/u;
const NONZERO_BYTES32_PATTERN = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const NONZERO_SHA256_PATTERN = /^sha256:(?!0{64}$)[0-9a-f]{64}$/u;
const GIT_OBJECT_PATTERN = /^(?!0{40}$)[0-9a-f]{40}$/u;
const EXECUTION_MODEL_SET = new Set(["synchronous", "asynchronous", "custom"]);
const DIRECTION_SET = new Set(["zero-for-one", "one-for-zero", "profile-specific"]);
const EXACTNESS_SET = new Set(["exact-input", "exact-output", "profile-specific"]);
const QUOTE_ROLE_SET = new Set(["specified", "unspecified", "profile-specific"]);

export function createFeeConformanceReceiptV1({
  receiptId,
  applicationId,
  scope,
  implementation,
  executionSurfaceCoverageSha256,
  surfaceScopeMappings,
  vectorSet
}) {
  const receipt = {
    $schema: FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID,
    schemaVersion: FEE_CONFORMANCE_RECEIPT_V1_VERSION,
    contract: {
      id: FEE_CONFORMANCE_RECEIPT_V1_CONTRACT_ID,
      version: FEE_CONFORMANCE_RECEIPT_V1_VERSION
    },
    receiptId,
    applicationId,
    result: FEE_CONFORMANCE_RECEIPT_V1_RESULT,
    assurance: FEE_CONFORMANCE_RECEIPT_V1_ASSURANCE,
    policy: {
      id: FEE_POLICY_V2_ID,
      version: FEE_POLICY_V2_VERSION,
      hashPreimage: FEE_POLICY_V2_HASH_PREIMAGE,
      hash: FEE_POLICY_V2_HASH
    },
    scope,
    implementation,
    executionSurfaceCoverageSha256,
    surfaceScopeMappings,
    vectorSet
  };
  const errors = validateFeeConformanceReceiptV1(receipt);
  if (errors.length > 0) {
    throw new RangeError(`invalid fee-conformance receipt:\n${errors.join("\n")}`);
  }
  return receipt;
}

/**
 * Validates the closed receipt contract and, when supplied, exact Launch-side
 * expectations. Structural conformance is deliberately not described as an audit,
 * deployment receipt, runtime match or approval.
 */
export function validateFeeConformanceReceiptV1(receipt, expected = undefined) {
  const errors = [];
  const add = (path, message) => errors.push(`${path}: ${message}`);
  if (!isObject(receipt)) return ["$: receipt must be an object"];

  exactKeys(receipt, "$", [
    "$schema",
    "schemaVersion",
    "contract",
    "receiptId",
    "applicationId",
    "result",
    "assurance",
    "policy",
    "scope",
    "implementation",
    "executionSurfaceCoverageSha256",
    "surfaceScopeMappings",
    "vectorSet"
  ], add);
  for (const [path, actual, wanted] of [
    ["$.$schema", receipt.$schema, FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID],
    ["$.schemaVersion", receipt.schemaVersion, FEE_CONFORMANCE_RECEIPT_V1_VERSION],
    ["$.contract.id", receipt.contract?.id, FEE_CONFORMANCE_RECEIPT_V1_CONTRACT_ID],
    ["$.contract.version", receipt.contract?.version, FEE_CONFORMANCE_RECEIPT_V1_VERSION],
    ["$.result", receipt.result, FEE_CONFORMANCE_RECEIPT_V1_RESULT],
    ["$.assurance", receipt.assurance, FEE_CONFORMANCE_RECEIPT_V1_ASSURANCE],
    ["$.policy.id", receipt.policy?.id, FEE_POLICY_V2_ID],
    ["$.policy.version", receipt.policy?.version, FEE_POLICY_V2_VERSION],
    ["$.policy.hashPreimage", receipt.policy?.hashPreimage, FEE_POLICY_V2_HASH_PREIMAGE],
    ["$.policy.hash", receipt.policy?.hash, FEE_POLICY_V2_HASH]
  ]) if (actual !== wanted) add(path, `must equal ${wanted}`);

  exactKeys(receipt.contract, "$.contract", ["id", "version"], add);
  exactKeys(receipt.policy, "$.policy", ["id", "version", "hashPreimage", "hash"], add);
  validateSlug(receipt.receiptId, "$.receiptId", add);
  validateSlug(receipt.applicationId, "$.applicationId", add);

  validateScope(receipt.scope, add);
  validateImplementation(receipt.implementation, add);
  validatePattern(
    receipt.executionSurfaceCoverageSha256,
    NONZERO_SHA256_PATTERN,
    "$.executionSurfaceCoverageSha256",
    "must be a non-placeholder sha256 digest",
    add
  );

  const declaredModeKeys = validateSurfaceMappings(receipt, add);
  validateVectorSet(receipt.vectorSet, declaredModeKeys, add);
  if (expected !== undefined) validateExpectations(receipt, expected, add);
  return [...new Set(errors)].sort();
}

/**
 * `complete` is valid only when the exact typed receipt and its vector-set bytes
 * are both named by the submission conformance record.
 */
export function validateFeeConformanceCompletionV1({
  conformance,
  receipt,
  receiptEvidenceRef,
  vectorSet,
  vectorSetBytes,
  evidenceDigests,
  expected
}) {
  const errors = [];
  if (!isObject(conformance)) return ["$.conformance: must be an object"];
  if (conformance.status !== "complete") {
    errors.push("$.conformance.status: must equal complete");
  }
  if (!Array.isArray(conformance.evidenceRefs)) {
    errors.push("$.conformance.evidenceRefs: must be an array");
  } else {
    const seen = new Set();
    for (const [index, ref] of conformance.evidenceRefs.entries()) {
      if (typeof ref !== "string" || ref.length === 0) {
        errors.push(`$.conformance.evidenceRefs[${index}]: must be a nonempty string`);
      } else if (seen.has(ref)) {
        errors.push(`$.conformance.evidenceRefs[${index}]: duplicate evidence reference`);
      } else seen.add(ref);
    }
  }
  if (!SLUG_PATTERN.test(receiptEvidenceRef ?? "")) {
    errors.push("$.receiptEvidenceRef: must be a canonical evidence slug");
  }
  for (const error of validateFeeConformanceReceiptV1(receipt, expected)) {
    errors.push(`$.receipt${error === "$" ? "" : error.slice(1)}`);
  }
  for (const error of validateFeeConformanceVectorSetV1(vectorSet, { receipt })) {
    errors.push(`$.vectorSet${error === "$" ? "" : error.slice(1)}`);
  }
  if (isObject(receipt)) {
    if (receipt.receiptId !== receiptEvidenceRef) {
      errors.push("$.receipt.receiptId: must equal the exact receipt evidence binding id");
    }
    if (Array.isArray(conformance.evidenceRefs)) {
      if (!conformance.evidenceRefs.includes(receiptEvidenceRef)) {
        errors.push("$.conformance.evidenceRefs: must bind the typed fee-conformance receipt");
      }
      if (!conformance.evidenceRefs.includes(receipt.vectorSet?.evidenceRef)) {
        errors.push("$.conformance.evidenceRefs: must bind the exact vector-set evidence bytes");
      }
    }
  }
  let canonicalVectorBytes = null;
  try {
    canonicalVectorBytes = canonicalFeeConformanceVectorSetBytesV1(vectorSet);
  } catch {
    // Detailed vector validation errors are already reported above.
  }
  const suppliedVectorBytes = toBytes(vectorSetBytes);
  if (suppliedVectorBytes === null) {
    errors.push("$.vectorSetBytes: exact vector-set evidence bytes are required");
  } else if (canonicalVectorBytes !== null && !suppliedVectorBytes.equals(canonicalVectorBytes)) {
    errors.push("$.vectorSetBytes: must equal canonical validated vector-set bytes");
  }
  const digestIndex = normalizeDigestIndex(evidenceDigests, errors);
  if (digestIndex !== null && isObject(receipt)) {
    const receiptDigest = safeReceiptDigest(receipt);
    if (receiptDigest !== null && digestIndex.get(receiptEvidenceRef) !== receiptDigest) {
      errors.push("$.evidenceDigests: receipt evidence digest does not match canonical typed receipt bytes");
    }
    if (digestIndex.get(receipt.vectorSet?.evidenceRef) !== receipt.vectorSet?.sha256) {
      errors.push("$.evidenceDigests: vector-set evidence digest does not match the receipt binding");
    }
    if (isObject(vectorSet)) {
      let declaredDigests = {};
      try {
        declaredDigests = feeConformanceVectorEvidenceDigestsV1(vectorSet);
      } catch {
        // Detailed vector validation errors are already reported above.
      }
      for (const [ref, digest] of Object.entries(declaredDigests)) {
        if (!conformance.evidenceRefs?.includes(ref)) {
          errors.push(`$.conformance.evidenceRefs: must bind vector evidence ${ref}`);
        }
        if (digestIndex.get(ref) !== digest) {
          errors.push(`$.evidenceDigests: evidence ${ref} does not match its typed vector digest`);
        }
      }
    }
  }
  return [...new Set(errors)].sort();
}

export function projectFeeConformanceReceiptV1(receipt) {
  const errors = validateFeeConformanceReceiptV1(receipt);
  if (errors.length > 0) {
    throw new RangeError(`invalid fee-conformance receipt:\n${errors.join("\n")}`);
  }
  return {
    receiptId: receipt.receiptId,
    applicationId: receipt.applicationId,
    policyId: receipt.policy.id,
    policyVersion: receipt.policy.version,
    policyHash: receipt.policy.hash,
    feeScope: { ...receipt.scope },
    collectionProfile: receipt.scope.collectionProfile,
    implementation: {
      artifactRef: receipt.implementation.artifactRef,
      artifactSha256: receipt.implementation.artifactSha256
    },
    executionSurfaceCoverageSha256: receipt.executionSurfaceCoverageSha256,
    surfaceScopeMappings: receipt.surfaceScopeMappings.map((mapping) => ({
      surfaceId: mapping.surfaceId,
      marketRef: mapping.marketRef,
      feeScopeId: mapping.feeScopeId,
      collectionProfile: mapping.collectionProfile,
      implementationArtifactRef: mapping.implementationArtifactRef,
      implementationArtifactSha256: mapping.implementationArtifactSha256,
      modes: mapping.modes.map((mode) => ({ ...mode }))
    })),
    vectorSetEvidenceRef: receipt.vectorSet.evidenceRef,
    vectorSetSha256: receipt.vectorSet.sha256
  };
}

export function feeConformanceReceiptScopeProfileKeyV1(receipt) {
  const projection = projectFeeConformanceReceiptV1(receipt);
  const scope = projection.feeScope;
  return [
    projection.applicationId,
    scope.feeScopeId,
    scope.chainId,
    scope.poolId,
    scope.quoteCurrency,
    scope.collectionProfile
  ].join(":");
}

export function canonicalFeeConformanceReceiptBytesV1(receipt) {
  const errors = validateFeeConformanceReceiptV1(receipt);
  if (errors.length > 0) {
    throw new RangeError(`invalid fee-conformance receipt:\n${errors.join("\n")}`);
  }
  return Buffer.from(`${canonicalJson(receipt)}\n`, "utf8");
}

export function feeConformanceReceiptSha256V1(receipt) {
  return `sha256:${crypto.createHash("sha256").update(canonicalFeeConformanceReceiptBytesV1(receipt)).digest("hex")}`;
}

function validateScope(scope, add) {
  if (!exactKeys(scope, "$.scope", [
    "feeScopeId",
    "marketRef",
    "chainId",
    "poolId",
    "quoteCurrency",
    "collectionProfile"
  ], add)) return;
  validateSlug(scope.feeScopeId, "$.scope.feeScopeId", add);
  validateSlug(scope.marketRef, "$.scope.marketRef", add);
  if (!isCanonicalPositiveUint256DecimalV2(scope.chainId)) {
    add("$.scope.chainId", "must be a canonical positive uint256 decimal string");
  }
  validatePattern(scope.poolId, NONZERO_BYTES32_PATTERN, "$.scope.poolId", "must be non-placeholder lowercase bytes32", add);
  validatePattern(scope.quoteCurrency, ADDRESS_PATTERN, "$.scope.quoteCurrency", "must be a lowercase EVM address", add);
  if (!COLLECTION_PROFILE_SET.has(scope.collectionProfile)) {
    add("$.scope.collectionProfile", "must be a canonical fee-v2 collection profile");
  }
}

function validateImplementation(implementation, add) {
  if (!exactKeys(implementation, "$.implementation", [
    "artifactRef",
    "artifactSha256",
    "sourceRef",
    "revisionObjectId",
    "treeObjectId",
    "path"
  ], add)) return;
  validateSlug(implementation.artifactRef, "$.implementation.artifactRef", add);
  validatePattern(implementation.artifactSha256, NONZERO_SHA256_PATTERN, "$.implementation.artifactSha256", "must be a non-placeholder sha256 digest", add);
  validateSlug(implementation.sourceRef, "$.implementation.sourceRef", add);
  validatePattern(implementation.revisionObjectId, GIT_OBJECT_PATTERN, "$.implementation.revisionObjectId", "must be a non-placeholder lowercase Git object id", add);
  validatePattern(implementation.treeObjectId, GIT_OBJECT_PATTERN, "$.implementation.treeObjectId", "must be a non-placeholder lowercase Git tree id", add);
  if (
    typeof implementation.path !== "string"
    || !REPOSITORY_PATH_PATTERN.test(implementation.path)
  ) add("$.implementation.path", "must be a safe repository-relative path");
}

function validateSurfaceMappings(receipt, add) {
  const mappings = receipt.surfaceScopeMappings;
  const declaredModeKeys = new Set();
  const standardQuadrants = new Set();
  if (!Array.isArray(mappings) || mappings.length === 0) {
    add("$.surfaceScopeMappings", "must contain at least one exact surface mapping");
    return declaredModeKeys;
  }
  assertSortedUnique(mappings.map((mapping) => mapping?.surfaceId), "$.surfaceScopeMappings", "surfaceId", add);
  for (const [index, mapping] of mappings.entries()) {
    const path = `$.surfaceScopeMappings[${index}]`;
    if (!exactKeys(mapping, path, [
      "surfaceId",
      "marketRef",
      "feeScopeId",
      "collectionProfile",
      "implementationArtifactRef",
      "implementationArtifactSha256",
      "modes"
    ], add)) continue;
    validateSlug(mapping.surfaceId, `${path}.surfaceId`, add);
    validateSlug(mapping.marketRef, `${path}.marketRef`, add);
    validateSlug(mapping.feeScopeId, `${path}.feeScopeId`, add);
    if (!COLLECTION_PROFILE_SET.has(mapping.collectionProfile)) add(`${path}.collectionProfile`, "must be a canonical fee-v2 collection profile");
    validateSlug(mapping.implementationArtifactRef, `${path}.implementationArtifactRef`, add);
    validatePattern(mapping.implementationArtifactSha256, NONZERO_SHA256_PATTERN, `${path}.implementationArtifactSha256`, "must be a non-placeholder sha256 digest", add);
    if (mapping.marketRef !== receipt.scope?.marketRef) add(`${path}.marketRef`, "must equal the receipt scope marketRef");
    if (mapping.feeScopeId !== receipt.scope?.feeScopeId) add(`${path}.feeScopeId`, "must equal the receipt feeScopeId");
    if (mapping.collectionProfile !== receipt.scope?.collectionProfile) add(`${path}.collectionProfile`, "must equal the receipt collection profile");
    if (mapping.implementationArtifactRef !== receipt.implementation?.artifactRef) add(`${path}.implementationArtifactRef`, "must equal the receipt implementation artifactRef");
    if (mapping.implementationArtifactSha256 !== receipt.implementation?.artifactSha256) add(`${path}.implementationArtifactSha256`, "must equal the receipt implementation digest");
    if (!Array.isArray(mapping.modes) || mapping.modes.length === 0) {
      add(`${path}.modes`, "must contain every exposed mode for this surface");
      continue;
    }
    assertSortedUnique(mapping.modes.map((mode) => mode?.id), `${path}.modes`, "id", add);
    for (const [modeIndex, mode] of mapping.modes.entries()) {
      const modePath = `${path}.modes[${modeIndex}]`;
      if (!exactKeys(mode, modePath, ["id", "executionModel", "direction", "exactness", "quoteRole"], add)) continue;
      validateSlug(mode.id, `${modePath}.id`, add);
      if (!EXECUTION_MODEL_SET.has(mode.executionModel)) add(`${modePath}.executionModel`, "is not supported");
      if (!DIRECTION_SET.has(mode.direction)) add(`${modePath}.direction`, "is not supported");
      if (!EXACTNESS_SET.has(mode.exactness)) add(`${modePath}.exactness`, "is not supported");
      if (!QUOTE_ROLE_SET.has(mode.quoteRole)) add(`${modePath}.quoteRole`, "is not supported");
      const modeKey = `${mapping.surfaceId}:${mode.id}`;
      if (declaredModeKeys.has(modeKey)) add(modePath, "duplicates a surface and mode mapping");
      else declaredModeKeys.add(modeKey);
      if (receipt.scope?.collectionProfile === "standard-amm") {
        const quadrant = `${mode.direction}-${mode.exactness}`;
        if (mode.executionModel !== "synchronous") add(`${modePath}.executionModel`, "standard-amm modes must be synchronous");
        if (!STANDARD_AMM_QUADRANT_SET.has(quadrant)) add(modePath, "standard-amm modes must use an exact direction and exactness quadrant");
        else standardQuadrants.add(quadrant);
        if (mode.id !== quadrant) add(`${modePath}.id`, `standard-amm mode id must equal ${quadrant}`);
        if (mode.quoteRole === "profile-specific") add(`${modePath}.quoteRole`, "standard-amm mode must declare specified or unspecified quote role");
      }
    }
  }
  if (receipt.scope?.collectionProfile === "standard-amm") {
    for (const quadrant of STANDARD_AMM_QUADRANTS_V1) {
      if (!standardQuadrants.has(quadrant)) add("$.surfaceScopeMappings", `standard-amm coverage is missing ${quadrant}`);
    }
  }
  return declaredModeKeys;
}

function validateVectorSet(vectorSet, declaredModeKeys, add) {
  if (!exactKeys(vectorSet, "$.vectorSet", ["evidenceRef", "sha256", "modeCoverage", "assertionCoverage"], add)) return;
  validateSlug(vectorSet.evidenceRef, "$.vectorSet.evidenceRef", add);
  validatePattern(vectorSet.sha256, NONZERO_SHA256_PATTERN, "$.vectorSet.sha256", "must be a non-placeholder sha256 digest", add);
  const coveredModeKeys = new Set();
  if (!Array.isArray(vectorSet.modeCoverage) || vectorSet.modeCoverage.length === 0) {
    add("$.vectorSet.modeCoverage", "must cover every declared surface mode");
  } else {
    assertSortedUnique(
      vectorSet.modeCoverage.map((coverage) => `${coverage?.surfaceId ?? ""}:${coverage?.modeId ?? ""}`),
      "$.vectorSet.modeCoverage",
      "surfaceId + modeId",
      add
    );
    for (const [index, coverage] of vectorSet.modeCoverage.entries()) {
      const path = `$.vectorSet.modeCoverage[${index}]`;
      if (!exactKeys(coverage, path, ["surfaceId", "modeId", "vectorIds"], add)) continue;
      validateSlug(coverage.surfaceId, `${path}.surfaceId`, add);
      validateSlug(coverage.modeId, `${path}.modeId`, add);
      validateVectorIds(coverage.vectorIds, `${path}.vectorIds`, add);
      const key = `${coverage.surfaceId}:${coverage.modeId}`;
      if (!declaredModeKeys.has(key)) add(path, "does not resolve to a declared surface mode");
      coveredModeKeys.add(key);
    }
  }
  for (const key of declaredModeKeys) if (!coveredModeKeys.has(key)) add("$.vectorSet.modeCoverage", `missing vector coverage for ${key}`);
  for (const key of coveredModeKeys) if (!declaredModeKeys.has(key)) add("$.vectorSet.modeCoverage", `contains undeclared mode ${key}`);

  if (!Array.isArray(vectorSet.assertionCoverage)) {
    add("$.vectorSet.assertionCoverage", "must be an array");
    return;
  }
  if (vectorSet.assertionCoverage.length !== REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1.length) {
    add("$.vectorSet.assertionCoverage", `must contain exactly ${REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1.length} mandatory assertions`);
  }
  const seen = new Set();
  for (const [index, coverage] of vectorSet.assertionCoverage.entries()) {
    const path = `$.vectorSet.assertionCoverage[${index}]`;
    if (!exactKeys(coverage, path, ["assertionId", "vectorIds"], add)) continue;
    if (!REQUIRED_ASSERTION_SET.has(coverage.assertionId)) add(`${path}.assertionId`, "is not a mandatory fee-v2 assertion");
    if (seen.has(coverage.assertionId)) add(`${path}.assertionId`, "must be unique");
    else seen.add(coverage.assertionId);
    if (coverage.assertionId !== REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1[index]) {
      add(`${path}.assertionId`, "must use canonical policy assertion order");
    }
    validateVectorIds(coverage.vectorIds, `${path}.vectorIds`, add);
  }
  for (const id of REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1) {
    if (!seen.has(id)) add("$.vectorSet.assertionCoverage", `missing mandatory assertion ${id}`);
  }
}

function validateExpectations(receipt, expected, add) {
  if (!isObject(expected)) {
    add("$.expected", "must be an object when supplied");
    return;
  }
  if (expected.applicationId !== undefined && receipt.applicationId !== expected.applicationId) add("$.applicationId", "does not match expected applicationId");
  const expectedScope = expected.feeScope;
  if (expectedScope !== undefined) {
    if (!isObject(expectedScope)) add("$.expected.feeScope", "must be an object");
    else {
      const expectedFeeScopeId = expectedScope.feeScopeId ?? expectedScope.id;
      for (const [field, actual, wanted] of [
        ["feeScopeId", receipt.scope?.feeScopeId, expectedFeeScopeId],
        ["marketRef", receipt.scope?.marketRef, expectedScope.marketRef],
        ["chainId", receipt.scope?.chainId, expectedScope.chainId],
        ["collectionProfile", receipt.scope?.collectionProfile, expectedScope.collectionProfile]
      ]) if (wanted !== undefined && actual !== wanted) add(`$.scope.${field}`, `does not match expected ${field}`);
      for (const field of ["poolId", "quoteCurrency"]) {
        if (
          typeof expectedScope[field] === "string"
          && receipt.scope?.[field]?.toLowerCase() !== expectedScope[field].toLowerCase()
        ) add(`$.scope.${field}`, `does not match expected ${field}`);
      }
    }
  }
  if (expected.collectionProfile !== undefined && receipt.scope?.collectionProfile !== expected.collectionProfile) add("$.scope.collectionProfile", "does not match expected collectionProfile");
  if (expected.implementation !== undefined) {
    if (!isObject(expected.implementation)) add("$.expected.implementation", "must be an object");
    else for (const field of ["artifactRef", "artifactSha256", "sourceRef", "revisionObjectId", "treeObjectId", "path"]) {
      if (expected.implementation[field] !== undefined && receipt.implementation?.[field] !== expected.implementation[field]) add(`$.implementation.${field}`, `does not match expected ${field}`);
    }
  }
  if (
    expected.executionSurfaceCoverageSha256 !== undefined
    && receipt.executionSurfaceCoverageSha256 !== expected.executionSurfaceCoverageSha256
  ) add("$.executionSurfaceCoverageSha256", "does not match the exact execution-surface coverage artifact digest");
  if (expected.vectorSetSha256 !== undefined && receipt.vectorSet?.sha256 !== expected.vectorSetSha256) add("$.vectorSet.sha256", "does not match expected vector-set digest");
  if (expected.surfaceScopeMappings !== undefined) {
    if (!Array.isArray(expected.surfaceScopeMappings)) add("$.expected.surfaceScopeMappings", "must be an array");
    else {
      const actualProjection = receipt.surfaceScopeMappings.map(projectSurfaceIdentity);
      const expectedProjection = expected.surfaceScopeMappings.map(projectSurfaceIdentity).sort(compareCanonical);
      if (canonicalJson(actualProjection) !== canonicalJson(expectedProjection)) add("$.surfaceScopeMappings", "does not exactly match expected surface/scope/implementation mappings");
    }
  }
}

function projectSurfaceIdentity(mapping) {
  return {
    surfaceId: mapping?.surfaceId ?? null,
    marketRef: mapping?.marketRef ?? null,
    feeScopeId: mapping?.feeScopeId ?? null,
    collectionProfile: mapping?.collectionProfile ?? null,
    implementationArtifactRef: mapping?.implementationArtifactRef ?? mapping?.artifactRef ?? null,
    implementationArtifactSha256: mapping?.implementationArtifactSha256 ?? mapping?.artifactSha256 ?? null,
    modes: Array.isArray(mapping?.modes)
      ? mapping.modes.map((mode) => ({
        id: mode?.id ?? null,
        executionModel: mode?.executionModel ?? null,
        direction: mode?.direction ?? null,
        exactness: mode?.exactness ?? null,
        quoteRole: mode?.quoteRole ?? null
      }))
      : null
  };
}

function validateVectorIds(value, path, add) {
  if (!Array.isArray(value) || value.length === 0) {
    add(path, "must contain at least one vector id");
    return;
  }
  assertSortedUnique(value, path, "vector id", add);
  for (const [index, id] of value.entries()) validateSlug(id, `${path}[${index}]`, add);
}

function validateSlug(value, path, add) {
  if (typeof value !== "string" || value.length > 160 || !SLUG_PATTERN.test(value)) {
    add(path, "must be a lowercase kebab-case slug of at most 160 characters");
  }
}

function validatePattern(value, pattern, path, message, add) {
  if (typeof value !== "string" || !pattern.test(value)) add(path, message);
}

function exactKeys(value, path, required, add) {
  if (!isObject(value)) {
    add(path, "must be an object");
    return false;
  }
  const allowed = new Set(required);
  for (const key of required) if (!Object.hasOwn(value, key)) add(`${path}.${key}`, "is required");
  for (const key of Object.keys(value)) if (!allowed.has(key)) add(`${path}.${key}`, "is not allowed");
  return true;
}

function assertSortedUnique(values, path, label, add) {
  const filtered = values.filter((value) => typeof value === "string");
  if (new Set(filtered).size !== filtered.length) add(path, `${label} values must be unique`);
  for (let index = 1; index < filtered.length; index += 1) {
    if (filtered[index - 1] >= filtered[index]) {
      add(path, `${label} values must use ascending canonical order`);
      break;
    }
  }
}

function compareCanonical(left, right) {
  const leftJson = canonicalJson(left);
  const rightJson = canonicalJson(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function toBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return null;
}

function normalizeDigestIndex(value, errors) {
  const entries = value instanceof Map
    ? [...value.entries()]
    : isObject(value)
      ? Object.entries(value)
      : null;
  if (entries === null) {
    errors.push("$.evidenceDigests: exact evidence id to sha256 bindings are required");
    return null;
  }
  const index = new Map();
  for (const [ref, digest] of entries) {
    if (typeof ref !== "string" || ref.length === 0 || !NONZERO_SHA256_PATTERN.test(digest ?? "")) {
      errors.push("$.evidenceDigests: every evidence id must bind a non-placeholder sha256 digest");
    } else if (index.has(ref)) {
      errors.push(`$.evidenceDigests: duplicate evidence id ${ref}`);
    } else index.set(ref, digest);
  }
  return index;
}

function safeReceiptDigest(receipt) {
  try {
    return feeConformanceReceiptSha256V1(receipt);
  } catch {
    return null;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Guard the semantic constant at module initialization; schema regex alone cannot
// express the uint256 upper bound without losing canonical decimal serialization.
if (!isCanonicalPositiveUint256DecimalV2(UINT256_MAX_V2.toString())) {
  throw new Error("fee-conformance receipt uint256 validator is inconsistent");
}
