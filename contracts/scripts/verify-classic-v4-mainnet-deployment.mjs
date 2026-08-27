#!/usr/bin/env node

import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
} from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_EXPECTED_CTO_AUTHORITY_OWNER,
  CLASSIC_V4_FINALITY_CONFIRMATIONS,
  CLASSIC_V4_LAUNCHER_FEE_RECIPIENT,
  CLASSIC_V4_NEW_CONTRACTS,
  CLASSIC_V4_OFFICIAL_DEPENDENCIES,
  CLASSIC_V4_SHARED_DEPENDENCIES,
  canonicalAddress,
  digestJson,
  normalizeHex,
  normalizeRuntimeImmutables,
  validateClassicV4DeploymentEvidence,
  validateClassicV4PreparationPlan,
} from "../../scripts/classic-v4-release-core.mjs";
import { loadClassicV4SealedBuild } from "./prepare-classic-v4-mainnet-release.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const DEFAULT_RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];
const REQUEST_TIMEOUT_MS = 15_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UINT256_MAX = (1n << 256n) - 1n;

const hookFactoryAbi = parseAbi([
  "function ALL_HOOK_MASK() view returns (uint160)",
  "function REQUIRED_HOOK_FLAGS() view returns (uint160)",
  "function isFactoryHook(address hook) view returns (bool)",
]);
const hookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function MIN_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function MAX_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function TOTAL_SWAP_FEE_STEP_BPS() view returns (uint16)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
]);
const plannerAbi = parseAbi([
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function INITIAL_TICK() view returns (int24)",
  "function LIQUIDITY_TICK_LOWER() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
]);
const launcherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function rewardVaultFactory() view returns (address)",
  "function initialBuyVestingWalletFactory() view returns (address)",
  "function launchPolicy() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function INITIAL_TICK() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
  "function LP_FEE_PIPS() view returns (uint24)",
]);
const ctoAuthorityAbi = parseAbi([
  "function authority() view returns (address)",
  "function pendingAuthority() view returns (address)",
]);
const rewardFactoryAbi = parseAbi([
  "function ctoAuthority() view returns (address)",
]);
const custodyFactoryAbi = parseAbi([
  "function MIN_DURATION_DAYS() view returns (uint16)",
  "function MAX_DURATION_DAYS() view returns (uint16)",
]);
const launchPolicyAbi = parseAbi([
  "function MAX_REWARD_BENEFICIARIES() view returns (uint256)",
  "function REWARD_SHARE_BASIS_POINTS() view returns (uint16)",
]);
const forwarderFactoryAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function OPERATOR() view returns (address)",
  "function TIMELOCK_BLOCK() view returns (uint256)",
]);

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const forbidden = argv.find(
    (argument) =>
      argument === "--broadcast" ||
      argument === "--private-key" ||
      argument.startsWith("--private-key=") ||
      argument === "--mnemonic" ||
      argument.startsWith("--mnemonic="),
  );
  if (forbidden) {
    fail(`${forbidden.split("=", 1)[0]} is forbidden; verifier is read-only`);
  }
  const parsed = {
    plan: null,
    transactions: null,
    verificationBlock: null,
    rpcA: process.env.CLASSIC_V4_RPC_A ?? DEFAULT_RPC_ENDPOINTS[0],
    rpcB: process.env.CLASSIC_V4_RPC_B ?? DEFAULT_RPC_ENDPOINTS[1],
    write: false,
    output: null,
    wallet: null,
    acknowledgement: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      parsed.write = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? null : argument.slice(separator + 1);
    const known = [
      "--plan",
      "--transactions",
      "--verification-block",
      "--rpc-a",
      "--rpc-b",
      "--output",
      "--wallet",
      "--acknowledge-evidence-digest",
    ];
    if (!known.includes(key)) fail(`Unknown argument: ${key}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--plan") parsed.plan = value;
    if (key === "--transactions") parsed.transactions = value;
    if (key === "--verification-block") {
      parsed.verificationBlock = Number(value);
    }
    if (key === "--rpc-a") parsed.rpcA = value;
    if (key === "--rpc-b") parsed.rpcB = value;
    if (key === "--output") parsed.output = value;
    if (key === "--wallet") parsed.wallet = value;
    if (key === "--acknowledge-evidence-digest") {
      parsed.acknowledgement = value;
    }
  }
  for (const key of ["plan", "transactions"]) {
    if (!parsed[key] || !path.isAbsolute(parsed[key])) {
      fail(`--${key} must be an absolute path`);
    }
  }
  if (
    !Number.isSafeInteger(parsed.verificationBlock) ||
    parsed.verificationBlock <= 0
  ) {
    fail("--verification-block must be a positive integer");
  }
  return parsed;
}

function assertEndpoints(endpoints) {
  const hostnames = new Set();
  for (const endpoint of endpoints) {
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch {
      fail("Invalid RPC URL");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      fail("RPC URLs must be credential-free HTTPS URLs");
    }
    hostnames.add(parsed.hostname.toLowerCase());
  }
  if (hostnames.size !== endpoints.length) {
    fail("Two independent RPC hostnames are required");
  }
}

async function rpc(endpoint, method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) fail(`RPC ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) fail(`RPC ${method} failed: ${payload.error.message}`);
  if (payload?.result === undefined) fail(`RPC ${method} returned no result`);
  return payload.result;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

function addressResult(value) {
  return encodeAbiParameters([{ type: "address" }], [value]);
}

function uintResult(value, type = "uint256") {
  return encodeAbiParameters([{ type }], [BigInt(value)]);
}

function intResult(value, type = "int256") {
  return encodeAbiParameters([{ type }], [BigInt(value)]);
}

function boolResult(value) {
  return encodeAbiParameters([{ type: "bool" }], [value]);
}

function callCheck(label, target, abi, functionName, expected, args = []) {
  return {
    label,
    target,
    data: encodeFunctionData({ abi, functionName, args }),
    expected,
  };
}

function runtimeBindingChecks(plan) {
  const address = plan.predictedAddresses;
  const shared = CLASSIC_V4_SHARED_DEPENDENCIES;
  const official = CLASSIC_V4_OFFICIAL_DEPENDENCIES;
  return [
    callCheck(
      "factory hook mask",
      address.hookFactory,
      hookFactoryAbi,
      "ALL_HOOK_MASK",
      uintResult(16_383, "uint160"),
    ),
    callCheck(
      "factory required flags",
      address.hookFactory,
      hookFactoryAbi,
      "REQUIRED_HOOK_FLAGS",
      uintResult(8_396, "uint160"),
    ),
    callCheck(
      "factory hook provenance",
      address.hookFactory,
      hookFactoryAbi,
      "isFactoryHook",
      boolResult(true),
      [address.feeHook],
    ),
    callCheck(
      "hook PoolManager",
      address.feeHook,
      hookAbi,
      "poolManager",
      addressResult(official.poolManager.address),
    ),
    callCheck(
      "hook treasury",
      address.feeHook,
      hookAbi,
      "launcherFeeRecipient",
      addressResult(CLASSIC_V4_LAUNCHER_FEE_RECIPIENT),
    ),
    callCheck(
      "hook reward factory",
      address.feeHook,
      hookAbi,
      "feeSplitVaultFactory",
      addressResult(shared.rewardVaultFactory.address),
    ),
    callCheck(
      "hook launcher fee",
      address.feeHook,
      hookAbi,
      "LAUNCHER_FEE_BPS",
      uintResult(10, "uint16"),
    ),
    callCheck(
      "hook minimum fee",
      address.feeHook,
      hookAbi,
      "MIN_TOTAL_SWAP_FEE_BPS",
      uintResult(10, "uint16"),
    ),
    callCheck(
      "hook maximum fee",
      address.feeHook,
      hookAbi,
      "MAX_TOTAL_SWAP_FEE_BPS",
      uintResult(1_000, "uint16"),
    ),
    callCheck(
      "hook fee step",
      address.feeHook,
      hookAbi,
      "TOTAL_SWAP_FEE_STEP_BPS",
      uintResult(10, "uint16"),
    ),
    callCheck(
      "hook transfer tax",
      address.feeHook,
      hookAbi,
      "TRANSFER_TAX_BPS",
      uintResult(0, "uint16"),
    ),
    callCheck(
      "hook LP fee",
      address.feeHook,
      hookAbi,
      "LP_FEE_PIPS",
      uintResult(0, "uint24"),
    ),
    callCheck(
      "hook tick spacing",
      address.feeHook,
      hookAbi,
      "TICK_SPACING",
      intResult(200, "int24"),
    ),
    callCheck(
      "planner token supply",
      address.positionPlanner,
      plannerAbi,
      "TOKEN_SUPPLY",
      uintResult(1_000_000_000n * 10n ** 18n),
    ),
    callCheck(
      "planner initial tick",
      address.positionPlanner,
      plannerAbi,
      "INITIAL_TICK",
      intResult(204_200, "int24"),
    ),
    callCheck(
      "planner canonical liquidity lower tick",
      address.positionPlanner,
      plannerAbi,
      "LIQUIDITY_TICK_LOWER",
      intResult(174_800, "int24"),
    ),
    callCheck(
      "planner tick spacing",
      address.positionPlanner,
      plannerAbi,
      "TICK_SPACING",
      intResult(200, "int24"),
    ),
    callCheck(
      "launcher PoolManager",
      address.launcher,
      launcherAbi,
      "poolManager",
      addressResult(official.poolManager.address),
    ),
    callCheck(
      "launcher PositionManager",
      address.launcher,
      launcherAbi,
      "positionManager",
      addressResult(official.positionManager.address),
    ),
    callCheck(
      "launcher token factory",
      address.launcher,
      launcherAbi,
      "tokenFactory",
      addressResult(official.uerc20Factory.address),
    ),
    callCheck(
      "launcher hook",
      address.launcher,
      launcherAbi,
      "feeHook",
      addressResult(address.feeHook),
    ),
    callCheck(
      "launcher planner",
      address.launcher,
      launcherAbi,
      "positionPlanner",
      addressResult(address.positionPlanner),
    ),
    callCheck(
      "launcher reward factory",
      address.launcher,
      launcherAbi,
      "rewardVaultFactory",
      addressResult(shared.rewardVaultFactory.address),
    ),
    callCheck(
      "launcher custody factory",
      address.launcher,
      launcherAbi,
      "initialBuyVestingWalletFactory",
      addressResult(shared.initialBuyVestingWalletFactory.address),
    ),
    callCheck(
      "launcher policy",
      address.launcher,
      launcherAbi,
      "launchPolicy",
      addressResult(shared.launchPolicy.address),
    ),
    callCheck(
      "launcher forwarder factory",
      address.launcher,
      launcherAbi,
      "positionForwarderFactory",
      addressResult(shared.positionForwarderFactory.address),
    ),
    callCheck(
      "launcher minimum buy",
      address.launcher,
      launcherAbi,
      "MIN_INITIAL_BUY_WEI",
      uintResult(600_000_000_000_000n),
    ),
    callCheck(
      "launcher token supply",
      address.launcher,
      launcherAbi,
      "TOKEN_SUPPLY",
      uintResult(1_000_000_000n * 10n ** 18n),
    ),
    callCheck(
      "launcher initial tick",
      address.launcher,
      launcherAbi,
      "INITIAL_TICK",
      intResult(204_200, "int24"),
    ),
    callCheck(
      "launcher tick spacing",
      address.launcher,
      launcherAbi,
      "TICK_SPACING",
      intResult(200, "int24"),
    ),
    callCheck(
      "launcher LP fee",
      address.launcher,
      launcherAbi,
      "LP_FEE_PIPS",
      uintResult(0, "uint24"),
    ),
    callCheck(
      "shared CTO owner",
      shared.ctoAuthority.address,
      ctoAuthorityAbi,
      "authority",
      addressResult(CLASSIC_V4_EXPECTED_CTO_AUTHORITY_OWNER),
    ),
    callCheck(
      "shared CTO pending owner",
      shared.ctoAuthority.address,
      ctoAuthorityAbi,
      "pendingAuthority",
      addressResult(ZERO_ADDRESS),
    ),
    callCheck(
      "shared reward factory",
      shared.rewardVaultFactory.address,
      rewardFactoryAbi,
      "ctoAuthority",
      addressResult(shared.ctoAuthority.address),
    ),
    callCheck(
      "shared custody minimum",
      shared.initialBuyVestingWalletFactory.address,
      custodyFactoryAbi,
      "MIN_DURATION_DAYS",
      uintResult(1, "uint16"),
    ),
    callCheck(
      "shared custody maximum",
      shared.initialBuyVestingWalletFactory.address,
      custodyFactoryAbi,
      "MAX_DURATION_DAYS",
      uintResult(3_650, "uint16"),
    ),
    callCheck(
      "shared maximum beneficiaries",
      shared.launchPolicy.address,
      launchPolicyAbi,
      "MAX_REWARD_BENEFICIARIES",
      uintResult(5),
    ),
    callCheck(
      "shared reward shares",
      shared.launchPolicy.address,
      launchPolicyAbi,
      "REWARD_SHARE_BASIS_POINTS",
      uintResult(10_000, "uint16"),
    ),
    callCheck(
      "shared forwarder manager",
      shared.positionForwarderFactory.address,
      forwarderFactoryAbi,
      "positionManager",
      addressResult(official.positionManager.address),
    ),
    callCheck(
      "shared forwarder operator",
      shared.positionForwarderFactory.address,
      forwarderFactoryAbi,
      "OPERATOR",
      addressResult(ZERO_ADDRESS),
    ),
    callCheck(
      "shared forwarder timelock",
      shared.positionForwarderFactory.address,
      forwarderFactoryAbi,
      "TIMELOCK_BLOCK",
      uintResult(UINT256_MAX),
    ),
  ];
}

function assertTransactionInputFile(value) {
  const keys = Object.keys(value ?? {}).sort();
  const expected = [...CLASSIC_V4_NEW_CONTRACTS].sort();
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index])
  ) {
    fail(
      "Transaction hash file must contain exactly the four Classic V4 contracts",
    );
  }
  const hashes = new Set();
  for (const [name, hash] of Object.entries(value)) {
    if (!/^0x[0-9a-f]{64}$/i.test(hash))
      fail(`Invalid ${name} transaction hash`);
    const normalized = hash.toLowerCase();
    if (BigInt(normalized) === 0n) fail(`Invalid ${name} transaction hash`);
    if (hashes.has(normalized)) {
      fail("Deployment transaction hashes must be unique");
    }
    hashes.add(normalized);
  }
}

export function assertClassicV4DeploymentBlockBinding({
  transaction,
  receipt,
  block,
  blockNumber,
  label,
}) {
  if (
    !block?.number ||
    !block?.hash ||
    Number(BigInt(block.number)) !== blockNumber ||
    Number(BigInt(transaction?.blockNumber ?? -1)) !== blockNumber ||
    Number(BigInt(receipt?.blockNumber ?? -1)) !== blockNumber ||
    normalizeHex(transaction?.blockHash) !== normalizeHex(block.hash) ||
    normalizeHex(receipt?.blockHash) !== normalizeHex(block.hash)
  ) {
    fail(`${label} transaction or receipt block binding differs`);
  }
}

async function verifyAtEndpoint(
  endpoint,
  plan,
  txHashes,
  verificationBlock,
  artifacts,
  rpcClient,
) {
  const blockTag = `0x${verificationBlock.toString(16)}`;
  const observedBlockTag = `0x${plan.observedAtBlock.toString(16)}`;
  const [chainId, verificationHead, observedHead] = await Promise.all([
    rpcClient(endpoint, "eth_chainId"),
    rpcClient(endpoint, "eth_getBlockByNumber", [blockTag, false]),
    rpcClient(endpoint, "eth_getBlockByNumber", [observedBlockTag, false]),
  ]);
  if (normalizeHex(chainId) !== "0x1") fail("RPC is not Ethereum Mainnet");
  if (
    !verificationHead?.hash ||
    !verificationHead?.timestamp ||
    !verificationHead?.number ||
    Number(BigInt(verificationHead.number)) !== verificationBlock
  ) {
    fail("Verification block is unavailable");
  }
  if (
    !observedHead?.hash ||
    !observedHead?.number ||
    Number(BigInt(observedHead.number)) !== plan.observedAtBlock ||
    normalizeHex(observedHead.hash) !== normalizeHex(plan.observedAtBlockHash)
  ) {
    fail("Plan observed block hash differs from the canonical chain");
  }
  for (const [name, expected] of [
    ...Object.entries(CLASSIC_V4_OFFICIAL_DEPENDENCIES),
    ...Object.entries(CLASSIC_V4_SHARED_DEPENDENCIES),
  ]) {
    const code = await rpcClient(endpoint, "eth_getCode", [
      expected.address,
      blockTag,
    ]);
    if (
      code === "0x" ||
      normalizeHex(keccak256(code)) !== normalizeHex(expected.runtimeCodeHash)
    ) {
      fail(`${name} dependency runtime differs at verification block`);
    }
  }
  const contracts = {};
  const canonicalBlocks = new Map();
  const canonicalBlock = (blockNumber) => {
    if (!canonicalBlocks.has(blockNumber)) {
      canonicalBlocks.set(
        blockNumber,
        rpcClient(endpoint, "eth_getBlockByNumber", [
          `0x${blockNumber.toString(16)}`,
          false,
        ]),
      );
    }
    return canonicalBlocks.get(blockNumber);
  };
  for (const [index, name] of CLASSIC_V4_NEW_CONTRACTS.entries()) {
    const expected = plan.transactions[index];
    const hash = txHashes[name];
    const [transaction, receipt, code] = await Promise.all([
      rpcClient(endpoint, "eth_getTransactionByHash", [hash]),
      rpcClient(endpoint, "eth_getTransactionReceipt", [hash]),
      rpcClient(endpoint, "eth_getCode", [
        plan.predictedAddresses[name],
        blockTag,
      ]),
    ]);
    if (!transaction || !receipt || code === "0x")
      fail(`${name} is not deployed`);
    const blockNumber = Number(BigInt(receipt.blockNumber));
    const receiptBlock = await canonicalBlock(blockNumber);
    assertClassicV4DeploymentBlockBinding({
      transaction,
      receipt,
      block: receiptBlock,
      blockNumber,
      label: name,
    });
    const confirmations = verificationBlock - blockNumber + 1;
    const transactionTo = transaction.to
      ? canonicalAddress(transaction.to)
      : null;
    const expectedTo = expected.to ? canonicalAddress(expected.to) : null;
    if (
      normalizeHex(transaction.hash) !== normalizeHex(hash) ||
      normalizeHex(transaction.from) !== normalizeHex(expected.from) ||
      normalizeHex(transactionTo) !== normalizeHex(expectedTo) ||
      Number(BigInt(transaction.nonce)) !== expected.nonce ||
      BigInt(transaction.value) !== 0n ||
      normalizeHex(keccak256(transaction.input)) !==
        normalizeHex(expected.dataHash) ||
      normalizeHex(receipt.status) !== "0x1" ||
      normalizeHex(receipt.transactionHash) !== normalizeHex(hash) ||
      normalizeHex(receipt.from) !== normalizeHex(expected.from) ||
      normalizeHex(receipt.to) !== normalizeHex(expectedTo) ||
      blockNumber <= 0 ||
      confirmations < CLASSIC_V4_FINALITY_CONFIRMATIONS
    ) {
      fail(`${name} receipt or transaction differs from the reviewed plan`);
    }
    if (
      name !== "feeHook" &&
      normalizeHex(receipt.contractAddress) !==
        normalizeHex(plan.predictedAddresses[name])
    ) {
      fail(`${name} receipt contract address differs`);
    }
    if (name === "feeHook" && receipt.contractAddress !== null) {
      fail(
        "Hook factory transaction unexpectedly has a direct contract address",
      );
    }
    const normalizedRuntime = normalizeRuntimeImmutables(code, artifacts[name]);
    const runtimeTemplateHash = keccak256(normalizedRuntime);
    if (
      normalizeHex(runtimeTemplateHash) !==
      normalizeHex(plan.runtimeTemplates[name].runtimeTemplateHash)
    ) {
      fail(`${name} deployed runtime differs from reviewed source`);
    }
    contracts[name] = {
      transactionHash: hash.toLowerCase(),
      blockNumber,
      blockHash: receipt.blockHash.toLowerCase(),
      confirmations,
      address: plan.predictedAddresses[name],
      nonce: expected.nonce,
      from: expected.from,
      to: expectedTo,
      dataHash: expected.dataHash,
      value: "0",
      runtimeCodeHash: keccak256(code),
      runtimeTemplateHash,
    };
  }
  for (const check of runtimeBindingChecks(plan)) {
    const actual = await rpcClient(endpoint, "eth_call", [
      { to: check.target, data: check.data },
      blockTag,
    ]);
    if (normalizeHex(actual) !== normalizeHex(check.expected)) {
      fail(`${check.label} differs at verification block`);
    }
  }
  return {
    verificationBlock,
    verificationBlockHash: verificationHead.hash.toLowerCase(),
    checkedAt: new Date(
      Number(BigInt(verificationHead.timestamp)) * 1_000,
    ).toISOString(),
    contracts,
  };
}

function reconcile(left, right) {
  if (
    left.verificationBlock !== right.verificationBlock ||
    normalizeHex(left.verificationBlockHash) !==
      normalizeHex(right.verificationBlockHash) ||
    digestJson(
      left.contracts,
      CLASSIC_V4_DIGEST_DOMAINS.deploymentRpcSnapshot,
    ) !==
      digestJson(
        right.contracts,
        CLASSIC_V4_DIGEST_DOMAINS.deploymentRpcSnapshot,
      )
  ) {
    fail("Independent RPCs disagree on deployment evidence");
  }
  return left;
}

async function writeAcknowledgedEvidence(evidence, plan, options) {
  if (!options.output || !path.isAbsolute(options.output)) {
    fail("--write requires an absolute --output path");
  }
  if (
    !options.wallet ||
    canonicalAddress(options.wallet, "wallet") !==
      canonicalAddress(plan.deployer)
  ) {
    fail("--write requires the explicit human wallet matching the deployer");
  }
  if (
    normalizeHex(options.acknowledgement) !==
    normalizeHex(evidence.evidenceDigest)
  ) {
    fail(
      "--write requires --acknowledge-evidence-digest from a fresh check run",
    );
  }
  const output = path.resolve(options.output);
  const relative = path.relative(repositoryRoot, output);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    fail("Deployment evidence must be written outside the source repository");
  }
  const parent = path.dirname(output);
  const [realParent, parentStats] = await Promise.all([
    realpath(parent),
    stat(parent),
  ]);
  if (!parentStats.isDirectory() || realParent !== parent)
    fail("Invalid output parent");
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const endpoints = [options.rpcA, options.rpcB];
  assertEndpoints(endpoints);
  const [plan, txHashes] = await Promise.all([
    readJson(options.plan, "preparation plan"),
    readJson(options.transactions, "transaction hashes"),
  ]);
  const artifacts = await loadClassicV4SealedBuild(plan);
  const evidence = await verifyClassicV4DeploymentAtFixedBlock({
    endpoints,
    plan,
    txHashes,
    verificationBlock: options.verificationBlock,
    artifacts,
  });
  if (options.write) await writeAcknowledgedEvidence(evidence, plan, options);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

export async function verifyClassicV4DeploymentAtFixedBlock({
  endpoints,
  plan,
  txHashes,
  verificationBlock,
  artifacts,
  rpcClient = rpc,
}) {
  assertEndpoints(endpoints);
  if (!Number.isSafeInteger(verificationBlock) || verificationBlock <= 0) {
    fail("Deployment verification block must be a positive integer");
  }
  validateClassicV4PreparationPlan(plan, artifacts);
  assertTransactionInputFile(txHashes);
  const snapshots = await Promise.all(
    endpoints.map((endpoint) =>
      verifyAtEndpoint(
        endpoint,
        plan,
        txHashes,
        verificationBlock,
        artifacts,
        rpcClient,
      ),
    ),
  );
  const verified = reconcile(...snapshots);
  const unsignedEvidence = {
    schemaVersion: 1,
    chainId: 1,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    status: "finalized",
    checkedAt: verified.checkedAt,
    verificationBlock: verified.verificationBlock,
    verificationBlockHash: verified.verificationBlockHash,
    independentRpcCount: 2,
    deploymentLive: true,
    runtimeCodeVerified: true,
    constructorBindingsVerified: true,
    contracts: verified.contracts,
  };
  const evidence = {
    ...unsignedEvidence,
    evidenceDigest: digestJson(
      unsignedEvidence,
      CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
    ),
  };
  validateClassicV4DeploymentEvidence(plan, evidence);
  return evidence;
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 deployment verification failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
