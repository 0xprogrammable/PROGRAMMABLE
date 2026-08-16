import "server-only";

import baseline from
  "../../docs/data-pipeline/envio-candidate-7f24e63-baseline-20260801T042058Z.json";
import { canonicalTokenExploreEntryV1 } from "../explore-entry-v1";
import { getOnchainDeployment } from "../onchain/config";
import { readDurableExploreModel } from "../onchain/durable-model";
import type { ExploreEntry, LauncherToken } from "../tokens";

const CATALOG_CACHE_TTL_MS = 60_000;
const COMMITTED_BASELINE_FILE_SHA256 =
  "2305e0782d4ad34132afbb753e3abb0f22add937f04e3de12d35188e49eb6b36";
const COMMITTED_BASELINE_INVENTORY_SHA256 =
  "0x5a388ae00ff52fd63abf45560cdb456cafe883c17249cabce83ca31286104c6d";

type CatalogSource = "durable-blob" | "committed-envio-baseline";

export type LastGoodLaunchCatalogV1 = Readonly<{
  source: CatalogSource;
  status: "current" | "last-known-good" | "partial";
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
    kind: "durable-envelope" | "committed-file";
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
  if (deployment.status === "ready") {
    try {
      const durable = await readDurableExploreModel(deployment);
      if (durable.status === "ready" || durable.reason === "stale") {
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
    } catch {
      // The committed evidence is the fail-soft identity floor. A Blob
      // transport or parser failure must never turn a market page into 503.
    }
  }
  return committedBaselineCatalog();
}

function committedBaselineCatalog(): LastGoodLaunchCatalogV1 {
  if (
    baseline.kind !== "envio-launch-inventory-baseline" ||
    baseline.capturedAt !== "2026-08-01T04:20:58.618Z" ||
    baseline.inventory.count !== 265 ||
    baseline.inventory.sha256 !== COMMITTED_BASELINE_INVENTORY_SHA256
  ) {
    throw new Error("Committed launch fallback evidence is invalid");
  }
  const entries = baseline.entries
    .filter((entry) => entry.isComplete && entry.provenanceValid)
    .map(baselineEntry);
  if (entries.length !== 213) {
    throw new Error("Committed launch fallback identity count changed");
  }
  assertUniqueEntries(entries);
  return {
    source: "committed-envio-baseline",
    status: "partial",
    generatedAt: baseline.capturedAt,
    asOfBlock: baseline.anchor.stateProgressBlock,
    asOfBlockHash: baseline.anchor.stateProgressBlockHash as `0x${string}`,
    entries,
    completeness: {
      classic: "last-known-good",
      stock: "unavailable",
      custom: "unavailable",
    },
    evidence: {
      kind: "committed-file",
      commitment: `sha256:${COMMITTED_BASELINE_FILE_SHA256}`,
    },
  };
}

function baselineEntry(
  entry: (typeof baseline.entries)[number],
): ExploreEntry {
  if (
    entry.chainId !== 1 ||
    entry.model !== "classic" ||
    (entry.releaseVersion !== "classic-v2" &&
      entry.releaseVersion !== "classic-v3") ||
    !address(entry.token) ||
    !address(entry.hook) ||
    !bytes32(entry.poolId) ||
    !address(entry.creator) ||
    !bytes32(entry.launchHash) ||
    (entry.releaseVersion === "classic-v2"
      ? !unsigned(entry.totalSwapFeeBps)
      : !unsigned(entry.buySwapFeeBps) || !unsigned(entry.sellSwapFeeBps))
  ) {
    throw new Error(`Committed launch fallback contains invalid ${entry.id}`);
  }
  const label = `${entry.token.slice(0, 6)}…${entry.token.slice(-4)}`;
  const token: LauncherToken = {
    id: `1:${entry.token}`,
    // The historical evidence deliberately carries identity, not ERC-20
    // metadata. Showing the exact address is honest; inventing a name is not.
    name: entry.token,
    symbol: label,
    tokenAddress: entry.token as `0x${string}`,
    hookAddress: entry.hook as `0x${string}`,
    poolId: entry.poolId as `0x${string}`,
    creatorAddress: entry.creator as `0x${string}`,
    ...(address(entry.positionRecipient)
      ? { positionRecipient: entry.positionRecipient as `0x${string}` }
      : {}),
    ...(unsignedText(entry.positionTokenId)
      ? { positionTokenId: entry.positionTokenId }
      : {}),
    launchHash: entry.launchHash as `0x${string}`,
    // The archive has no per-launch timestamp. Its capture timestamp is used
    // only as a deterministic ordering floor and is disclosed at response
    // level as `lastIndexedAt`, never as fresh launch evidence.
    launchedAt: baseline.capturedAt,
    totalSwapFeeBps: entry.releaseVersion === "classic-v2"
      ? entry.totalSwapFeeBps as number
      : Math.max(entry.buySwapFeeBps as number, entry.sellSwapFeeBps as number),
    ...(entry.releaseVersion === "classic-v3"
      ? {
          buyHookFeeBps: entry.buySwapFeeBps as number,
          sellHookFeeBps: entry.sellSwapFeeBps as number,
        }
      : {}),
    liquidityPath: "meme",
    launchModel: "classic",
    ...(entry.releaseVersion === "classic-v3"
      ? { launchModelVersion: "classic-v3" as const }
      : {}),
  };
  return canonicalTokenExploreEntryV1(token);
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

function address(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/u.test(value);
}

function bytes32(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/u.test(value);
}

function unsigned(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function unsignedText(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

export const LAST_GOOD_LAUNCH_BASELINE_EVIDENCE_V1 = Object.freeze({
  capturedAt: "2026-08-01T04:20:58.618Z",
  fileSha256: COMMITTED_BASELINE_FILE_SHA256,
  inventorySha256: COMMITTED_BASELINE_INVENTORY_SHA256,
  verifiedFallbackCount: 213,
  advertisedArchiveCount: 265,
});
