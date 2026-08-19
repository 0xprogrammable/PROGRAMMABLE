import crypto from "node:crypto";

import { canonicalJsonLegacyV1 as canonicalJson } from "./canonical-json-legacy-adapters.mjs";

import {
  FEE_BEHAVIOR_ASSERTIONS_V1,
  FEE_CONFORMANCE_VECTOR_SET_V1_CONTRACT_ID,
  FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID,
  FEE_CONFORMANCE_VECTOR_SET_V1_VERSION,
  FEE_FUNDING_MODELS_V1,
  FEE_MATH_ASSERTIONS_V1,
  REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1
} from "./fee-conformance-v1-constants.mjs";
import {
  COLLECTION_PROFILES_V2,
  FEE_RATE_DENOMINATOR_V2,
  UINT256_MAX_V2,
  isCanonicalPositiveUint256DecimalV2,
  previewExternallyFundedFeeSplitV2,
  previewFeeSplitV2
} from "./fee-policy-v2-core.mjs";

export {
  FEE_BEHAVIOR_ASSERTIONS_V1,
  FEE_CONFORMANCE_VECTOR_SET_V1_CONTRACT_ID,
  FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID,
  FEE_CONFORMANCE_VECTOR_SET_V1_VERSION,
  FEE_FUNDING_MODELS_V1,
  FEE_MATH_ASSERTIONS_V1
} from "./fee-conformance-v1-constants.mjs";

const COLLECTION_PROFILE_SET = new Set(COLLECTION_PROFILES_V2);
const FUNDING_MODEL_SET = new Set(FEE_FUNDING_MODELS_V1);
const MATH_ASSERTION_SET = new Set(FEE_MATH_ASSERTIONS_V1);
const REQUIRED_ASSERTION_SET = new Set(REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1);
const BEHAVIOR_KIND_SET = new Set(Object.keys(FEE_BEHAVIOR_ASSERTIONS_V1));
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CANONICAL_UINT256_DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/u;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/u;
const NONZERO_BYTES32_PATTERN = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const NONZERO_SHA256_PATTERN = /^sha256:(?!0{64}$)[0-9a-f]{64}$/u;

const BASE_REQUIRED_BEHAVIOR_KINDS = Object.freeze([
  "scope-isolation",
  "claim-authorization-and-destination",
  "claim-remainder-persistence",
  "custody-liability-conservation",
  "callback-authentication",
  "reentrancy-resistance"
]);
const EXTERNAL_REQUIRED_BEHAVIOR_KINDS = Object.freeze([
  "segregated-prefunding-solvency",
  "underfunded-no-state-change",
  "refund-cancel-obligations-preserved"
]);

export function createFeeConformanceVectorSetV1({
  applicationId,
  scope,
  implementationArtifactSha256,
  supportedFundingModels,
  mathVectors,
  behaviorVectors
}) {
  const vectorSet = {
    $schema: FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID,
    schemaVersion: FEE_CONFORMANCE_VECTOR_SET_V1_VERSION,
    contract: {
      id: FEE_CONFORMANCE_VECTOR_SET_V1_CONTRACT_ID,
      version: FEE_CONFORMANCE_VECTOR_SET_V1_VERSION
    },
    applicationId,
    scope,
    implementationArtifactSha256,
    supportedFundingModels,
    mathVectors,
    behaviorVectors
  };
  const errors = validateFeeConformanceVectorSetV1(vectorSet);
  if (errors.length > 0) throw new RangeError(`invalid fee-conformance vector set:\n${errors.join("\n")}`);
  return vectorSet;
}

/** Build a fee-math vector whose expected values come only from authoritative policy math. */
export function createFeeMathVectorV1({
  id,
  surfaceId,
  modeId,
  fundingModel,
  grossQuoteAmount,
  selectedTotalRate,
  platformRemainder = "0",
  projectRemainder = "0",
  evidenceRef,
  evidenceSha256
}) {
  const gross = canonicalUint256String(grossQuoteAmount, "grossQuoteAmount");
  const selected = canonicalUint256String(selectedTotalRate, "selectedTotalRate");
  const platformCarry = canonicalUint256String(platformRemainder, "platformRemainder");
  const projectCarry = canonicalUint256String(projectRemainder, "projectRemainder");
  if (!FUNDING_MODEL_SET.has(fundingModel)) throw new RangeError("unknown fundingModel");
  const external = fundingModel !== "user-funded";
  const split = external
    ? previewExternallyFundedFeeSplitV2({
      grossQuoteAmount: gross,
      selectedTotalRate: selected,
      platformRemainder: platformCarry,
      projectRemainder: projectCarry
    })
    : previewFeeSplitV2({
      grossQuoteAmount: gross,
      selectedTotalRate: selected,
      platformRemainder: platformCarry,
      projectRemainder: projectCarry
    });
  if (!external && !split.atomicGrossFundingSufficient) {
    throw new RangeError("user-funded math vector must leave a positive user quote residual");
  }
  const carriesRemainder = BigInt(platformCarry) !== 0n || BigInt(projectCarry) !== 0n;
  return {
    id,
    surfaceId,
    modeId,
    fundingModel,
    grossQuoteAmount: gross,
    selectedTotalRate: selected,
    platformRemainder: platformCarry,
    projectRemainder: projectCarry,
    externalFundingAmount: external ? split.totalFee.toString() : "0",
    expected: {
      effectiveTotalRate: split.effectiveTotalRate.toString(),
      platformRate: split.platformRate.toString(),
      projectRate: split.projectRate.toString(),
      totalFee: split.totalFee.toString(),
      platformFee: split.platformFee.toString(),
      projectFee: split.projectFee.toString(),
      nextPlatformRemainder: split.nextPlatformRemainder.toString(),
      nextProjectRemainder: split.nextProjectRemainder.toString(),
      settlementReady: true,
      // External high-rate settlement never confiscates the executed gross basis.
      userQuoteResidual: external ? gross : split.netQuoteAmount.toString()
    },
    assertionIds: carriesRemainder ? [...FEE_MATH_ASSERTIONS_V1] : FEE_MATH_ASSERTIONS_V1.slice(0, 3),
    evidenceRef,
    evidenceSha256
  };
}

export function validateFeeConformanceVectorSetV1(vectorSet, { receipt } = {}) {
  const errors = [];
  const add = (path, message) => errors.push(`${path}: ${message}`);
  if (!isObject(vectorSet)) return ["$: vector set must be an object"];
  exactKeys(vectorSet, "$", [
    "$schema",
    "schemaVersion",
    "contract",
    "applicationId",
    "scope",
    "implementationArtifactSha256",
    "supportedFundingModels",
    "mathVectors",
    "behaviorVectors"
  ], add);
  for (const [path, actual, wanted] of [
    ["$.$schema", vectorSet.$schema, FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID],
    ["$.schemaVersion", vectorSet.schemaVersion, FEE_CONFORMANCE_VECTOR_SET_V1_VERSION],
    ["$.contract.id", vectorSet.contract?.id, FEE_CONFORMANCE_VECTOR_SET_V1_CONTRACT_ID],
    ["$.contract.version", vectorSet.contract?.version, FEE_CONFORMANCE_VECTOR_SET_V1_VERSION]
  ]) if (actual !== wanted) add(path, `must equal ${wanted}`);
  exactKeys(vectorSet.contract, "$.contract", ["id", "version"], add);
  validateSlug(vectorSet.applicationId, "$.applicationId", add);
  validateScope(vectorSet.scope, add);
  validatePattern(vectorSet.implementationArtifactSha256, NONZERO_SHA256_PATTERN, "$.implementationArtifactSha256", "must be a non-placeholder sha256 digest", add);

  const supportedFundingModels = validateFundingModels(vectorSet, add);
  const receiptModeKeys = receipt === undefined ? null : validateReceiptBinding(vectorSet, receipt, add);
  const mathState = validateMathVectors(vectorSet, supportedFundingModels, receiptModeKeys, add);
  const behaviorState = validateBehaviorVectors(vectorSet, supportedFundingModels, mathState.modeKeys, add);
  for (const id of mathState.vectorIds) if (behaviorState.vectorIds.has(id)) add("$.behaviorVectors", `vector id ${id} duplicates a math vector id`);

  if (receipt !== undefined) {
    const projection = coverageProjection(vectorSet);
    if (canonicalJson(receipt.vectorSet?.modeCoverage) !== canonicalJson(projection.modeCoverage)) {
      add("$.receipt.vectorSet.modeCoverage", "must exactly project every typed vector for each declared surface mode");
    }
    if (canonicalJson(receipt.vectorSet?.assertionCoverage) !== canonicalJson(projection.assertionCoverage)) {
      add("$.receipt.vectorSet.assertionCoverage", "must exactly project typed vectors for every mandatory assertion");
    }
    if (receipt.vectorSet?.sha256 !== feeConformanceVectorSetSha256V1Unchecked(vectorSet)) {
      add("$.receipt.vectorSet.sha256", "does not match canonical vector-set bytes");
    }
  }
  return [...new Set(errors)].sort();
}

export function projectFeeConformanceVectorCoverageV1(vectorSet) {
  const errors = validateFeeConformanceVectorSetV1(vectorSet);
  if (errors.length > 0) throw new RangeError(`invalid fee-conformance vector set:\n${errors.join("\n")}`);
  return coverageProjection(vectorSet);
}

export function canonicalFeeConformanceVectorSetBytesV1(vectorSet) {
  const errors = validateFeeConformanceVectorSetV1(vectorSet);
  if (errors.length > 0) throw new RangeError(`invalid fee-conformance vector set:\n${errors.join("\n")}`);
  return Buffer.from(`${canonicalJson(vectorSet)}\n`, "utf8");
}

export function feeConformanceVectorSetSha256V1(vectorSet) {
  return `sha256:${crypto.createHash("sha256").update(canonicalFeeConformanceVectorSetBytesV1(vectorSet)).digest("hex")}`;
}

export function feeConformanceVectorEvidenceDigestsV1(vectorSet) {
  const errors = validateFeeConformanceVectorSetV1(vectorSet);
  if (errors.length > 0) throw new RangeError(`invalid fee-conformance vector set:\n${errors.join("\n")}`);
  const digests = {};
  for (const vector of [...vectorSet.mathVectors, ...vectorSet.behaviorVectors]) {
    const prior = digests[vector.evidenceRef];
    if (prior !== undefined && prior !== vector.evidenceSha256) {
      throw new RangeError(`evidence ref ${vector.evidenceRef} declares conflicting digests`);
    }
    digests[vector.evidenceRef] = vector.evidenceSha256;
  }
  return Object.freeze(digests);
}

function validateFundingModels(vectorSet, add) {
  const models = vectorSet.supportedFundingModels;
  if (!Array.isArray(models) || models.length === 0) {
    add("$.supportedFundingModels", "must contain at least user-funded");
    return new Set();
  }
  const seen = new Set();
  let previousIndex = -1;
  for (const [index, model] of models.entries()) {
    const canonicalIndex = FEE_FUNDING_MODELS_V1.indexOf(model);
    if (canonicalIndex === -1) add(`$.supportedFundingModels[${index}]`, "is not a canonical funding model");
    else if (canonicalIndex <= previousIndex) add("$.supportedFundingModels", "must use unique canonical funding-model order");
    else previousIndex = canonicalIndex;
    if (seen.has(model)) add(`$.supportedFundingModels[${index}]`, "must be unique");
    else seen.add(model);
  }
  if (!seen.has("user-funded")) add("$.supportedFundingModels", "must include user-funded boundary behavior");
  const hasExternal = seen.has("sponsor-segregated") || seen.has("collateral-segregated");
  if (hasExternal && vectorSet.scope?.collectionProfile !== "custom-reviewed") {
    add("$.supportedFundingModels", "external high-rate funding is allowed only for custom-reviewed scope profiles");
  }
  if (vectorSet.scope?.collectionProfile === "standard-amm" && (models.length !== 1 || models[0] !== "user-funded")) {
    add("$.supportedFundingModels", "the standard-amm kernel supports only user-funded rates below 100 percent");
  }
  return seen;
}

function validateReceiptBinding(vectorSet, receipt, add) {
  if (!isObject(receipt)) {
    add("$.receipt", "must be an object");
    return new Set();
  }
  if (vectorSet.applicationId !== receipt.applicationId) add("$.applicationId", "does not match receipt applicationId");
  if (!sameScope(vectorSet.scope, receipt.scope)) add("$.scope", "does not exactly match the receipt scope tuple and profile");
  if (vectorSet.implementationArtifactSha256 !== receipt.implementation?.artifactSha256) add("$.implementationArtifactSha256", "does not match receipt implementation digest");
  const modeKeys = new Set();
  for (const mapping of receipt.surfaceScopeMappings ?? []) {
    for (const mode of mapping.modes ?? []) modeKeys.add(`${mapping.surfaceId}:${mode.id}`);
  }
  return modeKeys;
}

function validateMathVectors(vectorSet, fundingModels, receiptModeKeys, add) {
  const vectors = vectorSet.mathVectors;
  const vectorIds = new Set();
  const modeKeys = new Set();
  const categoriesByMode = new Map();
  const externalModelsByMode = new Map();
  const carriedByMode = new Set();
  if (!Array.isArray(vectors) || vectors.length === 0) {
    add("$.mathVectors", "must contain policy math vectors");
    return { vectorIds, modeKeys };
  }
  assertSortedUnique(vectors.map((vector) => vector?.id), "$.mathVectors", "id", add);
  for (const [index, vector] of vectors.entries()) {
    const path = `$.mathVectors[${index}]`;
    if (!exactKeys(vector, path, [
      "id",
      "surfaceId",
      "modeId",
      "fundingModel",
      "grossQuoteAmount",
      "selectedTotalRate",
      "platformRemainder",
      "projectRemainder",
      "externalFundingAmount",
      "expected",
      "assertionIds",
      "evidenceRef",
      "evidenceSha256"
    ], add)) continue;
    validateSlug(vector.id, `${path}.id`, add);
    validateSlug(vector.surfaceId, `${path}.surfaceId`, add);
    validateSlug(vector.modeId, `${path}.modeId`, add);
    vectorIds.add(vector.id);
    const modeKey = `${vector.surfaceId}:${vector.modeId}`;
    modeKeys.add(modeKey);
    if (receiptModeKeys !== null && !receiptModeKeys.has(modeKey)) add(path, "targets a surface mode not declared by the receipt");
    if (!FUNDING_MODEL_SET.has(vector.fundingModel) || !fundingModels.has(vector.fundingModel)) add(`${path}.fundingModel`, "is not declared by supportedFundingModels");
    const gross = validateUint256String(vector.grossQuoteAmount, `${path}.grossQuoteAmount`, add);
    const selected = validateUint256String(vector.selectedTotalRate, `${path}.selectedTotalRate`, add);
    const platformCarry = validateUint256String(vector.platformRemainder, `${path}.platformRemainder`, add);
    const projectCarry = validateUint256String(vector.projectRemainder, `${path}.projectRemainder`, add);
    const externalFunding = validateUint256String(vector.externalFundingAmount, `${path}.externalFundingAmount`, add);
    if (platformCarry !== null && platformCarry >= FEE_RATE_DENOMINATOR_V2) add(`${path}.platformRemainder`, "must be below the rate denominator");
    if (projectCarry !== null && projectCarry >= FEE_RATE_DENOMINATOR_V2) add(`${path}.projectRemainder`, "must be below the rate denominator");
    validateMathAssertions(vector, platformCarry, projectCarry, path, add);
    validateSlug(vector.evidenceRef, `${path}.evidenceRef`, add);
    validatePattern(vector.evidenceSha256, NONZERO_SHA256_PATTERN, `${path}.evidenceSha256`, "must be a non-placeholder sha256 digest", add);
    if ([gross, selected, platformCarry, projectCarry, externalFunding].some((value) => value === null)) continue;
    if (gross === 0n) add(`${path}.grossQuoteAmount`, "must be positive for conformance vectors");
    const external = vector.fundingModel !== "user-funded";
    if (!external && selected >= FEE_RATE_DENOMINATOR_V2) add(`${path}.selectedTotalRate`, "user-funded vectors must stay below 100 percent");
    if (external && selected < FEE_RATE_DENOMINATOR_V2) add(`${path}.selectedTotalRate`, "segregated external funding vectors are reserved for rates at or above 100 percent");
    let split;
    try {
      split = external
        ? previewExternallyFundedFeeSplitV2({
          grossQuoteAmount: gross,
          selectedTotalRate: selected,
          platformRemainder: platformCarry,
          projectRemainder: projectCarry
        })
        : previewFeeSplitV2({
          grossQuoteAmount: gross,
          selectedTotalRate: selected,
          platformRemainder: platformCarry,
          projectRemainder: projectCarry
        });
    } catch (error) {
      add(path, `policy math rejected vector: ${error.message}`);
      continue;
    }
    if (!external && !split.atomicGrossFundingSufficient) add(path, "user-funded vector must leave a positive quote residual");
    if (externalFunding !== (external ? split.totalFee : 0n)) add(`${path}.externalFundingAmount`, "must exactly equal the full segregated fee for external funding and zero for user funding");
    validateMathExpected(vector.expected, split, gross, external, path, add);
    if (platformCarry !== 0n || projectCarry !== 0n) carriedByMode.add(modeKey);
    if (external) {
      const models = externalModelsByMode.get(modeKey) ?? new Set();
      models.add(vector.fundingModel);
      externalModelsByMode.set(modeKey, models);
    } else {
      const categories = categoriesByMode.get(modeKey) ?? new Set();
      categories.add(rateCategory(selected));
      categoriesByMode.set(modeKey, categories);
    }
  }
  if (receiptModeKeys !== null) {
    for (const key of receiptModeKeys) if (!modeKeys.has(key)) add("$.mathVectors", `missing math vectors for receipt mode ${key}`);
    for (const key of modeKeys) if (!receiptModeKeys.has(key)) add("$.mathVectors", `contains undeclared receipt mode ${key}`);
  }
  const requiredModes = receiptModeKeys ?? modeKeys;
  for (const key of requiredModes) {
    const categories = categoriesByMode.get(key) ?? new Set();
    for (const category of ["below-floor", "at-floor", "ordinary", "above-ten-percent"]) {
      if (!categories.has(category)) add("$.mathVectors", `mode ${key} is missing ${category} user-funded policy math`);
    }
    if (!carriedByMode.has(key)) add("$.mathVectors", `mode ${key} is missing a carried-remainder vector`);
    for (const model of fundingModels) {
      if (model !== "user-funded" && !(externalModelsByMode.get(key) ?? new Set()).has(model)) {
        add("$.mathVectors", `mode ${key} is missing high-rate ${model} math`);
      }
    }
  }
  return { vectorIds, modeKeys: requiredModes };
}

function validateMathAssertions(vector, platformCarry, projectCarry, path, add) {
  if (!Array.isArray(vector.assertionIds)) {
    add(`${path}.assertionIds`, "must be an array");
    return;
  }
  const expected = platformCarry !== null && projectCarry !== null && (platformCarry !== 0n || projectCarry !== 0n)
    ? FEE_MATH_ASSERTIONS_V1
    : FEE_MATH_ASSERTIONS_V1.slice(0, 3);
  if (canonicalJson(vector.assertionIds) !== canonicalJson(expected)) {
    add(`${path}.assertionIds`, "must bind exact fee math assertions, adding lifetime carry only for nonzero carried remainders");
  }
  for (const assertion of vector.assertionIds) if (!MATH_ASSERTION_SET.has(assertion)) add(`${path}.assertionIds`, `unsupported math assertion ${assertion}`);
}

function validateMathExpected(expected, split, gross, external, path, add) {
  const expectedPath = `${path}.expected`;
  if (!exactKeys(expected, expectedPath, [
    "effectiveTotalRate",
    "platformRate",
    "projectRate",
    "totalFee",
    "platformFee",
    "projectFee",
    "nextPlatformRemainder",
    "nextProjectRemainder",
    "settlementReady",
    "userQuoteResidual"
  ], add)) return;
  const canonical = {
    effectiveTotalRate: split.effectiveTotalRate.toString(),
    platformRate: split.platformRate.toString(),
    projectRate: split.projectRate.toString(),
    totalFee: split.totalFee.toString(),
    platformFee: split.platformFee.toString(),
    projectFee: split.projectFee.toString(),
    nextPlatformRemainder: split.nextPlatformRemainder.toString(),
    nextProjectRemainder: split.nextProjectRemainder.toString(),
    settlementReady: true,
    userQuoteResidual: external ? gross.toString() : split.netQuoteAmount?.toString()
  };
  for (const [field, wanted] of Object.entries(canonical)) {
    if (expected?.[field] !== wanted) add(`${expectedPath}.${field}`, `must equal authoritative policy result ${wanted}`);
  }
  for (const field of Object.keys(canonical).filter((field) => field !== "settlementReady")) {
    if (field !== "userQuoteResidual" || expected?.[field] !== undefined) validateUint256String(expected?.[field], `${expectedPath}.${field}`, add);
  }
}

function validateBehaviorVectors(vectorSet, fundingModels, modeKeys, add) {
  const vectors = vectorSet.behaviorVectors;
  const vectorIds = new Set();
  const kinds = new Set();
  const kindsByMode = new Map();
  const antiBypassSurfaces = new Set();
  const externalKindsByModel = new Map();
  if (!Array.isArray(vectors) || vectors.length === 0) {
    add("$.behaviorVectors", "must contain typed behavior evidence vectors");
    return { vectorIds };
  }
  assertSortedUnique(vectors.map((vector) => vector?.id), "$.behaviorVectors", "id", add);
  for (const [index, vector] of vectors.entries()) {
    const path = `$.behaviorVectors[${index}]`;
    if (!exactKeys(vector, path, [
      "id",
      "kind",
      "surfaceId",
      "modeId",
      "fundingModel",
      "selectedTotalRate",
      "assertionIds",
      "result",
      "evidenceRef",
      "evidenceSha256"
    ], add)) continue;
    validateSlug(vector.id, `${path}.id`, add);
    vectorIds.add(vector.id);
    if (!BEHAVIOR_KIND_SET.has(vector.kind)) add(`${path}.kind`, "is not a typed fee behavior vector");
    else kinds.add(vector.kind);
    const wantedAssertions = FEE_BEHAVIOR_ASSERTIONS_V1[vector.kind];
    if (wantedAssertions && canonicalJson(vector.assertionIds) !== canonicalJson(wantedAssertions)) add(`${path}.assertionIds`, `must equal ${wantedAssertions.join(",")}`);
    if (Array.isArray(vector.assertionIds)) {
      for (const assertion of vector.assertionIds) {
        if (!REQUIRED_ASSERTION_SET.has(assertion)) add(`${path}.assertionIds`, `unknown assertion ${assertion}`);
      }
    } else {
      add(`${path}.assertionIds`, "must be an array");
    }
    if (vector.result !== "PASS") add(`${path}.result`, "must equal PASS");
    validateSlug(vector.evidenceRef, `${path}.evidenceRef`, add);
    validatePattern(vector.evidenceSha256, NONZERO_SHA256_PATTERN, `${path}.evidenceSha256`, "must be a non-placeholder sha256 digest", add);
    const perMode = vector.kind === "user-funded-rate-boundary" || vector.kind === "execution-counting";
    const perSurface = vector.kind === "entrypoint-anti-bypass";
    const externalKind = EXTERNAL_REQUIRED_BEHAVIOR_KINDS.includes(vector.kind);
    if (perMode) {
      validateSlug(vector.surfaceId, `${path}.surfaceId`, add);
      validateSlug(vector.modeId, `${path}.modeId`, add);
      const key = `${vector.surfaceId}:${vector.modeId}`;
      if (!modeKeys.has(key)) add(path, "does not resolve to a declared surface mode");
      const set = kindsByMode.get(key) ?? new Set();
      set.add(vector.kind);
      kindsByMode.set(key, set);
      if (vector.fundingModel !== "user-funded") add(`${path}.fundingModel`, "per-mode boundary/counting vectors must be user-funded");
      if (vector.kind === "user-funded-rate-boundary") {
        const selected = validateUint256String(vector.selectedTotalRate, `${path}.selectedTotalRate`, add);
        if (selected !== null && selected < FEE_RATE_DENOMINATOR_V2) add(`${path}.selectedTotalRate`, "must prove rejection at or above 100 percent");
      } else if (vector.selectedTotalRate !== null) add(`${path}.selectedTotalRate`, "must be null outside rate-boundary vectors");
    } else if (perSurface) {
      validateSlug(vector.surfaceId, `${path}.surfaceId`, add);
      if (vector.modeId !== null) add(`${path}.modeId`, "must be null for surface-wide anti-bypass evidence");
      if (vector.fundingModel !== null || vector.selectedTotalRate !== null) add(path, "surface anti-bypass evidence has no funding model or selected rate");
      antiBypassSurfaces.add(vector.surfaceId);
    } else if (externalKind) {
      if (vector.surfaceId !== null || vector.modeId !== null || vector.selectedTotalRate !== null) add(path, "external funding solvency behavior is scope-wide");
      if (!FUNDING_MODEL_SET.has(vector.fundingModel) || vector.fundingModel === "user-funded" || !fundingModels.has(vector.fundingModel)) add(`${path}.fundingModel`, "must name a declared segregated external funding model");
      else {
        const set = externalKindsByModel.get(vector.fundingModel) ?? new Set();
        set.add(vector.kind);
        externalKindsByModel.set(vector.fundingModel, set);
      }
    } else {
      if (vector.surfaceId !== null || vector.modeId !== null || vector.fundingModel !== null || vector.selectedTotalRate !== null) add(path, "scope-wide behavior vector must use null mode, funding and rate fields");
    }
  }
  for (const kind of BASE_REQUIRED_BEHAVIOR_KINDS) if (!kinds.has(kind)) add("$.behaviorVectors", `missing required behavior vector ${kind}`);
  for (const key of modeKeys) {
    const perModeKinds = kindsByMode.get(key) ?? new Set();
    for (const kind of ["user-funded-rate-boundary", "execution-counting"]) if (!perModeKinds.has(kind)) add("$.behaviorVectors", `mode ${key} is missing ${kind} evidence`);
  }
  const surfaces = new Set([...modeKeys].map((key) => key.slice(0, key.indexOf(":"))));
  for (const surface of surfaces) if (!antiBypassSurfaces.has(surface)) add("$.behaviorVectors", `surface ${surface} is missing alternate-entrypoint anti-bypass evidence`);
  for (const model of fundingModels) {
    if (model === "user-funded") continue;
    const modelKinds = externalKindsByModel.get(model) ?? new Set();
    for (const kind of EXTERNAL_REQUIRED_BEHAVIOR_KINDS) if (!modelKinds.has(kind)) add("$.behaviorVectors", `${model} is missing ${kind} evidence`);
  }
  return { vectorIds };
}

function coverageProjection(vectorSet) {
  const vectors = [...vectorSet.mathVectors, ...vectorSet.behaviorVectors];
  const byMode = new Map();
  const byAssertion = new Map(REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1.map((id) => [id, []]));
  for (const vector of vectors) {
    if (vector.surfaceId !== null && vector.modeId !== null) {
      const key = `${vector.surfaceId}:${vector.modeId}`;
      const list = byMode.get(key) ?? [];
      list.push(vector.id);
      byMode.set(key, list);
    }
    for (const assertion of vector.assertionIds) {
      const list = byAssertion.get(assertion) ?? [];
      list.push(vector.id);
      byAssertion.set(assertion, list);
    }
  }
  return {
    modeCoverage: [...byMode.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([key, vectorIds]) => {
      const separator = key.indexOf(":");
      return {
        surfaceId: key.slice(0, separator),
        modeId: key.slice(separator + 1),
        vectorIds: [...new Set(vectorIds)].sort(compareStrings)
      };
    }),
    assertionCoverage: REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1.map((assertionId) => ({
      assertionId,
      vectorIds: [...new Set(byAssertion.get(assertionId) ?? [])].sort(compareStrings)
    }))
  };
}

function validateScope(scope, add) {
  if (!exactKeys(scope, "$.scope", ["feeScopeId", "marketRef", "chainId", "poolId", "quoteCurrency", "collectionProfile"], add)) return;
  validateSlug(scope.feeScopeId, "$.scope.feeScopeId", add);
  validateSlug(scope.marketRef, "$.scope.marketRef", add);
  if (!isCanonicalPositiveUint256DecimalV2(scope.chainId)) add("$.scope.chainId", "must be a canonical positive uint256 decimal string");
  validatePattern(scope.poolId, NONZERO_BYTES32_PATTERN, "$.scope.poolId", "must be non-placeholder lowercase bytes32", add);
  validatePattern(scope.quoteCurrency, ADDRESS_PATTERN, "$.scope.quoteCurrency", "must be a lowercase EVM address", add);
  if (!COLLECTION_PROFILE_SET.has(scope.collectionProfile)) add("$.scope.collectionProfile", "must be a canonical fee-v2 collection profile");
}

function rateCategory(selected) {
  if (selected < 1_000n) return "below-floor";
  if (selected === 1_000n) return "at-floor";
  if (selected <= 100_000n) return "ordinary";
  if (selected < FEE_RATE_DENOMINATOR_V2) return "above-ten-percent";
  return "external-high-rate";
}

function sameScope(left, right) {
  return left?.feeScopeId === right?.feeScopeId
    && left?.marketRef === right?.marketRef
    && left?.chainId === right?.chainId
    && left?.poolId?.toLowerCase() === right?.poolId?.toLowerCase()
    && left?.quoteCurrency?.toLowerCase() === right?.quoteCurrency?.toLowerCase()
    && left?.collectionProfile === right?.collectionProfile;
}

function canonicalUint256String(value, label) {
  const normalized = typeof value === "bigint" ? value.toString() : value;
  if (typeof normalized !== "string" || !CANONICAL_UINT256_DECIMAL.test(normalized)) throw new TypeError(`${label} must be a canonical uint256 decimal string`);
  const parsed = BigInt(normalized);
  if (parsed > UINT256_MAX_V2) throw new RangeError(`${label} exceeds uint256`);
  return normalized;
}

function validateUint256String(value, path, add) {
  if (typeof value !== "string" || !CANONICAL_UINT256_DECIMAL.test(value)) {
    add(path, "must be a canonical uint256 decimal string");
    return null;
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX_V2) {
    add(path, "exceeds uint256");
    return null;
  }
  return parsed;
}

function validateSlug(value, path, add) {
  if (typeof value !== "string" || value.length > 160 || !SLUG_PATTERN.test(value)) add(path, "must be a lowercase kebab-case slug of at most 160 characters");
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
  const strings = values.filter((value) => typeof value === "string");
  if (strings.length !== values.length) add(path, `${label} values must be strings`);
  if (new Set(strings).size !== strings.length) add(path, `${label} values must be unique`);
  for (let index = 1; index < strings.length; index += 1) if (strings[index - 1] >= strings[index]) {
    add(path, `${label} values must use ascending canonical order`);
    break;
  }
}

function feeConformanceVectorSetSha256V1Unchecked(vectorSet) {
  return `sha256:${crypto.createHash("sha256").update(Buffer.from(`${canonicalJson(vectorSet)}\n`, "utf8")).digest("hex")}`;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
