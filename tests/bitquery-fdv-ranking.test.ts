import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BITQUERY_HTTP_ENDPOINT,
  readBitqueryTokenFdvRankingStrictV1,
} from "../lib/market-data/bitquery.server";
import {
  isTokenMarketDataV1,
  type MarketDataIdentityV1,
} from "../lib/market-data/market-data-v1";

const TOKEN = "ory_at_test_market_data_token_123456";
const IDENTITY: MarketDataIdentityV1 = {
  chainId: "1",
  tokenAddress: `0x${"11".repeat(20)}`,
  poolId: `0x${"22".repeat(32)}`,
  protocol: "uniswap_v4",
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function rankingToken() {
  return {
    Token: {
      Id: `bid:eth:${IDENTITY.tokenAddress}`,
      Address: IDENTITY.tokenAddress,
    },
    Block: { Time: "2026-08-11T14:00:00.000Z" },
    Supply: {
      TotalSupply: "1000000",
      MaxSupply: "1000000",
      FullyDilutedValuationUsd: "250000",
    },
    Price: { IsQuotedInUsd: true, Ohlc: { Close: "0.25" } },
  };
}

function liquidityRow(amountAUsd = "100000", amountBUsd = "50000") {
  return {
    Block: { Number: "25740000", Time: "2026-08-11T14:00:00.000Z" },
    Log: { Index: 1 },
    Transaction: { Hash: `0x${"aa".repeat(32)}`, Index: 7 },
    PoolEvent: {
      Pool: {
        PoolId: IDENTITY.poolId,
        CurrencyA: {
          SmartContract: IDENTITY.tokenAddress,
          Symbol: "PCAN",
        },
        CurrencyB: {
          SmartContract: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          Symbol: "WETH",
        },
      },
      Liquidity: {
        AmountCurrencyA: "100",
        AmountCurrencyAInUSD: amountAUsd,
        AmountCurrencyB: "20",
        AmountCurrencyBInUSD: amountBUsd,
      },
    },
  };
}

describe("strict lightweight Bitquery FDV ranking", () => {
  it("uses only Trading.Tokens plus realtime exact-pool liquidity", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      expect(String(url)).toBe(BITQUERY_HTTP_ENDPOINT);
      const request = JSON.parse(String(init?.body));
      expect(request.query).not.toContain("DEXTrades");
      expect(request.query).not.toContain("DEXTradeByTokens");
      if (request.query.includes("ProgrammableExploreFdvRanking")) {
        expect(request.variables).toEqual({
          tokenAddresses: [IDENTITY.tokenAddress],
        });
        expect(request.query).toContain("rankingTokens: Tokens(");
        expect(request.query).toContain("FullyDilutedValuationUsd");
        expect(request.query).toContain("Price { IsQuotedInUsd Ohlc { Close } }");
        return json({ data: { Trading: { rankingTokens: [rankingToken()] } } });
      }
      expect(request.query).toContain("EVM(network: eth) {");
      expect(request.query).not.toContain("dataset: combined");
      expect(request.query).toContain("latestLiquidity: DEXPoolEvents(");
      expect(request.variables).toEqual({ pools: [IDENTITY.poolId] });
      return json({ data: { EVM: { latestLiquidity: [liquidityRow()] } } });
    }) as typeof fetch;

    const values = await readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl,
      token: TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });
    const market = values.get(IDENTITY.tokenAddress);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(market && isTokenMarketDataV1(market)).toBe(true);
    expect(market).toMatchObject({
      status: "current",
      primaryPoolId: IDENTITY.poolId,
      pools: [{
        identity: IDENTITY,
        status: "current",
        quality: "complete",
        liquidity: {
          valueUsdWad: "150000000000000000000000",
          freshness: "current",
        },
        valuation: {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
          valueUsdWad: "250000000000000000000000",
          fdvUsdWad: "250000000000000000000000",
          totalSupply: "1000000",
          freshness: "current",
        },
      }],
    });
    expect(market?.pools[0]).not.toHaveProperty("latestTrade");
  });

  it("degrades a liquidity transport failure without failing the token read", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      if (request.query.includes("ProgrammableExploreFdvRanking")) {
        return json({ data: { Trading: { rankingTokens: [rankingToken()] } } });
      }
      throw new Error("liquidity unavailable");
    }) as typeof fetch;

    const values = await readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl,
      token: TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(IDENTITY.tokenAddress)?.pools[0]).toMatchObject({
      identity: IDENTITY,
      status: "current",
      quality: "partial",
      valuation: { status: "unavailable", reason: "source-unavailable" },
    });
  });

  it("keeps a low-liquidity pool but withholds its FDV", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      return request.query.includes("ProgrammableExploreFdvRanking")
        ? json({ data: { Trading: { rankingTokens: [rankingToken()] } } })
        : json({
            data: {
              EVM: { latestLiquidity: [liquidityRow("4999", "5000")] },
            },
          });
    }) as typeof fetch;

    const values = await readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl,
      token: TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    });

    expect(values.get(IDENTITY.tokenAddress)?.pools[0]).toMatchObject({
      liquidity: { valueUsdWad: "9999000000000000000000" },
      valuation: {
        status: "unavailable",
        reason: "inconsistent-market-data",
      },
    });
  });

  it("rejects the strict core read on provider failure", async () => {
    await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline")),
      token: TOKEN,
    })).rejects.toMatchObject({
      category: "transport",
      phase: "market-core",
    });
  });
});
