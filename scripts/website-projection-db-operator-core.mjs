import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  sha256,
} from "./data-pipeline/hosted-db-operator-core.mjs";

export const WEBSITE_PROJECTION_MIGRATION_ROOT =
  "ops/website-projection-target/migrations";
export const WEBSITE_PROJECTION_RUNTIME_ROLE =
  "programmable_website_projection_runtime";
export const WEBSITE_PROJECTION_APPLICATION_SCHEMA =
  "programmable_website_projection_v1";
export const WEBSITE_PROJECTION_EVIDENCE_SCHEMA =
  "programmable_website_projection_migrations";
export const WEBSITE_PROJECTION_EVIDENCE_TABLE =
  `${WEBSITE_PROJECTION_EVIDENCE_SCHEMA}.migration_evidence_v1`;
export const WEBSITE_PROJECTION_PLAN_KIND =
  "programmable-website-projection-migration-plan";

export const WEBSITE_PROJECTION_MIGRATION_FILES = Object.freeze([
  "0001_projection_records_v1.sql",
  "0002_custom_launch_wallet_profile_v2.sql",
  "0003_registry_custom_public_read_v1.sql",
  "0004_approval_v3_artifacts_v1.sql",
  "0005_generic_launch_materializations_v2.sql",
]);

const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const HEX_SHA256 = /^0x[0-9a-f]{64}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const MIGRATION_FILE = /^(000[1-5])_([a-z][a-z0-9_]*)\.sql$/u;
const TRANSACTION_WRAPPER = /^BEGIN;\r?\n([\s\S]+)\r?\nCOMMIT;\r?\n?$/u;

function isPlainObject(value) {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
  );
}

export function unwrapWebsiteProjectionMigration(source) {
  if (typeof source !== "string" || source.includes("\u0000")) {
    throw new Error("migration source is invalid");
  }
  const match = TRANSACTION_WRAPPER.exec(source);
  if (!match || match[1].trim() === "") {
    throw new Error("migration must have one exact outer BEGIN and COMMIT wrapper");
  }
  return match[1];
}

function migrationOrderSha256(migrations) {
  return sha256(migrations.map((migration) => [
    migration.ordinal,
    migration.version,
    migration.name,
    migration.file,
    migration.bytes,
    migration.fileSha256,
    migration.executionBytes,
    migration.executionSha256,
  ].join("\0")).join("\n"));
}

function planPayload(plan) {
  return {
    kind: plan.kind,
    schemaVersion: plan.schemaVersion,
    repositoryCommit: plan.repositoryCommit,
    repositoryTree: plan.repositoryTree,
    migrationRoot: plan.migrationRoot,
    applicationSchema: plan.applicationSchema,
    evidenceTable: plan.evidenceTable,
    runtimeRole: plan.runtimeRole,
    migrationCount: plan.migrationCount,
    orderSha256: plan.orderSha256,
    migrations: plan.migrations,
  };
}

export async function discoverWebsiteProjectionPlan({
  workspace,
  repositoryCommit,
  repositoryTree,
}) {
  if (!GIT_OBJECT.test(repositoryCommit ?? "")
    || !GIT_OBJECT.test(repositoryTree ?? "")) {
    throw new Error("repository commit and tree must be exact full Git objects");
  }
  const workspacePath = await realpath(workspace);
  const root = path.resolve(workspacePath, WEBSITE_PROJECTION_MIGRATION_ROOT);
  const rootPath = await realpath(root);
  if (!rootPath.startsWith(`${workspacePath}${path.sep}`)) {
    throw new Error("migration root escapes the repository");
  }
  const entries = await readdir(rootPath, { withFileTypes: true });
  const names = entries.map(({ name }) => name).sort();
  if (names.length !== WEBSITE_PROJECTION_MIGRATION_FILES.length
    || names.some((name, index) =>
      name !== WEBSITE_PROJECTION_MIGRATION_FILES[index])) {
    throw new Error("migration directory must contain exactly the five canonical files");
  }

  const migrations = [];
  for (const [index, fileName] of WEBSITE_PROJECTION_MIGRATION_FILES.entries()) {
    const entry = entries.find(({ name }) => name === fileName);
    const absolutePath = path.join(rootPath, fileName);
    const metadata = await lstat(absolutePath);
    if (!entry?.isFile() || !metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`migration must be a regular file: ${fileName}`);
    }
    const match = MIGRATION_FILE.exec(fileName);
    if (!match || Number(match[1]) !== index + 1) {
      throw new Error(`migration filename is invalid: ${fileName}`);
    }
    const contents = await readFile(absolutePath);
    if (contents.byteLength === 0) {
      throw new Error(`migration must not be empty: ${fileName}`);
    }
    let source;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    } catch {
      throw new Error(`migration must be valid UTF-8: ${fileName}`);
    }
    const executionSource = unwrapWebsiteProjectionMigration(source);
    const executionContents = Buffer.from(executionSource, "utf8");
    migrations.push(Object.freeze({
      ordinal: index + 1,
      version: match[1],
      name: match[2],
      file: path.posix.join(WEBSITE_PROJECTION_MIGRATION_ROOT, fileName),
      bytes: contents.byteLength,
      fileSha256: sha256(contents),
      executionBytes: executionContents.byteLength,
      executionSha256: sha256(executionContents),
    }));
  }

  const plan = {
    kind: WEBSITE_PROJECTION_PLAN_KIND,
    schemaVersion: 1,
    repositoryCommit,
    repositoryTree,
    migrationRoot: WEBSITE_PROJECTION_MIGRATION_ROOT,
    applicationSchema: WEBSITE_PROJECTION_APPLICATION_SCHEMA,
    evidenceTable: WEBSITE_PROJECTION_EVIDENCE_TABLE,
    runtimeRole: WEBSITE_PROJECTION_RUNTIME_ROLE,
    migrationCount: migrations.length,
    orderSha256: migrationOrderSha256(migrations),
    migrations: Object.freeze(migrations),
  };
  return Object.freeze({
    ...plan,
    planSha256: sha256(canonicalJson(planPayload(plan))),
  });
}

export function validateWebsiteProjectionPlan(value) {
  if (!isPlainObject(value)
    || value.kind !== WEBSITE_PROJECTION_PLAN_KIND
    || value.schemaVersion !== 1
    || !GIT_OBJECT.test(value.repositoryCommit ?? "")
    || !GIT_OBJECT.test(value.repositoryTree ?? "")
    || value.migrationRoot !== WEBSITE_PROJECTION_MIGRATION_ROOT
    || value.applicationSchema !== WEBSITE_PROJECTION_APPLICATION_SCHEMA
    || value.evidenceTable !== WEBSITE_PROJECTION_EVIDENCE_TABLE
    || value.runtimeRole !== WEBSITE_PROJECTION_RUNTIME_ROLE
    || value.migrationCount !== WEBSITE_PROJECTION_MIGRATION_FILES.length
    || !HEX_SHA256.test(value.orderSha256 ?? "")
    || !HEX_SHA256.test(value.planSha256 ?? "")
    || !Array.isArray(value.migrations)
    || value.migrations.length !== WEBSITE_PROJECTION_MIGRATION_FILES.length) {
    throw new Error("website projection migration plan is invalid");
  }
  for (const [index, migration] of value.migrations.entries()) {
    const fileName = WEBSITE_PROJECTION_MIGRATION_FILES[index];
    const match = MIGRATION_FILE.exec(fileName);
    if (!isPlainObject(migration)
      || migration.ordinal !== index + 1
      || migration.version !== match?.[1]
      || migration.name !== match?.[2]
      || migration.file !== path.posix.join(WEBSITE_PROJECTION_MIGRATION_ROOT, fileName)
      || !Number.isSafeInteger(migration.bytes)
      || migration.bytes <= 0
      || !HEX_SHA256.test(migration.fileSha256 ?? "")
      || !Number.isSafeInteger(migration.executionBytes)
      || migration.executionBytes <= 0
      || !HEX_SHA256.test(migration.executionSha256 ?? "")) {
      throw new Error("website projection migration plan entry is invalid");
    }
  }
  if (migrationOrderSha256(value.migrations) !== value.orderSha256
    || sha256(canonicalJson(planPayload(value))) !== value.planSha256) {
    throw new Error("website projection migration plan commitment does not match");
  }
  return value;
}

export function compareWebsiteProjectionEvidence({
  plan,
  expectedProjectRef,
  evidenceTablePresent,
  applicationSchemaPresent,
  evidenceRows,
}) {
  validateWebsiteProjectionPlan(plan);
  if (!PROJECT_REF.test(expectedProjectRef ?? "")
    || typeof evidenceTablePresent !== "boolean"
    || typeof applicationSchemaPresent !== "boolean"
    || !Array.isArray(evidenceRows)) {
    throw new Error("website projection migration state is invalid");
  }
  if (!evidenceTablePresent && evidenceRows.length > 0) {
    throw new Error("website projection migration evidence state is invalid");
  }
  if (evidenceTablePresent && evidenceRows.length === 0) {
    throw new Error("unproven operator evidence table exists without migration evidence");
  }
  if (evidenceRows.length === 0 && applicationSchemaPresent) {
    throw new Error("unproven application schema exists without migration evidence");
  }
  if (evidenceRows.length > 0 && !applicationSchemaPresent) {
    throw new Error("migration evidence exists without the application schema");
  }
  for (const [index, row] of evidenceRows.entries()) {
    const migration = plan.migrations[index];
    if (!migration || !isPlainObject(row)
      || Number(row.ordinal) !== migration.ordinal
      || row.version !== migration.version
      || row.name !== migration.name
      || row.file_name !== path.posix.basename(migration.file)
      || row.file_sha256 !== migration.fileSha256
      || row.execution_sha256 !== migration.executionSha256
      || row.plan_sha256 !== plan.planSha256
      || row.repository_commit !== plan.repositoryCommit
      || row.repository_tree !== plan.repositoryTree
      || !HEX_SHA256.test(row.catalog_sha256 ?? "")
      || !HEX_SHA256.test(row.operator_catalog_sha256 ?? "")) {
      throw new Error("remote migration evidence is not an exact plan prefix");
    }
    if (row.target_project_ref !== expectedProjectRef) {
      throw new Error("remote migration evidence target mismatch");
    }
  }
  const pending = plan.migrations.slice(evidenceRows.length).map(
    ({ ordinal, version, file }) => ({ ordinal, version, file }),
  );
  return Object.freeze({
    status: pending.length === 0 ? "current" : "pending",
    appliedCount: evidenceRows.length,
    pending: Object.freeze(pending),
    catalogSha256: evidenceRows.at(-1)?.catalog_sha256 ?? null,
  });
}

export function validateWebsiteProjectionRuntimePassword(value) {
  if (typeof value !== "string"
    || Buffer.byteLength(value, "utf8") < 24
    || Buffer.byteLength(value, "utf8") > 512
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("website projection runtime password is invalid");
  }
  return value;
}

export function assertWebsiteProjectionRoleGraph({
  roles,
  memberships,
  appliedCount,
}) {
  if (!Array.isArray(roles)
    || !Array.isArray(memberships)
    || !Number.isSafeInteger(appliedCount)
    || appliedCount < 0
    || appliedCount > WEBSITE_PROJECTION_MIGRATION_FILES.length) {
    throw new Error("website projection role graph is invalid");
  }
  const roleByName = new Map();
  for (const role of roles) {
    if (!isPlainObject(role)
      || typeof role.rolname !== "string"
      || roleByName.has(role.rolname)) {
      throw new Error("website projection role graph is invalid");
    }
    roleByName.set(role.rolname, role);
  }
  for (const roleName of ["postgres", "anon", "authenticated", "service_role"]) {
    if (!roleByName.has(roleName)) {
      throw new Error(`required database role is missing: ${roleName}`);
    }
  }
  if (memberships.length > 0) {
    throw new Error("website projection owner, runtime and provider role membership is forbidden");
  }
  const runtime = roleByName.get(WEBSITE_PROJECTION_RUNTIME_ROLE);
  if (!runtime) {
    if (appliedCount > 0) {
      throw new Error("website projection runtime role is missing after migration");
    }
    return Object.freeze({ runtimeRoleStatus: "missing" });
  }
  if (runtime.rolcanlogin !== true
    || runtime.rolinherit !== false
    || runtime.rolsuper !== false
    || runtime.rolcreaterole !== false
    || runtime.rolcreatedb !== false
    || runtime.rolreplication !== false
    || runtime.rolbypassrls !== false) {
    throw new Error("website projection runtime role posture is invalid");
  }
  return Object.freeze({ runtimeRoleStatus: "current" });
}

export function catalogSnapshotSha256(snapshot) {
  if (!isPlainObject(snapshot) || Object.keys(snapshot).length === 0) {
    throw new Error("website projection catalog snapshot is invalid");
  }
  for (const rows of Object.values(snapshot)) {
    if (!Array.isArray(rows)
      || rows.some((row) => !isPlainObject(row))) {
      throw new Error("website projection catalog snapshot rows are invalid");
    }
  }
  return sha256(canonicalJson(snapshot));
}

export function assertWebsiteProjectionApplyConfirmation({
  plan,
  expectedProjectRef,
  confirmApply,
  confirmTarget,
}) {
  validateWebsiteProjectionPlan(plan);
  if (confirmApply !== plan.planSha256) {
    throw new Error("apply confirmation must equal the reviewed plan commitment");
  }
  if (!PROJECT_REF.test(expectedProjectRef ?? "")
    || confirmTarget !== expectedProjectRef) {
    throw new Error("apply target confirmation must equal the verified project ref");
  }
}
