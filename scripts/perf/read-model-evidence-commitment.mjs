import { createHash, timingSafeEqual } from "node:crypto";

const NONZERO_BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return JSON.stringify(value);
  }
  throw new Error("read-model evidence contains a non-JSON value");
}

export function sha256Canonical(value) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function commitmentPayload(value) {
  if (!isPlainObject(value)) {
    throw new Error("read-model evidence must be an object");
  }
  const payload = { ...value };
  Reflect.deleteProperty(payload, "evidenceSha256");
  return payload;
}

export function readModelReleaseEvidenceCommitment(value) {
  return `0x${sha256Canonical(commitmentPayload(value))}`;
}

export function commitReadModelReleaseEvidence(payload) {
  if (
    !isPlainObject(payload) ||
    Object.prototype.hasOwnProperty.call(payload, "evidenceSha256")
  ) {
    throw new Error("read-model evidence payload is already committed");
  }
  return {
    ...payload,
    evidenceSha256: readModelReleaseEvidenceCommitment(payload),
  };
}

export function assertReadModelReleaseEvidenceCommitment(value) {
  if (
    !isPlainObject(value) ||
    !Object.prototype.hasOwnProperty.call(value, "evidenceSha256")
  ) {
    throw new Error("read-model evidence commitment is missing");
  }
  const actual = value.evidenceSha256;
  if (typeof actual !== "string" || !NONZERO_BYTES32.test(actual)) {
    throw new Error("read-model evidence commitment is invalid");
  }
  const expected = readModelReleaseEvidenceCommitment(value);
  if (
    !timingSafeEqual(
      Buffer.from(actual.slice(2), "hex"),
      Buffer.from(expected.slice(2), "hex"),
    )
  ) {
    throw new Error("read-model evidence commitment is invalid");
  }
  return actual;
}
