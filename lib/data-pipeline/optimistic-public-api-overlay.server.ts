import "server-only";

import { formatUnits, getAddress, isAddress, type Hex } from "viem";

import {
  paginateExplore,
  type ExploreSocialFilter,
} from "../onchain/query";
import type {
  ExplorePage,
  ExploreReadModel,
  ExploreSnapshot,
  ExploreSort,
} from "../onchain/types";
import type { LauncherToken } from "../tokens";
import type { IndexedFeedSnapshot } from "../../app/api/indexers/v1/response";
import {
  mergeOptimisticTokenCorpus,
  optimisticOverlayHeaders,
  selectEligibleOptimisticOverlay,
  withOptimisticOverlayDisclosure,
  type OptimisticOverlayDisclosure,
  type OptimisticOverlayRow,
  type OptimisticTokenCorpusResult,
} from "./optimistic-read-overlay.server";

export const OPTIMISTIC_PUBLIC_API_SNAPSHOT_VERSION =
  "optimistic-public-api-snapshot-v1" as const;

const MAXIMUM_LIVE_HEAD_AGE_MS = 60_000;
const MAXIMUM_LIVE_HEAD_CLOCK_SKEW_MS = 30_000;
const LIVE_BLOCK_WINDOW = 12n;
const MAXIMUM_PUBLIC_OVERLAY_ROWS = 7_200;
const BYTES_32 = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(?:0|[1-9]\d*)$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type OptimisticPublicReleaseVersion =
  | "classic-v2"
  | "classic-v3"
  | "stock-paired-v1"
  | "stock-paired-v2"
  | "stock-paired-v3";

const PUBLIC_RELEASE_VERSIONS: ReadonlySet<string> = new Set([
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
]);

export type PersistedOptimisticPublicRow = Readonly<{
  reorgGeneration: string;
  providerHeads: readonly [string, string];
  releaseVersion: OptimisticPublicReleaseVersion;
  optimisticMarketStateId: string | null;
  row: OptimisticOverlayRow;
}>;

export type PersistedOptimisticPublicBlock = Readonly<{
  blockNumber: string;
  blockHash: Hex;
  parentHash: Hex;
  reorgGeneration: string;
}>;

/**
 * Narrow boundary between the public routes and the persisted live reader.
 * The production adapter must build this value from one repeatable-read
 * snapshot of the current canonical optimistic segment; webhook payloads and
 * transient process memory are not valid implementations of this port.
 */
export type PersistedOptimisticPublicSnapshot = Readonly<{
  version: typeof OPTIMISTIC_PUBLIC_API_SNAPSHOT_VERSION;
  source: "postgres-current-optimistic-chain";
  chainId: 1;
  head: Readonly<{
    blockNumber: string;
    blockHash: Hex;
    providerHeads: readonly [string, string];
    reorgGeneration: string;
    observedAt: string;
    canonicalAt: string;
  }>;
  blocks: readonly PersistedOptimisticPublicBlock[];
  rows: readonly PersistedOptimisticPublicRow[];
}>;

export type OptimisticPublicApiSnapshotSource = Readonly<{
  materialize(input: Readonly<{
    canonicalTokens: readonly LauncherToken[];
  }>): PersistedOptimisticPublicSnapshot;
}>;

export type OptimisticPublicApiReaderPort = Readonly<{
  read(chainId: 1): Promise<OptimisticPublicApiSnapshotSource | null>;
}>;

type JsonRecord = Record<string, unknown>;

type ChartPoint = Readonly<{
  blockNumber: string;
  priceEth: string;
  priceUsd?: string;
}>;

type CanonicalChartBody = Readonly<{
  status: "ready" | "insufficient-history";
  address: string;
  points: readonly ChartPoint[];
  swapCount: number;
  volumeWei: string;
  volumeEth: string;
  volumeUsdWad?: string;
  range: string;
  snapshotBlock: string;
  snapshotHash: Hex;
}>;

function canonicalUint(value: unknown): string | null {
  return typeof value === "string" && value.length <= 78 && UINT.test(value)
    ? value
    : null;
}

function canonicalBytes32(value: unknown): Hex | null {
  return typeof value === "string" && BYTES_32.test(value)
    ? (value.toLowerCase() as Hex)
    : null;
}

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function matchingCanonicalSnapshot(
  body: JsonRecord,
  feed: IndexedFeedSnapshot,
): boolean {
  const snapshot = record(body.snapshot);
  return (
    snapshot !== null &&
    canonicalUint(snapshot.blockNumber) === feed.model.snapshot.blockNumber &&
    canonicalBytes32(snapshot.blockHash) === feed.model.snapshot.blockHash
  );
}

async function responseJson(response: Response): Promise<JsonRecord | null> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  const parsed = await response.clone().json();
  return record(parsed);
}

function exactTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 128) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString() === value
    ? date.valueOf()
    : null;
}

function freshTimestamp(value: unknown, nowMs: number): boolean {
  const parsed = exactTimestamp(value);
  return (
    parsed !== null &&
    nowMs - parsed <= MAXIMUM_LIVE_HEAD_AGE_MS &&
    parsed - nowMs <= MAXIMUM_LIVE_HEAD_CLOCK_SKEW_MS
  );
}

function nonFutureTimestamp(value: unknown, nowMs: number): boolean {
  const parsed = exactTimestamp(value);
  return parsed !== null && parsed - nowMs <= MAXIMUM_LIVE_HEAD_CLOCK_SKEW_MS;
}

function validatedPersistedRows(input: Readonly<{
  snapshot: PersistedOptimisticPublicSnapshot;
  canonicalBlockNumber: string;
  canonicalBlockHash: string;
  nowMs: number;
  tokenAddress?: string;
}>): readonly OptimisticOverlayRow[] | null {
  const { snapshot } = input;
  const canonicalBlockNumber = canonicalUint(input.canonicalBlockNumber);
  const canonicalBlockHash = canonicalBytes32(input.canonicalBlockHash);
  const headNumber = canonicalUint(snapshot.head.blockNumber);
  const headHash = canonicalBytes32(snapshot.head.blockHash);
  const primaryHead = canonicalUint(snapshot.head.providerHeads[0]);
  const secondaryHead = canonicalUint(snapshot.head.providerHeads[1]);
  const reorgGeneration = canonicalUint(snapshot.head.reorgGeneration);
  const tokenAddress = input.tokenAddress && isAddress(input.tokenAddress)
    ? getAddress(input.tokenAddress).toLowerCase()
    : null;
  if (
    snapshot.version !== OPTIMISTIC_PUBLIC_API_SNAPSHOT_VERSION ||
    snapshot.source !== "postgres-current-optimistic-chain" ||
    snapshot.chainId !== 1 ||
    canonicalBlockNumber === null ||
    canonicalBlockHash === null ||
    headNumber === null ||
    headHash === null ||
    primaryHead === null ||
    secondaryHead === null ||
    reorgGeneration === null ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0 ||
    !freshTimestamp(snapshot.head.observedAt, input.nowMs) ||
    !freshTimestamp(snapshot.head.canonicalAt, input.nowMs) ||
    !Array.isArray(snapshot.blocks) ||
    snapshot.blocks.length < 1 ||
    snapshot.blocks.length > Number(LIVE_BLOCK_WINDOW) ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length > MAXIMUM_PUBLIC_OVERLAY_ROWS
  ) {
    return null;
  }

  const head = BigInt(headNumber);
  const canonical = BigInt(canonicalBlockNumber);
  const lowestHeadProvider = BigInt(primaryHead) < BigInt(secondaryHead)
    ? BigInt(primaryHead)
    : BigInt(secondaryHead);
  if (
    head <= canonical ||
    lowestHeadProvider < head ||
    head - canonical > LIVE_BLOCK_WINDOW
  ) {
    return null;
  }
  let anchorMatched = false;
  const blockHashes = new Map<string, Hex>();
  for (let index = 0; index < snapshot.blocks.length; index += 1) {
    const block = snapshot.blocks[index]!;
    const blockNumber = canonicalUint(block.blockNumber);
    const blockHash = canonicalBytes32(block.blockHash);
    const parentHash = canonicalBytes32(block.parentHash);
    if (
      blockNumber === null ||
      blockHash === null ||
      parentHash === null ||
      canonicalUint(block.reorgGeneration) !== reorgGeneration
    ) {
      return null;
    }
    if (blockHashes.has(blockNumber)) return null;
    blockHashes.set(blockNumber, blockHash);
    if (index > 0) {
      const previous = snapshot.blocks[index - 1]!;
      if (
        BigInt(blockNumber) !== BigInt(previous.blockNumber) + 1n ||
        parentHash !== canonicalBytes32(previous.blockHash)
      ) {
        return null;
      }
    }
    if (
      blockNumber === canonicalBlockNumber &&
      blockHash === canonicalBlockHash
    ) {
      anchorMatched = true;
    }
  }
  const oldest = snapshot.blocks[0]!;
  const newest = snapshot.blocks.at(-1)!;
  const oldestNumber = BigInt(oldest.blockNumber);
  if (
    !anchorMatched &&
    oldestNumber > 0n &&
    canonical === oldestNumber - 1n &&
    canonicalBlockHash === canonicalBytes32(oldest.parentHash)
  ) {
    anchorMatched = true;
  }
  if (
    !anchorMatched ||
    newest.blockNumber !== headNumber ||
    canonicalBytes32(newest.blockHash) !== headHash
  ) {
    return null;
  }
  const firstLiveBlock = head >= LIVE_BLOCK_WINDOW - 1n
    ? head - (LIVE_BLOCK_WINDOW - 1n)
    : 0n;
  const rows: OptimisticOverlayRow[] = [];
  for (const entry of snapshot.rows) {
    const rowNumber = canonicalUint(entry.row.evidence.blockNumber);
    const rowHash = canonicalBytes32(entry.row.evidence.blockHash);
    const evidenceCommitment = canonicalBytes32(
      entry.row.evidenceCommitment,
    );
    const rowProviderHeads = Array.isArray(entry.providerHeads)
      ? entry.providerHeads
      : [];
    const rowPrimaryHead = canonicalUint(rowProviderHeads[0]);
    const rowSecondaryHead = canonicalUint(rowProviderHeads[1]);
    const confirmations = entry.row.evidence.confirmations;
    if (
      canonicalUint(entry.reorgGeneration) !== reorgGeneration ||
      !PUBLIC_RELEASE_VERSIONS.has(entry.releaseVersion) ||
      (entry.row.kind === "market"
        ? typeof entry.optimisticMarketStateId !== "string" ||
          !UUID.test(entry.optimisticMarketStateId)
        : entry.optimisticMarketStateId !== null) ||
      rowNumber === null ||
      rowHash === null ||
      evidenceCommitment === null ||
      BigInt(evidenceCommitment) === 0n ||
      rowProviderHeads.length !== 2 ||
      rowPrimaryHead === null ||
      rowSecondaryHead === null ||
      BigInt(rowNumber) < firstLiveBlock ||
      BigInt(rowNumber) > head ||
      blockHashes.get(rowNumber) !== rowHash ||
      !Number.isSafeInteger(confirmations) ||
      confirmations < 0 ||
      confirmations > 11 ||
      (BigInt(rowPrimaryHead) < BigInt(rowSecondaryHead)
          ? BigInt(rowPrimaryHead)
          : BigInt(rowSecondaryHead)) - BigInt(rowNumber) !==
        BigInt(confirmations) ||
      !nonFutureTimestamp(entry.row.evidence.observedAt, input.nowMs)
    ) {
      return null;
    }
    if (BigInt(rowNumber) <= canonical) continue;
    if (
      tokenAddress &&
      (typeof entry.row.tokenAddress !== "string" ||
        entry.row.tokenAddress.toLowerCase() !== tokenAddress)
    ) {
      continue;
    }
    rows.push(entry.row);
  }
  return Object.freeze(rows);
}

function withCanonicalUsdValuation(input: Readonly<{
  rows: readonly OptimisticOverlayRow[];
  canonicalTokens: readonly LauncherToken[];
  quote: ExploreSnapshot["ethUsdQuote"];
  nowMs: number;
}>): readonly OptimisticOverlayRow[] {
  const quote = input.quote;
  const roundId = canonicalUint(quote?.roundId);
  const answer = canonicalUint(quote?.answer);
  if (
    !quote ||
    !isAddress(quote.feedAddress) ||
    roundId === null ||
    answer === null ||
    BigInt(roundId) <= 0n ||
    BigInt(answer) <= 0n ||
    !Number.isSafeInteger(quote.decimals) ||
    quote.decimals < 0 ||
    quote.decimals > 36 ||
    !nonFutureTimestamp(quote.updatedAt, input.nowMs)
  ) {
    return Object.freeze(
      input.rows.filter((row) => row.kind !== "market"),
    );
  }
  const modelsByPool = new Map<string, LauncherToken["launchModel"]>(
    input.canonicalTokens.map((token) => [
      token.poolId.toLowerCase(),
      token.launchModel,
    ]),
  );
  for (const row of input.rows) {
    if (row.kind === "launch") {
      modelsByPool.set(row.poolId.toLowerCase(), row.token.launchModel);
    }
  }
  const scale = 10n ** BigInt(quote.decimals);
  const valued: OptimisticOverlayRow[] = [];
  for (const row of input.rows) {
    if (row.kind === "launch") {
      valued.push(row);
      continue;
    }
    if (modelsByPool.get(row.poolId.toLowerCase()) !== "classic") continue;
    const priceEthWei = canonicalUint(row.market.tokenPriceEthWei);
    const marketCapEthWei = canonicalUint(
      row.market.indexedMarketCapEthWei ?? row.market.marketCapEthWei,
    );
    if (
      priceEthWei === null ||
      marketCapEthWei === null ||
      BigInt(priceEthWei) <= 0n ||
      BigInt(marketCapEthWei) <= 0n
    ) {
      continue;
    }
    const tokenPriceUsdWad =
      (BigInt(priceEthWei) * BigInt(answer)) / scale;
    const indexedMarketCapUsdWad =
      (BigInt(marketCapEthWei) * BigInt(answer)) / scale;
    if (
      tokenPriceUsdWad <= 0n ||
      indexedMarketCapUsdWad <= 0n ||
      tokenPriceUsdWad.toString().length > 78 ||
      indexedMarketCapUsdWad.toString().length > 78
    ) {
      continue;
    }
    valued.push(Object.freeze({
      ...row,
      market: Object.freeze({
        ...row.market,
        tokenPriceUsdWad: tokenPriceUsdWad.toString(),
        indexedMarketCapUsdWad: indexedMarketCapUsdWad.toString(),
      }),
    }));
  }
  return Object.freeze(valued);
}

function releaseVersionForToken(
  token: LauncherToken,
): OptimisticPublicReleaseVersion | null {
  if (
    token.launchModelVersion &&
    PUBLIC_RELEASE_VERSIONS.has(token.launchModelVersion)
  ) {
    return token.launchModelVersion as OptimisticPublicReleaseVersion;
  }
  return token.launchModel === "classic" ? "classic-v2" : null;
}

function bindPersistedDisclosure(input: Readonly<{
  result: OptimisticTokenCorpusResult;
  snapshot: PersistedOptimisticPublicSnapshot;
}>): OptimisticTokenCorpusResult | null {
  const applied = [] as OptimisticOverlayDisclosure["applied"][number][];
  for (const row of input.result.disclosure.applied) {
    const matches = input.snapshot.rows.filter((entry) =>
      entry.row.kind === row.kind &&
      entry.row.evidence.blockNumber === row.blockNumber &&
      entry.row.evidence.blockHash.toLowerCase() === row.blockHash.toLowerCase() &&
      entry.row.poolId.toLowerCase() === row.poolId.toLowerCase() &&
      entry.row.tokenAddress.toLowerCase() === row.tokenAddress.toLowerCase() &&
      entry.row.event.transactionHash.toLowerCase() ===
        row.event.transactionHash.toLowerCase() &&
      entry.row.event.logIndex === row.event.logIndex &&
      entry.row.evidenceCommitment.toLowerCase() ===
        row.evidenceCommitment.toLowerCase());
    if (matches.length !== 1) return null;
    const persisted = matches[0]!;
    const token = input.result.tokens.find((candidate) =>
      candidate.poolId.toLowerCase() === row.poolId.toLowerCase() &&
      candidate.tokenAddress.toLowerCase() === row.tokenAddress.toLowerCase());
    if (
      !token ||
      releaseVersionForToken(token) !== persisted.releaseVersion ||
      canonicalUint(persisted.reorgGeneration) === null ||
      (row.kind === "market"
        ? !persisted.optimisticMarketStateId ||
          !UUID.test(persisted.optimisticMarketStateId)
        : persisted.optimisticMarketStateId !== null)
    ) {
      return null;
    }
    applied.push(Object.freeze({
      ...row,
      releaseVersion: persisted.releaseVersion,
      reorgGeneration: persisted.reorgGeneration,
      ...(persisted.optimisticMarketStateId
        ? { optimisticMarketStateId: persisted.optimisticMarketStateId }
        : {}),
    }));
  }
  return Object.freeze({
    ...input.result,
    disclosure: Object.freeze({
      ...input.result.disclosure,
      applied: Object.freeze(applied),
    }),
  });
}

/**
 * Applies only fresh, current-chain, repeatable-read evidence. Invalid or
 * inactive snapshots return null so callers can preserve their canonical
 * response byte-for-byte.
 */
export function applyPersistedOptimisticCorpus(input: Readonly<{
  canonicalTokens: readonly LauncherToken[];
  canonicalBlockNumber: string;
  canonicalBlockHash: string;
  canonicalEthUsdQuote?: ExploreSnapshot["ethUsdQuote"];
  snapshot: PersistedOptimisticPublicSnapshot;
  nowMs?: number;
  tokenAddress?: string;
}>): OptimisticTokenCorpusResult | null {
  const rows = validatedPersistedRows({
    snapshot: input.snapshot,
    canonicalBlockNumber: input.canonicalBlockNumber,
    canonicalBlockHash: input.canonicalBlockHash,
    nowMs: input.nowMs ?? Date.now(),
    ...(input.tokenAddress ? { tokenAddress: input.tokenAddress } : {}),
  });
  if (!rows || rows.length === 0) return null;
  const valuedRows = withCanonicalUsdValuation({
    rows,
    canonicalTokens: input.canonicalTokens,
    quote: input.canonicalEthUsdQuote,
    nowMs: input.nowMs ?? Date.now(),
  });
  if (valuedRows.length === 0) return null;
  const merged = mergeOptimisticTokenCorpus({
    canonicalTokens: input.canonicalTokens,
    overlay: selectEligibleOptimisticOverlay({ rows: valuedRows, chainId: 1 }),
  });
  if (!merged.disclosure.active) return null;
  return bindPersistedDisclosure({ result: merged, snapshot: input.snapshot });
}

export function buildOptimisticExplorePage(input: Readonly<{
  canonicalModel: ExploreReadModel & { status: "ready" };
  options: Readonly<{
    query: string;
    sort: ExploreSort;
    page: number;
    pageSize: number;
    socials: ExploreSocialFilter | null;
  }>;
  snapshot: PersistedOptimisticPublicSnapshot;
  nowMs?: number;
}>): (ExplorePage & { optimisticOverlay: OptimisticOverlayDisclosure }) | null {
  const result = applyPersistedOptimisticCorpus({
    canonicalTokens: input.canonicalModel.tokens,
    canonicalBlockNumber: input.canonicalModel.snapshot.blockNumber,
    canonicalBlockHash: input.canonicalModel.snapshot.blockHash,
    canonicalEthUsdQuote: input.canonicalModel.snapshot.ethUsdQuote,
    snapshot: input.snapshot,
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  if (!result) return null;
  const page = paginateExplore(
    { ...input.canonicalModel, tokens: [...result.tokens] },
    input.options,
  );
  return withOptimisticOverlayDisclosure(page, result.disclosure);
}

export function buildOptimisticTokenDetail(input: Readonly<{
  canonicalModel: ExploreReadModel & { status: "ready" };
  address: string;
  snapshot: PersistedOptimisticPublicSnapshot;
  nowMs?: number;
}>): Readonly<{
  status: "ready";
  token: LauncherToken;
  snapshot: (ExploreReadModel & { status: "ready" })["snapshot"];
  optimisticOverlay: OptimisticOverlayDisclosure;
}> | null {
  if (!isAddress(input.address)) return null;
  const address = getAddress(input.address);
  const result = applyPersistedOptimisticCorpus({
    canonicalTokens: input.canonicalModel.tokens,
    canonicalBlockNumber: input.canonicalModel.snapshot.blockNumber,
    canonicalBlockHash: input.canonicalModel.snapshot.blockHash,
    canonicalEthUsdQuote: input.canonicalModel.snapshot.ethUsdQuote,
    snapshot: input.snapshot,
    tokenAddress: address,
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  if (!result) return null;
  const token = result.tokens.find(
    (candidate) =>
      candidate.tokenAddress.toLowerCase() === address.toLowerCase(),
  );
  if (!token) return null;
  return withOptimisticOverlayDisclosure(
    {
      status: "ready" as const,
      token,
      snapshot: input.canonicalModel.snapshot,
    },
    result.disclosure,
  );
}

function disclosureForRows(
  disclosure: OptimisticOverlayDisclosure,
  rows: OptimisticOverlayDisclosure["applied"],
): OptimisticOverlayDisclosure {
  return Object.freeze({
    ...disclosure,
    active: rows.length > 0,
    finality:
      new Set(rows.map((row) => row.finality)).size > 1
        ? "mixed"
        : rows[0]?.finality ?? "safe",
    applied: Object.freeze([...rows]),
  });
}

export function appendOrReplaceOptimisticChartPoint(
  points: readonly ChartPoint[],
  point: ChartPoint,
): readonly ChartPoint[] | null {
  const pointBlock = canonicalUint(point.blockNumber);
  if (pointBlock === null) return null;
  const last = points.at(-1);
  const lastBlock = last ? canonicalUint(last.blockNumber) : null;
  if (last && lastBlock === null) return null;
  if (lastBlock !== null && BigInt(lastBlock) > BigInt(pointBlock)) return null;
  const merged = [...points];
  if (lastBlock === pointBlock) merged[merged.length - 1] = point;
  else merged.push(point);
  if (merged.length <= 80) return Object.freeze(merged);
  const sampled: ChartPoint[] = [];
  const lastIndex = merged.length - 1;
  for (let index = 0; index < 80; index += 1) {
    sampled.push(merged[Math.round((index * lastIndex) / 79)]!);
  }
  return Object.freeze(sampled);
}

export function buildOptimisticClassicChart(input: Readonly<{
  canonicalTokens: readonly LauncherToken[];
  canonicalBlockNumber: string;
  canonicalBlockHash: string;
  canonicalEthUsdQuote?: ExploreSnapshot["ethUsdQuote"];
  canonicalBody: CanonicalChartBody;
  address: string;
  snapshot: PersistedOptimisticPublicSnapshot;
  nowMs?: number;
}>): (CanonicalChartBody & {
  optimisticOverlay: OptimisticOverlayDisclosure;
}) | null {
  if (!isAddress(input.address)) return null;
  const address = getAddress(input.address);
  const result = applyPersistedOptimisticCorpus({
    canonicalTokens: input.canonicalTokens,
    canonicalBlockNumber: input.canonicalBlockNumber,
    canonicalBlockHash: input.canonicalBlockHash,
    canonicalEthUsdQuote: input.canonicalEthUsdQuote,
    snapshot: input.snapshot,
    tokenAddress: address,
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  if (!result) return null;
  const token = result.tokens.find(
    (candidate) =>
      candidate.tokenAddress.toLowerCase() === address.toLowerCase(),
  );
  if (token?.launchModel !== "classic") return null;
  const marketRows = result.disclosure.applied
    .filter(
      (row) =>
        row.kind === "market" &&
        row.tokenAddress.toLowerCase() === address.toLowerCase(),
    )
    .sort((left, right) => {
      const difference = BigInt(right.blockNumber) - BigInt(left.blockNumber);
      return difference === 0n ? 0 : difference > 0n ? 1 : -1;
    });
  const marketRow = marketRows[0];
  if (!marketRow) return null;
  const persistedMarketRow = input.snapshot.rows.find((entry) => {
    const row = entry.row;
    return (
      row.kind === "market" &&
      row.evidence.blockNumber === marketRow.blockNumber &&
      row.evidence.blockHash.toLowerCase() === marketRow.blockHash.toLowerCase() &&
      row.poolId.toLowerCase() === marketRow.poolId.toLowerCase() &&
      row.tokenAddress.toLowerCase() === marketRow.tokenAddress.toLowerCase() &&
      row.event.transactionHash.toLowerCase() ===
        marketRow.event.transactionHash.toLowerCase() &&
      row.event.logIndex === marketRow.event.logIndex
    );
  })?.row;
  if (!persistedMarketRow || persistedMarketRow.kind !== "market") return null;
  const priceWei = canonicalUint(persistedMarketRow.market.tokenPriceEthWei);
  if (priceWei === null || BigInt(priceWei) <= 0n) return null;

  const point: ChartPoint = Object.freeze({
    blockNumber: marketRow.blockNumber,
    priceEth: formatUnits(BigInt(priceWei), 18),
    ...(canonicalUint(token.tokenPriceUsdWad)
      ? {
          priceUsd: formatUnits(
            BigInt(token.tokenPriceUsdWad!),
            18,
          ),
        }
      : {}),
  });
  const sampled = appendOrReplaceOptimisticChartPoint(
    input.canonicalBody.points,
    point,
  );
  if (!sampled) return null;
  const volumeWei = canonicalUint(persistedMarketRow.market.grossVolumeWei);
  const swapCount = persistedMarketRow.market.swapCount;
  const {
    volumeUsdWad: _canonicalVolumeUsdWad,
    ...canonicalWithoutVolumeUsd
  } = input.canonicalBody;
  void _canonicalVolumeUsdWad;
  const disclosure = disclosureForRows(result.disclosure, marketRows);
  if (!disclosure.active) return null;
  return withOptimisticOverlayDisclosure(
    {
      ...(volumeWei === null
        ? input.canonicalBody
        : canonicalWithoutVolumeUsd),
      status:
        sampled.length >= 2
          ? ("ready" as const)
          : ("insufficient-history" as const),
      address,
      points: sampled,
      ...(swapCount === undefined ? {} : { swapCount }),
      ...(volumeWei === null
        ? {}
        : {
            volumeWei,
            volumeEth: formatUnits(BigInt(volumeWei), 18),
          }),
      snapshotBlock: marketRow.blockNumber,
      snapshotHash: marketRow.blockHash,
    },
    disclosure,
  );
}

export function responseWithOptimisticOverlay<T extends object>(
  canonical: Response,
  body: T & { optimisticOverlay: OptimisticOverlayDisclosure },
  status = canonical.status,
): Response {
  if (!body.optimisticOverlay.active) return canonical;
  const headers = new Headers(canonical.headers);
  headers.set("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(
    optimisticOverlayHeaders(body.optimisticOverlay),
  )) {
    headers.set(name, value);
  }
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

export async function overlayExploreCanonicalResponse(input: Readonly<{
  canonical: Response;
  feed: IndexedFeedSnapshot;
  source: OptimisticPublicApiSnapshotSource;
  options: Readonly<{
    query: string;
    sort: ExploreSort;
    page: number;
    pageSize: number;
    socials: ExploreSocialFilter | null;
  }>;
  nowMs?: number;
}>): Promise<Response> {
  try {
    if (input.canonical.status !== 200) return input.canonical;
    const body = await responseJson(input.canonical);
    if (
      !body ||
      body.status !== "ready" ||
      !matchingCanonicalSnapshot(body, input.feed)
    ) {
      return input.canonical;
    }
    const snapshot = input.source.materialize({
      canonicalTokens: input.feed.model.tokens,
    });
    const page = buildOptimisticExplorePage({
      canonicalModel: {
        ...input.feed.model,
        launcherFeesAccruedWei:
          typeof body.launcherFeesAccruedWei === "string"
            ? body.launcherFeesAccruedWei
            : input.feed.model.launcherFeesAccruedWei,
        launcherFeesAccruedEth:
          typeof body.launcherFeesAccruedEth === "string"
            ? body.launcherFeesAccruedEth
            : input.feed.model.launcherFeesAccruedEth,
      },
      options: input.options,
      snapshot,
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    });
    return page
      ? responseWithOptimisticOverlay(input.canonical, page)
      : input.canonical;
  } catch {
    return input.canonical;
  }
}

export async function overlayTokenDetailCanonicalResponse(input: Readonly<{
  canonical: Response;
  feed: IndexedFeedSnapshot;
  source: OptimisticPublicApiSnapshotSource;
  address: string;
  nowMs?: number;
}>): Promise<Response> {
  try {
    if (input.canonical.status !== 200 && input.canonical.status !== 404) {
      return input.canonical;
    }
    const body = await responseJson(input.canonical);
    if (
      !body ||
      body.status !== "ready" ||
      !matchingCanonicalSnapshot(body, input.feed)
    ) {
      return input.canonical;
    }
    const snapshot = input.source.materialize({
      canonicalTokens: input.feed.model.tokens,
    });
    const detail = buildOptimisticTokenDetail({
      canonicalModel: input.feed.model,
      address: input.address,
      snapshot,
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    });
    return detail
      ? responseWithOptimisticOverlay(input.canonical, detail, 200)
      : input.canonical;
  } catch {
    return input.canonical;
  }
}

function canonicalChartBody(
  value: JsonRecord | null,
  input: Readonly<{
    address: string;
    range: string;
    snapshotBlock: string;
    snapshotHash: Hex;
  }>,
): CanonicalChartBody | null {
  if (!value) return null;
  if (
    value.status !== "ready" &&
    value.status !== "insufficient-history"
  ) {
    return null;
  }
  if (
    !Array.isArray(value.points) ||
    typeof value.address !== "string" ||
    value.address.toLowerCase() !== input.address.toLowerCase() ||
    value.range !== input.range ||
    canonicalUint(value.snapshotBlock) !== input.snapshotBlock ||
    canonicalBytes32(value.snapshotHash) !== input.snapshotHash ||
    typeof value.swapCount !== "number" ||
    !Number.isSafeInteger(value.swapCount) ||
    value.swapCount < 0 ||
    canonicalUint(value.volumeWei) === null ||
    typeof value.volumeEth !== "string"
  ) {
    return null;
  }
  const points: ChartPoint[] = [];
  for (const valuePoint of value.points) {
    const point = record(valuePoint);
    if (
      !point ||
      canonicalUint(point.blockNumber) === null ||
      typeof point.priceEth !== "string" ||
      (point.priceUsd !== undefined && typeof point.priceUsd !== "string")
    ) {
      return null;
    }
    points.push({
      blockNumber: point.blockNumber as string,
      priceEth: point.priceEth,
      ...(point.priceUsd === undefined
        ? {}
        : { priceUsd: point.priceUsd as string }),
    });
  }
  return Object.freeze({
    status: value.status,
    address: input.address,
    points: Object.freeze(points),
    swapCount: value.swapCount,
    volumeWei: value.volumeWei as string,
    volumeEth: value.volumeEth,
    ...(typeof value.volumeUsdWad === "string"
      ? { volumeUsdWad: value.volumeUsdWad }
      : {}),
    range: input.range,
    snapshotBlock: input.snapshotBlock,
    snapshotHash: input.snapshotHash as Hex,
  });
}

export async function overlayClassicChartCanonicalResponse(input: Readonly<{
  canonical: Response;
  feed: IndexedFeedSnapshot;
  source: OptimisticPublicApiSnapshotSource;
  address: string;
  range: string;
  nowMs?: number;
}>): Promise<Response> {
  try {
    if (input.canonical.status !== 200 && input.canonical.status !== 404) {
      return input.canonical;
    }
    const parsed = await responseJson(input.canonical);
    const canonicalBody = canonicalChartBody(parsed, {
      address: input.address,
      range: input.range,
      snapshotBlock: input.feed.model.snapshot.blockNumber,
      snapshotHash: input.feed.model.snapshot.blockHash,
    });
    const canonicalNotFound =
      input.canonical.status === 404 &&
      parsed?.error === "Token not found" &&
      canonicalUint(parsed.snapshotBlock) ===
        input.feed.model.snapshot.blockNumber &&
      canonicalBytes32(parsed.snapshotHash) ===
        input.feed.model.snapshot.blockHash;
    if (
      input.canonical.status === 200 && !canonicalBody ||
      input.canonical.status === 404 && !canonicalNotFound
    ) {
      return input.canonical;
    }
    const base: CanonicalChartBody = canonicalBody ?? {
      status: "insufficient-history",
      address: input.address,
      points: [],
      swapCount: 0,
      volumeWei: "0",
      volumeEth: "0",
      range: input.range,
      snapshotBlock: input.feed.model.snapshot.blockNumber,
      snapshotHash: input.feed.model.snapshot.blockHash,
    };
    const snapshot = input.source.materialize({
      canonicalTokens: input.feed.model.tokens,
    });
    const chart = buildOptimisticClassicChart({
      canonicalTokens: input.feed.model.tokens,
      canonicalBlockNumber: input.feed.model.snapshot.blockNumber,
      canonicalBlockHash: input.feed.model.snapshot.blockHash,
      canonicalEthUsdQuote: input.feed.model.snapshot.ethUsdQuote,
      canonicalBody: base,
      address: input.address,
      snapshot,
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    });
    return chart
      ? responseWithOptimisticOverlay(input.canonical, chart, 200)
      : input.canonical;
  } catch {
    return input.canonical;
  }
}
