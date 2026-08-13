import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CurrentMarketRpcBindingError,
  currentMarketOnchainDeployment,
} from "../lib/market-data/current-market-rpc.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import { productionMainnetRpcEnvironment } from
  "../lib/onchain/website-rpc-providers.server";

const DRPC_RPC_URL = "https://lb.drpc.live/ethereum/drpc-test-key";
const QUICKNODE_RPC_URL =
  "https://programmable-mainnet.ethereum-mainnet.quiknode.pro/quicknode-test-key/";

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
    rpcUrl: DRPC_RPC_URL,
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

function stubProductionPair(
  primary = DRPC_RPC_URL,
  secondary = QUICKNODE_RPC_URL,
) {
  for (const [name, value] of Object.entries(
    productionMainnetRpcEnvironment(primary, secondary),
  )) vi.stubEnv(name, value);
}

describe("current market RPC deployment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the shared commitment-bound private dRPC and QuickNode pair", () => {
    stubProductionPair();
    const website = websiteDeployment();

    const current = currentMarketOnchainDeployment(website);

    expect(current).toMatchObject({
      status: "ready",
      rpcUrl: DRPC_RPC_URL,
      rpcUrlSecondary: QUICKNODE_RPC_URL,
    });
    expect(website).toMatchObject({
      rpcUrl: DRPC_RPC_URL,
      rpcUrlSecondary: QUICKNODE_RPC_URL,
    });
  });

  it("ignores unrelated base deployment RPC endpoints", () => {
    stubProductionPair();

    expect(currentMarketOnchainDeployment(websiteDeployment({
      rpcUrl: "https://eth.drpc.org",
      rpcUrlSecondary: null,
    }))).toMatchObject({
      rpcUrl: DRPC_RPC_URL,
      rpcUrlSecondary: QUICKNODE_RPC_URL,
    });
  });

  it("does not retain provider-neutral role labels for replaced endpoints", () => {
    stubProductionPair();

    const current = currentMarketOnchainDeployment(websiteDeployment({
      rpcProviderIds: { primary: "drpc", secondary: "quicknode" },
    }));

    expect(current).toMatchObject({
      rpcUrl: DRPC_RPC_URL,
      rpcUrlSecondary: QUICKNODE_RPC_URL,
    });
    expect(current.rpcProviderIds).toEqual({
      primary: "drpc",
      secondary: "quicknode",
    });
  });

  it("rejects a missing or mismatched role commitment without retaining secrets", () => {
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT",
      "",
    );
    expect(() =>
      currentMarketOnchainDeployment(websiteDeployment()),
    ).toThrow(CurrentMarketRpcBindingError);

    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT",
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

  it("does not let a public base endpoint bypass the private pair", () => {
    stubProductionPair();

    expect(currentMarketOnchainDeployment(websiteDeployment({
      rpcUrl: "https://ethereum-rpc.publicnode.com",
      rpcUrlSecondary: "https://rpc.mevblocker.io/",
    }))).toMatchObject({
      rpcUrl: DRPC_RPC_URL,
      rpcUrlSecondary: QUICKNODE_RPC_URL,
    });

    vi.stubEnv("PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL", "");
    expect(() => currentMarketOnchainDeployment(websiteDeployment()))
      .toThrow(CurrentMarketRpcBindingError);
  });

  it("requires the fixed dRPC-primary QuickNode-secondary order", () => {
    stubProductionPair(DRPC_RPC_URL, "https://rpc.mevblocker.io/");
    expect(() => currentMarketOnchainDeployment(websiteDeployment()))
      .toThrow(CurrentMarketRpcBindingError);
  });
});
