import {
  encodeFunctionResult,
  parseAbi,
} from "viem";
import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as executionProof from "../../scripts/perf/bitquery-golden-market-parity.mjs";

const { verifyBitqueryGoldenMarketExecutionV1 } = executionProof;
const RPC_URLS = Object.freeze([
  "https://lb.drpc.live/ethereum/test-witness-key",
  "https://test-witness.ethereum-mainnet.quiknode.pro/test-witness-key/",
]);

const PCAN_ADDRESS = "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce";
const POOL =
  "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229";
const QUOTE = "0x0000000000000000000000000000000000000000";
const POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90";
const ETH_USD_FEED = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
const TRANSACTION_HASH =
  "0x4fd96879a7f273eb2626a09f9afa0a08a835c8d65dae2faea985f0d1967b1c75";
const BLOCK_HASH =
  "0x3d24f1013c5dce2b0bf473a5ad73b09c804d49343c8a4c1c4c89b1b8b06738a5";
const BLOCK_NUMBER = "25724408";
const BLOCK_HEX = "0x18885f8";
const BLOCK_TIME = "2026-08-10T11:50:47.000Z";
const SWAP_TOPIC =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
const SWAP_DATA =
  "0xfffffffffffffffffffffffffffffffffffffffffffffffffff572ccfd04600000000000000000000000000000000000000000000000392189b6eb5680215c2d000000000000000000000000000000000000182cf40505ad9fe965947c04960f000000000000000000000000000000000000000000000001b6c9b5b10533227c000000000000000000000000000000000000000000000000000000000002aa1b0000000000000000000000000000000000000000000000000000000000000bb8";
const MUTATED_SWAP_DATA =
  "0xfffffffffffffffffffffffffffffffffffffffffffffffffff572ccfd04600000000000000000000000000000000000000000000000392189b6eb5680215c2d000000000000000000000000000000000000182cf40505ad9fe965947c04960f000000000000000000000000000000000000000000000001b6c9b5b10533227c000000000000000000000000000000000000000000000000000000000002aa1b0000000000000000000000000000000000000000000000000000000000000bb9";
const TOKEN_AMOUNT_RAW = "269793555455587899235373";
const EXECUTION_QUOTE_WAD = "11008417139";
const BITQUERY_PRICE_USD_WAD = "21113176432735";
const BITQUERY_FDV_USD_WAD = "21113176432735000000";
const CHAINLINK_EXECUTION_FDV_USD_WAD = "21094317527929000000";

const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
]);

function token(overrides: Record<string, unknown> = {}) {
  return {
    tokenAddress: PCAN_ADDRESS,
    tokenDecimals: 18,
    totalSupplyRaw: "1000000000000000000000000",
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      valueWad: BITQUERY_FDV_USD_WAD,
      freshness: "stale",
      source: "bitquery",
      asOfTime: BLOCK_TIME,
    },
    marketData: {
      schemaVersion: "programmable.market-data.v1",
      source: "bitquery",
      primaryPoolId: POOL,
      pools: [{
        identity: {
          chainId: "1",
          tokenAddress: PCAN_ADDRESS,
          poolId: POOL,
          protocol: "uniswap_v4",
        },
        source: "bitquery",
        latestTrade: {
          transactionHash: TRANSACTION_HASH,
          transactionIndex: 66,
          logIndex: 0,
          blockNumber: BLOCK_NUMBER,
          time: BLOCK_TIME,
          tokenSide: "sell",
          tokenAmount: "269793.555455587899235373",
          priceQuoteWad: EXECUTION_QUOTE_WAD,
          quoteAddress: QUOTE,
          quoteSymbol: "ETH",
          priceUsdWad: BITQUERY_PRICE_USD_WAD,
          priceUsdAsOfTime: BLOCK_TIME,
          priceUsdSource: "bitquery-token-price-index-v1",
          rawPriceUsdWad: BITQUERY_PRICE_USD_WAD,
        },
      }],
    },
    ...overrides,
  };
}

function swapLog(data = SWAP_DATA) {
  return {
    address: POOL_MANAGER,
    topics: [
      SWAP_TOPIC,
      POOL,
      "0x00000000000000000000000066a9893cc07d91d95644aedd05d03f95e1dba8af",
    ],
    data,
    blockNumber: BLOCK_HEX,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x42",
    blockHash: BLOCK_HASH,
    logIndex: "0x7a",
    removed: false,
  };
}

type WitnessMutation = Readonly<{
  receiptStatus?: string;
  duplicateSwap?: boolean;
  secondProviderSwapData?: string;
  secondProviderBlockHash?: string;
  feedUpdatedAt?: bigint;
  answeredInRound?: bigint;
  tokenSupply?: bigint;
}>;

function witnessFetch(mutation: WitnessMutation = {}) {
  const calls: Array<{
    readonly rpcUrl: string;
    readonly method: string;
    readonly params: unknown[];
  }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const rpcUrl = String(input);
    const request = JSON.parse(String(init?.body)) as {
      readonly jsonrpc: string;
      readonly id: number;
      readonly method: string;
      readonly params: unknown[];
    };
    calls.push({ rpcUrl, method: request.method, params: request.params });
    const second = rpcUrl === RPC_URLS[1];
    const blockHash = second && mutation.secondProviderBlockHash
      ? mutation.secondProviderBlockHash
      : BLOCK_HASH;
    let result: unknown;
    if (request.method === "eth_blockNumber") {
      result = "0x188860c";
    } else if (request.method === "eth_getBlockByNumber") {
      result = {
        number: BLOCK_HEX,
        hash: blockHash,
        timestamp: "0x6a79bb17",
      };
    } else if (request.method === "eth_getTransactionReceipt") {
      const log = swapLog(
        second && mutation.secondProviderSwapData
          ? mutation.secondProviderSwapData
          : SWAP_DATA,
      );
      result = {
        transactionHash: TRANSACTION_HASH,
        transactionIndex: "0x42",
        blockHash,
        blockNumber: BLOCK_HEX,
        status: mutation.receiptStatus ?? "0x1",
        logs: mutation.duplicateSwap ? [log, { ...log, logIndex: "0x7b" }] : [log],
      };
    } else if (request.method === "eth_call") {
      const [call, reference] = request.params as [
        { readonly to: string; readonly data: string },
        { readonly blockHash: string; readonly requireCanonical: boolean },
      ];
      expect(reference).toEqual({ blockHash, requireCanonical: true });
      const to = call.to.toLowerCase();
      if (to === PCAN_ADDRESS && call.data === "0x313ce567") {
        result = encodeFunctionResult({
          abi: erc20Abi,
          functionName: "decimals",
          result: 18,
        });
      } else if (to === PCAN_ADDRESS && call.data === "0x18160ddd") {
        result = encodeFunctionResult({
          abi: erc20Abi,
          functionName: "totalSupply",
          result: mutation.tokenSupply ?? 1_000_000n * 10n ** 18n,
        });
      } else if (to === ETH_USD_FEED && call.data === "0x313ce567") {
        result = encodeFunctionResult({
          abi: feedAbi,
          functionName: "decimals",
          result: 8,
        });
      } else if (to === ETH_USD_FEED && call.data === "0xfeaf968c") {
        result = encodeFunctionResult({
          abi: feedAbi,
          functionName: "latestRoundData",
          result: [
            129127208515966893670n,
            191619896499n,
            1786359267n,
            mutation.feedUpdatedAt ?? 1786359287n,
            mutation.answeredInRound ?? 129127208515966893670n,
          ],
        });
      } else {
        throw new Error(`unexpected eth_call ${call.to} ${call.data}`);
      }
    } else {
      throw new Error(`unexpected method ${request.method}`);
    }
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

describe("Bitquery golden execution proof", () => {
  it("reproduces the exact receipt execution through fixed archive witnesses", async () => {
    const witness = witnessFetch();
    const result = await verifyBitqueryGoldenMarketExecutionV1({
      rpcUrls: RPC_URLS,
      token: token(),
      fetchImpl: witness.fetchImpl,
    });
    expect(result).toMatchObject({
      schemaVersion: "programmable.bitquery-golden-market-execution.v1",
      providerCount: 2,
      tokenAddress: PCAN_ADDRESS,
      poolId: POOL,
      quoteAddress: QUOTE,
      poolManager: POOL_MANAGER,
      transactionHash: TRANSACTION_HASH,
      transactionIndex: 66,
      bitqueryTradeOrdinal: 0,
      receiptLogIndex: 122,
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
      blockTime: BLOCK_TIME,
      executionTokenSide: "sell",
      executionAmount0: "-2970000000000000",
      executionAmount1: TOKEN_AMOUNT_RAW,
      executionNativeAmountWei: "2970000000000000",
      executionTokenAmountRaw: TOKEN_AMOUNT_RAW,
      executionPriceQuoteWad: EXECUTION_QUOTE_WAD,
      bitqueryFdvUsdWad: BITQUERY_FDV_USD_WAD,
      chainlinkExecutionFdvUsdWad: CHAINLINK_EXECUTION_FDV_USD_WAD,
      executionUsdDeviationBps: 8,
      confirmations: 20,
      chainlink: {
        feedAddress: ETH_USD_FEED,
        decimals: 8,
        answeredInRound: "129127208515966893670",
      },
    });
    expect(new Set(witness.calls.map(({ rpcUrl }) => rpcUrl))).toEqual(
      new Set(RPC_URLS),
    );
    expect(witness.calls.filter(({ method }) => method === "eth_call"))
      .toHaveLength(8);
  });

  it.each([
    ["reverted receipt", { receiptStatus: "0x0" }],
    ["ambiguous swap logs", { duplicateSwap: true }],
    ["provider swap disagreement", { secondProviderSwapData: MUTATED_SWAP_DATA }],
    ["provider block disagreement", { secondProviderBlockHash: `0x${"22".repeat(32)}` }],
    ["stale Chainlink round", { feedUpdatedAt: 1786350000n }],
    ["incomplete Chainlink round", { answeredInRound: 129127208515966893669n }],
    ["wrong historical supply", { tokenSupply: 999_999n * 10n ** 18n }],
  ] satisfies ReadonlyArray<readonly [string, WitnessMutation]>) (
    "fails closed on %s",
    async (_label, mutation) => {
      const witness = witnessFetch(mutation);
      await expect(verifyBitqueryGoldenMarketExecutionV1({
      rpcUrls: RPC_URLS,
        token: token(),
        fetchImpl: witness.fetchImpl,
      })).rejects.toThrow();
    },
  );

  it("fails before RPC when the Bitquery execution amount or quote drifts", async () => {
    const wrongAmount = token();
    wrongAmount.marketData.pools[0].latestTrade.tokenAmount = "1";
    const amountWitness = witnessFetch();
    await expect(verifyBitqueryGoldenMarketExecutionV1({
      rpcUrls: RPC_URLS,
      token: wrongAmount,
      fetchImpl: amountWitness.fetchImpl,
    })).rejects.toThrow("independent execution witnesses did not agree");

    const wrongQuote = token();
    wrongQuote.marketData.pools[0].latestTrade.priceQuoteWad = "11008417140";
    const quoteWitness = witnessFetch();
    await expect(verifyBitqueryGoldenMarketExecutionV1({
      rpcUrls: RPC_URLS,
      token: wrongQuote,
      fetchImpl: quoteWitness.fetchImpl,
    })).rejects.toThrow("does not match its receipt witness");
  });

  it("rejects a self-consistent Bitquery USD value outside the Chainlink bound", async () => {
    const wrongUsd = token();
    const wrongPrice = "22000000000000";
    const wrongFdv = "22000000000000000000";
    wrongUsd.marketData.pools[0].latestTrade.priceUsdWad = wrongPrice;
    wrongUsd.marketData.pools[0].latestTrade.rawPriceUsdWad = wrongPrice;
    wrongUsd.valuation.valueWad = wrongFdv;
    const witness = witnessFetch();
    await expect(verifyBitqueryGoldenMarketExecutionV1({
      rpcUrls: RPC_URLS,
      token: wrongUsd,
      fetchImpl: witness.fetchImpl,
    })).rejects.toThrow("does not match its receipt witness");
  });

  it("rejects an oversized declared body without retrying deterministic framing", async () => {
    let calls = 0;
    let cancellations = 0;
    const fetchImpl = async () => {
      calls += 1;
      const body = new ReadableStream<Uint8Array>({
        pull() {
          throw new Error("oversized declared responses must not be read");
        },
        cancel() {
          cancellations += 1;
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(128 * 1024 + 1) },
      });
    };

    await expect(verifyBitqueryGoldenMarketExecutionV1({
      rpcUrls: RPC_URLS,
      token: token(),
      fetchImpl,
    })).rejects.toThrow("oversized body");
    expect(calls).toBe(6);
    expect(cancellations).toBe(6);
  });

  it("cancels an oversized streaming body at the hard byte limit without retrying", async () => {
    let calls = 0;
    let cancellations = 0;
    const fetchImpl = async () => {
      calls += 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(96 * 1024));
          controller.enqueue(new Uint8Array(40 * 1024));
        },
        cancel() {
          cancellations += 1;
        },
      });
      return new Response(body, { status: 200 });
    };

    await expect(verifyBitqueryGoldenMarketExecutionV1({
      rpcUrls: RPC_URLS,
      token: token(),
      fetchImpl,
    })).rejects.toThrow("oversized body");
    expect(calls).toBe(6);
    expect(cancellations).toBe(6);
  });

  it("does not retry a deterministic invalid JSON-RPC response", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("not-json", { status: 200 });
    };

    await expect(verifyBitqueryGoldenMarketExecutionV1({
      rpcUrls: RPC_URLS,
      token: token(),
      fetchImpl,
    })).rejects.toThrow("invalid JSON");
    expect(calls).toBe(6);
  });
});
