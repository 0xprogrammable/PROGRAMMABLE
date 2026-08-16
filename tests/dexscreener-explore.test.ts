import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const mocks = vi.hoisted(() => ({ readDex: vi.fn() }));
vi.mock("../lib/market-data/dexscreener-shadow.server", () => ({
  readDexscreenerMarketShadowV1: mocks.readDex,
}));

import { readDexscreenerExploreEntriesV1 } from
  "../lib/market-data/dexscreener-explore.server";

const NOW = "2026-08-16T08:00:00.000Z";
const QUOTE = "0x0000000000000000000000000000000000000000" as const;

function entry(index: number): Extract<ExploreEntry, { exploreKind: "token" }> {
  const address = `0x${index.toString(16).padStart(40, "0")}` as const;
  const value = {
    id: `1:${address}`,
    name: `Token ${index}`,
    symbol: `T${index}`,
    tokenAddress: address,
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
    launchedAt: NOW,
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    launchModel: "classic",
  } satisfies LauncherToken;
  return {
    ...value,
    exploreKind: "token",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: value.id,
      modelId: "classic",
      modelVersion: null,
    },
  };
}

function identity(token: Extract<ExploreEntry, { exploreKind: "token" }>) {
  return {
    chainId: "1" as const,
    protocol: "uniswap_v4" as const,
    tokenAddress: token.tokenAddress!,
    poolId: token.poolId,
    quoteAddress: QUOTE,
  };
}

function available(
  token: Extract<ExploreEntry, { exploreKind: "token" }>,
  qualified = true,
) {
  return {
    identity: identity(token),
    status: "available" as const,
    observation: {
      source: "dexscreener" as const,
      mode: "shadow" as const,
      currency: "USD" as const,
      fetchedAt: NOW,
      pairAddress: token.poolId,
      priceUsdWad: "1000000000000000000",
      liquidityUsdWad: "20000000000000000000000",
      fdvUsdWad: "30000000000000000000000",
      marketCapUsdWad: "30000000000000000000000",
    },
    fdvQualification: qualified
      ? {
          status: "qualified" as const,
          minimumLiquidityUsdWad: "10000000000000000000000" as const,
        }
      : {
          status: "unavailable" as const,
          reason: "insufficient-liquidity" as const,
          minimumLiquidityUsdWad: "10000000000000000000000" as const,
        },
  };
}

function snapshot(results: readonly unknown[], status = "complete") {
  const observed = results.filter((result) =>
    (result as { status?: unknown }).status === "available"
  ).length;
  const qualified = results.filter((result) =>
    (result as {
      status?: unknown;
      fdvQualification?: { status?: unknown };
    }).status === "available" &&
    (result as { fdvQualification?: { status?: unknown } })
      .fdvQualification?.status === "qualified"
  ).length;
  return {
    source: "dexscreener",
    mode: "shadow",
    currency: "USD",
    readStatus: status,
    requestedCount: results.length,
    observedCount: observed,
    qualifiedCount: qualified,
    unavailableCount: results.length - qualified,
    sourceReadWindow: observed > 0
      ? { oldestFetchedAt: NOW, newestFetchedAt: NOW }
      : null,
    results,
  };
}

describe("Dexscreener Explore adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("promotes only one qualified exact-bound observation", async () => {
    const token = entry(1);
    mocks.readDex.mockResolvedValue(snapshot([available(token)]));
    const result = await readDexscreenerExploreEntriesV1([token]);
    expect(result.entries[0]?.valuation).toEqual({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      valueWad: "30000000000000000000000",
      freshness: "current",
      source: "dexscreener",
      asOfTime: NOW,
    });
    expect(result.marketRead).toMatchObject({
      provider: "dexscreener",
      status: "complete",
      qualifiedCount: 1,
    });
  });

  it("keeps every identity when coverage is missing or unqualified", async () => {
    const tokens = [entry(1), entry(2), entry(3)];
    mocks.readDex.mockResolvedValue(snapshot([
      available(tokens[0]!),
      available(tokens[1]!, false),
      { identity: identity(tokens[2]!), status: "unavailable", reason: "provider-missing" },
    ]));
    const result = await readDexscreenerExploreEntriesV1(tokens);
    expect(result.entries.map((item) => item.id)).toEqual(tokens.map((item) => item.id));
    expect(result.entries.map((item) => item.valuation.status)).toEqual([
      "available",
      "unavailable",
      "unavailable",
    ]);
  });

  it("fails soft for an unexpected provider exception", async () => {
    const tokens = [entry(1), entry(2)];
    mocks.readDex.mockRejectedValue(new Error("provider down"));
    const result = await readDexscreenerExploreEntriesV1(tokens);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((item) => item.valuation.status === "unavailable"))
      .toBe(true);
    expect(result.marketRead).toMatchObject({
      status: "unavailable",
      requestedCount: 2,
      qualifiedCount: 0,
    });
  });
});
