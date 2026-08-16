import crypto from "node:crypto";
import { canonicalJson } from "./submission-core.mjs";

export const APPLICATION_RECHECK_SCHEMA_VERSION = "1.0.0";
export const TARGET_APPLICATION_CONTRACT = "public-pr-application-v3";
export const TARGET_APPLICATION_CONTRACT_VERSION = "3.0.0";
export const TARGET_SUBMISSION_STANDARD = "2.0.0";
export const TARGET_VALIDATOR_PROFILE = "intent-open-world-v1";
export const OPEN_WORLD_MIGRATION_SCHEMA_VERSION = "1.0.0";
export const OPEN_WORLD_SUBMISSION_SCHEMA_ID = "urn:programmable:v4-hook-submission:2.0.0";
export const IDEA_SOURCE_SCHEMA_ID = "urn:programmable:idea-source:1.0.0";
export const INTENT_CONTRACT_SCHEMA_ID = "urn:programmable:intent-contract:1.0.0";
export const ARCHITECTURE_DECISIONS_SCHEMA_ID = "urn:programmable:architecture-decisions:1.0.0";
export const INTENT_FIDELITY_SCHEMA_ID = "urn:programmable:intent-fidelity:1.0.0";
export const HISTORICAL_APPLICATION_FILES = Object.freeze([
  "application.json",
  "PROPOSAL.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "compatibility-report.json",
  "evidence-index.json"
]);


export class ApplicationRecheckError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ApplicationRecheckError";
    this.code = code;
    this.details = details;
    this.exitCode = code === "USAGE_ERROR" ? 2 : 1;
  }
}

export function sha256Bytes(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError("sha256Bytes requires a Buffer");
  }
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}
