import type { ExploreReadModel } from "../../../../lib/onchain/types";

export type IndexedFeedSnapshot = Readonly<{
  chainId: 1;
  model: ExploreReadModel & { status: "ready" };
  capturedAt: string;
  snapshotCommitment: `0x${string}`;
  sourceCommitment: `0x${string}`;
  projectionLag: number;
  reconciledAt: string;
  releaseVersions: readonly string[];
}>;

const EXPOSED_PROVENANCE_HEADERS = [
  "X-Programmable-Read-Source",
  "X-Programmable-Projection-Block",
  "X-Programmable-Projection-Hash",
  "X-Programmable-Projection-Lag",
  "X-Programmable-Reconciled-At",
  "X-Programmable-Release-Version",
  "X-Programmable-Snapshot-Commitment",
  "X-Programmable-Source-Commitment",
] as const;

export const INDEXER_READY_CACHE_CONTROL =
  "public, max-age=0, s-maxage=2, stale-while-revalidate=2";

const BYTES32 = /^0x[0-9a-f]{64}$/;
const RELEASE_VERSION = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function exactTimestamp(value: string, field: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`Indexed feed ${field} is invalid`);
  }
}

function assertHeaderEvidence(snapshot: IndexedFeedSnapshot) {
  if (
    !snapshot.model.snapshot ||
    snapshot.model.snapshot.chainId !== snapshot.chainId ||
    !BYTES32.test(snapshot.model.snapshot.blockHash) ||
    !BYTES32.test(snapshot.snapshotCommitment) ||
    !BYTES32.test(snapshot.sourceCommitment) ||
    !Number.isSafeInteger(snapshot.projectionLag) ||
    snapshot.projectionLag < 0 ||
    snapshot.projectionLag > 1_000_000 ||
    snapshot.releaseVersions.length === 0 ||
    snapshot.releaseVersions.length > 32 ||
    snapshot.releaseVersions.some(
      (release, index) =>
        !RELEASE_VERSION.test(release) ||
        release.length > 64 ||
        (index > 0 && snapshot.releaseVersions[index - 1]! >= release),
    )
  ) {
    throw new Error("Indexed feed provenance is invalid");
  }
  exactTimestamp(snapshot.capturedAt, "capture time");
  exactTimestamp(snapshot.reconciledAt, "reconciliation time");
}

export function indexedFeedHeaders(
  snapshot: IndexedFeedSnapshot,
  cacheControl = INDEXER_READY_CACHE_CONTROL,
): Readonly<Record<string, string>> {
  assertHeaderEvidence(snapshot);

  return Object.freeze({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": EXPOSED_PROVENANCE_HEADERS.join(", "),
    "Cache-Control": cacheControl,
    "X-Programmable-Read-Source": "indexed",
    "X-Programmable-Projection-Block":
      snapshot.model.snapshot!.blockNumber,
    "X-Programmable-Projection-Hash": snapshot.model.snapshot!.blockHash,
    "X-Programmable-Projection-Lag": String(snapshot.projectionLag),
    "X-Programmable-Reconciled-At": snapshot.reconciledAt,
    "X-Programmable-Release-Version": snapshot.releaseVersions.join(","),
    "X-Programmable-Snapshot-Commitment": snapshot.snapshotCommitment,
    "X-Programmable-Source-Commitment": snapshot.sourceCommitment,
  });
}

export const INDEXER_NO_STORE_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
});
