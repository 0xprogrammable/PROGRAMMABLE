#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  ROLE_SPECS,
  createBackupAndRestoreEvidence,
  provisionLoginRoles,
  verifyPoolerLogins,
} from "./cutover-credentials.mjs";
import {
  applyCandidateRestore,
  applyCandidateRuntimeEnable,
  applyCandidateSafetyRecovery,
  createCandidateRestorePlan,
  createCandidateRuntimeEnablePlan,
  createCandidateSafetyRecoveryPlan,
  createCandidateSafetyBackup,
  validateCandidateRuntimeEnablePlan,
} from "./candidate-restore.mjs";
import {
  attestCandidateDatabasePromotion,
  buildDatabasePromotionInput,
  inspectCandidateDatabase,
  inspectProjectorLeaseDrain,
  readCheckpointInventory,
  waitForProjectorLeaseDrain,
  withDirectOperatorDatabase,
} from "./cutover-database.mjs";
import {
  createEnvioPromotionAttestation,
  createRollbackPlan,
  loadEnvioCutoverIdentity,
  validateEnvioPromotionAttestation,
  validateRollbackEvidence,
} from "./cutover-envio.mjs";
import {
  captureAndGateStagedReadModel,
  createStagedWorkers,
  exactStagedTarget,
  inspectUnexposedStagedDeployment,
} from "./cutover-http.mjs";
import {
  assertCandidateFence,
  runPostAttestationStagedGates,
} from "./cutover-phases.mjs";
import { runConfiguredCandidateRawBackfill } from "./cutover-runtime.mjs";
import {
  assertNoSecretOutput,
  canonicalJson,
  discoverMigrationPlan,
  safeFailure,
  sha256,
} from "./hosted-db-operator-core.mjs";
import { validateStagedReleaseAttestation } from "../perf/read-model-deploy-policy.mjs";

const execute = promisify(execFile);
const workspace = fileURLToPath(new URL("../../", import.meta.url));
const CREDENTIAL_ENVIRONMENT_NAME =
  /(?:DATABASE_URL|PASSWORD|API_KEY|TOKEN|SECRET|SSL_CA(?:_PEM)?|RPC_URL)$/u;
const SHA256 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const PRIVATE_MODE = 0o600;

export const HELP = `Usage:
  node scripts/data-pipeline/cutover-operator.mjs roles-provision --expected-project-ref REF --output FILE
  node scripts/data-pipeline/cutover-operator.mjs roles-verify --expected-project-ref REF --pooler-host HOST --output FILE
  node scripts/data-pipeline/cutover-operator.mjs backup-restore --expected-project-ref REF --operation-id ID --restore-isolation-id ID --backup FILE --evidence FILE
  node scripts/data-pipeline/cutover-operator.mjs candidate-safety-backup --expected-project-ref REF --current-product-commit COMMIT --operation-id ID --restore-isolation-id ID --backup FILE --backup-evidence FILE --output FILE
  node scripts/data-pipeline/cutover-operator.mjs candidate-restore-plan --expected-project-ref REF --current-product-commit COMMIT --snapshot-repository-commit COMMIT --snapshot-backup FILE --snapshot-evidence FILE --safety-backup FILE --safety-backup-evidence FILE --safety-evidence FILE --output FILE
  node scripts/data-pipeline/cutover-operator.mjs candidate-restore-apply --expected-project-ref REF --current-product-commit COMMIT --snapshot-repository-commit COMMIT --snapshot-backup FILE --snapshot-evidence FILE --safety-backup FILE --safety-backup-evidence FILE --safety-evidence FILE --plan FILE --confirm-restore SHA256 --output FILE
  node scripts/data-pipeline/cutover-operator.mjs candidate-recovery-plan --expected-project-ref REF --current-product-commit COMMIT --safety-backup FILE --safety-backup-evidence FILE --safety-evidence FILE --output FILE
  node scripts/data-pipeline/cutover-operator.mjs candidate-recovery-apply --expected-project-ref REF --current-product-commit COMMIT --safety-backup FILE --safety-backup-evidence FILE --safety-evidence FILE --plan FILE --confirm-recovery SHA256 --output FILE
  node scripts/data-pipeline/cutover-operator.mjs candidate-runtime-enable-plan --expected-project-ref REF --pooler-host HOST --restore-result FILE --output FILE
  node scripts/data-pipeline/cutover-operator.mjs candidate-runtime-enable-apply --expected-project-ref REF --pooler-host HOST --restore-result FILE --plan FILE --confirm-enable SHA256 --output FILE
  node scripts/data-pipeline/cutover-operator.mjs raw-backfill --expected-project-ref REF --backup-evidence FILE --output FILE [--maximum-cycles N]
  node scripts/data-pipeline/cutover-operator.mjs projector-drain --expected-project-ref REF --target-url URL --deployment-id ID --release-gate FILE --output FILE
  node scripts/data-pipeline/cutover-operator.mjs envio-attest --observation FILE --drain-evidence FILE --output FILE
  node scripts/data-pipeline/cutover-operator.mjs database-plan --expected-project-ref REF --envio-attestation FILE --drain-evidence FILE --staged-deployment-id ID --output FILE
  node scripts/data-pipeline/cutover-operator.mjs database-apply --expected-project-ref REF --envio-attestation FILE --drain-evidence FILE --plan FILE --confirm-apply SHA256 --output FILE
  node scripts/data-pipeline/cutover-operator.mjs staged-gates --expected-project-ref REF --target-url URL --deployment-id ID --drain-evidence FILE --output-directory DIR --output FILE [--maximum-cycles N]
  node scripts/data-pipeline/cutover-operator.mjs rollback-plan --envio-attestation FILE --backup-evidence FILE --vercel-deployment-id ID --vercel-product-commit COMMIT --output FILE
  node scripts/data-pipeline/cutover-operator.mjs rollback-verify --plan FILE --observation FILE --output FILE

All credentials and certificates are environment-only. Evidence outputs must be
absolute paths outside the repository and are created as mode 0600 files.
`;

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

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    return { command: "help", flags: new Map() };
  }
  if (rest.length % 2 !== 0) throw new Error("operator arguments are invalid");
  const flags = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--") || flags.has(name)) {
      throw new Error("operator arguments are invalid");
    }
    flags.set(name, value);
  }
  return { command, flags };
}

function exactFlags(flags, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) throw new Error("operator argument is not allowed");
  }
  for (const key of required) {
    if (!flags.has(key)) throw new Error(`${key} is required`);
  }
}

function boundedCycles(value) {
  if (value === undefined) return 256;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 4096) {
    throw new Error("maximum cycles is invalid");
  }
  return parsed;
}

export function credentialsFromEnvironment(environment) {
  const names = {
    apiReader: "PROGRAMMABLE_API_READER_DATABASE_PASSWORD",
    projector: "PROGRAMMABLE_PROJECTOR_DATABASE_PASSWORD",
    projectorRuntime: "PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_PASSWORD",
    reconciler: "PROGRAMMABLE_RECONCILER_DATABASE_PASSWORD",
    releaseProbe: "PROGRAMMABLE_RELEASE_PROBE_DATABASE_PASSWORD",
  };
  const credentials = {};
  for (const { key } of ROLE_SPECS) credentials[key] = environment[names[key]];
  return credentials;
}

function secretValues(environment) {
  return Object.entries(environment)
    .filter(([name]) => CREDENTIAL_ENVIRONMENT_NAME.test(name))
    .map(([, value]) => value)
    .filter((value) => typeof value === "string" && value.length > 0);
}

function absoluteExternalPath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${label} must be an absolute path`);
  }
  const normalized = path.normalize(value);
  const relative = path.relative(workspace, normalized);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`${label} must be outside the repository`);
  }
  return normalized;
}

async function writePrivateOutput(value, outputPath, environment) {
  const target = absoluteExternalPath(outputPath, "output path");
  assertNoSecretOutput(value, secretValues(environment));
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const descriptor = await open(target, "wx", PRIVATE_MODE);
  try {
    await descriptor.writeFile(serialized, "utf8");
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
  await chmod(target, PRIVATE_MODE);
  return target;
}

async function syncParentDirectory(filePath) {
  const descriptor = await open(path.dirname(filePath), "r");
  try {
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
}

export async function reserveRuntimeEnableOutput({
  outputPath,
  planSha256,
  confirmationSha256,
  environment,
}) {
  const target = absoluteExternalPath(outputPath, "output path");
  const reservation = Object.freeze({
    kind: "programmable-candidate-runtime-enable-output-reservation",
    schemaVersion: 1,
    planSha256,
    confirmationSha256,
    status: "in-progress-or-resumable",
  });
  assertNoSecretOutput(reservation, secretValues(environment));
  const serialized = `${JSON.stringify(reservation, null, 2)}\n`;
  try {
    const descriptor = await open(target, "wx", PRIVATE_MODE);
    try {
      await descriptor.writeFile(serialized, "utf8");
      await descriptor.sync();
    } finally {
      await descriptor.close();
    }
    await chmod(target, PRIVATE_MODE);
    await syncParentDirectory(target);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readArtifact(target, { privateFile: true });
    if (canonicalJson(existing) !== canonicalJson(reservation)) {
      throw new Error("Candidate runtime enable output is not resumable");
    }
  }
  return Object.freeze({ target, reservation });
}

export async function commitRuntimeEnableOutput({ reservation, value, environment }) {
  assertNoSecretOutput(value, secretValues(environment));
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${reservation.target}.pending-${process.pid}-${randomUUID()}`;
  let created = false;
  try {
    const descriptor = await open(temporary, "wx", PRIVATE_MODE);
    created = true;
    try {
      await descriptor.writeFile(serialized, "utf8");
      await descriptor.sync();
    } finally {
      await descriptor.close();
    }
    await chmod(temporary, PRIVATE_MODE);
    await rename(temporary, reservation.target);
    created = false;
    await syncParentDirectory(reservation.target);
  } finally {
    if (created) await unlink(temporary).catch(() => {});
  }
  return reservation.target;
}

export async function runRuntimeEnableWithReservedOutput({
  outputPath,
  planSha256,
  confirmationSha256,
  environment,
  apply,
}) {
  if (typeof apply !== "function") {
    throw new Error("Candidate runtime enable apply callback is invalid");
  }
  const reservation = await reserveRuntimeEnableOutput({
    outputPath,
    planSha256,
    confirmationSha256,
    environment,
  });
  const result = await apply();
  await commitRuntimeEnableOutput({ reservation, value: result, environment });
  return result;
}

async function readArtifact(filePath, { privateFile = false } = {}) {
  const target = path.resolve(filePath);
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("evidence artifact must be a regular file");
  }
  if (privateFile && (metadata.mode & 0o777) !== PRIVATE_MODE) {
    throw new Error("operator evidence must have mode 0600");
  }
  return plainObject(JSON.parse(await readFile(target, "utf8")), "evidence artifact");
}

export function evidenceCommitment(value, label = "evidence") {
  const object = plainObject(value, label);
  const candidates = [
    object.evidenceSha256,
    object.releaseEvidenceSha256,
    object.attestationSha256,
    object.rollbackEvidenceSha256,
  ].filter((candidate) => typeof candidate === "string");
  if (candidates.length > 1 || (candidates.length === 1 && !SHA256.test(candidates[0]))) {
    throw new Error(`${label} commitment is invalid`);
  }
  return candidates[0] ?? sha256(canonicalJson(object));
}

async function gitCommit() {
  const { stdout } = await execute("git", ["rev-parse", "HEAD"], { cwd: workspace });
  const commit = stdout.trim();
  if (!COMMIT.test(commit)) throw new Error("repository commit is invalid");
  return commit;
}

async function assertCleanCheckout() {
  const { stdout } = await execute(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: workspace },
  );
  if (stdout.trim() !== "") throw new Error("cutover checkout must be clean");
  return gitCommit();
}

function directDatabase(environment, expectedProjectRef) {
  return {
    databaseUrl: environment.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
    expectedProjectRef,
    sslCaPem: environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
  };
}

function identityTarget(target) {
  return {
    mirrorCommit: target.mirrorCommit,
    deploymentLabel: target.deploymentLabel,
    endpoint: target.endpoint,
    endpointId: target.endpointId,
    runtimeIdentity: target.runtimeIdentity,
    inventorySha256: target.inventory.sha256,
  };
}

export function assertAttestationMatchesIdentity(attestation, identity) {
  const validated = validateEnvioPromotionAttestation(attestation);
  if (
    canonicalJson(validated.candidateTarget) !== canonicalJson(identityTarget(identity.candidate)) ||
    canonicalJson(validated.rollbackTarget) !== canonicalJson(identityTarget(identity.rollback))
  ) {
    throw new Error("Envio attestation does not match checked-in cutover identity");
  }
  return validated;
}

function assertBackupEvidence(value, commit) {
  const evidence = plainObject(value, "backup evidence");
  if (
    evidence.kind !== "programmable-database-backup-restore-evidence" ||
    evidence.schemaVersion !== 1 ||
    evidence.repositoryCommit !== commit ||
    evidence.sourceManifestSha256 !== evidence.restoredManifestSha256 ||
    !SHA256.test(evidence.sourceManifestSha256 ?? "") ||
    !SHA256.test(evidence.backup?.sha256 ?? "")
  ) {
    throw new Error("backup and restore evidence is not valid for this commit");
  }
  return evidence;
}

export function assertProjectorDrainEvidence(value, commit, stagedDeploymentId) {
  const evidence = plainObject(value, "projector drain evidence");
  if (
    evidence.kind !== "programmable-projector-drain-evidence" ||
    evidence.schemaVersion !== 1 ||
    evidence.productCommit !== commit ||
    (stagedDeploymentId !== undefined &&
      evidence.stagedDeploymentId !== stagedDeploymentId) ||
    evidence.publicationFence !== "closed" ||
    evidence.stageExposure?.stagedDeploymentId !== evidence.stagedDeploymentId ||
    evidence.stageExposure?.stagedTarget !== evidence.stagedTarget ||
    evidence.stageExposure?.productCommit !== commit ||
    evidence.stageExposure?.productionDomainAssigned !== false ||
    evidence.stageExposure?.schedulerExposure !== false ||
    !Array.isArray(evidence.stageExposure?.assignedAliases) ||
    evidence.stageExposure.assignedAliases.length !== 0 ||
    evidence.leaseDrain?.drained !== true ||
    !Number.isSafeInteger(evidence.leaseDrain?.stabilityWindowMs) ||
    evidence.leaseDrain.stabilityWindowMs < 65_000 ||
    !Number.isSafeInteger(evidence.leaseDrain?.stableForMs) ||
    evidence.leaseDrain.stableForMs < evidence.leaseDrain.stabilityWindowMs ||
    !SHA256.test(evidence.releaseGateEvidenceSha256 ?? "") ||
    !SHA256.test(evidence.evidenceSha256 ?? "")
  ) {
    throw new Error("projector drain evidence is invalid for this cutover");
  }
  const { evidenceSha256, ...payload } = evidence;
  if (sha256(canonicalJson(payload)) !== evidenceSha256) {
    throw new Error("projector drain evidence commitment is invalid");
  }
  return evidence;
}

export function assertStagedGateMatchesDrain(
  value,
  commit,
  stagedDeploymentId,
  targetUrl,
) {
  const evidence = assertProjectorDrainEvidence(value, commit, stagedDeploymentId);
  const target = exactStagedTarget(targetUrl, stagedDeploymentId);
  if (evidence.stagedTarget !== target.toString()) {
    throw new Error("staged gate target differs from the drained deployment");
  }
  return evidence;
}

async function reverifyUnexposedStage(evidence, environment) {
  const observed = await inspectUnexposedStagedDeployment({
    targetUrl: evidence.stagedTarget,
    deploymentId: evidence.stagedDeploymentId,
    productCommit: evidence.productCommit,
    projectId: environment.VERCEL_PROJECT_ID,
    token: environment.VERCEL_TOKEN,
    teamId: environment.VERCEL_ORG_ID,
    productionDomain: evidence.stageExposure.productionDomain,
  });
  if (canonicalJson(observed) !== canonicalJson(evidence.stageExposure)) {
    throw new Error("staged deployment exposure changed after the drain gate");
  }
  return observed;
}

async function createDatabasePlan({
  environment,
  expectedProjectRef,
  attestationPath,
  drainEvidencePath,
  stagedDeploymentId,
}) {
  const commit = await assertCleanCheckout();
  const identity = await loadEnvioCutoverIdentity({ workspace });
  const attestation = assertAttestationMatchesIdentity(
    await readArtifact(attestationPath, { privateFile: true }),
    identity,
  );
  if (attestation.productGitCommit !== commit) {
    throw new Error("Envio attestation is for a different product commit");
  }
  const drain = assertProjectorDrainEvidence(
    await readArtifact(drainEvidencePath, { privateFile: true }),
    commit,
    stagedDeploymentId,
  );
  if (attestation.releaseGateEvidenceSha256 !== drain.evidenceSha256) {
    throw new Error("Envio attestation is not bound to the projector drain gate");
  }
  await reverifyUnexposedStage(drain, environment);
  return withDirectOperatorDatabase(
    directDatabase(environment, expectedProjectRef),
    async (sql) => {
      const state = assertCandidateFence(await inspectCandidateDatabase(sql), "fenced");
      return buildDatabasePromotionInput({
        candidateEndpointIdentity: `envio:${identity.candidate.endpointId}`,
        envioProviderDeploymentId: state.envioProviderDeploymentId,
        baselineCommitment: identity.rollback.inventory.artifactDigest,
        candidateInventoryParityCommitment: identity.candidate.inventory.sha256,
        envioPromotionAttestationCommitment: attestation.attestationSha256,
        productCommit: commit,
        stagedDeploymentId,
        promotedAt: attestation.observedAt,
      });
    },
  );
}

async function runCommand(command, flags, environment) {
  if (command === "roles-provision") {
    exactFlags(flags, ["--expected-project-ref", "--output"]);
    const result = await provisionLoginRoles({
      ...directDatabase(environment, flags.get("--expected-project-ref")),
      credentials: credentialsFromEnvironment(environment),
    });
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "roles-verify") {
    exactFlags(flags, ["--expected-project-ref", "--pooler-host", "--output"]);
    const result = await verifyPoolerLogins({
      expectedProjectRef: flags.get("--expected-project-ref"),
      poolerHost: flags.get("--pooler-host"),
      sslCaPem: environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
      credentials: credentialsFromEnvironment(environment),
    });
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "backup-restore") {
    exactFlags(flags, [
      "--expected-project-ref",
      "--operation-id",
      "--restore-isolation-id",
      "--backup",
      "--evidence",
    ]);
    return createBackupAndRestoreEvidence({
      operationId: flags.get("--operation-id"),
      repositoryCommit: await assertCleanCheckout(),
      sourceDatabaseUrl: environment.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
      expectedProjectRef: flags.get("--expected-project-ref"),
      sslCaPem: environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
      restoreDatabaseUrl: environment.PROGRAMMABLE_CUTOVER_RESTORE_DATABASE_URL,
      restoreIsolationId: flags.get("--restore-isolation-id"),
      restoreSslCaPem: environment.PROGRAMMABLE_CUTOVER_RESTORE_SSL_CA_PEM,
      backupPath: absoluteExternalPath(flags.get("--backup"), "backup path"),
      evidencePath: absoluteExternalPath(flags.get("--evidence"), "evidence path"),
    });
  }
  if (command === "candidate-safety-backup") {
    exactFlags(flags, [
      "--expected-project-ref",
      "--current-product-commit",
      "--operation-id",
      "--restore-isolation-id",
      "--backup",
      "--backup-evidence",
      "--output",
    ]);
    const repositoryCommit = await assertCleanCheckout();
    const result = await createCandidateSafetyBackup({
      repositoryCommit,
      currentProductCommit: flags.get("--current-product-commit"),
      operationId: flags.get("--operation-id"),
      expectedProjectRef: flags.get("--expected-project-ref"),
      databaseUrl: environment.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
      sslCaPem: environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
      restoreDatabaseUrl: environment.PROGRAMMABLE_CUTOVER_RESTORE_DATABASE_URL,
      restoreIsolationId: flags.get("--restore-isolation-id"),
      restoreSslCaPem: environment.PROGRAMMABLE_CUTOVER_RESTORE_SSL_CA_PEM,
      backupPath: absoluteExternalPath(flags.get("--backup"), "safety backup path"),
      backupEvidencePath: absoluteExternalPath(
        flags.get("--backup-evidence"),
        "safety backup evidence path",
      ),
      pgDumpBinary: environment.PROGRAMMABLE_PG_DUMP_BINARY,
      pgRestoreBinary: environment.PROGRAMMABLE_PG_RESTORE_BINARY,
      psqlBinary: environment.PROGRAMMABLE_PSQL_BINARY,
    });
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "candidate-restore-plan" || command === "candidate-restore-apply") {
    const commonFlags = [
      "--expected-project-ref",
      "--current-product-commit",
      "--snapshot-repository-commit",
      "--snapshot-backup",
      "--snapshot-evidence",
      "--safety-backup",
      "--safety-backup-evidence",
      "--safety-evidence",
      "--output",
    ];
    exactFlags(
      flags,
      command === "candidate-restore-apply"
        ? [...commonFlags, "--plan", "--confirm-restore"]
        : commonFlags,
    );
    const repositoryCommit = await assertCleanCheckout();
    const snapshotBackupPath = absoluteExternalPath(
      flags.get("--snapshot-backup"),
      "snapshot backup path",
    );
    const safetyBackupPath = absoluteExternalPath(
      flags.get("--safety-backup"),
      "safety backup path",
    );
    const snapshotEvidence = await readArtifact(
      flags.get("--snapshot-evidence"),
      { privateFile: true },
    );
    const safetyEvidence = await readArtifact(flags.get("--safety-evidence"), {
      privateFile: true,
    });
    const safetyBackupEvidence = await readArtifact(
      flags.get("--safety-backup-evidence"),
      { privateFile: true },
    );
    const plan = await createCandidateRestorePlan({
      repositoryCommit,
      currentProductCommit: flags.get("--current-product-commit"),
      expectedProjectRef: flags.get("--expected-project-ref"),
      databaseUrl: environment.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
      sslCaPem: environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
      snapshotRepositoryCommit: flags.get("--snapshot-repository-commit"),
      snapshotBackupPath,
      snapshotEvidence,
      safetyBackupPath,
      safetyEvidence,
      safetyBackupEvidence,
      pgDumpBinary: environment.PROGRAMMABLE_PG_DUMP_BINARY,
      pgRestoreBinary: environment.PROGRAMMABLE_PG_RESTORE_BINARY,
      psqlBinary: environment.PROGRAMMABLE_PSQL_BINARY,
      secrets: secretValues(environment),
    });
    if (command === "candidate-restore-plan") {
      await writePrivateOutput(plan, flags.get("--output"), environment);
      return plan;
    }
    const reviewed = await readArtifact(flags.get("--plan"), {
      privateFile: true,
    });
    if (canonicalJson(reviewed) !== canonicalJson(plan)) {
      throw new Error("Candidate restore plan changed after review");
    }
    const result = await applyCandidateRestore({
      plan,
      confirmRestore: flags.get("--confirm-restore"),
      expectedProjectRef: flags.get("--expected-project-ref"),
      databaseUrl: environment.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
      sslCaPem: environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
      snapshotBackupPath,
      safetyBackupPath,
      safetyEvidence,
      safetyBackupEvidence,
      pgDumpBinary: environment.PROGRAMMABLE_PG_DUMP_BINARY,
      pgRestoreBinary: environment.PROGRAMMABLE_PG_RESTORE_BINARY,
      psqlBinary: environment.PROGRAMMABLE_PSQL_BINARY,
    });
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "candidate-recovery-plan" || command === "candidate-recovery-apply") {
    const commonFlags = [
      "--expected-project-ref",
      "--current-product-commit",
      "--safety-backup",
      "--safety-backup-evidence",
      "--safety-evidence",
      "--output",
    ];
    exactFlags(
      flags,
      command === "candidate-recovery-apply"
        ? [...commonFlags, "--plan", "--confirm-recovery"]
        : commonFlags,
    );
    const repositoryCommit = await assertCleanCheckout();
    const safetyBackupPath = absoluteExternalPath(
      flags.get("--safety-backup"),
      "safety backup path",
    );
    const safetyEvidence = await readArtifact(flags.get("--safety-evidence"), {
      privateFile: true,
    });
    const safetyBackupEvidence = await readArtifact(
      flags.get("--safety-backup-evidence"),
      { privateFile: true },
    );
    const plan = await createCandidateSafetyRecoveryPlan({
      repositoryCommit,
      currentProductCommit: flags.get("--current-product-commit"),
      expectedProjectRef: flags.get("--expected-project-ref"),
      databaseUrl: environment.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
      sslCaPem: environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
      safetyBackupPath,
      safetyEvidence,
      safetyBackupEvidence,
      pgDumpBinary: environment.PROGRAMMABLE_PG_DUMP_BINARY,
      pgRestoreBinary: environment.PROGRAMMABLE_PG_RESTORE_BINARY,
      psqlBinary: environment.PROGRAMMABLE_PSQL_BINARY,
      secrets: secretValues(environment),
    });
    if (command === "candidate-recovery-plan") {
      await writePrivateOutput(plan, flags.get("--output"), environment);
      return plan;
    }
    const reviewed = await readArtifact(flags.get("--plan"), {
      privateFile: true,
    });
    if (canonicalJson(reviewed) !== canonicalJson(plan)) {
      throw new Error("Candidate safety recovery plan changed after review");
    }
    const result = await applyCandidateSafetyRecovery({
      plan,
      confirmRecovery: flags.get("--confirm-recovery"),
      expectedProjectRef: flags.get("--expected-project-ref"),
      databaseUrl: environment.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
      sslCaPem: environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
      safetyBackupPath,
      safetyEvidence,
      safetyBackupEvidence,
      pgDumpBinary: environment.PROGRAMMABLE_PG_DUMP_BINARY,
      pgRestoreBinary: environment.PROGRAMMABLE_PG_RESTORE_BINARY,
      psqlBinary: environment.PROGRAMMABLE_PSQL_BINARY,
    });
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (
    command === "candidate-runtime-enable-plan" ||
    command === "candidate-runtime-enable-apply"
  ) {
    const commonFlags = [
      "--expected-project-ref",
      "--pooler-host",
      "--restore-result",
      "--output",
    ];
    exactFlags(
      flags,
      command === "candidate-runtime-enable-apply"
        ? [...commonFlags, "--plan", "--confirm-enable"]
        : commonFlags,
    );
    const repositoryCommit = await assertCleanCheckout();
    const restoreResult = await readArtifact(flags.get("--restore-result"), {
      privateFile: true,
    });
    const migrationPlan = await discoverMigrationPlan({
      workspace,
      repositoryCommit,
    });
    if (command === "candidate-runtime-enable-plan") {
      const plan = await createCandidateRuntimeEnablePlan({
        repositoryCommit,
        expectedProjectRef: flags.get("--expected-project-ref"),
        databaseUrl: environment.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
        sslCaPem: environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
        poolerHost: flags.get("--pooler-host"),
        restoreResult,
        migrationPlan,
      });
      await writePrivateOutput(plan, flags.get("--output"), environment);
      return plan;
    }
    const plan = validateCandidateRuntimeEnablePlan(
      await readArtifact(flags.get("--plan"), { privateFile: true }),
    );
    if (flags.get("--confirm-enable") !== plan.confirmEnable) {
      throw new Error("Candidate runtime enable confirmation does not match");
    }
    if (
      plan.operatorCommit !== repositoryCommit ||
      plan.restoreEvidenceSha256 !== restoreResult.evidenceSha256 ||
      plan.migrationPlanSha256 !== migrationPlan.planSha256
    ) {
      throw new Error("Candidate runtime enable evidence differs from the plan");
    }
    return runRuntimeEnableWithReservedOutput({
      outputPath: flags.get("--output"),
      planSha256: plan.planSha256,
      confirmationSha256: flags.get("--confirm-enable"),
      environment,
      apply: () => applyCandidateRuntimeEnable({
        plan,
        confirmEnable: flags.get("--confirm-enable"),
        expectedProjectRef: flags.get("--expected-project-ref"),
        databaseUrl: environment.PROGRAMMABLE_MIGRATOR_DATABASE_URL,
        sslCaPem: environment.PROGRAMMABLE_POSTGRES_SSL_CA_PEM,
        poolerHost: flags.get("--pooler-host"),
        restoreResult,
        migrationPlan,
        credentials: credentialsFromEnvironment(environment),
      }),
    });
  }
  if (command === "raw-backfill") {
    exactFlags(
      flags,
      ["--expected-project-ref", "--backup-evidence", "--output"],
      ["--maximum-cycles"],
    );
    const commit = await assertCleanCheckout();
    assertBackupEvidence(await readArtifact(flags.get("--backup-evidence"), { privateFile: true }), commit);
    const startedAt = new Date().toISOString();
    const result = await withDirectOperatorDatabase(
      directDatabase(environment, flags.get("--expected-project-ref")),
      (sql) => runConfiguredCandidateRawBackfill({
        environment,
        maximumCycles: boundedCycles(flags.get("--maximum-cycles")),
        inspectFence: () => inspectCandidateDatabase(sql),
        startedAt,
        completedAt: () => new Date().toISOString(),
      }),
    );
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "projector-drain") {
    exactFlags(flags, [
      "--expected-project-ref",
      "--target-url",
      "--deployment-id",
      "--release-gate",
      "--output",
    ]);
    const commit = await assertCleanCheckout();
    const target = exactStagedTarget(flags.get("--target-url"), flags.get("--deployment-id"));
    const gate = validateStagedReleaseAttestation(
      await readArtifact(flags.get("--release-gate"), { privateFile: true }),
      {
        verifiedSha: commit,
        vercelProjectId: environment.VERCEL_PROJECT_ID,
        stagedDeploymentId: flags.get("--deployment-id"),
        stagedDeploymentUrl: target.origin,
        productionOrigin: "https://programmable.family",
        requireWorkersActive: true,
        requireIndexedRoutesActive: true,
      },
    );
    const stageExposure = await inspectUnexposedStagedDeployment({
      targetUrl: target.toString(),
      deploymentId: flags.get("--deployment-id"),
      productCommit: commit,
      projectId: environment.VERCEL_PROJECT_ID,
      token: environment.VERCEL_TOKEN,
      teamId: environment.VERCEL_ORG_ID,
    });
    const result = await withDirectOperatorDatabase(
      directDatabase(environment, flags.get("--expected-project-ref")),
      async (sql) => {
        const fence = assertCandidateFence(await inspectCandidateDatabase(sql), "fenced");
        const leaseDrain = await waitForProjectorLeaseDrain({
          inspect: () => inspectProjectorLeaseDrain(sql),
          stabilityWindowMs: 65_000,
        });
        const payload = {
          kind: "programmable-projector-drain-evidence",
          schemaVersion: 1,
          productCommit: commit,
          stagedDeploymentId: flags.get("--deployment-id"),
          stagedTarget: target.toString(),
          candidateEndpointIdentity: "envio:d7a39a2",
          releaseGateEvidenceSha256: evidenceCommitment(gate, "release gate evidence"),
          publicationFence: "closed",
          envioProviderDeploymentId: fence.envioProviderDeploymentId,
          stageExposure,
          leaseDrain,
          completedAt: new Date().toISOString(),
        };
        return Object.freeze({
          ...payload,
          evidenceSha256: sha256(canonicalJson(payload)),
        });
      },
    );
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "envio-attest") {
    exactFlags(flags, ["--observation", "--drain-evidence", "--output"]);
    const commit = await assertCleanCheckout();
    const identity = await loadEnvioCutoverIdentity({ workspace });
    const observation = await readArtifact(flags.get("--observation"), { privateFile: true });
    const drain = assertProjectorDrainEvidence(
      await readArtifact(flags.get("--drain-evidence"), { privateFile: true }),
      commit,
    );
    const result = createEnvioPromotionAttestation({
      identity,
      observedAt: observation.observedAt,
      productGitCommit: commit,
      releaseGateEvidenceSha256: drain.evidenceSha256,
      controlPlane: observation.controlPlane,
      runtime: observation.runtime,
      auditedInventory: identity.candidate.inventory,
      existingAttestation: null,
    });
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "database-plan") {
    exactFlags(flags, [
      "--expected-project-ref",
      "--envio-attestation",
      "--drain-evidence",
      "--staged-deployment-id",
      "--output",
    ]);
    exactStagedTarget("https://candidate.vercel.app/", flags.get("--staged-deployment-id"));
    const result = await createDatabasePlan({
      environment,
      expectedProjectRef: flags.get("--expected-project-ref"),
      attestationPath: flags.get("--envio-attestation"),
      drainEvidencePath: flags.get("--drain-evidence"),
      stagedDeploymentId: flags.get("--staged-deployment-id"),
    });
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "database-apply") {
    exactFlags(flags, [
      "--expected-project-ref",
      "--envio-attestation",
      "--drain-evidence",
      "--plan",
      "--confirm-apply",
      "--output",
    ]);
    const reviewed = await readArtifact(flags.get("--plan"), { privateFile: true });
    const rebuilt = await createDatabasePlan({
      environment,
      expectedProjectRef: flags.get("--expected-project-ref"),
      attestationPath: flags.get("--envio-attestation"),
      drainEvidencePath: flags.get("--drain-evidence"),
      stagedDeploymentId: reviewed.stagedDeploymentId,
    });
    if (
      canonicalJson(reviewed) !== canonicalJson(rebuilt) ||
      flags.get("--confirm-apply") !== rebuilt.inputCommitment
    ) {
      throw new Error("database promotion confirmation does not match the reviewed plan");
    }
    const result = await withDirectOperatorDatabase(
      directDatabase(environment, flags.get("--expected-project-ref")),
      async (sql) => {
        const changed = await attestCandidateDatabasePromotion({ sql, promotion: rebuilt });
        const state = assertCandidateFence(await inspectCandidateDatabase(sql), "attested");
        if (state.promotionAttestationCommitment !== rebuilt.envioPromotionAttestationCommitment) {
          throw new Error("database promotion attestation did not persist exactly");
        }
        if (
          state.productCommit !== rebuilt.productCommit ||
          state.stagedDeploymentId !== rebuilt.stagedDeploymentId
        ) {
          throw new Error("database promotion deployment binding did not persist exactly");
        }
        return {
          kind: "programmable-database-promotion-result",
          schemaVersion: 1,
          changed: changed.changed,
          promotionInputCommitment: rebuilt.inputCommitment,
          state,
        };
      },
    );
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "staged-gates") {
    exactFlags(
      flags,
      [
        "--expected-project-ref",
        "--target-url",
        "--deployment-id",
        "--drain-evidence",
        "--output-directory",
        "--output",
      ],
      ["--maximum-cycles"],
    );
    const commit = await assertCleanCheckout();
    const drain = assertStagedGateMatchesDrain(
      await readArtifact(flags.get("--drain-evidence"), { privateFile: true }),
      commit,
      flags.get("--deployment-id"),
      flags.get("--target-url"),
    );
    await reverifyUnexposedStage(drain, environment);
    const target = exactStagedTarget(flags.get("--target-url"), flags.get("--deployment-id"));
    const workers = createStagedWorkers({
      targetUrl: target.toString(),
      deploymentId: flags.get("--deployment-id"),
      cronSecret: environment.CRON_SECRET,
      automationBypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
    });
    const result = await withDirectOperatorDatabase(
      directDatabase(environment, flags.get("--expected-project-ref")),
      (sql) => runPostAttestationStagedGates({
        candidateEndpointIdentity: "envio:d7a39a2",
        stagedDeploymentId: flags.get("--deployment-id"),
        productCommit: commit,
        maximumWorkerCycles: boundedCycles(flags.get("--maximum-cycles")),
        inspectFence: () => inspectCandidateDatabase(sql),
        readCheckpoints: () => readCheckpointInventory(sql),
        ...workers,
        runLoadGate: () => captureAndGateStagedReadModel({
          targetUrl: target.toString(),
          deploymentId: flags.get("--deployment-id"),
          outputDirectory: absoluteExternalPath(flags.get("--output-directory"), "output directory"),
          workspace,
          environment,
        }),
        completedAt: () => new Date().toISOString(),
      }),
    );
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "rollback-plan") {
    exactFlags(flags, [
      "--envio-attestation",
      "--backup-evidence",
      "--vercel-deployment-id",
      "--vercel-product-commit",
      "--output",
    ]);
    const commit = await assertCleanCheckout();
    const identity = await loadEnvioCutoverIdentity({ workspace });
    const attestation = assertAttestationMatchesIdentity(
      await readArtifact(flags.get("--envio-attestation"), { privateFile: true }),
      identity,
    );
    if (attestation.productGitCommit !== commit) {
      throw new Error("Envio attestation is for a different product commit");
    }
    const backup = assertBackupEvidence(
      await readArtifact(flags.get("--backup-evidence"), { privateFile: true }),
      commit,
    );
    const result = createRollbackPlan({
      identity,
      promotionAttestation: attestation,
      createdAt: new Date().toISOString(),
      databaseRecovery: {
        mode: "restore-pre-attestation-snapshot",
        evidenceId: `supabase:${backup.operationId}`,
        evidenceSha256: evidenceCommitment(backup, "backup evidence"),
      },
      vercelProduction: {
        deploymentId: flags.get("--vercel-deployment-id"),
        productGitCommit: flags.get("--vercel-product-commit"),
      },
      existingPlan: null,
    });
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  if (command === "rollback-verify") {
    exactFlags(flags, ["--plan", "--observation", "--output"]);
    await assertCleanCheckout();
    const identity = await loadEnvioCutoverIdentity({ workspace });
    const plan = await readArtifact(flags.get("--plan"), { privateFile: true });
    const observation = await readArtifact(flags.get("--observation"), { privateFile: true });
    const result = validateRollbackEvidence({
      identity,
      plan,
      ...observation,
      existingEvidence: null,
    });
    await writePrivateOutput(result, flags.get("--output"), environment);
    return result;
  }
  throw new Error("unknown cutover operator command");
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const { command, flags } = parseArguments(argv);
  if (command === "help") {
    process.stdout.write(HELP);
    return null;
  }
  return runCommand(command, flags, environment);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${safeFailure(error)}\n`);
    process.exitCode = 1;
  });
}
