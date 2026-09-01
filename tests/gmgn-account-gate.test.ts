import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PostgresGmgnAccountGateV1,
} from "../lib/market-data/gmgn-account-gate.server";
import type {
  GmgnAccountGateCostV1,
} from "../lib/market-data/gmgn-account-gate.server";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresPoolV1,
  ProjectionTargetPostgresQueryResultV1,
} from "../lib/server/projection-target/postgres-store";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("GMGN account gate", () => {
  it("serializes parallel reservations through one database singleton", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const deadlineMs = Date.now() + 2_000;

    const concurrent = await Promise.all(Array.from({ length: 4 }, () =>
      gate.reserveSlot({ requestsPerSecond: 50, deadlineMs })));
    const winner = concurrent.find((reservation) =>
      reservation?.kind === "reserved"
    );
    expect(concurrent.filter((reservation) =>
      reservation?.kind === "reserved"
    )).toHaveLength(1);
    expect(concurrent.filter((reservation) => reservation === null)).toHaveLength(3);
    if (winner?.kind !== "reserved") throw new Error("test lease unavailable");
    await gate.complete(winner);
    const successor = await gate.reserveSlot({ requestsPerSecond: 50, deadlineMs });
    expect(successor?.kind).toBe("reserved");
    if (successor?.kind !== "reserved") throw new Error("successor lease unavailable");
    expect(successor.reservedAtMs - winner.reservedAtMs).toBeGreaterThanOrEqual(19);
    await gate.complete(successor);

    await database.exec("RESET ROLE");
    const evidence = await database.query<{
      generation: bigint;
      decision_kind: string;
      interval_ms: number;
    }>(`
      SELECT generation, decision_kind, interval_ms
        FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
       ORDER BY generation
    `);
    expect(evidence.rows).toHaveLength(4);
    expect(evidence.rows.filter((row) => row.decision_kind === "reserved")
      .every((row) =>
      row.decision_kind === "reserved" && row.interval_ms === 20
    )).toBe(true);
    expect(evidence.rows.filter((row) => row.decision_kind === "completed"))
      .toHaveLength(2);
  });

  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 3_000],
    [5, 5_000],
  ] as const)(
    "charges cost %i against the shared leaky schedule",
    async (cost, expectedScheduleMs) => {
      const { database, pool } = await migratedGate();
      const gate = new PostgresGmgnAccountGateV1(pool);
      const lease = await gate.reserveSlot({
        requestsPerSecond: 1,
        cost,
        deadlineMs: Date.now() + 1_000,
      });
      expect(lease?.kind).toBe("reserved");
      if (lease?.kind !== "reserved") throw new Error("test lease unavailable");
      await gate.complete(lease);

      await database.exec("RESET ROLE");
      const evidence = await database.query<{
        interval_ms: number;
        schedule_ms: number;
      }>(`
        SELECT history.interval_ms,
               ROUND(EXTRACT(EPOCH FROM
                 (history.next_slot_at - history.decided_at)) * 1000)::integer
                 AS schedule_ms
          FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
            AS history
         WHERE history.decision_kind = 'reserved'
      `);
      expect(evidence.rows).toEqual([{
        interval_ms: 1_000,
        schedule_ms: expectedScheduleMs,
      }]);
    },
  );

  it.each([
    0,
    -1,
    1.5,
    4,
    6,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    null,
    "5",
  ])("fails closed before database access for invalid cost %p", async (cost) => {
    const query = vi.fn();
    const pool: ProjectionTargetPostgresPoolV1 = {
      connect: vi.fn(),
      query,
    };
    const gate = new PostgresGmgnAccountGateV1(pool);

    await expect(gate.reserveSlot({
      requestsPerSecond: 1,
      cost: cost as GmgnAccountGateCostV1,
      deadlineMs: Date.now() + 1_000,
    })).rejects.toThrow("GMGN account gate reservation is invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it("publishes one central blocked_until and Retry-After decision", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const lease = await gate.reserveSlot({
      requestsPerSecond: 50,
      cost: 5,
      deadlineMs: Date.now() + 1_000,
    });
    expect(lease?.kind).toBe("reserved");
    if (lease?.kind !== "reserved") throw new Error("test lease unavailable");
    const block = await gate.blockUntil({
      reservation: lease,
      blockedUntilMs: Date.now() + 2_000,
      providerSignal: "http-429",
    });

    expect(block.retryAfterMs).toBeGreaterThan(1_000);
    const reservation = await gate.reserveSlot({
      requestsPerSecond: 50,
      deadlineMs: Date.now() + 5_000,
    });
    expect(reservation?.kind).toBe("blocked");
    if (reservation?.kind === "blocked") {
      expect(reservation.retryAfterMs).toBeGreaterThan(1_000);
    }

    await database.exec("RESET ROLE");
    const evidence = await database.query<{
      decision_kind: string;
      retry_after_ms: bigint;
      provider_signal: string;
    }>(`
      SELECT decision_kind, retry_after_ms, provider_signal
        FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
    `);
    expect(evidence.rows).toHaveLength(2);
    expect(evidence.rows.find((row) =>
      row.decision_kind === "provider-blocked"
    )).toMatchObject({
      decision_kind: "provider-blocked",
      provider_signal: "http-429",
    });
    expect(Number(evidence.rows.find((row) =>
      row.decision_kind === "provider-blocked"
    )!.retry_after_ms)).toBe(block.retryAfterMs);
  });

  it("keeps state private and grants the runtime role only required access", async () => {
    const { database } = await migratedGate();
    await database.exec("RESET ROLE");
    const privileges = await database.query<Record<string, boolean>>(`
      SELECT
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'SELECT') AS runtime_state_select,
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'INSERT') AS runtime_state_insert,
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'DELETE') AS runtime_state_delete,
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
          'INSERT') AS runtime_history_insert,
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
          'DELETE') AS runtime_history_delete,
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
          'SELECT') AS runtime_history_select,
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
          'UPDATE') AS runtime_history_update,
        has_column_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
          'gate_id', 'SELECT')
          AND has_column_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
          'generation', 'SELECT') AS runtime_history_prune_columns,
        has_column_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
          'decision_kind', 'SELECT') AS runtime_history_decision_select,
        has_table_privilege('anon',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'SELECT,INSERT,UPDATE,DELETE') AS anon_any,
        (SELECT relrowsecurity AND relforcerowsecurity
           FROM pg_class
          WHERE oid = 'programmable_website_projection_v1.gmgn_account_gate_v1'::regclass)
          AS state_rls_forced,
        (SELECT relrowsecurity AND relforcerowsecurity
           FROM pg_class
          WHERE oid = 'programmable_website_projection_v1.gmgn_account_gate_decisions_v1'::regclass)
          AS history_rls_forced
    `);
    expect(privileges.rows[0]).toEqual({
      runtime_state_select: true,
      runtime_state_insert: false,
      runtime_state_delete: false,
      runtime_history_insert: true,
      runtime_history_delete: true,
      runtime_history_select: false,
      runtime_history_update: false,
      runtime_history_prune_columns: true,
      runtime_history_decision_select: false,
      anon_any: false,
      state_rls_forced: true,
      history_rls_forced: true,
    });
  });

  it("propagates database failures instead of creating a local bypass", async () => {
    const pool: ProjectionTargetPostgresPoolV1 = {
      connect: vi.fn(),
      query: vi.fn(async () => {
        throw new Error("projection database unavailable");
      }),
    };
    const gate = new PostgresGmgnAccountGateV1(pool);
    await expect(gate.reserveSlot({
      requestsPerSecond: 1,
      cost: 5,
      deadlineMs: Date.now() + 1_000,
    })).rejects.toThrow("projection database unavailable");
  });

  it.each(["completed", "provider-blocked"] as const)(
    "keeps the lease after a failed %s outcome write",
    async (failedDecision) => {
      const { pool } = await migratedGate();
      const failingGate = new PostgresGmgnAccountGateV1(
        new OutcomeFailPool(pool, failedDecision),
      );
      const lease = await failingGate.reserveSlot({
        requestsPerSecond: 50,
        deadlineMs: Date.now() + 1_000,
      });
      expect(lease?.kind).toBe("reserved");
      if (lease?.kind !== "reserved") throw new Error("test lease unavailable");

      if (failedDecision === "completed") {
        await expect(failingGate.complete(lease)).rejects.toThrow(
          "injected outcome write failure",
        );
      } else {
        await expect(failingGate.blockUntil({
          reservation: lease,
          blockedUntilMs: Date.now() + 2_000,
          providerSignal: "http-429",
        })).rejects.toThrow("injected outcome write failure");
      }

      const independentGate = new PostgresGmgnAccountGateV1(pool);
      await expect(independentGate.reserveSlot({
        requestsPerSecond: 50,
        deadlineMs: Date.now() + 100,
      })).resolves.toBeNull();
    },
  );

  it("rejects a stale generation release without clearing the active lease", async () => {
    const { pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const lease = await gate.reserveSlot({
      requestsPerSecond: 50,
      deadlineMs: Date.now() + 1_000,
    });
    if (lease?.kind !== "reserved") throw new Error("test lease unavailable");
    await expect(gate.complete({
      ...lease,
      generation: lease.generation + 1,
    })).rejects.toThrow("lease is stale or unavailable");
    await expect(gate.reserveSlot({
      requestsPerSecond: 50,
      deadlineMs: Date.now() + 100,
    })).resolves.toBeNull();
  });

  it("cannot release a successor lease after an exact-holder race", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const lease = await gate.reserveSlot({
      requestsPerSecond: 50,
      deadlineMs: Date.now() + 1_000,
    });
    if (lease?.kind !== "reserved") throw new Error("test lease unavailable");
    const successorHolder = "22222222-2222-4222-8222-222222222222";
    await database.exec(`
      RESET ROLE;
      UPDATE programmable_website_projection_v1.gmgn_account_gate_v1
         SET generation = generation + 1,
             lease_holder = '${successorHolder}',
             lease_until = clock_timestamp() + INTERVAL '5 minutes',
             updated_at = clock_timestamp()
       WHERE gate_id = 'gmgn-openapi-v1';
      SET ROLE programmable_website_projection_runtime;
    `);

    await expect(gate.complete(lease)).rejects.toThrow(
      "lease is stale or unavailable",
    );
    await database.exec("RESET ROLE");
    const state = await database.query<{
      generation: number;
      lease_holder: string;
    }>(`
      SELECT generation, lease_holder
        FROM programmable_website_projection_v1.gmgn_account_gate_v1
    `);
    expect(state.rows[0]).toMatchObject({
      generation: lease.generation + 1,
      lease_holder: successorHolder,
    });
  });

  it("prunes decision history to the latest 256 generations", async () => {
    const { database, pool } = await migratedGate();
    const holder = "33333333-3333-4333-8333-333333333333";
    await database.exec(`
      RESET ROLE;
      INSERT INTO programmable_website_projection_v1.gmgn_account_gate_decisions_v1 (
        gate_id, generation, decision_kind, decided_at, next_slot_at,
        blocked_until, lease_holder, lease_until, interval_ms,
        retry_after_ms, provider_signal
      )
      SELECT 'gmgn-openapi-v1', generation, 'reserved',
             TIMESTAMPTZ '2026-01-01 00:00:00+00',
             TIMESTAMPTZ '2026-01-01 00:00:01+00', TIMESTAMPTZ 'epoch',
             '${holder}'::uuid, TIMESTAMPTZ '2026-01-01 00:05:00+00',
             20, 0, NULL
        FROM generate_series(1, 300) AS generation
      UNION ALL
      SELECT 'gmgn-openapi-v1', generation, 'completed',
             TIMESTAMPTZ '2026-01-01 00:00:02+00',
             TIMESTAMPTZ '2026-01-01 00:00:01+00', TIMESTAMPTZ 'epoch',
             '${holder}'::uuid, TIMESTAMPTZ 'epoch', NULL, 0, NULL
        FROM generate_series(1, 299) AS generation;
      UPDATE programmable_website_projection_v1.gmgn_account_gate_v1
         SET generation = 300,
             lease_holder = '${holder}',
             lease_until = clock_timestamp() + INTERVAL '5 minutes',
             updated_at = clock_timestamp()
       WHERE gate_id = 'gmgn-openapi-v1';
      SET ROLE programmable_website_projection_runtime;
    `);

    const gate = new PostgresGmgnAccountGateV1(pool);
    await gate.complete({
      kind: "reserved",
      generation: 300,
      holder,
      reservedAtMs: Date.now(),
    });

    await database.exec("RESET ROLE");
    const retained = await database.query<{
      count: number;
      minimum_generation: number;
      maximum_generation: number;
    }>(`
      SELECT count(*) AS count, min(generation) AS minimum_generation,
             max(generation) AS maximum_generation
        FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
    `);
    expect(retained.rows[0]).toEqual({
      count: 512,
      minimum_generation: 45,
      maximum_generation: 300,
    });
  });
});

async function migratedGate(): Promise<Readonly<{
  database: PGlite;
  pool: ProjectionTargetPostgresPoolV1;
}>> {
  const database = new PGlite();
  databases.push(database);
  await database.exec(`
    CREATE ROLE programmable_website_projection_runtime NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
  `);
  const migrations = await Promise.all([
    "0001_projection_records_v1.sql",
    "0006_gmgn_account_gate_v1.sql",
  ].map((file) => readFile(new URL(
    `../ops/website-projection-target/migrations/${file}`,
    import.meta.url,
  ), "utf8")));
  for (const migration of migrations) await database.exec(migration);
  await database.exec(`
    GRANT USAGE ON SCHEMA programmable_website_projection_v1
      TO programmable_website_projection_runtime;
    SET ROLE programmable_website_projection_runtime;
  `);
  return Object.freeze({ database, pool: new PGlitePool(database) });
}

class PGlitePool implements ProjectionTargetPostgresPoolV1 {
  constructor(private readonly database: PGlite) {}

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    return Object.freeze({
      query: <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => this.query<Row>(text, values),
      release() {},
    });
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    const result = await this.database.query<Row>(text, [...values]);
    return Object.freeze({
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    });
  }
}

class OutcomeFailPool implements ProjectionTargetPostgresPoolV1 {
  constructor(
    private readonly inner: ProjectionTargetPostgresPoolV1,
    private readonly failedDecision: "completed" | "provider-blocked",
  ) {}

  connect(): Promise<ProjectionTargetPostgresClientV1> {
    return this.inner.connect();
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    if (text.includes(`'${this.failedDecision}'`)) {
      throw new Error("injected outcome write failure");
    }
    return this.inner.query<Row>(text, values);
  }
}
