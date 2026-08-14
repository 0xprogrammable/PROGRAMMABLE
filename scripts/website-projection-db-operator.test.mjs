import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  assertWebsiteProjectionApplyConfirmation,
  assertWebsiteProjectionRoleGraph,
  catalogSnapshotSha256,
  compareWebsiteProjectionEvidence,
  discoverWebsiteProjectionPlan,
  validateWebsiteProjectionPlan,
  validateWebsiteProjectionRuntimePassword,
} from "./website-projection-db-operator-core.mjs";
import {
  applyWebsiteProjectionMigrations,
  inspectWebsiteProjectionDatabase,
} from "./website-projection-db-postgres.mjs";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const PROJECT_REF = "abcdefghijklmnopqrst";
const MIGRATIONS = [
  "0001_projection_records_v1.sql",
  "0002_custom_launch_wallet_profile_v2.sql",
  "0003_registry_custom_public_read_v1.sql",
  "0004_approval_v3_artifacts_v1.sql",
  "0005_generic_launch_materializations_v2.sql",
];

function migrationSql(index) {
  return `BEGIN;\nSELECT ${index};\nCOMMIT;\n`;
}

async function fixture(overrides = {}) {
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), "website-projection-db-operator-test-"),
  );
  const root = path.join(
    workspace,
    "ops",
    "website-projection-target",
    "migrations",
  );
  await mkdir(root, { recursive: true });
  for (const [index, file] of MIGRATIONS.entries()) {
    await writeFile(
      path.join(root, file),
      overrides[file] ?? migrationSql(index + 1),
    );
  }
  return { workspace, root };
}

test("plan discovery binds the exact five files, source bytes and execution bodies", async (t) => {
  const { workspace } = await fixture();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverWebsiteProjectionPlan({
    workspace,
    repositoryCommit: COMMIT,
    repositoryTree: TREE,
  });
  assert.equal(plan.migrationRoot, "ops/website-projection-target/migrations");
  assert.equal(plan.migrationCount, 5);
  assert.deepEqual(plan.migrations.map(({ file }) => path.posix.basename(file)), MIGRATIONS);
  assert.deepEqual(plan.migrations.map(({ version }) => version), [
    "0001", "0002", "0003", "0004", "0005",
  ]);
  assert.ok(plan.migrations.every(({ fileSha256, executionSha256 }) =>
    /^0x[0-9a-f]{64}$/u.test(fileSha256)
      && /^0x[0-9a-f]{64}$/u.test(executionSha256)));
  assert.notEqual(plan.migrations[0].fileSha256, plan.migrations[0].executionSha256);
  assert.equal(validateWebsiteProjectionPlan(plan), plan);
});

test("plan discovery rejects missing, extra, linked and unwrapped migration inputs", async (t) => {
  const missing = await fixture();
  t.after(() => rm(missing.workspace, { recursive: true, force: true }));
  await rm(path.join(missing.root, MIGRATIONS[4]));
  await assert.rejects(
    discoverWebsiteProjectionPlan({
      workspace: missing.workspace,
      repositoryCommit: COMMIT,
      repositoryTree: TREE,
    }),
    /exactly the five canonical files/u,
  );

  const extra = await fixture();
  t.after(() => rm(extra.workspace, { recursive: true, force: true }));
  await writeFile(path.join(extra.root, "0006_unreviewed.sql"), migrationSql(6));
  await assert.rejects(
    discoverWebsiteProjectionPlan({
      workspace: extra.workspace,
      repositoryCommit: COMMIT,
      repositoryTree: TREE,
    }),
    /exactly the five canonical files/u,
  );

  const linked = await fixture();
  t.after(() => rm(linked.workspace, { recursive: true, force: true }));
  await rm(path.join(linked.root, MIGRATIONS[4]));
  await symlink(path.join(linked.root, MIGRATIONS[3]), path.join(linked.root, MIGRATIONS[4]));
  await assert.rejects(
    discoverWebsiteProjectionPlan({
      workspace: linked.workspace,
      repositoryCommit: COMMIT,
      repositoryTree: TREE,
    }),
    /regular file/u,
  );

  const unwrapped = await fixture({
    [MIGRATIONS[0]]: "SELECT 1;\n",
  });
  t.after(() => rm(unwrapped.workspace, { recursive: true, force: true }));
  await assert.rejects(
    discoverWebsiteProjectionPlan({
      workspace: unwrapped.workspace,
      repositoryCommit: COMMIT,
      repositoryTree: TREE,
    }),
    /outer BEGIN and COMMIT/u,
  );
});

test("plan validation rejects tree, order and execution commitment tampering", async (t) => {
  const { workspace } = await fixture();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverWebsiteProjectionPlan({
    workspace,
    repositoryCommit: COMMIT,
    repositoryTree: TREE,
  });
  for (const mutate of [
    (value) => { value.repositoryTree = "c".repeat(40); },
    (value) => { value.migrations.reverse(); },
    (value) => { value.migrations[0].executionSha256 = `0x${"d".repeat(64)}`; },
  ]) {
    const tampered = structuredClone(plan);
    mutate(tampered);
    assert.throws(() => validateWebsiteProjectionPlan(tampered), /plan/u);
  }
});

test("evidence comparison permits only an exact prefix on the exact target", async (t) => {
  const { workspace } = await fixture();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverWebsiteProjectionPlan({
    workspace,
    repositoryCommit: COMMIT,
    repositoryTree: TREE,
  });
  const first = plan.migrations[0];
  const row = {
    ordinal: first.ordinal,
    version: first.version,
    name: first.name,
    file_name: path.posix.basename(first.file),
    file_sha256: first.fileSha256,
    execution_sha256: first.executionSha256,
    plan_sha256: plan.planSha256,
    repository_commit: plan.repositoryCommit,
    repository_tree: plan.repositoryTree,
    target_project_ref: PROJECT_REF,
    catalog_sha256: `0x${"e".repeat(64)}`,
    operator_catalog_sha256: `0x${"f".repeat(64)}`,
  };
  const state = compareWebsiteProjectionEvidence({
    plan,
    expectedProjectRef: PROJECT_REF,
    evidenceTablePresent: true,
    applicationSchemaPresent: true,
    evidenceRows: [row],
  });
  assert.equal(state.status, "pending");
  assert.equal(state.appliedCount, 1);
  assert.deepEqual(state.pending.map(({ version }) => version), [
    "0002", "0003", "0004", "0005",
  ]);
  assert.equal(state.catalogSha256, row.catalog_sha256);

  assert.throws(() => compareWebsiteProjectionEvidence({
    plan,
    expectedProjectRef: PROJECT_REF,
    evidenceTablePresent: false,
    applicationSchemaPresent: true,
    evidenceRows: [],
  }), /unproven application schema/u);
  assert.throws(() => compareWebsiteProjectionEvidence({
    plan,
    expectedProjectRef: "z".repeat(20),
    evidenceTablePresent: true,
    applicationSchemaPresent: true,
    evidenceRows: [row],
  }), /target mismatch/u);
  assert.throws(() => compareWebsiteProjectionEvidence({
    plan,
    expectedProjectRef: PROJECT_REF,
    evidenceTablePresent: true,
    applicationSchemaPresent: true,
    evidenceRows: [{ ...row, version: "0002" }],
  }), /exact plan prefix/u);
});

test("fresh state is pending only when no unproven application schema exists", async (t) => {
  const { workspace } = await fixture();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverWebsiteProjectionPlan({
    workspace,
    repositoryCommit: COMMIT,
    repositoryTree: TREE,
  });
  const state = compareWebsiteProjectionEvidence({
    plan,
    expectedProjectRef: PROJECT_REF,
    evidenceTablePresent: false,
    applicationSchemaPresent: false,
    evidenceRows: [],
  });
  assert.equal(state.status, "pending");
  assert.equal(state.appliedCount, 0);
});

test("runtime bootstrap password is secret-only and bounded", () => {
  assert.equal(
    validateWebsiteProjectionRuntimePassword("correct horse battery staple 2026"),
    "correct horse battery staple 2026",
  );
  assert.throws(() => validateWebsiteProjectionRuntimePassword("short"), /password/u);
  assert.throws(
    () => validateWebsiteProjectionRuntimePassword(`good-password-${String.fromCharCode(0)}bad`),
    /password/u,
  );
});

function safeRole(name, overrides = {}) {
  return {
    rolname: name,
    rolsuper: false,
    rolinherit: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: false,
    rolreplication: false,
    rolbypassrls: false,
    ...overrides,
  };
}

test("role graph accepts only the constrained runtime and disconnected provider roles", () => {
  const providerRoles = ["anon", "authenticated", "service_role"]
    .map((name) => safeRole(name, {
      rolbypassrls: name === "service_role",
    }));
  const fresh = assertWebsiteProjectionRoleGraph({
    roles: [safeRole("postgres", { rolsuper: true }), ...providerRoles],
    memberships: [],
    appliedCount: 0,
  });
  assert.equal(fresh.runtimeRoleStatus, "missing");

  const current = assertWebsiteProjectionRoleGraph({
    roles: [
      safeRole("postgres", { rolsuper: true }),
      safeRole("programmable_website_projection_runtime", { rolcanlogin: true }),
      ...providerRoles,
    ],
    memberships: [],
    appliedCount: 5,
  });
  assert.equal(current.runtimeRoleStatus, "current");

  assert.throws(() => assertWebsiteProjectionRoleGraph({
    roles: [safeRole("postgres", { rolsuper: true }), ...providerRoles],
    memberships: [],
    appliedCount: 1,
  }), /runtime role is missing/u);
  assert.throws(() => assertWebsiteProjectionRoleGraph({
    roles: [
      safeRole("postgres", { rolsuper: true }),
      safeRole("programmable_website_projection_runtime", {
        rolcanlogin: true,
        rolbypassrls: true,
      }),
      ...providerRoles,
    ],
    memberships: [],
    appliedCount: 0,
  }), /runtime role posture/u);
  assert.throws(() => assertWebsiteProjectionRoleGraph({
    roles: [
      safeRole("postgres", { rolsuper: true }),
      safeRole("programmable_website_projection_runtime", { rolcanlogin: true }),
      ...providerRoles,
    ],
    memberships: [{ member_name: "service_role", role_name: "postgres" }],
    appliedCount: 0,
  }), /role membership/u);
});

test("catalog fingerprints are canonical and reject non-row data", () => {
  const left = catalogSnapshotSha256({
    tables: [{ name: "b" }, { name: "a" }],
    policies: [{ name: "p" }],
  });
  const right = catalogSnapshotSha256({
    policies: [{ name: "p" }],
    tables: [{ name: "b" }, { name: "a" }],
  });
  assert.equal(left, right);
  assert.match(left, /^0x[0-9a-f]{64}$/u);
  assert.throws(() => catalogSnapshotSha256({ tables: "not rows" }), /catalog/u);
});

test("irreversible apply confirmation binds both plan and target", async (t) => {
  const { workspace } = await fixture();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverWebsiteProjectionPlan({
    workspace,
    repositoryCommit: COMMIT,
    repositoryTree: TREE,
  });
  assert.doesNotThrow(() => assertWebsiteProjectionApplyConfirmation({
    plan,
    expectedProjectRef: PROJECT_REF,
    confirmApply: plan.planSha256,
    confirmTarget: PROJECT_REF,
  }));
  assert.throws(() => assertWebsiteProjectionApplyConfirmation({
    plan,
    expectedProjectRef: PROJECT_REF,
    confirmApply: `0x${"f".repeat(64)}`,
    confirmTarget: PROJECT_REF,
  }), /reviewed plan/u);
  assert.throws(() => assertWebsiteProjectionApplyConfirmation({
    plan,
    expectedProjectRef: PROJECT_REF,
    confirmApply: plan.planSha256,
    confirmTarget: "z".repeat(20),
  }), /target/u);
});

function pgliteSql(client) {
  const sql = {
    unsafe(statement, parameters = []) {
      const normalized = statement.trimStart().toLowerCase();
      const operation = (parameters.length > 0
        || normalized.startsWith("select")
        || normalized.startsWith("with"))
        ? client.query(statement, parameters).then(({ rows }) => rows)
        : client.exec(statement).then((results) => results.at(-1)?.rows ?? []);
      operation.simple = () => operation;
      return operation;
    },
    async begin(callback) {
      return await client.transaction(async (transaction) =>
        callback(pgliteSql(transaction)));
    },
  };
  return sql;
}

test("database operator bootstraps, applies, resumes and detects catalog drift", async (t) => {
  const database = new PGlite();
  t.after(() => database.close());
  await database.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
  `);
  const sql = pgliteSql(database);
  const [identity] = (await database.query(`
    SELECT pg_backend_pid() AS backend_pid,
           session_user::text AS session_user,
           current_role::text AS current_role
  `)).rows;
  const workspace = path.resolve(new URL("..", import.meta.url).pathname);
  const plan = await discoverWebsiteProjectionPlan({
    workspace,
    repositoryCommit: COMMIT,
    repositoryTree: TREE,
  });
  const sessionIdentity = {
    backendPid: Number(identity.backend_pid),
    sessionUser: identity.session_user,
    currentRole: identity.current_role,
  };
  const applied = await applyWebsiteProjectionMigrations({
    sql,
    workspace,
    plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity,
    runtimePassword: "correct horse battery staple 2026",
  });
  assert.equal(applied.status, "current");
  assert.equal(applied.roleCreated, true);
  assert.deepEqual(applied.appliedThisRun, [
    "0001", "0002", "0003", "0004", "0005",
  ]);
  assert.match(applied.catalogSha256, /^0x[0-9a-f]{64}$/u);

  const verified = await inspectWebsiteProjectionDatabase({
    sql,
    plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity,
  });
  assert.equal(verified.status, "current");
  assert.equal(verified.runtimeRoleStatus, "current");

  const resumed = await applyWebsiteProjectionMigrations({
    sql,
    workspace,
    plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity,
  });
  assert.deepEqual(resumed.appliedThisRun, []);
  assert.equal(resumed.roleCreated, false);

  await database.exec(`
    GRANT UPDATE ON programmable_website_projection_v1.projection_records
      TO programmable_website_projection_runtime;
  `);
  await assert.rejects(inspectWebsiteProjectionDatabase({
    sql,
    plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity,
  }), /catalog fingerprint mismatch/u);
});
