import "server-only";

import { getAddress, isAddress, type Hex } from "viem";

import type { LauncherToken } from "../tokens";

export const OPTIMISTIC_READ_OVERLAY_VERSION =
  "optimistic-read-overlay-v1" as const;
export const OPTIMISTIC_READ_OVERLAY_MINIMUM_CONFIRMATIONS = 12;

const BYTES_32 = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(?:0|[1-9]\d*)$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type OptimisticOverlayEventIdentity = Readonly<{
  transactionHash: Hex;
  logIndex: number;
}>;

/**
 * Normalized database evidence for one exact block. The API accepts a row only
 * when both independent RPC observations bind the row to the same exact block.
 * `optimistic` is explicit for 0-11 confirmations; `safe` starts at 12.
 * A QuickNode webhook, latest-block response or application flag alone can
 * never manufacture eligibility.
 */
export type OptimisticOverlayBlockEvidence = Readonly<{
  eligibility: string;
  source: string;
  finality: string;
  chainId: number;
  blockNumber: string;
  blockHash: Hex;
  primaryBlockNumber: string;
  primaryBlockHash: Hex;
  secondaryBlockNumber: string;
  secondaryBlockHash: Hex;
  confirmations: number;
  finalityDepth: number;
  observedAt: string;
}>;

export type OptimisticMarketFields = Readonly<{
  tokenPriceEth?: string;
  tokenPriceEthWei?: string;
  tokenPriceUsdWad?: string;
  marketCapEth?: string;
  marketCapEthWei?: string;
  indexedMarketCapEth?: string;
  indexedMarketCapEthWei?: string;
  indexedMarketCapUsdWad?: string;
  indexedValuationBlockNumber?: string;
  grossVolumeEth?: string;
  grossVolumeWei?: string;
  creatorFeesGeneratedEth?: string;
  creatorFeesGeneratedWei?: string;
  launcherFeesGeneratedEth?: string;
  launcherFeesGeneratedWei?: string;
  creatorFeesAccruedEth?: string;
  creatorFeesAccruedWei?: string;
  swapCount?: number;
  currentTick?: number;
  activeLiquidity?: string;
}>;

type OptimisticRowBase = Readonly<{
  evidence: OptimisticOverlayBlockEvidence;
  event: OptimisticOverlayEventIdentity;
  poolId: Hex;
  tokenAddress: Hex;
}>;

export type OptimisticLaunchRow = OptimisticRowBase &
  Readonly<{
    kind: "launch";
    token: LauncherToken;
  }>;

export type OptimisticMarketRow = OptimisticRowBase &
  Readonly<{
    kind: "market";
    market: OptimisticMarketFields;
  }>;

export type OptimisticOverlayRow = OptimisticLaunchRow | OptimisticMarketRow;

export type OptimisticOverlayRejectionReason =
  | "not-explicitly-eligible"
  | "invalid-identity"
  | "invalid-block-evidence"
  | "insufficient-finality"
  | "rpc-disagreement"
  | "invalid-launch"
  | "invalid-market"
  | "ambiguous-event"
  | "ambiguous-block"
  | "ambiguous-pool"
  | "ambiguous-token"
  | "canonical-conflict"
  | "launch-unavailable"
  | "stale-market"
  | "market-before-launch";

export type OptimisticOverlayRejection = Readonly<{
  kind: OptimisticOverlayRow["kind"];
  reason: OptimisticOverlayRejectionReason;
  poolId?: string;
}>;

type ValidatedEvidence = Readonly<{
  finality: "optimistic" | "safe";
  chainId: number;
  blockNumber: string;
  blockHash: Hex;
  confirmations: number;
  observedAt: string;
}>;

type ValidatedBase = Readonly<{
  evidence: ValidatedEvidence;
  event: OptimisticOverlayEventIdentity;
  poolId: Hex;
  tokenAddress: Hex;
}>;

export type EligibleOptimisticLaunch = ValidatedBase &
  Readonly<{
    kind: "launch";
    token: LauncherToken;
  }>;

export type EligibleOptimisticMarket = ValidatedBase &
  Readonly<{
    kind: "market";
    market: OptimisticMarketFields;
  }>;

export type EligibleOptimisticOverlay = Readonly<{
  launches: readonly EligibleOptimisticLaunch[];
  markets: readonly EligibleOptimisticMarket[];
  rejected: readonly OptimisticOverlayRejection[];
}>;

export type AppliedOptimisticOverlayRow = Readonly<{
  kind: OptimisticOverlayRow["kind"];
  source: "dual-rpc-head";
  finality: "optimistic" | "safe";
  chainId: number;
  blockNumber: string;
  blockHash: Hex;
  confirmations: number;
  poolId: Hex;
  tokenAddress: Hex;
  event: OptimisticOverlayEventIdentity;
}>;

export type OptimisticOverlayDisclosure = Readonly<{
  version: typeof OPTIMISTIC_READ_OVERLAY_VERSION;
  active: boolean;
  source: "dual-rpc-head";
  finality: "optimistic" | "safe" | "mixed";
  safeConfirmationThreshold: number;
  applied: readonly AppliedOptimisticOverlayRow[];
}>;

export type OptimisticTokenCorpusResult = Readonly<{
  tokens: readonly LauncherToken[];
  disclosure: OptimisticOverlayDisclosure;
  rejected: readonly OptimisticOverlayRejection[];
}>;

function canonicalBytes32(value: unknown): Hex | null {
  return typeof value === "string" && BYTES_32.test(value)
    ? (value.toLowerCase() as Hex)
    : null;
}

function canonicalAddress(value: unknown): Hex | null {
  return typeof value === "string" && isAddress(value)
    ? (getAddress(value) as Hex)
    : null;
}

function integerText(value: unknown): string | null {
  return typeof value === "string" &&
      value.length <= 78 &&
      UINT.test(value)
    ? value
    : null;
}

function finiteInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum
    ? value
    : null;
}

function eventKey(event: OptimisticOverlayEventIdentity): string {
  return `${event.transactionHash.toLowerCase()}:${event.logIndex}`;
}

function rowCoreKey(row: ValidatedBase): string {
  return [
    row.poolId.toLowerCase(),
    row.tokenAddress.toLowerCase(),
    row.evidence.blockNumber,
    row.evidence.blockHash.toLowerCase(),
  ].join(":");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function reject(
  row: OptimisticOverlayRow,
  reason: OptimisticOverlayRejectionReason,
): OptimisticOverlayRejection {
  return Object.freeze({
    kind: row.kind,
    reason,
    ...(typeof row.poolId === "string" ? { poolId: row.poolId } : {}),
  });
}

function validateBase(
  row: OptimisticOverlayRow,
):
  | { ok: true; value: ValidatedBase }
  | { ok: false; reason: OptimisticOverlayRejectionReason } {
  const finality =
    row.evidence.eligibility === "optimistic" &&
      row.evidence.finality === "optimistic"
      ? "optimistic"
      : row.evidence.eligibility === "eligible" &&
          row.evidence.finality === "safe"
        ? "safe"
        : null;
  if (!finality || row.evidence.source !== "dual-rpc-head") {
    return { ok: false, reason: "not-explicitly-eligible" };
  }
  const poolId = canonicalBytes32(row.poolId);
  const tokenAddress = canonicalAddress(row.tokenAddress);
  const transactionHash = canonicalBytes32(row.event.transactionHash);
  const logIndex = finiteInteger(row.event.logIndex, 0, 0xffff_ffff);
  if (!poolId || !tokenAddress || !transactionHash || logIndex === null) {
    return { ok: false, reason: "invalid-identity" };
  }

  const blockNumber = integerText(row.evidence.blockNumber);
  const blockHash = canonicalBytes32(row.evidence.blockHash);
  const primaryBlockNumber = integerText(row.evidence.primaryBlockNumber);
  const primaryBlockHash = canonicalBytes32(row.evidence.primaryBlockHash);
  const secondaryBlockNumber = integerText(row.evidence.secondaryBlockNumber);
  const secondaryBlockHash = canonicalBytes32(row.evidence.secondaryBlockHash);
  const chainId = finiteInteger(row.evidence.chainId, 1, 0x7fff_ffff);
  const confirmations = finiteInteger(row.evidence.confirmations, 0, 1_024);
  const finalityDepth = finiteInteger(row.evidence.finalityDepth, 1, 1_024);
  const observedAt = new Date(row.evidence.observedAt);
  if (
    !blockNumber ||
    !blockHash ||
    !primaryBlockNumber ||
    !primaryBlockHash ||
    !secondaryBlockNumber ||
    !secondaryBlockHash ||
    chainId === null ||
    confirmations === null ||
    finalityDepth === null ||
    !Number.isFinite(observedAt.getTime())
  ) {
    return { ok: false, reason: "invalid-block-evidence" };
  }
  if (
    finalityDepth !== OPTIMISTIC_READ_OVERLAY_MINIMUM_CONFIRMATIONS ||
    (finality === "optimistic" && confirmations >= finalityDepth) ||
    (finality === "safe" && confirmations < finalityDepth)
  ) {
    return { ok: false, reason: "insufficient-finality" };
  }
  if (
    primaryBlockNumber !== blockNumber ||
    secondaryBlockNumber !== blockNumber ||
    primaryBlockHash !== blockHash ||
    secondaryBlockHash !== blockHash
  ) {
    return { ok: false, reason: "rpc-disagreement" };
  }
  return {
    ok: true,
    value: Object.freeze({
      evidence: Object.freeze({
        finality,
        chainId,
        blockNumber,
        blockHash,
        confirmations,
        observedAt: observedAt.toISOString(),
      }),
      event: Object.freeze({ transactionHash, logIndex }),
      poolId,
      tokenAddress,
    }),
  };
}

function validateLaunch(
  row: OptimisticLaunchRow,
  base: ValidatedBase,
): LauncherToken | null {
  const tokenPool = canonicalBytes32(row.token.poolId);
  const tokenAddress = canonicalAddress(row.token.tokenAddress);
  const launchTransactionHash = canonicalBytes32(
    row.token.launchTransactionHash,
  );
  const launchBlockNumber = integerText(row.token.launchBlockNumber);
  if (
    !tokenPool ||
    !tokenAddress ||
    !launchTransactionHash ||
    launchBlockNumber === null ||
    row.token.launchLogIndex !== base.event.logIndex ||
    tokenPool !== base.poolId ||
    tokenAddress.toLowerCase() !== base.tokenAddress.toLowerCase() ||
    launchTransactionHash !== base.event.transactionHash ||
    launchBlockNumber !== base.evidence.blockNumber ||
    !Number.isFinite(Date.parse(row.token.launchedAt)) ||
    !Number.isInteger(row.token.totalSwapFeeBps) ||
    row.token.totalSwapFeeBps < 0 ||
    row.token.totalSwapFeeBps > 10_000 ||
    row.token.liquidityPath !== "meme"
  ) {
    return null;
  }
  return Object.freeze({ ...row.token });
}

const DECIMAL_MARKET_FIELDS = [
  "tokenPriceEth",
  "marketCapEth",
  "indexedMarketCapEth",
  "grossVolumeEth",
  "creatorFeesGeneratedEth",
  "launcherFeesGeneratedEth",
  "creatorFeesAccruedEth",
] as const satisfies readonly (keyof OptimisticMarketFields)[];

const UINT_MARKET_FIELDS = [
  "tokenPriceEthWei",
  "tokenPriceUsdWad",
  "marketCapEthWei",
  "indexedMarketCapEthWei",
  "indexedMarketCapUsdWad",
  "indexedValuationBlockNumber",
  "grossVolumeWei",
  "creatorFeesGeneratedWei",
  "launcherFeesGeneratedWei",
  "creatorFeesAccruedWei",
  "activeLiquidity",
] as const satisfies readonly (keyof OptimisticMarketFields)[];

function validateMarket(
  row: OptimisticMarketRow,
  base: ValidatedBase,
): OptimisticMarketFields | null {
  const market: Record<string, string | number> = {};
  for (const field of DECIMAL_MARKET_FIELDS) {
    const value = row.market[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > 160 || !DECIMAL.test(value)) {
      return null;
    }
    market[field] = value;
  }
  for (const field of UINT_MARKET_FIELDS) {
    const value = row.market[field];
    if (value === undefined) continue;
    const parsed = integerText(value);
    if (parsed === null) return null;
    market[field] = parsed;
  }
  if (row.market.swapCount !== undefined) {
    const swapCount = finiteInteger(
      row.market.swapCount,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    if (swapCount === null) return null;
    market.swapCount = swapCount;
  }
  if (row.market.currentTick !== undefined) {
    const currentTick = finiteInteger(
      row.market.currentTick,
      -0x8000_0000,
      0x7fff_ffff,
    );
    if (currentTick === null) return null;
    market.currentTick = currentTick;
  }
  if (
    Object.keys(market).length === 0 ||
    market.indexedValuationBlockNumber !== base.evidence.blockNumber
  ) {
    return null;
  }
  return Object.freeze(market as OptimisticMarketFields);
}

function coreConflictRows<T extends ValidatedBase>(
  rows: readonly T[],
  key: (row: T) => string,
  identity: (row: T) => string = rowCoreKey,
): Set<T> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const selected = grouped.get(key(row)) ?? [];
    selected.push(row);
    grouped.set(key(row), selected);
  }
  const conflicts = new Set<T>();
  for (const candidates of grouped.values()) {
    if (new Set(candidates.map(identity)).size <= 1) continue;
    for (const candidate of candidates) conflicts.add(candidate);
  }
  return conflicts;
}

function finalityRank(row: ValidatedBase): number {
  return row.evidence.finality === "safe" ? 1 : 0;
}

/**
 * Fail-closed row selection. Invalid and ambiguous optimistic rows are omitted;
 * canonical data remains usable and its readiness contract is never consulted
 * or modified here.
 */
export function selectEligibleOptimisticOverlay(
  input: Readonly<{
    rows: readonly OptimisticOverlayRow[];
    chainId: number;
  }>,
): EligibleOptimisticOverlay {
  const launches: EligibleOptimisticLaunch[] = [];
  const markets: EligibleOptimisticMarket[] = [];
  const rejected: OptimisticOverlayRejection[] = [];

  for (const row of input.rows) {
    const base = validateBase(row);
    if (!base.ok) {
      rejected.push(reject(row, base.reason));
      continue;
    }
    if (base.value.evidence.chainId !== input.chainId) {
      rejected.push(reject(row, "invalid-block-evidence"));
      continue;
    }
    if (row.kind === "launch") {
      const token = validateLaunch(row, base.value);
      if (!token) {
        rejected.push(reject(row, "invalid-launch"));
        continue;
      }
      launches.push(Object.freeze({ ...base.value, kind: "launch", token }));
      continue;
    }
    const market = validateMarket(row, base.value);
    if (!market) {
      rejected.push(reject(row, "invalid-market"));
      continue;
    }
    markets.push(Object.freeze({ ...base.value, kind: "market", market }));
  }

  const launchEventConflicts = coreConflictRows(launches, (row) =>
    eventKey(row.event),
    (row) => `${rowCoreKey(row)}:${canonicalJson(row.token)}`,
  );
  const launchPoolConflicts = coreConflictRows(launches, (row) =>
    row.poolId.toLowerCase(),
    (row) =>
      `${eventKey(row.event)}:${rowCoreKey(row)}:${canonicalJson(row.token)}`,
  );
  const launchTokenConflicts = coreConflictRows(launches, (row) =>
    row.tokenAddress.toLowerCase(),
    (row) =>
      `${eventKey(row.event)}:${rowCoreKey(row)}:${canonicalJson(row.token)}`,
  );
  const selectedLaunches: EligibleOptimisticLaunch[] = [];
  const seenLaunchEvents = new Set<string>();
  const preferredLaunches = [...launches].sort((left, right) => {
    const finalityOrder = finalityRank(right) - finalityRank(left);
    if (finalityOrder !== 0) return finalityOrder;
    return right.evidence.observedAt.localeCompare(left.evidence.observedAt);
  });
  for (const row of preferredLaunches) {
    const reason = launchEventConflicts.has(row)
      ? "ambiguous-event"
      : launchPoolConflicts.has(row)
        ? "ambiguous-pool"
        : launchTokenConflicts.has(row)
          ? "ambiguous-token"
          : null;
    if (reason) {
      rejected.push({ kind: "launch", reason, poolId: row.poolId });
      continue;
    }
    const key = eventKey(row.event);
    if (seenLaunchEvents.has(key)) continue;
    seenLaunchEvents.add(key);
    selectedLaunches.push(row);
  }

  const marketEventConflicts = coreConflictRows(markets, (row) =>
    eventKey(row.event),
    (row) => `${rowCoreKey(row)}:${canonicalJson(row.market)}`,
  );
  const marketsByPool = new Map<string, EligibleOptimisticMarket[]>();
  for (const row of markets) {
    if (marketEventConflicts.has(row)) {
      rejected.push({
        kind: "market",
        reason: "ambiguous-event",
        poolId: row.poolId,
      });
      continue;
    }
    const selected = marketsByPool.get(row.poolId.toLowerCase()) ?? [];
    selected.push(row);
    marketsByPool.set(row.poolId.toLowerCase(), selected);
  }
  const selectedMarkets: EligibleOptimisticMarket[] = [];
  for (const candidates of marketsByPool.values()) {
    candidates.sort((left, right) => {
      const blockOrder = BigInt(right.evidence.blockNumber) -
        BigInt(left.evidence.blockNumber);
      if (blockOrder !== 0n) return blockOrder > 0n ? 1 : -1;
      const logOrder = right.event.logIndex - left.event.logIndex;
      if (logOrder !== 0) return logOrder;
      const finalityOrder = finalityRank(right) - finalityRank(left);
      if (finalityOrder !== 0) return finalityOrder;
      return right.evidence.observedAt.localeCompare(left.evidence.observedAt);
    });
    const newest = candidates[0]!;
    const sameHeight = candidates.filter(
      (candidate) =>
        candidate.evidence.blockNumber === newest.evidence.blockNumber,
    );
    if (
      new Set(sameHeight.map((candidate) => candidate.evidence.blockHash)).size >
      1
    ) {
      for (const candidate of candidates) {
        rejected.push({
          kind: "market",
          reason: "ambiguous-pool",
          poolId: candidate.poolId,
        });
      }
      continue;
    }
    selectedMarkets.push(newest);
  }

  const selectedRows = [...selectedLaunches, ...selectedMarkets];
  const blockHashes = new Map<string, Set<string>>();
  for (const row of selectedRows) {
    const key = `${row.evidence.chainId}:${row.evidence.blockNumber}`;
    const hashes = blockHashes.get(key) ?? new Set<string>();
    hashes.add(row.evidence.blockHash);
    blockHashes.set(key, hashes);
  }
  const conflictedBlocks = new Set(
    [...blockHashes.entries()]
      .filter(([, hashes]) => hashes.size > 1)
      .map(([key]) => key),
  );
  const finalLaunches = selectedLaunches.filter((row) => {
    const conflict = conflictedBlocks.has(
      `${row.evidence.chainId}:${row.evidence.blockNumber}`,
    );
    if (conflict) {
      rejected.push({
        kind: "launch",
        reason: "ambiguous-block",
        poolId: row.poolId,
      });
    }
    return !conflict;
  });
  const finalMarkets = selectedMarkets.filter((row) => {
    const conflict = conflictedBlocks.has(
      `${row.evidence.chainId}:${row.evidence.blockNumber}`,
    );
    if (conflict) {
      rejected.push({
        kind: "market",
        reason: "ambiguous-block",
        poolId: row.poolId,
      });
    }
    return !conflict;
  });

  return Object.freeze({
    launches: Object.freeze(finalLaunches),
    markets: Object.freeze(finalMarkets),
    rejected: Object.freeze(rejected),
  });
}

function appliedRow(
  row: EligibleOptimisticLaunch | EligibleOptimisticMarket,
): AppliedOptimisticOverlayRow {
  return Object.freeze({
    kind: row.kind,
    source: "dual-rpc-head",
    finality: row.evidence.finality,
    chainId: row.evidence.chainId,
    blockNumber: row.evidence.blockNumber,
    blockHash: row.evidence.blockHash,
    confirmations: row.evidence.confirmations,
    poolId: row.poolId,
    tokenAddress: row.tokenAddress,
    event: row.event,
  });
}

function tokenEventKey(token: LauncherToken): string | null {
  const transactionHash = canonicalBytes32(token.launchTransactionHash);
  const logIndex = finiteInteger(token.launchLogIndex, 0, 0xffff_ffff);
  return transactionHash && logIndex !== null
    ? `${transactionHash}:${logIndex}`
    : null;
}

function trustedCanonicalMarketBlock(token: LauncherToken): string | null {
  const candidates = [
    integerText(token.indexedValuationBlockNumber),
    integerText(token.uniswapV4Pool?.indexedBlockNumber),
  ].filter((value): value is string => value !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((newest, candidate) =>
    BigInt(candidate) > BigInt(newest) ? candidate : newest,
  );
}

/**
 * Merges a full canonical token corpus with selected optimistic rows. Callers
 * must sort, filter and paginate after this merge; applying it to an already
 * paginated Explore response would produce incorrect totals and ordering.
 */
export function mergeOptimisticTokenCorpus(input: Readonly<{
  canonicalTokens: readonly LauncherToken[];
  overlay: EligibleOptimisticOverlay;
}>): OptimisticTokenCorpusResult {
  const tokens = input.canonicalTokens.map((token) => ({ ...token }));
  const canonicalTokenCount = tokens.length;
  const byPool = new Map(
    tokens.map((token, index) => [token.poolId.toLowerCase(), index]),
  );
  const byToken = new Map(
    tokens.map((token, index) => [token.tokenAddress.toLowerCase(), index]),
  );
  const byEvent = new Map(
    tokens.flatMap((token, index) => {
      const key = tokenEventKey(token);
      return key ? ([[key, index]] as const) : [];
    }),
  );
  const applied: AppliedOptimisticOverlayRow[] = [];
  const rejected = [...input.overlay.rejected];

  for (const launch of input.overlay.launches) {
    const poolIndex = byPool.get(launch.poolId.toLowerCase());
    const tokenIndex = byToken.get(launch.tokenAddress.toLowerCase());
    const eventIndex = byEvent.get(eventKey(launch.event));
    const existing = [poolIndex, tokenIndex, eventIndex].filter(
      (value): value is number => value !== undefined,
    );
    if (existing.length > 0) {
      if (new Set(existing).size !== 1) {
        rejected.push({
          kind: "launch",
          reason: "canonical-conflict",
          poolId: launch.poolId,
        });
        continue;
      }
      const canonical = tokens[existing[0]!]!;
      if (
        canonical.poolId.toLowerCase() !== launch.poolId.toLowerCase() ||
        canonical.tokenAddress.toLowerCase() !==
          launch.tokenAddress.toLowerCase() ||
        tokenEventKey(canonical) !== eventKey(launch.event)
      ) {
        rejected.push({
          kind: "launch",
          reason: "canonical-conflict",
          poolId: launch.poolId,
        });
      }
      continue;
    }
    const index = tokens.length;
    tokens.push({ ...launch.token });
    byPool.set(launch.poolId.toLowerCase(), index);
    byToken.set(launch.tokenAddress.toLowerCase(), index);
    byEvent.set(eventKey(launch.event), index);
    applied.push(appliedRow(launch));
  }

  for (const market of input.overlay.markets) {
    const index = byPool.get(market.poolId.toLowerCase());
    if (index === undefined) {
      rejected.push({
        kind: "market",
        reason: "launch-unavailable",
        poolId: market.poolId,
      });
      continue;
    }
    const token = tokens[index]!;
    if (
      token.tokenAddress.toLowerCase() !== market.tokenAddress.toLowerCase()
    ) {
      rejected.push({
        kind: "market",
        reason: "canonical-conflict",
        poolId: market.poolId,
      });
      continue;
    }
    const launchBlock = integerText(token.launchBlockNumber);
    if (
      launchBlock !== null &&
      BigInt(market.evidence.blockNumber) < BigInt(launchBlock)
    ) {
      rejected.push({
        kind: "market",
        reason: "market-before-launch",
        poolId: market.poolId,
      });
      continue;
    }
    if (index < canonicalTokenCount) {
      const canonicalMarketBlock = trustedCanonicalMarketBlock(token);
      if (
        canonicalMarketBlock === null ||
        BigInt(market.evidence.blockNumber) <= BigInt(canonicalMarketBlock)
      ) {
        rejected.push({
          kind: "market",
          reason: "stale-market",
          poolId: market.poolId,
        });
        continue;
      }
    }
    // `market` is reconstructed field-by-field by validateMarket. Spreading it
    // can update only the explicit market whitelist; launch identity, release,
    // hook, fee and configuration fields always come from the canonical token.
    tokens[index] = { ...token, ...market.market };
    applied.push(appliedRow(market));
  }

  return Object.freeze({
    tokens: Object.freeze(tokens),
    disclosure: Object.freeze({
      version: OPTIMISTIC_READ_OVERLAY_VERSION,
      active: applied.length > 0,
      source: "dual-rpc-head",
      finality:
        new Set(applied.map((row) => row.finality)).size > 1
          ? "mixed"
          : applied[0]?.finality ?? "safe",
      safeConfirmationThreshold:
        OPTIMISTIC_READ_OVERLAY_MINIMUM_CONFIRMATIONS,
      applied: Object.freeze(applied),
    }),
    rejected: Object.freeze(rejected),
  });
}

/** Additive public metadata: existing DTO fields remain byte-for-byte shaped. */
export function withOptimisticOverlayDisclosure<T extends object>(
  body: T,
  disclosure: OptimisticOverlayDisclosure,
): T & { optimisticOverlay: OptimisticOverlayDisclosure } {
  return Object.freeze({ ...body, optimisticOverlay: disclosure });
}

export function optimisticOverlayHeaders(
  disclosure: OptimisticOverlayDisclosure,
): Readonly<Record<string, string>> {
  if (!disclosure.active) return Object.freeze({});
  const newest = [...disclosure.applied].sort((left, right) => {
    const difference = BigInt(right.blockNumber) - BigInt(left.blockNumber);
    return difference === 0n ? 0 : difference > 0n ? 1 : -1;
  })[0]!;
  return Object.freeze({
    "x-programmable-overlay": disclosure.version,
    "x-programmable-overlay-source": disclosure.source,
    "x-programmable-overlay-finality": disclosure.finality,
    "x-programmable-overlay-block": newest.blockNumber,
    "x-programmable-overlay-block-hash": newest.blockHash,
    "x-programmable-overlay-rows": String(disclosure.applied.length),
  });
}
