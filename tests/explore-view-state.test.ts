import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXPLORE_MOBILE_TOKENS_PER_PAGE,
  EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
  EXPLORE_TOKENS_PER_PAGE,
  createExploreInitialState,
  createResponsiveExploreInitialState,
  exploreAppliedSortLabel,
  exploreMarketStatusLabel,
  exploreUnavailableFdvLabel,
  exploreTokensPerPageForViewport,
  handledInitialExploreRequestKey,
  filterTokensByLaunchModel,
  filterTokensBySocialPresence,
  getTokenCards,
  getExplorePaginationItems,
  getExploreValuationMetric,
  loadExploreModelDataset,
  loadExplorePage,
  loadExplorePayload,
  paginateExploreModelDataset,
  paginateTokensByExploreFilters,
  paginateTokensByExploreSelections,
  paginateTokensBySocialPresence,
  preserveExplorePayloadOnRefreshFailure,
  resolveExploreServerSort,
  sortExploreEntriesBySelections,
  tokenHasSocialLinks,
  tokenLaunchModelGroup,
} from "../components/explore-view";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const classicProvenance = {
  schemaVersion: "programmable.explore-launch-category-provenance.v1",
  category: "classic",
  source: "canonical-launch-read-model",
  recordId: "fixture",
  modelId: null,
  modelVersion: null,
} as const;

const customProvenance = {
  schemaVersion: "programmable.explore-launch-category-provenance.v1",
  category: "custom",
  source: "interface-preview",
  projectId: `sha256:${"1".repeat(64)}`,
  launchId: `sha256:${"2".repeat(64)}`,
  sourceRecordBindingHash: `sha256:${"3".repeat(64)}`,
  finalizedLaunchBindingHash: `sha256:${"4".repeat(64)}`,
} as const;

function classicEntry(token: LauncherToken): ExploreEntry {
  return {
    ...token,
    exploreKind: "token",
    launchCategoryProvenance: {
      ...classicProvenance,
      recordId: token.id,
      modelId: token.launchModel ?? null,
      modelVersion: token.launchModelVersion ?? token.deepReleaseVersion ?? null,
    },
  };
}

function customEntry(index: number): ExploreEntry {
  const hash = `sha256:${index.toString(16).padStart(64, "0")}` as const;
  const wallet = {
    namespace: "eip155:1",
    value: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  } as const;
  return {
    exploreKind: "custom-project",
    id: `custom:${index}`,
    name: `Custom ${index}`,
    symbol: `C${index}`,
    links: [],
    launchedAt: "2026-08-03T00:00:00.000Z",
    finalizedAt: "2026-08-03T00:01:00.000Z",
    chainId: "1",
    modelId: "custom-contract-graph-v2",
    customProjectId: hash,
    customLaunchId: hash,
    launchingWallet: wallet,
    postLaunchAuthorityInventoryHash: hash,
    markets: [],
    postLaunchAuthorityInventory: {
      schemaVersion: "programmable.post-launch-authority-inventory.v1",
      launchingWallet: wallet,
      addressBindings: [],
      declaredIdentityBindings: [],
      postLaunchAuthorities: [],
      confirmation: {
        mode: "artifact-bound-launching-wallet-intent",
        confirmingIdentity: wallet,
        userVisibleDisclosureRequired: true,
      },
      postLaunchActionPolicy: "declared-onchain-authority-only",
      githubAuthority: "provenance-only-never-post-launch-authority",
      postLaunchAuthorityInventoryHash: hash,
    },
    launchCategoryProvenance: {
      ...customProvenance,
      projectId: hash,
      launchId: hash,
    },
  };
}

const catalogBoundary = {
  source: "envio-classic-v3" as const,
  launchSource: "envio-classic-v3+registry.custom-launched" as const,
  status: "current" as const,
  lastIndexedAt: "2026-08-14T00:00:00.000Z",
  asOfBlock: "25740000",
  asOfBlockHash: `0x${"ab".repeat(32)}` as `0x${string}`,
  identityCount: 351,
  identityCommitment: `sha256:${"cd".repeat(32)}` as `sha256:${string}`,
  completeness: {
    classic: "current" as const,
    stock: "excluded" as const,
    custom: "current" as const,
  },
  scope: {
    included: [
      "classic-v3",
      "official-main-token",
      "registry.custom-launched",
    ] as const,
    excluded: [
      "classic-v1",
      "classic-v2",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ] as const,
    publicCategories: ["classic", "custom"] as const,
  },
  evidence: {
    kind: "envio-indexer-state" as const,
    deployment: "production-92f6373",
    sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
    progressBlock: "25740000",
    progressOccurrenceId: `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:0`,
    commitment: `sha256:${"ef".repeat(32)}` as `sha256:${string}`,
  },
};

const payload = {
  status: "ready" as const,
  tokens: [],
  page: 1,
  pageSize: 9,
  total: 18,
  totalPages: 2,
  catalog: catalogBoundary,
};

const bitqueryMarketEntry = classicEntry({
  id: "1:bitquery-market",
  name: "Bitquery market",
  symbol: "BQM",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
  launchedAt: "2026-08-11T14:00:00.000Z",
  totalSwapFeeBps: 100,
  liquidityPath: "meme",
});

const unvaluedMarketPayload = {
  ...payload,
  tokens: [{
    ...bitqueryMarketEntry,
    valuation: { status: "unavailable", reason: "source-unavailable" },
  }],
  total: 1,
  totalPages: 1,
};

const valuedMarketPayload = {
  ...payload,
  tokens: [{
    ...bitqueryMarketEntry,
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      valueWad: "125000000000000000000",
      freshness: "current",
      source: "bitquery",
    },
  }],
  total: 1,
  totalPages: 1,
};

const wrongCurrencyMarketPayload = {
  ...valuedMarketPayload,
  tokens: valuedMarketPayload.tokens.map((token) => ({
    ...token,
    valuation: { ...token.valuation, currency: "eth" },
  })),
};

const unavailableMarketDataQuality = {
  schemaVersion: "programmable.explore-data-quality.v1",
  status: "partial",
  generatedAt: "2026-08-14T00:00:00.000Z",
  launchIdentity: {
    status: "current",
    canonical: "current",
    custom: "current",
    asOfBlock: "25740000",
    referenceBlock: "25740000",
    lagBlocks: "0",
    ageMs: 0,
  },
  valuation: {
    status: "unavailable",
    metric: "fdv",
    available: 0,
    unavailable: 1,
    stale: 0,
    unknown: 0,
    asOfBlock: null,
    asOfTime: null,
  },
} as const;

const transportUnavailableMarketPayload = {
  ...unvaluedMarketPayload,
  dataQuality: unavailableMarketDataQuality,
  marketRead: {
    provider: "bitquery",
    status: "unavailable",
    category: "transport",
    phase: "market-core",
  },
  ranking: {
    status: "unavailable",
    requested: "fdv",
    applied: "launch-order",
  },
} as const;

const responseUnavailableMarketPayload = {
  ...unvaluedMarketPayload,
  dataQuality: unavailableMarketDataQuality,
  marketRead: {
    provider: "bitquery",
    status: "unavailable",
    category: "response",
    phase: "market-core",
    reason: "http-status",
    httpStatus: 402,
  },
  ranking: {
    status: "unavailable",
    requested: "fdv",
    applied: "launch-order",
  },
} as const;

function modelCompatibilityMarketData() {
  return {
    schemaVersion: "programmable.market-data.v1" as const,
    source: "bitquery" as const,
    generatedAt: "2026-08-14T00:00:00.000Z",
    status: "current" as const,
    primaryPoolId: null,
    pools: [],
  };
}

function modelFilterEntry(
  index: number,
  valuation: "available" | "unavailable",
) {
  const entry = classicEntry({
    id: `1:model-filter-${index}`,
    name: `Model filter ${index}`,
    symbol: `MF${index}`,
    tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
    hookAddress: "0x2222222222222222222222222222222222222222",
    poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
    launchedAt: "2026-08-03T00:00:00.000Z",
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
  });
  return {
    ...entry,
    ...(valuation === "available"
      ? {
          fdvUsdWad: `${index + 1}000000000000000000`,
          marketData: modelCompatibilityMarketData(),
        }
      : {}),
    valuation: valuation === "available"
      ? {
          status: "available" as const,
          metric: "fdv" as const,
          supplyBasis: "total" as const,
          currency: "usd" as const,
          valueWad: `${index + 1}000000000000000000`,
          freshness: "current" as const,
          source: "bitquery" as const,
        }
      : {
          status: "unavailable" as const,
          reason: "source-unavailable" as const,
        },
  };
}

function modelPageDataQuality(available: number, unavailable: number) {
  const current = available > 0 && unavailable === 0;
  return {
    schemaVersion: "programmable.explore-data-quality.v1",
    status: current ? "complete" as const : "partial" as const,
    generatedAt: "2026-08-14T00:00:00.000Z",
    launchIdentity: {
      status: "current" as const,
      canonical: "current" as const,
      custom: "current" as const,
      asOfBlock: "25740000",
      referenceBlock: "25740000",
      lagBlocks: "0",
      ageMs: 0,
    },
    valuation: {
      status: current ? "current" as const : "unavailable" as const,
      metric: "fdv" as const,
      available,
      unavailable,
      stale: 0,
      unknown: 0,
      asOfBlock: null,
      asOfTime: null,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Explore refresh state", () => {
  it("hydrates the first server page without waiting for a client request", () => {
    expect(
      createExploreInitialState(
        {
          ok: true,
          body: payload,
        },
        {
          contentKey: "initial-content",
          requestKey: "initial-request",
          pageSize: EXPLORE_TOKENS_PER_PAGE,
        },
      ),
    ).toEqual({
      phase: "ready",
      payload,
      contentKey: "initial-content",
      requestKey: "initial-request",
    });
  });

  it("keeps a server-side Explore failure retryable without inventing data", () => {
    const initialState = createExploreInitialState(
        {
          ok: false,
          body: { error: "Launch index is catching up" },
        },
        {
          contentKey: "initial-content-error",
          requestKey: "initial-request-error",
          pageSize: EXPLORE_TOKENS_PER_PAGE,
        },
      );

    expect(initialState).toEqual({
      phase: "error",
      message: "Launch index is catching up",
      contentKey: "initial-content-error",
      requestKey: "initial-request-error",
    });
    expect(
      handledInitialExploreRequestKey(initialState, "initial-request-error"),
    ).toBeNull();
  });

  it("suppresses only the successful server response hydration request", () => {
    const initialState = createExploreInitialState(
      { ok: true, body: payload },
      {
        contentKey: "initial-content",
        requestKey: "initial-request",
        pageSize: EXPLORE_TOKENS_PER_PAGE,
      },
    );

    expect(
      handledInitialExploreRequestKey(initialState, "initial-request"),
    ).toBe("initial-request");
    expect(
      handledInitialExploreRequestKey(null, "initial-request"),
    ).toBeNull();
  });

  it("reuses the nine-token server page for the four-token mobile view", () => {
    const initialState = createResponsiveExploreInitialState(
      { ok: true, body: unvaluedMarketPayload },
      {
        reuseAvailable: true,
        isInitialRequest: true,
        contentKey: "initial-mobile-content",
        requestKey: "initial-mobile-request",
        pageSize: EXPLORE_MOBILE_TOKENS_PER_PAGE,
      },
    );

    expect(initialState?.phase).toBe("ready");
    if (initialState?.phase !== "ready") return;
    expect(initialState.payload.tokens).toHaveLength(1);
    expect(initialState.payload.tokens[0]).toMatchObject(
      unvaluedMarketPayload.tokens[0]!,
    );
    expect(initialState.payload.pageSize).toBe(EXPLORE_MOBILE_TOKENS_PER_PAGE);
    expect(initialState.payload.totalPages).toBe(1);
    expect(
      handledInitialExploreRequestKey(initialState, "initial-mobile-request"),
    ).toBe("initial-mobile-request");
  });

  it("stops reusing the server page after the first non-initial request", () => {
    const input = {
      contentKey: "initial-mobile-content",
      requestKey: "initial-mobile-request",
      pageSize: EXPLORE_MOBILE_TOKENS_PER_PAGE,
      isInitialRequest: true,
    } as const;

    expect(
      createResponsiveExploreInitialState(
        { ok: true, body: unvaluedMarketPayload },
        { ...input, reuseAvailable: false },
      ),
    ).toBeNull();
    expect(
      createResponsiveExploreInitialState(
        { ok: true, body: unvaluedMarketPayload },
        { ...input, reuseAvailable: true, isInitialRequest: false },
      ),
    ).toBeNull();
  });

  it("uses nine desktop cards and four mobile cards per page", () => {
    expect(EXPLORE_TOKENS_PER_PAGE).toBe(9);
    expect(EXPLORE_MOBILE_TOKENS_PER_PAGE).toBe(4);
    expect(exploreTokensPerPageForViewport(390)).toBe(4);
    expect(exploreTokensPerPageForViewport(700)).toBe(4);
    expect(exploreTokensPerPageForViewport(701)).toBe(9);
    expect(getExplorePaginationItems(1, 10)).toEqual([
      1,
      2,
      3,
      "end-gap",
      10,
    ]);
    expect(getExplorePaginationItems(5, 10)).toEqual([
      1,
      "start-gap",
      5,
      "end-gap",
      10,
    ]);
    expect(getExplorePaginationItems(10, 10)).toEqual([
      1,
      "start-gap",
      8,
      9,
      10,
    ]);
  });

  it("treats only X and Telegram as social links", () => {
    const websiteOnly = { links: [{ kind: "website", url: "https://example.com" }] } satisfies Pick<
      LauncherToken,
      "links"
    >;
    const withX = { links: [{ kind: "x", url: "https://x.com/example" }] } satisfies Pick<
      LauncherToken,
      "links"
    >;

    expect(tokenHasSocialLinks(websiteOnly)).toBe(false);
    expect(tokenHasSocialLinks(withX)).toBe(true);
  });

  it("filters the loaded token page without fabricating social data", () => {
    const baseToken = {
      id: "1:test",
      name: "Test",
      symbol: "TEST",
      tokenAddress: "0x1111111111111111111111111111111111111111",
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${"33".repeat(32)}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;
    const withSocials = {
      ...baseToken,
      id: "1:social",
      links: [{ kind: "telegram" as const, url: "https://t.me/example" }],
    };

    expect(
      filterTokensBySocialPresence(
        [classicEntry(baseToken), classicEntry(withSocials)],
        "yes",
      ).map(
        (token) => token.id,
      ),
    ).toEqual(["1:social"]);
    expect(
      filterTokensBySocialPresence(
        [classicEntry(baseToken), classicEntry(withSocials)],
        "no",
      ).map(
        (token) => token.id,
      ),
    ).toEqual(["1:test"]);
  });

  it("filters the complete result set before creating nine-token pages", () => {
    const tokens = Array.from({ length: 22 }, (_, index) => classicEntry({
      id: `1:${index}`,
      name: `Token ${index}`,
      symbol: `T${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      ...(index % 2 === 0
        ? {
            links: [
              { kind: "x" as const, url: `https://x.com/token${index}` },
            ],
          }
        : {}),
    } satisfies LauncherToken));

    expect(paginateTokensBySocialPresence(tokens, "yes", 1)).toMatchObject({
      page: 1,
      pageSize: 9,
      total: 11,
      totalPages: 2,
      tokens: expect.arrayContaining([
        expect.objectContaining({ id: "1:0" }),
        expect.objectContaining({ id: "1:16" }),
      ]),
    });
    expect(
      paginateTokensBySocialPresence(tokens, "yes", 2).tokens.map(
        (token) => token.id,
      ),
    ).toEqual(["1:18", "1:20"]);
    expect(paginateTokensBySocialPresence(tokens, "no", 1)).toMatchObject({
      total: 11,
      totalPages: 2,
      tokens: expect.arrayContaining([
        expect.objectContaining({ id: "1:1" }),
        expect.objectContaining({ id: "1:17" }),
      ]),
    });
  });

  it("groups only canonical provenance and never infers type from a model or address", () => {
    expect(tokenLaunchModelGroup({ launchCategoryProvenance: classicProvenance }))
      .toBe("classic");
    expect(tokenLaunchModelGroup({ launchCategoryProvenance: customProvenance }))
      .toBe("custom-hook");
    expect(tokenLaunchModelGroup({
      launchCategoryProvenance: {
        ...classicProvenance,
        modelId: "deep",
        recordId: "custom-looking-symbol-and-address",
      },
    })).toBe("classic");
  });

  it("labels a project-only Custom launch as No market without inventing a token", () => {
    const project = customEntry(1);
    expect(getTokenCards([project])).toEqual([
      expect.objectContaining({
        id: project.id,
        launchCategory: "Custom",
        marketStatus: "No market",
      }),
    ]);
    expect(getTokenCards([project])[0]).not.toHaveProperty("tokenAddress");
  });

  it("combines model and social filters before nine-token pagination", () => {
    const tokens = Array.from({ length: 25 }, (_, index) => index < 20
      ? classicEntry({
      id: `1:model-${index}`,
      name: `Model ${index}`,
      symbol: `M${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-08-03T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      launchModel: "classic",
      links: [{ kind: "x" as const, url: `https://x.com/model${index}` }],
    } satisfies LauncherToken)
      : customEntry(index));

    expect(filterTokensByLaunchModel(tokens, "classic")).toHaveLength(20);
    expect(filterTokensByLaunchModel(tokens, "custom-hook")).toHaveLength(5);
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "classic", 1),
    ).toMatchObject({ page: 1, pageSize: 9, total: 20, totalPages: 3 });
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "classic", 2).tokens,
    ).toHaveLength(9);
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "classic", 3).tokens,
    ).toHaveLength(2);
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "custom-hook", 1),
    ).toMatchObject({ total: 0, totalPages: 0, tokens: [] });
  });

  it("combines Hook Type, valuation and age ordering without clearing a selection", () => {
    const valued = (
      index: number,
      valueWad: string,
      launchedAt: string,
    ) => ({
      ...modelFilterEntry(index, "available"),
      launchedAt,
      valuation: {
        ...modelFilterEntry(index, "available").valuation,
        valueWad,
      },
    });
    const highOld = valued(1, "9000000000000000000", "2026-08-01T00:00:00.000Z");
    const highNew = valued(2, "9000000000000000000", "2026-08-04T00:00:00.000Z");
    const lowNewest = valued(3, "2000000000000000000", "2026-08-05T00:00:00.000Z");
    const unavailable = {
      ...modelFilterEntry(4, "unavailable"),
      launchedAt: "2026-08-06T00:00:00.000Z",
    };

    expect(resolveExploreServerSort("highest", "newest")).toBe("market-cap");
    expect(resolveExploreServerSort("none", "oldest")).toBe("oldest");
    expect(
      sortExploreEntriesBySelections(
        [lowNewest, highOld, unavailable, highNew],
        "highest",
        "newest",
      ).map((token) => token.id),
    ).toEqual([highNew.id, highOld.id, lowNewest.id, unavailable.id]);
    expect(
      paginateTokensByExploreSelections(
        [customEntry(99), lowNewest, highOld, unavailable, highNew],
        "all",
        "classic",
        "highest",
        "newest",
        1,
        2,
      ),
    ).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 4,
      totalPages: 2,
      tokens: [
        expect.objectContaining({ id: highNew.id }),
        expect.objectContaining({ id: highOld.id }),
      ],
    });
  });

  it("loads every server page before model filtering and preserves server order", async () => {
    const tokens = Array.from({ length: 230 }, (_, index) => index < 145
      ? classicEntry({
      id: `1:server-model-${index}`,
      name: `Server model ${index}`,
      symbol: `SM${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-08-03T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      launchModel: index < 145 ? ("classic" as const) : ("deep" as const),
      links: [
        { kind: "x" as const, url: `https://x.com/server-model-${index}` },
      ],
    } satisfies LauncherToken)
      : customEntry(index));
    const totalPages = Math.ceil(
      tokens.length / EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        const offset = (page - 1) * pageSize;

        expect(pageSize).toBe(EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE);
        expect(url.searchParams.get("q")).toBe("server");
        expect(url.searchParams.get("sort")).toBe("newest");
        expect(url.searchParams.get("socials")).toBe("yes");

        return new Response(
          JSON.stringify({
            status: "ready",
            tokens: tokens.slice(offset, offset + pageSize),
            page,
            pageSize,
            total: tokens.length,
            totalPages,
            catalog: { ...catalogBoundary, identityCount: tokens.length },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

    const dataset = await loadExploreModelDataset(
      "complete-model-dataset",
      new URLSearchParams({
        q: "server",
        sort: "newest",
        socials: "yes",
        page: "12",
        limit: "9",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(dataset.tokens.map((token) => token.id)).toEqual(
      tokens.map((token) => token.id),
    );
    expect(
      paginateTokensByExploreFilters(
        dataset.tokens,
        "all",
        "classic",
        12,
      ),
    ).toMatchObject({
      page: 12,
      pageSize: 9,
      total: 145,
      totalPages: 17,
      tokens: tokens
        .slice(99, 108)
        .map((token) => expect.objectContaining({ id: token.id })),
    });
  });

  it("rejects same-sized model pages from a different identity commitment", async () => {
    const tokens = Array.from(
      { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE + 1 },
      (_, index) => modelFilterEntry(index, "unavailable"),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "https://example.test");
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("limit"));
      return new Response(JSON.stringify({
        status: "ready",
        tokens: tokens.slice((page - 1) * pageSize, page * pageSize),
        page,
        pageSize,
        total: tokens.length,
        totalPages: 2,
        catalog: {
          ...catalogBoundary,
          identityCount: tokens.length,
          identityCommitment: page === 1
            ? catalogBoundary.identityCommitment
            : `sha256:${"11".repeat(32)}`,
        },
      }), { status: 200 });
    });

    await expect(loadExploreModelDataset(
      "commitment-drift-model-dataset",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).rejects.toThrow("Tokens changed while filters were loading");
  });

  it("accepts index progress advancing between pages when identity stays exact", async () => {
    const tokens = Array.from(
      { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE + 1 },
      (_, index) => modelFilterEntry(index, "unavailable"),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "https://example.test");
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("limit"));
      const asOfBlock = page === 1 ? "25740000" : "25740001";
      return new Response(JSON.stringify({
        status: "ready",
        tokens: tokens.slice((page - 1) * pageSize, page * pageSize),
        page,
        pageSize,
        total: tokens.length,
        totalPages: 2,
        catalog: {
          ...catalogBoundary,
          lastIndexedAt: page === 1
            ? "2026-08-14T00:00:00.000Z"
            : "2026-08-14T00:00:12.000Z",
          asOfBlock,
          asOfBlockHash: page === 1
            ? catalogBoundary.asOfBlockHash
            : `0x${"bc".repeat(32)}`,
          identityCount: tokens.length,
          evidence: {
            ...catalogBoundary.evidence,
            progressBlock: asOfBlock,
          },
        },
      }), { status: 200 });
    });

    await expect(loadExploreModelDataset(
      "progress-only-drift-model-dataset",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).resolves.toMatchObject({ total: tokens.length, totalPages: 2 });
  });

  it("preserves an all-page transport marker and does not cache the degraded model dataset", async () => {
    const tokens = [
      ...Array.from(
        { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE },
        (_, index) => modelFilterEntry(index, "available"),
      ),
      {
        ...customEntry(900),
        fdvUsdWad: "1000000000000000000",
        marketData: modelCompatibilityMarketData(),
        liquidityEvidence: { compatibility: true },
        valuation: {
          status: "available" as const,
          metric: "fdv" as const,
          supplyBasis: "total" as const,
          currency: "usd" as const,
          valueWad: "1000000000000000000",
          freshness: "current" as const,
          source: "bitquery" as const,
        },
      },
    ];
    const totalPages = 2;
    const degradedResponse = (
      input: string | URL | Request,
      phase: "market-core" | "market-price",
    ) => {
      const url = new URL(String(input), "https://example.test");
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("limit"));
      const pageTokens = tokens.slice((page - 1) * pageSize, page * pageSize)
        .map((entry) => ({
          ...entry,
          valuation: {
            status: "unavailable" as const,
            reason: "source-unavailable" as const,
          },
        }));
      return new Response(JSON.stringify({
        status: "ready",
        tokens: pageTokens,
        page,
        pageSize,
        total: tokens.length,
        totalPages,
        catalog: { ...catalogBoundary, identityCount: tokens.length },
        dataQuality: modelPageDataQuality(0, pageTokens.length),
        marketRead: {
          provider: "bitquery",
          status: "unavailable",
          category: "transport",
          phase,
        },
        ranking: {
          status: "unavailable",
          requested: "fdv",
          applied: "launch-order",
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "transport-unavailable",
        },
      });
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => degradedResponse(input, "market-core"),
    );
    const search = new URLSearchParams({
      sort: "market-cap",
      page: "1",
      limit: "9",
    });

    const dataset = await loadExploreModelDataset(
      "all-degraded-model-dataset",
      search,
    );
    const filtered = paginateExploreModelDataset(dataset, "classic", 1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dataset).toMatchObject({
      marketRead: { status: "unavailable", phase: "market-core" },
      ranking: { status: "unavailable", applied: "launch-order" },
      dataQuality: {
        status: "partial",
        valuation: {
          status: "unavailable",
          available: 0,
          unavailable: tokens.length,
        },
      },
    });
    expect(filtered).toMatchObject({
      marketRead: { status: "unavailable" },
      ranking: { status: "unavailable", applied: "launch-order" },
      dataQuality: {
        status: "partial",
        valuation: { status: "unavailable", available: 0, unavailable: 9 },
      },
    });
    expect(dataset.tokens.every((entry) =>
      entry.valuation.status === "unavailable" &&
      !("fdvUsdWad" in entry) &&
      !("marketData" in entry) &&
      !("liquidityEvidence" in entry)
    )).toBe(true);
    expect(dataset.tokens.at(-1)?.valuation).toEqual({
      status: "unavailable",
      reason: "no-market",
    });

    await loadExploreModelDataset("all-degraded-model-dataset", search);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    fetchMock.mockImplementation(async (input) => {
      const page = new URL(String(input), "https://example.test")
        .searchParams.get("page");
      return degradedResponse(
        input,
        page === "1" ? "market-core" : "market-price",
      );
    });
    await expect(loadExploreModelDataset(
      "inconsistent-degraded-model-dataset",
      search,
    )).rejects.toThrow("Tokens changed while filters were loading");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("rejects a mixed current and transport-unavailable model dataset", async () => {
    const tokens = Array.from(
      { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE + 1 },
      (_, index) => modelFilterEntry(index, "available"),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        const pageTokens = tokens.slice((page - 1) * pageSize, page * pageSize);
        const degraded = page === 2;
        const visibleTokens = degraded
          ? pageTokens.map((entry) => ({
              ...entry,
              valuation: {
                status: "unavailable" as const,
                reason: "source-unavailable" as const,
              },
            }))
          : pageTokens;
        return new Response(JSON.stringify({
          status: "ready",
          tokens: visibleTokens,
          page,
          pageSize,
          total: tokens.length,
          totalPages: 2,
          catalog: { ...catalogBoundary, identityCount: tokens.length },
          dataQuality: modelPageDataQuality(
            degraded ? 0 : visibleTokens.length,
            degraded ? visibleTokens.length : 0,
          ),
          ...(degraded
            ? {
                marketRead: {
                  provider: "bitquery",
                  status: "unavailable",
                  category: "transport",
                  phase: "market-price",
                },
                ranking: {
                  status: "unavailable",
                  requested: "fdv",
                  applied: "launch-order",
                },
              }
            : {}),
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Programmable-Market-Read-Status": degraded
              ? "transport-unavailable"
              : "current",
          },
        });
      },
    );

    await expect(loadExploreModelDataset(
      "mixed-model-dataset",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("Tokens changed while filters were loading");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["highest-market-cap", "lowest-market-cap"])(
    "requests a direct second %s page without continuation fields",
    async (sort) => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input) => {
          const url = new URL(String(input), "https://example.test");
          expect(url.searchParams.get("sort")).toBe(sort);
          expect(url.searchParams.get("page")).toBe("2");
          expect([...url.searchParams.keys()]).toEqual([
            "sort",
            "page",
            "limit",
          ]);
          return new Response(JSON.stringify({
            ...payload,
            page: 2,
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      );

      await expect(loadExplorePage(
        `direct-${sort}-page-two`,
        new URLSearchParams({ sort, page: "2", limit: "9" }),
      )).resolves.toMatchObject({ page: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("presents total-supply valuation using the public market cap label", () => {
    const token = {
      id: "1:test",
      name: "Test",
      symbol: "TEST",
      tokenAddress: "0x1111111111111111111111111111111111111111",
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${"33".repeat(32)}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      fdvUsdWad: "100000000000000000000",
      indexedMarketCapUsdWad: "125000000000000000000",
      totalSupplyRaw: "1000000000000000000000000000",
      tokenDecimals: 18,
      activeLiquidity: "1",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;

    const entry = {
      ...classicEntry(token),
      valuation: {
        status: "available" as const,
        metric: "fdv" as const,
        supplyBasis: "total" as const,
        currency: "usd" as const,
        valueWad: "125000000000000000000",
        freshness: "current" as const,
        asOfBlock: "25730000",
        lagBlocks: "0",
      },
    };

    expect(getExploreValuationMetric(entry)).toEqual({
      kind: "usd",
      value: 125,
    });
    expect(getTokenCards([entry])[0]?.valuationMetric).toBe("Market cap");
  });

  it("explains missing FDV without inventing a value", () => {
    expect(exploreUnavailableFdvLabel("Waiting for first trade")).toBe(
      "Waiting for first trade",
    );
    expect(exploreUnavailableFdvLabel("No market")).toBe("No market yet");
    expect(exploreUnavailableFdvLabel("Unavailable")).toBe(
      "",
    );
    expect(exploreUnavailableFdvLabel(undefined)).toBe("");
  });

  it("labels bounded offchain FDV as provider recent, never onchain current", () => {
    const entry = {
      ...bitqueryMarketEntry,
      valuation: {
        status: "available" as const,
        metric: "fdv" as const,
        supplyBasis: "total" as const,
        currency: "usd" as const,
        valueWad: "125000000000000000000",
        freshness: "provider-recent" as const,
        source: "dexscreener" as const,
        asOfTime: "2026-08-16T08:00:00.000Z",
      },
    };
    expect(getExploreValuationMetric(entry)).toEqual({ kind: "usd", value: 125 });
    expect(exploreMarketStatusLabel(entry)).toBe("Provider recent");
  });

  it("keeps the last valid page when a background refresh fails", () => {
    expect(
      preserveExplorePayloadOnRefreshFailure(
        {
          phase: "ready",
          payload,
          contentKey: "same-content",
          requestKey: "previous-request",
        },
        {
          contentKey: "same-content",
          requestKey: "refresh-request",
          message: "RPC unavailable",
        },
      ),
    ).toEqual({
      phase: "ready",
      payload,
      contentKey: "same-content",
      requestKey: "refresh-request",
    });
  });

  it("does not show stale cards for a different query or page", () => {
    expect(
      preserveExplorePayloadOnRefreshFailure(
        {
          phase: "ready",
          payload,
          contentKey: "old-query",
          requestKey: "old-request",
        },
        {
          contentKey: "new-query",
          requestKey: "new-request",
          message: "RPC unavailable",
        },
      ),
    ).toEqual({
      phase: "error",
      contentKey: "new-query",
      requestKey: "new-request",
      message: "RPC unavailable",
    });
  });

  it("shares one in-flight request for repeated refreshes of the same content", async () => {
    const marketPayload = payload;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(marketPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const search = new URLSearchParams({
      q: "",
      sort: "newest",
      page: "1",
      limit: "9",
    });

    const first = loadExplorePayload("same-content-dedupe", search);
    const second = loadExplorePayload("same-content-dedupe", search);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(marketPayload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["market-cap", "market-cap-asc"])(
    "retries a valid zero-valuation %s response and returns the valued retry",
    async (sort) => {
      const first = new Response(JSON.stringify(unvaluedMarketPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      const firstJson = vi.spyOn(first, "json");
      const fetchMock = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(new Response(
          JSON.stringify(valuedMarketPayload),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ));

      const result = await loadExplorePayload(
        `${sort}-zero-then-valued`,
        new URLSearchParams({ sort, page: "1", limit: "9" }),
      );

      expect(result.tokens[0]?.valuation).toMatchObject({
        status: "available",
        metric: "fdv",
        freshness: "current",
        source: "bitquery",
      });
      expect(firstJson).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
    },
  );

  it("returns a marked transport-unavailable page without retrying or caching it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(transportUnavailableMarketPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "transport-unavailable",
        },
      }),
    );
    const search = new URLSearchParams({
      sort: "market-cap",
      page: "1",
      limit: "9",
    });

    await expect(loadExplorePayload(
      "marked-market-transport-unavailable",
      search,
    )).resolves.toMatchObject({
      marketRead: {
        provider: "bitquery",
        status: "unavailable",
        category: "transport",
        phase: "market-core",
      },
      ranking: {
        status: "unavailable",
        requested: "fdv",
        applied: "launch-order",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(loadExplorePayload(
      "marked-market-transport-unavailable",
      search,
    )).resolves.toMatchObject({
      marketRead: { status: "unavailable" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an honest HTTP 402 response-unavailable page without retrying or caching it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(responseUnavailableMarketPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "response-unavailable",
        },
      }),
    );
    const search = new URLSearchParams({
      sort: "market-cap",
      page: "1",
      limit: "9",
    });

    const result = await loadExplorePayload(
      "marked-market-http-402-response-unavailable",
      search,
    );

    expect(result).toMatchObject({
      marketRead: {
        provider: "bitquery",
        status: "unavailable",
        category: "response",
        phase: "market-core",
        reason: "http-status",
        httpStatus: 402,
      },
      ranking: {
        status: "unavailable",
        requested: "fdv",
        applied: "launch-order",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getTokenCards(result.tokens)).toEqual([
      expect.objectContaining({
        valuation: undefined,
        marketStatus: "Unavailable",
      }),
    ]);

    await expect(loadExplorePayload(
      "marked-market-http-402-response-unavailable",
      search,
    )).resolves.toMatchObject({
      marketRead: {
        status: "unavailable",
        category: "response",
        reason: "http-status",
        httpStatus: 402,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an HTTP 402 marker without its exact response-unavailable header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(responseUnavailableMarketPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "transport-unavailable",
        },
      }),
    );

    await expect(loadExplorePayload(
      "mismatched-market-http-402-response-unavailable",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("inconsistent market read data");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries the first non-USD FDV and returns the second fail-closed", async () => {
    const secondPayload = { ...wrongCurrencyMarketPayload, total: 2 };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify(wrongCurrencyMarketPayload),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify(secondPayload),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ));

    await expect(loadExplorePayload(
      "market-cap-wrong-currency",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).resolves.toMatchObject({
      total: 2,
      tokens: [expect.objectContaining({
        valuation: expect.objectContaining({ currency: "eth" }),
      })],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the second valid zero-valuation response without a third attempt", async () => {
    const secondPayload = { ...unvaluedMarketPayload, total: 2 };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify(unvaluedMarketPayload),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify(secondPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    await expect(loadExplorePayload(
      "market-cap-zero-twice",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).resolves.toMatchObject({ total: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a valid zero-valuation response for Newest", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify(unvaluedMarketPayload),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify(valuedMarketPayload),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ));

    await expect(loadExplorePayload(
      "newest-zero-no-retry",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).resolves.toMatchObject({
      tokens: [expect.objectContaining({
        valuation: { status: "unavailable", reason: "source-unavailable" },
      })],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries the identical Explore request once after a 503", async () => {
    const first = new Response(JSON.stringify({
      status: "ready",
      tokens: [{ forged: "must-not-be-parsed" }],
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
    const firstJson = vi.spyOn(first, "json");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(new Response(JSON.stringify(unvaluedMarketPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const search = new URLSearchParams({
      q: "",
      sort: "market-cap",
      page: "1",
      limit: "9",
    });

    const request = loadExplorePayload("bitquery-one-retry", search);
    expect(loadExplorePayload("bitquery-one-retry", search)).toBe(request);
    await expect(request).resolves.toMatchObject({
      tokens: [expect.objectContaining({
        valuation: { status: "unavailable", reason: "source-unavailable" },
      })],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Accept: "application/json" },
    });
    expect(fetchMock.mock.calls[1]?.[1]?.signal).not.toBe(
      fetchMock.mock.calls[0]?.[1]?.signal,
    );
    expect(firstJson).not.toHaveBeenCalled();
  });

  it.each(["newest", "oldest", "market-cap", "market-cap-asc"])(
    "stops after one automatic 503 retry for the %s sort",
    async (sort) => {
      const first = new Response("not launch data", { status: 503 });
      const firstJson = vi.spyOn(first, "json");
      const fetchMock = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(new Response(JSON.stringify({
          status: "unavailable",
          error: "Launch data is temporarily unavailable",
          retryable: true,
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }));

      await expect(loadExplorePayload(
        `${sort}-one-retry-terminal`,
        new URLSearchParams({ sort, page: "1", limit: "9" }),
      )).rejects.toThrow("Launch data is temporarily unavailable");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
      expect(firstJson).not.toHaveBeenCalled();
    },
  );

  it("does not retry a non-503 response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid Explore request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(loadExplorePayload(
      "non-503-no-retry",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("Invalid Explore request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives a late 503 retry its own full twelve-second deadline", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => {
        calls += 1;
        if (calls === 1) {
          return await new Promise<Response>((resolve) => {
            globalThis.setTimeout(
              () => resolve(new Response("ignored", { status: 503 })),
              11_000,
            );
          });
        }
        return await new Promise<Response>((resolve) => {
          globalThis.setTimeout(() => resolve(new Response(
            JSON.stringify(payload),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          )), 6_000);
        });
      },
    );
    const request = loadExplorePayload(
      "late-503-fresh-attempt-deadline",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );

    await vi.advanceTimersByTimeAsync(11_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(request).resolves.toEqual(payload);
  });

  it("does not retry an aborted 503 request", async () => {
    let resolveOld: ((response: Response) => void) | undefined;
    let oldAttemptSignal: AbortSignal | undefined;
    const requests: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("page=1")) {
          oldAttemptSignal = init?.signal ?? undefined;
          return await new Promise<Response>((resolve) => {
            resolveOld = resolve;
          });
        }
        return new Response(JSON.stringify({
          ...valuedMarketPayload,
          page: 2,
          total: 18,
          totalPages: 2,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    const first = loadExplorePayload(
      "aborted-503-no-retry",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );
    await vi.waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    const current = loadExplorePayload(
      "aborted-503-no-retry",
      new URLSearchParams({ sort: "market-cap", page: "2", limit: "9" }),
    );
    resolveOld?.(new Response("ignored", { status: 503 }));

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(current).resolves.toMatchObject({ page: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requests.filter((url) => url.includes("page=1"))).toHaveLength(1);
    expect(oldAttemptSignal?.aborted).toBe(true);
  });

  it("never caches a successful response from an aborted stale request", async () => {
    let resolveOld: ((response: Response) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);
        if (url.includes("page=1")) {
          return await new Promise<Response>((resolve) => {
            resolveOld = resolve;
          });
        }
        return new Response(JSON.stringify({ ...payload, page: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    const first = loadExplorePayload(
      "aborted-success-no-stale-cache",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    );
    await vi.waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    const currentSearch = new URLSearchParams({
      sort: "newest",
      page: "2",
      limit: "9",
    });
    const current = loadExplorePayload(
      "aborted-success-no-stale-cache",
      currentSearch,
    );
    await expect(current).resolves.toMatchObject({ page: 2 });
    resolveOld?.(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(loadExplorePayload(
      "aborted-success-no-stale-cache",
      currentSearch,
    )).resolves.toMatchObject({ page: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache an empty-FDV response when its retry is aborted as stale", async () => {
    let resolveOldRetry: ((response: Response) => void) | undefined;
    let oldRetrySignal: AbortSignal | undefined;
    let pageOneCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = new URL(String(input), "https://example.test");
        if (url.searchParams.get("page") === "1") {
          pageOneCalls += 1;
          if (pageOneCalls === 1) {
            return new Response(JSON.stringify(unvaluedMarketPayload), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          oldRetrySignal = init?.signal ?? undefined;
          return await new Promise<Response>((resolve) => {
            resolveOldRetry = resolve;
          });
        }
        return new Response(JSON.stringify({
          ...valuedMarketPayload,
          page: 2,
          total: 18,
          totalPages: 2,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    const oldRequest = loadExplorePayload(
      "aborted-empty-fdv-no-stale-cache",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const currentSearch = new URLSearchParams({
      sort: "market-cap",
      page: "2",
      limit: "9",
    });
    const currentRequest = loadExplorePayload(
      "aborted-empty-fdv-no-stale-cache",
      currentSearch,
    );
    resolveOldRetry?.(new Response(JSON.stringify(valuedMarketPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(oldRequest).rejects.toMatchObject({ name: "AbortError" });
    await expect(currentRequest).resolves.toMatchObject({ page: 2 });
    await expect(loadExplorePayload(
      "aborted-empty-fdv-no-stale-cache",
      currentSearch,
    )).resolves.toMatchObject({ page: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(oldRetrySignal?.aborted).toBe(true);
  });

  it("rejects Router provenance on a custom project without a complete stamp", async () => {
    const project = customEntry(91);
    const forged = {
      ...project,
      launchCategoryProvenance: {
        schemaVersion: "programmable.explore-launch-category-provenance.v1",
        category: "custom",
        source: "canonical-launch-stamp-router",
        launchId: `0x${"11".repeat(32)}`,
        stampHash: `0x${"22".repeat(32)}`,
        routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
        transactionHash: `0x${"33".repeat(32)}`,
        blockHash: `0x${"44".repeat(32)}`,
        blockNumber: "25717612",
        transactionIndex: 1,
        logIndex: 2,
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...payload,
        tokens: [forged],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(loadExplorePayload(
      "forged-custom-project-router-source",
      new URLSearchParams(),
    )).rejects.toThrow("invalid token record");
  });

  it("parses a qualified Dexscreener market response without a browser retry", async () => {
    const dexPayload = {
      ...valuedMarketPayload,
      tokens: valuedMarketPayload.tokens.map((token) => ({
        ...token,
        valuation: {
          ...token.valuation,
          source: "dexscreener" as const,
          freshness: "provider-recent" as const,
          asOfTime: "2026-08-16T08:00:00.000Z",
        },
      })),
      dataQuality: {
        ...unavailableMarketDataQuality,
        valuation: {
          ...unavailableMarketDataQuality.valuation,
          status: "provider-recent" as const,
          available: 1,
          unavailable: 0,
          asOfTime: "2026-08-16T08:00:00.000Z",
        },
      },
      marketRead: {
        provider: "dexscreener",
        status: "complete",
        currency: "USD",
        requestedCount: 1,
        observedCount: 1,
        qualifiedCount: 1,
        unavailableCount: 0,
        oldestFetchedAt: "2026-08-16T08:00:00.000Z",
        newestFetchedAt: "2026-08-16T08:00:00.000Z",
      },
      ranking: {
        status: "complete",
        requested: "fdv",
        applied: "fdv",
        qualifiedCount: 1,
        totalCount: 1,
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(dexPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "complete",
        },
      }),
    );
    const result = await loadExplorePayload(
      "dexscreener-qualified",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.valuation).toMatchObject({
      status: "available",
      source: "dexscreener",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(exploreAppliedSortLabel("market-cap", result.ranking)).toBe(
      "Highest valuation",
    );
  });

  it("retains all 351 identities for a complete sparse 20-pair Dexscreener read", async () => {
    const allTokens = Array.from({ length: 351 }, (_, offset) => {
      const index = offset + 1;
      const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
      const entry = classicEntry({
        id: `1:${tokenAddress}`,
        name: `Sparse ${index}`,
        symbol: `S${index}`,
        tokenAddress,
        hookAddress: "0x2222222222222222222222222222222222222222",
        poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
        launchedAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") + index)
          .toISOString(),
        totalSwapFeeBps: 100,
        liquidityPath: "meme",
      });
      return {
        ...entry,
        valuation: offset < 18
          ? {
              status: "available" as const,
              metric: "fdv" as const,
              supplyBasis: "total" as const,
              currency: "usd" as const,
              valueWad: ((351n - BigInt(offset)) * 10n ** 18n).toString(),
              freshness: "provider-recent" as const,
              source: "dexscreener" as const,
              asOfTime: "2026-08-16T08:00:00.000Z",
            }
          : { status: "unavailable" as const, reason: "source-unavailable" as const },
      };
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = new URL(String(input), "http://localhost");
        const page = Number(url.searchParams.get("page") ?? "1");
        const pageSize = Number(url.searchParams.get("limit") ?? "100");
        const tokens = allTokens.slice((page - 1) * pageSize, page * pageSize);
        const available = tokens.filter((token) =>
          token.valuation.status === "available"
        ).length;
        return new Response(JSON.stringify({
          status: "ready",
          tokens,
          page,
          pageSize,
          total: 351,
          totalPages: Math.ceil(351 / pageSize),
          catalog: {
            ...catalogBoundary,
            identityCount: 351,
          },
          dataQuality: {
            ...unavailableMarketDataQuality,
            valuation: {
              ...unavailableMarketDataQuality.valuation,
              status: available > 0 ? "partial" : "unavailable",
              available,
              unavailable: tokens.length - available,
            },
          },
          marketRead: {
            provider: "dexscreener",
            status: "complete",
            currency: "USD",
            requestedCount: 351,
            observedCount: 20,
            qualifiedCount: 18,
            unavailableCount: 333,
            oldestFetchedAt: "2026-08-16T08:00:00.000Z",
            newestFetchedAt: "2026-08-16T08:00:00.000Z",
          },
          ranking: {
            status: "partial",
            requested: "fdv",
            applied: "qualified-fdv-then-launch-order",
            qualifiedCount: 18,
            totalCount: 351,
          },
        }), {
          status: 200,
          headers: { "X-Programmable-Market-Read-Status": "complete" },
        });
      },
    );

    const result = await loadExploreModelDataset(
      "dexscreener-sparse-351",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );

    expect(result.tokens).toHaveLength(351);
    expect(new Set(result.tokens.map((token) => token.id)).size).toBe(351);
    expect(result.tokens.filter((token) => token.valuation.status === "available"))
      .toHaveLength(18);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(["complete", "partial"] as const)(
    "accepts a %s Dexscreener transport read with zero observed pairs",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({
          ...unvaluedMarketPayload,
          dataQuality: unavailableMarketDataQuality,
          marketRead: {
            provider: "dexscreener",
            status,
            currency: "USD",
            requestedCount: 1,
            observedCount: 0,
            qualifiedCount: 0,
            unavailableCount: 1,
            oldestFetchedAt: null,
            newestFetchedAt: null,
          },
        }), {
          status: 200,
          headers: { "X-Programmable-Market-Read-Status": status },
        }),
      );
      await expect(loadExplorePayload(
        `dexscreener-zero-observed-${status}`,
        new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
      )).resolves.toMatchObject({
        tokens: [expect.objectContaining({ id: bitqueryMarketEntry.id })],
        marketRead: { provider: "dexscreener", status, observedCount: 0 },
      });
    },
  );

  it("rejects an unavailable Dexscreener marker that still claims an observed pair", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...unvaluedMarketPayload,
        dataQuality: unavailableMarketDataQuality,
        marketRead: {
          provider: "dexscreener",
          status: "unavailable",
          currency: "USD",
          requestedCount: 1,
          observedCount: 1,
          qualifiedCount: 0,
          unavailableCount: 1,
          oldestFetchedAt: "2026-08-16T08:00:00.000Z",
          newestFetchedAt: "2026-08-16T08:00:00.000Z",
        },
      }), {
        status: 200,
        headers: { "X-Programmable-Market-Read-Status": "unavailable" },
      }),
    );
    await expect(loadExplorePayload(
      "dexscreener-unavailable-observed",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).rejects.toThrow("invalid market read data");
  });

  it("shows launch order when Dexscreener has zero qualified values", async () => {
    const dexPayload = {
      ...unvaluedMarketPayload,
      dataQuality: unavailableMarketDataQuality,
      marketRead: {
        provider: "dexscreener",
        status: "unavailable",
        currency: "USD",
        requestedCount: 1,
        observedCount: 0,
        qualifiedCount: 0,
        unavailableCount: 1,
        oldestFetchedAt: null,
        newestFetchedAt: null,
      },
      ranking: {
        status: "unavailable",
        requested: "fdv",
        applied: "launch-order",
        qualifiedCount: 0,
        totalCount: 1,
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(dexPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "unavailable",
        },
      }),
    );
    const result = await loadExplorePayload(
      "dexscreener-unavailable",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );
    expect(result.tokens.map((token) => token.id)).toEqual([
      bitqueryMarketEntry.id,
    ]);
    expect(exploreAppliedSortLabel("market-cap", result.ranking)).toBe(
      "Launch order",
    );
  });

  it("labels partial FDV ordering without claiming the whole list", () => {
    expect(exploreAppliedSortLabel("market-cap-asc", {
      status: "partial",
      requested: "fdv",
      applied: "qualified-fdv-then-launch-order",
      qualifiedCount: 1,
      totalCount: 2,
    })).toBe("Available valuation");
  });

  it("rejects malformed Dexscreener counts fail closed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...unvaluedMarketPayload,
        dataQuality: unavailableMarketDataQuality,
        marketRead: {
          provider: "dexscreener",
          status: "complete",
          currency: "USD",
          requestedCount: 1,
          observedCount: 2,
          qualifiedCount: 2,
          unavailableCount: -1,
          oldestFetchedAt: "2026-08-16T08:00:00.000Z",
          newestFetchedAt: "2026-08-16T08:00:00.000Z",
        },
      }), { status: 200 }),
    );
    await expect(loadExplorePayload(
      "dexscreener-malformed-counts",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).rejects.toThrow("invalid market read data");
  });

  it("stops a stalled Explore request after twelve seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const request = loadExplorePayload(
      "stalled-content-timeout",
      new URLSearchParams({
        q: "",
        sort: "market-cap",
        page: "1",
        limit: "9",
      }),
    );
    const rejection = expect(request).rejects.toThrow(
      "Tokens took too long to respond",
    );

    await vi.advanceTimersByTimeAsync(12_000);
    await rejection;
  });
});
