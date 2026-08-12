import { REVIEW_TARGET_CONTRACT_V1 } from "./review-target-contract.mjs";

export const MAX_FILE_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumFileBytes;
export const MAX_BUILD_INFO_BYTES = 64_000_000;
export const MAX_FILES = REVIEW_TARGET_CONTRACT_V1.maximumFiles;
export const MAX_ENTRIES = 1_024;
export const MAX_TOTAL_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes;
export const MAX_TOTAL_INTAKE_BYTES = MAX_BUILD_INFO_BYTES + MAX_TOTAL_BYTES;
export const MAX_PATH_DEPTH = REVIEW_TARGET_CONTRACT_V1.maximumPathDepth;
export const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const TRUSTED_FIRST_PARTY_ROOTS = Object.freeze([
  "app",
  "contracts",
  "models",
  "script",
  "spec",
  "src",
  "submissions",
  "test"
]);
