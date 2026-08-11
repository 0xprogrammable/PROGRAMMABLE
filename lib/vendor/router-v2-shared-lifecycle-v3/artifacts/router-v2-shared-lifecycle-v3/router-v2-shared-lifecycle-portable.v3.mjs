// src/domain/hashing.ts
import { createHash } from "node:crypto";

// src/domain/canonical-json.ts
import { TextEncoder } from "node:util";
var encoder = new TextEncoder();
var StrictJsonError = class extends SyntaxError {
  offset;
  constructor(message, offset) {
    super(`${message} at byte offset ${offset}`);
    this.name = "StrictJsonError";
    this.offset = offset;
  }
};
function assertUnicodeScalarString(value, offset = 0) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343)) {
        throw new StrictJsonError("Lone high surrogate is not valid canonical JSON", offset + index);
      }
      index += 1;
    } else if (code >= 56320 && code <= 57343) {
      throw new StrictJsonError("Lone low surrogate is not valid canonical JSON", offset + index);
    }
  }
}
function canonicalizeValue(value, active, depth) {
  if (depth > 128) throw new TypeError("Maximum canonical JSON nesting depth exceeded");
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON forbids non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON does not support ${typeof value}`);
  }
  if (active.has(value)) throw new TypeError("Canonical JSON does not support cyclic values");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys2 = Reflect.ownKeys(value);
      if (ownKeys2.some(
        (key) => typeof key !== "string" || key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)
      )) {
        throw new TypeError("Canonical JSON arrays cannot contain symbol or custom properties");
      }
      const elements = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError("Canonical JSON does not support sparse arrays");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === void 0 || descriptor.get !== void 0 || descriptor.set !== void 0 || !("value" in descriptor) || descriptor.enumerable !== true) {
          throw new TypeError("Canonical JSON arrays require enumerable data elements");
        }
        elements.push(canonicalizeValue(descriptor.value, active, depth + 1));
      }
      return `[${elements.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only arrays and plain objects");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new TypeError("Canonical JSON forbids symbol properties");
    }
    const keys = ownKeys;
    const descriptors = /* @__PURE__ */ new Map();
    for (const key of keys) {
      assertUnicodeScalarString(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === void 0 || !descriptor.enumerable || descriptor.get !== void 0 || descriptor.set !== void 0 || !("value" in descriptor)) {
        throw new TypeError("Canonical JSON requires enumerable data properties");
      }
      descriptors.set(key, descriptor);
    }
    keys.sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeValue(descriptors.get(key).value, active, depth + 1)}`).join(",")}}`;
  } finally {
    active.delete(value);
  }
}
function canonicalizeJson(value) {
  return canonicalizeValue(value, /* @__PURE__ */ new WeakSet(), 0);
}

// src/domain/hashing.ts
var HASH_DOMAINS = Object.freeze({
  admissionInput: "programmable.autonomous-approval.admission-input.v1",
  components: "programmable.autonomous-approval.component-closure.v1",
  capabilities: "programmable.autonomous-approval.capability-set.v1",
  valueGraph: "programmable.autonomous-approval.value-flow-graph.v1",
  authorityGraph: "programmable.autonomous-approval.authority-graph.v1",
  obligations: "programmable.autonomous-approval.obligation-set.v1",
  conditions: "programmable.autonomous-approval.condition-set.v1",
  disclosures: "programmable.autonomous-approval.disclosure-set.v1",
  blockerWitnesses: "programmable.autonomous-approval.blocker-witness-set.v1",
  decisionReceipt: "programmable.autonomous-approval.decision-receipt.v1"
});
function canonicalSha256(domain, value) {
  if (!/^programmable\.[a-z0-9.-]+\.v[1-9][0-9]*$/.test(domain)) {
    throw new TypeError("Hash domain must be a versioned Programmable namespace");
  }
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update(Uint8Array.of(0));
  hash.update(canonicalizeJson(value), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

// src/internal/router-self-service-v1/keccak.ts
var UINT64_MASK = (1n << 64n) - 1n;
var KECCAK_RATE_BYTES = 136;
var KECCAK_ROUND_CONSTANTS = Object.freeze([
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n
]);
var KECCAK_ROTATIONS = Object.freeze([
  0,
  1,
  62,
  28,
  27,
  36,
  44,
  6,
  55,
  20,
  3,
  10,
  43,
  25,
  39,
  41,
  45,
  15,
  21,
  8,
  18,
  2,
  61,
  56,
  14
]);
function keccak256V1(input) {
  if (!(input instanceof Uint8Array)) throw new TypeError("keccak256 input must be bytes");
  const paddedLength = Math.ceil((input.byteLength + 1) / KECCAK_RATE_BYTES) * KECCAK_RATE_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.byteLength] = 1;
  padded[padded.length - 1] = padded[padded.length - 1] | 128;
  const state = Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += KECCAK_RATE_BYTES) {
    for (let lane = 0; lane < KECCAK_RATE_BYTES / 8; ++lane) {
      state[lane] = state[lane] ^ littleEndianLane(padded, offset + lane * 8);
    }
    keccakPermutation(state);
  }
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; ++index) {
    output[index] = Number(
      state[Math.floor(index / 8)] >> BigInt(index % 8 * 8) & 0xffn
    );
  }
  return `0x${Buffer.from(output).toString("hex")}`;
}
function littleEndianLane(bytes, offset) {
  let lane = 0n;
  for (let index = 0; index < 8; ++index) {
    lane |= BigInt(bytes[offset + index]) << BigInt(index * 8);
  }
  return lane;
}
function rotateLeft64(value, shift) {
  if (shift === 0) return value & UINT64_MASK;
  const width = BigInt(shift);
  return (value << width | value >> 64n - width) & UINT64_MASK;
}
function keccakPermutation(state) {
  for (const roundConstant of KECCAK_ROUND_CONSTANTS) {
    const columns = Array(5).fill(0n);
    for (let x = 0; x < 5; ++x) {
      for (let y = 0; y < 5; ++y) columns[x] = columns[x] ^ state[x + y * 5];
    }
    const deltas = columns.map((_, x) => columns[(x + 4) % 5] ^ rotateLeft64(columns[(x + 1) % 5], 1));
    for (let x = 0; x < 5; ++x) {
      for (let y = 0; y < 5; ++y) state[x + y * 5] = state[x + y * 5] ^ deltas[x];
    }
    const rotated = Array(25).fill(0n);
    for (let x = 0; x < 5; ++x) {
      for (let y = 0; y < 5; ++y) {
        rotated[y + (2 * x + 3 * y) % 5 * 5] = rotateLeft64(state[x + y * 5], KECCAK_ROTATIONS[x + y * 5]);
      }
    }
    for (let x = 0; x < 5; ++x) {
      for (let y = 0; y < 5; ++y) {
        state[x + y * 5] = (rotated[x + y * 5] ^ ~rotated[(x + 1) % 5 + y * 5] & rotated[(x + 2) % 5 + y * 5]) & UINT64_MASK;
      }
    }
    state[0] = state[0] ^ roundConstant;
  }
}

// src/internal/router-self-service-v1/completed-graph-adoption-contract-binding-v1.ts
var PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_ENUMS_V1 = deepFreeze({
  capabilitySemantics: { Invalid: 0, Adopt: 1 },
  admissionStatus: { Invalid: 0, DenyPendingReviewAndDeploymentEvidence: 1, Admitted: 2 },
  profileStatus: { Invalid: 0, Active: 1, Suspended: 2, Deprecated: 3 },
  executionTimeConstraint: {
    Invalid: 0,
    AdoptionOnlyNoExecution: 1,
    ExternalExecutionTimeBound: 2
  },
  executionReadiness: {
    Invalid: 0,
    CompletedGraphAdoptionOnly: 1,
    DenyPendingReviewAndDeploymentEvidence: 2
  },
  launchClassification: {
    Invalid: 0,
    CompletedGraphAdoption: 1,
    OptionalComponentGraphAdoption: 2
  }
});
var sha = (value) => `sha256:${value}`;
var INDEPENDENT_GATE_RECEIPT_CORE = Object.freeze({
  schemaVersion: "programmable.completed-graph-adoption-independent-gate-receipt.v1",
  commit: "ea0e4424b886a0c1ae928fc73d62bd8e907b44cd",
  tree: "8c5e0822d7ff256cad3d9e0350c980473d36aecc",
  artifactSha256: sha("f9d110d2850c4934ba0c22493eaa9d0f090bee6f0e6a1339ee3002344da1065a"),
  verdict: "CONDITIONAL_SOURCE_ARTIFACT_PASS",
  contractSecurityP0: 0,
  contractSecurityP1: 0,
  detachedReproduction: "PASS",
  consumerCompatibility: "PASS",
  focusedTests: 36,
  winnerFuzzRuns: 1e4,
  abiCount: 8,
  selectorCount: 30,
  typehashCount: 43,
  canonicalConstantCount: 15,
  gasSnapshotPath: ".gas-snapshot",
  gasSnapshotSha256: sha("3657574a012b3682c74d50a7507357afb3311d5180acd82c3c735402e3b87e6f"),
  canonicalStandardJsonSha256: sha("1104c2a0c6c439df6037e368bf60c375ad9e4e0b06ec979f5a37cbad93daef99"),
  detachedBuildInfoSha256: sha("cb5481447d15406f7a210bca1529368a85cb92902171267136197842a6816683"),
  canonicalStandardJsonReceipt: {
    sha256: sha("1104c2a0c6c439df6037e368bf60c375ad9e4e0b06ec979f5a37cbad93daef99"),
    path: null,
    notRepositoryArtifact: true
  },
  detachedBuildInfoReceipt: {
    sha256: sha("cb5481447d15406f7a210bca1529368a85cb92902171267136197842a6816683"),
    path: null,
    notRepositoryArtifact: true
  },
  deploymentCovered: false,
  activationCovered: false,
  externalAuditReceiptPath: null,
  externalAuditReceiptSha256: null
});
var SELECTORS = Object.freeze({
  registerAdoptionProfileV1: "0xb35544a4",
  setAdoptionProfileStatusV1: "0xd004d1b8",
  setGlobalAdoptionKillV1: "0xa4483ca4",
  activateLaunchGrantV1: "0x7bef77f0",
  revokeLaunchGrantV1: "0xc53aaad3",
  revokeExecutionCurrentnessV1: "0x2423590e",
  adoptCompletedGraphV1: "0x4e0aca2e",
  advanceFinalityIndexingV1: "0xdab904dc",
  advanceSecurityPolicyEpochsV1: "0xd34530e0",
  launchGrantDigest: "0x71b1fd16",
  executionCurrentnessDigest: "0x6b7fdd60",
  preflightControlStateV1: "0x4b9956b9",
  preflightGrantReceiptStateV1: "0x93d83146",
  preflightComponentStateV1: "0x481b029d",
  canonicalReceiptCore: "0x0542d36f",
  adoptionPreflightReadbackV1: "0xc96dd959",
  computeAdoptionPreflightAggregateV1: "0x711d856f",
  verifyCurrentStateV1: "0x46e6a40e",
  validateProfileCapabilityV1: "0xb0742795",
  validateLaunchGrantV1: "0xf6722097",
  validateAdoptionEnvelopeV1: "0xa7461668",
  computeSourceCommitHash: "0x272bfb97",
  computeSourceTreeHash: "0x15e5418e",
  computeStampLaunchId: "0x5e75e08c",
  computeWinnerKeyHash: "0xa81966af",
  sourceRevisionMatches: "0x03489345",
  computeAdoptionPreflightQueryHash: "0xc88ac9a5",
  computeAdoptionPreflightComponentLeafHash: "0xe0fb2b31",
  computeAdoptionPreflightGlobalHeadHash: "0xc0ff2fb5",
  computeAdoptionPreflightReadbackHash: "0x66dd2481"
});
var TYPEHASHES = Object.freeze({
  profileKey: "0x9a25d44486e0f5da0c0cc7d5056ed14417af084bed8a0423240224b21873c303",
  plan: "0x805cdb8d5243266cd4de117238139815637ae34b43729a8e6414cf458404b2bb",
  sourceCommit: "0x6221b4052987e4949872d24c485f8a71e43870d23253337dd9790a0d1b1eea77",
  sourceTree: "0x4502ffc7dd7543b715f1a350448998f257045a66ed8d453f207529cc903318c0",
  launchGrantBindingA: "0x6373614d13166df962b9ca91b7de99c21e0771d33aec15051550c9aa184dcec2",
  launchGrantBindingB: "0x868b8ac64fe6e7697770adb355fe0641961e7842b4f63486a14d25015cf4b4ac",
  launchGrantReview: "0xd4ece64261d615a8f4898a5b37753589a42dd09302ca03226e5731e5675bf122",
  launchGrant: "0x3b56d205c1923d957a4baf5345745b739502f4a61c6c9c702b86f3bf888cb21a",
  executionCurrentness: "0x80da2016dad2177f0f808bda1cd467a9b4fc95293a112c7e49a7444d861a88db",
  preflightQuery: "0x1f3f5062fa7410c2f889bdbab98c86b0059a5a1670845167541edbdcae27b8aa",
  preflightRuntimeControl: "0x8f809ecf56042f140caa365c8e024b29949dcb9e77b3c485a19643241c7e89bb",
  preflightLifecycle: "0x7c7dca0a5c187e4f351f9b64042e6c481cf2bb1098c61db98ebb10fd2d8b68db",
  preflightReservation: "0xa2ea343354998fbef45ee6b687dbe26bbfe21d57a0cdc0b13dd4852850f610a7",
  preflightComponentLeaf: "0x3f43d44bb443a48c7bb43bcaf77f31cd72cca0cad2dda7524b0635157ce252f9",
  preflightGlobalHead: "0xdee47b7e5a0efe12953554073a6a17189af47aa9d8a8850417afc4e66e821139",
  preflightReadback: "0xe158a2f1ef93fdb06a11589ee27fbfd57218c0325fde089ca4ee45832daeab0e",
  adoptionRequest: "0xd720a3bb8eaa496619389814b1f5089383d8120cb782f8f8de6a543ae7d65282",
  profileCapability: "0x6d7ab9935123d92d1e8635f5abb4c796e34a83de7cfd44e85499783a54b593e6",
  stampLaunchId: "0x09a20fe5a6d4f9a91cda72ce66220db7fa7e040d190f66422d99c4e7dab72f13",
  winnerKey: "0x170be498006d706782775a51221ef03d8caa6029d211c1ab147929da5587e46d",
  component: "0xcdd03ae75671e4867e6736a6cf24db2bf1aaa356a3a58e1e45a08b648e09af06",
  componentConfiguration: "0x1253f0a73a66a5829720d0c57e61e545201c77fcabfb2c1a4440f57c9ec44c3a",
  sharedComponentIdentity: "0xaf5d15890cdece2279c56c3eb2cb55ebd231ad6b52bf08afe8d12edaf6aa3c14",
  componentCreationEvidence: "0x8e86028956a4e6bb49c599f177ad98ba38ee3bda010b2be4f0c1bb0f56efc8b8",
  componentCreationEvidenceSource: "0xec9ff60ed640455bd96e6a1d2e1f73413301f333661f6b3b929319e96867ab0b",
  componentCreationEvidenceComponent: "0xf8363305f8a480f9d253a545605a1a155d3828ba40319347d57a1b5c3f8d969c",
  creationReceiptEvidence: "0xe98d854764395c75afe4d6f0c7a59ed13212fcc9b8eada07a7ab55ce11e7e530",
  edge: "0x6b1c7fd87bcd073750ba10f3065f65834ab49e2c15966de1f932fbeb812ddb1a",
  componentGraph: "0x12660ca1683041a564455ceef1c1cce5d8be7c40fdb30b82094a1f28f6229e63",
  runtimeSet: "0x5280c798edc7ae0d7d38c3ba133d94c61a2320b513bc6285c1feb0812308319d",
  configurationSet: "0x8bf0533d8cc244c8aa659dce00c39f372cd19c6e84bd606e1c67378a5fc05463",
  configuration: "0x621f11ade2adc9295784f1796d7d4f0a2ec6cff21f1434f2996b47c8e269a1fd",
  result: "0x1ba6c743524c56589b68430a5ca12d963859b02bb84811cc1a5b5b2d2bcc2357",
  applicationIdentity: "0x53bafaa1f1263dd1de9b54d09d55214a7ce1515141054d4c9d6d16bdfc34d57c",
  canonicalReceiptCore: "0xfbc43d14cb32d75fb719805f1b8f5c17519cf9410710ec067d8684b57a646491",
  finalityIndexingReceipt: "0xa2aedbb59f3b10bfe02c86eb231f70247312a652def209b803045e4ae2a65343",
  grantStateHead: "0x8a520d97e0f1b1a0d51f6b781b11b6c579d8bb18382df193606c0b83b30c1b7a",
  preflightAuthorityRoles: "0xc99ae98599426067f53a7bfe1a2a0a25fe2c820f003793fb5960ff71aa82473b",
  preflightCoreDependencies: "0x7ddf0274f2363b9d004915645e62d8b4305e5b76c53bb86dd9e29a69ab9f9644",
  preflightBaseRuntimeBinding: "0xc4ee4c70e1f16cf3b57ad669a86b8e38de4efcc7a1ada83d00b5b57634a50b3d",
  preflightProfileRuntimeBinding: "0xe0aacb28c0cc4eaa45bbd334b05ad2585658b92d4a01f19c6af2bd9016de99ed",
  preflightRuntimeAuthorityBinding: "0x98c82081678d57ea993f328a2ba231ba9677f155689a88c13948064a949a06f2",
  eip712Domain: "0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f"
});
var TYPEHASH_PREIMAGES = Object.freeze({
  profileKey: { constant: "PROFILE_KEY_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionProfileV1(bytes32 profileDescriptorHash,bytes32 routeSchemaHash)" },
  plan: { constant: "PLAN_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPlanV1(bytes32 abiEncodedPlanHash)" },
  sourceCommit: { constant: "SOURCE_COMMIT_TYPEHASH", preimage: "ProgrammableCompletedGraphSourceCommitV1(bytes20 gitObjectId)" },
  sourceTree: { constant: "SOURCE_TREE_TYPEHASH", preimage: "ProgrammableCompletedGraphSourceTreeV1(bytes20 gitObjectId)" },
  launchGrantBindingA: { constant: "LAUNCH_GRANT_BINDING_A_TYPEHASH", preimage: "ProgrammableCompletedGraphLaunchGrantBindingAV1(uint256 chainId,address registry,address launchWallet,bytes32 applicantIdHash,bytes32 profileKey,bytes32 profileDescriptorHash,bytes32 exactContractBindingHash,bytes32 contractPlanHash,bytes32 applicantPlanArtifactHash,bytes32 adoptionIntentHash,uint8 executionReadiness,bytes32 executionReadinessConstraintHash)" },
  launchGrantBindingB: { constant: "LAUNCH_GRANT_BINDING_B_TYPEHASH", preimage: "ProgrammableCompletedGraphLaunchGrantBindingBV1(uint8 executionTimeConstraint,bytes32 executionTimeConstraintEvidenceHash,bytes32 sourceRepositoryHash,bytes32 sourceCommitHash,bytes32 sourceTreeHash,bytes32 sourceLaunchId,bytes32 componentGraphHash,bytes32 exactRuntimeSetHash,bytes32 componentConfigurationSetHash,bytes32 revenueBindingHash,bytes32 resultHash)" },
  launchGrantReview: { constant: "LAUNCH_GRANT_REVIEW_TYPEHASH", preimage: "ProgrammableCompletedGraphLaunchGrantReviewV1(bytes32 builderEvidenceHash,bytes32 reviewerAttestationHash,bytes32 securityControlHeadHash,bytes32 securityEpochHash,bytes32 policyHash,bytes32 policyEpochHash,bytes32 reviewGenerationHash,uint64 securityEpoch,uint64 policyEpoch,uint64 reviewGeneration,bytes32 antiReplayNonce,bytes32 winnerKeyHash)" },
  launchGrant: { constant: "LAUNCH_GRANT_TYPEHASH", preimage: "ProgrammableCompletedGraphLaunchGrantV1(bytes32 bindingAHash,bytes32 bindingBHash,bytes32 reviewHash)" },
  executionCurrentness: { constant: "EXECUTION_CURRENTNESS_TYPEHASH", preimage: "ProgrammableCompletedGraphExecutionCurrentnessV1(bytes32 abiEncodedCurrentnessHash)" },
  preflightQuery: { constant: "PREFLIGHT_QUERY_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightQueryV1(bytes32 abiEncodedQueryHash)" },
  preflightRuntimeControl: { constant: "PREFLIGHT_RUNTIME_CONTROL_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightRuntimeControlV1(uint256 chainId,address registry,bytes32 runtimeAuthorityBindingHash,uint16 liveRuntimeMask,bytes32 dependencyBehaviorEvidenceHash,bytes32 securityControlHeadHash,uint64 securityEpoch,bytes32 securityEpochHash,uint64 policyEpoch,bytes32 policyEpochHash,bytes32 reviewGenerationHash,uint64 reviewGeneration,bool globalAdoptionKilled)" },
  preflightLifecycle: { constant: "PREFLIGHT_LIFECYCLE_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightLifecycleV1(uint8 profileStatus,bytes32 profileCapabilityHash,bytes32 grantStateHeadHash,bytes32 winnerNonceOccupantGrantDigest,bytes32 winnerKeyOccupantGrantDigest,bool currentnessNonceUsed,uint8 receiptStatus,bytes32 receiptCoreHash,bytes32 finalityIndexingReceiptHash)" },
  preflightReservation: { constant: "PREFLIGHT_RESERVATION_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightReservationV1(bytes32 graphOccupantStampLaunchId,bytes32 exclusiveTokenOccupantStampLaunchId,bytes32 poolOccupantStampLaunchId)" },
  preflightComponentLeaf: { constant: "PREFLIGHT_COMPONENT_LEAF_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightComponentLeafV1(uint8 componentIndex,address component,uint8 componentScope,bytes32 expectedSharedIdentityHash,bytes32 expectedRuntimeCodeHash,bytes32 actualRuntimeCodeHash,bytes32 exclusiveComponentOccupantStampLaunchId,bytes32 sharedComponentIdentityHash)" },
  preflightGlobalHead: { constant: "PREFLIGHT_GLOBAL_HEAD_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightGlobalHeadV1(bytes32 queryHash,bytes32 runtimeControlHash,bytes32 lifecycleHash,bytes32 reservationHash)" },
  preflightReadback: { constant: "PREFLIGHT_READBACK_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightReadbackV1(bytes32 globalReadbackHeadHash,bytes32 orderedComponentLeavesHash)" },
  adoptionRequest: { constant: "ADOPTION_REQUEST_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionRequestV1(bytes32 abiEncodedRequestHash)" },
  profileCapability: { constant: "PROFILE_CAPABILITY_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionProfileCapabilityV1(bytes32 abiEncodedCapabilityHash)" },
  stampLaunchId: { constant: "STAMP_LAUNCH_ID_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionStampLaunchIdV1(uint256 chainId,address registry,address launchWallet,bytes32 profileKey,bytes32 contractPlanHash,bytes32 sourceLaunchId)" },
  winnerKey: { constant: "WINNER_KEY_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionWinnerKeyV1(uint256 chainId,address registry,address launchWallet,bytes32 applicantIdHash,bytes32 profileKey,bytes32 profileDescriptorHash,bytes32 exactContractBindingHash,bytes32 sourceRepositoryHash,bytes32 sourceCommitHash,bytes32 sourceTreeHash,bytes32 sourceLaunchId,bytes32 contractPlanHash,bytes32 applicantPlanArtifactHash,bytes32 componentGraphHash,bytes32 adoptionIntentHash,uint64 securityEpoch,bytes32 securityEpochHash,uint64 policyEpoch,bytes32 policyEpochHash,uint64 reviewGeneration,bytes32 reviewGenerationHash)" },
  component: { constant: "COMPONENT_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionComponentV1(address account,uint8 kind,uint8 scope,uint8 deploymentKind,address deployer,uint64 createNonce,bytes32 create2Salt,bytes32 initCodeHash,bytes32 creationReceiptEvidenceHash,bytes32 externalCanonicalIdHash,bytes32 runtimeCodeHash,bytes32 configurationHash,bytes32 creationEvidenceHash)" },
  componentConfiguration: { constant: "COMPONENT_CONFIGURATION_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionComponentConfigurationV1(address account,uint8 kind,uint8 scope,uint8 deploymentKind,address deployer,uint64 createNonce,bytes32 create2Salt,bytes32 initCodeHash,bytes32 creationReceiptEvidenceHash,bytes32 externalCanonicalIdHash,bytes32 runtimeCodeHash)" },
  sharedComponentIdentity: { constant: "SHARED_COMPONENT_IDENTITY_TYPEHASH", preimage: "ProgrammableCompletedGraphSharedComponentIdentityV1(address account,uint8 kind,uint8 deploymentKind,address deployer,uint64 createNonce,bytes32 create2Salt,bytes32 initCodeHash,bytes32 creationReceiptEvidenceHash,bytes32 externalCanonicalIdHash,bytes32 runtimeCodeHash,bytes32 intrinsicConfigurationHash)" },
  componentCreationEvidence: { constant: "COMPONENT_CREATION_EVIDENCE_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionCreationEvidenceV1(bytes32 sourceBindingHash,bytes32 componentBindingHash)" },
  componentCreationEvidenceSource: { constant: "COMPONENT_CREATION_EVIDENCE_SOURCE_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionCreationEvidenceSourceV1(uint256 chainId,address registry,bytes32 sourceRepositoryHash,bytes32 sourceCommitHash,bytes32 sourceTreeHash,bytes32 sourceLaunchId,bytes32 manifestHash,bytes32 policyHash,bytes32 applicantPlanArtifactHash,address launchWallet)" },
  componentCreationEvidenceComponent: { constant: "COMPONENT_CREATION_EVIDENCE_COMPONENT_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionCreationEvidenceComponentV1(uint256 componentIndex,address account,uint8 kind,uint8 scope,uint8 deploymentKind,address deployer,uint64 createNonce,bytes32 create2Salt,bytes32 initCodeHash,bytes32 creationReceiptEvidenceHash,bytes32 externalCanonicalIdHash,bytes32 runtimeCodeHash)" },
  creationReceiptEvidence: { constant: "CREATION_RECEIPT_EVIDENCE_TYPEHASH", preimage: "ProgrammableCompletedGraphCreationReceiptEvidenceV1(bytes32 transactionHash,uint64 blockNumber,bytes32 blockHash,uint32 transactionIndex,address transactionSender,uint64 transactionSenderNonce,address transactionTo,uint256 transactionValueWei,bytes32 transactionInputHash,bool receiptSucceeded,address topLevelCreatedAddress,bytes32 internalCreationTraceHash,bytes32 finalityEvidenceHash,bytes32 dualProviderEvidenceHash)" },
  edge: { constant: "EDGE_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionEdgeV1(uint8 fromIndex,uint8 toIndex,uint8 kind,bytes32 relationHash)" },
  componentGraph: { constant: "COMPONENT_GRAPH_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionGraphV1(bytes32 componentsHash,bytes32 edgesHash)" },
  runtimeSet: { constant: "RUNTIME_SET_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionRuntimeSetV1(bytes32 orderedCommitmentsHash)" },
  configurationSet: { constant: "CONFIGURATION_SET_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionConfigurationSetV1(bytes32 orderedCommitmentsHash)" },
  configuration: { constant: "CONFIGURATION_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionConfigurationV1(bytes32 componentGraphHash,bytes32 componentConfigurationSetHash,bytes32 policyHash,bytes32 revenueBindingHash,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 poolKeyHash,bytes32 architectureResultHash)" },
  result: { constant: "RESULT_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionResultV1(bytes32 componentGraphHash,bytes32 configurationHash,bytes32 architectureResultHash,bytes32 poolResultHash,bytes32 deploymentLineageHash)" },
  applicationIdentity: { constant: "APPLICATION_IDENTITY_TYPEHASH", preimage: "ProgrammableCompletedGraphApplicationIdentityV1(address account,bytes32 runtimeCodeHash,bytes32 configurationHash)" },
  canonicalReceiptCore: { constant: "CANONICAL_RECEIPT_CORE_TYPEHASH", preimage: "ProgrammableCompletedGraphCanonicalReceiptCoreV1(bytes32 stampLaunchId,bytes32 sourceLaunchId,bytes32 launchGrantDigest,bytes32 launchGrantHash,bytes32 executionCurrentnessDigest,bytes32 contractPlanHash,bytes32 profileCapabilityHash,bytes32 adoptionRequestHash)" },
  finalityIndexingReceipt: { constant: "FINALITY_INDEXING_RECEIPT_TYPEHASH", preimage: "ProgrammableCompletedGraphFinalityIndexingReceiptV1(bytes32 abiEncodedReceiptWithoutHash)" },
  grantStateHead: { constant: "GRANT_STATE_HEAD_TYPEHASH", preimage: "ProgrammableCompletedGraphGrantStateHeadV1(bytes32 grantDigest,bytes32 grantHash,bytes32 stampLaunchId,uint8 status)" },
  preflightAuthorityRoles: { constant: "PREFLIGHT_AUTHORITY_ROLES_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightAuthorityRolesV1(address reviewerAuthority,bytes32 reviewerAuthorityRuntimeCodeHash,address governance,bytes32 governanceRuntimeCodeHash,address finalityAuthority,bytes32 finalityAuthorityRuntimeCodeHash,address indexerAuthority,bytes32 indexerAuthorityRuntimeCodeHash)" },
  preflightCoreDependencies: { constant: "PREFLIGHT_CORE_DEPENDENCIES_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightCoreDependenciesV1(address codec,bytes32 codecRuntimeCodeHash,address validator,bytes32 validatorRuntimeCodeHash,address preflight,bytes32 preflightRuntimeCodeHash)" },
  preflightBaseRuntimeBinding: { constant: "PREFLIGHT_BASE_RUNTIME_BINDING_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightBaseRuntimeBindingV1(uint256 chainId,address registry,bytes32 authorityRolesHash,bytes32 coreDependenciesHash,bytes32 dependencyBehaviorEvidenceHash)" },
  preflightProfileRuntimeBinding: { constant: "PREFLIGHT_PROFILE_RUNTIME_BINDING_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightProfileRuntimeBindingV1(address stateVerifier,bytes32 stateVerifierRuntimeCodeHash,uint256 canonicalPoolManagerChainId,address canonicalPoolManager,bytes32 canonicalPoolManagerRuntimeCodeHash)" },
  preflightRuntimeAuthorityBinding: { constant: "PREFLIGHT_RUNTIME_AUTHORITY_BINDING_TYPEHASH", preimage: "ProgrammableCompletedGraphAdoptionPreflightRuntimeAuthorityBindingV1(bytes32 baseRuntimeBindingHash,bytes32 profileRuntimeBindingHash)" },
  eip712Domain: { constant: "EIP712_DOMAIN_TYPEHASH", preimage: "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)" }
});
var ARTIFACT_CORE = {
  schemaVersion: "programmable.completed-graph-adoption-contract-artifact-binding.v1",
  packageName: "PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_COMPAT_V1",
  packageSchemaVersion: "1.4.0",
  artifactStatus: "INDEPENDENT_PASS_UNDEPLOYED_DENY",
  repository: "https://github.com/0xprogrammable/programmable.git",
  commit: "ea0e4424b886a0c1ae928fc73d62bd8e907b44cd",
  tree: "8c5e0822d7ff256cad3d9e0350c980473d36aecc",
  artifactPath: "artifacts/hookemon-completed-graph-adoption-compat-v1.json",
  artifactSha256: sha("f9d110d2850c4934ba0c22493eaa9d0f090bee6f0e6a1339ee3002344da1065a"),
  compiler: {
    solc: "0.8.26",
    evmVersion: "cancun",
    optimizer: true,
    optimizerRuns: 1e3,
    viaIR: false,
    bytecodeHash: "none",
    cborMetadata: false,
    canonicalStandardJsonSha256: sha("1104c2a0c6c439df6037e368bf60c375ad9e4e0b06ec979f5a37cbad93daef99"),
    detachedBuildInfoSha256: sha("cb5481447d15406f7a210bca1529368a85cb92902171267136197842a6816683"),
    canonicalStandardJsonReceipt: {
      sha256: sha("1104c2a0c6c439df6037e368bf60c375ad9e4e0b06ec979f5a37cbad93daef99"),
      path: null,
      notRepositoryArtifact: true
    },
    detachedBuildInfoReceipt: {
      sha256: sha("cb5481447d15406f7a210bca1529368a85cb92902171267136197842a6816683"),
      path: null,
      notRepositoryArtifact: true
    },
    detachedCompilerReceiptsAreRepositoryArtifacts: false,
    configPath: "config/hookemon-compat/foundry.toml",
    configSha256: sha("3a16f92f61239374c33b67ba015c84fa372e5743674f655f6395317d5e90fc8a"),
    remappingsPath: "remappings.txt",
    remappingsSha256: sha("2f87686a246a21832728206395e762da51036a9fdf196ae43f7ead4768694ec0"),
    generatorPath: "scripts/generate-hookemon-adoption-compat-artifact.sh",
    generatorSha256: sha("f8ea7733de09d289037620dadf605e1bc7faff301c2e785854310cfff4ee609c"),
    checkerPath: "scripts/check-hookemon-adoption-compat-artifact.sh",
    checkerSha256: sha("e0aa311a7cb2abb071d7c2c8e218e6d416156a2219402985d91918978ef4332c")
  },
  interfaces: [
    { name: "IProgrammableCompletedGraphAdoptionCompatV1", source: "src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol", sourceSha256: sha("75fced51331e2cb262ab622d9b948a587a69e37944d46d0784feaf382d9b63e6"), abiSha256: sha("b62393993aa9163a6611344da16cf92dec84448da8a3ceb9ed2cebd401e49237"), deployment: "interface_only" },
    { name: "IProgrammableCompletedGraphAdoptionStateVerifierV1", source: "src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol", sourceSha256: null, abiSha256: sha("06daf1ffab3be85b1b5aa75000c73b1c497261dde262dd3735245a5254269f0e"), deployment: "interface_only" },
    { name: "IProgrammableCompletedGraphAdoptionPreflightV1", source: "src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol", sourceSha256: sha("75fced51331e2cb262ab622d9b948a587a69e37944d46d0784feaf382d9b63e6"), abiSha256: sha("c3428ec15e3c46db043be9e72511f9603b4a3f6c437cab5020dab9eff340cdb1"), deployment: "interface_only" }
  ],
  deployables: [
    { name: "ProgrammableCompletedGraphAdoptionCompatCodecV1", source: "src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol", sourceSha256: sha("7e65df29012ddca1d6029a79670a58f9bfa970ddd4fd988b253e52c35736372c"), abiSha256: sha("52176cb85a9b45f3f61703eb82e4c16a7d2e3d98d52afafed9b85de74fdb6803"), artifactPath: "out-hookemon-compat/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol/ProgrammableCompletedGraphAdoptionCompatCodecV1.json", templateRuntimeBytes: 14684, templateRuntimeMarginToEip170Bytes: 9892, templateRuntimeSha256: sha("486bda47cba85ab9f0845aeb0c62a1aa4f2c1177fbf2aa94cde2b384ca3d7dcb"), templateRuntimeKeccak256: "0x1570eb95011b32da976fe6525c80e79e13cd5e3d186913b5382b210cfcf2eca4", creationBytecodeTemplateBytes: 14712, creationBytecodeTemplateSha256: sha("c5fa9651d93f16a80ba25f4f8bf108e425f308de887fe566b72490fd500a2681"), creationBytecodeTemplateKeccak256: "0x9004c7d193eed73561ab76a1f3723f2201f4137f578c0721a5c933ec17b58627" },
    { name: "ProgrammableCompletedGraphAdoptionValidatorV1", source: "src/hookemon/ProgrammableCompletedGraphAdoptionValidatorV1.sol", sourceSha256: sha("520edfefe273151d354eb20f43aaf1f70b3afd5eac865c4c606b5584822632e4"), abiSha256: sha("35f69ec571e756712d187400b333ede249c0c78ed1950c3ca2ca2484defb86c5"), artifactPath: "out-hookemon-compat/ProgrammableCompletedGraphAdoptionValidatorV1.sol/ProgrammableCompletedGraphAdoptionValidatorV1.json", templateRuntimeBytes: 20506, templateRuntimeMarginToEip170Bytes: 4070, templateRuntimeSha256: sha("e409c45c92a31567709f4777ed20fbfaeb3976a4ec6d4d83aba86e821d993e0f"), templateRuntimeKeccak256: "0x8731204649667173a497dd43fb183ac2ea01db5337f2c35b6c86af792b417ff8", creationBytecodeTemplateBytes: 21207, creationBytecodeTemplateSha256: sha("aac81492f529b3ea4cd8593fbaf9abe300efe364bad1800fbae2f4f48cb136da"), creationBytecodeTemplateKeccak256: "0x9b72baa662790129773316dc75d780ca65389bae9bc2357112f1d50c1c0e55e1" },
    { name: "ProgrammableCompletedGraphAdoptionGrantRegistryV1", source: "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol", sourceSha256: sha("9197c7dd7b482525c5755b453bc6d99c673291ee44a5ef67ea70bf6faf6fc330"), abiSha256: sha("a60f3f4e10c9b49413108785de4278b244e5687027d95db45dc8e549d6906d5c"), artifactPath: "out-hookemon-compat/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol/ProgrammableCompletedGraphAdoptionGrantRegistryV1.json", templateRuntimeBytes: 23917, templateRuntimeMarginToEip170Bytes: 659, templateRuntimeSha256: sha("b9e7d19e2b6098612fae25ee67febd2adb0a19725798dcd9acedddb5f4a64166"), templateRuntimeKeccak256: "0x40b0dbfd17be9051139376ac378c574d063edd90316668884cc5fcaebe0766ec", creationBytecodeTemplateBytes: 26834, creationBytecodeTemplateSha256: sha("8dd469341e870d04120587079d0c47dc5932580e30242da0b5175dc2ba9dc8d9"), creationBytecodeTemplateKeccak256: "0x87448654a9c51f4c499186bc17d81b9ffc46aa8fbae6e74d04833784c1d47aba" },
    { name: "ProgrammableCompletedGraphAdoptionPreflightV1", source: "src/hookemon/ProgrammableCompletedGraphAdoptionPreflightV1.sol", sourceSha256: sha("dd3292e44d01eaeacea74fb7b686d046516576d494727d5cc253ee3ef038ec9a"), abiSha256: sha("e1869e3ad641aded7dd290d53e61e447ea27a382f163e2af2fcbab455ef4b9d4"), artifactPath: "out-hookemon-compat/ProgrammableCompletedGraphAdoptionPreflightV1.sol/ProgrammableCompletedGraphAdoptionPreflightV1.json", templateRuntimeBytes: 8328, templateRuntimeMarginToEip170Bytes: 16248, templateRuntimeSha256: sha("21495dce04eb0c66272b8ee777b279988dd413057baabd820c1ae5d7d151d47b"), templateRuntimeKeccak256: "0xe7aedac223b999b55a579a45ad10d8892e90438755ad159c674999f58d5c1cd7", creationBytecodeTemplateBytes: 8711, creationBytecodeTemplateSha256: sha("cb455081aa84f3f06fc4335c66f49e5710eefb840a649102cf941e775ae44fb9"), creationBytecodeTemplateKeccak256: "0x91be86b2a5fe36bec779db43a63a0b9b2965a41fc05954fa0120a08b4bf69c14" }
  ],
  selectors: SELECTORS,
  typehashes: TYPEHASHES,
  typehashPreimages: TYPEHASH_PREIMAGES,
  canonicalConstants: {
    codecIdHash: "0x547425be5bbef0a87c0e12754155a053480cbbbecfcf4863bef3407f8289aa57",
    validatorIdHash: "0x14a76cb1c48208f82ba7cec4f2c6c316357d0a1b840f6d673a35b7ddc4a75c1b",
    preflightIdHash: "0xf73375acccc5b87c1eff04c1c39b377a3579361816f36f7524d753d800b898f5",
    preflightRequiredRuntimeMask: 511,
    adoptionOnlyReadinessConstraintHash: "0x200d18f90220af00fdadb83b716523e45c4565e83d48533c1a95d6a89ea92d51",
    eip712NameHash: "0x97fa37440048567cd094276a4b03a37e41a324c6bafc86796f704d1256adc03b",
    eip712VersionHash: "0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6",
    maxComponents: 24,
    maxEdges: 64,
    maxCurrentnessLifetimeSeconds: 3600,
    maxCurrentnessSignatureBytes: 4096,
    authorityGasReserve: 2e6,
    maxAuthorityStaticcallGas: 5e5,
    stateVerifierGasReserve: 2e5,
    maxStateVerifierStaticcallGas: 5e5
  },
  sourceIdentityReferents: {
    applicantRequest: { authorityFields: ["applicantIdHash", "reviewerAttestationHash"], transitiveFields: ["reviewAdmissionHash", "requestReceiptHash"], mayReplaceExecutableSource: false },
    executableEvidenceSource: { planFields: ["sourceRepositoryHash", "sourceCommitId", "sourceTreeId"], grantFields: ["sourceRepositoryHash", "sourceCommitHash", "sourceTreeHash"], referent: "B_EXECUTABLE_AND_MEASURED_SOURCE_REVISION", rawGitObjectPaddingEquality: "FORBIDDEN" },
    carrierEvidenceProvenance: { authorityField: "builderEvidenceHash", referent: "C_OFFCHAIN_CARRIER_PROVENANCE_ONLY", mayReplaceApplicantRequestOrExecutableSource: false }
  },
  identitySeparation: { canonicalNames: ["sourceLaunchId", "stampLaunchId", "antiReplayNonce"], pairwiseEquality: "FORBIDDEN", sourceLaunchId: "SOURCE_DEFINED_GRAPH_IDENTITY", stampLaunchId: "ROUTER_REGISTRY_CANONICAL_STAMP_IDENTITY", antiReplayNonce: "INDEPENDENT_TERMINAL_ONE_WINNER_NONCE", hookemonComparator: "EXTERNAL_UNFROZEN_NOT_CONSUMED" },
  digestRules: {
    sourceCommitHash: "keccak256(abi.encode(SOURCE_COMMIT_TYPEHASH, exact raw bytes20 executable-source Git commit object id))",
    sourceTreeHash: "keccak256(abi.encode(SOURCE_TREE_TYPEHASH, exact raw bytes20 executable-source Git tree object id))",
    contractPlanHash: "keccak256(abi.encode(PLAN_TYPEHASH, keccak256(abi.encode(CompletedGraphPlanV1))))",
    contractGrantStructHash: "keccak256(abi.encode(LAUNCH_GRANT_TYPEHASH, bindingAHash, bindingBHash, reviewHash))",
    contractGrantDigest: "keccak256(0x1901 || EIP712Domain(chainId,registry) || contractGrantStructHash)",
    stampLaunchId: "keccak256(abi.encode(STAMP_LAUNCH_ID_TYPEHASH, chainId, registry, launchWallet, profileKey, contractPlanHash, sourceLaunchId))",
    winnerKeyHash: "keccak256(abi.encode(WINNER_KEY_TYPEHASH, exact 21-axis domain)); antiReplayNonce excluded",
    preflightQueryHash: "candidate currentness digest excluded from signed aggregate"
  },
  preflightPolicy: { sideEffects: false, signing: false, applicantTtl: false, requiredRuntimeMask: 511, providerOutage: "PENDING_RETRYABLE_APPROVAL_UNCHANGED", candidateCurrentnessDigestInSignedAggregate: false },
  currentnessPolicy: { applicantApprovalExpiry: "NONE", maximumInternalTransportSeconds: 3600, simulationEvidence: "EXACT_PRE_SIGN_VALIDATOR_ETH_CALL", serviceDeploymentBinding: "MANDATORY", dualProviderQuorum: "AUTHORITY_ATTESTED_NOT_ONCHAIN_CLAIM" },
  receiptPolicy: { lifecycle: ["Prepared", "Adopted", "Finalized", "Indexed", "Published"], canonicalIdentifier: "stampLaunchId", sourceIdentifier: "sourceLaunchId", immutableCore: true },
  compatibilityBoundary: { capabilitySemantics: "ADOPT", arbitraryExecution: "FORBIDDEN", legacyNonceEqualsLaunchIdentity: "FORBIDDEN", rawGitObjectPaddingEquality: "FORBIDDEN", oldThirteenFieldPermit: "REJECTED", hookemonProvisionalTypehashes: "NOT_CONSUMED" },
  focusedValidation: {
    focusedTests: 36,
    winnerFuzzRuns: 1e4,
    contractSecurityP0: 0,
    contractSecurityP1: 0,
    eip170RegistryMarginBytes: 659,
    gasSnapshotPath: ".gas-snapshot",
    gasSnapshotSha256: sha("3657574a012b3682c74d50a7507357afb3311d5180acd82c3c735402e3b87e6f")
  },
  independentGateReceipt: INDEPENDENT_GATE_RECEIPT_CORE,
  independentGateReceiptSha256: canonicalSha256(
    "programmable.completed-graph-adoption-independent-gate-receipt.v1",
    INDEPENDENT_GATE_RECEIPT_CORE
  )
};
var PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1 = createCompletedGraphAdoptionContractArtifactBindingV1(ARTIFACT_CORE);
function createCompletedGraphAdoptionContractArtifactBindingV1(raw) {
  const core = deepFreeze(structuredClone(raw));
  const result = deepFreeze({
    ...core,
    artifactBindingHash: canonicalSha256(
      "programmable.completed-graph-adoption-contract-artifact-binding.v1",
      core
    )
  });
  assertCompletedGraphAdoptionContractArtifactBindingV1(result);
  return result;
}
function assertCompletedGraphAdoptionContractArtifactBindingV1(raw) {
  const value = record(raw, "Contract artifact binding");
  exactKeys(
    value,
    [...Object.keys(ARTIFACT_CORE), "artifactBindingHash"],
    "Contract artifact binding"
  );
  if (value.schemaVersion !== ARTIFACT_CORE.schemaVersion || value.packageName !== ARTIFACT_CORE.packageName || value.packageSchemaVersion !== ARTIFACT_CORE.packageSchemaVersion || !["PENDING_EXACT_INDEPENDENT_REBIND", "INDEPENDENT_PASS_UNDEPLOYED_DENY"].includes(String(value.artifactStatus)) || value.repository !== ARTIFACT_CORE.repository || !/^[0-9a-f]{40}$/u.test(String(value.commit)) || !/^[0-9a-f]{40}$/u.test(String(value.tree)) || value.artifactPath !== ARTIFACT_CORE.artifactPath || !isSha256(value.artifactSha256) || !Array.isArray(value.interfaces) || value.interfaces.length !== 3 || !Array.isArray(value.deployables) || value.deployables.length !== 4 || Object.keys(record(value.selectors, "selectors")).length !== 30 || Object.keys(record(value.typehashes, "typehashes")).length !== 43 || Object.keys(record(value.typehashPreimages, "typehash preimages")).length !== 43 || !isSha256(value.artifactBindingHash)) {
    throw new TypeError("Contract artifact binding identity drifted");
  }
  const { artifactBindingHash: _ignored, ...core } = value;
  const expected = canonicalSha256(
    "programmable.completed-graph-adoption-contract-artifact-binding.v1",
    core
  );
  const frozenExpected = canonicalSha256(
    "programmable.completed-graph-adoption-contract-artifact-binding.v1",
    ARTIFACT_CORE
  );
  if (value.artifactBindingHash !== expected || expected !== frozenExpected) {
    throw new TypeError("Contract artifact binding hash drifted");
  }
  const typehashes = record(value.typehashes, "Contract typehashes");
  const preimages = record(value.typehashPreimages, "Contract typehash preimages");
  for (const [name, entryRaw] of Object.entries(preimages)) {
    const entry = record(entryRaw, `Contract typehash preimage ${name}`);
    exactKeys(entry, ["constant", "preimage"], `Contract typehash preimage ${name}`);
    if (typeof entry.preimage !== "string" || keccak256V1(Buffer.from(entry.preimage, "utf8")) !== typehashes[name]) {
      throw new TypeError(`Contract typehash preimage ${name} Keccak drifted`);
    }
  }
  if (value.artifactStatus === "INDEPENDENT_PASS_UNDEPLOYED_DENY" && !isSha256(value.independentGateReceiptSha256)) {
    throw new TypeError("Contract artifact independent PASS lacks exact audit evidence");
  }
  if (value.independentGateReceiptSha256 !== canonicalSha256(
    "programmable.completed-graph-adoption-independent-gate-receipt.v1",
    value.independentGateReceipt
  )) throw new TypeError("Contract independent gate receipt hash drifted");
  const receipt = record(value.independentGateReceipt, "Contract independent gate receipt");
  const compiler = record(value.compiler, "Contract compiler binding");
  const compilerStandardJsonReceipt = assertDetachedHashOnlyReceipt(
    compiler.canonicalStandardJsonReceipt,
    "compiler canonical Standard JSON receipt"
  );
  const compilerBuildInfoReceipt = assertDetachedHashOnlyReceipt(
    compiler.detachedBuildInfoReceipt,
    "compiler detached build-info receipt"
  );
  const gateStandardJsonReceipt = assertDetachedHashOnlyReceipt(
    receipt.canonicalStandardJsonReceipt,
    "gate canonical Standard JSON receipt"
  );
  const gateBuildInfoReceipt = assertDetachedHashOnlyReceipt(
    receipt.detachedBuildInfoReceipt,
    "gate detached build-info receipt"
  );
  if (receipt.commit !== value.commit || receipt.tree !== value.tree || receipt.artifactSha256 !== value.artifactSha256 || receipt.gasSnapshotSha256 !== record(value.focusedValidation, "Contract focused validation").gasSnapshotSha256 || receipt.canonicalStandardJsonSha256 !== compiler.canonicalStandardJsonSha256 || receipt.detachedBuildInfoSha256 !== compiler.detachedBuildInfoSha256 || compilerStandardJsonReceipt.sha256 !== compiler.canonicalStandardJsonSha256 || compilerBuildInfoReceipt.sha256 !== compiler.detachedBuildInfoSha256 || gateStandardJsonReceipt.sha256 !== receipt.canonicalStandardJsonSha256 || gateBuildInfoReceipt.sha256 !== receipt.detachedBuildInfoSha256 || gateStandardJsonReceipt.sha256 !== compilerStandardJsonReceipt.sha256 || gateBuildInfoReceipt.sha256 !== compilerBuildInfoReceipt.sha256) {
    throw new TypeError("Contract independent gate receipt crossed its frozen artifact identity");
  }
}
function assertDetachedHashOnlyReceipt(raw, label) {
  const value = record(raw, label);
  exactKeys(value, ["sha256", "path", "notRepositoryArtifact"], label);
  if (!isSha256(value.sha256) || value.path !== null || value.notRepositoryArtifact !== true) {
    throw new TypeError(`${label} must remain hash-only and outside repository artifacts`);
  }
  return value;
}
function assertCompletedGraphAdoptionContractDeploymentBindingV1(raw) {
  const value = record(raw, "Contract deployment binding");
  exactKeys(value, [
    "schemaVersion",
    "chainId",
    "router",
    "registry",
    "registryRuntimeCodeHash",
    "codec",
    "codecRuntimeCodeHash",
    "validator",
    "validatorRuntimeCodeHash",
    "preflight",
    "preflightRuntimeCodeHash",
    "reviewerAuthority",
    "reviewerAuthorityRuntimeCodeHash",
    "governance",
    "governanceRuntimeCodeHash",
    "finalityAuthority",
    "finalityAuthorityRuntimeCodeHash",
    "indexerAuthority",
    "indexerAuthorityRuntimeCodeHash",
    "dependencyBehaviorEvidenceHash",
    "baseRuntimeAuthorityBindingHash",
    "serviceDeploymentBindingArtifactSha256",
    "serviceDeploymentBindingHash",
    "runtimeSpecializations",
    "creationTransactions",
    "finalityReceipts",
    "sourceVerificationReceipts",
    "deploymentBindingHash"
  ], "Contract deployment binding");
  if (value.schemaVersion !== "programmable.completed-graph-adoption-contract-deployment-binding.v1" || !isPositiveUintString(value.chainId) || value.router !== value.registry || !isAddress(value.registry) || !isSha256(value.deploymentBindingHash)) {
    throw new TypeError("Completed Graph deployment binding is invalid");
  }
  for (const key of [
    "router",
    "registry",
    "codec",
    "validator",
    "preflight",
    "reviewerAuthority",
    "governance",
    "finalityAuthority",
    "indexerAuthority"
  ]) {
    if (!isAddress(value[key])) {
      throw new TypeError(`Completed Graph deployment ${key} is invalid`);
    }
  }
  if (!isSha256(value.serviceDeploymentBindingArtifactSha256) || value.serviceDeploymentBindingHash !== `0x${value.serviceDeploymentBindingArtifactSha256.slice("sha256:".length)}`) {
    throw new TypeError("Service deployment binding must use explicit SHA256-to-EVM conversion");
  }
  if (!Array.isArray(value.runtimeSpecializations) || value.runtimeSpecializations.length !== 4) {
    throw new TypeError("Completed Graph deployment requires four runtime specializations");
  }
  const specializationNames = /* @__PURE__ */ new Set();
  for (const rawSpecialization of value.runtimeSpecializations) {
    const specialization = record(rawSpecialization, "Contract runtime specialization");
    exactKeys(specialization, [
      "name",
      "constructorArgumentsArtifactSha256",
      "immutableReferencesArtifactSha256",
      "specializationReproductionReceiptSha256",
      "specializedRuntimeBytes",
      "specializedRuntimeSha256",
      "specializedRuntimeKeccak256",
      "liveRuntimeCodeHash",
      "sourceVerificationReceiptSha256"
    ], "Contract runtime specialization");
    if (typeof specialization.name !== "string" || specialization.name.length === 0 || specializationNames.has(specialization.name) || !Number.isInteger(specialization.specializedRuntimeBytes) || Number(specialization.specializedRuntimeBytes) <= 0 || Number(specialization.specializedRuntimeBytes) > 24576 || !isSha256(specialization.constructorArgumentsArtifactSha256) || !isSha256(specialization.immutableReferencesArtifactSha256) || !isSha256(specialization.specializationReproductionReceiptSha256) || !isSha256(specialization.specializedRuntimeSha256) || !isNonzeroBytes32(specialization.specializedRuntimeKeccak256) || specialization.liveRuntimeCodeHash !== specialization.specializedRuntimeKeccak256 || !isSha256(specialization.sourceVerificationReceiptSha256)) {
      throw new TypeError("Completed Graph runtime specialization is invalid");
    }
    specializationNames.add(specialization.name);
  }
  for (const key of [
    "registryRuntimeCodeHash",
    "codecRuntimeCodeHash",
    "validatorRuntimeCodeHash",
    "preflightRuntimeCodeHash",
    "reviewerAuthorityRuntimeCodeHash",
    "governanceRuntimeCodeHash",
    "finalityAuthorityRuntimeCodeHash",
    "indexerAuthorityRuntimeCodeHash",
    "dependencyBehaviorEvidenceHash",
    "baseRuntimeAuthorityBindingHash",
    "serviceDeploymentBindingHash"
  ]) {
    if (!isNonzeroBytes32(value[key])) {
      throw new TypeError(`Completed Graph deployment ${key} is invalid`);
    }
  }
  if (!isNonemptyUniqueArray(value.creationTransactions, isNonzeroBytes32) || !isNonemptyUniqueArray(value.finalityReceipts, isSha256) || !isNonemptyUniqueArray(value.sourceVerificationReceipts, isSha256)) {
    throw new TypeError("Completed Graph deployment receipts are incomplete or duplicated");
  }
  for (const rawSpecialization of value.runtimeSpecializations) {
    const specialization = rawSpecialization;
    if (!value.sourceVerificationReceipts.includes(specialization.sourceVerificationReceiptSha256)) {
      throw new TypeError("Runtime specialization source verification receipt is unbound");
    }
  }
  if (value.baseRuntimeAuthorityBindingHash !== computeCompletedGraphBaseRuntimeAuthorityBindingHashV1(
    value
  )) {
    throw new TypeError("Completed Graph base runtime authority formula drifted");
  }
  const { deploymentBindingHash: _ignored, ...core } = value;
  if (value.deploymentBindingHash !== canonicalSha256(
    "programmable.completed-graph-adoption-contract-deployment-binding.v1",
    core
  )) throw new TypeError("Completed Graph deployment binding hash drifted");
}
function computeCompletedGraphBaseRuntimeAuthorityBindingHashV1(deployment) {
  const authorityRolesHash = keccakWords([
    bytes32Word(TYPEHASHES.preflightAuthorityRoles, "preflight authority roles typehash"),
    addressWord(deployment.reviewerAuthority, "reviewer authority"),
    bytes32Word(deployment.reviewerAuthorityRuntimeCodeHash, "reviewer authority runtime"),
    addressWord(deployment.governance, "governance"),
    bytes32Word(deployment.governanceRuntimeCodeHash, "governance runtime"),
    addressWord(deployment.finalityAuthority, "finality authority"),
    bytes32Word(deployment.finalityAuthorityRuntimeCodeHash, "finality authority runtime"),
    addressWord(deployment.indexerAuthority, "indexer authority"),
    bytes32Word(deployment.indexerAuthorityRuntimeCodeHash, "indexer authority runtime")
  ]);
  const coreDependenciesHash = keccakWords([
    bytes32Word(
      TYPEHASHES.preflightCoreDependencies,
      "preflight core dependencies typehash"
    ),
    addressWord(deployment.codec, "codec"),
    bytes32Word(deployment.codecRuntimeCodeHash, "codec runtime"),
    addressWord(deployment.validator, "validator"),
    bytes32Word(deployment.validatorRuntimeCodeHash, "validator runtime"),
    addressWord(deployment.preflight, "preflight"),
    bytes32Word(deployment.preflightRuntimeCodeHash, "preflight runtime")
  ]);
  return keccakWords([
    bytes32Word(
      TYPEHASHES.preflightBaseRuntimeBinding,
      "preflight base runtime binding typehash"
    ),
    uintWord(deployment.chainId, "deployment chain"),
    addressWord(deployment.registry, "deployment registry"),
    bytes32Word(authorityRolesHash, "authority roles hash"),
    bytes32Word(coreDependenciesHash, "core dependencies hash"),
    bytes32Word(
      deployment.dependencyBehaviorEvidenceHash,
      "dependency behavior evidence"
    )
  ]);
}
function computeCompletedGraphProfileRuntimeAuthorityBindingHashV1(deployment, profile) {
  assertCompletedGraphAdoptionContractDeploymentBindingV1(deployment);
  if (!isAddress(profile.stateVerifierBinding.stateVerifier) || !isNonzeroBytes32(profile.stateVerifierBinding.stateVerifierRuntimeCodeHash)) {
    throw new TypeError("Completed Graph profile runtime verifier binding is invalid");
  }
  const noPool = profile.canonicalPoolManagerChainId === "0" && profile.canonicalPoolManager === ZERO_ADDRESS && profile.canonicalPoolManagerRuntimeCodeHash === ZERO_BYTES32;
  const exactPool = isPositiveUintString(profile.canonicalPoolManagerChainId) && isAddress(profile.canonicalPoolManager) && isNonzeroBytes32(profile.canonicalPoolManagerRuntimeCodeHash);
  if (!noPool && !exactPool) {
    throw new TypeError("Completed Graph profile runtime PoolManager binding is partial");
  }
  const profileRuntimeBindingHash = keccakWords([
    bytes32Word(
      TYPEHASHES.preflightProfileRuntimeBinding,
      "preflight profile runtime typehash"
    ),
    addressWord(profile.stateVerifierBinding.stateVerifier, "state verifier"),
    bytes32Word(
      profile.stateVerifierBinding.stateVerifierRuntimeCodeHash,
      "state verifier runtime"
    ),
    uintWord(profile.canonicalPoolManagerChainId, "canonical PoolManager chain"),
    addressWordAllowZero(profile.canonicalPoolManager, "canonical PoolManager"),
    bytes32WordAllowZero(
      profile.canonicalPoolManagerRuntimeCodeHash,
      "canonical PoolManager runtime"
    )
  ]);
  return keccakWords([
    bytes32Word(
      TYPEHASHES.preflightRuntimeAuthorityBinding,
      "preflight runtime authority typehash"
    ),
    bytes32Word(deployment.baseRuntimeAuthorityBindingHash, "base runtime authority binding"),
    bytes32Word(profileRuntimeBindingHash, "profile runtime binding")
  ]);
}
function assertCompletedGraphAdoptionProfileCapabilityBindingV1(raw) {
  const value = record(raw, "Completed Graph profile capability binding");
  exactKeys(value, [
    "schemaVersion",
    "profileKey",
    "profileDescriptorHash",
    "exactContractBindingHash",
    "routeSchemaHash",
    "planSchemaArtifactHash",
    "policyHash",
    "stateVerifierBinding",
    "reviewControl",
    "canonicalPoolManagerChainId",
    "canonicalPoolManager",
    "canonicalPoolManagerRuntimeCodeHash",
    "capabilitySemantics",
    "admissionStatus",
    "launchClassification",
    "executionReadiness",
    "executionReadinessConstraintHash",
    "executionTimeConstraint",
    "executionTimeConstraintEvidenceHash",
    "requiredIdentityMask",
    "forbiddenIdentityMask",
    "enabled",
    "profileCapabilityHash",
    "runtimeAuthorityBindingHash",
    "registrationTransactionHash",
    "registrationBlockNumber",
    "registrationBlockHash",
    "profileStatus",
    "profileBindingHash"
  ], "Completed Graph profile capability binding");
  if (value.schemaVersion !== "programmable.completed-graph-adoption-profile-capability-binding.v1" || !isSha256(value.profileBindingHash)) {
    throw new TypeError("Completed Graph profile capability binding is invalid");
  }
  for (const key of [
    "profileKey",
    "profileDescriptorHash",
    "exactContractBindingHash",
    "routeSchemaHash",
    "planSchemaArtifactHash",
    "policyHash",
    "executionReadinessConstraintHash",
    "profileCapabilityHash",
    "runtimeAuthorityBindingHash",
    "registrationTransactionHash",
    "registrationBlockHash"
  ]) {
    if (!isNonzeroBytes32(value[key])) {
      throw new TypeError(`Completed Graph profile ${key} is invalid`);
    }
  }
  const stateVerifier = record(value.stateVerifierBinding, "profile state verifier binding");
  exactKeys(stateVerifier, [
    "stateVerifier",
    "stateVerifierRuntimeCodeHash",
    "stateSchemaHash",
    "stateVerifierBehaviorEvidenceHash"
  ], "profile state verifier binding");
  if (!isAddress(stateVerifier.stateVerifier) || !isNonzeroBytes32(stateVerifier.stateVerifierRuntimeCodeHash) || !isNonzeroBytes32(stateVerifier.stateSchemaHash) || !isNonzeroBytes32(stateVerifier.stateVerifierBehaviorEvidenceHash)) {
    throw new TypeError("Completed Graph profile state verifier binding is invalid");
  }
  const review = record(value.reviewControl, "profile review control");
  exactKeys(review, ["reviewGenerationHash", "reviewGeneration"], "profile review control");
  if (!isNonzeroBytes32(review.reviewGenerationHash) || !isPositiveUintString(review.reviewGeneration)) {
    throw new TypeError("Completed Graph profile review control is invalid");
  }
  const noPool = value.canonicalPoolManagerChainId === "0" && value.canonicalPoolManager === ZERO_ADDRESS && value.canonicalPoolManagerRuntimeCodeHash === ZERO_BYTES32;
  const exactPool = isPositiveUintString(value.canonicalPoolManagerChainId) && isAddress(value.canonicalPoolManager) && isNonzeroBytes32(value.canonicalPoolManagerRuntimeCodeHash);
  if (!noPool && !exactPool) {
    throw new TypeError("Completed Graph profile canonical PoolManager binding is partial");
  }
  if (value.capabilitySemantics !== 1 || value.admissionStatus !== 2 || value.launchClassification !== 1 && value.launchClassification !== 2 || value.executionReadiness !== 1 || value.executionReadinessConstraintHash !== ARTIFACT_CORE.canonicalConstants.adoptionOnlyReadinessConstraintHash || !isExactExecutionTimeBinding(
    value.executionTimeConstraint,
    value.executionTimeConstraintEvidenceHash
  ) || !isIdentityMask(value.requiredIdentityMask) || !isIdentityMask(value.forbiddenIdentityMask) || (Number(value.requiredIdentityMask) & Number(value.forbiddenIdentityMask)) !== 0 || value.enabled !== true || value.profileStatus !== 1 || !isPositiveUintString(value.registrationBlockNumber)) {
    throw new TypeError("Completed Graph profile is not an exact active ADOPT capability");
  }
  const expectedProfileKey = keccakWords([
    bytes32Word(ARTIFACT_CORE.typehashes.profileKey, "profile key typehash"),
    bytes32Word(value.profileDescriptorHash, "profile descriptor hash"),
    bytes32Word(value.routeSchemaHash, "profile route schema hash")
  ]);
  if (value.profileKey !== expectedProfileKey) {
    throw new TypeError("Completed Graph profile key formula drifted");
  }
  const abiEncodedCapabilityHash = keccakWords([
    bytes32Word(value.profileKey, "profile key"),
    bytes32Word(value.profileDescriptorHash, "profile descriptor hash"),
    bytes32Word(value.exactContractBindingHash, "profile exact Contract binding"),
    bytes32Word(value.routeSchemaHash, "profile route schema hash"),
    bytes32Word(value.planSchemaArtifactHash, "profile plan schema artifact hash"),
    bytes32Word(value.policyHash, "profile policy hash"),
    addressWord(stateVerifier.stateVerifier, "profile state verifier"),
    bytes32Word(stateVerifier.stateVerifierRuntimeCodeHash, "profile state verifier runtime"),
    bytes32Word(stateVerifier.stateSchemaHash, "profile state schema"),
    bytes32Word(
      stateVerifier.stateVerifierBehaviorEvidenceHash,
      "profile state verifier behavior evidence"
    ),
    bytes32Word(review.reviewGenerationHash, "profile review generation hash"),
    uintWord(review.reviewGeneration, "profile review generation"),
    uintWord(value.canonicalPoolManagerChainId, "profile PoolManager chain"),
    addressWordAllowZero(value.canonicalPoolManager, "profile PoolManager"),
    bytes32WordAllowZero(
      value.canonicalPoolManagerRuntimeCodeHash,
      "profile PoolManager runtime"
    ),
    uintWord("1", "profile capability semantics"),
    uintWord("2", "profile admission status"),
    uintWord(String(value.launchClassification), "profile launch classification"),
    uintWord("1", "profile execution readiness"),
    bytes32Word(value.executionReadinessConstraintHash, "profile readiness constraint"),
    uintWord(String(value.executionTimeConstraint), "profile execution time constraint"),
    bytes32WordAllowZero(
      value.executionTimeConstraintEvidenceHash,
      "profile execution time evidence"
    ),
    uintWord(String(value.requiredIdentityMask), "profile required identity mask"),
    uintWord(String(value.forbiddenIdentityMask), "profile forbidden identity mask"),
    uintWord("1", "profile enabled")
  ]);
  const expectedCapabilityHash = keccakWords([
    bytes32Word(
      ARTIFACT_CORE.typehashes.profileCapability,
      "profile capability typehash"
    ),
    bytes32Word(abiEncodedCapabilityHash, "ABI encoded profile capability hash")
  ]);
  if (value.profileCapabilityHash !== expectedCapabilityHash) {
    throw new TypeError("Completed Graph profile capability Keccak formula drifted");
  }
  const { profileBindingHash: _ignored, ...core } = value;
  if (value.profileBindingHash !== canonicalSha256(
    "programmable.completed-graph-adoption-profile-capability-binding.v1",
    core
  )) throw new TypeError("Completed Graph profile capability binding hash drifted");
}
function assertCompletedGraphAdoptionArtifactDeploymentCompatibilityV1(artifact, deployment) {
  assertCompletedGraphAdoptionContractArtifactBindingV1(artifact);
  assertCompletedGraphAdoptionContractDeploymentBindingV1(deployment);
  if (artifact.artifactStatus !== "INDEPENDENT_PASS_UNDEPLOYED_DENY") {
    throw new TypeError("Contract deployment cannot bind an artifact without independent PASS");
  }
  const deployables = new Map(artifact.deployables.map((entry) => [entry.name, entry]));
  const specializations = new Map(deployment.runtimeSpecializations.map((entry) => [entry.name, entry]));
  if (specializations.size !== deployables.size || [...deployables.keys()].some((name) => !specializations.has(name))) {
    throw new TypeError("Completed Graph runtime specializations crossed the frozen deployables");
  }
  const expectedLiveHashes = /* @__PURE__ */ new Map([
    [
      "ProgrammableCompletedGraphAdoptionGrantRegistryV1",
      deployment.registryRuntimeCodeHash
    ],
    ["ProgrammableCompletedGraphAdoptionCompatCodecV1", deployment.codecRuntimeCodeHash],
    ["ProgrammableCompletedGraphAdoptionValidatorV1", deployment.validatorRuntimeCodeHash],
    ["ProgrammableCompletedGraphAdoptionPreflightV1", deployment.preflightRuntimeCodeHash]
  ]);
  for (const [name, specialization] of specializations) {
    const template = deployables.get(name);
    if (specialization.liveRuntimeCodeHash !== expectedLiveHashes.get(name) || specialization.specializedRuntimeBytes !== template.templateRuntimeBytes) {
      throw new TypeError("Completed Graph specialized live runtime binding drifted");
    }
    if (name === "ProgrammableCompletedGraphAdoptionCompatCodecV1" && specialization.specializedRuntimeKeccak256 !== template.templateRuntimeKeccak256) {
      throw new TypeError("Immutable-free Codec specialization drifted from its template");
    }
    if (name !== "ProgrammableCompletedGraphAdoptionCompatCodecV1" && specialization.specializedRuntimeKeccak256 === template.templateRuntimeKeccak256) {
      throw new TypeError("Immutable-bearing live runtime cannot reuse its compiler template hash");
    }
  }
}
function assertCompletedGraphAdoptionArtifactDeploymentProfileCompatibilityV1(artifact, deployment, profile) {
  assertCompletedGraphAdoptionArtifactDeploymentCompatibilityV1(artifact, deployment);
  assertCompletedGraphAdoptionProfileCapabilityBindingV1(profile);
  const expectedContractBinding = `0x${artifact.artifactBindingHash.slice("sha256:".length)}`;
  if (profile.exactContractBindingHash !== expectedContractBinding || profile.runtimeAuthorityBindingHash !== computeCompletedGraphProfileRuntimeAuthorityBindingHashV1(deployment, profile)) {
    throw new TypeError("Completed Graph profile crossed artifact or runtime authority binding");
  }
  const poolConfigured = profile.canonicalPoolManagerChainId !== "0";
  if (poolConfigured && profile.canonicalPoolManagerChainId !== deployment.chainId) {
    throw new TypeError("Completed Graph profile PoolManager chain crossed deployment chain");
  }
}
function record(raw, label) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return raw;
}
function exactKeys(raw, expected, label) {
  const observed = Object.keys(raw).sort();
  const required = [...expected].sort();
  if (observed.length !== required.length || observed.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}
function isSha256(raw) {
  return typeof raw === "string" && /^sha256:[0-9a-f]{64}$/u.test(raw);
}
function isAddress(raw) {
  return typeof raw === "string" && /^0x[0-9a-f]{40}$/u.test(raw) && raw !== "0x0000000000000000000000000000000000000000";
}
var ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
var ZERO_BYTES32 = `0x${"0".repeat(64)}`;
function isNonzeroBytes32(raw) {
  return typeof raw === "string" && /^0x[0-9a-f]{64}$/u.test(raw) && raw !== ZERO_BYTES32;
}
function isPositiveUintString(raw) {
  return typeof raw === "string" && /^[1-9][0-9]*$/u.test(raw);
}
function isIdentityMask(raw) {
  return Number.isInteger(raw) && Number(raw) >= 0 && Number(raw) <= 31;
}
function isExactExecutionTimeBinding(constraint, evidenceHash) {
  return constraint === 1 && evidenceHash === ZERO_BYTES32 || constraint === 2 && isNonzeroBytes32(evidenceHash);
}
function isNonemptyUniqueArray(raw, predicate) {
  return Array.isArray(raw) && raw.length > 0 && raw.every(predicate) && new Set(raw).size === raw.length;
}
function bytes32Word(raw, label) {
  if (!isNonzeroBytes32(raw)) throw new TypeError(`${label} must be nonzero bytes32`);
  return raw.slice(2);
}
function bytes32WordAllowZero(raw, label) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{64}$/u.test(raw)) {
    throw new TypeError(`${label} must be bytes32`);
  }
  return raw.slice(2);
}
function addressWord(raw, label) {
  if (!isAddress(raw)) throw new TypeError(`${label} must be a nonzero address`);
  return raw.slice(2).padStart(64, "0");
}
function addressWordAllowZero(raw, label) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{40}$/u.test(raw)) {
    throw new TypeError(`${label} must be an address`);
  }
  return raw.slice(2).padStart(64, "0");
}
function uintWord(raw, label) {
  if (typeof raw !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    throw new TypeError(`${label} must be an unsigned decimal integer`);
  }
  const value = BigInt(raw);
  if (value >= 1n << 256n) throw new TypeError(`${label} exceeds uint256`);
  return value.toString(16).padStart(64, "0");
}
function keccakWords(words) {
  return keccak256V1(Buffer.from(words.join(""), "hex"));
}
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/router-v2-shared-lifecycle-v1.ts
var ROUTER_V2_SHARED_LIFECYCLE_VERSION_V1 = "1.0.0";
var ARCHITECTURES = Object.freeze([
  "DIRECT_GRAPH",
  "NESTED_FACTORY",
  "COMPLETED_GRAPH_ADOPTION",
  "EXISTING_ASSET_NEW_V4_POOL",
  "TEMPLATE_PROVIDER_LAUNCH",
  "OPTIONAL_COMPONENT_GRAPH"
]);
var PROFILE_STATES = Object.freeze([
  "DENY_PENDING_CONTRACT_FREEZE",
  "DENY_PENDING_RELEASE_ACTIVATION",
  "ENABLED"
]);
var LAUNCH_CLASSIFICATIONS = Object.freeze([
  "TOKEN_HOOK_POOL",
  "ADOPTED_EXISTING_ASSET_NEW_POOL",
  "BROADER_APPLICATION",
  "OPTIONAL_COMPONENT_GRAPH"
]);
var COMPONENT_IDENTITY_KINDS = Object.freeze([
  "TOKEN",
  "HOOK",
  "POOL",
  "ADOPTED_EXISTING_ASSET",
  "BROADER_APPLICATION"
]);
var FORBIDDEN_APPLICANT_FIELDS = /* @__PURE__ */ new Set([
  "applicantTarget",
  "calldata",
  "calls",
  "delegatecall",
  "executor",
  "opaqueCalldata",
  "selector",
  "target"
]);
var REQUIRED_EVIDENCE_KINDS = Object.freeze([
  "DEPENDENCY_LOCK",
  "INTAKE_SCHEMA",
  "PROFILE_COMPATIBILITY",
  "REPRODUCIBLE_BUILD",
  "SECURITY",
  "SOURCE_CLOSURE",
  "TYPED_ARCHITECTURE"
]);
function createExactContractProfileBindingV1(raw) {
  exactKeys2(raw, [
    "actionSchemaArtifactSha256",
    "actionSchemaId",
    "actionSelector",
    "actionTypehash",
    "capabilityRegistrationHash",
    "capabilitySemantics",
    "chainId",
    "compilerArtifactSha256",
    "contractAbiArtifactSha256",
    "contractTypehashBindingSha256",
    "planSchemaArtifactSha256",
    "executionModule",
    "executionModuleRuntimeCodeHash",
    "launchClassification",
    "planSchemaId",
    "portableVerifierArtifactSha256",
    "profileId",
    "profileKey",
    "permitAuthorityBindingHash",
    "profileRevenueBindingHash",
    "profileVersion",
    "releaseHash",
    "requiredComponentIdentityKinds",
    "routeId",
    "routeVersion",
    "router",
    "routerFamily",
    "routerRuntimeCodeHash",
    "securityEpoch"
  ], "exact contract profile binding");
  const core = {
    chainId: positiveDecimal(raw.chainId, "profile chain id"),
    routerFamily: safeId(raw.routerFamily, "router family"),
    routeId: safeId(raw.routeId, "route id"),
    routeVersion: safeId(raw.routeVersion, "route version"),
    profileId: safeId(raw.profileId, "profile id"),
    profileVersion: safeId(raw.profileVersion, "profile version"),
    profileKey: bytes32(raw.profileKey, "profile key"),
    capabilitySemantics: capabilitySemantics(raw.capabilitySemantics),
    launchClassification: launchClassification(raw.launchClassification),
    requiredComponentIdentityKinds: normalizeRequiredComponentIdentityKinds(
      raw.launchClassification,
      raw.requiredComponentIdentityKinds
    ),
    actionSelector: bytes4(raw.actionSelector, "profile action selector"),
    actionTypehash: bytes32(raw.actionTypehash, "profile action typehash"),
    router: address(raw.router, "profile router"),
    routerRuntimeCodeHash: bytes32(raw.routerRuntimeCodeHash, "profile router runtime"),
    executionModule: address(raw.executionModule, "profile execution module"),
    executionModuleRuntimeCodeHash: bytes32(
      raw.executionModuleRuntimeCodeHash,
      "profile execution module runtime"
    ),
    planSchemaId: safeId(raw.planSchemaId, "plan schema id"),
    planSchemaArtifactSha256: sha256(raw.planSchemaArtifactSha256, "plan schema artifact"),
    actionSchemaId: safeId(raw.actionSchemaId, "action schema id"),
    actionSchemaArtifactSha256: sha256(
      raw.actionSchemaArtifactSha256,
      "action schema artifact"
    ),
    contractAbiArtifactSha256: sha256(raw.contractAbiArtifactSha256, "contract ABI artifact"),
    contractTypehashBindingSha256: sha256(
      raw.contractTypehashBindingSha256,
      "contract typehash binding"
    ),
    compilerArtifactSha256: sha256(raw.compilerArtifactSha256, "compiler artifact"),
    portableVerifierArtifactSha256: sha256(
      raw.portableVerifierArtifactSha256,
      "portable verifier artifact"
    ),
    capabilityRegistrationHash: sha256(
      raw.capabilityRegistrationHash,
      "capability registration"
    ),
    profileRevenueBindingHash: sha256(
      raw.profileRevenueBindingHash,
      "profile revenue binding"
    ),
    permitAuthorityBindingHash: sha256(
      raw.permitAuthorityBindingHash,
      "permit authority binding"
    ),
    releaseHash: sha256(raw.releaseHash, "profile release"),
    securityEpoch: positiveDecimal(raw.securityEpoch, "profile security epoch")
  };
  return deepFreeze2({
    ...core,
    bindingHash: canonicalSha256("programmable.router-v2-exact-contract-profile-binding.v1", core)
  });
}
function assertExactContractProfileBindingV1(raw) {
  const { bindingHash: _bindingHash, ...input } = raw;
  const rebuilt = createExactContractProfileBindingV1(input);
  return exactArtifact(raw, rebuilt, "exact contract profile binding");
}
function createLaunchProfileDescriptorV1(raw) {
  exactKeys2(raw, [
    "activationAllowed",
    "architecture",
    "blockers",
    "exactContractBinding",
    "requiredBuilderEvidenceKinds",
    "slotId",
    "state"
  ], "launch profile descriptor");
  if (!ARCHITECTURES.includes(raw.architecture)) {
    throw new TypeError("launch architecture is invalid");
  }
  if (!PROFILE_STATES.includes(raw.state)) throw new TypeError("launch profile state is invalid");
  const exactContractBinding = raw.exactContractBinding === null ? null : assertExactContractProfileBindingV1(raw.exactContractBinding);
  if (exactContractBinding !== null) {
    assertLaunchClassificationForArchitecture(raw.architecture, exactContractBinding);
  }
  const blockers = stringSet(raw.blockers, "profile blocker");
  const evidenceKinds = stringSet(raw.requiredBuilderEvidenceKinds, "builder evidence kind");
  if (canonicalizeJson(evidenceKinds) !== canonicalizeJson(REQUIRED_EVIDENCE_KINDS)) {
    throw new TypeError("launch profile descriptor omits a required evidence class");
  }
  if (raw.state === "ENABLED") {
    if (!raw.activationAllowed || exactContractBinding === null || blockers.length !== 0) {
      throw new TypeError("enabled launch profile descriptor is not fully bound");
    }
  } else if (raw.activationAllowed) {
    throw new TypeError("disabled launch profile descriptor cannot allow activation");
  }
  if (raw.state === "DENY_PENDING_CONTRACT_FREEZE" && exactContractBinding !== null) {
    throw new TypeError("contract-pending launch profile descriptor contains a guessed binding");
  }
  const core = {
    schemaVersion: "programmable.router-v2-launch-profile-descriptor.v1",
    descriptorVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V1,
    slotId: safeId(raw.slotId, "profile slot id"),
    architecture: raw.architecture,
    state: raw.state,
    activationAllowed: raw.activationAllowed,
    exactContractBinding,
    capabilitySemantics: exactContractBinding?.capabilitySemantics ?? null,
    launchClassification: exactContractBinding?.launchClassification ?? null,
    requiredComponentIdentityKinds: exactContractBinding?.requiredComponentIdentityKinds ?? null,
    actionSelector: exactContractBinding?.actionSelector ?? null,
    actionTypehash: exactContractBinding?.actionTypehash ?? null,
    executionModule: exactContractBinding?.executionModule ?? null,
    executionModuleRuntimeCodeHash: exactContractBinding?.executionModuleRuntimeCodeHash ?? null,
    profileRevenueBindingHash: exactContractBinding?.profileRevenueBindingHash ?? null,
    permitAuthorityBindingHash: exactContractBinding?.permitAuthorityBindingHash ?? null,
    profileReleaseHash: exactContractBinding?.releaseHash ?? null,
    requiredBuilderEvidenceKinds: evidenceKinds,
    blockers
  };
  return deepFreeze2({
    ...core,
    descriptorHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertLaunchProfileDescriptorV1(raw) {
  const {
    descriptorHash: _descriptorHash,
    descriptorVersion: _descriptorVersion,
    actionSelector: _actionSelector,
    actionTypehash: _actionTypehash,
    capabilitySemantics: _capabilitySemantics,
    launchClassification: _launchClassification,
    requiredComponentIdentityKinds: _requiredComponentIdentityKinds,
    executionModule: _executionModule,
    executionModuleRuntimeCodeHash: _executionModuleRuntimeCodeHash,
    permitAuthorityBindingHash: _permitAuthorityBindingHash,
    profileReleaseHash: _profileReleaseHash,
    profileRevenueBindingHash: _profileRevenueBindingHash,
    schemaVersion: _schemaVersion,
    ...input
  } = raw;
  const rebuilt = createLaunchProfileDescriptorV1(input);
  return exactArtifact(raw, rebuilt, "launch profile descriptor");
}
function createLaunchProfileCatalogV1(rawDescriptors) {
  if (!Array.isArray(rawDescriptors) || rawDescriptors.length < 1 || rawDescriptors.length > 64) {
    throw new TypeError("launch profile catalog cardinality is invalid");
  }
  const descriptors = rawDescriptors.map(assertLaunchProfileDescriptorV1).sort((left, right) => compareUtf8(left.slotId, right.slotId));
  unique(descriptors.map(({ slotId }) => slotId), "profile slot ids");
  const boundKeys = descriptors.flatMap(({ exactContractBinding }) => exactContractBinding === null ? [] : [`${exactContractBinding.chainId}:${exactContractBinding.routerFamily}:${exactContractBinding.profileKey}`]);
  unique(boundKeys, "bound profile keys");
  const core = {
    schemaVersion: "programmable.router-v2-launch-profile-catalog.v1",
    catalogVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V1,
    descriptors: deepFreeze2(descriptors)
  };
  return deepFreeze2({ ...core, catalogHash: canonicalSha256(core.schemaVersion, core) });
}
function createApplicantLaunchPlanV1(descriptorRaw, raw) {
  const descriptor = assertLaunchProfileDescriptorV1(descriptorRaw);
  if (descriptor.exactContractBinding === null) {
    throw new TypeError("applicant launch plan cannot compile before exact contract freeze");
  }
  assertNoForbiddenApplicantFields(raw);
  exactKeys2(raw, [
    "allowanceCaps",
    "compiledActionSemanticHash",
    "componentGraphHash",
    "componentIdentities",
    "configurationHash",
    "deploymentLineageHash",
    "exactRuntimeBindings",
    "feePolicyHash",
    "issuedAt",
    "launchId",
    "launchWallet",
    "manifestArtifactSha256",
    "manifestHash",
    "maximumNativeValueWei",
    "policyArtifactSha256",
    "policyHash",
    "poolId",
    "poolKeyHash",
    "profilePlanHash",
    "providerBindingHash",
    "resultHash",
    "revenuePolicyHash",
    "sourceCommit",
    "sourceRepository",
    "sourceTree",
    "supersession",
    "templateBindingHash"
  ], "applicant launch plan input");
  const runtimeBindings = normalizeRuntimeBindings(raw.exactRuntimeBindings);
  const allowanceCaps = normalizeAllowanceCaps(raw.allowanceCaps);
  const componentIdentities = normalizeLaunchComponentIdentities(
    raw.componentIdentities,
    descriptor.exactContractBinding.requiredComponentIdentityKinds
  );
  const poolKeyHash = nullableNonzeroBytes32(raw.poolKeyHash, "plan pool key");
  const poolId = nullableNonzeroBytes32(raw.poolId, "plan pool id");
  if (componentIdentities.poolId !== poolId || poolId === null !== (poolKeyHash === null)) {
    throw new TypeError("plan pool identities are incomplete or inconsistent");
  }
  const providerBindingHash = nullableSha256(raw.providerBindingHash, "plan provider binding");
  const templateBindingHash = nullableSha256(raw.templateBindingHash, "plan template binding");
  if (descriptor.architecture === "TEMPLATE_PROVIDER_LAUNCH" && (providerBindingHash === null || templateBindingHash === null)) {
    throw new TypeError("template-provider launch lacks exact provider and template bindings");
  }
  const core = {
    schemaVersion: "programmable.router-v2-applicant-launch-plan.v1",
    planVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V1,
    profileDescriptorHash: descriptor.descriptorHash,
    exactContractBindingHash: descriptor.exactContractBinding.bindingHash,
    slotId: descriptor.slotId,
    architecture: descriptor.architecture,
    capabilitySemantics: descriptor.exactContractBinding.capabilitySemantics,
    launchClassification: descriptor.exactContractBinding.launchClassification,
    requiredComponentIdentityKinds: descriptor.exactContractBinding.requiredComponentIdentityKinds,
    sourceRepository: repository(raw.sourceRepository),
    sourceCommit: gitObject(raw.sourceCommit, "plan source commit"),
    sourceTree: gitObject(raw.sourceTree, "plan source tree"),
    manifestHash: bytes32(raw.manifestHash, "plan manifest hash"),
    manifestArtifactSha256: sha256(raw.manifestArtifactSha256, "plan manifest artifact"),
    policyHash: bytes32(raw.policyHash, "plan policy hash"),
    policyArtifactSha256: sha256(raw.policyArtifactSha256, "plan policy artifact"),
    launchWallet: address(raw.launchWallet, "plan launch wallet"),
    componentGraphHash: bytes32(raw.componentGraphHash, "plan component graph"),
    componentIdentities,
    exactRuntimeBindings: runtimeBindings,
    exactRuntimeSetHash: canonicalSha256(
      "programmable.router-v2-applicant-runtime-set.v1",
      runtimeBindings
    ),
    configurationHash: bytes32(raw.configurationHash, "plan configuration"),
    poolKeyHash,
    poolId,
    resultHash: bytes32(raw.resultHash, "plan result"),
    profilePlanHash: bytes32(raw.profilePlanHash, "profile plan hash"),
    launchId: bytes32(raw.launchId, "plan launch id"),
    compiledActionSemanticHash: bytes32(
      raw.compiledActionSemanticHash,
      "compiled action semantic hash"
    ),
    maximumNativeValueWei: decimal(raw.maximumNativeValueWei, 256, "plan native value cap"),
    allowanceCaps,
    allowanceCapsHash: canonicalSha256(
      "programmable.router-v2-applicant-allowance-caps.v1",
      allowanceCaps
    ),
    providerBindingHash,
    templateBindingHash,
    feePolicyHash: bytes32(raw.feePolicyHash, "plan fee policy"),
    revenuePolicyHash: bytes32(raw.revenuePolicyHash, "plan revenue policy"),
    deploymentLineageHash: sha256(raw.deploymentLineageHash, "plan deployment lineage"),
    supersession: normalizeApplicantPlanSupersession(raw.supersession),
    issuedAt: instant(raw.issuedAt, "plan issue time")
  };
  return deepFreeze2({ ...core, planHash: canonicalSha256(core.schemaVersion, core) });
}
function assertApplicantLaunchPlanV1(descriptor, raw) {
  const {
    allowanceCapsHash: _allowanceCapsHash,
    architecture: _architecture,
    capabilitySemantics: _capabilitySemantics,
    launchClassification: _launchClassification,
    requiredComponentIdentityKinds: _requiredComponentIdentityKinds,
    exactContractBindingHash: _bindingHash,
    exactRuntimeSetHash: _runtimeSetHash,
    planHash: _planHash,
    planVersion: _planVersion,
    profileDescriptorHash: _descriptorHash,
    schemaVersion: _schemaVersion,
    slotId: _slotId,
    ...input
  } = raw;
  return exactArtifact(raw, createApplicantLaunchPlanV1(descriptor, input), "applicant launch plan");
}
function createBuilderEvidenceCommitmentV1(descriptorRaw, planRaw, raw) {
  exactKeys2(raw, [
    "compilerArtifactSha256",
    "dependencyLockEvidenceSha256",
    "evidenceKinds",
    "intakeSchemaEvidenceSha256",
    "issuedAt",
    "profileCompatibilityEvidenceSha256",
    "reproducibleBuildEvidenceSha256",
    "securityEvidenceSha256",
    "sourceClosureEvidenceSha256",
    "typedArchitectureEvidenceSha256"
  ], "builder evidence commitment input");
  const descriptor = assertLaunchProfileDescriptorV1(descriptorRaw);
  const plan = assertApplicantLaunchPlanV1(descriptor, planRaw);
  if (descriptor.exactContractBinding === null) {
    throw new TypeError("builder evidence cannot bind a missing contract freeze");
  }
  const evidenceKinds = stringSet(raw.evidenceKinds, "builder evidence kind");
  if (canonicalizeJson(evidenceKinds) !== canonicalizeJson(descriptor.requiredBuilderEvidenceKinds)) {
    throw new TypeError("builder evidence commitment does not cover the descriptor evidence set");
  }
  const compilerArtifactSha256 = sha256(raw.compilerArtifactSha256, "builder compiler artifact");
  if (compilerArtifactSha256 !== descriptor.exactContractBinding.compilerArtifactSha256) {
    throw new TypeError("builder evidence compiler does not match the frozen profile compiler");
  }
  const core = {
    schemaVersion: "programmable.router-v2-builder-evidence-commitment.v1",
    evidenceVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V1,
    planHash: plan.planHash,
    profileDescriptorHash: descriptor.descriptorHash,
    exactContractBindingHash: descriptor.exactContractBinding.bindingHash,
    sourceCommit: plan.sourceCommit,
    sourceTree: plan.sourceTree,
    intakeSchemaEvidenceSha256: sha256(raw.intakeSchemaEvidenceSha256, "intake schema evidence"),
    sourceClosureEvidenceSha256: sha256(raw.sourceClosureEvidenceSha256, "source closure evidence"),
    reproducibleBuildEvidenceSha256: sha256(
      raw.reproducibleBuildEvidenceSha256,
      "reproducible build evidence"
    ),
    dependencyLockEvidenceSha256: sha256(
      raw.dependencyLockEvidenceSha256,
      "dependency lock evidence"
    ),
    profileCompatibilityEvidenceSha256: sha256(
      raw.profileCompatibilityEvidenceSha256,
      "profile compatibility evidence"
    ),
    securityEvidenceSha256: sha256(raw.securityEvidenceSha256, "security evidence"),
    typedArchitectureEvidenceSha256: sha256(
      raw.typedArchitectureEvidenceSha256,
      "typed architecture evidence"
    ),
    compilerArtifactSha256,
    evidenceKinds,
    issuedAt: instant(raw.issuedAt, "builder evidence issue time")
  };
  return deepFreeze2({ ...core, evidenceHash: canonicalSha256(core.schemaVersion, core) });
}
function assertBuilderEvidenceCommitmentV1(descriptor, plan, raw) {
  const {
    evidenceHash: _evidenceHash,
    evidenceVersion: _evidenceVersion,
    exactContractBindingHash: _bindingHash,
    planHash: _planHash,
    profileDescriptorHash: _descriptorHash,
    schemaVersion: _schemaVersion,
    sourceCommit: _sourceCommit,
    sourceTree: _sourceTree,
    ...input
  } = raw;
  return exactArtifact(
    raw,
    createBuilderEvidenceCommitmentV1(descriptor, plan, input),
    "builder evidence commitment"
  );
}
function createReviewerAuthorityAttestationV1(descriptorRaw, planRaw, evidenceRaw, raw) {
  exactKeys2(raw, [
    "catalogGeneration",
    "catalogHash",
    "decision",
    "issuedAt",
    "reviewPolicyHash",
    "reviewerAuthorityBindingHash",
    "reviewerKeyId",
    "revocationGeneration",
    "securityEpoch",
    "signedAttestationArtifactSha256"
  ], "reviewer authority attestation input");
  const descriptor = assertLaunchProfileDescriptorV1(descriptorRaw);
  const plan = assertApplicantLaunchPlanV1(descriptor, planRaw);
  const evidence = assertBuilderEvidenceCommitmentV1(descriptor, plan, evidenceRaw);
  const binding = descriptor.exactContractBinding;
  if (binding === null) throw new TypeError("review attestation lacks an exact contract freeze");
  const securityEpoch = positiveDecimal(raw.securityEpoch, "review security epoch");
  if (securityEpoch !== binding.securityEpoch) {
    throw new TypeError("review attestation security epoch is stale");
  }
  if (!["APPROVED", "DENIED"].includes(raw.decision)) {
    throw new TypeError("review attestation decision is invalid");
  }
  const core = {
    schemaVersion: "programmable.router-v2-reviewer-authority-attestation.v1",
    attestationVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V1,
    decision: raw.decision,
    planHash: plan.planHash,
    builderEvidenceHash: evidence.evidenceHash,
    profileDescriptorHash: descriptor.descriptorHash,
    exactContractBindingHash: binding.bindingHash,
    profileReleaseHash: binding.releaseHash,
    catalogHash: sha256(raw.catalogHash, "review catalog"),
    catalogGeneration: positiveDecimal(raw.catalogGeneration, "review catalog generation"),
    revocationGeneration: decimal(raw.revocationGeneration, 64, "review revocation generation"),
    securityEpoch,
    reviewPolicyHash: bytes32(raw.reviewPolicyHash, "review policy hash"),
    reviewerAuthorityBindingHash: sha256(
      raw.reviewerAuthorityBindingHash,
      "reviewer authority binding"
    ),
    reviewerKeyId: safeId(raw.reviewerKeyId, "reviewer key id"),
    signedAttestationArtifactSha256: sha256(
      raw.signedAttestationArtifactSha256,
      "signed reviewer attestation"
    ),
    durableForExactRevision: true,
    issuedAt: instant(raw.issuedAt, "review attestation issue time")
  };
  return deepFreeze2({ ...core, attestationHash: canonicalSha256(core.schemaVersion, core) });
}
function assertReviewerAuthorityAttestationV1(descriptor, plan, evidence, raw) {
  const {
    attestationHash: _attestationHash,
    attestationVersion: _attestationVersion,
    builderEvidenceHash: _builderEvidenceHash,
    durableForExactRevision: _durable,
    exactContractBindingHash: _bindingHash,
    planHash: _planHash,
    profileDescriptorHash: _descriptorHash,
    profileReleaseHash: _releaseHash,
    schemaVersion: _schemaVersion,
    ...input
  } = raw;
  return exactArtifact(
    raw,
    createReviewerAuthorityAttestationV1(descriptor, plan, evidence, input),
    "reviewer authority attestation"
  );
}
var REQUIRED_ROUTER_V2_AUTHORITY_READINESS_DEPENDENCIES_V1 = Object.freeze([
  "currentness-provider",
  "durable-store",
  "finality-provider",
  "reconciler",
  "signer",
  "typed-action-verifier"
]);
var ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V1 = createLaunchProfileCatalogV1(
  [
    ["direct-graph-v2", "DIRECT_GRAPH", "exact-direct-graph-v2-contract-freeze-missing"],
    ["nested-factory-v1", "NESTED_FACTORY", "exact-nested-factory-contract-freeze-missing"],
    [
      "completed-graph-adoption-v1",
      "COMPLETED_GRAPH_ADOPTION",
      "exact-completed-graph-adoption-contract-freeze-missing"
    ],
    [
      "existing-asset-new-v4-pool-v1",
      "EXISTING_ASSET_NEW_V4_POOL",
      "exact-existing-asset-v4-pool-contract-freeze-missing"
    ],
    [
      "template-provider-launch-v1",
      "TEMPLATE_PROVIDER_LAUNCH",
      "exact-template-provider-contract-freeze-missing"
    ],
    [
      "optional-component-graph-v1",
      "OPTIONAL_COMPONENT_GRAPH",
      "exact-optional-component-graph-contract-freeze-missing"
    ]
  ].map(([slotId, architecture, blocker]) => createLaunchProfileDescriptorV1({
    slotId,
    architecture,
    state: "DENY_PENDING_CONTRACT_FREEZE",
    activationAllowed: false,
    exactContractBinding: null,
    requiredBuilderEvidenceKinds: REQUIRED_EVIDENCE_KINDS,
    blockers: [blocker]
  }))
);
var ROUTER_V2_SHARED_LIFECYCLE_ABI_V1 = deepFreeze2({
  schemaVersion: "programmable.router-v2-shared-lifecycle-abi.v1",
  abiVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V1,
  contractAbiStatus: "EXTERNAL_EXACT_ARTIFACT_REQUIRED_NO_GUESSED_TYPEHASHES",
  canonicalSerialization: "RFC8785_JCS_UTF8",
  canonicalArtifactBytesFormula: "UTF8(JCS(fullArtifact))",
  hashPreimageFormula: "UTF8(hashDomain)||0x00||UTF8(JCS(artifactWithoutHashField))",
  integerEncoding: "UNSIGNED_CANONICAL_DECIMAL_STRING",
  unknownFieldPolicy: "REJECT",
  lifecycleTypes: [
    lifecycleAbiRow(
      "LaunchProfileDescriptor",
      "programmable.router-v2-launch-profile-descriptor.v1",
      "descriptorHash",
      [
        "schemaVersion",
        "descriptorVersion",
        "slotId",
        "architecture",
        "state",
        "activationAllowed",
        "exactContractBinding",
        "capabilitySemantics",
        "launchClassification",
        "requiredComponentIdentityKinds",
        "actionSelector",
        "actionTypehash",
        "executionModule",
        "executionModuleRuntimeCodeHash",
        "profileRevenueBindingHash",
        "permitAuthorityBindingHash",
        "profileReleaseHash",
        "requiredBuilderEvidenceKinds",
        "blockers"
      ]
    ),
    lifecycleAbiRow(
      "ApplicantLaunchPlan",
      "programmable.router-v2-applicant-launch-plan.v1",
      "planHash",
      [
        "schemaVersion",
        "planVersion",
        "profileDescriptorHash",
        "exactContractBindingHash",
        "slotId",
        "architecture",
        "capabilitySemantics",
        "launchClassification",
        "requiredComponentIdentityKinds",
        "sourceRepository",
        "sourceCommit",
        "sourceTree",
        "manifestHash",
        "manifestArtifactSha256",
        "policyHash",
        "policyArtifactSha256",
        "launchWallet",
        "componentGraphHash",
        "componentIdentities",
        "exactRuntimeBindings",
        "exactRuntimeSetHash",
        "configurationHash",
        "poolKeyHash",
        "poolId",
        "resultHash",
        "profilePlanHash",
        "launchId",
        "compiledActionSemanticHash",
        "maximumNativeValueWei",
        "allowanceCaps",
        "allowanceCapsHash",
        "providerBindingHash",
        "templateBindingHash",
        "feePolicyHash",
        "revenuePolicyHash",
        "deploymentLineageHash",
        "supersession",
        "issuedAt"
      ]
    ),
    lifecycleAbiRow(
      "BuilderEvidenceCommitment",
      "programmable.router-v2-builder-evidence-commitment.v1",
      "evidenceHash",
      [
        "schemaVersion",
        "evidenceVersion",
        "planHash",
        "profileDescriptorHash",
        "exactContractBindingHash",
        "sourceCommit",
        "sourceTree",
        "intakeSchemaEvidenceSha256",
        "sourceClosureEvidenceSha256",
        "reproducibleBuildEvidenceSha256",
        "dependencyLockEvidenceSha256",
        "profileCompatibilityEvidenceSha256",
        "securityEvidenceSha256",
        "typedArchitectureEvidenceSha256",
        "compilerArtifactSha256",
        "evidenceKinds",
        "issuedAt"
      ]
    ),
    lifecycleAbiRow(
      "ReviewerAuthorityAttestation",
      "programmable.router-v2-reviewer-authority-attestation.v1",
      "attestationHash",
      [
        "schemaVersion",
        "attestationVersion",
        "decision",
        "planHash",
        "builderEvidenceHash",
        "profileDescriptorHash",
        "exactContractBindingHash",
        "profileReleaseHash",
        "catalogHash",
        "catalogGeneration",
        "revocationGeneration",
        "securityEpoch",
        "reviewPolicyHash",
        "reviewerAuthorityBindingHash",
        "reviewerKeyId",
        "signedAttestationArtifactSha256",
        "durableForExactRevision",
        "issuedAt"
      ]
    ),
    lifecycleAbiRow(
      "ExecutionPermit",
      "programmable.router-v2-execution-permit.v1",
      "permitHash",
      [
        "schemaVersion",
        "permitVersion",
        "planHash",
        "builderEvidenceHash",
        "reviewerAttestationHash",
        "profileDescriptorHash",
        "exactContractBindingHash",
        "profileReleaseHash",
        "catalogHash",
        "securityControlHeadHash",
        "securityEpoch",
        "catalogGeneration",
        "revocationGeneration",
        "winnerKeyHash",
        "winnerReservationHash",
        "signerIoStartedAfterWinnerReservation",
        "walletIntent",
        "action",
        "permitNonce",
        "contractPermitDigest",
        "validAfterEpochSeconds",
        "deadlineEpochSeconds",
        "signerAuthorityBindingHash",
        "signatureArtifactSha256",
        "residualPermitPolicy"
      ]
    ),
    lifecycleAbiRow(
      "CanonicalLaunchReceipt",
      "programmable.router-v2-canonical-launch-receipt.v1",
      "receiptHash",
      [
        "schemaVersion",
        "receiptVersion",
        "permitHash",
        "contractPermitDigest",
        "planHash",
        "builderEvidenceHash",
        "reviewerAttestationHash",
        "reviewerDecision",
        "securityEpoch",
        "securityControlHeadHash",
        "catalogHash",
        "catalogGeneration",
        "revocationGeneration",
        "launchId",
        "profileDescriptorHash",
        "exactContractBindingHash",
        "profileReleaseHash",
        "profileRevenueBindingHash",
        "permitAuthorityBindingHash",
        "capabilitySemantics",
        "launchClassification",
        "requiredComponentIdentityKinds",
        "actionSelector",
        "actionTypehash",
        "executionModule",
        "executionModuleRuntimeCodeHash",
        "planSchemaId",
        "planSchemaArtifactSha256",
        "actionSchemaId",
        "actionSchemaArtifactSha256",
        "typedActionArtifactSha256",
        "chainId",
        "transactionHash",
        "transactionSender",
        "transactionNonce",
        "transactionTo",
        "transactionValueWei",
        "transactionDataSha256",
        "receiptStatus",
        "blockNumber",
        "blockHash",
        "componentGraphHash",
        "componentIdentities",
        "runtimeSetHash",
        "configurationHash",
        "poolKeyHash",
        "poolId",
        "resultHash",
        "providerBindingHash",
        "templateBindingHash",
        "feePolicyHash",
        "revenuePolicyHash",
        "deploymentLineageHash",
        "launchStampHash",
        "authenticatedReceiptEvidenceSha256"
      ]
    ),
    lifecycleAbiRow(
      "FinalityIndexingReceipt",
      "programmable.router-v2-finality-indexing-receipt.v1",
      "receiptHash",
      [
        "schemaVersion",
        "receiptVersion",
        "canonicalLaunchReceiptHash",
        "chainId",
        "transactionHash",
        "launchStampHash",
        "finalizedBlockNumber",
        "finalizedBlockHash",
        "providerAuthoritySetHash",
        "dualProviderFinalityEvidenceSha256",
        "finalityObservedAt",
        "indexingStatus",
        "indexerAuthorityBindingHash",
        "indexingEvidenceSha256",
        "indexedAt",
        "supersedesReceiptHash",
        "canonicalReceiptIdentityImmutable",
        "appendOnlyStatus"
      ]
    )
  ]
});
var MIGRATION_RULES_CORE_V1 = deepFreeze2({
  schemaVersion: "programmable.router-v2-shared-lifecycle-migration-rules.v1",
  rulesVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V1,
  rules: [
    "v1-artifacts-are-immutable-and-append-only",
    "unknown-or-missing-fields-are-rejected",
    "hash-domains-and-canonical-byte-formulas-never-change-in-place",
    "null-contract-binding-may-advance-only-to-exact-bound-inactive-after-frozen-evidence",
    "exact-contract-binding-never-rebinds-in-place-new-profile-version-required",
    "durable-review-attestation-survives-jit-renewal-only-for-byte-identical-plan-and-evidence",
    "security-epoch-and-revocation-generation-are-monotonic",
    "security-epoch-change-profile-suspension-or-global-kill-switch-invalidates-residual-permits",
    "winner-reservation-precedes-all-signer-io-and-is-idempotent",
    "receipt-corrections-append-a-superseding-receipt-never-mutate-history",
    "legacy-artifacts-require-an-explicit-hash-bound-adapter-no-implicit-upgrade",
    "custom-graph-v1-and-frozen-shards-v2-domains-never-reinterpret-as-new-profile-bytes",
    "legacy-successor-plan-binds-predecessor-artifact-and-plan-hashes-reason-version-and-fresh-review",
    "legacy-receipt-bridge-binds-old-runtime-events-readbacks-and-finality-production-mapping-null"
  ],
  compatibleSchemaVersions: {
    from: ["programmable.router-v2-*.v1"],
    to: ["programmable.router-v2-*.v1"],
    automaticMigrationAllowed: false
  }
});
var ROUTER_V2_SHARED_LIFECYCLE_MIGRATION_RULES_V1 = deepFreeze2({
  ...MIGRATION_RULES_CORE_V1,
  rulesHash: canonicalSha256(MIGRATION_RULES_CORE_V1.schemaVersion, MIGRATION_RULES_CORE_V1)
});
function lifecycleAbiRow(typeName, schemaVersion, hashField, canonicalFieldOrder) {
  return deepFreeze2({
    typeName,
    schemaVersion,
    hashField,
    hashDomain: schemaVersion,
    canonicalFieldOrder: Object.freeze([...canonicalFieldOrder])
  });
}
function normalizeRuntimeBindings(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 64) {
    throw new TypeError("applicant runtime binding cardinality is invalid");
  }
  const values = raw.map((value) => {
    exactKeys2(value, ["account", "runtimeCodeHash"], "applicant runtime binding");
    return Object.freeze({
      account: address(value.account, "applicant runtime account"),
      runtimeCodeHash: bytes32(value.runtimeCodeHash, "applicant runtime code hash")
    });
  }).sort((left, right) => compareUtf8(left.account, right.account));
  unique(values.map(({ account }) => account), "applicant runtime accounts");
  return Object.freeze(values);
}
function normalizeAllowanceCaps(raw) {
  if (!Array.isArray(raw) || raw.length > 64) {
    throw new TypeError("applicant allowance cap cardinality is invalid");
  }
  const values = raw.map((value) => {
    exactKeys2(value, ["maximumAmount", "spender", "token"], "applicant allowance cap");
    return Object.freeze({
      token: address(value.token, "allowance token"),
      spender: address(value.spender, "allowance spender"),
      maximumAmount: decimal(value.maximumAmount, 256, "allowance cap")
    });
  }).sort((left, right) => compareUtf8(
    `${left.token}:${left.spender}`,
    `${right.token}:${right.spender}`
  ));
  unique(values.map(({ token, spender }) => `${token}:${spender}`), "allowance pairs");
  return Object.freeze(values);
}
function normalizeRequiredComponentIdentityKinds(classificationRaw, raw) {
  const classification = launchClassification(classificationRaw);
  if (!Array.isArray(raw) || raw.length > COMPONENT_IDENTITY_KINDS.length || raw.some((kind) => !COMPONENT_IDENTITY_KINDS.includes(kind))) {
    throw new TypeError("required component identity kinds are invalid");
  }
  const kinds = [...raw].sort(compareUtf8);
  unique(kinds, "required component identity kinds");
  const exactByClassification = {
    TOKEN_HOOK_POOL: ["HOOK", "POOL", "TOKEN"],
    ADOPTED_EXISTING_ASSET_NEW_POOL: ["ADOPTED_EXISTING_ASSET", "HOOK", "POOL"],
    BROADER_APPLICATION: ["BROADER_APPLICATION"]
  };
  const exact = exactByClassification[classification];
  if (exact !== void 0 && canonicalizeJson(kinds) !== canonicalizeJson(exact)) {
    throw new TypeError("required component identities do not match launch classification");
  }
  return Object.freeze(kinds);
}
function assertLaunchClassificationForArchitecture(architecture, binding) {
  const optional = architecture === "OPTIONAL_COMPONENT_GRAPH";
  if (optional !== (binding.launchClassification === "OPTIONAL_COMPONENT_GRAPH")) {
    throw new TypeError("optional component classification is confined to its exact architecture");
  }
  if (architecture === "EXISTING_ASSET_NEW_V4_POOL" && binding.launchClassification !== "ADOPTED_EXISTING_ASSET_NEW_POOL") {
    throw new TypeError("existing-asset architecture lacks its exact identity classification");
  }
  if (!optional && binding.requiredComponentIdentityKinds.length === 0) {
    throw new TypeError("non-optional architecture cannot omit every component identity");
  }
}
function normalizeLaunchComponentIdentities(raw, required) {
  exactKeys2(raw, [
    "adoptedExistingAsset",
    "broaderApplicationHash",
    "hook",
    "poolId",
    "token"
  ], "launch component identities");
  const identities = {
    token: nullableNonzeroAddress(raw.token, "launch token identity"),
    hook: nullableNonzeroAddress(raw.hook, "launch hook identity"),
    poolId: nullableNonzeroBytes32(raw.poolId, "launch pool identity"),
    adoptedExistingAsset: nullableNonzeroAddress(
      raw.adoptedExistingAsset,
      "launch adopted existing asset identity"
    ),
    broaderApplicationHash: nullableNonzeroBytes32(
      raw.broaderApplicationHash,
      "launch broader application identity"
    )
  };
  const present = /* @__PURE__ */ new Set();
  if (identities.token !== null) present.add("TOKEN");
  if (identities.hook !== null) present.add("HOOK");
  if (identities.poolId !== null) present.add("POOL");
  if (identities.adoptedExistingAsset !== null) present.add("ADOPTED_EXISTING_ASSET");
  if (identities.broaderApplicationHash !== null) present.add("BROADER_APPLICATION");
  if (required.some((kind) => !present.has(kind))) {
    throw new TypeError("launch component identities omit a descriptor-required identity");
  }
  return deepFreeze2(identities);
}
function normalizeApplicantPlanSupersession(raw) {
  if (raw === null) return null;
  exactKeys2(raw, [
    "freshReviewRequired",
    "predecessorArtifactSha256",
    "predecessorDomain",
    "predecessorPlanHash",
    "supersessionReason",
    "supersessionVersion"
  ], "applicant plan supersession");
  if (!["CUSTOM_GRAPH_V1", "FROZEN_SHARDS_V2"].includes(raw.predecessorDomain) || raw.freshReviewRequired !== true) {
    throw new TypeError("legacy predecessor cannot be silently reinterpreted");
  }
  return Object.freeze({
    predecessorDomain: raw.predecessorDomain,
    predecessorArtifactSha256: sha256(
      raw.predecessorArtifactSha256,
      "legacy predecessor artifact"
    ),
    predecessorPlanHash: sha256(raw.predecessorPlanHash, "legacy predecessor plan"),
    supersessionReason: safeId(raw.supersessionReason, "supersession reason"),
    supersessionVersion: safeId(raw.supersessionVersion, "supersession version"),
    freshReviewRequired: true
  });
}
function exactArtifact(raw, rebuilt, label) {
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt)) {
    throw new TypeError(`${label} is counterfeit or drifted`);
  }
  return rebuilt;
}
function assertNoForbiddenApplicantFields(value, path = "$", seen = /* @__PURE__ */ new Set()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new TypeError("applicant plan contains a cycle");
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoForbiddenApplicantFields(child, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(plainRecord(value, path))) {
      if (FORBIDDEN_APPLICANT_FIELDS.has(key)) {
        throw new TypeError(`applicant plan contains forbidden field ${path}.${key}`);
      }
      assertNoForbiddenApplicantFields(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}
function plainRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || descriptor?.enumerable !== true || !("value" in descriptor)) {
      throw new TypeError(`${label} contains an accessor or non-data property`);
    }
  }
  return value;
}
function exactKeys2(value, expected, label) {
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has missing or unexpected fields`);
  }
}
function repository(value) {
  if (typeof value !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new TypeError("source repository is invalid");
  }
  return value;
}
function gitObject(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function address(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.toLowerCase();
}
function nullableNonzeroAddress(value, label) {
  if (value === null) return null;
  const normalized = address(value, label);
  if (normalized === "0x0000000000000000000000000000000000000000") {
    throw new TypeError(`${label} cannot use a zero placeholder`);
  }
  return normalized;
}
function bytes32(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function bytes4(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{8}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function nullableBytes32(value, label) {
  return value === null ? null : bytes32(value, label);
}
function nullableNonzeroBytes32(value, label) {
  const normalized = nullableBytes32(value, label);
  if (normalized === `0x${"0".repeat(64)}`) {
    throw new TypeError(`${label} cannot use a zero placeholder`);
  }
  return normalized;
}
function sha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function nullableSha256(value, label) {
  return value === null ? null : sha256(value, label);
}
function capabilitySemantics(value) {
  if (value !== "EXECUTE" && value !== "ADOPT") {
    throw new TypeError("profile capability semantics are invalid");
  }
  return value;
}
function launchClassification(value) {
  if (!LAUNCH_CLASSIFICATIONS.includes(value)) {
    throw new TypeError("launch classification is invalid");
  }
  return value;
}
function safeId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function positiveDecimal(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,77}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function decimal(value, bits, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const parsed = BigInt(value);
  if (parsed >= 1n << BigInt(bits)) throw new TypeError(`${label} exceeds uint${bits}`);
  return parsed.toString(10);
}
function instant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function stringSet(value, label) {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError(`${label} set is invalid`);
  const values = value.map((item) => safeId(item, label)).sort(compareUtf8);
  unique(values, label);
  return Object.freeze(values);
}
function unique(values, label) {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} are duplicated`);
}
function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}
function deepFreeze2(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze2(child);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/router-v2-shared-lifecycle-v2.ts
var ROUTER_V2_SHARED_LIFECYCLE_VERSION_V2 = "2.0.0";
var ROUTER_V2_MAXIMUM_SOURCE_SCHEDULE_ANCHOR_SECONDS_V2 = 1800;
function createLaunchGrantContractBindingV2(raw) {
  exactKeys3(raw, [
    "chainId",
    "grantAbiArtifactSha256",
    "grantCompilerArtifactSha256",
    "grantConsumerSelector",
    "grantRegistry",
    "grantRegistryRuntimeCodeHash",
    "grantReleaseHash",
    "grantStateReaderSelector",
    "grantTypehash",
    "grantVerifierArtifactSha256",
    "revenueBindingHash",
    "router",
    "routerRuntimeCodeHash"
  ], "launch grant contract binding");
  const core = {
    chainId: positiveDecimal2(raw.chainId, "grant chain id"),
    router: nonzeroAddress(raw.router, "grant router"),
    routerRuntimeCodeHash: nonzeroBytes32(raw.routerRuntimeCodeHash, "grant router runtime"),
    grantRegistry: nonzeroAddress(raw.grantRegistry, "grant registry"),
    grantRegistryRuntimeCodeHash: nonzeroBytes32(
      raw.grantRegistryRuntimeCodeHash,
      "grant registry runtime"
    ),
    grantTypehash: nonzeroBytes32(raw.grantTypehash, "grant typehash"),
    grantStateReaderSelector: bytes42(raw.grantStateReaderSelector, "grant state selector"),
    grantConsumerSelector: bytes42(raw.grantConsumerSelector, "grant consumer selector"),
    grantAbiArtifactSha256: sha2562(raw.grantAbiArtifactSha256, "grant ABI artifact"),
    grantCompilerArtifactSha256: sha2562(
      raw.grantCompilerArtifactSha256,
      "grant compiler artifact"
    ),
    grantVerifierArtifactSha256: sha2562(
      raw.grantVerifierArtifactSha256,
      "grant verifier artifact"
    ),
    grantReleaseHash: sha2562(raw.grantReleaseHash, "grant release"),
    revenueBindingHash: sha2562(raw.revenueBindingHash, "grant revenue binding")
  };
  return deepFreeze3({
    ...core,
    bindingHash: canonicalSha256("programmable.router-v2-launch-grant-contract-binding.v2", core)
  });
}
function createLaunchProfileDescriptorV2(raw) {
  exactKeys3(raw, [
    "activationAllowed",
    "blockers",
    "launchGrantContractBinding",
    "legacyDescriptor",
    "state",
    "sourceScheduleRequirement"
  ], "launch profile descriptor v2 input");
  const legacyDescriptor = assertLaunchProfileDescriptorV1(raw.legacyDescriptor);
  const binding = raw.launchGrantContractBinding === null ? null : assertLaunchGrantContractBindingV2(raw.launchGrantContractBinding);
  const blockers = stringSet2(raw.blockers, "grant profile blocker");
  if (raw.state === "ENABLED") {
    if (!raw.activationAllowed || binding === null || blockers.length !== 0 || legacyDescriptor.state !== "ENABLED") {
      throw new TypeError("enabled grant profile lacks exact Contract and legacy profile bindings");
    }
  } else if (raw.activationAllowed) {
    throw new TypeError("disabled grant profile cannot allow activation");
  }
  if (raw.state === "DENY_PENDING_CONTRACT_FREEZE" && binding !== null) {
    throw new TypeError("contract-pending grant profile contains a guessed binding");
  }
  const normalizedSourceScheduleRequirement = sourceScheduleRequirement(
    raw.sourceScheduleRequirement
  );
  const capabilitySemantics2 = legacyDescriptor.capabilitySemantics;
  if (capabilitySemantics2 === "ADOPT" && normalizedSourceScheduleRequirement !== "FORBIDDEN" || normalizedSourceScheduleRequirement === "REQUIRED" && capabilitySemantics2 !== "EXECUTE") {
    throw new TypeError("source schedule requirement crosses its profile capability");
  }
  if (binding !== null && legacyDescriptor.exactContractBinding !== null && (binding.chainId !== legacyDescriptor.exactContractBinding.chainId || binding.router !== legacyDescriptor.exactContractBinding.router || binding.routerRuntimeCodeHash !== legacyDescriptor.exactContractBinding.routerRuntimeCodeHash)) {
    throw new TypeError("launch grant binding crosses its exact Router profile");
  }
  const core = {
    schemaVersion: "programmable.router-v2-launch-profile-descriptor.v2",
    descriptorVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V2,
    slotId: legacyDescriptor.slotId,
    architecture: legacyDescriptor.architecture,
    state: raw.state,
    activationAllowed: raw.activationAllowed,
    sourceScheduleRequirement: normalizedSourceScheduleRequirement,
    legacyDescriptor,
    legacyDescriptorHash: legacyDescriptor.descriptorHash,
    launchGrantContractBinding: binding,
    grantTypehash: binding?.grantTypehash ?? null,
    grantStateReaderSelector: binding?.grantStateReaderSelector ?? null,
    grantConsumerSelector: binding?.grantConsumerSelector ?? null,
    grantReleaseHash: binding?.grantReleaseHash ?? null,
    revenueBindingHash: binding?.revenueBindingHash ?? null,
    blockers
  };
  return deepFreeze3({ ...core, descriptorHash: canonicalSha256(core.schemaVersion, core) });
}
function assertLaunchProfileDescriptorV2(raw) {
  plainRecord2(raw, "launch profile descriptor v2");
  const {
    architecture: _architecture,
    descriptorHash: _descriptorHash,
    descriptorVersion: _descriptorVersion,
    grantConsumerSelector: _grantConsumerSelector,
    grantReleaseHash: _grantReleaseHash,
    grantStateReaderSelector: _grantStateReaderSelector,
    grantTypehash: _grantTypehash,
    legacyDescriptorHash: _legacyDescriptorHash,
    revenueBindingHash: _revenueBindingHash,
    schemaVersion: _schemaVersion,
    slotId: _slotId,
    ...input
  } = raw;
  return exactArtifact2(raw, createLaunchProfileDescriptorV2(input), "launch profile descriptor v2");
}
function createLaunchProfileCatalogV2(descriptorsRaw) {
  if (!Array.isArray(descriptorsRaw) || descriptorsRaw.length < 1 || descriptorsRaw.length > 64) {
    throw new TypeError("launch grant catalog cardinality is invalid");
  }
  const descriptors = descriptorsRaw.map(assertLaunchProfileDescriptorV2).sort((left, right) => compare(left.slotId, right.slotId));
  unique2(descriptors.map(({ slotId }) => slotId), "launch grant profile slots");
  const core = {
    schemaVersion: "programmable.router-v2-launch-profile-catalog.v2",
    catalogVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V2,
    descriptors: deepFreeze3(descriptors)
  };
  return deepFreeze3({ ...core, catalogHash: canonicalSha256(core.schemaVersion, core) });
}
function createLaunchExecutionTimingV2(raw) {
  exactKeys3(raw, ["kind", "scheduleAnchor"], "launch execution timing input");
  if (raw.kind === "NO_SOURCE_SCHEDULE_CONSTRAINT") {
    if (raw.scheduleAnchor !== null) {
      throw new TypeError("evergreen execution timing cannot carry a source schedule anchor");
    }
    const core2 = {
      kind: "NO_SOURCE_SCHEDULE_CONSTRAINT",
      scheduleAnchor: null
    };
    return deepFreeze3({
      ...core2,
      timingHash: canonicalSha256("programmable.router-v2-launch-execution-timing.v2", core2)
    });
  }
  if (raw.kind !== "SOURCE_SCHEDULE_ANCHOR" || raw.scheduleAnchor === null) {
    throw new TypeError("launch execution timing kind is invalid");
  }
  exactKeys3(raw.scheduleAnchor, [
    "evidenceSha256",
    "sourceConstraintHash",
    "validAfterEpochSeconds",
    "validBeforeEpochSeconds"
  ], "source schedule anchor");
  const validAfterEpochSeconds = decimal2(
    raw.scheduleAnchor.validAfterEpochSeconds,
    64,
    "source schedule anchor valid-after"
  );
  const validBeforeEpochSeconds = decimal2(
    raw.scheduleAnchor.validBeforeEpochSeconds,
    64,
    "source schedule anchor valid-before"
  );
  if (BigInt(validBeforeEpochSeconds) <= BigInt(validAfterEpochSeconds) || BigInt(validBeforeEpochSeconds) - BigInt(validAfterEpochSeconds) > BigInt(ROUTER_V2_MAXIMUM_SOURCE_SCHEDULE_ANCHOR_SECONDS_V2)) {
    throw new TypeError("source schedule anchor window is invalid");
  }
  const core = {
    kind: "SOURCE_SCHEDULE_ANCHOR",
    scheduleAnchor: {
      sourceConstraintHash: sha2562(
        raw.scheduleAnchor.sourceConstraintHash,
        "source schedule anchor constraint"
      ),
      evidenceSha256: sha2562(raw.scheduleAnchor.evidenceSha256, "source schedule anchor evidence"),
      validAfterEpochSeconds,
      validBeforeEpochSeconds
    }
  };
  return deepFreeze3({
    ...core,
    timingHash: canonicalSha256("programmable.router-v2-launch-execution-timing.v2", core)
  });
}
function assertLaunchExecutionTimingV2(capabilitySemantics2, requirement, raw) {
  const rebuilt = createLaunchExecutionTimingV2({
    kind: raw.kind,
    scheduleAnchor: raw.scheduleAnchor
  });
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt)) {
    throw new TypeError("launch execution timing drifted from its canonical construction");
  }
  if ((capabilitySemantics2 === "ADOPT" || requirement === "FORBIDDEN") && rebuilt.kind !== "NO_SOURCE_SCHEDULE_CONSTRAINT") {
    throw new TypeError("completed-graph adoption cannot be silently time-bounded as execution");
  }
  if (requirement === "REQUIRED" && rebuilt.kind !== "SOURCE_SCHEDULE_ANCHOR") {
    throw new TypeError("reviewed execution profile requires its exact source schedule anchor");
  }
  return rebuilt;
}
function createApplicantLaunchPlanV2(descriptorRaw, legacyPlanRaw, executionTimingRaw, sourceHeadCommitRaw) {
  const descriptor = assertLaunchProfileDescriptorV2(descriptorRaw);
  const legacyPlan = assertApplicantLaunchPlanV1(descriptor.legacyDescriptor, legacyPlanRaw);
  const executionTiming = assertLaunchExecutionTimingV2(
    legacyPlan.capabilitySemantics,
    descriptor.sourceScheduleRequirement,
    executionTimingRaw
  );
  const componentIdentitiesHash = canonicalSha256(
    "programmable.router-v2-launch-component-identities.v2",
    legacyPlan.componentIdentities
  );
  const core = {
    schemaVersion: "programmable.router-v2-applicant-launch-plan.v2",
    planVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V2,
    profileDescriptorHash: descriptor.descriptorHash,
    legacyPlan,
    legacyPlanHash: legacyPlan.planHash,
    sourceRepository: legacyPlan.sourceRepository,
    sourceCommit: legacyPlan.sourceCommit,
    sourceHeadCommit: gitObject2(sourceHeadCommitRaw, "plan source head commit"),
    sourceTree: legacyPlan.sourceTree,
    launchWallet: legacyPlan.launchWallet,
    componentGraphHash: legacyPlan.componentGraphHash,
    componentIdentities: legacyPlan.componentIdentities,
    componentIdentitiesHash,
    expectedRuntimeCodehashSetHash: legacyPlan.exactRuntimeSetHash,
    configurationHash: legacyPlan.configurationHash,
    poolKeyHash: legacyPlan.poolKeyHash,
    poolId: legacyPlan.poolId,
    resultHash: legacyPlan.resultHash,
    launchId: legacyPlan.launchId,
    actionSemanticHash: legacyPlan.compiledActionSemanticHash,
    executionTiming,
    executionTimingHash: executionTiming.timingHash,
    issuedAt: legacyPlan.issuedAt
  };
  return deepFreeze3({ ...core, planHash: canonicalSha256(core.schemaVersion, core) });
}
function assertApplicantLaunchPlanV2(descriptor, raw) {
  return exactArtifact2(
    raw,
    createApplicantLaunchPlanV2(
      descriptor,
      raw.legacyPlan,
      raw.executionTiming,
      raw.sourceHeadCommit
    ),
    "applicant launch plan v2"
  );
}
function createBuilderEvidenceCommitmentV2(descriptorRaw, planRaw, legacyEvidenceRaw) {
  const descriptor = assertLaunchProfileDescriptorV2(descriptorRaw);
  const plan = assertApplicantLaunchPlanV2(descriptor, planRaw);
  const legacyEvidence = assertBuilderEvidenceCommitmentV1(
    descriptor.legacyDescriptor,
    plan.legacyPlan,
    legacyEvidenceRaw
  );
  const core = {
    schemaVersion: "programmable.router-v2-builder-evidence-commitment.v2",
    evidenceVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V2,
    profileDescriptorHash: descriptor.descriptorHash,
    planHash: plan.planHash,
    legacyEvidence,
    legacyEvidenceHash: legacyEvidence.evidenceHash,
    sourceCommit: plan.sourceCommit,
    sourceTree: plan.sourceTree,
    compilerArtifactSha256: legacyEvidence.compilerArtifactSha256,
    evidenceKinds: legacyEvidence.evidenceKinds,
    issuedAt: legacyEvidence.issuedAt
  };
  return deepFreeze3({ ...core, evidenceHash: canonicalSha256(core.schemaVersion, core) });
}
function assertBuilderEvidenceCommitmentV2(descriptor, plan, raw) {
  return exactArtifact2(
    raw,
    createBuilderEvidenceCommitmentV2(descriptor, plan, raw.legacyEvidence),
    "builder evidence commitment v2"
  );
}
function createReviewerAuthorityAttestationV2(descriptorRaw, catalogRaw, planRaw, evidenceRaw, legacyAttestationRaw, policyEpochRaw, catalogGenerationRaw, revocationGenerationRaw, proofRaw) {
  const descriptor = assertLaunchProfileDescriptorV2(descriptorRaw);
  const catalog = assertLaunchProfileCatalogV2(catalogRaw);
  if (!catalog.descriptors.some(({ descriptorHash }) => descriptorHash === descriptor.descriptorHash)) {
    throw new TypeError("reviewer authority attestation profile is absent from its exact catalog");
  }
  const plan = assertApplicantLaunchPlanV2(descriptor, planRaw);
  const evidence = assertBuilderEvidenceCommitmentV2(descriptor, plan, evidenceRaw);
  const legacyAttestation = assertReviewerAuthorityAttestationV1(
    descriptor.legacyDescriptor,
    plan.legacyPlan,
    evidence.legacyEvidence,
    legacyAttestationRaw
  );
  exactKeys3(proofRaw, [
    "policyEpochHash",
    "reviewGeneration",
    "reviewGenerationHash",
    "reviewerAttestationPreimageHash",
    "reviewerAuthorityKeyEpoch",
    "securityEpochHash",
    "reviewerAuthoritySignatureArtifactSha256"
  ], "v2 reviewer authority proof");
  const binding = descriptor.launchGrantContractBinding;
  if (binding === null) {
    throw new TypeError("v2 reviewer authority attestation lacks an exact grant Contract binding");
  }
  const launchGrantContractBindingHash = binding.bindingHash;
  const reviewerAuthorityKeyEpoch = positiveDecimal2(
    proofRaw.reviewerAuthorityKeyEpoch,
    "v2 reviewer authority key epoch"
  );
  const reviewGeneration = positiveDecimal2(
    proofRaw.reviewGeneration,
    "v2 review generation"
  );
  const reviewGenerationHash = sha2562(
    proofRaw.reviewGenerationHash,
    "v2 review generation hash"
  );
  const securityEpochHash = sha2562(proofRaw.securityEpochHash, "v2 review security epoch hash");
  const policyEpochHash = sha2562(proofRaw.policyEpochHash, "v2 review policy epoch hash");
  const reviewerAttestationPreimage = {
    profileDescriptorHash: descriptor.descriptorHash,
    planHash: plan.planHash,
    builderEvidenceHash: evidence.evidenceHash,
    sourceRepository: plan.sourceRepository,
    sourceCommit: plan.sourceCommit,
    sourceHeadCommit: plan.sourceHeadCommit,
    sourceTree: plan.sourceTree,
    launchWallet: plan.launchWallet,
    chainId: binding.chainId,
    router: binding.router,
    routerRuntimeCodeHash: binding.routerRuntimeCodeHash,
    componentGraphHash: plan.componentGraphHash,
    componentIdentitiesHash: plan.componentIdentitiesHash,
    expectedRuntimeCodehashSetHash: plan.expectedRuntimeCodehashSetHash,
    catalogHash: catalog.catalogHash,
    catalogGeneration: positiveDecimal2(catalogGenerationRaw, "v2 review catalog generation"),
    revocationGeneration: decimal2(
      revocationGenerationRaw,
      64,
      "v2 review revocation generation"
    ),
    reviewGeneration,
    reviewGenerationHash,
    securityEpoch: legacyAttestation.securityEpoch,
    securityEpochHash,
    policyEpoch: positiveDecimal2(policyEpochRaw, "review policy epoch"),
    policyEpochHash,
    reviewPolicyHash: legacyAttestation.reviewPolicyHash,
    reviewerAuthorityBindingHash: legacyAttestation.reviewerAuthorityBindingHash,
    reviewerAuthorityKeyEpoch,
    launchGrantContractBindingHash,
    executionTimingHash: plan.executionTimingHash,
    legacyAttestationHash: legacyAttestation.attestationHash,
    legacyDecision: legacyAttestation.decision,
    legacyReviewerAuthorityBindingHash: legacyAttestation.reviewerAuthorityBindingHash,
    legacyReviewerKeyId: legacyAttestation.reviewerKeyId,
    legacySignedAttestationArtifactSha256: legacyAttestation.signedAttestationArtifactSha256
  };
  const reviewerAttestationPreimageHash = canonicalSha256(
    "programmable.router-v2-reviewer-authority-attestation-preimage.v2",
    reviewerAttestationPreimage
  );
  if (sha2562(proofRaw.reviewerAttestationPreimageHash, "v2 reviewer attestation preimage") !== reviewerAttestationPreimageHash) {
    throw new TypeError("v2 reviewer authority proof does not bind its exact V2 attestation");
  }
  const core = {
    schemaVersion: "programmable.router-v2-reviewer-authority-attestation.v2",
    attestationVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V2,
    decision: legacyAttestation.decision,
    profileDescriptorHash: descriptor.descriptorHash,
    planHash: plan.planHash,
    builderEvidenceHash: evidence.evidenceHash,
    sourceRepository: plan.sourceRepository,
    sourceCommit: plan.sourceCommit,
    sourceHeadCommit: plan.sourceHeadCommit,
    sourceTree: plan.sourceTree,
    launchWallet: plan.launchWallet,
    chainId: binding.chainId,
    router: binding.router,
    routerRuntimeCodeHash: binding.routerRuntimeCodeHash,
    componentGraphHash: plan.componentGraphHash,
    componentIdentitiesHash: plan.componentIdentitiesHash,
    expectedRuntimeCodehashSetHash: plan.expectedRuntimeCodehashSetHash,
    legacyAttestation,
    legacyAttestationHash: legacyAttestation.attestationHash,
    catalogHash: catalog.catalogHash,
    catalogGeneration: reviewerAttestationPreimage.catalogGeneration,
    revocationGeneration: reviewerAttestationPreimage.revocationGeneration,
    reviewGeneration,
    reviewGenerationHash,
    securityEpoch: reviewerAttestationPreimage.securityEpoch,
    securityEpochHash,
    policyEpoch: reviewerAttestationPreimage.policyEpoch,
    policyEpochHash,
    reviewPolicyHash: legacyAttestation.reviewPolicyHash,
    reviewerAuthorityBindingHash: legacyAttestation.reviewerAuthorityBindingHash,
    reviewerAuthorityKeyEpoch,
    launchGrantContractBindingHash,
    reviewerAttestationPreimageHash,
    reviewerAuthoritySignatureArtifactSha256: sha2562(
      proofRaw.reviewerAuthoritySignatureArtifactSha256,
      "v2 reviewer authority signature artifact"
    ),
    durableForExactRevision: true,
    issuedAt: legacyAttestation.issuedAt
  };
  return deepFreeze3({ ...core, attestationHash: canonicalSha256(core.schemaVersion, core) });
}
function assertReviewerAuthorityAttestationV2(descriptor, catalog, plan, evidence, raw) {
  return exactArtifact2(
    raw,
    createReviewerAuthorityAttestationV2(
      descriptor,
      catalog,
      plan,
      evidence,
      raw.legacyAttestation,
      raw.policyEpoch,
      raw.catalogGeneration,
      raw.revocationGeneration,
      {
        reviewGeneration: raw.reviewGeneration,
        reviewGenerationHash: raw.reviewGenerationHash,
        securityEpochHash: raw.securityEpochHash,
        policyEpochHash: raw.policyEpochHash,
        reviewerAuthorityKeyEpoch: raw.reviewerAuthorityKeyEpoch,
        reviewerAttestationPreimageHash: raw.reviewerAttestationPreimageHash,
        reviewerAuthoritySignatureArtifactSha256: raw.reviewerAuthoritySignatureArtifactSha256
      }
    ),
    "reviewer authority attestation v2"
  );
}
function assertLaunchGrantContractBindingV2(raw) {
  plainRecord2(raw, "launch grant contract binding");
  const { bindingHash: _bindingHash, ...input } = raw;
  return exactArtifact2(
    raw,
    createLaunchGrantContractBindingV2(input),
    "launch grant contract binding"
  );
}
function assertLaunchProfileCatalogV2(raw) {
  exactKeys3(
    raw,
    ["catalogHash", "catalogVersion", "descriptors", "schemaVersion"],
    "launch profile catalog v2"
  );
  if (raw.schemaVersion !== "programmable.router-v2-launch-profile-catalog.v2" || raw.catalogVersion !== ROUTER_V2_SHARED_LIFECYCLE_VERSION_V2) {
    throw new TypeError("launch profile catalog v2 version is invalid");
  }
  return exactArtifact2(
    raw,
    createLaunchProfileCatalogV2(raw.descriptors),
    "launch profile catalog v2"
  );
}
var ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V2 = createLaunchProfileCatalogV2(
  ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V1.descriptors.map((legacyDescriptor) => createLaunchProfileDescriptorV2({
    legacyDescriptor,
    launchGrantContractBinding: null,
    state: "DENY_PENDING_CONTRACT_FREEZE",
    activationAllowed: false,
    sourceScheduleRequirement: "FORBIDDEN",
    blockers: [...legacyDescriptor.blockers, "exact-launch-grant-contract-freeze-missing"]
  }))
);
function lifecycleAbiRowV2(typeName, schemaVersion, hashField, canonicalFieldOrder) {
  return deepFreeze3({
    typeName,
    schemaVersion,
    hashField,
    hashDomain: schemaVersion,
    canonicalFieldOrder: Object.freeze([...canonicalFieldOrder])
  });
}
var ROUTER_V2_SHARED_LIFECYCLE_ABI_V2 = deepFreeze3({
  schemaVersion: "programmable.router-v2-shared-lifecycle-abi.v2",
  abiVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V2,
  publicTypeCount: 8,
  contractAbiStatus: "EXTERNAL_EXACT_ARTIFACT_REQUIRED_NO_GUESSED_TYPEHASHES",
  canonicalSerialization: "RFC8785_JCS_UTF8",
  canonicalArtifactBytesFormula: "UTF8(JCS(fullArtifact))",
  hashPreimageFormula: "UTF8(hashDomain)||0x00||UTF8(JCS(artifactWithoutHashField))",
  unknownFieldPolicy: "REJECT",
  productAuthorityIdentity: "LaunchGrant.grantDigest",
  legacyExecutionPermitRole: "LEGACY_TRANSPORT_ONLY_MAXIMUM_3600_SECONDS",
  lifecycleTypes: [
    lifecycleAbiRowV2(
      "LaunchProfileDescriptor",
      "programmable.router-v2-launch-profile-descriptor.v2",
      "descriptorHash",
      [
        "schemaVersion",
        "descriptorVersion",
        "slotId",
        "architecture",
        "state",
        "activationAllowed",
        "sourceScheduleRequirement",
        "legacyDescriptor",
        "legacyDescriptorHash",
        "launchGrantContractBinding",
        "grantTypehash",
        "grantStateReaderSelector",
        "grantConsumerSelector",
        "grantReleaseHash",
        "revenueBindingHash",
        "blockers"
      ]
    ),
    lifecycleAbiRowV2(
      "ApplicantLaunchPlan",
      "programmable.router-v2-applicant-launch-plan.v2",
      "planHash",
      [
        "schemaVersion",
        "planVersion",
        "profileDescriptorHash",
        "legacyPlan",
        "legacyPlanHash",
        "sourceRepository",
        "sourceCommit",
        "sourceHeadCommit",
        "sourceTree",
        "launchWallet",
        "componentGraphHash",
        "componentIdentities",
        "componentIdentitiesHash",
        "expectedRuntimeCodehashSetHash",
        "configurationHash",
        "poolKeyHash",
        "poolId",
        "resultHash",
        "launchId",
        "actionSemanticHash",
        "executionTiming",
        "executionTimingHash",
        "issuedAt"
      ]
    ),
    lifecycleAbiRowV2(
      "BuilderEvidenceCommitment",
      "programmable.router-v2-builder-evidence-commitment.v2",
      "evidenceHash",
      [
        "schemaVersion",
        "evidenceVersion",
        "profileDescriptorHash",
        "planHash",
        "legacyEvidence",
        "legacyEvidenceHash",
        "sourceCommit",
        "sourceTree",
        "compilerArtifactSha256",
        "evidenceKinds",
        "issuedAt"
      ]
    ),
    lifecycleAbiRowV2(
      "ReviewerAuthorityAttestation",
      "programmable.router-v2-reviewer-authority-attestation.v2",
      "attestationHash",
      [
        "schemaVersion",
        "attestationVersion",
        "decision",
        "profileDescriptorHash",
        "planHash",
        "builderEvidenceHash",
        "sourceRepository",
        "sourceCommit",
        "sourceHeadCommit",
        "sourceTree",
        "launchWallet",
        "chainId",
        "router",
        "routerRuntimeCodeHash",
        "componentGraphHash",
        "componentIdentitiesHash",
        "expectedRuntimeCodehashSetHash",
        "legacyAttestation",
        "legacyAttestationHash",
        "catalogHash",
        "catalogGeneration",
        "revocationGeneration",
        "reviewGeneration",
        "reviewGenerationHash",
        "securityEpoch",
        "securityEpochHash",
        "policyEpoch",
        "policyEpochHash",
        "reviewPolicyHash",
        "reviewerAuthorityBindingHash",
        "reviewerAuthorityKeyEpoch",
        "launchGrantContractBindingHash",
        "reviewerAttestationPreimageHash",
        "reviewerAuthoritySignatureArtifactSha256",
        "durableForExactRevision",
        "issuedAt"
      ]
    ),
    lifecycleAbiRowV2("LaunchGrant", "programmable.router-v2-launch-grant.v2", "grantHash", [
      "schemaVersion",
      "grantVersion",
      "stateAtIssuance",
      "noDefaultExpiry",
      "expiresAtEpochSeconds",
      "applicantIdHash",
      "sourceRepository",
      "sourceCommit",
      "sourceHeadCommit",
      "sourceTree",
      "profileDescriptorHash",
      "launchGrantContractBindingHash",
      "planHash",
      "builderEvidenceHash",
      "reviewerAttestationHash",
      "chainId",
      "router",
      "routerRuntimeCodeHash",
      "launchWallet",
      "componentGraphHash",
      "componentIdentities",
      "componentIdentitiesHash",
      "exactRuntimeBindings",
      "expectedRuntimeCodehashSetHash",
      "configurationHash",
      "poolKeyHash",
      "poolId",
      "resultHash",
      "launchId",
      "executionTimingHash",
      "actionCommitment",
      "reviewGeneration",
      "reviewGenerationHash",
      "securityEpoch",
      "securityEpochHash",
      "policyEpoch",
      "policyEpochHash",
      "catalogHash",
      "catalogGeneration",
      "revocationGeneration",
      "grantNonce",
      "action",
      "executionTiming",
      "issuedAt",
      "grantPreimageHash",
      "grantCompilerArtifactSha256",
      "grantDigest"
    ]),
    lifecycleAbiRowV2(
      "ExecutionPermit",
      "programmable.router-v2-execution-permit.v2",
      "permitHash",
      [
        "schemaVersion",
        "permitVersion",
        "legacyTransportOnly",
        "transportAuthorizationIdentity",
        "grantHash",
        "grantDigest",
        "grantStateHeadHash",
        "securityControlHeadHash",
        "profileDescriptorHash",
        "planHash",
        "reviewGeneration",
        "reviewGenerationHash",
        "securityEpoch",
        "securityEpochHash",
        "policyEpoch",
        "policyEpochHash",
        "catalogHash",
        "catalogGeneration",
        "revocationGeneration",
        "currentnessHash",
        "walletIntent",
        "walletIntentVerificationHash",
        "actionCommitment",
        "transportRequestHash",
        "winnerKeyHash",
        "winnerReservationHash",
        "signerIoStartedAfterWinnerReservation",
        "transportNonce",
        "validAfterEpochSeconds",
        "deadlineEpochSeconds",
        "signerAuthorityBindingHash",
        "signerKeyEpoch",
        "signerRequestHash",
        "signatureArtifactSha256",
        "signerAttestationSha256"
      ]
    ),
    lifecycleAbiRowV2(
      "CanonicalLaunchReceipt",
      "programmable.router-v2-canonical-launch-receipt.v2",
      "receiptHash",
      [
        "schemaVersion",
        "receiptVersion",
        "grantHash",
        "grantDigest",
        "grantConsumptionHash",
        "planHash",
        "builderEvidenceHash",
        "reviewerAttestationHash",
        "profileDescriptorHash",
        "reviewGeneration",
        "reviewGenerationHash",
        "securityEpoch",
        "securityEpochHash",
        "policyEpoch",
        "policyEpochHash",
        "chainId",
        "router",
        "routerRuntimeCodeHash",
        "launchWallet",
        "transactionHash",
        "transactionSender",
        "transactionTo",
        "transactionNonce",
        "transactionDataSha256",
        "transactionValueWei",
        "blockNumber",
        "blockHash",
        "launchId",
        "componentGraphHash",
        "componentIdentities",
        "componentIdentitiesHash",
        "exactRuntimeBindings",
        "expectedRuntimeCodehashSetHash",
        "configurationHash",
        "poolKeyHash",
        "poolId",
        "resultHash",
        "executionTimingHash",
        "verifiedReceiptEventHash",
        "receiptVerifierBindingHash",
        "receiptVerifierKeyEpoch",
        "launchStampHash",
        "authenticatedReceiptEvidenceSha256"
      ]
    ),
    lifecycleAbiRowV2(
      "FinalityIndexingReceipt",
      "programmable.router-v2-finality-indexing-receipt.v2",
      "receiptHash",
      [
        "schemaVersion",
        "receiptVersion",
        "grantDigest",
        "canonicalLaunchReceiptHash",
        "chainId",
        "transactionHash",
        "launchStampHash",
        "finalizedBlockNumber",
        "finalizedBlockHash",
        "finalityEvidenceSha256",
        "indexingStatus",
        "indexingEvidenceSha256",
        "supersedesReceiptHash",
        "canonicalReceiptIdentityImmutable",
        "appendOnlyStatus"
      ]
    )
  ]
});
var MIGRATION_RULES_CORE_V2 = deepFreeze3({
  schemaVersion: "programmable.router-v2-shared-lifecycle-migration-rules.v2",
  rulesVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V2,
  rules: [
    "v1-artifacts-remain-immutable-and-retain-their-original-domains",
    "launch-grant-is-the-only-evergreen-product-authorization-identity",
    "launch-grant-has-no-default-expiry-and-transitions-active-to-suspended-revoked-or-consumed-only",
    "launch-grant-consumption-is-atomic-one-use-and-one-winner-before-signer-io",
    "execution-permit-v2-is-legacy-transport-only-and-never-creates-or-extends-authority",
    "execution-permit-v1-or-v2-bytes-must-never-be-parsed-as-launch-grant-bytes",
    "execution-permit-v2-must-carry-the-same-launch-grant-digest-still-current-control-head-and-expires-within-the-fresh-wallet-intent",
    "global-kill-switch-profile-suspension-catalog-revocation-security-and-policy-epoch-drift-fail-closed-before-signer-io-and-consumption",
    "frozen-grant-registry-must-atomically-recheck-active-suspended-revoked-consumed-kill-profile-catalog-review-generation-and-epoch-state-before-every-consume",
    "frozen-grant-registry-must-enforce-block-timestamp-against-typed-source-schedule-anchor-or-explicit-no-anchor-before-every-consume",
    "source-schedule-anchor-is-a-typed-execute-only-plan-constraint-and-never-a-false-evergreen-adoption-claim",
    "website-registry-finality-and-rollback-rederive-the-entire-canonical-receipt-core-from-the-exact-launch-grant",
    "changed-repo-commit-tree-profile-plan-wallet-components-runtime-chain-router-or-epoch-requires-a-new-grant",
    "suspended-revoked-or-consumed-grants-fail-closed-and-cannot-be-reissued-under-the-same-digest",
    "suspended-profile-identity-is-terminal-and-recovery-requires-a-new-profile-key-or-version-review-generation-grant-currentness-and-winner-key",
    "unknown-or-missing-fields-and-cross-schema-byte-reinterpretation-are-rejected",
    "production-bindings-remain-null-deny-until-exact-contract-abi-typehash-selectors-runtime-and-release-freeze",
    "custom-graph-v1-and-frozen-shards-v2-bytes-never-reinterpret-as-v2-lifecycle-bytes",
    "legacy-successor-plan-requires-predecessor-hash-supersession-reason-version-and-fresh-review"
  ],
  compatibility: {
    v1AutomaticMigrationAllowed: false,
    legacyExecutionPermitAsLaunchGrantAllowed: false,
    grantAsExecutionPermitAllowed: false,
    productionBindingUpgradeInPlaceAllowed: false
  }
});
var ROUTER_V2_SHARED_LIFECYCLE_MIGRATION_RULES_V2 = deepFreeze3({
  ...MIGRATION_RULES_CORE_V2,
  rulesHash: canonicalSha256(MIGRATION_RULES_CORE_V2.schemaVersion, MIGRATION_RULES_CORE_V2)
});
function exactArtifact2(raw, expected, label) {
  if (canonicalizeJson(raw) !== canonicalizeJson(expected)) {
    throw new TypeError(`${label} drifted from its canonical construction`);
  }
  return deepFreeze3(raw);
}
function exactKeys3(raw, expected, label) {
  const recordValue = plainRecord2(raw, label);
  const actual = Object.keys(recordValue).sort(compare);
  const wanted = [...expected].sort(compare);
  if (canonicalizeJson(actual) !== canonicalizeJson(wanted)) {
    throw new TypeError(`${label} has missing or unexpected fields`);
  }
}
function plainRecord2(raw, label) {
  if (!isRecord(raw) || Object.getPrototypeOf(raw) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} contains a symbol field`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor?.enumerable !== true) {
      throw new TypeError(`${label} contains a non-enumerable field`);
    }
    if (!("value" in descriptor)) {
      throw new TypeError(`${label} contains an accessor or non-data field`);
    }
  }
  return raw;
}
function isRecord(raw) {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
function sha2562(raw, label) {
  if (typeof raw !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(raw)) {
    throw new TypeError(`${label} must be a lowercase sha256 digest`);
  }
  return raw;
}
function nonzeroBytes32(raw, label) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{64}$/u.test(raw) || /^0x0{64}$/u.test(raw)) {
    throw new TypeError(`${label} must be a nonzero lowercase bytes32`);
  }
  return raw;
}
function bytes42(raw, label) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{8}$/u.test(raw) || raw === "0x00000000") {
    throw new TypeError(`${label} must be a nonzero lowercase bytes4`);
  }
  return raw;
}
function nonzeroAddress(raw, label) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{40}$/u.test(raw) || /^0x0{40}$/u.test(raw)) {
    throw new TypeError(`${label} must be a nonzero lowercase address`);
  }
  return raw;
}
function decimal2(raw, bits, label) {
  if (typeof raw !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    throw new TypeError(`${label} must be an unsigned canonical decimal string`);
  }
  if (BigInt(raw) >= 1n << BigInt(bits)) throw new TypeError(`${label} exceeds uint${bits}`);
  return raw;
}
function positiveDecimal2(raw, label) {
  const value = decimal2(raw, 256, label);
  if (value === "0") throw new TypeError(`${label} must be positive`);
  return value;
}
function gitObject2(raw, label) {
  if (typeof raw !== "string" || !/^[0-9a-f]{40}$/u.test(raw)) {
    throw new TypeError(`${label} must be an exact lowercase git object id`);
  }
  return raw;
}
function safeId2(raw, label) {
  if (typeof raw !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u.test(raw)) {
    throw new TypeError(`${label} must be a safe identifier`);
  }
  return raw;
}
function stringSet2(raw, label) {
  if (!Array.isArray(raw) || raw.length > 64) throw new TypeError(`${label} set is invalid`);
  const values = raw.map((value) => safeId2(value, label)).sort(compare);
  unique2(values, label);
  return Object.freeze(values);
}
function sourceScheduleRequirement(raw) {
  if (!["FORBIDDEN", "OPTIONAL", "REQUIRED"].includes(
    raw
  )) {
    throw new TypeError("source schedule requirement is invalid");
  }
  return raw;
}
function unique2(values, label) {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} contains duplicates`);
}
function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function deepFreeze3(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze3(child);
  }
  return value;
}

// src/internal/router-self-service-v1/router-v2-shared-lifecycle-v3.ts
var ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3 = "3.0.0";
var ROUTER_V2_LAUNCH_GRANT_NO_DEFAULT_EXPIRY_V3 = true;
var ROUTER_V2_INTERNAL_CURRENTNESS_MAXIMUM_SECONDS_V3 = 3600;
var ZERO_BYTES322 = `0x${"0".repeat(64)}`;
var COMPLETED_GRAPH_LAUNCH_GRANT_CONTRACT_ABI_V1 = deepFreeze4({
  internalType: "struct IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1",
  type: "tuple",
  components: [
    ["chainId", "uint256"],
    ["registry", "address"],
    ["launchWallet", "address"],
    ["applicantIdHash", "bytes32"],
    ["profileKey", "bytes32"],
    ["profileDescriptorHash", "bytes32"],
    ["exactContractBindingHash", "bytes32"],
    ["contractPlanHash", "bytes32"],
    ["applicantPlanArtifactHash", "bytes32"],
    ["adoptionIntentHash", "bytes32"],
    ["executionReadiness", "uint8"],
    ["executionReadinessConstraintHash", "bytes32"],
    ["executionTimeConstraint", "uint8"],
    ["executionTimeConstraintEvidenceHash", "bytes32"],
    ["sourceRepositoryHash", "bytes32"],
    ["sourceCommitHash", "bytes32"],
    ["sourceTreeHash", "bytes32"],
    ["sourceLaunchId", "bytes32"],
    ["componentGraphHash", "bytes32"],
    ["exactRuntimeSetHash", "bytes32"],
    ["componentConfigurationSetHash", "bytes32"],
    ["revenueBindingHash", "bytes32"],
    ["resultHash", "bytes32"],
    ["builderEvidenceHash", "bytes32"],
    ["reviewerAttestationHash", "bytes32"],
    ["securityControlHeadHash", "bytes32"],
    ["securityEpochHash", "bytes32"],
    ["policyHash", "bytes32"],
    ["policyEpochHash", "bytes32"],
    ["securityEpoch", "uint64"],
    ["policyEpoch", "uint64"],
    ["reviewControl", "tuple(bytes32 reviewGenerationHash,uint64 reviewGeneration)"],
    ["antiReplayNonce", "bytes32"],
    ["winnerKeyHash", "bytes32"]
  ].map(([name, type]) => Object.freeze({ name, type }))
});
var COMPLETED_GRAPH_LAUNCH_GRANT_CONTRACT_ABI_SHA256_V1 = canonicalSha256(
  "programmable.router-v2-completed-graph-launch-grant-contract-abi.v1",
  COMPLETED_GRAPH_LAUNCH_GRANT_CONTRACT_ABI_V1
);
function assertLaunchGrantV3(descriptor, _raw) {
  assertLaunchProfileDescriptorV3(descriptor);
  throw new TypeError(
    "V3.0.0 LaunchGrant verification is hard DENY until a deployment/profile-bound successor"
  );
}
function assertCanonicalLaunchReceiptV3(descriptor, _raw) {
  assertLaunchProfileDescriptorV3(descriptor);
  throw new TypeError(
    "V3.0.0 canonical receipts are hard DENY until a deployment/profile-bound successor"
  );
}
function assertFinalityIndexingReceiptV3(descriptor, _raw) {
  assertLaunchProfileDescriptorV3(descriptor);
  throw new TypeError(
    "V3.0.0 finality/indexing receipts are hard DENY until a deployment/profile-bound successor"
  );
}
function computeCompletedGraphSourceCommitHashV3(gitObjectId2) {
  return computeGitObjectCommitmentV3(
    PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.typehashes.sourceCommit,
    gitObjectId2,
    "source commit"
  );
}
function computeCompletedGraphSourceTreeHashV3(gitObjectId2) {
  return computeGitObjectCommitmentV3(
    PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.typehashes.sourceTree,
    gitObjectId2,
    "source tree"
  );
}
function computeCompletedGraphPlanHashV3(plan) {
  assertCompletedGraphPlanContractV1(plan);
  const identities = plan.identities;
  const abiEncodedPlanHash = keccakWordsV3([
    bytes32WordV3(plan.profileKey, "plan.profileKey"),
    bytes32WordV3(plan.profileDescriptorHash, "plan.profileDescriptorHash"),
    bytes32WordV3(plan.exactContractBindingHash, "plan.exactContractBindingHash"),
    bytes32WordV3(plan.routeSchemaHash, "plan.routeSchemaHash"),
    bytes32WordV3(plan.planSchemaArtifactHash, "plan.planSchemaArtifactHash"),
    bytes32WordV3(plan.sourceRepositoryHash, "plan.sourceRepositoryHash"),
    gitObjectWordV3(plan.sourceCommitId, "plan.sourceCommitId"),
    gitObjectWordV3(plan.sourceTreeId, "plan.sourceTreeId"),
    bytes32WordV3(plan.sourceLaunchId, "plan.sourceLaunchId"),
    bytes32WordV3(plan.manifestHash, "plan.manifestHash"),
    bytes32WordV3(plan.policyHash, "plan.policyHash"),
    bytes32WordV3(plan.revenueBindingHash, "plan.revenueBindingHash"),
    bytes32WordV3(plan.compilerArtifactHash, "plan.compilerArtifactHash"),
    bytes32WordV3(plan.applicantPlanArtifactHash, "plan.applicantPlanArtifactHash"),
    bytes32WordV3(plan.adoptionIntentHash, "plan.adoptionIntentHash"),
    uintWordV3(String(plan.executionReadiness), 8, "plan.executionReadiness"),
    bytes32WordV3(
      plan.executionReadinessConstraintHash,
      "plan.executionReadinessConstraintHash"
    ),
    uintWordV3(String(plan.executionTimeConstraint), 8, "plan.executionTimeConstraint"),
    bytes32WordV3(
      plan.executionTimeConstraintEvidenceHash,
      "plan.executionTimeConstraintEvidenceHash"
    ),
    addressWordV3(plan.launchWallet, "plan.launchWallet"),
    uintWordV3(String(plan.launchClassification), 8, "plan.launchClassification"),
    uintWordV3(String(plan.identityMask), 16, "plan.identityMask"),
    addressWordAllowZeroV3(identities.token, "plan.identities.token"),
    addressWordAllowZeroV3(identities.hook, "plan.identities.hook"),
    addressWordAllowZeroV3(identities.nft, "plan.identities.nft"),
    bytes32WordV3(identities.applicationHash, "plan.identities.applicationHash"),
    bytes32WordV3(plan.componentGraphHash, "plan.componentGraphHash"),
    bytes32WordV3(plan.exactRuntimeSetHash, "plan.exactRuntimeSetHash"),
    bytes32WordV3(
      plan.componentConfigurationSetHash,
      "plan.componentConfigurationSetHash"
    ),
    bytes32WordV3(plan.configurationHash, "plan.configurationHash"),
    addressWordAllowZeroV3(plan.poolManager, "plan.poolManager"),
    bytes32WordV3(plan.poolManagerRuntimeCodeHash, "plan.poolManagerRuntimeCodeHash"),
    uintWordV3(
      String(plan.poolManagerComponentIndex),
      8,
      "plan.poolManagerComponentIndex"
    ),
    bytes32WordV3(plan.poolId, "plan.poolId"),
    bytes32WordV3(plan.poolKeyHash, "plan.poolKeyHash"),
    bytes32WordV3(plan.poolResultHash, "plan.poolResultHash"),
    bytes32WordV3(plan.architectureResultHash, "plan.architectureResultHash"),
    bytes32WordV3(plan.deploymentLineageHash, "plan.deploymentLineageHash"),
    bytes32WordV3(plan.resultHash, "plan.resultHash")
  ]);
  return keccakWordsV3([
    typehash("plan"),
    bytes32WordV3(abiEncodedPlanHash, "plan ABI hash")
  ]);
}
function assertCompletedGraphPlanContractV1(raw) {
  const plan = plainRecord3(raw, "CompletedGraphPlanV1");
  exactKeys4(plan, [
    "profileKey",
    "profileDescriptorHash",
    "exactContractBindingHash",
    "routeSchemaHash",
    "planSchemaArtifactHash",
    "sourceRepositoryHash",
    "sourceCommitId",
    "sourceTreeId",
    "sourceLaunchId",
    "manifestHash",
    "policyHash",
    "revenueBindingHash",
    "compilerArtifactHash",
    "applicantPlanArtifactHash",
    "adoptionIntentHash",
    "executionReadiness",
    "executionReadinessConstraintHash",
    "executionTimeConstraint",
    "executionTimeConstraintEvidenceHash",
    "launchWallet",
    "launchClassification",
    "identityMask",
    "identities",
    "componentGraphHash",
    "exactRuntimeSetHash",
    "componentConfigurationSetHash",
    "configurationHash",
    "poolManager",
    "poolManagerRuntimeCodeHash",
    "poolManagerComponentIndex",
    "poolId",
    "poolKeyHash",
    "poolResultHash",
    "architectureResultHash",
    "deploymentLineageHash",
    "resultHash"
  ], "CompletedGraphPlanV1");
  for (const key of [
    "profileKey",
    "profileDescriptorHash",
    "exactContractBindingHash",
    "routeSchemaHash",
    "planSchemaArtifactHash",
    "sourceRepositoryHash",
    "sourceLaunchId",
    "manifestHash",
    "policyHash",
    "revenueBindingHash",
    "compilerArtifactHash",
    "applicantPlanArtifactHash",
    "adoptionIntentHash",
    "executionReadinessConstraintHash",
    "executionTimeConstraintEvidenceHash",
    "componentGraphHash",
    "exactRuntimeSetHash",
    "componentConfigurationSetHash",
    "configurationHash",
    "poolManagerRuntimeCodeHash",
    "poolId",
    "poolKeyHash",
    "poolResultHash",
    "architectureResultHash",
    "deploymentLineageHash",
    "resultHash"
  ]) bytes32WordV3(plan[key], `plan.${key}`);
  gitObjectWordV3(plan.sourceCommitId, "plan.sourceCommitId");
  gitObjectWordV3(plan.sourceTreeId, "plan.sourceTreeId");
  if (plan.executionReadiness !== 1 || plan.executionReadinessConstraintHash !== PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.canonicalConstants.adoptionOnlyReadinessConstraintHash || !isExactExecutionTimeBindingV3(
    plan.executionTimeConstraint,
    plan.executionTimeConstraintEvidenceHash
  ) || plan.revenueBindingHash !== ZERO_BYTES322) {
    throw new TypeError("CompletedGraphPlanV1 is not exact ADOPT-only zero-revenue authority");
  }
  addressWordV3(plan.launchWallet, "plan.launchWallet");
  if (plan.launchClassification !== 1 && plan.launchClassification !== 2) {
    throw new TypeError("CompletedGraphPlanV1 launch classification is unsupported");
  }
  if (!Number.isInteger(plan.identityMask)) {
    throw new TypeError("CompletedGraphPlanV1 identity mask must be an integer number");
  }
  const identityMask = uintValueV3(String(plan.identityMask), 16, "plan.identityMask");
  if (identityMask === 0n || (identityMask & ~31n) !== 0n) {
    throw new TypeError("CompletedGraphPlanV1 identity mask is empty or has unknown bits");
  }
  const identities = plainRecord3(plan.identities, "plan.identities");
  exactKeys4(identities, ["token", "hook", "nft", "applicationHash"], "plan.identities");
  addressWordAllowZeroV3(identities.token, "plan.identities.token");
  addressWordAllowZeroV3(identities.hook, "plan.identities.hook");
  addressWordAllowZeroV3(identities.nft, "plan.identities.nft");
  bytes32WordV3(identities.applicationHash, "plan.identities.applicationHash");
  const identityPresence = [identities.token, identities.hook, identities.nft].map(
    (value) => value !== `0x${"0".repeat(40)}`
  );
  identityPresence.push(identities.applicationHash !== ZERO_BYTES322);
  identityPresence.forEach((present, index) => {
    if ((identityMask & 1n << BigInt(index)) !== 0n !== present) {
      throw new TypeError("CompletedGraphPlanV1 identity mask does not match primary identities");
    }
  });
  addressWordAllowZeroV3(plan.poolManager, "plan.poolManager");
  uintWordV3(
    String(plan.poolManagerComponentIndex),
    8,
    "plan.poolManagerComponentIndex"
  );
  const hasPool = (identityMask & 16n) !== 0n;
  const completePool = plan.poolManager !== `0x${"0".repeat(40)}` && plan.poolManagerRuntimeCodeHash !== ZERO_BYTES322 && plan.poolId !== ZERO_BYTES322 && plan.poolKeyHash !== ZERO_BYTES322 && plan.poolResultHash !== ZERO_BYTES322;
  if (hasPool !== completePool || !hasPool && plan.poolManagerComponentIndex !== 0) {
    throw new TypeError("CompletedGraphPlanV1 pool identity binding is incomplete");
  }
}
function createSourceIdentityReferentsV3(input) {
  const source = input.executableEvidenceSource;
  const core = {
    schemaVersion: "programmable.router-v2-source-identity-referents.v3",
    applicantRequest: input.applicantRequest,
    executableEvidenceSource: {
      ...source,
      sourceCommitHash: computeCompletedGraphSourceCommitHashV3(source.sourceCommitId),
      sourceTreeHash: computeCompletedGraphSourceTreeHashV3(source.sourceTreeId)
    },
    carrierEvidenceProvenance: input.carrierEvidenceProvenance,
    referentPolicy: "A_APPLICANT_REQUEST_B_EXECUTABLE_SOURCE_C_CARRIER_NEVER_SUBSTITUTABLE"
  };
  const result = deepFreeze4({ ...core, referentsHash: canonicalSha256(
    "programmable.router-v2-source-identity-referents.v3",
    core
  ) });
  assertSourceIdentityReferentsV3(result);
  return result;
}
function computeExecutableSourceRepositoryHashV3(sourceRepository) {
  if (typeof sourceRepository !== "string" || sourceRepository.length === 0 || sourceRepository !== sourceRepository.trim()) {
    throw new TypeError("Executable-source repository must be a canonical nonempty string");
  }
  let parsed;
  try {
    parsed = new URL(sourceRepository);
  } catch {
    throw new TypeError("Executable-source repository must be an absolute canonical URL");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "" || parsed.toString() !== sourceRepository) {
    throw new TypeError("Executable-source repository URL is not canonical HTTPS identity");
  }
  return createSha256ToEvmBytes32BindingV1(canonicalSha256(
    "programmable.router-v2-executable-source-repository.v3",
    { sourceRepository }
  )).evmBytes32;
}
function assertSourceIdentityReferentsV3(raw) {
  const value = plainRecord3(raw, "V3 source identity referents");
  exactKeys4(value, [
    "schemaVersion",
    "applicantRequest",
    "executableEvidenceSource",
    "carrierEvidenceProvenance",
    "referentPolicy",
    "referentsHash"
  ], "V3 source identity referents");
  if (value.schemaVersion !== "programmable.router-v2-source-identity-referents.v3" || value.referentPolicy !== "A_APPLICANT_REQUEST_B_EXECUTABLE_SOURCE_C_CARRIER_NEVER_SUBSTITUTABLE") {
    throw new TypeError("V3 source referent policy drifted");
  }
  const applicant = plainRecord3(value.applicantRequest, "applicant/request referent A");
  exactKeys4(applicant, [
    "applicantIdHash",
    "reviewerAttestationHash",
    "reviewAdmissionHash",
    "requestReceiptHash"
  ], "applicant/request referent A");
  bytes322(applicant.applicantIdHash, "referent A applicantIdHash");
  bytes322(applicant.reviewerAttestationHash, "referent A reviewerAttestationHash");
  sha2563(applicant.reviewAdmissionHash, "referent A reviewAdmissionHash");
  sha2563(applicant.requestReceiptHash, "referent A requestReceiptHash");
  const source = plainRecord3(value.executableEvidenceSource, "executable-source referent B");
  exactKeys4(source, [
    "sourceRepository",
    "sourceRepositoryHash",
    "sourceCommitId",
    "sourceTreeId",
    "sourceCommitHash",
    "sourceTreeHash",
    "sourceHeadCommit",
    "sourceLaunchId"
  ], "executable-source referent B");
  if (typeof source.sourceRepository !== "string" || source.sourceRepository.length === 0) {
    throw new TypeError("Executable-source referent B repository is missing");
  }
  bytes322(source.sourceRepositoryHash, "referent B sourceRepositoryHash");
  if (source.sourceRepositoryHash !== computeExecutableSourceRepositoryHashV3(source.sourceRepository)) {
    throw new TypeError("Executable-source referent B repository commitment drifted");
  }
  const commit = gitObjectId(source.sourceCommitId, "referent B sourceCommitId");
  const tree = gitObjectId(source.sourceTreeId, "referent B sourceTreeId");
  const head = gitObjectId(source.sourceHeadCommit, "referent B sourceHeadCommit");
  if (head !== commit) {
    throw new TypeError("Executable-source head must equal the exact reviewed executable commit");
  }
  bytes322(source.sourceLaunchId, "referent B sourceLaunchId");
  if (source.sourceCommitHash !== computeCompletedGraphSourceCommitHashV3(commit) || source.sourceTreeHash !== computeCompletedGraphSourceTreeHashV3(tree)) {
    throw new TypeError("Executable-source referent B Git commitment drifted");
  }
  const carrier = plainRecord3(value.carrierEvidenceProvenance, "carrier referent C");
  exactKeys4(carrier, [
    "builderEvidenceHash",
    "carrierArtifactSha256",
    "carrierCommit",
    "carrierTree"
  ], "carrier referent C");
  bytes322(carrier.builderEvidenceHash, "referent C builderEvidenceHash");
  sha2563(carrier.carrierArtifactSha256, "referent C carrier artifact");
  if (carrier.carrierCommit === null !== (carrier.carrierTree === null)) {
    throw new TypeError("Carrier referent C commit/tree provenance must be paired");
  }
  if (carrier.carrierCommit !== null) {
    gitObjectId(carrier.carrierCommit, "referent C carrierCommit");
    gitObjectId(carrier.carrierTree, "referent C carrierTree");
  }
  sha2563(value.referentsHash, "source referents hash");
  const { referentsHash: _referentsHash, ...core } = value;
  if (value.referentsHash !== canonicalSha256(
    "programmable.router-v2-source-identity-referents.v3",
    core
  )) throw new TypeError("V3 source referents hash drifted");
}
function assertApplicantLaunchPlanV3(descriptor, raw) {
  assertLaunchProfileDescriptorV3(descriptor);
  if (descriptor.architecture !== "COMPLETED_GRAPH_ADOPTION" || descriptor.contractArtifactBinding === null || descriptor.contractArtifactBindingHash === null) {
    throw new TypeError("V3 completed-graph plan requires the frozen ADOPT artifact descriptor");
  }
  const value = plainRecord3(raw, "V3 applicant launch plan");
  exactKeys4(value, [
    "schemaVersion",
    "planVersion",
    "legacyPlan",
    "legacyPlanHash",
    "legacyMigrationRule",
    "profileDescriptorHash",
    "contractArtifactBindingHash",
    "sourceReferents",
    "contractPlan",
    "contractPlanHash",
    "sourceLaunchId",
    "issuedAt",
    "planHash"
  ], "V3 applicant launch plan");
  if (value.schemaVersion !== "programmable.router-v2-applicant-launch-plan.v3" || value.planVersion !== ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3 || value.legacyMigrationRule !== "V2_ARCHIVAL_ONLY_EXPLICIT_V3_CONTRACT_FIELDS_CONTROL") {
    throw new TypeError("V3 applicant launch plan version or migration domain drifted");
  }
  const legacy = assertApplicantLaunchPlanV2(
    descriptor.legacyDescriptor,
    value.legacyPlan
  );
  const source = value.sourceReferents;
  const contractPlan = value.contractPlan;
  assertSourceIdentityReferentsV3(source);
  assertCompletedGraphPlanContractV1(contractPlan);
  if (value.legacyPlanHash !== legacy.planHash || value.profileDescriptorHash !== descriptor.descriptorHash || value.contractArtifactBindingHash !== descriptor.contractArtifactBindingHash || contractPlan.exactContractBindingHash !== createSha256ToEvmBytes32BindingV1(
    PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.artifactBindingHash
  ).evmBytes32 || contractPlan.profileDescriptorHash !== createSha256ToEvmBytes32BindingV1(descriptor.descriptorHash).evmBytes32 || value.contractPlanHash !== computeCompletedGraphPlanHashV3(contractPlan) || value.sourceLaunchId !== contractPlan.sourceLaunchId || contractPlan.sourceRepositoryHash !== source.executableEvidenceSource.sourceRepositoryHash || contractPlan.sourceCommitId !== source.executableEvidenceSource.sourceCommitId || contractPlan.sourceTreeId !== source.executableEvidenceSource.sourceTreeId || contractPlan.sourceLaunchId !== source.executableEvidenceSource.sourceLaunchId) {
    throw new TypeError("V3 applicant launch plan crossed source, profile or Contract identity");
  }
  sha2563(value.planHash, "V3 applicant plan hash");
  const { planHash: _planHash, ...core } = value;
  if (value.planHash !== canonicalSha256(
    "programmable.router-v2-applicant-launch-plan.v3",
    core
  )) throw new TypeError("V3 applicant launch plan hash drifted");
}
function assertBuilderEvidenceCommitmentV3(descriptor, plan, raw) {
  assertApplicantLaunchPlanV3(descriptor, plan);
  const value = plainRecord3(raw, "V3 builder evidence commitment");
  exactKeys4(value, [
    "schemaVersion",
    "evidenceVersion",
    "legacyEvidence",
    "legacyEvidenceHash",
    "profileDescriptorHash",
    "planHash",
    "contractArtifactBindingHash",
    "contractPlanHash",
    "sourceReferents",
    "contractBuilderEvidenceHash",
    "issuedAt",
    "evidenceHash"
  ], "V3 builder evidence commitment");
  if (value.schemaVersion !== "programmable.router-v2-builder-evidence-commitment.v3" || value.evidenceVersion !== ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3) {
    throw new TypeError("V3 builder evidence version drifted");
  }
  const legacy = assertBuilderEvidenceCommitmentV2(
    descriptor.legacyDescriptor,
    plan.legacyPlan,
    value.legacyEvidence
  );
  const source = value.sourceReferents;
  assertSourceIdentityReferentsV3(source);
  if (value.legacyEvidenceHash !== legacy.evidenceHash || value.profileDescriptorHash !== descriptor.descriptorHash || value.planHash !== plan.planHash || value.contractArtifactBindingHash !== plan.contractArtifactBindingHash || value.contractPlanHash !== plan.contractPlanHash || source.referentsHash !== plan.sourceReferents.referentsHash || value.contractBuilderEvidenceHash !== source.carrierEvidenceProvenance.builderEvidenceHash) {
    throw new TypeError("V3 builder evidence crossed its exact plan/source lineage");
  }
  sha2563(value.evidenceHash, "V3 builder evidence hash");
  const { evidenceHash: _evidenceHash, ...core } = value;
  if (value.evidenceHash !== canonicalSha256(
    "programmable.router-v2-builder-evidence-commitment.v3",
    core
  )) throw new TypeError("V3 builder evidence hash drifted");
}
function assertReviewerAuthorityAttestationV3(descriptor, plan, evidence, raw) {
  assertBuilderEvidenceCommitmentV3(descriptor, plan, evidence);
  const value = plainRecord3(raw, "V3 reviewer authority attestation");
  exactKeys4(value, [
    "schemaVersion",
    "attestationVersion",
    "decision",
    "legacyAttestation",
    "legacyAttestationHash",
    "profileDescriptorHash",
    "planHash",
    "builderEvidenceHash",
    "contractArtifactBindingHash",
    "contractPlanHash",
    "contractApplicantIdHash",
    "contractBuilderEvidenceHash",
    "contractReviewerAttestationHash",
    "securityControlHeadHash",
    "securityEpoch",
    "securityEpochHash",
    "policyHash",
    "policyEpoch",
    "policyEpochHash",
    "reviewControl",
    "durableForExactRevision",
    "issuedAt",
    "attestationHash"
  ], "V3 reviewer authority attestation");
  if (value.schemaVersion !== "programmable.router-v2-reviewer-authority-attestation.v3" || value.attestationVersion !== ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3 || value.decision !== "APPROVED" && value.decision !== "DENIED" || value.durableForExactRevision !== true) {
    throw new TypeError("V3 reviewer authority attestation version or decision drifted");
  }
  const legacy = assertReviewerAuthorityAttestationV2(
    descriptor.legacyDescriptor,
    ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V2,
    plan.legacyPlan,
    evidence.legacyEvidence,
    value.legacyAttestation
  );
  if (value.legacyAttestationHash !== legacy.attestationHash) {
    throw new TypeError("V3 reviewer attestation crossed its archival V2 identity");
  }
  const source = plan.sourceReferents;
  const review = plainRecord3(value.reviewControl, "V3 reviewer review control");
  exactKeys4(
    review,
    ["reviewGenerationHash", "reviewGeneration"],
    "V3 reviewer review control"
  );
  bytes322(review.reviewGenerationHash, "V3 reviewer generation hash");
  uintWordV3(String(review.reviewGeneration), 64, "V3 reviewer generation");
  uintWordV3(String(value.securityEpoch), 64, "V3 reviewer security epoch");
  uintWordV3(String(value.policyEpoch), 64, "V3 reviewer policy epoch");
  for (const key of [
    "contractApplicantIdHash",
    "contractBuilderEvidenceHash",
    "contractReviewerAttestationHash",
    "securityControlHeadHash",
    "securityEpochHash",
    "policyHash",
    "policyEpochHash"
  ]) bytes322(value[key], `V3 reviewer ${key}`);
  if (value.profileDescriptorHash !== descriptor.descriptorHash || value.planHash !== plan.planHash || value.builderEvidenceHash !== evidence.evidenceHash || value.contractArtifactBindingHash !== plan.contractArtifactBindingHash || value.contractPlanHash !== plan.contractPlanHash || value.contractApplicantIdHash !== source.applicantRequest.applicantIdHash || value.contractBuilderEvidenceHash !== evidence.contractBuilderEvidenceHash || value.contractReviewerAttestationHash !== source.applicantRequest.reviewerAttestationHash || value.policyHash !== plan.contractPlan.policyHash) {
    throw new TypeError("V3 reviewer attestation crossed plan, evidence or applicant identity");
  }
  sha2563(value.attestationHash, "V3 reviewer attestation hash");
  const { attestationHash: _attestationHash, ...core } = value;
  if (value.attestationHash !== canonicalSha256(
    "programmable.router-v2-reviewer-authority-attestation.v3",
    core
  )) throw new TypeError("V3 reviewer authority attestation hash drifted");
}
function assertLaunchIdentitySetV3(raw) {
  const value = plainRecord3(raw, "Launch identity set");
  exactKeys4(
    value,
    ["sourceLaunchId", "stampLaunchId", "antiReplayNonce"],
    "Launch identity set"
  );
  const identities = [value.sourceLaunchId, value.stampLaunchId, value.antiReplayNonce];
  for (const identity of identities) bytes322(identity, "Launch identity");
  if (new Set(identities).size !== identities.length) {
    throw new TypeError("sourceLaunchId, stampLaunchId and antiReplayNonce must be distinct");
  }
}
function computeCompletedGraphWinnerKeyHashV3(grant) {
  assertCompletedGraphLaunchGrantShapeV3(grant);
  return keccakWordsV3([
    typehash("winnerKey"),
    uintWordV3(grant.chainId, 256, "grant.chainId"),
    addressWordV3(grant.registry, "grant.registry"),
    addressWordV3(grant.launchWallet, "grant.launchWallet"),
    bytes32WordV3(grant.applicantIdHash, "grant.applicantIdHash"),
    bytes32WordV3(grant.profileKey, "grant.profileKey"),
    bytes32WordV3(grant.profileDescriptorHash, "grant.profileDescriptorHash"),
    bytes32WordV3(grant.exactContractBindingHash, "grant.exactContractBindingHash"),
    bytes32WordV3(grant.sourceRepositoryHash, "grant.sourceRepositoryHash"),
    bytes32WordV3(grant.sourceCommitHash, "grant.sourceCommitHash"),
    bytes32WordV3(grant.sourceTreeHash, "grant.sourceTreeHash"),
    bytes32WordV3(grant.sourceLaunchId, "grant.sourceLaunchId"),
    bytes32WordV3(grant.contractPlanHash, "grant.contractPlanHash"),
    bytes32WordV3(grant.applicantPlanArtifactHash, "grant.applicantPlanArtifactHash"),
    bytes32WordV3(grant.componentGraphHash, "grant.componentGraphHash"),
    bytes32WordV3(grant.adoptionIntentHash, "grant.adoptionIntentHash"),
    uintWordV3(grant.securityEpoch, 64, "grant.securityEpoch"),
    bytes32WordV3(grant.securityEpochHash, "grant.securityEpochHash"),
    uintWordV3(grant.policyEpoch, 64, "grant.policyEpoch"),
    bytes32WordV3(grant.policyEpochHash, "grant.policyEpochHash"),
    uintWordV3(
      grant.reviewControl.reviewGeneration,
      64,
      "grant.reviewControl.reviewGeneration"
    ),
    bytes32WordV3(
      grant.reviewControl.reviewGenerationHash,
      "grant.reviewControl.reviewGenerationHash"
    )
  ]);
}
function computeCompletedGraphLaunchGrantHashPartsV3(grant) {
  assertCompletedGraphLaunchGrantContractV1(grant);
  const bindingAHash = keccakWordsV3([
    typehash("launchGrantBindingA"),
    uintWordV3(grant.chainId, 256, "grant.chainId"),
    addressWordV3(grant.registry, "grant.registry"),
    addressWordV3(grant.launchWallet, "grant.launchWallet"),
    bytes32WordV3(grant.applicantIdHash, "grant.applicantIdHash"),
    bytes32WordV3(grant.profileKey, "grant.profileKey"),
    bytes32WordV3(grant.profileDescriptorHash, "grant.profileDescriptorHash"),
    bytes32WordV3(grant.exactContractBindingHash, "grant.exactContractBindingHash"),
    bytes32WordV3(grant.contractPlanHash, "grant.contractPlanHash"),
    bytes32WordV3(grant.applicantPlanArtifactHash, "grant.applicantPlanArtifactHash"),
    bytes32WordV3(grant.adoptionIntentHash, "grant.adoptionIntentHash"),
    uintWordV3(String(grant.executionReadiness), 8, "grant.executionReadiness"),
    bytes32WordV3(
      grant.executionReadinessConstraintHash,
      "grant.executionReadinessConstraintHash"
    )
  ]);
  const bindingBHash = keccakWordsV3([
    typehash("launchGrantBindingB"),
    uintWordV3(
      String(grant.executionTimeConstraint),
      8,
      "grant.executionTimeConstraint"
    ),
    bytes32WordV3(
      grant.executionTimeConstraintEvidenceHash,
      "grant.executionTimeConstraintEvidenceHash"
    ),
    bytes32WordV3(grant.sourceRepositoryHash, "grant.sourceRepositoryHash"),
    bytes32WordV3(grant.sourceCommitHash, "grant.sourceCommitHash"),
    bytes32WordV3(grant.sourceTreeHash, "grant.sourceTreeHash"),
    bytes32WordV3(grant.sourceLaunchId, "grant.sourceLaunchId"),
    bytes32WordV3(grant.componentGraphHash, "grant.componentGraphHash"),
    bytes32WordV3(grant.exactRuntimeSetHash, "grant.exactRuntimeSetHash"),
    bytes32WordV3(
      grant.componentConfigurationSetHash,
      "grant.componentConfigurationSetHash"
    ),
    bytes32WordV3(grant.revenueBindingHash, "grant.revenueBindingHash"),
    bytes32WordV3(grant.resultHash, "grant.resultHash")
  ]);
  const reviewHash = keccakWordsV3([
    typehash("launchGrantReview"),
    bytes32WordV3(grant.builderEvidenceHash, "grant.builderEvidenceHash"),
    bytes32WordV3(grant.reviewerAttestationHash, "grant.reviewerAttestationHash"),
    bytes32WordV3(grant.securityControlHeadHash, "grant.securityControlHeadHash"),
    bytes32WordV3(grant.securityEpochHash, "grant.securityEpochHash"),
    bytes32WordV3(grant.policyHash, "grant.policyHash"),
    bytes32WordV3(grant.policyEpochHash, "grant.policyEpochHash"),
    bytes32WordV3(
      grant.reviewControl.reviewGenerationHash,
      "grant.reviewControl.reviewGenerationHash"
    ),
    uintWordV3(grant.securityEpoch, 64, "grant.securityEpoch"),
    uintWordV3(grant.policyEpoch, 64, "grant.policyEpoch"),
    uintWordV3(
      grant.reviewControl.reviewGeneration,
      64,
      "grant.reviewControl.reviewGeneration"
    ),
    bytes32WordV3(grant.antiReplayNonce, "grant.antiReplayNonce"),
    bytes32WordV3(grant.winnerKeyHash, "grant.winnerKeyHash")
  ]);
  const contractGrantStructHash = keccakWordsV3([
    typehash("launchGrant"),
    bytes32WordV3(bindingAHash, "bindingAHash"),
    bytes32WordV3(bindingBHash, "bindingBHash"),
    bytes32WordV3(reviewHash, "reviewHash")
  ]);
  return Object.freeze({ bindingAHash, bindingBHash, reviewHash, contractGrantStructHash });
}
function computeCompletedGraphEip712DomainSeparatorV3(chainId, registry) {
  return keccakWordsV3([
    typehash("eip712Domain"),
    bytes32WordV3(
      PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.canonicalConstants.eip712NameHash,
      "EIP-712 name hash"
    ),
    bytes32WordV3(
      PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.canonicalConstants.eip712VersionHash,
      "EIP-712 version hash"
    ),
    uintWordV3(chainId, 256, "EIP-712 chainId"),
    addressWordV3(registry, "EIP-712 registry")
  ]);
}
function computeCompletedGraphLaunchGrantDigestV3(grant) {
  const { contractGrantStructHash } = computeCompletedGraphLaunchGrantHashPartsV3(grant);
  return keccak256V1(concatBytes(
    Uint8Array.of(25, 1),
    bytes32WordV3(computeCompletedGraphEip712DomainSeparatorV3(
      grant.chainId,
      grant.registry
    ), "EIP-712 domain separator"),
    bytes32WordV3(contractGrantStructHash, "Contract grant struct hash")
  ));
}
function createSha256ToEvmBytes32BindingV1(artifactSha256) {
  const digest = sha2563(artifactSha256, "SHA-256 to EVM binding artifact");
  const core = {
    schemaVersion: "programmable.sha256-to-evm-bytes32-binding.v1",
    artifactSha256: digest,
    evmBytes32: `0x${digest.slice("sha256:".length)}`,
    conversion: "PREFIX_REPLACEMENT_ONLY_NO_REHASH"
  };
  return deepFreeze4({ ...core, bindingHash: canonicalSha256(
    "programmable.sha256-to-evm-bytes32-binding.v1",
    core
  ) });
}
function assertSha256ToEvmBytes32BindingV1(raw) {
  const value = plainRecord3(raw, "SHA-256 to EVM bytes32 binding");
  exactKeys4(value, [
    "schemaVersion",
    "artifactSha256",
    "evmBytes32",
    "conversion",
    "bindingHash"
  ], "SHA-256 to EVM bytes32 binding");
  if (value.schemaVersion !== "programmable.sha256-to-evm-bytes32-binding.v1" || value.conversion !== "PREFIX_REPLACEMENT_ONLY_NO_REHASH") {
    throw new TypeError("SHA-256 to EVM bytes32 binding conversion drifted");
  }
  const digest = sha2563(value.artifactSha256, "SHA-256 to EVM binding artifact");
  bytes32WordV3(value.evmBytes32, "SHA-256 to EVM bytes32 value");
  if (value.evmBytes32 !== `0x${digest.slice("sha256:".length)}`) {
    throw new TypeError("SHA-256 to EVM binding must replace only the digest prefix");
  }
  sha2563(value.bindingHash, "SHA-256 to EVM binding hash");
  const { bindingHash: _bindingHash, ...core } = value;
  if (value.bindingHash !== canonicalSha256(
    "programmable.sha256-to-evm-bytes32-binding.v1",
    core
  )) throw new TypeError("SHA-256 to EVM bytes32 binding hash drifted");
}
function createCompletedGraphLaunchGrantDigestBindingV1(input) {
  assertCompletedGraphLaunchGrantContractV1(input.contractGrant);
  if (input.contractArtifactBindingHash !== PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.artifactBindingHash) {
    throw new TypeError("LaunchGrant digest binding does not name the frozen Contract artifact");
  }
  const exactContractArtifactBinding = createSha256ToEvmBytes32BindingV1(
    input.contractArtifactBindingHash
  );
  if (input.contractGrant.exactContractBindingHash !== exactContractArtifactBinding.evmBytes32) {
    throw new TypeError("Contract LaunchGrant exactContractBindingHash is not the frozen artifact");
  }
  sha2563(input.authorityGrantArtifactHash, "Authority grant artifact hash");
  const hashes = computeCompletedGraphLaunchGrantHashPartsV3(input.contractGrant);
  const stampLaunchId = computeCompletedGraphStampLaunchIdV3({
    chainId: input.contractGrant.chainId,
    registry: input.contractGrant.registry,
    launchWallet: input.contractGrant.launchWallet,
    profileKey: input.contractGrant.profileKey,
    contractPlanHash: input.contractGrant.contractPlanHash,
    sourceLaunchId: input.contractGrant.sourceLaunchId
  });
  const core = {
    schemaVersion: "programmable.router-v2-completed-graph-launch-grant-digest-binding.v1",
    contractGrant: input.contractGrant,
    contractGrantStructHash: hashes.contractGrantStructHash,
    contractGrantDigest: computeCompletedGraphLaunchGrantDigestV3(input.contractGrant),
    stampLaunchId,
    winnerKeyHash: input.contractGrant.winnerKeyHash,
    eip712DomainSeparator: computeCompletedGraphEip712DomainSeparatorV3(
      input.contractGrant.chainId,
      input.contractGrant.registry
    ),
    contractGrantAbiSha256: COMPLETED_GRAPH_LAUNCH_GRANT_CONTRACT_ABI_SHA256_V1,
    exactContractArtifactBinding,
    authorityGrantArtifactHash: input.authorityGrantArtifactHash
  };
  return deepFreeze4({ ...core, bindingHash: canonicalSha256(
    "programmable.router-v2-completed-graph-launch-grant-digest-binding.v1",
    core
  ) });
}
function assertCompletedGraphLaunchGrantDigestBindingV1(raw) {
  const value = plainRecord3(raw, "Completed Graph LaunchGrant digest binding");
  exactKeys4(value, [
    "schemaVersion",
    "contractGrant",
    "contractGrantStructHash",
    "contractGrantDigest",
    "stampLaunchId",
    "winnerKeyHash",
    "eip712DomainSeparator",
    "contractGrantAbiSha256",
    "exactContractArtifactBinding",
    "authorityGrantArtifactHash",
    "bindingHash"
  ], "Completed Graph LaunchGrant digest binding");
  if (value.schemaVersion !== "programmable.router-v2-completed-graph-launch-grant-digest-binding.v1") {
    throw new TypeError("Completed Graph LaunchGrant digest binding version drifted");
  }
  const exactArtifact3 = value.exactContractArtifactBinding;
  assertSha256ToEvmBytes32BindingV1(exactArtifact3);
  const expected = createCompletedGraphLaunchGrantDigestBindingV1({
    contractGrant: value.contractGrant,
    contractArtifactBindingHash: exactArtifact3.artifactSha256,
    authorityGrantArtifactHash: value.authorityGrantArtifactHash
  });
  if (canonicalSha256(
    "programmable.router-v2-completed-graph-launch-grant-digest-binding-equality.v1",
    value
  ) !== canonicalSha256(
    "programmable.router-v2-completed-graph-launch-grant-digest-binding-equality.v1",
    expected
  )) throw new TypeError("Completed Graph LaunchGrant derived digest binding drifted");
}
function computeCompletedGraphStampLaunchIdV3(input) {
  return keccakWordsV3([
    typehash("stampLaunchId"),
    uintWordV3(input.chainId, 256, "stamp.chainId"),
    addressWordV3(input.registry, "stamp.registry"),
    addressWordV3(input.launchWallet, "stamp.launchWallet"),
    bytes32WordV3(input.profileKey, "stamp.profileKey"),
    bytes32WordV3(input.contractPlanHash, "stamp.contractPlanHash"),
    bytes32WordV3(input.sourceLaunchId, "stamp.sourceLaunchId")
  ]);
}
function assertCompletedGraphLaunchGrantContractV1(raw) {
  assertCompletedGraphLaunchGrantShapeV3(raw);
  const grant = raw;
  const expectedWinner = computeCompletedGraphWinnerKeyHashV3(grant);
  if (grant.winnerKeyHash !== expectedWinner) {
    throw new TypeError("Contract LaunchGrant winner key binding drifted");
  }
  const stampLaunchId = computeCompletedGraphStampLaunchIdV3({
    chainId: grant.chainId,
    registry: grant.registry,
    launchWallet: grant.launchWallet,
    profileKey: grant.profileKey,
    contractPlanHash: grant.contractPlanHash,
    sourceLaunchId: grant.sourceLaunchId
  });
  assertLaunchIdentitySetV3({
    sourceLaunchId: grant.sourceLaunchId,
    stampLaunchId,
    antiReplayNonce: grant.antiReplayNonce
  });
}
function computeCompletedGraphExecutionCurrentnessStructHashV3(currentness) {
  assertCompletedGraphExecutionCurrentnessContractV1(currentness);
  const abiEncodedCurrentnessHash = keccakWordsV3([
    uintWordV3(currentness.chainId, 256, "currentness.chainId"),
    addressWordV3(currentness.registry, "currentness.registry"),
    addressWordV3(currentness.launchWallet, "currentness.launchWallet"),
    bytes32WordV3(currentness.launchGrantDigest, "currentness.launchGrantDigest"),
    bytes32WordV3(currentness.contractPlanHash, "currentness.contractPlanHash"),
    bytes32WordV3(currentness.receiptRequestHash, "currentness.receiptRequestHash"),
    bytes32WordV3(currentness.preflightReadbackHash, "currentness.preflightReadbackHash"),
    bytes32WordV3(currentness.simulationEvidenceHash, "currentness.simulationEvidenceHash"),
    bytes32WordV3(
      currentness.serviceDeploymentBindingHash,
      "currentness.serviceDeploymentBindingHash"
    ),
    bytes32WordV3(
      currentness.dualProviderQuorumEvidenceHash,
      "currentness.dualProviderQuorumEvidenceHash"
    ),
    bytes32WordV3(currentness.expectedResultHash, "currentness.expectedResultHash"),
    bytes32WordV3(currentness.adoptionIntentHash, "currentness.adoptionIntentHash"),
    bytes32WordV3(
      currentness.securityControlHeadHash,
      "currentness.securityControlHeadHash"
    ),
    bytes32WordV3(currentness.securityEpochHash, "currentness.securityEpochHash"),
    bytes32WordV3(currentness.policyEpochHash, "currentness.policyEpochHash"),
    uintWordV3(currentness.securityEpoch, 64, "currentness.securityEpoch"),
    uintWordV3(currentness.policyEpoch, 64, "currentness.policyEpoch"),
    bytes32WordV3(
      currentness.reviewControl.reviewGenerationHash,
      "currentness.reviewControl.reviewGenerationHash"
    ),
    uintWordV3(
      currentness.reviewControl.reviewGeneration,
      64,
      "currentness.reviewControl.reviewGeneration"
    ),
    bytes32WordV3(currentness.nonce, "currentness.nonce"),
    uintWordV3(currentness.validAfter, 64, "currentness.validAfter"),
    uintWordV3(currentness.deadline, 64, "currentness.deadline")
  ]);
  return keccakWordsV3([
    typehash("executionCurrentness"),
    bytes32WordV3(abiEncodedCurrentnessHash, "currentness ABI hash")
  ]);
}
function computeCompletedGraphExecutionCurrentnessDigestV3(currentness) {
  const structHash = computeCompletedGraphExecutionCurrentnessStructHashV3(currentness);
  return keccak256V1(concatBytes(
    Uint8Array.of(25, 1),
    bytes32WordV3(computeCompletedGraphEip712DomainSeparatorV3(
      currentness.chainId,
      currentness.registry
    ), "currentness EIP-712 domain"),
    bytes32WordV3(structHash, "currentness struct hash")
  ));
}
function assertCompletedGraphExecutionCurrentnessContractV1(raw) {
  const value = plainRecord3(raw, "ExecutionCurrentnessV1");
  exactKeys4(value, [
    "chainId",
    "registry",
    "launchWallet",
    "launchGrantDigest",
    "contractPlanHash",
    "receiptRequestHash",
    "preflightReadbackHash",
    "simulationEvidenceHash",
    "serviceDeploymentBindingHash",
    "dualProviderQuorumEvidenceHash",
    "expectedResultHash",
    "adoptionIntentHash",
    "securityControlHeadHash",
    "securityEpochHash",
    "policyEpochHash",
    "securityEpoch",
    "policyEpoch",
    "reviewControl",
    "nonce",
    "validAfter",
    "deadline"
  ], "ExecutionCurrentnessV1");
  uintWordV3(String(value.chainId), 256, "currentness.chainId");
  addressWordV3(value.registry, "currentness.registry");
  addressWordV3(value.launchWallet, "currentness.launchWallet");
  for (const key of [
    "launchGrantDigest",
    "contractPlanHash",
    "receiptRequestHash",
    "preflightReadbackHash",
    "simulationEvidenceHash",
    "serviceDeploymentBindingHash",
    "dualProviderQuorumEvidenceHash",
    "expectedResultHash",
    "adoptionIntentHash",
    "securityControlHeadHash",
    "securityEpochHash",
    "policyEpochHash",
    "nonce"
  ]) bytes32WordV3(value[key], `currentness.${key}`);
  for (const key of [
    "launchGrantDigest",
    "contractPlanHash",
    "receiptRequestHash",
    "preflightReadbackHash",
    "simulationEvidenceHash",
    "serviceDeploymentBindingHash",
    "dualProviderQuorumEvidenceHash",
    "expectedResultHash",
    "adoptionIntentHash",
    "securityControlHeadHash",
    "securityEpochHash",
    "policyEpochHash",
    "nonce"
  ]) {
    if (value[key] === ZERO_BYTES322) {
      throw new TypeError(`currentness.${key} evidence must be nonzero`);
    }
  }
  uintWordV3(String(value.securityEpoch), 64, "currentness.securityEpoch");
  uintWordV3(String(value.policyEpoch), 64, "currentness.policyEpoch");
  const review = plainRecord3(value.reviewControl, "currentness.reviewControl");
  exactKeys4(
    review,
    ["reviewGenerationHash", "reviewGeneration"],
    "currentness.reviewControl"
  );
  bytes32WordV3(review.reviewGenerationHash, "currentness.reviewControl.reviewGenerationHash");
  uintWordV3(
    String(review.reviewGeneration),
    64,
    "currentness.reviewControl.reviewGeneration"
  );
  const validAfter = uintValueV3(String(value.validAfter), 64, "currentness.validAfter");
  const deadline = uintValueV3(String(value.deadline), 64, "currentness.deadline");
  if (deadline < validAfter || deadline - validAfter > BigInt(ROUTER_V2_INTERNAL_CURRENTNESS_MAXIMUM_SECONDS_V3)) {
    throw new TypeError("Execution currentness deadline window exceeds 3600 seconds");
  }
}
function computeCompletedGraphAdoptionPreflightQueryHashV3(raw) {
  const query = plainRecord3(raw, "AdoptionPreflightQueryV1");
  exactKeys4(query, [
    "profileKey",
    "launchGrantDigest",
    "expectedContractPlanHash",
    "stampLaunchId",
    "antiReplayNonce",
    "winnerKeyHash",
    "componentGraphHash",
    "componentIndex",
    "component",
    "componentScope",
    "expectedSharedIdentityHash",
    "expectedRuntimeCodeHash",
    "exclusiveToken",
    "poolManager",
    "poolId",
    "currentnessNonce"
  ], "AdoptionPreflightQueryV1");
  const identitySet = {
    sourceLaunchId: bytes322(
      "0x0101010101010101010101010101010101010101010101010101010101010101",
      "preflight identity sentinel"
    ),
    stampLaunchId: bytes322(query.stampLaunchId, "query.stampLaunchId"),
    antiReplayNonce: bytes322(query.antiReplayNonce, "query.antiReplayNonce")
  };
  if (identitySet.stampLaunchId === identitySet.antiReplayNonce) {
    throw new TypeError("Preflight stampLaunchId and antiReplayNonce must be distinct");
  }
  const abiEncodedQueryHash = keccakWordsV3([
    bytes32WordV3(query.profileKey, "query.profileKey"),
    bytes32WordV3(query.launchGrantDigest, "query.launchGrantDigest"),
    bytes32WordV3(query.expectedContractPlanHash, "query.expectedContractPlanHash"),
    bytes32WordV3(query.stampLaunchId, "query.stampLaunchId"),
    bytes32WordV3(query.antiReplayNonce, "query.antiReplayNonce"),
    bytes32WordV3(query.winnerKeyHash, "query.winnerKeyHash"),
    bytes32WordV3(query.componentGraphHash, "query.componentGraphHash"),
    uintWordV3(String(query.componentIndex), 8, "query.componentIndex"),
    addressWordAllowZeroV3(query.component, "query.component"),
    uintWordV3(String(query.componentScope), 8, "query.componentScope"),
    bytes32WordV3(query.expectedSharedIdentityHash, "query.expectedSharedIdentityHash"),
    bytes32WordV3(query.expectedRuntimeCodeHash, "query.expectedRuntimeCodeHash"),
    addressWordAllowZeroV3(query.exclusiveToken, "query.exclusiveToken"),
    addressWordAllowZeroV3(query.poolManager, "query.poolManager"),
    bytes32WordV3(query.poolId, "query.poolId"),
    bytes32WordV3(query.currentnessNonce, "query.currentnessNonce")
  ]);
  const componentIsZero = query.component === `0x${"0".repeat(40)}`;
  if (componentIsZero ? query.componentIndex !== 0 || query.componentScope !== 0 || query.expectedSharedIdentityHash !== ZERO_BYTES322 || query.expectedRuntimeCodeHash !== ZERO_BYTES322 : query.componentScope !== 1 && query.componentScope !== 2) {
    throw new TypeError("Preflight query component fields are not a typed global/component query");
  }
  if (!componentIsZero && (query.expectedRuntimeCodeHash === ZERO_BYTES322 || query.componentScope === 1 && query.expectedSharedIdentityHash !== ZERO_BYTES322 || query.componentScope === 2 && query.expectedSharedIdentityHash === ZERO_BYTES322)) {
    throw new TypeError("Preflight component scope/runtime/shared identity binding is incomplete");
  }
  return keccakWordsV3([
    typehash("preflightQuery"),
    bytes32WordV3(abiEncodedQueryHash, "preflight query ABI hash")
  ]);
}
function computeCompletedGraphGrantStateHeadHashV3(stateHead) {
  if (!Number.isInteger(stateHead.status) || stateHead.status < 0 || stateHead.status > 3) {
    throw new TypeError("Contract Grant state status is outside GrantStatusV1");
  }
  return keccakWordsV3([
    typehash("grantStateHead"),
    bytes32WordV3(stateHead.grantDigest, "grant state digest"),
    bytes32WordV3(stateHead.grantHash, "grant state struct hash"),
    bytes32WordV3(stateHead.stampLaunchId, "grant state stampLaunchId"),
    uintWordV3(String(stateHead.status), 8, "grant state status")
  ]);
}
function computeCompletedGraphAdoptionPreflightComponentLeafHashV3(input) {
  const queryHash = computeCompletedGraphAdoptionPreflightQueryHashV3(input.query);
  assertCompletedGraphAdoptionPreflightReadbackShapeV3(input.readback);
  if (input.readback.queryHash !== queryHash) {
    throw new TypeError("Preflight component readback query hash drifted");
  }
  return keccakWordsV3([
    typehash("preflightComponentLeaf"),
    uintWordV3(String(input.query.componentIndex), 8, "preflight component index"),
    addressWordAllowZeroV3(input.query.component, "preflight component"),
    uintWordV3(String(input.query.componentScope), 8, "preflight component scope"),
    bytes32WordV3(
      input.query.expectedSharedIdentityHash,
      "preflight expected shared identity"
    ),
    bytes32WordV3(
      input.query.expectedRuntimeCodeHash,
      "preflight expected runtime codehash"
    ),
    bytes32WordV3(
      input.readback.actualComponentRuntimeCodeHash,
      "preflight actual runtime codehash"
    ),
    bytes32WordV3(
      input.readback.exclusiveComponentOccupantStampLaunchId,
      "preflight exclusive component occupant"
    ),
    bytes32WordV3(
      input.readback.sharedComponentIdentityHash,
      "preflight shared component identity"
    )
  ]);
}
function computeCompletedGraphAdoptionPreflightGlobalHeadHashV3(readback) {
  assertCompletedGraphAdoptionPreflightReadbackShapeV3(readback);
  assertCompletedGraphGrantStateHeadContractV1(readback.grantStateHead);
  const runtimeControlHash = keccakWordsV3([
    typehash("preflightRuntimeControl"),
    uintWordV3(readback.chainId, 256, "preflight readback chainId"),
    addressWordV3(readback.registry, "preflight readback registry"),
    bytes32WordV3(
      readback.runtimeAuthorityBindingHash,
      "preflight runtime authority binding"
    ),
    uintWordV3(String(readback.liveRuntimeMask), 16, "preflight live runtime mask"),
    bytes32WordV3(
      readback.dependencyBehaviorEvidenceHash,
      "preflight dependency behavior evidence"
    ),
    bytes32WordV3(
      readback.securityControlHeadHash,
      "preflight security control head"
    ),
    uintWordV3(readback.securityEpoch, 64, "preflight security epoch"),
    bytes32WordV3(readback.securityEpochHash, "preflight security epoch hash"),
    uintWordV3(readback.policyEpoch, 64, "preflight policy epoch"),
    bytes32WordV3(readback.policyEpochHash, "preflight policy epoch hash"),
    bytes32WordV3(
      readback.reviewControl.reviewGenerationHash,
      "preflight review generation hash"
    ),
    uintWordV3(
      readback.reviewControl.reviewGeneration,
      64,
      "preflight review generation"
    ),
    boolWordV3(readback.globalAdoptionKilled, "preflight global kill")
  ]);
  const lifecycleHash = keccakWordsV3([
    typehash("preflightLifecycle"),
    uintWordV3(String(readback.profileStatus), 8, "preflight profile status"),
    bytes32WordV3(readback.profileCapabilityHash, "preflight profile capability"),
    bytes32WordV3(readback.grantStateHead.stateHeadHash, "preflight grant state head"),
    bytes32WordV3(
      readback.winnerNonceOccupantGrantDigest,
      "preflight winner nonce occupant"
    ),
    bytes32WordV3(
      readback.winnerKeyOccupantGrantDigest,
      "preflight winner key occupant"
    ),
    boolWordV3(readback.currentnessNonceUsed, "preflight currentness nonce used"),
    uintWordV3(String(readback.receiptStatus), 8, "preflight receipt status"),
    bytes32WordV3(readback.receiptCoreHash, "preflight receipt core hash"),
    bytes32WordV3(
      readback.finalityIndexingReceiptHash,
      "preflight finality indexing receipt"
    )
  ]);
  const reservationHash = keccakWordsV3([
    typehash("preflightReservation"),
    bytes32WordV3(readback.graphOccupantStampLaunchId, "preflight graph occupant"),
    bytes32WordV3(
      readback.exclusiveTokenOccupantStampLaunchId,
      "preflight exclusive token occupant"
    ),
    bytes32WordV3(readback.poolOccupantStampLaunchId, "preflight pool occupant")
  ]);
  return keccakWordsV3([
    typehash("preflightGlobalHead"),
    bytes32WordV3(readback.queryHash, "preflight query hash"),
    bytes32WordV3(runtimeControlHash, "preflight runtime control hash"),
    bytes32WordV3(lifecycleHash, "preflight lifecycle hash"),
    bytes32WordV3(reservationHash, "preflight reservation hash")
  ]);
}
function assertCompletedGraphAdoptionPreflightReadbackContractV1(raw) {
  assertCompletedGraphAdoptionPreflightReadbackShapeV3(raw);
  assertCompletedGraphGrantStateHeadContractV1(raw.grantStateHead);
  const expectedGlobal = computeCompletedGraphAdoptionPreflightGlobalHeadHashV3(raw);
  if (raw.globalReadbackHeadHash !== expectedGlobal) {
    throw new TypeError("Preflight global readback head hash drifted");
  }
}
function assertCompletedGraphPreflightReadbackSetV3(input) {
  const zeroAddress = `0x${"0".repeat(40)}`;
  if (input.globalQuery.component !== zeroAddress || input.globalQuery.componentScope !== 0 || input.globalQuery.componentIndex !== 0 || input.globalQuery.expectedSharedIdentityHash !== ZERO_BYTES322 || input.globalQuery.expectedRuntimeCodeHash !== ZERO_BYTES322) {
    throw new TypeError("Preflight global query is not the exact zero-component sentinel");
  }
  assertCompletedGraphAdoptionPreflightReadbackContractV1(input.globalReadback);
  const globalQueryHash = computeCompletedGraphAdoptionPreflightQueryHashV3(input.globalQuery);
  if (input.globalReadback.queryHash !== globalQueryHash || input.globalReadback.chainId !== input.chainId || input.globalReadback.registry !== input.registry || input.globalReadback.componentLeafHash !== computeCompletedGraphAdoptionPreflightComponentLeafHashV3({
    query: input.globalQuery,
    readback: input.globalReadback
  })) {
    throw new TypeError("Preflight global query/readback domain drifted");
  }
  const maximumComponents = Number(
    PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.canonicalConstants.maxComponents
  );
  if (input.components.length === 0 || input.components.length > maximumComponents) {
    throw new TypeError("Preflight component count is outside Contract bounds");
  }
  const commonQueryKeys = [
    "profileKey",
    "launchGrantDigest",
    "expectedContractPlanHash",
    "stampLaunchId",
    "antiReplayNonce",
    "winnerKeyHash",
    "componentGraphHash",
    "exclusiveToken",
    "poolManager",
    "poolId",
    "currentnessNonce"
  ];
  const sharedReadbackKeys = [
    "chainId",
    "registry",
    "runtimeAuthorityBindingHash",
    "liveRuntimeMask",
    "dependencyBehaviorEvidenceHash",
    "securityControlHeadHash",
    "securityEpoch",
    "securityEpochHash",
    "policyEpoch",
    "policyEpochHash",
    "globalAdoptionKilled",
    "profileStatus",
    "profileCapabilityHash",
    "winnerNonceOccupantGrantDigest",
    "winnerKeyOccupantGrantDigest",
    "currentnessRevoked",
    "currentnessUsed",
    "currentnessNonceUsed",
    "receiptStatus",
    "receiptCoreHash",
    "finalityIndexingReceiptHash",
    "graphOccupantStampLaunchId",
    "exclusiveTokenOccupantStampLaunchId",
    "poolOccupantStampLaunchId"
  ];
  const rows = input.components.map((component, index) => {
    if (component.query.componentIndex !== index || component.query.componentScope === 0) {
      throw new TypeError("Preflight component query index or scope is not canonical");
    }
    for (const key of commonQueryKeys) {
      if (component.query[key] !== input.globalQuery[key]) {
        throw new TypeError(`Preflight component query crossed global field ${key}`);
      }
    }
    assertCompletedGraphAdoptionPreflightReadbackContractV1(component.readback);
    if (component.readback.queryHash !== computeCompletedGraphAdoptionPreflightQueryHashV3(component.query) || component.readback.chainId !== input.chainId || component.readback.registry !== input.registry || component.readback.componentLeafHash !== computeCompletedGraphAdoptionPreflightComponentLeafHashV3(component)) {
      throw new TypeError("Preflight component query/readback crossed its global domain");
    }
    for (const key of sharedReadbackKeys) {
      if (component.readback[key] !== input.globalReadback[key]) {
        throw new TypeError(`Preflight component readback crossed global field ${key}`);
      }
    }
    if (canonicalSha256(
      "programmable.router-v2-preflight-review-control-equality.v3",
      component.readback.reviewControl
    ) !== canonicalSha256(
      "programmable.router-v2-preflight-review-control-equality.v3",
      input.globalReadback.reviewControl
    ) || canonicalSha256(
      "programmable.router-v2-preflight-grant-head-equality.v3",
      component.readback.grantStateHead
    ) !== canonicalSha256(
      "programmable.router-v2-preflight-grant-head-equality.v3",
      input.globalReadback.grantStateHead
    )) {
      throw new TypeError("Preflight component readback crossed global review or Grant state");
    }
    return component;
  });
  return deepFreeze4(rows);
}
function createCompletedGraphProviderPreflightObservationV3(input) {
  for (const [label, digest] of [
    ["provider binding", input.providerBindingHash],
    ["provider operator identity", input.providerOperatorIdentityHash],
    ["provider endpoint identity", input.endpointIdentityHash],
    ["provider attestation", input.providerAttestationSha256]
  ]) sha2563(digest, label);
  uintWordV3(input.chainId, 256, "provider observation chain");
  addressWordV3(input.registry, "provider observation registry");
  uintWordV3(input.commonConfirmedBlockNumber, 64, "provider common confirmed block");
  bytes32WordV3(input.commonConfirmedBlockHash, "provider common confirmed block hash");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(input.observedAt) || Number.isNaN(Date.parse(input.observedAt))) {
    throw new TypeError("Provider observation timestamp is not canonical UTC");
  }
  const rows = assertCompletedGraphPreflightReadbackSetV3({
    chainId: input.chainId,
    registry: input.registry,
    globalQuery: input.globalQuery,
    globalReadback: input.globalReadback,
    components: input.components
  });
  const normalizedCore = {
    chainId: input.chainId,
    registry: input.registry,
    commonConfirmedBlockNumber: input.commonConfirmedBlockNumber,
    commonConfirmedBlockHash: input.commonConfirmedBlockHash,
    globalQuery: input.globalQuery,
    globalReadback: input.globalReadback,
    components: rows
  };
  const normalizedReadbackHash = canonicalSha256(
    "programmable.router-v2-completed-graph-normalized-preflight-readback.v3",
    normalizedCore
  );
  const core = {
    schemaVersion: "programmable.router-v2-completed-graph-provider-preflight-observation.v3",
    providerBindingHash: input.providerBindingHash,
    providerOperatorIdentityHash: input.providerOperatorIdentityHash,
    endpointIdentityHash: input.endpointIdentityHash,
    ...normalizedCore,
    observedAt: input.observedAt,
    providerAttestationSha256: input.providerAttestationSha256,
    normalizedReadbackHash
  };
  return deepFreeze4({ ...core, observationHash: canonicalSha256(
    "programmable.router-v2-completed-graph-provider-preflight-observation.v3",
    core
  ) });
}
function assertCompletedGraphProviderPreflightObservationV3(raw) {
  const value = plainRecord3(raw, "provider preflight observation");
  exactKeys4(value, [
    "schemaVersion",
    "providerBindingHash",
    "providerOperatorIdentityHash",
    "endpointIdentityHash",
    "chainId",
    "registry",
    "commonConfirmedBlockNumber",
    "commonConfirmedBlockHash",
    "globalQuery",
    "globalReadback",
    "components",
    "observedAt",
    "providerAttestationSha256",
    "normalizedReadbackHash",
    "observationHash"
  ], "provider preflight observation");
  if (value.schemaVersion !== "programmable.router-v2-completed-graph-provider-preflight-observation.v3") {
    throw new TypeError("Provider preflight observation version drifted");
  }
  const expected = createCompletedGraphProviderPreflightObservationV3({
    providerBindingHash: value.providerBindingHash,
    providerOperatorIdentityHash: value.providerOperatorIdentityHash,
    endpointIdentityHash: value.endpointIdentityHash,
    chainId: String(value.chainId),
    registry: value.registry,
    commonConfirmedBlockNumber: String(value.commonConfirmedBlockNumber),
    commonConfirmedBlockHash: value.commonConfirmedBlockHash,
    globalQuery: value.globalQuery,
    globalReadback: value.globalReadback,
    components: value.components,
    observedAt: String(value.observedAt),
    providerAttestationSha256: value.providerAttestationSha256
  });
  if (value.normalizedReadbackHash !== expected.normalizedReadbackHash || value.observationHash !== expected.observationHash) {
    throw new TypeError("Provider preflight observation hash drifted");
  }
}
function createCompletedGraphAdoptionPreflightAggregateV3(input) {
  assertCompletedGraphProviderPreflightObservationV3(input.primaryObservation);
  assertCompletedGraphProviderPreflightObservationV3(input.secondaryObservation);
  const primary = input.primaryObservation;
  const secondary = input.secondaryObservation;
  if (primary.providerBindingHash === secondary.providerBindingHash || primary.providerOperatorIdentityHash === secondary.providerOperatorIdentityHash || primary.endpointIdentityHash === secondary.endpointIdentityHash || primary.normalizedReadbackHash !== secondary.normalizedReadbackHash) {
    throw new TypeError("Preflight aggregate lacks independent byte-identical provider quorum");
  }
  const leaves = primary.components.map((component) => component.readback.componentLeafHash);
  const orderedComponentLeavesHash = keccak256V1(concatBytes(
    ...leaves.map((leaf) => bytes32WordV3(leaf, "ordered preflight component leaf"))
  ));
  const contractAggregateHash = keccakWordsV3([
    typehash("preflightReadback"),
    bytes32WordV3(
      primary.globalReadback.globalReadbackHeadHash,
      "preflight global readback head"
    ),
    bytes32WordV3(orderedComponentLeavesHash, "ordered preflight component leaves")
  ]);
  for (const [label, digest] of [
    ["primary provider preflight readback", primary.observationHash],
    ["secondary provider preflight readback", secondary.observationHash],
    ["provider independence evidence", input.providerIndependenceEvidenceSha256]
  ]) sha2563(digest, label);
  if (input.candidateCurrentnessDiagnostic !== null) {
    bytes322(
      input.candidateCurrentnessDiagnostic.candidateCurrentnessDigest,
      "candidate currentness diagnostic digest"
    );
    sha2563(
      input.candidateCurrentnessDiagnostic.diagnosticArtifactSha256,
      "candidate currentness diagnostic artifact"
    );
  }
  const signedCore = {
    schemaVersion: "programmable.router-v2-completed-graph-preflight-aggregate.v3",
    contractAggregateHash,
    globalReadbackHeadHash: primary.globalReadback.globalReadbackHeadHash,
    orderedComponentLeavesHash,
    componentCount: primary.components.length,
    primaryProviderReadbackSha256: primary.observationHash,
    secondaryProviderReadbackSha256: secondary.observationHash,
    providerIndependenceEvidenceSha256: input.providerIndependenceEvidenceSha256,
    normalizedReadbackHash: primary.normalizedReadbackHash
  };
  const signedAggregateHash = canonicalSha256(
    "programmable.router-v2-completed-graph-preflight-signed-aggregate.v3",
    signedCore
  );
  const artifactCore = {
    ...signedCore,
    signedAggregateHash,
    candidateCurrentnessDiagnostic: input.candidateCurrentnessDiagnostic
  };
  return deepFreeze4({ ...artifactCore, artifactHash: canonicalSha256(
    "programmable.router-v2-completed-graph-preflight-aggregate-artifact.v3",
    artifactCore
  ) });
}
function computeCompletedGraphCanonicalReceiptCoreHashV3(core) {
  const value = plainRecord3(core, "CanonicalReceiptCoreV1");
  exactKeys4(value, [
    "stampLaunchId",
    "sourceLaunchId",
    "receiptCoreHash",
    "launchGrantDigest",
    "launchGrantHash",
    "executionCurrentnessDigest",
    "contractPlanHash",
    "profileCapabilityHash",
    "adoptionRequestHash"
  ], "CanonicalReceiptCoreV1");
  for (const key of Object.keys(value)) {
    bytes32WordV3(value[key], `canonical receipt ${key}`);
  }
  if (core.stampLaunchId === core.sourceLaunchId) {
    throw new TypeError("Canonical receipt stampLaunchId and sourceLaunchId must be distinct");
  }
  return keccakWordsV3([
    typehash("canonicalReceiptCore"),
    bytes32WordV3(core.stampLaunchId, "canonical receipt stampLaunchId"),
    bytes32WordV3(core.sourceLaunchId, "canonical receipt sourceLaunchId"),
    bytes32WordV3(core.launchGrantDigest, "canonical receipt grant digest"),
    bytes32WordV3(core.launchGrantHash, "canonical receipt grant hash"),
    bytes32WordV3(
      core.executionCurrentnessDigest,
      "canonical receipt execution currentness digest"
    ),
    bytes32WordV3(core.contractPlanHash, "canonical receipt Contract plan hash"),
    bytes32WordV3(core.profileCapabilityHash, "canonical receipt profile capability hash"),
    bytes32WordV3(core.adoptionRequestHash, "canonical receipt adoption request hash")
  ]);
}
function computeCompletedGraphFinalityIndexingReceiptHashV3(receipt) {
  const value = plainRecord3(receipt, "FinalityIndexingReceiptV1");
  exactKeys4(value, [
    "stampLaunchId",
    "receiptCoreHash",
    "launchGrantDigest",
    "nextStatus",
    "previousFinalityIndexingReceiptHash",
    "finalityIndexingReceiptHash",
    "evidenceHash"
  ], "FinalityIndexingReceiptV1");
  for (const key of [
    "stampLaunchId",
    "receiptCoreHash",
    "launchGrantDigest",
    "previousFinalityIndexingReceiptHash",
    "finalityIndexingReceiptHash",
    "evidenceHash"
  ]) bytes32WordV3(value[key], `finality/indexing receipt ${key}`);
  if (typeof receipt.nextStatus !== "number" || ![3, 4, 5].includes(receipt.nextStatus)) {
    throw new TypeError("Finality/indexing nextStatus is outside the append-only lifecycle");
  }
  const normalizedAbiHash = keccakWordsV3([
    bytes32WordV3(receipt.stampLaunchId, "finality stampLaunchId"),
    bytes32WordV3(receipt.receiptCoreHash, "finality receipt core hash"),
    bytes32WordV3(receipt.launchGrantDigest, "finality grant digest"),
    uintWordV3(String(receipt.nextStatus), 8, "finality next status"),
    bytes32WordV3(
      receipt.previousFinalityIndexingReceiptHash,
      "finality previous receipt hash"
    ),
    bytes32WordV3(ZERO_BYTES322, "normalized finality self hash"),
    bytes32WordV3(receipt.evidenceHash, "finality evidence hash")
  ]);
  return keccakWordsV3([
    typehash("finalityIndexingReceipt"),
    bytes32WordV3(normalizedAbiHash, "normalized finality receipt ABI hash")
  ]);
}
function evaluateCompletedGraphPreflightAvailabilityV3(input) {
  const state = !input.deploymentIdentityCurrent ? "PENDING_DEPLOYMENT_IDENTITY" : !input.primaryProviderAvailable || !input.secondaryProviderAvailable ? "PENDING_PROVIDER_OUTAGE" : !input.byteIdenticalReadbacks ? "PENDING_PROVIDER_DIVERGENCE" : "READY_FOR_EXACT_SIMULATION";
  return Object.freeze({
    state,
    approvalState: "APPROVED_LAUNCH_ANYTIME_UNCHANGED",
    applicantFailure: false,
    maySignCurrentness: state === "READY_FOR_EXACT_SIMULATION"
  });
}
function evaluateCompletedGraphGrantCurrentnessV3(input) {
  assertCompletedGraphLaunchGrantContractV1(input.grant);
  const observed = input.observation;
  let state;
  if (observed.onchainGrantStatus === "Revoked") state = "REVOKED";
  else if (observed.onchainGrantStatus === "Consumed") state = "CONSUMED";
  else if (observed.onchainGrantStatus !== "Active") state = "SUSPENDED_NOT_ACTIVE_ONCHAIN";
  else if (observed.observedChainId !== input.grant.chainId || observed.observedRegistry !== input.grant.registry || observed.observedLaunchWallet !== input.grant.launchWallet) {
    state = "SUSPENDED_DOMAIN_DRIFT";
  } else if (observed.observedProfileKey !== input.grant.profileKey || observed.observedContractPlanHash !== input.grant.contractPlanHash || observed.observedSourceRepositoryHash !== input.grant.sourceRepositoryHash || observed.observedSourceCommitHash !== input.grant.sourceCommitHash || observed.observedSourceTreeHash !== input.grant.sourceTreeHash || observed.observedSourceHeadCommitHash !== input.grant.sourceCommitHash) {
    state = "SUSPENDED_REVIEW_REBIND_REQUIRED";
  } else if (observed.profileStatus !== "Active") state = "SUSPENDED_PROFILE";
  else if (!observed.runtimeAuthorityCurrent) state = "SUSPENDED_RUNTIME_BINDING";
  else if (observed.globalAdoptionKilled) state = "SUSPENDED_GLOBAL_KILL";
  else if (observed.securityControlHeadHash !== input.grant.securityControlHeadHash || observed.securityEpoch !== input.grant.securityEpoch || observed.securityEpochHash !== input.grant.securityEpochHash || observed.policyEpoch !== input.grant.policyEpoch || observed.policyEpochHash !== input.grant.policyEpochHash || observed.reviewGeneration !== input.grant.reviewControl.reviewGeneration || observed.reviewGenerationHash !== input.grant.reviewControl.reviewGenerationHash) {
    state = "SUSPENDED_REVIEW_REBIND_REQUIRED";
  } else state = "ACTIVE";
  return Object.freeze({
    state,
    mayIssueCurrentness: state === "ACTIVE",
    requiresNewReviewAndGrant: state !== "ACTIVE",
    durableApprovalExpiredByTime: false
  });
}
function assertCompletedGraphLaunchGrantShapeV3(raw) {
  const value = plainRecord3(raw, "Contract LaunchGrant");
  exactKeys4(value, [
    "chainId",
    "registry",
    "launchWallet",
    "applicantIdHash",
    "profileKey",
    "profileDescriptorHash",
    "exactContractBindingHash",
    "contractPlanHash",
    "applicantPlanArtifactHash",
    "adoptionIntentHash",
    "executionReadiness",
    "executionReadinessConstraintHash",
    "executionTimeConstraint",
    "executionTimeConstraintEvidenceHash",
    "sourceRepositoryHash",
    "sourceCommitHash",
    "sourceTreeHash",
    "sourceLaunchId",
    "componentGraphHash",
    "exactRuntimeSetHash",
    "componentConfigurationSetHash",
    "revenueBindingHash",
    "resultHash",
    "builderEvidenceHash",
    "reviewerAttestationHash",
    "securityControlHeadHash",
    "securityEpochHash",
    "policyHash",
    "policyEpochHash",
    "securityEpoch",
    "policyEpoch",
    "reviewControl",
    "antiReplayNonce",
    "winnerKeyHash"
  ], "Contract LaunchGrant");
  uintWordV3(String(value.chainId), 256, "grant.chainId");
  addressWordV3(value.registry, "grant.registry");
  addressWordV3(value.launchWallet, "grant.launchWallet");
  for (const key of [
    "applicantIdHash",
    "profileKey",
    "profileDescriptorHash",
    "exactContractBindingHash",
    "contractPlanHash",
    "applicantPlanArtifactHash",
    "adoptionIntentHash",
    "executionReadinessConstraintHash",
    "executionTimeConstraintEvidenceHash",
    "sourceRepositoryHash",
    "sourceCommitHash",
    "sourceTreeHash",
    "sourceLaunchId",
    "componentGraphHash",
    "exactRuntimeSetHash",
    "componentConfigurationSetHash",
    "revenueBindingHash",
    "resultHash",
    "builderEvidenceHash",
    "reviewerAttestationHash",
    "securityControlHeadHash",
    "securityEpochHash",
    "policyHash",
    "policyEpochHash",
    "antiReplayNonce",
    "winnerKeyHash"
  ]) bytes32WordV3(value[key], `grant.${key}`);
  if (value.executionReadiness !== 1 || value.executionReadinessConstraintHash !== PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.canonicalConstants.adoptionOnlyReadinessConstraintHash || !isExactExecutionTimeBindingV3(
    value.executionTimeConstraint,
    value.executionTimeConstraintEvidenceHash
  ) || value.revenueBindingHash !== ZERO_BYTES322) {
    throw new TypeError("Contract LaunchGrant is not exact ADOPT-only zero-revenue authority");
  }
  uintWordV3(String(value.securityEpoch), 64, "grant.securityEpoch");
  uintWordV3(String(value.policyEpoch), 64, "grant.policyEpoch");
  const review = plainRecord3(value.reviewControl, "grant.reviewControl");
  exactKeys4(review, ["reviewGenerationHash", "reviewGeneration"], "grant.reviewControl");
  bytes32WordV3(review.reviewGenerationHash, "grant.reviewControl.reviewGenerationHash");
  uintWordV3(String(review.reviewGeneration), 64, "grant.reviewControl.reviewGeneration");
}
function createLaunchProfileDescriptorV3(input) {
  const legacyDescriptor = assertLaunchProfileDescriptorV2(input.legacyDescriptor);
  const frozenLegacy = ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V2.descriptors.find(
    ({ slotId }) => slotId === legacyDescriptor.slotId
  );
  if (frozenLegacy?.descriptorHash !== legacyDescriptor.descriptorHash) {
    throw new TypeError("V3 descriptor legacy profile is outside the frozen V2 catalog");
  }
  const artifactPresent = input.contractArtifactBinding !== null;
  const executable = artifactPresent && input.contractDeploymentBinding !== null && input.profileCapabilityBinding !== null;
  if (input.legacyDescriptor.architecture !== "COMPLETED_GRAPH_ADOPTION" && (artifactPresent || input.contractDeploymentBinding !== null || input.profileCapabilityBinding !== null)) {
    throw new TypeError("Only COMPLETED_GRAPH_ADOPTION may consume this exact ADOPT artifact");
  }
  if (executable) {
    throw new TypeError(
      "V3.0.0 activation is disabled; exact deployment requires a separately frozen successor"
    );
  }
  if (input.contractDeploymentBinding === null !== (input.profileCapabilityBinding === null)) {
    throw new TypeError("Deployment and profile capability bindings must enter together");
  }
  const state = artifactPresent ? "DENY_PENDING_DEPLOYMENT_AND_PROFILE_BINDING" : "DENY_PENDING_CONTRACT_ARTIFACT";
  const core = {
    schemaVersion: "programmable.router-v2-launch-profile-descriptor.v3",
    descriptorVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3,
    slotId: input.legacyDescriptor.slotId,
    architecture: input.legacyDescriptor.architecture,
    state,
    activationAllowed: false,
    sourceScheduleRequirement: input.legacyDescriptor.sourceScheduleRequirement,
    legacyDescriptor: input.legacyDescriptor,
    legacyDescriptorHash: input.legacyDescriptor.descriptorHash,
    contractArtifactBinding: input.contractArtifactBinding,
    contractArtifactBindingHash: input.contractArtifactBinding?.artifactBindingHash ?? null,
    contractDeploymentBinding: input.contractDeploymentBinding,
    profileCapabilityBinding: input.profileCapabilityBinding,
    blockers: [...input.blockers]
  };
  const result = deepFreeze4({ ...core, descriptorHash: canonicalSha256(
    "programmable.router-v2-launch-profile-descriptor.v3",
    core
  ) });
  assertLaunchProfileDescriptorV3(result);
  return result;
}
function assertLaunchProfileDescriptorV3(raw) {
  const value = plainRecord3(raw, "V3 launch profile descriptor");
  exactKeys4(value, [
    "schemaVersion",
    "descriptorVersion",
    "slotId",
    "architecture",
    "state",
    "activationAllowed",
    "sourceScheduleRequirement",
    "legacyDescriptor",
    "legacyDescriptorHash",
    "contractArtifactBinding",
    "contractArtifactBindingHash",
    "contractDeploymentBinding",
    "profileCapabilityBinding",
    "blockers",
    "descriptorHash"
  ], "V3 launch profile descriptor");
  if (value.schemaVersion !== "programmable.router-v2-launch-profile-descriptor.v3" || value.descriptorVersion !== ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3) {
    throw new TypeError("V3 launch profile descriptor version drifted");
  }
  const legacy = assertLaunchProfileDescriptorV2(
    value.legacyDescriptor
  );
  const frozenLegacy = ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V2.descriptors.find(
    ({ slotId }) => slotId === legacy.slotId
  );
  if (frozenLegacy?.descriptorHash !== legacy.descriptorHash || value.slotId !== legacy.slotId || value.architecture !== legacy.architecture || value.legacyDescriptorHash !== legacy.descriptorHash || value.sourceScheduleRequirement !== legacy.sourceScheduleRequirement) {
    throw new TypeError("V3 descriptor crossed its frozen V2 profile identity");
  }
  const blockers = value.blockers;
  if (!Array.isArray(blockers) || blockers.length === 0 || blockers.length > 16 || blockers.some((entry) => typeof entry !== "string" || entry.length === 0) || new Set(blockers).size !== blockers.length) {
    throw new TypeError("V3 DENY descriptor requires a unique nonempty blocker set");
  }
  const completed = legacy.architecture === "COMPLETED_GRAPH_ADOPTION";
  if (completed) {
    assertCompletedGraphAdoptionContractArtifactBindingV1(value.contractArtifactBinding);
    if (value.contractArtifactBindingHash !== PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.artifactBindingHash || value.contractDeploymentBinding !== null || value.profileCapabilityBinding !== null || value.state !== "DENY_PENDING_DEPLOYMENT_AND_PROFILE_BINDING" || value.activationAllowed !== false) {
      throw new TypeError("V3.0.0 completed-graph descriptor is not frozen UNDEPLOYED/DENY");
    }
  } else if (value.contractArtifactBinding !== null || value.contractArtifactBindingHash !== null || value.contractDeploymentBinding !== null || value.profileCapabilityBinding !== null || value.state !== "DENY_PENDING_CONTRACT_ARTIFACT" || value.activationAllowed !== false) {
    throw new TypeError("V3.0.0 unsupported profile slot must remain NULL_DENY");
  }
  sha2563(value.descriptorHash, "V3 descriptor hash");
  const { descriptorHash: _descriptorHash, ...core } = value;
  if (value.descriptorHash !== canonicalSha256(
    "programmable.router-v2-launch-profile-descriptor.v3",
    core
  )) throw new TypeError("V3 launch profile descriptor hash drifted");
}
function createLaunchProfileCatalogV3(descriptors) {
  for (const descriptor of descriptors) assertLaunchProfileDescriptorV3(descriptor);
  const frozenSlots = new Set(ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V2.descriptors.map(({ slotId }) => slotId));
  if (descriptors.length !== 6 || new Set(descriptors.map(({ slotId }) => slotId)).size !== 6 || descriptors.some(({ slotId }) => !frozenSlots.has(slotId))) {
    throw new TypeError("V3 target catalog must contain exactly six distinct profile slots");
  }
  const ordered = [...descriptors].sort((left, right) => compare2(left.slotId, right.slotId));
  const core = {
    schemaVersion: "programmable.router-v2-launch-profile-catalog.v3",
    catalogVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3,
    descriptors: ordered
  };
  const result = deepFreeze4({ ...core, catalogHash: canonicalSha256(
    "programmable.router-v2-launch-profile-catalog.v3",
    core
  ) });
  assertLaunchProfileCatalogV3(result);
  return result;
}
function assertLaunchProfileCatalogV3(raw) {
  const value = plainRecord3(raw, "V3 launch profile catalog");
  exactKeys4(
    value,
    ["schemaVersion", "catalogVersion", "descriptors", "catalogHash"],
    "V3 launch profile catalog"
  );
  if (value.schemaVersion !== "programmable.router-v2-launch-profile-catalog.v3" || value.catalogVersion !== ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3 || !Array.isArray(value.descriptors) || value.descriptors.length !== 6) {
    throw new TypeError("V3 launch profile catalog version or cardinality drifted");
  }
  for (const descriptor of value.descriptors) assertLaunchProfileDescriptorV3(descriptor);
  const slots = value.descriptors.map(({ slotId }) => slotId);
  if (new Set(slots).size !== 6 || slots.some((slotId) => !ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V2.descriptors.some((legacy) => legacy.slotId === slotId))) {
    throw new TypeError("V3 launch profile catalog slot identity drifted");
  }
  const ordered = [...value.descriptors].sort((left, right) => compare2(left.slotId, right.slotId));
  if (value.descriptors.some((entry, index) => entry.descriptorHash !== ordered[index]?.descriptorHash)) {
    throw new TypeError("V3 launch profile catalog is not canonically ordered");
  }
  sha2563(value.catalogHash, "V3 catalog hash");
  const { catalogHash: _catalogHash, ...core } = value;
  if (value.catalogHash !== canonicalSha256(
    "programmable.router-v2-launch-profile-catalog.v3",
    core
  )) throw new TypeError("V3 launch profile catalog hash drifted");
}
var ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V3 = createLaunchProfileCatalogV3(
  ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V2.descriptors.map((legacyDescriptor) => {
    const completed = legacyDescriptor.architecture === "COMPLETED_GRAPH_ADOPTION";
    return createLaunchProfileDescriptorV3({
      legacyDescriptor,
      contractArtifactBinding: completed ? PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1 : null,
      contractDeploymentBinding: null,
      profileCapabilityBinding: null,
      blockers: completed ? [
        "Exact Contract deployment, source verification and finality receipts are absent.",
        "Validator, Preflight and Registry live codehashes require constructor-immutable specialization receipts.",
        "Profile capability registration and Authority runtime binding are absent.",
        "Production activation remains DENY."
      ] : ["No independently-passed immutable Contract artifact is bound for this profile slot."]
    });
  })
);
var ROUTER_V2_SHARED_LIFECYCLE_ADMITTED_EXACT_SCHEMA_PATHS_V3 = Object.freeze([
  "schemas/completed-graph-adoption-contract-artifact-binding.v1.schema.json",
  "schemas/router-v2-launch-profile-descriptor.v3.schema.json",
  "schemas/router-v2-launch-profile-catalog.v3.schema.json",
  "schemas/router-v2-shared-lifecycle-abi.v3.schema.json",
  "schemas/router-v2-shared-lifecycle-migration-rules.v3.schema.json",
  "schemas/router-v2-shared-lifecycle-two-plan-golden.v3.schema.json"
]);
var ROUTER_V2_SHARED_LIFECYCLE_HARD_DENY_SCHEMA_PATHS_V3 = Object.freeze([
  "schemas/completed-graph-adoption-contract-deployment-binding.v1.schema.json",
  "schemas/completed-graph-adoption-profile-capability-binding.v1.schema.json",
  "schemas/router-v2-applicant-launch-plan.v3.schema.json",
  "schemas/router-v2-builder-evidence-commitment.v3.schema.json",
  "schemas/router-v2-reviewer-authority-attestation.v3.schema.json",
  "schemas/router-v2-launch-grant.v3.schema.json",
  "schemas/router-v2-completed-graph-plan-contract.v1.schema.json",
  "schemas/router-v2-source-identity-referents.v3.schema.json",
  "schemas/router-v2-completed-graph-launch-grant-contract.v1.schema.json",
  "schemas/router-v2-completed-graph-launch-grant-digest-binding.v1.schema.json",
  "schemas/router-v2-completed-graph-execution-currentness-contract.v1.schema.json",
  "schemas/router-v2-completed-graph-preflight-query-contract.v1.schema.json",
  "schemas/router-v2-completed-graph-preflight-readback-contract.v1.schema.json",
  "schemas/router-v2-completed-graph-provider-preflight-observation.v3.schema.json",
  "schemas/router-v2-completed-graph-preflight-aggregate.v3.schema.json",
  "schemas/router-v2-canonical-launch-receipt.v3.schema.json",
  "schemas/router-v2-finality-indexing-receipt.v3.schema.json"
]);
var ROUTER_V2_SHARED_LIFECYCLE_SCHEMA_PATHS_V3 = Object.freeze([
  ...ROUTER_V2_SHARED_LIFECYCLE_ADMITTED_EXACT_SCHEMA_PATHS_V3,
  ...ROUTER_V2_SHARED_LIFECYCLE_HARD_DENY_SCHEMA_PATHS_V3
].sort());
var ROUTER_V2_SHARED_LIFECYCLE_ABI_CORE_V3 = Object.freeze({
  schemaVersion: "programmable.router-v2-shared-lifecycle-abi.v3",
  lifecycleVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3,
  versioning: "ADDITIVE_NEW_BYTE_DOMAIN_NEVER_REINTERPRET_V1_V2",
  packageName: "@programmable/autonomous-approval-v1",
  packageExport: "@programmable/autonomous-approval-v1/router-v2-shared-lifecycle-v3",
  publicSourcePath: "src/public-api/router-v2-shared-lifecycle-v3.ts",
  unversionedPackageExportRemains: "router-v2-shared-lifecycle-v2",
  contractArtifactBindingHash: PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.artifactBindingHash,
  contractDeploymentBinding: null,
  profileCapabilityBinding: null,
  activationAllowed: false,
  deploymentState: "UNDEPLOYED",
  activationState: "DENY",
  authorityIoState: "HARD_DENY_REQUIRES_VERSIONED_DEPLOYMENT_BOUND_SUCCESSOR",
  standaloneDeploymentProfileSchemaState: "HARD_DENY_UNTIL_EXACT_DEPLOYMENT_BOUND_SUCCESSOR",
  standaloneSchemaAdmissionPolicy: "ONLY_CONST_CLOSED_RELEASE_METADATA_ADMITTED_ALL_SEMANTIC_ARTIFACTS_HARD_DENY",
  admittedExactSchemaPaths: ROUTER_V2_SHARED_LIFECYCLE_ADMITTED_EXACT_SCHEMA_PATHS_V3,
  hardDenyStandaloneSchemaPaths: ROUTER_V2_SHARED_LIFECYCLE_HARD_DENY_SCHEMA_PATHS_V3,
  contractNumericEnums: Object.freeze({
    grantStatus: Object.freeze({ Invalid: 0, Active: 1, Revoked: 2, Consumed: 3 }),
    profileStatus: Object.freeze({ Invalid: 0, Active: 1, Suspended: 2, Deprecated: 3 }),
    receiptStatus: Object.freeze({
      Invalid: 0,
      Prepared: 1,
      Adopted: 2,
      Finalized: 3,
      Indexed: 4,
      Published: 5
    }),
    executionTimeConstraint: Object.freeze({
      Invalid: 0,
      AdoptionOnlyNoExecution: 1,
      ExternalExecutionTimeBound: 2
    }),
    admissionStatus: Object.freeze({
      Invalid: 0,
      DenyPendingReviewAndDeploymentEvidence: 1,
      Admitted: 2
    })
  }),
  publicTypes: Object.freeze([
    "LaunchProfileDescriptorV3",
    "LaunchProfileCatalogV3",
    "SourceIdentityReferentsV3",
    "ApplicantLaunchPlanV3",
    "BuilderEvidenceCommitmentV3",
    "ReviewerAuthorityAttestationV3",
    "CompletedGraphPlanContractV1",
    "CompletedGraphLaunchGrantContractV1",
    "CompletedGraphLaunchGrantDigestBindingV1",
    "CompletedGraphExecutionCurrentnessContractV1",
    "CompletedGraphAdoptionPreflightQueryContractV1",
    "CompletedGraphAdoptionPreflightReadbackContractV1",
    "CompletedGraphProviderPreflightObservationV3",
    "CompletedGraphAdoptionPreflightAggregateV3",
    "LaunchGrantV3",
    "CanonicalLaunchReceiptV3",
    "FinalityIndexingReceiptV3"
  ]),
  internalAuthorityPortsNotExported: Object.freeze([
    "CompletedGraphWalletIntentVerifierPortV3",
    "CompletedGraphWinnerReservationStoreV3",
    "CompletedGraphCurrentnessSignerPortV3",
    "issueCompletedGraphCurrentnessAfterWinnerV3"
  ]),
  predecessorSchemaDependencies: Object.freeze([
    "schemas/router-v2-launch-profile-descriptor.v1.schema.json",
    "schemas/router-v2-applicant-launch-plan.v1.schema.json",
    "schemas/router-v2-builder-evidence-commitment.v1.schema.json",
    "schemas/router-v2-reviewer-authority-attestation.v1.schema.json",
    "schemas/router-v2-launch-profile-descriptor.v2.schema.json",
    "schemas/router-v2-applicant-launch-plan.v2.schema.json",
    "schemas/router-v2-builder-evidence-commitment.v2.schema.json",
    "schemas/router-v2-reviewer-authority-attestation.v2.schema.json"
  ]),
  schemaPaths: ROUTER_V2_SHARED_LIFECYCLE_SCHEMA_PATHS_V3,
  requiredServiceEnvironmentVariableNames: Object.freeze([])
});
var ROUTER_V2_SHARED_LIFECYCLE_ABI_V3 = deepFreeze4({
  ...ROUTER_V2_SHARED_LIFECYCLE_ABI_CORE_V3,
  abiHash: canonicalSha256(
    "programmable.router-v2-shared-lifecycle-abi.v3",
    ROUTER_V2_SHARED_LIFECYCLE_ABI_CORE_V3
  )
});
var ROUTER_V2_SHARED_LIFECYCLE_MIGRATION_RULES_CORE_V3 = Object.freeze({
  schemaVersion: "programmable.router-v2-shared-lifecycle-migration-rules.v3",
  lifecycleVersion: ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3,
  predecessorVersion: "2.0.0",
  unversionedPackageExportRemains: "router-v2-shared-lifecycle-v2",
  rules: Object.freeze([
    "V1_AND_V2_BYTES_REMAIN_IMMUTABLE_AND_ARE_NEVER_REINTERPRETED_AS_V3",
    "SOURCE_LAUNCH_ID_STAMP_LAUNCH_ID_AND_ANTI_REPLAY_NONCE_ARE_PAIRWISE_DISTINCT",
    "LEGACY_13_FIELD_PERMIT_AND_NONCE_EQUALS_LAUNCH_ID_ARE_REJECTED",
    "RAW_OR_PADDED_GIT_OBJECT_EQUALITY_IS_REJECTED_USE_CONTRACT_DOMAIN_COMMITMENTS",
    "A_APPLICANT_REQUEST_B_EXECUTABLE_SOURCE_C_CARRIER_ARE_NON_SUBSTITUTABLE",
    "AUTHORITY_SHA256_AND_EVM_KECCAK_IDENTITIES_ARE_EXPLICITLY_SEPARATE",
    "LAUNCH_GRANT_HAS_NO_APPLICANT_TIME_EXPIRY_CURRENTNESS_IS_INTERNAL_MAX_3600_SECONDS",
    "NO_SIGNER_PROVIDER_OR_RESERVATION_IO_WHILE_DEPLOYMENT_OR_PROFILE_BINDING_IS_NULL",
    "V3_0_AUTHORITY_IO_IS_HARD_DENY_AND_REQUIRES_AN_IMMUTABLE_DEPLOYMENT_BOUND_SUCCESSOR",
    "V3_0_STANDALONE_DEPLOYMENT_AND_PROFILE_SCHEMAS_ARE_HARD_DENY_UNTIL_EXACT_LIVE_BINDING",
    "V3_0_ONLY_CONST_CLOSED_RELEASE_METADATA_SCHEMAS_ADMIT_ALL_SEMANTIC_ARTIFACT_SCHEMAS_HARD_DENY",
    "COMPILER_RUNTIME_HASHES_ARE_TEMPLATES_LIVE_CODEHASH_REQUIRES_IMMUTABLE_SPECIALIZATION",
    "PROVIDER_OUTAGE_IS_PENDING_AND_DOES_NOT_REVOKE_DURABLE_APPROVAL",
    "CURRENTNESS_SUCCESSOR_REQUIRES_EXPIRED_PREDECESSOR_AND_AUTHENTICATED_DUAL_PROVIDER_NON_USE"
  ]),
  rejectedHookemonProvisionalTypehashes: Object.freeze([
    "0xb8e945789e6dfccb6be72408a59b9f355707ca97305762f749bad2621bfd2f4e",
    "0x042c0b7e147706935837305012baf028ee5eeedb8d3a573f86139a408e8a1b4b"
  ]),
  canonicalContractTypehash: PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.typehashes.launchGrant,
  deploymentState: "UNDEPLOYED",
  activationState: "DENY"
});
var ROUTER_V2_SHARED_LIFECYCLE_MIGRATION_RULES_V3 = deepFreeze4({
  ...ROUTER_V2_SHARED_LIFECYCLE_MIGRATION_RULES_CORE_V3,
  rulesHash: canonicalSha256(
    "programmable.router-v2-shared-lifecycle-migration-rules.v3",
    ROUTER_V2_SHARED_LIFECYCLE_MIGRATION_RULES_CORE_V3
  )
});
function computeGitObjectCommitmentV3(typehash2, gitObjectId2, label) {
  if (!/^0x[0-9a-f]{40}$/u.test(gitObjectId2) || gitObjectId2 === "0x0000000000000000000000000000000000000000") {
    throw new TypeError(`${label} Git object id must be nonzero exact raw lowercase bytes20`);
  }
  const encoded = concatBytes(
    hexBytes(typehash2, `${label} typehash`),
    rightPad32(hexBytes(gitObjectId2, `${label} Git object id`))
  );
  return keccak256V1(encoded);
}
function gitObjectId(raw, label) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{40}$/u.test(raw) || raw === "0x0000000000000000000000000000000000000000") {
    throw new TypeError(`${label} must be nonzero exact raw lowercase bytes20`);
  }
  return raw;
}
function gitObjectWordV3(raw, label) {
  return rightPad32(hexBytes(gitObjectId(raw, label), label));
}
function rightPad32(value) {
  if (value.byteLength > 32) throw new TypeError("ABI static bytes value exceeds one word");
  const output = new Uint8Array(32);
  output.set(value);
  return output;
}
function typehash(key) {
  const value = PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1.typehashes[key];
  if (value === void 0) throw new TypeError(`Unknown Contract typehash ${String(key)}`);
  return bytes32WordV3(value, `Contract typehash ${String(key)}`);
}
function keccakWordsV3(words) {
  if (words.some((word) => word.byteLength !== 32)) {
    throw new TypeError("ABI word preimage contains a non-word value");
  }
  return keccak256V1(concatBytes(...words));
}
function bytes32WordV3(raw, label) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{64}$/u.test(raw)) {
    throw new TypeError(`${label} must be lowercase bytes32`);
  }
  return hexBytes(raw, label);
}
function addressWordV3(raw, label) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{40}$/u.test(raw) || raw === `0x${"0".repeat(40)}`) {
    throw new TypeError(`${label} must be a nonzero lowercase EVM address`);
  }
  const output = new Uint8Array(32);
  output.set(hexBytes(raw, label), 12);
  return output;
}
function addressWordAllowZeroV3(raw, label) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{40}$/u.test(raw)) {
    throw new TypeError(`${label} must be a lowercase EVM address`);
  }
  const output = new Uint8Array(32);
  output.set(hexBytes(raw, label), 12);
  return output;
}
function boolWordV3(raw, label) {
  if (typeof raw !== "boolean") throw new TypeError(`${label} must be boolean`);
  return uintWordV3(raw ? "1" : "0", 8, label);
}
function uintWordV3(raw, bits, label) {
  const value = uintValueV3(raw, bits, label);
  const hex = value.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}
function uintValueV3(raw, bits, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) throw new TypeError(`${label} is not canonical uint`);
  const value = BigInt(raw);
  if (value >= 1n << BigInt(bits)) throw new TypeError(`${label} exceeds uint${bits}`);
  return value;
}
function hexBytes(raw, label) {
  if (!/^0x(?:[0-9a-f]{2})+$/u.test(raw)) throw new TypeError(`${label} must be lowercase hex`);
  return Uint8Array.from(Buffer.from(raw.slice(2), "hex"));
}
function concatBytes(...parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
function bytes322(raw, label) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{64}$/u.test(raw) || raw === `0x${"0".repeat(64)}`) throw new TypeError(`${label} must be nonzero bytes32`);
  return raw;
}
function sha2563(raw, label) {
  if (typeof raw !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(raw)) {
    throw new TypeError(`${label} must be a canonical lowercase SHA-256 digest`);
  }
  return raw;
}
function assertCompletedGraphGrantStateHeadContractV1(raw) {
  const value = plainRecord3(raw, "Contract LaunchGrant state head");
  exactKeys4(value, [
    "grantDigest",
    "grantHash",
    "stateHeadHash",
    "stampLaunchId",
    "status"
  ], "Contract LaunchGrant state head");
  for (const key of ["grantDigest", "grantHash", "stateHeadHash", "stampLaunchId"]) {
    bytes32WordV3(value[key], `Contract LaunchGrant state ${key}`);
  }
  if (typeof value.status !== "number" || !Number.isInteger(value.status) || value.status < 0 || value.status > 3) {
    throw new TypeError("Contract LaunchGrant state status is outside GrantStatusV1");
  }
  const expected = computeCompletedGraphGrantStateHeadHashV3({
    grantDigest: value.grantDigest,
    grantHash: value.grantHash,
    stampLaunchId: value.stampLaunchId,
    status: value.status
  });
  if (value.stateHeadHash !== expected) {
    throw new TypeError("Contract LaunchGrant state head hash drifted");
  }
}
function assertCompletedGraphAdoptionPreflightReadbackShapeV3(raw) {
  const value = plainRecord3(raw, "AdoptionPreflightReadbackV1");
  exactKeys4(value, [
    "queryHash",
    "chainId",
    "registry",
    "runtimeAuthorityBindingHash",
    "liveRuntimeMask",
    "dependencyBehaviorEvidenceHash",
    "securityControlHeadHash",
    "securityEpoch",
    "securityEpochHash",
    "policyEpoch",
    "policyEpochHash",
    "reviewControl",
    "globalAdoptionKilled",
    "profileStatus",
    "profileCapabilityHash",
    "grantStateHead",
    "winnerNonceOccupantGrantDigest",
    "winnerKeyOccupantGrantDigest",
    "currentnessRevoked",
    "currentnessUsed",
    "currentnessNonceUsed",
    "receiptStatus",
    "receiptCoreHash",
    "finalityIndexingReceiptHash",
    "graphOccupantStampLaunchId",
    "exclusiveComponentOccupantStampLaunchId",
    "sharedComponentIdentityHash",
    "exclusiveTokenOccupantStampLaunchId",
    "poolOccupantStampLaunchId",
    "actualComponentRuntimeCodeHash",
    "componentLeafHash",
    "globalReadbackHeadHash"
  ], "AdoptionPreflightReadbackV1");
  uintWordV3(String(value.chainId), 256, "preflight readback chainId");
  addressWordV3(value.registry, "preflight readback registry");
  uintWordV3(String(value.liveRuntimeMask), 16, "preflight live runtime mask");
  uintWordV3(String(value.securityEpoch), 64, "preflight security epoch");
  uintWordV3(String(value.policyEpoch), 64, "preflight policy epoch");
  for (const key of [
    "queryHash",
    "runtimeAuthorityBindingHash",
    "dependencyBehaviorEvidenceHash",
    "securityControlHeadHash",
    "securityEpochHash",
    "policyEpochHash",
    "profileCapabilityHash",
    "winnerNonceOccupantGrantDigest",
    "winnerKeyOccupantGrantDigest",
    "receiptCoreHash",
    "finalityIndexingReceiptHash",
    "graphOccupantStampLaunchId",
    "exclusiveComponentOccupantStampLaunchId",
    "sharedComponentIdentityHash",
    "exclusiveTokenOccupantStampLaunchId",
    "poolOccupantStampLaunchId",
    "actualComponentRuntimeCodeHash",
    "componentLeafHash",
    "globalReadbackHeadHash"
  ]) bytes32WordV3(value[key], `preflight readback ${key}`);
  const review = plainRecord3(value.reviewControl, "preflight review control");
  exactKeys4(
    review,
    ["reviewGenerationHash", "reviewGeneration"],
    "preflight review control"
  );
  bytes32WordV3(review.reviewGenerationHash, "preflight review generation hash");
  uintWordV3(String(review.reviewGeneration), 64, "preflight review generation");
  for (const key of [
    "globalAdoptionKilled",
    "currentnessRevoked",
    "currentnessUsed",
    "currentnessNonceUsed"
  ]) {
    if (typeof value[key] !== "boolean") {
      throw new TypeError(`preflight readback ${key} must be boolean`);
    }
  }
  if (typeof value.profileStatus !== "number" || ![0, 1, 2, 3].includes(value.profileStatus)) {
    throw new TypeError("preflight profile status is outside ProfileStatusV1");
  }
  if (typeof value.receiptStatus !== "number" || !Number.isInteger(value.receiptStatus) || value.receiptStatus < 0 || value.receiptStatus > 5) {
    throw new TypeError("preflight receipt status is outside ReceiptStatusV1");
  }
}
function plainRecord3(raw, label) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return raw;
}
function exactKeys4(raw, expected, label) {
  const observed = Object.keys(raw).sort();
  const required = [...expected].sort();
  if (observed.length !== required.length || observed.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}
function compare2(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function isExactExecutionTimeBindingV3(constraint, evidenceHash) {
  return constraint === 1 && evidenceHash === ZERO_BYTES322 || constraint === 2 && typeof evidenceHash === "string" && /^0x[0-9a-f]{64}$/u.test(evidenceHash) && evidenceHash !== ZERO_BYTES322;
}
function deepFreeze4(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze4(child);
    Object.freeze(value);
  }
  return value;
}
export {
  COMPLETED_GRAPH_LAUNCH_GRANT_CONTRACT_ABI_SHA256_V1,
  COMPLETED_GRAPH_LAUNCH_GRANT_CONTRACT_ABI_V1,
  PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1,
  PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_ENUMS_V1,
  ROUTER_V2_INTERNAL_CURRENTNESS_MAXIMUM_SECONDS_V3,
  ROUTER_V2_LAUNCH_GRANT_NO_DEFAULT_EXPIRY_V3,
  ROUTER_V2_SHARED_LIFECYCLE_ABI_V3,
  ROUTER_V2_SHARED_LIFECYCLE_MIGRATION_RULES_V3,
  ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3,
  ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V3,
  assertApplicantLaunchPlanV3,
  assertBuilderEvidenceCommitmentV3,
  assertCanonicalLaunchReceiptV3,
  assertCompletedGraphAdoptionArtifactDeploymentCompatibilityV1,
  assertCompletedGraphAdoptionArtifactDeploymentProfileCompatibilityV1,
  assertCompletedGraphAdoptionContractArtifactBindingV1,
  assertCompletedGraphAdoptionContractDeploymentBindingV1,
  assertCompletedGraphAdoptionPreflightReadbackContractV1,
  assertCompletedGraphAdoptionProfileCapabilityBindingV1,
  assertCompletedGraphExecutionCurrentnessContractV1,
  assertCompletedGraphLaunchGrantContractV1,
  assertCompletedGraphLaunchGrantDigestBindingV1,
  assertCompletedGraphPlanContractV1,
  assertCompletedGraphProviderPreflightObservationV3,
  assertFinalityIndexingReceiptV3,
  assertLaunchGrantV3,
  assertLaunchIdentitySetV3,
  assertLaunchProfileCatalogV3,
  assertLaunchProfileDescriptorV3,
  assertReviewerAuthorityAttestationV3,
  assertSha256ToEvmBytes32BindingV1,
  assertSourceIdentityReferentsV3,
  computeCompletedGraphAdoptionPreflightComponentLeafHashV3,
  computeCompletedGraphAdoptionPreflightGlobalHeadHashV3,
  computeCompletedGraphAdoptionPreflightQueryHashV3,
  computeCompletedGraphBaseRuntimeAuthorityBindingHashV1,
  computeCompletedGraphCanonicalReceiptCoreHashV3,
  computeCompletedGraphEip712DomainSeparatorV3,
  computeCompletedGraphExecutionCurrentnessDigestV3,
  computeCompletedGraphExecutionCurrentnessStructHashV3,
  computeCompletedGraphFinalityIndexingReceiptHashV3,
  computeCompletedGraphGrantStateHeadHashV3,
  computeCompletedGraphLaunchGrantDigestV3,
  computeCompletedGraphLaunchGrantHashPartsV3,
  computeCompletedGraphPlanHashV3,
  computeCompletedGraphProfileRuntimeAuthorityBindingHashV1,
  computeCompletedGraphSourceCommitHashV3,
  computeCompletedGraphSourceTreeHashV3,
  computeCompletedGraphStampLaunchIdV3,
  computeCompletedGraphWinnerKeyHashV3,
  computeExecutableSourceRepositoryHashV3,
  createCompletedGraphAdoptionPreflightAggregateV3,
  createCompletedGraphLaunchGrantDigestBindingV1,
  createCompletedGraphProviderPreflightObservationV3,
  createSha256ToEvmBytes32BindingV1,
  createSourceIdentityReferentsV3,
  evaluateCompletedGraphGrantCurrentnessV3,
  evaluateCompletedGraphPreflightAvailabilityV3
};
