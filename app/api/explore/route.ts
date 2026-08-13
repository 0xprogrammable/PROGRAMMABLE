import { createHash, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../lib/alchemy/explore.server";
import { readVerifiedOperationalMarketSnapshot } from
  "../../../lib/alchemy/live-market.server";
import { suppressRouterBoundCustomProjectDuplicates } from "../../../lib/alchemy/router-custom-collision";
import {
  createExploreConsumerSource,
  exploreLaunchSourceHeader,
  exploreReadSourceHeader,
  type ExploreConsumerSource,
} from "../../../lib/explore-consumer.server";
import { canonicalTokenExploreEntryV1 } from "../../../lib/explore-entry-v1";
import {
  EXPLORE_MAXIMUM_STALE_VALUATION_AGE_MS,
  buildExploreDataQuality,
  publicExploreEntryV1,
  valuationSortValue,
  type ValuedExploreEntry,
} from "../../../lib/explore-financial-data";
import { readBitqueryTokenMarketDataV1 } from
  "../../../lib/market-data/bitquery.server";
import { currentMarketOnchainDeployment } from
  "../../../lib/market-data/current-market-rpc.server";
import { hydrateMissingCanonicalTokenSupplyV1 } from
  "../../../lib/market-data/canonical-token-supply.server";
import { exploreEntriesMarketIdentitiesV1 } from
  "../../../lib/market-data/explore-market-identities";
import {
  CURRENT_EVIDENCE_ROUTE_DEADLINE_MS,
  attachBitqueryMarketDataToValuedEntries,
  settleCurrentEvidenceSnapshot,
  type CurrentEvidenceSnapshotOutcome,
  valueExploreEntriesWithCurrentEvidence,
  valueExploreEntriesWithCurrentEvidenceSnapshot,
} from "../../../lib/market-data/current-valuation.server";
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
  "valuationBlock",
  "valuationBlockHash",
  "liquidityBlock",
  "liquidityBlockHash",
  "rankingCommitment",
]);
const EXPLORE_RANKING_COMMITMENT = /^sha256:[0-9a-f]{64}$/u;
const EXPLORE_BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const GRAPHQL_INT_MAXIMUM = 2_147_483_647n;
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

function requiresCompleteCurrentValuation(sort: ExploreSort): boolean {
  return sort === "market-cap" || sort === "market-cap-asc";
}

type RequestedExploreValuationSnapshotV1 = Readonly<{
  blockNumber: string;
  blockHash: `0x${string}`;
  liquidityBlockNumber: string;
  liquidityBlockHash: `0x${string}` | "none";
  rankingCommitment: `sha256:${string}`;
}>;

function requestedValuationSnapshot(
  search: URLSearchParams,
  options: Readonly<{
    page: number;
    pageSize: number;
    query: string;
    socials: "yes" | "no" | null;
    sort: ExploreSort;
  }>,
): RequestedExploreValuationSnapshotV1 | null | undefined {
  const blockNumber = search.get("valuationBlock");
  const blockHash = search.get("valuationBlockHash");
  const liquidityBlockNumber = search.get("liquidityBlock");
  const liquidityBlockHash = search.get("liquidityBlockHash");
  const rankingCommitment = search.get("rankingCommitment");
  const supplied = [
    blockNumber,
    blockHash,
    liquidityBlockNumber,
    liquidityBlockHash,
    rankingCommitment,
  ]
    .filter((value) => value !== null).length;
  if (!requiresCompleteCurrentValuation(options.sort)) {
    if (supplied > 0) return null;
    return undefined;
  }
  if (options.page === 1) {
    if (supplied > 0) return null;
    return undefined;
  }
  const canonicalLiquiditySnapshot =
    liquidityBlockNumber === "none" && liquidityBlockHash === "none" ||
    liquidityBlockNumber !== null &&
      /^[1-9]\d*$/u.test(liquidityBlockNumber) &&
      liquidityBlockNumber.length <= 10 &&
      BigInt(liquidityBlockNumber) <= GRAPHQL_INT_MAXIMUM &&
      liquidityBlockHash !== null &&
      EXPLORE_BLOCK_HASH.test(liquidityBlockHash);
  if (
    supplied !== 5 ||
    search.get("sort") !== options.sort ||
    search.get("q") !== null && search.get("q") !== options.query ||
    options.pageSize > 100 ||
    !blockNumber ||
    !/^[1-9]\d*$/u.test(blockNumber) ||
    blockNumber.length > 78 ||
    !blockHash ||
    !EXPLORE_BLOCK_HASH.test(blockHash) ||
    !canonicalLiquiditySnapshot ||
    !liquidityBlockNumber ||
    !liquidityBlockHash ||
    !rankingCommitment ||
    !EXPLORE_RANKING_COMMITMENT.test(rankingCommitment)
  ) return null;
  return {
    blockNumber,
    blockHash: blockHash as `0x${string}`,
    liquidityBlockNumber,
    liquidityBlockHash: liquidityBlockHash as `0x${string}` | "none",
    rankingCommitment: rankingCommitment as `sha256:${string}`,
  };
}

function exploreRankingCommitment(
  entries: readonly ValuedExploreEntry[],
  input: Readonly<{
    snapshot: Readonly<{
      blockNumber: string;
      blockHash: string;
      liquidityBlockNumber: string;
      liquidityBlockHash: string;
    }>;
    sort: ExploreSort;
    query: string;
    socials: "yes" | "no" | null;
    pageSize: number;
  }>,
): `sha256:${string}` {
  const ordered = sortExploreEntries(entries, input.sort);
  const ranking = ordered.map((entry) => ({
    id: entry.id,
    tokenAddress: entry.tokenAddress?.toLowerCase() ?? null,
    valueWad: valuationSortValue(entry)?.toString() ?? null,
    availability: valuationSortValue(entry) === undefined
      ? "unavailable"
      : "available",
    launchTime: entry.launchedAt,
    launchOrder: entryLaunchOrder(entry)?.map(String) ?? null,
  }));
  const hash = createHash("sha256");
  hash.update("programmable.explore-market-ranking.v1", "utf8");
  hash.update(Uint8Array.of(0));
  hash.update(JSON.stringify({
    schemaVersion: "programmable.explore-valuation-snapshot.v1",
    chainId: 1,
    blockNumber: input.snapshot.blockNumber,
    blockHash: input.snapshot.blockHash.toLowerCase(),
    liquidityBlockNumber: input.snapshot.liquidityBlockNumber,
    liquidityBlockHash: input.snapshot.liquidityBlockHash.toLowerCase(),
    sort: input.sort,
    query: input.query,
    socials: input.socials,
    pageSize: input.pageSize,
    total: ordered.length,
    ranking,
  }), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

function matchingRankingCommitment(
  supplied: `sha256:${string}`,
  expected: `sha256:${string}`,
) {
  const suppliedBytes = Buffer.from(supplied.slice(7), "hex");
  const expectedBytes = Buffer.from(expected.slice(7), "hex");
  return suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes);
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

function hasTemporaryMarketSourceFailure(
  entries: readonly ValuedExploreEntry[],
): boolean {
  return entries.some((entry) =>
    entry.valuation.status === "unavailable" &&
    entry.valuation.reason === "source-unavailable"
  );
}

function exploreResponseCacheControl(input: Readonly<{
  dataQuality: ReturnType<typeof buildExploreDataQuality>;
  entries: readonly ValuedExploreEntry[];
  status: "ready" | "not-deployed";
}>): string {
  // Do not cache a degraded source read. Known stale or unavailable market
  // observations remain honest in the payload and are safe to reuse briefly.
  if (
    input.dataQuality.launchIdentity.status !== "current" ||
    hasTemporaryMarketSourceFailure(input.entries)
  ) {
    return "no-store";
  }
  return input.status === "ready"
    ? "public, max-age=0, s-maxage=2, stale-while-revalidate=5"
    : "public, max-age=0, s-maxage=30";
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
  }>,
) {
  const filtered = filterExploreEntries(entries, input.query, input.socials);
  return paginateEntries(sortExploreEntries(filtered, input.sort), input);
}

async function valueExplorePage(input: Readonly<{
  identityEntries: readonly ExploreEntry[];
  options: Readonly<{
    page: number;
    pageSize: number;
    query: string;
    socials: "yes" | "no" | null;
    sort: ExploreSort;
  }>;
  signal: AbortSignal;
  deployment: ReturnType<typeof currentMarketOnchainDeployment> | null;
  operationalSnapshot: Promise<CurrentEvidenceSnapshotOutcome>;
  currentEvidenceDeadlineAt: number;
  requestedSnapshot?: RequestedExploreValuationSnapshotV1;
}>) {
  const requiresGlobalMarketRanking =
    requiresCompleteCurrentValuation(input.options.sort);
  const identityPage = requiresGlobalMarketRanking
    ? null
    : paginateExploreEntriesV1(input.identityEntries, {
        ...input.options,
        query: "",
        socials: null,
      });
  const entriesToValue = identityPage?.tokens ?? input.identityEntries;
  if (requiresGlobalMarketRanking) {
    const operationalSnapshotOutcome = await input.operationalSnapshot;
    if (operationalSnapshotOutcome.status === "rejected") {
      throw operationalSnapshotOutcome.error;
    }
    const operationalSnapshot = operationalSnapshotOutcome.value;
    if (!operationalSnapshot) {
      throw new Error("Current market evidence snapshot is unavailable");
    }
    const hydratedEntries = await hydrateMissingCanonicalTokenSupplyV1(
      entriesToValue,
      {
        deployment: input.deployment ?? undefined,
        snapshot: {
          blockNumber: operationalSnapshot.blockNumber,
          blockHash: operationalSnapshot.blockHash,
        },
      },
    );
    const currentValuation = await valueExploreEntriesWithCurrentEvidenceSnapshot({
      entries: hydratedEntries,
      marketByToken: new Map(),
      deployment: input.deployment,
      operationalSnapshot,
      maximumValuationAgeMs: EXPLORE_MAXIMUM_STALE_VALUATION_AGE_MS,
      now: new Date(),
      ...(input.requestedSnapshot
        ? {
            liquiditySnapshot:
              input.requestedSnapshot.liquidityBlockNumber === "none"
                ? {
                    chainId: 1 as const,
                    blockNumber: "none" as const,
                    blockHash: "none" as const,
                  }
                : {
                    chainId: 1 as const,
                    blockNumber:
                      input.requestedSnapshot.liquidityBlockNumber,
                    blockHash: input.requestedSnapshot.liquidityBlockHash as
                      `0x${string}`,
                  },
          }
        : {}),
      timeoutMs: Math.max(0, input.currentEvidenceDeadlineAt - Date.now()),
      signal: input.signal,
    });
    const currentEntries = currentValuation.entries;
    const currentPage = paginateExploreEntriesV1(currentEntries, {
      ...input.options,
      query: "",
      socials: null,
    });
    const rankingCommitment = exploreRankingCommitment(currentEntries, {
      snapshot: {
        ...operationalSnapshot,
        liquidityBlockNumber: currentValuation.liquiditySnapshot.blockNumber,
        liquidityBlockHash: currentValuation.liquiditySnapshot.blockHash,
      },
      sort: input.options.sort,
      query: input.options.query,
      socials: input.options.socials,
      pageSize: currentPage.pageSize,
    });
    if (
      input.requestedSnapshot &&
      !matchingRankingCommitment(
        input.requestedSnapshot.rankingCommitment,
        rankingCommitment,
      )
    ) throw new Error("Explore ranking snapshot changed");
    if (
      input.requestedSnapshot &&
      input.options.page > currentPage.totalPages
    ) throw new Error("Explore ranking page is outside the snapshot");
    const marketByToken = readBitqueryTokenMarketDataV1(
      exploreEntriesMarketIdentitiesV1(currentPage.tokens),
      { signal: input.signal },
    );
    const pageEntries = await attachBitqueryMarketDataToValuedEntries({
      entries: currentPage.tokens as ValuedExploreEntry[],
      marketByToken,
      maximumValuationAgeMs: EXPLORE_MAXIMUM_STALE_VALUATION_AGE_MS,
      now: new Date(),
    });
    return {
      entries: currentEntries,
      paginated: { ...currentPage, tokens: pageEntries },
      valuationSnapshot: {
        schemaVersion: "programmable.explore-valuation-snapshot.v1" as const,
        chainId: 1 as const,
        blockNumber: operationalSnapshot.blockNumber,
        blockHash: operationalSnapshot.blockHash,
        liquidityBlockNumber: currentValuation.liquiditySnapshot.blockNumber,
        liquidityBlockHash: currentValuation.liquiditySnapshot.blockHash,
        rankingCommitment,
        sort: input.options.sort as "market-cap" | "market-cap-asc",
        query: input.options.query,
        socials: input.options.socials,
        pageSize: currentPage.pageSize,
      },
    };
  }
  const marketByToken = readBitqueryTokenMarketDataV1(
    exploreEntriesMarketIdentitiesV1(entriesToValue),
    { signal: input.signal },
  );
  const hydratedEntries = await hydrateMissingCanonicalTokenSupplyV1(
    entriesToValue,
  );
  const valuedEntries = await valueExploreEntriesWithCurrentEvidence({
    entries: hydratedEntries,
    marketByToken,
    deployment: input.deployment,
    operationalSnapshot: input.operationalSnapshot,
    maximumValuationAgeMs: EXPLORE_MAXIMUM_STALE_VALUATION_AGE_MS,
    now: new Date(),
    requireCompleteLiquidityCoverage: false,
    timeoutMs: Math.max(0, input.currentEvidenceDeadlineAt - Date.now()),
    signal: input.signal,
  });
  if (identityPage === null) {
    throw new Error("Explore identity page is unavailable");
  }
  return {
    entries: valuedEntries,
    paginated: { ...identityPage, tokens: valuedEntries },
    valuationSnapshot: undefined,
  };
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
    const replaySnapshot = requestedValuationSnapshot(search, options);
    if (replaySnapshot === null) {
      return NextResponse.json(
        { error: "A complete valuation snapshot is required" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
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
    const deployment = getOnchainDeployment("production");
    const currentMarketDeployment = deployment.status === "ready"
      ? currentMarketOnchainDeployment(deployment)
      : null;
    const [
      canonicalAttempt,
      customAttempt,
      referenceHead,
    ] = await Promise.all([
      canonicalRead,
      customRead,
      readExploreReferenceHeadWithinRouteBudget(),
    ]);
    // Identity discovery has its own bounded reads. Start the current-market
    // budget only after those reads settle so a cold canonical cache cannot
    // consume the entire StateView, Chainlink and official-v4 evidence window
    // before the evidence operation begins.
    const currentEvidenceDeadlineAt =
      Date.now() + CURRENT_EVIDENCE_ROUTE_DEADLINE_MS;
    const requireCompleteCurrentValuation =
      requiresCompleteCurrentValuation(options.sort);
    const operationalSnapshotRead = currentMarketDeployment
      ? settleCurrentEvidenceSnapshot({
          read: (signal) => readVerifiedOperationalMarketSnapshot(
            currentMarketDeployment,
            replaySnapshot
              ? {
                  blockNumber: replaySnapshot.blockNumber,
                  blockHash: replaySnapshot.blockHash,
                }
              : undefined,
            { signal },
          ),
          requireComplete: requireCompleteCurrentValuation,
          timeoutMs: CURRENT_EVIDENCE_ROUTE_DEADLINE_MS,
          signal: request.signal,
        })
      : Promise.resolve(null);
    // Attach a rejection handler immediately; global ranking rethrows the
    // settled error inside the valuation orchestrator rather than leaking an
    // unhandled promise.
    const operationalSnapshotOutcome = operationalSnapshotRead.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
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
    assertNoExploreCategoryCollision(unresolvedIdentityEntries);
    const requestedIdentityEntries = filterExploreEntries(
      unresolvedIdentityEntries,
      options.query,
      options.socials,
    );
    const { entries, paginated, valuationSnapshot } = await valueExplorePage({
      identityEntries: requestedIdentityEntries,
      options,
      signal: request.signal,
      deployment: currentMarketDeployment,
      operationalSnapshot: operationalSnapshotOutcome,
      currentEvidenceDeadlineAt,
      requestedSnapshot: replaySnapshot,
    });
    const pageEntries = paginated.tokens as ValuedExploreEntry[];
    const currentOnchainEntry = pageEntries.find(
      (entry) => entry.valuation.status === "available" &&
        entry.valuation.source === "stateview-chainlink" &&
        entry.valuation.freshness === "current",
    );
    const currentOnchainValuation =
      currentOnchainEntry?.valuation.status === "available"
        ? currentOnchainEntry.valuation
        : null;

    const sourceAges = [canonicalSource?.ageMs, customSource?.ageMs].filter(
      (value): value is number => value !== undefined,
    );
    const dataQuality = buildExploreDataQuality({
      entries: pageEntries,
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
    if (canonicalSource === null && unresolvedIdentityEntries.length === 0) {
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
      ...(valuationSnapshot ? { valuationSnapshot } : {}),
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
            exploreResponseCacheControl({
              dataQuality,
              entries: pageEntries,
              status: page.status,
            }),
          "X-Programmable-Data-Quality": dataQuality.status,
          "X-Programmable-Market-Source": currentOnchainValuation
            ? "stateview-chainlink+official-uniswap-v4-subgraph+bitquery"
            : "bitquery",
          ...(dataQuality.valuation.asOfTime
            ? {
                "X-Programmable-Market-As-Of":
                  dataQuality.valuation.asOfTime,
              }
            : {}),
          ...(currentOnchainValuation?.status === "available"
            ? {
                "X-Programmable-Price-Source": "stateview-chainlink",
                "X-Programmable-Valuation-Block":
                  currentOnchainValuation.asOfBlock ?? "",
              }
            : hasVerifiedBitqueryPrice(pageEntries)
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
