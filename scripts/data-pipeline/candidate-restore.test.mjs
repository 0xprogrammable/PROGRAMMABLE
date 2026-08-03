import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { promisify } from "node:util";

import {
  CANDIDATE_PROJECT_REF,
  CANDIDATE_PG_RESTRICT_KEY,
  CANDIDATE_FINAL_SCHEMAS,
  CANDIDATE_RESTORE_FLAGS,
  CANDIDATE_RESTORE_SCHEMAS,
  CANDIDATE_SAFETY_RECOVERY_FLAGS,
  OFFICIAL_POSTGRES_17_TOOLCHAIN,
  PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE,
  PINNED_PRE_ATTESTATION_SNAPSHOT,
  applyCandidateRestore,
  applyCandidateRuntimeEnable,
  applyCandidateSafetyRecovery,
  assertRestoreRolePostureEvidence,
  buildCandidateSafetyBackupEvidence,
  createCandidateRestorePlan,
  createCandidateRuntimeEnablePlan,
  createCandidateSafetyBackup,
  createCandidateSafetyRecoveryPlan,
  materializeOfficialToolchain,
  readRuntimeRolePosture,
  validateOfficialToolchain,
  validateCandidateRestoreResult,
  validateCandidateSafetyBackupEvidence,
  validatePinnedSnapshotEvidence,
} from "./candidate-restore.mjs";
import { FINAL_BACKUP_SCHEMAS, ROLE_SPECS } from "./cutover-credentials.mjs";
import { canonicalJson, sha256 } from "./hosted-db-operator-core.mjs";

const OPERATOR_COMMIT = "a".repeat(40);
const CURRENT_PRODUCT_COMMIT = "b".repeat(40);
const PASSWORD = "candidate-secret-password";
const DATABASE_URL =
  `postgresql://postgres:${PASSWORD}@db.${CANDIDATE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full`;
const CA = `-----BEGIN CERTIFICATE-----\n${"A".repeat(96)}\n-----END CERTIFICATE-----`;
const ALT_CA = `-----BEGIN CERTIFICATE-----\n${"B".repeat(96)}\n-----END CERTIFICATE-----`;
const POOLER_HOST = "aws-0-eu-central-1.pooler.supabase.com";
const executeFile = promisify(execFile);
const PINNED_TOC_BROTLI_BASE64 = "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";
const ARCHIVE_LIST = brotliDecompressSync(
  Buffer.from(PINNED_TOC_BROTLI_BASE64, "base64"),
);
const SAFETY_ARCHIVE_LIST = Buffer.concat([
  ARCHIVE_LIST,
  Buffer.from(
    "25; 2615 31801 SCHEMA - programmable_wake_private programmable_migrator\n",
  ),
]);
const TARGET = Object.freeze({
  projectRef: CANDIDATE_PROJECT_REF,
  host: `db.${CANDIDATE_PROJECT_REF}.supabase.co`,
  port: 5432,
  database: "postgres",
  sslMode: "verify-full",
});
const OPERATOR_IDENTITY = Object.freeze({
  mode: "database-owner",
  sessionUser: "postgres",
  effectiveRole: "postgres",
});
const TOOLCHAIN_EVIDENCE = Object.freeze({
  ...OFFICIAL_POSTGRES_17_TOOLCHAIN,
  toolchainSha256: sha256(canonicalJson(OFFICIAL_POSTGRES_17_TOOLCHAIN)),
});

test("runtime role posture qualifies joined role catalog columns", async () => {
  const queries = [];
  const posture = await readRuntimeRolePosture({
    unsafe: async (query) => {
      queries.push(query);
      return [];
    },
  });
  assert.deepEqual(posture, { rows: [], memberships: [] });
  assert.equal(queries.length, 2);
  assert.match(queries[0], /select roles\.rolname, roles\.rolcanlogin/u);
  assert.doesNotMatch(queries[0], /select rolname, rolcanlogin/u);
});
const HOSTED_RESTORED_STRUCTURAL_MANIFEST = `0x${"9".repeat(64)}`;
const RESTORED_PORTABLE_STRUCTURAL_MANIFEST =
  PINNED_PRE_ATTESTATION_SNAPSHOT.portableStructuralManifestSha256;
const SAFETY_MANIFEST = `0x${"e".repeat(64)}`;
const SAFETY_STRUCTURAL_MANIFEST = `0x${"f".repeat(64)}`;
const SAFETY_PORTABLE_STRUCTURAL_MANIFEST = `0x${"d".repeat(64)}`;

const RESTORE_ROLE_IDENTITY = Object.freeze({
  session_user: "cli_login_postgres",
  current_user: "postgres",
  current_role: "postgres",
  can_set_migrator: true,
  supabase_admin_exists: true,
});
const RESTORE_ROLES = Object.freeze([
  Object.freeze({ rolname: "postgres", rolsuper: false }),
  Object.freeze({
    rolname: "programmable_migrator",
    rolsuper: false,
    rolinherit: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: false,
    rolreplication: false,
    rolbypassrls: false,
  }),
]);
const RESTORE_OPERATOR_MEMBERSHIP = Object.freeze({
  member_role: "postgres",
  granted_role: "programmable_migrator",
  grantor_role: "postgres",
  inherit_option: false,
  set_option: true,
  admin_option: false,
});
const RESTORE_SUPABASE_MEMBERSHIP = Object.freeze({
  member_role: "postgres",
  granted_role: "programmable_migrator",
  grantor_role: "supabase_admin",
  inherit_option: false,
  set_option: false,
  admin_option: true,
});

test("restore posture accepts the exact Supabase admin and operator grants", () => {
  assert.doesNotThrow(() =>
    assertRestoreRolePostureEvidence(
      RESTORE_ROLE_IDENTITY,
      RESTORE_ROLES,
      [RESTORE_SUPABASE_MEMBERSHIP, RESTORE_OPERATOR_MEMBERSHIP],
      { supabaseHosted: true },
    ),
  );
});

test("restore posture accepts the exact grants for a hosted postgres login", () => {
  assert.doesNotThrow(() =>
    assertRestoreRolePostureEvidence(
      { ...RESTORE_ROLE_IDENTITY, session_user: "postgres" },
      RESTORE_ROLES,
      [RESTORE_SUPABASE_MEMBERSHIP, RESTORE_OPERATOR_MEMBERSHIP],
      { supabaseHosted: true },
    ),
  );
});

test("restore posture accepts an isolated postgres operator grant", () => {
  assert.doesNotThrow(() =>
    assertRestoreRolePostureEvidence(
      {
        ...RESTORE_ROLE_IDENTITY,
        session_user: "postgres",
        supabase_admin_exists: false,
      },
      RESTORE_ROLES,
      [RESTORE_OPERATOR_MEMBERSHIP],
      { supabaseHosted: false },
    ),
  );
});

test("restore posture rejects unknown or duplicated memberships", () => {
  const invalid = Object.freeze({
    ...RESTORE_SUPABASE_MEMBERSHIP,
    grantor_role: "unknown_admin",
  });
  for (const memberships of [
    [RESTORE_SUPABASE_MEMBERSHIP],
    [RESTORE_OPERATOR_MEMBERSHIP],
    [RESTORE_OPERATOR_MEMBERSHIP, RESTORE_OPERATOR_MEMBERSHIP],
    [RESTORE_OPERATOR_MEMBERSHIP, invalid],
  ]) {
    assert.throws(
      () =>
        assertRestoreRolePostureEvidence(
          RESTORE_ROLE_IDENTITY,
          RESTORE_ROLES,
          memberships,
          { supabaseHosted: true },
        ),
      /Candidate restore role posture is not exact/u,
    );
  }
  assert.throws(
    () =>
      assertRestoreRolePostureEvidence(
        { ...RESTORE_ROLE_IDENTITY, supabase_admin_exists: false },
        RESTORE_ROLES,
        [RESTORE_SUPABASE_MEMBERSHIP, RESTORE_OPERATOR_MEMBERSHIP],
        { supabaseHosted: false },
      ),
    /Candidate restore role posture is not exact/u,
  );
});

const PINNED_SNAPSHOT_EVIDENCE = Object.freeze({
  kind: "programmable-database-backup-restore-evidence",
  schemaVersion: 1,
  operationId: "cutover-20260802-88cd707",
  repositoryCommit: "88cd7078037910c22fc7e67e0031f7e4ef30e422",
  requestSha256:
    "0x6927acce4fdd879943cd3330f9886fc32b226bebd87ce9f5a86d66624f24372d",
  source: TARGET,
  restore: {
    isolationId: "cutover13",
    host: "127.0.0.1",
    port: 55439,
    database: "programmable_restore_cutover13",
    sslMode: "verify-full",
  },
  backup: {
    format: "pg-custom-v1",
    sha256:
      "0xb3679e8b178535bbc58f9c9c43690a8c7e310ade8bd93360f15004be385b02d2",
    bytes: 26_766_662,
    archiveListSha256:
      "0x18037f0fc9740623c79a826a3a7d3b6c38ebd832ac98029aeca2f1064d914a55",
  },
  sourceManifestSha256:
    "0x5921ceacba6b7d3c636d3571fd7ebe9fad599626d03372836d0e6293e358c597",
  restoredManifestSha256:
    "0x5921ceacba6b7d3c636d3571fd7ebe9fad599626d03372836d0e6293e358c597",
  tableCount: 120,
  rowCount: 147_491,
  postgresVersion: "PostgreSQL 17.10",
  createdAt: "2026-08-01T23:20:44.169Z",
});

function candidateState(overrides = {}) {
  return {
    databaseMode: "candidate-only",
    envioProviderDeploymentId: "11111111-1111-4111-8111-111111111111",
    promoted: true,
    promotedAt: "2026-08-02T09:00:00.000Z",
    publicationCount: 5,
    promotionAttestationCommitment: `0x${"c".repeat(64)}`,
    productCommit: CURRENT_PRODUCT_COMMIT,
    stagedDeploymentId: "dpl_12345678901234567890",
    ...overrides,
  };
}

function restoredState(overrides = {}) {
  return candidateState({
    promoted: false,
    promotedAt: null,
    publicationCount: 0,
    promotionAttestationCommitment: null,
    productCommit: null,
    stagedDeploymentId: null,
    ...overrides,
  });
}

function leases() {
  return {
    observedAt: "2026-08-02T09:00:00.000Z",
    drained: true,
    leases: [
      {
        projector: "market",
        leaseGeneration: "1",
        expiresAt: null,
        releasedAt: "2026-08-02T08:59:00.000Z",
        drained: true,
      },
      {
        projector: "source",
        leaseGeneration: "1",
        expiresAt: null,
        releasedAt: "2026-08-02T08:59:00.000Z",
        drained: true,
      },
    ],
  };
}

function loginFence() {
  return {
    fenced: true,
    loginRoles: ROLE_SPECS.map(({ loginRole }) => loginRole).sort(),
    terminatedSessions: 2,
  };
}

function manifest({ restored = false } = {}) {
  return restored
    ? {
        manifestSha256: PINNED_PRE_ATTESTATION_SNAPSHOT.manifestSha256,
        structuralManifestSha256: HOSTED_RESTORED_STRUCTURAL_MANIFEST,
        portableStructuralManifestSha256:
          RESTORED_PORTABLE_STRUCTURAL_MANIFEST,
        tableCount: PINNED_SNAPSHOT_EVIDENCE.tableCount,
        rowCount: PINNED_SNAPSHOT_EVIDENCE.rowCount,
      }
    : {
        manifestSha256: SAFETY_MANIFEST,
        structuralManifestSha256: SAFETY_STRUCTURAL_MANIFEST,
        portableStructuralManifestSha256:
          SAFETY_PORTABLE_STRUCTURAL_MANIFEST,
        tableCount: 121,
        rowCount: 147_999,
      };
}

function rawSafetyEvidence(archive) {
  const current = manifest();
  return {
    kind: "programmable-database-backup-restore-evidence",
    schemaVersion: 1,
    operationId: "candidate-safety-20260802",
    repositoryCommit: OPERATOR_COMMIT,
    requestSha256: `0x${"1".repeat(64)}`,
    source: TARGET,
    restore: {
      isolationId: "candidate_safety_20260802",
      host: "127.0.0.1",
      port: 55439,
      database: "programmable_restore_candidate_safety_20260802",
      sslMode: "verify-full",
    },
    backup: {
      format: "pg-custom-v1",
      sha256: sha256(archive),
      bytes: archive.byteLength,
      archiveListSha256: sha256(SAFETY_ARCHIVE_LIST),
    },
    sourceManifestSha256: current.manifestSha256,
    restoredManifestSha256: current.manifestSha256,
    sourceStructuralManifestSha256: current.structuralManifestSha256,
    restoredStructuralManifestSha256: current.structuralManifestSha256,
    sourcePortableStructuralManifestSha256:
      current.portableStructuralManifestSha256,
    restoredPortableStructuralManifestSha256:
      current.portableStructuralManifestSha256,
    tableCount: current.tableCount,
    rowCount: current.rowCount,
    postgresVersion: "PostgreSQL 17.10",
    createdAt: "2026-08-02T09:05:00.000Z",
  };
}

function buildSafetyEvidence(rawEvidence, operatorIdentity = OPERATOR_IDENTITY) {
  return buildCandidateSafetyBackupEvidence({
    operatorCommit: OPERATOR_COMMIT,
    currentProductCommit: CURRENT_PRODUCT_COMMIT,
    target: TARGET,
    operatorIdentity,
    beforeCandidateState: candidateState(),
    afterCandidateState: candidateState(),
    projectorLeases: leases(),
    runtimeLoginFence: loginFence(),
    caSha256: sha256(Buffer.from(CA)),
    postgresToolchain: TOOLCHAIN_EVIDENCE,
    backupResult: { evidence: rawEvidence },
    currentManifest: manifest(),
    createdAt: rawEvidence.createdAt,
  });
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "candidate-restore-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binaryDirectory = path.join(directory, "bin");
  await mkdir(binaryDirectory, { recursive: true });
  const snapshotBackupPath = path.join(directory, "snapshot.dump");
  const safetyBackupPath = path.join(directory, "safety.dump");
  const safetyArchive = Buffer.from("fresh-current-candidate-safety-archive");
  const paths = {
    pg_dump: path.join(binaryDirectory, "pg_dump"),
    pg_restore: path.join(binaryDirectory, "pg_restore"),
    psql: path.join(binaryDirectory, "psql"),
  };
  await Promise.all([
    writeFile(snapshotBackupPath, "pinned-snapshot-placeholder", { mode: 0o600 }),
    writeFile(safetyBackupPath, safetyArchive, { mode: 0o600 }),
    ...Object.values(paths).map((filePath) =>
      writeFile(filePath, "mock-postgres-17.10", { mode: 0o700 }),
    ),
  ]);
  await Promise.all(Object.values(paths).map((filePath) => chmod(filePath, 0o700)));
  const safetyRawEvidence = rawSafetyEvidence(safetyArchive);
  const safetyEvidence = buildSafetyEvidence(safetyRawEvidence);
  const toolchain = Object.freeze({
    paths: Object.freeze(paths),
    binaryDirectory,
    runtimeDirectory: path.join(directory, "lib"),
    evidence: TOOLCHAIN_EVIDENCE,
  });
  return {
    directory,
    snapshotBackupPath,
    safetyBackupPath,
    paths,
    safetyArchive,
    safetyRawEvidence,
    safetyEvidence,
    toolchain,
  };
}

function commitmentDependency(files, drift = {}) {
  return async (filePath) => {
    if (path.basename(filePath) === path.basename(files.snapshotBackupPath)) {
      return drift.snapshot
        ? { bytes: 1, sha256: `0x${"9".repeat(64)}` }
        : {
            bytes: PINNED_PRE_ATTESTATION_SNAPSHOT.bytes,
            sha256: PINNED_PRE_ATTESTATION_SNAPSHOT.sha256,
          };
    }
    if (path.basename(filePath) === path.basename(files.safetyBackupPath)) {
      return drift.safety
        ? { bytes: 1, sha256: `0x${"9".repeat(64)}` }
        : {
            bytes: files.safetyRawEvidence.backup.bytes,
            sha256: files.safetyRawEvidence.backup.sha256,
          };
    }
    throw new Error(`unexpected commitment path: ${filePath}`);
  };
}

function toolchainDependency(files) {
  return async (input) => {
    assert.equal(input.pgDumpBinary, files.paths.pg_dump);
    assert.equal(input.pgRestoreBinary, files.paths.pg_restore);
    assert.equal(input.psqlBinary, files.paths.psql);
    return files.toolchain;
  };
}

function safeToolDependency(calls, hook = () => {}) {
  return async (input) => {
    calls.push(input);
    hook(input, calls.length);
    assert.equal(input.binary.endsWith("/pg_restore"), true);
    assert.deepEqual(
      input.expectedBinary,
      OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_restore,
    );
    assert.equal(
      input.expectedRuntimeSha256,
      OFFICIAL_POSTGRES_17_TOOLCHAIN.runtimeLibrariesSha256,
    );
    assert.equal(input.environment.PATH, undefined);
    if (input.args.includes("--clean")) {
      return {
        stdout: Buffer.from(
          "DROP SCHEMA IF EXISTS programmable_private;\n",
        ),
        stderr: Buffer.alloc(0),
      };
    }
    if (
      input.args.includes("--schema-only") &&
      !input.args.includes("--no-owner")
    ) {
      const wakeOwner =
        path.basename(input.args.at(-1) ?? "") === "safety.dump"
          ? "ALTER SCHEMA programmable_wake_private OWNER TO programmable_migrator;\n"
          : "";
      return {
        stdout: Buffer.from(
          "ALTER SCHEMA programmable_private OWNER TO programmable_migrator;\n" +
            "ALTER SCHEMA programmable_release_probe_private OWNER TO programmable_migrator;\n" +
            wakeOwner +
            "ALTER SCHEMA supabase_migrations OWNER TO postgres;\n" +
            "GRANT USAGE ON SCHEMA programmable_private TO programmable_api_reader;\n",
        ),
        stderr: Buffer.alloc(0),
      };
    }
    return {
      stdout:
        path.basename(input.args.at(-1) ?? "") === "safety.dump"
          ? SAFETY_ARCHIVE_LIST
          : ARCHIVE_LIST,
      stderr: Buffer.alloc(0),
    };
  };
}

async function createPlan(files, overrides = {}) {
  const safeCalls = [];
  const plan = await createCandidateRestorePlan({
    repositoryCommit: OPERATOR_COMMIT,
    currentProductCommit: CURRENT_PRODUCT_COMMIT,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    sslCaPem: CA,
    snapshotRepositoryCommit:
      PINNED_PRE_ATTESTATION_SNAPSHOT.repositoryCommit,
    snapshotBackupPath: files.snapshotBackupPath,
    snapshotEvidence: PINNED_SNAPSHOT_EVIDENCE,
    safetyBackupPath: files.safetyBackupPath,
    safetyBackupEvidence: files.safetyRawEvidence,
    safetyEvidence: files.safetyEvidence,
    pgDumpBinary: files.paths.pg_dump,
    pgRestoreBinary: files.paths.pg_restore,
    psqlBinary: files.paths.psql,
    now: new Date("2026-08-02T09:10:00.000Z"),
    secrets: [PASSWORD, DATABASE_URL, CA],
    dependencies: {
      validateOfficialToolchain: toolchainDependency(files),
      fileCommitment: commitmentDependency(files),
      safeToolCall: safeToolDependency(safeCalls),
      schemaSqlSha256: () =>
        PINNED_PRE_ATTESTATION_SNAPSHOT.schemaSqlSha256,
      prepareRestoreClosures: async () => ({
        cleanup: {
          sql: "unit cleanup\n",
          statementCount:
            PINNED_PRE_ATTESTATION_SNAPSHOT.cleanClosureStatementCount,
        },
        owners: {
          sql: "unit owners\n",
          statementCount:
            PINNED_PRE_ATTESTATION_SNAPSHOT.ownerClosureStatementCount,
        },
        security: {
          sql: "unit security\n",
          statementCount:
            PINNED_PRE_ATTESTATION_SNAPSHOT.securityClosureStatementCount,
        },
      }),
    },
    ...overrides,
  });
  return { plan, safeCalls };
}

function migrationPlan() {
  const migrations = [
    {
      ordinal: 1,
      version: "20260802000000",
      name: "candidate_restore_fix",
      file: "supabase/migrations/20260802000000_candidate_restore_fix.sql",
      fileSha256: `0x${"4".repeat(64)}`,
      bytes: 123,
    },
  ];
  const orderSha256 = sha256(
    [
      "1",
      "20260802000000",
      "candidate_restore_fix",
      "supabase/migrations/20260802000000_candidate_restore_fix.sql",
      `0x${"4".repeat(64)}`,
      "123",
    ].join("\0"),
  );
  const payload = {
    kind: "programmable-hosted-db-migration-plan",
    schemaVersion: 1,
    repositoryCommit: OPERATOR_COMMIT,
    migrationRoot: "supabase/migrations",
    migrationCount: 1,
    orderSha256,
    migrations,
  };
  return {
    ...payload,
    planSha256: sha256(canonicalJson(payload)),
  };
}

function rolePosture(loginEnabled) {
  const flags = (rolname, rolcanlogin, hasPassword) => ({
    rolname,
    rolcanlogin,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: false,
    rolreplication: false,
    rolbypassrls: false,
    rolconnlimit: -1,
    rolconfig: null,
    has_password: hasPassword,
  });
  return {
    rows: ROLE_SPECS.flatMap(({ loginRole, capabilityRole }) => [
      flags(loginRole, loginEnabled, loginEnabled),
      flags(capabilityRole, false, false),
    ]),
    memberships: ROLE_SPECS.map(({ loginRole, capabilityRole }) => ({
      member_role: loginRole,
      granted_role: capabilityRole,
      admin_option: false,
      inherit_option: false,
      set_option: true,
    })),
  };
}

function credentials() {
  return Object.fromEntries(
    ROLE_SPECS.map(({ key }, index) => [
      key,
      `candidate-runtime-${index}-${"x".repeat(40)}`,
    ]),
  );
}

function databaseDependencies(overrides = {}) {
  return {
    openHostedDatabase: async () => ({
      sql: {},
      target: TARGET,
      operatorIdentity: OPERATOR_IDENTITY,
    }),
    closeHostedDatabase: async () => {},
    acquireRestoreLock: async () => {},
    assertOperatorSession: async () => {},
    inspectProjectorLeaseDrain: async () => leases(),
    fenceRuntimeLogins: async () => loginFence(),
    assertRuntimeLoginsFenced: async () => loginFence(),
    ...overrides,
  };
}

function restoreDatabaseDependencies(overrides = {}, { recovery = false } = {}) {
  const wakeOwner = recovery
    ? "ALTER SCHEMA programmable_wake_private OWNER TO programmable_migrator;\n"
    : "";
  const closures = Object.freeze({
    cleanup: Object.freeze({
      sql: "DROP SCHEMA IF EXISTS programmable_private;\n",
      statementCount: 1,
    }),
    owners: Object.freeze({
      sql:
        "ALTER SCHEMA programmable_private OWNER TO programmable_migrator;\n" +
        "ALTER SCHEMA programmable_release_probe_private OWNER TO programmable_migrator;\n" +
        wakeOwner +
        "ALTER SCHEMA supabase_migrations OWNER TO postgres;\n",
      statementCount: recovery ? 4 : 3,
    }),
    security: Object.freeze({
      sql: "GRANT USAGE ON SCHEMA programmable_private TO programmable_api_reader;\n",
      statementCount: 1,
    }),
  });
  const dependencies = {
    ...databaseDependencies(),
    cleanupCandidateSchemas: async () => {},
    applyOwnerAndSecurityClosure: async () => {},
    assertCandidateSchemaStage: async () => {},
    ...overrides,
  };
  dependencies[
    recovery ? "prepareSafetyRestoreClosures" : "prepareRestoreClosures"
  ] = async () => closures;
  return dependencies;
}

test("pinned pre-attestation evidence is exact and rejects every mutation", () => {
  assert.deepEqual(PINNED_PRE_ATTESTATION_SNAPSHOT, {
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
    portableStructuralManifestSha256:
      "0x0b95ed1e28d2684aa920be5058c7815b604986a611f67d7900c42d181875e80b",
  });
  assert.equal(PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE.length, 29);
  assert.deepEqual(
    PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE.map(({ ordinal }) => ordinal),
    Array.from({ length: 29 }, (_unused, index) => index + 1),
  );
  assert.equal(
    sha256(canonicalJson(PINNED_BASELINE_MIGRATION_SOURCE_CLOSURE)),
    PINNED_PRE_ATTESTATION_SNAPSHOT.migrationSourceClosureSha256,
  );
  assert.equal(
    sha256(canonicalJson(PINNED_SNAPSHOT_EVIDENCE)),
    PINNED_PRE_ATTESTATION_SNAPSHOT.evidenceSha256,
  );
  assert.equal(
    sha256(ARCHIVE_LIST),
    PINNED_PRE_ATTESTATION_SNAPSHOT.archiveListSha256,
  );
  assert.equal(
    validatePinnedSnapshotEvidence(PINNED_SNAPSHOT_EVIDENCE),
    PINNED_SNAPSHOT_EVIDENCE,
  );
  for (const mutation of [
    (value) => {
      value.repositoryCommit = OPERATOR_COMMIT;
    },
    (value) => {
      value.backup.bytes += 1;
    },
    (value) => {
      value.backup.sha256 = `0x${"8".repeat(64)}`;
    },
    (value) => {
      value.backup.archiveListSha256 = `0x${"8".repeat(64)}`;
    },
    (value) => {
      value.sourceManifestSha256 = `0x${"8".repeat(64)}`;
      value.restoredManifestSha256 = value.sourceManifestSha256;
    },
  ]) {
    const changed = structuredClone(PINNED_SNAPSHOT_EVIDENCE);
    mutation(changed);
    assert.throws(
      () => validatePinnedSnapshotEvidence(changed),
      /pinned release artifact|restorable Candidate snapshot/u,
    );
  }
});

test("restore plan binds CA, raw safety evidence, three tools, schemas and flags", async (t) => {
  const files = await fixture(t);
  const { plan, safeCalls } = await createPlan(files);
  assert.deepEqual(plan.target, TARGET);
  assert.deepEqual(plan.operatorIdentity, OPERATOR_IDENTITY);
  assert.equal(plan.caSha256, sha256(Buffer.from(CA)));
  assert.equal(canonicalJson(plan).includes(CA), false);
  assert.equal(plan.snapshot.evidenceSha256, PINNED_PRE_ATTESTATION_SNAPSHOT.evidenceSha256);
  assert.equal(
    plan.safetyBackup.evidenceSha256,
    sha256(canonicalJson(files.safetyRawEvidence)),
  );
  assert.equal(
    plan.safetyBackup.structuralManifestSha256,
    SAFETY_STRUCTURAL_MANIFEST,
  );
  assert.equal(
    plan.safetyBackup.portableStructuralManifestSha256,
    SAFETY_PORTABLE_STRUCTURAL_MANIFEST,
  );
  assert.equal(
    plan.postRestore.portableStructuralManifestSha256,
    RESTORED_PORTABLE_STRUCTURAL_MANIFEST,
  );
  assert.deepEqual(plan.postgresToolchain, TOOLCHAIN_EVIDENCE);
  assert.deepEqual(plan.restore.schemas, CANDIDATE_RESTORE_SCHEMAS);
  assert.deepEqual(plan.restore.flags, CANDIDATE_RESTORE_FLAGS);
  assert.equal(plan.restore.runtimeLoginsRemainFenced, true);
  assert.equal(safeCalls.length, 3);
  assert.deepEqual(
    safeCalls.map(({ args }) => args[0]),
    ["--list", "--list", "--schema-only"],
  );
  assert.equal(canonicalJson(plan).includes(PASSWORD), false);
  assert.equal(canonicalJson(plan).includes(DATABASE_URL), false);
  for (const call of safeCalls) {
    assert.equal(
      call.args.includes(`--restrict-key=${CANDIDATE_PG_RESTRICT_KEY}`),
      true,
    );
  }
});

test("official PG17 emits byte-identical pinned schema SQL with restrict key", async (t) => {
  const pgRestore =
    "/private/tmp/programmable-pg17-client-arm64-20260802/runtime/pgsql/bin/pg_restore";
  const archive =
    "/private/tmp/programmable-read-model-release-20260802.88cd707.Xd5PRm/pre-attestation-88cd707.dump";
  try {
    await Promise.all([access(pgRestore), access(archive)]);
  } catch {
    t.skip("portable PG17 release fixture is not present");
    return;
  }
  const args = [
    "--schema-only",
    "--no-owner",
    "--no-privileges",
    `--restrict-key=${CANDIDATE_PG_RESTRICT_KEY}`,
    "--file=-",
    archive,
  ];
  const run = () =>
    executeFile(pgRestore, args, {
      encoding: "buffer",
      env: { LANG: "C", LC_ALL: "C" },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60_000,
    });
  const [first, second] = await Promise.all([run(), run()]);
  assert.deepEqual(first.stdout, second.stdout);
  assert.equal(
    sha256(first.stdout),
    PINNED_PRE_ATTESTATION_SNAPSHOT.schemaSqlSha256,
  );
});

test("official PG17 toolchain executes from a private verified runtime copy", async (t) => {
  const root =
    "/private/tmp/programmable-pg17-client-arm64-20260802/runtime/pgsql/bin";
  const paths = {
    pg_dump: path.join(root, "pg_dump"),
    pg_restore: path.join(root, "pg_restore"),
    psql: path.join(root, "psql"),
  };
  try {
    await Promise.all(Object.values(paths).map((filePath) => access(filePath)));
  } catch {
    t.skip("portable PG17 release fixture is not present");
    return;
  }
  const inspected = await validateOfficialToolchain({
    pgDumpBinary: paths.pg_dump,
    pgRestoreBinary: paths.pg_restore,
    psqlBinary: paths.psql,
    secrets: [],
  });
  const copied = await materializeOfficialToolchain(inspected);
  t.after(() => rm(copied.cleanupDirectory, { recursive: true, force: true }));
  assert.notEqual(path.dirname(copied.paths.pg_restore), root);
  const version = await executeFile(copied.paths.pg_restore, ["--version"], {
    encoding: "utf8",
    env: { LANG: "C", LC_ALL: "C" },
    timeout: 15_000,
  });
  assert.match(version.stdout, /pg_restore \(PostgreSQL\) 17\.10/u);
});

test("restore plan admits only the exact Supabase CLI JIT identity", async (t) => {
  const files = await fixture(t);
  const jitIdentity = Object.freeze({
    mode: "supabase-cli-jit-set-role",
    sessionUser: "cli_login_postgres",
    effectiveRole: "postgres",
  });
  const jitUrl = DATABASE_URL.replace(
    "postgres:",
    "cli_login_postgres:",
  );
  const { plan } = await createPlan(files, {
    databaseUrl: jitUrl,
    safetyEvidence: buildSafetyEvidence(files.safetyRawEvidence, jitIdentity),
  });
  assert.deepEqual(plan.operatorIdentity, jitIdentity);
  assert.equal(canonicalJson(plan).includes(PASSWORD), false);
  await assert.rejects(
    createPlan(files, {
      databaseUrl: DATABASE_URL.replace("postgres:", "cli_login_postgres_2:"),
    }),
    /target is not exact/u,
  );
});

test("restore plan fails closed on CA or raw safety evidence drift", async (t) => {
  const files = await fixture(t);
  await assert.rejects(
    createPlan(files, {
      sslCaPem: ALT_CA,
    }),
    /CA differs/u,
  );
  const changedRaw = structuredClone(files.safetyRawEvidence);
  changedRaw.sourceStructuralManifestSha256 = `0x${"6".repeat(64)}`;
  changedRaw.restoredStructuralManifestSha256 =
    changedRaw.sourceStructuralManifestSha256;
  await assert.rejects(
    createPlan(files, { safetyBackupEvidence: changedRaw }),
    /raw Candidate safety backup evidence does not match/u,
  );
  await assert.rejects(
    createPlan(files, {
      snapshotEvidence: {
        ...PINNED_SNAPSHOT_EVIDENCE,
        operationId: "arbitrary-caller-snapshot",
      },
    }),
    /pinned release artifact/u,
  );
});

test("plan rechecks files after tool calls and binds immediate tool commitments", async (t) => {
  const files = await fixture(t);
  const drift = { snapshot: false, safety: false };
  const calls = [];
  await assert.rejects(
    createCandidateRestorePlan({
      repositoryCommit: OPERATOR_COMMIT,
      currentProductCommit: CURRENT_PRODUCT_COMMIT,
      expectedProjectRef: CANDIDATE_PROJECT_REF,
      databaseUrl: DATABASE_URL,
      sslCaPem: CA,
      snapshotRepositoryCommit:
        PINNED_PRE_ATTESTATION_SNAPSHOT.repositoryCommit,
      snapshotBackupPath: files.snapshotBackupPath,
      snapshotEvidence: PINNED_SNAPSHOT_EVIDENCE,
      safetyBackupPath: files.safetyBackupPath,
      safetyBackupEvidence: files.safetyRawEvidence,
      safetyEvidence: files.safetyEvidence,
      pgDumpBinary: files.paths.pg_dump,
      pgRestoreBinary: files.paths.pg_restore,
      psqlBinary: files.paths.psql,
      now: new Date("2026-08-02T09:10:00.000Z"),
      dependencies: {
        validateOfficialToolchain: toolchainDependency(files),
        fileCommitment: commitmentDependency(files, drift),
        safeToolCall: safeToolDependency(calls, (_input, ordinal) => {
          if (ordinal === 1) drift.snapshot = true;
        }),
        schemaSqlSha256: () =>
          PINNED_PRE_ATTESTATION_SNAPSHOT.schemaSqlSha256,
      },
    }),
    /snapshot backup bytes or checksum changed/u,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].expectedBinary,
    OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries.pg_restore,
  );
});

test("safety backup binds structural manifest, CA and exact official toolchain", async (t) => {
  const files = await fixture(t);
  const events = [];
  let stateReads = 0;
  let sessionChecks = 0;
  let scheduledHeartbeat;
  const heartbeatTimer = { unref: () => events.push("heartbeat-unref") };
  const evidence = await createCandidateSafetyBackup({
    repositoryCommit: OPERATOR_COMMIT,
    currentProductCommit: CURRENT_PRODUCT_COMMIT,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    sslCaPem: CA,
    operationId: "candidate-safety-01",
    restoreDatabaseUrl:
      "postgresql://postgres:isolated@127.0.0.1:55439/programmable_restore_cutover01?sslmode=verify-full",
    restoreIsolationId: "cutover01",
    restoreSslCaPem: CA,
    backupPath: files.safetyBackupPath,
    backupEvidencePath: path.join(files.directory, "safety.json"),
    pgDumpBinary: files.paths.pg_dump,
    pgRestoreBinary: files.paths.pg_restore,
    psqlBinary: files.paths.psql,
    dependencies: {
      validateOfficialToolchain: toolchainDependency(files),
      openHostedDatabase: async () => ({
        sql: {},
        target: TARGET,
        operatorIdentity: OPERATOR_IDENTITY,
      }),
      closeHostedDatabase: async () => events.push("close"),
      acquireRestoreLock: async () => events.push("lock"),
      assertOperatorSession: async () => {
        sessionChecks += 1;
      },
      scheduleHeartbeat: (heartbeat, interval) => {
        assert.equal(interval, 15_000);
        events.push("heartbeat-scheduled");
        scheduledHeartbeat = heartbeat;
        return heartbeatTimer;
      },
      cancelHeartbeat: (timer) => {
        assert.equal(timer, heartbeatTimer);
        events.push("heartbeat-cancelled");
      },
      inspectCandidateDatabase: async () => {
        stateReads += 1;
        return candidateState();
      },
      inspectProjectorLeaseDrain: async () => leases(),
      fenceRuntimeLogins: async () => {
        events.push("fence");
        return loginFence();
      },
      assertRuntimeLoginsFenced: async () => loginFence(),
      createBackupAndRestoreEvidence: async (input) => {
        events.push("backup");
        scheduledHeartbeat();
        await Promise.resolve();
        assert.equal(input.pgDumpBinary, files.paths.pg_dump);
        assert.equal(input.pgRestoreBinary, files.paths.pg_restore);
        assert.equal(input.psqlBinary, files.paths.psql);
        assert.deepEqual(input.toolCommitments, OFFICIAL_POSTGRES_17_TOOLCHAIN.binaries);
        assert.deepEqual(input.allowedSourceUsernames, [
          "postgres",
          "cli_login_postgres",
        ]);
        assert.deepEqual(input.schemas, FINAL_BACKUP_SCHEMAS);
        assert.equal(typeof input.dependencies.runCommand, "function");
        assert.equal(typeof input.dependencies.openHostedDatabase, "function");
        return { evidence: files.safetyRawEvidence };
      },
      captureDatabaseManifest: async (_sql, options) => {
        assert.deepEqual(options, { schemas: FINAL_BACKUP_SCHEMAS });
        return manifest();
      },
    },
  });
  assert.equal(stateReads, 2);
  assert.equal(sessionChecks, 3);
  assert.deepEqual(events, [
    "lock",
    "fence",
    "heartbeat-scheduled",
    "heartbeat-unref",
    "backup",
    "heartbeat-cancelled",
    "close",
  ]);
  assert.equal(evidence.caSha256, sha256(Buffer.from(CA)));
  assert.deepEqual(evidence.operatorIdentity, OPERATOR_IDENTITY);
  assert.deepEqual(evidence.postgresToolchain, TOOLCHAIN_EVIDENCE);
  assert.equal(
    evidence.backup.structuralManifestSha256,
    SAFETY_STRUCTURAL_MANIFEST,
  );
  assert.equal(
    evidence.backup.portableStructuralManifestSha256,
    SAFETY_PORTABLE_STRUCTURAL_MANIFEST,
  );
  assert.equal(
    validateCandidateSafetyBackupEvidence(evidence, {
      operatorCommit: OPERATOR_COMMIT,
      currentProductCommit: CURRENT_PRODUCT_COMMIT,
      now: new Date("2026-08-02T09:10:00.000Z"),
    }),
    evidence,
  );
  const withoutPortable = structuredClone(files.safetyRawEvidence);
  delete withoutPortable.sourcePortableStructuralManifestSha256;
  delete withoutPortable.restoredPortableStructuralManifestSha256;
  assert.throws(
    () => buildSafetyEvidence(withoutPortable),
    /portable structure/u,
  );
  const driftedPortable = structuredClone(files.safetyRawEvidence);
  driftedPortable.sourcePortableStructuralManifestSha256 = `0x${"7".repeat(64)}`;
  driftedPortable.restoredPortableStructuralManifestSha256 =
    driftedPortable.sourcePortableStructuralManifestSha256;
  assert.throws(
    () => buildSafetyEvidence(driftedPortable),
    /portable structure/u,
  );
});

test("safety backup fails closed when its operator-session heartbeat is lost", async (t) => {
  const files = await fixture(t);
  let scheduledHeartbeat;
  let sessionChecks = 0;
  let cancelled = 0;
  let closed = 0;
  await assert.rejects(
    createCandidateSafetyBackup({
      repositoryCommit: OPERATOR_COMMIT,
      currentProductCommit: CURRENT_PRODUCT_COMMIT,
      expectedProjectRef: CANDIDATE_PROJECT_REF,
      databaseUrl: DATABASE_URL,
      sslCaPem: CA,
      operationId: "candidate-safety-heartbeat-loss",
      restoreDatabaseUrl:
        "postgresql://postgres:isolated@127.0.0.1:55439/programmable_restore_cutover01?sslmode=verify-full",
      restoreIsolationId: "cutover01",
      restoreSslCaPem: CA,
      backupPath: files.safetyBackupPath,
      backupEvidencePath: path.join(files.directory, "safety-heartbeat.json"),
      pgDumpBinary: files.paths.pg_dump,
      pgRestoreBinary: files.paths.pg_restore,
      psqlBinary: files.paths.psql,
      dependencies: {
        validateOfficialToolchain: toolchainDependency(files),
        openHostedDatabase: async () => ({
          sql: {},
          target: TARGET,
          operatorIdentity: OPERATOR_IDENTITY,
        }),
        closeHostedDatabase: async () => {
          closed += 1;
        },
        acquireRestoreLock: async () => {},
        assertOperatorSession: async () => {
          sessionChecks += 1;
          if (sessionChecks === 2) throw new Error("operator session lost");
        },
        scheduleHeartbeat: (heartbeat) => {
          scheduledHeartbeat = heartbeat;
          return {};
        },
        cancelHeartbeat: () => {
          cancelled += 1;
        },
        inspectCandidateDatabase: async () => candidateState(),
        inspectProjectorLeaseDrain: async () => leases(),
        fenceRuntimeLogins: async () => loginFence(),
        assertRuntimeLoginsFenced: async () => loginFence(),
        createBackupAndRestoreEvidence: async () => {
          scheduledHeartbeat();
          await Promise.resolve();
          return { evidence: files.safetyRawEvidence };
        },
        captureDatabaseManifest: async () => manifest(),
      },
    }),
    /Candidate safety backup failed; runtime logins may remain fenced/u,
  );
  assert.equal(sessionChecks, 2);
  assert.equal(cancelled, 1);
  assert.equal(closed, 1);
});

test("restore apply resumes postchecks without replaying pg_restore", async (t) => {
  const files = await fixture(t);
  const { plan } = await createPlan(files);
  let stateReads = 0;
  let manifestReads = 0;
  const manifestScopes = [];
  let fences = 0;
  const result = await applyCandidateRestore({
    plan,
    confirmRestore: plan.confirmRestore,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    sslCaPem: CA,
    snapshotBackupPath: files.snapshotBackupPath,
    safetyBackupPath: files.safetyBackupPath,
    safetyBackupEvidence: files.safetyRawEvidence,
    safetyEvidence: files.safetyEvidence,
    pgDumpBinary: files.paths.pg_dump,
    pgRestoreBinary: files.paths.pg_restore,
    psqlBinary: files.paths.psql,
    now: new Date("2026-08-02T09:12:00.000Z"),
    dependencies: {
      ...restoreDatabaseDependencies({
        inspectCandidateDatabase: async () => {
          stateReads += 1;
          return restoredState();
        },
        fenceRuntimeLogins: async () => {
          fences += 1;
          return loginFence();
        },
        captureDatabaseManifest: async (_sql, options) => {
          manifestScopes.push(options);
          manifestReads += 1;
          return manifest({ restored: true });
        },
      }),
      validateOfficialToolchain: toolchainDependency(files),
      fileCommitment: commitmentDependency(files),
      safeToolCall: async () => {
        throw new Error("pg_restore must not run during resume");
      },
      migrationCount: async () => 29,
    },
  });
  assert.equal(result.executionMode, "resumed-post-restore-verification");
  assert.equal(result.runtimeLoginFence.remainsFenced, true);
  assert.equal(
    result.snapshot.structuralManifestSha256,
    HOSTED_RESTORED_STRUCTURAL_MANIFEST,
  );
  assert.equal(
    result.snapshot.portableStructuralManifestSha256,
    RESTORED_PORTABLE_STRUCTURAL_MANIFEST,
  );
  assert.equal(validateCandidateRestoreResult(result), result);
  assert.equal(stateReads, 2);
  assert.equal(manifestReads, 3);
  assert.deepEqual(manifestScopes, [undefined, undefined, undefined]);
  assert.equal(fences, 1);
});

test("JIT restore SET ROLEs postgres and uses only the immutable restore set", async (t) => {
  const files = await fixture(t);
  const jitIdentity = Object.freeze({
    mode: "supabase-cli-jit-set-role",
    sessionUser: "cli_login_postgres",
    effectiveRole: "postgres",
  });
  const jitUrl = DATABASE_URL.replace("postgres:", "cli_login_postgres:");
  const jitSafety = buildSafetyEvidence(files.safetyRawEvidence, jitIdentity);
  const { plan } = await createPlan(files, {
    databaseUrl: jitUrl,
    safetyEvidence: jitSafety,
  });
  let stateReads = 0;
  let manifestReads = 0;
  const manifestScopes = [];
  const restoreCalls = [];
  const destructiveEvents = [];
  const result = await applyCandidateRestore({
    plan,
    confirmRestore: plan.confirmRestore,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: jitUrl,
    sslCaPem: CA,
    snapshotBackupPath: files.snapshotBackupPath,
    safetyBackupPath: files.safetyBackupPath,
    safetyBackupEvidence: files.safetyRawEvidence,
    safetyEvidence: jitSafety,
    pgDumpBinary: files.paths.pg_dump,
    pgRestoreBinary: files.paths.pg_restore,
    psqlBinary: files.paths.psql,
    now: new Date("2026-08-02T09:12:00.000Z"),
    dependencies: {
      ...restoreDatabaseDependencies({
        openHostedDatabase: async () => ({
          sql: {},
          target: TARGET,
          operatorIdentity: jitIdentity,
        }),
        inspectCandidateDatabase: async () => {
          stateReads += 1;
          return stateReads === 1 ? candidateState() : restoredState();
        },
        captureDatabaseManifest: async (_sql, options) => {
          manifestScopes.push(options);
          manifestReads += 1;
          return manifestReads === 1 ? manifest() : manifest({ restored: true });
        },
        cleanupCandidateSchemas: async (
          _sql,
          _cleanup,
          posture,
          options,
        ) => {
          assert.equal(posture, undefined);
          assert.equal(options, undefined);
          destructiveEvents.push("cleanup");
        },
        applyOwnerAndSecurityClosure: async () => {
          destructiveEvents.push("owner-security");
        },
      }),
      validateOfficialToolchain: toolchainDependency(files),
      fileCommitment: commitmentDependency(files),
      revalidateToolchain: async () => {},
      safeToolCall: async (input) => {
        destructiveEvents.push("restore");
        restoreCalls.push(input);
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
      migrationCount: async () => 29,
    },
  });
  assert.equal(result.executionMode, "restored-from-pinned-snapshot");
  assert.equal(restoreCalls.length, 1);
  const args = restoreCalls[0].args;
  for (const flag of CANDIDATE_RESTORE_FLAGS) assert.equal(args.includes(flag), true);
  assert.equal(args.includes("--schema"), false);
  assert.equal(args.includes("--restrict-key"), false);
  assert.deepEqual(
    args.slice(args.indexOf("--username"), args.indexOf("--dbname")),
    ["--username", "cli_login_postgres"],
  );
  assert.equal(args.includes("--role"), true);
  assert.equal(args[args.indexOf("--role") + 1], "postgres");
  assert.equal(args.includes("--disable-triggers"), false);
  assert.deepEqual(destructiveEvents, ["cleanup", "restore", "owner-security"]);
  assert.deepEqual(manifestScopes, [
    { schemas: FINAL_BACKUP_SCHEMAS },
    undefined,
    undefined,
  ]);
});

test("restore apply rejects a changed CA before opening Candidate", async (t) => {
  const files = await fixture(t);
  const { plan } = await createPlan(files);
  let opened = false;
  await assert.rejects(
    applyCandidateRestore({
      plan,
      confirmRestore: plan.confirmRestore,
      expectedProjectRef: CANDIDATE_PROJECT_REF,
      databaseUrl: DATABASE_URL,
      sslCaPem: ALT_CA,
      safetyBackupEvidence: files.safetyRawEvidence,
      safetyEvidence: files.safetyEvidence,
      dependencies: {
        openHostedDatabase: async () => {
          opened = true;
        },
      },
    }),
    /CA differs/u,
  );
  assert.equal(opened, false);
});

test("safety recovery plan binds raw evidence, CA, tools and immutable restore set", async (t) => {
  const files = await fixture(t);
  const calls = [];
  const plan = await createCandidateSafetyRecoveryPlan({
    repositoryCommit: OPERATOR_COMMIT,
    currentProductCommit: CURRENT_PRODUCT_COMMIT,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    sslCaPem: CA,
    safetyBackupPath: files.safetyBackupPath,
    safetyBackupEvidence: files.safetyRawEvidence,
    safetyEvidence: files.safetyEvidence,
    pgDumpBinary: files.paths.pg_dump,
    pgRestoreBinary: files.paths.pg_restore,
    psqlBinary: files.paths.psql,
    dependencies: {
      validateOfficialToolchain: toolchainDependency(files),
      fileCommitment: commitmentDependency(files),
      safeToolCall: safeToolDependency(calls),
    },
  });
  assert.equal(plan.caSha256, sha256(Buffer.from(CA)));
  assert.deepEqual(plan.operatorIdentity, OPERATOR_IDENTITY);
  assert.equal(
    plan.safetyBackup.evidenceSha256,
    sha256(canonicalJson(files.safetyRawEvidence)),
  );
  assert.equal(plan.postRestore.structuralManifestSha256, SAFETY_STRUCTURAL_MANIFEST);
  assert.equal(
    plan.postRestore.portableStructuralManifestSha256,
    SAFETY_PORTABLE_STRUCTURAL_MANIFEST,
  );
  assert.deepEqual(plan.postgresToolchain, TOOLCHAIN_EVIDENCE);
  assert.deepEqual(plan.restore.schemas, CANDIDATE_FINAL_SCHEMAS);
  assert.deepEqual(plan.restore.flags, CANDIDATE_SAFETY_RECOVERY_FLAGS);
  assert.equal(plan.restore.runtimeLoginsRemainFenced, true);
  assert.equal(calls.length, 3);
  files.recoveryPlan = plan;
});

test("safety recovery apply is idempotent and never opens runtime logins", async (t) => {
  const files = await fixture(t);
  const calls = [];
  const plan = await createCandidateSafetyRecoveryPlan({
    repositoryCommit: OPERATOR_COMMIT,
    currentProductCommit: CURRENT_PRODUCT_COMMIT,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    sslCaPem: CA,
    safetyBackupPath: files.safetyBackupPath,
    safetyBackupEvidence: files.safetyRawEvidence,
    safetyEvidence: files.safetyEvidence,
    pgDumpBinary: files.paths.pg_dump,
    pgRestoreBinary: files.paths.pg_restore,
    psqlBinary: files.paths.psql,
    dependencies: {
      validateOfficialToolchain: toolchainDependency(files),
      fileCommitment: commitmentDependency(files),
      safeToolCall: safeToolDependency(calls),
    },
  });
  let fences = 0;
  const result = await applyCandidateSafetyRecovery({
    plan,
    confirmRecovery: plan.confirmRecovery,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    sslCaPem: CA,
    safetyBackupPath: files.safetyBackupPath,
    safetyBackupEvidence: files.safetyRawEvidence,
    safetyEvidence: files.safetyEvidence,
    pgDumpBinary: files.paths.pg_dump,
    pgRestoreBinary: files.paths.pg_restore,
    psqlBinary: files.paths.psql,
    now: new Date("2026-08-02T09:15:00.000Z"),
    dependencies: {
      ...restoreDatabaseDependencies({
        inspectCandidateDatabase: async () => candidateState(),
        fenceRuntimeLogins: async () => {
          fences += 1;
          return loginFence();
        },
        captureDatabaseManifest: async (_sql, options) => {
          assert.deepEqual(options, { schemas: FINAL_BACKUP_SCHEMAS });
          return {
            ...manifest(),
            structuralManifestSha256: `0x${"8".repeat(64)}`,
          };
        },
      }, { recovery: true }),
      validateOfficialToolchain: toolchainDependency(files),
      fileCommitment: commitmentDependency(files),
      safeToolCall: async () => {
        throw new Error("pg_restore must not run when already recovered");
      },
    },
  });
  assert.equal(result.executionMode, "already-recovered");
  assert.equal(result.manifest.structuralManifestSha256, `0x${"8".repeat(64)}`);
  assert.equal(
    result.manifest.portableStructuralManifestSha256,
    SAFETY_PORTABLE_STRUCTURAL_MANIFEST,
  );
  assert.equal(result.runtimeLoginFence.remainsFenced, true);
  assert.equal(fences, 1);
  assert.match(result.evidenceSha256, /^0x[0-9a-f]{64}$/u);
});

test("safety recovery orders cleanup, archive restore and exact owner replay", async (t) => {
  const files = await fixture(t);
  const plan = await createCandidateSafetyRecoveryPlan({
    repositoryCommit: OPERATOR_COMMIT,
    currentProductCommit: CURRENT_PRODUCT_COMMIT,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    sslCaPem: CA,
    safetyBackupPath: files.safetyBackupPath,
    safetyBackupEvidence: files.safetyRawEvidence,
    safetyEvidence: files.safetyEvidence,
    pgDumpBinary: files.paths.pg_dump,
    pgRestoreBinary: files.paths.pg_restore,
    psqlBinary: files.paths.psql,
    dependencies: {
      validateOfficialToolchain: toolchainDependency(files),
      fileCommitment: commitmentDependency(files),
      safeToolCall: safeToolDependency([]),
    },
  });
  const destructiveEvents = [];
  let stateReads = 0;
  let manifestReads = 0;
  const result = await applyCandidateSafetyRecovery({
    plan,
    confirmRecovery: plan.confirmRecovery,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    sslCaPem: CA,
    safetyBackupPath: files.safetyBackupPath,
    safetyBackupEvidence: files.safetyRawEvidence,
    safetyEvidence: files.safetyEvidence,
    pgDumpBinary: files.paths.pg_dump,
    pgRestoreBinary: files.paths.pg_restore,
    psqlBinary: files.paths.psql,
    now: new Date("2026-08-02T09:15:00.000Z"),
    dependencies: {
      ...restoreDatabaseDependencies({
        inspectCandidateDatabase: async () => {
          stateReads += 1;
          return stateReads === 1 ? restoredState() : candidateState();
        },
        captureDatabaseManifest: async (_sql, options) => {
          assert.deepEqual(options, { schemas: FINAL_BACKUP_SCHEMAS });
          manifestReads += 1;
          return manifestReads === 1 ? manifest({ restored: true }) : manifest();
        },
        cleanupCandidateSchemas: async (
          _sql,
          _cleanup,
          posture,
          options,
        ) => {
          assert.equal(posture, undefined);
          assert.deepEqual(options, { includePinnedBaselineCleanup: false });
          destructiveEvents.push("cleanup");
        },
        applyOwnerAndSecurityClosure: async (
          _sql,
          _owners,
          _security,
          posture,
          options,
        ) => {
          assert.equal(posture, undefined);
          assert.deepEqual(options, {
            expectedSchemas: CANDIDATE_FINAL_SCHEMAS,
            replaySecurity: false,
          });
          destructiveEvents.push("owner");
        },
      }, { recovery: true }),
      validateOfficialToolchain: toolchainDependency(files),
      fileCommitment: commitmentDependency(files),
      revalidateToolchain: async () => {},
      safeToolCall: async (input) => {
        assert.deepEqual(
          input.args.slice(0, CANDIDATE_SAFETY_RECOVERY_FLAGS.length),
          CANDIDATE_SAFETY_RECOVERY_FLAGS,
        );
        assert.equal(input.args.includes("--no-owner"), true);
        assert.equal(input.args.includes("--no-privileges"), false);
        destructiveEvents.push("restore");
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
    },
  });
  assert.equal(result.executionMode, "restored-from-safety-backup");
  assert.deepEqual(destructiveEvents, ["cleanup", "restore", "owner"]);
});

async function restoredResult(files) {
  const { plan } = await createPlan(files);
  return applyCandidateRestore({
    plan,
    confirmRestore: plan.confirmRestore,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    sslCaPem: CA,
    snapshotBackupPath: files.snapshotBackupPath,
    safetyBackupPath: files.safetyBackupPath,
    safetyBackupEvidence: files.safetyRawEvidence,
    safetyEvidence: files.safetyEvidence,
    pgDumpBinary: files.paths.pg_dump,
    pgRestoreBinary: files.paths.pg_restore,
    psqlBinary: files.paths.psql,
    now: new Date("2026-08-02T09:12:00.000Z"),
    dependencies: {
      ...restoreDatabaseDependencies({
        inspectCandidateDatabase: async () => restoredState(),
        captureDatabaseManifest: async () => manifest({ restored: true }),
      }),
      validateOfficialToolchain: toolchainDependency(files),
      fileCommitment: commitmentDependency(files),
      safeToolCall: async () => {
        throw new Error("resume must not execute pg_restore");
      },
      migrationCount: async () => 29,
    },
  });
}

async function createRuntimePlan(files, restoreResult) {
  const migrations = migrationPlan();
  const plan = await createCandidateRuntimeEnablePlan({
    repositoryCommit: OPERATOR_COMMIT,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    poolerHost: POOLER_HOST,
    sslCaPem: CA,
    restoreResult,
    migrationPlan: migrations,
    dependencies: {
      openHostedDatabase: async () => ({
        sql: {},
        target: TARGET,
        operatorIdentity: OPERATOR_IDENTITY,
      }),
      closeHostedDatabase: async () => {},
      acquireRestoreLock: async () => {},
      inspectProjectorLeaseDrain: async () => leases(),
      assertRuntimeLoginsFenced: async () => loginFence(),
      inspectCandidateDatabase: async () => restoredState(),
      inspectMigrationState: async () => ({
        status: "current",
        appliedCount: migrations.migrationCount,
        pending: [],
      }),
      captureDatabaseManifest: async () => manifest({ restored: true }),
      readRuntimeRolePosture: async () => rolePosture(false),
    },
  });
  return { plan, migrations };
}

test("runtime enable plan is explicit, migration-current and still fenced", async (t) => {
  const files = await fixture(t);
  const restoreResult = await restoredResult(files);
  const { plan, migrations } = await createRuntimePlan(files, restoreResult);
  assert.equal(plan.restoreEvidenceSha256, restoreResult.evidenceSha256);
  assert.deepEqual(plan.operatorIdentity, OPERATOR_IDENTITY);
  assert.equal(plan.migrationPlanSha256, migrations.planSha256);
  assert.equal(plan.caSha256, sha256(Buffer.from(CA)));
  assert.equal(plan.candidateFence.promoted, false);
  assert.equal(plan.runtimeRoles.length, ROLE_SPECS.length);
  assert.match(plan.confirmEnable, /^0x[0-9a-f]{64}$/u);
});

test("runtime enable apply rotates exact credentials then verifies all pooler roles", async (t) => {
  const files = await fixture(t);
  const restoreResult = await restoredResult(files);
  const { plan, migrations } = await createRuntimePlan(files, restoreResult);
  const runtimeCredentials = credentials();
  let enabled = false;
  let verified = false;
  let refenced = 0;
  const result = await applyCandidateRuntimeEnable({
    plan,
    confirmEnable: plan.confirmEnable,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    poolerHost: POOLER_HOST,
    sslCaPem: CA,
    credentials: runtimeCredentials,
    restoreResult,
    migrationPlan: migrations,
    now: new Date("2026-08-02T09:20:00.000Z"),
    dependencies: databaseDependencies({
      inspectCandidateDatabase: async () => restoredState(),
      inspectMigrationState: async () => ({
        status: "current",
        appliedCount: migrations.migrationCount,
        pending: [],
      }),
      captureDatabaseManifest: async () => manifest({ restored: true }),
      readRuntimeRolePosture: async () => rolePosture(enabled),
      enableRuntimeRoles: async (_sql, values) => {
        assert.deepEqual([...values.keys()].sort(), Object.keys(runtimeCredentials).sort());
        enabled = true;
      },
      verifyPoolerLogins: async (input) => {
        verified = true;
        assert.equal(input.poolerHost, POOLER_HOST);
        assert.equal(input.sslCaPem, CA);
        assert.equal(input.credentials, runtimeCredentials);
        return { roles: ROLE_SPECS.map(({ loginRole }) => loginRole) };
      },
      fenceRuntimeLogins: async () => {
        refenced += 1;
        return loginFence();
      },
    }),
  });
  assert.equal(enabled, true);
  assert.equal(verified, true);
  assert.equal(refenced, 0);
  assert.equal(result.runtimeLoginsEnabled, true);
  assert.equal(result.roles.length, ROLE_SPECS.length);
  assert.equal(canonicalJson(result).includes(PASSWORD), false);
  for (const secret of Object.values(runtimeCredentials)) {
    assert.equal(canonicalJson(result).includes(secret), false);
  }
});

test("runtime enable re-fences every login if pooler verification fails", async (t) => {
  const files = await fixture(t);
  const restoreResult = await restoredResult(files);
  const { plan, migrations } = await createRuntimePlan(files, restoreResult);
  let enabled = false;
  let refenced = 0;
  await assert.rejects(
    applyCandidateRuntimeEnable({
      plan,
      confirmEnable: plan.confirmEnable,
      expectedProjectRef: CANDIDATE_PROJECT_REF,
      databaseUrl: DATABASE_URL,
      poolerHost: POOLER_HOST,
      sslCaPem: CA,
      credentials: credentials(),
      restoreResult,
      migrationPlan: migrations,
      dependencies: databaseDependencies({
        inspectCandidateDatabase: async () => restoredState(),
        inspectMigrationState: async () => ({
          status: "current",
          appliedCount: migrations.migrationCount,
          pending: [],
        }),
        captureDatabaseManifest: async () => manifest({ restored: true }),
        readRuntimeRolePosture: async () => rolePosture(enabled),
        enableRuntimeRoles: async () => {
          enabled = true;
        },
        verifyPoolerLogins: async () => {
          throw new Error("simulated pooler role failure");
        },
        fenceRuntimeLogins: async () => {
          refenced += 1;
          enabled = false;
          return loginFence();
        },
      }),
    }),
    /runtime logins were re-fenced/u,
  );
  assert.equal(refenced, 1);
  assert.equal(enabled, false);
});

test("runtime enable commit-ack loss re-fences through a fresh operator session", async (t) => {
  const files = await fixture(t);
  const restoreResult = await restoredResult(files);
  const { plan, migrations } = await createRuntimePlan(files, restoreResult);
  let enabled = false;
  let openAttempts = 0;
  let refenceAttempts = 0;
  await assert.rejects(
    applyCandidateRuntimeEnable({
      plan,
      confirmEnable: plan.confirmEnable,
      expectedProjectRef: CANDIDATE_PROJECT_REF,
      databaseUrl: DATABASE_URL,
      poolerHost: POOLER_HOST,
      sslCaPem: CA,
      credentials: credentials(),
      restoreResult,
      migrationPlan: migrations,
      dependencies: databaseDependencies({
        openHostedDatabase: async () => {
          openAttempts += 1;
          return {
            sql: { attempt: openAttempts },
            target: TARGET,
            operatorIdentity: OPERATOR_IDENTITY,
          };
        },
        inspectCandidateDatabase: async () => restoredState(),
        inspectMigrationState: async () => ({
          status: "current",
          appliedCount: migrations.migrationCount,
          pending: [],
        }),
        captureDatabaseManifest: async () => manifest({ restored: true }),
        readRuntimeRolePosture: async () => rolePosture(enabled),
        enableRuntimeRoles: async () => {
          enabled = true;
          throw new Error("simulated lost commit acknowledgement");
        },
        verifyPoolerLogins: async () => {
          throw new Error("pooler verification must not run after ack loss");
        },
        fenceRuntimeLogins: async () => {
          refenceAttempts += 1;
          if (refenceAttempts === 1) {
            throw new Error("simulated lost original session");
          }
          enabled = false;
          return loginFence();
        },
      }),
    }),
    /runtime logins were re-fenced and verified/u,
  );
  assert.equal(openAttempts, 2);
  assert.equal(refenceAttempts, 2);
  assert.equal(enabled, false);
});

test("runtime enable resumes verification after a durable enable", async (t) => {
  const files = await fixture(t);
  const restoreResult = await restoredResult(files);
  const { plan, migrations } = await createRuntimePlan(files, restoreResult);
  let enabled = true;
  let rotations = 0;
  const result = await applyCandidateRuntimeEnable({
    plan,
    confirmEnable: plan.confirmEnable,
    expectedProjectRef: CANDIDATE_PROJECT_REF,
    databaseUrl: DATABASE_URL,
    poolerHost: POOLER_HOST,
    sslCaPem: CA,
    credentials: credentials(),
    restoreResult,
    migrationPlan: migrations,
    dependencies: databaseDependencies({
      assertRuntimeLoginsFenced: async () => {
        throw new Error("enabled resume must not require NOLOGIN");
      },
      inspectCandidateDatabase: async () => restoredState(),
      inspectMigrationState: async () => ({
        status: "current",
        appliedCount: migrations.migrationCount,
        pending: [],
      }),
      captureDatabaseManifest: async () => manifest({ restored: true }),
      readRuntimeRolePosture: async () => rolePosture(enabled),
      enableRuntimeRoles: async () => {
        rotations += 1;
      },
      verifyPoolerLogins: async () => ({
        roles: ROLE_SPECS.map(({ loginRole }) => loginRole),
      }),
      fenceRuntimeLogins: async () => {
        enabled = false;
        return loginFence();
      },
    }),
  });
  assert.equal(result.executionMode, "resumed-enabled-verification");
  assert.equal(rotations, 0);
});

test("runtime enable ack loss reports indeterminate when every re-fence attempt fails", async (t) => {
  const files = await fixture(t);
  const restoreResult = await restoredResult(files);
  const { plan, migrations } = await createRuntimePlan(files, restoreResult);
  let enabled = false;
  let refenceAttempts = 0;
  await assert.rejects(
    applyCandidateRuntimeEnable({
      plan,
      confirmEnable: plan.confirmEnable,
      expectedProjectRef: CANDIDATE_PROJECT_REF,
      databaseUrl: DATABASE_URL,
      poolerHost: POOLER_HOST,
      sslCaPem: CA,
      credentials: credentials(),
      restoreResult,
      migrationPlan: migrations,
      dependencies: databaseDependencies({
        inspectCandidateDatabase: async () => restoredState(),
        inspectMigrationState: async () => ({
          status: "current",
          appliedCount: migrations.migrationCount,
          pending: [],
        }),
        captureDatabaseManifest: async () => manifest({ restored: true }),
        readRuntimeRolePosture: async () => rolePosture(enabled),
        enableRuntimeRoles: async () => {
          enabled = true;
          throw new Error("simulated lost commit acknowledgement");
        },
        fenceRuntimeLogins: async () => {
          refenceAttempts += 1;
          throw new Error("simulated re-fence failure");
        },
      }),
    }),
    /status is indeterminate and runtime logins may remain enabled/u,
  );
  assert.equal(refenceAttempts, 2);
});
