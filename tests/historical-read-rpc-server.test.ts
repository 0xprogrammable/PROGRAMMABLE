import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  HistoricalReadRpcBindingError,
  historicalReadOnchainDeployment,
} from "../lib/onchain/historical-read-rpc.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import { productionMainnetRpcEnvironment } from
  "../lib/onchain/website-rpc-providers.server";

const DRPC_RPC_URL = "https://lb.drpc.live/ethereum/drpc-test-key";
const QUICKNODE_RPC_URL =
  "https://programmable-mainnet.ethereum-mainnet.quiknode.pro/quicknode-test-key/";

const deployment: ReadyOnchainDeployment = {
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
};

function stubProductionPair() {
  for (const [name, value] of Object.entries(
    productionMainnetRpcEnvironment(DRPC_RPC_URL, QUICKNODE_RPC_URL),
  )) vi.stubEnv(name, value);
}

describe("historical read RPC deployment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses commitment-bound QuickNode plus the fixed archive witness", () => {
    stubProductionPair();

    expect(historicalReadOnchainDeployment(deployment)).toMatchObject({
      rpcUrl: QUICKNODE_RPC_URL,
      rpcUrlSecondary: "https://rpc.mevblocker.io/",
      rpcProviderIds: undefined,
    });
  });

  it("does not retain the non-archive dRPC reader", () => {
    stubProductionPair();

    const historical = historicalReadOnchainDeployment({
      ...deployment,
      rpcUrl: "https://eth.drpc.org",
      rpcUrlSecondary: null,
    });

    expect(historical.rpcUrl).toBe(QUICKNODE_RPC_URL);
    expect(historical.rpcUrlSecondary).toBe("https://rpc.mevblocker.io/");
    expect(historical.rpcUrl).not.toContain("drpc");
  });

  it("fails closed when the private QuickNode commitment is missing", () => {
    stubProductionPair();
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT",
      "",
    );

    expect(() => historicalReadOnchainDeployment(deployment))
      .toThrow(HistoricalReadRpcBindingError);
  });
});
