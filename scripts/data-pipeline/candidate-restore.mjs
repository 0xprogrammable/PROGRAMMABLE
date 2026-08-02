import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

import postgres from "postgres";

import {
  BACKUP_SCHEMAS,
  ROLE_SPECS,
  captureDatabaseManifest,
  createBackupAndRestoreEvidence,
  verifyPoolerLogins,
} from "./cutover-credentials.mjs";
import {
  inspectCandidateDatabase,
  inspectProjectorLeaseDrain,
} from "./cutover-database.mjs";
import { assertCandidateFence } from "./cutover-phases.mjs";
import {
  assertNoSecretOutput,
  canonicalJson,
  sha256,
  validateMigrationPlan,
} from "./hosted-db-operator-core.mjs";
import {
  closeHostedDatabase,
  inspectMigrationState,
} from "./hosted-db-postgres.mjs";

const executeFile = promisify(execFile);
const SHA256 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,80}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POSTGRES_17 = /\b17\.(?:[0-9]+)(?:\.[0-9]+)?\b/u;
const SAFETY_MAX_AGE_MS = 30 * 60_000;
const SAFETY_FUTURE_SKEW_MS = 5 * 60_000;
const PRIVATE_MODE = 0o600;
const ADVISORY_LOCK_SQL = `
  select pg_catalog.pg_try_advisory_lock(
    pg_catalog.hashtextextended(
      'programmable:hosted-db-migrations:v1', 0
    )
  ) as migrations_acquired,
  pg_catalog.pg_try_advisory_lock(
    pg_catalog.hashtextextended(
      'programmable:candidate-cutover:v1', 0
    )
  ) as cutover_acquired,
  pg_catalog.pg_try_advisory_lock(
    pg_catalog.hashtextextended(
      'programmable:database-maintenance:v1', 0
    )
  ) as maintenance_acquired,
  pg_catalog.pg_try_advisory_lock(
    pg_catalog.hashtextextended(
      'programmable:candidate-in-place-restore:v1', 0
    )
  ) as restore_acquired,
  pg_catalog.pg_try_advisory_lock(
    pg_catalog.hashtextextended(
      'programmable:candidate-db-bootstrap:v1', 0
    )
  ) as bootstrap_acquired
`;
const OPERATOR_LOCK_NAMES = Object.freeze([
  "programmable:hosted-db-migrations:v1",
  "programmable:candidate-cutover:v1",
  "programmable:database-maintenance:v1",
  "programmable:candidate-in-place-restore:v1",
  "programmable:candidate-db-bootstrap:v1",
]);

export const CANDIDATE_PROJECT_REF = "mnnvlrqwhfoppogslsje";
export const PINNED_PRE_ATTESTATION_SNAPSHOT = Object.freeze({
  repositoryCommit: "88cd7078037910c22fc7e67e0031f7e4ef30e422",
  evidenceSha256:
    "0x89b1f957d250c568efdb378c61455d7b49b1aeda500cae83ae30542bbd07403a",
  bytes: 26_766_662,
  sha256:
    "0xb3679e8b178535bbc58f9c9c43690a8c7e310ade8bd93360f15004be385b02d2",
  archiveListSha256:
    "0x18037f0fc9740623c79a826a3a7d3b6c38ebd832ac98029aeca2f1064d914a55",
  schemaSqlSha256:
    "0x4735de7ab8b549e314ddc78e61262bbda81785962dc716d5590e3942246a3585",
  cleanSchemaSqlSha256:
    "0xa127d93dff5424fd9fb71cf6641e7d7dad647c4acc153438a749388e9f702500",
  cleanClosureSha256:
    "0x6620eeaa16d97c1bd561cb1bde670de16383f6b7b4f639bed0144a5aae7cdf83",
  cleanClosureStatementCount: 1_336,
  ownerSchemaSqlSha256:
    "0x46159963fd9b843e37dcd32619bf0cb0ab2693ebb762d9e8fb75b8e35f9891b0",
  ownerClosureSha256:
    "0xef6f4a48c6e6b12d5b84cd16ed8ad492d6510196d41956bb459aa30da2ef4c4f",
  ownerClosureStatementCount: 427,
  securityClosureSha256:
    "0x5a4f177e8a18aecfc75c358e74c6ebbf3ff2b35009c8499f93441ccd879dbe99",
  securityClosureStatementCount: 475,
  securityClosureBytes: 136_462,
  securityClosureGzipSha256:
    "0xf8a3205155b7c76156cd55d10e58ba1885181ef521c8ecbe1153b67a60857010",
  securityClosureGzipBytes: 10_214,
  migrationSourceCount: 29,
  migrationSourceClosureSha256:
    "0x6095ae8f67d429cd0ec97a39923fef88d9832f5789796be22ba5acea943b7288",
  manifestSha256:
    "0x5921ceacba6b7d3c636d3571fd7ebe9fad599626d03372836d0e6293e358c597",
  structuralManifestSha256:
    "0x1546ad4cf2312e3143cf8cd57422f4040924521db4531d2ef2b1a9875f662ef8",
});
export const CANDIDATE_PG_RESTRICT_KEY =
  "b3679e8b178535bbc58f9c9c43690a8c7e310ade8bd93360f15004be385b02d2"; // gitleaks:allow -- public archive SHA-256
export const OFFICIAL_POSTGRES_17_TOOLCHAIN = Object.freeze({
  version: "PostgreSQL 17.10",
  distribution: "edb-postgresql-17.10-2-osx-universal",
  archiveSha256:
    "0xc46e566fd599d5958602334cf717b0a11ef11fae4534edcef8f189e053368b83",
  runtimeLibrariesSha256:
    "0xd0e6a187c354dfda4255258e0f7d788eeeb3bedc986e82eb9e075dbb1399c1de",
  binaries: Object.freeze({
    pg_dump: Object.freeze({
      bytes: 1_002_832,
      sha256:
        "0xec02ea04cd23e9b76a14b2ff1fb835b4af63b57e1079ac77caffdc539bfc98b8",
    }),
    pg_restore: Object.freeze({
      bytes: 566_976,
      sha256:
        "0xae40639dff42dee3de17739f07763a1f0fa7f04bcdb970700b04d557fb418448",
    }),
    psql: Object.freeze({
      bytes: 1_449_808,
      sha256:
        "0x4cbf9b67fba769debe24912fa8b577b50154b61e925583379164343c4a9bb094",
    }),
  }),
});
export const CANDIDATE_RESTORE_SCHEMAS = BACKUP_SCHEMAS;
export const CANDIDATE_FINAL_SCHEMAS = Object.freeze([
  "programmable_private",
  "programmable_release_probe_private",
  "programmable_wake_private",
  "supabase_migrations",
]);
export const CANDIDATE_RESTORE_FLAGS = Object.freeze([
  "--exit-on-error",
  "--single-transaction",
  "--no-owner",
  "--no-privileges",
]);
export const CANDIDATE_SAFETY_RECOVERY_FLAGS = Object.freeze([
  "--exit-on-error",
  "--single-transaction",
  "--no-owner",
  "--no-privileges",
]);

const EXPECTED_ARCHIVE_SCHEMA_OWNERS = Object.freeze({
  programmable_private: "programmable_migrator",
  programmable_release_probe_private: "programmable_migrator",
  supabase_migrations: "postgres",
});
const BASELINE_SECURITY_CLOSURE_URL = new URL(
  "./pinned-pre-attestation-security.sql.gz",
  import.meta.url,
);
export const PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE = Object.freeze([
  Object.freeze({ version: "20260731000100", name: "private_schema_roles_domains", ordinal: 1, bytes: 25_551, sha256: "0x949bcbabf28d843ee25965deeadc9f4387c5dc7089b977fc3ad5b5e5db68df50" }),
  Object.freeze({ version: "20260731000200", name: "provider_ingestion_control", ordinal: 2, bytes: 71_511, sha256: "0x73b6a4718656698ca6aa5c262d148b89aafd46725243476badb6136df847c45b" }),
  Object.freeze({ version: "20260731000300", name: "event_occurrences_and_reward_seeds", ordinal: 3, bytes: 93_659, sha256: "0xb594f5f7a7bc06428c48d3fac467d5a380e4b43e894a8aee72d355a8d14c946f" }),
  Object.freeze({ version: "20260731000400", name: "core_launch_reward_projections", ordinal: 4, bytes: 145_513, sha256: "0x9ee2f0dd3aa123f658d0dbd28c1cc51dd46d28ad231189d539686d932cb028a7" }),
  Object.freeze({ version: "20260731000500", name: "profiles_market_parity", ordinal: 5, bytes: 93_198, sha256: "0x8570d2ab2632e556d400b3562ab48edea0b4712c009afceec7e15577886f60a9" }),
  Object.freeze({ version: "20260731000600", name: "read_views_functions_grants", ordinal: 6, bytes: 92_327, sha256: "0xcdbf17d182510f75c57d51b407401636cc2e7a10a6f631e1e3e40ed940a8e56a" }),
  Object.freeze({ version: "20260731000700", name: "p0_indexer_projection_hardening", ordinal: 7, bytes: 202_767, sha256: "0x121125268fb12b281469f173ad1eae2586f0f24e5d94a563d2eaf513b750a875" }),
  Object.freeze({ version: "20260731000800", name: "expanded_p0_closure", ordinal: 8, bytes: 146_830, sha256: "0xa08fd428c59cfa91fa0b8f72539c1012fc6efd6cac9fb02e149061a369d5e9df" }),
  Object.freeze({ version: "20260731175501", name: "atomic_empty_envio_coverage_pages", ordinal: 9, bytes: 449_025, sha256: "0x043bb480ebdc8dcf2ab1557f05ac0c5717242948bb50c09fe01a762961ff5642" }),
  Object.freeze({ version: "20260731202904", name: "release_probe_nonce_consumption", ordinal: 10, bytes: 13_300, sha256: "0xb039c7e3ca61f9a5b7dc75f28a8936e96efc883c4dc14890b76ca4a089a1e983" }),
  Object.freeze({ version: "20260731203900", name: "projector_runtime_singleton_lease", ordinal: 11, bytes: 16_698, sha256: "0x068f27a70ec6df57b84bf336fc2c46b316a7d10d40b9d489fc47e95acb6f74b0" }),
  Object.freeze({ version: "20260731222000", name: "reconciler_preparity_contract", ordinal: 12, bytes: 22_811, sha256: "0x5fd00ce01c4e1e088d2b1f066cd63d7da1b0bd2f12e8711abbad764da057def2" }),
  Object.freeze({ version: "20260731223000", name: "market_projector_contract", ordinal: 13, bytes: 142_002, sha256: "0xea73f4112a53b25e72aa697d3fc0679bf9c6e7f93a496edd167803d6a7f81a24" }),
  Object.freeze({ version: "20260731224000", name: "projector_provider_evidence_binding", ordinal: 14, bytes: 294_058, sha256: "0x0404f7c610a34af23fe536f021927efec4e0aede235068b70be04331c58f03af" }),
  Object.freeze({ version: "20260731225000", name: "reconciler_route_corpus", ordinal: 15, bytes: 46_895, sha256: "0xa43d2977aca92d6c9082383ae22c4dddecb41850402a87f6678db291af884251" }),
  Object.freeze({ version: "20260801024013", name: "projector_atomic_block_liveness", ordinal: 16, bytes: 53_574, sha256: "0x239c7a94aeb7138e025b59a724f0238f6648c3873c9e033b8abb8650575f81bc" }),
  Object.freeze({ version: "20260801042040", name: "classic_v3_dynamic_activation_reward_seed", ordinal: 17, bytes: 84_418, sha256: "0x48a8e517c8ea64c1e52782eba2727fa4b1f727897f91e90281951acbf960b188" }),
  Object.freeze({ version: "20260801090000", name: "bootstrap_dynamic_evidence_and_launch_requirements", ordinal: 18, bytes: 20_284, sha256: "0xe095d128feb12c8962c81be003e693dd67417cfed209144c998ab57d5e8786aa" }),
  Object.freeze({ version: "20260801091000", name: "candidate_projector_unpromoted_gate", ordinal: 19, bytes: 3_865, sha256: "0xcd8b5a4aa4801ca773cb84047edbf05349288cada47d671bd47e7d997902c91f" }),
  Object.freeze({ version: "20260801092000", name: "verify_candidate_database_promoted", ordinal: 20, bytes: 5_238, sha256: "0xed5f54a374ad8178393e88a3948281ad9acba10aebbbd5209ea6793691b8c677" }),
  Object.freeze({ version: "20260801093000", name: "bind_candidate_promotion_to_product", ordinal: 21, bytes: 11_764, sha256: "0xc6a032ef371b2211004c8d72c0a8c4eec4ba630776210aed48d2d054e642dbbe" }),
  Object.freeze({ version: "20260801094000", name: "hosted_bootstrap_projector_membership", ordinal: 22, bytes: 570, sha256: "0x488053dfcb4c3527c12ef3d8560a42973b4398812a1a1ce71d5db39fd6a58a80" }),
  Object.freeze({ version: "20260801100439", name: "projector_genesis_cursor_reader", ordinal: 23, bytes: 2_578, sha256: "0x5aef96613f5dc171719643535f1d9aadb08bb6dfe9b1673e805d1842c7091320" }),
  Object.freeze({ version: "20260801104022", name: "projector_current_generation_columns", ordinal: 24, bytes: 1_967, sha256: "0x3c1b4d53944c069d446958f398b88aa2140ed40ee6bd8c0fefce7dff30982ae4" }),
  Object.freeze({ version: "20260801125441", name: "reuse_safe_head_observations", ordinal: 25, bytes: 4_494, sha256: "0xafbeea7bcf60e492e51bfd0c56517613f32a6f87a0182af00c48bdaef6569e74" }),
  Object.freeze({ version: "20260801144403", name: "accept_uuid_v8_dynamic_source_lineage", ordinal: 26, bytes: 17_317, sha256: "0x85e0509d2a4fa49062a18d891e51cd0c64c1015926c3c3ef47a83ce16edb4170" }),
  Object.freeze({ version: "20260801155212", name: "reuse_dual_rpc_block_evidence", ordinal: 27, bytes: 9_319, sha256: "0x51142370cf7fdf2bd60c2812978fe2cbbacf99f42b87c72f0ad1ac61b303cf51" }),
  Object.freeze({
    version: "20260801204500",
    name: "reuse_dual_rpc_block_evidence_constraint",
    ordinal: 28,
    bytes: 4_635,
    sha256:
      "0x92cc63189b41eda613ba9da21b7ef21bee650a93f1825f5ee063727ee6c06b11",
  }),
  Object.freeze({
    version: "20260801210000",
    name: "allow_reused_receipt_ordinals_across_transactions",
    ordinal: 29,
    bytes: 1_810,
    sha256:
      "0x9740302b739f16e63571ee96bb92ac1768fa5b960aaf671d29878bda90254845",
  }),
]);

const OFFICIAL_TOOLCHAIN_EVIDENCE = Object.freeze({
  ...OFFICIAL_POSTGRES_17_TOOLCHAIN,
  toolchainSha256: sha256(canonicalJson(OFFICIAL_POSTGRES_17_TOOLCHAIN)),
});

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function exactCandidateTarget(value) {
  const expected = Object.freeze({
    projectRef: CANDIDATE_PROJECT_REF,
    host: `db.${CANDIDATE_PROJECT_REF}.supabase.co`,
    port: 5432,
    database: "postgres",
    sslMode: "verify-full",
  });
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Candidate restore target is not the reviewed project");
  }
  return expected;
}

function candidateOperatorIdentity(databaseUrl, expectedProjectRef) {
  if (expectedProjectRef !== CANDIDATE_PROJECT_REF) {
    throw new Error("Candidate restore project ref is not the reviewed project");
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Candidate restore database URL is invalid");
  }
  const username = decodeURIComponent(parsed.username);
  const parameters = [...parsed.searchParams.entries()];
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== `db.${CANDIDATE_PROJECT_REF}.supabase.co` ||
    parsed.port !== "5432" ||
    parsed.pathname !== "/postgres" ||
    !["postgres", "cli_login_postgres"].includes(username) ||
    parsed.password.length < 1 ||
    parsed.hash !== "" ||
    parameters.length !== 1 ||
    parameters[0][0] !== "sslmode" ||
    parameters[0][1] !== "verify-full"
  ) {
    throw new Error("Candidate restore database target is not exact");
  }
  return Object.freeze({
    mode:
      username === "postgres"
        ? "database-owner"
        : "supabase-cli-jit-set-role",
    sessionUser: username,
    effectiveRole: "postgres",
  });
}

function validateCandidateTarget(databaseUrl, expectedProjectRef) {
  candidateOperatorIdentity(databaseUrl, expectedProjectRef);
  return exactCandidateTarget({
    projectRef: CANDIDATE_PROJECT_REF,
    host: `db.${CANDIDATE_PROJECT_REF}.supabase.co`,
    port: 5432,
    database: "postgres",
    sslMode: "verify-full",
  });
}

function validateCaPem(value) {
  if (
    typeof value !== "string" ||
    value.length < 64 ||
    value.length > 32_768 ||
    !value.includes("-----BEGIN CERTIFICATE-----") ||
    !value.includes("-----END CERTIFICATE-----") ||
    value.includes("PRIVATE KEY")
  ) {
    throw new Error("Candidate restore requires a server-only Postgres CA");
  }
  return value;
}

async function openCandidateDatabase({
  databaseUrl,
  expectedProjectRef,
  sslCaPem,
}) {
  const target = validateCandidateTarget(databaseUrl, expectedProjectRef);
  const operatorIdentity = candidateOperatorIdentity(
    databaseUrl,
    expectedProjectRef,
  );
  const parsed = new URL(databaseUrl);
  const sql = postgres({
    host: parsed.hostname,
    port: Number(parsed.port),
    database: parsed.pathname.slice(1),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ssl: { rejectUnauthorized: true, ca: validateCaPem(sslCaPem) },
    max: 1,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 0,
    max_lifetime: null,
    onnotice: () => {},
    connection: {
      application_name: "programmable-candidate-restore-operator",
    },
  });
  try {
    const [before] = await sql.unsafe(`
      select session_user::text as session_user,
             current_user::text as current_user,
             current_role::text as current_role,
             pg_catalog.current_database()::text as database_name,
             pg_catalog.inet_server_port()::integer as server_port,
             pg_catalog.current_setting('server_version_num')::integer
               as server_version_num,
             pg_catalog.pg_has_role(
               session_user, 'postgres', 'member'
             ) as is_postgres_member
    `);
    if (
      before?.session_user !== operatorIdentity.sessionUser ||
      before?.current_user !== operatorIdentity.sessionUser ||
      before?.current_role !== operatorIdentity.sessionUser ||
      before?.database_name !== "postgres" ||
      Number(before?.server_port) !== 5432 ||
      Number(before?.server_version_num) < 150_000 ||
      (operatorIdentity.mode === "supabase-cli-jit-set-role" &&
        before?.is_postgres_member !== true)
    ) {
      throw new Error("Candidate database session identity is not approved");
    }
    if (operatorIdentity.mode === "supabase-cli-jit-set-role") {
      await sql.unsafe("set role postgres").simple();
    }
    const [after] = await sql.unsafe(`
      select session_user::text as session_user,
             current_user::text as current_user,
             current_role::text as current_role
    `);
    if (
      after?.session_user !== operatorIdentity.sessionUser ||
      after?.current_user !== "postgres" ||
      after?.current_role !== "postgres"
    ) {
      throw new Error("Candidate database effective role is not postgres");
    }
    return Object.freeze({ sql, target, operatorIdentity });
  } catch (error) {
    await sql.end({ timeout: 1 }).catch(() => {});
    throw error;
  }
}

function candidateState(value, label) {
  const state = plainObject(value, label);
  if (
    state.databaseMode !== "candidate-only" ||
    typeof state.envioProviderDeploymentId !== "string" ||
    !UUID.test(state.envioProviderDeploymentId) ||
    typeof state.promoted !== "boolean" ||
    !Number.isSafeInteger(state.publicationCount) ||
    state.publicationCount < 0 ||
    (state.promotionAttestationCommitment !== null &&
      !SHA256.test(state.promotionAttestationCommitment ?? "")) ||
    (state.productCommit !== null && !COMMIT.test(state.productCommit ?? "")) ||
    (state.stagedDeploymentId !== null &&
      !DEPLOYMENT_ID.test(state.stagedDeploymentId ?? "")) ||
    (state.promotedAt !== null && !Number.isFinite(Date.parse(state.promotedAt ?? "")))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return state;
}

function promotedCandidateState(value, currentProductCommit) {
  const state = candidateState(value, "current Candidate state");
  if (
    !COMMIT.test(currentProductCommit ?? "") ||
    state.promoted !== true ||
    state.productCommit !== currentProductCommit ||
    state.stagedDeploymentId === null ||
    state.promotionAttestationCommitment === null ||
    state.promotedAt === null
  ) {
    throw new Error("current Candidate product binding is not exact");
  }
  return state;
}

function drainedLeases(value) {
  const evidence = plainObject(value, "Candidate projector lease state");
  if (
    evidence.drained !== true ||
    !Array.isArray(evidence.leases) ||
    evidence.leases.length !== 2 ||
    evidence.leases[0]?.projector !== "market" ||
    evidence.leases[1]?.projector !== "source" ||
    evidence.leases.some((lease) => lease?.drained !== true)
  ) {
    throw new Error("Candidate projector leases are not drained");
  }
  return evidence;
}

function runtimeFence(value) {
  const fence = plainObject(value, "Candidate runtime login fence");
  const expectedRoles = ROLE_SPECS.map(({ loginRole }) => loginRole).sort();
  if (
    fence.fenced !== true ||
    !Array.isArray(fence.loginRoles) ||
    canonicalJson([...fence.loginRoles].sort()) !== canonicalJson(expectedRoles) ||
    !Number.isSafeInteger(fence.terminatedSessions) ||
    fence.terminatedSessions < 0
  ) {
    throw new Error("Candidate runtime login fence is incomplete");
  }
  return Object.freeze({
    fenced: true,
    loginRoles: Object.freeze(expectedRoles),
    terminatedSessions: fence.terminatedSessions,
  });
}

function validateBackupEvidence(value, {
  expectedProjectRef = CANDIDATE_PROJECT_REF,
  repositoryCommit,
} = {}) {
  const evidence = plainObject(value, "database backup evidence");
  if (
    evidence.kind !== "programmable-database-backup-restore-evidence" ||
    evidence.schemaVersion !== 1 ||
    (repositoryCommit !== undefined && evidence.repositoryCommit !== repositoryCommit) ||
    !COMMIT.test(evidence.repositoryCommit ?? "") ||
    !SHA256.test(evidence.requestSha256 ?? "") ||
    evidence.backup?.format !== "pg-custom-v1" ||
    !SHA256.test(evidence.backup?.sha256 ?? "") ||
    !SHA256.test(evidence.backup?.archiveListSha256 ?? "") ||
    !Number.isSafeInteger(evidence.backup?.bytes) ||
    evidence.backup.bytes <= 0 ||
    !SHA256.test(evidence.sourceManifestSha256 ?? "") ||
    evidence.restoredManifestSha256 !== evidence.sourceManifestSha256 ||
    (evidence.sourceStructuralManifestSha256 !== undefined &&
      (!SHA256.test(evidence.sourceStructuralManifestSha256) ||
        evidence.restoredStructuralManifestSha256 !==
          evidence.sourceStructuralManifestSha256)) ||
    !Number.isSafeInteger(evidence.tableCount) ||
    evidence.tableCount <= 0 ||
    !Number.isSafeInteger(evidence.rowCount) ||
    evidence.rowCount < 0 ||
    !/^PostgreSQL 17\./u.test(evidence.postgresVersion ?? "") ||
    !Number.isFinite(Date.parse(evidence.createdAt ?? "")) ||
    expectedProjectRef !== CANDIDATE_PROJECT_REF
  ) {
    throw new Error("database backup evidence is not a restorable Candidate snapshot");
  }
  exactCandidateTarget(evidence.source);
  return evidence;
}

export function validatePinnedSnapshotEvidence(value) {
  const evidence = validateBackupEvidence(value, {
    repositoryCommit: PINNED_PRE_ATTESTATION_SNAPSHOT.repositoryCommit,
  });
  if (
    sha256(canonicalJson(evidence)) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.evidenceSha256 ||
    evidence.backup.bytes !== PINNED_PRE_ATTESTATION_SNAPSHOT.bytes ||
    evidence.backup.sha256 !== PINNED_PRE_ATTESTATION_SNAPSHOT.sha256 ||
    evidence.backup.archiveListSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.archiveListSha256 ||
    evidence.sourceManifestSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.manifestSha256
  ) {
    throw new Error("pre-attestation snapshot is not the pinned release artifact");
  }
  return evidence;
}

function backupReference(evidence) {
  const validated = validateBackupEvidence(evidence);
  return Object.freeze({
    evidenceSha256: sha256(canonicalJson(validated)),
    repositoryCommit: validated.repositoryCommit,
    sha256: validated.backup.sha256,
    bytes: validated.backup.bytes,
    archiveListSha256: validated.backup.archiveListSha256,
    manifestSha256: validated.sourceManifestSha256,
    ...(validated.sourceStructuralManifestSha256 === undefined
      ? {}
      : {
          structuralManifestSha256:
            validated.sourceStructuralManifestSha256,
        }),
    tableCount: validated.tableCount,
    rowCount: validated.rowCount,
    postgresVersion: validated.postgresVersion,
    createdAt: validated.createdAt,
  });
}

function safetyPayload(value) {
  return {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    operatorCommit: value.operatorCommit,
    target: value.target,
    operatorIdentity: value.operatorIdentity,
    currentProductCommit: value.currentProductCommit,
    currentCandidateState: value.currentCandidateState,
    projectorLeases: value.projectorLeases,
    runtimeLoginFence: value.runtimeLoginFence,
    caSha256: value.caSha256,
    postgresToolchain: value.postgresToolchain,
    backup: value.backup,
    createdAt: value.createdAt,
  };
}

export function buildCandidateSafetyBackupEvidence(input) {
  if (!COMMIT.test(input.operatorCommit ?? "")) {
    throw new Error("Candidate safety backup operator commit is invalid");
  }
  const target = exactCandidateTarget(input.target);
  const operatorIdentity = plainObject(
    input.operatorIdentity,
    "Candidate safety backup operator identity",
  );
  if (
    !["database-owner", "supabase-cli-jit-set-role"].includes(
      operatorIdentity.mode,
    ) ||
    operatorIdentity.sessionUser !==
      (operatorIdentity.mode === "database-owner"
        ? "postgres"
        : "cli_login_postgres") ||
    operatorIdentity.effectiveRole !== "postgres"
  ) {
    throw new Error("Candidate safety backup operator identity is invalid");
  }
  const before = promotedCandidateState(
    input.beforeCandidateState,
    input.currentProductCommit,
  );
  const after = promotedCandidateState(
    input.afterCandidateState,
    input.currentProductCommit,
  );
  if (canonicalJson(before) !== canonicalJson(after)) {
    throw new Error("Candidate state changed during the safety backup");
  }
  const leases = drainedLeases(input.projectorLeases);
  const fence = runtimeFence(input.runtimeLoginFence);
  if (!SHA256.test(input.caSha256 ?? "")) {
    throw new Error("Candidate safety backup CA commitment is invalid");
  }
  const toolchain = plainObject(
    input.postgresToolchain,
    "Candidate safety backup Postgres toolchain",
  );
  if (
    canonicalJson(toolchain) !== canonicalJson(OFFICIAL_TOOLCHAIN_EVIDENCE)
  ) {
    throw new Error("Candidate safety backup Postgres toolchain is not pinned");
  }
  const backupEvidence = validateBackupEvidence(
    input.backupResult?.evidence,
    { repositoryCommit: input.operatorCommit },
  );
  if (backupEvidence.sourceManifestSha256 !== input.currentManifest?.manifestSha256) {
    throw new Error("Candidate changed after the safety backup");
  }
  if (
    !SHA256.test(backupEvidence.sourceStructuralManifestSha256 ?? "") ||
    backupEvidence.sourceStructuralManifestSha256 !==
      input.currentManifest?.structuralManifestSha256
  ) {
    throw new Error("Candidate structure changed after the safety backup");
  }
  if (
    input.currentManifest?.tableCount !== backupEvidence.tableCount ||
    input.currentManifest?.rowCount !== backupEvidence.rowCount
  ) {
    throw new Error("Candidate safety backup counts changed");
  }
  const createdAt = new Date(input.createdAt ?? backupEvidence.createdAt);
  if (!Number.isFinite(createdAt.valueOf())) {
    throw new Error("Candidate safety backup timestamp is invalid");
  }
  const payload = Object.freeze({
    kind: "programmable-candidate-restore-safety-backup-evidence",
    schemaVersion: 1,
    operatorCommit: input.operatorCommit,
    target,
    operatorIdentity: Object.freeze({ ...operatorIdentity }),
    currentProductCommit: input.currentProductCommit,
    currentCandidateState: Object.freeze({ ...before }),
    projectorLeases: Object.freeze({ ...leases }),
    runtimeLoginFence: fence,
    caSha256: input.caSha256,
    postgresToolchain: Object.freeze({ ...toolchain }),
    backup: backupReference(backupEvidence),
    createdAt: createdAt.toISOString(),
  });
  return Object.freeze({
    ...payload,
    evidenceSha256: sha256(canonicalJson(safetyPayload(payload))),
  });
}

export function validateCandidateSafetyBackupEvidence(value, {
  operatorCommit,
  currentProductCommit,
  now = new Date(),
  enforceFreshness = true,
} = {}) {
  const evidence = plainObject(value, "Candidate safety backup evidence");
  if (
    evidence.kind !== "programmable-candidate-restore-safety-backup-evidence" ||
    evidence.schemaVersion !== 1 ||
    !COMMIT.test(evidence.operatorCommit ?? "") ||
    (operatorCommit !== undefined && evidence.operatorCommit !== operatorCommit) ||
    !COMMIT.test(evidence.currentProductCommit ?? "") ||
    (currentProductCommit !== undefined &&
      evidence.currentProductCommit !== currentProductCommit) ||
    !SHA256.test(evidence.evidenceSha256 ?? "") ||
    !SHA256.test(evidence.caSha256 ?? "") ||
    sha256(canonicalJson(safetyPayload(evidence))) !== evidence.evidenceSha256
  ) {
    throw new Error("Candidate safety backup evidence is invalid");
  }
  exactCandidateTarget(evidence.target);
  const operatorIdentity = plainObject(
    evidence.operatorIdentity,
    "Candidate safety backup operator identity",
  );
  if (
    !["database-owner", "supabase-cli-jit-set-role"].includes(
      operatorIdentity.mode,
    ) ||
    operatorIdentity.sessionUser !==
      (operatorIdentity.mode === "database-owner"
        ? "postgres"
        : "cli_login_postgres") ||
    operatorIdentity.effectiveRole !== "postgres"
  ) {
    throw new Error("Candidate safety backup operator identity is invalid");
  }
  promotedCandidateState(
    evidence.currentCandidateState,
    evidence.currentProductCommit,
  );
  drainedLeases(evidence.projectorLeases);
  runtimeFence(evidence.runtimeLoginFence);
  if (
    canonicalJson(evidence.postgresToolchain) !==
    canonicalJson(OFFICIAL_TOOLCHAIN_EVIDENCE)
  ) {
    throw new Error("Candidate safety backup toolchain is invalid");
  }
  const backup = plainObject(evidence.backup, "Candidate safety backup reference");
  if (
    backup.repositoryCommit !== evidence.operatorCommit ||
    !SHA256.test(backup.evidenceSha256 ?? "") ||
    !SHA256.test(backup.sha256 ?? "") ||
    !SHA256.test(backup.archiveListSha256 ?? "") ||
    !SHA256.test(backup.manifestSha256 ?? "") ||
    !SHA256.test(backup.structuralManifestSha256 ?? "") ||
    !Number.isSafeInteger(backup.bytes) ||
    backup.bytes <= 0 ||
    !Number.isSafeInteger(backup.tableCount) ||
    backup.tableCount <= 0 ||
    !Number.isSafeInteger(backup.rowCount) ||
    backup.rowCount < 0 ||
    !/^PostgreSQL 17\./u.test(backup.postgresVersion ?? "") ||
    !Number.isFinite(Date.parse(backup.createdAt ?? "")) ||
    evidence.createdAt !== backup.createdAt
  ) {
    throw new Error("Candidate safety backup reference is invalid");
  }
  const observedNow = now instanceof Date ? now : new Date(now);
  const created = new Date(evidence.createdAt);
  const age = observedNow.valueOf() - created.valueOf();
  if (
    enforceFreshness &&
    (!Number.isFinite(observedNow.valueOf()) ||
      !Number.isFinite(created.valueOf()) ||
      age > SAFETY_MAX_AGE_MS ||
      age < -SAFETY_FUTURE_SKEW_MS)
  ) {
    throw new Error("Candidate safety backup is not fresh");
  }
  return evidence;
}

function validateDependencies(value, allowed) {
  if (value === undefined) return Object.freeze({});
  const dependencies = plainObject(value, "Candidate restore dependencies");
  for (const key of Object.keys(dependencies)) {
    if (!allowed.includes(key) || typeof dependencies[key] !== "function") {
      throw new Error("Candidate restore dependencies are invalid");
    }
  }
  return dependencies;
}

async function acquireRestoreLock(sql) {
  const [row] = await sql.unsafe(ADVISORY_LOCK_SQL);
  if (
    row?.migrations_acquired !== true ||
    row?.cutover_acquired !== true ||
    row?.maintenance_acquired !== true ||
    row?.restore_acquired !== true ||
    row?.bootstrap_acquired !== true
  ) {
    throw new Error("a migration, cutover or maintenance operator holds a database lock");
  }
  return captureCandidateOperatorSession(sql, { requireLocks: true });
}

async function captureCandidateOperatorSession(
  sql,
  { expected, requireLocks = false } = {},
) {
  const lockValues = OPERATOR_LOCK_NAMES
    .map((name) => `('${name.replaceAll("'", "''")}')`)
    .join(", ");
  const [row] = await sql.unsafe(`
    select pg_catalog.pg_backend_pid()::integer as backend_pid,
           session_user::text as session_user,
           current_user::text as current_user,
           current_role::text as current_role,
           (
             select pg_catalog.count(*)::integer
               from pg_catalog.pg_locks as held
               join (values ${lockValues}) as expected_lock(lock_name)
                 on held.classid::bigint =
                    ((pg_catalog.hashtextextended(expected_lock.lock_name, 0)
                      >> 32) & 4294967295)
                and held.objid::bigint =
                    (pg_catalog.hashtextextended(expected_lock.lock_name, 0)
                     & 4294967295)
              where held.locktype = 'advisory'
                and held.objsubid = 1
                and held.pid = pg_catalog.pg_backend_pid()
                and held.mode = 'ExclusiveLock'
                and held.granted
           ) as operator_lock_count
  `);
  const checkpoint = Object.freeze({
    backendPid: Number(row?.backend_pid),
    sessionUser: row?.session_user,
    currentUser: row?.current_user,
    currentRole: row?.current_role,
    operatorLockCount: Number(row?.operator_lock_count),
  });
  if (
    !Number.isSafeInteger(checkpoint.backendPid) ||
    checkpoint.backendPid < 1 ||
    !["postgres", "cli_login_postgres"].includes(checkpoint.sessionUser) ||
    checkpoint.currentUser !== "postgres" ||
    checkpoint.currentRole !== "postgres" ||
    (requireLocks && checkpoint.operatorLockCount !== OPERATOR_LOCK_NAMES.length) ||
    (expected !== undefined &&
      (checkpoint.backendPid !== expected.backendPid ||
        checkpoint.sessionUser !== expected.sessionUser ||
        checkpoint.currentUser !== expected.currentUser ||
        checkpoint.currentRole !== expected.currentRole ||
        checkpoint.operatorLockCount !== OPERATOR_LOCK_NAMES.length))
  ) {
    throw new Error("Candidate operator session or advisory lock was lost");
  }
  return checkpoint;
}

async function assertCandidateOperatorSession(sql, checkpoint) {
  if (checkpoint === undefined) return;
  await captureCandidateOperatorSession(sql, {
    expected: checkpoint,
    requireLocks: true,
  });
}

const RUNTIME_LOGIN_ROLES = Object.freeze(
  ROLE_SPECS.map(({ loginRole }) => loginRole).sort(),
);

async function fenceRuntimeLogins(sql) {
  const roleNames = RUNTIME_LOGIN_ROLES.map((role) => `'${role}'`).join(", ");
  const statements = RUNTIME_LOGIN_ROLES
    .map((role) => `alter role ${role} nologin;`)
    .join("\n");
  await sql.unsafe("set lock_timeout = '4s'; set statement_timeout = '30s'").simple();
  const [identity] = await sql.unsafe(`
    select session_user::text as session_user,
           current_user::text as current_user,
           current_role::text as current_role,
           pg_catalog.current_database()::text as database_name,
           pg_catalog.inet_server_port()::integer as server_port,
           pg_catalog.pg_has_role(
             session_user, 'postgres', 'member'
           ) as is_postgres_member
  `);
  if (
    !["postgres", "cli_login_postgres"].includes(identity?.session_user) ||
    identity?.current_user !== "postgres" ||
    identity?.current_role !== "postgres" ||
    identity?.database_name !== "postgres" ||
    Number(identity?.server_port) !== 5432 ||
    (identity?.session_user === "cli_login_postgres" &&
      identity?.is_postgres_member !== true)
  ) {
    throw new Error("Candidate restore operator identity is not approved");
  }
  await sql.unsafe(statements).simple();
  const terminated = await sql.unsafe(`
    select pg_catalog.pg_terminate_backend(activity.pid) as terminated
      from pg_catalog.pg_stat_activity as activity
     where activity.usename in (${roleNames})
       and activity.pid <> pg_catalog.pg_backend_pid()
  `);
  const roles = await sql.unsafe(`
    select rolname, rolcanlogin
      from pg_catalog.pg_roles
     where rolname in (${roleNames})
     order by rolname
  `);
  const active = await sql.unsafe(`
    select pg_catalog.count(*)::integer as active_count
      from pg_catalog.pg_stat_activity
     where usename in (${roleNames})
       and pid <> pg_catalog.pg_backend_pid()
  `);
  if (
    roles.length !== RUNTIME_LOGIN_ROLES.length ||
    roles.some((role, index) =>
      role.rolname !== RUNTIME_LOGIN_ROLES[index] || role.rolcanlogin !== false) ||
    Number(active[0]?.active_count) !== 0 ||
    terminated.some((row) => row.terminated !== true)
  ) {
    throw new Error("Candidate runtime login fence did not close exactly");
  }
  return runtimeFence({
    fenced: true,
    loginRoles: RUNTIME_LOGIN_ROLES,
    terminatedSessions: terminated.length,
  });
}

async function assertRuntimeLoginsFenced(sql) {
  const roleNames = RUNTIME_LOGIN_ROLES.map((role) => `'${role}'`).join(", ");
  const roles = await sql.unsafe(`
    select rolname, rolcanlogin
      from pg_catalog.pg_roles
     where rolname in (${roleNames})
     order by rolname
  `);
  const active = await sql.unsafe(`
    select pg_catalog.count(*)::integer as active_count
      from pg_catalog.pg_stat_activity
     where usename in (${roleNames})
       and pid <> pg_catalog.pg_backend_pid()
  `);
  if (
    roles.length !== RUNTIME_LOGIN_ROLES.length ||
    roles.some((role, index) =>
      role.rolname !== RUNTIME_LOGIN_ROLES[index] || role.rolcanlogin !== false) ||
    Number(active[0]?.active_count) !== 0
  ) {
    throw new Error("Candidate runtime logins are not fenced");
  }
  return runtimeFence({
    fenced: true,
    loginRoles: RUNTIME_LOGIN_ROLES,
    terminatedSessions: 0,
  });
}

export async function createCandidateSafetyBackup(input) {
  if (!COMMIT.test(input.repositoryCommit ?? "")) {
    throw new Error("Candidate safety backup repository commit is invalid");
  }
  const target = validateCandidateTarget(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const operatorIdentity = candidateOperatorIdentity(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  validateCaPem(input.sslCaPem);
  const dependencies = validateDependencies(input.dependencies, [
    "runCommand",
    "validateOfficialToolchain",
    "openHostedDatabase",
    "closeHostedDatabase",
    "acquireRestoreLock",
    "assertOperatorSession",
    "inspectCandidateDatabase",
    "inspectProjectorLeaseDrain",
    "fenceRuntimeLogins",
    "assertRuntimeLoginsFenced",
    "createBackupAndRestoreEvidence",
    "captureDatabaseManifest",
  ]);
  const runner = dependencies.runCommand ?? defaultRunCommand;
  const inspectToolchain =
    dependencies.validateOfficialToolchain ?? validateOfficialToolchain;
  const inspectedToolchain = await inspectToolchain({
    pgDumpBinary: input.pgDumpBinary,
    pgRestoreBinary: input.pgRestoreBinary,
    psqlBinary: input.psqlBinary,
    runner,
    secrets: [
      input.databaseUrl,
      input.restoreDatabaseUrl,
      input.sslCaPem,
      input.restoreSslCaPem,
    ],
  });
  const toolchain = dependencies.validateOfficialToolchain
    ? inspectedToolchain
    : await materializeOfficialToolchain(inspectedToolchain);
  const openDatabase = dependencies.openHostedDatabase ?? openCandidateDatabase;
  const closeDatabase = dependencies.closeHostedDatabase ?? closeHostedDatabase;
  const acquire = dependencies.acquireRestoreLock ?? acquireRestoreLock;
  const assertOperatorSession =
    dependencies.assertOperatorSession ?? assertCandidateOperatorSession;
  const inspectState =
    dependencies.inspectCandidateDatabase ?? inspectCandidateDatabase;
  const inspectLeases =
    dependencies.inspectProjectorLeaseDrain ?? inspectProjectorLeaseDrain;
  const fence = dependencies.fenceRuntimeLogins ?? fenceRuntimeLogins;
  const inspectLoginFence =
    dependencies.assertRuntimeLoginsFenced ?? assertRuntimeLoginsFenced;
  const createBackup =
    dependencies.createBackupAndRestoreEvidence ??
    createBackupAndRestoreEvidence;
  const captureManifest =
    dependencies.captureDatabaseManifest ?? captureDatabaseManifest;
  let connection;
  try {
    connection = await openDatabase({
      databaseUrl: input.databaseUrl,
      expectedProjectRef: input.expectedProjectRef,
      sslCaPem: input.sslCaPem,
    });
    if (
      canonicalJson(connection.target) !== canonicalJson(target) ||
      (connection.operatorIdentity !== undefined &&
        canonicalJson(connection.operatorIdentity) !==
          canonicalJson(operatorIdentity))
    ) {
      throw new Error("Candidate safety backup target changed");
    }
    const operatorSession = await acquire(connection.sql);
    const beforeCandidateState = promotedCandidateState(
      await inspectState(connection.sql),
      input.currentProductCommit,
    );
    const projectorLeases = drainedLeases(await inspectLeases(connection.sql));
    const runtimeLoginFence = runtimeFence(await fence(connection.sql));
    await assertOperatorSession(connection.sql, operatorSession);
    const pinnedRunner = async (...arguments_) => {
      await revalidateToolchain(toolchain);
      return runner(...arguments_);
    };
    const backupResult = await createBackup({
      operationId: input.operationId,
      repositoryCommit: input.repositoryCommit,
      sourceDatabaseUrl: input.databaseUrl,
      expectedProjectRef: input.expectedProjectRef,
      allowedSourceUsernames: Object.freeze([
        "postgres",
        "cli_login_postgres",
      ]),
      sslCaPem: input.sslCaPem,
      restoreDatabaseUrl: input.restoreDatabaseUrl,
      restoreIsolationId: input.restoreIsolationId,
      restoreSslCaPem: input.restoreSslCaPem,
      backupPath: input.backupPath,
      evidencePath: input.backupEvidencePath,
      pgDumpBinary: toolchain.paths.pg_dump,
      pgRestoreBinary: toolchain.paths.pg_restore,
      psqlBinary: toolchain.paths.psql,
      toolCommitments: OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries,
      dependencies: Object.freeze({
        runCommand: pinnedRunner,
        openHostedDatabase: openCandidateDatabase,
      }),
    });
    await assertOperatorSession(connection.sql, operatorSession);
    const afterCandidateState = await inspectState(connection.sql);
    drainedLeases(await inspectLeases(connection.sql));
    await inspectLoginFence(connection.sql);
    const currentManifest = await captureManifest(connection.sql);
    return buildCandidateSafetyBackupEvidence({
      operatorCommit: input.repositoryCommit,
      currentProductCommit: input.currentProductCommit,
      target,
      operatorIdentity,
      beforeCandidateState,
      afterCandidateState,
      projectorLeases,
      runtimeLoginFence,
      caSha256: sha256(Buffer.from(input.sslCaPem)),
      postgresToolchain: toolchain.evidence,
      backupResult,
      currentManifest,
      createdAt: backupResult.evidence.createdAt,
    });
  } catch {
    throw new Error(
      "Candidate safety backup failed; runtime logins may remain fenced",
    );
  } finally {
    if (connection?.sql) await closeDatabase(connection.sql).catch(() => {});
    if (toolchain.cleanupDirectory) {
      await rm(toolchain.cleanupDirectory, { recursive: true, force: true }).catch(
        () => {},
      );
    }
  }
}

async function privateRegularFile(filePath, label, { executable = false } = {}) {
  if (
    typeof filePath !== "string" ||
    !path.isAbsolute(filePath) ||
    filePath.includes("\0")
  ) {
    throw new Error(`${label} path must be absolute`);
  }
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (!executable && (metadata.mode & 0o777) !== PRIVATE_MODE) ||
    (executable && (metadata.mode & 0o111) === 0)
  ) {
    throw new Error(`${label} must be an approved regular file`);
  }
  return { path: await realpath(filePath), metadata };
}

async function fileCommitment(filePath) {
  const contents = await readFile(filePath);
  return Object.freeze({
    bytes: contents.byteLength,
    sha256: sha256(contents),
  });
}

async function runtimeLibrariesCommitment(binaryDirectory) {
  const libraryDirectory = path.resolve(binaryDirectory, "../lib");
  const entries = [];
  for (const name of (await readdir(libraryDirectory))
    .filter((entry) => entry.endsWith(".dylib"))
    .sort()) {
    const filePath = path.join(libraryDirectory, name);
    const metadata = await lstat(filePath);
    if (metadata.isSymbolicLink()) {
      const target = await readlink(filePath);
      if (
        path.basename(target) !== target ||
        target.includes("..") ||
        !(await lstat(path.join(libraryDirectory, target))).isFile()
      ) {
        throw new Error("Postgres runtime library symlink is unsafe");
      }
      entries.push({ name, type: "symlink", target });
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error("Postgres runtime library is not a regular file");
    }
    const commitment = await fileCommitment(filePath);
    entries.push({ name, type: "file", ...commitment });
  }
  if (entries.length < 1) {
    throw new Error("Postgres runtime library set is empty");
  }
  return Object.freeze({
    directory: libraryDirectory,
    entries: Object.freeze(entries),
    sha256: sha256(canonicalJson(entries)),
  });
}

export async function validateOfficialToolchain(input) {
  const paths = {
    pg_dump: input.pgDumpBinary,
    pg_restore: input.pgRestoreBinary,
    psql: input.psqlBinary,
  };
  const binaries = {};
  let binaryDirectory = null;
  for (const [name, filePath] of Object.entries(paths)) {
    const file = await privateRegularFile(filePath, name, { executable: true });
    if (path.basename(file.path) !== name) {
      throw new Error("Postgres tool filename is not exact");
    }
    const directory = path.dirname(file.path);
    if (binaryDirectory !== null && binaryDirectory !== directory) {
      throw new Error("Postgres tools do not share one reviewed runtime");
    }
    binaryDirectory = directory;
    const commitment = await fileCommitment(file.path);
    const expected = OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries[name];
    if (
      commitment.bytes !== expected.bytes ||
      commitment.sha256 !== expected.sha256
    ) {
      throw new Error(`Postgres tool ${name} is not the pinned official binary`);
    }
    binaries[name] = Object.freeze({
      path: file.path,
      metadata: file.metadata,
      ...commitment,
    });
  }
  const runtime = await runtimeLibrariesCommitment(binaryDirectory);
  if (
    runtime.sha256 !==
    OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256
  ) {
    throw new Error("Postgres runtime libraries are not the pinned distribution");
  }
  const environment = Object.freeze({ LANG: "C", LC_ALL: "C" });
  for (const [name, binary] of Object.entries(binaries)) {
    const result = await safeToolCall({
      runner: input.runner ?? defaultRunCommand,
      binary: binary.path,
      args: ["--version"],
      environment,
      timeoutMs: 15_000,
      secrets: input.secrets,
      expectedBinary: binary,
      expectedRuntimeSha256: runtime.sha256,
    });
    if (postgresVersion(result.stdout) !== OFFICIAL_POSTGRES_17_TOOLCHAIN.version) {
      throw new Error(`Postgres tool ${name} version is not pinned`);
    }
  }
  return Object.freeze({
    paths: Object.freeze(
      Object.fromEntries(
        Object.entries(binaries).map(([name, binary]) => [name, binary.path]),
      ),
    ),
    binaryDirectory,
    runtimeDirectory: runtime.directory,
    evidence: Object.freeze({
      ...OFFICIAL_POSTGRES_17_TOOLCHAIN,
      toolchainSha256: sha256(canonicalJson(OFFICIAL_POSTGRES_17_TOOLCHAIN)),
    }),
  });
}

async function revalidateToolchain(toolchain) {
  for (const [name, expected] of Object.entries(
    OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries,
  )) {
    const actual = await fileCommitment(toolchain.paths[name]);
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      throw new Error(`Postgres tool ${name} changed before execution`);
    }
  }
  const runtime = await runtimeLibrariesCommitment(toolchain.binaryDirectory);
  if (runtime.sha256 !== OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256) {
    throw new Error("Postgres runtime changed before execution");
  }
}

export async function materializeOfficialToolchain(toolchain) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "programmable-pinned-pg17-runtime-"),
  );
  const binaryDirectory = path.join(directory, "bin");
  const libraryDirectory = path.join(directory, "lib");
  try {
    await chmod(directory, 0o700);
    await mkdir(binaryDirectory, { mode: 0o700 });
    await mkdir(libraryDirectory, { mode: 0o700 });
    const paths = {};
    for (const [name, expected] of Object.entries(
      OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries,
    )) {
      const destination = path.join(binaryDirectory, name);
      await copyFile(
        toolchain.paths[name],
        destination,
        fsConstants.COPYFILE_EXCL,
      );
      await chmod(destination, 0o500);
      const actual = await fileCommitment(destination);
      if (canonicalJson(actual) !== canonicalJson(expected)) {
        throw new Error(`private Postgres tool ${name} copy is not exact`);
      }
      paths[name] = destination;
    }
    for (const name of (await readdir(toolchain.runtimeDirectory))
      .filter((entry) => entry.endsWith(".dylib"))
      .sort()) {
      const source = path.join(toolchain.runtimeDirectory, name);
      const destination = path.join(libraryDirectory, name);
      const metadata = await lstat(source);
      if (metadata.isSymbolicLink()) {
        const target = await readlink(source);
        if (path.basename(target) !== target || target.includes("..")) {
          throw new Error("Postgres runtime library symlink is unsafe");
        }
        await symlink(target, destination);
      } else if (metadata.isFile()) {
        await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
        await chmod(destination, 0o400);
      } else {
        throw new Error("Postgres runtime library is not a regular file");
      }
    }
    const runtime = await runtimeLibrariesCommitment(binaryDirectory);
    if (
      runtime.sha256 !==
      OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256
    ) {
      throw new Error("private Postgres runtime copy is not exact");
    }
    return Object.freeze({
      ...toolchain,
      paths: Object.freeze(paths),
      binaryDirectory,
      runtimeDirectory: libraryDirectory,
      cleanupDirectory: directory,
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function createPrivateArtifactSnapshot(sourcePath, reference, label) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "programmable-pinned-restore-artifact-"),
  );
  try {
    await chmod(directory, 0o700);
    const contents = await readFile(sourcePath);
    validateArtifact(
      reference,
      Object.freeze({ bytes: contents.byteLength, sha256: sha256(contents) }),
      label,
    );
    const destination = path.join(directory, "archive.dump");
    const descriptor = await open(
      destination,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o400,
    );
    try {
      await descriptor.writeFile(contents);
      await descriptor.sync();
    } finally {
      await descriptor.close();
    }
    validateArtifact(reference, await fileCommitment(destination), label);
    return Object.freeze({
      path: destination,
      directory,
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function defaultRunCommand(binary, args, options) {
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

async function safeToolCall({
  runner,
  binary,
  args,
  environment,
  timeoutMs,
  secrets,
  expectedBinary,
  expectedRuntimeSha256,
}) {
  const serialized = args.join("\0");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0 && serialized.includes(secret)) {
      throw new Error("Candidate restore credential reached a process argument");
    }
  }
  if (expectedBinary !== undefined) {
    const actual = await fileCommitment(binary);
    if (
      actual.bytes !== expectedBinary.bytes ||
      actual.sha256 !== expectedBinary.sha256
    ) {
      throw new Error("Postgres tool changed immediately before execution");
    }
  }
  if (expectedRuntimeSha256 !== undefined) {
    const runtime = await runtimeLibrariesCommitment(path.dirname(binary));
    if (runtime.sha256 !== expectedRuntimeSha256) {
      throw new Error("Postgres runtime changed immediately before execution");
    }
  }
  try {
    const result = await runner(binary, Object.freeze([...args]), {
      cwd: path.dirname(args.at(-1) ?? binary),
      env: Object.freeze({ ...environment }),
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
  } catch {
    throw new Error("Candidate restore Postgres tool failed");
  }
}

function postgresVersion(stdout) {
  const output = Buffer.isBuffer(stdout)
    ? stdout.toString("utf8")
    : String(stdout ?? "");
  const match = POSTGRES_17.exec(output);
  if (!match) throw new Error("Candidate restore requires PostgreSQL 17 tools");
  return `PostgreSQL ${match[0]}`;
}

function archiveSchemas(list) {
  const owners = {};
  for (const line of list.toString("utf8").split(/\r?\n/u)) {
    const match = /^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+(\S+)\s+(\S+)$/u.exec(line);
    if (match) owners[match[1]] = match[2];
  }
  if (canonicalJson(owners) !== canonicalJson(EXPECTED_ARCHIVE_SCHEMA_OWNERS)) {
    throw new Error("Candidate archive schema set is not exact");
  }
  return Object.freeze({ ...owners });
}

function exactClosureLines(sqlBytes, pattern, label) {
  const lines = sqlBytes.toString("utf8").split(/\r?\n/u);
  const statements = lines.filter((line) => pattern.test(line));
  if (
    statements.length < 1 ||
    statements.some(
      (statement) =>
        !statement.endsWith(";") ||
        /[\u0000\r\n]/u.test(statement),
    )
  ) {
    throw new Error(`${label} is not line-stable SQL`);
  }
  return Object.freeze({
    sql: `${statements.join("\n")}\n`,
    statementCount: statements.length,
  });
}

function cleanClosure(sqlBytes) {
  return exactClosureLines(
    sqlBytes,
    /^(?:DROP |ALTER TABLE IF EXISTS ONLY .+ DROP CONSTRAINT IF EXISTS )/u,
    "Candidate cleanup closure",
  );
}

function ownerClosure(sqlBytes) {
  return exactClosureLines(
    sqlBytes,
    /^ALTER .+ OWNER TO (?:postgres|programmable_migrator);$/u,
    "Candidate owner closure",
  );
}

function securityClosure(sqlBytes) {
  return exactClosureLines(
    sqlBytes,
    /^(?:GRANT |REVOKE |ALTER DEFAULT PRIVILEGES )/u,
    "Candidate security closure",
  );
}

async function pinnedBaselineSecurityClosure() {
  const compressed = await readFile(BASELINE_SECURITY_CLOSURE_URL);
  if (
    compressed.byteLength !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureGzipBytes ||
    sha256(compressed) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureGzipSha256
  ) {
    throw new Error("pinned Candidate security closure changed");
  }
  let sqlBytes;
  try {
    sqlBytes = gunzipSync(compressed);
  } catch {
    throw new Error("pinned Candidate security closure is invalid");
  }
  if (
    sqlBytes.byteLength !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureBytes ||
    sha256(sqlBytes) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureSha256
  ) {
    throw new Error("pinned Candidate security SQL changed");
  }
  const closure = securityClosure(sqlBytes);
  if (Buffer.byteLength(closure.sql) !== sqlBytes.byteLength) {
    throw new Error("pinned Candidate security SQL is not normalized");
  }
  return closure;
}

async function verifyPinnedBaselineMigrationSourceClosure() {
  if (
    PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE.length !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.migrationSourceCount ||
    PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE.some(
      (source, index) => source.ordinal !== index + 1,
    ) ||
    sha256(canonicalJson(PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE)) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.migrationSourceClosureSha256
  ) {
    throw new Error("pinned Candidate migration source manifest changed");
  }
  const verified = [];
  for (const source of PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE) {
    const fileName = `${source.version}_${source.name}.sql`;
    const contents = await readFile(
      new URL(`../../supabase/migrations/${fileName}`, import.meta.url),
    );
    if (
      contents.byteLength !== source.bytes ||
      sha256(contents) !== source.sha256
    ) {
      throw new Error("pinned Candidate migration source closure changed");
    }
    verified.push(source);
  }
  return Object.freeze(verified);
}

const LATER_ONLY_RESTRICT_CLEANUP_SQL = `
drop function if exists programmable_private.append_optimistic_block_observation_v1(uuid,bigint,bigint,bytea,bytea,bytea,bytea,timestamptz,timestamptz,uuid,uuid,bigint,bigint,bytea,timestamptz) restrict;
drop function if exists programmable_private.append_optimistic_event_row_v1(uuid,uuid,bytea,bigint,bigint,bytea,bytea,bytea[],bytea,jsonb,bytea,timestamptz) restrict;
drop function if exists programmable_private.get_optimistic_promotion_plan_v1(uuid) restrict;
drop function if exists programmable_private.promote_optimistic_block_canonical_v1(uuid,uuid,uuid,uuid,bytea,timestamptz) restrict;
drop function if exists programmable_private.get_optimistic_live_head_v1(bigint) restrict;
drop function if exists programmable_private.list_optimistic_canonical_events_v1(bigint,bigint,bigint,uuid,integer) restrict;
drop function if exists programmable_private.try_lock_market_projector_pool_v1(bigint,text,text,text,bytea) restrict;
drop function if exists programmable_private.list_market_projector_fast_lane_v1(bigint,text,text,integer) restrict;
drop function if exists programmable_private.assert_market_projector_fast_lane_v1(bigint,text,text,text,text,text,bytea,uuid,bigint,uuid,bigint,bigint,numeric,bytea,uuid,uuid,bigint,bigint,uuid,uuid,numeric,bytea) restrict;
drop index if exists programmable_private.envio_candidate_inbox_projector_keyset_idx restrict;
drop index if exists programmable_private.market_block_closes_fast_occurrence_idx restrict;
drop table if exists programmable_private.optimistic_chain_head_current_v1 restrict;
drop table if exists programmable_private.optimistic_block_current_canonical_v1 restrict;
drop table if exists programmable_private.optimistic_block_status_history_v1 restrict;
drop table if exists programmable_private.optimistic_event_rows_v1 restrict;
drop table if exists programmable_private.optimistic_block_observations_v1 restrict;
drop type if exists programmable_private.optimistic_block_status_v1 restrict;
drop function if exists programmable_wake_private.enqueue_quicknode_wake_v1(bytea,bigint,text,timestamptz,text,bytea) restrict;
drop function if exists programmable_wake_private.claim_quicknode_wake_v1(text,bytea) restrict;
drop function if exists programmable_wake_private.complete_quicknode_wake_v1(bigint,bigint,text,bytea) restrict;
drop function if exists programmable_wake_private.retry_quicknode_wake_v1(bigint,bigint,text,bytea,integer) restrict;
drop table if exists programmable_wake_private.quicknode_wake_jobs_v1 restrict;
drop schema if exists programmable_wake_private restrict;
`;

function partitionClosure(closure, label) {
  const app = [];
  const postgresOwned = [];
  for (const line of closure.sql.trimEnd().split("\n")) {
    if (line.includes("supabase_migrations")) postgresOwned.push(line);
    else if (
      line.includes("programmable_private") ||
      line.includes("programmable_release_probe_private") ||
      line.includes("programmable_wake_private") ||
      line.startsWith("ALTER DEFAULT PRIVILEGES FOR ROLE programmable_migrator")
    ) {
      app.push(line);
    } else {
      throw new Error(`${label} contains an unowned statement`);
    }
  }
  return Object.freeze({
    app: app.length === 0 ? "" : `${app.join("\n")}\n`,
    postgresOwned:
      postgresOwned.length === 0 ? "" : `${postgresOwned.join("\n")}\n`,
  });
}

async function assertRestoreRolePosture(sql) {
  const [identity] = await sql.unsafe(`
    select session_user::text as session_user,
           current_user::text as current_user,
           current_role::text as current_role,
           pg_catalog.pg_has_role(
             current_user, 'programmable_migrator', 'SET'
           ) as can_set_migrator
  `);
  const roles = await sql.unsafe(`
    select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
           rolcanlogin, rolreplication, rolbypassrls
      from pg_catalog.pg_roles
     where rolname in ('postgres', 'programmable_migrator')
     order by rolname
  `);
  const memberships = await sql.unsafe(`
    select member_role.rolname as member_role,
           granted_role.rolname as granted_role,
           membership.inherit_option,
           membership.set_option,
           membership.admin_option
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
     where member_role.rolname = 'postgres'
       and granted_role.rolname = 'programmable_migrator'
  `);
  const postgresRole = roles.find(({ rolname }) => rolname === "postgres");
  const migrator = roles.find(({ rolname }) => rolname === "programmable_migrator");
  if (
    !["postgres", "cli_login_postgres"].includes(identity?.session_user) ||
    identity?.current_user !== "postgres" ||
    identity?.current_role !== "postgres" ||
    identity?.can_set_migrator !== true ||
    roles.length !== 2 ||
    postgresRole?.rolsuper !== false ||
    migrator?.rolsuper !== false ||
    migrator?.rolinherit !== false ||
    migrator?.rolcreaterole !== false ||
    migrator?.rolcreatedb !== false ||
    migrator?.rolcanlogin !== false ||
    migrator?.rolreplication !== false ||
    migrator?.rolbypassrls !== false ||
    memberships.length !== 1 ||
    memberships[0]?.member_role !== "postgres" ||
    memberships[0]?.granted_role !== "programmable_migrator" ||
    memberships[0]?.inherit_option !== false ||
    memberships[0]?.set_option !== true ||
    memberships[0]?.admin_option !== false
  ) {
    throw new Error("Candidate restore role posture is not exact");
  }
}

async function assertRestoreSchemasAbsent(sql) {
  const rows = await sql.unsafe(
    `
      select nspname
        from pg_catalog.pg_namespace
       where nspname = any($1::text[])
       order by nspname
    `,
    [CANDIDATE_FINAL_SCHEMAS],
  );
  if (rows.length !== 0) {
    throw new Error("Candidate restore cleanup left a stage schema");
  }
}

export async function assertCandidateSchemaStage(sql, expectedSchemas) {
  const expected = Object.freeze([...expectedSchemas].sort());
  if (
    canonicalJson(expected) !==
      canonicalJson([...CANDIDATE_RESTORE_SCHEMAS].sort()) &&
    canonicalJson(expected) !==
      canonicalJson([...CANDIDATE_FINAL_SCHEMAS].sort())
  ) {
    throw new Error("Candidate schema stage is invalid");
  }
  const rows = await sql.unsafe(
    `
      select nspname
        from pg_catalog.pg_namespace
       where nspname = any($1::text[])
       order by nspname
    `,
    [CANDIDATE_FINAL_SCHEMAS],
  );
  if (
    canonicalJson(rows.map(({ nspname }) => nspname)) !==
      canonicalJson(expected)
  ) {
    throw new Error("Candidate schema inventory does not match its stage");
  }
}

export async function cleanupCandidateSchemas(sql, closure) {
  const statements = partitionClosure(closure, "Candidate cleanup closure");
  await assertRestoreRolePosture(sql);
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set local role programmable_migrator").simple();
    await transaction.unsafe(LATER_ONLY_RESTRICT_CLEANUP_SQL).simple();
    if (statements.app) await transaction.unsafe(statements.app).simple();
    await transaction.unsafe(`
      alter default privileges for role programmable_migrator
        grant execute on functions to public;
      alter default privileges for role programmable_migrator
        grant usage on types to public;
    `).simple();
    await transaction.unsafe("set local role postgres").simple();
    if (statements.postgresOwned) {
      await transaction.unsafe(statements.postgresOwned).simple();
    }
  });
  await assertRestoreSchemasAbsent(sql);
  await assertRestoreRolePosture(sql);
}

export async function applyOwnerAndSecurityClosure(sql, owners, security) {
  const ownerLines = owners.sql.trimEnd().split("\n");
  const objectOwners = ownerLines.filter((line) => !line.startsWith("ALTER SCHEMA "));
  const schemaOwners = ownerLines.filter((line) => line.startsWith("ALTER SCHEMA "));
  if (schemaOwners.length !== CANDIDATE_RESTORE_SCHEMAS.length) {
    throw new Error("Candidate schema owner closure is incomplete");
  }
  const acl = partitionClosure(security, "Candidate security closure");
  await assertRestoreRolePosture(sql);
  await sql.begin(async (transaction) => {
    await transaction.unsafe(`
      grant create on schema programmable_private,
        programmable_release_probe_private to programmable_migrator;
    `).simple();
    await transaction.unsafe(`${objectOwners.join("\n")}\n`).simple();
    await transaction.unsafe(`${schemaOwners.join("\n")}\n`).simple();
    await transaction.unsafe("set local role programmable_migrator").simple();
    if (acl.app) await transaction.unsafe(acl.app).simple();
    await transaction.unsafe("set local role postgres").simple();
    if (acl.postgresOwned) await transaction.unsafe(acl.postgresOwned).simple();
  });
  await assertRestoreRolePosture(sql);
}

export async function preparePinnedRestoreClosures({
  runner,
  executeSafeTool,
  pgRestoreBinary,
  archivePath,
  environment,
  secrets,
}) {
  const common = {
    runner,
    binary: pgRestoreBinary,
    environment,
    timeoutMs: 60_000,
    secrets,
    expectedBinary: OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_restore,
    expectedRuntimeSha256:
      OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256,
  };
  const cleanSchema = await executeSafeTool({
    ...common,
    args: [
      "--schema-only",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      `--restrict-key=${CANDIDATE_PG_RESTRICT_KEY}`,
      "--file=-",
      archivePath,
    ],
  });
  const ownerSchema = await executeSafeTool({
    ...common,
    args: [
      "--schema-only",
      "--no-privileges",
      `--restrict-key=${CANDIDATE_PG_RESTRICT_KEY}`,
      "--file=-",
      archivePath,
    ],
  });
  const cleanup = cleanClosure(cleanSchema.stdout);
  const owners = ownerClosure(ownerSchema.stdout);
  const security = await pinnedBaselineSecurityClosure();
  await verifyPinnedBaselineMigrationSourceClosure();
  if (
    sha256(cleanSchema.stdout) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.cleanSchemaSqlSha256 ||
    sha256(Buffer.from(cleanup.sql)) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.cleanClosureSha256 ||
    cleanup.statementCount !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.cleanClosureStatementCount ||
    sha256(ownerSchema.stdout) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.ownerSchemaSqlSha256 ||
    sha256(Buffer.from(owners.sql)) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.ownerClosureSha256 ||
    owners.statementCount !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.ownerClosureStatementCount ||
    security.statementCount !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureStatementCount
  ) {
    throw new Error("pinned Candidate restore closure changed");
  }
  return Object.freeze({ cleanup, owners, security });
}

export async function prepareSafetyRestoreClosures({
  runner,
  executeSafeTool,
  pgRestoreBinary,
  archivePath,
  restrictKey,
  environment,
  secrets,
}) {
  if (!/^[0-9a-f]{64}$/u.test(restrictKey ?? "")) {
    throw new Error("Candidate safety closure restrict key is invalid");
  }
  const common = {
    runner,
    binary: pgRestoreBinary,
    environment,
    timeoutMs: 60_000,
    secrets,
    expectedBinary: OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_restore,
    expectedRuntimeSha256:
      OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256,
  };
  const cleanSchema = await executeSafeTool({
    ...common,
    args: [
      "--schema-only",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      `--restrict-key=${restrictKey}`,
      "--file=-",
      archivePath,
    ],
  });
  const securitySchema = await executeSafeTool({
    ...common,
    args: [
      "--schema-only",
      `--restrict-key=${restrictKey}`,
      "--file=-",
      archivePath,
    ],
  });
  return Object.freeze({
    cleanup: cleanClosure(cleanSchema.stdout),
    owners: ownerClosure(securitySchema.stdout),
    security: securityClosure(securitySchema.stdout),
  });
}

function validateArtifact(reference, actual, label) {
  if (
    actual.bytes !== reference.bytes ||
    actual.sha256 !== reference.sha256
  ) {
    throw new Error(`${label} bytes or checksum changed`);
  }
}

function planPayload(value) {
  return {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    operatorCommit: value.operatorCommit,
    target: value.target,
    operatorIdentity: value.operatorIdentity,
    currentProductCommit: value.currentProductCommit,
    caSha256: value.caSha256,
    snapshot: value.snapshot,
    safetyBackup: value.safetyBackup,
    postgresToolchain: value.postgresToolchain,
    restore: value.restore,
    postRestore: value.postRestore,
  };
}

export async function createCandidateRestorePlan(input) {
  if (
    !COMMIT.test(input.repositoryCommit ?? "") ||
    !COMMIT.test(input.currentProductCommit ?? "") ||
    input.snapshotRepositoryCommit !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.repositoryCommit
  ) {
    throw new Error("Candidate restore operator commit is invalid");
  }
  const target = validateCandidateTarget(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const operatorIdentity = candidateOperatorIdentity(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const caPem = validateCaPem(input.sslCaPem);
  const caSha256 = sha256(Buffer.from(caPem));
  const snapshotEvidence = validatePinnedSnapshotEvidence(input.snapshotEvidence);
  const safetyEvidence = validateCandidateSafetyBackupEvidence(
    input.safetyEvidence,
    {
      operatorCommit: input.repositoryCommit,
      currentProductCommit: input.currentProductCommit,
      now: input.now,
    },
  );
  if (safetyEvidence.caSha256 !== caSha256) {
    throw new Error("Candidate restore CA differs from the safety backup");
  }
  if (
    canonicalJson(safetyEvidence.operatorIdentity) !==
    canonicalJson(operatorIdentity)
  ) {
    throw new Error("Candidate restore operator identity differs from safety");
  }
  const rawSafetyEvidence = validateBackupEvidence(input.safetyBackupEvidence, {
    repositoryCommit: input.repositoryCommit,
  });
  const snapshot = backupReference(snapshotEvidence);
  const safety = backupReference(rawSafetyEvidence);
  if (
    safety.evidenceSha256 !== safetyEvidence.backup.evidenceSha256 ||
    canonicalJson(safety) !== canonicalJson(safetyEvidence.backup)
  ) {
    throw new Error("raw Candidate safety backup evidence does not match");
  }
  const dependencies = validateDependencies(input.dependencies, [
    "runCommand",
    "validateOfficialToolchain",
    "fileCommitment",
    "safeToolCall",
    "schemaSqlSha256",
    "prepareRestoreClosures",
  ]);
  const runner = dependencies.runCommand ?? defaultRunCommand;
  const executeSafeTool = dependencies.safeToolCall ?? safeToolCall;
  const schemaSqlCommitment = dependencies.schemaSqlSha256 ?? sha256;
  const inspectToolchain =
    dependencies.validateOfficialToolchain ?? validateOfficialToolchain;
  const toolchain = await inspectToolchain({
    pgDumpBinary: input.pgDumpBinary,
    pgRestoreBinary: input.pgRestoreBinary,
    psqlBinary: input.psqlBinary,
    runner,
    secrets: input.secrets ?? [],
  });
  if (
    canonicalJson(toolchain.evidence) !==
      canonicalJson(safetyEvidence.postgresToolchain) ||
    canonicalJson(toolchain.evidence) !==
      canonicalJson(OFFICIAL_TOOLCHAIN_EVIDENCE)
  ) {
    throw new Error("Candidate restore toolchain differs from safety backup");
  }
  const commitFile = dependencies.fileCommitment ?? fileCommitment;
  const [snapshotFile, safetyFile] = await Promise.all([
    privateRegularFile(input.snapshotBackupPath, "snapshot backup"),
    privateRegularFile(input.safetyBackupPath, "safety backup"),
  ]);
  const [snapshotActual, safetyActual] = await Promise.all([
    commitFile(snapshotFile.path),
    commitFile(safetyFile.path),
  ]);
  validateArtifact(snapshot, snapshotActual, "snapshot backup");
  validateArtifact(safety, safetyActual, "safety backup");
  const processEnvironment = Object.freeze({
    LANG: "C",
    LC_ALL: "C",
  });
  const snapshotList = await executeSafeTool({
    runner,
    binary: toolchain.paths.pg_restore,
    args: [
      "--list",
      `--restrict-key=${CANDIDATE_PG_RESTRICT_KEY}`,
      snapshotFile.path,
    ],
    environment: processEnvironment,
    timeoutMs: 60_000,
    secrets: input.secrets ?? [],
    expectedBinary: OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_restore,
    expectedRuntimeSha256:
      OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256,
  });
  validateArtifact(
    snapshot,
    await commitFile(snapshotFile.path),
    "snapshot backup",
  );
  const safetyList = await executeSafeTool({
    runner,
    binary: toolchain.paths.pg_restore,
    args: [
      "--list",
      `--restrict-key=${CANDIDATE_PG_RESTRICT_KEY}`,
      safetyFile.path,
    ],
    environment: processEnvironment,
    timeoutMs: 60_000,
    secrets: input.secrets ?? [],
    expectedBinary: OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_restore,
    expectedRuntimeSha256:
      OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256,
  });
  validateArtifact(
    safety,
    await commitFile(safetyFile.path),
    "safety backup",
  );
  if (
    sha256(snapshotList.stdout) !== snapshot.archiveListSha256 ||
    sha256(safetyList.stdout) !== safety.archiveListSha256
  ) {
    throw new Error("Candidate backup archive listing changed");
  }
  archiveSchemas(snapshotList.stdout);
  archiveSchemas(safetyList.stdout);
  validateArtifact(
    snapshot,
    await commitFile(snapshotFile.path),
    "snapshot backup",
  );
  const snapshotSchema = await executeSafeTool({
    runner,
    binary: toolchain.paths.pg_restore,
    args: [
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      `--restrict-key=${CANDIDATE_PG_RESTRICT_KEY}`,
      "--file=-",
      snapshotFile.path,
    ],
    environment: processEnvironment,
    timeoutMs: 60_000,
    secrets: input.secrets ?? [],
    expectedBinary: OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_restore,
    expectedRuntimeSha256:
      OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256,
  });
  validateArtifact(
    snapshot,
    await commitFile(snapshotFile.path),
    "snapshot backup",
  );
  if (
    schemaSqlCommitment(snapshotSchema.stdout) !==
    PINNED_PRE_ATTESTATION_SNAPSHOT.schemaSqlSha256
  ) {
    throw new Error("Candidate snapshot schema SQL changed");
  }
  const prepareClosures =
    dependencies.prepareRestoreClosures ?? preparePinnedRestoreClosures;
  const { cleanup, owners, security } = await prepareClosures({
    runner,
    executeSafeTool,
    pgRestoreBinary: toolchain.paths.pg_restore,
    archivePath: snapshotFile.path,
    environment: processEnvironment,
    secrets: input.secrets ?? [],
  });
  validateArtifact(
    snapshot,
    await commitFile(snapshotFile.path),
    "snapshot backup",
  );
  const migrationSourceClosure =
    await verifyPinnedBaselineMigrationSourceClosure();
  if (
    dependencies.prepareRestoreClosures === undefined &&
    (sha256(Buffer.from(cleanup.sql)) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.cleanClosureSha256 ||
    cleanup.statementCount !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.cleanClosureStatementCount ||
    sha256(Buffer.from(owners.sql)) !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.ownerClosureSha256 ||
    owners.statementCount !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.ownerClosureStatementCount ||
    security.statementCount !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureStatementCount)
  ) {
    throw new Error("Candidate snapshot closure changed");
  }
  const payload = Object.freeze({
    kind: "programmable-candidate-in-place-restore-plan",
    schemaVersion: 1,
    operatorCommit: input.repositoryCommit,
    target,
    operatorIdentity,
    currentProductCommit: input.currentProductCommit,
    caSha256,
    snapshot: Object.freeze({
      ...snapshot,
      schemas: CANDIDATE_RESTORE_SCHEMAS,
      schemaSqlSha256: PINNED_PRE_ATTESTATION_SNAPSHOT.schemaSqlSha256,
      cleanSchemaSqlSha256:
        PINNED_PRE_ATTESTATION_SNAPSHOT.cleanSchemaSqlSha256,
      cleanClosureSha256:
        PINNED_PRE_ATTESTATION_SNAPSHOT.cleanClosureSha256,
      cleanClosureStatementCount:
        PINNED_PRE_ATTESTATION_SNAPSHOT.cleanClosureStatementCount,
      ownerSchemaSqlSha256:
        PINNED_PRE_ATTESTATION_SNAPSHOT.ownerSchemaSqlSha256,
      ownerClosureSha256:
        PINNED_PRE_ATTESTATION_SNAPSHOT.ownerClosureSha256,
      ownerClosureStatementCount:
        PINNED_PRE_ATTESTATION_SNAPSHOT.ownerClosureStatementCount,
      securityClosureSha256:
        PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureSha256,
      securityClosureStatementCount: security.statementCount,
      migrationSourceClosure,
      structuralManifestSha256:
        PINNED_PRE_ATTESTATION_SNAPSHOT.structuralManifestSha256,
    }),
    safetyBackup: Object.freeze({
      ...safety,
      safetyEvidenceSha256: safetyEvidence.evidenceSha256,
    }),
    postgresToolchain: toolchain.evidence,
    restore: Object.freeze({
      schemas: CANDIDATE_RESTORE_SCHEMAS,
      flags: CANDIDATE_RESTORE_FLAGS,
      runtimeLoginsRemainFenced: true,
    }),
    postRestore: Object.freeze({
      manifestSha256: snapshot.manifestSha256,
      structuralManifestSha256:
        PINNED_PRE_ATTESTATION_SNAPSHOT.structuralManifestSha256,
      tableCount: snapshot.tableCount,
      rowCount: snapshot.rowCount,
      databaseMode: "candidate-only",
      promoted: false,
      productCommit: null,
      stagedDeploymentId: null,
      publicationCount: 0,
    }),
  });
  const planSha256 = sha256(canonicalJson(planPayload(payload)));
  return Object.freeze({
    ...payload,
    planSha256,
    confirmRestore: sha256(
      `programmable:candidate-in-place-restore-confirmation:v1\0${planSha256}`,
    ),
  });
}

export function validateCandidateRestorePlan(value) {
  const plan = plainObject(value, "Candidate restore plan");
  if (
    plan.kind !== "programmable-candidate-in-place-restore-plan" ||
    plan.schemaVersion !== 1 ||
    !COMMIT.test(plan.operatorCommit ?? "") ||
    !COMMIT.test(plan.currentProductCommit ?? "") ||
    !SHA256.test(plan.planSha256 ?? "") ||
    !SHA256.test(plan.confirmRestore ?? "") ||
    sha256(canonicalJson(planPayload(plan))) !== plan.planSha256 ||
    sha256(
      `programmable:candidate-in-place-restore-confirmation:v1\0${plan.planSha256}`,
    ) !== plan.confirmRestore ||
    canonicalJson(plan.restore?.schemas) !== canonicalJson(CANDIDATE_RESTORE_SCHEMAS) ||
    canonicalJson(plan.restore?.flags) !== canonicalJson(CANDIDATE_RESTORE_FLAGS) ||
    plan.restore?.runtimeLoginsRemainFenced !== true ||
    plan.snapshot?.repositoryCommit !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.repositoryCommit ||
    plan.snapshot?.evidenceSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.evidenceSha256 ||
    plan.snapshot?.sha256 !== PINNED_PRE_ATTESTATION_SNAPSHOT.sha256 ||
    plan.snapshot?.archiveListSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.archiveListSha256 ||
    plan.snapshot?.manifestSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.manifestSha256 ||
    plan.snapshot?.schemaSqlSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.schemaSqlSha256 ||
    plan.snapshot?.cleanSchemaSqlSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.cleanSchemaSqlSha256 ||
    plan.snapshot?.cleanClosureSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.cleanClosureSha256 ||
    plan.snapshot?.cleanClosureStatementCount !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.cleanClosureStatementCount ||
    plan.snapshot?.ownerSchemaSqlSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.ownerSchemaSqlSha256 ||
    plan.snapshot?.ownerClosureSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.ownerClosureSha256 ||
    plan.snapshot?.ownerClosureStatementCount !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.ownerClosureStatementCount ||
    plan.snapshot?.securityClosureSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureSha256 ||
    plan.snapshot?.securityClosureStatementCount !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureStatementCount ||
    canonicalJson(plan.snapshot?.migrationSourceClosure) !==
      canonicalJson(PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE) ||
    plan.snapshot?.structuralManifestSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.structuralManifestSha256 ||
    plan.snapshot?.bytes !== PINNED_PRE_ATTESTATION_SNAPSHOT.bytes ||
    canonicalJson(plan.snapshot?.schemas) !== canonicalJson(CANDIDATE_RESTORE_SCHEMAS) ||
    !SHA256.test(plan.safetyBackup?.safetyEvidenceSha256 ?? "") ||
    !SHA256.test(plan.safetyBackup?.sha256 ?? "") ||
    !SHA256.test(plan.safetyBackup?.archiveListSha256 ?? "") ||
    !SHA256.test(plan.safetyBackup?.manifestSha256 ?? "") ||
    !SHA256.test(plan.safetyBackup?.structuralManifestSha256 ?? "") ||
    !Number.isSafeInteger(plan.safetyBackup?.bytes) ||
    plan.safetyBackup.bytes <= 0 ||
    canonicalJson(plan.postgresToolchain) !==
      canonicalJson(OFFICIAL_TOOLCHAIN_EVIDENCE) ||
    plan.postRestore?.manifestSha256 !== plan.snapshot.manifestSha256 ||
    plan.postRestore?.structuralManifestSha256 !==
      plan.snapshot.structuralManifestSha256 ||
    plan.postRestore?.tableCount !== plan.snapshot.tableCount ||
    plan.postRestore?.rowCount !== plan.snapshot.rowCount ||
    plan.postRestore?.databaseMode !== "candidate-only" ||
    plan.postRestore?.promoted !== false ||
    plan.postRestore?.productCommit !== null ||
    plan.postRestore?.stagedDeploymentId !== null ||
    plan.postRestore?.publicationCount !== 0
  ) {
    throw new Error("Candidate restore plan is invalid");
  }
  exactCandidateTarget(plan.target);
  const expectedIdentity = plainObject(
    plan.operatorIdentity,
    "Candidate restore plan operator identity",
  );
  if (
    !["database-owner", "supabase-cli-jit-set-role"].includes(
      expectedIdentity.mode,
    ) ||
    expectedIdentity.sessionUser !==
      (expectedIdentity.mode === "database-owner"
        ? "postgres"
        : "cli_login_postgres") ||
    expectedIdentity.effectiveRole !== "postgres"
  ) {
    throw new Error("Candidate restore plan is invalid");
  }
  return plan;
}

async function createTemporaryCa(caPem) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "programmable-candidate-restore-ca-"),
  );
  await chmod(directory, 0o700);
  const filePath = path.join(directory, "server-ca.crt");
  const descriptor = await open(
    filePath,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      (fsConstants.O_NOFOLLOW ?? 0),
    PRIVATE_MODE,
  );
  try {
    await descriptor.writeFile(caPem, "utf8");
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
  return { directory, filePath };
}

function childEnvironment({ password, caPath }) {
  return Object.freeze({
    LANG: "C",
    LC_ALL: "C",
    PGAPPNAME: "programmable-candidate-in-place-restore",
    PGCONNECT_TIMEOUT: "8",
    PGPASSWORD: password,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: caPath,
  });
}

function databasePassword(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const password = decodeURIComponent(parsed.password);
  if (password.length < 1 || /[\u0000-\u001f\u007f]/u.test(password)) {
    throw new Error("Candidate restore database credential is invalid");
  }
  return password;
}

function targetArguments(target, operatorIdentity) {
  const arguments_ = [
    "--host",
    target.host,
    "--port",
    String(target.port),
    "--username",
    operatorIdentity.sessionUser,
    "--dbname",
    target.database,
    "--no-password",
  ];
  if (operatorIdentity.mode === "supabase-cli-jit-set-role") {
    arguments_.push("--role", "postgres");
  }
  return arguments_;
}

async function migrationCount(sql) {
  const [row] = await sql.unsafe(`
    select pg_catalog.count(*)::integer as migration_count
      from supabase_migrations.schema_migrations
  `);
  const count = Number(row?.migration_count);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("restored migration history is unavailable");
  }
  return count;
}

function assertPostRestore({ plan, manifest, state }) {
  const fence = assertCandidateFence(state, "fenced");
  if (
    manifest?.manifestSha256 !== plan.postRestore.manifestSha256 ||
    manifest?.structuralManifestSha256 !==
      plan.postRestore.structuralManifestSha256 ||
    manifest?.tableCount !== plan.postRestore.tableCount ||
    manifest?.rowCount !== plan.postRestore.rowCount ||
    fence.databaseMode !== plan.postRestore.databaseMode ||
    fence.promoted !== false ||
    fence.productCommit !== null ||
    fence.stagedDeploymentId !== null ||
    fence.publicationCount !== 0
  ) {
    throw new Error("Candidate post-restore verification did not match the plan");
  }
  return fence;
}

export async function applyCandidateRestore(input) {
  const plan = validateCandidateRestorePlan(input.plan);
  if (input.confirmRestore !== plan.confirmRestore) {
    throw new Error("Candidate restore confirmation does not match the reviewed plan");
  }
  const target = validateCandidateTarget(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const operatorIdentity = candidateOperatorIdentity(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  if (canonicalJson(target) !== canonicalJson(plan.target)) {
    throw new Error("Candidate restore target differs from the reviewed plan");
  }
  if (canonicalJson(operatorIdentity) !== canonicalJson(plan.operatorIdentity)) {
    throw new Error("Candidate restore operator identity differs from the plan");
  }
  const caPem = validateCaPem(input.sslCaPem);
  if (sha256(Buffer.from(caPem)) !== plan.caSha256) {
    throw new Error("Candidate restore CA differs from the reviewed plan");
  }
  const password = databasePassword(input.databaseUrl);
  const safetyEvidence = validateCandidateSafetyBackupEvidence(
    input.safetyEvidence,
    {
      operatorCommit: plan.operatorCommit,
      currentProductCommit: plan.currentProductCommit,
      now: input.now,
    },
  );
  if (
    safetyEvidence.evidenceSha256 !==
    plan.safetyBackup.safetyEvidenceSha256
  ) {
    throw new Error("Candidate safety backup differs from the reviewed plan");
  }
  const rawSafetyEvidence = validateBackupEvidence(input.safetyBackupEvidence, {
    repositoryCommit: plan.operatorCommit,
  });
  if (
    sha256(canonicalJson(rawSafetyEvidence)) !==
      plan.safetyBackup.evidenceSha256
  ) {
    throw new Error("raw Candidate safety evidence differs from the plan");
  }
  const dependencies = validateDependencies(input.dependencies, [
    "runCommand",
    "validateOfficialToolchain",
    "fileCommitment",
    "safeToolCall",
    "revalidateToolchain",
    "openHostedDatabase",
    "closeHostedDatabase",
    "acquireRestoreLock",
    "assertOperatorSession",
    "inspectCandidateDatabase",
    "inspectProjectorLeaseDrain",
    "fenceRuntimeLogins",
    "assertRuntimeLoginsFenced",
    "captureDatabaseManifest",
    "migrationCount",
    "prepareRestoreClosures",
    "cleanupCandidateSchemas",
    "applyOwnerAndSecurityClosure",
    "assertCandidateSchemaStage",
  ]);
  const runner = dependencies.runCommand ?? defaultRunCommand;
  const executeSafeTool = dependencies.safeToolCall ?? safeToolCall;
  const recheckToolchain =
    dependencies.revalidateToolchain ?? revalidateToolchain;
  const inspectToolchain =
    dependencies.validateOfficialToolchain ?? validateOfficialToolchain;
  const commitFile = dependencies.fileCommitment ?? fileCommitment;
  const openDatabase = dependencies.openHostedDatabase ?? openCandidateDatabase;
  const closeDatabase = dependencies.closeHostedDatabase ?? closeHostedDatabase;
  const acquire = dependencies.acquireRestoreLock ?? acquireRestoreLock;
  const assertOperatorSession =
    dependencies.assertOperatorSession ?? assertCandidateOperatorSession;
  const inspectState =
    dependencies.inspectCandidateDatabase ?? inspectCandidateDatabase;
  const inspectLeases =
    dependencies.inspectProjectorLeaseDrain ?? inspectProjectorLeaseDrain;
  const fenceLogins = dependencies.fenceRuntimeLogins ?? fenceRuntimeLogins;
  const inspectLoginFence =
    dependencies.assertRuntimeLoginsFenced ?? assertRuntimeLoginsFenced;
  const captureManifest =
    dependencies.captureDatabaseManifest ?? captureDatabaseManifest;
  const readMigrationCount = dependencies.migrationCount ?? migrationCount;
  const prepareClosures =
    dependencies.prepareRestoreClosures ?? preparePinnedRestoreClosures;
  const performCleanup =
    dependencies.cleanupCandidateSchemas ?? cleanupCandidateSchemas;
  const applyClosures =
    dependencies.applyOwnerAndSecurityClosure ?? applyOwnerAndSecurityClosure;
  const assertSchemaStage =
    dependencies.assertCandidateSchemaStage ?? assertCandidateSchemaStage;
  let connection;
  let ca;
  let toolchain;
  let snapshotCopy;
  let closures;
  let restoreStarted = false;
  try {
    const inspectedToolchain = await inspectToolchain({
      pgDumpBinary: input.pgDumpBinary,
      pgRestoreBinary: input.pgRestoreBinary,
      psqlBinary: input.psqlBinary,
      runner,
      secrets: [password, input.databaseUrl, caPem],
    });
    toolchain = dependencies.validateOfficialToolchain
      ? inspectedToolchain
      : await materializeOfficialToolchain(inspectedToolchain);
    if (
      toolchain.evidence.toolchainSha256 !==
      plan.postgresToolchain.toolchainSha256
    ) {
      throw new Error("Postgres toolchain changed after plan review");
    }
    const snapshotFile = await privateRegularFile(
      input.snapshotBackupPath,
      "snapshot backup",
    );
    const safetyFile = await privateRegularFile(
      input.safetyBackupPath,
      "safety backup",
    );
    validateArtifact(plan.snapshot, await commitFile(snapshotFile.path), "snapshot backup");
    validateArtifact(plan.safetyBackup, await commitFile(safetyFile.path), "safety backup");
    snapshotCopy = dependencies.fileCommitment
      ? Object.freeze({ path: snapshotFile.path })
      : await createPrivateArtifactSnapshot(
          snapshotFile.path,
          plan.snapshot,
          "snapshot backup",
        );
    closures = await prepareClosures({
      runner,
      executeSafeTool,
      pgRestoreBinary: toolchain.paths.pg_restore,
      archivePath: snapshotCopy.path,
      environment: Object.freeze({ LANG: "C", LC_ALL: "C" }),
      secrets: [password, input.databaseUrl, caPem],
    });
    connection = await openDatabase({
      databaseUrl: input.databaseUrl,
      expectedProjectRef: input.expectedProjectRef,
      sslCaPem: caPem,
    });
    if (
      canonicalJson(connection.target) !== canonicalJson(target) ||
      (connection.operatorIdentity !== undefined &&
        canonicalJson(connection.operatorIdentity) !==
          canonicalJson(operatorIdentity))
    ) {
      throw new Error("Candidate database target changed before restore");
    }
    const operatorSession = await acquire(connection.sql);
    const beforeState = await inspectState(connection.sql);
    drainedLeases(await inspectLeases(connection.sql));
    await fenceLogins(connection.sql);
    await inspectLoginFence(connection.sql);
    const currentManifest = await captureManifest(connection.sql);
    let executionMode;
    let originalStateMatches = false;
    try {
      originalStateMatches =
        canonicalJson(
          promotedCandidateState(beforeState, plan.currentProductCommit),
        ) === canonicalJson(safetyEvidence.currentCandidateState);
    } catch {
      originalStateMatches = false;
    }
    const originalManifestMatches =
      currentManifest.manifestSha256 === plan.safetyBackup.manifestSha256 &&
      currentManifest.structuralManifestSha256 ===
        plan.safetyBackup.structuralManifestSha256 &&
      currentManifest.tableCount === plan.safetyBackup.tableCount &&
      currentManifest.rowCount === plan.safetyBackup.rowCount;
    let restoredStateMatches = false;
    try {
      await assertSchemaStage(connection.sql, CANDIDATE_RESTORE_SCHEMAS);
      assertPostRestore({ plan, manifest: currentManifest, state: beforeState });
      restoredStateMatches = true;
    } catch {
      restoredStateMatches = false;
    }
    if (originalStateMatches && originalManifestMatches) {
      executionMode = "restored-from-pinned-snapshot";
      ca = await createTemporaryCa(caPem);
      const environment = childEnvironment({ password, caPath: ca.filePath });
      const args = [
        ...CANDIDATE_RESTORE_FLAGS,
        ...targetArguments(target, operatorIdentity),
        snapshotCopy.path,
      ];
      validateArtifact(
        plan.snapshot,
        await commitFile(snapshotFile.path),
        "snapshot backup",
      );
      await recheckToolchain(toolchain);
      await assertOperatorSession(connection.sql, operatorSession);
      restoreStarted = true;
      await performCleanup(connection.sql, closures.cleanup);
      await assertOperatorSession(connection.sql, operatorSession);
      await executeSafeTool({
        runner,
        binary: toolchain.paths.pg_restore,
        args,
        environment,
        timeoutMs: 30 * 60_000,
        secrets: [password, input.databaseUrl, caPem],
        expectedBinary: OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_restore,
        expectedRuntimeSha256:
          OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256,
      });
      await assertOperatorSession(connection.sql, operatorSession);
      await applyClosures(
        connection.sql,
        closures.owners,
        closures.security,
      );
      await assertOperatorSession(connection.sql, operatorSession);
    } else if (restoredStateMatches) {
      executionMode = "resumed-post-restore-verification";
      restoreStarted = true;
    } else {
      throw new Error("Candidate is neither the safety state nor the restored state");
    }
    await inspectLoginFence(connection.sql);
    await assertSchemaStage(connection.sql, CANDIDATE_RESTORE_SCHEMAS);
    const [manifest, state, restoredMigrationCount] = await Promise.all([
      captureManifest(connection.sql),
      inspectState(connection.sql),
      readMigrationCount(connection.sql),
    ]);
    const fence = assertPostRestore({ plan, manifest, state });
    const stableManifest = await captureManifest(connection.sql);
    if (canonicalJson(stableManifest) !== canonicalJson(manifest)) {
      throw new Error("Candidate post-restore manifest is not stable");
    }
    const completedAt = input.now instanceof Date
      ? input.now
      : new Date(input.now ?? Date.now());
    if (!Number.isFinite(completedAt.valueOf())) {
      throw new Error("Candidate restore completion timestamp is invalid");
    }
    const payload = Object.freeze({
      kind: "programmable-candidate-in-place-restore-result",
      schemaVersion: 1,
      operatorCommit: plan.operatorCommit,
      target,
      operatorIdentity,
      planSha256: plan.planSha256,
      confirmationSha256: plan.confirmRestore,
      executionMode,
      snapshot: Object.freeze({
        sha256: plan.snapshot.sha256,
        bytes: plan.snapshot.bytes,
        archiveListSha256: plan.snapshot.archiveListSha256,
        schemaSqlSha256: plan.snapshot.schemaSqlSha256,
        manifestSha256: manifest.manifestSha256,
        tableCount: manifest.tableCount,
        rowCount: manifest.rowCount,
        structuralManifestSha256: manifest.structuralManifestSha256,
      }),
      migrationCount: restoredMigrationCount,
      candidateFence: fence,
      runtimeLoginFence: Object.freeze({
        fenced: true,
        loginRoles: RUNTIME_LOGIN_ROLES,
        remainsFenced: true,
      }),
      restoreFlags: CANDIDATE_RESTORE_FLAGS,
      restoredAt: completedAt.toISOString(),
    });
    assertNoSecretOutput(payload, [password, input.databaseUrl, caPem]);
    return Object.freeze({
      ...payload,
      evidenceSha256: sha256(canonicalJson(payload)),
    });
  } catch {
    throw new Error(
      restoreStarted
        ? "Candidate in-place restore failed after start; runtime logins remain fenced"
        : "Candidate in-place restore failed before start; runtime logins remain fenced",
    );
  } finally {
    if (ca?.directory) {
      await rm(ca.directory, { recursive: true, force: true }).catch(() => {});
    }
    if (snapshotCopy?.directory) {
      await rm(snapshotCopy.directory, { recursive: true, force: true }).catch(
        () => {},
      );
    }
    if (toolchain?.cleanupDirectory) {
      await rm(toolchain.cleanupDirectory, { recursive: true, force: true }).catch(
        () => {},
      );
    }
    if (connection?.sql) await closeDatabase(connection.sql).catch(() => {});
  }
}

function recoveryPlanPayload(value) {
  return {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    operatorCommit: value.operatorCommit,
    target: value.target,
    operatorIdentity: value.operatorIdentity,
    currentProductCommit: value.currentProductCommit,
    caSha256: value.caSha256,
    safetyBackup: value.safetyBackup,
    postgresToolchain: value.postgresToolchain,
    restore: value.restore,
    postRestore: value.postRestore,
  };
}

export async function createCandidateSafetyRecoveryPlan(input) {
  if (
    !COMMIT.test(input.repositoryCommit ?? "") ||
    !COMMIT.test(input.currentProductCommit ?? "")
  ) {
    throw new Error("Candidate safety recovery commit is invalid");
  }
  const target = validateCandidateTarget(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const operatorIdentity = candidateOperatorIdentity(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const caPem = validateCaPem(input.sslCaPem);
  const caSha256 = sha256(Buffer.from(caPem));
  const safetyEvidence = validateCandidateSafetyBackupEvidence(
    input.safetyEvidence,
    {
      operatorCommit: input.repositoryCommit,
      currentProductCommit: input.currentProductCommit,
      enforceFreshness: false,
    },
  );
  if (safetyEvidence.caSha256 !== caSha256) {
    throw new Error("Candidate recovery CA differs from the safety backup");
  }
  if (
    canonicalJson(safetyEvidence.operatorIdentity) !==
    canonicalJson(operatorIdentity)
  ) {
    throw new Error("Candidate recovery operator identity differs from safety");
  }
  const rawEvidence = validateBackupEvidence(input.safetyBackupEvidence, {
    repositoryCommit: input.repositoryCommit,
  });
  const safety = backupReference(rawEvidence);
  if (canonicalJson(safety) !== canonicalJson(safetyEvidence.backup)) {
    throw new Error("raw Candidate safety backup evidence does not match");
  }
  const dependencies = validateDependencies(input.dependencies, [
    "runCommand",
    "validateOfficialToolchain",
    "fileCommitment",
    "safeToolCall",
    "prepareSafetyRestoreClosures",
  ]);
  const runner = dependencies.runCommand ?? defaultRunCommand;
  const inspectToolchain =
    dependencies.validateOfficialToolchain ?? validateOfficialToolchain;
  const toolchain = await inspectToolchain({
    pgDumpBinary: input.pgDumpBinary,
    pgRestoreBinary: input.pgRestoreBinary,
    psqlBinary: input.psqlBinary,
    runner,
    secrets: input.secrets ?? [],
  });
  if (
    canonicalJson(toolchain.evidence) !==
      canonicalJson(OFFICIAL_TOOLCHAIN_EVIDENCE) ||
    canonicalJson(toolchain.evidence) !==
      canonicalJson(safetyEvidence.postgresToolchain)
  ) {
    throw new Error("Candidate recovery toolchain is not pinned");
  }
  const commitFile = dependencies.fileCommitment ?? fileCommitment;
  const executeSafeTool = dependencies.safeToolCall ?? safeToolCall;
  const safetyFile = await privateRegularFile(
    input.safetyBackupPath,
    "safety backup",
  );
  validateArtifact(
    safety,
    await commitFile(safetyFile.path),
    "safety backup",
  );
  const list = await executeSafeTool({
    runner,
    binary: toolchain.paths.pg_restore,
    args: [
      "--list",
      `--restrict-key=${CANDIDATE_PG_RESTRICT_KEY}`,
      safetyFile.path,
    ],
    environment: Object.freeze({ LANG: "C", LC_ALL: "C" }),
    timeoutMs: 60_000,
    secrets: input.secrets ?? [],
    expectedBinary: OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_restore,
    expectedRuntimeSha256:
      OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256,
  });
  validateArtifact(
    safety,
    await commitFile(safetyFile.path),
    "safety backup",
  );
  if (sha256(list.stdout) !== safety.archiveListSha256) {
    throw new Error("Candidate safety archive listing changed");
  }
  archiveSchemas(list.stdout);
  const prepareClosures =
    dependencies.prepareSafetyRestoreClosures ?? prepareSafetyRestoreClosures;
  const closures = await prepareClosures({
    runner,
    executeSafeTool,
    pgRestoreBinary: toolchain.paths.pg_restore,
    archivePath: safetyFile.path,
    restrictKey: safety.sha256.slice(2),
    environment: Object.freeze({ LANG: "C", LC_ALL: "C" }),
    secrets: input.secrets ?? [],
  });
  validateArtifact(
    safety,
    await commitFile(safetyFile.path),
    "safety backup",
  );
  const payload = Object.freeze({
    kind: "programmable-candidate-safety-recovery-plan",
    schemaVersion: 1,
    operatorCommit: input.repositoryCommit,
    target,
    operatorIdentity,
    currentProductCommit: input.currentProductCommit,
    caSha256,
    safetyBackup: Object.freeze({
      ...safety,
      safetyEvidenceSha256: safetyEvidence.evidenceSha256,
      cleanClosureSha256: sha256(Buffer.from(closures.cleanup.sql)),
      cleanClosureStatementCount: closures.cleanup.statementCount,
      ownerClosureSha256: sha256(Buffer.from(closures.owners.sql)),
      ownerClosureStatementCount: closures.owners.statementCount,
      securityClosureSha256: sha256(Buffer.from(closures.security.sql)),
      securityClosureStatementCount: closures.security.statementCount,
    }),
    postgresToolchain: toolchain.evidence,
    restore: Object.freeze({
      schemas: CANDIDATE_RESTORE_SCHEMAS,
      flags: CANDIDATE_SAFETY_RECOVERY_FLAGS,
      runtimeLoginsRemainFenced: true,
    }),
    postRestore: Object.freeze({
      candidateState: safetyEvidence.currentCandidateState,
      manifestSha256: safety.manifestSha256,
      structuralManifestSha256: safety.structuralManifestSha256,
      tableCount: safety.tableCount,
      rowCount: safety.rowCount,
    }),
  });
  const planSha256 = sha256(canonicalJson(recoveryPlanPayload(payload)));
  return Object.freeze({
    ...payload,
    planSha256,
    confirmRecovery: sha256(
      `programmable:candidate-safety-recovery-confirmation:v1\0${planSha256}`,
    ),
  });
}

export function validateCandidateSafetyRecoveryPlan(value) {
  const plan = plainObject(value, "Candidate safety recovery plan");
  if (
    plan.kind !== "programmable-candidate-safety-recovery-plan" ||
    plan.schemaVersion !== 1 ||
    !COMMIT.test(plan.operatorCommit ?? "") ||
    !COMMIT.test(plan.currentProductCommit ?? "") ||
    !SHA256.test(plan.planSha256 ?? "") ||
    !SHA256.test(plan.confirmRecovery ?? "") ||
    sha256(canonicalJson(recoveryPlanPayload(plan))) !== plan.planSha256 ||
    sha256(
      `programmable:candidate-safety-recovery-confirmation:v1\0${plan.planSha256}`,
    ) !== plan.confirmRecovery ||
    canonicalJson(plan.postgresToolchain) !==
      canonicalJson(OFFICIAL_TOOLCHAIN_EVIDENCE) ||
    canonicalJson(plan.restore?.schemas) !==
      canonicalJson(CANDIDATE_RESTORE_SCHEMAS) ||
    canonicalJson(plan.restore?.flags) !==
      canonicalJson(CANDIDATE_SAFETY_RECOVERY_FLAGS) ||
    plan.restore?.runtimeLoginsRemainFenced !== true ||
    !SHA256.test(plan.safetyBackup?.evidenceSha256 ?? "") ||
    !SHA256.test(plan.safetyBackup?.safetyEvidenceSha256 ?? "") ||
    !SHA256.test(plan.safetyBackup?.sha256 ?? "") ||
    !SHA256.test(plan.safetyBackup?.archiveListSha256 ?? "") ||
    !SHA256.test(plan.safetyBackup?.manifestSha256 ?? "") ||
    !SHA256.test(plan.safetyBackup?.structuralManifestSha256 ?? "") ||
    !SHA256.test(plan.safetyBackup?.cleanClosureSha256 ?? "") ||
    !Number.isSafeInteger(plan.safetyBackup?.cleanClosureStatementCount) ||
    plan.safetyBackup.cleanClosureStatementCount < 1 ||
    !SHA256.test(plan.safetyBackup?.ownerClosureSha256 ?? "") ||
    !Number.isSafeInteger(plan.safetyBackup?.ownerClosureStatementCount) ||
    plan.safetyBackup.ownerClosureStatementCount < 1 ||
    !SHA256.test(plan.safetyBackup?.securityClosureSha256 ?? "") ||
    !Number.isSafeInteger(plan.safetyBackup?.securityClosureStatementCount) ||
    plan.safetyBackup.securityClosureStatementCount < 1 ||
    !SHA256.test(plan.postRestore?.manifestSha256 ?? "") ||
    !SHA256.test(plan.postRestore?.structuralManifestSha256 ?? "") ||
    plan.postRestore.manifestSha256 !== plan.safetyBackup.manifestSha256 ||
    plan.postRestore.structuralManifestSha256 !==
      plan.safetyBackup.structuralManifestSha256 ||
    plan.postRestore.tableCount !== plan.safetyBackup.tableCount ||
    plan.postRestore.rowCount !== plan.safetyBackup.rowCount
  ) {
    throw new Error("Candidate safety recovery plan is invalid");
  }
  exactCandidateTarget(plan.target);
  if (
    canonicalJson(plan.operatorIdentity) !==
    canonicalJson(
      candidateOperatorIdentity(
        `postgresql://${plan.operatorIdentity?.sessionUser}:placeholder@${plan.target.host}:5432/postgres?sslmode=verify-full`,
        plan.target.projectRef,
      ),
    )
  ) {
    throw new Error("Candidate safety recovery plan is invalid");
  }
  promotedCandidateState(
    plan.postRestore.candidateState,
    plan.currentProductCommit,
  );
  return plan;
}

export async function applyCandidateSafetyRecovery(input) {
  const plan = validateCandidateSafetyRecoveryPlan(input.plan);
  if (input.confirmRecovery !== plan.confirmRecovery) {
    throw new Error("Candidate recovery confirmation does not match the plan");
  }
  const target = validateCandidateTarget(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const operatorIdentity = candidateOperatorIdentity(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  if (canonicalJson(target) !== canonicalJson(plan.target)) {
    throw new Error("Candidate recovery target differs from the plan");
  }
  if (canonicalJson(operatorIdentity) !== canonicalJson(plan.operatorIdentity)) {
    throw new Error("Candidate recovery operator identity differs from the plan");
  }
  const caPem = validateCaPem(input.sslCaPem);
  if (sha256(Buffer.from(caPem)) !== plan.caSha256) {
    throw new Error("Candidate recovery CA differs from the plan");
  }
  const password = databasePassword(input.databaseUrl);
  const safetyEvidence = validateCandidateSafetyBackupEvidence(
    input.safetyEvidence,
    {
      operatorCommit: plan.operatorCommit,
      currentProductCommit: plan.currentProductCommit,
      enforceFreshness: false,
    },
  );
  const rawEvidence = validateBackupEvidence(input.safetyBackupEvidence, {
    repositoryCommit: plan.operatorCommit,
  });
  if (
    safetyEvidence.evidenceSha256 !==
      plan.safetyBackup.safetyEvidenceSha256 ||
    sha256(canonicalJson(rawEvidence)) !== plan.safetyBackup.evidenceSha256
  ) {
    throw new Error("Candidate recovery evidence differs from the plan");
  }
  const dependencies = validateDependencies(input.dependencies, [
    "runCommand",
    "validateOfficialToolchain",
    "fileCommitment",
    "safeToolCall",
    "revalidateToolchain",
    "openHostedDatabase",
    "closeHostedDatabase",
    "acquireRestoreLock",
    "assertOperatorSession",
    "inspectCandidateDatabase",
    "inspectProjectorLeaseDrain",
    "fenceRuntimeLogins",
    "assertRuntimeLoginsFenced",
    "captureDatabaseManifest",
    "prepareSafetyRestoreClosures",
    "cleanupCandidateSchemas",
    "applyOwnerAndSecurityClosure",
    "assertCandidateSchemaStage",
  ]);
  const runner = dependencies.runCommand ?? defaultRunCommand;
  const inspectToolchain =
    dependencies.validateOfficialToolchain ?? validateOfficialToolchain;
  const commitFile = dependencies.fileCommitment ?? fileCommitment;
  const executeSafeTool = dependencies.safeToolCall ?? safeToolCall;
  const recheckToolchain =
    dependencies.revalidateToolchain ?? revalidateToolchain;
  const openDatabase = dependencies.openHostedDatabase ?? openCandidateDatabase;
  const closeDatabase = dependencies.closeHostedDatabase ?? closeHostedDatabase;
  const acquire = dependencies.acquireRestoreLock ?? acquireRestoreLock;
  const assertOperatorSession =
    dependencies.assertOperatorSession ?? assertCandidateOperatorSession;
  const inspectState =
    dependencies.inspectCandidateDatabase ?? inspectCandidateDatabase;
  const inspectLeases =
    dependencies.inspectProjectorLeaseDrain ?? inspectProjectorLeaseDrain;
  const fenceLogins = dependencies.fenceRuntimeLogins ?? fenceRuntimeLogins;
  const inspectLoginFence =
    dependencies.assertRuntimeLoginsFenced ?? assertRuntimeLoginsFenced;
  const captureManifest =
    dependencies.captureDatabaseManifest ?? captureDatabaseManifest;
  const prepareClosures =
    dependencies.prepareSafetyRestoreClosures ?? prepareSafetyRestoreClosures;
  const performCleanup =
    dependencies.cleanupCandidateSchemas ?? cleanupCandidateSchemas;
  const applyClosures =
    dependencies.applyOwnerAndSecurityClosure ?? applyOwnerAndSecurityClosure;
  const assertSchemaStage =
    dependencies.assertCandidateSchemaStage ?? assertCandidateSchemaStage;
  let connection;
  let ca;
  let toolchain;
  let safetyCopy;
  let closures;
  let recoveryStarted = false;
  try {
    const inspectedToolchain = await inspectToolchain({
      pgDumpBinary: input.pgDumpBinary,
      pgRestoreBinary: input.pgRestoreBinary,
      psqlBinary: input.psqlBinary,
      runner,
      secrets: [password, input.databaseUrl, caPem],
    });
    toolchain = dependencies.validateOfficialToolchain
      ? inspectedToolchain
      : await materializeOfficialToolchain(inspectedToolchain);
    if (
      canonicalJson(toolchain.evidence) !==
      canonicalJson(plan.postgresToolchain)
    ) {
      throw new Error("Candidate recovery toolchain changed");
    }
    const safetyFile = await privateRegularFile(
      input.safetyBackupPath,
      "safety backup",
    );
    validateArtifact(
      plan.safetyBackup,
      await commitFile(safetyFile.path),
      "safety backup",
    );
    safetyCopy = await createPrivateArtifactSnapshot(
      safetyFile.path,
      plan.safetyBackup,
      "safety backup",
    );
    closures = await prepareClosures({
      runner,
      executeSafeTool,
      pgRestoreBinary: toolchain.paths.pg_restore,
      archivePath: safetyCopy.path,
      restrictKey: plan.safetyBackup.sha256.slice(2),
      environment: Object.freeze({ LANG: "C", LC_ALL: "C" }),
      secrets: [password, input.databaseUrl, caPem],
    });
    if (
      sha256(Buffer.from(closures.cleanup.sql)) !==
        plan.safetyBackup.cleanClosureSha256 ||
      closures.cleanup.statementCount !==
        plan.safetyBackup.cleanClosureStatementCount ||
      sha256(Buffer.from(closures.owners.sql)) !==
        plan.safetyBackup.ownerClosureSha256 ||
      closures.owners.statementCount !==
        plan.safetyBackup.ownerClosureStatementCount ||
      sha256(Buffer.from(closures.security.sql)) !==
        plan.safetyBackup.securityClosureSha256 ||
      closures.security.statementCount !==
        plan.safetyBackup.securityClosureStatementCount
    ) {
      throw new Error("Candidate safety recovery closure changed");
    }
    connection = await openDatabase({
      databaseUrl: input.databaseUrl,
      expectedProjectRef: input.expectedProjectRef,
      sslCaPem: caPem,
    });
    if (
      canonicalJson(connection.target) !== canonicalJson(target) ||
      (connection.operatorIdentity !== undefined &&
        canonicalJson(connection.operatorIdentity) !==
          canonicalJson(operatorIdentity))
    ) {
      throw new Error("Candidate recovery target changed");
    }
    const operatorSession = await acquire(connection.sql);
    drainedLeases(await inspectLeases(connection.sql));
    await fenceLogins(connection.sql);
    await inspectLoginFence(connection.sql);
    let alreadyRecovered = false;
    try {
      await assertSchemaStage(connection.sql, CANDIDATE_RESTORE_SCHEMAS);
      const [state, manifest] = await Promise.all([
        inspectState(connection.sql),
        captureManifest(connection.sql),
      ]);
      alreadyRecovered =
        canonicalJson(
          promotedCandidateState(state, plan.currentProductCommit),
        ) === canonicalJson(plan.postRestore.candidateState) &&
        manifest.manifestSha256 === plan.postRestore.manifestSha256 &&
        manifest.structuralManifestSha256 ===
          plan.postRestore.structuralManifestSha256 &&
        manifest.tableCount === plan.postRestore.tableCount &&
        manifest.rowCount === plan.postRestore.rowCount;
    } catch {
      alreadyRecovered = false;
    }
    if (!alreadyRecovered) {
      ca = await createTemporaryCa(caPem);
      validateArtifact(
        plan.safetyBackup,
        await commitFile(safetyFile.path),
        "safety backup",
      );
      await recheckToolchain(toolchain);
      await assertOperatorSession(connection.sql, operatorSession);
      recoveryStarted = true;
      await performCleanup(connection.sql, closures.cleanup);
      await assertOperatorSession(connection.sql, operatorSession);
      await executeSafeTool({
        runner,
        binary: toolchain.paths.pg_restore,
        args: [
          ...CANDIDATE_SAFETY_RECOVERY_FLAGS,
          ...targetArguments(target, operatorIdentity),
          safetyCopy.path,
        ],
        environment: childEnvironment({ password, caPath: ca.filePath }),
        timeoutMs: 30 * 60_000,
        secrets: [password, input.databaseUrl, caPem],
        expectedBinary: OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_restore,
        expectedRuntimeSha256:
          OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256,
      });
      await assertOperatorSession(connection.sql, operatorSession);
      await applyClosures(
        connection.sql,
        closures.owners,
        closures.security,
      );
      await assertOperatorSession(connection.sql, operatorSession);
    }
    await inspectLoginFence(connection.sql);
    await assertSchemaStage(connection.sql, CANDIDATE_RESTORE_SCHEMAS);
    const [state, manifest] = await Promise.all([
      inspectState(connection.sql),
      captureManifest(connection.sql),
    ]);
    if (
      canonicalJson(
        promotedCandidateState(state, plan.currentProductCommit),
      ) !== canonicalJson(plan.postRestore.candidateState) ||
      manifest.manifestSha256 !== plan.postRestore.manifestSha256 ||
      manifest.structuralManifestSha256 !==
        plan.postRestore.structuralManifestSha256 ||
      manifest.tableCount !== plan.postRestore.tableCount ||
      manifest.rowCount !== plan.postRestore.rowCount
    ) {
      throw new Error("Candidate safety recovery verification failed");
    }
    const stableManifest = await captureManifest(connection.sql);
    if (canonicalJson(stableManifest) !== canonicalJson(manifest)) {
      throw new Error("Candidate safety recovery manifest is not stable");
    }
    const recoveredAt = new Date(input.now ?? Date.now());
    if (!Number.isFinite(recoveredAt.valueOf())) {
      throw new Error("Candidate recovery timestamp is invalid");
    }
    const payload = Object.freeze({
      kind: "programmable-candidate-safety-recovery-result",
      schemaVersion: 1,
      operatorCommit: plan.operatorCommit,
      target,
      operatorIdentity,
      planSha256: plan.planSha256,
      executionMode: alreadyRecovered
        ? "already-recovered"
        : "restored-from-safety-backup",
      candidateState: state,
      manifest,
      runtimeLoginFence: Object.freeze({
        fenced: true,
        loginRoles: RUNTIME_LOGIN_ROLES,
        remainsFenced: true,
      }),
      recoveredAt: recoveredAt.toISOString(),
    });
    assertNoSecretOutput(payload, [password, input.databaseUrl, caPem]);
    return Object.freeze({
      ...payload,
      evidenceSha256: sha256(canonicalJson(payload)),
    });
  } catch {
    throw new Error(
      recoveryStarted
        ? "Candidate safety recovery failed after start; runtime logins remain fenced"
        : "Candidate safety recovery failed before start; runtime logins remain fenced",
    );
  } finally {
    if (ca?.directory) {
      await rm(ca.directory, { recursive: true, force: true }).catch(() => {});
    }
    if (safetyCopy?.directory) {
      await rm(safetyCopy.directory, { recursive: true, force: true }).catch(
        () => {},
      );
    }
    if (toolchain?.cleanupDirectory) {
      await rm(toolchain.cleanupDirectory, { recursive: true, force: true }).catch(
        () => {},
      );
    }
    if (connection?.sql) await closeDatabase(connection.sql).catch(() => {});
  }
}

function restoreResultPayload(value) {
  return {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    operatorCommit: value.operatorCommit,
    target: value.target,
    operatorIdentity: value.operatorIdentity,
    planSha256: value.planSha256,
    confirmationSha256: value.confirmationSha256,
    executionMode: value.executionMode,
    snapshot: value.snapshot,
    migrationCount: value.migrationCount,
    candidateFence: value.candidateFence,
    runtimeLoginFence: value.runtimeLoginFence,
    restoreFlags: value.restoreFlags,
    restoredAt: value.restoredAt,
  };
}

export function validateCandidateRestoreResult(value) {
  const result = plainObject(value, "Candidate restore result");
  if (
    result.kind !== "programmable-candidate-in-place-restore-result" ||
    result.schemaVersion !== 1 ||
    !COMMIT.test(result.operatorCommit ?? "") ||
    !SHA256.test(result.planSha256 ?? "") ||
    !SHA256.test(result.confirmationSha256 ?? "") ||
    ![
      "restored-from-pinned-snapshot",
      "resumed-post-restore-verification",
    ].includes(result.executionMode) ||
    result.snapshot?.sha256 !== PINNED_PRE_ATTESTATION_SNAPSHOT.sha256 ||
    result.snapshot?.bytes !== PINNED_PRE_ATTESTATION_SNAPSHOT.bytes ||
    result.snapshot?.archiveListSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.archiveListSha256 ||
    result.snapshot?.schemaSqlSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.schemaSqlSha256 ||
    result.snapshot?.manifestSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.manifestSha256 ||
    result.snapshot?.structuralManifestSha256 !==
      PINNED_PRE_ATTESTATION_SNAPSHOT.structuralManifestSha256 ||
    !Number.isSafeInteger(result.snapshot?.tableCount) ||
    !Number.isSafeInteger(result.snapshot?.rowCount) ||
    !Number.isSafeInteger(result.migrationCount) ||
    result.migrationCount < 1 ||
    result.runtimeLoginFence?.fenced !== true ||
    result.runtimeLoginFence?.remainsFenced !== true ||
    canonicalJson(result.runtimeLoginFence?.loginRoles) !==
      canonicalJson(RUNTIME_LOGIN_ROLES) ||
    canonicalJson(result.restoreFlags) !==
      canonicalJson(CANDIDATE_RESTORE_FLAGS) ||
    !Number.isFinite(Date.parse(result.restoredAt ?? "")) ||
    !SHA256.test(result.evidenceSha256 ?? "") ||
    sha256(canonicalJson(restoreResultPayload(result))) !== result.evidenceSha256
  ) {
    throw new Error("Candidate restore result is invalid");
  }
  exactCandidateTarget(result.target);
  if (
    canonicalJson(result.operatorIdentity) !==
    canonicalJson(
      candidateOperatorIdentity(
        `postgresql://${result.operatorIdentity?.sessionUser}:placeholder@${result.target.host}:5432/postgres?sslmode=verify-full`,
        result.target.projectRef,
      ),
    )
  ) {
    throw new Error("Candidate restore result is invalid");
  }
  assertCandidateFence(result.candidateFence, "fenced");
  return result;
}

function readExactRuntimeCredentials(value) {
  const credentials = plainObject(value, "Candidate runtime credentials");
  const expected = ROLE_SPECS.map(({ key }) => key).sort();
  if (canonicalJson(Object.keys(credentials).sort()) !== canonicalJson(expected)) {
    throw new Error("exactly five Candidate runtime credentials are required");
  }
  const values = new Map();
  const unique = new Set();
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
      /[^\x21-\x7e]/u.test(password) ||
      unique.has(password)
    ) {
      throw new Error("Candidate runtime credential is invalid");
    }
    unique.add(password);
    values.set(spec.key, password);
  }
  return values;
}

async function readRuntimeRolePosture(sql) {
  const names = ROLE_SPECS.flatMap(({ loginRole, capabilityRole }) => [
    loginRole,
    capabilityRole,
  ]);
  const rows = await sql.unsafe(
    `
      select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
             rolinherit, rolreplication, rolbypassrls, rolconnlimit, rolconfig,
             auth.rolpassword is not null as has_password
        from pg_catalog.pg_roles as roles
        join pg_catalog.pg_authid as auth on auth.rolname = roles.rolname
       where roles.rolname = any($1::text[])
       order by roles.rolname
    `,
    [names],
  );
  const memberships = await sql.unsafe(
    `
      select member_role.rolname as member_role,
             granted_role.rolname as granted_role,
             membership.admin_option, membership.inherit_option,
             membership.set_option
        from pg_catalog.pg_auth_members as membership
        join pg_catalog.pg_roles as member_role
          on member_role.oid = membership.member
        join pg_catalog.pg_roles as granted_role
          on granted_role.oid = membership.roleid
       where member_role.rolname = any($1::text[])
       order by member_role.rolname, granted_role.rolname
    `,
    [RUNTIME_LOGIN_ROLES],
  );
  return { rows, memberships };
}

function assertRuntimeRolePosture(posture, loginEnabled) {
  if (!Array.isArray(posture?.rows) || !Array.isArray(posture?.memberships)) {
    throw new Error("Candidate runtime role posture is invalid");
  }
  const rows = new Map(posture.rows.map((row) => [row?.rolname, row]));
  if (rows.size !== ROLE_SPECS.length * 2) {
    throw new Error("Candidate runtime role set is not exact");
  }
  const exactFlags = (row, canLogin) =>
    row?.rolcanlogin === canLogin &&
    row?.rolsuper === false &&
    row?.rolcreatedb === false &&
    row?.rolcreaterole === false &&
    row?.rolinherit === false &&
    row?.rolreplication === false &&
    row?.rolbypassrls === false &&
    Number(row?.rolconnlimit) === -1 &&
    (row?.rolconfig === null || row?.rolconfig?.length === 0);
  for (const spec of ROLE_SPECS) {
    const login = rows.get(spec.loginRole);
    const capability = rows.get(spec.capabilityRole);
    const memberships = posture.memberships.filter(
      ({ member_role: memberRole }) => memberRole === spec.loginRole,
    );
    if (
      !exactFlags(login, loginEnabled) ||
      !exactFlags(capability, false) ||
      (loginEnabled && login?.has_password !== true) ||
      memberships.length !== 1 ||
      memberships[0]?.granted_role !== spec.capabilityRole ||
      memberships[0]?.admin_option !== false ||
      memberships[0]?.inherit_option !== false ||
      memberships[0]?.set_option !== true
    ) {
      throw new Error("Candidate runtime role posture is not exact");
    }
  }
  return true;
}

function runtimeLoginsEnabled(posture) {
  try {
    assertRuntimeRolePosture(posture, false);
    return false;
  } catch {
    assertRuntimeRolePosture(posture, true);
    return true;
  }
}

function runtimePasswordSql(spec) {
  return `
do $candidate_runtime_enable$
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
    '${spec.loginRole}', credential_value, 'infinity'
  );
  perform pg_catalog.set_config('programmable.credential_rotation', '', true);
end
$candidate_runtime_enable$;
`;
}

async function enableRuntimeRoles(sql, credentials) {
  return sql.begin(async (transaction) => {
    const [identity] = await transaction.unsafe(`
      select session_user::text as session_user,
             current_user::text as current_user,
             current_role::text as current_role,
             pg_catalog.current_database()::text as database_name,
             pg_catalog.inet_server_port()::integer as server_port,
             pg_catalog.pg_has_role(
               session_user, 'postgres', 'member'
             ) as is_postgres_member
    `);
    if (
      !["postgres", "cli_login_postgres"].includes(identity?.session_user) ||
      identity?.current_user !== "postgres" ||
      identity?.current_role !== "postgres" ||
      identity?.database_name !== "postgres" ||
      Number(identity?.server_port) !== 5432 ||
      (identity?.session_user === "cli_login_postgres" &&
        identity?.is_postgres_member !== true)
    ) {
      throw new Error("Candidate runtime enable identity is not approved");
    }
    assertRuntimeRolePosture(await readRuntimeRolePosture(transaction), false);
    for (const spec of ROLE_SPECS) {
      await transaction`
        select pg_catalog.set_config(
          'programmable.credential_rotation',
          ${credentials.get(spec.key)},
          true
        )
      `;
      await transaction.unsafe(runtimePasswordSql(spec)).simple();
    }
    await transaction
      .unsafe(
        RUNTIME_LOGIN_ROLES.map((role) => `alter role ${role} login;`).join("\n"),
      )
      .simple();
    assertRuntimeRolePosture(await readRuntimeRolePosture(transaction), true);
  });
}

function exactPoolerTarget(expectedProjectRef, poolerHost) {
  if (
    expectedProjectRef !== CANDIDATE_PROJECT_REF ||
    typeof poolerHost !== "string" ||
    !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(poolerHost)
  ) {
    throw new Error("Candidate pooler target is invalid");
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

function runtimeEnablePlanPayload(value) {
  return {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    operatorCommit: value.operatorCommit,
    target: value.target,
    operatorIdentity: value.operatorIdentity,
    poolerTarget: value.poolerTarget,
    caSha256: value.caSha256,
    restoreEvidenceSha256: value.restoreEvidenceSha256,
    migrationPlanSha256: value.migrationPlanSha256,
    migrationCount: value.migrationCount,
    candidateFence: value.candidateFence,
    manifest: value.manifest,
    runtimeRoles: value.runtimeRoles,
  };
}

export async function createCandidateRuntimeEnablePlan(input) {
  if (!COMMIT.test(input.repositoryCommit ?? "")) {
    throw new Error("Candidate runtime enable commit is invalid");
  }
  const restoreResult = validateCandidateRestoreResult(input.restoreResult);
  const migrationPlan = validateMigrationPlan(input.migrationPlan);
  if (
    restoreResult.operatorCommit !== input.repositoryCommit ||
    migrationPlan.repositoryCommit !== input.repositoryCommit
  ) {
    throw new Error("Candidate runtime enable evidence commit is not exact");
  }
  const target = validateCandidateTarget(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const operatorIdentity = candidateOperatorIdentity(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const poolerTarget = exactPoolerTarget(
    input.expectedProjectRef,
    input.poolerHost,
  );
  const caPem = validateCaPem(input.sslCaPem);
  const dependencies = validateDependencies(input.dependencies, [
    "openHostedDatabase",
    "closeHostedDatabase",
    "acquireRestoreLock",
    "assertOperatorSession",
    "inspectCandidateDatabase",
    "inspectProjectorLeaseDrain",
    "assertRuntimeLoginsFenced",
    "inspectMigrationState",
    "captureDatabaseManifest",
    "readRuntimeRolePosture",
  ]);
  const openDatabase = dependencies.openHostedDatabase ?? openCandidateDatabase;
  const closeDatabase = dependencies.closeHostedDatabase ?? closeHostedDatabase;
  const acquire = dependencies.acquireRestoreLock ?? acquireRestoreLock;
  const assertOperatorSession =
    dependencies.assertOperatorSession ?? assertCandidateOperatorSession;
  const inspectState =
    dependencies.inspectCandidateDatabase ?? inspectCandidateDatabase;
  const inspectLeases =
    dependencies.inspectProjectorLeaseDrain ?? inspectProjectorLeaseDrain;
  const inspectLoginFence =
    dependencies.assertRuntimeLoginsFenced ?? assertRuntimeLoginsFenced;
  const inspectMigrations =
    dependencies.inspectMigrationState ?? inspectMigrationState;
  const captureManifest =
    dependencies.captureDatabaseManifest ?? captureDatabaseManifest;
  const inspectRoles =
    dependencies.readRuntimeRolePosture ?? readRuntimeRolePosture;
  let connection;
  try {
    connection = await openDatabase({
      databaseUrl: input.databaseUrl,
      expectedProjectRef: input.expectedProjectRef,
      sslCaPem: caPem,
    });
    if (
      canonicalJson(connection.target) !== canonicalJson(target) ||
      (connection.operatorIdentity !== undefined &&
        canonicalJson(connection.operatorIdentity) !==
          canonicalJson(operatorIdentity))
    ) {
      throw new Error("Candidate runtime enable target changed");
    }
    const operatorSession = await acquire(connection.sql);
    drainedLeases(await inspectLeases(connection.sql));
    await inspectLoginFence(connection.sql);
    assertRuntimeRolePosture(await inspectRoles(connection.sql), false);
    const state = assertCandidateFence(await inspectState(connection.sql), "fenced");
    const migrationState = await inspectMigrations({
      sql: connection.sql,
      plan: migrationPlan,
    });
    if (
      migrationState.status !== "current" ||
      migrationState.appliedCount !== migrationPlan.migrationCount ||
      migrationState.pending.length !== 0
    ) {
      throw new Error("Candidate migrations are not current");
    }
    const manifest = await captureManifest(connection.sql, {
      schemas: CANDIDATE_FINAL_SCHEMAS,
    });
    if (
      !SHA256.test(manifest?.manifestSha256 ?? "") ||
      !SHA256.test(manifest?.structuralManifestSha256 ?? "") ||
      !Number.isSafeInteger(manifest?.tableCount) ||
      !Number.isSafeInteger(manifest?.rowCount)
    ) {
      throw new Error("Candidate runtime enable manifest is invalid");
    }
    await assertOperatorSession(connection.sql, operatorSession);
    const payload = Object.freeze({
      kind: "programmable-candidate-runtime-enable-plan",
      schemaVersion: 1,
      operatorCommit: input.repositoryCommit,
      target,
      operatorIdentity,
      poolerTarget,
      caSha256: sha256(Buffer.from(caPem)),
      restoreEvidenceSha256: restoreResult.evidenceSha256,
      migrationPlanSha256: migrationPlan.planSha256,
      migrationCount: migrationPlan.migrationCount,
      candidateFence: state,
      manifest: Object.freeze({ ...manifest }),
      runtimeRoles: Object.freeze(
        ROLE_SPECS.map(({ loginRole, capabilityRole }) =>
          Object.freeze({ loginRole, capabilityRole }),
        ),
      ),
    });
    const planSha256 = sha256(canonicalJson(runtimeEnablePlanPayload(payload)));
    return Object.freeze({
      ...payload,
      planSha256,
      confirmEnable: sha256(
        `programmable:candidate-runtime-enable-confirmation:v1\0${planSha256}`,
      ),
    });
  } finally {
    if (connection?.sql) await closeDatabase(connection.sql).catch(() => {});
  }
}

export function validateCandidateRuntimeEnablePlan(value) {
  const plan = plainObject(value, "Candidate runtime enable plan");
  if (
    plan.kind !== "programmable-candidate-runtime-enable-plan" ||
    plan.schemaVersion !== 1 ||
    !COMMIT.test(plan.operatorCommit ?? "") ||
    !SHA256.test(plan.restoreEvidenceSha256 ?? "") ||
    !SHA256.test(plan.migrationPlanSha256 ?? "") ||
    !SHA256.test(plan.caSha256 ?? "") ||
    !SHA256.test(plan.manifest?.manifestSha256 ?? "") ||
    !SHA256.test(plan.manifest?.structuralManifestSha256 ?? "") ||
    !Number.isSafeInteger(plan.migrationCount) ||
    plan.migrationCount < 1 ||
    !SHA256.test(plan.planSha256 ?? "") ||
    !SHA256.test(plan.confirmEnable ?? "") ||
    sha256(canonicalJson(runtimeEnablePlanPayload(plan))) !== plan.planSha256 ||
    sha256(
      `programmable:candidate-runtime-enable-confirmation:v1\0${plan.planSha256}`,
    ) !== plan.confirmEnable ||
    canonicalJson(plan.runtimeRoles) !==
      canonicalJson(
        ROLE_SPECS.map(({ loginRole, capabilityRole }) => ({
          loginRole,
          capabilityRole,
        })),
      )
  ) {
    throw new Error("Candidate runtime enable plan is invalid");
  }
  exactCandidateTarget(plan.target);
  if (
    canonicalJson(plan.operatorIdentity) !==
    canonicalJson(
      candidateOperatorIdentity(
        `postgresql://${plan.operatorIdentity?.sessionUser}:placeholder@${plan.target.host}:5432/postgres?sslmode=verify-full`,
        plan.target.projectRef,
      ),
    )
  ) {
    throw new Error("Candidate runtime enable plan is invalid");
  }
  exactPoolerTarget(plan.target.projectRef, plan.poolerTarget?.host);
  assertCandidateFence(plan.candidateFence, "fenced");
  return plan;
}

export async function applyCandidateRuntimeEnable(input) {
  const plan = validateCandidateRuntimeEnablePlan(input.plan);
  if (input.confirmEnable !== plan.confirmEnable) {
    throw new Error("Candidate runtime enable confirmation does not match");
  }
  const restoreResult = validateCandidateRestoreResult(input.restoreResult);
  const migrationPlan = validateMigrationPlan(input.migrationPlan);
  if (
    restoreResult.evidenceSha256 !== plan.restoreEvidenceSha256 ||
    migrationPlan.planSha256 !== plan.migrationPlanSha256 ||
    migrationPlan.repositoryCommit !== plan.operatorCommit
  ) {
    throw new Error("Candidate runtime enable evidence differs from the plan");
  }
  const target = validateCandidateTarget(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const operatorIdentity = candidateOperatorIdentity(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  if (canonicalJson(target) !== canonicalJson(plan.target)) {
    throw new Error("Candidate runtime enable target differs from the plan");
  }
  if (canonicalJson(operatorIdentity) !== canonicalJson(plan.operatorIdentity)) {
    throw new Error("Candidate runtime operator identity differs from the plan");
  }
  const poolerTarget = exactPoolerTarget(
    input.expectedProjectRef,
    input.poolerHost,
  );
  if (canonicalJson(poolerTarget) !== canonicalJson(plan.poolerTarget)) {
    throw new Error("Candidate pooler target differs from the plan");
  }
  const caPem = validateCaPem(input.sslCaPem);
  if (sha256(Buffer.from(caPem)) !== plan.caSha256) {
    throw new Error("Candidate runtime enable CA differs from the plan");
  }
  const credentials = readExactRuntimeCredentials(input.credentials);
  const dependencies = validateDependencies(input.dependencies, [
    "openHostedDatabase",
    "closeHostedDatabase",
    "acquireRestoreLock",
    "assertOperatorSession",
    "inspectCandidateDatabase",
    "inspectProjectorLeaseDrain",
    "assertRuntimeLoginsFenced",
    "fenceRuntimeLogins",
    "inspectMigrationState",
    "captureDatabaseManifest",
    "readRuntimeRolePosture",
    "enableRuntimeRoles",
    "verifyPoolerLogins",
  ]);
  const openDatabase = dependencies.openHostedDatabase ?? openCandidateDatabase;
  const closeDatabase = dependencies.closeHostedDatabase ?? closeHostedDatabase;
  const acquire = dependencies.acquireRestoreLock ?? acquireRestoreLock;
  const assertOperatorSession =
    dependencies.assertOperatorSession ?? assertCandidateOperatorSession;
  const inspectState =
    dependencies.inspectCandidateDatabase ?? inspectCandidateDatabase;
  const inspectLeases =
    dependencies.inspectProjectorLeaseDrain ?? inspectProjectorLeaseDrain;
  const inspectLoginFence =
    dependencies.assertRuntimeLoginsFenced ?? assertRuntimeLoginsFenced;
  const refence = dependencies.fenceRuntimeLogins ?? fenceRuntimeLogins;
  const inspectMigrations =
    dependencies.inspectMigrationState ?? inspectMigrationState;
  const captureManifest =
    dependencies.captureDatabaseManifest ?? captureDatabaseManifest;
  const inspectRoles =
    dependencies.readRuntimeRolePosture ?? readRuntimeRolePosture;
  const enableRoles = dependencies.enableRuntimeRoles ?? enableRuntimeRoles;
  const verifyPooler = dependencies.verifyPoolerLogins ?? verifyPoolerLogins;
  let connection;
  let runtimeLoginsMayBeEnabled = true;
  try {
    connection = await openDatabase({
      databaseUrl: input.databaseUrl,
      expectedProjectRef: input.expectedProjectRef,
      sslCaPem: caPem,
    });
    if (
      canonicalJson(connection.target) !== canonicalJson(target) ||
      (connection.operatorIdentity !== undefined &&
        canonicalJson(connection.operatorIdentity) !==
          canonicalJson(operatorIdentity))
    ) {
      throw new Error("Candidate runtime enable target changed");
    }
    const operatorSession = await acquire(connection.sql);
    drainedLeases(await inspectLeases(connection.sql));
    const resumedAfterEnable = runtimeLoginsEnabled(
      await inspectRoles(connection.sql),
    );
    runtimeLoginsMayBeEnabled = resumedAfterEnable;
    if (!resumedAfterEnable) await inspectLoginFence(connection.sql);
    const state = assertCandidateFence(await inspectState(connection.sql), "fenced");
    if (canonicalJson(state) !== canonicalJson(plan.candidateFence)) {
      throw new Error("Candidate fence changed after runtime enable review");
    }
    const migrationState = await inspectMigrations({
      sql: connection.sql,
      plan: migrationPlan,
    });
    if (
      migrationState.status !== "current" ||
      migrationState.appliedCount !== plan.migrationCount ||
      migrationState.pending.length !== 0
    ) {
      throw new Error("Candidate migrations changed after review");
    }
    if (
      canonicalJson(await captureManifest(connection.sql, {
        schemas: CANDIDATE_FINAL_SCHEMAS,
      })) !==
      canonicalJson(plan.manifest)
    ) {
      throw new Error("Candidate database changed after runtime enable review");
    }
    await assertOperatorSession(connection.sql, operatorSession);
    if (!resumedAfterEnable) {
      // The transaction may commit even when the client never receives its
      // acknowledgement. From this point onward, treat LOGIN/password state as
      // uncertain until it is verified or explicitly re-fenced.
      runtimeLoginsMayBeEnabled = true;
      await enableRoles(connection.sql, credentials);
    }
    assertRuntimeRolePosture(await inspectRoles(connection.sql), true);
    await assertOperatorSession(connection.sql, operatorSession);
    const verification = await verifyPooler({
      expectedProjectRef: input.expectedProjectRef,
      poolerHost: input.poolerHost,
      sslCaPem: caPem,
      credentials: input.credentials,
    });
    await assertOperatorSession(connection.sql, operatorSession);
    const enabledAt = new Date(input.now ?? Date.now());
    if (!Number.isFinite(enabledAt.valueOf())) {
      throw new Error("Candidate runtime enable timestamp is invalid");
    }
    const payload = Object.freeze({
      kind: "programmable-candidate-runtime-enable-result",
      schemaVersion: 1,
      operatorCommit: plan.operatorCommit,
      target,
      operatorIdentity,
      poolerTarget,
      planSha256: plan.planSha256,
      restoreEvidenceSha256: restoreResult.evidenceSha256,
      migrationPlanSha256: migrationPlan.planSha256,
      executionMode: resumedAfterEnable
        ? "resumed-enabled-verification"
        : "enabled-and-verified",
      roles: verification.roles,
      runtimeLoginsEnabled: true,
      enabledAt: enabledAt.toISOString(),
    });
    assertNoSecretOutput(payload, [
      input.databaseUrl,
      caPem,
      ...credentials.values(),
    ]);
    return Object.freeze({
      ...payload,
      evidenceSha256: sha256(canonicalJson(payload)),
    });
  } catch {
    if (!runtimeLoginsMayBeEnabled) {
      throw new Error("Candidate runtime enable failed before logins opened");
    }
    let refenced = false;
    if (connection?.sql) {
      try {
        await refence(connection.sql);
        await inspectLoginFence(connection.sql);
        assertRuntimeRolePosture(await inspectRoles(connection.sql), false);
        refenced = true;
      } catch {
        await closeDatabase(connection.sql).catch(() => {});
        connection = undefined;
      }
    }
    if (!refenced) {
      try {
        connection = await openDatabase({
          databaseUrl: input.databaseUrl,
          expectedProjectRef: input.expectedProjectRef,
          sslCaPem: caPem,
        });
        if (
          canonicalJson(connection.target) !== canonicalJson(target) ||
          (connection.operatorIdentity !== undefined &&
            canonicalJson(connection.operatorIdentity) !==
              canonicalJson(operatorIdentity))
        ) {
          throw new Error("Candidate runtime re-fence target changed");
        }
        await acquire(connection.sql);
        await refence(connection.sql);
        await inspectLoginFence(connection.sql);
        assertRuntimeRolePosture(await inspectRoles(connection.sql), false);
        refenced = true;
      } catch {
        refenced = false;
      }
    }
    throw new Error(
      refenced
        ? "Candidate runtime enable failed; runtime logins were re-fenced and verified"
        : "Candidate runtime enable failed; status is indeterminate and runtime logins may remain enabled",
    );
  } finally {
    if (connection?.sql) await closeDatabase(connection.sql).catch(() => {});
  }
}
