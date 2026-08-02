import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertNoSecretOutput,
  buildBootstrapPlan,
  compareMigrationHistory,
  discoverMigrationPlan,
  safeFailure,
  validateDirectSupabaseTarget,
  validateMigrationPlan,
} from "./hosted-db-operator-core.mjs";
import {
  applyPendingMigrations,
  closeHostedDatabase,
  openHostedDatabase,
} from "./hosted-db-postgres.mjs";

const COMMIT = "a".repeat(40);
const HASH = `0x${"1".repeat(64)}`;

async function fixture(files) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "db-operator-test-"));
  const root = path.join(workspace, "supabase", "migrations");
  await mkdir(root, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(root, name), contents);
  }
  return { workspace, root };
}

test("migration discovery includes every ordered current and later file", async (t) => {
  const { workspace } = await fixture({
    "20260731000200_second.sql": "select 2;\n",
    "20260731000100_first.sql": "select 1;\n",
    "20270101000000_later.sql": "select 3;\n",
  });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverMigrationPlan({ workspace, repositoryCommit: COMMIT });
  assert.equal(plan.migrationCount, 3);
  assert.deepEqual(
    plan.migrations.map(({ version, ordinal }) => [version, ordinal]),
    [
      ["20260731000100", 1],
      ["20260731000200", 2],
      ["20270101000000", 3],
    ],
  );
  assert.equal(validateMigrationPlan(plan), plan);
});

test("migration discovery rejects noncanonical files and symlinks", async (t) => {
  const noncanonical = await fixture({ "1_bad.sql": "select 1;\n" });
  t.after(() => rm(noncanonical.workspace, { recursive: true, force: true }));
  await assert.rejects(
    discoverMigrationPlan({
      workspace: noncanonical.workspace,
      repositoryCommit: COMMIT,
    }),
    /noncanonical migration/u,
  );

  const linked = await fixture({
    "20260731000100_first.sql": "select 1;\n",
  });
  t.after(() => rm(linked.workspace, { recursive: true, force: true }));
  await symlink(
    path.join(linked.root, "20260731000100_first.sql"),
    path.join(linked.root, "20260731000200_link.sql"),
  );
  await assert.rejects(
    discoverMigrationPlan({ workspace: linked.workspace, repositoryCommit: COMMIT }),
    /regular file/u,
  );
});

test("reviewed plan commitment detects file and order tampering", async (t) => {
  const { workspace } = await fixture({
    "20260731000100_first.sql": "select 1;\n",
  });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverMigrationPlan({ workspace, repositoryCommit: COMMIT });
  const tampered = structuredClone(plan);
  tampered.migrations[0].bytes += 1;
  assert.throws(() => validateMigrationPlan(tampered), /commitment/u);
});

test("direct target validation accepts only the expected 5432 endpoint", () => {
  const projectRef = "abcdefghijklmnopqrst";
  const target = validateDirectSupabaseTarget(
    `postgresql://postgres:private@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
    projectRef,
  );
  assert.deepEqual(target, {
    projectRef,
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    database: "postgres",
    sslMode: "verify-full",
  });
  assert.doesNotMatch(JSON.stringify(target), /private/u);
  assert.deepEqual(
    validateDirectSupabaseTarget(
      `postgresql://cli_login_postgres:private@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
      projectRef,
    ),
    target,
  );
  assert.throws(
    () =>
      validateDirectSupabaseTarget(
        `postgresql://cli_login_postgres_2:private@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
        projectRef,
      ),
    /direct Supabase endpoint/u,
  );
  assert.throws(
    () =>
      validateDirectSupabaseTarget(
        `postgresql://postgres:private@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
        projectRef,
      ),
    /direct Supabase endpoint/u,
  );
  assert.throws(
    () =>
      validateDirectSupabaseTarget(
        `postgresql://postgres:private@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
        projectRef,
      ),
    /direct Supabase endpoint/u,
  );
});

test("history verification is prefix-only and requires file evidence", async (t) => {
  const { workspace } = await fixture({
    "20260731000100_first.sql": "select 1;\n",
    "20260731000200_second.sql": "select 2;\n",
  });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverMigrationPlan({ workspace, repositoryCommit: COMMIT });
  const first = plan.migrations[0];
  const state = compareMigrationHistory({
    plan,
    historyRows: [{ version: first.version, name: first.name, statements: ["select 1"] }],
    evidenceTablePresent: true,
    evidenceRows: [
      {
        version: first.version,
        name: first.name,
        file_name: path.posix.basename(first.file),
        ordinal: first.ordinal,
        file_sha256: first.fileSha256,
        plan_sha256: plan.planSha256,
        repository_commit: plan.repositoryCommit,
      },
    ],
  });
  assert.equal(state.status, "pending");
  assert.deepEqual(state.pending.map(({ version }) => version), [
    "20260731000200",
  ]);
  assert.throws(
    () =>
      compareMigrationHistory({
        plan,
        historyRows: [
          { version: first.version, name: first.name, statements: ["select 1"] },
        ],
        evidenceTablePresent: false,
        evidenceRows: [],
      }),
    /evidence is missing/u,
  );
  assert.throws(
    () =>
      compareMigrationHistory({
        plan,
        historyRows: [
          { version: plan.migrations[1].version, name: "second", statements: ["select 2"] },
        ],
        evidenceTablePresent: true,
        evidenceRows: [],
      }),
    /exact local prefix/u,
  );
});

test("bootstrap plan exposes exact binding facts and remains fail closed", () => {
  const binding = {
    schemaVersion: 1,
    chainId: 1,
    startBlock: 100,
    confirmations: 12,
    sources: [
      {
        contractName: "Launcher",
        address: `0x${"2".repeat(40)}`,
        startBlock: 101,
        runtimeCodeHash: HASH,
      },
    ],
    releases: [
      {
        model: "classic",
        releaseVersion: "classic-v1",
        activationBlock: 101,
        sourceContracts: ["Launcher"],
        dynamicContracts: [],
      },
    ],
  };
  const providers = ["envio_deployment", "rpc_provider", "rpc_provider", "uniswap_subgraph"].map(
    (providerType, index) => ({
      providerType,
      redactedIdentity: `provider-${index}`,
      deploymentCommitment: `0x${String(index + 2).repeat(64)}`,
      schemaCommitment: `0x${String(index + 6).repeat(64)}`,
    }),
  );
  const plan = buildBootstrapPlan({
    binding,
    bindingSha256: HASH,
    repositoryCommit: COMMIT,
    providers,
  });
  assert.equal(plan.execution.mode, "plan-only");
  assert.equal(plan.execution.ready, false);
  assert.deepEqual(plan.releases[0].scope, {
    chainId: 1,
    releaseId: "classic-v1",
    modelId: "classic",
    sourceGroup: "core",
  });
  assert.ok(
    plan.releases[0].sourceBindings[0].unresolved.includes(
      "abiEventSetCommitment",
    ),
  );
});

test("secret guard and safe failures do not echo credentials", () => {
  assert.throws(
    () => assertNoSecretOutput({ value: "top-secret" }, ["top-secret"]),
    /credential/u,
  );
  assert.equal(safeFailure(new Error("postgres://user:secret@example")), "operator failed");
  const postgresError = new Error("postgres://user:secret@example");
  postgresError.code = "42P01";
  assert.equal(safeFailure(postgresError), "operator failed (42P01)");
});

function pending(value) {
  const result = Promise.resolve(value);
  result.simple = () => result;
  return result;
}

function fakeOpenClient({ backendPid = 731, reconnectOnRoleChange = false } = {}) {
  const sessionUser = "cli_login_postgres";
  let currentRole = sessionUser;
  let ended = false;
  const sql = {
    unsafe(statement) {
      if (statement.trim() === "set role postgres") {
        currentRole = "postgres";
        if (reconnectOnRoleChange) backendPid += 1;
        return pending([]);
      }
      if (statement.includes("current_database()")) {
        return pending([{
          backend_pid: backendPid,
          session_user: sessionUser,
          current_user: sessionUser,
          current_role: currentRole,
          database_name: "postgres",
          server_port: 5432,
          server_version_num: "170010",
          is_postgres_member: true,
        }]);
      }
      return pending([{
        backend_pid: backendPid,
        session_user: sessionUser,
        current_user: currentRole,
        current_role: currentRole,
      }]);
    },
    async end() {
      ended = true;
    },
  };
  return { sql, ended: () => ended };
}

test("hosted database opening pins one non-expiring backend session", async () => {
  const projectRef = "abcdefghijklmnopqrst";
  const client = fakeOpenClient();
  let options;
  const connection = await openHostedDatabase(
    {
      databaseUrl:
        `postgresql://cli_login_postgres:private@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
      expectedProjectRef: projectRef,
      sslCaPem:
        `-----BEGIN CERTIFICATE-----\n${"A".repeat(80)}\n-----END CERTIFICATE-----`,
    },
    {
      postgresFactory(input) {
        options = input;
        return client.sql;
      },
    },
  );
  assert.equal(options.max, 1);
  assert.equal(options.idle_timeout, 0);
  assert.equal(options.max_lifetime, null);
  assert.deepEqual(connection.sessionIdentity, {
    backendPid: 731,
    sessionUser: "cli_login_postgres",
    currentRole: "postgres",
  });
  await closeHostedDatabase(connection.sql);
  assert.equal(client.ended(), true);
});

test("hosted database opening rejects a reconnect while assuming the JIT role", async () => {
  const projectRef = "abcdefghijklmnopqrst";
  const client = fakeOpenClient({ reconnectOnRoleChange: true });
  await assert.rejects(
    openHostedDatabase(
      {
        databaseUrl:
          `postgresql://cli_login_postgres:private@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
        expectedProjectRef: projectRef,
        sslCaPem:
          `-----BEGIN CERTIFICATE-----\n${"A".repeat(80)}\n-----END CERTIFICATE-----`,
      },
      { postgresFactory: () => client.sql },
    ),
    /effective role is not postgres/u,
  );
  assert.equal(client.ended(), true);
});

function fakeMigrationClient({ reconnectAfterMigration = false } = {}) {
  const sessionUser = "cli_login_postgres";
  let backendPid = 811;
  let currentRole = "postgres";
  let lockHeld = false;
  let migrationTransactions = 0;
  const historyRows = [];
  const evidenceRows = [];
  const mutations = [];

  const identity = (extra = {}) => ({
    backend_pid: backendPid,
    session_user: sessionUser,
    current_role: currentRole,
    ...extra,
  });

  function unsafe(statement) {
    const normalized = statement.trim();
    if (normalized.includes("pg_try_advisory_lock")) {
      lockHeld = true;
      mutations.push(`lock:${backendPid}:${currentRole}`);
      return pending([identity({ acquired: true })]);
    }
    if (normalized.includes("pg_advisory_unlock")) {
      const released = lockHeld && backendPid === 811 && currentRole === "postgres";
      lockHeld = false;
      mutations.push(`unlock:${backendPid}:${currentRole}:${released}`);
      return pending([identity({ released })]);
    }
    if (normalized.includes("to_regclass")) {
      return pending([{
        history_table: "supabase_migrations.schema_migrations",
        evidence_table:
          "supabase_migrations.programmable_migration_evidence",
      }]);
    }
    if (normalized.includes("select version, coalesce(name")) {
      return pending(historyRows.map((row) => ({ ...row })));
    }
    if (normalized.includes("select version, name, file_name")) {
      return pending(evidenceRows.map((row) => ({ ...row })));
    }
    if (normalized === "reset all; set role postgres") {
      mutations.push("reset-and-set-role");
      currentRole = "postgres";
      return pending([]);
    }
    if (normalized === "set role postgres") {
      mutations.push("set-role-postgres");
      currentRole = "postgres";
      return pending([]);
    }
    if (normalized.includes("set local lock_timeout")) {
      mutations.push("set-timeouts");
      return pending([]);
    }
    if (normalized.includes("create schema if not exists supabase_migrations")) {
      mutations.push("history-ddl");
      return pending([]);
    }
    if (normalized.includes("select migration_")) {
      mutations.push(normalized.match(/select (migration_\w+)/u)?.[1]);
      currentRole = sessionUser;
      return pending([]);
    }
    if (normalized.includes("pg_backend_pid")) {
      mutations.push(`assert:${backendPid}:${currentRole}`);
      return pending([identity()]);
    }
    throw new Error(`unexpected fake SQL: ${normalized.slice(0, 80)}`);
  }

  function transaction(strings, ...values) {
    const statement = strings.join("?");
    if (statement.includes("programmable_migration_evidence")) {
      evidenceRows.push({
        version: values[0],
        name: values[1],
        file_name: values[2],
        ordinal: values[3],
        file_sha256: values[4],
        plan_sha256: values[5],
        repository_commit: values[6],
      });
      mutations.push(`evidence:${values[0]}`);
    } else if (statement.includes("schema_migrations")) {
      historyRows.push({ version: values[0], name: values[1], statements: values[2] });
      mutations.push(`history:${values[0]}`);
    } else {
      throw new Error("unexpected fake tagged SQL");
    }
    return Promise.resolve([]);
  }
  transaction.unsafe = unsafe;
  transaction.array = (value) => value;

  const sql = Object.assign(
    (...args) => transaction(...args),
    {
      unsafe,
      array: transaction.array,
      async begin(callback) {
        const evidenceBefore = evidenceRows.length;
        const result = await callback(transaction);
        if (evidenceRows.length > evidenceBefore) {
          migrationTransactions += 1;
          if (reconnectAfterMigration && migrationTransactions === 1) {
            backendPid += 1;
            currentRole = sessionUser;
            lockHeld = false;
          }
        }
        return result;
      },
    },
  );
  return { sql, mutations, historyRows, evidenceRows };
}

test("migration apply keeps the advisory lock on one exact backend", async (t) => {
  const { workspace } = await fixture({
    "20260731000100_first.sql":
      "set role programmable_migrator; select migration_one(); reset role;\n",
  });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverMigrationPlan({ workspace, repositoryCommit: COMMIT });
  const client = fakeMigrationClient();
  const result = await applyPendingMigrations({
    sql: client.sql,
    workspace,
    plan,
    sessionIdentity: {
      backendPid: 811,
      sessionUser: "cli_login_postgres",
      currentRole: "postgres",
    },
  });
  assert.deepEqual(result.appliedThisRun, ["20260731000100"]);
  assert.equal(result.status, "current");
  assert.equal(client.historyRows.length, 1);
  assert.equal(client.evidenceRows.length, 1);
  const resetIndex = client.mutations.indexOf("reset-and-set-role");
  assert.match(client.mutations[resetIndex - 1], /^assert:811:postgres$/u);
  const postMigrationIndex = client.mutations.indexOf(
    "assert:811:cli_login_postgres",
  );
  assert.ok(postMigrationIndex > resetIndex);
  assert.equal(client.mutations[postMigrationIndex + 1], "set-role-postgres");
  assert.equal(client.mutations.at(-1), "unlock:811:postgres:true");
});

test("migration apply fails closed after a backend reconnect", async (t) => {
  const { workspace } = await fixture({
    "20260731000100_first.sql":
      "set role programmable_migrator; select migration_one(); reset role;\n",
    "20260731000200_second.sql":
      "set role programmable_migrator; select migration_two(); reset role;\n",
  });
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverMigrationPlan({ workspace, repositoryCommit: COMMIT });
  const client = fakeMigrationClient({ reconnectAfterMigration: true });
  await assert.rejects(
    applyPendingMigrations({
      sql: client.sql,
      workspace,
      plan,
      sessionIdentity: {
        backendPid: 811,
        sessionUser: "cli_login_postgres",
        currentRole: "postgres",
      },
    }),
    /session changed unexpectedly/u,
  );
  assert.equal(client.historyRows.length, 1);
  assert.equal(client.evidenceRows.length, 1);
  assert.equal(client.mutations.includes("migration_two"), false);
  assert.equal(
    client.mutations.at(-1),
    "unlock:812:cli_login_postgres:false",
  );
});
