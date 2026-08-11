import { NextRequest, NextResponse } from "next/server";

import {
  getAlchemyOnchainDeployment,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../lib/alchemy/explore.server";
import {
  enrichTokensWithAlchemyPoolState,
  readVerifiedOperationalMarketSnapshot,
  withSameBlockEthUsdQuote,
  withoutUnboundEthUsdQuote,
} from "../../../lib/alchemy/live-market.server";
import { suppressRouterBoundCustomProjectDuplicates } from "../../../lib/alchemy/router-custom-collision";
import {
  createExploreConsumerSource,
  exploreLaunchSourceHeader,
  exploreReadSourceHeader,
  exploreRpcProviderHeader,
  type ExploreConsumerSource,
} from "../../../lib/explore-consumer.server";
import { canonicalTokenExploreEntryV1 } from "../../../lib/explore-entry-v1";
import {
  buildExploreDataQuality,
  publicExploreEntryV1,
  valuationSortValue,
  withExploreValuation,
  type ValuedExploreEntry,
} from "../../../lib/explore-financial-data";
import { readExploreReferenceHeadWithinRouteBudget } from "../../../lib/explore-reference-head.server";
import { getOnchainDeployment } from "../../../lib/onchain/config";
import { readDurableExploreModel } from "../../../lib/onchain/durable-model";
import {
  filterAndSortTokens,
  parseExploreSort,
  visibleExploreTokens,
} from "../../../lib/onchain/query";
import type {
  ExploreReadModel,
  ExploreSort,
} from "../../../lib/onchain/types";
import { readProductionCustomExploreDirectoryV1 } from "../../../lib/server/custom-launch/explore-directory-v1";
import type {
  CanonicalTokenExploreEntry,
  CustomProjectExploreEntry,
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
const TOP_VALUATION_LIMIT = 20;
const NEWEST_LIVE_MARKET_LIMIT = 20;
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
    let deployment: ReturnType<typeof getAlchemyOnchainDeployment> | null = null;
    try {
      deployment = getAlchemyOnchainDeployment();
    } catch {
      // Provider readiness is independent from canonical launch identity.
    }
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
    const operationalSnapshotRead = deployment?.status === "ready"
      ? readVerifiedOperationalMarketSnapshot(deployment)
      : Promise.resolve(null);
    const [
      canonicalAttempt,
      customAttempt,
      referenceHead,
      operationalSnapshot,
    ] = await Promise.all([
      canonicalRead,
      customRead,
      readExploreReferenceHeadWithinRouteBudget(),
      operationalSnapshotRead,
    ]);
    if (canonicalAttempt.source === null && customAttempt.source === null) {
      throw canonicalAttempt.error ?? customAttempt.error;
    }

    const canonicalSource = canonicalAttempt.source;
    const customSource = customAttempt.source;
    let pricedModel = canonicalSource?.value ?? null;

    let liveSnapshot = operationalSnapshot;
    if (deployment?.status === "ready" && liveSnapshot) {
      try {
        liveSnapshot = await withSameBlockEthUsdQuote({
          deployment,
          snapshot: liveSnapshot,
        });
      } catch {
        // USD conversion is fail-closed. Current StateView values can still be
        // exposed in ETH, but an older durable quote is never carried forward.
        liveSnapshot = withoutUnboundEthUsdQuote(liveSnapshot);
      }
    }
    let livePoolStateApplied = false;
    if (deployment?.status === "ready" && liveSnapshot && pricedModel) {
      const visible = visibleExploreTokens(pricedModel);
      const top = filterAndSortTokens(
        [...visible],
        "",
        "market-cap",
      ).slice(0, TOP_VALUATION_LIMIT);
      const newest = filterAndSortTokens(
        [...visible],
        "",
        "newest",
      ).slice(0, NEWEST_LIVE_MARKET_LIMIT);
      const warmCandidates =
        options.sort === "market-cap" || options.sort === "market-cap-asc"
          ? visible
          : [...top, ...newest];
      const warm = [...new Map(
        warmCandidates.map((token) => [
          token.tokenAddress.toLowerCase(),
          token,
        ]),
      ).values()];
      try {
        const updates = await enrichTokensWithAlchemyPoolState({
          deployment,
          snapshot: liveSnapshot,
          tokens: warm,
        });
        const previousByAddress = new Map(pricedModel.tokens.map((token) => [
          token.tokenAddress.toLowerCase(),
          token,
        ]));
        livePoolStateApplied = updates.some((token) => {
          const previous = previousByAddress.get(
            token.tokenAddress.toLowerCase(),
          );
          return token.indexedValuationBlockNumber ===
              liveSnapshot?.blockNumber &&
            (
              previous?.indexedValuationBlockNumber !==
                token.indexedValuationBlockNumber ||
              previous?.marketCapEthWei !== token.marketCapEthWei ||
              previous?.fdvUsdWad !== token.fdvUsdWad
            );
        });
        pricedModel = {
          ...pricedModel,
          tokens: mergeTokenUpdates(pricedModel.tokens, updates),
        };
      } catch {
        // Keep the canonical model and mark its valuations below as partial.
      }
    }

    const modelTokens = pricedModel?.tokens ?? [];
    const customProjects = suppressRouterBoundCustomProjectDuplicates(
      modelTokens,
      customSource?.value ?? [],
    );
    const identityAsOfBlock =
      pricedModel?.status === "ready"
        ? (pricedModel.launchDiscoverySnapshot ?? pricedModel.snapshot).blockNumber
        : null;
    const referenceBlock = greatestBlockNumber(
      identityAsOfBlock,
      referenceHead?.blockNumber,
      operationalSnapshot?.blockNumber,
    );
    const valuationContext = {
      referenceBlock,
      forceStale:
        canonicalSource?.status === "last-known-good" ||
        operationalSnapshot === null,
    } as const;
    const classicEntries = pricedModel
      ? visibleExploreTokens(pricedModel)
          .map(canonicalTokenExploreEntryV1)
          .map((entry) => withExploreValuation(entry, valuationContext))
      : [];
    const valuedCustomProjects = customProjects.map((entry) =>
      withExploreValuation(entry, valuationContext)
    );
    const entries = dedupeExploreEntriesV1([
      ...classicEntries,
      ...valuedCustomProjects,
    ]) as ValuedExploreEntry[];
    assertNoExploreCategoryCollision(entries);
    const livePriceSource = livePoolStateApplied
      ? liveSnapshot?.ethUsdQuote
        ? "state-view+chainlink"
        : "state-view"
      : "read-model";
    const useTopValuationView =
      options.sort === "market-cap" &&
      options.query.length === 0 &&
      options.socials === null;
    const paginated = paginateExploreEntriesV1(entries, {
      ...options,
      topThenNewest: useTopValuationView,
    });
    let pageEntries = paginated.tokens as ValuedExploreEntry[];
    const pageClassic = pageEntries.filter(
      (
        entry,
      ): entry is ValuedExploreEntry<CanonicalTokenExploreEntry> =>
        entry.exploreKind === "token",
    );
    if (deployment?.status === "ready" && liveSnapshot && pageClassic.length) {
      try {
        const updates = await enrichTokensWithAlchemyPoolState({
          deployment,
          snapshot: liveSnapshot,
          tokens: pageClassic,
        });
        const updatedByAddress = new Map(updates.map((token) => [
          token.tokenAddress.toLowerCase(),
          withExploreValuation(
            canonicalTokenExploreEntryV1(token),
            valuationContext,
          ),
        ]));
        pageEntries = pageEntries.map((entry) => entry.exploreKind === "token"
          ? updatedByAddress.get(entry.tokenAddress.toLowerCase()) ?? entry
          : entry);
      } catch {
        // Page-level refresh is best effort; last-known values remain visible.
      }
    }

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
    const rpcProvider = exploreRpcProviderHeader(deployment);

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
            "X-Programmable-Valuation-Metric": "fdv",
            ...sourceHeaders,
          },
        },
      );
    }

    const page = {
      status: pricedModel?.status === "ready" || entries.length > 0
        ? "ready" as const
        : pricedModel?.status ?? "not-deployed" as const,
      ...paginated,
      tokens: pageEntries.map(publicExploreEntryV1),
      sort: options.sort,
      query: options.query,
      sortMetric: "fdv" as const,
      dataQuality,
      snapshot: pricedModel?.snapshot ?? null,
      launchDiscoverySnapshot:
        pricedModel?.status === "ready"
          ? pricedModel.launchDiscoverySnapshot
          : undefined,
      ...(pricedModel
        ? {
            launcherFeesAccruedWei: pricedModel.launcherFeesAccruedWei,
            launcherFeesAccruedEth: pricedModel.launcherFeesAccruedEth,
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
          "X-Programmable-Valuation-Metric": "fdv",
          ...(dataQuality.valuation.asOfBlock
            ? {
                "X-Programmable-Valuation-Block":
                  dataQuality.valuation.asOfBlock,
              }
            : {}),
          ...(pricedModel
            ? {
                "X-Programmable-Price-Source": livePriceSource,
              }
            : {}),
          ...sourceHeaders,
          ...(rpcProvider === null
            ? {}
            : { "X-Programmable-Rpc-Provider": rpcProvider }),
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
