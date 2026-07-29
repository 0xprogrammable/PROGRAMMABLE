import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbiParameters,
  toHex,
} from "viem";

import {
  DEEP_V3_KEEPER_V2_ABSENT_GRACE_MS,
  DEEP_V3_KEEPER_V2_INTERVAL_MS,
  DEEP_V3_KEEPER_V2_MAX_SIGNER_REQUEST_LIFETIME_MS,
  DEEP_V3_KEEPER_V2_REPLAY_COOLDOWN_MS,
  DEEP_V3_KEEPER_V2_SAFE_REPLAY_MS,
} from "./config-v2.mjs";

export const DeepV3V2Action = Object.freeze({
  None: 0,
  Compound: 1,
  GrowOracle: 2,
});

export const DEEP_V3_V2_AUTOMATION_ABI = [
  {
    type: "function",
    name: "registeredVaultCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "scan",
    stateMutability: "view",
    inputs: [
      { name: "cursor", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      {
        name: "ready",
        type: "tuple[]",
        components: [
          { name: "vault", type: "address" },
          { name: "action", type: "uint8" },
        ],
      },
      { name: "nextCursor", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "launcher",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "vaultFactory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
];

export const DEEP_V3_V2_LAUNCHER_ABI = [
  {
    type: "function",
    name: "automation",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "growthVaultFactory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
];

export const DEEP_V3_V2_EXECUTOR_ABI = [
  {
    type: "function",
    name: "automation",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "candidates",
        type: "tuple[]",
        components: [
          { name: "vault", type: "address" },
          { name: "expectedAction", type: "uint8" },
        ],
      },
    ],
    outputs: [
      { name: "batchHash", type: "bytes32" },
      { name: "attempted", type: "uint256" },
      { name: "succeeded", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "CandidateResult",
    anonymous: false,
    inputs: [
      { indexed: true, name: "batchHash", type: "bytes32" },
      { indexed: true, name: "candidateIndex", type: "uint256" },
      { indexed: true, name: "vault", type: "address" },
      { indexed: false, name: "executor", type: "address" },
      { indexed: false, name: "expectedAction", type: "uint8" },
      { indexed: false, name: "actualAction", type: "uint8" },
      { indexed: false, name: "outcome", type: "uint8" },
      { indexed: false, name: "errorSelector", type: "bytes4" },
      { indexed: false, name: "gasUsed", type: "uint256" },
    ],
  },
];

export const DEEP_V3_V2_VAULT_ABI = [
  {
    type: "function",
    name: "workState",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "action", type: "uint8" },
      { name: "hookGrowthFees", type: "uint256" },
      { name: "pendingNative", type: "uint256" },
      { name: "nextEligibleTimestamp", type: "uint256" },
      { name: "rollingCapacity", type: "uint256" },
      { name: "blockedReason", type: "bytes4" },
    ],
  },
];

export class DeepV3KeeperV2Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepV3KeeperV2Error";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeepV3KeeperV2Error(code, message);
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function sameHash(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function normalizeWork(work) {
  const action = Number(work.action);
  if (
    !Number.isSafeInteger(action) ||
    action < DeepV3V2Action.Compound ||
    action > DeepV3V2Action.GrowOracle
  ) {
    fail("MALFORMED_SCAN", "Automation scan returned an invalid action");
  }
  return {
    vault: getAddress(work.vault),
    action,
  };
}

function sameWorkPage(left, right) {
  return (
    left.nextCursor === right.nextCursor &&
    left.ready.length === right.ready.length &&
    left.ready.every(
      (candidate, index) =>
        sameAddress(candidate.vault, right.ready[index].vault) &&
        candidate.action === right.ready[index].action,
    )
  );
}

export function deepV3KeeperV2Slot(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    fail("INVALID_CLOCK", "Keeper clock must be a non-negative integer");
  }
  return Math.floor(nowMs / DEEP_V3_KEEPER_V2_INTERVAL_MS);
}

export async function scanDeepV3KeeperV2Pages({
  readers,
  automationAddress,
  blockNumber,
  startCursor,
  pageSize,
  maxPages,
  excludedVaults,
}) {
  if (
    !Array.isArray(readers) ||
    readers.length !== 2 ||
    !Number.isSafeInteger(startCursor) ||
    startCursor < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 32 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1
  ) {
    fail("SCAN_CONFIGURATION", "Canonical scan configuration is invalid");
  }
  const counts = await Promise.all(
    readers.map((reader) =>
      reader.readRegisteredVaultCount(
        automationAddress,
        blockNumber,
      ),
    ),
  );
  if (counts[0] !== counts[1]) {
    fail("REGISTRY_DISAGREEMENT", "RPCs disagree on registry size");
  }
  if (counts[0] > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("REGISTRY_TOO_LARGE", "Registry exceeds the durable cursor range");
  }
  const count = Number(counts[0]);
  if (count === 0) {
    return {
      registryCount: 0,
      scanned: 0,
      nextCursor: 0,
      candidates: [],
    };
  }

  const maximum = Math.min(count, pageSize * maxPages);
  let cursor = startCursor % count;
  let scanned = 0;
  const candidates = [];
  const seen = new Set();
  while (scanned < maximum) {
    const limit = Math.min(pageSize, maximum - scanned);
    const pages = await Promise.all(
      readers.map(async (reader) => {
        const result = await reader.scanAutomation(
          automationAddress,
          BigInt(cursor),
          BigInt(limit),
          blockNumber,
        );
        if (
          !result ||
          !Array.isArray(result.ready) ||
          typeof result.nextCursor !== "bigint"
        ) {
          fail("MALFORMED_SCAN", "Automation scan result is malformed");
        }
        return {
          ready: result.ready.map(normalizeWork),
          nextCursor: result.nextCursor,
        };
      }),
    );
    if (!sameWorkPage(pages[0], pages[1])) {
      fail(
        "SCAN_DISAGREEMENT",
        "RPCs disagree on the canonical automation scan",
      );
    }
    const expectedNext = (cursor + limit) % count;
    if (pages[0].nextCursor !== BigInt(expectedNext)) {
      fail("MALFORMED_SCAN", "Automation scan cursor is inconsistent");
    }
    for (const candidate of pages[0].ready) {
      const key = candidate.vault.toLowerCase();
      if (!excludedVaults.has(key) && !seen.has(key)) {
        candidates.push(candidate);
        seen.add(key);
      }
    }
    cursor = expectedNext;
    scanned += limit;
  }
  return {
    registryCount: count,
    scanned,
    nextCursor: cursor,
    candidates,
  };
}

const ASSESSMENT_GAS_STIPEND = 1_300_000n;
const COMPOUND_GAS_STIPEND = 3_000_000n;
const GROW_ORACLE_GAS_STIPEND = 600_000n;
const RESULT_GAS_RESERVE = 30_000n;
const FINAL_GAS_RESERVE = 30_000n;

function eip150Envelope(stipend) {
  return stipend + (stipend + 62n) / 63n;
}

export function deepV3KeeperV2TheoreticalGas(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return 0n;
  }
  if (candidates.length > 4) {
    fail("BATCH_TOO_LARGE", "Executor accepts at most four candidates");
  }
  let required = FINAL_GAS_RESERVE;
  for (const candidate of candidates) {
    const execution =
      candidate.action === DeepV3V2Action.Compound
        ? COMPOUND_GAS_STIPEND
        : candidate.action === DeepV3V2Action.GrowOracle
          ? GROW_ORACLE_GAS_STIPEND
          : null;
    if (execution === null) {
      fail("INVALID_ACTION", "Batch includes an invalid action");
    }
    required +=
      eip150Envelope(ASSESSMENT_GAS_STIPEND) +
      eip150Envelope(execution) +
      RESULT_GAS_RESERVE;
  }
  return required;
}

export function packDeepV3KeeperV2Candidates(
  candidates,
  maxGas,
) {
  const packed = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (packed.length === 4) break;
    const normalized = {
      vault: getAddress(candidate.vault),
      action: Number(candidate.action),
    };
    const key = normalized.vault.toLowerCase();
    if (seen.has(key)) continue;
    const proposed = [...packed, normalized];
    if (deepV3KeeperV2TheoreticalGas(proposed) > maxGas) {
      continue;
    }
    packed.push(normalized);
    seen.add(key);
  }
  return packed;
}

export function deepV3KeeperV2IdempotencyKey({
  sourceCommitment,
  opsSourceCommitment,
  releaseVersion,
  laneId,
  slot,
  blockHash,
  scanStartCursor,
  scanEndCursor,
  candidates,
  requestHash,
}) {
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "bytes32 sourceCommitment, bytes32 opsSourceCommitment, bytes32 releaseHash, bytes32 laneHash, uint256 slot, bytes32 blockHash, uint256 scanStartCursor, uint256 scanEndCursor, (address vault,uint8 action)[] candidates, bytes32 requestHash",
    ),
    [
      sourceCommitment,
      opsSourceCommitment,
      keccak256(toHex(releaseVersion)),
      keccak256(toHex(laneId)),
      BigInt(slot),
      blockHash,
      BigInt(scanStartCursor),
      BigInt(scanEndCursor),
      candidates,
      requestHash,
    ],
  );
  const digest = keccak256(encoded);
  return `deepv3v2-${digest.slice(2, 34)}`;
}

export function deepV3KeeperV2ExecuteData(candidates) {
  return encodeFunctionData({
    abi: DEEP_V3_V2_EXECUTOR_ABI,
    functionName: "execute",
    args: [
      candidates.map(({ vault, action }) => ({
        vault,
        expectedAction: action,
      })),
    ],
  });
}

export function deepV3KeeperV2ExecutorBatchHash({
  chainId,
  executorAddress,
  signerAddress,
  candidates,
}) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256 chainId, address executor, address signer, (address vault,uint8 action)[] candidates",
      ),
      [
        BigInt(chainId),
        getAddress(executorAddress),
        getAddress(signerAddress),
        candidates,
      ],
    ),
  );
}

export function deepV3KeeperV2RequestHash({
  executorAddress,
  candidates,
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas,
  expectedNonce,
  signerRequestLifetimeMs,
}) {
  const data = deepV3KeeperV2ExecuteData(candidates);
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address target, uint256 value, bytes32 calldataHash, uint256 gas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, uint256 expectedNonce, uint256 signerRequestLifetimeMs",
      ),
      [
        getAddress(executorAddress),
        0n,
        keccak256(data),
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        expectedNonce,
        BigInt(signerRequestLifetimeMs),
      ],
    ),
  );
}

function ratioPass(growth, debit, ratioBps) {
  return growth * 10_000n >= debit * BigInt(ratioBps);
}

export function passesDeepV3KeeperV2EconomicPolicy({
  candidates,
  batchGrowthBudgetWei,
  batchMaxGasDebitWei,
  minGrowthToMaxGasRatioBps,
  batchGas,
  maxTotalGasPerTick,
  committedTickGas,
  maxTotalDebitWeiPerTick,
  committedTickDebitWei,
  tickSubmissionCount,
  maxNewSubmissionsPerTick,
  maxTotalDebitWeiPerDay,
  committedTodayWei,
  signerBalanceWei,
  signerBalanceFloorWei,
}) {
  const reasons = [];
  if (
    candidates.some(
      ({ growthBudgetWei, singleMaxGasDebitWei }) =>
        !ratioPass(
          growthBudgetWei,
          singleMaxGasDebitWei,
          minGrowthToMaxGasRatioBps,
        ),
    )
  ) {
    reasons.push("candidate-growth-ratio");
  }
  if (
    !ratioPass(
      batchGrowthBudgetWei,
      batchMaxGasDebitWei,
      minGrowthToMaxGasRatioBps,
    )
  ) {
    reasons.push("batch-growth-ratio");
  }
  if (tickSubmissionCount >= maxNewSubmissionsPerTick) {
    reasons.push("tick-submission-cap");
  }
  if (committedTickGas + batchGas > maxTotalGasPerTick) {
    reasons.push("tick-gas-budget");
  }
  if (
    committedTickDebitWei + batchMaxGasDebitWei >
    maxTotalDebitWeiPerTick
  ) {
    reasons.push("tick-debit-budget");
  }
  if (
    committedTodayWei + batchMaxGasDebitWei >
    maxTotalDebitWeiPerDay
  ) {
    reasons.push("daily-debit-budget");
  }
  if (
    signerBalanceWei <
    signerBalanceFloorWei + batchMaxGasDebitWei
  ) {
    reasons.push("signer-balance-floor");
  }
  return { ready: reasons.length === 0, reasons };
}

function clone(value) {
  return structuredClone(value);
}

async function requireFence(assertFence) {
  if ((await assertFence()) !== true) {
    fail("LEASE_FENCE_LOST", "Keeper storage ownership was lost");
  }
}

async function persist(persistState, assertFence, state) {
  await requireFence(assertFence);
  if ((await persistState(clone(state))) !== true) {
    fail("LEASE_FENCE_LOST", "Keeper state lost its CAS fence");
  }
}

async function commonSnapshot(readers, config) {
  if (!Array.isArray(readers) || readers.length !== 2) {
    fail("RPC_CONFIGURATION", "Exactly two read RPCs are required");
  }
  const chainIds = await Promise.all(
    readers.map((reader) => reader.getChainId()),
  );
  if (chainIds.some((chainId) => chainId !== config.chainId)) {
    fail("CHAIN_DISAGREEMENT", "Read RPC chain identity is invalid");
  }
  const heads = await Promise.all(
    readers.map((reader) => reader.getBlockNumber()),
  );
  const commonHead = heads[0] < heads[1] ? heads[0] : heads[1];
  if (commonHead < BigInt(config.confirmations)) {
    fail("RPC_NOT_READY", "Read RPCs have not reached finality depth");
  }
  const blockNumber = commonHead - BigInt(config.confirmations);
  const blocks = await Promise.all(
    readers.map((reader) => reader.getBlock(blockNumber)),
  );
  if (
    blocks.some(
      (block) =>
        block.number !== blockNumber ||
        typeof block.hash !== "string" ||
        typeof block.gasLimit !== "bigint",
    ) ||
    !sameHash(blocks[0].hash, blocks[1].hash) ||
    blocks[0].gasLimit !== blocks[1].gasLimit
  ) {
    fail(
      "CANONICAL_BLOCK_DISAGREEMENT",
      "Read RPCs disagree on the common block",
    );
  }
  if (
    config.maxTransactionGas + 1_000_000n >
    blocks[0].gasLimit
  ) {
    fail(
      "BLOCK_GAS_POLICY",
      "Reviewed transaction gas has insufficient block headroom",
    );
  }
  return {
    number: blockNumber,
    hash: blocks[0].hash,
    gasLimit: blocks[0].gasLimit,
  };
}

async function assertRuntimeTopology(readers, config, snapshot) {
  const expected = [
    [config.automationAddress, config.automationRuntimeHash],
    [config.launcherAddress, config.launcherRuntimeHash],
    [config.vaultFactoryAddress, config.vaultFactoryRuntimeHash],
    [config.executorAddress, config.executorRuntimeHash],
  ];
  const observations = await Promise.all(
    readers.map(async (reader) => ({
      runtimeHashes: await Promise.all(
        expected.map(([address]) =>
          reader.getRuntimeHash(address, snapshot.number),
        ),
      ),
      executorAutomation: await reader.readExecutorAutomation(
        config.executorAddress,
        snapshot.number,
      ),
      automationLauncher: await reader.readAutomationLauncher(
        config.automationAddress,
        snapshot.number,
      ),
      automationFactory: await reader.readAutomationVaultFactory(
        config.automationAddress,
        snapshot.number,
      ),
      launcherAutomation: await reader.readLauncherAutomation(
        config.launcherAddress,
        snapshot.number,
      ),
      launcherFactory: await reader.readLauncherVaultFactory(
        config.launcherAddress,
        snapshot.number,
      ),
    })),
  );
  for (const observation of observations) {
    expected.forEach(([, runtimeHash], index) => {
      if (!sameHash(observation.runtimeHashes[index], runtimeHash)) {
        fail(
          "RUNTIME_MISMATCH",
          "A reviewed Deep V3 runtime does not match",
        );
      }
    });
    if (
      !sameAddress(
        observation.executorAutomation,
        config.automationAddress,
      ) ||
      !sameAddress(
        observation.automationLauncher,
        config.launcherAddress,
      ) ||
      !sameAddress(
        observation.automationFactory,
        config.vaultFactoryAddress,
      ) ||
      !sameAddress(
        observation.launcherAutomation,
        config.automationAddress,
      ) ||
      !sameAddress(
        observation.launcherFactory,
        config.vaultFactoryAddress,
      )
    ) {
      fail(
        "TOPOLOGY_MISMATCH",
        "The Deep V3 topology is not the reviewed topology",
      );
    }
  }
  if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) {
    fail(
      "TOPOLOGY_DISAGREEMENT",
      "Read RPCs disagree on the Deep V3 topology",
    );
  }
}

function sameReceipt(left, right) {
  return (
    left &&
    right &&
    sameHash(left.transactionHash, right.transactionHash) &&
    left.status === right.status &&
    left.blockNumber === right.blockNumber &&
    sameHash(left.blockHash, right.blockHash) &&
    left.gasUsed === right.gasUsed &&
    left.effectiveGasPrice === right.effectiveGasPrice &&
    sameAddress(left.from, right.from) &&
    sameAddress(left.to, right.to)
  );
}

function sameTransaction(left, right) {
  return (
    left &&
    right &&
    sameHash(left.hash, right.hash) &&
    sameAddress(left.from, right.from) &&
    sameAddress(left.to, right.to) &&
    left.value === right.value &&
    left.input === right.input &&
    left.nonce === right.nonce &&
    left.gas === right.gas &&
    left.maxFeePerGas === right.maxFeePerGas &&
    left.maxPriorityFeePerGas === right.maxPriorityFeePerGas &&
    left.chainId === right.chainId &&
    left.type === right.type
  );
}

function assertPendingBinding(config, pending) {
  const candidates = pending.candidates.map(({ vault, action }) => ({
    vault,
    action,
  }));
  const requestHash = deepV3KeeperV2RequestHash({
    executorAddress: config.executorAddress,
    candidates,
    gas: BigInt(pending.request.gas),
    maxFeePerGas: BigInt(pending.request.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(
      pending.request.maxPriorityFeePerGas,
    ),
    expectedNonce: BigInt(pending.request.expectedNonce),
    signerRequestLifetimeMs: Number(
      pending.request.signerRequestLifetimeMs,
    ),
  });
  if (!sameHash(requestHash, pending.request.requestHash)) {
    fail(
      "REQUEST_BINDING_MISMATCH",
      "Pending request hash does not match its exact envelope",
    );
  }
  const idempotencyKey = deepV3KeeperV2IdempotencyKey({
    sourceCommitment: config.sourceCommitment,
    opsSourceCommitment: config.opsSourceCommitment,
    releaseVersion: config.releaseVersion,
    laneId: pending.laneId,
    slot: pending.slot,
    blockHash: pending.scanBlockHash,
    scanStartCursor: pending.scanStartCursor,
    scanEndCursor: pending.scanEndCursor,
    candidates,
    requestHash,
  });
  if (idempotencyKey !== pending.idempotencyKey) {
    fail(
      "IDEMPOTENCY_BINDING_MISMATCH",
      "Pending idempotency key does not match its request",
    );
  }
}

function transactionMatchesPending(transaction, config, lane, pending) {
  if (!transaction) return false;
  return (
    sameHash(transaction.hash, pending.transactionHash) &&
    sameAddress(transaction.from, lane.signerAddress) &&
    sameAddress(transaction.to, config.executorAddress) &&
    transaction.value === 0n &&
    transaction.input ===
      deepV3KeeperV2ExecuteData(
        pending.candidates.map(({ vault, action }) => ({
          vault,
          action,
        })),
      ) &&
    transaction.nonce === BigInt(pending.nonce) &&
    transaction.nonce === BigInt(pending.request.expectedNonce) &&
    transaction.gas === BigInt(pending.request.gas) &&
    transaction.maxFeePerGas ===
      BigInt(pending.request.maxFeePerGas) &&
    transaction.maxPriorityFeePerGas ===
      BigInt(pending.request.maxPriorityFeePerGas) &&
    transaction.chainId === config.chainId &&
    transaction.type === "eip1559"
  );
}

function dayStart(nowMs) {
  return Math.floor(nowMs / 86_400_000) * 86_400_000;
}

function budgetForDay(state, start) {
  let budget = state.gasBudgetDays.find(
    ({ dayStartMs }) => dayStartMs === start,
  );
  if (!budget) {
    budget = {
      dayStartMs: start,
      committedMaxDebitWei: "0",
      confirmedActualDebitWei: "0",
      submissionCount: 0,
    };
    state.gasBudgetDays.push(budget);
    state.gasBudgetDays.sort(
      (left, right) => left.dayStartMs - right.dayStartMs,
    );
    while (state.gasBudgetDays.length > 4) {
      state.gasBudgetDays.shift();
    }
  }
  return budget;
}

function budgetForTick(state, slot) {
  let budget = state.tickBudgets.find(
    (entry) => entry.slot === slot,
  );
  if (!budget) {
    budget = {
      slot,
      committedGas: "0",
      committedMaxDebitWei: "0",
      submissionCount: 0,
    };
    state.tickBudgets.push(budget);
    state.tickBudgets.sort((left, right) => left.slot - right.slot);
    while (state.tickBudgets.length > 4) {
      state.tickBudgets.shift();
    }
  }
  return budget;
}

function addActualDebit(state, pending, debit) {
  const budget = budgetForDay(state, pending.budgetDayStartMs);
  budget.confirmedActualDebitWei = (
    BigInt(budget.confirmedActualDebitWei) + debit
  ).toString();
}

function refreshLaneIndexes(state) {
  for (const lane of state.lanes) {
    lane.pendingBatchIds = state.pendingBatches
      .filter(({ laneId }) => laneId === lane.id)
      .map(({ id }) => id);
  }
}

function appendHistory(state, entry, maximum) {
  state.history.push(entry);
  if (state.history.length > maximum) {
    state.history.splice(0, state.history.length - maximum);
  }
}

function incidentId(pending, reason) {
  return `${pending.id}:${reason}`.slice(0, 96);
}

function enterOperatorState(state, pending, reason, nowMs, config) {
  pending.status = "operator";
  const id = incidentId(pending, reason);
  if (!state.operatorIncidents.some((incident) => incident.id === id)) {
    if (
      state.operatorIncidents.length >= config.maxOperatorIncidents
    ) {
      fail(
        "INCIDENT_CAPACITY",
        "Operator incident capacity is exhausted",
      );
    }
    state.operatorIncidents.push({
      id,
      batchId: pending.id,
      laneId: pending.laneId,
      reason,
      enteredAtMs: nowMs,
    });
  }
}

function removePending(state, id) {
  state.pendingBatches = state.pendingBatches.filter(
    (pending) => pending.id !== id,
  );
  state.operatorIncidents = state.operatorIncidents.filter(
    ({ batchId }) => batchId !== id,
  );
  refreshLaneIndexes(state);
}

function sameCandidateResults(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((result, index) => {
      const other = right[index];
      return (
        sameHash(result.batchHash, other.batchHash) &&
        result.candidateIndex === other.candidateIndex &&
        sameAddress(result.vault, other.vault) &&
        sameAddress(result.executor, other.executor) &&
        result.expectedAction === other.expectedAction &&
        result.actualAction === other.actualAction &&
        result.outcome === other.outcome
      );
    })
  );
}

function validateCandidateResults(results, pending, lane) {
  if (results.length !== pending.candidates.length) return false;
  const expectedBatchHash = deepV3KeeperV2ExecutorBatchHash({
    chainId: 1,
    executorAddress: pending.executorAddress,
    signerAddress: lane.signerAddress,
    candidates: pending.candidates.map(({ vault, action }) => ({
      vault,
      action,
    })),
  });
  const seen = new Set();
  for (const result of results) {
    const index = Number(result.candidateIndex);
    const candidate = pending.candidates[index];
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      !candidate ||
      seen.has(index) ||
      !sameHash(result.batchHash, expectedBatchHash) ||
      !sameAddress(result.vault, candidate.vault) ||
      !sameAddress(result.executor, lane.signerAddress) ||
      result.expectedAction !== candidate.action ||
      !Number.isSafeInteger(result.actualAction) ||
      !Number.isSafeInteger(result.outcome) ||
      result.outcome < 0 ||
      result.outcome > 4 ||
      (result.outcome === 4 &&
        result.actualAction !== candidate.action)
    ) {
      return false;
    }
    seen.add(index);
  }
  return true;
}

async function submitPersistedIntent({
  state,
  pending,
  wallet,
  config,
  nowMs,
  requestExpiryMs,
  persistState,
  assertFence,
  replay,
}) {
  assertPendingBinding(config, pending);
  if (
    !wallet ||
    wallet.supportsStableIdempotency !== true
  ) {
    fail(
      "SIGNER_UNAVAILABLE",
      "A replay-safe remote policy wallet is required",
    );
  }
  await requireFence(assertFence);
  const response = await wallet.submitBatch({
    candidates: pending.candidates.map(({ vault, action }) => ({
      vault,
      action,
    })),
    gas: BigInt(pending.request.gas),
    maxFeePerGas: BigInt(pending.request.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(
      pending.request.maxPriorityFeePerGas,
    ),
    expectedNonce: BigInt(pending.request.expectedNonce),
    requestExpiryMs,
    idempotencyKey: pending.idempotencyKey,
    referenceId: pending.referenceId,
    abi: DEEP_V3_V2_EXECUTOR_ABI,
  });
  if (
    response.referenceId !== pending.referenceId ||
    response.nonce !== BigInt(pending.request.expectedNonce)
  ) {
    fail(
      "SIGNER_RESPONSE_MISMATCH",
      "Remote wallet response is outside the persisted request",
    );
  }
  const originalTransactionHash = pending.transactionHash;
  if (
    replay &&
    originalTransactionHash !== null &&
    !sameHash(response.transactionHash, originalTransactionHash)
  ) {
    pending.lastReplayAtMs = nowMs;
    pending.replayCount += 1;
    enterOperatorState(
      state,
      pending,
      "idempotency-hash-mismatch",
      nowMs,
      config,
    );
    refreshLaneIndexes(state);
    await persist(persistState, assertFence, state);
    return {
      transactionHash: originalTransactionHash,
      operatorActionRequired: true,
    };
  }
  pending.transactionHash = response.transactionHash;
  pending.transactionId = response.transactionId;
  pending.nonce = response.nonce.toString();
  pending.status = "submitted";
  if (replay) {
    pending.lastReplayAtMs = nowMs;
    pending.replayCount += 1;
  }
  refreshLaneIndexes(state);
  await persist(persistState, assertFence, state);
  return {
    transactionHash: response.transactionHash,
    operatorActionRequired: false,
  };
}

async function reconcilePendingBatches({
  state,
  config,
  readers,
  wallet,
  snapshot,
  nowMs,
  requestExpiryMs,
  persistState,
  assertFence,
}) {
  const confirmedBatchIds = [];
  for (const pendingId of state.pendingBatches.map(({ id }) => id)) {
    const pending = state.pendingBatches.find(
      ({ id }) => id === pendingId,
    );
    if (!pending) continue;
    const lane = state.lanes.find(({ id }) => id === pending.laneId);
    if (!lane) fail("LANE_MISSING", "Pending batch lane is missing");
    assertPendingBinding(config, pending);
    if (nowMs < pending.createdAtMs) {
      fail("CLOCK_REGRESSION", "Pending batch was created in the future");
    }
    const age = nowMs - pending.createdAtMs;
    if (pending.status === "operator") continue;
    if (pending.status === "intent") {
      if (age >= DEEP_V3_KEEPER_V2_SAFE_REPLAY_MS) {
        enterOperatorState(
          state,
          pending,
          "intent-after-idempotency-window",
          nowMs,
          config,
        );
        await persist(persistState, assertFence, state);
        continue;
      }
      const submitted = await submitPersistedIntent({
        state,
        pending,
        wallet,
        config,
        nowMs,
        requestExpiryMs,
        persistState,
        assertFence,
        replay: true,
      });
      return {
        state,
        confirmedBatchIds,
        replay: {
          outcome: submitted.operatorActionRequired
            ? "operator-action-required"
            : "idempotent-replay-submitted",
          transactionHash: submitted.transactionHash,
        },
      };
    }

    const receipts = await Promise.all(
      readers.map((reader) =>
        reader.getReceipt(pending.transactionHash),
      ),
    );
    if (receipts[0] === null && receipts[1] === null) {
      const transactions = await Promise.all(
        readers.map((reader) =>
          reader.getTransaction(pending.transactionHash),
        ),
      );
      if (transactions[0] === null && transactions[1] === null) {
        if (age >= DEEP_V3_KEEPER_V2_SAFE_REPLAY_MS) {
          enterOperatorState(
            state,
            pending,
            "transaction-absent-after-idempotency-window",
            nowMs,
            config,
          );
          await persist(persistState, assertFence, state);
        } else if (
          age >= DEEP_V3_KEEPER_V2_ABSENT_GRACE_MS &&
          (pending.lastReplayAtMs === null ||
            nowMs - pending.lastReplayAtMs >=
              DEEP_V3_KEEPER_V2_REPLAY_COOLDOWN_MS)
        ) {
          const replayed = await submitPersistedIntent({
            state,
            pending,
            wallet,
            config,
            nowMs,
            requestExpiryMs,
            persistState,
            assertFence,
            replay: true,
          });
          return {
            state,
            confirmedBatchIds,
            replay: {
              outcome: replayed.operatorActionRequired
                ? "operator-action-required"
                : "idempotent-replay-pending",
              transactionHash: replayed.transactionHash,
            },
          };
        }
        continue;
      }
      if (
        !sameTransaction(transactions[0], transactions[1]) ||
        !transactionMatchesPending(
          transactions[0],
          config,
          lane,
          pending,
        )
      ) {
        enterOperatorState(
          state,
          pending,
          "observed-transaction-envelope-mismatch",
          nowMs,
          config,
        );
        await persist(persistState, assertFence, state);
        continue;
      }
      continue;
    }
    if (
      receipts[0] === null ||
      receipts[1] === null ||
      !sameReceipt(receipts[0], receipts[1]) ||
      receipts[0].blockNumber > snapshot.number
    ) {
      if (age >= DEEP_V3_KEEPER_V2_SAFE_REPLAY_MS) {
        enterOperatorState(
          state,
          pending,
          "receipt-unresolved-after-idempotency-window",
          nowMs,
          config,
        );
        await persist(persistState, assertFence, state);
      }
      continue;
    }
    const canonical = await Promise.all(
      readers.map((reader) =>
        reader.getBlock(receipts[0].blockNumber),
      ),
    );
    if (
      canonical.some(
        (block) => !sameHash(block.hash, receipts[0].blockHash),
      )
    ) {
      if (age >= DEEP_V3_KEEPER_V2_SAFE_REPLAY_MS) {
        enterOperatorState(
          state,
          pending,
          "receipt-noncanonical-after-idempotency-window",
          nowMs,
          config,
        );
        await persist(persistState, assertFence, state);
      }
      continue;
    }
    if (
      !sameHash(
        receipts[0].transactionHash,
        pending.transactionHash,
      ) ||
      !["success", "reverted"].includes(receipts[0].status)
    ) {
      enterOperatorState(
        state,
        pending,
        "confirmed-receipt-scope-mismatch",
        nowMs,
        config,
      );
      await persist(persistState, assertFence, state);
      continue;
    }
    const transactions = await Promise.all(
      readers.map((reader) =>
        reader.getTransaction(pending.transactionHash),
      ),
    );
    if (
      !sameTransaction(transactions[0], transactions[1]) ||
      !transactionMatchesPending(
        transactions[0],
        config,
        lane,
        pending,
      )
    ) {
      enterOperatorState(
        state,
        pending,
        "confirmed-transaction-envelope-mismatch",
        nowMs,
        config,
      );
      await persist(persistState, assertFence, state);
      continue;
    }

    const actualDebit =
      receipts[0].gasUsed * receipts[0].effectiveGasPrice;
    if (
      receipts[0].gasUsed > BigInt(pending.request.gas) ||
      receipts[0].effectiveGasPrice >
        BigInt(pending.request.maxFeePerGas) ||
      actualDebit > BigInt(pending.request.maxGasDebitWei)
    ) {
      enterOperatorState(
        state,
        pending,
        "confirmed-gas-envelope-mismatch",
        nowMs,
        config,
      );
      await persist(persistState, assertFence, state);
      continue;
    }
    let results = pending.candidates.map(
      ({ vault, action }, candidateIndex) => ({
        candidateIndex,
        vault,
        expectedAction: action,
        actualAction: 0,
        outcome: -1,
      }),
    );
    if (receipts[0].status === "success") {
      const decoded = readers.map((reader, index) =>
        reader.candidateResults(
          receipts[index],
          config.executorAddress,
          lane.signerAddress,
        ),
      );
      if (
        !sameCandidateResults(decoded[0], decoded[1]) ||
        !validateCandidateResults(
          decoded[0],
          { ...pending, executorAddress: config.executorAddress },
          lane,
        )
      ) {
        enterOperatorState(
          state,
          pending,
          "confirmed-candidate-results-mismatch",
          nowMs,
          config,
        );
        await persist(persistState, assertFence, state);
        continue;
      }
      results = decoded[0].map((result) => ({
        candidateIndex: Number(result.candidateIndex),
        vault: result.vault,
        expectedAction: Number(result.expectedAction),
        actualAction: Number(result.actualAction),
        outcome: Number(result.outcome),
      }));
    }
    addActualDebit(state, pending, actualDebit);
    appendHistory(
      state,
      {
        batchId: pending.id,
        laneId: pending.laneId,
        transactionHash: pending.transactionHash,
        nonce: pending.nonce,
        receiptStatus: receipts[0].status,
        blockNumber: Number(receipts[0].blockNumber),
        blockHash: receipts[0].blockHash,
        actualGasDebitWei: actualDebit.toString(),
        confirmedAtMs: nowMs,
        candidates: results,
      },
      config.maxHistoryEntries,
    );
    removePending(state, pending.id);
    await persist(persistState, assertFence, state);
    confirmedBatchIds.push(pending.id);
  }
  return { state, confirmedBatchIds, replay: null };
}

async function laneObservations({
  state,
  lane,
  config,
  readers,
  snapshot,
}) {
  const [confirmedNonces, pendingNonces, balances] = await Promise.all([
    Promise.all(
      readers.map((reader) =>
        reader.getConfirmedTransactionCount(
          lane.signerAddress,
          snapshot.number,
        ),
      ),
    ),
    Promise.all(
      readers.map((reader) =>
        reader.getPendingTransactionCount(lane.signerAddress),
      ),
    ),
    Promise.all(
      readers.map((reader) =>
        reader.getBalance(lane.signerAddress, snapshot.number),
      ),
    ),
  ]);
  if (
    confirmedNonces[0] !== confirmedNonces[1] ||
    pendingNonces[0] !== pendingNonces[1] ||
    balances[0] !== balances[1] ||
    pendingNonces[0] < confirmedNonces[0]
  ) {
    fail(
      "SIGNER_STATE_DISAGREEMENT",
      "RPCs disagree on signer nonce or balance",
    );
  }
  lane.lastObservedConfirmedNonce = confirmedNonces[0].toString();
  lane.lastObservedPendingNonce = pendingNonces[0].toString();
  lane.lastObservedBalanceWei = balances[0].toString();
  lane.balanceAlert =
    balances[0] < config.signerBalanceFloorWei;

  const active = state.pendingBatches.filter(
    (pending) => pending.laneId === lane.id,
  );
  if (active.length > 0) {
    return {
      ready: false,
      reason:
        active[0].status === "operator"
          ? "operator-action-required"
          : "active-lane-batch",
      confirmedNonce: confirmedNonces[0],
      pendingNonce: pendingNonces[0],
      balance: balances[0],
    };
  }
  const expectedCount = pendingNonces[0] - confirmedNonces[0];
  if (expectedCount !== 0n) {
    return {
      ready: false,
      reason: "unresolved-signer-nonce",
      confirmedNonce: confirmedNonces[0],
      pendingNonce: pendingNonces[0],
      balance: balances[0],
    };
  }
  return {
    ready: true,
    reason: null,
    confirmedNonce: confirmedNonces[0],
    pendingNonce: pendingNonces[0],
    balance: balances[0],
  };
}

function bufferedGas(estimate, theoretical) {
  const bufferedEstimate = (estimate * 120n + 99n) / 100n;
  const theoreticalWithOverhead = theoretical + 100_000n;
  return bufferedEstimate > theoreticalWithOverhead
    ? bufferedEstimate
    : theoreticalWithOverhead;
}

async function dualFeeEnvelope(readers, config) {
  const fees = await Promise.all(
    readers.map((reader) => reader.estimateFees()),
  );
  for (const fee of fees) {
    if (
      typeof fee.maxFeePerGas !== "bigint" ||
      typeof fee.maxPriorityFeePerGas !== "bigint" ||
      fee.maxFeePerGas <= 0n ||
      fee.maxPriorityFeePerGas < 0n ||
      fee.maxPriorityFeePerGas > fee.maxFeePerGas
    ) {
      fail("FEE_ESTIMATE", "RPC returned an invalid fee estimate");
    }
  }
  const maxFeePerGas =
    fees[0].maxFeePerGas > fees[1].maxFeePerGas
      ? fees[0].maxFeePerGas
      : fees[1].maxFeePerGas;
  const maxPriorityFeePerGas =
    fees[0].maxPriorityFeePerGas >
    fees[1].maxPriorityFeePerGas
      ? fees[0].maxPriorityFeePerGas
      : fees[1].maxPriorityFeePerGas;
  if (maxFeePerGas > config.maxFeePerGasWei) {
    return {
      ready: false,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  }
  return {
    ready: true,
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
}

async function candidateEconomicEvidence({
  candidate,
  readers,
  config,
  snapshot,
  maxFeePerGas,
  lane,
}) {
  const work = await Promise.all(
    readers.map((reader) =>
      reader.readVaultWorkState(candidate.vault, snapshot.number),
    ),
  );
  if (
    work.some(
      (value) =>
        !Number.isSafeInteger(Number(value?.action)) ||
        typeof value?.hookGrowthFees !== "bigint" ||
        typeof value?.pendingNative !== "bigint" ||
        typeof value?.nextEligibleTimestamp !== "bigint" ||
        typeof value?.rollingCapacity !== "bigint" ||
        typeof value?.blockedReason !== "string",
    ) ||
    Number(work[0].action) !== Number(work[1].action) ||
    work[0].hookGrowthFees !== work[1].hookGrowthFees ||
    work[0].pendingNative !== work[1].pendingNative ||
    work[0].nextEligibleTimestamp !==
      work[1].nextEligibleTimestamp ||
    work[0].rollingCapacity !== work[1].rollingCapacity ||
    !sameHash(work[0].blockedReason, work[1].blockedReason) ||
    (candidate.action === DeepV3V2Action.Compound &&
      Number(work[0].action) !== DeepV3V2Action.Compound)
  ) {
    fail(
      "GROWTH_BUDGET_DISAGREEMENT",
      "RPCs disagree on eligible growth budget",
    );
  }
  const accruedGrowthWei =
    work[0].hookGrowthFees + work[0].pendingNative;
  let growthBudgetWei = accruedGrowthWei;
  if (growthBudgetWei > config.maximumCompoundNativeWei) {
    growthBudgetWei = config.maximumCompoundNativeWei;
  }
  if (growthBudgetWei > work[0].rollingCapacity) {
    growthBudgetWei = work[0].rollingCapacity;
  }
  const candidates = [candidate];
  const estimates = await Promise.all(
    readers.map((reader) =>
      reader.estimateExecuteGas(
        config.executorAddress,
        candidates.map(({ vault, action }) => ({
          vault,
          expectedAction: action,
        })),
        lane.signerAddress,
        snapshot.number,
      ),
    ),
  );
  const estimate =
    estimates[0] > estimates[1] ? estimates[0] : estimates[1];
  const gas = bufferedGas(
    estimate,
    deepV3KeeperV2TheoreticalGas(candidates),
  );
  return {
    ...candidate,
    accruedGrowthWei,
    growthBudgetWei,
    rollingCapacityWei: work[0].rollingCapacity,
    economicBudgetKind:
      candidate.action === DeepV3V2Action.Compound
        ? "compound-cycle"
        : "oracle-prerequisite",
    singleMaxGasDebitWei: gas * maxFeePerGas,
  };
}

async function prepareBatch({
  candidates,
  readers,
  config,
  snapshot,
  lane,
  laneState,
  state,
  nowMs,
  slot,
}) {
  const fees = await dualFeeEnvelope(readers, config);
  if (!fees.ready) {
    return { ready: false, reason: "fee-cap" };
  }
  let packed = packDeepV3KeeperV2Candidates(
    candidates,
    config.maxTransactionGas,
  );
  if (packed.length === 0) {
    return { ready: false, reason: "gas-packing" };
  }
  const economicCandidates = await Promise.all(
    packed.map((candidate) =>
      candidateEconomicEvidence({
        candidate,
        readers,
        config,
        snapshot,
        maxFeePerGas: fees.maxFeePerGas,
        lane,
      }),
    ),
  );
  packed = economicCandidates
    .filter(({ growthBudgetWei, singleMaxGasDebitWei }) =>
      ratioPass(
        growthBudgetWei,
        singleMaxGasDebitWei,
        config.minGrowthToMaxGasRatioBps,
      ),
    )
    .map(({ vault, action }) => ({ vault, action }));
  if (packed.length === 0) {
    return { ready: false, reason: "candidate-growth-ratio" };
  }

  let batchGas = 0n;
  while (packed.length > 0) {
    const wireCandidates = packed.map(({ vault, action }) => ({
      vault,
      expectedAction: action,
    }));
    const simulations = await Promise.all(
      readers.map((reader) =>
        reader.simulateExecute(
          config.executorAddress,
          wireCandidates,
          lane.signerAddress,
          snapshot.number,
        ),
      ),
    );
    if (
      simulations.some(
        ({ attempted, succeeded }) =>
          attempted !== BigInt(packed.length) ||
          succeeded !== BigInt(packed.length),
      )
    ) {
      return { ready: false, reason: "simulation-unproductive" };
    }
    const estimates = await Promise.all(
      readers.map((reader) =>
        reader.estimateExecuteGas(
          config.executorAddress,
          wireCandidates,
          lane.signerAddress,
          snapshot.number,
        ),
      ),
    );
    const estimate =
      estimates[0] > estimates[1] ? estimates[0] : estimates[1];
    batchGas = bufferedGas(
      estimate,
      deepV3KeeperV2TheoreticalGas(packed),
    );
    if (
      batchGas <= config.maxTransactionGas &&
      batchGas <= config.maxTotalGasPerTick
    ) {
      break;
    }
    packed.pop();
  }
  if (packed.length === 0) {
    return { ready: false, reason: "gas-policy" };
  }
  const selectedEvidence = economicCandidates.filter((evidence) =>
    packed.some(({ vault }) => sameAddress(vault, evidence.vault)),
  );
  const batchGrowthBudgetWei = selectedEvidence.reduce(
    (total, candidate) => total + candidate.growthBudgetWei,
    0n,
  );
  const batchMaxGasDebitWei = batchGas * fees.maxFeePerGas;
  const currentDay = dayStart(nowMs);
  const currentTick = state.tickBudgets.find(
    (entry) => entry.slot === slot,
  );
  const committedTodayWei = BigInt(
    state.gasBudgetDays.find(
      ({ dayStartMs }) => dayStartMs === currentDay,
    )?.committedMaxDebitWei ?? "0",
  );
  const policy = passesDeepV3KeeperV2EconomicPolicy({
    candidates: selectedEvidence,
    batchGrowthBudgetWei,
    batchMaxGasDebitWei,
    minGrowthToMaxGasRatioBps:
      config.minGrowthToMaxGasRatioBps,
    batchGas,
    maxTotalGasPerTick: config.maxTotalGasPerTick,
    committedTickGas: BigInt(
      currentTick?.committedGas ?? "0",
    ),
    maxTotalDebitWeiPerTick:
      config.maxTotalDebitWeiPerTick,
    committedTickDebitWei: BigInt(
      currentTick?.committedMaxDebitWei ?? "0",
    ),
    tickSubmissionCount: currentTick?.submissionCount ?? 0,
    maxNewSubmissionsPerTick:
      config.maxNewSubmissionsPerTick,
    maxTotalDebitWeiPerDay:
      config.maxTotalDebitWeiPerDay,
    committedTodayWei,
    signerBalanceWei: laneState.balance,
    signerBalanceFloorWei: config.signerBalanceFloorWei,
  });
  if (!policy.ready) {
    return {
      ready: false,
      reason: policy.reasons.at(-1),
      reasons: policy.reasons,
    };
  }
  return {
    ready: true,
    candidates: selectedEvidence,
    gas: batchGas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    batchGrowthBudgetWei,
    batchMaxGasDebitWei,
    currentDay,
    slot,
  };
}

export async function runDeepV3KeeperV2Cycle({
  config,
  state: inputState,
  readers,
  wallet,
  nowMs,
  requestExpiryMs,
  persistState,
  assertFence,
}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    fail("INVALID_CLOCK", "Keeper clock must be a non-negative integer");
  }
  if (
    !Number.isSafeInteger(requestExpiryMs) ||
    requestExpiryMs <= nowMs ||
    requestExpiryMs - nowMs >
      DEEP_V3_KEEPER_V2_MAX_SIGNER_REQUEST_LIFETIME_MS
  ) {
    fail(
      "INVALID_SIGNER_EXPIRY",
      "Signer request expiry is outside the cycle deadline",
    );
  }
  if (config.signerLanes.length !== 1) {
    fail(
      "SIGNER_LANE_POLICY",
      "This release ships exactly one signer lane",
    );
  }
  let state = clone(inputState);
  const slot = deepV3KeeperV2Slot(nowMs);
  const snapshot = await commonSnapshot(readers, config);
  await assertRuntimeTopology(readers, config, snapshot);

  const reconciliation = await reconcilePendingBatches({
    state,
    config,
    readers,
    wallet,
    snapshot,
    nowMs,
    requestExpiryMs,
    persistState,
    assertFence,
  });
  state = reconciliation.state;
  if (reconciliation.replay) {
    return {
      outcome: reconciliation.replay.outcome,
      state,
      transactionHash: reconciliation.replay.transactionHash,
      commonBlock: snapshot,
      scanned: 0,
      confirmedBatchIds: reconciliation.confirmedBatchIds,
      submittedBatchIds: [],
    };
  }
  if (
    state.pendingBatches.some(
      ({ status }) => status === "operator",
    )
  ) {
    const lane = state.lanes[0];
    lane.blockedReason = "operator-action-required";
    await persist(persistState, assertFence, state);
    return {
      outcome: "operator-action-required",
      state,
      transactionHash: null,
      commonBlock: snapshot,
      scanned: 0,
      confirmedBatchIds: reconciliation.confirmedBatchIds,
      submittedBatchIds: [],
    };
  }

  const lane = state.lanes[0];
  const existingTickBudget = state.tickBudgets.find(
    (entry) => entry.slot === slot,
  );
  if (
    lane.lastSubmissionSlot === slot ||
    (existingTickBudget?.submissionCount ?? 0) >=
      config.maxNewSubmissionsPerTick
  ) {
    lane.blockedReason = "tick-submission-cap";
    await persist(persistState, assertFence, state);
    return {
      outcome: "tick-submission-cap",
      state,
      transactionHash: null,
      commonBlock: snapshot,
      scanned: 0,
      confirmedBatchIds: reconciliation.confirmedBatchIds,
      submittedBatchIds: [],
    };
  }
  const partition = state.partitions.find(
    ({ id }) => id === lane.partitionId,
  );
  if (!partition) {
    fail("PARTITION_MISSING", "Signer lane partition is missing");
  }
  const startCursor = partition.cursor;
  const excludedVaults = new Set(
    state.pendingBatches.flatMap((pending) =>
      pending.candidates.map(({ vault }) => vault.toLowerCase()),
    ),
  );
  const scan = await scanDeepV3KeeperV2Pages({
    readers,
    automationAddress: config.automationAddress,
    blockNumber: snapshot.number,
    startCursor,
    pageSize: config.scanPageSize,
    maxPages: config.maxScanPages,
    excludedVaults,
  });
  partition.cursor = scan.nextCursor;
  partition.lastScanBlockNumber = Number(snapshot.number);
  partition.lastScanBlockHash = snapshot.hash;
  partition.lastScannedAtMs = nowMs;
  state.lastCycleSlot = slot;
  state.lastCycleAtMs = nowMs;
  state.lastCanonicalBlockNumber = Number(snapshot.number);
  state.lastCanonicalBlockHash = snapshot.hash;
  await persist(persistState, assertFence, state);

  const laneState = await laneObservations({
    state,
    lane,
    config,
    readers,
    snapshot,
  });
  if (!laneState.ready) {
    lane.blockedReason = laneState.reason;
    await persist(persistState, assertFence, state);
    return {
      outcome: "scanned-lane-blocked",
      state,
      transactionHash: null,
      commonBlock: snapshot,
      scanned: scan.scanned,
      confirmedBatchIds: reconciliation.confirmedBatchIds,
      submittedBatchIds: [],
    };
  }
  if (
    state.pendingBatches.length >= config.maxActivePendingBatches ||
    scan.candidates.length === 0
  ) {
    lane.blockedReason =
      state.pendingBatches.length >= config.maxActivePendingBatches
        ? "pending-capacity"
        : null;
    await persist(persistState, assertFence, state);
    return {
      outcome:
        scan.candidates.length === 0
          ? "scanned-none"
          : "pending-capacity",
      state,
      transactionHash: null,
      commonBlock: snapshot,
      scanned: scan.scanned,
      confirmedBatchIds: reconciliation.confirmedBatchIds,
      submittedBatchIds: [],
    };
  }

  const prepared = await prepareBatch({
    candidates: scan.candidates,
    readers,
    config,
    snapshot,
    lane,
    laneState,
    state,
    nowMs,
    slot,
  });
  if (!prepared.ready) {
    lane.blockedReason = prepared.reason;
    lane.balanceAlert =
      prepared.reason === "signer-balance-floor" ||
      lane.balanceAlert;
    await persist(persistState, assertFence, state);
    return {
      outcome: "economic-policy-blocked",
      state,
      transactionHash: null,
      commonBlock: snapshot,
      scanned: scan.scanned,
      confirmedBatchIds: reconciliation.confirmedBatchIds,
      submittedBatchIds: [],
      policyReasons: prepared.reasons ?? [prepared.reason],
    };
  }

  lane.blockedReason = null;
  lane.balanceAlert = false;
  const candidates = prepared.candidates.map(
    ({
      vault,
      action,
      accruedGrowthWei,
      growthBudgetWei,
      rollingCapacityWei,
      economicBudgetKind,
      singleMaxGasDebitWei,
    }) => ({
      vault,
      action,
      accruedGrowthWei: accruedGrowthWei.toString(),
      growthBudgetWei: growthBudgetWei.toString(),
      rollingCapacityWei: rollingCapacityWei.toString(),
      economicBudgetKind,
      singleMaxGasDebitWei: singleMaxGasDebitWei.toString(),
    }),
  );
  const expectedNonce = laneState.pendingNonce;
  const requestHash = deepV3KeeperV2RequestHash({
    executorAddress: config.executorAddress,
    candidates,
    gas: prepared.gas,
    maxFeePerGas: prepared.maxFeePerGas,
    maxPriorityFeePerGas: prepared.maxPriorityFeePerGas,
    expectedNonce,
    signerRequestLifetimeMs:
      DEEP_V3_KEEPER_V2_MAX_SIGNER_REQUEST_LIFETIME_MS,
  });
  const idempotencyKey = deepV3KeeperV2IdempotencyKey({
    sourceCommitment: config.sourceCommitment,
    opsSourceCommitment: config.opsSourceCommitment,
    releaseVersion: config.releaseVersion,
    laneId: lane.id,
    slot,
    blockHash: snapshot.hash,
    scanStartCursor: startCursor,
    scanEndCursor: scan.nextCursor,
    candidates,
    requestHash,
  });
  const suffix = idempotencyKey.slice("deepv3v2-".length);
  const batchId = `batch-${suffix}`;
  const referenceId = `deep-v3-v2-${suffix}`;
  const pending = {
    id: batchId,
    laneId: lane.id,
    partitionId: partition.id,
    slot,
    scanBlockNumber: Number(snapshot.number),
    scanBlockHash: snapshot.hash,
    scanStartCursor: startCursor,
    scanEndCursor: scan.nextCursor,
    candidates,
    idempotencyKey,
    referenceId,
    request: {
      requestHash,
      gas: prepared.gas.toString(),
      maxFeePerGas: prepared.maxFeePerGas.toString(),
      maxPriorityFeePerGas:
        prepared.maxPriorityFeePerGas.toString(),
      maxGasDebitWei: prepared.batchMaxGasDebitWei.toString(),
      growthBudgetWei: prepared.batchGrowthBudgetWei.toString(),
      expectedNonce: expectedNonce.toString(),
      signerRequestLifetimeMs:
        DEEP_V3_KEEPER_V2_MAX_SIGNER_REQUEST_LIFETIME_MS.toString(),
    },
    transactionHash: null,
    transactionId: null,
    nonce: null,
    createdAtMs: nowMs,
    lastReplayAtMs: null,
    replayCount: 0,
    budgetDayStartMs: prepared.currentDay,
    status: "intent",
  };
  state.pendingBatches.push(pending);
  refreshLaneIndexes(state);
  const budget = budgetForDay(state, prepared.currentDay);
  budget.committedMaxDebitWei = (
    BigInt(budget.committedMaxDebitWei) +
    prepared.batchMaxGasDebitWei
  ).toString();
  budget.submissionCount += 1;
  const tickBudget = budgetForTick(state, slot);
  tickBudget.committedGas = (
    BigInt(tickBudget.committedGas) + prepared.gas
  ).toString();
  tickBudget.committedMaxDebitWei = (
    BigInt(tickBudget.committedMaxDebitWei) +
    prepared.batchMaxGasDebitWei
  ).toString();
  tickBudget.submissionCount += 1;
  lane.lastSubmissionSlot = slot;
  await persist(persistState, assertFence, state);

  const submitted = await submitPersistedIntent({
    state,
    pending,
    wallet,
    config,
    nowMs,
    requestExpiryMs,
    persistState,
    assertFence,
    replay: false,
  });
  return {
    outcome: submitted.operatorActionRequired
      ? "operator-action-required"
      : "submitted",
    state,
    transactionHash: submitted.transactionHash,
    commonBlock: snapshot,
    scanned: scan.scanned,
    confirmedBatchIds: reconciliation.confirmedBatchIds,
    submittedBatchIds: submitted.operatorActionRequired
      ? []
      : [batchId],
  };
}

export const DEEP_V3_KEEPER_V2_TIMING = Object.freeze({
  absentGraceMs: DEEP_V3_KEEPER_V2_ABSENT_GRACE_MS,
  safeReplayMs: DEEP_V3_KEEPER_V2_SAFE_REPLAY_MS,
  replayCooldownMs: DEEP_V3_KEEPER_V2_REPLAY_COOLDOWN_MS,
});

export const DEEP_V3_KEEPER_V2_INTERNALS = Object.freeze({
  sameAddress,
  sameHash,
});
