import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseAbi,
} from "viem";
import type { Address } from "viem";
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
  PRIVY_IDEMPOTENCY_REPLAY_WINDOW_MS,
  renderPrometheusMetrics,
  runKeeperCycle,
} = deepKeeper;

const coordinator = "0x1111111111111111111111111111111111111111";
const automation = "0x9999999999999999999999999999999999999999";
const signer = "0x2222222222222222222222222222222222222222";
const firstVault = "0x3333333333333333333333333333333333333333";
const secondVault = "0x4444444444444444444444444444444444444444";
const code = "0x60006000";
const runtimeHash = keccak256(code);
const executorRuntimeHash =
  "0xd4a6e8f200bd63ab924f5c4cfb1bbcc07c26c7b7b7abaa1f879418d2435f48e6";
const sourceCommitment = deepKeeper.DEEP_KEEPER_EXECUTOR_SOURCE_COMMITMENT;
const candidateResultAbi = parseAbi([
  "event CandidateResult(bytes32 indexed batchHash,uint256 indexed candidateIndex,address indexed vault,address executor,uint8 expectedAction,uint8 actualAction,uint8 outcome,bytes4 errorSelector,uint256 gasUsed)",
]);
const resultBatchHash = `0x${"ab".repeat(32)}` as `0x${string}`;
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
    DEEP_KEEPER_AUTOMATION_ADDRESS: automation,
    DEEP_KEEPER_AUTOMATION_RUNTIME_HASH: runtimeHash,
    DEEP_KEEPER_COORDINATOR_ADDRESS: coordinator,
    DEEP_KEEPER_COORDINATOR_RUNTIME_HASH: runtimeHash,
    DEEP_KEEPER_COORDINATOR_SOURCE_COMMITMENT: sourceCommitment,
    DEEP_KEEPER_RPC_URLS:
      "https://reader-one.example,https://reader-two.example",
    ...overrides,
  };
}

function readyKeeperConfig() {
  return parseKeeperConfig(
    environment({
      DEEP_KEEPER_ENABLED: "true",
      DEEP_KEEPER_SEND_TRANSACTIONS: "true",
      DEEP_KEEPER_SIGNER_ADDRESS: signer,
      DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
      DEEP_KEEPER_COORDINATOR_RUNTIME_HASH: executorRuntimeHash,
    }),
  );
}

function enabledKeeperConfig() {
  return parseKeeperConfig(
    environment({
      DEEP_KEEPER_ENABLED: "true",
      DEEP_KEEPER_SEND_TRANSACTIONS: "true",
      DEEP_KEEPER_SIGNER_ADDRESS: signer,
      DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
    }),
  );
}

function readyKeeperRelease() {
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
    requiredRelease: "deep-full-range-v1",
    independentRpcCount: 2,
    canaryToken: firstVault,
    launchTransaction: `0x${"10".repeat(32)}`,
    oracleTransaction: `0x${"20".repeat(32)}`,
    feeProcessCompoundTransaction: `0x${"30".repeat(32)}`,
    keeperExecutorDeploymentTransaction: `0x${"40".repeat(32)}`,
    keeperExecutorDeploymentBlock: 25_700_001,
    evidenceHash: `0x${"55".repeat(32)}`,
    keeperExecutor: coordinator,
    keeperExecutorRuntimeCodeHash: executorRuntimeHash,
  };
  release.activation = {
    appStatus: "ready",
    keeperStatus: "ready",
    requiresExactManifestMatch: true,
  };
  release.blockers = [];
  release.addresses.automation = automation;
  release.runtimeCodeHashes.automation = runtimeHash;
  release.sourceVerification.contracts.keeperExecutor = {
    fqcn: "src/DeepKeeperExecutorV1.sol:DeepKeeperExecutorV1",
    deploymentKind: "CREATE",
    constructorTypes: ["address"],
    constructorArguments: [automation],
    encodedConstructorArguments: `0x${automation.slice(2).padStart(64, "0")}`,
    etherscan: {
      status: "exact-match",
      url: `https://etherscan.io/address/${coordinator}#code`,
    },
    sourcify: {
      status: "exact-match",
      url: `https://repo.sourcify.dev/contracts/full_match/1/${coordinator}/`,
    },
  };
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
    coordinatorRuntimeCodeHash: executorRuntimeHash,
    coordinatorSourceCommitment: sourceCommitment,
    automation,
    automationRuntimeCodeHash: runtimeHash,
    signerAddress: signer,
    independentReadRpcCount: 2,
    defaultMaxGas: "4500000",
    extendedBatchMinimumGas: "9000000",
  };
  return release;
}

type Work = { vault: string; action: number };

function receiptMissing() {
  const error = new Error("Transaction receipt could not be found");
  error.name = "TransactionReceiptNotFoundError";
  throw error;
}

function candidateResultLog(
  vault: Address,
  action: number,
  {
    actualAction = action,
    outcome = 4,
    executor = signer,
    candidateIndex = 0,
    batchHash = resultBatchHash,
    errorSelector = "0x00000000",
  }: {
    actualAction?: number;
    outcome?: number;
    executor?: Address;
    candidateIndex?: number;
    batchHash?: `0x${string}`;
    errorSelector?: `0x${string}`;
  } = {},
) {
  return {
    address: coordinator,
    topics: encodeEventTopics({
      abi: candidateResultAbi,
      eventName: "CandidateResult",
      args: { batchHash, candidateIndex: BigInt(candidateIndex), vault },
    }),
    data: encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint8" },
        { type: "uint8" },
        { type: "uint8" },
        { type: "bytes4" },
        { type: "uint256" },
      ],
      [executor, action, actualAction, outcome, errorSelector, 100_000n],
    ),
  };
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
  checkedActions,
  executorCode = code,
  automationCode = code,
  executorAutomation = automation,
}: {
  ready?: Work[];
  nextCursor?: number;
  registryCount?: bigint;
  head?: bigint;
  blockSalt?: string;
  simulation?: [bigint, bigint];
  receipt?: object | null;
  balance?: bigint | ((blockNumber: bigint) => bigint);
  gasEstimate?: bigint | ((candidates: string[]) => bigint);
  maxFeePerGas?: bigint;
  onScan?: (cursor: bigint) => void;
  checkedActions?: Record<string, number>;
  executorCode?: `0x${string}`;
  automationCode?: `0x${string}`;
  executorAutomation?: string;
} = {}) {
  return {
    getChainId: vi.fn(async () => 1),
    getBlockNumber: vi.fn(async () => head),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: hashFor(blockNumber, blockSalt),
    })),
    getCode: vi.fn(async ({ address }: { address: string }) =>
      address.toLowerCase() === automation.toLowerCase()
        ? automationCode
        : executorCode,
    ),
    readContract: vi.fn(
      async ({
        functionName,
        args,
      }: {
        functionName: string;
        args?: unknown[];
      }) => {
        if (functionName === "automation") return executorAutomation;
        if (functionName === "registeredVaultCount") return registryCount;
        if (functionName === "scan") {
          onScan?.((args?.[0] as bigint | undefined) ?? 0n);
          return [ready, BigInt(nextCursor)];
        }
        if (functionName === "checkVault") {
          const vault = String(args?.[0] ?? "").toLowerCase();
          return (
            checkedActions?.[vault] ??
            ready.find((item) => item.vault.toLowerCase() === vault)?.action ??
            0
          );
        }
        throw new Error(`Unexpected read ${functionName}`);
      },
    ),
    simulateContract: vi.fn(async ({ args }: { args: [unknown[]] }) => ({
      result: [
        resultBatchHash,
        ...(simulation ?? [BigInt(args[0].length), BigInt(args[0].length)]),
      ],
    })),
    estimateContractGas: vi.fn(async ({ args }: { args: [unknown[]] }) => {
      const vaults = args[0].map((candidate) =>
        typeof candidate === "string"
          ? candidate
          : String((candidate as { vault: string }).vault),
      );
      return typeof gasEstimate === "function"
        ? gasEstimate(vaults)
        : gasEstimate;
    }),
    estimateFeesPerGas: vi.fn(async () => ({
      maxFeePerGas,
      maxPriorityFeePerGas: 1_000_000_000n,
    })),
    getBalance: vi.fn(
      async ({ blockNumber }: { blockNumber: bigint }) =>
        typeof balance === "function" ? balance(blockNumber) : balance,
    ),
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
    expect(config.maxGas).toBe(4_500_000n);
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
          DEEP_KEEPER_MAX_GAS: "9000000",
        }),
      ).maxBatchSize,
    ).toBe(8);
    expect(() =>
      parseKeeperConfig(environment({ DEEP_KEEPER_MAX_BATCH_SIZE: "9" })),
    ).toThrow("from 1 to 8");
  });

  it("requires a reviewed six-million gas envelope above the default four-vault batch", () => {
    for (const maxGas of ["4500000", "6000000", "8999999"]) {
      expect(() =>
        parseKeeperConfig(
          environment({
            DEEP_KEEPER_MAX_BATCH_SIZE: "8",
            DEEP_KEEPER_SCAN_LIMIT: "8",
            DEEP_KEEPER_MAX_GAS: maxGas,
          }),
        ),
      ).toThrow("at least 9000000");
    }

    const reviewed = parseKeeperConfig(
      environment({
        DEEP_KEEPER_MAX_BATCH_SIZE: "8",
        DEEP_KEEPER_SCAN_LIMIT: "8",
        DEEP_KEEPER_MAX_GAS: "9000000",
      }),
    );
    expect(reviewed.maxBatchSize).toBe(8);
    expect(reviewed.maxGas).toBe(9_000_000n);
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
    expect(config.privyWalletId).toBe("yks0kyukdaidxf043xqxgaki");
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
    ).toThrow("replay-safe Privy");
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
          DEEP_KEEPER_RELEASE_MANIFEST: "tmp/operator-supplied-release.json",
        }),
      ),
    ).toThrow("must be contracts/deployments/mainnet-deep-full-range-v1.json");
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
    const gate = evaluateDeepKeeperReleaseGate(disabledRelease, config);

    expect(gate.ready).toBe(false);
    expect(gate.reasons).toContain("deployment status");
    expect(gate.reasons).toContain("release eligibility");
    expect(gate.reasons).toContain("lifecycle evidence");
    expect(gate.reasons).toContain("keeper activation");
    expect(gate.reasons).toContain("keeper release policy");
    expect(gate.reasons).not.toContain("automation deployment receipt");
  });

  it("binds activation to exact release, receipt, runtime and keeper policy evidence", () => {
    const config = readyKeeperConfig();
    const release = readyKeeperRelease();

    expect(evaluateDeepKeeperReleaseGate(release, config)).toMatchObject({
      ready: true,
      reasons: [],
    });
    release.runtimeCodeHashes.automation = `0x${"77".repeat(32)}`;
    expect(evaluateDeepKeeperReleaseGate(release, config)).toMatchObject({
      ready: false,
    });
  });

  it("rejects wrong executor runtime, automation and signer bindings", () => {
    const config = readyKeeperConfig();
    const release = readyKeeperRelease();

    const wrongRuntime = structuredClone(release);
    wrongRuntime.lifecycleEvidence.keeperExecutorRuntimeCodeHash = `0x${"77".repeat(32)}`;
    expect(evaluateDeepKeeperReleaseGate(wrongRuntime, config).ready).toBe(
      false,
    );

    const wrongAutomation = structuredClone(release);
    wrongAutomation.keeperPolicy.automation =
      "0x7777777777777777777777777777777777777777";
    expect(evaluateDeepKeeperReleaseGate(wrongAutomation, config).ready).toBe(
      false,
    );

    const wrongSigner = structuredClone(release);
    wrongSigner.keeperPolicy.signerAddress =
      "0x7777777777777777777777777777777777777777";
    expect(evaluateDeepKeeperReleaseGate(wrongSigner, config).ready).toBe(
      false,
    );
  });

  it.each([
    [
      "independent RPC count",
      (release: ReturnType<typeof readyKeeperRelease>) => {
        release.lifecycleEvidence.independentRpcCount = 1;
      },
    ],
    [
      "oracle transaction",
      (release: ReturnType<typeof readyKeeperRelease>) => {
        release.lifecycleEvidence.oracleTransaction = null;
      },
    ],
    [
      "fee-process transaction",
      (release: ReturnType<typeof readyKeeperRelease>) => {
        release.lifecycleEvidence.feeProcessCompoundTransaction = null;
      },
    ],
    [
      "executor deployment transaction",
      (release: ReturnType<typeof readyKeeperRelease>) => {
        release.lifecycleEvidence.keeperExecutorDeploymentTransaction = null;
      },
    ],
    [
      "executor deployment block",
      (release: ReturnType<typeof readyKeeperRelease>) => {
        release.lifecycleEvidence.keeperExecutorDeploymentBlock = 0;
      },
    ],
    [
      "exact source URL",
      (release: ReturnType<typeof readyKeeperRelease>) => {
        release.sourceVerification.contracts.keeperExecutor.etherscan.url =
          "https://etherscan.io/address/0x0000000000000000000000000000000000000000#code";
      },
    ],
  ])("fails closed without the final %s proof", (_label, mutate) => {
    const release = readyKeeperRelease();
    mutate(release);
    expect(
      evaluateDeepKeeperReleaseGate(release, readyKeeperConfig()).ready,
    ).toBe(false);
  });
});

describe("Deep keeper state and gas attribution", () => {
  it("isolates the serverless schema-v4 state from older Blob objects", () => {
    const routeSource = readFileSync(
      new URL("../app/api/ops/deep-keeper/route.ts", import.meta.url),
      "utf8",
    );

    expect(routeSource).toContain(
      'const STATE_PATH = "ops/deep-keeper/state-v4.json"',
    );
    expect(routeSource).not.toContain("ops/deep-keeper/state-v3.json");
  });

  it("keeps the unleased standalone process simulation-only", () => {
    const runSource = readFileSync(
      new URL("../ops/deep-keeper/run.mjs", import.meta.url),
      "utf8",
    );

    expect(runSource).toContain(
      "The standalone keeper is simulation-only",
    );
    expect(runSource).toContain(
      "live execution is restricted to the leased /api/ops/deep-keeper route",
    );
    expect(runSource).not.toContain("createPrivyKeeperWallet");
  });

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

    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.cursor).toBe(3);
    expect(migrated.vaultSubsidies).toEqual({});
    expect(migrated.pendingTransaction.maximumTransactionCostWei).toBe(
      "10000000000000000",
    );
    expect(
      migrated.pendingTransaction.perVaultReservedWei[firstVault.toLowerCase()],
    ).toBe("10000000000000000");
  });

  it("rejects unknown future state versions and malformed subsidy values", () => {
    const config = parseKeeperConfig(environment());
    const future = createInitialState(config);
    future.schemaVersion = 5;
    expect(() => migrateKeeperState(future, config)).toThrow("does not match");

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

  it("rejects an intent whose persisted cost understates its signed gas envelope", () => {
    const config = enabledKeeperConfig();
    const state = createInitialState(config);
    state.submissionIntent = {
      idempotencyKey: `deep-${"ca".repeat(16)}`,
      createdAtMs: 1_000,
      candidates: [firstVault],
      candidateActions: { [firstVault.toLowerCase()]: 1 },
      executor: signer,
      batchHash: resultBatchHash,
      gas: "1000000",
      maxFeePerGas: "10000000000",
      maxPriorityFeePerGas: "1000000000",
      maximumTransactionCostWei: "1000000000000000",
      perVaultReservedWei: {
        [firstVault.toLowerCase()]: "1000000000000000",
      },
      perVaultEstimatedGas: {
        [firstVault.toLowerCase()]: "1000000",
      },
      reservationPolicy: "batch-envelope-v1",
      subsidyCapWeiAtSubmission: config.vaultSubsidyCapWei.toString(),
    };

    expect(() => migrateKeeperState(state, config)).toThrow(
      "does not match its gas envelope",
    );
  });

  it("attributes an exact batch cost proportionally with deterministic remainder handling", () => {
    const allocations = allocateWeiByWeight(11n, [firstVault, secondVault], {
      [firstVault.toLowerCase()]: "1",
      [secondVault.toLowerCase()]: "3",
    });

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
  it("rejects executor and automation runtime drift independently", async () => {
    for (const [field, expectedCode] of [
      ["executorCode", "COORDINATOR_MISMATCH"],
      ["automationCode", "AUTOMATION_MISMATCH"],
      ["executorAutomation", "AUTOMATION_MISMATCH"],
    ] as const) {
      const driftingReader = reader({
        [field]:
          field === "executorAutomation"
            ? "0x7777777777777777777777777777777777777777"
            : "0x6001",
      });
      await expect(
        runKeeperCycle({
          config: parseKeeperConfig(environment()),
          state: createInitialState(parseKeeperConfig(environment())),
          metrics: createMetrics(),
          readers: [driftingReader, driftingReader],
          nowMs: 100,
        }),
      ).rejects.toMatchObject({ code: expectedCode });
    }
  });

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
      gasEstimate: 3_600_000n,
      maxFeePerGas: 5_000_000_000n,
    });
    const second = reader({
      ready: work,
      registryCount: 4n,
      gasEstimate: 3_600_000n,
      maxFeePerGas: 5_000_000_000n,
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
    expect(result.state.vaultSubsidies[firstVault.toLowerCase()]).toMatchObject(
      {
        simulatedCostWei: "21600000000000000",
      },
    );
  });

  it.each([
    ["four-candidate executor", 4_000_001n, 4_800_002n],
    ["eight-candidate executor", 7_500_001n, 9_000_002n],
  ])(
    "rejects the reviewed %s envelope against a stale 4.5-million cap",
    async (_label, estimate, padded) => {
      const reviewed = parseKeeperConfig(
        environment({
          DEEP_KEEPER_MAX_BATCH_SIZE: "8",
          DEEP_KEEPER_SCAN_LIMIT: "8",
          DEEP_KEEPER_MAX_GAS: "9000000",
        }),
      );
      // The parser rejects this combination. This constrained copy also proves
      // the runtime gas check stays fail-closed if stale configuration bypasses it.
      const config = Object.freeze({
        ...reviewed,
        maxGas: 4_500_000n,
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
          maximum: "4500000",
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
    const wallet = {
      supportsStableIdempotency: true,
      writeContract: vi.fn(),
    };

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
    const wallet = {
      supportsStableIdempotency: true,
      writeContract: vi.fn(),
    };

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
      result.state.vaultSubsidies[firstVault.toLowerCase()].simulatedCostWei,
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
    expect(result.ready.map((item: Work) => item.vault)).toEqual([secondVault]);
    expect(result.skipped.map((item: Work) => item.vault)).toEqual([
      firstVault,
    ]);
    expect(first.simulateContract.mock.calls[0]![0].args).toEqual([
      [{ vault: secondVault, expectedAction: 2 }],
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
    const wallet = {
      supportsStableIdempotency: true,
      writeContract: vi.fn(),
    };

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

  it("rejects an enabled signer adapter without stable idempotency", async () => {
    const config = enabledKeeperConfig();
    const work = [{ vault: firstVault, action: 1 }];
    const wallet = { writeContract: vi.fn() };

    await expect(
      runKeeperCycle({
        config,
        state: createInitialState(config),
        metrics: createMetrics(),
        readers: [
          reader({ ready: work, registryCount: 1n }),
          reader({ ready: work, registryCount: 1n }),
        ],
        wallet,
        persistPendingState: vi.fn(async () => {}),
        nowMs: 4_500,
      }),
    ).rejects.toMatchObject({ code: "SIGNER_UNAVAILABLE" });
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("submits one bounded non-empty batch through the remote signer", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_ENABLED: "true",
        DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        DEEP_KEEPER_SIGNER_ADDRESS: signer,
        DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
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
      supportsStableIdempotency: true,
      writeContract: vi.fn(async (request: Record<string, unknown>) => {
        void request;
        return transactionHash;
      }),
    };

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [first, second],
      wallet,
      persistPendingState: vi.fn(async () => {}),
      nowMs: 5_000,
    });

    expect(result.outcome).toBe("submitted");
    expect(wallet.writeContract).toHaveBeenCalledOnce();
    expect(wallet.writeContract.mock.calls[0]![0].args).toEqual([
      [
        { vault: firstVault, expectedAction: 1 },
        { vault: secondVault, expectedAction: 2 },
      ],
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

  it("rejects a stale discovered action when the latest agreed state has drifted", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_ENABLED: "true",
        DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        DEEP_KEEPER_SIGNER_ADDRESS: signer,
        DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
      }),
    );
    const work = [{ vault: firstVault, action: 1 }];
    const latestActions = { [firstVault.toLowerCase()]: 2 };
    const first = reader({
      ready: work,
      registryCount: 1n,
      checkedActions: latestActions,
    });
    const second = reader({
      ready: work,
      registryCount: 1n,
      checkedActions: latestActions,
    });
    const wallet = {
      supportsStableIdempotency: true,
      writeContract: vi.fn(),
    };

    await expect(
      runKeeperCycle({
        config,
        state: createInitialState(config),
        metrics: createMetrics(),
        readers: [first, second],
        wallet,
        nowMs: 5_100,
      }),
    ).rejects.toMatchObject({ code: "PRE_BROADCAST_STATE_DRIFT" });
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("rejects a latest-state action disagreement between the two read RPCs", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_ENABLED: "true",
        DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        DEEP_KEEPER_SIGNER_ADDRESS: signer,
        DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
      }),
    );
    const work = [{ vault: firstVault, action: 1 }];
    const first = reader({
      ready: work,
      registryCount: 1n,
      checkedActions: { [firstVault.toLowerCase()]: 1 },
    });
    const second = reader({
      ready: work,
      registryCount: 1n,
      checkedActions: { [firstVault.toLowerCase()]: 2 },
    });
    const wallet = {
      supportsStableIdempotency: true,
      writeContract: vi.fn(),
    };
    const metrics = createMetrics();

    await expect(
      runKeeperCycle({
        config,
        state: createInitialState(config),
        metrics,
        readers: [first, second],
        wallet,
        nowMs: 5_150,
      }),
    ).rejects.toMatchObject({ code: "RPC_DISAGREEMENT" });
    expect(metrics.rpcDisagreements).toBe(1);
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("persists the exact intent before signing and the transaction hash after signing", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_ENABLED: "true",
        DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        DEEP_KEEPER_SIGNER_ADDRESS: signer,
        DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
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
      supportsStableIdempotency: true,
      writeContract: vi.fn(async () => {
        order.push("signed");
        return transactionHash;
      }),
    };
    const persistPendingState = vi.fn(
      async (pendingState: ReturnType<typeof createInitialState>) => {
        if (pendingState.submissionIntent) {
          expect(pendingState.pendingTransaction).toBeNull();
          expect(pendingState.submissionIntent.idempotencyKey).toMatch(
            /^deep-[0-9a-f]{32}$/,
          );
          order.push("intent-persisted");
          return;
        }
        expect(pendingState.pendingTransaction.hash).toBe(transactionHash);
        expect(
          pendingState.pendingTransaction.perVaultReservedWei[
            firstVault.toLowerCase()
          ],
        ).toBe("12000000000000000");
        order.push("pending-persisted");
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

    expect(order).toEqual([
      "intent-persisted",
      "signed",
      "pending-persisted",
    ]);
    expect(persistPendingState).toHaveBeenCalledTimes(2);
  });

  it("recovers a post-broadcast persistence crash with the exact Privy request", async () => {
    const config = enabledKeeperConfig();
    const work = [{ vault: firstVault, action: 1 }];
    const transactionHash = `0x${"5a".repeat(32)}`;
    const wallet = {
      supportsStableIdempotency: true,
      writeContract: vi.fn(
        async (_request: Record<string, unknown>) => transactionHash,
      ),
    };
    let durableState: ReturnType<typeof createInitialState> | null = null;
    let persistCalls = 0;
    const crashingPersistence = vi.fn(
      async (nextState: ReturnType<typeof createInitialState>) => {
        persistCalls += 1;
        if (persistCalls === 1) {
          durableState = structuredClone(nextState);
          return;
        }
        throw new Error("storage unavailable after broadcast");
      },
    );

    await expect(
      runKeeperCycle({
        config,
        state: createInitialState(config),
        metrics: createMetrics(),
        readers: [
          reader({ ready: work, registryCount: 1n }),
          reader({ ready: work, registryCount: 1n }),
        ],
        wallet,
        persistPendingState: crashingPersistence,
        nowMs: 5_275,
      }),
    ).rejects.toThrow("storage unavailable after broadcast");

    expect(durableState?.submissionIntent).not.toBeNull();
    expect(durableState?.pendingTransaction).toBeNull();
    const originalRequest = wallet.writeContract.mock.calls[0]![0];
    expect(originalRequest.idempotencyKey).toBe(
      durableState?.submissionIntent.idempotencyKey,
    );

    const recoveredPersistence = vi.fn(
      async (nextState: ReturnType<typeof createInitialState>) => {
        durableState = structuredClone(nextState);
      },
    );
    const recoveredReaders = [reader(), reader()];
    const recovered = await runKeeperCycle({
      config,
      state: durableState,
      metrics: createMetrics(),
      readers: recoveredReaders,
      wallet,
      persistPendingState: recoveredPersistence,
      nowMs: 5_500,
    });

    expect(recovered.outcome).toBe(
      "submission-recovered-awaiting-confirmation",
    );
    expect(recovered.state.submissionIntent).toBeNull();
    expect(recovered.state.pendingTransaction.hash).toBe(transactionHash);
    expect(recoveredPersistence).toHaveBeenCalledOnce();
    expect(wallet.writeContract).toHaveBeenCalledTimes(2);
    expect(wallet.writeContract.mock.calls[1]![0]).toEqual(originalRequest);
    expect(
      recoveredReaders.every(
        (client) =>
          client.readContract.mock.calls.length === 1 &&
          client.readContract.mock.calls[0]![0].functionName === "automation",
      ),
    ).toBe(true);
  });

  it.each([
    ["just before", -1, true],
    ["at", 0, true],
    ["after", 1, false],
  ])(
    "%s the 23-hour Privy replay boundary",
    async (_label, offsetMs, shouldReplay) => {
      const config = enabledKeeperConfig();
      const createdAtMs = 10_000;
      const state = createInitialState(config);
      state.submissionIntent = {
        idempotencyKey: `deep-${"cd".repeat(16)}`,
        createdAtMs,
        candidates: [firstVault],
        candidateActions: { [firstVault.toLowerCase()]: 1 },
        executor: signer,
        batchHash: resultBatchHash,
        gas: "1000000",
        maxFeePerGas: "10000000000",
        maxPriorityFeePerGas: "1000000000",
        maximumTransactionCostWei: "10000000000000000",
        perVaultReservedWei: {
          [firstVault.toLowerCase()]: "10000000000000000",
        },
        perVaultEstimatedGas: {
          [firstVault.toLowerCase()]: "1000000",
        },
        reservationPolicy: "batch-envelope-v1",
        subsidyCapWeiAtSubmission: config.vaultSubsidyCapWei.toString(),
      };
      const wallet = {
        supportsStableIdempotency: true,
        writeContract: vi.fn(async () => `0x${"5b".repeat(32)}`),
      };
      const persistPendingState = vi.fn(async () => {});
      const metrics = createMetrics();

      const result = await runKeeperCycle({
        config,
        state,
        metrics,
        readers: [reader(), reader()],
        wallet,
        persistPendingState,
        nowMs:
          createdAtMs + PRIVY_IDEMPOTENCY_REPLAY_WINDOW_MS + offsetMs,
      });

      if (shouldReplay) {
        expect(result.outcome).toBe(
          "submission-recovered-awaiting-confirmation",
        );
        expect(wallet.writeContract).toHaveBeenCalledOnce();
        expect(result.state.submissionIntent).toBeNull();
        expect(result.state.pendingTransaction).not.toBeNull();
        expect(persistPendingState).toHaveBeenCalledOnce();
        expect(metrics.staleSubmissionIntent).toBe(0);
      } else {
        expect(result.outcome).toBe(
          "submission-intent-manual-recovery-required",
        );
        expect(wallet.writeContract).not.toHaveBeenCalled();
        expect(result.state.submissionIntent).not.toBeNull();
        expect(result.state.pendingTransaction).toBeNull();
        expect(persistPendingState).not.toHaveBeenCalled();
        expect(metrics.staleSubmissionIntent).toBe(1);
      }
    },
  );

  it.each([
    [
      "batch size",
      {
        DEEP_KEEPER_MAX_BATCH_SIZE: "1",
        DEEP_KEEPER_SCAN_LIMIT: "1",
      },
      "batch",
    ],
    ["gas ceiling", {}, "gas"],
    [
      "fee ceiling",
      { DEEP_KEEPER_MAX_FEE_PER_GAS_WEI: "1000000000" },
      "fee",
    ],
    [
      "lowered subsidy cap",
      { DEEP_KEEPER_VAULT_SUBSIDY_CAP_WEI: "5000000000000000" },
      "cap",
    ],
  ])(
    "holds an unbroadcast intent for manual recovery after a %s policy change",
    async (_label, configOverrides, mutation) => {
      const config = parseKeeperConfig(
        environment({
          DEEP_KEEPER_ENABLED: "true",
          DEEP_KEEPER_SEND_TRANSACTIONS: "true",
          DEEP_KEEPER_SIGNER_ADDRESS: signer,
          DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
          ...configOverrides,
        }),
      );
      const state = createInitialState(config);
      const candidates =
        mutation === "batch" ? [firstVault, secondVault] : [firstVault];
      const gas =
        mutation === "gas" ? config.maxGas + 1n : 1_000_000n;
      const maxFeePerGas =
        mutation === "fee"
          ? config.maxFeePerGasWei + 1n
          : mutation === "gas"
            ? 1_000_000_000n
            : 10_000_000_000n;
      const maximumCost = gas * maxFeePerGas;
      const persistedCap =
        mutation === "cap"
          ? 30_000_000_000_000_000n
          : config.vaultSubsidyCapWei;
      state.submissionIntent = {
        idempotencyKey: `deep-${"ce".repeat(16)}`,
        createdAtMs: 10_000,
        candidates,
        candidateActions: Object.fromEntries(
          candidates.map((candidate, index) => [
            candidate.toLowerCase(),
            index + 1,
          ]),
        ),
        executor: signer,
        batchHash: resultBatchHash,
        gas: gas.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: "1000000000",
        maximumTransactionCostWei: maximumCost.toString(),
        perVaultReservedWei: Object.fromEntries(
          candidates.map((candidate) => [
            candidate.toLowerCase(),
            maximumCost.toString(),
          ]),
        ),
        perVaultEstimatedGas: Object.fromEntries(
          candidates.map((candidate) => [
            candidate.toLowerCase(),
            gas.toString(),
          ]),
        ),
        reservationPolicy: "batch-envelope-v1",
        subsidyCapWeiAtSubmission: persistedCap.toString(),
      };
      const wallet = {
        supportsStableIdempotency: true,
        writeContract: vi.fn(),
      };
      const metrics = createMetrics();

      const result = await runKeeperCycle({
        config,
        state,
        metrics,
        readers: [reader(), reader()],
        wallet,
        persistPendingState: vi.fn(async () => {}),
        nowMs: 20_000,
      });

      expect(result.outcome).toBe(
        "submission-intent-policy-manual-recovery-required",
      );
      expect(result.state.submissionIntent).not.toBeNull();
      expect(result.state.pendingTransaction).toBeNull();
      expect(wallet.writeContract).not.toHaveBeenCalled();
      expect(metrics.submissionIntentPolicyBlocked).toBe(1);
    },
  );

  it.each([
    ["overfunded", 500_000_000_000_000_001n],
    ["underfunded", 1n],
  ])(
    "holds an intent when the signer is %s under the current balance policy",
    async (_label, balance) => {
      const config = enabledKeeperConfig();
      const state = createInitialState(config);
      state.submissionIntent = {
        idempotencyKey: `deep-${"cf".repeat(16)}`,
        createdAtMs: 10_000,
        candidates: [firstVault],
        candidateActions: { [firstVault.toLowerCase()]: 1 },
        executor: signer,
        batchHash: resultBatchHash,
        gas: "1000000",
        maxFeePerGas: "10000000000",
        maxPriorityFeePerGas: "1000000000",
        maximumTransactionCostWei: "10000000000000000",
        perVaultReservedWei: {
          [firstVault.toLowerCase()]: "10000000000000000",
        },
        perVaultEstimatedGas: {
          [firstVault.toLowerCase()]: "1000000",
        },
        reservationPolicy: "batch-envelope-v1",
        subsidyCapWeiAtSubmission: config.vaultSubsidyCapWei.toString(),
      };
      const wallet = {
        supportsStableIdempotency: true,
        writeContract: vi.fn(),
      };
      const metrics = createMetrics();

      const result = await runKeeperCycle({
        config,
        state,
        metrics,
        readers: [reader({ balance }), reader({ balance })],
        wallet,
        persistPendingState: vi.fn(async () => {}),
        nowMs: 20_000,
      });

      expect(result.outcome).toBe(
        "submission-intent-policy-manual-recovery-required",
      );
      expect(result.state.submissionIntent).not.toBeNull();
      expect(wallet.writeContract).not.toHaveBeenCalled();
      expect(metrics.submissionIntentPolicyBlocked).toBe(1);
    },
  );

  it("rechecks replay signer balance at the latest agreed block", async () => {
    const config = enabledKeeperConfig();
    const state = createInitialState(config);
    state.submissionIntent = {
      idempotencyKey: `deep-${"c1".repeat(16)}`,
      createdAtMs: 10_000,
      candidates: [firstVault],
      candidateActions: { [firstVault.toLowerCase()]: 1 },
      executor: signer,
      batchHash: resultBatchHash,
      gas: "1000000",
      maxFeePerGas: "10000000000",
      maxPriorityFeePerGas: "1000000000",
      maximumTransactionCostWei: "10000000000000000",
      perVaultReservedWei: {
        [firstVault.toLowerCase()]: "10000000000000000",
      },
      perVaultEstimatedGas: {
        [firstVault.toLowerCase()]: "1000000",
      },
      reservationPolicy: "batch-envelope-v1",
      subsidyCapWeiAtSubmission: config.vaultSubsidyCapWei.toString(),
    };
    const latestOverfunded = (blockNumber: bigint) =>
      blockNumber === 100n
        ? config.maxSignerBalanceWei + 1n
        : 100_000_000_000_000_000n;
    const readers = [
      reader({ balance: latestOverfunded }),
      reader({ balance: latestOverfunded }),
    ];
    const wallet = {
      supportsStableIdempotency: true,
      writeContract: vi.fn(),
    };

    const result = await runKeeperCycle({
      config,
      state,
      metrics: createMetrics(),
      readers,
      wallet,
      persistPendingState: vi.fn(async () => {}),
      nowMs: 20_000,
    });

    expect(result.outcome).toBe(
      "submission-intent-policy-manual-recovery-required",
    );
    expect(wallet.writeContract).not.toHaveBeenCalled();
    for (const client of readers) {
      expect(client.getBalance).toHaveBeenCalledWith({
        address: signer,
        blockNumber: 100n,
      });
    }
  });

  it("cannot push a vault over its cap when actual gas stays inside the persisted batch envelope", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_ENABLED: "true",
        DEEP_KEEPER_SEND_TRANSACTIONS: "true",
        DEEP_KEEPER_SIGNER_ADDRESS: signer,
        DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
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
      wallet: {
        supportsStableIdempotency: true,
        writeContract: vi.fn(async () => transactionHash),
      },
      persistPendingState: vi.fn(async () => {}),
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
      logs: [
        candidateResultLog(firstVault, 1),
        candidateResultLog(secondVault, 2, { candidateIndex: 1 }),
      ],
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
        confirmed.state.vaultSubsidies[firstVault.toLowerCase()].actualCostWei,
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
        DEEP_KEEPER_PRIVY_WALLET_ID: "yks0kyukdaidxf043xqxgaki",
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
      supportsStableIdempotency: true,
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
    expect(first.readContract).toHaveBeenCalledOnce();
    expect(second.readContract).toHaveBeenCalledOnce();
    expect(first.readContract.mock.calls[0]![0].functionName).toBe(
      "automation",
    );
    expect(second.readContract.mock.calls[0]![0].functionName).toBe(
      "automation",
    );
  });

  it("keeps a receipt-less transaction pending beyond the timeout", async () => {
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

    expect(timedOut.outcome).toBe(
      "receipt-unknown-manual-recovery-required",
    );
    expect(timedOut.state.pendingTransaction.hash).toBe(
      `0x${"69".repeat(32)}`,
    );
    expect(metrics.transactionsDropped).toBe(0);
    expect(metrics.unknownReceiptPending).toBe(1);

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

    expect(retried.outcome).toBe(
      "receipt-unknown-manual-recovery-required",
    );
    expect(retried.state.pendingTransaction).not.toBeNull();
    expect(metrics.simulations).toBe(0);
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
      logs: [candidateResultLog(firstVault, 1)],
    };
    state.pendingTransaction = {
      hash: transactionHash,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      candidateActions: { [firstVault.toLowerCase()]: 1 },
      executor: signer,
      batchHash: resultBatchHash,
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

  it("reconciles an already-broadcast batch after maxBatchSize is lowered", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_MAX_BATCH_SIZE: "1",
        DEEP_KEEPER_SCAN_LIMIT: "1",
      }),
    );
    const state = createInitialState(config);
    const transactionHash = `0x${"79".repeat(32)}`;
    const blockNumber = 80n;
    state.pendingTransaction = {
      hash: transactionHash,
      submittedAtMs: 1_000,
      candidates: [firstVault, secondVault],
      candidateActions: {
        [firstVault.toLowerCase()]: 1,
        [secondVault.toLowerCase()]: 2,
      },
      executor: signer,
      batchHash: resultBatchHash,
      gas: "2000000",
      maxFeePerGas: "10000000000",
      perVaultEstimatedGas: {
        [firstVault.toLowerCase()]: "1",
        [secondVault.toLowerCase()]: "1",
      },
    };
    const receipt = {
      blockNumber,
      blockHash: hashFor(blockNumber),
      status: "success",
      transactionHash,
      gasUsed: 1_000_000n,
      effectiveGasPrice: 10_000_000_000n,
      logs: [
        candidateResultLog(firstVault, 1),
        candidateResultLog(secondVault, 2, { candidateIndex: 1 }),
      ],
    };

    const result = await runKeeperCycle({
      config,
      state,
      metrics: createMetrics(),
      readers: [reader({ receipt }), reader({ receipt })],
      nowMs: 2_000,
    });

    expect(result.outcome).toBe("idle");
    expect(result.state.pendingTransaction).toBeNull();
    expect(
      result.state.recentTransactions[0].perVaultActualCostWei,
    ).toEqual({
      [firstVault.toLowerCase()]: "5000000000000000",
      [secondVault.toLowerCase()]: "5000000000000000",
    });
  });

  it("clears a failed execution receipt and resumes discovery on the next cycle", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const transactionHash = `0x${"7a".repeat(32)}`;
    const blockNumber = 80n;
    const receipt = {
      blockNumber,
      blockHash: hashFor(blockNumber),
      status: "success",
      transactionHash,
      gasUsed: 500_000n,
      effectiveGasPrice: 5_000_000_000n,
      logs: [
        candidateResultLog(firstVault, 1, {
          outcome: 3,
          errorSelector: "0x12345678",
        }),
      ],
    };
    state.pendingTransaction = {
      hash: transactionHash,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      candidateActions: { [firstVault.toLowerCase()]: 1 },
      executor: signer,
      batchHash: resultBatchHash,
      gas: "1000000",
      maxFeePerGas: "10000000000",
    };
    const metrics = createMetrics();

    const reconciled = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [reader({ receipt }), reader({ receipt })],
      nowMs: 2_000,
    });

    expect(reconciled.outcome).toBe("executor-nonproductive-retry-next-cycle");
    expect(reconciled.state.pendingTransaction).toBeNull();
    expect(
      reconciled.state.vaultSubsidies[firstVault.toLowerCase()].actualCostWei,
    ).toBe("2500000000000000");
    expect(reconciled.state.recentTransactions[0]).toMatchObject({
      status: "executor-nonproductive",
      receiptStatus: "success",
      actualCostWei: "2500000000000000",
      sponsorAbsorbedCostWei: "2500000000000000",
      perVaultActualCostWei: {
        [firstVault.toLowerCase()]: "2500000000000000",
      },
    });
    expect(metrics.transactionsNonproductive).toBe(1);
    expect(metrics.sponsorAbsorbedCostWei).toBe("2500000000000000");

    const recovered = await runKeeperCycle({
      config,
      state: reconciled.state,
      metrics,
      readers: [reader(), reader()],
      nowMs: 3_000,
    });
    expect(recovered.outcome).toBe("idle");
  });

  it.each([
    ["none", 0, 0],
    ["action drift", 1, 2],
    ["assessment failure", 2, 0],
  ])(
    "records an authentic %s result against the durable subsidy cap",
    async (_label, outcome, actualAction) => {
      const config = parseKeeperConfig(environment());
      const state = createInitialState(config);
      const transactionHash = `0x${"7d".repeat(32)}`;
      const blockNumber = 80n;
      const receipt = {
        blockNumber,
        blockHash: hashFor(blockNumber),
        status: "success",
        transactionHash,
        gasUsed: 500_000n,
        effectiveGasPrice: 5_000_000_000n,
        logs: [
          candidateResultLog(firstVault, 1, {
            outcome,
            actualAction,
          }),
        ],
      };
      state.pendingTransaction = {
        hash: transactionHash,
        submittedAtMs: 1_000,
        candidates: [firstVault],
        candidateActions: { [firstVault.toLowerCase()]: 1 },
        executor: signer,
        batchHash: resultBatchHash,
        gas: "1000000",
        maxFeePerGas: "10000000000",
      };

      const metrics = createMetrics();
      const reconciled = await runKeeperCycle({
        config,
        state,
        metrics,
        readers: [reader({ receipt }), reader({ receipt })],
        nowMs: 2_000,
      });

      expect(reconciled.outcome).toBe(
        "executor-nonproductive-retry-next-cycle",
      );
      expect(reconciled.state.pendingTransaction).toBeNull();
      expect(
        reconciled.state.vaultSubsidies[firstVault.toLowerCase()].actualCostWei,
      ).toBe("2500000000000000");
      expect(
        reconciled.state.recentTransactions[0].candidateResults[0].outcome,
      ).toBe(outcome);
      expect(metrics.subsidyActualCostWei).toBe("2500000000000000");

      const recovered = await runKeeperCycle({
        config,
        state: reconciled.state,
        metrics,
        readers: [reader(), reader()],
        nowMs: 3_000,
      });
      expect(recovered.outcome).toBe("idle");
    },
  );

  it("exhausts the durable cap after repeated authentic drift receipts", async () => {
    const config = parseKeeperConfig(
      environment({
        DEEP_KEEPER_VAULT_SUBSIDY_CAP_WEI: "5000000000000000",
      }),
    );
    const metrics = createMetrics();
    let state = createInitialState(config);

    for (const [index, transactionHash] of [
      [0, `0x${"8a".repeat(32)}`],
      [1, `0x${"8b".repeat(32)}`],
    ] as const) {
      const blockNumber = 80n + BigInt(index);
      state.pendingTransaction = {
        hash: transactionHash,
        submittedAtMs: 1_000 + index,
        candidates: [firstVault],
        candidateActions: { [firstVault.toLowerCase()]: 1 },
        executor: signer,
        batchHash: resultBatchHash,
        gas: "500000",
        maxFeePerGas: "5000000000",
      };
      const receipt = {
        blockNumber,
        blockHash: hashFor(blockNumber),
        status: "success",
        transactionHash,
        gasUsed: 500_000n,
        effectiveGasPrice: 5_000_000_000n,
        logs: [
          candidateResultLog(firstVault, 1, {
            outcome: 1,
            actualAction: 2,
          }),
        ],
      };

      const reconciled = await runKeeperCycle({
        config,
        state,
        metrics,
        readers: [reader({ receipt }), reader({ receipt })],
        nowMs: 2_000 + index,
      });
      expect(reconciled.outcome).toBe(
        "executor-nonproductive-retry-next-cycle",
      );
      state = reconciled.state;
    }

    expect(state.vaultSubsidies[firstVault.toLowerCase()].actualCostWei).toBe(
      config.vaultSubsidyCapWei.toString(),
    );
    const exhausted = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [
        reader({
          ready: [{ vault: firstVault, action: 1 }],
          registryCount: 1n,
        }),
        reader({
          ready: [{ vault: firstVault, action: 1 }],
          registryCount: 1n,
        }),
      ],
      nowMs: 4_000,
    });
    expect(exhausted.outcome).toBe("subsidy-budget-exhausted");
    expect(exhausted.ready).toEqual([]);
  });

  it("allocates a mixed success and drift receipt to every candidate", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const metrics = createMetrics();
    const transactionHash = `0x${"8c".repeat(32)}`;
    const blockNumber = 80n;
    state.pendingTransaction = {
      hash: transactionHash,
      submittedAtMs: 1_000,
      candidates: [firstVault, secondVault],
      candidateActions: {
        [firstVault.toLowerCase()]: 1,
        [secondVault.toLowerCase()]: 2,
      },
      executor: signer,
      batchHash: resultBatchHash,
      gas: "2000000",
      maxFeePerGas: "10000000000",
      perVaultEstimatedGas: {
        [firstVault.toLowerCase()]: "1",
        [secondVault.toLowerCase()]: "3",
      },
    };
    const receipt = {
      blockNumber,
      blockHash: hashFor(blockNumber),
      status: "success",
      transactionHash,
      gasUsed: 1_000_000n,
      effectiveGasPrice: 10_000_000_000n,
      logs: [
        candidateResultLog(firstVault, 1),
        candidateResultLog(secondVault, 2, {
          candidateIndex: 1,
          actualAction: 1,
          outcome: 1,
        }),
      ],
    };

    const reconciled = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [reader({ receipt }), reader({ receipt })],
      nowMs: 2_000,
    });

    expect(reconciled.outcome).toBe("executor-nonproductive-retry-next-cycle");
    expect(
      reconciled.state.vaultSubsidies[firstVault.toLowerCase()].actualCostWei,
    ).toBe("2500000000000000");
    expect(
      reconciled.state.vaultSubsidies[secondVault.toLowerCase()].actualCostWei,
    ).toBe("7500000000000000");
    expect(
      reconciled.state.recentTransactions[0].perVaultActualCostWei,
    ).toEqual({
      [firstVault.toLowerCase()]: "2500000000000000",
      [secondVault.toLowerCase()]: "7500000000000000",
    });
    expect(reconciled.state.recentTransactions[0].sponsorAbsorbedCostWei).toBe(
      "7500000000000000",
    );
    expect(metrics.subsidyActualCostWei).toBe("10000000000000000");
    expect(metrics.sponsorAbsorbedCostWei).toBe("7500000000000000");
  });

  it("rejects duplicate executor results", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const transactionHash = `0x${"7e".repeat(32)}`;
    const blockNumber = 80n;
    const result = candidateResultLog(firstVault, 1);
    const receipt = {
      blockNumber,
      blockHash: hashFor(blockNumber),
      status: "success",
      transactionHash,
      gasUsed: 500_000n,
      effectiveGasPrice: 5_000_000_000n,
      logs: [result, result],
    };
    state.pendingTransaction = {
      hash: transactionHash,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      candidateActions: { [firstVault.toLowerCase()]: 1 },
      executor: signer,
      batchHash: resultBatchHash,
      gas: "1000000",
      maxFeePerGas: "10000000000",
    };

    await expect(
      runKeeperCycle({
        config,
        state,
        metrics: createMetrics(),
        readers: [reader({ receipt }), reader({ receipt })],
        nowMs: 2_000,
      }),
    ).rejects.toMatchObject({ code: "WORK_RECEIPT_REJECTED" });
    expect(state.vaultSubsidies).toEqual({});
  });

  it("rejects a CandidateResult emitted for another signer", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const transactionHash = `0x${"7f".repeat(32)}`;
    const blockNumber = 80n;
    const receipt = {
      blockNumber,
      blockHash: hashFor(blockNumber),
      status: "success",
      transactionHash,
      gasUsed: 500_000n,
      effectiveGasPrice: 5_000_000_000n,
      logs: [
        candidateResultLog(firstVault, 1, {
          executor: "0x7777777777777777777777777777777777777777",
        }),
      ],
    };
    state.pendingTransaction = {
      hash: transactionHash,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      candidateActions: { [firstVault.toLowerCase()]: 1 },
      executor: signer,
      batchHash: resultBatchHash,
      gas: "1000000",
      maxFeePerGas: "10000000000",
    };

    await expect(
      runKeeperCycle({
        config,
        state,
        metrics: createMetrics(),
        readers: [reader({ receipt }), reader({ receipt })],
        nowMs: 2_000,
      }),
    ).rejects.toMatchObject({ code: "WORK_RECEIPT_REJECTED" });
  });

  it("fails closed without charging a vault when work receipt logs are missing", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const transactionHash = `0x${"7b".repeat(32)}`;
    const blockNumber = 80n;
    const receipt = {
      blockNumber,
      blockHash: hashFor(blockNumber),
      status: "success",
      transactionHash,
      gasUsed: 500_000n,
      effectiveGasPrice: 5_000_000_000n,
      logs: [],
    };
    state.pendingTransaction = {
      hash: transactionHash,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      candidateActions: { [firstVault.toLowerCase()]: 1 },
      executor: signer,
      batchHash: resultBatchHash,
      gas: "1000000",
      maxFeePerGas: "10000000000",
    };
    const metrics = createMetrics();

    await expect(
      runKeeperCycle({
        config,
        state,
        metrics,
        readers: [reader({ receipt }), reader({ receipt })],
        nowMs: 2_000,
      }),
    ).rejects.toMatchObject({ code: "WORK_RECEIPT_REJECTED" });
    expect(state.vaultSubsidies).toEqual({});
  });

  it("fails closed without charging a vault when a work receipt action is mismatched", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    const transactionHash = `0x${"7c".repeat(32)}`;
    const blockNumber = 80n;
    const receipt = {
      blockNumber,
      blockHash: hashFor(blockNumber),
      status: "success",
      transactionHash,
      gasUsed: 500_000n,
      effectiveGasPrice: 5_000_000_000n,
      logs: [candidateResultLog(firstVault, 1, { actualAction: 2 })],
    };
    state.pendingTransaction = {
      hash: transactionHash,
      submittedAtMs: 1_000,
      candidates: [firstVault],
      candidateActions: { [firstVault.toLowerCase()]: 1 },
      executor: signer,
      batchHash: resultBatchHash,
      gas: "1000000",
      maxFeePerGas: "10000000000",
    };
    const metrics = createMetrics();

    await expect(
      runKeeperCycle({
        config,
        state,
        metrics,
        readers: [reader({ receipt }), reader({ receipt })],
        nowMs: 2_000,
      }),
    ).rejects.toMatchObject({ code: "WORK_RECEIPT_REJECTED" });
    expect(state.vaultSubsidies).toEqual({});
  });

  it("allocates top-level revert gas deterministically against every vault cap", async () => {
    const config = parseKeeperConfig(environment());
    const state = createInitialState(config);
    state.vaultSubsidies[firstVault.toLowerCase()] = {
      simulatedCostWei: "0",
      actualCostWei: "29500000000000000",
      transactionCount: 1,
      lastUpdatedAtMs: 1,
    };
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
      candidates: [firstVault, secondVault],
      gas: "1000000",
      maxFeePerGas: "10000000000",
      perVaultEstimatedGas: {
        [firstVault.toLowerCase()]: "1",
        [secondVault.toLowerCase()]: "3",
      },
    };
    const metrics = createMetrics();

    const result = await runKeeperCycle({
      config,
      state,
      metrics,
      readers: [reader({ receipt }), reader({ receipt })],
      nowMs: 2_000,
    });

    expect(result.outcome).toBe("transaction-reverted-retry-next-cycle");
    expect(
      result.state.vaultSubsidies[firstVault.toLowerCase()].actualCostWei,
    ).toBe(config.vaultSubsidyCapWei.toString());
    expect(
      result.state.vaultSubsidies[secondVault.toLowerCase()].actualCostWei,
    ).toBe("1500000000000000");
    expect(result.state.recentTransactions[0].perVaultActualCostWei).toEqual(
      {
        [firstVault.toLowerCase()]: "500000000000000",
        [secondVault.toLowerCase()]: "1500000000000000",
      },
    );
    expect(metrics.transactionsReverted).toBe(1);
    expect(metrics.subsidyActualCostWei).toBe("2000000000000000");
    expect(metrics.sponsorAbsorbedCostWei).toBe("2000000000000000");
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
    metrics.transactionsNonproductive = 2;
    metrics.sponsorAbsorbedCostWei = "19";
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
    expect(output).toContain("deep_keeper_transactions_nonproductive_total 2");
    expect(output).toContain("deep_keeper_sponsor_absorbed_wei_total 19");
    expect(output).toContain("deep_keeper_pending_transaction 1");
    expect(output).toContain(
      "deep_keeper_vault_subsidy_cap_wei 30000000000000000",
    );
    expect(output).toContain("deep_keeper_vault_subsidy_skipped_total 4");
    expect(output).toContain("deep_keeper_vault_subsidy_durable_actual_wei 7");
  });
});
