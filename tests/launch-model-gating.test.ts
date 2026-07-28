import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { POST } from "../app/api/launch/preflight/route";
import { LaunchModelPicker } from "../components/launch-builder";
import appDeployments from "../contracts/config/app-deployments.v1.json";
import { createClassicV3Draft } from "../lib/launch";
import {
  isFutureLaunchModelManifestEligible,
  resolveImplementedLaunchModel,
  resolveReservedLaunchModel,
  type LaunchModelReleaseManifest,
} from "../lib/launch-model-gating";

const account = "0x1111111111111111111111111111111111111111";
const launcher = "0x2222222222222222222222222222222222222222";
const runtimeCodeHash = `0x${"11".repeat(32)}`;

function eligibleDeepManifest(): LaunchModelReleaseManifest {
  return {
    chainId: 1,
    status: "ready",
    launchModelReleases: {
      deep: {
        schemaVersion: 1,
        model: "deep",
        internalContractRelease:
          "liquidity-growth-full-range-v1",
        releaseVersion: "deep-full-range-v1",
        releaseCommit: "1".repeat(40),
        sourceCommitment: runtimeCodeHash,
        releaseManifest:
          "contracts/deployments/mainnet-deep-full-range-v1.json",
        status: "deployment-source-and-lifecycle-verified",
        releaseEligible: true,
        sourceVerificationStatus: "verified",
        deploymentVerificationStatus: "verified",
        launcher,
        hookFactory: launcher,
        feeHook: launcher,
        feeSplitVaultFactory: launcher,
        rangeSourceFactory: launcher,
        growthVaultFactory: launcher,
        growthVaultImplementation: launcher,
        automation: launcher,
        positionPlanner: launcher,
        positionForwarderFactory: launcher,
        startBlock: 1,
        deploymentBlock: 1,
        deploymentTransaction: runtimeCodeHash,
        lifecycleEvidenceHash: runtimeCodeHash,
        runtimeCodeHashes: {
          launcher: runtimeCodeHash,
          hookFactory: runtimeCodeHash,
          feeHook: runtimeCodeHash,
          feeSplitVaultFactory: runtimeCodeHash,
          rangeSourceFactory: runtimeCodeHash,
          growthVaultFactory: runtimeCodeHash,
          growthVaultImplementation: runtimeCodeHash,
          automation: runtimeCodeHash,
          positionPlanner: runtimeCodeHash,
          positionForwarderFactory: runtimeCodeHash,
        },
      },
    },
  };
}

describe("unreleased launch model gating", () => {
  it("does not expose Deep or LiquidityGrowth in the launch picker", () => {
    const html = renderToStaticMarkup(
      createElement(LaunchModelPicker, {
        onChoose: () => undefined,
      }),
    );

    expect(html).not.toContain("Deep");
    expect(html).not.toContain("LiquidityGrowth");
    expect(html).not.toContain("Liquidity Growth");
  });

  it("does not resolve reserved or unknown identifiers as implemented models", () => {
    expect(resolveImplementedLaunchModel("classic")).toBe("classic");
    expect(resolveImplementedLaunchModel("classic-v3")).toBe("classic-v3");
    expect(resolveImplementedLaunchModel("adaptive")).toBe("adaptive");
    expect(resolveImplementedLaunchModel("deep")).toBe("deep");
    expect(resolveImplementedLaunchModel("liquidity-growth")).toBeNull();
    expect(resolveImplementedLaunchModel("unknown")).toBeNull();
    expect(resolveReservedLaunchModel("deep")).toBeNull();
    expect(resolveReservedLaunchModel("liquidity-growth")).toBe("deep");
  });

  it("requires an exact verified release record before Deep can be eligible", () => {
    expect(
      isFutureLaunchModelManifestEligible(
        "deep",
        appDeployments.production,
        1,
      ),
    ).toBe(false);

    const manifest = eligibleDeepManifest();
    expect(
      isFutureLaunchModelManifestEligible("deep", manifest, 1),
    ).toBe(true);
    expect(
      isFutureLaunchModelManifestEligible(
        "liquidity-growth",
        manifest,
        1,
      ),
    ).toBe(true);
    expect(
      isFutureLaunchModelManifestEligible(
        "deep",
        {
          ...manifest,
          launchModelReleases: {
            deep: {
              ...manifest.launchModelReleases?.deep,
              deploymentVerificationStatus: "pending",
            },
          },
        },
        1,
      ),
    ).toBe(false);
    expect(
      isFutureLaunchModelManifestEligible("deep", manifest, 11_155_111),
    ).toBe(false);
  });

  it.each(["deep", "liquidity-growth"])(
    "rejects %s before preflight can prepare a transaction",
    async (launchModel) => {
      const request = new NextRequest(
        "http://localhost/api/launch/preflight",
        {
          method: "POST",
          body: JSON.stringify({
            account,
            walletChainId: "0x1",
            draft: { launchModel },
          }),
        },
      );

      const result = await POST(request);
      expect(result.status).toBe(400);
      await expect(result.json()).resolves.toEqual({
        error: "Deep is not enabled by a verified release manifest",
      });
    },
  );

  it("blocks Classic upgrades before any transaction can be prepared", async () => {
    const request = new NextRequest(
      "http://localhost/api/launch/preflight",
      {
        method: "POST",
        body: JSON.stringify({
          account,
          walletChainId: "0x1",
          draft: {
            ...createClassicV3Draft(),
            tokenName: "Verified Classic",
            tokenSymbol: "VC",
            tokenDescription: "Release-gate test",
            launchSalt: `0x${"22".repeat(32)}`,
          },
        }),
      },
    );

    const result = await POST(request);
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toMatchObject({
      status: "blocked",
      mode: "classic-v3",
      title: "Classic is not deployed on Ethereum yet",
      checks: [
        { id: "token", status: "pass" },
        { id: "wallet", status: "pass" },
        { id: "contracts", status: "blocked" },
      ],
    });
  });
});
