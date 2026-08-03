import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BACKUP_SCHEMAS,
  FINAL_BACKUP_SCHEMAS,
  ROLE_SPECS,
  canonicalizePostgresAclRows,
  canonicalizePostgresDefinition,
  captureDatabaseManifest,
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
    structuralManifestSha256: `0x${value.repeat(63)}${
      value === "f" ? "e" : "f"
    }`,
    portableStructuralManifestSha256: `0x${"d".repeat(64)}`,
    tableCount: 27,
    rowCount: 265,
  };
}

const STRUCTURAL_QUERY_MATCHERS = Object.freeze([
  ["schemaSecurity", "as schema_owner"],
  ["relationSecurity", "as relation_owner"],
  ["columns", "as ordinal"],
  ["functionDefinitions", "as function_owner"],
  ["views", "as view_kind"],
  ["constraints", "as constraint_kind"],
  ["indexes", "as index_name"],
  ["triggers", "as trigger_name"],
  ["policies", "as policy_name"],
  ["typeGrants", "as type_owner"],
  ["enumDefinitions", "as enum_ordinal"],
  ["domainDefinitions", "as base_type_schema"],
  ["rangeDefinitions", "as multirange_type_schema"],
  ["defaultPrivileges", "default_acl.defaclobjtype"],
]);

function manifestCaptureSql(mutatedCategory, observedQueries = []) {
  return {
    unsafe(query) {
      observedQueries.push(query);
      if (query.includes("set timezone")) return pending([]);
      if (
        query.includes("from pg_catalog.pg_namespace") &&
        query.includes("where nspname = any")
      ) {
        return pending([
          { nspname: "programmable_private" },
          { nspname: "programmable_release_probe_private" },
          { nspname: "supabase_migrations" },
        ]);
      }
      if (query.includes("current_user::text as current_user")) {
        return pending([{ current_user: "postgres", rolsuper: true }]);
      }
      if (query.includes("class.relkind::text as object_kind")) {
        return pending([]);
      }
      if (
        query.includes("as function_kind") &&
        !query.includes("pg_get_functiondef")
      ) {
        return pending([]);
      }
      if (query.includes("as type_kind") && !query.includes("as type_owner")) {
        return pending([]);
      }
      if (query.includes("as sequence_name")) {
        return pending([
          {
            schema_name: "programmable_private",
            sequence_name: "event_id_seq",
            data_type: "bigint",
            start_value: "1",
            increment_by: "1",
            maximum_value: "9223372036854775807",
            minimum_value: "1",
            cache_size: "1",
            cycles: false,
            owned_by_schema: "programmable_private",
            owned_by_relation: "events",
            owned_by_column: "id",
          },
        ]);
      }
      if (query.includes("last_value::text as last_value")) {
        return pending([
          {
            last_value: mutatedCategory === "sequences" ? "43" : "42",
            is_called: true,
          },
        ]);
      }
      const match = STRUCTURAL_QUERY_MATCHERS.find(([, marker]) =>
        query.includes(marker),
      );
      if (match) {
        const [category] = match;
        return pending([
          {
            category,
            definition:
              mutatedCategory === category ? "mutated" : "baseline",
          },
        ]);
      }
      throw new Error(`unexpected manifest query: ${query}`);
    },
  };
}

test("captureDatabaseManifest preserves the legacy hash and binds structural catalog state", async () => {
  const observedQueries = [];
  const baseline = await captureDatabaseManifest(
    manifestCaptureSql(undefined, observedQueries),
  );
  assert.equal(
    baseline.manifestSha256,
    "0x3561c613752680fd9a2faddb412267139e7c9d8d0f1995ed1b243e920c3b508a",
  );
  assert.match(baseline.structuralManifestSha256, /^0x[0-9a-f]{64}$/u);
  assert.match(
    baseline.portableStructuralManifestSha256,
    /^0x[0-9a-f]{64}$/u,
  );
  assert.equal(baseline.tableCount, 0);
  assert.equal(baseline.rowCount, 0);

  for (const category of [
    ...STRUCTURAL_QUERY_MATCHERS.map(([name]) => name),
    "sequences",
  ]) {
    const changed = await captureDatabaseManifest(
      manifestCaptureSql(category),
    );
    assert.equal(changed.manifestSha256, baseline.manifestSha256, category);
    assert.notEqual(
      changed.structuralManifestSha256,
      baseline.structuralManifestSha256,
      category,
    );
  }

  const catalogSql = observedQueries.join("\n");
  for (const requiredFragment of [
    "pg_get_functiondef",
    "pg_get_viewdef",
    "pg_get_constraintdef",
    "pg_get_indexdef",
    "pg_get_triggerdef",
    "relrowsecurity",
    "pg_policy",
    "nspacl",
    "relacl",
    "acldefault",
    "class.relkind in ('r', 'p', 'v', 'm', 'f')",
    "class.relkind = 'S'",
    "attacl",
    "proacl",
    "typacl",
    "pg_enum",
    "enumsortorder",
    "row_number() over",
    "typbasetype",
    "typtypmod",
    "typdefaultbin",
    "typnotnull",
    "pg_range",
    "rngsubtype",
    "rngsubopc",
    "rngcollation",
    "rngcanonical",
    "rngsubdiff",
    "rngmultitypid",
    "pg_default_acl",
    "pg_sequence",
    "last_value::text",
  ]) {
    assert.equal(catalogSql.includes(requiredFragment), true, requiredFragment);
  }
});

test("portable Postgres definitions flatten only redundant same-boolean grouping", () => {
  const hosted =
    "CHECK ((((octet_length(value) >= 1) AND (octet_length(value) <= 192)) AND (value ~ '^[A-Z()]$'::text)))";
  const isolated =
    "CHECK (((octet_length(value) >= 1) AND (octet_length(value) <= 192) AND (value ~ '^[A-Z()]$'::text)))";
  assert.equal(
    canonicalizePostgresDefinition(hosted),
    canonicalizePostgresDefinition(isolated),
  );
  assert.equal(
    canonicalizePostgresDefinition(
      "SELECT 1 HAVING (((count(*) >= 1) AND (count(*) <= 5)))",
    ),
    canonicalizePostgresDefinition(
      "SELECT 1 HAVING ((count(*) >= 1) AND (count(*) <= 5))",
    ),
  );
  assert.equal(
    canonicalizePostgresDefinition(
      "SELECT * FROM a JOIN b ON ((((a.id = b.id) AND (a.kind = b.kind))))",
    ),
    canonicalizePostgresDefinition(
      "SELECT * FROM a JOIN b ON ((a.id = b.id) AND (a.kind = b.kind))",
    ),
  );
  assert.equal(
    canonicalizePostgresDefinition(
      "CHECK ((((label = 'x AND (y)') AND (body = $tag$(AND)$tag$))))",
    ),
    canonicalizePostgresDefinition(
      "CHECK ((label = 'x AND (y)') AND (body = $tag$(AND)$tag$))",
    ),
  );
  assert.notEqual(
    canonicalizePostgresDefinition("CHECK (((a OR b) AND c))"),
    canonicalizePostgresDefinition("CHECK ((a OR (b AND c)))"),
  );
  assert.notEqual(
    canonicalizePostgresDefinition("CHECK ((a BETWEEN b AND c) AND d)"),
    canonicalizePostgresDefinition("CHECK (a BETWEEN b AND (c AND d))"),
  );
  assert.notEqual(
    canonicalizePostgresDefinition("CHECK (a AND b)"),
    canonicalizePostgresDefinition("CHECK (a OR b)"),
  );
  for (const [left, right] of [
    ["CHECK (a = 1)", "CHECK (b = 1)"],
    ["CHECK (a = 1)", "CHECK (a = 2)"],
    ["CHECK (a::text = '1')", "CHECK (a::integer = 1)"],
    ["CHECK (a >= 1)", "CHECK (a > 1)"],
    [
      "CHECK ((CASE WHEN a THEN b ELSE c END) AND d)",
      "CHECK ((CASE WHEN a THEN b ELSE e END) AND d)",
    ],
  ]) {
    assert.notEqual(
      canonicalizePostgresDefinition(left),
      canonicalizePostgresDefinition(right),
    );
  }
  for (const invalid of [
    "CHECK ((a AND b)",
    "CHECK (a AND b))",
    "CHECK (a = 'unterminated)",
    "CHECK (a = $tag$unterminated)",
  ]) {
    assert.throws(() => canonicalizePostgresDefinition(invalid));
  }
});

test("portable Postgres ACLs collapse only database-proven default-equivalent grants", () => {
  const implicitDefault = [
    {
      schema_name: "programmable_private",
      schema_owner: "programmable_migrator",
      grants_are_default: true,
      grants_match_default: true,
      grant_text: null,
    },
  ];
  const explicitDefault = [
    {
      schema_name: "programmable_private",
      schema_owner: "programmable_migrator",
      grants_are_default: false,
      grants_match_default: true,
      grant_text: "programmable_migrator=UC/programmable_migrator",
    },
  ];
  assert.deepEqual(
    canonicalizePostgresAclRows(explicitDefault),
    canonicalizePostgresAclRows(implicitDefault),
  );
  assert.equal(
    canonicalizePostgresAclRows([...explicitDefault, ...explicitDefault]).length,
    1,
  );

  for (const drift of [
    {
      grant_text: "programmable_api_reader=U/programmable_migrator",
    },
    {
      grant_text: "programmable_api_reader=U*/programmable_migrator",
    },
    {
      grant_text: "programmable_migrator=UC/postgres",
    },
    {
      schema_owner: "postgres",
      grant_text: "postgres=UC/postgres",
    },
    { grant_text: null },
  ]) {
    assert.notDeepEqual(
      canonicalizePostgresAclRows([
        {
          ...explicitDefault[0],
          ...drift,
          grants_match_default: false,
        },
      ]),
      canonicalizePostgresAclRows(implicitDefault),
    );
  }
});

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
  assert.equal(
    result.evidence.sourceStructuralManifestSha256,
    manifest().structuralManifestSha256,
  );
  assert.equal(
    result.evidence.restoredStructuralManifestSha256,
    manifest().structuralManifestSha256,
  );
  assert.equal(result.evidence.tableCount, 27);
  assert.equal(result.evidence.rowCount, 265);
  assert.equal(result.evidence.backup.format, "pg-custom-v1");
  assert.deepEqual(result.evidence.schemas, BACKUP_SCHEMAS);
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
  assert.equal(dump.args.includes("--no-owner"), false);
  assert.equal(dump.args.includes("--no-privileges"), false);
  const restore = harness.calls.find(
    ({ binary, args }) => binary === "pg_restore" && args.includes("--single-transaction"),
  );
  assert.ok(restore);
  assert.equal(restore.args.includes("--exit-on-error"), true);
  assert.equal(restore.args.includes("--no-owner"), false);
  assert.equal(restore.args.includes("--no-privileges"), false);
  const psql = harness.calls.find(({ binary }) => binary === "psql");
  assert.ok(psql);
  assert.ok(harness.calls.indexOf(psql) < harness.calls.indexOf(restore));
  const roleSql = psql.args.at(-1);
  for (const { loginRole, capabilityRole } of ROLE_SPECS) {
    assert.match(roleSql, new RegExp(loginRole, "u"));
    assert.match(roleSql, new RegExp(capabilityRole, "u"));
  }
  assert.match(
    roleSql,
    /alter default privileges for role programmable_migrator\s+revoke execute on functions from public/iu,
  );
  assert.match(
    roleSql,
    /alter default privileges for role programmable_migrator\s+grant execute on functions to programmable_migrator/iu,
  );
  assert.match(
    roleSql,
    /alter default privileges for role programmable_migrator\s+revoke usage on types from public/iu,
  );
  assert.match(
    roleSql,
    /alter default privileges for role programmable_migrator\s+grant usage on types to programmable_migrator/iu,
  );
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

test("createBackupAndRestoreEvidence binds and restores the final schema stage", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const observedSchemas = [];
  const harness = backupDependencies(fixture, {
    captureDatabaseManifest: async (_sql, options) => {
      observedSchemas.push(options.schemas);
      return manifest();
    },
  });
  const result = await createBackupAndRestoreEvidence({
    ...fixture.input,
    schemas: FINAL_BACKUP_SCHEMAS,
    dependencies: harness.dependencies,
  });
  assert.deepEqual(result.evidence.schemas, FINAL_BACKUP_SCHEMAS);
  assert.deepEqual(observedSchemas, [
    FINAL_BACKUP_SCHEMAS,
    FINAL_BACKUP_SCHEMAS,
    FINAL_BACKUP_SCHEMAS,
  ]);
  const dump = harness.calls.find(
    ({ binary, args }) => binary === "pg_dump" && !args.includes("--version"),
  );
  assert.ok(dump);
  assert.deepEqual(
    dump.args.flatMap((value, index) =>
      value === "--schema" ? [dump.args[index + 1]] : []
    ),
    FINAL_BACKUP_SCHEMAS,
  );
});

test("createBackupAndRestoreEvidence rejects an unreviewed schema stage", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  await assert.rejects(
    createBackupAndRestoreEvidence({
      ...fixture.input,
      schemas: ["programmable_private"],
    }),
    /backup schema stage is invalid/u,
  );
});

test("createBackupAndRestoreEvidence accepts only portable-equivalent cross-build structure", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const source = {
    ...manifest(),
    structuralManifestSha256: `0x${"a".repeat(64)}`,
    portableStructuralManifestSha256: `0x${"b".repeat(64)}`,
  };
  const restored = {
    ...source,
    structuralManifestSha256: `0x${"c".repeat(64)}`,
  };
  let captures = 0;
  const harness = backupDependencies(fixture, {
    captureDatabaseManifest: async () => {
      captures += 1;
      return captures < 3 ? source : restored;
    },
  });
  const result = await createBackupAndRestoreEvidence({
    ...fixture.input,
    dependencies: harness.dependencies,
  });
  assert.equal(
    result.evidence.sourceStructuralManifestSha256,
    source.structuralManifestSha256,
  );
  assert.equal(
    result.evidence.restoredStructuralManifestSha256,
    restored.structuralManifestSha256,
  );
  assert.equal(
    result.evidence.sourcePortableStructuralManifestSha256,
    source.portableStructuralManifestSha256,
  );
  assert.equal(
    result.evidence.restoredPortableStructuralManifestSha256,
    source.portableStructuralManifestSha256,
  );
});

test("createBackupAndRestoreEvidence records an exact empty target-schema baseline", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const emptyManifest = {
    manifestSha256: `0x${"e".repeat(64)}`,
    structuralManifestSha256: `0x${"f".repeat(64)}`,
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
  delete stored.sourceStructuralManifestSha256;
  delete stored.restoredStructuralManifestSha256;
  await writeFile(fixture.input.evidencePath, `${JSON.stringify(stored)}\n`, {
    mode: 0o600,
  });
  const legacy = await createBackupAndRestoreEvidence({
    ...fixture.input,
    dependencies: {
      openHostedDatabase: async () => {
        throw new Error("must not connect");
      },
    },
  });
  assert.equal(legacy.status, "current");
  assert.equal(
    Object.hasOwn(legacy.evidence, "sourceStructuralManifestSha256"),
    false,
  );

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

test("createBackupAndRestoreEvidence fails closed on structural-only drift", async (t) => {
  const fixture = await backupFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  let captureCount = 0;
  const harness = backupDependencies(fixture, {
    captureDatabaseManifest: async () => {
      captureCount += 1;
      return {
        ...manifest("c"),
        structuralManifestSha256:
          captureCount === 1 ? `0x${"a".repeat(64)}` : `0x${"b".repeat(64)}`,
      };
    },
  });
  await assert.rejects(
    createBackupAndRestoreEvidence({
      ...fixture.input,
      dependencies: harness.dependencies,
    }),
    /database backup and isolated restore failed/u,
  );
  assert.equal(
    harness.calls.some(({ binary }) => binary === "psql"),
    false,
  );
  await assert.rejects(lstat(fixture.input.backupPath), { code: "ENOENT" });
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
