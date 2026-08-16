import "server-only";

import { canonicalTokenExploreEntryV1 } from "../explore-entry-v1";
import { getOnchainDeployment } from "../onchain/config";
import { readDurableExploreModel } from "../onchain/durable-model";
import { canonicalSha256 } from "../server/projection-target/hashing";
import type { ExploreEntry } from "../tokens";

const CATALOG_CACHE_TTL_MS = 60_000;
const CATALOG_READ_TIMEOUT_MS = 5_000;
type CatalogSource = "durable-blob";

export type LastGoodLaunchCatalogReadOptionsV1 = Readonly<{
  signal?: AbortSignal;
  /** Absolute Unix epoch deadline, in milliseconds. */
  deadlineMs?: number;
}>;

export type LastGoodLaunchCatalogV1 = Readonly<{
  source: CatalogSource;
  status: "current" | "last-known-good";
  generatedAt: string;
  asOfBlock: string | null;
  asOfBlockHash: `0x${string}` | null;
  entries: readonly ExploreEntry[];
  completeness: Readonly<{
    classic: "current" | "last-known-good";
    stock: "current" | "last-known-good" | "unavailable";
    custom: "unavailable";
  }>;
  evidence: Readonly<{
    kind: "durable-envelope";
    commitment: string;
  }>;
}>;

let cached: Readonly<{ expiresAt: number; catalog: LastGoodLaunchCatalogV1 }> |
  null = null;
type CatalogFlight = {
  promise: Promise<LastGoodLaunchCatalogV1>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
};
let inFlight: CatalogFlight | null = null;

export async function readLastGoodLaunchCatalogV1(
  options: LastGoodLaunchCatalogReadOptionsV1 = {},
): Promise<
  LastGoodLaunchCatalogV1
> {
  assertCatalogCallerActive(options);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.catalog;
  const flight = inFlight ?? createCatalogFlight();
  return await waitForCatalogFlight(flight, options);
}

function createCatalogFlight() {
  const controller = new AbortController();
  const flight: CatalogFlight = {
    promise: Promise.resolve(undefined as never),
    controller,
    waiters: 0,
    settled: false,
  };
  flight.promise = readUncached({
    signal: controller.signal,
    deadlineMs: Date.now() + CATALOG_READ_TIMEOUT_MS,
  }).then((catalog) => {
    cached = { expiresAt: Date.now() + CATALOG_CACHE_TTL_MS, catalog };
    return catalog;
  }).finally(() => {
    flight.settled = true;
    if (inFlight === flight) inFlight = null;
  });
  inFlight = flight;
  return flight;
}

async function waitForCatalogFlight(
  flight: CatalogFlight,
  options: LastGoodLaunchCatalogReadOptionsV1,
) {
  flight.waiters += 1;
  try {
    return await waitForCatalogCaller(flight.promise, options);
  } finally {
    flight.waiters -= 1;
    if (
      flight.waiters === 0 &&
      !flight.settled &&
      inFlight === flight &&
      !flight.controller.signal.aborted
    ) {
      flight.controller.abort(
        new Error("Durable launch catalog has no active readers"),
      );
    }
  }
}

function waitForCatalogCaller<T>(
  operation: Promise<T>,
  options: LastGoodLaunchCatalogReadOptionsV1,
): Promise<T> {
  assertCatalogCallerActive(options);
  if (options.signal === undefined && options.deadlineMs === undefined) {
    return operation;
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const complete = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortFromCaller);
      callback();
    };
    const abortFromCaller = () => complete(() => reject(
      options.signal?.reason ?? new Error("Durable launch catalog read aborted"),
    ));
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const remainingMs = options.deadlineMs === undefined
      ? undefined
      : options.deadlineMs - Date.now();
    const timer = remainingMs === undefined
      ? undefined
      : setTimeout(
          () => complete(() => reject(
            new Error("Durable launch catalog deadline exceeded"),
          )),
          Math.max(0, remainingMs),
        );
    operation.then(
      (value) => complete(() => resolve(value)),
      (error) => complete(() => reject(error)),
    );
  });
}

function assertCatalogCallerActive(
  options: LastGoodLaunchCatalogReadOptionsV1,
) {
  if (
    options.deadlineMs !== undefined &&
    !Number.isFinite(options.deadlineMs)
  ) {
    throw new Error("Durable launch catalog deadline is invalid");
  }
  if (options.signal?.aborted) {
    throw options.signal.reason ??
      new Error("Durable launch catalog read aborted");
  }
  if (options.deadlineMs !== undefined && options.deadlineMs <= Date.now()) {
    throw new Error("Durable launch catalog deadline exceeded");
  }
}

async function readUncached(
  options: LastGoodLaunchCatalogReadOptionsV1,
): Promise<LastGoodLaunchCatalogV1> {
  const deployment = getOnchainDeployment("production");
  if (deployment.status !== "ready") {
    throw new Error("Production launch deployment is unavailable");
  }
  const durable = await readDurableExploreModel(deployment, options);
  if (durable.status !== "ready" && durable.reason !== "stale") {
    throw new Error(`Durable launch catalog is ${durable.reason}`);
  }
  const payload = durable.envelope.payload;
  const entries = payload.model.tokens.map(canonicalTokenExploreEntryV1);
  assertUniqueEntries(entries);
  return {
    source: "durable-blob",
    status: durable.status === "ready" ? "current" : "last-known-good",
    generatedAt: payload.generatedAt,
    asOfBlock: payload.model.snapshot.blockNumber,
    asOfBlockHash: payload.model.snapshot.blockHash,
    entries,
    completeness: {
      classic: durable.status === "ready" ? "current" : "last-known-good",
      stock: "unavailable",
      custom: "unavailable",
    },
    evidence: {
      kind: "durable-envelope",
      commitment: durable.envelope.contentHash,
    },
  };
}

function assertUniqueEntries(entries: readonly ExploreEntry[]) {
  const ids = new Set<string>();
  const tokens = new Set<string>();
  for (const entry of entries) {
    const token = entry.tokenAddress?.toLowerCase();
    if (ids.has(entry.id) || (token !== undefined && tokens.has(token))) {
      throw new Error("Launch catalog contains duplicate identities");
    }
    ids.add(entry.id);
    if (token !== undefined) tokens.add(token);
  }
}

export function mergeLastGoodLaunchCatalogEntriesV1(
  canonical: readonly ExploreEntry[],
  custom: readonly ExploreEntry[],
) {
  const producedCustomEntries = custom.filter((entry) =>
    entry.exploreKind === "custom-project" &&
    (entry.tokenAddress !== undefined || entry.markets.length > 0)
  );
  const entries = Object.freeze([...canonical, ...producedCustomEntries]);
  assertUniqueEntries(entries);
  return entries;
}

export function lastGoodLaunchIdentityCommitmentV1(
  catalog: LastGoodLaunchCatalogV1,
  entries: readonly ExploreEntry[],
) {
  return canonicalSha256("programmable.fast-lane-identity.v1", {
    source: catalog.source,
    generatedAt: catalog.generatedAt,
    asOfBlock: catalog.asOfBlock,
    asOfBlockHash: catalog.asOfBlockHash,
    durableCommitment: catalog.evidence.commitment,
    entries: [...entries]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) => entry.exploreKind === "token"
        ? {
            kind: entry.exploreKind,
            id: entry.id,
            tokenAddress: entry.tokenAddress,
            poolId: entry.poolId,
            provenance: entry.launchCategoryProvenance,
          }
        : {
            kind: entry.exploreKind,
            id: entry.id,
            customProjectId: entry.customProjectId,
            customLaunchId: entry.customLaunchId,
            tokenAddress: entry.tokenAddress ?? null,
            markets: entry.markets.map((market) => ({
              marketId: market.marketId,
              kind: market.kind,
              status: market.status,
              poolId: market.poolId ?? null,
              baseAsset: market.baseAsset.identity,
              quoteAsset: market.quoteAsset.identity,
            })),
            provenance: entry.launchCategoryProvenance,
          }),
  });
}
