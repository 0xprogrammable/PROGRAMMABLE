import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { GmgnMarketSnapshotV1 } from
  "../lib/market-data/gmgn-market-data-v1";
import type {
  GmgnTokenPoolInfoV1,
  GmgnTokenSecurityV1,
  GmgnTokenWalletRankingV1,
} from "../lib/market-data/gmgn-token-analytics-v1";
import type { MarketChartIdentityV1 } from
  "../lib/market-data/market-data-v1";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readCatalog: vi.fn(),
  mergeCatalog: vi.fn(
    (canonical: readonly unknown[], custom: readonly unknown[]) => [
      ...canonical,
      ...custom,
    ],
  ),
  customEnabled: vi.fn(() => false),
  readCustom: vi.fn(),
  readRouterSnapshot: vi.fn(),
  mergeRouter: vi.fn(
    (existing: readonly unknown[], router: readonly unknown[]) => [
      ...existing,
      ...router,
    ],
  ),
  readMarketSnapshot: vi.fn(),
  readSecurity: vi.fn(),
  readPool: vi.fn(),
  readHolders: vi.fn(),
  readTraders: vi.fn(),
}));

vi.mock("../lib/market-data/envio-classic-v3-catalog.server", () => ({
  readEnvioClassicV3CatalogV1: mocks.readCatalog,
  mergeEnvioClassicV3CatalogEntriesV1: mocks.mergeCatalog,
}));

vi.mock("../lib/server/custom-launch/public-readiness", () => ({
  isCustomLaunchRegistryPublicReadEnabled: mocks.customEnabled,
}));

vi.mock("../lib/server/custom-launch/explore-directory-v1", () => ({
  readProductionCustomExploreDirectoryV1: mocks.readCustom,
}));

vi.mock("../lib/alchemy/router-custom-public.server", () => ({
  ROUTER_CUSTOM_LAUNCH_SOURCE: "canonical-launch-stamp-router",
  readFinalizedRouterCustomIdentitySnapshotV1: mocks.readRouterSnapshot,
  mergeRouterCustomExploreEntriesV1: mocks.mergeRouter,
  publicLaunchSourceV1: (input: Readonly<{
    envioAvailable?: boolean;
    registryCustomCurrent: boolean;
    routerCustomCurrent: boolean;
  }>) => [
    ...(input.envioAvailable === false ? [] : ["envio-classic-v3"]),
    ...(input.registryCustomCurrent
      ? ["registry.custom-launched"]
      : []),
    ...(input.routerCustomCurrent
      ? ["canonical-launch-stamp-router"]
      : []),
  ].join("+"),
}));

vi.mock("../lib/market-data/gmgn.server", () => ({
  readGmgnMarketSnapshotV1: mocks.readMarketSnapshot,
}));

vi.mock("../lib/market-data/gmgn-token-analytics.server", () => ({
  readGmgnTokenSecurityV1: mocks.readSecurity,
  readGmgnTokenPoolInfoV1: mocks.readPool,
  readGmgnTokenTopHoldersV1: mocks.readHolders,
  readGmgnTokenTopTradersV1: mocks.readTraders,
}));

import { GET } from "../app/api/explore/token/analytics/route";

const NOW = "2026-09-01T05:00:00.000Z";
const QUOTE = "0x0000000000000000000000000000000000000000" as const;

function token(index = 1): Extract<ExploreEntry, { exploreKind: "token" }> {
  const tokenAddress =
    `0x${index.toString(16).padStart(40, "0")}` as const;
  const value = {
    id: `1:${tokenAddress}`,
    name: `Programmable ${index}`,
    symbol: `PGM${index}`,
    tokenAddress,
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
    launchedAt: NOW,
    totalSupplyRaw: "10000000000000000000000",
    tokenDecimals: 18,
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    launchModel: "classic",
    launchModelVersion: "classic-v3",
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
      modelVersion: "classic-v3",
    },
  };
}

function identity(entry = token()): MarketChartIdentityV1 {
  return {
    chainId: "1",
    protocol: "uniswap_v4",
    tokenAddress: entry.tokenAddress,
    poolId: entry.poolId,
    quoteAddress: QUOTE,
  };
}

function catalog(entries: readonly ExploreEntry[] = [token()]) {
  return {
    source: "envio-classic-v3",
    status: "current" as const,
    generatedAt: NOW,
    asOfBlock: "25880000",
    asOfBlockHash: `0x${"ab".repeat(32)}`,
    entries,
    completeness: {
      classic: "current" as const,
      stock: "excluded" as const,
      custom: "unavailable" as const,
    },
    scope: {
      included: ["classic-v3"],
      excluded: ["classic-v1", "classic-v2"],
      publicCategories: ["classic", "custom"],
    },
    evidence: {
      kind: "envio-indexer-state",
      deployment: "production-test",
      sourceCommit: "test",
      progressBlock: "25880000",
      progressOccurrenceId: `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:0`,
      commitment: `sha256:${"cd".repeat(32)}`,
    },
  };
}

function routerSnapshot(entries: readonly ExploreEntry[] = []) {
  return {
    schemaVersion: "programmable.router-custom-identity-snapshot.v1",
    source: "canonical-launch-stamp-router",
    status: "current" as const,
    generatedAt: NOW,
    asOfBlock: "25880001",
    asOfBlockHash: `0x${"bc".repeat(32)}`,
    finalityConfirmations: 64,
    identityCommitment: `sha256:${"ef".repeat(32)}`,
    entries,
  };
}

function marketSnapshot(
  marketIdentity = identity(),
): GmgnMarketSnapshotV1 {
  return {
    schemaVersion: "programmable.gmgn-market-snapshot.v1",
    source: "gmgn",
    currency: "USD",
    fetchedAt: NOW,
    identity: marketIdentity,
    priceUsdWad: "1000000000000000000",
    fdvUsdWad: "10000000000000000000000",
    liquidityUsdWad: "12000000000000000000000",
    volume24hUsdWad: "100000000000000000000",
    swapCount24h: 4,
  };
}

function security(
  marketIdentity = identity(),
): GmgnTokenSecurityV1 {
  return {
    schemaVersion: "programmable.gmgn-token-security.v1",
    source: "gmgn",
    fetchedAt: NOW,
    identity: marketIdentity,
    tokenAddress: marketIdentity.tokenAddress,
    isShowAlert: false,
    isOpenSource: true,
    isBlacklisted: false,
    isHoneypot: false,
    isOwnerRenounced: true,
    isMintRenounced: true,
    isFreezeAccountRenounced: null,
    isWashTrading: false,
    top10HolderRatio: "0.1",
    developerTeamHoldRatio: null,
    creatorBalanceRatio: null,
    suspectedInsiderHoldRatio: null,
    rugRatio: null,
    ratTraderAmountRatio: null,
    bundlerTraderAmountRatio: null,
    buyTaxRatio: "0",
    sellTaxRatio: "0",
    averageTaxRatio: "0",
    highTaxRatio: "0",
    burnRatio: null,
    developerTokenBurnAmount: null,
    developerTokenBurnRatio: null,
    burnStatus: null,
    creatorTokenStatus: null,
    sniperCount: null,
    canSellCount: null,
    cannotSellCount: null,
    hideRisk: false,
    flags: [],
    lockSummary: null,
  };
}

function pool(
  marketIdentity = identity(),
): GmgnTokenPoolInfoV1 {
  return {
    schemaVersion: "programmable.gmgn-token-pool-info.v1",
    source: "gmgn",
    currency: "USD",
    fetchedAt: NOW,
    identity: marketIdentity,
    tokenAddress: marketIdentity.tokenAddress,
    poolAddress: marketIdentity.poolId,
    baseAddress: marketIdentity.tokenAddress,
    quoteAddress: marketIdentity.quoteAddress,
    token0Address: marketIdentity.quoteAddress,
    token1Address: marketIdentity.tokenAddress,
    quoteSymbol: "ETH",
    exchange: "uniswap_v4",
    liquidityUsd: "12000",
    baseReserve: "10000",
    quoteReserve: "10",
    baseReserveValueUsd: "6000",
    quoteReserveValueUsd: "6000",
    initialLiquidityUsd: "10000",
    initialBaseReserve: "10000",
    initialQuoteReserve: "10",
    priceUsd: "1",
    feeRatio: "0.01",
    creationTimestamp: 1_788_235_000,
  };
}

function ranking(
  kind: "holders" | "traders",
  limit = 20,
  marketIdentity = identity(),
): GmgnTokenWalletRankingV1 {
  return {
    schemaVersion: "programmable.gmgn-token-wallet-ranking.v1",
    source: "gmgn",
    fetchedAt: NOW,
    identity: marketIdentity,
    tokenAddress: marketIdentity.tokenAddress,
    kind,
    query: {
      limit,
      orderBy: "amount_percentage",
      direction: "desc",
      tag: null,
    },
    wallets: [],
  };
}

function request(
  address = token().tokenAddress,
  query = "",
) {
  return new NextRequest(
    `http://localhost/api/explore/token/analytics?address=${address}${query}`,
  );
}

async function body(response: Response) {
  // Public response variants are intentionally inspected in each test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await response.json() as Record<string, any>;
}

describe("Programmable GMGN token analytics API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readCatalog.mockResolvedValue(catalog());
    mocks.customEnabled.mockReturnValue(false);
    mocks.readCustom.mockResolvedValue([]);
    mocks.readRouterSnapshot.mockResolvedValue(routerSnapshot());
    mocks.mergeCatalog.mockImplementation(
      (canonical: readonly unknown[], custom: readonly unknown[]) => [
        ...canonical,
        ...custom,
      ],
    );
    mocks.mergeRouter.mockImplementation(
      (existing: readonly unknown[], router: readonly unknown[]) => [
        ...existing,
        ...router,
      ],
    );
    mocks.readMarketSnapshot.mockResolvedValue(marketSnapshot());
    mocks.readSecurity.mockResolvedValue(security());
    mocks.readPool.mockResolvedValue(pool());
    mocks.readHolders.mockResolvedValue(ranking("holders"));
    mocks.readTraders.mockResolvedValue(ranking("traders"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns only normalized summary data for the exact canonical token", async () => {
    const response = await GET(request());
    const json = await body(response);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      schemaVersion: "programmable.token-analytics.v1",
      status: "ready",
      provider: "gmgn",
      section: "summary",
      identity: identity(),
      analytics: {
        security: { tokenAddress: token().tokenAddress },
        pool: {
          tokenAddress: token().tokenAddress,
          poolAddress: token().poolId,
          exchange: "uniswap_v4",
        },
      },
    });
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
    );
    expect(response.headers.get("x-programmable-analytics-provider"))
      .toBe("gmgn");
    expect(response.headers.get("x-programmable-analytics-read-status"))
      .toBe("ready");
    expect(response.headers.get("x-programmable-market-read-status"))
      .toBe("complete");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.readMarketSnapshot).not.toHaveBeenCalled();
    expect(mocks.readHolders).not.toHaveBeenCalled();
    expect(mocks.readTraders).not.toHaveBeenCalled();
  });

  it("rejects a foreign token before every GMGN provider read", async () => {
    const foreign = "0x9999999999999999999999999999999999999999";
    const response = await GET(request(foreign));

    expect(response.status).toBe(404);
    expect(await body(response)).toEqual({ error: "Token not found" });
    expect(mocks.readSecurity).not.toHaveBeenCalled();
    expect(mocks.readPool).not.toHaveBeenCalled();
    expect(mocks.readMarketSnapshot).not.toHaveBeenCalled();
    expect(mocks.readHolders).not.toHaveBeenCalled();
    expect(mocks.readTraders).not.toHaveBeenCalled();
  });

  it("does not accept holder rows until token info proves the exact identity", async () => {
    const other = token(2);
    mocks.readMarketSnapshot.mockResolvedValue(
      marketSnapshot(identity(other)),
    );
    mocks.readHolders.mockResolvedValue(ranking("holders", 7));

    const response = await GET(request(token().tokenAddress, "&section=holders&limit=7"));
    const json = await body(response);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      status: "unavailable",
      provider: "gmgn",
      section: "holders",
      identity: identity(),
      analytics: { ranking: null },
    });
    expect(mocks.readMarketSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.readHolders).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-market-source")).toBeNull();
  });

  it("serves a verified bounded holder ranking with private cache policy", async () => {
    mocks.readHolders.mockResolvedValue(ranking("holders", 7));
    const response = await GET(request(
      token().tokenAddress,
      "&section=holders&limit=7",
    ));
    const json = await body(response);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      status: "ready",
      section: "holders",
      identity: identity(),
      analytics: {
        ranking: {
          kind: "holders",
          query: { limit: 7 },
        },
      },
    });
    expect(mocks.readHolders).toHaveBeenCalledWith(
      identity(),
      { limit: 7 },
      expect.objectContaining({ deadlineMs: expect.any(Number) }),
    );
    expect(mocks.readTraders).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control"))
      .toBe("private, max-age=0, no-store");
    expect(response.headers.get("x-programmable-market-source")).toBe("gmgn");
  });

  it("fails soft with HTTP 200 when normalized analytics are unavailable", async () => {
    mocks.readSecurity.mockRejectedValue(new Error("provider unavailable"));
    mocks.readPool.mockResolvedValue(null);

    const response = await GET(request());
    const json = await body(response);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      status: "unavailable",
      provider: "gmgn",
      section: "summary",
      identity: identity(),
      analytics: { security: null, pool: null },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-analytics-read-status"))
      .toBe("unavailable");
    expect(response.headers.get("x-programmable-market-read-status"))
      .toBe("unavailable");
  });

  it("never reflects an API key or unvalidated provider metadata", async () => {
    const secret = "gmgn-live-secret-must-never-leak";
    vi.stubEnv("GMGN_API_KEY", secret);
    mocks.readSecurity.mockResolvedValue({
      apiKey: secret,
      authorization: `Bearer ${secret}`,
      raw: { provider: "untrusted" },
    });
    mocks.readPool.mockResolvedValue(null);

    const response = await GET(request());
    const json = await body(response);
    const publicEnvelope = JSON.stringify({
      body: json,
      headers: Object.fromEntries(response.headers.entries()),
    });

    expect(response.status).toBe(200);
    expect(json.analytics).toEqual({ security: null, pool: null });
    expect(publicEnvelope).not.toContain(secret);
    expect(publicEnvelope).not.toContain("authorization");
    expect(publicEnvelope).not.toContain("untrusted");
  });

  it("bounds ranking limits before canonical or GMGN provider work", async () => {
    const response = await GET(request(
      token().tokenAddress,
      "&section=traders&limit=21",
    ));

    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      error: "Choose a limit from 1 to 20",
    });
    expect(mocks.readCatalog).not.toHaveBeenCalled();
    expect(mocks.readMarketSnapshot).not.toHaveBeenCalled();
    expect(mocks.readTraders).not.toHaveBeenCalled();
  });

  it("mirrors token detail indeterminate identity semantics with 503", async () => {
    mocks.readCatalog.mockRejectedValue(new Error("envio unavailable"));

    const response = await GET(request(
      "0x9999999999999999999999999999999999999999",
    ));

    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({
      error: "Token data is temporarily unavailable",
    });
    expect(response.headers.get("retry-after")).toBe("5");
    expect(mocks.readSecurity).not.toHaveBeenCalled();
    expect(mocks.readPool).not.toHaveBeenCalled();
  });
});
