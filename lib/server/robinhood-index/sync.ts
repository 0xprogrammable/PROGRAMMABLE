import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import { parseSnapshot, type Checkpoint, type RobinhoodSnapshot } from "./model";
import type { IndexStore } from "./store";

export type IndexSource = {
  routerAddress: string;
  binding: string;
  startBlock: bigint;
  finalized: Checkpoint;
  block(number: bigint): Promise<Checkpoint>;
  launches(from: bigint, to: bigint, known: readonly RobinhoodLaunch[]): Promise<RobinhoodLaunch[]>;
};

export class IndexRangeTooWide extends Error {}
export class IndexBlockIncomplete extends Error {
  constructor(readonly items: RobinhoodLaunch[]) { super("Block verification continues on next pass"); }
}

// Only the background job uses the source. A failed range is retried from its
// beginning; neither an RPC error nor partial verification advances the cursor.
export async function syncRobinhoodIndex(source: IndexSource, store: IndexStore, options: {
  rangeSize?: bigint; maxRanges?: number; budgetMs?: number; now?: () => number;
} = {}) {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? 45_000);
  const saved = await store.read();
  let snapshot: RobinhoodSnapshot = saved?.snapshot ?? {
    version: 1, chainId: 4663, routerAddress: source.routerAddress, binding: source.binding,
    startBlock: source.startBlock.toString(), cursor: null, checkpoints: [],
    finalizedBlock: source.finalized.number, updatedAt: new Date(now()).toISOString(), items: [],
  };
  if (snapshot.binding !== source.binding || snapshot.routerAddress.toLowerCase() !== source.routerAddress.toLowerCase()
    || snapshot.startBlock !== source.startBlock.toString()) throw new Error("Canonical Router changed; index migration required");
  const boundary = BigInt(source.finalized.number);
  let rewound = false;
  let progress = false;
  if (snapshot.cursor) {
    const canonical = BigInt(snapshot.cursor.number) <= boundary
      ? await source.block(BigInt(snapshot.cursor.number)) : null;
    if (!canonical || canonical.hash.toLowerCase() !== snapshot.cursor.hash.toLowerCase()) {
      let ancestor: Checkpoint | null = null;
      for (const point of snapshot.checkpoints.toReversed()) {
        if (BigInt(point.number) > boundary) continue;
        if ((await source.block(BigInt(point.number))).hash.toLowerCase() === point.hash.toLowerCase()) {
          ancestor = point;
          break;
        }
      }
      snapshot = { ...snapshot, cursor: ancestor, pending: null,
        checkpoints: snapshot.checkpoints.filter((point) => ancestor && BigInt(point.number) <= BigInt(ancestor.number)),
        items: snapshot.items.filter((row) => ancestor && BigInt(row.blockNumber) <= BigInt(ancestor.number)),
      };
      rewound = true;
    }
  }
  let rangeSize = options.rangeSize ?? 10_000n;
  if (rangeSize < 1n) throw new Error("Invalid range size");
  // Re-read up to 64 blocks, without moving a cursor backwards when an operator
  // uses smaller RPC ranges.
  const overlap = rangeSize - 1n < 63n ? rangeSize - 1n : 63n;
  let from = snapshot.cursor ? BigInt(snapshot.cursor.number) - overlap : source.startBlock;
  if (from < source.startBlock) from = source.startBlock;
  if (snapshot.pending) {
    if (BigInt(snapshot.pending.block.number) > boundary
      || (await source.block(BigInt(snapshot.pending.block.number))).hash !== snapshot.pending.block.hash) {
      snapshot = { ...snapshot, pending: null };
      progress = true;
    } else from = BigInt(snapshot.pending.block.number);
  }
  let ranges = 0;
  let failed = false;
  let reductions = 0;
  while (from <= boundary && ranges < (options.maxRanges ?? 48) && now() < deadline) {
    const to = snapshot.pending ? from : from + rangeSize - 1n < boundary ? from + rangeSize - 1n : boundary;
    try {
      const end = await source.block(to);
      const rows = await source.launches(from, to, [...snapshot.items, ...(snapshot.pending?.items ?? [])]);
      if ((await source.block(to)).hash.toLowerCase() !== end.hash.toLowerCase()) throw new Error("Range changed");
      const items = snapshot.items.filter((row) => BigInt(row.blockNumber) < from || BigInt(row.blockNumber) > to);
      items.push(...rows);
      const cursor = snapshot.cursor && BigInt(snapshot.cursor.number) > to ? snapshot.cursor : end;
      snapshot = parseSnapshot({ ...snapshot, cursor, pending: null,
        finalizedBlock: source.finalized.number,
        checkpoints: [...snapshot.checkpoints.filter((point) => point.number !== end.number), end]
          .sort((a, b) => BigInt(a.number) < BigInt(b.number) ? -1 : 1).slice(-16),
        updatedAt: new Date(now()).toISOString(), items,
      });
      ranges += 1;
      from = to + 1n;
    } catch (error) {
      if (error instanceof IndexBlockIncomplete && from === to) {
        const end = await source.block(to);
        snapshot = parseSnapshot({ ...snapshot, finalizedBlock: source.finalized.number,
          pending: { block: end, items: error.items }, updatedAt: new Date(now()).toISOString() });
        progress = true;
        break;
      }
      if (error instanceof IndexRangeTooWide && to > from && reductions < 16) {
        rangeSize = (to - from + 1n) / 2n;
        // The old cursor's canonical hash was already checked. If replay itself
        // consumes the provider budget, resume there instead of replaying the
        // same earlier overlap forever; every new block is still scanned.
        if (snapshot.cursor && from + rangeSize - 1n < BigInt(snapshot.cursor.number)) {
          from = BigInt(snapshot.cursor.number);
        }
        reductions += 1;
        continue;
      }
      failed = true;
      break;
    }
  }
  if ((await source.block(boundary)).hash.toLowerCase() !== source.finalized.hash.toLowerCase()) {
    throw new Error("Finalized boundary changed");
  }
  if (ranges > 0 || rewound || progress) {
    // Compare-and-swap: a concurrent job must not overwrite a newer checkpoint.
    await store.write(snapshot, saved?.etag ?? null);
  }
  return { status: failed ? "partial" : !snapshot.pending && snapshot.cursor?.number === source.finalized.number ? "ready" : "syncing",
    ranges, launches: snapshot.items.length, indexedThrough: snapshot.cursor?.number ?? null,
    finalizedBlock: source.finalized.number, rewound };
}
