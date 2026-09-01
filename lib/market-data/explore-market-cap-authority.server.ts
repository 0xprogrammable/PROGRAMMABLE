import "server-only";

import { randomUUID } from "node:crypto";

import {
  canonicalizeJson,
  parseStrictJson,
} from "../server/projection-target/canonical-json";
import { canonicalSha256 } from
  "../server/projection-target/hashing";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresPoolV1,
} from "../server/projection-target/postgres-store";
import {
  createProductionProjectionTargetPostgresPoolV1,
  type ProductionProjectionTargetPostgresPoolV1,
} from "../server/projection-target/website-target";

export const EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_AGE_MS = 235_000;
export const EXPLORE_MARKET_CAP_AUTHORITY_POSITIVE_REFRESH_MS = 60_000;
export const EXPLORE_MARKET_CAP_AUTHORITY_UNAVAILABLE_REFRESH_MS = 10_000;
export const EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_BYTES = 16 * 1_024 * 1_024;
const EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_RETAINED_GENERATIONS = 32;
// The provider build is bounded to eight seconds. The extra seven seconds keep
// a slow successful build from losing its lease while its immutable generation
// is validated and published.
const EXPLORE_MARKET_CAP_AUTHORITY_LEASE_MS = 15_000;
const EXPLORE_MARKET_CAP_AUTHORITY_POLL_MINIMUM_MS = 250;
const EXPLORE_MARKET_CAP_AUTHORITY_TRANSACTION_MS = 2_500;
const EXPLORE_MARKET_CAP_AUTHORITY_CLAIM_RESERVE_MS = 3_000;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export type ExploreMarketCapAuthorityDirectionV1 = "asc" | "desc";

export type ExploreMarketCapAuthorityCandidateV1 = Readonly<{
  canonicalAuthority: string;
  authorityCommitment: `sha256:${string}`;
  rankingCommitment: `sha256:${string}`;
  gmgnStatus: "complete" | "partial" | "unavailable";
  generatedAt: string;
  validUntil: string;
}>;

export type ExploreMarketCapAuthorityResolutionV1 =
  | Readonly<{ kind: "ready"; canonicalAuthority: string }>
  | Readonly<{ kind: "ranking-conflict" }>
  | Readonly<{ kind: "unavailable" }>;

export type ExploreMarketCapAuthorityResolveInputV1 = Readonly<{
  inputCommitment: `sha256:${string}`;
  direction: ExploreMarketCapAuthorityDirectionV1;
  rankingCommitment?: `sha256:${string}`;
  acceptPinnedAuthority?: (canonicalAuthority: string) => boolean;
  build?: () => Promise<ExploreMarketCapAuthorityCandidateV1>;
  deadlineMs: number;
  signal?: AbortSignal;
}>;

interface AuthorityHeadRowV1 extends Record<string, unknown> {
  input_commitment: string;
  direction: string;
  current_generation: string | number | bigint;
  lease_generation: string | number | bigint | null;
  lease_holder: string | null;
  lease_until: Date | string;
  decided_at: Date | string;
  canonical_authority: string | null;
  generated_at: Date | string | null;
  refresh_after: Date | string | null;
  valid_until: Date | string | null;
  authority_commitment: string | null;
}

interface AuthorityGenerationRowV1 extends Record<string, unknown> {
  canonical_authority: string;
  authority_commitment: string;
}

type ClaimDecisionV1 =
  | Readonly<{ kind: "ready"; canonicalAuthority: string }>
  | Readonly<{
      kind: "build";
      holder: string;
      generation: number;
      decidedAtMs: number;
      fallbackCanonicalAuthority: string | null;
      fallbackValidUntilMs: number | null;
    }>
  | Readonly<{ kind: "wait" }>;

type CurrentDecisionV1 =
  | Readonly<{ kind: "ready"; canonicalAuthority: string }>
  | Readonly<{ kind: "claim" }>
  | Readonly<{ kind: "wait" }>;

export class PostgresExploreMarketCapAuthorityStoreV1 {
  readonly #pool: ProjectionTargetPostgresPoolV1;
  readonly #assertReady: () => Promise<void>;
  readonly #delay: (ms: number, signal?: AbortSignal) => Promise<boolean>;
  readonly #garbageCollectionEnabled: boolean;

  constructor(
    pool: ProjectionTargetPostgresPoolV1,
    options: Readonly<{
      assertReady?: () => Promise<void>;
      delay?: (ms: number, signal?: AbortSignal) => Promise<boolean>;
      garbageCollection?: boolean;
    }> = {},
  ) {
    if (
      pool === null || typeof pool !== "object" ||
      typeof pool.connect !== "function" || typeof pool.query !== "function"
    ) throw new TypeError("Explore market-cap authority pool is invalid");
    this.#pool = pool;
    this.#assertReady = options.assertReady ?? (async () => {});
    this.#delay = options.delay ?? abortableDelay;
    this.#garbageCollectionEnabled = options.garbageCollection ?? true;
  }

  async resolve(
    input: ExploreMarketCapAuthorityResolveInputV1,
  ): Promise<ExploreMarketCapAuthorityResolutionV1> {
    validateResolveInput(input);
    try {
      if (input.signal?.aborted) {
        return Object.freeze({ kind: "unavailable" });
      }
      await settleBeforeDeadline(this.#assertReady(), input.deadlineMs);
      const authorityKey = authorityKeyV1(
        input.inputCommitment,
        input.direction,
      );
      if (input.rankingCommitment !== undefined) {
        const candidates = await settleBeforeDeadline(
          this.#readPinnedCandidates(
            authorityKey,
            input.rankingCommitment,
            input.deadlineMs,
          ),
          input.deadlineMs,
        );
        for (const canonicalAuthority of candidates) {
          if (input.acceptPinnedAuthority!(canonicalAuthority)) {
            return Object.freeze({ kind: "ready", canonicalAuthority });
          }
        }
        return Object.freeze({ kind: "ranking-conflict" });
      }

      let pollMs = EXPLORE_MARKET_CAP_AUTHORITY_POLL_MINIMUM_MS;
      while (
        !input.signal?.aborted && Date.now() < input.deadlineMs
      ) {
        const current = await settleBeforeDeadline(
          this.#readCurrentDecision(authorityKey, input, input.deadlineMs),
          input.deadlineMs,
        );
        if (current.kind === "ready") return current;
        const decision = current.kind === "claim"
          ? await settleBeforeDeadline(
              this.#claimCurrentOrBuild(authorityKey, input),
              input.deadlineMs,
            )
          : current;
        if (decision.kind === "ready") return decision;
        if (decision.kind === "build") {
          let candidate: ExploreMarketCapAuthorityCandidateV1;
          try {
            candidate = validateCandidate(
              await settleBeforeDeadline(input.build!(), input.deadlineMs),
              decision.decidedAtMs,
            );
          } catch {
            await this.#releaseLease(
              authorityKey,
              decision.holder,
              decision.generation,
              input.deadlineMs,
            );
            return readyFallbackV1(decision) ??
              Object.freeze({ kind: "unavailable" });
          }
          let published: boolean;
          try {
            published = await settleBeforeDeadline(
              this.#publish(
                authorityKey,
                decision,
                candidate,
                input.deadlineMs,
              ),
              input.deadlineMs,
            );
          } catch {
            await this.#releaseLease(
              authorityKey,
              decision.holder,
              decision.generation,
              input.deadlineMs,
            );
            return readyFallbackV1(decision) ??
              Object.freeze({ kind: "unavailable" });
          }
          if (published) {
            return Object.freeze({
              kind: "ready",
              canonicalAuthority: candidate.canonicalAuthority,
            });
          }
          const fallback = readyFallbackV1(decision);
          if (fallback !== null) return fallback;
          continue;
        }
        const remainingMs = input.deadlineMs - Date.now();
        if (remainingMs <= 0) break;
        const waited = await this.#delay(
          Math.min(
            pollMs + Math.floor(Math.random() * 100),
            remainingMs,
          ),
          input.signal,
        );
        if (!waited) break;
        pollMs = Math.min(1_000, pollMs * 2);
      }
    } catch {
      // The public route fails closed without exposing database details.
    }
    return Object.freeze({ kind: "unavailable" });
  }

  async #readCurrentDecision(
    authorityKey: `sha256:${string}`,
    input: ExploreMarketCapAuthorityResolveInputV1,
    deadlineMs: number,
  ): Promise<CurrentDecisionV1> {
    const client = await connectBeforeDeadline(this.#pool, deadlineMs);
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await configureTransaction(client, deadlineMs);
      const result = await client.query<AuthorityHeadRowV1>(`
        SELECT head.input_commitment, head.direction,
               head.current_generation, head.lease_generation,
               head.lease_holder, head.lease_until,
               generation.canonical_authority,
               generation.authority_commitment,
               generation.generated_at, generation.refresh_after,
               generation.valid_until,
               pg_catalog.clock_timestamp() AS decided_at
          FROM programmable_website_projection_v1.explore_market_cap_authority_heads_v1
            AS head
          LEFT JOIN programmable_website_projection_v1.explore_market_cap_authority_generations_v1
            AS generation
            ON generation.authority_key = head.authority_key
           AND generation.generation = head.current_generation
         WHERE head.authority_key = $1
         LIMIT 1
      `, [authorityKey]);
      await client.query("COMMIT");
      transactionOpen = false;
      if (result.rows.length === 0) {
        return Object.freeze({ kind: "claim" });
      }
      const row = exactlyOne(result.rows);
      if (
        row.input_commitment !== input.inputCommitment ||
        row.direction !== input.direction
      ) throw new TypeError("Explore market-cap authority key conflicts");
      const decidedAtMs = timestampMs(row.decided_at);
      const validUntilMs = nullableTimestampMs(row.valid_until);
      const refreshAfterMs = nullableTimestampMs(row.refresh_after);
      const currentIsValid = row.canonical_authority !== null &&
        row.authority_commitment !== null &&
        validStoredAuthorityV1(
          row.canonical_authority,
          row.authority_commitment,
        ) && validUntilMs !== null && validUntilMs >= decidedAtMs;
      if (
        currentIsValid && refreshAfterMs !== null &&
        refreshAfterMs > decidedAtMs
      ) {
        return Object.freeze({
          kind: "ready",
          canonicalAuthority: row.canonical_authority!,
        });
      }
      if (
        row.lease_holder !== null &&
        timestampMs(row.lease_until) > decidedAtMs
      ) {
        return currentIsValid
          ? Object.freeze({
              kind: "ready" as const,
              canonicalAuthority: row.canonical_authority!,
            })
          : Object.freeze({ kind: "wait" as const });
      }
      return Object.freeze({ kind: "claim" });
    } catch (error) {
      if (transactionOpen) await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #readPinnedCandidates(
    authorityKey: `sha256:${string}`,
    rankingCommitment: `sha256:${string}`,
    deadlineMs: number,
  ): Promise<readonly string[]> {
    const client = await connectBeforeDeadline(this.#pool, deadlineMs);
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await configureTransaction(client, deadlineMs);
      const result = await client.query<AuthorityGenerationRowV1>(`
        SELECT generation.canonical_authority,
               generation.authority_commitment
          FROM programmable_website_projection_v1.explore_market_cap_authority_generations_v1
            AS generation
         WHERE generation.authority_key = $1
           AND generation.ranking_commitment = $2
           AND generation.generated_at <= pg_catalog.clock_timestamp()
           AND generation.valid_until >= pg_catalog.clock_timestamp()
         ORDER BY generation.generation DESC
         LIMIT 1
      `, [authorityKey, rankingCommitment]);
      await client.query("COMMIT");
      transactionOpen = false;
      return Object.freeze(result.rows.flatMap((row) =>
        validStoredAuthorityV1(
            row.canonical_authority,
            row.authority_commitment,
          )
          ? [row.canonical_authority]
          : []
      ));
    } catch (error) {
      if (transactionOpen) await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #claimCurrentOrBuild(
    authorityKey: `sha256:${string}`,
    input: ExploreMarketCapAuthorityResolveInputV1,
  ): Promise<ClaimDecisionV1> {
    const client = await connectBeforeDeadline(this.#pool, input.deadlineMs);
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await configureTransaction(client, input.deadlineMs);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [authorityKey],
      );
      await client.query(`
        INSERT INTO programmable_website_projection_v1.explore_market_cap_authority_heads_v1
          (authority_key, input_commitment, direction)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [authorityKey, input.inputCommitment, input.direction]);
      const result = await client.query<AuthorityHeadRowV1>(`
        SELECT head.input_commitment, head.direction,
               head.current_generation, head.lease_generation,
               head.lease_holder, head.lease_until,
               generation.canonical_authority,
               generation.authority_commitment,
               generation.generated_at, generation.refresh_after,
               generation.valid_until,
               pg_catalog.clock_timestamp() AS decided_at
          FROM programmable_website_projection_v1.explore_market_cap_authority_heads_v1
            AS head
          LEFT JOIN programmable_website_projection_v1.explore_market_cap_authority_generations_v1
            AS generation
            ON generation.authority_key = head.authority_key
           AND generation.generation = head.current_generation
         WHERE head.authority_key = $1
         FOR UPDATE OF head
      `, [authorityKey]);
      const row = exactlyOne(result.rows);
      if (
        row.input_commitment !== input.inputCommitment ||
        row.direction !== input.direction
      ) throw new TypeError("Explore market-cap authority key conflicts");
      const decidedAtMs = timestampMs(row.decided_at);
      const validUntilMs = nullableTimestampMs(row.valid_until);
      const refreshAfterMs = nullableTimestampMs(row.refresh_after);
      const leaseUntilMs = timestampMs(row.lease_until);
      const currentGeneration = nonNegativeInteger(row.current_generation);
      const currentIsValid = row.canonical_authority !== null &&
        row.authority_commitment !== null &&
        validStoredAuthorityV1(
          row.canonical_authority,
          row.authority_commitment,
        ) &&
        validUntilMs !== null && validUntilMs >= decidedAtMs;
      if (
        currentIsValid && refreshAfterMs !== null &&
        refreshAfterMs > decidedAtMs
      ) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({
          kind: "ready",
          canonicalAuthority: row.canonical_authority!,
        });
      }
      if (row.lease_holder !== null && leaseUntilMs > decidedAtMs) {
        await client.query("COMMIT");
        transactionOpen = false;
        return currentIsValid
          ? Object.freeze({
              kind: "ready" as const,
              canonicalAuthority: row.canonical_authority!,
            })
          : Object.freeze({ kind: "wait" as const });
      }
      if (
        input.deadlineMs - decidedAtMs <
          EXPLORE_MARKET_CAP_AUTHORITY_CLAIM_RESERVE_MS
      ) {
        await client.query("COMMIT");
        transactionOpen = false;
        return currentIsValid
          ? Object.freeze({
              kind: "ready" as const,
              canonicalAuthority: row.canonical_authority!,
            })
          : Object.freeze({ kind: "wait" as const });
      }
      const holder = randomUUID();
      const generation = currentGeneration + 1;
      const leaseUntil = new Date(
        Math.min(
          decidedAtMs + EXPLORE_MARKET_CAP_AUTHORITY_LEASE_MS,
          input.deadlineMs,
        ),
      ).toISOString();
      const updated = await client.query<Record<string, unknown>>(`
        UPDATE programmable_website_projection_v1.explore_market_cap_authority_heads_v1
           SET lease_generation = $2,
               lease_holder = $3::uuid,
               lease_until = $4::timestamptz,
               updated_at = $5::timestamptz
         WHERE authority_key = $1
        RETURNING authority_key
      `, [
        authorityKey,
        generation,
        holder,
        leaseUntil,
        new Date(decidedAtMs).toISOString(),
      ]);
      if (updated.rowCount !== 1) {
        throw new TypeError("Explore market-cap authority lease is unavailable");
      }
      await client.query("COMMIT");
      transactionOpen = false;
      return Object.freeze({
        kind: "build",
        holder,
        generation,
        decidedAtMs,
        fallbackCanonicalAuthority: currentIsValid
          ? row.canonical_authority
          : null,
        fallbackValidUntilMs: currentIsValid ? validUntilMs : null,
      });
    } catch (error) {
      if (transactionOpen) await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #publish(
    authorityKey: `sha256:${string}`,
    claim: Extract<ClaimDecisionV1, { kind: "build" }>,
    candidate: ExploreMarketCapAuthorityCandidateV1,
    deadlineMs: number,
  ): Promise<boolean> {
    const client = await connectBeforeDeadline(this.#pool, deadlineMs);
    let transactionOpen = false;
    let clientReleased = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await configureTransaction(
        client,
        deadlineMs,
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [authorityKey],
      );
      const lease = exactlyOne((await client.query<{
        lease_generation: string | number | bigint | null;
        lease_holder: string | null;
        lease_until: Date | string;
        decided_at: Date | string;
      } & Record<string, unknown>>(`
        SELECT head.lease_generation, head.lease_holder, head.lease_until,
               pg_catalog.clock_timestamp() AS decided_at
          FROM programmable_website_projection_v1.explore_market_cap_authority_heads_v1
            AS head
         WHERE head.authority_key = $1
         FOR UPDATE
      `, [authorityKey])).rows);
      const decidedAtMs = timestampMs(lease.decided_at);
      if (
        lease.lease_holder !== claim.holder ||
        nullableNonNegativeInteger(lease.lease_generation) !== claim.generation ||
        timestampMs(lease.lease_until) <= decidedAtMs ||
        Date.parse(candidate.validUntil) <= decidedAtMs
      ) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return false;
      }
      const refreshMs = candidate.gmgnStatus === "unavailable"
        ? EXPLORE_MARKET_CAP_AUTHORITY_UNAVAILABLE_REFRESH_MS
        : EXPLORE_MARKET_CAP_AUTHORITY_POSITIVE_REFRESH_MS;
      const refreshAfter = new Date(
        Math.min(
          Date.parse(candidate.validUntil),
          Date.parse(candidate.generatedAt) + refreshMs,
        ),
      ).toISOString();
      const inserted = await client.query<Record<string, unknown>>(`
        INSERT INTO programmable_website_projection_v1.explore_market_cap_authority_generations_v1
          (authority_key, generation, authority_commitment,
           ranking_commitment, gmgn_status, generated_at, refresh_after,
           valid_until, canonical_authority)
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz,
                $8::timestamptz, $9)
        ON CONFLICT DO NOTHING
        RETURNING authority_key
      `, [
        authorityKey,
        claim.generation,
        candidate.authorityCommitment,
        candidate.rankingCommitment,
        candidate.gmgnStatus,
        candidate.generatedAt,
        refreshAfter,
        candidate.validUntil,
        candidate.canonicalAuthority,
      ]);
      if (inserted.rowCount !== 1) {
        throw new TypeError("Explore market-cap authority generation conflicts");
      }
      const updated = await client.query<Record<string, unknown>>(`
        UPDATE programmable_website_projection_v1.explore_market_cap_authority_heads_v1
           SET current_generation = $2,
               lease_generation = NULL,
               lease_holder = NULL,
               lease_until = TIMESTAMPTZ 'epoch',
               updated_at = $3::timestamptz
         WHERE authority_key = $1
           AND lease_generation = $2
           AND lease_holder = $4::uuid
        RETURNING authority_key
      `, [
        authorityKey,
        claim.generation,
        new Date(decidedAtMs).toISOString(),
        claim.holder,
      ]);
      if (updated.rowCount !== 1) {
        throw new TypeError("Explore market-cap authority publish conflicts");
      }
      await client.query(`
        DELETE FROM programmable_website_projection_v1.explore_market_cap_authority_generations_v1
         WHERE authority_key = $1
           AND (
             valid_until < $2::timestamptz
             OR generation NOT IN (
               SELECT retained.generation
                 FROM programmable_website_projection_v1.explore_market_cap_authority_generations_v1
                   AS retained
                WHERE retained.authority_key = $1
                ORDER BY retained.generation DESC
                LIMIT ${EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_RETAINED_GENERATIONS}
             )
           )
      `, [authorityKey, new Date(decidedAtMs).toISOString()]);
      await client.query("COMMIT");
      transactionOpen = false;
      client.release();
      clientReleased = true;
      if (
        this.#garbageCollectionEnabled && Date.now() < deadlineMs
      ) {
        await this.#garbageCollect(authorityKey, deadlineMs)
          .catch(() => undefined);
      }
      return true;
    } catch (error) {
      if (transactionOpen) await rollbackQuietly(client);
      throw error;
    } finally {
      if (!clientReleased) client.release();
    }
  }

  async #releaseLease(
    authorityKey: `sha256:${string}`,
    holder: string,
    generation: number,
    deadlineMs: number,
  ): Promise<void> {
    const query = this.#pool.query(`
      UPDATE programmable_website_projection_v1.explore_market_cap_authority_heads_v1
         SET lease_generation = NULL,
             lease_holder = NULL,
             lease_until = TIMESTAMPTZ 'epoch',
             updated_at = pg_catalog.clock_timestamp()
       WHERE authority_key = $1
         AND lease_generation = $2
         AND lease_holder = $3::uuid
    `, [authorityKey, generation, holder]);
    await settleBeforeDeadline(query, deadlineMs).catch(() => undefined);
  }

  async #garbageCollect(
    currentAuthorityKey: `sha256:${string}`,
    requestDeadlineMs: number,
  ): Promise<void> {
    const deadlineMs = Math.min(requestDeadlineMs, Date.now() + 1_000);
    const client = await connectBeforeDeadline(this.#pool, deadlineMs);
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await configureTransaction(client, deadlineMs);
      await client.query(`
        DELETE FROM programmable_website_projection_v1.explore_market_cap_authority_generations_v1
         WHERE ctid IN (
           SELECT generation.ctid
             FROM programmable_website_projection_v1.explore_market_cap_authority_generations_v1
               AS generation
            WHERE generation.authority_key <> $1
              AND generation.valid_until < pg_catalog.clock_timestamp()
            ORDER BY generation.valid_until
            LIMIT 256
         )
      `, [currentAuthorityKey]);
      await client.query(`
        DELETE FROM programmable_website_projection_v1.explore_market_cap_authority_heads_v1
         WHERE ctid IN (
           SELECT head.ctid
             FROM programmable_website_projection_v1.explore_market_cap_authority_heads_v1
               AS head
            WHERE head.authority_key <> $1
              AND head.lease_until <= pg_catalog.clock_timestamp()
              AND head.updated_at < pg_catalog.clock_timestamp() -
                INTERVAL '235 seconds'
              AND NOT EXISTS (
                SELECT 1
                  FROM programmable_website_projection_v1.explore_market_cap_authority_generations_v1
                    AS generation
                 WHERE generation.authority_key = head.authority_key
                   AND generation.valid_until >= pg_catalog.clock_timestamp()
              )
            ORDER BY head.updated_at
            LIMIT 64
         )
      `, [currentAuthorityKey]);
      await client.query("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

function authorityKeyV1(
  inputCommitment: `sha256:${string}`,
  direction: ExploreMarketCapAuthorityDirectionV1,
): `sha256:${string}` {
  return canonicalSha256(
    "programmable.explore-market-cap-authority-key.v1",
    { inputCommitment, direction },
  );
}

function readyFallbackV1(
  decision: Extract<ClaimDecisionV1, { kind: "build" }>,
): Extract<ExploreMarketCapAuthorityResolutionV1, { kind: "ready" }> | null {
  return decision.fallbackCanonicalAuthority !== null &&
      decision.fallbackValidUntilMs !== null &&
      decision.fallbackValidUntilMs >= Date.now()
    ? Object.freeze({
        kind: "ready" as const,
        canonicalAuthority: decision.fallbackCanonicalAuthority,
      })
    : null;
}

function validateResolveInput(
  input: ExploreMarketCapAuthorityResolveInputV1,
): void {
  if (
    !DIGEST.test(input.inputCommitment) ||
    (input.direction !== "asc" && input.direction !== "desc") ||
    !Number.isFinite(input.deadlineMs)
  ) throw new TypeError("Explore market-cap authority request is invalid");
  const pinned = input.rankingCommitment !== undefined;
  if (
    pinned !== (input.acceptPinnedAuthority !== undefined) ||
    (pinned && !DIGEST.test(input.rankingCommitment!)) ||
    (!pinned && typeof input.build !== "function")
  ) throw new TypeError("Explore market-cap authority request is invalid");
}

function validateCandidate(
  candidate: ExploreMarketCapAuthorityCandidateV1,
  decidedAtMs: number,
): ExploreMarketCapAuthorityCandidateV1 {
  if (
    !candidate || typeof candidate !== "object" ||
    !DIGEST.test(candidate.authorityCommitment) ||
    !DIGEST.test(candidate.rankingCommitment) ||
    !["complete", "partial", "unavailable"].includes(candidate.gmgnStatus)
  ) throw new TypeError("Explore market-cap authority candidate is invalid");
  const parsed = parseStrictJson(candidate.canonicalAuthority, {
    maximumBytes: EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_BYTES,
    maximumDepth: 64,
  });
  if (canonicalizeJson(parsed) !== candidate.canonicalAuthority) {
    throw new TypeError("Explore market-cap authority JSON is not canonical");
  }
  if (
    candidate.authorityCommitment !==
      exploreMarketCapAuthorityStorageCommitmentV1(
        candidate.canonicalAuthority,
      )
  ) {
    throw new TypeError("Explore market-cap authority commitment is invalid");
  }
  const generatedAtMs = exactTimestampMs(candidate.generatedAt);
  const validUntilMs = exactTimestampMs(candidate.validUntil);
  if (
    generatedAtMs > decidedAtMs + 10_000 ||
    validUntilMs <= decidedAtMs ||
    validUntilMs <= generatedAtMs ||
    validUntilMs - generatedAtMs >
      EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_AGE_MS
  ) throw new TypeError("Explore market-cap authority lifetime is invalid");
  return Object.freeze({ ...candidate });
}

export function exploreMarketCapAuthorityStorageCommitmentV1(
  canonicalAuthority: string,
): `sha256:${string}` {
  return canonicalSha256(
    "programmable.explore-market-cap-authority-storage.v1",
    { canonicalAuthority },
  );
}

function validStoredAuthorityV1(
  canonicalAuthority: string,
  authorityCommitment: string,
): boolean {
  if (!DIGEST.test(authorityCommitment)) return false;
  try {
    const parsed = parseStrictJson(canonicalAuthority, {
      maximumBytes: EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_BYTES,
      maximumDepth: 64,
    });
    return canonicalizeJson(parsed) === canonicalAuthority &&
      exploreMarketCapAuthorityStorageCommitmentV1(canonicalAuthority) ===
        authorityCommitment;
  } catch {
    return false;
  }
}

async function configureTransaction(
  client: ProjectionTargetPostgresClientV1,
  deadlineMs: number,
) {
  await client.query(
    "SELECT set_config('statement_timeout', $1, true)",
    [postgresDuration(deadlineMs - Date.now())],
  );
}

function connectBeforeDeadline(
  pool: ProjectionTargetPostgresPoolV1,
  deadlineMs: number,
): Promise<ProjectionTargetPostgresClientV1> {
  const connection = pool.connect();
  const remainingMs = Math.ceil(deadlineMs - Date.now());
  if (remainingMs <= 0) {
    void connection.then((client) => client.release(), () => undefined);
    return Promise.reject(
      new TypeError("Explore market-cap authority deadline elapsed"),
    );
  }
  return new Promise((resolve, reject) => {
    let decided = false;
    const timer = globalThis.setTimeout(() => {
      decided = true;
      reject(new TypeError("Explore market-cap authority deadline elapsed"));
    }, remainingMs);
    void connection.then((client) => {
      if (decided) {
        client.release();
        return;
      }
      decided = true;
      globalThis.clearTimeout(timer);
      resolve(client);
    }, (error: unknown) => {
      if (decided) return;
      decided = true;
      globalThis.clearTimeout(timer);
      reject(error);
    });
  });
}

function settleBeforeDeadline<T>(
  operation: Promise<T>,
  deadlineMs: number,
): Promise<T> {
  const remainingMs = Math.ceil(deadlineMs - Date.now());
  if (remainingMs <= 0) {
    void operation.catch(() => undefined);
    return Promise.reject(
      new TypeError("Explore market-cap authority deadline elapsed"),
    );
  }
  return new Promise((resolve, reject) => {
    let decided = false;
    const timer = globalThis.setTimeout(() => {
      decided = true;
      reject(new TypeError("Explore market-cap authority deadline elapsed"));
    }, remainingMs);
    void operation.then((value) => {
      if (decided) return;
      decided = true;
      globalThis.clearTimeout(timer);
      resolve(value);
    }, (error: unknown) => {
      if (decided) return;
      decided = true;
      globalThis.clearTimeout(timer);
      reject(error);
    });
  });
}

function postgresDuration(remainingMs: number): string {
  const bounded = Math.max(
    1,
    Math.min(
      EXPLORE_MARKET_CAP_AUTHORITY_TRANSACTION_MS,
      Math.ceil(remainingMs),
    ),
  );
  return `${bounded}ms`;
}

function exactlyOne<Row>(rows: readonly Row[]): Row {
  if (rows.length !== 1) {
    throw new TypeError("Explore market-cap authority row is unavailable");
  }
  return rows[0]!;
}

function timestampMs(value: Date | string): number {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(result)) {
    throw new TypeError("Explore market-cap authority timestamp is invalid");
  }
  return result;
}

function nullableTimestampMs(value: Date | string | null): number | null {
  return value === null ? null : timestampMs(value);
}

function exactTimestampMs(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) {
    throw new TypeError("Explore market-cap authority timestamp is invalid");
  }
  return result;
}

function nonNegativeInteger(value: string | number | bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new TypeError("Explore market-cap authority generation is invalid");
  }
  return result;
}

function nullableNonNegativeInteger(
  value: string | number | bigint | null,
): number | null {
  return value === null ? null : nonNegativeInteger(value);
}

async function rollbackQuietly(client: ProjectionTargetPostgresClientV1) {
  await client.query("ROLLBACK").catch(() => undefined);
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

let productionAuthorityStore:
PostgresExploreMarketCapAuthorityStoreV1 | null = null;

export function getProductionExploreMarketCapAuthorityStoreV1():
PostgresExploreMarketCapAuthorityStoreV1 {
  if (productionAuthorityStore !== null) return productionAuthorityStore;
  const pool: ProductionProjectionTargetPostgresPoolV1 =
    createProductionProjectionTargetPostgresPoolV1(
    environmentValue("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL"),
    environmentPem("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM"),
    environmentValue("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE"),
    );
  productionAuthorityStore = new PostgresExploreMarketCapAuthorityStoreV1(
    pool,
    {
      assertReady: () => pool.assertExploreMarketCapAuthorityReadiness(),
    },
  );
  return productionAuthorityStore;
}

function environmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function environmentPem(name: string): string {
  const value = environmentValue(name).replaceAll("\\n", "\n");
  if (
    !value.includes("-----BEGIN CERTIFICATE-----") ||
    !value.includes("-----END CERTIFICATE-----")
  ) throw new TypeError(`${name} is invalid`);
  return value;
}
