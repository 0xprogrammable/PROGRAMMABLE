import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  HistoricalReadRpcBindingError,
  historicalReadOnchainDeployment,
} from "../lib/onchain/historical-read-rpc.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";

const TENDERLY_RPC_URL = "https://mainnet.gateway.tenderly.co/";
const DRPC_RPC_URL = "https://lb.drpc.live/ethereum/drpc-test-key";
const QUICKNODE_RPC_URL =
  "https://programmable-mainnet.ethereum-mainnet.quiknode.pro/quicknode-test-key/";
const environment = {
  PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE_RPC_URL,
  PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
    rpcProviderCommitment("endpoint", QUICKNODE_RPC_URL),
};

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
  it("uses the fixed Tenderly and commitment-bound QuickNode recovery pair", () => {
    expect(historicalReadOnchainDeployment(deployment, environment)).toMatchObject({
      rpcUrl: TENDERLY_RPC_URL,
      rpcUrlSecondary: QUICKNODE_RPC_URL,
      rpcProviderIds: { primary: "tenderly", secondary: "quicknode" },
    });
  });

  it("rejects the base deployment as authority and restores the bound pair", () => {
    const historical = historicalReadOnchainDeployment({
      ...deployment,
      rpcUrl: "https://eth.drpc.org",
      rpcUrlSecondary: null,
    }, environment);

    expect(historical.rpcUrl).toBe(TENDERLY_RPC_URL);
    expect(historical.rpcUrlSecondary).toBe(QUICKNODE_RPC_URL);
  });

  it("fails closed outside Ethereum Mainnet", () => {
    expect(() => historicalReadOnchainDeployment({
      ...deployment,
      chainId: 11_155_111,
    }, environment))
      .toThrow(HistoricalReadRpcBindingError);
  });
});
