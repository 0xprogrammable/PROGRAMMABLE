import { createHash } from "node:crypto";

import {
  decodeFunctionResult,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  stringToHex,
} from "viem";

import { canonicalizeJson, parseStrictJson } from "../../packages/launch/src/canonical-json.mjs";
import { assertExactKeys, decodeExactUtf8, sha256Digest } from "../../packages/launch/src/io.mjs";

export const ROBINHOOD_CAPTURE_SCHEMA =
  "programmable.robinhood-custom-launch.production-capture.v3";
export const ROBINHOOD_CAPTURE_AUTHORIZATION_SCHEMA =
  "programmable.robinhood-custom-launch.capture-authorization.v2";
export const ROBINHOOD_CAPTURE_CLOSURE_SCHEMA =
  "programmable.robinhood-custom-launch.capture-closure.v3";
export const ROBINHOOD_CAPTURE_PROFILE_DIGEST =
  "sha256:a3149f6a013eae1ca0fd932e0da0ddb8b8796d880ef53800830bfaaf49fe56c4";
export const ROBINHOOD_PRODUCTION_REPOSITORY = "programmablehq/PROGRAMMABLE";
export const ROBINHOOD_PRODUCTION_REPOSITORY_ID = "1314365508";
export const ROBINHOOD_PRODUCTION_REF = "refs/heads/production";
export const ROBINHOOD_CAPTURE_WORKFLOW =
  ".github/workflows/capture-robinhood-custom-launch-postdeployment.yml";
export const ROBINHOOD_CAPTURE_PATH =
  "release/robinhood-chain-4663/programmable-postdeployment-capture.json";
export const ROBINHOOD_CAPTURE_ATTESTATION_BUNDLE_PATH =
  "release/robinhood-chain-4663/programmable-postdeployment-capture.attestation.json";
export const ROBINHOOD_STAGE_ATTESTATION_BUNDLE_PATH =
  "release/robinhood-chain-4663/programmable-stage-bundle.attestation.json";
export const ROBINHOOD_SOURCE_VERIFY_PROOF_PATH =
  "release/robinhood-chain-4663/production-verify-proof.json";
export const ROBINHOOD_SOURCE_VERIFY_ATTESTATION_BUNDLE_PATH =
  "release/robinhood-chain-4663/production-verify-proof.attestation.json";

export const ROBINHOOD_NODE_INTERFACE =
  "0x00000000000000000000000000000000000000C8";
export const ROBINHOOD_FIND_BATCH_SELECTOR = "0x81f1adaf";
export const ROBINHOOD_L1_CONFIRMATIONS_SELECTOR = "0xe5ca238c";
export const ROBINHOOD_ROLLUP = "0x23A19d23e89166adedbDcB432518AB01e4272D94";
export const ROBINHOOD_SEQUENCER_INBOX =
  "0xBd0D173EEb87D57A09521c24388a12789F33ba96";
export const SEQUENCER_BATCH_DELIVERED_TOPIC =
  "0x7394f4a19a13c7b92b5bb71033245305946ef78452f7b4986ac1390b5df4ebd7";

const CHAIN_ID = 4663n;
const ETHEREUM_CHAIN_ID = 1n;
const SAFE_ADDRESS = "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06";
const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const SAFE_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SAFE_FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
export const ROBINHOOD_CREATE2_DEPLOYER =
  "0x4e59b44847b379578588920ca78fbf26c0b4956c";
export const ROBINHOOD_CREATE2_DEPLOYER_RUNTIME_CODE_HASH =
  "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989";
const ROBINHOOD_CREATE2_DEPLOYER_RUNTIME_CODE_BYTES = 69;
const ROBINHOOD_POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const ROBINHOOD_POOL_MANAGER_DEPLOYMENT_TRANSACTION =
  "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41";
const ROBINHOOD_POOL_MANAGER_DEPLOYMENT_BLOCK_HASH =
  "0x9165e92381503c5e0cd1afc3e3647089d93a301c3e010722dbaf6e605d4ce38c";
const OWNERSHIP_TRANSFERRED_TOPIC =
  "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0";
const ZERO_TOPIC = `0x${"0".repeat(64)}`;
const ROBINHOOD_POOL_MANAGER_OWNER_TOPIC =
  "0x0000000000000000000000009701fb0ade1e269c8f64ec0c7b3cfadb31a13a52";
const SAFE_OWNERS = Object.freeze([
  "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
]);
const MAX_RPC_BYTES = 8 * 1024 * 1024;
const MAX_SOURCIFY_BYTES = 32 * 1024 * 1024;
const MAX_FRESH_CAPTURE_BYTES = 96 * 1024 * 1024;
const MAX_PUBLIC_CAPTURE_BYTES = 128 * 1024 * 1024;
const SOURCIFY_NORMALIZED_RESPONSE_DOMAIN =
  "programmable.robinhood-custom-launch.sourcify-normalized-response.v1";
const SOURCIFY_RESPONSE_CLOSURE_DOMAIN =
  "programmable.robinhood-custom-launch.sourcify-response-closure.v4";
const CAPTURE_INVENTORY_DOMAIN =
  "programmable.robinhood-custom-launch.capture-inventory.v4";
export const ROBINHOOD_SOURCIFY_RESPONSE_BYTES = MAX_SOURCIFY_BYTES;
export const ROBINHOOD_CAPTURE_AGGREGATE_RESPONSE_BYTES = MAX_FRESH_CAPTURE_BYTES;
const CAPTURE_MAX_AGE_MS = 20 * 60 * 1000;
const CAPTURE_MAX_FUTURE_SKEW_MS = 60 * 1000;
const HEX32 = /^0x[0-9a-f]{64}$/u;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const PROVIDER_PINS = Object.freeze({
  robinhood: Object.freeze([
    Object.freeze({
      role: "primary",
      providerId: "drpc",
      trustDomain: "drpc.org",
      hostnameSuffixes: Object.freeze(["drpc.org", "drpc.live"]),
    }),
    Object.freeze({
      role: "secondary",
      providerId: "alchemy",
      trustDomain: "alchemy.com",
      hostnameSuffixes: Object.freeze(["alchemy.com"]),
    }),
  ]),
  ethereum: Object.freeze([
    Object.freeze({
      role: "primary",
      providerId: "drpc",
      trustDomain: "drpc.org",
      hostnameSuffixes: Object.freeze(["drpc.org", "drpc.live"]),
    }),
    Object.freeze({
      role: "secondary",
      providerId: "quicknode",
      trustDomain: "quicknode.com",
      hostnameSuffixes: Object.freeze(["quiknode.pro"]),
    }),
  ]),
});

const L2_ENTRY_ORDER = Object.freeze([
  "chainId",
  "rawTransaction",
  "transaction",
  "receipt",
  "deploymentBlock",
  "predecessorBlock",
  "genesisBlock",
  "multicall3Code",
  "prePermitAuthorityCode",
  "preGraphFactoryCode",
  "preRouterCode",
  "permitAuthorityCode",
  "graphFactoryCode",
  "routerCode",
  "safeSingletonCode",
  "safeFallbackHandlerCode",
  "permit2GenesisCode",
  "poolManagerRawTransaction",
  "poolManagerTransaction",
  "poolManagerReceipt",
  "poolManagerBlock",
  "poolManagerPredecessorBlock",
  "poolManagerCreate2DeployerCode",
  "prePoolManagerCode",
  "poolManagerCode",
  "positionManagerRawTransaction",
  "positionManagerTransaction",
  "positionManagerReceipt",
  "positionManagerBlock",
  "positionManagerPredecessorBlock",
  "positionManagerCreate2DeployerCode",
  "prePositionManagerCode",
  "positionManagerCode",
  "stateViewRawTransaction",
  "stateViewTransaction",
  "stateViewReceipt",
  "stateViewBlock",
  "stateViewPredecessorBlock",
  "stateViewCreate2DeployerCode",
  "preStateViewCode",
  "stateViewCode",
  "v4QuoterRawTransaction",
  "v4QuoterTransaction",
  "v4QuoterReceipt",
  "v4QuoterBlock",
  "v4QuoterPredecessorBlock",
  "v4QuoterCreate2DeployerCode",
  "preV4QuoterCode",
  "v4QuoterCode",
  "universalRouterRawTransaction",
  "universalRouterTransaction",
  "universalRouterReceipt",
  "universalRouterBlock",
  "universalRouterPredecessorBlock",
  "universalRouterCreate2DeployerCode",
  "preUniversalRouterCode",
  "universalRouterCode",
  "routerPermitAuthority",
  "routerPermitAuthorityCodeHash",
  "routerGraphFactory",
  "routerGraphFactoryCodeHash",
  "routerPoolManager",
  "routerPoolManagerCodeHash",
  "routerChainId",
  "safeOwners",
  "safeThreshold",
  "safeNonce",
  "safeModules",
  "safeVersion",
  "safeSingletonSlot",
  "safeFallbackHandlerSlot",
  "safeGuardSlot",
  "findBatchContainingBlock",
  "getL1Confirmations",
]);
const L1_ENTRY_ORDER = Object.freeze([
  "chainId",
  "postingLogs",
  "postingReceipt",
  "postingBlock",
  "finalizedTag",
  "finalizedReread",
]);

const SEQUENCER_EVENT_ABI = Object.freeze([{
  type: "event",
  name: "SequencerBatchDelivered",
  inputs: Object.freeze([
    Object.freeze({ indexed: true, name: "batchSequenceNumber", type: "uint256" }),
    Object.freeze({ indexed: true, name: "beforeAcc", type: "bytes32" }),
    Object.freeze({ indexed: true, name: "afterAcc", type: "bytes32" }),
    Object.freeze({ indexed: false, name: "delayedAcc", type: "bytes32" }),
    Object.freeze({ indexed: false, name: "afterDelayedMessagesRead", type: "uint256" }),
    Object.freeze({
      indexed: false,
      name: "timeBounds",
      type: "tuple",
      components: Object.freeze([
        Object.freeze({ name: "delayBlocks", type: "uint64" }),
        Object.freeze({ name: "futureBlocks", type: "uint64" }),
        Object.freeze({ name: "delaySeconds", type: "uint64" }),
        Object.freeze({ name: "futureSeconds", type: "uint64" }),
      ]),
    }),
    Object.freeze({ indexed: false, name: "dataLocation", type: "uint8" }),
  ]),
}]);
const SAFE_SETUP_EVENT_ABI = Object.freeze([{
  type: "event",
  name: "SafeSetup",
  inputs: Object.freeze([
    Object.freeze({ indexed: true, name: "initiator", type: "address" }),
    Object.freeze({ indexed: false, name: "owners", type: "address[]" }),
    Object.freeze({ indexed: false, name: "threshold", type: "uint256" }),
    Object.freeze({ indexed: false, name: "initializer", type: "address" }),
    Object.freeze({ indexed: false, name: "fallbackHandler", type: "address" }),
  ]),
}]);
const SAFE_PROXY_CREATION_EVENT_ABI = Object.freeze([{
  type: "event",
  name: "ProxyCreation",
  inputs: Object.freeze([
    Object.freeze({ indexed: true, name: "proxy", type: "address" }),
    Object.freeze({ indexed: false, name: "singleton", type: "address" }),
  ]),
}]);

const ROUTER_READ_ABI = Object.freeze([
  Object.freeze({ type: "function", name: "PERMIT_AUTHORITY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }),
  Object.freeze({ type: "function", name: "PERMIT_AUTHORITY_RUNTIME_CODE_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }),
  Object.freeze({ type: "function", name: "GRAPH_FACTORY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }),
  Object.freeze({ type: "function", name: "GRAPH_FACTORY_RUNTIME_CODE_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }),
  Object.freeze({ type: "function", name: "POOL_MANAGER", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }),
  Object.freeze({ type: "function", name: "POOL_MANAGER_RUNTIME_CODE_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }),
  Object.freeze({ type: "function", name: "CHAIN_ID", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }),
]);
const SAFE_READ_ABI = Object.freeze([
  Object.freeze({ type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] }),
  Object.freeze({ type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }),
  Object.freeze({ type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }),
  Object.freeze({
    type: "function",
    name: "getModulesPaginated",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "address[]" }, { type: "address" }],
  }),
]);
const SAFE_VERSION_ABI = Object.freeze([Object.freeze({
  type: "function",
  name: "VERSION",
  stateMutability: "view",
  inputs: Object.freeze([]),
  outputs: Object.freeze([{ type: "string" }]),
})]);
const SAFE_MODULES_END_SENTINEL = "0x0000000000000000000000000000000000000001";
const SAFE_SINGLETON_STORAGE_SLOT = `0x${"0".repeat(64)}`;
const SAFE_FALLBACK_HANDLER_STORAGE_SLOT = keccak256(
  stringToHex("fallback_manager.handler.address"),
);
const SAFE_GUARD_STORAGE_SLOT = keccak256(stringToHex("guard_manager.guard.address"));
const EMPTY_RUNTIME_CODE_HASH = keccak256("0x");

function framedSha256(domain, value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function sha256(bytes) {
  return sha256Digest(bytes);
}

function exactHex32(value, label) {
  if (typeof value !== "string" || !HEX32.test(value)) {
    throw new TypeError(`${label} must be a lowercase bytes32`);
  }
  return value;
}

function quantity(value, label) {
  if (typeof value !== "string" || !QUANTITY.test(value)) {
    throw new TypeError(`${label} must be a canonical JSON-RPC quantity`);
  }
  return BigInt(value);
}

function decimal(value, label, positive = false) {
  const pattern = positive ? /^[1-9][0-9]*$/u : /^(?:0|[1-9][0-9]*)$/u;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} must be a canonical decimal string`);
  }
  return BigInt(value);
}

function address(value, label, expected = null) {
  let normalized;
  try {
    normalized = getAddress(value);
  } catch {
    throw new TypeError(`${label} must be an EIP-55 address`);
  }
  if (value !== normalized) throw new TypeError(`${label} must be an EIP-55 address`);
  if (expected !== null && normalized !== expected) {
    throw new TypeError(`${label} differs from its pinned address`);
  }
  return normalized;
}

function rpcAddress(value, label) {
  try {
    return getAddress(value);
  } catch {
    throw new TypeError(`${label} is not an RPC address`);
  }
}

function iso(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical ISO-8601 instant`);
  }
  return value;
}

export function canonicalRobinhoodFreshObservedAt(now = () => new Date()) {
  const instant = now();
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new TypeError("fresh verification clock is invalid");
  }
  return new Date(Math.floor(instant.getTime() / 1_000) * 1_000).toISOString();
}

function plainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactBase64(value, label, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || typeof value !== "string" || value.length === 0
    || value.length > 4 * Math.ceil(maximumBytes / 3)
    || !BASE64.test(value)) {
    throw new TypeError(`${label} must be canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes
    || bytes.toString("base64") !== value) {
    throw new TypeError(`${label} is empty, oversized, or non-canonical`);
  }
  return bytes;
}

function parseJsonBytes(bytes, label) {
  const text = decodeExactUtf8(bytes, label);
  return parseStrictJson(text, { maximumBytes: bytes.byteLength });
}

export function createRobinhoodResponseBudget(
  limit = ROBINHOOD_CAPTURE_AGGREGATE_RESPONSE_BYTES,
) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("capture response budget must be a positive safe integer");
  }
  return { limit, consumed: 0, chunkLimit: 131_072, chunksConsumed: 0 };
}

export async function readRobinhoodBoundedResponse(response, {
  label,
  maximumBytes,
  budget,
}) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || budget === null || typeof budget !== "object"
    || !Number.isSafeInteger(budget.limit) || !Number.isSafeInteger(budget.consumed)
    || !Number.isSafeInteger(budget.chunkLimit)
    || !Number.isSafeInteger(budget.chunksConsumed)
    || budget.limit < 1 || budget.consumed < 0 || budget.consumed > budget.limit
    || budget.chunkLimit < 1 || budget.chunksConsumed < 0
    || budget.chunksConsumed > budget.chunkLimit
    || response?.body === null
    || typeof response?.body?.getReader !== "function") {
    throw new TypeError(`${label} response budget is invalid`);
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)
      || BigInt(contentLength) < 1n
      || BigInt(contentLength) > BigInt(maximumBytes)
      || BigInt(contentLength) > BigInt(budget.limit - budget.consumed)) {
      await response.body.cancel("capture response Content-Length exceeds budget");
      throw new TypeError(`${label} response Content-Length exceeds its capture budget`);
    }
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let chunkCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount += 1;
      budget.chunksConsumed += 1;
      if (!(value instanceof Uint8Array) || value.byteLength < 1
        || total + value.byteLength > maximumBytes
        || budget.consumed + value.byteLength > budget.limit
        || chunkCount > 16_384
        || budget.chunksConsumed > budget.chunkLimit) {
        await reader.cancel("capture response budget exceeded");
        throw new TypeError(`${label} response exceeds its capture budget`);
      }
      total += value.byteLength;
      budget.consumed += value.byteLength;
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 1) throw new TypeError(`${label} response is empty`);
  return Buffer.concat(chunks, total);
}

export function robinhoodRpcResponseLimit(method) {
  const limits = Object.freeze({
    eth_chainId: 8 * 1024,
    eth_getRawTransactionByHash: 512 * 1024,
    eth_getTransactionByHash: 1024 * 1024,
    eth_getTransactionReceipt: 8 * 1024 * 1024,
    eth_getBlockByNumber: 1024 * 1024,
    eth_getBlockByHash: 1024 * 1024,
    eth_getCode: 2 * 1024 * 1024,
    eth_call: 2 * 1024 * 1024,
    eth_getStorageAt: 64 * 1024,
    eth_getLogs: 8 * 1024 * 1024,
  });
  const limit = limits[method];
  if (limit === undefined) throw new TypeError(`unsupported Robinhood capture RPC method ${method}`);
  return limit;
}

function projectRpcTransaction(value, label) {
  plainObject(value, label);
  return {
    hash: exactHex32(value.hash, `${label}.hash`),
    from: rpcAddress(value.from, `${label}.from`),
    to: rpcAddress(value.to, `${label}.to`),
    input: exactRpcBytes(value.input, `${label}.input`),
    value: exactRpcQuantity(value.value, `${label}.value`),
    nonce: exactRpcQuantity(value.nonce, `${label}.nonce`),
    transactionIndex: exactRpcQuantity(value.transactionIndex, `${label}.transactionIndex`),
    blockNumber: exactRpcQuantity(value.blockNumber, `${label}.blockNumber`),
    blockHash: exactHex32(value.blockHash, `${label}.blockHash`),
    chainId: exactRpcQuantity(value.chainId, `${label}.chainId`),
  };
}

function exactRpcBytes(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value)) {
    throw new TypeError(`${label} must be lowercase RPC bytes`);
  }
  return value;
}

function exactRpcQuantity(value, label) {
  quantity(value, label);
  return value;
}

function projectRpcLog(value, label) {
  plainObject(value, label);
  if (!Array.isArray(value.topics)) throw new TypeError(`${label}.topics must be an array`);
  if (value.removed !== false) throw new TypeError(`${label}.removed must be false`);
  return {
    address: rpcAddress(value.address, `${label}.address`),
    topics: value.topics.map((topic, index) => exactHex32(topic, `${label}.topics[${index}]`)),
    data: exactRpcBytes(value.data, `${label}.data`),
    transactionHash: exactHex32(value.transactionHash, `${label}.transactionHash`),
    transactionIndex: exactRpcQuantity(value.transactionIndex, `${label}.transactionIndex`),
    blockNumber: exactRpcQuantity(value.blockNumber, `${label}.blockNumber`),
    blockHash: exactHex32(value.blockHash, `${label}.blockHash`),
    logIndex: exactRpcQuantity(value.logIndex, `${label}.logIndex`),
    removed: false,
  };
}

function projectFoundationReceiptLogs(logs, label) {
  const setupLogs = logs.filter((log) => log.address === SAFE_ADDRESS);
  const factoryLogs = logs.filter((log) => log.address === SAFE_PROXY_FACTORY);
  if (logs.length !== 2 || setupLogs.length !== 1 || factoryLogs.length !== 1
    || quantity(setupLogs[0].logIndex, `${label}.SafeSetup.logIndex`)
      >= quantity(factoryLogs[0].logIndex, `${label}.ProxyCreation.logIndex`)) {
    throw new TypeError(`${label} must contain only one ordered SafeSetup + ProxyCreation path`);
  }
  let setup;
  let creation;
  try {
    setup = decodeEventLog({
      abi: SAFE_SETUP_EVENT_ABI,
      eventName: "SafeSetup",
      topics: setupLogs[0].topics,
      data: setupLogs[0].data,
      strict: true,
    });
    creation = decodeEventLog({
      abi: SAFE_PROXY_CREATION_EVENT_ABI,
      eventName: "ProxyCreation",
      topics: factoryLogs[0].topics,
      data: factoryLogs[0].data,
      strict: true,
    });
  } catch {
    throw new TypeError(`${label} Safe creation events are not strictly decodable`);
  }
  const owners = setup.args.owners.map((owner) => getAddress(owner));
  if (getAddress(setup.args.initiator) !== SAFE_PROXY_FACTORY
    || canonicalizeJson(owners) !== canonicalizeJson(SAFE_OWNERS)
    || setup.args.threshold !== 1n
    || getAddress(setup.args.initializer) !== "0x0000000000000000000000000000000000000000"
    || getAddress(setup.args.fallbackHandler) !== SAFE_FALLBACK_HANDLER
    || getAddress(creation.args.proxy) !== SAFE_ADDRESS
    || getAddress(creation.args.singleton) !== SAFE_SINGLETON) {
    throw new TypeError(`${label} Safe creation events differ from exact pins`);
  }
}

function projectRpcReceipt(value, label, key) {
  plainObject(value, label);
  if (!Array.isArray(value.logs)) throw new TypeError(`${label}.logs must be an array`);
  const contractAddress = value.contractAddress === null
    ? null : rpcAddress(value.contractAddress, `${label}.contractAddress`);
  const logs = value.logs.map((log, index) => projectRpcLog(log, `${label}.logs[${index}]`));
  if (key === "receipt") {
    projectFoundationReceiptLogs(logs, `${label}.logs`);
  } else if (/^(?:poolManager|positionManager|stateView|v4Quoter|universalRouter)Receipt$/u
    .test(key)) {
    if (key === "poolManagerReceipt") {
      const [log] = logs;
      if (logs.length !== 1 || log.address !== ROBINHOOD_POOL_MANAGER
        || canonicalizeJson(log.topics) !== canonicalizeJson([
          OWNERSHIP_TRANSFERRED_TOPIC, ZERO_TOPIC, ROBINHOOD_POOL_MANAGER_OWNER_TOPIC,
        ])
        || log.data !== "0x"
        || log.transactionHash !== ROBINHOOD_POOL_MANAGER_DEPLOYMENT_TRANSACTION
        || log.transactionIndex !== "0x1"
        || log.blockNumber !== "0x236e"
        || log.blockHash !== ROBINHOOD_POOL_MANAGER_DEPLOYMENT_BLOCK_HASH
        || log.logIndex !== "0x0") {
        throw new TypeError(`${label} PoolManager OwnershipTransferred log differs from the pin`);
      }
    } else if (logs.length !== 0) {
      throw new TypeError(`${label} external deployment receipt has unexpected logs`);
    }
  } else if (key === "postingReceipt") {
    if (logs.length !== 1 || logs[0].address !== ROBINHOOD_SEQUENCER_INBOX
      || logs[0].topics.length !== 4
      || logs[0].topics[0] !== SEQUENCER_BATCH_DELIVERED_TOPIC) {
      throw new TypeError(`${label} must contain only the pinned SequencerBatchDelivered log`);
    }
  } else {
    throw new TypeError(`${label} has an unsupported receipt evidence key`);
  }
  return {
    transactionHash: exactHex32(value.transactionHash, `${label}.transactionHash`),
    from: rpcAddress(value.from, `${label}.from`),
    to: rpcAddress(value.to, `${label}.to`),
    contractAddress,
    status: exactRpcQuantity(value.status, `${label}.status`),
    transactionIndex: exactRpcQuantity(value.transactionIndex, `${label}.transactionIndex`),
    blockNumber: exactRpcQuantity(value.blockNumber, `${label}.blockNumber`),
    blockHash: exactHex32(value.blockHash, `${label}.blockHash`),
    logs,
  };
}

function projectRpcBlock(value, label, key) {
  plainObject(value, label);
  const parentHash = exactHex32(value.parentHash, `${label}.parentHash`);
  return {
    number: exactRpcQuantity(value.number, `${label}.number`),
    hash: exactHex32(value.hash, `${label}.hash`),
    parentHash: /^(?:postingBlock|finalizedTag|finalizedReread)$/u.test(key)
      ? `0x${"0".repeat(64)}` : parentHash,
  };
}

export function projectRobinhoodRpcResult(method, value, label = "RPC result", key) {
  switch (method) {
    case "eth_chainId":
      return exactRpcQuantity(value, label);
    case "eth_getRawTransactionByHash":
    case "eth_getCode":
    case "eth_getStorageAt":
      return exactRpcBytes(value, label);
    case "eth_call": {
      const bytes = exactRpcBytes(value, label);
      if (key !== "getL1Confirmations") return bytes;
      if (!/^0x[0-9a-f]{64}$/u.test(bytes) || BigInt(bytes) === 0n) {
        throw new TypeError(`${label} must prove at least one L1 confirmation`);
      }
      return `0x${"0".repeat(63)}1`;
    }
    case "eth_getTransactionByHash":
      return projectRpcTransaction(value, label);
    case "eth_getTransactionReceipt":
      return projectRpcReceipt(value, label, key);
    case "eth_getBlockByNumber":
    case "eth_getBlockByHash":
      return projectRpcBlock(value, label, key);
    case "eth_getLogs":
      if (!Array.isArray(value)) throw new TypeError(`${label} must be an RPC log array`);
      return value.map((log, index) => projectRpcLog(log, `${label}[${index}]`));
    default:
      robinhoodRpcResponseLimit(method);
      throw new TypeError(`unsupported Robinhood capture RPC method ${method}`);
  }
}

export function buildRobinhoodPublicRpcEntry({
  key,
  method,
  params,
  requestId,
  responseBytes,
}) {
  if (typeof key !== "string" || key.length === 0 || !Array.isArray(params)
    || !Number.isSafeInteger(requestId) || requestId < 1
    || !Buffer.isBuffer(responseBytes) || responseBytes.byteLength < 1
    || responseBytes.byteLength > robinhoodRpcResponseLimit(method)) {
    throw new TypeError("public RPC entry input is invalid or oversized");
  }
  const response = plainObject(parseJsonBytes(responseBytes, `${key} response`), `${key} response`);
  assertExactKeys(response, ["jsonrpc", "id", "result"], `${key} response`);
  if (response.jsonrpc !== "2.0" || response.id !== requestId) {
    throw new TypeError(`${key} response is not the exact successful JSON-RPC envelope`);
  }
  const result = projectRobinhoodRpcResult(method, response.result, `${key} result`, key);
  const requestBytes = Buffer.from(JSON.stringify({
    jsonrpc: "2.0", id: requestId, method, params,
  }), "utf8");
  return Object.freeze({
    key,
    method,
    params: structuredClone(params),
    requestId,
    requestSha256: sha256(requestBytes),
    normalizedResultSha256: framedSha256(
      "programmable.robinhood-custom-launch.rpc-public-result.v1",
      result,
    ),
    result,
  });
}

function normalizeRpcEntry(entry, label) {
  assertExactKeys(entry, [
    "key", "method", "params", "requestId", "requestSha256", "normalizedResultSha256",
    "result",
  ], label);
  if (typeof entry.key !== "string" || entry.key.length === 0
    || typeof entry.method !== "string" || !/^eth_[A-Za-z0-9]+$/u.test(entry.method)
    || !Array.isArray(entry.params) || !Number.isSafeInteger(entry.requestId)
    || entry.requestId < 1) {
    throw new TypeError(`${label} identity is invalid`);
  }
  const requestBytes = Buffer.from(JSON.stringify({
    jsonrpc: "2.0", id: entry.requestId, method: entry.method, params: entry.params,
  }), "utf8");
  if (sha256(requestBytes) !== entry.requestSha256) {
    throw new TypeError(`${label} request digest binding is invalid`);
  }
  const result = projectRobinhoodRpcResult(entry.method, entry.result, `${label}.result`, entry.key);
  if (canonicalizeJson(result) !== canonicalizeJson(entry.result)) {
    throw new TypeError(`${label}.result contains non-allowlisted provider fields`);
  }
  const normalizedResultSha256 = framedSha256(
    "programmable.robinhood-custom-launch.rpc-public-result.v1",
    result,
  );
  if (entry.normalizedResultSha256 !== normalizedResultSha256) {
    throw new TypeError(`${label} normalized result digest differs`);
  }
  return Object.freeze({
    key: entry.key,
    method: entry.method,
    params: structuredClone(entry.params),
    requestId: entry.requestId,
    requestSha256: entry.requestSha256,
    normalizedResultSha256,
    result,
  });
}

function normalizeEntries(entries, expectedOrder, label) {
  if (!Array.isArray(entries) || entries.length !== expectedOrder.length) {
    throw new TypeError(`${label} must retain every ordered public RPC evidence entry`);
  }
  const normalized = entries.map((entry, index) => {
    const result = normalizeRpcEntry(entry, `${label}[${index}]`);
    if (result.key !== expectedOrder[index] || result.requestId !== index + 1) {
      throw new TypeError(`${label} is missing or reorders ${expectedOrder[index]}`);
    }
    return result;
  });
  return Object.freeze(normalized);
}

function rpcByKey(entries, key) {
  const value = entries.find((entry) => entry.key === key);
  if (value === undefined) throw new TypeError(`capture is missing ${key}`);
  return value;
}

function verifyProviderIdentity(value, layer, index, label) {
  assertExactKeys(value, [
    "role", "providerId", "trustDomain", "authentication", "observedAt",
  ], label);
  const pin = PROVIDER_PINS[layer][index];
  if (value.role !== pin.role || value.providerId !== pin.providerId
    || value.trustDomain !== pin.trustDomain || value.authentication !== "provider-credential") {
    throw new TypeError(`${label} does not match the code-owned provider identity pin`);
  }
  return Object.freeze({
    role: pin.role,
    providerId: pin.providerId,
    trustDomain: pin.trustDomain,
    authentication: "provider-credential",
    observedAt: iso(value.observedAt, `${label}.observedAt`),
  });
}

function rpcTransaction(value, label) {
  plainObject(value, label);
  for (const key of ["hash", "from", "to", "input", "value", "nonce", "transactionIndex",
    "blockNumber", "blockHash", "chainId"]) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing ${key}`);
  }
  if (typeof value.input !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value.input)) {
    throw new TypeError(`${label}.input is invalid`);
  }
  return Object.freeze({
    hash: exactHex32(value.hash, `${label}.hash`),
    from: rpcAddress(value.from, `${label}.from`),
    to: rpcAddress(value.to, `${label}.to`),
    input: value.input,
    value: quantity(value.value, `${label}.value`),
    nonce: quantity(value.nonce, `${label}.nonce`),
    transactionIndex: quantity(value.transactionIndex, `${label}.transactionIndex`),
    blockNumber: quantity(value.blockNumber, `${label}.blockNumber`),
    blockHash: exactHex32(value.blockHash, `${label}.blockHash`),
    chainId: quantity(value.chainId, `${label}.chainId`),
  });
}

function rpcLog(value, label) {
  plainObject(value, label);
  if (!Array.isArray(value.topics) || typeof value.data !== "string"
    || !/^0x(?:[0-9a-f]{2})*$/u.test(value.data)) {
    throw new TypeError(`${label} log bytes are invalid`);
  }
  return Object.freeze({
    address: rpcAddress(value.address, `${label}.address`),
    topics: Object.freeze(value.topics.map((topic, index) =>
      exactHex32(topic, `${label}.topics[${index}]`))),
    data: value.data,
    transactionHash: exactHex32(value.transactionHash, `${label}.transactionHash`),
    transactionIndex: quantity(value.transactionIndex, `${label}.transactionIndex`),
    blockNumber: quantity(value.blockNumber, `${label}.blockNumber`),
    blockHash: exactHex32(value.blockHash, `${label}.blockHash`),
    logIndex: quantity(value.logIndex, `${label}.logIndex`),
    removed: value.removed === false ? false : (() => {
      throw new TypeError(`${label}.removed must be false`);
    })(),
  });
}

function rpcReceipt(value, label) {
  plainObject(value, label);
  for (const key of ["transactionHash", "from", "to", "contractAddress", "status",
    "transactionIndex", "blockNumber", "blockHash", "logs"]) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing ${key}`);
  }
  if (quantity(value.status, `${label}.status`) !== 1n || !Array.isArray(value.logs)) {
    throw new TypeError(`${label} is not a successful receipt`);
  }
  const receipt = {
    transactionHash: exactHex32(value.transactionHash, `${label}.transactionHash`),
    from: rpcAddress(value.from, `${label}.from`),
    to: rpcAddress(value.to, `${label}.to`),
    contractAddress: value.contractAddress === null
      ? null : rpcAddress(value.contractAddress, `${label}.contractAddress`),
    status: 1n,
    transactionIndex: quantity(value.transactionIndex, `${label}.transactionIndex`),
    blockNumber: quantity(value.blockNumber, `${label}.blockNumber`),
    blockHash: exactHex32(value.blockHash, `${label}.blockHash`),
    logs: Object.freeze(value.logs.map((log, index) => rpcLog(log, `${label}.logs[${index}]`))),
  };
  if (receipt.logs.some((log) => log.transactionHash !== receipt.transactionHash
    || log.transactionIndex !== receipt.transactionIndex
    || log.blockNumber !== receipt.blockNumber
    || log.blockHash !== receipt.blockHash)) {
    throw new TypeError(`${label} contains a log outside the exact receipt inclusion`);
  }
  return Object.freeze(receipt);
}

function verifySafeCreationPath(receipt, normalizedReceipt, label) {
  const setupLogs = receipt.logs.filter((log) => log.address === SAFE_ADDRESS);
  const factoryLogs = receipt.logs.filter((log) => log.address === SAFE_PROXY_FACTORY);
  if (setupLogs.length !== 1 || factoryLogs.length !== 1
    || setupLogs[0].logIndex >= factoryLogs[0].logIndex) {
    throw new TypeError(`${label} must contain one ordered SafeSetup + ProxyCreation path`);
  }
  let setup;
  let creation;
  try {
    setup = decodeEventLog({
      abi: SAFE_SETUP_EVENT_ABI,
      eventName: "SafeSetup",
      topics: setupLogs[0].topics,
      data: setupLogs[0].data,
      strict: true,
    });
    creation = decodeEventLog({
      abi: SAFE_PROXY_CREATION_EVENT_ABI,
      eventName: "ProxyCreation",
      topics: factoryLogs[0].topics,
      data: factoryLogs[0].data,
      strict: true,
    });
  } catch {
    throw new TypeError(`${label} Safe creation events are not strictly decodable`);
  }
  const owners = setup.args.owners.map((owner) => getAddress(owner));
  if (getAddress(setup.args.initiator) !== SAFE_PROXY_FACTORY
    || canonicalizeJson(owners) !== canonicalizeJson(SAFE_OWNERS)
    || setup.args.threshold !== 1n
    || getAddress(setup.args.initializer) !== "0x0000000000000000000000000000000000000000"
    || getAddress(setup.args.fallbackHandler) !== SAFE_FALLBACK_HANDLER
    || getAddress(creation.args.proxy) !== SAFE_ADDRESS
    || getAddress(creation.args.singleton) !== SAFE_SINGLETON) {
    throw new TypeError(`${label} Safe creation events differ from factory/singleton/owners/threshold/fallback pins`);
  }
  const summarized = receipt.logs.map((log) => ({
    address: log.address,
    topics: [...log.topics],
    data: log.data,
    logIndex: log.logIndex.toString(10),
  }));
  if (canonicalizeJson(summarized) !== canonicalizeJson(normalizedReceipt.logs)) {
    throw new TypeError(`${label} raw receipt logs differ from normalized receipt evidence`);
  }
}

function rpcBlock(value, label) {
  plainObject(value, label);
  if (!Object.hasOwn(value, "number") || !Object.hasOwn(value, "hash")
    || !Object.hasOwn(value, "parentHash")) {
    throw new TypeError(`${label} is missing block identity`);
  }
  return Object.freeze({
    number: quantity(value.number, `${label}.number`),
    hash: exactHex32(value.hash, `${label}.hash`),
    parentHash: exactHex32(value.parentHash, `${label}.parentHash`),
  });
}

function abiWord(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is not one ABI word`);
  }
  return BigInt(value);
}

function requireEthCall(entry, expectedTo, expectedData, blockTag, label) {
  const call = entry.params.length === 2
    ? plainObject(entry.params[0], `${label}.params[0]`) : null;
  if (call !== null) assertExactKeys(call, ["to", "data"], `${label}.params[0]`);
  if (entry.method !== "eth_call" || entry.params.length !== 2
    || call.to !== expectedTo
    || call.data !== expectedData
    || canonicalizeJson(entry.params[1]) !== canonicalizeJson(blockTag)) {
    throw new TypeError(`${label} is not the pinned eth_call`);
  }
}

function requireRpc(entry, method, params, label) {
  if (entry.method !== method
    || canonicalizeJson(entry.params) !== canonicalizeJson(params)) {
    throw new TypeError(`${label} is not the exact pinned ${method} request`);
  }
}

function exactCodeResult(
  entry,
  expectedAddress,
  blockTag,
  expectedHash,
  label,
  expectedBytes = null,
  options = {},
) {
  if (entry.method !== "eth_getCode" || entry.params.length !== 2
    || entry.params[0] !== expectedAddress
    || canonicalizeJson(entry.params[1]) !== canonicalizeJson(blockTag)
    || typeof entry.result !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(entry.result)) {
    throw new TypeError(`${label} is not the pinned eth_getCode readback`);
  }
  const byteLength = (options.runtimeCodeBytes ?? ((code) => code.length / 2 - 1))(
    entry.result,
    expectedBytes,
    label,
  );
  const runtimeCodeHash = (options.hashRuntimeCode ?? keccak256)(entry.result, expectedHash, label);
  if (runtimeCodeHash !== expectedHash
    || (expectedBytes !== null && byteLength !== expectedBytes)) {
    throw new TypeError(`${label} runtime code hash/length differs`);
  }
  return Object.freeze({ runtimeCodeHash: expectedHash, runtimeCodeBytes: byteLength });
}

function exactViewResult(entry, {
  abi,
  functionName,
  args = [],
  target,
  blockTag,
  label,
}) {
  const data = encodeFunctionData({ abi, functionName, args });
  if (entry.method !== "eth_call" || entry.params.length !== 2
    || canonicalizeJson(entry.params[0]) !== canonicalizeJson({ to: target, data })
    || canonicalizeJson(entry.params[1]) !== canonicalizeJson(blockTag)
    || typeof entry.result !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(entry.result)) {
    throw new TypeError(`${label} is not the pinned ${functionName} readback`);
  }
  try {
    return decodeFunctionResult({ abi, functionName, data: entry.result });
  } catch {
    throw new TypeError(`${label} ${functionName} result is not strictly decodable`);
  }
}

function exactStorageResult(entry, target, slot, blockTag, expected, label) {
  if (entry.method !== "eth_getStorageAt" || entry.params.length !== 3
    || entry.params[0] !== target || entry.params[1] !== slot
    || canonicalizeJson(entry.params[2]) !== canonicalizeJson(blockTag)
    || entry.result !== expected) {
    throw new TypeError(`${label} does not bind the pinned storage slot/value`);
  }
}

async function defaultDecodeSignedTransaction(serialized) {
  const decoded = parseTransaction(serialized);
  const from = getAddress(await recoverTransactionAddress({ serializedTransaction: serialized }));
  return Object.freeze({
    chainId: decoded.chainId === undefined ? null : BigInt(decoded.chainId),
    from,
    to: decoded.to === null || decoded.to === undefined ? null : getAddress(decoded.to),
    input: decoded.data ?? "0x",
    value: decoded.value ?? 0n,
    nonce: BigInt(decoded.nonce),
  });
}

function normalizeInventory(layer, provider, entries) {
  const subject = entries.map((entry) => ({
    key: entry.key,
    method: entry.method,
    paramsSha256: framedSha256(
      "programmable.robinhood-custom-launch.rpc-params.v1",
      entry.params,
    ),
    requestSha256: entry.requestSha256,
    normalizedResultSha256: entry.normalizedResultSha256,
  }));
  return Object.freeze({
    layer,
    providerId: provider.providerId,
    trustDomain: provider.trustDomain,
    entries: Object.freeze(subject),
    inventoryDigest: framedSha256(
      "programmable.robinhood-custom-launch.rpc-inventory.v3",
      subject,
    ),
  });
}

async function normalizeL2Provider(value, index, normalizedProvider, options) {
  const label = `capture.l2ProviderReadbacks[${index}]`;
  assertExactKeys(value, ["identity", "entries", "inventoryDigest", "normalizedStateDigest"], label);
  const identity = verifyProviderIdentity(value.identity, "robinhood", index, `${label}.identity`);
  if (identity.providerId !== normalizedProvider.providerId
    || identity.trustDomain !== normalizedProvider.trustDomain) {
    throw new TypeError(`${label} identity differs from the normalized provider evidence`);
  }
  const entries = normalizeEntries(value.entries, L2_ENTRY_ORDER, `${label}.entries`);
  const inventory = normalizeInventory("robinhood", identity, entries);
  if (value.inventoryDigest !== inventory.inventoryDigest) {
    throw new TypeError(`${label}.inventoryDigest differs`);
  }
  const normalizedStateDigest = framedSha256(
    "programmable.robinhood-custom-launch.normalized-l2-state.v1",
    normalizedProvider,
  );
  if (value.normalizedStateDigest !== normalizedStateDigest) {
    throw new TypeError(`${label}.normalizedStateDigest differs from verified state/address bindings`);
  }
  const expected = normalizedProvider.transaction;
  const chainIdEntry = rpcByKey(entries, "chainId");
  requireRpc(chainIdEntry, "eth_chainId", [], `${label}.chainId`);
  if (quantity(chainIdEntry.result, `${label}.chainId`) !== CHAIN_ID) {
    throw new TypeError(`${label} observed the wrong L2 chain`);
  }
  const rawEntry = rpcByKey(entries, "rawTransaction");
  requireRpc(rawEntry, "eth_getRawTransactionByHash", [expected.hash],
    `${label}.rawTransaction`);
  const rawResult = rawEntry.result;
  if (typeof rawResult !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(rawResult)) {
    throw new TypeError(`${label} raw signed transaction is invalid`);
  }
  const rawHash = keccak256(rawResult);
  const transactionEntry = rpcByKey(entries, "transaction");
  requireRpc(transactionEntry, "eth_getTransactionByHash", [expected.hash],
    `${label}.transaction`);
  const tx = rpcTransaction(transactionEntry.result, `${label}.transaction`);
  const receiptEntry = rpcByKey(entries, "receipt");
  requireRpc(receiptEntry, "eth_getTransactionReceipt", [expected.hash], `${label}.receipt`);
  const receipt = rpcReceipt(receiptEntry.result, `${label}.receipt`);
  verifySafeCreationPath(receipt, normalizedProvider.receipt, `${label}.receipt`);
  const decoded = await (options.decodeSignedTransaction ?? defaultDecodeSignedTransaction)(rawResult);
  const decodedCalldataBytes = (options.calldataBytes ?? ((calldata) => calldata.length / 2 - 1))(
    decoded.input,
  );
  const decodedCalldataHash = (options.hashCalldata ?? keccak256)(decoded.input);
  if (rawHash !== tx.hash || rawHash !== expected.hash
    || decoded.chainId !== CHAIN_ID || decoded.from !== expected.from
    || decoded.to !== expected.to || decodedCalldataBytes !== expected.calldataBytes
    || decodedCalldataHash !== expected.calldataHash
    || decoded.input.slice(0, 10) !== expected.selector || decoded.value !== 0n
    || decoded.nonce.toString(10) !== expected.nonce
    || tx.chainId !== CHAIN_ID || tx.from !== expected.from || tx.to !== expected.to
    || tx.input !== decoded.input || tx.value !== 0n || tx.nonce !== decoded.nonce
    || tx.transactionIndex.toString(10) !== expected.transactionIndex
    || tx.blockNumber.toString(10) !== expected.blockNumber || tx.blockHash !== expected.blockHash
    || receipt.transactionHash !== rawHash || receipt.from !== expected.from
    || receipt.to !== expected.to || receipt.transactionIndex !== tx.transactionIndex
    || receipt.contractAddress !== null
    || receipt.blockNumber !== tx.blockNumber || receipt.blockHash !== tx.blockHash) {
    throw new TypeError(`${label} raw signed transaction, transaction, and receipt disagree`);
  }
  const deploymentNumberTag = `0x${tx.blockNumber.toString(16)}`;
  const predecessorNumberTag = `0x${(tx.blockNumber - 1n).toString(16)}`;
  const deploymentBlockEntry = rpcByKey(entries, "deploymentBlock");
  requireRpc(deploymentBlockEntry, "eth_getBlockByNumber", [deploymentNumberTag, false],
    `${label}.deploymentBlock`);
  const deploymentBlock = rpcBlock(
    deploymentBlockEntry.result,
    `${label}.deploymentBlock`,
  );
  const predecessorBlockEntry = rpcByKey(entries, "predecessorBlock");
  requireRpc(predecessorBlockEntry, "eth_getBlockByNumber", [predecessorNumberTag, false],
    `${label}.predecessorBlock`);
  const predecessorBlock = rpcBlock(
    predecessorBlockEntry.result,
    `${label}.predecessorBlock`,
  );
  const genesisBlockEntry = rpcByKey(entries, "genesisBlock");
  requireRpc(genesisBlockEntry, "eth_getBlockByNumber", ["0x0", false], `${label}.genesisBlock`);
  const genesisBlock = rpcBlock(
    genesisBlockEntry.result,
    `${label}.genesisBlock`,
  );
  if (deploymentBlock.number !== tx.blockNumber || deploymentBlock.hash !== tx.blockHash
    || predecessorBlock.number + 1n !== deploymentBlock.number
    || deploymentBlock.parentHash !== predecessorBlock.hash
    || predecessorBlock.hash !== normalizedProvider.atomicRoots[0].preDeploymentBlockHash) {
    throw new TypeError(`${label} deployment/predecessor block identity differs`);
  }
  if (genesisBlock.number !== 0n
    || genesisBlock.hash !== normalizedProvider.permit2Genesis.blockHash) {
    throw new TypeError(`${label} Robinhood genesis block identity differs`);
  }
  const deploymentTag = Object.freeze({
    blockHash: deploymentBlock.hash, requireCanonical: true,
  });
  const predecessorTag = Object.freeze({
    blockHash: predecessorBlock.hash, requireCanonical: true,
  });
  const genesisTag = Object.freeze({ blockHash: genesisBlock.hash, requireCanonical: true });
  exactCodeResult(
    rpcByKey(entries, "multicall3Code"),
    normalizedProvider.multicall3.address,
    deploymentTag,
    normalizedProvider.multicall3.runtimeCodeHash,
    `${label}.multicall3Code`,
    null,
    options,
  );
  const atomicCodeKeys = [
    ["permitAuthority", "prePermitAuthorityCode", "permitAuthorityCode"],
    ["graphFactory", "preGraphFactoryCode", "graphFactoryCode"],
    ["programmableLaunchStampRouter", "preRouterCode", "routerCode"],
  ];
  for (const [contract, predecessorKey, deploymentKey] of atomicCodeKeys) {
    const root = normalizedProvider.atomicRoots.find((entry) => entry.contract === contract);
    if (root === undefined) throw new TypeError(`${label} is missing ${contract}`);
    exactCodeResult(
      rpcByKey(entries, predecessorKey),
      root.address,
      predecessorTag,
      EMPTY_RUNTIME_CODE_HASH,
      `${label}.${predecessorKey}`,
      0,
      options,
    );
    exactCodeResult(
      rpcByKey(entries, deploymentKey),
      root.address,
      deploymentTag,
      root.deploymentRuntimeCodeHash,
      `${label}.${deploymentKey}`,
      null,
      options,
    );
  }
  exactCodeResult(
    rpcByKey(entries, "safeSingletonCode"),
    normalizedProvider.safeState.singleton.address,
    deploymentTag,
    normalizedProvider.safeState.singleton.runtimeCodeHash,
    `${label}.safeSingletonCode`,
    null,
    options,
  );
  exactCodeResult(
    rpcByKey(entries, "safeFallbackHandlerCode"),
    normalizedProvider.safeState.fallbackHandler,
    deploymentTag,
    normalizedProvider.safeState.fallbackHandlerRuntimeCodeHash,
    `${label}.safeFallbackHandlerCode`,
    null,
    options,
  );
  exactCodeResult(
    rpcByKey(entries, "permit2GenesisCode"),
    normalizedProvider.permit2Genesis.address,
    genesisTag,
    normalizedProvider.permit2Genesis.runtimeCodeHash,
    `${label}.permit2GenesisCode`,
    normalizedProvider.permit2Genesis.runtimeCodeBytes,
    options,
  );
  const externalContracts = [
    "poolManager", "positionManager", "stateView", "v4Quoter", "universalRouter",
  ];
  for (const contract of externalContracts) {
    const root = normalizedProvider.externalRoots.find((entry) => entry.contract === contract);
    if (root === undefined) throw new TypeError(`${label} is missing ${contract}`);
    const startBlock = BigInt(root.startBlock);
    const startTag = `0x${startBlock.toString(16)}`;
    const predecessorTag = `0x${(startBlock - 1n).toString(16)}`;
    const title = `${contract[0].toUpperCase()}${contract.slice(1)}`;
    const rawEntry = rpcByKey(entries, `${contract}RawTransaction`);
    requireRpc(rawEntry, "eth_getRawTransactionByHash", [root.transactionHash],
      `${label}.${contract}RawTransaction`);
    const rawTransaction = exactRpcBytes(rawEntry.result, `${label}.${contract}RawTransaction`);
    if (rawTransaction === "0x") {
      throw new TypeError(`${label}.${contract} raw signed transaction is empty`);
    }
    const rawHash = (options.hashSignedTransaction ?? keccak256)(rawTransaction);
    const transactionEntry = rpcByKey(entries, `${contract}Transaction`);
    requireRpc(transactionEntry, "eth_getTransactionByHash", [root.transactionHash],
      `${label}.${contract}Transaction`);
    const transaction = rpcTransaction(
      transactionEntry.result,
      `${label}.${contract}Transaction`,
    );
    const receiptEntry = rpcByKey(entries, `${contract}Receipt`);
    requireRpc(receiptEntry, "eth_getTransactionReceipt", [root.transactionHash],
      `${label}.${contract}Receipt`);
    const receipt = rpcReceipt(
      receiptEntry.result,
      `${label}.${contract}Receipt`,
    );
    const blockEntry = rpcByKey(entries, `${contract}Block`);
    requireRpc(blockEntry, "eth_getBlockByNumber", [startTag, false],
      `${label}.${contract}Block`);
    const block = rpcBlock(
      blockEntry.result,
      `${label}.${contract}Block`,
    );
    const predecessorBlockEntry = rpcByKey(entries, `${contract}PredecessorBlock`);
    requireRpc(predecessorBlockEntry, "eth_getBlockByNumber", [predecessorTag, false],
      `${label}.${contract}PredecessorBlock`);
    const predecessorBlock = rpcBlock(
      predecessorBlockEntry.result,
      `${label}.${contract}PredecessorBlock`,
    );
    const startBlockTag = Object.freeze({ blockHash: block.hash, requireCanonical: true });
    const predecessorBlockTag = Object.freeze({
      blockHash: predecessorBlock.hash, requireCanonical: true,
    });
    exactCodeResult(
      rpcByKey(entries, `${contract}Create2DeployerCode`),
      ROBINHOOD_CREATE2_DEPLOYER,
      startBlockTag,
      ROBINHOOD_CREATE2_DEPLOYER_RUNTIME_CODE_HASH,
      `${label}.${contract}Create2DeployerCode`,
      ROBINHOOD_CREATE2_DEPLOYER_RUNTIME_CODE_BYTES,
      options,
    );
    exactCodeResult(
      rpcByKey(entries, `pre${title}Code`),
      root.address,
      predecessorBlockTag,
      EMPTY_RUNTIME_CODE_HASH,
      `${label}.pre${title}Code`,
      0,
      options,
    );
    const startCode = exactCodeResult(
      rpcByKey(entries, `${contract}Code`),
      root.address,
      startBlockTag,
      root.runtimeCodeHash,
      `${label}.${contract}Code`,
      null,
      options,
    );
    if (startCode.runtimeCodeBytes < 1) {
      throw new TypeError(`${label}.${contract} start-block runtime code must be nonempty`);
    }
    const decoded = await (options.decodeSignedTransaction ?? defaultDecodeSignedTransaction)(
      rawTransaction,
    );
    if (typeof decoded.input !== "string" || !/^0x[0-9a-f]{66,}$/u.test(decoded.input)
      || (decoded.input.length - 2) % 2 !== 0) {
      throw new TypeError(`${label}.${contract} CREATE2 calldata is invalid`);
    }
    const salt = `0x${decoded.input.slice(2, 66)}`;
    const initCode = `0x${decoded.input.slice(66)}`;
    if (salt !== `0x${"0".repeat(64)}` || initCode === "0x") {
      throw new TypeError(`${label}.${contract} CREATE2 salt/initcode is invalid`);
    }
    const derivedAddress = (options.deriveCreate2Address ?? ((deployer, createSalt, bytecode) =>
      getCreate2Address({
        from: deployer,
        salt: createSalt,
        bytecodeHash: keccak256(bytecode),
      })))(ROBINHOOD_CREATE2_DEPLOYER, salt, initCode, root.address);
    if (rawHash !== root.transactionHash
      || rawEntry.normalizedResultSha256 !== root.rawTransactionDigest
      || transaction.hash !== root.transactionHash
      || transaction.to !== getAddress(ROBINHOOD_CREATE2_DEPLOYER)
      || transaction.chainId !== CHAIN_ID
      || transaction.value !== 0n
      || transaction.blockNumber !== startBlock
      || transaction.blockHash !== root.blockHash
      || transactionEntry.normalizedResultSha256 !== root.transactionDigest
      || decoded.chainId !== CHAIN_ID
      || decoded.from !== transaction.from
      || decoded.to !== transaction.to
      || decoded.input !== transaction.input
      || decoded.value !== transaction.value
      || decoded.nonce !== transaction.nonce
      || getAddress(derivedAddress) !== root.address
      || receipt.transactionHash !== transaction.hash
      || receipt.from !== transaction.from
      || receipt.to !== transaction.to
      || receipt.to !== getAddress(ROBINHOOD_CREATE2_DEPLOYER)
      || receipt.contractAddress !== null
      || receipt.transactionIndex !== transaction.transactionIndex
      || receipt.blockNumber !== startBlock
      || receipt.blockHash !== root.blockHash
      || block.hash !== root.blockHash
      || block.number !== startBlock
      || block.parentHash !== predecessorBlock.hash
      || predecessorBlock.number !== startBlock - 1n
      || predecessorBlock.hash !== root.preStartBlockHash
      || root.preStartBlockNumber !== (startBlock - 1n).toString(10)
      || root.preStartBlockRuntimeCodeHash !== EMPTY_RUNTIME_CODE_HASH
      || root.transactionReceiptDigest
        !== receiptEntry.normalizedResultSha256) {
      throw new TypeError(`${label}.${contract} exact CREATE2 deployment transition differs`);
    }
  }
  const router = normalizedProvider.routerState;
  const routerReads = [
    ["routerPermitAuthority", "PERMIT_AUTHORITY", router.permitAuthority],
    ["routerPermitAuthorityCodeHash", "PERMIT_AUTHORITY_RUNTIME_CODE_HASH", router.permitAuthorityRuntimeCodeHash],
    ["routerGraphFactory", "GRAPH_FACTORY", router.graphFactory],
    ["routerGraphFactoryCodeHash", "GRAPH_FACTORY_RUNTIME_CODE_HASH", router.graphFactoryRuntimeCodeHash],
    ["routerPoolManager", "POOL_MANAGER", router.poolManager],
    ["routerPoolManagerCodeHash", "POOL_MANAGER_RUNTIME_CODE_HASH", router.poolManagerRuntimeCodeHash],
    ["routerChainId", "CHAIN_ID", CHAIN_ID],
  ];
  for (const [key, functionName, expectedResult] of routerReads) {
    const result = exactViewResult(rpcByKey(entries, key), {
      abi: ROUTER_READ_ABI,
      functionName,
      target: router.address,
      blockTag: deploymentTag,
      label: `${label}.${key}`,
    });
    const normalizedResult = typeof result === "string" && result.length === 42
      ? getAddress(result) : result;
    if (normalizedResult !== expectedResult) {
      throw new TypeError(`${label}.${key} differs from the pinned Router binding`);
    }
  }
  const safe = normalizedProvider.safeState;
  const owners = exactViewResult(rpcByKey(entries, "safeOwners"), {
    abi: SAFE_READ_ABI,
    functionName: "getOwners",
    target: safe.proxyAddress,
    blockTag: deploymentTag,
    label: `${label}.safeOwners`,
  }).map((owner) => getAddress(owner));
  const threshold = exactViewResult(rpcByKey(entries, "safeThreshold"), {
    abi: SAFE_READ_ABI,
    functionName: "getThreshold",
    target: safe.proxyAddress,
    blockTag: deploymentTag,
    label: `${label}.safeThreshold`,
  });
  const nonce = exactViewResult(rpcByKey(entries, "safeNonce"), {
    abi: SAFE_READ_ABI,
    functionName: "nonce",
    target: safe.proxyAddress,
    blockTag: deploymentTag,
    label: `${label}.safeNonce`,
  });
  const [modules, modulesNext] = exactViewResult(rpcByKey(entries, "safeModules"), {
    abi: SAFE_READ_ABI,
    functionName: "getModulesPaginated",
    args: [SAFE_MODULES_END_SENTINEL, 16n],
    target: safe.proxyAddress,
    blockTag: deploymentTag,
    label: `${label}.safeModules`,
  });
  const version = exactViewResult(rpcByKey(entries, "safeVersion"), {
    abi: SAFE_VERSION_ABI,
    functionName: "VERSION",
    target: safe.proxyAddress,
    blockTag: deploymentTag,
    label: `${label}.safeVersion`,
  });
  if (canonicalizeJson(owners) !== canonicalizeJson(safe.owners)
    || threshold !== BigInt(safe.threshold) || nonce !== BigInt(safe.nonce)
    || canonicalizeJson(modules.map((module) => getAddress(module)))
      !== canonicalizeJson(safe.modules)
    || getAddress(modulesNext) !== safe.modulesNext
    || version !== safe.singleton.version) {
    throw new TypeError(`${label} raw Safe getters differ from owners/threshold/nonce/modules`);
  }
  exactStorageResult(
    rpcByKey(entries, "safeSingletonSlot"),
    safe.proxyAddress,
    SAFE_SINGLETON_STORAGE_SLOT,
    deploymentTag,
    safe.singletonSlot,
    `${label}.safeSingletonSlot`,
  );
  exactStorageResult(
    rpcByKey(entries, "safeFallbackHandlerSlot"),
    safe.proxyAddress,
    SAFE_FALLBACK_HANDLER_STORAGE_SLOT,
    deploymentTag,
    safe.fallbackHandlerSlot,
    `${label}.safeFallbackHandlerSlot`,
  );
  exactStorageResult(
    rpcByKey(entries, "safeGuardSlot"),
    safe.proxyAddress,
    SAFE_GUARD_STORAGE_SLOT,
    deploymentTag,
    safe.guardSlot,
    `${label}.safeGuardSlot`,
  );
  const findBatch = rpcByKey(entries, "findBatchContainingBlock");
  requireEthCall(
    findBatch,
    ROBINHOOD_NODE_INTERFACE,
    `${ROBINHOOD_FIND_BATCH_SELECTOR}${deploymentBlock.number.toString(16).padStart(64, "0")}`,
    deploymentTag,
    `${label}.findBatchContainingBlock`,
  );
  const confirmations = rpcByKey(entries, "getL1Confirmations");
  requireEthCall(
    confirmations,
    ROBINHOOD_NODE_INTERFACE,
    `${ROBINHOOD_L1_CONFIRMATIONS_SELECTOR}${deploymentBlock.hash.slice(2)}`,
    deploymentTag,
    `${label}.getL1Confirmations`,
  );
  const batchNumber = abiWord(findBatch.result, `${label}.batchNumber`);
  const l1Confirmations = abiWord(confirmations.result, `${label}.l1Confirmations`);
  if (batchNumber === 0n || l1Confirmations === 0n) {
    throw new TypeError(`${label} does not prove a posted L2 batch`);
  }
  return Object.freeze({
    identity,
    transactionHash: rawHash,
    signedTransactionSha256: sha256(Buffer.from(rawResult.slice(2), "hex")),
    receiptDigest: rpcByKey(entries, "receipt").normalizedResultSha256,
    deploymentBlock: Object.freeze({
      blockNumber: deploymentBlock.number.toString(10),
      blockHash: deploymentBlock.hash,
      predecessorBlockHash: predecessorBlock.hash,
    }),
    batchNumber: batchNumber.toString(10),
    l1Confirmations: l1Confirmations.toString(10),
    normalizedStateDigest,
    verifiedState: structuredClone(normalizedProvider),
    inventory,
  });
}

function decodePostingLog(log, batchNumber, label) {
  if (log.address !== ROBINHOOD_SEQUENCER_INBOX || log.topics.length !== 4
    || log.topics[0] !== SEQUENCER_BATCH_DELIVERED_TOPIC
    || BigInt(log.topics[1]) !== BigInt(batchNumber)) {
    throw new TypeError(`${label} is not the pinned SequencerInbox batch event`);
  }
  let decoded;
  try {
    decoded = decodeEventLog({
      abi: SEQUENCER_EVENT_ABI,
      eventName: "SequencerBatchDelivered",
      topics: log.topics,
      data: log.data,
      strict: true,
    });
  } catch {
    throw new TypeError(`${label} data/topics cannot be decoded as SequencerBatchDelivered`);
  }
  const args = decoded.args;
  if (args.batchSequenceNumber !== BigInt(batchNumber)) {
    throw new TypeError(`${label} topic batch differs`);
  }
  return Object.freeze({
    batchNumber,
    beforeAcc: exactHex32(args.beforeAcc, `${label}.beforeAcc`),
    afterAcc: exactHex32(args.afterAcc, `${label}.afterAcc`),
    delayedAcc: exactHex32(args.delayedAcc, `${label}.delayedAcc`),
    afterDelayedMessagesRead: args.afterDelayedMessagesRead.toString(10),
    timeBounds: Object.freeze({
      delayBlocks: args.timeBounds.delayBlocks.toString(10),
      futureBlocks: args.timeBounds.futureBlocks.toString(10),
      delaySeconds: args.timeBounds.delaySeconds.toString(10),
      futureSeconds: args.timeBounds.futureSeconds.toString(10),
    }),
    dataLocation: Number(args.dataLocation),
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex.toString(10),
    blockNumber: log.blockNumber.toString(10),
    blockHash: log.blockHash,
    logIndex: log.logIndex.toString(10),
  });
}

function normalizeL1Provider(value, index, batchNumber) {
  const label = `capture.ethereumProviderReadbacks[${index}]`;
  assertExactKeys(value, ["identity", "entries", "inventoryDigest"], label);
  const identity = verifyProviderIdentity(value.identity, "ethereum", index, `${label}.identity`);
  const entries = normalizeEntries(value.entries, L1_ENTRY_ORDER, `${label}.entries`);
  const inventory = normalizeInventory("ethereum", identity, entries);
  if (value.inventoryDigest !== inventory.inventoryDigest) {
    throw new TypeError(`${label}.inventoryDigest differs`);
  }
  const chainIdEntry = rpcByKey(entries, "chainId");
  requireRpc(chainIdEntry, "eth_chainId", [], `${label}.chainId`);
  if (quantity(chainIdEntry.result, `${label}.chainId`) !== ETHEREUM_CHAIN_ID) {
    throw new TypeError(`${label} observed the wrong Ethereum chain`);
  }
  const logsEntry = rpcByKey(entries, "postingLogs");
  if (logsEntry.method !== "eth_getLogs" || logsEntry.params.length !== 1) {
    throw new TypeError(`${label}.postingLogs is not an eth_getLogs request`);
  }
  const filter = plainObject(logsEntry.params[0], `${label}.postingLogs.filter`);
  assertExactKeys(filter, ["address", "fromBlock", "toBlock", "topics"],
    `${label}.postingLogs.filter`);
  const expectedBatchTopic = `0x${BigInt(batchNumber).toString(16).padStart(64, "0")}`;
  if (filter.address !== ROBINHOOD_SEQUENCER_INBOX || !Array.isArray(filter.topics)
    || filter.topics.length !== 2 || filter.topics[0] !== SEQUENCER_BATCH_DELIVERED_TOPIC
    || filter.topics[1] !== expectedBatchTopic) {
    throw new TypeError(`${label}.postingLogs filter is not pinned to the batch`);
  }
  if (!Array.isArray(logsEntry.result) || logsEntry.result.length !== 1) {
    throw new TypeError(`${label} must observe exactly one posting event`);
  }
  const rawLog = rpcLog(logsEntry.result[0], `${label}.postingLog`);
  const postingEvent = decodePostingLog(rawLog, batchNumber, `${label}.postingLog`);
  const postingBlockTag = `0x${rawLog.blockNumber.toString(16)}`;
  if (filter.fromBlock !== postingBlockTag || filter.toBlock !== postingBlockTag) {
    throw new TypeError(`${label}.postingLogs filter is not pinned to the posting block`);
  }
  const receiptEntry = rpcByKey(entries, "postingReceipt");
  requireRpc(receiptEntry, "eth_getTransactionReceipt", [postingEvent.transactionHash],
    `${label}.postingReceipt`);
  const receipt = rpcReceipt(receiptEntry.result, `${label}.postingReceipt`);
  const blockEntry = rpcByKey(entries, "postingBlock");
  requireRpc(blockEntry, "eth_getBlockByHash", [receipt.blockHash, false],
    `${label}.postingBlock`);
  const postingBlock = rpcBlock(blockEntry.result, `${label}.postingBlock`);
  const matchingLogs = receipt.logs.filter((log) =>
    log.address === rawLog.address && log.transactionHash === rawLog.transactionHash
    && log.blockHash === rawLog.blockHash && log.logIndex === rawLog.logIndex
    && canonicalizeJson(log.topics) === canonicalizeJson(rawLog.topics)
    && log.data === rawLog.data);
  if (receipt.transactionHash !== postingEvent.transactionHash
    || receipt.blockNumber.toString(10) !== postingEvent.blockNumber
    || receipt.blockHash !== postingEvent.blockHash
    || receipt.transactionIndex.toString(10) !== postingEvent.transactionIndex
    || receipt.to !== ROBINHOOD_SEQUENCER_INBOX
    || receipt.contractAddress !== null
    || matchingLogs.length !== 1 || postingBlock.number !== receipt.blockNumber
    || postingBlock.hash !== receipt.blockHash) {
    throw new TypeError(`${label} posting receipt/header/log inclusion differs`);
  }
  const finalizedEntry = rpcByKey(entries, "finalizedTag");
  const rereadEntry = rpcByKey(entries, "finalizedReread");
  if (finalizedEntry.method !== "eth_getBlockByNumber"
    || rereadEntry.method !== "eth_getBlockByNumber"
    || canonicalizeJson(finalizedEntry.params) !== canonicalizeJson(["finalized", false])
    || canonicalizeJson(rereadEntry.params) !== canonicalizeJson(["finalized", false])) {
    throw new TypeError(`${label} finalized readbacks are not finalized-tag requests`);
  }
  const finalized = rpcBlock(finalizedEntry.result, `${label}.finalizedTag`);
  const finalizedReread = rpcBlock(rereadEntry.result, `${label}.finalizedReread`);
  if (finalized.number < postingBlock.number || finalized.number !== finalizedReread.number
    || finalized.hash !== finalizedReread.hash) {
    throw new TypeError(`${label} finalized checkpoint is stale or changed on reread`);
  }
  return Object.freeze({
    identity,
    postingEvent,
    receiptStatus: "1",
    postingReceiptDigest: receiptEntry.normalizedResultSha256,
    postingBlockDigest: blockEntry.normalizedResultSha256,
    finalizedCheckpoint: Object.freeze({
      blockNumber: finalized.number.toString(10),
      blockHash: finalized.hash,
      tag: "finalized",
      firstReadDigest: finalizedEntry.normalizedResultSha256,
      rereadDigest: rereadEntry.normalizedResultSha256,
    }),
    inventory,
  });
}

function normalizeRawSourcify(value, index, repositoryRoot, expected, readFile, observedAt) {
  const label = `capture.sourcifyResponses[${index}]`;
  assertExactKeys(value, [
    "contract", "urlPath", "httpStatus", "contentType", "responseBase64",
    "responseSha256",
  ], label);
  if (value.contract !== expected.contract || value.httpStatus !== 200
    || value.urlPath !== `/server/v2/contract/4663/${expected.address}?fields=all`
    || typeof value.contentType !== "string"
    || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(value.contentType)) {
    throw new TypeError(`${label} is not the canonical Sourcify V2 fields=all response`);
  }
  const bytes = exactBase64(value.responseBase64, `${label}.responseBase64`, MAX_SOURCIFY_BYTES);
  if (sha256(bytes) !== value.responseSha256) {
    throw new TypeError(`${label}.responseSha256 differs from retained bytes`);
  }
  const response = plainObject(parseJsonBytes(bytes, `${label} response`), `${label} response`);
  if (response.chainId !== "4663" || response.address !== expected.address
    || response.match !== "exact_match" || response.creationMatch !== "exact_match"
    || response.runtimeMatch !== "exact_match"
    || typeof response.matchId !== "string" || response.matchId.length === 0
    || typeof response.verifiedAt !== "string") {
    throw new TypeError(`${label} is not an exact creation-and-runtime match for the pinned target`);
  }
  iso(response.verifiedAt, `${label}.verifiedAt`);
  const compilation = plainObject(response.compilation, `${label}.compilation`);
  if (compilation.language !== "Solidity" || compilation.compiler !== "solc"
    || compilation.compilerVersion !== "0.8.26+commit.8a97fa7a"
    || compilation.name !== expected.name
    || compilation.fullyQualifiedName !== expected.fullyQualifiedName
    || typeof compilation.compilerSettings !== "object" || compilation.compilerSettings === null) {
    throw new TypeError(`${label} compiler/contract identity differs`);
  }
  const stdJsonInput = plainObject(response.stdJsonInput, `${label}.stdJsonInput`);
  const localBytes = readFile(repositoryRoot, expected.standardJsonInputPath);
  const localInput = parseStrictJson(decodeExactUtf8(localBytes, expected.standardJsonInputPath), {
    maximumBytes: localBytes.byteLength,
  });
  if (canonicalizeJson(stdJsonInput) !== canonicalizeJson(localInput)) {
    throw new TypeError(`${label} Standard JSON input differs from the exact repository input`);
  }
  if (canonicalizeJson(compilation.compilerSettings)
      !== canonicalizeJson(localInput.settings)) {
    throw new TypeError(`${label} compiler settings differ from the exact repository input`);
  }
  const sources = plainObject(response.sources, `${label}.sources`);
  const sourceNames = Object.keys(stdJsonInput.sources ?? {}).sort();
  if (sourceNames.length === 0 || Object.keys(sources).sort().join("\0") !== sourceNames.join("\0")) {
    throw new TypeError(`${label} source-file closure differs from Standard JSON`);
  }
  for (const sourceName of sourceNames) {
    if (sources[sourceName]?.content !== stdJsonInput.sources[sourceName]?.content) {
      throw new TypeError(`${label} source ${sourceName} differs from Standard JSON`);
    }
  }
  const normalized = {
    contract: expected.contract,
    provider: "sourcify-v2",
    chainId: "4663",
    address: expected.address,
    match: "exact_match",
    creationMatch: "exact_match",
    runtimeMatch: "exact_match",
    observedAt: iso(observedAt, `${label}.observedAt`),
    compiler: Object.freeze({
      language: "Solidity",
      compiler: "solc",
      compilerVersion: compilation.compilerVersion,
      name: compilation.name,
      fullyQualifiedName: compilation.fullyQualifiedName,
      compilerSettingsDigest: framedSha256(
        "programmable.robinhood-custom-launch.sourcify-compiler-settings.v1",
        compilation.compilerSettings,
      ),
    }),
    sourceFilesDigest: framedSha256(
      "programmable.robinhood-custom-launch.sourcify-source-files.v1",
      sources,
    ),
    standardJsonInputPath: expected.standardJsonInputPath,
    standardJsonInputSha256: sha256(localBytes),
    urlPath: value.urlPath,
    httpStatus: 200,
    contentType: "application/json",
    normalizedVerificationDigest: null,
  };
  normalized.normalizedVerificationDigest = framedSha256(
    SOURCIFY_NORMALIZED_RESPONSE_DOMAIN,
    { ...normalized, normalizedVerificationDigest: null },
  );
  return Object.freeze(normalized);
}

function validateNormalizedSourcify(
  value,
  index,
  repositoryRoot,
  expected,
  readFile,
  observedAt,
) {
  const label = `capture.sourcifyResponses[${index}]`;
  assertExactKeys(value, [
    "contract", "provider", "chainId", "address", "match", "creationMatch",
    "runtimeMatch", "observedAt", "compiler", "sourceFilesDigest",
    "standardJsonInputPath", "standardJsonInputSha256", "urlPath", "httpStatus",
    "contentType", "normalizedVerificationDigest",
  ], label);
  assertExactKeys(value.compiler, [
    "language", "compiler", "compilerVersion", "name", "fullyQualifiedName",
    "compilerSettingsDigest",
  ], `${label}.compiler`);
  const localBytes = readFile(repositoryRoot, expected.standardJsonInputPath);
  const localInput = parseStrictJson(decodeExactUtf8(localBytes, expected.standardJsonInputPath), {
    maximumBytes: localBytes.byteLength,
  });
  const expectedSources = plainObject(localInput.sources, `${label} local sources`);
  if (value.match !== "exact_match" || value.creationMatch !== "exact_match"
    || value.runtimeMatch !== "exact_match" || value.address !== expected.address) {
    throw new TypeError(`${label} is not an exact creation-and-runtime match for the pinned target`);
  }
  if (value.contract !== expected.contract || value.provider !== "sourcify-v2"
    || value.chainId !== "4663" || value.address !== expected.address
    || value.match !== "exact_match" || value.creationMatch !== "exact_match"
    || value.runtimeMatch !== "exact_match" || value.observedAt !== observedAt
    || value.compiler.language !== "Solidity" || value.compiler.compiler !== "solc"
    || value.compiler.compilerVersion !== "0.8.26+commit.8a97fa7a"
    || value.compiler.name !== expected.name
    || value.compiler.fullyQualifiedName !== expected.fullyQualifiedName
    || value.compiler.compilerSettingsDigest !== framedSha256(
      "programmable.robinhood-custom-launch.sourcify-compiler-settings.v1",
      localInput.settings,
    )
    || value.sourceFilesDigest !== framedSha256(
      "programmable.robinhood-custom-launch.sourcify-source-files.v1",
      expectedSources,
    )
    || value.standardJsonInputPath !== expected.standardJsonInputPath
    || value.standardJsonInputSha256 !== sha256(localBytes)
    || value.urlPath !== `/server/v2/contract/4663/${expected.address}?fields=all`
    || value.httpStatus !== 200 || value.contentType !== "application/json"
    || value.normalizedVerificationDigest !== framedSha256(
      SOURCIFY_NORMALIZED_RESPONSE_DOMAIN,
      { ...structuredClone(value), normalizedVerificationDigest: null },
    )) {
    throw new TypeError(`${label} normalized semantic closure differs`);
  }
  return Object.freeze(structuredClone(value));
}

function normalizeSourceOrigin(value) {
  const label = "capture.sourceOrigin";
  assertExactKeys(value, [
    "repository", "repositoryId", "protectedRef", "revision", "tree", "sourceClosureDigest",
  ], label);
  if (value.repository !== ROBINHOOD_PRODUCTION_REPOSITORY
    || value.repositoryId !== ROBINHOOD_PRODUCTION_REPOSITORY_ID
    || value.protectedRef !== ROBINHOOD_PRODUCTION_REF
    || typeof value.revision !== "string" || !/^[0-9a-f]{40}$/u.test(value.revision)
    || typeof value.tree !== "string" || !/^[0-9a-f]{40}$/u.test(value.tree)
    || typeof value.sourceClosureDigest !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.sourceClosureDigest)) {
    throw new TypeError(`${label} does not bind the protected PROGRAMMABLE source tuple`);
  }
  return Object.freeze(structuredClone(value));
}

function normalizeAuthorization(
  value,
  subjectSha256,
  sourceOrigin,
  observedAt,
  allowTestOnly,
) {
  const label = "capture authorization";
  assertExactKeys(value, [
    "schemaVersion", "trustClass", "subjectPath", "subjectSha256",
    "attestationBundlePath", "attestationBundleSha256",
    "trustedRootSource", "trustedRootSha256",
    "productionVerifyProofPath", "productionVerifyProofByteLength",
    "productionVerifyProofSha256", "productionVerifyAttestationBundlePath",
    "productionVerifyAttestationBundleByteLength",
    "productionVerifyAttestationBundleSha256", "productionVerifyRunId",
    "productionVerifyRunAttempt", "productionVerifyArtifactId",
    "productionVerifyArtifactDigest",
    "repository", "repositoryId",
    "workflow", "sourceRef", "sourceRevision", "sourceTree", "sourceClosureDigest",
    "verifiedAt", "verificationDigest",
  ], label);
  if (value.schemaVersion !== ROBINHOOD_CAPTURE_AUTHORIZATION_SCHEMA
    || value.subjectPath !== ROBINHOOD_CAPTURE_PATH
    || value.subjectSha256 !== subjectSha256
    || value.attestationBundlePath !== ROBINHOOD_CAPTURE_ATTESTATION_BUNDLE_PATH
    || !/^sha256:[0-9a-f]{64}$/u.test(value.attestationBundleSha256)
    || value.trustedRootSource !== "github-cli-embedded-tuf"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.trustedRootSha256)
    || value.productionVerifyProofPath !== ROBINHOOD_SOURCE_VERIFY_PROOF_PATH
    || !/^[1-9][0-9]*$/u.test(value.productionVerifyProofByteLength)
    || !/^sha256:[0-9a-f]{64}$/u.test(value.productionVerifyProofSha256)
    || value.productionVerifyAttestationBundlePath
      !== ROBINHOOD_SOURCE_VERIFY_ATTESTATION_BUNDLE_PATH
    || !/^[1-9][0-9]*$/u.test(value.productionVerifyAttestationBundleByteLength)
    || !/^sha256:[0-9a-f]{64}$/u.test(value.productionVerifyAttestationBundleSha256)
    || !/^[1-9][0-9]*$/u.test(value.productionVerifyRunId)
    || !/^[1-9][0-9]*$/u.test(value.productionVerifyRunAttempt)
    || !/^[1-9][0-9]*$/u.test(value.productionVerifyArtifactId)
    || !/^sha256:[0-9a-f]{64}$/u.test(value.productionVerifyArtifactDigest)
    || value.repository !== ROBINHOOD_PRODUCTION_REPOSITORY
    || value.repositoryId !== ROBINHOOD_PRODUCTION_REPOSITORY_ID
    || value.workflow !== ROBINHOOD_CAPTURE_WORKFLOW
    || value.sourceRef !== ROBINHOOD_PRODUCTION_REF
    || value.sourceRevision !== sourceOrigin.revision || value.sourceTree !== sourceOrigin.tree
    || value.sourceClosureDigest !== sourceOrigin.sourceClosureDigest
    || !new Set(["github-artifact-attestation", "test-only"]).has(value.trustClass)
    || (value.trustClass === "test-only" && allowTestOnly !== true)) {
    throw new TypeError(`${label} does not authorize this exact capture/source subject`);
  }
  iso(value.verifiedAt, `${label}.verifiedAt`);
  const verifiedTime = Date.parse(value.verifiedAt);
  const observedTime = Date.parse(observedAt);
  if (verifiedTime < observedTime || verifiedTime - observedTime > CAPTURE_MAX_AGE_MS) {
    throw new TypeError(`${label}.verifiedAt is outside the capture validity window`);
  }
  const preimage = { ...value, verificationDigest: null };
  const expected = framedSha256(ROBINHOOD_CAPTURE_AUTHORIZATION_SCHEMA, preimage);
  if (value.verificationDigest !== expected) {
    throw new TypeError(`${label}.verificationDigest differs`);
  }
  return Object.freeze(structuredClone(value));
}

export function buildRobinhoodCaptureAuthorization(value) {
  const normalized = { ...structuredClone(value), verificationDigest: null };
  normalized.verificationDigest = framedSha256(
    ROBINHOOD_CAPTURE_AUTHORIZATION_SCHEMA,
    normalized,
  );
  return Object.freeze(normalized);
}

export async function validateRobinhoodProductionCapture({
  capture,
  captureBytes,
  repositoryRoot,
  normalizedProviders,
  authorization,
  readFile,
  now = () => new Date(),
  decodeSignedTransaction,
  hashCalldata,
  calldataBytes,
  hashRuntimeCode,
  runtimeCodeBytes,
  hashSignedTransaction,
  deriveCreate2Address,
  allowTestOnly = false,
}) {
  assertExactKeys(capture, [
    "schemaVersion", "captureId", "observedAt", "expiresAt", "profileDigest",
    "sourceOrigin", "l2ProviderReadbacks", "ethereumProviderReadbacks",
    "sourcifyResponses", "captureInventoryDigest", "captureClosureDigest",
  ], "capture");
  if (capture.schemaVersion !== ROBINHOOD_CAPTURE_SCHEMA
    || typeof capture.captureId !== "string"
    || !/^[0-9a-f]{64}$/u.test(capture.captureId)
    || capture.profileDigest !== ROBINHOOD_CAPTURE_PROFILE_DIGEST) {
    throw new TypeError("capture identity/profile is invalid");
  }
  if (!Buffer.isBuffer(captureBytes) || captureBytes.byteLength < 1
    || captureBytes.byteLength > MAX_PUBLIC_CAPTURE_BYTES) {
    throw new TypeError("public capture bytes are empty or exceed the capture artifact budget");
  }
  const expectedCaptureClosureDigest = computeRobinhoodCaptureClosureDigest(capture);
  if (capture.captureClosureDigest !== expectedCaptureClosureDigest) {
    throw new TypeError("capture closure digest differs from the exact raw capture manifest");
  }
  const observedAt = iso(capture.observedAt, "capture.observedAt");
  const expiresAt = iso(capture.expiresAt, "capture.expiresAt");
  const current = now().getTime();
  if (!Number.isFinite(current)
    || Date.parse(observedAt) > current + CAPTURE_MAX_FUTURE_SKEW_MS
    || current - Date.parse(observedAt) > CAPTURE_MAX_AGE_MS
    || Date.parse(expiresAt) <= current
    || Date.parse(expiresAt) - Date.parse(observedAt) > CAPTURE_MAX_AGE_MS) {
    throw new TypeError("capture is stale, future-dated, or has an excessive validity window");
  }
  const sourceOrigin = normalizeSourceOrigin(capture.sourceOrigin);
  const subjectSha256 = sha256(captureBytes);
  const normalizedAuthorization = normalizeAuthorization(
    authorization,
    subjectSha256,
    sourceOrigin,
    observedAt,
    allowTestOnly,
  );
  if (!Array.isArray(capture.l2ProviderReadbacks)
    || capture.l2ProviderReadbacks.length !== 2
    || !Array.isArray(capture.ethereumProviderReadbacks)
    || capture.ethereumProviderReadbacks.length !== 2
    || !Array.isArray(capture.sourcifyResponses)
    || capture.sourcifyResponses.length !== 2) {
    throw new TypeError("capture requires two L2, two L1, and two Sourcify readbacks");
  }
  if ([...capture.l2ProviderReadbacks, ...capture.ethereumProviderReadbacks]
    .some((provider) => provider?.identity?.observedAt !== observedAt)) {
    throw new TypeError("provider observation times must equal the outer capture observation");
  }
  const l2Providers = await Promise.all(capture.l2ProviderReadbacks.map((provider, index) =>
    normalizeL2Provider(provider, index, normalizedProviders[index], {
      decodeSignedTransaction,
      hashCalldata,
      calldataBytes,
      hashRuntimeCode,
      runtimeCodeBytes,
      hashSignedTransaction,
      deriveCreate2Address,
    })));
  const sourceTargets = [
      {
        contract: "graphFactory",
        address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
        name: "ProgrammableCreate2GraphDeployerV1",
        fullyQualifiedName:
          "src/ProgrammableCreate2GraphDeployerV1.sol:ProgrammableCreate2GraphDeployerV1",
        standardJsonInputPath:
          "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
      },
      {
        contract: "programmableLaunchStampRouter",
        address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
        name: "ProgrammableLaunchStampRouterV1",
        fullyQualifiedName:
          "src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol:ProgrammableLaunchStampRouterV1",
        standardJsonInputPath:
          "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
      },
  ];
  const sourcify = capture.sourcifyResponses.map((response, index) =>
    validateNormalizedSourcify(
      response,
      index,
      repositoryRoot,
      sourceTargets[index],
      readFile,
      observedAt,
    ));
  if (l2Providers[0].transactionHash !== l2Providers[1].transactionHash
    || l2Providers[0].deploymentBlock.blockNumber !== l2Providers[1].deploymentBlock.blockNumber
    || l2Providers[0].deploymentBlock.blockHash !== l2Providers[1].deploymentBlock.blockHash
    || l2Providers[0].deploymentBlock.predecessorBlockHash
      !== l2Providers[1].deploymentBlock.predecessorBlockHash
    || l2Providers[0].batchNumber !== l2Providers[1].batchNumber
    || canonicalizeJson(commonVerifiedState(l2Providers[0]))
      !== canonicalizeJson(commonVerifiedState(l2Providers[1]))
    || canonicalizeJson(normalizedResultSummary(l2Providers[0]))
      !== canonicalizeJson(normalizedResultSummary(l2Providers[1]))) {
    throw new TypeError("independent L2 providers disagree on transaction/checkpoint/batch");
  }
  const batchNumber = l2Providers[0].batchNumber;
  const ethereumProviders = capture.ethereumProviderReadbacks.map((provider, index) =>
    normalizeL1Provider(provider, index, batchNumber));
  if (canonicalizeJson(ethereumProviders[0].postingEvent)
      !== canonicalizeJson(ethereumProviders[1].postingEvent)
    || ethereumProviders[0].finalizedCheckpoint.blockNumber
      !== ethereumProviders[1].finalizedCheckpoint.blockNumber
    || ethereumProviders[0].finalizedCheckpoint.blockHash
      !== ethereumProviders[1].finalizedCheckpoint.blockHash
    || canonicalizeJson(normalizedResultSummary(ethereumProviders[0]))
      !== canonicalizeJson(normalizedResultSummary(ethereumProviders[1]))) {
    throw new TypeError("independent Ethereum providers disagree on posting/finalized checkpoint");
  }
  const inventorySubject = [
    ...l2Providers.map(({ inventory }) => inventory),
    ...ethereumProviders.map(({ inventory }) => inventory),
    ...sourcify.map((entry) => ({
      layer: "sourcify",
      contract: entry.contract,
      normalizedVerificationDigest: entry.normalizedVerificationDigest,
    })),
  ];
  const captureInventoryDigest = framedSha256(
    CAPTURE_INVENTORY_DOMAIN,
    inventorySubject,
  );
  if (capture.captureInventoryDigest !== captureInventoryDigest) {
    throw new TypeError("capture inventory is missing, reordered, or differs");
  }
  const captureId = computeRobinhoodCaptureId({
    revision: sourceOrigin.revision,
    tree: sourceOrigin.tree,
    observedAt,
    captureInventoryDigest,
  });
  if (capture.captureId !== captureId) {
    throw new TypeError("captureId differs from the exact source/time/inventory preimage");
  }
  const sourceVerificationClosureDigest = framedSha256(
    SOURCIFY_RESPONSE_CLOSURE_DOMAIN,
    sourcify,
  );
  const closure = {
    schemaVersion: ROBINHOOD_CAPTURE_CLOSURE_SCHEMA,
    captureId: capture.captureId,
    observedAt,
    expiresAt,
    profileDigest: capture.profileDigest,
    sourceOrigin,
    authorization: normalizedAuthorization,
    l2Checkpoint: {
      blockNumber: l2Providers[0].deploymentBlock.blockNumber,
      blockHash: l2Providers[0].deploymentBlock.blockHash,
    },
    l2ProviderReadbacks: l2Providers,
    batchNumber,
    postingEvent: ethereumProviders[0].postingEvent,
    ethereumProviderReadbacks: ethereumProviders,
    ethereumFinalizedCheckpoint: {
      blockNumber: ethereumProviders[0].finalizedCheckpoint.blockNumber,
      blockHash: ethereumProviders[0].finalizedCheckpoint.blockHash,
      tag: "finalized",
    },
    sourcify,
    sourceVerificationClosureDigest,
    captureInventoryDigest,
    captureSubjectSha256: subjectSha256,
    captureClosureDigest: expectedCaptureClosureDigest,
  };
  return Object.freeze(closure);
}

export async function freshVerifyRobinhoodSourcify({
  repositoryRoot,
  captureClosure,
  readFile,
  fetch: request = fetch,
  now = () => new Date(),
}) {
  const freshObservedAt = canonicalRobinhoodFreshObservedAt(now);
  const responseBudget = createRobinhoodResponseBudget();
  const sourceTargets = [
    {
      contract: "graphFactory",
      address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
      name: "ProgrammableCreate2GraphDeployerV1",
      fullyQualifiedName:
        "src/ProgrammableCreate2GraphDeployerV1.sol:ProgrammableCreate2GraphDeployerV1",
      standardJsonInputPath:
        "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
    },
    {
      contract: "programmableLaunchStampRouter",
      address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
      name: "ProgrammableLaunchStampRouterV1",
      fullyQualifiedName:
        "src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol:ProgrammableLaunchStampRouterV1",
      standardJsonInputPath:
        "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
    },
  ];
  const fresh = [];
  for (const [index, target] of sourceTargets.entries()) {
    const urlPath = `/server/v2/contract/4663/${target.address}?fields=all`;
    const response = await request(`https://sourcify.dev${urlPath}`, {
      method: "GET",
      headers: Object.freeze({ accept: "application/json" }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const bytes = await readRobinhoodBoundedResponse(response, {
      label: `fresh Sourcify ${target.contract}`,
      maximumBytes: MAX_SOURCIFY_BYTES,
      budget: responseBudget,
    });
    fresh.push(normalizeRawSourcify({
      contract: target.contract,
      urlPath,
      httpStatus: response.status,
      contentType: response.headers.get("content-type") ?? "",
      responseBase64: bytes.toString("base64"),
      responseSha256: sha256(bytes),
    }, index, repositoryRoot, target, readFile, freshObservedAt));
  }
  const semantic = (entry) => {
    const {
      observedAt: _observedAt,
      normalizedVerificationDigest: _normalizedVerificationDigest,
      ...stable
    } = entry;
    return stable;
  };
  if (canonicalizeJson(fresh.map(semantic))
      !== canonicalizeJson(captureClosure.sourcify.map(semantic))) {
    throw new TypeError("fresh Sourcify V2 closure differs from the attested capture");
  }
  return Object.freeze({
    sourceVerificationClosureDigest: framedSha256(
      SOURCIFY_RESPONSE_CLOSURE_DOMAIN,
      fresh,
    ),
    observedAt: freshObservedAt,
    responses: Object.freeze(fresh),
  });
}

function freshEndpoint(value, layer, index) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) {
    throw new TypeError(`fresh ${layer} provider ${index} endpoint is missing or oversized`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`fresh ${layer} provider ${index} endpoint is not an absolute URL`);
  }
  const pin = PROVIDER_PINS[layer][index];
  if (url.protocol !== "https:" || url.username !== "" || url.password !== ""
    || (url.port !== "" && url.port !== "443") || url.hash !== ""
    || url.hostname !== url.hostname.toLowerCase()
    || !pin.hostnameSuffixes.some((suffix) =>
      url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))) {
    throw new TypeError(`fresh ${layer} provider ${index} endpoint violates its hostname pin`);
  }
  return url;
}

async function freshRpcEntries({
  layer,
  index,
  endpoint,
  captured,
  request,
  observedAt,
  responseBudget,
}) {
  const url = freshEndpoint(endpoint, layer, index);
  const entries = [];
  for (const [entryIndex, source] of captured.entries.entries()) {
    const id = entryIndex + 1;
    const requestValue = { jsonrpc: "2.0", id, method: source.method, params: source.params };
    const requestBytes = Buffer.from(JSON.stringify(requestValue), "utf8");
    const response = await request(url, {
      method: "POST",
      headers: Object.freeze({
        accept: "application/json",
        "content-type": "application/json",
      }),
      body: requestBytes,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 200
      || !/^application\/json(?:;.*)?$/iu.test(response.headers.get("content-type") ?? "")) {
      throw new TypeError(`fresh ${layer} provider ${index} returned an invalid RPC envelope`);
    }
    const responseBytes = await readRobinhoodBoundedResponse(response, {
      label: `fresh ${layer} provider ${index} ${source.key}`,
      maximumBytes: robinhoodRpcResponseLimit(source.method),
      budget: responseBudget,
    });
    entries.push(buildRobinhoodPublicRpcEntry({
      key: source.key,
      method: source.method,
      params: structuredClone(source.params),
      requestId: id,
      responseBytes,
    }));
  }
  const value = {
    identity: {
      ...captured.identity,
      observedAt,
    },
    entries,
    inventoryDigest: null,
    ...(layer === "robinhood"
      ? { normalizedStateDigest: captured.normalizedStateDigest }
      : {}),
  };
  value.inventoryDigest = normalizeInventory(
    layer,
    value.identity,
    entries.map((entry, entryIndex) => normalizeRpcEntry(
      entry,
      `fresh ${layer} provider ${index}.entries[${entryIndex}]`,
    )),
  ).inventoryDigest;
  return value;
}

export async function freshVerifyRobinhoodProviderReadbacks({
  capture,
  captureClosure,
  rpcUrls,
  fetch: request = fetch,
  now = () => new Date(),
  decodeSignedTransaction,
  hashCalldata,
  calldataBytes,
  hashRuntimeCode,
  runtimeCodeBytes,
  hashSignedTransaction,
  deriveCreate2Address,
}) {
  if (!Array.isArray(rpcUrls?.robinhood) || rpcUrls.robinhood.length !== 2
    || !Array.isArray(rpcUrls?.ethereum) || rpcUrls.ethereum.length !== 2) {
    throw new TypeError("fresh provider verification requires two L2 and two L1 RPC URLs");
  }
  if (!Array.isArray(capture?.l2ProviderReadbacks)
    || !Array.isArray(capture?.ethereumProviderReadbacks)
    || !Array.isArray(captureClosure?.l2ProviderReadbacks)
    || captureClosure.l2ProviderReadbacks.length !== 2) {
    throw new TypeError("fresh provider verification requires the exact captured readback inventory");
  }
  const observedAt = canonicalRobinhoodFreshObservedAt(now);
  const responseBudget = createRobinhoodResponseBudget();
  const freshL2Raw = await Promise.all(capture.l2ProviderReadbacks.map((provider, index) =>
    freshRpcEntries({
      layer: "robinhood",
      index,
      endpoint: rpcUrls.robinhood[index],
      captured: provider,
      request,
      observedAt,
      responseBudget,
    })));
  const options = {
    decodeSignedTransaction,
    hashCalldata,
    calldataBytes,
    hashRuntimeCode,
    runtimeCodeBytes,
    hashSignedTransaction,
    deriveCreate2Address,
  };
  const freshL2 = await Promise.all(freshL2Raw.map((provider, index) =>
    normalizeL2Provider(
      provider,
      index,
      captureClosure.l2ProviderReadbacks[index].verifiedState,
      options,
    )));
  for (const [index, entry] of freshL2.entries()) {
    const captured = captureClosure.l2ProviderReadbacks[index];
    if (entry.transactionHash !== captured.transactionHash
      || entry.signedTransactionSha256 !== captured.signedTransactionSha256
      || canonicalizeJson(entry.deploymentBlock) !== canonicalizeJson(captured.deploymentBlock)
      || entry.batchNumber !== captured.batchNumber
      || entry.normalizedStateDigest !== captured.normalizedStateDigest
      || canonicalizeJson(commonVerifiedState(entry))
        !== canonicalizeJson(commonVerifiedState(captured))
      || canonicalizeJson(normalizedResultSummary(entry))
        !== canonicalizeJson(normalizedResultSummary(captured))
      || BigInt(entry.l1Confirmations) < BigInt(captured.l1Confirmations)) {
      throw new TypeError(`fresh L2 provider ${index} semantics differ from the attested capture`);
    }
  }
  if (freshL2[0].transactionHash !== freshL2[1].transactionHash
    || canonicalizeJson(freshL2[0].deploymentBlock)
      !== canonicalizeJson(freshL2[1].deploymentBlock)
    || freshL2[0].batchNumber !== freshL2[1].batchNumber
    || canonicalizeJson(commonVerifiedState(freshL2[0]))
      !== canonicalizeJson(commonVerifiedState(freshL2[1]))
    || canonicalizeJson(externalTransitionSummary(freshL2[0]))
      !== canonicalizeJson(externalTransitionSummary(freshL2[1]))
    || canonicalizeJson(normalizedResultSummary(freshL2[0]))
      !== canonicalizeJson(normalizedResultSummary(freshL2[1]))) {
    throw new TypeError("fresh independent L2 providers disagree");
  }
  const freshL1Raw = await Promise.all(capture.ethereumProviderReadbacks.map((provider, index) =>
    freshRpcEntries({
      layer: "ethereum",
      index,
      endpoint: rpcUrls.ethereum[index],
      captured: provider,
      request,
      observedAt,
      responseBudget,
    })));
  const freshL1 = freshL1Raw.map((provider, index) =>
    normalizeL1Provider(provider, index, freshL2[0].batchNumber));
  for (const [index, entry] of freshL1.entries()) {
    const captured = captureClosure.ethereumProviderReadbacks[index];
    if (canonicalizeJson(entry.postingEvent) !== canonicalizeJson(captured.postingEvent)
      || entry.receiptStatus !== "1"
      || canonicalizeJson(normalizedResultSummary(entry, ["finalizedTag", "finalizedReread"]))
        !== canonicalizeJson(normalizedResultSummary(
          captured,
          ["finalizedTag", "finalizedReread"],
        ))
      || BigInt(entry.finalizedCheckpoint.blockNumber)
        < BigInt(captureClosure.ethereumFinalizedCheckpoint.blockNumber)) {
      throw new TypeError(`fresh Ethereum provider ${index} semantics differ from the attested capture`);
    }
  }
  if (canonicalizeJson(freshL1[0].postingEvent) !== canonicalizeJson(freshL1[1].postingEvent)
    || freshL1[0].finalizedCheckpoint.blockNumber !== freshL1[1].finalizedCheckpoint.blockNumber
    || freshL1[0].finalizedCheckpoint.blockHash !== freshL1[1].finalizedCheckpoint.blockHash
    || canonicalizeJson(normalizedResultSummary(freshL1[0]))
      !== canonicalizeJson(normalizedResultSummary(freshL1[1]))) {
    throw new TypeError("fresh independent Ethereum providers disagree on posting/finality");
  }
  const semantic = {
    observedAt,
    l2Checkpoint: freshL2[0].deploymentBlock,
    batchNumber: freshL2[0].batchNumber,
    l1Confirmations: freshL2.map((entry) => entry.l1Confirmations),
    postingEvent: freshL1[0].postingEvent,
    ethereumFinalizedCheckpoint: {
      blockNumber: freshL1[0].finalizedCheckpoint.blockNumber,
      blockHash: freshL1[0].finalizedCheckpoint.blockHash,
      tag: "finalized",
    },
    inventories: [
      ...freshL2.map((entry) => entry.inventory),
      ...freshL1.map((entry) => entry.inventory),
    ],
  };
  return Object.freeze({
    ...semantic,
    freshReadbackDigest: framedSha256(
      "programmable.robinhood-custom-launch.fresh-provider-readbacks.v1",
      semantic,
    ),
  });
}

export function computeRobinhoodCaptureClosureDigest(capture) {
  if (capture === null || typeof capture !== "object" || Array.isArray(capture)) {
    throw new TypeError("capture digest preimage must be an object");
  }
  return framedSha256(
    ROBINHOOD_CAPTURE_CLOSURE_SCHEMA,
    { ...capture, captureClosureDigest: null },
  );
}

function computeRobinhoodCaptureId({ revision, tree, observedAt, captureInventoryDigest }) {
  return createHash("sha256").update(Buffer.from(canonicalizeJson({
    revision,
    tree,
    observedAt,
    captureInventoryDigest,
  }))).digest("hex");
}

function externalTransitionSummary(provider) {
  if (!Array.isArray(provider?.verifiedState?.externalRoots)) {
    throw new TypeError("verified provider is missing external deployment transitions");
  }
  return provider.verifiedState.externalRoots.map((entry) => ({
    contract: entry.contract,
    address: entry.address,
    transactionHash: entry.transactionHash,
    rawTransactionDigest: entry.rawTransactionDigest,
    transactionDigest: entry.transactionDigest,
    transactionReceiptDigest: entry.transactionReceiptDigest,
    preStartBlockNumber: entry.preStartBlockNumber,
    preStartBlockHash: entry.preStartBlockHash,
    preStartBlockRuntimeCodeHash: entry.preStartBlockRuntimeCodeHash,
    startBlock: entry.startBlock,
    blockHash: entry.blockHash,
    runtimeCodeHash: entry.runtimeCodeHash,
  }));
}

function commonVerifiedState(provider) {
  const state = structuredClone(provider.verifiedState);
  delete state.providerId;
  delete state.trustDomain;
  return state;
}

function normalizedResultSummary(provider, excludedKeys = []) {
  const excluded = new Set(excludedKeys);
  return provider.inventory.entries
    .filter(({ key }) => !excluded.has(key))
    .map(({ key, method, paramsSha256, normalizedResultSha256 }) => ({
      key,
      method,
      paramsSha256,
      normalizedResultSha256,
    }));
}

export async function buildRobinhoodPostdeploymentInput({
  repositoryRoot,
  revision,
  tree,
  observedAt,
  expiresAt,
  providers,
  l2ProviderReadbacks,
  ethereumProviderReadbacks,
  sourcifyResponses,
  readFile,
  testOnlyDependencies,
}) {
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/u.test(revision)
    || typeof tree !== "string" || !/^[0-9a-f]{40}$/u.test(tree)
    || !Array.isArray(providers) || providers.length !== 2
    || !Array.isArray(l2ProviderReadbacks) || l2ProviderReadbacks.length !== 2
    || !Array.isArray(ethereumProviderReadbacks) || ethereumProviderReadbacks.length !== 2
    || !Array.isArray(sourcifyResponses) || sourcifyResponses.length !== 2) {
    throw new TypeError("postdeployment input builder requires the complete source/provider closure");
  }
  iso(observedAt, "postdeployment input observedAt");
  iso(expiresAt, "postdeployment input expiresAt");
  if ([...l2ProviderReadbacks, ...ethereumProviderReadbacks]
    .some((provider) => provider?.identity?.observedAt !== observedAt)) {
    throw new TypeError("provider observation times must equal the outer capture observation");
  }
  const sourceTargets = [
    {
      contract: "graphFactory",
      address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
      name: "ProgrammableCreate2GraphDeployerV1",
      fullyQualifiedName:
        "src/ProgrammableCreate2GraphDeployerV1.sol:ProgrammableCreate2GraphDeployerV1",
      standardJsonInputPath:
        "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
    },
    {
      contract: "programmableLaunchStampRouter",
      address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
      name: "ProgrammableLaunchStampRouterV1",
      fullyQualifiedName:
        "src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol:ProgrammableLaunchStampRouterV1",
      standardJsonInputPath:
        "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
    },
  ];
  const normalizedSourcify = sourcifyResponses.map((response, index) =>
    normalizeRawSourcify(
      response,
      index,
      repositoryRoot,
      sourceTargets[index],
      readFile,
      observedAt,
    ));
  if (testOnlyDependencies !== undefined && testOnlyDependencies?.allowTestOnly !== true) {
    throw new TypeError("postdeployment input builder test dependencies require allowTestOnly");
  }
  const verifiedL2 = await Promise.all(l2ProviderReadbacks.map((provider, index) =>
    normalizeL2Provider(provider, index, providers[index], testOnlyDependencies ?? {})));
  if (verifiedL2[0].transactionHash !== verifiedL2[1].transactionHash
    || verifiedL2[0].batchNumber !== verifiedL2[1].batchNumber
    || canonicalizeJson(verifiedL2[0].deploymentBlock)
      !== canonicalizeJson(verifiedL2[1].deploymentBlock)
    || canonicalizeJson(commonVerifiedState(verifiedL2[0]))
      !== canonicalizeJson(commonVerifiedState(verifiedL2[1]))
    || canonicalizeJson(externalTransitionSummary(verifiedL2[0]))
      !== canonicalizeJson(externalTransitionSummary(verifiedL2[1]))
    || canonicalizeJson(normalizedResultSummary(verifiedL2[0]))
      !== canonicalizeJson(normalizedResultSummary(verifiedL2[1]))) {
    throw new TypeError("input builder independent L2 providers disagree");
  }
  const verifiedL1 = ethereumProviderReadbacks.map((provider, index) =>
    normalizeL1Provider(provider, index, verifiedL2[0].batchNumber));
  if (canonicalizeJson(verifiedL1[0].postingEvent)
      !== canonicalizeJson(verifiedL1[1].postingEvent)
    || canonicalizeJson(verifiedL1[0].finalizedCheckpoint)
      !== canonicalizeJson(verifiedL1[1].finalizedCheckpoint)
    || canonicalizeJson(normalizedResultSummary(verifiedL1[0]))
      !== canonicalizeJson(normalizedResultSummary(verifiedL1[1]))) {
    throw new TypeError("input builder independent L1 providers disagree");
  }
  const sourceVerificationClosureDigest = framedSha256(
    SOURCIFY_RESPONSE_CLOSURE_DOMAIN,
    normalizedSourcify,
  );
  const sourcePaths = [
    ...sourceTargets.map(({ standardJsonInputPath }) => standardJsonInputPath),
    "contracts/src/ProgrammableCreate2GraphDeployerV1.sol",
    "contracts/src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
  ].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const sourceEntries = await Promise.all(sourcePaths.map(async (relativePath) => {
    const bytes = Buffer.from(await readFile(repositoryRoot, relativePath));
    return {
      path: relativePath,
      byteLength: String(bytes.byteLength),
      sha256: sha256(bytes),
    };
  }));
  const sourceClosure = {
    schemaVersion: "programmable.launch-cli-v4-source-closure.v1",
    repository: ROBINHOOD_PRODUCTION_REPOSITORY,
    repositoryId: ROBINHOOD_PRODUCTION_REPOSITORY_ID,
    branch: "production",
    protectedRef: ROBINHOOD_PRODUCTION_REF,
    revision,
    tree,
    foundationSourceCommitment:
      "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
    entries: sourceEntries,
    sourceVerificationClosureDigest,
    sourceClosureDigest: null,
  };
  sourceClosure.sourceClosureDigest = framedSha256(
    sourceClosure.schemaVersion,
    { ...sourceClosure, sourceClosureDigest: null },
  );
  const inventories = [
    ...l2ProviderReadbacks.map((provider, index) => {
      const identity = verifyProviderIdentity(
        provider.identity,
        "robinhood",
        index,
        `input builder L2 provider ${index}`,
      );
      const entries = normalizeEntries(
        provider.entries,
        L2_ENTRY_ORDER,
        `input builder L2 provider ${index} entries`,
      );
      return normalizeInventory("robinhood", identity, entries);
    }),
    ...ethereumProviderReadbacks.map((provider, index) => {
      const identity = verifyProviderIdentity(
        provider.identity,
        "ethereum",
        index,
        `input builder L1 provider ${index}`,
      );
      const entries = normalizeEntries(
        provider.entries,
        L1_ENTRY_ORDER,
        `input builder L1 provider ${index} entries`,
      );
      return normalizeInventory("ethereum", identity, entries);
    }),
    ...normalizedSourcify.map((entry) => ({
      layer: "sourcify",
      contract: entry.contract,
      normalizedVerificationDigest: entry.normalizedVerificationDigest,
    })),
  ];
  const captureInventoryDigest = framedSha256(
    CAPTURE_INVENTORY_DOMAIN,
    inventories,
  );
  const captureId = computeRobinhoodCaptureId({
    revision,
    tree,
    observedAt,
    captureInventoryDigest,
  });
  const capture = {
    schemaVersion: ROBINHOOD_CAPTURE_SCHEMA,
    captureId,
    observedAt,
    expiresAt,
    profileDigest: ROBINHOOD_CAPTURE_PROFILE_DIGEST,
    sourceOrigin: {
      repository: ROBINHOOD_PRODUCTION_REPOSITORY,
      repositoryId: ROBINHOOD_PRODUCTION_REPOSITORY_ID,
      protectedRef: ROBINHOOD_PRODUCTION_REF,
      revision,
      tree,
      sourceClosureDigest: sourceClosure.sourceClosureDigest,
    },
    l2ProviderReadbacks: structuredClone(l2ProviderReadbacks),
    ethereumProviderReadbacks: structuredClone(ethereumProviderReadbacks),
    sourcifyResponses: structuredClone(normalizedSourcify),
    captureInventoryDigest,
    captureClosureDigest: null,
  };
  capture.captureClosureDigest = computeRobinhoodCaptureClosureDigest(capture);
  return Object.freeze({
    schemaVersion: "programmable.robinhood-custom-launch.postdeployment-input.v3",
    chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
    providers: structuredClone(providers),
    sourceClosure: {
      repository: ROBINHOOD_PRODUCTION_REPOSITORY,
      branch: "production",
      revision,
      tree,
    },
    capture,
  });
}

export const ROBINHOOD_CAPTURE_DIGEST_DOMAINS = Object.freeze({
  authorization: ROBINHOOD_CAPTURE_AUTHORIZATION_SCHEMA,
  captureClosure: ROBINHOOD_CAPTURE_CLOSURE_SCHEMA,
  captureInventory: CAPTURE_INVENTORY_DOMAIN,
  rpcInventory: "programmable.robinhood-custom-launch.rpc-inventory.v3",
  rpcParams: "programmable.robinhood-custom-launch.rpc-params.v1",
  rpcNormalizedResult: "programmable.robinhood-custom-launch.rpc-public-result.v1",
  normalizedL2State: "programmable.robinhood-custom-launch.normalized-l2-state.v1",
  sourcifyResponseClosure:
    SOURCIFY_RESPONSE_CLOSURE_DOMAIN,
  sourcifyNormalizedResponse: SOURCIFY_NORMALIZED_RESPONSE_DOMAIN,
  freshProviderReadbacks:
    "programmable.robinhood-custom-launch.fresh-provider-readbacks.v1",
});

export function sha256CaptureBytes(bytes) {
  return sha256(bytes);
}

export function testOnlyFramedCaptureDigest(domain, value) {
  return framedSha256(domain, value);
}

export function testOnlyHashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
