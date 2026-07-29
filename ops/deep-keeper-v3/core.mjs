import {
  encodeFunctionData,
  encodePacked,
  getAddress,
  keccak256,
} from "viem";

import {
  DEEP_V3_KEEPER_ABSENT_TRANSACTION_GRACE_MS,
  DEEP_V3_KEEPER_INTERVAL_MS,
  DEEP_V3_KEEPER_REPLAY_COOLDOWN_MS,
  DEEP_V3_KEEPER_SAFE_PRIVY_REPLAY_MS,
} from "./config.mjs";

export const DeepV3Action = Object.freeze({
  None: 0,
  Compound: 1,
  GrowOracle: 2,
});

export const DEEP_V3_AUTOMATION_ABI = [
  {
    type: "function",
    name: "registeredVaultCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "registeredVaultAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "assessVault",
    stateMutability: "view",
    inputs: [{ name: "vaultAddress", type: "address" }],
    outputs: [{ name: "action", type: "uint8" }],
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

export const DEEP_V3_LAUNCHER_ABI = [
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

export const DEEP_V3_EXECUTOR_ABI = [
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

export class DeepV3KeeperError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepV3KeeperError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeepV3KeeperError(code, message);
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

function clone(value) {
  return structuredClone(value);
}

export function deepV3KeeperSlot(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    fail("INVALID_CLOCK", "Keeper clock must be a non-negative integer");
  }
  return Math.floor(nowMs / DEEP_V3_KEEPER_INTERVAL_MS);
}

function idempotencyKey(config, slot, cursor, vault, action) {
  const digest = keccak256(
    encodePacked(
      ["bytes32", "uint256", "uint256", "address", "uint8"],
      [
        config.sourceCommitment,
        BigInt(slot),
        BigInt(cursor),
        vault,
        action,
      ],
    ),
  );
  return `deep-${digest.slice(2, 34)}`;
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
        typeof block.hash !== "string",
    ) ||
    !sameHash(blocks[0].hash, blocks[1].hash)
  ) {
    fail(
      "CANONICAL_BLOCK_DISAGREEMENT",
      "Read RPCs disagree on the common block",
    );
  }
  return {
    number: blockNumber,
    hash: blocks[0].hash,
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
        "The Deep V3 runtime topology is not the reviewed topology",
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

async function assessCandidate(readers, config, snapshot, cursor) {
  const counts = await Promise.all(
    readers.map((reader) =>
      reader.readRegisteredVaultCount(
        config.automationAddress,
        snapshot.number,
      ),
    ),
  );
  if (counts[0] !== counts[1]) {
    fail("REGISTRY_DISAGREEMENT", "Read RPCs disagree on registry size");
  }
  if (counts[0] === 0n) {
    return { count: 0n, index: 0n, vault: null, action: 0 };
  }
  const index = BigInt(cursor) % counts[0];
  const vaults = await Promise.all(
    readers.map((reader) =>
      reader.readRegisteredVaultAt(
        config.automationAddress,
        index,
        snapshot.number,
      ),
    ),
  );
  if (!sameAddress(vaults[0], vaults[1])) {
    fail("REGISTRY_DISAGREEMENT", "Read RPCs disagree on the vault");
  }
  const vault = getAddress(vaults[0]);
  const actions = await Promise.all(
    readers.map((reader) =>
      reader.assessVault(
        config.automationAddress,
        vault,
        snapshot.number,
      ),
    ),
  );
  if (
    actions.some(
      (action) =>
        !Number.isInteger(action) ||
        action < DeepV3Action.None ||
        action > DeepV3Action.GrowOracle,
    )
  ) {
    fail("MALFORMED_ASSESSMENT", "assessVault returned an invalid action");
  }
  if (actions[0] !== actions[1]) {
    fail(
      "ASSESSMENT_DISAGREEMENT",
      "Read RPCs disagree on assessVault",
    );
  }
  return {
    count: counts[0],
    index,
    vault,
    action: actions[0],
  };
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

function completedState(state, slot, nowMs, snapshot, nextCursor) {
  return {
    ...state,
    cursor: nextCursor,
    lastCompletedSlot: slot,
    lastCompletedAtMs: nowMs,
    lastCompletedBlockNumber: Number(snapshot.number),
    lastCompletedBlockHash: snapshot.hash,
    pending: null,
  };
}

function sameReceipt(left, right) {
  return (
    left &&
    right &&
    left.transactionHash === right.transactionHash &&
    left.status === right.status &&
    left.blockNumber === right.blockNumber &&
    sameHash(left.blockHash, right.blockHash) &&
    left.gasUsed === right.gasUsed &&
    left.effectiveGasPrice === right.effectiveGasPrice &&
    sameAddress(left.from, right.from) &&
    sameAddress(left.to, right.to)
  );
}

export function deepV3ExecuteData(vault, action) {
  return encodeFunctionData({
    abi: DEEP_V3_EXECUTOR_ABI,
    functionName: "execute",
    args: [[{ vault, expectedAction: action }]],
  });
}

function operatorState(state, pending, reason, nowMs) {
  return {
    ...state,
    operatorActionRequired: {
      reason,
      transactionHash: pending.transactionHash,
      vault: pending.vault,
      action: pending.action,
      enteredAtMs: nowMs,
    },
  };
}

function transactionPairMatches(left, right) {
  return (
    left &&
    right &&
    left.hash === right.hash &&
    sameAddress(left.from, right.from) &&
    sameAddress(left.to, right.to) &&
    left.value === right.value &&
    left.input === right.input
  );
}

function transactionMatchesScope(transaction, config, pending) {
  return (
    transaction.hash.toLowerCase() ===
      pending.transactionHash?.toLowerCase() &&
    sameAddress(transaction.from, config.signerAddress) &&
    sameAddress(transaction.to, config.executorAddress) &&
    transaction.value === 0n &&
    transaction.input ===
      deepV3ExecuteData(pending.vault, pending.action)
  );
}

async function settlePending({
  config,
  state,
  readers,
  nowMs,
  persistState,
  assertFence,
}) {
  const pending = state.pending;
  const unresolved = async () => {
    if (nowMs < pending.createdAtMs) {
      fail(
        "CLOCK_REGRESSION",
        "Pending transaction was created in the future",
      );
    }
    if (
      nowMs - pending.createdAtMs <
      DEEP_V3_KEEPER_SAFE_PRIVY_REPLAY_MS
    ) {
      return { kind: "pending", state };
    }
    const blocked = operatorState(
      state,
      pending,
      "unresolved-transaction-after-privy-idempotency-window",
      nowMs,
    );
    await persist(persistState, assertFence, blocked);
    return { kind: "operator-action-required", state: blocked };
  };
  if (pending.transactionHash === null) {
    if (nowMs < pending.createdAtMs) {
      fail("CLOCK_REGRESSION", "Pending intent was created in the future");
    }
    if (
      nowMs - pending.createdAtMs >=
      DEEP_V3_KEEPER_SAFE_PRIVY_REPLAY_MS
    ) {
      const blocked = operatorState(
        state,
        pending,
        "submission-intent-after-privy-idempotency-window",
        nowMs,
      );
      await persist(persistState, assertFence, blocked);
      return { kind: "operator-action-required", state: blocked };
    }
    return { kind: "resubmit", state };
  }
  const receipts = await Promise.all(
    readers.map((reader) =>
      reader.getReceipt(pending.transactionHash),
    ),
  );
  const snapshot = await commonSnapshot(readers, config);
  await assertRuntimeTopology(readers, config, snapshot);
  if (receipts[0] === null && receipts[1] === null) {
    const transactions = await Promise.all(
      readers.map((reader) =>
        reader.getTransaction(pending.transactionHash),
      ),
    );
    if (transactions[0] === null && transactions[1] === null) {
      if (nowMs < pending.createdAtMs) {
        fail(
          "CLOCK_REGRESSION",
          "Pending transaction was created in the future",
        );
      }
      const age = nowMs - pending.createdAtMs;
      if (age >= DEEP_V3_KEEPER_SAFE_PRIVY_REPLAY_MS) {
        const blocked = operatorState(
          state,
          pending,
          "transaction-absent-after-privy-idempotency-window",
          nowMs,
        );
        await persist(persistState, assertFence, blocked);
        return { kind: "operator-action-required", state: blocked };
      }
      if (
        age >= DEEP_V3_KEEPER_ABSENT_TRANSACTION_GRACE_MS &&
        (pending.lastReplayAtMs === null ||
          nowMs - pending.lastReplayAtMs >=
            DEEP_V3_KEEPER_REPLAY_COOLDOWN_MS)
      ) {
        return { kind: "replay", state };
      }
      return { kind: "pending", state };
    }
    if (
      !transactionPairMatches(transactions[0], transactions[1])
    ) {
      return unresolved();
    }
    if (!transactionMatchesScope(transactions[0], config, pending)) {
      fail(
        "TRANSACTION_SCOPE_MISMATCH",
        "Pending transaction is outside the fixed keeper call",
      );
    }
    return unresolved();
  }
  if (receipts[0] === null || receipts[1] === null) {
    return unresolved();
  }
  if (!sameReceipt(receipts[0], receipts[1])) {
    return unresolved();
  }
  if (receipts[0].blockNumber > snapshot.number) {
    return unresolved();
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
    return unresolved();
  }
  if (receipts[0].status !== "success") {
    const retryable = { ...state, pending: null };
    await persist(persistState, assertFence, retryable);
    return { kind: "retryable-revert", state: retryable };
  }
  const transactions = await Promise.all(
    readers.map((reader) =>
      reader.getTransaction(pending.transactionHash),
    ),
  );
  if (
    !transactionPairMatches(transactions[0], transactions[1])
  ) {
    return unresolved();
  }
  if (!transactionMatchesScope(transactions[0], config, pending)) {
    fail(
      "TRANSACTION_SCOPE_MISMATCH",
      "Confirmed transaction is outside the fixed keeper call",
    );
  }
  const actions = await Promise.all(
    readers.map((reader, index) =>
      reader.productiveAction(
        receipts[index],
        config.executorAddress,
        pending.vault,
        config.signerAddress,
      ),
    ),
  );
  if (
    actions[0] !== pending.action ||
    actions[1] !== pending.action
  ) {
    const retryable = { ...state, pending: null };
    await persist(persistState, assertFence, retryable);
    return { kind: "retryable-unproductive", state: retryable };
  }
  const completed = completedState(
    state,
    pending.slot,
    nowMs,
    {
      number: receipts[0].blockNumber,
      hash: receipts[0].blockHash,
    },
    pending.cursor + 1,
  );
  await persist(persistState, assertFence, completed);
  return {
    kind: "confirmed-productive",
    state: completed,
    transactionHash: pending.transactionHash,
    action: pending.action,
  };
}

async function sendPending({
  config,
  state,
  readers,
  wallet,
  nowMs,
  persistState,
  assertFence,
}) {
  if (
    !wallet ||
    wallet.supportsStableIdempotency !== true ||
    !config.signerAddress
  ) {
    fail(
      "SIGNER_UNAVAILABLE",
      "A replay-safe remote policy wallet is required",
    );
  }
  let workingState = state;
  let pending = state.pending;
  const snapshot = await commonSnapshot(readers, config);
  await assertRuntimeTopology(readers, config, snapshot);
  const assessedActions = await Promise.all(
    readers.map((reader) =>
      reader.assessVault(
        config.automationAddress,
        pending.vault,
        snapshot.number,
      ),
    ),
  );
  if (
    assessedActions[0] !== pending.action ||
    assessedActions[1] !== pending.action
  ) {
    fail(
      "ASSESSMENT_DISAGREEMENT",
      "The direct send-time assessment is not the expected action",
    );
  }

  const balances = await Promise.all(
    readers.map((reader) =>
      reader.getBalance(config.signerAddress, snapshot.number),
    ),
  );
  if (balances[0] !== balances[1]) {
    fail(
      "SIGNER_BALANCE_POLICY",
      "Read RPCs disagree on signer balance",
    );
  }
  const candidate = {
    vault: pending.vault,
    expectedAction: pending.action,
  };
  const simulations = await Promise.all(
    readers.map((reader) =>
      reader.simulateExecute(
        config.executorAddress,
        [candidate],
        config.signerAddress,
        snapshot.number,
      ),
    ),
  );
  if (
    simulations.some(
      (result) => result.attempted !== 1n || result.succeeded !== 1n,
    )
  ) {
    fail(
      "UNPRODUCTIVE_SIMULATION",
      "Executor simulation was not productive",
    );
  }
  const gasEstimates = await Promise.all(
    readers.map((reader) =>
      reader.estimateExecuteGas(
        config.executorAddress,
        [candidate],
        config.signerAddress,
        snapshot.number,
      ),
    ),
  );
  const requiredGas =
    gasEstimates[0] > gasEstimates[1]
      ? gasEstimates[0]
      : gasEstimates[1];
  if (requiredGas <= 0n || requiredGas > config.maxGas) {
    fail("GAS_POLICY", "Executor gas exceeds the reviewed ceiling");
  }
  let gas;
  let maxFeePerGas;
  let maxPriorityFeePerGas;
  if (
    pending.gas !== null &&
    pending.maxFeePerGas !== null &&
    pending.maxPriorityFeePerGas !== null
  ) {
    gas = BigInt(pending.gas);
    maxFeePerGas = BigInt(pending.maxFeePerGas);
    maxPriorityFeePerGas = BigInt(pending.maxPriorityFeePerGas);
    if (requiredGas > gas) {
      fail(
        "REPLAY_ENVELOPE_UNSAFE",
        "Current execution no longer fits the persisted request",
      );
    }
  } else {
    const feeEstimates = await Promise.all(
      readers.map((reader) => reader.estimateFees()),
    );
    gas = requiredGas;
    maxFeePerGas =
      feeEstimates[0].maxFeePerGas >
      feeEstimates[1].maxFeePerGas
        ? feeEstimates[0].maxFeePerGas
        : feeEstimates[1].maxFeePerGas;
    maxPriorityFeePerGas =
      feeEstimates[0].maxPriorityFeePerGas >
      feeEstimates[1].maxPriorityFeePerGas
        ? feeEstimates[0].maxPriorityFeePerGas
        : feeEstimates[1].maxPriorityFeePerGas;
  }
  if (
    gas <= 0n ||
    gas > config.maxGas ||
    maxFeePerGas <= 0n ||
    maxPriorityFeePerGas < 0n ||
    maxPriorityFeePerGas > maxFeePerGas ||
    maxFeePerGas > config.maxFeePerGasWei
  ) {
    fail("FEE_POLICY", "Network fee estimate exceeds the reviewed ceiling");
  }
  if (balances[0] < gas * maxFeePerGas) {
    fail(
      "SIGNER_BALANCE_POLICY",
      "Signer balance cannot cover the bounded transaction",
    );
  }
  if (pending.gas === null) {
    const prepared = {
      ...state,
      pending: {
        ...pending,
        gas: gas.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      },
    };
    await persist(persistState, assertFence, prepared);
    workingState = prepared;
    pending = prepared.pending;
  }

  await requireFence(assertFence);
  const transactionHash = await wallet.writeContract({
    address: config.executorAddress,
    abi: DEEP_V3_EXECUTOR_ABI,
    functionName: "execute",
    args: [[candidate]],
    account: config.signerAddress,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    idempotencyKey: pending.idempotencyKey,
  });
  if (
    pending.transactionHash !== null &&
    pending.transactionHash.toLowerCase() !==
      transactionHash.toLowerCase()
  ) {
    const blocked = operatorState(
      workingState,
      pending,
      "privy-idempotency-hash-mismatch",
      nowMs,
    );
    await persist(persistState, assertFence, blocked);
    return {
      outcome: "operator-action-required",
      state: blocked,
      transactionHash: pending.transactionHash,
      commonBlock: snapshot,
      action: pending.action,
    };
  }
  const replay = pending.transactionHash !== null;
  const submitted = {
    ...workingState,
    pending: {
      ...pending,
      transactionHash,
      lastReplayAtMs: replay ? nowMs : pending.lastReplayAtMs,
      replayCount: replay
        ? pending.replayCount + 1
        : pending.replayCount,
    },
  };
  await persist(persistState, assertFence, submitted);
  return {
    outcome: replay ? "idempotent-replay-pending" : "submitted",
    state: submitted,
    transactionHash,
    commonBlock: snapshot,
    action: pending.action,
  };
}

export async function runDeepV3KeeperCycle({
  config,
  state,
  readers,
  wallet,
  nowMs,
  persistState,
  assertFence,
}) {
  if (
    config.intervalMs !== DEEP_V3_KEEPER_INTERVAL_MS ||
    config.scanLimit !== 1 ||
    config.maxBatchSize !== 1
  ) {
    fail("INVALID_POLICY", "Deep V3 starts with one vault per slot");
  }
  const slot = deepV3KeeperSlot(nowMs);
  if (
    [
      state.lastCompletedAtMs,
      state.pending?.createdAtMs,
      state.pending?.lastReplayAtMs,
      state.operatorActionRequired?.enteredAtMs,
    ].some((value) => value !== null && value !== undefined && value > nowMs)
  ) {
    fail("CLOCK_REGRESSION", "Keeper clock moved behind durable state");
  }
  if (state.operatorActionRequired !== null) {
    return {
      outcome: "operator-action-required",
      state,
      transactionHash: state.pending?.transactionHash ?? null,
      commonBlock: null,
      action: state.pending?.action ?? DeepV3Action.None,
    };
  }
  if (
    state.lastCompletedSlot !== null &&
    state.lastCompletedSlot > slot
  ) {
    fail("CLOCK_REGRESSION", "Keeper clock moved behind durable state");
  }
  if (state.lastCompletedSlot === slot && state.pending === null) {
    return {
      outcome: "not-due",
      state,
      transactionHash: null,
      commonBlock: null,
      action: DeepV3Action.None,
    };
  }

  if (state.pending !== null) {
    const settled = await settlePending({
      config,
      state,
      readers,
      nowMs,
      persistState,
      assertFence,
    });
    if (
      settled.kind === "resubmit" ||
      settled.kind === "replay"
    ) {
      return sendPending({
        config,
        state: settled.state,
        readers,
        wallet,
        nowMs,
        persistState,
        assertFence,
      });
    }
    return {
      outcome: settled.kind,
      state: settled.state,
      transactionHash: settled.transactionHash ?? state.pending.transactionHash,
      commonBlock: null,
      action: settled.action ?? state.pending.action,
    };
  }

  const snapshot = await commonSnapshot(readers, config);
  await assertRuntimeTopology(readers, config, snapshot);
  const candidate = await assessCandidate(
    readers,
    config,
    snapshot,
    state.cursor,
  );
  if (candidate.action === DeepV3Action.None) {
    const nextCursor =
      candidate.count === 0n ? 0 : Number(candidate.index + 1n);
    const completed = completedState(
      state,
      slot,
      nowMs,
      snapshot,
      nextCursor,
    );
    await persist(persistState, assertFence, completed);
    return {
      outcome: "common-block-none",
      state: completed,
      transactionHash: null,
      commonBlock: snapshot,
      action: DeepV3Action.None,
    };
  }

  const pending = {
    ...state,
    pending: {
      vault: candidate.vault,
      action: candidate.action,
      slot,
      cursor: Number(candidate.index),
      idempotencyKey: idempotencyKey(
        config,
        slot,
        Number(candidate.index),
        candidate.vault,
        candidate.action,
      ),
      transactionHash: null,
      createdAtMs: nowMs,
      lastReplayAtMs: null,
      replayCount: 0,
      gas: null,
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    },
  };
  await persist(persistState, assertFence, pending);
  return sendPending({
    config,
    state: pending,
    readers,
    wallet,
    nowMs,
    persistState,
    assertFence,
  });
}
