import { readFile } from "node:fs/promises";

import { getAddress, keccak256 } from "viem";

import { canonicalizeJson } from "./canonical-json.mjs";
import {
  MAX_STANDARD_JSON_INPUT_BYTES,
  MAX_STANDARD_JSON_SOURCES,
  MAX_TOTAL_STANDARD_JSON_INPUT_BYTES,
} from "./constants.mjs";
import {
  assertAllowedKeys,
  assertExactKeys,
  assertPlainObject,
  decodeExactUtf8,
  readStrictJsonFile,
  resolveInside,
  sha256Digest,
} from "./io.mjs";
import {
  hasCompilerImmutableReferences,
  normalizeRuntimeMaterialization,
} from "./runtime-immutables.mjs";

const COMPILER_VERSION = /^0\.[0-9]+\.[0-9]+\+commit\.[0-9a-f]{8}$/;
const HEX_BYTES = /^0x(?:[0-9a-f]{2})*$/;

export async function loadCompilationUnits(
  configuredUnits,
  sourceRoot,
  { maximumSources } = {},
) {
  if (!Array.isArray(configuredUnits) || configuredUnits.length === 0 || configuredUnits.length > 16) {
    throw new TypeError("compilationUnits must contain between 1 and 16 units");
  }
  const units = [];
  let totalStandardJsonBytes = 0;
  for (const [index, configured] of configuredUnits.entries()) {
    assertExactKeys(configured, ["compilationUnitId", "standardJson"], `compilationUnits[${index}]`);
    const compilationUnitId = canonicalIdentifier(
      configured.compilationUnitId,
      `compilationUnits[${index}].compilationUnitId`,
    );
    const standardJsonPath = resolveInside(
      sourceRoot,
      configured.standardJson,
      `compilationUnits[${index}].standardJson`,
    );
    const standardJsonBytes = await readFile(standardJsonPath);
    if (standardJsonBytes.byteLength > MAX_STANDARD_JSON_INPUT_BYTES) {
      throw new TypeError(
        `compilationUnits[${index}].standardJson exceeds the ${MAX_STANDARD_JSON_INPUT_BYTES}-byte decoded limit`,
      );
    }
    totalStandardJsonBytes += standardJsonBytes.byteLength;
    if (totalStandardJsonBytes > MAX_TOTAL_STANDARD_JSON_INPUT_BYTES) {
      throw new TypeError(
        `compilationUnits Standard JSON exceeds the ${MAX_TOTAL_STANDARD_JSON_INPUT_BYTES}-byte aggregate decoded limit`,
      );
    }
    const standardJsonSource = decodeExactUtf8(standardJsonBytes, configured.standardJson);
    const standardJsonInput = (
      await readStrictJsonFile(standardJsonPath, MAX_STANDARD_JSON_INPUT_BYTES)
    ).value;
    validateStandardJsonInput(standardJsonInput, compilationUnitId, { maximumSources });
    units.push({
      compilationUnitId,
      standardJsonRelativePath: configured.standardJson,
      standardJsonPath,
      standardJsonBytes,
      standardJsonSource,
      standardJsonInput,
      standardJsonInputBase64: standardJsonBytes.toString("base64"),
      standardJsonInputSha256: sha256Digest(standardJsonBytes),
    });
  }
  units.sort((left, right) => Buffer.compare(
    Buffer.from(left.compilationUnitId, "utf8"),
    Buffer.from(right.compilationUnitId, "utf8"),
  ));
  if (new Set(units.map(({ compilationUnitId }) => compilationUnitId)).size !== units.length) {
    throw new TypeError("compilationUnitId values must be unique");
  }
  return units;
}

export function validateStandardJsonInput(input, label, { maximumSources } = {}) {
  assertExactKeys(input, ["language", "sources", "settings"], `Standard JSON ${label}`);
  if (input.language !== "Solidity") throw new TypeError(`Standard JSON ${label} language must be Solidity`);
  assertPlainObject(input.sources, `Standard JSON ${label}.sources`);
  const sourceEntries = Object.entries(input.sources);
  if (sourceEntries.length === 0) {
    throw new TypeError(`Standard JSON ${label}.sources must not be empty`);
  }
  if (maximumSources !== undefined && maximumSources !== MAX_STANDARD_JSON_SOURCES) {
    throw new TypeError("maximumSources must use the published direct-native limit");
  }
  if (maximumSources !== undefined && sourceEntries.length > maximumSources) {
    throw new TypeError(
      `Standard JSON ${label}.sources exceeds the ${maximumSources}-source limit`,
    );
  }
  for (const [sourcePath, source] of sourceEntries) {
    if (typeof sourcePath !== "string" || sourcePath.length === 0) {
      throw new TypeError(`Standard JSON ${label} contains an invalid source path`);
    }
    assertExactKeys(source, ["content"], `Standard JSON ${label}.sources[${sourcePath}]`);
    if (typeof source.content !== "string") {
      throw new TypeError(`Standard JSON ${label}.sources[${sourcePath}].content must be a string`);
    }
  }
  assertPlainObject(input.settings, `Standard JSON ${label}.settings`);
  if (Object.hasOwn(input.settings, "libraries")) {
    assertPlainObject(input.settings.libraries, `Standard JSON ${label}.settings.libraries`);
    for (const [sourcePath, libraries] of Object.entries(input.settings.libraries)) {
      assertPlainObject(libraries, `libraries for ${sourcePath}`);
      for (const [libraryName, address] of Object.entries(libraries)) {
        if (typeof address !== "string") throw new TypeError(`library ${sourcePath}:${libraryName} is invalid`);
        getAddress(address);
      }
    }
  }
}

export async function loadTargetArtifact(
  configured,
  index,
  sourceRoot,
  unitsById,
  { apiVersion = "v1", requiredCompilerVersion } = {},
) {
  if (apiVersion !== "v1" && apiVersion !== "v2") {
    throw new TypeError("target artifact apiVersion must be v1 or v2");
  }
  const requiredTargetFields = [
    "targetId",
    "compilationUnitId",
    "artifact",
    "applicantSalt",
    "constructorArguments",
    "initializer",
    "deploymentValueWei",
    "initializerValueWei",
    "componentKind",
    "declaredHookPermissions",
  ];
  assertAllowedKeys(
    configured,
    apiVersion === "v2" ? [...requiredTargetFields, "runtimeImmutables"] : requiredTargetFields,
    [],
    `targets[${index}]`,
  );
  const targetId = canonicalIdentifier(configured.targetId, `targets[${index}].targetId`);
  const compilationUnitId = canonicalIdentifier(
    configured.compilationUnitId,
    `targets[${index}].compilationUnitId`,
  );
  const unit = unitsById.get(compilationUnitId);
  if (!unit) throw new TypeError(`target ${targetId} references unknown compilation unit ${compilationUnitId}`);
  const artifactPath = resolveInside(sourceRoot, configured.artifact, `target ${targetId}.artifact`);
  const artifact = (await readStrictJsonFile(artifactPath, 16_777_216)).value;
  assertPlainObject(artifact, `artifact for ${targetId}`);

  const metadata = parseArtifactMetadata(artifact, targetId);
  const compilerVersion = metadata.compiler?.version;
  if (typeof compilerVersion !== "string" || !COMPILER_VERSION.test(compilerVersion)) {
    throw new TypeError(`artifact for ${targetId} does not contain an exact solc compiler version`);
  }
  if (requiredCompilerVersion !== undefined && compilerVersion !== requiredCompilerVersion) {
    throw new TypeError(
      `DIRECT_NATIVE_COMPILER_VERSION_UNSUPPORTED: artifact for ${targetId} uses ${compilerVersion}; the live profile requires ${requiredCompilerVersion}`,
    );
  }
  const compilationTarget = metadata.settings?.compilationTarget;
  assertPlainObject(compilationTarget, `artifact ${targetId} compilationTarget`);
  const targets = Object.entries(compilationTarget);
  if (targets.length !== 1 || typeof targets[0]?.[1] !== "string") {
    throw new TypeError(`artifact for ${targetId} must name exactly one compilation target`);
  }
  const [sourcePath, contractName] = targets[0];
  if (!Object.hasOwn(unit.standardJsonInput.sources, sourcePath)) {
    throw new TypeError(`artifact ${targetId} source ${sourcePath} is absent from its Standard JSON input`);
  }
  assertCriticalSettingsMatch(unit.standardJsonInput.settings, metadata.settings, targetId);

  if (!Array.isArray(artifact.abi)) throw new TypeError(`artifact for ${targetId} has no ABI`);
  const creation = artifact.bytecode;
  const runtime = artifact.deployedBytecode;
  assertCompilerBytecodeObject(creation, `artifact ${targetId} bytecode`, ["linkReferences"]);
  assertCompilerBytecodeObject(
    runtime,
    `artifact ${targetId} deployedBytecode`,
    ["linkReferences", "immutableReferences"],
  );
  const creationBytecode = linkArtifactBytecode(
    bytecodeObject(creation, `artifact ${targetId} bytecode`),
    linkReferences(creation, artifact.linkReferences),
    unit.standardJsonInput.settings.libraries ?? {},
    `artifact ${targetId} bytecode`,
  );
  const immutableReferences = bytecodeReferences(runtime, "immutableReferences");
  if (apiVersion === "v1" && hasCompilerImmutableReferences(immutableReferences)) {
    const error = new TypeError(
      `RUNTIME_MATERIALIZATION_REQUIRED: target ${targetId} has immutable references; this packer does not guess the deployed runtime`,
    );
    error.code = "RUNTIME_MATERIALIZATION_REQUIRED";
    throw error;
  }
  const runtimeCode = linkArtifactBytecode(
    bytecodeObject(runtime, `artifact ${targetId} deployedBytecode`),
    linkReferences(runtime, artifact.deployedLinkReferences),
    unit.standardJsonInput.settings.libraries ?? {},
    `artifact ${targetId} deployedBytecode`,
  );
  if (!HEX_BYTES.test(runtimeCode) || runtimeCode === "0x") {
    throw new TypeError(`target ${targetId} resolved runtime code is invalid`);
  }
  const runtimeMaterialization = apiVersion === "v2"
    ? normalizeRuntimeMaterialization({
      runtimeCode,
      immutableReferences,
      runtimeImmutables: configured.runtimeImmutables,
      label: `target ${targetId}`,
    })
    : null;

  return {
    ...configured,
    targetId,
    compilationUnitId,
    artifactRelativePath: configured.artifact,
    artifactPath,
    abi: artifact.abi,
    compilerVersion,
    sourcePath,
    contractName,
    creationBytecode,
    runtimeCode,
    runtimeMaterialization,
    expectedRuntimeCodeHash: runtimeMaterialization === null ? keccak256(runtimeCode) : null,
  };
}

function parseArtifactMetadata(artifact, targetId) {
  const raw = artifact.metadata;
  if (typeof raw === "string") {
    return JSON.parse(raw);
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) return raw;
  throw new TypeError(`artifact for ${targetId} has no compiler metadata`);
}

function bytecodeObject(value, label) {
  const candidate = typeof value === "string" ? value : value?.object;
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new TypeError(`${label} is missing`);
  }
  return candidate.startsWith("0x") ? candidate : `0x${candidate}`;
}

function assertCompilerBytecodeObject(value, label, requiredFields) {
  assertPlainObject(value, label);
  for (const field of requiredFields) {
    if (!Object.hasOwn(value, field)) {
      throw new TypeError(`${label} must expose compiler ${field} metadata`);
    }
    assertPlainObject(value[field], `${label}.${field}`);
  }
}

function linkReferences(value, fallback) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value.linkReferences ?? fallback ?? {}
    : fallback ?? {};
}

function bytecodeReferences(value, key) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value[key] ?? {};
  return {};
}

function linkArtifactBytecode(bytecode, references, configuredLibraries, label) {
  assertPlainObject(references, `${label} linkReferences`);
  const raw = bytecode.slice(2);
  if (raw.length === 0 || raw.length % 2 !== 0) throw new TypeError(`${label} has invalid byte length`);
  if (Object.keys(references).length === 0) {
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(raw)) throw new TypeError(`${label} contains unresolved placeholders`);
    return `0x${raw.toLowerCase()}`;
  }
  const linkedCharacters = new Uint8Array(raw.length);
  for (const libraries of Object.values(references)) {
    assertPlainObject(libraries, `${label} link reference group`);
    for (const offsets of Object.values(libraries)) {
      if (!Array.isArray(offsets)) throw new TypeError(`${label} has invalid link offsets`);
      for (const offset of offsets) {
        if (!Number.isSafeInteger(offset?.start) || offset.length !== 20 || offset.start < 0
          || offset.start + 20 > raw.length / 2) {
          throw new TypeError(`${label} has an invalid link reference`);
        }
        linkedCharacters.fill(1, offset.start * 2, (offset.start + 20) * 2);
      }
    }
  }
  for (let index = 0; index < raw.length; index += 1) {
    if (!/[0-9a-fA-F]/.test(raw[index]) && linkedCharacters[index] !== 1) {
      throw new TypeError(`${label} contains an unresolved placeholder outside compiler link references`);
    }
  }
  const bytes = Buffer.from(raw.replace(/[^0-9a-fA-F]/g, "0"), "hex");
  for (const [sourcePath, libraries] of Object.entries(references)) {
    assertPlainObject(libraries, `${label} references for ${sourcePath}`);
    for (const [libraryName, offsets] of Object.entries(libraries)) {
      const address = configuredLibraries?.[sourcePath]?.[libraryName];
      if (typeof address !== "string") {
        throw new TypeError(`${label} requires settings.libraries[${sourcePath}][${libraryName}]`);
      }
      const addressBytes = Buffer.from(getAddress(address).slice(2), "hex");
      if (!Array.isArray(offsets) || offsets.length === 0) {
        throw new TypeError(`${label} has invalid link offsets for ${sourcePath}:${libraryName}`);
      }
      for (const offset of offsets) {
        if (!Number.isSafeInteger(offset.start) || offset.length !== 20 || offset.start < 0
          || offset.start + 20 > bytes.length) {
          throw new TypeError(`${label} has an invalid link reference`);
        }
        addressBytes.copy(bytes, offset.start);
      }
    }
  }
  const linked = `0x${bytes.toString("hex")}`;
  if (!HEX_BYTES.test(linked)) throw new TypeError(`${label} could not be linked`);
  return linked;
}

function assertCriticalSettingsMatch(inputSettings, metadataSettings, targetId) {
  assertPlainObject(metadataSettings, `artifact ${targetId} metadata.settings`);
  for (const key of ["optimizer", "evmVersion", "viaIR", "libraries", "remappings"]) {
    if (!Object.hasOwn(inputSettings, key) || !Object.hasOwn(metadataSettings, key)) continue;
    const inputValue = key === "remappings"
      ? normalizeMetadataRemappings(inputSettings[key])
      : inputSettings[key] ?? null;
    const metadataValue = key === "remappings"
      ? normalizeMetadataRemappings(metadataSettings[key])
      : metadataSettings[key] ?? null;
    if (canonicalizeJson(inputValue) !== canonicalizeJson(metadataValue)) {
      throw new TypeError(`artifact ${targetId} ${key} settings differ from the exact Standard JSON input`);
    }
  }
}

function normalizeMetadataRemappings(value) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return value;
  return value.map((entry) => entry.startsWith(":") ? entry.slice(1) : entry).sort();
}

export function canonicalIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/.test(value)) {
    throw new TypeError(`${label} must be a canonical identifier`);
  }
  return value;
}

export function exactCompilerVersion(value, label) {
  if (typeof value !== "string" || !COMPILER_VERSION.test(value)) {
    throw new TypeError(`${label} must be an exact solc build version`);
  }
  return value;
}
