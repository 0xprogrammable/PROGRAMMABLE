import { getAddress, isAddress } from "viem";

import {
  DEEP_V3_KEEPER_BATCH_SIZE,
  DEEP_V3_KEEPER_CONFIRMATIONS,
  DEEP_V3_KEEPER_INTERVAL_MS,
  DEEP_V3_KEEPER_SCAN_LIMIT,
  DEEP_V3_RELEASE_MANIFEST_PATH,
} from "./config.mjs";

export const DEEP_V3_RELEASE_VERSION = "deep-full-range-v3";
export const DEEP_V3_INTERNAL_CONTRACT_RELEASE =
  "liquidity-growth-full-range-v3";
export const DEEP_V3_KEEPER_RELEASE_VERSION = "deep-keeper-v3";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_COMPONENTS = Object.freeze({
  zapPlanner:
    "src/LiquidityGrowthZapPlannerV3.sol:LiquidityGrowthZapPlannerV3",
  growthVaultFactory:
    "src/LiquidityGrowthFullRangeVaultFactoryV3.sol:LiquidityGrowthFullRangeVaultFactoryV3",
  growthVaultImplementation:
    "src/LiquidityGrowthFullRangeVaultV3.sol:LiquidityGrowthFullRangeVaultV3",
  hookFactory:
    "src/LiquidityGrowthFeeOracleHookFactoryV2.sol:LiquidityGrowthFeeOracleHookFactoryV2",
  feeHook:
    "src/LiquidityGrowthFeeOracleHookV2.sol:LiquidityGrowthFeeOracleHookV2",
  launcher:
    "src/LiquidityGrowthFullRangeLaunchV3.sol:LiquidityGrowthFullRangeLaunchV3",
  positionPlanner:
    "src/LiquidityGrowthFullRangePositionPlannerV3.sol:LiquidityGrowthFullRangePositionPlannerV3",
  automation:
    "src/LiquidityGrowthFullRangeAutomationV3.sol:LiquidityGrowthFullRangeAutomationV3",
  keeperExecutor: "src/DeepKeeperExecutorV2.sol:DeepKeeperExecutorV2",
});
const FIXED_POLICY = Object.freeze({
  tokenSupplyWei: "1000000000000000000000000000",
  totalSwapFeeBps: 100,
  growthFeeBps: 90,
  programmableFeeBps: 10,
  transferTaxBps: 0,
  lpFeePips: 0,
  tickSpacing: 200,
  initialTick: 204_200,
  fullRangeTickLower: -887_200,
  fullRangeTickUpper: 887_200,
  minimumInitialBuyWei: "600000000000000",
  minimumCompoundNativeWei: "2000000000000000",
  maximumCompoundNativeWei: "250000000000000000",
  compoundCooldownSeconds: 300,
  rollingExposureWindowSeconds: 1_800,
  rollingExposureRecordCapacity: 8,
  trustedDepthCycleCapBps: 25,
  maximumOptimizerIterations: 64,
  twapWindowSeconds: 1_800,
  shortTwapWindowSeconds: 300,
  oracleObservationCardinalityTarget: 192,
  maximumObservationTickDelta: 400,
  maximumRawTruncatedTwapDeltaTicks: 25,
  maximumShortLongTwapDeviationTicks: 50,
  maximumPreSpotTwapDeviationTicks: 100,
  maximumInternalSwapImpactTicks: 25,
  maximumPostSpotTwapDeviationTicks: 125,
});

function validHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function validBlock(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function exactSourceMatch(record, address, fqcn) {
  if (
    !record ||
    record.status !== "etherscan-exact-sourcify-match" ||
    record.fqcn !== fqcn ||
    typeof record.encodedConstructorArguments !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(
      record.encodedConstructorArguments,
    ) ||
    record.etherscan?.status !== "exact-match" ||
    record.sourcify?.status !== "match" ||
    !isAddress(address ?? "")
  ) {
    return false;
  }
  const checksum = getAddress(address);
  return (
    record.etherscan.url ===
      `https://etherscan.io/address/${checksum}#code` &&
    record.sourcify.url ===
      `https://sourcify.dev/server/v2/contract/1/${checksum}`
  );
}

export function validDeepV3ReviewedBinding(binding) {
  return (
    binding?.schemaVersion === 1 &&
    binding.status === "reviewed" &&
    binding.manifestPath === DEEP_V3_RELEASE_MANIFEST_PATH &&
    binding.model === "deep" &&
    binding.releaseVersion === DEEP_V3_RELEASE_VERSION &&
    binding.internalContractRelease ===
      DEEP_V3_INTERNAL_CONTRACT_RELEASE &&
    validHash(binding.sourceCommitment) &&
    isAddress(binding.automationAddress ?? "") &&
    validHash(binding.automationRuntimeCodeHash) &&
    binding.automationFqcn ===
      "src/LiquidityGrowthFullRangeAutomationV3.sol:LiquidityGrowthFullRangeAutomationV3" &&
    isAddress(binding.launcherAddress ?? "") &&
    validHash(binding.launcherRuntimeCodeHash) &&
    binding.launcherFqcn ===
      "src/LiquidityGrowthFullRangeLaunchV3.sol:LiquidityGrowthFullRangeLaunchV3" &&
    isAddress(binding.vaultFactoryAddress ?? "") &&
    validHash(binding.vaultFactoryRuntimeCodeHash) &&
    binding.vaultFactoryFqcn ===
      "src/LiquidityGrowthFullRangeVaultFactoryV3.sol:LiquidityGrowthFullRangeVaultFactoryV3" &&
    isAddress(binding.executorAddress ?? "") &&
    validHash(binding.executorRuntimeCodeHash) &&
    binding.executorFqcn ===
      "src/DeepKeeperExecutorV2.sol:DeepKeeperExecutorV2"
  );
}

function exactDeployment(release, key) {
  const transaction = release?.transactions?.[key];
  const block = release?.deploymentBlocks?.[key];
  const evidence = release?.deploymentEvidence?.[key];
  return (
    validHash(transaction) &&
    Number.isSafeInteger(block) &&
    block >= release.startBlock &&
    evidence?.receiptStatus === "success" &&
    evidence.transactionHash === transaction &&
    evidence.blockNumber === block &&
    validHash(evidence.blockHash)
  );
}

function exactFixedPolicy(policy) {
  return (
    policy &&
    typeof policy === "object" &&
    !Array.isArray(policy) &&
    Object.keys(policy).length === Object.keys(FIXED_POLICY).length &&
    Object.entries(FIXED_POLICY).every(
      ([key, expected]) => policy[key] === expected,
    )
  );
}

export function evaluateDeepV3KeeperReleaseGate(
  release,
  config,
  binding,
) {
  const reasons = [];
  const require = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };
  const reviewed = validDeepV3ReviewedBinding(binding);

  require(reviewed, "reviewed Deep V3 binding");
  require(release?.schemaVersion === 3, "manifest schema");
  require(release?.model === "deep", "model identity");
  require(release?.chainId === 1, "Ethereum Mainnet chain");
  require(
    release?.releaseManifest === DEEP_V3_RELEASE_MANIFEST_PATH,
    "release manifest path",
  );
  require(
    release?.releaseVersion === DEEP_V3_RELEASE_VERSION,
    "release version",
  );
  require(
    release?.internalContractRelease ===
      DEEP_V3_INTERNAL_CONTRACT_RELEASE,
    "internal contract release",
  );
  require(
    release?.keeperReleaseVersion ===
      DEEP_V3_KEEPER_RELEASE_VERSION,
    "keeper release version",
  );
  require(config?.enabled === true, "keeper activation");
  require(
    release?.status ===
        "deployment-source-lifecycle-and-keeper-verified" &&
      release.releaseEligible === true,
    "release eligibility",
  );
  require(
    COMMIT_PATTERN.test(release?.releaseCommit ?? ""),
    "release commit",
  );
  require(
    Number.isSafeInteger(release?.startBlock) &&
      release.startBlock > 0,
    "start block",
  );
  require(
    Array.isArray(release?.blockers) &&
      release.blockers.length === 0,
    "release blockers",
  );
  require(
    reviewed &&
      release?.sourceCommitment === binding.sourceCommitment &&
      config?.sourceCommitment === binding.sourceCommitment,
    "source commitment",
  );

  const boundComponents = [
    [
      "automation",
      "automationAddress",
      "automationRuntimeCodeHash",
      "automationRuntimeHash",
    ],
    [
      "launcher",
      "launcherAddress",
      "launcherRuntimeCodeHash",
      "launcherRuntimeHash",
    ],
    [
      "growthVaultFactory",
      "vaultFactoryAddress",
      "vaultFactoryRuntimeCodeHash",
      "vaultFactoryRuntimeHash",
    ],
    [
      "keeperExecutor",
      "executorAddress",
      "executorRuntimeCodeHash",
      "executorRuntimeHash",
    ],
  ];
  for (const [
    manifestKey,
    bindingAddressKey,
    bindingHashKey,
    configHashKey,
  ] of boundComponents) {
    const address = release?.addresses?.[manifestKey];
    const runtimeHash = release?.runtimeCodeHashes?.[manifestKey];
    require(
      reviewed &&
        sameAddress(address, binding[bindingAddressKey]) &&
        sameAddress(address, config?.[bindingAddressKey]),
      `${manifestKey} address`,
    );
    require(
      reviewed &&
        runtimeHash === binding[bindingHashKey] &&
        runtimeHash === config?.[configHashKey],
      `${manifestKey} runtime`,
    );
  }
  const componentKeys = Object.keys(RELEASE_COMPONENTS);
  const componentAddresses = componentKeys.map(
    (key) => release?.addresses?.[key],
  );
  require(
    componentAddresses.every((address) => isAddress(address ?? "")) &&
      new Set(
        componentAddresses.map((address) =>
          String(address).toLowerCase(),
        ),
      ).size === componentKeys.length,
    "release component addresses",
  );
  for (const key of componentKeys) {
    require(
      validHash(release?.runtimeCodeHashes?.[key]),
      `${key} runtime`,
    );
    require(
      exactDeployment(release, key),
      `${key} deployment receipt`,
    );
    require(
      exactSourceMatch(
        release?.sourceVerification?.contracts?.[key],
        release?.addresses?.[key],
        RELEASE_COMPONENTS[key],
      ),
      `${key} source verification`,
    );
  }
  require(release?.transactionCount === 6, "transaction count");
  require(
    new Set(
      componentKeys.map((key) =>
        String(release?.transactions?.[key]).toLowerCase(),
      ),
    ).size === 6,
    "deployment transaction graph",
  );
  require(
    release?.sourceVerification?.status === "verified",
    "source verification status",
  );
  require(exactFixedPolicy(release?.fixedPolicy), "fixed policy");
  require(
    release?.storageSafety?.status ===
        "verified-empty-eip1967-slots" &&
      release.storageSafety.proxyAdminBeaconSlotsEmpty === true &&
      componentKeys.every(
        (key) => release.storageSafety.contracts?.[key] === true,
      ),
    "storage safety",
  );

  const policy = release?.keeperPolicy;
  require(
    policy?.status === "reviewed-active" &&
      policy.enabled === true &&
      policy.transactionSubmission === true &&
      policy.signingBackend === "privy-policy-wallet" &&
      sameAddress(
        policy.keeperExecutor,
        release?.addresses?.keeperExecutor,
      ) &&
      policy.keeperExecutorRuntimeCodeHash ===
        release?.runtimeCodeHashes?.keeperExecutor &&
      sameAddress(
        policy.automation,
        release?.addresses?.automation,
      ) &&
      policy.automationRuntimeCodeHash ===
        release?.runtimeCodeHashes?.automation &&
      sameAddress(policy.signerAddress, config?.signerAddress) &&
      policy.executionPath === "/api/ops/deep-v3-keeper" &&
      policy.intervalMilliseconds === DEEP_V3_KEEPER_INTERVAL_MS &&
      policy.scanLimit === DEEP_V3_KEEPER_SCAN_LIMIT &&
      policy.maxBatchSize === DEEP_V3_KEEPER_BATCH_SIZE &&
      policy.executorMaximumBatchSize === 4 &&
      policy.confirmations === DEEP_V3_KEEPER_CONFIRMATIONS &&
      policy.independentReadRpcCount === 2 &&
      policy.maximumTransactionGas === config?.maxGas?.toString() &&
      policy.measuredCompoundGas === "2884090" &&
      policy.reviewedPerVaultGasCeiling === "4428255" &&
      policy.reviewedBindingPath ===
        "ops/deep-keeper-v3/reviewed-release-binding.json",
    "keeper policy",
  );
  require(
    release?.lifecycleEvidence?.status ===
      "verified-current-release" &&
      release.lifecycleEvidence.releaseEligible === true &&
      release.lifecycleEvidence.requiredRelease ===
        DEEP_V3_RELEASE_VERSION &&
      release.lifecycleEvidence.evidencePath ===
        "contracts/deployments/evidence/deep-full-range-mainnet-canary-v3.json" &&
      release.lifecycleEvidence.independentRpcCount === 2 &&
      isAddress(release.lifecycleEvidence.canaryToken ?? "") &&
      isAddress(release.lifecycleEvidence.canaryVault ?? "") &&
      validHash(release.lifecycleEvidence.poolId) &&
      validHash(release.lifecycleEvidence.launchTransaction) &&
      validHash(release.lifecycleEvidence.oracleTransaction) &&
      validHash(release.lifecycleEvidence.compoundTransaction) &&
      validHash(release.lifecycleEvidence.evidenceHash) &&
      release.lifecycleEvidence.noActionKeeperCycle?.status ===
        "verified-no-transaction" &&
      release.lifecycleEvidence.noActionKeeperCycle?.outcome ===
        "idle" &&
      release.lifecycleEvidence.noActionKeeperCycle?.readyVaults === 0 &&
      release.lifecycleEvidence.noActionKeeperCycle
        ?.submittedTransaction === false &&
      validBlock(
        release.lifecycleEvidence.noActionKeeperCycle?.observedAtBlock,
      ) &&
      release.lifecycleEvidence.noActionKeeperCycle
        ?.successfulCandidates === 0 &&
      release.lifecycleEvidence.noActionKeeperCycle?.transactionHash ===
        null &&
      release.lifecycleEvidence.noActionKeeperCycle?.blockNumber ===
        null &&
      validHash(
        release.lifecycleEvidence.noActionKeeperCycle?.evidenceHash,
      ) &&
      release.lifecycleEvidence.actionableKeeperCycle?.status ===
        "verified-compound-confirmed" &&
      release.lifecycleEvidence.actionableKeeperCycle?.outcome ===
        "confirmed-productive" &&
      validBlock(
        release.lifecycleEvidence.actionableKeeperCycle?.readyVaults,
      ) &&
      release.lifecycleEvidence.actionableKeeperCycle
        ?.submittedTransaction === true &&
      validBlock(
        release.lifecycleEvidence.actionableKeeperCycle
          ?.observedAtBlock,
      ) &&
      validBlock(
        release.lifecycleEvidence.actionableKeeperCycle
          ?.successfulCandidates,
      ) &&
      release.lifecycleEvidence.actionableKeeperCycle
        ?.transactionHash ===
        release.lifecycleEvidence.compoundTransaction &&
      validBlock(
        release.lifecycleEvidence.actionableKeeperCycle?.blockNumber,
      ) &&
      validHash(
        release.lifecycleEvidence.actionableKeeperCycle?.evidenceHash,
      ),
    "lifecycle evidence",
  );
  require(
    release?.activation?.appStatus === "ready" &&
      release.activation.keeperStatus === "ready" &&
      release.activation.requiresExactManifestMatch === true &&
      release.activation.productionTransactionSubmission === true,
    "production activation",
  );

  return Object.freeze({
    ready: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}
