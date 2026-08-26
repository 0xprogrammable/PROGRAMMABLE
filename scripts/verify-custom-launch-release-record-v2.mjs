#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  verifyCustomLaunchApiReleaseBindingV1,
} from "./verify-custom-launch-api-release-binding-v1.mjs";

export const SCHEMA_VERSION = "programmable.custom-launch-release-record.v2";
export const REQUIRED_GATES = Object.freeze([
  "browser_qa",
  "clean_room_no_broadcast",
  "custom_launch_api_release",
  "database_migrations",
  "public_contract",
  "rollback_snapshot",
  "security",
  "source_verification_pipeline",
  "website_release",
]);

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const LEVELS = new Set(["template", "staging", "candidate", "promotion", "live"]);
const SECRET_KEY = /^(?:api[_-]?key|access[_-]?token|authorization|bearer|credential|database[_-]?url|password|private[_-]?key|secret)(?:[_-]?value)?$/iu;
const PLACEHOLDER = /(?:<[^>]+>|example\.invalid|replace[_ -]?me|todo|yyyy|nnn)/iu;
const ZEROISH = /^(?:0{40}|0x0{64}|sha256:0{64}|main-0{12})$/u;
const schema = JSON.parse(readFileSync(new URL(
  "../docs/operations/releases/custom-launch-v2/release-record.schema.json",
  import.meta.url,
), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareUtf8(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort(compareUtf8).map((key) =>
      `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function releaseSubject(record) {
  return Object.freeze({
    schemaVersion: record.schemaVersion,
    releaseIntent: record.releaseIntent,
    website: record.subject?.website,
    apiService: record.subject?.apiService,
    chain: record.subject?.chain,
  });
}

export function computeReleaseSubjectSha256(record) {
  return sha256(canonicalize(releaseSubject(record)));
}

export function computeDetachedRecordSha256(record) {
  return sha256(canonicalize(record));
}

function add(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function requiredString(errors, value, path) {
  if (typeof value !== "string" || value.length < 1) {
    add(errors, path, "must be a non-empty string");
    return false;
  }
  return true;
}

function requiredPattern(errors, value, path, pattern, label) {
  if (!requiredString(errors, value, path)) return;
  if (!pattern.test(value)) add(errors, path, `must be ${label}`);
}

function timestamp(errors, value, path) {
  requiredPattern(errors, value, path, TIMESTAMP, "an RFC 3339 UTC timestamp at second precision");
  if (typeof value === "string" && Number.isNaN(Date.parse(value))) {
    add(errors, path, "must be a real timestamp");
  }
}

function digest(errors, value, path) {
  requiredPattern(errors, value, path, SHA256, "a lowercase sha256 digest");
  if (ZEROISH.test(value ?? "")) add(errors, path, "must not be a zero placeholder");
}

function commit(errors, value, path) {
  requiredPattern(errors, value, path, COMMIT, "a full lowercase Git commit SHA");
  if (ZEROISH.test(value ?? "")) add(errors, path, "must not be a zero placeholder");
}

function reference(errors, value, path) {
  if (!requiredString(errors, value, path)) return;
  if (!/^(?:https:\/\/|github:\/\/|artifact:\/\/|command-center:\/\/|codex-task:\/\/)/u.test(value)) {
    add(errors, path, "must be an immutable evidence reference");
  }
}

function immutableVercelOrigin(errors, value, path) {
  if (!requiredString(errors, value, path)) return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || !url.hostname.endsWith(".vercel.app")
      || url.hostname === "vercel.app"
      || url.pathname !== "/"
      || url.search !== ""
      || url.hash !== ""
      || url.username !== ""
      || url.password !== ""
    ) add(errors, path, "must be a canonical immutable Vercel origin");
  } catch {
    add(errors, path, "must be a canonical immutable Vercel origin");
  }
}

function walk(value, path, errors, allowPlaceholders) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`, errors, allowPlaceholders));
    return;
  }
  if (!isObject(value)) {
    if (
      !allowPlaceholders
      && typeof value === "string"
      && (PLACEHOLDER.test(value) || ZEROISH.test(value))
    ) add(errors, path, "contains a placeholder");
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
    if (SECRET_KEY.test(key)) add(errors, childPath, "secret-bearing fields are forbidden");
    walk(child, childPath, errors, allowPlaceholders);
  }
}

function requireDecision(errors, decision, path, expectedStatus, subjectSha, candidateSha) {
  if (decision?.status !== expectedStatus) add(errors, `${path}.status`, `must equal ${expectedStatus}`);
  requiredString(errors, decision?.decisionId, `${path}.decisionId`);
  reference(errors, decision?.immutableReference, `${path}.immutableReference`);
  timestamp(errors, decision?.decidedAt, `${path}.decidedAt`);
  digest(errors, decision?.statementSha256, `${path}.statementSha256`);
  if (decision?.releaseSubjectSha256 !== subjectSha) {
    add(errors, `${path}.releaseSubjectSha256`, "must bind the exact release subject");
  }
  if (candidateSha !== undefined && decision?.candidateEvidenceSha256 !== candidateSha) {
    add(errors, `${path}.candidateEvidenceSha256`, "must bind the verified candidate evidence");
  }
}

function requirePendingObject(errors, value, path, statusKey = "status") {
  for (const [key, child] of Object.entries(value ?? {})) {
    if (key === statusKey) {
      if (child !== "pending") add(errors, `${path}.${key}`, "must remain pending");
    } else if (key === "authority" || key === "mode"
      || key === "walletSignatureObserved" || key === "transactionBroadcastObserved") {
      continue;
    } else if (child !== null) {
      add(errors, `${path}.${key}`, "must remain null before this state");
    }
  }
}

function compareApiObservation(errors, record, observation) {
  const api = record.subject.apiService;
  const expected = {
    repository: api.repository,
    attestationCommitSha: api.bindingAttestationCommitSha,
    bindingDocumentPath: api.bindingDocumentPath,
    bindingDocumentSha256: api.bindingDocumentSha256,
    backendCandidateCommitSha: api.candidateCommitSha,
    backendCandidateTreeSha: api.candidateTreeSha,
    websiteCandidateCommitSha: record.subject.website.commitSha,
    websiteCandidateTreeSha: record.subject.website.treeSha,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (observation?.[key] !== value) {
      add(errors, `apiReleaseObservation.${key}`, "does not match the detached release subject");
    }
  }
  if (observation?.fly?.imageDigest !== api.imageDigest) {
    add(errors, "apiReleaseObservation.fly.imageDigest", "does not match the API subject");
  }
  if (observation?.fly?.releaseVersion !== api.flyReleaseVersion) {
    add(errors, "apiReleaseObservation.fly.releaseVersion", "does not match the API subject");
  }
  if (observation?.database?.migrationInventorySha256 !== api.migrationInventorySha256) {
    add(errors, "apiReleaseObservation.database.migrationInventorySha256", "does not match the API subject");
  }
  if (observation?.api?.apiContractSha256 !== api.apiContractSha256) {
    add(errors, "apiReleaseObservation.api.apiContractSha256", "does not match the API subject");
  }
  if (observation?.api?.readinessIdentitySha256 !== api.readinessIdentitySha256) {
    add(errors, "apiReleaseObservation.api.readinessIdentitySha256", "does not match the API subject");
  }
  if (canonicalize(observation?.chain) !== canonicalize(record.subject.chain)) {
    add(errors, "apiReleaseObservation.chain", "does not match the exact chain deployment binding");
  }
}

export function verifyCustomLaunchReleaseRecordV2(record, options = {}) {
  const level = options.require ?? "template";
  if (!LEVELS.has(level)) throw new TypeError(`Unsupported verification level: ${level}`);
  const errors = [];
  if (!validateSchema(record)) {
    for (const error of validateSchema.errors ?? []) {
      const detail = error.keyword === "additionalProperties"
        ? `unexpected field ${error.params.additionalProperty}`
        : (error.message ?? `failed ${error.keyword}`);
      add(errors, error.instancePath ? `$${error.instancePath}` : "$", `schema ${detail}`);
    }
    return { ok: false, errors, releaseSubjectSha256: null, detachedRecordSha256: null };
  }
  const allowPlaceholders = level === "template";
  walk(record, "$", errors, allowPlaceholders);
  const releaseSubjectSha256 = computeReleaseSubjectSha256(record);
  const detachedRecordSha256 = computeDetachedRecordSha256(record);
  if (level === "template") {
    return { ok: errors.length === 0, errors, releaseSubjectSha256, detachedRecordSha256 };
  }

  if (record.subject.releaseSubjectSha256 !== releaseSubjectSha256) {
    add(errors, "$.subject.releaseSubjectSha256", "does not match the canonical release subject");
  }
  timestamp(errors, record.createdAt, "$.createdAt");
  commit(errors, record.subject.website.commitSha, "$.subject.website.commitSha");
  commit(errors, record.subject.website.treeSha, "$.subject.website.treeSha");
  commit(errors, record.subject.website.reviewedDiffBaseSha, "$.subject.website.reviewedDiffBaseSha");
  digest(errors, record.subject.website.reviewedDiffSha256, "$.subject.website.reviewedDiffSha256");
  digest(errors, record.subject.website.publicOpenApiSha256, "$.subject.website.publicOpenApiSha256");
  digest(errors, record.subject.website.launchPackageManifestSha256, "$.subject.website.launchPackageManifestSha256");
  commit(errors, record.subject.apiService.bindingAttestationCommitSha, "$.subject.apiService.bindingAttestationCommitSha");
  digest(errors, record.subject.apiService.bindingDocumentSha256, "$.subject.apiService.bindingDocumentSha256");
  commit(errors, record.subject.apiService.candidateCommitSha, "$.subject.apiService.candidateCommitSha");
  commit(errors, record.subject.apiService.candidateTreeSha, "$.subject.apiService.candidateTreeSha");
  digest(errors, record.subject.apiService.imageDigest, "$.subject.apiService.imageDigest");
  if (!Number.isSafeInteger(record.subject.apiService.flyReleaseVersion)) {
    add(errors, "$.subject.apiService.flyReleaseVersion", "must be an exact Fly release version");
  }
  digest(errors, record.subject.apiService.migrationInventorySha256, "$.subject.apiService.migrationInventorySha256");
  digest(errors, record.subject.apiService.apiContractSha256, "$.subject.apiService.apiContractSha256");
  digest(errors, record.subject.apiService.readinessIdentitySha256, "$.subject.apiService.readinessIdentitySha256");
  requireDecision(errors, record.releaseApproval, "$.releaseApproval", "approved", releaseSubjectSha256);

  const ids = record.validation.gates.map((gate) => gate.id);
  if (new Set(ids).size !== REQUIRED_GATES.length
    || canonicalize([...ids].sort(compareUtf8)) !== canonicalize(REQUIRED_GATES)) {
    add(errors, "$.validation.gates", "must contain every required gate exactly once");
  }
  for (const [index, gate] of record.validation.gates.entries()) {
    if (gate.result !== "passed") add(errors, `$.validation.gates[${index}].result`, "must be passed");
    digest(errors, gate.evidenceSha256, `$.validation.gates[${index}].evidenceSha256`);
    reference(errors, gate.evidenceLocator, `$.validation.gates[${index}].evidenceLocator`);
    timestamp(errors, gate.completedAt, `$.validation.gates[${index}].completedAt`);
  }

  const rollbackWebsite = record.rollback.website;
  requiredString(errors, rollbackWebsite.deploymentId, "$.rollback.website.deploymentId");
  immutableVercelOrigin(errors, rollbackWebsite.immutableDeploymentUrl, "$.rollback.website.immutableDeploymentUrl");
  commit(errors, rollbackWebsite.commitSha, "$.rollback.website.commitSha");
  digest(errors, rollbackWebsite.configurationSnapshotSha256, "$.rollback.website.configurationSnapshotSha256");
  timestamp(errors, rollbackWebsite.capturedAt, "$.rollback.website.capturedAt");
  const rollbackApi = record.rollback.apiService;
  if (!Number.isSafeInteger(rollbackApi.flyReleaseVersion)) {
    add(errors, "$.rollback.apiService.flyReleaseVersion", "must be an exact Fly release version");
  }
  digest(errors, rollbackApi.imageDigest, "$.rollback.apiService.imageDigest");
  commit(errors, rollbackApi.candidateCommitSha, "$.rollback.apiService.candidateCommitSha");
  timestamp(errors, rollbackApi.capturedAt, "$.rollback.apiService.capturedAt");

  if (options.apiReleaseObservation === undefined) {
    add(errors, "apiReleaseObservation", "is required after template validation");
  } else {
    compareApiObservation(errors, record, options.apiReleaseObservation);
  }
  const exact = [
    [options.expectedWebsiteCommitSha, record.subject.website.commitSha, "expected website commit"],
    [options.expectedWebsiteTreeSha, record.subject.website.treeSha, "expected website tree"],
    [options.expectedApiAttestationCommitSha, record.subject.apiService.bindingAttestationCommitSha, "expected API attestation commit"],
    [options.expectedApiBindingDocumentSha256, record.subject.apiService.bindingDocumentSha256, "expected API binding digest"],
    [options.expectedRollbackDeploymentId, rollbackWebsite.deploymentId, "expected rollback deployment"],
    [options.expectedRollbackDeploymentUrl, rollbackWebsite.immutableDeploymentUrl, "expected rollback URL"],
    [options.expectedRollbackWebsiteCommitSha, rollbackWebsite.commitSha, "expected rollback Website commit"],
    [options.expectedDetachedRecordSha256, detachedRecordSha256, "expected detached record digest"],
  ];
  for (const [expected, actual, label] of exact) {
    if (expected !== undefined && expected !== actual) add(errors, label, "does not match the record");
  }

  const levels = { staging: 1, candidate: 2, promotion: 3, live: 4 };
  const state = levels[level];
  const expectedStatus = {
    staging: "staging_approved",
    candidate: "candidate_verified",
    promotion: "promotion_approved",
    live: "live",
  }[level];
  if (record.recordStatus !== expectedStatus) {
    add(errors, "$.recordStatus", `must equal ${expectedStatus} for ${level} verification`);
  }

  if (state < 2) {
    requirePendingObject(errors, record.candidate, "$.candidate", "__no_status__");
  } else {
    const candidate = record.candidate;
    if (!Number.isSafeInteger(candidate.workflowRunId)) add(errors, "$.candidate.workflowRunId", "must be an exact workflow run ID");
    if (!Number.isSafeInteger(candidate.workflowRunAttempt)) add(errors, "$.candidate.workflowRunAttempt", "must be an exact workflow run attempt");
    reference(errors, candidate.workflowRunUrl, "$.candidate.workflowRunUrl");
    requiredString(errors, candidate.websiteDeploymentId, "$.candidate.websiteDeploymentId");
    immutableVercelOrigin(errors, candidate.immutableWebsiteUrl, "$.candidate.immutableWebsiteUrl");
    if (candidate.websiteCommitSha !== record.subject.website.commitSha) {
      add(errors, "$.candidate.websiteCommitSha", "must equal the release Website commit");
    }
    if (candidate.apiOrigin !== "https://programmable-custom-launch-api.fly.dev") {
      add(errors, "$.candidate.apiOrigin", "must equal the frozen Fly origin");
    }
    if (candidate.apiReadinessIdentitySha256 !== record.subject.apiService.readinessIdentitySha256) {
      add(errors, "$.candidate.apiReadinessIdentitySha256", "must equal the API readiness identity");
    }
    digest(errors, candidate.verificationEvidenceSha256, "$.candidate.verificationEvidenceSha256");
    timestamp(errors, candidate.verifiedAt, "$.candidate.verifiedAt");
  }

  if (state < 3) {
    requirePendingObject(errors, record.promotionApproval, "$.promotionApproval");
  } else {
    requireDecision(
      errors,
      record.promotionApproval,
      "$.promotionApproval",
      "approved",
      releaseSubjectSha256,
      record.candidate.verificationEvidenceSha256,
    );
  }

  if (state < 4) {
    requirePendingObject(errors, record.promoted, "$.promoted", "__no_status__");
    requirePendingObject(errors, record.canary, "$.canary");
    requirePendingObject(errors, record.liveDeclaration, "$.liveDeclaration");
  } else {
    if (record.promoted.websiteDeploymentId !== record.candidate.websiteDeploymentId) {
      add(errors, "$.promoted.websiteDeploymentId", "must equal the verified candidate deployment");
    }
    if (record.promoted.immutableWebsiteUrl !== record.candidate.immutableWebsiteUrl) {
      add(errors, "$.promoted.immutableWebsiteUrl", "must equal the verified immutable candidate URL");
    }
    if (record.promoted.productionAlias !== "https://programmable.market") {
      add(errors, "$.promoted.productionAlias", "must equal the canonical production origin");
    }
    digest(errors, record.promoted.evidenceSha256, "$.promoted.evidenceSha256");
    timestamp(errors, record.promoted.promotedAt, "$.promoted.promotedAt");
    if (record.canary.status !== "passed") add(errors, "$.canary.status", "must be passed");
    digest(errors, record.canary.evidenceSha256, "$.canary.evidenceSha256");
    reference(errors, record.canary.evidenceLocator, "$.canary.evidenceLocator");
    timestamp(errors, record.canary.completedAt, "$.canary.completedAt");
    if (record.canary.walletSignatureObserved !== false
      || record.canary.transactionBroadcastObserved !== false) {
      add(errors, "$.canary", "must prove a no-signature, no-broadcast clean-room handoff");
    }
    requireDecision(errors, record.liveDeclaration, "$.liveDeclaration", "declared_live", releaseSubjectSha256);
  }

  return { ok: errors.length === 0, errors, releaseSubjectSha256, detachedRecordSha256 };
}

function parseArguments(argv) {
  const output = { positional: [], verifyApiReleaseBinding: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--verify-api-release-binding") {
      output.verifyApiReleaseBinding = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      output.positional.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    output[key] = value;
    index += 1;
  }
  return output;
}

async function main(argv) {
  const args = parseArguments(argv);
  if (args.positional.length !== 1) throw new Error("one detached release-record path is required");
  const record = JSON.parse(await readFile(args.positional[0], "utf8"));
  let apiReleaseObservation;
  if (args.verifyApiReleaseBinding) {
    apiReleaseObservation = await verifyCustomLaunchApiReleaseBindingV1({
      attestationCommitSha: args.expectApiAttestationCommit,
      expectedDocumentSha256: args.expectApiBindingDocumentSha256,
      expectedWebsiteCommitSha: args.expectWebsiteCommit,
      expectedWebsiteTreeSha: args.expectWebsiteTree,
      expectedPublicOpenApiSha256: record.subject?.website?.publicOpenApiSha256,
      expectedLaunchPackageManifestSha256:
        record.subject?.website?.launchPackageManifestSha256,
      githubToken: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_RELEASE_READ_TOKEN,
    });
    if (args.apiReleaseSummary === undefined) {
      throw new Error("--api-release-summary is required with API release verification");
    }
    await writeFile(args.apiReleaseSummary, `${JSON.stringify(apiReleaseObservation, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }
  const result = verifyCustomLaunchReleaseRecordV2(record, {
    require: args.require,
    apiReleaseObservation,
    expectedWebsiteCommitSha: args.expectWebsiteCommit,
    expectedWebsiteTreeSha: args.expectWebsiteTree,
    expectedApiAttestationCommitSha: args.expectApiAttestationCommit,
    expectedApiBindingDocumentSha256: args.expectApiBindingDocumentSha256,
    expectedRollbackDeploymentId: args.expectRollbackDeploymentId,
    expectedRollbackDeploymentUrl: args.expectRollbackDeploymentUrl,
    expectedRollbackWebsiteCommitSha: args.expectRollbackWebsiteCommit,
    expectedDetachedRecordSha256: args.expectDetachedRecordSha256,
  });
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`CUSTOM_LAUNCH_RELEASE_RECORD_V2_${String(args.require ?? "template").toUpperCase()}_VALID\n`);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    verificationLevel: args.require ?? "template",
    releaseSubjectSha256: result.releaseSubjectSha256,
    detachedRecordSha256: result.detachedRecordSha256,
  })}\n`);
  if (args.githubOutput !== undefined) {
    await appendFile(args.githubOutput, [
      `release_subject_sha256=${result.releaseSubjectSha256}`,
      `detached_record_sha256=${result.detachedRecordSha256}`,
      `api_release_attestation_commit_sha=${record.subject.apiService.bindingAttestationCommitSha}`,
      `api_release_binding_document_sha256=${record.subject.apiService.bindingDocumentSha256}`,
      `api_image_digest=${record.subject.apiService.imageDigest}`,
      `api_image_tag=${apiReleaseObservation?.fly?.imageTag ?? ""}`,
      `api_fly_release_version=${record.subject.apiService.flyReleaseVersion}`,
      `api_readiness_identity_sha256=${record.subject.apiService.readinessIdentitySha256}`,
      `api_machine_count=${apiReleaseObservation?.fly?.machineCount ?? ""}`,
      `api_fly_origin=${apiReleaseObservation?.fly?.origin ?? ""}`,
      "",
    ].join("\n"), "utf8");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
