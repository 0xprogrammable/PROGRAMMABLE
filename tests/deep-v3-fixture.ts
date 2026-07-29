import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import opsV2SourceBinding from "../ops/deep-keeper-v3/ops-v2-source-binding.json";
import {
  DEEP_V3_FIXED_POLICY,
  DEEP_V3_LOCKED_POSITION_FACTORY,
  DEEP_V3_LOCKED_POSITION_FACTORY_RUNTIME_HASH,
  DEEP_V3_OFFICIAL_DEPENDENCIES,
  DEEP_V3_RUNTIME_FIELDS,
  DEEP_V3_SOURCE_FQCNS,
  DEEP_V3_SOURCE_COMMITMENT,
  DEEP_V3_TREASURY,
  type DeepV3LaunchProvenance,
} from "../lib/onchain/deep-v3-read-model";
import { computeOfficialV4PoolId } from "../lib/uniswap/liquidity-launcher-sdk";

export const DEEP_V3_TEST_RUNTIME = "0x6000" as Hex;
export const DEEP_V3_TEST_RUNTIME_HASH = keccak256(
  DEEP_V3_TEST_RUNTIME,
);

export const DEEP_V3_TEST_ADDRESSES = {
  deployer: getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
  zapPlanner: getAddress("0x1111111111111111111111111111111111111111"),
  growthVaultFactory: getAddress(
    "0x2222222222222222222222222222222222222222",
  ),
  growthVaultImplementation: getAddress(
    "0x3333333333333333333333333333333333333333",
  ),
  hookFactory: getAddress(
    "0x4444444444444444444444444444444444444444",
  ),
  feeHook: getAddress("0x5555555555555555555555555555555555553aec"),
  launcher: getAddress("0x6666666666666666666666666666666666666666"),
  positionPlanner: getAddress(
    "0x7777777777777777777777777777777777777777",
  ),
  automation: getAddress(
    "0x8888888888888888888888888888888888888888",
  ),
  keeperExecutor: getAddress(
    "0x9999999999999999999999999999999999999999",
  ),
} as const;

export const DEEP_V3_TEST_TOKEN = getAddress(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);
export const DEEP_V3_TEST_VAULT = getAddress(
  "0xcccccccccccccccccccccccccccccccccccccccc",
);
export const DEEP_V3_TEST_POSITION_RECIPIENT = getAddress(
  "0xdddddddddddddddddddddddddddddddddddddddd",
);
export const DEEP_V3_TEST_CREATOR = getAddress(
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
);
export const DEEP_V3_TEST_POOL_ID = computeOfficialV4PoolId({
  currency0:
    "0x0000000000000000000000000000000000000000" as Address,
  currency1: DEEP_V3_TEST_TOKEN,
  fee: 0,
  tickSpacing: 200,
  hooks: DEEP_V3_TEST_ADDRESSES.feeHook,
});
export const DEEP_V3_TEST_LAUNCH_HASH =
  `0x${"12".repeat(32)}` as Hex;
export const DEEP_V3_TEST_CONFIGURATION_HASH =
  `0x${"34".repeat(32)}` as Hex;
export const DEEP_V3_TEST_BLOCK_HASH =
  `0x${"56".repeat(32)}` as Hex;
export const DEEP_V3_TEST_TRANSACTION_HASH =
  `0x${"78".repeat(32)}` as Hex;
export const DEEP_V3_TEST_RELEASE_COMMIT = "1".repeat(40);
export const DEEP_V3_TEST_OPS_SOURCE_COMMITMENT =
  opsV2SourceBinding.opsSourceCommitment as Hex;

export function deepV3TestProvenance(): DeepV3LaunchProvenance {
  return {
    deepReleaseVersion: "deep-full-range-v3",
    launchModel: "deep",
    launcher: DEEP_V3_TEST_ADDRESSES.launcher,
    creator: DEEP_V3_TEST_CREATOR,
    tokenAddress: DEEP_V3_TEST_TOKEN,
    vaultAddress: DEEP_V3_TEST_VAULT,
    hookAddress: DEEP_V3_TEST_ADDRESSES.feeHook,
    positionRecipient: DEEP_V3_TEST_POSITION_RECIPIENT,
    positionTokenId: "77",
    poolId: DEEP_V3_TEST_POOL_ID,
    launchHash: DEEP_V3_TEST_LAUNCH_HASH,
    vaultConfigurationHash: DEEP_V3_TEST_CONFIGURATION_HASH,
    blockNumber: "123",
    blockHash: DEEP_V3_TEST_BLOCK_HASH,
    transactionHash: DEEP_V3_TEST_TRANSACTION_HASH,
    transactionIndex: 2,
    logIndex: 50,
  };
}

export function deepV3LiveManifestFixture() {
  const primaryTransactionIndex = {
    zapPlanner: 0,
    growthVaultFactory: 1,
    growthVaultImplementation: 1,
    hookFactory: 2,
    feeHook: 3,
    launcher: 4,
    positionPlanner: 4,
    automation: 4,
    keeperExecutor: 5,
  } as const;
  const transactionHash = (index: number) =>
    `0x${(index + 1)
      .toString(16)
      .padStart(2, "0")
      .repeat(32)}` as Hex;
  const blockHash = (index: number) =>
    `0x${(index + 20)
      .toString(16)
      .padStart(2, "0")
      .repeat(32)}` as Hex;
  const runtimeCodeHashes = Object.fromEntries(
    DEEP_V3_RUNTIME_FIELDS.map((field) => [
      field,
      DEEP_V3_TEST_RUNTIME_HASH,
    ]),
  );
  const deploymentBlocks = Object.fromEntries(
    DEEP_V3_RUNTIME_FIELDS.map((field) => [
      field,
      100 + primaryTransactionIndex[field],
    ]),
  );
  const transactions = Object.fromEntries(
    DEEP_V3_RUNTIME_FIELDS.map((field) => [
      field,
      transactionHash(primaryTransactionIndex[field]),
    ]),
  );
  const deploymentEvidence = Object.fromEntries(
    DEEP_V3_RUNTIME_FIELDS.map((field) => {
      const transactionIndex = primaryTransactionIndex[field];
      const isPrimary =
        field === "zapPlanner" ||
        field === "growthVaultFactory" ||
        field === "hookFactory" ||
        field === "feeHook" ||
        field === "launcher" ||
        field === "keeperExecutor";
      return [
        field,
        {
          receiptStatus: "success",
          transactionHash: transactionHash(transactionIndex),
          blockHash: blockHash(transactionIndex),
          blockNumber: 100 + transactionIndex,
          ...(isPrimary
            ? {
                nonce: transactionIndex,
                valueWei: "0",
                from: DEEP_V3_TEST_ADDRESSES.deployer,
                to:
                  field === "feeHook"
                    ? DEEP_V3_TEST_ADDRESSES.hookFactory
                    : null,
                transactionInputHash: `0x${(transactionIndex + 40)
                  .toString(16)
                  .padStart(2, "0")
                  .repeat(32)}`,
              }
            : {}),
        },
      ];
    }),
  );
  const sourceContracts = Object.fromEntries(
    DEEP_V3_RUNTIME_FIELDS.map((field) => {
      const contractAddress =
        DEEP_V3_TEST_ADDRESSES[
          field as keyof typeof DEEP_V3_TEST_ADDRESSES
        ];
      return [
        field,
        {
          status: "etherscan-exact-sourcify-match",
          fqcn: DEEP_V3_SOURCE_FQCNS[field],
          constructorArguments: [],
          encodedConstructorArguments: "0x",
          etherscan: {
            status: "exact-match",
            url: `https://etherscan.io/address/${contractAddress}#code`,
          },
          sourcify: {
            status: "match",
            url: `https://sourcify.dev/server/v2/contract/1/${contractAddress}`,
          },
        },
      ];
    }),
  );
  return {
    schemaVersion: 3,
    model: "deep",
    internalContractRelease: "liquidity-growth-full-range-v3",
    releaseVersion: "deep-full-range-v3",
    releaseManifest:
      "contracts/deployments/mainnet-deep-full-range-v3.json",
    keeperReleaseVersion: "deep-keeper-v3-ops-v2",
    status: "deployment-source-lifecycle-and-keeper-verified",
    releaseEligible: true,
    chainId: 1,
    releaseCommit: DEEP_V3_TEST_RELEASE_COMMIT,
    sourceCommitment: DEEP_V3_SOURCE_COMMITMENT,
    startBlock: 100,
    startingNonce: 0,
    transactionCount: 6,
    hookSalt: `0x${"9a".repeat(32)}`,
    candidatePlan: {
      status: "reviewed-at-signing",
      observedAtBlock: 99,
      startingNonce: 0,
      hookSalt: `0x${"9a".repeat(32)}`,
      ...DEEP_V3_TEST_ADDRESSES,
    },
    addresses: {
      ...DEEP_V3_TEST_ADDRESSES,
      treasury: DEEP_V3_TREASURY,
      lockedPositionFactory: DEEP_V3_LOCKED_POSITION_FACTORY,
    },
    transactions,
    runtimeCodeHashes: {
      ...runtimeCodeHashes,
      lockedPositionFactory:
        DEEP_V3_LOCKED_POSITION_FACTORY_RUNTIME_HASH,
    },
    deploymentBlocks,
    deploymentEvidence,
    officialDependencies: DEEP_V3_OFFICIAL_DEPENDENCIES,
    fixedPolicy: { ...DEEP_V3_FIXED_POLICY },
    storageSafety: {
      status: "verified-empty-eip1967-slots",
      proxyAdminBeaconSlotsEmpty: true,
      contracts: Object.fromEntries(
        DEEP_V3_RUNTIME_FIELDS.map((field) => [field, true]),
      ),
    },
    sourceVerification: {
      status: "verified",
      contracts: sourceContracts,
    },
    lifecycleEvidence: {
      status: "verified-current-release",
      releaseEligible: true,
      requiredRelease: "deep-full-range-v3",
      evidencePath:
        "contracts/deployments/evidence/deep-full-range-mainnet-canary-v3.json",
      independentRpcCount: 2,
      canaryToken: DEEP_V3_TEST_TOKEN,
      canaryVault: DEEP_V3_TEST_VAULT,
      poolId: DEEP_V3_TEST_POOL_ID,
      launchTransaction: `0x${"a1".repeat(32)}`,
      oracleTransaction: `0x${"a2".repeat(32)}`,
      compoundTransaction: `0x${"a3".repeat(32)}`,
      evidenceHash: `0x${"a4".repeat(32)}`,
      noActionKeeperCycle: {
        status: "verified-no-transaction",
        outcome: "idle",
        readyVaults: 0,
        submittedTransaction: false,
        observedAtBlock: 200,
        successfulCandidates: 0,
        transactionHash: null,
        blockNumber: null,
        evidenceHash: `0x${"a5".repeat(32)}`,
      },
      actionableKeeperCycle: {
        status: "verified-compound-confirmed",
        outcome: "confirmed-productive",
        readyVaults: 1,
        submittedTransaction: true,
        observedAtBlock: 210,
        successfulCandidates: 1,
        transactionHash: `0x${"a3".repeat(32)}`,
        blockNumber: 211,
        evidenceHash: `0x${"a6".repeat(32)}`,
      },
    },
    keeperPolicy: {
      status: "reviewed-active",
      enabled: true,
      transactionSubmission: true,
      keeperExecutor: DEEP_V3_TEST_ADDRESSES.keeperExecutor,
      keeperExecutorRuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
      automation: DEEP_V3_TEST_ADDRESSES.automation,
      automationRuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
      signerAddress: DEEP_V3_TEST_CREATOR,
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
      deploymentCommit: DEEP_V3_TEST_RELEASE_COMMIT,
      reviewedBindingPath:
        "ops/deep-keeper-v3/reviewed-ops-v2-binding.json",
    },
    activation: {
      appStatus: "ready",
      keeperStatus: "ready",
      requiresExactManifestMatch: true,
      productionTransactionSubmission: true,
    },
    blockers: [],
  };
}

export function deepV3ReviewedBindingFixture() {
  return {
    schemaVersion: 2,
    status: "reviewed",
    manifestPath:
      "contracts/deployments/mainnet-deep-full-range-v3.json",
    model: "deep",
    releaseVersion: "deep-full-range-v3",
    internalContractRelease: "liquidity-growth-full-range-v3",
    keeperReleaseVersion: "deep-keeper-v3-ops-v2",
    releaseCommit: DEEP_V3_TEST_RELEASE_COMMIT,
    sourceCommitment: DEEP_V3_SOURCE_COMMITMENT,
    opsSourceCommitment: DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
    signerAddress: DEEP_V3_TEST_CREATOR,
    automationAddress: DEEP_V3_TEST_ADDRESSES.automation,
    automationRuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
    automationFqcn: DEEP_V3_SOURCE_FQCNS.automation,
    launcherAddress: DEEP_V3_TEST_ADDRESSES.launcher,
    launcherRuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
    launcherFqcn: DEEP_V3_SOURCE_FQCNS.launcher,
    vaultFactoryAddress: DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
    vaultFactoryRuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
    vaultFactoryFqcn: DEEP_V3_SOURCE_FQCNS.growthVaultFactory,
    executorAddress: DEEP_V3_TEST_ADDRESSES.keeperExecutor,
    executorRuntimeCodeHash: DEEP_V3_TEST_RUNTIME_HASH,
    executorFqcn: DEEP_V3_SOURCE_FQCNS.keeperExecutor,
  };
}
