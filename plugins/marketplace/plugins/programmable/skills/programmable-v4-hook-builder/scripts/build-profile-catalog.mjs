import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCatalogPath = path.resolve(scriptDirectory, "..", "assets", "build-profiles", "catalog.json");
export const ignoredDirectories = Object.freeze([".git", ".hg", ".svn", "Library", "Temp", "build", "dist", "node_modules", "target", "vendor"]);
export const ignoredDirectorySet = new Set(ignoredDirectories);
export const expectedProfileIds = Object.freeze([
  "bun",
  "dotnet",
  "foundry",
  "go",
  "hardhat",
  "javascript-monorepo",
  "npm",
  "pnpm",
  "python",
  "rust",
  "unity",
  "yarn"
]);
export const exactJavaScriptManagers = Object.freeze(["bun", "npm", "pnpm", "yarn"]);
export const exactJavaScriptManagerSet = new Set(exactJavaScriptManagers);
export const allowedManagerDeclarations = new Set([...exactJavaScriptManagers, "any-js"]);
export const allowedCheckConditions = new Set(["always", "manager-resolved", "yarn-classic", "yarn-modern"]);
export const allowedPlaceholders = new Set(["<package-manager>", "<pinned-unity-editor>", "<python-environment>"]);
export const maximumEntries = 4096;
export const maximumDepth = 4;
export const maximumCatalogBytes = 1_000_000;
export const maximumPackageJsonBytes = 1_000_000;
export const maximumUnityVersionBytes = 4096;
export const maximumJsonDepth = 64;
export const maximumJsonNodes = 131072;
export const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const BUILD_PROFILE_LIMITS = Object.freeze({
  maximumCatalogBytes,
  maximumDepth,
  maximumEntries,
  maximumPackageJsonBytes,
  maximumUnityVersionBytes
});

export function loadBuildProfileCatalog(catalogPath = defaultCatalogPath) {
  const resolved = path.resolve(catalogPath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("build profile catalog must be a regular non-symlink file");
  if (stat.size === 0 || stat.size > maximumCatalogBytes) throw new Error("build profile catalog exceeds its byte bounds");
  const raw = fs.readFileSync(resolved);
  let text;
  try {
    text = utf8Decoder.decode(raw);
  } catch {
    throw new Error("build profile catalog must be valid UTF-8");
  }
  if (raw.length === 0 || raw.length > maximumCatalogBytes) throw new Error("build profile catalog exceeds its byte bounds");
  if (text.charCodeAt(0) === 0xfeff) throw new Error("build profile catalog must not contain a byte-order mark");
  const parsed = parseStrictJson(text, "build profile catalog");
  validateCatalog(parsed);

  const catalogSha256 = sha256Hex(raw);
  const catalogDigest = semanticDigest("programmable.build-profile.catalog.v1", parsed);
  const profiles = parsed.profiles.map((profile) => ({
    ...profile,
    profileDigest: semanticDigest("programmable.build-profile.profile.v1", profile)
  }));
  return deepFreeze({ ...parsed, catalogDigest, catalogSha256, profiles });
}

export function listBuildProfiles({ catalog = loadBuildProfileCatalog() } = {}) {
  return {
    schemaVersion: "1.0.0",
    catalogDigest: catalog.catalogDigest,
    catalogSha256: catalog.catalogSha256,
    profiles: catalog.profiles.map(({ id, label, profileDigest }) => ({ id, label, profileDigest })),
    unknownPolicy: "needs-review"
  };
}

export function showBuildProfile(profileId, { catalog = loadBuildProfileCatalog() } = {}) {
  const profile = catalog.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`unknown build profile ${profileId}`);
  return {
    schemaVersion: "1.0.0",
    catalogDigest: catalog.catalogDigest,
    catalogSha256: catalog.catalogSha256,
    profile,
    commandsExecuted: false,
    networkAccessed: false
  };
}

function validateCatalog(catalog) {
  assertPlainObject(catalog, "catalog");
  assertExactKeys(catalog, ["kind", "policy", "profiles", "schemaVersion"], "catalog");
  if (catalog.schemaVersion !== "1.0.0") throw new Error("build profile catalog schemaVersion must be 1.0.0");
  if (catalog.kind !== "programmable-build-profile-catalog") throw new Error("build profile catalog kind is invalid");
  assertPlainObject(catalog.policy, "catalog policy");
  assertExactKeys(catalog.policy, ["automaticAdverseDecision", "commands", "unknownOutcome"], "catalog policy");
  if (catalog.policy.automaticAdverseDecision !== false
    || catalog.policy.commands !== "inert-only"
    || catalog.policy.unknownOutcome !== "needs-review") {
    throw new Error("build profile catalog policy is invalid");
  }
  if (!Array.isArray(catalog.profiles)) throw new Error("build profile catalog profiles must be an array");
  const ids = catalog.profiles.map((profile) => profile?.id);
  if (!sameStringArray(ids, expectedProfileIds)) throw new Error("build profile catalog must contain the closed, UTF-8 ordered profile set");

  for (const profile of catalog.profiles) {
    assertPlainObject(profile, `profile ${String(profile?.id)}`);
    assertExactKeys(profile, ["detection", "id", "label", "suggestedChecks"], `profile ${profile.id}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(profile.id)) throw new Error(`profile ${profile.id} has an invalid id`);
    assertSafeVisibleText(profile.label, `profile ${profile.id} label`, 128);
    assertPlainObject(profile.detection, `profile ${profile.id} detection`);
    assertExactKeys(profile.detection, [
      "lockFilesAny",
      "packageManager",
      "requiredFilesAll",
      "rootMarkersAny",
      "unityEditorVersionRequired"
    ], `profile ${profile.id} detection`);
    if (profile.detection.packageManager !== null && !allowedManagerDeclarations.has(profile.detection.packageManager)) {
      throw new Error(`profile ${profile.id} has an invalid packageManager semantic`);
    }
    if (profile.detection.unityEditorVersionRequired !== (profile.id === "unity")) {
      throw new Error(`profile ${profile.id} has an invalid Unity pin semantic`);
    }
    validatePatternArray(profile.detection.lockFilesAny, `profile ${profile.id} lockFilesAny`, true);
    validatePatternArray(profile.detection.requiredFilesAll, `profile ${profile.id} requiredFilesAll`, true);
    validatePatternArray(profile.detection.rootMarkersAny, `profile ${profile.id} rootMarkersAny`, false);
    if (exactJavaScriptManagerSet.has(profile.id) && profile.detection.packageManager !== profile.id) {
      throw new Error(`profile ${profile.id} must bind its exact package manager`);
    }
    if (["hardhat", "javascript-monorepo"].includes(profile.id) && profile.detection.packageManager !== "any-js") {
      throw new Error(`profile ${profile.id} must use the any-js package manager semantic`);
    }
    if (profile.id === "unity") {
      if (!sameStringArray(profile.detection.requiredFilesAll, ["Packages/manifest.json", "ProjectSettings/ProjectVersion.txt"])
        || !sameStringArray(profile.detection.lockFilesAny, ["Packages/packages-lock.json"])) {
        throw new Error("Unity profile must require its manifest, dependency lock, and editor version file");
      }
    }
    validateChecks(profile);
  }
}

function validateChecks(profile) {
  if (!Array.isArray(profile.suggestedChecks) || profile.suggestedChecks.length === 0 || profile.suggestedChecks.length > 16) {
    throw new Error(`profile ${profile.id} must declare between one and sixteen checks`);
  }
  const checkIds = [];
  for (const check of profile.suggestedChecks) {
    assertPlainObject(check, `profile ${profile.id} check`);
    assertExactKeys(check, ["argv", "id", "when"], `profile ${profile.id} check`);
    if (!/^[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(check.id)) throw new Error(`profile ${profile.id} has an invalid check id`);
    checkIds.push(check.id);
    if (!allowedCheckConditions.has(check.when)) throw new Error(`profile ${profile.id} has an invalid check condition`);
    if (!Array.isArray(check.argv) || check.argv.length === 0 || check.argv.length > 32) {
      throw new Error(`profile ${profile.id} has an invalid inert argv array`);
    }
    for (const argument of check.argv) {
      assertSafeVisibleText(argument, `profile ${profile.id} command argument`, 256);
      for (const placeholder of argument.match(/<[^>]+>/gu) ?? []) {
        if (!allowedPlaceholders.has(placeholder) || argument !== placeholder) {
          throw new Error(`profile ${profile.id} uses an unsupported command placeholder`);
        }
      }
    }
  }
  assertSortedUnique(checkIds, `profile ${profile.id} checks`);
  const conditions = new Set(profile.suggestedChecks.map((check) => check.when));
  if (profile.id === "yarn" && (!conditions.has("yarn-classic") || !conditions.has("yarn-modern"))) {
    throw new Error("Yarn profile must keep generation-specific install checks separate");
  }
  if (profile.id !== "yarn" && [...conditions].some((condition) => condition.startsWith("yarn-"))) {
    throw new Error(`profile ${profile.id} cannot use Yarn generation semantics`);
  }
  if (profile.detection.packageManager === "any-js" && [...conditions].some((condition) => condition !== "manager-resolved")) {
    throw new Error(`profile ${profile.id} checks must require a resolved package manager`);
  }
}

function validatePatternArray(value, label, mayBeEmpty) {
  if (!Array.isArray(value) || (!mayBeEmpty && value.length === 0)) throw new Error(`${label} is invalid`);
  for (const pattern of value) validatePattern(pattern, label);
  assertSortedUnique(value, label);
}

function validatePattern(pattern, label) {
  assertSafeVisibleText(pattern, label, 160);
  if (pattern === "package.json#workspaces") return;
  if (pattern.includes("\\") || path.posix.isAbsolute(pattern) || pattern.includes("//")) throw new Error(`${label} contains an unsafe path`);
  const segments = pattern.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new Error(`${label} contains an unsafe path segment`);
  const wildcardSegments = segments.filter((segment) => segment.includes("*"));
  if (wildcardSegments.length > 0 && (segments.length !== 1 || wildcardSegments.length !== 1 || !/^\*\.[A-Za-z0-9]+$/u.test(pattern))) {
    throw new Error(`${label} contains an unsupported wildcard`);
  }
  if (pattern.includes("?") || pattern.includes("[") || pattern.includes("]")) throw new Error(`${label} contains an unsupported wildcard`);
}

export function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort(compareUtf8);
  const sortedExpected = [...expected].sort(compareUtf8);
  if (!sameStringArray(actual, sortedExpected)) throw new Error(`${label} contains unknown or missing fields`);
}

function assertSortedUnique(values, label) {
  if (!values.every((value) => typeof value === "string")) throw new Error(`${label} must contain strings`);
  for (let index = 1; index < values.length; index += 1) {
    if (compareUtf8(values[index - 1], values[index]) >= 0) throw new Error(`${label} must be unique and UTF-8 byte ordered`);
  }
}

export function assertSafeVisibleText(value, label, maximumLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || value !== value.normalize("NFC")) {
    throw new Error(`${label} must be non-empty, bounded NFC text`);
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      || codePoint === 0x061c
      || (codePoint >= 0x200b && codePoint <= 0x200f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || codePoint === 0x2060
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
      || codePoint === 0xfeff
      || (codePoint >= 0xe000 && codePoint <= 0xf8ff)
      || (codePoint >= 0xf0000 && codePoint <= 0xffffd)
      || (codePoint >= 0x100000 && codePoint <= 0x10fffd)
      || (codePoint >= 0xfdd0 && codePoint <= 0xfdef)
      || (codePoint & 0xffff) === 0xfffe
      || (codePoint & 0xffff) === 0xffff) {
      throw new Error(`${label} contains invisible, control, private-use, or non-canonical Unicode`);
    }
  }
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareFindings(left, right) {
  return compareUtf8(
    `${left.code}\0${left.profileId ?? ""}\0${left.projectRoot ?? ""}\0${left.message}`,
    `${right.code}\0${right.profileId ?? ""}\0${right.projectRoot ?? ""}\0${right.message}`
  );
}

function sameStringArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function semanticDigest(domain, value) {
  return sha256Hex(Buffer.concat([Buffer.from(domain, "utf8"), Buffer.from([0]), Buffer.from(canonicalJson(value), "utf8")]));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("canonical JSON only supports safe integers");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  assertPlainObject(value, "canonical JSON value");
  return `{${Object.keys(value).sort(compareUtf8).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function parseStrictJson(text, label) {
  let index = 0;
  let nodes = 0;

  const fail = (message) => {
    throw new Error(`${label} is invalid JSON: ${message}`);
  };
  const whitespace = () => {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[index])) index += 1;
  };
  const string = () => {
    if (text[index] !== "\"") fail("expected string");
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (!escaped && character === "\"") {
        index += 1;
        try {
          const parsed = JSON.parse(text.slice(start, index));
          if (hasLoneSurrogate(parsed)) fail("lone surrogate in string");
          return parsed;
        } catch (error) {
          if (error instanceof Error && error.message.startsWith(`${label} is invalid JSON:`)) throw error;
          fail("malformed string");
        }
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      index += 1;
    }
    fail("unterminated string");
  };
  const value = (depth) => {
    nodes += 1;
    if (nodes > maximumJsonNodes || depth > maximumJsonDepth) fail("structure exceeds bounds");
    whitespace();
    const character = text[index];
    if (character === "{") {
      index += 1;
      whitespace();
      const object = {};
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return object;
      }
      while (index < text.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) fail(`duplicate object key ${JSON.stringify(key)}`);
        keys.add(key);
        whitespace();
        if (text[index] !== ":") fail("expected colon");
        index += 1;
        object[key] = value(depth + 1);
        whitespace();
        if (text[index] === "}") {
          index += 1;
          return object;
        }
        if (text[index] !== ",") fail("expected comma");
        index += 1;
      }
      fail("unterminated object");
    }
    if (character === "[") {
      index += 1;
      whitespace();
      const array = [];
      if (text[index] === "]") {
        index += 1;
        return array;
      }
      while (index < text.length) {
        array.push(value(depth + 1));
        whitespace();
        if (text[index] === "]") {
          index += 1;
          return array;
        }
        if (text[index] !== ",") fail("expected comma");
        index += 1;
      }
      fail("unterminated array");
    }
    if (character === "\"") return string();
    for (const [token, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(token, index)) {
        index += token.length;
        return parsed;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(text.slice(index));
    if (number) {
      index += number[0].length;
      const parsed = Number(number[0]);
      if (!Number.isFinite(parsed)) fail("number is not finite");
      return parsed;
    }
    fail("unexpected token");
  };

  const parsed = value(0);
  whitespace();
  if (index !== text.length) fail("trailing data");
  return parsed;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
