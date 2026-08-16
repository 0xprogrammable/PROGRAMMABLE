import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { parseBoundedStrictJson } from "./strict-json-core.mjs";

export const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
export const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const sha256Pattern = /^[a-f0-9]{64}$/u;
export const unsafeUnicodePattern = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
export const catalogKeys = ["entries", "implementationLegos", "kind", "mandatoryPacks", "policy", "schemaVersion"];
export const policyKeys = [
  "automaticAdverseDecision",
  "missingCatalogLabelOutcome",
  "selectionSemantics",
  "unknownCapabilityOutcome"
];
export const entryKeys = ["id", "kind", "path", "sha256"];
export const implementationLegoReferenceKeys = ["path", "sha256"];
export const implementationLegoManifestKeys = ["entries", "kind", "policy", "schemaVersion"];
export const implementationLegoPolicyKeys = [
  "automaticAdverseDecision",
  "maturityIsAssurance",
  "missingLegoOutcome",
  "selectionSemantics"
];
export const implementationLegoEntryKeys = ["id", "path", "sha256"];
export const implementationLegoKeys = [
  "acceleratorOnly",
  "activatesFor",
  "automaticAdverseDecision",
  "claims",
  "dependencyRequirements",
  "eligibilityEffect",
  "feeApplicability",
  "files",
  "hardConflictPredicates",
  "id",
  "kind",
  "label",
  "maturity",
  "maturityMeaning",
  "projectSurfaces",
  "requiredFacts",
  "requiresLegos",
  "reviewRoute",
  "schemaVersion",
  "summary"
];
export const implementationLegoActivationKeys = ["capabilityIds", "packIds", "starterIds"];
export const implementationLegoClaimsKeys = ["audited", "deployed", "productionReady", "providerSupport"];
export const implementationLegoFileKeys = ["language", "role", "sha256", "sourcePath", "targetPath"];
export const implementationLegoMaturities = new Set(["code-ready", "experimental"]);
export const implementationLegoFeeApplicabilities = new Set([
  "canonical-scope-conformance-unresolved",
  "not-a-fee-enforcement-component",
  "project-scope-declaration-required"
]);
export const implementationLegoLanguages = new Set(["solidity", "typescript"]);
export const implementationLegoFileRoles = new Set(["source", "test"]);
export const PROGRAMMABLE_FEE_OWNER = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const PROGRAMMABLE_PLATFORM_SHARE_BPS = 10;
export const starterKeys = [
  "acceleratorOnly",
  "capabilities",
  "conflictsWith",
  "defaultPacks",
  "eligibilityEffect",
  "id",
  "kind",
  "label",
  "projectSurfaces",
  "requiredFacts",
  "requiredFiles",
  "requiredTests",
  "reviewRoute",
  "risks",
  "schemaVersion",
  "summary",
  "unknownCapabilityPolicy"
];
export const packKeys = [
  "acceleratorOnly",
  "capabilities",
  "conflictsWith",
  "eligibilityEffect",
  "id",
  "kind",
  "label",
  "projectSurfaces",
  "requiredFacts",
  "requiredFiles",
  "requiredTests",
  "requires",
  "reviewRoute",
  "risks",
  "schemaVersion",
  "summary",
  "unknownCapabilityPolicy"
];
export const reviewRoutes = new Set([
  "architecture-review-required",
  "custom-review",
  "standard-review"
]);
export const MAX_DIRECT_TEMPLATE_ITEMS = 256;
export const MAX_USER_SLUG_CHARACTERS = 120;
export const MAX_CUSTOM_LABEL_CODE_POINTS = 120;
export const MAX_CUSTOM_LABEL_BYTES = 480;
export class TemplateCatalogError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "TemplateCatalogError";
    this.code = code;
    this.details = details;
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("CANONICAL_JSON_INVALID", "Canonical JSON accepts safe integers only.");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isPlainObject(value)) fail("CANONICAL_JSON_INVALID", "Canonical JSON accepts plain objects only.");
  return `{${Object.keys(value).sort(compareUtf8).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function unique(values) {
  return [...new Set(values)];
}

export function readJsonFile(filePath, maximumBytes) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") fail("CATALOG_FILE_MISSING", `Missing catalog file: ${filePath}.`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumBytes) {
    fail("CATALOG_FILE_INVALID", `Catalog file is not a bounded regular file: ${filePath}.`);
  }
  const bytes = fs.readFileSync(filePath);
  let text;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    fail("CATALOG_JSON_INVALID", `Catalog file is not valid UTF-8: ${filePath}.`);
  }
  if (text.startsWith("\ufeff")) fail("CATALOG_JSON_INVALID", `Catalog file has a forbidden byte-order mark: ${filePath}.`);
  let value;
  try {
    value = parseBoundedStrictJson(text, { maxSourceBytes: maximumBytes });
  } catch {
    fail("CATALOG_JSON_INVALID", `Catalog file is not valid duplicate-free JSON: ${filePath}.`);
  }
  return { value, bytes };
}

export function readBoundedRegularFile(filePath, maximumBytes, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") fail("CATALOG_FILE_MISSING", `Missing ${label}: ${filePath}.`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) {
    fail("CATALOG_FILE_INVALID", `${label} is not a bounded regular file: ${filePath}.`);
  }
  return fs.readFileSync(filePath);
}

export function listRegularFilesRecursive(directory, relativeTo) {
  assertDirectory(directory, "implementation Lego package directory");
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => compareUtf8(left.name, right.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        fail("CATALOG_FILE_INVALID", `Implementation Lego package contains a symbolic link: ${absolute}.`);
      }
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        fail("CATALOG_FILE_INVALID", `Implementation Lego package contains a non-file entry: ${absolute}.`);
      }
      files.push(path.relative(relativeTo, absolute).split(path.sep).join("/"));
    }
  };
  visit(directory);
  return files;
}

export function resolveCatalogPath(directory, relativePath) {
  assertRelativePath(relativePath, "catalog entry path");
  const resolved = path.resolve(directory, relativePath);
  if (!resolved.startsWith(`${directory}${path.sep}`)) {
    fail("CATALOG_PATH_INVALID", `Catalog path escapes its directory: ${relativePath}.`);
  }
  return resolved;
}

export function assertDirectory(directory, label) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") fail("CATALOG_FILE_MISSING", `Missing ${label}: ${directory}.`);
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("CATALOG_FILE_INVALID", `${label} must be a real directory: ${directory}.`);
  }
}

export function assertExactKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) fail("CATALOG_SCHEMA_INVALID", `${label} must be an object.`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...expectedKeys].sort(compareUtf8);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("CATALOG_SCHEMA_INVALID", `${label} has missing or unknown fields.`, { expected, actual });
  }
}

export function assertId(value, label) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 80 || !idPattern.test(value)) {
    fail("CATALOG_ID_INVALID", `${label} must use lowercase letters, digits and single hyphens.`);
  }
}

export function assertUserSlug(value, label, errorCode) {
  if (
    typeof value !== "string"
    || value.length > MAX_USER_SLUG_CHARACTERS
    || !idPattern.test(value)
  ) {
    fail(errorCode, `${label} must be a safe lowercase slug of at most 120 characters using letters, digits and single hyphens.`);
  }
}

export function assertLocalTag(value, label) {
  if (
    typeof value !== "string"
    || value.length > MAX_USER_SLUG_CHARACTERS
    || !idPattern.test(value)
  ) {
    fail(
      "LOCAL_TAG_INVALID",
      `${label} must be a safe lowercase slug using letters, digits and single hyphens; catalog membership is never required.`
    );
  }
}

export function assertIdArray(value, label, { maximum, allowEmpty = false }) {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length === 0)) {
    fail("CATALOG_SCHEMA_INVALID", `${label} has an invalid number of ids.`);
  }
  for (const id of value) assertId(id, label);
  assertSortedUnique(value, label);
}

export function assertTextArray(value, label, { maximum }) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    fail("CATALOG_SCHEMA_INVALID", `${label} has an invalid number of text entries.`);
  }
  const seen = new Set();
  for (const text of value) {
    assertSafeText(text, label, { maximumBytes: 600 });
    if (seen.has(text)) fail("CATALOG_SCHEMA_INVALID", `${label} contains duplicate text.`);
    seen.add(text);
  }
}

export function assertSortedUnique(values, label) {
  for (let index = 1; index < values.length; index += 1) {
    if (compareUtf8(values[index - 1], values[index]) >= 0) {
      fail("CATALOG_ORDER_INVALID", `${label} must be unique and sorted by UTF-8 bytes.`);
    }
  }
}

export function assertSafeText(value, label, { maximumBytes, maximumCodePoints = null, errorCode = "CATALOG_TEXT_INVALID" }) {
  if (
    typeof value !== "string"
    || value.length === 0
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || (maximumCodePoints !== null && [...value].length > maximumCodePoints)
    || value !== value.normalize("NFC")
    || value.trim() !== value
    || unsafeUnicodePattern.test(value)
  ) {
    fail(errorCode, `${label} must be bounded visible NFC text without control or bidirectional characters.`);
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
      || (codePoint >= 0xe000 && codePoint <= 0xf8ff)
      || (codePoint >= 0xf0000 && codePoint <= 0xffffd)
      || (codePoint >= 0x100000 && codePoint <= 0x10fffd)
      || (codePoint & 0xffff) === 0xfffe
      || (codePoint & 0xffff) === 0xffff
    ) {
      fail(errorCode, `${label} contains a private-use, surrogate or noncharacter code point.`);
    }
  }
}

export function assertRelativePath(value, label) {
  if (
    typeof value !== "string"
    || value.length < 1
    || Buffer.byteLength(value, "utf8") > 240
    || value.startsWith("/")
    || value.includes("\\")
    || value !== value.normalize("NFC")
    || unsafeUnicodePattern.test(value)
  ) {
    fail("CATALOG_PATH_INVALID", `${label} is not a safe relative POSIX path.`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("CATALOG_PATH_INVALID", `${label} contains an empty or traversal segment.`);
  }
}

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function domainHash(domain, payload) {
  return crypto.createHash("sha256")
    .update(Buffer.from(domain, "utf8"))
    .update(Buffer.from([0]))
    .update(Buffer.from(payload, "utf8"))
    .digest("hex");
}

export function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function fail(code, message, details = undefined) {
  throw new TemplateCatalogError(code, message, details);
}
