import { describe, expect, it, vi } from "vitest";

import {
  createDeepV3KeeperV2State,
  type DeepV3KeeperV2PendingBatch,
} from "../ops/deep-keeper-v3/control-v2.mjs";
import type { DeepV3KeeperV2Config } from "../ops/deep-keeper-v3/config-v2.mjs";
import {
  DeepV3V2Action,
  deepV3KeeperV2ExecuteData,
  deepV3KeeperV2ExecutorBatchHash,
  deepV3KeeperV2IdempotencyKey,
  deepV3KeeperV2RequestHash,
  runDeepV3KeeperV2Cycle,
} from "../ops/deep-keeper-v3/core-v2.mjs";

const address = (value: number) =>
  `0x${value.toString(16).padStart(40, "0")}` as `0x${string}`;
const hash = (digit: string) =>
  `0x${digit.repeat(64)}` as `0x${string}`;
const commonHash = hash("a");
const transactionHash = hash("b");

const config = {
  releaseVersion: "deep-keeper-v3-ops-v2",
  controlPath: "ops/deep-keeper-v3/control-v2.json",
  legacyControlPath: "ops/deep-keeper-v3/control-v1.json",
  enabled: true,
  sendTransactions: true,
  legacyEnabled: false,
  legacySends: false,
  deploymentCommit: "a".repeat(40),
  releaseManifest:
    "contracts/deployments/mainnet-deep-full-range-v3.json",
  chainId: 1,
  automationAddress: address(1),
  automationRuntimeHash: hash("1"),
  launcherAddress: address(2),
  launcherRuntimeHash: hash("2"),
  vaultFactoryAddress: address(3),
  vaultFactoryRuntimeHash: hash("3"),
  executorAddress: address(4),
  executorRuntimeHash: hash("4"),
  sourceCommitment: hash("5"),
  opsSourceCommitment: hash("6"),
  rpcUrls: [
    "https://rpc-one.example/",
    "https://rpc-two.example/",
  ],
  confirmations: 12,
  intervalMs: 300_000,
  scanPageSize: 32,
  maxScanPages: 2,
  maxCandidatesPerBatch: 4,
  maxNewSubmissionsPerTick: 1,
  maxActivePendingBatches: 8,
  maxOperatorIncidents: 8,
  maxHistoryEntries: 64,
  maxTransactionGas: 18_000_000n,
  maxTotalGasPerTick: 18_000_000n,
  maximumCompoundNativeWei: 250_000_000_000_000_000n,
  minGrowthToMaxGasRatioBps: 10_000,
  maxFeePerGasWei: 3_000_000_000n,
  maxTotalDebitWeiPerTick: 50_000_000_000_000_000n,
  maxTotalDebitWeiPerDay: 500_000_000_000_000_000n,
  signerBalanceFloorWei: 10_000_000_000_000_000n,
  signerLanes: [
    {
      id: "lane-0",
      partitionId: "partition-0",
      partitionIndex: 0,
      partitionCount: 1,
      signerAddress: address(6),
      privyWalletId: "a".repeat(24),
    },
  ],
} satisfies DeepV3KeeperV2Config;

function baseState() {
  return createDeepV3KeeperV2State(config, {
    importedCursor: 0,
    importedGeneration: 0,
    importedAtMs: 0,
  });
}

function reader(overrides: Record<string, unknown> = {}) {
  const vaults = Array.from({ length: 5 }, (_, index) =>
    address(20 + index),
  );
  return {
    getChainId: vi.fn().mockResolvedValue(1),
    getBlockNumber: vi.fn().mockResolvedValue(1_012n),
    getBlock: vi.fn().mockImplementation(async (blockNumber: bigint) => ({
      number: blockNumber,
      hash: commonHash,
      gasLimit: 40_000_000n,
    })),
    getRuntimeHash: vi.fn().mockImplementation(async (target: string) => {
      const index = [
        config.automationAddress,
        config.launcherAddress,
        config.vaultFactoryAddress,
        config.executorAddress,
      ].findIndex(
        (candidate) => candidate.toLowerCase() === target.toLowerCase(),
      );
      return [
        config.automationRuntimeHash,
        config.launcherRuntimeHash,
        config.vaultFactoryRuntimeHash,
        config.executorRuntimeHash,
      ][index];
    }),
    readExecutorAutomation: vi
      .fn()
      .mockResolvedValue(config.automationAddress),
    readAutomationLauncher: vi
      .fn()
      .mockResolvedValue(config.launcherAddress),
    readAutomationVaultFactory: vi
      .fn()
      .mockResolvedValue(config.vaultFactoryAddress),
    readLauncherAutomation: vi
      .fn()
      .mockResolvedValue(config.automationAddress),
    readLauncherVaultFactory: vi
      .fn()
      .mockResolvedValue(config.vaultFactoryAddress),
    readRegisteredVaultCount: vi
      .fn()
      .mockResolvedValue(BigInt(vaults.length)),
    scanAutomation: vi.fn().mockImplementation(
      async (
        _automation: string,
        cursor: bigint,
        limit: bigint,
      ) => {
        const ready = Array.from(
          { length: Math.min(Number(limit), vaults.length) },
          (_, offset) => ({
            vault:
              vaults[(Number(cursor) + offset) % vaults.length],
            action: DeepV3V2Action.GrowOracle,
          }),
        );
        return {
          ready,
          nextCursor:
            (cursor + BigInt(ready.length)) % BigInt(vaults.length),
        };
      },
    ),
    readVaultWorkState: vi.fn().mockResolvedValue({
      action: DeepV3V2Action.None,
      hookGrowthFees: 20_000_000_000_000_000n,
      pendingNative: 0n,
      nextEligibleTimestamp: 0n,
      rollingCapacity: 250_000_000_000_000_000n,
      blockedReason: "0x00000000",
    }),
    simulateExecute: vi
      .fn()
      .mockImplementation(async (_address, candidates) => ({
        attempted: BigInt(candidates.length),
        succeeded: BigInt(candidates.length),
      })),
    estimateExecuteGas: vi
      .fn()
      .mockImplementation(
        async (_address, candidates) =>
          1_500_000n * BigInt(candidates.length),
      ),
    estimateFees: vi.fn().mockResolvedValue({
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
    }),
    getBalance: vi
      .fn()
      .mockResolvedValue(1_000_000_000_000_000_000n),
    getConfirmedTransactionCount: vi.fn().mockResolvedValue(0n),
    getPendingTransactionCount: vi.fn().mockResolvedValue(0n),
    getReceipt: vi.fn().mockResolvedValue(null),
    getTransaction: vi.fn().mockResolvedValue(null),
    candidateResults: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

function harness(
  state = baseState(),
  readerOverrides: Record<string, unknown> = {},
) {
  let durable = structuredClone(state);
  const readers = [
    reader(readerOverrides),
    reader(readerOverrides),
  ];
  const persistState = vi.fn().mockImplementation(async (next) => {
    durable = structuredClone(next);
    return true;
  });
  const wallet = {
    supportsStableIdempotency: true,
    submitBatch: vi.fn().mockImplementation(async (request) => ({
      transactionHash,
      transactionId: "privy-transaction-1",
      nonce: request.expectedNonce,
      referenceId: request.referenceId,
    })),
  };
  return {
    readers,
    wallet,
    persistState,
    assertFence: vi.fn().mockResolvedValue(true),
    durable: () => durable,
  };
}

describe("Deep V3 keeper ops v2 cycle", () => {
  it("persists scan, exact intent and gas commitment before one batch submission", async () => {
    const test = harness();
    const result = await runDeepV3KeeperV2Cycle({
      config,
      state: baseState(),
      readers: test.readers,
      wallet: test.wallet,
      nowMs: 600_000,
      requestExpiryMs: 690_000,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });

    expect(result.outcome).toBe("submitted");
    expect(result.scanned).toBe(5);
    expect(test.wallet.submitBatch).toHaveBeenCalledTimes(1);
    expect(test.persistState).toHaveBeenCalledTimes(3);
    const intent = test.persistState.mock.calls[1][0];
    expect(intent.pendingBatches[0]).toMatchObject({
      status: "intent",
      transactionHash: null,
      candidates: expect.arrayContaining([
        expect.objectContaining({
          accruedGrowthWei: "20000000000000000",
          growthBudgetWei: "20000000000000000",
          rollingCapacityWei: "250000000000000000",
          economicBudgetKind: "oracle-prerequisite",
          singleMaxGasDebitWei: expect.any(String),
        }),
      ]),
      request: {
        requestHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        gas: expect.any(String),
        maxFeePerGas: "1000000000",
        maxPriorityFeePerGas: "100000000",
        maxGasDebitWei: expect.any(String),
        growthBudgetWei: expect.any(String),
        expectedNonce: "0",
        signerRequestLifetimeMs: "95000",
      },
    });
    expect(intent.gasBudgetDays[0]).toMatchObject({
      committedMaxDebitWei:
        intent.pendingBatches[0].request.maxGasDebitWei,
      submissionCount: 1,
    });
    expect(intent.tickBudgets[0]).toMatchObject({
      slot: 2,
      committedGas: intent.pendingBatches[0].request.gas,
      committedMaxDebitWei:
        intent.pendingBatches[0].request.maxGasDebitWei,
      submissionCount: 1,
    });
    expect(intent.lanes[0].lastSubmissionSlot).toBe(2);
    expect(test.durable().pendingBatches[0]).toMatchObject({
      status: "submitted",
      transactionHash,
      transactionId: "privy-transaction-1",
      nonce: "0",
    });
  });

  it("replays an exact persisted intent after a crash without rescanning", async () => {
    const first = harness();
    first.wallet.submitBatch.mockRejectedValueOnce(
      new Error("timeout after broadcast"),
    );
    await expect(
      runDeepV3KeeperV2Cycle({
        config,
        state: baseState(),
        readers: first.readers,
        wallet: first.wallet,
        nowMs: 600_000,
        requestExpiryMs: 690_000,
        persistState: first.persistState,
        assertFence: first.assertFence,
      }),
    ).rejects.toThrow(/timeout/);
    const intent = first.durable();
    expect(intent.pendingBatches[0].status).toBe("intent");

    const replay = harness(intent);
    const result = await runDeepV3KeeperV2Cycle({
      config,
      state: intent,
      readers: replay.readers,
      wallet: replay.wallet,
      nowMs: 900_000,
      requestExpiryMs: 990_000,
      persistState: replay.persistState,
      assertFence: replay.assertFence,
    });

    expect(result.outcome).toBe("idempotent-replay-submitted");
    expect(replay.wallet.submitBatch).toHaveBeenCalledTimes(1);
    expect(
      replay.readers.every(
        (current) => current.scanAutomation.mock.calls.length === 0,
      ),
    ).toBe(true);
    const firstAttempt = first.wallet.submitBatch.mock.calls[0][0];
    const replayAttempt =
      replay.wallet.submitBatch.mock.calls[0][0];
    expect(firstAttempt.requestExpiryMs).toBe(690_000);
    expect(replayAttempt.requestExpiryMs).toBe(990_000);
    expect(replayAttempt).toMatchObject({
      candidates: firstAttempt.candidates,
      gas: firstAttempt.gas,
      maxFeePerGas: firstAttempt.maxFeePerGas,
      maxPriorityFeePerGas: firstAttempt.maxPriorityFeePerGas,
      expectedNonce: firstAttempt.expectedNonce,
      idempotencyKey: firstAttempt.idempotencyKey,
      referenceId: firstAttempt.referenceId,
      abi: firstAttempt.abi,
    });
    expect(replay.durable().pendingBatches[0].status).toBe("submitted");
  });

  it("keeps an uncertain signer nonce isolated, advances fair scan and sends nothing new", async () => {
    const candidates = [
      { vault: address(20), action: DeepV3V2Action.GrowOracle },
    ];
    const requestHash = deepV3KeeperV2RequestHash({
      executorAddress: config.executorAddress,
      candidates,
      gas: 2_000_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
      expectedNonce: 0n,
      signerRequestLifetimeMs: 95_000,
    });
    const pending: DeepV3KeeperV2PendingBatch = {
      id: "batch-uncertain",
      laneId: "lane-0",
      partitionId: "partition-0",
      slot: 1,
      scanBlockNumber: 900,
      scanBlockHash: hash("9"),
      scanStartCursor: 0,
      scanEndCursor: 1,
      candidates: [
        {
          ...candidates[0],
          accruedGrowthWei: "20000000000000000",
          growthBudgetWei: "20000000000000000",
          rollingCapacityWei: "250000000000000000",
          economicBudgetKind: "oracle-prerequisite",
          singleMaxGasDebitWei: "2000000000000000",
        },
      ],
      idempotencyKey: deepV3KeeperV2IdempotencyKey({
        sourceCommitment: config.sourceCommitment,
        opsSourceCommitment: config.opsSourceCommitment,
        releaseVersion: config.releaseVersion,
        laneId: "lane-0",
        slot: 1,
        blockHash: hash("9"),
        scanStartCursor: 0,
        scanEndCursor: 1,
        candidates,
        requestHash,
      }),
      referenceId: "deep-v3-v2-uncertain",
      request: {
        requestHash,
        gas: "2000000",
        maxFeePerGas: "1000000000",
        maxPriorityFeePerGas: "100000000",
        maxGasDebitWei: "2000000000000000",
        growthBudgetWei: "20000000000000000",
        expectedNonce: "0",
        signerRequestLifetimeMs: "95000",
      },
      transactionHash,
      transactionId: "privy-transaction-1",
      nonce: "0",
      createdAtMs: 300_000,
      lastReplayAtMs: null,
      replayCount: 0,
      budgetDayStartMs: 0,
      status: "submitted",
    };
    const state = {
      ...baseState(),
      pendingBatches: [pending],
      lanes: [
        {
          ...baseState().lanes[0],
          pendingBatchIds: [pending.id],
        },
      ],
      gasBudgetDays: [
        {
          dayStartMs: 0,
          committedMaxDebitWei: pending.request.maxGasDebitWei,
          confirmedActualDebitWei: "0",
          submissionCount: 1,
        },
      ],
    };
    const test = harness(state);
    const result = await runDeepV3KeeperV2Cycle({
      config,
      state,
      readers: test.readers,
      wallet: test.wallet,
      nowMs: 300_001,
      requestExpiryMs: 390_001,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });

    expect(result.outcome).toBe("scanned-lane-blocked");
    expect(test.wallet.submitBatch).not.toHaveBeenCalled();
    expect(test.durable().partitions[0].lastScannedAtMs).toBe(300_001);
    expect(test.durable().pendingBatches).toHaveLength(1);
  });

  it("does not submit when growth ratio, debit budget or balance floor fails", async () => {
    const test = harness(baseState(), {
      readVaultWorkState: vi.fn().mockResolvedValue({
        action: DeepV3V2Action.None,
        hookGrowthFees: 3_000_000_000_000_000n,
        pendingNative: 0n,
        nextEligibleTimestamp: 0n,
        rollingCapacity: 250_000_000_000_000_000n,
        blockedReason: "0x00000000",
      }),
      getBalance: vi
        .fn()
        .mockResolvedValue(config.signerBalanceFloorWei),
    });
    const result = await runDeepV3KeeperV2Cycle({
      config,
      state: baseState(),
      readers: test.readers,
      wallet: test.wallet,
      nowMs: 600_000,
      requestExpiryMs: 690_000,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });

    expect(result.outcome).toBe("economic-policy-blocked");
    expect(test.wallet.submitBatch).not.toHaveBeenCalled();
    expect(test.durable().lanes[0]).toMatchObject({
      balanceAlert: true,
      blockedReason: "signer-balance-floor",
    });
  });

  it("confirms each candidate result independently and records actual gas debit", async () => {
    const initial = harness();
    await runDeepV3KeeperV2Cycle({
      config,
      state: baseState(),
      readers: initial.readers,
      wallet: initial.wallet,
      nowMs: 600_000,
      requestExpiryMs: 690_000,
      persistState: initial.persistState,
      assertFence: initial.assertFence,
    });
    const submitted = initial.durable();
    const pending = submitted.pendingBatches[0];
    const receipt = {
      transactionHash,
      status: "success",
      blockNumber: 990n,
      blockHash: commonHash,
      gasUsed: 4_000_000n,
      effectiveGasPrice: 500_000_000n,
      from: config.signerLanes[0].signerAddress,
      to: config.executorAddress,
      logs: [],
    };
    const transaction = {
      hash: transactionHash,
      from: config.signerLanes[0].signerAddress,
      to: config.executorAddress,
      value: 0n,
      input: deepV3KeeperV2ExecuteData(
        pending.candidates.map(({ vault, action }) => ({
          vault,
          action,
        })),
      ),
      nonce: 0n,
      gas: BigInt(pending.request.gas),
      maxFeePerGas: BigInt(pending.request.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(
        pending.request.maxPriorityFeePerGas,
      ),
      chainId: 1,
      type: "eip1559",
    };
    const candidateResults = pending.candidates.map(
      ({ vault, action }, index) => ({
        batchHash: deepV3KeeperV2ExecutorBatchHash({
          chainId: 1,
          executorAddress: config.executorAddress,
          signerAddress: config.signerLanes[0].signerAddress,
          candidates: pending.candidates.map(
            ({ vault: candidateVault, action: candidateAction }) => ({
              vault: candidateVault,
              action: candidateAction,
            }),
          ),
        }),
        candidateIndex: index,
        vault,
        executor: config.signerLanes[0].signerAddress,
        expectedAction: action,
        actualAction: action,
        outcome: index === 0 ? 4 : 3,
      }),
    );
    const confirmed = harness(submitted, {
      getReceipt: vi.fn().mockResolvedValue(receipt),
      getTransaction: vi.fn().mockResolvedValue(transaction),
      candidateResults: vi.fn().mockReturnValue(candidateResults),
      getConfirmedTransactionCount: vi.fn().mockResolvedValue(1n),
      getPendingTransactionCount: vi.fn().mockResolvedValue(1n),
      scanAutomation: vi.fn().mockResolvedValue({
        ready: [],
        nextCursor: 0n,
      }),
    });
    const result = await runDeepV3KeeperV2Cycle({
      config,
      state: submitted,
      readers: confirmed.readers,
      wallet: confirmed.wallet,
      nowMs: 900_000,
      requestExpiryMs: 990_000,
      persistState: confirmed.persistState,
      assertFence: confirmed.assertFence,
    });

    expect(result.confirmedBatchIds).toEqual([pending.id]);
    expect(confirmed.durable().pendingBatches).toEqual([]);
    const history = confirmed.durable().history.at(-1);
    if (!history) {
      throw new Error("Expected a confirmed keeper history entry");
    }
    expect(history).toMatchObject({
      batchId: pending.id,
      actualGasDebitWei: "2000000000000000",
    });
    expect(history.candidates[0]).toMatchObject({ outcome: 4 });
    expect(history.candidates.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: 3 }),
      ]),
    );
  });

  it("caps executable growth evidence at the reviewed 0.25 ETH cycle maximum", async () => {
    const oneEther = 1_000_000_000_000_000_000n;
    const test = harness(baseState(), {
      readVaultWorkState: vi.fn().mockResolvedValue({
        action: DeepV3V2Action.None,
        hookGrowthFees: oneEther,
        pendingNative: 0n,
        nextEligibleTimestamp: 0n,
        rollingCapacity: oneEther,
        blockedReason: "0x00000000",
      }),
    });

    await runDeepV3KeeperV2Cycle({
      config,
      state: baseState(),
      readers: test.readers,
      wallet: test.wallet,
      nowMs: 600_000,
      requestExpiryMs: 690_000,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });

    const candidate = test.durable().pendingBatches[0].candidates[0];
    expect(candidate).toMatchObject({
      accruedGrowthWei: oneEther.toString(),
      growthBudgetWei:
        config.maximumCompoundNativeWei.toString(),
      rollingCapacityWei: oneEther.toString(),
      economicBudgetKind: "oracle-prerequisite",
    });
  });

  it("never submits a second batch in the same five-minute slot", async () => {
    const first = harness();
    await runDeepV3KeeperV2Cycle({
      config,
      state: baseState(),
      readers: first.readers,
      wallet: first.wallet,
      nowMs: 600_000,
      requestExpiryMs: 690_000,
      persistState: first.persistState,
      assertFence: first.assertFence,
    });
    const alreadyUsed = first.durable();
    alreadyUsed.pendingBatches = [];
    alreadyUsed.lanes[0].pendingBatchIds = [];

    const duplicate = harness(alreadyUsed);
    const result = await runDeepV3KeeperV2Cycle({
      config,
      state: alreadyUsed,
      readers: duplicate.readers,
      wallet: duplicate.wallet,
      nowMs: 600_001,
      requestExpiryMs: 690_001,
      persistState: duplicate.persistState,
      assertFence: duplicate.assertFence,
    });

    expect(result.outcome).toBe("tick-submission-cap");
    expect(duplicate.wallet.submitBatch).not.toHaveBeenCalled();
    expect(
      duplicate.readers.every(
        (current) => current.scanAutomation.mock.calls.length === 0,
      ),
    ).toBe(true);
  });

  it("persists an exact intent before send and sends nothing if that CAS write loses its fence", async () => {
    const test = harness();
    test.persistState
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      runDeepV3KeeperV2Cycle({
        config,
        state: baseState(),
        readers: test.readers,
        wallet: test.wallet,
        nowMs: 600_000,
        requestExpiryMs: 690_000,
        persistState: test.persistState,
        assertFence: test.assertFence,
      }),
    ).rejects.toMatchObject({ code: "LEASE_FENCE_LOST" });
    expect(test.wallet.submitBatch).not.toHaveBeenCalled();
  });

  it("checks the fence again immediately before sending the persisted intent", async () => {
    const test = harness();
    test.assertFence
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      runDeepV3KeeperV2Cycle({
        config,
        state: baseState(),
        readers: test.readers,
        wallet: test.wallet,
        nowMs: 600_000,
        requestExpiryMs: 690_000,
        persistState: test.persistState,
        assertFence: test.assertFence,
      }),
    ).rejects.toMatchObject({ code: "LEASE_FENCE_LOST" });
    expect(test.wallet.submitBatch).not.toHaveBeenCalled();
    expect(test.durable().pendingBatches[0].status).toBe("intent");
  });

  it("preserves the original hash and enters operator state when idempotent replay returns another hash", async () => {
    const first = harness();
    await runDeepV3KeeperV2Cycle({
      config,
      state: baseState(),
      readers: first.readers,
      wallet: first.wallet,
      nowMs: 600_000,
      requestExpiryMs: 690_000,
      persistState: first.persistState,
      assertFence: first.assertFence,
    });
    const submitted = first.durable();
    const mismatch = harness(submitted);
    mismatch.wallet.submitBatch.mockResolvedValue({
      transactionHash: hash("c"),
      transactionId: "privy-transaction-2",
      nonce: 0n,
      referenceId: submitted.pendingBatches[0].referenceId,
    });

    const result = await runDeepV3KeeperV2Cycle({
      config,
      state: submitted,
      readers: mismatch.readers,
      wallet: mismatch.wallet,
      nowMs: 2_500_000,
      requestExpiryMs: 2_590_000,
      persistState: mismatch.persistState,
      assertFence: mismatch.assertFence,
    });

    expect(result.outcome).toBe("operator-action-required");
    expect(result.transactionHash).toBe(transactionHash);
    expect(mismatch.durable().pendingBatches[0]).toMatchObject({
      status: "operator",
      transactionHash,
    });
    expect(mismatch.durable().operatorIncidents[0].reason).toBe(
      "idempotency-hash-mismatch",
    );
  });

  it("turns a canonical successful receipt with malformed candidate evidence into a durable incident", async () => {
    const first = harness();
    await runDeepV3KeeperV2Cycle({
      config,
      state: baseState(),
      readers: first.readers,
      wallet: first.wallet,
      nowMs: 600_000,
      requestExpiryMs: 690_000,
      persistState: first.persistState,
      assertFence: first.assertFence,
    });
    const submitted = first.durable();
    const pending = submitted.pendingBatches[0];
    const confirmed = harness(submitted, {
      getReceipt: vi.fn().mockResolvedValue({
        transactionHash,
        status: "success",
        blockNumber: 990n,
        blockHash: commonHash,
        gasUsed: 1_000_000n,
        effectiveGasPrice: 500_000_000n,
        from: config.signerLanes[0].signerAddress,
        to: config.executorAddress,
        logs: [],
      }),
      getTransaction: vi.fn().mockResolvedValue({
        hash: transactionHash,
        from: config.signerLanes[0].signerAddress,
        to: config.executorAddress,
        value: 0n,
        input: deepV3KeeperV2ExecuteData(
          pending.candidates.map(({ vault, action }) => ({
            vault,
            action,
          })),
        ),
        nonce: 0n,
        gas: BigInt(pending.request.gas),
        maxFeePerGas: BigInt(pending.request.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(
          pending.request.maxPriorityFeePerGas,
        ),
        chainId: 1,
        type: "eip1559",
      }),
      candidateResults: vi.fn().mockReturnValue([]),
    });

    const result = await runDeepV3KeeperV2Cycle({
      config,
      state: submitted,
      readers: confirmed.readers,
      wallet: confirmed.wallet,
      nowMs: 900_000,
      requestExpiryMs: 990_000,
      persistState: confirmed.persistState,
      assertFence: confirmed.assertFence,
    });

    expect(result.outcome).toBe("operator-action-required");
    expect(confirmed.durable().pendingBatches[0].status).toBe(
      "operator",
    );
    expect(confirmed.durable().operatorIncidents[0].reason).toBe(
      "confirmed-candidate-results-mismatch",
    );
    expect(confirmed.durable().history).toEqual([]);
  });

  it("escalates an observed transaction that differs from the persisted envelope", async () => {
    const first = harness();
    await runDeepV3KeeperV2Cycle({
      config,
      state: baseState(),
      readers: first.readers,
      wallet: first.wallet,
      nowMs: 600_000,
      requestExpiryMs: 690_000,
      persistState: first.persistState,
      assertFence: first.assertFence,
    });
    const submitted = first.durable();
    const pending = submitted.pendingBatches[0];
    const wrongEnvelope = harness(submitted, {
      getTransaction: vi.fn().mockResolvedValue({
        hash: transactionHash,
        from: config.signerLanes[0].signerAddress,
        to: config.executorAddress,
        value: 0n,
        input: deepV3KeeperV2ExecuteData(
          pending.candidates.map(({ vault, action }) => ({
            vault,
            action,
          })),
        ),
        nonce: 0n,
        gas: BigInt(pending.request.gas) + 1n,
        maxFeePerGas: BigInt(pending.request.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(
          pending.request.maxPriorityFeePerGas,
        ),
        chainId: 1,
        type: "eip1559",
      }),
    });

    const result = await runDeepV3KeeperV2Cycle({
      config,
      state: submitted,
      readers: wrongEnvelope.readers,
      wallet: wrongEnvelope.wallet,
      nowMs: 600_001,
      requestExpiryMs: 690_001,
      persistState: wrongEnvelope.persistState,
      assertFence: wrongEnvelope.assertFence,
    });

    expect(result.outcome).toBe("operator-action-required");
    expect(wrongEnvelope.durable().operatorIncidents[0].reason).toBe(
      "observed-transaction-envelope-mismatch",
    );
  });

  it("escalates unresolved receipt divergence after the idempotency window", async () => {
    const first = harness();
    await runDeepV3KeeperV2Cycle({
      config,
      state: baseState(),
      readers: first.readers,
      wallet: first.wallet,
      nowMs: 600_000,
      requestExpiryMs: 690_000,
      persistState: first.persistState,
      assertFence: first.assertFence,
    });
    const submitted = first.durable();
    const divergent = harness(submitted);
    divergent.readers[0].getReceipt.mockResolvedValue({
      transactionHash,
      status: "success",
      blockNumber: 990n,
      blockHash: commonHash,
      gasUsed: 1_000_000n,
      effectiveGasPrice: 500_000_000n,
      from: config.signerLanes[0].signerAddress,
      to: config.executorAddress,
      logs: [],
    });
    divergent.readers[1].getReceipt.mockResolvedValue(null);

    const result = await runDeepV3KeeperV2Cycle({
      config,
      state: submitted,
      readers: divergent.readers,
      wallet: divergent.wallet,
      nowMs: 84_000_000,
      requestExpiryMs: 84_090_000,
      persistState: divergent.persistState,
      assertFence: divergent.assertFence,
    });

    expect(result.outcome).toBe("operator-action-required");
    expect(divergent.durable().operatorIncidents[0].reason).toBe(
      "receipt-unresolved-after-idempotency-window",
    );
  });

  it("fails closed when canonical RPC block hashes disagree", async () => {
    const firstReader = reader();
    const secondReader = reader({
      getBlock: vi
        .fn()
        .mockImplementation(async (blockNumber: bigint) => ({
          number: blockNumber,
          hash: hash("d"),
          gasLimit: 40_000_000n,
        })),
    });

    await expect(
      runDeepV3KeeperV2Cycle({
        config,
        state: baseState(),
        readers: [firstReader, secondReader],
        wallet: harness().wallet,
        nowMs: 600_000,
        requestExpiryMs: 690_000,
        persistState: vi.fn().mockResolvedValue(true),
        assertFence: vi.fn().mockResolvedValue(true),
      }),
    ).rejects.toMatchObject({
      code: "CANONICAL_BLOCK_DISAGREEMENT",
    });
  });
});
