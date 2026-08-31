import { constants as fsConstants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";

import {
  assertWebsiteProjectionAdoptionSourcePlan,
  assertWebsiteProjectionAdoptionSourceRoleGraph,
  assertWebsiteProjectionRoleGraph,
  catalogSnapshotSha256,
  compareWebsiteProjectionEvidence,
  unwrapWebsiteProjectionMigration,
  validateWebsiteProjectionPlan,
  validateWebsiteProjectionRuntimePassword,
  websiteProjectionAdoptionAttestationSha256,
  WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT,
  WEBSITE_PROJECTION_ADOPTION_BASE_SNAPSHOT_SHA256,
  WEBSITE_PROJECTION_ADOPTION_CURRENT_OPERATOR_COMMIT,
  WEBSITE_PROJECTION_ADOPTION_CURRENT_OPERATOR_TREE,
  WEBSITE_PROJECTION_ADOPTION_EXPANDED_SNAPSHOT_SHA256,
  WEBSITE_PROJECTION_ADOPTION_LEGACY_INVENTORY_SHA256,
  WEBSITE_PROJECTION_ADOPTION_LEGACY_PUBLIC_SHA256,
  WEBSITE_PROJECTION_ADOPTION_SOURCE_COMMIT,
  WEBSITE_PROJECTION_ADOPTION_SOURCE_ORDER_SHA256,
  WEBSITE_PROJECTION_ADOPTION_SOURCE_PLAN_SHA256,
  WEBSITE_PROJECTION_ADOPTION_SOURCE_SNAPSHOT_SHA256,
  WEBSITE_PROJECTION_ADOPTION_SOURCE_TREE,
  WEBSITE_PROJECTION_ADOPTION_TARGET_PROJECT_REF,
  WEBSITE_PROJECTION_APPLICATION_SCHEMA,
  WEBSITE_PROJECTION_EVIDENCE_SCHEMA,
  WEBSITE_PROJECTION_EVIDENCE_TABLE,
  WEBSITE_PROJECTION_RUNTIME_ROLE,
} from "./website-projection-db-operator-core.mjs";
import {
  canonicalJson,
  sha256,
} from "./data-pipeline/hosted-db-operator-core.mjs";

const OPERATOR_LOCK = "programmable:website-projection-migrations:v1";
const RELEVANT_ROLES = [
  "postgres",
  WEBSITE_PROJECTION_RUNTIME_ROLE,
  "anon",
  "authenticated",
  "service_role",
];
const EXTENDED_ROLE_NAMES = [
  "anon",
  "authenticated",
  "postgres",
  WEBSITE_PROJECTION_RUNTIME_ROLE,
  "service_role",
  "supabase_admin",
];
const LEGACY_EVIDENCE_RELATIONS = Object.freeze([
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
]);

const EVIDENCE_DDL = `
CREATE SCHEMA programmable_website_projection_migrations;
REVOKE ALL ON SCHEMA programmable_website_projection_migrations FROM PUBLIC;
REVOKE ALL ON SCHEMA programmable_website_projection_migrations
  FROM anon, authenticated, service_role, programmable_website_projection_runtime;

CREATE TABLE programmable_website_projection_migrations.migration_evidence_v1 (
  ordinal integer NOT NULL,
  version text NOT NULL,
  name text NOT NULL,
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  execution_sha256 text NOT NULL,
  plan_sha256 text NOT NULL,
  repository_commit text NOT NULL,
  repository_tree text NOT NULL,
  target_project_ref text NOT NULL,
  catalog_sha256 text NOT NULL,
  operator_catalog_sha256 text NOT NULL,
  evidence_kind text NOT NULL,
  adoption_source_snapshot_sha256 text,
  adoption_source_catalog_sha256 text,
  adoption_source_data_sha256 text,
  adoption_attestation_sha256 text,
  adoption_operator_commit text,
  adoption_operator_tree text,
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT migration_evidence_v1_pk PRIMARY KEY (ordinal),
  CONSTRAINT migration_evidence_v1_version_unique UNIQUE (version),
  CONSTRAINT migration_evidence_v1_file_unique UNIQUE (file_name),
  CONSTRAINT migration_evidence_v1_ordinal_check CHECK (ordinal BETWEEN 1 AND 6),
  CONSTRAINT migration_evidence_v1_version_check CHECK (version ~ '^000[1-6]$'),
  CONSTRAINT migration_evidence_v1_file_hash_check
    CHECK (file_sha256 ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT migration_evidence_v1_execution_hash_check
    CHECK (execution_sha256 ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT migration_evidence_v1_plan_hash_check
    CHECK (plan_sha256 ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT migration_evidence_v1_commit_check
    CHECK (repository_commit ~ '^[0-9a-f]{40}$'),
  CONSTRAINT migration_evidence_v1_tree_check
    CHECK (repository_tree ~ '^[0-9a-f]{40}$'),
  CONSTRAINT migration_evidence_v1_project_ref_check
    CHECK (target_project_ref ~ '^[a-z0-9]{20}$'),
  CONSTRAINT migration_evidence_v1_catalog_hash_check
    CHECK (catalog_sha256 ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT migration_evidence_v1_operator_catalog_hash_check
    CHECK (operator_catalog_sha256 ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT migration_evidence_v1_kind_check CHECK (
    evidence_kind IN ('applied', 'adopted-existing-prefix-v1')
  ),
  CONSTRAINT migration_evidence_v1_adoption_check CHECK (
    (
      evidence_kind = 'applied'
      AND adoption_source_snapshot_sha256 IS NULL
      AND adoption_source_catalog_sha256 IS NULL
      AND adoption_source_data_sha256 IS NULL
      AND adoption_attestation_sha256 IS NULL
      AND adoption_operator_commit IS NULL
      AND adoption_operator_tree IS NULL
    ) OR (
      evidence_kind = 'adopted-existing-prefix-v1'
      AND ordinal BETWEEN 1 AND 3
      AND adoption_source_snapshot_sha256 =
        '0x917afa0f6bcd19f00f5d2ce5cd0d8221ef00ad6716460af11bff0906e4b9a0f9'
      AND adoption_source_catalog_sha256 ~ '^0x[0-9a-f]{64}$'
      AND adoption_source_data_sha256 ~ '^0x[0-9a-f]{64}$'
      AND adoption_attestation_sha256 ~ '^0x[0-9a-f]{64}$'
      AND adoption_operator_commit ~ '^[0-9a-f]{40}$'
      AND adoption_operator_tree ~ '^[0-9a-f]{40}$'
    )
  )
);

CREATE TABLE programmable_website_projection_migrations.adoption_evidence_v1 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  evidence_kind text NOT NULL CHECK (
    evidence_kind = 'adopted-existing-prefix-v1'
  ),
  adopted_through_version text NOT NULL CHECK (
    adopted_through_version = '0003'
  ),
  source_snapshot_sha256 text NOT NULL CHECK (
    source_snapshot_sha256 =
      '0x917afa0f6bcd19f00f5d2ce5cd0d8221ef00ad6716460af11bff0906e4b9a0f9'
  ),
  expanded_snapshot_sha256 text NOT NULL CHECK (
    expanded_snapshot_sha256 =
      '0x8cb9841f0131b48fb67eac0082d72f51158500a61482c0b21e0c7b7cc2f19284'
  ),
  base_snapshot_sha256 text NOT NULL CHECK (
    base_snapshot_sha256 =
      '0xac4a1fe60ebf677865a0f8ca6160162d9c457dc2bd401aa60fd820c8f2fdcc58'
  ),
  legacy_inventory_sha256 text NOT NULL CHECK (
    legacy_inventory_sha256 =
      '0xd32953874c1466be82433d97e6532d0572ddcf80eed261efa119b25f17e0f5b3'
  ),
  legacy_public_sha256 text NOT NULL CHECK (
    legacy_public_sha256 =
      '0x93e41eab957ab8add897a8b277bcaaa0a5f10eebeb27f47db5bc0e59640484a2'
  ),
  source_catalog_sha256 text NOT NULL CHECK (
    source_catalog_sha256 ~ '^0x[0-9a-f]{64}$'
  ),
  corrected_catalog_sha256 text NOT NULL CHECK (
    corrected_catalog_sha256 ~ '^0x[0-9a-f]{64}$'
  ),
  source_data_sha256 text NOT NULL CHECK (
    source_data_sha256 ~ '^0x[0-9a-f]{64}$'
  ),
  operator_catalog_sha256 text NOT NULL CHECK (
    operator_catalog_sha256 ~ '^0x[0-9a-f]{64}$'
  ),
  attestation_sha256 text NOT NULL CHECK (
    attestation_sha256 ~ '^0x[0-9a-f]{64}$'
  ),
  source_plan_sha256 text NOT NULL CHECK (
    source_plan_sha256 =
      '0xf0fc7bca18c16da02be83f75d25e404bfe0b7ec7f10c29ecfbea93fcb0d7e973'
  ),
  source_order_sha256 text NOT NULL CHECK (
    source_order_sha256 =
      '0xce50954bfa6ff3b66b849bb5b53e8f1adf93abbe12cf865c19375100f2571cc2'
  ),
  source_repository_commit text NOT NULL CHECK (
    source_repository_commit =
      '76ebd54e2f0e31d055cfe6c36b7474b0e850de90'
  ),
  source_repository_tree text NOT NULL CHECK (
    source_repository_tree =
      '8e4ddd9a73818ce70f1284f3b2731bc87b005f27'
  ),
  successor_plan_sha256 text NOT NULL CHECK (
    successor_plan_sha256 ~ '^0x[0-9a-f]{64}$'
  ),
  successor_order_sha256 text NOT NULL CHECK (
    successor_order_sha256 = '__SUCCESSOR_ORDER_SHA256__'
  ),
  successor_repository_commit text NOT NULL CHECK (
    successor_repository_commit ~ '^[0-9a-f]{40}$'
  ),
  successor_repository_tree text NOT NULL CHECK (
    successor_repository_tree ~ '^[0-9a-f]{40}$'
  ),
  target_project_ref text NOT NULL CHECK (
    target_project_ref ~ '^[a-z0-9]{20}$'
  ),
  operator_commit text NOT NULL CHECK (
    operator_commit ~ '^[0-9a-f]{40}$'
  ),
  operator_tree text NOT NULL CHECK (
    operator_tree ~ '^[0-9a-f]{40}$'
  ),
  credential_uses_count bigint NOT NULL CHECK (credential_uses_count = 0),
  projection_records_count bigint NOT NULL CHECK (projection_records_count = 0),
  registry_custom_launch_records_count bigint NOT NULL CHECK (
    registry_custom_launch_records_count = 0
  ),
  runtime_rolinherit_before boolean NOT NULL CHECK (runtime_rolinherit_before),
  runtime_rolinherit_after boolean NOT NULL CHECK (NOT runtime_rolinherit_after),
  adopted_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
REVOKE ALL ON programmable_website_projection_migrations.migration_evidence_v1
  FROM PUBLIC, anon, authenticated, service_role,
       programmable_website_projection_runtime;
REVOKE ALL ON programmable_website_projection_migrations.adoption_evidence_v1
  FROM PUBLIC, anon, authenticated, service_role,
       programmable_website_projection_runtime;
`;

const EVIDENCE_0006_DDL = `
ALTER TABLE programmable_website_projection_migrations.migration_evidence_v1
  DROP CONSTRAINT migration_evidence_v1_ordinal_check,
  DROP CONSTRAINT migration_evidence_v1_version_check,
  ADD CONSTRAINT migration_evidence_v1_ordinal_check
    CHECK (ordinal BETWEEN 1 AND 6),
  ADD CONSTRAINT migration_evidence_v1_version_check
    CHECK (version ~ '^000[1-6]$');
`;

function evidenceDdl(plan) {
  validateWebsiteProjectionPlan(plan);
  return EVIDENCE_DDL.replace(
    "__SUCCESSOR_ORDER_SHA256__",
    plan.orderSha256,
  );
}

const FINAL_PRIVILEGES = `
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
     programmable_website_projection_v1.registry_custom_launch_records,
     programmable_website_projection_v1.generic_launch_materializations_v2,
     programmable_website_projection_v1.generic_launch_reconciliations_v2,
     programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  TO programmable_website_projection_runtime;
GRANT UPDATE (
  lifecycle_generation, lifecycle_state, lifecycle_binding_hash,
  observed_at, canonical_materialization, canonical_public_record,
  record_binding_hash, launch_security_binding_hash,
  launching_wallet_namespace, launching_wallet_value, updated_at
) ON programmable_website_projection_v1.registry_custom_launch_records
  TO programmable_website_projection_runtime;
GRANT UPDATE (
  outcome, observation_common_head, observation_common_head_hash, observed_at
) ON programmable_website_projection_v1.generic_launch_reconciliations_v2
  TO programmable_website_projection_runtime;
GRANT UPDATE (attempted_at)
  ON programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2
  TO programmable_website_projection_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA programmable_website_projection_v1
  FROM PUBLIC, anon, authenticated, service_role,
       programmable_website_projection_runtime;
GRANT EXECUTE ON FUNCTION
  programmable_website_projection_v1.enforce_approval_v3_capacity_v1()
  TO programmable_website_projection_runtime;
`;

const FINAL_GMGN_PRIVILEGES = `
GRANT SELECT
  ON programmable_website_projection_v1.gmgn_account_gate_v1
  TO programmable_website_projection_runtime;
GRANT UPDATE (
  generation, next_slot_at, blocked_until, lease_holder, lease_until, updated_at
) ON programmable_website_projection_v1.gmgn_account_gate_v1
  TO programmable_website_projection_runtime;
GRANT INSERT
  ON programmable_website_projection_v1.gmgn_account_gate_decisions_v1
  TO programmable_website_projection_runtime;
`;

// The already-hosted through-0003 source received this deliberately narrower
// grant set after migration 0003. It is part of the protected source state,
// not a sixth migration and not permission to install any 0004/0005 objects.
const ADOPTION_PREFIX_PRIVILEGES = `
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
`;

function rows(value) {
  return Array.isArray(value) ? value.map((row) => ({ ...row })) : [];
}

function plainObject(value) {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactJson(actual, expected, message) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(message);
  }
}

async function readProtectedSnapshotFile(filePath, expectedSha256, label) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error(`${label} path must be absolute`);
  }
  let handle;
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const metadata = await handle.stat();
    if (!metadata.isFile()
      || (metadata.mode & 0o777) !== 0o600
      || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
      throw new Error(`${label} must be an owner-only regular file`);
    }
    const contents = await handle.readFile();
    if (sha256(contents) !== expectedSha256) {
      throw new Error(`${label} raw hash mismatch`);
    }
    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contents));
    } catch {
      throw new Error(`${label} must contain valid UTF-8 JSON`);
    }
    if (!plainObject(value)) throw new Error(`${label} JSON is invalid`);
    return value;
  } finally {
    await handle?.close();
  }
}

function expectedSourceIdentity(value) {
  return plainObject(value)
    && value.repositoryCommit === WEBSITE_PROJECTION_ADOPTION_SOURCE_COMMIT
    && value.repositoryTree === WEBSITE_PROJECTION_ADOPTION_SOURCE_TREE
    && value.planSha256 === WEBSITE_PROJECTION_ADOPTION_SOURCE_PLAN_SHA256;
}

function expectedTargetIdentity(value, expectedProjectRef) {
  return plainObject(value)
    && expectedProjectRef === WEBSITE_PROJECTION_ADOPTION_TARGET_PROJECT_REF
    && value.projectRef === expectedProjectRef
    && value.host === `db.${expectedProjectRef}.supabase.co`
    && Number(value.port) === 5432
    && value.database === "postgres"
    && value.sslMode === "verify-full";
}

function assertCurrentSnapshotRoleAndMembershipInventory(currentSnapshot) {
  if (!Array.isArray(currentSnapshot.roles)
    || currentSnapshot.roles.length !== 36
    || !Array.isArray(currentSnapshot.memberships)
    || currentSnapshot.memberships.length !== 50) {
    throw new Error("adopt-existing current snapshot inventory size mismatch");
  }
  const roleNames = [];
  for (const role of currentSnapshot.roles) {
    if (!plainObject(role)
      || typeof role.rolname !== "string"
      || role.rolname === ""
      || typeof role.rolsuper !== "boolean"
      || typeof role.rolinherit !== "boolean"
      || typeof role.rolcreaterole !== "boolean"
      || typeof role.rolcreatedb !== "boolean"
      || typeof role.rolcanlogin !== "boolean"
      || typeof role.rolreplication !== "boolean"
      || !Number.isSafeInteger(role.rolconnlimit)
      || !(role.rolvaliduntil === null
        || typeof role.rolvaliduntil === "string")
      || typeof role.rolbypassrls !== "boolean"
      || !(role.rolconfig === null
        || (Array.isArray(role.rolconfig)
          && role.rolconfig.every((entry) => typeof entry === "string")))) {
      throw new Error("adopt-existing current snapshot role inventory is invalid");
    }
    roleNames.push(role.rolname);
  }
  if (new Set(roleNames).size !== roleNames.length
    || canonicalJson(roleNames) !== canonicalJson([...roleNames].sort())) {
    throw new Error("adopt-existing current snapshot roles are not unique and sorted");
  }
  const roleNameSet = new Set(roleNames);
  const membershipKeys = [];
  for (const membership of currentSnapshot.memberships) {
    if (!plainObject(membership)
      || typeof membership.member_name !== "string"
      || typeof membership.role_name !== "string"
      || typeof membership.grantor_name !== "string"
      || typeof membership.admin_option !== "boolean"
      || typeof membership.inherit_option !== "boolean"
      || typeof membership.set_option !== "boolean"
      || !roleNameSet.has(membership.member_name)
      || !roleNameSet.has(membership.role_name)
      || !roleNameSet.has(membership.grantor_name)) {
      throw new Error("adopt-existing current snapshot membership inventory is invalid");
    }
    membershipKeys.push([
      membership.member_name,
      membership.role_name,
      membership.grantor_name,
      String(membership.admin_option),
      String(membership.inherit_option),
      String(membership.set_option),
    ].join("\0"));
  }
  if (new Set(membershipKeys).size !== membershipKeys.length
    || canonicalJson(membershipKeys)
      !== canonicalJson([...membershipKeys].sort())) {
    throw new Error(
      "adopt-existing current snapshot memberships are not unique and sorted",
    );
  }
}

export function assertWebsiteProjectionAdoptionProtectedSnapshots({
  baseSnapshot,
  expandedSnapshot,
  currentSnapshot,
  expectedProjectRef,
}) {
  if (!plainObject(baseSnapshot)
    || baseSnapshot.kind
      !== "programmable-website-projection-hosted-catalog-snapshot-v1"
    || !expectedSourceIdentity(baseSnapshot.source)
    || !expectedTargetIdentity(baseSnapshot.target, expectedProjectRef)
    || !plainObject(expandedSnapshot)
    || expandedSnapshot.kind
      !== "programmable-website-projection-hosted-catalog-snapshot-v2"
    || expandedSnapshot.schemaVersion !== 2
    || !expectedSourceIdentity(expandedSnapshot.source)
    || !expectedTargetIdentity(expandedSnapshot.target, expectedProjectRef)
    || expandedSnapshot.baseSnapshot?.rawSha256
      !== WEBSITE_PROJECTION_ADOPTION_BASE_SNAPSHOT_SHA256
    || canonicalJson(expandedSnapshot.applicationCatalog)
      !== canonicalJson(baseSnapshot)
    || !plainObject(currentSnapshot)
    || currentSnapshot.kind
      !== "programmable-website-projection-hosted-catalog-snapshot-v3"
    || currentSnapshot.schemaVersion !== 3
    || !expectedTargetIdentity(currentSnapshot.target, expectedProjectRef)
    || currentSnapshot.operatorSource?.repositoryCommit
      !== WEBSITE_PROJECTION_ADOPTION_CURRENT_OPERATOR_COMMIT
    || currentSnapshot.operatorSource?.repositoryTree
      !== WEBSITE_PROJECTION_ADOPTION_CURRENT_OPERATOR_TREE
    || currentSnapshot.parentSnapshots?.baseRawSha256
      !== WEBSITE_PROJECTION_ADOPTION_BASE_SNAPSHOT_SHA256
    || currentSnapshot.parentSnapshots?.expandedRawSha256
      !== WEBSITE_PROJECTION_ADOPTION_EXPANDED_SNAPSHOT_SHA256
    || currentSnapshot.observation?.databaseName !== "postgres"
    || Number(currentSnapshot.observation?.serverPort) !== 5432
    || !/^\d{6}$/u.test(currentSnapshot.observation?.serverVersionNum ?? "")
    || Number(currentSnapshot.observation.serverVersionNum) < 150000
    || currentSnapshot.observation?.sessionUser !== "postgres"
    || currentSnapshot.observation?.currentRole !== "postgres"
    || typeof currentSnapshot.observation?.observedAt !== "string"
    || !Number.isFinite(Date.parse(currentSnapshot.observation.observedAt))) {
    throw new Error("adopt-existing protected snapshot identity mismatch");
  }
  assertCurrentSnapshotRoleAndMembershipInventory(currentSnapshot);
  const legacy = expandedSnapshot.legacySupabaseInventory;
  if (!plainObject(legacy)
    || legacy.fullCanonicalSha256
      !== WEBSITE_PROJECTION_ADOPTION_LEGACY_INVENTORY_SHA256
    || legacy.publicCanonicalSha256
      !== WEBSITE_PROJECTION_ADOPTION_LEGACY_PUBLIC_SHA256
    || legacy.rowCounts?.schemaMigrations !== 42
    || legacy.rowCounts?.programmableMigrationEvidence !== 42
    || !Array.isArray(legacy.columns)
    || !Array.isArray(legacy.schemaRows)
    || legacy.schemaRows.length !== 42
    || !Array.isArray(legacy.evidenceRows)
    || legacy.evidenceRows.length !== 42
    || sha256(canonicalJson({
      columns: legacy.columns,
      schemaRows: legacy.schemaRows,
      evidenceRows: legacy.evidenceRows,
    })) !== WEBSITE_PROJECTION_ADOPTION_LEGACY_PUBLIC_SHA256
    || !Array.isArray(expandedSnapshot.roleExtended)
    || expandedSnapshot.roleExtended.length !== EXTENDED_ROLE_NAMES.length
    || !Array.isArray(expandedSnapshot.membershipExtended)) {
    throw new Error("adopt-existing protected snapshot content mismatch");
  }
  exactJson(
    expandedSnapshot.roleExtended.map(({ rolname }) => rolname),
    EXTENDED_ROLE_NAMES,
    "adopt-existing protected role inventory mismatch",
  );
  const runtimeEdges = expandedSnapshot.membershipExtended.filter(
    ({ role_name: roleName }) => roleName === WEBSITE_PROJECTION_RUNTIME_ROLE,
  );
  exactJson(runtimeEdges, [{
    member_name: "postgres",
    role_name: WEBSITE_PROJECTION_RUNTIME_ROLE,
    grantor_name: "supabase_admin",
    admin_option: true,
    inherit_option: false,
    set_option: false,
  }], "adopt-existing protected membership inventory mismatch");
  return Object.freeze({
    baseSnapshot,
    expandedSnapshot,
    currentSnapshot,
    sourceSnapshotSha256: WEBSITE_PROJECTION_ADOPTION_SOURCE_SNAPSHOT_SHA256,
    expandedSnapshotSha256:
      WEBSITE_PROJECTION_ADOPTION_EXPANDED_SNAPSHOT_SHA256,
    baseSnapshotSha256: WEBSITE_PROJECTION_ADOPTION_BASE_SNAPSHOT_SHA256,
  });
}

export async function readWebsiteProjectionAdoptionProtectedSnapshots({
  baseSnapshotPath,
  expandedSnapshotPath,
  currentSnapshotPath,
  expectedProjectRef,
}) {
  const [baseSnapshot, expandedSnapshot, currentSnapshot] = await Promise.all([
    readProtectedSnapshotFile(
      baseSnapshotPath,
      WEBSITE_PROJECTION_ADOPTION_BASE_SNAPSHOT_SHA256,
      "adopt-existing base snapshot",
    ),
    readProtectedSnapshotFile(
      expandedSnapshotPath,
      WEBSITE_PROJECTION_ADOPTION_EXPANDED_SNAPSHOT_SHA256,
      "adopt-existing expanded snapshot",
    ),
    readProtectedSnapshotFile(
      currentSnapshotPath,
      WEBSITE_PROJECTION_ADOPTION_SOURCE_SNAPSHOT_SHA256,
      "adopt-existing current snapshot",
    ),
  ]);
  return assertWebsiteProjectionAdoptionProtectedSnapshots({
    baseSnapshot,
    expandedSnapshot,
    currentSnapshot,
    expectedProjectRef,
  });
}

async function queryRows(sql, statement, parameters = []) {
  return rows(await sql.unsafe(statement, parameters));
}

async function executeSimple(sql, statement) {
  const operation = sql.unsafe(statement);
  return await (typeof operation.simple === "function"
    ? operation.simple()
    : operation);
}

function capturedSession(row) {
  const backendPid = Number(row?.backend_pid);
  if (!Number.isSafeInteger(backendPid)
    || backendPid <= 0
    || typeof row?.session_user !== "string"
    || typeof row?.current_role !== "string") {
    throw new Error("website projection database session identity is invalid");
  }
  return Object.freeze({
    backendPid,
    sessionUser: row.session_user,
    currentRole: row.current_role,
  });
}

function expectedSession(value) {
  const session = capturedSession({
    backend_pid: value?.backendPid,
    session_user: value?.sessionUser,
    current_role: value?.currentRole,
  });
  if (session.currentRole !== "postgres") {
    throw new Error("website projection operator effective role must be postgres");
  }
  return session;
}

async function assertSession(sql, expected) {
  const [row] = await queryRows(sql, `
    /* website-projection:session */
    SELECT pg_catalog.pg_backend_pid() AS backend_pid,
           session_user::text AS session_user,
           current_role::text AS current_role
  `);
  const actual = capturedSession(row);
  if (actual.backendPid !== expected.backendPid
    || actual.sessionUser !== expected.sessionUser
    || actual.currentRole !== expected.currentRole) {
    throw new Error("website projection database session changed unexpectedly");
  }
  return actual;
}

async function readRoleGraph(sql, appliedCount, {
  adoptionSource = false,
} = {}) {
  const roles = await queryRows(sql, `
    /* website-projection:roles */
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
           rolcanlogin, rolreplication, rolbypassrls, rolconnlimit,
           rolvaliduntil::text AS rolvaliduntil, rolconfig
      FROM pg_catalog.pg_roles
     WHERE rolname IN (
       'postgres', 'programmable_website_projection_runtime',
       'anon', 'authenticated', 'service_role'
     )
     ORDER BY rolname
  `);
  const memberships = await queryRows(sql, `
    /* website-projection:memberships */
    SELECT member.rolname AS member_name,
           granted.rolname AS role_name,
           grantor.rolname AS grantor_name,
           membership.admin_option, membership.inherit_option,
           membership.set_option
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
      JOIN pg_catalog.pg_roles grantor ON grantor.oid = membership.grantor
     WHERE member.rolname IN (
       'programmable_website_projection_runtime',
       'anon', 'authenticated', 'service_role'
     ) OR granted.rolname IN (
       'programmable_website_projection_runtime',
       'anon', 'authenticated', 'service_role'
     )
     ORDER BY member.rolname, granted.rolname, grantor.rolname
  `);
  return {
    roles,
    memberships,
    ...(adoptionSource
      ? assertWebsiteProjectionAdoptionSourceRoleGraph({ roles, memberships })
      : assertWebsiteProjectionRoleGraph({ roles, memberships, appliedCount })),
  };
}

async function readExtendedRoleInventory(sql) {
  const memberships = await queryRows(sql, `
    /* website-projection:adoption-extended-memberships */
      SELECT member.rolname AS member_name,
             granted.rolname AS role_name,
             grantor.rolname AS grantor_name,
             membership.admin_option, membership.inherit_option,
             membership.set_option
        FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
        JOIN pg_catalog.pg_roles grantor ON grantor.oid = membership.grantor
       ORDER BY member.rolname, granted.rolname, grantor.rolname
  `);
  const endpointRoleNames = [...new Set(memberships.flatMap((membership) => [
    membership.member_name,
    membership.role_name,
    membership.grantor_name,
  ]))].sort();
  return {
    roles: await queryRows(sql, `
      /* website-projection:adoption-extended-roles */
      SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
             rolcanlogin, rolreplication, rolconnlimit,
             rolvaliduntil::text AS rolvaliduntil, rolbypassrls, rolconfig
        FROM pg_catalog.pg_roles
       WHERE rolname::text = ANY($1::text[])
       ORDER BY rolname
    `, [endpointRoleNames]),
    memberships,
  };
}

async function readLegacySupabaseInventory(sql) {
  const relations = await queryRows(sql, `
    /* website-projection:adoption-legacy-relations */
    SELECT namespace.nspname, class.relname, class.relkind
      FROM pg_catalog.pg_class class
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'supabase_migrations'
       AND class.relkind IN ('r', 'p', 'v', 'm', 'S')
     ORDER BY namespace.nspname, class.relname
  `);
  const columns = await queryRows(sql, `
    /* website-projection:adoption-legacy-columns */
    SELECT table_name, ordinal_position::integer, column_name,
           data_type, udt_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'supabase_migrations'
       AND table_name IN (
         'programmable_migration_evidence', 'schema_migrations'
       )
     ORDER BY table_name, ordinal_position
  `);
  const schemaRowsRaw = await queryRows(sql, `
    /* website-projection:adoption-legacy-schema-rows */
    SELECT version, statements, name
      FROM supabase_migrations.schema_migrations
     ORDER BY version
  `);
  const evidenceRows = await queryRows(sql, `
    /* website-projection:adoption-legacy-evidence-rows */
    SELECT name, ordinal::integer, version, file_name,
           pg_catalog.to_jsonb(applied_at) #>> '{}' AS applied_at,
           file_sha256, plan_sha256, repository_commit
      FROM supabase_migrations.programmable_migration_evidence
     ORDER BY ordinal
  `);
  const schemaRows = schemaRowsRaw.map(({ version, statements, name }) => {
    if (typeof version !== "string"
      || !(statements === null || Array.isArray(statements))
      || !(name === null || typeof name === "string")) {
      throw new Error("adopt-existing legacy schema migration row is invalid");
    }
    const statementList = statements ?? [];
    return {
      version,
      name,
      statementCount: statementList.length,
      statementsSha256: sha256(canonicalJson(statementList)),
    };
  });
  return {
    relations,
    columns,
    schemaRows,
    evidenceRows,
    publicCanonicalSha256: sha256(canonicalJson({
      columns,
      schemaRows,
      evidenceRows,
    })),
  };
}

function protectedApplicationStructure(expandedSnapshot) {
  const captured = expandedSnapshot.applicationCatalog;
  const applicationCatalog = {
    namespaces: captured.schemas.filter(({ nspname }) =>
      nspname === WEBSITE_PROJECTION_APPLICATION_SCHEMA),
    relations: captured.relations,
    columns: captured.columns,
    constraints: captured.constraints,
    indexes: captured.indexes,
    policies: captured.policies,
    triggers: captured.triggers,
    functions: captured.functions,
    schemaAcl: captured.schemaAcl,
    relationAcl: captured.relationAcl,
    columnAcl: captured.columnAcl,
    functionAcl: captured.functionAcl,
  };
  return applicationStructureSnapshot(applicationCatalog);
}

export function assertWebsiteProjectionAdoptionLiveInventory({
  sourceCatalog,
  sourceData,
  extendedRoleInventory,
  legacyInventory,
  protectedSnapshots,
}) {
  const expanded = protectedSnapshots?.expandedSnapshot;
  const current = protectedSnapshots?.currentSnapshot;
  if (!plainObject(expanded) || !plainObject(current)) {
    throw new Error("adopt-existing protected snapshot is unavailable");
  }
  assertExactApplicationStructure(
    applicationStructureSnapshot(sourceCatalog),
    protectedApplicationStructure(expanded),
  );
  const expectedRoles = expanded.roleExtended.filter(({ rolname }) =>
    RELEVANT_ROLES.includes(rolname));
  const expectedMemberships = expanded.membershipExtended.filter(
    ({ member_name: memberName, role_name: roleName }) =>
      [WEBSITE_PROJECTION_RUNTIME_ROLE, "anon", "authenticated", "service_role"]
        .includes(memberName)
      || [WEBSITE_PROJECTION_RUNTIME_ROLE, "anon", "authenticated", "service_role"]
        .includes(roleName),
  );
  exactJson(sourceCatalog.roles, expectedRoles,
    "adopt-existing protected application role inventory mismatch");
  exactJson(sourceCatalog.memberships, expectedMemberships,
    "adopt-existing protected application membership inventory mismatch");
  exactJson(extendedRoleInventory.roles, current.roles,
    "adopt-existing extended role inventory mismatch");
  exactJson(extendedRoleInventory.memberships, current.memberships,
    "adopt-existing extended membership inventory mismatch");
  assertEmptyAdoptionData(sourceData);
  exactJson(
    sourceData.rowPresence.map(({ relation_name: relationName, has_rows: hasRows }) => ({
      table_name: relationName,
      row_count: hasRows === false ? "0" : "unproven",
    })),
    expanded.applicationCatalog.applicationRowCounts,
    "adopt-existing protected application rows mismatch",
  );
  exactJson(legacyInventory.relations, LEGACY_EVIDENCE_RELATIONS,
    "adopt-existing legacy evidence relation inventory mismatch");
  const expectedLegacy = expanded.legacySupabaseInventory;
  exactJson(legacyInventory.columns, expectedLegacy.columns,
    "adopt-existing legacy evidence columns mismatch");
  exactJson(legacyInventory.schemaRows, expectedLegacy.schemaRows,
    "adopt-existing legacy schema migration inventory mismatch");
  exactJson(legacyInventory.evidenceRows, expectedLegacy.evidenceRows,
    "adopt-existing legacy migration evidence inventory mismatch");
  if (legacyInventory.publicCanonicalSha256
      !== WEBSITE_PROJECTION_ADOPTION_LEGACY_PUBLIC_SHA256) {
    throw new Error("adopt-existing legacy inventory hash mismatch");
  }
  return true;
}

async function readPresenceAndEvidence(sql) {
  const [presence] = await queryRows(sql, `
    /* website-projection:presence */
    SELECT pg_catalog.to_regnamespace(
             'programmable_website_projection_v1'
           )::text AS application_schema,
           pg_catalog.to_regnamespace(
             'programmable_website_projection_migrations'
           )::text AS evidence_schema,
           pg_catalog.to_regclass(
             'programmable_website_projection_migrations.migration_evidence_v1'
           )::text AS evidence_table,
           pg_catalog.to_regclass(
             'programmable_website_projection_migrations.adoption_evidence_v1'
           )::text AS adoption_table
  `);
  const applicationSchemaPresent =
    presence?.application_schema === WEBSITE_PROJECTION_APPLICATION_SCHEMA;
  const evidenceSchemaPresent =
    presence?.evidence_schema === WEBSITE_PROJECTION_EVIDENCE_SCHEMA;
  const evidenceTablePresent =
    presence?.evidence_table === WEBSITE_PROJECTION_EVIDENCE_TABLE;
  const adoptionTablePresent = presence?.adoption_table
    === `${WEBSITE_PROJECTION_EVIDENCE_SCHEMA}.adoption_evidence_v1`;
  if (evidenceSchemaPresent !== evidenceTablePresent
    || evidenceSchemaPresent !== adoptionTablePresent) {
    throw new Error("website projection operator evidence infrastructure is partial");
  }
  const evidenceRows = evidenceTablePresent
    ? await queryRows(sql, `
        /* website-projection:evidence */
        SELECT ordinal, version, name, file_name, file_sha256,
               execution_sha256, plan_sha256, repository_commit,
               repository_tree, target_project_ref, catalog_sha256,
               operator_catalog_sha256, evidence_kind,
               adoption_source_snapshot_sha256,
               adoption_source_catalog_sha256,
               adoption_source_data_sha256, adoption_attestation_sha256,
               adoption_operator_commit, adoption_operator_tree
          FROM programmable_website_projection_migrations.migration_evidence_v1
         ORDER BY ordinal
      `)
    : [];
  const adoptionRows = adoptionTablePresent
    ? await queryRows(sql, `
        /* website-projection:adoption-evidence */
        SELECT evidence_kind, adopted_through_version,
               source_snapshot_sha256, expanded_snapshot_sha256,
               base_snapshot_sha256,
               legacy_inventory_sha256, legacy_public_sha256,
               source_catalog_sha256,
               corrected_catalog_sha256, source_data_sha256,
               operator_catalog_sha256, attestation_sha256,
               source_plan_sha256, source_order_sha256,
               source_repository_commit, source_repository_tree,
               successor_plan_sha256, successor_order_sha256,
               successor_repository_commit, successor_repository_tree,
               target_project_ref,
               operator_commit, operator_tree,
               credential_uses_count, projection_records_count,
               registry_custom_launch_records_count,
               runtime_rolinherit_before, runtime_rolinherit_after
          FROM programmable_website_projection_migrations.adoption_evidence_v1
         ORDER BY singleton
      `)
    : [];
  return {
    applicationSchemaPresent,
    evidenceSchemaPresent,
    evidenceTablePresent,
    adoptionTablePresent,
    evidenceRows,
    adoptionRows,
  };
}

async function readEvidenceCatalogSnapshot(sql) {
  return {
    namespaces: await queryRows(sql, `
      /* website-projection:operator-catalog:namespaces */
      SELECT namespace.nspname,
             pg_catalog.pg_get_userbyid(namespace.nspowner) AS owner_name
        FROM pg_catalog.pg_namespace namespace
       WHERE namespace.nspname = 'programmable_website_projection_migrations'
       ORDER BY namespace.nspname
    `),
    relations: await queryRows(sql, `
      /* website-projection:operator-catalog:relations */
      SELECT class.relname, class.relkind, class.relpersistence,
             class.relrowsecurity, class.relforcerowsecurity,
             pg_catalog.pg_get_userbyid(class.relowner) AS owner_name
        FROM pg_catalog.pg_class class
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'programmable_website_projection_migrations'
         AND class.relkind IN ('r', 'p', 'v', 'm', 'S')
       ORDER BY class.relname
    `),
    columns: await queryRows(sql, `
      /* website-projection:operator-catalog:columns */
      SELECT class.relname, attribute.attnum::integer, attribute.attname,
             pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
               AS data_type,
             attribute.attnotnull AS not_null,
             attribute.attidentity AS identity_kind,
             attribute.attgenerated AS generated_kind,
             pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
               AS default_expression
        FROM pg_catalog.pg_class class
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = class.relnamespace
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = class.oid
        LEFT JOIN pg_catalog.pg_attrdef default_value
          ON default_value.adrelid = class.oid
         AND default_value.adnum = attribute.attnum
       WHERE namespace.nspname = 'programmable_website_projection_migrations'
         AND class.relkind IN ('r', 'p', 'v', 'm')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
       ORDER BY class.relname, attribute.attnum
    `),
    constraints: await queryRows(sql, `
      /* website-projection:operator-catalog:constraints */
      SELECT class.relname, constraint_row.conname,
             constraint_row.contype,
             constraint_row.condeferrable,
             constraint_row.condeferred,
             constraint_row.convalidated,
             pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
               AS definition
        FROM pg_catalog.pg_constraint constraint_row
        JOIN pg_catalog.pg_class class ON class.oid = constraint_row.conrelid
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'programmable_website_projection_migrations'
       ORDER BY class.relname, constraint_row.conname
    `),
    indexes: await queryRows(sql, `
      /* website-projection:operator-catalog:indexes */
      SELECT index_class.relname AS index_name,
             table_class.relname AS table_name,
             pg_catalog.pg_get_indexdef(index_class.oid) AS definition
        FROM pg_catalog.pg_index index_row
        JOIN pg_catalog.pg_class index_class
          ON index_class.oid = index_row.indexrelid
        JOIN pg_catalog.pg_class table_class
          ON table_class.oid = index_row.indrelid
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = table_class.relnamespace
       WHERE namespace.nspname = 'programmable_website_projection_migrations'
       ORDER BY index_class.relname
    `),
    schemaAcl: await queryRows(sql, `
      /* website-projection:operator-catalog:schema-acl */
      SELECT COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
             acl.privilege_type, acl.is_grantable
        FROM pg_catalog.pg_namespace namespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(namespace.nspacl,
            pg_catalog.acldefault('n', namespace.nspowner))
        ) acl
        LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
       WHERE namespace.nspname = 'programmable_website_projection_migrations'
       ORDER BY grantee, acl.privilege_type
    `),
    relationAcl: await queryRows(sql, `
      /* website-projection:operator-catalog:relation-acl */
      SELECT class.relname,
             COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
             acl.privilege_type, acl.is_grantable
        FROM pg_catalog.pg_class class
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = class.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
        ) acl
        LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
       WHERE namespace.nspname = 'programmable_website_projection_migrations'
         AND class.relkind IN ('r', 'p', 'v', 'm', 'S')
       ORDER BY class.relname, grantee, acl.privilege_type
    `),
  };
}

async function readApplicationCatalogSnapshot(sql, roleGraph) {
  return {
    roles: roleGraph.roles,
    memberships: roleGraph.memberships,
    namespaces: await queryRows(sql, `
      /* website-projection:catalog:namespaces */
      SELECT namespace.nspname,
             pg_catalog.pg_get_userbyid(namespace.nspowner) AS owner_name
        FROM pg_catalog.pg_namespace namespace
       WHERE namespace.nspname = 'programmable_website_projection_v1'
       ORDER BY namespace.nspname
    `),
    relations: await queryRows(sql, `
      /* website-projection:catalog:relations */
      SELECT class.relname, class.relkind, class.relpersistence,
             class.relrowsecurity, class.relforcerowsecurity,
             class.relreplident,
             pg_catalog.pg_get_userbyid(class.relowner) AS owner_name
        FROM pg_catalog.pg_class class
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'programmable_website_projection_v1'
         AND class.relkind IN ('r', 'p', 'v', 'm', 'S')
       ORDER BY class.relname
    `),
    columns: await queryRows(sql, `
      /* website-projection:catalog:columns */
      SELECT class.relname, attribute.attnum::integer, attribute.attname,
             pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
               AS data_type,
             attribute.attnotnull AS not_null,
             attribute.attidentity AS identity_kind,
             attribute.attgenerated AS generated_kind,
             pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
               AS default_expression
        FROM pg_catalog.pg_class class
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = class.relnamespace
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = class.oid
        LEFT JOIN pg_catalog.pg_attrdef default_value
          ON default_value.adrelid = class.oid
         AND default_value.adnum = attribute.attnum
       WHERE namespace.nspname = 'programmable_website_projection_v1'
         AND class.relkind IN ('r', 'p', 'v', 'm')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
       ORDER BY class.relname, attribute.attnum
    `),
    constraints: await queryRows(sql, `
      /* website-projection:catalog:constraints */
      SELECT class.relname, constraint_row.conname,
             constraint_row.contype,
             constraint_row.condeferrable,
             constraint_row.condeferred,
             constraint_row.convalidated,
             pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
               AS definition
        FROM pg_catalog.pg_constraint constraint_row
        JOIN pg_catalog.pg_class class ON class.oid = constraint_row.conrelid
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'programmable_website_projection_v1'
       ORDER BY class.relname, constraint_row.conname
    `),
    indexes: await queryRows(sql, `
      /* website-projection:catalog:indexes */
      SELECT index_class.relname AS index_name,
             table_class.relname AS table_name,
             pg_catalog.pg_get_indexdef(index_class.oid) AS definition
        FROM pg_catalog.pg_index index_row
        JOIN pg_catalog.pg_class index_class
          ON index_class.oid = index_row.indexrelid
        JOIN pg_catalog.pg_class table_class
          ON table_class.oid = index_row.indrelid
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = table_class.relnamespace
       WHERE namespace.nspname = 'programmable_website_projection_v1'
       ORDER BY index_class.relname
    `),
    policies: await queryRows(sql, `
      /* website-projection:catalog:policies */
      SELECT tablename, policyname, permissive, roles, cmd,
             COALESCE(qual, '') AS qual,
             COALESCE(with_check, '') AS with_check
        FROM pg_catalog.pg_policies
       WHERE schemaname = 'programmable_website_projection_v1'
       ORDER BY tablename, policyname
    `),
    triggers: await queryRows(sql, `
      /* website-projection:catalog:triggers */
      SELECT table_class.relname AS table_name,
             trigger_row.tgname AS trigger_name,
             trigger_row.tgenabled AS enabled,
             pg_catalog.pg_get_triggerdef(trigger_row.oid, true) AS definition
        FROM pg_catalog.pg_trigger trigger_row
        JOIN pg_catalog.pg_class table_class
          ON table_class.oid = trigger_row.tgrelid
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = table_class.relnamespace
       WHERE namespace.nspname = 'programmable_website_projection_v1'
         AND NOT trigger_row.tgisinternal
       ORDER BY table_class.relname, trigger_row.tgname
    `),
    functions: await queryRows(sql, `
      /* website-projection:catalog:functions */
      SELECT function_row.proname AS function_name,
             pg_catalog.pg_get_function_identity_arguments(function_row.oid)
               AS identity_arguments,
             pg_catalog.pg_get_function_result(function_row.oid) AS result_type,
             language.lanname AS language,
             function_row.provolatile AS volatility,
             function_row.proisstrict AS is_strict,
             function_row.prosecdef AS security_definer,
             function_row.proparallel AS parallel_safety,
             function_row.proconfig AS configuration,
             function_row.prosrc AS source,
             pg_catalog.pg_get_userbyid(function_row.proowner) AS owner_name
        FROM pg_catalog.pg_proc function_row
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = function_row.pronamespace
        JOIN pg_catalog.pg_language language
          ON language.oid = function_row.prolang
       WHERE namespace.nspname = 'programmable_website_projection_v1'
       ORDER BY function_row.proname,
                pg_catalog.pg_get_function_identity_arguments(function_row.oid)
    `),
    schemaAcl: await queryRows(sql, `
      /* website-projection:catalog:schema-acl */
      SELECT COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
             acl.privilege_type, acl.is_grantable
        FROM pg_catalog.pg_namespace namespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(namespace.nspacl,
            pg_catalog.acldefault('n', namespace.nspowner))
        ) acl
        LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
       WHERE namespace.nspname = 'programmable_website_projection_v1'
       ORDER BY grantee, acl.privilege_type
    `),
    relationAcl: await queryRows(sql, `
      /* website-projection:catalog:relation-acl */
      SELECT class.relname,
             COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
             acl.privilege_type, acl.is_grantable
        FROM pg_catalog.pg_class class
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = class.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
        ) acl
        LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
       WHERE namespace.nspname = 'programmable_website_projection_v1'
         AND class.relkind IN ('r', 'p', 'v', 'm', 'S')
       ORDER BY class.relname, grantee, acl.privilege_type
    `),
    columnAcl: await queryRows(sql, `
      /* website-projection:catalog:column-acl */
      SELECT class.relname, attribute.attname,
             COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
             acl.privilege_type, acl.is_grantable
        FROM pg_catalog.pg_class class
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = class.relnamespace
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = class.oid
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
        LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
       WHERE namespace.nspname = 'programmable_website_projection_v1'
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
       ORDER BY class.relname, attribute.attname, grantee, acl.privilege_type
    `),
    functionAcl: await queryRows(sql, `
      /* website-projection:catalog:function-acl */
      SELECT function_row.proname AS function_name,
             pg_catalog.pg_get_function_identity_arguments(function_row.oid)
               AS identity_arguments,
             COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
             acl.privilege_type, acl.is_grantable
        FROM pg_catalog.pg_proc function_row
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = function_row.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner))
        ) acl
        LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
       WHERE namespace.nspname = 'programmable_website_projection_v1'
       ORDER BY function_row.proname, identity_arguments,
                grantee, acl.privilege_type
    `),
  };
}

function applicationStructureSnapshot(snapshot) {
  const structure = { ...snapshot };
  delete structure.roles;
  delete structure.memberships;
  return {
    ...structure,
    constraints: structure.constraints.filter(({ contype }) => contype !== "n"),
  };
}

function assertExactApplicationStructure(actual, expected) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      "adopt-existing application catalog does not exactly match reviewed 0001..0003",
    );
  }
}

async function lockAdoptionApplicationTables(transaction) {
  await executeSimple(transaction, `
    LOCK TABLE
      programmable_website_projection_v1.credential_uses,
      programmable_website_projection_v1.projection_records,
      programmable_website_projection_v1.registry_custom_launch_records
    IN ACCESS EXCLUSIVE MODE
  `);
}

async function readAdoptionDataSnapshot(sql) {
  return {
    rowPresence: await queryRows(sql, `
      /* website-projection:adoption-data */
      SELECT relation_name, has_rows
        FROM (
          SELECT 'credential_uses'::text AS relation_name,
                 EXISTS (
                   SELECT 1
                     FROM programmable_website_projection_v1.credential_uses
                 ) AS has_rows
          UNION ALL
          SELECT 'projection_records'::text AS relation_name,
                 EXISTS (
                   SELECT 1
                     FROM programmable_website_projection_v1.projection_records
                 ) AS has_rows
          UNION ALL
          SELECT 'registry_custom_launch_records'::text AS relation_name,
                 EXISTS (
                   SELECT 1
                     FROM programmable_website_projection_v1.registry_custom_launch_records
                 ) AS has_rows
        ) presence
       ORDER BY relation_name
    `),
  };
}

function assertEmptyAdoptionData(snapshot) {
  if (!Array.isArray(snapshot?.rowPresence)
    || snapshot.rowPresence.length !== WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT
    || snapshot.rowPresence.some(({ relation_name: relationName, has_rows: hasRows }) =>
      typeof relationName !== "string" || hasRows !== false)) {
    throw new Error("adopt-existing rejects unproven application data");
  }
}

function pgliteSql(client) {
  const sql = {
    unsafe(statement, parameters = []) {
      const normalized = statement.trimStart().toLowerCase();
      const operation = (parameters.length > 0
        || normalized.startsWith("select")
        || normalized.startsWith("with"))
        ? client.query(statement, parameters).then(({ rows: resultRows }) =>
          resultRows)
        : client.exec(statement).then((results) =>
          results.at(-1)?.rows ?? []);
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

const canonicalAdoptionReferences = new Map();

export async function buildCanonicalWebsiteProjectionAdoptionReference({
  workspace,
  plan,
}) {
  assertWebsiteProjectionAdoptionSourcePlan(plan);
  const cacheKey = `${workspace}\0${plan.planSha256}`;
  if (canonicalAdoptionReferences.has(cacheKey)) {
    return await canonicalAdoptionReferences.get(cacheKey);
  }
  const referencePromise = (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN;
        CREATE ROLE authenticator NOLOGIN;
        GRANT anon, authenticated, service_role TO authenticator;
        CREATE ROLE programmable_website_projection_runtime WITH
          LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS
          PASSWORD 'local-reference-password-never-used-remotely';
      `);
      const sql = pgliteSql(database);
      const [identity] = await queryRows(sql, `
        SELECT pg_catalog.pg_backend_pid() AS backend_pid,
               session_user::text AS session_user,
               current_role::text AS current_role
      `);
      const session = expectedSession({
        backendPid: Number(identity?.backend_pid),
        sessionUser: identity?.session_user,
        currentRole: identity?.current_role,
      });
      for (const migration of plan.migrations.slice(
        0,
        WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT,
      )) {
        await applyOneMigration({
          sql,
          workspace,
          plan,
          migration,
          expectedProjectRef: "reference00000000000",
          session,
          bootstrapRuntimePassword: null,
        });
      }
      await executeSimple(sql, ADOPTION_PREFIX_PRIVILEGES);
      const roleGraph = await readRoleGraph(
        sql,
        WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT,
      );
      const catalog = await readApplicationCatalogSnapshot(sql, roleGraph);
      const data = await readAdoptionDataSnapshot(sql);
      assertEmptyAdoptionData(data);
      return Object.freeze({
        structure: Object.freeze(applicationStructureSnapshot(catalog)),
        structureSha256: catalogSnapshotSha256(
          applicationStructureSnapshot(catalog),
        ),
        dataSha256: catalogSnapshotSha256(data),
      });
    } finally {
      await database.close();
    }
  })();
  canonicalAdoptionReferences.set(cacheKey, referencePromise);
  try {
    return await referencePromise;
  } catch (error) {
    canonicalAdoptionReferences.delete(cacheKey);
    throw error;
  }
}

export async function inspectWebsiteProjectionDatabase({
  sql,
  plan,
  expectedProjectRef,
  sessionIdentity,
}) {
  validateWebsiteProjectionPlan(plan);
  const session = expectedSession(sessionIdentity);
  await assertSession(sql, session);
  const remote = await readPresenceAndEvidence(sql);
  const state = compareWebsiteProjectionEvidence({
    plan,
    expectedProjectRef,
    evidenceTablePresent: remote.evidenceTablePresent,
    applicationSchemaPresent: remote.applicationSchemaPresent,
    evidenceRows: remote.evidenceRows,
    adoptionRows: remote.adoptionRows,
  });
  const roleGraph = await readRoleGraph(sql, state.appliedCount);
  if (state.appliedCount > 0) {
    const catalogSha256 = catalogSnapshotSha256(
      await readApplicationCatalogSnapshot(sql, roleGraph),
    );
    const operatorCatalogSha256 = catalogSnapshotSha256(
      await readEvidenceCatalogSnapshot(sql),
    );
    const latest = remote.evidenceRows.at(-1);
    if (catalogSha256 !== latest.catalog_sha256
      || operatorCatalogSha256 !== latest.operator_catalog_sha256) {
      throw new Error("website projection catalog fingerprint mismatch");
    }
  }
  await assertSession(sql, session);
  return Object.freeze({
    ...state,
    runtimeRoleStatus: roleGraph.runtimeRoleStatus,
  });
}

export async function inspectWebsiteProjectionCurrentRotationPosture({
  sql,
  plan,
  expectedProjectRef,
  sessionIdentity,
}) {
  validateWebsiteProjectionPlan(plan);
  const session = expectedSession(sessionIdentity);
  await assertSession(sql, session);
  const remote = await readPresenceAndEvidence(sql);
  const state = compareWebsiteProjectionEvidence({
    plan,
    expectedProjectRef,
    evidenceTablePresent: remote.evidenceTablePresent,
    applicationSchemaPresent: remote.applicationSchemaPresent,
    evidenceRows: remote.evidenceRows,
    adoptionRows: remote.adoptionRows,
  });
  const roleGraph = await readRoleGraph(
    sql,
    state.appliedCount,
  );
  const catalogSha256 = catalogSnapshotSha256(
    await readApplicationCatalogSnapshot(sql, roleGraph),
  );
  const operatorCatalogSha256 = catalogSnapshotSha256(
    await readEvidenceCatalogSnapshot(sql),
  );
  const latest = remote.evidenceRows.at(-1);
  if (state.status !== "current"
    || state.appliedCount !== plan.migrationCount
    || catalogSha256 !== latest?.catalog_sha256
    || operatorCatalogSha256 !== latest?.operator_catalog_sha256
    || roleGraph.runtimeRoleStatus !== "current") {
    throw new Error("website projection current rotation posture is invalid");
  }
  await assertSession(sql, session);
  return Object.freeze({
    migrationEvidence: Object.freeze({
      migrationCount: state.appliedCount,
      planSha256: plan.planSha256,
      repositoryCommit: plan.repositoryCommit,
      repositoryTree: plan.repositoryTree,
      catalogSha256,
      operatorCatalogSha256,
    }),
    catalogSha256,
    operatorCatalogSha256,
    runtimeRoleStatus: roleGraph.runtimeRoleStatus,
  });
}

async function bootstrapRuntimeRole(transaction, runtimePassword) {
  const before = await readRoleGraph(transaction, 0);
  if (before.runtimeRoleStatus === "current") return false;
  const password = validateWebsiteProjectionRuntimePassword(runtimePassword);
  await queryRows(transaction, `
    SELECT pg_catalog.set_config(
      'programmable.website_projection_runtime_password', $1, true
    ) AS configured
  `, [password]);
  await executeSimple(transaction, `
    DO $runtime_role$
    DECLARE
      runtime_password text := pg_catalog.current_setting(
        'programmable.website_projection_runtime_password', true
      );
    BEGIN
      IF runtime_password IS NULL OR pg_catalog.octet_length(runtime_password) < 24 THEN
        RAISE EXCEPTION 'website projection runtime password is unavailable';
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
         WHERE rolname = 'programmable_website_projection_runtime'
      ) THEN
        RAISE EXCEPTION 'website projection runtime role changed during bootstrap';
      END IF;
      EXECUTE pg_catalog.format(
        'CREATE ROLE programmable_website_projection_runtime WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
        runtime_password
      );
      PERFORM pg_catalog.set_config(
        'programmable.website_projection_runtime_password', '', true
      );
    END
    $runtime_role$;
  `);
  const after = await readRoleGraph(transaction, 0);
  if (after.runtimeRoleStatus !== "current") {
    throw new Error("website projection runtime role bootstrap failed");
  }
  return true;
}

async function readAndValidateMigration(workspace, migration) {
  const absolutePath = path.resolve(workspace, migration.file);
  const contents = await readFile(absolutePath);
  if (contents.byteLength !== migration.bytes
    || sha256(contents) !== migration.fileSha256) {
    throw new Error(`migration file changed after review: ${migration.version}`);
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  const executionSource = unwrapWebsiteProjectionMigration(source);
  if (Buffer.byteLength(executionSource, "utf8") !== migration.executionBytes
    || sha256(Buffer.from(executionSource, "utf8")) !== migration.executionSha256) {
    throw new Error(`migration execution body changed after review: ${migration.version}`);
  }
  return executionSource;
}

async function insertEvidence(transaction, {
  migration,
  plan,
  expectedProjectRef,
  catalogSha256,
  operatorCatalogSha256,
  evidenceKind = "applied",
  adoptionSourceSnapshotSha256 = null,
  adoptionSourceCatalogSha256 = null,
  adoptionSourceDataSha256 = null,
  adoptionAttestationSha256 = null,
  adoptionOperatorCommit = null,
  adoptionOperatorTree = null,
}) {
  await queryRows(transaction, `
    INSERT INTO programmable_website_projection_migrations.migration_evidence_v1 (
      ordinal, version, name, file_name, file_sha256, execution_sha256,
      plan_sha256, repository_commit, repository_tree, target_project_ref,
      catalog_sha256, operator_catalog_sha256, evidence_kind,
      adoption_source_snapshot_sha256, adoption_source_catalog_sha256,
      adoption_source_data_sha256, adoption_attestation_sha256,
      adoption_operator_commit, adoption_operator_tree
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19
    )
  `, [
    migration.ordinal,
    migration.version,
    migration.name,
    path.posix.basename(migration.file),
    migration.fileSha256,
    migration.executionSha256,
    plan.planSha256,
    plan.repositoryCommit,
    plan.repositoryTree,
    expectedProjectRef,
    catalogSha256,
    operatorCatalogSha256,
    evidenceKind,
    adoptionSourceSnapshotSha256,
    adoptionSourceCatalogSha256,
    adoptionSourceDataSha256,
    adoptionAttestationSha256,
    adoptionOperatorCommit,
    adoptionOperatorTree,
  ]);
}

async function insertAdoptionEvidence(transaction, {
  plan,
  expectedProjectRef,
  sourceSnapshotSha256,
  sourceCatalogSha256,
  correctedCatalogSha256,
  sourceDataSha256,
  operatorCatalogSha256,
  adoptionAttestationSha256,
  operatorCommit,
  operatorTree,
}) {
  await queryRows(transaction, `
    INSERT INTO programmable_website_projection_migrations.adoption_evidence_v1 (
      evidence_kind, adopted_through_version, source_snapshot_sha256,
      expanded_snapshot_sha256, base_snapshot_sha256,
      legacy_inventory_sha256, legacy_public_sha256,
      source_catalog_sha256, corrected_catalog_sha256, source_data_sha256,
      operator_catalog_sha256, attestation_sha256, source_plan_sha256,
      source_order_sha256, source_repository_commit, source_repository_tree,
      successor_plan_sha256, successor_order_sha256,
      successor_repository_commit, successor_repository_tree,
      target_project_ref, operator_commit, operator_tree, credential_uses_count,
      projection_records_count, registry_custom_launch_records_count,
      runtime_rolinherit_before, runtime_rolinherit_after
    ) VALUES (
      'adopted-existing-prefix-v1', '0003', $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
      $19, $20, $21,
      0, 0, 0, true, false
    )
  `, [
    sourceSnapshotSha256,
    WEBSITE_PROJECTION_ADOPTION_EXPANDED_SNAPSHOT_SHA256,
    WEBSITE_PROJECTION_ADOPTION_BASE_SNAPSHOT_SHA256,
    WEBSITE_PROJECTION_ADOPTION_LEGACY_INVENTORY_SHA256,
    WEBSITE_PROJECTION_ADOPTION_LEGACY_PUBLIC_SHA256,
    sourceCatalogSha256,
    correctedCatalogSha256,
    sourceDataSha256,
    operatorCatalogSha256,
    adoptionAttestationSha256,
    WEBSITE_PROJECTION_ADOPTION_SOURCE_PLAN_SHA256,
    WEBSITE_PROJECTION_ADOPTION_SOURCE_ORDER_SHA256,
    WEBSITE_PROJECTION_ADOPTION_SOURCE_COMMIT,
    WEBSITE_PROJECTION_ADOPTION_SOURCE_TREE,
    plan.planSha256,
    plan.orderSha256,
    plan.repositoryCommit,
    plan.repositoryTree,
    expectedProjectRef,
    operatorCommit,
    operatorTree,
  ]);
}

async function applyOneMigration({
  sql,
  workspace,
  plan,
  migration,
  expectedProjectRef,
  session,
  bootstrapRuntimePassword,
}) {
  const executionSource = await readAndValidateMigration(workspace, migration);
  await assertSession(sql, session);
  await sql.begin(async (transaction) => {
    await assertSession(transaction, session);
    await executeSimple(transaction,
      "SET LOCAL lock_timeout = '4s'; SET LOCAL statement_timeout = '15min';");
    if (bootstrapRuntimePassword !== null) {
      await bootstrapRuntimeRole(transaction, bootstrapRuntimePassword);
    }
    if (migration.ordinal === 1) {
      await executeSimple(transaction, evidenceDdl(plan));
    }
    if (migration.ordinal === 6) {
      await executeSimple(transaction, EVIDENCE_0006_DDL);
    }
    await executeSimple(transaction, executionSource);
    if (migration.ordinal === plan.migrationCount) {
      await executeSimple(transaction, FINAL_PRIVILEGES);
      if (plan.migrationCount === 6) {
        await executeSimple(transaction, FINAL_GMGN_PRIVILEGES);
      }
    }
    const roleGraph = await readRoleGraph(transaction, migration.ordinal);
    const catalogSha256 = catalogSnapshotSha256(
      await readApplicationCatalogSnapshot(transaction, roleGraph),
    );
    const operatorCatalogSha256 = catalogSnapshotSha256(
      await readEvidenceCatalogSnapshot(transaction),
    );
    await insertEvidence(transaction, {
      migration,
      plan,
      expectedProjectRef,
      catalogSha256,
      operatorCatalogSha256,
    });
    await assertSession(transaction, session);
  });
  await assertSession(sql, session);
}

export async function adoptExistingWebsiteProjectionDatabase({
  sql,
  workspace,
  plan,
  expectedProjectRef,
  sessionIdentity,
  expectedSourceSnapshotSha256,
  operatorCommit = plan?.repositoryCommit,
  operatorTree = plan?.repositoryTree,
  canonicalReference,
  protectedSnapshots,
  extendedRoleInventoryReader = readExtendedRoleInventory,
  legacyInventoryReader = readLegacySupabaseInventory,
  liveInventoryValidator = assertWebsiteProjectionAdoptionLiveInventory,
}) {
  assertWebsiteProjectionAdoptionSourcePlan(plan);
  if (expectedSourceSnapshotSha256
      !== WEBSITE_PROJECTION_ADOPTION_SOURCE_SNAPSHOT_SHA256) {
    throw new Error("adopt-existing protected source snapshot mismatch");
  }
  if (!plainObject(protectedSnapshots)
    || protectedSnapshots.sourceSnapshotSha256
      !== WEBSITE_PROJECTION_ADOPTION_SOURCE_SNAPSHOT_SHA256
    || protectedSnapshots.expandedSnapshotSha256
      !== WEBSITE_PROJECTION_ADOPTION_EXPANDED_SNAPSHOT_SHA256
    || protectedSnapshots.baseSnapshotSha256
      !== WEBSITE_PROJECTION_ADOPTION_BASE_SNAPSHOT_SHA256) {
    throw new Error("adopt-existing protected snapshots were not verified");
  }
  const session = expectedSession(sessionIdentity);
  const reference = canonicalReference
    ?? await buildCanonicalWebsiteProjectionAdoptionReference({
      workspace,
      plan,
    });
  const [lock] = await queryRows(sql, `
    /* website-projection:lock */
    SELECT pg_catalog.pg_try_advisory_lock(
             pg_catalog.hashtextextended('${OPERATOR_LOCK}', 0)
           ) AS acquired,
           pg_catalog.pg_backend_pid() AS backend_pid,
           session_user::text AS session_user,
           current_role::text AS current_role
  `);
  const lockSession = capturedSession(lock);
  if (lockSession.backendPid !== session.backendPid
    || lockSession.sessionUser !== session.sessionUser
    || lockSession.currentRole !== session.currentRole) {
    throw new Error("website projection database session changed unexpectedly");
  }
  if (lock?.acquired !== true) {
    throw new Error("another website projection migration operator holds the lock");
  }
  try {
    const adoption = await sql.begin(async (transaction) => {
      await executeSimple(transaction,
        "SET LOCAL lock_timeout = '4s'; SET LOCAL statement_timeout = '5min';");
      await assertSession(transaction, session);
      const beforePresence = await readPresenceAndEvidence(transaction);
      if (!beforePresence.applicationSchemaPresent) {
        throw new Error("adopt-existing application schema is absent");
      }
      if (beforePresence.evidenceSchemaPresent
        || beforePresence.evidenceTablePresent
        || beforePresence.evidenceRows.length > 0) {
        throw new Error("adopt-existing operator evidence must be absent");
      }
      await lockAdoptionApplicationTables(transaction);
      const frozenPresence = await readPresenceAndEvidence(transaction);
      if (!frozenPresence.applicationSchemaPresent
        || frozenPresence.evidenceSchemaPresent
        || frozenPresence.evidenceTablePresent
        || frozenPresence.evidenceRows.length > 0) {
        throw new Error("adopt-existing preconditions changed while locking");
      }
      const sourceRoleGraph = await readRoleGraph(
        transaction,
        WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT,
        { adoptionSource: true },
      );
      const sourceCatalog = await readApplicationCatalogSnapshot(
        transaction,
        sourceRoleGraph,
      );
      const sourceStructure = applicationStructureSnapshot(sourceCatalog);
      assertExactApplicationStructure(sourceStructure, reference.structure);
      const sourceData = await readAdoptionDataSnapshot(transaction);
      const sourceExtendedRoleInventory = await extendedRoleInventoryReader(
        transaction,
      );
      const sourceLegacyInventory = await legacyInventoryReader(transaction);
      liveInventoryValidator({
        sourceCatalog,
        sourceData,
        extendedRoleInventory: sourceExtendedRoleInventory,
        legacyInventory: sourceLegacyInventory,
        protectedSnapshots,
      });
      const sourceDataSha256 = catalogSnapshotSha256(sourceData);
      if (sourceDataSha256 !== reference.dataSha256) {
        throw new Error("adopt-existing source data snapshot mismatch");
      }
      const sourceCatalogSha256 = catalogSnapshotSha256(sourceCatalog);

      await executeSimple(transaction, `
        ALTER ROLE programmable_website_projection_runtime NOINHERIT
      `);
      const correctedRoleGraph = await readRoleGraph(
        transaction,
        WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT,
      );
      const correctedCatalog = await readApplicationCatalogSnapshot(
        transaction,
        correctedRoleGraph,
      );
      const expectedCorrectedCatalog = structuredClone(sourceCatalog);
      const expectedRuntimeRole = expectedCorrectedCatalog.roles.find(
        ({ rolname }) => rolname === WEBSITE_PROJECTION_RUNTIME_ROLE,
      );
      if (!expectedRuntimeRole) {
        throw new Error("adopt-existing source runtime role disappeared");
      }
      expectedRuntimeRole.rolinherit = false;
      if (canonicalJson(correctedCatalog)
        !== canonicalJson(expectedCorrectedCatalog)) {
        throw new Error("adopt-existing role correction changed forbidden state");
      }
      assertExactApplicationStructure(
        applicationStructureSnapshot(correctedCatalog),
        reference.structure,
      );
      const correctedExtendedRoleInventory = await extendedRoleInventoryReader(
        transaction,
      );
      const expectedCorrectedExtendedRoleInventory = structuredClone(
        sourceExtendedRoleInventory,
      );
      const correctedExtendedRuntime =
        expectedCorrectedExtendedRoleInventory.roles.find(
          ({ rolname }) => rolname === WEBSITE_PROJECTION_RUNTIME_ROLE,
        );
      if (!correctedExtendedRuntime) {
        throw new Error("adopt-existing extended runtime role disappeared");
      }
      correctedExtendedRuntime.rolinherit = false;
      exactJson(
        correctedExtendedRoleInventory,
        expectedCorrectedExtendedRoleInventory,
        "adopt-existing role correction changed extended role inventory",
      );
      const correctedLegacyInventory = await legacyInventoryReader(transaction);
      exactJson(
        correctedLegacyInventory,
        sourceLegacyInventory,
        "adopt-existing role correction changed legacy inventory",
      );
      const correctedCatalogSha256 = catalogSnapshotSha256(correctedCatalog);
      const correctedData = await readAdoptionDataSnapshot(transaction);
      assertEmptyAdoptionData(correctedData);
      if (catalogSnapshotSha256(correctedData) !== sourceDataSha256) {
        throw new Error("adopt-existing data changed during role correction");
      }

      await executeSimple(transaction, evidenceDdl(plan));
      const operatorCatalogSha256 = catalogSnapshotSha256(
        await readEvidenceCatalogSnapshot(transaction),
      );
      const adoptionAttestationSha256 =
        websiteProjectionAdoptionAttestationSha256({
          plan,
          expectedProjectRef,
          sourceSnapshotSha256: expectedSourceSnapshotSha256,
          sourceCatalogSha256,
          sourceDataSha256,
          correctedCatalogSha256,
          operatorCatalogSha256,
          operatorCommit,
          operatorTree,
        });
      for (const migration of plan.migrations.slice(
        0,
        WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT,
      )) {
        await insertEvidence(transaction, {
          migration,
          plan,
          expectedProjectRef,
          catalogSha256: correctedCatalogSha256,
          operatorCatalogSha256,
          evidenceKind: "adopted-existing-prefix-v1",
          adoptionSourceSnapshotSha256: expectedSourceSnapshotSha256,
          adoptionSourceCatalogSha256: sourceCatalogSha256,
          adoptionSourceDataSha256: sourceDataSha256,
          adoptionAttestationSha256,
          adoptionOperatorCommit: operatorCommit,
          adoptionOperatorTree: operatorTree,
        });
      }
      await insertAdoptionEvidence(transaction, {
        plan,
        expectedProjectRef,
        sourceSnapshotSha256: expectedSourceSnapshotSha256,
        sourceCatalogSha256,
        correctedCatalogSha256,
        sourceDataSha256,
        operatorCatalogSha256,
        adoptionAttestationSha256,
        operatorCommit,
        operatorTree,
      });

      const afterPresence = await readPresenceAndEvidence(transaction);
      const state = compareWebsiteProjectionEvidence({
        plan,
        expectedProjectRef,
        evidenceTablePresent: afterPresence.evidenceTablePresent,
        applicationSchemaPresent: afterPresence.applicationSchemaPresent,
        evidenceRows: afterPresence.evidenceRows,
        adoptionRows: afterPresence.adoptionRows,
      });
      if (state.appliedCount !== WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT
        || state.pending.length !==
          plan.migrationCount - WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT) {
        throw new Error("adopt-existing did not create the exact evidence prefix");
      }
      const finalRoleGraph = await readRoleGraph(
        transaction,
        WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT,
      );
      const finalCatalogSha256 = catalogSnapshotSha256(
        await readApplicationCatalogSnapshot(transaction, finalRoleGraph),
      );
      const finalOperatorCatalogSha256 = catalogSnapshotSha256(
        await readEvidenceCatalogSnapshot(transaction),
      );
      if (finalCatalogSha256 !== correctedCatalogSha256
        || finalOperatorCatalogSha256 !== operatorCatalogSha256) {
        throw new Error("adopt-existing catalog changed before evidence commit");
      }
      const finalData = await readAdoptionDataSnapshot(transaction);
      assertEmptyAdoptionData(finalData);
      if (catalogSnapshotSha256(finalData) !== sourceDataSha256) {
        throw new Error("adopt-existing data changed before evidence commit");
      }
      exactJson(
        await extendedRoleInventoryReader(transaction),
        correctedExtendedRoleInventory,
        "adopt-existing extended role inventory changed before evidence commit",
      );
      exactJson(
        await legacyInventoryReader(transaction),
        sourceLegacyInventory,
        "adopt-existing legacy inventory changed before evidence commit",
      );
      await assertSession(transaction, session);
      return Object.freeze({
        ...state,
        runtimeRoleStatus: finalRoleGraph.runtimeRoleStatus,
        adoptedExisting: true,
        adoptedThisRun: Object.freeze(
          plan.migrations.slice(0, WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT)
            .map(({ version }) => version),
        ),
        adoptionSourceCatalogSha256: sourceCatalogSha256,
        adoptionDataSha256: sourceDataSha256,
        adoptionAttestationSha256,
      });
    });
    await assertSession(sql, session);
    return adoption;
  } finally {
    const [unlock] = await queryRows(sql, `
      /* website-projection:unlock */
      SELECT pg_catalog.pg_backend_pid() AS backend_pid,
             session_user::text AS session_user,
             current_role::text AS current_role,
             CASE
               WHEN pg_catalog.pg_backend_pid() = $1
                AND session_user::text = $2
                AND current_role::text = $3
               THEN pg_catalog.pg_advisory_unlock(
                 pg_catalog.hashtextextended('${OPERATOR_LOCK}', 0)
               )
               ELSE false
             END AS released
    `, [session.backendPid, session.sessionUser, session.currentRole]);
    const unlockSession = capturedSession(unlock);
    if (unlockSession.backendPid !== session.backendPid
      || unlockSession.sessionUser !== session.sessionUser
      || unlockSession.currentRole !== session.currentRole
      || unlock?.released !== true) {
      throw new Error("website projection database migration lock was not released");
    }
  }
}

export async function applyWebsiteProjectionMigrations({
  sql,
  workspace,
  plan,
  expectedProjectRef,
  sessionIdentity,
  runtimePassword,
}) {
  validateWebsiteProjectionPlan(plan);
  const session = expectedSession(sessionIdentity);
  const [lock] = await queryRows(sql, `
    /* website-projection:lock */
    SELECT pg_catalog.pg_try_advisory_lock(
             pg_catalog.hashtextextended('${OPERATOR_LOCK}', 0)
           ) AS acquired,
           pg_catalog.pg_backend_pid() AS backend_pid,
           session_user::text AS session_user,
           current_role::text AS current_role
  `);
  const lockSession = capturedSession(lock);
  if (lockSession.backendPid !== session.backendPid
    || lockSession.sessionUser !== session.sessionUser
    || lockSession.currentRole !== session.currentRole) {
    throw new Error("website projection database session changed unexpectedly");
  }
  if (lock?.acquired !== true) {
    throw new Error("another website projection migration operator holds the lock");
  }
  try {
    const initial = await inspectWebsiteProjectionDatabase({
      sql,
      plan,
      expectedProjectRef,
      sessionIdentity: session,
    });
    if (initial.status === "current") {
      return Object.freeze({
        ...initial,
        appliedThisRun: Object.freeze([]),
        roleCreated: false,
      });
    }
    const roleCreated = initial.runtimeRoleStatus === "missing";
    const appliedThisRun = [];
    for (const pending of initial.pending) {
      const migration = plan.migrations.find(
        ({ version }) => version === pending.version,
      );
      if (!migration) {
        throw new Error("pending website projection migration is absent from plan");
      }
      await applyOneMigration({
        sql,
        workspace,
        plan,
        migration,
        expectedProjectRef,
        session,
        bootstrapRuntimePassword:
          roleCreated && migration.ordinal === 1 ? runtimePassword : null,
      });
      appliedThisRun.push(migration.version);
    }
    const final = await inspectWebsiteProjectionDatabase({
      sql,
      plan,
      expectedProjectRef,
      sessionIdentity: session,
    });
    return Object.freeze({
      ...final,
      appliedThisRun: Object.freeze(appliedThisRun),
      roleCreated,
    });
  } finally {
    const [unlock] = await queryRows(sql, `
      /* website-projection:unlock */
      SELECT pg_catalog.pg_backend_pid() AS backend_pid,
             session_user::text AS session_user,
             current_role::text AS current_role,
             CASE
               WHEN pg_catalog.pg_backend_pid() = $1
                AND session_user::text = $2
                AND current_role::text = $3
               THEN pg_catalog.pg_advisory_unlock(
                 pg_catalog.hashtextextended('${OPERATOR_LOCK}', 0)
               )
               ELSE false
             END AS released
    `, [session.backendPid, session.sessionUser, session.currentRole]);
    const unlockSession = capturedSession(unlock);
    if (unlockSession.backendPid !== session.backendPid
      || unlockSession.sessionUser !== session.sessionUser
      || unlockSession.currentRole !== session.currentRole
      || unlock?.released !== true) {
      throw new Error("website projection database migration lock was not released");
    }
  }
}

export const WEBSITE_PROJECTION_OPERATOR_CONTRACT = Object.freeze({
  applicationSchema: WEBSITE_PROJECTION_APPLICATION_SCHEMA,
  evidenceTable: WEBSITE_PROJECTION_EVIDENCE_TABLE,
  runtimeRole: WEBSITE_PROJECTION_RUNTIME_ROLE,
  relevantRoles: Object.freeze(RELEVANT_ROLES),
});
