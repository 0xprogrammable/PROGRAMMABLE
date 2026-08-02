import "server-only";

import { createHash } from "node:crypto";

import {
  bytes32FromBytea,
  canonicalAddress,
  canonicalBytes32,
  parseNonnegativeIntegerText,
} from "../../../../lib/data-pipeline/codecs";
import type { PostgresTransaction } from "../../../../lib/data-pipeline/postgres";
import { getServerReadModel } from "../../../../lib/data-pipeline/read-model.server";
import { serializeIndexerToken } from "../../../../lib/onchain/indexer-feed";
import type { ExploreSnapshot } from "../../../../lib/onchain/types";
import type {
  LauncherToken,
  TokenLink,
  TokenLinkKind,
} from "../../../../lib/tokens";
import type { IndexedFeedSnapshot } from "./response";

const CHAIN_ID = 1 as const;
const ROUTE_KEY = "explore-list";
const ADAPTER_VERSION = "indexed-route-adapters-v2";
const MAX_SNAPSHOT_AGE_MS = 10 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 30 * 1_000;
const MAX_PROJECTION_LAG_BLOCKS = 12n;

const RELEASE_SCOPES = Object.freeze([
  Object.freeze({ release: "classic-v2", model: "classic" }),
  Object.freeze({ release: "classic-v3", model: "classic" }),
  Object.freeze({ release: "stock-paired-v1", model: "stock-paired" }),
  Object.freeze({ release: "stock-paired-v2", model: "stock-paired" }),
  Object.freeze({ release: "stock-paired-v3", model: "stock-paired" }),
] as const);

type ReleaseVersion = (typeof RELEASE_SCOPES)[number]["release"];
type ModelVersion = (typeof RELEASE_SCOPES)[number]["model"];
type JsonRecord = Record<string, unknown>;

const RELEASES = RELEASE_SCOPES.map((scope) => scope.release);
const RELEASE_SET = new Set<string>(RELEASES);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RAW_HEX = /^0x(?:[0-9a-f]{2})*$/;
const LINK_KINDS = new Set<TokenLinkKind>(["website", "x", "telegram"]);

type IndexedReadModel = Readonly<{
  repeatableReadSnapshot<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}>;

type ReleasePointer = Readonly<{
  routeKey: typeof ROUTE_KEY;
  chainId: typeof CHAIN_ID;
  releaseVersion: ReleaseVersion;
  modelVersion: ModelVersion;
  sourceGroup: "core";
  projectorVersion: string;
  epochId: string;
  pointerGeneration: string;
  checkpointId: string;
  checkpointGeneration: string;
  reorgGeneration: string;
  checkpointBlockNumber: string;
  checkpointBlockHash: `0x${string}`;
}>;

type RecordSource = ReleasePointer &
  Readonly<{
    snapshotCommitment: `0x${string}`;
    projectionRunId: string;
    publicationCommitment: `0x${string}`;
    promotedBlockNumber: string;
    promotedBlockHash: `0x${string}`;
  }>;

type ParityEvidence = Readonly<{
  releaseVersion: ReleaseVersion;
  modelVersion: ModelVersion;
  parityRecordId: string;
  reconciliationId: string;
  parityEvidenceCommitment: `0x${string}`;
  parityBindingId: string;
  parityBindingCommitment: `0x${string}`;
  parityBoundAt: string;
}>;

type ParsedToken = Readonly<{
  token: LauncherToken;
  source: RecordSource;
}>;

function fail(): never {
  throw new Error("Indexed feed is not ready");
}

function record(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail();
  }
  return value as JsonRecord;
}

function array(value: unknown, maximum = 1_000_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return fail();
  return value;
}

function text(value: unknown, maximum = 4_096): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    return fail();
  }
  return value;
}

function nullableText(value: unknown, maximum = 4_096): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, maximum);
}

function uuid(value: unknown): string {
  const parsed = text(value, 64);
  if (!UUID.test(parsed)) return fail();
  return parsed.toLowerCase();
}

function uintText(value: unknown, maximumDigits = 78): string {
  if (typeof value === "bigint") {
    if (value < 0n) return fail();
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return fail();
    return String(value);
  }
  try {
    return parseNonnegativeIntegerText(value, maximumDigits);
  } catch {
    return fail();
  }
}

function nullableUint(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return uintText(value);
}

function safeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = uintText(value, 16);
  const result = Number(parsed);
  if (!Number.isSafeInteger(result) || result > maximum) return fail();
  return result;
}

function nullableSignedInteger(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^-?(?:0|[1-9][0-9]*)$/.test(String(value))
  ) {
    return fail();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > maximum) {
    return fail();
  }
  return parsed;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") return fail();
  return value;
}

function canonicalTimestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(text(value, 128));
  if (Number.isNaN(date.valueOf())) return fail();
  return date.toISOString();
}

function freshTimestamp(value: unknown, nowMs: number): string {
  const parsed = canonicalTimestamp(value);
  const age = nowMs - Date.parse(parsed);
  if (age < -MAX_CLOCK_SKEW_MS || age > MAX_SNAPSHOT_AGE_MS) return fail();
  return parsed;
}

function address(value: unknown): `0x${string}` {
  try {
    return canonicalAddress(value);
  } catch {
    return fail();
  }
}

function nullableAddress(value: unknown): `0x${string}` | undefined {
  if (value === undefined || value === null) return undefined;
  return address(value);
}

function bytes32(value: unknown): `0x${string}` {
  try {
    return canonicalBytes32(value);
  } catch {
    return fail();
  }
}

function byteaBytes32(value: unknown): `0x${string}` {
  try {
    return bytes32FromBytea(value);
  } catch {
    return fail();
  }
}

function rawHex(value: unknown): `0x${string}` {
  const parsed = text(value, 8_192).toLowerCase();
  if (!RAW_HEX.test(parsed)) return fail();
  return parsed as `0x${string}`;
}

function expectExact(value: unknown, expected: unknown): void {
  if (value !== expected) fail();
}

function release(value: unknown): ReleaseVersion {
  const parsed = text(value, 64);
  if (!RELEASE_SET.has(parsed)) return fail();
  return parsed as ReleaseVersion;
}

function expectedModel(releaseVersion: ReleaseVersion): ModelVersion {
  const scope = RELEASE_SCOPES.find(
    (candidate) => candidate.release === releaseVersion,
  );
  if (!scope) return fail();
  return scope.model;
}

function model(value: unknown, releaseVersion: ReleaseVersion): ModelVersion {
  const expected = expectedModel(releaseVersion);
  expectExact(value, expected);
  return expected;
}

function parseLinks(value: unknown): TokenLink[] | undefined {
  if (value === undefined || value === null) return undefined;
  const entries = array(value, 3);
  const kinds = new Set<TokenLinkKind>();
  return entries.map((entry) => {
    const link = record(entry);
    const kind = text(link.kind, 16) as TokenLinkKind;
    if (!LINK_KINDS.has(kind) || kinds.has(kind)) return fail();
    kinds.add(kind);
    const url = text(link.url, 2_048);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return fail();
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return fail();
    }
    return { kind, url };
  });
}

function parseReleasePointer(value: unknown): ReleasePointer {
  const input = record(value);
  expectExact(input.routeKey, ROUTE_KEY);
  if (safeInteger(input.chainId, 10_000_000) !== CHAIN_ID) return fail();
  const releaseVersion = release(input.releaseVersion);
  return Object.freeze({
    routeKey: ROUTE_KEY,
    chainId: CHAIN_ID,
    releaseVersion,
    modelVersion: model(input.modelVersion, releaseVersion),
    sourceGroup: (() => {
      expectExact(input.sourceGroup, "core");
      return "core" as const;
    })(),
    projectorVersion: text(input.projectorVersion, 128),
    epochId: uuid(input.epochId),
    pointerGeneration: uintText(input.pointerGeneration),
    checkpointId: uuid(input.checkpointId),
    checkpointGeneration: uintText(input.checkpointGeneration),
    reorgGeneration: uintText(input.reorgGeneration),
    checkpointBlockNumber: uintText(input.checkpointBlockNumber),
    checkpointBlockHash: bytes32(input.checkpointBlockHash),
  });
}

function parseRecordSource(value: unknown): RecordSource {
  const input = record(value);
  return Object.freeze({
    ...parseReleasePointer(input),
    snapshotCommitment: bytes32(input.snapshotCommitment),
    projectionRunId: uuid(input.projectionRunId),
    publicationCommitment: bytes32(input.publicationCommitment),
    promotedBlockNumber: uintText(input.promotedBlockNumber),
    promotedBlockHash: bytes32(input.promotedBlockHash),
  });
}

function parseParityEvidence(value: unknown): ParityEvidence {
  const input = record(value);
  const releaseVersion = release(input.releaseVersion);
  return Object.freeze({
    releaseVersion,
    modelVersion: model(input.modelVersion, releaseVersion),
    parityRecordId: uuid(input.parityRecordId),
    reconciliationId: uuid(input.reconciliationId),
    parityEvidenceCommitment: bytes32(input.parityEvidenceCommitment),
    parityBindingId: uuid(input.parityBindingId),
    parityBindingCommitment: bytes32(input.parityBindingCommitment),
    parityBoundAt: canonicalTimestamp(input.parityBoundAt),
  });
}

function parseSnapshot(
  value: unknown,
  nowMs: number,
): {
  publicSnapshot: ExploreSnapshot;
  capturedAt: string;
  reconciledAt: string;
  safeBlockNumber: string;
  snapshotCommitment: `0x${string}`;
  pointers: readonly ReleasePointer[];
} {
  const input = record(value);
  expectExact(input.adapterVersion, ADAPTER_VERSION);
  if (safeInteger(input.chainId, 10_000_000) !== CHAIN_ID) return fail();
  const blockNumber = uintText(input.blockNumber);
  const blockHash = bytes32(input.blockHash);
  const confirmations = safeInteger(input.confirmations, 1_000_000);
  const capturedAt = freshTimestamp(input.capturedAt, nowMs);
  const reconciledAt = freshTimestamp(input.reconciledAt, nowMs);
  const safeBlockNumber = uintText(input.safeBlockNumber);
  const snapshotCommitment = bytes32(input.snapshotCommitment);
  if (snapshotCommitment !== blockHash) return fail();
  const lag = BigInt(safeBlockNumber) - BigInt(blockNumber);
  if (lag < 0n || lag > MAX_PROJECTION_LAG_BLOCKS) return fail();

  const pointers = array(input.releasePointers, RELEASES.length).map(
    parseReleasePointer,
  );
  const pointerMap = uniqueReleaseMap(pointers);
  for (const releaseVersion of RELEASES) {
    const pointer = pointerMap.get(releaseVersion)!;
    if (
      pointer.checkpointBlockNumber !== blockNumber ||
      pointer.checkpointBlockHash !== blockHash
    ) {
      return fail();
    }
  }

  return Object.freeze({
    publicSnapshot: Object.freeze({
      chainId: CHAIN_ID,
      blockNumber,
      blockHash,
      confirmations,
    }),
    capturedAt,
    reconciledAt,
    safeBlockNumber,
    snapshotCommitment,
    pointers,
  });
}

function uniqueReleaseMap<T extends { releaseVersion: ReleaseVersion }>(
  values: readonly T[],
): ReadonlyMap<ReleaseVersion, T> {
  const result = new Map<ReleaseVersion, T>();
  for (const value of values) {
    if (result.has(value.releaseVersion)) return fail();
    result.set(value.releaseVersion, value);
  }
  if (
    result.size !== RELEASES.length ||
    RELEASES.some((releaseVersion) => !result.has(releaseVersion))
  ) {
    return fail();
  }
  return result;
}

function samePointer(source: RecordSource, pointer: ReleasePointer): boolean {
  return (
    source.routeKey === pointer.routeKey &&
    source.chainId === pointer.chainId &&
    source.releaseVersion === pointer.releaseVersion &&
    source.modelVersion === pointer.modelVersion &&
    source.sourceGroup === pointer.sourceGroup &&
    source.projectorVersion === pointer.projectorVersion &&
    source.epochId === pointer.epochId &&
    source.pointerGeneration === pointer.pointerGeneration &&
    source.checkpointId === pointer.checkpointId &&
    source.checkpointGeneration === pointer.checkpointGeneration &&
    source.reorgGeneration === pointer.reorgGeneration &&
    source.checkpointBlockNumber === pointer.checkpointBlockNumber &&
    source.checkpointBlockHash === pointer.checkpointBlockHash
  );
}

function parseRawToken(value: unknown): ParsedToken {
  const input = record(value);
  const source = parseRecordSource(input.source);
  const metadata =
    input.metadata === null || input.metadata === undefined
      ? undefined
      : record(input.metadata);
  const liquidity = record(input.liquidity);
  const fees = record(input.fees);

  const token: LauncherToken = {
    id: `${CHAIN_ID}:${address(input.tokenAddress)}`,
    name: text(input.name, 128),
    symbol: text(input.symbol, 32),
    tokenAddress: address(input.tokenAddress),
    hookAddress: address(input.hookAddress),
    poolId: bytes32(input.poolId),
    creatorAddress: address(input.creatorAddress),
    launchedAt: canonicalTimestamp(input.launchedAt),
    totalSupplyRaw: uintText(input.totalSupplyRaw),
    tokenDecimals: safeInteger(input.decimals, 36),
    tokenLiquidityAmountRaw: nullableUint(
      liquidity.tokenLiquidityAmountRaw,
    ),
    lockedTokenDustRaw: nullableUint(liquidity.lockedTokenDustRaw),
    currentTick: nullableSignedInteger(liquidity.currentTick, 8_388_607),
    initialTick: nullableSignedInteger(liquidity.initialTick, 8_388_607),
    tickLower: nullableSignedInteger(liquidity.tickLower, 8_388_607),
    tickUpper: nullableSignedInteger(liquidity.tickUpper, 8_388_607),
    activeLiquidity: nullableUint(liquidity.activeLiquidity),
    totalSwapFeeBps: safeInteger(fees.totalSwapFeeBps, 10_000),
    buyHookFeeBps: safeInteger(fees.buySwapFeeBps, 10_000),
    sellHookFeeBps: safeInteger(fees.sellSwapFeeBps, 10_000),
    buyCreatorFeeBps: safeInteger(fees.buyCreatorFeeBps, 10_000),
    sellCreatorFeeBps: safeInteger(fees.sellCreatorFeeBps, 10_000),
    launcherFeeBps: safeInteger(fees.launcherFeeBps, 10_000),
    programmableFeeBps: safeInteger(fees.launcherFeeBps, 10_000),
    transferTaxBps: safeInteger(fees.transferTaxBps, 10_000),
    lpFeePips: safeInteger(fees.lpFeePips, 1_000_000),
    launchModel: source.modelVersion,
    liquidityPath: "meme",
  };

  if (token.buyCreatorFeeBps === token.sellCreatorFeeBps) {
    token.creatorFeeBps = token.buyCreatorFeeBps;
  }

  if (metadata) {
    uintText(metadata.revision);
    canonicalTimestamp(metadata.createdAt);
    const description = nullableText(metadata.description, 4_096);
    if (description !== undefined) token.description = description;
    const imageUrl = nullableText(metadata.imageUrl, 2_048);
    if (imageUrl !== undefined) token.imageUrl = imageUrl;
    const links = parseLinks(metadata.links);
    if (links !== undefined) token.links = links;
    if (metadata.extraData !== undefined && metadata.extraData !== null) {
      token.metadataExtraData = rawHex(metadata.extraData);
    }
  }

  const positionRecipient = nullableAddress(input.positionRecipient);
  if (positionRecipient) token.positionRecipient = positionRecipient;
  const positionTokenId = nullableUint(input.positionTokenId);
  if (positionTokenId !== undefined) token.positionTokenId = positionTokenId;
  const rewardVaultAddress = nullableAddress(input.rewardVaultAddress);
  if (rewardVaultAddress) token.rewardVaultAddress = rewardVaultAddress;
  token.launchHash = bytes32(input.launchHash);
  token.launchBlockNumber = uintText(input.launchBlockNumber);
  token.launchTransactionHash = bytes32(input.launchTransactionHash);
  token.launchTransactionIndex = safeInteger(
    input.launchTransactionIndex,
    0xffff_ffff,
  );
  token.launchLogIndex = safeInteger(input.launchLogIndex, 0xffff_ffff);

  if (source.releaseVersion === "classic-v3") {
    token.launchModelVersion = "classic-v3";
  } else if (source.modelVersion === "stock-paired") {
    token.launchModelVersion = source.releaseVersion as
      | "stock-paired-v1"
      | "stock-paired-v2"
      | "stock-paired-v3";
    const quote = record(input.quote);
    token.quoteAssetAddress = address(quote.address);
    token.quoteAssetSymbol = text(quote.symbol, 32);
    token.quoteAssetName = text(quote.name, 128);
    safeInteger(quote.decimals, 36);
    token.quoteIsCurrency0 = bool(quote.isCurrency0);
  } else if (input.quote !== null && input.quote !== undefined) {
    return fail();
  }

  serializeIndexerToken(token, CHAIN_ID);
  return Object.freeze({ token: Object.freeze(token), source });
}

function parseRecordScope(value: unknown): {
  releaseVersion: ReleaseVersion;
  modelVersion: ModelVersion;
} {
  const input = record(value);
  const releaseVersion = release(input.releaseVersion);
  return Object.freeze({
    releaseVersion,
    modelVersion: model(input.model, releaseVersion),
  });
}

function sourceCommitment(value: unknown): `0x${string}` {
  return `0x${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

async function querySnapshot(
  transaction: PostgresTransaction,
  nowMs: number,
): Promise<IndexedFeedSnapshot> {
  const rows = await transaction.query<JsonRecord>(
    `select
       http_status,
       payload,
       payload_complete,
       record_count::text as record_count,
       record_scopes,
       comparison_checkpoint_block_number::text
         as comparison_checkpoint_block_number,
       comparison_checkpoint_block_hash,
       route_evidence,
       snapshot,
       tokens,
       record_sources,
       captured_at,
       reconciled_at,
       snapshot_commitment
     from programmable_private.get_public_indexer_feed_v1($1)`,
    [CHAIN_ID],
  );
  if (rows.length !== 1) return fail();
  const row = rows[0]!;
  if (safeInteger(row.http_status, 599) !== 200 || row.payload_complete !== true) {
    return fail();
  }

  const parsedSnapshot = parseSnapshot(row.snapshot, nowMs);
  const capturedAt = freshTimestamp(row.captured_at, nowMs);
  const reconciledAt = freshTimestamp(row.reconciled_at, nowMs);
  if (
    capturedAt !== parsedSnapshot.capturedAt ||
    reconciledAt !== parsedSnapshot.reconciledAt ||
    byteaBytes32(row.snapshot_commitment) !==
      parsedSnapshot.snapshotCommitment ||
    uintText(row.comparison_checkpoint_block_number) !==
      parsedSnapshot.publicSnapshot.blockNumber ||
    byteaBytes32(row.comparison_checkpoint_block_hash) !==
      parsedSnapshot.publicSnapshot.blockHash
  ) {
    return fail();
  }

  const pointerMap = uniqueReleaseMap(parsedSnapshot.pointers);
  const routeEvidence = array(row.route_evidence, RELEASES.length).map(
    parseParityEvidence,
  );
  const evidenceMap = uniqueReleaseMap(routeEvidence);
  const oldestParityBoundAt = routeEvidence
    .map((evidence) => evidence.parityBoundAt)
    .sort()[0]!;
  if (oldestParityBoundAt !== reconciledAt) return fail();

  const parsedTokens = array(row.tokens).map(parseRawToken);
  const recordSources = array(row.record_sources);
  if (
    safeInteger(row.record_count, 1_000_000) !== parsedTokens.length ||
    recordSources.length !== parsedTokens.length
  ) {
    return fail();
  }

  const tokenAddresses = new Set<string>();
  for (let index = 0; index < parsedTokens.length; index += 1) {
    const parsed = parsedTokens[index]!;
    const pointer = pointerMap.get(parsed.source.releaseVersion)!;
    if (
      !samePointer(parsed.source, pointer) ||
      parsed.source.snapshotCommitment !==
        parsedSnapshot.snapshotCommitment ||
      tokenAddresses.has(parsed.token.tokenAddress)
    ) {
      return fail();
    }
    tokenAddresses.add(parsed.token.tokenAddress);

    const recordSource = record(recordSources[index]);
    if (address(recordSource.tokenAddress) !== parsed.token.tokenAddress) {
      return fail();
    }
    const repeatedSource = parseRecordSource(recordSource.source);
    if (JSON.stringify(repeatedSource) !== JSON.stringify(parsed.source)) {
      return fail();
    }
    const parity = parseParityEvidence(recordSource.parity);
    const expectedParity = evidenceMap.get(parsed.source.releaseVersion)!;
    if (JSON.stringify(parity) !== JSON.stringify(expectedParity)) {
      return fail();
    }
  }

  const actualScopes = new Map<string, number>();
  for (const token of parsedTokens) {
    const key = `${token.source.modelVersion}:${token.source.releaseVersion}`;
    actualScopes.set(key, (actualScopes.get(key) ?? 0) + 1);
  }
  const declaredScopes = array(row.record_scopes, RELEASES.length).map(
    parseRecordScope,
  );
  const declaredKeys = new Set(
    declaredScopes.map(
      (scope) => `${scope.modelVersion}:${scope.releaseVersion}`,
    ),
  );
  if (
    declaredKeys.size !== declaredScopes.length ||
    declaredKeys.size !== actualScopes.size ||
    [...actualScopes.keys()].some((key) => !declaredKeys.has(key))
  ) {
    return fail();
  }

  const payload = record(row.payload);
  expectExact(payload.status, "ready");
  const payloadData = record(payload.data);
  if (
    JSON.stringify(payload.snapshot) !== JSON.stringify(row.snapshot) ||
    JSON.stringify(payloadData.tokens) !== JSON.stringify(row.tokens) ||
    JSON.stringify(payloadData.recordSources) !==
      JSON.stringify(row.record_sources)
  ) {
    return fail();
  }

  return Object.freeze({
    chainId: CHAIN_ID,
    model: Object.freeze({
      status: "ready" as const,
      tokens: parsedTokens.map((item) => item.token),
      snapshot: parsedSnapshot.publicSnapshot,
      // These fields are not serialized by either public indexer contract.
      // Their neutral values avoid introducing a second claims/totals query.
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    }),
    capturedAt,
    snapshotCommitment: parsedSnapshot.snapshotCommitment,
    sourceCommitment: sourceCommitment({ routeEvidence, recordSources }),
    projectionLag: Number(
      BigInt(parsedSnapshot.safeBlockNumber) -
        BigInt(parsedSnapshot.publicSnapshot.blockNumber),
    ),
    reconciledAt,
    releaseVersions: Object.freeze([...RELEASES]),
  });
}

export async function readIndexedFeedSnapshotWithModel(
  readModel: IndexedReadModel,
  nowMs = Date.now(),
): Promise<IndexedFeedSnapshot> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return fail();
  return readModel.repeatableReadSnapshot((transaction) =>
    querySnapshot(transaction, nowMs),
  );
}

/**
 * Reads the complete GMGN/indexer feed through the API-reader-only aggregate
 * function. The database returns no row unless all five supported releases
 * share one current checkpoint and every launch has complete source, parity
 * and publication evidence; the adapter independently validates that envelope.
 */
export async function readIndexedFeedSnapshot(): Promise<IndexedFeedSnapshot> {
  const readModel = await getServerReadModel();
  if (!readModel) return fail();
  return readIndexedFeedSnapshotWithModel(readModel);
}
