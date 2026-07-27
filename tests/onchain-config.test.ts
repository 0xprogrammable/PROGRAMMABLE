import { afterEach, describe, expect, it, vi } from "vitest";

import { getOnchainDeployment } from "../lib/onchain/config";

describe("onchain deployment manifest boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes only the source-verified Sepolia V2 deployment with complete Test2 lifecycle evidence", () => {
    expect(getOnchainDeployment("rehearsal")).toMatchObject({
      environment: "rehearsal",
      releaseVersion: "classic-v2",
      chainId: 11_155_111,
      status: "ready",
      launcher: "0x6Ae84F188468722d8b5970Bc3924C9C31b75FF4e",
      feeHook: "0x0c9De2721F537C311e05ad3671A17136C14a20Cc",
      launcherRuntimeCodeHash:
        "0xf9977ba3a5c859d34beff333d129ae135190423a20e2a6ec5cb19588ff552e5f",
      feeHookRuntimeCodeHash:
        "0xa1094bdd6c3bd1ba4d17d8f321f0e52a95a6247fae287aae90b008a7eacb05b7",
      deploymentBlock: 11_361_270n,
    });
  });

  it("keeps production undeployed independently of rehearsal evidence", () => {
    expect(getOnchainDeployment("production")).toMatchObject({
      environment: "production",
      releaseVersion: "classic-v1",
      chainId: 1,
      status: "not-deployed",
      launcher: null,
      feeHook: null,
    });
  });

  it("rejects zero or sub-policy confirmation overrides", () => {
    for (const value of ["0", "1", "11", "-1", "not-a-number"]) {
      vi.stubEnv("PROGRAMMABLE_CONFIRMATIONS", value);
      expect(getOnchainDeployment("production").confirmations).toBe(12n);
    }

    vi.stubEnv("PROGRAMMABLE_CONFIRMATIONS", "24");
    expect(getOnchainDeployment("production").confirmations).toBe(24n);
  });

  it("never permits a zero log block range", () => {
    vi.stubEnv("PROGRAMMABLE_LOG_BLOCK_RANGE", "0");
    expect(getOnchainDeployment("production").logBlockRange).toBe(
      10_000n,
    );

    vi.stubEnv("PROGRAMMABLE_LOG_BLOCK_RANGE", "1");
    expect(getOnchainDeployment("production").logBlockRange).toBe(1n);
  });
});
