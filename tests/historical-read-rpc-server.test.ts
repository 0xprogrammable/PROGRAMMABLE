import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  HistoricalReadRpcBindingError,
  historicalReadOnchainDeployment,
} from "../lib/onchain/historical-read-rpc.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
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

describe("historical read RPC deployment", () => {
  it("uses two fixed independent archive witnesses", () => {
    expect(historicalReadOnchainDeployment(deployment)).toMatchObject({
      rpcUrl: "https://rpc.mevblocker.io/",
      rpcUrlSecondary: "https://mainnet.gateway.tenderly.co/",
      rpcProviderIds: undefined,
    });
  });

  it("does not retain either private current-market reader", () => {
    const historical = historicalReadOnchainDeployment({
      ...deployment,
      rpcUrl: "https://eth.drpc.org",
      rpcUrlSecondary: null,
    });

    expect(historical.rpcUrl).toBe("https://rpc.mevblocker.io/");
    expect(historical.rpcUrlSecondary).toBe(
      "https://mainnet.gateway.tenderly.co/",
    );
    expect(historical.rpcUrl).not.toContain("drpc");
    expect(historical.rpcUrl).not.toContain("quicknode");
  });

  it("fails closed outside Ethereum Mainnet", () => {
    expect(() => historicalReadOnchainDeployment({
      ...deployment,
      chainId: 11_155_111,
    }))
      .toThrow(HistoricalReadRpcBindingError);
  });
});
