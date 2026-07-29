import { isAddress, isHex } from "viem";

import reviewedReleaseBindingJson from "@/ops/deep-keeper-v2/reviewed-release-binding.json";

import {
  DEEP_V2_INTERNAL_CONTRACT_RELEASE,
  DEEP_V2_RELEASE_MANIFEST,
  DEEP_V2_RELEASE_VERSION,
} from "./deep-v2";

const AUTOMATION_FQCN =
  "src/LiquidityGrowthFullRangeAutomationV2.sol:LiquidityGrowthFullRangeAutomationV2";
const KEEPER_EXECUTOR_FQCN =
  "src/DeepKeeperExecutorV1.sol:DeepKeeperExecutorV1";

export type DeepV2ReviewedReleaseBinding = {
  schemaVersion?: unknown;
  status?: unknown;
  manifestPath?: unknown;
  model?: unknown;
  releaseVersion?: unknown;
  internalContractRelease?: unknown;
  sourceCommitment?: unknown;
  automationAddress?: unknown;
  automationRuntimeCodeHash?: unknown;
  automationFqcn?: unknown;
  coordinatorAddress?: unknown;
  coordinatorRuntimeCodeHash?: unknown;
  coordinatorSourceCommitment?: unknown;
  coordinatorFqcn?: unknown;
};

type DeepV2ReleaseBindingTarget = {
  model?: unknown;
  releaseVersion?: unknown;
  internalContractRelease?: unknown;
  sourceCommitment?: unknown;
  releaseManifest?: unknown;
  automation?: unknown;
  keeperExecutor?: unknown;
  keeperExecutorRuntimeCodeHash?: unknown;
  keeperExecutorSourceCommitment?: unknown;
  runtimeCodeHashes?: {
    automation?: unknown;
  };
};

function validHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
  );
}

function sameHex(left: unknown, right: unknown) {
  return (
    validHash(left) &&
    validHash(right) &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function sameAddress(left: unknown, right: unknown) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    isAddress(left) &&
    isAddress(right) &&
    left.toLowerCase() === right.toLowerCase()
  );
}

export const deepV2ReviewedReleaseBinding =
  reviewedReleaseBindingJson as DeepV2ReviewedReleaseBinding;

export function isDeepV2ReleaseBoundToReviewedKeeper(
  release: DeepV2ReleaseBindingTarget | undefined,
  binding: DeepV2ReviewedReleaseBinding =
    deepV2ReviewedReleaseBinding,
) {
  return (
    release !== undefined &&
    binding.schemaVersion === 1 &&
    binding.status === "reviewed" &&
    binding.manifestPath === DEEP_V2_RELEASE_MANIFEST &&
    binding.manifestPath === release.releaseManifest &&
    binding.model === "deep" &&
    binding.model === release.model &&
    binding.releaseVersion === DEEP_V2_RELEASE_VERSION &&
    binding.releaseVersion === release.releaseVersion &&
    binding.internalContractRelease ===
      DEEP_V2_INTERNAL_CONTRACT_RELEASE &&
    binding.internalContractRelease ===
      release.internalContractRelease &&
    sameHex(binding.sourceCommitment, release.sourceCommitment) &&
    sameAddress(binding.automationAddress, release.automation) &&
    sameHex(
      binding.automationRuntimeCodeHash,
      release.runtimeCodeHashes?.automation,
    ) &&
    binding.automationFqcn === AUTOMATION_FQCN &&
    sameAddress(binding.coordinatorAddress, release.keeperExecutor) &&
    !sameAddress(binding.coordinatorAddress, binding.automationAddress) &&
    sameHex(
      binding.coordinatorRuntimeCodeHash,
      release.keeperExecutorRuntimeCodeHash,
    ) &&
    sameHex(
      binding.coordinatorSourceCommitment,
      release.keeperExecutorSourceCommitment,
    ) &&
    binding.coordinatorFqcn === KEEPER_EXECUTOR_FQCN
  );
}
