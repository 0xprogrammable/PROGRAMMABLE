import { describe, expect, it } from "vitest";

import { canonicalTokenExploreEntryV1 } from "../lib/explore-entry-v1";
import {
  buildExploreDataQuality,
  exploreValuation,
  publicExploreEntryV1,
  valuationSortValue,
  type ValuedExploreEntry,
  withBitqueryMarketData,
  withExploreValuation,
  withPublicExploreBitqueryMarketData,
} from "../lib/explore-financial-data";
import type { TokenMarketDataV1 } from
  "../lib/market-data/market-data-v1";
import type { LauncherToken } from "../lib/tokens";

const TOKEN_ADDRESS =
  "0x79870000000000000000000000000000000024ee" as const;

function goldenToken(
  overrides: Partial<LauncherToken> = {},
): LauncherToken {
  return {
    id: `1:${TOKEN_ADDRESS}`,
    name: "Programmable",
    symbol: "V4",
    tokenAddress: TOKEN_ADDRESS,
    hookAddress: "0x2222222222222222222222222222222222222222",
    poolId: `0x${"33".repeat(32)}`,
    launchedAt: "2026-08-10T17:40:20.000Z",
    totalSupplyRaw: "1000000000000000000000000000",
    tokenDecimals: 18,
    activeLiquidity: "41873636805959591033727",
    fdvUsdWad: "2779462110000000000000000",
    indexedValuationBlockNumber: "25725559",
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    ...overrides,
  };
}

describe("Explore financial-data semantics", () => {
  it("labels a positive-liquidity total-supply valuation only as FDV", () => {
    expect(
      exploreValuation(goldenToken(), { referenceBlock: "25725569" }),
    ).toEqual({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      valueWad: "2779462110000000000000000",
      freshness: "current",
      asOfBlock: "25725559",
      lagBlocks: "10",
    });
  });

  it("preserves v4 quote ordering output as quote FDV without relabeling it", () => {
    expect(
      exploreValuation(goldenToken({
        name: "STONKS",
        symbol: "STONKS",
        fdvUsdWad: undefined,
        quoteIsCurrency0: true,
        quoteAssetSymbol: "SPYon",
        marketCapQuoteWad: "123456789000000000000000",
      })),
    ).toMatchObject({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "quote",
      quoteSymbol: "SPYon",
      valueWad: "123456789000000000000000",
    });
  });

  it.each([
    [{ totalSupplyRaw: undefined }, "supply-unavailable"],
    [{ tokenDecimals: 256 }, "supply-unavailable"],
    [{ activeLiquidity: "0" }, "liquidity-unavailable"],
    [{ fdvUsdWad: "NaN" }, "price-unavailable"],
    [{ fdvUsdWad: "0" }, "price-unavailable"],
    [{ indexedValuationBlockNumber: undefined }, "inconsistent-snapshot"],
  ] as const)("fails unavailable for unsafe inputs %o", (overrides, reason) => {
    expect(exploreValuation(goldenToken(overrides))).toEqual({
      status: "unavailable",
      reason,
    });
  });

  it("marks a known valuation stale instead of replacing it with zero", () => {
    expect(
      exploreValuation(goldenToken(), { referenceBlock: "25725624" }),
    ).toMatchObject({
      status: "available",
      freshness: "stale",
      lagBlocks: "65",
    });
  });

  it("sorts only reconciled current USD FDV", () => {
    const valued = (overrides: Partial<LauncherToken>, referenceBlock: string) =>
      withExploreValuation(
        canonicalTokenExploreEntryV1(goldenToken(overrides)),
        { referenceBlock },
      );
    const currentUsd = valued({}, "25725569");
    const staleUsd = valued({}, "25725624");
    const unknownUsd = valued({
      indexedValuationBlockNumber: undefined,
    }, "25725569");
    const currentEth = valued({
      fdvUsdWad: undefined,
      marketCapEthWei: "900000000000000000000",
    }, "25725569");
    const currentQuote = valued({
      fdvUsdWad: undefined,
      quoteAssetSymbol: "SPYon",
      marketCapQuoteWad: "123456789000000000000000",
    }, "25725569");

    expect(valuationSortValue(currentUsd)).toBe(
      2_779_462_110_000_000_000_000_000n,
    );
    expect(valuationSortValue(staleUsd)).toBeNull();
    expect(valuationSortValue(unknownUsd)).toBeNull();
    expect(valuationSortValue(currentEth)).toBeNull();
    expect(valuationSortValue(currentQuote)).toBeNull();
  });

  it("keeps last-verified Bitquery FDV out of current sorting and compatibility fields", () => {
    const poolId = `0x${"33".repeat(32)}` as const;
    const marketData = {
      schemaVersion: "programmable.market-data.v1",
      source: "bitquery",
      generatedAt: "2026-08-11T14:02:00.000Z",
      status: "stale",
      primaryPoolId: poolId,
      pools: [{
        identity: {
          chainId: "1",
          tokenAddress: TOKEN_ADDRESS,
          poolId,
          protocol: "uniswap_v4",
        },
        source: "bitquery",
        status: "stale",
        quality: "partial",
        asOfTime: "2026-08-11T13:50:00.000Z",
        latestTrade: {
          transactionHash: `0x${"11".repeat(32)}`,
          logIndex: 1,
          blockNumber: "25740000",
          time: "2026-08-11T13:50:00.000Z",
          tokenSide: "buy",
          priceUsdWad: "250000000000000000",
          priceUsdAsOfTime: "2026-08-11T13:50:00.000Z",
          priceUsdSource: "bitquery-token-price-index-v1",
          rawPriceUsdWad: "245000000000000000",
        },
        liquidity: {
          asOfTime: "2026-08-11T13:50:00.000Z",
          asOfBlock: "25740000",
          valueUsdWad: "50000000000000000000000",
          freshness: "stale",
        },
        valuation: {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
          valueUsdWad: "250000000000000000000000",
          fdvUsdWad: "250000000000000000000000",
          totalSupply: "1000000",
          asOfTime: "2026-08-11T13:50:00.000Z",
          freshness: "stale",
        },
      }],
    } satisfies TokenMarketDataV1;
    const entry = withBitqueryMarketData(
      canonicalTokenExploreEntryV1(goldenToken()),
      marketData,
    );

    expect(entry.valuation).toMatchObject({
      status: "available",
      source: "bitquery",
      freshness: "stale",
      metric: "fdv",
      supplyBasis: "total",
      valueWad: "250000000000000000000000000",
    });
    expect(valuationSortValue(entry)).toBeNull();
    const published = publicExploreEntryV1(entry);
    expect(published).not.toHaveProperty("fdvUsdWad");
    expect(published).not.toHaveProperty("tokenPriceUsdWad");
    expect(published).not.toHaveProperty("tokenPriceQuoteWad");
  });

  it("preserves exact historical detail but removes FDV beyond the public stale ceiling", () => {
    const poolId = `0x${"34".repeat(32)}` as const;
    const marketData = {
      schemaVersion: "programmable.market-data.v1",
      source: "bitquery",
      generatedAt: "2026-08-11T14:02:00.000Z",
      status: "stale",
      primaryPoolId: poolId,
      pools: [{
        identity: {
          chainId: "1",
          tokenAddress: TOKEN_ADDRESS,
          poolId,
          protocol: "uniswap_v4",
        },
        source: "bitquery",
        status: "stale",
        quality: "partial",
        asOfTime: "2026-08-10T11:50:47.000Z",
        latestTrade: {
          transactionHash: `0x${"12".repeat(32)}`,
          logIndex: 1,
          blockNumber: "25724408",
          time: "2026-08-10T11:50:47.000Z",
          tokenSide: "buy",
          priceUsdWad: "44033668556000000",
          priceUsdAsOfTime: "2026-08-10T11:50:47.000Z",
          priceUsdSource: "bitquery-token-price-index-v1",
          rawPriceUsdWad: "44033668556000000",
        },
        valuation: { status: "unavailable", reason: "supply-unavailable" },
      }],
    } satisfies TokenMarketDataV1;
    const entry = withBitqueryMarketData(
      canonicalTokenExploreEntryV1(goldenToken()),
      marketData,
    );

    expect(entry.valuation).toMatchObject({
      status: "available",
      source: "bitquery",
      freshness: "stale",
      metric: "fdv",
      supplyBasis: "total",
    });
    expect(valuationSortValue(entry)).toBeNull();
    expect(publicExploreEntryV1(entry)).not.toHaveProperty("fdvUsdWad");

    const publicEntry = withPublicExploreBitqueryMarketData(
      canonicalTokenExploreEntryV1(goldenToken()),
      marketData,
      Date.parse(marketData.generatedAt),
    );
    expect(publicEntry.valuation).toEqual({
      status: "unavailable",
      reason: "price-unavailable",
    });
    expect(publicEntry.marketData?.pools[0]?.valuation).toEqual({
      status: "unavailable",
      reason: "price-unavailable",
    });
    expect(valuationSortValue(publicEntry)).toBeNull();
  });

  it("keeps the indexed USD timestamp authoritative for public freshness", () => {
    const poolId = `0x${"33".repeat(32)}` as const;
    const marketData = {
      schemaVersion: "programmable.market-data.v1",
      source: "bitquery",
      generatedAt: "2026-08-11T14:02:00.000Z",
      status: "current",
      primaryPoolId: poolId,
      pools: [{
        identity: {
          chainId: "1",
          tokenAddress: TOKEN_ADDRESS,
          poolId,
          protocol: "uniswap_v4",
        },
        source: "bitquery",
        status: "current",
        quality: "complete",
        asOfTime: "2026-08-11T14:01:00.000Z",
        latestTrade: {
          transactionHash: `0x${"22".repeat(32)}`,
          logIndex: 1,
          blockNumber: "25740001",
          time: "2026-08-11T14:01:00.000Z",
          tokenSide: "buy",
          priceUsdWad: "250000000000000000",
          priceUsdAsOfTime: "2026-08-11T13:56:00.000Z",
          priceUsdSource: "bitquery-token-price-index-v1",
          rawPriceUsdWad: "245000000000000000",
        },
        liquidity: {
          asOfTime: "2026-08-11T14:01:00.000Z",
          asOfBlock: "25740001",
          valueUsdWad: "50000000000000000000000",
          freshness: "current",
        },
        valuation: {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
          valueUsdWad: "250000000000000000000000",
          fdvUsdWad: "250000000000000000000000",
          totalSupply: "1000000",
          asOfTime: "2026-08-11T14:01:00.000Z",
          freshness: "current",
        },
      }],
    } satisfies TokenMarketDataV1;
    const entry = withBitqueryMarketData(
      canonicalTokenExploreEntryV1(goldenToken()),
      marketData,
    );

    expect(entry.valuation).toMatchObject({
      status: "available",
      source: "bitquery",
      freshness: "stale",
      asOfTime: "2026-08-11T13:56:00.000Z",
    });
    expect(valuationSortValue(entry)).toBeNull();
    const published = publicExploreEntryV1(entry);
    expect(published).not.toHaveProperty("fdvUsdWad");
    expect(published).not.toHaveProperty("tokenPriceUsdWad");
  });

  it("publishes total-supply values only through the FDV contract", () => {
    const entry = withExploreValuation(
      canonicalTokenExploreEntryV1(goldenToken({
        fdvUsdWad: undefined,
        indexedMarketCapUsdWad: "2779462110000000000000000",
        indexedMarketCapEth: "794.223",
        indexedMarketCapEthWei: "794223000000000000000",
        marketCapEth: "794",
        marketCapEthWei: "794000000000000000000",
        marketCapQuote: "2779462.11",
        marketCapQuoteWad: "2779462110000000000000000",
      })),
      { referenceBlock: "25725569" },
    );

    const published = publicExploreEntryV1(entry);

    expect(published).toMatchObject({
      fdvUsdWad: "2779462110000000000000000",
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        currency: "usd",
        valueWad: "2779462110000000000000000",
      },
    });
    for (const field of [
      "marketCapEth",
      "marketCapEthWei",
      "indexedMarketCapEth",
      "indexedMarketCapEthWei",
      "indexedMarketCapUsdWad",
      "marketCapQuote",
      "marketCapQuoteWad",
    ]) {
      expect(published).not.toHaveProperty(field);
    }
  });

  it("summarizes partial identity and valuation quality explicitly", () => {
    const available = withExploreValuation(
      canonicalTokenExploreEntryV1(goldenToken()),
      { referenceBlock: "25725569" },
    );
    const unavailable = withExploreValuation(
      canonicalTokenExploreEntryV1(goldenToken({
        id: "1:unavailable",
        tokenAddress: "0x9999999999999999999999999999999999999999",
        activeLiquidity: "0",
      })),
      { referenceBlock: "25725569" },
    );

    expect(buildExploreDataQuality({
      entries: [available, unavailable],
      generatedAt: "2026-08-10T18:00:00.000Z",
      canonicalStatus: "current",
      customStatus: "unavailable",
      identityAsOfBlock: "25725559",
      referenceBlock: "25725569",
      identityAgeMs: 0,
    })).toMatchObject({
      status: "partial",
      launchIdentity: {
        status: "partial",
        canonical: "current",
        custom: "unavailable",
      },
      valuation: {
        status: "partial",
        metric: "fdv",
        available: 1,
        unavailable: 1,
        stale: 0,
        unknown: 0,
      },
    });
  });

  it("includes Custom v4 valuations in the shared data-quality summary", () => {
    const custom = {
      exploreKind: "custom-project",
      valuation: {
        status: "available",
        metric: "market-cap",
        supplyBasis: "circulating",
        currency: "usd",
        valueWad: "1000000000000000000",
        freshness: "current",
        source: "bitquery",
        asOfTime: "2026-08-11T14:00:00.000Z",
      },
    } as ValuedExploreEntry;

    expect(buildExploreDataQuality({
      entries: [custom],
      generatedAt: "2026-08-11T14:00:01.000Z",
      canonicalStatus: "current",
      customStatus: "current",
      identityAsOfBlock: "25740000",
      referenceBlock: "25740000",
      identityAgeMs: 0,
    }).valuation).toMatchObject({
      status: "current",
      metric: "market-cap",
      available: 1,
      unavailable: 0,
      asOfTime: "2026-08-11T14:00:00.000Z",
    });
  });

  it("does not call a partial market response complete", () => {
    const valued = {
      ...withExploreValuation(
        canonicalTokenExploreEntryV1(goldenToken()),
        { referenceBlock: "25725569" },
      ),
      marketData: {
        schemaVersion: "programmable.market-data.v1",
        source: "bitquery",
        generatedAt: "2026-08-11T14:00:00.000Z",
        status: "partial",
        primaryPoolId: `0x${"33".repeat(32)}`,
        pools: [{
          identity: {
            chainId: "1",
            tokenAddress: "0x1111111111111111111111111111111111111111",
            poolId: `0x${"33".repeat(32)}`,
            protocol: "uniswap_v4",
          },
          source: "bitquery",
          status: "current",
          quality: "partial",
          valuation: {
            status: "available",
            metric: "fdv",
            supplyBasis: "total",
            valueUsdWad: "2779462110000000000000000",
            fdvUsdWad: "2779462110000000000000000",
            totalSupply: "1000000000",
            asOfTime: "2026-08-11T14:00:00.000Z",
            freshness: "current",
          },
        }],
      },
    } as ValuedExploreEntry;

    expect(buildExploreDataQuality({
      entries: [valued],
      generatedAt: "2026-08-11T14:00:01.000Z",
      canonicalStatus: "current",
      customStatus: "current",
      identityAsOfBlock: "25725569",
      referenceBlock: "25725569",
      identityAgeMs: 0,
    })).toMatchObject({
      status: "partial",
      valuation: { status: "partial" },
    });
  });
});
