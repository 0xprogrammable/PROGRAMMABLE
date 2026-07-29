import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import pendingManifest from "../contracts/deployments/mainnet-deep-full-range-v3.json";
import {
  DEEP_V3_SOURCE_COMMITMENT,
} from "../lib/deep-v3";
import {
  isDeepV3ReleaseEligible,
  type DeepV3ReleaseManifest,
  type DeepV3ReviewedReleaseBinding,
} from "../lib/deep-v3-release";
import {
  DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
  deepV3LiveManifestFixture,
  deepV3ReviewedBindingFixture,
} from "./deep-v3-fixture";

const components = [
  "zapPlanner",
  "growthVaultFactory",
  "growthVaultImplementation",
  "hookFactory",
  "feeHook",
  "launcher",
  "positionPlanner",
  "automation",
  "keeperExecutor",
] as const;
const transactionByComponent = {
  zapPlanner: 1,
  growthVaultFactory: 2,
  growthVaultImplementation: 2,
  hookFactory: 3,
  feeHook: 4,
  launcher: 5,
  positionPlanner: 5,
  automation: 5,
  keeperExecutor: 6,
} as const;

function address(index: number) {
  return getAddress(`0x${index.toString(16).padStart(40, "0")}`);
}

function hash(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function readyFixture() {
  const release = structuredClone(
    pendingManifest,
  ) as unknown as DeepV3ReleaseManifest;
  release.status =
    "deployment-source-lifecycle-and-keeper-verified";
  release.releaseEligible = true;
  release.releaseCommit = "a".repeat(40);
  release.startBlock = 100;
  release.startingNonce = 7;
  release.hookSalt = hash(777);
  release.blockers = [];
  release.addresses!.deployer = address(50);

  for (const [index, key] of components.entries()) {
    const componentAddress =
      key === "feeHook" ? address(0x3aec) : address(index + 1);
    const runtimeHash = hash(index + 101);
    const transaction = hash(transactionByComponent[key] + 200);
    release.addresses![key] = componentAddress;
    release.runtimeCodeHashes![key] = runtimeHash;
    release.transactions![key] = transaction;
    release.deploymentBlocks![key] = 100 + transactionByComponent[key];
    release.deploymentEvidence![key] = {
      receiptStatus: "success",
      transactionHash: transaction,
      blockNumber: 100 + transactionByComponent[key],
      blockHash: hash(300 + transactionByComponent[key]),
    };
    const source = release.sourceVerification!.contracts![key] as Record<
      string,
      unknown
    >;
    const checksumAddress = componentAddress;
    source.status = "etherscan-exact-sourcify-match";
    source.encodedConstructorArguments = "0x";
    source.etherscan = {
      status: "exact-match",
      url: `https://etherscan.io/address/${checksumAddress}#code`,
    };
    source.sourcify = {
      status: "match",
      url: `https://sourcify.dev/server/v2/contract/1/${checksumAddress}`,
    };
  }
  release.candidatePlan = {
    status: "reviewed-at-signing",
    observedAtBlock: 99,
    deployer: release.addresses!.deployer,
    startingNonce: release.startingNonce,
    hookSalt: release.hookSalt,
    ...Object.fromEntries(
      components.map((key) => [key, release.addresses![key]]),
    ),
  };
  const primaryComponents = [
    "zapPlanner",
    "growthVaultFactory",
    "hookFactory",
    "feeHook",
    "launcher",
    "keeperExecutor",
  ] as const;
  primaryComponents.forEach((key, nonceOffset) => {
    release.deploymentEvidence![key] = {
      ...(release.deploymentEvidence![key] as Record<string, unknown>),
      nonce: Number(release.startingNonce) + nonceOffset,
      valueWei: "0",
      from: release.addresses!.deployer,
      to: key === "feeHook" ? release.addresses!.hookFactory : null,
      transactionInputHash: hash(600 + nonceOffset),
    };
  });
  release.sourceVerification!.status = "verified";
  release.storageSafety = {
    status: "verified-empty-eip1967-slots",
    proxyAdminBeaconSlotsEmpty: true,
    contracts: Object.fromEntries(
      components.map((key) => [key, true]),
    ),
  };
  release.lifecycleEvidence = {
    status: "verified-current-release",
    releaseEligible: true,
    requiredRelease: "deep-full-range-v3",
    evidencePath:
      "contracts/deployments/evidence/deep-full-range-mainnet-canary-v3.json",
    independentRpcCount: 2,
    canaryToken: address(30),
    canaryVault: address(31),
    poolId: hash(400),
    launchTransaction: hash(401),
    oracleTransaction: hash(402),
    compoundTransaction: hash(403),
    evidenceHash: hash(404),
    noActionKeeperCycle: {
      status: "verified-no-transaction",
      outcome: "idle",
      readyVaults: 0,
      submittedTransaction: false,
      observedAtBlock: 500,
      successfulCandidates: 0,
      transactionHash: null,
      blockNumber: null,
      evidenceHash: hash(405),
    },
    actionableKeeperCycle: {
      status: "verified-compound-confirmed",
      outcome: "confirmed-productive",
      readyVaults: 1,
      submittedTransaction: true,
      observedAtBlock: 510,
      successfulCandidates: 1,
      transactionHash: hash(403),
      blockNumber: 511,
      evidenceHash: hash(406),
    },
  };
  release.keeperPolicy = {
    ...release.keeperPolicy,
    status: "reviewed-active",
    enabled: true,
    transactionSubmission: true,
    keeperExecutor: release.addresses!.keeperExecutor,
    keeperExecutorRuntimeCodeHash:
      release.runtimeCodeHashes!.keeperExecutor,
    automation: release.addresses!.automation,
    automationRuntimeCodeHash: release.runtimeCodeHashes!.automation,
    signerAddress: address(32),
    signingBackend: "privy-policy-wallet",
    executionPath: "/api/ops/deep-v3-keeper-v2",
    controlPath: "ops/deep-keeper-v3/control-v2.json",
    legacyControlPath: "ops/deep-keeper-v3/control-v1.json",
    controlSchemaVersion: 2,
    signerLaneCount: 1,
    confirmations: 12,
    independentReadRpcCount: 2,
    intervalMilliseconds: 300_000,
    scanPageSize: 32,
    maxScanPages: 2,
    maxCandidatesPerBatch: 4,
    maxNewSubmissionsPerTick: 1,
    maxActivePendingBatches: 8,
    maxOperatorIncidents: 8,
    maxHistoryEntries: 64,
    maximumTransactionGas: "18000000",
    maximumTotalGasPerTick: "18000000",
    maximumCompoundNativeWei: "250000000000000000",
    minGrowthToMaxGasRatioBps: 10_000,
    maxFeePerGasWei: "3000000000",
    maxTotalDebitWeiPerTick: "54000000000000000",
    maxTotalDebitWeiPerDay: "864000000000000000",
    signerBalanceFloorWei: "100000000000000000",
    measuredCompoundGas: "2884090",
    reviewedPerVaultGasCeiling: "4428255",
    gasMixtures: [
      {
        compoundCandidates: 0,
        oracleCandidates: 4,
        theoreticalGas: "7870636",
      },
      {
        compoundCandidates: 1,
        oracleCandidates: 3,
        theoreticalGas: "10308732",
      },
      {
        compoundCandidates: 2,
        oracleCandidates: 2,
        theoreticalGas: "12746828",
      },
      {
        compoundCandidates: 3,
        oracleCandidates: 1,
        theoreticalGas: "15184924",
      },
      {
        compoundCandidates: 4,
        oracleCandidates: 0,
        theoreticalGas: "17623020",
      },
    ],
    opsSourceCommitment: DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
    deploymentCommit: release.releaseCommit,
    reviewedBindingPath:
      "ops/deep-keeper-v3/reviewed-ops-v2-binding.json",
  };
  release.activation = {
    appStatus: "ready",
    keeperStatus: "ready",
    requiresExactManifestMatch: true,
    productionTransactionSubmission: true,
  };

  const binding: DeepV3ReviewedReleaseBinding = {
    schemaVersion: 2,
    status: "reviewed",
    manifestPath:
      "contracts/deployments/mainnet-deep-full-range-v3.json",
    model: "deep",
    releaseVersion: "deep-full-range-v3",
    internalContractRelease: "liquidity-growth-full-range-v3",
    keeperReleaseVersion: "deep-keeper-v3-ops-v2",
    releaseCommit: release.releaseCommit,
    sourceCommitment: DEEP_V3_SOURCE_COMMITMENT,
    opsSourceCommitment: release.keeperPolicy.opsSourceCommitment,
    signerAddress: release.keeperPolicy.signerAddress,
    automationAddress: release.addresses!.automation,
    automationRuntimeCodeHash: release.runtimeCodeHashes!.automation,
    automationFqcn:
      "src/LiquidityGrowthFullRangeAutomationV3.sol:LiquidityGrowthFullRangeAutomationV3",
    launcherAddress: release.addresses!.launcher,
    launcherRuntimeCodeHash: release.runtimeCodeHashes!.launcher,
    launcherFqcn:
      "src/LiquidityGrowthFullRangeLaunchV3.sol:LiquidityGrowthFullRangeLaunchV3",
    vaultFactoryAddress: release.addresses!.growthVaultFactory,
    vaultFactoryRuntimeCodeHash:
      release.runtimeCodeHashes!.growthVaultFactory,
    vaultFactoryFqcn:
      "src/LiquidityGrowthFullRangeVaultFactoryV3.sol:LiquidityGrowthFullRangeVaultFactoryV3",
    executorAddress: release.addresses!.keeperExecutor,
    executorRuntimeCodeHash:
      release.runtimeCodeHashes!.keeperExecutor,
    executorFqcn:
      "src/DeepKeeperExecutorV2.sol:DeepKeeperExecutorV2",
  };
  return { release, binding };
}

describe("Deep V3 app release gate", () => {
  it("keeps the checked-in pending deployment disabled", () => {
    expect(isDeepV3ReleaseEligible(pendingManifest, 1)).toBe(false);
  });

  it("accepts the shared canonical live fixture only with its reviewed binding", () => {
    const release = deepV3LiveManifestFixture();
    const binding = deepV3ReviewedBindingFixture();
    expect(
      isDeepV3ReleaseEligible(release, 1, binding),
    ).toBe(true);

    expect(
      isDeepV3ReleaseEligible(
        {
          ...release,
          officialDependencies: {
            ...release.officialDependencies,
            poolManager: {
              ...release.officialDependencies.poolManager,
              address: address(900),
            },
          },
        },
        1,
        binding,
      ),
    ).toBe(false);
    expect(
      isDeepV3ReleaseEligible(
        {
          ...release,
          fixedPolicy: {
            ...release.fixedPolicy,
            unreviewedOption: true,
          },
        },
        1,
        binding,
      ),
    ).toBe(false);
  });

  it("accepts only the exact reviewed release and active keeper posture", () => {
    const { release, binding } = readyFixture();
    expect(isDeepV3ReleaseEligible(release, 1, binding)).toBe(true);

    expect(
      isDeepV3ReleaseEligible(
        {
          ...release,
          runtimeCodeHashes: {
            ...release.runtimeCodeHashes,
            launcher: hash(999),
          },
        },
        1,
        binding,
      ),
    ).toBe(false);
    expect(
      isDeepV3ReleaseEligible(
        {
          ...release,
          keeperPolicy: {
            ...release.keeperPolicy,
            transactionSubmission: false,
          },
        },
        1,
        binding,
      ),
    ).toBe(false);
  });
});
