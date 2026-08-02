import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

const MIGRATION_FILE = /^(\d{14})_([a-z][a-z0-9_]*)\.sql$/u;
const HEX_SHA256 = /^0x[0-9a-f]{64}$/u;
const GIT_COMMIT = /^[0-9a-f]{40}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;

export const MIGRATION_PLAN_KIND =
  "programmable-hosted-db-migration-plan";
export const BOOTSTRAP_PLAN_KIND =
  "programmable-data-pipeline-bootstrap-plan";

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return JSON.stringify(value);
  }
  throw new Error("value is not canonical JSON");
}

export function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function migrationPlanPayload(plan) {
  return {
    kind: plan.kind,
    schemaVersion: plan.schemaVersion,
    repositoryCommit: plan.repositoryCommit,
    migrationRoot: plan.migrationRoot,
    migrationCount: plan.migrationCount,
    orderSha256: plan.orderSha256,
    migrations: plan.migrations,
  };
}

function migrationOrderCommitment(migrations) {
  return sha256(
    migrations
      .map(
        ({ ordinal, version, name, file, fileSha256, bytes }) =>
          `${ordinal}\0${version}\0${name}\0${file}\0${fileSha256}\0${bytes}`,
      )
      .join("\n"),
  );
}

export async function discoverMigrationPlan({
  workspace,
  repositoryCommit,
  migrationRoot = "supabase/migrations",
}) {
  if (!GIT_COMMIT.test(repositoryCommit)) {
    throw new Error("repository commit must be an exact full commit hash");
  }
  const root = path.resolve(workspace, migrationRoot);
  const workspacePath = await realpath(workspace);
  const rootPath = await realpath(root);
  if (
    rootPath !== workspacePath &&
    !rootPath.startsWith(`${workspacePath}${path.sep}`)
  ) {
    throw new Error("migration root escapes the repository");
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const migrationNames = entries
    .filter(({ name }) => name.endsWith(".sql"))
    .map(({ name }) => name)
    .sort();
  if (migrationNames.length === 0) {
    throw new Error("no migration files were found");
  }

  const migrations = [];
  const versions = new Set();
  for (const [index, fileName] of migrationNames.entries()) {
    const match = MIGRATION_FILE.exec(fileName);
    if (!match) {
      throw new Error(`noncanonical migration file: ${fileName}`);
    }
    const [, version, name] = match;
    if (versions.has(version)) {
      throw new Error(`duplicate migration version: ${version}`);
    }
    versions.add(version);
    const absolutePath = path.join(rootPath, fileName);
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`migration must be a regular file: ${fileName}`);
    }
    const contents = await readFile(absolutePath);
    if (contents.byteLength === 0) {
      throw new Error(`migration must not be empty: ${fileName}`);
    }
    migrations.push({
      ordinal: index + 1,
      version,
      name,
      file: path.posix.join(migrationRoot, fileName),
      fileSha256: sha256(contents),
      bytes: contents.byteLength,
    });
  }

  const plan = {
    kind: MIGRATION_PLAN_KIND,
    schemaVersion: 1,
    repositoryCommit,
    migrationRoot,
    migrationCount: migrations.length,
    orderSha256: migrationOrderCommitment(migrations),
    migrations,
  };
  return {
    ...plan,
    planSha256: sha256(canonicalJson(migrationPlanPayload(plan))),
  };
}

export function validateMigrationPlan(value) {
  if (
    !isPlainObject(value) ||
    value.kind !== MIGRATION_PLAN_KIND ||
    value.schemaVersion !== 1 ||
    !GIT_COMMIT.test(value.repositoryCommit ?? "") ||
    value.migrationRoot !== "supabase/migrations" ||
    !Number.isSafeInteger(value.migrationCount) ||
    value.migrationCount <= 0 ||
    !HEX_SHA256.test(value.orderSha256 ?? "") ||
    !HEX_SHA256.test(value.planSha256 ?? "") ||
    !Array.isArray(value.migrations) ||
    value.migrations.length !== value.migrationCount
  ) {
    throw new Error("migration plan is invalid");
  }
  const versions = new Set();
  for (const [index, migration] of value.migrations.entries()) {
    if (!isPlainObject(migration)) throw new Error("migration plan is invalid");
    const fileName = path.posix.basename(migration.file ?? "");
    const match = MIGRATION_FILE.exec(fileName);
    if (
      !match ||
      migration.file !== path.posix.join(value.migrationRoot, fileName) ||
      migration.ordinal !== index + 1 ||
      migration.version !== match[1] ||
      migration.name !== match[2] ||
      versions.has(migration.version) ||
      !HEX_SHA256.test(migration.fileSha256 ?? "") ||
      !Number.isSafeInteger(migration.bytes) ||
      migration.bytes <= 0
    ) {
      throw new Error("migration plan is invalid");
    }
    versions.add(migration.version);
  }
  if (migrationOrderCommitment(value.migrations) !== value.orderSha256) {
    throw new Error("migration order commitment does not match");
  }
  if (
    sha256(canonicalJson(migrationPlanPayload(value))) !== value.planSha256
  ) {
    throw new Error("migration plan commitment does not match");
  }
  return value;
}

export function validateDirectSupabaseTarget(rawUrl, expectedProjectRef) {
  if (!PROJECT_REF.test(expectedProjectRef ?? "")) {
    throw new Error("expected Supabase project ref is invalid");
  }
  if (typeof rawUrl !== "string" || rawUrl.length < 1 || rawUrl.length > 2048) {
    throw new Error("migrator database URL is required");
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("migrator database URL is invalid");
  }
  const parameters = [...parsed.searchParams.entries()];
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== `db.${expectedProjectRef}.supabase.co` ||
    parsed.port !== "5432" ||
    parsed.pathname !== "/postgres" ||
    !["postgres", "cli_login_postgres"].includes(
      decodeURIComponent(parsed.username),
    ) ||
    parsed.password.length < 1 ||
    parsed.hash !== "" ||
    parameters.length !== 1 ||
    parameters[0][0] !== "sslmode" ||
    parameters[0][1] !== "verify-full"
  ) {
    throw new Error(
      "migrator target must be the expected direct Supabase endpoint on port 5432 with sslmode=verify-full",
    );
  }
  return Object.freeze({
    projectRef: expectedProjectRef,
    host: parsed.hostname,
    port: 5432,
    database: "postgres",
    sslMode: "verify-full",
  });
}

export function compareMigrationHistory({
  plan,
  historyRows,
  evidenceRows,
  evidenceTablePresent,
}) {
  validateMigrationPlan(plan);
  if (!Array.isArray(historyRows) || !Array.isArray(evidenceRows)) {
    throw new Error("migration history response is invalid");
  }
  const localByVersion = new Map(
    plan.migrations.map((migration) => [migration.version, migration]),
  );
  const evidenceByVersion = new Map();
  for (const evidence of evidenceRows) {
    if (
      !isPlainObject(evidence) ||
      typeof evidence.version !== "string" ||
      evidenceByVersion.has(evidence.version)
    ) {
      throw new Error("migration evidence is invalid");
    }
    evidenceByVersion.set(evidence.version, evidence);
  }
  if (evidenceRows.length > 0 && !evidenceTablePresent) {
    throw new Error("migration evidence table state is invalid");
  }

  const applied = [];
  for (const [index, row] of historyRows.entries()) {
    if (!isPlainObject(row) || typeof row.version !== "string") {
      throw new Error("migration history is invalid");
    }
    const expected = plan.migrations[index];
    if (!expected || row.version !== expected.version) {
      throw new Error("remote migration history is not an exact local prefix");
    }
    if (row.name !== expected.name) {
      throw new Error(`remote migration name mismatch: ${row.version}`);
    }
    if (!Array.isArray(row.statements) || row.statements.length === 0) {
      throw new Error(`remote migration statements are missing: ${row.version}`);
    }
    const evidence = evidenceByVersion.get(row.version);
    if (!evidence) {
      throw new Error(`file evidence is missing for migration: ${row.version}`);
    }
    if (
      evidence.name !== expected.name ||
      evidence.file_name !== path.posix.basename(expected.file) ||
      Number(evidence.ordinal) !== expected.ordinal ||
      evidence.file_sha256 !== expected.fileSha256 ||
      !HEX_SHA256.test(evidence.plan_sha256 ?? "") ||
      !GIT_COMMIT.test(evidence.repository_commit ?? "")
    ) {
      throw new Error(`file evidence mismatch for migration: ${row.version}`);
    }
    applied.push(expected.version);
  }
  for (const version of evidenceByVersion.keys()) {
    if (!localByVersion.has(version) || !applied.includes(version)) {
      throw new Error(`orphan migration evidence: ${version}`);
    }
  }
  return Object.freeze({
    status: historyRows.length === plan.migrations.length ? "current" : "pending",
    appliedCount: applied.length,
    pending: plan.migrations.slice(applied.length).map(({ version, file }) => ({
      version,
      file,
    })),
  });
}

function assertProvider(provider) {
  if (
    !isPlainObject(provider) ||
    typeof provider.providerType !== "string" ||
    typeof provider.redactedIdentity !== "string" ||
    !HEX_SHA256.test(provider.deploymentCommitment ?? "") ||
    !HEX_SHA256.test(provider.schemaCommitment ?? "")
  ) {
    throw new Error("bootstrap provider commitment is invalid");
  }
}

export function buildBootstrapPlan({
  binding,
  bindingSha256,
  repositoryCommit,
  providers,
}) {
  if (
    !isPlainObject(binding) ||
    binding.schemaVersion !== 1 ||
    binding.chainId !== 1 ||
    !Array.isArray(binding.sources) ||
    binding.sources.length === 0 ||
    !Array.isArray(binding.releases) ||
    binding.releases.length === 0 ||
    !HEX_SHA256.test(bindingSha256 ?? "") ||
    !GIT_COMMIT.test(repositoryCommit ?? "") ||
    !Array.isArray(providers) ||
    providers.length !== 4
  ) {
    throw new Error("bootstrap input is invalid");
  }
  providers.forEach(assertProvider);
  const sourceByName = new Map(
    binding.sources.map((source) => [source.contractName, source]),
  );
  if (sourceByName.size !== binding.sources.length) {
    throw new Error("bootstrap sources are not unique");
  }

  const releases = binding.releases.map((release, index) => {
    const sources = release.sourceContracts.map((contractName) => {
      const source = sourceByName.get(contractName);
      if (!source) throw new Error("bootstrap release references an unknown source");
      return {
        contractName: source.contractName,
        address: source.address,
        inclusiveStartBlock: source.startBlock,
        runtimeCodeHash: source.runtimeCodeHash,
        unresolved: [
          "sourceRole",
          "sourceType",
          "recoverySelector",
          "abiEventSetCommitment",
          "artifactCreationCodeCommitment",
          "bindingCommitment",
        ],
      };
    });
    return {
      ordinal: index + 1,
      scope: {
        chainId: binding.chainId,
        releaseId: release.releaseVersion,
        modelId: release.model,
        sourceGroup: "core",
      },
      activationBlock: release.activationBlock,
      sourceBindings: sources,
      dynamicSourceTemplates: release.dynamicContracts.map((contractName) => ({
        contractName,
        unresolved: [
          "parentFactoryReleaseBindingId",
          "parentSourceRole",
          "factoryEventType",
          "deployedAddressField",
          "deployedSourceRole",
          "deployedArtifactCreationCodeCommitment",
          "normalizedRuntimeCodeHash",
          "immutableReferencesCommitment",
          "immutableBindingSpec",
          "immutableBindingCommitment",
          "runtimeCodeLength",
          "abiEventSetCommitment",
          "templateCommitment",
        ],
      })),
      unresolved: [
        "epochId",
        "epochNumber",
        "epochCommitment",
        "artifactCreationCodeCommitment",
        "createInputCommitment",
        "activationGeneration",
        "activationInputCommitment",
      ],
    };
  });

  const providerBindings = providers.map((provider) => ({
    ...provider,
    unresolved:
      provider.providerType === "rpc_provider"
        ? [
            "providerDeploymentId",
            "endpointEvidenceCommitment",
            "inputCommitment",
            "createdAt",
          ]
        : ["providerDeploymentId", "inputCommitment", "createdAt"],
  }));
  const payload = {
    kind: BOOTSTRAP_PLAN_KIND,
    schemaVersion: 1,
    repositoryCommit,
    releaseBinding: {
      path: "config/data-pipeline-release.v1.json",
      sha256: bindingSha256,
      chainId: binding.chainId,
      startBlock: binding.startBlock,
      confirmations: binding.confirmations,
    },
    providerBindings,
    releases,
    execution: {
      mode: "plan-only",
      ready: false,
      reason:
        "release bootstrap requires reviewed semantic, ABI, creation-code, endpoint-evidence and activation inputs that are not present in the release binding",
    },
  };
  return {
    ...payload,
    planSha256: sha256(canonicalJson(payload)),
  };
}

export function assertNoSecretOutput(value, secrets) {
  const serialized = canonicalJson(value);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0 && serialized.includes(secret)) {
      throw new Error("operator output contains a credential");
    }
  }
  return serialized;
}

export function safeFailure(error) {
  const code =
    typeof error === "object" &&
    error !== null &&
    typeof error.code === "string" &&
    /^[A-Z0-9]{5}$/u.test(error.code)
      ? ` (${error.code})`
      : "";
  return `operator failed${code}`;
}
