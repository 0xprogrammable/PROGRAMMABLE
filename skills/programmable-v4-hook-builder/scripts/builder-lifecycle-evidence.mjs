import {
  SHA256_PATTERN,
  assertExactKeys,
  assertPlainObject,
  invalid,
  requireSafeRelativePath,
  timestampMs
} from "./builder-lifecycle-shared.mjs";

export function validateEvidenceMap(value, location, exactKeys) {
  assertPlainObject(value, location);
  assertExactKeys(value, exactKeys, location);
  for (const key of exactKeys) validateEvidenceSlot(value[key], `${location}.${key}`);
}

export function validateEvidenceSlot(value, location) {
  assertPlainObject(value, location);
  assertExactKeys(value, ["status", "path", "evidenceSha256"], location);
  if (!new Set(["pending", "complete"]).has(value.status)) invalid("EVIDENCE_SLOT_INVALID", `${location}.status is invalid`);
  if (value.path !== null) requireSafeRelativePath(value.path, `${location}.path`);
  if (value.evidenceSha256 !== null && !SHA256_PATTERN.test(value.evidenceSha256)) invalid("EVIDENCE_SLOT_INVALID", `${location}.evidenceSha256 is invalid`);
}

export function validateOwnerEvidence(value, location, statuses) {
  assertPlainObject(value, location);
  assertExactKeys(value, ["status", "path", "evidenceSha256", "releaseIntentSha256", "grantedAt"], location);
  if (!statuses.includes(value.status)) invalid("RELEASE_CANDIDATE_INVALID", `${location}.status is invalid`);
  if (value.path !== null) requireSafeRelativePath(value.path, `${location}.path`);
  if (value.evidenceSha256 !== null && !SHA256_PATTERN.test(value.evidenceSha256)) invalid("RELEASE_CANDIDATE_INVALID", `${location}.evidenceSha256 is invalid`);
  if (value.releaseIntentSha256 !== null && !SHA256_PATTERN.test(value.releaseIntentSha256)) invalid("RELEASE_CANDIDATE_INVALID", `${location}.releaseIntentSha256 is invalid`);
  if (value.grantedAt !== null) timestampMs(value.grantedAt, `${location}.grantedAt`);
  if (value.status !== "granted" && (value.path !== null || value.evidenceSha256 !== null || value.releaseIntentSha256 !== null || value.grantedAt !== null)) {
    invalid("RELEASE_CANDIDATE_INVALID", `${location} cannot carry evidence unless its status is granted`);
  }
}

export function evaluateDeclaredEvidenceSlot(slot, location) {
  validateEvidenceSlot(slot, location);
  const coordinatesComplete = validEvidenceCoordinates(slot);
  const callerDeclaredComplete = slot.status === "complete" && coordinatesComplete;
  return {
    callerDeclaredStatus: slot.status,
    callerDeclaredComplete,
    evidenceCoordinatesComplete: coordinatesComplete,
    path: slot.path,
    evidenceSha256: slot.evidenceSha256,
    artifactRead: false,
    evidenceDigestVerified: false,
    externallyVerified: false,
    blocker: callerDeclaredComplete ? null : `${location} needs status complete, a nonempty path, and caller-declared SHA-256 coordinates before local planning can be complete.`
  };
}

export function validEvidenceCoordinates(value) {
  return typeof value.path === "string" && value.path.trim().length > 0 && SHA256_PATTERN.test(value.evidenceSha256 ?? "");
}

export function grantedAtNotBefore(value, earliestMs) {
  return value.grantedAt !== null && timestampMs(value.grantedAt, "owner evidence grantedAt") >= earliestMs;
}

export function grantedAtNotAfter(value, latestMs) {
  return value.grantedAt !== null && timestampMs(value.grantedAt, "owner evidence grantedAt") <= latestMs;
}

export function validGrantedEvidence(value, earliestMs, latestMs, expectedIntentSha256) {
  return value.status === "granted"
    && validEvidenceCoordinates(value)
    && value.releaseIntentSha256 === expectedIntentSha256
    && grantedAtNotBefore(value, earliestMs)
    && grantedAtNotAfter(value, latestMs);
}
