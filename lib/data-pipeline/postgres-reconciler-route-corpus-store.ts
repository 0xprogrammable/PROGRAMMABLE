import "server-only";

import { hexToBytes, parseNonnegativeIntegerText } from "./codecs";
import { assertClassicV3ReconcilerRouteSet } from "./classic-v3-reconciler-route-contract";
import { validationError } from "./errors";
import type { PostgresExecutor } from "./postgres";
import { createReconcilerDatabaseGateway } from "./postgres-reconciler";
import {
  RECONCILER_ROUTE_KEYS,
  type ReconcilerIndexedRouteStore,
  type ReconcilerRouteDto,
  type ReconcilerRouteKey,
} from "./reconciler-preparity";

const ROUTE_KEYS = new Set<string>(RECONCILER_ROUTE_KEYS);

function routeKey(value: unknown): ReconcilerRouteKey {
  if (typeof value !== "string" || !ROUTE_KEYS.has(value)) {
    throw validationError("postgres", "reconciler-corpus-route-key");
  }
  return value as ReconcilerRouteKey;
}

function comparedCount(value: unknown): number {
  let parsed: bigint;
  try {
    parsed = BigInt(parseNonnegativeIntegerText(value, 19));
  } catch {
    throw validationError("postgres", "reconciler-corpus-count");
  }
  if (parsed < 1n || parsed > 1_000_000n) {
    throw validationError("postgres", "reconciler-corpus-count");
  }
  return Number(parsed);
}

function json(value: unknown): ReconcilerRouteDto["dto"] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw validationError("postgres", "reconciler-corpus-json");
    }
  }
  if (parsed === null || typeof parsed !== "object") {
    throw validationError("postgres", "reconciler-corpus-json");
  }
  return parsed as ReconcilerRouteDto["dto"];
}

export function createPostgresReconcilerRouteCorpusStore(input: {
  executor: PostgresExecutor;
}): ReconcilerIndexedRouteStore {
  const gateway = createReconcilerDatabaseGateway(input);
  return Object.freeze({
    async readExactIndexedRouteCorpus({
      contract,
      maximumEntityCount,
      signal,
    }) {
      if (signal.aborted) {
        throw validationError("postgres", "reconciler-corpus-aborted");
      }
      return gateway.transaction(async (transaction) => {
        const rows = await transaction.query<{
          route_key: unknown;
          compared_count: unknown;
          dto: unknown;
        }>(
          `select *
           from programmable_private.get_reconciler_route_corpus_v1(
             $1::bigint, $2::text, $3::text, $4::text, $5::uuid,
             $6::bigint, $7::uuid, $8::numeric, $9::bytea, $10::integer
           )`,
          [
            contract.chainId,
            contract.releaseId,
            contract.modelId,
            contract.sourceGroup,
            contract.epochId,
            contract.pointerGeneration,
            contract.checkpointId,
            contract.checkpointBlockNumber,
            hexToBytes(contract.checkpointBlockHash),
            maximumEntityCount,
          ],
        );
        if (signal.aborted || rows.length !== RECONCILER_ROUTE_KEYS.length) {
          throw validationError("postgres", "reconciler-corpus-cardinality");
        }
        const parsed = rows.map((row) => Object.freeze({
          routeKey: routeKey(row.route_key),
          comparedCount: comparedCount(row.compared_count),
          dto: json(row.dto),
        }));
        if (
          parsed.some(
            (row, index) => row.routeKey !== RECONCILER_ROUTE_KEYS[index],
          )
        ) {
          throw validationError("postgres", "reconciler-corpus-order");
        }
        return Object.freeze(assertClassicV3ReconcilerRouteSet(parsed));
      });
    },
  });
}
