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

  it("coalesces concurrent JSON-RPC reads into one bounded provider request", async () => {
    const requestBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as
          | Readonly<{ id: number; method: string }>
          | readonly Readonly<{ id: number; method: string }>[];
        requestBodies.push(body);
        const requests = Array.isArray(body) ? body : [body];
        return new Response(
          JSON.stringify(requests.map((request) => ({
            id: request.id,
            jsonrpc: "2.0",
            result: request.method === "eth_chainId" ? "0x1237" : "0x1",
          }))),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }),
    );
    const primary = createPredictionMarketPublicClients(config)[0];

    await Promise.all([primary.getBlockNumber(), primary.getChainId()]);

    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toBeInstanceOf(Array);
    expect(requestBodies[0]).toHaveLength(2);
  });

  it("binds the secondary client to the configured Alchemy endpoint", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        requests.push(String(input));
        const body = JSON.parse(String(init?.body)) as
          | Readonly<{ id: number }>
          | readonly Readonly<{ id: number }>[];
        const batch = Array.isArray(body) ? body : [body];
        return new Response(
          JSON.stringify(batch.map((request) => ({
            id: request.id,
            jsonrpc: "2.0",
            result: "0x1",
          }))),
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
