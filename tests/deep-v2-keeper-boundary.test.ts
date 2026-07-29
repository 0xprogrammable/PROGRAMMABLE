import { describe, expect, it, vi } from "vitest";

import {
  DEEP_V2_KEEPER_INTERVAL_MS,
  DEEP_V2_RELEASE_MANIFEST_PATH,
  parseDeepV2KeeperConfig,
} from "../ops/deep-keeper-v2/config.mjs";
import {
  createDeepV2BoundaryState,
  runDeepV2KeeperBoundary,
  validateDeepV2BoundaryState,
  type DeepV2InnerCycleInput,
  type DeepV2InnerCycleResult,
} from "../ops/deep-keeper-v2/core.mjs";
import {
  evaluateDeepV2KeeperReleaseGate,
} from "../ops/deep-keeper-v2/release-gate.mjs";

const automation = "0x1111111111111111111111111111111111111111";
const coordinator = "0x2222222222222222222222222222222222222222";
const signer = "0x3333333333333333333333333333333333333333";
const canary = "0x4444444444444444444444444444444444444444";
const hash = (byte: string) => `0x${byte.repeat(64)}`;
const tx = hash("a");

function readyEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    DEEP_V2_KEEPER_ENABLED: "true",
    DEEP_V2_KEEPER_SEND_TRANSACTIONS: "true",
    DEEP_V2_KEEPER_CHAIN_ID: "1",
    DEEP_V2_KEEPER_AUTOMATION_ADDRESS: automation,
    DEEP_V2_KEEPER_AUTOMATION_RUNTIME_HASH: hash("1"),
    DEEP_V2_KEEPER_COORDINATOR_ADDRESS: coordinator,
    DEEP_V2_KEEPER_COORDINATOR_RUNTIME_HASH: hash("2"),
    DEEP_V2_KEEPER_COORDINATOR_SOURCE_COMMITMENT: hash("3"),
    DEEP_V2_KEEPER_RPC_URLS:
      "https://rpc-a.example/,https://rpc-b.example/",
    DEEP_V2_KEEPER_SIGNER_ADDRESS: signer,
    DEEP_V2_KEEPER_PRIVY_WALLET_ID: "abcdefghijklmnopqrstuvwx",
    DEEP_V2_KEEPER_INTERVAL_MS: "300000",
    DEEP_V2_KEEPER_RELEASE_MANIFEST: DEEP_V2_RELEASE_MANIFEST_PATH,
    DEEP_V2_KEEPER_MAX_BATCH_SIZE: "4",
    DEEP_V2_KEEPER_SCAN_LIMIT: "4",
    DEEP_V2_KEEPER_MAX_GAS: "4500000",
    ...overrides,
  };
}

function readyBinding() {
  return {
    schemaVersion: 1,
    status: "reviewed",
    manifestPath: DEEP_V2_RELEASE_MANIFEST_PATH,
    model: "deep",
    releaseVersion: "deep-full-range-v2",
    internalContractRelease: "liquidity-growth-full-range-v2",
    sourceCommitment: hash("4"),
    automationAddress: automation,
    automationRuntimeCodeHash: hash("1"),
    automationFqcn:
      "src/LiquidityGrowthFullRangeAutomationV2.sol:LiquidityGrowthFullRangeAutomationV2",
    coordinatorAddress: coordinator,
    coordinatorRuntimeCodeHash: hash("2"),
    coordinatorSourceCommitment: hash("3"),
    coordinatorFqcn: "src/DeepKeeperExecutorV1.sol:DeepKeeperExecutorV1",
  };
}

function exactSourceRecord(
  fqcn: string,
  address: string,
  constructorArguments: string[],
) {
  const checksumAddress =
    address === automation
      ? "0x1111111111111111111111111111111111111111"
      : "0x2222222222222222222222222222222222222222";
  return {
    fqcn,
    deploymentKind: "CREATE",
    constructorTypes: constructorArguments.map(() => "address"),
    constructorArguments,
    encodedConstructorArguments:
      constructorArguments.length === 0
        ? "0x"
        : `0x${constructorArguments
            .map((value) => value.toLowerCase().slice(2).padStart(64, "0"))
            .join("")}`,
    etherscan: {
      status: "exact-match",
      url: `https://etherscan.io/address/${checksumAddress}#code`,
    },
    sourcify: {
      status: "exact-match",
      url: `https://repo.sourcify.dev/contracts/full_match/1/${checksumAddress}/`,
    },
  };
}

function readyRelease() {
  const binding = readyBinding();
  return {
    schemaVersion: 2,
    model: "deep",
    internalContractRelease: binding.internalContractRelease,
    releaseVersion: binding.releaseVersion,
    releaseManifest: DEEP_V2_RELEASE_MANIFEST_PATH,
    keeperReleaseVersion: "deep-keeper-v2",
    keeperCompatibilityStatus: "verified-deep-v2",
    status: "deployment-source-and-lifecycle-verified",
    releaseEligible: true,
    chainId: 1,
    releaseCommit: "a".repeat(40),
    sourceCommitment: binding.sourceCommitment,
    startBlock: 25_000_000,
    addresses: {
      automation,
      growthVaultFactory:
        "0x5555555555555555555555555555555555555555",
      launcher: "0x6666666666666666666666666666666666666666",
    },
    runtimeCodeHashes: {
      automation: binding.automationRuntimeCodeHash,
    },
    transactions: {
      automation: tx,
    },
    deploymentBlocks: {
      automation: 25_000_001,
    },
    deploymentEvidence: {
      automation: {
        transactionHash: tx,
        blockNumber: 25_000_001,
        receiptStatus: "success",
      },
    },
    sourceVerification: {
      status: "verified",
      contracts: {
        automation: exactSourceRecord(
          binding.automationFqcn,
          automation,
          [
            "0x5555555555555555555555555555555555555555",
            "0x6666666666666666666666666666666666666666",
          ],
        ),
        keeperExecutor: exactSourceRecord(
          binding.coordinatorFqcn,
          coordinator,
          [automation],
        ),
      },
    },
    lifecycleEvidence: {
      status: "verified-current-release",
      releaseEligible: true,
      requiredRelease: binding.releaseVersion,
      independentRpcCount: 2,
      canaryToken: canary,
      launchTransaction: hash("5"),
      oracleTransaction: hash("6"),
      feeProcessCompoundTransaction: hash("7"),
      keeperExecutor: coordinator,
      keeperExecutorRuntimeCodeHash: binding.coordinatorRuntimeCodeHash,
      keeperExecutorDeploymentTransaction: hash("8"),
      keeperExecutorDeploymentBlock: 25_000_002,
      noActionKeeperCycle: {
        status: "verified-no-transaction",
        outcome: "idle",
        readyVaults: 0,
        submittedTransaction: false,
        observedAtBlock: 25_000_003,
        evidenceHash: hash("9"),
      },
      actionableKeeperCycle: {
        status: "verified-compound-confirmed",
        outcome: "confirmed-productive",
        readyVaults: 1,
        successfulCandidates: 1,
        transactionHash: hash("7"),
        blockNumber: 25_000_004,
        evidenceHash: hash("c"),
      },
      evidenceHash: hash("d"),
    },
    keeperPolicy: {
      status: "verified-ready-disabled-by-default",
      enabled: false,
      transactionSubmission: false,
      coordinator,
      coordinatorRuntimeCodeHash: binding.coordinatorRuntimeCodeHash,
      coordinatorSourceCommitment: binding.coordinatorSourceCommitment,
      automation,
      automationRuntimeCodeHash: binding.automationRuntimeCodeHash,
      signerAddress: signer,
      signingBackend: "privy-policy-wallet",
      executionPath: "/api/ops/deep-v2-keeper",
      confirmations: 12,
      independentReadRpcCount: 2,
      intervalMilliseconds: 300_000,
      defaultMaxBatchSize: 4,
      defaultMaxGas: "4500000",
      maximumOperationalBatchSize: 8,
      extendedBatchMinimumGas: "9000000",
      vaultSubsidyCapWei: "30000000000000000",
    },
    fixedPolicy: {
      tokenSupplyWei: "1000000000000000000000000000",
      tokenReserveTargetWei: "150000000000000000000000000",
      growthTargetNativeWei: "50000000000000000",
      totalSwapFeeBps: 100,
      creatorFeeBps: 90,
      programmableFeeBps: 10,
      minimumInitialBuyWei: "600000000000000",
      initialTick: 204200,
      tickSpacing: 200,
      lpFeePips: 0,
      twapWindowSeconds: 1800,
      oracleRangeHalfWidthTicks: 20000,
      maximumSpotTwapDeviationTicks: 600,
      maximumAbsoluteTickDelta: 400,
      compoundCooldownSeconds: 300,
      rollingExposureWindowSeconds: 1800,
      rollingExposureRecordCapacity: 8,
      minimumKeeperProcessNativeWei: "2000000000000000",
      oracleObservationCardinalityTarget: 192,
    },
    activation: {
      appStatus: "ready",
      keeperStatus: "ready",
      requiresExactManifestMatch: true,
    },
    blockers: [],
  };
}

describe("Deep V2 keeper configuration", () => {
  it("pins Mainnet, two independent RPCs, the exact manifest and five minutes", () => {
    const config = parseDeepV2KeeperConfig(readyEnv());

    expect(config.chainId).toBe(1);
    expect(config.rpcUrls).toEqual([
      "https://rpc-a.example/",
      "https://rpc-b.example/",
    ]);
    expect(config.releaseManifest).toBe(DEEP_V2_RELEASE_MANIFEST_PATH);
    expect(config.intervalMs).toBe(DEEP_V2_KEEPER_INTERVAL_MS);
  });

  it.each(["299999", "300001"])(
    "rejects a non-five-minute interval of %s ms",
    (interval) => {
      expect(() =>
        parseDeepV2KeeperConfig(
          readyEnv({ DEEP_V2_KEEPER_INTERVAL_MS: interval }),
        ),
      ).toThrow(/exactly 300000/);
    },
  );

  it("rejects a private key, one RPC and a cross-wired V1 manifest", () => {
    expect(() =>
      parseDeepV2KeeperConfig(readyEnv({ PRIVATE_KEY: "secret" })),
    ).toThrow(/not accepted/);
    expect(() =>
      parseDeepV2KeeperConfig(
        readyEnv({ DEEP_V2_KEEPER_RPC_URLS: "https://rpc-a.example/" }),
      ),
    ).toThrow(/two distinct HTTPS/);
    expect(() =>
      parseDeepV2KeeperConfig(
        readyEnv({
          DEEP_V2_KEEPER_RPC_URLS:
            "https://rpc.example/a,https://rpc.example/b",
        }),
      ),
    ).toThrow(/independent RPC hosts/);
    expect(() =>
      parseDeepV2KeeperConfig(
        readyEnv({
          DEEP_V2_KEEPER_RELEASE_MANIFEST:
            "contracts/deployments/mainnet-deep-full-range-v1.json",
        }),
      ),
    ).toThrow(/mainnet-deep-full-range-v2/);
  });

  it("fails closed when activation or any deployment binding is missing", () => {
    expect(() =>
      parseDeepV2KeeperConfig(
        readyEnv({ DEEP_V2_KEEPER_SEND_TRANSACTIONS: "false" }),
      ),
    ).toThrow(/Activation requires both/);

    for (const key of [
      "DEEP_V2_KEEPER_AUTOMATION_ADDRESS",
      "DEEP_V2_KEEPER_AUTOMATION_RUNTIME_HASH",
      "DEEP_V2_KEEPER_COORDINATOR_ADDRESS",
      "DEEP_V2_KEEPER_COORDINATOR_RUNTIME_HASH",
      "DEEP_V2_KEEPER_COORDINATOR_SOURCE_COMMITMENT",
      "DEEP_V2_KEEPER_SIGNER_ADDRESS",
      "DEEP_V2_KEEPER_PRIVY_WALLET_ID",
    ]) {
      expect(() =>
        parseDeepV2KeeperConfig(readyEnv({ [key]: undefined })),
      ).toThrow();
    }
  });
});

describe("Deep V2 exact release gate", () => {
  it("accepts only the reviewed V2 binding and complete lifecycle evidence", () => {
    const gate = evaluateDeepV2KeeperReleaseGate(
      readyRelease(),
      parseDeepV2KeeperConfig(readyEnv()),
      readyBinding(),
    );

    expect(gate).toMatchObject({
      ready: true,
      reasons: [],
      releaseVersion: "deep-full-range-v2",
    });
  });

  it("fails closed for a pending binding or missing harmless-idle proof", () => {
    const config = parseDeepV2KeeperConfig(readyEnv());
    const pending = { ...readyBinding(), status: "pending-deployment" };
    expect(
      evaluateDeepV2KeeperReleaseGate(readyRelease(), config, pending).ready,
    ).toBe(false);

    const release = readyRelease();
    delete (release.lifecycleEvidence as Record<string, unknown>)
      .noActionKeeperCycle;
    const gate = evaluateDeepV2KeeperReleaseGate(
      release,
      config,
      readyBinding(),
    );
    expect(gate.ready).toBe(false);
    expect(gate.reasons).toContain("no-action keeper evidence");
  });

  it("keeps the checked-in binding disabled before real deployments exist", async () => {
    const pending = (
      await import(
        "../ops/deep-keeper-v2/reviewed-release-binding.json"
      )
    ).default;
    const gate = evaluateDeepV2KeeperReleaseGate(
      readyRelease(),
      parseDeepV2KeeperConfig(readyEnv()),
      pending,
    );

    expect(gate.ready).toBe(false);
    expect(gate.reasons).toContain("reviewed V2 release binding");
  });

  it("rejects address, runtime, chain and cron drift independently", () => {
    const config = parseDeepV2KeeperConfig(readyEnv());
    for (const mutate of [
      (release: ReturnType<typeof readyRelease>) => {
        release.chainId = 10;
      },
      (release: ReturnType<typeof readyRelease>) => {
        release.addresses.automation =
          "0x5555555555555555555555555555555555555555";
      },
      (release: ReturnType<typeof readyRelease>) => {
        release.runtimeCodeHashes.automation = hash("f");
      },
      (release: ReturnType<typeof readyRelease>) => {
        release.keeperPolicy.intervalMilliseconds = 60_000;
      },
      (release: ReturnType<typeof readyRelease>) => {
        release.fixedPolicy.compoundCooldownSeconds = 1_800;
      },
    ]) {
      const release = readyRelease();
      mutate(release);
      expect(
        evaluateDeepV2KeeperReleaseGate(
          release,
          config,
          readyBinding(),
        ).ready,
      ).toBe(false);
    }
  });
});

describe("Deep V2 keeper cycle boundary", () => {
  const config = () => parseDeepV2KeeperConfig(readyEnv());
  const lease = {
    ownerId: "cycle-a",
    generation: 7,
    fencingToken: "fence-a",
    acquiredAtMs: 600_000,
    expiresAtMs: 690_000,
    etag: "etag-7",
  };

  it("persists an idle five-minute slot without asking the wallet to sign", async () => {
    const parsed = config();
    const wallet = {
      supportsStableIdempotency: true as const,
      writeContract: vi.fn(),
    };
    const persistBoundaryState = vi.fn().mockResolvedValue(true);
    const runCycle = vi.fn().mockResolvedValue({
      state: { marker: "keeper-state" },
      outcome: "idle",
      confirmedBlock: { number: 100n, hash: hash("a") },
      registryCount: 0n,
      ready: [],
    });

    const result = await runDeepV2KeeperBoundary({
      config: parsed,
      boundaryState: createDeepV2BoundaryState(parsed),
      lease,
      assertLease: vi.fn().mockResolvedValue(true),
      persistBoundaryState,
      runCycle,
      readers: [{}, {}],
      wallet,
      metrics: {},
      nowMs: 610_000,
    });

    expect(result.outcome).toBe("idle");
    expect(result.boundaryState.lastCompletedSlot).toBe(2);
    expect(result.boundaryState.fencingGeneration).toBe(7);
    expect(wallet.writeContract).not.toHaveBeenCalled();
    expect(persistBoundaryState).toHaveBeenCalledTimes(1);
  });

  it("rejects state bound to another release before any RPC work", () => {
    const parsed = config();
    const state = createDeepV2BoundaryState(parsed);
    state.releaseManifest =
      "contracts/deployments/mainnet-deep-full-range-v1.json";

    expect(() => validateDeepV2BoundaryState(state, parsed)).toThrow(
      /boundary state is invalid/,
    );
  });

  it("skips a repeated invocation in the same deterministic slot", async () => {
    const parsed = config();
    const state = createDeepV2BoundaryState(parsed);
    state.lastCompletedSlot = 2;
    const runCycle = vi.fn();

    const result = await runDeepV2KeeperBoundary({
      config: parsed,
      boundaryState: state,
      lease,
      assertLease: vi.fn().mockResolvedValue(true),
      persistBoundaryState: vi.fn(),
      runCycle,
      readers: [{}, {}],
      wallet: null,
      metrics: {},
      nowMs: 620_000,
    });

    expect(result.outcome).toBe("not-due");
    expect(runCycle).not.toHaveBeenCalled();
  });

  it("checks the fence again immediately before every signer call", async () => {
    const parsed = config();
    const assertLease = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const walletWrite = vi.fn();
    const runCycle = vi.fn(
      async ({
        wallet,
      }: DeepV2InnerCycleInput): Promise<DeepV2InnerCycleResult> => {
        await wallet!.writeContract({});
        throw new Error("Signer fence should reject before this point");
      },
    );

    await expect(
      runDeepV2KeeperBoundary({
        config: parsed,
        boundaryState: createDeepV2BoundaryState(parsed),
        lease,
        assertLease,
        persistBoundaryState: vi.fn(),
        runCycle,
        readers: [{}, {}],
        wallet: {
          supportsStableIdempotency: true,
          writeContract: walletWrite,
        },
        metrics: {},
        nowMs: 610_000,
      }),
    ).rejects.toMatchObject({ code: "LEASE_FENCE_LOST" });
    expect(walletWrite).not.toHaveBeenCalled();
  });
});
