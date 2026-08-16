import "server-only";

import { canonicalTokenExploreEntryV1 } from "../explore-entry-v1";
import { getOnchainDeployment } from "../onchain/config";
import { readDurableExploreModel } from "../onchain/durable-model";
import { canonicalSha256 } from "../server/projection-target/hashing";
import type { ExploreEntry } from "../tokens";

const CATALOG_CACHE_TTL_MS = 60_000;
type CatalogSource = "durable-blob";

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
let inFlight: Promise<LastGoodLaunchCatalogV1> | null = null;

export async function readLastGoodLaunchCatalogV1(): Promise<
  LastGoodLaunchCatalogV1
> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.catalog;
  if (inFlight) return await inFlight;
  inFlight = readUncached().then((catalog) => {
    cached = { expiresAt: Date.now() + CATALOG_CACHE_TTL_MS, catalog };
    return catalog;
  }).finally(() => {
    inFlight = null;
  });
  return await inFlight;
}

async function readUncached(): Promise<LastGoodLaunchCatalogV1> {
  const deployment = getOnchainDeployment("production");
  if (deployment.status !== "ready") {
    throw new Error("Production launch deployment is unavailable");
  }
  const durable = await readDurableExploreModel(deployment);
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
  const entries = Object.freeze([...canonical, ...custom]);
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
