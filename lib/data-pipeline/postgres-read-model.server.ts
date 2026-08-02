import "server-only";

import type { TokenChartRange } from "../onchain/chart";
import type { ExploreSort } from "../onchain/types";

import type { PostgresTransaction } from "./postgres";
import {
  adaptIndexedChartV2,
  adaptIndexedClassicV3ProfileV2,
  adaptIndexedCreatorProfileV2,
  adaptIndexedExploreListV2,
  adaptIndexedLaunchLookupV2,
  adaptIndexedStockPairedProfileV2,
  adaptIndexedTokenDetailV2,
  indexedRouteCacheHeaders,
  type IndexedChartDataV2,
  type IndexedClassicV3ProfileDataV2,
  type IndexedCreatorProfileDataV2,
  type IndexedExploreListDataV2,
  type IndexedLaunchLookupDataV2,
  type IndexedNotReadyReasonV2,
  type IndexedRouteEnvelopeV2,
  type IndexedRouteKeyV2,
  type IndexedRowSourceV2,
  type IndexedSnapshotIdentityV2,
  type IndexedStockPairedProfileDataV2,
  type IndexedTokenDetailDataV2,
} from "./route-adapters.server";

export type IndexedExploreReadRequest = {
  chainId: 1;
  query: string;
  sort: ExploreSort;
  page: number;
  pageSize: number;
};

export type IndexedTokenReadRequest = {
  chainId: 1;
  address: string;
};

export type IndexedChartReadRequest = IndexedTokenReadRequest & {
  range: TokenChartRange;
};

export type IndexedProfileReadRequest = {
  chainId: 1;
  account: string;
};

export type IndexedLaunchLookupRequest = IndexedProfileReadRequest & {
  surface: "classic-v3" | "stock-paired";
  transactionHash: string;
};

/**
 * Each implementation performs the complete route read through the supplied
 * transaction: readiness, immutable pointers, payload, evidence commitments,
 * totals and cursors. It must not acquire a client or start another
 * transaction. The route coordinator owns the surrounding REPEATABLE READ,
 * READ ONLY boundary.
 */
export type IndexedRouteSnapshotQueries = Readonly<{
  explore(
    transaction: PostgresTransaction,
    request: IndexedExploreReadRequest,
  ): Promise<IndexedRouteEnvelopeV2<IndexedExploreListDataV2>>;
  tokenDetail(
    transaction: PostgresTransaction,
    request: IndexedTokenReadRequest,
  ): Promise<IndexedRouteEnvelopeV2<IndexedTokenDetailDataV2>>;
  tokenChart(
    transaction: PostgresTransaction,
    request: IndexedChartReadRequest,
  ): Promise<IndexedRouteEnvelopeV2<IndexedChartDataV2>>;
  creatorProfile(
    transaction: PostgresTransaction,
    request: IndexedProfileReadRequest,
  ): Promise<IndexedRouteEnvelopeV2<IndexedCreatorProfileDataV2>>;
  classicV3Profile(
    transaction: PostgresTransaction,
    request: IndexedProfileReadRequest,
  ): Promise<IndexedRouteEnvelopeV2<IndexedClassicV3ProfileDataV2>>;
  stockPairedProfile(
    transaction: PostgresTransaction,
    request: IndexedProfileReadRequest,
  ): Promise<IndexedRouteEnvelopeV2<IndexedStockPairedProfileDataV2>>;
  launchLookup(
    transaction: PostgresTransaction,
    request: IndexedLaunchLookupRequest,
  ): Promise<IndexedRouteEnvelopeV2<IndexedLaunchLookupDataV2>>;
}>;

export type IndexedRouteResponse<T> = Readonly<{
  status: number;
  body: T;
  headers: Readonly<Record<string, string>>;
}>;

export type AdaptedIndexedRouteSnapshotV2<T> =
  | Readonly<{
      status: "not-ready";
      routeKey: IndexedRouteKeyV2;
      reason: IndexedNotReadyReasonV2;
    }>
  | Readonly<{
      status: "ready";
      routeKey: IndexedRouteKeyV2;
      snapshot: IndexedSnapshotIdentityV2;
      /**
       * Exact source rows used by the DTO adapter. The integration layer must
       * derive `validatedRecordScopeEvidence` from this array and derive its
       * coordinator `versions` from the matching snapshot pointers.
       */
      recordSources: readonly IndexedRowSourceV2[];
      response: IndexedRouteResponse<T>;
    }>;

function notReady(
  routeKey: IndexedRouteKeyV2,
  reason: IndexedNotReadyReasonV2,
): AdaptedIndexedRouteSnapshotV2<never> {
  return Object.freeze({ status: "not-ready", routeKey, reason });
}

function ready<T>(input: {
  routeKey: IndexedRouteKeyV2;
  snapshot: IndexedSnapshotIdentityV2;
  recordSources: readonly IndexedRowSourceV2[];
  response: IndexedRouteResponse<T>;
}): AdaptedIndexedRouteSnapshotV2<T> {
  return Object.freeze({
    status: "ready",
    routeKey: input.routeKey,
    snapshot: input.snapshot,
    recordSources: Object.freeze([...input.recordSources]),
    response: Object.freeze(input.response),
  });
}

/**
 * Pure route adapters for use inside the coordinator's one transaction.
 * These methods never own a connection or transaction.
 */
export function createPostgresPublicRouteSnapshotAdapters(input: {
  queries: IndexedRouteSnapshotQueries;
}) {
  return Object.freeze({
    async explore(
      transaction: PostgresTransaction,
      request: IndexedExploreReadRequest,
    ) {
      const envelope = await input.queries.explore(transaction, request);
      if (envelope.status !== "ready") {
        return notReady("explore-list", envelope.reason);
      }
      const body = adaptIndexedExploreListV2(envelope);
      return ready({
        routeKey: "explore-list",
        snapshot: envelope.snapshot,
        recordSources: envelope.data.tokens.map((token) => token.source),
        response: {
          status: 200,
          body,
          headers: indexedRouteCacheHeaders("explore-list"),
        },
      });
    },

    async tokenDetail(
      transaction: PostgresTransaction,
      request: IndexedTokenReadRequest,
    ) {
      const envelope = await input.queries.tokenDetail(transaction, request);
      if (envelope.status !== "ready") {
        return notReady("explore-token", envelope.reason);
      }
      const body = adaptIndexedTokenDetailV2(envelope);
      const found = body.token !== null;
      return ready({
        routeKey: "explore-token",
        snapshot: envelope.snapshot,
        recordSources: envelope.data.token ? [envelope.data.token.source] : [],
        response: {
          status: found ? 200 : 404,
          body,
          headers: indexedRouteCacheHeaders(
            "token-detail",
            found ? "ready" : "not-found",
          ),
        },
      });
    },

    async tokenChart(
      transaction: PostgresTransaction,
      request: IndexedChartReadRequest,
    ) {
      const envelope = await input.queries.tokenChart(transaction, request);
      if (envelope.status !== "ready") {
        return notReady("explore-chart", envelope.reason);
      }
      const body = adaptIndexedChartV2(envelope);
      return ready({
        routeKey: "explore-chart",
        snapshot: envelope.snapshot,
        recordSources: [envelope.data.source],
        response: {
          status: 200,
          body,
          headers: indexedRouteCacheHeaders("token-chart"),
        },
      });
    },

    async creatorProfile(
      transaction: PostgresTransaction,
      request: IndexedProfileReadRequest,
    ) {
      const envelope = await input.queries.creatorProfile(transaction, request);
      if (envelope.status !== "ready") {
        return notReady("creator-profile", envelope.reason);
      }
      const body = adaptIndexedCreatorProfileV2(envelope);
      return ready({
        routeKey: "creator-profile",
        snapshot: envelope.snapshot,
        recordSources: [
          ...envelope.data.tokens.map((token) => token.source),
          ...envelope.data.claims.map((claim) => claim.source),
        ],
        response: {
          status: 200,
          body,
          headers: indexedRouteCacheHeaders("creator-profile"),
        },
      });
    },

    async classicV3Profile(
      transaction: PostgresTransaction,
      request: IndexedProfileReadRequest,
    ) {
      const envelope = await input.queries.classicV3Profile(
        transaction,
        request,
      );
      if (envelope.status !== "ready") {
        return notReady("classic-v3-profile", envelope.reason);
      }
      const body = adaptIndexedClassicV3ProfileV2(envelope);
      return ready({
        routeKey: "classic-v3-profile",
        snapshot: envelope.snapshot,
        recordSources: envelope.data.rewards.map((reward) => reward.source),
        response: {
          status: 200,
          body,
          headers: indexedRouteCacheHeaders("classic-v3-profile"),
        },
      });
    },

    async stockPairedProfile(
      transaction: PostgresTransaction,
      request: IndexedProfileReadRequest,
    ) {
      const envelope = await input.queries.stockPairedProfile(
        transaction,
        request,
      );
      if (envelope.status !== "ready") {
        return notReady("creator-profile", envelope.reason);
      }
      const body = adaptIndexedStockPairedProfileV2(envelope);
      return ready({
        routeKey: "creator-profile",
        snapshot: envelope.snapshot,
        recordSources: envelope.data.rewards.map((reward) => reward.source),
        response: {
          status: 200,
          body,
          headers: indexedRouteCacheHeaders("stock-paired-profile"),
        },
      });
    },

    async launchLookup(
      transaction: PostgresTransaction,
      request: IndexedLaunchLookupRequest,
    ) {
      const envelope = await input.queries.launchLookup(transaction, request);
      if (envelope.status !== "ready") {
        return notReady("launch-lookup", envelope.reason);
      }
      const body = adaptIndexedLaunchLookupV2(envelope);
      return ready({
        routeKey: "launch-lookup",
        snapshot: envelope.snapshot,
        recordSources: envelope.data.token ? [envelope.data.token.source] : [],
        response: {
          status: body.status === "pending" ? 202 : 200,
          body,
          headers: indexedRouteCacheHeaders("launch-lookup"),
        },
      });
    },
  });
}
