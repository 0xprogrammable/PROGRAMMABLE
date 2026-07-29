import { getAddress, isAddress } from "viem";

import appDeployments from "../contracts/config/app-deployments.v1.json";
import mainnetRelease from "../contracts/deployments/mainnet-classic-v3.json";
import sepoliaRelease from "../contracts/deployments/sepolia-classic-v3.json";
import {
  isClassicV3DeploymentReady,
  type ClassicV3DeploymentManifest,
} from "./classic-v3";

const LAUNCHER_FEE_RECIPIENT =
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";

export type ClassicV3ReleaseManifest = {
  schemaVersion?: number;
  model?: string;
  internalContractRelease?: string;
  status?: string;
  chainId?: number;
  releaseCommit?: string | null;
  sourceCommitment?: string | null;
  startingNonce?: number | null;
  hookSalt?: string | null;
  addresses?: {
    ctoAuthority?: string | null;
    rewardVaultFactory?: string | null;
    initialBuyVestingWalletFactory?: string | null;
    launchPolicy?: string | null;
    hookFactory?: string | null;
    feeHook?: string | null;
    launcher?: string | null;
    positionForwarderFactory?: string | null;
    launcherFeeRecipient?: string | null;
  };
  runtimeCodeHashes?: {
    ctoAuthority?: string | null;
    rewardVaultFactory?: string | null;
    initialBuyVestingWalletFactory?: string | null;
    launchPolicy?: string | null;
    hookFactory?: string | null;
    feeHook?: string | null;
    launcher?: string | null;
    positionForwarderFactory?: string | null;
  };
  sourceVerification?: {
    status?: string;
  };
  lifecycleEvidence?: {
    status?: string;
    releaseEligible?: boolean;
  };
};

export type ClassicV3ReleaseEnvironment = "production" | "rehearsal";

function validHash(value: string | null | undefined) {
  return Boolean(value && /^0x[a-fA-F0-9]{64}$/.test(value));
}

function sameAddress(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  return Boolean(
    left &&
      right &&
      isAddress(left) &&
      isAddress(right) &&
      getAddress(left) === getAddress(right),
  );
}

function sameHash(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  return Boolean(
    validHash(left) &&
      validHash(right) &&
      left?.toLowerCase() === right?.toLowerCase(),
  );
}

export function isClassicV3ReleaseVerified(
  appManifest: ClassicV3DeploymentManifest,
  release: ClassicV3ReleaseManifest,
  expectedChainId: number,
) {
  if (
    !isClassicV3DeploymentReady(appManifest, expectedChainId) ||
    release.schemaVersion !== 1 ||
    release.model !== "classic" ||
    release.internalContractRelease !== "classic-v3" ||
    release.status !== "deployment-source-and-lifecycle-verified" ||
    release.chainId !== expectedChainId ||
    !/^[a-f0-9]{40}$/.test(release.releaseCommit ?? "") ||
    !validHash(release.sourceCommitment) ||
    !Number.isSafeInteger(release.startingNonce) ||
    (release.startingNonce ?? -1) < 0 ||
    !validHash(release.hookSalt) ||
    release.sourceVerification?.status !== "verified" ||
    release.lifecycleEvidence?.status !== "verified-current-release" ||
    release.lifecycleEvidence?.releaseEligible !== true
  ) {
    return false;
  }

  const addressesMatch =
    sameAddress(
      release.addresses?.ctoAuthority,
      appManifest.classicCtoAuthorityV1,
    ) &&
    sameAddress(
      release.addresses?.rewardVaultFactory,
      appManifest.classicRewardVaultFactoryV1,
    ) &&
    sameAddress(
      release.addresses?.initialBuyVestingWalletFactory,
      appManifest.classicInitialBuyVestingWalletFactoryV1,
    ) &&
    sameAddress(
      release.addresses?.launchPolicy,
      appManifest.classicLaunchPolicyV1,
    ) &&
    sameAddress(
      release.addresses?.hookFactory,
      appManifest.ethCreatorFeeHookFactoryV3,
    ) &&
    sameAddress(release.addresses?.feeHook, appManifest.ethCreatorFeeHookV3) &&
    sameAddress(release.addresses?.launcher, appManifest.memeLaunchV2) &&
    sameAddress(
      release.addresses?.positionForwarderFactory,
      appManifest.lockedPositionFeeForwarderFactory,
    );
  const runtimeHashesMatch =
    sameHash(
      release.runtimeCodeHashes?.ctoAuthority,
      appManifest.runtimeCodeHashes?.classicCtoAuthorityV1,
    ) &&
    sameHash(
      release.runtimeCodeHashes?.rewardVaultFactory,
      appManifest.runtimeCodeHashes?.classicRewardVaultFactoryV1,
    ) &&
    sameHash(
      release.runtimeCodeHashes?.initialBuyVestingWalletFactory,
      appManifest.runtimeCodeHashes?.classicInitialBuyVestingWalletFactoryV1,
    ) &&
    sameHash(
      release.runtimeCodeHashes?.launchPolicy,
      appManifest.runtimeCodeHashes?.classicLaunchPolicyV1,
    ) &&
    sameHash(
      release.runtimeCodeHashes?.hookFactory,
      appManifest.runtimeCodeHashes?.ethCreatorFeeHookFactoryV3,
    ) &&
    sameHash(
      release.runtimeCodeHashes?.feeHook,
      appManifest.runtimeCodeHashes?.ethCreatorFeeHookV3,
    ) &&
    sameHash(
      release.runtimeCodeHashes?.launcher,
      appManifest.runtimeCodeHashes?.memeLaunchV2,
    ) &&
    sameHash(
      release.runtimeCodeHashes?.positionForwarderFactory,
      appManifest.runtimeCodeHashes?.lockedPositionFeeForwarderFactory,
    );
  const launcherFeeRecipientMatches = sameAddress(
    release.addresses?.launcherFeeRecipient,
    LAUNCHER_FEE_RECIPIENT,
  );

  return (
    addressesMatch &&
    runtimeHashesMatch &&
    launcherFeeRecipientMatches
  );
}

export function getConfiguredClassicV3Release(
  environment: ClassicV3ReleaseEnvironment,
) {
  return {
    appManifest: appDeployments[
      environment
    ] as unknown as ClassicV3DeploymentManifest,
    releaseManifest: (environment === "rehearsal"
      ? sepoliaRelease
      : mainnetRelease) as unknown as ClassicV3ReleaseManifest,
    chainId: environment === "rehearsal" ? 11_155_111 : 1,
  };
}

export function isConfiguredClassicV3ReleaseReady(
  environment: ClassicV3ReleaseEnvironment,
) {
  const configured = getConfiguredClassicV3Release(environment);
  return isClassicV3ReleaseVerified(
    configured.appManifest,
    configured.releaseManifest,
    configured.chainId,
  );
}
