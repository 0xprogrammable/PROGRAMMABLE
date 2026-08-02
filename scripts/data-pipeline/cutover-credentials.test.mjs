import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ROLE_SPECS,
  createBackupAndRestoreEvidence,
  provisionLoginRoles,
  verifyPoolerLogins,
} from "./cutover-credentials.mjs";

const PROJECT_REF = "mnnvlrqwhfoppogslsje";
const COMMIT = "a".repeat(40);
const SOURCE_PASSWORD = "Source_password_0123456789_ABCDEFGHIJK";
const RESTORE_PASSWORD = "Restore_password_0123456789_ABCDEFGHIJ";
const CA = `-----BEGIN CERTIFICATE-----\n${"A".repeat(96)}\n-----END CERTIFICATE-----`;
const RESTORE_CA = `-----BEGIN CERTIFICATE-----\n${"B".repeat(96)}\n-----END CERTIFICATE-----`;

function credentials(prefix = "credential") {
  return Object.fromEntries(
    ROLE_SPECS.map(({ key }, index) => [
      key,
      `${prefix}_${String(index).padStart(2, "0")}_${"X".repeat(34)}`,
    ]),
  );
}

function rolePosture(requirePasswords = true) {
  const rows = ROLE_SPECS.flatMap(({ loginRole, capabilityRole }) => [
    {
      rolname: loginRole,
      rolcanlogin: true,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconnlimit: -1,
      rolconfig: null,
      has_password: requirePasswords,
    },
    {
      rolname: capabilityRole,
      rolcanlogin: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconnlimit: -1,
      rolconfig: null,
      has_password: false,
    },
  ]);
  const memberships = ROLE_SPECS.map(({ loginRole, capabilityRole }) => ({
    member_role: loginRole,
    granted_role: capabilityRole,
    admin_option: false,
    inherit_option: false,
    set_option: true,
  }));
  return { rows, memberships, requirePasswords };
}

function pending(value, simpleEffect) {
  const promise = Promise.resolve(value);
  promise.simple = async () => {
    if (simpleEffect) simpleEffect();
    return value;
  };
  return promise;
}

function directProvisioningSql(secretObservations) {
  let rotationCount = 0;
  const sql = {
    unsafe(query) {
      if (query.includes("current_user::text")) {
        return pending([
          {
            session_user: "postgres",
            current_user: "postgres",
            current_role: "postgres",
            database_name: "postgres",
            server_port: 5432,
          },
        ]);
      }
      if (query.includes("pg_catalog.pg_authid")) {
        return pending(rolePosture(rotationCount === ROLE_SPECS.length).rows);
      }
      if (query.includes("from pg_catalog.pg_auth_members")) {
        return pending(rolePosture().memberships);
      }
      throw new Error("unexpected direct SQL");
    },
    async begin(callback) {
      const transaction = async (strings, ...values) => {
        assert.match(strings.join(""), /set_config/u);
        assert.equal(values.length, 1);
        secretObservations.push(values[0]);
        return [];
      };
      transaction.unsafe = (query) => {
        if (query.includes("select session_user::text")) {
          return pending([{ session_user: "postgres", current_role: "postgres" }]);
        }
        assert.match(query, /do \$credential_rotation\$/u);
        for (const secret of secretObservations) {
          assert.equal(query.includes(secret), false);
        }
        return pending([], () => {
          rotationCount += 1;
        });
      };
      return callback(transaction);
    },
  };
  return sql;
}

test("ROLE_SPECS is the exact immutable five-role contract", () => {
  assert.equal(Object.isFrozen(ROLE_SPECS), true);
  assert.deepEqual(
    ROLE_SPECS.map(({ key, loginRole, capabilityRole }) => ({
      key,
      loginRole,
      capabilityRole,
    })),
    [
      {
        key: "apiReader",
        loginRole: "programmable_api_reader_login",
        capabilityRole: "programmable_api_reader",
      },
      {
        key: "projector",
        loginRole: "programmable_projector_login",
        capabilityRole: "programmable_projector",
      },
      {
        key: "projectorRuntime",
        loginRole: "programmable_projector_runtime_login",
        capabilityRole: "programmable_projector_runtime",
      },
      {
        key: "reconciler",
        loginRole: "programmable_reconciler_login",
        capabilityRole: "programmable_reconciler",
      },
      {
        key: "releaseProbe",
        loginRole: "programmable_release_probe_nonce_login",
        capabilityRole: "programmable_release_probe_nonce",
      },
    ],
  );
  assert.equal(ROLE_SPECS.every(Object.isFrozen), true);
});

test("provisionLoginRoles sends every password only as a bound value", async () => {
  const values = credentials();
  const observedSecrets = [];
  const sql = directProvisioningSql(observedSecrets);
  let closed = 0;
  const result = await provisionLoginRoles({
    databaseUrl: `postgresql://postgres:${SOURCE_PASSWORD}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full`,
    expectedProjectRef: PROJECT_REF,
    sslCaPem: CA,
    credentials: values,
    dependencies: {
      openHostedDatabase: async () => ({
        sql,
        target: {
          projectRef: PROJECT_REF,
          host: `db.${PROJECT_REF}.supabase.co`,
          port: 5432,
          database: "postgres",
          sslMode: "verify-full",
        },
      }),
      closeHostedDatabase: async () => {
        closed += 1;
      },
    },
  });
  assert.deepEqual(observedSecrets, ROLE_SPECS.map(({ key }) => values[key]));
  assert.equal(closed, 1);
  assert.equal(result.roles.length, 5);
  const serialized = JSON.stringify(result);
  for (const password of Object.values(values)) {
    assert.equal(serialized.includes(password), false);
  }
});

test("provisionLoginRoles rejects missing, extra, duplicate and weak credentials", async () => {
  const base = {
    databaseUrl: `postgresql://postgres:${SOURCE_PASSWORD}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full`,
    expectedProjectRef: PROJECT_REF,
    sslCaPem: CA,
    dependencies: {
      openHostedDatabase: async () => {
        throw new Error("must not open");
      },
    },
  };
  const missing = credentials();
  delete missing.releaseProbe;
  await assert.rejects(
    provisionLoginRoles({ ...base, credentials: missing }),
    /exactly five/u,
  );
  await assert.rejects(
    provisionLoginRoles({ ...base, credentials: { ...credentials(), extra: "X".repeat(40) } }),
    /exactly five/u,
  );
  const duplicate = credentials();
  duplicate.projector = duplicate.apiReader;
  await assert.rejects(
    provisionLoginRoles({ ...base, credentials: duplicate }),
    /must be unique/u,
  );
  await assert.rejects(
    provisionLoginRoles({
      ...base,
      credentials: { ...credentials(), apiReader: "short" },
    }),
    /not a valid generated password/u,
  );
});

test("provisionLoginRoles fails closed on excess membership and redacts dependency errors", async () => {
  const values = credentials("private");
  const posture = rolePosture(false);
  posture.memberships.push({
    member_role: ROLE_SPECS[0].loginRole,
    granted_role: "pg_read_all_data",
    admin_option: false,
    inherit_option: false,
    set_option: true,
  });
  let closed = false;
  await assert.rejects(
    provisionLoginRoles({
      databaseUrl: `postgresql://postgres:${SOURCE_PASSWORD}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full`,
      expectedProjectRef: PROJECT_REF,
      sslCaPem: CA,
      credentials: values,
      dependencies: {
        openHostedDatabase: async () => ({ sql: {}, target: {} }),
        closeHostedDatabase: async () => {
          closed = true;
        },
        assertDirectOperatorIdentity: async () => {},
        readRolePosture: async () => posture,
        rotateLoginPassword: async () => {
          throw new Error(values.apiReader);
        },
      },
    }),
    (error) => {
      assert.equal(error.message, "login-role provisioning failed");
      assert.equal(error.message.includes(values.apiReader), false);
      return true;
    },
  );
  assert.equal(closed, true);
});

function poolerSql(spec, setRoleStatements) {
  let activeRole = spec.loginRole;
  return {
    unsafe(query) {
      if (query.includes("from pg_catalog.pg_roles")) {
        return pending(rolePosture().rows);
      }
      if (query.includes("from pg_catalog.pg_auth_members")) {
        return pending(rolePosture().memberships);
      }
      throw new Error("unexpected pooler posture SQL");
    },
    async begin(callback) {
      const transaction = {
        unsafe(query) {
          if (query.trim().startsWith("set local role")) {
            return pending([], () => {
              setRoleStatements.push(query.trim());
              activeRole = spec.capabilityRole;
            });
          }
          if (query.includes("configured_role")) {
            return pending([
              {
                session_user: spec.loginRole,
                current_role: activeRole,
                configured_role: activeRole,
                database_name: "postgres",
              },
            ]);
          }
          return pending([
            {
              session_user: spec.loginRole,
              current_role: activeRole,
              database_name: "postgres",
            },
          ]);
        },
      };
      return callback(transaction);
    },
  };
}

test("verifyPoolerLogins checks all five transaction-pooler identities with SET LOCAL ROLE", async () => {
  const values = credentials("pooler");
  const opens = [];
  const closes = [];
  const setRoleStatements = [];
  const result = await verifyPoolerLogins({
    expectedProjectRef: PROJECT_REF,
    poolerHost: "aws-0-eu-central-1.pooler.supabase.com",
    sslCaPem: CA,
    credentials: values,
    dependencies: {
      openPoolerDatabase: async (entry) => {
        opens.push(entry);
        return { sql: poolerSql(entry.spec, setRoleStatements) };
      },
      closePoolerDatabase: async (sql) => {
        closes.push(sql);
      },
    },
  });
  assert.equal(opens.length, 5);
  assert.equal(closes.length, 5);
  assert.equal(opens.every(({ options }) => options.prepare === false), true);
  assert.deepEqual(
    setRoleStatements,
    ROLE_SPECS.map(({ capabilityRole }) => `set local role ${capabilityRole}`),
  );
  assert.equal(result.target.port, 6543);
  assert.equal(result.target.sslMode, "verify-full");
  assert.equal(result.target.prepare, false);
  assert.equal(result.roles.length, 5);
  const serialized = JSON.stringify(result);
  for (const password of Object.values(values)) {
    assert.equal(serialized.includes(password), false);
  }
});

test("verifyPoolerLogins rejects an unreviewed host and an identity mismatch", async () => {
  await assert.rejects(
    verifyPoolerLogins({
      expectedProjectRef: PROJECT_REF,
      poolerHost: "attacker.example",
      sslCaPem: CA,
      credentials: credentials(),
    }),
    /pooler host is invalid/u,
  );
  const secret = credentials("identity_secret");
  await assert.rejects(
    verifyPoolerLogins({
      expectedProjectRef: PROJECT_REF,
      poolerHost: "aws-0-eu-central-1.pooler.supabase.com",
      sslCaPem: CA,
      credentials: secret,
      dependencies: {
        openPoolerDatabase: async () => ({ sql: {} }),
        closePoolerDatabase: async () => {},
        readPoolerRolePosture: async () => rolePosture(),
        verifyPoolerSession: async () => {
          throw new Error(`wrong identity ${secret.apiReader}`);
        },
      },
    }),
    (error) => {
      assert.equal(error.message, "pooler login verification failed");
      assert.equal(error.message.includes(secret.apiReader), false);
      return true;
    },
  );
});

async function backupFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cutover-credentials-test-"));
  const backupPath = path.join(directory, "read-model.dump");
  const evidencePath = path.join(directory, "read-model.evidence.json");
  const sourceDatabaseUrl = `postgresql://postgres:${encodeURIComponent(
    SOURCE_PASSWORD,
  )}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full`;
  const restoreDatabaseUrl = `postgresql://postgres:${encodeURIComponent(
    RESTORE_PASSWORD,
  )}@127.0.0.1:55432/programmable_restore_cutover01?sslmode=verify-full`;
  return {
    directory,
    input: {
      operationId: "production-cutover-01",
      repositoryCommit: COMMIT,
      sourceDatabaseUrl,
      expectedProjectRef: PROJECT_REF,
      sslCaPem: CA,
      restoreDatabaseUrl,
      restoreIsolationId: "cutover01",
      restoreSslCaPem: RESTORE_CA,
      backupPath,
      evidencePath,
    },
  };
}

function manifest(value = "c") {
  return {
    manifestSha256: `0x${value.repeat(64)}`,
    tableCount: 27,
    rowCount: 265,
  };
}

function backupDependencies(fixture, overrides = {}) {
  const calls = [];
  const caPaths = new Set();
  let closeCount = 0;
  const dependencies = {
    openHostedDatabase: async ({ databaseUrl, expectedProjectRef, sslCaPem }) => {
      assert.equal(databaseUrl, fixture.input.sourceDatabaseUrl);
      assert.equal(expectedProjectRef, PROJECT_REF);
      assert.equal(sslCaPem, CA);
      return {
        sql: { side: "source" },
        target: {
          projectRef: PROJECT_REF,
          host: `db.${PROJECT_REF}.supabase.co`,
          port: 5432,
          database: "postgres",
          sslMode: "verify-full",
        },
      };
    },
    openRestoreDatabase: async ({ databaseUrl, sslCaPem, safeTarget }) => {
      assert.equal(databaseUrl, fixture.input.restoreDatabaseUrl);
      assert.equal(sslCaPem, RESTORE_CA);
      assert.equal(safeTarget.database, "programmable_restore_cutover01");
      return { sql: { side: "restore" } };
    },
    closeHostedDatabase: async () => {
      closeCount += 1;
    },
    assertRestoreTargetIsEmpty: async (sql, target) => {
      assert.equal(sql.side, "restore");
      assert.equal(target.host, "127.0.0.1");
    },
    captureDatabaseManifest: async () => manifest(),
    now: () => new Date("2026-08-01T08:00:00.000Z"),
    runCommand: async (binary, args, options) => {
      calls.push({ binary, args, options });
      for (const secret of [
        SOURCE_PASSWORD,
        RESTORE_PASSWORD,
        fixture.input.sourceDatabaseUrl,
        fixture.input.restoreDatabaseUrl,
        CA,
        RESTORE_CA,
      ]) {
        assert.equal(args.join("\n").includes(secret), false);
      }
      assert.equal(options.env.PGSSLMODE, "verify-full");
      assert.equal(options.env.PGCONNECT_TIMEOUT, "8");
      assert.equal(
        Object.keys(options.env).every((key) =>
          [
            "LANG",
            "LC_ALL",
            "PATH",
            "PGAPPNAME",
            "PGCONNECT_TIMEOUT",
            "PGPASSWORD",
            "PGSSLMODE",
            "PGSSLROOTCERT",
            "SYSTEMROOT",
          ].includes(key),
        ),
        true,
      );
      caPaths.add(options.env.PGSSLROOTCERT);
      const caMetadata = await lstat(options.env.PGSSLROOTCERT);
      assert.equal(caMetadata.mode & 0o777, 0o600);
      const ca = await readFile(options.env.PGSSLROOTCERT, "utf8");
      assert.equal([CA, RESTORE_CA].includes(ca), true);
      if (args.includes("--version")) {
        return { stdout: Buffer.from("pg_dump (PostgreSQL) 17.6\n"), stderr: Buffer.alloc(0) };
      }
      if (binary === "pg_dump") {
        const fileIndex = args.indexOf("--file");
        assert.notEqual(fileIndex, -1);
        await writeFile(args[fileIndex + 1], Buffer.from("valid-custom-archive"));
      }
      if (binary === "pg_restore" && args[0] === "--list") {
        return { stdout: Buffer.from("; Archive created at 2026-08-01\nTABLE DATA\n"), stderr: Buffer.alloc(0) };
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    },
    ...overrides,
  };
  return {
    dependencies,
    calls,
    caPaths,
    get closeCount() {
      return closeCount;
    },
  };
}

test("createBackupAndRestoreEvidence keeps secrets in child env and proves an isolated restore", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const harness = backupDependencies(fixture);
  const result = await createBackupAndRestoreEvidence({
    ...fixture.input,
    dependencies: harness.dependencies,
  });
  assert.equal(result.status, "created");
  assert.equal(result.changed, true);
  assert.equal(result.evidence.source.port, 5432);
  assert.equal(result.evidence.restore.database, "programmable_restore_cutover01");
  assert.equal(result.evidence.sourceManifestSha256, manifest().manifestSha256);
  assert.equal(result.evidence.restoredManifestSha256, manifest().manifestSha256);
  assert.equal(result.evidence.tableCount, 27);
  assert.equal(result.evidence.rowCount, 265);
  assert.equal(result.evidence.backup.format, "pg-custom-v1");
  assert.equal(result.evidence.postgresVersion, "PostgreSQL 17.6");
  assert.equal(harness.closeCount, 2);
  const dump = harness.calls.find(
    ({ binary, args }) => binary === "pg_dump" && !args.includes("--version"),
  );
  assert.ok(dump);
  assert.deepEqual(
    dump.args.filter((value) => value === "--schema").length,
    3,
  );
  assert.equal(dump.args.includes("--serializable-deferrable"), true);
  assert.equal(dump.args.includes("--no-owner"), true);
  assert.equal(dump.args.includes("--no-privileges"), true);
  const restore = harness.calls.find(
    ({ binary, args }) => binary === "pg_restore" && args.includes("--single-transaction"),
  );
  assert.ok(restore);
  assert.equal(restore.args.includes("--exit-on-error"), true);
  const psql = harness.calls.find(({ binary }) => binary === "psql");
  assert.ok(psql);
  const roleSql = psql.args.at(-1);
  for (const { loginRole, capabilityRole } of ROLE_SPECS) {
    assert.match(roleSql, new RegExp(loginRole, "u"));
    assert.match(roleSql, new RegExp(capabilityRole, "u"));
  }
  const [backupMode, evidenceMode] = await Promise.all([
    lstat(fixture.input.backupPath),
    lstat(fixture.input.evidencePath),
  ]);
  assert.equal(backupMode.mode & 0o777, 0o600);
  assert.equal(evidenceMode.mode & 0o777, 0o600);
  const serialized = JSON.stringify(result);
  for (const secret of [SOURCE_PASSWORD, RESTORE_PASSWORD, CA, RESTORE_CA]) {
    assert.equal(serialized.includes(secret), false);
  }
  for (const caPath of harness.caPaths) {
    await assert.rejects(lstat(caPath), { code: "ENOENT" });
  }
});

test("createBackupAndRestoreEvidence records an exact empty target-schema baseline", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const emptyManifest = {
    manifestSha256: `0x${"e".repeat(64)}`,
    tableCount: 0,
    rowCount: 0,
  };
  const harness = backupDependencies(fixture, {
    captureDatabaseManifest: async () => emptyManifest,
  });
  const result = await createBackupAndRestoreEvidence({
    ...fixture.input,
    dependencies: harness.dependencies,
  });

  assert.equal(result.status, "created");
  assert.equal(result.evidence.tableCount, 0);
  assert.equal(result.evidence.rowCount, 0);
  assert.equal(result.evidence.backup.format, "empty-target-schemas-v1");
  assert.equal(
    harness.calls.some(
      ({ binary, args }) => binary === "pg_dump" && !args.includes("--version"),
    ),
    false,
  );
  assert.equal(
    harness.calls.some(({ binary }) => binary === "pg_restore" || binary === "psql"),
    false,
  );
});

test("createBackupAndRestoreEvidence is idempotent only for matching private evidence", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const firstHarness = backupDependencies(fixture);
  const first = await createBackupAndRestoreEvidence({
    ...fixture.input,
    dependencies: firstHarness.dependencies,
  });
  let externalCalls = 0;
  const second = await createBackupAndRestoreEvidence({
    ...fixture.input,
    dependencies: {
      runCommand: async () => {
        externalCalls += 1;
        throw new Error("must not execute");
      },
      openHostedDatabase: async () => {
        externalCalls += 1;
        throw new Error("must not connect");
      },
      openRestoreDatabase: async () => {
        externalCalls += 1;
        throw new Error("must not connect");
      },
    },
  });
  assert.equal(externalCalls, 0);
  assert.equal(second.status, "current");
  assert.equal(second.changed, false);
  assert.deepEqual(second.evidence, first.evidence);

  const stored = JSON.parse(await readFile(fixture.input.evidencePath, "utf8"));
  stored.repositoryCommit = "b".repeat(40);
  await writeFile(fixture.input.evidencePath, `${JSON.stringify(stored)}\n`, {
    mode: 0o600,
  });
  await assert.rejects(
    createBackupAndRestoreEvidence({
      ...fixture.input,
      dependencies: {
        runCommand: async () => {
          throw new Error("must not execute");
        },
      },
    }),
    /database backup and isolated restore failed/u,
  );
  assert.equal((await lstat(fixture.input.backupPath)).isFile(), true);
});

test("createBackupAndRestoreEvidence rejects non-direct source and non-isolated restore targets", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  await assert.rejects(
    createBackupAndRestoreEvidence({
      ...fixture.input,
      sourceDatabaseUrl: `postgresql://postgres:${SOURCE_PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
    }),
    /direct Supabase endpoint/u,
  );
  await assert.rejects(
    createBackupAndRestoreEvidence({
      ...fixture.input,
      restoreDatabaseUrl: `postgresql://postgres:${RESTORE_PASSWORD}@db.other.supabase.co:5432/postgres?sslmode=verify-full`,
    }),
    /isolated loopback/u,
  );
});

test("createBackupAndRestoreEvidence removes partial backup and redacts tool failures", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const harness = backupDependencies(fixture, {
    runCommand: async (binary, args) => {
      if (args.includes("--version")) {
        return { stdout: Buffer.from("pg_dump (PostgreSQL) 17.6\n") };
      }
      if (binary === "pg_dump") {
        const fileIndex = args.indexOf("--file");
        await writeFile(args[fileIndex + 1], "partial");
        const error = new Error(`failure ${SOURCE_PASSWORD}`);
        error.code = "EFAIL";
        throw error;
      }
      return { stdout: Buffer.alloc(0) };
    },
  });
  await assert.rejects(
    createBackupAndRestoreEvidence({
      ...fixture.input,
      dependencies: harness.dependencies,
    }),
    (error) => {
      assert.equal(
        error.message,
        "database backup and isolated restore failed",
      );
      assert.equal(error.message.includes(SOURCE_PASSWORD), false);
      return true;
    },
  );
  await assert.rejects(lstat(fixture.input.backupPath), { code: "ENOENT" });
  await assert.rejects(lstat(fixture.input.evidencePath), { code: "ENOENT" });
  assert.equal(harness.closeCount, 2);
});

test("createBackupAndRestoreEvidence fails closed on source drift or restore mismatch", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  let captureCount = 0;
  const harness = backupDependencies(fixture, {
    captureDatabaseManifest: async () => {
      captureCount += 1;
      return captureCount === 1 ? manifest("c") : manifest("d");
    },
  });
  await assert.rejects(
    createBackupAndRestoreEvidence({
      ...fixture.input,
      dependencies: harness.dependencies,
    }),
    /database backup and isolated restore failed/u,
  );
  await assert.rejects(lstat(fixture.input.backupPath), { code: "ENOENT" });
  assert.equal(
    harness.calls.some(({ binary }) => binary === "psql"),
    false,
  );
});

test("createBackupAndRestoreEvidence requires Postgres 17 tools and a clean target", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const oldTools = backupDependencies(fixture, {
    runCommand: async (_binary, args) => {
      if (args.includes("--version")) {
        return { stdout: Buffer.from("pg_dump (PostgreSQL) 16.9\n") };
      }
      return { stdout: Buffer.alloc(0) };
    },
  });
  await assert.rejects(
    createBackupAndRestoreEvidence({
      ...fixture.input,
      dependencies: oldTools.dependencies,
    }),
    /database backup and isolated restore failed/u,
  );
  await assert.rejects(lstat(fixture.input.backupPath), { code: "ENOENT" });

  const second = await backupFixture();
  t.after(() => rm(second.directory, { recursive: true, force: true }));
  let ran = false;
  const dirty = backupDependencies(second, {
    assertRestoreTargetIsEmpty: async () => {
      throw new Error("target contains data");
    },
    runCommand: async () => {
      ran = true;
      return { stdout: Buffer.alloc(0) };
    },
  });
  await assert.rejects(
    createBackupAndRestoreEvidence({
      ...second.input,
      dependencies: dirty.dependencies,
    }),
    /database backup and isolated restore failed/u,
  );
  assert.equal(ran, false);
});
