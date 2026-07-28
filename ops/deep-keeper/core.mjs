import { getAddress, keccak256, parseAbi } from "viem";
import { DEEP_RELEASE_MANIFEST_PATH } from "./release-gate.mjs";

export const DEEP_KEEPER_ABI = parseAbi([
  "function registeredVaultCount() view returns (uint256)",
  "function registeredVaultAt(uint256 index) view returns (address)",
  "function scan(uint256 cursor,uint256 limit) view returns ((address vault,uint8 action)[] ready,uint256 nextCursor)",
  "function performBatch(address[] candidates) returns (uint256 attempted,uint256 succeeded)",
]);

export const ACTION = Object.freeze({
  none: 0,
  processFees: 1,
  compoundPending: 2,
  growOracle: 3,
});

export const DEFAULT_SIMULATION_ACCOUNT =
  "0x000000000000000000000000000000000000dEaD";
export const DEFAULT_VAULT_SUBSIDY_CAP_WEI = 30_000_000_000_000_000n;
export const DEFAULT_MAX_BATCH_SIZE = 4;
export const DEFAULT_MAX_GAS = 3_000_000n;
export const EXTENDED_BATCH_MIN_GAS = 6_000_000n;
export const MAX_OPERATIONAL_BATCH_SIZE = 8;
export const KEEPER_STATE_SCHEMA_VERSION = 2;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const PRIVATE_KEY_ENV_NAMES = [
  "DEEP_KEEPER_PRIVATE_KEY",
  "DEEP_KEEPER_MNEMONIC",
  "PRIVATE_KEY",
  "MNEMONIC",
];

export class DeepKeeperError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = "DeepKeeperError";
    this.code = code;
    this.context = context;
  }
}

function requiredAddress(value, label) {
  if (!ADDRESS_PATTERN.test(value ?? "")) {
    throw new DeepKeeperError("INVALID_CONFIG", `${label} must be an address`);
  }
  return getAddress(value);
}

function requiredHash(value, label) {
  if (!HASH_PATTERN.test(value ?? "")) {
    throw new DeepKeeperError("INVALID_CONFIG", `${label} must be 32 bytes`);
  }
  return value.toLowerCase();
}

function integer(value, fallback, label, minimum, maximum) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new DeepKeeperError(
      "INVALID_CONFIG",
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
}

function unsignedBigInt(value, fallback, label) {
  const raw = value === undefined || value === "" ? fallback : value;
  try {
    const parsed = BigInt(raw);
    if (parsed <= 0n) throw new Error();
    return parsed;
  } catch {
    throw new DeepKeeperError(
      "INVALID_CONFIG",
      `${label} must be a positive integer`,
    );
  }
}

function exactBoolean(value, label) {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new DeepKeeperError(
    "INVALID_CONFIG",
    `${label} must be exactly true or false`,
  );
}

function requiredHttpsUrl(value, label) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new DeepKeeperError(
      "INVALID_CONFIG",
      `${label} must be an HTTPS URL`,
    );
  }
}

export function parseKeeperConfig(env = process.env) {
  for (const name of PRIVATE_KEY_ENV_NAMES) {
    if (env[name]) {
      throw new DeepKeeperError(
        "PRIVATE_KEY_REJECTED",
        `${name} is not accepted; use a dedicated remote signer`,
      );
    }
  }

  const enabled = exactBoolean(env.DEEP_KEEPER_ENABLED, "DEEP_KEEPER_ENABLED");
  const sendTransactions = exactBoolean(
    env.DEEP_KEEPER_SEND_TRANSACTIONS,
    "DEEP_KEEPER_SEND_TRANSACTIONS",
  );
  if (enabled !== sendTransactions) {
    throw new DeepKeeperError(
      "INVALID_CONFIG",
      "Activation requires both DEEP_KEEPER_ENABLED=true and DEEP_KEEPER_SEND_TRANSACTIONS=true",
    );
  }

  const chainId = integer(
    env.DEEP_KEEPER_CHAIN_ID,
    1,
    "DEEP_KEEPER_CHAIN_ID",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (chainId !== 1) {
    throw new DeepKeeperError(
      "INVALID_CONFIG",
      "The production Deep keeper is pinned to Ethereum Mainnet",
    );
  }

  const rpcUrls = String(env.DEEP_KEEPER_RPC_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) =>
      requiredHttpsUrl(value, `DEEP_KEEPER_RPC_URLS[${index}]`),
    );
  if (rpcUrls.length !== 2 || new Set(rpcUrls).size !== 2) {
    throw new DeepKeeperError(
      "INVALID_CONFIG",
      "DEEP_KEEPER_RPC_URLS must contain two distinct HTTPS endpoints",
    );
  }

  const signerAddress = env.DEEP_KEEPER_SIGNER_ADDRESS
    ? requiredAddress(
        env.DEEP_KEEPER_SIGNER_ADDRESS,
        "DEEP_KEEPER_SIGNER_ADDRESS",
      )
    : null;
  const signerRpcUrl = env.DEEP_KEEPER_SIGNER_RPC_URL
    ? requiredHttpsUrl(
        env.DEEP_KEEPER_SIGNER_RPC_URL,
        "DEEP_KEEPER_SIGNER_RPC_URL",
      )
    : null;
  if (enabled && (!signerAddress || !signerRpcUrl)) {
    throw new DeepKeeperError(
      "INVALID_CONFIG",
      "Enabled execution requires a dedicated signer address and remote signer RPC",
    );
  }
  if (signerRpcUrl && rpcUrls.includes(signerRpcUrl)) {
    throw new DeepKeeperError(
      "INVALID_CONFIG",
      "The signer RPC must be separate from both read RPCs",
    );
  }

  const maxBatchSize = integer(
    env.DEEP_KEEPER_MAX_BATCH_SIZE,
    DEFAULT_MAX_BATCH_SIZE,
    "DEEP_KEEPER_MAX_BATCH_SIZE",
    1,
    MAX_OPERATIONAL_BATCH_SIZE,
  );
  const maxGas = unsignedBigInt(
    env.DEEP_KEEPER_MAX_GAS,
    DEFAULT_MAX_GAS,
    "DEEP_KEEPER_MAX_GAS",
  );
  if (
    maxBatchSize > DEFAULT_MAX_BATCH_SIZE &&
    maxGas < EXTENDED_BATCH_MIN_GAS
  ) {
    throw new DeepKeeperError(
      "INVALID_CONFIG",
      `Batches above ${DEFAULT_MAX_BATCH_SIZE} require DEEP_KEEPER_MAX_GAS of at least ${EXTENDED_BATCH_MIN_GAS}`,
      {
        maxBatchSize,
        maxGas: maxGas.toString(),
      },
    );
  }
  const releaseManifest =
    env.DEEP_KEEPER_RELEASE_MANIFEST ||
    DEEP_RELEASE_MANIFEST_PATH;
  if (releaseManifest !== DEEP_RELEASE_MANIFEST_PATH) {
    throw new DeepKeeperError(
      "INVALID_CONFIG",
      `DEEP_KEEPER_RELEASE_MANIFEST must be ${DEEP_RELEASE_MANIFEST_PATH}`,
    );
  }

  return Object.freeze({
    enabled,
    chainId,
    coordinatorAddress: requiredAddress(
      env.DEEP_KEEPER_COORDINATOR_ADDRESS,
      "DEEP_KEEPER_COORDINATOR_ADDRESS",
    ),
    coordinatorRuntimeHash: requiredHash(
      env.DEEP_KEEPER_COORDINATOR_RUNTIME_HASH,
      "DEEP_KEEPER_COORDINATOR_RUNTIME_HASH",
    ),
    rpcUrls,
    signerAddress,
    signerRpcUrl,
    simulationAccount: env.DEEP_KEEPER_SIMULATION_ACCOUNT
      ? requiredAddress(
          env.DEEP_KEEPER_SIMULATION_ACCOUNT,
          "DEEP_KEEPER_SIMULATION_ACCOUNT",
        )
      : DEFAULT_SIMULATION_ACCOUNT,
    confirmations: integer(
      env.DEEP_KEEPER_CONFIRMATIONS,
      12,
      "DEEP_KEEPER_CONFIRMATIONS",
      2,
      128,
    ),
    intervalMs: integer(
      env.DEEP_KEEPER_INTERVAL_MS,
      300_000,
      "DEEP_KEEPER_INTERVAL_MS",
      240_000,
      600_000,
    ),
    maxBatchSize,
    scanLimit: integer(
      env.DEEP_KEEPER_SCAN_LIMIT,
      maxBatchSize,
      "DEEP_KEEPER_SCAN_LIMIT",
      1,
      maxBatchSize,
    ),
    maxGas,
    maxFeePerGasWei: unsignedBigInt(
      env.DEEP_KEEPER_MAX_FEE_PER_GAS_WEI,
      100_000_000_000n,
      "DEEP_KEEPER_MAX_FEE_PER_GAS_WEI",
    ),
    maxSignerBalanceWei: unsignedBigInt(
      env.DEEP_KEEPER_MAX_SIGNER_BALANCE_WEI,
      500_000_000_000_000_000n,
      "DEEP_KEEPER_MAX_SIGNER_BALANCE_WEI",
    ),
    vaultSubsidyCapWei: unsignedBigInt(
      env.DEEP_KEEPER_VAULT_SUBSIDY_CAP_WEI,
      DEFAULT_VAULT_SUBSIDY_CAP_WEI,
      "DEEP_KEEPER_VAULT_SUBSIDY_CAP_WEI",
    ),
    pendingTimeoutMs: integer(
      env.DEEP_KEEPER_PENDING_TIMEOUT_MS,
      1_800_000,
      "DEEP_KEEPER_PENDING_TIMEOUT_MS",
      600_000,
      7_200_000,
    ),
    stateFile:
      env.DEEP_KEEPER_STATE_FILE || "./var/deep-keeper-state.json",
    releaseManifest,
    healthHost: env.DEEP_KEEPER_HEALTH_HOST || "127.0.0.1",
    healthPort: integer(
      env.DEEP_KEEPER_HEALTH_PORT,
      9464,
      "DEEP_KEEPER_HEALTH_PORT",
      1,
      65_535,
    ),
  });
}

export function createInitialState(config) {
  return {
    schemaVersion: KEEPER_STATE_SCHEMA_VERSION,
    chainId: config.chainId,
    coordinatorAddress: config.coordinatorAddress,
    cursor: 0,
    checkpoint: null,
    pendingTransaction: null,
    recentTransactions: [],
    vaultSubsidies: {},
  };
}

function decimalString(value, label, { positive = false } = {}) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value ?? ""))) {
    fail("INVALID_STATE", `${label} must be an unsigned decimal string`);
  }
  const parsed = BigInt(value);
  if (positive && parsed === 0n) {
    fail("INVALID_STATE", `${label} must be greater than zero`);
  }
  return parsed;
}

function normalizeSubsidyEntry(entry, key) {
  const simulatedCostWei = decimalString(
    entry?.simulatedCostWei ?? "0",
    `vaultSubsidies.${key}.simulatedCostWei`,
  );
  const actualCostWei = decimalString(
    entry?.actualCostWei ?? "0",
    `vaultSubsidies.${key}.actualCostWei`,
  );
  const transactionCount = Number(entry?.transactionCount ?? 0);
  const lastUpdatedAtMs = Number(entry?.lastUpdatedAtMs ?? 0);
  if (
    !Number.isSafeInteger(transactionCount) ||
    transactionCount < 0 ||
    !Number.isSafeInteger(lastUpdatedAtMs) ||
    lastUpdatedAtMs < 0
  ) {
    fail("INVALID_STATE", `vaultSubsidies.${key} metadata is invalid`);
  }
  return {
    simulatedCostWei: simulatedCostWei.toString(),
    actualCostWei: actualCostWei.toString(),
    transactionCount,
    lastUpdatedAtMs,
  };
}

function normalizePendingTransaction(pending, config) {
  if (pending === null || pending === undefined) return null;
  if (
    !HASH_PATTERN.test(pending.hash ?? "") ||
    !Number.isSafeInteger(pending.submittedAtMs) ||
    pending.submittedAtMs < 0 ||
    !Array.isArray(pending.candidates) ||
    pending.candidates.length === 0 ||
    pending.candidates.length > config.maxBatchSize
  ) {
    fail("INVALID_STATE", "Pending transaction metadata is invalid");
  }
  const candidates = pending.candidates.map((candidate) =>
    requiredAddress(candidate, "pendingTransaction.candidates"),
  );
  if (new Set(candidates.map((candidate) => candidate.toLowerCase())).size !== candidates.length) {
    fail("INVALID_STATE", "Pending transaction contains duplicate vaults");
  }
  const gas = decimalString(pending.gas, "pendingTransaction.gas", {
    positive: true,
  });
  const maxFeePerGas = decimalString(
    pending.maxFeePerGas,
    "pendingTransaction.maxFeePerGas",
    { positive: true },
  );
  const maximumTransactionCostWei = decimalString(
    pending.maximumTransactionCostWei ?? gas * maxFeePerGas,
    "pendingTransaction.maximumTransactionCostWei",
    { positive: true },
  );
  if (maximumTransactionCostWei > gas * maxFeePerGas) {
    fail(
      "INVALID_STATE",
      "Pending maximum transaction cost exceeds its gas envelope",
    );
  }

  const sourceReservations = pending.perVaultReservedWei ?? {};
  const sourceGasWeights = pending.perVaultEstimatedGas ?? {};
  const perVaultReservedWei = {};
  const perVaultEstimatedGas = {};
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    const fallbackReservation =
      (maximumTransactionCostWei + BigInt(candidates.length) - 1n) /
      BigInt(candidates.length);
    perVaultReservedWei[key] = decimalString(
      sourceReservations[key] ?? fallbackReservation,
      `pendingTransaction.perVaultReservedWei.${key}`,
      { positive: true },
    ).toString();
    perVaultEstimatedGas[key] = decimalString(
      sourceGasWeights[key] ?? gas,
      `pendingTransaction.perVaultEstimatedGas.${key}`,
      { positive: true },
    ).toString();
  }
  return {
    hash: pending.hash.toLowerCase(),
    submittedAtMs: pending.submittedAtMs,
    candidates,
    gas: gas.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maximumTransactionCostWei: maximumTransactionCostWei.toString(),
    perVaultReservedWei,
    perVaultEstimatedGas,
    reservationPolicy:
      pending.reservationPolicy === "batch-envelope-v1"
        ? "batch-envelope-v1"
        : "legacy-v1",
    subsidyCapWeiAtSubmission: decimalString(
      pending.subsidyCapWeiAtSubmission ?? config.vaultSubsidyCapWei,
      "pendingTransaction.subsidyCapWeiAtSubmission",
      { positive: true },
    ).toString(),
  };
}

export function migrateKeeperState(state, config) {
  if (
    (state?.schemaVersion !== 1 &&
      state?.schemaVersion !== KEEPER_STATE_SCHEMA_VERSION) ||
    state.chainId !== config.chainId ||
    String(state.coordinatorAddress).toLowerCase() !==
      config.coordinatorAddress.toLowerCase() ||
    !Number.isSafeInteger(state.cursor) ||
    state.cursor < 0 ||
    !Array.isArray(state.recentTransactions)
  ) {
    throw new DeepKeeperError(
      "INVALID_STATE",
      "Keeper state does not match the configured deployment",
    );
  }
  const vaultSubsidies = {};
  for (const [address, entry] of Object.entries(state.vaultSubsidies ?? {})) {
    let normalizedAddress;
    try {
      normalizedAddress = getAddress(address).toLowerCase();
    } catch {
      fail("INVALID_STATE", `Invalid subsidy vault address: ${address}`);
    }
    if (vaultSubsidies[normalizedAddress]) {
      fail("INVALID_STATE", "Duplicate subsidy vault address");
    }
    vaultSubsidies[normalizedAddress] = normalizeSubsidyEntry(
      entry,
      normalizedAddress,
    );
  }
  const pendingTransaction = normalizePendingTransaction(
    state.pendingTransaction,
    config,
  );
  if (pendingTransaction?.reservationPolicy === "batch-envelope-v1") {
    const capAtSubmission = BigInt(
      pendingTransaction.subsidyCapWeiAtSubmission,
    );
    const maximumTransactionCostWei = BigInt(
      pendingTransaction.maximumTransactionCostWei,
    );
    for (const candidate of pendingTransaction.candidates) {
      const key = candidate.toLowerCase();
      const reservation = BigInt(
        pendingTransaction.perVaultReservedWei[key],
      );
      const spent = BigInt(vaultSubsidies[key]?.actualCostWei ?? "0");
      if (
        reservation !== maximumTransactionCostWei ||
        spent + reservation > capAtSubmission
      ) {
        fail(
          "INVALID_STATE",
          "Pending subsidy reservation violates its hard-cap envelope",
          { vault: candidate },
        );
      }
    }
  }
  return {
    schemaVersion: KEEPER_STATE_SCHEMA_VERSION,
    chainId: state.chainId,
    coordinatorAddress: config.coordinatorAddress,
    cursor: state.cursor,
    checkpoint: state.checkpoint ?? null,
    pendingTransaction,
    recentTransactions: state.recentTransactions.slice(0, 16),
    vaultSubsidies,
  };
}

export function validateState(state, config) {
  return migrateKeeperState(state, config);
}

export function createMetrics() {
  return {
    cycles: 0,
    cycleFailures: 0,
    rpcDisagreements: 0,
    reorgs: 0,
    readyVaults: 0,
    simulations: 0,
    simulationFailures: 0,
    batchesSubmitted: 0,
    transactionsConfirmed: 0,
    transactionsReverted: 0,
    transactionsDropped: 0,
    subsidyVaultsSkipped: 0,
    subsidyVaultsExhausted: 0,
    subsidyBudgetOverruns: 0,
    subsidySimulatedCostWei: "0",
    subsidyActualCostWei: "0",
    lastSuccessTimestampSeconds: 0,
  };
}

function fail(code, message, context = {}) {
  throw new DeepKeeperError(code, message, context);
}

function addWeiMetric(metrics, name, amount) {
  metrics[name] = (BigInt(metrics[name] ?? "0") + amount).toString();
}

function subsidyEntry(state, vault) {
  const key = getAddress(vault).toLowerCase();
  state.vaultSubsidies[key] ??= {
    simulatedCostWei: "0",
    actualCostWei: "0",
    transactionCount: 0,
    lastUpdatedAtMs: 0,
  };
  return { key, entry: state.vaultSubsidies[key] };
}

function addSimulatedSubsidyCost(state, vault, amount, nowMs) {
  const { entry } = subsidyEntry(state, vault);
  entry.simulatedCostWei = (
    BigInt(entry.simulatedCostWei) + amount
  ).toString();
  entry.lastUpdatedAtMs = nowMs;
}

function addActualSubsidyCost(state, vault, amount, nowMs) {
  const { entry } = subsidyEntry(state, vault);
  entry.actualCostWei = (BigInt(entry.actualCostWei) + amount).toString();
  entry.transactionCount += 1;
  entry.lastUpdatedAtMs = nowMs;
}

function actualSubsidyCost(state, vault) {
  return BigInt(
    state.vaultSubsidies[getAddress(vault).toLowerCase()]?.actualCostWei ?? "0",
  );
}

export function allocateWeiByWeight(totalWei, candidates, weightsByVault) {
  if (totalWei < 0n || candidates.length === 0) {
    fail("INVALID_STATE", "Gas allocation inputs are invalid");
  }
  const normalized = candidates.map((candidate, index) => {
    const vault = getAddress(candidate);
    const key = vault.toLowerCase();
    const weight = decimalString(
      weightsByVault[key],
      `gas weight for ${vault}`,
      { positive: true },
    );
    return { vault, key, weight, index };
  });
  const weightTotal = normalized.reduce(
    (total, item) => total + item.weight,
    0n,
  );
  const allocations = {};
  const remainders = [];
  let allocated = 0n;
  for (const item of normalized) {
    const numerator = totalWei * item.weight;
    const amount = numerator / weightTotal;
    allocations[item.key] = amount;
    allocated += amount;
    remainders.push({
      key: item.key,
      remainder: numerator % weightTotal,
      index: item.index,
    });
  }
  remainders.sort((left, right) => {
    if (left.remainder === right.remainder) {
      return left.index - right.index;
    }
    return left.remainder > right.remainder ? -1 : 1;
  });
  let remainder = totalWei - allocated;
  for (const item of remainders) {
    if (remainder === 0n) break;
    allocations[item.key] += 1n;
    remainder -= 1n;
  }
  return allocations;
}

function comparable(value) {
  return JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function sameHex(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function normalizeBlock(block) {
  if (!block?.hash || block.number === null || block.number === undefined) {
    fail("RPC_INVALID_RESPONSE", "RPC returned an incomplete block");
  }
  return {
    number: BigInt(block.number),
    hash: block.hash.toLowerCase(),
  };
}

async function readBlockPair(readers, blockNumber) {
  const blocks = await Promise.all(
    readers.map((client) => client.getBlock({ blockNumber })),
  );
  const normalized = blocks.map(normalizeBlock);
  if (
    normalized[0].number !== normalized[1].number ||
    normalized[0].hash !== normalized[1].hash
  ) {
    fail("RPC_DISAGREEMENT", "Read RPCs disagree on a block", {
      blockNumber: blockNumber.toString(),
      blocks: normalized,
    });
  }
  return normalized[0];
}

export async function readAgreedSnapshot(readers, config) {
  if (!Array.isArray(readers) || readers.length !== 2) {
    fail("INVALID_RUNTIME", "Exactly two read clients are required");
  }
  const chainIds = await Promise.all(readers.map((client) => client.getChainId()));
  if (
    chainIds[0] !== config.chainId ||
    chainIds[1] !== config.chainId
  ) {
    fail("RPC_DISAGREEMENT", "Read RPC chain IDs do not match Mainnet", {
      chainIds,
    });
  }

  const heads = await Promise.all(
    readers.map((client) => client.getBlockNumber()),
  );
  const lowestHead = heads[0] < heads[1] ? heads[0] : heads[1];
  if (lowestHead <= BigInt(config.confirmations)) {
    fail("RPC_NOT_READY", "Read RPCs have not reached the confirmation depth");
  }
  const confirmedNumber = lowestHead - BigInt(config.confirmations);
  const confirmedBlock = await readBlockPair(readers, confirmedNumber);

  const codes = await Promise.all(
    readers.map((client) =>
      client.getCode({
        address: config.coordinatorAddress,
        blockNumber: confirmedNumber,
      }),
    ),
  );
  if (!codes[0] || codes[0] === "0x" || !sameHex(codes[0], codes[1])) {
    fail(
      "RPC_DISAGREEMENT",
      "Read RPCs disagree on the coordinator bytecode",
    );
  }
  const runtimeHash = keccak256(codes[0]).toLowerCase();
  if (runtimeHash !== config.coordinatorRuntimeHash) {
    fail("COORDINATOR_MISMATCH", "Coordinator runtime hash mismatch", {
      actual: runtimeHash,
      expected: config.coordinatorRuntimeHash,
    });
  }

  return {
    heads,
    confirmedBlock,
  };
}

async function detectReorg(readers, state, confirmedBlock) {
  const checkpoint = state.checkpoint;
  if (!checkpoint) return false;
  const checkpointNumber = BigInt(checkpoint.number);
  if (checkpointNumber > confirmedBlock.number) return true;
  const canonical = await readBlockPair(readers, checkpointNumber);
  return canonical.hash !== String(checkpoint.hash).toLowerCase();
}

function normalizeWork(work) {
  const vault = getAddress(work?.vault ?? work?.[0]);
  const action = Number(work?.action ?? work?.[1]);
  if (
    action !== ACTION.processFees &&
    action !== ACTION.compoundPending &&
    action !== ACTION.growOracle
  ) {
    fail("RPC_INVALID_RESPONSE", "Coordinator returned an invalid action", {
      vault,
      action,
    });
  }
  return { vault, action };
}

function normalizeScanResult(result) {
  const ready = (result?.[0] ?? result?.ready ?? []).map(normalizeWork);
  const nextCursor = Number(result?.[1] ?? result?.nextCursor);
  if (!Number.isSafeInteger(nextCursor) || nextCursor < 0) {
    fail("RPC_INVALID_RESPONSE", "Coordinator returned an invalid cursor");
  }
  const seen = new Set();
  for (const item of ready) {
    const key = item.vault.toLowerCase();
    if (seen.has(key)) {
      fail("RPC_INVALID_RESPONSE", "Coordinator returned a duplicate vault", {
        vault: item.vault,
      });
    }
    seen.add(key);
  }
  return { ready, nextCursor };
}

async function discoverReady(readers, config, state, blockNumber) {
  const counts = await Promise.all(
    readers.map((client) =>
      client.readContract({
        address: config.coordinatorAddress,
        abi: DEEP_KEEPER_ABI,
        functionName: "registeredVaultCount",
        blockNumber,
      }),
    ),
  );
  if (BigInt(counts[0]) !== BigInt(counts[1])) {
    fail("RPC_DISAGREEMENT", "Read RPCs disagree on the vault count", {
      counts,
    });
  }
  const registryCount = BigInt(counts[0]);
  if (registryCount === 0n) {
    return { registryCount, ready: [], nextCursor: 0 };
  }

  const results = await Promise.all(
    readers.map((client) =>
      client.readContract({
        address: config.coordinatorAddress,
        abi: DEEP_KEEPER_ABI,
        functionName: "scan",
        args: [BigInt(state.cursor), BigInt(config.scanLimit)],
        blockNumber,
      }),
    ),
  );
  const normalized = results.map(normalizeScanResult);
  if (comparable(normalized[0]) !== comparable(normalized[1])) {
    fail("RPC_DISAGREEMENT", "Read RPCs disagree on ready Deep work", {
      results: normalized,
    });
  }
  if (normalized[0].ready.length > config.maxBatchSize) {
    fail("RPC_INVALID_RESPONSE", "Ready work exceeds the local batch limit");
  }
  return { registryCount, ...normalized[0] };
}

function normalizeSimulation(simulation) {
  const result = simulation?.result ?? simulation;
  const attempted = BigInt(result?.[0] ?? result?.attempted ?? -1);
  const succeeded = BigInt(result?.[1] ?? result?.succeeded ?? -1);
  return { attempted, succeeded };
}

async function simulateBatch(
  readers,
  config,
  candidates,
  account,
  blockNumber,
) {
  const simulations = await Promise.all(
    readers.map((client) =>
      client.simulateContract({
        address: config.coordinatorAddress,
        abi: DEEP_KEEPER_ABI,
        functionName: "performBatch",
        args: [candidates],
        account,
        blockNumber,
      }),
    ),
  );
  const normalized = simulations.map(normalizeSimulation);
  if (comparable(normalized[0]) !== comparable(normalized[1])) {
    fail("RPC_DISAGREEMENT", "Read RPCs disagree on batch simulation", {
      simulations: normalized,
    });
  }
  const expected = BigInt(candidates.length);
  if (
    normalized[0].attempted !== expected ||
    normalized[0].succeeded !== expected
  ) {
    fail(
      "SIMULATION_REJECTED",
      "The complete ready batch did not simulate successfully",
      {
        expected: expected.toString(),
        attempted: normalized[0].attempted.toString(),
        succeeded: normalized[0].succeeded.toString(),
      },
    );
  }
  return normalized[0];
}

function receiptNotFound(error) {
  return (
    error?.name === "TransactionReceiptNotFoundError" ||
    String(error?.message ?? "").includes("could not be found") ||
    String(error?.shortMessage ?? "").includes("could not be found")
  );
}

async function maybeReceipt(client, hash) {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (receiptNotFound(error)) return null;
    throw error;
  }
}

async function reconcilePending(
  readers,
  config,
  state,
  metrics,
  confirmedBlock,
  nowMs,
) {
  const pending = state.pendingTransaction;
  if (!pending) {
    return { waiting: false, retryDeferred: false, outcome: null };
  }
  if (!HASH_PATTERN.test(pending.hash ?? "")) {
    fail("INVALID_STATE", "Pending transaction hash is invalid");
  }

  const receipts = await Promise.all(
    readers.map((client) => maybeReceipt(client, pending.hash)),
  );
  if (!receipts[0] && !receipts[1]) {
    if (nowMs - pending.submittedAtMs < config.pendingTimeoutMs) {
      return {
        waiting: true,
        retryDeferred: false,
        outcome: "waiting-for-confirmation",
      };
    }
    state.pendingTransaction = null;
    metrics.transactionsDropped += 1;
    return {
      waiting: false,
      retryDeferred: true,
      outcome: "pending-dropped-retry-next-cycle",
    };
  }
  if (!receipts[0] || !receipts[1]) {
    return {
      waiting: true,
      retryDeferred: false,
      outcome: "waiting-for-confirmation",
    };
  }

  const summaries = receipts.map((receipt) => {
    const gasUsed = BigInt(receipt.gasUsed ?? 0n);
    const effectiveGasPrice = BigInt(receipt.effectiveGasPrice ?? 0n);
    if (
      gasUsed <= 0n ||
      effectiveGasPrice <= 0n ||
      (receipt.status !== "success" && receipt.status !== "reverted")
    ) {
      fail(
        "RPC_INVALID_RESPONSE",
        "RPC returned incomplete receipt cost accounting",
      );
    }
    return {
      blockNumber: BigInt(receipt.blockNumber),
      blockHash: String(receipt.blockHash).toLowerCase(),
      status: receipt.status,
      transactionHash: String(receipt.transactionHash).toLowerCase(),
      gasUsed,
      effectiveGasPrice,
    };
  });
  if (comparable(summaries[0]) !== comparable(summaries[1])) {
    fail("RPC_DISAGREEMENT", "Read RPCs disagree on the pending receipt", {
      receipts: summaries,
    });
  }
  const receipt = summaries[0];
  if (receipt.transactionHash !== pending.hash.toLowerCase()) {
    fail("RPC_INVALID_RESPONSE", "Receipt hash does not match pending state");
  }
  if (receipt.blockNumber > confirmedBlock.number) {
    return {
      waiting: true,
      retryDeferred: false,
      outcome: "waiting-for-confirmation",
    };
  }

  const canonical = await readBlockPair(readers, receipt.blockNumber);
  if (canonical.hash !== receipt.blockHash) {
    state.pendingTransaction = null;
    state.cursor = 0;
    state.checkpoint = null;
    metrics.reorgs += 1;
    return {
      waiting: false,
      retryDeferred: false,
      outcome: "pending-reorged",
    };
  }

  const actualCostWei = receipt.gasUsed * receipt.effectiveGasPrice;
  const maximumTransactionCostWei = BigInt(
    pending.maximumTransactionCostWei,
  );
  if (actualCostWei > maximumTransactionCostWei) {
    metrics.subsidyBudgetOverruns += 1;
    fail(
      "SUBSIDY_ACCOUNTING_REJECTED",
      "Actual transaction cost exceeds the persisted gas envelope",
      {
        actualCostWei: actualCostWei.toString(),
        maximumTransactionCostWei: maximumTransactionCostWei.toString(),
      },
    );
  }
  const allocations = allocateWeiByWeight(
    actualCostWei,
    pending.candidates,
    pending.perVaultEstimatedGas,
  );
  for (const candidate of pending.candidates) {
    const key = candidate.toLowerCase();
    const previousCostWei = actualSubsidyCost(state, candidate);
    const reservedCostWei = BigInt(pending.perVaultReservedWei[key]);
    const capAtSubmission = BigInt(pending.subsidyCapWeiAtSubmission);
    if (
      pending.reservationPolicy === "batch-envelope-v1" &&
      (allocations[key] > reservedCostWei ||
        previousCostWei + allocations[key] > capAtSubmission)
    ) {
      metrics.subsidyBudgetOverruns += 1;
      fail(
        "SUBSIDY_ACCOUNTING_REJECTED",
        "Receipt allocation exceeds a vault's persisted hard-cap reservation",
        {
          vault: candidate,
          allocationWei: allocations[key].toString(),
          reservedCostWei: reservedCostWei.toString(),
          previousCostWei: previousCostWei.toString(),
          capAtSubmission: capAtSubmission.toString(),
        },
      );
    }
    addActualSubsidyCost(state, candidate, allocations[key], nowMs);
    if (
      pending.reservationPolicy === "legacy-v1" &&
      actualSubsidyCost(state, candidate) > config.vaultSubsidyCapWei
    ) {
      metrics.subsidyBudgetOverruns += 1;
    }
  }
  addWeiMetric(metrics, "subsidyActualCostWei", actualCostWei);

  state.pendingTransaction = null;
  state.recentTransactions = [
    {
      hash: pending.hash,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      actualCostWei: actualCostWei.toString(),
      perVaultActualCostWei: Object.fromEntries(
        Object.entries(allocations).map(([key, value]) => [
          key,
          value.toString(),
        ]),
      ),
    },
    ...state.recentTransactions,
  ].slice(0, 16);
  if (receipt.status === "success") {
    metrics.transactionsConfirmed += 1;
  } else {
    metrics.transactionsReverted += 1;
    return {
      waiting: false,
      retryDeferred: true,
      outcome: "transaction-reverted-retry-next-cycle",
    };
  }
  return { waiting: false, retryDeferred: false, outcome: null };
}

async function estimateGasEnvelope(
  readers,
  config,
  candidates,
  blockNumber,
  account,
) {
  const estimates = await Promise.all(
    readers.map((client) =>
      client.estimateContractGas({
        address: config.coordinatorAddress,
        abi: DEEP_KEEPER_ABI,
        functionName: "performBatch",
        args: [candidates],
        account,
        blockNumber,
      }),
    ),
  );
  if (estimates.some((estimate) => BigInt(estimate) <= 0n)) {
    fail("RPC_INVALID_RESPONSE", "RPC returned an invalid gas estimate");
  }
  const estimatedGas =
    BigInt(estimates[0]) > BigInt(estimates[1])
      ? BigInt(estimates[0])
      : BigInt(estimates[1]);
  const gas = (estimatedGas * 120n + 99n) / 100n;
  if (gas > config.maxGas) {
    fail("GAS_LIMIT_EXCEEDED", "Batch exceeds the reviewed gas ceiling", {
      estimatedGas: estimatedGas.toString(),
      paddedGas: gas.toString(),
      maximum: config.maxGas.toString(),
    });
  }
  return { estimatedGas, gas };
}

async function estimateFeePolicy(readers, config) {
  const feeQuotes = await Promise.all(
    readers.map((client) => client.estimateFeesPerGas()),
  );
  const maxFeePerGas = feeQuotes.reduce((maximum, quote) => {
    const value = BigInt(quote.maxFeePerGas ?? quote.gasPrice ?? 0n);
    return value > maximum ? value : maximum;
  }, 0n);
  const maxPriorityFeePerGas = feeQuotes.reduce((maximum, quote) => {
    const value = BigInt(quote.maxPriorityFeePerGas ?? 0n);
    return value > maximum ? value : maximum;
  }, 0n);
  if (maxFeePerGas === 0n || maxFeePerGas > config.maxFeePerGasWei) {
    fail("GAS_PRICE_REJECTED", "Current fee quote exceeds the configured ceiling", {
      maxFeePerGas: maxFeePerGas.toString(),
      maximum: config.maxFeePerGasWei.toString(),
    });
  }
  if (maxPriorityFeePerGas > maxFeePerGas) {
    fail("RPC_INVALID_RESPONSE", "RPC returned an invalid EIP-1559 fee quote");
  }
  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function checkSignerBalance(
  readers,
  config,
  blockNumber,
  maximumCost,
) {
  const account = config.signerAddress;
  const balances = await Promise.all(
    readers.map((client) =>
      client.getBalance({ address: account, blockNumber }),
    ),
  );
  if (balances[0] !== balances[1]) {
    fail("RPC_DISAGREEMENT", "Read RPCs disagree on signer balance", {
      balances,
    });
  }
  if (balances[0] > config.maxSignerBalanceWei) {
    fail(
      "SIGNER_BALANCE_REJECTED",
      "Signer balance exceeds the low-privilege ceiling",
      {
        balance: balances[0].toString(),
        maximum: config.maxSignerBalanceWei.toString(),
      },
    );
  }
  if (balances[0] < maximumCost) {
    fail("SIGNER_BALANCE_REJECTED", "Signer cannot cover the bounded gas cost", {
      balance: balances[0].toString(),
      maximumCost: maximumCost.toString(),
    });
  }
}

async function prepareBudgetedBatch({
  readers,
  config,
  state,
  metrics,
  ready,
  blockNumber,
  account,
  nowMs,
}) {
  const feePolicy = await estimateFeePolicy(readers, config);
  let eligible = [];
  const reservations = {};
  const gasWeights = {};
  const skipped = [];

  for (const work of ready) {
    if (actualSubsidyCost(state, work.vault) >= config.vaultSubsidyCapWei) {
      skipped.push(work);
    } else {
      eligible.push(work);
    }
  }

  let batchGas = null;
  let maximumTransactionCostWei = 0n;
  while (eligible.length > 0) {
    const candidates = eligible.map((work) => work.vault);
    batchGas = await estimateGasEnvelope(
      readers,
      config,
      candidates,
      blockNumber,
      account,
    );
    maximumTransactionCostWei =
      batchGas.gas * feePolicy.maxFeePerGas;
    const retained = [];
    for (const work of eligible) {
      if (
        actualSubsidyCost(state, work.vault) +
          maximumTransactionCostWei >
        config.vaultSubsidyCapWei
      ) {
        skipped.push(work);
      } else {
        retained.push(work);
      }
    }
    if (retained.length === eligible.length) break;
    eligible = retained;
  }

  metrics.subsidyVaultsSkipped += skipped.length;
  metrics.subsidyVaultsExhausted = skipped.length;
  if (eligible.length === 0) {
    return {
      ready: [],
      skipped,
      execution: null,
      reservations,
      gasWeights,
    };
  }

  const candidates = eligible.map((work) => work.vault);
  await simulateBatch(readers, config, candidates, account, blockNumber);
  metrics.simulations += 1;

  for (const work of eligible) {
    const key = work.vault.toLowerCase();
    const standaloneGas = await estimateGasEnvelope(
      readers,
      config,
      [work.vault],
      blockNumber,
      account,
    );
    gasWeights[key] = standaloneGas.gas;
    reservations[key] = maximumTransactionCostWei;
  }
  if (config.enabled) {
    await checkSignerBalance(
      readers,
      config,
      blockNumber,
      maximumTransactionCostWei,
    );
  }

  for (const work of eligible) {
    const amount = maximumTransactionCostWei;
    addSimulatedSubsidyCost(state, work.vault, amount, nowMs);
    addWeiMetric(metrics, "subsidySimulatedCostWei", amount);
  }
  return {
    ready: eligible,
    skipped,
    reservations,
    gasWeights,
    execution: {
      gas: batchGas.gas,
      estimatedGas: batchGas.estimatedGas,
      maxFeePerGas: feePolicy.maxFeePerGas,
      maxPriorityFeePerGas: feePolicy.maxPriorityFeePerGas,
      maximumTransactionCostWei,
    },
  };
}

function checkpointFrom(block) {
  return {
    number: block.number.toString(),
    hash: block.hash,
  };
}

export async function runKeeperCycle({
  config,
  state,
  metrics,
  readers,
  wallet = null,
  persistPendingState = null,
  nowMs = Date.now(),
}) {
  const validatedState = validateState(state, config);
  metrics.cycles += 1;
  const nextState = JSON.parse(JSON.stringify(validatedState));

  try {
    const snapshot = await readAgreedSnapshot(readers, config);
    if (await detectReorg(readers, nextState, snapshot.confirmedBlock)) {
      nextState.cursor = 0;
      nextState.checkpoint = null;
      nextState.pendingTransaction = null;
      metrics.reorgs += 1;
    }

    const pending = await reconcilePending(
      readers,
      config,
      nextState,
      metrics,
      snapshot.confirmedBlock,
      nowMs,
    );
    if (pending.waiting || pending.retryDeferred) {
      nextState.checkpoint = checkpointFrom(snapshot.confirmedBlock);
      metrics.lastSuccessTimestampSeconds = Math.floor(nowMs / 1000);
      return {
        state: nextState,
        outcome: pending.outcome,
        confirmedBlock: snapshot.confirmedBlock,
        registryCount: null,
        ready: [],
      };
    }

    const discovery = await discoverReady(
      readers,
      config,
      nextState,
      snapshot.confirmedBlock.number,
    );
    nextState.cursor = discovery.nextCursor;
    nextState.checkpoint = checkpointFrom(snapshot.confirmedBlock);
    metrics.readyVaults = discovery.ready.length;
    if (discovery.ready.length === 0) {
      metrics.lastSuccessTimestampSeconds = Math.floor(nowMs / 1000);
      return {
        state: nextState,
        outcome: "idle",
        confirmedBlock: snapshot.confirmedBlock,
        registryCount: discovery.registryCount,
        ready: [],
      };
    }

    const simulationAccount =
      config.enabled && config.signerAddress
        ? config.signerAddress
        : config.simulationAccount;
    const budgeted = await prepareBudgetedBatch({
      readers,
      config,
      state: nextState,
      metrics,
      ready: discovery.ready,
      blockNumber: snapshot.confirmedBlock.number,
      account: simulationAccount,
      nowMs,
    });
    if (budgeted.ready.length === 0) {
      metrics.lastSuccessTimestampSeconds = Math.floor(nowMs / 1000);
      return {
        state: nextState,
        outcome: "subsidy-budget-exhausted",
        confirmedBlock: snapshot.confirmedBlock,
        registryCount: discovery.registryCount,
        ready: [],
        skipped: budgeted.skipped,
      };
    }

    if (!config.enabled) {
      metrics.lastSuccessTimestampSeconds = Math.floor(nowMs / 1000);
      return {
        state: nextState,
        outcome: "disabled-simulation-only",
        confirmedBlock: snapshot.confirmedBlock,
        registryCount: discovery.registryCount,
        ready: budgeted.ready,
        skipped: budgeted.skipped,
      };
    }
    if (!wallet || !config.signerAddress) {
      fail("SIGNER_UNAVAILABLE", "Enabled keeper has no remote signer client");
    }

    const candidates = budgeted.ready.map((work) => work.vault);
    const execution = budgeted.execution;
    const hash = await wallet.writeContract({
      address: config.coordinatorAddress,
      abi: DEEP_KEEPER_ABI,
      functionName: "performBatch",
      args: [candidates],
      account: config.signerAddress,
      gas: execution.gas,
      maxFeePerGas: execution.maxFeePerGas,
      maxPriorityFeePerGas: execution.maxPriorityFeePerGas,
    });
    if (!HASH_PATTERN.test(hash ?? "")) {
      fail("SIGNER_INVALID_RESPONSE", "Remote signer returned an invalid hash");
    }
    nextState.pendingTransaction = {
      hash,
      submittedAtMs: nowMs,
      candidates,
      gas: execution.gas.toString(),
      maxFeePerGas: execution.maxFeePerGas.toString(),
      maximumTransactionCostWei:
        execution.maximumTransactionCostWei.toString(),
      perVaultReservedWei: Object.fromEntries(
        Object.entries(budgeted.reservations).map(([key, value]) => [
          key,
          value.toString(),
        ]),
      ),
      perVaultEstimatedGas: Object.fromEntries(
        Object.entries(budgeted.gasWeights).map(([key, value]) => [
          key,
          value.toString(),
        ]),
      ),
      reservationPolicy: "batch-envelope-v1",
      subsidyCapWeiAtSubmission: config.vaultSubsidyCapWei.toString(),
    };
    if (persistPendingState) {
      await persistPendingState(nextState);
    }
    metrics.batchesSubmitted += 1;
    metrics.lastSuccessTimestampSeconds = Math.floor(nowMs / 1000);
    return {
      state: nextState,
      outcome: "submitted",
      confirmedBlock: snapshot.confirmedBlock,
      registryCount: discovery.registryCount,
      ready: budgeted.ready,
      skipped: budgeted.skipped,
      transactionHash: hash,
    };
  } catch (error) {
    metrics.cycleFailures += 1;
    if (error?.code === "RPC_DISAGREEMENT") metrics.rpcDisagreements += 1;
    if (error?.code === "SIMULATION_REJECTED") {
      metrics.simulationFailures += 1;
    }
    throw error;
  }
}

export function renderPrometheusMetrics(metrics, runtime, config) {
  const subsidyEntries = Object.values(
    runtime.state?.vaultSubsidies ?? {},
  );
  const durableActualCostWei = subsidyEntries.reduce(
    (total, entry) => total + BigInt(entry.actualCostWei),
    0n,
  );
  const durableSimulatedCostWei = subsidyEntries.reduce(
    (total, entry) => total + BigInt(entry.simulatedCostWei),
    0n,
  );
  const pendingReservedWei = Object.values(
    runtime.state?.pendingTransaction?.perVaultReservedWei ?? {},
  ).reduce((total, value) => total + BigInt(value), 0n);
  const lines = [
    "# HELP deep_keeper_enabled Whether transaction submission is enabled.",
    "# TYPE deep_keeper_enabled gauge",
    `deep_keeper_enabled ${config.enabled ? 1 : 0}`,
    "# HELP deep_keeper_cycles_total Keeper cycles started.",
    "# TYPE deep_keeper_cycles_total counter",
    `deep_keeper_cycles_total ${metrics.cycles}`,
    "# HELP deep_keeper_cycle_failures_total Keeper cycles that failed closed.",
    "# TYPE deep_keeper_cycle_failures_total counter",
    `deep_keeper_cycle_failures_total ${metrics.cycleFailures}`,
    "# HELP deep_keeper_rpc_disagreements_total Independent RPC disagreements.",
    "# TYPE deep_keeper_rpc_disagreements_total counter",
    `deep_keeper_rpc_disagreements_total ${metrics.rpcDisagreements}`,
    "# HELP deep_keeper_reorgs_total Detected canonical-chain changes.",
    "# TYPE deep_keeper_reorgs_total counter",
    `deep_keeper_reorgs_total ${metrics.reorgs}`,
    "# HELP deep_keeper_ready_vaults Ready vaults in the latest scanned window.",
    "# TYPE deep_keeper_ready_vaults gauge",
    `deep_keeper_ready_vaults ${metrics.readyVaults}`,
    "# HELP deep_keeper_simulations_total Successful independent batch simulations.",
    "# TYPE deep_keeper_simulations_total counter",
    `deep_keeper_simulations_total ${metrics.simulations}`,
    "# HELP deep_keeper_simulation_failures_total Rejected batch simulations.",
    "# TYPE deep_keeper_simulation_failures_total counter",
    `deep_keeper_simulation_failures_total ${metrics.simulationFailures}`,
    "# HELP deep_keeper_batches_submitted_total Transactions submitted.",
    "# TYPE deep_keeper_batches_submitted_total counter",
    `deep_keeper_batches_submitted_total ${metrics.batchesSubmitted}`,
    "# HELP deep_keeper_transactions_confirmed_total Canonically confirmed transactions.",
    "# TYPE deep_keeper_transactions_confirmed_total counter",
    `deep_keeper_transactions_confirmed_total ${metrics.transactionsConfirmed}`,
    "# HELP deep_keeper_transactions_reverted_total Canonically reverted transactions.",
    "# TYPE deep_keeper_transactions_reverted_total counter",
    `deep_keeper_transactions_reverted_total ${metrics.transactionsReverted}`,
    "# HELP deep_keeper_transactions_dropped_total Timed-out transactions released for retry.",
    "# TYPE deep_keeper_transactions_dropped_total counter",
    `deep_keeper_transactions_dropped_total ${metrics.transactionsDropped}`,
    "# HELP deep_keeper_vault_subsidy_cap_wei Configured hard gas subsidy cap for each vault.",
    "# TYPE deep_keeper_vault_subsidy_cap_wei gauge",
    `deep_keeper_vault_subsidy_cap_wei ${config.vaultSubsidyCapWei}`,
    "# HELP deep_keeper_vault_subsidy_entries Vaults with persisted subsidy accounting.",
    "# TYPE deep_keeper_vault_subsidy_entries gauge",
    `deep_keeper_vault_subsidy_entries ${subsidyEntries.length}`,
    "# HELP deep_keeper_vault_subsidy_skipped_total Ready vaults skipped by their subsidy cap.",
    "# TYPE deep_keeper_vault_subsidy_skipped_total counter",
    `deep_keeper_vault_subsidy_skipped_total ${metrics.subsidyVaultsSkipped}`,
    "# HELP deep_keeper_vault_subsidy_exhausted_vaults Budget-blocked vaults in the latest ready window.",
    "# TYPE deep_keeper_vault_subsidy_exhausted_vaults gauge",
    `deep_keeper_vault_subsidy_exhausted_vaults ${metrics.subsidyVaultsExhausted}`,
    "# HELP deep_keeper_vault_subsidy_budget_overruns_total Receipt costs outside the expected subsidy envelope.",
    "# TYPE deep_keeper_vault_subsidy_budget_overruns_total counter",
    `deep_keeper_vault_subsidy_budget_overruns_total ${metrics.subsidyBudgetOverruns}`,
    "# HELP deep_keeper_vault_subsidy_simulated_wei_total Conservative per-vault gas quotes observed by this process.",
    "# TYPE deep_keeper_vault_subsidy_simulated_wei_total counter",
    `deep_keeper_vault_subsidy_simulated_wei_total ${metrics.subsidySimulatedCostWei}`,
    "# HELP deep_keeper_vault_subsidy_actual_wei_total Canonical receipt gas costs attributed by this process.",
    "# TYPE deep_keeper_vault_subsidy_actual_wei_total counter",
    `deep_keeper_vault_subsidy_actual_wei_total ${metrics.subsidyActualCostWei}`,
    "# HELP deep_keeper_vault_subsidy_durable_simulated_wei Persisted conservative gas quotes across restarts.",
    "# TYPE deep_keeper_vault_subsidy_durable_simulated_wei gauge",
    `deep_keeper_vault_subsidy_durable_simulated_wei ${durableSimulatedCostWei}`,
    "# HELP deep_keeper_vault_subsidy_durable_actual_wei Persisted canonical receipt costs across restarts.",
    "# TYPE deep_keeper_vault_subsidy_durable_actual_wei gauge",
    `deep_keeper_vault_subsidy_durable_actual_wei ${durableActualCostWei}`,
    "# HELP deep_keeper_vault_subsidy_pending_reserved_wei Conservative per-vault reservations for the pending transaction.",
    "# TYPE deep_keeper_vault_subsidy_pending_reserved_wei gauge",
    `deep_keeper_vault_subsidy_pending_reserved_wei ${pendingReservedWei}`,
    "# HELP deep_keeper_last_success_timestamp_seconds Last successful cycle.",
    "# TYPE deep_keeper_last_success_timestamp_seconds gauge",
    `deep_keeper_last_success_timestamp_seconds ${metrics.lastSuccessTimestampSeconds}`,
    "# HELP deep_keeper_pending_transaction Whether one transaction awaits confirmation.",
    "# TYPE deep_keeper_pending_transaction gauge",
    `deep_keeper_pending_transaction ${
      runtime.state?.pendingTransaction ? 1 : 0
    }`,
  ];
  return `${lines.join("\n")}\n`;
}
