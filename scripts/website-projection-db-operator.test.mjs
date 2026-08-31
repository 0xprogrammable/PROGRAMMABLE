import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  assertWebsiteProjectionAdoptExistingConfirmation,
  assertWebsiteProjectionApplyConfirmation,
  assertWebsiteProjectionCheckoutClean,
  assertWebsiteProjectionRoleGraph,
  catalogSnapshotSha256,
  compareWebsiteProjectionEvidence,
  discoverWebsiteProjectionPlan,
  unwrapWebsiteProjectionMigration,
  validateRetainedWebsiteProjectionPlan,
  validateWebsiteProjectionPlan,
  validateWebsiteProjectionRuntimePassword,
  WEBSITE_PROJECTION_RETAINED_ORDER_SHA256,
  WEBSITE_PROJECTION_RETAINED_PLAN_COMMIT,
  WEBSITE_PROJECTION_RETAINED_PLAN_SHA256,
  WEBSITE_PROJECTION_RETAINED_PLAN_TREE,
} from "./website-projection-db-operator-core.mjs";
import {
  adoptExistingWebsiteProjectionDatabase,
  applyWebsiteProjectionMigrations,
  assertWebsiteProjectionAdoptionLiveInventory,
  assertWebsiteProjectionAdoptionProtectedSnapshots,
  buildCanonicalWebsiteProjectionAdoptionReference,
  inspectWebsiteProjectionDatabase,
  readWebsiteProjectionAdoptionProtectedSnapshots,
} from "./website-projection-db-postgres.mjs";

const COMMIT = "76ebd54e2f0e31d055cfe6c36b7474b0e850de90";
const TREE = "8e4ddd9a73818ce70f1284f3b2731bc87b005f27";
const PROJECT_REF = "mnnvlrqwhfoppogslsje";
const SOURCE_SNAPSHOT =
  "0x917afa0f6bcd19f00f5d2ce5cd0d8221ef00ad6716460af11bff0906e4b9a0f9";
const EXPANDED_SNAPSHOT =
  "0x8cb9841f0131b48fb67eac0082d72f51158500a61482c0b21e0c7b7cc2f19284";
const BASE_SNAPSHOT =
  "0xac4a1fe60ebf677865a0f8ca6160162d9c457dc2bd401aa60fd820c8f2fdcc58";
const MIGRATIONS = [
  "0001_projection_records_v1.sql",
  "0002_custom_launch_wallet_profile_v2.sql",
  "0003_registry_custom_public_read_v1.sql",
  "0004_approval_v3_artifacts_v1.sql",
  "0005_generic_launch_materializations_v2.sql",
  "0006_gmgn_account_gate_v1.sql",
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

function retainedPlan(successorPlan) {
  const plan = Object.freeze({
    ...successorPlan,
    repositoryCommit: WEBSITE_PROJECTION_RETAINED_PLAN_COMMIT,
    repositoryTree: WEBSITE_PROJECTION_RETAINED_PLAN_TREE,
    migrationCount: 5,
    orderSha256: WEBSITE_PROJECTION_RETAINED_ORDER_SHA256,
    migrations: Object.freeze(successorPlan.migrations.slice(0, 5)),
    planSha256: WEBSITE_PROJECTION_RETAINED_PLAN_SHA256,
  });
  validateRetainedWebsiteProjectionPlan(plan);
  return plan;
}

test("plan discovery binds the exact six files, source bytes and execution bodies", async (t) => {
  const { workspace } = await fixture();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const plan = await discoverWebsiteProjectionPlan({
    workspace,
    repositoryCommit: COMMIT,
    repositoryTree: TREE,
  });
  assert.equal(plan.migrationRoot, "ops/website-projection-target/migrations");
  assert.equal(plan.migrationCount, 6);
  assert.deepEqual(plan.migrations.map(({ file }) => path.posix.basename(file)), MIGRATIONS);
  assert.deepEqual(plan.migrations.map(({ version }) => version), [
    "0001", "0002", "0003", "0004", "0005", "0006",
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
    /exactly the six canonical files/u,
  );

  const extra = await fixture();
  t.after(() => rm(extra.workspace, { recursive: true, force: true }));
  await writeFile(path.join(extra.root, "0007_unreviewed.sql"), migrationSql(7));
  await assert.rejects(
    discoverWebsiteProjectionPlan({
      workspace: extra.workspace,
      repositoryCommit: COMMIT,
      repositoryTree: TREE,
    }),
    /exactly the six canonical files/u,
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
    evidence_kind: "applied",
    adoption_source_snapshot_sha256: null,
    adoption_source_catalog_sha256: null,
    adoption_source_data_sha256: null,
    adoption_attestation_sha256: null,
    adoption_operator_commit: null,
    adoption_operator_tree: null,
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
    "0002", "0003", "0004", "0005", "0006",
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

test("operator checkout must be entirely clean, not only the migration root", () => {
  assert.doesNotThrow(() => assertWebsiteProjectionCheckoutClean(""));
  assert.throws(
    () => assertWebsiteProjectionCheckoutClean(
      " M scripts/website-projection-db-operator.mjs\n",
    ),
    /exact reviewed commit/u,
  );
  assert.throws(
    () => assertWebsiteProjectionCheckoutClean("?? untracked-operator-wrapper.mjs\n"),
    /exact reviewed commit/u,
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
    rolconnlimit: -1,
    rolvaliduntil: null,
    rolconfig: null,
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
    memberships: [
      {
        member_name: "authenticator",
        role_name: "authenticated",
        grantor_name: "postgres",
        admin_option: false,
        inherit_option: true,
        set_option: true,
      },
      {
        member_name: "postgres",
        role_name: "programmable_website_projection_runtime",
        grantor_name: "supabase_admin",
        admin_option: true,
        inherit_option: false,
        set_option: false,
      },
    ],
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
    memberships: [{
      member_name: "service_role",
      role_name: "postgres",
      grantor_name: "postgres",
      admin_option: false,
      inherit_option: true,
      set_option: true,
    }],
    appliedCount: 0,
  }), /outgoing role membership/u);
  assert.throws(() => assertWebsiteProjectionRoleGraph({
    roles: [
      safeRole("postgres", { rolsuper: true }),
      safeRole("programmable_website_projection_runtime", { rolcanlogin: true }),
      ...providerRoles,
    ],
    memberships: [{
      member_name: "operator_helper",
      role_name: "programmable_website_projection_runtime",
      grantor_name: "postgres",
      admin_option: false,
      inherit_option: true,
      set_option: true,
    }],
    appliedCount: 0,
  }), /outgoing role membership/u);
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

test("protected adoption inventory validator rejects catalog, role, data and legacy drift", () => {
  const structure = {
    namespaces: [{ nspname: "programmable_website_projection_v1", owner_name: "postgres" }],
    relations: [],
    columns: [],
    constraints: [],
    indexes: [],
    policies: [],
    triggers: [],
    functions: [],
    schemaAcl: [],
    relationAcl: [],
    columnAcl: [],
    functionAcl: [],
  };
  const roles = [
    safeRole("anon", { rolinherit: true }),
    safeRole("authenticated", { rolinherit: true }),
    safeRole("postgres", { rolinherit: true, rolcanlogin: true }),
    safeRole("programmable_website_projection_runtime", {
      rolinherit: true,
      rolcanlogin: true,
    }),
    safeRole("service_role", { rolinherit: true, rolbypassrls: true }),
    safeRole("supabase_admin", { rolinherit: true, rolcanlogin: true }),
  ];
  const memberships = [{
    member_name: "postgres",
    role_name: "programmable_website_projection_runtime",
    grantor_name: "supabase_admin",
    admin_option: true,
    inherit_option: false,
    set_option: false,
  }];
  const currentRoles = [
    roles[0],
    roles[1],
    safeRole("authenticator", { rolinherit: true, rolcanlogin: true }),
    ...roles.slice(2),
  ];
  const currentMemberships = [
    {
      member_name: "authenticator",
      role_name: "anon",
      grantor_name: "supabase_admin",
      admin_option: false,
      inherit_option: false,
      set_option: true,
    },
    ...memberships,
  ];
  const sourceData = { rowPresence: [
    { relation_name: "credential_uses", has_rows: false },
    { relation_name: "projection_records", has_rows: false },
    { relation_name: "registry_custom_launch_records", has_rows: false },
  ] };
  const legacyInventory = {
    relations: [
      {
        nspname: "supabase_migrations",
        relname: "programmable_migration_evidence",
        relkind: "r",
      },
      {
        nspname: "supabase_migrations",
        relname: "schema_migrations",
        relkind: "r",
      },
    ],
    columns: [],
    schemaRows: [],
    evidenceRows: [],
    publicCanonicalSha256:
      "0x93e41eab957ab8add897a8b277bcaaa0a5f10eebeb27f47db5bc0e59640484a2",
  };
  const protectedSnapshots = {
    expandedSnapshot: {
      applicationCatalog: {
        schemas: structure.namespaces,
        ...Object.fromEntries(Object.entries(structure).filter(([key]) =>
          key !== "namespaces")),
        applicationRowCounts: sourceData.rowPresence.map(
          ({ relation_name: table_name }) => ({ table_name, row_count: "0" }),
        ),
      },
      roleExtended: roles,
      membershipExtended: memberships,
      legacySupabaseInventory: {
        columns: [],
        schemaRows: [],
        evidenceRows: [],
      },
    },
    currentSnapshot: {
      roles: currentRoles,
      memberships: currentMemberships,
    },
  };
  const valid = {
    sourceCatalog: {
      roles: roles.filter(({ rolname }) => rolname !== "supabase_admin"),
      memberships,
      ...structure,
    },
    sourceData,
    extendedRoleInventory: {
      roles: currentRoles,
      memberships: currentMemberships,
    },
    legacyInventory,
    protectedSnapshots,
  };
  assert.equal(assertWebsiteProjectionAdoptionLiveInventory(valid), true);
  for (const mutate of [
    (value) => { value.sourceCatalog.relations.push({ relname: "extra" }); },
    (value) => { value.sourceCatalog.roles[3].rolinherit = false; },
    (value) => { value.sourceCatalog.memberships[0].grantor_name = "postgres"; },
    (value) => { value.extendedRoleInventory.roles[3].rolconnlimit = 1; },
    (value) => { value.extendedRoleInventory.memberships[1].set_option = true; },
    (value) => { value.extendedRoleInventory.memberships.shift(); },
    (value) => { value.extendedRoleInventory.memberships[0].set_option = false; },
    (value) => {
      value.extendedRoleInventory.roles.splice(
        2,
        0,
        safeRole("attacker_login", { rolcanlogin: true, rolinherit: true }),
      );
      value.extendedRoleInventory.memberships.unshift({
        member_name: "attacker_login",
        role_name: "authenticator",
        grantor_name: "supabase_admin",
        admin_option: false,
        inherit_option: false,
        set_option: true,
      });
    },
    (value) => { value.sourceData.rowPresence[0].has_rows = true; },
    (value) => { value.legacyInventory.relations.push({ relname: "extra" }); },
    (value) => { value.legacyInventory.columns.push({ column_name: "extra" }); },
    (value) => { value.legacyInventory.schemaRows.push({ version: "extra" }); },
    (value) => { value.legacyInventory.evidenceRows.push({ version: "extra" }); },
    (value) => { value.legacyInventory.publicCanonicalSha256 = `0x${"0".repeat(64)}`; },
  ]) {
    const drifted = structuredClone(valid);
    drifted.protectedSnapshots = structuredClone(protectedSnapshots);
    mutate(drifted);
    assert.throws(
      () => assertWebsiteProjectionAdoptionLiveInventory(drifted),
      /adopt-existing/u,
    );
  }
});

test("protected snapshot reader rejects symlinks, broad modes, raw drift and target drift", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "website-projection-snapshot-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, "target.json");
  const baseLink = path.join(root, "base-link.json");
  const expandedLink = path.join(root, "expanded-link.json");
  const currentLink = path.join(root, "current-link.json");
  await writeFile(target, "{}\n", { mode: 0o600 });
  await symlink(target, baseLink);
  await symlink(target, expandedLink);
  await symlink(target, currentLink);
  await assert.rejects(readWebsiteProjectionAdoptionProtectedSnapshots({
    baseSnapshotPath: baseLink,
    expandedSnapshotPath: expandedLink,
    currentSnapshotPath: currentLink,
    expectedProjectRef: PROJECT_REF,
  }), /ELOOP|symbolic links/u);

  const broadBase = path.join(root, "broad-base.json");
  const broadExpanded = path.join(root, "broad-expanded.json");
  const broadCurrent = path.join(root, "broad-current.json");
  await writeFile(broadBase, "{}\n", { mode: 0o600 });
  await writeFile(broadExpanded, "{}\n", { mode: 0o600 });
  await writeFile(broadCurrent, "{}\n", { mode: 0o600 });
  await chmod(broadBase, 0o644);
  await chmod(broadExpanded, 0o644);
  await chmod(broadCurrent, 0o644);
  await assert.rejects(readWebsiteProjectionAdoptionProtectedSnapshots({
    baseSnapshotPath: broadBase,
    expandedSnapshotPath: broadExpanded,
    currentSnapshotPath: broadCurrent,
    expectedProjectRef: PROJECT_REF,
  }), /owner-only regular file/u);

  const driftedBase = path.join(root, "drifted-base.json");
  const driftedExpanded = path.join(root, "drifted-expanded.json");
  const driftedCurrent = path.join(root, "drifted-current.json");
  await writeFile(driftedBase, "{}\n", { mode: 0o600 });
  await writeFile(driftedExpanded, "{}\n", { mode: 0o600 });
  await writeFile(driftedCurrent, "{}\n", { mode: 0o600 });
  await assert.rejects(readWebsiteProjectionAdoptionProtectedSnapshots({
    baseSnapshotPath: driftedBase,
    expandedSnapshotPath: driftedExpanded,
    currentSnapshotPath: driftedCurrent,
    expectedProjectRef: PROJECT_REF,
  }), /raw hash mismatch/u);

  const source = {
    repositoryCommit: COMMIT,
    repositoryTree: TREE,
    planSha256:
      "0xf0fc7bca18c16da02be83f75d25e404bfe0b7ec7f10c29ecfbea93fcb0d7e973",
  };
  const targetIdentity = {
    projectRef: PROJECT_REF,
    host: `db.${PROJECT_REF}.supabase.co`,
    port: 5432,
    database: "postgres",
    sslMode: "verify-full",
  };
  const baseSnapshot = {
    kind: "programmable-website-projection-hosted-catalog-snapshot-v1",
    source,
    target: targetIdentity,
  };
  assert.throws(() => assertWebsiteProjectionAdoptionProtectedSnapshots({
    baseSnapshot,
    expandedSnapshot: {
      kind: "programmable-website-projection-hosted-catalog-snapshot-v2",
      schemaVersion: 2,
      source,
      target: targetIdentity,
      baseSnapshot: { rawSha256: BASE_SNAPSHOT },
      applicationCatalog: baseSnapshot,
    },
    currentSnapshot: {
      kind: "programmable-website-projection-hosted-catalog-snapshot-v3",
      schemaVersion: 3,
      target: targetIdentity,
      operatorSource: {
        repositoryCommit: "482aba91cd246d605ec0f98d0718dd5fff781d1f",
        repositoryTree: "b65e183f679c97b8152c779d9866aec53202bf4a",
      },
      parentSnapshots: {
        baseRawSha256: BASE_SNAPSHOT,
        expandedRawSha256: EXPANDED_SNAPSHOT,
      },
      observation: {
        databaseName: "postgres",
        serverPort: 5432,
        serverVersionNum: "170006",
        sessionUser: "postgres",
        currentRole: "postgres",
        observedAt: "2026-08-14T05:28:42.903695+00:00",
      },
      roles: [],
      memberships: [],
    },
    expectedProjectRef: "z".repeat(20),
  }), /protected snapshot identity mismatch/u);
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

test("adopt-existing confirmation is distinct and binds plan and target", async () => {
  const workspace = path.resolve(new URL("..", import.meta.url).pathname);
  const plan = await discoverWebsiteProjectionPlan({
    workspace,
    repositoryCommit: COMMIT,
    repositoryTree: TREE,
  });
  assert.doesNotThrow(() => assertWebsiteProjectionAdoptExistingConfirmation({
    plan,
    expectedProjectRef: PROJECT_REF,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
    confirmAdoptExisting: plan.planSha256,
    confirmTarget: PROJECT_REF,
    confirmSourceSnapshot: SOURCE_SNAPSHOT,
    confirmAdoptThrough: "0003",
  }));
  assert.throws(() => assertWebsiteProjectionAdoptExistingConfirmation({
    plan,
    expectedProjectRef: PROJECT_REF,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
    confirmAdoptExisting: `0x${"f".repeat(64)}`,
    confirmTarget: PROJECT_REF,
    confirmSourceSnapshot: SOURCE_SNAPSHOT,
    confirmAdoptThrough: "0003",
  }), /adopt-existing confirmation/u);
  assert.throws(() => assertWebsiteProjectionAdoptExistingConfirmation({
    plan,
    expectedProjectRef: PROJECT_REF,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
    confirmAdoptExisting: plan.planSha256,
    confirmTarget: "z".repeat(20),
    confirmSourceSnapshot: SOURCE_SNAPSHOT,
    confirmAdoptThrough: "0003",
  }), /adopt-existing target/u);
  assert.throws(() => assertWebsiteProjectionAdoptExistingConfirmation({
    plan,
    expectedProjectRef: PROJECT_REF,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
    confirmAdoptExisting: plan.planSha256,
    confirmTarget: PROJECT_REF,
    confirmSourceSnapshot: `0x${"e".repeat(64)}`,
    confirmAdoptThrough: "0003",
  }), /source snapshot/u);
  assert.throws(() => assertWebsiteProjectionAdoptExistingConfirmation({
    plan,
    expectedProjectRef: PROJECT_REF,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
    confirmAdoptExisting: plan.planSha256,
    confirmTarget: PROJECT_REF,
    confirmSourceSnapshot: SOURCE_SNAPSHOT,
    confirmAdoptThrough: "0005",
  }), /through confirmation/u);
});

function pgliteSql(client, { beforeStatement, afterRows } = {}) {
  const sql = {
    unsafe(statement, parameters = []) {
      beforeStatement?.(statement);
      const normalized = statement.trimStart().toLowerCase();
      const operation = (parameters.length > 0
        || normalized.startsWith("select")
        || normalized.startsWith("with"))
        ? client.query(statement, parameters).then(({ rows }) => rows)
        : client.exec(statement).then((results) => results.at(-1)?.rows ?? []);
      const transformed = operation.then((resultRows) =>
        afterRows?.(statement, resultRows) ?? resultRows);
      transformed.simple = () => transformed;
      return transformed;
    },
    async begin(callback) {
      return await client.transaction(async (transaction) =>
        callback(pgliteSql(transaction, { beforeStatement, afterRows })));
    },
  };
  return sql;
}

async function pgliteOperatorFixture(t) {
  const database = new PGlite();
  t.after(() => database.close());
  await database.exec(`
    CREATE ROLE supabase_admin SUPERUSER NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE authenticator NOLOGIN;
    GRANT anon, authenticated, service_role TO authenticator;
  `);
  const [identity] = (await database.query(`
    SELECT pg_backend_pid() AS backend_pid,
           session_user::text AS session_user,
           current_role::text AS current_role
  `)).rows;
  const workspace = path.resolve(new URL("..", import.meta.url).pathname);
  return {
    database,
    sql: pgliteSql(database),
    workspace,
    plan: await discoverWebsiteProjectionPlan({
      workspace,
      repositoryCommit: COMMIT,
      repositoryTree: TREE,
    }),
    sessionIdentity: {
      backendPid: Number(identity.backend_pid),
      sessionUser: identity.session_user,
      currentRole: identity.current_role,
    },
  };
}

async function pgliteExistingApplicationFixture(t) {
  const fixture = await pgliteOperatorFixture(t);
  await fixture.database.exec(`
    CREATE ROLE programmable_website_projection_runtime WITH
      LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      PASSWORD 'correct horse battery staple 2026';
    SET ROLE supabase_admin;
    GRANT programmable_website_projection_runtime TO postgres
      WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    RESET ROLE;
  `);
  for (const migration of fixture.plan.migrations.slice(0, 3)) {
    const source = await readFile(
      path.join(fixture.workspace, migration.file),
      "utf8",
    );
    await fixture.database.exec(unwrapWebsiteProjectionMigration(source));
  }
  await fixture.database.exec(`
    REVOKE ALL ON SCHEMA programmable_website_projection_v1
      FROM PUBLIC, anon, authenticated, service_role,
           programmable_website_projection_runtime;
    GRANT USAGE ON SCHEMA programmable_website_projection_v1
      TO programmable_website_projection_runtime;
    REVOKE ALL ON ALL TABLES IN SCHEMA programmable_website_projection_v1
      FROM PUBLIC, anon, authenticated, service_role,
           programmable_website_projection_runtime;
    GRANT SELECT, INSERT
      ON programmable_website_projection_v1.projection_records,
         programmable_website_projection_v1.credential_uses,
         programmable_website_projection_v1.registry_custom_launch_records
      TO programmable_website_projection_runtime;
    GRANT UPDATE (
      lifecycle_generation, lifecycle_state, lifecycle_binding_hash,
      observed_at, canonical_materialization, canonical_public_record,
      record_binding_hash, launch_security_binding_hash,
      launching_wallet_namespace, launching_wallet_value, updated_at
    ) ON programmable_website_projection_v1.registry_custom_launch_records
      TO programmable_website_projection_runtime;
  `);
  fixture.sql = pgliteSql(fixture.database, { afterRows: pgliteHostedRows });
  return fixture;
}

function pgliteHostedRows(statement, resultRows) {
  if (!statement.includes("/* website-projection:memberships */")) {
    return resultRows;
  }
  return resultRows.map((row) =>
    row.member_name === "postgres"
      && row.role_name === "programmable_website_projection_runtime"
      ? { ...row, grantor_name: "supabase_admin" }
      : row);
}

function lockRejectedSql(sql, sessionIdentity) {
  return {
    ...sql,
    unsafe(statement, parameters = []) {
      if (statement.includes("/* website-projection:lock */")) {
        const operation = Promise.resolve([{
          acquired: false,
          backend_pid: sessionIdentity.backendPid,
          session_user: sessionIdentity.sessionUser,
          current_role: sessionIdentity.currentRole,
        }]);
        operation.simple = () => operation;
        return operation;
      }
      return sql.unsafe(statement, parameters);
    },
  };
}

function pgliteAdoptionAuditOptions() {
  return {
    protectedSnapshots: {
      sourceSnapshotSha256: SOURCE_SNAPSHOT,
      expandedSnapshotSha256: EXPANDED_SNAPSHOT,
      baseSnapshotSha256: BASE_SNAPSHOT,
      expandedSnapshot: {},
      currentSnapshot: {},
    },
    legacyInventoryReader: async () => ({ fixture: true }),
    liveInventoryValidator({ sourceData }) {
      const expected = [
        { relation_name: "credential_uses", has_rows: false },
        { relation_name: "projection_records", has_rows: false },
        { relation_name: "registry_custom_launch_records", has_rows: false },
      ];
      if (JSON.stringify(sourceData.rowPresence) !== JSON.stringify(expected)) {
        throw new Error("adopt-existing rejects unproven application data");
      }
    },
  };
}

test("runtime role bootstrap rolls back with a failed first migration", async (t) => {
  const fixture = await pgliteOperatorFixture(t);
  let bootstrapObserved = false;
  let firstMigrationObserved = false;
  const failingSql = pgliteSql(fixture.database, {
    beforeStatement(statement) {
      if (statement.includes("CREATE ROLE programmable_website_projection_runtime")) {
        bootstrapObserved = true;
      }
      if (statement.includes("CREATE SCHEMA programmable_website_projection_migrations")) {
        firstMigrationObserved = true;
        throw new Error("injected failure after runtime role bootstrap");
      }
    },
  });
  await assert.rejects(applyWebsiteProjectionMigrations({
    sql: failingSql,
    workspace: fixture.workspace,
    plan: fixture.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
    runtimePassword: "correct horse battery staple 2026",
  }), /injected failure after runtime role bootstrap/u);
  assert.equal(bootstrapObserved, true);
  assert.equal(firstMigrationObserved, true);
  const role = await fixture.database.query(`
    SELECT rolname FROM pg_roles
     WHERE rolname = 'programmable_website_projection_runtime'
  `);
  assert.deepEqual(role.rows, []);
  const schemas = await fixture.database.query(`
    SELECT nspname FROM pg_namespace
     WHERE nspname IN (
       'programmable_website_projection_v1',
       'programmable_website_projection_migrations'
     )
     ORDER BY nspname
  `);
  assert.deepEqual(schemas.rows, []);
});

test("database operator bootstraps, applies, resumes and detects catalog drift", async (t) => {
  const { database, sql, workspace, plan, sessionIdentity } =
    await pgliteOperatorFixture(t);
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
    "0001", "0002", "0003", "0004", "0005", "0006",
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

test("adopt-existing records exact evidence atomically without replaying application DDL", async (t) => {
  const fixture = await pgliteExistingApplicationFixture(t);
  const targetStatements = [];
  const trackedSql = pgliteSql(fixture.database, {
    beforeStatement(statement) {
      targetStatements.push(statement);
    },
    afterRows: pgliteHostedRows,
  });
  const reference = await buildCanonicalWebsiteProjectionAdoptionReference({
    workspace: fixture.workspace,
    plan: fixture.plan,
  });
  const adopted = await adoptExistingWebsiteProjectionDatabase({
    ...pgliteAdoptionAuditOptions(),
    sql: trackedSql,
    workspace: fixture.workspace,
    plan: fixture.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
    canonicalReference: reference,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
  });
  assert.equal(adopted.status, "pending");
  assert.equal(adopted.appliedCount, 3);
  assert.equal(adopted.adoptedExisting, true);
  assert.deepEqual(adopted.adoptedThisRun, [
    "0001", "0002", "0003",
  ]);
  assert.match(adopted.catalogSha256, /^0x[0-9a-f]{64}$/u);
  assert.match(adopted.adoptionDataSha256, /^0x[0-9a-f]{64}$/u);
  assert.equal(targetStatements.some((statement) =>
    /(?:CREATE|ALTER|DROP)\s+(?:TABLE|FUNCTION|TRIGGER|POLICY|INDEX)\s+programmable_website_projection_v1/iu
      .test(statement)), false);

  const evidence = await fixture.database.query(`
    SELECT evidence_kind, adoption_source_catalog_sha256,
           adoption_source_data_sha256, adoption_source_snapshot_sha256,
           adoption_attestation_sha256
      FROM programmable_website_projection_migrations.migration_evidence_v1
     ORDER BY ordinal
  `);
  assert.equal(evidence.rows.length, 3);
  assert.ok(evidence.rows.every(({ evidence_kind }) =>
    evidence_kind === "adopted-existing-prefix-v1"));
  assert.ok(evidence.rows.every(({ adoption_source_snapshot_sha256 }) =>
    adoption_source_snapshot_sha256 === SOURCE_SNAPSHOT));
  assert.ok(evidence.rows.every(({ adoption_source_catalog_sha256 }) =>
    adoption_source_catalog_sha256 === adopted.adoptionSourceCatalogSha256));
  assert.ok(evidence.rows.every(({ adoption_source_data_sha256 }) =>
    adoption_source_data_sha256 === adopted.adoptionDataSha256));
  assert.ok(evidence.rows.every(({ adoption_attestation_sha256 }) =>
    adoption_attestation_sha256 === adopted.adoptionAttestationSha256));
  const adoptionEvidence = await fixture.database.query(`
    SELECT evidence_kind, adopted_through_version,
           source_snapshot_sha256, expanded_snapshot_sha256,
           base_snapshot_sha256,
           credential_uses_count, projection_records_count,
           registry_custom_launch_records_count,
           runtime_rolinherit_before, runtime_rolinherit_after
      FROM programmable_website_projection_migrations.adoption_evidence_v1
  `);
  assert.deepEqual(adoptionEvidence.rows, [{
    evidence_kind: "adopted-existing-prefix-v1",
    adopted_through_version: "0003",
    source_snapshot_sha256: SOURCE_SNAPSHOT,
    expanded_snapshot_sha256: EXPANDED_SNAPSHOT,
    base_snapshot_sha256: BASE_SNAPSHOT,
    credential_uses_count: 0,
    projection_records_count: 0,
    registry_custom_launch_records_count: 0,
    runtime_rolinherit_before: true,
    runtime_rolinherit_after: false,
  }]);

  const continued = await applyWebsiteProjectionMigrations({
    sql: fixture.sql,
    workspace: fixture.workspace,
    plan: fixture.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
  });
  assert.equal(continued.status, "current");
  assert.deepEqual(continued.appliedThisRun, ["0004", "0005", "0006"]);
});

test("exact retained 0001-0005 adoption evidence advances only through 0006", async (t) => {
  const fixture = await pgliteExistingApplicationFixture(t);
  const successorPlan = fixture.plan;
  const predecessorPlan = retainedPlan(successorPlan);
  await adoptExistingWebsiteProjectionDatabase({
    ...pgliteAdoptionAuditOptions(),
    sql: fixture.sql,
    workspace: fixture.workspace,
    plan: predecessorPlan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
  });
  const predecessorApply = await applyWebsiteProjectionMigrations({
    sql: fixture.sql,
    workspace: fixture.workspace,
    plan: predecessorPlan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
  });
  assert.deepEqual(predecessorApply.appliedThisRun, ["0004", "0005"]);
  const retainedAdoption = (await fixture.database.query(`
    SELECT successor_plan_sha256, successor_order_sha256,
           successor_repository_commit, successor_repository_tree,
           attestation_sha256
      FROM programmable_website_projection_migrations.adoption_evidence_v1
  `)).rows[0];

  const pending = await inspectWebsiteProjectionDatabase({
    sql: fixture.sql,
    plan: successorPlan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
  });
  assert.deepEqual(pending.pending.map(({ version }) => version), ["0006"]);
  const advanced = await applyWebsiteProjectionMigrations({
    sql: fixture.sql,
    workspace: fixture.workspace,
    plan: successorPlan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
  });
  assert.deepEqual(advanced.appliedThisRun, ["0006"]);
  assert.equal(advanced.status, "current");

  const evidence = await fixture.database.query(`
    SELECT ordinal::integer, plan_sha256, repository_commit, repository_tree
      FROM programmable_website_projection_migrations.migration_evidence_v1
     ORDER BY ordinal
  `);
  assert.deepEqual(evidence.rows.slice(0, 5).map(({ plan_sha256 }) => plan_sha256),
    Array(5).fill(WEBSITE_PROJECTION_RETAINED_PLAN_SHA256));
  assert.deepEqual(evidence.rows.slice(0, 5).map(({ repository_commit }) =>
    repository_commit), Array(5).fill(WEBSITE_PROJECTION_RETAINED_PLAN_COMMIT));
  assert.deepEqual(evidence.rows[5], {
    ordinal: 6,
    plan_sha256: successorPlan.planSha256,
    repository_commit: successorPlan.repositoryCommit,
    repository_tree: successorPlan.repositoryTree,
  });
  const currentAdoption = (await fixture.database.query(`
    SELECT successor_plan_sha256, successor_order_sha256,
           successor_repository_commit, successor_repository_tree,
           attestation_sha256
      FROM programmable_website_projection_migrations.adoption_evidence_v1
  `)).rows[0];
  assert.deepEqual(currentAdoption, retainedAdoption);

  const privileges = (await fixture.database.query(`
    SELECT
      has_table_privilege('programmable_website_projection_runtime',
        'programmable_website_projection_v1.gmgn_account_gate_v1',
        'SELECT') AS gate_select,
      (
        has_column_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'generation', 'UPDATE')
        AND has_column_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'next_slot_at', 'UPDATE')
        AND has_column_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'blocked_until', 'UPDATE')
        AND has_column_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'lease_holder', 'UPDATE')
        AND has_column_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'lease_until', 'UPDATE')
        AND has_column_privilege('programmable_website_projection_runtime',
          'programmable_website_projection_v1.gmgn_account_gate_v1',
          'updated_at', 'UPDATE')
      ) AS gate_update,
      has_column_privilege('programmable_website_projection_runtime',
        'programmable_website_projection_v1.gmgn_account_gate_v1',
        'gate_id', 'UPDATE') AS gate_id_update,
      has_table_privilege('programmable_website_projection_runtime',
        'programmable_website_projection_v1.gmgn_account_gate_v1',
        'INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS gate_forbidden,
      has_table_privilege('programmable_website_projection_runtime',
        'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
        'INSERT') AS history_insert,
      has_table_privilege('programmable_website_projection_runtime',
        'programmable_website_projection_v1.gmgn_account_gate_decisions_v1',
        'SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS history_forbidden
  `)).rows[0];
  assert.deepEqual(privileges, {
    gate_select: true,
    gate_update: true,
    gate_id_update: false,
    gate_forbidden: false,
    history_insert: true,
    history_forbidden: false,
  });
});

test("adopt-existing rejects every nonempty unproven application state", async (t) => {
  const fixture = await pgliteExistingApplicationFixture(t);
  await fixture.database.exec(`
    INSERT INTO programmable_website_projection_v1.credential_uses (
      credential_id, request_binding_hash, canonical_use
    ) VALUES (
      'unproven-row',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '{}'
    );
  `);
  await assert.rejects(adoptExistingWebsiteProjectionDatabase({
    ...pgliteAdoptionAuditOptions(),
    sql: fixture.sql,
    workspace: fixture.workspace,
    plan: fixture.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
  }), /unproven application data/u);
  const evidenceSchema = await fixture.database.query(`
    SELECT to_regnamespace('programmable_website_projection_migrations')::text
      AS evidence_schema
  `);
  assert.equal(evidenceSchema.rows[0].evidence_schema, null);
});

test("adopt-existing rejects forbidden catalog extras", async (t) => {
  const fixture = await pgliteExistingApplicationFixture(t);
  await fixture.database.exec(`
    CREATE TABLE programmable_website_projection_v1.unreviewed_extra (
      id bigint PRIMARY KEY
    );
  `);
  await assert.rejects(adoptExistingWebsiteProjectionDatabase({
    ...pgliteAdoptionAuditOptions(),
    sql: fixture.sql,
    workspace: fixture.workspace,
    plan: fixture.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
  }), /catalog does not exactly match/u);
});

test("adopt-existing rejects partial or existing operator evidence", async (t) => {
  const partial = await pgliteExistingApplicationFixture(t);
  await partial.database.exec(`
    CREATE SCHEMA programmable_website_projection_migrations;
  `);
  await assert.rejects(adoptExistingWebsiteProjectionDatabase({
    ...pgliteAdoptionAuditOptions(),
    sql: partial.sql,
    workspace: partial.workspace,
    plan: partial.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: partial.sessionIdentity,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
  }), /evidence infrastructure is partial/u);

  const existing = await pgliteOperatorFixture(t);
  await applyWebsiteProjectionMigrations({
    sql: existing.sql,
    workspace: existing.workspace,
    plan: existing.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: existing.sessionIdentity,
    runtimePassword: "correct horse battery staple 2026",
  });
  await assert.rejects(adoptExistingWebsiteProjectionDatabase({
    ...pgliteAdoptionAuditOptions(),
    sql: existing.sql,
    workspace: existing.workspace,
    plan: existing.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: existing.sessionIdentity,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
  }), /operator evidence must be absent/u);
});

test("adopt-existing rejects grant drift before writing evidence", async (t) => {
  const fixture = await pgliteExistingApplicationFixture(t);
  await fixture.database.exec(`
    GRANT UPDATE ON programmable_website_projection_v1.projection_records
      TO programmable_website_projection_runtime;
  `);
  await assert.rejects(adoptExistingWebsiteProjectionDatabase({
    ...pgliteAdoptionAuditOptions(),
    sql: fixture.sql,
    workspace: fixture.workspace,
    plan: fixture.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
  }), /catalog does not exactly match/u);
});

test("adopt-existing permits only the reviewed runtime INHERIT drift", async (t) => {
  const fixture = await pgliteExistingApplicationFixture(t);
  await fixture.database.exec(`
    ALTER ROLE programmable_website_projection_runtime CREATEDB;
  `);
  await assert.rejects(adoptExistingWebsiteProjectionDatabase({
    ...pgliteAdoptionAuditOptions(),
    sql: fixture.sql,
    workspace: fixture.workspace,
    plan: fixture.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
  }), /source runtime role posture/u);
});

test("adopt-existing fails closed when another operator owns the lock", async (t) => {
  const fixture = await pgliteExistingApplicationFixture(t);
  await assert.rejects(adoptExistingWebsiteProjectionDatabase({
    ...pgliteAdoptionAuditOptions(),
    sql: lockRejectedSql(fixture.sql, fixture.sessionIdentity),
    workspace: fixture.workspace,
    plan: fixture.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
  }), /another website projection migration operator holds the lock/u);
});

test("adopt-existing rolls back evidence DDL and rows on failure", async (t) => {
  const fixture = await pgliteExistingApplicationFixture(t);
  let insertObserved = false;
  const failingSql = pgliteSql(fixture.database, {
    beforeStatement(statement) {
      if (statement.includes("INSERT INTO programmable_website_projection_migrations.migration_evidence_v1")) {
        insertObserved = true;
        throw new Error("injected adoption evidence failure");
      }
    },
    afterRows: pgliteHostedRows,
  });
  await assert.rejects(adoptExistingWebsiteProjectionDatabase({
    ...pgliteAdoptionAuditOptions(),
    sql: failingSql,
    workspace: fixture.workspace,
    plan: fixture.plan,
    expectedProjectRef: PROJECT_REF,
    sessionIdentity: fixture.sessionIdentity,
    expectedSourceSnapshotSha256: SOURCE_SNAPSHOT,
  }), /injected adoption evidence failure/u);
  assert.equal(insertObserved, true);
  const evidenceSchema = await fixture.database.query(`
    SELECT to_regnamespace('programmable_website_projection_migrations')::text
      AS evidence_schema
  `);
  assert.equal(evidenceSchema.rows[0].evidence_schema, null);
  const runtimeRole = await fixture.database.query(`
    SELECT rolinherit
      FROM pg_roles
     WHERE rolname = 'programmable_website_projection_runtime'
  `);
  assert.deepEqual(runtimeRole.rows, [{ rolinherit: true }]);
  const relations = await fixture.database.query(`
    SELECT count(*)::integer AS relation_count
      FROM pg_class class
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'programmable_website_projection_v1'
       AND class.relkind = 'r'
  `);
  assert.equal(relations.rows[0].relation_count, 3);
});
