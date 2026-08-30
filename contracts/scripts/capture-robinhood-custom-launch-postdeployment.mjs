#!/usr/bin/env node

import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  stringToHex,
} from "viem";

import { canonicalizeJson } from "../../packages/launch/src/canonical-json.mjs";
import {
  assertNoSymlinkWritePath,
  atomicCreate,
  resolveInside,
  sha256Digest,
} from "../../packages/launch/src/io.mjs";
import {
  ROBINHOOD_FIND_BATCH_SELECTOR,
  ROBINHOOD_L1_CONFIRMATIONS_SELECTOR,
  ROBINHOOD_NODE_INTERFACE,
  ROBINHOOD_CREATE2_DEPLOYER,
  ROBINHOOD_SOURCIFY_RESPONSE_BYTES,
  ROBINHOOD_CAPTURE_PATH,
  ROBINHOOD_PRODUCTION_REF,
  ROBINHOOD_PRODUCTION_REPOSITORY,
  ROBINHOOD_PRODUCTION_REPOSITORY_ID,
  ROBINHOOD_SEQUENCER_INBOX,
  SEQUENCER_BATCH_DELIVERED_TOPIC,
  buildRobinhoodPostdeploymentInput,
  buildRobinhoodPublicRpcEntry,
  createRobinhoodResponseBudget,
  readRobinhoodBoundedResponse,
  robinhoodRpcResponseLimit,
  validateRobinhoodCredentialedProviderEndpoint,
} from "./robinhood-custom-launch-capture-v2.mjs";

const execFileAsync = promisify(execFile);
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const SAFE = "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06";
const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const SAFE_FALLBACK = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
const SAFE_SENTINEL = "0x0000000000000000000000000000000000000001";
const SAFE_SINGLETON_SLOT = `0x${"0".repeat(64)}`;
const SAFE_FALLBACK_SLOT = keccak256(stringToHex("fallback_manager.handler.address"));
const SAFE_GUARD_SLOT = keccak256(stringToHex("guard_manager.guard.address"));
const ROOTS = Object.freeze({
  programmableLaunchStampRouter: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
  permitAuthority: SAFE,
  graphFactory: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  positionManager: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
  stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
  v4Quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  universalRouter: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
});
const EXTERNAL = Object.freeze({
  poolManager: Object.freeze({
    transactionHash: "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41",
    startBlock: "9070",
  }),
  positionManager: Object.freeze({
    transactionHash: "0x228c18ada6cb46b4fbcc18f4ec1519953415393e256fa8349aafbd5a2db037c8",
    startBlock: "9073",
  }),
  stateView: Object.freeze({
    transactionHash: "0x3d61e2c9eeb482385b1aa436b9e8f812167ea579cc390e4f93bc5abde00582f4",
    startBlock: "9075",
  }),
  v4Quoter: Object.freeze({
    transactionHash: "0x6bf436d72a17f87284ddcab43094689bd320dfb39b535213b9a0b669fabc4ab4",
    startBlock: "9074",
  }),
  universalRouter: Object.freeze({
    transactionHash: "0xdfb76494e158d8dea4376160315239271636a18515207fd4526e574bc7eeb456",
    startBlock: "3347899",
  }),
});
const ROUTER_ABI = Object.freeze([
  { type: "function", name: "PERMIT_AUTHORITY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "PERMIT_AUTHORITY_RUNTIME_CODE_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "GRAPH_FACTORY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "GRAPH_FACTORY_RUNTIME_CODE_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "POOL_MANAGER", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "POOL_MANAGER_RUNTIME_CODE_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "CHAIN_ID", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
]);
const SAFE_ABI = Object.freeze([
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "getModulesPaginated", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "address[]" }, { type: "address" }],
  },
  { type: "function", name: "VERSION", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
]);

function usage() {
  return "Usage: capture-robinhood-custom-launch-postdeployment.mjs capture "
    + "--transaction-hash 0x... --l1-posting-block DECIMAL --output PATH "
    + "[--repository-root PATH]";
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (command !== "capture" || rest.length % 2 !== 0) throw new TypeError(usage());
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (!new Set(["--transaction-hash", "--l1-posting-block", "--output",
      "--repository-root"]).has(flag) || values.has(flag) || !rest[index + 1]) {
      throw new TypeError(usage());
    }
    values.set(flag, rest[index + 1]);
  }
  const transactionHash = values.get("--transaction-hash");
  const postingBlock = values.get("--l1-posting-block");
  if (!/^0x[0-9a-f]{64}$/u.test(transactionHash ?? "")
    || !/^[1-9][0-9]*$/u.test(postingBlock ?? "")
    || !values.has("--output")) throw new TypeError(usage());
  return {
    repositoryRoot: path.resolve(values.get("--repository-root") ?? "."),
    outputPath: path.resolve(values.get("--output")),
    transactionHash,
    postingBlock: BigInt(postingBlock),
  };
}

function framed(domain, value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"), Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function codeHash(value) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value)) {
    throw new TypeError("RPC runtime bytecode is invalid");
  }
  return keccak256(value);
}

function decode(abi, functionName, data) {
  return decodeFunctionResult({ abi, functionName, data });
}

function callParams(target, abi, functionName, args, blockTag) {
  return [{ to: target, data: encodeFunctionData({ abi, functionName, args }) }, blockTag];
}

export function validateRobinhoodCaptureEndpoint(endpoint, layer, providerId) {
  validateRobinhoodCredentialedProviderEndpoint(endpoint, layer, providerId);
  return true;
}

async function rpcEntry(endpoint, key, method, params, id, responseBudget) {
  const request = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }), "utf8");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: Object.freeze({ accept: "application/json", "content-type": "application/json" }),
    body: request,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== 200
    || !/^application\/json(?:;.*)?$/iu.test(response.headers.get("content-type") ?? "")) {
    throw new TypeError(`${key} returned an invalid JSON-RPC envelope`);
  }
  const responseBytes = await readRobinhoodBoundedResponse(response, {
    label: key,
    maximumBytes: robinhoodRpcResponseLimit(method),
    budget: responseBudget,
  });
  return buildRobinhoodPublicRpcEntry({ key, method, params, requestId: id, responseBytes });
}

function inventory(layer, provider, entries) {
  const subject = entries.map((entry) => ({
    key: entry.key,
    method: entry.method,
    paramsSha256: framed("programmable.robinhood-custom-launch.rpc-params.v1", entry.params),
    requestSha256: entry.requestSha256,
    normalizedResultSha256: entry.normalizedResultSha256,
  }));
  return framed("programmable.robinhood-custom-launch.rpc-inventory.v3", subject);
}

async function collectL2(endpoint, providerPin, transactionHash, observedAt, responseBudget) {
  validateRobinhoodCaptureEndpoint(endpoint, "robinhood", providerPin.providerId);
  const identity = { ...providerPin, authentication: "provider-credential", observedAt };
  const entries = [];
  let id = 1;
  const add = async (key, method, params) => {
    const entry = await rpcEntry(endpoint, key, method, params, id++, responseBudget);
    entries.push(entry);
    return entry.result;
  };
  await add("chainId", "eth_chainId", []);
  await add("rawTransaction", "eth_getRawTransactionByHash", [transactionHash]);
  const transaction = await add("transaction", "eth_getTransactionByHash", [transactionHash]);
  const receipt = await add("receipt", "eth_getTransactionReceipt", [transactionHash]);
  if (transaction === null || receipt === null) throw new TypeError("deployment transaction is absent");
  const blockTag = transaction.blockNumber;
  const predecessorTag = quantity(BigInt(blockTag) - 1n);
  const deploymentBlock = await add("deploymentBlock", "eth_getBlockByNumber", [blockTag, false]);
  const predecessorBlock = await add("predecessorBlock", "eth_getBlockByNumber", [predecessorTag, false]);
  const genesisBlock = await add("genesisBlock", "eth_getBlockByNumber", ["0x0", false]);
  const deploymentRef = Object.freeze({
    blockHash: deploymentBlock.hash, requireCanonical: true,
  });
  const predecessorRef = Object.freeze({
    blockHash: predecessorBlock.hash, requireCanonical: true,
  });
  const genesisRef = Object.freeze({ blockHash: genesisBlock.hash, requireCanonical: true });
  const codes = new Map();
  const getCode = async (key, address, tag) => {
    const value = await add(key, "eth_getCode", [address, tag]);
    codes.set(key, value);
    return value;
  };
  await getCode("multicall3Code", MULTICALL3, deploymentRef);
  await getCode("prePermitAuthorityCode", ROOTS.permitAuthority, predecessorRef);
  await getCode("preGraphFactoryCode", ROOTS.graphFactory, predecessorRef);
  await getCode("preRouterCode", ROOTS.programmableLaunchStampRouter, predecessorRef);
  await getCode("permitAuthorityCode", ROOTS.permitAuthority, deploymentRef);
  await getCode("graphFactoryCode", ROOTS.graphFactory, deploymentRef);
  await getCode("routerCode", ROOTS.programmableLaunchStampRouter, deploymentRef);
  await getCode("safeSingletonCode", SAFE_SINGLETON, deploymentRef);
  await getCode("safeFallbackHandlerCode", SAFE_FALLBACK, deploymentRef);
  await getCode("permit2GenesisCode", ROOTS.permit2, genesisRef);
  const externalRaw = {};
  for (const [contract, pin] of Object.entries(EXTERNAL)) {
    const title = `${contract[0].toUpperCase()}${contract.slice(1)}`;
    const startTag = quantity(pin.startBlock);
    const predecessorStartTag = quantity(BigInt(pin.startBlock) - 1n);
    const externalRawEntryIndex = entries.length;
    const externalRawTransaction = await add(`${contract}RawTransaction`,
      "eth_getRawTransactionByHash", [pin.transactionHash]);
    const externalTransaction = await add(`${contract}Transaction`,
      "eth_getTransactionByHash", [pin.transactionHash]);
    const externalReceipt = await add(`${contract}Receipt`, "eth_getTransactionReceipt", [
      pin.transactionHash,
    ]);
    if (externalTransaction === null || externalReceipt === null) {
      throw new TypeError(`${contract} deployment transaction/receipt is absent`);
    }
    const externalBlock = await add(`${contract}Block`, "eth_getBlockByNumber", [startTag, false]);
    const externalPredecessorBlock = await add(`${contract}PredecessorBlock`,
      "eth_getBlockByNumber", [predecessorStartTag, false]);
    const externalRef = Object.freeze({
      blockHash: externalBlock.hash, requireCanonical: true,
    });
    const externalPredecessorRef = Object.freeze({
      blockHash: externalPredecessorBlock.hash, requireCanonical: true,
    });
    await getCode(`${contract}Create2DeployerCode`, ROBINHOOD_CREATE2_DEPLOYER, externalRef);
    await getCode(`pre${title}Code`, ROOTS[contract], externalPredecessorRef);
    await getCode(`${contract}Code`, ROOTS[contract], externalRef);
    externalRaw[contract] = {
      rawTransaction: externalRawTransaction,
      transaction: externalTransaction,
      receipt: externalReceipt,
      block: externalBlock,
      predecessorBlock: externalPredecessorBlock,
      rawTransactionDigest: entries[externalRawEntryIndex].normalizedResultSha256,
      transactionDigest: entries[externalRawEntryIndex + 1].normalizedResultSha256,
      receiptDigest: entries[externalRawEntryIndex + 2].normalizedResultSha256,
    };
  }
  const routerResults = {};
  for (const name of ["PERMIT_AUTHORITY", "PERMIT_AUTHORITY_RUNTIME_CODE_HASH", "GRAPH_FACTORY",
    "GRAPH_FACTORY_RUNTIME_CODE_HASH", "POOL_MANAGER", "POOL_MANAGER_RUNTIME_CODE_HASH",
    "CHAIN_ID"]) {
    const key = `router${name.toLowerCase().split("_").map((part) =>
      `${part[0].toUpperCase()}${part.slice(1)}`).join("")}`;
    const canonicalKey = {
      routerPermitAuthority: "routerPermitAuthority",
      routerPermitAuthorityRuntimeCodeHash: "routerPermitAuthorityCodeHash",
      routerGraphFactory: "routerGraphFactory",
      routerGraphFactoryRuntimeCodeHash: "routerGraphFactoryCodeHash",
      routerPoolManager: "routerPoolManager",
      routerPoolManagerRuntimeCodeHash: "routerPoolManagerCodeHash",
      routerChainId: "routerChainId",
    }[key];
    const result = await add(canonicalKey, "eth_call", callParams(
      ROOTS.programmableLaunchStampRouter, ROUTER_ABI, name, [], deploymentRef,
    ));
    routerResults[name] = decode(ROUTER_ABI, name, result);
  }
  const owners = decode(SAFE_ABI, "getOwners", await add("safeOwners", "eth_call",
    callParams(SAFE, SAFE_ABI, "getOwners", [], deploymentRef)));
  const threshold = decode(SAFE_ABI, "getThreshold", await add("safeThreshold", "eth_call",
    callParams(SAFE, SAFE_ABI, "getThreshold", [], deploymentRef)));
  const nonce = decode(SAFE_ABI, "nonce", await add("safeNonce", "eth_call",
    callParams(SAFE, SAFE_ABI, "nonce", [], deploymentRef)));
  const [modules, modulesNext] = decode(SAFE_ABI, "getModulesPaginated",
    await add("safeModules", "eth_call", callParams(
      SAFE, SAFE_ABI, "getModulesPaginated", [SAFE_SENTINEL, 16n], deploymentRef,
    )));
  const safeVersion = decode(SAFE_ABI, "VERSION", await add("safeVersion", "eth_call",
    callParams(SAFE, SAFE_ABI, "VERSION", [], deploymentRef)));
  const singletonSlot = await add("safeSingletonSlot", "eth_getStorageAt",
    [SAFE, SAFE_SINGLETON_SLOT, deploymentRef]);
  const fallbackHandlerSlot = await add("safeFallbackHandlerSlot", "eth_getStorageAt",
    [SAFE, SAFE_FALLBACK_SLOT, deploymentRef]);
  const guardSlot = await add("safeGuardSlot", "eth_getStorageAt",
    [SAFE, SAFE_GUARD_SLOT, deploymentRef]);
  const batchWord = await add("findBatchContainingBlock", "eth_call", [{
    to: ROBINHOOD_NODE_INTERFACE,
    data: `${ROBINHOOD_FIND_BATCH_SELECTOR}${BigInt(blockTag).toString(16).padStart(64, "0")}`,
  }, deploymentRef]);
  await add("getL1Confirmations", "eth_call", [{
    to: ROBINHOOD_NODE_INTERFACE,
    data: `${ROBINHOOD_L1_CONFIRMATIONS_SELECTOR}${deploymentBlock.hash.slice(2)}`,
  }, deploymentRef]);
  const receiptLogs = receipt.logs.map((log) => ({
    address: getAddress(log.address), topics: [...log.topics], data: log.data,
    logIndex: BigInt(log.logIndex).toString(10),
  }));
  const atomic = [
    ["permitAuthority", "permitAuthorityCode"],
    ["graphFactory", "graphFactoryCode"],
    ["programmableLaunchStampRouter", "routerCode"],
  ].map(([contract, codeKey]) => ({
    contract,
    address: ROOTS[contract],
    preDeploymentBlockNumber: BigInt(predecessorTag).toString(10),
    preDeploymentBlockHash: predecessorBlock.hash,
    preDeploymentRuntimeCodeHash: codeHash("0x"),
    deploymentBlockNumber: BigInt(blockTag).toString(10),
    deploymentBlockHash: deploymentBlock.hash,
    deploymentRuntimeCodeHash: codeHash(codes.get(codeKey)),
  }));
  const normalized = {
    providerId: providerPin.providerId,
    trustDomain: providerPin.trustDomain,
    transaction: {
      hash: transactionHash,
      from: getAddress(transaction.from),
      to: getAddress(transaction.to),
      valueWei: BigInt(transaction.value).toString(10),
      selector: transaction.input.slice(0, 10),
      calldataHash: keccak256(transaction.input),
      calldataBytes: transaction.input.length / 2 - 1,
      nonce: BigInt(transaction.nonce).toString(10),
      transactionIndex: BigInt(transaction.transactionIndex).toString(10),
      blockNumber: BigInt(transaction.blockNumber).toString(10),
      blockHash: transaction.blockHash,
    },
    receipt: {
      transactionHash: receipt.transactionHash,
      from: getAddress(receipt.from),
      to: getAddress(receipt.to),
      status: BigInt(receipt.status).toString(10),
      transactionIndex: BigInt(receipt.transactionIndex).toString(10),
      blockNumber: BigInt(receipt.blockNumber).toString(10),
      blockHash: receipt.blockHash,
      logs: receiptLogs,
    },
    multicall3: { address: MULTICALL3, runtimeCodeHash: codeHash(codes.get("multicall3Code")) },
    atomicRoots: atomic,
    routerState: {
      address: ROOTS.programmableLaunchStampRouter,
      runtimeCodeHash: codeHash(codes.get("routerCode")),
      chainId: routerResults.CHAIN_ID.toString(10),
      permitAuthority: getAddress(routerResults.PERMIT_AUTHORITY),
      permitAuthorityRuntimeCodeHash: routerResults.PERMIT_AUTHORITY_RUNTIME_CODE_HASH,
      graphFactory: getAddress(routerResults.GRAPH_FACTORY),
      graphFactoryRuntimeCodeHash: routerResults.GRAPH_FACTORY_RUNTIME_CODE_HASH,
      poolManager: getAddress(routerResults.POOL_MANAGER),
      poolManagerRuntimeCodeHash: routerResults.POOL_MANAGER_RUNTIME_CODE_HASH,
    },
    safeState: {
      blockNumber: BigInt(blockTag).toString(10), blockHash: deploymentBlock.hash,
      proxyAddress: SAFE, proxyRuntimeCodeHash: codeHash(codes.get("permitAuthorityCode")),
      singleton: { address: SAFE_SINGLETON,
        runtimeCodeHash: codeHash(codes.get("safeSingletonCode")), version: safeVersion },
      fallbackHandler: SAFE_FALLBACK,
      fallbackHandlerRuntimeCodeHash: codeHash(codes.get("safeFallbackHandlerCode")),
      owners: owners.map(getAddress), threshold: Number(threshold), nonce: nonce.toString(10),
      modules: modules.map(getAddress), modulesNext: getAddress(modulesNext), guard: null,
      singletonSlot, fallbackHandlerSlot, guardSlot,
    },
    permit2Genesis: {
      address: ROOTS.permit2, blockNumber: "0", blockHash: genesisBlock.hash,
      runtimeCodeHash: codeHash(codes.get("permit2GenesisCode")),
      runtimeCodeBytes: codes.get("permit2GenesisCode").length / 2 - 1,
    },
    externalRoots: Object.entries(EXTERNAL).map(([contract, pin]) => ({
      contract, address: ROOTS[contract],
      preStartBlockNumber: (BigInt(pin.startBlock) - 1n).toString(10),
      preStartBlockHash: externalRaw[contract].predecessorBlock.hash,
      preStartBlockRuntimeCodeHash: codeHash("0x"),
      runtimeCodeHash: codeHash(codes.get(`${contract}Code`)),
      transactionHash: pin.transactionHash,
      rawTransactionDigest: externalRaw[contract].rawTransactionDigest,
      transactionDigest: externalRaw[contract].transactionDigest,
      startBlock: pin.startBlock,
      blockHash: externalRaw[contract].block.hash,
      transactionReceiptDigest: externalRaw[contract].receiptDigest,
    })),
  };
  return {
    normalized,
    batchNumber: BigInt(batchWord).toString(10),
    readback: {
      identity,
      entries: structuredClone(entries),
      inventoryDigest: inventory("robinhood", identity, entries),
      normalizedStateDigest: framed(
        "programmable.robinhood-custom-launch.normalized-l2-state.v1", normalized,
      ),
    },
  };
}

async function collectL1(endpoint, providerPin, batchNumber, postingBlock, observedAt,
  responseBudget) {
  validateRobinhoodCaptureEndpoint(endpoint, "ethereum", providerPin.providerId);
  const identity = { ...providerPin, authentication: "provider-credential", observedAt };
  const entries = [];
  let id = 1;
  const add = async (key, method, params) => {
    const entry = await rpcEntry(endpoint, key, method, params, id++, responseBudget);
    entries.push(entry);
    return entry.result;
  };
  await add("chainId", "eth_chainId", []);
  const batchTopic = `0x${BigInt(batchNumber).toString(16).padStart(64, "0")}`;
  const blockTag = quantity(postingBlock);
  const logs = await add("postingLogs", "eth_getLogs", [{
    address: ROBINHOOD_SEQUENCER_INBOX,
    fromBlock: blockTag,
    toBlock: blockTag,
    topics: [SEQUENCER_BATCH_DELIVERED_TOPIC, batchTopic],
  }]);
  if (!Array.isArray(logs) || logs.length !== 1) {
    throw new TypeError("exactly one pinned SequencerInbox posting log is required");
  }
  const receipt = await add("postingReceipt", "eth_getTransactionReceipt",
    [logs[0].transactionHash]);
  await add("postingBlock", "eth_getBlockByHash", [receipt.blockHash, false]);
  await add("finalizedTag", "eth_getBlockByNumber", ["finalized", false]);
  await add("finalizedReread", "eth_getBlockByNumber", ["finalized", false]);
  return {
    identity,
    entries: structuredClone(entries),
    inventoryDigest: inventory("ethereum", identity, entries),
  };
}

async function sourcify(contract, address, responseBudget) {
  const urlPath = `/server/v2/contract/4663/${address}?fields=all`;
  const response = await fetch(`https://sourcify.dev${urlPath}`, {
    method: "GET", headers: Object.freeze({ accept: "application/json" }),
    redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== 200
    || !/^application\/json(?:;.*)?$/iu.test(response.headers.get("content-type") ?? "")) {
    throw new TypeError(`${contract} returned an invalid Sourcify V2 response`);
  }
  const bytes = await readRobinhoodBoundedResponse(response, {
    label: `${contract} Sourcify`,
    maximumBytes: ROBINHOOD_SOURCIFY_RESPONSE_BYTES,
    budget: responseBudget,
  });
  return {
    contract,
    urlPath,
    httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "",
    responseBase64: bytes.toString("base64"),
    responseSha256: sha256Digest(bytes),
  };
}

async function git(repositoryRoot, args) {
  const result = await execFileAsync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000,
  });
  if (result.stderr.length !== 0) throw new TypeError("capture source Git audit returned diagnostics");
  return result.stdout.trim();
}

async function protectedSource(repositoryRoot) {
  const [revision, tree, origin, status, remote] = await Promise.all([
    git(repositoryRoot, ["rev-parse", "HEAD^{commit}"]),
    git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]),
    git(repositoryRoot, ["rev-parse", "refs/remotes/origin/production^{commit}"]),
    git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(repositoryRoot, ["remote", "get-url", "origin"]),
  ]);
  const expected = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: ROBINHOOD_PRODUCTION_REPOSITORY,
    GITHUB_REPOSITORY_ID: ROBINHOOD_PRODUCTION_REPOSITORY_ID,
    GITHUB_REF: ROBINHOOD_PRODUCTION_REF,
    GITHUB_REF_PROTECTED: "true",
    GITHUB_SHA: revision,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (process.env[key] !== value) throw new TypeError(`capture requires protected ${key}`);
  }
  const detached = await execFileAsync("git", ["-C", repositoryRoot, "symbolic-ref", "-q", "HEAD"], {
    encoding: "utf8", timeout: 30_000,
  }).then(() => false).catch((error) => error?.code === 1);
  if (!detached || origin !== revision || status !== ""
    || remote !== "https://github.com/programmablehq/PROGRAMMABLE") {
    throw new TypeError("capture requires clean detached canonical origin/production");
  }
  return { revision, tree };
}

async function safeOutput(repositoryRoot, outputPath) {
  const root = await realpath(repositoryRoot);
  const canonical = path.join(root, ROBINHOOD_CAPTURE_PATH);
  if (outputPath.startsWith(`${root}${path.sep}`)) {
    if (outputPath !== canonical) throw new TypeError("in-repository capture output must be canonical");
    await assertNoSymlinkWritePath(root, outputPath, "capture output");
    return outputPath;
  }
  const parent = await realpath(path.dirname(outputPath));
  if (path.join(parent, path.basename(outputPath)) !== outputPath) {
    throw new TypeError("capture output contains a symbolic-link parent");
  }
  try {
    const metadata = await lstat(outputPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new TypeError("capture output target is not a regular file");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return outputPath;
}

export async function captureRobinhoodPostdeployment(options) {
  const source = await protectedSource(options.repositoryRoot);
  const endpoints = {
    l2: [process.env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY,
      process.env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY],
    l1: [process.env.ETHEREUM_MAINNET_RPC_URL_PRIMARY,
      process.env.ETHEREUM_MAINNET_RPC_URL_SECONDARY],
  };
  if ([...endpoints.l2, ...endpoints.l1].some((value) => !value)) {
    throw new TypeError("capture requires four protected provider endpoints");
  }
  validateRobinhoodCaptureEndpoint(endpoints.l2[0], "robinhood", "drpc");
  validateRobinhoodCaptureEndpoint(endpoints.l2[1], "robinhood", "alchemy");
  validateRobinhoodCaptureEndpoint(endpoints.l1[0], "ethereum", "drpc");
  validateRobinhoodCaptureEndpoint(endpoints.l1[1], "ethereum", "quicknode");
  const observed = new Date();
  const observedAt = observed.toISOString();
  const expiresAt = new Date(observed.getTime() + 15 * 60 * 1000).toISOString();
  const responseBudget = createRobinhoodResponseBudget();
  const l2 = await Promise.all([
    collectL2(endpoints.l2[0], { role: "primary", providerId: "drpc",
      trustDomain: "drpc.org" }, options.transactionHash, observedAt, responseBudget),
    collectL2(endpoints.l2[1], { role: "secondary", providerId: "alchemy",
      trustDomain: "alchemy.com" }, options.transactionHash, observedAt, responseBudget),
  ]);
  if (l2[0].batchNumber !== l2[1].batchNumber) {
    throw new TypeError("independent L2 providers disagree on Nitro batch");
  }
  const l1 = await Promise.all([
    collectL1(endpoints.l1[0], { role: "primary", providerId: "drpc",
      trustDomain: "drpc.org" }, l2[0].batchNumber, options.postingBlock, observedAt,
    responseBudget),
    collectL1(endpoints.l1[1], { role: "secondary", providerId: "quicknode",
      trustDomain: "quicknode.com" }, l2[0].batchNumber, options.postingBlock, observedAt,
    responseBudget),
  ]);
  const sourcifyResponses = await Promise.all([
    sourcify("graphFactory", ROOTS.graphFactory, responseBudget),
    sourcify("programmableLaunchStampRouter", ROOTS.programmableLaunchStampRouter,
      responseBudget),
  ]);
  const input = await buildRobinhoodPostdeploymentInput({
    repositoryRoot: options.repositoryRoot,
    revision: source.revision,
    tree: source.tree,
    observedAt,
    expiresAt,
    providers: l2.map(({ normalized }) => normalized),
    l2ProviderReadbacks: l2.map(({ readback }) => readback),
    ethereumProviderReadbacks: l1,
    sourcifyResponses,
    readFile: (root, relativePath) => readFile(resolveInside(root, relativePath)),
  });
  const bytes = Buffer.from(`${JSON.stringify(input, null, 2)}\n`, "utf8");
  const outputPath = await safeOutput(options.repositoryRoot, options.outputPath);
  await atomicCreate(outputPath, bytes, 0o600);
  return Object.freeze({
    schemaVersion: input.schemaVersion,
    outputPath,
    outputSha256: sha256Digest(bytes),
    captureId: input.capture.captureId,
    observedAt,
    expiresAt,
    sourceRevision: source.revision,
    sourceTree: source.tree,
    wroteNetworkState: false,
  });
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) {
  try {
    const result = await captureRobinhoodPostdeployment(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
