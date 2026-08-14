import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  assertWebsiteProjectionRoleGraph,
  catalogSnapshotSha256,
  compareWebsiteProjectionEvidence,
  unwrapWebsiteProjectionMigration,
  validateWebsiteProjectionPlan,
  validateWebsiteProjectionRuntimePassword,
  WEBSITE_PROJECTION_APPLICATION_SCHEMA,
  WEBSITE_PROJECTION_EVIDENCE_SCHEMA,
  WEBSITE_PROJECTION_EVIDENCE_TABLE,
  WEBSITE_PROJECTION_RUNTIME_ROLE,
} from "./website-projection-db-operator-core.mjs";
import { sha256 } from "./data-pipeline/hosted-db-operator-core.mjs";

const OPERATOR_LOCK = "programmable:website-projection-migrations:v1";
const RELEVANT_ROLES = [
  "postgres",
  WEBSITE_PROJECTION_RUNTIME_ROLE,
  "anon",
  "authenticated",
  "service_role",
];

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
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT migration_evidence_v1_pk PRIMARY KEY (ordinal),
  CONSTRAINT migration_evidence_v1_version_unique UNIQUE (version),
  CONSTRAINT migration_evidence_v1_file_unique UNIQUE (file_name),
  CONSTRAINT migration_evidence_v1_ordinal_check CHECK (ordinal BETWEEN 1 AND 5),
  CONSTRAINT migration_evidence_v1_version_check CHECK (version ~ '^000[1-5]$'),
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
    CHECK (operator_catalog_sha256 ~ '^0x[0-9a-f]{64}$')
);
REVOKE ALL ON programmable_website_projection_migrations.migration_evidence_v1
  FROM PUBLIC, anon, authenticated, service_role,
       programmable_website_projection_runtime;
`;

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

function rows(value) {
  return Array.isArray(value) ? value.map((row) => ({ ...row })) : [];
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

async function readRoleGraph(sql, appliedCount) {
  const roles = await queryRows(sql, `
    /* website-projection:roles */
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
           rolcanlogin, rolreplication, rolbypassrls
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
           membership.admin_option
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
     WHERE member.rolname IN (
       'programmable_website_projection_runtime',
       'anon', 'authenticated', 'service_role'
     ) OR granted.rolname IN (
       'programmable_website_projection_runtime',
       'anon', 'authenticated', 'service_role'
     )
     ORDER BY member.rolname, granted.rolname
  `);
  return {
    roles,
    memberships,
    ...assertWebsiteProjectionRoleGraph({ roles, memberships, appliedCount }),
  };
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
           )::text AS evidence_table
  `);
  const applicationSchemaPresent =
    presence?.application_schema === WEBSITE_PROJECTION_APPLICATION_SCHEMA;
  const evidenceSchemaPresent =
    presence?.evidence_schema === WEBSITE_PROJECTION_EVIDENCE_SCHEMA;
  const evidenceTablePresent =
    presence?.evidence_table === WEBSITE_PROJECTION_EVIDENCE_TABLE;
  if (evidenceSchemaPresent !== evidenceTablePresent) {
    throw new Error("website projection operator evidence infrastructure is partial");
  }
  const evidenceRows = evidenceTablePresent
    ? await queryRows(sql, `
        /* website-projection:evidence */
        SELECT ordinal, version, name, file_name, file_sha256,
               execution_sha256, plan_sha256, repository_commit,
               repository_tree, target_project_ref, catalog_sha256,
               operator_catalog_sha256
          FROM programmable_website_projection_migrations.migration_evidence_v1
         ORDER BY ordinal
      `)
    : [];
  return {
    applicationSchemaPresent,
    evidenceSchemaPresent,
    evidenceTablePresent,
    evidenceRows,
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
}) {
  await queryRows(transaction, `
    INSERT INTO programmable_website_projection_migrations.migration_evidence_v1 (
      ordinal, version, name, file_name, file_sha256, execution_sha256,
      plan_sha256, repository_commit, repository_tree, target_project_ref,
      catalog_sha256, operator_catalog_sha256
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      await executeSimple(transaction, EVIDENCE_DDL);
    }
    await executeSimple(transaction, executionSource);
    if (migration.ordinal === plan.migrationCount) {
      await executeSimple(transaction, FINAL_PRIVILEGES);
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
