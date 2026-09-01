import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

import {
  assertWebsiteProjectionRotationConfirmation,
  assertWebsiteProjectionRotationSourcePlan,
  assertWebsiteProjectionRuntimeCredentialProbe,
  buildWebsiteProjectionRotationReceipt,
  buildWebsiteProjectionRuntimeDatabaseUrl,
  validateWebsiteProjectionRotationPassword,
  validateWebsiteProjectionRuntimeDatabaseUrl,
  WEBSITE_PROJECTION_NO_OVERLAP_CONFIRMATION,
  WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF,
  WEBSITE_PROJECTION_ROTATION_RECEIPT_LEAF,
  WEBSITE_PROJECTION_ROTATION_RECEIPT_SCHEMA,
  WEBSITE_PROJECTION_ROTATION_CONFIRMATION,
  WEBSITE_PROJECTION_RUNTIME_DATABASE_CA_PEM_LEAF,
  WEBSITE_PROJECTION_RUNTIME_DATABASE_ROLE_LEAF,
  WEBSITE_PROJECTION_RUNTIME_DATABASE_URL_LEAF,
} from "./website-projection-db-credential-rotation-core.mjs";
import {
  probeWebsiteProjectionRuntimeCredential,
  rotateWebsiteProjectionRuntimeCredential,
  setWebsiteProjectionRuntimePassword,
} from "./website-projection-db-credential-rotation-postgres.mjs";
import {
  discoverWebsiteProjectionPlan,
} from "./website-projection-db-operator-core.mjs";

const PASSWORD = "correct horse battery staple rotation 2026";
const CA = `-----BEGIN CERTIFICATE-----
${"A".repeat(80)}
-----END CERTIFICATE-----`;
const OID = "a".repeat(40);
const DIGEST = `0x${"b".repeat(64)}`;
const WORKSPACE = fileURLToPath(new URL("../", import.meta.url));
const FILES = [
  "0001_projection_records_v1.sql",
  "0002_custom_launch_wallet_profile_v2.sql",
  "0003_registry_custom_public_read_v1.sql",
  "0004_approval_v3_artifacts_v1.sql",
  "0005_generic_launch_materializations_v2.sql",
  "0006_gmgn_account_gate_v1.sql",
  "0007_gmgn_account_gate_multiflight_v1.sql",
];
const BACKEND_HANDOFF_CONTRACT = path.join(
  WORKSPACE,
  "docs/operations/WEBSITE-PROJECTION-DATABASE-BACKEND-HANDOFF-V1.json",
);

function probeRow(overrides = {}) {
  return {
    runtime_role: "programmable_website_projection_runtime",
    session_role: "programmable_website_projection_runtime",
    database_name: "postgres",
    server_version_num: "170000",
    rolsuper: false,
    rolinherit: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolreplication: false,
    rolbypassrls: false,
    schema_usage: true,
    schema_create: false,
    required_runtime_privileges: true,
    forbidden_runtime_privileges: false,
    owns_application_objects: false,
    has_forbidden_membership: false,
    ssl: true,
    ssl_version: "TLSv1.3",
    ssl_cipher: "TLS_AES_256_GCM_SHA384",
    ssl_bits: 256,
    ...overrides,
  };
}

test("rotation accepts only the exact project and explicit no-overlap cutover", () => {
  assert.doesNotThrow(() => assertWebsiteProjectionRotationConfirmation({
    expectedProjectRef: WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF,
    confirmRotate: WEBSITE_PROJECTION_ROTATION_CONFIRMATION,
    confirmNoOverlap: WEBSITE_PROJECTION_NO_OVERLAP_CONFIRMATION,
  }));
  assert.throws(() => assertWebsiteProjectionRotationConfirmation({
    expectedProjectRef: WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF,
    confirmRotate: WEBSITE_PROJECTION_ROTATION_CONFIRMATION,
    confirmNoOverlap: "assume-overlap",
  }), /single-password/u);
  assert.throws(() => assertWebsiteProjectionRotationConfirmation({
    expectedProjectRef: "z".repeat(20),
    confirmRotate: WEBSITE_PROJECTION_ROTATION_CONFIRMATION,
    confirmNoOverlap: WEBSITE_PROJECTION_NO_OVERLAP_CONFIRMATION,
  }), /exact production/u);
});

test("password stays bounded and the materialized URL is the exact TLS-owned pooler target", () => {
  assert.equal(validateWebsiteProjectionRotationPassword(PASSWORD), PASSWORD);
  for (const value of ["short", `valid long password${String.fromCharCode(10)}invalid`]) {
    assert.throws(() => validateWebsiteProjectionRotationPassword(value), /invalid/u);
  }
  const databaseUrl = buildWebsiteProjectionRuntimeDatabaseUrl(
    `${PASSWORD} /?#%`,
  );
  assert.ok(databaseUrl.includes("%20%2F%3F%23%"));
  assert.deepEqual(validateWebsiteProjectionRuntimeDatabaseUrl(databaseUrl), {
    projectRef: WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF,
    host: "aws-0-eu-central-1.pooler.supabase.com",
    port: 6543,
    database: "postgres",
    loginRole:
      `programmable_website_projection_runtime.${WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF}`,
    effectiveRole: "programmable_website_projection_runtime",
    tlsMode: "verify-full-equivalent",
  });
  assert.throws(() => validateWebsiteProjectionRuntimeDatabaseUrl(
    `${databaseUrl}?sslmode=disable`,
  ), /exact production pooler/u);
});

test("rotation binds the reviewed plan to the current migration byte closure", async (t) => {
  const reviewedPlan = await discoverWebsiteProjectionPlan({
    workspace: WORKSPACE,
    repositoryCommit: OID,
    repositoryTree: OID,
  });
  const currentPlan = await discoverWebsiteProjectionPlan({
    workspace: WORKSPACE,
    repositoryCommit: "c".repeat(40),
    repositoryTree: "d".repeat(40),
  });
  assert.equal(assertWebsiteProjectionRotationSourcePlan({
    reviewedPlan,
    currentPlan,
  }), reviewedPlan);

  const driftWorkspace = await mkdtemp(
    path.join(os.tmpdir(), "website-projection-rotation-plan-test-"),
  );
  t.after(() => rm(driftWorkspace, { recursive: true, force: true }));
  const migrationRoot = path.join(
    driftWorkspace,
    "ops/website-projection-target/migrations",
  );
  await mkdir(migrationRoot, { recursive: true });
  for (const [index, fileName] of FILES.entries()) {
    const source = await readFile(path.join(
      WORKSPACE,
      "ops/website-projection-target/migrations",
      fileName,
    ), "utf8");
    await writeFile(
      path.join(migrationRoot, fileName),
      index === 4
        ? source.replace(/\nCOMMIT;\s*$/u, "\n-- reviewed-byte-drift\nCOMMIT;\n")
        : source,
    );
  }
  const driftPlan = await discoverWebsiteProjectionPlan({
    workspace: driftWorkspace,
    repositoryCommit: "e".repeat(40),
    repositoryTree: "f".repeat(40),
  });
  assert.throws(() => assertWebsiteProjectionRotationSourcePlan({
    reviewedPlan,
    currentPlan: driftPlan,
  }), /differs from the current migration closure/u);
});

test("ALTER ROLE password is transaction-safe and does not retain the plaintext GUC", async (t) => {
  const database = new PGlite();
  t.after(() => database.close());
  await database.exec(`
    CREATE ROLE programmable_website_projection_runtime WITH
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS PASSWORD 'old protected password value 2026';
  `);
  const before = await storedPassword(database);
  await assert.rejects(database.transaction(async (transaction) => {
    await setWebsiteProjectionRuntimePassword(pgliteSql(transaction), PASSWORD);
    throw new Error("injected rollback");
  }), /injected rollback/u);
  assert.equal(await storedPassword(database), before);

  await database.transaction(async (transaction) => {
    await setWebsiteProjectionRuntimePassword(pgliteSql(transaction), PASSWORD);
  });
  assert.notEqual(await storedPassword(database), before);
  const [{ value }] = (await database.query(`
    SELECT pg_catalog.current_setting(
      'programmable.website_projection_runtime_rotation_password', true
    ) AS value
  `)).rows;
  assert.ok(value === null || value === "");
});

test("lost credential commit acknowledgement fails closed as WPR01", async () => {
  const posture = Object.freeze({
    migrationEvidence: Object.freeze({ migrationCount: 7 }),
    catalogSha256: DIGEST,
    operatorCatalogSha256: DIGEST,
    runtimeRoleStatus: "current",
  });
  const sessionIdentity = Object.freeze({
    backendPid: 731,
    sessionUser: "cli_login_postgres",
    currentRole: "postgres",
  });
  const commitAcknowledgementLost = new Error("connection closed after commit");
  const sql = {
    unsafe(statement) {
      if (statement.includes("credential-rotation-lock")) {
        return pending([{
          acquired: true,
          backend_pid: 731,
          session_user: "cli_login_postgres",
          current_role: "postgres",
        }]);
      }
      if (statement.includes("credential-rotation-unlock")) {
        return pending([{
          released: true,
          backend_pid: 731,
          session_user: "cli_login_postgres",
          current_role: "postgres",
        }]);
      }
      throw new Error("unexpected fake rotation statement");
    },
    async begin(callback) {
      await callback({
        unsafe() {
          return pending([]);
        },
      });
      throw commitAcknowledgementLost;
    },
  };
  await assert.rejects(
    rotateWebsiteProjectionRuntimeCredential({
      sql,
      plan: {},
      expectedProjectRef: WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF,
      sessionIdentity,
      runtimePassword: PASSWORD,
    }, {
      postureInspector: async () => posture,
      passwordSetter: async () => {},
    }),
    (error) => error?.code === "WPR01"
      && error.cause === commitAcknowledgementLost,
  );
});

test("runtime credential probe binds hostname verification and least privilege", async () => {
  const databaseUrl = buildWebsiteProjectionRuntimeDatabaseUrl(PASSWORD);
  let observedConfiguration;
  class FakePool {
    constructor(configuration) {
      observedConfiguration = configuration;
    }

    async query() {
      return { rows: [probeRow()] };
    }

    async end() {}
  }
  const result = await probeWebsiteProjectionRuntimeCredential({
    databaseUrl,
    expectedProjectRef: WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF,
    sslCaPem: CA,
  }, { PoolClass: FakePool });
  assert.equal(observedConfiguration.ssl.servername,
    "aws-0-eu-central-1.pooler.supabase.com");
  assert.equal(observedConfiguration.ssl.rejectUnauthorized, true);
  assert.equal(result.attestation.leastPrivilege, true);
  assert.throws(() => assertWebsiteProjectionRuntimeCredentialProbe(
    probeRow({ forbidden_runtime_privileges: true }),
  ), /probe failed/u);
});

test("receipt is secret-free and records single-password forward recovery", () => {
  const receipt = buildWebsiteProjectionRotationReceipt({
    sourceCommit: OID,
    sourceTree: OID,
    sourceParent: OID,
    target: {
      projectRef: WEBSITE_PROJECTION_PRODUCTION_PROJECT_REF,
      database: "postgres",
    },
    migrationEvidence: {
      migrationCount: 7,
      planSha256: DIGEST,
      repositoryCommit: OID,
      repositoryTree: OID,
      catalogSha256: DIGEST,
      operatorCatalogSha256: DIGEST,
    },
    preRotationCatalogSha256: DIGEST,
    postRotationCatalogSha256: DIGEST,
    runtimeProbe: assertWebsiteProjectionRuntimeCredentialProbe(probeRow()),
    caPem: CA,
    outputFiles: {
      databaseUrl: WEBSITE_PROJECTION_RUNTIME_DATABASE_URL_LEAF,
      databaseRole: WEBSITE_PROJECTION_RUNTIME_DATABASE_ROLE_LEAF,
      databaseCaPem: WEBSITE_PROJECTION_RUNTIME_DATABASE_CA_PEM_LEAF,
      receipt: WEBSITE_PROJECTION_ROTATION_RECEIPT_LEAF,
    },
    rotatedAt: "2026-08-20T12:00:00.000Z",
  });
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes(PASSWORD), false);
  assert.equal(receipt.schemaVersion, WEBSITE_PROJECTION_ROTATION_RECEIPT_SCHEMA);
  assert.equal(receipt.protectedOutputs.databaseRole,
    WEBSITE_PROJECTION_RUNTIME_DATABASE_ROLE_LEAF);
  assert.equal(receipt.cutover.overlappingPasswordsSupported, false);
  assert.equal(receipt.cutover.vercelMutationPerformed, false);
  assert.equal(receipt.protectedOutputs.containsSecretDerivedDigest, false);
});

test("machine-readable Backend handoff binds exact leaves and digest boundary", async () => {
  const contract = JSON.parse(await readFile(BACKEND_HANDOFF_CONTRACT, "utf8"));
  assert.equal(contract.websiteReceipt.schemaVersion,
    WEBSITE_PROJECTION_ROTATION_RECEIPT_SCHEMA);
  assert.deepEqual(
    contract.protectedOutputs.map(({ filename }) => filename),
    [
      WEBSITE_PROJECTION_RUNTIME_DATABASE_URL_LEAF,
      WEBSITE_PROJECTION_RUNTIME_DATABASE_ROLE_LEAF,
      WEBSITE_PROJECTION_RUNTIME_DATABASE_CA_PEM_LEAF,
    ],
  );
  assert.equal(contract.protectedOutputs[0].digest.websiteReceipt, "forbidden");
  assert.equal(contract.protectedOutputs[0].digest.backendCasReceipt, "required");
  assert.equal(contract.backendMaterializer.plaintextReceiptAllowed, false);
  assert.equal(contract.websiteSourceIdentity.embeddedInSource, false);
});

function pgliteSql(client) {
  return {
    unsafe(statement, parameters = []) {
      const normalized = statement.trimStart().toLowerCase();
      const operation = (parameters.length > 0 || normalized.startsWith("select"))
        ? client.query(statement, parameters).then(({ rows }) => rows)
        : client.exec(statement).then((results) => results.at(-1)?.rows ?? []);
      operation.simple = () => operation;
      return operation;
    },
  };
}

function pending(value) {
  const operation = Promise.resolve(value);
  operation.simple = () => operation;
  return operation;
}

async function storedPassword(database) {
  const [{ rolpassword }] = (await database.query(`
    SELECT rolpassword
      FROM pg_catalog.pg_authid
     WHERE rolname = 'programmable_website_projection_runtime'
  `)).rows;
  assert.equal(typeof rolpassword, "string");
  return rolpassword;
}
