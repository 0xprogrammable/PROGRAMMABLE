import crypto from "node:crypto";

export const CANONICAL_JSON_V2_PROFILE = Object.freeze({
  id: "urn:programmable:canonical-json:2.0.0",
  version: "2.0.0",
  keyOrder: "utf8-bytewise",
  numberEncoding: "finite-ecmascript-json-number",
  unicode: "unicode-scalar-values-without-normalization",
  objectModel: "plain-data-objects-and-dense-arrays",
  maximumDepth: 256,
  maximumNodes: 1_000_000
});

export class CanonicalJsonError extends TypeError {
  constructor(code, message, path = "$") {
    super(`${message} at ${path}`);
    this.name = "CanonicalJsonError";
    this.code = code;
    this.path = path;
  }
}

export function canonicalJsonV2(value) {
  const state = {
    ancestors: new Set(),
    nodes: 0
  };
  return serializeCanonicalValue(value, "$", 0, state);
}

export function canonicalJsonBytesV2(value, { trailingNewline = false } = {}) {
  if (typeof trailingNewline !== "boolean") {
    throw new TypeError("trailingNewline must be a boolean");
  }
  const suffix = trailingNewline ? "\n" : "";
  return Buffer.from(`${canonicalJsonV2(value)}${suffix}`, "utf8");
}

export function canonicalJsonSha256V2(value, options = undefined) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJsonBytesV2(value, options)).digest("hex")}`;
}

function serializeCanonicalValue(value, path, depth, state) {
  state.nodes += 1;
  if (state.nodes > CANONICAL_JSON_V2_PROFILE.maximumNodes) {
    invalid("CANONICAL_JSON_NODE_LIMIT", "Canonical JSON exceeds the node limit", path);
  }
  if (depth > CANONICAL_JSON_V2_PROFILE.maximumDepth) {
    invalid("CANONICAL_JSON_DEPTH_LIMIT", "Canonical JSON exceeds the nesting-depth limit", path);
  }
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalid("CANONICAL_JSON_NON_FINITE_NUMBER", "Canonical JSON rejects non-finite numbers", path);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    invalid("CANONICAL_JSON_UNSUPPORTED_TYPE", `Canonical JSON rejects ${typeof value}`, path);
  }
  if (state.ancestors.has(value)) {
    invalid("CANONICAL_JSON_CYCLE", "Canonical JSON rejects cyclic values", path);
  }
  state.ancestors.add(value);
  try {
    return Array.isArray(value)
      ? serializeDenseArray(value, path, depth, state)
      : serializePlainObject(value, path, depth, state);
  } finally {
    state.ancestors.delete(value);
  }
}

function serializeDenseArray(value, path, depth, state) {
  const ownKeys = Reflect.ownKeys(value);
  let indexedProperties = 0;
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !isCanonicalArrayIndex(key, value.length)) {
      invalid("CANONICAL_JSON_ARRAY_SHAPE", "Canonical JSON arrays cannot have symbolic or named properties", path);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true) {
      invalid("CANONICAL_JSON_NON_ENUMERABLE_PROPERTY", "Canonical JSON accepts enumerable properties only", `${path}/${key}`);
    }
    if (!Object.hasOwn(descriptor, "value")) {
      invalid("CANONICAL_JSON_ACCESSOR", "Canonical JSON accepts enumerable data properties only", `${path}/${key}`);
    }
    indexedProperties += 1;
  }
  if (indexedProperties !== value.length) {
    invalid("CANONICAL_JSON_SPARSE_ARRAY", "Canonical JSON rejects sparse arrays", path);
  }
  const entries = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    entries.push(serializeCanonicalValue(descriptor.value, `${path}/${index}`, depth + 1, state));
  }
  return `[${entries.join(",")}]`;
}

function serializePlainObject(value, path, depth, state) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("CANONICAL_JSON_NON_PLAIN_OBJECT", "Canonical JSON accepts plain objects only", path);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    invalid("CANONICAL_JSON_SYMBOL_KEY", "Canonical JSON rejects symbol-keyed properties", path);
  }
  const stringKeys = keys;
  for (const key of stringKeys) {
    assertUnicodeScalarString(key, `${path}/<key>`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true) {
      invalid("CANONICAL_JSON_NON_ENUMERABLE_PROPERTY", "Canonical JSON accepts enumerable properties only", pointerPath(path, key));
    }
    if (!Object.hasOwn(descriptor, "value")) {
      invalid("CANONICAL_JSON_ACCESSOR", "Canonical JSON accepts enumerable data properties only", pointerPath(path, key));
    }
  }
  stringKeys.sort(compareUtf8);
  return `{${stringKeys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return `${JSON.stringify(key)}:${serializeCanonicalValue(descriptor.value, pointerPath(path, key), depth + 1, state)}`;
  }).join(",")}}`;
}

function isCanonicalArrayIndex(value, length) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) return false;
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === value;
}

function assertUnicodeScalarString(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        invalid("CANONICAL_JSON_INVALID_UNICODE", "Canonical JSON rejects unpaired UTF-16 surrogates", path);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid("CANONICAL_JSON_INVALID_UNICODE", "Canonical JSON rejects unpaired UTF-16 surrogates", path);
    }
  }
}

function pointerPath(parent, key) {
  return `${parent}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function invalid(code, message, path) {
  throw new CanonicalJsonError(code, message, path);
}
