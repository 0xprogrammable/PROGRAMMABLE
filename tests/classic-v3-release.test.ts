import { describe, expect, it } from "vitest";

import appDeployments from "../contracts/config/app-deployments.v1.json";
import mainnetRelease from "../contracts/deployments/mainnet-classic-v3.json";
import type { ClassicV3DeploymentManifest } from "../lib/classic-v3";
import {
  isClassicV3ReleaseVerified,
  type ClassicV3ReleaseManifest,
} from "../lib/classic-v3-release";

const hash = `0x${"11".repeat(32)}`;
const launcherFeeRecipient =
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
const addresses = {
  ctoAuthority: "0x1111111111111111111111111111111111111111",
  rewardVaultFactory: "0x2222222222222222222222222222222222222222",
  initialBuyVestingWalletFactory:
    "0x3333333333333333333333333333333333333333",
  launchPolicy: "0x4444444444444444444444444444444444444444",
  hookFactory: "0x5555555555555555555555555555555555555555",
  feeHook: "0x6666666666666666666666666666666666666666",
  launcher: "0x7777777777777777777777777777777777777777",
  positionForwarderFactory:
    "0x8888888888888888888888888888888888888888",
  launcherFeeRecipient,
};

function verifiedPair(): {
  app: ClassicV3DeploymentManifest;
  release: ClassicV3ReleaseManifest;
} {
  return {
    app: {
      chainId: 1,
      classicV3Status: "ready",
      classicCtoAuthorityV1: addresses.ctoAuthority,
      classicRewardVaultFactoryV1: addresses.rewardVaultFactory,
      classicInitialBuyVestingWalletFactoryV1:
        addresses.initialBuyVestingWalletFactory,
      classicLaunchPolicyV1: addresses.launchPolicy,
      ethCreatorFeeHookFactoryV3: addresses.hookFactory,
      ethCreatorFeeHookV3: addresses.feeHook,
      memeLaunchV2: addresses.launcher,
      lockedPositionFeeForwarderFactory:
        addresses.positionForwarderFactory,
      runtimeCodeHashes: {
        classicCtoAuthorityV1: hash,
        classicRewardVaultFactoryV1: hash,
        classicInitialBuyVestingWalletFactoryV1: hash,
        classicLaunchPolicyV1: hash,
        ethCreatorFeeHookFactoryV3: hash,
        ethCreatorFeeHookV3: hash,
        memeLaunchV2: hash,
        lockedPositionFeeForwarderFactory: hash,
      },
      deploymentBlocks: { memeLaunchV2: 123 },
    },
    release: {
      schemaVersion: 1,
      model: "classic",
      internalContractRelease: "classic-v3",
      status: "deployment-source-and-lifecycle-verified",
      chainId: 1,
      releaseCommit: "a".repeat(40),
      sourceCommitment: `0x${"22".repeat(32)}`,
      startingNonce: 5,
      hookSalt: `0x${"33".repeat(32)}`,
      addresses,
      runtimeCodeHashes: {
        ctoAuthority: hash,
        rewardVaultFactory: hash,
        initialBuyVestingWalletFactory: hash,
        launchPolicy: hash,
        hookFactory: hash,
        feeHook: hash,
        launcher: hash,
        positionForwarderFactory: hash,
      },
      sourceVerification: { status: "verified" },
      lifecycleEvidence: {
        status: "verified-current-release",
        releaseEligible: true,
      },
    },
  };
}

describe("Classic verified release gate", () => {
  it("keeps the checked-in production release disabled", () => {
    expect(
      isClassicV3ReleaseVerified(
        appDeployments.production as unknown as ClassicV3DeploymentManifest,
        mainnetRelease as unknown as ClassicV3ReleaseManifest,
        1,
      ),
    ).toBe(false);
  });

  it("accepts only matching source- and lifecycle-verified manifests", () => {
    const { app, release } = verifiedPair();
    expect(isClassicV3ReleaseVerified(app, release, 1)).toBe(true);
    expect(
      isClassicV3ReleaseVerified(
        app,
        {
          ...release,
          sourceVerification: { status: "not-submitted" },
        },
        1,
      ),
    ).toBe(false);
    expect(
      isClassicV3ReleaseVerified(
        app,
        {
          ...release,
          lifecycleEvidence: {
            status: "verified-current-release",
            releaseEligible: false,
          },
        },
        1,
      ),
    ).toBe(false);
  });

  it("rejects any address, runtime hash, chain or release identity drift", () => {
    const { app, release } = verifiedPair();
    expect(
      isClassicV3ReleaseVerified(
        app,
        {
          ...release,
          addresses: {
            ...release.addresses,
            launcher: "0x6666666666666666666666666666666666666666",
          },
        },
        1,
      ),
    ).toBe(false);
    expect(
      isClassicV3ReleaseVerified(
        app,
        {
          ...release,
          addresses: {
            ...release.addresses,
            launcherFeeRecipient:
              "0x1111111111111111111111111111111111111111",
          },
        },
        1,
      ),
    ).toBe(false);
    expect(
      isClassicV3ReleaseVerified(
        app,
        {
          ...release,
          runtimeCodeHashes: {
            ...release.runtimeCodeHashes,
            feeHook: `0x${"44".repeat(32)}`,
          },
        },
        1,
      ),
    ).toBe(false);
    expect(
      isClassicV3ReleaseVerified(app, { ...release, chainId: 11_155_111 }, 1),
    ).toBe(false);
    expect(
      isClassicV3ReleaseVerified(
        app,
        { ...release, internalContractRelease: "classic-v4" },
        1,
      ),
    ).toBe(false);
  });
});
