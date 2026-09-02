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
  it("rate-spaces reservations while allowing twenty requests in flight", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const deadlineMs = Date.now() + 2_000;

    const concurrent = await Promise.all(Array.from({ length: 20 }, () =>
      gate.reserveSlot({ requestsPerSecond: 20, deadlineMs })));
    const leases = concurrent.flatMap((reservation) =>
      reservation?.kind === "reserved" ? [reservation] : []
    );
    expect(leases).toHaveLength(20);
    const reservedAt = leases.map(({ reservedAtMs }) => reservedAtMs)
      .sort((first, second) => first - second);
    for (let index = 1; index < reservedAt.length; index += 1) {
      expect(reservedAt[index]! - reservedAt[index - 1]!)
        .toBeGreaterThanOrEqual(49);
    }
    await Promise.all(leases.map((lease) => gate.complete(lease)));
    const successor = await gate.reserveSlot({ requestsPerSecond: 20, deadlineMs });
    expect(successor?.kind).toBe("reserved");
    if (successor?.kind !== "reserved") throw new Error("successor lease unavailable");
    expect(successor.reservedAtMs - reservedAt.at(-1)!).toBeGreaterThanOrEqual(49);
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
    expect(evidence.rows).toHaveLength(42);
    expect(evidence.rows.filter((row) => row.decision_kind === "reserved")
      .every((row) =>
      row.decision_kind === "reserved" && row.interval_ms === 50
    )).toBe(true);
    expect(evidence.rows.filter((row) => row.decision_kind === "completed"))
      .toHaveLength(21);
  });

  it("bounds account-wide concurrency and admits a successor after exact release", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const leases = await Promise.all(Array.from({ length: 20 }, async () => {
      const decision = await gate.reserveSlot({
        requestsPerSecond: 20,
        deadlineMs: Date.now() + 2_000,
      });
      if (decision?.kind !== "reserved") throw new Error("test lease unavailable");
      return decision;
    }));

    await expect(gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 80,
    })).resolves.toBeNull();
    await gate.complete(leases[0]!);
    const successor = await gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    expect(successor?.kind).toBe("reserved");

    await database.exec("RESET ROLE");
    const active = await database.query<{ count: number }>(`
      SELECT count(*) AS count
        FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
       WHERE lease_until > clock_timestamp()
    `);
    expect(active.rows).toEqual([{ count: 20 }]);
  });

  it("keeps account-wide headroom for ranking beside bulk token-info reads", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const bulkLeases = await Promise.all(Array.from({ length: 12 }, async () => {
      const decision = await gate.reserveSlot({
        requestsPerSecond: 20,
        maximumConcurrentLeases: 12,
        deadlineMs: Date.now() + 2_000,
      });
      if (decision?.kind !== "reserved") {
        throw new Error("bulk test lease unavailable");
      }
      return decision;
    }));

    await expect(gate.reserveSlot({
      requestsPerSecond: 20,
      maximumConcurrentLeases: 12,
      deadlineMs: Date.now() + 80,
    })).resolves.toBeNull();
    const rankLease = await gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    expect(rankLease?.kind).toBe("reserved");
    if (rankLease?.kind !== "reserved") {
      throw new Error("ranking headroom lease unavailable");
    }

    await database.exec("RESET ROLE");
    const active = await database.query<{ count: number }>(`
      SELECT count(*) AS count
        FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
       WHERE lease_until > clock_timestamp()
    `);
    expect(active.rows).toEqual([{ count: 13 }]);
    await Promise.all([
      ...bulkLeases.map((lease) => gate.complete(lease)),
      gate.complete(rankLease),
    ]);
  });

  it("cancels a capacity wait without allocating a twenty-first lease", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const leases = await Promise.all(Array.from({ length: 20 }, async () => {
      const decision = await gate.reserveSlot({
        requestsPerSecond: 20,
        deadlineMs: Date.now() + 2_000,
      });
      if (decision?.kind !== "reserved") throw new Error("test lease unavailable");
      return decision;
    }));
    const enteredDelay = Promise.withResolvers<void>();
    const waitingGate = new PostgresGmgnAccountGateV1(pool, {
      delay: vi.fn((_ms: number, signal?: AbortSignal) =>
        new Promise<boolean>((resolve) => {
          enteredDelay.resolve();
          const abort = () => resolve(false);
          signal?.addEventListener("abort", abort, { once: true });
        })),
    });
    const controller = new AbortController();
    const waiting = waitingGate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 2_000,
      signal: controller.signal,
    });
    await enteredDelay.promise;
    controller.abort();
    await expect(waiting).resolves.toBeNull();

    await database.exec("RESET ROLE");
    const active = await database.query<{ count: number }>(`
      SELECT count(*) AS count
        FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
       WHERE lease_until > clock_timestamp()
    `);
    expect(active.rows).toEqual([{ count: 20 }]);
    void leases;
  });

  it.each(["abort", "deadline"] as const)(
    "rolls back a newly written lease when the caller %s wins before commit",
    async (mode) => {
      const { database, pool } = await migratedGate();
      const controller = new AbortController();
      let localNowMs = Date.now();
      const deadlineMs = localNowMs + 100;
      const gate = new PostgresGmgnAccountGateV1(
        new AfterReservationPool(pool, () => {
          if (mode === "abort") controller.abort();
          else localNowMs = deadlineMs;
        }),
        { nowMs: () => localNowMs },
      );

      await expect(gate.reserveSlot({
        requestsPerSecond: 20,
        deadlineMs,
        signal: controller.signal,
      })).resolves.toBeNull();

      await database.exec("RESET ROLE");
      const state = await database.query<{
        active: number;
        generation: bigint;
        lease_holder: string | null;
        reserved_history: number;
      }>(`
        SELECT
          (SELECT count(*)
             FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1)
            AS active,
          gate.generation,
          gate.lease_holder,
          (SELECT count(*)
             FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
            WHERE decision_kind = 'reserved') AS reserved_history
          FROM programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
      `);
      expect(state.rows).toEqual([{
        active: 0,
        generation: 0,
        lease_holder: null,
        reserved_history: 0,
      }]);
    },
  );

  it.each(["55P03", "57014"])(
    "fails closed when PostgreSQL enforces reservation deadline code %s",
    async (code) => {
      const pool = new PostgresDeadlinePool(code);
      const gate = new PostgresGmgnAccountGateV1(pool);
      await expect(gate.reserveSlot({
        requestsPerSecond: 20,
        deadlineMs: Date.now() + 1_000,
      })).resolves.toBeNull();
      expect(pool.rolledBack).toBe(true);
      expect(pool.released).toBe(true);
    },
  );

  it("re-reads lease capacity after each concurrent row-lock waiter acquires the lock", async () => {
    const pool = new ReadCommittedWaiterModelPool();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const deadlineMs = Date.now() + 45;

    const decisions = await Promise.all(Array.from({ length: 21 }, () =>
      gate.reserveSlot({ requestsPerSecond: 20, deadlineMs })));

    expect(decisions.filter((decision) => decision?.kind === "reserved"))
      .toHaveLength(20);
    expect(decisions.filter((decision) => decision === null)).toHaveLength(1);
    expect(pool.maximumActiveLeases).toBe(20);
    expect(pool.snapshotsTakenBeforeWaiting.filter((count) => count === 0).length)
      .toBeGreaterThan(1);
    expect(pool.stateReads).toBe(21);
  });

  it("completes and provider-blocks parallel leases without clearing a survivor", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const leases = await Promise.all(Array.from({ length: 3 }, async () => {
      const decision = await gate.reserveSlot({
        requestsPerSecond: 20,
        deadlineMs: Date.now() + 2_000,
      });
      if (decision?.kind !== "reserved") throw new Error("test lease unavailable");
      return decision;
    }));
    await Promise.all([
      gate.complete(leases[0]!),
      gate.blockUntil({
        reservation: leases[1]!,
        blockedUntilMs: Date.now() + 2_000,
        providerSignal: "http-429",
      }),
    ]);
    await expect(gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    })).resolves.toMatchObject({ kind: "blocked" });

    await database.exec("RESET ROLE");
    const state = await database.query<{
      active: number;
      marker: string;
      outcomes_at_epoch: boolean;
    }>(`
      SELECT
        (SELECT count(*)
           FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
          WHERE lease_until > clock_timestamp()) AS active,
        gate.lease_holder AS marker,
        (SELECT bool_and(lease_until = TIMESTAMPTZ 'epoch')
           FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
          WHERE decision_kind IN ('completed', 'provider-blocked'))
          AS outcomes_at_epoch
        FROM programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
    `);
    expect(state.rows).toEqual([{
      active: 1,
      marker: "ffffffff-ffff-4fff-bfff-ffffffffffff",
      outcomes_at_epoch: true,
    }]);
  });

  it("keeps 0006 runtime compatible across the explicit 0007 upgrade", async () => {
    const { database, pool } = await migratedGate({ multiflight: false });
    const legacyMultiflightReadiness = vi.fn(async () => {});
    const legacyGate = new PostgresGmgnAccountGateV1(pool, {
      assertMultiflightReady: legacyMultiflightReadiness,
    });
    const legacyLease = await legacyGate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    expect(legacyLease?.kind).toBe("reserved");
    if (legacyLease?.kind !== "reserved") throw new Error("legacy lease unavailable");
    expect(legacyMultiflightReadiness).not.toHaveBeenCalled();
    await expect(legacyGate.status()).resolves.toEqual({
      mode: "legacy-singleflight-v1",
    });

    await database.exec("RESET ROLE");
    const migration = await readFile(new URL(
      "../ops/website-projection-target/migrations/0007_gmgn_account_gate_multiflight_v1.sql",
      import.meta.url,
    ), "utf8");
    await database.exec(migration);
    await database.exec("SET ROLE programmable_website_projection_runtime");

    const upgradedMultiflightReadiness = vi.fn(async () => {});
    const upgradedGate = new PostgresGmgnAccountGateV1(pool, {
      assertMultiflightReady: upgradedMultiflightReadiness,
    });
    await expect(upgradedGate.status()).resolves.toEqual({ mode: "multiflight-v1" });
    await expect(upgradedGate.complete(legacyLease)).resolves.toBeUndefined();
    const upgradedLease = await upgradedGate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    expect(upgradedLease?.kind).toBe("reserved");
    if (upgradedLease?.kind !== "reserved") throw new Error("upgrade lease unavailable");
    expect(upgradedMultiflightReadiness.mock.calls.length)
      .toBeGreaterThanOrEqual(2);

    await database.exec("RESET ROLE");
    const active = await database.query<{ count: number }>(`
      SELECT count(*) AS count
        FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
       WHERE generation = ${upgradedLease.generation}
         AND lease_holder = '${upgradedLease.holder}'
    `);
    expect(active.rows).toEqual([{ count: 1 }]);
  });

  it("re-attests multiflight readiness after the first successful schema probe", async () => {
    const { pool } = await migratedGate();
    let drifted = false;
    const assertMultiflightReady = vi.fn(async () => {
      if (drifted) throw new Error("injected lease privilege drift");
    });
    const gate = new PostgresGmgnAccountGateV1(pool, {
      assertMultiflightReady,
    });
    const first = await gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    expect(first?.kind).toBe("reserved");

    drifted = true;
    await expect(gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    })).rejects.toThrow("injected lease privilege drift");
    expect(assertMultiflightReady).toHaveBeenCalledTimes(2);
  });

  it("reports an unavailable mode without exposing readiness failure details", async () => {
    const { pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool, {
      assertMultiflightReady: async () => {
        throw new Error("secret database diagnostic");
      },
    });

    await expect(gate.status()).resolves.toEqual({ mode: "unavailable" });
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

  it("accepts the official 20 unit ceiling and rejects 21 before database access", async () => {
    const { pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const lease = await gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    expect(lease?.kind).toBe("reserved");
    if (lease?.kind !== "reserved") throw new Error("test lease unavailable");
    await gate.complete(lease);

    const query = vi.fn();
    const rejectingGate = new PostgresGmgnAccountGateV1({
      connect: vi.fn(),
      query,
    });
    await expect(rejectingGate.reserveSlot({
      requestsPerSecond: 21,
      deadlineMs: Date.now() + 1_000,
    })).rejects.toThrow("GMGN account gate reservation is invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it.each([0, 21, 1.5] as const)(
    "rejects invalid maximum concurrent leases %p before database access",
    async (maximumConcurrentLeases) => {
      const query = vi.fn();
      const gate = new PostgresGmgnAccountGateV1({
        connect: vi.fn(),
        query,
      });
      await expect(gate.reserveSlot({
        requestsPerSecond: 20,
        maximumConcurrentLeases,
        deadlineMs: Date.now() + 1_000,
      })).rejects.toThrow("GMGN account gate reservation is invalid");
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("publishes one central blocked_until and Retry-After decision", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const lease = await gate.reserveSlot({
      requestsPerSecond: 20,
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
      requestsPerSecond: 20,
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
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_leases_v1',
          'SELECT') AS runtime_leases_select,
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_leases_v1',
          'INSERT') AS runtime_leases_insert,
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_leases_v1',
          'DELETE') AS runtime_leases_delete,
        has_table_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_leases_v1',
          'UPDATE,TRUNCATE,REFERENCES,TRIGGER') AS runtime_leases_forbidden,
        has_table_privilege('anon',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'SELECT,INSERT,UPDATE,DELETE')
          OR has_table_privilege('anon',
          'programmable_website_projection_v1.gmgn_account_gate_leases_v1',
          'SELECT,INSERT,UPDATE,DELETE') AS anon_any,
        (SELECT relrowsecurity AND relforcerowsecurity
           FROM pg_class
          WHERE oid = 'programmable_website_projection_v1.gmgn_account_gate_v1'::regclass)
          AS state_rls_forced,
        (SELECT relrowsecurity AND relforcerowsecurity
           FROM pg_class
          WHERE oid = 'programmable_website_projection_v1.gmgn_account_gate_decisions_v1'::regclass)
          AS history_rls_forced,
        (SELECT relrowsecurity AND relforcerowsecurity
           FROM pg_class
          WHERE oid = 'programmable_website_projection_v1.gmgn_account_gate_leases_v1'::regclass)
          AS leases_rls_forced
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
      runtime_leases_select: true,
      runtime_leases_insert: true,
      runtime_leases_delete: true,
      runtime_leases_forbidden: false,
      anon_any: false,
      state_rls_forced: true,
      history_rls_forced: true,
      leases_rls_forced: true,
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
      const { database, pool } = await migratedGate();
      const failingGate = new PostgresGmgnAccountGateV1(
        new OutcomeFailPool(pool, failedDecision),
      );
      const lease = await failingGate.reserveSlot({
        requestsPerSecond: 20,
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

      await database.exec("RESET ROLE");
      const active = await database.query<{
        count: number;
        lease_ms: number;
      }>(`
        SELECT count(*) AS count,
               ROUND(MAX(EXTRACT(EPOCH FROM
                 (lease_until - reserved_at))) * 1000)::integer AS lease_ms
          FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
         WHERE generation = ${lease.generation}
           AND lease_holder = '${lease.holder}'
      `);
      expect(active.rows).toEqual([{ count: 1, lease_ms: 15_000 }]);
    },
  );

  it("reclaims an expired orphan after a failed outcome write", async () => {
    const { database, pool } = await migratedGate();
    const failingGate = new PostgresGmgnAccountGateV1(
      new OutcomeFailPool(pool, "completed"),
    );
    const orphan = await failingGate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    if (orphan?.kind !== "reserved") throw new Error("test lease unavailable");
    await expect(failingGate.complete(orphan)).rejects.toThrow(
      "injected outcome write failure",
    );

    await database.exec(`
      RESET ROLE;
      UPDATE programmable_website_projection_v1.gmgn_account_gate_leases_v1
         SET reserved_at = clock_timestamp() - INTERVAL '2 seconds',
             lease_until = clock_timestamp() - INTERVAL '1 second'
       WHERE generation = ${orphan.generation}
         AND lease_holder = '${orphan.holder}';
      UPDATE programmable_website_projection_v1.gmgn_account_gate_v1
         SET next_slot_at = TIMESTAMPTZ 'epoch',
             lease_until = clock_timestamp() - INTERVAL '1 millisecond'
       WHERE gate_id = 'gmgn-openapi-v1';
      SET ROLE programmable_website_projection_runtime;
    `);

    const gate = new PostgresGmgnAccountGateV1(pool);
    const successor = await gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    expect(successor?.kind).toBe("reserved");
    if (successor?.kind !== "reserved") {
      throw new Error("successor lease unavailable");
    }
    expect(successor.generation).toBe(orphan.generation + 1);

    await database.exec("RESET ROLE");
    const state = await database.query<{
      active: number;
      orphaned: number;
    }>(`
      SELECT count(*) FILTER (
               WHERE lease_until > clock_timestamp()
             ) AS active,
             count(*) FILTER (
               WHERE generation = ${orphan.generation}
                 AND lease_holder = '${orphan.holder}'
             ) AS orphaned
        FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
    `);
    expect(state.rows).toEqual([{ active: 1, orphaned: 0 }]);
  });

  it("preserves a longer marker across a mixed-version rollout", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const legacyDurationLease = await gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    if (legacyDurationLease?.kind !== "reserved") {
      throw new Error("legacy-duration lease unavailable");
    }

    await database.exec(`
      RESET ROLE;
      UPDATE programmable_website_projection_v1.gmgn_account_gate_leases_v1
         SET lease_until = reserved_at + INTERVAL '5 minutes'
       WHERE generation = ${legacyDurationLease.generation}
         AND lease_holder = '${legacyDurationLease.holder}';
      UPDATE programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
         SET next_slot_at = TIMESTAMPTZ 'epoch',
             lease_until = lease.lease_until
        FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
          AS lease
       WHERE gate.gate_id = lease.gate_id
         AND lease.generation = ${legacyDurationLease.generation}
         AND lease.lease_holder = '${legacyDurationLease.holder}';
      SET ROLE programmable_website_projection_runtime;
    `);

    const firstShortLease = await gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    expect(firstShortLease?.kind).toBe("reserved");
    const secondShortLease = await gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    expect(secondShortLease?.kind).toBe("reserved");
    if (
      firstShortLease?.kind !== "reserved"
      || secondShortLease?.kind !== "reserved"
    ) throw new Error("mixed-version successor lease unavailable");

    await database.exec("RESET ROLE");
    const leases = await database.query<{
      generation: number;
      lease_ms: number;
    }>(`
      SELECT generation,
             ROUND(EXTRACT(EPOCH FROM
               (lease_until - reserved_at)) * 1000)::integer AS lease_ms
        FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
       ORDER BY generation
    `);
    expect(leases.rows).toEqual([
      { generation: legacyDurationLease.generation, lease_ms: 300_000 },
      { generation: firstShortLease.generation, lease_ms: 15_000 },
      { generation: secondShortLease.generation, lease_ms: 15_000 },
    ]);
  });

  it("rejects a stale generation release without clearing the active lease", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const lease = await gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    if (lease?.kind !== "reserved") throw new Error("test lease unavailable");
    await expect(gate.complete({
      ...lease,
      generation: lease.generation + 1,
    })).rejects.toThrow("lease is stale or unavailable");
    await database.exec("RESET ROLE");
    const active = await database.query<{ count: number }>(`
      SELECT count(*) AS count
        FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
       WHERE generation = ${lease.generation}
         AND lease_holder = '${lease.holder}'
    `);
    expect(active.rows).toEqual([{ count: 1 }]);
  });

  it("cannot release a successor lease after an exact-holder race", async () => {
    const { database, pool } = await migratedGate();
    const gate = new PostgresGmgnAccountGateV1(pool);
    const lease = await gate.reserveSlot({
      requestsPerSecond: 20,
      deadlineMs: Date.now() + 1_000,
    });
    if (lease?.kind !== "reserved") throw new Error("test lease unavailable");
    const successorHolder = "22222222-2222-4222-8222-222222222222";
    await database.exec(`
      RESET ROLE;
      UPDATE programmable_website_projection_v1.gmgn_account_gate_leases_v1
         SET lease_holder = '${successorHolder}'
       WHERE gate_id = 'gmgn-openapi-v1'
         AND generation = ${lease.generation};
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
        FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
    `);
    expect(state.rows[0]).toMatchObject({
      generation: lease.generation,
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

async function migratedGate(
  options: Readonly<{ multiflight?: boolean }> = {},
): Promise<Readonly<{
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
  const files = [
    "0001_projection_records_v1.sql",
    "0006_gmgn_account_gate_v1.sql",
    ...(options.multiflight === false
      ? []
      : ["0007_gmgn_account_gate_multiflight_v1.sql"]),
  ];
  const migrations = await Promise.all(files.map((file) => readFile(new URL(
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
  private connectionTail = Promise.resolve();

  constructor(private readonly database: PGlite) {}

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    let unlock = () => {};
    const previous = this.connectionTail;
    this.connectionTail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    let released = false;
    return {
      query: <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => this.directQuery<Row>(text, values),
      release() {
        if (released) return;
        released = true;
        unlock();
      },
    };
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    return this.directQuery<Row>(text, values);
  }

  private async directQuery<
    Row extends Record<string, unknown> = Record<string, unknown>,
  >(
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

// PostgreSQL READ COMMITTED takes a statement snapshot before a SELECT FOR
// UPDATE waiter acquires its row lock. This model deliberately records that
// stale pre-wait snapshot, then exposes the current lease count only to the
// separate state statement issued after the lock is held.
class ReadCommittedWaiterModelPool implements ProjectionTargetPostgresPoolV1 {
  activeLeases = 0;
  generation = 0;
  maximumActiveLeases = 0;
  stateReads = 0;
  readonly snapshotsTakenBeforeWaiting: number[] = [];
  private lockTail = Promise.resolve();

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    let unlock: (() => void) | null = null;
    return {
      query: async <Row extends Record<string, unknown>>(
        sql: string,
        values: readonly unknown[] = [],
      ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> => {
        if (sql === "BEGIN") return result<Row>([]);
        if (sql.includes("set_config('lock_timeout'")) return result<Row>([]);
        if (sql.includes("FOR UPDATE")) {
          this.snapshotsTakenBeforeWaiting.push(this.activeLeases);
          const previous = this.lockTail;
          this.lockTail = new Promise<void>((resolve) => {
            unlock = resolve;
          });
          await previous;
          return result<Row>([{ gate_id: "gmgn-openapi-v1" }]);
        }
        if (sql.includes("AS active_leases")) {
          this.stateReads += 1;
          const now = new Date();
          const leaseUntil = new Date(now.getTime() + 300_000);
          return result<Row>([{
            decided_at: now,
            generation: this.generation,
            next_slot_at: new Date(0),
            blocked_until: new Date(0),
            lease_holder: this.activeLeases > 0
              ? "ffffffff-ffff-4fff-bfff-ffffffffffff"
              : null,
            lease_until: this.activeLeases > 0 ? leaseUntil : new Date(0),
            active_leases: this.activeLeases,
            earliest_lease_until: this.activeLeases > 0 ? leaseUntil : null,
            latest_lease_until: this.activeLeases > 0 ? leaseUntil : null,
          }]);
        }
        if (sql.includes("INSERT INTO programmable_website_projection_v1.gmgn_account_gate_leases_v1")) {
          this.activeLeases += 1;
          this.generation += 1;
          this.maximumActiveLeases = Math.max(
            this.maximumActiveLeases,
            this.activeLeases,
          );
          return result<Row>([{
            decided_at: values[5],
            next_slot_at: values[5],
            blocked_until: new Date(0),
            generation: this.generation,
            lease_holder: values[2],
          }]);
        }
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          unlock?.();
          unlock = null;
          return result<Row>([]);
        }
        throw new Error(`unexpected modeled gate statement: ${sql.slice(0, 80)}`);
      },
      release() {
        unlock?.();
        unlock = null;
      },
    };
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    if (!sql.includes("to_regclass")) throw new Error("unexpected schema query");
    return result<Row>([{
      relation:
        "programmable_website_projection_v1.gmgn_account_gate_leases_v1",
    }]);
  }
}

class PostgresDeadlinePool implements ProjectionTargetPostgresPoolV1 {
  rolledBack = false;
  released = false;

  constructor(private readonly code: string) {}

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    return {
      query: async <Row extends Record<string, unknown>>(
        sql: string,
      ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> => {
        if (sql === "BEGIN" || sql.includes("set_config('lock_timeout'")) {
          return result<Row>([]);
        }
        if (sql.includes("FOR UPDATE")) {
          throw Object.assign(new Error("modeled PostgreSQL deadline"), {
            code: this.code,
          });
        }
        if (sql === "ROLLBACK") {
          this.rolledBack = true;
          return result<Row>([]);
        }
        throw new Error("unexpected deadline model statement");
      },
      release: () => {
        this.released = true;
      },
    };
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    if (!sql.includes("to_regclass")) throw new Error("unexpected schema query");
    return result<Row>([{
      relation:
        "programmable_website_projection_v1.gmgn_account_gate_leases_v1",
    }]);
  }
}

function result<Row extends Record<string, unknown>>(
  rows: readonly Record<string, unknown>[],
): ProjectionTargetPostgresQueryResultV1<Row> {
  return Object.freeze({ rows: [...rows] as Row[], rowCount: rows.length });
}

class AfterReservationPool implements ProjectionTargetPostgresPoolV1 {
  constructor(
    private readonly inner: ProjectionTargetPostgresPoolV1,
    private readonly afterReservation: () => void,
  ) {}

  connect(): Promise<ProjectionTargetPostgresClientV1> {
    return this.inner.connect().then((client) => ({
      query: async <Row extends Record<string, unknown>>(
        sql: string,
        values: readonly unknown[] = [],
      ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> => {
        const queryResult = await client.query<Row>(sql, values);
        if (sql.includes(
          "INSERT INTO programmable_website_projection_v1.gmgn_account_gate_leases_v1",
        )) this.afterReservation();
        return queryResult;
      },
      release: () => client.release(),
    }));
  }

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    return this.inner.query<Row>(sql, values);
  }
}

class OutcomeFailPool implements ProjectionTargetPostgresPoolV1 {
  constructor(
    private readonly inner: ProjectionTargetPostgresPoolV1,
    private readonly failedDecision: "completed" | "provider-blocked",
  ) {}

  connect(): Promise<ProjectionTargetPostgresClientV1> {
    return this.inner.connect().then((client) => ({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> => {
        if (text.includes(`'${this.failedDecision}'`)) {
          throw new Error("injected outcome write failure");
        }
        return client.query<Row>(text, values);
      },
      release: () => client.release(),
    }));
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
