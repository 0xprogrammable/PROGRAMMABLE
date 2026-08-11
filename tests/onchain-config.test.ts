import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getOnchainDeployment,
  getOperationalOnchainDeployment,
  getPublicOnchainDeployment,
} from "../lib/onchain/config";

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

  it("exposes production V2 after its verified canary lifecycle passes", () => {
    expect(getOnchainDeployment("production")).toMatchObject({
      environment: "production",
      releaseVersion: "classic-v2",
      chainId: 1,
      status: "ready",
      launcher: "0xD240D06f8586eB799f20056054e5b527405E6bAd",
      feeHook: "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC",
    });
  });

  it("requires dual-RPC configuration for production operations", () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "https://rpc-a.example");
    vi.stubEnv("ETHEREUM_RPC_URL_B", "https://rpc-b.example");

    expect(getOperationalOnchainDeployment("production")).toMatchObject({
      environment: "production",
      releaseVersion: "classic-v2",
      chainId: 1,
      status: "ready",
      launcher: "0xD240D06f8586eB799f20056054e5b527405E6bAd",
      feeHook: "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC",
      rpcUrlSecondary: "https://rpc-b.example",
    });
    expect(getOnchainDeployment("production").status).toBe("ready");
  });

  it("uses the bound Alchemy and QuickNode RPCs when generic aliases are empty", () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "");
    vi.stubEnv("ETHEREUM_RPC_URL_B", "");
    vi.stubEnv(
      "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
      "https://alchemy.example",
    );
    vi.stubEnv(
      "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
      "https://quicknode.example",
    );

    expect(getOperationalOnchainDeployment("production")).toMatchObject({
      status: "ready",
      rpcUrl: "https://alchemy.example",
      rpcUrlSecondary: "https://quicknode.example",
    });
  });

  it("prefers the provider-specific production bindings over legacy aliases", () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "https://legacy-primary.example");
    vi.stubEnv("ETHEREUM_RPC_URL_B", "https://legacy-secondary.example");
    vi.stubEnv(
      "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
      "https://alchemy.example",
    );
    vi.stubEnv(
      "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
      "https://quicknode.example",
    );

    expect(getOperationalOnchainDeployment("production")).toMatchObject({
      status: "ready",
      rpcUrl: "https://alchemy.example",
      rpcUrlSecondary: "https://quicknode.example",
    });
  });

  it("rejects production operations without an independent RPC", () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "https://rpc-a.example");
    vi.stubEnv("ETHEREUM_RPC_URL_B", "https://rpc-a.example");

    expect(() =>
      getOperationalOnchainDeployment("production"),
    ).toThrow(
      "Production operations require two distinct authenticated RPC URLs",
    );
  });

  it("rejects an implicit public fallback for production operations", () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "");
    vi.stubEnv("ETHEREUM_RPC_URL_B", "https://rpc-b.example");
    vi.stubEnv("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL", "");
    vi.stubEnv("PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL", "");

    expect(() =>
      getOperationalOnchainDeployment("production"),
    ).toThrow(
      "Production operations require two distinct authenticated RPC URLs",
    );
  });

  it("keeps public reads fail-closed when the dual-RPC environment is absent", () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "");
    vi.stubEnv("ETHEREUM_RPC_URL_B", "");
    vi.stubEnv("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL", "");
    vi.stubEnv("PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL", "");

    expect(getPublicOnchainDeployment("production").status).toBe(
      "not-deployed",
    );
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
      5_000n,
    );

    vi.stubEnv("PROGRAMMABLE_LOG_BLOCK_RANGE", "1");
    expect(getOnchainDeployment("production").logBlockRange).toBe(1n);
  });
});
