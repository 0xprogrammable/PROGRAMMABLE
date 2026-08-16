import { isCanonicalReviewTargetPath } from "./review-target-contract.mjs";
import { isObject } from "./submission-value-core.mjs";

const placeholderPattern = /\\b(?:unresolved|unknown|tbd|todo|to be determined|not decided)\\b/i;

export function resolvedText(value) {
  return typeof value === "string" && value.trim().length > 0 && !placeholderPattern.test(value);
}

export function inspectProviderEvidence(presentation, nowEpochMs) {
  const fields = [
    presentation?.observedAt,
    presentation?.validUntil,
    presentation?.evidenceKind,
    presentation?.evidenceUri,
    presentation?.evidenceSha256
  ];
  const any = fields.some((value) => value !== null && value !== undefined);
  const complete = fields.every((value) => typeof value === "string" && value.length > 0);
  const observedAt = complete ? parseProviderTimestamp(presentation.observedAt) : null;
  const validUntil = complete ? parseProviderTimestamp(presentation.validUntil) : null;
  const validInterval = complete
    && observedAt !== null
    && validUntil !== null
    && validUntil > observedAt;
  return {
    any,
    complete,
    validInterval,
    expired: validInterval && validUntil <= nowEpochMs,
    observedInFuture: observedAt !== null && observedAt > nowEpochMs + 300_000
  };
}

function parseProviderTimestamp(value) {
  if (typeof value !== "string") return null;
  const match = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.[0-9]{1,9})?Z$/u.exec(value);
  if (!match) return null;
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString().slice(0, 19) !== match[1]) return null;
  return epochMs;
}


export function hasResolvedPolicyValue(value) {
  if (typeof value === "string") return resolvedText(value);
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((entry) => hasResolvedPolicyValue(entry));
  if (isObject(value)) return Object.values(value).some((entry) => hasResolvedPolicyValue(entry));
  return false;
}

export function isSafeRepositoryPath(value) {
  return isCanonicalReviewTargetPath(value);
}

export function objectAt(parent, key) {
  return isObject(parent?.[key]) ? parent[key] : {};
}


export function collectOperationNames(value, result = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectOperationNames(entry, result);
  } else if (isObject(value)) {
    if (typeof value.operation === "string") result.add(value.operation);
    for (const entry of Object.values(value)) collectOperationNames(entry, result);
  }
  return result;
}


export function sameStringList(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export function isSortedUniqueUtf8(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (Buffer.compare(Buffer.from(values[index - 1], "utf8"), Buffer.from(values[index], "utf8")) >= 0) return false;
  }
  return true;
}
