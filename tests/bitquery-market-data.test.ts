import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BITQUERY_HTTP_ENDPOINT,
  clearBitqueryMarketDataCachesForTests,
  readBitqueryMarketChartV1,
  readBitqueryTokenMarketDataStrictV1,
  readBitqueryTokenMarketDataV1,
  safeBitqueryMarketDataError,
} from "../lib/market-data/bitquery.server";
import {
  BITQUERY_MARKET_STREAM_QUERY,
  createBitqueryMarketStreamV1,
} from "../lib/market-data/bitquery-stream.server";
import {
  isMarketChartV1,
  isTokenMarketDataV1,
  marketDataStatusLabel,
  selectPrimaryMarketPoolV1,
  type MarketChartIdentityV1,
  type MarketDataIdentityV1,
} from "../lib/market-data/market-data-v1";
import { exploreEntriesMarketIdentitiesV1 } from
  "../lib/market-data/explore-market-identities";
import type { ExploreEntry } from "../lib/tokens";

const OAUTH_TOKEN = "ory_at_test_market_data_token_123456";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const NATIVE_ETH = "0x0000000000000000000000000000000000000000";
const PCAN: MarketChartIdentityV1 = {
  chainId: "1",
  tokenAddress: "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce",
  quoteAddress: NATIVE_ETH,
  poolId: "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229",
  protocol: "uniswap_v4",
};
const CLASSIC: MarketChartIdentityV1 = {
  chainId: "1",
  tokenAddress: "0x3f2a426365e7a438a7f9f758766cff419d207d51",
  quoteAddress: NATIVE_ETH,
  poolId: "0x9b8b0aa54cbf844b8534cfb817a0da47c039e67e472d239308f6a47e487e0619",
  protocol: "uniswap_v4",
};
const SECOND_CUSTOM: MarketChartIdentityV1 = {
  chainId: "1",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  quoteAddress: WETH,
  poolId: `0x${"33".repeat(32)}`,
  protocol: "uniswap_v4",
};

describe("strict Bitquery market reads", () => {
  it("rejects provider failure without using cached market data", async () => {
    await expect(readBitqueryTokenMarketDataStrictV1([PCAN], {
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:00:01.000Z"),
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    })).rejects.toMatchObject({ category: "transport" });
  });

  it("rejects missing credentials instead of returning unavailable data", async () => {
    await expect(readBitqueryTokenMarketDataStrictV1([PCAN], {
      token: null,
    })).rejects.toMatchObject({ category: "configuration" });
  });
});

function generatedIdentity(index: number): MarketChartIdentityV1 {
  return {
    chainId: "1",
    tokenAddress: `0x${index.toString(16).padStart(40, "0")}`,
    quoteAddress: WETH,
    poolId: `0x${index.toString(16).padStart(64, "0")}`,
    protocol: "uniswap_v4",
  };
}

function marketIdentity(
  identity: MarketChartIdentityV1,
): MarketDataIdentityV1 {
  return {
    chainId: identity.chainId,
    tokenAddress: identity.tokenAddress,
    poolId: identity.poolId,
    protocol: identity.protocol,
  };
}

function tradeRow(input: Readonly<{
  identity?: MarketDataIdentityV1;
  block?: string;
  time?: string;
  transaction?: string;
  transactionIndex?: number;
  logIndex?: number;
  priceUsd?: string;
  priceQuote?: string;
  amountUsd?: string;
  omitPriceUsd?: boolean;
  omitQuotePriceUsd?: boolean;
  omitAmountUsd?: boolean;
  quoteAddress?: string;
  quoteSymbol?: string;
}>) {
  const identity = input.identity ?? PCAN;
  return {
    Block: {
      Number: input.block ?? "25740000",
      Time: input.time ?? "2026-08-11T14:00:00.000Z",
    },
    Log: { Index: input.logIndex ?? 1 },
    Trade: {
      PoolId: identity.poolId,
      Buy: {
        Currency: {
          SmartContract: identity.tokenAddress,
          Symbol: "PCAN",
        },
        Amount: "100",
        ...(input.omitAmountUsd
          ? {}
          : { AmountInUSD: input.amountUsd ?? "25" }),
        Price: input.priceQuote ?? "0.0001",
        ...(input.omitPriceUsd
          ? {}
          : { PriceInUSD: input.priceUsd ?? "0.25" }),
      },
      Sell: {
        Currency: {
          SmartContract: input.quoteAddress ?? WETH,
          Symbol: input.quoteSymbol ?? "WETH",
        },
        Amount: "0.01",
        AmountInUSD: input.amountUsd ?? "25",
        Price: "10000",
        ...(input.omitQuotePriceUsd ? {} : { PriceInUSD: "2500" }),
      },
    },
    Transaction: {
      Hash: input.transaction ?? `0x${"aa".repeat(32)}`,
      Index: input.transactionIndex ?? 7,
    },
  };
}

function chartBucketRow(input: Readonly<{
  identity?: MarketChartIdentityV1;
  block?: string;
  bucket?: string;
  time?: string;
  quoteAddress?: string;
  quoteSymbol?: string;
  price?: string;
  count?: string | number;
}> = {}) {
  const identity = input.identity ?? PCAN;
  return {
    Block: {
      Bucket: input.bucket ?? "2026-08-11T14:00:00.000Z",
      Number: input.block ?? "25740000",
      Time: input.time ?? "2026-08-11T14:00:59.000Z",
    },
    Trade: {
      PoolId: identity.poolId,
      Currency: { SmartContract: identity.tokenAddress },
      Side: {
        Currency: {
          SmartContract: input.quoteAddress ?? identity.quoteAddress,
          Symbol: input.quoteSymbol ??
            (identity.quoteAddress === NATIVE_ETH ? "ETH" : "WETH"),
        },
      },
    },
    price: input.price ?? "0.0002",
    count: input.count ?? "3",
  };
}

function chartResponse(input: Readonly<{
  points?: unknown[];
  total?: string | number;
  supply?: unknown;
  errors?: unknown[];
}> = {}) {
  return {
    data: {
      EVM: {
        chart: input.points ?? [chartBucketRow()],
        chartTotal: [{ count: input.total ?? "3" }],
      },
      Trading: {
        Tokens: [input.supply ?? supplyRow()],
      },
    },
    ...(input.errors === undefined ? {} : { errors: input.errors }),
  };
}

function liquidityRow(
  identity: MarketDataIdentityV1 = PCAN,
  options: Readonly<{
    omitFirstUsd?: boolean;
    omitSecondUsd?: boolean;
    quoteAddress?: string;
    tokenAddress?: string;
    time?: string;
    transaction?: string;
    transactionIndex?: number;
    logIndex?: number;
    amountFirst?: string;
    amountSecond?: string;
    amountFirstUsd?: string;
    amountSecondUsd?: string;
  }> = {},
) {
  return {
    Block: {
      Number: "25740000",
      Time: options.time ?? "2026-08-11T14:00:00.000Z",
    },
    Log: { Index: options.logIndex ?? 1 },
    Transaction: {
      Hash: options.transaction ?? `0x${"aa".repeat(32)}`,
      Index: options.transactionIndex ?? 7,
    },
    PoolEvent: {
      Pool: {
        PoolId: identity.poolId,
        CurrencyA: {
          SmartContract: options.tokenAddress ?? identity.tokenAddress,
          Symbol: "PCAN",
        },
        CurrencyB: {
          SmartContract: options.quoteAddress ?? WETH,
          Symbol: "WETH",
        },
      },
      Liquidity: {
        AmountCurrencyA: options.amountFirst ?? "100",
        AmountCurrencyB: options.amountSecond ?? "20",
        ...(options.omitFirstUsd
          ? {}
          : { AmountCurrencyAInUSD: options.amountFirstUsd ?? "100000" }),
        ...(options.omitSecondUsd
          ? {}
          : { AmountCurrencyBInUSD: options.amountSecondUsd ?? "50000" }),
      },
    },
  };
}

function supplyRow(input: Readonly<{
  identity?: MarketDataIdentityV1;
  id?: string;
  address?: string;
  total?: string;
  circulating?: string | null;
  max?: string | null;
  time?: string;
  indexedPrice?: string | null;
  quotedInUsd?: boolean;
}> = {}) {
  const identity = input.identity ?? PCAN;
  return {
    Token: {
      Id: input.id ?? `bid:eth:${identity.tokenAddress}`,
      Address: input.address ?? identity.tokenAddress,
    },
    Block: { Time: input.time ?? "2026-08-11T14:00:00.000Z" },
    Supply: {
      TotalSupply: input.total ?? "1000000",
      CirculatingSupply: input.circulating === undefined
        ? "800000"
        : input.circulating,
      MaxSupply: input.max === undefined ? "1000000" : input.max,
      MarketCap: "999999999",
      FullyDilutedValuationUsd: "999999999",
    },
    Price: {
      IsQuotedInUsd: input.quotedInUsd ?? true,
      Ohlc: {
        Close: input.indexedPrice === undefined ? "0.25" : input.indexedPrice,
      },
    },
  };
}

function tradingPriceRow(
  input: Readonly<{
    tokenId?: string;
    tokenAddress?: string;
    time?: string;
    priceUsd?: string | null;
  }> = {},
) {
  return {
    Block: { Time: input.time ?? "2026-08-11T14:00:00.000Z" },
    Token: {
      Id: input.tokenId ?? `bid:eth:${WETH}`,
      Address: input.tokenAddress ?? WETH,
    },
    Price: {
      IsQuotedInUsd: true,
      Ohlc: {
        Close: input.priceUsd === undefined ? "2500" : input.priceUsd,
      },
    },
  };
}

function marketResponse(input: Readonly<{
  identity?: MarketDataIdentityV1;
  trade?: unknown;
  liquidity?: unknown;
  supply?: unknown;
  errors?: unknown[];
}> = {}) {
  const identity = input.identity ?? PCAN;
  const supplied = input.supply === undefined
    ? supplyRow({ identity })
    : input.supply;
  const suppliedRecord = supplied as ReturnType<typeof supplyRow> | null;
  return {
    data: {
      EVM: {
        latestTrades: input.trade === undefined
          ? [tradeRow({ identity })]
          : input.trade === null
            ? []
            : [input.trade],
        latestLiquidity: input.liquidity === undefined
          ? [liquidityRow(identity)]
          : input.liquidity === null
            ? []
            : [input.liquidity],
        stats: [{
          Trade: {
            PoolId: identity.poolId,
            Currency: { SmartContract: identity.tokenAddress },
          },
          count: "42",
          volumeUsd: "12345.67",
        }],
      },
      Trading: {
        tokenSupplies: input.supply === undefined
          ? [supplyRow({ identity })]
          : input.supply === null
            ? []
            : [input.supply],
        price0: suppliedRecord === null
          ? []
          : [tradingPriceRow({
              time: suppliedRecord.Block.Time,
            })],
      },
    },
    ...(input.errors ? { errors: input.errors } : {}),
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Bitquery-only market data", () => {
  beforeEach(() => {
    clearBitqueryMarketDataCachesForTests();
  });

  it("binds PCAN to its exact v4 PoolId and ignores Bitquery's cap estimates", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(BITQUERY_HTTP_ENDPOINT);
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        Authorization: `Bearer ${OAUTH_TOKEN}`,
        "Content-Type": "application/json",
      });
      const request = JSON.parse(String(init?.body));
      expect(String(init?.body)).not.toContain(OAUTH_TOKEN);
      if (request.query.includes("ProgrammableMarketSnapshot")) {
        expect(request.query).toContain('ProtocolName: { is: "uniswap_v4" }');
        expect(request.query).toContain("PoolId: { in: $pools }");
        expect(request.query).toContain(
          "limitBy: { by: Trade_PoolId, count: 1 }",
        );
        expect(request.query).toContain(
          "EVM(network: eth, dataset: combined)",
        );
        expect(request.query).toContain(
          "{ descending: Transaction_Index }",
        );
        expect(request.query).toContain("{ descending: Log_Index }");
        expect(request.query).toContain("Transaction { Hash Index }");
        expect(request.query.match(/TransactionStatus: \{ Success: true \}/gu))
          .toHaveLength(1);
        expect(request.query).not.toContain("MarketCap");
        expect(request.query).not.toContain("FullyDilutedValuationUsd");
        expect(request.variables).toEqual({
          pools: [PCAN.poolId],
          tokenAddresses: [PCAN.tokenAddress],
        });
        return jsonResponse(marketResponse({
          trade: tradeRow({
            priceUsd: "0.24",
            omitAmountUsd: true,
          }),
        }));
      }
      if (request.query.includes("ProgrammableMarketPrices")) {
        expect(request.variables).toEqual({});
        expect(request.query).toContain(
          `Token: { Id: { is: "bid:eth:${WETH}" } }`,
        );
        expect(request.query).toContain("Price: { IsQuotedInUsd: true }");
        expect(request.query).toContain(
          `Block: { Time: { till: "2026-08-11T14:00:00.000Z" } }`,
        );
        return jsonResponse({
          data: { Trading: { price0: [tradingPriceRow()] } },
        });
      }
      if (request.query.includes("ProgrammableMarketLiquidity")) {
        expect(request.variables).toEqual({ pools: [PCAN.poolId] });
        expect(request.query).toContain("EVM(network: eth) {");
        expect(request.query).not.toContain("dataset: combined");
        expect(request.query).toContain("latestLiquidity: DEXPoolEvents(");
        expect(request.query).toContain("CurrencyA { SmartContract Symbol }");
        expect(request.query).toContain("AmountCurrencyAInUSD");
        expect(request.query).toContain("AmountCurrencyBInUSD");
        expect(request.query).toContain("Log { Index }");
        expect(request.query).toContain("Transaction { Hash Index }");
        expect(request.query).not.toContain("latestTrades: DEXTrades(");
        return jsonResponse({
          data: { EVM: { latestLiquidity: [liquidityRow(PCAN)] } },
        });
      }
      if (request.query.includes("ProgrammableMarketStats")) {
        expect(request.variables).toEqual({
          pools: [PCAN.poolId],
          tokenAddresses: [PCAN.tokenAddress],
        });
        expect(request.query).toContain("stats: DEXTradeByTokens(");
        expect(request.query).toContain(
          "Currency: { SmartContract: { in: $tokenAddresses } }",
        );
        expect(request.query).not.toContain("latestTrades: DEXTrades(");
        return jsonResponse({
          data: {
            EVM: {
              stats: [{
                Trade: {
                  PoolId: PCAN.poolId,
                  Currency: { SmartContract: PCAN.tokenAddress },
                },
                count: "42",
                volumeUsd: "12345.67",
              }],
            },
          },
        });
      }
      throw new Error("unexpected market request");
    });
    const fetchImpl = fetchMock as typeof fetch;

    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const market = values.get(PCAN.tokenAddress);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(market && isTokenMarketDataV1(market)).toBe(true);
    expect(market).toMatchObject({
      source: "bitquery",
      status: "current",
      primaryPoolId: PCAN.poolId,
      pools: [{
        identity: marketIdentity(PCAN),
        status: "current",
        quality: "complete",
        latestTrade: {
          priceUsdWad: "250000000000000000",
          priceUsdAsOfTime: "2026-08-11T14:00:00.000Z",
          priceUsdSource: "bitquery-token-price-index-v1",
          rawPriceUsdWad: "240000000000000000",
        },
        volume24hUsdWad: "12345670000000000000000",
        tradeCount24h: 42,
        liquidity: { valueUsdWad: "150000000000000000000000" },
        valuation: {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
        },
      }],
    });
  });

  it("starts independent market reads before the core snapshot completes", async () => {
    let releaseCore: (() => void) | undefined;
    const corePending = new Promise<void>((resolve) => {
      releaseCore = resolve;
    });
    const started = new Set<string>();
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      if (request.query.includes("ProgrammableMarketSnapshot")) {
        started.add("core");
        await corePending;
      } else if (request.query.includes("ProgrammableMarketLiquidity")) {
        started.add("liquidity");
      } else if (request.query.includes("ProgrammableMarketStats")) {
        started.add("stats");
      } else {
        throw new Error("unexpected market request");
      }
      return jsonResponse(marketResponse());
    }) as typeof fetch;

    const read = readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    try {
      await vi.waitFor(() => {
        expect([...started].sort()).toEqual(["core", "liquidity", "stats"]);
      });
    } finally {
      releaseCore?.();
    }

    const values = await read;
    expect(values.get(PCAN.tokenAddress)).toMatchObject({ source: "bitquery" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["wrong token id", supplyRow({ id: `bid:eth:${CLASSIC.tokenAddress}` })],
    ["wrong token address", supplyRow({ address: CLASSIC.tokenAddress })],
  ])("rejects %s instead of attaching another token's supply", async (_label, supply) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(marketResponse({ supply }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]?.valuation).toMatchObject({
      status: "unavailable",
      reason: "supply-unavailable",
    });
  });

  it.each([
    ["more than five minutes in the future", "2026-08-11T14:05:01.000Z", "inconsistent-market-data"],
    ["more than five minutes old", "2026-08-11T13:54:59.000Z", undefined],
  ])("handles a token price-index observation %s", async (_label, priceTime, reason) => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: tradeRow({ omitAmountUsd: true }),
      supply: supplyRow({ time: priceTime }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const pool = values.get(PCAN.tokenAddress)?.pools[0];

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(pool?.latestTrade).toMatchObject({
      priceUsdWad: "250000000000000000",
      priceUsdAsOfTime: "2026-08-11T14:00:00.000Z",
    });
    if (reason) {
      expect(pool?.valuation).toEqual({
        status: "unavailable",
        reason,
      });
    } else {
      expect(pool?.valuation).toMatchObject({
        status: "available",
        freshness: "stale",
      });
    }
  });

  it("rejects a future indexed USD observation even when it matches the trade", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: tradeRow({ time: "2026-08-11T14:02:30.000Z" }),
      supply: supplyRow({ time: "2026-08-11T14:04:00.000Z" }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]?.latestTrade).toMatchObject({
      priceUsdWad: "250000000000000000",
      priceUsdAsOfTime: "2026-08-11T14:02:30.000Z",
    });
    expect(values.get(PCAN.tokenAddress)?.pools[0]?.valuation).toMatchObject({
      status: "unavailable",
      reason: "inconsistent-market-data",
    });
  });

  it("fails closed when the raw pool price contradicts the indexed USD price", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: tradeRow({ priceUsd: "0.5" }),
      supply: supplyRow({ indexedPrice: "0.25" }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const pool = values.get(PCAN.tokenAddress)?.pools[0];

    expect(pool?.latestTrade).toMatchObject({
      rawPriceUsdWad: "500000000000000000",
      priceQuoteWad: "100000000000000",
    });
    expect(pool?.latestTrade).not.toHaveProperty("priceUsdWad");
    expect(pool?.valuation).toEqual({
      status: "unavailable",
      reason: "price-unavailable",
    });
  });

  it("keeps a dust-liquidity pool discoverable but makes its FDV unavailable", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      liquidity: liquidityRow(PCAN, {
        amountFirstUsd: "4999",
        amountSecondUsd: "5000",
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const pool = values.get(PCAN.tokenAddress)?.pools[0];

    expect(pool?.identity).toEqual(marketIdentity(PCAN));
    expect(pool?.liquidity?.valueUsdWad).toBe("9999000000000000000000");
    expect(pool?.valuation).toEqual({
      status: "unavailable",
      reason: "inconsistent-market-data",
    });
  });

  it("keeps exact quote-unit data when the curated USD price is unavailable", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: tradeRow({
        omitPriceUsd: true,
        omitQuotePriceUsd: true,
        omitAmountUsd: true,
      }),
      supply: null,
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const pool = values.get(PCAN.tokenAddress)?.pools[0];

    expect(pool?.latestTrade).toMatchObject({
      priceQuoteWad: "100000000000000",
      quoteAddress: WETH,
    });
    expect(pool?.latestTrade).not.toHaveProperty("priceUsdWad");
    expect(pool?.valuation).toEqual({
      status: "unavailable",
      reason: "price-unavailable",
    });
  });

  it("derives USD from the historical native index at the exact-pool trade time", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: tradeRow({
        omitPriceUsd: true,
        omitQuotePriceUsd: true,
        omitAmountUsd: true,
      }),
      supply: supplyRow({ indexedPrice: null }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]?.latestTrade).toMatchObject({
      priceQuoteWad: "100000000000000",
      quoteAddress: WETH,
      priceUsdWad: "250000000000000000",
      priceUsdAsOfTime: "2026-08-11T14:00:00.000Z",
      priceUsdSource: "bitquery-token-price-index-v1",
      rawPriceUsdWad: "250000000000000000",
      amountUsdWad: "25000000000000000000",
    });
  });

  it("uses a current realtime native pool event while retaining the bound trade", async () => {
    const nativeEth = "0x0000000000000000000000000000000000000000";
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: tradeRow({
        omitAmountUsd: true,
        quoteAddress: nativeEth,
        quoteSymbol: "ETH",
      }),
      liquidity: liquidityRow(PCAN, {
        omitFirstUsd: true,
        omitSecondUsd: true,
        quoteAddress: "0x",
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]).toMatchObject({
      latestTrade: {
        priceUsdWad: "250000000000000000",
        quoteAddress: nativeEth,
      },
    });
    expect(values.get(PCAN.tokenAddress)?.pools[0]?.liquidity).toMatchObject({
      freshness: "current",
      valueUsdWad: "50025000000000000000000",
    });
  });

  it("does not treat an indexed native price as transaction-bound liquidity evidence", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: tradeRow({
        omitPriceUsd: true,
        omitQuotePriceUsd: true,
        omitAmountUsd: true,
      }),
      liquidity: liquidityRow(PCAN, {
        omitFirstUsd: true,
        omitSecondUsd: true,
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]?.latestTrade).toHaveProperty(
      "priceUsdWad",
    );
    expect(values.get(PCAN.tokenAddress)?.pools[0]).not.toHaveProperty(
      "liquidity",
    );
  });

  it("keeps a legitimate zero reserve in the realtime liquidity total", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      liquidity: liquidityRow(PCAN, {
        amountFirst: "0",
        amountFirstUsd: "0",
        amountSecond: "20",
        amountSecondUsd: "50000",
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]?.liquidity).toMatchObject({
      freshness: "current",
      valueUsdWad: "50000000000000000000000",
    });
  });

  it("does not publish zero total liquidity", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      liquidity: liquidityRow(PCAN, {
        amountFirst: "0",
        amountFirstUsd: "0",
        amountSecond: "0",
        amountSecondUsd: "0",
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]).not.toHaveProperty(
      "liquidity",
    );
  });

  it("does not derive missing liquidity USD for an unverified quote asset", async () => {
    const unknownQuote = "0x2222222222222222222222222222222222222222";
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: tradeRow({ quoteAddress: unknownQuote, quoteSymbol: "QUOTE" }),
      liquidity: liquidityRow(PCAN, {
        omitFirstUsd: true,
        omitSecondUsd: true,
        quoteAddress: unknownQuote,
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]).not.toHaveProperty(
      "liquidity",
    );
  });

  it("does not derive liquidity USD across different transactions", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      liquidity: liquidityRow(PCAN, {
        omitFirstUsd: true,
        omitSecondUsd: true,
        transaction: `0x${"bb".repeat(32)}`,
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]).not.toHaveProperty(
      "liquidity",
    );
  });

  it("does not derive liquidity USD across different event logs", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      liquidity: liquidityRow(PCAN, {
        omitFirstUsd: true,
        omitSecondUsd: true,
        logIndex: 2,
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]).not.toHaveProperty(
      "liquidity",
    );
  });

  it("rejects liquidity whose currencies do not contain the bound token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      liquidity: liquidityRow(PCAN, {
        tokenAddress: "0x2222222222222222222222222222222222222222",
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]).not.toHaveProperty(
      "liquidity",
    );
  });

  it.each([
    ["zero reserve with positive USD", "0", "1"],
    ["positive reserve with zero USD", "1", "0"],
  ])("rejects %s", async (_label, amountFirst, amountFirstUsd) => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      liquidity: liquidityRow(PCAN, { amountFirst, amountFirstUsd }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]).not.toHaveProperty(
      "liquidity",
    );
  });

  it.each([
    ["Classic", CLASSIC],
    ["second Custom", SECOND_CUSTOM],
  ])("keeps the %s identity exact", async (_label, identity) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(marketResponse({
        identity,
        trade: tradeRow({ identity }),
        supply: supplyRow({ identity }),
      }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([identity], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    expect(values.get(identity.tokenAddress)?.pools[0]?.identity).toEqual(
      marketIdentity(identity),
    );
  });

  it("batches multiple canonical v4 pools without crossing their identities", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const pools = [PCAN.poolId, CLASSIC.poolId].sort();
      const tokenAddresses = [PCAN.tokenAddress, CLASSIC.tokenAddress];
      if (request.query.includes("ProgrammableMarketPrices")) {
        return jsonResponse({
          data: {
            Trading: {
              price0: [tradingPriceRow()],
              price1: [tradingPriceRow()],
            },
          },
        });
      }
      if (request.query.includes("ProgrammableMarketLiquidity")) {
        expect(request.variables).toEqual({ pools });
        return jsonResponse({ data: { EVM: { latestLiquidity: [
          liquidityRow(PCAN),
          liquidityRow(CLASSIC),
        ] } } });
      }
      if (request.query.includes("ProgrammableMarketStats")) {
        expect(request.variables).toEqual({ pools, tokenAddresses });
        return jsonResponse({ data: { EVM: { stats: [PCAN, CLASSIC].map(
          (identity) => ({
            Trade: {
              PoolId: identity.poolId,
              Currency: { SmartContract: identity.tokenAddress },
            },
            count: "1",
            volumeUsd: "10",
          }),
        ) } } });
      }
      expect(request.variables).toEqual({
        pools,
        tokenAddresses,
      });
      return jsonResponse({
        data: {
          EVM: {
            latestTrades: [
              tradeRow({ identity: CLASSIC }),
              tradeRow({ identity: PCAN }),
            ],
          },
          Trading: {
            tokenSupplies: [
              supplyRow({ identity: PCAN }),
              supplyRow({ identity: CLASSIC }),
            ],
          },
        },
      });
    }) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN, CLASSIC], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(values.get(PCAN.tokenAddress)?.pools[0]?.identity).toEqual(
      marketIdentity(PCAN),
    );
    expect(values.get(CLASSIC.tokenAddress)?.pools[0]?.identity).toEqual(
      marketIdentity(CLASSIC),
    );
  });

  it("bounds historical USD price aliases without dropping later pools", async () => {
    const identities = Array.from(
      { length: 41 },
      (_, index) => generatedIdentity(index + 1),
    );
    const priceBatchSizes: number[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (request.query.includes("ProgrammableMarketSnapshot")) {
        return jsonResponse({
          data: {
            EVM: {
              latestTrades: identities.map((identity) => tradeRow({
                identity,
                omitPriceUsd: true,
                omitQuotePriceUsd: true,
              })),
            },
            Trading: {
              tokenSupplies: identities.map((identity) => supplyRow({ identity })),
            },
          },
        });
      }
      if (request.query.includes("ProgrammableMarketPrices")) {
        const aliases = [...request.query.matchAll(/price(\d+): Tokens/gu)];
        priceBatchSizes.push(aliases.length);
        return jsonResponse({
          data: {
            Trading: Object.fromEntries(aliases.map((match) => [
              `price${match[1]}`,
              [tradingPriceRow()],
            ])),
          },
        });
      }
      if (request.query.includes("ProgrammableMarketLiquidity")) {
        return jsonResponse({
          data: {
            EVM: {
              latestLiquidity: identities.map((identity) =>
                liquidityRow(identity)),
            },
          },
        });
      }
      if (request.query.includes("ProgrammableMarketStats")) {
        return jsonResponse({ data: { EVM: { stats: [] } } });
      }
      throw new Error("unexpected market request");
    }) as typeof fetch;

    const values = await readBitqueryTokenMarketDataV1(identities, {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(priceBatchSizes.sort((first, second) => first - second)).toEqual([
      1,
      20,
      20,
    ]);
    expect(identities.every((identity) =>
      values.get(identity.tokenAddress)?.pools[0]?.latestTrade?.priceUsdWad ===
        "250000000000000000"
    )).toBe(true);
  });

  it("recovers missing indexed prices from bounded singleton queries", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (request.query.includes("ProgrammableMarketSnapshot")) {
        return jsonResponse({
          data: {
            EVM: {
              latestTrades: [
                tradeRow({
                  identity: PCAN,
                  omitPriceUsd: true,
                  omitQuotePriceUsd: true,
                }),
                tradeRow({
                  identity: CLASSIC,
                  omitPriceUsd: true,
                  omitQuotePriceUsd: true,
                }),
              ],
            },
          },
        });
      }
      if (request.query.includes("ProgrammableMarketPrices")) {
        if (request.query.includes("price1:")) {
          return jsonResponse({
            data: { Trading: { price0: [], price1: [] } },
            errors: [{ message: "bounded batch price lookup was partial" }],
          });
        }
        return jsonResponse({
          data: { Trading: { price0: [tradingPriceRow()] } },
        });
      }
      if (request.query.includes("ProgrammableMarketLiquidity")) {
        return jsonResponse({
          data: {
            EVM: {
              latestLiquidity: [
                liquidityRow(PCAN),
                liquidityRow(CLASSIC),
              ],
            },
          },
        });
      }
      if (request.query.includes("ProgrammableMarketStats")) {
        return jsonResponse({
          data: {
            EVM: {
              stats: [PCAN, CLASSIC].map((identity) => ({
                Trade: {
                  PoolId: identity.poolId,
                  Currency: { SmartContract: identity.tokenAddress },
                },
                count: "1",
                volumeUsd: "10",
              })),
            },
          },
        });
      }
      throw new Error("unexpected market request");
    }) as typeof fetch;

    const values = await readBitqueryTokenMarketDataV1([PCAN, CLASSIC], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(values.get(PCAN.tokenAddress)?.pools[0]?.latestTrade).toMatchObject({
      priceUsdWad: "250000000000000000",
      priceUsdSource: "bitquery-token-price-index-v1",
    });
    expect(values.get(CLASSIC.tokenAddress)?.pools[0]?.latestTrade).toMatchObject({
      priceUsdWad: "250000000000000000",
      priceUsdSource: "bitquery-token-price-index-v1",
    });
  });

  it("recovers missing indexed prices when the batch response has no GraphQL errors", async () => {
    let priceCalls = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (request.query.includes("ProgrammableMarketSnapshot")) {
        return jsonResponse({
          data: {
            EVM: {
              latestTrades: [
                tradeRow({
                  identity: PCAN,
                  omitPriceUsd: true,
                  omitQuotePriceUsd: true,
                }),
              ],
            },
          },
        });
      }
      if (request.query.includes("ProgrammableMarketPrices")) {
        priceCalls += 1;
        return jsonResponse({
          data: {
            Trading: priceCalls === 1
              ? { price0: [] }
              : { price0: [tradingPriceRow()] },
          },
        });
      }
      if (request.query.includes("ProgrammableMarketLiquidity")) {
        return jsonResponse({
          data: { EVM: { latestLiquidity: [liquidityRow(PCAN)] } },
        });
      }
      if (request.query.includes("ProgrammableMarketStats")) {
        return jsonResponse({
          data: {
            EVM: {
              stats: [{
                Trade: {
                  PoolId: PCAN.poolId,
                  Currency: { SmartContract: PCAN.tokenAddress },
                },
                count: "1",
                volumeUsd: "10",
              }],
            },
          },
        });
      }
      throw new Error("unexpected market request");
    }) as typeof fetch;

    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(values.get(PCAN.tokenAddress)?.pools[0]?.latestTrade).toMatchObject({
      priceUsdWad: "250000000000000000",
      priceUsdSource: "bitquery-token-price-index-v1",
    });
  });

  it("keeps missing strict prices unavailable without singleton retries", async () => {
    let priceCalls = 0;
    const identities = [PCAN, CLASSIC];
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      if (request.query.includes("ProgrammableMarketSnapshot")) {
        return jsonResponse({
          data: {
            EVM: {
              latestTrades: identities.map((identity) => tradeRow({
                identity,
                omitPriceUsd: true,
                omitQuotePriceUsd: true,
              })),
            },
            Trading: {
              tokenSupplies: identities.map((identity) => supplyRow({ identity })),
            },
          },
        });
      }
      if (request.query.includes("ProgrammableMarketPrices")) {
        priceCalls += 1;
        expect(request.query.match(/price\d+: Tokens/gu)).toHaveLength(2);
        return jsonResponse({
          data: { Trading: { price0: [], price1: [] } },
        });
      }
      if (request.query.includes("ProgrammableMarketLiquidity")) {
        return jsonResponse({
          data: {
            EVM: {
              latestLiquidity: identities.map((identity) => liquidityRow(identity)),
            },
          },
        });
      }
      if (request.query.includes("ProgrammableMarketStats")) {
        return jsonResponse({
          data: {
            EVM: {
              stats: identities.map((identity) => ({
                Trade: {
                  PoolId: identity.poolId,
                  Currency: { SmartContract: identity.tokenAddress },
                },
                count: "1",
                volumeUsd: "10",
              })),
            },
          },
        });
      }
      throw new Error("unexpected market request");
    }) as typeof fetch;

    const values = await readBitqueryTokenMarketDataStrictV1(identities, {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(priceCalls).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const identity of identities) {
      expect(values.get(identity.tokenAddress)?.pools[0]?.valuation).toEqual({
        status: "unavailable",
        reason: "price-unavailable",
      });
    }
  });

  it("uses one bounded 339-market list batch and skips 24h stats", async () => {
    const identities = Array.from(
      { length: 339 },
      (_, index) => generatedIdentity(index + 1),
    );
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      expect(request.query).not.toContain("ProgrammableMarketStats");
      if (request.query.includes("ProgrammableMarketSnapshot")) {
        expect(request.query).toContain("limit: { count: 339 }");
        expect(request.variables.pools).toHaveLength(339);
        return jsonResponse({
          data: { EVM: { latestTrades: [] }, Trading: { tokenSupplies: [] } },
        });
      }
      if (request.query.includes("ProgrammableMarketLiquidity")) {
        expect(request.query).toContain("EVM(network: eth) {");
        expect(request.query).not.toContain("dataset: combined");
        expect(request.query).toContain("limit: { count: 339 }");
        expect(request.variables.pools).toHaveLength(339);
        return jsonResponse({ data: { EVM: { latestLiquidity: [] } } });
      }
      throw new Error("unexpected market request");
    }) as typeof fetch;

    const values = await readBitqueryTokenMarketDataStrictV1(identities, {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
      includeStats: false,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(values.size).toBe(339);
    expect([...values.values()].every(
      (value) => value.status === "waiting-for-first-trade",
    )).toBe(true);
  });

  it("uses exact total supply when circulating supply is absent", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      supply: supplyRow({ circulating: null }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    expect(values.get(PCAN.tokenAddress)?.pools[0]?.valuation).toMatchObject({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      totalSupply: "1000000",
    });
  });

  it("uses exact total supply instead of a third-party circulating estimate", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      supply: supplyRow({ total: "100", circulating: "101" }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    expect(values.get(PCAN.tokenAddress)?.pools[0]?.valuation).toMatchObject({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      totalSupply: "100",
    });
  });

  it("rejects a total supply above max supply instead of publishing FDV", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      supply: supplyRow({
        total: "1000001",
        circulating: null,
        max: "1000000",
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    expect(values.get(PCAN.tokenAddress)?.pools[0]?.valuation).toMatchObject({
      status: "unavailable",
      reason: "inconsistent-market-data",
    });
  });

  it("does not date valuation from a Bitquery supply observation", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: tradeRow({ time: "2026-08-11T13:50:00.000Z" }),
      liquidity: liquidityRow(PCAN, {
        time: "2026-08-11T13:50:00.000Z",
      }),
      supply: supplyRow({ time: "2026-08-11T13:50:00.000Z" }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)?.pools[0]?.valuation).toMatchObject({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      freshness: "stale",
    });
    expect(marketDataStatusLabel(values.get(PCAN.tokenAddress))).toBe(
      "Last verified",
    );
  });

  it("does not invent total USD liquidity when one pool side is missing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      liquidity: liquidityRow(PCAN, {
        omitSecondUsd: true,
        transaction: `0x${"bb".repeat(32)}`,
      }),
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const market = values.get(PCAN.tokenAddress);
    expect(market?.pools[0]).not.toHaveProperty("liquidity");
    expect(market?.pools[0]?.quality).toBe("partial");
    expect(marketDataStatusLabel(market)).toBe("Limited market data");
  });

  it("reports a confirmed empty trade result as Waiting for first trade", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: null,
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    expect(values.get(PCAN.tokenAddress)).toMatchObject({
      status: "waiting-for-first-trade",
      pools: [{
        status: "waiting-for-first-trade",
        valuation: {
          status: "unavailable",
          reason: "waiting-for-first-trade",
        },
      }],
    });
    expect(isTokenMarketDataV1(values.get(PCAN.tokenAddress))).toBe(true);
  });

  it("does not turn a partial response into a false first-trade state", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(marketResponse({
      trade: null,
      errors: [{ message: "redacted upstream error" }],
    }))) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    expect(values.get(PCAN.tokenAddress)).toMatchObject({
      status: "unavailable",
      pools: [{
        status: "unavailable",
        valuation: { reason: "source-unavailable" },
      }],
    });
  });

  it("does not preserve a cached first-trade claim through provider failure", async () => {
    const success = vi.fn(async () => jsonResponse(marketResponse({
      trade: null,
    }))) as typeof fetch;
    await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl: success,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const failure = vi.fn(async () => {
      throw new Error("provider unavailable");
    }) as typeof fetch;

    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl: failure,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:03.000Z"),
    });

    expect(values.get(PCAN.tokenAddress)).toMatchObject({
      status: "unavailable",
      pools: [{
        status: "unavailable",
        quality: "partial",
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }],
    });
    expect(isTokenMarketDataV1(values.get(PCAN.tokenAddress))).toBe(true);
  });

  it("uses only Bitquery last-known-good data during a temporary failure", async () => {
    const success = vi.fn(async () => jsonResponse(marketResponse())) as typeof fetch;
    await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl: success,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const failure = vi.fn(async () => {
      throw new Error("https://provider.invalid/?token=must-not-leak");
    }) as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl: failure,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:03.000Z"),
    });
    expect(values.get(PCAN.tokenAddress)).toMatchObject({
      status: "stale",
      pools: [{ status: "stale", quality: "partial" }],
    });
    expect(JSON.stringify(
      safeBitqueryMarketDataError(new Error(`secret ${OAUTH_TOKEN}`)),
    )).not.toContain(OAUTH_TOKEN);
  });

  it("fails closed without a server token and does not call the network", async () => {
    const fetchImpl = vi.fn() as typeof fetch;
    const values = await readBitqueryTokenMarketDataV1([PCAN], {
      fetchImpl,
      token: null,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(values.get(PCAN.tokenAddress)).toMatchObject({
      status: "unavailable",
      pools: [{ valuation: { reason: "source-unavailable" } }],
    });
  });

  it("prefers a traded pool over a higher-liquidity pool with no trades", () => {
    const traded = {
      identity: marketIdentity(PCAN),
      source: "bitquery" as const,
      status: "current" as const,
      quality: "partial" as const,
      asOfTime: "2026-08-11T14:00:00.000Z",
      latestTrade: {
        transactionHash: `0x${"aa".repeat(32)}` as `0x${string}`,
        logIndex: 1,
        blockNumber: "1",
        time: "2026-08-11T14:00:00.000Z",
        tokenSide: "buy" as const,
        priceUsdWad: "1",
      },
      liquidity: {
        asOfTime: "2026-08-11T14:00:00.000Z",
        asOfBlock: "1",
        valueUsdWad: "100",
        freshness: "current" as const,
      },
      valuation: { status: "unavailable" as const, reason: "supply-unavailable" as const },
    };
    const waiting = {
      ...traded,
      identity: SECOND_CUSTOM,
      status: "waiting-for-first-trade" as const,
      liquidity: { ...traded.liquidity, valueUsdWad: "1000000" },
      valuation: {
        status: "unavailable" as const,
        reason: "waiting-for-first-trade" as const,
      },
    };
    expect(selectPrimaryMarketPoolV1([waiting, traded])?.identity).toEqual(
      marketIdentity(PCAN),
    );
  });

  it("omits a conflicted PoolId from market reads without deleting launch identities", () => {
    const entry = (address: `0x${string}`, id: string): ExploreEntry => ({
      exploreKind: "token",
      id,
      name: id,
      symbol: id,
      tokenAddress: address,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: PCAN.poolId,
      launchedAt: "2026-08-11T14:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
      launchCategoryProvenance: {
        schemaVersion: "programmable.explore-launch-category-provenance.v1",
        category: "classic",
        source: "canonical-launch-read-model",
        recordId: id,
        modelId: null,
        modelVersion: null,
      },
    });
    const launches = [
      entry(PCAN.tokenAddress, "first"),
      entry(CLASSIC.tokenAddress, "second"),
    ];

    expect(launches).toHaveLength(2);
    expect(exploreEntriesMarketIdentitiesV1(launches)).toEqual([]);
  });
});

describe("Bitquery OHLCV chart and server stream", () => {
  beforeEach(() => clearBitqueryMarketDataCachesForTests());

  it.each(["1d", "1w", "all"] as const)(
    "uses the paid combined dataset for the %s chart",
    async (range) => {
      const fetchImpl = vi.fn(async (
        _url: string | URL | Request,
        init?: RequestInit,
      ) => {
        const request = JSON.parse(String(init?.body));
        expect(request.query).toContain("EVM(network: eth, dataset: combined)");
        expect(request.query).toContain("chart: DEXTradeByTokens(");
        expect(request.query).toContain("chartTotal: DEXTradeByTokens(");
        expect(request.query).toContain("PoolId: { is: $poolId }");
        expect(request.query).toContain(
          "Currency: { SmartContract: { is: $tokenAddress } }",
        );
        expect(request.query).toContain(
          "Side: { Currency: { SmartContract: { is: $quoteAddress } } }",
        );
        expect(request.variables).toMatchObject({
          poolId: PCAN.poolId,
          tokenAddress: PCAN.tokenAddress,
          quoteAddress: "0x",
        });
        expect(request.variables.since).toMatch(/^2026-0[78]-/u);
        return jsonResponse(chartResponse({ points: [], total: "0" }));
      }) as typeof fetch;

      const chart = await readBitqueryMarketChartV1({
        identity: PCAN,
        range,
        historyStart: "2026-07-29T00:00:00.000Z",
        fetchImpl,
        token: OAUTH_TOKEN,
        now: new Date("2026-08-11T14:02:00.000Z"),
      });

      expect(chart.status).toBe("waiting-for-first-trade");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("reads active exact-pool history as bounded provider-side median points", async () => {
    const points = [
      chartBucketRow({
        block: "25740002",
        bucket: "2026-08-11T14:01:00.000Z",
        time: "2026-08-11T14:01:59.000Z",
        price: "0.0003",
        count: "2",
      }),
      chartBucketRow({
        block: "25740000",
        bucket: "2026-08-11T14:00:00.000Z",
        time: "2026-08-11T14:00:59.000Z",
        count: "3",
      }),
    ];
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      expect(request.query).toContain("limit: { count: 80 }");
      expect(request.query).not.toContain("offset");
      expect(request.query).not.toContain("dataset: combined");
      expect(request.query).toContain(
        "Bucket: Time(interval: { count: 1, in: minutes })",
      );
      expect(request.query).toContain("price: median(of: Trade_Price)");
      expect(request.query).not.toContain("Price(minimum: Block_Number)");
      expect(request.query).not.toContain("Price(maximum: Block_Number)");
      expect(request.query).toContain("since: $since, till: $till");
      expect(request.variables).toMatchObject({
        poolId: PCAN.poolId,
        tokenAddress: PCAN.tokenAddress,
        quoteAddress: "0x",
        till: "2026-08-11T14:02:00.000Z",
      });
      expect(request.query).not.toContain("Trading {");
      return jsonResponse(chartResponse({ points, total: "5" }));
    }) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(chart).toMatchObject({
      readStatus: "live",
      status: "ready",
      swapCount: 5,
      truncated: false,
      points: [
        {
          blockNumber: "25740000",
          priceQuote: "0.0002",
          tradeCount: 3,
        },
        {
          blockNumber: "25740002",
          priceQuote: "0.0003",
          tradeCount: 2,
        },
      ],
    });
    expect(isMarketChartV1(chart)).toBe(true);
  });

  it("fails closed when a provider row carries a different quote currency", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(chartResponse({
      points: [chartBucketRow({
        quoteAddress: WETH,
        quoteSymbol: "WETH",
      })],
      total: "3",
    }))) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(chart).toMatchObject({
      readStatus: "cache-fallback",
      status: "unavailable",
      identity: PCAN,
      points: [],
      swapCount: 0,
      truncated: false,
    });
    expect(isMarketChartV1(chart)).toBe(true);
  });

  it("uses order-independent bucket prices when multiple swaps share a block", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      expect(request.query).toContain("price: median(of: Trade_Price)");
      expect(request.query).not.toContain("open: Price");
      expect(request.query).not.toContain("close: Price");
      return jsonResponse(chartResponse({
        points: [chartBucketRow({
          block: "25740000",
          time: "2026-08-11T14:00:12.000Z",
          price: "2",
          count: "2",
        })],
        total: "2",
      }));
    }) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(chart.points[0]).toMatchObject({
      blockNumber: "25740000",
      bucketStart: "2026-08-11T14:00:00.000Z",
      bucketEnd: "2026-08-11T14:01:00.000Z",
      observedAt: "2026-08-11T14:00:12.000Z",
      time: "2026-08-11T14:01:00.000Z",
      valueSemantics: "period-median",
      priceQuote: "2",
      tradeCount: 2,
    });
    expect(chart.points[0]).not.toHaveProperty("ohlcQuote");
  });

  it("bounds the observed 17-day all-history query without dropping its start", async () => {
    const historyStart = "2026-07-27T00:00:00.000Z";
    const now = new Date("2026-08-13T00:00:00.000Z");
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      expect(request.variables.since).toBe(historyStart);
      expect(request.variables.till).toBe(now.toISOString());
      expect(request.query).toContain("limit: { count: 32 }");
      expect(request.query).toContain(
        "Bucket: Time(interval: { count: 14, in: hours })",
      );
      return jsonResponse(chartResponse({
        points: [chartBucketRow({
          bucket: historyStart,
          block: "23040000",
          time: "2026-07-27T01:00:00.000Z",
          price: "1",
          count: "1",
        }), chartBucketRow({
          bucket: "2026-08-12T20:00:00.000Z",
          block: "25740000",
          time: "2026-08-12T23:00:00.000Z",
          price: "2",
          count: "1",
        })],
        total: "2",
      }));
    }) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "all",
      historyStart,
      fetchImpl,
      token: OAUTH_TOKEN,
      now,
    });

    expect(chart).toMatchObject({
      status: "ready",
      truncated: false,
      swapCount: 2,
      points: [
        {
          bucketStart: historyStart,
          bucketEnd: "2026-07-27T14:00:00.000Z",
          observedAt: "2026-07-27T01:00:00.000Z",
          valueSemantics: "period-median",
        },
        {
          bucketStart: "2026-08-12T20:00:00.000Z",
          bucketEnd: now.toISOString(),
          observedAt: "2026-08-12T23:00:00.000Z",
          valueSemantics: "period-median",
        },
      ],
    });
  });

  it("adapts a 406-day all-history interval without dropping its start", async () => {
    const historyStart = "2025-07-01T00:00:00.000Z";
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      expect(request.variables.since).toBe(historyStart);
      expect(request.variables.till).toBe("2026-08-11T14:02:00.000Z");
      expect(request.query).toContain("limit: { count: 32 }");
      expect(request.query).toContain(
        "Bucket: Time(interval: { count: 14, in: days })",
      );
      return jsonResponse(chartResponse({
        points: [chartBucketRow({
          bucket: "2025-07-01T00:00:00.000Z",
          block: "22740000",
          time: "2025-07-01T01:00:00.000Z",
          price: "1",
          count: "1",
        }), chartBucketRow({
          bucket: "2026-08-10T00:00:00.000Z",
          block: "25740000",
          time: "2026-08-11T14:00:00.000Z",
          price: "2",
          count: "1",
        })],
        total: "2",
      }));
    }) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "all",
      historyStart,
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(chart).toMatchObject({
      status: "ready",
      truncated: false,
      swapCount: 2,
      asOfTime: "2026-08-11T14:00:00.000Z",
      points: [
        {
          bucketStart: historyStart,
          bucketEnd: "2025-07-15T00:00:00.000Z",
          time: "2025-07-15T00:00:00.000Z",
          observedAt: "2025-07-01T01:00:00.000Z",
          valueSemantics: "period-median",
        },
        {
          bucketStart: "2026-08-10T00:00:00.000Z",
          bucketEnd: "2026-08-11T14:02:00.000Z",
          time: "2026-08-11T14:02:00.000Z",
          observedAt: "2026-08-11T14:00:00.000Z",
          valueSemantics: "period-median",
        },
      ],
    });
    expect(chart.points).toHaveLength(2);
  });

  it("fails closed when all-history has no canonical launch time", async () => {
    await expect(readBitqueryMarketChartV1({
      identity: PCAN,
      range: "all",
      fetchImpl: vi.fn() as typeof fetch,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    })).rejects.toMatchObject({ category: "integrity" });
  });

  it("fails closed when an aggregate row is not bound to the exact market", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(chartResponse({
      points: [chartBucketRow({ identity: CLASSIC })],
      total: "3",
    }))) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "all",
      historyStart: "2026-07-29T00:00:00.000Z",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(chart).toMatchObject({
      readStatus: "cache-fallback",
      status: "unavailable",
      swapCount: 0,
      truncated: false,
    });
    expect(isMarketChartV1(chart)).toBe(true);
  });

  it("marks aggregate coverage as truncated without inventing completeness", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(chartResponse({
      points: [chartBucketRow({ count: "5" })],
      total: "6",
    }))) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "all",
      historyStart: "2026-07-29T00:00:00.000Z",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(chart).toMatchObject({
      readStatus: "live",
      status: "partial",
      swapCount: 5,
      truncated: true,
    });
    expect(isMarketChartV1(chart)).toBe(true);
  });

  it("does not publish a partial provider aggregate as complete", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(chartResponse({
      errors: [{ message: "bounded aggregate was partial" }],
    }))) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1d",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(chart).toMatchObject({
      readStatus: "live",
      status: "partial",
      swapCount: 3,
      truncated: false,
    });
    expect(isMarketChartV1(chart)).toBe(true);
  });

  it("bounds the aggregate history read within the twelve-second deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((
        _url: string | URL | Request,
        init?: RequestInit,
      ) => {
        return new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve(jsonResponse(chartResponse()));
          }, 20_000);
          if (signal?.aborted) onAbort();
          else signal?.addEventListener("abort", onAbort, { once: true });
        });
      }) as typeof fetch;

      let settled = false;
      const pending = readBitqueryMarketChartV1({
        identity: PCAN,
        range: "1d",
        fetchImpl,
        token: OAUTH_TOKEN,
        now: new Date("2026-08-11T14:02:00.000Z"),
      }).then((value) => {
        settled = true;
        return value;
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(7_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const chart = await pending;
      expect(chart).toMatchObject({
        readStatus: "cache-fallback",
        status: "unavailable",
        swapCount: 0,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not preserve a cached empty chart as confirmed through failure", async () => {
    const success = vi.fn(async () => jsonResponse(
      chartResponse({ points: [], total: "0" }),
    )) as typeof fetch;
    await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl: success,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const failure = vi.fn(async () => {
      throw new Error("provider unavailable");
    }) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl: failure,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:03.000Z"),
    });

    expect(chart).toMatchObject({
      status: "unavailable",
      points: [],
      valuation: { status: "unavailable", reason: "source-unavailable" },
    });
    expect(isMarketChartV1(chart)).toBe(true);
  });

  it("never presents a populated chart fallback as a live provider read", async () => {
    const success = vi.fn(async () => jsonResponse(chartResponse({
      points: [chartBucketRow({
        block: "25740000",
        time: "2026-08-11T14:01:00.000Z",
        price: "1",
        count: "1",
      })],
      total: "1",
    }))) as typeof fetch;
    const live = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl: success,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    expect(live).toMatchObject({ readStatus: "live", status: "insufficient-history" });

    const failure = vi.fn(async () => {
      throw new Error("provider unavailable");
    }) as typeof fetch;
    const fallback = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl: failure,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:03.000Z"),
    });

    expect(fallback).toMatchObject({
      readStatus: "cache-fallback",
      status: "partial",
      generatedAt: live.generatedAt,
      valuation: { status: "unavailable", reason: "source-unavailable" },
    });
    expect(fallback.points).toHaveLength(1);
    expect(isMarketChartV1(fallback)).toBe(true);
  });

  it("reuses a populated chart for the two-second server cache window", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(chartResponse({
      points: [chartBucketRow({
        block: "25740000",
        time: "2026-08-11T14:01:00.000Z",
        price: "1",
        count: "1",
      })],
      total: "1",
    }))) as typeof fetch;
    const first = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const second = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:01.999Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("never queries supply or owns a current valuation", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      expect(request.query).not.toContain("Trading {");
      expect(request.variables.tokenAddress).toBe(PCAN.tokenAddress);
      return jsonResponse(chartResponse({
        points: [chartBucketRow({
          block: "25740000",
          time: "2026-08-11T14:01:00.000Z",
          price: "1",
          count: "1",
        })],
        total: "1",
      }));
    }) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(chart.valuation).toEqual({
      status: "unavailable",
      reason: "source-unavailable",
    });
    expect(chart.points).toHaveLength(1);
  });

  it("builds exact-pool median quote points without promoting raw DEX USD", async () => {
    const points = [
      chartBucketRow({
        block: "25740003",
        bucket: "2026-08-11T14:01:00.000Z",
        time: "2026-08-11T14:01:10.000Z",
        price: "4",
        count: "1",
      }),
      chartBucketRow({
        block: "25740002",
        time: "2026-08-11T14:00:40.000Z",
        price: "2",
        count: "3",
      }),
    ];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.variables.poolId).toBe(PCAN.poolId);
      expect(request.variables.tokenAddress).toBe(PCAN.tokenAddress);
      expect(request.query).toContain("DEXTradeByTokens(");
      expect(request.query).not.toContain("dataset: combined");
      expect(request.query).toContain("PoolId: { is: $poolId }");
      expect(request.query).toContain("TransactionStatus: { Success: true }");
      expect(request.query).not.toContain("PriceInUSD");
      return jsonResponse(chartResponse({ points, total: "4" }));
    }) as typeof fetch;
    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(isMarketChartV1(chart)).toBe(true);
    expect(chart).toMatchObject({
      source: "bitquery",
      status: "ready",
      identity: PCAN,
      swapCount: 4,
      points: [
        {
          blockNumber: "25740002",
          priceQuote: "2",
          tradeCount: 3,
        },
        {
          blockNumber: "25740003",
          priceQuote: "4",
          tradeCount: 1,
        },
      ],
    });
    expect(chart).not.toHaveProperty("volumeUsdWad");
    expect(chart.points.every((point) => point.priceUsd === undefined)).toBe(true);
  });

  it("keeps all swaps represented in the provider bucket count", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(chartResponse({
      points: [chartBucketRow({
        block: "25740000",
        time: "2026-08-11T14:00:02.000Z",
        price: "1.5",
        count: "2",
      })],
      total: "2",
    }))) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(chart).toMatchObject({
      status: "insufficient-history",
      swapCount: 2,
      points: [{
        blockNumber: "25740000",
        priceQuote: "1.5",
        tradeCount: 2,
      }],
    });
    expect(chart).not.toHaveProperty("volumeUsdWad");
    expect(isMarketChartV1(chart)).toBe(true);
  });

  it("never promotes raw DEX USD into chart prices or volume", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(chartResponse({
      points: [chartBucketRow({
        block: "25740001",
        time: "2026-08-11T14:00:20.000Z",
        price: "1.25",
        count: "2",
      })],
      total: "2",
      supply: supplyRow({ indexedPrice: null }),
    }))) as typeof fetch;

    const chart = await readBitqueryMarketChartV1({
      identity: PCAN,
      range: "1h",
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(isMarketChartV1(chart)).toBe(true);
    expect(chart.status).toBe("insufficient-history");
    expect(chart).not.toHaveProperty("volumeUsdWad");
    expect(chart.points[0]).toMatchObject({
      priceQuote: "1.25",
      tradeCount: 2,
    });
    expect(chart.points[0]).not.toHaveProperty("priceUsd");
    expect(chart.points[0]).not.toHaveProperty("ohlcUsd");
    expect(chart.points[0]).not.toHaveProperty("volumeUsdWad");
  });

  it("keeps the OAuth token server-side while applying typed live updates", () => {
    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();
      readonly sent: string[] = [];
      closed = false;

      constructor(readonly url: string | URL, readonly protocols?: string | string[]) {
        FakeWebSocket.instances.push(this);
      }

      addEventListener(type: string, listener: (event: { data?: string }) => void) {
        const values = this.listeners.get(type) ?? [];
        values.push(listener);
        this.listeners.set(type, values);
      }

      send(value: string) {
        this.sent.push(value);
      }

      close() {
        this.closed = true;
      }

      emit(type: string, event: { data?: string } = {}) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    const onData = vi.fn();
    const onError = vi.fn();
    const stream = createBitqueryMarketStreamV1({
      identities: [PCAN, CLASSIC, SECOND_CUSTOM],
      token: OAUTH_TOKEN,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      onData,
      onError,
    });
    stream.start();
    const socket = FakeWebSocket.instances[0];
    expect(String(socket.url)).toContain("?token=");
    expect(String(socket.url)).toContain(encodeURIComponent(OAUTH_TOKEN));
    socket.emit("open");
    socket.emit("message", {
      data: JSON.stringify({ type: "connection_ack" }),
    });
    expect(socket.sent.join("\n")).toContain("connection_init");
    expect(socket.sent.join("\n")).toContain(PCAN.poolId);
    expect(socket.sent.join("\n")).toContain(CLASSIC.poolId);
    expect(socket.sent.join("\n")).toContain(SECOND_CUSTOM.poolId);
    expect(socket.sent.join("\n")).toContain("uniswap_v4");
    expect(BITQUERY_MARKET_STREAM_QUERY).toContain(
      "Pool: { PoolId: { in: $poolIds } }",
    );
    expect(BITQUERY_MARKET_STREAM_QUERY).toContain(
      "CurrencyA { SmartContract Symbol }",
    );
    expect(BITQUERY_MARKET_STREAM_QUERY).toContain("AmountCurrencyA");
    expect(BITQUERY_MARKET_STREAM_QUERY).toContain("AmountCurrencyB");
    expect(BITQUERY_MARKET_STREAM_QUERY.match(/Log \{ Index \}/gu)).toHaveLength(2);
    expect(BITQUERY_MARKET_STREAM_QUERY.match(/DEXTrades\(/gu)).toHaveLength(1);
    expect(BITQUERY_MARKET_STREAM_QUERY.match(/DEXPoolEvents\(/gu)).toHaveLength(1);
    expect(
      BITQUERY_MARKET_STREAM_QUERY.match(/Transaction \{ Hash Index \}/gu),
    ).toHaveLength(2);
    expect(
      BITQUERY_MARKET_STREAM_QUERY.match(
        /TransactionStatus: \{ Success: true \}/gu,
      ),
    ).toHaveLength(2);
    expect(socket.sent.filter((value) => value.includes('"type":"start"')))
      .toHaveLength(1);
    socket.emit("message", {
      data: JSON.stringify({
        id: "programmable-market-stream",
        type: "data",
        payload: { data: { EVM: {
          DEXTrades: [tradeRow({ time: new Date().toISOString() })],
          DEXPoolEvents: [liquidityRow()],
        } } },
      }),
    });
    expect(onData).toHaveBeenCalledWith(expect.objectContaining({
      identity: marketIdentity(PCAN),
      market: expect.objectContaining({ source: "bitquery", status: "current" }),
    }));
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(JSON.stringify(onData.mock.calls)).not.toContain(OAUTH_TOKEN);
    stream.stop();
    expect(socket.closed).toBe(true);
  });
});
