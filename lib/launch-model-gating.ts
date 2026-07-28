import { isAddress, isHex } from "viem";

import type { LaunchModel } from "./launch";

const implementedLaunchModels = new Set<LaunchModel>([
  "classic",
  "classic-v3",
  "adaptive",
  "deep",
]);

export const RESERVED_LAUNCH_MODEL_IDS = [
  "liquidity-growth",
] as const;

export type ReservedLaunchModelId =
  (typeof RESERVED_LAUNCH_MODEL_IDS)[number];

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

function validBlockNumber(value: unknown) {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
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

export function resolveReservedLaunchModel(
  value: unknown,
): "deep" | null {
  return value === "liquidity-growth" ? "deep" : null;
}

export function isFutureLaunchModelManifestEligible(
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
    release.internalContractRelease ===
      "liquidity-growth-full-range-v1" &&
    release.releaseVersion === "deep-full-range-v1" &&
    validReleaseCommit(release.releaseCommit) &&
    validRuntimeHash(release.sourceCommitment) &&
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
  return isFutureLaunchModelManifestEligible(
    "deep",
    manifest,
    expectedChainId,
  )
    ? manifest.launchModelReleases?.deep ?? null
    : null;
}
