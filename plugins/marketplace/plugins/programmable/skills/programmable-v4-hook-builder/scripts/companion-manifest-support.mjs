import path from "node:path";
import { TextDecoder } from "node:util";

import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  parseBoundedLosslessJson
} from "./github-public-source-core.mjs";
import {
  EXACT_PACKAGE_VERSION_PATTERN_SOURCE,
  isCanonicalNpmPackageName
} from "./package-dependency-contract.mjs";
import { isCanonicalReviewTargetPath } from "./review-target-contract.mjs";

export const COMPANION_MANIFEST_V2 = Object.freeze({
  schemaVersion: "2.0.0",
  closureMethod: "npm-package-lock-v3-static-module-closure-v1",
  maximumPaths: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.pathsTotal,
  maximumLockPackages: 8_192
});

export class UnsupportedCompanionClosureError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedCompanionClosureError";
    this.code = "COMPANION_STATIC_CLOSURE_UNSUPPORTED";
  }
}

const V1_KEYS = Object.freeze([
  "contractPaths",
  "repositoryUri",
  "revisionObjectId",
  "schemaVersion",
  "sourcePaths"
]);
const V2_KEYS = Object.freeze([
  "build",
  "closureMethod",
  "githubActionsRunIds",
  "numericRepositoryId",
  "repositoryUri",
  "revisionObjectId",
  "runtimePaths",
  "schemaVersion",
  "sourcePaths",
  "testPaths",
  "treeObjectId"
]);
const BUILD_KEYS = Object.freeze([
  "buildScript",
  "configurationPaths",
  "packageLockPath",
  "packageManifestPath",
  "testScript"
]);
const OPAQUE_ID_PATTERN = /^[1-9][0-9]{0,63}$/u;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/u;
const EXACT_VERSION_PATTERN = new RegExp(EXACT_PACKAGE_VERSION_PATTERN_SOURCE, "u");
const SHA512_INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const SHA256_RECEIPT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ACTION_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const JAVASCRIPT_EXTENSION = /\.(?:[cm]?[jt]sx?)$/iu;
const HTML_EXTENSION = /\.html?$/iu;
const CSS_EXTENSION = /\.css$/iu;
const SHADER_EXTENSION = /\.(?:glsl|vert|frag|wgsl)$/iu;
const JAVASCRIPT_RESOLUTION_EXTENSIONS = Object.freeze([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts", ".json",
  ".css", ".html", ".glsl", ".vert", ".frag", ".wgsl"
]);
const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

function normalizeDependencySpecMap(value, label) {
  if (value === undefined) return Object.create(null);
  if (!isPlainObject(value)) invalid(`${label} must be an object`);
  const output = Object.create(null);
  for (const key of Object.keys(value).sort(compareUtf8)) {
    if (
      !isCanonicalNpmPackageName(key)
      || typeof value[key] !== "string"
      || value[key].length === 0
      || /^(?:file|git|git\+|https?|workspace|link|npm):/iu.test(value[key])
    ) {
      invalid(`${label} contains an invalid dependency declaration`);
    }
    output[key] = value[key];
  }
  return output;
}

function resolveDeclaredDependency(importer, specifier, declaredPaths, { rootRelative = false } = {}) {
  const cleanSpecifier = stripResourceSuffix(specifier);
  if (!rootRelative && !isLocalSpecifier(cleanSpecifier)) {
    invalid(`companion local dependency specifier is unsupported: ${boundedMessage(specifier)}`);
  }
  const base = rootRelative && cleanSpecifier.startsWith("/")
    ? cleanSpecifier.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(importer), cleanSpecifier));
  if (!isCanonicalReviewTargetPath(base)) invalid(`companion dependency escapes the repository: ${boundedMessage(specifier)}`);
  const candidates = [base];
  if (path.posix.extname(base) === "") {
    for (const extension of JAVASCRIPT_RESOLUTION_EXTENSIONS) candidates.push(`${base}${extension}`);
    for (const extension of JAVASCRIPT_RESOLUTION_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  }
  const matches = [...new Set(candidates)].filter((candidate) => declaredPaths.has(candidate));
  if (matches.length !== 1) {
    invalid(`companion dependency must resolve to exactly one declared closure path: ${importer} -> ${boundedMessage(specifier)}`);
  }
  return matches[0];
}

function extractHtmlDependencies(source, importer) {
  if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/iu.test(source)) {
    invalid(`companion inline HTML scripts are outside the v2 static closure method: ${importer}`);
  }
  if (
    /<style\b|\sstyle\s*=|\bsrcset\s*=|\b(?:poster|data|action|formaction)\s*=|<base\b|<meta\b[^>]*http-equiv\s*=\s*["']?refresh|\son[a-z]+\s*=/iu.test(source)
  ) invalid(`companion HTML contains an unsupported active or multi-resource form: ${importer}`);
  const dependencies = [];
  const assignments = [...source.matchAll(/\b(?:src|href)\s*=/giu)];
  const attribute = /\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'`=<>]+))/giu;
  let parsed = 0;
  for (const match of source.matchAll(attribute)) {
    parsed += 1;
    const specifier = match[1] ?? match[2] ?? match[3];
    if (isExternalResource(specifier)) unsupportedStaticClosure(
      `external HTML resource loading is outside companion v2 static closure: ${importer}`
    );
    dependencies.push(specifier);
  }
  if (parsed !== assignments.length) invalid(`companion HTML resource attribute syntax is unsupported: ${importer}`);
  return uniqueSorted(dependencies);
}

function extractCssDependencies(source, importer) {
  if (/expression\s*\(|@supports\s+selector\s*\(/iu.test(source)) {
    invalid(`companion CSS uses unsupported dynamic syntax: ${importer}`);
  }
  const dependencies = [];
  const pattern = /@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?|url\(\s*(["']?)([^)'"\s]+)\3\s*\)/giu;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[2] ?? match[4];
    if (isExternalResource(specifier)) unsupportedStaticClosure(
      `external CSS resource loading is outside companion v2 static closure: ${importer}`
    );
    dependencies.push(specifier);
  }
  return uniqueSorted(dependencies);
}

function extractShaderDependencies(source, importer) {
  const dependencies = [];
  const pattern = /^\s*#include\s+(["'])([^"']+)\1\s*$/gmu;
  for (const match of source.matchAll(pattern)) dependencies.push(match[2]);
  if (/^\s*#include\s+[^<"'\s]/mu.test(source)) {
    invalid(`companion shader contains an unsupported include form: ${importer}`);
  }
  return uniqueSorted(dependencies);
}

function parseBoundedJson(bytes, label) {
  let source;
  try {
    source = STRICT_UTF8.decode(bytes);
    return parseBoundedLosslessJson(source);
  } catch {
    invalid(`companion ${label} is not bounded duplicate-free UTF-8 JSON`);
  }
}

function normalizePathArray(value, label, { minimum = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > COMPANION_MANIFEST_V2.maximumPaths) {
    invalid(`companion ${label} count is outside the v2 bounds`);
  }
  const paths = value.map((entry) => normalizePath(entry, label));
  if (!isStrictlySorted(paths)) invalid(`companion ${label} must use unique unsigned UTF-8 order`);
  return paths;
}

function normalizeOpaqueIdArray(value, { minimum = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 16 || value.some((entry) => !OPAQUE_ID_PATTERN.test(entry))) {
    invalid("companion githubActionsRunIds are invalid");
  }
  if (!isStrictlySorted(value)) invalid("companion githubActionsRunIds must use unique unsigned UTF-8 order");
  return [...value];
}

function normalizePath(value, label) {
  if (!isCanonicalReviewTargetPath(value)) invalid(`companion ${label} contains an invalid repository path`);
  return value;
}

function manifestClosurePaths(manifest) {
  return [
    ...manifest.sourcePaths,
    ...manifest.testPaths,
    ...manifest.runtimePaths,
    ...manifest.build.configurationPaths,
    manifest.build.packageManifestPath,
    manifest.build.packageLockPath
  ].sort(compareUtf8);
}

function packageCount(packageLock) {
  return isPlainObject(packageLock?.packages) ? Object.keys(packageLock.packages).length - 1 : 0;
}

function isCanonicalLockPackagePath(value) {
  if (!isCanonicalReviewTargetPath(value) || !value.includes("node_modules/")) return false;
  const segments = value.split("/");
  let index = 0;
  while (index < segments.length) {
    if (segments[index] !== "node_modules") return false;
    index += 1;
    const next = segments[index];
    if (!next) return false;
    if (next.startsWith("@")) {
      const scoped = `${next}/${segments[index + 1] ?? ""}`;
      if (!isCanonicalNpmPackageName(scoped)) return false;
      index += 2;
    } else {
      if (!isCanonicalNpmPackageName(next)) return false;
      index += 1;
    }
  }
  return true;
}

function isCanonicalNpmRegistryTarball(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048 || CONTROL_OR_BIDI_PATTERN.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "registry.npmjs.org"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

function isSha512Integrity(value) {
  if (typeof value !== "string" || !SHA512_INTEGRITY_PATTERN.test(value)) return false;
  const encoded = value.slice("sha512-".length);
  try {
    const bytes = Buffer.from(encoded, "base64");
    return bytes.length === 64 && bytes.toString("base64") === encoded;
  } catch {
    return false;
  }
}

function isExactObjectRecord(value) {
  return isPlainObject(value)
    && (value.mode === "100644" || value.mode === "100755")
    && GIT_OBJECT_PATTERN.test(value.objectId ?? "")
    && value.bytes instanceof Uint8Array;
}

function isLocalSpecifier(value) {
  return value === "." || value === ".." || value.startsWith("./") || value.startsWith("../");
}

function stripResourceSuffix(value) {
  if (typeof value !== "string" || value.length === 0 || CONTROL_OR_BIDI_PATTERN.test(value)) {
    invalid("companion resource specifier is invalid");
  }
  return value.split(/[?#]/u, 1)[0];
}

function isExternalResource(value) {
  const lower = value.toLowerCase();
  return lower.startsWith("data:")
    || lower.startsWith("http://")
    || lower.startsWith("https://")
    || value.startsWith("//")
    || value.startsWith("#")
    || lower.startsWith("mailto:")
    || lower.startsWith("tel:");
}

function isDeclarativeOrAssetPath(value) {
  return /\.(?:json|md|txt|ya?ml|toml|svg|png|jpe?g|webp|gif|ico|wasm|mp3|ogg|wav|mp4|webm|woff2?|ttf|otf)$/iu.test(value);
}

function decodeText(bytes, label) {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    invalid(`companion closure text is not UTF-8: ${label}`);
  }
}

function losslessInteger(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (isPlainObject(value) && typeof value.source === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value.source)) {
    const number = Number(value.source);
    return Number.isSafeInteger(number) ? number : null;
  }
  return null;
}

function assertExactKeys(value, expected, message) {
  const keys = Object.keys(value).sort(compareUtf8);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) invalid(message);
}

function assertUniqueSorted(values, message) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === values[index]) invalid(message);
  }
}

function isStrictlySorted(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (compareUtf8(values[index - 1], values[index]) >= 0) return false;
  }
  return true;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareUtf8);
}

function boundedMessage(value) {
  const text = typeof value === "string" ? value : "invalid input";
  return text.length <= 240 ? text : `${text.slice(0, 237)}...`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function invalid(message) {
  throw new Error(message);
}

function unsupportedStaticClosure(message) {
  throw new UnsupportedCompanionClosureError(message);
}

export const companionManifestSupport = Object.freeze({
  ACTION_SHA_PATTERN,
  BUILD_KEYS,
  CONTROL_OR_BIDI_PATTERN,
  CSS_EXTENSION,
  EXACT_VERSION_PATTERN,
  GIT_OBJECT_PATTERN,
  HTML_EXTENSION,
  JAVASCRIPT_EXTENSION,
  OPAQUE_ID_PATTERN,
  SCRIPT_NAME_PATTERN,
  SHA256_RECEIPT_PATTERN,
  SHADER_EXTENSION,
  V1_KEYS,
  V2_KEYS,
  assertExactKeys,
  assertUniqueSorted,
  boundedMessage,
  compareUtf8,
  decodeText,
  deepFreeze,
  extractCssDependencies,
  extractHtmlDependencies,
  extractShaderDependencies,
  invalid,
  isCanonicalLockPackagePath,
  isCanonicalNpmRegistryTarball,
  isDeclarativeOrAssetPath,
  isExactObjectRecord,
  isLocalSpecifier,
  isPlainObject,
  isSha512Integrity,
  isStrictlySorted,
  losslessInteger,
  manifestClosurePaths,
  normalizeDependencySpecMap,
  normalizeOpaqueIdArray,
  normalizePath,
  normalizePathArray,
  packageCount,
  parseBoundedJson,
  resolveDeclaredDependency,
  unsupportedStaticClosure
});
