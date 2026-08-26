import { NextRequest, NextResponse } from "next/server";

import {
  buildExploreDataQuality,
  publicExploreEntryV1,
  valuationSortValue,
  type ValuedExploreEntry,
} from "../../../lib/explore-financial-data";
import { readDexscreenerExploreEntriesV1 } from
  "../../../lib/market-data/dexscreener-explore.server";
import {
  envioClassicV3IdentityCommitmentV1,
  mergeEnvioClassicV3CatalogEntriesV1,
  readEnvioClassicV3CatalogV1,
} from
  "../../../lib/market-data/envio-classic-v3-catalog.server";
import {
  mergeRouterCustomExploreEntriesV1,
  publicLaunchSourceV1,
  readFinalizedRouterCustomIdentitySnapshotV1,
  ROUTER_CUSTOM_FINALITY_CONFIRMATIONS,
  ROUTER_CUSTOM_LAUNCH_SOURCE,
} from "../../../lib/alchemy/router-custom-public.server";
import { parseExploreSort } from "../../../lib/onchain/query";
import { safeOperationalRpcError } from
  "../../../lib/onchain/operational-rpc-failover.server";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../lib/server/custom-launch/explore-directory-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../../../lib/server/custom-launch/public-readiness";
import type { ExploreSort } from "../../../lib/onchain/types";
import { canonicalSha256 } from
  "../../../lib/server/projection-target/hashing";
import type { ExploreEntry } from "../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const FAST_LANE_REQUEST_BUDGET_MS = 8_000;
const CLASSIC_EXCLUSIONS = Object.freeze([
  "classic-v1",
  "classic-v2",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
] as const);

const EXPLORE_QUERY_PARAMETERS = new Set([
  "limit",
  "model",
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
  model: "classic" | "custom" | null,
): ExploreEntry[] {
  const normalized = query.trim().toLowerCase().replace(/^\$/u, "");
  return entries.filter((entry) => {
    if (
      model !== null &&
      entry.launchCategoryProvenance.category !== model
    ) return false;
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
    model: "classic" | "custom" | null;
    sort: ExploreSort;
  }>,
) {
  const filtered = filterExploreEntries(
    entries,
    input.query,
    input.socials,
    input.model,
  );
  return paginateEntries(sortExploreEntries(filtered, input.sort), input);
}

function generatedAgeMs(generatedAt: string): number | null {
  const value = Date.parse(generatedAt);
  return Number.isFinite(value) ? Math.max(0, Date.now() - value) : null;
}

export async function GET(request: NextRequest) {
  const deadlineMs = Date.now() + FAST_LANE_REQUEST_BUDGET_MS;
  const readSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(FAST_LANE_REQUEST_BUDGET_MS),
  ]);
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

  const model = search.get("model");
  if (model !== null && model !== "classic" && model !== "custom") {
    return NextResponse.json(
      { error: "Unsupported launch model filter" },
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
      model,
    } as const;
    const catalogRead = readEnvioClassicV3CatalogV1({
      signal: readSignal,
      deadlineMs,
    }).then(
      (catalog) => catalog,
      () => {
        console.error("Explore Envio identity read unavailable", {
          name: "EnvioClassicV3ReadError",
        });
        return null;
      },
    );
    const registryRead = isCustomLaunchRegistryPublicReadEnabled()
      ? readProductionCustomExploreDirectoryV1(readSignal).then(
          (entries) => ({ entries, status: "current" as const }),
          () => {
            console.error("Explore Custom Registry read unavailable", {
              name: "CustomRegistryReadError",
            });
            return { entries: [] as readonly ExploreEntry[], status: "unavailable" as const };
          },
        )
      : Promise.resolve({
          entries: [] as readonly ExploreEntry[],
          status: "unavailable" as const,
        });
    const routerRead = readFinalizedRouterCustomIdentitySnapshotV1({
      signal: readSignal,
      deadlineMs,
    }).then(
      (snapshot) => ({
        entries: snapshot.entries,
        status: snapshot.status,
        snapshot,
        verifiedIdentityCount: snapshot.entries.length,
      }),
      () => {
        console.error("Explore Router Custom read unavailable", {
          name: "RouterCustomReadError",
        });
        return {
          entries: [] as const,
          status: "unavailable" as const,
          snapshot: null,
          verifiedIdentityCount: 0,
        };
      },
    );
    const [catalog, registryCustom, routerCustom] = await Promise.all([
      catalogRead,
      registryRead,
      routerRead,
    ]);
    let customEntries = registryCustom.entries;
    let registryCustomStatus = registryCustom.status;
    let routerEntries = routerCustom.entries;
    let routerCustomStatus = routerCustom.status;
    const verifiedRouterIdentityCount = routerCustom.verifiedIdentityCount;
    if (catalog === null) {
      // Registry projects do not carry an independent onchain snapshot.
      // Only the Router lane may stand alone on its bound durable cursor.
      customEntries = [];
      registryCustomStatus = "unavailable";
    }
    let registryIdentityEntries: readonly ExploreEntry[];
    try {
      registryIdentityEntries = mergeEnvioClassicV3CatalogEntriesV1(
        catalog?.entries ?? [],
        customEntries,
      );
    } catch {
      console.error("Explore Custom Registry identity merge unavailable", {
        name: "CustomRegistryIdentityError",
      });
      customEntries = [];
      registryCustomStatus = "unavailable";
      registryIdentityEntries = catalog?.entries ?? [];
    }
    let identityEntries: readonly ExploreEntry[];
    try {
      identityEntries = mergeRouterCustomExploreEntriesV1(
        registryIdentityEntries,
        routerEntries,
      );
    } catch {
      console.error("Explore Router Custom identity merge unavailable", {
        name: "RouterCustomIdentityError",
      });
      routerEntries = [];
      routerCustomStatus = "unavailable";
      identityEntries = registryIdentityEntries;
    }
    if (
      catalog === null &&
      (routerCustom.snapshot === null ||
        routerCustomStatus === "unavailable" ||
        identityEntries.length === 0)
    ) {
      throw new Error("No validated public identity snapshot is available");
    }
    const routerAvailable = routerCustomStatus !== "unavailable";
    const acceptedRouterSnapshot = routerAvailable
      ? routerCustom.snapshot
      : null;
    const routerOwnsAggregateBoundary = acceptedRouterSnapshot !== null &&
      (catalog === null ||
        BigInt(acceptedRouterSnapshot.asOfBlock) > BigInt(catalog.asOfBlock));
    const identityAsOfBlock = routerOwnsAggregateBoundary
      ? acceptedRouterSnapshot!.asOfBlock
      : catalog!.asOfBlock;
    const identityAsOfBlockHash = routerOwnsAggregateBoundary
      ? acceptedRouterSnapshot!.asOfBlockHash
      : catalog!.asOfBlockHash;
    const identityGeneratedAt = catalog?.generatedAt ??
      acceptedRouterSnapshot!.generatedAt;
    const identityCommitment = catalog === null
      ? canonicalSha256("programmable.public-identity-fallback.v1", {
          chainId: 1,
          launchSource: ROUTER_CUSTOM_LAUNCH_SOURCE,
          asOfBlock: identityAsOfBlock,
          entries: identityEntries,
        })
      : envioClassicV3IdentityCommitmentV1(catalog, identityEntries);
    const customStatus =
      registryCustomStatus === "current" && routerCustomStatus === "current"
        ? "current" as const
        : registryCustomStatus === "current" &&
            routerCustomStatus === "last-known-good"
          ? "last-known-good" as const
        : "unavailable" as const;
    const launchSource = publicLaunchSourceV1({
      envioAvailable: catalog !== null,
      registryCustomCurrent: registryCustomStatus === "current",
      routerCustomCurrent: routerAvailable,
    });
    const projectedRouterIdentityCount = identityEntries.filter(
      (entry) => entry.exploreKind === "token" &&
        entry.launchCategoryProvenance.source === ROUTER_CUSTOM_LAUNCH_SOURCE,
    ).length;
    const catalogStatus = catalog?.status ?? "last-known-good" as const;
    const canonicalStatus = catalog?.status ?? "unavailable" as const;
    const catalogScope = catalog?.scope ?? {
      included: [] as readonly string[],
      excluded: CLASSIC_EXCLUSIONS,
      publicCategories: ["classic", "custom"] as const,
    };
    const includedSources = new Set<string>(catalogScope.included);
    if (registryCustomStatus === "current") {
      includedSources.add("registry.custom-launched");
    }
    if (routerAvailable) includedSources.add(ROUTER_CUSTOM_LAUNCH_SOURCE);
    let paginated: ReturnType<typeof paginateExploreEntriesV1>;
    let marketRead: Awaited<
      ReturnType<typeof readDexscreenerExploreEntriesV1>
    >["marketRead"];
    let marketQualifiedEntryCount = 0;
    if (options.sort === "market-cap" || options.sort === "market-cap-asc") {
      const filtered = filterExploreEntries(
        identityEntries,
        options.query,
        options.socials,
        options.model,
      );
      const valued = await readDexscreenerExploreEntriesV1(filtered, {
        signal: readSignal,
        deadlineMs,
      });
      marketRead = valued.marketRead;
      marketQualifiedEntryCount = valued.entries.filter(
        (entry) => valuationSortValue(entry) !== null,
      ).length;
      paginated = paginateExploreEntriesV1(valued.entries, {
        ...options,
        query: "",
        socials: null,
        model: null,
      });
    } else {
      const identityPage = paginateExploreEntriesV1(identityEntries, options);
      const valued = await readDexscreenerExploreEntriesV1(
        identityPage.tokens,
        { signal: readSignal, deadlineMs },
      );
      marketRead = valued.marketRead;
      paginated = { ...identityPage, tokens: [...valued.entries] };
    }
    const pageEntries = paginated.tokens as ValuedExploreEntry[];
    const dataQuality = buildExploreDataQuality({
      entries: pageEntries,
      generatedAt: identityGeneratedAt,
      canonicalStatus,
      customStatus,
      identityAsOfBlock,
      referenceBlock: identityAsOfBlock,
      identityAgeMs: generatedAgeMs(identityGeneratedAt),
    });
    const marketSort = options.sort === "market-cap" ||
      options.sort === "market-cap-asc";
    const qualifiedCount = marketSort
      ? marketQualifiedEntryCount
      : pageEntries.filter((entry) => valuationSortValue(entry) !== null).length;
    const rankingStatus = qualifiedCount === 0
      ? "unavailable" as const
      : qualifiedCount === paginated.total
        ? "complete" as const
        : "partial" as const;

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
        marketRead,
        catalog: {
          source: "envio-classic-v3" as const,
          launchSource,
          status: catalogStatus,
          lastIndexedAt: identityGeneratedAt,
          asOfBlock: identityAsOfBlock,
          asOfBlockHash: identityAsOfBlockHash,
          identityCount: identityEntries.length,
          identityCommitment,
          completeness: {
            ...(catalog?.completeness ?? {
              classic: "unavailable" as const,
              stock: "excluded" as const,
              custom: "unavailable" as const,
            }),
            custom: customStatus,
            registryCustom: registryCustomStatus,
            routerCustom: routerCustomStatus,
          },
          scope: {
            ...catalogScope,
            included: [...includedSources],
          },
          ...(catalog ? { evidence: catalog.evidence } : {}),
          routerStamp: {
            source: ROUTER_CUSTOM_LAUNCH_SOURCE,
            status: routerCustomStatus,
            finalityConfirmations: ROUTER_CUSTOM_FINALITY_CONFIRMATIONS,
            verifiedIdentityCount: routerAvailable
              ? verifiedRouterIdentityCount
              : 0,
            projectedIdentityCount: projectedRouterIdentityCount,
            ...(acceptedRouterSnapshot
              ? {
                  generatedAt: acceptedRouterSnapshot.generatedAt,
                  asOfBlock: acceptedRouterSnapshot.asOfBlock,
                  asOfBlockHash: acceptedRouterSnapshot.asOfBlockHash,
                  identityCommitment:
                    acceptedRouterSnapshot.identityCommitment,
                }
              : {}),
          },
        },
        ...(marketSort
          ? {
              ranking: {
                status: rankingStatus,
                requested: "fdv" as const,
                applied: rankingStatus === "complete"
                  ? "fdv" as const
                  : rankingStatus === "partial"
                    ? "qualified-fdv-then-launch-order" as const
                    : "launch-order" as const,
                qualifiedCount,
                totalCount: paginated.total,
              },
            }
          : {}),
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=15, stale-while-revalidate=45",
          "X-Programmable-Data-Quality": dataQuality.status,
          "X-Programmable-Launch-Source": launchSource,
          "X-Programmable-Read-Source": `${launchSource}+dexscreener`,
          "X-Programmable-Market-Read-Status": marketRead.status,
          "X-Programmable-Market-Provider": "dexscreener",
          "X-Programmable-Canonical-Read-Status": canonicalStatus,
          "X-Programmable-Router-Read-Status": routerCustomStatus,
          ...(marketRead.observedCount > 0
            ? {
                "X-Programmable-Market-Source": "dexscreener",
                "X-Programmable-Price-Source": "dexscreener",
              }
            : {}),
          ...(dataQuality.valuation.asOfTime
            ? { "X-Programmable-Market-As-Of": dataQuality.valuation.asOfTime }
            : {}),
          "X-Programmable-Identity-Last-Indexed-At": identityGeneratedAt,
        },
      },
    );
  } catch (error) {
    console.error("Explore read failed", safeOperationalRpcError(error));
    return NextResponse.json(
      { error: "Token data is temporarily unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "5",
          "X-Programmable-Launch-Source": "envio-classic-v3",
          "X-Programmable-Read-Source": "envio-classic-v3+dexscreener",
          "X-Programmable-Market-Provider": "dexscreener",
        },
      },
    );
  }
}
