// src/internal/router-self-service-v1/nested-factory-v2.ts
import { createHash as createHash2, createPublicKey, verify as verifySignature } from "node:crypto";

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
import { createHash } from "node:crypto";
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

// src/internal/router-self-service-v1/nested-factory-v2.ts
var NESTED_FACTORY_ROUTE_ID_V1 = "nested-factory";
var NESTED_FACTORY_ROUTE_VERSION_V1 = "1.0.0";
var EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_V1 = "exact-shards-nested-factory";
var EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_V1 = "1.0.0";
var NESTED_FACTORY_CAPABILITY_CATALOG_VERSION_V1 = "1.0.0";
var NESTED_FACTORY_REVIEWED_PLAN_SCHEMA_ID_V1 = "urn:programmable:reviewed-route-plan:1.0.0";
var APPLICANT_ROUTE_ACCEPTANCE_SCHEMA_ID_V1 = "urn:programmable:applicant-route-acceptance:1.0.0";
var NESTED_FACTORY_MAXIMUM_PERMIT_LIFETIME_SECONDS_V1 = 3600n;
var NESTED_FACTORY_MINIMUM_REMAINING_PERMIT_SECONDS_V1 = 120n;
var NESTED_FACTORY_MAINNET_TRANSACTION_GAS_LIMIT_V1 = 16777216n;
var NESTED_FACTORY_GAS_BUFFER_NUMERATOR_V1 = 120n;
var NESTED_FACTORY_GAS_BUFFER_DENOMINATOR_V1 = 100n;
var NESTED_FACTORY_MAXIMUM_PLATFORM_RELEASE_LIFETIME_SECONDS_V1 = 2592000n;
var NESTED_FACTORY_MAXIMUM_LAUNCH_PREFLIGHT_LIFETIME_SECONDS_V1 = 120n;
var NESTED_FACTORY_EXECUTION_MODE_POLICY_V1 = Object.freeze([
  "EXACT_EXISTING_LAUNCH_ADOPTED",
  "EXACT_FACTORY_LAUNCH_EXECUTED"
]);
var HOOKBUILDER_ACCEPTANCE_PROTOCOL_V1 = deepFreeze({
  schemaVersion: "programmable.hookbuilder-applicant-acceptance-protocol.v1",
  repository: "https://github.com/0xprogrammable/hookbuilder",
  commit: "bfdd4eff15da6c23e56c8b1f9f260d70f6c45bbe",
  tree: "e8fafb861cfd073101091af06d861ce54e7a9d9b",
  sourcePath: "scripts/applicant-route-acceptance-core.mjs",
  sourceSha256: "sha256:0a9cadb93a900a2c0cceccdebd85a61811a01d6c0521ea30327746f031b5264f",
  goldenPath: "submissions/examples/applicant-route-acceptance-v1.golden.json",
  goldenSha256: "sha256:ed316c930ead7d438f82b77758f8ed3ed1e92cd5cc83b01ae5fa7aef9ef0e383",
  subjectSchemaVersion: "programmable.application-acceptance-subject.v1",
  canonicalization: "urn:programmable:canonical-json:2.0.0",
  canonicalSubjectByteLength: 278,
  acceptanceSubjectHash: "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8"
});
var HOOKBUILDER_ACCEPTANCE_PROTOCOL_BINDING_SHA256_V1 = canonicalSha256(
  HOOKBUILDER_ACCEPTANCE_PROTOCOL_V1.schemaVersion,
  HOOKBUILDER_ACCEPTANCE_PROTOCOL_V1
);
var PROFILE_KEY_TYPE = "ProgrammableNestedFactoryProfileV1(bytes32 profileIdHash,bytes32 profileVersionHash)";
var LAUNCH_ID_TYPE = "ProgrammableNestedFactoryLaunchIdV1(uint256 chainId,address launchWallet,bytes32 routeIdHash,bytes32 routeVersionHash,bytes32 profileKey,bytes32 routePayloadHash)";
var POOL_KEY_TYPE = "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
var LAUNCH_STAMP_TYPE = "ProgrammableLaunchStampV2(bytes32 permitDigest,bytes32 launchId,uint8 executionMode,address factory,address poolManager,bytes32 poolId)";
var PROGRAMMABLE_LAUNCH_STAMPED_EVENT_V2 = "ProgrammableLaunchStampedV2(bytes32,address,address,address,address,address,address,bytes32,bytes32,uint8)";
var PROGRAMMABLE_NESTED_FACTORY_ROUTE_STAMPED_EVENT_V2 = "ProgrammableNestedFactoryRouteStampedV2(bytes32,bytes32,address,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint8)";
var NESTED_FACTORY_PROFILE_KEY_TYPEHASH_V1 = hashText(PROFILE_KEY_TYPE);
var NESTED_FACTORY_LAUNCH_ID_TYPEHASH_V1 = hashText(LAUNCH_ID_TYPE);
var NESTED_FACTORY_POOL_KEY_TYPEHASH_V1 = hashText(POOL_KEY_TYPE);
var NESTED_FACTORY_LAUNCH_STAMP_TYPEHASH_V1 = hashText(LAUNCH_STAMP_TYPE);
var PROGRAMMABLE_LAUNCH_STAMPED_EVENT_TOPIC_V2 = hashText(
  PROGRAMMABLE_LAUNCH_STAMPED_EVENT_V2
);
var PROGRAMMABLE_NESTED_FACTORY_ROUTE_STAMPED_EVENT_TOPIC_V2 = hashText(
  PROGRAMMABLE_NESTED_FACTORY_ROUTE_STAMPED_EVENT_V2
);
var NESTED_FACTORY_ROUTE_ID_HASH_V1 = hashText(NESTED_FACTORY_ROUTE_ID_V1);
var NESTED_FACTORY_ROUTE_VERSION_HASH_V1 = hashText(
  NESTED_FACTORY_ROUTE_VERSION_V1
);
var EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_HASH_V1 = hashText(
  EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_V1
);
var EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_HASH_V1 = hashText(
  EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_V1
);
var EXACT_SHARDS_NESTED_FACTORY_PROFILE_KEY_V1 = computeNestedFactoryProfileKeyV1({
  profileId: EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_V1,
  profileVersion: EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_V1
});
var EXACT_SHARDS_FINAL_ROUTE_LEDGER_BINDING_V1 = deepFreeze({
  schemaVersion: "programmable.nested-factory-final-route-ledger-binding.v1",
  artifact: {
    path: "outputs/shards-nested-factory-route-v1.canonical.json",
    byteLength: 1287041,
    sha256: "0x066475058bfd47b85b4216f95b434756d67d7e289ffb36535c121ef5d7c11bab",
    keccak256: "0x8c5521d6796e3e63c3e2cf82e1122c952e6465c345d8a10b3773a70aa2419fb3"
  },
  integrity: {
    path: "outputs/shards-nested-factory-route-v1.canonical.integrity.json",
    byteLength: 3739,
    sha256: "0x74028d65363189804912f2907400da11098d90579c9261e1d087b2d5a709ae6f",
    keccak256: "0x44a685e0a909a78c9da6f1fd0cd79fd62e25590e13270cf95fbb7e66601e308b"
  },
  generator: {
    path: "work/generate-shards-route-artifact.mjs",
    byteLength: 76813,
    sha256: "0x3876075dfdb50f82bf5168bd12d42ae11594dbb8ffd68c9cbadcd7111ca0650a",
    keccak256: "0xb7effad54085a5033635b59623febcf15844e373f5048c872508c106467cc93f"
  },
  router: {
    repository: "https://github.com/0xprogrammable/programmable",
    commit: "1ac92f9694fb5c3ae534c65669775e634e3214f7",
    tree: "8e6920b46aa30e5a8afbebc3a86adfba22cc7628",
    directLaunchSelector: "0xc90ca102"
  },
  exactRebuildModes: ["A-primary/B-verifier", "B-primary/A-verifier"],
  routePayloadHash: "0x75403c2f52dbdf623cfcd077fab52308b3e1e0623016ec73539fac5234f21356",
  expectedResultHash: "0x29de1a5462fe7b07a0d58894f7ec5e2eb4e870c83153e2109647c7f4094c828b",
  launchId: "0xd225b22ea82ef2425660da409849a55c1c44751eedd9cd1b581a48358a0905eb",
  stampRequestHash: "0x276a295580bcb65ed286a2a02efba575eaee87c090f54c94e5ad8a2b78552bce",
  activationAllowed: false,
  activationState: "disabled-pending-production-bindings",
  revenueAttestationSha256: null,
  revenueVerifierArtifactSha256: null
});
var EXACT_SHARDS_NESTED_FACTORY_PROFILE_SHA256_V1 = `sha256:${EXACT_SHARDS_FINAL_ROUTE_LEDGER_BINDING_V1.artifact.sha256.slice(2)}`;
var EXACT_SHARDS_REVENUE_POLICY_HASH_V1 = "0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2";
var EXACT_SHARDS_SOURCE_REVISION_HASH_V1 = "0x3352fe14662ce467e98f475cf91f10304ce4d69b6342fae4bf3dc968c494d6dc";
var EXACT_SHARDS_MANIFEST_HASH_V1 = "0x4672dfda95c9765916397701479483b8e1db852165949518cdc9932fd8e1b359";
var EXACT_SHARDS_POOL_MANAGER_V1 = "0x000000000004444c5dc75cb358380d2e3de08a90";
var EXACT_SHARDS_POOL_MANAGER_RUNTIME_HASH_V1 = "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293";
var EXACT_SHARDS_LAUNCH_WALLET_V1 = "0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC";
var EXACT_SHARDS_LAUNCHER_FEE_RECIPIENT_V1 = "0x4957f49620aff3adbbe8195a4f633e49cc93376c";
var EXACT_SHARDS_FACTORY_DEPLOYMENT_PROXY_V1 = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
var EXACT_SHARDS_PLANNED_FACTORY_DEPLOYER_V1 = "0x2bb333d48dfaf1596d9036671d2e43168994249e";
var EXACT_SHARDS_FACTORY_DEPLOYMENT_PROXY_RUNTIME_HASH_V1 = "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989";
var EXACT_SHARDS_FACTORY_SALT_V1 = "0x655a4b5a2b704bef84b4ff94adde0a7ac40ad0366c82ddca5290180fe4c3986d";
var EXACT_SHARDS_FACTORY_INIT_CODE_HASH_V1 = "0x7d05592489495559b1288f8ad342239b3fb95a6aa005b5b0b1551c9523401585";
var EXACT_SHARDS_FACTORY_DEPLOYMENT_CALLDATA_HASH_V1 = "0xf37ce9748abe4d5243cbd26f48c6ea5789ab1ebe8e19ea96d2198693e957c4ec";
var EXACT_SHARDS_FACTORY_V1 = "0x9442a520e7b31d10177c75a363355c2c29141ac5";
var EXACT_SHARDS_FACTORY_RUNTIME_HASH_V1 = "0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5";
var EXACT_SHARDS_RENDERER_V1 = "0x090dbd2fab1a467f90ed82a443efa9aab658de14";
var EXACT_SHARDS_RENDERER_RUNTIME_HASH_V1 = "0x9b54a61918b2ddf9b7daf41d9bf2d705cbef3a0fd618275762b99e19c53459bf";
var EXACT_SHARDS_HOOK_CREATION_CODE_HASH_V1 = "0x3fbdbc069ee5bfcb1ded77a8d4e550f1bb0692a488b6eb5d23dac090fbca0716";
var EXACT_SHARDS_FACTORY_LAUNCH_SELECTOR_V1 = "0x0c4ad85f";
var EXACT_SHARDS_FACTORY_LAUNCH_CALLDATA_BYTES_V1 = 27140;
var EXACT_SHARDS_FACTORY_LAUNCH_CALLDATA_HASH_V1 = "0x39d08baf1cdececc5829853fd1274547c2e8260779d0c227ec30dc44daf1ae89";
var EXACT_SHARDS_TOKEN_SALT_V1 = "0xca9944c923e24ba5cb3188a29b18c3305158e686e39473e91bbe31fc019816ab";
var EXACT_SHARDS_HOOK_SALT_V1 = "0x00000000000000000000000000000000000000000000000000000000000052e1";
var EXACT_SHARDS_TOKEN_V1 = "0x50d17eaaeb52c66e64b918385abf6523fdae57cf";
var EXACT_SHARDS_TOKEN_RUNTIME_HASH_V1 = "0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8";
var EXACT_SHARDS_HOOK_V1 = "0xba318baa8649962fd77cc7082d098f2c09fd60cc";
var EXACT_SHARDS_HOOK_RUNTIME_HASH_V1 = "0x2a2174aff52c3ea9ddf0a6081464c9c6dbc43ddc93609c74d9610f50f486c1e1";
var EXACT_SHARDS_NFT_V1 = "0x9fda98de1b7061ae02a9aec7a6f8ed75a8feb8f3";
var EXACT_SHARDS_NFT_RUNTIME_HASH_V1 = "0xc3e3ea6cf4d2e13fa07a3b053d57cd7d6a6ecac7633aed86ab971d5e53959bb3";
var EXACT_SHARDS_POOL_ID_V1 = "0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d";
var EXACT_SHARDS_CONFIGURATION_HASH_V1 = "0xa98b7b95777267181a2b93a33632991e80a49f4a57d94150f8dfbd90421f34c1";
var EXACT_SHARDS_POOL_STATE_SLOT_V1 = "0x4fa7338abd4f323246331900c67c5a692d6c7b5d46266a813838cbd134dc3b45";
var EXACT_SHARDS_START_SQRT_PRICE_X96_V1 = "2502784483440051878955016419363";
var EXACT_SHARDS_INITIAL_TICK_V1 = "69060";
var EXACT_SHARDS_POOL_KEY_HASH_V1 = keccakBytes(concat(
  bytes32Bytes(NESTED_FACTORY_POOL_KEY_TYPEHASH_V1, "pool-key type hash"),
  word(0n),
  addressWord(EXACT_SHARDS_TOKEN_V1),
  word(0n),
  word(60n),
  addressWord(EXACT_SHARDS_HOOK_V1)
));
var EXACT_SHARDS_SHARD_LAUNCHED_EVENT_TOPIC_V1 = hashText(
  "ShardLaunched(address,address,address,bytes32,bytes32,address,address,bytes32)"
);
var UNISWAP_V4_INITIALIZE_EVENT_TOPIC_V1 = hashText(
  "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"
);
var EXACT_SHARDS_APPLICANT_GITHUB_USER_ID_V1 = "155705664";
var EXACT_SHARDS_APPLICANT_GITHUB_NUMERIC_USER_ID_V1 = 155705664;
var EXACT_SHARDS_REVIEWED_REQUEST_PATH_V1 = "submissions/requests/1329073878-shards-v1.json";
var EXACT_SHARDS_APPLICATION_MANIFEST_SHA256_V1 = "sha256:e069926d380e56bee001dd7cfeda591db56164b1acf7478b478dd62a6e119ec2";
function computeNestedFactoryProfileKeyV1(input) {
  const profileId = identifier(input.profileId, "nested-factory profile id");
  const profileVersion = identifier(input.profileVersion, "nested-factory profile version");
  return keccakWords([
    NESTED_FACTORY_PROFILE_KEY_TYPEHASH_V1,
    hashText(profileId),
    hashText(profileVersion)
  ]);
}
function createDisabledNestedFactoryAuthorityReleaseV1(input) {
  const capabilityCatalog = assertNestedFactoryCapabilityCatalogV1(input.capabilityCatalog);
  if (capabilityCatalog.catalogHash !== NESTED_FACTORY_DISABLED_CAPABILITY_CATALOG_V1.catalogHash || capabilityCatalog.entries.length !== 1 || capabilityCatalog.entries[0]?.capabilityHash !== EXACT_SHARDS_NESTED_FACTORY_DISABLED_CAPABILITY_V1.capabilityHash) throw new TypeError("disabled release does not use the exact unavailable Shards capability");
  const atomicDeploymentPlan = assertNestedFactoryAtomicDeploymentPlanV1(
    input.atomicDeploymentPlan
  );
  const core = {
    schemaVersion: "programmable.nested-factory-authority-release.v1",
    status: "disabled-awaiting-frozen-router-security-and-production-bindings",
    chainId: "1",
    routeId: NESTED_FACTORY_ROUTE_ID_V1,
    routeVersion: NESTED_FACTORY_ROUTE_VERSION_V1,
    profileId: EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_V1,
    profileVersion: EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_V1,
    profileKey: EXACT_SHARDS_NESTED_FACTORY_PROFILE_KEY_V1,
    revenuePolicyHash: EXACT_SHARDS_REVENUE_POLICY_HASH_V1,
    executionModePolicy: NESTED_FACTORY_EXECUTION_MODE_POLICY_V1,
    applicantAcceptanceProtocol: HOOKBUILDER_ACCEPTANCE_PROTOCOL_V1,
    applicantAcceptanceProtocolBindingSha256: HOOKBUILDER_ACCEPTANCE_PROTOCOL_BINDING_SHA256_V1,
    plannedFactoryDeployer: EXACT_SHARDS_PLANNED_FACTORY_DEPLOYER_V1,
    predeploymentSenderPolicy: "planned-platform-eoa-or-any-eoa-with-exact-canonical-proxy-transaction-proof",
    capabilityCatalog,
    atomicDeploymentPlan,
    finalRouteLedgerBinding: EXACT_SHARDS_FINAL_ROUTE_LEDGER_BINDING_V1,
    routeArtifactStatus: "frozen-ledger-bound-disabled-pending-production-bindings",
    routePayloadHash: EXACT_SHARDS_FINAL_ROUTE_LEDGER_BINDING_V1.routePayloadHash,
    expectedResultHash: EXACT_SHARDS_FINAL_ROUTE_LEDGER_BINDING_V1.expectedResultHash,
    launchId: EXACT_SHARDS_FINAL_ROUTE_LEDGER_BINDING_V1.launchId,
    stampRequestHash: EXACT_SHARDS_FINAL_ROUTE_LEDGER_BINDING_V1.stampRequestHash,
    permitNonce: EXACT_SHARDS_FINAL_ROUTE_LEDGER_BINDING_V1.launchId,
    signedPlatformReleaseHash: null,
    currentnessEvidenceHash: null,
    currentAcceptanceHash: null,
    applicantGrantHash: null,
    launchPreflightHash: null,
    ownerSignatureRequest: null,
    missingProductionBindings: [
      "deployed-router-and-module-runtime",
      "exact-factory-and-renderer-predeployment",
      "permit-authority-and-capability-admin",
      "release-attestation-authority",
      "revenue-attestation-and-verifier",
      "profile-gas-audit",
      "applicant-acceptance-current-head",
      "dual-rpc-currentness-and-gas-cap"
    ]
  };
  return deepFreeze({
    ...core,
    releaseHash: canonicalSha256(core.schemaVersion, core)
  });
}
function deriveNestedFactoryLaunchIdentityV1(input) {
  if (input.chainId !== "1") throw new TypeError("nested-factory launch chain is unsupported");
  const launchWallet = address(input.launchWallet, "nested-factory launch wallet");
  const routePayloadHash = nonzeroBytes32(input.routePayloadHash, "nested-factory route payload");
  const profileKey = computeNestedFactoryProfileKeyV1({
    profileId: input.profileId ?? EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_V1,
    profileVersion: input.profileVersion ?? EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_V1
  });
  const launchId = keccakBytes(concat(
    bytes32Bytes(NESTED_FACTORY_LAUNCH_ID_TYPEHASH_V1, "launch-id typehash"),
    word(1n),
    addressWord(launchWallet),
    bytes32Bytes(NESTED_FACTORY_ROUTE_ID_HASH_V1, "route id hash"),
    bytes32Bytes(NESTED_FACTORY_ROUTE_VERSION_HASH_V1, "route version hash"),
    bytes32Bytes(profileKey, "profile key"),
    bytes32Bytes(routePayloadHash, "route payload hash")
  ));
  const core = {
    schemaVersion: "programmable.nested-factory-launch-identity.v1",
    chainId: "1",
    launchWallet,
    routeIdHash: NESTED_FACTORY_ROUTE_ID_HASH_V1,
    routeVersionHash: NESTED_FACTORY_ROUTE_VERSION_HASH_V1,
    profileKey,
    routePayloadHash,
    launchId,
    permitNonce: launchId
  };
  return deepFreeze({
    ...core,
    identityHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryLaunchIdentityV1(raw) {
  exactKeys(raw, [
    "chainId",
    "identityHash",
    "launchId",
    "launchWallet",
    "permitNonce",
    "profileKey",
    "routeIdHash",
    "routePayloadHash",
    "routeVersionHash",
    "schemaVersion"
  ], "nested-factory launch identity");
  if (raw.schemaVersion !== "programmable.nested-factory-launch-identity.v1") {
    throw new TypeError("nested-factory launch identity schema is invalid");
  }
  const rebuilt = deriveNestedFactoryLaunchIdentityV1({
    chainId: raw.chainId,
    launchWallet: raw.launchWallet,
    routePayloadHash: raw.routePayloadHash
  });
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt)) {
    throw new TypeError("nested-factory launch identity or nonce binding is invalid");
  }
  return rebuilt;
}
function createNestedFactoryAtomicDeploymentPlanV1(input) {
  const core = {
    schemaVersion: "programmable.nested-factory-atomic-deployment-plan.v1",
    factoryDeploymentProxy: address(input.factoryDeploymentProxy, "factory deployment proxy"),
    factoryDeploymentProxyRuntimeCodeHash: nonzeroBytes32(
      input.factoryDeploymentProxyRuntimeCodeHash,
      "factory deployment proxy runtime hash"
    ),
    factorySalt: nonzeroBytes32(input.factorySalt, "factory salt"),
    factoryInitCodeBytes: positiveSafeInteger(input.factoryInitCodeBytes, "factory init-code bytes"),
    factoryInitCodeHash: nonzeroBytes32(input.factoryInitCodeHash, "factory init-code hash"),
    factoryDeploymentCalldataBytes: positiveSafeInteger(
      input.factoryDeploymentCalldataBytes,
      "factory deployment calldata bytes"
    ),
    factoryDeploymentCalldataHash: nonzeroBytes32(
      input.factoryDeploymentCalldataHash,
      "factory deployment calldata hash"
    ),
    factory: address(input.factory, "deployed factory"),
    factoryRuntimeCodeHash: nonzeroBytes32(
      input.factoryRuntimeCodeHash,
      "deployed factory runtime hash"
    ),
    renderer: address(input.renderer, "factory renderer"),
    rendererRuntimeCodeHash: nonzeroBytes32(
      input.rendererRuntimeCodeHash,
      "factory renderer runtime hash"
    ),
    hookCreationCodeHash: nonzeroBytes32(
      input.hookCreationCodeHash,
      "factory hook creation-code hash"
    )
  };
  if (core.factoryDeploymentProxy !== EXACT_SHARDS_FACTORY_DEPLOYMENT_PROXY_V1 || core.factoryDeploymentProxyRuntimeCodeHash !== EXACT_SHARDS_FACTORY_DEPLOYMENT_PROXY_RUNTIME_HASH_V1 || core.factorySalt !== EXACT_SHARDS_FACTORY_SALT_V1 || core.factoryInitCodeBytes !== 37942 || core.factoryInitCodeHash !== EXACT_SHARDS_FACTORY_INIT_CODE_HASH_V1 || core.factoryDeploymentCalldataBytes !== 37974 || core.factoryDeploymentCalldataHash !== EXACT_SHARDS_FACTORY_DEPLOYMENT_CALLDATA_HASH_V1 || core.factory !== EXACT_SHARDS_FACTORY_V1 || core.factoryRuntimeCodeHash !== EXACT_SHARDS_FACTORY_RUNTIME_HASH_V1 || core.renderer !== EXACT_SHARDS_RENDERER_V1 || core.rendererRuntimeCodeHash !== EXACT_SHARDS_RENDERER_RUNTIME_HASH_V1 || core.hookCreationCodeHash !== EXACT_SHARDS_HOOK_CREATION_CODE_HASH_V1 || create2Address(core.factoryDeploymentProxy, core.factorySalt, core.factoryInitCodeHash) !== core.factory) throw new TypeError("factory deployment binding left the exact reviewed CREATE2 plan");
  return deepFreeze({
    ...core,
    deploymentPlanHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryAtomicDeploymentPlanV1(raw) {
  exactKeys(raw, [
    "deploymentPlanHash",
    "factory",
    "factoryDeploymentCalldataBytes",
    "factoryDeploymentCalldataHash",
    "factoryDeploymentProxy",
    "factoryDeploymentProxyRuntimeCodeHash",
    "factoryInitCodeBytes",
    "factoryInitCodeHash",
    "factoryRuntimeCodeHash",
    "factorySalt",
    "hookCreationCodeHash",
    "renderer",
    "rendererRuntimeCodeHash",
    "schemaVersion"
  ], "factory atomic deployment plan");
  if (raw.schemaVersion !== "programmable.nested-factory-atomic-deployment-plan.v1") {
    throw new TypeError("factory atomic deployment plan schema is invalid");
  }
  const rebuilt = createNestedFactoryAtomicDeploymentPlanV1(raw);
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt)) {
    throw new TypeError("factory atomic deployment plan hash is invalid");
  }
  return rebuilt;
}
function verifyNestedFactoryDeploymentBytesV1(input) {
  const deploymentPlan = assertNestedFactoryAtomicDeploymentPlanV1(input.deploymentPlan);
  const factoryInitCode = hexBytes(input.factoryInitCode, "factory init code");
  const factoryDeploymentCalldata = hexBytes(
    input.factoryDeploymentCalldata,
    "factory deployment calldata"
  );
  if (factoryInitCode.byteLength !== deploymentPlan.factoryInitCodeBytes || keccakBytes(factoryInitCode) !== deploymentPlan.factoryInitCodeHash || factoryDeploymentCalldata.byteLength !== deploymentPlan.factoryDeploymentCalldataBytes || keccakBytes(factoryDeploymentCalldata) !== deploymentPlan.factoryDeploymentCalldataHash || factoryDeploymentCalldata.byteLength !== factoryInitCode.byteLength + 32 || `0x${Buffer.from(factoryDeploymentCalldata.slice(0, 32)).toString("hex")}` !== deploymentPlan.factorySalt || !Buffer.from(factoryDeploymentCalldata.slice(32)).equals(Buffer.from(factoryInitCode))) throw new TypeError("factory atomic deployment bytes left the frozen proxy plan");
  const core = {
    schemaVersion: "programmable.verified-nested-factory-deployment-bytes.v1",
    deploymentPlanHash: deploymentPlan.deploymentPlanHash,
    factoryInitCodeHash: deploymentPlan.factoryInitCodeHash,
    factoryDeploymentCalldataHash: deploymentPlan.factoryDeploymentCalldataHash
  };
  return deepFreeze({
    ...core,
    verificationHash: canonicalSha256(core.schemaVersion, core)
  });
}
async function verifyNestedFactoryPredeploymentReceiptV1(input) {
  const deploymentPlan = assertNestedFactoryAtomicDeploymentPlanV1(input.deploymentPlan);
  const deploymentBytes = verifyNestedFactoryDeploymentBytesV1({
    deploymentPlan,
    factoryInitCode: input.factoryInitCode,
    factoryDeploymentCalldata: input.factoryDeploymentCalldata
  });
  const transactionHash = nonzeroBytes32(
    input.transactionHash,
    "factory predeployment transaction hash"
  );
  const finalizedAnchor = await input.rpc.collectCommonFinalizedAnchor();
  const rpcBindingHash = input.rpc.binding().bindingHash;
  const [transactionValue, receiptValue] = await Promise.all([
    input.rpc.readConsensus("eth_getTransactionByHash", [transactionHash]),
    input.rpc.readConsensus("eth_getTransactionReceipt", [transactionHash])
  ]);
  const transaction = record(transactionValue, "factory predeployment transaction");
  const receipt = record(receiptValue, "factory predeployment receipt");
  const transactionFrom = address(
    transaction.from,
    "factory predeployment transaction sender"
  );
  const transactionTo = address(
    transaction.to,
    "factory predeployment transaction target"
  );
  const transactionInput = rpcHex(
    transaction.input,
    "factory predeployment transaction input"
  );
  const blockNumber = rpcQuantity(
    transaction.blockNumber,
    "factory predeployment block number"
  );
  const blockHash = nonzeroBytes32(
    transaction.blockHash,
    "factory predeployment block hash"
  );
  if (nonzeroBytes32(transaction.hash, "factory predeployment transaction hash") !== transactionHash || transactionTo !== deploymentPlan.factoryDeploymentProxy || transactionInput.length !== 2 + deploymentPlan.factoryDeploymentCalldataBytes * 2 || keccakBytes(hexBytes(transactionInput, "factory predeployment transaction input")) !== deploymentPlan.factoryDeploymentCalldataHash || rpcQuantity(transaction.value, "factory predeployment transaction value") !== "0x0" || BigInt(blockNumber) > BigInt(finalizedAnchor.blockNumber)) throw new TypeError("factory predeployment transaction left the exact finalized proxy plan");
  if (rpcHex(await input.rpc.readConsensus(
    "eth_getCode",
    [transactionFrom, blockNumber]
  ), "factory predeployment sender code") !== "0x") {
    throw new TypeError("factory predeployment sender is not an EOA");
  }
  if (nonzeroBytes32(receipt.transactionHash, "factory predeployment receipt transaction hash") !== transactionHash || address(receipt.from, "factory predeployment receipt sender") !== transactionFrom || address(receipt.to, "factory predeployment receipt target") !== transactionTo || receipt.contractAddress !== null || rpcQuantity(receipt.status, "factory predeployment receipt status") !== "0x1" || rpcQuantity(receipt.blockNumber, "factory predeployment receipt block number") !== blockNumber || nonzeroBytes32(receipt.blockHash, "factory predeployment receipt block hash") !== blockHash) throw new TypeError("factory predeployment receipt is not the exact successful proxy call");
  const block = record(await input.rpc.readConsensus(
    "eth_getBlockByNumber",
    [blockNumber, false]
  ), "factory predeployment canonical block");
  if (rpcQuantity(block.number, "factory predeployment canonical block number") !== blockNumber || nonzeroBytes32(block.hash, "factory predeployment canonical block hash") !== blockHash) throw new TypeError("factory predeployment receipt is not on the canonical finalized chain");
  for (const tag of [blockNumber, finalizedAnchor.blockNumber, "latest"]) {
    await assertRuntimeCodeHash(
      input.rpc,
      deploymentPlan.factoryDeploymentProxy,
      deploymentPlan.factoryDeploymentProxyRuntimeCodeHash,
      tag,
      "canonical CREATE2 proxy"
    );
    await assertRuntimeCodeHash(
      input.rpc,
      deploymentPlan.factory,
      deploymentPlan.factoryRuntimeCodeHash,
      tag,
      "exact Shards factory"
    );
    await assertRuntimeCodeHash(
      input.rpc,
      deploymentPlan.renderer,
      deploymentPlan.rendererRuntimeCodeHash,
      tag,
      "exact Shards renderer"
    );
    await assertExactPredeployedFactoryGettersV1(input.rpc, deploymentPlan.factory, tag);
  }
  for (const component of [EXACT_SHARDS_HOOK_V1, EXACT_SHARDS_NFT_V1, EXACT_SHARDS_TOKEN_V1]) {
    if (rpcHex(
      await input.rpc.readConsensus("eth_getCode", [component, blockNumber]),
      "factory predeployment child runtime"
    ) !== "0x") {
      throw new TypeError("factory predeployment block has an occupied child address");
    }
  }
  const poolState = rpcWord(await input.rpc.readConsensus(
    "eth_getStorageAt",
    [EXACT_SHARDS_POOL_MANAGER_V1, EXACT_SHARDS_POOL_STATE_SLOT_V1, blockNumber]
  ), "factory predeployment pool state");
  if ((BigInt(poolState) & (1n << 160n) - 1n) !== 0n) {
    throw new TypeError("factory predeployment block pool is initialized");
  }
  const core = {
    schemaVersion: "programmable.nested-factory-predeployment-receipt.v1",
    chainId: "1",
    deploymentPlanHash: deploymentPlan.deploymentPlanHash,
    deploymentBytesVerificationHash: deploymentBytes.verificationHash,
    transactionHash,
    plannedTransactionFrom: EXACT_SHARDS_PLANNED_FACTORY_DEPLOYER_V1,
    observedTransactionFrom: transactionFrom,
    transactionTo,
    transactionInputBytes: deploymentPlan.factoryDeploymentCalldataBytes,
    transactionInputHash: deploymentPlan.factoryDeploymentCalldataHash,
    transactionValue: "0",
    blockNumber,
    blockHash,
    finalizedAnchorHash: finalizedAnchor.anchorHash,
    rpcBindingHash,
    receiptStatus: "success",
    dualRpcReceiptState: "matched-finalized",
    deployedState: "factory-renderer-exact-children-empty-pool-uninitialized-at-finalized-deployment-block"
  };
  return deepFreeze({
    ...core,
    receiptHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryPredeploymentReceiptV1(raw) {
  exactKeys(raw, [
    "blockHash",
    "blockNumber",
    "chainId",
    "deployedState",
    "deploymentBytesVerificationHash",
    "deploymentPlanHash",
    "dualRpcReceiptState",
    "finalizedAnchorHash",
    "receiptHash",
    "observedTransactionFrom",
    "plannedTransactionFrom",
    "receiptStatus",
    "rpcBindingHash",
    "schemaVersion",
    "transactionHash",
    "transactionInputBytes",
    "transactionInputHash",
    "transactionTo",
    "transactionValue"
  ], "nested-factory predeployment receipt");
  if (raw.schemaVersion !== "programmable.nested-factory-predeployment-receipt.v1" || raw.chainId !== "1" || raw.transactionTo !== EXACT_SHARDS_FACTORY_DEPLOYMENT_PROXY_V1 || raw.plannedTransactionFrom !== EXACT_SHARDS_PLANNED_FACTORY_DEPLOYER_V1 || raw.transactionInputBytes !== 37974 || raw.transactionInputHash !== EXACT_SHARDS_FACTORY_DEPLOYMENT_CALLDATA_HASH_V1 || raw.transactionValue !== "0" || raw.receiptStatus !== "success" || raw.dualRpcReceiptState !== "matched-finalized" || raw.deployedState !== "factory-renderer-exact-children-empty-pool-uninitialized-at-finalized-deployment-block" || raw.deploymentPlanHash !== EXACT_SHARDS_FACTORY_PREDEPLOYMENT_PLAN_V1.deploymentPlanHash || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(raw.blockNumber)) throw new TypeError("nested-factory predeployment receipt state is invalid");
  sha256(raw.deploymentPlanHash, "predeployment receipt plan");
  sha256(raw.deploymentBytesVerificationHash, "predeployment receipt bytes");
  nonzeroBytes32(raw.transactionHash, "predeployment receipt transaction hash");
  address(raw.observedTransactionFrom, "predeployment receipt observed transaction sender");
  nonzeroBytes32(raw.blockHash, "predeployment receipt block hash");
  sha256(raw.finalizedAnchorHash, "predeployment receipt finalized anchor");
  sha256(raw.rpcBindingHash, "predeployment receipt RPC binding");
  const core = { ...raw };
  delete core.receiptHash;
  if (raw.receiptHash !== canonicalSha256(raw.schemaVersion, core)) {
    throw new TypeError("nested-factory predeployment receipt hash is invalid");
  }
  return deepFreeze(raw);
}
async function verifyNestedFactoryExistingLaunchAdoptionReceiptV1(input) {
  const capability = assertNestedFactoryCapabilityV1(input.capability);
  const activation = capability.activation;
  if (activation === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory adoption cannot be verified before production activation"
    );
  }
  if (activation.factoryLaunchSelector !== EXACT_SHARDS_FACTORY_LAUNCH_SELECTOR_V1) {
    throw new TypeError("nested-factory adoption factory ABI left the exact Shards selector");
  }
  const identity = assertNestedFactoryLaunchIdentityV1(input.launchIdentity);
  const predeploymentReceipt = assertNestedFactoryPredeploymentReceiptV1(
    input.predeploymentReceipt
  );
  const rpcBindingHash = input.rpc.binding().bindingHash;
  if (predeploymentReceipt.rpcBindingHash !== rpcBindingHash) {
    throw new TypeError("nested-factory adoption left the predeployment RPC authority");
  }
  const transactionHash = nonzeroBytes32(
    input.transactionHash,
    "existing exact Shards launch transaction hash"
  );
  const finalizedAnchor = await input.rpc.collectCommonFinalizedAnchor();
  const [transactionValue, receiptValue] = await Promise.all([
    input.rpc.readConsensus("eth_getTransactionByHash", [transactionHash]),
    input.rpc.readConsensus("eth_getTransactionReceipt", [transactionHash])
  ]);
  const transaction = record(transactionValue, "existing exact Shards launch transaction");
  const receipt = record(receiptValue, "existing exact Shards launch receipt");
  const transactionFrom = address(transaction.from, "existing launch sender");
  const transactionTo = address(transaction.to, "existing launch target");
  const transactionInput = rpcHex(transaction.input, "existing launch calldata");
  const inputBytes = hexBytes(transactionInput, "existing launch calldata");
  const blockNumber = rpcQuantity(transaction.blockNumber, "existing launch block number");
  const blockHash = nonzeroBytes32(transaction.blockHash, "existing launch block hash");
  const transactionIndex = rpcQuantity(
    transaction.transactionIndex,
    "existing launch transaction index"
  );
  if (nonzeroBytes32(transaction.hash, "existing launch transaction hash") !== transactionHash || transactionTo !== EXACT_SHARDS_FACTORY_V1 || transactionInput.slice(0, 10) !== EXACT_SHARDS_FACTORY_LAUNCH_SELECTOR_V1 || inputBytes.byteLength !== EXACT_SHARDS_FACTORY_LAUNCH_CALLDATA_BYTES_V1 || keccakBytes(inputBytes) !== EXACT_SHARDS_FACTORY_LAUNCH_CALLDATA_HASH_V1 || rpcQuantity(transaction.value, "existing launch transaction value") !== "0x0" || BigInt(blockNumber) <= BigInt(predeploymentReceipt.blockNumber) || BigInt(blockNumber) > BigInt(finalizedAnchor.blockNumber)) throw new TypeError("existing launch transaction left the exact finalized Shards call");
  if (rpcHex(await input.rpc.readConsensus(
    "eth_getCode",
    [transactionFrom, blockNumber]
  ), "existing launch sender code") !== "0x") {
    throw new TypeError("existing exact Shards launch sender is not an EOA");
  }
  if (nonzeroBytes32(receipt.transactionHash, "existing launch receipt transaction") !== transactionHash || address(receipt.from, "existing launch receipt sender") !== transactionFrom || address(receipt.to, "existing launch receipt target") !== transactionTo || receipt.contractAddress !== null || rpcQuantity(receipt.status, "existing launch receipt status") !== "0x1" || rpcQuantity(receipt.blockNumber, "existing launch receipt block number") !== blockNumber || nonzeroBytes32(receipt.blockHash, "existing launch receipt block hash") !== blockHash || rpcQuantity(receipt.transactionIndex, "existing launch receipt transaction index") !== transactionIndex) throw new TypeError("existing launch receipt is not the exact successful factory call");
  const block = record(await input.rpc.readConsensus(
    "eth_getBlockByNumber",
    [blockNumber, false]
  ), "existing launch canonical block");
  if (rpcQuantity(block.number, "existing launch canonical block number") !== blockNumber || nonzeroBytes32(block.hash, "existing launch canonical block hash") !== blockHash) throw new TypeError("existing launch receipt is not on the canonical finalized chain");
  const logs = receiptLogs(receipt.logs, transactionHash, blockNumber, blockHash, transactionIndex);
  const shardLog = uniqueMatchingLog(
    logs,
    EXACT_SHARDS_FACTORY_V1,
    expectedShardLaunchedTopicsV1(),
    expectedShardLaunchedDataV1(),
    "exact ShardLaunched"
  );
  const initializeLog = uniqueMatchingLog(
    logs,
    EXACT_SHARDS_POOL_MANAGER_V1,
    expectedPoolInitializeTopicsV1(),
    expectedPoolInitializeDataV1(),
    "exact PoolManager Initialize"
  );
  for (const [account, runtimeHash, label] of [
    [EXACT_SHARDS_TOKEN_V1, EXACT_SHARDS_TOKEN_RUNTIME_HASH_V1, "exact Shards token"],
    [EXACT_SHARDS_HOOK_V1, EXACT_SHARDS_HOOK_RUNTIME_HASH_V1, "exact Shards hook"],
    [EXACT_SHARDS_NFT_V1, EXACT_SHARDS_NFT_RUNTIME_HASH_V1, "exact Shards NFT"]
  ]) {
    await assertRuntimeCodeHash(input.rpc, account, runtimeHash, blockNumber, label);
  }
  await assertExactPredeployedFactoryGettersV1(input.rpc, EXACT_SHARDS_FACTORY_V1, blockNumber);
  await assertExactShardsConfigurationHashV1(input.rpc, blockNumber);
  const launchPoolState = rpcWord(await input.rpc.readConsensus(
    "eth_getStorageAt",
    [EXACT_SHARDS_POOL_MANAGER_V1, EXACT_SHARDS_POOL_STATE_SLOT_V1, blockNumber]
  ), "existing launch pool state");
  if ((BigInt(launchPoolState) & (1n << 160n) - 1n) === 0n) {
    throw new TypeError("existing exact Shards launch did not initialize the exact pool");
  }
  const core = {
    schemaVersion: "programmable.nested-factory-existing-launch-adoption-receipt.v1",
    chainId: "1",
    capabilityHash: capability.capabilityHash,
    launchIdentityHash: identity.identityHash,
    predeploymentReceiptHash: predeploymentReceipt.receiptHash,
    executionMode: "EXACT_EXISTING_LAUNCH_ADOPTED",
    transactionHash,
    transactionFrom,
    transactionTo,
    transactionInputBytes: EXACT_SHARDS_FACTORY_LAUNCH_CALLDATA_BYTES_V1,
    transactionInputHash: EXACT_SHARDS_FACTORY_LAUNCH_CALLDATA_HASH_V1,
    transactionValue: "0",
    blockNumber,
    blockHash,
    transactionIndex,
    finalizedAnchorHash: finalizedAnchor.anchorHash,
    rpcBindingHash,
    shardLaunchedLogIndex: shardLog.logIndex,
    shardLaunchedLogHash: shardLog.logHash,
    poolInitializeLogIndex: initializeLog.logIndex,
    poolInitializeLogHash: initializeLog.logHash,
    configurationHash: EXACT_SHARDS_CONFIGURATION_HASH_V1,
    poolId: EXACT_SHARDS_POOL_ID_V1,
    archiveEvidenceState: "matched-finalized-canonical-exact-direct-factory-launch"
  };
  return deepFreeze({
    ...core,
    receiptHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryExistingLaunchAdoptionReceiptV1(raw) {
  exactKeys(raw, [
    "archiveEvidenceState",
    "blockHash",
    "blockNumber",
    "capabilityHash",
    "chainId",
    "configurationHash",
    "executionMode",
    "finalizedAnchorHash",
    "launchIdentityHash",
    "poolId",
    "poolInitializeLogHash",
    "poolInitializeLogIndex",
    "predeploymentReceiptHash",
    "receiptHash",
    "rpcBindingHash",
    "schemaVersion",
    "shardLaunchedLogHash",
    "shardLaunchedLogIndex",
    "transactionFrom",
    "transactionHash",
    "transactionIndex",
    "transactionInputBytes",
    "transactionInputHash",
    "transactionTo",
    "transactionValue"
  ], "nested-factory existing launch adoption receipt");
  if (raw.schemaVersion !== "programmable.nested-factory-existing-launch-adoption-receipt.v1" || raw.chainId !== "1" || raw.executionMode !== "EXACT_EXISTING_LAUNCH_ADOPTED" || raw.transactionTo !== EXACT_SHARDS_FACTORY_V1 || raw.transactionInputBytes !== EXACT_SHARDS_FACTORY_LAUNCH_CALLDATA_BYTES_V1 || raw.transactionInputHash !== EXACT_SHARDS_FACTORY_LAUNCH_CALLDATA_HASH_V1 || raw.transactionValue !== "0" || raw.configurationHash !== EXACT_SHARDS_CONFIGURATION_HASH_V1 || raw.poolId !== EXACT_SHARDS_POOL_ID_V1 || raw.archiveEvidenceState !== "matched-finalized-canonical-exact-direct-factory-launch") throw new TypeError("nested-factory existing launch adoption receipt is invalid");
  for (const value of [
    raw.capabilityHash,
    raw.launchIdentityHash,
    raw.predeploymentReceiptHash,
    raw.finalizedAnchorHash,
    raw.rpcBindingHash,
    raw.shardLaunchedLogHash,
    raw.poolInitializeLogHash
  ]) sha256(value, "nested-factory adoption hash binding");
  nonzeroBytes32(raw.transactionHash, "nested-factory adoption transaction");
  address(raw.transactionFrom, "nested-factory adoption sender");
  nonzeroBytes32(raw.blockHash, "nested-factory adoption block");
  for (const value of [
    raw.blockNumber,
    raw.transactionIndex,
    raw.shardLaunchedLogIndex,
    raw.poolInitializeLogIndex
  ]) rpcQuantity(value, "nested-factory adoption quantity");
  const core = { ...raw };
  delete core.receiptHash;
  if (raw.receiptHash !== canonicalSha256(raw.schemaVersion, core)) {
    throw new TypeError("nested-factory existing launch adoption receipt hash is invalid");
  }
  return deepFreeze(raw);
}
function verifyNestedFactoryCompiledRouteV1(input) {
  const abiEncodedRoute = boundedHexBytes(
    input.abiEncodedRoute,
    1048576,
    "nested-factory ABI route"
  );
  const abiEncodedExpectedResult = boundedHexBytes(
    input.abiEncodedExpectedResult,
    4096,
    "nested-factory ABI expected result"
  );
  const routePayloadHash = keccakBytes(abiEncodedRoute);
  const expectedResultHash = keccakBytes(abiEncodedExpectedResult);
  const capability = resolveEnabledNestedFactoryCapabilityV1({
    catalog: input.catalog,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    routePayloadHash,
    expectedResultHash
  });
  const activation = capability.activation;
  if (activation === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory route compilation is not production-enabled"
    );
  }
  const core = {
    schemaVersion: "programmable.verified-nested-factory-compiled-route.v1",
    capabilityHash: capability.capabilityHash,
    compilerArtifactSha256: activation.compilerArtifactSha256,
    routeSchemaSha256: activation.routeSchemaSha256,
    portableVerifierArtifactSha256: activation.portableVerifierArtifactSha256,
    revenuePolicyHash: capability.revenuePolicyHash,
    routePayloadHash,
    routePayloadBytes: abiEncodedRoute.byteLength,
    expectedResultHash,
    expectedResultBytes: abiEncodedExpectedResult.byteLength
  };
  return deepFreeze({
    ...core,
    verificationHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertVerifiedNestedFactoryCompiledRouteV1(raw) {
  exactKeys(raw, [
    "capabilityHash",
    "compilerArtifactSha256",
    "expectedResultBytes",
    "expectedResultHash",
    "portableVerifierArtifactSha256",
    "revenuePolicyHash",
    "routePayloadBytes",
    "routePayloadHash",
    "routeSchemaSha256",
    "schemaVersion",
    "verificationHash"
  ], "verified nested-factory compiled route");
  const core = { ...raw };
  delete core.verificationHash;
  if (raw.schemaVersion !== "programmable.verified-nested-factory-compiled-route.v1" || raw.revenuePolicyHash !== EXACT_SHARDS_REVENUE_POLICY_HASH_V1 || positiveSafeInteger(raw.routePayloadBytes, "compiled route bytes") > 1048576 || positiveSafeInteger(raw.expectedResultBytes, "compiled result bytes") > 4096 || raw.verificationHash !== canonicalSha256(raw.schemaVersion, core)) throw new TypeError("verified nested-factory compiled route is invalid");
  sha256(raw.capabilityHash, "compiled route capability");
  sha256(raw.compilerArtifactSha256, "compiled route compiler");
  sha256(raw.routeSchemaSha256, "compiled route schema");
  sha256(raw.portableVerifierArtifactSha256, "compiled route verifier");
  nonzeroBytes32(raw.routePayloadHash, "compiled route payload hash");
  nonzeroBytes32(raw.expectedResultHash, "compiled route result hash");
  return deepFreeze(raw);
}
async function verifyNestedFactoryCurrentnessV1(input) {
  const capability = assertNestedFactoryCapabilityV1(input.capability);
  if (capability.state !== "enabled" || capability.activation === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory currentness cannot run before deployment activation"
    );
  }
  const identity = assertNestedFactoryLaunchIdentityV1(input.launchIdentity);
  const predeploymentReceipt = assertNestedFactoryPredeploymentReceiptV1(
    input.predeploymentReceipt
  );
  const adoptionReceipt = input.adoptionReceipt === null ? null : assertNestedFactoryExistingLaunchAdoptionReceiptV1(input.adoptionReceipt);
  const deploymentPlan = EXACT_SHARDS_FACTORY_PREDEPLOYMENT_PLAN_V1;
  if (predeploymentReceipt.deploymentPlanHash !== deploymentPlan.deploymentPlanHash || predeploymentReceipt.rpcBindingHash !== input.rpc.binding().bindingHash || adoptionReceipt !== null && (adoptionReceipt.capabilityHash !== capability.capabilityHash || adoptionReceipt.launchIdentityHash !== identity.identityHash || adoptionReceipt.predeploymentReceiptHash !== predeploymentReceipt.receiptHash || adoptionReceipt.rpcBindingHash !== input.rpc.binding().bindingHash)) throw new TypeError("nested-factory currentness left the immutable predeployment release");
  const executionMode = adoptionReceipt === null ? "EXACT_FACTORY_LAUNCH_EXECUTED" : "EXACT_EXISTING_LAUNCH_ADOPTED";
  const poolId = nonzeroBytes32(input.poolId, "nested-factory pool id");
  const poolStateSlot = nonzeroBytes32(input.poolStateSlot, "nested-factory pool state slot");
  const components = canonicalCurrentnessComponents(input.components);
  if (poolId !== EXACT_SHARDS_POOL_ID_V1 || poolStateSlot !== EXACT_SHARDS_POOL_STATE_SLOT_V1) {
    throw new TypeError("nested-factory currentness pool left the exact Shards pool");
  }
  const [finalizedAnchor, chainClock] = await Promise.all([
    input.rpc.collectCommonFinalizedAnchor(),
    input.rpc.observeChainClock()
  ]);
  const rpcBindingHash = input.rpc.binding().bindingHash;
  const runtimeBindings = [
    [
      "Router V2",
      capability.activation.router.address,
      capability.activation.router.runtimeCodeHash
    ],
    [
      "nested-factory module",
      capability.activation.module.address,
      capability.activation.module.runtimeCodeHash
    ],
    [
      "permit authority",
      capability.activation.permitAuthority.address,
      capability.activation.permitAuthority.runtimeCodeHash
    ],
    [
      "capability admin",
      capability.activation.capabilityAdmin.address,
      capability.activation.capabilityAdmin.runtimeCodeHash
    ],
    ["PoolManager", capability.poolManager, capability.poolManagerRuntimeCodeHash],
    [
      "canonical CREATE2 proxy",
      deploymentPlan.factoryDeploymentProxy,
      deploymentPlan.factoryDeploymentProxyRuntimeCodeHash
    ],
    ["exact Shards factory", deploymentPlan.factory, deploymentPlan.factoryRuntimeCodeHash],
    ["exact Shards renderer", deploymentPlan.renderer, deploymentPlan.rendererRuntimeCodeHash]
  ];
  let authorityStates = null;
  for (const tag of [finalizedAnchor.blockNumber, "latest"]) {
    for (const [label, account, expectedRuntimeHash] of runtimeBindings) {
      await assertRuntimeCodeHash(input.rpc, account, expectedRuntimeHash, tag, label);
    }
    const observedAuthorityStates = deepFreeze(await Promise.all([
      verifySafeAuthorityAtBlockV1(
        input.rpc,
        "permit-authority",
        capability.activation.permitAuthority,
        tag
      ),
      verifySafeAuthorityAtBlockV1(
        input.rpc,
        "capability-admin",
        capability.activation.capabilityAdmin,
        tag
      )
    ]).then((values) => values.sort((left, right) => compareUtf8(left.role, right.role))));
    if (authorityStates === null) {
      authorityStates = observedAuthorityStates;
    } else if (canonicalizeJson(authorityStates) !== canonicalizeJson(observedAuthorityStates)) {
      throw new TypeError("nested-factory Safe authority state changed between finalized and latest");
    }
    await assertExactPredeployedFactoryGettersV1(input.rpc, deploymentPlan.factory, tag);
    if (executionMode === "EXACT_FACTORY_LAUNCH_EXECUTED") {
      for (const component of components) {
        const code = rpcHex(await input.rpc.readConsensus(
          "eth_getCode",
          [component.address, tag]
        ), `${component.kind} current runtime`);
        if (code !== "0x") throw new TypeError(`${component.kind} address is already occupied`);
      }
    } else {
      for (const [account, runtimeHash, label] of [
        [EXACT_SHARDS_TOKEN_V1, EXACT_SHARDS_TOKEN_RUNTIME_HASH_V1, "exact Shards token"],
        [EXACT_SHARDS_HOOK_V1, EXACT_SHARDS_HOOK_RUNTIME_HASH_V1, "exact Shards hook"],
        [EXACT_SHARDS_NFT_V1, EXACT_SHARDS_NFT_RUNTIME_HASH_V1, "exact Shards NFT"]
      ]) await assertRuntimeCodeHash(input.rpc, account, runtimeHash, tag, label);
      await assertExactShardsConfigurationHashV1(input.rpc, tag);
    }
    const poolState = rpcWord(await input.rpc.readConsensus(
      "eth_getStorageAt",
      [capability.poolManager, poolStateSlot, tag]
    ), "nested-factory pool state");
    const sqrtPriceX96 = BigInt(poolState) & (1n << 160n) - 1n;
    if (executionMode === "EXACT_FACTORY_LAUNCH_EXECUTED" && sqrtPriceX96 !== 0n || executionMode === "EXACT_EXISTING_LAUNCH_ADOPTED" && sqrtPriceX96 === 0n) {
      throw new TypeError("nested-factory pool state disagrees with the exact execution mode");
    }
  }
  if (authorityStates === null) throw new TypeError("nested-factory Safe authority state is absent");
  const core = {
    schemaVersion: "programmable.nested-factory-currentness-evidence.v1",
    capabilityHash: capability.capabilityHash,
    launchIdentityHash: identity.identityHash,
    deploymentPlanHash: deploymentPlan.deploymentPlanHash,
    predeploymentReceiptHash: predeploymentReceipt.receiptHash,
    adoptionReceiptHash: adoptionReceipt?.receiptHash ?? null,
    executionMode,
    finalizedAnchor,
    chainClock,
    rpcBindingHash,
    authorityStates,
    poolId,
    poolStateSlot,
    components,
    runtimeState: "matched-finalized-and-latest",
    observedStartingState: executionMode === "EXACT_FACTORY_LAUNCH_EXECUTED" ? "exact-predeployed-pair" : "exact-existing-canonical-launch",
    factoryGetterState: "matched-finalized-and-latest",
    deploymentTargetState: executionMode === "EXACT_FACTORY_LAUNCH_EXECUTED" ? "factory-renderer-exact-children-empty-finalized-and-latest" : "factory-renderer-children-runtimes-config-exact-finalized-and-latest",
    poolState: executionMode === "EXACT_FACTORY_LAUNCH_EXECUTED" ? "uninitialized-finalized-and-latest" : "initialized-exact-pool-finalized-and-latest"
  };
  return deepFreeze({
    ...core,
    evidenceHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryCurrentnessEvidenceV1(raw) {
  exactKeys(raw, [
    "adoptionReceiptHash",
    "authorityStates",
    "capabilityHash",
    "chainClock",
    "components",
    "deploymentPlanHash",
    "deploymentTargetState",
    "evidenceHash",
    "factoryGetterState",
    "executionMode",
    "finalizedAnchor",
    "launchIdentityHash",
    "poolId",
    "poolState",
    "poolStateSlot",
    "predeploymentReceiptHash",
    "rpcBindingHash",
    "observedStartingState",
    "runtimeState",
    "schemaVersion"
  ], "nested-factory currentness evidence");
  if (raw.schemaVersion !== "programmable.nested-factory-currentness-evidence.v1" || raw.runtimeState !== "matched-finalized-and-latest" || raw.factoryGetterState !== "matched-finalized-and-latest" || raw.poolId !== EXACT_SHARDS_POOL_ID_V1 || raw.poolStateSlot !== EXACT_SHARDS_POOL_STATE_SLOT_V1) throw new TypeError("nested-factory currentness evidence state is invalid");
  const isExecutable = raw.executionMode === "EXACT_FACTORY_LAUNCH_EXECUTED" && raw.adoptionReceiptHash === null && raw.observedStartingState === "exact-predeployed-pair" && raw.deploymentTargetState === "factory-renderer-exact-children-empty-finalized-and-latest" && raw.poolState === "uninitialized-finalized-and-latest";
  const isAdopted = raw.executionMode === "EXACT_EXISTING_LAUNCH_ADOPTED" && raw.adoptionReceiptHash !== null && raw.observedStartingState === "exact-existing-canonical-launch" && raw.deploymentTargetState === "factory-renderer-children-runtimes-config-exact-finalized-and-latest" && raw.poolState === "initialized-exact-pool-finalized-and-latest";
  if (!isExecutable && !isAdopted) {
    throw new TypeError("nested-factory currentness execution mode is inconsistent");
  }
  if (raw.deploymentPlanHash !== EXACT_SHARDS_FACTORY_PREDEPLOYMENT_PLAN_V1.deploymentPlanHash) {
    throw new TypeError("nested-factory currentness deployment plan is invalid");
  }
  sha256(raw.predeploymentReceiptHash, "nested-factory predeployment receipt");
  if (raw.adoptionReceiptHash !== null) {
    sha256(raw.adoptionReceiptHash, "nested-factory adoption receipt");
  }
  canonicalCurrentnessComponents(raw.components);
  assertCurrentnessClock(raw.chainClock);
  assertCommonFinalizedAnchorV1(raw.finalizedAnchor);
  sha256(raw.rpcBindingHash, "nested-factory RPC binding");
  assertCurrentnessAuthorityStates(raw.authorityStates);
  const core = { ...raw };
  delete core.evidenceHash;
  if (raw.evidenceHash !== canonicalSha256(raw.schemaVersion, core)) {
    throw new TypeError("nested-factory currentness evidence hash is invalid");
  }
  return deepFreeze(raw);
}
function createNestedFactoryGasEvidenceV1(input) {
  const capability = assertNestedFactoryCapabilityV1(input.capability);
  const activation = capability.activation;
  if (activation === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory gas evidence cannot be created before production activation"
    );
  }
  const identity = assertNestedFactoryLaunchIdentityV1(input.launchIdentity);
  const predeploymentReceipt = assertNestedFactoryPredeploymentReceiptV1(
    input.predeploymentReceipt
  );
  const currentness = assertNestedFactoryCurrentnessEvidenceV1(input.currentness);
  if (predeploymentReceipt.deploymentPlanHash !== EXACT_SHARDS_FACTORY_PREDEPLOYMENT_PLAN_V1.deploymentPlanHash || currentness.predeploymentReceiptHash !== predeploymentReceipt.receiptHash || currentness.capabilityHash !== capability.capabilityHash || currentness.launchIdentityHash !== identity.identityHash) throw new TypeError("nested-factory gas evidence left the exact live launch state");
  const calldata = boundedHexBytes(
    input.transactionCalldata,
    1048576,
    "nested-factory applicant transaction calldata"
  );
  if (`0x${Buffer.from(calldata.slice(0, 4)).toString("hex")}` !== "0xc90ca102") {
    throw new TypeError("nested-factory applicant transaction is not the direct Shards action");
  }
  const transactionValue = decimalUint(
    input.transactionValue,
    256,
    "nested-factory applicant transaction value"
  );
  const providerEstimates = canonicalGasEstimates(input.providerEstimates);
  const maximumEstimate = providerEstimates.reduce(
    (maximum, entry) => BigInt(entry.gas) > maximum ? BigInt(entry.gas) : maximum,
    0n
  );
  const bufferedGasLimit = ceilDiv(
    maximumEstimate * NESTED_FACTORY_GAS_BUFFER_NUMERATOR_V1,
    NESTED_FACTORY_GAS_BUFFER_DENOMINATOR_V1
  );
  if (bufferedGasLimit > NESTED_FACTORY_MAINNET_TRANSACTION_GAS_LIMIT_V1) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_TRANSACTION_GAS_LIMIT_EXCEEDED",
      "buffered nested-factory transaction exceeds the Mainnet per-transaction gas limit"
    );
  }
  const core = {
    schemaVersion: "programmable.nested-factory-gas-evidence.v1",
    chainId: "1",
    capabilityHash: capability.capabilityHash,
    launchIdentityHash: identity.identityHash,
    predeploymentReceiptHash: predeploymentReceipt.receiptHash,
    currentnessEvidenceHash: currentness.evidenceHash,
    finalizedAnchorHash: currentness.finalizedAnchor.anchorHash,
    rpcBindingHash: currentness.rpcBindingHash,
    router: activation.router.address,
    launchWallet: identity.launchWallet,
    transactionCalldataBytes: calldata.byteLength,
    transactionCalldataHash: keccakBytes(calldata),
    transactionValue,
    providerEstimates,
    maximumEstimate: maximumEstimate.toString(10),
    bufferNumerator: NESTED_FACTORY_GAS_BUFFER_NUMERATOR_V1.toString(10),
    bufferDenominator: NESTED_FACTORY_GAS_BUFFER_DENOMINATOR_V1.toString(10),
    bufferedGasLimit: bufferedGasLimit.toString(10),
    mainnetTransactionGasLimit: NESTED_FACTORY_MAINNET_TRANSACTION_GAS_LIMIT_V1.toString(10),
    executionMode: currentness.executionMode,
    withinMainnetTransactionGasLimit: true
  };
  return deepFreeze({
    ...core,
    evidenceHash: canonicalSha256(core.schemaVersion, core)
  });
}
async function verifyNestedFactoryGasEvidenceV1(input) {
  const capability = assertNestedFactoryCapabilityV1(input.capability);
  if (capability.activation === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory gas evidence cannot be observed before production activation"
    );
  }
  const identity = assertNestedFactoryLaunchIdentityV1(input.launchIdentity);
  const predeploymentReceipt = assertNestedFactoryPredeploymentReceiptV1(
    input.predeploymentReceipt
  );
  const currentness = assertNestedFactoryCurrentnessEvidenceV1(input.currentness);
  const rpcBinding = input.rpc.binding();
  if (rpcBinding.bindingHash !== predeploymentReceipt.rpcBindingHash || rpcBinding.bindingHash !== currentness.rpcBindingHash) {
    throw new TypeError("nested-factory gas RPC binding left the live launch state");
  }
  const transactionValue = decimalUint(
    input.transactionValue,
    256,
    "nested-factory applicant transaction value"
  );
  const providerEstimates = await input.rpc.estimateGasPair({
    from: identity.launchWallet,
    to: capability.activation.router.address,
    data: rpcHex(input.transactionCalldata, "nested-factory applicant transaction calldata"),
    value: quantity(BigInt(transactionValue))
  }, "latest");
  const expectedProviderIds = rpcBinding.providers.map(({ providerId }) => providerId).sort(compareUtf8);
  const observedProviderIds = providerEstimates.map(({ providerId }) => providerId).sort(compareUtf8);
  if (canonicalizeJson(expectedProviderIds) !== canonicalizeJson(observedProviderIds)) {
    throw new TypeError("nested-factory gas estimates do not use the release RPC providers");
  }
  return createNestedFactoryGasEvidenceV1({
    capability,
    launchIdentity: identity,
    predeploymentReceipt,
    currentness,
    transactionCalldata: input.transactionCalldata,
    transactionValue,
    providerEstimates
  });
}
function assertNestedFactoryGasEvidenceV1(raw) {
  exactKeys(raw, [
    "bufferDenominator",
    "bufferNumerator",
    "bufferedGasLimit",
    "capabilityHash",
    "chainId",
    "currentnessEvidenceHash",
    "evidenceHash",
    "finalizedAnchorHash",
    "launchIdentityHash",
    "executionMode",
    "launchWallet",
    "mainnetTransactionGasLimit",
    "maximumEstimate",
    "predeploymentReceiptHash",
    "providerEstimates",
    "router",
    "rpcBindingHash",
    "schemaVersion",
    "transactionCalldataBytes",
    "transactionCalldataHash",
    "transactionValue",
    "withinMainnetTransactionGasLimit"
  ], "nested-factory gas evidence");
  if (raw.schemaVersion !== "programmable.nested-factory-gas-evidence.v1" || raw.chainId !== "1" || raw.bufferNumerator !== "120" || raw.bufferDenominator !== "100" || raw.mainnetTransactionGasLimit !== "16777216" || !isNestedFactoryExecutionModeV1(raw.executionMode) || raw.withinMainnetTransactionGasLimit !== true) throw new TypeError("nested-factory gas evidence policy is invalid");
  const estimates = canonicalGasEstimates(raw.providerEstimates);
  const maximum = estimates.reduce(
    (value, entry) => BigInt(entry.gas) > value ? BigInt(entry.gas) : value,
    0n
  );
  const buffered = ceilDiv(maximum * 120n, 100n);
  if (raw.maximumEstimate !== maximum.toString(10) || raw.bufferedGasLimit !== buffered.toString(10) || buffered > NESTED_FACTORY_MAINNET_TRANSACTION_GAS_LIMIT_V1 || positiveSafeInteger(raw.transactionCalldataBytes, "gas evidence calldata bytes") > 1048576) throw new TypeError("nested-factory gas evidence calculation is invalid");
  sha256(raw.capabilityHash, "gas evidence capability");
  sha256(raw.launchIdentityHash, "gas evidence launch identity");
  sha256(raw.predeploymentReceiptHash, "gas evidence predeployment receipt");
  sha256(raw.currentnessEvidenceHash, "gas evidence currentness");
  sha256(raw.finalizedAnchorHash, "gas evidence finalized anchor");
  sha256(raw.rpcBindingHash, "gas evidence RPC binding");
  address(raw.router, "gas evidence Router");
  address(raw.launchWallet, "gas evidence launch wallet");
  nonzeroBytes32(raw.transactionCalldataHash, "gas evidence calldata hash");
  decimalUint(raw.transactionValue, 256, "gas evidence transaction value");
  const core = { ...raw };
  delete core.evidenceHash;
  if (raw.evidenceHash !== canonicalSha256(raw.schemaVersion, core)) {
    throw new TypeError("nested-factory gas evidence hash is invalid");
  }
  return deepFreeze(raw);
}
function nestedFactoryRuntimeBindingHashV1(binding) {
  const normalized = runtimeBinding(binding, "nested-factory release runtime");
  return canonicalSha256("programmable.nested-factory-runtime-binding.v1", normalized);
}
function nestedFactoryReleaseAttestationAuthorityBindingHashV1(authority) {
  const normalized = releaseAttestationAuthorityBinding(authority);
  return canonicalSha256(normalized.schemaVersion, normalized);
}
function createNestedFactoryPlatformProfileReleaseStatementV1(input) {
  const catalog = assertNestedFactoryCapabilityCatalogV1(input.catalog);
  const capability = assertNestedFactoryCapabilityV1(input.capability);
  const activation = capability.activation;
  if (activation === null || capability.profileSha256 === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory platform release cannot be issued before production activation"
    );
  }
  const predeploymentReceipt = assertNestedFactoryPredeploymentReceiptV1(
    input.predeploymentReceipt
  );
  if (!catalog.entries.some((entry) => entry.capabilityHash === capability.capabilityHash) || capability.profile.profileId !== EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_V1 || capability.profile.profileVersion !== EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_V1 || capability.profile.profileKey !== EXACT_SHARDS_NESTED_FACTORY_PROFILE_KEY_V1 || predeploymentReceipt.deploymentPlanHash !== EXACT_SHARDS_FACTORY_PREDEPLOYMENT_PLAN_V1.deploymentPlanHash) throw new TypeError("nested-factory platform release artifacts do not share one profile");
  const releaseRevision = decimalUint(
    input.releaseRevision,
    64,
    "nested-factory platform release revision"
  );
  if (releaseRevision === "0") throw new TypeError("nested-factory release revision is zero");
  const revocationEpoch = decimalUint(
    input.revocationEpoch,
    64,
    "nested-factory platform release revocation epoch"
  );
  const issuedAtEpochSeconds = decimalUint(
    input.issuedAtEpochSeconds,
    64,
    "nested-factory platform release issue time"
  );
  const expiresAtEpochSeconds = decimalUint(
    input.expiresAtEpochSeconds,
    64,
    "nested-factory platform release expiry"
  );
  if (BigInt(expiresAtEpochSeconds) <= BigInt(issuedAtEpochSeconds) || BigInt(expiresAtEpochSeconds) - BigInt(issuedAtEpochSeconds) > NESTED_FACTORY_MAXIMUM_PLATFORM_RELEASE_LIFETIME_SECONDS_V1) throw new TypeError("nested-factory platform release validity window is invalid");
  const expectedConfigurationHash = nonzeroBytes32(
    input.expectedConfigurationHash,
    "nested-factory expected configuration hash"
  );
  if (expectedConfigurationHash !== EXACT_SHARDS_CONFIGURATION_HASH_V1) {
    throw new TypeError("nested-factory release left the exact Shards configuration");
  }
  const core = {
    schemaVersion: "programmable.nested-factory-platform-profile-release-statement.v1",
    releaseId: identifier(input.releaseId, "nested-factory platform release id"),
    releaseRevision,
    revocationEpoch,
    chainId: "1",
    issuedAtEpochSeconds,
    expiresAtEpochSeconds,
    capabilityCatalogHash: catalog.catalogHash,
    capabilityHash: capability.capabilityHash,
    routeId: NESTED_FACTORY_ROUTE_ID_V1,
    routeVersion: NESTED_FACTORY_ROUTE_VERSION_V1,
    profileId: EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_V1,
    profileVersion: EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_V1,
    profileKey: EXACT_SHARDS_NESTED_FACTORY_PROFILE_KEY_V1,
    profileSha256: capability.profileSha256,
    planSchemaId: NESTED_FACTORY_REVIEWED_PLAN_SCHEMA_ID_V1,
    reviewedPlanSha256: sha256(input.reviewedPlanSha256, "nested-factory reviewed plan"),
    applicantAcceptanceVerifierArtifactSha256: activation.applicantAcceptanceVerifierArtifactSha256,
    executionModePolicy: activation.executionModePolicy,
    sourceRevisionHash: capability.sourceRevisionHash,
    manifestHash: capability.manifestHash,
    revenuePolicyHash: capability.revenuePolicyHash,
    expectedPoolId: EXACT_SHARDS_POOL_ID_V1,
    expectedConfigurationHash,
    routerRuntimeBindingHash: nestedFactoryRuntimeBindingHashV1(activation.router),
    moduleRuntimeBindingHash: nestedFactoryRuntimeBindingHashV1(activation.module),
    permitAuthorityConfigurationSha256: activation.permitAuthority.authorityConfigurationSha256,
    capabilityAdminConfigurationSha256: activation.capabilityAdmin.authorityConfigurationSha256,
    deploymentPlanHash: predeploymentReceipt.deploymentPlanHash,
    deploymentBytesVerificationHash: predeploymentReceipt.deploymentBytesVerificationHash,
    predeploymentReceiptHash: predeploymentReceipt.receiptHash,
    profileGasAuditSha256: activation.profileGasAuditSha256,
    portableVerifierArtifactSha256: activation.portableVerifierArtifactSha256,
    ceremonyPolicySha256: activation.ceremonyPolicySha256,
    independentAuditSha256: activation.independentAuditSha256,
    revenueAttestationSha256: activation.revenueAttestationSha256,
    revenueVerifierArtifactSha256: activation.revenueVerifierArtifactSha256,
    releaseAttestationAuthorityBindingHash: nestedFactoryReleaseAttestationAuthorityBindingHashV1(
      activation.releaseAttestationAuthority
    ),
    liveCeremonyRequirement: "fresh-dual-rpc-factory-children-pool-safe-nonce-currentness-before-permit-and-launch"
  };
  return deepFreeze({
    ...core,
    statementHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryPlatformProfileReleaseStatementV1(raw) {
  exactKeys(raw, [
    "applicantAcceptanceVerifierArtifactSha256",
    "capabilityAdminConfigurationSha256",
    "capabilityCatalogHash",
    "capabilityHash",
    "ceremonyPolicySha256",
    "chainId",
    "deploymentBytesVerificationHash",
    "deploymentPlanHash",
    "executionModePolicy",
    "expectedConfigurationHash",
    "expectedPoolId",
    "expiresAtEpochSeconds",
    "independentAuditSha256",
    "issuedAtEpochSeconds",
    "liveCeremonyRequirement",
    "manifestHash",
    "moduleRuntimeBindingHash",
    "permitAuthorityConfigurationSha256",
    "planSchemaId",
    "portableVerifierArtifactSha256",
    "predeploymentReceiptHash",
    "profileId",
    "profileGasAuditSha256",
    "profileKey",
    "profileSha256",
    "profileVersion",
    "releaseAttestationAuthorityBindingHash",
    "releaseId",
    "releaseRevision",
    "revenueAttestationSha256",
    "revenuePolicyHash",
    "revenueVerifierArtifactSha256",
    "revocationEpoch",
    "reviewedPlanSha256",
    "routeId",
    "routeVersion",
    "routerRuntimeBindingHash",
    "schemaVersion",
    "sourceRevisionHash",
    "statementHash"
  ], "nested-factory platform profile release statement");
  if (raw.schemaVersion !== "programmable.nested-factory-platform-profile-release-statement.v1" || raw.chainId !== "1" || raw.routeId !== NESTED_FACTORY_ROUTE_ID_V1 || raw.routeVersion !== NESTED_FACTORY_ROUTE_VERSION_V1 || raw.profileId !== EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_V1 || raw.profileVersion !== EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_V1 || raw.profileKey !== EXACT_SHARDS_NESTED_FACTORY_PROFILE_KEY_V1 || raw.expectedPoolId !== EXACT_SHARDS_POOL_ID_V1 || raw.expectedConfigurationHash !== EXACT_SHARDS_CONFIGURATION_HASH_V1 || canonicalizeJson(canonicalExecutionModePolicy(raw.executionModePolicy)) !== canonicalizeJson(NESTED_FACTORY_EXECUTION_MODE_POLICY_V1) || raw.applicantAcceptanceVerifierArtifactSha256 !== HOOKBUILDER_ACCEPTANCE_PROTOCOL_BINDING_SHA256_V1 || raw.liveCeremonyRequirement !== "fresh-dual-rpc-factory-children-pool-safe-nonce-currentness-before-permit-and-launch") throw new TypeError("nested-factory platform profile release statement is invalid");
  const issued = BigInt(decimalUint(raw.issuedAtEpochSeconds, 64, "release issue time"));
  const expires = BigInt(decimalUint(raw.expiresAtEpochSeconds, 64, "release expiry"));
  if (expires <= issued || expires - issued > NESTED_FACTORY_MAXIMUM_PLATFORM_RELEASE_LIFETIME_SECONDS_V1 || decimalUint(raw.releaseRevision, 64, "release revision") === "0") throw new TypeError("nested-factory platform profile release validity is invalid");
  decimalUint(raw.revocationEpoch, 64, "release revocation epoch");
  for (const value of [
    raw.capabilityCatalogHash,
    raw.capabilityHash,
    raw.profileSha256,
    raw.reviewedPlanSha256,
    raw.applicantAcceptanceVerifierArtifactSha256,
    raw.routerRuntimeBindingHash,
    raw.moduleRuntimeBindingHash,
    raw.permitAuthorityConfigurationSha256,
    raw.capabilityAdminConfigurationSha256,
    raw.deploymentPlanHash,
    raw.deploymentBytesVerificationHash,
    raw.predeploymentReceiptHash,
    raw.profileGasAuditSha256,
    raw.portableVerifierArtifactSha256,
    raw.ceremonyPolicySha256,
    raw.independentAuditSha256,
    raw.revenueAttestationSha256,
    raw.revenueVerifierArtifactSha256,
    raw.releaseAttestationAuthorityBindingHash
  ]) sha256(value, "nested-factory platform release hash binding");
  for (const value of [
    raw.sourceRevisionHash,
    raw.manifestHash,
    raw.revenuePolicyHash
  ]) nonzeroBytes32(value, "nested-factory platform release EVM hash binding");
  const core = { ...raw };
  delete core.statementHash;
  if (raw.statementHash !== canonicalSha256(raw.schemaVersion, core)) {
    throw new TypeError("nested-factory platform profile release statement hash is invalid");
  }
  return deepFreeze(raw);
}
function nestedFactoryPlatformProfileReleaseSigningBytesV1(statement) {
  const normalized = assertNestedFactoryPlatformProfileReleaseStatementV1(statement);
  return Buffer.from(`${normalized.schemaVersion}\0${canonicalizeJson(normalized)}`, "utf8");
}
function createSignedNestedFactoryPlatformProfileReleaseAttestationV1(input) {
  const statement = assertNestedFactoryPlatformProfileReleaseStatementV1(input.statement);
  const authority = releaseAttestationAuthorityBinding(input.authority);
  if (statement.releaseAttestationAuthorityBindingHash !== nestedFactoryReleaseAttestationAuthorityBindingHashV1(authority)) throw new TypeError("nested-factory release signature authority is not statement-bound");
  const signature = decodeCanonicalBase64Url(input.signatureBase64Url, "release signature");
  if (signature.byteLength !== 64) throw new TypeError("release Ed25519 signature is not 64 bytes");
  const core = {
    schemaVersion: "programmable.signed-nested-factory-platform-profile-release-attestation.v1",
    statement,
    authority,
    signatureBase64Url: input.signatureBase64Url,
    signatureSha256: rawSha256(signature)
  };
  return deepFreeze({
    ...core,
    attestationHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertSignedNestedFactoryPlatformProfileReleaseAttestationV1(raw) {
  exactKeys(raw, [
    "attestationHash",
    "authority",
    "schemaVersion",
    "signatureBase64Url",
    "signatureSha256",
    "statement"
  ], "signed nested-factory platform profile release attestation");
  if (raw.schemaVersion !== "programmable.signed-nested-factory-platform-profile-release-attestation.v1") {
    throw new TypeError("signed nested-factory platform release schema is invalid");
  }
  const rebuilt = createSignedNestedFactoryPlatformProfileReleaseAttestationV1(raw);
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt)) {
    throw new TypeError("signed nested-factory platform release hash is invalid");
  }
  return rebuilt;
}
function verifySignedNestedFactoryPlatformProfileReleaseAttestationV1(input) {
  const attestation = assertSignedNestedFactoryPlatformProfileReleaseAttestationV1(
    input.attestation
  );
  const capability = assertNestedFactoryCapabilityV1(input.capability);
  const activation = capability.activation;
  if (activation === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory signed platform release cannot verify before activation"
    );
  }
  if (canonicalizeJson(attestation.authority) !== canonicalizeJson(activation.releaseAttestationAuthority)) {
    throw new TypeError("nested-factory platform release used an unbound signature authority");
  }
  const expectedStatement = createNestedFactoryPlatformProfileReleaseStatementV1({
    releaseId: attestation.statement.releaseId,
    releaseRevision: attestation.statement.releaseRevision,
    revocationEpoch: attestation.statement.revocationEpoch,
    issuedAtEpochSeconds: attestation.statement.issuedAtEpochSeconds,
    expiresAtEpochSeconds: attestation.statement.expiresAtEpochSeconds,
    catalog: input.catalog,
    capability,
    predeploymentReceipt: input.predeploymentReceipt,
    reviewedPlanSha256: input.reviewedPlanSha256,
    expectedConfigurationHash: input.expectedConfigurationHash
  });
  if (canonicalizeJson(attestation.statement) !== canonicalizeJson(expectedStatement)) {
    throw new TypeError("nested-factory signed platform release left the expected artifacts");
  }
  const expectedRevocationEpoch = decimalUint(
    input.expectedRevocationEpoch,
    64,
    "expected platform release revocation epoch"
  );
  const now = BigInt(decimalUint(input.nowEpochSeconds, 64, "platform release current time"));
  if (attestation.statement.revocationEpoch !== expectedRevocationEpoch || now < BigInt(attestation.statement.issuedAtEpochSeconds) || now >= BigInt(attestation.statement.expiresAtEpochSeconds)) throw new TypeError("nested-factory signed platform release is expired or revoked");
  const publicKey = createPublicKey(
    input.publicKeyPem instanceof Uint8Array ? Buffer.from(input.publicKeyPem) : input.publicKeyPem
  );
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("nested-factory release verification key is not Ed25519");
  }
  const spki = publicKey.export({ format: "der", type: "spki" });
  if (rawSha256(Buffer.from(spki)) !== attestation.authority.publicKeySpkiSha256) {
    throw new TypeError("nested-factory release verification key left the capability binding");
  }
  const signature = decodeCanonicalBase64Url(
    attestation.signatureBase64Url,
    "nested-factory platform release signature"
  );
  if (!verifySignature(
    null,
    nestedFactoryPlatformProfileReleaseSigningBytesV1(attestation.statement),
    publicKey,
    signature
  )) throw new TypeError("nested-factory platform release signature is invalid");
  const core = {
    schemaVersion: "programmable.verified-nested-factory-platform-profile-release.v1",
    attestationHash: attestation.attestationHash,
    statementHash: attestation.statement.statementHash,
    capabilityHash: attestation.statement.capabilityHash,
    releaseRevision: attestation.statement.releaseRevision,
    revocationEpoch: attestation.statement.revocationEpoch,
    verifiedAtEpochSeconds: now.toString(10)
  };
  return deepFreeze({
    ...core,
    verificationHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertVerifiedNestedFactoryPlatformProfileReleaseV1(raw) {
  exactKeys(raw, [
    "attestationHash",
    "capabilityHash",
    "releaseRevision",
    "revocationEpoch",
    "schemaVersion",
    "statementHash",
    "verificationHash",
    "verifiedAtEpochSeconds"
  ], "verified nested-factory platform profile release");
  if (raw.schemaVersion !== "programmable.verified-nested-factory-platform-profile-release.v1" || decimalUint(raw.releaseRevision, 64, "verified release revision") === "0") throw new TypeError("verified nested-factory platform profile release is invalid");
  decimalUint(raw.revocationEpoch, 64, "verified release revocation epoch");
  decimalUint(raw.verifiedAtEpochSeconds, 64, "verified release time");
  sha256(raw.attestationHash, "verified release attestation");
  sha256(raw.statementHash, "verified release statement");
  sha256(raw.capabilityHash, "verified release capability");
  const core = { ...raw };
  delete core.verificationHash;
  if (raw.verificationHash !== canonicalSha256(raw.schemaVersion, core)) {
    throw new TypeError("verified nested-factory platform release hash is invalid");
  }
  return deepFreeze(raw);
}
function createNestedFactoryApplicantGrantV1(input) {
  const release = assertSignedNestedFactoryPlatformProfileReleaseAttestationV1(
    input.releaseAttestation
  );
  const releaseVerification = assertVerifiedNestedFactoryPlatformProfileReleaseV1(
    input.releaseVerification
  );
  const catalog = assertNestedFactoryCapabilityCatalogV1(input.catalog);
  const capability = assertNestedFactoryCapabilityV1(input.capability);
  const activation = capability.activation;
  if (activation === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory applicant grant cannot be created before activation"
    );
  }
  const acceptanceSubject = assertNestedFactoryApplicantAcceptanceSubjectV1(
    input.acceptanceSubject
  );
  const acceptanceHead = verifyCurrentNestedFactoryApplicantAcceptanceHeadV1({
    subject: acceptanceSubject,
    head: input.acceptanceHead,
    expectedCurrentAcceptanceHash: input.expectedCurrentAcceptanceHash,
    expectedClaimSha256: input.acceptanceHead.claimSha256,
    expectedApplicantAcceptanceRecordHash: input.acceptanceHead.applicantAcceptanceRecordHash
  });
  const identity = assertNestedFactoryLaunchIdentityV1(input.launchIdentity);
  const compiledRoute = assertVerifiedNestedFactoryCompiledRouteV1(input.compiledRoute);
  const resolved = resolveEnabledNestedFactoryCapabilityV1({
    catalog,
    profileId: capability.profile.profileId,
    profileVersion: capability.profile.profileVersion,
    routePayloadHash: compiledRoute.routePayloadHash,
    expectedResultHash: compiledRoute.expectedResultHash
  });
  if (releaseVerification.attestationHash !== release.attestationHash || releaseVerification.statementHash !== release.statement.statementHash || releaseVerification.capabilityHash !== capability.capabilityHash || release.statement.capabilityHash !== capability.capabilityHash || resolved.capabilityHash !== capability.capabilityHash || compiledRoute.capabilityHash !== capability.capabilityHash || compiledRoute.routePayloadHash !== identity.routePayloadHash || identity.launchWallet !== address(EXACT_SHARDS_LAUNCH_WALLET_V1, "Shards launch wallet")) throw new TypeError("nested-factory applicant grant left the verified release or launch");
  const issuedAtEpochSeconds = decimalUint(
    input.issuedAtEpochSeconds,
    64,
    "nested-factory applicant grant issue time"
  );
  const expiresAtEpochSeconds = decimalUint(
    input.expiresAtEpochSeconds,
    64,
    "nested-factory applicant grant expiry"
  );
  if (BigInt(issuedAtEpochSeconds) < BigInt(releaseVerification.verifiedAtEpochSeconds) || BigInt(expiresAtEpochSeconds) <= BigInt(issuedAtEpochSeconds) || BigInt(expiresAtEpochSeconds) > BigInt(release.statement.expiresAtEpochSeconds)) throw new TypeError("nested-factory applicant grant validity is outside the release");
  const core = {
    schemaVersion: "programmable.nested-factory-applicant-grant.v1",
    chainId: "1",
    issuedAtEpochSeconds,
    expiresAtEpochSeconds,
    releaseAttestationHash: release.attestationHash,
    releaseVerificationHash: releaseVerification.verificationHash,
    releaseStatementHash: release.statement.statementHash,
    capabilityHash: capability.capabilityHash,
    acceptanceSubjectHash: acceptanceSubject.acceptanceSubjectHash,
    currentAcceptanceHash: acceptanceHead.acceptanceHash,
    applicantAcceptanceClaimSha256: acceptanceHead.claimSha256,
    applicantAcceptanceRecordHash: acceptanceHead.applicantAcceptanceRecordHash,
    launchIdentityHash: identity.identityHash,
    launchId: identity.launchId,
    launchWallet: identity.launchWallet,
    permitNonce: identity.permitNonce,
    routePayloadHash: compiledRoute.routePayloadHash,
    expectedResultHash: compiledRoute.expectedResultHash,
    compiledRouteVerificationHash: compiledRoute.verificationHash,
    revenuePolicyHash: capability.revenuePolicyHash,
    expectedPoolId: release.statement.expectedPoolId,
    expectedConfigurationHash: release.statement.expectedConfigurationHash,
    applicantActionSelector: activation.routerDirectLaunchSelector,
    executionModePolicy: activation.executionModePolicy
  };
  return deepFreeze({
    ...core,
    grantHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryApplicantGrantV1(raw) {
  exactKeys(raw, [
    "acceptanceSubjectHash",
    "applicantAcceptanceClaimSha256",
    "applicantAcceptanceRecordHash",
    "applicantActionSelector",
    "capabilityHash",
    "chainId",
    "compiledRouteVerificationHash",
    "currentAcceptanceHash",
    "executionModePolicy",
    "expectedConfigurationHash",
    "expectedPoolId",
    "expectedResultHash",
    "expiresAtEpochSeconds",
    "grantHash",
    "issuedAtEpochSeconds",
    "launchId",
    "launchIdentityHash",
    "launchWallet",
    "permitNonce",
    "releaseAttestationHash",
    "releaseStatementHash",
    "releaseVerificationHash",
    "revenuePolicyHash",
    "routePayloadHash",
    "schemaVersion"
  ], "nested-factory applicant grant");
  if (raw.schemaVersion !== "programmable.nested-factory-applicant-grant.v1" || raw.chainId !== "1" || raw.launchWallet !== address(EXACT_SHARDS_LAUNCH_WALLET_V1, "Shards launch wallet") || raw.permitNonce !== raw.launchId || raw.revenuePolicyHash !== EXACT_SHARDS_REVENUE_POLICY_HASH_V1 || raw.expectedPoolId !== EXACT_SHARDS_POOL_ID_V1 || raw.expectedConfigurationHash !== EXACT_SHARDS_CONFIGURATION_HASH_V1 || canonicalizeJson(canonicalExecutionModePolicy(raw.executionModePolicy)) !== canonicalizeJson(NESTED_FACTORY_EXECUTION_MODE_POLICY_V1) || selector(raw.applicantActionSelector, "applicant grant action selector") !== raw.applicantActionSelector) throw new TypeError("nested-factory applicant grant is invalid");
  const issued = BigInt(decimalUint(raw.issuedAtEpochSeconds, 64, "grant issue time"));
  const expires = BigInt(decimalUint(raw.expiresAtEpochSeconds, 64, "grant expiry"));
  if (expires <= issued) throw new TypeError("nested-factory applicant grant is expired at issue");
  for (const value of [
    raw.releaseAttestationHash,
    raw.releaseVerificationHash,
    raw.releaseStatementHash,
    raw.capabilityHash,
    raw.acceptanceSubjectHash,
    raw.currentAcceptanceHash,
    raw.applicantAcceptanceClaimSha256,
    raw.applicantAcceptanceRecordHash,
    raw.launchIdentityHash,
    raw.compiledRouteVerificationHash
  ]) sha256(value, "nested-factory applicant grant hash binding");
  for (const value of [
    raw.launchId,
    raw.routePayloadHash,
    raw.expectedResultHash,
    raw.revenuePolicyHash
  ]) nonzeroBytes32(value, "nested-factory applicant grant EVM hash binding");
  const core = { ...raw };
  delete core.grantHash;
  if (raw.grantHash !== canonicalSha256(raw.schemaVersion, core)) {
    throw new TypeError("nested-factory applicant grant hash is invalid");
  }
  return deepFreeze(raw);
}
function createNestedFactoryLaunchPreflightV1(input) {
  const grant = assertNestedFactoryApplicantGrantV1(input.grant);
  const acceptanceHead = verifyCurrentNestedFactoryApplicantAcceptanceHeadV1({
    subject: input.acceptanceSubject,
    head: input.acceptanceHead,
    expectedCurrentAcceptanceHash: input.expectedCurrentAcceptanceHash,
    expectedClaimSha256: grant.applicantAcceptanceClaimSha256,
    expectedApplicantAcceptanceRecordHash: grant.applicantAcceptanceRecordHash
  });
  const currentness = assertNestedFactoryCurrentnessEvidenceV1(input.currentness);
  const gasEvidence = assertNestedFactoryGasEvidenceV1(input.gasEvidence);
  const actionCore = {
    from: address(input.browserAction.from, "nested-factory browser action sender"),
    to: address(input.browserAction.to, "nested-factory browser action target"),
    data: rpcHex(input.browserAction.data, "nested-factory browser action calldata"),
    value: rpcQuantity(input.browserAction.value, "nested-factory browser action value")
  };
  const actionData = boundedHexBytes(actionCore.data, 1048576, "browser action calldata");
  const actionSelector = `0x${Buffer.from(actionData.slice(0, 4)).toString("hex")}`;
  if (acceptanceHead.acceptanceHash !== grant.currentAcceptanceHash || currentness.capabilityHash !== grant.capabilityHash || currentness.launchIdentityHash !== grant.launchIdentityHash || gasEvidence.capabilityHash !== grant.capabilityHash || gasEvidence.launchIdentityHash !== grant.launchIdentityHash || gasEvidence.currentnessEvidenceHash !== currentness.evidenceHash || gasEvidence.executionMode !== currentness.executionMode || gasEvidence.executionMode !== currentness.executionMode || canonicalizeJson(grant.executionModePolicy) !== canonicalizeJson(NESTED_FACTORY_EXECUTION_MODE_POLICY_V1) || actionCore.from !== grant.launchWallet || actionCore.to !== gasEvidence.router || actionSelector !== grant.applicantActionSelector || keccakBytes(actionData) !== gasEvidence.transactionCalldataHash || actionData.byteLength !== gasEvidence.transactionCalldataBytes || BigInt(actionCore.value) !== BigInt(gasEvidence.transactionValue)) throw new TypeError("nested-factory launch preflight left the exact current browser action");
  const issuedAtEpochSeconds = decimalUint(
    input.issuedAtEpochSeconds,
    64,
    "nested-factory launch preflight issue time"
  );
  const expiresAtEpochSeconds = decimalUint(
    input.expiresAtEpochSeconds,
    64,
    "nested-factory launch preflight expiry"
  );
  const issued = BigInt(issuedAtEpochSeconds);
  const expires = BigInt(expiresAtEpochSeconds);
  const chainMinimum = BigInt(currentness.chainClock.minimumTimestamp);
  const chainMaximum = BigInt(currentness.chainClock.maximumTimestamp);
  if (expires <= issued || expires - issued > NESTED_FACTORY_MAXIMUM_LAUNCH_PREFLIGHT_LIFETIME_SECONDS_V1 || issued < BigInt(grant.issuedAtEpochSeconds) || expires > BigInt(grant.expiresAtEpochSeconds) || issued < chainMinimum || issued > chainMaximum + 120n || expires <= chainMaximum) throw new TypeError("nested-factory launch preflight is not live and short-lived");
  const browserAction = deepFreeze({
    ...actionCore,
    actionHash: canonicalSha256("programmable.nested-factory-browser-action.v1", actionCore)
  });
  const core = {
    schemaVersion: "programmable.nested-factory-launch-preflight.v1",
    chainId: "1",
    issuedAtEpochSeconds,
    expiresAtEpochSeconds,
    grantHash: grant.grantHash,
    releaseAttestationHash: grant.releaseAttestationHash,
    acceptanceSubjectHash: grant.acceptanceSubjectHash,
    currentAcceptanceHash: grant.currentAcceptanceHash,
    capabilityHash: grant.capabilityHash,
    launchId: grant.launchId,
    permitNonce: grant.permitNonce,
    executionMode: currentness.executionMode,
    executionModePolicy: grant.executionModePolicy,
    browserAction,
    currentnessEvidenceHash: currentness.evidenceHash,
    gasEvidenceHash: gasEvidence.evidenceHash,
    maximumLiveGasEstimate: gasEvidence.maximumEstimate,
    bufferedGasLimit: gasEvidence.bufferedGasLimit,
    mainnetTransactionGasLimit: gasEvidence.mainnetTransactionGasLimit
  };
  return deepFreeze({
    ...core,
    preflightHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryLaunchPreflightV1(raw) {
  exactKeys(raw, [
    "acceptanceSubjectHash",
    "browserAction",
    "bufferedGasLimit",
    "capabilityHash",
    "chainId",
    "currentAcceptanceHash",
    "currentnessEvidenceHash",
    "executionMode",
    "executionModePolicy",
    "expiresAtEpochSeconds",
    "gasEvidenceHash",
    "grantHash",
    "issuedAtEpochSeconds",
    "launchId",
    "mainnetTransactionGasLimit",
    "maximumLiveGasEstimate",
    "permitNonce",
    "preflightHash",
    "releaseAttestationHash",
    "schemaVersion"
  ], "nested-factory launch preflight");
  exactKeys(
    raw.browserAction,
    ["actionHash", "data", "from", "to", "value"],
    "nested-factory preflight browser action"
  );
  const actionCore = {
    from: address(raw.browserAction.from, "preflight browser action sender"),
    to: address(raw.browserAction.to, "preflight browser action target"),
    data: rpcHex(raw.browserAction.data, "preflight browser action calldata"),
    value: rpcQuantity(raw.browserAction.value, "preflight browser action value")
  };
  if (raw.schemaVersion !== "programmable.nested-factory-launch-preflight.v1" || raw.chainId !== "1" || raw.permitNonce !== raw.launchId || !isNestedFactoryExecutionModeV1(raw.executionMode) || canonicalizeJson(canonicalExecutionModePolicy(raw.executionModePolicy)) !== canonicalizeJson(NESTED_FACTORY_EXECUTION_MODE_POLICY_V1) || raw.mainnetTransactionGasLimit !== "16777216" || BigInt(decimalUint(raw.bufferedGasLimit, 64, "preflight buffered gas")) > NESTED_FACTORY_MAINNET_TRANSACTION_GAS_LIMIT_V1 || raw.browserAction.actionHash !== canonicalSha256("programmable.nested-factory-browser-action.v1", actionCore)) throw new TypeError("nested-factory launch preflight policy is invalid");
  const issued = BigInt(decimalUint(raw.issuedAtEpochSeconds, 64, "preflight issue time"));
  const expires = BigInt(decimalUint(raw.expiresAtEpochSeconds, 64, "preflight expiry"));
  if (expires <= issued || expires - issued > NESTED_FACTORY_MAXIMUM_LAUNCH_PREFLIGHT_LIFETIME_SECONDS_V1) throw new TypeError("nested-factory launch preflight validity is invalid");
  decimalUint(raw.maximumLiveGasEstimate, 64, "preflight maximum gas estimate");
  for (const value of [
    raw.grantHash,
    raw.releaseAttestationHash,
    raw.acceptanceSubjectHash,
    raw.currentAcceptanceHash,
    raw.capabilityHash,
    raw.currentnessEvidenceHash,
    raw.gasEvidenceHash
  ]) sha256(value, "nested-factory launch preflight hash binding");
  const core = { ...raw };
  delete core.preflightHash;
  if (raw.preflightHash !== canonicalSha256(raw.schemaVersion, core)) {
    throw new TypeError("nested-factory launch preflight hash is invalid");
  }
  return deepFreeze(raw);
}
function createNestedFactoryPermitReservationV1(input) {
  const capability = assertNestedFactoryCapabilityV1(input.capability);
  const activation = capability.activation;
  if (activation === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory permit cannot be reserved before production activation"
    );
  }
  const catalog = assertNestedFactoryCapabilityCatalogV1(input.catalog);
  const identity = assertNestedFactoryLaunchIdentityV1(input.launchIdentity);
  const compiledRoute = assertVerifiedNestedFactoryCompiledRouteV1(input.compiledRoute);
  const currentness = assertNestedFactoryCurrentnessEvidenceV1(input.currentness);
  const gasEvidence = assertNestedFactoryGasEvidenceV1(input.gasEvidence);
  const applicantGrant = assertNestedFactoryApplicantGrantV1(input.applicantGrant);
  const launchPreflight = assertNestedFactoryLaunchPreflightV1(input.launchPreflight);
  assertAuthorityStatesMatchActivation(currentness.authorityStates, activation);
  if (compiledRoute.capabilityHash !== capability.capabilityHash || compiledRoute.routePayloadHash !== identity.routePayloadHash || currentness.capabilityHash !== capability.capabilityHash || currentness.launchIdentityHash !== identity.identityHash || gasEvidence.capabilityHash !== capability.capabilityHash || gasEvidence.launchIdentityHash !== identity.identityHash || gasEvidence.currentnessEvidenceHash !== currentness.evidenceHash || gasEvidence.rpcBindingHash !== currentness.rpcBindingHash || gasEvidence.router !== activation.router.address || gasEvidence.launchWallet !== identity.launchWallet || applicantGrant.capabilityHash !== capability.capabilityHash || applicantGrant.launchIdentityHash !== identity.identityHash || applicantGrant.compiledRouteVerificationHash !== compiledRoute.verificationHash || canonicalizeJson(applicantGrant.executionModePolicy) !== canonicalizeJson(activation.executionModePolicy) || launchPreflight.grantHash !== applicantGrant.grantHash || launchPreflight.capabilityHash !== capability.capabilityHash || launchPreflight.launchId !== identity.launchId || launchPreflight.permitNonce !== identity.permitNonce || launchPreflight.currentnessEvidenceHash !== currentness.evidenceHash || launchPreflight.gasEvidenceHash !== gasEvidence.evidenceHash || canonicalizeJson(launchPreflight.executionModePolicy) !== canonicalizeJson(activation.executionModePolicy)) throw new TypeError("nested-factory ceremony artifacts do not share one exact launch binding");
  resolveEnabledNestedFactoryCapabilityV1({
    catalog,
    profileId: capability.profile.profileId,
    profileVersion: capability.profile.profileVersion,
    routePayloadHash: compiledRoute.routePayloadHash,
    expectedResultHash: compiledRoute.expectedResultHash
  });
  const validAfter = decimalUint(input.validAfter, 64, "nested-factory permit valid-after");
  const deadline = decimalUint(input.deadline, 64, "nested-factory permit deadline");
  const minimum = BigInt(currentness.chainClock.minimumTimestamp);
  const maximum = BigInt(currentness.chainClock.maximumTimestamp);
  if (maximum >= BigInt(launchPreflight.expiresAtEpochSeconds)) {
    throw new TypeError("nested-factory launch preflight expired before permit reservation");
  }
  if (BigInt(validAfter) > BigInt(deadline) || BigInt(deadline) - BigInt(validAfter) > NESTED_FACTORY_MAXIMUM_PERMIT_LIFETIME_SECONDS_V1 || minimum < BigInt(validAfter) || maximum > BigInt(deadline) || BigInt(deadline) - maximum < NESTED_FACTORY_MINIMUM_REMAINING_PERMIT_SECONDS_V1) throw new TypeError("nested-factory permit lifetime is not live within the one-hour rule");
  const current = input.currentReservation === null ? null : assertNestedFactoryPermitReservationV1(input.currentReservation);
  const expectedPrevious = input.expectedPreviousReservationHash === null ? null : sha256(input.expectedPreviousReservationHash, "expected permit reservation predecessor");
  if (expectedPrevious !== (current?.reservationHash ?? null)) {
    throw new TypeError("nested-factory permit reservation CAS predecessor is stale");
  }
  if (current !== null && (current.launchId !== identity.launchId || minimum <= BigInt(current.deadline) || BigInt(currentness.finalizedAnchor.timestamp) <= BigInt(current.deadline) || BigInt(validAfter) <= BigInt(current.deadline))) throw new TypeError("nested-factory permit reservation would overlap the prior permit");
  const core = {
    schemaVersion: "programmable.nested-factory-permit-reservation.v1",
    launchId: identity.launchId,
    revision: (current === null ? 1n : BigInt(current.revision) + 1n).toString(10),
    previousReservationHash: current?.reservationHash ?? null,
    router: activation.router.address,
    permitNonce: identity.permitNonce,
    permitDigest: nonzeroBytes32(input.permitDigest, "nested-factory permit digest"),
    executionModePolicy: activation.executionModePolicy,
    validAfter,
    deadline,
    capabilityHash: capability.capabilityHash,
    compiledRouteVerificationHash: compiledRoute.verificationHash,
    currentnessEvidenceHash: currentness.evidenceHash,
    gasEvidenceHash: gasEvidence.evidenceHash,
    applicantGrantHash: applicantGrant.grantHash,
    launchPreflightHash: launchPreflight.preflightHash,
    currentAcceptanceHash: applicantGrant.currentAcceptanceHash,
    applicantAcceptanceRecordHash: applicantGrant.applicantAcceptanceRecordHash,
    ownerSignatureRequest: null
  };
  return deepFreeze({
    ...core,
    reservationHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryPermitReservationV1(raw) {
  exactKeys(raw, [
    "applicantAcceptanceRecordHash",
    "applicantGrantHash",
    "capabilityHash",
    "compiledRouteVerificationHash",
    "currentAcceptanceHash",
    "currentnessEvidenceHash",
    "deadline",
    "executionModePolicy",
    "gasEvidenceHash",
    "launchId",
    "ownerSignatureRequest",
    "permitDigest",
    "launchPreflightHash",
    "permitNonce",
    "previousReservationHash",
    "reservationHash",
    "revision",
    "router",
    "schemaVersion",
    "validAfter"
  ], "nested-factory permit reservation");
  const core = { ...raw };
  delete core.reservationHash;
  if (raw.schemaVersion !== "programmable.nested-factory-permit-reservation.v1" || raw.ownerSignatureRequest !== null || raw.permitNonce !== raw.launchId || canonicalizeJson(canonicalExecutionModePolicy(raw.executionModePolicy)) !== canonicalizeJson(NESTED_FACTORY_EXECUTION_MODE_POLICY_V1) || decimalUint(raw.revision, 64, "permit reservation revision") === "0" || BigInt(decimalUint(raw.validAfter, 64, "permit reservation valid-after")) > BigInt(decimalUint(raw.deadline, 64, "permit reservation deadline")) || BigInt(raw.deadline) - BigInt(raw.validAfter) > NESTED_FACTORY_MAXIMUM_PERMIT_LIFETIME_SECONDS_V1 || raw.reservationHash !== canonicalSha256(raw.schemaVersion, core)) throw new TypeError("nested-factory permit reservation is invalid");
  nonzeroBytes32(raw.launchId, "permit reservation launch id");
  address(raw.router, "permit reservation Router");
  nonzeroBytes32(raw.permitDigest, "permit reservation digest");
  sha256(raw.capabilityHash, "permit reservation capability");
  sha256(raw.compiledRouteVerificationHash, "permit reservation compiled route");
  sha256(raw.currentnessEvidenceHash, "permit reservation currentness");
  sha256(raw.gasEvidenceHash, "permit reservation gas evidence");
  sha256(raw.applicantGrantHash, "permit reservation applicant grant");
  sha256(raw.launchPreflightHash, "permit reservation launch preflight");
  sha256(raw.currentAcceptanceHash, "permit reservation current acceptance");
  sha256(raw.applicantAcceptanceRecordHash, "permit reservation acceptance");
  if (raw.previousReservationHash !== null) {
    sha256(raw.previousReservationHash, "permit reservation predecessor");
  }
  return deepFreeze(raw);
}
async function verifyNestedFactoryLaunchFinalityEvidenceV1(input) {
  const capability = assertNestedFactoryCapabilityV1(input.capability);
  const activation = capability.activation;
  if (activation === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory finality cannot be proven for a disabled capability"
    );
  }
  const catalog = assertNestedFactoryCapabilityCatalogV1(input.catalog);
  const identity = assertNestedFactoryLaunchIdentityV1(input.launchIdentity);
  const compiledRoute = assertVerifiedNestedFactoryCompiledRouteV1(input.compiledRoute);
  const applicantGrant = assertNestedFactoryApplicantGrantV1(input.applicantGrant);
  const preflight = assertNestedFactoryLaunchPreflightV1(input.launchPreflight);
  const reservation = assertNestedFactoryPermitReservationV1(input.permitReservation);
  resolveEnabledNestedFactoryCapabilityV1({
    catalog,
    profileId: capability.profile.profileId,
    profileVersion: capability.profile.profileVersion,
    routePayloadHash: compiledRoute.routePayloadHash,
    expectedResultHash: compiledRoute.expectedResultHash
  });
  if (compiledRoute.capabilityHash !== capability.capabilityHash || identity.routePayloadHash !== compiledRoute.routePayloadHash || applicantGrant.capabilityHash !== capability.capabilityHash || applicantGrant.launchIdentityHash !== identity.identityHash || applicantGrant.compiledRouteVerificationHash !== compiledRoute.verificationHash || applicantGrant.launchId !== identity.launchId || applicantGrant.permitNonce !== identity.permitNonce || applicantGrant.applicantActionSelector !== activation.routerDirectLaunchSelector || preflight.grantHash !== applicantGrant.grantHash || preflight.capabilityHash !== capability.capabilityHash || preflight.launchId !== identity.launchId || preflight.permitNonce !== identity.permitNonce || reservation.router !== activation.router.address || reservation.launchId !== identity.launchId || reservation.permitNonce !== identity.permitNonce || reservation.capabilityHash !== capability.capabilityHash || reservation.compiledRouteVerificationHash !== compiledRoute.verificationHash || reservation.applicantGrantHash !== applicantGrant.grantHash || reservation.launchPreflightHash !== preflight.preflightHash || canonicalizeJson(reservation.executionModePolicy) !== canonicalizeJson(activation.executionModePolicy) || canonicalizeJson(preflight.executionModePolicy) !== canonicalizeJson(activation.executionModePolicy)) throw new TypeError("nested-factory finality inputs left the exact ceremony binding");
  const transactionHash = nonzeroBytes32(
    input.transactionHash,
    "nested-factory launch transaction hash"
  );
  const [transactionValue, receiptValue, finalizedAnchor] = await Promise.all([
    input.rpc.readConsensus("eth_getTransactionByHash", [transactionHash]),
    input.rpc.readConsensus("eth_getTransactionReceipt", [transactionHash]),
    input.rpc.collectCommonFinalizedAnchor()
  ]);
  const transaction = record(transactionValue, "nested-factory launch transaction");
  const receipt = record(receiptValue, "nested-factory launch receipt");
  const transactionFrom = address(transaction.from, "nested-factory launch sender");
  const transactionTo = address(transaction.to, "nested-factory launch target");
  const transactionInput = rpcHex(transaction.input, "nested-factory launch calldata");
  const inputBytes = boundedHexBytes(
    transactionInput,
    1048576,
    "nested-factory finalized transaction calldata"
  );
  const blockNumber = rpcQuantity(transaction.blockNumber, "nested-factory launch block number");
  const blockHash = nonzeroBytes32(transaction.blockHash, "nested-factory launch block hash");
  const transactionIndex = rpcQuantity(
    transaction.transactionIndex,
    "nested-factory launch transaction index"
  );
  const transactionNonce = rpcQuantity(
    transaction.nonce,
    "nested-factory launch transaction nonce"
  );
  if (nonzeroBytes32(transaction.hash, "nested-factory observed transaction hash") !== transactionHash || transactionFrom !== identity.launchWallet || transactionTo !== activation.router.address || transactionInput !== preflight.browserAction.data || transactionInput.slice(0, 10) !== activation.routerDirectLaunchSelector || transactionFrom !== preflight.browserAction.from || transactionTo !== preflight.browserAction.to || rpcQuantity(transaction.value, "nested-factory launch transaction value") !== "0x0" || preflight.browserAction.value !== "0x0" || BigInt(blockNumber) > BigInt(finalizedAnchor.blockNumber)) throw new TypeError("finalized nested-factory transaction left the exact browser action");
  if (nonzeroBytes32(receipt.transactionHash, "nested-factory receipt transaction hash") !== transactionHash || address(receipt.from, "nested-factory receipt sender") !== transactionFrom || address(receipt.to, "nested-factory receipt target") !== transactionTo || nonzeroBytes32(receipt.blockHash, "nested-factory receipt block hash") !== blockHash || rpcQuantity(receipt.blockNumber, "nested-factory receipt block number") !== blockNumber || rpcQuantity(receipt.transactionIndex, "nested-factory receipt transaction index") !== transactionIndex || rpcQuantity(receipt.status, "nested-factory receipt status") !== "0x1" || receipt.contractAddress !== null) throw new TypeError("nested-factory launch receipt is not the exact successful transaction");
  const canonicalBlock = record(await input.rpc.readConsensus(
    "eth_getBlockByNumber",
    [blockNumber, false]
  ), "nested-factory canonical finalized receipt block");
  const blockTimestamp = BigInt(rpcQuantity(
    canonicalBlock.timestamp,
    "nested-factory receipt block timestamp"
  )).toString(10);
  if (nonzeroBytes32(canonicalBlock.hash, "nested-factory canonical block hash") !== blockHash || rpcQuantity(canonicalBlock.number, "nested-factory canonical block number") !== blockNumber || BigInt(blockTimestamp) < BigInt(reservation.validAfter) || BigInt(blockTimestamp) > BigInt(reservation.deadline) || BigInt(blockTimestamp) > BigInt(preflight.expiresAtEpochSeconds)) throw new TypeError("nested-factory transaction is outside canonical live ceremony time");
  const logs = receiptLogs(
    receipt.logs,
    transactionHash,
    blockNumber,
    blockHash,
    transactionIndex
  );
  const routeEvent = exactNestedFactoryRouteStampedEventV2({
    logs,
    router: activation.router.address,
    identity,
    capability,
    compiledRoute,
    permitDigest: reservation.permitDigest
  });
  const executionMode = routeEvent.executionMode;
  const stampHash = computeNestedFactoryLaunchStampHashV1({
    permitDigest: reservation.permitDigest,
    launchId: identity.launchId,
    executionMode
  });
  const launchEvent = exactNestedFactoryLaunchStampedEventV2({
    logs,
    router: activation.router.address,
    launchId: identity.launchId,
    stampHash,
    executionMode
  });
  if (BigInt(launchEvent.logIndex) !== BigInt(routeEvent.log.logIndex) + 1n) {
    throw new TypeError("nested-factory terminal stamp events are not consecutive");
  }
  const finalizedStampRecord = await verifyNestedFactoryRouterReadbacksV1({
    rpc: input.rpc,
    activation,
    capability,
    identity,
    compiledRoute,
    permitDigest: reservation.permitDigest,
    stampHash,
    executionMode,
    blockTag: finalizedAnchor.blockNumber
  });
  const latestStampRecord = await verifyNestedFactoryRouterReadbacksV1({
    rpc: input.rpc,
    activation,
    capability,
    identity,
    compiledRoute,
    permitDigest: reservation.permitDigest,
    stampHash,
    executionMode,
    blockTag: "latest"
  });
  if (latestStampRecord !== finalizedStampRecord) {
    throw new TypeError("nested-factory finalized and latest stamp records disagree");
  }
  const stampRecordHash = canonicalSha256(
    "programmable.nested-factory-launch-stamp-record.v1",
    { encodedRecord: finalizedStampRecord }
  );
  const binding = input.rpc.binding();
  if (canonicalizeJson([...finalizedAnchor.providerIds].sort(compareUtf8)) !== canonicalizeJson(binding.providers.map(({ providerId }) => providerId).sort(compareUtf8))) throw new TypeError("nested-factory finality provider set left the RPC authority binding");
  const core = {
    schemaVersion: "programmable.nested-factory-launch-finality-evidence.v1",
    chainId: "1",
    terminalStatus: "FINALIZED_SUCCESS",
    executionMode,
    executionModePolicy: activation.executionModePolicy,
    transactionHash,
    transactionNonce,
    transactionFrom,
    transactionTo,
    transactionInputBytes: inputBytes.byteLength,
    transactionInputHash: keccakBytes(inputBytes),
    transactionValue: "0",
    blockNumber,
    blockHash,
    blockTimestamp,
    finalizedAnchorHash: finalizedAnchor.anchorHash,
    rpcBindingHash: binding.bindingHash,
    capabilityHash: capability.capabilityHash,
    launchIdentityHash: identity.identityHash,
    applicantGrantHash: applicantGrant.grantHash,
    launchPreflightHash: preflight.preflightHash,
    permitReservationHash: reservation.reservationHash,
    launchId: identity.launchId,
    permitDigest: reservation.permitDigest,
    stampHash,
    routeStampedLogIndex: routeEvent.log.logIndex,
    routeStampedLogHash: routeEvent.log.logHash,
    launchStampedLogIndex: launchEvent.logIndex,
    launchStampedLogHash: launchEvent.logHash,
    stampRecordHash,
    routerReadbackState: "exact-stamp-indices-nonce-digest-matched-finalized-and-latest",
    componentRuntimeState: "exact-finalized-and-latest",
    finalityState: "matched-finalized-canonical-router-transaction"
  };
  return deepFreeze({
    ...core,
    evidenceHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryLaunchFinalityEvidenceV1(raw) {
  exactKeys(raw, [
    "applicantGrantHash",
    "blockHash",
    "blockNumber",
    "blockTimestamp",
    "capabilityHash",
    "chainId",
    "componentRuntimeState",
    "evidenceHash",
    "executionMode",
    "executionModePolicy",
    "finalityState",
    "finalizedAnchorHash",
    "launchId",
    "launchIdentityHash",
    "launchPreflightHash",
    "launchStampedLogHash",
    "launchStampedLogIndex",
    "permitDigest",
    "permitReservationHash",
    "routeStampedLogHash",
    "routeStampedLogIndex",
    "routerReadbackState",
    "rpcBindingHash",
    "schemaVersion",
    "stampHash",
    "stampRecordHash",
    "terminalStatus",
    "transactionFrom",
    "transactionHash",
    "transactionInputBytes",
    "transactionInputHash",
    "transactionNonce",
    "transactionTo",
    "transactionValue"
  ], "nested-factory launch finality evidence");
  const expectedStampHash = computeNestedFactoryLaunchStampHashV1({
    permitDigest: raw.permitDigest,
    launchId: raw.launchId,
    executionMode: raw.executionMode
  });
  const core = { ...raw };
  delete core.evidenceHash;
  if (raw.schemaVersion !== "programmable.nested-factory-launch-finality-evidence.v1" || raw.chainId !== "1" || raw.terminalStatus !== "FINALIZED_SUCCESS" || !isNestedFactoryExecutionModeV1(raw.executionMode) || canonicalizeJson(canonicalExecutionModePolicy(raw.executionModePolicy)) !== canonicalizeJson(NESTED_FACTORY_EXECUTION_MODE_POLICY_V1) || raw.transactionFrom !== address(EXACT_SHARDS_LAUNCH_WALLET_V1, "launch wallet") || raw.transactionValue !== "0" || raw.transactionInputBytes < 4 || raw.transactionInputBytes > 1048576 || raw.stampHash !== expectedStampHash || BigInt(raw.launchStampedLogIndex) !== BigInt(raw.routeStampedLogIndex) + 1n || raw.routerReadbackState !== "exact-stamp-indices-nonce-digest-matched-finalized-and-latest" || raw.componentRuntimeState !== "exact-finalized-and-latest" || raw.finalityState !== "matched-finalized-canonical-router-transaction" || raw.evidenceHash !== canonicalSha256(raw.schemaVersion, core)) throw new TypeError("nested-factory launch finality evidence is invalid");
  address(raw.transactionTo, "finality Router");
  nonzeroBytes32(raw.transactionHash, "finality transaction hash");
  nonzeroBytes32(raw.transactionInputHash, "finality transaction input hash");
  rpcQuantity(raw.transactionNonce, "finality transaction nonce");
  rpcQuantity(raw.blockNumber, "finality block number");
  nonzeroBytes32(raw.blockHash, "finality block hash");
  decimalUint(raw.blockTimestamp, 64, "finality block timestamp");
  rpcQuantity(raw.routeStampedLogIndex, "finality route event log index");
  rpcQuantity(raw.launchStampedLogIndex, "finality launch event log index");
  for (const value of [
    raw.finalizedAnchorHash,
    raw.rpcBindingHash,
    raw.capabilityHash,
    raw.launchIdentityHash,
    raw.applicantGrantHash,
    raw.launchPreflightHash,
    raw.permitReservationHash,
    raw.routeStampedLogHash,
    raw.launchStampedLogHash,
    raw.stampRecordHash
  ]) sha256(value, "nested-factory finality hash binding");
  return deepFreeze(raw);
}
function createNestedFactoryCapabilityV1(input) {
  const profileId = identifier(input.profile.profileId, "capability profile id");
  const profileVersion = identifier(input.profile.profileVersion, "capability profile version");
  const profile = deepFreeze({
    profileId,
    profileVersion,
    profileIdHash: hashText(profileId),
    profileVersionHash: hashText(profileVersion),
    profileKey: computeNestedFactoryProfileKeyV1({ profileId, profileVersion })
  });
  const activation = input.activation === null ? null : canonicalActivation(input.activation);
  if (input.state === "enabled" !== (activation !== null)) {
    throw new TypeError("nested-factory capability state does not match its activation binding");
  }
  const core = {
    schemaVersion: "programmable.nested-factory-capability.v1",
    catalogVersion: NESTED_FACTORY_CAPABILITY_CATALOG_VERSION_V1,
    capabilityId: identifier(input.capabilityId, "nested-factory capability id"),
    state: input.state,
    chainId: "1",
    routeId: NESTED_FACTORY_ROUTE_ID_V1,
    routeVersion: NESTED_FACTORY_ROUTE_VERSION_V1,
    profile,
    profileSha256: input.profileSha256 === null ? null : sha256(input.profileSha256, "nested-factory profile"),
    planSchemaId: NESTED_FACTORY_REVIEWED_PLAN_SCHEMA_ID_V1,
    sourceRevisionHash: nonzeroBytes32(input.sourceRevisionHash, "source revision hash"),
    manifestHash: nonzeroBytes32(input.manifestHash, "manifest hash"),
    revenuePolicyHash: nonzeroBytes32(input.revenuePolicyHash, "revenue policy hash"),
    poolManager: address(input.poolManager, "nested-factory PoolManager"),
    poolManagerRuntimeCodeHash: nonzeroBytes32(
      input.poolManagerRuntimeCodeHash,
      "nested-factory PoolManager runtime hash"
    ),
    activation
  };
  if (core.state === "enabled" && core.profileSha256 === null) {
    throw new TypeError("enabled nested-factory capability lacks a frozen profile artifact");
  }
  return deepFreeze({
    ...core,
    capabilityHash: canonicalSha256(core.schemaVersion, core)
  });
}
function createNestedFactoryCapabilityCatalogV1(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 32) {
    throw new TypeError("nested-factory capability catalog size is invalid");
  }
  const normalized = entries.map(assertNestedFactoryCapabilityV1).sort((left, right) => compareUtf8(left.capabilityId, right.capabilityId));
  if (new Set(normalized.map(({ capabilityId }) => capabilityId)).size !== normalized.length) {
    throw new TypeError("nested-factory capability catalog contains duplicate capability ids");
  }
  const routeKeys = normalized.map(({ chainId, routeId, routeVersion, profile }) => `${chainId}:${routeId}:${routeVersion}:${profile.profileKey}`);
  if (new Set(routeKeys).size !== routeKeys.length) {
    throw new TypeError("nested-factory capability catalog contains duplicate route profiles");
  }
  const core = {
    schemaVersion: "programmable.nested-factory-capability-catalog.v1",
    catalogVersion: NESTED_FACTORY_CAPABILITY_CATALOG_VERSION_V1,
    entries: deepFreeze(normalized)
  };
  return deepFreeze({
    ...core,
    catalogHash: canonicalSha256(core.schemaVersion, core)
  });
}
function resolveEnabledNestedFactoryCapabilityV1(input) {
  const catalog = assertNestedFactoryCapabilityCatalogV1(input.catalog);
  const profileKey = computeNestedFactoryProfileKeyV1({
    profileId: input.profileId,
    profileVersion: input.profileVersion
  });
  const routePayloadHash = nonzeroBytes32(input.routePayloadHash, "capability route payload hash");
  const expectedResultHash = nonzeroBytes32(input.expectedResultHash, "capability result hash");
  const capability = catalog.entries.find((entry) => entry.chainId === "1" && entry.routeId === NESTED_FACTORY_ROUTE_ID_V1 && entry.routeVersion === NESTED_FACTORY_ROUTE_VERSION_V1 && entry.profile.profileKey === profileKey);
  if (capability === void 0) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_PROFILE_UNSUPPORTED",
      "nested-factory route profile is not present in the signed catalog"
    );
  }
  if (capability.state !== "enabled" || capability.activation === null) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_CAPABILITY_DISABLED",
      "nested-factory route profile is present but not production-enabled"
    );
  }
  if (!capability.activation.permittedRoutes.some((route) => route.routePayloadHash === routePayloadHash && route.expectedResultHash === expectedResultHash)) {
    throw new NestedFactoryCapabilityError(
      "NESTED_FACTORY_ROUTE_BINDING_UNSUPPORTED",
      "nested-factory route/result binding is not release-enabled"
    );
  }
  return capability;
}
function assertNestedFactoryCapabilityV1(raw) {
  exactKeys(raw, [
    "activation",
    "capabilityHash",
    "capabilityId",
    "catalogVersion",
    "chainId",
    "manifestHash",
    "planSchemaId",
    "poolManager",
    "poolManagerRuntimeCodeHash",
    "profile",
    "profileSha256",
    "revenuePolicyHash",
    "routeId",
    "routeVersion",
    "schemaVersion",
    "sourceRevisionHash",
    "state"
  ], "nested-factory capability");
  const rebuilt = createNestedFactoryCapabilityV1({
    capabilityId: raw.capabilityId,
    state: raw.state,
    profile: raw.profile,
    profileSha256: raw.profileSha256,
    sourceRevisionHash: raw.sourceRevisionHash,
    manifestHash: raw.manifestHash,
    revenuePolicyHash: raw.revenuePolicyHash,
    poolManager: raw.poolManager,
    poolManagerRuntimeCodeHash: raw.poolManagerRuntimeCodeHash,
    activation: raw.activation
  });
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt)) {
    throw new TypeError("nested-factory capability hash or canonical fields are invalid");
  }
  return rebuilt;
}
function assertNestedFactoryCapabilityCatalogV1(raw) {
  exactKeys(
    raw,
    ["catalogHash", "catalogVersion", "entries", "schemaVersion"],
    "nested-factory capability catalog"
  );
  if (raw.schemaVersion !== "programmable.nested-factory-capability-catalog.v1" || raw.catalogVersion !== NESTED_FACTORY_CAPABILITY_CATALOG_VERSION_V1 || !Array.isArray(raw.entries)) {
    throw new TypeError("nested-factory capability catalog identity is invalid");
  }
  const rebuilt = createNestedFactoryCapabilityCatalogV1(raw.entries);
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt)) {
    throw new TypeError("nested-factory capability catalog hash is invalid");
  }
  return rebuilt;
}
function createWebsiteGithubSessionAuthorityV1(input) {
  const observedAtEpochSeconds = decimalUint(
    input.observedAtEpochSeconds,
    64,
    "Website GitHub session observation time"
  );
  const expiresAtEpochSeconds = decimalUint(
    input.expiresAtEpochSeconds,
    64,
    "Website GitHub session expiry"
  );
  if (BigInt(expiresAtEpochSeconds) <= BigInt(observedAtEpochSeconds)) {
    throw new TypeError("Website GitHub session authority is already expired");
  }
  const core = {
    schemaVersion: "programmable.website-github-session-authority.v1",
    provider: "github",
    githubUserId: EXACT_SHARDS_APPLICANT_GITHUB_USER_ID_V1,
    githubLogin: "jesse-stahl",
    observedAtEpochSeconds,
    expiresAtEpochSeconds,
    sessionAuthorityEvidenceSha256: sha256(
      input.sessionAuthorityEvidenceSha256,
      "Website GitHub session evidence"
    )
  };
  return deepFreeze({
    ...core,
    authorityHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertWebsiteGithubSessionAuthorityV1(raw) {
  exactKeys(raw, [
    "authorityHash",
    "expiresAtEpochSeconds",
    "githubLogin",
    "githubUserId",
    "observedAtEpochSeconds",
    "provider",
    "schemaVersion",
    "sessionAuthorityEvidenceSha256"
  ], "Website GitHub session authority");
  if (raw.schemaVersion !== "programmable.website-github-session-authority.v1" || raw.provider !== "github" || raw.githubUserId !== EXACT_SHARDS_APPLICANT_GITHUB_USER_ID_V1 || raw.githubLogin !== "jesse-stahl") throw new TypeError("Website GitHub session is not the exact Shards applicant authority");
  const rebuilt = createWebsiteGithubSessionAuthorityV1(raw);
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt)) {
    throw new TypeError("Website GitHub session authority hash is invalid");
  }
  return rebuilt;
}
function createNestedFactoryApplicantAcceptanceSubjectV1(input) {
  const core = {
    schemaVersion: "programmable.application-acceptance-subject.v1",
    applicantGithubUserId: EXACT_SHARDS_APPLICANT_GITHUB_NUMERIC_USER_ID_V1,
    reviewedRequest: deepFreeze({
      path: repositoryPath(
        input.reviewedRequestPath,
        "applicant acceptance reviewed request path"
      ),
      applicationManifestSha256: sha256(
        input.applicationManifestSha256,
        "applicant acceptance application manifest"
      )
    })
  };
  if (core.reviewedRequest.path !== EXACT_SHARDS_REVIEWED_REQUEST_PATH_V1 || core.reviewedRequest.applicationManifestSha256 !== EXACT_SHARDS_APPLICATION_MANIFEST_SHA256_V1) throw new TypeError("applicant acceptance subject left the exact reviewed Shards request");
  const canonicalBytes = Buffer.from(canonicalizeJson(core), "utf8");
  if (canonicalBytes.byteLength !== HOOKBUILDER_ACCEPTANCE_PROTOCOL_V1.canonicalSubjectByteLength) {
    throw new TypeError("Hookbuilder applicant acceptance subject byte length drifted");
  }
  const acceptanceSubjectHash = rawSha256(canonicalBytes);
  if (acceptanceSubjectHash !== HOOKBUILDER_ACCEPTANCE_PROTOCOL_V1.acceptanceSubjectHash) {
    throw new TypeError("Hookbuilder applicant acceptance subject hash drifted");
  }
  return deepFreeze({
    ...core,
    acceptanceSubjectHash
  });
}
function assertNestedFactoryApplicantAcceptanceSubjectV1(raw) {
  exactKeys(raw, [
    "acceptanceSubjectHash",
    "applicantGithubUserId",
    "reviewedRequest",
    "schemaVersion"
  ], "nested-factory applicant acceptance subject");
  exactKeys(
    raw.reviewedRequest,
    ["applicationManifestSha256", "path"],
    "nested-factory applicant acceptance reviewed request"
  );
  if (raw.schemaVersion !== "programmable.application-acceptance-subject.v1" || raw.applicantGithubUserId !== EXACT_SHARDS_APPLICANT_GITHUB_NUMERIC_USER_ID_V1) throw new TypeError("nested-factory applicant acceptance subject is invalid");
  const rebuilt = createNestedFactoryApplicantAcceptanceSubjectV1({
    reviewedRequestPath: raw.reviewedRequest.path,
    applicationManifestSha256: raw.reviewedRequest.applicationManifestSha256
  });
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt)) {
    throw new TypeError("nested-factory applicant acceptance subject hash is invalid");
  }
  return rebuilt;
}
function createNestedFactoryApplicantAcceptanceHeadV1(input) {
  const subject = assertNestedFactoryApplicantAcceptanceSubjectV1(input.subject);
  const current = input.currentHead === null ? null : assertNestedFactoryApplicantAcceptanceHeadV1(input.currentHead);
  const expectedPrevious = input.expectedPreviousAcceptanceHash === null ? null : sha256(input.expectedPreviousAcceptanceHash, "expected prior applicant acceptance");
  if (expectedPrevious !== (current?.acceptanceHash ?? null)) {
    throw new TypeError("applicant acceptance CAS predecessor is stale");
  }
  if (current !== null && current.acceptanceSubjectHash !== subject.acceptanceSubjectHash) {
    throw new TypeError("applicant acceptance CAS crossed application subjects");
  }
  const claimSha256 = sha256(input.claimSha256, "applicant acceptance claim");
  const applicantAcceptanceRecordHash = sha256(
    input.applicantAcceptanceRecordHash,
    "applicant acceptance record"
  );
  if (current !== null && (current.claimSha256 === claimSha256 || current.applicantAcceptanceRecordHash === applicantAcceptanceRecordHash)) throw new TypeError("applicant acceptance CAS reuses the prior claim or record");
  const core = {
    schemaVersion: "programmable.nested-factory-applicant-acceptance-head.v1",
    acceptanceSubjectHash: subject.acceptanceSubjectHash,
    revision: (current === null ? 1n : BigInt(current.revision) + 1n).toString(10),
    previousAcceptanceHash: current?.acceptanceHash ?? null,
    claimSha256,
    applicantAcceptanceRecordHash,
    authenticatedGithubUserId: EXACT_SHARDS_APPLICANT_GITHUB_USER_ID_V1,
    acceptedAt: canonicalInstant(input.acceptedAt, "applicant acceptance time")
  };
  return deepFreeze({
    ...core,
    acceptanceHash: canonicalSha256(core.schemaVersion, core)
  });
}
function assertNestedFactoryApplicantAcceptanceHeadV1(raw) {
  exactKeys(raw, [
    "acceptanceHash",
    "acceptanceSubjectHash",
    "acceptedAt",
    "applicantAcceptanceRecordHash",
    "authenticatedGithubUserId",
    "claimSha256",
    "previousAcceptanceHash",
    "revision",
    "schemaVersion"
  ], "nested-factory applicant acceptance head");
  if (raw.schemaVersion !== "programmable.nested-factory-applicant-acceptance-head.v1" || raw.authenticatedGithubUserId !== EXACT_SHARDS_APPLICANT_GITHUB_USER_ID_V1 || decimalUint(raw.revision, 64, "applicant acceptance revision") === "0") throw new TypeError("nested-factory applicant acceptance head is invalid");
  sha256(raw.acceptanceSubjectHash, "applicant acceptance subject");
  sha256(raw.claimSha256, "applicant acceptance claim");
  sha256(raw.applicantAcceptanceRecordHash, "applicant acceptance record");
  canonicalInstant(raw.acceptedAt, "applicant acceptance time");
  if (raw.previousAcceptanceHash !== null) {
    sha256(raw.previousAcceptanceHash, "prior applicant acceptance");
  }
  const core = { ...raw };
  delete core.acceptanceHash;
  if (raw.acceptanceHash !== canonicalSha256(raw.schemaVersion, core)) {
    throw new TypeError("nested-factory applicant acceptance head hash is invalid");
  }
  return deepFreeze(raw);
}
function verifyCurrentNestedFactoryApplicantAcceptanceHeadV1(input) {
  const subject = assertNestedFactoryApplicantAcceptanceSubjectV1(input.subject);
  const head = assertNestedFactoryApplicantAcceptanceHeadV1(input.head);
  if (head.acceptanceSubjectHash !== subject.acceptanceSubjectHash || head.acceptanceHash !== sha256(
    input.expectedCurrentAcceptanceHash,
    "current applicant acceptance head"
  ) || head.claimSha256 !== sha256(input.expectedClaimSha256, "current applicant claim") || head.applicantAcceptanceRecordHash !== sha256(
    input.expectedApplicantAcceptanceRecordHash,
    "current applicant acceptance record"
  )) throw new TypeError("applicant acceptance is not the current durable CAS head");
  return head;
}
var NestedFactoryCapabilityError = class extends TypeError {
  code;
  disposition = "analysis_pending";
  constructor(code, message) {
    super(message);
    this.name = "NestedFactoryCapabilityError";
    this.code = code;
    Object.freeze(this);
  }
};
var EXACT_SHARDS_FACTORY_PREDEPLOYMENT_PLAN_V1 = createNestedFactoryAtomicDeploymentPlanV1({
  factoryDeploymentProxy: EXACT_SHARDS_FACTORY_DEPLOYMENT_PROXY_V1,
  factoryDeploymentProxyRuntimeCodeHash: EXACT_SHARDS_FACTORY_DEPLOYMENT_PROXY_RUNTIME_HASH_V1,
  factorySalt: EXACT_SHARDS_FACTORY_SALT_V1,
  factoryInitCodeBytes: 37942,
  factoryInitCodeHash: EXACT_SHARDS_FACTORY_INIT_CODE_HASH_V1,
  factoryDeploymentCalldataBytes: 37974,
  factoryDeploymentCalldataHash: EXACT_SHARDS_FACTORY_DEPLOYMENT_CALLDATA_HASH_V1,
  factory: EXACT_SHARDS_FACTORY_V1,
  factoryRuntimeCodeHash: EXACT_SHARDS_FACTORY_RUNTIME_HASH_V1,
  renderer: EXACT_SHARDS_RENDERER_V1,
  rendererRuntimeCodeHash: EXACT_SHARDS_RENDERER_RUNTIME_HASH_V1,
  hookCreationCodeHash: EXACT_SHARDS_HOOK_CREATION_CODE_HASH_V1
});
var EXACT_SHARDS_NESTED_FACTORY_DISABLED_CAPABILITY_V1 = createNestedFactoryCapabilityV1({
  capabilityId: "exact-shards-nested-factory@1.0.0",
  state: "disabled",
  profile: {
    profileId: EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_V1,
    profileVersion: EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_V1
  },
  profileSha256: EXACT_SHARDS_NESTED_FACTORY_PROFILE_SHA256_V1,
  sourceRevisionHash: EXACT_SHARDS_SOURCE_REVISION_HASH_V1,
  manifestHash: EXACT_SHARDS_MANIFEST_HASH_V1,
  revenuePolicyHash: EXACT_SHARDS_REVENUE_POLICY_HASH_V1,
  poolManager: EXACT_SHARDS_POOL_MANAGER_V1,
  poolManagerRuntimeCodeHash: EXACT_SHARDS_POOL_MANAGER_RUNTIME_HASH_V1,
  activation: null
});
var NESTED_FACTORY_DISABLED_CAPABILITY_CATALOG_V1 = createNestedFactoryCapabilityCatalogV1([
  EXACT_SHARDS_NESTED_FACTORY_DISABLED_CAPABILITY_V1
]);
async function assertRuntimeCodeHash(rpc, account, expectedRuntimeCodeHash, blockTag, label) {
  const runtime = rpcHex(await rpc.readConsensus(
    "eth_getCode",
    [account, blockTag]
  ), `${label} runtime`);
  if (runtime === "0x" || keccakBytes(hexBytes(runtime, `${label} runtime`)) !== expectedRuntimeCodeHash) {
    throw new TypeError(`${label} runtime hash is not current`);
  }
}
async function assertExactPredeployedFactoryGettersV1(rpc, factory, blockTag) {
  const addressCalls = [
    ["poolManager()", EXACT_SHARDS_POOL_MANAGER_V1, "factory PoolManager"],
    ["renderer()", EXACT_SHARDS_RENDERER_V1, "factory renderer"],
    [
      "launcherFeeRecipient()",
      EXACT_SHARDS_LAUNCHER_FEE_RECIPIENT_V1,
      "factory launcher fee recipient"
    ],
    [
      "builderFeeRecipient()",
      address(EXACT_SHARDS_LAUNCH_WALLET_V1, "Shards launch wallet"),
      "factory builder fee recipient"
    ]
  ];
  for (const [signature, expected, label] of addressCalls) {
    const observed = decodeAbiAddress(await rpc.ethCallConsensus({
      to: factory,
      data: selectorFor(signature)
    }, blockTag), label);
    if (observed !== expected) throw new TypeError(`${label} drifted`);
  }
  const resolvedRenderer = decodeAbiAddress(await rpc.ethCallConsensus({
    to: factory,
    data: encodeFixedCall(
      "resolveRenderer(address)",
      addressWord("0x0000000000000000000000000000000000000000")
    )
  }, blockTag), "factory resolved renderer");
  if (resolvedRenderer !== EXACT_SHARDS_RENDERER_V1) {
    throw new TypeError("factory resolved renderer drifted");
  }
  const hookCreationCodeHash = rpcWord(await rpc.ethCallConsensus({
    to: factory,
    data: selectorFor("hookCreationCodeHash()")
  }, blockTag), "factory hook creation-code hash");
  if (hookCreationCodeHash !== EXACT_SHARDS_HOOK_CREATION_CODE_HASH_V1) {
    throw new TypeError("factory hook creation-code hash drifted");
  }
}
async function assertExactShardsConfigurationHashV1(rpc, blockTag) {
  const observed = rpcWord(await rpc.ethCallConsensus({
    to: EXACT_SHARDS_FACTORY_V1,
    data: encodeFixedCall(
      "configurationHashOf(address)",
      addressWord(EXACT_SHARDS_HOOK_V1)
    )
  }, blockTag), "exact Shards factory configuration hash");
  if (observed !== EXACT_SHARDS_CONFIGURATION_HASH_V1) {
    throw new TypeError("exact Shards factory configuration hash drifted");
  }
}
function computeNestedFactoryLaunchStampHashV1(input) {
  return keccakBytes(concat(
    bytes32Bytes(NESTED_FACTORY_LAUNCH_STAMP_TYPEHASH_V1, "launch stamp type hash"),
    bytes32Bytes(
      nonzeroBytes32(input.permitDigest, "launch stamp permit digest"),
      "launch stamp permit digest"
    ),
    bytes32Bytes(
      nonzeroBytes32(input.launchId, "launch stamp launch id"),
      "launch stamp launch id"
    ),
    word(BigInt(executionModeAbiValueV1(input.executionMode))),
    addressWord(EXACT_SHARDS_FACTORY_V1),
    addressWord(EXACT_SHARDS_POOL_MANAGER_V1),
    bytes32Bytes(EXACT_SHARDS_POOL_ID_V1, "launch stamp pool id")
  ));
}
function exactNestedFactoryRouteStampedEventV2(input) {
  const expectedTopics = [
    PROGRAMMABLE_NESTED_FACTORY_ROUTE_STAMPED_EVENT_TOPIC_V2,
    input.identity.launchId,
    input.capability.profile.profileKey,
    addressTopic(EXACT_SHARDS_FACTORY_V1)
  ];
  const matches = input.logs.filter((log) => log.address === input.router && canonicalizeJson(log.topics) === canonicalizeJson(expectedTopics));
  if (matches.length !== 1 || matches[0] === void 0) {
    throw new TypeError("exact nested-factory route-stamped event is absent or ambiguous");
  }
  const words = staticAbiWordsV1(matches[0].data, 8, "nested-factory route-stamped event");
  const expected = [
    input.compiledRoute.routePayloadHash,
    input.capability.sourceRevisionHash,
    input.capability.manifestHash,
    input.capability.revenuePolicyHash,
    EXACT_SHARDS_CONFIGURATION_HASH_V1,
    input.compiledRoute.expectedResultHash,
    input.permitDigest
  ];
  if (expected.some((value, index) => words[index] !== value)) {
    throw new TypeError("nested-factory route-stamped event left the exact release binding");
  }
  return deepFreeze({
    log: matches[0],
    executionMode: executionModeFromAbiWordV1(words[7])
  });
}
function exactNestedFactoryLaunchStampedEventV2(input) {
  const expectedTopics = [
    PROGRAMMABLE_LAUNCH_STAMPED_EVENT_TOPIC_V2,
    input.launchId,
    addressTopic(EXACT_SHARDS_TOKEN_V1),
    addressTopic(EXACT_SHARDS_HOOK_V1)
  ];
  const matches = input.logs.filter((log) => log.address === input.router && canonicalizeJson(log.topics) === canonicalizeJson(expectedTopics));
  if (matches.length !== 1 || matches[0] === void 0) {
    throw new TypeError("exact nested-factory launch-stamped event is absent or ambiguous");
  }
  const expectedData = bytesHex(concat(
    addressWord(EXACT_SHARDS_NFT_V1),
    addressWord(EXACT_SHARDS_FACTORY_V1),
    addressWord(EXACT_SHARDS_RENDERER_V1),
    addressWord(EXACT_SHARDS_POOL_MANAGER_V1),
    bytes32Bytes(EXACT_SHARDS_POOL_ID_V1, "launch-stamped pool id"),
    bytes32Bytes(input.stampHash, "launch-stamped stamp hash"),
    word(BigInt(executionModeAbiValueV1(input.executionMode)))
  ));
  if (matches[0].data !== expectedData) {
    throw new TypeError("nested-factory launch-stamped event left the exact stamp binding");
  }
  return matches[0];
}
async function verifyNestedFactoryRouterReadbacksV1(input) {
  const expectedStampRecord = bytesHex(concat(
    addressWord(input.identity.launchWallet),
    addressWord(EXACT_SHARDS_FACTORY_V1),
    addressWord(EXACT_SHARDS_RENDERER_V1),
    addressWord(EXACT_SHARDS_TOKEN_V1),
    addressWord(EXACT_SHARDS_HOOK_V1),
    addressWord(EXACT_SHARDS_NFT_V1),
    addressWord(EXACT_SHARDS_POOL_MANAGER_V1),
    bytes32Bytes(EXACT_SHARDS_POOL_ID_V1, "stamp record pool id"),
    bytes32Bytes(EXACT_SHARDS_POOL_KEY_HASH_V1, "stamp record pool-key hash"),
    bytes32Bytes(NESTED_FACTORY_ROUTE_ID_HASH_V1, "stamp record route id hash"),
    bytes32Bytes(NESTED_FACTORY_ROUTE_VERSION_HASH_V1, "stamp record route version hash"),
    bytes32Bytes(input.capability.profile.profileKey, "stamp record profile key"),
    bytes32Bytes(input.capability.profile.profileIdHash, "stamp record profile id hash"),
    bytes32Bytes(
      input.capability.profile.profileVersionHash,
      "stamp record profile version hash"
    ),
    addressWord(input.activation.module.address),
    bytes32Bytes(input.capability.sourceRevisionHash, "stamp record source revision"),
    bytes32Bytes(input.capability.manifestHash, "stamp record manifest"),
    bytes32Bytes(input.capability.revenuePolicyHash, "stamp record revenue policy"),
    bytes32Bytes(input.compiledRoute.routePayloadHash, "stamp record route payload"),
    bytes32Bytes(EXACT_SHARDS_CONFIGURATION_HASH_V1, "stamp record configuration"),
    bytes32Bytes(input.compiledRoute.expectedResultHash, "stamp record expected result"),
    bytes32Bytes(input.permitDigest, "stamp record permit digest"),
    bytes32Bytes(input.stampHash, "stamp record stamp hash"),
    word(BigInt(executionModeAbiValueV1(input.executionMode)))
  ));
  const stampRecord = await input.rpc.ethCallConsensus({
    to: input.activation.router.address,
    data: encodeFixedCall(
      "launchStamp(bytes32)",
      bytes32Bytes(input.identity.launchId, "launchStamp launch id")
    )
  }, input.blockTag);
  if (stampRecord !== expectedStampRecord) {
    throw new TypeError("nested-factory Router launchStamp readback is invalid");
  }
  const expectedTrue = bytesHex(word(1n));
  const expectedStampProof = bytesHex(concat(
    bytes32Bytes(input.identity.launchId, "stamp proof launch id"),
    bytes32Bytes(input.stampHash, "stamp proof stamp hash")
  ));
  const fixedReadbacks = [
    {
      label: "launchIdByToken",
      data: encodeFixedCall("launchIdByToken(address)", addressWord(EXACT_SHARDS_TOKEN_V1)),
      expected: input.identity.launchId
    },
    {
      label: "launchIdByPool",
      data: encodeFixedCall(
        "launchIdByPool(address,bytes32)",
        addressWord(EXACT_SHARDS_POOL_MANAGER_V1),
        bytes32Bytes(EXACT_SHARDS_POOL_ID_V1, "launchIdByPool pool id")
      ),
      expected: input.identity.launchId
    },
    {
      label: "nonceUsed",
      data: encodeFixedCall(
        "nonceUsed(address,bytes32)",
        addressWord(input.identity.launchWallet),
        bytes32Bytes(input.identity.permitNonce, "nonceUsed permit nonce")
      ),
      expected: expectedTrue
    },
    {
      label: "permitDigestUsed",
      data: encodeFixedCall(
        "permitDigestUsed(bytes32)",
        bytes32Bytes(input.permitDigest, "permitDigestUsed digest")
      ),
      expected: expectedTrue
    }
  ];
  const componentReadbacks = [
    [EXACT_SHARDS_TOKEN_V1, EXACT_SHARDS_TOKEN_RUNTIME_HASH_V1, "token"],
    [EXACT_SHARDS_HOOK_V1, EXACT_SHARDS_HOOK_RUNTIME_HASH_V1, "hook"],
    [EXACT_SHARDS_NFT_V1, EXACT_SHARDS_NFT_RUNTIME_HASH_V1, "nft"]
  ];
  const reads = [
    ...fixedReadbacks,
    ...componentReadbacks.flatMap(([component, runtimeHash, label]) => [{
      label: `${label} launchIdByComponent`,
      data: encodeFixedCall("launchIdByComponent(address)", addressWord(component)),
      expected: input.identity.launchId
    }, {
      label: `${label} componentRuntimeCodeHash`,
      data: encodeFixedCall("componentRuntimeCodeHash(address)", addressWord(component)),
      expected: runtimeHash
    }, {
      label: `${label} stampProof`,
      data: encodeFixedCall("stampProof(address)", addressWord(component)),
      expected: expectedStampProof
    }])
  ];
  const observed = await Promise.all(reads.map(({ data }) => input.rpc.ethCallConsensus({ to: input.activation.router.address, data }, input.blockTag)));
  for (const [index, readback] of reads.entries()) {
    if (observed[index] !== readback.expected) {
      throw new TypeError(`nested-factory Router ${readback.label} readback is invalid`);
    }
  }
  await Promise.all([
    assertRuntimeCodeHash(
      input.rpc,
      input.activation.router.address,
      input.activation.router.runtimeCodeHash,
      input.blockTag,
      "Router V2"
    ),
    assertRuntimeCodeHash(
      input.rpc,
      input.activation.module.address,
      input.activation.module.runtimeCodeHash,
      input.blockTag,
      "nested-factory profile module"
    ),
    assertRuntimeCodeHash(
      input.rpc,
      EXACT_SHARDS_POOL_MANAGER_V1,
      EXACT_SHARDS_POOL_MANAGER_RUNTIME_HASH_V1,
      input.blockTag,
      "PoolManager"
    ),
    assertRuntimeCodeHash(
      input.rpc,
      EXACT_SHARDS_FACTORY_V1,
      EXACT_SHARDS_FACTORY_RUNTIME_HASH_V1,
      input.blockTag,
      "exact Shards factory"
    ),
    assertRuntimeCodeHash(
      input.rpc,
      EXACT_SHARDS_RENDERER_V1,
      EXACT_SHARDS_RENDERER_RUNTIME_HASH_V1,
      input.blockTag,
      "exact Shards renderer"
    ),
    ...componentReadbacks.map(([component, runtimeHash, label]) => assertRuntimeCodeHash(
      input.rpc,
      component,
      runtimeHash,
      input.blockTag,
      `exact Shards ${label}`
    )),
    assertExactPredeployedFactoryGettersV1(
      input.rpc,
      EXACT_SHARDS_FACTORY_V1,
      input.blockTag
    ),
    assertExactShardsConfigurationHashV1(input.rpc, input.blockTag)
  ]);
  if (input.blockTag !== "latest") {
    const poolState = rpcWord(await input.rpc.readConsensus(
      "eth_getStorageAt",
      [EXACT_SHARDS_POOL_MANAGER_V1, EXACT_SHARDS_POOL_STATE_SLOT_V1, input.blockTag]
    ), "finalized exact Shards pool state");
    if (poolState === bytesHex(word(0n))) {
      throw new TypeError("nested-factory finalized pool is not initialized");
    }
  }
  return stampRecord;
}
function staticAbiWordsV1(value, count, label) {
  if (!Number.isSafeInteger(count) || count <= 0 || count > 256) {
    throw new TypeError(`${label} ABI word count is invalid`);
  }
  const bytes = hexBytes(value, label);
  if (bytes.byteLength !== count * 32) throw new TypeError(`${label} ABI length is invalid`);
  return deepFreeze(Array.from({ length: count }, (_, index) => bytesHex(bytes.slice(index * 32, (index + 1) * 32))));
}
function executionModeAbiValueV1(value) {
  if (value === "EXACT_FACTORY_LAUNCH_EXECUTED") return 1;
  if (value === "EXACT_EXISTING_LAUNCH_ADOPTED") return 2;
  throw new TypeError("nested-factory execution mode is invalid");
}
function executionModeFromAbiWordV1(value) {
  if (value === bytesHex(word(1n))) return "EXACT_FACTORY_LAUNCH_EXECUTED";
  if (value === bytesHex(word(2n))) return "EXACT_EXISTING_LAUNCH_ADOPTED";
  throw new TypeError("nested-factory event execution mode is outside the exact A/B policy");
}
function receiptLogs(raw, transactionHash, blockNumber, blockHash, transactionIndex) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 512) {
    throw new TypeError("existing launch receipt log set is invalid");
  }
  const logs = raw.map((value) => {
    const log = record(value, "existing launch receipt log");
    if ("removed" in log && log.removed !== false) {
      throw new TypeError("existing launch receipt contains a removed log");
    }
    const core = {
      address: address(log.address, "existing launch log emitter"),
      topics: canonicalLogTopics(log.topics),
      data: rpcHex(log.data, "existing launch log data"),
      logIndex: rpcQuantity(log.logIndex, "existing launch log index"),
      transactionIndex: rpcQuantity(
        log.transactionIndex,
        "existing launch log transaction index"
      ),
      transactionHash: nonzeroBytes32(log.transactionHash, "existing launch log transaction"),
      blockNumber: rpcQuantity(log.blockNumber, "existing launch log block number"),
      blockHash: nonzeroBytes32(log.blockHash, "existing launch log block hash")
    };
    if (core.transactionHash !== transactionHash || core.blockNumber !== blockNumber || core.blockHash !== blockHash || core.transactionIndex !== transactionIndex) throw new TypeError("existing launch receipt log left its canonical transaction");
    return deepFreeze({
      ...core,
      logHash: canonicalSha256("programmable.nested-factory-receipt-log.v1", core)
    });
  }).sort((left, right) => BigInt(left.logIndex) < BigInt(right.logIndex) ? -1 : 1);
  if (new Set(logs.map(({ logIndex }) => logIndex)).size !== logs.length) {
    throw new TypeError("existing launch receipt contains duplicate log indexes");
  }
  return deepFreeze(logs);
}
function canonicalLogTopics(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) {
    throw new TypeError("existing launch log topic count is invalid");
  }
  return deepFreeze(raw.map((value) => rpcWord(value, "existing launch log topic")));
}
function uniqueMatchingLog(logs, emitter, topics, data, label) {
  const matches = logs.filter((log) => log.address === emitter && canonicalizeJson(log.topics) === canonicalizeJson(topics) && log.data === data);
  if (matches.length !== 1 || matches[0] === void 0) {
    throw new TypeError(`${label} event is absent or ambiguous`);
  }
  return matches[0];
}
function expectedShardLaunchedTopicsV1() {
  return deepFreeze([
    EXACT_SHARDS_SHARD_LAUNCHED_EVENT_TOPIC_V1,
    addressTopic(EXACT_SHARDS_HOOK_V1),
    addressTopic(EXACT_SHARDS_TOKEN_V1),
    addressTopic(EXACT_SHARDS_NFT_V1)
  ]);
}
function expectedShardLaunchedDataV1() {
  return bytesHex(concat(
    bytes32Bytes(EXACT_SHARDS_TOKEN_SALT_V1, "exact Shards token salt"),
    bytes32Bytes(EXACT_SHARDS_HOOK_SALT_V1, "exact Shards hook salt"),
    addressWord(address(EXACT_SHARDS_LAUNCH_WALLET_V1, "exact Shards builder")),
    addressWord(EXACT_SHARDS_RENDERER_V1),
    bytes32Bytes(EXACT_SHARDS_CONFIGURATION_HASH_V1, "exact Shards configuration")
  ));
}
function expectedPoolInitializeTopicsV1() {
  return deepFreeze([
    UNISWAP_V4_INITIALIZE_EVENT_TOPIC_V1,
    EXACT_SHARDS_POOL_ID_V1,
    addressTopic("0x0000000000000000000000000000000000000000"),
    addressTopic(EXACT_SHARDS_TOKEN_V1)
  ]);
}
function expectedPoolInitializeDataV1() {
  return bytesHex(concat(
    word(0n),
    word(60n),
    addressWord(EXACT_SHARDS_HOOK_V1),
    word(BigInt(EXACT_SHARDS_START_SQRT_PRICE_X96_V1)),
    word(BigInt(EXACT_SHARDS_INITIAL_TICK_V1))
  ));
}
function addressTopic(value) {
  return bytesHex(addressWord(addressOrZero(value, "event address topic")));
}
function bytesHex(value) {
  return `0x${Buffer.from(value).toString("hex")}`;
}
async function verifySafeAuthorityAtBlockV1(rpc, role, authority, blockTag) {
  const safe = authority.safe;
  await assertRuntimeCodeHash(
    rpc,
    safe.masterCopy,
    safe.masterCopyRuntimeCodeHash,
    blockTag,
    `${role} Safe master copy`
  );
  const masterCopy = decodeAbiAddress(await rpc.ethCallConsensus({
    to: authority.address,
    data: selectorFor("masterCopy()")
  }, blockTag), `${role} Safe master copy`);
  if (masterCopy !== safe.masterCopy) throw new TypeError(`${role} Safe master copy drifted`);
  const version = decodeAbiString(await rpc.ethCallConsensus({
    to: authority.address,
    data: selectorFor("VERSION()")
  }, blockTag), `${role} Safe version`);
  if (version !== safe.version) throw new TypeError(`${role} Safe version drifted`);
  const threshold = decodeAbiUint(await rpc.ethCallConsensus({
    to: authority.address,
    data: selectorFor("getThreshold()")
  }, blockTag), `${role} Safe threshold`).toString(10);
  if (threshold !== safe.threshold) throw new TypeError(`${role} Safe threshold drifted`);
  const owners = decodeAbiAddressArray(await rpc.ethCallConsensus({
    to: authority.address,
    data: selectorFor("getOwners()")
  }, blockTag), `${role} Safe owners`).sort(compareUtf8);
  if (canonicalizeJson(owners) !== canonicalizeJson(safe.owners)) {
    throw new TypeError(`${role} Safe owner set drifted`);
  }
  const fallbackHandler = addressFromStorageWord(await rpc.readConsensus(
    "eth_getStorageAt",
    [authority.address, safe.fallbackHandlerStorageSlot, blockTag]
  ), `${role} Safe fallback handler`);
  if (fallbackHandler !== safe.fallbackHandler) {
    throw new TypeError(`${role} Safe fallback handler drifted`);
  }
  if (safe.fallbackHandlerRuntimeCodeHash !== null) {
    await assertRuntimeCodeHash(
      rpc,
      safe.fallbackHandler,
      safe.fallbackHandlerRuntimeCodeHash,
      blockTag,
      `${role} Safe fallback handler`
    );
  }
  const guard = addressFromStorageWord(await rpc.readConsensus(
    "eth_getStorageAt",
    [authority.address, safe.guardStorageSlot, blockTag]
  ), `${role} Safe guard`);
  if (guard !== safe.guard) throw new TypeError(`${role} Safe guard drifted`);
  if (safe.guardRuntimeCodeHash !== null) {
    await assertRuntimeCodeHash(
      rpc,
      safe.guard,
      safe.guardRuntimeCodeHash,
      blockTag,
      `${role} Safe guard`
    );
  }
  const modulesResult = decodeSafeModules(await rpc.ethCallConsensus({
    to: authority.address,
    data: encodeFixedCall(
      "getModulesPaginated(address,uint256)",
      addressWord(safe.moduleSentinel),
      word(100n)
    )
  }, blockTag), `${role} Safe modules`);
  if (modulesResult.next !== safe.moduleSentinel || canonicalizeJson(modulesResult.modules.sort(compareUtf8)) !== canonicalizeJson(safe.modules.map(({ address: value }) => value))) throw new TypeError(`${role} Safe module set drifted`);
  for (const module of safe.modules) {
    await assertRuntimeCodeHash(
      rpc,
      module.address,
      module.runtimeCodeHash,
      blockTag,
      `${role} Safe module`
    );
  }
  const safeNonce = decodeAbiUint(await rpc.ethCallConsensus({
    to: authority.address,
    data: selectorFor("nonce()")
  }, blockTag), `${role} Safe nonce`).toString(10);
  return deepFreeze({
    role,
    address: authority.address,
    authorityConfigurationSha256: authority.authorityConfigurationSha256,
    safeNonce
  });
}
function assertCurrentnessAuthorityStates(raw) {
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new TypeError("nested-factory currentness requires both Safe authority roles");
  }
  const states = raw.map((value) => {
    exactKeys(
      value,
      ["address", "authorityConfigurationSha256", "role", "safeNonce"],
      "nested-factory Safe authority state"
    );
    if (!(value.role === "capability-admin" || value.role === "permit-authority")) {
      throw new TypeError("nested-factory Safe authority role is invalid");
    }
    address(value.address, `${value.role} Safe address`);
    sha256(value.authorityConfigurationSha256, `${value.role} Safe configuration`);
    decimalUint(value.safeNonce, 256, `${value.role} Safe nonce`);
    return value;
  }).sort((left, right) => compareUtf8(left.role, right.role));
  if (states[0]?.role !== "capability-admin" || states[1]?.role !== "permit-authority") {
    throw new TypeError("nested-factory Safe authority roles are incomplete");
  }
}
function assertAuthorityStatesMatchActivation(states, activation) {
  const expected = /* @__PURE__ */ new Map([
    ["capability-admin", activation.capabilityAdmin],
    ["permit-authority", activation.permitAuthority]
  ]);
  for (const state of states) {
    const binding = expected.get(state.role);
    if (binding === void 0 || state.address !== binding.address || state.authorityConfigurationSha256 !== binding.authorityConfigurationSha256) throw new TypeError("nested-factory Safe authority state left the active capability");
  }
}
function selectorFor(signature) {
  return hashText(signature).slice(0, 10);
}
function encodeFixedCall(signature, ...words) {
  return `0x${selectorFor(signature).slice(2)}${Buffer.from(concat(...words)).toString("hex")}`;
}
function decodeAbiAddress(value, label) {
  const raw = rpcWord(value, label);
  if (!/^0x0{24}[0-9a-f]{40}$/u.test(raw)) throw new TypeError(`${label} is not an address word`);
  return addressOrZero(`0x${raw.slice(-40)}`, label);
}
function addressFromStorageWord(value, label) {
  return decodeAbiAddress(value, label);
}
function decodeAbiUint(value, label) {
  return BigInt(rpcWord(value, label));
}
function decodeAbiString(value, label) {
  const bytes = hexBytes(value, label);
  if (bytes.byteLength < 64 || readWord(bytes, 0, label) !== 32n) {
    throw new TypeError(`${label} ABI string offset is invalid`);
  }
  const length = safeAbiLength(readWord(bytes, 32, label), label);
  const padded = Math.ceil(length / 32) * 32;
  if (bytes.byteLength !== 64 + padded) throw new TypeError(`${label} ABI string length is invalid`);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(64, 64 + length));
}
function decodeAbiAddressArray(value, label) {
  const bytes = hexBytes(value, label);
  if (bytes.byteLength < 64 || readWord(bytes, 0, label) !== 32n) {
    throw new TypeError(`${label} ABI array offset is invalid`);
  }
  return decodeAddressArrayAt(bytes, 32, bytes.byteLength, label);
}
function decodeSafeModules(value, label) {
  const bytes = hexBytes(value, label);
  if (bytes.byteLength < 96 || readWord(bytes, 0, label) !== 64n) {
    throw new TypeError(`${label} ABI tuple offset is invalid`);
  }
  const next = decodeAddressWordBytes(bytes, 32, label);
  const modules = decodeAddressArrayAt(bytes, 64, bytes.byteLength, label);
  return { modules, next };
}
function decodeAddressArrayAt(bytes, offset, expectedLength, label) {
  const length = safeAbiLength(readWord(bytes, offset, label), label);
  if (expectedLength !== offset + 32 + length * 32) {
    throw new TypeError(`${label} ABI array length is invalid`);
  }
  const result = [];
  for (let index = 0; index < length; index += 1) {
    result.push(decodeAddressWordBytes(bytes, offset + 32 + index * 32, label));
  }
  return result;
}
function decodeAddressWordBytes(bytes, offset, label) {
  if (offset < 0 || offset + 32 > bytes.byteLength) throw new TypeError(`${label} ABI word is absent`);
  const raw = Buffer.from(bytes.slice(offset, offset + 32)).toString("hex");
  if (!/^0{24}[0-9a-f]{40}$/u.test(raw)) throw new TypeError(`${label} ABI address is invalid`);
  return addressOrZero(`0x${raw.slice(-40)}`, label);
}
function readWord(bytes, offset, label) {
  if (offset < 0 || offset + 32 > bytes.byteLength) throw new TypeError(`${label} ABI word is absent`);
  return BigInt(`0x${Buffer.from(bytes.slice(offset, offset + 32)).toString("hex")}`);
}
function safeAbiLength(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError(`${label} ABI length is unsafe`);
  return Number(value);
}
function assertCommonFinalizedAnchorV1(raw) {
  exactKeys(raw, [
    "anchorHash",
    "blockHash",
    "blockNumber",
    "chainId",
    "providerIds",
    "schemaVersion",
    "timestamp"
  ], "nested-factory finalized anchor");
  if (raw.schemaVersion !== "programmable.router-common-finalized-anchor.v1" || raw.chainId !== "1" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(raw.blockNumber) || !Array.isArray(raw.providerIds) || raw.providerIds.length !== 2 || raw.providerIds[0] === raw.providerIds[1] || raw.providerIds.some((value) => typeof value !== "string" || value.length === 0)) throw new TypeError("nested-factory finalized anchor identity is invalid");
  nonzeroBytes32(raw.blockHash, "nested-factory finalized block hash");
  decimalUint(raw.timestamp, 64, "nested-factory finalized timestamp");
  const core = { ...raw };
  delete core.anchorHash;
  if (raw.anchorHash !== canonicalSha256(raw.schemaVersion, core)) {
    throw new TypeError("nested-factory finalized anchor hash is invalid");
  }
  return deepFreeze(raw);
}
function assertCurrentnessClock(raw) {
  exactKeys(
    raw,
    ["maximumTimestamp", "minimumTimestamp", "providerTimestamps"],
    "nested-factory chain clock"
  );
  if (!Array.isArray(raw.providerTimestamps) || raw.providerTimestamps.length !== 2) {
    throw new TypeError("nested-factory chain clock requires two provider timestamps");
  }
  const timestamps = raw.providerTimestamps.map((value) => decimalUint(value, 64, "nested-factory provider timestamp"));
  const minimum = timestamps.reduce((left, right) => BigInt(left) < BigInt(right) ? left : right);
  const maximum = timestamps.reduce((left, right) => BigInt(left) > BigInt(right) ? left : right);
  if (raw.minimumTimestamp !== minimum || raw.maximumTimestamp !== maximum) {
    throw new TypeError("nested-factory chain clock extrema are invalid");
  }
  return deepFreeze(raw);
}
function canonicalCurrentnessComponents(raw) {
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new TypeError("nested-factory currentness requires token, hook, and NFT");
  }
  const components = raw.map((value) => {
    exactKeys(value, ["address", "kind"], "nested-factory currentness component");
    if (!["hook", "nft", "token"].includes(value.kind)) {
      throw new TypeError("nested-factory currentness component kind is invalid");
    }
    return deepFreeze({
      kind: value.kind,
      address: address(value.address, `${value.kind} address`)
    });
  }).sort((left, right) => compareUtf8(left.kind, right.kind));
  if (new Set(components.map(({ kind }) => kind)).size !== 3 || new Set(components.map(({ address: value }) => value)).size !== 3) {
    throw new TypeError("nested-factory currentness components are duplicated");
  }
  const expected = /* @__PURE__ */ new Map([
    ["hook", EXACT_SHARDS_HOOK_V1],
    ["nft", EXACT_SHARDS_NFT_V1],
    ["token", EXACT_SHARDS_TOKEN_V1]
  ]);
  if (components.some(({ kind, address: value }) => expected.get(kind) !== value)) {
    throw new TypeError("nested-factory currentness components left the exact Shards plan");
  }
  return deepFreeze(components);
}
function canonicalGasEstimates(raw) {
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new TypeError("nested-factory gas evidence requires exactly two providers");
  }
  const values = raw.map((entry) => {
    exactKeys(entry, ["gas", "providerId"], "nested-factory provider gas estimate");
    const providerId = boundedText(entry.providerId, "nested-factory gas provider id", 128);
    const gas = decimalUint(entry.gas, 64, "nested-factory provider gas estimate");
    if (BigInt(gas) === 0n) throw new TypeError("nested-factory provider gas estimate is zero");
    return deepFreeze({ providerId, gas });
  }).sort((left, right) => compareUtf8(left.providerId, right.providerId));
  if (values[0]?.providerId === values[1]?.providerId) {
    throw new TypeError("nested-factory gas providers are not independent");
  }
  return deepFreeze(values);
}
function isNestedFactoryExecutionModeV1(value) {
  return value === "EXACT_FACTORY_LAUNCH_EXECUTED" || value === "EXACT_EXISTING_LAUNCH_ADOPTED";
}
function canonicalExecutionModePolicy(raw) {
  if (!Array.isArray(raw) || raw.length !== NESTED_FACTORY_EXECUTION_MODE_POLICY_V1.length || raw.some((value) => !isNestedFactoryExecutionModeV1(value))) {
    throw new TypeError("nested-factory execution mode policy is invalid");
  }
  const normalized = [...raw].sort(compareUtf8);
  if (new Set(normalized).size !== NESTED_FACTORY_EXECUTION_MODE_POLICY_V1.length || canonicalizeJson(normalized) !== canonicalizeJson(NESTED_FACTORY_EXECUTION_MODE_POLICY_V1)) {
    throw new TypeError("nested-factory execution mode policy left the exact closed modes");
  }
  return NESTED_FACTORY_EXECUTION_MODE_POLICY_V1;
}
function ceilDiv(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) throw new TypeError("ceiling division is invalid");
  return (numerator + denominator - 1n) / denominator;
}
function create2Address(deployer, salt, initCodeHash) {
  const digest = keccakBytes(concat(
    Uint8Array.of(255),
    Buffer.from(address(deployer, "CREATE2 deployer").slice(2), "hex"),
    bytes32Bytes(salt, "CREATE2 salt"),
    bytes32Bytes(initCodeHash, "CREATE2 init-code hash")
  ));
  return `0x${digest.slice(-40)}`;
}
function canonicalActivation(raw) {
  const router = runtimeBinding(raw.router, "nested-factory Router");
  const module = deepFreeze({
    ...runtimeBinding(raw.module, "nested-factory module"),
    moduleId: identifier(raw.module.moduleId, "nested-factory module id"),
    moduleIdHash: nonzeroBytes32(raw.module.moduleIdHash, "nested-factory module id hash")
  });
  if (module.moduleIdHash !== hashText(module.moduleId)) {
    throw new TypeError("nested-factory module id hash is invalid");
  }
  const permitAuthority = authorityRuntimeBinding(
    raw.permitAuthority,
    "nested-factory permit authority"
  );
  const capabilityAdmin = authorityRuntimeBinding(
    raw.capabilityAdmin,
    "nested-factory capability admin"
  );
  const releaseAttestationAuthority = releaseAttestationAuthorityBinding(
    raw.releaseAttestationAuthority
  );
  if (!Array.isArray(raw.permittedRoutes) || raw.permittedRoutes.length === 0 || raw.permittedRoutes.length > 64) {
    throw new TypeError("nested-factory permitted route set is invalid");
  }
  const permittedRoutes = raw.permittedRoutes.map((value) => deepFreeze({
    routePayloadHash: nonzeroBytes32(value.routePayloadHash, "permitted route payload hash"),
    expectedResultHash: nonzeroBytes32(value.expectedResultHash, "permitted expected result hash")
  })).sort((left, right) => compareUtf8(left.routePayloadHash, right.routePayloadHash));
  if (new Set(permittedRoutes.map(({ routePayloadHash }) => routePayloadHash)).size !== permittedRoutes.length) {
    throw new TypeError("nested-factory permitted route set contains duplicates");
  }
  const applicantAcceptanceVerifierArtifactSha256 = sha256(
    raw.applicantAcceptanceVerifierArtifactSha256,
    "applicant acceptance verifier"
  );
  if (applicantAcceptanceVerifierArtifactSha256 !== HOOKBUILDER_ACCEPTANCE_PROTOCOL_BINDING_SHA256_V1) {
    throw new TypeError("applicant acceptance verifier left the frozen Hookbuilder CAS protocol");
  }
  return deepFreeze({
    router,
    module,
    permitAuthority,
    capabilityAdmin,
    factoryInterfaceSha256: sha256(raw.factoryInterfaceSha256, "factory interface"),
    factoryLaunchSelector: selector(raw.factoryLaunchSelector, "factory launch selector"),
    routerDirectLaunchSelector: exactSelector(
      raw.routerDirectLaunchSelector,
      "0xc90ca102",
      "Router direct launch selector"
    ),
    routerRegisteredLaunchSelector: exactSelector(
      raw.routerRegisteredLaunchSelector,
      "0x5e484bf5",
      "Router registered launch selector"
    ),
    routerRegisterProfileSelector: exactSelector(
      raw.routerRegisterProfileSelector,
      "0xec056663",
      "Router profile registration selector"
    ),
    releaseAttestationAuthority,
    routeSchemaSha256: sha256(raw.routeSchemaSha256, "nested-factory route schema"),
    compilerArtifactSha256: sha256(raw.compilerArtifactSha256, "nested-factory compiler"),
    portableVerifierArtifactSha256: sha256(
      raw.portableVerifierArtifactSha256,
      "nested-factory portable verifier"
    ),
    ceremonyPolicySha256: sha256(
      raw.ceremonyPolicySha256,
      "nested-factory ceremony policy"
    ),
    profileGasAuditSha256: sha256(
      raw.profileGasAuditSha256,
      "nested-factory profile gas audit"
    ),
    applicantAcceptanceVerifierArtifactSha256,
    executionModePolicy: canonicalExecutionModePolicy(raw.executionModePolicy),
    independentAuditSha256: sha256(raw.independentAuditSha256, "nested-factory audit"),
    revenueAttestationSha256: sha256(
      raw.revenueAttestationSha256,
      "nested-factory revenue attestation"
    ),
    revenueVerifierArtifactSha256: sha256(
      raw.revenueVerifierArtifactSha256,
      "nested-factory revenue verifier"
    ),
    permittedRoutes: deepFreeze(permittedRoutes)
  });
}
function authorityRuntimeBinding(raw, label) {
  const safe = safeConfiguration(raw.safe, label);
  const expectedConfigurationSha256 = canonicalSha256(safe.schemaVersion, safe);
  if (raw.authorityConfigurationSha256 !== expectedConfigurationSha256) {
    throw new TypeError(`${label} configuration hash is invalid`);
  }
  return deepFreeze({
    address: address(raw.address, `${label} address`),
    runtimeCodeHash: nonzeroBytes32(raw.runtimeCodeHash, `${label} runtime hash`),
    safe,
    authorityConfigurationSha256: expectedConfigurationSha256
  });
}
function releaseAttestationAuthorityBinding(raw) {
  exactKeys(raw, [
    "authorityId",
    "keyEpoch",
    "keyId",
    "publicKeySpkiSha256",
    "schemaVersion",
    "signatureScheme"
  ], "nested-factory release attestation authority");
  if (raw.schemaVersion !== "programmable.nested-factory-release-attestation-authority.v1" || raw.signatureScheme !== "ed25519") throw new TypeError("nested-factory release attestation authority is invalid");
  return deepFreeze({
    schemaVersion: raw.schemaVersion,
    authorityId: identifier(raw.authorityId, "release attestation authority id"),
    keyId: identifier(raw.keyId, "release attestation key id"),
    keyEpoch: decimalUint(raw.keyEpoch, 64, "release attestation key epoch"),
    signatureScheme: "ed25519",
    publicKeySpkiSha256: sha256(
      raw.publicKeySpkiSha256,
      "release attestation public key"
    )
  });
}
function safeConfiguration(raw, label) {
  exactKeys(raw, [
    "fallbackHandler",
    "fallbackHandlerRuntimeCodeHash",
    "fallbackHandlerStorageSlot",
    "guard",
    "guardRuntimeCodeHash",
    "guardStorageSlot",
    "masterCopy",
    "masterCopyRuntimeCodeHash",
    "moduleSentinel",
    "modules",
    "owners",
    "schemaVersion",
    "threshold",
    "version"
  ], `${label} Safe configuration`);
  if (raw.schemaVersion !== "programmable.nested-factory-safe-configuration.v1") {
    throw new TypeError(`${label} Safe configuration schema is invalid`);
  }
  const owners = canonicalAddressSet(raw.owners, `${label} Safe owners`, 32);
  if (!Array.isArray(raw.modules) || raw.modules.length > 64) {
    throw new TypeError(`${label} Safe modules size is invalid`);
  }
  const modules = raw.modules.map((module) => {
    exactKeys(module, ["address", "runtimeCodeHash"], `${label} Safe module`);
    return deepFreeze({
      address: address(module.address, `${label} Safe module address`),
      runtimeCodeHash: nonzeroBytes32(
        module.runtimeCodeHash,
        `${label} Safe module runtime hash`
      )
    });
  }).sort((left, right) => compareUtf8(left.address, right.address));
  if (new Set(modules.map(({ address: value }) => value)).size !== modules.length) {
    throw new TypeError(`${label} Safe modules contain duplicates`);
  }
  const threshold = decimalUint(raw.threshold, 64, `${label} Safe threshold`);
  if (BigInt(threshold) === 0n || BigInt(threshold) > BigInt(owners.length)) {
    throw new TypeError(`${label} Safe threshold is invalid`);
  }
  const fallbackHandler = addressOrZero(raw.fallbackHandler, `${label} Safe fallback handler`);
  const guard = addressOrZero(raw.guard, `${label} Safe guard`);
  const fallbackHandlerRuntimeCodeHash = optionalRuntimeHash(
    raw.fallbackHandlerRuntimeCodeHash,
    fallbackHandler,
    `${label} Safe fallback handler`
  );
  const guardRuntimeCodeHash = optionalRuntimeHash(
    raw.guardRuntimeCodeHash,
    guard,
    `${label} Safe guard`
  );
  return deepFreeze({
    schemaVersion: "programmable.nested-factory-safe-configuration.v1",
    version: boundedText(raw.version, `${label} Safe version`, 32),
    masterCopy: address(raw.masterCopy, `${label} Safe master copy`),
    masterCopyRuntimeCodeHash: nonzeroBytes32(
      raw.masterCopyRuntimeCodeHash,
      `${label} Safe master-copy runtime hash`
    ),
    owners,
    threshold,
    fallbackHandlerStorageSlot: nonzeroBytes32(
      raw.fallbackHandlerStorageSlot,
      `${label} Safe fallback slot`
    ),
    fallbackHandler,
    fallbackHandlerRuntimeCodeHash,
    guardStorageSlot: nonzeroBytes32(raw.guardStorageSlot, `${label} Safe guard slot`),
    guard,
    guardRuntimeCodeHash,
    moduleSentinel: address(raw.moduleSentinel, `${label} Safe module sentinel`),
    modules
  });
}
function runtimeBinding(raw, label) {
  return deepFreeze({
    address: address(raw.address, `${label} address`),
    runtimeCodeHash: nonzeroBytes32(raw.runtimeCodeHash, `${label} runtime hash`),
    abiSha256: sha256(raw.abiSha256, `${label} ABI`),
    source: sourceBinding(raw.source, `${label} source`)
  });
}
function sourceBinding(raw, label) {
  const repository = boundedText(raw.repository, `${label} repository`, 240);
  if (!repository.startsWith("https://github.com/0xprogrammable/")) {
    throw new TypeError(`${label} repository owner is invalid`);
  }
  return deepFreeze({
    repository,
    repositoryId: numericId(raw.repositoryId, `${label} repository id`),
    commit: gitObject(raw.commit, `${label} commit`),
    tree: gitObject(raw.tree, `${label} tree`),
    contractPath: repositoryPath(raw.contractPath, `${label} contract path`)
  });
}
function keccakWords(values) {
  return keccakBytes(concat(...values.map((value) => bytes32Bytes(value, "keccak word"))));
}
function hashText(value) {
  return keccakBytes(Buffer.from(value, "utf8"));
}
function keccakBytes(value) {
  return keccak256V1(value);
}
function word(value) {
  if (value < 0n || value >= 1n << 256n) throw new TypeError("uint256 word is out of range");
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}
function quantity(value) {
  if (value < 0n || value >= 1n << 256n) {
    throw new TypeError("nested-factory JSON-RPC quantity is out of range");
  }
  return `0x${value.toString(16)}`;
}
function addressWord(value) {
  return concat(new Uint8Array(12), Buffer.from(value.slice(2), "hex"));
}
function bytes32Bytes(value, label) {
  return Buffer.from(nonzeroBytes32(value, label).slice(2), "hex");
}
function hexBytes(value, label) {
  const normalized = rpcHex(value, label);
  return Buffer.from(normalized.slice(2), "hex");
}
function boundedHexBytes(value, maximumBytes, label) {
  const bytes = hexBytes(value, label);
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new TypeError(`${label} byte length is invalid`);
  }
  return bytes;
}
function concat(...parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  return value;
}
function rpcHex(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value)) {
    throw new TypeError(`${label} is not canonical hex data`);
  }
  return value;
}
function rpcQuantity(value, label) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)) {
    throw new TypeError(`${label} is not a canonical JSON-RPC quantity`);
  }
  return value;
}
function rpcWord(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is not one ABI word`);
  }
  return value;
}
function exactKeys(value, keys, label) {
  const object = record(value, label);
  const actual = Object.keys(object).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}
function address(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const normalized = value.toLowerCase();
  if (BigInt(normalized) === 0n) throw new TypeError(`${label} is zero`);
  return normalized;
}
function addressOrZero(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.toLowerCase();
}
function optionalRuntimeHash(value, account, label) {
  const isZero = BigInt(account) === 0n;
  if (isZero) {
    if (value !== null) throw new TypeError(`${label} runtime hash must be null for zero address`);
    return null;
  }
  if (value === null) throw new TypeError(`${label} runtime hash is absent`);
  return nonzeroBytes32(value, `${label} runtime hash`);
}
function canonicalAddressSet(raw, label, maximum, allowEmpty = false) {
  if (!Array.isArray(raw) || raw.length > maximum || !allowEmpty && raw.length === 0) {
    throw new TypeError(`${label} size is invalid`);
  }
  const values = raw.map((value) => address(value, label)).sort(compareUtf8);
  if (new Set(values).size !== values.length) throw new TypeError(`${label} contains duplicates`);
  return deepFreeze(values);
}
function nonzeroBytes32(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  if (BigInt(value) === 0n) throw new TypeError(`${label} is zero`);
  return value;
}
function sha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function rawSha256(value) {
  return `sha256:${createHash2("sha256").update(value).digest("hex")}`;
}
function decodeCanonicalBase64Url(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError(`${label} is not canonical base64url`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength === 0 || decoded.toString("base64url") !== value) {
    throw new TypeError(`${label} is not canonical base64url`);
  }
  return decoded;
}
function selector(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{8}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function exactSelector(value, expected, label) {
  if (selector(value, label) !== expected) throw new TypeError(`${label} drifted`);
  return expected;
}
function identifier(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:[._:@+-][a-z0-9]+)*$/u.test(value) || value.length > 160) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function numericId(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function gitObject(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value) || /^0+$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function repositoryPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 300 || value.startsWith("/") || value.includes("\\") || value.split("/").some((part) => part === "." || part === "..")) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function boundedText(value, label, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function canonicalInstant(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`${label} is not a canonical ISO-8601 instant`);
  }
  return value;
}
function decimalUint(value, bits, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  if (BigInt(value) >= 1n << BigInt(bits)) throw new TypeError(`${label} exceeds uint${bits}`);
  return value;
}
function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
if (NESTED_FACTORY_PROFILE_KEY_TYPEHASH_V1 !== "0xd31d9770f502a83c5557bddbcc0249b7a2ff20d8378b2c2d68e90fd5514d2a51" || NESTED_FACTORY_LAUNCH_ID_TYPEHASH_V1 !== "0x413ab600c8ae6041c8857d6fe1bfd086b08bc44e088686ff8b2d2f31cf8e893e" || NESTED_FACTORY_ROUTE_ID_HASH_V1 !== "0x034638c7b20fefd7b16f4a5af581f13efb5d97ba338c6199c54c914a7d3453fc" || NESTED_FACTORY_ROUTE_VERSION_HASH_V1 !== "0x06c015bd22b4c69690933c1058878ebdfef31f9aaae40bbe86d8a09fe1b2972c" || EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_HASH_V1 !== "0x80bf21eb2466daeb15cfbbc66749f03be10a9f84aa4060c8ce97146a93b8d33d" || EXACT_SHARDS_NESTED_FACTORY_PROFILE_KEY_V1 !== "0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c") throw new TypeError("nested-factory frozen hash constants drifted");
export {
  APPLICANT_ROUTE_ACCEPTANCE_SCHEMA_ID_V1,
  EXACT_SHARDS_APPLICANT_GITHUB_NUMERIC_USER_ID_V1,
  EXACT_SHARDS_APPLICANT_GITHUB_USER_ID_V1,
  EXACT_SHARDS_APPLICATION_MANIFEST_SHA256_V1,
  EXACT_SHARDS_CONFIGURATION_HASH_V1,
  EXACT_SHARDS_FACTORY_DEPLOYMENT_CALLDATA_HASH_V1,
  EXACT_SHARDS_FACTORY_DEPLOYMENT_PROXY_RUNTIME_HASH_V1,
  EXACT_SHARDS_FACTORY_DEPLOYMENT_PROXY_V1,
  EXACT_SHARDS_FACTORY_INIT_CODE_HASH_V1,
  EXACT_SHARDS_FACTORY_LAUNCH_CALLDATA_BYTES_V1,
  EXACT_SHARDS_FACTORY_LAUNCH_CALLDATA_HASH_V1,
  EXACT_SHARDS_FACTORY_LAUNCH_SELECTOR_V1,
  EXACT_SHARDS_FACTORY_PREDEPLOYMENT_PLAN_V1,
  EXACT_SHARDS_FACTORY_RUNTIME_HASH_V1,
  EXACT_SHARDS_FACTORY_SALT_V1,
  EXACT_SHARDS_FACTORY_V1,
  EXACT_SHARDS_FINAL_ROUTE_LEDGER_BINDING_V1,
  EXACT_SHARDS_HOOK_CREATION_CODE_HASH_V1,
  EXACT_SHARDS_HOOK_RUNTIME_HASH_V1,
  EXACT_SHARDS_HOOK_SALT_V1,
  EXACT_SHARDS_HOOK_V1,
  EXACT_SHARDS_INITIAL_TICK_V1,
  EXACT_SHARDS_LAUNCHER_FEE_RECIPIENT_V1,
  EXACT_SHARDS_LAUNCH_WALLET_V1,
  EXACT_SHARDS_MANIFEST_HASH_V1,
  EXACT_SHARDS_NESTED_FACTORY_DISABLED_CAPABILITY_V1,
  EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_HASH_V1,
  EXACT_SHARDS_NESTED_FACTORY_PROFILE_ID_V1,
  EXACT_SHARDS_NESTED_FACTORY_PROFILE_KEY_V1,
  EXACT_SHARDS_NESTED_FACTORY_PROFILE_SHA256_V1,
  EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_HASH_V1,
  EXACT_SHARDS_NESTED_FACTORY_PROFILE_VERSION_V1,
  EXACT_SHARDS_NFT_RUNTIME_HASH_V1,
  EXACT_SHARDS_NFT_V1,
  EXACT_SHARDS_PLANNED_FACTORY_DEPLOYER_V1,
  EXACT_SHARDS_POOL_ID_V1,
  EXACT_SHARDS_POOL_KEY_HASH_V1,
  EXACT_SHARDS_POOL_MANAGER_RUNTIME_HASH_V1,
  EXACT_SHARDS_POOL_MANAGER_V1,
  EXACT_SHARDS_POOL_STATE_SLOT_V1,
  EXACT_SHARDS_RENDERER_RUNTIME_HASH_V1,
  EXACT_SHARDS_RENDERER_V1,
  EXACT_SHARDS_REVENUE_POLICY_HASH_V1,
  EXACT_SHARDS_REVIEWED_REQUEST_PATH_V1,
  EXACT_SHARDS_SHARD_LAUNCHED_EVENT_TOPIC_V1,
  EXACT_SHARDS_SOURCE_REVISION_HASH_V1,
  EXACT_SHARDS_START_SQRT_PRICE_X96_V1,
  EXACT_SHARDS_TOKEN_RUNTIME_HASH_V1,
  EXACT_SHARDS_TOKEN_SALT_V1,
  EXACT_SHARDS_TOKEN_V1,
  HOOKBUILDER_ACCEPTANCE_PROTOCOL_BINDING_SHA256_V1,
  HOOKBUILDER_ACCEPTANCE_PROTOCOL_V1,
  NESTED_FACTORY_CAPABILITY_CATALOG_VERSION_V1,
  NESTED_FACTORY_DISABLED_CAPABILITY_CATALOG_V1,
  NESTED_FACTORY_EXECUTION_MODE_POLICY_V1,
  NESTED_FACTORY_GAS_BUFFER_DENOMINATOR_V1,
  NESTED_FACTORY_GAS_BUFFER_NUMERATOR_V1,
  NESTED_FACTORY_LAUNCH_ID_TYPEHASH_V1,
  NESTED_FACTORY_LAUNCH_STAMP_TYPEHASH_V1,
  NESTED_FACTORY_MAINNET_TRANSACTION_GAS_LIMIT_V1,
  NESTED_FACTORY_MAXIMUM_LAUNCH_PREFLIGHT_LIFETIME_SECONDS_V1,
  NESTED_FACTORY_MAXIMUM_PERMIT_LIFETIME_SECONDS_V1,
  NESTED_FACTORY_MAXIMUM_PLATFORM_RELEASE_LIFETIME_SECONDS_V1,
  NESTED_FACTORY_MINIMUM_REMAINING_PERMIT_SECONDS_V1,
  NESTED_FACTORY_POOL_KEY_TYPEHASH_V1,
  NESTED_FACTORY_PROFILE_KEY_TYPEHASH_V1,
  NESTED_FACTORY_REVIEWED_PLAN_SCHEMA_ID_V1,
  NESTED_FACTORY_ROUTE_ID_HASH_V1,
  NESTED_FACTORY_ROUTE_ID_V1,
  NESTED_FACTORY_ROUTE_VERSION_HASH_V1,
  NESTED_FACTORY_ROUTE_VERSION_V1,
  NestedFactoryCapabilityError,
  PROGRAMMABLE_LAUNCH_STAMPED_EVENT_TOPIC_V2,
  PROGRAMMABLE_NESTED_FACTORY_ROUTE_STAMPED_EVENT_TOPIC_V2,
  UNISWAP_V4_INITIALIZE_EVENT_TOPIC_V1,
  assertNestedFactoryApplicantAcceptanceHeadV1,
  assertNestedFactoryApplicantAcceptanceSubjectV1,
  assertNestedFactoryApplicantGrantV1,
  assertNestedFactoryAtomicDeploymentPlanV1,
  assertNestedFactoryCapabilityCatalogV1,
  assertNestedFactoryCapabilityV1,
  assertNestedFactoryCurrentnessEvidenceV1,
  assertNestedFactoryExistingLaunchAdoptionReceiptV1,
  assertNestedFactoryGasEvidenceV1,
  assertNestedFactoryLaunchFinalityEvidenceV1,
  assertNestedFactoryLaunchIdentityV1,
  assertNestedFactoryLaunchPreflightV1,
  assertNestedFactoryPermitReservationV1,
  assertNestedFactoryPlatformProfileReleaseStatementV1,
  assertNestedFactoryPredeploymentReceiptV1,
  assertSignedNestedFactoryPlatformProfileReleaseAttestationV1,
  assertVerifiedNestedFactoryCompiledRouteV1,
  assertVerifiedNestedFactoryPlatformProfileReleaseV1,
  assertWebsiteGithubSessionAuthorityV1,
  computeNestedFactoryLaunchStampHashV1,
  computeNestedFactoryProfileKeyV1,
  createDisabledNestedFactoryAuthorityReleaseV1,
  createNestedFactoryApplicantAcceptanceHeadV1,
  createNestedFactoryApplicantAcceptanceSubjectV1,
  createNestedFactoryApplicantGrantV1,
  createNestedFactoryAtomicDeploymentPlanV1,
  createNestedFactoryCapabilityCatalogV1,
  createNestedFactoryCapabilityV1,
  createNestedFactoryGasEvidenceV1,
  createNestedFactoryLaunchPreflightV1,
  createNestedFactoryPermitReservationV1,
  createNestedFactoryPlatformProfileReleaseStatementV1,
  createSignedNestedFactoryPlatformProfileReleaseAttestationV1,
  createWebsiteGithubSessionAuthorityV1,
  deriveNestedFactoryLaunchIdentityV1,
  nestedFactoryPlatformProfileReleaseSigningBytesV1,
  nestedFactoryReleaseAttestationAuthorityBindingHashV1,
  nestedFactoryRuntimeBindingHashV1,
  resolveEnabledNestedFactoryCapabilityV1,
  verifyCurrentNestedFactoryApplicantAcceptanceHeadV1,
  verifyNestedFactoryCompiledRouteV1,
  verifyNestedFactoryCurrentnessV1,
  verifyNestedFactoryDeploymentBytesV1,
  verifyNestedFactoryExistingLaunchAdoptionReceiptV1,
  verifyNestedFactoryGasEvidenceV1,
  verifyNestedFactoryLaunchFinalityEvidenceV1,
  verifyNestedFactoryPredeploymentReceiptV1,
  verifySignedNestedFactoryPlatformProfileReleaseAttestationV1
};
