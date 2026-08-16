import {
  isCanonicalReviewTargetPath,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";

export const FOUNDRY_BUILD_INFO_FORMAT = "ethers-rs-sol-build-info-1";

export const MAX_FILES = REVIEW_TARGET_CONTRACT_V1.maximumFiles;
export const MAX_FILE_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumFileBytes;
export const MAX_TOTAL_SOURCE_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes;
export const MAX_PATH_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumPathBytes;
export const MAX_REPOSITORY_ROOTS = 32;
export const MAX_REMAPPINGS = 128;
export const MAX_DIAGNOSTICS = 4_096;
export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_NODES = 2_000_000;
export const MAX_JSON_STRING_BYTES = 100_000_000;
export const MAX_COLLECTION_ENTRIES = 1_000_000;
export const MAX_SOURCE_ID = 2_147_483_647;

export function validateJsonStructure(value, label, errors) {
  if (value === undefined) {
    errors.push(`${label} is required`);
    return false;
  }

  const stack = [{ value, depth: 0 }];
  const seen = new Set();
  let nodes = 0;
  let stringBytes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      errors.push(`${label} exceeds ${MAX_JSON_NODES} JSON values`);
      return false;
    }
    if (current.depth > MAX_JSON_DEPTH) {
      errors.push(`${label} exceeds maximum depth ${MAX_JSON_DEPTH}`);
      return false;
    }

    const valueType = typeof current.value;
    if (current.value === null || valueType === "boolean") continue;
    if (valueType === "string") {
      stringBytes += Buffer.byteLength(current.value, "utf8");
      if (stringBytes > MAX_JSON_STRING_BYTES) {
        errors.push(`${label} exceeds ${MAX_JSON_STRING_BYTES} string bytes`);
        return false;
      }
      continue;
    }
    if (valueType === "number") {
      if (!Number.isFinite(current.value)) {
        errors.push(`${label} contains a non-finite number`);
        return false;
      }
      continue;
    }
    if (valueType !== "object") {
      errors.push(`${label} contains a non-JSON value`);
      return false;
    }
    if (!Array.isArray(current.value) && !isPlainObject(current.value)) {
      errors.push(`${label} contains a non-JSON object`);
      return false;
    }
    if (seen.has(current.value)) {
      errors.push(`${label} contains a repeated or cyclic object reference`);
      return false;
    }
    seen.add(current.value);

    if (
      Array.isArray(current.value) &&
      current.value.length > MAX_COLLECTION_ENTRIES
    ) {
      errors.push(`${label} contains an oversized array`);
      return false;
    }

    const descriptors = Object.getOwnPropertyDescriptors(current.value);
    const keys = Object.keys(descriptors).filter(
      (key) => descriptors[key].enumerable
    );
    if (keys.length > MAX_COLLECTION_ENTRIES) {
      errors.push(`${label} contains an oversized object`);
      return false;
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, "value")) {
        errors.push(`${label} contains an accessor property`);
        return false;
      }
      stringBytes += Buffer.byteLength(key, "utf8");
      if (stringBytes > MAX_JSON_STRING_BYTES) {
        errors.push(`${label} exceeds ${MAX_JSON_STRING_BYTES} string bytes`);
        return false;
      }
      stack.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  return true;
}

export function safeRelativePath(value) {
  return isCanonicalReviewTargetPath(value);
}

export function validRelativeRemapping(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_024 ||
    value.includes("\\") ||
    containsControlCharacter(value)
  ) {
    return false;
  }
  const separator = value.indexOf("=");
  if (separator <= 0 || separator !== value.lastIndexOf("=")) return false;

  const left = value.slice(0, separator);
  const target = stripTrailingSlash(value.slice(separator + 1));
  if (!safeRelativePath(target)) return false;

  const contextSeparator = left.lastIndexOf(":");
  const context =
    contextSeparator === -1 ? null : stripTrailingSlash(left.slice(0, contextSeparator));
  const prefix =
    contextSeparator === -1 ? left : left.slice(contextSeparator + 1);
  if (context !== null && !safeRelativePath(context)) return false;
  if (
    prefix.length === 0 ||
    prefix.length > MAX_PATH_BYTES ||
    prefix.startsWith("/") ||
    prefix.includes("\\") ||
    containsControlCharacter(prefix) ||
    !/^[A-Za-z0-9@_./-]+$/.test(prefix) ||
    prefix.split("/").some((part) => part === "." || part === "..")
  ) {
    return false;
  }
  return true;
}

function stripTrailingSlash(value) {
  return typeof value === "string" && value.endsWith("/")
    ? value.slice(0, -1)
    : value;
}

export function containsControlCharacter(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export function isFirstParty(sourcePath, roots) {
  return roots.some(
    (root) => sourcePath === root || sourcePath.startsWith(`${root}/`)
  );
}

export function sameStringArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function byMapKey([left], [right]) {
  return left.localeCompare(right);
}

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function finalize(errors) {
  return [...new Set(errors)].sort();
}
