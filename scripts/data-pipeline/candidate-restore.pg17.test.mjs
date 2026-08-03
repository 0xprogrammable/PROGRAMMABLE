import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import postgres from "postgres";

import {
  CANDIDATE_FINAL_SCHEMAS,
  CANDIDATE_SAFETY_RECOVERY_FLAGS,
  PINNED_PRE_ATTESTATION_SNAPSHOT,
  applyOwnerAndSecurityClosure,
  assertCandidateSchemaStage,
  cleanupCandidateSchemas,
  prepareSafetyRestoreClosures,
} from "./candidate-restore.mjs";
import {
  captureDatabaseManifest,
  FINAL_BACKUP_SCHEMAS,
} from "./cutover-credentials.mjs";
import {
  discoverMigrationPlan,
  sha256,
} from "./hosted-db-operator-core.mjs";

const executeFile = promisify(execFile);
const workspace = path.resolve(new URL("../..", import.meta.url).pathname);
const configuration = Object.freeze({
  host: process.env.PROGRAMMABLE_PG17_SOCKET,
  port: process.env.PROGRAMMABLE_PG17_PORT,
  adminUser: process.env.PROGRAMMABLE_PG17_ADMIN_USER,
  templateDatabase: process.env.PROGRAMMABLE_PG17_TEMPLATE_DATABASE,
  pgDump: process.env.PROGRAMMABLE_PG_DUMP_BINARY,
  pgRestore: process.env.PROGRAMMABLE_PG_RESTORE_BINARY,
  psql: process.env.PROGRAMMABLE_PSQL_BINARY,
});
const configured = Object.values(configuration).every(
  (value) => typeof value === "string" && value.length > 0,
);

function exactConfiguration() {
  if (
    !/^\/private\/tmp\/[A-Za-z0-9._/-]+$/u.test(configuration.host) ||
    !/^\d{1,5}$/u.test(configuration.port) ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(configuration.adminUser) ||
    !/^programmable_[a-z0-9_]{3,63}$/u.test(configuration.templateDatabase) ||
    ![configuration.pgDump, configuration.pgRestore, configuration.psql].every(
      (value) => /^\/private\/tmp\/[A-Za-z0-9._/-]+$/u.test(value),
    )
  ) {
    throw new Error("PG17 integration configuration is not an exact local target");
  }
  return configuration;
}

async function runTool(binary, args) {
  const result = await executeFile(binary, args, {
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    env: { LANG: "C", LC_ALL: "C" },
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

test(
  "restricted PostgreSQL 17 applies forward migrations and exactly recovers owner/ACL state",
  { skip: !configured },
  async (t) => {
    const config = exactConfiguration();
    const suffix = `${process.pid}_${Date.now()}`;
    const database = `programmable_candidate_restore_it_${suffix}`;
    assert.match(database, /^programmable_candidate_restore_it_[0-9_]+$/u);
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "programmable-candidate-pg17-it-"),
    );
    const safetyArchive = path.join(directory, "safety.dump");
    const admin = postgres({
      host: config.host,
      port: Number(config.port),
      database: "postgres",
      username: config.adminUser,
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    t.after(async () => {
      await admin.unsafe(
        `select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where datname = '${database}' and pid <> pg_catalog.pg_backend_pid()`,
      ).catch(() => {});
      await admin.unsafe(`drop database if exists ${database}`).simple().catch(() => {});
      await admin.end({ timeout: 3 }).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    });
    await admin.unsafe(
      `create database ${database} with template ${config.templateDatabase} owner postgres`,
    ).simple();
    const sql = postgres({
      host: config.host,
      port: Number(config.port),
      database,
      username: "postgres",
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    t.after(() => sql.end({ timeout: 3 }).catch(() => {}));

    const [identity] = await sql.unsafe(`
      select session_user::text as session_user,
             current_user::text as current_user,
             role_record.rolsuper
        from pg_catalog.pg_roles as role_record
       where role_record.rolname = current_user
    `);
    assert.deepEqual(identity, {
      session_user: "postgres",
      current_user: "postgres",
      rolsuper: false,
    });
    const baseline = await captureDatabaseManifest(sql);
    assert.equal(
      baseline.manifestSha256,
      PINNED_PRE_ATTESTATION_SNAPSHOT.manifestSha256,
    );
    assert.equal(
      baseline.structuralManifestSha256,
      PINNED_PRE_ATTESTATION_SNAPSHOT.structuralManifestSha256,
    );

    const migrationPlan = await discoverMigrationPlan({
      workspace,
      repositoryCommit: "a".repeat(40),
    });
    const pending = migrationPlan.migrations.slice(
      PINNED_PRE_ATTESTATION_SNAPSHOT.migrationSourceCount,
    );
    assert.equal(pending.length, 13);
    for (const migration of pending) {
      await runTool(config.psql, [
        "-X",
        "--set=ON_ERROR_STOP=1",
        "--host",
        config.host,
        "--port",
        config.port,
        "--username",
        "postgres",
        "--dbname",
        database,
        "--file",
        path.join(workspace, migration.file),
      ]);
    }
    await assertCandidateSchemaStage(sql, CANDIDATE_FINAL_SCHEMAS);
    const globalDefaults = await sql.unsafe(`
      select default_acl.defaclobjtype,
             default_acl.defaclacl::text as acl
        from pg_catalog.pg_default_acl as default_acl
        join pg_catalog.pg_roles as owner_role
          on owner_role.oid = default_acl.defaclrole
       where owner_role.rolname = 'programmable_migrator'
         and default_acl.defaclnamespace = 0
       order by default_acl.defaclobjtype
    `);
    assert.deepEqual(globalDefaults.map((row) => ({ ...row })), [
      { defaclobjtype: "T", acl: "{programmable_migrator=U/programmable_migrator}" },
      { defaclobjtype: "f", acl: "{programmable_migrator=X/programmable_migrator}" },
    ]);
    await sql.unsafe(`
      set role programmable_migrator;
      create function programmable_private.default_acl_probe_v1()
      returns integer language sql immutable as 'select 1';
      create type programmable_private.default_acl_probe_type_v1 as enum ('one');
      create table programmable_private.default_acl_probe_table_v1 (
        id bigint generated always as identity primary key
      );
      set role postgres;
    `).simple();
    const [futurePrivileges] = await sql.unsafe(`
      select
        pg_catalog.has_function_privilege(
          'programmable_api_reader',
          (
            select procedure.oid
              from pg_catalog.pg_proc as procedure
              join pg_catalog.pg_namespace as namespace
                on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'programmable_private'
               and procedure.proname = 'default_acl_probe_v1'
          ),
          'EXECUTE'
        ) as function_execute,
        pg_catalog.has_type_privilege(
          'programmable_api_reader',
          (
            select type.oid
              from pg_catalog.pg_type as type
              join pg_catalog.pg_namespace as namespace
                on namespace.oid = type.typnamespace
             where namespace.nspname = 'programmable_private'
               and type.typname = 'default_acl_probe_type_v1'
          ),
          'USAGE'
        ) as type_usage,
        pg_catalog.has_table_privilege(
          'programmable_api_reader',
          (
            select class.oid
              from pg_catalog.pg_class as class
              join pg_catalog.pg_namespace as namespace
                on namespace.oid = class.relnamespace
             where namespace.nspname = 'programmable_private'
               and class.relname = 'default_acl_probe_table_v1'
          ),
          'SELECT'
        ) as table_select,
        pg_catalog.has_sequence_privilege(
          'programmable_api_reader',
          (
            select class.oid
              from pg_catalog.pg_class as class
              join pg_catalog.pg_namespace as namespace
                on namespace.oid = class.relnamespace
             where namespace.nspname = 'programmable_private'
               and class.relname = 'default_acl_probe_table_v1_id_seq'
          ),
          'USAGE'
        ) as sequence_usage
    `);
    assert.deepEqual({ ...futurePrivileges }, {
      function_execute: false,
      type_usage: false,
      table_select: false,
      sequence_usage: false,
    });
    await sql.unsafe(`
      set role programmable_migrator;
      drop table programmable_private.default_acl_probe_table_v1;
      drop type programmable_private.default_acl_probe_type_v1;
      drop function programmable_private.default_acl_probe_v1();
      set role postgres;
    `).simple();
    const forward = await captureDatabaseManifest(sql, {
      schemas: CANDIDATE_FINAL_SCHEMAS,
    });
    assert.equal(
      forward.structuralManifestSha256,
      "0xc015d251ee33b075d49aa7d1a89e755df96ffd4f2748c8c22aad841afe10d2d7",
    );
    await runTool(config.pgDump, [
      "--format=custom",
      "--file",
      safetyArchive,
      "--host",
      config.host,
      "--port",
      config.port,
      "--username",
      config.adminUser,
      "--dbname",
      database,
      ...FINAL_BACKUP_SCHEMAS.flatMap((schema) => ["--schema", schema]),
    ]);
    const safetyBytes = await readFile(safetyArchive);
    const safetySha256 = sha256(safetyBytes);
    const closures = await prepareSafetyRestoreClosures({
      runner: undefined,
      executeSafeTool: (input) => runTool(input.binary, input.args),
      pgRestoreBinary: config.pgRestore,
      archivePath: safetyArchive,
      restrictKey: safetySha256.slice(2),
      environment: Object.freeze({ LANG: "C", LC_ALL: "C" }),
      secrets: [],
    });
    await cleanupCandidateSchemas(
      sql,
      closures.cleanup,
      { supabaseHosted: false },
      { includePinnedBaselineCleanup: false },
    );
    await runTool(config.pgRestore, [
      ...CANDIDATE_SAFETY_RECOVERY_FLAGS,
      "--host",
      config.host,
      "--port",
      config.port,
      "--username",
      "postgres",
      "--dbname",
      database,
      safetyArchive,
    ]);
    await applyOwnerAndSecurityClosure(
      sql,
      closures.owners,
      closures.security,
      { supabaseHosted: false },
      {
        expectedSchemas: CANDIDATE_FINAL_SCHEMAS,
        replaySecurity: false,
      },
    );
    await assertCandidateSchemaStage(sql, CANDIDATE_FINAL_SCHEMAS);
    const recovered = await captureDatabaseManifest(sql, {
      schemas: FINAL_BACKUP_SCHEMAS,
    });
    assert.equal(recovered.manifestSha256, forward.manifestSha256);
    assert.equal(
      recovered.portableStructuralManifestSha256,
      forward.portableStructuralManifestSha256,
    );
    assert.equal(recovered.tableCount, forward.tableCount);
    assert.equal(recovered.rowCount, forward.rowCount);
    const recoveredAgain = await captureDatabaseManifest(sql, {
      schemas: FINAL_BACKUP_SCHEMAS,
    });
    assert.deepEqual(recoveredAgain, recovered);
  },
);
