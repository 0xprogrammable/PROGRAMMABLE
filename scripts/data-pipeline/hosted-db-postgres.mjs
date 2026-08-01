import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

import {
  compareMigrationHistory,
  sha256,
  validateDirectSupabaseTarget,
} from "./hosted-db-operator-core.mjs";

const HISTORY_DDL = `
set lock_timeout = '4s';
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key
);
alter table supabase_migrations.schema_migrations
  add column if not exists statements text[];
alter table supabase_migrations.schema_migrations
  add column if not exists name text;
create table if not exists supabase_migrations.programmable_migration_evidence (
  version text primary key
    references supabase_migrations.schema_migrations(version) on delete restrict,
  name text not null,
  file_name text not null unique,
  ordinal integer not null unique check (ordinal > 0),
  file_sha256 text not null
    check (file_sha256 ~ '^0x[0-9a-f]{64}$'),
  plan_sha256 text not null
    check (plan_sha256 ~ '^0x[0-9a-f]{64}$'),
  repository_commit text not null
    check (repository_commit ~ '^[0-9a-f]{40}$'),
  applied_at timestamptz not null default pg_catalog.clock_timestamp()
);
revoke all on schema supabase_migrations from public;
revoke all on table supabase_migrations.schema_migrations from public;
revoke all on table supabase_migrations.programmable_migration_evidence from public;
reset lock_timeout;
`;

function sslConfiguration(caPem) {
  if (
    typeof caPem !== "string" ||
    caPem.length < 64 ||
    caPem.length > 32_768 ||
    !caPem.includes("-----BEGIN CERTIFICATE-----") ||
    !caPem.includes("-----END CERTIFICATE-----")
  ) {
    throw new Error("a valid server-only Postgres CA certificate is required");
  }
  return { rejectUnauthorized: true, ca: caPem };
}

export async function openHostedDatabase({
  databaseUrl,
  expectedProjectRef,
  sslCaPem,
}) {
  const target = validateDirectSupabaseTarget(databaseUrl, expectedProjectRef);
  const connectionUrl = new URL(databaseUrl);
  connectionUrl.searchParams.delete("sslmode");
  const sql = postgres(connectionUrl.toString(), {
    ssl: sslConfiguration(sslCaPem),
    max: 1,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 5,
    max_lifetime: 60,
    onnotice: () => {},
    connection: {
      application_name: "programmable-hosted-db-operator",
    },
  });
  try {
    const [identity] = await sql.unsafe(`
      select
        pg_catalog.current_database() as database_name,
        pg_catalog.inet_server_port() as server_port,
        pg_catalog.current_setting('server_version_num') as server_version_num
    `);
    if (
      identity?.database_name !== "postgres" ||
      Number(identity?.server_port) !== 5432 ||
      Number(identity?.server_version_num) < 150000
    ) {
      throw new Error("connected database identity is not an approved target");
    }
  } catch (error) {
    await sql.end({ timeout: 1 }).catch(() => {});
    throw error;
  }
  return Object.freeze({ sql, target });
}

export async function readRemoteMigrationState(sql) {
  const [tables] = await sql.unsafe(`
    select
      pg_catalog.to_regclass('supabase_migrations.schema_migrations')::text
        as history_table,
      pg_catalog.to_regclass(
        'supabase_migrations.programmable_migration_evidence'
      )::text as evidence_table
  `);
  const historyPresent =
    tables?.history_table === "supabase_migrations.schema_migrations";
  const evidenceTablePresent =
    tables?.evidence_table ===
    "supabase_migrations.programmable_migration_evidence";
  const historyRows = historyPresent
    ? await sql.unsafe(`
        select version, coalesce(name, '') as name, statements
        from supabase_migrations.schema_migrations
        order by version
      `)
    : [];
  const evidenceRows = evidenceTablePresent
    ? await sql.unsafe(`
        select version, name, file_name, ordinal, file_sha256,
               plan_sha256, repository_commit
        from supabase_migrations.programmable_migration_evidence
        order by ordinal
      `)
    : [];
  return { historyRows, evidenceRows, evidenceTablePresent };
}

export async function inspectMigrationState({ sql, plan }) {
  const remote = await readRemoteMigrationState(sql);
  return compareMigrationHistory({ plan, ...remote });
}

async function ensureMigrationHistory(sql) {
  await sql.unsafe(HISTORY_DDL).simple();
}

async function applyMigration({ sql, workspace, plan, migration }) {
  const absolutePath = path.resolve(workspace, migration.file);
  const contents = await readFile(absolutePath);
  if (
    contents.byteLength !== migration.bytes ||
    sha256(contents) !== migration.fileSha256
  ) {
    throw new Error(`migration file changed after planning: ${migration.version}`);
  }
  const migrationSql = contents.toString("utf8");
  await sql.unsafe("reset all").simple();
  await sql.begin(async (transaction) => {
    await transaction
      .unsafe("set local lock_timeout = '4s'; set local statement_timeout = '15min'")
      .simple();
    await transaction.unsafe(migrationSql).simple();
    await transaction`
      insert into supabase_migrations.schema_migrations (
        version, name, statements
      ) values (
        ${migration.version},
        ${migration.name},
        ${transaction.array([migrationSql])}
      )
    `;
    await transaction`
      insert into supabase_migrations.programmable_migration_evidence (
        version, name, file_name, ordinal, file_sha256,
        plan_sha256, repository_commit
      ) values (
        ${migration.version},
        ${migration.name},
        ${path.posix.basename(migration.file)},
        ${migration.ordinal},
        ${migration.fileSha256},
        ${plan.planSha256},
        ${plan.repositoryCommit}
      )
    `;
  });
}

export async function applyPendingMigrations({ sql, workspace, plan }) {
  const [lock] = await sql.unsafe(`
    select pg_catalog.pg_try_advisory_lock(
      pg_catalog.hashtextextended(
        'programmable:hosted-db-migrations:v1', 0
      )
    ) as acquired
  `);
  if (lock?.acquired !== true) {
    throw new Error("another migration operator holds the database lock");
  }
  try {
    const before = await readRemoteMigrationState(sql);
    const initial = compareMigrationHistory({ plan, ...before });
    if (initial.pending.length === 0) {
      return { ...initial, appliedThisRun: [] };
    }
    const appliedThisRun = initial.pending.map(({ version }) => version);
    await ensureMigrationHistory(sql);
    for (const pending of initial.pending) {
      const migration = plan.migrations.find(
        ({ version }) => version === pending.version,
      );
      if (!migration) {
        throw new Error("pending migration is absent from the plan");
      }
      await applyMigration({ sql, workspace, plan, migration });
    }
    return {
      ...(await inspectMigrationState({ sql, plan })),
      appliedThisRun,
    };
  } finally {
    await sql
      .unsafe(`
        select pg_catalog.pg_advisory_unlock(
          pg_catalog.hashtextextended(
            'programmable:hosted-db-migrations:v1', 0
          )
        )
      `)
      .catch(() => {});
  }
}

export async function closeHostedDatabase(sql) {
  await sql.end({ timeout: 5 });
}
