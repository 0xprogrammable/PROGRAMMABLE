import { afterEach, describe, expect, it, vi } from "vitest";

import { getOnchainDeployment } from "../lib/onchain/config";

describe("onchain deployment manifest boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads the verified atomic Dev Buy Sepolia deployment", () => {
    expect(getOnchainDeployment("rehearsal")).toMatchObject({
      environment: "rehearsal",
      releaseVersion: "classic-v1",
      chainId: 11_155_111,
      status: "ready",
      launcher: "0x341edf9399C8c5dF361aec2939C4a17c2163a245",
      feeHook: "0x13c34016c74bc43F4CBa97EDb48cC36b4bb620cc",
      launcherRuntimeCodeHash:
        "0x6e1fa1f21df7712433695c1ac584ed4c89b09ed11732cf62058dfc486639e3c2",
      feeHookRuntimeCodeHash:
        "0x0e0dd0bc1b007e979c0a93412afd282fcbe88b270dc2f26edb94310c334fbf06",
      deploymentBlock: 11_359_203n,
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
