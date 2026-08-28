#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  lstat,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
} from "viem";

import {
  CLASSIC_V4_CHAIN_ID_HEX,
  CLASSIC_V4_EXPECTED_CTO_AUTHORITY_OWNER,
  CLASSIC_V4_FINALITY_CONFIRMATIONS,
  CLASSIC_V4_NEW_CONTRACTS,
  digestJson,
  normalizeRuntimeImmutables,
} from "./classic-v4-release-core.mjs";
import { loadClassicV4SealedBuild } from "../contracts/scripts/prepare-classic-v4-mainnet-release.mjs";
import { verifyClassicV4DeploymentAtFixedBlock } from "../contracts/scripts/verify-classic-v4-mainnet-deployment.mjs";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4_179;
const DEFAULT_RPC_ENDPOINTS = Object.freeze([
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
]);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RPC_RESPONSE_BYTES = 8 * 1_024 * 1_024;
const MAX_REQUEST_BYTES = 4_096;
const GAS_PADDING_BPS = 12_000n;
const MAX_GAS_LIMIT = 12_000_000n;
const MAX_FEE_PER_GAS_WEI = 100_000_000_000n;
const MAX_PRIORITY_FEE_PER_GAS_WEI = 5_000_000_000n;
const MIN_PRIORITY_FEE_PER_GAS_WEI = 100_000_000n;
const PREPARATION_DIGEST_DOMAIN =
  "programmable.classic-v4.metamask-preparation.v1";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UINT256_MAX = (1n << 256n) - 1n;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const faviconPath = path.join(
  repositoryRoot,
  "public/brand/loop/programmable-loop-mark-64.png",
);
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

export function normalizeHex(value) {
  return String(value ?? "").toLowerCase();
}

export function normalizeQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function assertBytes32(value, label) {
  if (!/^0x[0-9a-f]{64}$/i.test(String(value ?? ""))) {
    fail(`Invalid ${label}`);
  }
  return normalizeHex(value);
}

function assertAddress(value, label) {
  if (!/^0x[0-9a-f]{40}$/i.test(String(value ?? ""))) {
    fail(`Invalid ${label}`);
  }
  return normalizeHex(value);
}

export function assertRpcEndpoints(endpoints) {
  if (!Array.isArray(endpoints) || endpoints.length !== 2) {
    fail("Exactly two independent RPC endpoints are required");
  }
  const hostnames = new Set();
  for (const endpoint of endpoints) {
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch {
      fail("Invalid RPC URL");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== "" && parsed.pathname !== "/")
    ) {
      fail("RPC URLs must be credential free HTTPS origins");
    }
    hostnames.add(parsed.hostname.toLowerCase());
  }
  if (hostnames.size !== 2) {
    fail("RPC endpoints must use two distinct hostnames");
  }
}

export function parseArguments(argv, environment = process.env) {
  const forbidden = argv.find((argument) => {
    const key = argument.split("=", 1)[0];
    return ["--broadcast", "--private-key", "--mnemonic"].includes(key);
  });
  if (forbidden) {
    fail(
      `${forbidden.split("=", 1)[0]} is forbidden; MetaMask is the only signer`,
    );
  }
  const parsed = {
    plan: null,
    transactions: null,
    rpcA: environment.CLASSIC_V4_RPC_A ?? DEFAULT_RPC_ENDPOINTS[0],
    rpcB: environment.CLASSIC_V4_RPC_B ?? DEFAULT_RPC_ENDPOINTS[1],
    port: Number(
      environment.PROGRAMMABLE_CLASSIC_V4_DEPLOY_PORT ?? DEFAULT_PORT,
    ),
    check: false,
    uiCheck: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      parsed.check = true;
      continue;
    }
    if (argument === "--ui-check") {
      parsed.uiCheck = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? null : argument.slice(separator + 1);
    if (!["--plan", "--transactions", "--rpc-a", "--rpc-b"].includes(key)) {
      fail(`Unknown argument: ${key}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--plan") parsed.plan = value;
    if (key === "--transactions") parsed.transactions = value;
    if (key === "--rpc-a") parsed.rpcA = value;
    if (key === "--rpc-b") parsed.rpcB = value;
  }
  if (!parsed.plan || !path.isAbsolute(parsed.plan)) {
    fail("--plan must be an absolute path");
  }
  if (
    !parsed.uiCheck &&
    (!parsed.transactions || !path.isAbsolute(parsed.transactions))
  ) {
    fail("--transactions must be an absolute path");
  }
  if (parsed.uiCheck && parsed.check) {
    fail("--ui-check and --check cannot be combined");
  }
  if (
    !Number.isSafeInteger(parsed.port) ||
    parsed.port < 1_024 ||
    parsed.port > 65_535
  ) {
    fail("Invalid local console port");
  }
  if (!parsed.uiCheck) assertRpcEndpoints([parsed.rpcA, parsed.rpcB]);
  return parsed;
}

export function assertExactClassicV4PlanSequence(plan) {
  if (!Array.isArray(plan?.transactions) || plan.transactions.length !== 4) {
    fail("Classic V4 plan must contain exactly four transactions");
  }
  if (
    !Number.isSafeInteger(plan.startingNonce) ||
    plan.startingNonce < 0 ||
    normalizeHex(plan.chainId === 1 ? "0x1" : "") !==
      CLASSIC_V4_CHAIN_ID_HEX ||
    !/^0x[0-9a-f]{64}$/i.test(String(plan.planDigest ?? ""))
  ) {
    fail("Classic V4 plan identity is invalid");
  }
  const expectedTypes = ["CREATE", "CALL_CREATE2", "CREATE", "CREATE"];
  for (const [index, name] of CLASSIC_V4_NEW_CONTRACTS.entries()) {
    const transaction = plan.transactions[index];
    const expectedTo = index === 1 ? plan.predictedAddresses?.hookFactory : null;
    if (
      transaction?.name !== name ||
      transaction?.transactionType !== expectedTypes[index] ||
      transaction?.nonce !== plan.startingNonce + index ||
      assertAddress(transaction?.from, `${name} sender`) !==
        assertAddress(plan.deployer, "plan deployer") ||
      normalizeHex(transaction?.to) !== normalizeHex(expectedTo) ||
      String(transaction?.value) !== "0" ||
      assertAddress(transaction?.predictedAddress, `${name} address`) !==
        assertAddress(plan.predictedAddresses?.[name], `${name} prediction`) ||
      !/^0x(?:[0-9a-f]{2})+$/i.test(String(transaction?.data ?? "")) ||
      normalizeHex(keccak256(transaction.data)) !==
        assertBytes32(transaction?.dataHash, `${name} calldata hash`)
    ) {
      fail(`Classic V4 ${name} transaction differs from the exact sequence`);
    }
  }
  return true;
}

function publicPlan(plan) {
  assertExactClassicV4PlanSequence(plan);
  return {
    chainId: 1,
    chainIdHex: CLASSIC_V4_CHAIN_ID_HEX,
    deployer: plan.deployer,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    releaseCommit: plan.releaseCommit,
    releaseTree: plan.releaseTree,
    startingNonce: plan.startingNonce,
    observedAtBlock: plan.observedAtBlock,
    observedAtBlockHash: plan.observedAtBlockHash,
    transactions: plan.transactions.map((transaction) => ({
      name: transaction.name,
      transactionType: transaction.transactionType,
      from: transaction.from,
      to: transaction.to,
      nonce: transaction.nonce,
      value: transaction.value,
      predictedAddress: transaction.predictedAddress,
      data: transaction.data,
      dataHash: transaction.dataHash,
    })),
  };
}

async function readBoundedResponse(response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RPC_RESPONSE_BYTES) fail("RPC response is too large");
  if (!response.body) fail("RPC response body is unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RPC_RESPONSE_BYTES) {
      await reader.cancel();
      fail("RPC response is too large");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    fail("RPC returned invalid JSON");
  }
}

async function rpc(endpoint, method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) fail(`RPC ${method} returned HTTP ${response.status}`);
  const payload = await readBoundedResponse(response);
  if (payload?.error) {
    fail(`RPC ${method} failed: ${payload.error.message ?? "unknown error"}`);
  }
  return payload?.result;
}

function codeDescriptor(code) {
  const normalized = normalizeHex(code);
  if (!/^0x(?:[0-9a-f]{2})*$/i.test(normalized)) {
    fail("RPC returned invalid runtime bytecode");
  }
  return {
    code: normalized,
    codeHash: normalized === "0x" ? null : keccak256(normalized),
  };
}

function addressResult(value) {
  return encodeAbiParameters([{ type: "address" }], [value]);
}

function uintResult(value, type = "uint256") {
  return encodeAbiParameters([{ type }], [BigInt(value)]);
}

function sharedBindingChecks(plan) {
  const shared = plan.sharedDependencies;
  const official = plan.officialDependencies;
  const callCheck = (label, target, abi, functionName, expected) => ({
    label,
    target,
    data: encodeFunctionData({ abi, functionName }),
    expected,
  });
  return [
    callCheck(
      "CTO authority owner",
      shared.ctoAuthority.address,
      ctoAuthorityAbi,
      "authority",
      addressResult(CLASSIC_V4_EXPECTED_CTO_AUTHORITY_OWNER),
    ),
    callCheck(
      "CTO pending authority",
      shared.ctoAuthority.address,
      ctoAuthorityAbi,
      "pendingAuthority",
      addressResult(ZERO_ADDRESS),
    ),
    callCheck(
      "reward factory CTO binding",
      shared.rewardVaultFactory.address,
      rewardFactoryAbi,
      "ctoAuthority",
      addressResult(shared.ctoAuthority.address),
    ),
    callCheck(
      "minimum custody days",
      shared.initialBuyVestingWalletFactory.address,
      custodyFactoryAbi,
      "MIN_DURATION_DAYS",
      uintResult(1, "uint16"),
    ),
    callCheck(
      "maximum custody days",
      shared.initialBuyVestingWalletFactory.address,
      custodyFactoryAbi,
      "MAX_DURATION_DAYS",
      uintResult(3_650, "uint16"),
    ),
    callCheck(
      "maximum reward beneficiaries",
      shared.launchPolicy.address,
      launchPolicyAbi,
      "MAX_REWARD_BENEFICIARIES",
      uintResult(5),
    ),
    callCheck(
      "reward share basis points",
      shared.launchPolicy.address,
      launchPolicyAbi,
      "REWARD_SHARE_BASIS_POINTS",
      uintResult(10_000, "uint16"),
    ),
    callCheck(
      "forwarder PositionManager binding",
      shared.positionForwarderFactory.address,
      forwarderFactoryAbi,
      "positionManager",
      addressResult(official.positionManager.address),
    ),
    callCheck(
      "forwarder immutable operator",
      shared.positionForwarderFactory.address,
      forwarderFactoryAbi,
      "OPERATOR",
      addressResult(ZERO_ADDRESS),
    ),
    callCheck(
      "forwarder permanent timelock",
      shared.positionForwarderFactory.address,
      forwarderFactoryAbi,
      "TIMELOCK_BLOCK",
      uintResult(UINT256_MAX),
    ),
  ];
}

async function readRpcSnapshot(endpoint, plan) {
  const dependencyEntries = [
    ...Object.entries(plan.officialDependencies ?? {}),
    ...Object.entries(plan.sharedDependencies ?? {}),
  ];
  const observedTag = normalizeQuantity(plan.observedAtBlock);
  const [
    chainId,
    latestBlock,
    observedBlock,
    confirmedNonce,
    pendingNonce,
    balance,
    gasPrice,
    dependencyCodes,
    sharedBindings,
    predictedCodes,
  ] = await Promise.all([
    rpc(endpoint, "eth_chainId"),
    rpc(endpoint, "eth_getBlockByNumber", ["latest", false]),
    rpc(endpoint, "eth_getBlockByNumber", [observedTag, false]),
    rpc(endpoint, "eth_getTransactionCount", [plan.deployer, "latest"]),
    rpc(endpoint, "eth_getTransactionCount", [plan.deployer, "pending"]),
    rpc(endpoint, "eth_getBalance", [plan.deployer, "latest"]),
    rpc(endpoint, "eth_gasPrice"),
    Promise.all(
      dependencyEntries.map(async ([name, expected]) => {
        const descriptor = codeDescriptor(
          await rpc(endpoint, "eth_getCode", [expected.address, "latest"]),
        );
        if (
          !descriptor.codeHash ||
          normalizeHex(descriptor.codeHash) !==
            normalizeHex(expected.runtimeCodeHash)
        ) {
          fail(`${name} dependency runtime differs from the reviewed plan`);
        }
        return { name, codeHash: descriptor.codeHash };
      }),
    ),
    Promise.all(
      sharedBindingChecks(plan).map(async (check) => {
        const actual = normalizeHex(
          await rpc(endpoint, "eth_call", [
            { to: check.target, data: check.data },
            "latest",
          ]),
        );
        if (actual !== normalizeHex(check.expected)) {
          fail(`${check.label} differs from the reviewed release binding`);
        }
        return { label: check.label, result: actual };
      }),
    ),
    Promise.all(
      CLASSIC_V4_NEW_CONTRACTS.map(async (name) => ({
        name,
        ...codeDescriptor(
          await rpc(endpoint, "eth_getCode", [
            plan.predictedAddresses[name],
            "latest",
          ]),
        ),
      })),
    ),
  ]);
  if (normalizeQuantity(chainId) !== CLASSIC_V4_CHAIN_ID_HEX) {
    fail("RPC is not Ethereum Mainnet");
  }
  if (
    !latestBlock?.number ||
    !latestBlock?.hash ||
    !latestBlock?.baseFeePerGas
  ) {
    fail("RPC Mainnet head is incomplete");
  }
  if (
    !observedBlock?.number ||
    Number(BigInt(observedBlock.number)) !== plan.observedAtBlock ||
    normalizeHex(observedBlock.hash) !== normalizeHex(plan.observedAtBlockHash)
  ) {
    fail("Plan observed block is no longer canonical");
  }
  return {
    chainId: normalizeQuantity(chainId),
    latestBlockNumber: Number(BigInt(latestBlock.number)),
    latestBlockHash: normalizeHex(latestBlock.hash),
    baseFeePerGas: normalizeQuantity(latestBlock.baseFeePerGas),
    observedBlockHash: normalizeHex(observedBlock.hash),
    confirmedNonce: Number(BigInt(confirmedNonce)),
    pendingNonce: Number(BigInt(pendingNonce)),
    balance: normalizeQuantity(balance),
    gasPrice: normalizeQuantity(gasPrice),
    dependencyCodes,
    sharedBindings,
    predictedCodes,
  };
}

export function reconcileRpcSnapshots(plan, snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length !== 2) {
    fail("Two independent RPC snapshots are required");
  }
  const [left, right] = snapshots;
  if (
    left.chainId !== CLASSIC_V4_CHAIN_ID_HEX ||
    right.chainId !== CLASSIC_V4_CHAIN_ID_HEX
  ) {
    fail("RPC is not Ethereum Mainnet");
  }
  if (
    left.confirmedNonce !== right.confirmedNonce ||
    left.pendingNonce !== right.pendingNonce
  ) {
    fail("Independent RPCs disagree on the deployer nonce");
  }
  if (Math.abs(left.latestBlockNumber - right.latestBlockNumber) > 4) {
    fail("Independent RPC heads differ by more than four blocks");
  }
  if (
    left.observedBlockHash !== normalizeHex(plan.observedAtBlockHash) ||
    right.observedBlockHash !== normalizeHex(plan.observedAtBlockHash)
  ) {
    fail("Independent RPCs disagree on the plan observation block");
  }
  const compareEntries = (key, label) => {
    const leftEntries = left[key] ?? [];
    const rightEntries = right[key] ?? [];
    if (
      leftEntries.length !== rightEntries.length ||
      leftEntries.some((entry, index) => {
        const other = rightEntries[index];
        return (
          entry.name !== other?.name ||
          normalizeHex(entry.codeHash) !== normalizeHex(other?.codeHash) ||
          (key === "predictedCodes" &&
            normalizeHex(entry.code) !== normalizeHex(other?.code))
        );
      })
    ) {
      fail(`Independent RPCs disagree on ${label}`);
    }
  };
  compareEntries("dependencyCodes", "dependency runtimes");
  compareEntries("predictedCodes", "predicted address runtimes");
  if (
    digestJson(left.sharedBindings ?? []) !==
    digestJson(right.sharedBindings ?? [])
  ) {
    fail("Independent RPCs disagree on shared dependency bindings");
  }
  return {
    confirmedNonce: left.confirmedNonce,
    pendingNonce: left.pendingNonce,
    latestBlockNumber: Math.min(
      left.latestBlockNumber,
      right.latestBlockNumber,
    ),
    balance:
      BigInt(left.balance) < BigInt(right.balance)
        ? left.balance
        : right.balance,
    gasPrice:
      BigInt(left.gasPrice) > BigInt(right.gasPrice)
        ? left.gasPrice
        : right.gasPrice,
    baseFeePerGas:
      BigInt(left.baseFeePerGas) > BigInt(right.baseFeePerGas)
        ? left.baseFeePerGas
        : right.baseFeePerGas,
    predictedCodes: left.predictedCodes,
    rpcObservations: snapshots.map((snapshot, index) => ({
      rpc: index === 0 ? "A" : "B",
      latestBlockNumber: snapshot.latestBlockNumber,
      latestBlockHash: snapshot.latestBlockHash,
      confirmedNonce: snapshot.confirmedNonce,
      pendingNonce: snapshot.pendingNonce,
      balance: snapshot.balance,
      gasPrice: snapshot.gasPrice,
      baseFeePerGas: snapshot.baseFeePerGas,
    })),
  };
}

export function validatePartialTransactionHashes(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail("Transaction hash record must be a JSON object");
  }
  const keys = Object.keys(value);
  const expectedPrefix = CLASSIC_V4_NEW_CONTRACTS.slice(0, keys.length);
  if (
    keys.length > CLASSIC_V4_NEW_CONTRACTS.length ||
    [...keys].sort().some(
      (key, index) => key !== [...expectedPrefix].sort()[index],
    )
  ) {
    fail("Transaction hash record must be a contiguous Classic V4 prefix");
  }
  const normalized = {};
  const unique = new Set();
  for (const key of expectedPrefix) {
    const hash = assertBytes32(value[key], `${key} transaction hash`);
    if (BigInt(hash) === 0n || unique.has(hash)) {
      fail("Transaction hashes must be nonzero and unique");
    }
    unique.add(hash);
    normalized[key] = hash;
  }
  return normalized;
}

async function assertExternalRecordPath(recordPath) {
  if (!recordPath || !path.isAbsolute(recordPath)) {
    fail("Transaction hash path must be absolute");
  }
  const resolved = path.resolve(recordPath);
  const relative = path.relative(repositoryRoot, resolved);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    fail("Transaction hashes must stay outside the source repository");
  }
  const parent = path.dirname(resolved);
  const [parentRealPath, parentStats] = await Promise.all([
    realpath(parent),
    stat(parent),
  ]);
  if (!parentStats.isDirectory() || parentRealPath !== parent) {
    fail("Transaction hash parent must be an existing real directory");
  }
  try {
    const [fileStats, fileRealPath] = await Promise.all([
      lstat(resolved),
      realpath(resolved),
    ]);
    if (!fileStats.isFile() || fileStats.isSymbolicLink() || fileRealPath !== resolved) {
      fail("Transaction hash file must be a regular file");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return resolved;
}

export async function readTransactionHashes(recordPath) {
  const resolved = await assertExternalRecordPath(recordPath);
  try {
    const contents = await readFile(resolved, "utf8");
    if (Buffer.byteLength(contents) > MAX_REQUEST_BYTES) {
      fail("Transaction hash file is too large");
    }
    return validatePartialTransactionHashes(JSON.parse(contents));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    if (error instanceof SyntaxError) fail("Transaction hash file is invalid JSON");
    throw error;
  }
}

export async function writeTransactionHashes(recordPath, hashes) {
  const resolved = await assertExternalRecordPath(recordPath);
  const normalized = validatePartialTransactionHashes(hashes);
  const temporary = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, resolved);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return normalized;
}

function transactionComparison(transaction) {
  if (!transaction) return null;
  return {
    hash: normalizeHex(transaction.hash),
    from: normalizeHex(transaction.from),
    to: transaction.to ? normalizeHex(transaction.to) : null,
    nonce: Number(BigInt(transaction.nonce)),
    value: normalizeQuantity(transaction.value),
    input: normalizeHex(transaction.input),
    chainId: transaction.chainId
      ? normalizeQuantity(transaction.chainId)
      : null,
    type: transaction.type ? normalizeQuantity(transaction.type) : null,
    gas: normalizeQuantity(transaction.gas),
    maxFeePerGas: transaction.maxFeePerGas
      ? normalizeQuantity(transaction.maxFeePerGas)
      : null,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
      ? normalizeQuantity(transaction.maxPriorityFeePerGas)
      : null,
    blockNumber: transaction.blockNumber
      ? Number(BigInt(transaction.blockNumber))
      : null,
    blockHash: transaction.blockHash
      ? normalizeHex(transaction.blockHash)
      : null,
  };
}

function receiptComparison(receipt) {
  if (!receipt) return null;
  return {
    transactionHash: normalizeHex(receipt.transactionHash),
    status: normalizeQuantity(receipt.status),
    from: normalizeHex(receipt.from),
    to: receipt.to ? normalizeHex(receipt.to) : null,
    contractAddress: receipt.contractAddress
      ? normalizeHex(receipt.contractAddress)
      : null,
    blockNumber: Number(BigInt(receipt.blockNumber)),
    blockHash: normalizeHex(receipt.blockHash),
    transactionIndex: normalizeQuantity(receipt.transactionIndex),
  };
}

export function validateClassicV4TransactionRecord({
  plan,
  artifacts,
  index,
  hash,
  transaction,
  receipt,
  canonicalBlock,
  runtimeCode,
}) {
  if (!Number.isInteger(index) || index < 0 || index >= 4) {
    fail("Invalid Classic V4 transaction index");
  }
  const expected = plan.transactions[index];
  const normalizedHash = assertBytes32(hash, "transaction hash");
  const actual = transactionComparison(transaction);
  if (!actual) fail("Transaction is not visible on both RPCs");
  if (
    actual.hash !== normalizedHash ||
    actual.from !== normalizeHex(expected.from) ||
    actual.to !== (expected.to ? normalizeHex(expected.to) : null) ||
    actual.nonce !== expected.nonce ||
    actual.value !== "0x0" ||
    actual.input !== normalizeHex(expected.data) ||
    normalizeHex(keccak256(actual.input)) !== normalizeHex(expected.dataHash) ||
    actual.chainId !== CLASSIC_V4_CHAIN_ID_HEX ||
    actual.type !== "0x2" ||
    BigInt(actual.gas) > MAX_GAS_LIMIT ||
    actual.maxFeePerGas === null ||
    BigInt(actual.maxFeePerGas) > MAX_FEE_PER_GAS_WEI ||
    actual.maxPriorityFeePerGas === null ||
    BigInt(actual.maxPriorityFeePerGas) > MAX_PRIORITY_FEE_PER_GAS_WEI
  ) {
    fail(`${expected.name} transaction differs from the reviewed plan`);
  }
  const normalizedReceipt = receiptComparison(receipt);
  const runtime = codeDescriptor(runtimeCode);
  if (!normalizedReceipt) {
    if (runtime.code !== "0x") {
      fail(`${expected.name} runtime exists without a canonical receipt`);
    }
    return { status: "pending", transaction: actual, receipt: null, runtime: null };
  }
  if (
    normalizedReceipt.transactionHash !== normalizedHash ||
    normalizedReceipt.status !== "0x1" ||
    normalizedReceipt.from !== normalizeHex(expected.from) ||
    normalizedReceipt.to !== (expected.to ? normalizeHex(expected.to) : null) ||
    normalizedReceipt.blockNumber !== actual.blockNumber ||
    normalizedReceipt.blockHash !== actual.blockHash ||
    normalizedReceipt.blockNumber <= plan.observedAtBlock ||
    !canonicalBlock?.number ||
    Number(BigInt(canonicalBlock.number)) !== normalizedReceipt.blockNumber ||
    normalizeHex(canonicalBlock.hash) !== normalizedReceipt.blockHash
  ) {
    fail(`${expected.name} receipt or canonical block differs`);
  }
  const expectedContractAddress = index === 1
    ? null
    : normalizeHex(expected.predictedAddress);
  if (normalizedReceipt.contractAddress !== expectedContractAddress) {
    fail(`${expected.name} receipt contract address differs`);
  }
  if (runtime.code === "0x") fail(`${expected.name} has no runtime code`);
  const runtimeTemplateHash = keccak256(
    normalizeRuntimeImmutables(runtime.code, artifacts[expected.name]),
  );
  if (
    normalizeHex(runtimeTemplateHash) !==
    normalizeHex(plan.runtimeTemplates[expected.name].runtimeTemplateHash)
  ) {
    fail(`${expected.name} deployed runtime differs from reviewed source`);
  }
  return {
    status: "confirmed",
    transaction: actual,
    receipt: normalizedReceipt,
    runtime: {
      codeHash: runtime.codeHash,
      runtimeTemplateHash,
    },
  };
}

export function assertTransactionMatchesPreparation(record, prepared) {
  if (
    record?.transaction?.gas !== prepared?.request?.gas ||
    record?.transaction?.maxFeePerGas !== prepared?.request?.maxFeePerGas ||
    record?.transaction?.maxPriorityFeePerGas !==
      prepared?.request?.maxPriorityFeePerGas
  ) {
    fail("Submitted gas fields differ from the reviewed preparation");
  }
  return true;
}

async function readRecordAtEndpoint(
  endpoint,
  plan,
  artifacts,
  index,
  hash,
  runtimeCode,
) {
  const [transaction, receipt] = await Promise.all([
    rpc(endpoint, "eth_getTransactionByHash", [hash]),
    rpc(endpoint, "eth_getTransactionReceipt", [hash]),
  ]);
  const canonicalBlock = receipt?.blockNumber
    ? await rpc(endpoint, "eth_getBlockByNumber", [receipt.blockNumber, false])
    : null;
  return validateClassicV4TransactionRecord({
    plan,
    artifacts,
    index,
    hash,
    transaction,
    receipt,
    canonicalBlock,
    runtimeCode,
  });
}

async function readReconciledRecord(
  endpoints,
  plan,
  artifacts,
  snapshots,
  index,
  hash,
) {
  const records = await Promise.all(
    endpoints.map((endpoint, rpcIndex) =>
      readRecordAtEndpoint(
        endpoint,
        plan,
        artifacts,
        index,
        hash,
        snapshots[rpcIndex].predictedCodes[index].code,
      ),
    ),
  );
  if (digestJson(records[0]) !== digestJson(records[1])) {
    fail("Independent RPCs disagree on the recorded transaction");
  }
  return records[0];
}

export function evaluateClassicV4Sequence({ plan, state, hashes, records }) {
  const keys = Object.keys(hashes);
  if (records.length !== keys.length) {
    fail("Recorded transaction evidence is incomplete");
  }
  let completedCount = 0;
  let pendingCount = 0;
  for (const [index, record] of records.entries()) {
    if (record.status === "confirmed" && pendingCount === 0) {
      completedCount += 1;
      continue;
    }
    if (record.status === "pending" && index === records.length - 1) {
      pendingCount += 1;
      continue;
    }
    fail("Recorded transactions are not a sequential confirmed prefix");
  }
  if (pendingCount > 1) fail("More than one deployment transaction is pending");
  for (let index = keys.length; index < 4; index += 1) {
    if (state.predictedCodes[index]?.code !== "0x") {
      fail(
        `${plan.transactions[index].name} address is occupied before its recorded transaction`,
      );
    }
  }
  const expectedConfirmedNonce = plan.startingNonce + completedCount;
  const expectedPendingNonce = plan.startingNonce + keys.length;
  const allComplete = completedCount === 4;
  if (
    (!allComplete && state.confirmedNonce !== expectedConfirmedNonce) ||
    (allComplete && state.confirmedNonce < expectedConfirmedNonce) ||
    state.pendingNonce !==
      (allComplete ? state.confirmedNonce : expectedPendingNonce)
  ) {
    fail("Deployer nonce differs from the recorded Classic V4 sequence");
  }
  if (allComplete && state.confirmedNonce !== state.pendingNonce) {
    fail("A later deployer transaction is still pending");
  }
  return {
    completedCount,
    recordedCount: keys.length,
    pending: pendingCount === 1,
    nextIndex: pendingCount === 1 || allComplete ? null : completedCount,
  };
}

function recommendFeePolicy(state) {
  const baseFee = BigInt(state.baseFeePerGas);
  const observedGasPrice = BigInt(state.gasPrice);
  let priority =
    observedGasPrice > baseFee
      ? observedGasPrice - baseFee
      : MIN_PRIORITY_FEE_PER_GAS_WEI;
  if (priority < MIN_PRIORITY_FEE_PER_GAS_WEI) {
    priority = MIN_PRIORITY_FEE_PER_GAS_WEI;
  }
  priority = (priority * 125n + 99n) / 100n;
  if (priority > MAX_PRIORITY_FEE_PER_GAS_WEI) {
    fail("Observed priority fee exceeds the 5 gwei operator cap");
  }
  const marketBuffer = (observedGasPrice * 125n + 99n) / 100n;
  const baseFeeBuffer = baseFee * 2n + priority;
  const maxFee = marketBuffer > baseFeeBuffer ? marketBuffer : baseFeeBuffer;
  if (maxFee > MAX_FEE_PER_GAS_WEI) {
    fail("Observed max fee exceeds the 100 gwei operator cap");
  }
  return {
    maxFeePerGas: normalizeQuantity(maxFee),
    maxPriorityFeePerGas: normalizeQuantity(priority),
  };
}

export function prepareClassicV4Transaction({ plan, state, index, simulations }) {
  if (!Number.isInteger(index) || index < 0 || index >= 4) {
    fail("Invalid next Classic V4 transaction index");
  }
  if (state.confirmedNonce !== state.pendingNonce) {
    fail("A transaction is already pending from the deployment wallet");
  }
  if (!Array.isArray(simulations) || simulations.length !== 2) {
    fail("Two independent live simulations are required");
  }
  const callResult = normalizeHex(simulations[0]?.callResult);
  if (!/^0x(?:[0-9a-f]{2})*$/i.test(callResult)) {
    fail("RPC A returned an invalid simulation result");
  }
  if (
    simulations.some(
      (simulation) => normalizeHex(simulation?.callResult) !== callResult,
    )
  ) {
    fail("Independent simulations disagree on the exact call result");
  }
  const estimates = simulations.map((simulation, rpcIndex) => {
    const estimate = BigInt(simulation?.estimatedGas ?? 0);
    if (estimate <= 21_000n) {
      fail(`RPC ${rpcIndex === 0 ? "A" : "B"} returned an invalid gas estimate`);
    }
    return estimate;
  });
  const highEstimate = estimates[0] > estimates[1] ? estimates[0] : estimates[1];
  const lowEstimate = estimates[0] < estimates[1] ? estimates[0] : estimates[1];
  if (highEstimate * 100n > lowEstimate * 105n) {
    fail("Independent gas estimates differ by more than 5 percent");
  }
  const gasLimit = (highEstimate * GAS_PADDING_BPS + 9_999n) / 10_000n;
  if (gasLimit > MAX_GAS_LIMIT) {
    fail("Padded gas limit exceeds the 12 million gas operator cap");
  }
  const fees = recommendFeePolicy(state);
  const maxDebit = gasLimit * BigInt(fees.maxFeePerGas);
  if (BigInt(state.balance) < maxDebit) {
    fail("Deployment wallet balance is below this transaction gas ceiling");
  }
  const transaction = plan.transactions[index];
  const request = {
    from: transaction.from,
    chainId: CLASSIC_V4_CHAIN_ID_HEX,
    nonce: normalizeQuantity(transaction.nonce),
    value: "0x0",
    data: transaction.data,
    gas: normalizeQuantity(gasLimit),
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    type: "0x2",
  };
  if (transaction.to) request.to = transaction.to;
  return {
    index,
    name: transaction.name,
    transactionType: transaction.transactionType,
    predictedAddress: transaction.predictedAddress,
    destination: transaction.to,
    dataHash: transaction.dataHash,
    calldata: transaction.data,
    simulationCallResultHash: keccak256(callResult),
    simulationEstimates: estimates.map(normalizeQuantity),
    gasLimit: normalizeQuantity(gasLimit),
    maxDebit: normalizeQuantity(maxDebit),
    request,
    preparedDigest: digestJson(
      { planDigest: plan.planDigest, index, request },
      PREPARATION_DIGEST_DOMAIN,
    ),
  };
}

async function simulateTransaction(endpoint, transaction) {
  const request = {
    from: transaction.from,
    nonce: normalizeQuantity(transaction.nonce),
    value: "0x0",
    data: transaction.data,
  };
  if (transaction.to) request.to = transaction.to;
  const [callResult, estimatedGas] = await Promise.all([
    rpc(endpoint, "eth_call", [request, "pending"]),
    rpc(endpoint, "eth_estimateGas", [request, "pending"]),
  ]);
  return {
    callResult: normalizeHex(callResult),
    estimatedGas: normalizeQuantity(estimatedGas),
  };
}

function transactionSteps(plan, hashes, records, sequence) {
  return plan.transactions.map((transaction, index) => {
    const record = records[index];
    let status = "waiting";
    if (record?.status === "confirmed") status = "verified";
    else if (record?.status === "pending") status = "pending";
    else if (index === sequence.nextIndex) status = "next";
    return {
      index,
      name: transaction.name,
      transactionType: transaction.transactionType,
      nonce: transaction.nonce,
      destination: transaction.to,
      predictedAddress: transaction.predictedAddress,
      dataHash: transaction.dataHash,
      txHash: hashes[transaction.name] ?? null,
      receiptBlock: record?.receipt?.blockNumber ?? null,
      status,
    };
  });
}

async function inspectDeployment(plan, artifacts, endpoints, recordPath) {
  const [snapshots, hashes] = await Promise.all([
    Promise.all(endpoints.map((endpoint) => readRpcSnapshot(endpoint, plan))),
    readTransactionHashes(recordPath),
  ]);
  const state = reconcileRpcSnapshots(plan, snapshots);
  const records = [];
  for (const [index, name] of CLASSIC_V4_NEW_CONTRACTS.entries()) {
    if (!hashes[name]) break;
    records.push(
      await readReconciledRecord(
        endpoints,
        plan,
        artifacts,
        snapshots,
        index,
        hashes[name],
      ),
    );
  }
  const sequence = evaluateClassicV4Sequence({ plan, state, hashes, records });
  let prepared = null;
  let finalEvidence = null;
  let blockingReason = null;
  let status = sequence.pending ? "pending" : "ready";
  if (sequence.completedCount === 4) {
    const lastReceiptBlock = Math.max(
      ...records.map((record) => record.receipt.blockNumber),
    );
    const confirmations = state.latestBlockNumber - lastReceiptBlock + 1;
    if (confirmations >= CLASSIC_V4_FINALITY_CONFIRMATIONS) {
      finalEvidence = await verifyClassicV4DeploymentAtFixedBlock({
        endpoints,
        plan,
        txHashes: hashes,
        verificationBlock: state.latestBlockNumber,
        artifacts,
      });
      status = "finalized";
    } else {
      status = "awaiting-finality";
      blockingReason = `${confirmations} of ${CLASSIC_V4_FINALITY_CONFIRMATIONS} confirmations`;
    }
  } else if (!sequence.pending) {
    const transaction = plan.transactions[sequence.nextIndex];
    const simulations = await Promise.all(
      endpoints.map((endpoint) => simulateTransaction(endpoint, transaction)),
    );
    try {
      prepared = prepareClassicV4Transaction({
        plan,
        state,
        index: sequence.nextIndex,
        simulations,
      });
    } catch (error) {
      status = "blocked";
      blockingReason = error?.message ?? String(error);
    }
  }
  return {
    status,
    blockingReason,
    plan: publicPlan(plan),
    state: {
      confirmedNonce: state.confirmedNonce,
      pendingNonce: state.pendingNonce,
      latestBlockNumber: state.latestBlockNumber,
      balance: state.balance,
      rpcObservations: state.rpcObservations,
    },
    sequence,
    steps: transactionSteps(plan, hashes, records, sequence),
    prepared,
    finalEvidence: finalEvidence
      ? {
          verificationBlock: finalEvidence.verificationBlock,
          verificationBlockHash: finalEvidence.verificationBlockHash,
          evidenceDigest: finalEvidence.evidenceDigest,
        }
      : null,
  };
}

export function buildUiCheckInspection(plan) {
  assertExactClassicV4PlanSequence(plan);
  const index = 0;
  const transaction = plan.transactions[index];
  const request = {
    from: transaction.from,
    chainId: CLASSIC_V4_CHAIN_ID_HEX,
    nonce: normalizeQuantity(transaction.nonce),
    value: "0x0",
    data: transaction.data,
    gas: "UI check only",
    maxFeePerGas: "UI check only",
    maxPriorityFeePerGas: "UI check only",
    type: "0x2",
  };
  if (transaction.to) request.to = transaction.to;
  const prepared = {
    index,
    name: transaction.name,
    transactionType: transaction.transactionType,
    predictedAddress: transaction.predictedAddress,
    destination: transaction.to,
    dataHash: transaction.dataHash,
    calldata: transaction.data,
    simulationCallResultHash: null,
    simulationEstimates: ["UI check only", "UI check only"],
    gasLimit: "UI check only",
    maxDebit: "UI check only",
    request,
    preparedDigest: digestJson(
      { planDigest: plan.planDigest, index, request },
      PREPARATION_DIGEST_DOMAIN,
    ),
  };
  return {
    status: "ui-check",
    blockingReason: "Signing and RPC actions are disabled in UI check mode",
    plan: publicPlan(plan),
    state: null,
    sequence: { completedCount: 0, recordedCount: 0, pending: false, nextIndex: 0 },
    steps: plan.transactions.map((item, itemIndex) => ({
      index: itemIndex,
      name: item.name,
      transactionType: item.transactionType,
      nonce: item.nonce,
      destination: item.to,
      predictedAddress: item.predictedAddress,
      dataHash: item.dataHash,
      txHash: null,
      receiptBlock: null,
      status: itemIndex === 0 ? "next" : "waiting",
    })),
    prepared,
    finalEvidence: null,
  };
}

async function recordSubmittedTransaction({
  plan,
  artifacts,
  endpoints,
  recordPath,
  index,
  hash,
  prepared,
}) {
  if (!Number.isInteger(index) || index < 0 || index >= 4) {
    fail("Invalid Classic V4 transaction index");
  }
  const hashes = await readTransactionHashes(recordPath);
  const keys = Object.keys(hashes);
  const name = CLASSIC_V4_NEW_CONTRACTS[index];
  const normalizedHash = assertBytes32(hash, "transaction hash");
  if (hashes[name]) {
    if (hashes[name] !== normalizedHash) {
      fail(`${name} already has a different recorded transaction hash`);
    }
    return inspectDeployment(plan, artifacts, endpoints, recordPath);
  }
  if (keys.length !== index) {
    fail("Only the next sequential Classic V4 transaction can be recorded");
  }
  const snapshots = await Promise.all(
    endpoints.map((endpoint) => readRpcSnapshot(endpoint, plan)),
  );
  reconcileRpcSnapshots(plan, snapshots);
  const record = await readReconciledRecord(
    endpoints,
    plan,
    artifacts,
    snapshots,
    index,
    normalizedHash,
  );
  assertTransactionMatchesPreparation(record, prepared);
  await writeTransactionHashes(recordPath, {
    ...hashes,
    [name]: normalizedHash,
  });
  return inspectDeployment(plan, artifacts, endpoints, recordPath);
}

function escapeInlineJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function renderHtml({ plan, initialInspection, uiCheck, operatorToken, nonce }) {
  const configuration = escapeInlineJson({
    uiCheck,
    operatorToken,
    plan: publicPlan(plan),
    initialInspection,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="description" content="Local MetaMask operator console for the sealed Programmable Classic V4 deployment plan.">
  <link rel="icon" href="/favicon.png" type="image/png">
  <title>Programmable · Classic V4 deployment</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light;
      --canvas: #faf7f8;
      --surface: #ffffff;
      --ink: #21181e;
      --muted: #655a61;
      --line: #dccfd7;
      --soft: #f3ecef;
      --action: #98245f;
      --action-hover: #7f194d;
      --focus: #5e2f89;
      --good: #176b4d;
      --good-soft: #e8f5ef;
      --warn: #7a4b00;
      --warn-soft: #fff3d6;
      --bad: #92243f;
      --bad-soft: #fbecef;
    }
    * { box-sizing: border-box; }
    html { background: var(--canvas); }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--canvas);
      color: var(--ink);
      font-family: Geist, ui-sans-serif, system-ui, sans-serif;
      font-size: 16px;
      line-height: 24px;
      text-rendering: optimizeLegibility;
    }
    button, input { font: inherit; }
    button {
      appearance: none;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 12px;
      background: var(--surface);
      color: var(--ink);
      font-size: 16px;
      line-height: 24px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 180ms cubic-bezier(.32,.72,0,1), border-color 180ms cubic-bezier(.32,.72,0,1), transform 180ms cubic-bezier(.32,.72,0,1);
    }
    button:hover:not(:disabled) { border-color: var(--muted); background: var(--soft); }
    button:active:not(:disabled) { transform: translateY(1px); }
    button.primary { border-color: var(--action); background: var(--action); color: #ffffff; }
    button.primary:hover:not(:disabled) { border-color: var(--action-hover); background: var(--action-hover); }
    button:disabled { cursor: not-allowed; opacity: .48; }
    button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 3px;
    }
    .skip-link {
      position: fixed;
      z-index: 10;
      top: 8px;
      left: 8px;
      transform: translateY(-160%);
      border-radius: 8px;
      padding: 8px 12px;
      background: var(--ink);
      color: #ffffff;
    }
    .skip-link:focus { transform: translateY(0); }
    .shell { width: min(1160px, calc(100% - 48px)); margin: 0 auto; padding: 40px 0 64px; }
    .masthead {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 24px;
      align-items: end;
      padding-bottom: 32px;
      border-bottom: 1px solid var(--line);
    }
    .eyebrow {
      margin: 0 0 8px;
      color: var(--action);
      font-size: 12px;
      line-height: 16px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    h1, h2, h3, p { margin-top: 0; }
    h1 {
      max-width: 680px;
      margin-bottom: 8px;
      font-size: 36px;
      line-height: 40px;
      font-weight: 650;
      letter-spacing: -.03em;
      text-wrap: balance;
    }
    h2 { margin-bottom: 8px; font-size: 20px; line-height: 28px; font-weight: 650; }
    h3 { margin-bottom: 4px; font-size: 18px; line-height: 28px; font-weight: 650; }
    p { margin-bottom: 0; color: var(--muted); text-wrap: pretty; }
    code, .mono {
      font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 16px;
      overflow-wrap: anywhere;
      font-variant-numeric: tabular-nums;
    }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .mode-banner {
      margin-top: 16px;
      border: 1px solid #d49b2f;
      border-radius: 8px;
      padding: 12px 16px;
      background: var(--warn-soft);
      color: #593500;
      font-size: 14px;
      line-height: 20px;
      font-weight: 600;
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      gap: 48px;
      align-items: start;
      padding-top: 32px;
    }
    .instrument {
      position: sticky;
      top: 24px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      overflow: hidden;
    }
    .instrument-head { padding: 24px; border-bottom: 1px solid var(--line); }
    .instrument-state { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
    .state-mark { width: 10px; height: 10px; border-radius: 999px; background: var(--muted); }
    .state-mark.ready, .state-mark.finalized { background: var(--good); }
    .state-mark.pending, .state-mark.awaiting-finality, .state-mark.ui-check { background: #b46a00; }
    .state-mark.blocked { background: var(--bad); }
    .state-label { font-size: 14px; line-height: 20px; font-weight: 700; }
    .facts { margin: 0; }
    .fact {
      display: grid;
      gap: 4px;
      padding: 16px 24px;
      border-bottom: 1px solid var(--line);
    }
    .fact:last-child { border-bottom: 0; }
    dt { color: var(--muted); font-size: 12px; line-height: 16px; }
    dd { margin: 0; }
    .instrument-actions { display: grid; gap: 8px; padding: 24px; border-top: 1px solid var(--line); }
    .notice {
      min-height: 48px;
      margin-top: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px 16px;
      background: var(--soft);
      color: var(--muted);
      font-size: 14px;
      line-height: 20px;
    }
    .notice.success { border-color: #8dc7af; background: var(--good-soft); color: var(--good); }
    .notice.warning { border-color: #d49b2f; background: var(--warn-soft); color: var(--warn); }
    .alert {
      min-height: 0;
      margin-top: 8px;
      border: 1px solid #dca2af;
      border-radius: 8px;
      padding: 12px 16px;
      background: var(--bad-soft);
      color: var(--bad);
      font-size: 14px;
      line-height: 20px;
    }
    .alert:empty { display: none; }
    .ledger-heading { display: flex; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 16px; }
    .ledger-heading p { font-size: 14px; line-height: 20px; }
    .ledger-heading > code { flex: 0 0 auto; white-space: nowrap; }
    .ledger {
      position: relative;
      margin: 0;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      list-style: none;
      overflow: hidden;
      counter-reset: deployment;
    }
    .ledger::before {
      content: "";
      position: absolute;
      top: 40px;
      bottom: 40px;
      left: 43px;
      width: 2px;
      background: var(--line);
    }
    .step {
      position: relative;
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      gap: 16px;
      align-items: start;
      padding: 24px;
      border-bottom: 1px solid var(--line);
      counter-increment: deployment;
    }
    .step:last-child { border-bottom: 0; }
    .step-index {
      position: relative;
      z-index: 1;
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      font-size: 14px;
      line-height: 20px;
      font-weight: 700;
    }
    .step-index::before { content: counter(deployment); }
    .step[data-status="verified"] .step-index { border-color: var(--good); background: var(--good); color: #ffffff; }
    .step[data-status="verified"] .step-index::before { content: "✓"; }
    .step[data-status="next"] .step-index { border-color: var(--action); color: var(--action); }
    .step-copy { min-width: 0; }
    .step-meta { margin-bottom: 8px; color: var(--muted); font-size: 12px; line-height: 16px; }
    .address { display: block; margin-top: 4px; }
    .step-status {
      display: inline-flex;
      min-height: 28px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 16px;
      font-weight: 700;
      white-space: nowrap;
    }
    .step[data-status="verified"] .step-status { border-color: #8dc7af; background: var(--good-soft); color: var(--good); }
    .step[data-status="pending"] .step-status, .step[data-status="next"] .step-status { border-color: #d49b2f; background: var(--warn-soft); color: var(--warn); }
    .review {
      display: none;
      margin-top: 24px;
      border: 1px solid var(--ink);
      border-radius: 12px;
      background: var(--surface);
      overflow: hidden;
    }
    .review.open { display: block; }
    .review-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; padding: 24px; border-bottom: 1px solid var(--line); }
    .zero-value { color: var(--good); font-size: 14px; line-height: 20px; font-weight: 700; white-space: nowrap; }
    .review-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .review-fact { min-width: 0; padding: 16px 24px; border-bottom: 1px solid var(--line); }
    .review-fact:nth-child(odd) { border-right: 1px solid var(--line); }
    .review-fact span { display: block; margin-bottom: 4px; color: var(--muted); font-size: 12px; line-height: 16px; }
    details { padding: 16px 24px; border-bottom: 1px solid var(--line); }
    summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 600; }
    .calldata {
      display: block;
      max-height: 240px;
      margin-top: 8px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: var(--soft);
      white-space: pre-wrap;
      word-break: break-all;
    }
    .approval { display: grid; gap: 16px; padding: 24px; }
    .check-label { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 12px; align-items: start; color: var(--ink); }
    .check-label input { width: 24px; height: 24px; margin: 0; accent-color: var(--action); }
    .fine-print { margin-top: 24px; color: var(--muted); font-size: 12px; line-height: 16px; }
    [hidden] { display: none !important; }
    @media (max-width: 800px) {
      .shell { width: min(100% - 32px, 640px); padding-top: 24px; }
      .masthead { grid-template-columns: 1fr; align-items: start; }
      .actions { justify-content: flex-start; }
      .workspace { grid-template-columns: 1fr; gap: 32px; }
      .instrument { position: static; }
      .review-grid { grid-template-columns: 1fr; }
      .review-fact:nth-child(odd) { border-right: 0; }
    }
    @media (max-width: 420px) {
      .shell { width: calc(100% - 24px); padding-bottom: 40px; }
      h1 { font-size: 30px; line-height: 36px; }
      .actions { display: grid; width: 100%; }
      .workspace { padding-top: 24px; }
      .step { grid-template-columns: 40px minmax(0, 1fr); padding: 16px; }
      .step-status { grid-column: 2; justify-self: start; }
      .ledger::before { left: 35px; }
      .review-head { display: grid; }
      .instrument-head, .instrument-actions, .approval { padding: 16px; }
      .fact, .review-fact, details { padding: 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
    }
    @media (forced-colors: active) {
      button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible { outline-color: Highlight; }
      .state-mark { forced-color-adjust: none; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#operator-main">Skip to deployment controls</a>
  <main id="operator-main" class="shell">
    <header class="masthead">
      <div>
        <p class="eyebrow">Programmable operator console</p>
        <h1>Classic V4 deployment</h1>
        <p>Review and sign one exact Mainnet transaction at a time.</p>
      </div>
      <div class="actions" aria-label="Wallet controls">
        <button id="switch-network" type="button">Switch to Mainnet</button>
        <button id="connect-wallet" class="primary" type="button">Connect MetaMask</button>
      </div>
    </header>
    <div id="mode-banner" class="mode-banner" ${uiCheck ? "" : "hidden"}>
      UI check mode. Plan fields are real; RPC checks, recording and signing are disabled.
    </div>

    <div class="workspace">
      <aside class="instrument" aria-labelledby="instrument-title">
        <div class="instrument-head">
          <div class="instrument-state">
            <span id="state-mark" class="state-mark" aria-hidden="true"></span>
            <span id="state-label" class="state-label">Not connected</span>
          </div>
          <h2 id="instrument-title">Release instrument</h2>
          <p id="sequence-copy">Four fixed transactions. Zero ETH value.</p>
        </div>
        <dl class="facts">
          <div class="fact">
            <dt>Required account</dt>
            <dd><code>${plan.deployer}</code></dd>
          </div>
          <div class="fact">
            <dt>Network</dt>
            <dd>Ethereum Mainnet · chain 1</dd>
          </div>
          <div class="fact">
            <dt>Starting nonce</dt>
            <dd class="mono">${plan.startingNonce}</dd>
          </div>
          <div class="fact">
            <dt>Plan digest</dt>
            <dd><code>${plan.planDigest}</code></dd>
          </div>
        </dl>
        <div class="instrument-actions">
          <button id="refresh-state" type="button">Refresh live checks</button>
          <button id="prepare-next" class="primary" type="button" disabled>Review next transaction</button>
        </div>
      </aside>

      <section aria-labelledby="ledger-title">
        <div class="ledger-heading">
          <div>
            <h2 id="ledger-title">Sequential ledger</h2>
            <p>Each receipt and runtime unlocks the next nonce.</p>
          </div>
          <code>4 transactions</code>
        </div>
        <ol id="transaction-ledger" class="ledger"></ol>
        <div id="status-message" class="notice" role="status" aria-live="polite"></div>
        <div id="error-message" class="alert" role="alert"></div>

        <section id="review-panel" class="review" aria-labelledby="review-title">
          <div class="review-head">
            <div>
              <p class="eyebrow">Exact wallet request</p>
              <h2 id="review-title">Review transaction</h2>
            </div>
            <span class="zero-value">0 ETH value</span>
          </div>
          <div class="review-grid">
            <div class="review-fact"><span>Sender</span><code id="review-sender"></code></div>
            <div class="review-fact"><span>Nonce</span><code id="review-nonce"></code></div>
            <div class="review-fact"><span>Destination</span><code id="review-destination"></code></div>
            <div class="review-fact"><span>Predicted address</span><code id="review-address"></code></div>
            <div class="review-fact"><span>Calldata hash</span><code id="review-data-hash"></code></div>
            <div class="review-fact"><span>RPC A gas estimate</span><code id="review-gas-a"></code></div>
            <div class="review-fact"><span>RPC B gas estimate</span><code id="review-gas-b"></code></div>
            <div class="review-fact"><span>Padded gas limit</span><code id="review-gas-limit"></code></div>
            <div class="review-fact"><span>Max fee</span><code id="review-max-fee"></code></div>
            <div class="review-fact"><span>Priority fee</span><code id="review-priority-fee"></code></div>
            <div class="review-fact"><span>Maximum gas debit</span><code id="review-max-debit"></code></div>
            <div class="review-fact"><span>Prepared digest</span><code id="review-prepared-digest"></code></div>
          </div>
          <details>
            <summary>Inspect full calldata</summary>
            <code id="review-calldata" class="calldata"></code>
          </details>
          <div class="approval">
            <label class="check-label" for="review-acknowledgement">
              <input id="review-acknowledgement" type="checkbox">
              <span>I verified the sender, nonce, destination, zero ETH value and calldata hash against the sealed plan.</span>
            </label>
            <button id="send-transaction" class="primary" type="button" disabled>Open transaction in MetaMask</button>
          </div>
        </section>
        <p class="fine-print">This local page never reads a private key, never signs, and sends only after the explicit button above plus MetaMask confirmation.</p>
      </section>
    </div>
  </main>
  <script nonce="${nonce}">
    "use strict";
    const config = ${configuration};
    const byId = (id) => document.getElementById(id);
    const elements = {
      switchNetwork: byId("switch-network"),
      connectWallet: byId("connect-wallet"),
      refreshState: byId("refresh-state"),
      prepareNext: byId("prepare-next"),
      sendTransaction: byId("send-transaction"),
      acknowledgement: byId("review-acknowledgement"),
      ledger: byId("transaction-ledger"),
      stateMark: byId("state-mark"),
      stateLabel: byId("state-label"),
      sequenceCopy: byId("sequence-copy"),
      statusMessage: byId("status-message"),
      errorMessage: byId("error-message"),
      reviewPanel: byId("review-panel"),
      reviewTitle: byId("review-title"),
      reviewSender: byId("review-sender"),
      reviewNonce: byId("review-nonce"),
      reviewDestination: byId("review-destination"),
      reviewAddress: byId("review-address"),
      reviewDataHash: byId("review-data-hash"),
      reviewGasA: byId("review-gas-a"),
      reviewGasB: byId("review-gas-b"),
      reviewGasLimit: byId("review-gas-limit"),
      reviewMaxFee: byId("review-max-fee"),
      reviewPriorityFee: byId("review-priority-fee"),
      reviewMaxDebit: byId("review-max-debit"),
      reviewPreparedDigest: byId("review-prepared-digest"),
      reviewCalldata: byId("review-calldata"),
    };
    let provider;
    let account;
    let busy = false;
    let inspection = config.initialInspection;
    let lockedPreparation;
    let providerEventsBound = false;

    function short(value) {
      return value ? value.slice(0, 10) + "…" + value.slice(-8) : "";
    }
    function decimalQuantity(value) {
      if (typeof value !== "string" || !value.startsWith("0x")) return value;
      return BigInt(value).toString(10);
    }
    function gwei(value) {
      if (typeof value !== "string" || !value.startsWith("0x")) return value;
      const wei = BigInt(value);
      const whole = wei / 1000000000n;
      const fractional = (wei % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "");
      return whole.toString() + (fractional ? "." + fractional : "") + " gwei";
    }
    function eth(value) {
      if (typeof value !== "string" || !value.startsWith("0x")) return value;
      const wei = BigInt(value);
      const whole = wei / 1000000000000000000n;
      const fractional = (wei % 1000000000000000000n).toString().padStart(18, "0").slice(0, 8).replace(/0+$/, "");
      return whole.toString() + (fractional ? "." + fractional : "") + " ETH";
    }
    function status(message, tone) {
      elements.statusMessage.textContent = message;
      elements.statusMessage.className = "notice" + (tone ? " " + tone : "");
    }
    function error(message) {
      elements.errorMessage.textContent = message || "";
    }
    function injectedMetaMask() {
      const providers = window.ethereum && window.ethereum.providers;
      if (Array.isArray(providers)) {
        const candidate = providers.find((item) => item && item.isMetaMask);
        if (candidate) return candidate;
      }
      return window.ethereum && window.ethereum.isMetaMask
        ? window.ethereum
        : undefined;
    }
    function walletRequest(method, params) {
      return provider.request({ method: method, params: params || [] });
    }
    function clearReview() {
      lockedPreparation = undefined;
      elements.acknowledgement.checked = false;
      elements.reviewPanel.classList.remove("open");
    }
    function stateLabel(value) {
      const labels = {
        ready: "Ready for review",
        pending: "Receipt pending",
        blocked: "Blocked",
        "awaiting-finality": "Awaiting finality",
        finalized: "Finalized",
        "ui-check": "UI check only",
      };
      return labels[value] || "Not connected";
    }
    function setButtons() {
      const liveReady = account && inspection && inspection.status === "ready";
      const previewReady = config.uiCheck && inspection && inspection.prepared;
      elements.switchNetwork.disabled = busy || config.uiCheck;
      elements.connectWallet.disabled = busy || config.uiCheck;
      elements.refreshState.disabled = busy || config.uiCheck || !account;
      elements.prepareNext.disabled =
        busy || Boolean(lockedPreparation) || !(liveReady || previewReady);
      elements.acknowledgement.disabled = busy;
      elements.sendTransaction.disabled =
        busy || config.uiCheck || !lockedPreparation || !elements.acknowledgement.checked;
      elements.sendTransaction.textContent = config.uiCheck
        ? "Signing disabled in UI check"
        : "Open transaction in MetaMask";
    }
    function render() {
      elements.ledger.replaceChildren();
      const currentStatus = inspection ? inspection.status : "disconnected";
      elements.stateMark.className = "state-mark " + currentStatus;
      elements.stateLabel.textContent = stateLabel(currentStatus);
      const steps = inspection && inspection.steps
        ? inspection.steps
        : config.plan.transactions.map((item, index) => ({
            index: index,
            name: item.name,
            transactionType: item.transactionType,
            nonce: item.nonce,
            predictedAddress: item.predictedAddress,
            dataHash: item.dataHash,
            status: index === 0 ? "next" : "waiting",
          }));
      steps.forEach((step) => {
        const item = document.createElement("li");
        item.className = "step";
        item.dataset.status = step.status;
        const marker = document.createElement("span");
        marker.className = "step-index";
        marker.setAttribute("aria-hidden", "true");
        const copy = document.createElement("div");
        copy.className = "step-copy";
        const title = document.createElement("h3");
        title.textContent = step.name;
        const meta = document.createElement("p");
        meta.className = "step-meta mono";
        meta.textContent = step.transactionType + " · nonce " + step.nonce + " · 0 ETH";
        const address = document.createElement("code");
        address.className = "address";
        address.textContent = step.predictedAddress;
        const dataHash = document.createElement("p");
        dataHash.className = "step-meta mono";
        dataHash.textContent = "Calldata " + short(step.dataHash);
        copy.append(title, meta, address, dataHash);
        if (step.txHash) {
          const hash = document.createElement("p");
          hash.className = "step-meta mono";
          hash.textContent = "Transaction " + short(step.txHash);
          copy.append(hash);
        }
        const badge = document.createElement("span");
        badge.className = "step-status";
        badge.textContent = {
          verified: "Verified",
          pending: "Pending",
          next: "Next",
          waiting: "Waiting",
        }[step.status] || step.status;
        item.append(marker, copy, badge);
        elements.ledger.append(item);
      });
      if (inspection && inspection.sequence) {
        elements.sequenceCopy.textContent =
          inspection.sequence.completedCount + " of 4 receipts and runtimes verified.";
      }
      setButtons();
    }
    async function serverInspection() {
      const response = await fetch("/state", {
        cache: "no-store",
        headers: { "x-operator-token": config.operatorToken },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Live release checks failed");
      return result;
    }
    async function ensureMainnet() {
      const chainId = String(await walletRequest("eth_chainId")).toLowerCase();
      if (chainId !== config.plan.chainIdHex) {
        throw new Error("Select Ethereum Mainnet before continuing");
      }
    }
    async function ensureAccount() {
      const accounts = await walletRequest("eth_accounts");
      const selected = String(accounts[0] || "").toLowerCase();
      if (selected !== config.plan.deployer.toLowerCase()) {
        throw new Error("Select the exact deployment account in MetaMask: " + config.plan.deployer);
      }
      account = selected;
    }
    function bindProviderEvents() {
      if (providerEventsBound || !provider || typeof provider.on !== "function") return;
      providerEventsBound = true;
      provider.on("accountsChanged", () => {
        account = undefined;
        inspection = undefined;
        elements.connectWallet.textContent = "Connect MetaMask";
        elements.connectWallet.classList.add("primary");
        clearReview();
        error("");
        status("Wallet account changed. Reconnect the required account.", "warning");
        render();
      });
      provider.on("chainChanged", () => {
        account = undefined;
        inspection = undefined;
        elements.connectWallet.textContent = "Connect MetaMask";
        elements.connectWallet.classList.add("primary");
        clearReview();
        error("");
        status("Wallet network changed. Refresh checks before continuing.", "warning");
        render();
      });
    }
    async function refresh() {
      if (config.uiCheck) return;
      if (!provider || !account) throw new Error("Connect MetaMask first");
      clearReview();
      error("");
      await ensureMainnet();
      await ensureAccount();
      inspection = await serverInspection();
      render();
      if (inspection.status === "ready") {
        status(inspection.prepared.name + " passed both independent simulations.");
      } else if (inspection.status === "pending") {
        status("The submitted transaction is recorded. Waiting for its receipt and runtime.", "warning");
      } else if (inspection.status === "awaiting-finality") {
        status("All four runtimes are verified. " + inspection.blockingReason + ".", "warning");
      } else if (inspection.status === "finalized") {
        status("All four transactions are finalized and independently verified.", "success");
      } else {
        error(inspection.blockingReason || "Release checks are blocked");
      }
    }
    async function connect() {
      if (busy || config.uiCheck) return;
      busy = true;
      error("");
      status("Waiting for MetaMask.");
      setButtons();
      try {
        provider = injectedMetaMask();
        if (!provider) throw new Error("MetaMask is not available in this browser");
        bindProviderEvents();
        const accounts = await walletRequest("eth_accounts");
        if (!accounts.length) await walletRequest("eth_requestAccounts");
        await ensureMainnet();
        await ensureAccount();
        elements.connectWallet.textContent = "MetaMask connected";
        elements.connectWallet.classList.remove("primary");
        await refresh();
      } catch (caught) {
        account = undefined;
        inspection = undefined;
        elements.connectWallet.textContent = "Connect MetaMask";
        elements.connectWallet.classList.add("primary");
        error(caught && caught.message ? caught.message : String(caught));
        status("Wallet connection is required.");
        render();
      } finally {
        busy = false;
        setButtons();
      }
    }
    async function switchNetwork() {
      if (busy || config.uiCheck) return;
      busy = true;
      error("");
      setButtons();
      try {
        provider = injectedMetaMask();
        if (!provider) throw new Error("MetaMask is not available in this browser");
        bindProviderEvents();
        await walletRequest("wallet_switchEthereumChain", [{ chainId: config.plan.chainIdHex }]);
        status("Ethereum Mainnet selected.", "success");
        const accounts = await walletRequest("eth_accounts");
        if (accounts.length) {
          await ensureAccount();
          await refresh();
        }
      } catch (caught) {
        error(caught && caught.message ? caught.message : String(caught));
      } finally {
        busy = false;
        setButtons();
      }
    }
    function fillReview(prepared) {
      elements.reviewTitle.textContent = "Review " + prepared.name;
      elements.reviewSender.textContent = prepared.request.from;
      elements.reviewNonce.textContent = decimalQuantity(prepared.request.nonce);
      elements.reviewDestination.textContent = prepared.destination || "Contract creation";
      elements.reviewAddress.textContent = prepared.predictedAddress;
      elements.reviewDataHash.textContent = prepared.dataHash;
      elements.reviewGasA.textContent = decimalQuantity(prepared.simulationEstimates[0]);
      elements.reviewGasB.textContent = decimalQuantity(prepared.simulationEstimates[1]);
      elements.reviewGasLimit.textContent = decimalQuantity(prepared.gasLimit);
      elements.reviewMaxFee.textContent = gwei(prepared.request.maxFeePerGas);
      elements.reviewPriorityFee.textContent = gwei(prepared.request.maxPriorityFeePerGas);
      elements.reviewMaxDebit.textContent =
        typeof prepared.maxDebit === "string" && prepared.maxDebit.startsWith("0x")
          ? eth(prepared.maxDebit) + " · " + decimalQuantity(prepared.maxDebit) + " wei"
          : prepared.maxDebit;
      elements.reviewPreparedDigest.textContent = prepared.preparedDigest;
      elements.reviewCalldata.textContent = prepared.calldata;
      elements.reviewPanel.classList.add("open");
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      elements.reviewPanel.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
    async function prepare() {
      if (busy) return;
      busy = true;
      clearReview();
      error("");
      setButtons();
      try {
        if (!config.uiCheck) {
          await ensureMainnet();
          await ensureAccount();
          inspection = await serverInspection();
          if (inspection.status !== "ready" || !inspection.prepared) {
            throw new Error(inspection.blockingReason || "No transaction is ready");
          }
        }
        lockedPreparation = inspection.prepared;
        fillReview(lockedPreparation);
        status(
          config.uiCheck
            ? "Review layout is populated from the supplied plan. Signing remains disabled."
            : "Review every exact field before opening MetaMask.",
          config.uiCheck ? "warning" : "",
        );
      } catch (caught) {
        clearReview();
        error(caught && caught.message ? caught.message : String(caught));
      } finally {
        busy = false;
        setButtons();
      }
    }
    async function postRecord(hash, index, preparedDigest) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetch("/record", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-operator-token": config.operatorToken,
          },
          body: JSON.stringify({
            planDigest: config.plan.planDigest,
            preparedDigest: preparedDigest,
            index: index,
            txHash: hash,
          }),
        });
        const result = await response.json();
        if (response.ok) return result;
        if (response.status !== 409) {
          throw new Error(result.error || "Could not record the submitted transaction");
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error("Transaction was submitted but is not visible on both RPCs after one minute");
    }
    async function waitForReceipt(index) {
      for (let attempt = 0; attempt < 180; attempt += 1) {
        inspection = await serverInspection();
        render();
        if (["verified", "next"].includes(inspection.steps[index].status)) return inspection;
        if (["awaiting-finality", "finalized"].includes(inspection.status)) return inspection;
        if (inspection.status === "blocked") {
          throw new Error(inspection.blockingReason || "Post receipt verification failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error("Transaction hash is recorded, but receipt verification is still pending after six minutes");
    }
    async function send() {
      if (
        busy ||
        config.uiCheck ||
        !lockedPreparation ||
        !elements.acknowledgement.checked
      ) return;
      busy = true;
      error("");
      setButtons();
      const prepared = lockedPreparation;
      let submittedHash;
      try {
        await ensureMainnet();
        await ensureAccount();
        const fresh = await serverInspection();
        if (
          fresh.status !== "ready" ||
          !fresh.prepared ||
          fresh.prepared.preparedDigest !== prepared.preparedDigest
        ) {
          throw new Error("Live state changed. Review the transaction again");
        }
        status("Confirm the exact zero value request in MetaMask.");
        submittedHash = await walletRequest("eth_sendTransaction", [fresh.prepared.request]);
        clearReview();
        status("Transaction submitted. Recording hash " + short(submittedHash) + ".", "warning");
        inspection = await postRecord(
          submittedHash,
          prepared.index,
          prepared.preparedDigest,
        );
        render();
        await waitForReceipt(prepared.index);
        if (inspection.status === "finalized") {
          status("All four transactions are finalized and independently verified.", "success");
        } else {
          status(prepared.name + " receipt and runtime verified.", "success");
        }
      } catch (caught) {
        const message = caught && caught.message ? caught.message : String(caught);
        error(
          submittedHash
            ? "Transaction was sent as " + submittedHash + ". Do not send it again. " + message
            : message,
        );
        if (submittedHash) clearReview();
      } finally {
        busy = false;
        setButtons();
      }
    }

    elements.connectWallet.addEventListener("click", connect);
    elements.switchNetwork.addEventListener("click", switchNetwork);
    elements.refreshState.addEventListener("click", () => {
      if (busy) return;
      busy = true;
      setButtons();
      refresh()
        .catch((caught) => error(caught && caught.message ? caught.message : String(caught)))
        .finally(() => { busy = false; setButtons(); });
    });
    elements.prepareNext.addEventListener("click", prepare);
    elements.sendTransaction.addEventListener("click", send);
    elements.acknowledgement.addEventListener("change", setButtons);
    render();
    if (config.uiCheck) {
      status("UI check mode uses the supplied plan and cannot contact a wallet or RPC.", "warning");
    } else {
      inspection = undefined;
      render();
      status("Connect the exact deployment account to run both live RPC checks.");
    }
  </script>
</body>
</html>`;
}

async function readJsonFile(filePath, label) {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size > MAX_RPC_RESPONSE_BYTES) {
    fail(`${label} must be a bounded regular JSON file`);
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${label} is invalid JSON`);
    throw error;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) fail("Request body is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("Request body is invalid JSON");
  }
}

function responseHeaders() {
  return {
    "cache-control": "no-store, max-age=0",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), geolocation=(), microphone=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...responseHeaders(),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function sendFavicon(response, favicon) {
  response.writeHead(200, {
    ...responseHeaders(),
    "cache-control": "no-store, max-age=0",
    "content-type": "image/png",
  });
  response.end(favicon);
}

function assertLocalRequest(request, port) {
  const host = String(request.headers.host ?? "").toLowerCase();
  if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) {
    fail("Invalid local Host header");
  }
}

function assertSameOriginMutation(request, port, operatorToken) {
  assertLocalRequest(request, port);
  const origin = String(request.headers.origin ?? "").toLowerCase();
  if (
    origin !== `http://${HOST}:${port}` &&
    origin !== `http://localhost:${port}`
  ) {
    fail("Invalid local request origin");
  }
  if (request.headers["x-operator-token"] !== operatorToken) {
    fail("Invalid local operator token");
  }
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) {
    fail("Record request must use application/json");
  }
}

export async function main(
  argv = process.argv.slice(2),
  environment = process.env,
) {
  const options = parseArguments(argv, environment);
  const endpoints = [options.rpcA, options.rpcB];
  const [plan, favicon] = await Promise.all([
    readJsonFile(options.plan, "Classic V4 plan"),
    readFile(faviconPath),
  ]);
  assertExactClassicV4PlanSequence(plan);

  if (options.uiCheck) {
    const operatorToken = randomBytes(24).toString("hex");
    const nonce = randomBytes(18).toString("base64");
    const inspection = buildUiCheckInspection(plan);
    const html = renderHtml({
      plan,
      initialInspection: inspection,
      uiCheck: true,
      operatorToken,
      nonce,
    });
    const server = createServer((request, response) => {
      try {
        assertLocalRequest(request, options.port);
        const url = new URL(request.url ?? "/", `http://${HOST}:${options.port}`);
        if (request.method === "GET" && url.pathname === "/") {
          response.writeHead(200, {
            ...responseHeaders(),
            "content-security-policy":
              `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`,
            "content-type": "text/html; charset=utf-8",
          });
          response.end(html);
          return;
        }
        if (request.method === "GET" && url.pathname === "/favicon.png") {
          sendFavicon(response, favicon);
          return;
        }
        if (request.method === "GET" && url.pathname === "/state") {
          sendJson(response, 200, inspection);
          return;
        }
        sendJson(response, 404, { error: "Not found" });
      } catch (error) {
        sendJson(response, 400, { error: error?.message ?? String(error) });
      }
    });
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.listen(options.port, HOST, () => {
      process.stdout.write(
        `Classic V4 UI check console: http://${HOST}:${options.port}\n`,
      );
      process.stdout.write("Wallet, RPC, recording and signing are disabled.\n");
    });
    return server;
  }

  await assertExternalRecordPath(options.transactions);
  const artifacts = await loadClassicV4SealedBuild(plan);
  const initialInspection = await inspectDeployment(
    plan,
    artifacts,
    endpoints,
    options.transactions,
  );
  if (options.check) {
    process.stdout.write(`${JSON.stringify(initialInspection, null, 2)}\n`);
    if (initialInspection.status === "blocked") process.exitCode = 2;
    return;
  }

  const operatorToken = randomBytes(24).toString("hex");
  const nonce = randomBytes(18).toString("base64");
  const html = renderHtml({
    plan,
    initialInspection: null,
    uiCheck: false,
    operatorToken,
    nonce,
  });
  let recordBusy = false;
  const preparedByDigest = new Map();
  const rememberPreparation = (prepared) => {
    if (!prepared?.preparedDigest) return;
    preparedByDigest.set(prepared.preparedDigest, prepared);
    while (preparedByDigest.size > 8) {
      preparedByDigest.delete(preparedByDigest.keys().next().value);
    }
  };
  rememberPreparation(initialInspection.prepared);
  const server = createServer(async (request, response) => {
    try {
      assertLocalRequest(request, options.port);
      const url = new URL(request.url ?? "/", `http://${HOST}:${options.port}`);
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          ...responseHeaders(),
          "content-security-policy":
            `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`,
          "content-type": "text/html; charset=utf-8",
        });
        response.end(html);
        return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.png") {
        sendFavicon(response, favicon);
        return;
      }
      if (request.method === "GET" && url.pathname === "/state") {
        if (request.headers["x-operator-token"] !== operatorToken) {
          fail("Invalid local operator token");
        }
        const inspection = await inspectDeployment(
          plan,
          artifacts,
          endpoints,
          options.transactions,
        );
        rememberPreparation(inspection.prepared);
        sendJson(response, 200, inspection);
        return;
      }
      if (request.method === "POST" && url.pathname === "/record") {
        assertSameOriginMutation(request, options.port, operatorToken);
        if (recordBusy) {
          sendJson(response, 409, { error: "Another record operation is active" });
          return;
        }
        recordBusy = true;
        try {
          const body = await readJsonBody(request);
          if (normalizeHex(body.planDigest) !== normalizeHex(plan.planDigest)) {
            fail("Classic V4 plan digest changed");
          }
          const prepared = preparedByDigest.get(body.preparedDigest);
          if (!prepared || prepared.index !== Number(body.index)) {
            fail("Reviewed transaction preparation is missing or expired");
          }
          const inspection = await recordSubmittedTransaction({
            plan,
            artifacts,
            endpoints,
            recordPath: options.transactions,
            index: Number(body.index),
            hash: body.txHash,
            prepared,
          });
          rememberPreparation(inspection.prepared);
          sendJson(response, 200, inspection);
        } finally {
          recordBusy = false;
        }
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const message = error?.message ?? String(error);
      const retryable =
        message.includes("not visible on both RPCs") ||
        message.includes("RPCs disagree on the recorded transaction");
      sendJson(response, retryable ? 409 : 400, { error: message });
    }
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.listen(options.port, HOST, () => {
    process.stdout.write(
      `Classic V4 MetaMask deployment console: http://${HOST}:${options.port}\n`,
    );
    process.stdout.write(
      `Loaded four exact plan transactions. External hash record: ${options.transactions}\n`,
    );
  });
  return server;
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`Classic V4 deployment console failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
