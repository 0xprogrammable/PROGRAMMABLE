import type { ExploreReadModel } from "../../../../lib/onchain/types";

// Retained as a type-only compatibility surface for the old, disconnected
// read-model modules until their files are removed by the integration owner.
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

export const INDEXER_READY_CACHE_CONTROL =
  "public, max-age=0, s-maxage=2, stale-while-revalidate=2";

export function alchemyFeedHeaders(
  cacheControl = INDEXER_READY_CACHE_CONTROL,
): Readonly<Record<string, string>> {
  return Object.freeze({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers":
      "X-Programmable-Launch-Source, X-Programmable-Read-Source, X-Programmable-Rpc-Provider",
    "Cache-Control": cacheControl,
    "X-Programmable-Launch-Source": "durable-read-model",
    "X-Programmable-Read-Source": "blob",
    "X-Programmable-Rpc-Provider": "drpc+quicknode",
  });
}

export const ALCHEMY_NO_STORE_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers":
    "X-Programmable-Launch-Source, X-Programmable-Read-Source, X-Programmable-Rpc-Provider",
  "Cache-Control": "no-store",
  "X-Programmable-Launch-Source": "durable-read-model",
  "X-Programmable-Read-Source": "blob",
  "X-Programmable-Rpc-Provider": "drpc+quicknode",
});
