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
export const WEBSITE_PROJECTION_ADOPTION_SOURCE_COMMIT =
  "76ebd54e2f0e31d055cfe6c36b7474b0e850de90";
export const WEBSITE_PROJECTION_ADOPTION_SOURCE_TREE =
  "8e4ddd9a73818ce70f1284f3b2731bc87b005f27";
export const WEBSITE_PROJECTION_ADOPTION_SOURCE_PLAN_SHA256 =
  "0xf0fc7bca18c16da02be83f75d25e404bfe0b7ec7f10c29ecfbea93fcb0d7e973";
export const WEBSITE_PROJECTION_ADOPTION_SOURCE_ORDER_SHA256 =
  "0xce50954bfa6ff3b66b849bb5b53e8f1adf93abbe12cf865c19375100f2571cc2";
export const WEBSITE_PROJECTION_ADOPTION_SOURCE_SNAPSHOT_SHA256 =
  "0x917afa0f6bcd19f00f5d2ce5cd0d8221ef00ad6716460af11bff0906e4b9a0f9";
export const WEBSITE_PROJECTION_ADOPTION_EXPANDED_SNAPSHOT_SHA256 =
  "0x8cb9841f0131b48fb67eac0082d72f51158500a61482c0b21e0c7b7cc2f19284";
export const WEBSITE_PROJECTION_ADOPTION_BASE_SNAPSHOT_SHA256 =
  "0xac4a1fe60ebf677865a0f8ca6160162d9c457dc2bd401aa60fd820c8f2fdcc58";
export const WEBSITE_PROJECTION_ADOPTION_LEGACY_INVENTORY_SHA256 =
  "0xd32953874c1466be82433d97e6532d0572ddcf80eed261efa119b25f17e0f5b3";
export const WEBSITE_PROJECTION_ADOPTION_LEGACY_PUBLIC_SHA256 =
  "0x93e41eab957ab8add897a8b277bcaaa0a5f10eebeb27f47db5bc0e59640484a2";
export const WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT = 3;
export const WEBSITE_PROJECTION_ADOPTION_SOURCE_MIGRATION_COUNT = 5;
export const WEBSITE_PROJECTION_RETAINED_PLAN_COMMIT =
  "c235fbd55259f76d8356d6f07073c48b00eb294d";
export const WEBSITE_PROJECTION_RETAINED_PLAN_TREE =
  "57d09edb4793d6fe9f8a3bfad8e311accbb4caec";
export const WEBSITE_PROJECTION_RETAINED_PLAN_SHA256 =
  "0xbcdb49c686413cd5eab15514e0182eb929f5771e58059ce0fe59f928c44e6f3f";
export const WEBSITE_PROJECTION_RETAINED_ORDER_SHA256 =
  "0xce50954bfa6ff3b66b849bb5b53e8f1adf93abbe12cf865c19375100f2571cc2";
export const WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT = 5;
export const WEBSITE_PROJECTION_PREDECESSOR_0006_PLAN_COMMIT =
  "9a4f5244612d39c387022ce290de40760b112540";
export const WEBSITE_PROJECTION_PREDECESSOR_0006_PLAN_TREE =
  "6daaa529fac0d95e2c12e05d77fc61ecc4247f3c";
export const WEBSITE_PROJECTION_PREDECESSOR_0006_PLAN_SHA256 =
  "0x04f9e0a4c52c4e8b4f22062339a6c30aa0a2fb8d65d38c08ce492438e49f0a4d";
export const WEBSITE_PROJECTION_PREDECESSOR_0006_ORDER_SHA256 =
  "0x603f0721eadf7e55131c4c2800b46b41dd0fa08ec09613d3f02d019cb65d300c";
export const WEBSITE_PROJECTION_PREDECESSOR_0006_MIGRATION_COUNT = 6;
export const WEBSITE_PROJECTION_ADOPTION_TARGET_PROJECT_REF =
  "mnnvlrqwhfoppogslsje";
export const WEBSITE_PROJECTION_ADOPTION_CURRENT_OPERATOR_COMMIT =
  "482aba91cd246d605ec0f98d0718dd5fff781d1f";
export const WEBSITE_PROJECTION_ADOPTION_CURRENT_OPERATOR_TREE =
  "b65e183f679c97b8152c779d9866aec53202bf4a";

export const WEBSITE_PROJECTION_MIGRATION_FILES = Object.freeze([
  "0001_projection_records_v1.sql",
  "0002_custom_launch_wallet_profile_v2.sql",
  "0003_registry_custom_public_read_v1.sql",
  "0004_approval_v3_artifacts_v1.sql",
  "0005_generic_launch_materializations_v2.sql",
  "0006_gmgn_account_gate_v1.sql",
  "0007_gmgn_account_gate_multiflight_v1.sql",
]);

const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const HEX_SHA256 = /^0x[0-9a-f]{64}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const MIGRATION_FILE = /^(000[1-7])_([a-z][a-z0-9_]*)\.sql$/u;
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

async function discoverWebsiteProjectionPlanFiles({
  workspace,
  repositoryCommit,
  repositoryTree,
}, migrationFiles) {
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
  if (names.length !== migrationFiles.length
    || names.some((name, index) =>
      name !== migrationFiles[index])) {
    const count = migrationFiles.length === 7
      ? "seven"
      : migrationFiles.length === 6 ? "six" : "five";
    throw new Error(
      `migration directory must contain exactly the ${count} canonical files`,
    );
  }

  const migrations = [];
  for (const [index, fileName] of migrationFiles.entries()) {
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

export async function discoverWebsiteProjectionPlan(input) {
  return discoverWebsiteProjectionPlanFiles(
    input,
    WEBSITE_PROJECTION_MIGRATION_FILES,
  );
}

export async function discoverRetainedWebsiteProjectionPlan(input) {
  return discoverWebsiteProjectionPlanFiles(
    input,
    WEBSITE_PROJECTION_MIGRATION_FILES.slice(
      0,
      WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT,
    ),
  );
}

function validateWebsiteProjectionPlanFiles(value, migrationFiles) {
  if (!isPlainObject(value)
    || value.kind !== WEBSITE_PROJECTION_PLAN_KIND
    || value.schemaVersion !== 1
    || !GIT_OBJECT.test(value.repositoryCommit ?? "")
    || !GIT_OBJECT.test(value.repositoryTree ?? "")
    || value.migrationRoot !== WEBSITE_PROJECTION_MIGRATION_ROOT
    || value.applicationSchema !== WEBSITE_PROJECTION_APPLICATION_SCHEMA
    || value.evidenceTable !== WEBSITE_PROJECTION_EVIDENCE_TABLE
    || value.runtimeRole !== WEBSITE_PROJECTION_RUNTIME_ROLE
    || value.migrationCount !== migrationFiles.length
    || !HEX_SHA256.test(value.orderSha256 ?? "")
    || !HEX_SHA256.test(value.planSha256 ?? "")
    || !Array.isArray(value.migrations)
    || value.migrations.length !== migrationFiles.length) {
    throw new Error("website projection migration plan is invalid");
  }
  for (const [index, migration] of value.migrations.entries()) {
    const fileName = migrationFiles[index];
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

export function validateWebsiteProjectionPlan(value) {
  if (value?.migrationCount === WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT) {
    validateRetainedWebsiteProjectionPlan(value);
    if (
      value.repositoryCommit !== WEBSITE_PROJECTION_RETAINED_PLAN_COMMIT
      || value.repositoryTree !== WEBSITE_PROJECTION_RETAINED_PLAN_TREE
      || value.planSha256 !== WEBSITE_PROJECTION_RETAINED_PLAN_SHA256
      || value.orderSha256 !== WEBSITE_PROJECTION_RETAINED_ORDER_SHA256
    ) {
      throw new Error("website projection retained migration plan is invalid");
    }
    return value;
  }
  if (
    value?.migrationCount ===
      WEBSITE_PROJECTION_PREDECESSOR_0006_MIGRATION_COUNT
  ) return validateWebsiteProjectionPredecessor0006Plan(value);
  const plan = validateWebsiteProjectionPlanFiles(
    value,
    WEBSITE_PROJECTION_MIGRATION_FILES,
  );
  return plan;
}

export function validateRetainedWebsiteProjectionPlan(value) {
  return validateWebsiteProjectionPlanFiles(
    value,
    WEBSITE_PROJECTION_MIGRATION_FILES.slice(
      0,
      WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT,
    ),
  );
}

export function validateWebsiteProjectionPredecessor0006Plan(value) {
  validateWebsiteProjectionPlanFiles(
    value,
    WEBSITE_PROJECTION_MIGRATION_FILES.slice(
      0,
      WEBSITE_PROJECTION_PREDECESSOR_0006_MIGRATION_COUNT,
    ),
  );
  if (
    value.repositoryCommit !== WEBSITE_PROJECTION_PREDECESSOR_0006_PLAN_COMMIT
    || value.repositoryTree !== WEBSITE_PROJECTION_PREDECESSOR_0006_PLAN_TREE
    || value.planSha256 !== WEBSITE_PROJECTION_PREDECESSOR_0006_PLAN_SHA256
    || value.orderSha256 !== WEBSITE_PROJECTION_PREDECESSOR_0006_ORDER_SHA256
  ) {
    throw new Error(
      "website projection 0006 predecessor migration plan is invalid",
    );
  }
  return value;
}

export function websiteProjectionPredecessor0006Plan(successorPlan) {
  if (
    successorPlan?.migrationCount ===
      WEBSITE_PROJECTION_PREDECESSOR_0006_MIGRATION_COUNT
  ) return validateWebsiteProjectionPredecessor0006Plan(successorPlan);
  validateWebsiteProjectionPlanFiles(
    successorPlan,
    WEBSITE_PROJECTION_MIGRATION_FILES,
  );
  const migrations = Object.freeze(successorPlan.migrations.slice(
    0,
    WEBSITE_PROJECTION_PREDECESSOR_0006_MIGRATION_COUNT,
  ));
  const predecessor = {
    ...successorPlan,
    repositoryCommit: WEBSITE_PROJECTION_PREDECESSOR_0006_PLAN_COMMIT,
    repositoryTree: WEBSITE_PROJECTION_PREDECESSOR_0006_PLAN_TREE,
    migrationCount: WEBSITE_PROJECTION_PREDECESSOR_0006_MIGRATION_COUNT,
    orderSha256: WEBSITE_PROJECTION_PREDECESSOR_0006_ORDER_SHA256,
    migrations,
  };
  const plan = Object.freeze({
    ...predecessor,
    planSha256: sha256(canonicalJson(planPayload(predecessor))),
  });
  validateWebsiteProjectionPredecessor0006Plan(plan);
  if (migrationOrderSha256(plan.migrations)
      !== WEBSITE_PROJECTION_PREDECESSOR_0006_ORDER_SHA256) {
    throw new Error(
      "website projection successor does not preserve the exact reviewed 0001-0006 plan",
    );
  }
  return plan;
}

function retainedWebsiteProjectionPlan(successorPlan) {
  if (successorPlan?.migrationCount === WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT) {
    return validateWebsiteProjectionPlan(successorPlan);
  }
  validateWebsiteProjectionPlan(successorPlan);
  const migrations = Object.freeze(successorPlan.migrations.slice(
    0,
    WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT,
  ));
  const retained = {
    ...successorPlan,
    repositoryCommit: WEBSITE_PROJECTION_RETAINED_PLAN_COMMIT,
    repositoryTree: WEBSITE_PROJECTION_RETAINED_PLAN_TREE,
    migrationCount: WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT,
    orderSha256: WEBSITE_PROJECTION_RETAINED_ORDER_SHA256,
    migrations,
  };
  const plan = Object.freeze({
    ...retained,
    planSha256: sha256(canonicalJson(planPayload(retained))),
  });
  validateRetainedWebsiteProjectionPlan(plan);
  if (
    plan.planSha256 !== WEBSITE_PROJECTION_RETAINED_PLAN_SHA256
    || migrationOrderSha256(plan.migrations)
      !== WEBSITE_PROJECTION_RETAINED_ORDER_SHA256
  ) {
    throw new Error(
      "website projection successor does not preserve the retained 0001-0005 plan",
    );
  }
  return plan;
}

export function assertWebsiteProjectionAdoptionSourcePlan(plan) {
  if (plan?.migrationCount === WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT) {
    validateRetainedWebsiteProjectionPlan(plan);
  } else {
    validateWebsiteProjectionPlan(plan);
  }
  if (migrationOrderSha256(plan.migrations.slice(
    0,
    WEBSITE_PROJECTION_ADOPTION_SOURCE_MIGRATION_COUNT,
  )) !== WEBSITE_PROJECTION_ADOPTION_SOURCE_ORDER_SHA256) {
    throw new Error(
      "adopt-existing successor must preserve the exact reviewed migration source",
    );
  }
  return plan;
}

export function websiteProjectionAdoptionAttestationSha256({
  plan,
  expectedProjectRef,
  sourceSnapshotSha256,
  sourceCatalogSha256,
  sourceDataSha256,
  correctedCatalogSha256,
  operatorCatalogSha256,
  operatorCommit,
  operatorTree,
}) {
  assertWebsiteProjectionAdoptionSourcePlan(plan);
  if (!PROJECT_REF.test(expectedProjectRef ?? "")
    || expectedProjectRef !== WEBSITE_PROJECTION_ADOPTION_TARGET_PROJECT_REF
    || sourceSnapshotSha256 !== WEBSITE_PROJECTION_ADOPTION_SOURCE_SNAPSHOT_SHA256
    || !HEX_SHA256.test(sourceCatalogSha256 ?? "")
    || !HEX_SHA256.test(sourceDataSha256 ?? "")
    || !HEX_SHA256.test(correctedCatalogSha256 ?? "")
    || !HEX_SHA256.test(operatorCatalogSha256 ?? "")
    || !GIT_OBJECT.test(operatorCommit ?? "")
    || !GIT_OBJECT.test(operatorTree ?? "")
    || operatorCommit !== plan.repositoryCommit
    || operatorTree !== plan.repositoryTree) {
    throw new Error("website projection adoption attestation input is invalid");
  }
  return sha256(canonicalJson({
    kind: "programmable-website-projection-adopt-existing-attestation",
    schemaVersion: 1,
    targetProjectRef: expectedProjectRef,
    sourceRepositoryCommit: WEBSITE_PROJECTION_ADOPTION_SOURCE_COMMIT,
    sourceRepositoryTree: WEBSITE_PROJECTION_ADOPTION_SOURCE_TREE,
    sourcePlanSha256: WEBSITE_PROJECTION_ADOPTION_SOURCE_PLAN_SHA256,
    sourceOrderSha256: WEBSITE_PROJECTION_ADOPTION_SOURCE_ORDER_SHA256,
    successorRepositoryCommit: plan.repositoryCommit,
    successorRepositoryTree: plan.repositoryTree,
    successorPlanSha256: plan.planSha256,
    successorOrderSha256: plan.orderSha256,
    adoptedMigrationCount: WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT,
    adoptedThroughVersion: "0003",
    sourceSnapshotSha256,
    expandedSnapshotSha256:
      WEBSITE_PROJECTION_ADOPTION_EXPANDED_SNAPSHOT_SHA256,
    baseSnapshotSha256: WEBSITE_PROJECTION_ADOPTION_BASE_SNAPSHOT_SHA256,
    legacyInventorySha256:
      WEBSITE_PROJECTION_ADOPTION_LEGACY_INVENTORY_SHA256,
    legacyPublicSha256: WEBSITE_PROJECTION_ADOPTION_LEGACY_PUBLIC_SHA256,
    sourceCatalogSha256,
    sourceDataSha256,
    correctedCatalogSha256,
    operatorCatalogSha256,
    operatorCommit,
    operatorTree,
    sourceRowCounts: {
      credentialUses: 0,
      projectionRecords: 0,
      registryCustomLaunchRecords: 0,
    },
    runtimeRoleDelta: {
      rolinheritBefore: true,
      rolinheritAfter: false,
    },
  }));
}

export function compareWebsiteProjectionEvidence({
  plan,
  expectedProjectRef,
  evidenceTablePresent,
  applicationSchemaPresent,
  evidenceRows,
  adoptionRows = [],
}) {
  validateWebsiteProjectionPlan(plan);
  if (!PROJECT_REF.test(expectedProjectRef ?? "")
    || typeof evidenceTablePresent !== "boolean"
    || typeof applicationSchemaPresent !== "boolean"
    || !Array.isArray(evidenceRows)
    || !Array.isArray(adoptionRows)) {
    throw new Error("website projection migration state is invalid");
  }
  if (!evidenceTablePresent && evidenceRows.length > 0) {
    throw new Error("website projection migration evidence state is invalid");
  }
  if (!evidenceTablePresent && adoptionRows.length > 0) {
    throw new Error("website projection adoption evidence state is invalid");
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
  let adoption = null;
  const retainedPlan = evidenceRows[0]?.plan_sha256 ===
      WEBSITE_PROJECTION_RETAINED_PLAN_SHA256
    ? retainedWebsiteProjectionPlan(plan)
    : null;
  const predecessor0006EvidencePresent = evidenceRows[0]?.plan_sha256 ===
      WEBSITE_PROJECTION_PREDECESSOR_0006_PLAN_SHA256
    || (evidenceRows[0]?.plan_sha256 === WEBSITE_PROJECTION_RETAINED_PLAN_SHA256
      && evidenceRows[WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT]
        ?.plan_sha256 === WEBSITE_PROJECTION_PREDECESSOR_0006_PLAN_SHA256);
  const predecessor0006Plan = predecessor0006EvidencePresent
      && plan.migrationCount >=
        WEBSITE_PROJECTION_PREDECESSOR_0006_MIGRATION_COUNT
    ? websiteProjectionPredecessor0006Plan(plan)
    : null;
  const predecessor0006Prefix = predecessor0006Plan !== null
    && evidenceRows[0]?.plan_sha256 === predecessor0006Plan.planSha256;
  for (const [index, row] of evidenceRows.entries()) {
    let evidencePlan = plan;
    if (predecessor0006Prefix
      && index < WEBSITE_PROJECTION_PREDECESSOR_0006_MIGRATION_COUNT) {
      evidencePlan = predecessor0006Plan;
    } else if (retainedPlan !== null
      && index < WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT) {
      evidencePlan = retainedPlan;
    } else if (retainedPlan !== null
      && index === WEBSITE_PROJECTION_RETAINED_MIGRATION_COUNT
      && row?.plan_sha256 === predecessor0006Plan?.planSha256) {
      evidencePlan = predecessor0006Plan;
    }
    const migration = evidencePlan.migrations[index];
    if (!migration || !isPlainObject(row)
      || Number(row.ordinal) !== migration.ordinal
      || row.version !== migration.version
      || row.name !== migration.name
      || row.file_name !== path.posix.basename(migration.file)
      || row.file_sha256 !== migration.fileSha256
      || row.execution_sha256 !== migration.executionSha256
      || row.plan_sha256 !== evidencePlan.planSha256
      || row.repository_commit !== evidencePlan.repositoryCommit
      || row.repository_tree !== evidencePlan.repositoryTree
      || !HEX_SHA256.test(row.catalog_sha256 ?? "")
      || !HEX_SHA256.test(row.operator_catalog_sha256 ?? "")
      || !["applied", "adopted-existing-prefix-v1"].includes(
        row.evidence_kind,
      )) {
      throw new Error("remote migration evidence is not an exact plan prefix");
    }
    if (row.target_project_ref !== expectedProjectRef) {
      throw new Error("remote migration evidence target mismatch");
    }
    const adoptionFields = [
      row.adoption_source_snapshot_sha256,
      row.adoption_source_catalog_sha256,
      row.adoption_source_data_sha256,
      row.adoption_attestation_sha256,
      row.adoption_operator_commit,
      row.adoption_operator_tree,
    ];
    if (row.evidence_kind === "applied") {
      if (adoptionFields.some((value) => value !== null)) {
        throw new Error("applied migration evidence contains adoption claims");
      }
      if (adoption !== null && index < WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT) {
        throw new Error("remote adoption evidence is not the exact prefix");
      }
      continue;
    }
    if (index >= WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT
      || row.adoption_source_snapshot_sha256
        !== WEBSITE_PROJECTION_ADOPTION_SOURCE_SNAPSHOT_SHA256
      || !HEX_SHA256.test(row.adoption_source_catalog_sha256 ?? "")
      || !HEX_SHA256.test(row.adoption_source_data_sha256 ?? "")
      || !HEX_SHA256.test(row.adoption_attestation_sha256 ?? "")
      || !GIT_OBJECT.test(row.adoption_operator_commit ?? "")
      || !GIT_OBJECT.test(row.adoption_operator_tree ?? "")) {
      throw new Error("remote adoption evidence is not the exact prefix");
    }
    const currentAdoption = {
      sourceSnapshotSha256: row.adoption_source_snapshot_sha256,
      sourceCatalogSha256: row.adoption_source_catalog_sha256,
      sourceDataSha256: row.adoption_source_data_sha256,
      attestationSha256: row.adoption_attestation_sha256,
      operatorCommit: row.adoption_operator_commit,
      operatorTree: row.adoption_operator_tree,
      correctedCatalogSha256: row.catalog_sha256,
      operatorCatalogSha256: row.operator_catalog_sha256,
    };
    if (adoption === null) {
      adoption = currentAdoption;
    } else if (canonicalJson(adoption) !== canonicalJson(currentAdoption)) {
      throw new Error("remote adoption evidence is inconsistent");
    }
  }
  if (adoption !== null) {
    const adoptionPlan = retainedPlan ?? plan;
    const adoptionRow = adoptionRows[0];
    if (evidenceRows.length < WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT
      || adoptionRows.length !== 1
      || evidenceRows.slice(0, WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT)
        .some(({ evidence_kind }) =>
          evidence_kind !== "adopted-existing-prefix-v1")
      || !isPlainObject(adoptionRow)
      || adoptionRow.evidence_kind !== "adopted-existing-prefix-v1"
      || adoptionRow.adopted_through_version !== "0003"
      || adoptionRow.source_snapshot_sha256 !== adoption.sourceSnapshotSha256
      || adoptionRow.base_snapshot_sha256
        !== WEBSITE_PROJECTION_ADOPTION_BASE_SNAPSHOT_SHA256
      || adoptionRow.expanded_snapshot_sha256
        !== WEBSITE_PROJECTION_ADOPTION_EXPANDED_SNAPSHOT_SHA256
      || adoptionRow.legacy_inventory_sha256
        !== WEBSITE_PROJECTION_ADOPTION_LEGACY_INVENTORY_SHA256
      || adoptionRow.legacy_public_sha256
        !== WEBSITE_PROJECTION_ADOPTION_LEGACY_PUBLIC_SHA256
      || adoptionRow.source_catalog_sha256 !== adoption.sourceCatalogSha256
      || adoptionRow.corrected_catalog_sha256
        !== adoption.correctedCatalogSha256
      || adoptionRow.source_data_sha256 !== adoption.sourceDataSha256
      || adoptionRow.operator_catalog_sha256
        !== adoption.operatorCatalogSha256
      || adoptionRow.attestation_sha256 !== adoption.attestationSha256
      || adoptionRow.source_plan_sha256
        !== WEBSITE_PROJECTION_ADOPTION_SOURCE_PLAN_SHA256
      || adoptionRow.source_order_sha256
        !== WEBSITE_PROJECTION_ADOPTION_SOURCE_ORDER_SHA256
      || adoptionRow.source_repository_commit
        !== WEBSITE_PROJECTION_ADOPTION_SOURCE_COMMIT
      || adoptionRow.source_repository_tree
        !== WEBSITE_PROJECTION_ADOPTION_SOURCE_TREE
      || adoptionRow.successor_plan_sha256 !== adoptionPlan.planSha256
      || adoptionRow.successor_order_sha256 !== adoptionPlan.orderSha256
      || adoptionRow.successor_repository_commit
        !== adoptionPlan.repositoryCommit
      || adoptionRow.successor_repository_tree !== adoptionPlan.repositoryTree
      || adoptionRow.target_project_ref !== expectedProjectRef
      || adoptionRow.operator_commit !== adoption.operatorCommit
      || adoptionRow.operator_tree !== adoption.operatorTree
      || Number(adoptionRow.credential_uses_count) !== 0
      || Number(adoptionRow.projection_records_count) !== 0
      || Number(adoptionRow.registry_custom_launch_records_count) !== 0
      || adoptionRow.runtime_rolinherit_before !== true
      || adoptionRow.runtime_rolinherit_after !== false
      || websiteProjectionAdoptionAttestationSha256({
        plan: adoptionPlan,
        expectedProjectRef,
        sourceSnapshotSha256: adoption.sourceSnapshotSha256,
        sourceCatalogSha256: adoption.sourceCatalogSha256,
        sourceDataSha256: adoption.sourceDataSha256,
        correctedCatalogSha256: adoption.correctedCatalogSha256,
        operatorCatalogSha256: adoption.operatorCatalogSha256,
        operatorCommit: adoption.operatorCommit,
        operatorTree: adoption.operatorTree,
      }) !== adoption.attestationSha256) {
      throw new Error("remote adoption evidence is not the exact prefix");
    }
  } else if (adoptionRows.length !== 0) {
    throw new Error("adoption evidence exists without an adopted prefix");
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

export function assertWebsiteProjectionCheckoutClean(status) {
  if (typeof status !== "string" || status.trim() !== "") {
    throw new Error("operator checkout must match the exact reviewed commit");
  }
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
  for (const membership of memberships) {
    if (!isPlainObject(membership)
      || typeof membership.member_name !== "string"
      || typeof membership.role_name !== "string"
      || typeof membership.grantor_name !== "string"
      || typeof membership.admin_option !== "boolean"
      || typeof membership.inherit_option !== "boolean"
      || typeof membership.set_option !== "boolean") {
      throw new Error("website projection role graph is invalid");
    }
    const allowedOwnerRuntimeEdge =
      membership.member_name === "postgres"
      && membership.role_name === WEBSITE_PROJECTION_RUNTIME_ROLE
      && membership.grantor_name === "supabase_admin"
      && membership.admin_option === true
      && membership.inherit_option === false
      && membership.set_option === false;
    if ([
      WEBSITE_PROJECTION_RUNTIME_ROLE,
      "anon",
      "authenticated",
      "service_role",
    ].includes(membership.member_name)
      || (membership.role_name === WEBSITE_PROJECTION_RUNTIME_ROLE
        && !allowedOwnerRuntimeEdge)) {
      throw new Error(
        "website projection runtime and provider outgoing role membership is forbidden",
      );
    }
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
    || runtime.rolbypassrls !== false
    || Number(runtime.rolconnlimit) !== -1
    || runtime.rolvaliduntil !== null
    || !(runtime.rolconfig === null
      || (Array.isArray(runtime.rolconfig) && runtime.rolconfig.length === 0))) {
    throw new Error("website projection runtime role posture is invalid");
  }
  return Object.freeze({ runtimeRoleStatus: "current" });
}

export function assertWebsiteProjectionAdoptionSourceRoleGraph({
  roles,
  memberships,
}) {
  const runtime = Array.isArray(roles)
    ? roles.find(({ rolname }) =>
      rolname === WEBSITE_PROJECTION_RUNTIME_ROLE)
    : null;
  if (!isPlainObject(runtime)
    || runtime.rolcanlogin !== true
    || runtime.rolinherit !== true
    || runtime.rolsuper !== false
    || runtime.rolcreaterole !== false
    || runtime.rolcreatedb !== false
    || runtime.rolreplication !== false
    || runtime.rolbypassrls !== false
    || Number(runtime.rolconnlimit) !== -1
    || runtime.rolvaliduntil !== null
    || !(runtime.rolconfig === null
      || (Array.isArray(runtime.rolconfig) && runtime.rolconfig.length === 0))) {
    throw new Error("adopt-existing source runtime role posture is invalid");
  }
  assertWebsiteProjectionRoleGraph({
    roles: roles.map((role) => role === runtime
      ? { ...role, rolinherit: false }
      : role),
    memberships,
    appliedCount: WEBSITE_PROJECTION_ADOPTION_PREFIX_COUNT,
  });
  const ownerRuntimeEdges = memberships.filter(({ role_name: roleName }) =>
    roleName === WEBSITE_PROJECTION_RUNTIME_ROLE);
  if (ownerRuntimeEdges.length !== 1
    || ownerRuntimeEdges[0].member_name !== "postgres"
    || ownerRuntimeEdges[0].grantor_name !== "supabase_admin"
    || ownerRuntimeEdges[0].admin_option !== true
    || ownerRuntimeEdges[0].inherit_option !== false
    || ownerRuntimeEdges[0].set_option !== false) {
    throw new Error(
      "adopt-existing requires the exact postgres runtime admin membership",
    );
  }
  return Object.freeze({ runtimeRoleStatus: "adoptable-inherit-drift" });
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

export function assertWebsiteProjectionAdoptExistingConfirmation({
  plan,
  expectedProjectRef,
  expectedSourceSnapshotSha256,
  confirmAdoptExisting,
  confirmTarget,
  confirmSourceSnapshot,
  confirmAdoptThrough,
}) {
  assertWebsiteProjectionAdoptionSourcePlan(plan);
  if (confirmAdoptExisting !== plan.planSha256) {
    throw new Error(
      "adopt-existing confirmation must equal the reviewed source plan commitment",
    );
  }
  if (!PROJECT_REF.test(expectedProjectRef ?? "")
    || expectedProjectRef !== WEBSITE_PROJECTION_ADOPTION_TARGET_PROJECT_REF
    || confirmTarget !== expectedProjectRef) {
    throw new Error(
      "adopt-existing target confirmation must equal the verified project ref",
    );
  }
  if (expectedSourceSnapshotSha256
      !== WEBSITE_PROJECTION_ADOPTION_SOURCE_SNAPSHOT_SHA256
    || confirmSourceSnapshot !== expectedSourceSnapshotSha256) {
    throw new Error(
      "adopt-existing source snapshot confirmation must equal the protected snapshot",
    );
  }
  if (confirmAdoptThrough !== "0003") {
    throw new Error("adopt-existing through confirmation must equal 0003");
  }
}
