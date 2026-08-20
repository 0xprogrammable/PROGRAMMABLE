import { Pool } from "pg";

import {
  canonicalJson,
} from "./data-pipeline/hosted-db-operator-core.mjs";
import {
  inspectWebsiteProjectionCurrentRotationPosture,
} from "./website-projection-db-postgres.mjs";
import {
  assertWebsiteProjectionRuntimeCredentialProbe,
  validateWebsiteProjectionRotationPassword,
  validateWebsiteProjectionRuntimeDatabaseUrl,
} from "./website-projection-db-credential-rotation-core.mjs";
import {
  WEBSITE_PROJECTION_RUNTIME_ROLE,
} from "./website-projection-db-operator-core.mjs";

const ROTATION_LOCK =
  "programmable:website-projection-migrations:v1";

async function queryRows(sql, statement, parameters = []) {
  return await sql.unsafe(statement, parameters);
}

async function executeSimple(sql, statement) {
  const operation = sql.unsafe(statement);
  return await (typeof operation.simple === "function"
    ? operation.simple()
    : operation);
}

function samePosture(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export async function setWebsiteProjectionRuntimePassword(
  transaction,
  runtimePassword,
) {
  const password = validateWebsiteProjectionRotationPassword(runtimePassword);
  await queryRows(transaction, `
    SELECT pg_catalog.set_config(
      'programmable.website_projection_runtime_rotation_password', $1, true
    ) AS configured
  `, [password]);
  await executeSimple(transaction, `
    DO $runtime_credential_rotation$
    DECLARE
      runtime_password text := pg_catalog.current_setting(
        'programmable.website_projection_runtime_rotation_password', true
      );
    BEGIN
      IF current_role::text <> 'postgres' THEN
        RAISE EXCEPTION 'website projection rotation authority changed';
      END IF;
      IF runtime_password IS NULL
        OR pg_catalog.octet_length(runtime_password) < 24
        OR pg_catalog.octet_length(runtime_password) > 512
      THEN
        RAISE EXCEPTION 'website projection rotation password is unavailable';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_roles
         WHERE rolname = 'programmable_website_projection_runtime'
           AND rolcanlogin
           AND NOT rolinherit
           AND NOT rolsuper
           AND NOT rolcreaterole
           AND NOT rolcreatedb
           AND NOT rolreplication
           AND NOT rolbypassrls
      ) THEN
        RAISE EXCEPTION 'website projection runtime role posture changed';
      END IF;
      EXECUTE pg_catalog.format(
        'ALTER ROLE %I PASSWORD %L',
        'programmable_website_projection_runtime',
        runtime_password
      );
      PERFORM pg_catalog.set_config(
        'programmable.website_projection_runtime_rotation_password', '', true
      );
    END
    $runtime_credential_rotation$;
  `);
  const [cleared] = await queryRows(transaction, `
    SELECT pg_catalog.current_setting(
      'programmable.website_projection_runtime_rotation_password', true
    ) AS value
  `);
  if (cleared?.value !== "") {
    throw new Error("website projection rotation password was not cleared");
  }
}

export async function rotateWebsiteProjectionRuntimeCredential({
  sql,
  plan,
  expectedProjectRef,
  sessionIdentity,
  runtimePassword,
}, {
  postureInspector = inspectWebsiteProjectionCurrentRotationPosture,
  passwordSetter = setWebsiteProjectionRuntimePassword,
} = {}) {
  validateWebsiteProjectionRotationPassword(runtimePassword);
  const [lock] = await queryRows(sql, `
    /* website-projection:credential-rotation-lock */
    SELECT pg_catalog.pg_try_advisory_lock(
      pg_catalog.hashtextextended('${ROTATION_LOCK}', 0)
    ) AS acquired,
    pg_catalog.pg_backend_pid() AS backend_pid,
    session_user::text AS session_user,
    current_role::text AS current_role
  `);
  if (lock?.acquired !== true
    || Number(lock.backend_pid) !== Number(sessionIdentity?.backendPid)
    || lock.session_user !== sessionIdentity?.sessionUser
    || lock.current_role !== sessionIdentity?.currentRole) {
    throw new Error("website projection credential rotation lock is unavailable");
  }
  let credentialMayBeCommitted = false;
  let outcome;
  let failure;
  try {
    const before = await postureInspector({
      sql,
      plan,
      expectedProjectRef,
      sessionIdentity,
    });
    const committed = await sql.begin(async (transaction) => {
      await executeSimple(transaction,
        "SET LOCAL lock_timeout = '4s'; SET LOCAL statement_timeout = '2min';");
      const transactionBefore =
        await postureInspector({
          sql: transaction,
          plan,
          expectedProjectRef,
          sessionIdentity,
        });
      if (!samePosture(transactionBefore, before)) {
        throw new Error("website projection rotation posture changed before mutation");
      }
      credentialMayBeCommitted = true;
      await passwordSetter(transaction, runtimePassword);
      const transactionAfter =
        await postureInspector({
          sql: transaction,
          plan,
          expectedProjectRef,
          sessionIdentity,
        });
      if (!samePosture(transactionAfter, transactionBefore)) {
        throw new Error("website projection rotation changed non-credential state");
      }
      return transactionAfter;
    });
    const after = await postureInspector({
      sql,
      plan,
      expectedProjectRef,
      sessionIdentity,
    });
    if (!samePosture(after, committed) || !samePosture(after, before)) {
      throw new Error("website projection posture changed across credential commit");
    }
    outcome = Object.freeze({ before, after });
  } catch (error) {
    failure = error;
  }
  try {
    const [unlock] = await queryRows(sql, `
      /* website-projection:credential-rotation-unlock */
      SELECT CASE
        WHEN pg_catalog.pg_backend_pid() = $1
         AND session_user::text = $2
         AND current_role::text = $3
        THEN pg_catalog.pg_advisory_unlock(
          pg_catalog.hashtextextended('${ROTATION_LOCK}', 0)
        )
        ELSE false
      END AS released,
      pg_catalog.pg_backend_pid() AS backend_pid,
      session_user::text AS session_user,
      current_role::text AS current_role
    `, [
      sessionIdentity.backendPid,
      sessionIdentity.sessionUser,
      sessionIdentity.currentRole,
    ]);
    if (unlock?.released !== true
      || Number(unlock.backend_pid) !== Number(sessionIdentity.backendPid)
      || unlock.session_user !== sessionIdentity.sessionUser
      || unlock.current_role !== sessionIdentity.currentRole) {
      throw new Error("website projection credential rotation lock was not released");
    }
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) {
    if (credentialMayBeCommitted) {
      const postCommitFailure = new Error(
        "website projection credential commit is active or ambiguous",
        { cause: failure },
      );
      postCommitFailure.code = "WPR01";
      throw postCommitFailure;
    }
    throw failure;
  }
  return outcome;
}

const RUNTIME_PROBE_SQL = `
  SELECT current_user::text AS runtime_role,
         session_user::text AS session_role,
         pg_catalog.current_database() AS database_name,
         pg_catalog.current_setting('server_version_num') AS server_version_num,
         role.rolsuper, role.rolinherit, role.rolcreaterole, role.rolcreatedb,
         role.rolreplication, role.rolbypassrls,
         pg_catalog.has_schema_privilege(current_user,
           'programmable_website_projection_v1', 'USAGE') AS schema_usage,
         pg_catalog.has_schema_privilege(current_user,
           'programmable_website_projection_v1', 'CREATE') AS schema_create,
         (
           pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.projection_records',
             'SELECT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.projection_records',
             'INSERT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.credential_uses',
             'SELECT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.credential_uses',
             'INSERT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.registry_custom_launch_records',
             'SELECT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.registry_custom_launch_records',
             'INSERT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.generic_launch_materializations_v2',
             'SELECT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.generic_launch_materializations_v2',
             'INSERT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.generic_launch_reconciliations_v2',
             'SELECT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.generic_launch_reconciliations_v2',
             'INSERT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2',
             'SELECT')
           AND pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2',
             'INSERT')
         ) AS required_runtime_privileges,
         (
           pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.projection_records',
             'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.credential_uses',
             'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.registry_custom_launch_records',
             'DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.generic_launch_materializations_v2',
             'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.generic_launch_reconciliations_v2',
             'DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_table_privilege(current_user,
             'programmable_website_projection_v1.generic_launch_reconciliation_attempts_v2',
             'DELETE,TRUNCATE,REFERENCES,TRIGGER')
         ) AS forbidden_runtime_privileges,
         EXISTS (
           SELECT 1
             FROM pg_catalog.pg_class class
             JOIN pg_catalog.pg_namespace namespace
               ON namespace.oid = class.relnamespace
            WHERE namespace.nspname IN (
              'programmable_website_projection_v1',
              'programmable_website_projection_migrations'
            )
              AND class.relowner = role.oid
         ) OR EXISTS (
           SELECT 1 FROM pg_catalog.pg_namespace namespace
            WHERE namespace.nspname IN (
              'programmable_website_projection_v1',
              'programmable_website_projection_migrations'
            )
              AND namespace.nspowner = role.oid
         ) AS owns_application_objects,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_auth_members membership
            WHERE membership.member = role.oid
         ) AS has_forbidden_membership,
         COALESCE(ssl.ssl, false) AS ssl,
         ssl.version AS ssl_version,
         ssl.cipher AS ssl_cipher,
         ssl.bits AS ssl_bits
    FROM pg_catalog.pg_roles role
    LEFT JOIN pg_catalog.pg_stat_ssl ssl
      ON ssl.pid = pg_catalog.pg_backend_pid()
   WHERE role.rolname = current_user
`;

export async function probeWebsiteProjectionRuntimeCredential({
  databaseUrl,
  expectedProjectRef,
  sslCaPem,
}, { PoolClass = Pool } = {}) {
  const target = validateWebsiteProjectionRuntimeDatabaseUrl(databaseUrl, {
    projectRef: expectedProjectRef,
  });
  if (typeof sslCaPem !== "string"
    || sslCaPem.length < 64
    || sslCaPem.length > 131_072
    || !sslCaPem.includes("-----BEGIN CERTIFICATE-----")
    || !sslCaPem.includes("-----END CERTIFICATE-----")) {
    throw new Error("website projection runtime CA is invalid");
  }
  const pool = new PoolClass({
    connectionString: databaseUrl,
    ssl: {
      ca: sslCaPem,
      rejectUnauthorized: true,
      servername: target.host,
    },
    max: 1,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 1_000,
    allowExitOnIdle: true,
    application_name: "programmable-website-projection-credential-probe-v1",
  });
  try {
    const result = await pool.query(RUNTIME_PROBE_SQL);
    if (result.rows.length !== 1) {
      throw new Error("website projection runtime credential probe failed");
    }
    return Object.freeze({
      target,
      attestation: assertWebsiteProjectionRuntimeCredentialProbe(result.rows[0]),
    });
  } finally {
    await pool.end().catch(() => {});
  }
}

export const WEBSITE_PROJECTION_ROTATION_POSTGRES_CONTRACT = Object.freeze({
  lock: ROTATION_LOCK,
  runtimeRole: WEBSITE_PROJECTION_RUNTIME_ROLE,
  runtimeProbeSql: RUNTIME_PROBE_SQL,
});
