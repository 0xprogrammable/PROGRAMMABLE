import { getAddress, isAddress } from "viem";

import {
  DEEP_V2_KEEPER_DEFAULT_MAX_BATCH_SIZE,
  DEEP_V2_KEEPER_DEFAULT_MAX_GAS,
  DEEP_V2_KEEPER_DEFAULT_VAULT_SUBSIDY_CAP_WEI,
  DEEP_V2_KEEPER_EXTENDED_BATCH_MIN_GAS,
  DEEP_V2_KEEPER_INTERVAL_MS,
  DEEP_V2_KEEPER_MAX_OPERATIONAL_BATCH_SIZE,
  DEEP_V2_RELEASE_MANIFEST_PATH,
} from "./config.mjs";

export const DEEP_V2_RELEASE_VERSION = "deep-full-range-v2";
export const DEEP_V2_INTERNAL_CONTRACT_RELEASE =
  "liquidity-growth-full-range-v2";
export const DEEP_V2_KEEPER_RELEASE_VERSION = "deep-keeper-v2";
export const DEEP_V2_KEEPER_COMPATIBILITY_STATUS = "verified-deep-v2";

const DEEP_V2_FIXED_POLICY = Object.freeze({
  tokenSupplyWei: "1000000000000000000000000000",
  tokenReserveTargetWei: "150000000000000000000000000",
  growthTargetNativeWei: "50000000000000000",
  totalSwapFeeBps: 100,
  creatorFeeBps: 90,
  programmableFeeBps: 10,
  minimumInitialBuyWei: "600000000000000",
  initialTick: 204_200,
  tickSpacing: 200,
  lpFeePips: 0,
  twapWindowSeconds: 1_800,
  oracleRangeHalfWidthTicks: 20_000,
  maximumSpotTwapDeviationTicks: 600,
  maximumAbsoluteTickDelta: 400,
  compoundCooldownSeconds: 300,
  rollingExposureWindowSeconds: 1_800,
  rollingExposureRecordCapacity: 8,
  minimumKeeperProcessNativeWei: "2000000000000000",
  oracleObservationCardinalityTarget: 192,
});

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function validHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function exactFixedPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(DEEP_V2_FIXED_POLICY).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    Object.entries(DEEP_V2_FIXED_POLICY).every(
      ([key, expected]) => value[key] === expected,
    )
  );
}

function exactSourceVerified(record, address, fqcn) {
  if (
    !record ||
    record.fqcn !== fqcn ||
    record.etherscan?.status !== "exact-match" ||
    record.sourcify?.status !== "exact-match" ||
    !isAddress(address)
  ) {
    return false;
  }
  const checksum = getAddress(address);
  return (
    record.etherscan.url ===
      `https://etherscan.io/address/${checksum}#code` &&
    record.sourcify.url ===
      `https://repo.sourcify.dev/contracts/full_match/1/${checksum}/`
  );
}

function validReviewedBinding(binding) {
  return (
    binding?.schemaVersion === 1 &&
    binding.status === "reviewed" &&
    binding.manifestPath === DEEP_V2_RELEASE_MANIFEST_PATH &&
    binding.model === "deep" &&
    binding.releaseVersion === DEEP_V2_RELEASE_VERSION &&
    binding.internalContractRelease === DEEP_V2_INTERNAL_CONTRACT_RELEASE &&
    validHash(binding.sourceCommitment) &&
    isAddress(binding.automationAddress ?? "") &&
    validHash(binding.automationRuntimeCodeHash) &&
    typeof binding.automationFqcn === "string" &&
    binding.automationFqcn.length > 0 &&
    isAddress(binding.coordinatorAddress ?? "") &&
    validHash(binding.coordinatorRuntimeCodeHash) &&
    validHash(binding.coordinatorSourceCommitment) &&
    typeof binding.coordinatorFqcn === "string" &&
    binding.coordinatorFqcn.length > 0
  );
}

/**
 * The checked-in reviewed binding is deliberately separate from the generated
 * deployment manifest. A manifest therefore cannot certify its own addresses,
 * runtime hashes or source commitment.
 */
export function evaluateDeepV2KeeperReleaseGate(release, config, binding) {
  const reasons = [];
  const reject = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };

  const bindingReady = validReviewedBinding(binding);
  reject(bindingReady, "reviewed V2 release binding");

  reject(release?.schemaVersion === 2, "manifest schema");
  reject(release?.chainId === 1, "Ethereum Mainnet chain");
  reject(release?.model === "deep", "Deep model identity");
  reject(
    release?.internalContractRelease ===
      DEEP_V2_INTERNAL_CONTRACT_RELEASE,
    "internal contract release",
  );
  reject(
    release?.releaseVersion === DEEP_V2_RELEASE_VERSION,
    "release version",
  );
  reject(
    release?.releaseManifest === DEEP_V2_RELEASE_MANIFEST_PATH,
    "release manifest path",
  );
  reject(
    release?.keeperReleaseVersion ===
      DEEP_V2_KEEPER_RELEASE_VERSION &&
      release?.keeperCompatibilityStatus ===
        DEEP_V2_KEEPER_COMPATIBILITY_STATUS,
    "Deep V2 keeper compatibility",
  );
  reject(
    bindingReady &&
      release?.sourceCommitment === binding.sourceCommitment,
    "source commitment",
  );
  reject(
    release?.status === "deployment-source-and-lifecycle-verified",
    "deployment status",
  );
  reject(release?.releaseEligible === true, "release eligibility");
  reject(COMMIT_PATTERN.test(release?.releaseCommit ?? ""), "release commit");
  reject(
    Number.isSafeInteger(release?.startBlock) && release.startBlock > 0,
    "start block",
  );
  reject(
    Array.isArray(release?.blockers) && release.blockers.length === 0,
    "release blockers",
  );

  const automation = release?.addresses?.automation;
  const automationRuntime = release?.runtimeCodeHashes?.automation;
  reject(
    bindingReady &&
      sameAddress(automation, binding.automationAddress),
    "reviewed automation address",
  );
  reject(
    bindingReady &&
      automationRuntime === binding.automationRuntimeCodeHash,
    "reviewed automation runtime hash",
  );
  reject(
    sameAddress(automation, config?.automationAddress),
    "configured automation",
  );
  reject(
    automationRuntime === config?.automationRuntimeHash,
    "configured automation runtime hash",
  );
  reject(
    validHash(release?.transactions?.automation) &&
      Number.isSafeInteger(release?.deploymentBlocks?.automation) &&
      release.deploymentBlocks.automation >= release.startBlock &&
      release?.deploymentEvidence?.automation?.receiptStatus === "success" &&
      release.deploymentEvidence.automation.transactionHash ===
        release.transactions.automation &&
      release.deploymentEvidence.automation.blockNumber ===
        release.deploymentBlocks.automation,
    "automation deployment receipt",
  );

  const lifecycle = release?.lifecycleEvidence;
  const coordinator = lifecycle?.keeperExecutor;
  const coordinatorRuntime = lifecycle?.keeperExecutorRuntimeCodeHash;
  reject(
    lifecycle?.status === "verified-current-release" &&
      lifecycle.releaseEligible === true &&
      lifecycle.requiredRelease === DEEP_V2_RELEASE_VERSION &&
      lifecycle.independentRpcCount === 2 &&
      typeof lifecycle.canaryToken === "string" &&
      isAddress(lifecycle.canaryToken) &&
      validHash(lifecycle.launchTransaction) &&
      validHash(lifecycle.oracleTransaction) &&
      validHash(lifecycle.feeProcessCompoundTransaction) &&
      validHash(lifecycle.keeperExecutorDeploymentTransaction) &&
      Number.isSafeInteger(lifecycle.keeperExecutorDeploymentBlock) &&
      lifecycle.keeperExecutorDeploymentBlock > 0 &&
      validHash(lifecycle.evidenceHash),
    "lifecycle evidence",
  );
  reject(
    lifecycle?.noActionKeeperCycle?.status ===
      "verified-no-transaction" &&
      lifecycle.noActionKeeperCycle.outcome === "idle" &&
      lifecycle.noActionKeeperCycle.readyVaults === 0 &&
      lifecycle.noActionKeeperCycle.submittedTransaction === false &&
      Number.isSafeInteger(
        lifecycle.noActionKeeperCycle.observedAtBlock,
      ) &&
      lifecycle.noActionKeeperCycle.observedAtBlock > 0 &&
      validHash(lifecycle.noActionKeeperCycle.evidenceHash),
    "no-action keeper evidence",
  );
  reject(
    lifecycle?.actionableKeeperCycle?.status ===
      "verified-compound-confirmed" &&
      lifecycle.actionableKeeperCycle.outcome ===
        "confirmed-productive" &&
      Number.isSafeInteger(
        lifecycle.actionableKeeperCycle.readyVaults,
      ) &&
      lifecycle.actionableKeeperCycle.readyVaults > 0 &&
      Number.isSafeInteger(
        lifecycle.actionableKeeperCycle.successfulCandidates,
      ) &&
      lifecycle.actionableKeeperCycle.successfulCandidates > 0 &&
      validHash(lifecycle.actionableKeeperCycle.transactionHash) &&
      lifecycle.actionableKeeperCycle.transactionHash ===
        lifecycle.feeProcessCompoundTransaction &&
      Number.isSafeInteger(
        lifecycle.actionableKeeperCycle.blockNumber,
      ) &&
      lifecycle.actionableKeeperCycle.blockNumber > 0 &&
      validHash(lifecycle.actionableKeeperCycle.evidenceHash),
    "actionable keeper evidence",
  );
  reject(
    bindingReady && sameAddress(coordinator, binding.coordinatorAddress),
    "reviewed keeper executor address",
  );
  reject(
    bindingReady &&
      coordinatorRuntime === binding.coordinatorRuntimeCodeHash,
    "reviewed keeper executor runtime hash",
  );
  reject(
    sameAddress(coordinator, config?.coordinatorAddress),
    "configured keeper executor",
  );
  reject(
    coordinatorRuntime === config?.coordinatorRuntimeHash,
    "configured keeper executor runtime hash",
  );
  reject(
    bindingReady &&
      config?.coordinatorSourceCommitment ===
        binding.coordinatorSourceCommitment,
    "configured keeper executor source commitment",
  );

  const source = release?.sourceVerification;
  reject(source?.status === "verified", "source verification");
  reject(
    bindingReady &&
      exactSourceVerified(
        source?.contracts?.automation,
        automation,
        binding.automationFqcn,
      ) &&
      Array.isArray(
        source?.contracts?.automation?.constructorArguments,
      ) &&
      source.contracts.automation.constructorArguments.length === 2 &&
      sameAddress(
        source.contracts.automation.constructorArguments[0],
        release?.addresses?.growthVaultFactory,
      ) &&
      sameAddress(
        source.contracts.automation.constructorArguments[1],
        release?.addresses?.launcher,
      ),
    "automation source verification",
  );
  reject(
    bindingReady &&
      exactSourceVerified(
        source?.contracts?.keeperExecutor,
        coordinator,
        binding.coordinatorFqcn,
      ) &&
      Array.isArray(
        source?.contracts?.keeperExecutor?.constructorArguments,
      ) &&
      source.contracts.keeperExecutor.constructorArguments.length === 1 &&
      sameAddress(
        source.contracts.keeperExecutor.constructorArguments[0],
        automation,
      ),
    "keeper executor source verification",
  );

  const policy = release?.keeperPolicy;
  reject(
    policy?.status === "verified-ready-disabled-by-default" &&
      policy.enabled === false &&
      policy.transactionSubmission === false,
    "keeper release policy",
  );
  reject(
    sameAddress(policy?.coordinator, coordinator) &&
      policy?.coordinatorRuntimeCodeHash === coordinatorRuntime &&
      bindingReady &&
      policy?.coordinatorSourceCommitment ===
        binding.coordinatorSourceCommitment &&
      sameAddress(policy?.automation, automation) &&
      policy?.automationRuntimeCodeHash === automationRuntime,
    "keeper executor binding",
  );
  reject(
    Boolean(config?.enabled) &&
      typeof config?.signerAddress === "string" &&
      sameAddress(policy?.signerAddress, config.signerAddress) &&
      policy?.signingBackend === "privy-policy-wallet",
    "keeper activation switches and signer",
  );
  reject(
    policy?.executionPath === "/api/ops/deep-v2-keeper",
    "keeper execution path",
  );
  reject(
    policy?.confirmations === config?.confirmations &&
      policy?.independentReadRpcCount === 2 &&
      config?.rpcUrls?.length === 2 &&
      new Set(config?.rpcUrls ?? []).size === 2 &&
      policy?.intervalMilliseconds === DEEP_V2_KEEPER_INTERVAL_MS &&
      config?.intervalMs === DEEP_V2_KEEPER_INTERVAL_MS &&
      policy?.defaultMaxBatchSize ===
        DEEP_V2_KEEPER_DEFAULT_MAX_BATCH_SIZE &&
      policy?.defaultMaxGas ===
        DEEP_V2_KEEPER_DEFAULT_MAX_GAS.toString() &&
      policy?.maximumOperationalBatchSize ===
        DEEP_V2_KEEPER_MAX_OPERATIONAL_BATCH_SIZE &&
      policy?.extendedBatchMinimumGas ===
        DEEP_V2_KEEPER_EXTENDED_BATCH_MIN_GAS.toString() &&
      policy?.vaultSubsidyCapWei ===
        DEEP_V2_KEEPER_DEFAULT_VAULT_SUBSIDY_CAP_WEI.toString() &&
      config?.maxBatchSize ===
        DEEP_V2_KEEPER_DEFAULT_MAX_BATCH_SIZE &&
      config?.scanLimit === DEEP_V2_KEEPER_DEFAULT_MAX_BATCH_SIZE &&
      config?.maxGas === DEEP_V2_KEEPER_DEFAULT_MAX_GAS &&
      config?.vaultSubsidyCapWei ===
        DEEP_V2_KEEPER_DEFAULT_VAULT_SUBSIDY_CAP_WEI,
    "keeper operating envelope",
  );
  reject(
    release?.activation?.appStatus === "ready" &&
      release?.activation?.keeperStatus === "ready" &&
      release.activation.requiresExactManifestMatch === true,
    "keeper activation",
  );
  reject(exactFixedPolicy(release?.fixedPolicy), "fixed Deep V2 policy");

  return Object.freeze({
    ready: reasons.length === 0,
    reasons: Object.freeze(reasons),
    releaseVersion: release?.releaseVersion ?? null,
    sourceCommitment: release?.sourceCommitment ?? null,
    startBlock: release?.startBlock ?? null,
  });
}
