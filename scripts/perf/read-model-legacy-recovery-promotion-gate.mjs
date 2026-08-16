#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const LEGACY_RECOVERY_HANDOFF_SCHEMA =
  "programmable.legacy-recovery-stage-handoff.v1";
export const LEGACY_RECOVERY_HANDOFF_MAXIMUM_AGE_MS = 2 * 60 * 60 * 1_000;
export const LEGACY_RECOVERY_INDEXED_FLAG_NAMES = Object.freeze([
  "INDEXED_EXPLORE_LIST_READS_ENABLED",
  "INDEXED_EXPLORE_TOKEN_READS_ENABLED",
  "INDEXED_EXPLORE_CHART_READS_ENABLED",
  "INDEXED_CREATOR_PROFILE_READS_ENABLED",
  "INDEXED_CLASSIC_V3_PROFILE_READS_ENABLED",
  "INDEXED_LAUNCH_LOOKUP_ENABLED",
  "INDEXED_PUBLIC_INDEXER_FEED_READS_ENABLED",
  "INDEXED_READ_SHADOW_COMPARE_ENABLED",
]);
export const LEGACY_RECOVERY_WORKER_FLAG_NAMES = Object.freeze([
  "PROGRAMMABLE_PROJECTOR_ACTIVE",
  "PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE",
]);

const REPOSITORY = "0xprogrammable/programmable";
const REPOSITORY_ID = "1314365508";
const PRODUCTION_REF = "refs/heads/production";
const STAGE_WORKFLOW = ".github/workflows/deploy-production.yml";
const PRODUCTION_ORIGIN = "https://programmable.market";
const RELEASE_LANE = "legacy-durable-blob-dex-recovery";
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,80}$/u;
const PROJECT_ID = /^prj_[A-Za-z0-9]{8,80}$/u;
const POSITIVE_UINT = /^[1-9][0-9]{0,77}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const RUN_ATTEMPT = /^[1-9][0-9]{0,5}$/u;
const ARTIFACT_ID = /^[1-9][0-9]{0,19}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CUSTOM_LAUNCH_PUBLIC_FLAG =
  "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED";
const CUSTOM_REGISTRY_PUBLIC_FLAG =
  "PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED";
const RUNTIME_DISABLED_FLAG_NAMES = Object.freeze([
  ...LEGACY_RECOVERY_INDEXED_FLAG_NAMES,
  ...LEGACY_RECOVERY_WORKER_FLAG_NAMES,
  CUSTOM_LAUNCH_PUBLIC_FLAG,
  CUSTOM_REGISTRY_PUBLIC_FLAG,
]);
const REQUIRED_CUSTOM_V2_CHECKS = Object.freeze([
  "registry-v2-manifest",
  "registry-v2-prelaunch",
  "generic-v2-projector-unauthorized",
  "generic-v2-signer-probe-disabled",
  "generic-v2-disabled",
  "generic-v2-detail-disabled",
  "custom-v2-ui-routes",
]);

function fail(label) {
  throw new Error(`legacy recovery promotion ${label} is invalid`);
}

function exactObject(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) fail(label);
  return value;
}

function exactString(value, expected, label) {
  if (value !== expected) fail(label);
  return value;
}

function pattern(value, expression, label) {
  if (typeof value !== "string" || !expression.test(value)) fail(label);
  return value;
}

function exactFalse(value, label) {
  if (value !== false && value !== "false") fail(label);
  return false;
}

function exactTrue(value, label) {
  if (value !== true && value !== "true") fail(label);
  return true;
}

function exactOrigin(value, label, requireVercel = false) {
  let target;
  try {
    target = new URL(value);
  } catch {
    return fail(label);
  }
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== "" ||
    (requireVercel && !target.hostname.endsWith(".vercel.app"))
  ) fail(label);
  return target.origin;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readJsonFile(path, label) {
  const bytes = readFileSync(path);
  if (bytes.byteLength < 2 || bytes.byteLength > 4 * 1024 * 1024) fail(label);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return fail(label);
  }
  return Object.freeze({ bytes, value });
}

function decodedDotenvBoolean(raw, name) {
  let value = raw.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
    if (/[\\\r\n]/u.test(value)) fail(`${name} runtime flag`);
  }
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  return fail(`${name} runtime flag`);
}

export function disabledLegacyRecoveryRuntimeFlags(envSource) {
  if (typeof envSource !== "string" || envSource.length > 2 * 1024 * 1024) {
    fail("runtime environment");
  }
  const values = Object.fromEntries(
    RUNTIME_DISABLED_FLAG_NAMES.map((name) => [name, false]),
  );
  const seen = new Set();
  for (const line of envSource.split(/\r?\n/u)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match || !RUNTIME_DISABLED_FLAG_NAMES.includes(match[1])) continue;
    const [, name, raw] = match;
    if (seen.has(name)) fail(`${name} runtime flag`);
    seen.add(name);
    values[name] = decodedDotenvBoolean(raw, name);
  }
  const active = Object.entries(values)
    .filter(([, value]) => value)
    .map(([name]) => name);
  if (active.length > 0) fail(`active runtime flags: ${active.join(", ")}`);
  return Object.freeze(values);
}

function validateSeedEvidence(value, expectations) {
  const seed = exactObject(value, [
    "ok",
    "targetUrl",
    "deploymentId",
    "gitHead",
    "refreshBlockNumber",
    "tokenCount",
    "updated",
    "portfolioHistoryStatus",
    "portfolioHistoryPath",
  ], "seed evidence");
  if (
    seed.ok !== true ||
    exactOrigin(seed.targetUrl, "seed target", true) !== expectations.targetUrl ||
    seed.deploymentId !== expectations.deploymentId ||
    seed.gitHead !== expectations.commit ||
    !POSITIVE_UINT.test(seed.refreshBlockNumber ?? "") ||
    !Number.isSafeInteger(seed.tokenCount) ||
    seed.tokenCount < 1 ||
    typeof seed.updated !== "boolean" ||
    !["recorded", "already-recorded"].includes(seed.portfolioHistoryStatus) ||
    typeof seed.portfolioHistoryPath !== "string" ||
    seed.portfolioHistoryPath.length < 1 ||
    seed.portfolioHistoryPath.length > 1_024
  ) fail("seed evidence");
  return seed;
}

function validatePublicSmokeEvidence(value) {
  const smoke = exactObject(value, [
    "status",
    "catalogSource",
    "catalogStatus",
    "lastIndexedAt",
    "healthStatus",
    "healthAuthority",
    "marketProvider",
    "marketReadStatus",
    "tokenAddress",
    "profileAccount",
    "profileStatus",
    "detailStatus",
    "chartStatus",
    "creatorClaimPrepare",
    "tradePrepare",
  ], "public smoke evidence");
  if (
    smoke.status !==
      "verified-staged-static-identity-dexscreener-public-apis" ||
    smoke.catalogSource !== "durable-blob" ||
    !["current", "last-known-good"].includes(smoke.catalogStatus) ||
    !ISO_TIMESTAMP.test(smoke.lastIndexedAt ?? "") ||
    !["ready", "degraded"].includes(smoke.healthStatus) ||
    smoke.marketProvider !== "dexscreener" ||
    !["complete", "partial", "unavailable"].includes(smoke.marketReadStatus) ||
    ![
      "verified-dexscreener-market",
      "verified-identity-market-unavailable",
    ].includes(smoke.detailStatus) ||
    smoke.chartStatus !== "unavailable" ||
    !ADDRESS.test(smoke.tokenAddress ?? "") ||
    !ADDRESS.test(smoke.profileAccount ?? "") ||
    !["ready", "fail-closed-unavailable"].includes(smoke.profileStatus) ||
    smoke.healthAuthority !== "informational-only" ||
    smoke.creatorClaimPrepare !== "separate-live-probe-required" ||
    smoke.tradePrepare !== "separate-live-probe-required"
  ) fail("public smoke evidence");
  return smoke;
}

function validateCustomV2Evidence(value, expectations) {
  const evidence = exactObject(value, [
    "schemaVersion",
    "status",
    "deployment",
    "matrix",
    "publicResponseDigests",
    "checks",
  ], "Custom V2 evidence");
  const deployment = exactObject(
    evidence.deployment,
    ["id", "targetUrl", "gitHead"],
    "Custom V2 deployment",
  );
  const matrix = exactObject(
    evidence.matrix,
    ["registryMode", "genericMode", "authenticatedIngress"],
    "Custom V2 matrix",
  );
  const responseDigests = exactObject(
    evidence.publicResponseDigests,
    [
      "registryManifest",
      "registryReadiness",
      "genericReadiness",
      "feed",
      "detail",
    ],
    "Custom V2 response digests",
  );
  if (
    evidence.schemaVersion !== "programmable.custom-v2-stage-evidence.v1" ||
    evidence.status !== "verified-staged" ||
    deployment.id !== expectations.deploymentId ||
    exactOrigin(deployment.targetUrl, "Custom V2 target", true) !==
      expectations.targetUrl ||
    deployment.gitHead !== expectations.commit ||
    matrix.registryMode !== "prelaunch" ||
    matrix.genericMode !== "disabled" ||
    matrix.authenticatedIngress !== false ||
    Object.values(responseDigests).some(
      (digest) => typeof digest !== "string" || !DIGEST.test(digest),
    ) ||
    !Array.isArray(evidence.checks)
  ) fail("Custom V2 evidence");
  const checkIds = new Set();
  for (const check of evidence.checks) {
    if (
      check === null ||
      typeof check !== "object" ||
      Array.isArray(check) ||
      typeof check.id !== "string" ||
      check.status !== "pass" ||
      typeof check.detail !== "string" ||
      checkIds.has(check.id)
    ) fail("Custom V2 checks");
    checkIds.add(check.id);
  }
  if (REQUIRED_CUSTOM_V2_CHECKS.some((id) => !checkIds.has(id))) {
    fail("Custom V2 checks");
  }
  return evidence;
}

function validateRuntimeFlags(value) {
  const flags = exactObject(
    value,
    RUNTIME_DISABLED_FLAG_NAMES,
    "runtime flags",
  );
  if (Object.values(flags).some((item) => item !== false)) {
    fail("runtime flags");
  }
  return Object.freeze({ ...flags });
}

export function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return fail("canonical value");
}

export function createLegacyRecoveryStageHandoff(input) {
  const commit = pattern(input.commit, COMMIT, "source commit");
  const tree = pattern(input.tree, COMMIT, "source tree");
  const deploymentId = pattern(
    input.deploymentId,
    DEPLOYMENT_ID,
    "deployment ID",
  );
  const targetUrl = exactOrigin(input.targetUrl, "deployment target", true);
  const projectId = pattern(input.projectId, PROJECT_ID, "project ID");
  const rollbackDeploymentId = pattern(
    input.rollbackDeploymentId,
    DEPLOYMENT_ID,
    "rollback deployment ID",
  );
  const rollbackDeploymentUrl = exactOrigin(
    input.rollbackDeploymentUrl,
    "rollback deployment target",
    true,
  );
  const rollbackGitHead = pattern(
    input.rollbackGitHead,
    COMMIT,
    "rollback Git commit",
  );
  if (rollbackDeploymentId === deploymentId || rollbackGitHead === commit) {
    fail("rollback binding");
  }
  for (const [label, value] of Object.entries(input.launchControls ?? {})) {
    exactFalse(value, `${label} launch control`);
  }
  const launchControls = exactObject(input.launchControls, [
    "customLaunchPublicEnablement",
    "customLaunchDarkRelease",
    "customV2RegistryLive",
    "customV2GenericPublicReadEnabled",
    "customV2DetailRecordHashConfigured",
    "customV2AuthenticatedIngressEvidenceConfigured",
    "customV2GenericSignerProbeConfigured",
  ], "launch controls");
  if (
    input.customLaunchConfiguredEnablement !== false &&
    input.customLaunchConfiguredEnablement !== "false"
  ) fail("configured Custom Launch state");
  exactString(input.customLaunchStagingMode, "generic-disabled", "Custom Launch staging mode");
  const runtimeFlags = disabledLegacyRecoveryRuntimeFlags(input.runtimeEnvSource);
  const seedFile = readJsonFile(input.seedEvidencePath, "seed evidence file");
  const smokeFile = readJsonFile(
    input.publicSmokeEvidencePath,
    "public smoke evidence file",
  );
  const customV2File = readJsonFile(
    input.customV2EvidencePath,
    "Custom V2 evidence file",
  );
  const expectations = { commit, deploymentId, targetUrl };
  const seed = validateSeedEvidence(seedFile.value, expectations);
  const smoke = validatePublicSmokeEvidence(smokeFile.value);
  validateCustomV2Evidence(customV2File.value, expectations);
  const created = new Date(input.createdAt ?? Date.now());
  if (!Number.isFinite(created.getTime())) fail("creation timestamp");
  const handoff = {
    schemaVersion: LEGACY_RECOVERY_HANDOFF_SCHEMA,
    status: "promotion-review-ready",
    releaseLane: RELEASE_LANE,
    source: {
      repository: REPOSITORY,
      repositoryId: REPOSITORY_ID,
      ref: PRODUCTION_REF,
      commit,
      tree,
    },
    workflow: {
      event: "workflow_dispatch",
      path: STAGE_WORKFLOW,
      runId: pattern(input.runId, RUN_ID, "stage run ID"),
      runAttempt: pattern(
        input.runAttempt,
        RUN_ATTEMPT,
        "stage run attempt",
      ),
    },
    releaseProof: {
      verificationMode: exactString(
        input.verificationMode,
        "custom-v2-release",
        "verification mode",
      ),
      verifiedCustomV2: exactTrue(
        input.verifiedCustomV2,
        "verified Custom V2 result",
      ),
      verifyRunId: pattern(input.verifyRunId, RUN_ID, "Verify run ID"),
      verifyRunAttempt: pattern(
        input.verifyRunAttempt,
        RUN_ATTEMPT,
        "Verify run attempt",
      ),
      artifactId: pattern(
        input.verifyArtifactId,
        ARTIFACT_ID,
        "Verify artifact ID",
      ),
      artifactDigest: pattern(
        input.verifyArtifactDigest,
        DIGEST,
        "Verify artifact digest",
      ),
      proofSha256: pattern(
        input.verifyProofSha256,
        DIGEST,
        "Verify proof digest",
      ),
    },
    deployment: {
      projectId,
      id: deploymentId,
      targetUrl,
      productionOrigin: PRODUCTION_ORIGIN,
    },
    rollback: {
      deploymentId: rollbackDeploymentId,
      deploymentUrl: rollbackDeploymentUrl,
      gitHead: rollbackGitHead,
    },
    launchControls: Object.fromEntries(
      Object.keys(launchControls).map((key) => [key, false]),
    ),
    runtime: {
      customLaunchConfiguredEnablement: false,
      customLaunchStagingMode: "generic-disabled",
      disabledFlags: runtimeFlags,
    },
    stage: {
      seed: {
        status: "verified-nonempty-durable-catalog",
        blockNumber: seed.refreshBlockNumber,
        tokenCount: seed.tokenCount,
        updated: seed.updated,
        portfolioHistoryStatus: seed.portfolioHistoryStatus,
        evidenceSha256: sha256(seedFile.bytes),
      },
      publicSmoke: {
        status: smoke.status,
        marketProvider: "dexscreener",
        marketReadStatus: smoke.marketReadStatus,
        profileStatus: smoke.profileStatus,
        detailStatus: smoke.detailStatus,
        chartStatus: smoke.chartStatus,
        evidenceSha256: sha256(smokeFile.bytes),
      },
      customV2: {
        status: "verified-staged",
        registryMode: "prelaunch",
        genericMode: "disabled",
        authenticatedIngress: false,
        evidenceSha256: sha256(customV2File.bytes),
      },
      finalDeploymentBindingReverified: true,
    },
    authority: {
      promotionScope: "exact-staged-deployment-only",
      promotionPerformed: false,
      realBlockSlaRequiredForProjectorDatabaseOrIndexedPublicCutover: true,
      projectorDatabaseOrIndexedPublicCutoverAuthorized: false,
    },
    createdAt: created.toISOString(),
  };
  verifyLegacyRecoveryPromotionHandoff(handoff, {
    commit,
    tree,
    deploymentId,
    targetUrl,
    projectId,
    rollbackDeploymentId,
    rollbackGitHead,
    runId: handoff.workflow.runId,
    runAttempt: handoff.workflow.runAttempt,
    nowMs: created.getTime(),
  });
  return Object.freeze({
    handoff: Object.freeze(handoff),
    json: canonicalJson(handoff),
  });
}

export function verifyLegacyRecoveryPromotionHandoff(value, expectations = {}) {
  const handoff = exactObject(value, [
    "schemaVersion",
    "status",
    "releaseLane",
    "source",
    "workflow",
    "releaseProof",
    "deployment",
    "rollback",
    "launchControls",
    "runtime",
    "stage",
    "authority",
    "createdAt",
  ], "handoff");
  exactString(handoff.schemaVersion, LEGACY_RECOVERY_HANDOFF_SCHEMA, "handoff schema");
  exactString(handoff.status, "promotion-review-ready", "handoff status");
  exactString(handoff.releaseLane, RELEASE_LANE, "release lane");
  const source = exactObject(handoff.source, [
    "repository", "repositoryId", "ref", "commit", "tree",
  ], "source binding");
  exactString(source.repository, REPOSITORY, "source repository");
  exactString(source.repositoryId, REPOSITORY_ID, "source repository ID");
  exactString(source.ref, PRODUCTION_REF, "source ref");
  pattern(source.commit, COMMIT, "source commit");
  pattern(source.tree, COMMIT, "source tree");
  const workflow = exactObject(
    handoff.workflow,
    ["event", "path", "runId", "runAttempt"],
    "workflow binding",
  );
  exactString(workflow.event, "workflow_dispatch", "workflow event");
  exactString(workflow.path, STAGE_WORKFLOW, "workflow path");
  pattern(workflow.runId, RUN_ID, "stage run ID");
  pattern(workflow.runAttempt, RUN_ATTEMPT, "stage run attempt");
  const proof = exactObject(handoff.releaseProof, [
    "verificationMode",
    "verifiedCustomV2",
    "verifyRunId",
    "verifyRunAttempt",
    "artifactId",
    "artifactDigest",
    "proofSha256",
  ], "release proof");
  exactString(proof.verificationMode, "custom-v2-release", "verification mode");
  exactTrue(proof.verifiedCustomV2, "verified Custom V2 result");
  pattern(proof.verifyRunId, RUN_ID, "Verify run ID");
  pattern(proof.verifyRunAttempt, RUN_ATTEMPT, "Verify run attempt");
  pattern(proof.artifactId, ARTIFACT_ID, "Verify artifact ID");
  pattern(proof.artifactDigest, DIGEST, "Verify artifact digest");
  pattern(proof.proofSha256, DIGEST, "Verify proof digest");
  const deployment = exactObject(handoff.deployment, [
    "projectId", "id", "targetUrl", "productionOrigin",
  ], "deployment binding");
  pattern(deployment.projectId, PROJECT_ID, "project ID");
  pattern(deployment.id, DEPLOYMENT_ID, "deployment ID");
  const targetUrl = exactOrigin(deployment.targetUrl, "deployment target", true);
  exactString(
    exactOrigin(deployment.productionOrigin, "production origin"),
    PRODUCTION_ORIGIN,
    "production origin",
  );
  const rollback = exactObject(handoff.rollback, [
    "deploymentId", "deploymentUrl", "gitHead",
  ], "rollback binding");
  pattern(rollback.deploymentId, DEPLOYMENT_ID, "rollback deployment ID");
  exactOrigin(rollback.deploymentUrl, "rollback deployment target", true);
  pattern(rollback.gitHead, COMMIT, "rollback Git commit");
  if (
    rollback.deploymentId === deployment.id ||
    rollback.gitHead === source.commit
  ) fail("rollback binding");
  const launchControls = exactObject(handoff.launchControls, [
    "customLaunchPublicEnablement",
    "customLaunchDarkRelease",
    "customV2RegistryLive",
    "customV2GenericPublicReadEnabled",
    "customV2DetailRecordHashConfigured",
    "customV2AuthenticatedIngressEvidenceConfigured",
    "customV2GenericSignerProbeConfigured",
  ], "launch controls");
  if (Object.values(launchControls).some((item) => item !== false)) {
    fail("launch controls");
  }
  const runtime = exactObject(handoff.runtime, [
    "customLaunchConfiguredEnablement",
    "customLaunchStagingMode",
    "disabledFlags",
  ], "runtime policy");
  exactFalse(
    runtime.customLaunchConfiguredEnablement,
    "configured Custom Launch state",
  );
  exactString(
    runtime.customLaunchStagingMode,
    "generic-disabled",
    "Custom Launch staging mode",
  );
  validateRuntimeFlags(runtime.disabledFlags);
  const stage = exactObject(handoff.stage, [
    "seed", "publicSmoke", "customV2", "finalDeploymentBindingReverified",
  ], "stage proof");
  const seed = exactObject(stage.seed, [
    "status",
    "blockNumber",
    "tokenCount",
    "updated",
    "portfolioHistoryStatus",
    "evidenceSha256",
  ], "stage seed proof");
  exactString(
    seed.status,
    "verified-nonempty-durable-catalog",
    "stage seed status",
  );
  pattern(seed.blockNumber, POSITIVE_UINT, "stage seed block");
  if (!Number.isSafeInteger(seed.tokenCount) || seed.tokenCount < 1) {
    fail("stage seed token count");
  }
  if (
    typeof seed.updated !== "boolean" ||
    !["recorded", "already-recorded"].includes(seed.portfolioHistoryStatus)
  ) fail("stage seed result");
  pattern(seed.evidenceSha256, DIGEST, "stage seed digest");
  const smoke = exactObject(stage.publicSmoke, [
    "status",
    "marketProvider",
    "marketReadStatus",
    "profileStatus",
    "detailStatus",
    "chartStatus",
    "evidenceSha256",
  ], "public smoke proof");
  validatePublicSmokeEvidence({
    status: smoke.status,
    catalogSource: "durable-blob",
    catalogStatus: "current",
    lastIndexedAt: "2026-01-01T00:00:00.000Z",
    healthStatus: "ready",
    healthAuthority: "informational-only",
    marketProvider: smoke.marketProvider,
    marketReadStatus: smoke.marketReadStatus,
    tokenAddress: `0x${"1".repeat(40)}`,
    profileAccount: `0x${"2".repeat(40)}`,
    profileStatus: smoke.profileStatus,
    detailStatus: smoke.detailStatus,
    chartStatus: smoke.chartStatus,
    creatorClaimPrepare: "separate-live-probe-required",
    tradePrepare: "separate-live-probe-required",
  });
  pattern(smoke.evidenceSha256, DIGEST, "public smoke digest");
  const customV2 = exactObject(stage.customV2, [
    "status",
    "registryMode",
    "genericMode",
    "authenticatedIngress",
    "evidenceSha256",
  ], "Custom V2 proof");
  exactString(customV2.status, "verified-staged", "Custom V2 status");
  exactString(customV2.registryMode, "prelaunch", "Custom V2 Registry mode");
  exactString(customV2.genericMode, "disabled", "Custom V2 Generic mode");
  exactFalse(customV2.authenticatedIngress, "Custom V2 ingress mode");
  pattern(customV2.evidenceSha256, DIGEST, "Custom V2 evidence digest");
  exactTrue(
    stage.finalDeploymentBindingReverified,
    "final deployment binding",
  );
  const authority = exactObject(handoff.authority, [
    "promotionScope",
    "promotionPerformed",
    "realBlockSlaRequiredForProjectorDatabaseOrIndexedPublicCutover",
    "projectorDatabaseOrIndexedPublicCutoverAuthorized",
  ], "authority scope");
  exactString(
    authority.promotionScope,
    "exact-staged-deployment-only",
    "promotion scope",
  );
  exactFalse(authority.promotionPerformed, "promotion state");
  exactTrue(
    authority.realBlockSlaRequiredForProjectorDatabaseOrIndexedPublicCutover,
    "real block SLA boundary",
  );
  exactFalse(
    authority.projectorDatabaseOrIndexedPublicCutoverAuthorized,
    "cutover authority",
  );
  const createdAtMs = Date.parse(handoff.createdAt ?? "");
  const nowMs = expectations.nowMs ?? Date.now();
  const maximumAgeMs =
    expectations.maximumAgeMs ?? LEGACY_RECOVERY_HANDOFF_MAXIMUM_AGE_MS;
  if (
    !Number.isFinite(createdAtMs) ||
    new Date(createdAtMs).toISOString() !== handoff.createdAt ||
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(maximumAgeMs) ||
    maximumAgeMs < 60_000 ||
    maximumAgeMs > LEGACY_RECOVERY_HANDOFF_MAXIMUM_AGE_MS ||
    createdAtMs > nowMs + 30_000 ||
    nowMs - createdAtMs > maximumAgeMs
  ) fail("handoff timestamp");
  const exactExpectations = [
    ["commit", source.commit],
    ["tree", source.tree],
    ["deploymentId", deployment.id],
    ["targetUrl", targetUrl],
    ["projectId", deployment.projectId],
    ["rollbackDeploymentId", rollback.deploymentId],
    ["rollbackGitHead", rollback.gitHead],
    ["runId", workflow.runId],
    ["runAttempt", workflow.runAttempt],
  ];
  for (const [name, observed] of exactExpectations) {
    if (expectations[name] !== undefined && expectations[name] !== observed) {
      fail(`${name} expectation`);
    }
  }
  return Object.freeze({ ...handoff });
}

function argumentsFrom(argv) {
  const command = argv[0];
  if (!['create', 'verify'].includes(command)) fail("command");
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !/^--[a-z][a-z0-9-]*$/u.test(name ?? "") ||
      value === undefined ||
      values.has(name)
    ) fail("arguments");
    values.set(name, value);
  }
  return Object.freeze({ command, values });
}

function required(values, name) {
  const value = values.get(`--${name}`);
  if (value === undefined || value === "") fail(`${name} argument`);
  return value;
}

function main(argv) {
  const { command, values } = argumentsFrom(argv);
  if (command === "create") {
    const result = createLegacyRecoveryStageHandoff({
      commit: required(values, "commit"),
      tree: required(values, "tree"),
      deploymentId: required(values, "deployment-id"),
      targetUrl: required(values, "target-url"),
      projectId: required(values, "project-id"),
      rollbackDeploymentId: required(values, "rollback-deployment-id"),
      rollbackDeploymentUrl: required(values, "rollback-deployment-url"),
      rollbackGitHead: required(values, "rollback-git-head"),
      runId: required(values, "run-id"),
      runAttempt: required(values, "run-attempt"),
      verificationMode: required(values, "verification-mode"),
      verifiedCustomV2: required(values, "verified-custom-v2"),
      verifyRunId: required(values, "verify-run-id"),
      verifyRunAttempt: required(values, "verify-run-attempt"),
      verifyArtifactId: required(values, "verify-artifact-id"),
      verifyArtifactDigest: required(values, "verify-artifact-digest"),
      verifyProofSha256: required(values, "verify-proof-sha256"),
      customLaunchConfiguredEnablement: required(
        values,
        "custom-launch-configured-enablement",
      ),
      customLaunchStagingMode: required(values, "custom-launch-staging-mode"),
      launchControls: {
        customLaunchPublicEnablement: required(
          values,
          "custom-launch-public-enablement",
        ),
        customLaunchDarkRelease: required(
          values,
          "custom-launch-dark-release",
        ),
        customV2RegistryLive: required(values, "custom-v2-registry-live"),
        customV2GenericPublicReadEnabled: required(
          values,
          "custom-v2-generic-public-read-enabled",
        ),
        customV2DetailRecordHashConfigured:
          values.get("--custom-v2-detail-record-hash") !== "",
        customV2AuthenticatedIngressEvidenceConfigured:
          values.get("--custom-v2-authenticated-ingress-evidence-sha256") !== "",
        customV2GenericSignerProbeConfigured:
          values.get("--custom-v2-generic-signer-probe-expected-json") !== "" ||
          values.get("--custom-v2-generic-signer-probe-expected-sha256") !== "",
      },
      runtimeEnvSource: readFileSync(
        required(values, "runtime-env-file"),
        "utf8",
      ),
      seedEvidencePath: required(values, "seed-evidence"),
      publicSmokeEvidencePath: required(values, "public-smoke-evidence"),
      customV2EvidencePath: required(values, "custom-v2-evidence"),
    });
    const output = required(values, "output");
    writeFileSync(output, `${result.json}\n`, {
      flag: "wx",
      mode: 0o600,
      encoding: "utf8",
    });
    process.stdout.write(`${JSON.stringify({
      status: result.handoff.status,
      releaseLane: result.handoff.releaseLane,
      handoffSha256: sha256(Buffer.from(`${result.json}\n`, "utf8")),
      output,
    })}\n`);
    return;
  }
  const handoff = readJsonFile(required(values, "handoff"), "handoff file");
  const verified = verifyLegacyRecoveryPromotionHandoff(handoff.value, {
    commit: required(values, "expected-commit"),
    tree: required(values, "expected-tree"),
    deploymentId: required(values, "deployment-id"),
    targetUrl: exactOrigin(required(values, "target-url"), "target", true),
    projectId: required(values, "project-id"),
    rollbackDeploymentId: required(values, "rollback-deployment-id"),
    rollbackGitHead: required(values, "rollback-git-head"),
    runId: required(values, "run-id"),
    runAttempt: required(values, "run-attempt"),
  });
  process.stdout.write(`${JSON.stringify({
    status: "legacy-recovery-promotion-gate-passed",
    releaseLane: verified.releaseLane,
    deploymentId: verified.deployment.id,
    commit: verified.source.commit,
    handoffSha256: sha256(handoff.bytes),
    realBlockSlaExceptionScope:
      "legacy-only-no-projector-db-or-indexed-public-cutover",
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error
      ? error.message
      : "legacy recovery promotion gate failed"}\n`);
    process.exitCode = 1;
  }
}
