import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_JSON_V2_PROFILE,
  canonicalJsonSha256V2
} from "./canonical-json-core.mjs";
import { analyzeJavaScriptModuleDependencies } from "./review-target-javascript-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

export const CONTRACT_REGISTRY_SOURCE_V1_PATH = "references/contract-registry-source-v1.json";
export const CONTRACT_REGISTRY_V1_PATH = "references/contract-registry-v1.json";
export const CONTRACT_REGISTRY_V1_SCHEMA_ID = "urn:programmable:contract-registry:1.0.0";
export const CONTRACT_REGISTRY_V1_VERSION = "1.0.0";
export const CONTRACT_REGISTRY_VALIDATOR_CLOSURE_PROFILE_V1 = "static-local-esm-import-closure-v1";

const defaultSkillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceSchemaId = "urn:programmable:contract-registry-source:1.0.0";
const contractIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const exportNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const lifecycleValues = new Set(["active", "frozen"]);
const digestProfileValues = new Set(["contract-defined", "canonical-json-legacy-v1-lf"]);
const validatorModeValues = new Set(["builder", "direct", "package-semantic", "schema-engine"]);
const maximumSourceBytes = 2 * 1024 * 1024;
const maximumSchemaBytes = 4 * 1024 * 1024;
const maximumValidatorBytes = 16 * 1024 * 1024;
const maximumValidatorClosureBytes = 64 * 1024 * 1024;
const maximumValidatorClosureModules = 512;

export function generateContractRegistryV1({
  skillRoot = defaultSkillRoot,
  sourceRelativePath = CONTRACT_REGISTRY_SOURCE_V1_PATH
} = {}) {
  const normalizedSkillRoot = normalizeSkillRoot(skillRoot);
  const normalizedSourcePath = normalizePortablePath(sourceRelativePath, "sourceRelativePath", "references/", ".json");
  const sourceBytes = readRegularFileWithinRoot(normalizedSkillRoot, normalizedSourcePath, maximumSourceBytes, "registry source");
  const source = parseBoundedStrictJsonBytes(sourceBytes, {
    maxSourceBytes: maximumSourceBytes,
    maxNodes: 50_000,
    maxDepth: 64,
    maxNumberCharacters: 64
  });
  validateSourceDocument(source);

  const discoveredSchemaPaths = discoverSchemaPaths(normalizedSkillRoot);
  const declaredSchemaPaths = source.contracts.map(({ schemaPath }) => schemaPath);
  assertSortedUnique(declaredSchemaPaths, "schemaPath");
  assertExactSchemaCoverage(declaredSchemaPaths, discoveredSchemaPaths);

  const contractIds = source.contracts.map(({ contractId }) => contractId);
  const schemaIds = source.contracts.map(({ schemaId }) => schemaId);
  assertUnique(contractIds, "contractId");
  assertUnique(schemaIds, "schemaId");

  const validatorCache = new Map();
  const contracts = source.contracts.map((binding) => {
    const schemaBytes = readRegularFileWithinRoot(
      normalizedSkillRoot,
      binding.schemaPath,
      maximumSchemaBytes,
      `schema ${binding.schemaPath}`
    );
    const schema = parseBoundedStrictJsonBytes(schemaBytes, {
      maxSourceBytes: maximumSchemaBytes,
      maxNodes: 250_000,
      maxDepth: 256,
      maxNumberCharacters: 1_024
    });
    if (!isPlainObject(schema) || schema.$id !== binding.schemaId) {
      throw new Error(`${binding.schemaPath} must declare the exact registered $id ${binding.schemaId}`);
    }

    let validatorClosure = validatorCache.get(binding.validator.modulePath);
    if (validatorClosure === undefined) {
      validatorClosure = buildValidatorClosure(normalizedSkillRoot, binding.validator.modulePath);
      validatorCache.set(binding.validator.modulePath, validatorClosure);
    }
    const validatorFile = validatorClosure.modules.find(({ path: modulePath }) => (
      modulePath === binding.validator.modulePath
    ));
    if (validatorFile === undefined) throw new Error(`validator closure omitted ${binding.validator.modulePath}`);

    return {
      contractId: binding.contractId,
      lifecycle: binding.lifecycle,
      payloadDigestProfile: binding.payloadDigestProfile,
      schema: {
        id: binding.schemaId,
        path: binding.schemaPath,
        byteLength: schemaBytes.length,
        sha256: sha256Bytes(schemaBytes)
      },
      validator: {
        modulePath: binding.validator.modulePath,
        exportName: binding.validator.exportName,
        mode: binding.validator.mode,
        moduleByteLength: validatorFile.byteLength,
        moduleSha256: validatorFile.sha256,
        closureSha256: validatorClosure.closureSha256
      }
    };
  });
  const validatorClosures = [...validatorCache.values()]
    .sort((left, right) => compareUtf8(left.rootModulePath, right.rootModulePath));
  const distinctClosureModules = new Set(validatorClosures.flatMap(({ modules }) => (
    modules.map(({ path: modulePath }) => modulePath)
  )));

  const registryWithoutDigest = {
    $schema: CONTRACT_REGISTRY_V1_SCHEMA_ID,
    schemaVersion: CONTRACT_REGISTRY_V1_VERSION,
    canonicalJsonProfile: CANONICAL_JSON_V2_PROFILE.id,
    source: {
      path: normalizedSourcePath,
      byteLength: sourceBytes.length,
      sha256: sha256Bytes(sourceBytes)
    },
    contracts,
    validatorClosures,
    inventory: {
      contractCount: contracts.length,
      schemaCount: discoveredSchemaPaths.length,
      activeContractCount: contracts.filter(({ lifecycle }) => lifecycle === "active").length,
      frozenContractCount: contracts.filter(({ lifecycle }) => lifecycle === "frozen").length,
      validatorBindingCount: contracts.length,
      validatorModuleCount: validatorCache.size,
      validatorClosureCount: validatorClosures.length,
      validatorClosureModuleBindingCount: validatorClosures.reduce((sum, closure) => sum + closure.moduleCount, 0),
      validatorClosureDistinctModuleCount: distinctClosureModules.size,
      schemaPathsSha256: canonicalJsonSha256V2(contracts.map(({ schema }) => schema.path)),
      validatorBindingsSha256: canonicalJsonSha256V2(contracts.map(({ contractId, validator }) => ({
        contractId,
        modulePath: validator.modulePath,
        exportName: validator.exportName,
        mode: validator.mode,
        closureSha256: validator.closureSha256
      }))),
      validatorClosuresSha256: canonicalJsonSha256V2(validatorClosures)
    }
  };
  return {
    ...registryWithoutDigest,
    registrySha256: canonicalJsonSha256V2(registryWithoutDigest)
  };
}

function buildValidatorClosure(skillRoot, rootModulePath) {
  const records = new Map();
  const states = new Map();
  const stack = [];
  let totalByteLength = 0;
  visit(rootModulePath);
  const modules = [...records.values()].sort((left, right) => compareUtf8(left.path, right.path));
  const closureWithoutDigest = {
    profile: CONTRACT_REGISTRY_VALIDATOR_CLOSURE_PROFILE_V1,
    rootModulePath,
    moduleCount: modules.length,
    totalByteLength,
    modules
  };
  return Object.freeze({
    ...closureWithoutDigest,
    closureSha256: canonicalJsonSha256V2(closureWithoutDigest)
  });

  function visit(modulePath) {
    if (states.get(modulePath) === "done") return;
    if (states.get(modulePath) === "active") {
      const cycleStart = stack.indexOf(modulePath);
      const cycle = [...stack.slice(cycleStart), modulePath];
      throw new Error(`validator import cycle: ${cycle.join(" -> ")}`);
    }
    if (records.size >= maximumValidatorClosureModules) {
      throw new Error(`validator closure ${rootModulePath} exceeds ${maximumValidatorClosureModules} modules`);
    }
    const bytes = readValidatorModule(skillRoot, modulePath);
    totalByteLength += bytes.length;
    if (totalByteLength > maximumValidatorClosureBytes) {
      throw new Error(`validator closure ${rootModulePath} exceeds ${maximumValidatorClosureBytes} bytes`);
    }
    const source = decodeValidatorSource(bytes, modulePath);
    const localImports = [...new Set(analyzeJavaScriptModuleDependencies(source, modulePath)
      .map(({ specifier }) => specifier)
      .filter((specifier) => specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../"))
      .map((specifier) => resolveValidatorImport(modulePath, specifier)))]
      .sort(compareUtf8);
    records.set(modulePath, Object.freeze({
      path: modulePath,
      byteLength: bytes.length,
      sha256: sha256Bytes(bytes),
      localImports
    }));
    states.set(modulePath, "active");
    stack.push(modulePath);
    for (const dependencyPath of localImports) visit(dependencyPath);
    stack.pop();
    states.set(modulePath, "done");
  }
}

function readValidatorModule(skillRoot, modulePath) {
  const absolutePath = resolveWithinRoot(skillRoot, modulePath, `validator closure module ${modulePath}`);
  if (!fs.existsSync(absolutePath)) throw new Error(`validator import unresolved: ${modulePath}`);
  return readRegularFileWithinRoot(
    skillRoot,
    modulePath,
    maximumValidatorBytes,
    `validator closure module ${modulePath}`
  );
}

function decodeValidatorSource(bytes, modulePath) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`validator closure module ${modulePath} must be valid UTF-8`);
  }
}

function resolveValidatorImport(importer, specifier) {
  if (specifier.includes("\\") || specifier.includes("?") || specifier.includes("#")) {
    throw new Error(`validator import from ${importer} is not a portable local module: ${specifier}`);
  }
  let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  if (path.posix.extname(resolved) === "") resolved = `${resolved}.mjs`;
  return normalizePortablePath(resolved, `validator import from ${importer}`, "scripts/", ".mjs");
}

export function contractRegistryBytesV1(registry) {
  if (!isPlainObject(registry)) throw new TypeError("registry must be a plain object");
  return Buffer.from(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export function verifyContractRegistryDigestV1(registry) {
  if (!isPlainObject(registry)) return false;
  const { registrySha256, ...preimage } = registry;
  return typeof registrySha256 === "string"
    && registrySha256 === canonicalJsonSha256V2(preimage);
}

function validateSourceDocument(source) {
  if (!isPlainObject(source)) throw new Error("contract registry source must be an object");
  assertExactKeys(source, ["$schema", "schemaVersion", "contracts"], "registry source");
  if (source.$schema !== sourceSchemaId) throw new Error(`registry source $schema must equal ${sourceSchemaId}`);
  if (source.schemaVersion !== CONTRACT_REGISTRY_V1_VERSION) {
    throw new Error(`registry source schemaVersion must equal ${CONTRACT_REGISTRY_V1_VERSION}`);
  }
  if (!Array.isArray(source.contracts) || source.contracts.length === 0 || source.contracts.length > 512) {
    throw new Error("registry source contracts must contain between 1 and 512 bindings");
  }
  for (const [index, binding] of source.contracts.entries()) validateSourceBinding(binding, index);
}

function validateSourceBinding(binding, index) {
  const label = `registry source contracts[${index}]`;
  if (!isPlainObject(binding)) throw new Error(`${label} must be an object`);
  assertExactKeys(
    binding,
    ["contractId", "schemaPath", "schemaId", "lifecycle", "payloadDigestProfile", "validator"],
    label
  );
  if (typeof binding.contractId !== "string" || !contractIdPattern.test(binding.contractId)) {
    throw new Error(`${label}.contractId must be a lowercase slug`);
  }
  binding.schemaPath = normalizePortablePath(binding.schemaPath, `${label}.schemaPath`, "references/", ".schema.json");
  if (typeof binding.schemaId !== "string" || binding.schemaId.length === 0 || binding.schemaId.length > 512) {
    throw new Error(`${label}.schemaId must be a bounded non-empty string`);
  }
  if (!lifecycleValues.has(binding.lifecycle)) throw new Error(`${label}.lifecycle is unsupported`);
  if (!digestProfileValues.has(binding.payloadDigestProfile)) {
    throw new Error(`${label}.payloadDigestProfile is unsupported`);
  }
  if (!isPlainObject(binding.validator)) throw new Error(`${label}.validator must be an object`);
  assertExactKeys(binding.validator, ["modulePath", "exportName", "mode"], `${label}.validator`);
  binding.validator.modulePath = normalizePortablePath(
    binding.validator.modulePath,
    `${label}.validator.modulePath`,
    "scripts/",
    ".mjs"
  );
  if (typeof binding.validator.exportName !== "string" || !exportNamePattern.test(binding.validator.exportName)) {
    throw new Error(`${label}.validator.exportName is invalid`);
  }
  if (!validatorModeValues.has(binding.validator.mode)) throw new Error(`${label}.validator.mode is unsupported`);
}

function discoverSchemaPaths(skillRoot) {
  const referenceDirectory = resolveWithinRoot(skillRoot, "references", "references directory");
  const stat = fs.lstatSync(referenceDirectory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("references must be a real directory");
  return fs.readdirSync(referenceDirectory, { withFileTypes: true })
    .filter(({ name }) => name.endsWith(".schema.json"))
    .map(({ name }) => normalizePortablePath(`references/${name}`, "discovered schema path", "references/", ".schema.json"))
    .sort(compareUtf8);
}

function assertExactSchemaCoverage(declared, discovered) {
  const declaredSet = new Set(declared);
  const discoveredSet = new Set(discovered);
  const missing = discovered.filter((schemaPath) => !declaredSet.has(schemaPath));
  const stale = declared.filter((schemaPath) => !discoveredSet.has(schemaPath));
  if (missing.length > 0 || stale.length > 0) {
    throw new Error([
      missing.length > 0 ? `unregistered schemas: ${missing.join(", ")}` : null,
      stale.length > 0 ? `registry entries without schemas: ${stale.join(", ")}` : null
    ].filter(Boolean).join("; "));
  }
}

function assertSortedUnique(values, label) {
  assertUnique(values, label);
  const sorted = [...values].sort(compareUtf8);
  if (values.some((value, index) => value !== sorted[index])) {
    throw new Error(`${label} entries must be sorted by UTF-8 bytes`);
  }
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} entries must be unique`);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unexpected keys`);
  }
}

function readRegularFileWithinRoot(root, relativePath, maximumBytes, label) {
  const absolutePath = resolveWithinRoot(root, relativePath, label);
  assertNoSymlinkComponents(root, absolutePath, label);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if (stat.size > maximumBytes) throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`);
  return fs.readFileSync(absolutePath);
}

function assertNoSymlinkComponents(root, target, label) {
  const relative = path.relative(root, target);
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} cannot traverse symlinks`);
  }
}

function normalizeSkillRoot(value) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("skillRoot must be a path string");
  const root = fs.realpathSync(value);
  if (!fs.lstatSync(root).isDirectory()) throw new Error("skillRoot must be a directory");
  return root;
}

function normalizePortablePath(value, label, requiredPrefix, requiredSuffix) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 512
    || value.includes("\\")
    || value.startsWith("/")
    || path.posix.normalize(value) !== value
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || !value.startsWith(requiredPrefix)
    || !value.endsWith(requiredSuffix)
    || !/^[A-Za-z0-9._/-]+$/u.test(value)
  ) {
    throw new Error(`${label} must be a safe portable ${requiredPrefix}*${requiredSuffix} path`);
  }
  return value;
}

function resolveWithinRoot(root, relativePath, label) {
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the skill root`);
  }
  return absolutePath;
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
