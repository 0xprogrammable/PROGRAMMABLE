import { canonicalJson } from "./submission-core.mjs";
import { compareUtf8 } from "./launch-bundle-v2-registry-projections.mjs";
import {
  REGISTRY_ACCEPTANCE_V3_MAX_JSON_DEPTH,
  REGISTRY_ACCEPTANCE_V3_MAX_JSON_NODES,
  REGISTRY_ACCEPTANCE_V3_MAX_TRUSTED_REVIEW_BYTES,
  REGISTRY_ACCEPTANCE_V3_TIMESTAMP_PATTERN,
  isObject
} from "./launch-bundle-v2-shared.mjs";

export function projectRegistryAcceptanceV3ImmutableReviewAuthority(projection) {
  const authority = structuredClone(projection);
  authority.repository = { numericRepositoryId: projection.repository.numericRepositoryId };
  authority.packageAtHead.repository = {
    numericRepositoryId: projection.packageAtHead.repository.numericRepositoryId
  };
  authority.pullRequest.base.repository = {
    numericRepositoryId: projection.pullRequest.base.repository.numericRepositoryId
  };
  delete authority.pullRequest.author.githubLogin;
  delete authority.pullRequest.url;
  delete authority.review.reviewer.githubLogin;
  delete authority.review.url;
  return authority;
}

export function assertRegistryAcceptanceV3BoundedJson(value) {
  const stack = [{ depth: 1, value }];
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > REGISTRY_ACCEPTANCE_V3_MAX_JSON_NODES || current.depth > REGISTRY_ACCEPTANCE_V3_MAX_JSON_DEPTH) {
      registryAcceptanceV3ReviewFailure(
        "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_INVALID",
        "$runtime.trustedReviewVerification",
        "Trusted Registry review verification exceeds its closed structural bounds."
      );
    }
    if (current.value !== null && typeof current.value === "object") {
      if (seen.has(current.value)) {
        registryAcceptanceV3ReviewFailure(
          "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_INVALID",
          "$runtime.trustedReviewVerification",
          "Trusted Registry review verification must be acyclic JSON data."
        );
      }
      seen.add(current.value);
      for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value)) {
        stack.push({ depth: current.depth + 1, value: child });
      }
    }
  }
  if (Buffer.byteLength(canonicalJson(value), "utf8") > REGISTRY_ACCEPTANCE_V3_MAX_TRUSTED_REVIEW_BYTES) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_INVALID",
      "$runtime.trustedReviewVerification",
      "Trusted Registry review verification exceeds its closed byte bound."
    );
  }
}

export function validRegistryAcceptanceV3Timestamp(value) {
  return typeof value === "string"
    && REGISTRY_ACCEPTANCE_V3_TIMESTAMP_PATTERN.test(value)
    && !Number.isNaN(Date.parse(value));
}

export function safeRegistryAcceptanceV3GitRef(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 255
    && /^[A-Za-z0-9._/-]+$/u.test(value)
    && value !== "@"
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !value.endsWith(".")
    && !value.endsWith(".lock")
    && !value.includes("//")
    && !value.includes("..")
    && !value.includes("@{")
    && value.split("/").every((segment) => segment.length > 0 && !segment.startsWith(".") && !segment.endsWith("."));
}

export function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function hasExactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  return actual.length === wanted.length && actual.every((entry, index) => entry === wanted[index]);
}

export function registryAcceptanceV3ReviewFailure(code, path, message) {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  throw error;
}
