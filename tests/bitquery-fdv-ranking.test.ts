import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BITQUERY_HTTP_ENDPOINT,
  BitqueryMarketDataError,
  readBitqueryTokenFdvRankingStrictV1,
  safeBitqueryMarketDataError,
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
      Network: "Ethereum",
    },
    Block: { Time: "2026-08-11T14:00:00.000Z" },
    Supply: {
      TotalSupply: "1000000",
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
        expect(request.query).toContain(
          "limitBy: { by: Token_Id, count: 1 }",
        );
        expect(request.query).toContain("Address: { in: $tokenAddresses }");
        expect(request.query).toContain('Network: { is: "Ethereum" }');
        expect(request.query).toContain(
          "Interval: { Time: { Duration: { eq: 1 } } }",
        );
        expect(request.query).toContain("FullyDilutedValuationUsd");
        expect(request.query).toContain("Price { IsQuotedInUsd Ohlc { Close } }");
        expect(request.query).not.toContain("Token: { Id: { in:");
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

  it("propagates a genuine liquidity transport failure with its exact phase", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      if (request.query.includes("ProgrammableExploreFdvRanking")) {
        return json({ data: { Trading: { rankingTokens: [rankingToken()] } } });
      }
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl,
      token: TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    })).rejects.toMatchObject({
      category: "transport",
      phase: "market-liquidity",
      reason: "request-transport",
    });
  });

  it("keeps a successfully empty liquidity result unavailable", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      return request.query.includes("ProgrammableExploreFdvRanking")
        ? json({ data: { Trading: { rankingTokens: [rankingToken()] } } })
        : json({ data: { EVM: { latestLiquidity: [] } } });
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

  it.each([
    [401, "configuration"],
    [400, "response"],
  ] as const)(
    "keeps a liquidity HTTP %s failure fail-closed as %s",
    async (status, category) => {
      const fetchImpl = vi.fn(async (
        _url: string | URL | Request,
        init?: RequestInit,
      ) => {
        const request = JSON.parse(String(init?.body));
        return request.query.includes("ProgrammableExploreFdvRanking")
          ? json({ data: { Trading: { rankingTokens: [rankingToken()] } } })
          : new Response("provider error", { status });
      }) as typeof fetch;

      await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
        fetchImpl,
        token: TOKEN,
      })).rejects.toMatchObject({
        category,
        phase: "market-liquidity",
        reason: "http-status",
        httpStatus: status,
      });
    },
  );

  it("keeps a partial liquidity response fail-closed", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      return request.query.includes("ProgrammableExploreFdvRanking")
        ? json({ data: { Trading: { rankingTokens: [rankingToken()] } } })
        : json({
            data: { EVM: { latestLiquidity: [] } },
            errors: [{ message: "partial liquidity" }],
          });
    }) as typeof fetch;

    await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl,
      token: TOKEN,
    })).rejects.toMatchObject({
      category: "response",
      phase: "market-liquidity",
      reason: "graphql-errors",
    });
  });

  it("keeps malformed liquidity rows fail-closed", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      return request.query.includes("ProgrammableExploreFdvRanking")
        ? json({ data: { Trading: { rankingTokens: [rankingToken()] } } })
        : json({ data: { EVM: { latestLiquidity: [{}] } } });
    }) as typeof fetch;

    await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl,
      token: TOKEN,
    })).rejects.toMatchObject({
      category: "integrity",
      phase: "market-liquidity",
    });
  });

  it("does not relabel an unknown liquidity failure as transport", async () => {
    const programmingError = new Error("unexpected liquidity failure");
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      if (request.query.includes("ProgrammableExploreFdvRanking")) {
        return json({ data: { Trading: { rankingTokens: [rankingToken()] } } });
      }
      throw programmingError;
    }) as typeof fetch;

    await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl,
      token: TOKEN,
    })).rejects.toBe(programmingError);
    expect(programmingError).not.toBeInstanceOf(BitqueryMarketDataError);
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
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      token: TOKEN,
    })).rejects.toMatchObject({
      category: "transport",
      phase: "market-core",
      reason: "request-transport",
    });
  });

  it.each([
    [401, "configuration"],
    [403, "configuration"],
    [408, "transport"],
    [425, "transport"],
    [429, "transport"],
    [500, "transport"],
    [503, "transport"],
    [400, "response"],
    [404, "response"],
    [422, "response"],
  ] as const)(
    "classifies Bitquery HTTP %s as %s",
    async (status, category) => {
      await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
        fetchImpl: vi.fn().mockResolvedValue(new Response("provider error", {
          status,
        })),
        token: TOKEN,
      })).rejects.toMatchObject({
        category,
        phase: "market-core",
        reason: "http-status",
        httpStatus: status,
      });
    },
  );

  it.each([
    [
      "invalid-content-type",
      () => new Response("not json", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    ],
    [
      "body-too-large",
      () => new Response("{}", {
        status: 200,
        headers: {
          "Content-Length": "1500001",
          "Content-Type": "application/json",
        },
      }),
    ],
    [
      "body-too-large",
      () => new Response("x".repeat(1_500_001), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ],
    [
      "invalid-json",
      () => new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ],
    [
      "missing-data",
      () => json({ errors: [{ message: "provider detail must stay private" }] }),
    ],
  ] as const)(
    "classifies a provider %s response without logging its body",
    async (reason, response) => {
      await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
        fetchImpl: vi.fn(async () => response()) as typeof fetch,
        token: TOKEN,
      })).rejects.toMatchObject({
        category: "response",
        phase: "market-core",
        reason,
      });
    },
  );

  it("classifies a GraphQL error envelope without retaining its messages", async () => {
    const providerDetail = `private provider detail ${TOKEN}`;
    let failure: unknown;
    try {
      await readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
        fetchImpl: vi.fn(async () => json({
          data: { Trading: { rankingTokens: [rankingToken()] } },
          errors: [{ message: providerDetail }],
        })) as typeof fetch,
        token: TOKEN,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      category: "response",
      phase: "market-core",
      reason: "graphql-errors",
    });
    const safe = safeBitqueryMarketDataError(failure);
    expect(safe).toEqual({
      name: "BitqueryMarketDataError",
      category: "response",
      phase: "market-core",
      reason: "graphql-errors",
    });
    expect(JSON.stringify(safe)).not.toContain(providerDetail);
    expect(JSON.stringify(safe)).not.toContain(TOKEN);
  });

  it("publishes only the safe HTTP status and typed reason", () => {
    const failure = new BitqueryMarketDataError(
      "response",
      "market-core",
      "http-status",
      400,
    );
    Object.defineProperty(failure, "cause", {
      value: `private provider body ${TOKEN}`,
    });

    const safe = safeBitqueryMarketDataError(failure);
    expect(safe).toEqual({
      name: "BitqueryMarketDataError",
      category: "response",
      phase: "market-core",
      reason: "http-status",
      httpStatus: 400,
    });
    expect(JSON.stringify(safe)).not.toContain(TOKEN);
  });

  it("distinguishes missing Trading from missing liquidity EVM data", async () => {
    await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl: vi.fn(async () => json({ data: {} })) as typeof fetch,
      token: TOKEN,
    })).rejects.toMatchObject({
      category: "response",
      phase: "market-core",
      reason: "missing-trading",
    });

    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      return request.query.includes("ProgrammableExploreFdvRanking")
        ? json({ data: { Trading: { rankingTokens: [rankingToken()] } } })
        : json({ data: {} });
    }) as typeof fetch;
    await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl,
      token: TOKEN,
    })).rejects.toMatchObject({
      category: "response",
      phase: "market-liquidity",
      reason: "missing-evm",
    });
  });

  it("does not relabel an unknown internal failure as transport", async () => {
    const programmingError = new TypeError("unexpected internal failure");
    await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl: vi.fn().mockRejectedValue(programmingError),
      token: TOKEN,
    })).rejects.toBe(programmingError);
  });

  it("does not relabel an unknown response-body failure as transport", async () => {
    const programmingError = new Error("unexpected body failure");
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      arrayBuffer: vi.fn().mockRejectedValue(programmingError),
    } as unknown as Response;

    await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl: vi.fn().mockResolvedValue(response),
      token: TOKEN,
    })).rejects.toBe(programmingError);
  });

  it("rejects a same-address row bound to another chain id", async () => {
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body));
      return request.query.includes("ProgrammableExploreFdvRanking")
        ? json({
            data: {
              Trading: {
                rankingTokens: [{
                  ...rankingToken(),
                  Token: {
                    Id: `base:${IDENTITY.tokenAddress}`,
                    Address: IDENTITY.tokenAddress,
                    Network: "Base",
                  },
                }],
              },
            },
          })
        : json({ data: { EVM: { latestLiquidity: [liquidityRow()] } } });
    }) as typeof fetch;

    await expect(readBitqueryTokenFdvRankingStrictV1([IDENTITY], {
      fetchImpl,
      token: TOKEN,
      now: new Date("2026-08-11T14:02:00.000Z"),
    })).rejects.toMatchObject({
      category: "integrity",
      phase: "market-core",
    });
  });
});
