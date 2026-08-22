import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPredictionMarketPublicClients,
  parsePredictionMarketReleaseConfig,
  type PredictionMarketReleaseConfig,
} from "../lib/prediction-market-chain";

const secondaryRpcUrl =
  "https://robinhood-mainnet.g.alchemy.com/v2/test_api_key_1234";
const config = {
  deploymentBlock: 1n,
  factoryAddress: "0x1111111111111111111111111111111111111111",
  hookRuntimeCodeHash: `0x${"11".repeat(32)}`,
  predictionQuoterAddress: "0x2222222222222222222222222222222222222222",
  predictionQuoterRuntimeCodeHash: `0x${"22".repeat(32)}`,
  routerRuntimeCodeHash: `0x${"33".repeat(32)}`,
  runtimeCodeHash: `0x${"44".repeat(32)}`,
  secondaryRpcUrl,
} as const satisfies PredictionMarketReleaseConfig;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prediction market RPC policy", () => {
  it("uses bounded Multicall3 on both independent providers", () => {
    const [primary, secondary] = createPredictionMarketPublicClients(config);

    expect(primary.batch?.multicall).toEqual({ batchSize: 64, wait: 0 });
    expect(secondary.batch?.multicall).toEqual({ batchSize: 64, wait: 0 });
  });

  it("binds the secondary client to the configured Alchemy endpoint", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify({ id: 0, jsonrpc: "2.0", result: "0x1" }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }),
    );
    const secondary = createPredictionMarketPublicClients(config)[1];

    await secondary.getBlockNumber();

    expect(requests).toEqual([secondaryRpcUrl]);
  });

  it("rejects missing, public, or cross-chain secondary RPCs", () => {
    const input = {
      deploymentBlock: "1",
      factoryAddress: config.factoryAddress,
      hookRuntimeCodeHash: config.hookRuntimeCodeHash,
      predictionQuoterAddress: config.predictionQuoterAddress,
      predictionQuoterRuntimeCodeHash: config.predictionQuoterRuntimeCodeHash,
      routerRuntimeCodeHash: config.routerRuntimeCodeHash,
      runtimeCodeHash: config.runtimeCodeHash,
    };

    expect(() => parsePredictionMarketReleaseConfig(input)).toThrow(
      "secondary RPC URL",
    );
    expect(() =>
      parsePredictionMarketReleaseConfig({
        ...input,
        secondaryRpcUrl:
          "https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public",
      }),
    ).toThrow("secondary RPC URL");
    expect(() =>
      parsePredictionMarketReleaseConfig({
        ...input,
        secondaryRpcUrl: "https://eth-mainnet.g.alchemy.com/v2/test_api_key_1234",
      }),
    ).toThrow("secondary RPC URL");
  });
});
