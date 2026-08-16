import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import { parseCli, renderHelp } from "./cli-args.mjs";
import { CliFailure, emitFailure, emitSuccess, sanitizeMessage } from "./cli-runtime.mjs";
import {
  createGhTransport,
  INTAKE_STATUS_PATH,
  parseIntakeStatusBytes,
  projectGitHubStatus
} from "./github-application-core.mjs";
import {
  migrateLegacySubmissionToOpenWorldV2,
  sha256Bytes,
  sha256Canonical
} from "./open-world-migration-core.mjs";
import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  createOpenWorldDraftPackage,
  deriveOpenWorldV2FeeApplicability,
  isRepositorySchemaBinding,
  validateOpenWorldPackage,
  validateOpenWorldV2Package
} from "./open-world-v2-core.mjs";
import { deriveDependencyAwareSecurityAssessment } from "./application-dependency-core.mjs";
import {
  matchGitlinkCompanions,
  parseGitLfsPointer,
  resolveRawGitSymlinks,
  summarizeDependencyPointers
} from "./dependency-pointer-core.mjs";
import { prepareApplicationV3Revision } from "./application-v3-prepare-revision-core.mjs";
import {
  classifyPublicPrApplicationV3RawGitFailure,
  classifyPublicPrApplicationV3GitLfsPointer,
  derivePublicPrApplicationV3PreviousBinding,
  generatePublicPrApplicationV3,
  projectPublicPrApplicationV3DiffPaths,
  scanPublicPrApplicationV3ArtifactBytes,
  validatePublicPrApplicationV3,
  verifyLocalSourceClosureManifestV1
} from "./public-pr-application-v3-core.mjs";
import {
  assertInsideRepository,
  resolveInstalledPackageRoot,
  resolveRepositoryRoot,
  spawnSafeRawGitSync
} from "./repository-root.mjs";
import {
  computeRawGitObjectId,
  verifyRawGitCommitTreeIntegrity
} from "./raw-git-integrity-core.mjs";
import { runSourceManifestCli } from "./source-manifest.mjs";
import { parseBoundedStrictJson } from "./strict-json-core.mjs";
import { analyzeSubmission, canonicalJson, validateAgainstSchema } from "./submission-core.mjs";
import {
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID,
  SUBMIT_LAUNCH_REPOSITORY_NAME
} from "./registry-intake-contract.mjs";

export {
  fs,
  crypto,
  path,
  process,
  TextDecoder,
  fileURLToPath,
  parseCli,
  renderHelp,
  CliFailure,
  emitFailure,
  emitSuccess,
  sanitizeMessage,
  createGhTransport,
  INTAKE_STATUS_PATH,
  parseIntakeStatusBytes,
  projectGitHubStatus,
  migrateLegacySubmissionToOpenWorldV2,
  sha256Bytes,
  sha256Canonical,
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  createOpenWorldDraftPackage,
  deriveOpenWorldV2FeeApplicability,
  isRepositorySchemaBinding,
  validateOpenWorldPackage,
  validateOpenWorldV2Package,
  deriveDependencyAwareSecurityAssessment,
  matchGitlinkCompanions,
  parseGitLfsPointer,
  resolveRawGitSymlinks,
  summarizeDependencyPointers,
  prepareApplicationV3Revision,
  classifyPublicPrApplicationV3RawGitFailure,
  classifyPublicPrApplicationV3GitLfsPointer,
  derivePublicPrApplicationV3PreviousBinding,
  generatePublicPrApplicationV3,
  projectPublicPrApplicationV3DiffPaths,
  scanPublicPrApplicationV3ArtifactBytes,
  validatePublicPrApplicationV3,
  verifyLocalSourceClosureManifestV1,
  assertInsideRepository,
  resolveInstalledPackageRoot,
  resolveRepositoryRoot,
  spawnSafeRawGitSync,
  computeRawGitObjectId,
  verifyRawGitCommitTreeIntegrity,
  runSourceManifestCli,
  parseBoundedStrictJson,
  analyzeSubmission,
  canonicalJson,
  validateAgainstSchema
};

export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_IDEA_BYTES = 1024 * 1024;
export const MAX_OUTPUT_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_OUTPUT_PACKAGE_BYTES = 12 * 1024 * 1024;
export const MAX_APPLICATION_BYTES = 256 * 1024;
export const MAX_SECURITY_BINDINGS_BYTES = 4 * 1024 * 1024;
export const MAX_REVIEW_PACKAGE_BYTES = 512 * 1024;
export const MAX_ROOT_MANIFEST_BYTES = 64 * 1024 * 1024;
export const MAX_INLINE_GIT_PATH_BYTES = 16 * 1024;
export const MAX_GITHUB_PACKAGE_FILES = 100;
export const MAX_GITHUB_PULL_FILES = 3000;
export const MAX_GITHUB_PULL_FILE_METADATA_BYTES = 4_000_000;
export const MAX_GITHUB_API_INPUT_BYTES = 1_000_000;
export const MAX_GITHUB_CONTENT_RAW_BYTES = 700_000;
export const MAX_GITHUB_SOURCE_CONTENT_REQUESTS = 4096;
export const MAX_GITHUB_SOURCE_VERIFY_MS = 120_000;
export const MAX_GITHUB_SOURCE_CI_RUNS = 100;
export const MAX_APPLICATION_V3_JSON_NODES = 250_000;
export const MAX_APPLICATION_V3_JSON_DEPTH = 256;
export const MAX_APPLICATION_V3_MUTATION_RECEIPT_BYTES = 8 * 1024 * 1024;
export const MAX_APPLICATION_V3_MUTATION_RECEIPT_LOCK_BYTES = 4 * 1024;
export const MAX_GIT_ALTERNATE_ROOTS = 64;
export const MAX_GIT_ALTERNATE_DEPTH = 16;
export const MAX_GIT_ALTERNATE_ENTRIES = 256;
export const MAX_GIT_ALTERNATE_RESOLVE_ATTEMPTS = 64;
export const MAX_GIT_ALTERNATES_FILE_BYTES = 64 * 1024;
export const MAX_GIT_ALTERNATE_PATH_BYTES = 4_096;
export const STRICT_JSON_RESOURCE_CODES = new Set([
  "STRICT_JSON_DEPTH_LIMIT",
  "STRICT_JSON_NODE_LIMIT",
  "STRICT_JSON_SOURCE_LIMIT"
]);
// Application V3 transport identity. All live one-off applications use the
// canonical Submit a Launch intake contract.
export const CENTRAL_GITHUB_REPOSITORY = SUBMIT_LAUNCH_REPOSITORY;
export const CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID = SUBMIT_LAUNCH_REPOSITORY_ID;
export const CENTRAL_GITHUB_REPOSITORY_NAME = SUBMIT_LAUNCH_REPOSITORY_NAME;
export const CENTRAL_GITHUB_BASE_BRANCH = SUBMIT_LAUNCH_BASE_BRANCH;
export const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const FULL_GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
export const SAFE_OUTPUT_FILE_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.json$/u;
export const EXPECTED_MIGRATION_FILES = Object.freeze([
  "legacy-migration-profile.v1.schema.json",
  "idea-source.v1.json",
  "intent-contract.v1.json",
  "architecture-decisions.v1.json",
  "intent-fidelity.v1.json",
  "fee-policy-v2.schema.json",
  "security-assessment-v1.schema.json",
  "security-assessment.v1.json",
  "submission.v2.json"
]);
export const EXPECTED_DRAFT_FILES = Object.freeze([
  "architecture-decisions.v1.json",
  "fee-policy-v2.schema.json",
  "idea-source.v1.json",
  "intent-contract.v1.json",
  "intent-fidelity.v1.json",
  "security-assessment-v1.schema.json",
  "security-assessment.v1.json",
  "submission.v2.json"
]);
export const APPLICATION_PACKAGE_RECORDS = Object.freeze([
  Object.freeze({ kind: "proposal", path: "PROPOSAL.md", mediaType: "text/markdown", maxBytes: 64 * 1024 }),
  Object.freeze({ kind: "test-plan", path: "TEST_PLAN.md", mediaType: "text/markdown", maxBytes: 64 * 1024 }),
  Object.freeze({ kind: "threat-model", path: "THREAT_MODEL.md", mediaType: "text/markdown", maxBytes: 64 * 1024 }),
  Object.freeze({ kind: "compatibility-report", path: "compatibility-report.json", mediaType: "application/json", maxBytes: 160 * 1024 }),
  Object.freeze({ kind: "evidence-index", path: "evidence-index.json", mediaType: "application/json", maxBytes: 160 * 1024 })
]);
export const APPLICATION_V3_REQUIRED_KINDS = Object.freeze([
  "proposal",
  "test-plan",
  "threat-model",
  "compatibility-report",
  "evidence-index",
  "idea-source",
  "intent-contract",
  "architecture-decisions",
  "intent-fidelity",
  "fee-policy-schema",
  "security-assessment-schema",
  "security-assessment"
]);
export const APPLICATION_V2_CENTRAL_FILES = Object.freeze([
  "application.json",
  "PROPOSAL.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "compatibility-report.json",
  "evidence-index.json"
]);
export const publicPrApplicationV2Schema = JSON.parse(fs.readFileSync(
  new URL("../references/public-pr-application.schema.json", import.meta.url),
  "utf8"
));
export const legacySubmissionSchema = JSON.parse(fs.readFileSync(
  new URL("../references/submission.schema.json", import.meta.url),
  "utf8"
));
export const openWorldSecurityV1Bytes = Buffer.from(`${canonicalJson(JSON.parse(fs.readFileSync(
  new URL("../references/open-world-security-v1.schema.json", import.meta.url),
  "utf8"
)))}\n`, "utf8");
export const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
export const exactUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export const canonicalPackageRoot = resolveInstalledPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
