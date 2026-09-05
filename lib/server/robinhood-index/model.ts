import type { RobinhoodLaunch, RobinhoodLaunchList } from "@/lib/robinhood-launches";
import { DEFAULT_EXPLORE_FILTERS, type RobinhoodExploreFilters } from "@/lib/robinhood-explore-filters";

export type Checkpoint = { number: string; hash: string };
export type RobinhoodSnapshot = {
  version: 1;
  chainId: 4663;
  routerAddress: string;
  binding: string;
  startBlock: string;
  cursor: Checkpoint | null;
  checkpoints: Checkpoint[];
  finalizedBlock: string;
  updatedAt: string;
  items: RobinhoodLaunch[];
  pending?: { block: Checkpoint; items: RobinhoodLaunch[] } | null;
};

const ADDRESS = /^0x[\da-f]{40}$/i;
const HASH = /^0x[\da-f]{64}$/i;
const BLOCK = /^(0|[1-9]\d{0,19})$/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const matches = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
const date = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const checkpoint = (value: unknown): value is Checkpoint =>
  isObject(value) && matches(value.number, BLOCK) && matches(value.hash, HASH);

export function parseSnapshot(value: unknown): RobinhoodSnapshot {
  if (!isObject(value) || value.version !== 1 || value.chainId !== 4663
    || !matches(value.routerAddress, ADDRESS) || !matches(value.binding, HASH)
    || !matches(value.startBlock, BLOCK) || !matches(value.finalizedBlock, BLOCK)
    || !date(value.updatedAt) || !(value.cursor === null || checkpoint(value.cursor))
    || !Array.isArray(value.checkpoints) || value.checkpoints.length > 16
    || !value.checkpoints.every(checkpoint) || !Array.isArray(value.items)
    || value.items.length > 10_000) throw new Error("Invalid Robinhood index");
  const ids = new Set<string>();
  const tokens = new Set<string>();
  for (const row of value.items) {
    if (!isObject(row)
      || !["routerAddress", "tokenAddress", "hookAddress", "creator", "poolManager"].every((key) => matches(row[key], ADDRESS))
      || !["launchId", "poolId", "stampHash", "transactionHash", "blockHash"].every((key) => matches(row[key], HASH))
      || String(row.routerAddress).toLowerCase() !== value.routerAddress.toLowerCase()
      || !matches(row.blockNumber, BLOCK) || !Number.isSafeInteger(row.logIndex) || Number(row.logIndex) < 0
      || !(row.launchedAt === null || date(row.launchedAt))
      || !["name", "symbol"].every((key) => row[key] === null || (typeof row[key] === "string" && row[key].length <= 128))
      || !(row.decimals === null || (Number.isInteger(row.decimals) && Number(row.decimals) >= 0 && Number(row.decimals) <= 255))
      || value.cursor === null || BigInt(row.blockNumber) > BigInt(value.cursor.number)
      || BigInt(row.blockNumber) < BigInt(value.startBlock)) throw new Error("Invalid Robinhood launch");
    const id = String(row.launchId).toLowerCase();
    const token = String(row.tokenAddress).toLowerCase();
    if (ids.has(id) || tokens.has(token)) throw new Error("Duplicate Robinhood launch");
    ids.add(id);
    tokens.add(token);
  }
  const cursor = value.cursor;
  if (cursor && (BigInt(cursor.number) > BigInt(value.finalizedBlock)
    || value.checkpoints.some((point) => BigInt(point.number) > BigInt(cursor.number)))) {
    throw new Error("Invalid Robinhood checkpoint");
  }
  if (value.pending != null) {
    const pending = asPending(value.pending);
    if (BigInt(pending.block.number) > BigInt(value.finalizedBlock)
      || pending.items.some((row) => row.blockNumber !== pending.block.number || row.blockHash !== pending.block.hash)) {
      throw new Error("Invalid pending block");
    }
    parseSnapshot({ ...value, pending: null, cursor: pending.block, checkpoints: [], items: pending.items });
  }
  return value as RobinhoodSnapshot;
}

function asPending(value: unknown) {
  if (!isObject(value) || !checkpoint(value.block) || !Array.isArray(value.items) || value.items.length === 0) {
    throw new Error("Invalid pending block");
  }
  return value as { block: Checkpoint; items: RobinhoodLaunch[] };
}

export function launchList(snapshot: RobinhoodSnapshot | null, page = 1, query = "", now = Date.now(), filters: RobinhoodExploreFilters = DEFAULT_EXPLORE_FILTERS): RobinhoodLaunchList {
  const q = query.trim().toLowerCase();
  const ageMs = { any: null, "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000 }[filters.age];
  const items = (snapshot?.items ?? []).filter((row) => {
    if (q && ![row.name, row.symbol, row.tokenAddress, row.hookAddress].some((value) => value?.toLowerCase().includes(q))) return false;
    if (ageMs === null) return true;
    const launched = row.launchedAt ? Date.parse(row.launchedAt) : NaN;
    return launched >= now - ageMs && launched <= now;
  }).toSorted((a, b) => {
    const newest = BigInt(a.blockNumber) === BigInt(b.blockNumber)
      ? b.logIndex - a.logIndex : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1;
    return filters.sort === "oldest" ? -newest : newest;
  });
  const totalPages = Math.ceil(items.length / 50);
  const number = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const status = !snapshot ? "unavailable"
    : now - Date.parse(snapshot.updatedAt) > 300_000 ? "stale"
    : snapshot.pending || snapshot.cursor?.number !== snapshot.finalizedBlock ? "syncing" : "ready";
  return {
    chainId: 4663, status, updatedAt: snapshot?.updatedAt ?? null,
    items: items.slice((number - 1) * 50, number * 50),
    page: { number, size: 50, totalItems: items.length, totalPages, hasMore: number < totalPages },
  };
}
