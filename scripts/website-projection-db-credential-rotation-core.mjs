import { createHash } from "node:crypto";

import {
  validateWebsiteProjectionPlan,
  WEBSITE_PROJECTION_RUNTIME_ROLE,
} from "./website-projection-db-operator-core.mjs";

export const WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF =
  "mnnvlrqwhfoppogslsje";
export const WEBSITE_PROJECTION_RUNTIME_POOLER_HOST =
  "aws-0-eu-central-1.pooler.supabase.com";
export const WEBSITE_PROJECTION_RUNTIME_POOLER_PORT = 6543;
export const WEBSITE_PROJECTION_RUNTIME_DATABASE = "postgres";
export const WEBSITE_PROJECTION_ROTATION_CONFIRMATION =
  `${WEBSITE_PROJECTION_RUNTIME_ROLE}@${WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF}`;
export const WEBSITE_PROJECTION_NO_OVERLAP_CONFIRMATION =
  "single-password-forward-cutover-v1";
export const WEBSITE_PROJECTION_ROTATION_RECEIPT_SCHEMA =
  "programmable.website-projection-runtime-credential-rotation.v1";
export const WEBSITE_PROJECTION_RUNTIME_DATABASE_URL_LEAF =
  "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL";
export const WEBSITE_PROJECTION_RUNTIME_DATABASE_ROLE_LEAF =
  "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE";
export const WEBSITE_PROJECTION_RUNTIME_DATABASE_CA_PEM_LEAF =
  "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM";
export const WEBSITE_PROJECTION_ROTATION_RECEIPT_LEAF =
  "programmable-website-projection-runtime-credential-rotation-v1.json";

const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const HEX_SHA256 = /^0x[0-9a-f]{64}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;

function plainObject(value) {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateWebsiteProjectionRotationPassword(value) {
  if (typeof value !== "string"
    || Buffer.byteLength(value, "utf8") < 24
    || Buffer.byteLength(value, "utf8") > 512
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("website projection rotation password is invalid");
  }
  return value;
}

export function assertWebsiteProjectionRotationConfirmation({
  expectedProjectRef,
  confirmRotate,
  confirmNoOverlap,
}) {
  if (!PROJECT_REF.test(expectedProjectRef ?? "")
    || expectedProjectRef !== WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF
    || confirmRotate !== WEBSITE_PROJECTION_ROTATION_CONFIRMATION) {
    throw new Error("rotation confirmation must equal the exact production role and project");
  }
  if (confirmNoOverlap !== WEBSITE_PROJECTION_NO_OVERLAP_CONFIRMATION) {
    throw new Error("rotation requires explicit single-password cutover confirmation");
  }
}

export function buildWebsiteProjectionRuntimeDatabaseUrl(password, {
  projectRef = WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF,
} = {}) {
  validateWebsiteProjectionRotationPassword(password);
  if (projectRef !== WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF) {
    throw new Error("runtime database target is not the production project");
  }
  const url = new URL("postgresql://invalid:invalid@invalid.invalid/postgres");
  url.username = `${WEBSITE_PROJECTION_RUNTIME_ROLE}.${projectRef}`;
  url.password = encodeURIComponent(password);
  url.hostname = WEBSITE_PROJECTION_RUNTIME_POOLER_HOST;
  url.port = String(WEBSITE_PROJECTION_RUNTIME_POOLER_PORT);
  url.pathname = `/${WEBSITE_PROJECTION_RUNTIME_DATABASE}`;
  return url.toString();
}

export function validateWebsiteProjectionRuntimeDatabaseUrl(value, {
  projectRef = WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF,
} = {}) {
  let url;
  let loginRole;
  let password;
  try {
    url = new URL(value);
    loginRole = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    validateWebsiteProjectionRotationPassword(password);
  } catch {
    throw new Error("runtime database URL is invalid");
  }
  if (projectRef !== WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF
    || url.protocol !== "postgresql:"
    || loginRole !== `${WEBSITE_PROJECTION_RUNTIME_ROLE}.${projectRef}`
    || url.hostname !== WEBSITE_PROJECTION_RUNTIME_POOLER_HOST
    || url.port !== String(WEBSITE_PROJECTION_RUNTIME_POOLER_PORT)
    || url.pathname !== `/${WEBSITE_PROJECTION_RUNTIME_DATABASE}`
    || url.search !== ""
    || url.hash !== "") {
    throw new Error("runtime database URL is not the exact production pooler target");
  }
  return Object.freeze({
    projectRef,
    host: url.hostname,
    port: Number(url.port),
    database: WEBSITE_PROJECTION_RUNTIME_DATABASE,
    loginRole,
    effectiveRole: WEBSITE_PROJECTION_RUNTIME_ROLE,
    tlsMode: "verify-full-equivalent",
  });
}

export function assertWebsiteProjectionRotationSourcePlan({
  reviewedPlan,
  currentPlan,
}) {
  validateWebsiteProjectionPlan(reviewedPlan);
  validateWebsiteProjectionPlan(currentPlan);
  if (reviewedPlan.orderSha256 !== currentPlan.orderSha256
    || reviewedPlan.migrationCount !== currentPlan.migrationCount
    || JSON.stringify(reviewedPlan.migrations)
      !== JSON.stringify(currentPlan.migrations)) {
    throw new Error("reviewed rotation plan differs from the current migration closure");
  }
  return reviewedPlan;
}

export function assertWebsiteProjectionRuntimeCredentialProbe(value) {
  if (!plainObject(value)
    || value.runtime_role !== WEBSITE_PROJECTION_RUNTIME_ROLE
    || value.session_role !== WEBSITE_PROJECTION_RUNTIME_ROLE
    || value.database_name !== WEBSITE_PROJECTION_RUNTIME_DATABASE
    || Number(value.server_version_num) < 150000
    || value.rolsuper !== false
    || value.rolinherit !== false
    || value.rolcreaterole !== false
    || value.rolcreatedb !== false
    || value.rolreplication !== false
    || value.rolbypassrls !== false
    || value.schema_usage !== true
    || value.schema_create !== false
    || value.required_runtime_privileges !== true
    || value.forbidden_runtime_privileges !== false
    || value.owns_application_objects !== false
    || value.has_forbidden_membership !== false
    || value.ssl !== true
    || typeof value.ssl_version !== "string"
    || value.ssl_version.length === 0
    || typeof value.ssl_cipher !== "string"
    || value.ssl_cipher.length === 0
    || Number(value.ssl_bits) < 128) {
    throw new Error("website projection runtime credential probe failed");
  }
  return Object.freeze({
    runtimeRole: value.runtime_role,
    databaseName: value.database_name,
    serverVersionNum: String(value.server_version_num),
    sslVersion: value.ssl_version,
    sslCipher: value.ssl_cipher,
    sslBits: Number(value.ssl_bits),
    leastPrivilege: true,
  });
}

export function buildWebsiteProjectionRotationReceipt({
  sourceCommit,
  sourceTree,
  sourceParent,
  target,
  migrationEvidence,
  preRotationCatalogSha256,
  postRotationCatalogSha256,
  runtimeProbe,
  caPem,
  outputFiles,
  rotatedAt,
}) {
  if (!GIT_OBJECT.test(sourceCommit ?? "")
    || !GIT_OBJECT.test(sourceTree ?? "")
    || !GIT_OBJECT.test(sourceParent ?? "")
    || !plainObject(target)
    || target.projectRef !== WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF
    || target.database !== WEBSITE_PROJECTION_RUNTIME_DATABASE
    || !plainObject(migrationEvidence)
    || !HEX_SHA256.test(preRotationCatalogSha256 ?? "")
    || postRotationCatalogSha256 !== preRotationCatalogSha256
    || !plainObject(runtimeProbe)
    || typeof caPem !== "string"
    || !caPem.includes("-----BEGIN CERTIFICATE-----")
    || !plainObject(outputFiles)
    || outputFiles.databaseUrl !== WEBSITE_PROJECTION_RUNTIME_DATABASE_URL_LEAF
    || outputFiles.databaseRole !== WEBSITE_PROJECTION_RUNTIME_DATABASE_ROLE_LEAF
    || outputFiles.databaseCaPem
      !== WEBSITE_PROJECTION_RUNTIME_DATABASE_CA_PEM_LEAF
    || outputFiles.receipt !== WEBSITE_PROJECTION_ROTATION_RECEIPT_LEAF
    || typeof rotatedAt !== "string"
    || !Number.isFinite(Date.parse(rotatedAt))) {
    throw new Error("website projection rotation receipt inputs are invalid");
  }
  return Object.freeze({
    schemaVersion: WEBSITE_PROJECTION_ROTATION_RECEIPT_SCHEMA,
    operation: "rotate-existing-runtime-role-password",
    changed: true,
    rotatedAt,
    source: Object.freeze({
      repositoryCommit: sourceCommit,
      repositoryTree: sourceTree,
      repositoryParent: sourceParent,
    }),
    target: Object.freeze({
      projectRef: target.projectRef,
      database: target.database,
      authorityEndpoint: `db.${target.projectRef}.supabase.co:5432`,
      runtimeEndpoint:
        `${WEBSITE_PROJECTION_RUNTIME_POOLER_HOST}:${WEBSITE_PROJECTION_RUNTIME_POOLER_PORT}`,
      runtimeRole: WEBSITE_PROJECTION_RUNTIME_ROLE,
    }),
    migrationEvidence,
    catalog: Object.freeze({
      beforeSha256: preRotationCatalogSha256,
      afterSha256: postRotationCatalogSha256,
      unchanged: true,
    }),
    runtimeProbe,
    tls: Object.freeze({
      mode: "verify-full-equivalent",
      caSha256: `sha256:${createHash("sha256").update(caPem).digest("hex")}`,
      hostnameVerified: true,
    }),
    cutover: Object.freeze({
      passwordSlots: 1,
      overlappingPasswordsSupported: false,
      existingSessionsAreNotCutoverEvidence: true,
      preCommitFailure: "automatic-transaction-rollback",
      postCommitFailure: "forward-rotate-or-rerun-with-the-same-protected-secret",
      vercelMutationPerformed: false,
    }),
    protectedOutputs: Object.freeze({
      databaseUrl: outputFiles.databaseUrl,
      databaseRole: outputFiles.databaseRole,
      databaseCaPem: outputFiles.databaseCaPem,
      receipt: outputFiles.receipt,
      mode: "0600",
      containsSecretDerivedDigest: false,
    }),
  });
}
