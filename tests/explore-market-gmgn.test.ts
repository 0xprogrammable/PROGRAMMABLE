import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  readGmgn: vi.fn(),
  readDex: vi.fn(),
}));

vi.mock("../lib/market-data/gmgn.server", () => ({
  gmgnMarketDataConfiguredV1: mocks.configured,
  readGmgnExploreSnapshotsV1: mocks.readGmgn,
}));

vi.mock("../lib/market-data/dexscreener-explore.server", () => ({
  DEXSCREENER_CURRENT_MAXIMUM_AGE_MS: 300_000,
  readDexscreenerExploreEntriesV1: mocks.readDex,
}));

import {
  exploreMarketPriceSourcesV1,
  exploreMarketSourcesV1,
  readExploreMarketEntriesV1,
} from
  "../lib/market-data/explore-market.server";
import type { GmgnMarketSnapshotV1 } from
  "../lib/market-data/gmgn-market-data-v1";
import type {
  CustomProjectExploreEntry,
  ExploreEntry,
  LauncherToken,
} from "../lib/tokens";

const NOW = "2026-08-30T12:00:00.000Z";
const QUOTE = "0x0000000000000000000000000000000000000000" as const;

function entry(index: number): Extract<ExploreEntry, { exploreKind: "token" }> {
  const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
  const value = {
    id: `1:${tokenAddress}`,
    name: `Token ${index}`,
    symbol: `T${index}`,
    tokenAddress,
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
    launchedAt: NOW,
    totalSupplyRaw: "1000000000000000000000",
    tokenDecimals: 18,
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

function customProjectWithTwoMarkets(): CustomProjectExploreEntry {
  const tokenAddress = "0x5555555555555555555555555555555555555555";
  const launchingWallet = {
    namespace: "eip155:1",
    value: "0x6666666666666666666666666666666666666666",
  };
  const projectId = `sha256:${"77".repeat(32)}` as const;
  const launchId = `sha256:${"88".repeat(32)}` as const;
  const inventoryHash = `sha256:${"99".repeat(32)}` as const;
  return {
    exploreKind: "custom-project",
    id: `custom:${projectId}`,
    name: "Two Market Project",
    symbol: "TWO",
    links: [],
    launchedAt: NOW,
    finalizedAt: NOW,
    chainId: "1",
    modelId: "two-market-model",
    customProjectId: projectId,
    customLaunchId: launchId,
    launchingWallet,
    postLaunchAuthorityInventory: {
      schemaVersion: "programmable.post-launch-authority-inventory.v1",
      launchingWallet,
      addressBindings: [],
      declaredIdentityBindings: [],
      postLaunchAuthorities: [],
      confirmation: {
        mode: "artifact-bound-launching-wallet-intent",
        confirmingIdentity: launchingWallet,
        userVisibleDisclosureRequired: true,
      },
      postLaunchActionPolicy: "declared-onchain-authority-only",
      githubAuthority: "provenance-only-never-post-launch-authority",
      postLaunchAuthorityInventoryHash: inventoryHash,
    },
    postLaunchAuthorityInventoryHash: inventoryHash,
    tokenAddress,
    tokenDecimals: 18,
    markets: [
      {
        marketId: "market-a",
        kind: "uniswap-v4",
        status: "active",
        poolId: `0x${"aa".repeat(32)}`,
        baseAsset: {
          assetId: "token",
          identity: { namespace: "eip155:1", value: tokenAddress },
        },
        quoteAsset: {
          assetId: "native-eth",
          identity: { namespace: "eip155:1", value: QUOTE },
        },
      },
      {
        marketId: "market-b",
        kind: "uniswap-v4",
        status: "active",
        poolId: `0x${"bb".repeat(32)}`,
        baseAsset: {
          assetId: "token",
          identity: { namespace: "eip155:1", value: tokenAddress },
        },
        quoteAsset: {
          assetId: "wrapped-eth",
          identity: {
            namespace: "eip155:1",
            value: "0x7777777777777777777777777777777777777777",
          },
        },
      },
    ],
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "custom",
      source: "interface-preview",
      projectId,
      launchId,
      sourceRecordBindingHash: `sha256:${"ab".repeat(32)}`,
      finalizedLaunchBindingHash: `sha256:${"cd".repeat(32)}`,
    },
  };
}

function snapshot(
  value: ReturnType<typeof entry>,
  liquidityUsdWad: string,
): GmgnMarketSnapshotV1 {
  return {
    schemaVersion: "programmable.gmgn-market-snapshot.v1",
    source: "gmgn",
    currency: "USD",
    fetchedAt: NOW,
    identity: {
      chainId: "1",
      protocol: "uniswap_v4",
      tokenAddress: value.tokenAddress,
      poolId: value.poolId,
      quoteAddress: QUOTE,
    },
    priceUsdWad: "2000000000000000000",
    fdvUsdWad: "2000000000000000000000",
    liquidityUsdWad,
    volume24hUsdWad: "100000000000000000000",
    swapCount24h: 3,
  };
}

function dexRead(tokens: readonly ReturnType<typeof entry>[]) {
  return {
    entries: tokens.map((token) => ({
      ...token,
      valuation: {
        status: "available" as const,
        metric: "fdv" as const,
        supplyBasis: "total" as const,
        currency: "usd" as const,
        valueWad: "1900000000000000000000",
        freshness: "provider-recent" as const,
        source: "dexscreener" as const,
        asOfTime: NOW,
      },
    })),
    observedEntryIds: tokens.map((token) => token.id),
    marketRead: {
      provider: "dexscreener" as const,
      status: "complete" as const,
      currency: "USD" as const,
      requestedCount: tokens.length,
      observedCount: tokens.length,
      qualifiedCount: tokens.length,
      unavailableCount: 0,
      oldestFetchedAt: tokens.length ? NOW : null,
      newestFetchedAt: tokens.length ? NOW : null,
    },
  };
}

describe("Explore GMGN primary with Dexscreener fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.configured.mockReturnValue(true);
    mocks.readDex.mockImplementation(async (tokens) => dexRead(tokens));
  });

  afterEach(() => vi.useRealTimers());

  it("keeps canonical order and falls back per unqualified identity", async () => {
    const first = entry(1);
    const second = entry(2);
    mocks.readGmgn.mockResolvedValue(new Map([
      [first.id, snapshot(first, "12000000000000000000000")],
      [second.id, snapshot(second, "8000000000000000000000")],
    ]));

    const result = await readExploreMarketEntriesV1([first, second]);
    expect(result.entries.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(result.entries[0]?.valuation).toMatchObject({
      source: "gmgn",
      valueWad: "2000000000000000000000",
    });
    expect(result.entries[1]?.valuation).toMatchObject({
      source: "dexscreener",
      valueWad: "1900000000000000000000",
    });
    expect(result.entries[1]?.gmgnMarketData?.liquidityUsdWad).toBe(
      "8000000000000000000000",
    );
    expect(mocks.readDex).toHaveBeenCalledWith(
      [second],
      expect.any(Object),
    );
    expect(result.marketRead).toMatchObject({
      provider: "gmgn",
      fallbackProvider: "dexscreener",
      status: "complete",
      requestedCount: 2,
      observedCount: 2,
      qualifiedCount: 2,
      gmgnObservedCount: 2,
      gmgnQualifiedCount: 1,
      fallbackRequestedCount: 1,
      fallbackObservedCount: 1,
      fallbackQualifiedCount: 1,
    });
    expect(exploreMarketPriceSourcesV1(result.marketRead)).toEqual([
      "gmgn",
      "dexscreener",
    ]);
  });

  it("retains an observed Dexscreener fallback that did not qualify", async () => {
    const first = entry(3);
    mocks.readGmgn.mockResolvedValue(new Map([
      [first.id, snapshot(first, "8000000000000000000000")],
    ]));
    mocks.readDex.mockResolvedValueOnce({
      entries: [{
        ...first,
        valuation: {
          status: "unavailable" as const,
          reason: "source-unavailable" as const,
        },
      }],
      observedEntryIds: [first.id],
      marketRead: {
        provider: "dexscreener" as const,
        status: "complete" as const,
        currency: "USD" as const,
        requestedCount: 1,
        observedCount: 1,
        qualifiedCount: 0,
        unavailableCount: 1,
        oldestFetchedAt: NOW,
        newestFetchedAt: NOW,
      },
    });

    const result = await readExploreMarketEntriesV1([first]);

    expect(result.entries[0]?.valuation.status).toBe("unavailable");
    expect(result.marketRead).toMatchObject({
      observedCount: 1,
      qualifiedCount: 0,
      gmgnObservedCount: 1,
      gmgnQualifiedCount: 0,
      fallbackObservedCount: 1,
      fallbackQualifiedCount: 0,
    });
    expect(exploreMarketSourcesV1(result.marketRead)).toEqual([
      "gmgn",
      "dexscreener",
    ]);
    expect(exploreMarketPriceSourcesV1(result.marketRead)).toEqual([]);
  });

  it("reserves the request budget for the bounded batch fallback", async () => {
    const first = entry(7);
    mocks.readGmgn.mockResolvedValue(new Map());

    await readExploreMarketEntriesV1([first], {
      deadlineMs: Date.parse(NOW) + 8_000,
      now: () => new Date(NOW),
    });

    expect(mocks.readGmgn).toHaveBeenCalledWith([first], expect.objectContaining({
      deadlineMs: Date.parse(NOW) + 1_800,
    }));
    expect(mocks.readDex).toHaveBeenCalledWith(
      [first],
      expect.objectContaining({ deadlineMs: Date.parse(NOW) + 8_000 }),
    );
  });

  it("retains the bounded batch provider for catalog-wide reads", async () => {
    const entries = Array.from({ length: 10 }, (_, index) => entry(index + 10));
    await readExploreMarketEntriesV1(entries);
    expect(mocks.readGmgn).not.toHaveBeenCalled();
    expect(mocks.readDex).toHaveBeenCalledWith(entries, {});
  });

  it("falls back for the whole page when one entry has two markets", async () => {
    const first = entry(31);
    const custom = customProjectWithTwoMarkets();
    const entries = [first, custom];
    const fallback = {
      entries: [],
      observedEntryIds: [],
      marketRead: {
        provider: "dexscreener" as const,
        status: "complete" as const,
        currency: "USD" as const,
        requestedCount: 3,
        observedCount: 3,
        qualifiedCount: 2,
        unavailableCount: 1,
        oldestFetchedAt: NOW,
        newestFetchedAt: NOW,
      },
    };
    mocks.readDex.mockResolvedValueOnce(fallback);

    const result = await readExploreMarketEntriesV1(entries);

    expect(mocks.readGmgn).not.toHaveBeenCalled();
    expect(mocks.readDex).toHaveBeenCalledWith(entries, {});
    expect(result).toBe(fallback);
  });

  it("falls back without changing canonical order when GMGN rejects", async () => {
    const first = entry(41);
    const second = entry(42);
    mocks.readGmgn.mockRejectedValue(new Error("provider unavailable"));

    const result = await readExploreMarketEntriesV1([first, second]);

    expect(result.entries.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(result.entries).toHaveLength(2);
    expect(result.marketRead.provider).toBe("dexscreener");
    expect(mocks.readDex).toHaveBeenCalledWith([first, second], {});
  });
});
