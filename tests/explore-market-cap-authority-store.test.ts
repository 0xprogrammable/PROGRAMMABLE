import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  exploreMarketCapAuthorityStorageCommitmentV1,
  PostgresExploreMarketCapAuthorityStoreV1,
  type ExploreMarketCapAuthorityCandidateV1,
} from "../lib/market-data/explore-market-cap-authority.server";
import { canonicalizeJson } from
  "../lib/server/projection-target/canonical-json";
import { canonicalSha256 } from
  "../lib/server/projection-target/hashing";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresPoolV1,
  ProjectionTargetPostgresQueryResultV1,
} from "../lib/server/projection-target/postgres-store";

const INPUT_COMMITMENT = digest("input");
const RANKING_ONE = digest("ranking-one");
const RANKING_TWO = digest("ranking-two");
const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("Postgres explore market-cap authority store", () => {
  it("claims, builds, and atomically publishes a cold generation", async () => {
    const { database, pool } = await migratedAuthorityStore();
    const store = authorityStore(pool);
    const built = candidate("cold", RANKING_ONE);
    const build = vi.fn(async () => built);

    await expect(store.resolve(unpinned(build))).resolves.toEqual({
      kind: "ready",
      canonicalAuthority: built.canonicalAuthority,
    });
    expect(build).toHaveBeenCalledOnce();

    await database.exec("RESET ROLE");
    const state = await database.query<{
      current_generation: bigint;
      lease_generation: bigint | null;
      lease_holder: string | null;
      generations: bigint;
    }>(`
      SELECT head.current_generation, head.lease_generation,
             head.lease_holder,
             (SELECT count(*)
                FROM programmable_website_projection_v1
                  .explore_market_cap_authority_generations_v1) AS generations
        FROM programmable_website_projection_v1
          .explore_market_cap_authority_heads_v1 AS head
    `);
    expect(state.rows).toEqual([{
      current_generation: 1,
      lease_generation: null,
      lease_holder: null,
      generations: 1,
    }]);
  });

  it("serves a fresh generation without taking the refresh lock", async () => {
    const { pool } = await migratedAuthorityStore();
    const current = candidate("fresh-lock-free", RANKING_ONE);
    await authorityStore(pool).resolve(unpinned(async () => current));
    const recordedPool = new RecordingPool(pool);
    const unexpectedBuild = vi.fn(async () =>
      candidate("must-not-build", RANKING_TWO)
    );

    await expect(authorityStore(recordedPool).resolve(
      unpinned(unexpectedBuild),
    )).resolves.toEqual({
      kind: "ready",
      canonicalAuthority: current.canonicalAuthority,
    });
    expect(unexpectedBuild).not.toHaveBeenCalled();
    expect(recordedPool.queries.join("\n")).toContain(
      "explore_market_cap_authority_heads_v1",
    );
    expect(recordedPool.queries.join("\n")).not.toMatch(
      /pg_advisory_xact_lock|FOR UPDATE|SET lease_generation/u,
    );
  });

  it("awaits bounded global cleanup after the authority commit", async () => {
    const { pool } = await migratedAuthorityStore();
    const cleanupEntered = Promise.withResolvers<void>();
    const releaseCleanup = Promise.withResolvers<void>();
    const cleanupPool = new DelayedGlobalCleanupPool(
      pool,
      cleanupEntered,
      releaseCleanup,
    );
    const store = new PostgresExploreMarketCapAuthorityStoreV1(cleanupPool, {
      delay: (ms, signal) => abortableDelay(Math.min(ms, 2), signal),
    });
    const built = candidate("awaited-cleanup", RANKING_ONE);
    let settled = false;
    const resolution = store.resolve(unpinned(async () => built)).then(
      (value) => {
        settled = true;
        return value;
      },
    );

    await cleanupEntered.promise;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseCleanup.resolve();
    await expect(resolution).resolves.toEqual({
      kind: "ready",
      canonicalAuthority: built.canonicalAuthority,
    });
  });

  it("allows only one cold build across two store instances and makes the loser reread", async () => {
    const { pool } = await migratedAuthorityStore();
    const firstStore = authorityStore(pool);
    const enteredLoserPoll = Promise.withResolvers<void>();
    const releaseLoserPoll = Promise.withResolvers<void>();
    const secondStore = new PostgresExploreMarketCapAuthorityStoreV1(pool, {
      delay: async () => {
        enteredLoserPoll.resolve();
        await releaseLoserPoll.promise;
        return true;
      },
      garbageCollection: false,
    });
    const enteredBuild = Promise.withResolvers<void>();
    const releaseBuild = Promise.withResolvers<void>();
    let buildCount = 0;
    const build = vi.fn(async () => {
      buildCount += 1;
      enteredBuild.resolve();
      await releaseBuild.promise;
      return candidate("winner", RANKING_ONE);
    });

    const first = firstStore.resolve(unpinned(build));
    await enteredBuild.promise;
    const second = secondStore.resolve(unpinned(build));
    await enteredLoserPoll.promise;
    expect(buildCount).toBe(1);
    releaseBuild.resolve();
    const firstResult = await first;
    releaseLoserPoll.resolve();
    const results = [firstResult, await second];
    expect(build).toHaveBeenCalledOnce();
    expect(results).toEqual([
      { kind: "ready", canonicalAuthority: canonical("winner") },
      { kind: "ready", canonicalAuthority: canonical("winner") },
    ]);
  });

  it("takes over an expired lease and publishes its successor", async () => {
    const { database, pool } = await migratedAuthorityStore();
    await database.exec("RESET ROLE");
    await database.query(`
      INSERT INTO programmable_website_projection_v1
        .explore_market_cap_authority_heads_v1
        (authority_key, input_commitment, direction, lease_generation,
         lease_holder, lease_until)
      VALUES ($1, $2, 'desc', 1, '11111111-1111-4111-8111-111111111111',
              pg_catalog.clock_timestamp() - INTERVAL '1 second')
    `, [authorityKey(), INPUT_COMMITMENT]);
    await database.exec("SET ROLE programmable_website_projection_runtime");
    const replacement = candidate("takeover", RANKING_ONE);

    await expect(authorityStore(pool).resolve(unpinned(async () => replacement)))
      .resolves.toEqual({
        kind: "ready",
        canonicalAuthority: replacement.canonicalAuthority,
      });

    await database.exec("RESET ROLE");
    const state = await database.query<{
      current_generation: bigint;
      lease_generation: bigint | null;
      canonical_authority: string;
    }>(`
      SELECT head.current_generation, head.lease_generation,
             generation.canonical_authority
        FROM programmable_website_projection_v1
          .explore_market_cap_authority_heads_v1 AS head
        JOIN programmable_website_projection_v1
          .explore_market_cap_authority_generations_v1 AS generation
          ON generation.authority_key = head.authority_key
         AND generation.generation = head.current_generation
    `);
    expect(state.rows).toEqual([{
      current_generation: 1,
      lease_generation: null,
      canonical_authority: replacement.canonicalAuthority,
    }]);
  });

  it("caps a late committed claim at the request deadline so it cannot strand a lease", async () => {
    const { database, pool } = await migratedAuthorityStore();
    const commitApplied = Promise.withResolvers<void>();
    const releaseCommitResult = Promise.withResolvers<void>();
    const lateConnectionReleased = Promise.withResolvers<void>();
    const delayedPool = new DelayedFirstCommitPool(
      pool,
      commitApplied,
      releaseCommitResult,
      lateConnectionReleased,
    );
    const abandonedBuild = vi.fn(async () =>
      candidate("must-not-build", RANKING_ONE)
    );
    const deadlineMs = Date.now() + 3_300;
    const lateClaim = authorityStore(delayedPool).resolve({
      ...unpinned(abandonedBuild),
      deadlineMs,
    });
    await commitApplied.promise;

    await expect(lateClaim).resolves.toEqual({ kind: "unavailable" });
    expect(abandonedBuild).not.toHaveBeenCalled();
    releaseCommitResult.resolve();
    await lateConnectionReleased.promise;

    await database.exec("RESET ROLE");
    const stranded = await database.query<{
      lease_holder: string | null;
      lease_until: Date | string;
    }>(`
      SELECT lease_holder, lease_until
        FROM programmable_website_projection_v1
          .explore_market_cap_authority_heads_v1
    `);
    expect(stranded.rows).toHaveLength(1);
    expect(stranded.rows[0]!.lease_holder).not.toBeNull();
    expect(new Date(stranded.rows[0]!.lease_until).getTime())
      .toBeLessThanOrEqual(deadlineMs);
    await database.exec("SET ROLE programmable_website_projection_runtime");

    const winner = candidate("late-claim-takeover", RANKING_TWO);
    await expect(authorityStore(pool).resolve(unpinned(async () => winner)))
      .resolves.toEqual({
        kind: "ready",
        canonicalAuthority: winner.canonicalAuthority,
      });
  }, 10_000);

  it("prevents a superseded builder from publishing over the lease winner", async () => {
    const { database, pool } = await migratedAuthorityStore();
    const firstStore = authorityStore(pool);
    const secondStore = authorityStore(pool);
    const firstEntered = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const firstCandidate = candidate("superseded", RANKING_ONE);
    const winner = candidate("winner", RANKING_TWO);
    const first = firstStore.resolve(unpinned(async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
      return firstCandidate;
    }));
    await firstEntered.promise;

    await database.exec("RESET ROLE");
    await database.query(`
      UPDATE programmable_website_projection_v1
        .explore_market_cap_authority_heads_v1
         SET lease_until = pg_catalog.clock_timestamp() - INTERVAL '1 second'
    `);
    await database.exec("SET ROLE programmable_website_projection_runtime");
    await expect(secondStore.resolve(unpinned(async () => winner)))
      .resolves.toEqual({
        kind: "ready",
        canonicalAuthority: winner.canonicalAuthority,
      });
    releaseFirst.resolve();
    await expect(first).resolves.toEqual({
      kind: "ready",
      canonicalAuthority: winner.canonicalAuthority,
    });

    await database.exec("RESET ROLE");
    const generations = await database.query<{
      generation: bigint;
      canonical_authority: string;
    }>(`
      SELECT generation, canonical_authority
        FROM programmable_website_projection_v1
          .explore_market_cap_authority_generations_v1
       ORDER BY generation
    `);
    expect(generations.rows).toEqual([{
      generation: 1,
      canonical_authority: winner.canonicalAuthority,
    }]);
  });

  it("retains and resolves an exact old generation by ranking commitment", async () => {
    const { database, pool } = await migratedAuthorityStore();
    const store = authorityStore(pool);
    const first = candidate("first", RANKING_ONE);
    const second = candidate("second", RANKING_TWO);
    await expect(store.resolve(unpinned(async () => first)))
      .resolves.toMatchObject({ kind: "ready" });
    await expireRefresh(database);
    await expect(store.resolve(unpinned(async () => second)))
      .resolves.toEqual({
        kind: "ready",
        canonicalAuthority: second.canonicalAuthority,
      });

    await expect(store.resolve(pinned(RANKING_ONE, (authority) =>
      authority === first.canonicalAuthority
    ))).resolves.toEqual({
      kind: "ready",
      canonicalAuthority: first.canonicalAuthority,
    });
    await expect(store.resolve(pinned(RANKING_ONE, () => false)))
      .resolves.toEqual({ kind: "ranking-conflict" });
  });

  it.each([
    ["payload", canonicalizeJson({ label: "tampered" }), digest("wrong")],
    ["commitment", canonical("original"), digest("wrong")],
  ])("fails closed when the stored %s is corrupt", async (
    _case,
    corruptAuthority,
    corruptCommitment,
  ) => {
    const { database, pool } = await migratedAuthorityStore();
    const store = authorityStore(pool);
    const original = candidate("original", RANKING_ONE);
    await store.resolve(unpinned(async () => original));
    await database.exec("RESET ROLE");
    await database.query(`
      UPDATE programmable_website_projection_v1
        .explore_market_cap_authority_generations_v1
         SET canonical_authority = $1,
             authority_commitment = $2,
             generated_at = pg_catalog.clock_timestamp() - INTERVAL '61 seconds',
             refresh_after = pg_catalog.clock_timestamp() - INTERVAL '1 second',
             valid_until = pg_catalog.clock_timestamp() + INTERVAL '100 seconds'
    `, [corruptAuthority, corruptCommitment]);
    await database.exec("SET ROLE programmable_website_projection_runtime");
    const build = vi.fn(async () => {
      throw new Error("provider unavailable");
    });

    await expect(store.resolve(unpinned(build)))
      .resolves.toEqual({ kind: "unavailable" });
    expect(build).toHaveBeenCalledOnce();
    await expect(store.resolve(pinned(RANKING_ONE, () => true)))
      .resolves.toEqual({ kind: "ranking-conflict" });
  });

  it("returns unavailable when readiness fails or the request deadline has elapsed", async () => {
    const { pool } = await migratedAuthorityStore();
    const build = vi.fn(async () => candidate("unused", RANKING_ONE));
    const readinessFailure = new PostgresExploreMarketCapAuthorityStoreV1(pool, {
      assertReady: async () => {
        throw new Error("attestation failed");
      },
      garbageCollection: false,
    });
    await expect(readinessFailure.resolve(unpinned(build)))
      .resolves.toEqual({ kind: "unavailable" });
    expect(build).not.toHaveBeenCalled();

    await expect(authorityStore(pool).resolve({
      ...unpinned(build),
      deadlineMs: Date.now() - 1,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(build).not.toHaveBeenCalled();
  });

  it("bounds unresolved readiness and transaction work by the request deadline", async () => {
    const { pool } = await migratedAuthorityStore();
    const build = vi.fn(async () => candidate("unused", RANKING_ONE));
    const unresolvedReadiness = new PostgresExploreMarketCapAuthorityStoreV1(
      pool,
      {
        assertReady: () => new Promise<void>(() => {}),
        garbageCollection: false,
      },
    );
    const readinessStartedAt = Date.now();
    await expect(unresolvedReadiness.resolve({
      ...unpinned(build),
      deadlineMs: readinessStartedAt + 30,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(Date.now() - readinessStartedAt).toBeLessThan(500);
    expect(build).not.toHaveBeenCalled();

    const hangingQuery = vi.fn();
    const unresolvedQuery = <
    Row extends Record<string, unknown> = Record<string, unknown>
    >(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> => {
      hangingQuery(text, values);
      return new Promise(() => {});
    };
    const hangingPool: ProjectionTargetPostgresPoolV1 = {
      connect: async () => ({ query: unresolvedQuery, release: vi.fn() }),
      query: unresolvedQuery,
    };
    const unresolvedTransaction = authorityStore(hangingPool);
    const transactionStartedAt = Date.now();
    await expect(unresolvedTransaction.resolve({
      ...unpinned(build),
      deadlineMs: transactionStartedAt + 30,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(Date.now() - transactionStartedAt).toBeLessThan(500);
    expect(hangingQuery).toHaveBeenCalledWith("BEGIN", []);
    expect(build).not.toHaveBeenCalled();
  });

  it("serves a still-valid last-known generation when its refresh build fails", async () => {
    const { database, pool } = await migratedAuthorityStore();
    const store = authorityStore(pool);
    const lastKnown = candidate("last-known-good", RANKING_ONE);
    await store.resolve(unpinned(async () => lastKnown));
    await expireRefresh(database);
    const failedRefresh = vi.fn(async () => {
      throw new Error("provider unavailable");
    });

    await expect(store.resolve(unpinned(failedRefresh))).resolves.toEqual({
      kind: "ready",
      canonicalAuthority: lastKnown.canonicalAuthority,
    });
    expect(failedRefresh).toHaveBeenCalledOnce();
  });
});

function unpinned(
  build: () => Promise<ExploreMarketCapAuthorityCandidateV1>,
) {
  return Object.freeze({
    inputCommitment: INPUT_COMMITMENT,
    direction: "desc" as const,
    build,
    deadlineMs: Date.now() + 5_000,
  });
}

function pinned(
  rankingCommitment: `sha256:${string}`,
  acceptPinnedAuthority: (canonicalAuthority: string) => boolean,
) {
  return Object.freeze({
    inputCommitment: INPUT_COMMITMENT,
    direction: "desc" as const,
    rankingCommitment,
    acceptPinnedAuthority,
    deadlineMs: Date.now() + 5_000,
  });
}

function candidate(
  label: string,
  rankingCommitment: `sha256:${string}`,
): ExploreMarketCapAuthorityCandidateV1 {
  const generatedAt = new Date().toISOString();
  const canonicalAuthority = canonical(label);
  return Object.freeze({
    canonicalAuthority,
    authorityCommitment:
      exploreMarketCapAuthorityStorageCommitmentV1(canonicalAuthority),
    rankingCommitment,
    gmgnStatus: "complete",
    generatedAt,
    validUntil: new Date(Date.parse(generatedAt) + 200_000).toISOString(),
  });
}

function canonical(label: string): string {
  return canonicalizeJson({ label });
}

function digest(label: string): `sha256:${string}` {
  return canonicalSha256("programmable.test-explore-market-cap-authority.v1", {
    label,
  });
}

function authorityKey(): `sha256:${string}` {
  return canonicalSha256(
    "programmable.explore-market-cap-authority-key.v1",
    { direction: "desc", inputCommitment: INPUT_COMMITMENT },
  );
}

function authorityStore(pool: ProjectionTargetPostgresPoolV1) {
  return new PostgresExploreMarketCapAuthorityStoreV1(pool, {
    delay: (ms, signal) => abortableDelay(Math.min(ms, 2), signal),
    garbageCollection: false,
  });
}

async function expireRefresh(database: PGlite): Promise<void> {
  await database.exec("RESET ROLE");
  await database.exec(`
    UPDATE programmable_website_projection_v1
      .explore_market_cap_authority_generations_v1
       SET generated_at = pg_catalog.clock_timestamp() - INTERVAL '61 seconds',
           refresh_after = pg_catalog.clock_timestamp() - INTERVAL '1 second',
           valid_until = pg_catalog.clock_timestamp() + INTERVAL '100 seconds'
  `);
  await database.exec("SET ROLE programmable_website_projection_runtime");
}

async function migratedAuthorityStore(): Promise<Readonly<{
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
    CREATE SCHEMA programmable_website_projection_v1;
    REVOKE ALL ON SCHEMA programmable_website_projection_v1 FROM PUBLIC;
    GRANT USAGE ON SCHEMA programmable_website_projection_v1
      TO programmable_website_projection_runtime;
  `);
  const migration = await readFile(new URL(
    "../ops/website-projection-target/migrations/0008_explore_market_cap_authority_v1.sql",
    import.meta.url,
  ), "utf8");
  await database.exec(migration);
  await database.exec("SET ROLE programmable_website_projection_runtime");
  return Object.freeze({ database, pool: new SerializedPGlitePool(database) });
}

class SerializedPGlitePool implements ProjectionTargetPostgresPoolV1 {
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
    const client = await this.connect();
    try {
      return await client.query<Row>(text, values);
    } finally {
      client.release();
    }
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

class DelayedFirstCommitPool implements ProjectionTargetPostgresPoolV1 {
  private delayed = false;
  private leaseMutationSeen = false;

  constructor(
    private readonly delegate: ProjectionTargetPostgresPoolV1,
    private readonly commitApplied: PromiseWithResolvers<void>,
    private readonly releaseCommitResult: PromiseWithResolvers<void>,
    private readonly lateConnectionReleased: PromiseWithResolvers<void>,
  ) {}

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    const client = await this.delegate.connect();
    let delayedConnection = false;
    return {
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => {
        const result = await client.query<Row>(text, values);
        if (text.includes("SET lease_generation = $2")) {
          this.leaseMutationSeen = true;
        }
        if (
          !this.delayed && this.leaseMutationSeen && text === "COMMIT"
        ) {
          this.delayed = true;
          delayedConnection = true;
          this.commitApplied.resolve();
          await this.releaseCommitResult.promise;
        }
        return result;
      },
      release: () => {
        client.release();
        if (delayedConnection) this.lateConnectionReleased.resolve();
      },
    };
  }

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    return this.delegate.query<Row>(text, values);
  }
}

class RecordingPool implements ProjectionTargetPostgresPoolV1 {
  readonly queries: string[] = [];

  constructor(private readonly delegate: ProjectionTargetPostgresPoolV1) {}

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    const client = await this.delegate.connect();
    return {
      query: <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => {
        this.queries.push(text);
        return client.query<Row>(text, values);
      },
      release: () => client.release(),
    };
  }

  async query<
  Row extends Record<string, unknown> = Record<string, unknown>
  >(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    this.queries.push(text);
    return this.delegate.query<Row>(text, values);
  }
}

class DelayedGlobalCleanupPool implements ProjectionTargetPostgresPoolV1 {
  private delayed = false;

  constructor(
    private readonly delegate: ProjectionTargetPostgresPoolV1,
    private readonly entered: PromiseWithResolvers<void>,
    private readonly releaseQuery: PromiseWithResolvers<void>,
  ) {}

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    const client = await this.delegate.connect();
    return {
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => {
        const result = await client.query<Row>(text, values);
        if (!this.delayed && text.includes("WHERE ctid IN")) {
          this.delayed = true;
          this.entered.resolve();
          await this.releaseQuery.promise;
        }
        return result;
      },
      release: () => client.release(),
    };
  }

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    return this.delegate.query<Row>(text, values);
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(false);
    }, { once: true });
  });
}
