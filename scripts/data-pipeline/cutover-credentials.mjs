import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  constants as fsConstants,
  chmod,
  lstat,
  mkdtemp,
  open,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import postgres from "postgres";

import {
  assertNoSecretOutput,
  canonicalJson,
  sha256,
  validateDirectSupabaseTarget,
} from "./hosted-db-operator-core.mjs";
import {
  closeHostedDatabase,
  openHostedDatabase,
} from "./hosted-db-postgres.mjs";

const executeFile = promisify(execFile);
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const OPERATION_ID = /^[a-z0-9][a-z0-9._-]{7,63}$/u;
const ISOLATION_ID = /^[a-z0-9][a-z0-9_-]{7,31}$/u;
const SHA256 = /^0x[0-9a-f]{64}$/u;
const PG_TOOL_VERSION = /\b(\d+)\.(?:\d+)(?:\.\d+)?\b/u;
const RESTORE_DATABASE_PREFIX = "programmable_restore_";
const BACKUP_SCHEMAS = Object.freeze([
  "programmable_private",
  "programmable_release_probe_private",
  "supabase_migrations",
]);
const RESTORE_ROLE_NAMES = Object.freeze([
  "programmable_api_reader",
  "programmable_api_reader_login",
  "programmable_maintenance",
  "programmable_migrator",
  "programmable_operator",
  "programmable_profile_binder",
  "programmable_profile_recovery",
  "programmable_profile_writer",
  "programmable_projector",
  "programmable_projector_login",
  "programmable_projector_runtime",
  "programmable_projector_runtime_login",
  "programmable_reconciler",
  "programmable_reconciler_login",
  "programmable_release_probe_nonce",
  "programmable_release_probe_nonce_login",
]);

function freezeRoleSpec(spec) {
  return Object.freeze(spec);
}

export const ROLE_SPECS = Object.freeze([
  freezeRoleSpec({
    key: "apiReader",
    loginRole: "programmable_api_reader_login",
    capabilityRole: "programmable_api_reader",
  }),
  freezeRoleSpec({
    key: "projector",
    loginRole: "programmable_projector_login",
    capabilityRole: "programmable_projector",
  }),
  freezeRoleSpec({
    key: "projectorRuntime",
    loginRole: "programmable_projector_runtime_login",
    capabilityRole: "programmable_projector_runtime",
  }),
  freezeRoleSpec({
    key: "reconciler",
    loginRole: "programmable_reconciler_login",
    capabilityRole: "programmable_reconciler",
  }),
  freezeRoleSpec({
    key: "releaseProbe",
    loginRole: "programmable_release_probe_nonce_login",
    capabilityRole: "programmable_release_probe_nonce",
  }),
]);

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateCaPem(value, label = "Postgres CA") {
  if (
    typeof value !== "string" ||
    value.length < 64 ||
    value.length > 32_768 ||
    !value.includes("-----BEGIN CERTIFICATE-----") ||
    !value.includes("-----END CERTIFICATE-----") ||
    value.includes("PRIVATE KEY")
  ) {
    throw new Error(`${label} must be a server-only PEM certificate`);
  }
  return value;
}

function readExactCredentials(credentials) {
  if (!isPlainRecord(credentials)) {
    throw new Error("exactly five login-role credentials are required");
  }
  const expectedKeys = ROLE_SPECS.map(({ key }) => key).sort();
  const actualKeys = Object.keys(credentials).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("exactly five login-role credentials are required");
  }
  const values = new Map();
  const uniquePasswords = new Set();
  for (const spec of ROLE_SPECS) {
    const descriptor = Object.getOwnPropertyDescriptor(credentials, spec.key);
    const password = descriptor?.value;
    if (
      !descriptor ||
      descriptor.get ||
      descriptor.set ||
      typeof password !== "string" ||
      password.length < 32 ||
      password.length > 256 ||
      [...password].some((character) => {
        const code = character.codePointAt(0);
        return code === undefined || code < 0x21 || code > 0x7e;
      })
    ) {
      throw new Error(`credential ${spec.key} is not a valid generated password`);
    }
    if (uniquePasswords.has(password)) {
      throw new Error("login-role credentials must be unique");
    }
    uniquePasswords.add(password);
    values.set(spec.key, password);
  }
  return values;
}

function errorCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{2,16}$/u.test(code)
    ? code
    : undefined;
}

function operationalFailure(label, error) {
  const code = errorCode(error);
  return new Error(`${label} failed${code ? ` (${code})` : ""}`);
}

function validateDependencies(value, allowed) {
  if (value === undefined) return Object.freeze({});
  if (!isPlainRecord(value)) throw new Error("dependencies must be an object");
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key) || typeof value[key] !== "function") {
      throw new Error("dependencies contain an unsupported entry");
    }
  }
  return value;
}

function staticRolePasswordSql(spec) {
  return `
do $credential_rotation$
declare
  credential_value text;
begin
  credential_value := pg_catalog.current_setting(
    'programmable.credential_rotation', true
  );
  if credential_value is null or pg_catalog.length(credential_value) < 32 then
    raise exception 'credential rotation input is absent';
  end if;
  execute pg_catalog.format(
    'alter role %I password %L valid until %L',
    '${spec.loginRole}',
    credential_value,
    'infinity'
  );
  perform pg_catalog.set_config(
    'programmable.credential_rotation', '', true
  );
end
$credential_rotation$;
`;
}

function isExactRoleFlagPosture(row, expectedLogin) {
  return (
    row &&
    row.rolcanlogin === expectedLogin &&
    row.rolsuper === false &&
    row.rolcreatedb === false &&
    row.rolcreaterole === false &&
    row.rolinherit === false &&
    row.rolreplication === false &&
    row.rolbypassrls === false &&
    Number(row.rolconnlimit) === -1 &&
    (row.rolconfig === null ||
      (Array.isArray(row.rolconfig) && row.rolconfig.length === 0))
  );
}

async function readRolePosture(sql, { requirePasswords }) {
  const names = ROLE_SPECS.flatMap(({ loginRole, capabilityRole }) => [
    loginRole,
    capabilityRole,
  ]);
  const rows = await sql.unsafe(
    `
      select
        roles.rolname,
        roles.rolcanlogin,
        roles.rolsuper,
        roles.rolcreatedb,
        roles.rolcreaterole,
        roles.rolinherit,
        roles.rolreplication,
        roles.rolbypassrls,
        roles.rolconnlimit,
        roles.rolconfig,
        auth.rolpassword is not null as has_password
      from pg_catalog.pg_roles as roles
      join pg_catalog.pg_authid as auth
        on auth.rolname = roles.rolname
      where roles.rolname = any($1::text[])
      order by roles.rolname
    `,
    [names],
  );
  const memberships = await sql.unsafe(
    `
      select
        member_role.rolname as member_role,
        granted_role.rolname as granted_role,
        membership.admin_option,
        membership.inherit_option,
        membership.set_option
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
      where member_role.rolname = any($1::text[])
      order by member_role.rolname, granted_role.rolname
    `,
    [ROLE_SPECS.map(({ loginRole }) => loginRole)],
  );
  return { rows, memberships, requirePasswords };
}

async function readPoolerRolePosture(sql) {
  const names = ROLE_SPECS.flatMap(({ loginRole, capabilityRole }) => [
    loginRole,
    capabilityRole,
  ]);
  const rows = await sql.unsafe(
    `
      select
        rolname,
        rolcanlogin,
        rolsuper,
        rolcreatedb,
        rolcreaterole,
        rolinherit,
        rolreplication,
        rolbypassrls,
        rolconnlimit,
        rolconfig,
        false as has_password
      from pg_catalog.pg_roles
      where rolname = any($1::text[])
      order by rolname
    `,
    [names],
  );
  const memberships = await sql.unsafe(
    `
      select
        member_role.rolname as member_role,
        granted_role.rolname as granted_role,
        membership.admin_option,
        membership.inherit_option,
        membership.set_option
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
      where member_role.rolname = any($1::text[])
      order by member_role.rolname, granted_role.rolname
    `,
    [ROLE_SPECS.map(({ loginRole }) => loginRole)],
  );
  return { rows, memberships, requirePasswords: false };
}

function assertRolePosture(posture) {
  if (!posture || !Array.isArray(posture.rows) || !Array.isArray(posture.memberships)) {
    throw new Error("database role posture response is invalid");
  }
  const rowByName = new Map(posture.rows.map((row) => [row?.rolname, row]));
  if (rowByName.size !== ROLE_SPECS.length * 2) {
    throw new Error("database role set does not match the reviewed role set");
  }
  for (const spec of ROLE_SPECS) {
    const login = rowByName.get(spec.loginRole);
    const capability = rowByName.get(spec.capabilityRole);
    if (
      !isExactRoleFlagPosture(login, true) ||
      !isExactRoleFlagPosture(capability, false) ||
      (posture.requirePasswords === true && login.has_password !== true)
    ) {
      throw new Error("database role posture does not match the reviewed posture");
    }
    const memberships = posture.memberships.filter(
      ({ member_role: memberRole }) => memberRole === spec.loginRole,
    );
    if (
      memberships.length !== 1 ||
      memberships[0]?.granted_role !== spec.capabilityRole ||
      memberships[0]?.admin_option !== false ||
      memberships[0]?.inherit_option !== false ||
      memberships[0]?.set_option !== true
    ) {
      throw new Error("database role membership does not match the reviewed posture");
    }
  }
  return true;
}

async function assertDirectOperatorIdentity(sql) {
  const [identity] = await sql.unsafe(`
    select
      session_user::text as session_user,
      current_user::text as current_user,
      current_role::text as current_role,
      pg_catalog.current_database()::text as database_name,
      pg_catalog.inet_server_port()::integer as server_port
  `);
  if (
    identity?.session_user !== "postgres" ||
    identity?.current_user !== "postgres" ||
    identity?.current_role !== "postgres" ||
    identity?.database_name !== "postgres" ||
    Number(identity?.server_port) !== 5432
  ) {
    throw new Error("direct database operator identity is not approved");
  }
}

async function rotateLoginPassword(sql, spec, password) {
  await sql.begin(async (transaction) => {
    const [identity] = await transaction.unsafe(`
      select session_user::text as session_user,
             current_role::text as current_role
    `);
    if (
      identity?.session_user !== "postgres" ||
      identity?.current_role !== "postgres"
    ) {
      throw new Error("credential rotation operator identity changed");
    }
    await transaction`
      select pg_catalog.set_config(
        'programmable.credential_rotation', ${password}, true
      )
    `;
    await transaction.unsafe(staticRolePasswordSql(spec)).simple();
  });
}

export async function provisionLoginRoles(input) {
  if (!isPlainRecord(input)) throw new Error("provisioning input is invalid");
  const credentials = readExactCredentials(input.credentials);
  validateCaPem(input.sslCaPem);
  const target = validateDirectSupabaseTarget(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const dependencies = validateDependencies(input.dependencies, [
    "openHostedDatabase",
    "closeHostedDatabase",
    "assertDirectOperatorIdentity",
    "readRolePosture",
    "rotateLoginPassword",
  ]);
  const openDatabase = dependencies.openHostedDatabase ?? openHostedDatabase;
  const closeDatabase = dependencies.closeHostedDatabase ?? closeHostedDatabase;
  const assertIdentity =
    dependencies.assertDirectOperatorIdentity ?? assertDirectOperatorIdentity;
  const inspect = dependencies.readRolePosture ?? readRolePosture;
  const rotate = dependencies.rotateLoginPassword ?? rotateLoginPassword;
  let connection;
  try {
    connection = await openDatabase({
      databaseUrl: input.databaseUrl,
      expectedProjectRef: input.expectedProjectRef,
      sslCaPem: input.sslCaPem,
    });
    if (canonicalJson(connection.target) !== canonicalJson(target)) {
      throw new Error("direct database target identity changed");
    }
    await assertIdentity(connection.sql);
    assertRolePosture(
      await inspect(connection.sql, { requirePasswords: false }),
    );
    for (const spec of ROLE_SPECS) {
      await rotate(connection.sql, spec, credentials.get(spec.key));
    }
    assertRolePosture(
      await inspect(connection.sql, { requirePasswords: true }),
    );
    return Object.freeze({
      kind: "programmable-login-role-provisioning-result",
      schemaVersion: 1,
      target,
      roles: Object.freeze(
        ROLE_SPECS.map(({ loginRole, capabilityRole }) =>
          Object.freeze({ loginRole, capabilityRole, provisioned: true }),
        ),
      ),
    });
  } catch (error) {
    throw operationalFailure("login-role provisioning", error);
  } finally {
    if (connection?.sql) await closeDatabase(connection.sql).catch(() => {});
  }
}

function validatePoolerTarget({ expectedProjectRef, poolerHost }) {
  if (!PROJECT_REF.test(expectedProjectRef ?? "")) {
    throw new Error("expected Supabase project ref is invalid");
  }
  if (
    typeof poolerHost !== "string" ||
    !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(poolerHost)
  ) {
    throw new Error("shared Supabase pooler host is invalid");
  }
  return Object.freeze({
    projectRef: expectedProjectRef,
    host: poolerHost,
    port: 6543,
    database: "postgres",
    sslMode: "verify-full",
    prepare: false,
  });
}

function poolerConnectionUrl(target, spec, password) {
  const url = new URL("postgresql://placeholder:placeholder@localhost/postgres");
  url.hostname = target.host;
  url.port = String(target.port);
  url.username = `${spec.loginRole}.${target.projectRef}`;
  url.password = password;
  url.searchParams.set("sslmode", "verify-full");
  return url;
}

async function openPoolerDatabase({ target, spec, password, sslCaPem }) {
  const connectionUrl = poolerConnectionUrl(target, spec, password);
  connectionUrl.searchParams.delete("sslmode");
  const sql = postgres(connectionUrl.toString(), {
    ssl: { rejectUnauthorized: true, ca: sslCaPem },
    max: 1,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 5,
    max_lifetime: 30,
    onnotice: () => {},
    connection: {
      application_name: "programmable-pooler-role-verifier",
    },
  });
  return { sql };
}

async function closePoolerDatabase(sql) {
  await sql.end({ timeout: 3 });
}

function staticSetLocalRoleSql(spec) {
  return `set local role ${spec.capabilityRole}`;
}

async function verifyPoolerSession(sql, spec) {
  return sql.begin(async (transaction) => {
    const [before] = await transaction.unsafe(`
      select
        session_user::text as session_user,
        current_role::text as current_role,
        pg_catalog.current_database()::text as database_name
    `);
    if (
      before?.session_user !== spec.loginRole ||
      before?.current_role !== spec.loginRole ||
      before?.database_name !== "postgres"
    ) {
      throw new Error("pooler session login identity does not match");
    }
    await transaction.unsafe(staticSetLocalRoleSql(spec)).simple();
    const [after] = await transaction.unsafe(`
      select
        session_user::text as session_user,
        current_role::text as current_role,
        pg_catalog.current_setting('role', true)::text as configured_role,
        pg_catalog.current_database()::text as database_name
    `);
    if (
      after?.session_user !== spec.loginRole ||
      after?.current_role !== spec.capabilityRole ||
      after?.configured_role !== spec.capabilityRole ||
      after?.database_name !== "postgres"
    ) {
      throw new Error("pooler session capability identity does not match");
    }
    return Object.freeze({
      loginRole: spec.loginRole,
      capabilityRole: spec.capabilityRole,
      verified: true,
    });
  });
}

export async function verifyPoolerLogins(input) {
  if (!isPlainRecord(input)) throw new Error("pooler verification input is invalid");
  const credentials = readExactCredentials(input.credentials);
  const sslCaPem = validateCaPem(input.sslCaPem);
  const target = validatePoolerTarget(input);
  const dependencies = validateDependencies(input.dependencies, [
    "openPoolerDatabase",
    "closePoolerDatabase",
    "readPoolerRolePosture",
    "verifyPoolerSession",
  ]);
  const openDatabase = dependencies.openPoolerDatabase ?? openPoolerDatabase;
  const closeDatabase = dependencies.closePoolerDatabase ?? closePoolerDatabase;
  const inspectPosture =
    dependencies.readPoolerRolePosture ?? readPoolerRolePosture;
  const verifySession = dependencies.verifyPoolerSession ?? verifyPoolerSession;
  const roles = [];
  try {
    for (const spec of ROLE_SPECS) {
      let connection;
      try {
        connection = await openDatabase({
          target,
          spec,
          password: credentials.get(spec.key),
          sslCaPem,
          options: Object.freeze({ prepare: false }),
        });
        assertRolePosture(await inspectPosture(connection.sql));
        roles.push(await verifySession(connection.sql, spec));
      } finally {
        if (connection?.sql) await closeDatabase(connection.sql).catch(() => {});
      }
    }
    if (roles.length !== ROLE_SPECS.length) {
      throw new Error("not every reviewed pooler login was verified");
    }
    return Object.freeze({
      kind: "programmable-pooler-login-verification-result",
      schemaVersion: 1,
      target,
      roles: Object.freeze(roles),
    });
  } catch (error) {
    throw operationalFailure("pooler login verification", error);
  }
}

function decodeUrlComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("database credential encoding is invalid");
  }
}

function parseSourceTarget(databaseUrl, expectedProjectRef) {
  const safeTarget = validateDirectSupabaseTarget(
    databaseUrl,
    expectedProjectRef,
  );
  const parsed = new URL(databaseUrl);
  const password = decodeUrlComponent(parsed.password);
  if (password.length < 1 || /[\u0000-\u001f\u007f]/u.test(password)) {
    throw new Error("source database credential is invalid");
  }
  return { safeTarget, password, username: "postgres" };
}

function parseRestoreTarget(databaseUrl, isolationId) {
  if (!ISOLATION_ID.test(isolationId ?? "")) {
    throw new Error("restore isolation id is invalid");
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("isolated restore database URL is invalid");
  }
  const parameters = [...parsed.searchParams.entries()];
  const expectedDatabase = `${RESTORE_DATABASE_PREFIX}${isolationId}`;
  const port = Number(parsed.port);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "[::1]", "::1", "localhost"].includes(parsed.hostname) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    parsed.pathname !== `/${expectedDatabase}` ||
    parsed.username !== "postgres" ||
    parsed.password.length < 1 ||
    parsed.hash !== "" ||
    parameters.length !== 1 ||
    parameters[0][0] !== "sslmode" ||
    parameters[0][1] !== "verify-full"
  ) {
    throw new Error(
      "restore target must be an isolated loopback database with sslmode=verify-full",
    );
  }
  const password = decodeUrlComponent(parsed.password);
  if (/[\u0000-\u001f\u007f]/u.test(password)) {
    throw new Error("restore database credential is invalid");
  }
  return {
    safeTarget: Object.freeze({
      isolationId,
      host: parsed.hostname,
      port,
      database: expectedDatabase,
      sslMode: "verify-full",
    }),
    password,
    username: "postgres",
  };
}

function validateAbsoluteOutputPath(value, label) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    value.length > 1024 ||
    path.basename(value) === "" ||
    value.includes("\u0000")
  ) {
    throw new Error(`${label} must be an absolute file path`);
  }
  return path.normalize(value);
}

function backupRequestPayload({
  operationId,
  repositoryCommit,
  source,
  restore,
}) {
  return {
    kind: "programmable-database-backup-restore-request",
    schemaVersion: 1,
    operationId,
    repositoryCommit,
    source,
    restore,
    schemas: BACKUP_SCHEMAS,
    format: "targeted-schema-backup-v2",
  };
}

function validateBackupRequest(input) {
  if (!isPlainRecord(input)) throw new Error("backup and restore input is invalid");
  if (!OPERATION_ID.test(input.operationId ?? "")) {
    throw new Error("backup operation id is invalid");
  }
  if (!COMMIT.test(input.repositoryCommit ?? "")) {
    throw new Error("repository commit must be an exact full commit hash");
  }
  const sslCaPem = validateCaPem(input.sslCaPem, "source Postgres CA");
  const restoreSslCaPem = validateCaPem(
    input.restoreSslCaPem,
    "restore Postgres CA",
  );
  const source = parseSourceTarget(
    input.sourceDatabaseUrl,
    input.expectedProjectRef,
  );
  const restore = parseRestoreTarget(
    input.restoreDatabaseUrl,
    input.restoreIsolationId,
  );
  const backupPath = validateAbsoluteOutputPath(input.backupPath, "backup path");
  const evidencePath = validateAbsoluteOutputPath(
    input.evidencePath,
    "evidence path",
  );
  if (backupPath === evidencePath) {
    throw new Error("backup and evidence paths must differ");
  }
  const payload = backupRequestPayload({
    operationId: input.operationId,
    repositoryCommit: input.repositoryCommit,
    source: source.safeTarget,
    restore: restore.safeTarget,
  });
  return {
    operationId: input.operationId,
    repositoryCommit: input.repositoryCommit,
    source,
    restore,
    sslCaPem,
    restoreSslCaPem,
    backupPath,
    evidencePath,
    requestSha256: sha256(canonicalJson(payload)),
  };
}

async function safeExistingFile(filePath) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new Error("operator artifact is not a private regular file");
  }
  return metadata;
}

async function fileSha256(filePath) {
  const contents = await readFile(filePath);
  return {
    bytes: contents.byteLength,
    sha256: sha256(contents),
  };
}

function validateStoredEvidence(value, request) {
  if (
    !isPlainRecord(value) ||
    value.kind !== "programmable-database-backup-restore-evidence" ||
    value.schemaVersion !== 1 ||
    value.operationId !== request.operationId ||
    value.repositoryCommit !== request.repositoryCommit ||
    value.requestSha256 !== request.requestSha256 ||
    canonicalJson(value.source) !== canonicalJson(request.source.safeTarget) ||
    canonicalJson(value.restore) !== canonicalJson(request.restore.safeTarget) ||
    !isPlainRecord(value.backup) ||
    !SHA256.test(value.backup.sha256 ?? "") ||
    !SHA256.test(value.backup.archiveListSha256 ?? "") ||
    !["pg-custom-v1", "empty-target-schemas-v1"].includes(
      value.backup.format,
    ) ||
    !Number.isSafeInteger(value.backup.bytes) ||
    value.backup.bytes <= 0 ||
    !SHA256.test(value.sourceManifestSha256 ?? "") ||
    value.restoredManifestSha256 !== value.sourceManifestSha256 ||
    !Number.isSafeInteger(value.tableCount) ||
    value.tableCount < 0 ||
    !Number.isSafeInteger(value.rowCount) ||
    value.rowCount < 0 ||
    (value.tableCount === 0) !==
      (value.backup.format === "empty-target-schemas-v1") ||
    !/^PostgreSQL 17\./u.test(value.postgresVersion ?? "") ||
    !Number.isFinite(Date.parse(value.createdAt ?? ""))
  ) {
    throw new Error("stored backup and restore evidence is invalid or conflicting");
  }
  return value;
}

async function readIdempotentEvidence(request) {
  const [backupMetadata, evidenceMetadata] = await Promise.all([
    safeExistingFile(request.backupPath),
    safeExistingFile(request.evidencePath),
  ]);
  if (!backupMetadata && !evidenceMetadata) return null;
  if (!backupMetadata || !evidenceMetadata) {
    throw new Error("partial backup evidence conflicts with the requested operation");
  }
  let evidence;
  try {
    evidence = JSON.parse(await readFile(request.evidencePath, "utf8"));
  } catch {
    throw new Error("stored backup and restore evidence is invalid or conflicting");
  }
  validateStoredEvidence(evidence, request);
  const backup = await fileSha256(request.backupPath);
  if (
    backup.sha256 !== evidence.backup.sha256 ||
    backup.bytes !== evidence.backup.bytes
  ) {
    throw new Error("stored backup artifact conflicts with its evidence");
  }
  return Object.freeze({
    kind: "programmable-database-backup-restore-result",
    schemaVersion: 1,
    status: "current",
    changed: false,
    evidence: Object.freeze(evidence),
  });
}

async function createPrivateFile(filePath, contents = "") {
  const descriptor = await open(
    filePath,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      (fsConstants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    if (contents !== "") await descriptor.writeFile(contents, "utf8");
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
  await chmod(filePath, 0o600);
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error("private operator artifact permissions are invalid");
  }
}

async function createTemporaryCa(caPem) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "programmable-pg-ca-"));
  await chmod(directory, 0o700);
  const filePath = path.join(directory, "server-ca.crt");
  try {
    await createPrivateFile(filePath, caPem);
    return { directory, filePath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function safeChildEnvironment({ password, caPath, applicationName }) {
  const environment = {
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    PGAPPNAME: applicationName,
    PGCONNECT_TIMEOUT: "8",
    PGPASSWORD: password,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: caPath,
  };
  if (process.platform === "win32" && process.env.SYSTEMROOT) {
    environment.SYSTEMROOT = process.env.SYSTEMROOT;
  }
  return environment;
}

async function runCommand(binary, args, options) {
  const result = await executeFile(binary, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  return {
    stdout: Buffer.isBuffer(result.stdout)
      ? result.stdout
      : Buffer.from(result.stdout ?? ""),
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr
      : Buffer.from(result.stderr ?? ""),
  };
}

function assertCommandContainsNoSecrets(args, secrets) {
  const serialized = args.join("\u0000");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0 && serialized.includes(secret)) {
      throw new Error("database secret reached a child-process argument");
    }
  }
}

async function executeSafeCommand({
  runner,
  binary,
  args,
  env,
  timeoutMs,
  secrets,
}) {
  assertCommandContainsNoSecrets(args, secrets);
  try {
    const result = await runner(binary, Object.freeze([...args]), {
      cwd: path.dirname(args.at(-1) ?? process.cwd()),
      env: Object.freeze({ ...env }),
      timeoutMs,
    });
    return {
      stdout: Buffer.isBuffer(result?.stdout)
        ? result.stdout
        : Buffer.from(result?.stdout ?? ""),
      stderr: Buffer.isBuffer(result?.stderr)
        ? result.stderr
        : Buffer.from(result?.stderr ?? ""),
    };
  } catch (error) {
    throw operationalFailure("Postgres backup tool", error);
  }
}

function commandTargetArguments(target, username) {
  return [
    "--host",
    target.host,
    "--port",
    String(target.port),
    "--username",
    username,
    "--dbname",
    target.database,
    "--no-password",
  ];
}

function roleBootstrapSql() {
  const body = RESTORE_ROLE_NAMES.map(
    (role) => `
      if not exists (
        select 1 from pg_catalog.pg_roles where rolname = '${role}'
      ) then
        create role ${role}
          nologin nosuperuser nocreatedb nocreaterole noinherit
          noreplication nobypassrls;
      end if;
      alter role ${role}
        nologin nosuperuser nocreatedb nocreaterole noinherit
        noreplication nobypassrls;`,
  ).join("\n");
  return `do $programmable_restore_roles$ begin ${body}\nend $programmable_restore_roles$;`;
}

function quoteIdentifier(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 63) {
    throw new Error("database catalog identifier is invalid");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

async function captureDatabaseManifest(sql) {
  // JSON serialization of timestamptz follows the session timezone. Normalize
  // both the hosted source and isolated restore before hashing so identical
  // instants cannot fail verification solely because the hosts use different
  // timezone settings.
  await sql.unsafe("set timezone = 'UTC'").simple();
  const objects = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        class.relname as object_name,
        class.relkind::text as object_kind
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
      where namespace.nspname = any($1::text[])
      order by namespace.nspname, class.relname, class.relkind
    `,
    [BACKUP_SCHEMAS],
  );
  const functions = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        procedure.proname as function_name,
        procedure.prokind::text as function_kind,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)
          as identity_arguments
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = any($1::text[])
      order by namespace.nspname, procedure.proname,
               pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    `,
    [BACKUP_SCHEMAS],
  );
  const types = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        type.typname as type_name,
        type.typtype::text as type_kind
      from pg_catalog.pg_type as type
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = type.typnamespace
      where namespace.nspname = any($1::text[])
        and type.typname not like '\\_%' escape '\\'
      order by namespace.nspname, type.typname
    `,
    [BACKUP_SCHEMAS],
  );
  const tables = objects.filter(({ object_kind: kind }) => ["p", "r"].includes(kind));
  const tableEvidence = [];
  let totalRows = 0;
  for (const table of tables) {
    const schema = quoteIdentifier(table.schema_name);
    const name = quoteIdentifier(table.object_name);
    const rows = await sql.unsafe(`
      select pg_catalog.to_jsonb(row_value)::text as row_json
      from ${schema}.${name} as row_value
      order by pg_catalog.to_jsonb(row_value)::text collate "C"
    `);
    const hash = createHash("sha256");
    for (const row of rows) {
      const value = row?.row_json;
      if (typeof value !== "string") {
        throw new Error("database row manifest response is invalid");
      }
      const bytes = Buffer.from(value);
      const length = Buffer.allocUnsafe(8);
      length.writeBigUInt64BE(BigInt(bytes.byteLength));
      hash.update(length);
      hash.update(bytes);
    }
    totalRows += rows.length;
    tableEvidence.push({
      schema: table.schema_name,
      table: table.object_name,
      rows: rows.length,
      rowsSha256: `0x${hash.digest("hex")}`,
    });
  }
  const payload = {
    schemas: BACKUP_SCHEMAS,
    objects,
    functions,
    types,
    tables: tableEvidence,
  };
  return Object.freeze({
    manifestSha256: sha256(canonicalJson(payload)),
    tableCount: tables.length,
    rowCount: totalRows,
  });
}

async function openRestoreDatabase({ databaseUrl, sslCaPem }) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.delete("sslmode");
  const sql = postgres(parsed.toString(), {
    ssl: { rejectUnauthorized: true, ca: sslCaPem },
    max: 1,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 5,
    max_lifetime: 60,
    onnotice: () => {},
    connection: {
      application_name: "programmable-isolated-restore-verifier",
    },
  });
  return { sql };
}

async function assertRestoreTargetIsEmpty(sql, safeTarget) {
  const [identity] = await sql.unsafe(`
    select
      session_user::text as session_user,
      current_role::text as current_role,
      pg_catalog.current_database()::text as database_name,
      pg_catalog.inet_server_port()::integer as server_port,
      pg_catalog.pg_is_in_recovery() as in_recovery
  `);
  if (
    identity?.session_user !== "postgres" ||
    identity?.current_role !== "postgres" ||
    identity?.database_name !== safeTarget.database ||
    Number(identity?.server_port) !== safeTarget.port ||
    identity?.in_recovery !== false
  ) {
    throw new Error("isolated restore database identity is not approved");
  }
  const [footprint] = await sql.unsafe(
    `
      select
        (select pg_catalog.count(*)::integer
         from pg_catalog.pg_namespace
         where nspname = any($1::text[])) as schema_count,
        (select pg_catalog.count(*)::integer
         from pg_catalog.pg_class as class
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = class.relnamespace
         where namespace.nspname = any($1::text[])) as object_count
    `,
    [BACKUP_SCHEMAS],
  );
  if (Number(footprint?.schema_count) !== 0 || Number(footprint?.object_count) !== 0) {
    throw new Error("isolated restore database is not empty");
  }
}

function pgVersion(stdout) {
  const value = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout ?? "");
  const match = PG_TOOL_VERSION.exec(value);
  if (!match || Number(match[1]) !== 17) {
    throw new Error("Postgres 17 client tools are required");
  }
  return `PostgreSQL ${match[0]}`;
}

async function writeEvidence(request, evidence) {
  assertNoSecretOutput(evidence, [
    request.source.password,
    request.restore.password,
    request.sslCaPem,
    request.restoreSslCaPem,
    request.sourceDatabaseUrl,
    request.restoreDatabaseUrl,
  ].filter(Boolean));
  try {
    await createPrivateFile(
      request.evidencePath,
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  } catch (error) {
    await rm(request.evidencePath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function createBackupAndRestoreEvidence(input) {
  const request = validateBackupRequest(input);
  request.sourceDatabaseUrl = input.sourceDatabaseUrl;
  request.restoreDatabaseUrl = input.restoreDatabaseUrl;
  const dependencies = validateDependencies(input.dependencies, [
    "runCommand",
    "openHostedDatabase",
    "openRestoreDatabase",
    "closeHostedDatabase",
    "captureDatabaseManifest",
    "assertRestoreTargetIsEmpty",
    "now",
  ]);
  const runner = dependencies.runCommand ?? runCommand;
  const openSource = dependencies.openHostedDatabase ?? openHostedDatabase;
  const openRestore = dependencies.openRestoreDatabase ?? openRestoreDatabase;
  const closeDatabase = dependencies.closeHostedDatabase ?? closeHostedDatabase;
  const captureManifest =
    dependencies.captureDatabaseManifest ?? captureDatabaseManifest;
  const assertRestoreEmpty =
    dependencies.assertRestoreTargetIsEmpty ?? assertRestoreTargetIsEmpty;
  const now = dependencies.now ?? (() => new Date());
  let sourceConnection;
  let restoreConnection;
  let sourceCa;
  let restoreCa;
  let backupCreated = false;
  try {
    const existing = await readIdempotentEvidence(request);
    if (existing) return existing;
    sourceCa = await createTemporaryCa(request.sslCaPem);
    restoreCa = await createTemporaryCa(request.restoreSslCaPem);
    sourceConnection = await openSource({
      databaseUrl: input.sourceDatabaseUrl,
      expectedProjectRef: input.expectedProjectRef,
      sslCaPem: request.sslCaPem,
    });
    restoreConnection = await openRestore({
      databaseUrl: input.restoreDatabaseUrl,
      sslCaPem: request.restoreSslCaPem,
      safeTarget: request.restore.safeTarget,
    });
    await assertRestoreEmpty(restoreConnection.sql, request.restore.safeTarget);
    const before = await captureManifest(sourceConnection.sql);
    if (
      !SHA256.test(before?.manifestSha256 ?? "") ||
      !Number.isSafeInteger(before?.tableCount) ||
      before.tableCount < 0 ||
      !Number.isSafeInteger(before?.rowCount) ||
      before.rowCount < 0
    ) {
      throw new Error("source database manifest is invalid");
    }
    const secrets = [
      request.source.password,
      request.restore.password,
      input.sourceDatabaseUrl,
      input.restoreDatabaseUrl,
      request.sslCaPem,
      request.restoreSslCaPem,
    ];
    const sourceEnvironment = safeChildEnvironment({
      password: request.source.password,
      caPath: sourceCa.filePath,
      applicationName: "programmable-pg-backup",
    });
    const restoreEnvironment = safeChildEnvironment({
      password: request.restore.password,
      caPath: restoreCa.filePath,
      applicationName: "programmable-pg-restore-test",
    });
    const versionResult = await executeSafeCommand({
      runner,
      binary: input.pgDumpBinary ?? "pg_dump",
      args: ["--version"],
      env: sourceEnvironment,
      timeoutMs: 15_000,
      secrets,
    });
    const postgresVersion = pgVersion(versionResult.stdout);
    let backupFormat;
    let listResult;
    if (before.tableCount === 0 && before.rowCount === 0) {
      backupFormat = "empty-target-schemas-v1";
      const emptyArtifact = `${canonicalJson({
        kind: backupFormat,
        schemaVersion: 1,
        sourceManifestSha256: before.manifestSha256,
      })}\n`;
      await createPrivateFile(request.backupPath, emptyArtifact);
      backupCreated = true;
      listResult = {
        stdout: Buffer.from(emptyArtifact),
        stderr: Buffer.alloc(0),
      };
    } else {
      backupFormat = "pg-custom-v1";
      await createPrivateFile(request.backupPath);
      backupCreated = true;
      const dumpArguments = [
        "--format=custom",
        "--compress=6",
        "--serializable-deferrable",
        "--no-owner",
        "--no-privileges",
        ...BACKUP_SCHEMAS.flatMap((schema) => ["--schema", schema]),
        ...commandTargetArguments(request.source.safeTarget, request.source.username),
        "--file",
        request.backupPath,
      ];
      await executeSafeCommand({
        runner,
        binary: input.pgDumpBinary ?? "pg_dump",
        args: dumpArguments,
        env: sourceEnvironment,
        timeoutMs: 15 * 60_000,
        secrets,
      });
      await chmod(request.backupPath, 0o600);
    }
    const after = await captureManifest(sourceConnection.sql);
    if (
      after?.manifestSha256 !== before.manifestSha256 ||
      after?.tableCount !== before.tableCount ||
      after?.rowCount !== before.rowCount
    ) {
      throw new Error("source database changed during the backup window");
    }
    if (backupFormat === "pg-custom-v1") {
      listResult = await executeSafeCommand({
        runner,
        binary: input.pgRestoreBinary ?? "pg_restore",
        args: ["--list", request.backupPath],
        env: sourceEnvironment,
        timeoutMs: 60_000,
        secrets,
      });
    }
    if (listResult.stdout.byteLength < 1) {
      throw new Error("Postgres backup archive listing is empty");
    }
    if (backupFormat === "pg-custom-v1") {
      await executeSafeCommand({
        runner,
        binary: input.psqlBinary ?? "psql",
        args: [
          "--no-psqlrc",
          "--quiet",
          "--set",
          "ON_ERROR_STOP=1",
          ...commandTargetArguments(request.restore.safeTarget, request.restore.username),
          "--command",
          roleBootstrapSql(),
        ],
        env: restoreEnvironment,
        timeoutMs: 60_000,
        secrets,
      });
      await executeSafeCommand({
        runner,
        binary: input.pgRestoreBinary ?? "pg_restore",
        args: [
          "--exit-on-error",
          "--single-transaction",
          "--no-owner",
          "--no-privileges",
          ...commandTargetArguments(request.restore.safeTarget, request.restore.username),
          request.backupPath,
        ],
        env: restoreEnvironment,
        timeoutMs: 15 * 60_000,
        secrets,
      });
    }
    const restored = await captureManifest(restoreConnection.sql);
    if (
      restored?.manifestSha256 !== before.manifestSha256 ||
      restored?.tableCount !== before.tableCount ||
      restored?.rowCount !== before.rowCount
    ) {
      throw new Error("isolated restore does not match the source manifest");
    }
    const backup = await fileSha256(request.backupPath);
    if (backup.bytes < 1) throw new Error("Postgres backup archive is empty");
    const createdAt = now();
    if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
      throw new Error("backup evidence timestamp is invalid");
    }
    const evidence = Object.freeze({
      kind: "programmable-database-backup-restore-evidence",
      schemaVersion: 1,
      operationId: request.operationId,
      repositoryCommit: request.repositoryCommit,
      requestSha256: request.requestSha256,
      source: request.source.safeTarget,
      restore: request.restore.safeTarget,
      backup: Object.freeze({
        format: backupFormat,
        sha256: backup.sha256,
        bytes: backup.bytes,
        archiveListSha256: sha256(listResult.stdout),
      }),
      sourceManifestSha256: before.manifestSha256,
      restoredManifestSha256: restored.manifestSha256,
      tableCount: before.tableCount,
      rowCount: before.rowCount,
      postgresVersion,
      createdAt: createdAt.toISOString(),
    });
    await writeEvidence(request, evidence);
    return Object.freeze({
      kind: "programmable-database-backup-restore-result",
      schemaVersion: 1,
      status: "created",
      changed: true,
      evidence,
    });
  } catch (error) {
    if (backupCreated) {
      await rm(request.backupPath, { force: true }).catch(() => {});
    }
    throw operationalFailure("database backup and isolated restore", error);
  } finally {
    if (sourceConnection?.sql) await closeDatabase(sourceConnection.sql).catch(() => {});
    if (restoreConnection?.sql) await closeDatabase(restoreConnection.sql).catch(() => {});
    if (sourceCa?.directory) {
      await rm(sourceCa.directory, { recursive: true, force: true }).catch(() => {});
    }
    if (restoreCa?.directory) {
      await rm(restoreCa.directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}
