import "server-only";

import {
  optimisticOverlayRowsFromSnapshot,
  readConfiguredOptimisticLiveSnapshot,
} from "./optimistic-live-runtime.server";
import {
  OPTIMISTIC_PUBLIC_API_SNAPSHOT_VERSION,
  type OptimisticPublicApiReaderPort,
  type OptimisticPublicReleaseVersion,
} from "./optimistic-public-api-overlay.server";

function releaseVersionForToken(
  token: Readonly<{
    launchModel?: string;
    launchModelVersion?: string;
  }>,
): OptimisticPublicReleaseVersion | null {
  if (
    token.launchModelVersion === "classic-v3" ||
    token.launchModelVersion === "stock-paired-v1" ||
    token.launchModelVersion === "stock-paired-v2" ||
    token.launchModelVersion === "stock-paired-v3"
  ) {
    return token.launchModelVersion;
  }
  return token.launchModel === "classic" ? "classic-v2" : null;
}

/**
 * Production adapter for the public API overlay. The runtime reader performs
 * one repeatable-read transaction under the API-reader role and returns only
 * the bounded current optimistic chain, including its durable market states.
 */
export const CONFIGURED_OPTIMISTIC_PUBLIC_API_READER = Object.freeze({
  async read(chainId) {
    const snapshot = await readConfiguredOptimisticLiveSnapshot(chainId);
    if (!snapshot.head) return null;
    const head = snapshot.head;
    return Object.freeze({
      materialize({ canonicalTokens }) {
        const rows = optimisticOverlayRowsFromSnapshot({
          snapshot,
          canonicalTokens,
        });
        const marketEvidence = new Map(
          snapshot.marketStates.map((state) => [
            `${state.blockHash}:${state.poolId.toLowerCase()}`,
            Object.freeze({
              providerHeads: state.providerHeads,
              optimisticMarketStateId: state.optimisticMarketStateId,
            }),
          ] as const),
        );
        const releasesByPool = new Map<string, OptimisticPublicReleaseVersion>();
        for (const token of canonicalTokens) {
          const releaseVersion = releaseVersionForToken(token);
          if (releaseVersion) {
            releasesByPool.set(token.poolId.toLowerCase(), releaseVersion);
          }
        }
        for (const row of rows) {
          if (row.kind !== "launch") continue;
          const releaseVersion = releaseVersionForToken(row.token);
          if (releaseVersion) {
            releasesByPool.set(row.poolId.toLowerCase(), releaseVersion);
          }
        }
        return Object.freeze({
          version: OPTIMISTIC_PUBLIC_API_SNAPSHOT_VERSION,
          source: "postgres-current-optimistic-chain" as const,
          chainId,
          head: Object.freeze({
            blockNumber: head.blockNumber,
            blockHash: head.blockHash,
            providerHeads: head.providerHeads,
            reorgGeneration: head.reorgGeneration,
            observedAt: head.observedAt,
            canonicalAt: head.canonicalAt,
          }),
          blocks: Object.freeze(
            snapshot.blocks.map((block) => Object.freeze({
              blockNumber: block.blockNumber,
              blockHash: block.blockHash,
              parentHash: block.parentHash,
              reorgGeneration: block.reorgGeneration,
            })),
          ),
          rows: Object.freeze(
            rows.map((row) => {
              const persistedMarket = row.kind === "market"
                ? marketEvidence.get(
                    `${row.evidence.blockHash}:${row.poolId.toLowerCase()}`,
                  )
                : null;
              const providerHeads = persistedMarket?.providerHeads ??
                (row.kind === "launch" ? head.providerHeads : null);
              const releaseVersion = releasesByPool.get(
                row.poolId.toLowerCase(),
              );
              if (!providerHeads || !releaseVersion) {
                throw new Error("Optimistic market provider evidence is missing");
              }
              return Object.freeze({
                reorgGeneration: head.reorgGeneration,
                providerHeads,
                releaseVersion,
                optimisticMarketStateId:
                  persistedMarket?.optimisticMarketStateId ?? null,
                row,
              });
            }),
          ),
        });
      },
    });
  },
}) satisfies OptimisticPublicApiReaderPort;
