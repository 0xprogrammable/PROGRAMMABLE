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
var StrictJsonParser = class {
  constructor(source, maximumDepth) {
    this.source = source;
    this.maximumDepth = maximumDepth;
  }
  source;
  maximumDepth;
  index = 0;
  parse() {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new StrictJsonError("Unexpected trailing input", this.index);
    }
    return value;
  }
  parseValue(depth) {
    if (depth > this.maximumDepth) {
      throw new StrictJsonError("Maximum JSON nesting depth exceeded", this.index);
    }
    const current = this.source[this.index];
    if (current === "{") return this.parseObject(depth + 1);
    if (current === "[") return this.parseArray(depth + 1);
    if (current === '"') return this.parseString();
    if (current === "t") return this.parseLiteral("true", true);
    if (current === "f") return this.parseLiteral("false", false);
    if (current === "n") return this.parseLiteral("null", null);
    if (current === "-" || current !== void 0 && current >= "0" && current <= "9") {
      return this.parseNumber();
    }
    throw new StrictJsonError("Expected a JSON value", this.index);
  }
  parseObject(depth) {
    this.index += 1;
    this.skipWhitespace();
    const result = /* @__PURE__ */ Object.create(null);
    const keys = /* @__PURE__ */ new Set();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      if (this.source[this.index] !== '"') {
        throw new StrictJsonError("Expected an object property name", this.index);
      }
      const keyOffset = this.index;
      const key = this.parseString();
      if (keys.has(key)) {
        throw new StrictJsonError(`Duplicate object property ${JSON.stringify(key)}`, keyOffset);
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ":") {
        throw new StrictJsonError("Expected ':' after object property", this.index);
      }
      this.index += 1;
      this.skipWhitespace();
      Object.defineProperty(result, key, {
        value: this.parseValue(depth),
        enumerable: true,
        configurable: false,
        writable: false
      });
      this.skipWhitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") {
        throw new StrictJsonError("Expected ',' or '}' in object", this.index);
      }
      this.index += 1;
      this.skipWhitespace();
    }
    throw new StrictJsonError("Unterminated object", this.index);
  }
  parseArray(depth) {
    this.index += 1;
    this.skipWhitespace();
    const result = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") {
        throw new StrictJsonError("Expected ',' or ']' in array", this.index);
      }
      this.index += 1;
      this.skipWhitespace();
    }
    throw new StrictJsonError("Unterminated array", this.index);
  }
  parseString() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code === 34) {
        this.index += 1;
        const token = this.source.slice(start, this.index);
        let decoded;
        try {
          decoded = JSON.parse(token);
        } catch {
          throw new StrictJsonError("Invalid JSON string", start);
        }
        assertUnicodeScalarString(decoded, start);
        return decoded;
      }
      if (code < 32) {
        throw new StrictJsonError("Unescaped control character in string", this.index);
      }
      if (code === 92) {
        const escape = this.source[this.index + 1];
        if (escape === void 0 || !'"\\/bfnrtu'.includes(escape)) {
          throw new StrictJsonError("Invalid JSON string escape", this.index);
        }
        this.index += 2;
        if (escape === "u") {
          const hex4 = this.source.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex4)) {
            throw new StrictJsonError("Invalid Unicode escape", this.index);
          }
          this.index += 4;
        }
        continue;
      }
      this.index += 1;
    }
    throw new StrictJsonError("Unterminated string", start);
  }
  parseNumber() {
    const remainder = this.source.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remainder);
    if (match === null) {
      throw new StrictJsonError("Invalid JSON number", this.index);
    }
    const token = match[0];
    this.index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new StrictJsonError("JSON number is outside the finite IEEE-754 range", this.index - token.length);
    }
    return value;
  }
  parseLiteral(token, value) {
    if (!this.source.startsWith(token, this.index)) {
      throw new StrictJsonError(`Expected ${token}`, this.index);
    }
    this.index += token.length;
    return value;
  }
  skipWhitespace() {
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return;
      this.index += 1;
    }
  }
};
function parseStrictJson(source, options = {}) {
  const maximumBytes = options.maximumBytes ?? 1048576;
  const maximumDepth = options.maximumDepth ?? 128;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new TypeError("maximumBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth <= 0) {
    throw new TypeError("maximumDepth must be a positive safe integer");
  }
  const byteLength = encoder.encode(source).byteLength;
  if (byteLength > maximumBytes) {
    throw new StrictJsonError(`JSON exceeds the ${maximumBytes}-byte limit`, 0);
  }
  return new StrictJsonParser(source, maximumDepth).parse();
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
function framedKeccakV1(domain, fields) {
  const framed = fields.flatMap((field) => {
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, field.byteLength, false);
    return [length, field];
  });
  return keccak256V1(concatBytes(
    Uint8Array.from(Buffer.from(domain, "utf8")),
    Uint8Array.of(0),
    ...framed
  ));
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

// src/internal/router-self-service-v1/production-binding.ts
var MANUAL_ROUTER_MINIMUM_REMAINING_SECONDS_V1 = 120;
var PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1 = deepFreeze({
  schemaVersion: "programmable.router-self-service-production-binding.v1",
  chain: {
    chainIdDecimal: "1",
    chainIdHex: "0x1",
    name: "Ethereum mainnet"
  },
  router: {
    address: "0x8622dd5bab44185f2a458ac90384ac99248f8d56",
    runtimeKeccak256: "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
    runtimeBytes: 23013,
    abiSha256: "sha256:bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86",
    launchAndStampSelector: "0xe5f6b8cd",
    permitDigestSelector: "0x0b2d0fef",
    domain: {
      name: "ProgrammableLaunchStampRouter",
      version: "1",
      separator: "0x2f376ea5e3e3529d254bc074bca5ab4d76ec9a60ba38eedb4b415152e3ff24bf"
    },
    deployment: {
      transactionHash: "0x3bc086661555c10040feb3fceb23d33003e22ca033e65cfae72592119ee8d486",
      blockNumber: "0x1886b6c",
      blockHash: "0x8e4512193217c2171624657717d32dbfe9896455e553cadc192fbfe32d3278bc",
      firstFinalizedEvidenceBlock: "0x1886b82",
      bindingSha256: "sha256:5efe94d58b6696ee95682f94dda02de0f21478f1a271ddebf36d00ef2b339fe2"
    }
  },
  permitAuthoritySafe: {
    address: "0x755509ea6e3f5ec1aa2e797bb68f1b87dd8b886b",
    runtimeKeccak256: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
    runtimeBytes: 171,
    version: "1.4.1",
    masterCopy: "0x41675c099f32341bf84bfc5382af534df5c7461a",
    fallbackHandler: "0xfd0732dc9e303f09fcef3a7388ad10a83459ec99",
    fallbackStorageSlot: "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5",
    guardStorageSlot: "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8",
    guard: "0x0000000000000000000000000000000000000000",
    moduleSentinel: "0x0000000000000000000000000000000000000001",
    modules: [],
    threshold: "1",
    manualOwner: "0x2bb333d48dfaf1596d9036671d2e43168994249e",
    safeMessageTypeHash: "0x60b3cbf8b4a223d68d641b3b6ddf9a298e7f33710cf3d3a9d1146b5a6150fbca",
    erc1271Selector: "0x1626ba7e",
    erc1271MagicWord: `0x1626ba7e${"0".repeat(56)}`
  },
  graphFactory: {
    address: "0xb012e4a8f2c5fc4e8e4faca9d5ad6fff13fba887",
    runtimeKeccak256: "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
    runtimeBytes: 7480,
    graphAuthorizationKeyTypeHash: "0x3e850f887a888dadea076a96f9f535205999c28967d94ed8e38fb8cde1a7fdb1"
  },
  poolManager: {
    address: "0x000000000004444c5dc75cb358380d2e3de08a90",
    runtimeKeccak256: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
    runtimeBytes: 24009
  },
  source: {
    commit: "0a7134bbb912222639627fb9078df2f8dd3a6c38",
    tree: "24ffb0c6b04af7993254560b4f03608de8f52231",
    contractSha256: "sha256:ef87aa9338c364634bffda64423bd3fb096c1630a45cc58ecf854d24959ff163",
    interfaceSha256: "sha256:e59aec528267f365179fb9d7720879ac0074cefa6807a8e3b7bd37003ba069f3",
    standardInputSha256: "sha256:f81f78d76220d6bb7ac6034f050820086ddf9a5ef9e4a13e7ea4e1c783c3cce3"
  },
  permit: {
    maximumLifetimeSeconds: 3600,
    manualMaximumLifetimeSeconds: 3600,
    defaultLifetimeSeconds: 2700,
    minimumRemainingLifetimeSeconds: MANUAL_ROUTER_MINIMUM_REMAINING_SECONDS_V1,
    clockSkewSeconds: 15,
    kindCustomGraph: 1
  },
  eventTopics: {
    launchStamped: "0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2",
    routeStamped: "0x45e7cc355b63ca67d6278a0d8d23470ce2a0741a9c60283d7dee712df7a877a5",
    componentStamped: "0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b"
  },
  selectors: {
    chainId: "0x85e1f4d0",
    permitAuthority: "0xc3a3d03c",
    graphFactory: "0x1cc9e5ce",
    poolManager: "0x62308e85",
    permitAuthorityRuntime: "0xa497c61c",
    graphFactoryRuntime: "0x92989a00",
    poolManagerRuntime: "0x38d831c4",
    safeMasterCopy: "0xa619486e",
    safeVersion: "0xffa1ad74",
    safeOwners: "0xa0e67e2b",
    safeThreshold: "0xe75235b8",
    safeModulesPaginated: "0xcc2f8452",
    stampProof: "0x174b9f9d",
    launchIdByToken: "0x1dad847c",
    launchIdByPool: "0x361df6f3",
    launchIdByComponent: "0x58c5e373",
    componentRuntimeCodeHash: "0xc892d353",
    launchStamp: "0x4c9e4764",
    consumedGraphAuthorization: "0x0ab3f132"
  }
});
function assertProductionRouterSelfServiceBindingV1() {
  const binding = PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1;
  const selector = selectorOf(
    "launchAndStampV1((uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes)"
  );
  if (selector !== binding.router.launchAndStampSelector) {
    throw new TypeError("Launch Stamp Router ABI selector binding drifted");
  }
  const permitSelector = selectorOf(
    "permitDigest((uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256))"
  );
  if (permitSelector !== binding.router.permitDigestSelector) {
    throw new TypeError("Launch Stamp Router permitDigest selector binding drifted");
  }
  if (selectorOf("isValidSignature(bytes32,bytes)") !== binding.permitAuthoritySafe.erc1271Selector || selectorOf("getModulesPaginated(address,uint256)") !== binding.selectors.safeModulesPaginated || selectorOf("consumedGraphAuthorization(bytes32)") !== binding.selectors.consumedGraphAuthorization || keccak256V1(Buffer.from(
    "ProgrammableCreate2GraphAuthorizationKeyV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,address authorizedLauncher)",
    "utf8"
  )) !== binding.graphFactory.graphAuthorizationKeyTypeHash) throw new TypeError("production ABI selector or type-hash binding drifted");
  for (const [label, value] of Object.entries({
    router: binding.router.address,
    permitAuthoritySafe: binding.permitAuthoritySafe.address,
    permitAuthorityManualOwner: binding.permitAuthoritySafe.manualOwner,
    graphFactory: binding.graphFactory.address,
    poolManager: binding.poolManager.address
  })) {
    if (!/^0x[0-9a-f]{40}$/u.test(value)) {
      throw new TypeError(`${label} production address binding is invalid`);
    }
  }
}
function selectorOf(signature) {
  return keccak256V1(Buffer.from(signature, "utf8")).slice(0, 10);
}
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
assertProductionRouterSelfServiceBindingV1();

// src/internal/router-self-service-v1/abi-codec.ts
var UINT256_MAX = (1n << 256n) - 1n;
var UINT64_MAX = (1n << 64n) - 1n;
var UINT24_MAX = (1n << 24n) - 1n;
var INT24_MIN = -(1n << 23n);
var INT24_MAX = (1n << 23n) - 1n;
var MAX_ROUTER_SIGNATURE_BYTES_V1 = 16384;
var SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
var SECP256K1_HALF_ORDER_V1 = SECP256K1_ORDER >> 1n;
var TYPEHASHES = Object.freeze({
  eip712Domain: hashText(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
  ),
  safeDomain: hashText("EIP712Domain(uint256 chainId,address verifyingContract)"),
  launchPermit: hashText(
    "ProgrammableLaunchPermitV1(uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)"
  ),
  expectedGraphOutput: hashText(
    "ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)"
  ),
  expectedGraphResult: hashText(
    "ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)"
  ),
  component: hashText(
    "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)"
  ),
  poolKey: hashText(
    "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"
  ),
  stampRequest: hashText(
    "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)"
  ),
  launchStamp: hashText(
    "ProgrammableLaunchStampV1(uint256 chainId,address router,bytes32 launchId,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 permitDigest,address poolManager,bytes32 poolId)"
  )
});
function canonicalizeCustomGraphLaunchV1(raw) {
  assertExactKeys(raw, ["route", "schemaVersion", "stampRequest", "valueWei"], "CustomGraph launch plan");
  if (raw.schemaVersion !== "programmable.router-custom-graph-launch-plan.v1") {
    throw new TypeError("CustomGraph launch plan schema is invalid");
  }
  const route = canonicalRoute(raw.route);
  const stampRequest = canonicalStampRequest(raw.stampRequest, route);
  const valueWei = decimalUint(raw.valueWei, 256, "CustomGraph launch value");
  const targetValue = route.targets.reduce(
    (sum, target) => sum + BigInt(target.deploymentValue) + BigInt(target.initializerValue),
    0n
  );
  if (targetValue !== BigInt(valueWei)) {
    throw new TypeError("CustomGraph target values do not equal launch value");
  }
  const plan = deepFreeze2({
    schemaVersion: "programmable.router-custom-graph-launch-plan.v1",
    route,
    stampRequest,
    valueWei
  });
  const routePayload = encodeCustomGraphRouteV1(route);
  const expectedResultHash = computeExpectedGraphResultHashV1(route);
  const componentSetHash = computeComponentSetHashV1(stampRequest.components);
  const poolKeyHash = computePoolKeyHashV1(stampRequest.poolKey);
  return deepFreeze2({
    plan,
    planHash: canonicalSha256("programmable.router-custom-graph-launch-plan.v1", plan),
    routePayload,
    routePayloadHash: keccakHex(routePayload),
    expectedResultHash,
    stampRequestHash: computeStampRequestHashV1(stampRequest),
    componentSetHash,
    poolKeyHash,
    poolId: computePoolIdV1(stampRequest.poolKey)
  });
}
function createLaunchPermitV1(input) {
  const wallet = address(input.launchWallet, "launch wallet");
  const validAfter = decimalUint(input.validAfter, 64, "permit valid-after");
  const deadline = decimalUint(input.deadline, 64, "permit deadline");
  if (BigInt(validAfter) > BigInt(deadline)) throw new TypeError("permit validity window is reversed");
  if (BigInt(deadline) - BigInt(validAfter) > BigInt(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permit.maximumLifetimeSeconds)) {
    throw new TypeError("permit lifetime exceeds the Router maximum");
  }
  return deepFreeze2({
    chainId: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal,
    router: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
    launchWallet: wallet,
    kind: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permit.kindCustomGraph,
    routePayloadHash: input.launch.routePayloadHash,
    expectedResultHash: input.launch.expectedResultHash,
    stampRequestHash: input.launch.stampRequestHash,
    nonce: input.nonce === void 0 ? input.launch.plan.route.routeNonce : nonzeroBytes32(input.nonce, "permit nonce"),
    validAfter,
    deadline,
    value: input.launch.plan.valueWei
  });
}
function encodeCustomGraphRouteV1(route) {
  const targets = encodeDynamicTupleArray(route.targets.map(encodeTargetTuple));
  const outputs = concat(
    word(BigInt(route.expectedOutputs.length)),
    ...route.expectedOutputs.map(encodeExpectedOutputTuple)
  );
  const headBytes = 7 * 32;
  const tuple = concat(
    bytes32(route.routeNamespace, "route namespace"),
    bytes32(route.routeNonce, "route nonce"),
    bytes32(route.topologyHash, "topology hash"),
    bytes32(route.graphCommitment, "graph commitment"),
    word(BigInt(headBytes)),
    word(BigInt(headBytes + targets.byteLength)),
    bytes32(route.expectedGraphDeploymentHash, "expected graph deployment hash"),
    targets,
    outputs
  );
  return hex(concat(word(32n), tuple));
}
function encodeLaunchAndStampCalldataV1(input) {
  const permitWords = encodePermitWords(input.permit);
  const stamp = encodeStampRequestTuple(input.stampRequest);
  const route = dynamicBytes(hexBytes(input.routePayload, "route payload"));
  const signatureBytes = hexBytes(input.signature, "permit signature");
  if (signatureBytes.byteLength === 0 || signatureBytes.byteLength > MAX_ROUTER_SIGNATURE_BYTES_V1) {
    throw new TypeError("permit signature length is outside the Router adapter bound");
  }
  const signature = dynamicBytes(signatureBytes);
  const headBytes = 14 * 32;
  return hex(concat(
    hexBytes(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.launchAndStampSelector, "launch selector"),
    permitWords,
    word(BigInt(headBytes)),
    word(BigInt(headBytes + stamp.byteLength)),
    word(BigInt(headBytes + stamp.byteLength + route.byteLength)),
    stamp,
    route,
    signature
  ));
}
function encodePermitDigestCallV1(permit) {
  return hex(concat(
    hexBytes(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.permitDigestSelector, "permitDigest selector"),
    encodePermitWords(permit)
  ));
}
function encodeErc1271CallV1(digest, signature) {
  const tail = dynamicBytes(hexBytes(signature, "ERC-1271 signature"));
  return hex(concat(
    hexBytes(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.erc1271Selector, "ERC-1271 selector"),
    bytes32(digest, "ERC-1271 digest"),
    word(64n),
    tail
  ));
}
function computePermitStructHashV1(permit) {
  return keccakBytes(concat(TYPEHASHES.launchPermit, encodePermitWords(permit)));
}
function computePermitDigestV1(permit) {
  const domainSeparator = computeRouterDomainSeparatorV1();
  return keccakBytes(concat(
    Uint8Array.of(25, 1),
    bytes32(domainSeparator, "Router domain separator"),
    bytes32(computePermitStructHashV1(permit), "permit struct hash")
  ));
}
function computeRouterDomainSeparatorV1() {
  const separator = keccakBytes(concat(
    TYPEHASHES.eip712Domain,
    keccakRaw(Buffer.from(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.domain.name, "utf8")),
    keccakRaw(Buffer.from(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.domain.version, "utf8")),
    word(BigInt(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal)),
    addressWord(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address, "Router domain address")
  ));
  if (separator !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.domain.separator) {
    throw new TypeError("Router EIP-712 domain separator drifted");
  }
  return separator;
}
function computeSafeMessageSigningDigestV1(permitDigest) {
  const safeDomain = keccakRaw(concat(
    TYPEHASHES.safeDomain,
    word(BigInt(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal)),
    addressWord(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address, "Safe domain address")
  ));
  const messageHash = keccakRaw(bytes32(permitDigest, "Safe message permit digest"));
  const messageStruct = keccakRaw(concat(
    bytes32(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.safeMessageTypeHash, "SafeMessage type hash"),
    messageHash
  ));
  return keccakBytes(concat(Uint8Array.of(25, 1), safeDomain, messageStruct));
}
function safeMessageTypedDataV1(permitDigest) {
  bytes32(permitDigest, "Safe typed-data permit digest");
  return deepFreeze2({
    domain: { chainId: 1, verifyingContract: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address },
    types: {
      EIP712Domain: [
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      SafeMessage: [{ name: "message", type: "bytes" }]
    },
    primaryType: "SafeMessage",
    message: { message: permitDigest }
  });
}
function computeExpectedGraphResultHashV1(route) {
  const outputHashes = route.expectedOutputs.map((output) => keccakRaw(concat(
    TYPEHASHES.expectedGraphOutput,
    word(BigInt(output.targetIndex)),
    bytes32(output.targetIdHash, "expected output target id"),
    addressWord(output.account, "expected output account"),
    bytes32(output.runtimeCodeHash, "expected output runtime hash")
  )));
  return keccakBytes(concat(
    TYPEHASHES.expectedGraphResult,
    keccakRaw(concat(...outputHashes)),
    bytes32(route.expectedGraphDeploymentHash, "expected graph deployment hash")
  ));
}
function computeComponentSetHashV1(components) {
  const hashes = components.map((component) => keccakRaw(concat(
    TYPEHASHES.component,
    word(BigInt(component.resultIndex)),
    addressWord(component.account, "stamp component account"),
    bytes32(component.runtimeCodeHash, "stamp component runtime hash"),
    word(BigInt(component.kind)),
    word(BigInt(component.scope))
  )));
  return keccakBytes(concat(...hashes));
}
function computePoolKeyHashV1(poolKey) {
  return keccakBytes(concat(TYPEHASHES.poolKey, encodePoolKeyWords(poolKey)));
}
function computePoolIdV1(poolKey) {
  return keccakBytes(encodePoolKeyWords(poolKey));
}
function computeStampRequestHashV1(request) {
  return keccakBytes(concat(
    TYPEHASHES.stampRequest,
    bytes32(request.launchId, "stamp launch id"),
    addressWord(request.token, "stamp token"),
    bytes32(request.tokenRuntimeCodeHash, "stamp token runtime hash"),
    bytes32(computePoolKeyHashV1(request.poolKey), "stamp pool key hash"),
    bytes32(request.hookRuntimeCodeHash, "stamp hook runtime hash"),
    bytes32(computeComponentSetHashV1(request.components), "stamp component set hash")
  ));
}
function computeLaunchStampHashV1(input) {
  return keccakBytes(concat(
    TYPEHASHES.launchStamp,
    word(BigInt(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal)),
    addressWord(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address, "launch stamp Router"),
    bytes32(input.stampRequest.launchId, "launch stamp launch id"),
    addressWord(input.permit.launchWallet, "launch stamp wallet"),
    word(BigInt(input.permit.kind)),
    bytes32(input.permit.routePayloadHash, "launch stamp route hash"),
    bytes32(input.permit.expectedResultHash, "launch stamp expected result hash"),
    bytes32(input.permit.stampRequestHash, "launch stamp request hash"),
    bytes32(input.permitDigest, "launch stamp permit digest"),
    addressWord(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.poolManager.address, "launch stamp PoolManager"),
    bytes32(computePoolIdV1(input.stampRequest.poolKey), "launch stamp pool id")
  ));
}
function canonicalRawSignatureV1(signature) {
  const raw = hexBytes(signature, "secp256k1 signature");
  if (raw.byteLength !== 65) throw new TypeError("secp256k1 signature must be 65 bytes");
  const r = BigInt(`0x${Buffer.from(raw.subarray(0, 32)).toString("hex")}`);
  const s = BigInt(`0x${Buffer.from(raw.subarray(32, 64)).toString("hex")}`);
  const v = raw[64];
  if (r === 0n || r >= SECP256K1_ORDER || s === 0n || s > SECP256K1_HALF_ORDER_V1) {
    throw new TypeError("secp256k1 signature is non-canonical");
  }
  if (v !== 27 && v !== 28) throw new TypeError("secp256k1 signature v must be 27 or 28");
  return hex(raw);
}
function canonicalRoute(raw) {
  assertExactKeys(raw, [
    "expectedGraphDeploymentHash",
    "expectedOutputs",
    "graphCommitment",
    "routeNamespace",
    "routeNonce",
    "targets",
    "topologyHash"
  ], "CustomGraph route");
  const routeNamespace = nonzeroBytes32(raw.routeNamespace, "route namespace");
  const routeNonce = nonzeroBytes32(raw.routeNonce, "route nonce");
  const topologyHash = nonzeroBytes32(raw.topologyHash, "topology hash");
  const graphCommitment = nonzeroBytes32(raw.graphCommitment, "graph commitment");
  const expectedGraphDeploymentHash = nonzeroBytes32(
    raw.expectedGraphDeploymentHash,
    "expected graph deployment hash"
  );
  if (!Array.isArray(raw.targets) || raw.targets.length === 0 || raw.targets.length > 16) {
    throw new TypeError("CustomGraph target count is invalid");
  }
  if (!Array.isArray(raw.expectedOutputs) || raw.expectedOutputs.length !== raw.targets.length) {
    throw new TypeError("CustomGraph expected output count is invalid");
  }
  const targets = raw.targets.map((target, index) => canonicalTarget(target, index));
  const outputs = raw.expectedOutputs.map((output, index) => canonicalOutput(output, targets[index], index));
  if (new Set(outputs.map(({ account }) => account)).size !== outputs.length) {
    throw new TypeError("CustomGraph expected output account is duplicated");
  }
  return deepFreeze2({
    routeNamespace,
    routeNonce,
    topologyHash,
    graphCommitment,
    targets,
    expectedOutputs: outputs,
    expectedGraphDeploymentHash
  });
}
function canonicalTarget(raw, index) {
  assertExactKeys(raw, [
    "applicantSalt",
    "deploymentValue",
    "initCode",
    "initializerCalldata",
    "initializerValue",
    "targetIdHash"
  ], `CustomGraph target ${index}`);
  const initCode = hexValue(raw.initCode, `target ${index} init code`);
  if (initCode === "0x") throw new TypeError(`target ${index} init code is empty`);
  return deepFreeze2({
    targetIdHash: nonzeroBytes32(raw.targetIdHash, `target ${index} id hash`),
    applicantSalt: bytes32Hex(raw.applicantSalt, `target ${index} applicant salt`),
    deploymentValue: decimalUint(raw.deploymentValue, 256, `target ${index} deployment value`),
    initializerValue: decimalUint(raw.initializerValue, 256, `target ${index} initializer value`),
    initCode,
    initializerCalldata: hexValue(raw.initializerCalldata, `target ${index} initializer calldata`)
  });
}
function canonicalOutput(raw, target, index) {
  assertExactKeys(raw, ["account", "runtimeCodeHash", "targetIdHash", "targetIndex"], `expected output ${index}`);
  const targetIndex = uint8Number(raw.targetIndex, `expected output ${index} target index`);
  const targetIdHash = bytes32Hex(raw.targetIdHash, `expected output ${index} target id`);
  if (targetIndex !== index || targetIdHash !== target.targetIdHash) {
    throw new TypeError(`expected output ${index} does not bind its target`);
  }
  return deepFreeze2({
    targetIndex,
    targetIdHash,
    account: nonzeroAddress(raw.account, `expected output ${index} account`),
    runtimeCodeHash: nonzeroBytes32(raw.runtimeCodeHash, `expected output ${index} runtime hash`)
  });
}
function canonicalStampRequest(raw, route) {
  assertExactKeys(raw, [
    "components",
    "hookRuntimeCodeHash",
    "launchId",
    "poolKey",
    "token",
    "tokenRuntimeCodeHash"
  ], "stamp request");
  const launchId = nonzeroBytes32(raw.launchId, "stamp launch id");
  const token = nonzeroAddress(raw.token, "stamp token");
  const tokenRuntimeCodeHash = nonzeroBytes32(raw.tokenRuntimeCodeHash, "stamp token runtime hash");
  const hookRuntimeCodeHash = nonzeroBytes32(raw.hookRuntimeCodeHash, "stamp hook runtime hash");
  const poolKey = canonicalPoolKey(raw.poolKey);
  if (poolKey.hooks === token) throw new TypeError("stamp token and hook must differ");
  if (token !== poolKey.currency0 && token !== poolKey.currency1) {
    throw new TypeError("stamp token is not a pool currency");
  }
  if (!Array.isArray(raw.components) || raw.components.length !== route.targets.length) {
    throw new TypeError("stamp component count does not match CustomGraph targets");
  }
  const components = raw.components.map((component, index) => canonicalComponent(component, route, index));
  for (let index = 1; index < components.length; ++index) {
    if (BigInt(components[index - 1].account) >= BigInt(components[index].account)) {
      throw new TypeError("stamp components must be strictly address-sorted");
    }
  }
  const tokenComponents = components.filter(({ account, kind, runtimeCodeHash }) => account === token && kind === 1 && runtimeCodeHash === tokenRuntimeCodeHash);
  const hookComponents = components.filter(({ account, kind, runtimeCodeHash }) => account === poolKey.hooks && kind === 2 && runtimeCodeHash === hookRuntimeCodeHash);
  if (tokenComponents.length !== 1 || hookComponents.length !== 1) {
    throw new TypeError("stamp request does not have one exact token and hook component");
  }
  for (const component of components) {
    const expectedKind = component.account === token ? 1 : component.account === poolKey.hooks ? 2 : 0;
    if (component.kind !== expectedKind) {
      throw new TypeError("stamp component kind does not match its bound account");
    }
  }
  return deepFreeze2({
    launchId,
    token,
    tokenRuntimeCodeHash,
    poolKey,
    hookRuntimeCodeHash,
    components
  });
}
function canonicalPoolKey(raw) {
  assertExactKeys(raw, ["currency0", "currency1", "fee", "hooks", "tickSpacing"], "pool key");
  const currency0 = address(raw.currency0, "pool currency0");
  const currency1 = address(raw.currency1, "pool currency1");
  const hooks = nonzeroAddress(raw.hooks, "pool hooks");
  if (BigInt(currency0) >= BigInt(currency1)) throw new TypeError("pool currencies are not canonical");
  const fee = uintNumber(raw.fee, UINT24_MAX, "pool fee");
  const tickSpacing = signedNumber(raw.tickSpacing, INT24_MIN, INT24_MAX, "pool tick spacing");
  return deepFreeze2({ currency0, currency1, fee, tickSpacing, hooks });
}
function canonicalComponent(raw, route, index) {
  assertExactKeys(raw, ["account", "kind", "resultIndex", "runtimeCodeHash", "scope"], `stamp component ${index}`);
  const resultIndex = uint8Number(raw.resultIndex, `stamp component ${index} result index`);
  if (resultIndex >= route.expectedOutputs.length) throw new TypeError(`stamp component ${index} result index is out of range`);
  const output = route.expectedOutputs[resultIndex];
  const account = nonzeroAddress(raw.account, `stamp component ${index} account`);
  const runtimeCodeHash = nonzeroBytes32(raw.runtimeCodeHash, `stamp component ${index} runtime hash`);
  const kind = uint8Number(raw.kind, `stamp component ${index} kind`);
  const scope = uint8Number(raw.scope, `stamp component ${index} scope`);
  if (scope !== 1 || account !== output.account || runtimeCodeHash !== output.runtimeCodeHash) {
    throw new TypeError(`stamp component ${index} does not bind one exclusive graph output`);
  }
  if (account === PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address || account === PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.poolManager.address) {
    throw new TypeError(`stamp component ${index} collides with shared infrastructure`);
  }
  return deepFreeze2({ resultIndex, account, runtimeCodeHash, kind, scope });
}
function encodeTargetTuple(target) {
  const initCode = dynamicBytes(hexBytes(target.initCode, "target init code"));
  const initializer = dynamicBytes(hexBytes(target.initializerCalldata, "target initializer calldata"));
  const headBytes = 6 * 32;
  return concat(
    bytes32(target.targetIdHash, "target id hash"),
    bytes32(target.applicantSalt, "target applicant salt"),
    word(BigInt(target.deploymentValue)),
    word(BigInt(target.initializerValue)),
    word(BigInt(headBytes)),
    word(BigInt(headBytes + initCode.byteLength)),
    initCode,
    initializer
  );
}
function encodeExpectedOutputTuple(output) {
  return concat(
    word(BigInt(output.targetIndex)),
    bytes32(output.targetIdHash, "expected output target id"),
    addressWord(output.account, "expected output account"),
    bytes32(output.runtimeCodeHash, "expected output runtime hash")
  );
}
function encodeDynamicTupleArray(elements) {
  const offsets = [];
  let offset = elements.length * 32;
  for (const element of elements) {
    offsets.push(word(BigInt(offset)));
    offset += element.byteLength;
  }
  return concat(word(BigInt(elements.length)), ...offsets, ...elements);
}
function encodePermitWords(permit) {
  if (decimalUint(permit.chainId, 256, "permit chain id") !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal || address(permit.router, "permit Router") !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address || permit.kind !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permit.kindCustomGraph) throw new TypeError("permit does not bind the production CustomGraph Router");
  return concat(
    word(BigInt(permit.chainId)),
    addressWord(permit.router, "permit Router"),
    addressWord(permit.launchWallet, "permit launch wallet"),
    word(BigInt(uint8Number(permit.kind, "permit kind"))),
    bytes32(permit.routePayloadHash, "permit route hash"),
    bytes32(permit.expectedResultHash, "permit expected result hash"),
    bytes32(permit.stampRequestHash, "permit stamp request hash"),
    nonzeroBytes32Bytes(permit.nonce, "permit nonce"),
    word(BigInt(decimalUint(permit.validAfter, 64, "permit valid-after"))),
    word(BigInt(decimalUint(permit.deadline, 64, "permit deadline"))),
    word(BigInt(decimalUint(permit.value, 256, "permit value")))
  );
}
function encodeStampRequestTuple(request) {
  const components = concat(
    word(BigInt(request.components.length)),
    ...request.components.map((component) => concat(
      word(BigInt(component.resultIndex)),
      addressWord(component.account, "stamp component account"),
      bytes32(component.runtimeCodeHash, "stamp component runtime hash"),
      word(BigInt(component.kind)),
      word(BigInt(component.scope))
    ))
  );
  const headBytes = 10 * 32;
  return concat(
    bytes32(request.launchId, "stamp launch id"),
    addressWord(request.token, "stamp token"),
    bytes32(request.tokenRuntimeCodeHash, "stamp token runtime hash"),
    encodePoolKeyWords(request.poolKey),
    bytes32(request.hookRuntimeCodeHash, "stamp hook runtime hash"),
    word(BigInt(headBytes)),
    components
  );
}
function encodePoolKeyWords(poolKey) {
  return concat(
    addressWord(poolKey.currency0, "pool currency0"),
    addressWord(poolKey.currency1, "pool currency1"),
    word(BigInt(poolKey.fee)),
    signedWord(BigInt(poolKey.tickSpacing), 24),
    addressWord(poolKey.hooks, "pool hooks")
  );
}
function dynamicBytes(value) {
  const padded = new Uint8Array(Math.ceil(value.byteLength / 32) * 32);
  padded.set(value);
  return concat(word(BigInt(value.byteLength)), padded);
}
function addressWord(value, label) {
  return concat(new Uint8Array(12), hexBytes(address(value, label), label));
}
function word(value) {
  if (value < 0n || value > UINT256_MAX) throw new TypeError("ABI uint256 word is out of range");
  return Uint8Array.from(Buffer.from(value.toString(16).padStart(64, "0"), "hex"));
}
function signedWord(value, width) {
  const modulus = 1n << BigInt(width);
  const minimum = -(1n << BigInt(width - 1));
  const maximum = (1n << BigInt(width - 1)) - 1n;
  if (value < minimum || value > maximum) throw new TypeError(`ABI int${width} word is out of range`);
  return word(value < 0n ? (1n << 256n) + value : value);
}
function bytes32(value, label) {
  const raw = hexBytes(value, label);
  if (raw.byteLength !== 32) throw new TypeError(`${label} is not bytes32`);
  return raw;
}
function nonzeroBytes32Bytes(value, label) {
  const raw = bytes32(value, label);
  if (raw.every((byte) => byte === 0)) throw new TypeError(`${label} is zero`);
  return raw;
}
function bytes32Hex(value, label) {
  return hex(bytes32(value, label));
}
function nonzeroBytes32(value, label) {
  return hex(nonzeroBytes32Bytes(value, label));
}
function address(value, label) {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) throw new TypeError(`${label} is not an EVM address`);
  return value.toLowerCase();
}
function nonzeroAddress(value, label) {
  const normalized = address(value, label);
  if (BigInt(normalized) === 0n) throw new TypeError(`${label} is zero`);
  return normalized;
}
function hexValue(value, label) {
  return hex(hexBytes(value, label));
}
function hexBytes(value, label) {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) throw new TypeError(`${label} is not canonical hex bytes`);
  return Uint8Array.from(Buffer.from(value.slice(2), "hex"));
}
function hex(value) {
  return `0x${Buffer.from(value).toString("hex")}`;
}
function decimalUint(value, width, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new TypeError(`${label} is not a canonical decimal uint`);
  const parsed = BigInt(value);
  const maximum = width === 64 ? UINT64_MAX : UINT256_MAX;
  if (parsed > maximum) throw new TypeError(`${label} exceeds uint${width}`);
  return value;
}
function uint8Number(value, label) {
  return uintNumber(value, 255n, label);
}
function uintNumber(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) > maximum) {
    throw new TypeError(`${label} is out of range`);
  }
  return value;
}
function signedNumber(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || BigInt(value) < minimum || BigInt(value) > maximum) {
    throw new TypeError(`${label} is out of range`);
  }
  return value;
}
function hashText(value) {
  return keccakRaw(Buffer.from(value, "utf8"));
}
function keccakHex(value) {
  return keccak256V1(hexBytes(value, "Keccak input"));
}
function keccakBytes(value) {
  return keccak256V1(value);
}
function keccakRaw(value) {
  return hexBytes(keccakBytes(value), "Keccak digest");
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
function assertExactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}
function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function deepFreeze2(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze2(nested);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/browser-action.ts
function normalizePendingNonceV1(value) {
  let parsed;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("pending nonce number is not a non-negative safe integer");
    }
    parsed = BigInt(value);
  } else if (typeof value === "bigint") {
    if (value < 0n) throw new TypeError("pending nonce bigint is negative");
    parsed = value;
  } else if (typeof value === "string") {
    if (/^(?:0|[1-9][0-9]*)$/u.test(value)) {
      parsed = BigInt(value);
    } else if (/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)) {
      parsed = BigInt(value);
    } else {
      throw new TypeError("pending nonce string is neither canonical decimal nor JSON-RPC quantity");
    }
  } else {
    throw new TypeError("pending nonce has an unsupported representation");
  }
  if (parsed >= 1n << 256n) throw new TypeError("pending nonce exceeds uint256");
  return parsed.toString(10);
}
function createBrowserWalletRouterActionV1(input) {
  if (input.permit.chainId !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal) {
    throw new TypeError("browser action permit is not bound to Ethereum mainnet");
  }
  if (input.permit.router !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address) {
    throw new TypeError("browser action permit is not bound to the production Router");
  }
  if (!/^0x[0-9a-f]{40}$/u.test(input.permit.launchWallet)) {
    throw new TypeError("browser action launch wallet is invalid");
  }
  if (!/^0x[0-9a-f]+$/u.test(input.calldata) || input.calldata.slice(0, 10) !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.launchAndStampSelector) {
    throw new TypeError("browser action calldata is not exact launchAndStampV1 calldata");
  }
  const value = BigInt(input.permit.value);
  const action = {
    schemaVersion: "programmable.browser-wallet-router-action.v1",
    walletExecutionKind: "eoa-direct",
    method: "eth_sendTransaction",
    chainId: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdHex,
    pendingNonceAtPreparation: input.pendingNonce === void 0 ? null : normalizePendingNonceV1(input.pendingNonce),
    params: [{
      from: input.permit.launchWallet,
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
      data: input.calldata,
      value: `0x${value.toString(16)}`
    }]
  };
  return deepFreeze3(action);
}
function deepFreeze3(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze3(nested);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/github-approval.ts
import { createHash as createHash3 } from "node:crypto";

// src/github-rest/types.ts
var GITHUB_REST_API_VERSION = "2026-03-10";
var GITHUB_REST_ACCEPT = "application/vnd.github+json";
var GITHUB_REST_USER_AGENT = "programmable-autonomous-approval-v1";

// src/internal/router-self-service-v1/hookbuilder-applicant-request.ts
import { createHash as createHash2 } from "node:crypto";
var HOOKBUILDER_APPLICANT_REQUEST_MAXIMUM_BYTES_V1 = 65536;
var HOOKBUILDER_APPLICANT_CANONICALIZATION_V1 = "urn:programmable:canonical-json:2.0.0";
var HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1 = deepFreeze4({
  schemaVersion: "programmable.hookbuilder-applicant-1.1-public-main-binding.v1",
  repository: "https://github.com/0xprogrammable/hookbuilder",
  commitSha: "279dd2fc2ea8c488943ca4e60ca889cb00bab40e",
  treeSha: "48149d436bf222c440980e1fc31a71899b833af7",
  schemaPath: "submissions/schema/applicant-submission-v1.schema.json",
  schemaSha256: "sha256:8d250114631d20f42e02ab195d80bd0123ff970cd07f7fd328b874b8abac87b5",
  semanticCorePath: "scripts/applicant-submission-core.mjs",
  semanticCoreSha256: "sha256:9bfcf57828929f8705b78b28eb0988ab7c2a966b6397829435916e94371d77c6",
  examplePath: "submissions/examples/applicant-submission-v1.example.json",
  exampleRawByteLength: 1766,
  exampleRawSha256: "sha256:b33e808a5d43164813890117f5cac28f1b193285f595865b38f50d3ef471f11e",
  canonicalization: HOOKBUILDER_APPLICANT_CANONICALIZATION_V1,
  canonicalExampleByteLength: 1438,
  canonicalExampleSha256: "sha256:6575ab84fe93f388e96a7f042a7377859dfcd435e9c2810704e621b6a78a5794",
  requestPathTemplate: "submissions/requests/<source.repositoryId>-<identifiers.hookId>.json",
  requestedRoute: Object.freeze({
    routeId: "custom-graph",
    routeVersion: "1.0.0",
    chainId: "1"
  })
});
var PERMISSION_KEYS = Object.freeze([
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
var PERMISSION_BITS = Object.freeze(Object.fromEntries(
  PERMISSION_KEYS.map((key, index) => [key, 1 << PERMISSION_KEYS.length - 1 - index])
));
function createHookbuilderApplicantRequestEvidenceV1(input) {
  const raw = strictRequest(input.rawJsonUtf8, "raw Hookbuilder Applicant request");
  const canonical = strictRequest(
    input.canonicalJsonUtf8,
    "canonical Hookbuilder Applicant request"
  );
  if (canonicalizeJson(raw) !== input.canonicalJsonUtf8 || canonicalizeJson(canonical) !== input.canonicalJsonUtf8) {
    throw new TypeError("Hookbuilder Applicant canonical bytes do not match the raw request semantics");
  }
  const request = assertHookbuilderApplicantSubmissionV1(canonical);
  const expectedPath = hookbuilderApplicantRequestPathV1({
    sourceRepositoryId: String(request.source.repositoryId),
    hookId: request.identifiers.hookId
  });
  if (input.requestPath !== expectedPath) {
    throw new TypeError("Hookbuilder Applicant request path is not deterministic");
  }
  const rawByteLength = Buffer.byteLength(input.rawJsonUtf8, "utf8");
  const canonicalByteLength = Buffer.byteLength(input.canonicalJsonUtf8, "utf8");
  const core = {
    schemaVersion: "programmable.hookbuilder-applicant-request-evidence.v1",
    requestPath: expectedPath,
    rawJsonUtf8: input.rawJsonUtf8,
    rawByteLength,
    rawSha256: rawSha256(input.rawJsonUtf8),
    canonicalization: HOOKBUILDER_APPLICANT_CANONICALIZATION_V1,
    canonicalJsonUtf8: input.canonicalJsonUtf8,
    canonicalByteLength,
    canonicalSha256: rawSha256(input.canonicalJsonUtf8)
  };
  return deepFreeze4({
    evidence: {
      ...core,
      evidenceHash: canonicalSha256(core.schemaVersion, core)
    },
    request,
    launchWallet: normalizeEip55Address(request.applicant.launchWallet, "Applicant launch wallet")
  });
}
function assertHookbuilderApplicantRequestEvidenceV1(raw) {
  assertExactKeys2(raw, [
    "canonicalByteLength",
    "canonicalJsonUtf8",
    "canonicalSha256",
    "canonicalization",
    "evidenceHash",
    "rawByteLength",
    "rawJsonUtf8",
    "rawSha256",
    "requestPath",
    "schemaVersion"
  ], "Hookbuilder Applicant request evidence");
  if (raw.schemaVersion !== "programmable.hookbuilder-applicant-request-evidence.v1") {
    throw new TypeError("Hookbuilder Applicant request evidence schema is invalid");
  }
  const rebuilt = createHookbuilderApplicantRequestEvidenceV1({
    requestPath: raw.requestPath,
    rawJsonUtf8: raw.rawJsonUtf8,
    canonicalJsonUtf8: raw.canonicalJsonUtf8
  });
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt.evidence)) {
    throw new TypeError("Hookbuilder Applicant request evidence is invalid");
  }
  return rebuilt;
}
function hookbuilderApplicantRequestPathV1(input) {
  if (!/^[1-9][0-9]{0,15}$/u.test(input.sourceRepositoryId)) {
    throw new TypeError("Hookbuilder Applicant source repository id is invalid");
  }
  const hookId = id(input.hookId, "Hookbuilder Applicant hook id");
  return `submissions/requests/${input.sourceRepositoryId}-${hookId}.json`;
}
function assertHookbuilderApplicantSubmissionV1(raw) {
  assertExactKeys2(raw, [
    "$schema",
    "applicant",
    "fee",
    "hook",
    "identifiers",
    "intake",
    "notes",
    "requestedActions",
    "requestedRoute",
    "schemaVersion",
    "source"
  ], "Hookbuilder Applicant request");
  if (raw.$schema !== "urn:programmable:applicant-submission:1.1.0" || raw.schemaVersion !== "1.1.0") throw new TypeError("Hookbuilder Applicant request schema is invalid");
  assertExactKeys2(raw.intake, ["repository", "repositoryId"], "Hookbuilder intake");
  if (raw.intake.repository !== "0xprogrammable/hookbuilder" || raw.intake.repositoryId !== 1320085947) throw new TypeError("Hookbuilder Applicant intake binding is invalid");
  assertExactKeys2(raw.applicant, ["githubLogin", "launchWallet"], "Hookbuilder applicant");
  const githubLogin = githubLoginValue(raw.applicant.githubLogin);
  const launchWallet = eip55Address(raw.applicant.launchWallet, "Applicant launch wallet");
  assertExactKeys2(raw.source, ["commit", "repository", "repositoryId", "tree"], "Applicant source");
  const sourceRepositoryId = positiveSafeInteger(raw.source.repositoryId, "source repository id");
  const sourceRepository = repositoryUrl(raw.source.repository);
  const sourceCommit = gitSha(raw.source.commit, "source commit");
  const sourceTree = gitSha(raw.source.tree, "source tree");
  assertExactKeys2(raw.identifiers, [
    "hookId",
    "hookVersion",
    "modelId",
    "modelVersion",
    "templateId",
    "templateVersion"
  ], "Applicant identifiers");
  const identifiers = {
    hookId: id(raw.identifiers.hookId, "hook id"),
    hookVersion: semver(raw.identifiers.hookVersion, "hook version"),
    templateId: id(raw.identifiers.templateId, "template id"),
    templateVersion: semver(raw.identifiers.templateVersion, "template version"),
    modelId: id(raw.identifiers.modelId, "model id"),
    modelVersion: semver(raw.identifiers.modelVersion, "model version")
  };
  assertExactKeys2(raw.hook, ["addressFlagMask", "permissions"], "Applicant hook");
  if (typeof raw.hook.addressFlagMask !== "string" || !/^0x[0-3][0-9a-fA-F]{3}$/u.test(raw.hook.addressFlagMask)) {
    throw new TypeError("Applicant hook address flag mask is invalid");
  }
  assertExactKeys2(raw.hook.permissions, PERMISSION_KEYS, "Applicant hook permissions");
  const rawPermissions = raw.hook.permissions;
  const permissions = Object.fromEntries(PERMISSION_KEYS.map((key) => {
    const value = rawPermissions[key];
    if (typeof value !== "boolean") throw new TypeError(`Applicant hook permission ${key} is invalid`);
    return [key, value];
  }));
  const expectedAddressFlagMask = `0x${PERMISSION_KEYS.reduce(
    (mask, key) => permissions[key] ? mask | PERMISSION_BITS[key] : mask,
    0
  ).toString(16).padStart(4, "0")}`;
  if (raw.hook.addressFlagMask !== expectedAddressFlagMask) {
    throw new TypeError("Applicant hook address flag mask does not match its 14 permissions");
  }
  assertExactKeys2(raw.fee, [
    "amountPips",
    "currencyBasis",
    "denominator",
    "mutable",
    "recipient"
  ], "Applicant fee");
  const amountPips = nonnegativeSafeInteger(raw.fee.amountPips, "fee amount pips");
  if (amountPips > 1e6 || raw.fee.denominator !== 1e6) {
    throw new TypeError("Applicant fee denominator or amount is invalid");
  }
  if (!["input", "output", "quote", "none"].includes(raw.fee.currencyBasis)) {
    throw new TypeError("Applicant fee currency basis is invalid");
  }
  if (typeof raw.fee.mutable !== "boolean") throw new TypeError("Applicant fee mutability is invalid");
  const feeRecipient = raw.fee.recipient === null ? null : evmAddress(raw.fee.recipient, "fee recipient", false);
  if (amountPips === 0 && (raw.fee.currencyBasis !== "none" || feeRecipient !== null) || amountPips > 0 && (raw.fee.currencyBasis === "none" || feeRecipient === null)) throw new TypeError("Applicant fee amount, basis, and recipient are inconsistent");
  assertExactKeys2(raw.requestedRoute, [
    "chainId",
    "routeId",
    "routeVersion"
  ], "Applicant requested route");
  const routeId = id(raw.requestedRoute.routeId, "route id");
  const routeVersion = semver(raw.requestedRoute.routeVersion, "route version");
  if (typeof raw.requestedRoute.chainId !== "string" || !/^[1-9][0-9]{0,77}$/u.test(raw.requestedRoute.chainId)) {
    throw new TypeError("Applicant requested chain id is invalid");
  }
  if (!Array.isArray(raw.requestedActions) || raw.requestedActions.length !== 1 || raw.requestedActions[0] !== "review") throw new TypeError("Applicant requested actions are invalid");
  if (routeId !== "custom-graph" || routeVersion !== "1.0.0" || raw.requestedRoute.chainId !== "1") {
    throw new TypeError("Applicant requested route is not supported by the manual Router beta");
  }
  if (raw.notes !== null && (typeof raw.notes !== "string" || [...raw.notes].length > 1e3)) {
    throw new TypeError("Applicant notes are invalid");
  }
  return deepFreeze4({
    $schema: raw.$schema,
    schemaVersion: raw.schemaVersion,
    intake: {
      repository: raw.intake.repository,
      repositoryId: raw.intake.repositoryId
    },
    applicant: { githubLogin, launchWallet },
    source: {
      repository: sourceRepository,
      repositoryId: sourceRepositoryId,
      commit: sourceCommit,
      tree: sourceTree
    },
    identifiers,
    hook: { addressFlagMask: raw.hook.addressFlagMask, permissions },
    fee: {
      amountPips,
      denominator: 1e6,
      currencyBasis: raw.fee.currencyBasis,
      recipient: feeRecipient === null ? null : raw.fee.recipient,
      mutable: raw.fee.mutable
    },
    requestedRoute: {
      routeId: "custom-graph",
      routeVersion: "1.0.0",
      chainId: "1"
    },
    requestedActions: ["review"],
    notes: raw.notes
  });
}
function strictRequest(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} is not a string`);
  try {
    return parseStrictJson(value, {
      maximumBytes: HOOKBUILDER_APPLICANT_REQUEST_MAXIMUM_BYTES_V1,
      maximumDepth: 32
    });
  } catch (error) {
    throw new TypeError(`${label} is invalid`, { cause: error });
  }
}
function rawSha256(value) {
  return `sha256:${createHash2("sha256").update(value, "utf8").digest("hex")}`;
}
function githubLoginValue(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value)) {
    throw new TypeError("Applicant GitHub login is invalid");
  }
  return value;
}
function id(value, label) {
  if (typeof value !== "string" || value.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function semver(value, label) {
  if (typeof value !== "string" || value.length > 100 || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function repositoryUrl(value) {
  if (typeof value !== "string" || value.length > 200 || !/^https:\/\/github\.com\/(?![^/]*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}$)(?!.*\.git$)(?=[A-Za-z0-9._-]*[A-Za-z0-9])[A-Za-z0-9._-]{1,100}$/u.test(value)) throw new TypeError("Applicant source repository URL is invalid");
  return value;
}
function gitSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} is invalid`);
  return value;
}
function nonnegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`);
  return value;
}
function eip55Address(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value) || BigInt(value) === 0n) {
    throw new TypeError(`${label} is invalid`);
  }
  const lower = value.slice(2).toLowerCase();
  const hash = keccak256V1(Buffer.from(lower, "ascii")).slice(2);
  let checksum = "0x";
  for (let index = 0; index < lower.length; index += 1) {
    const character = lower[index];
    checksum += /[a-f]/u.test(character) && Number.parseInt(hash[index], 16) >= 8 ? character.toUpperCase() : character;
  }
  if (value !== checksum) throw new TypeError(`${label} is not canonical EIP-55`);
  return value;
}
function normalizeEip55Address(value, label) {
  return eip55Address(value, label).toLowerCase();
}
function evmAddress(value, label, allowZero) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && BigInt(normalized) === 0n) throw new TypeError(`${label} is zero`);
  return normalized;
}
function assertExactKeys2(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  const actual = Reflect.ownKeys(value);
  const stringKeys = actual.filter((key) => typeof key === "string").sort(compare);
  const wanted = [...expected].sort(compare);
  if (actual.length !== stringKeys.length || stringKeys.length !== wanted.length || stringKeys.some((key, index) => key !== wanted[index])) throw new TypeError(`${label} has unexpected fields`);
}
function compare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function deepFreeze4(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze4(nested);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/github-approval.ts
var PRODUCTION_GITHUB_IDENTITY = Object.freeze({
  repositoryId: "1320085947",
  owner: "0xprogrammable",
  name: "hookbuilder"
});
function loadProductionGitHubApprovalBindingV1(env) {
  const configured = env.PROGRAMMABLE_ROUTER_GITHUB_REPOSITORY_ID;
  if (configured !== void 0 && configured !== PRODUCTION_GITHUB_IDENTITY.repositoryId) {
    throw new TypeError("PROGRAMMABLE_ROUTER_GITHUB_REPOSITORY_ID does not match the code-owned production binding");
  }
  return Object.freeze({
    schemaVersion: "programmable.router-github-approval-binding.v1",
    ...PRODUCTION_GITHUB_IDENTITY
  });
}
function assertProductionGitHubApprovalBindingV1(raw) {
  assertExactKeys3(raw, [
    "name",
    "owner",
    "repositoryId",
    "schemaVersion"
  ], "production GitHub approval binding");
  if (raw.schemaVersion !== "programmable.router-github-approval-binding.v1" || raw.repositoryId !== PRODUCTION_GITHUB_IDENTITY.repositoryId || raw.owner !== PRODUCTION_GITHUB_IDENTITY.owner || raw.name !== PRODUCTION_GITHUB_IDENTITY.name) throw new TypeError("production GitHub approval binding identity drifted");
  return Object.freeze({
    schemaVersion: raw.schemaVersion,
    ...PRODUCTION_GITHUB_IDENTITY
  });
}
function canonicalGitHubApprovalClaimV1(raw) {
  assertExactKeys3(raw, [
    "approvalRevision",
    "approvedGitHubUserId",
    "approvedLaunchWallet",
    "compileInputHash",
    "headRepositoryId",
    "headSha",
    "planHash",
    "pullRequestNumber",
    "repositoryId",
    "schemaVersion",
    "treeSha"
  ], "GitHub approval claim");
  if (raw.schemaVersion !== "programmable.github-router-launch-approval-claim.v3") {
    throw new TypeError("GitHub approval claim schema is invalid");
  }
  if (raw.repositoryId !== PRODUCTION_GITHUB_IDENTITY.repositoryId) {
    throw new TypeError("GitHub approval claim is not bound to the production intake repository");
  }
  if (!Number.isSafeInteger(raw.pullRequestNumber) || raw.pullRequestNumber <= 0) {
    throw new TypeError("GitHub approval pull-request number is invalid");
  }
  const approvalRevision = canonicalRouterApprovalRevisionV1(raw.approvalRevision);
  const headSha = gitSha2(raw.headSha, "GitHub approval head SHA");
  const treeSha = gitSha2(raw.treeSha, "GitHub approval tree SHA");
  if (approvalRevision.repositoryId !== raw.repositoryId || approvalRevision.headSha !== `0x${headSha}` || approvalRevision.treeSha !== `0x${treeSha}`) throw new TypeError("Router approval revision does not match the claimed GitHub revision");
  return deepFreeze5({
    schemaVersion: raw.schemaVersion,
    repositoryId: numericId(raw.repositoryId, "GitHub approval repository id"),
    pullRequestNumber: raw.pullRequestNumber,
    headRepositoryId: numericId(raw.headRepositoryId, "GitHub approval head repository id"),
    headSha,
    treeSha,
    approvedGitHubUserId: numericId(raw.approvedGitHubUserId, "approved GitHub user id"),
    approvedLaunchWallet: address2(raw.approvedLaunchWallet, "approved launch wallet"),
    compileInputHash: sha256(raw.compileInputHash, "GitHub approval compile-input hash"),
    planHash: sha256(raw.planHash, "GitHub approval plan hash"),
    approvalRevision
  });
}
function computeGitHubApprovalBindingHashV1(claim) {
  return canonicalSha256(
    "programmable.github-router-launch-approval.v3",
    canonicalGitHubApprovalClaimV1(claim)
  );
}
function computeRouterApprovalRevisionHashV1(revision) {
  return canonicalSha256(
    "programmable.router-approval-revision.v2",
    canonicalRouterApprovalRevisionV1(revision)
  );
}
function canonicalGitHubApplicantSourceRevisionV1(raw) {
  assertExactKeys3(raw, [
    "commitSha",
    "repositoryId",
    "repositoryUrl",
    "treeSha"
  ], "GitHub Applicant source revision");
  return Object.freeze({
    repositoryId: numericId(raw.repositoryId, "Applicant source repository id"),
    repositoryUrl: publicGitHubRepositoryUrl(raw.repositoryUrl),
    commitSha: gitSha2(raw.commitSha, "Applicant source commit SHA"),
    treeSha: gitSha2(raw.treeSha, "Applicant source tree SHA")
  });
}
function assertVerifiedGitHubRouterApprovalV1(raw) {
  assertExactKeys3(raw, [
    "approvalBindingHash",
    "claim",
    "pullRequestAuthorGitHubLogin",
    "pullRequestAuthorGitHubUserId",
    "pullRequestHeadRepositoryUrl",
    "pullRequestState",
    "schemaVersion",
    "sourceCommitSha",
    "sourceRepositoryId",
    "sourceRepositoryUrl",
    "sourceTreeSha",
    "verifiedAtEpochSeconds"
  ], "verified GitHub Router approval");
  if (raw.schemaVersion !== "programmable.verified-github-router-launch-approval.v6") {
    throw new TypeError("verified GitHub Router approval schema is invalid");
  }
  const claim = canonicalGitHubApprovalClaimV1(raw.claim);
  const approvalBindingHash = computeGitHubApprovalBindingHashV1(claim);
  const pullRequestAuthorGitHubUserId = numericId(
    raw.pullRequestAuthorGitHubUserId,
    "pull-request author GitHub user id"
  );
  if (raw.approvalBindingHash !== approvalBindingHash || pullRequestAuthorGitHubUserId !== claim.approvedGitHubUserId || raw.pullRequestState !== "open" && raw.pullRequestState !== "merged") throw new TypeError("verified GitHub Router approval binding is invalid");
  return deepFreeze5({
    schemaVersion: raw.schemaVersion,
    claim,
    approvalBindingHash,
    pullRequestAuthorGitHubUserId,
    pullRequestAuthorGitHubLogin: requiredBoundedText(
      raw.pullRequestAuthorGitHubLogin,
      "pull-request author GitHub login",
      255
    ),
    pullRequestHeadRepositoryUrl: publicGitHubRepositoryUrl(
      raw.pullRequestHeadRepositoryUrl
    ),
    sourceRepositoryId: numericId(raw.sourceRepositoryId, "verified source repository id"),
    sourceRepositoryUrl: publicGitHubRepositoryUrl(raw.sourceRepositoryUrl),
    sourceCommitSha: gitSha2(raw.sourceCommitSha, "verified source commit SHA"),
    sourceTreeSha: gitSha2(raw.sourceTreeSha, "verified source tree SHA"),
    pullRequestState: raw.pullRequestState,
    verifiedAtEpochSeconds: uintString64(
      raw.verifiedAtEpochSeconds,
      "GitHub approval verification time"
    )
  });
}
function canonicalRouterApprovalRevisionV1(raw) {
  assertExactKeys3(raw, [
    "approvalId",
    "approvalVersion",
    "authorizedPrincipalHash",
    "configurationHash",
    "evidenceDigest",
    "headSha",
    "policyHash",
    "repositoryId",
    "reviewArtifactHash",
    "schemaVersion",
    "treeSha"
  ], "Router approval revision");
  if (raw.schemaVersion !== "programmable.router-approval-revision.v2") {
    throw new TypeError("Router approval revision schema is invalid");
  }
  return deepFreeze5({
    schemaVersion: raw.schemaVersion,
    approvalId: nonzeroBytes322(raw.approvalId, "approval id"),
    repositoryId: uintString64(raw.repositoryId, "approval repository id"),
    headSha: bytes20(raw.headSha, "approval head SHA"),
    treeSha: bytes20(raw.treeSha, "approval tree SHA"),
    reviewArtifactHash: nonzeroBytes322(raw.reviewArtifactHash, "review artifact hash"),
    configurationHash: nonzeroBytes322(raw.configurationHash, "review configuration hash"),
    evidenceDigest: nonzeroBytes322(raw.evidenceDigest, "review evidence digest"),
    policyHash: nonzeroBytes322(raw.policyHash, "review policy hash"),
    approvalVersion: uintString64(raw.approvalVersion, "approval version"),
    authorizedPrincipalHash: nonzeroBytes322(
      raw.authorizedPrincipalHash,
      "authorized principal hash"
    )
  });
}
var GitHubRestApprovalCurrentnessVerifierV1 = class {
  #binding;
  #readTokens;
  #fetch;
  #now;
  constructor(input) {
    this.#binding = assertProductionGitHubApprovalBindingV1(input.binding);
    this.#readTokens = input.readTokenProvider;
    this.#fetch = input.fetch;
    this.#now = input.nowEpochSeconds ?? (() => Math.floor(Date.now() / 1e3));
    Object.freeze(this);
  }
  async verifyCurrentApproval(rawClaim, rawApplicantRequest, rawSourceRevision) {
    const claim = canonicalGitHubApprovalClaimV1(rawClaim);
    const applicant = assertHookbuilderApplicantRequestEvidenceV1(
      rawApplicantRequest
    );
    const applicantRequest = applicant.evidence;
    const sourceRevision2 = canonicalGitHubApplicantSourceRevisionV1(rawSourceRevision);
    if (String(applicant.request.source.repositoryId) !== sourceRevision2.repositoryId || applicant.request.source.repository !== sourceRevision2.repositoryUrl || applicant.request.source.commit !== sourceRevision2.commitSha || applicant.request.source.tree !== sourceRevision2.treeSha) throw new TypeError("GitHub source revision drifts from the exact Applicant request");
    const token = await this.#readTokens.getReadToken();
    const headers = authorizationHeaders(token.token);
    const [
      repositoryValue,
      pullValue,
      pullFilesValue,
      headRepositoryValue,
      headCommitValue,
      applicantFileValue,
      sourceRepositoryValue,
      sourceCommitValue
    ] = await Promise.all([
      this.#get(`/repositories/${this.#binding.repositoryId}`, headers),
      this.#get(
        `/repositories/${this.#binding.repositoryId}/pulls/${claim.pullRequestNumber}`,
        headers
      ),
      this.#get(
        `/repositories/${this.#binding.repositoryId}/pulls/${claim.pullRequestNumber}/files?per_page=2&page=1`,
        headers
      ),
      this.#get(
        `/repositories/${claim.headRepositoryId}`,
        headers
      ),
      this.#get(
        `/repositories/${claim.headRepositoryId}/git/commits/${claim.headSha}`,
        headers
      ),
      this.#get(
        `/repositories/${claim.headRepositoryId}/contents/${githubPath(applicantRequest.requestPath)}?ref=${claim.headSha}`,
        headers
      ),
      this.#get(`/repositories/${sourceRevision2.repositoryId}`, headers),
      this.#get(
        `/repositories/${sourceRevision2.repositoryId}/git/commits/${sourceRevision2.commitSha}`,
        headers
      )
    ]);
    const repository = object(repositoryValue, "GitHub repository");
    if (numericId(repository.id, "observed GitHub repository id") !== this.#binding.repositoryId || text(repository.name, "observed GitHub repository name") !== this.#binding.name || text(object(repository.owner, "GitHub repository owner").login, "GitHub owner login") !== this.#binding.owner || repository.visibility !== "public" || repository.archived !== false || repository.disabled !== false) throw new TypeError("GitHub intake repository identity or public availability drifted");
    const pull = object(pullValue, "GitHub pull request");
    const base = object(pull.base, "GitHub pull-request base");
    const head = object(pull.head, "GitHub pull-request head");
    const author = object(pull.user, "GitHub pull-request author");
    const observedBaseRepository = object(base.repo, "GitHub pull-request base repository");
    const observedHeadRepository = object(head.repo, "GitHub pull-request head repository");
    const headRepository = object(headRepositoryValue, "GitHub pull-request head repository");
    const sourceRepository = object(sourceRepositoryValue, "GitHub Applicant source repository");
    const state = pull.state === "open" && pull.merged === false ? "open" : pull.state === "closed" && pull.merged === true ? "merged" : null;
    if (numericId(pull.number, "observed pull-request number") !== String(claim.pullRequestNumber) || numericId(observedBaseRepository.id, "observed pull-request base repository id") !== claim.repositoryId || numericId(observedHeadRepository.id, "observed pull-request head repository id") !== claim.headRepositoryId || numericId(headRepository.id, "observed pull-request head repository id") !== claim.headRepositoryId || headRepository.visibility !== "public" || headRepository.archived !== false || headRepository.disabled !== false || gitSha2(head.sha, "observed pull-request head SHA") !== claim.headSha || pull.changed_files !== 1 || pull.draft !== false || state === null || numericId(author.id, "observed pull-request author id") !== claim.approvedGitHubUserId) throw new TypeError("GitHub pull request no longer matches the exact approved revision and user");
    const commit = object(headCommitValue, "GitHub pull-request head commit");
    if (gitSha2(commit.sha, "observed GitHub commit SHA") !== claim.headSha || gitSha2(object(commit.tree, "GitHub commit tree").sha, "observed GitHub tree SHA") !== claim.treeSha) throw new TypeError("GitHub commit tree no longer matches the approved revision");
    assertExactApplicantFileV1(applicantFileValue, applicantRequest);
    assertExactApplicantPullRequestDiffV1(
      pullFilesValue,
      applicantFileValue,
      applicantRequest
    );
    if (numericId(sourceRepository.id, "observed Applicant source repository id") !== sourceRevision2.repositoryId || publicGitHubRepositoryUrl(sourceRepository.html_url) !== sourceRevision2.repositoryUrl || sourceRepository.visibility !== "public" || sourceRepository.archived !== false || sourceRepository.disabled !== false) throw new TypeError("GitHub Applicant source repository identity or availability drifted");
    const sourceCommit = object(sourceCommitValue, "GitHub Applicant source commit");
    if (gitSha2(sourceCommit.sha, "observed Applicant source commit SHA") !== sourceRevision2.commitSha || gitSha2(
      object(sourceCommit.tree, "GitHub Applicant source commit tree").sha,
      "observed Applicant source tree SHA"
    ) !== sourceRevision2.treeSha) throw new TypeError("GitHub Applicant source commit tree drifted");
    const verifiedAt = this.#now();
    const verifiedAtEpochSeconds = canonicalEpochSeconds(verifiedAt, "GitHub verification time");
    const authorId = numericId(author.id, "GitHub pull-request author id");
    const authorLogin = text(author.login, "GitHub pull-request author login");
    return deepFreeze5({
      schemaVersion: "programmable.verified-github-router-launch-approval.v6",
      claim,
      approvalBindingHash: computeGitHubApprovalBindingHashV1(claim),
      pullRequestAuthorGitHubUserId: authorId,
      pullRequestAuthorGitHubLogin: authorLogin,
      pullRequestHeadRepositoryUrl: publicGitHubRepositoryUrl(headRepository.html_url),
      sourceRepositoryId: sourceRevision2.repositoryId,
      sourceRepositoryUrl: sourceRevision2.repositoryUrl,
      sourceCommitSha: sourceRevision2.commitSha,
      sourceTreeSha: sourceRevision2.treeSha,
      pullRequestState: state,
      verifiedAtEpochSeconds
    });
  }
  async #get(path, headers) {
    const response = await this.#fetch(`https://api.github.com${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(1e4),
      headers
    });
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > 1048576) {
      throw new TypeError("GitHub response exceeded the self-service metadata limit");
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 1048576) {
      throw new TypeError("GitHub response exceeded the self-service metadata limit");
    }
    if (response.status !== 200) throw new TypeError(`GitHub read failed with status ${response.status}`);
    try {
      return JSON.parse(body);
    } catch {
      throw new TypeError("GitHub response was not JSON");
    }
  }
};
function assertExactApplicantPullRequestDiffV1(rawFiles, rawFile, expected) {
  const files = array(rawFiles, "GitHub pull-request files");
  if (files.length !== 1) {
    throw new TypeError("GitHub Applicant pull request must change exactly one file");
  }
  const diff = object(files[0], "GitHub Applicant pull-request file");
  const file = object(rawFile, "GitHub Applicant request file");
  if (diff.filename !== expected.requestPath || diff.status !== "added" && diff.status !== "modified" || diff.previous_filename !== void 0 || gitSha2(diff.sha, "GitHub Applicant pull-request blob SHA") !== gitSha2(file.sha, "GitHub Applicant request blob SHA")) throw new TypeError("GitHub Applicant pull-request file set drifted");
}
function assertExactApplicantFileV1(raw, expected) {
  const file = object(raw, "GitHub Applicant request file");
  if (file.type !== "file" || file.encoding !== "base64" || file.path !== expected.requestPath || nonnegativeSafeInteger2(file.size, "GitHub Applicant request size") !== expected.rawByteLength) throw new TypeError("GitHub Applicant request path or size drifted at the approved head");
  const content = decodeGitHubBase64(file.content, expected.rawByteLength);
  const expectedBytes = Buffer.from(expected.rawJsonUtf8, "utf8");
  if (!content.equals(expectedBytes)) {
    throw new TypeError("GitHub Applicant request bytes drifted at the approved head");
  }
  const blobHeader = Buffer.from(`blob ${content.byteLength}\0`, "utf8");
  const blobSha = createHash3("sha1").update(blobHeader).update(content).digest("hex");
  if (gitSha2(file.sha, "GitHub Applicant blob SHA") !== blobSha) {
    throw new TypeError("GitHub Applicant request blob identity is invalid");
  }
}
function decodeGitHubBase64(value, expectedBytes) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4}|\r?\n)*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\r?\n?$/u.test(value)) {
    throw new TypeError("GitHub Applicant request content is not canonical base64");
  }
  const compact = value.replace(/[\r\n]/gu, "");
  const decoded = Buffer.from(compact, "base64");
  if (decoded.byteLength !== expectedBytes || decoded.toString("base64") !== compact) throw new TypeError("GitHub Applicant request base64 bytes are invalid");
  return decoded;
}
function githubPath(value) {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
function authorizationHeaders(token) {
  if (token !== null && !/^[\x21-\x7e]{20,4096}$/u.test(token)) {
    throw new TypeError("GitHub access token is invalid");
  }
  return Object.freeze({
    accept: GITHUB_REST_ACCEPT,
    ...token === null ? {} : { authorization: `Bearer ${token}` },
    "user-agent": GITHUB_REST_USER_AGENT,
    "x-github-api-version": GITHUB_REST_API_VERSION
  });
}
function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  return value;
}
function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} is not an array`);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function numericId(value, label) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^[1-9][0-9]{0,19}$/u.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}
function gitSha2(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError(`${label} is not a lowercase SHA-1 object id`);
  }
  return value;
}
function sha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function address2(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const normalized = value.toLowerCase();
  if (BigInt(normalized) === 0n) throw new TypeError(`${label} is zero`);
  return normalized;
}
function nonzeroBytes322(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value) || BigInt(value) === 0n) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function bytes20(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function uintString64(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  if (BigInt(value) >= 1n << 64n) throw new TypeError(`${label} exceeds uint64`);
  return value;
}
function requiredBoundedText(value, label, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maximumBytes || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${label} is required and invalid`);
  return value;
}
function publicGitHubRepositoryUrl(value) {
  const url = requiredBoundedText(value, "GitHub source repository URL", 200);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u.test(url)) {
    throw new TypeError("GitHub source repository URL is invalid");
  }
  return url;
}
function nonnegativeSafeInteger2(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`);
  return value;
}
function canonicalEpochSeconds(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`);
  return String(value);
}
function assertExactKeys3(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}
function deepFreeze5(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze5(nested);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/rpc.ts
var ZERO_WORD = `0x${"00".repeat(32)}`;
var ZERO_TWO_WORDS = `0x${"00".repeat(64)}`;
var ZERO_LAUNCH_STAMP = `0x${"00".repeat(32 * 14)}`;
var RouterRpcExecutionRevertV1 = class extends Error {
  constructor(message = "EVM execution reverted") {
    super(message);
    this.name = "RouterRpcExecutionRevertV1";
    Object.freeze(this);
  }
};
var DualProviderRouterReadAdapterV1 = class {
  #providers;
  constructor(providers) {
    const [left, right] = providers;
    for (const provider of providers) {
      boundedId(provider.providerId, "RPC provider id");
      boundedId(provider.trustDomain, "RPC trust domain");
    }
    if (left.providerId === right.providerId || left.trustDomain === right.trustDomain) {
      throw new TypeError("Router RPC providers are not independent");
    }
    this.#providers = Object.freeze(providers);
    Object.freeze(this);
  }
  binding() {
    const providers = this.#providers.map(({ providerId, trustDomain }) => Object.freeze({ providerId, trustDomain })).sort((left, right) => Buffer.compare(Buffer.from(left.providerId, "utf8"), Buffer.from(right.providerId, "utf8")));
    const core = {
      schemaVersion: "programmable.router-read-authority-binding.v1",
      chainId: "1",
      providers
    };
    return deepFreeze6({
      ...core,
      bindingHash: canonicalSha256(core.schemaVersion, core)
    });
  }
  async collectCommonFinalizedAnchor() {
    await this.#assertMainnet();
    const finalized = await Promise.all(this.#providers.map((provider) => provider.request("eth_getBlockByNumber", ["finalized", false])));
    const blocks = finalized.map((value) => rpcBlock(value, "finalized block"));
    const commonNumber = blocks.reduce(
      (minimum, block) => BigInt(block.number) < minimum ? BigInt(block.number) : minimum,
      BigInt(blocks[0].number)
    );
    const minimumFinalizedBlock = BigInt(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.deployment.firstFinalizedEvidenceBlock);
    if (commonNumber < minimumFinalizedBlock) {
      throw new TypeError("common finality predates the Router finalization proof");
    }
    const tag = quantity(commonNumber);
    const common = await Promise.all(this.#providers.map((provider) => provider.request("eth_getBlockByNumber", [tag, false])));
    const observed = common.map((value) => rpcBlock(value, "common finalized block"));
    if (observed[0].hash !== observed[1].hash || observed.some((block) => block.number !== tag)) {
      throw new TypeError("RPC providers disagree on the common finalized block");
    }
    const anchorCore = {
      schemaVersion: "programmable.router-common-finalized-anchor.v1",
      chainId: "1",
      blockNumber: tag,
      blockHash: observed[0].hash,
      timestamp: BigInt(observed[0].timestamp).toString(10),
      providerIds: [this.#providers[0].providerId, this.#providers[1].providerId]
    };
    return deepFreeze6({
      ...anchorCore,
      anchorHash: canonicalSha256("programmable.router-common-finalized-anchor.v1", anchorCore)
    });
  }
  async observeChainClock() {
    const values = await Promise.all(this.#providers.map((provider) => provider.request("eth_getBlockByNumber", ["latest", false])));
    const timestamps = values.map((value) => BigInt(rpcBlock(value, "latest block").timestamp));
    const minimum = timestamps[0] < timestamps[1] ? timestamps[0] : timestamps[1];
    const maximum = timestamps[0] > timestamps[1] ? timestamps[0] : timestamps[1];
    if (maximum - minimum > 120n) throw new TypeError("RPC provider chain clocks diverge by more than 120 seconds");
    return deepFreeze6({
      minimumTimestamp: minimum.toString(10),
      maximumTimestamp: maximum.toString(10),
      providerTimestamps: [timestamps[0].toString(10), timestamps[1].toString(10)]
    });
  }
  async verifyProductionRuntimeBindings() {
    const finalizedAnchor = await this.collectCommonFinalizedAnchor();
    await this.#verifyRuntimeAndBindings(finalizedAnchor.blockNumber);
    await this.#verifyRuntimeAndBindings("latest");
    return finalizedAnchor;
  }
  async verifyProductionPreflight(input) {
    const [finalizedAnchor, chainClock] = await Promise.all([
      this.collectCommonFinalizedAnchor(),
      this.observeChainClock()
    ]);
    const tags = [finalizedAnchor.blockNumber, "latest"];
    for (const tag of tags) await this.#verifyRuntimeAndBindings(tag);
    const targetAddresses = input.launch.plan.route.expectedOutputs.map(({ account }) => account);
    const graphAuthorizationKey = graphAuthorizationKeyV1(input.launch);
    for (const tag of tags) {
      const targetCodes = await Promise.all(targetAddresses.map((account) => this.readConsensus("eth_getCode", [account, tag])));
      const consumed = await this.ethCallConsensus({
        to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address,
        data: joinHex(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.consumedGraphAuthorization, graphAuthorizationKey)
      }, tag);
      const existingLaunchStamp = await this.ethCallConsensus({
        to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
        data: joinHex(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.launchStamp, input.launch.plan.stampRequest.launchId)
      }, tag);
      assertRouterLaunchVacancyObservationsV1({
        targetCodes,
        consumedGraphAuthorization: consumed,
        launchStamp: existingLaunchStamp
      });
      await this.#requireZeroRouterRead(
        PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.launchIdByToken,
        [addressWord2(input.launch.plan.stampRequest.token)],
        "token launch id",
        tag
      );
      await this.#requireZeroRouterRead(
        PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.launchIdByPool,
        [addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.poolManager.address), word2(input.launch.poolId)],
        "pool launch id",
        tag
      );
      for (const component of input.launch.plan.stampRequest.components) {
        await this.#requireZeroRouterRead(
          PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.launchIdByComponent,
          [addressWord2(component.account)],
          "component launch id",
          tag
        );
        const proof = await this.ethCallConsensus({
          to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
          data: joinHex(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.stampProof, addressWord2(component.account))
        }, tag);
        if (proof !== ZERO_TWO_WORDS) throw new TypeError("component already has a Router stamp proof");
      }
    }
    const previousPermit = await observePreviousRouterPermitV1(
      input.previousPermit ?? null,
      finalizedAnchor,
      (method, params) => this.readConsensus(method, params)
    );
    const unconsumedCore = {
      schemaVersion: "programmable.router-launch-unconsumed-evidence.v1",
      chainId: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal,
      router: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
      routerRuntimeKeccak256: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.runtimeKeccak256,
      graphFactory: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address,
      graphFactoryRuntimeKeccak256: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.runtimeKeccak256,
      launchId: input.launch.plan.stampRequest.launchId,
      token: input.launch.plan.stampRequest.token,
      poolId: input.launch.poolId,
      routeNonce: input.launch.plan.route.routeNonce,
      graphAuthorizationKey,
      targetAccounts: input.launch.plan.route.expectedOutputs.map(({ account }) => account),
      componentAccounts: input.launch.plan.stampRequest.components.map(({ account }) => account),
      commonFinalizedAnchorHash: finalizedAnchor.anchorHash,
      runtimeBindings: "matched-finalized-and-latest",
      targetRuntimeState: "empty-finalized-and-latest",
      graphAuthorizationState: "unconsumed-finalized-and-latest",
      launchStampState: "empty-finalized-and-latest",
      tokenIndexState: "empty-finalized-and-latest",
      poolIndexState: "empty-finalized-and-latest",
      componentIndexState: "empty-finalized-and-latest",
      componentProofState: "empty-finalized-and-latest",
      previousPermit
    };
    const unconsumed = deepFreeze6({
      ...unconsumedCore,
      evidenceHash: canonicalSha256(unconsumedCore.schemaVersion, unconsumedCore)
    });
    const pending = await Promise.all(this.#providers.map((provider) => provider.request("eth_getTransactionCount", [input.launchWallet, "pending"])));
    const pendingNonce = normalizePendingNonceV1(pending[0]);
    if (pendingNonce !== normalizePendingNonceV1(pending[1])) {
      throw new TypeError("RPC providers disagree on the launch wallet pending nonce");
    }
    const evidence = {
      schemaVersion: "programmable.router-self-service-preflight.v1",
      finalizedAnchor,
      chainClock,
      pendingNonce,
      targetCount: targetAddresses.length,
      unconsumed
    };
    return deepFreeze6({
      ...evidence,
      bindingHash: canonicalSha256("programmable.router-self-service-preflight.v1", evidence)
    });
  }
  async verifyPermitDigest(permit, expectedDigest, blockTag) {
    const result = await this.ethCallConsensus({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
      data: encodePermitDigestCallV1(permit)
    }, blockTag);
    if (result !== expectedDigest) throw new TypeError("local Router permit digest disagrees with finalized bytecode");
  }
  async selectValidSafeSignature(input) {
    const signature = canonicalRawSignatureV1(input.rawSignature65);
    const outcomes = await this.#ethCallOutcomes({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address,
      data: encodeErc1271CallV1(input.permitDigest, signature)
    }, "latest");
    const magic = outcomes.filter((outcome) => outcome.state === "returned" && outcome.value === PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.erc1271MagicWord).length;
    if (magic === 1) throw new TypeError("RPC providers disagree on Safe ERC-1271 owner signature");
    if (magic !== 2) throw new TypeError("Safe ERC-1271 rejected the manual owner signature");
    const mutated = flipDigestBit(input.permitDigest);
    const negative = await this.#ethCallOutcomes({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address,
      data: encodeErc1271CallV1(mutated, signature)
    }, "latest");
    if (negative.some((outcome) => outcome.state === "returned" && outcome.value === PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.erc1271MagicWord)) {
      throw new TypeError("Safe ERC-1271 accepted a one-bit-mutated permit digest");
    }
    for (const outcome of negative) {
      if (outcome.state === "returned" && !/^0x[0-9a-f]{64}$/u.test(outcome.value)) {
        throw new TypeError("Safe ERC-1271 negative result is malformed");
      }
    }
    return signature;
  }
  async simulateExactLaunch(input) {
    const result = await this.ethCallConsensus({
      from: input.from,
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
      data: input.data,
      value: input.value
    }, "latest");
    if (result !== input.expectedStampHash) {
      throw new TypeError("exact launch simulation did not return the expected stamp hash");
    }
  }
  async ethCallConsensus(transaction, blockTag) {
    return hex2(await this.readConsensus("eth_call", [transaction, blockTag]), "eth_call result");
  }
  async readConsensus(method, params) {
    const values = await Promise.all(this.#providers.map((provider) => provider.request(method, params)));
    if (canonicalizeJson(values[0]) !== canonicalizeJson(values[1])) {
      throw new TypeError(`RPC providers disagree on ${method}`);
    }
    return values[0];
  }
  async #assertMainnet() {
    const values = await Promise.all(this.#providers.map((provider) => provider.request("eth_chainId", [])));
    if (values.some((value) => value !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdHex)) {
      throw new TypeError("Router RPC provider is not bound to Ethereum mainnet");
    }
  }
  async #ethCallOutcomes(transaction, blockTag) {
    const read = async (provider) => {
      try {
        return Object.freeze({
          state: "returned",
          value: hex2(await provider.request("eth_call", [transaction, blockTag]), "eth_call result")
        });
      } catch (error) {
        if (!(error instanceof RouterRpcExecutionRevertV1)) throw error;
        return Object.freeze({ state: "reverted" });
      }
    };
    return Object.freeze(await Promise.all([
      read(this.#providers[0]),
      read(this.#providers[1])
    ]));
  }
  async #verifyRuntimeAndBindings(blockTag) {
    const runtimeBindings = [
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address, PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.runtimeKeccak256, "Router"],
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address, PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.runtimeKeccak256, "Safe"],
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address, PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.runtimeKeccak256, "GraphFactory"],
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.poolManager.address, PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.poolManager.runtimeKeccak256, "PoolManager"]
    ];
    for (const [account, expectedHash, label] of runtimeBindings) {
      const code = hex2(await this.readConsensus("eth_getCode", [account, blockTag]), `${label} runtime`);
      if (code === "0x" || keccak256V1(Buffer.from(code.slice(2), "hex")) !== expectedHash) {
        throw new TypeError(`${label} runtime code hash drifted`);
      }
    }
    const routerWords = [
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.chainId, word2(quantityWord(1n)), "Router chain id"],
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.permitAuthority, addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address), "Router Safe"],
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.graphFactory, addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address), "Router GraphFactory"],
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.poolManager, addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.poolManager.address), "Router PoolManager"],
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.permitAuthorityRuntime, word2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.runtimeKeccak256), "Router Safe runtime"],
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.graphFactoryRuntime, word2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.runtimeKeccak256), "Router GraphFactory runtime"],
      [PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.poolManagerRuntime, word2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.poolManager.runtimeKeccak256), "Router PoolManager runtime"]
    ];
    for (const [selector, expected, label] of routerWords) {
      const observed = await this.ethCallConsensus({ to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address, data: selector }, blockTag);
      if (observed !== expected) throw new TypeError(`${label} immutable binding drifted`);
    }
    await this.#verifySafeState(blockTag);
  }
  async #verifySafeState(blockTag) {
    const masterCopy = await this.ethCallConsensus({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address,
      data: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.safeMasterCopy
    }, blockTag);
    if (masterCopy !== addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.masterCopy)) {
      throw new TypeError("Safe master-copy binding drifted");
    }
    const threshold = await this.ethCallConsensus({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address,
      data: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.safeThreshold
    }, blockTag);
    if (threshold !== word2(quantityWord(BigInt(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.threshold)))) {
      throw new TypeError("Safe threshold drifted");
    }
    const ownersRaw = await this.ethCallConsensus({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address,
      data: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.safeOwners
    }, blockTag);
    const owners = decodeAddressArray(ownersRaw, "Safe owners");
    assertManualSafeOwnerSetV1(owners);
    const versionRaw = await this.ethCallConsensus({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address,
      data: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.safeVersion
    }, blockTag);
    if (decodeAbiString(versionRaw, "Safe version") !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.version) {
      throw new TypeError("Safe version drifted");
    }
    const fallback = hex2(await this.readConsensus("eth_getStorageAt", [
      PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address,
      PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.fallbackStorageSlot,
      blockTag
    ]), "Safe fallback-handler slot");
    if (fallback !== addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.fallbackHandler)) {
      throw new TypeError("Safe fallback-handler binding drifted");
    }
    const guard = hex2(await this.readConsensus("eth_getStorageAt", [
      PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address,
      PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.guardStorageSlot,
      blockTag
    ]), "Safe guard slot");
    if (guard !== addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.guard)) {
      throw new TypeError("Safe guard binding drifted");
    }
    const modules = await this.ethCallConsensus({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address,
      data: joinHex(
        PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.safeModulesPaginated,
        addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.moduleSentinel),
        quantityWord(100n)
      )
    }, blockTag);
    const expectedModules = joinHex(
      quantityWord(64n),
      addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.moduleSentinel),
      quantityWord(0n)
    );
    if (PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.modules.length !== 0 || modules !== expectedModules) {
      throw new TypeError("Safe module set drifted");
    }
  }
  async #requireZeroRouterRead(selector, words, label, blockTag) {
    const observed = await this.ethCallConsensus({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
      data: joinHex(selector, ...words)
    }, blockTag);
    if (observed !== ZERO_WORD) throw new TypeError(`${label} is already occupied`);
  }
};
function assertRouterLaunchVacancyObservationsV1(input) {
  const targetCodes = input.targetCodes.map((value, index) => hex2(value, `CustomGraph target ${index} runtime`));
  const consumed = hex2(input.consumedGraphAuthorization, "CustomGraph authorization state");
  const launchStamp = hex2(input.launchStamp, "Router launch stamp state");
  if (targetCodes.length < 1 || targetCodes.length > 16) {
    throw new TypeError("CustomGraph target runtime observation count is invalid");
  }
  if (targetCodes.some((code) => code !== "0x")) {
    throw new TypeError("one or more CustomGraph target addresses already contain code");
  }
  if (consumed !== ZERO_WORD) {
    throw new TypeError("CustomGraph authorization key is already consumed");
  }
  if (launchStamp !== ZERO_LAUNCH_STAMP) {
    throw new TypeError("launch id already has a Router stamp record");
  }
}
async function observePreviousRouterPermitV1(raw, finalizedAnchor, readConsensus) {
  const anchor = assertCommonFinalizedAnchorV1(finalizedAnchor);
  if (raw === null) {
    return deepFreeze6({ previousPermitDeadline: null, transaction: null });
  }
  const deadline = decimalString(raw.deadline, "previous Router permit deadline");
  if (BigInt(anchor.timestamp) <= BigInt(deadline)) {
    throw new TypeError("previous Router permit deadline is not behind common finality");
  }
  if (raw.expectedDisposition === "not-submitted") {
    if (raw.transactionHash !== null) {
      throw new TypeError("not-submitted previous permit unexpectedly has a transaction hash");
    }
    return deepFreeze6({ previousPermitDeadline: deadline, transaction: null });
  }
  const transactionHash = bytes322(raw.transactionHash, "previous Router transaction hash");
  const receiptValue = await readConsensus("eth_getTransactionReceipt", [transactionHash]);
  if (receiptValue === null) {
    const transactionValue = await readConsensus("eth_getTransactionByHash", [transactionHash]);
    if (transactionValue !== null) {
      throw new TypeError("previous Router transaction is still known without a finalized receipt");
    }
    if (raw.expectedDisposition !== "absent-after-finalized-deadline") {
      throw new TypeError("previous Router transaction disposition is not the expected finalized revert");
    }
    return deepFreeze6({
      previousPermitDeadline: deadline,
      transaction: {
        transactionHash,
        disposition: "absent-after-finalized-deadline",
        blockNumber: null,
        blockHash: null
      }
    });
  }
  const receipt = rpcObject(receiptValue, "previous Router transaction receipt");
  const status = rpcQuantity(receipt.status, "previous Router receipt status");
  if (status === "0x1") {
    throw new TypeError("previous Router transaction succeeded and cannot be reissued");
  }
  if (status !== "0x0" || raw.expectedDisposition !== "finalized-reverted") {
    throw new TypeError("previous Router transaction disposition is invalid");
  }
  const blockNumber = rpcQuantity(receipt.blockNumber, "previous Router receipt block number");
  const blockHash = bytes322(receipt.blockHash, "previous Router receipt block hash");
  if (bytes322(receipt.transactionHash, "previous Router receipt transaction hash") !== transactionHash || BigInt(blockNumber) > BigInt(anchor.blockNumber)) throw new TypeError("previous Router reverted receipt is not commonly finalized");
  const canonicalBlock = rpcObject(await readConsensus(
    "eth_getBlockByNumber",
    [blockNumber, false]
  ), "previous Router receipt block");
  if (rpcQuantity(canonicalBlock.number, "previous Router block number") !== blockNumber || bytes322(canonicalBlock.hash, "previous Router block hash") !== blockHash) throw new TypeError("previous Router reverted receipt block is not canonical");
  return deepFreeze6({
    previousPermitDeadline: deadline,
    transaction: {
      transactionHash,
      disposition: "finalized-reverted",
      blockNumber,
      blockHash
    }
  });
}
function assertManualSafeOwnerSetV1(owners) {
  const expectedOwners = /* @__PURE__ */ new Set([PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.manualOwner]);
  if (owners.length !== expectedOwners.size || new Set(owners).size !== owners.length || owners.some((owner) => !expectedOwners.has(owner))) throw new TypeError("Safe owner set drifted");
}
function assertCommonFinalizedAnchorV1(raw) {
  assertExactKeys4(raw, [
    "anchorHash",
    "blockHash",
    "blockNumber",
    "chainId",
    "providerIds",
    "schemaVersion",
    "timestamp"
  ], "Router common finalized anchor");
  if (raw.schemaVersion !== "programmable.router-common-finalized-anchor.v1" || raw.chainId !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal || !Array.isArray(raw.providerIds) || raw.providerIds.length !== 2 || raw.providerIds.some((providerId) => typeof providerId !== "string")) throw new TypeError("Router common finalized anchor shape is invalid");
  const providerIds = raw.providerIds;
  providerIds.forEach((providerId) => boundedId(providerId, "RPC provider id"));
  if (providerIds[0] === providerIds[1]) {
    throw new TypeError("Router common finalized anchor providers are not distinct");
  }
  const core = {
    schemaVersion: "programmable.router-common-finalized-anchor.v1",
    chainId: "1",
    blockNumber: rpcQuantity(raw.blockNumber, "finalized anchor block number"),
    blockHash: bytes322(raw.blockHash, "finalized anchor block hash"),
    timestamp: decimalString(raw.timestamp, "finalized anchor timestamp"),
    providerIds: [providerIds[0], providerIds[1]]
  };
  if (raw.anchorHash !== canonicalSha256(
    "programmable.router-common-finalized-anchor.v1",
    core
  )) throw new TypeError("Router common finalized anchor hash is invalid");
  return deepFreeze6({ ...core, anchorHash: raw.anchorHash });
}
function assertRouterPreflightEvidenceV1(raw, launch) {
  assertExactKeys4(raw, [
    "bindingHash",
    "chainClock",
    "finalizedAnchor",
    "pendingNonce",
    "schemaVersion",
    "targetCount",
    "unconsumed"
  ], "Router self-service preflight");
  if (raw.schemaVersion !== "programmable.router-self-service-preflight.v1") {
    throw new TypeError("Router self-service preflight schema is invalid");
  }
  assertExactKeys4(raw.chainClock, [
    "maximumTimestamp",
    "minimumTimestamp",
    "providerTimestamps"
  ], "Router chain clock");
  if (!Array.isArray(raw.chainClock.providerTimestamps) || raw.chainClock.providerTimestamps.length !== 2) {
    throw new TypeError("Router chain clock provider timestamps are invalid");
  }
  const providerTimestamps = raw.chainClock.providerTimestamps.map((value, index) => decimalString(value, `Router provider ${index} timestamp`));
  const minimum = BigInt(providerTimestamps[0]) < BigInt(providerTimestamps[1]) ? providerTimestamps[0] : providerTimestamps[1];
  const maximum = BigInt(providerTimestamps[0]) > BigInt(providerTimestamps[1]) ? providerTimestamps[0] : providerTimestamps[1];
  const chainClock = {
    minimumTimestamp: decimalString(raw.chainClock.minimumTimestamp, "Router minimum timestamp"),
    maximumTimestamp: decimalString(raw.chainClock.maximumTimestamp, "Router maximum timestamp"),
    providerTimestamps: [providerTimestamps[0], providerTimestamps[1]]
  };
  if (chainClock.minimumTimestamp !== minimum || chainClock.maximumTimestamp !== maximum) {
    throw new TypeError("Router chain clock bounds do not match provider timestamps");
  }
  if (BigInt(maximum) - BigInt(minimum) > 120n) {
    throw new TypeError("Router provider chain clocks diverge by more than 120 seconds");
  }
  const pendingNonce = decimalString(raw.pendingNonce, "Router pending nonce");
  const targetCount = raw.targetCount;
  if (!Number.isSafeInteger(targetCount) || targetCount < 1 || targetCount > 16) {
    throw new TypeError("Router preflight target count is invalid");
  }
  const finalizedAnchor = assertCommonFinalizedAnchorV1(raw.finalizedAnchor);
  const unconsumed = assertRouterLaunchUnconsumedEvidenceV1(raw.unconsumed, launch);
  if (unconsumed.commonFinalizedAnchorHash !== finalizedAnchor.anchorHash) {
    throw new TypeError("Router unconsumed evidence does not bind the common finalized anchor");
  }
  const evidence = {
    schemaVersion: "programmable.router-self-service-preflight.v1",
    finalizedAnchor,
    chainClock,
    pendingNonce,
    targetCount,
    unconsumed
  };
  if (raw.bindingHash !== canonicalSha256(
    "programmable.router-self-service-preflight.v1",
    evidence
  )) throw new TypeError("Router self-service preflight binding hash is invalid");
  return deepFreeze6({ ...evidence, bindingHash: raw.bindingHash });
}
function assertRouterLaunchUnconsumedEvidenceV1(raw, launch) {
  assertExactKeys4(raw, [
    "chainId",
    "commonFinalizedAnchorHash",
    "componentAccounts",
    "componentIndexState",
    "componentProofState",
    "evidenceHash",
    "graphFactory",
    "graphFactoryRuntimeKeccak256",
    "graphAuthorizationKey",
    "graphAuthorizationState",
    "launchId",
    "launchStampState",
    "poolId",
    "poolIndexState",
    "previousPermit",
    "routeNonce",
    "router",
    "routerRuntimeKeccak256",
    "runtimeBindings",
    "schemaVersion",
    "targetAccounts",
    "targetRuntimeState",
    "token",
    "tokenIndexState"
  ], "Router launch unconsumed evidence");
  if (raw.schemaVersion !== "programmable.router-launch-unconsumed-evidence.v1" || raw.chainId !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal || raw.router !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address || raw.routerRuntimeKeccak256 !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.runtimeKeccak256 || raw.graphFactory !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address || raw.graphFactoryRuntimeKeccak256 !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.runtimeKeccak256 || raw.runtimeBindings !== "matched-finalized-and-latest" || raw.targetRuntimeState !== "empty-finalized-and-latest" || raw.graphAuthorizationState !== "unconsumed-finalized-and-latest" || raw.launchStampState !== "empty-finalized-and-latest" || raw.tokenIndexState !== "empty-finalized-and-latest" || raw.poolIndexState !== "empty-finalized-and-latest" || raw.componentIndexState !== "empty-finalized-and-latest" || raw.componentProofState !== "empty-finalized-and-latest" || !Array.isArray(raw.targetAccounts) || !Array.isArray(raw.componentAccounts)) throw new TypeError("Router launch unconsumed evidence binding is invalid");
  const targetAccounts = raw.targetAccounts.map((value, index) => rpcAddress(value, `Router target account ${index}`));
  const componentAccounts = raw.componentAccounts.map((value, index) => rpcAddress(value, `Router component account ${index}`));
  if (targetAccounts.length < 1 || targetAccounts.length > 16 || componentAccounts.length < 1 || componentAccounts.length > 16 || new Set(targetAccounts).size !== targetAccounts.length || new Set(componentAccounts).size !== componentAccounts.length) throw new TypeError("Router launch unconsumed account set is invalid");
  assertExactKeys4(raw.previousPermit, [
    "previousPermitDeadline",
    "transaction"
  ], "previous Router permit observation");
  const previousPermitDeadline = raw.previousPermit.previousPermitDeadline === null ? null : decimalString(raw.previousPermit.previousPermitDeadline, "previous permit deadline");
  let transaction = null;
  if (raw.previousPermit.transaction !== null) {
    assertExactKeys4(raw.previousPermit.transaction, [
      "blockHash",
      "blockNumber",
      "disposition",
      "transactionHash"
    ], "previous Router transaction observation");
    const disposition = raw.previousPermit.transaction.disposition;
    if (disposition !== "absent-after-finalized-deadline" && disposition !== "finalized-reverted") throw new TypeError("previous Router transaction disposition is invalid");
    const blockNumber = raw.previousPermit.transaction.blockNumber === null ? null : rpcQuantity(raw.previousPermit.transaction.blockNumber, "previous receipt block number");
    const blockHash = raw.previousPermit.transaction.blockHash === null ? null : bytes322(raw.previousPermit.transaction.blockHash, "previous receipt block hash");
    if (previousPermitDeadline === null || disposition === "absent-after-finalized-deadline" && (blockNumber !== null || blockHash !== null) || disposition === "finalized-reverted" && (blockNumber === null || blockHash === null)) throw new TypeError("previous Router transaction observation is incomplete");
    transaction = deepFreeze6({
      transactionHash: bytes322(
        raw.previousPermit.transaction.transactionHash,
        "previous transaction hash"
      ),
      disposition,
      blockNumber,
      blockHash
    });
  }
  if (previousPermitDeadline === null && transaction !== null) {
    throw new TypeError("initial Router preflight unexpectedly has a previous transaction");
  }
  const core = {
    schemaVersion: "programmable.router-launch-unconsumed-evidence.v1",
    chainId: "1",
    router: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
    routerRuntimeKeccak256: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.runtimeKeccak256,
    graphFactory: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address,
    graphFactoryRuntimeKeccak256: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.runtimeKeccak256,
    launchId: bytes322(raw.launchId, "unconsumed launch id"),
    token: rpcAddress(raw.token, "unconsumed launch token"),
    poolId: bytes322(raw.poolId, "unconsumed pool id"),
    routeNonce: bytes322(raw.routeNonce, "unconsumed route nonce"),
    graphAuthorizationKey: bytes322(
      raw.graphAuthorizationKey,
      "unconsumed Graph authorization key"
    ),
    targetAccounts,
    componentAccounts,
    commonFinalizedAnchorHash: sha2562(raw.commonFinalizedAnchorHash, "unconsumed anchor hash"),
    runtimeBindings: "matched-finalized-and-latest",
    targetRuntimeState: "empty-finalized-and-latest",
    graphAuthorizationState: "unconsumed-finalized-and-latest",
    launchStampState: "empty-finalized-and-latest",
    tokenIndexState: "empty-finalized-and-latest",
    poolIndexState: "empty-finalized-and-latest",
    componentIndexState: "empty-finalized-and-latest",
    componentProofState: "empty-finalized-and-latest",
    previousPermit: { previousPermitDeadline, transaction }
  };
  const evidence = deepFreeze6({
    ...core,
    evidenceHash: canonicalSha256(core.schemaVersion, core)
  });
  if (raw.evidenceHash !== evidence.evidenceHash) {
    throw new TypeError("Router launch unconsumed evidence hash is invalid");
  }
  if (launch !== void 0 && (evidence.launchId !== launch.plan.stampRequest.launchId || evidence.token !== launch.plan.stampRequest.token || evidence.poolId !== launch.poolId || evidence.routeNonce !== launch.plan.route.routeNonce || evidence.graphAuthorizationKey !== graphAuthorizationKeyV1(launch) || canonicalizeJson(evidence.targetAccounts) !== canonicalizeJson(launch.plan.route.expectedOutputs.map(({ account }) => account)) || canonicalizeJson(evidence.componentAccounts) !== canonicalizeJson(launch.plan.stampRequest.components.map(({ account }) => account)))) throw new TypeError("Router launch unconsumed evidence does not match the compiled launch");
  return evidence;
}
function graphAuthorizationKeyV1(launch) {
  const encoded = joinHex(
    PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.graphAuthorizationKeyTypeHash,
    quantityWord(1n),
    addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address),
    word2(launch.plan.route.routeNamespace),
    word2(launch.plan.route.routeNonce),
    addressWord2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address)
  );
  return keccak256V1(Buffer.from(encoded.slice(2), "hex"));
}
function rpcBlock(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is unavailable`);
  }
  const block = value;
  return Object.freeze({
    number: rpcQuantity(block.number, `${label} number`),
    hash: bytes322(block.hash, `${label} hash`),
    timestamp: rpcQuantity(block.timestamp, `${label} timestamp`)
  });
}
function rpcObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is unavailable or invalid`);
  }
  return value;
}
function assertExactKeys4(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  const actual = Reflect.ownKeys(value);
  const strings = actual.filter((key) => typeof key === "string").sort();
  const wanted = [...expected].sort();
  if (actual.length !== strings.length || strings.length !== wanted.length || strings.some((key, index) => key !== wanted[index])) throw new TypeError(`${label} has unexpected fields`);
}
function decimalString(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function decodeAddressArray(value, label) {
  const bytes = Buffer.from(value.slice(2), "hex");
  if (bytes.byteLength < 64 || bytes.byteLength % 32 !== 0 || readWord(bytes, 0) !== 32n) {
    throw new TypeError(`${label} ABI is invalid`);
  }
  const length = readSafeLength(bytes, 32, label);
  if (bytes.byteLength !== 64 + length * 32) throw new TypeError(`${label} ABI length is invalid`);
  const owners = [];
  for (let index = 0; index < length; index += 1) {
    const item = bytes.subarray(64 + index * 32, 96 + index * 32);
    if (!item.subarray(0, 12).every((byte) => byte === 0)) throw new TypeError(`${label} address is invalid`);
    owners.push(`0x${item.subarray(12).toString("hex")}`);
  }
  return Object.freeze(owners);
}
function decodeAbiString(value, label) {
  const bytes = Buffer.from(value.slice(2), "hex");
  if (bytes.byteLength < 64 || bytes.byteLength % 32 !== 0 || readWord(bytes, 0) !== 32n) {
    throw new TypeError(`${label} ABI is invalid`);
  }
  const length = readSafeLength(bytes, 32, label);
  const padded = Math.ceil(length / 32) * 32;
  if (bytes.byteLength !== 64 + padded) throw new TypeError(`${label} ABI length is invalid`);
  if (!bytes.subarray(64 + length).every((byte) => byte === 0)) {
    throw new TypeError(`${label} ABI padding is nonzero`);
  }
  const text2 = bytes.subarray(64, 64 + length).toString("utf8");
  if (Buffer.from(text2, "utf8").compare(bytes.subarray(64, 64 + length)) !== 0) {
    throw new TypeError(`${label} is not canonical UTF-8`);
  }
  return text2;
}
function readSafeLength(bytes, offset, label) {
  const value = readWord(bytes, offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError(`${label} ABI length is too large`);
  return Number(value);
}
function readWord(bytes, offset) {
  const word3 = bytes.subarray(offset, offset + 32);
  if (word3.byteLength !== 32) throw new TypeError("ABI word is truncated");
  return BigInt(`0x${word3.toString("hex")}`);
}
function addressWord2(value) {
  if (!/^0x[0-9a-f]{40}$/u.test(value)) throw new TypeError("address ABI word is invalid");
  return `0x${"0".repeat(24)}${value.slice(2)}`;
}
function word2(value) {
  if (!/^0x[0-9a-f]{64}$/u.test(value)) throw new TypeError("ABI word is invalid");
  return value;
}
function quantityWord(value) {
  if (value < 0n || value >= 1n << 256n) throw new TypeError("ABI uint256 is invalid");
  return `0x${value.toString(16).padStart(64, "0")}`;
}
function joinHex(first, ...rest) {
  return `0x${[first, ...rest].map((value) => value.slice(2)).join("")}`;
}
function flipDigestBit(value) {
  const bytes = Buffer.from(value.slice(2), "hex");
  bytes[31] = bytes[31] ^ 1;
  return `0x${bytes.toString("hex")}`;
}
function bytes322(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function rpcAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/u.test(value) || BigInt(value) === 0n) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function sha2562(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function hex2(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function rpcQuantity(value, label) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)) {
    throw new TypeError(`${label} is not a canonical JSON-RPC quantity`);
  }
  return value;
}
function quantity(value) {
  if (value < 0n) throw new TypeError("JSON-RPC quantity is negative");
  return `0x${value.toString(16)}`;
}
function boundedId(value, label) {
  if (value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
}
function deepFreeze6(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze6(nested);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/http-rpc-provider.ts
var MAXIMUM_RPC_RESPONSE_BYTES = 4 * 1024 * 1024;
var ALLOWED_METHODS = /* @__PURE__ */ new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt"
]);
var MANUAL_ROUTER_ALCHEMY_PROVIDER_ID_V1 = "manual-router-rpc:alchemy-mainnet-v1";
var MANUAL_ROUTER_QUICKNODE_PROVIDER_ID_V1 = "manual-router-rpc:quicknode-mainnet-v1";
var MANUAL_ROUTER_ALCHEMY_TRUST_DOMAIN_V1 = "alchemy.com";
var MANUAL_ROUTER_QUICKNODE_TRUST_DOMAIN_V1 = "quiknode.pro";
var MANUAL_ROUTER_ALCHEMY_RPC_ENV_V1 = "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL";
var MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1 = "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL";
var HttpRouterReadRpcProviderV1 = class {
  providerId;
  trustDomain;
  #endpoint;
  #fetch;
  #requestId = 0;
  constructor(input) {
    const endpoint = productionRpcEndpoint(input.endpoint, input.family);
    this.#endpoint = endpoint;
    this.#fetch = input.fetch;
    this.trustDomain = input.family === "alchemy" ? MANUAL_ROUTER_ALCHEMY_TRUST_DOMAIN_V1 : MANUAL_ROUTER_QUICKNODE_TRUST_DOMAIN_V1;
    this.providerId = input.family === "alchemy" ? MANUAL_ROUTER_ALCHEMY_PROVIDER_ID_V1 : MANUAL_ROUTER_QUICKNODE_PROVIDER_ID_V1;
  }
  async request(method, params) {
    if (!ALLOWED_METHODS.has(method)) throw new TypeError("manual Router RPC method is not allowed");
    if (!Array.isArray(params)) throw new TypeError("manual Router RPC params are invalid");
    const id2 = ++this.#requestId;
    let response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15e3),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "programmable-manual-router-operator-v1"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: id2, method, params })
      });
    } catch {
      throw new TypeError("manual Router RPC request failed");
    }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_RPC_RESPONSE_BYTES)) {
      throw new TypeError("manual Router RPC response exceeded its byte limit");
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAXIMUM_RPC_RESPONSE_BYTES) {
      throw new TypeError("manual Router RPC response exceeded its byte limit");
    }
    if (response.status !== 200) {
      throw new TypeError(`manual Router RPC returned HTTP ${response.status}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error2) {
      throw new TypeError("manual Router RPC response is not JSON", { cause: error2 });
    }
    const envelope = rpcEnvelope(parsed);
    const envelopeKeys = Object.keys(envelope).sort();
    if (envelopeKeys.length !== 3 || envelopeKeys.join(",") !== "id,jsonrpc,result" && envelopeKeys.join(",") !== "error,id,jsonrpc") throw new TypeError("manual Router RPC response has unexpected fields");
    if (envelope.jsonrpc !== "2.0" || envelope.id !== id2) {
      throw new TypeError("manual Router RPC response identity is invalid");
    }
    const hasResult = Object.prototype.hasOwnProperty.call(envelope, "result");
    const hasError = Object.prototype.hasOwnProperty.call(envelope, "error");
    if (hasResult === hasError) throw new TypeError("manual Router RPC response disposition is invalid");
    if (hasResult) return envelope.result;
    const error = rpcEnvelope(envelope.error);
    const message = typeof error.message === "string" ? error.message : "";
    if (method === "eth_call" && typeof error.code === "number" && Number.isSafeInteger(error.code) && /(?:execution\s+reverted|\brevert(?:ed)?\b)/iu.test(message)) throw new RouterRpcExecutionRevertV1("manual Router eth_call reverted");
    throw new TypeError("manual Router RPC returned an execution error");
  }
};
function productionRpcEndpoint(raw, family) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048 || raw !== raw.trim()) {
    throw new TypeError("manual Router RPC endpoint is invalid");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("manual Router RPC endpoint is invalid");
  }
  const hostname = parsed.hostname.toLowerCase();
  const familyMatches = family === "alchemy" ? hostname === "eth-mainnet.g.alchemy.com" : /^(?:[a-z0-9-]+\.)+quiknode\.pro$/u.test(hostname);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "" || parsed.port !== "" || parsed.pathname === "/" || !familyMatches) throw new TypeError("manual Router RPC endpoint does not match its production provider family");
  return parsed.href;
}
function rpcEnvelope(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("manual Router RPC response is not an object");
  }
  return raw;
}

// src/internal/router-self-service-v1/manual-preparation.ts
var PRODUCTION_INTAKE_FULL_NAME = "0xprogrammable/hookbuilder";
function createManualRouterLaunchPreparationV1(input) {
  const request = input.signatureRequest;
  const launch = input.launch;
  const claim = request.approval.claim;
  const revision = claim.approvalRevision;
  const rebuiltPermit = createLaunchPermitV1({
    launch,
    launchWallet: request.launchWallet,
    validAfter: request.permit.validAfter,
    deadline: request.permit.deadline
  });
  const { requestHash: _, ...requestCore } = request;
  if (request.schemaVersion !== "programmable.manual-github-router-signature-request.v1" || request.requestHash !== canonicalSha256(request.schemaVersion, requestCore) || request.approval.approvalBindingHash !== computeGitHubApprovalBindingHashV1(claim) || request.compileRequest.schemaVersion !== "programmable.router-custom-graph-compile-request.v3" || request.compileRequest.authorizedLauncher !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address || request.compileRequest.routeNamespace !== launch.plan.route.routeNamespace || request.compileRequest.routeNonce !== launch.plan.route.routeNonce || request.compileRequest.pullRequestNumber !== claim.pullRequestNumber || request.compileRequest.approvalRevisionHash !== computeRouterApprovalRevisionHashV1(revision) || request.planHash !== launch.planHash || request.compileInputHash !== request.compileRequest.compileInputHash || request.launchWallet !== claim.approvedLaunchWallet || canonicalizeJson(request.permit) !== canonicalizeJson(rebuiltPermit) || request.permitDigest !== computePermitDigestV1(request.permit) || request.safeMessageDigest !== computeSafeMessageSigningDigestV1(request.permitDigest) || request.finalizedAnchor.anchorHash !== request.preflight.finalizedAnchor.anchorHash || request.preflight.targetCount !== launch.plan.route.expectedOutputs.length) throw new TypeError("manual Router launch preparation inputs are not exactly bound");
  const preparation = {
    schemaVersion: "programmable.manual-router-launch-preparation.v1",
    authority: {
      chainId: "1",
      router: {
        address: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
        runtimeKeccak256: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.runtimeKeccak256
      },
      safe: {
        address: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address,
        runtimeKeccak256: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.runtimeKeccak256,
        admin: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.manualOwner
      }
    },
    source: {
      repositoryId: claim.repositoryId,
      repositoryFullName: PRODUCTION_INTAKE_FULL_NAME,
      pullRequestNumber: claim.pullRequestNumber,
      headRepositoryId: claim.headRepositoryId,
      headSha: claim.headSha,
      treeSha: claim.treeSha,
      applicantGitHubUserId: claim.approvedGitHubUserId,
      compileInputHash: claim.compileInputHash,
      planHash: claim.planHash,
      review: {
        bindingHash: request.approval.approvalBindingHash,
        approvalId: revision.approvalId,
        approvalVersion: revision.approvalVersion,
        reviewArtifactHash: revision.reviewArtifactHash,
        configurationHash: revision.configurationHash,
        evidenceDigest: revision.evidenceDigest,
        policyHash: revision.policyHash,
        authorizedPrincipalHash: revision.authorizedPrincipalHash,
        verifiedAtEpochSeconds: request.approval.verifiedAtEpochSeconds
      }
    },
    launch: {
      launchWallet: request.launchWallet,
      kind: 1,
      routePayload: launch.routePayload,
      routePayloadHash: launch.routePayloadHash,
      routeNonce: launch.plan.route.routeNonce,
      expectedResultHash: launch.expectedResultHash,
      stampRequest: launch.plan.stampRequest,
      stampRequestHash: launch.stampRequestHash,
      valueWei: launch.plan.valueWei,
      validAfter: request.permit.validAfter,
      deadline: request.permit.deadline,
      pendingNonceAtPreparation: toQuantity(request.preflight.pendingNonce)
    },
    authoritySignatureRequest: request
  };
  return deepFreeze7(preparation);
}
function toQuantity(value) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new TypeError("pending nonce is invalid");
  const parsed = BigInt(value);
  if (parsed >= 1n << 256n) throw new TypeError("pending nonce exceeds uint256");
  return `0x${parsed.toString(16)}`;
}
function deepFreeze7(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze7(nested);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/route-nonce.ts
function canonicalRouterRouteNonceSeedV1(raw) {
  assertExactKeys5(raw, [
    "approvalRevisionHash",
    "approvedGitHubUserId",
    "compileInputHash",
    "headRepositoryId",
    "headSha",
    "launchWallet",
    "pullRequestNumber",
    "repositoryId",
    "schemaVersion",
    "treeSha"
  ], "Router route-nonce seed");
  if (raw.schemaVersion !== "programmable.router-route-nonce-seed.v3") {
    throw new TypeError("Router route-nonce seed schema is invalid");
  }
  return deepFreeze8({
    schemaVersion: raw.schemaVersion,
    repositoryId: numericId2(raw.repositoryId, "repository id"),
    pullRequestNumber: positiveSafeInteger2(raw.pullRequestNumber, "pull-request number"),
    headRepositoryId: numericId2(raw.headRepositoryId, "head repository id"),
    headSha: gitSha3(raw.headSha, "head SHA"),
    treeSha: gitSha3(raw.treeSha, "tree SHA"),
    approvedGitHubUserId: numericId2(raw.approvedGitHubUserId, "approved GitHub user id"),
    approvalRevisionHash: sha2563(raw.approvalRevisionHash, "approval revision hash"),
    compileInputHash: sha2563(raw.compileInputHash, "compiler input hash"),
    launchWallet: address3(raw.launchWallet, "launch wallet")
  });
}
function deriveRouterRouteGenerationHashV1(raw) {
  const seed = canonicalRouterRouteNonceSeedV1(raw);
  return canonicalSha256("programmable.router-route-generation.v1", {
    chainId: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal,
    router: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
    graphFactory: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address,
    ...seed
  });
}
function deriveDeterministicRouteNonceV1(input) {
  const routeNamespace = bytes323(input.routeNamespace, "route namespace");
  const routeGenerationHash = deriveRouterRouteGenerationHashV1(input.seed);
  const nonce = framedKeccakV1("programmable.create2-graph-route-nonce.v1", [
    Uint8Array.from(Buffer.from(routeNamespace.slice(2), "hex")),
    Uint8Array.from(Buffer.from(routeGenerationHash.slice("sha256:".length), "hex"))
  ]);
  if (BigInt(nonce) === 0n) throw new TypeError("derived Router route nonce is zero");
  return nonce;
}
function createCustomGraphCompileRequestV1(input) {
  const seed = canonicalRouterRouteNonceSeedV1(input.seed);
  const routeNamespace = bytes323(input.routeNamespace, "route namespace");
  const preflightAuthorityBindingHash = sha2563(
    input.preflightAuthorityBindingHash,
    "preflight authority binding hash"
  );
  const graphRouteAdapterRegistryHash = sha2563(
    input.graphRouteAdapterRegistryHash,
    "graph route adapter registry hash"
  );
  const routeGenerationHash = deriveRouterRouteGenerationHashV1(seed);
  const core = {
    schemaVersion: "programmable.router-custom-graph-compile-request.v3",
    chainId: "1",
    router: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
    graphFactory: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address,
    authorizedLauncher: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
    repositoryId: seed.repositoryId,
    pullRequestNumber: seed.pullRequestNumber,
    headRepositoryId: seed.headRepositoryId,
    headSha: seed.headSha,
    treeSha: seed.treeSha,
    approvedGitHubUserId: seed.approvedGitHubUserId,
    approvalRevisionHash: seed.approvalRevisionHash,
    compileInputHash: seed.compileInputHash,
    launchWallet: seed.launchWallet,
    preflightAuthorityBindingHash,
    graphRouteAdapterRegistryHash,
    routeNamespace,
    routeGenerationHash,
    routeNonce: deriveDeterministicRouteNonceV1({ seed, routeNamespace })
  };
  return deepFreeze8({
    ...core,
    compileRequestHash: canonicalSha256(
      "programmable.router-custom-graph-compile-request.v3",
      core
    )
  });
}
function assertCustomGraphCompileRequestV1(raw) {
  assertExactKeys5(raw, [
    "approvalRevisionHash",
    "approvedGitHubUserId",
    "authorizedLauncher",
    "chainId",
    "compileInputHash",
    "compileRequestHash",
    "graphFactory",
    "graphRouteAdapterRegistryHash",
    "headRepositoryId",
    "headSha",
    "launchWallet",
    "preflightAuthorityBindingHash",
    "pullRequestNumber",
    "repositoryId",
    "routeGenerationHash",
    "routeNamespace",
    "routeNonce",
    "router",
    "schemaVersion",
    "treeSha"
  ], "Router CustomGraph compile request");
  if (raw.schemaVersion !== "programmable.router-custom-graph-compile-request.v3" || raw.chainId !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdDecimal || raw.router !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address || raw.graphFactory !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address || raw.authorizedLauncher !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address) throw new TypeError("Router CustomGraph compile request production binding is invalid");
  const rebuilt = createCustomGraphCompileRequestV1({
    seed: {
      schemaVersion: "programmable.router-route-nonce-seed.v3",
      repositoryId: raw.repositoryId,
      pullRequestNumber: raw.pullRequestNumber,
      headRepositoryId: raw.headRepositoryId,
      headSha: raw.headSha,
      treeSha: raw.treeSha,
      approvedGitHubUserId: raw.approvedGitHubUserId,
      approvalRevisionHash: raw.approvalRevisionHash,
      compileInputHash: raw.compileInputHash,
      launchWallet: raw.launchWallet
    },
    routeNamespace: raw.routeNamespace,
    preflightAuthorityBindingHash: raw.preflightAuthorityBindingHash,
    graphRouteAdapterRegistryHash: raw.graphRouteAdapterRegistryHash
  });
  if (canonicalizeJson(raw) !== canonicalizeJson(rebuilt)) {
    throw new TypeError("Router CustomGraph compile request provenance is invalid");
  }
  return rebuilt;
}
function positiveSafeInteger2(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function assertExactKeys5(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}
function numericId2(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function gitSha3(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function sha2563(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function bytes323(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const normalized = value.toLowerCase();
  if (BigInt(normalized) === 0n) throw new TypeError(`${label} is zero`);
  return normalized;
}
function address3(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const normalized = value.toLowerCase();
  if (BigInt(normalized) === 0n) throw new TypeError(`${label} is zero`);
  return normalized;
}
function deepFreeze8(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze8(nested);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/signer.ts
function assertAdminMetaMaskSafeMessageRequestV1(raw) {
  assertExactKeys6(raw, [
    "chainId",
    "expiresAtChainTimestamp",
    "issuedAtChainTimestamp",
    "method",
    "params",
    "permitDigest",
    "requiredAccount",
    "safe",
    "safeMessageDigest",
    "schemaVersion",
    "signingRequestHash",
    "typedData"
  ], "admin MetaMask SafeMessage request");
  if (raw.schemaVersion !== "programmable.admin-metamask-safe-message-request.v1" || raw.method !== "eth_signTypedData_v4" || raw.chainId !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.chain.chainIdHex || raw.requiredAccount !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.manualOwner || raw.safe !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.address) throw new TypeError("admin MetaMask SafeMessage request production binding is invalid");
  const permitDigest = bytes324(raw.permitDigest, "admin request permit digest");
  const typedData = safeMessageTypedDataV1(permitDigest);
  const issuedAt = uintString(raw.issuedAtChainTimestamp, "admin request issued-at");
  const expiresAt = uintString(raw.expiresAtChainTimestamp, "admin request expiry");
  if (raw.safeMessageDigest !== computeSafeMessageSigningDigestV1(permitDigest) || canonicalizeJson(raw.typedData) !== canonicalizeJson(typedData) || raw.params.length !== 2 || raw.params[0] !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.manualOwner || raw.params[1] !== JSON.stringify(typedData) || BigInt(issuedAt) > BigInt(expiresAt)) throw new TypeError("admin MetaMask SafeMessage request preimage is invalid");
  const { signingRequestHash: _, ...core } = raw;
  if (raw.signingRequestHash !== canonicalSha256(
    "programmable.admin-metamask-safe-message-request.v1",
    core
  )) throw new TypeError("admin MetaMask SafeMessage request hash is invalid");
  return deepFreeze9({ ...raw });
}
function acceptManualSafeOwnerSignatureV1(input) {
  const request = assertAdminMetaMaskSafeMessageRequestV1(input.request);
  const rawSignature65 = canonicalRawSignatureV1(input.rawSignature65);
  const core = {
    schemaVersion: "programmable.manual-safe-owner-signature.v1",
    signingRequestHash: request.signingRequestHash,
    rawSignature65
  };
  return deepFreeze9({
    ...core,
    signatureHash: canonicalSha256("programmable.manual-safe-owner-signature.v1", core)
  });
}
function assertExactKeys6(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}
function uintString(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function bytes324(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function deepFreeze9(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze9(nested);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/portable-publish-authority.ts
var INTAKE_REPOSITORY_ID = "1320085947";
var ECRECOVER_PRECOMPILE = "0x0000000000000000000000000000000000000001";
function createPortableManualRouterPublishAuthorityFromEnvV1(input) {
  const rpc = new DualProviderRouterReadAdapterV1([
    new HttpRouterReadRpcProviderV1({
      endpoint: requiredEnvironmentValue(
        input.env[MANUAL_ROUTER_ALCHEMY_RPC_ENV_V1],
        MANUAL_ROUTER_ALCHEMY_RPC_ENV_V1
      ),
      family: "alchemy",
      fetch: input.fetch
    }),
    new HttpRouterReadRpcProviderV1({
      endpoint: requiredEnvironmentValue(
        input.env[MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1],
        MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1
      ),
      family: "quicknode",
      fetch: input.fetch
    })
  ]);
  const githubReadToken = input.githubReadToken ?? null;
  const github = new GitHubRestApprovalCurrentnessVerifierV1({
    binding: loadProductionGitHubApprovalBindingV1({}),
    readTokenProvider: {
      async getReadToken() {
        return Object.freeze({ token: githubReadToken });
      }
    },
    fetch: input.fetch,
    ...input.nowEpochSeconds === void 0 ? {} : {
      nowEpochSeconds: input.nowEpochSeconds
    }
  });
  return Object.freeze({ github, rpc });
}
async function verifyPortableManualRouterSignedPublishV1(input) {
  const request = assertPortableManualRouterSignedPublishRequestV1(input.request);
  const artifact = request.signedArtifact;
  const launch = canonicalizeCustomGraphLaunchV1(
    artifact.preparationArtifact.compilation.plan
  );
  const claim = canonicalGitHubApprovalClaimV1(
    artifact.preparationArtifact.approvalClaim
  );
  const current = assertPortableApplicantHeadV1({
    index: input.currentApplicantIndex,
    pointers: input.currentApplicantPointers,
    claim
  });
  const currentPointer = current.pointers.find((pointer) => pointer.subject.subjectHash === artifact.preparationArtifact.subject.subjectHash);
  const currentEntry = current.index?.entries.find((entry) => entry.subjectHash === artifact.preparationArtifact.subject.subjectHash);
  if (currentPointer !== void 0 && currentEntry !== void 0 && currentEntry.pointerHash === currentPointer.pointerHash && currentPointer.state === "signed-permit-available" && currentPointer.signedArtifactHash === artifact.signedArtifactHash) {
    if (request.expectedPreviousPointerHash !== currentPointer.previousPointerHash) {
      throw new TypeError("portable idempotent publish predecessor does not match the stored head");
    }
    return deepFreeze10({
      schemaVersion: "programmable.portable-verified-manual-router-signed-publish.v1",
      request,
      nextPointer: currentPointer,
      nextApplicantIndex: current.index,
      idempotent: true
    });
  }
  assertExpectedCurrentHeadV1(request, currentPointer, currentEntry);
  const reviewed = record(
    artifact.preparationArtifact.reviewedCompileInput,
    "portable reviewed compile input"
  );
  const metadata = record(reviewed.submissionMetadata, "portable submission metadata");
  const applicantEvidence = assertHookbuilderApplicantRequestEvidenceV1(
    record(metadata.applicantRequest, "portable Applicant evidence")
  ).evidence;
  const source = sourceRevision(record(metadata.source, "portable source revision"));
  const previousPermit = previousPermitInputV1(artifact.preparationArtifact.signatureRequest);
  const observe = async () => {
    const [approvalValue, preflightValue] = await Promise.all([
      input.composition.github.verifyCurrentApproval(claim, applicantEvidence, source),
      input.composition.rpc.verifyProductionPreflight({
        launch,
        launchWallet: claim.approvedLaunchWallet,
        previousPermit
      })
    ]);
    const approval = assertVerifiedGitHubRouterApprovalV1(approvalValue);
    const preflight = assertRouterPreflightEvidenceV1(preflightValue, launch);
    assertCurrentApprovalV1(
      approval,
      artifact.preparationArtifact.signatureRequest.approval,
      metadata,
      source
    );
    assertLivePermitWindowV1(artifact.prepared.permit, preflight);
    return deepFreeze10({ approval, preflight });
  };
  const first = await observe();
  await input.composition.rpc.verifyPermitDigest(
    artifact.prepared.permit,
    artifact.prepared.permitDigest,
    first.preflight.finalizedAnchor.blockNumber
  );
  await assertManualOwnerRecoveryV1(
    input.composition.rpc,
    artifact.prepared.safeMessageDigest,
    artifact.signedEnvelope.rawSignature65
  );
  const signature = await input.composition.rpc.selectValidSafeSignature({
    permitDigest: artifact.prepared.permitDigest,
    rawSignature65: artifact.signedEnvelope.rawSignature65
  });
  if (signature !== artifact.prepared.adminSignature.rawSignature65) {
    throw new TypeError("portable Safe signature selection changed the signed calldata bytes");
  }
  await input.composition.rpc.simulateExactLaunch({
    from: artifact.prepared.launchWallet,
    data: artifact.prepared.calldata,
    value: artifact.prepared.browserAction.params[0].value,
    expectedStampHash: artifact.prepared.expectedStampHash
  });
  const second = await observe();
  if (first.approval.approvalBindingHash !== second.approval.approvalBindingHash) {
    throw new TypeError("portable GitHub currentness changed during signed publication");
  }
  await input.composition.rpc.verifyPermitDigest(
    artifact.prepared.permit,
    artifact.prepared.permitDigest,
    second.preflight.finalizedAnchor.blockNumber
  );
  await input.composition.rpc.simulateExactLaunch({
    from: artifact.prepared.launchWallet,
    data: artifact.prepared.calldata,
    value: artifact.prepared.browserAction.params[0].value,
    expectedStampHash: artifact.prepared.expectedStampHash
  });
  const nextPointer = createPortableSignedPointerV1({
    artifact,
    previousPointerHash: currentPointer?.pointerHash ?? null,
    updatedAtEpochSeconds: second.preflight.chainClock.maximumTimestamp
  });
  const nextApplicantIndex = advancePortableApplicantIndexV1({
    previousIndex: current.index,
    previousPointers: current.pointers,
    nextPointer
  });
  return deepFreeze10({
    schemaVersion: "programmable.portable-verified-manual-router-signed-publish.v1",
    request,
    nextPointer,
    nextApplicantIndex,
    idempotent: false
  });
}
function assertPortableManualRouterSignedPublishRequestV1(raw) {
  const request = exactRecord(raw, [
    "expectedPreviousPointerHash",
    "schemaVersion",
    "signedArtifact"
  ], "portable signed publish request");
  if (request.schemaVersion !== "programmable.manual-router-signed-artifact-publish-request.v1") {
    throw new TypeError("portable signed publish request schema is invalid");
  }
  const expectedPreviousPointerHash = request.expectedPreviousPointerHash === null ? null : sha2564(request.expectedPreviousPointerHash, "expected previous pointer hash");
  const signedArtifact = assertPortableManualRouterCompleteSignedArtifactV1(
    request.signedArtifact
  );
  const reissueOf = signedArtifact.preparationArtifact.signatureRequest.reissueOf;
  if (expectedPreviousPointerHash === null !== (reissueOf === null)) {
    throw new TypeError("portable signed publish current-head expectation does not match reissue");
  }
  return deepFreeze10({
    schemaVersion: request.schemaVersion,
    expectedPreviousPointerHash,
    signedArtifact
  });
}
async function resolvePortableManualRouterReissueStateV1(input) {
  const requestValue = exactRecord(input.request, [
    "previousSignedArtifact",
    "schemaVersion"
  ], "portable operator reissue-state request");
  if (requestValue.schemaVersion !== "programmable.manual-router-operator-reissue-state-request.v1") {
    throw new TypeError("portable operator reissue-state request schema is invalid");
  }
  const previousSignedArtifact = assertPortableManualRouterCompleteSignedArtifactV1(
    requestValue.previousSignedArtifact
  );
  const request = deepFreeze10({
    schemaVersion: requestValue.schemaVersion,
    previousSignedArtifact
  });
  const claim = canonicalGitHubApprovalClaimV1(
    request.previousSignedArtifact.preparationArtifact.approvalClaim
  );
  const reviewed = record(
    previousSignedArtifact.preparationArtifact.reviewedCompileInput,
    "portable reissue reviewed compile input"
  );
  const metadata = record(reviewed.submissionMetadata, "portable reissue submission metadata");
  const applicantEvidence = assertHookbuilderApplicantRequestEvidenceV1(
    record(metadata.applicantRequest, "portable reissue Applicant evidence")
  ).evidence;
  const source = sourceRevision(record(metadata.source, "portable reissue source revision"));
  const [approvalValue, finalizedAnchor] = await Promise.all([
    input.composition.github.verifyCurrentApproval(claim, applicantEvidence, source),
    input.composition.rpc.verifyProductionRuntimeBindings()
  ]);
  const approval = assertVerifiedGitHubRouterApprovalV1(approvalValue);
  assertCurrentApprovalV1(
    approval,
    previousSignedArtifact.preparationArtifact.signatureRequest.approval,
    metadata,
    source
  );
  await input.composition.rpc.verifyPermitDigest(
    previousSignedArtifact.prepared.permit,
    previousSignedArtifact.prepared.permitDigest,
    finalizedAnchor.blockNumber
  );
  await assertManualOwnerRecoveryV1(
    input.composition.rpc,
    previousSignedArtifact.prepared.safeMessageDigest,
    previousSignedArtifact.signedEnvelope.rawSignature65
  );
  const selectedSignature = await input.composition.rpc.selectValidSafeSignature({
    permitDigest: previousSignedArtifact.prepared.permitDigest,
    rawSignature65: previousSignedArtifact.signedEnvelope.rawSignature65
  });
  if (selectedSignature !== previousSignedArtifact.prepared.adminSignature.rawSignature65) {
    throw new TypeError("portable reissue Safe signature selection changed the signed bytes");
  }
  const current = assertPortableApplicantHeadV1({
    index: input.currentApplicantIndex,
    pointers: input.currentApplicantPointers,
    claim
  });
  const subjectHash = request.previousSignedArtifact.preparationArtifact.subject.subjectHash;
  const currentPointer = current.pointers.find((pointer) => pointer.subject.subjectHash === subjectHash);
  const currentEntry = current.index?.entries.find((entry) => entry.subjectHash === subjectHash);
  if (currentPointer === void 0 || currentEntry === void 0 || currentEntry.pointerHash !== currentPointer.pointerHash || currentPointer.signedArtifactHash !== request.previousSignedArtifact.signedArtifactHash) {
    return Object.freeze({
      schemaVersion: "programmable.manual-router-operator-reissue-state-response.v1",
      disposition: "stale",
      code: "stale_previous_artifact"
    });
  }
  const status = applicantStatus(input.currentStatus);
  return deepFreeze10({
    schemaVersion: "programmable.manual-router-operator-reissue-state-response.v1",
    disposition: "current",
    status,
    currentPointer,
    currentApplicantIndex: current.index
  });
}
function assertPortableManualRouterCompleteSignedArtifactV1(raw) {
  const artifact = exactRecord(raw, [
    "descriptor",
    "preparationArtifact",
    "prepared",
    "schemaVersion",
    "signedArtifactHash",
    "signedEnvelope"
  ], "portable complete signed artifact");
  if (artifact.schemaVersion !== "programmable.manual-router-complete-signed-artifact.v1") {
    throw new TypeError("portable complete signed artifact schema is invalid");
  }
  assertHashRecord(artifact, artifact.schemaVersion, "signedArtifactHash");
  const validatedPreparation = assertPortableAuthorityPreparationArtifactV1(
    artifact.preparationArtifact
  );
  const {
    preparationArtifact,
    signatureRequest,
    launch,
    subject
  } = validatedPreparation;
  const prepared = assertPortablePreparedV1(artifact.prepared, signatureRequest, launch);
  const envelope = assertPortableEnvelopeV1(
    artifact.signedEnvelope,
    signatureRequest,
    prepared
  );
  const descriptor = assertPortableDescriptorV1(
    artifact.descriptor,
    subject.subjectHash,
    preparationArtifact.preparationArtifactHash,
    signatureRequest,
    prepared,
    envelope
  );
  if (descriptor.preparedHash !== prepared.preparationHash || descriptor.envelopeHash !== envelope.envelopeHash) throw new TypeError("portable signed descriptor does not bind the aggregate");
  return deepFreeze10(structuredClone(artifact));
}
function assertPortableManualRouterOperatorPreparationV1(raw) {
  const value = exactRecord(raw, [
    "approvalClaim",
    "expectedPreviousPointerHash",
    "launchWallet",
    "permitLifetimeSeconds",
    "preparation",
    "preparationArtifact",
    "preparationHash",
    "reviewedCompileInput",
    "schemaVersion"
  ], "portable manual Router operator preparation");
  if (value.schemaVersion !== "programmable.manual-router-operator-preparation.v1") {
    throw new TypeError("portable manual Router operator preparation schema is invalid");
  }
  const validated = assertPortableAuthorityPreparationArtifactV1(value.preparationArtifact);
  const approvalClaim = canonicalGitHubApprovalClaimV1(
    value.approvalClaim
  );
  const reviewed = assertPortableReviewedCompileInputV1(value.reviewedCompileInput);
  const expectedPreviousPointerHash = value.expectedPreviousPointerHash === null ? null : sha2564(value.expectedPreviousPointerHash, "portable expected previous pointer hash");
  const permitLifetimeSeconds = value.permitLifetimeSeconds;
  if (!Number.isSafeInteger(permitLifetimeSeconds) || permitLifetimeSeconds < PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permit.minimumRemainingLifetimeSeconds || permitLifetimeSeconds > PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permit.manualMaximumLifetimeSeconds - PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permit.clockSkewSeconds || BigInt(validated.signatureRequest.permit.deadline) - BigInt(validated.signatureRequest.preflight.chainClock.maximumTimestamp) !== BigInt(permitLifetimeSeconds) || value.launchWallet !== approvalClaim.approvedLaunchWallet || canonicalizeJson(approvalClaim) !== canonicalizeJson(validated.claim) || canonicalizeJson(reviewed) !== canonicalizeJson(validated.reviewed) || canonicalizeJson(value.preparation) !== canonicalizeJson(validated.preparationArtifact.preparation) || expectedPreviousPointerHash === null !== (validated.signatureRequest.reissueOf === null)) throw new TypeError("portable manual Router operator preparation binding is invalid");
  const core = {
    schemaVersion: "programmable.manual-router-operator-preparation.v1",
    approvalClaim,
    reviewedCompileInput: reviewed,
    launchWallet: approvalClaim.approvedLaunchWallet,
    permitLifetimeSeconds,
    preparation: validated.preparationArtifact.preparation,
    preparationArtifact: validated.preparationArtifact,
    expectedPreviousPointerHash
  };
  const rebuilt = deepFreeze10({
    ...core,
    preparationHash: canonicalSha256(core.schemaVersion, core)
  });
  if (canonicalizeJson(value) !== canonicalizeJson(rebuilt)) {
    throw new TypeError("portable manual Router operator preparation hash is invalid");
  }
  return rebuilt;
}
function assertPortableAuthorityPreparationArtifactV1(raw) {
  const preparationArtifact = exactRecord(raw, [
    "approvalClaim",
    "compilation",
    "preparation",
    "preparationArtifactHash",
    "reviewedCompileInput",
    "schemaVersion",
    "signatureRequest",
    "subject"
  ], "portable preparation artifact");
  if (preparationArtifact.schemaVersion !== "programmable.manual-router-authority-preparation-artifact.v1") {
    throw new TypeError("portable preparation artifact schema is invalid");
  }
  assertHashRecord(
    preparationArtifact,
    preparationArtifact.schemaVersion,
    "preparationArtifactHash"
  );
  const claim = canonicalGitHubApprovalClaimV1(
    preparationArtifact.approvalClaim
  );
  const subject = assertPortableSubjectV1(preparationArtifact.subject, claim);
  const reviewed = assertPortableReviewedCompileInputV1(preparationArtifact.reviewedCompileInput);
  const compilation = assertPortableCompilationV1(preparationArtifact.compilation);
  const launch = canonicalizeCustomGraphLaunchV1(compilation.plan);
  const signatureRequest = assertPortableSignatureRequestV1(
    preparationArtifact.signatureRequest,
    launch
  );
  assertPortableApplicantMetadataBindingV1({
    reviewed,
    claim,
    approval: signatureRequest.approval,
    compileRequest: signatureRequest.compileRequest
  });
  const preparation = createManualRouterLaunchPreparationV1({ signatureRequest, launch });
  if (canonicalizeJson(preparationArtifact.preparation) !== canonicalizeJson(preparation) || canonicalizeJson(signatureRequest.approval.claim) !== canonicalizeJson(claim) || reviewed.compileInputHash !== compilation.compileInputHash || reviewed.compileInputHash !== claim.compileInputHash || compilation.planHash !== claim.planHash || canonicalizeJson(compilation.compileRequest) !== canonicalizeJson(signatureRequest.compileRequest) || signatureRequest.permit.nonce !== compilation.compileRequest.routeNonce) throw new TypeError("portable preparation artifact transitive binding is invalid");
  return deepFreeze10({
    preparationArtifact,
    claim,
    reviewed,
    launch,
    signatureRequest,
    subject
  });
}
function assertPortableReviewedCompileInputV1(raw) {
  const reviewed = exactRecord(raw, [
    "applicationId",
    "applicationManifestSha256",
    "compileInputHash",
    "compilerEvidenceDigest",
    "compilerProfileBindingHash",
    "externalDependencies",
    "requiresUniswapV4PoolManager",
    "schemaVersion",
    "sourceRevisionBindingHash",
    "stamp",
    "submissionMetadata",
    "targets"
  ], "portable reviewed compile input");
  if (reviewed.schemaVersion !== "programmable.stored-router-custom-graph-reviewed-compile-input.v1") {
    throw new TypeError("portable reviewed compile input schema is invalid");
  }
  const { compileInputHash, schemaVersion: _stored, ...storedView } = reviewed;
  const hashView = {
    schemaVersion: "programmable.router-custom-graph-reviewed-compile-input.v1",
    ...storedView
  };
  if (compileInputHash !== canonicalSha256(
    "programmable.router-custom-graph-reviewed-compile-input.v1",
    hashView
  )) throw new TypeError("portable reviewed compile-input hash is invalid");
  assertHookbuilderApplicantRequestEvidenceV1(
    record(record(reviewed.submissionMetadata, "portable submission metadata").applicantRequest, "portable Applicant evidence")
  );
  return reviewed;
}
function assertPortableApplicantMetadataBindingV1(input) {
  const metadata = exactRecord(input.reviewed.submissionMetadata, [
    "applicant",
    "applicantRequest",
    "hook",
    "metadataHash",
    "model",
    "platformFee",
    "requestedRoute",
    "schemaVersion",
    "source",
    "template"
  ], "portable reviewed submission metadata");
  if (metadata.schemaVersion !== "programmable.router-reviewed-submission-metadata.v1") {
    throw new TypeError("portable reviewed submission metadata schema is invalid");
  }
  assertHashRecord(metadata, metadata.schemaVersion, "metadataHash");
  const parsed = assertHookbuilderApplicantRequestEvidenceV1(
    metadata.applicantRequest
  );
  const request = parsed.request;
  const applicant = exactRecord(metadata.applicant, [
    "githubLogin",
    "launchWallet"
  ], "portable reviewed Applicant identity");
  const source = sourceRevision(exactRecord(metadata.source, [
    "commitSha",
    "repositoryId",
    "repositoryUrl",
    "treeSha"
  ], "portable reviewed source revision"));
  const hook = exactRecord(metadata.hook, ["id", "version"], "portable reviewed hook");
  const template = exactRecord(metadata.template, ["id", "version"], "portable reviewed template");
  const model = exactRecord(metadata.model, ["id", "version"], "portable reviewed model");
  const platformFee = exactRecord(metadata.platformFee, [
    "amountPips",
    "currencyBasis",
    "denominator",
    "mutable",
    "recipient"
  ], "portable reviewed platform fee");
  const requestedRoute = exactRecord(metadata.requestedRoute, [
    "chainId",
    "routeId",
    "routeVersion"
  ], "portable reviewed requested route");
  const normalizedFeeRecipient = request.fee.recipient === null ? null : request.fee.recipient.toLowerCase();
  if (input.reviewed.applicationId !== request.identifiers.hookId || input.reviewed.applicationManifestSha256 !== parsed.evidence.canonicalSha256 || request.intake.repositoryId.toString() !== input.claim.repositoryId || request.applicant.githubLogin.toLowerCase() !== String(applicant.githubLogin).toLowerCase() || request.applicant.githubLogin.toLowerCase() !== input.approval.pullRequestAuthorGitHubLogin.toLowerCase() || parsed.launchWallet !== applicant.launchWallet || parsed.launchWallet !== input.claim.approvedLaunchWallet || parsed.launchWallet !== input.compileRequest.launchWallet || input.approval.pullRequestAuthorGitHubUserId !== input.claim.approvedGitHubUserId || request.source.repositoryId.toString() !== source.repositoryId || request.source.repository !== source.repositoryUrl || request.source.commit !== source.commitSha || request.source.tree !== source.treeSha || source.repositoryId !== input.approval.sourceRepositoryId || source.repositoryUrl !== input.approval.sourceRepositoryUrl || source.commitSha !== input.approval.sourceCommitSha || source.treeSha !== input.approval.sourceTreeSha || hook.id !== request.identifiers.hookId || hook.version !== request.identifiers.hookVersion || template.id !== request.identifiers.templateId || template.version !== request.identifiers.templateVersion || model.id !== request.identifiers.modelId || model.version !== request.identifiers.modelVersion || platformFee.amountPips !== request.fee.amountPips || platformFee.denominator !== request.fee.denominator || platformFee.currencyBasis !== request.fee.currencyBasis || platformFee.mutable !== request.fee.mutable || platformFee.recipient !== normalizedFeeRecipient || requestedRoute.routeId !== request.requestedRoute.routeId || requestedRoute.routeVersion !== request.requestedRoute.routeVersion || requestedRoute.chainId !== request.requestedRoute.chainId) throw new TypeError("portable Applicant request, review metadata, approval, or source drifted");
}
function assertPortableCompilationV1(raw) {
  const compilation = exactRecord(raw, [
    "compilationHash",
    "compileInputHash",
    "compileRequest",
    "plan",
    "planHash",
    "preflightAuthorityBindingHash",
    "production",
    "schemaVersion",
    "simulationHash"
  ], "portable production compilation");
  if (compilation.schemaVersion !== "programmable.router-custom-graph-compilation.v1" || compilation.production !== true) throw new TypeError("portable compilation is not production-authenticated");
  assertHashRecord(compilation, compilation.schemaVersion, "compilationHash");
  const compileRequest = assertCustomGraphCompileRequestV1(
    compilation.compileRequest
  );
  const launch = canonicalizeCustomGraphLaunchV1(compilation.plan);
  if (compilation.compileInputHash !== compileRequest.compileInputHash || compilation.preflightAuthorityBindingHash !== compileRequest.preflightAuthorityBindingHash || compilation.planHash !== launch.planHash || launch.plan.route.routeNamespace !== compileRequest.routeNamespace || launch.plan.route.routeNonce !== compileRequest.routeNonce) throw new TypeError("portable compilation plan or compile request drifted");
  return compilation;
}
function assertPortableSignatureRequestV1(raw, launch) {
  const request = exactRecord(raw, [
    "adminWalletRequest",
    "approval",
    "compileInputHash",
    "compileRequest",
    "finalizedAnchor",
    "launchWallet",
    "permit",
    "permitDigest",
    "planHash",
    "preflight",
    "reissueOf",
    "requestHash",
    "safeMessageDigest",
    "schemaVersion"
  ], "portable signature request");
  if (request.schemaVersion !== "programmable.manual-github-router-signature-request.v1") {
    throw new TypeError("portable signature request schema is invalid");
  }
  const approval = assertVerifiedGitHubRouterApprovalV1(
    request.approval
  );
  const compileRequest = assertCustomGraphCompileRequestV1(
    request.compileRequest
  );
  const preflight = assertRouterPreflightEvidenceV1(request.preflight, launch);
  const permitRecord = record(request.permit, "portable permit");
  const permit = createLaunchPermitV1({
    launch,
    launchWallet: approval.claim.approvedLaunchWallet,
    validAfter: permitRecord.validAfter,
    deadline: permitRecord.deadline,
    nonce: permitRecord.nonce
  });
  const adminRequest = assertAdminMetaMaskSafeMessageRequestV1(request.adminWalletRequest);
  const permitDigest = computePermitDigestV1(permit);
  const safeMessageDigest = computeSafeMessageSigningDigestV1(permitDigest);
  const reissueOf = request.reissueOf === null ? null : sha2564(request.reissueOf, "portable reissue request hash");
  const previousPermitDeadline = preflight.unconsumed.previousPermit.previousPermitDeadline;
  if (canonicalizeJson(request.permit) !== canonicalizeJson(permit) || request.planHash !== launch.planHash || request.planHash !== approval.claim.planHash || request.compileInputHash !== approval.claim.compileInputHash || request.compileInputHash !== compileRequest.compileInputHash || request.launchWallet !== approval.claim.approvedLaunchWallet || request.launchWallet !== compileRequest.launchWallet || approval.claim.repositoryId !== compileRequest.repositoryId || approval.claim.pullRequestNumber !== compileRequest.pullRequestNumber || approval.claim.headRepositoryId !== compileRequest.headRepositoryId || approval.claim.headSha !== compileRequest.headSha || approval.claim.treeSha !== compileRequest.treeSha || approval.claim.approvedGitHubUserId !== compileRequest.approvedGitHubUserId || computeRouterApprovalRevisionHashV1(approval.claim.approvalRevision) !== compileRequest.approvalRevisionHash || request.permitDigest !== permitDigest || request.safeMessageDigest !== safeMessageDigest || adminRequest.permitDigest !== permitDigest || adminRequest.safeMessageDigest !== safeMessageDigest || adminRequest.issuedAtChainTimestamp !== preflight.chainClock.maximumTimestamp || adminRequest.expiresAtChainTimestamp !== permit.deadline || canonicalizeJson(request.finalizedAnchor) !== canonicalizeJson(preflight.finalizedAnchor) || preflight.targetCount !== launch.plan.route.expectedOutputs.length || reissueOf === null !== (previousPermitDeadline === null) || reissueOf !== null && previousPermitDeadline !== null && (BigInt(permit.validAfter) <= BigInt(previousPermitDeadline) || BigInt(preflight.finalizedAnchor.timestamp) <= BigInt(previousPermitDeadline))) throw new TypeError("portable signature request transitive binding is invalid");
  assertHashRecord(request, request.schemaVersion, "requestHash");
  return request;
}
function assertPortablePreparedV1(raw, request, launch) {
  const prepared = exactRecord(raw, [
    "adminSignature",
    "approval",
    "browserAction",
    "calldata",
    "compileInputHash",
    "compileRequest",
    "componentSetHash",
    "expectedComponents",
    "expectedLaunchId",
    "expectedPoolId",
    "expectedStampHash",
    "finalizedAnchor",
    "idempotencyKey",
    "launchWallet",
    "permit",
    "permitDigest",
    "planHash",
    "poolKeyHash",
    "preflight",
    "preparationHash",
    "safeMessageDigest",
    "safeTypedData",
    "schemaVersion",
    "signatureRequestHash"
  ], "portable prepared launch");
  if (prepared.schemaVersion !== "programmable.prepared-github-router-launch.v3") {
    throw new TypeError("portable prepared launch schema is invalid");
  }
  const approval = assertVerifiedGitHubRouterApprovalV1(prepared.approval);
  const preflight = assertRouterPreflightEvidenceV1(prepared.preflight, launch);
  const adminSignature = acceptManualSafeOwnerSignatureV1({
    request: request.adminWalletRequest,
    rawSignature65: record(prepared.adminSignature, "portable admin signature").rawSignature65
  });
  const calldata = encodeLaunchAndStampCalldataV1({
    permit: request.permit,
    stampRequest: launch.plan.stampRequest,
    routePayload: launch.routePayload,
    signature: adminSignature.rawSignature65
  });
  const browserAction = createBrowserWalletRouterActionV1({
    permit: request.permit,
    calldata,
    pendingNonce: preflight.pendingNonce
  });
  const expectedComponents = launch.plan.stampRequest.components.map((component) => ({
    account: component.account,
    runtimeCodeHash: component.runtimeCodeHash,
    kind: component.kind
  }));
  const expectedStampHash = computeLaunchStampHashV1({
    permit: request.permit,
    stampRequest: launch.plan.stampRequest,
    permitDigest: request.permitDigest
  });
  const idempotencyKey = canonicalSha256("programmable.manual-router-launch-identity.v1", {
    approvalBindingHash: approval.approvalBindingHash,
    planHash: launch.planHash,
    compileInputHash: request.compileInputHash,
    launchWallet: request.launchWallet,
    routeNonce: request.compileRequest.routeNonce
  });
  if (prepared.signatureRequestHash !== request.requestHash || approval.approvalBindingHash !== request.approval.approvalBindingHash || canonicalizeJson(prepared.compileRequest) !== canonicalizeJson(request.compileRequest) || prepared.planHash !== launch.planHash || prepared.compileInputHash !== request.compileInputHash || prepared.launchWallet !== request.launchWallet || canonicalizeJson(prepared.permit) !== canonicalizeJson(request.permit) || prepared.permitDigest !== request.permitDigest || prepared.safeMessageDigest !== request.safeMessageDigest || canonicalizeJson(prepared.safeTypedData) !== canonicalizeJson(safeMessageTypedDataV1(request.permitDigest)) || canonicalizeJson(prepared.adminSignature) !== canonicalizeJson(adminSignature) || prepared.calldata !== calldata || canonicalizeJson(prepared.browserAction) !== canonicalizeJson(browserAction) || prepared.expectedStampHash !== expectedStampHash || prepared.expectedLaunchId !== launch.plan.stampRequest.launchId || prepared.expectedPoolId !== launch.poolId || prepared.poolKeyHash !== launch.poolKeyHash || prepared.componentSetHash !== launch.componentSetHash || canonicalizeJson(prepared.expectedComponents) !== canonicalizeJson(expectedComponents) || canonicalizeJson(prepared.finalizedAnchor) !== canonicalizeJson(preflight.finalizedAnchor) || prepared.idempotencyKey !== idempotencyKey) throw new TypeError("portable prepared launch action or hash chain drifted");
  assertHashRecord(prepared, prepared.schemaVersion, "preparationHash");
  return prepared;
}
function assertPortableEnvelopeV1(raw, request, prepared) {
  const envelope = exactRecord(raw, [
    "approvalBindingHash",
    "deadline",
    "envelopeHash",
    "initialPreparedHash",
    "permitDigest",
    "rawSignature65",
    "routeNonce",
    "schemaVersion",
    "signatureRequest",
    "signatureRequestHash",
    "validAfter"
  ], "portable signed envelope");
  if (envelope.schemaVersion !== "programmable.durable-manual-router-signed-envelope.v1") {
    throw new TypeError("portable signed envelope schema is invalid");
  }
  if (envelope.approvalBindingHash !== request.approval.approvalBindingHash || envelope.signatureRequestHash !== request.requestHash || canonicalizeJson(envelope.signatureRequest) !== canonicalizeJson(request) || envelope.routeNonce !== request.permit.nonce || envelope.permitDigest !== request.permitDigest || envelope.validAfter !== request.permit.validAfter || envelope.deadline !== request.permit.deadline || envelope.rawSignature65 !== prepared.adminSignature.rawSignature65 || envelope.initialPreparedHash !== prepared.preparationHash) throw new TypeError("portable signed envelope binding is invalid");
  assertHashRecord(envelope, envelope.schemaVersion, "envelopeHash");
  return envelope;
}
function assertPortableDescriptorV1(raw, subjectHash, preparationArtifactHash, request, prepared, envelope) {
  const descriptor = exactRecord(raw, [
    "approvalBindingHash",
    "deadline",
    "descriptorHash",
    "envelopeHash",
    "permitDigest",
    "preparationArtifactHash",
    "preparedHash",
    "reissueOf",
    "routeNonce",
    "schemaVersion",
    "signatureRequestHash",
    "subjectHash",
    "validAfter"
  ], "portable signed descriptor");
  if (descriptor.schemaVersion !== "programmable.manual-router-signed-artifact-descriptor.v1") {
    throw new TypeError("portable signed descriptor schema is invalid");
  }
  if (descriptor.subjectHash !== subjectHash || descriptor.approvalBindingHash !== request.approval.approvalBindingHash || descriptor.routeNonce !== request.permit.nonce || descriptor.preparationArtifactHash !== preparationArtifactHash || descriptor.signatureRequestHash !== request.requestHash || descriptor.envelopeHash !== envelope.envelopeHash || descriptor.preparedHash !== prepared.preparationHash || descriptor.permitDigest !== request.permitDigest || descriptor.validAfter !== request.permit.validAfter || descriptor.deadline !== request.permit.deadline || descriptor.reissueOf !== request.reissueOf) throw new TypeError("portable signed descriptor binding is invalid");
  assertHashRecord(descriptor, descriptor.schemaVersion, "descriptorHash");
  return descriptor;
}
function assertPortableSubjectV1(raw, claim) {
  const subject = exactRecord(raw, [
    "approvedGitHubUserId",
    "approvedLaunchWallet",
    "pullRequestNumber",
    "repositoryId",
    "schemaVersion",
    "subjectHash"
  ], "portable Applicant subject");
  if (subject.schemaVersion !== "programmable.manual-router-applicant-subject.v1" || subject.repositoryId !== INTAKE_REPOSITORY_ID || subject.pullRequestNumber !== claim.pullRequestNumber || subject.approvedGitHubUserId !== claim.approvedGitHubUserId || subject.approvedLaunchWallet !== claim.approvedLaunchWallet) throw new TypeError("portable Applicant subject does not match approval");
  assertHashRecord(subject, subject.schemaVersion, "subjectHash");
  return subject;
}
function assertExpectedCurrentHeadV1(request, currentPointer, currentEntry) {
  const reissueOf = request.signedArtifact.preparationArtifact.signatureRequest.reissueOf;
  if (reissueOf === null) {
    if (request.expectedPreviousPointerHash !== null || currentPointer !== void 0 || currentEntry !== void 0) throw new TypeError("portable initial publish does not start from an empty subject head");
    return;
  }
  const previous = request.signedArtifact.preparationArtifact.signatureRequest.preflight.unconsumed.previousPermit;
  const transaction = previous.transaction;
  const dispositionMatches = currentPointer?.state === "signed-permit-available" ? currentPointer.submittedTransactionHash === null && transaction === null : currentPointer?.state === "submitted-awaiting-finality" ? currentPointer.submittedTransactionHash !== null && transaction?.transactionHash === currentPointer.submittedTransactionHash && transaction.disposition === "absent-after-finalized-deadline" : currentPointer?.state === "submission-failed-awaiting-expiry" && currentPointer.submittedTransactionHash !== null && currentPointer.failedTransactionEvidenceHash !== null && transaction?.transactionHash === currentPointer.submittedTransactionHash && transaction.disposition === "finalized-reverted";
  if (currentPointer === void 0 || currentEntry === void 0 || currentEntry.pointerHash !== currentPointer.pointerHash || request.expectedPreviousPointerHash !== currentPointer.pointerHash || currentPointer.signatureRequestHash !== reissueOf || currentPointer.deadline === null || previous.previousPermitDeadline !== currentPointer.deadline || !dispositionMatches) throw new TypeError("portable signed reissue does not extend the exact current subject head");
}
function assertCurrentApprovalV1(current, stored, metadata, source) {
  const applicant = record(metadata.applicant, "portable Applicant identity");
  if (current.approvalBindingHash !== stored.approvalBindingHash || canonicalizeJson(current.claim) !== canonicalizeJson(stored.claim) || current.pullRequestAuthorGitHubUserId !== stored.pullRequestAuthorGitHubUserId || current.pullRequestAuthorGitHubLogin.toLowerCase() !== String(applicant.githubLogin).toLowerCase() || current.sourceRepositoryId !== source.repositoryId || current.sourceRepositoryUrl !== source.repositoryUrl || current.sourceCommitSha !== source.commitSha || current.sourceTreeSha !== source.treeSha) throw new TypeError("portable Applicant GitHub currentness drifted");
}
function previousPermitInputV1(request) {
  if (request.reissueOf === null) return null;
  const previous = request.preflight.unconsumed.previousPermit;
  return {
    deadline: previous.previousPermitDeadline,
    transactionHash: previous.transaction?.transactionHash ?? null,
    expectedDisposition: previous.transaction?.disposition ?? "not-submitted"
  };
}
function assertLivePermitWindowV1(permit, preflight) {
  const minimum = BigInt(preflight.chainClock.minimumTimestamp);
  const maximum = BigInt(preflight.chainClock.maximumTimestamp);
  if (minimum < BigInt(permit.validAfter) || maximum > BigInt(permit.deadline) || BigInt(permit.deadline) - maximum < BigInt(MANUAL_ROUTER_MINIMUM_REMAINING_SECONDS_V1)) throw new TypeError("portable signed permit is not live with the 120-second chain buffer");
}
async function assertManualOwnerRecoveryV1(rpc, digest, signature) {
  const raw = signature.slice(2);
  if (raw.length !== 130) throw new TypeError("portable raw signature is not 65 bytes");
  const r = raw.slice(0, 64);
  const s = raw.slice(64, 128);
  const v = BigInt(`0x${raw.slice(128)}`);
  const data = `0x${digest.slice(2)}${v.toString(16).padStart(64, "0")}${r}${s}`;
  const recovered = await rpc.ethCallConsensus({ to: ECRECOVER_PRECOMPILE, data }, "latest");
  const expected = `0x${"00".repeat(12)}${PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.permitAuthoritySafe.manualOwner.slice(2)}`;
  if (recovered !== expected) throw new TypeError("portable signature does not recover the Safe owner");
}
function assertPortableApplicantHeadV1(input) {
  if (!Array.isArray(input.pointers)) throw new TypeError("portable Applicant pointers are invalid");
  const pointers = input.pointers.map(assertPortableApplicantPointerV1);
  if (input.index === null) {
    if (pointers.length !== 0) {
      throw new TypeError("portable initial Applicant head must be absent");
    }
    return deepFreeze10({ index: null, pointers });
  }
  const index = assertPortableApplicantIndexV1(input.index, pointers);
  if (index.approvedGitHubUserId !== input.claim.approvedGitHubUserId || index.approvedLaunchWallet !== input.claim.approvedLaunchWallet) throw new TypeError("portable Applicant head principal is invalid");
  return deepFreeze10({ index, pointers });
}
function assertPortableApplicantPointerV1(raw) {
  const pointer = exactRecord(raw, [
    "approvalBindingHash",
    "deadline",
    "failedTransactionEvidenceHash",
    "finalizedProofHash",
    "headSha",
    "pointerHash",
    "preparationArtifactHash",
    "previousPointerHash",
    "routeNonce",
    "schemaVersion",
    "signatureRequestHash",
    "signedArtifactHash",
    "signedDescriptorHash",
    "state",
    "subject",
    "submittedTransactionHash",
    "treeSha",
    "updatedAtEpochSeconds",
    "validAfter"
  ], "portable Applicant pointer");
  if (pointer.schemaVersion !== "programmable.manual-router-applicant-pointer.v1") {
    throw new TypeError("portable Applicant pointer schema is invalid");
  }
  assertHashRecord(pointer, pointer.schemaVersion, "pointerHash");
  return deepFreeze10(structuredClone(pointer));
}
function assertPortableApplicantIndexV1(raw, pointers) {
  const index = exactRecord(raw, [
    "approvedGitHubUserId",
    "approvedLaunchWallet",
    "entries",
    "indexHash",
    "previousIndexHash",
    "schemaVersion"
  ], "portable Applicant index");
  if (index.schemaVersion !== "programmable.manual-router-applicant-index.v1" || !Array.isArray(index.entries)) throw new TypeError("portable Applicant index schema is invalid");
  assertHashRecord(index, index.schemaVersion, "indexHash");
  const pointerBySubject = new Map(pointers.map((pointer) => [pointer.subject.subjectHash, pointer]));
  if (index.entries.length !== pointers.length || index.entries.some((entryValue) => {
    const entry = record(entryValue, "portable Applicant index entry");
    return pointerBySubject.get(sha2564(entry.subjectHash, "portable index subject hash"))?.pointerHash !== entry.pointerHash;
  })) throw new TypeError("portable Applicant index is not bound to current pointers");
  return deepFreeze10(structuredClone(index));
}
function createPortableSignedPointerV1(input) {
  const artifact = input.artifact;
  const core = {
    schemaVersion: "programmable.manual-router-applicant-pointer.v1",
    subject: artifact.preparationArtifact.subject,
    state: "signed-permit-available",
    approvalBindingHash: artifact.descriptor.approvalBindingHash,
    headSha: artifact.preparationArtifact.approvalClaim.headSha,
    treeSha: artifact.preparationArtifact.approvalClaim.treeSha,
    routeNonce: artifact.descriptor.routeNonce,
    preparationArtifactHash: artifact.preparationArtifact.preparationArtifactHash,
    signatureRequestHash: artifact.preparationArtifact.signatureRequest.requestHash,
    signedDescriptorHash: artifact.descriptor.descriptorHash,
    signedArtifactHash: artifact.signedArtifactHash,
    validAfter: artifact.descriptor.validAfter,
    deadline: artifact.descriptor.deadline,
    submittedTransactionHash: null,
    failedTransactionEvidenceHash: null,
    finalizedProofHash: null,
    previousPointerHash: input.previousPointerHash,
    updatedAtEpochSeconds: decimal(input.updatedAtEpochSeconds, "portable pointer update time")
  };
  return deepFreeze10({
    ...core,
    pointerHash: canonicalSha256(core.schemaVersion, core)
  });
}
function advancePortableApplicantIndexV1(input) {
  const bySubject = new Map(input.previousPointers.map((pointer) => [pointer.subject.subjectHash, pointer]));
  const current = bySubject.get(input.nextPointer.subject.subjectHash);
  if (current === void 0 && input.nextPointer.previousPointerHash !== null || current !== void 0 && input.nextPointer.previousPointerHash !== current.pointerHash) throw new TypeError("portable Applicant pointer does not extend current head");
  bySubject.set(input.nextPointer.subject.subjectHash, input.nextPointer);
  const pointers = [...bySubject.values()].sort((left, right) => left.subject.pullRequestNumber - right.subject.pullRequestNumber || compare2(left.subject.subjectHash, right.subject.subjectHash));
  const entries = pointers.map((pointer) => ({
    subjectHash: pointer.subject.subjectHash,
    pointerHash: pointer.pointerHash,
    pullRequestNumber: pointer.subject.pullRequestNumber,
    approvalBindingHash: pointer.approvalBindingHash,
    headSha: pointer.headSha,
    treeSha: pointer.treeSha,
    routeNonce: pointer.routeNonce,
    state: pointer.state,
    signedArtifactHash: pointer.signedArtifactHash,
    validAfter: pointer.validAfter,
    deadline: pointer.deadline,
    submittedTransactionHash: pointer.submittedTransactionHash,
    failedTransactionEvidenceHash: pointer.failedTransactionEvidenceHash
  }));
  const core = {
    schemaVersion: "programmable.manual-router-applicant-index.v1",
    approvedGitHubUserId: input.nextPointer.subject.approvedGitHubUserId,
    approvedLaunchWallet: input.nextPointer.subject.approvedLaunchWallet,
    entries,
    previousIndexHash: input.previousIndex?.indexHash ?? null
  };
  return deepFreeze10({ ...core, indexHash: canonicalSha256(core.schemaVersion, core) });
}
function sourceRevision(raw) {
  return Object.freeze({
    repositoryId: numericId3(raw.repositoryId, "portable source repository id"),
    repositoryUrl: String(raw.repositoryUrl),
    commitSha: gitSha4(raw.commitSha, "portable source commit"),
    treeSha: gitSha4(raw.treeSha, "portable source tree")
  });
}
function assertHashRecord(value, domain, hashField) {
  const observed = sha2564(value[hashField], `portable ${hashField}`);
  const core = Object.fromEntries(Object.entries(value).filter(([key]) => key !== hashField));
  if (observed !== canonicalSha256(domain, core)) {
    throw new TypeError(`portable ${hashField} is invalid`);
  }
}
function exactRecord(raw, keys, label) {
  const value = record(raw, label);
  const actual = Reflect.ownKeys(value);
  const strings = actual.filter((key) => typeof key === "string").sort(compare2);
  const expected = [...keys].sort(compare2);
  if (actual.length !== strings.length || strings.length !== expected.length || strings.some((key, index) => key !== expected[index])) throw new TypeError(`${label} has unexpected fields`);
  return value;
}
function record(raw, label) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} is not an object`);
  }
  return raw;
}
function sha2564(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function numericId3(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function gitSha4(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function decimal(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function applicantStatus(value) {
  if (![
    "permit-not-yet-valid",
    "ready",
    "reissue-required",
    "submitted-awaiting-finality",
    "failed-awaiting-expiry",
    "finalized"
  ].includes(value)) {
    throw new TypeError("portable current Applicant status is invalid");
  }
  return value;
}
function requiredEnvironmentValue(value, name) {
  if (value === void 0 || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${name} is required`);
  }
  return value;
}
function compare2(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function deepFreeze10(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze10(nested);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/shards-direct-profile.ts
var PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1 = deepFreeze11({
  schemaVersion: "programmable.shards-router-v1-direct-simulation-profile.v1",
  applicationId: "shards-v1",
  selectionPolicy: "exact-compile-input-hash-only",
  compileInputHash: "sha256:1d7c191dc3e16ba9967be76622b76269b6ac1673637212fab41594ff1665394a",
  genericSimulationGasLimit: "12000000",
  exactSimulationGasLimit: "16000000",
  review: {
    rawArtifactSha256: "sha256:75a1392334cd5e9435d8fa691f993b48fae86be1f2c9c39d69e99adab92b89c4",
    reviewArtifactHash: "sha256:6ee28349e1353e714b33eb6d2f9eefd75f1e98880a27d7b2f5f8094dac6d14c5",
    approvalRevisionHash: "sha256:18f4799fcf6d1232309c3ffb781eda07fd1d76bca98ddbf81fcf60686800872d"
  },
  helper: {
    repository: "https://github.com/0xprogrammable/programmable",
    publicMainCommitSha: "efc0fd0986e0e5003a8a2c6a97a9688544a1c543",
    publicMainTreeSha: "146e8ba5afa8c5c2c363bb4c29e9607330022fde",
    sourcePath: "src/ProgrammableShardsDirectInitializerV1.sol",
    sourceBlobSha: "d0e59245ea5eea3fc7d7acf371fbcbc5a9a54cc6",
    sourceSha256: "sha256:1241764fa5c70bbb18b5c5313ac384afdb5c9827fb5184fed46d36305b20dace",
    creationCodeKeccak256: "0x3fe87f0fd2f9668eb6cf17df5d53f7691820f9b1d43038183b3346044ef8709c",
    runtimeTemplateKeccak256: "0x0ca216de9d2d87728f70cbe144a0742cbb7fb78a534134acb97a69a7c47f19c9"
  },
  gasEvidence: {
    evidenceCommitSha: "50ada4fc001257e0fb6ef3a4b8d8cab8aec64bee",
    evidenceTreeSha: "5d0f72fa1d51fe08636a24fb64f01318ddff3b73",
    artifactPath: "artifacts/router-v1-direct-gas-crosscheck.json",
    artifactSha256: "sha256:51f1bd28d56e023a536ec1ebf331176c833eb0bacbda0fa8f177303709c97c32",
    anvilReproducerSha256: "sha256:f2a83a001da8c5facfed53bb20b929b5fdb1ce34cdcd728f74b23805c31fa200",
    forgeTestSha256: "sha256:faf605f0c6966b0e882e6d515c05af62964d3fc6b17a5e48236318e393cd0f84",
    pinnedForkBlock: "25723850",
    gasUsed: "14251510",
    coldEstimateGas: "14296235",
    transactionGasCap: "16777216"
  },
  bindingHash: "sha256:ffba60e856fb210e11e8b22e27a319378887f99a328b3448fe069962965e98cd"
});
function deepFreeze11(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze11(nested);
    Object.freeze(value);
  }
  return value;
}

// src/internal/router-self-service-v1/finality.ts
var RouterLaunchTransactionRevertedError = class extends TypeError {
  evidence;
  constructor(evidence) {
    super("finalized Router launch transaction reverted");
    this.name = "RouterLaunchTransactionRevertedError";
    this.evidence = evidence;
  }
};
var RouterLaunchFinalityVerifierV1 = class {
  #rpc;
  constructor(input) {
    this.#rpc = input.rpc;
    Object.freeze(this);
  }
  async finalize(input) {
    assertPreparedHash(input.prepared);
    const transactionHash = bytes325(input.transactionHash, "launch transaction hash");
    const [transactionValue, receiptValue, finalizedAnchor] = await Promise.all([
      this.#rpc.readConsensus("eth_getTransactionByHash", [transactionHash]),
      this.#rpc.readConsensus("eth_getTransactionReceipt", [transactionHash]),
      this.#rpc.collectCommonFinalizedAnchor()
    ]);
    const transaction = rpcObject2(transactionValue, "launch transaction");
    const receipt = rpcObject2(receiptValue, "launch receipt");
    const blockNumber = rpcQuantity2(receipt.blockNumber, "receipt block number");
    const blockHash = bytes325(receipt.blockHash, "receipt block hash");
    const transactionNonce = rpcQuantity2(transaction.nonce, "transaction nonce");
    if (BigInt(blockNumber) > BigInt(finalizedAnchor.blockNumber)) {
      throw new TypeError("launch transaction is not finalized by both RPC providers");
    }
    if (bytes325(transaction.hash, "observed transaction hash") !== transactionHash || bytes325(receipt.transactionHash, "receipt transaction hash") !== transactionHash || bytes325(transaction.blockHash, "transaction block hash") !== blockHash || rpcQuantity2(transaction.blockNumber, "transaction block number") !== blockNumber || address4(transaction.from, "transaction sender") !== input.prepared.launchWallet || address4(transaction.to, "transaction target") !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address || hex3(transaction.input, "transaction input") !== input.prepared.calldata || BigInt(rpcQuantity2(transaction.value, "transaction value")) !== BigInt(input.prepared.permit.value)) throw new TypeError("finalized transaction does not match the exact browser action");
    const receiptStatus = rpcQuantity2(receipt.status, "receipt status");
    if (receiptStatus !== "0x0" && receiptStatus !== "0x1" || address4(receipt.from, "receipt sender") !== input.prepared.launchWallet || address4(receipt.to, "receipt target") !== PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address || receipt.contractAddress !== null) throw new TypeError("launch receipt is reverted or bound to another transaction");
    const blockTimestamp = await this.#proveCanonicalFinalizedReceiptBlock({
      receiptBlockNumber: blockNumber,
      receiptBlockHash: blockHash,
      finalizedBlockNumber: finalizedAnchor.blockNumber
    });
    if (receiptStatus === "0x0") {
      const failedCore = {
        schemaVersion: "programmable.failed-router-launch-transaction-evidence.v1",
        transactionHash,
        transactionNonce,
        blockNumber,
        blockHash,
        blockTimestamp,
        preparationHash: input.prepared.preparationHash
      };
      throw new RouterLaunchTransactionRevertedError(deepFreeze12({
        ...failedCore,
        evidenceHash: canonicalSha256(failedCore.schemaVersion, failedCore)
      }));
    }
    const logs = rpcArray(receipt.logs, "receipt logs").map((value, index) => rpcLog(value, transactionHash, blockHash, index));
    const routerLogs = logs.filter(({ address: address5 }) => address5 === PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address);
    assertExactRouterEvents(input.prepared, routerLogs);
    const tag = finalizedAnchor.blockNumber;
    await this.#verifyLaunchStampReadbacks(input.prepared, tag);
    const componentProofs = [];
    for (const component of input.prepared.expectedComponents) {
      const proof2 = await this.#rpc.ethCallConsensus({
        to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
        data: joinHex2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.stampProof, addressWord3(component.account))
      }, tag);
      const expectedProof = joinHex2(input.prepared.expectedLaunchId, input.prepared.expectedStampHash);
      if (proof2 !== expectedProof) throw new TypeError("finalized component stampProof readback is invalid");
      const recordedRuntime = await this.#rpc.ethCallConsensus({
        to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
        data: joinHex2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.componentRuntimeCodeHash, addressWord3(component.account))
      }, tag);
      if (recordedRuntime !== component.runtimeCodeHash) {
        throw new TypeError("finalized component runtime-hash mapping is invalid");
      }
      const runtime = hex3(
        await this.#rpc.readConsensus("eth_getCode", [component.account, tag]),
        "finalized component runtime"
      );
      if (runtime === "0x" || keccak256V1(Buffer.from(runtime.slice(2), "hex")) !== component.runtimeCodeHash) {
        throw new TypeError("finalized component runtime no longer matches its stamp");
      }
      componentProofs.push({ ...component, stampProof: proof2 });
    }
    const proofCore = {
      schemaVersion: "programmable.finalized-router-stamp-proof.v2",
      transactionHash,
      transactionNonce,
      pendingNonceAtPreparation: input.prepared.browserAction.pendingNonceAtPreparation,
      blockNumber,
      blockHash,
      blockTimestamp,
      launchId: input.prepared.expectedLaunchId,
      token: input.prepared.expectedComponents.find(({ kind }) => kind === 1).account,
      hook: input.prepared.expectedComponents.find(({ kind }) => kind === 2).account,
      poolId: input.prepared.expectedPoolId,
      stampHash: input.prepared.expectedStampHash,
      permitDigest: input.prepared.permitDigest,
      componentProofs,
      eventCount: routerLogs.length,
      preparationHash: input.prepared.preparationHash
    };
    const proof = deepFreeze12({
      ...proofCore,
      proofHash: canonicalSha256("programmable.finalized-router-stamp-proof.v2", proofCore)
    });
    return proof;
  }
  async #proveCanonicalFinalizedReceiptBlock(input) {
    if (BigInt(input.receiptBlockNumber) > BigInt(input.finalizedBlockNumber)) {
      throw new TypeError("receipt block is newer than the common finalized anchor");
    }
    const block = rpcObject2(await this.#rpc.readConsensus(
      "eth_getBlockByNumber",
      [input.receiptBlockNumber, false]
    ), "canonical finalized receipt block");
    const timestamp = rpcQuantity2(block.timestamp, "canonical receipt block timestamp");
    if (bytes325(block.hash, "canonical receipt block hash") !== input.receiptBlockHash || rpcQuantity2(block.number, "canonical receipt block number") !== input.receiptBlockNumber) throw new TypeError("receipt block is not canonical at the finalized height");
    return timestamp;
  }
  async #verifyLaunchStampReadbacks(prepared, tag) {
    const token = prepared.expectedComponents.find(({ kind }) => kind === 1).account;
    const hook = prepared.expectedComponents.find(({ kind }) => kind === 2).account;
    const launchStamp = await this.#rpc.ethCallConsensus({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
      data: joinHex2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.launchStamp, prepared.expectedLaunchId)
    }, tag);
    const words = staticWords(launchStamp, 14, "launchStamp readback");
    const expected = [
      uintWord(1),
      addressWord3(prepared.launchWallet),
      addressWord3(token),
      addressWord3(hook),
      addressWord3(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.poolManager.address),
      prepared.expectedPoolId,
      poolKeyHashFromPrepared(prepared),
      componentSetHashFromPrepared(prepared),
      prepared.permit.routePayloadHash,
      addressWord3(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.address),
      PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.graphFactory.runtimeKeccak256,
      prepared.permit.expectedResultHash,
      prepared.permitDigest,
      prepared.expectedStampHash
    ];
    if (words.some((word3, index) => word3 !== expected[index])) {
      throw new TypeError("finalized launchStamp record does not match the prepared launch");
    }
    const launchIdByToken = await this.#rpc.ethCallConsensus({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
      data: joinHex2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.launchIdByToken, addressWord3(token))
    }, tag);
    const launchIdByPool = await this.#rpc.ethCallConsensus({
      to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
      data: joinHex2(
        PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.launchIdByPool,
        addressWord3(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.poolManager.address),
        prepared.expectedPoolId
      )
    }, tag);
    if (launchIdByToken !== prepared.expectedLaunchId || launchIdByPool !== prepared.expectedLaunchId) {
      throw new TypeError("finalized token/pool Router indices do not match the launch id");
    }
    for (const component of prepared.expectedComponents) {
      const launchId = await this.#rpc.ethCallConsensus({
        to: PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.router.address,
        data: joinHex2(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.selectors.launchIdByComponent, addressWord3(component.account))
      }, tag);
      if (launchId !== prepared.expectedLaunchId) {
        throw new TypeError("finalized component Router index does not match the launch id");
      }
    }
  }
};
function assertFailedRouterLaunchTransactionEvidenceV1(raw, prepared) {
  assertPreparedHash(prepared);
  const value = rpcObject2(raw, "failed Router launch transaction evidence");
  const requiredKeys = [
    "blockHash",
    "blockNumber",
    "blockTimestamp",
    "evidenceHash",
    "preparationHash",
    "schemaVersion",
    "transactionHash",
    "transactionNonce"
  ].sort();
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== requiredKeys.length || actualKeys.some((key, index) => key !== requiredKeys[index]) || value.schemaVersion !== "programmable.failed-router-launch-transaction-evidence.v1" || value.preparationHash !== prepared.preparationHash) throw new TypeError("failed Router launch transaction evidence shape is invalid");
  const core = {
    schemaVersion: "programmable.failed-router-launch-transaction-evidence.v1",
    transactionHash: bytes325(value.transactionHash, "failed transaction hash"),
    transactionNonce: rpcQuantity2(value.transactionNonce, "failed transaction nonce"),
    blockNumber: rpcQuantity2(value.blockNumber, "failed transaction block number"),
    blockHash: bytes325(value.blockHash, "failed transaction block hash"),
    blockTimestamp: rpcQuantity2(value.blockTimestamp, "failed transaction block timestamp"),
    preparationHash: prepared.preparationHash
  };
  const evidence = deepFreeze12({
    ...core,
    evidenceHash: canonicalSha256(core.schemaVersion, core)
  });
  if (value.evidenceHash !== evidence.evidenceHash) {
    throw new TypeError("failed Router launch transaction evidence hash is invalid");
  }
  return evidence;
}
function assertExactRouterEvents(prepared, logs) {
  const token = prepared.expectedComponents.find(({ kind }) => kind === 1);
  const hook = prepared.expectedComponents.find(({ kind }) => kind === 2);
  if (token === void 0 || hook === void 0 || logs.length !== 2 + prepared.expectedComponents.length) {
    throw new TypeError("Router receipt does not contain the exact required event count");
  }
  const launchTopics = [
    PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.eventTopics.launchStamped,
    prepared.expectedLaunchId,
    addressWord3(token.account),
    addressWord3(hook.account)
  ];
  const launchData = joinHex2(
    addressWord3(PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.poolManager.address),
    prepared.expectedPoolId,
    prepared.expectedStampHash
  );
  const routeTopics = [
    PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.eventTopics.routeStamped,
    prepared.expectedLaunchId,
    uintWord(1),
    prepared.permit.routePayloadHash
  ];
  const routeData = joinHex2(prepared.permit.expectedResultHash, prepared.permitDigest);
  const launchMatches = logs.filter((log) => sameWords(log.topics, launchTopics) && log.data === launchData);
  const routeMatches = logs.filter((log) => sameWords(log.topics, routeTopics) && log.data === routeData);
  if (launchMatches.length !== 1 || routeMatches.length !== 1) {
    throw new TypeError("Router launch/route stamp events are absent or ambiguous");
  }
  for (const component of prepared.expectedComponents) {
    const topics = [
      PRODUCTION_ROUTER_SELF_SERVICE_BINDING_V1.eventTopics.componentStamped,
      prepared.expectedLaunchId,
      addressWord3(component.account),
      uintWord(component.kind)
    ];
    const matches = logs.filter((log) => sameWords(log.topics, topics) && log.data === component.runtimeCodeHash);
    if (matches.length !== 1) throw new TypeError("Router component stamp event is absent or ambiguous");
  }
}
function rpcLog(value, transactionHash, blockHash, index) {
  const log = rpcObject2(value, `receipt log ${index}`);
  if (bytes325(log.transactionHash, `receipt log ${index} transaction hash`) !== transactionHash || bytes325(log.blockHash, `receipt log ${index} block hash`) !== blockHash || log.removed !== false) throw new TypeError(`receipt log ${index} is not canonical`);
  return Object.freeze({
    address: address4(log.address, `receipt log ${index} address`),
    topics: Object.freeze(rpcArray(log.topics, `receipt log ${index} topics`).map((topic) => bytes325(topic, `receipt log ${index} topic`))),
    data: hex3(log.data, `receipt log ${index} data`)
  });
}
function assertPreparedHash(prepared) {
  const { preparationHash, ...core } = prepared;
  if (preparationHash !== canonicalSha256("programmable.prepared-github-router-launch.v3", core)) {
    throw new TypeError("prepared Router launch hash is invalid");
  }
}
function poolKeyHashFromPrepared(prepared) {
  return prepared.poolKeyHash;
}
function componentSetHashFromPrepared(prepared) {
  return prepared.componentSetHash;
}
function staticWords(value, count, label) {
  const bytes = Buffer.from(value.slice(2), "hex");
  if (bytes.byteLength !== count * 32) throw new TypeError(`${label} has an invalid ABI length`);
  const words = [];
  for (let index = 0; index < count; index += 1) {
    words.push(`0x${bytes.subarray(index * 32, (index + 1) * 32).toString("hex")}`);
  }
  return Object.freeze(words);
}
function sameWords(left, right) {
  return left.length === right.length && left.every((word3, index) => word3 === right[index]);
}
function addressWord3(value) {
  return `0x${"0".repeat(24)}${value.slice(2)}`;
}
function uintWord(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("event uint word is invalid");
  return `0x${value.toString(16).padStart(64, "0")}`;
}
function joinHex2(first, ...rest) {
  return `0x${[first, ...rest].map((value) => value.slice(2)).join("")}`;
}
function rpcObject2(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is unavailable or invalid`);
  }
  return value;
}
function rpcArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} is invalid`);
  return value;
}
function address4(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.toLowerCase();
}
function bytes325(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.toLowerCase();
}
function hex3(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.toLowerCase();
}
function rpcQuantity2(value, label) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function deepFreeze12(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze12(nested);
    Object.freeze(value);
  }
  return value;
}
export {
  HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1,
  MANUAL_ROUTER_ALCHEMY_RPC_ENV_V1,
  MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1,
  PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1,
  RouterLaunchFinalityVerifierV1,
  RouterLaunchTransactionRevertedError,
  assertFailedRouterLaunchTransactionEvidenceV1,
  assertPortableManualRouterCompleteSignedArtifactV1,
  assertPortableManualRouterOperatorPreparationV1,
  assertPortableManualRouterSignedPublishRequestV1,
  createPortableManualRouterPublishAuthorityFromEnvV1,
  resolvePortableManualRouterReissueStateV1,
  verifyPortableManualRouterSignedPublishV1
};
