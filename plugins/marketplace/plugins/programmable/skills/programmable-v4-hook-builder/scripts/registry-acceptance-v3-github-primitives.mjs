import crypto from "node:crypto";

import { canonicalJson } from "./submission-core.mjs";

import { safePathPattern } from "./registry-acceptance-v3-github-constants.mjs";

export class RegistryAcceptanceV3GithubVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RegistryAcceptanceV3GithubVerificationError";
    this.code = code;
  }
}
export function requireEqualIdentity(observed, expected, code) {
  if (canonicalJson(observed) !== canonicalJson(expected)) fail(code, "GitHub repository identity does not match the canonical Registry");
}

export function opaqueId(value, label) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== "string" || !/^[1-9][0-9]{0,63}$/u.test(normalized)) fail("REGISTRY_REVIEW_API_INVALID", `${label} is not one exact opaque decimal id`);
  return normalized;
}

export function canonicalTimestamp(value, label) {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u.test(value) || Number.isNaN(Date.parse(value))) fail("REGISTRY_REVIEW_API_INVALID", `${label} is not canonical UTC`);
  return value;
}

export function safeGitRef(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 255
    && /^[A-Za-z0-9._/-]+$/u.test(value) && value !== "@" && !value.startsWith("/") && !value.endsWith("/")
    && !value.endsWith(".") && !value.endsWith(".lock") && !value.includes("//") && !value.includes("..") && !value.includes("@{")
    && value.split("/").every((segment) => segment.length > 0 && !segment.startsWith(".") && !segment.endsWith("."));
}

export function safeRepositoryPath(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 4096 && safePathPattern.test(value);
}

export function safeTreeSegment(value) {
  return typeof value === "string" && value.length >= 1 && value !== "." && value !== ".." && !value.includes("/") && !/[\u0000-\u001f\u007f-\u009f\\]/u.test(value);
}

export function gitBlobObjectId(bytes) {
  return crypto.createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`, "utf8")).update(bytes).digest("hex");
}

export function sha256Utf8(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

export function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function fail(code, message) {
  throw new RegistryAcceptanceV3GithubVerificationError(code, message);
}
