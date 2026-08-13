import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
  EXPLORE_TOKENS_PER_PAGE,
  EXPLORE_REFRESH_INTERVAL_MS,
  createExploreInitialState,
  handledInitialExploreRequestKey,
  filterTokensByLaunchModel,
  filterTokensBySocialPresence,
  getTokenCards,
  getExplorePaginationItems,
  getExploreValuationMetric,
  loadExploreModelDataset,
  loadExplorePageWithValuationSnapshot,
  loadExplorePayload,
  paginateTokensByExploreFilters,
  paginateTokensBySocialPresence,
  preserveExplorePayloadOnRefreshFailure,
  shouldRefreshExplore,
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

const payload = {
  status: "ready" as const,
  tokens: [],
  page: 1,
  pageSize: 9,
  total: 18,
  totalPages: 2,
};

function valuationSnapshot(
  overrides: Partial<{
    blockNumber: string;
    blockHash: `0x${string}`;
    liquidityBlockNumber: string;
    liquidityBlockHash: `0x${string}` | "none";
    rankingCommitment: `sha256:${string}`;
    sort: "market-cap" | "market-cap-asc";
    query: string;
    socials: "yes" | "no" | null;
    pageSize: number;
  }> = {},
) {
  return {
    schemaVersion: "programmable.explore-valuation-snapshot.v1" as const,
    chainId: 1 as const,
    blockNumber: "25740001",
    blockHash: `0x${"11".repeat(32)}` as `0x${string}`,
    liquidityBlockNumber: "25739999",
    liquidityBlockHash: `0x${"22".repeat(32)}` as `0x${string}`,
    rankingCommitment: `sha256:${"33".repeat(32)}` as `sha256:${string}`,
    sort: "market-cap" as const,
    query: "",
    socials: null,
    pageSize: EXPLORE_TOKENS_PER_PAGE,
    ...overrides,
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
      { contentKey: "initial-content", requestKey: "initial-request" },
    );

    expect(
      handledInitialExploreRequestKey(initialState, "initial-request"),
    ).toBe("initial-request");
    expect(
      handledInitialExploreRequestKey(null, "initial-request"),
    ).toBeNull();
  });

  it("uses a balanced nine-card page and compact desktop pagination", () => {
    expect(EXPLORE_TOKENS_PER_PAGE).toBe(9);
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

  it("never sends an unbound market-cap continuation request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(loadExplorePayload(
      "unbound-visible-market-page",
      new URLSearchParams({
        q: "",
        sort: "market-cap",
        page: "2",
        limit: "9",
      }),
    )).rejects.toThrow("complete valuation snapshot");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records page one and carries all five bindings through visible pagination", async () => {
    const snapshot = valuationSnapshot({
      sort: "market-cap-asc",
      query: "ranked",
      socials: "no",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        if (page === 1) {
          for (const parameter of [
            "valuationBlock",
            "valuationBlockHash",
            "liquidityBlock",
            "liquidityBlockHash",
            "rankingCommitment",
          ]) {
            expect(url.searchParams.has(parameter)).toBe(false);
          }
        } else {
          expect(page).toBe(12);
          expect(url.searchParams.get("valuationBlock")).toBe(
            snapshot.blockNumber,
          );
          expect(url.searchParams.get("valuationBlockHash")).toBe(
            snapshot.blockHash,
          );
          expect(url.searchParams.get("liquidityBlock")).toBe(
            snapshot.liquidityBlockNumber,
          );
          expect(url.searchParams.get("liquidityBlockHash")).toBe(
            snapshot.liquidityBlockHash,
          );
          expect(url.searchParams.get("rankingCommitment")).toBe(
            snapshot.rankingCommitment,
          );
        }
        return new Response(JSON.stringify({
          ...payload,
          page,
          total: 108,
          totalPages: 12,
          valuationSnapshot: snapshot,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
    const firstSearch = new URLSearchParams({
      q: "ranked",
      sort: "market-cap-asc",
      socials: "no",
      page: "1",
      limit: "9",
    });
    const first = await loadExplorePageWithValuationSnapshot(
      "visible-ranked-page-one",
      firstSearch,
    );
    const secondSearch = new URLSearchParams(firstSearch);
    secondSearch.set("page", "12");
    const twelfth = await loadExplorePageWithValuationSnapshot(
      "visible-ranked-page-twelve",
      secondSearch,
      first.valuationSnapshot,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(twelfth.payload.page).toBe(12);
    expect(twelfth.valuationSnapshot).toEqual(snapshot);
  });

  it("carries the exact paired none liquidity sentinel for zero-candidate rankings", async () => {
    const snapshot = valuationSnapshot({
      liquidityBlockNumber: "none",
      liquidityBlockHash: "none",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input), "https://example.test");
        expect(url.searchParams.get("liquidityBlock")).toBe("none");
        expect(url.searchParams.get("liquidityBlockHash")).toBe("none");
        return new Response(JSON.stringify({
          ...payload,
          page: 2,
          valuationSnapshot: snapshot,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

    const loaded = await loadExplorePageWithValuationSnapshot(
      "zero-candidate-visible-page-two",
      new URLSearchParams({
        sort: "market-cap",
        page: "2",
        limit: "9",
      }),
      snapshot,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loaded.valuationSnapshot).toEqual(snapshot);
  });

  it("canonicalizes market-cap aliases and the API page-size ceiling", async () => {
    const snapshot = valuationSnapshot({ pageSize: 100 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...payload,
        pageSize: 100,
        totalPages: 1,
        valuationSnapshot: snapshot,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(loadExplorePayload(
      "aliased-market-cap-clamped-page-size",
      new URLSearchParams({
        sort: "highest-market-cap",
        page: "1",
        limit: "999",
      }),
    )).resolves.toMatchObject({
      pageSize: 100,
      valuationSnapshot: snapshot,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("canonicalizes a deep market-cap continuation from its page-one snapshot", async () => {
    const snapshot = valuationSnapshot({
      query: "focused",
      socials: "yes",
      pageSize: 100,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        if (page === 1) {
          expect(url.searchParams.get("sort")).toBe("highest-market-cap");
          expect(url.searchParams.get("q")).toBe("  focused  ");
          expect(url.searchParams.get("limit")).toBe("999");
        } else {
          expect(url.searchParams.get("sort")).toBe("market-cap");
          expect(url.searchParams.get("q")).toBe("focused");
          expect(url.searchParams.get("socials")).toBe("yes");
          expect(url.searchParams.get("limit")).toBe("100");
          expect(url.searchParams.get("rankingCommitment")).toBe(
            snapshot.rankingCommitment,
          );
        }
        return new Response(JSON.stringify({
          ...payload,
          page,
          pageSize: 100,
          total: 200,
          totalPages: 2,
          valuationSnapshot: snapshot,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

    const loaded = await loadExplorePageWithValuationSnapshot(
      "deep-canonical-continuation",
      new URLSearchParams({
        sort: "highest-market-cap",
        q: "  focused  ",
        socials: "yes",
        page: "2",
        limit: "999",
      }),
    );

    expect(loaded.payload.page).toBe(2);
    expect(loaded.valuationSnapshot).toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bootstraps a fresh page-one snapshot after refresh or filter drift", async () => {
    const oldSnapshot = valuationSnapshot({
      query: "old",
      rankingCommitment: `sha256:${"44".repeat(32)}`,
    });
    const refreshedSnapshot = valuationSnapshot({
      query: "fresh",
      socials: "yes",
      rankingCommitment: `sha256:${"55".repeat(32)}`,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        if (page === 1) {
          expect(url.searchParams.has("rankingCommitment")).toBe(false);
        } else {
          expect(url.searchParams.get("rankingCommitment")).toBe(
            refreshedSnapshot.rankingCommitment,
          );
          expect(url.searchParams.get("rankingCommitment")).not.toBe(
            oldSnapshot.rankingCommitment,
          );
        }
        return new Response(JSON.stringify({
          ...payload,
          page,
          total: 18,
          totalPages: 2,
          valuationSnapshot: refreshedSnapshot,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

    const loaded = await loadExplorePageWithValuationSnapshot(
      "visible-refresh-filter-drift",
      new URLSearchParams({
        q: "fresh",
        sort: "market-cap",
        socials: "yes",
        page: "2",
        limit: "9",
      }),
      oldSnapshot,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loaded.valuationSnapshot).toEqual(refreshedSnapshot);
  });

  it("binds every market-cap model page across more than one hundred results", async () => {
    const tokens = Array.from({ length: 230 }, (_, index) => classicEntry({
      id: `1:ranked-${index}`,
      name: `Ranked ${index}`,
      symbol: `R${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-08-03T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
    } satisfies LauncherToken));
    const snapshot = valuationSnapshot({
      query: "ranked",
      pageSize: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
    });
    const totalPages = Math.ceil(
      tokens.length / EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        const offset = (page - 1) * EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE;
        if (page === 1) {
          expect(url.searchParams.has("valuationBlock")).toBe(false);
          expect(url.searchParams.has("liquidityBlock")).toBe(false);
        } else {
          expect(url.searchParams.get("valuationBlock")).toBe(
            snapshot.blockNumber,
          );
          expect(url.searchParams.get("valuationBlockHash")).toBe(
            snapshot.blockHash,
          );
          expect(url.searchParams.get("liquidityBlock")).toBe(
            snapshot.liquidityBlockNumber,
          );
          expect(url.searchParams.get("liquidityBlockHash")).toBe(
            snapshot.liquidityBlockHash,
          );
          expect(url.searchParams.get("rankingCommitment")).toBe(
            snapshot.rankingCommitment,
          );
        }
        return new Response(JSON.stringify({
          status: "ready",
          tokens: tokens.slice(
            offset,
            offset + EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
          ),
          page,
          pageSize: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
          total: tokens.length,
          totalPages,
          valuationSnapshot: snapshot,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

    const dataset = await loadExploreModelDataset(
      "complete-ranked-model-dataset",
      new URLSearchParams({
        q: "ranked",
        sort: "market-cap",
        page: "17",
        limit: "9",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(dataset.tokens.map((token) => token.id)).toEqual(
      tokens.map((token) => token.id),
    );
    expect(dataset.valuationSnapshot).toEqual(snapshot);
  });

  it("rejects duplicate identities after traversing a multi-page model dataset", async () => {
    const tokens = Array.from({ length: 101 }, (_, index) => customEntry(index));
    const snapshot = valuationSnapshot({
      pageSize: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "https://example.test");
      const page = Number(url.searchParams.get("page"));
      return new Response(JSON.stringify({
        status: "ready",
        tokens: page === 1 ? tokens.slice(0, 100) : [tokens[0]],
        page,
        pageSize: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
        total: tokens.length,
        totalPages: 2,
        valuationSnapshot: snapshot,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(loadExploreModelDataset(
      "duplicate-ranked-model-dataset",
      new URLSearchParams({
        sort: "market-cap",
        page: "1",
        limit: "9",
      }),
    )).rejects.toThrow("repeated an entry");
  });

  it("scopes resolved page caches to all five continuation fields", async () => {
    const firstSnapshot = valuationSnapshot();
    const secondSnapshot = valuationSnapshot({
      blockNumber: "25740002",
      blockHash: `0x${"44".repeat(32)}`,
      liquidityBlockNumber: "25740000",
      liquidityBlockHash: `0x${"55".repeat(32)}`,
      rankingCommitment: `sha256:${"66".repeat(32)}`,
    });
    const responses = [firstSnapshot, secondSnapshot];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        const snapshot = responses.shift();
        return new Response(JSON.stringify({
          ...payload,
          page: 2,
          valuationSnapshot: snapshot,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
    const continuationSearch = (
      snapshot: ReturnType<typeof valuationSnapshot>,
    ) => new URLSearchParams({
      sort: "market-cap",
      page: "2",
      limit: "9",
      valuationBlock: snapshot.blockNumber,
      valuationBlockHash: snapshot.blockHash,
      liquidityBlock: snapshot.liquidityBlockNumber,
      liquidityBlockHash: snapshot.liquidityBlockHash,
      rankingCommitment: snapshot.rankingCommitment,
    });

    await loadExplorePayload(
      "same-content-different-continuation",
      continuationSearch(firstSnapshot),
    );
    await loadExplorePayload(
      "same-content-different-continuation",
      continuationSearch(secondSnapshot),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed, drifting, and non-market valuation snapshots", async () => {
    const malformed = valuationSnapshot() as Record<string, unknown>;
    delete malformed.liquidityBlockHash;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        ...payload,
        valuationSnapshot: malformed,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(loadExplorePayload(
      "malformed-market-snapshot",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("invalid valuation snapshot");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        ...payload,
        valuationSnapshot: {
          ...valuationSnapshot(),
          extra: "not-canonical",
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(loadExplorePayload(
      "extra-field-market-snapshot",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("invalid valuation snapshot");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        ...payload,
        valuationSnapshot: valuationSnapshot({
          liquidityBlockNumber: "none",
        }),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(loadExplorePayload(
      "mixed-none-market-snapshot",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("invalid valuation snapshot");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        ...payload,
        valuationSnapshot: valuationSnapshot(),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(loadExplorePayload(
      "snapshot-on-newest-sort",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).rejects.toThrow("unexpected valuation snapshot");

    const requestedSnapshot = valuationSnapshot();
    const changedSnapshot = valuationSnapshot({
      rankingCommitment: `sha256:${"99".repeat(32)}`,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        ...payload,
        page: 2,
        valuationSnapshot: changedSnapshot,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(loadExplorePayload(
      "drifting-market-snapshot",
      new URLSearchParams({
        sort: "market-cap",
        page: "2",
        limit: "9",
        valuationBlock: requestedSnapshot.blockNumber,
        valuationBlockHash: requestedSnapshot.blockHash,
        liquidityBlock: requestedSnapshot.liquidityBlockNumber,
        liquidityBlockHash: requestedSnapshot.liquidityBlockHash,
        rankingCommitment: requestedSnapshot.rankingCommitment,
      }),
    )).rejects.toThrow("changed the valuation snapshot");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        ...payload,
        page: 3,
        total: 27,
        totalPages: 3,
        valuationSnapshot: requestedSnapshot,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(loadExplorePayload(
      "clamped-market-page",
      new URLSearchParams({
        sort: "market-cap",
        page: "2",
        limit: "9",
        valuationBlock: requestedSnapshot.blockNumber,
        valuationBlockHash: requestedSnapshot.blockHash,
        liquidityBlock: requestedSnapshot.liquidityBlockNumber,
        liquidityBlockHash: requestedSnapshot.liquidityBlockHash,
        rankingCommitment: requestedSnapshot.rankingCommitment,
      }),
    )).rejects.toThrow("inconsistent valuation snapshot");
  });

  it.each([
    ["page", { page: undefined }],
    ["pageSize", { pageSize: undefined }],
    ["total", { total: undefined }],
    ["totalPages", { totalPages: undefined }],
  ])("rejects a market-cap response missing raw %s", async (field, mutation) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        ...payload,
        ...mutation,
        valuationSnapshot: valuationSnapshot(),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(loadExplorePayload(
      `missing-market-${field}`,
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("invalid pagination data");
  });

  it.each([
    ["valuation block", { blockNumber: "1".repeat(79) }],
    ["liquidity block", { liquidityBlockNumber: "2147483648" }],
  ])("rejects an oversized response %s", async (field, snapshotMutation) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        ...payload,
        valuationSnapshot: valuationSnapshot(snapshotMutation),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(loadExplorePayload(
      `oversized-market-${field}`,
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("invalid valuation snapshot");
  });

  it.each([
    ["valuation block", { valuationBlock: "1".repeat(79) }],
    ["liquidity block", { liquidityBlock: "2147483648" }],
  ])("rejects an oversized continuation %s before fetch", async (
    _field,
    continuationMutation,
  ) => {
    const requestedSnapshot = valuationSnapshot();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const search = new URLSearchParams({
      sort: "market-cap",
      page: "2",
      limit: "9",
      valuationBlock: requestedSnapshot.blockNumber,
      valuationBlockHash: requestedSnapshot.blockHash,
      liquidityBlock: requestedSnapshot.liquidityBlockNumber,
      liquidityBlockHash: requestedSnapshot.liquidityBlockHash,
      rankingCommitment: requestedSnapshot.rankingCommitment,
    });
    for (const [key, value] of Object.entries(continuationMutation)) {
      if (value !== undefined) search.set(key, value);
    }

    await expect(loadExplorePayload(
      `oversized-market-continuation-${_field}`,
      search,
    )).rejects.toThrow("continuation is malformed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes only visible Explore content after the freshness interval", () => {
    expect(EXPLORE_REFRESH_INTERVAL_MS).toBe(5_000);
    expect(
      shouldRefreshExplore({
        visibilityState: "hidden",
        lastRefreshAt: 0,
        now: 20_000,
      }),
    ).toBe(false);
    expect(
      shouldRefreshExplore({
        visibilityState: "visible",
        lastRefreshAt: 5_000,
        now: 9_999,
      }),
    ).toBe(false);
    expect(
      shouldRefreshExplore({
        visibilityState: "visible",
        lastRefreshAt: 5_000,
        now: 10_000,
      }),
    ).toBe(true);
  });

  it("exposes total-supply valuation as FDV without calling it market cap", () => {
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

    expect(getExploreValuationMetric({
      ...classicEntry(token),
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        currency: "usd",
        valueWad: "125000000000000000000",
        freshness: "current",
        asOfBlock: "25730000",
        lagBlocks: "0",
      },
    })).toEqual({
      kind: "usd",
      value: 125,
    });
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
      refreshError: "RPC unavailable",
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
    const marketPayload = {
      ...payload,
      valuationSnapshot: valuationSnapshot(),
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(marketPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const search = new URLSearchParams({
      q: "",
      sort: "market-cap",
      page: "1",
      limit: "9",
    });

    const first = loadExplorePayload("same-content-dedupe", search);
    const second = loadExplorePayload("same-content-dedupe", search);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(marketPayload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
