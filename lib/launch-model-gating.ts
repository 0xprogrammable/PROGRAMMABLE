import { isAddress, isHex } from "viem";

import {
  DEEP_V2_INTERNAL_CONTRACT_RELEASE,
  DEEP_V2_KEEPER_COMPATIBILITY_STATUS,
  DEEP_V2_KEEPER_RELEASE_VERSION,
  DEEP_V2_MANIFEST_FIXED_POLICY,
  DEEP_V2_RELEASE_MANIFEST,
  DEEP_V2_RELEASE_VERSION,
} from "./deep-v2";
import {
  deepV2ReviewedReleaseBinding,
  isDeepV2ReleaseBoundToReviewedKeeper,
  type DeepV2ReviewedReleaseBinding,
} from "./deep-v2-release-binding";
import type { LaunchModel } from "./launch";

const DEEP_V1_SOURCE_COMMITMENT =
  "0x82f6e2745dfbf54f40eae80df645bc75a7952e0505dd0621437dd233a619acfd";
const DEEP_V1_KEEPER_EXECUTOR_SOURCE_COMMITMENT =
  "0x9072fa857d484b944205a969fda41727fa76d0f9e670916451b308615bb82175";
const DEEP_V1_KEEPER_EXECUTOR_RUNTIME_CODE_HASH =
  "0xd4a6e8f200bd63ab924f5c4cfb1bbcc07c26c7b7b7abaa1f879418d2435f48e6";

const implementedLaunchModels = new Set<LaunchModel>([
  "classic",
  "classic-v3",
  "deep",
  "stock-paired",
]);

export const RESERVED_LAUNCH_MODEL_IDS = ["liquidity-growth"] as const;

export type ReservedLaunchModelId = (typeof RESERVED_LAUNCH_MODEL_IDS)[number];

export type DeepV2FixedPolicyManifest = {
  tokenSupplyWei?: unknown;
  tokenReserveTargetWei?: unknown;
  growthTargetNativeWei?: unknown;
  totalSwapFeeBps?: unknown;
  creatorFeeBps?: unknown;
  programmableFeeBps?: unknown;
  minimumInitialBuyWei?: unknown;
  initialTick?: unknown;
  tickSpacing?: unknown;
  lpFeePips?: unknown;
  twapWindowSeconds?: unknown;
  oracleRangeHalfWidthTicks?: unknown;
  maximumSpotTwapDeviationTicks?: unknown;
  maximumAbsoluteTickDelta?: unknown;
  compoundCooldownSeconds?: unknown;
  rollingExposureWindowSeconds?: unknown;
  rollingExposureRecordCapacity?: unknown;
  minimumKeeperProcessNativeWei?: unknown;
  oracleObservationCardinalityTarget?: unknown;
};

export type DeepLaunchModelRelease = {
  schemaVersion?: unknown;
  model?: unknown;
  internalContractRelease?: unknown;
  releaseVersion?: unknown;
  releaseCommit?: unknown;
  sourceCommitment?: unknown;
  releaseManifest?: unknown;
  status?: unknown;
  releaseEligible?: unknown;
  sourceVerificationStatus?: unknown;
  deploymentVerificationStatus?: unknown;
  launcher?: unknown;
  hookFactory?: unknown;
  feeHook?: unknown;
  feeSplitVaultFactory?: unknown;
  rangeSourceFactory?: unknown;
  growthVaultFactory?: unknown;
  growthVaultImplementation?: unknown;
  automation?: unknown;
  positionPlanner?: unknown;
  positionForwarderFactory?: unknown;
  startBlock?: unknown;
  deploymentBlock?: unknown;
  deploymentTransaction?: unknown;
  lifecycleEvidenceHash?: unknown;
  lifecycleStatus?: unknown;
  lifecycleIndependentRpcCount?: unknown;
  lifecycleLaunchTransaction?: unknown;
  lifecycleOracleTransaction?: unknown;
  lifecycleFeeProcessCompoundTransaction?: unknown;
  keeperReleaseVersion?: unknown;
  keeperCompatibilityStatus?: unknown;
  keeperExecutor?: unknown;
  keeperExecutorRuntimeCodeHash?: unknown;
  keeperExecutorSourceCommitment?: unknown;
  keeperExecutorDeploymentTransaction?: unknown;
  keeperExecutorDeploymentBlock?: unknown;
  keeperExecutorSourceVerificationStatus?: unknown;
  fixedPolicy?: DeepV2FixedPolicyManifest;
  runtimeCodeHashes?: {
    launcher?: unknown;
    hookFactory?: unknown;
    feeHook?: unknown;
    feeSplitVaultFactory?: unknown;
    rangeSourceFactory?: unknown;
    growthVaultFactory?: unknown;
    growthVaultImplementation?: unknown;
    automation?: unknown;
    positionPlanner?: unknown;
    positionForwarderFactory?: unknown;
  };
};

export type LaunchModelReleaseManifest = {
  chainId?: unknown;
  status?: unknown;
  launchModelReleases?: {
    deep?: DeepLaunchModelRelease;
  };
};

function validAddress(value: unknown) {
  return typeof value === "string" && isAddress(value);
}

function validRuntimeHash(value: unknown) {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
  );
}

function validReleaseCommit(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function validBlockNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function distinctHashes(values: unknown[]) {
  return (
    values.every(validRuntimeHash) &&
    new Set(values.map((value) => String(value).toLowerCase())).size ===
      values.length
  );
}

function validBlockOrder(later: unknown, earlier: unknown) {
  return (
    validBlockNumber(later) && validBlockNumber(earlier) && later >= earlier
  );
}

function exactDeepV2FixedPolicy(
  value: DeepV2FixedPolicyManifest | undefined,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const expected = DEEP_V2_MANIFEST_FIXED_POLICY;
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    Object.entries(expected).every(
      ([key, expectedValue]) =>
        value[key as keyof DeepV2FixedPolicyManifest] === expectedValue,
    )
  );
}

export function resolveImplementedLaunchModel(
  value: unknown,
): LaunchModel | null {
  return typeof value === "string" &&
    implementedLaunchModels.has(value as LaunchModel)
    ? (value as LaunchModel)
    : null;
}

export function resolveReservedLaunchModel(value: unknown): "deep" | null {
  return value === "liquidity-growth" ? "deep" : null;
}

export function isFutureLaunchModelManifestEligible(
  value: unknown,
  manifest: LaunchModelReleaseManifest,
  expectedChainId: number,
  reviewedBinding: DeepV2ReviewedReleaseBinding =
    deepV2ReviewedReleaseBinding,
) {
  const model = resolveReservedLaunchModel(value);
  const canonicalModel = value === "deep" ? "deep" : model;
  if (!canonicalModel) return false;

  const release = manifest.launchModelReleases?.[canonicalModel];
  const hashes = release?.runtimeCodeHashes;
  return (
    manifest.chainId === expectedChainId &&
    manifest.status === "ready" &&
    release?.schemaVersion === 2 &&
    release.model === "deep" &&
    release.internalContractRelease === DEEP_V2_INTERNAL_CONTRACT_RELEASE &&
    release.releaseVersion === DEEP_V2_RELEASE_VERSION &&
    validReleaseCommit(release.releaseCommit) &&
    validRuntimeHash(release.sourceCommitment) &&
    release.releaseManifest === DEEP_V2_RELEASE_MANIFEST &&
    release.status === "deployment-source-and-lifecycle-verified" &&
    release.releaseEligible === true &&
    release.sourceVerificationStatus === "verified" &&
    release.deploymentVerificationStatus === "verified" &&
    validAddress(release.launcher) &&
    validAddress(release.hookFactory) &&
    validAddress(release.feeHook) &&
    validAddress(release.feeSplitVaultFactory) &&
    validAddress(release.rangeSourceFactory) &&
    validAddress(release.growthVaultFactory) &&
    validAddress(release.growthVaultImplementation) &&
    validAddress(release.automation) &&
    validAddress(release.positionPlanner) &&
    validAddress(release.positionForwarderFactory) &&
    validBlockNumber(release.startBlock) &&
    validBlockNumber(release.deploymentBlock) &&
    release.startBlock === release.deploymentBlock &&
    validRuntimeHash(release.deploymentTransaction) &&
    validRuntimeHash(release.lifecycleEvidenceHash) &&
    release.lifecycleStatus === "verified-current-release" &&
    release.lifecycleIndependentRpcCount === 2 &&
    validRuntimeHash(release.lifecycleLaunchTransaction) &&
    validRuntimeHash(release.lifecycleOracleTransaction) &&
    validRuntimeHash(release.lifecycleFeeProcessCompoundTransaction) &&
    release.keeperReleaseVersion === DEEP_V2_KEEPER_RELEASE_VERSION &&
    release.keeperCompatibilityStatus ===
      DEEP_V2_KEEPER_COMPATIBILITY_STATUS &&
    validAddress(release.keeperExecutor) &&
    validRuntimeHash(release.keeperExecutorRuntimeCodeHash) &&
    validRuntimeHash(release.keeperExecutorSourceCommitment) &&
    validRuntimeHash(release.keeperExecutorDeploymentTransaction) &&
    validBlockNumber(release.keeperExecutorDeploymentBlock) &&
    validBlockOrder(
      release.keeperExecutorDeploymentBlock,
      release.deploymentBlock,
    ) &&
    distinctHashes([
      release.lifecycleLaunchTransaction,
      release.lifecycleOracleTransaction,
      release.lifecycleFeeProcessCompoundTransaction,
      release.keeperExecutorDeploymentTransaction,
    ]) &&
    release.keeperExecutorSourceVerificationStatus ===
      "etherscan-and-sourcify-exact-match" &&
    validRuntimeHash(hashes?.launcher) &&
    validRuntimeHash(hashes?.hookFactory) &&
    validRuntimeHash(hashes?.feeHook) &&
    validRuntimeHash(hashes?.feeSplitVaultFactory) &&
    validRuntimeHash(hashes?.rangeSourceFactory) &&
    validRuntimeHash(hashes?.growthVaultFactory) &&
    validRuntimeHash(hashes?.growthVaultImplementation) &&
    validRuntimeHash(hashes?.automation) &&
    validRuntimeHash(hashes?.positionPlanner) &&
    validRuntimeHash(hashes?.positionForwarderFactory) &&
    exactDeepV2FixedPolicy(release.fixedPolicy) &&
    isDeepV2ReleaseBoundToReviewedKeeper(release, reviewedBinding)
  );
}

export function isHistoricalDeepV1ManifestEligible(
  value: unknown,
  manifest: LaunchModelReleaseManifest,
  expectedChainId: number,
) {
  const model = resolveReservedLaunchModel(value);
  const canonicalModel = value === "deep" ? "deep" : model;
  if (!canonicalModel) return false;

  const release = manifest.launchModelReleases?.[canonicalModel];
  const hashes = release?.runtimeCodeHashes;
  return (
    manifest.chainId === expectedChainId &&
    manifest.status === "ready" &&
    release?.schemaVersion === 1 &&
    release.model === "deep" &&
    release.internalContractRelease === "liquidity-growth-full-range-v1" &&
    release.releaseVersion === "deep-full-range-v1" &&
    validReleaseCommit(release.releaseCommit) &&
    release.sourceCommitment === DEEP_V1_SOURCE_COMMITMENT &&
    release.releaseManifest ===
      "contracts/deployments/mainnet-deep-full-range-v1.json" &&
    release.status === "deployment-source-and-lifecycle-verified" &&
    release.releaseEligible === true &&
    release.sourceVerificationStatus === "verified" &&
    release.deploymentVerificationStatus === "verified" &&
    validAddress(release.launcher) &&
    validAddress(release.hookFactory) &&
    validAddress(release.feeHook) &&
    validAddress(release.feeSplitVaultFactory) &&
    validAddress(release.rangeSourceFactory) &&
    validAddress(release.growthVaultFactory) &&
    validAddress(release.growthVaultImplementation) &&
    validAddress(release.automation) &&
    validAddress(release.positionPlanner) &&
    validAddress(release.positionForwarderFactory) &&
    validBlockNumber(release.startBlock) &&
    validBlockNumber(release.deploymentBlock) &&
    release.startBlock === release.deploymentBlock &&
    validRuntimeHash(release.deploymentTransaction) &&
    validRuntimeHash(release.lifecycleEvidenceHash) &&
    release.lifecycleStatus === "verified-current-release" &&
    release.lifecycleIndependentRpcCount === 2 &&
    validRuntimeHash(release.lifecycleLaunchTransaction) &&
    validRuntimeHash(release.lifecycleOracleTransaction) &&
    validRuntimeHash(release.lifecycleFeeProcessCompoundTransaction) &&
    validAddress(release.keeperExecutor) &&
    release.keeperExecutorRuntimeCodeHash ===
      DEEP_V1_KEEPER_EXECUTOR_RUNTIME_CODE_HASH &&
    release.keeperExecutorSourceCommitment ===
      DEEP_V1_KEEPER_EXECUTOR_SOURCE_COMMITMENT &&
    validRuntimeHash(release.keeperExecutorDeploymentTransaction) &&
    validBlockNumber(release.keeperExecutorDeploymentBlock) &&
    validBlockOrder(
      release.keeperExecutorDeploymentBlock,
      release.deploymentBlock,
    ) &&
    distinctHashes([
      release.lifecycleLaunchTransaction,
      release.lifecycleOracleTransaction,
      release.lifecycleFeeProcessCompoundTransaction,
      release.keeperExecutorDeploymentTransaction,
    ]) &&
    release.keeperExecutorSourceVerificationStatus ===
      "etherscan-and-sourcify-exact-match" &&
    validRuntimeHash(hashes?.launcher) &&
    validRuntimeHash(hashes?.hookFactory) &&
    validRuntimeHash(hashes?.feeHook) &&
    validRuntimeHash(hashes?.feeSplitVaultFactory) &&
    validRuntimeHash(hashes?.rangeSourceFactory) &&
    validRuntimeHash(hashes?.growthVaultFactory) &&
    validRuntimeHash(hashes?.growthVaultImplementation) &&
    validRuntimeHash(hashes?.automation) &&
    validRuntimeHash(hashes?.positionPlanner) &&
    validRuntimeHash(hashes?.positionForwarderFactory)
  );
}

export function getVerifiedDeepRelease(
  manifest: LaunchModelReleaseManifest,
  expectedChainId: number,
) {
  return isHistoricalDeepV1ManifestEligible(
    "deep",
    manifest,
    expectedChainId,
  )
    ? (manifest.launchModelReleases?.deep ?? null)
    : null;
}

export function getVerifiedDeepV2Release(
  manifest: LaunchModelReleaseManifest,
  expectedChainId: number,
  reviewedBinding: DeepV2ReviewedReleaseBinding =
    deepV2ReviewedReleaseBinding,
) {
  return isFutureLaunchModelManifestEligible(
    "deep",
    manifest,
    expectedChainId,
    reviewedBinding,
  )
    ? (manifest.launchModelReleases?.deep ?? null)
    : null;
}
