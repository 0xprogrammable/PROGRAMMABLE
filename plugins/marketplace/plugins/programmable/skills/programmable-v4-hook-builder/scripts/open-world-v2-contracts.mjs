import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import {
  FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID,
  FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID
} from "./fee-conformance-v1-constants.mjs";
import {
  FEE_POLICY_V2_HASH,
  FEE_POLICY_V2_HASH_PREIMAGE,
  FEE_POLICY_V2_ID,
  FEE_POLICY_V2_SCHEMA_ID,
  FEE_POLICY_V2_VERSION,
  PROGRAMMABLE_FEE_V2_OWNER,
  PROGRAMMABLE_RATE_V2
} from "./fee-policy-v2-contract.mjs";
import {
  OpenWorldV2Error,
  canonicalJson,
  isObject,
  sha256Bytes,
  sha256Utf8,
  utf8ByteLength
} from "./open-world-v2-primitives.mjs";

export const OPEN_WORLD_V2_STANDARD_VERSION = "2.0.0";
export const OPEN_WORLD_V2_REPORT_VERSION = "1.0.0";
export const OPEN_WORLD_V2_REVIEW_PACKAGE_IO_LIMITS = Object.freeze({
  extensionSchemaFiles: 1024,
  extensionSchemaBytes: 8 * 1024 * 1024
});
export const PROGRAMMABLE_FEE_V2 = Object.freeze({
  policyId: FEE_POLICY_V2_ID,
  policyVersion: FEE_POLICY_V2_VERSION,
  policyHashPreimage: FEE_POLICY_V2_HASH_PREIMAGE,
  policyHash: FEE_POLICY_V2_HASH,
  policySchemaId: FEE_POLICY_V2_SCHEMA_ID,
  platformHundredthsOfBip: Number(PROGRAMMABLE_RATE_V2),
  owner: PROGRAMMABLE_FEE_V2_OWNER
});
export const OPEN_WORLD_V2_FEE_NOT_APPLICABLE = Object.freeze({
  collectionProfileSchemaId: "urn:programmable:builtin:fee-collection:not-applicable:2.0.0",
  collectionProfile: Object.freeze({
    mode: "not-applicable",
    reason: "no-programmable-canonical-or-unknown-execution-scope"
  })
});

export const OPEN_WORLD_V2_ARTIFACTS = Object.freeze({
  ideaSource: Object.freeze({
    artifactType: "idea-source",
    file: "idea-source.v1.json",
    schemaId: "urn:programmable:idea-source:1.0.0"
  }),
  intentContract: Object.freeze({
    artifactType: "intent-contract",
    file: "intent-contract.v1.json",
    schemaId: "urn:programmable:intent-contract:1.0.0"
  }),
  architectureDecisions: Object.freeze({
    artifactType: "architecture-decisions",
    file: "architecture-decisions.v1.json",
    schemaId: "urn:programmable:architecture-decisions:1.0.0"
  }),
  intentFidelity: Object.freeze({
    artifactType: "intent-fidelity",
    file: "intent-fidelity.v1.json",
    schemaId: "urn:programmable:intent-fidelity:1.0.0"
  })
});

export const OPEN_WORLD_V2_SUBMISSION_FILE = "submission.v2.json";
export const OPEN_WORLD_V2_SUPPORTING_ARTIFACTS = Object.freeze({
  feePolicySchema: Object.freeze({
    artifactType: "fee-policy-schema",
    file: "fee-policy-v2.schema.json",
    schemaId: FEE_POLICY_V2_SCHEMA_ID
  }),
  securityAssessmentSchema: Object.freeze({
    artifactType: "security-assessment-schema",
    file: "security-assessment-v1.schema.json",
    schemaId: "urn:programmable:open-world-security:1.0.0"
  }),
  securityAssessment: Object.freeze({
    artifactType: "security-assessment",
    file: "security-assessment.v1.json",
    schemaId: "urn:programmable:open-world-security:1.0.0"
  })
});
export const OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS = Object.freeze({
  feePolicy: Object.freeze({
    artifactType: "fee-policy",
    file: "fee-policy.v2.json",
    schemaId: FEE_POLICY_V2_SCHEMA_ID
  })
});
export const OPEN_WORLD_V2_FEE_CONFORMANCE_ARTIFACTS = Object.freeze({
  receipt: Object.freeze({
    artifactType: "fee-conformance-receipt",
    schemaId: FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID
  }),
  vectorSet: Object.freeze({
    artifactType: "fee-conformance-vector-set",
    schemaId: FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID
  })
});
export const OPEN_WORLD_V2_TRADE_CAPABILITY_ARTIFACT = Object.freeze({
  artifactType: "trade-capability-manifest",
  schemaId: "urn:programmable:trade-capability-manifest:1.0.0"
});

export const DEFAULT_FRAGMENT_LIMITS = Object.freeze({
  assets: 64,
  markets: 32,
  hooks: 32,
  lifecyclePhases: 128,
  components: 256,
  valueFlows: 256,
  authorities: 128,
  capabilityProfiles: 256,
  facts: 256,
  decisions: 256,
  traces: 256,
  recordBytes: 1048576
});

export const PERMISSION_NAMES = Object.freeze([
  "beforeInitialize",
  "afterInitialize",
  "beforeAddLiquidity",
  "afterAddLiquidity",
  "beforeRemoveLiquidity",
  "afterRemoveLiquidity",
  "beforeSwap",
  "afterSwap",
  "beforeDonate",
  "afterDonate",
  "beforeSwapReturnDelta",
  "afterSwapReturnDelta",
  "afterAddLiquidityReturnDelta",
  "afterRemoveLiquidityReturnDelta"
]);

export const MARKET_EXECUTION_CLASSES = Object.freeze([
  "programmable-canonical",
  "external",
  "non-launchable",
  "unknown"
]);

export const COLLECTION_PROPERTIES = Object.freeze({
  targets: "targets",
  assets: "assets",
  markets: "markets",
  hooks: "hooks",
  "lifecycle-phases": "lifecyclePhases",
  components: "components",
  "value-flows": "valueFlows",
  authorities: "authorities",
  "capability-profiles": "capabilityProfiles"
});

export const severityOrder = Object.freeze({ blocker: 0, review: 1, "split-review": 2 });
export const STRUCTURAL_SPLIT_REVIEW_CODES = new Set([
  "JSON_STRUCTURE_BYTE_LIMIT",
  "JSON_STRUCTURE_DEPTH_LIMIT",
  "JSON_STRUCTURE_NODE_LIMIT"
]);
export const EXTENSION_SPLIT_REVIEW_CODES = new Set([
  "SCHEMA_DEFINITION_DEPTH_LIMIT",
  "SCHEMA_INSPECTION_STEP_LIMIT",
  "SCHEMA_INSPECTION_TIME_LIMIT",
  "VALIDATION_DEPTH_LIMIT",
  "VALIDATION_STEP_LIMIT"
]);
export const EXTENSION_TOOLING_REVIEW_CODES = new Set([
  "SCHEMA_FORMAT_UNSUPPORTED",
  "SCHEMA_KEYWORD_UNSUPPORTED",
  "SCHEMA_PATTERN_TOOLING_REVIEW_REQUIRED",
  "SCHEMA_REFERENCE_UNSUPPORTED"
]);
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const digestPattern = /^sha256:[0-9a-f]{64}$/u;
export const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const referenceDirectory = path.resolve(moduleDirectory, "..", "references");
const bundledSchemaPaths = Object.freeze({
  ideaSource: "idea-source-v1.schema.json",
  intentContract: "intent-contract-v1.schema.json",
  architectureDecisions: "architecture-decisions-v1.schema.json",
  intentFidelity: "intent-fidelity-v1.schema.json",
  submission: "submission-v2.schema.json",
  tradeCapabilityManifest: "trade-capability-manifest-v1.schema.json",
  feePolicySchema: "fee-policy-v2.schema.json",
  securityAssessmentSchema: "open-world-security-v1.schema.json"
});
export const bundledSchemas = Object.freeze(Object.fromEntries(Object.entries(bundledSchemaPaths).map(([key, file]) => [
  key,
  JSON.parse(fatalUtf8Decoder.decode(fs.readFileSync(path.join(referenceDirectory, file))))
])));
const schemaCatalog = JSON.parse(fatalUtf8Decoder.decode(fs.readFileSync(path.join(referenceDirectory, "submission-schema-catalog.json"))));
export const builtinSchemaCatalog = new Map(schemaCatalog.builtinSchemas.map((entry) => [entry.schemaId, entry]));

export function bundledSupportingArtifactDocument(key) {
  if (!Object.hasOwn(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS, key) || !Object.hasOwn(bundledSchemas, key)) throw new OpenWorldV2Error("BUNDLED_SUPPORTING_ARTIFACT_UNKNOWN", `Unknown bundled supporting artifact: ${String(key)}`, { exitCode: 2 });
  return JSON.parse(canonicalJson(bundledSchemas[key]));
}

export function hasExactFeeNotApplicableProfile(fee) {
  const binding = fee?.collectionProfileSchema;
  const profile = fee?.collectionProfile;
  return isObject(binding)
    && Object.keys(binding).sort().join("|") === "byteLength|kind|path|schemaId|sha256"
    && binding.kind === "builtin"
    && binding.schemaId === OPEN_WORLD_V2_FEE_NOT_APPLICABLE.collectionProfileSchemaId
    && binding.path === null
    && binding.sha256 === null
    && binding.byteLength === null
    && isObject(profile)
    && Object.keys(profile).sort().join("|") === "mode|reason"
    && profile.mode === OPEN_WORLD_V2_FEE_NOT_APPLICABLE.collectionProfile.mode
    && profile.reason === OPEN_WORLD_V2_FEE_NOT_APPLICABLE.collectionProfile.reason;
}

export function isExactZeroScopeFeeNotApplicableDeclaration(submission) {
  const fee = submission?.programmableFee;
  const conformance = fee?.conformance;
  const markets = Array.isArray(submission?.markets) ? submission.markets : [];
  return conformance?.status === "not-applicable"
    && hasExactFeeNotApplicableProfile(fee)
    && Array.isArray(fee.feeScopes)
    && fee.feeScopes.length === 0
    && Array.isArray(fee.executionScopeRefs)
    && fee.executionScopeRefs.length === 0
    && Array.isArray(conformance.evidenceRefs)
    && conformance.evidenceRefs.length === 0
    && Array.isArray(conformance.evidenceDigests)
    && conformance.evidenceDigests.length === 0
    && Array.isArray(conformance.scopeArtifacts)
    && conformance.scopeArtifacts.length === 0
    && markets.every((market) => market?.executionClass === "external" || market?.executionClass === "non-launchable");
}

/**
 * Derive the Application V3 fee state from one already validated V2
 * submission. Callers remain responsible for validating the complete V2
 * package and its exact source bytes before treating this projection as
 * evidence.
 */
export function deriveOpenWorldV2FeeApplicability(submission) {
  if (submission?.stage !== "prototype") return "unresolved";
  const fee = submission?.programmableFee;
  const claimAuthority = Array.isArray(submission?.authorities)
    ? submission.authorities.find(({ id }) => id === fee?.claimAuthorityRef)
    : null;
  const immutableFeeIdentity = fee?.policyId === PROGRAMMABLE_FEE_V2.policyId
    && fee?.policyVersion === PROGRAMMABLE_FEE_V2.policyVersion
    && fee?.policyHashPreimage === PROGRAMMABLE_FEE_V2.policyHashPreimage
    && fee?.policyHash === PROGRAMMABLE_FEE_V2.policyHash
    && fee?.platformHundredthsOfBip === PROGRAMMABLE_FEE_V2.platformHundredthsOfBip
    && fee?.owner === PROGRAMMABLE_FEE_V2.owner
    && claimAuthority?.holder === PROGRAMMABLE_FEE_V2.owner
    && claimAuthority?.revocation === "immutable";
  if (!immutableFeeIdentity) return "unresolved";

  const feePolicy = submission?.supportingPackage?.feePolicy;
  if (
    feePolicy === null
    && isExactZeroScopeFeeNotApplicableDeclaration(submission)
  ) return "not-applicable";

  const markets = Array.isArray(submission?.markets) ? submission.markets : [];
  const feeScopes = Array.isArray(fee?.feeScopes) ? fee.feeScopes : [];
  if (
    isObject(feePolicy)
    && feePolicy.artifactType === "fee-policy"
    && feePolicy.schemaId === PROGRAMMABLE_FEE_V2.policySchemaId
    && typeof feePolicy.path === "string"
    && feePolicy.path.length > 0
    && digestPattern.test(feePolicy.sha256 ?? "")
    && !/^sha256:0{64}$/u.test(feePolicy.sha256)
    && Number.isSafeInteger(feePolicy.byteLength)
    && feePolicy.byteLength > 0
    && fee?.conformance?.status === "complete"
    && feeScopes.length > 0
    && markets.some((market) => market?.executionClass === "programmable-canonical")
    && markets.every((market) => market?.executionClass !== "unknown")
  ) return "applicable";

  return "unresolved";
}

export function contentAddressedBinding({ artifactType, schemaId, path: artifactPath, bytes }) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return {
    artifactType,
    schemaId,
    path: artifactPath,
    sha256: sha256Bytes(buffer),
    byteLength: buffer.length
  };
}

export function architectureSnapshot(submission) {
  return {
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
}

export function architectureSnapshotSha256(submission) {
  return sha256Utf8(canonicalJson(architectureSnapshot(submission)));
}

export function idsFor(items) {
  return new Set(Array.isArray(items) ? items.map((entry) => entry?.id).filter((id) => typeof id === "string") : []);
}

export function duplicates(items) {
  const seen = new Set();
  const repeated = new Set();
  for (const item of items) (seen.has(item) ? repeated : seen).add(item);
  return [...repeated].sort();
}
