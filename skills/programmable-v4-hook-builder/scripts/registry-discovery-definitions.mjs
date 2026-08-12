import {
  SUBMIT_LAUNCH_API_URL,
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_RAW_URL,
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID,
  SUBMIT_LAUNCH_REPOSITORY_URL
} from "./registry-intake-contract.mjs";

export const PROGRAMMABLE_REGISTRY = Object.freeze({
  apiRepository: SUBMIT_LAUNCH_API_URL,
  defaultBranch: SUBMIT_LAUNCH_BASE_BRANCH,
  numericRepositoryId: SUBMIT_LAUNCH_REPOSITORY_ID,
  rawRepository: SUBMIT_LAUNCH_RAW_URL,
  repository: SUBMIT_LAUNCH_REPOSITORY,
  repositoryUri: SUBMIT_LAUNCH_REPOSITORY_URL
});

// The bundled snapshot predates the in-place repository rename. Its signed
// bytes retain the historical slug while sharing the same immutable GitHub id.
export const PROGRAMMABLE_REGISTRY_SNAPSHOT_IDENTITY = Object.freeze({
  defaultBranch: SUBMIT_LAUNCH_BASE_BRANCH,
  numericRepositoryId: SUBMIT_LAUNCH_REPOSITORY_ID,
  repository: "0xprogrammable/programmable-registry",
  repositoryUri: "https://github.com/0xprogrammable/programmable-registry"
});

export const REGISTRY_PROJECT_SCHEMA_VERSION = "1.0.0";
export const REGISTRY_INDEX_LEGACY_VERSION = "1.0.0";
export const REGISTRY_INDEX_CURRENT_VERSION = "1.1.0";
export const REGISTRY_INDEX_SUPPORTED_VERSIONS = new Set([
  REGISTRY_INDEX_LEGACY_VERSION,
  REGISTRY_INDEX_CURRENT_VERSION
]);
export const REGISTRY_PUBLIC_BASELINE_COMMIT = "44ac828400aafb65ee13bc85596e38fe1a578fbc";
export const SNAPSHOT_SCHEMA_VERSION = "2.0.0";
export const SNAPSHOT_SOURCE_RECEIPT_VERSION = "1.0.0";
export const COMMIT = /^[0-9a-f]{40}$/u;
export const DIGEST = /^sha256:[0-9a-f]{64}$/u;
export const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const ACCEPTANCE_PATH = /^registry\/acceptances\/([a-z0-9]+(?:-[a-z0-9]+)*)\/[a-z0-9][a-z0-9.-]*\.json$/u;
export const CONTROL_OR_BIDI = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
export const UNPAIRED_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/u;
export const MAXIMUM_INDEX_BYTES = 2 * 1024 * 1024;
export const MAXIMUM_RECORD_BYTES = 128 * 1024;
export const MAXIMUM_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAXIMUM_SOURCE_OBJECTS = 128;
export const MAXIMUM_SOURCE_OBJECT_BYTES = 4 * 1024 * 1024;
export const MAXIMUM_RECORDS = 10_000;
export const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "das", "der", "die", "ein", "eine", "for", "from",
  "fur", "in", "is", "it", "mit", "of", "on", "or", "the", "to", "und", "von", "with"
]);

export class RegistryDiscoveryError extends Error {
  constructor(code, message, { exitCode = 1 } = {}) {
    super(message);
    this.name = "RegistryDiscoveryError";
    this.code = code;
    this.exitCode = exitCode;
  }
}
