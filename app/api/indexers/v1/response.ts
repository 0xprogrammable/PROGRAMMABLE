import type { ExploreReadModel } from "../../../../lib/onchain/types";

// Internal projector compatibility only. Public indexer routes are retired.
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

export const RETIRED_INDEXER_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "X-Programmable-Read-Source": "retired",
});

export const RETIRED_INDEXER_RESPONSE = Object.freeze({
  error: "This indexer feed has been retired. Use /api/explore.",
});
