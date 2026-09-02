import "server-only";

import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresPoolV1,
} from "../server/projection-target/postgres-store";
import {
  createProductionProjectionTargetPostgresPoolV1,
} from "../server/projection-target/website-target";

const GATE_ID = "gmgn-openapi-v1" as const;
const MAXIMUM_PROVIDER_COOLDOWN_MS = 5 * 60_000;
// Callers stop awaiting provider work and exact cleanup within six seconds;
// holder/generation fencing keeps any late outcome safe. Keep nine seconds of
// failure margin without letting a dead invocation hold scarce account-wide
// capacity for the provider cooldown.
const MAXIMUM_RESERVATION_LEASE_MS = 15_000;
const MAXIMUM_TRANSACTION_MS = 2_500;
const HISTORY_RETENTION_GENERATIONS = 256;
// GMGN's documented account ceiling is 20 requests per second. Keep the
// independent in-flight bound at that same ceiling: the global schedule still
// spaces starts, while slow provider responses no longer serialize the account.
const MAXIMUM_CONCURRENT_LEASES = 20;
const MULTIFLIGHT_MARKER = "ffffffff-ffff-4fff-bfff-ffffffffffff" as const;
const GMGN_ACCOUNT_GATE_COSTS = [1, 2, 3, 5] as const;

export type GmgnAccountGateCostV1 =
  (typeof GMGN_ACCOUNT_GATE_COSTS)[number];

export type GmgnAccountGateStatusV1 = Readonly<{
  mode: "multiflight-v1" | "legacy-singleflight-v1" | "unavailable";
}>;

export type GmgnAccountGateReservationV1 = Readonly<{
  kind: "reserved";
  reservedAtMs: number;
  generation: number;
  holder: string;
}> | Readonly<{
  kind: "blocked";
  retryAfterMs: number;
}>;

export interface GmgnAccountGateV1 {
  reserveSlot(input: Readonly<{
    requestsPerSecond: number;
    cost?: GmgnAccountGateCostV1;
    maximumConcurrentLeases?: number;
    deadlineMs: number;
    signal?: AbortSignal;
  }>): Promise<GmgnAccountGateReservationV1 | null>;
  blockUntil(input: Readonly<{
    reservation: Extract<GmgnAccountGateReservationV1, { kind: "reserved" }>;
    blockedUntilMs: number;
    providerSignal: "http-429" | "provider-envelope";
  }>): Promise<Readonly<{
    blockedUntilMs: number;
    retryAfterMs: number;
  }>>;
  complete(
    reservation: Extract<GmgnAccountGateReservationV1, { kind: "reserved" }>,
  ): Promise<void>;
}

interface GateStateRowV1 extends Record<string, unknown> {
  decided_at: Date | string;
  generation: number | string | bigint;
  next_slot_at: Date | string;
  blocked_until: Date | string;
  lease_holder: string | null;
  lease_until: Date | string;
  active_leases: number | string | bigint;
  earliest_lease_until: Date | string | null;
  latest_lease_until: Date | string | null;
}

interface GateReservationRowV1 extends Record<string, unknown> {
  decided_at: Date | string;
  next_slot_at: Date | string;
  blocked_until: Date | string;
  generation: number | string | bigint;
  lease_holder: string;
}

interface GateBlockRowV1 extends Record<string, unknown> {
  decided_at: Date | string;
  blocked_until: Date | string;
  retry_after_ms: number | string | bigint;
}

interface LegacyGateDecisionRowV1 extends Record<string, unknown> {
  kind: string;
  decided_at: Date | string;
  next_slot_at: Date | string;
  blocked_until: Date | string;
  generation?: number | string | bigint;
  lease_holder?: string;
}

interface SchemaProbeRowV1 extends Record<string, unknown> {
  relation: string | null;
}

const CONFIGURE_TRANSACTION_TIMEOUT_SQL = `
  SELECT set_config('lock_timeout', $1::text, true),
         set_config('statement_timeout', $1::text, true)
`;

const LOCK_GATE_SQL = `
  SELECT gate.gate_id
    FROM programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
   WHERE gate.gate_id = $1
     FOR UPDATE
`;

// This must be a separate statement after LOCK_GATE_SQL. Under PostgreSQL READ
// COMMITTED, a statement waiting for FOR UPDATE retains its original snapshot;
// a second statement gets a fresh snapshot and therefore sees the preceding
// reservation's committed lease before enforcing the in-flight limit.
const READ_GATE_STATE_SQL = `
  WITH authority AS MATERIALIZED (
    SELECT clock_timestamp() AS decided_at
  )
  SELECT authority.decided_at, gate.generation, gate.next_slot_at,
         gate.blocked_until, gate.lease_holder, gate.lease_until,
         (
           SELECT count(*)::bigint
             FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
               AS lease
            WHERE lease.gate_id = gate.gate_id
              AND lease.lease_until > authority.decided_at
         ) AS active_leases,
         (
           SELECT min(lease.lease_until)
             FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
               AS lease
            WHERE lease.gate_id = gate.gate_id
              AND lease.lease_until > authority.decided_at
         ) AS earliest_lease_until,
         (
           SELECT max(lease.lease_until)
             FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
               AS lease
            WHERE lease.gate_id = gate.gate_id
              AND lease.lease_until > authority.decided_at
         ) AS latest_lease_until
    FROM programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
    CROSS JOIN authority
   WHERE gate.gate_id = $1
`;

const RESERVE_SLOT_SQL = `
  WITH expired AS (
    DELETE FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
     WHERE gate_id = $2
       AND lease_until <= $6::timestamptz
  ), reservation AS (
    UPDATE programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
       SET generation = gate.generation + 1,
           next_slot_at = $6::timestamptz
             + ($1::integer * $4::integer * INTERVAL '1 millisecond'),
           lease_holder = $5::uuid,
           lease_until = GREATEST(gate.lease_until, $7::timestamptz),
           updated_at = $6::timestamptz
     WHERE gate.gate_id = $2
    RETURNING gate.gate_id, gate.generation, $6::timestamptz AS decided_at,
              gate.next_slot_at, gate.blocked_until, gate.lease_holder,
              gate.lease_until
  ), lease AS (
    INSERT INTO programmable_website_projection_v1.gmgn_account_gate_leases_v1 (
      gate_id, generation, lease_holder, reserved_at, lease_until
    )
    SELECT gate_id, generation, $3::uuid, decided_at, $7::timestamptz
      FROM reservation
    RETURNING gate_id, generation, lease_holder, reserved_at, lease_until
  ), pruned AS (
    DELETE FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
      AS history
     USING reservation
     WHERE history.gate_id = reservation.gate_id
       AND history.generation <=
         reservation.generation - ${HISTORY_RETENTION_GENERATIONS}
  ), history AS (
    INSERT INTO programmable_website_projection_v1.gmgn_account_gate_decisions_v1 (
      gate_id, generation, decision_kind, decided_at, next_slot_at,
      blocked_until, lease_holder, lease_until, interval_ms,
      retry_after_ms, provider_signal
    )
    SELECT reservation.gate_id, reservation.generation, 'reserved',
           reservation.decided_at, reservation.next_slot_at,
           reservation.blocked_until, lease.lease_holder, lease.lease_until,
           $1::integer, 0, NULL
      FROM reservation
      JOIN lease USING (gate_id, generation)
  )
  SELECT reservation.decided_at, reservation.next_slot_at,
         reservation.blocked_until, reservation.generation,
         lease.lease_holder
    FROM reservation
    JOIN lease USING (gate_id, generation)
`;

const BLOCK_UNTIL_SQL = `
  WITH authority AS MATERIALIZED (
    SELECT clock_timestamp() AS decided_at
  ), lease AS (
    DELETE FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
     WHERE gate_id = $2
       AND generation = $4::bigint
       AND lease_holder = $5::uuid
    RETURNING gate_id, generation, lease_holder
  ), remaining AS MATERIALIZED (
    SELECT count(*)::bigint AS active_leases,
           max(active.lease_until) AS latest_lease_until
      FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1 AS active
      CROSS JOIN authority
     WHERE active.gate_id = $2
       AND active.lease_until > authority.decided_at
       AND NOT (
         active.generation = $4::bigint
         AND active.lease_holder = $5::uuid
       )
  ), decision AS (
    UPDATE programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
       SET blocked_until = LEAST(
             GREATEST(gate.blocked_until, authority.decided_at, $1::timestamptz),
             authority.decided_at + INTERVAL '5 minutes'
           ),
           lease_holder = CASE
             WHEN remaining.active_leases > 0 THEN $6::uuid
             ELSE NULL
           END,
           lease_until = COALESCE(
             remaining.latest_lease_until,
             TIMESTAMPTZ 'epoch'
           ),
           updated_at = authority.decided_at
      FROM authority, lease, remaining
     WHERE gate.gate_id = $2
    RETURNING gate.gate_id, lease.generation AS lease_generation,
              lease.lease_holder, gate.generation AS gate_generation,
              authority.decided_at, gate.next_slot_at, gate.blocked_until,
              gate.lease_until
  ), pruned AS (
    DELETE FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
      AS history
     USING decision
     WHERE history.gate_id = decision.gate_id
       AND history.generation <=
         decision.gate_generation - ${HISTORY_RETENTION_GENERATIONS}
  ), history AS (
    INSERT INTO programmable_website_projection_v1.gmgn_account_gate_decisions_v1 (
      gate_id, generation, decision_kind, decided_at, next_slot_at,
      blocked_until, lease_holder, lease_until, interval_ms,
      retry_after_ms, provider_signal
    )
    SELECT gate_id, lease_generation, 'provider-blocked', decided_at,
           next_slot_at, blocked_until, lease_holder,
           TIMESTAMPTZ 'epoch', NULL,
           CEIL(EXTRACT(EPOCH FROM (blocked_until - decided_at)) * 1000)::bigint,
           $3::text
      FROM decision
  )
  SELECT decision.decided_at, decision.blocked_until,
         CEIL(EXTRACT(EPOCH FROM
           (decision.blocked_until - decision.decided_at)) * 1000)::bigint
           AS retry_after_ms
    FROM decision
`;

const COMPLETE_SQL = `
  WITH authority AS MATERIALIZED (
    SELECT clock_timestamp() AS decided_at
  ), lease AS (
    DELETE FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1
     WHERE gate_id = $1
       AND generation = $2::bigint
       AND lease_holder = $3::uuid
    RETURNING gate_id, generation, lease_holder
  ), remaining AS MATERIALIZED (
    SELECT count(*)::bigint AS active_leases,
           max(active.lease_until) AS latest_lease_until
      FROM programmable_website_projection_v1.gmgn_account_gate_leases_v1 AS active
      CROSS JOIN authority
     WHERE active.gate_id = $1
       AND active.lease_until > authority.decided_at
       AND NOT (
         active.generation = $2::bigint
         AND active.lease_holder = $3::uuid
       )
  ), decision AS (
    UPDATE programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
       SET lease_holder = CASE
             WHEN remaining.active_leases > 0 THEN $4::uuid
             ELSE NULL
           END,
           lease_until = COALESCE(
             remaining.latest_lease_until,
             TIMESTAMPTZ 'epoch'
           ),
           updated_at = authority.decided_at
      FROM authority, lease, remaining
     WHERE gate.gate_id = $1
    RETURNING gate.gate_id, lease.generation AS lease_generation,
              lease.lease_holder, gate.generation AS gate_generation,
              authority.decided_at, gate.next_slot_at, gate.blocked_until,
              gate.lease_until
  ), pruned AS (
    DELETE FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
      AS history
     USING decision
     WHERE history.gate_id = decision.gate_id
       AND history.generation <=
         decision.gate_generation - ${HISTORY_RETENTION_GENERATIONS}
  ), history AS (
    INSERT INTO programmable_website_projection_v1.gmgn_account_gate_decisions_v1 (
      gate_id, generation, decision_kind, decided_at, next_slot_at,
      blocked_until, lease_holder, lease_until, interval_ms,
      retry_after_ms, provider_signal
    )
    SELECT gate_id, lease_generation, 'completed', decided_at, next_slot_at,
           blocked_until, lease_holder, TIMESTAMPTZ 'epoch', NULL, 0, NULL
      FROM decision
  )
  SELECT lease_generation AS generation FROM decision
`;

// Migration 0007 is additive and may be applied after an application rollout.
// These unchanged 0006 statements keep that rollout fail-closed and functional
// until the explicit database operator applies the multi-flight lease table.
const LEGACY_RESERVE_SLOT_SQL = `
  WITH authority AS MATERIALIZED (
    SELECT clock_timestamp() AS decided_at
  ), reservation AS (
    UPDATE programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
       SET generation = gate.generation + 1,
           next_slot_at = authority.decided_at
             + ($1::integer * $4::integer * INTERVAL '1 millisecond'),
           lease_holder = $3::uuid,
           lease_until = authority.decided_at + INTERVAL '5 minutes',
           updated_at = authority.decided_at
      FROM authority
     WHERE gate.gate_id = $2
       AND gate.blocked_until <= authority.decided_at
       AND gate.next_slot_at <= authority.decided_at
       AND gate.lease_until <= authority.decided_at
    RETURNING gate.gate_id, gate.generation, authority.decided_at,
              gate.next_slot_at, gate.blocked_until, gate.lease_holder,
              gate.lease_until
  ), pruned AS (
    DELETE FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
      AS history
     USING reservation
     WHERE history.gate_id = reservation.gate_id
       AND history.generation <=
         reservation.generation - ${HISTORY_RETENTION_GENERATIONS}
  ), history AS (
    INSERT INTO programmable_website_projection_v1.gmgn_account_gate_decisions_v1 (
      gate_id, generation, decision_kind, decided_at, next_slot_at,
      blocked_until, lease_holder, lease_until, interval_ms,
      retry_after_ms, provider_signal
    )
    SELECT gate_id, generation, 'reserved', decided_at, next_slot_at,
           blocked_until, lease_holder, lease_until, $1::integer, 0, NULL
      FROM reservation
  )
  SELECT 'reserved'::text AS kind, reservation.decided_at,
         reservation.next_slot_at, reservation.blocked_until,
         reservation.generation, reservation.lease_holder
    FROM reservation
  UNION ALL
  SELECT CASE
           WHEN gate.blocked_until > authority.decided_at THEN 'blocked'
           ELSE 'wait'
         END AS kind,
         authority.decided_at, gate.next_slot_at,
         GREATEST(gate.blocked_until, gate.lease_until) AS blocked_until,
         NULL::bigint AS generation, NULL::uuid AS lease_holder
    FROM programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
    CROSS JOIN authority
   WHERE gate.gate_id = $2
     AND NOT EXISTS (SELECT 1 FROM reservation)
  LIMIT 1
`;

const LEGACY_BLOCK_UNTIL_SQL = `
  WITH authority AS MATERIALIZED (
    SELECT clock_timestamp() AS decided_at
  ), decision AS (
    UPDATE programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
       SET generation = gate.generation + 1,
           blocked_until = LEAST(
             GREATEST(gate.blocked_until, authority.decided_at, $1::timestamptz),
             authority.decided_at + INTERVAL '5 minutes'
           ),
           lease_holder = NULL,
           lease_until = TIMESTAMPTZ 'epoch',
           updated_at = authority.decided_at
      FROM authority
     WHERE gate.gate_id = $2
       AND gate.generation = $4::bigint
       AND gate.lease_holder = $5::uuid
    RETURNING gate.gate_id, gate.generation, authority.decided_at,
              gate.next_slot_at, gate.blocked_until, gate.lease_until
  ), pruned AS (
    DELETE FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
      AS history
     USING decision
     WHERE history.gate_id = decision.gate_id
       AND history.generation <=
         decision.generation - ${HISTORY_RETENTION_GENERATIONS}
  ), history AS (
    INSERT INTO programmable_website_projection_v1.gmgn_account_gate_decisions_v1 (
      gate_id, generation, decision_kind, decided_at, next_slot_at,
      blocked_until, lease_holder, lease_until, interval_ms,
      retry_after_ms, provider_signal
    )
    SELECT gate_id, generation, 'provider-blocked', decided_at, next_slot_at,
           blocked_until, $5::uuid, lease_until, NULL,
           CEIL(EXTRACT(EPOCH FROM (blocked_until - decided_at)) * 1000)::bigint,
           $3::text
      FROM decision
  )
  SELECT decision.decided_at, decision.blocked_until,
         CEIL(EXTRACT(EPOCH FROM
           (decision.blocked_until - decision.decided_at)) * 1000)::bigint
           AS retry_after_ms
    FROM decision
`;

const LEGACY_COMPLETE_SQL = `
  WITH authority AS MATERIALIZED (
    SELECT clock_timestamp() AS decided_at
  ), decision AS (
    UPDATE programmable_website_projection_v1.gmgn_account_gate_v1 AS gate
       SET lease_holder = NULL,
           lease_until = TIMESTAMPTZ 'epoch',
           updated_at = authority.decided_at
      FROM authority
     WHERE gate.gate_id = $1
       AND gate.generation = $2::bigint
       AND gate.lease_holder = $3::uuid
    RETURNING gate.gate_id, gate.generation, authority.decided_at,
              gate.next_slot_at, gate.blocked_until, gate.lease_until
  ), pruned AS (
    DELETE FROM programmable_website_projection_v1.gmgn_account_gate_decisions_v1
      AS history
     USING decision
     WHERE history.gate_id = decision.gate_id
       AND history.generation <=
         decision.generation - ${HISTORY_RETENTION_GENERATIONS}
  ), history AS (
    INSERT INTO programmable_website_projection_v1.gmgn_account_gate_decisions_v1 (
      gate_id, generation, decision_kind, decided_at, next_slot_at,
      blocked_until, lease_holder, lease_until, interval_ms,
      retry_after_ms, provider_signal
    )
    SELECT gate_id, generation, 'completed', decided_at, next_slot_at,
           blocked_until, $3::uuid, lease_until, NULL, 0, NULL
      FROM decision
  )
  SELECT generation FROM decision
`;

export class PostgresGmgnAccountGateV1 implements GmgnAccountGateV1 {
  readonly #pool: ProjectionTargetPostgresPoolV1;
  readonly #nowMs: () => number;
  readonly #delay: (ms: number, signal?: AbortSignal) => Promise<boolean>;
  readonly #assertReady: () => Promise<void>;
  readonly #assertMultiflightReady: () => Promise<void>;
  #multiflightAvailable = false;
  #schemaProbeValidUntilMs = 0;
  #schemaProbe: Promise<boolean> | null = null;

  constructor(
    pool: ProjectionTargetPostgresPoolV1,
    options: Readonly<{
      nowMs?: () => number;
      delay?: (ms: number, signal?: AbortSignal) => Promise<boolean>;
      assertReady?: () => Promise<void>;
      assertMultiflightReady?: () => Promise<void>;
    }> = {},
  ) {
    this.#pool = pool;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#delay = options.delay ?? abortableDelay;
    this.#assertReady = options.assertReady ?? (async () => {});
    this.#assertMultiflightReady = options.assertMultiflightReady ??
      (async () => {});
  }

  async #supportsMultiflightSchema(): Promise<boolean> {
    if (this.#multiflightAvailable) {
      await this.#assertMultiflightReady();
      return true;
    }
    if (Date.now() < this.#schemaProbeValidUntilMs) return false;
    this.#schemaProbe ??= this.#pool.query<SchemaProbeRowV1>(`
      SELECT to_regclass(
        'programmable_website_projection_v1.gmgn_account_gate_leases_v1'
      )::text AS relation
    `).then(async (result) => {
      const row = exactlyOne(
        result.rows,
        "GMGN account gate schema probe is unavailable",
      );
      const available = row.relation ===
        "programmable_website_projection_v1.gmgn_account_gate_leases_v1";
      if (available) await this.#assertMultiflightReady();
      this.#multiflightAvailable = available;
      this.#schemaProbeValidUntilMs = available
        ? Number.POSITIVE_INFINITY
        : Date.now() + 5_000;
      return available;
    });
    try {
      return await this.#schemaProbe;
    } finally {
      this.#schemaProbe = null;
    }
  }

  async #reserveLegacySlot(
    input: Readonly<{
      requestsPerSecond: number;
      cost?: GmgnAccountGateCostV1;
      deadlineMs: number;
      signal?: AbortSignal;
    }>,
    intervalMs: number,
    cost: GmgnAccountGateCostV1,
  ): Promise<GmgnAccountGateReservationV1 | null> {
    for (;;) {
      const localNowMs = this.#nowMs();
      if (input.signal?.aborted || input.deadlineMs <= localNowMs) return null;
      await this.#assertReady();
      const result = await this.#pool.query<LegacyGateDecisionRowV1>(
        LEGACY_RESERVE_SLOT_SQL,
        [intervalMs, GATE_ID, reservationHolder(), cost],
      );
      const row = exactlyOne(
        result.rows,
        "GMGN account gate singleton is unavailable",
      );
      const decidedAtMs = timestampMs(row.decided_at);
      const nextSlotAtMs = timestampMs(row.next_slot_at);
      const blockedUntilMs = timestampMs(row.blocked_until);
      if (row.kind === "reserved") {
        const generation = integerMs(row.generation ?? Number.NaN);
        if (!isUuid(row.lease_holder)) {
          throw new TypeError("GMGN account gate lease is invalid");
        }
        return Object.freeze({
          kind: "reserved",
          reservedAtMs: decidedAtMs,
          generation,
          holder: row.lease_holder,
        });
      }
      const retryAfterMs = Math.max(
        1,
        Math.ceil(Math.max(nextSlotAtMs, blockedUntilMs) - decidedAtMs),
      );
      if (row.kind === "blocked") {
        return Object.freeze({ kind: "blocked", retryAfterMs });
      }
      if (row.kind !== "wait") {
        throw new TypeError("GMGN account gate decision is invalid");
      }
      const remainingMs = input.deadlineMs - this.#nowMs();
      if (remainingMs <= retryAfterMs) return null;
      if (!await this.#delay(retryAfterMs, input.signal)) return null;
    }
  }

  async #blockLegacy(
    input: Readonly<{
      reservation: Extract<GmgnAccountGateReservationV1, { kind: "reserved" }>;
      blockedUntilMs: number;
      providerSignal: "http-429" | "provider-envelope";
    }>,
    requestedUntilMs: number,
  ): Promise<Readonly<{ blockedUntilMs: number; retryAfterMs: number }>> {
    const result = await this.#pool.query<GateBlockRowV1>(
      LEGACY_BLOCK_UNTIL_SQL,
      [
        new Date(requestedUntilMs).toISOString(),
        GATE_ID,
        input.providerSignal,
        input.reservation.generation,
        input.reservation.holder,
      ],
    );
    const row = exactlyOne(
      result.rows,
      "GMGN account gate lease is stale or unavailable",
    );
    return validatedBlockResult(row);
  }

  async #completeLegacy(
    reservation: Extract<GmgnAccountGateReservationV1, { kind: "reserved" }>,
  ): Promise<void> {
    const result = await this.#pool.query<Record<string, unknown>>(
      LEGACY_COMPLETE_SQL,
      [GATE_ID, reservation.generation, reservation.holder],
    );
    exactlyOne(result.rows, "GMGN account gate lease is stale or unavailable");
  }

  async status(): Promise<GmgnAccountGateStatusV1> {
    try {
      await this.#assertReady();
      return Object.freeze({
        mode: await this.#supportsMultiflightSchema()
          ? "multiflight-v1"
          : "legacy-singleflight-v1",
      });
    } catch {
      return Object.freeze({ mode: "unavailable" });
    }
  }

  async reserveSlot(input: Readonly<{
    requestsPerSecond: number;
    cost?: GmgnAccountGateCostV1;
    maximumConcurrentLeases?: number;
    deadlineMs: number;
    signal?: AbortSignal;
  }>): Promise<GmgnAccountGateReservationV1 | null> {
    const cost: unknown = input.cost === undefined ? 1 : input.cost;
    const maximumConcurrentLeases = input.maximumConcurrentLeases ??
      MAXIMUM_CONCURRENT_LEASES;
    if (
      !Number.isSafeInteger(input.requestsPerSecond)
      || input.requestsPerSecond < 1
      || input.requestsPerSecond > 20
      || !isGmgnAccountGateCostV1(cost)
      || !Number.isSafeInteger(maximumConcurrentLeases)
      || maximumConcurrentLeases < 1
      || maximumConcurrentLeases > MAXIMUM_CONCURRENT_LEASES
      || !Number.isFinite(input.deadlineMs)
    ) throw new TypeError("GMGN account gate reservation is invalid");
    const intervalMs = Math.ceil(1_000 / input.requestsPerSecond);
    for (;;) {
      const localNowMs = this.#nowMs();
      if (input.signal?.aborted || input.deadlineMs <= localNowMs) return null;
      await this.#assertReady();
      if (!await this.#supportsMultiflightSchema()) {
        return this.#reserveLegacySlot(input, intervalMs, cost);
      }
      const client = await this.#pool.connect();
      let transactionOpen = false;
      let retryAfterMs: number | null = null;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        await client.query(CONFIGURE_TRANSACTION_TIMEOUT_SQL, [
          postgresDuration(Math.min(
            MAXIMUM_TRANSACTION_MS,
            Math.max(1, Math.ceil(input.deadlineMs - this.#nowMs())),
          )),
        ]);
        exactlyOne(
          (await client.query<Record<string, unknown>>(
            LOCK_GATE_SQL,
            [GATE_ID],
          )).rows,
          "GMGN account gate singleton is unavailable",
        );
        const state = exactlyOne(
          (await client.query<GateStateRowV1>(
            READ_GATE_STATE_SQL,
            [GATE_ID],
          )).rows,
          "GMGN account gate singleton is unavailable",
        );
        const decidedAtMs = timestampMs(state.decided_at);
        const nextSlotAtMs = timestampMs(state.next_slot_at);
        const blockedUntilMs = timestampMs(state.blocked_until);
        const leaseUntilMs = timestampMs(state.lease_until);
        const activeLeases = nonNegativeInteger(state.active_leases);
        const earliestLeaseUntilMs = nullableTimestampMs(
          state.earliest_lease_until,
        );
        const latestLeaseUntilMs = nullableTimestampMs(state.latest_lease_until);
        const markerActive = state.lease_holder === MULTIFLIGHT_MARKER &&
          leaseUntilMs > decidedAtMs;
        const legacyLeaseActive = state.lease_holder !== null &&
          state.lease_holder !== MULTIFLIGHT_MARKER &&
          leaseUntilMs > decidedAtMs;
        const markerInconsistent = activeLeases > 0
          ? !markerActive || latestLeaseUntilMs === null ||
            leaseUntilMs < latestLeaseUntilMs
          : markerActive;

        if (blockedUntilMs > decidedAtMs) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return Object.freeze({
            kind: "blocked",
            retryAfterMs: Math.max(1, Math.ceil(blockedUntilMs - decidedAtMs)),
          });
        }
        const scheduleRetryMs = Math.max(
          0,
          Math.ceil(nextSlotAtMs - decidedAtMs),
        );
        const capacityUnavailable = legacyLeaseActive || markerInconsistent ||
          activeLeases >= maximumConcurrentLeases;
        if (scheduleRetryMs > 0 || capacityUnavailable) {
          const capacityUntilMs = legacyLeaseActive || markerInconsistent
            ? Math.max(leaseUntilMs, latestLeaseUntilMs ?? decidedAtMs)
            : earliestLeaseUntilMs ?? decidedAtMs + intervalMs;
          const capacityRetryMs = capacityUnavailable
            ? Math.max(
              1,
              Math.min(intervalMs, Math.ceil(capacityUntilMs - decidedAtMs)),
            )
            : 0;
          retryAfterMs = Math.max(1, scheduleRetryMs, capacityRetryMs);
          await client.query("ROLLBACK");
          transactionOpen = false;
        } else {
          if (
            input.signal?.aborted ||
            input.deadlineMs <= this.#nowMs()
          ) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return null;
          }
          const holder = reservationHolder();
          const leaseUntilMs = decidedAtMs + MAXIMUM_RESERVATION_LEASE_MS;
          const result = await client.query<GateReservationRowV1>(
            RESERVE_SLOT_SQL,
            [
              intervalMs,
              GATE_ID,
              holder,
              cost,
              MULTIFLIGHT_MARKER,
              new Date(decidedAtMs).toISOString(),
              new Date(leaseUntilMs).toISOString(),
            ],
          );
          const reservation = exactlyOne(
            result.rows,
            "GMGN account gate reservation is unavailable",
          );
          const generation = integerMs(reservation.generation);
          if (
            reservation.lease_holder !== holder ||
            timestampMs(reservation.decided_at) !== decidedAtMs ||
            !isUuid(reservation.lease_holder)
          ) throw new TypeError("GMGN account gate lease is invalid");
          if (
            input.signal?.aborted ||
            input.deadlineMs <= this.#nowMs()
          ) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return null;
          }
          await client.query("COMMIT");
          transactionOpen = false;
          return Object.freeze({
            kind: "reserved",
            reservedAtMs: decidedAtMs,
            generation,
            holder,
          });
        }
      } catch (error) {
        if (transactionOpen) await rollbackQuietly(client);
        if (isPostgresDeadlineError(error)) return null;
        throw error;
      } finally {
        client.release();
      }
      if (retryAfterMs === null) {
        throw new TypeError("GMGN account gate decision is invalid");
      }
      const remainingMs = input.deadlineMs - this.#nowMs();
      if (remainingMs <= retryAfterMs) return null;
      if (!await this.#delay(retryAfterMs, input.signal)) return null;
    }
  }

  async blockUntil(input: Readonly<{
    reservation: Extract<GmgnAccountGateReservationV1, { kind: "reserved" }>;
    blockedUntilMs: number;
    providerSignal: "http-429" | "provider-envelope";
  }>): Promise<Readonly<{
    blockedUntilMs: number;
    retryAfterMs: number;
  }>> {
    assertReservation(input.reservation);
    if (
      !Number.isFinite(input.blockedUntilMs)
      || !["http-429", "provider-envelope"].includes(input.providerSignal)
    ) throw new TypeError("GMGN account gate block decision is invalid");
    const localNowMs = this.#nowMs();
    const requestedUntilMs = Math.min(
      localNowMs + MAXIMUM_PROVIDER_COOLDOWN_MS,
      Math.max(localNowMs, Math.ceil(input.blockedUntilMs)),
    );
    await this.#assertReady();
    if (!await this.#supportsMultiflightSchema()) {
      return this.#blockLegacy(input, requestedUntilMs);
    }
    const client = await this.#pool.connect();
    let transactionOpen = false;
    let legacyFallback = false;
    let outcome: Readonly<{
      blockedUntilMs: number;
      retryAfterMs: number;
    }> | null = null;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(CONFIGURE_TRANSACTION_TIMEOUT_SQL, [
        postgresDuration(MAXIMUM_TRANSACTION_MS),
      ]);
      exactlyOne(
        (await client.query<Record<string, unknown>>(
          LOCK_GATE_SQL,
          [GATE_ID],
        )).rows,
        "GMGN account gate singleton is unavailable",
      );
      const result = await client.query<GateBlockRowV1>(BLOCK_UNTIL_SQL, [
        new Date(requestedUntilMs).toISOString(),
        GATE_ID,
        input.providerSignal,
        input.reservation.generation,
        input.reservation.holder,
        MULTIFLIGHT_MARKER,
      ]);
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        legacyFallback = true;
      } else {
        const row = exactlyOne(
          result.rows,
          "GMGN account gate lease is stale or unavailable",
        );
        outcome = validatedBlockResult(row);
        await client.query("COMMIT");
        transactionOpen = false;
      }
    } catch (error) {
      if (transactionOpen) await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
    if (legacyFallback) return this.#blockLegacy(input, requestedUntilMs);
    if (outcome === null) {
      throw new TypeError("GMGN account gate block result is invalid");
    }
    return outcome;
  }

  async complete(
    reservation: Extract<GmgnAccountGateReservationV1, { kind: "reserved" }>,
  ): Promise<void> {
    assertReservation(reservation);
    await this.#assertReady();
    if (!await this.#supportsMultiflightSchema()) {
      return this.#completeLegacy(reservation);
    }
    const client = await this.#pool.connect();
    let transactionOpen = false;
    let legacyFallback = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(CONFIGURE_TRANSACTION_TIMEOUT_SQL, [
        postgresDuration(MAXIMUM_TRANSACTION_MS),
      ]);
      exactlyOne(
        (await client.query<Record<string, unknown>>(
          LOCK_GATE_SQL,
          [GATE_ID],
        )).rows,
        "GMGN account gate singleton is unavailable",
      );
      const result = await client.query<Record<string, unknown>>(COMPLETE_SQL, [
        GATE_ID,
        reservation.generation,
        reservation.holder,
        MULTIFLIGHT_MARKER,
      ]);
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        legacyFallback = true;
      } else {
        exactlyOne(result.rows, "GMGN account gate lease is stale or unavailable");
        await client.query("COMMIT");
        transactionOpen = false;
      }
    } catch (error) {
      if (transactionOpen) await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
    if (legacyFallback) await this.#completeLegacy(reservation);
  }
}

let productionGate: PostgresGmgnAccountGateV1 | null = null;

export function getProductionGmgnAccountGateV1(): GmgnAccountGateV1 {
  if (productionGate !== null) return productionGate;
  const pool = createProductionProjectionTargetPostgresPoolV1(
    environmentValue("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL"),
    environmentPem("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM"),
    environmentValue("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE"),
  );
  productionGate = new PostgresGmgnAccountGateV1(pool, {
    assertReady: () => pool.assertGmgnAccountGateReadiness(),
    assertMultiflightReady: () => pool.assertGmgnAccountGateMultiflightReadiness(),
  });
  return productionGate;
}

export async function getProductionGmgnAccountGateStatusV1():
Promise<GmgnAccountGateStatusV1> {
  try {
    if (productionGate === null) getProductionGmgnAccountGateV1();
    return await productionGate!.status();
  } catch {
    return Object.freeze({ mode: "unavailable" });
  }
}

function environmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function environmentPem(name: string): string {
  const value = environmentValue(name).replaceAll("\\n", "\n");
  if (
    !value.includes("-----BEGIN CERTIFICATE-----")
    || !value.includes("-----END CERTIFICATE-----")
  ) throw new TypeError(`${name} is invalid`);
  return value;
}

function exactlyOne<Row>(rows: readonly Row[], message: string): Row {
  if (rows.length !== 1) throw new TypeError(message);
  return rows[0]!;
}

function timestampMs(value: Date | string): number {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(result)) throw new TypeError("GMGN account gate timestamp is invalid");
  return result;
}

function integerMs(value: number | string | bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new TypeError("GMGN account gate duration is invalid");
  }
  return result;
}

function nonNegativeInteger(value: number | string | bigint): number {
  const result = integerMs(value);
  if (result < 0) {
    throw new TypeError("GMGN account gate count is invalid");
  }
  return result;
}

function nullableTimestampMs(value: Date | string | null): number | null {
  return value === null ? null : timestampMs(value);
}

function reservationHolder(): string {
  for (;;) {
    const holder = crypto.randomUUID();
    if (holder !== MULTIFLIGHT_MARKER) return holder;
  }
}

function postgresDuration(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_TRANSACTION_MS) {
    throw new TypeError("GMGN account gate transaction deadline is invalid");
  }
  return `${value}ms`;
}

function isPostgresDeadlineError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === "55P03" || error.code === "57014";
}

function validatedBlockResult(
  row: GateBlockRowV1,
): Readonly<{ blockedUntilMs: number; retryAfterMs: number }> {
  const decidedAtMs = timestampMs(row.decided_at);
  const blockedUntilMs = timestampMs(row.blocked_until);
  const retryAfterMs = integerMs(row.retry_after_ms);
  if (blockedUntilMs < decidedAtMs || retryAfterMs < 0) {
    throw new TypeError("GMGN account gate block result is invalid");
  }
  return Object.freeze({ blockedUntilMs, retryAfterMs });
}

async function rollbackQuietly(
  client: ProjectionTargetPostgresClientV1,
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Releasing a failed transaction connection lets the pool discard it.
  }
}

function assertReservation(
  value: Extract<GmgnAccountGateReservationV1, { kind: "reserved" }>,
): void {
  if (
    value.kind !== "reserved"
    || !Number.isSafeInteger(value.generation)
    || value.generation < 1
    || !isUuid(value.holder)
  ) throw new TypeError("GMGN account gate lease is invalid");
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(value);
}

function isGmgnAccountGateCostV1(
  value: unknown,
): value is GmgnAccountGateCostV1 {
  return typeof value === "number"
    && (GMGN_ACCOUNT_GATE_COSTS as readonly number[]).includes(value);
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(true);
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
