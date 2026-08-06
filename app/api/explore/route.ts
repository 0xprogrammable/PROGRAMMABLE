import { NextRequest, NextResponse } from "next/server";

import {
  enrichTokensWithAlchemyPrices,
  getAlchemyOnchainDeployment,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../lib/alchemy/explore.server";
import { enrichTokensWithAlchemyPoolState } from "../../../lib/alchemy/live-market.server";
import { canonicalTokenExploreEntryV1 } from "../../../lib/explore-entry-v1";
import {
  filterAndSortTokens,
  parseExploreSort,
  visibleExploreTokens,
} from "../../../lib/onchain/query";
import type {
  ExploreReadModel,
  ExploreSnapshot,
  ExploreSort,
} from "../../../lib/onchain/types";
import { readProductionCustomExploreDirectoryV1 } from "../../../lib/server/custom-launch/explore-directory-v1";
import type {
  CanonicalTokenExploreEntry,
  ExploreEntry,
  LauncherToken,
} from "../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPLORE_QUERY_PARAMETERS = new Set([
  "limit",
  "page",
  "q",
  "socials",
  "sort",
]);
const TOP_MARKET_CAP_LIMIT = 20;
const NEWEST_LIVE_MARKET_LIMIT = 20;

export function inheritExploreEthUsdQuote(
  liveSnapshot: ExploreSnapshot,
  referenceSnapshot: ExploreSnapshot,
): ExploreSnapshot {
  if (liveSnapshot.ethUsdQuote || !referenceSnapshot.ethUsdQuote) {
    return liveSnapshot;
  }
  return {
    ...liveSnapshot,
    ethUsdQuote: referenceSnapshot.ethUsdQuote,
  };
}

function mergeTokenUpdates(
  tokens: readonly LauncherToken[],
  updates: readonly LauncherToken[],
) {
  const byAddress = new Map(
    updates.map((token) => [token.tokenAddress.toLowerCase(), token]),
  );
  return tokens.map(
    (token) => byAddress.get(token.tokenAddress.toLowerCase()) ?? token,
  );
}

function hasCanonicalQueryShape(search: URLSearchParams) {
  const seen = new Set<string>();
  for (const [key] of search) {
    if (!EXPLORE_QUERY_PARAMETERS.has(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

function integerQuery(value: string | null, fallback: number) {
  if (!value || !/^\d+$/u.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function positiveInteger(value: number, fallback: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.min(value, maximum);
}

function entryMarketCap(entry: ExploreEntry): bigint | null {
  if (entry.exploreKind !== "token") return null;
  const value = entry.indexedMarketCapUsdWad ?? entry.fdvUsdWad
    ?? entry.indexedMarketCapEthWei ?? entry.marketCapEthWei;
  return value && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
}

function entryLaunchTime(entry: ExploreEntry): number {
  const value = Date.parse(entry.launchedAt);
  return Number.isFinite(value) ? value : 0;
}

function compareNewestEntries(first: ExploreEntry, second: ExploreEntry): number {
  const time = entryLaunchTime(second) - entryLaunchTime(first);
  return time === 0 ? first.id.localeCompare(second.id) : time;
}

function sortExploreEntries(
  entries: readonly ExploreEntry[],
  sort: ExploreSort,
): ExploreEntry[] {
  return [...entries].sort((first, second) => {
    if (sort === "newest" || sort === "oldest") {
      const comparison = compareNewestEntries(first, second);
      return sort === "newest" ? comparison : -comparison;
    }
    const firstCap = entryMarketCap(first);
    const secondCap = entryMarketCap(second);
    if (firstCap === null || secondCap === null) {
      if (firstCap === null && secondCap !== null) return 1;
      if (firstCap !== null && secondCap === null) return -1;
      return compareNewestEntries(first, second);
    }
    if (firstCap !== secondCap) {
      if (sort === "market-cap") return firstCap > secondCap ? -1 : 1;
      return firstCap < secondCap ? -1 : 1;
    }
    return compareNewestEntries(first, second);
  });
}

function filterExploreEntries(
  entries: readonly ExploreEntry[],
  query: string,
  socials: "yes" | "no" | null,
): ExploreEntry[] {
  const normalized = query.trim().toLowerCase().replace(/^\$/u, "");
  return entries.filter((entry) => {
    const hasSocials = entry.links?.some(
      (link) => link.kind === "x" || link.kind === "telegram",
    ) ?? false;
    if (socials !== null && hasSocials !== (socials === "yes")) return false;
    if (!normalized) return true;
    return entry.name.toLowerCase().includes(normalized)
      || (entry.symbol?.toLowerCase().includes(normalized) ?? false)
      || (entry.tokenAddress?.toLowerCase().includes(normalized) ?? false)
      || (entry.exploreKind === "custom-project"
        && entry.modelId.toLowerCase().includes(normalized));
  });
}

function assertNoExploreCategoryCollision(entries: readonly ExploreEntry[]): void {
  const classicAddresses = new Set(
    entries.flatMap((entry) => entry.exploreKind === "token"
      ? [entry.tokenAddress.toLowerCase()]
      : []),
  );
  const collision = entries.find(
    (entry) => entry.exploreKind === "custom-project"
      && entry.tokenAddress !== undefined
      && classicAddresses.has(entry.tokenAddress.toLowerCase()),
  );
  if (collision !== undefined) {
    throw new Error("Canonical Explore sources disagree on launch category");
  }
}

function paginateEntries(
  ordered: readonly ExploreEntry[],
  input: Readonly<{ page: number; pageSize: number }>,
) {
  const pageSize = positiveInteger(input.pageSize, 9, 100);
  const totalPages = Math.ceil(ordered.length / pageSize);
  const requestedPage = positiveInteger(
    input.page,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  return {
    tokens: ordered.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: ordered.length,
    totalPages,
  };
}

export function paginateExploreEntriesV1(
  entries: readonly ExploreEntry[],
  input: Readonly<{
    page: number;
    pageSize: number;
    query: string;
    socials: "yes" | "no" | null;
    sort: ExploreSort;
    topThenNewest: boolean;
  }>,
) {
  const filtered = filterExploreEntries(entries, input.query, input.socials);
  if (!input.topThenNewest) {
    return paginateEntries(sortExploreEntries(filtered, input.sort), input);
  }
  const top = sortExploreEntries(filtered, "market-cap")
    .slice(0, TOP_MARKET_CAP_LIMIT);
  const topIds = new Set(top.map(({ id }) => id));
  const newest = sortExploreEntries(filtered, "newest")
    .filter(({ id }) => !topIds.has(id));
  return paginateEntries([...top, ...newest], input);
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (!hasCanonicalQueryShape(search)) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const socials = search.get("socials");
  if (socials !== null && socials !== "yes" && socials !== "no") {
    return NextResponse.json(
      { error: "Unsupported socials filter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const options = {
      query: search.get("q")?.trim() ?? "",
      sort: parseExploreSort(search.get("sort")),
      page: integerQuery(search.get("page"), 1),
      pageSize: integerQuery(search.get("limit"), 9),
      socials,
    } as const;
    const [model, customProjects] = await Promise.all([
      readAlchemyExploreModel(),
      readProductionCustomExploreDirectoryV1(request.signal),
    ]);
    let pricedModel = {
      ...model,
      tokens: await enrichTokensWithAlchemyPrices(model.tokens),
    } satisfies ExploreReadModel;
    const deployment = getAlchemyOnchainDeployment();
    const liveSnapshot =
      pricedModel.status === "ready"
        ? inheritExploreEthUsdQuote(
            pricedModel.launchDiscoverySnapshot ?? pricedModel.snapshot,
            pricedModel.snapshot,
          )
        : null;
    if (deployment.status === "ready" && liveSnapshot) {
      const visible = visibleExploreTokens(pricedModel);
      const top = filterAndSortTokens(
        [...visible],
        "",
        "market-cap",
      ).slice(0, TOP_MARKET_CAP_LIMIT);
      const newest = filterAndSortTokens(
        [...visible],
        "",
        "newest",
      ).slice(0, NEWEST_LIVE_MARKET_LIMIT);
      const warm = [...new Map(
        [...top, ...newest].map((token) => [
          token.tokenAddress.toLowerCase(),
          token,
        ]),
      ).values()];
      const updates = await enrichTokensWithAlchemyPoolState({
        deployment,
        snapshot: liveSnapshot,
        tokens: warm,
      });
      pricedModel = {
        ...pricedModel,
        tokens: mergeTokenUpdates(pricedModel.tokens, updates),
      };
    }
    const classicEntries = visibleExploreTokens(pricedModel)
      .map(canonicalTokenExploreEntryV1);
    const entries: ExploreEntry[] = [...classicEntries, ...customProjects];
    assertNoExploreCategoryCollision(entries);
    const useTopMarketCapView =
      options.sort === "market-cap" &&
      options.query.length === 0 &&
      options.socials === null;
    const paginated = paginateExploreEntriesV1(entries, {
      ...options,
      topThenNewest: useTopMarketCapView,
    });
    let pageEntries = paginated.tokens;
    const pageClassic = pageEntries.filter(
      (entry): entry is CanonicalTokenExploreEntry => entry.exploreKind === "token",
    );
    if (deployment.status === "ready" && liveSnapshot && pageClassic.length) {
      const updates = await enrichTokensWithAlchemyPoolState({
          deployment,
          snapshot: liveSnapshot,
          tokens: pageClassic,
        });
      const updatedByAddress = new Map(updates.map((token) => [
        token.tokenAddress.toLowerCase(),
        canonicalTokenExploreEntryV1(token),
      ]));
      pageEntries = pageEntries.map((entry) => entry.exploreKind === "token"
        ? updatedByAddress.get(entry.tokenAddress.toLowerCase()) ?? entry
        : entry);
    }

    const page = {
      status: model.status === "ready" || customProjects.length > 0
        ? "ready" as const
        : model.status,
      ...paginated,
      tokens: pageEntries,
      sort: options.sort,
      query: options.query,
      snapshot: model.snapshot,
      launchDiscoverySnapshot:
        model.status === "ready" ? model.launchDiscoverySnapshot : undefined,
      launcherFeesAccruedWei: model.launcherFeesAccruedWei,
      launcherFeesAccruedEth: model.launcherFeesAccruedEth,
    };

    return NextResponse.json(
      page,
      {
        headers: {
          "Cache-Control":
            customProjects.length > 0
              ? "no-store"
              : page.status === "ready"
              ? "public, max-age=0, s-maxage=2, stale-while-revalidate=5"
              : "public, max-age=0, s-maxage=30",
          "X-Programmable-Price-Source": "alchemy",
          "X-Programmable-Launch-Source": customProjects.length > 0
            ? "alchemy+registry.custom-launched"
            : "alchemy",
          "X-Programmable-Read-Source": customProjects.length > 0
            ? "blob+postgres"
            : "blob",
          "X-Programmable-Rpc-Provider": "alchemy",
        },
      },
    );
  } catch (error) {
    console.error("Alchemy Explore read failed", safeAlchemyError(error));
    return NextResponse.json(
      { error: "Token data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
