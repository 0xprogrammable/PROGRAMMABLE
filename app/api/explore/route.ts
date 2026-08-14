import { NextRequest, NextResponse } from "next/server";

import {
  buildExploreDataQuality,
  publicExploreEntryV1,
  valuationSortValue,
  withBitqueryMarketData,
  type ValuedExploreEntry,
} from "../../../lib/explore-financial-data";
import {
  readBitqueryTokenMarketDataStrictV1,
  safeBitqueryMarketDataError,
} from "../../../lib/market-data/bitquery.server";
import {
  exploreEntriesMarketIdentitiesV1,
  exploreEntryMarketIdentitiesV1,
} from
  "../../../lib/market-data/explore-market-identities";
import {
  readPrimaryRpcExploreEntriesV1,
  safePrimaryRpcLaunchCatalogError,
} from "../../../lib/market-data/primary-rpc-launches.server";
import { parseExploreSort } from "../../../lib/onchain/query";
import type { ExploreSort } from "../../../lib/onchain/types";
import type { ExploreEntry } from "../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPLORE_QUERY_PARAMETERS = new Set([
  "limit",
  "page",
  "q",
  "socials",
  "sort",
]);

function hasCanonicalQueryShape(search: URLSearchParams) {
  const seen = new Set<string>();
  for (const [key] of search) {
    if (!EXPLORE_QUERY_PARAMETERS.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function hasCanonicalPaginationShape(search: URLSearchParams) {
  return ["page", "limit"].every((parameter) => {
    const value = search.get(parameter);
    if (value === null) return true;
    if (!/^[1-9]\d*$/u.test(value)) return false;
    return Number.isSafeInteger(Number(value));
  });
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

function entryLaunchTime(entry: ExploreEntry): number {
  const value = Date.parse(entry.launchedAt);
  return Number.isFinite(value) ? value : 0;
}

function nonNegativeInteger(value: unknown): bigint | null {
  const normalized = String(value ?? "");
  return /^(?:0|[1-9][0-9]*)$/u.test(normalized)
    ? BigInt(normalized)
    : null;
}

function entryChainId(entry: ExploreEntry): string | null {
  if (entry.exploreKind === "custom-project") return entry.chainId;
  const [chainId] = entry.id.split(":", 1);
  return /^\d+$/u.test(chainId ?? "") ? chainId : null;
}

function entryLaunchOrder(
  entry: ExploreEntry,
): readonly [bigint, bigint, bigint] | null {
  const values = entry.exploreKind === "token"
    ? [
        entry.launchBlockNumber,
        entry.launchTransactionIndex,
        entry.launchLogIndex,
      ]
    : entry.launchCategoryProvenance.source === "registry.custom-launched"
      ? [
          entry.launchCategoryProvenance.blockNumber,
          entry.launchCategoryProvenance.transactionIndex,
          entry.launchCategoryProvenance.logIndex,
        ]
      : null;
  if (values === null) return null;
  const coordinates = values.map(nonNegativeInteger);
  return coordinates.every((value): value is bigint => value !== null)
    ? [coordinates[0], coordinates[1], coordinates[2]]
    : null;
}

function compareCanonicalLaunchOrder(
  first: ExploreEntry,
  second: ExploreEntry,
): number {
  const firstChainId = entryChainId(first);
  const secondChainId = entryChainId(second);
  const firstOrder = entryLaunchOrder(first);
  const secondOrder = entryLaunchOrder(second);
  if (
    firstChainId === null ||
    firstChainId !== secondChainId ||
    firstOrder === null ||
    secondOrder === null
  ) return 0;
  for (let index = 0; index < firstOrder.length; index += 1) {
    if (firstOrder[index] === secondOrder[index]) continue;
    return firstOrder[index] > secondOrder[index] ? -1 : 1;
  }
  return 0;
}

function compareNewestEntries(first: ExploreEntry, second: ExploreEntry) {
  const time = entryLaunchTime(second) - entryLaunchTime(first);
  if (time !== 0) return time;
  const firstChainId = entryChainId(first);
  const secondChainId = entryChainId(second);
  if (firstChainId !== secondChainId) {
    if (firstChainId === null) return 1;
    if (secondChainId === null) return -1;
    return BigInt(firstChainId) < BigInt(secondChainId) ? -1 : 1;
  }
  const canonicalOrder = compareCanonicalLaunchOrder(first, second);
  return canonicalOrder === 0 ? first.id.localeCompare(second.id) : canonicalOrder;
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
    const firstCap = valuationSortValue(first);
    const secondCap = valuationSortValue(second);
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
    return entry.name.toLowerCase().includes(normalized) ||
      (entry.symbol?.toLowerCase().includes(normalized) ?? false) ||
      (entry.tokenAddress?.toLowerCase().includes(normalized) ?? false) ||
      (entry.exploreKind === "custom-project" &&
        entry.modelId.toLowerCase().includes(normalized));
  });
}

export function dedupeExploreEntriesV1(
  entries: readonly ExploreEntry[],
): ExploreEntry[] {
  const byId = new Map<string, ExploreEntry>();
  const byTokenAddress = new Map<string, ExploreEntry>();
  const output: ExploreEntry[] = [];
  for (const entry of entries) {
    const existingId = byId.get(entry.id);
    if (existingId !== undefined) {
      if (JSON.stringify(existingId) === JSON.stringify(entry)) continue;
      throw new Error(`Launch catalog returned conflicting launch ${entry.id}`);
    }
    const address = entry.tokenAddress?.toLowerCase();
    const existingAddress = address ? byTokenAddress.get(address) : undefined;
    if (existingAddress !== undefined) {
      if (JSON.stringify(existingAddress) === JSON.stringify(entry)) continue;
      throw new Error(`Launch catalog returned conflicting token ${entry.tokenAddress}`);
    }
    byId.set(entry.id, entry);
    if (address) byTokenAddress.set(address, entry);
    output.push(entry);
  }
  return output;
}

function paginateEntries(
  ordered: readonly ExploreEntry[],
  input: Readonly<{ page: number; pageSize: number }>,
) {
  const pageSize = positiveInteger(input.pageSize, 9, 100);
  const totalPages = Math.ceil(ordered.length / pageSize);
  const requestedPage = positiveInteger(input.page, 1, Number.MAX_SAFE_INTEGER);
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
  }>,
) {
  const filtered = filterExploreEntries(entries, input.query, input.socials);
  return paginateEntries(sortExploreEntries(filtered, input.sort), input);
}

function generatedAgeMs(generatedAt: string): number | null {
  const value = Date.parse(generatedAt);
  return Number.isFinite(value) ? Math.max(0, Date.now() - value) : null;
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (!hasCanonicalQueryShape(search) || !hasCanonicalPaginationShape(search)) {
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
    const launches = await readPrimaryRpcExploreEntriesV1({
      signal: request.signal,
    });
    const identityEntries = dedupeExploreEntriesV1(launches.entries);
    const marketByToken = await readBitqueryTokenMarketDataStrictV1(
      exploreEntriesMarketIdentitiesV1(identityEntries),
      { signal: request.signal, includeStats: false },
    );
    const now = new Date();
    const valuedEntries: ValuedExploreEntry[] = identityEntries.map((entry) => {
      const marketData = entry.tokenAddress
        ? marketByToken.get(entry.tokenAddress.toLowerCase())
        : undefined;
      const marketIsRequired = exploreEntryMarketIdentitiesV1(entry).length > 0;
      if (marketIsRequired && marketData === undefined) {
        throw new Error("Bitquery market response is incomplete");
      }
      return marketData
        ? withBitqueryMarketData(entry, marketData, { now })
        : {
            ...entry,
            valuation: {
              status: "unavailable" as const,
              reason: entry.exploreKind === "custom-project" &&
                  entry.markets.length === 0
                ? "no-market" as const
                : "source-unavailable" as const,
            },
          };
    });
    const paginated = paginateExploreEntriesV1(valuedEntries, options);
    const pageEntries = paginated.tokens as ValuedExploreEntry[];
    const dataQuality = buildExploreDataQuality({
      entries: pageEntries,
      canonicalStatus: "current",
      customStatus: "current",
      identityAsOfBlock: launches.asOfBlock,
      referenceBlock: launches.asOfBlock,
      identityAgeMs: generatedAgeMs(launches.generatedAt),
    });

    return NextResponse.json(
      {
        status: "ready" as const,
        ...paginated,
        tokens: pageEntries.map(publicExploreEntryV1),
        sort: options.sort,
        query: options.query,
        sortMetric: "fdv" as const,
        dataQuality,
        snapshot: null,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=2",
          "X-Programmable-Data-Quality": dataQuality.status,
          "X-Programmable-Launch-Source": "drpc",
          "X-Programmable-Read-Source": "drpc+bitquery",
          "X-Programmable-Market-Source": "bitquery",
          "X-Programmable-Price-Source": "bitquery",
          ...(dataQuality.valuation.asOfTime
            ? { "X-Programmable-Market-As-Of": dataQuality.valuation.asOfTime }
            : {}),
        },
      },
    );
  } catch (error) {
    console.error("Explore read failed", {
      launch: safePrimaryRpcLaunchCatalogError(error),
      market: safeBitqueryMarketDataError(error),
    });
    return NextResponse.json(
      { error: "Token data is temporarily unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "5",
          "X-Programmable-Launch-Source": "drpc",
          "X-Programmable-Read-Source": "drpc+bitquery",
          "X-Programmable-Market-Source": "bitquery",
        },
      },
    );
  }
}
