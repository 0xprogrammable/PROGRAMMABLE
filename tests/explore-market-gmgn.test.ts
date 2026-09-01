import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  eligible: vi.fn(),
  hydrate: vi.fn(),
  hydrationRequired: vi.fn(),
  readGmgn: vi.fn(),
  readDex: vi.fn(),
}));

vi.mock("../lib/market-data/canonical-token-supply.server", () => ({
  canonicalTokenSupplyHydrationRequiredV1: mocks.hydrationRequired,
  hydrateMissingCanonicalTokenSupplyV1: mocks.hydrate,
}));

vi.mock("../lib/market-data/gmgn.server", () => ({
  gmgnMarketDataConfiguredV1: mocks.configured,
  gmgnVisibleMarketEntryEligibleV1: mocks.eligible,
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
    marketScope: "token",
    poolAttribution: "unavailable",
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

function dexRead(tokens: readonly ExploreEntry[]) {
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
    mocks.hydrate.mockImplementation(async (tokens) => [...tokens]);
    mocks.hydrationRequired.mockImplementation((token) =>
      token.totalSupplyRaw === undefined || token.tokenDecimals === undefined
    );
    mocks.eligible.mockImplementation((token) =>
      token.exploreKind === "token" &&
      typeof token.totalSupplyRaw === "string" &&
      typeof token.tokenDecimals === "number"
    );
    mocks.readGmgn.mockResolvedValue(new Map());
    mocks.readDex.mockImplementation(async (tokens) => dexRead(tokens));
  });

  afterEach(() => vi.useRealTimers());

  it("falls back without exposing an unqualified GMGN snapshot", async () => {
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
    expect(result.entries[1]?.gmgnMarketData).toBeUndefined();
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

  it("does not attach a stale GMGN snapshot to a Dexscreener fallback", async () => {
    const first = entry(4);
    mocks.readGmgn.mockResolvedValue(new Map([
      [first.id, {
        ...snapshot(first, "12000000000000000000000"),
        fetchedAt: "2026-08-30T11:00:00.000Z",
      }],
    ]));

    const result = await readExploreMarketEntriesV1([first]);

    expect(result.entries[0]?.valuation).toMatchObject({
      status: "available",
      source: "dexscreener",
    });
    expect(result.entries[0]?.gmgnMarketData).toBeUndefined();
    expect(result.marketRead).toMatchObject({
      observedCount: 1,
      qualifiedCount: 1,
      gmgnObservedCount: 1,
      gmgnQualifiedCount: 0,
      fallbackObservedCount: 1,
      fallbackQualifiedCount: 1,
    });
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
    expect(result.entries[0]?.gmgnMarketData).toBeUndefined();
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

  it("does not publish or qualify an unobserved fallback valuation", async () => {
    const first = entry(5);
    mocks.readGmgn.mockResolvedValue(new Map([
      [first.id, snapshot(first, "8000000000000000000000")],
    ]));
    mocks.readDex.mockResolvedValueOnce({
      entries: [{
        ...first,
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
      }],
      observedEntryIds: [],
      marketRead: {
        provider: "dexscreener" as const,
        status: "complete" as const,
        currency: "USD" as const,
        requestedCount: 1,
        observedCount: 0,
        qualifiedCount: 1,
        unavailableCount: 0,
        oldestFetchedAt: NOW,
        newestFetchedAt: NOW,
      },
    });

    const result = await readExploreMarketEntriesV1([first]);

    expect(result.entries[0]?.valuation).toEqual({
      status: "unavailable",
      reason: "source-unavailable",
    });
    expect(result.marketRead).toMatchObject({
      observedCount: 1,
      qualifiedCount: 0,
      gmgnObservedCount: 1,
      gmgnQualifiedCount: 0,
      fallbackObservedCount: 0,
      fallbackQualifiedCount: 0,
    });
    expect(exploreMarketSourcesV1(result.marketRead)).toEqual(["gmgn"]);
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

  it("keeps GMGN primary when a visible page contains more than nine entries", async () => {
    const entries = Array.from({ length: 10 }, (_, index) => entry(index + 10));
    mocks.readGmgn.mockResolvedValue(new Map(entries.map((token) => [
      token.id,
      snapshot(token, "12000000000000000000000"),
    ])));

    const result = await readExploreMarketEntriesV1(entries);

    expect(mocks.readGmgn).toHaveBeenCalledWith(entries, expect.any(Object));
    expect(mocks.readDex).not.toHaveBeenCalled();
    expect(result.entries.map((token) => token.valuation.status === "available"
      ? token.valuation.source
      : null)).toEqual(Array(10).fill("gmgn"));
    expect(result.marketRead).toMatchObject({
      provider: "gmgn",
      status: "complete",
      requestedCount: 10,
      observedCount: 10,
      qualifiedCount: 10,
      gmgnObservedCount: 10,
      gmgnQualifiedCount: 10,
      fallbackRequestedCount: 0,
      fallbackObservedCount: 0,
      fallbackQualifiedCount: 0,
    });
  });

  it("passes the public API maximum of 100 entries to the bounded GMGN reader", async () => {
    const entries = Array.from({ length: 100 }, (_, index) => entry(index + 100));
    await readExploreMarketEntriesV1(entries);
    expect(mocks.readGmgn).toHaveBeenCalledWith(
      entries,
      expect.objectContaining({ deadlineMs: Date.parse(NOW) + 1_800 }),
    );
    expect(mocks.readDex).toHaveBeenCalledWith(entries, {});
  });

  it("hydrates at most the first 20 required entries on a 100-entry page", async () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({
      ...entry(index + 600),
      totalSupplyRaw: undefined,
    }));
    mocks.hydrate.mockImplementationOnce(async (
      tokens: readonly ExploreEntry[],
    ) => tokens.map((token) => ({
      ...token,
      totalSupplyRaw: "1000000000000000000000",
    })));

    const result = await readExploreMarketEntriesV1(entries);

    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
    expect(mocks.hydrate).toHaveBeenCalledWith(
      entries.slice(0, 20),
      expect.objectContaining({ deadlineMs: Date.parse(NOW) + 1_800 }),
    );
    const gmgnRequested = mocks.readGmgn.mock.calls[0]?.[0] as
      | readonly ExploreEntry[]
      | undefined;
    expect(gmgnRequested).toHaveLength(20);
    expect(gmgnRequested?.map((token) => token.id)).toEqual(
      entries.slice(0, 20).map((token) => token.id),
    );
    expect(gmgnRequested?.every((token) =>
      token.totalSupplyRaw === "1000000000000000000000"
    )).toBe(true);
    expect(result.entries).toHaveLength(100);
    expect(result.entries.slice(0, 20).every((token) =>
      token.totalSupplyRaw === "1000000000000000000000"
    )).toBe(true);
    expect(result.entries.slice(20).every((token) =>
      token.totalSupplyRaw === undefined
    )).toBe(true);
    const dexRequested = mocks.readDex.mock.calls[0]?.[0] as
      | readonly ExploreEntry[]
      | undefined;
    expect(dexRequested).toHaveLength(100);
    expect(dexRequested?.map((token) => token.id)).toEqual(
      entries.map((token) => token.id),
    );
  });

  it("does not spend hydration capacity on a required entry without a market", async () => {
    const noMarket = {
      ...customProjectWithTwoMarkets(),
      markets: [],
      totalSupplyRaw: undefined,
    };
    const eligible = { ...entry(750), totalSupplyRaw: undefined };
    mocks.hydrate.mockImplementationOnce(async (
      tokens: readonly ExploreEntry[],
    ) => tokens.map((token) => ({
      ...token,
      totalSupplyRaw: "1000000000000000000000",
    })));

    await readExploreMarketEntriesV1([noMarket, eligible]);

    expect(mocks.hydrate).toHaveBeenCalledWith(
      [eligible],
      expect.objectContaining({ deadlineMs: Date.parse(NOW) + 1_800 }),
    );
    expect(mocks.readGmgn).toHaveBeenCalledWith(
      [expect.objectContaining({
        id: eligible.id,
        totalSupplyRaw: "1000000000000000000000",
      })],
      expect.any(Object),
    );
  });

  it("projects only validated supply fields from the hydrator", async () => {
    const first = { ...entry(751), totalSupplyRaw: undefined };
    mocks.hydrate.mockResolvedValueOnce([{
      ...first,
      name: "tampered name",
      symbol: "BAD",
      links: [{ label: "bad", url: "https://example.invalid" }],
      poolId: `0x${"ff".repeat(32)}`,
      launchCategoryProvenance: {
        ...first.launchCategoryProvenance,
        source: "interface-preview",
      } as unknown as typeof first.launchCategoryProvenance,
      totalSupplyRaw: "5000000000",
      tokenDecimals: 9,
    }]);

    const result = await readExploreMarketEntriesV1([first]);
    const gmgnRequested = mocks.readGmgn.mock.calls[0]?.[0]?.[0] as
      | ExploreEntry
      | undefined;

    expect(gmgnRequested).toMatchObject({
      ...first,
      totalSupplyRaw: "5000000000",
      tokenDecimals: 9,
    });
    expect(gmgnRequested?.name).toBe(first.name);
    expect(gmgnRequested?.symbol).toBe(first.symbol);
    expect(gmgnRequested?.links).toEqual(first.links);
    expect((gmgnRequested as typeof first | undefined)?.poolId).toBe(
      first.poolId,
    );
    expect(gmgnRequested?.launchCategoryProvenance).toEqual(
      first.launchCategoryProvenance,
    );
    expect(result.entries[0]).toMatchObject({
      name: first.name,
      symbol: first.symbol,
      poolId: first.poolId,
      totalSupplyRaw: "5000000000",
      tokenDecimals: 9,
    });
  });

  it.each([
    ["zero supply", "0", 18],
    ["non-canonical supply", "01", 18],
    ["uint256 overflow", (1n << 256n).toString(), 18],
    ["out-of-range decimals", "1", 256],
  ] as const)(
    "rejects %s returned by the hydrator",
    async (_label, totalSupplyRaw, tokenDecimals) => {
      const first = { ...entry(752), totalSupplyRaw: undefined };
      mocks.hydrate.mockResolvedValueOnce([{
        ...first,
        totalSupplyRaw,
        tokenDecimals,
      }]);

      const result = await readExploreMarketEntriesV1([first]);

      expect(mocks.readGmgn).not.toHaveBeenCalled();
      expect(result.entries[0]?.totalSupplyRaw).toBeUndefined();
      expect(result.entries[0]?.tokenDecimals).toBe(first.tokenDecimals);
    },
  );

  it("partitions one multi-market entry without downgrading an eligible peer", async () => {
    const first = entry(31);
    const custom = customProjectWithTwoMarkets();
    const entries = [first, custom];
    mocks.readGmgn.mockResolvedValue(new Map([
      [first.id, snapshot(first, "12000000000000000000000")],
    ]));
    const fallback = {
      entries: [{
        ...custom,
        valuation: {
          status: "unavailable" as const,
          reason: "source-unavailable" as const,
        },
      }],
      observedEntryIds: [custom.id],
      marketRead: {
        provider: "dexscreener" as const,
        status: "complete" as const,
        currency: "USD" as const,
        requestedCount: 2,
        observedCount: 2,
        qualifiedCount: 2,
        unavailableCount: 0,
        oldestFetchedAt: NOW,
        newestFetchedAt: NOW,
      },
    };
    mocks.readDex.mockResolvedValueOnce(fallback);

    const result = await readExploreMarketEntriesV1(entries);

    expect(mocks.readGmgn).toHaveBeenCalledWith([first], expect.any(Object));
    expect(mocks.readDex).toHaveBeenCalledWith([custom], {});
    expect(result.entries.map((token) => token.id)).toEqual([
      first.id,
      custom.id,
    ]);
    expect(result.entries[0]?.valuation).toMatchObject({ source: "gmgn" });
    expect(result.entries[1]?.valuation).toMatchObject({
      status: "unavailable",
    });
    expect(result.marketRead).toMatchObject({
      provider: "gmgn",
      status: "complete",
      requestedCount: 2,
      observedCount: 2,
      qualifiedCount: 1,
      unavailableCount: 1,
      gmgnObservedCount: 1,
      gmgnQualifiedCount: 1,
      fallbackRequestedCount: 1,
      fallbackObservedCount: 1,
      // Dex observed two identities, but its multi-market entry did not yield
      // one unambiguous displayed valuation.
      fallbackQualifiedCount: 0,
    });
  });

  it("uses hydrated entries for eligibility, GMGN, fallback, and output", async () => {
    const first = { ...entry(35), totalSupplyRaw: undefined };
    const hydrated = { ...first, totalSupplyRaw: "1000000000000000000000" };
    mocks.hydrate.mockResolvedValue([hydrated]);
    mocks.readGmgn.mockResolvedValue(new Map());

    const result = await readExploreMarketEntriesV1([first]);

    expect(mocks.eligible.mock.calls[0]?.[0]).toEqual(hydrated);
    expect(mocks.readGmgn).toHaveBeenCalledWith([hydrated], expect.any(Object));
    expect(mocks.readDex).toHaveBeenCalledWith([hydrated], {});
    expect(result.entries[0]).toMatchObject({
      id: hydrated.id,
      totalSupplyRaw: hydrated.totalSupplyRaw,
    });
  });

  it("bounds supply hydration before continuing with the unchanged fallback entry", async () => {
    const first = { ...entry(36), totalSupplyRaw: undefined };
    let finishHydration: ((value: ExploreEntry[]) => void) | undefined;
    mocks.hydrate.mockReturnValue(new Promise((resolve) => {
      finishHydration = resolve;
    }));

    const pending = readExploreMarketEntriesV1([first], {
      deadlineMs: Date.parse(NOW) + 8_000,
      now: () => new Date(NOW),
    });
    await vi.advanceTimersByTimeAsync(1_800);
    const result = await pending;

    expect(mocks.hydrate).toHaveBeenCalledWith(
      [first],
      expect.objectContaining({
        deadlineMs: Date.parse(NOW) + 1_800,
        now: expect.any(Function),
      }),
    );
    expect(mocks.readGmgn).not.toHaveBeenCalled();
    expect(mocks.readDex).toHaveBeenCalledWith(
      [first],
      expect.objectContaining({ deadlineMs: Date.parse(NOW) + 8_000 }),
    );
    expect(result.entries[0]?.id).toBe(first.id);
    finishHydration?.([{ ...first, totalSupplyRaw: "1" }]);
  });

  it("stops awaiting supply hydration when the caller aborts", async () => {
    const first = { ...entry(37), totalSupplyRaw: undefined };
    const controller = new AbortController();
    mocks.hydrate.mockReturnValue(new Promise(() => undefined));

    const pending = readExploreMarketEntriesV1([first], {
      signal: controller.signal,
      now: () => new Date(NOW),
    });
    controller.abort();
    const result = await pending;

    expect(mocks.readGmgn).not.toHaveBeenCalled();
    expect(mocks.readDex).toHaveBeenCalledWith(
      [first],
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(result.entries[0]?.id).toBe(first.id);
  });

  it("uses only Dexscreener when no entry is GMGN eligible", async () => {
    const custom = customProjectWithTwoMarkets();
    const fallback = dexRead([custom]);
    mocks.readDex.mockResolvedValueOnce(fallback);

    const result = await readExploreMarketEntriesV1([custom]);

    expect(mocks.readGmgn).not.toHaveBeenCalled();
    expect(mocks.readDex).toHaveBeenCalledWith([custom], {});
    expect(result).toBe(fallback);
  });

  it("falls back per entry without changing canonical order when GMGN rejects", async () => {
    const first = entry(41);
    const second = entry(42);
    mocks.readGmgn.mockRejectedValue(new Error("provider unavailable"));

    const result = await readExploreMarketEntriesV1([first, second]);

    expect(result.entries.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(result.entries).toHaveLength(2);
    expect(result.marketRead).toMatchObject({
      provider: "gmgn",
      status: "complete",
      gmgnObservedCount: 0,
      gmgnQualifiedCount: 0,
      fallbackRequestedCount: 2,
      fallbackObservedCount: 2,
      fallbackQualifiedCount: 2,
    });
    expect(mocks.readDex).toHaveBeenCalledWith([first, second], {});
  });
});
