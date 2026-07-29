import { getAddress, isAddress } from "viem";

import {
  DEEP_V3_KEEPER_POLICY,
  DEEP_V3_MANIFEST_PATH,
  computeDeepV3OpsV2SourceCommitment,
} from "./deep-full-range-release-v3-core.mjs";

export const DEEP_V3_OPS_V2_REVIEWED_BINDING_PATH =
  "ops/deep-keeper-v3/reviewed-ops-v2-binding.json";

const RELEASE_VERSION = "deep-full-range-v3";
const INTERNAL_RELEASE = "liquidity-growth-full-range-v3";
const KEEPER_RELEASE = "deep-keeper-v3-ops-v2";
const COMMIT = /^[0-9a-f]{40}$/;

const FQCNS = Object.freeze({
  automation:
    "src/LiquidityGrowthFullRangeAutomationV3.sol:LiquidityGrowthFullRangeAutomationV3",
  launcher:
    "src/LiquidityGrowthFullRangeLaunchV3.sol:LiquidityGrowthFullRangeLaunchV3",
  growthVaultFactory:
    "src/LiquidityGrowthFullRangeVaultFactoryV3.sol:LiquidityGrowthFullRangeVaultFactoryV3",
  keeperExecutor: "src/DeepKeeperExecutorV2.sol:DeepKeeperExecutorV2",
});

function fail(message) {
  throw new Error(`Deep V3 ops v2 promotion failed: ${message}`);
}

function address(value, label) {
  if (!isAddress(value ?? "")) fail(`${label} is not an address`);
  return getAddress(value);
}

function positive(value, label) {
  if (typeof value !== "bigint" || value <= 0n) {
    fail(`${label} must be positive`);
  }
  return value.toString();
}

export function buildDeepV3OpsV2Promotion({
  manifest,
  config,
  root,
}) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.schemaVersion !== 3 ||
    manifest.model !== "deep" ||
    manifest.releaseVersion !== RELEASE_VERSION ||
    manifest.internalContractRelease !== INTERNAL_RELEASE ||
    manifest.keeperReleaseVersion !== KEEPER_RELEASE ||
    manifest.releaseManifest !== DEEP_V3_MANIFEST_PATH ||
    !COMMIT.test(manifest.releaseCommit ?? "")
  ) {
    fail("the contract release identity is incomplete");
  }
  if (
    config?.enabled !== true ||
    config.sendTransactions !== true ||
    config.legacyEnabled !== false ||
    config.legacySends !== false ||
    config.deploymentCommit !== manifest.releaseCommit ||
    config.chainId !== 1 ||
    config.releaseManifest !== DEEP_V3_MANIFEST_PATH ||
    config.signerLanes?.length !== 1
  ) {
    fail("the reviewed keeper configuration is not active and isolated");
  }

  const opsSourceCommitment =
    computeDeepV3OpsV2SourceCommitment(root);
  if (config.opsSourceCommitment !== opsSourceCommitment) {
    fail("the configured ops source commitment is not derived from source");
  }
  if (config.sourceCommitment !== manifest.sourceCommitment) {
    fail("the contract source commitment differs");
  }

  const bindings = [
    [
      "automation",
      config.automationAddress,
      config.automationRuntimeHash,
    ],
    [
      "launcher",
      config.launcherAddress,
      config.launcherRuntimeHash,
    ],
    [
      "growthVaultFactory",
      config.vaultFactoryAddress,
      config.vaultFactoryRuntimeHash,
    ],
    [
      "keeperExecutor",
      config.executorAddress,
      config.executorRuntimeHash,
    ],
  ];
  for (const [field, configuredAddress, configuredHash] of bindings) {
    if (
      address(manifest.addresses?.[field], `${field} manifest address`) !==
        address(configuredAddress, `${field} config address`) ||
      manifest.runtimeCodeHashes?.[field] !== configuredHash
    ) {
      fail(`${field} runtime binding differs`);
    }
  }

  const signerAddress = address(
    config.signerLanes[0].signerAddress,
    "signer address",
  );
  const promotedManifest = structuredClone(manifest);
  promotedManifest.status =
    "deployment-source-lifecycle-and-keeper-verified";
  promotedManifest.releaseEligible = true;
  promotedManifest.keeperPolicy = {
    ...promotedManifest.keeperPolicy,
    status: "reviewed-active",
    enabled: true,
    transactionSubmission: true,
    keeperExecutor: address(
      promotedManifest.addresses.keeperExecutor,
      "keeper executor",
    ),
    keeperExecutorRuntimeCodeHash:
      promotedManifest.runtimeCodeHashes.keeperExecutor,
    automation: address(
      promotedManifest.addresses.automation,
      "automation",
    ),
    automationRuntimeCodeHash:
      promotedManifest.runtimeCodeHashes.automation,
    signerAddress,
    signingBackend: "privy-policy-wallet",
    ...Object.fromEntries(
      Object.entries(DEEP_V3_KEEPER_POLICY).filter(
        ([key]) =>
          key !== "enabled" && key !== "transactionSubmission",
      ),
    ),
    minGrowthToMaxGasRatioBps:
      config.minGrowthToMaxGasRatioBps,
    maxFeePerGasWei: positive(
      config.maxFeePerGasWei,
      "maximum fee per gas",
    ),
    maxTotalDebitWeiPerTick: positive(
      config.maxTotalDebitWeiPerTick,
      "maximum debit per tick",
    ),
    maxTotalDebitWeiPerDay: positive(
      config.maxTotalDebitWeiPerDay,
      "maximum debit per day",
    ),
    signerBalanceFloorWei: positive(
      config.signerBalanceFloorWei,
      "signer balance floor",
    ),
    opsSourceCommitment,
    deploymentCommit: promotedManifest.releaseCommit,
  };
  promotedManifest.activation = {
    appStatus: "ready",
    keeperStatus: "ready",
    requiresExactManifestMatch: true,
    productionTransactionSubmission: true,
  };
  promotedManifest.blockers = [];

  const reviewedBinding = {
    schemaVersion: 2,
    status: "reviewed",
    manifestPath: DEEP_V3_MANIFEST_PATH,
    model: "deep",
    releaseVersion: RELEASE_VERSION,
    internalContractRelease: INTERNAL_RELEASE,
    keeperReleaseVersion: KEEPER_RELEASE,
    releaseCommit: promotedManifest.releaseCommit,
    sourceCommitment: promotedManifest.sourceCommitment,
    opsSourceCommitment,
    signerAddress,
    automationAddress: promotedManifest.addresses.automation,
    automationRuntimeCodeHash:
      promotedManifest.runtimeCodeHashes.automation,
    automationFqcn: FQCNS.automation,
    launcherAddress: promotedManifest.addresses.launcher,
    launcherRuntimeCodeHash:
      promotedManifest.runtimeCodeHashes.launcher,
    launcherFqcn: FQCNS.launcher,
    vaultFactoryAddress:
      promotedManifest.addresses.growthVaultFactory,
    vaultFactoryRuntimeCodeHash:
      promotedManifest.runtimeCodeHashes.growthVaultFactory,
    vaultFactoryFqcn: FQCNS.growthVaultFactory,
    executorAddress: promotedManifest.addresses.keeperExecutor,
    executorRuntimeCodeHash:
      promotedManifest.runtimeCodeHashes.keeperExecutor,
    executorFqcn: FQCNS.keeperExecutor,
  };

  return Object.freeze({
    manifest: promotedManifest,
    binding: reviewedBinding,
    opsSourceCommitment,
  });
}
