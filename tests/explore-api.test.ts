import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ValuedExploreEntry } from "../lib/explore-financial-data";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const mocks = vi.hoisted(() => ({
  readCatalog: vi.fn(),
  readDex: vi.fn(),
  identityCommitment: vi.fn(() => `sha256:${"ef".repeat(32)}`),
  mergeEntries: vi.fn((canonical: readonly unknown[], custom: readonly unknown[]) => [
    ...canonical,
    ...custom,
  ]),
  customEnabled: vi.fn(() => false),
  readCustom: vi.fn(),
}));

vi.mock("../lib/market-data/envio-classic-v3-catalog.server", () => ({
  readEnvioClassicV3CatalogV1: mocks.readCatalog,
  envioClassicV3IdentityCommitmentV1: mocks.identityCommitment,
  mergeEnvioClassicV3CatalogEntriesV1: mocks.mergeEntries,
}));
vi.mock("../lib/market-data/dexscreener-explore.server", () => ({
  readDexscreenerExploreEntriesV1: mocks.readDex,
}));
vi.mock("../lib/server/custom-launch/public-readiness", () => ({
  isCustomLaunchRegistryPublicReadEnabled: mocks.customEnabled,
}));
vi.mock("../lib/server/custom-launch/explore-directory-v1", () => ({
  readProductionCustomExploreDirectoryV1: mocks.readCustom,
}));

import { GET } from "../app/api/explore/route";

const NOW = "2026-08-16T08:00:00.000Z";
const TOKEN_COUNT = 36;

function token(index: number): ExploreEntry {
  const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
  const value = {
    id: `1:${tokenAddress}`,
    name: index === 7 ? "Focused Launch" : `Token ${index}`,
    symbol: index === 7 ? "FOCUS" : `T${index}`,
    tokenAddress,
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
    launchedAt: new Date(Date.parse(NOW) + index * 1_000).toISOString(),
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    links: index % 2 === 0
      ? [{ kind: "x", url: `https://x.com/token${index}` }]
      : [],
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

const entries = Array.from({ length: TOKEN_COUNT }, (_, index) => token(index + 1));

const multiMarketCustom = {
  exploreKind: "custom-project",
  id: `custom:sha256:${"11".repeat(32)}`,
  name: "Multi-market Custom",
  symbol: "MULTI",
  links: [],
  launchedAt: NOW,
  finalizedAt: NOW,
  chainId: "1",
  modelId: "custom-model",
  customProjectId: `sha256:${"11".repeat(32)}`,
  customLaunchId: `sha256:${"22".repeat(32)}`,
  launchingWallet: {
    namespace: "eip155:1",
    value: "0x3333333333333333333333333333333333333333",
  },
  postLaunchAuthorityInventory: {},
  postLaunchAuthorityInventoryHash: `sha256:${"44".repeat(32)}`,
  markets: [{ marketId: "market-a" }, { marketId: "market-b" }],
  launchCategoryProvenance: {},
} as unknown as ExploreEntry;

function catalog(overrides: Record<string, unknown> = {}) {
  return {
    source: "envio-classic-v3",
    status: "last-known-good",
    generatedAt: NOW,
    asOfBlock: "25740000",
    asOfBlockHash: `0x${"ab".repeat(32)}`,
    entries,
    completeness: {
      classic: "last-known-good",
      stock: "excluded",
      custom: "unavailable",
    },
    scope: {
      included: ["classic-v3", "registry.custom-launched"],
      excluded: [
        "classic-v1",
        "classic-v2",
        "stock-paired-v1",
        "stock-paired-v2",
        "stock-paired-v3",
      ],
      publicCategories: ["classic", "custom"],
    },
    evidence: {
      kind: "envio-indexer-state",
      deployment: "production-92f6373",
      sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
      progressBlock: "25740000",
      progressOccurrenceId: `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:0`,
      commitment: `sha256:${"cd".repeat(32)}`,
    },
    ...overrides,
  };
}

function marketRead(input: Readonly<{
  requested: number;
  qualified: number;
  observed?: number;
  status?: "complete" | "partial" | "unavailable";
}>) {
  const observed = input.observed ?? input.qualified;
  return {
    provider: "dexscreener" as const,
    status: input.status ?? (observed === input.requested
      ? "complete" as const
      : observed === 0
        ? "unavailable" as const
        : "partial" as const),
    currency: "USD" as const,
    requestedCount: input.requested,
    observedCount: observed,
    qualifiedCount: input.qualified,
    unavailableCount: input.requested - input.qualified,
    oldestFetchedAt: observed > 0 ? NOW : null,
    newestFetchedAt: observed > 0 ? NOW : null,
  };
}

function valued(
  input: readonly ExploreEntry[],
  qualifiedIndexes: ReadonlySet<number> = new Set(input.map((_entry, index) => index)),
): readonly ValuedExploreEntry[] {
  return input.map((entry, index) => qualifiedIndexes.has(index)
    ? {
        ...entry,
        valuation: {
          status: "available" as const,
          metric: "fdv" as const,
          supplyBasis: "total" as const,
          currency: "usd" as const,
          valueWad: (BigInt(entry.tokenAddress ?? "0x0") * 10n ** 18n).toString(),
          freshness: "provider-recent" as const,
          source: "dexscreener" as const,
          asOfTime: NOW,
        },
      }
    : {
        ...entry,
        valuation: {
          status: "unavailable" as const,
          reason: "source-unavailable" as const,
        },
      });
}

function request(query = "") {
  return new NextRequest(`http://localhost/api/explore${query ? `?${query}` : ""}`);
}

async function json(response: Response) {
  // Test fixtures intentionally inspect several public response variants.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await response.json() as Record<string, any>;
}

describe("Explore static identity and Dexscreener market contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readCatalog.mockResolvedValue(catalog());
    mocks.customEnabled.mockReturnValue(false);
    mocks.readCustom.mockResolvedValue([]);
    mocks.readDex.mockImplementation(async (input: readonly ExploreEntry[]) => ({
      entries: valued(input),
      marketRead: marketRead({ requested: input.length, qualified: input.length }),
    }));
  });

  it("merges the independently verified Custom Registry lane when ready", async () => {
    const custom = token(99);
    mocks.customEnabled.mockReturnValue(true);
    mocks.readCustom.mockResolvedValue([custom]);
    const response = await GET(request("sort=newest&page=1&limit=100"));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.total).toBe(TOKEN_COUNT + 1);
    expect(body.catalog).toMatchObject({
      identityCount: TOKEN_COUNT + 1,
      completeness: { custom: "current" },
    });
    expect(body.dataQuality.launchIdentity.custom).toBe("current");
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "envio-classic-v3+registry.custom-launched",
    );
  });

  it("keeps every canonical identity when the Custom Registry lane fails", async () => {
    mocks.customEnabled.mockReturnValue(true);
    mocks.readCustom.mockRejectedValue(new Error("custom unavailable"));
    const response = await GET(request("sort=newest&page=1&limit=100"));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.total).toBe(TOKEN_COUNT);
    expect(body.catalog.completeness.custom).toBe("unavailable");
    expect(body.dataQuality.launchIdentity.custom).toBe("unavailable");
  });

  it("derives ranking counts from entries when one Custom has two markets", async () => {
    mocks.readCatalog.mockResolvedValue(catalog({ entries: [] }));
    mocks.customEnabled.mockReturnValue(true);
    mocks.readCustom.mockResolvedValue([multiMarketCustom]);
    mocks.readDex.mockResolvedValueOnce({
      entries: [{
        ...multiMarketCustom,
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }],
      marketRead: marketRead({
        requested: 2,
        observed: 2,
        qualified: 2,
        status: "complete",
      }),
    });

    const response = await GET(request("sort=market-cap&page=1&limit=9"));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.marketRead).toMatchObject({
      requestedCount: 2,
      qualifiedCount: 2,
    });
    expect(body.ranking).toEqual({
      status: "unavailable",
      requested: "fdv",
      applied: "launch-order",
      qualifiedCount: 0,
      totalCount: 1,
    });
    expect(body.tokens[0].valuation.status).toBe("unavailable");
  });

  it("serves last-good identities with exact-source Dexscreener FDV", async () => {
    const response = await GET(request("sort=market-cap&page=1&limit=5"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      page: 1,
      pageSize: 5,
      total: TOKEN_COUNT,
      totalPages: 8,
      sort: "market-cap",
      ranking: {
        status: "complete",
        requested: "fdv",
        applied: "fdv",
        qualifiedCount: TOKEN_COUNT,
        totalCount: TOKEN_COUNT,
      },
      catalog: {
        source: "envio-classic-v3",
        status: "last-known-good",
        lastIndexedAt: NOW,
        identityCount: TOKEN_COUNT,
      },
    });
    expect(body.tokens).toHaveLength(5);
    expect(body.tokens[0].valuation.source).toBe("dexscreener");
    expect(body.tokens[0].valuation.freshness).toBe("provider-recent");
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "envio-classic-v3",
    );
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "envio-classic-v3+dexscreener",
    );
    expect(response.headers.get("x-programmable-market-provider")).toBe(
      "dexscreener",
    );
    expect(mocks.readDex.mock.calls[0]?.[0]).toHaveLength(TOKEN_COUNT);
  });

  it.each(["market-cap", "market-cap-asc"] as const)(
    "retains every identity and applies launch order for zero-qualified %s",
    async (sort) => {
      mocks.readDex.mockImplementationOnce(async (input: readonly ExploreEntry[]) => ({
        entries: valued(input, new Set()),
        marketRead: marketRead({
          requested: input.length,
          qualified: 0,
          observed: 0,
          status: "unavailable",
        }),
      }));
      const response = await GET(request(`sort=${sort}&page=1&limit=100`));
      const body = await json(response);

      expect(response.status).toBe(200);
      expect(body.total).toBe(TOKEN_COUNT);
      expect(body.tokens).toHaveLength(TOKEN_COUNT);
      expect(new Set(body.tokens.map((entry: ExploreEntry) => entry.id)).size)
        .toBe(TOKEN_COUNT);
      expect(body.ranking).toEqual({
        status: "unavailable",
        requested: "fdv",
        applied: "launch-order",
        qualifiedCount: 0,
        totalCount: TOKEN_COUNT,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(body.tokens.every((entry: any) =>
        entry.valuation.status === "unavailable" && !("fdvUsdWad" in entry)
      )).toBe(true);
      expect(response.headers.get("x-programmable-market-source")).toBeNull();
    },
  );

  it("keeps 351 identities when the bounded Dex producer returns unavailable", async () => {
    const largeCatalog = Array.from({ length: 351 }, (_, index) => token(index + 1));
    mocks.readCatalog.mockResolvedValue(catalog({ entries: largeCatalog }));
    mocks.readDex.mockImplementationOnce(async (
      input: readonly ExploreEntry[],
      wait: Readonly<{ signal: AbortSignal; deadlineMs: number }>,
    ) => {
      expect(wait.signal).toBeInstanceOf(AbortSignal);
      expect(wait.deadlineMs).toBeGreaterThan(Date.now());
      expect(wait.deadlineMs - Date.now()).toBeLessThanOrEqual(8_000);
      return {
        entries: valued(input, new Set()),
        marketRead: marketRead({
          requested: input.length,
          qualified: 0,
          observed: 0,
          status: "unavailable",
        }),
      };
    });

    const response = await GET(request("sort=market-cap&page=1&limit=351"));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.total).toBe(351);
    expect(body.tokens).toHaveLength(100);
    expect(body.catalog.identityCount).toBe(351);
    expect(body.ranking).toMatchObject({
      status: "unavailable",
      qualifiedCount: 0,
      totalCount: 351,
    });
    expect(body.tokens.every((item: ValuedExploreEntry) =>
      item.valuation.status === "unavailable"
    )).toBe(true);
  });

  it("sorts qualified FDV first and keeps unavailable launch order stable", async () => {
    mocks.readDex.mockImplementationOnce(async (input: readonly ExploreEntry[]) => ({
      entries: valued(input, new Set([0, 2, 4])),
      marketRead: marketRead({
        requested: input.length,
        qualified: 3,
        observed: 3,
        status: "partial",
      }),
    }));
    const response = await GET(request("sort=market-cap&page=1&limit=100"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.ranking).toEqual({
      status: "partial",
      requested: "fdv",
      applied: "qualified-fdv-then-launch-order",
      qualifiedCount: 3,
      totalCount: TOKEN_COUNT,
    });
    expect(body.tokens.slice(0, 3).map((entry: ExploreEntry) => entry.id)).toEqual([
      entries[4]!.id,
      entries[2]!.id,
      entries[0]!.id,
    ]);
    const unavailable = [...entries].reverse()
      .filter((entry) => !new Set([entries[0]!.id, entries[2]!.id, entries[4]!.id])
        .has(entry.id));
    expect(body.tokens.slice(3).map((entry: ExploreEntry) => entry.id)).toEqual(
      unavailable.map((entry) => entry.id),
    );
  });

  it("reads market only for the requested newest identity page", async () => {
    const response = await GET(request("sort=newest&page=2&limit=9"));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.tokens).toHaveLength(9);
    expect(body).not.toHaveProperty("ranking");
    expect(mocks.readDex.mock.calls[0]?.[0]).toHaveLength(9);
  });

  it("discloses a stale validated Envio catalog and its exact timestamp", async () => {
    mocks.readCatalog.mockResolvedValueOnce(catalog({
      source: "envio-classic-v3",
      status: "last-known-good",
      generatedAt: "2026-08-01T04:20:58.618Z",
      entries: entries.slice(0, 12),
    }));
    const body = await json(await GET(request("sort=newest&limit=9")));
    expect(body.catalog).toMatchObject({
      source: "envio-classic-v3",
      status: "last-known-good",
      lastIndexedAt: "2026-08-01T04:20:58.618Z",
      identityCount: 12,
    });
    expect(body.dataQuality).toMatchObject({
      status: "partial",
      generatedAt: "2026-08-01T04:20:58.618Z",
      launchIdentity: { custom: "unavailable" },
    });
  });

  it.each(["unknown=value", "page=0", "limit=abc", "q=a&q=b", "socials=maybe"])(
    "rejects unsupported query shape: %s",
    async (query) => {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(mocks.readCatalog).not.toHaveBeenCalled();
      expect(mocks.readDex).not.toHaveBeenCalled();
    },
  );

  it("contains no runtime dRPC or Bitquery dependency", () => {
    for (const relative of [
      "../app/api/explore/route.ts",
      "../app/api/explore/token/route.ts",
    ]) {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      expect(source).not.toMatch(/bitquery/iu);
      expect(source).not.toContain("readPrimaryRpcExploreEntriesV1");
      expect(source).toContain("readEnvioClassicV3CatalogV1");
      expect(source).toContain("readDexscreenerExploreEntriesV1");
    }
  });
});
