import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import { createPostgresReconcilerRouteCorpusStore } from "../../lib/data-pipeline/postgres-reconciler-route-corpus-store";
import {
  RECONCILER_ROUTE_KEYS,
  type ReconcilerPreParityContract,
} from "../../lib/data-pipeline/reconciler-preparity";
import {
  classicV3ReconcilerRouteFixture,
  ROUTE_FIXTURE_ADDRESS,
} from "./classic-v3-reconciler-route-fixture";

const HASH = `0x${"11".repeat(32)}` as const;
const contract: ReconcilerPreParityContract = {
  chainId: "1",
  releaseId: "classic-v3",
  modelId: "classic",
  sourceGroup: "ethereum-mainnet",
  projectorVersion: "projector-v1",
  epochId: "10000000-0000-4000-8000-000000000001",
  pointerGeneration: "7",
  checkpointId: "10000000-0000-4000-8000-000000000002",
  checkpointGeneration: "11",
  reorgGeneration: "0",
  checkpointBlockNumber: "25700000",
  checkpointBlockHash: HASH,
  routeKeys: RECONCILER_ROUTE_KEYS,
  routeContract: {},
  projectionContract: {},
  currentEntities: [],
};

class CorpusExecutor implements PostgresExecutor {
  readonly applicationQueries: {
    text: string;
    values: readonly PostgresParameter[];
  }[] = [];
  readonly close = vi.fn(async () => undefined);

  constructor(
    private readonly rows: readonly Record<string, unknown>[],
  ) {}

  async transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly PostgresParameter[] = [],
      ) => {
        if (/select session_user::text as session_user$/iu.test(text.trim())) {
          return [{ session_user: "programmable_reconciler_login" }] as unknown as Row[];
        }
        if (/current_role::text as current_role/iu.test(text)) {
          return [{
            session_user: "programmable_reconciler_login",
            current_role: "programmable_reconciler",
          }] as unknown as Row[];
        }
        if (/^set local /iu.test(text.trim())) return [] as unknown as Row[];
        this.applicationQueries.push({ text, values });
        return this.rows as unknown as Row[];
      },
    });
  }
}

function validRows() {
  return classicV3ReconcilerRouteFixture().map((route) => ({
    route_key: route.routeKey,
    compared_count: String(route.comparedCount),
    dto: route.dto,
  }));
}

describe("reconciler route corpus Postgres store", () => {
  it("uses only the exact bounded corpus capability", async () => {
    const executor = new CorpusExecutor(validRows());
    const store = createPostgresReconcilerRouteCorpusStore({ executor });
    const result = await store.readExactIndexedRouteCorpus({
      contract,
      maximumEntityCount: 321,
      signal: new AbortController().signal,
    });

    expect(result.map(({ routeKey }) => routeKey)).toEqual(
      RECONCILER_ROUTE_KEYS,
    );
    expect(executor.applicationQueries).toHaveLength(1);
    expect(executor.applicationQueries[0]!.text).toContain(
      "get_reconciler_route_corpus_v1",
    );
    expect(executor.applicationQueries[0]!.values[9]).toBe(321);
    expect(executor.applicationQueries[0]!.text).not.toMatch(
      /public_(?:explore|creator|classic|launch)|route_snapshot_readiness/iu,
    );
  });

  it("rejects missing, reordered and empty route rows", async () => {
    for (const rows of [
      validRows().slice(0, 5),
      [validRows()[1]!, validRows()[0]!, ...validRows().slice(2)],
      validRows().map((row, index) =>
        index === 0 ? { ...row, compared_count: "0" } : row
      ),
    ]) {
      const store = createPostgresReconcilerRouteCorpusStore({
        executor: new CorpusExecutor(rows),
      });
      await expect(store.readExactIndexedRouteCorpus({
        contract,
        maximumEntityCount: 10_000,
        signal: new AbortController().signal,
      })).rejects.toBeDefined();
    }
  });

  it("fails closed on a structurally incompatible indexed DTO", async () => {
    const rows = validRows();
    const chartDto = rows[2]!.dto as Readonly<Record<string, unknown>>;
    rows[2] = {
      ...rows[2]!,
      dto: {
        ...chartDto,
        charts: [{ tokenAddress: ROUTE_FIXTURE_ADDRESS }],
      },
    };
    const store = createPostgresReconcilerRouteCorpusStore({
      executor: new CorpusExecutor(rows),
    });

    await expect(store.readExactIndexedRouteCorpus({
      contract,
      maximumEntityCount: 10_000,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("does not enter a database transaction after cancellation", async () => {
    const executor = new CorpusExecutor(validRows());
    const store = createPostgresReconcilerRouteCorpusStore({ executor });
    const controller = new AbortController();
    controller.abort();

    await expect(store.readExactIndexedRouteCorpus({
      contract,
      maximumEntityCount: 10_000,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "validation_failed" });
    expect(executor.applicationQueries).toHaveLength(0);
  });
});
