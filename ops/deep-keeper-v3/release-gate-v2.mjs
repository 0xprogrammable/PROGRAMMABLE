import { getAddress, isAddress } from "viem";

import {
  DEEP_V3_KEEPER_V2_CONFIRMATIONS,
  DEEP_V3_KEEPER_V2_CONTROL_PATH,
  DEEP_V3_KEEPER_V2_INTERVAL_MS,
  DEEP_V3_KEEPER_V2_LEGACY_CONTROL_PATH,
  DEEP_V3_KEEPER_V2_MANIFEST_PATH,
  DEEP_V3_KEEPER_V2_MAX_ACTIVE_PENDING,
  DEEP_V3_KEEPER_V2_MAX_CANDIDATES,
  DEEP_V3_KEEPER_V2_MAX_COMPOUND_NATIVE,
  DEEP_V3_KEEPER_V2_MAX_HISTORY,
  DEEP_V3_KEEPER_V2_MAX_NEW_SUBMISSIONS,
  DEEP_V3_KEEPER_V2_MAX_OPERATOR_INCIDENTS,
  DEEP_V3_KEEPER_V2_MAX_SCAN_PAGES,
  DEEP_V3_KEEPER_V2_MAX_TOTAL_GAS_PER_TICK,
  DEEP_V3_KEEPER_V2_MAX_TRANSACTION_GAS,
  DEEP_V3_KEEPER_V2_RELEASE,
  DEEP_V3_KEEPER_V2_SCAN_PAGE_SIZE,
} from "./config-v2.mjs";

export const DEEP_V3_OPS_V2_BINDING_PATH =
  "ops/deep-keeper-v3/reviewed-ops-v2-binding.json";
export const DEEP_V3_OPS_V2_EXECUTION_PATH =
  "/api/ops/deep-v3-keeper-v2";

const DEEP_V3_RELEASE_VERSION = "deep-full-range-v3";
const DEEP_V3_INTERNAL_CONTRACT_RELEASE =
  "liquidity-growth-full-range-v3";
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

const GAS_MIXTURES = Object.freeze([
  Object.freeze({
    compoundCandidates: 0,
    oracleCandidates: 4,
    theoreticalGas: "7870636",
  }),
  Object.freeze({
    compoundCandidates: 1,
    oracleCandidates: 3,
    theoreticalGas: "10308732",
  }),
  Object.freeze({
    compoundCandidates: 2,
    oracleCandidates: 2,
    theoreticalGas: "12746828",
  }),
  Object.freeze({
    compoundCandidates: 3,
    oracleCandidates: 1,
    theoreticalGas: "15184924",
  }),
  Object.freeze({
    compoundCandidates: 4,
    oracleCandidates: 0,
    theoreticalGas: "17623020",
  }),
]);

function validHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function validCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value);
}

function validBlock(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    isAddress(left) &&
    isAddress(right) &&
    getAddress(left) === getAddress(right)
  );
}

function exactObject(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") ===
      Object.keys(expected).sort().join(",") &&
    Object.entries(expected).every(
      ([key, expectedValue]) => value[key] === expectedValue,
    )
  );
}

function exactGasMixtures(value) {
  return (
    Array.isArray(value) &&
    value.length === GAS_MIXTURES.length &&
    value.every((entry, index) =>
      exactObject(entry, GAS_MIXTURES[index]),
    )
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

function exactDeployment(release, key) {
  const transaction = release?.transactions?.[key];
  const block = release?.deploymentBlocks?.[key];
  const evidence = release?.deploymentEvidence?.[key];
  return (
    validHash(transaction) &&
    validBlock(block) &&
    evidence?.receiptStatus === "success" &&
    evidence.transactionHash === transaction &&
    evidence.blockNumber === block &&
    validHash(evidence.blockHash)
  );
}

export function validDeepV3OpsV2ReviewedBinding(binding) {
  return (
    binding?.schemaVersion === 2 &&
    binding.status === "reviewed" &&
    binding.manifestPath === DEEP_V3_KEEPER_V2_MANIFEST_PATH &&
    binding.model === "deep" &&
    binding.releaseVersion === DEEP_V3_RELEASE_VERSION &&
    binding.internalContractRelease ===
      DEEP_V3_INTERNAL_CONTRACT_RELEASE &&
    binding.keeperReleaseVersion === DEEP_V3_KEEPER_V2_RELEASE &&
    validCommit(binding.releaseCommit) &&
    validHash(binding.sourceCommitment) &&
    validHash(binding.opsSourceCommitment) &&
    isAddress(binding.signerAddress ?? "") &&
    isAddress(binding.automationAddress ?? "") &&
    validHash(binding.automationRuntimeCodeHash) &&
    binding.automationFqcn === RELEASE_COMPONENTS.automation &&
    isAddress(binding.launcherAddress ?? "") &&
    validHash(binding.launcherRuntimeCodeHash) &&
    binding.launcherFqcn === RELEASE_COMPONENTS.launcher &&
    isAddress(binding.vaultFactoryAddress ?? "") &&
    validHash(binding.vaultFactoryRuntimeCodeHash) &&
    binding.vaultFactoryFqcn === RELEASE_COMPONENTS.growthVaultFactory &&
    isAddress(binding.executorAddress ?? "") &&
    validHash(binding.executorRuntimeCodeHash) &&
    binding.executorFqcn === RELEASE_COMPONENTS.keeperExecutor
  );
}

function exactKeeperPolicy(release, config) {
  const policy = release?.keeperPolicy;
  return (
    policy?.status === "reviewed-active" &&
    policy.enabled === true &&
    policy.transactionSubmission === true &&
    sameAddress(
      policy.keeperExecutor,
      release?.addresses?.keeperExecutor,
    ) &&
    policy.keeperExecutorRuntimeCodeHash ===
      release?.runtimeCodeHashes?.keeperExecutor &&
    sameAddress(policy.automation, release?.addresses?.automation) &&
    policy.automationRuntimeCodeHash ===
      release?.runtimeCodeHashes?.automation &&
    sameAddress(
      policy.signerAddress,
      config?.signerLanes?.[0]?.signerAddress,
    ) &&
    policy.signingBackend === "privy-policy-wallet" &&
    policy.executionPath === DEEP_V3_OPS_V2_EXECUTION_PATH &&
    policy.controlPath === DEEP_V3_KEEPER_V2_CONTROL_PATH &&
    policy.legacyControlPath ===
      DEEP_V3_KEEPER_V2_LEGACY_CONTROL_PATH &&
    policy.controlSchemaVersion === 2 &&
    policy.signerLaneCount === 1 &&
    policy.confirmations === DEEP_V3_KEEPER_V2_CONFIRMATIONS &&
    policy.independentReadRpcCount === 2 &&
    policy.intervalMilliseconds === DEEP_V3_KEEPER_V2_INTERVAL_MS &&
    policy.scanPageSize === DEEP_V3_KEEPER_V2_SCAN_PAGE_SIZE &&
    policy.maxScanPages === DEEP_V3_KEEPER_V2_MAX_SCAN_PAGES &&
    policy.maxCandidatesPerBatch ===
      DEEP_V3_KEEPER_V2_MAX_CANDIDATES &&
    policy.maxNewSubmissionsPerTick ===
      DEEP_V3_KEEPER_V2_MAX_NEW_SUBMISSIONS &&
    policy.maxActivePendingBatches ===
      DEEP_V3_KEEPER_V2_MAX_ACTIVE_PENDING &&
    policy.maxOperatorIncidents ===
      DEEP_V3_KEEPER_V2_MAX_OPERATOR_INCIDENTS &&
    policy.maxHistoryEntries === DEEP_V3_KEEPER_V2_MAX_HISTORY &&
    policy.maximumTransactionGas ===
      DEEP_V3_KEEPER_V2_MAX_TRANSACTION_GAS.toString() &&
    policy.maximumTotalGasPerTick ===
      DEEP_V3_KEEPER_V2_MAX_TOTAL_GAS_PER_TICK.toString() &&
    policy.maximumCompoundNativeWei ===
      DEEP_V3_KEEPER_V2_MAX_COMPOUND_NATIVE.toString() &&
    policy.minGrowthToMaxGasRatioBps ===
      config?.minGrowthToMaxGasRatioBps &&
    policy.maxFeePerGasWei === config?.maxFeePerGasWei?.toString() &&
    policy.maxTotalDebitWeiPerTick ===
      config?.maxTotalDebitWeiPerTick?.toString() &&
    policy.maxTotalDebitWeiPerDay ===
      config?.maxTotalDebitWeiPerDay?.toString() &&
    policy.signerBalanceFloorWei ===
      config?.signerBalanceFloorWei?.toString() &&
    policy.measuredCompoundGas === "2884090" &&
    policy.reviewedPerVaultGasCeiling === "4428255" &&
    exactGasMixtures(policy.gasMixtures) &&
    policy.opsSourceCommitment === config?.opsSourceCommitment &&
    policy.deploymentCommit === release?.releaseCommit &&
    policy.reviewedBindingPath === DEEP_V3_OPS_V2_BINDING_PATH
  );
}

export function evaluateDeepV3KeeperV2ReleaseGate(
  release,
  config,
  binding,
  currentOpsSourceCommitment,
) {
  const reasons = [];
  const require = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };
  const reviewed = validDeepV3OpsV2ReviewedBinding(binding);
  const componentKeys = Object.keys(RELEASE_COMPONENTS);

  require(reviewed, "reviewed Deep V3 ops v2 binding");
  require(release?.schemaVersion === 3, "manifest schema");
  require(release?.model === "deep", "model identity");
  require(release?.chainId === 1, "Ethereum Mainnet chain");
  require(
    release?.releaseManifest === DEEP_V3_KEEPER_V2_MANIFEST_PATH,
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
    release?.keeperReleaseVersion === DEEP_V3_KEEPER_V2_RELEASE,
    "keeper release version",
  );
  require(
    release?.status ===
        "deployment-source-lifecycle-and-keeper-verified" &&
      release.releaseEligible === true,
    "release eligibility",
  );
  require(config?.enabled === true, "keeper activation");
  require(config?.sendTransactions === true, "transaction activation");
  require(
    validCommit(release?.releaseCommit) &&
      config?.deploymentCommit === release.releaseCommit &&
      (!reviewed ||
        binding.releaseCommit === release.releaseCommit) &&
      release?.keeperPolicy?.deploymentCommit ===
        release.releaseCommit,
    "deployment commit",
  );
  require(
    Array.isArray(release?.blockers) &&
      release.blockers.length === 0,
    "release blockers",
  );
  require(
    reviewed &&
      release?.releaseCommit === binding.releaseCommit &&
      release?.sourceCommitment === binding.sourceCommitment &&
      release?.sourceCommitment === config?.sourceCommitment &&
      release?.keeperPolicy?.opsSourceCommitment ===
        binding.opsSourceCommitment &&
      release?.keeperPolicy?.opsSourceCommitment ===
        config?.opsSourceCommitment &&
      release?.keeperPolicy?.opsSourceCommitment ===
        currentOpsSourceCommitment,
    "source commitments",
  );

  for (const key of componentKeys) {
    require(
      isAddress(release?.addresses?.[key] ?? "") &&
        validHash(release?.runtimeCodeHashes?.[key]),
      `${key} runtime`,
    );
    require(exactDeployment(release, key), `${key} deployment receipt`);
    require(
      exactSourceMatch(
        release?.sourceVerification?.contracts?.[key],
        release?.addresses?.[key],
        RELEASE_COMPONENTS[key],
      ),
      `${key} source verification`,
    );
    require(
      release?.storageSafety?.contracts?.[key] === true,
      `${key} storage safety`,
    );
  }

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
    require(
      reviewed &&
        sameAddress(
          release?.addresses?.[manifestKey],
          binding[bindingAddressKey],
        ) &&
        sameAddress(
          release?.addresses?.[manifestKey],
          config?.[bindingAddressKey],
        ),
      `${manifestKey} address`,
    );
    require(
      reviewed &&
        release?.runtimeCodeHashes?.[manifestKey] ===
          binding[bindingHashKey] &&
        release?.runtimeCodeHashes?.[manifestKey] ===
          config?.[configHashKey],
      `${manifestKey} runtime binding`,
    );
  }
  require(
    reviewed &&
      sameAddress(
        binding.signerAddress,
        config?.signerLanes?.[0]?.signerAddress,
      ),
    "reviewed signer",
  );
  require(
    exactObject(release?.fixedPolicy, FIXED_POLICY),
    "fixed policy",
  );
  require(
    release?.transactionCount === 6 &&
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
  require(
    release?.storageSafety?.status ===
        "verified-empty-eip1967-slots" &&
      release.storageSafety.proxyAdminBeaconSlotsEmpty === true,
    "storage safety",
  );
  require(exactKeeperPolicy(release, config), "keeper policy");

  const lifecycle = release?.lifecycleEvidence;
  require(
    lifecycle?.status === "verified-current-release" &&
      lifecycle.releaseEligible === true &&
      lifecycle.requiredRelease === DEEP_V3_RELEASE_VERSION &&
      lifecycle.independentRpcCount === 2 &&
      isAddress(lifecycle.canaryToken ?? "") &&
      isAddress(lifecycle.canaryVault ?? "") &&
      validHash(lifecycle.poolId) &&
      validHash(lifecycle.launchTransaction) &&
      validHash(lifecycle.oracleTransaction) &&
      validHash(lifecycle.compoundTransaction) &&
      validHash(lifecycle.evidenceHash) &&
      lifecycle.noActionKeeperCycle?.status ===
        "verified-no-transaction" &&
      lifecycle.noActionKeeperCycle?.submittedTransaction === false &&
      validBlock(
        lifecycle.noActionKeeperCycle?.observedAtBlock,
      ) &&
      lifecycle.actionableKeeperCycle?.status ===
        "verified-compound-confirmed" &&
      lifecycle.actionableKeeperCycle?.submittedTransaction === true &&
      lifecycle.actionableKeeperCycle?.transactionHash ===
        lifecycle.compoundTransaction &&
      validBlock(lifecycle.actionableKeeperCycle?.observedAtBlock) &&
      validBlock(lifecycle.actionableKeeperCycle?.blockNumber),
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
