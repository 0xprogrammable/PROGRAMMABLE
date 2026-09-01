import "server-only";

import type {
  ProjectionTargetPostgresPoolV1,
} from "../server/projection-target/postgres-store";
import {
  createProductionProjectionTargetPostgresPoolV1,
} from "../server/projection-target/website-target";

const GATE_ID = "gmgn-openapi-v1" as const;
const MAXIMUM_BLOCK_MS = 5 * 60_000;
const HISTORY_RETENTION_GENERATIONS = 256;
const GMGN_ACCOUNT_GATE_COSTS = [1, 2, 3, 5] as const;

export type GmgnAccountGateCostV1 =
  (typeof GMGN_ACCOUNT_GATE_COSTS)[number];

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

interface GateDecisionRowV1 extends Record<string, unknown> {
  kind: string;
  decided_at: Date | string;
  next_slot_at: Date | string;
  blocked_until: Date | string;
  generation?: number | string | bigint;
  lease_holder?: string;
}

interface GateBlockRowV1 extends Record<string, unknown> {
  decided_at: Date | string;
  blocked_until: Date | string;
  retry_after_ms: number | string | bigint;
}

const RESERVE_SLOT_SQL = `
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

const BLOCK_UNTIL_SQL = `
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

const COMPLETE_SQL = `
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

  constructor(
    pool: ProjectionTargetPostgresPoolV1,
    options: Readonly<{
      nowMs?: () => number;
      delay?: (ms: number, signal?: AbortSignal) => Promise<boolean>;
      assertReady?: () => Promise<void>;
    }> = {},
  ) {
    this.#pool = pool;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#delay = options.delay ?? abortableDelay;
    this.#assertReady = options.assertReady ?? (async () => {});
  }

  async reserveSlot(input: Readonly<{
    requestsPerSecond: number;
    cost?: GmgnAccountGateCostV1;
    deadlineMs: number;
    signal?: AbortSignal;
  }>): Promise<GmgnAccountGateReservationV1 | null> {
    const cost: unknown = input.cost === undefined ? 1 : input.cost;
    if (
      !Number.isSafeInteger(input.requestsPerSecond)
      || input.requestsPerSecond < 1
      || input.requestsPerSecond > 20
      || !isGmgnAccountGateCostV1(cost)
      || !Number.isFinite(input.deadlineMs)
    ) throw new TypeError("GMGN account gate reservation is invalid");
    const intervalMs = Math.ceil(1_000 / input.requestsPerSecond);
    for (;;) {
      const localNowMs = this.#nowMs();
      if (input.signal?.aborted || input.deadlineMs <= localNowMs) return null;
      await this.#assertReady();
      const result = await this.#pool.query<GateDecisionRowV1>(
        RESERVE_SLOT_SQL,
        [intervalMs, GATE_ID, crypto.randomUUID(), cost],
      );
      const row = exactlyOne(result.rows, "GMGN account gate singleton is unavailable");
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
      localNowMs + MAXIMUM_BLOCK_MS,
      Math.max(localNowMs, Math.ceil(input.blockedUntilMs)),
    );
    await this.#assertReady();
    const result = await this.#pool.query<GateBlockRowV1>(
      BLOCK_UNTIL_SQL,
      [
        new Date(requestedUntilMs).toISOString(),
        GATE_ID,
        input.providerSignal,
        input.reservation.generation,
        input.reservation.holder,
      ],
    );
    const row = exactlyOne(result.rows, "GMGN account gate singleton is unavailable");
    const decidedAtMs = timestampMs(row.decided_at);
    const blockedUntilMs = timestampMs(row.blocked_until);
    const retryAfterMs = integerMs(row.retry_after_ms);
    if (blockedUntilMs < decidedAtMs || retryAfterMs < 0) {
      throw new TypeError("GMGN account gate block result is invalid");
    }
    return Object.freeze({ blockedUntilMs, retryAfterMs });
  }

  async complete(
    reservation: Extract<GmgnAccountGateReservationV1, { kind: "reserved" }>,
  ): Promise<void> {
    assertReservation(reservation);
    await this.#assertReady();
    const result = await this.#pool.query<Record<string, unknown>>(
      COMPLETE_SQL,
      [GATE_ID, reservation.generation, reservation.holder],
    );
    exactlyOne(result.rows, "GMGN account gate lease is stale or unavailable");
  }
}

let productionGate: GmgnAccountGateV1 | null = null;

export function getProductionGmgnAccountGateV1(): GmgnAccountGateV1 {
  if (productionGate !== null) return productionGate;
  const pool = createProductionProjectionTargetPostgresPoolV1(
    environmentValue("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL"),
    environmentPem("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM"),
    environmentValue("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE"),
  );
  productionGate = new PostgresGmgnAccountGateV1(pool, {
    assertReady: () => pool.assertGmgnAccountGateReadiness(),
  });
  return productionGate;
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
