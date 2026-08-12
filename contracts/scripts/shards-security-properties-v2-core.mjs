import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { keccak256, stringToHex } from "viem";

import {
  buildShardsSuccessorManifests,
  canonicalJson,
  verifyShardsSuccessorManifests,
} from "./shards-successor-manifest-core.mjs";

const INPUT_SCHEMA = "programmable.exact-shards-security-properties-input.v2";
const OUTPUT_SCHEMA = "programmable.exact-shards-security-properties.v2";

const REQUIRED_COMPONENT_IDS = [
  "permitVerifier",
  "permitAuthority",
  "feePolicyVerifier",
  "registry",
  "poolManager",
  "defaultRenderer",
  "reviewedFactoryImplementation",
  "routeGatedFactory",
  "atomicLaunchRoute",
  "pairDeploymentCoordinator",
  "shardToken",
  "shardHook",
  "shardNft",
];

const PROPERTY_POLICY = {
  "SP-EIP712-DOMAIN": ["signatures", "ONCHAIN_AND_GOLDEN_VECTOR"],
  "SP-PERMIT-REPLAY": ["signatures", "ONCHAIN"],
  "SP-PERMIT-CANCELLATION": ["signatures", "ONCHAIN"],
  "SP-RELEASE-BINDING": ["signatures", "ONCHAIN"],
  "SP-CREATE2-GRAPH": ["deployment", "ONCHAIN"],
  "SP-DELEGATECALL-GATE": ["deployment", "ONCHAIN_AND_ARTIFACT_BINDING"],
  "SP-TRANSIENT-REENTRANCY": ["reentrancy", "ONCHAIN_AND_EVM_PROFILE"],
  "SP-V4-RETURN-DELTA": ["uniswap-v4", "ONCHAIN_AND_UPSTREAM_V4_TESTS"],
  "SP-V4-PARTIAL-FILL": ["uniswap-v4", "ONCHAIN"],
  "SP-V4-CANONICAL-POOL": ["uniswap-v4", "ONCHAIN"],
  "SP-V4-FEE-ACCOUNTING": ["uniswap-v4", "ONCHAIN_AND_FUZZ"],
  "SP-ROLLBACK-ATOMICITY": ["lifecycle", "EVM_ATOMICITY_AND_E2E"],
  "SP-REPOSITORY-ONCE": ["lifecycle", "ONCHAIN_AND_CROSS_ROUTE_E2E"],
  "SP-FINALITY": ["lifecycle", "ONCHAIN"],
  "SP-REORG": ["lifecycle", "ONCHAIN"],
  "SP-REGISTRY-LIFECYCLE": ["lifecycle", "ONCHAIN_AND_INVARIANT"],
  "SP-ROLE-SEPARATION": ["access-control", "ONCHAIN_AND_INVARIANT"],
};

const REQUIRED_INVARIANT_IDS = [
  "INV-PERMIT-DIGEST",
  "INV-PERMIT-REPLAY",
  "INV-CANCELLATION",
  "INV-RELEASE-GRAPH",
  "INV-CREATE2-PREDICTION",
  "INV-DELEGATECALL-SURFACE",
  "INV-V4-NONNEGATIVE-DELTA",
  "INV-PARTIAL-FILL",
  "INV-CANONICAL-POOL",
  "INV-FEE-CONSERVATION",
  "INV-FEE-CUMULATIVE",
  "INV-ATOMIC-ROLLBACK",
  "INV-REPOSITORY-ONCE",
  "INV-REGISTRY-MONOTONIC",
  "INV-FEE-POLICY-IMMUTABLE",
  "INV-ONE-USE-REGISTRY",
  "INV-REVOCATION-TERMINAL",
  "INV-ROLE-SEPARATION",
];

const REQUIRED_EVIDENCE_IDS = [
  "permit-golden",
  "permit-authority",
  "fee-policy",
  "registry-lifecycle",
  "registry-invariants",
  "route-factory",
  "real-graph-e2e",
  "cross-route-e2e",
  "hook-fees",
  "hook-attacks",
  "fee-split",
  "shard-launch-factory",
];

const REQUIRED_SOURCE_REQUIREMENT_IDS = [
  "source-eip712",
  "source-permit-replay",
  "source-delegatecall",
  "source-atomic-transient-guard",
  "source-v4-deltas",
  "source-finality-reorg",
];

const PERMIT_AUTHORITY_CLASSES = [
  "DEFAULT_ADMIN",
  "SIGNER_GOVERNOR",
  "RELEASE_GOVERNOR",
  "PAUSER",
  "CANCELLER",
  "CONSUMER",
  "SIGNER",
];
const REGISTRY_AUTHORITY_CLASSES = [
  "DEFAULT_ADMIN",
  "TECHNICAL_APPROVER",
  "LAUNCH_INTENT_APPROVER",
  "WRITER",
  "FINALIZER",
  "REVOKER",
];

const EXTERNAL_GIT_RESOLUTION = {
  commit: "e59bce4fabe43369ebc5a0ef9718fdd73b747c81",
  tree: "fec89669b681b1f26789583e65c754a88797d6b7",
  blobs: {
    sourceModule: "f6ebcd5de53115c573e5ebc3137d621d5b49987f",
    canonicalHashModule: "292e01e357a6f27500cf51eba17cf873026de213",
    canonicalJsonModule: "464f15cb080b36ddf3e1ed8687e55d53e404973d",
    identityValidatorModule: "700fb4e4596351db964e07df659d7da186b9ca38",
    projectionFixtureModule: "6b1a5fd84d68d914a2801185ea32c1cdbc4fdd24",
  },
};

const SLITHER_COMMAND = "audit_tmp_dir=$(mktemp -d /tmp/shards-secure-workflow.XXXXXX); slither . --compile-force-framework foundry --exclude-dependencies --filter-paths 'lib/|test/|script/' --json \"$audit_tmp_dir/slither.json\" 2>&1 | tee \"$audit_tmp_dir/slither.txt\"; slither_code=${pipestatus[1]}";
const SLITHER_RAW_REPORT = {
  sha256: "0x249dafd8882da2390c21bd87d97552ada008834eb9ce27cdb8d0e75e60198bcc",
  byteLength: 10_372_959,
  totalDetectorInstances: 286,
  wholeReportImpactCounts: { high: 8, medium: 87, low: 91, informational: 100 },
};
const SLITHER_TRIAGE_POLICY = {
  "SLITHER-M-001": {
    detector: "incorrect-equality", componentId: "permitAuthority",
    sourcePath: "contracts/src/ProgrammableLaunchPermitAuthorityV1.sol", function: "_grantRole",
    lineRange: [612, 638], findingLines: [614], classification: "INTENTIONAL_EXACT_PREDICATE",
    rawDetectorFingerprintSha256: "0x99a07c81703ca215f4ded91b42ca72bd17f5a2cce1a538b5ce59491a2424f34a",
  },
  "SLITHER-M-002": {
    detector: "incorrect-equality", componentId: "permitAuthority",
    sourcePath: "contracts/src/ProgrammableLaunchPermitAuthorityV1.sol",
    function: "_requirePermitUnspentAndApprovalActive", lineRange: [533, 551], findingLines: [540],
    classification: "INTENTIONAL_EXACT_PREDICATE",
    rawDetectorFingerprintSha256: "0xe6b9c856ddd3472c0badfac8f357de4316eb99dfda50707b8a6938ab8453fcb1",
  },
  "SLITHER-M-003": {
    detector: "incorrect-equality", componentId: "permitAuthority",
    sourcePath: "contracts/src/ProgrammableLaunchPermitAuthorityV1.sol",
    function: "_requirePermitUnspentAndApprovalActive", lineRange: [533, 551], findingLines: [539],
    classification: "INTENTIONAL_EXACT_PREDICATE",
    rawDetectorFingerprintSha256: "0x41e1b5dbf80ddf5aa5dbe1d7b1148af365652e15611cdb98b43e4332b65ac833",
  },
  "SLITHER-M-004": {
    detector: "locked-ether", componentId: "routeGatedFactory",
    sourcePath: "contracts/src/ProgrammableExactShardsRouteGatedFactoryV2.sol", function: "receive",
    lineRange: [20, 294], findingLines: [208, 209, 210], classification: "FALSE_POSITIVE",
    rawDetectorFingerprintSha256: "0x849ea651c3fea90767972dc15912ab04fba98b2159fe134e70b3dac20439016a",
  },
  "SLITHER-M-005": {
    detector: "uninitialized-local", componentId: "permitVerifier",
    sourcePath: "contracts/src/ProgrammableLaunchPermitVerifierV1.sol", function: "generationBindingHash",
    lineRange: [100, 100], findingLines: [100], classification: "FALSE_POSITIVE",
    rawDetectorFingerprintSha256: "0xd0bc975c3405180eec6f72b98e4d9752975ee18434e0d82ffb041943469de011",
  },
  "SLITHER-M-006": {
    detector: "uninitialized-local", componentId: "atomicLaunchRoute",
    sourcePath: "contracts/src/ProgrammableExactShardsAtomicLaunchRouteV1.sol", function: "_runtimeCodeSetHash",
    lineRange: [681, 681], findingLines: [681], classification: "FALSE_POSITIVE",
    rawDetectorFingerprintSha256: "0xa9399cd40279c7ff527d8f85486129fabcc5a7d5e68c00a83770691a7ef25c21",
  },
  "SLITHER-M-007": {
    detector: "uninitialized-local", componentId: "routeGatedFactory",
    sourcePath: "contracts/src/ProgrammableExactShardsRouteGatedFactoryV2.sol", function: "_configurationHash",
    lineRange: [257, 257], findingLines: [257], classification: "FALSE_POSITIVE",
    rawDetectorFingerprintSha256: "0xf971a61ce7d0ab6bbb7959f21be7997d1e9f3e815341ba79760e22cc96e4230e",
  },
  "SLITHER-M-008": {
    detector: "unused-return", componentId: "permitVerifier",
    sourcePath: "contracts/src/ProgrammableLaunchPermitVerifierV1.sol", function: "validEOASignature",
    lineRange: [324, 328], findingLines: [326], classification: "INTENTIONAL_UNUSED_AUXILIARY_RETURN",
    rawDetectorFingerprintSha256: "0xa00f9873ef51a0309130716087d4b210c55031b6278043f9c31f4de53f62eb9b",
  },
  "SLITHER-M-009": {
    detector: "unused-return", componentId: "atomicLaunchRoute",
    sourcePath: "contracts/src/ProgrammableExactShardsAtomicLaunchRouteV1.sol", function: "launch",
    lineRange: [201, 277], findingLines: [236, 237, 238, 239, 240, 241, 242],
    classification: "INTENTIONAL_UNUSED_AUXILIARY_RETURN",
    rawDetectorFingerprintSha256: "0xd9e411a2df069353d635bcb808c05ce63b8dc8275aaff39b5eb204c5d497e7b5",
  },
};

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireExactSet(actual, expected, label) {
  if (!Array.isArray(actual)) throw new TypeError(`${label} must be an array`);
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (canonicalJson(left) !== canonicalJson(right)) throw new Error(`${label} is incomplete or contains drift`);
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
}

function resolveInside(root, path, label) {
  if (typeof path !== "string" || path.length === 0) throw new TypeError(`${label} must be a path`);
  const absolute = resolve(root, path);
  const base = resolve(root);
  if (absolute !== base && !absolute.startsWith(`${base}${sep}`)) throw new Error(`${label} escapes contracts root`);
  return absolute;
}

function requireStringArray(values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== "string" || !value)) {
    throw new TypeError(`${label} must be a non-empty string array`);
  }
  requireUnique(values, label);
}

function validateThreatModel(threatModel) {
  requireObject(threatModel, "threatModel");
  for (const key of ["protectedAssets", "adversaries", "trustedAssumptions", "outOfScope"]) {
    requireStringArray(threatModel[key], `threatModel.${key}`);
  }
}

function validateAccessControlMatrix(matrix) {
  if (!Array.isArray(matrix)) throw new TypeError("accessControlMatrix must be an array");
  requireUnique(matrix.map((entry) => entry.id), "accessControlMatrix ids");
  const permit = matrix.filter((entry) => entry.component === "permitAuthority");
  requireExactSet(permit.map((entry) => entry.authorityClass), PERMIT_AUTHORITY_CLASSES, "permit authority classes");
  for (const entry of permit) {
    requireObject(entry, `accessControlMatrix.${entry.id}`);
    if (typeof entry.power !== "string" || entry.power.length === 0) throw new Error(`${entry.id} power is missing`);
    requireExactSet(
      entry.forbiddenWith,
      PERMIT_AUTHORITY_CLASSES.filter((role) => role !== entry.authorityClass),
      `${entry.id}.forbiddenWith`,
    );
  }
  const registry = matrix.filter((entry) => entry.component === "registry");
  requireExactSet(registry.map((entry) => entry.authorityClass), REGISTRY_AUTHORITY_CLASSES, "registry authority classes");
  for (const entry of registry) {
    if (typeof entry.power !== "string" || entry.power.length === 0) throw new Error(`${entry.id} power is missing`);
    requireExactSet(
      entry.forbiddenWith,
      REGISTRY_AUTHORITY_CLASSES.filter((role) => role !== entry.authorityClass),
      `${entry.id}.forbiddenWith`,
    );
  }
  for (const role of ["IMMUTABLE_ROUTE", "BOUND_APPLICANT_WALLET"]) {
    const matches = matrix.filter((entry) => entry.authorityClass === role);
    if (matches.length !== 1 || matches[0].forbiddenWith?.length !== 0) throw new Error(`${role} matrix row drift`);
  }
  if (matrix.length !== permit.length + registry.length + 2) throw new Error("unexpected access-control matrix row");
}

function validateProperties(input) {
  if (!Array.isArray(input.properties)) throw new TypeError("properties must be an array");
  requireExactSet(input.properties.map((entry) => entry.id), Object.keys(PROPERTY_POLICY), "security property ids");
  const evidenceIds = new Set(input.testEvidence.map((entry) => entry.id));
  const invariantIds = new Set(input.invariants.map((entry) => entry.id));
  const componentIds = new Set(input.componentIds);
  for (const property of input.properties) {
    const expected = PROPERTY_POLICY[property.id];
    if (property.category !== expected[0] || property.enforcement !== expected[1]) {
      throw new Error(`${property.id} category or enforcement drift`);
    }
    if (typeof property.statement !== "string" || property.statement.length < 40) {
      throw new Error(`${property.id} statement is not reviewable`);
    }
    for (const [field, known] of [
      ["componentIds", componentIds],
      ["evidenceIds", evidenceIds],
      ["invariantIds", invariantIds],
    ]) {
      requireStringArray(property[field], `${property.id}.${field}`);
      for (const id of property[field]) if (!known.has(id)) throw new Error(`${property.id} references unknown ${field}: ${id}`);
    }
  }
  const byId = new Map(input.properties.map((entry) => [entry.id, entry]));
  const exactRequirements = {
    "SP-EIP712-DOMAIN": { components: ["permitVerifier", "permitAuthority"], invariants: ["INV-PERMIT-DIGEST"] },
    "SP-PERMIT-REPLAY": { components: ["permitAuthority", "permitVerifier"], invariants: ["INV-PERMIT-REPLAY", "INV-REPOSITORY-ONCE"] },
    "SP-DELEGATECALL-GATE": { components: ["reviewedFactoryImplementation", "routeGatedFactory", "atomicLaunchRoute"], invariants: ["INV-DELEGATECALL-SURFACE"] },
    "SP-TRANSIENT-REENTRANCY": { components: ["permitAuthority", "atomicLaunchRoute"], invariants: ["INV-ATOMIC-ROLLBACK"] },
    "SP-V4-RETURN-DELTA": { components: ["poolManager", "shardHook"], invariants: ["INV-V4-NONNEGATIVE-DELTA"] },
    "SP-V4-PARTIAL-FILL": { components: ["shardHook"], invariants: ["INV-PARTIAL-FILL"] },
    "SP-V4-CANONICAL-POOL": { components: ["poolManager", "shardHook"], invariants: ["INV-CANONICAL-POOL"] },
    "SP-ROLLBACK-ATOMICITY": { components: ["permitAuthority", "atomicLaunchRoute", "routeGatedFactory", "registry"], invariants: ["INV-ATOMIC-ROLLBACK"] },
    "SP-REPOSITORY-ONCE": { components: ["permitAuthority", "registry", "atomicLaunchRoute"], invariants: ["INV-REPOSITORY-ONCE"] },
    "SP-FINALITY": { components: ["registry"], invariants: ["INV-REGISTRY-MONOTONIC"] },
    "SP-REORG": { components: ["registry"], invariants: ["INV-REGISTRY-MONOTONIC"] },
  };
  for (const [id, requirement] of Object.entries(exactRequirements)) {
    requireExactSet(byId.get(id).componentIds, requirement.components, `${id}.componentIds`);
    requireExactSet(byId.get(id).invariantIds, requirement.invariants, `${id}.invariantIds`);
  }
}

function validateEvidenceGraph(input) {
  if (!Array.isArray(input.testEvidence)) throw new TypeError("testEvidence must be an array");
  requireExactSet(input.testEvidence.map((entry) => entry.id), REQUIRED_EVIDENCE_IDS, "test evidence ids");
  requireUnique(input.testEvidence.map((entry) => entry.path), "test evidence paths");
  for (const evidence of input.testEvidence) {
    if (typeof evidence.path !== "string" || !evidence.path.endsWith(".t.sol")) {
      throw new Error(`${evidence.id} is not a Solidity test file`);
    }
    requireStringArray(evidence.functions, `${evidence.id}.functions`);
  }
  if (!Array.isArray(input.invariants)) throw new TypeError("invariants must be an array");
  requireExactSet(input.invariants.map((entry) => entry.id), REQUIRED_INVARIANT_IDS, "invariant ids");
  const evidence = new Map(input.testEvidence.map((entry) => [entry.id, entry]));
  for (const invariant of input.invariants) {
    const record = evidence.get(invariant.evidenceId);
    if (!record || !record.functions.includes(invariant.function)) {
      throw new Error(`${invariant.id} does not resolve to a required test function`);
    }
  }
}

function validateExternalGitResolution(record) {
  requireObject(record, "externalGitObjectResolutions");
  if (record.recordedBy !== "independent-public-identity-lane") throw new Error("external Git resolution provenance drift");
  if (record.commit?.oidSha1 !== EXTERNAL_GIT_RESOLUTION.commit || record.commit?.objectType !== "commit") {
    throw new Error("external Approval commit resolution drift");
  }
  if (record.tree?.oidSha1 !== EXTERNAL_GIT_RESOLUTION.tree || record.tree?.objectType !== "tree") {
    throw new Error("external Approval tree resolution drift");
  }
  if (!Array.isArray(record.blobs) || record.blobs.length !== 5) throw new Error("external Approval blob set is incomplete");
  const blobs = new Map(record.blobs.map((entry) => [entry.label, entry]));
  for (const [label, oid] of Object.entries(EXTERNAL_GIT_RESOLUTION.blobs)) {
    const blob = blobs.get(label);
    if (!blob || blob.oidSha1 !== oid || blob.objectType !== "blob") throw new Error(`external Git blob drift: ${label}`);
  }
  if (record.finalSourceRevisionRegenerationRequired !== false) {
    throw new Error("public identity source revision still requires regeneration");
  }
}

function validateSlitherTriage(slither) {
  if (slither.rawMediumInstances !== 9) throw new Error("Slither raw Medium instance count must remain 9");
  if (slither.actionableMediumFindings !== 0 || slither.untriagedMediumFindings !== 0) {
    throw new Error("Slither actionable or untriaged Medium findings remain");
  }
  if (typeof slither.mediumCountSemantics !== "string" || !slither.mediumCountSemantics.includes("never erase")) {
    throw new Error("Slither raw-versus-actionable count semantics are missing");
  }
  if (slither.triageReviewedBy !== "independent-security-workflow") throw new Error("Slither triage reviewer drift");
  if (!Array.isArray(slither.rawMediumTriage)) throw new TypeError("Slither rawMediumTriage must be an array");
  requireExactSet(slither.rawMediumTriage.map((entry) => entry.id), Object.keys(SLITHER_TRIAGE_POLICY), "Slither triage ids");
  for (const record of slither.rawMediumTriage) {
    const expected = SLITHER_TRIAGE_POLICY[record.id];
    for (const field of [
      "detector",
      "componentId",
      "sourcePath",
      "function",
      "classification",
      "rawDetectorFingerprintSha256",
    ]) {
      if (record[field] !== expected[field]) throw new Error(`${record.id} ${field} triage drift`);
    }
    for (const field of ["lineRange", "findingLines"]) {
      if (canonicalJson(record[field]) !== canonicalJson(expected[field])) throw new Error(`${record.id} ${field} triage drift`);
    }
    if (typeof record.rawInstance !== "string" || record.rawInstance.length < 15) {
      throw new Error(`${record.id} raw detector instance is missing`);
    }
    if (typeof record.rationale !== "string" || record.rationale.length < 40) {
      throw new Error(`${record.id} rationale is not reviewable`);
    }
    if (record.actionable !== false) throw new Error(`${record.id} actionable classification drift`);
  }
  const review = requireObject(slither.manualV4HookReview, "manualV4HookReview");
  const requiredTrue = [
    "allFourEthFeeQuadrantsCorrect",
    "ethSpecifiedChargedBeforeAndFullFillEnforced",
    "ethUnspecifiedChargedAfterOnActualDelta",
    "selfSwapsSkipCallbacksAndChargeExplicitly",
    "exactHookSourceApprovalRemainsValid",
  ];
  const requiredFalse = [
    "externalFeeRecipientCallInsideCallbacks",
    "pairedCallbackScratchReentrancyReachable",
    "requiredSourceFixFound",
  ];
  if (review.reviewedBy !== "independent-security-workflow" || review.componentId !== "shardHook") {
    throw new Error("manual v4 hook review provenance drift");
  }
  for (const field of requiredTrue) if (review[field] !== true) throw new Error(`manual v4 hook review failed: ${field}`);
  for (const field of requiredFalse) if (review[field] !== false) throw new Error(`manual v4 hook review failed: ${field}`);
}

export function validateShardsSecurityInput(input) {
  requireObject(input, "security input");
  if (input.schemaVersion !== INPUT_SCHEMA) throw new Error("security input schema drift");
  if (input.descriptorId !== "programmable.exact-shards.security-properties.v2") throw new Error("descriptor id drift");
  if (input.status !== "REVIEWED_PROPERTIES_SLITHER_PENDING") throw new Error("security input status drift");
  if (input.activationAllowed !== false || input.launchAllowed !== false) throw new Error("security input activates launch");
  if (input.externalAuditClaim !== false || input.externalAuditReport !== null) throw new Error("unsupported audit claim");
  requireExactSet(input.componentIds, REQUIRED_COMPONENT_IDS, "component ids");
  requireObject(input.baseManifests, "baseManifests");
  requireExactSet(Object.keys(input.baseManifests), ["fee", "registry", "route"], "base manifest scopes");
  validateExternalGitResolution(input.externalGitObjectResolutions);
  validateThreatModel(input.threatModel);
  validateEvidenceGraph(input);
  validateAccessControlMatrix(input.accessControlMatrix);
  validateProperties(input);
  if (!Array.isArray(input.sourceRequirements)) throw new TypeError("sourceRequirements must be an array");
  requireExactSet(input.sourceRequirements.map((entry) => entry.id), REQUIRED_SOURCE_REQUIREMENT_IDS, "source requirement ids");
  for (const requirement of input.sourceRequirements) {
    if (!input.componentIds.includes(requirement.componentId)) throw new Error(`${requirement.id} has unknown component`);
    requireStringArray(requirement.includesAll, `${requirement.id}.includesAll`);
  }
  const slither = requireObject(input.slitherEvidence, "slitherEvidence");
  if (slither.requiredForRelease !== true) throw new Error("Slither must be required for release");
  if (slither.status !== "COMPLETE") throw new Error("Slither evidence must be COMPLETE for this release descriptor");
  if (typeof slither.evidencePath !== "string" || !slither.evidencePath.endsWith(".json")) {
    throw new Error("Slither compact evidence path is missing");
  }
  if (!/^0x[0-9a-f]{64}$/u.test(slither.evidenceSha256)) throw new Error("Slither evidence SHA-256 is invalid");
  if (!/^0x[0-9a-f]{64}$/u.test(slither.analyzedComponentBindingSha256)) {
    throw new Error("Slither analyzed component binding is invalid");
  }
  if (slither.actionableHighFindings !== 0) throw new Error("scoped actionable High findings remain");
  if (slither.suppressionsReviewed !== true) throw new Error("Slither suppressions are not reviewed");
  validateSlitherTriage(slither);
  if (typeof input.output !== "string" || !input.output.endsWith(".json")) throw new Error("invalid security output path");
}

function flattenComponents(manifests) {
  const components = new Map();
  for (const scope of ["fee", "registry", "route"]) {
    for (const component of manifests[scope].components) {
      const prior = components.get(component.id);
      if (prior && canonicalJson(prior) !== canonicalJson(component)) throw new Error(`${component.id} binding differs by scope`);
      components.set(component.id, component);
    }
  }
  requireExactSet([...components.keys()], REQUIRED_COMPONENT_IDS, "bound components");
  return components;
}

async function defaultSuccessorLoader(root, input) {
  const result = await buildShardsSuccessorManifests({ contractsRoot: root });
  await verifyShardsSuccessorManifests(result);
  const rawByScope = {};
  for (const scope of ["fee", "registry", "route"]) {
    rawByScope[scope] = await readFile(resolveInside(root, input.baseManifests[scope], `${scope} base manifest`));
  }
  return { manifests: result.manifests, rawByScope };
}

async function defaultTextLoader(path) {
  return readFile(path, "utf8");
}

function exactFunctionPresent(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`, "u").test(source);
}

async function bindTests(root, input, textLoader) {
  const bound = [];
  for (const evidence of input.testEvidence) {
    const absolute = resolveInside(root, evidence.path, `${evidence.id} test evidence`);
    const source = await textLoader(absolute, evidence);
    for (const functionName of evidence.functions) {
      if (!exactFunctionPresent(source, functionName)) throw new Error(`${evidence.id} missing test function ${functionName}`);
    }
    bound.push({
      id: evidence.id,
      path: `contracts/${relative(root, absolute)}`,
      sourceSha256: sha256(source),
      requiredFunctions: evidence.functions,
      requiredFunctionCount: evidence.functions.length,
      exactFunctionsPresent: true,
    });
  }
  return bound;
}

async function bindSources(root, input, components, textLoader) {
  const cache = new Map();
  const results = [];
  for (const requirement of input.sourceRequirements) {
    const component = components.get(requirement.componentId);
    const sourcePath = component.source.path.replace(/^contracts\//u, "");
    const absolute = resolveInside(root, sourcePath, `${requirement.id} component source`);
    let source = cache.get(absolute);
    if (source === undefined) {
      source = await textLoader(absolute, requirement);
      cache.set(absolute, source);
    }
    for (const literal of requirement.includesAll) {
      if (!source.includes(literal)) throw new Error(`${requirement.id} source literal missing: ${literal}`);
    }
    if (sha256(source) !== component.source.sha256) throw new Error(`${requirement.id} source SHA-256 drift`);
    results.push({
      id: requirement.id,
      componentId: requirement.componentId,
      sourcePath: component.source.path,
      sourceSha256: component.source.sha256,
      requiredLiteralCount: requirement.includesAll.length,
      allRequiredLiteralsPresent: true,
    });
  }
  return results;
}

async function bindExternalIdentity(root, input, textLoader) {
  const record = input.externalGitObjectResolutions;
  const absolute = resolveInside(root, record.goldenPath, "public identity golden");
  const raw = await textLoader(absolute, record);
  const golden = JSON.parse(raw);
  const formula = requireObject(golden.approvalFormula, "public identity approval formula");
  if (
    formula.sourceFormulaObservedAtCommit !== record.commit.oidSha1
    || formula.sourceFormulaObservedAtTree !== record.tree.oidSha1
    || formula.finalSourceRevisionRegenerationRequired !== false
  ) throw new Error("public identity golden commit/tree resolution drift");
  const goldenBlobFields = {
    sourceModule: "sourceModuleGitBlobSha1",
    canonicalHashModule: "canonicalHashModuleGitBlobSha1",
    canonicalJsonModule: "canonicalJsonModuleGitBlobSha1",
    identityValidatorModule: "identityValidatorModuleGitBlobSha1",
    projectionFixtureModule: "projectionFixtureModuleGitBlobSha1",
  };
  for (const blob of record.blobs) {
    if (formula[goldenBlobFields[blob.label]] !== blob.oidSha1) throw new Error(`public identity golden blob drift: ${blob.label}`);
  }
  return {
    repository: record.repository,
    recordedBy: record.recordedBy,
    crossCheckedAgainstGolden: `contracts/${relative(root, absolute)}`,
    goldenRawBytesSha256: sha256(raw),
    goldenCanonicalJsonSha256: sha256(canonicalJson(golden)),
    commit: record.commit,
    tree: record.tree,
    blobs: record.blobs,
    finalSourceRevisionRegenerationRequired: false,
    liveRemoteResolutionPerformedByThisGenerator: false,
  };
}

async function evaluateSlither(root, input, componentBindingSha256, textLoader) {
  const requested = input.slitherEvidence;
  const absolute = resolveInside(root, requested.evidencePath, "Slither evidence");
  const raw = await textLoader(absolute, requested);
  if (sha256(raw) !== requested.evidenceSha256) throw new Error("Slither evidence SHA-256 drift");
  const evidence = JSON.parse(raw);
  if (evidence.schemaVersion !== "programmable.shards-slither-evidence.v2" || evidence.status !== "COMPLETE") {
    throw new Error("Slither evidence schema or status drift");
  }
  if (evidence.workingDirectory !== "contracts" || evidence.command !== SLITHER_COMMAND) {
    throw new Error("Slither exact command binding drift");
  }
  if (evidence.commandRecordedFromPreservedAuditorSession !== true) {
    throw new Error("Slither command provenance is not reviewer-confirmed");
  }
  const toolchain = requireObject(evidence.toolchain, "Slither toolchain");
  const exactToolchain = {
    slither: "0.11.5",
    forge: "1.7.1",
    forgeCommit: "4072e487",
    solc: "0.8.26+commit.8a97fa7a",
    foundryProfile: "default",
    optimizerEnabled: true,
    optimizerRuns: 1000,
    evmVersion: "cancun",
    bytecodeHash: "none",
    cborMetadata: false,
  };
  if (canonicalJson(toolchain) !== canonicalJson(exactToolchain)) throw new Error("Slither toolchain binding drift");
  const rawReport = requireObject(evidence.rawReport, "Slither rawReport");
  for (const field of ["sha256", "byteLength", "totalDetectorInstances", "wholeReportImpactCounts"]) {
    if (canonicalJson(rawReport[field]) !== canonicalJson(SLITHER_RAW_REPORT[field])) {
      throw new Error(`Slither raw report ${field} drift`);
    }
  }
  if (rawReport.committed !== false || rawReport.success !== true) throw new Error("Slither raw report status drift");
  const impactTotal = Object.values(rawReport.wholeReportImpactCounts).reduce((sum, count) => sum + count, 0);
  if (impactTotal !== rawReport.totalDetectorInstances) throw new Error("Slither whole-report impact count mismatch");
  const scoped = requireObject(evidence.scopedReview, "Slither scopedReview");
  if (
    scoped.componentBindingSha256 !== componentBindingSha256
    || requested.analyzedComponentBindingSha256 !== componentBindingSha256
  ) {
    throw new Error("Slither evidence does not bind the current component set");
  }
  const exactScopedCounts = {
    rawHighInstances: 0,
    rawMediumInstances: 9,
    actionableHighFindings: 0,
    actionableMediumFindings: 0,
    untriagedFindings: 0,
    triageRecordCount: 9,
  };
  for (const [field, expected] of Object.entries(exactScopedCounts)) {
    if (scoped[field] !== expected) throw new Error(`Slither scoped ${field} drift`);
  }
  if (
    scoped.allRawMediumInstancesHaveExactTriage !== true
    || scoped.noRawMediumInstanceDiscarded !== true
    || scoped.rawMediumInstances !== requested.rawMediumInstances
    || scoped.actionableMediumFindings !== requested.actionableMediumFindings
    || scoped.untriagedFindings !== requested.untriagedMediumFindings
  ) throw new Error("Slither raw Medium triage count drift");
  const review = requireObject(evidence.review, "Slither evidence review");
  if (
    review.reviewedBy !== requested.triageReviewedBy
    || review.externalAuditClaim !== false
    || review.suppressionsReviewed !== true
    || review.reportAndTriageBindingComplete !== true
    || requested.suppressionsReviewed !== true
  ) {
    throw new Error("Slither evidence review is incomplete");
  }
  return {
    requiredForRelease: true,
    status: "COMPLETE",
    evidencePath: `contracts/${relative(root, absolute)}`,
    evidenceSha256: requested.evidenceSha256,
    analyzedComponentBindingSha256: componentBindingSha256,
    exactCommand: evidence.command,
    toolchain,
    rawReport,
    rawHighInstances: 0,
    rawMediumInstances: 9,
    actionableHighFindings: 0,
    actionableMediumFindings: 0,
    untriagedFindings: 0,
    mediumCountSemantics: requested.mediumCountSemantics,
    rawMediumTriage: requested.rawMediumTriage,
    manualV4HookReview: requested.manualV4HookReview,
    suppressionsReviewed: true,
    gatePassed: true,
    blocker: null,
  };
}

function committedDescriptor(value) {
  return {
    ...value,
    contentCommitment: {
      canonicalization: "RECURSIVE_LEXICOGRAPHIC_OBJECT_KEYS_ARRAY_ORDER_PRESERVED_UTF8_NO_NEWLINE",
      sha256: sha256(canonicalJson(value)),
      keccak256: keccak256(stringToHex(canonicalJson(value))),
    },
  };
}

export async function buildShardsSecurityPropertiesV2({
  contractsRoot,
  inputPath = "spec/shards-security-properties-input-v2.json",
  inputOverride,
  successorLoader = defaultSuccessorLoader,
  textLoader = defaultTextLoader,
} = {}) {
  const root = resolve(contractsRoot ?? resolve(import.meta.dirname, ".."));
  const absoluteInputPath = resolveInside(root, inputPath, "security input");
  const inputRaw = inputOverride === undefined
    ? await readFile(absoluteInputPath)
    : Buffer.from(canonicalJson(inputOverride), "utf8");
  const input = inputOverride ?? JSON.parse(inputRaw);
  validateShardsSecurityInput(input);

  const successor = await successorLoader(root, input);
  const components = flattenComponents(successor.manifests);
  const componentBindings = REQUIRED_COMPONENT_IDS.map((id) => components.get(id));
  const componentBindingSha256 = sha256(canonicalJson(componentBindings));
  const testEvidence = await bindTests(root, input, textLoader);
  const sourceRequirements = await bindSources(root, input, components, textLoader);
  const externalGitObjectResolutions = await bindExternalIdentity(root, input, textLoader);
  const slitherEvidence = await evaluateSlither(root, input, componentBindingSha256, textLoader);

  const baseManifestBindings = {};
  for (const scope of ["fee", "registry", "route"]) {
    const manifest = successor.manifests[scope];
    const raw = successor.rawByScope?.[scope] ?? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (canonicalJson(JSON.parse(raw)) !== canonicalJson(manifest)) throw new Error(`${scope} tracked manifest drift`);
    baseManifestBindings[scope] = {
      path: `contracts/${input.baseManifests[scope]}`,
      schemaVersion: manifest.schemaVersion,
      rawBytesSha256: sha256(raw),
      canonicalJsonSha256: sha256(canonicalJson(manifest)),
      contentCommitment: manifest.contentCommitment,
      activationAllowed: manifest.activationAllowed,
    };
  }

  const propertyEvidence = input.properties.map((property) => ({
    id: property.id,
    category: property.category,
    enforcement: property.enforcement,
    statement: property.statement,
    componentIds: property.componentIds,
    evidenceIds: property.evidenceIds,
    invariantIds: property.invariantIds,
    bindingSha256: sha256(canonicalJson({
      property,
      components: property.componentIds.map((id) => components.get(id)),
      tests: property.evidenceIds.map((id) => testEvidence.find((entry) => entry.id === id)),
      invariants: property.invariantIds.map((id) => input.invariants.find((entry) => entry.id === id)),
    })),
    gatePassed: true,
  }));
  const releaseReady = slitherEvidence.gatePassed === true;
  const descriptor = committedDescriptor({
    schemaVersion: OUTPUT_SCHEMA,
    descriptorId: input.descriptorId,
    status: releaseReady ? "SECURITY_PROPERTIES_RELEASE_GATE_PASSED" : "SECURITY_PROPERTIES_BOUND_SLITHER_PENDING",
    activationAllowed: false,
    launchAllowed: false,
    externalActionOccurred: false,
    assurance: {
      externalAuditClaim: false,
      externalAuditReport: null,
      selfVerifiedMachineProperties: true,
      slitherGatePassed: slitherEvidence.gatePassed,
      releaseReady,
    },
    reviewedInput: {
      path: `contracts/${relative(root, absoluteInputPath)}`,
      rawBytesSha256: sha256(inputRaw),
      canonicalJsonSha256: sha256(canonicalJson(input)),
    },
    baseManifestBindings,
    externalGitObjectResolutions,
    compiler: successor.manifests.route.compiler,
    threatModel: input.threatModel,
    accessControlMatrix: input.accessControlMatrix,
    componentBinding: {
      canonicalSha256: componentBindingSha256,
      sourceAbiArtifactHashReferencesPresent: true,
      rawForgeArtifactShaIsBinding: false,
      components: componentBindings,
    },
    sourceRequirements,
    properties: propertyEvidence,
    invariants: input.invariants,
    testEvidence,
    slitherEvidence,
    verificationSummary: {
      componentCount: componentBindings.length,
      propertyCount: propertyEvidence.length,
      invariantCount: input.invariants.length,
      testEvidenceFileCount: testEvidence.length,
      requiredTestFunctionCount: testEvidence.reduce((sum, entry) => sum + entry.requiredFunctionCount, 0),
      sourceRequirementCount: sourceRequirements.length,
      structuralGatePassed: true,
      sourceAbiArtifactBindingGatePassed: true,
      exactTestEvidenceGatePassed: true,
      externalGitObjectResolutionGatePassed: true,
      slitherGatePassed: slitherEvidence.gatePassed,
      releaseReady,
    },
    deployment: {
      addresses: null,
      transactions: null,
      deployedRuntimeEvidence: null,
      activation: false,
    },
  });
  return { root, input, descriptor };
}

export async function writeShardsSecurityPropertiesV2(result) {
  const output = resolveInside(result.root, result.input.output, "security descriptor output");
  await writeFile(output, `${JSON.stringify(result.descriptor, null, 2)}\n`);
}

export async function verifyShardsSecurityPropertiesV2(result) {
  const output = resolveInside(result.root, result.input.output, "security descriptor output");
  const actual = JSON.parse(await readFile(output, "utf8"));
  if (canonicalJson(actual) !== canonicalJson(result.descriptor)) {
    throw new Error("Shards security-properties V2 descriptor drift; regenerate from reviewed input");
  }
}

export function assertShardsSecurityReleaseReady(result) {
  if (result.descriptor.slitherEvidence.gatePassed !== true || result.descriptor.assurance.releaseReady !== true) {
    throw new Error(
      "Shards security release gate is fail-closed: Slither report, exact component binding and reviewed triage are missing",
    );
  }
}

export const shardsSecurityV2Constants = {
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  REQUIRED_COMPONENT_IDS,
  REQUIRED_EVIDENCE_IDS,
  REQUIRED_INVARIANT_IDS,
  REQUIRED_SOURCE_REQUIREMENT_IDS,
  EXTERNAL_GIT_RESOLUTION,
};
