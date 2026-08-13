import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";
import {
  CurrentMarketRpcBindingError,
  currentMarketOnchainDeployment,
} from "../lib/market-data/current-market-rpc.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";

const ALCHEMY_RPC_URL =
  "https://eth-mainnet.g.alchemy.com/v2/alchemy-test-key";
const QUICKNODE_RPC_URL =
  "https://programmable-mainnet.quiknode.pro/quicknode-test-key/";
const MEV_BLOCKER_RPC_URL = "https://rpc.mevblocker.io/";

function websiteDeployment(
  overrides: Partial<ReadyOnchainDeployment> = {},
): ReadyOnchainDeployment {
  return {
    environment: "production",
    releaseVersion: "classic-v2",
    chainId: 1,
    status: "ready",
    stateView: "0x1111111111111111111111111111111111111111",
    stateViewRuntimeCodeHash: `0x${"11".repeat(32)}`,
    rpcUrl: ALCHEMY_RPC_URL,
    rpcUrlSecondary: QUICKNODE_RPC_URL,
    confirmations: 12n,
    logBlockRange: 5_000n,
    launcher: "0x2222222222222222222222222222222222222222",
    feeHook: "0x3333333333333333333333333333333333333333",
    launcherRuntimeCodeHash: `0x${"22".repeat(32)}`,
    feeHookRuntimeCodeHash: `0x${"33".repeat(32)}`,
    deploymentBlock: 25_000_000n,
    ...overrides,
  };
}

function stubQuickNodeCommitment(value = QUICKNODE_RPC_URL) {
  vi.stubEnv("PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL", value);
  vi.stubEnv(
    "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT",
    rpcProviderCommitment("endpoint", value),
  );
}

describe("current market RPC deployment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses only the commitment-bound QuickNode and fixed MEV Blocker pair", () => {
    stubQuickNodeCommitment();
    const website = websiteDeployment();

    const current = currentMarketOnchainDeployment(website);

    expect(current).toMatchObject({
      status: "ready",
      rpcUrl: QUICKNODE_RPC_URL,
      rpcUrlSecondary: MEV_BLOCKER_RPC_URL,
    });
    expect(current.rpcUrl).not.toBe(ALCHEMY_RPC_URL);
    expect(website).toMatchObject({
      rpcUrl: ALCHEMY_RPC_URL,
      rpcUrlSecondary: QUICKNODE_RPC_URL,
    });
  });

  it("does not require or retain an Alchemy endpoint for current evidence", () => {
    stubQuickNodeCommitment();
    vi.stubEnv("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL", "");
    vi.stubEnv("ETHEREUM_RPC_URL", "");

    expect(currentMarketOnchainDeployment(websiteDeployment({
      rpcUrl: "https://eth.drpc.org",
      rpcUrlSecondary: null,
    }))).toMatchObject({
      rpcUrl: QUICKNODE_RPC_URL,
      rpcUrlSecondary: MEV_BLOCKER_RPC_URL,
    });
  });

  it("rejects a missing or mismatched QuickNode commitment without retaining secrets", () => {
    vi.stubEnv(
      "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT",
      "",
    );
    expect(() =>
      currentMarketOnchainDeployment(websiteDeployment()),
    ).toThrow(CurrentMarketRpcBindingError);

    vi.stubEnv(
      "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT",
      `0x${"ab".repeat(32)}`,
    );
    const error = (() => {
      try {
        currentMarketOnchainDeployment(websiteDeployment());
      } catch (candidate) {
        return candidate;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(CurrentMarketRpcBindingError);
    expect(JSON.stringify(error)).not.toContain("quicknode-test-key");
  });

  it("does not let a base deployment endpoint bypass configured QuickNode", () => {
    stubQuickNodeCommitment();

    expect(currentMarketOnchainDeployment(websiteDeployment({
      rpcUrl: "https://ethereum-rpc.publicnode.com",
      rpcUrlSecondary: MEV_BLOCKER_RPC_URL,
    }))).toMatchObject({
      rpcUrl: QUICKNODE_RPC_URL,
      rpcUrlSecondary: MEV_BLOCKER_RPC_URL,
    });

    vi.stubEnv("PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL", "");
    vi.stubEnv("ETHEREUM_RPC_URL_B", "https://ethereum-rpc.publicnode.com");
    expect(() => currentMarketOnchainDeployment(websiteDeployment()))
      .toThrow(CurrentMarketRpcBindingError);
  });

  it("requires independent providers in the fixed QuickNode-first order", () => {
    stubQuickNodeCommitment(MEV_BLOCKER_RPC_URL);
    expect(() => currentMarketOnchainDeployment(websiteDeployment()))
      .toThrow(CurrentMarketRpcBindingError);
  });
});
