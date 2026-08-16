import crypto from "node:crypto";

export const LEGACY_CANONICAL_JSON_V1_PROFILE = Object.freeze({
  id: "urn:programmable:canonical-json:legacy-v1",
  status: "frozen-compatibility-only",
  keyOrder: "ecmascript-utf16-code-unit",
  primitiveEncoding: "json-stringify",
  objectModel: "historical-enumerable-keys",
  newContractsAllowed: false
});

/**
 * Compatibility adapter for already-frozen V1 digests.
 *
 * This deliberately retains the historical default Array#sort key order and
 * primitive JSON.stringify behavior. New contracts must use canonicalJsonV2.
 */
export function canonicalJsonLegacyV1(value) {
  return serializeLegacyValue(value, new Set(), "$");
}

export function canonicalJsonLegacyBytesV1(value, { trailingNewline = false } = {}) {
  if (typeof trailingNewline !== "boolean") throw new TypeError("trailingNewline must be a boolean");
  return Buffer.from(`${canonicalJsonLegacyV1(value)}${trailingNewline ? "\n" : ""}`, "utf8");
}

export function canonicalJsonLegacySha256V1(value, options = undefined) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJsonLegacyBytesV1(value, options)).digest("hex")}`;
}

function serializeLegacyValue(value, ancestors, path) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (ancestors.has(value)) {
    const error = new TypeError(`legacy canonical JSON rejects cyclic values at ${path}`);
    error.code = "LEGACY_CANONICAL_JSON_CYCLE";
    throw error;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry, index) => serializeLegacyValue(entry, ancestors, `${path}/${index}`)).join(",")}]`;
    }
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${serializeLegacyValue(value[key], ancestors, `${path}/${key}`)}`
    )).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
