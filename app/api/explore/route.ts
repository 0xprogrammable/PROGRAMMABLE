import { NextRequest, NextResponse } from "next/server";

import {
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../lib/alchemy/explore.server";
import { suppressRouterBoundCustomProjectDuplicates } from "../../../lib/alchemy/router-custom-collision";
import {
  createExploreConsumerSource,
  exploreLaunchSourceHeader,
  exploreReadSourceHeader,
  type ExploreConsumerSource,
} from "../../../lib/explore-consumer.server";
import { canonicalTokenExploreEntryV1 } from "../../../lib/explore-entry-v1";
import {
  buildExploreDataQuality,
  publicExploreEntryV1,
  valuationSortValue,
  withBitqueryMarketData,
  type ValuedExploreEntry,
} from "../../../lib/explore-financial-data";
import { readBitqueryTokenMarketDataV1 } from
  "../../../lib/market-data/bitquery.server";
import { hydrateMissingCanonicalTokenSupplyV1 } from
  "../../../lib/market-data/canonical-token-supply.server";
import { exploreEntriesMarketIdentitiesV1 } from
  "../../../lib/market-data/explore-market-identities";
import type { TokenMarketDataV1 } from
  "../../../lib/market-data/market-data-v1";
import { readExploreReferenceHeadWithinRouteBudget } from "../../../lib/explore-reference-head.server";
import { getOnchainDeployment } from "../../../lib/onchain/config";
import { readDurableExploreModel } from "../../../lib/onchain/durable-model";
import {
  parseExploreSort,
  visibleExploreTokens,
} from "../../../lib/onchain/query";
import type {
  ExploreReadModel,
  ExploreSort,
} from "../../../lib/onchain/types";
import { readProductionCustomExploreDirectoryV1 } from "../../../lib/server/custom-launch/explore-directory-v1";
import type {
  CustomProjectExploreEntry,
  ExploreEntry,
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
const TOP_VALUATION_LIMIT = 20;
const readCanonicalExploreSource = createExploreConsumerSource<ExploreReadModel>({});
const readCustomExploreSource = createExploreConsumerSource<
  readonly CustomProjectExploreEntry[]
>({});

async function readPrimaryExploreModel() {
  const model = await readAlchemyExploreModel();
  if (model.status !== "ready") {
    throw new Error("Primary Explore model is unavailable");
  }
  return model;
}

async function readDurableExploreFallback() {
  const deployment = getOnchainDeployment("production");
  if (deployment.status !== "ready") {
    throw new Error("Production Explore deployment is not ready");
  }
  const read = await readDurableExploreModel(
    deployment,
    Number.MAX_SAFE_INTEGER,
  );
  if (read.status !== "ready") {
    throw new Error(`Durable Explore fallback is ${read.reason}`);
  }
  return {
    value: read.envelope.payload.model,
    ageMs: read.ageMs,
  };
}

function greatestBlockNumber(...values: Array<string | null | undefined>) {
  let greatest: bigint | null = null;
  for (const value of values) {
    if (!value || !/^[1-9]\d*$/u.test(value)) continue;
    const parsed = BigInt(value);
    if (greatest === null || parsed > greatest) greatest = parsed;
  }
  return greatest?.toString() ?? null;
}

type ExploreSourceAttempt<T> =
  | Readonly<{ source: ExploreConsumerSource<T>; error: null }>
  | Readonly<{ source: null; error: unknown }>;

async function settleExploreSource<T>(
  read: Promise<ExploreConsumerSource<T>>,
): Promise<ExploreSourceAttempt<T>> {
  try {
    return { source: await read, error: null };
  } catch (error) {
    return { source: null, error };
  }
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
  ) {
    return 0;
  }
  for (let index = 0; index < firstOrder.length; index += 1) {
    if (firstOrder[index] === secondOrder[index]) continue;
    return firstOrder[index] > secondOrder[index] ? -1 : 1;
  }
  return 0;
}

function compareNewestEntries(first: ExploreEntry, second: ExploreEntry): number {
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
      throw new Error(`Canonical Explore sources disagree on ${entry.id}`);
    }
    const address = entry.tokenAddress?.toLowerCase();
    const existingAddress = address ? byTokenAddress.get(address) : undefined;
    if (existingAddress !== undefined) {
      if (JSON.stringify(existingAddress) === JSON.stringify(entry)) continue;
      throw new Error(
        `Canonical Explore sources disagree on ${entry.tokenAddress}`,
      );
    }
    byId.set(entry.id, entry);
    if (address) byTokenAddress.set(address, entry);
    output.push(entry);
  }
  return output;
}

function valueExploreEntriesWithMarketData(
  entries: readonly ExploreEntry[],
  marketByToken: ReadonlyMap<string, TokenMarketDataV1>,
): ValuedExploreEntry[] {
  return entries.map((entry) => {
    const address = entry.tokenAddress?.toLowerCase();
    const marketData = address ? marketByToken.get(address) : undefined;
    if (marketData) return withBitqueryMarketData(entry, marketData);
    return {
      ...entry,
      valuation: {
        status: "unavailable" as const,
        reason:
          entry.exploreKind === "custom-project" && entry.markets.length === 0
            ? "no-market" as const
            : "source-unavailable" as const,
      },
    };
  });
}

function hasVerifiedBitqueryPrice(entries: readonly ValuedExploreEntry[]): boolean {
  return entries.some((entry) => {
    const primary = entry.marketData?.pools.find(
      (pool) => pool.identity.poolId === entry.marketData?.primaryPoolId,
    );
    return primary?.status === "current" &&
      (primary.latestTrade?.priceUsdWad !== undefined ||
        primary.latestTrade?.priceQuoteWad !== undefined);
  });
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
    .slice(0, TOP_VALUATION_LIMIT);
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
    const canonicalRead = settleExploreSource(
      readCanonicalExploreSource({
        primary: readPrimaryExploreModel,
        fallback: readDurableExploreFallback,
      }),
    );
    const customRead = settleExploreSource(
      readCustomExploreSource({
        primary: () => readProductionCustomExploreDirectoryV1(request.signal),
      }),
    );
    const [
      canonicalAttempt,
      customAttempt,
      referenceHead,
    ] = await Promise.all([
      canonicalRead,
      customRead,
      readExploreReferenceHeadWithinRouteBudget(),
    ]);
    if (canonicalAttempt.source === null && customAttempt.source === null) {
      throw canonicalAttempt.error ?? customAttempt.error;
    }

    const canonicalSource = canonicalAttempt.source;
    const customSource = customAttempt.source;
    const identityModel = canonicalSource?.value ?? null;
    const modelTokens = identityModel?.tokens ?? [];
    const customProjects = suppressRouterBoundCustomProjectDuplicates(
      modelTokens,
      customSource?.value ?? [],
    );
    const identityAsOfBlock =
      identityModel?.status === "ready"
        ? (identityModel.launchDiscoverySnapshot ?? identityModel.snapshot).blockNumber
        : null;
    const referenceBlock = greatestBlockNumber(
      identityAsOfBlock,
      referenceHead?.blockNumber,
    );
    const unresolvedIdentityEntries = dedupeExploreEntriesV1([
      ...(identityModel
        ? visibleExploreTokens(identityModel).map(canonicalTokenExploreEntryV1)
        : []),
      ...customProjects,
    ]);
    const identityEntries = await hydrateMissingCanonicalTokenSupplyV1(
      unresolvedIdentityEntries,
    );
    const marketByToken = await readBitqueryTokenMarketDataV1(
      exploreEntriesMarketIdentitiesV1(identityEntries),
      { signal: request.signal },
    );
    const entries = valueExploreEntriesWithMarketData(
      identityEntries,
      marketByToken,
    );
    assertNoExploreCategoryCollision(entries);
    const useTopValuationView =
      options.sort === "market-cap" &&
      options.query.length === 0 &&
      options.socials === null;
    const paginated = paginateExploreEntriesV1(entries, {
      ...options,
      topThenNewest: useTopValuationView,
    });
    const pageEntries = paginated.tokens as ValuedExploreEntry[];

    const sourceAges = [canonicalSource?.ageMs, customSource?.ageMs].filter(
      (value): value is number => value !== undefined,
    );
    const dataQuality = buildExploreDataQuality({
      entries,
      canonicalStatus: canonicalSource?.status ?? "unavailable",
      customStatus: customSource?.status ?? "unavailable",
      identityAsOfBlock,
      referenceBlock,
      identityAgeMs: sourceAges.length > 0 ? Math.max(...sourceAges) : null,
    });

    const sourceHeaders = {
      "X-Programmable-Launch-Source": exploreLaunchSourceHeader({
        canonical: canonicalSource,
        custom: customSource,
      }),
      "X-Programmable-Read-Source": exploreReadSourceHeader({
        canonical: canonicalSource,
        custom: customSource,
      }),
    };
    if (canonicalSource === null && entries.length === 0) {
      return NextResponse.json(
        {
          status: "unavailable",
          error: "Launch data is temporarily unavailable",
          retryable: true,
          dataQuality,
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "5",
            "X-Programmable-Data-Quality": dataQuality.status,
            "X-Programmable-Market-Source": "bitquery",
            ...sourceHeaders,
          },
        },
      );
    }

    const page = {
      status: identityModel?.status === "ready" || entries.length > 0
        ? "ready" as const
        : identityModel?.status ?? "not-deployed" as const,
      ...paginated,
      tokens: pageEntries.map(publicExploreEntryV1),
      sort: options.sort,
      query: options.query,
      sortMetric: "fdv" as const,
      dataQuality,
      snapshot: identityModel?.snapshot ?? null,
      launchDiscoverySnapshot:
        identityModel?.status === "ready"
          ? identityModel.launchDiscoverySnapshot
          : undefined,
      ...(identityModel
        ? {
            launcherFeesAccruedWei: identityModel.launcherFeesAccruedWei,
            launcherFeesAccruedEth: identityModel.launcherFeesAccruedEth,
          }
        : {}),
    };

    return NextResponse.json(
      page,
      {
        headers: {
          "Cache-Control":
            customProjects.length > 0 || dataQuality.status !== "complete"
              ? "no-store"
              : page.status === "ready"
              ? "public, max-age=0, s-maxage=2, stale-while-revalidate=5"
              : "public, max-age=0, s-maxage=30",
          "X-Programmable-Data-Quality": dataQuality.status,
          "X-Programmable-Market-Source": "bitquery",
          ...(dataQuality.valuation.asOfTime
            ? {
                "X-Programmable-Market-As-Of":
                  dataQuality.valuation.asOfTime,
              }
            : {}),
          ...(hasVerifiedBitqueryPrice(entries)
            ? { "X-Programmable-Price-Source": "bitquery" }
            : {}),
          ...sourceHeaders,
        },
      },
    );
  } catch (error) {
    console.error("Explore consumer read failed", safeAlchemyError(error));
    return NextResponse.json(
      { error: "Token data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
