import { describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { readFileSync } from "node:fs";

// The keeper is an executable Node service with a dependency-injected core.
import * as deepKeeper from "../ops/deep-keeper/core.mjs";
import { evaluateDeepKeeperReleaseGate } from "../ops/deep-keeper/release-gate.mjs";

const {
  allocateWeiByWeight,
  createInitialState,
  createMetrics,
  migrateKeeperState,
  parseKeeperConfig,
  renderPrometheusMetrics,
  runKeeperCycle,
} = deepKeeper;

const coordinator = "0x1111111111111111111111111111111111111111";
const signer = "0x2222222222222222222222222222222222222222";
const firstVault = "0x3333333333333333333333333333333333333333";
const secondVault = "0x4444444444444444444444444444444444444444";
const code = "0x60006000";
const runtimeHash = keccak256(code);
const disabledRelease = JSON.parse(
  readFileSync(
    new URL(
      "../contracts/deployments/mainnet-deep-full-range-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function hashFor(blockNumber: bigint, salt = "") {
  const value = `${blockNumber.toString(16).padStart(62, "0")}${salt.padStart(2, "0")}`;
  return `0x${value.slice(-64)}`;
}

function environment(overrides: Record<string, string> = {}) {
  return {
    DEEP_KEEPER_ENABLED: "false",
    DEEP_KEEPER_SEND_TRANSACTIONS: "false",
    DEEP_KEEPER_CHAIN_ID: "1",
    DEEP_KEEPER_COORDINATOR_ADDRESS: coordinator,
    DEEP_KEEPER_COORDINATOR_RUNTIME_HASH: runtimeHash,
    DEEP_KEEPER_RPC_URLS:
      "https://reader-one.example,https://reader-two.example",
    ...overrides,
  };
}

type Work = { vault: string; action: number };

function receiptMissing() {
  const error = new Error("Transaction receipt could not be found");
  error.name = "TransactionReceiptNotFoundError";
  throw error;
}

function reader({
  ready = [] as Work[],
  nextCursor = 0,
  registryCount = BigInt(ready.length),
  head = 100n,
  blockSalt = "",
  simulation,
  receipt,
  balance = 100_000_000_000_000_000n,
  gasEstimate = 1_000_000n,
  maxFeePerGas = 10_000_000_000n,
  onScan,
}: {
  ready?: Work[];
  nextCursor?: number;
  registryCount?: bigint;
  head?: bigint;
  blockSalt?: string;
  simulation?: [bigint, bigint];
  receipt?: object | null;
  balance?: bigint;
  gasEstimate?: bigint | ((candidates: string[]) => bigint);
  maxFeePerGas?: bigint;
  onScan?: (cursor: bigint) => void;
} = {}) {
  return {
    getChainId: vi.fn(async () => 1),
    getBlockNumber: vi.fn(async () => head),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: hashFor(blockNumber, blockSalt),
    })),
    getCode: vi.fn(async () => code),
    readContract: vi.fn(
      async ({
        functionName,
        args,
      }: {
        functionName: string;
        args?: bigint[];
      }) => {
        if (functionName === "registeredVaultCount") return registryCount;
        if (functionName === "scan") {
          onScan?.(args?.[0] ?? 0n);
          return [ready, BigInt(nextCursor)];
        }
        throw new Error(`Unexpected read ${functionName}`);
      },
    ),
    simulateContract: vi.fn(async ({ args }: { args: [string[]] }) => ({
      result:
        simulation ??
        [BigInt(args[0].length), BigInt(args[0].length)],
    })),
    estimateContractGas: vi.fn(
      async ({ args }: { args: [string[]] }) =>
        typeof gasEstimate === "function"
          ? gasEstimate(args[0])
          : gasEstimate,
    ),
    estimateFeesPerGas: vi.fn(async () => ({
      maxFeePerGas,
      maxPriorityFeePerGas: 1_000_000_000n,
    })),
    getBalance: vi.fn(async () => balance),
    getTransactionReceipt: vi.fn(async () => {
      if (receipt === undefined || receipt === null) return receiptMissing();
      return receipt;
    }),
  };
}

describe("Deep keeper configuration", () => {
  it("is transaction-disabled by default", () => {
    const config = parseKeeperConfig(environment());

    expect(config.enabled).toBe(false);
    expect(config.intervalMs).toBe(300_000);
    expect(config.maxBatchSize).toBe(4);
    expect(config.maxGas).toBe(3_000_000n);
    expect(config.vaultSubsidyCapWei).toBe(30_000_000_000_000_000n);
    expect(config.signerAddress).toBeNull();
  });

  it("changes the per-vault subsidy cap only through explicit configuration", () => {
    const lower = parseKeeperConfig(
      environment({
        DEEP_KEEPER_VAULT_SUBSIDY_CAP_WEI: "10000000000000000",
      }),
    );
    const higher = parseKeeperConfig(
      environment({
        DEEP_KEEPER_VAULT_SUBSIDY_CAP_WEI: "50000000000000000",
      }),
    );

    expect(lower.vaultSubsidyCapWei).toBe(10_000_000_000_000_000n);
    expect(higher.vaultSubsidyCapWei).toBe(50_000_000_000_000_000n);
    expect(() =>
      parseKeeperConfig(
        environment({ DEEP_KEEPER_VAULT_SUBSIDY_CAP_WEI: "0" }),
      ),
    ).toThrow("positive integer");
  });

  it("enforces the eight-vault operational batch ceiling", () => {
    expect(
      parseKeeperConfig(
        environment({
          DEEP_KEEPER_MAX_BATCH_SIZE: "8",
          DEEP_KEEPER_SCAN_LIMIT: "8",
          DEEP_KEEPER_MAX_GAS: "6000000",
        }),
      ).maxBatchSize,
    ).toBe(8);
    expect(() =>
      parseKeeperConfig(
        environment({ DEEP_KEEPER_MAX_BATCH_SIZE: "9" }),
      ),
    ).toThrow("from 1 to 8");
  });

  it("requires a reviewed six-million gas envelope above the default four-vault batch", () => {
    for (const maxGas of ["3000000", "3668879", "5625920"]) {
      expect(() =>
        parseKeeperConfig(
          environment({
            DEEP_KEEPER_MAX_BATCH_SIZE: "8",
            DEEP_KEEPER_SCAN_LIMIT: "8",
            DEEP_KEEPER_MAX_GAS: maxGas,
          }),
        ),
      ).toThrow("at least 6000000");
    }

    const reviewed = parseKeeperConfig(
      environment({
        DEEP_KEEPER_MAX_BATCH_SIZE: "8",
        DEEP_KEEPER_SCAN_LIMIT: "8",
        DEEP_KEEPER_MAX_GAS: "6000000",
      }),
    );
    expect(reviewed.maxBatchSize).toBe(8);
    expect(reviewed.maxGas).toBe(6_000_000n);
  });

  it("requires both activation switches and a remote low-privilege signer", () => {
    expect(() =>
      parseKeeperConfig(
        environment({
          DEEP_KEEPER_ENABLED: "true",
        }),
      ),
    ).toThrow("Activation requires both");

    expect(() =>
      parseKeeperConfig(
        environment({
          DEEP_KEEPER_ENABLED: "true",
          DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        }),
      ),
    ).toThrow("dedicated signer");
  });

  it("accepts one policy-bound Privy wallet instead of a signer RPC", () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_ENABLED: "true",
        DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        DEEP_KEEPER_SIGNER_ADDRESS: signer,
        DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
      }),
    );

    expect(config.signerRpcUrl).toBeNull();
    expect(config.privyWalletId).toBe(
      "yks0kyukdaidxf043xqxgaki",
    );
  });

  it("rejects ambiguous or malformed signing backends", () => {
    expect(() =>
      parseKeeperConfig(
        environment({
          DEEP_KEEPER_ENABLED: "true",
          DEEP_KEEPER_SEND_TRANSACTIONS: "true",
          DEEP_KEEPER_SIGNER_ADDRESS: signer,
          DEEP_KEEPER_SIGNER_RPC_URL: "https://signer.example",
          DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
        }),
      ),
    ).toThrow("exactly one remote signing backend");
    expect(() =>
      parseKeeperConfig(
        environment({
          DEEP_KEEPER_PRIVY_WALLET_ID: "not-a-wallet",
        }),
      ),
    ).toThrow("Privy wallet ID");
  });

  it("cannot redirect activation to another release manifest", () => {
    expect(() =>
      parseKeeperConfig(
        environment({
          DEEP_KEEPER_RELEASE_MANIFEST:
            "tmp/operator-supplied-release.json",
        }),
      ),
    ).toThrow(
      "must be contracts/deployments/mainnet-deep-full-range-v1.json",
    );
  });

  it("rejects private signing material", () => {
    expect(() =>
      parseKeeperConfig(
        environment({
          DEEP_KEEPER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
        }),
      ),
    ).toThrow("is not accepted");
  });
});

describe("Deep keeper release gate", () => {
  it("keeps the deployed release disabled until the keeper lifecycle is complete", () => {
    const config = parseKeeperConfig(environment());
    const gate = evaluateDeepKeeperReleaseGate(
      disabledRelease,
      config,
    );

    expect(gate.ready).toBe(false);
    expect(gate.reasons).toContain("deployment status");
    expect(gate.reasons).toContain("release eligibility");
    expect(gate.reasons).toContain("lifecycle evidence");
    expect(gate.reasons).toContain("keeper activation");
    expect(gate.reasons).toContain("keeper release policy");
    expect(gate.reasons).not.toContain("automation deployment receipt");
  });

  it("binds activation to exact release, receipt, runtime and keeper policy evidence", () => {
    const config = parseKeeperConfig(environment());
    const transactionHash = `0x${"44".repeat(32)}`;
    const release = structuredClone(disabledRelease);
    release.status = "deployment-source-and-lifecycle-verified";
    release.releaseEligible = true;
    release.releaseCommit = "1".repeat(40);
    release.startBlock = 25_700_000;
    release.sourceVerification.status = "verified";
    release.lifecycleEvidence = {
      status: "verified-current-release",
      releaseEligible: true,
      evidenceHash: `0x${"55".repeat(32)}`,
    };
    release.activation = {
      appStatus: "ready",
      keeperStatus: "ready",
      requiresExactManifestMatch: true,
    };
    release.addresses.automation = coordinator;
    release.runtimeCodeHashes.automation = runtimeHash;
    release.transactions.launcher = transactionHash;
    release.transactions.automation = transactionHash;
    release.deploymentBlocks.automation = 25_700_005;
    release.deploymentEvidence.automation = {
      transactionHash,
      blockNumber: 25_700_005,
      receiptStatus: "success",
      blockHash: `0x${"66".repeat(32)}`,
    };
    release.keeperPolicy = {
      ...release.keeperPolicy,
      status: "verified-ready-disabled-by-default",
      coordinator,
      coordinatorRuntimeCodeHash: runtimeHash,
    };

    expect(
      evaluateDeepKeeperReleaseGate(release, config),
    ).toMatchObject({ ready: true, reasons: [] });
    release.runtimeCodeHashes.automation = `0x${"77".repeat(32)}`;
    expect(
      evaluateDeepKeeperReleaseGate(release, config),
    ).toMatchObject({ ready: false });
  });
});

describe("Deep keeper state and gas attribution", () => {
  it("migrates schema v1 without discarding an existing pending transaction", () => {
    const config = parseKeeperConfig(environment());
    const legacy = {
      schemaVersion: 1,
      chainId: 1,
      coordinatorAddress: coordinator,
      cursor: 3,
      checkpoint: null,
      pendingTransaction: {
        hash: `0x${"10".repeat(32)}`,
        submittedAtMs: 1_000,
        candidates: [firstVault],
        gas: "1000000",
        maxFeePerGas: "10000000000",
      },
      recentTransactions: [],
    };

    const migrated = migrateKeeperState(legacy, config);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.cursor).toBe(3);
    expect(migrated.vaultSubsidies).toEqual({});
    expect(migrated.pendingTransaction.maximumTransactionCostWei).toBe(
      "10000000000000000",
    );
    expect(
      migrated.pendingTransaction.perVaultReservedWei[
        firstVault.toLowerCase()
      ],
    ).toBe("10000000000000000");
  });

  it("rejects unknown future state versions and malformed subsidy values", () => {
    const config = parseKeeperConfig(environment());
    const future = createInitialState(config);
    future.schemaVersion = 3;
    expect(() => migrateKeeperState(future, config)).toThrow(
      "does not match",
    );

    const malformed = createInitialState(config);
    malformed.vaultSubsidies[firstVault.toLowerCase()] = {
      simulatedCostWei: "0",
      actualCostWei: "-1",
      transactionCount: 0,
      lastUpdatedAtMs: 0,
    };
    expect(() => migrateKeeperState(malformed, config)).toThrow(
      "unsigned decimal",
    );
  });

  it("rejects a persisted full-envelope reservation that can exceed the cap", () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    state.vaultSubsidies[firstVault.toLowerCase()] = {
      simulatedCostWei: "0",
      actualCostWei: "25000000000000000",
      transactionCount: 1,
      lastUpdatedAtMs: 1,
    };
    state.pendingTransaction = {
      hash: `0x${"11".repeat(32)}`,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      gas: "1000000",
      maxFeePerGas: "10000000000",
      maximumTransactionCostWei: "10000000000000000",
      perVaultReservedWei: {
        [firstVault.toLowerCase()]: "10000000000000000",
      },
      perVaultEstimatedGas: {
        [firstVault.toLowerCase()]: "1000000",
      },
      reservationPolicy: "batch-envelope-v1",
      subsidyCapWeiAtSubmission: "30000000000000000",
    };

    expect(() => migrateKeeperState(state, config)).toThrow(
      "hard-cap envelope",
    );
  });

  it("attributes an exact batch cost proportionally with deterministic remainder handling", () => {
    const allocations = allocateWeiByWeight(
      11n,
      [firstVault, secondVault],
      {
        [firstVault.toLowerCase()]: "1",
        [secondVault.toLowerCase()]: "3",
      },
    );

    expect(allocations[firstVault.toLowerCase()]).toBe(3n);
    expect(allocations[secondVault.toLowerCase()]).toBe(8n);
    expect(
      (Object.values(allocations) as bigint[]).reduce(
        (total, value) => total + value,
        0n,
      ),
    ).toBe(11n);
  });
});

describe("Deep keeper cycle", () => {
  it("accepts the measured four-vault process envelope under the default gas cap", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const metrics = createMetrics();
    const work = [
      firstVault,
      secondVault,
      "0x5555555555555555555555555555555555555555",
      "0x6666666666666666666666666666666666666666",
    ].map((vault) => ({ vault, action: 1 }));
    const first = reader({
      ready: work,
      registryCount: 4n,
      gasEstimate: 2_344_075n,
    });
    const second = reader({
      ready: work,
      registryCount: 4n,
      gasEstimate: 2_344_075n,
    });

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      nowMs: 500,
    });

    expect(result.outcome).toBe("disabled-simulation-only");
    expect(result.ready).toHaveLength(4);
    expect(result.state.vaultSubsidies[firstVault.toLowerCase()]).toMatchObject({
      simulatedCostWei: "28128900000000000",
    });
  });

  it.each([
    ["staged-oracle", 3_057_399n, 3_668_879n],
    ["first-process", 4_688_266n, 5_625_920n],
  ])(
    "rejects the measured eight-vault %s envelope against a stale three-million cap",
    async (_label, estimate, padded) => {
      const reviewed = parseKeeperConfig(
        environment({
          DEEP_KEEPER_MAX_BATCH_SIZE: "8",
          DEEP_KEEPER_SCAN_LIMIT: "8",
          DEEP_KEEPER_MAX_GAS: "6000000",
        }),
      );
      // The parser rejects this combination. This constrained copy also proves
      // the runtime gas check stays fail-closed if stale configuration bypasses it.
      const config = Object.freeze({
        ...reviewed,
        maxGas: 3_000_000n,
      });
      const work = Array.from({ length: 8 }, (_, index) => ({
        vault: `0x${(index + 10).toString(16).padStart(40, "0")}`,
        action: 1,
      }));
      const state = createInitialState(config);
      const metrics = createMetrics();
      const first = reader({
        ready: work,
        registryCount: 8n,
        gasEstimate: estimate,
      });
      const second = reader({
        ready: work,
        registryCount: 8n,
        gasEstimate: estimate,
      });

      await expect(
        runKeeperCycle({
          config,
          state,
          metrics,
          readers: [first, second],
          nowMs: 750,
        }),
      ).rejects.toMatchObject({
        code: "GAS_LIMIT_EXCEEDED",
        context: {
          estimatedGas: estimate.toString(),
          paddedGas: padded.toString(),
          maximum: "3000000",
        },
      });
    },
  );

  it("does not simulate or submit an empty ready batch", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const metrics = createMetrics();
    const first = reader();
    const second = reader();
    const wallet = { writeContract: vi.fn() };

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      wallet,
      nowMs: 1_000,
    });

    expect(result.outcome).toBe("idle");
    expect(first.simulateContract).not.toHaveBeenCalled();
    expect(second.simulateContract).not.toHaveBeenCalled();
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("runs independent simulation but cannot submit while disabled", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const metrics = createMetrics();
    const work = [{ vault: firstVault, action: 1 }];
    const first = reader({ ready: work, nextCursor: 1 });
    const second = reader({ ready: work, nextCursor: 1 });
    const wallet = { writeContract: vi.fn() };

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      wallet,
      nowMs: 2_000,
    });

    expect(result.outcome).toBe("disabled-simulation-only");
    expect(first.simulateContract).toHaveBeenCalledOnce();
    expect(second.simulateContract).toHaveBeenCalledOnce();
    expect(wallet.writeContract).not.toHaveBeenCalled();
    expect(metrics.simulations).toBe(1);
    expect(
      result.state.vaultSubsidies[firstVault.toLowerCase()]
        .simulatedCostWei,
    ).toBe("12000000000000000");
  });

  it("skips only vaults whose remaining subsidy cannot cover the conservative quote", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_VAULT_SUBSIDY_CAP_WEI: "20000000000000000",
      }),
    );
    const state = createInitialState(config);
    state.vaultSubsidies[firstVault.toLowerCase()] = {
      simulatedCostWei: "0",
      actualCostWei: "15000000000000000",
      transactionCount: 1,
      lastUpdatedAtMs: 1,
    };
    const metrics = createMetrics();
    const work = [
      { vault: firstVault, action: 1 },
      { vault: secondVault, action: 2 },
    ];
    const first = reader({ ready: work, registryCount: 2n });
    const second = reader({ ready: work, registryCount: 2n });

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      nowMs: 2_250,
    });

    expect(result.outcome).toBe("disabled-simulation-only");
    expect(result.ready.map((item: Work) => item.vault)).toEqual([
      secondVault,
    ]);
    expect(result.skipped.map((item: Work) => item.vault)).toEqual([
      firstVault,
    ]);
    expect(first.simulateContract.mock.calls[0]![0].args).toEqual([
      [secondVault],
    ]);
    expect(metrics.subsidyVaultsSkipped).toBe(1);
    expect(metrics.subsidyVaultsExhausted).toBe(1);
  });

  it("returns a budget-specific idle result when every ready vault is exhausted", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    state.vaultSubsidies[firstVault.toLowerCase()] = {
      simulatedCostWei: "0",
      actualCostWei: config.vaultSubsidyCapWei.toString(),
      transactionCount: 1,
      lastUpdatedAtMs: 1,
    };
    const metrics = createMetrics();
    const work = [{ vault: firstVault, action: 1 }];
    const first = reader({ ready: work, registryCount: 1n });
    const second = reader({ ready: work, registryCount: 1n });

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      nowMs: 2_300,
    });

    expect(result.outcome).toBe("subsidy-budget-exhausted");
    expect(first.simulateContract).not.toHaveBeenCalled();
    expect(second.simulateContract).not.toHaveBeenCalled();
    expect(first.estimateContractGas).not.toHaveBeenCalled();
    expect(metrics.subsidyVaultsSkipped).toBe(1);
  });

  it("accepts staged oracle growth as coordinator work", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const metrics = createMetrics();
    const work = [{ vault: firstVault, action: 3 }];
    const first = reader({ ready: work, nextCursor: 1 });
    const second = reader({ ready: work, nextCursor: 1 });
    const wallet = { writeContract: vi.fn() };

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      wallet,
      nowMs: 2_500,
    });

    expect(result.outcome).toBe("disabled-simulation-only");
    expect(first.simulateContract).toHaveBeenCalledOnce();
    expect(second.simulateContract).toHaveBeenCalledOnce();
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("rejects unknown coordinator actions", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const metrics = createMetrics();
    const work = [{ vault: firstVault, action: 4 }];
    const first = reader({ ready: work, nextCursor: 1 });
    const second = reader({ ready: work, nextCursor: 1 });

    await expect(
      runKeeperCycle({
        config,
        state,
        metrics,
        readers: [first, second],
        nowMs: 2_750,
      }),
    ).rejects.toMatchObject({ code: "RPC_INVALID_RESPONSE" });
  });

  it("fails closed when independent RPC discovery disagrees", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const metrics = createMetrics();
    const first = reader({
      ready: [{ vault: firstVault, action: 1 }],
      registryCount: 1n,
    });
    const second = reader({
      ready: [{ vault: secondVault, action: 1 }],
      registryCount: 1n,
    });

    await expect(
      runKeeperCycle({
        config,
        state,
        metrics,
        readers: [first, second],
        nowMs: 3_000,
      }),
    ).rejects.toMatchObject({ code: "RPC_DISAGREEMENT" });
    expect(metrics.rpcDisagreements).toBe(1);
    expect(metrics.cycleFailures).toBe(1);
  });

  it("rejects a batch unless every ready vault simulates successfully", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const metrics = createMetrics();
    const work = [
      { vault: firstVault, action: 1 },
      { vault: secondVault, action: 2 },
    ];
    const first = reader({
      ready: work,
      registryCount: 2n,
      simulation: [2n, 1n],
    });
    const second = reader({
      ready: work,
      registryCount: 2n,
      simulation: [2n, 1n],
    });

    await expect(
      runKeeperCycle({
        config,
        state,
        metrics,
        readers: [first, second],
        nowMs: 4_000,
      }),
    ).rejects.toMatchObject({ code: "SIMULATION_REJECTED" });
    expect(metrics.simulationFailures).toBe(1);
  });

  it("submits one bounded non-empty batch through the remote signer", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_ENABLED: "true",
        DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        DEEP_KEEPER_SIGNER_ADDRESS: signer,
        DEEP_KEEPER_SIGNER_RPC_URL: "https://signer.example",
      }),
    );
    const state = createInitialState(config);
    const metrics = createMetrics();
    const work = [
      { vault: firstVault, action: 1 },
      { vault: secondVault, action: 2 },
    ];
    const first = reader({ ready: work, registryCount: 2n });
    const second = reader({ ready: work, registryCount: 2n });
    const transactionHash = `0x${"55".repeat(32)}`;
    const wallet = {
      writeContract: vi.fn(
        async (request: Record<string, unknown>) => {
          void request;
          return transactionHash;
        },
      ),
    };

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      wallet,
      nowMs: 5_000,
    });

    expect(result.outcome).toBe("submitted");
    expect(wallet.writeContract).toHaveBeenCalledOnce();
    expect(wallet.writeContract.mock.calls[0]![0].args).toEqual([
      [firstVault, secondVault],
    ]);
    expect(result.state.pendingTransaction.hash).toBe(transactionHash);
    expect(result.state.pendingTransaction.maximumTransactionCostWei).toBe(
      "12000000000000000",
    );
    expect(
      result.state.pendingTransaction.perVaultReservedWei[
        firstVault.toLowerCase()
      ],
    ).toBe("12000000000000000");
    expect(metrics.batchesSubmitted).toBe(1);
  });

  it("persists the transaction hash and subsidy reservation immediately after signing", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_ENABLED: "true",
        DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        DEEP_KEEPER_SIGNER_ADDRESS: signer,
        DEEP_KEEPER_SIGNER_RPC_URL: "https://signer.example",
      }),
    );
    const state = createInitialState(config);
    const metrics = createMetrics();
    const work = [{ vault: firstVault, action: 1 }];
    const first = reader({ ready: work, registryCount: 1n });
    const second = reader({ ready: work, registryCount: 1n });
    const transactionHash = `0x${"56".repeat(32)}`;
    const order: string[] = [];
    const wallet = {
      writeContract: vi.fn(async () => {
        order.push("signed");
        return transactionHash;
      }),
    };
    const persistPendingState = vi.fn(
      async (pendingState: ReturnType<typeof createInitialState>) => {
        expect(pendingState.pendingTransaction.hash).toBe(transactionHash);
        expect(
          pendingState.pendingTransaction.perVaultReservedWei[
            firstVault.toLowerCase()
          ],
        ).toBe("12000000000000000");
        order.push("persisted");
      },
    );

    await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      wallet,
      persistPendingState,
      nowMs: 5_250,
    });

    expect(order).toEqual(["signed", "persisted"]);
    expect(persistPendingState).toHaveBeenCalledOnce();
  });

  it("cannot push a vault over its cap when actual gas stays inside the persisted batch envelope", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_ENABLED: "true",
        DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        DEEP_KEEPER_SIGNER_ADDRESS: signer,
        DEEP_KEEPER_SIGNER_RPC_URL: "https://signer.example",
      }),
    );
    const state = createInitialState(config);
    state.vaultSubsidies[firstVault.toLowerCase()] = {
      simulatedCostWei: "0",
      actualCostWei: "18000000000000000",
      transactionCount: 1,
      lastUpdatedAtMs: 1,
    };
    const metrics = createMetrics();
    const work = [
      { vault: firstVault, action: 1 },
      { vault: secondVault, action: 2 },
    ];
    const gasEstimate = (candidates: string[]) => {
      if (candidates.length > 1 || candidates[0] === firstVault) {
        return 1_000_000n;
      }
      return 1n;
    };
    const first = reader({
      ready: work,
      registryCount: 2n,
      gasEstimate,
    });
    const second = reader({
      ready: work,
      registryCount: 2n,
      gasEstimate,
    });
    const transactionHash = `0x${"57".repeat(32)}`;
    const submitted = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      wallet: { writeContract: vi.fn(async () => transactionHash) },
      nowMs: 5_300,
    });

    expect(
      submitted.state.pendingTransaction.perVaultReservedWei[
        firstVault.toLowerCase()
      ],
    ).toBe("12000000000000000");
    const blockNumber = 80n;
    const receipt = {
      blockNumber,
      blockHash: hashFor(blockNumber),
      status: "success",
      transactionHash,
      gasUsed: 1_200_000n,
      effectiveGasPrice: 10_000_000_000n,
    };
    const confirmed = await runKeeperCycle({
      config,
      state: submitted.state,
      metrics,
      readers: [reader({ receipt }), reader({ receipt })],
      nowMs: 6_000,
    });

    expect(
      BigInt(
        confirmed.state.vaultSubsidies[firstVault.toLowerCase()]
          .actualCostWei,
      ),
    ).toBeLessThanOrEqual(config.vaultSubsidyCapWei);
    expect(metrics.subsidyBudgetOverruns).toBe(0);
  });

  it("refuses an overfunded signer instead of expanding its privilege", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_ENABLED: "true",
        DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        DEEP_KEEPER_SIGNER_ADDRESS: signer,
        DEEP_KEEPER_SIGNER_RPC_URL: "https://signer.example",
      }),
    );
    const state = createInitialState(config);
    const metrics = createMetrics();
    const work = [{ vault: firstVault, action: 1 }];
    const overfundedBalance = config.maxSignerBalanceWei + 1n;
    const first = reader({
      ready: work,
      registryCount: 1n,
      balance: overfundedBalance,
    });
    const second = reader({
      ready: work,
      registryCount: 1n,
      balance: overfundedBalance,
    });
    const wallet = {
      writeContract: vi.fn(),
    };

    await expect(
      runKeeperCycle({
        config,
        state,
        metrics,
        readers: [first, second],
        wallet,
        nowMs: 5_500,
      }),
    ).rejects.toMatchObject({ code: "SIGNER_BALANCE_REJECTED" });
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("waits for an existing transaction before scanning or sending again", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    state.pendingTransaction = {
      hash: `0x${"66".repeat(32)}`,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      gas: "1000000",
      maxFeePerGas: "10000000000",
    };
    const metrics = createMetrics();
    const first = reader();
    const second = reader();

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      nowMs: 2_000,
    });

    expect(result.outcome).toBe("waiting-for-confirmation");
    expect(first.readContract).not.toHaveBeenCalled();
    expect(second.readContract).not.toHaveBeenCalled();
  });

  it("defers a timed-out transaction and retries only on the next cycle", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    state.pendingTransaction = {
      hash: `0x${"69".repeat(32)}`,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      gas: "1000000",
      maxFeePerGas: "10000000000",
    };
    const metrics = createMetrics();
    const timedOut = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [reader(), reader()],
      nowMs: 1_000 + config.pendingTimeoutMs,
    });

    expect(timedOut.outcome).toBe("pending-dropped-retry-next-cycle");
    expect(timedOut.state.pendingTransaction).toBeNull();
    expect(metrics.transactionsDropped).toBe(1);

    const work = [{ vault: firstVault, action: 1 }];
    const retried = await runKeeperCycle({
      config,
      state: timedOut.state,
      metrics,
      readers: [
        reader({ ready: work, registryCount: 1n }),
        reader({ ready: work, registryCount: 1n }),
      ],
      nowMs: 1_000 + config.pendingTimeoutMs + config.intervalMs,
    });

    expect(retried.outcome).toBe("disabled-simulation-only");
    expect(metrics.simulations).toBe(1);
  });

  it("confirms a canonical receipt and resumes discovery", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const transactionHash = `0x${"77".repeat(32)}`;
    const blockNumber = 80n;
    const receipt = {
      blockNumber,
      blockHash: hashFor(blockNumber),
      status: "success",
      transactionHash,
      gasUsed: 500_000n,
      effectiveGasPrice: 5_000_000_000n,
    };
    state.pendingTransaction = {
      hash: transactionHash,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      gas: "1000000",
      maxFeePerGas: "10000000000",
    };
    const metrics = createMetrics();

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [reader({ receipt }), reader({ receipt })],
      nowMs: 2_000,
    });

    expect(result.outcome).toBe("idle");
    expect(result.state.pendingTransaction).toBeNull();
    expect(result.state.recentTransactions[0].status).toBe("success");
    expect(
      result.state.vaultSubsidies[firstVault.toLowerCase()].actualCostWei,
    ).toBe("2500000000000000");
    expect(result.state.recentTransactions[0].gasUsed).toBe("500000");
    expect(result.state.recentTransactions[0].effectiveGasPrice).toBe(
      "5000000000",
    );
    expect(metrics.transactionsConfirmed).toBe(1);
  });

  it("charges canonical reverted transaction gas before deferring a retry", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const transactionHash = `0x${"78".repeat(32)}`;
    const blockNumber = 80n;
    const receipt = {
      blockNumber,
      blockHash: hashFor(blockNumber),
      status: "reverted",
      transactionHash,
      gasUsed: 400_000n,
      effectiveGasPrice: 5_000_000_000n,
    };
    state.pendingTransaction = {
      hash: transactionHash,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      gas: "1000000",
      maxFeePerGas: "10000000000",
    };
    const metrics = createMetrics();

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [reader({ receipt }), reader({ receipt })],
      nowMs: 2_000,
    });

    expect(result.outcome).toBe(
      "transaction-reverted-retry-next-cycle",
    );
    expect(
      result.state.vaultSubsidies[firstVault.toLowerCase()].actualCostWei,
    ).toBe("2000000000000000");
    expect(metrics.transactionsReverted).toBe(1);
  });

  it("resets the circular cursor after a confirmed-chain reorg", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    state.cursor = 9;
    state.checkpoint = {
      number: "80",
      hash: hashFor(80n, "00"),
    };
    const seenCursors: bigint[] = [];
    const first = reader({
      nextCursor: 1,
      registryCount: 1n,
      blockSalt: "01",
      onScan: (cursor) => seenCursors.push(cursor),
    });
    const second = reader({
      nextCursor: 1,
      registryCount: 1n,
      blockSalt: "01",
      onScan: (cursor) => seenCursors.push(cursor),
    });
    const metrics = createMetrics();

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      nowMs: 6_000,
    });

    expect(result.outcome).toBe("idle");
    expect(seenCursors).toEqual([0n, 0n]);
    expect(metrics.reorgs).toBe(1);
  });
});

describe("Deep keeper metrics", () => {
  it("exposes activation, failures, reorgs and pending state", () => {
    const config = parseKeeperConfig(environment());
    const metrics = createMetrics();
    metrics.cycles = 3;
    metrics.cycleFailures = 1;
    metrics.reorgs = 2;
    metrics.subsidyVaultsSkipped = 4;
    const runtime = {
      state: {
        pendingTransaction: { hash: `0x${"88".repeat(32)}` },
        vaultSubsidies: {
          [firstVault.toLowerCase()]: {
            simulatedCostWei: "12",
            actualCostWei: "7",
          },
        },
      },
    };

    const output = renderPrometheusMetrics(metrics, runtime, config);

    expect(output).toContain("deep_keeper_enabled 0");
    expect(output).toContain("deep_keeper_cycles_total 3");
    expect(output).toContain("deep_keeper_cycle_failures_total 1");
    expect(output).toContain("deep_keeper_reorgs_total 2");
    expect(output).toContain("deep_keeper_pending_transaction 1");
    expect(output).toContain(
      "deep_keeper_vault_subsidy_cap_wei 30000000000000000",
    );
    expect(output).toContain(
      "deep_keeper_vault_subsidy_skipped_total 4",
    );
    expect(output).toContain(
      "deep_keeper_vault_subsidy_durable_actual_wei 7",
    );
  });
});
