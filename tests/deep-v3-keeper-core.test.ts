import { describe, expect, it, vi } from "vitest";

import {
  DEEP_V3_KEEPER_ABSENT_TRANSACTION_GRACE_MS,
  DEEP_V3_KEEPER_SAFE_PRIVY_REPLAY_MS,
} from "../ops/deep-keeper-v3/config.mjs";
import {
  DeepV3Action,
  deepV3ExecuteData,
  runDeepV3KeeperCycle,
} from "../ops/deep-keeper-v3/core.mjs";
import { createDeepV3KeeperState } from "../ops/deep-keeper-v3/control.mjs";

const address = (suffix: string) =>
  `0x${suffix.padStart(40, "0")}` as `0x${string}`;
const hash = (byte: string) =>
  `0x${byte.repeat(64)}` as `0x${string}`;

const config = {
  enabled: true,
  chainId: 1,
  releaseManifest:
    "contracts/deployments/mainnet-deep-full-range-v3.json",
  automationAddress: address("1"),
  automationRuntimeHash: hash("1"),
  launcherAddress: address("2"),
  launcherRuntimeHash: hash("2"),
  vaultFactoryAddress: address("3"),
  vaultFactoryRuntimeHash: hash("3"),
  executorAddress: address("4"),
  executorRuntimeHash: hash("4"),
  sourceCommitment: hash("5"),
  rpcUrls: ["https://a.example", "https://b.example"],
  signerAddress: address("5"),
  privyWalletId: "a".repeat(24),
  intervalMs: 300_000,
  scanLimit: 1,
  maxBatchSize: 1,
  confirmations: 12,
  maxGas: 4_500_000n,
  maxFeePerGasWei: 100_000_000_000n,
} as const;

const commonHash = hash("a");
const receiptHash = hash("b");
const transactionHash = hash("c");
const vault = address("9");

function reader(
  overrides: Record<string, unknown> = {},
) {
  return {
    getChainId: vi.fn().mockResolvedValue(1),
    getBlockNumber: vi.fn().mockResolvedValue(1_000n),
    getBlock: vi.fn().mockImplementation(async (blockNumber: bigint) => ({
      number: blockNumber,
      hash: blockNumber === 980n ? receiptHash : commonHash,
    })),
    getRuntimeHash: vi
      .fn()
      .mockImplementation(async (runtimeAddress: string) => {
        const found = [
          [config.automationAddress, config.automationRuntimeHash],
          [config.launcherAddress, config.launcherRuntimeHash],
          [config.vaultFactoryAddress, config.vaultFactoryRuntimeHash],
          [config.executorAddress, config.executorRuntimeHash],
        ].find(
          ([candidate]) =>
            candidate.toLowerCase() === runtimeAddress.toLowerCase(),
        );
        return found?.[1];
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
    readRegisteredVaultCount: vi.fn().mockResolvedValue(1n),
    readRegisteredVaultAt: vi.fn().mockResolvedValue(vault),
    assessVault: vi.fn().mockResolvedValue(DeepV3Action.None),
    getBalance: vi.fn().mockResolvedValue(10_000_000_000_000_000n),
    simulateExecute: vi
      .fn()
      .mockResolvedValue({ attempted: 1n, succeeded: 1n }),
    estimateExecuteGas: vi.fn().mockResolvedValue(3_000_000n),
    estimateFees: vi.fn().mockResolvedValue({
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    }),
    getReceipt: vi.fn().mockResolvedValue(null),
    getTransaction: vi
      .fn()
      .mockImplementation(async (requestedHash: string) => ({
        hash: requestedHash,
        from: config.signerAddress,
        to: config.executorAddress,
        value: 0n,
        input: deepV3ExecuteData(vault, DeepV3Action.Compound),
      })),
    productiveAction: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function state() {
  return {
    ...createDeepV3KeeperState(config),
    fencingGeneration: 1,
  };
}

function harness(
  readers = [reader(), reader()],
  initialState = state(),
) {
  let durable = initialState;
  const persistState = vi.fn(async (next) => {
    durable = next;
    return true;
  });
  return {
    readers,
    initialState,
    persistState,
    assertFence: vi.fn().mockResolvedValue(true),
    wallet: {
      supportsStableIdempotency: true,
      writeContract: vi.fn().mockResolvedValue(transactionHash),
    },
    durable: () => durable,
  };
}

describe("Deep V3 fail-closed keeper core", () => {
  it("completes an idle slot only after both RPCs return None at one common block", async () => {
    const test = harness();
    const result = await runDeepV3KeeperCycle({
      config,
      state: test.initialState,
      readers: test.readers,
      wallet: test.wallet,
      nowMs: 600_000,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });

    expect(result.outcome).toBe("common-block-none");
    expect(result.commonBlock).toEqual({
      number: 988n,
      hash: commonHash,
    });
    expect(test.durable()).toMatchObject({
      cursor: 1,
      lastCompletedSlot: 2,
      lastCompletedBlockNumber: 988,
      pending: null,
    });
    expect(test.wallet.writeContract).not.toHaveBeenCalled();
  });

  it.each([DeepV3Action.Compound, DeepV3Action.GrowOracle])(
    "submits only the fixed executor call for productive action %s",
    async (action) => {
      const test = harness([
        reader({ assessVault: vi.fn().mockResolvedValue(action) }),
        reader({ assessVault: vi.fn().mockResolvedValue(action) }),
      ]);
      const result = await runDeepV3KeeperCycle({
        config,
        state: test.initialState,
        readers: test.readers,
        wallet: test.wallet,
        nowMs: 600_000,
        persistState: test.persistState,
        assertFence: test.assertFence,
      });

      expect(result.outcome).toBe("submitted");
      expect(test.wallet.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: config.executorAddress,
          functionName: "execute",
          args: [[{ vault, expectedAction: action }]],
          account: config.signerAddress,
        }),
      );
      const request = test.wallet.writeContract.mock.calls[0][0];
      expect(request).not.toHaveProperty("value");
      expect(request.idempotencyKey).toMatch(/^deep-[0-9a-f]{32}$/);
      expect(test.durable().pending).toMatchObject({
        vault,
        action,
        transactionHash,
        gas: "3000000",
        maxFeePerGas: "2000000000",
        maxPriorityFeePerGas: "1000000000",
      });
      expect(test.persistState).toHaveBeenCalledTimes(3);
      expect(
        test.persistState.mock.calls[1][0].pending,
      ).toMatchObject({
        transactionHash: null,
        gas: "3000000",
        maxFeePerGas: "2000000000",
        maxPriorityFeePerGas: "1000000000",
      });
      expect(test.durable().lastCompletedSlot).toBeNull();
    },
  );

  it("accepts a gifted signer balance without widening calldata or value", async () => {
    const giftedBalance = 10n ** 30n;
    const test = harness([
      reader({
        assessVault: vi
          .fn()
          .mockResolvedValue(DeepV3Action.Compound),
        getBalance: vi.fn().mockResolvedValue(giftedBalance),
      }),
      reader({
        assessVault: vi
          .fn()
          .mockResolvedValue(DeepV3Action.Compound),
        getBalance: vi.fn().mockResolvedValue(giftedBalance),
      }),
    ]);

    const result = await runDeepV3KeeperCycle({
      config,
      state: test.initialState,
      readers: test.readers,
      wallet: test.wallet,
      nowMs: 600_000,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });

    expect(result.outcome).toBe("submitted");
    const request = test.wallet.writeContract.mock.calls[0][0];
    expect(request.address).toBe(config.executorAddress);
    expect(request.functionName).toBe("execute");
    expect(request.args).toEqual([
      [{ vault, expectedAction: DeepV3Action.Compound }],
    ]);
    expect(request).not.toHaveProperty("value");
  });

  it("confirms productive receipts and keeps later slots eligible indefinitely", async () => {
    const pendingState = {
      ...state(),
      pending: {
        vault,
        action: DeepV3Action.Compound,
        slot: 2,
        cursor: 0,
        idempotencyKey: `deep-${"1".repeat(32)}`,
        transactionHash,
        createdAtMs: 600_000,
        lastReplayAtMs: null,
        replayCount: 0,
        gas: "3000000",
        maxFeePerGas: "2000000000",
        maxPriorityFeePerGas: "1000000000",
      },
    };
    const receipt = {
      transactionHash,
      status: "success",
      blockNumber: 980n,
      blockHash: receiptHash,
      gasUsed: 1_000_000n,
      effectiveGasPrice: 2_000_000_000n,
      from: config.signerAddress,
      to: config.executorAddress,
      logs: [],
    };
    const test = harness(
      [
        reader({
          assessVault: vi
            .fn()
            .mockResolvedValue(DeepV3Action.Compound),
          getReceipt: vi.fn().mockResolvedValue(receipt),
          productiveAction: vi
            .fn()
            .mockReturnValue(DeepV3Action.Compound),
        }),
        reader({
          assessVault: vi
            .fn()
            .mockResolvedValue(DeepV3Action.Compound),
          getReceipt: vi.fn().mockResolvedValue(receipt),
          productiveAction: vi
            .fn()
            .mockReturnValue(DeepV3Action.Compound),
        }),
      ],
      pendingState,
    );

    const result = await runDeepV3KeeperCycle({
      config,
      state: test.initialState,
      readers: test.readers,
      wallet: test.wallet,
      nowMs: 600_001,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });

    expect(result.outcome).toBe("confirmed-productive");
    expect(test.durable()).toMatchObject({
      cursor: 1,
      lastCompletedSlot: 2,
      lastCompletedBlockNumber: 980,
      pending: null,
    });

    const nextTransactionHash = hash("d");
    test.wallet.writeContract.mockResolvedValueOnce(
      nextTransactionHash,
    );
    const submittedAgain = await runDeepV3KeeperCycle({
      config,
      state: test.durable(),
      readers: test.readers,
      wallet: test.wallet,
      nowMs: 900_000,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });
    expect(submittedAgain.outcome).toBe("submitted");
    expect(test.wallet.writeContract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        gas: 3_000_000n,
        maxFeePerGas: 2_000_000_000n,
      }),
    );

    const nextReceipt = {
      ...receipt,
      transactionHash: nextTransactionHash,
    };
    for (const currentReader of test.readers) {
      currentReader.getReceipt.mockResolvedValue(nextReceipt);
    }
    const confirmedAgain = await runDeepV3KeeperCycle({
      config,
      state: test.durable(),
      readers: test.readers,
      wallet: test.wallet,
      nowMs: 900_001,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });
    expect(confirmedAgain.outcome).toBe("confirmed-productive");
    expect(test.durable()).toMatchObject({
      lastCompletedSlot: 3,
      pending: null,
    });
  });

  it.each([
    ["pending receipt", null, "pending", true],
    [
      "reverted receipt",
      {
        transactionHash,
        status: "reverted",
        blockNumber: 980n,
        blockHash: receiptHash,
        gasUsed: 1n,
        effectiveGasPrice: 1n,
        from: config.signerAddress,
        to: config.executorAddress,
        logs: [],
      },
      "retryable-revert",
      false,
    ],
    [
      "unproductive receipt",
      {
        transactionHash,
        status: "success",
        blockNumber: 980n,
        blockHash: receiptHash,
        gasUsed: 1n,
        effectiveGasPrice: 1n,
        from: config.signerAddress,
        to: config.executorAddress,
        logs: [],
      },
      "retryable-unproductive",
      false,
    ],
  ])(
    "keeps %s retryable without completing the slot",
    async (_label, receipt, outcome, retainsPending) => {
      const pendingState = {
        ...state(),
        pending: {
          vault,
          action: DeepV3Action.Compound,
          slot: 2,
          cursor: 0,
          idempotencyKey: `deep-${"1".repeat(32)}`,
          transactionHash,
          createdAtMs: 600_000,
          lastReplayAtMs: null,
          replayCount: 0,
          gas: "3000000",
          maxFeePerGas: "2000000000",
          maxPriorityFeePerGas: "1000000000",
        },
      };
      const test = harness(
        [
          reader({ getReceipt: vi.fn().mockResolvedValue(receipt) }),
          reader({ getReceipt: vi.fn().mockResolvedValue(receipt) }),
        ],
        pendingState,
      );
      const result = await runDeepV3KeeperCycle({
        config,
        state: test.initialState,
        readers: test.readers,
        wallet: test.wallet,
        nowMs: 600_001,
        persistState: test.persistState,
        assertFence: test.assertFence,
      });

      expect(result.outcome).toBe(outcome);
      expect(test.durable().lastCompletedSlot).toBeNull();
      expect(Boolean(test.durable().pending)).toBe(retainsPending);
    },
  );

  it("fails closed on direct assessVault disagreement", async () => {
    const test = harness([
      reader({
        assessVault: vi.fn().mockResolvedValue(DeepV3Action.Compound),
      }),
      reader({
        assessVault: vi.fn().mockResolvedValue(DeepV3Action.None),
      }),
    ]);
    await expect(
      runDeepV3KeeperCycle({
        config,
        state: test.initialState,
        readers: test.readers,
        wallet: test.wallet,
        nowMs: 600_000,
        persistState: test.persistState,
        assertFence: test.assertFence,
      }),
    ).rejects.toMatchObject({ code: "ASSESSMENT_DISAGREEMENT" });
    expect(test.persistState).not.toHaveBeenCalled();
    expect(test.wallet.writeContract).not.toHaveBeenCalled();
  });

  it.each(["receipt-disagreement", "reorg"])(
    "leaves a %s pending and retryable",
    async (scenario) => {
      const pendingState = {
        ...state(),
        pending: {
          vault,
          action: DeepV3Action.Compound,
          slot: 2,
          cursor: 0,
          idempotencyKey: `deep-${"1".repeat(32)}`,
          transactionHash,
          createdAtMs: 600_000,
          lastReplayAtMs: null,
          replayCount: 0,
          gas: "3000000",
          maxFeePerGas: "2000000000",
          maxPriorityFeePerGas: "1000000000",
        },
      };
      const receipt = {
        transactionHash,
        status: "success",
        blockNumber: 980n,
        blockHash: receiptHash,
        gasUsed: 1n,
        effectiveGasPrice: 1n,
        from: config.signerAddress,
        to: config.executorAddress,
        logs: [],
      };
      const first =
        scenario === "reorg"
          ? reader({
              getReceipt: vi.fn().mockResolvedValue(receipt),
              getBlock: vi
                .fn()
                .mockImplementation(async (blockNumber: bigint) => ({
                  number: blockNumber,
                  hash:
                    blockNumber === 980n ? hash("e") : commonHash,
                })),
            })
          : reader({
              getReceipt: vi.fn().mockResolvedValue(receipt),
            });
      const second = reader({
        getReceipt: vi.fn().mockResolvedValue(
          scenario === "receipt-disagreement"
            ? { ...receipt, gasUsed: 2n }
            : receipt,
        ),
      });
      const test = harness([first, second], pendingState);

      const result = await runDeepV3KeeperCycle({
        config,
        state: test.initialState,
        readers: test.readers,
        wallet: test.wallet,
        nowMs: 600_001,
        persistState: test.persistState,
        assertFence: test.assertFence,
      });

      expect(result.outcome).toBe("pending");
      expect(test.durable().pending).not.toBeNull();
      expect(test.durable().lastCompletedSlot).toBeNull();
      expect(test.wallet.writeContract).not.toHaveBeenCalled();
    },
  );

  it("replays a dropped hash only inside Privy's safe window, then enters durable operator recovery", async () => {
    const createdAtMs = 600_000;
    const pendingState = {
      ...state(),
      pending: {
        vault,
        action: DeepV3Action.Compound,
        slot: 2,
        cursor: 0,
        idempotencyKey: `deep-${"1".repeat(32)}`,
        transactionHash,
        createdAtMs,
        lastReplayAtMs: null,
        replayCount: 0,
        gas: "3000000",
        maxFeePerGas: "2000000000",
        maxPriorityFeePerGas: "1000000000",
      },
    };
    const absentReader = () =>
      reader({
        assessVault: vi
          .fn()
          .mockResolvedValue(DeepV3Action.Compound),
        getReceipt: vi.fn().mockResolvedValue(null),
        getTransaction: vi.fn().mockResolvedValue(null),
      });
    const test = harness(
      [absentReader(), absentReader()],
      pendingState,
    );

    const replayAt =
      createdAtMs +
      DEEP_V3_KEEPER_ABSENT_TRANSACTION_GRACE_MS;
    const replayed = await runDeepV3KeeperCycle({
      config,
      state: test.initialState,
      readers: test.readers,
      wallet: test.wallet,
      nowMs: replayAt,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });
    expect(replayed.outcome).toBe("idempotent-replay-pending");
    expect(test.wallet.writeContract).toHaveBeenCalledTimes(1);
    expect(test.wallet.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: pendingState.pending.idempotencyKey,
        gas: 3_000_000n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        args: [[{
          vault,
          expectedAction: DeepV3Action.Compound,
        }]],
      }),
    );
    expect(
      test.readers.every(
        (currentReader) =>
          currentReader.estimateFees.mock.calls.length === 0,
      ),
    ).toBe(true);
    expect(test.durable().pending).toMatchObject({
      transactionHash,
      lastReplayAtMs: replayAt,
      replayCount: 1,
    });

    const expiredAt =
      createdAtMs +
      DEEP_V3_KEEPER_SAFE_PRIVY_REPLAY_MS +
      2 * 60 * 60 * 1_000;
    const blocked = await runDeepV3KeeperCycle({
      config,
      state: test.durable(),
      readers: test.readers,
      wallet: test.wallet,
      nowMs: expiredAt,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });
    expect(blocked.outcome).toBe("operator-action-required");
    expect(test.durable().operatorActionRequired).toEqual({
      reason:
        "transaction-absent-after-privy-idempotency-window",
      transactionHash,
      vault,
      action: DeepV3Action.Compound,
      enteredAtMs: expiredAt,
    });
    expect(test.durable().lastCompletedSlot).toBeNull();
    expect(test.wallet.writeContract).toHaveBeenCalledTimes(1);

    const stillBlocked = await runDeepV3KeeperCycle({
      config,
      state: test.durable(),
      readers: test.readers,
      wallet: test.wallet,
      nowMs: expiredAt + 300_000,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });
    expect(stillBlocked.outcome).toBe("operator-action-required");
    expect(test.wallet.writeContract).toHaveBeenCalledTimes(1);
  });

  it("does not silently poll a still-pending transaction beyond the replay window", async () => {
    const createdAtMs = 600_000;
    const pendingState = {
      ...state(),
      pending: {
        vault,
        action: DeepV3Action.Compound,
        slot: 2,
        cursor: 0,
        idempotencyKey: `deep-${"4".repeat(32)}`,
        transactionHash,
        createdAtMs,
        lastReplayAtMs: null,
        replayCount: 0,
        gas: "3000000",
        maxFeePerGas: "2000000000",
        maxPriorityFeePerGas: "1000000000",
      },
    };
    const test = harness([reader(), reader()], pendingState);

    const result = await runDeepV3KeeperCycle({
      config,
      state: test.initialState,
      readers: test.readers,
      wallet: test.wallet,
      nowMs:
        createdAtMs + DEEP_V3_KEEPER_SAFE_PRIVY_REPLAY_MS,
      persistState: test.persistState,
      assertFence: test.assertFence,
    });

    expect(result.outcome).toBe("operator-action-required");
    expect(test.durable().operatorActionRequired).toMatchObject({
      reason:
        "unresolved-transaction-after-privy-idempotency-window",
      transactionHash,
    });
    expect(test.wallet.writeContract).not.toHaveBeenCalled();
  });

});
