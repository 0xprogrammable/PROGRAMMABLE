import crypto from "node:crypto";
import path from "node:path";

import {
  isCanonicalReviewTargetPath,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";

export const FOUNDRY_BUILD_INFO_FORMAT = "ethers-rs-sol-build-info-1";

const MAX_FILES = REVIEW_TARGET_CONTRACT_V1.maximumFiles;
const MAX_FILE_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumFileBytes;
const MAX_TOTAL_SOURCE_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes;
const MAX_PATH_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumPathBytes;
const MAX_REPOSITORY_ROOTS = 32;
const MAX_REMAPPINGS = 128;
const MAX_DIAGNOSTICS = 4_096;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 2_000_000;
const MAX_JSON_STRING_BYTES = 100_000_000;
const MAX_COLLECTION_ENTRIES = 1_000_000;
const MAX_SOURCE_ID = 2_147_483_647;

/**
 * Validate a full Foundry build-info object without reading files, invoking a
 * compiler or executing repository code.
 *
 * The caller supplies trusted compiler and repository path metadata. The
 * returned array is deduplicated and sorted so the same input has the same
 * result regardless of object insertion order.
 *
 * This is a self-consistency check for untrusted build-info. It does not prove
 * which compiler executable produced the file and does not attest a compiler
 * binary digest.
 *
 * @param {{
 *   buildInfo: object,
 *   reviewTarget: {files: Array<{path: string, bytes: number, sha256: string}>},
 *   declaredCompiler: {
 *     solidity: string,
 *     sourceRevision: string,
 *     evmVersion: string,
 *     optimizer: boolean,
 *     optimizerRuns: number,
 *     viaIR: boolean,
 *     metadataBytecodeHash: string,
 *     cborMetadata: boolean
 *   },
 *   pathMetadata: {
 *     repositoryRoot: string,
 *     buildInfoPath: string,
 *     firstPartyRoots: string[],
 *     remappings: string[]
 *   }
 * }} input
 * @returns {string[]}
 */
export function validateFoundryBuildInfo(input = {}) {
  const errors = [];
  if (!isPlainObject(input)) return ["build info validation input must be an object"];

  const {
    buildInfo,
    reviewTarget,
    declaredCompiler,
    pathMetadata
  } = input;

  const structuresValid = [
    validateJsonStructure(buildInfo, "build info JSON", errors),
    validateJsonStructure(reviewTarget, "review target JSON", errors),
    validateJsonStructure(declaredCompiler, "declared compiler JSON", errors),
    validateJsonStructure(pathMetadata, "repository path metadata JSON", errors)
  ].every(Boolean);
  if (!structuresValid) return finalize(errors);

  if (!isPlainObject(buildInfo)) errors.push("build info must be an object");
  if (!isPlainObject(reviewTarget)) errors.push("review target must be an object");
  if (!isPlainObject(declaredCompiler)) errors.push("declared compiler must be an object");
  if (!isPlainObject(pathMetadata)) errors.push("repository path metadata must be an object");
  if (errors.length > 0) return finalize(errors);

  const repositoryPaths = validatePathMetadata(pathMetadata, errors);
  const compiler = validateDeclaredCompiler(declaredCompiler, errors);

  validateBuildInfoIdentity(buildInfo, compiler, errors);

  const reviewSources = collectReviewSources(reviewTarget, errors);
  const inputSources = validateCompilerInput(
    buildInfo.input,
    reviewSources,
    compiler,
    repositoryPaths,
    errors
  );
  validateCompilerOutput(
    buildInfo.output,
    buildInfo.source_id_to_path,
    inputSources,
    errors
  );

  return finalize(errors);
}

function validateBuildInfoIdentity(buildInfo, compiler, errors) {
  if (buildInfo._format !== FOUNDRY_BUILD_INFO_FORMAT) {
    errors.push(`build info _format must be ${JSON.stringify(FOUNDRY_BUILD_INFO_FORMAT)}`);
  }
  if (!/^[a-f0-9]{16}$/.test(buildInfo.id ?? "")) {
    errors.push("build info id must be a 16-character lowercase hexadecimal identifier");
  }
  if (buildInfo.language !== "Solidity") {
    errors.push('build info language must be "Solidity"');
  }

  if (compiler.solidity !== null) {
    if (buildInfo.solcVersion !== compiler.solidity) {
      errors.push(
        `build info solcVersion must equal declared compiler solidity ${compiler.solidity}`
      );
    }
    if (!matchesSolidityRelease(buildInfo.solcLongVersion, compiler.solidity)) {
      errors.push(
        `build info solcLongVersion must identify declared compiler solidity ${compiler.solidity}`
      );
    }
    if (compiler.sourceRevision !== null) {
      const canonicalIdentity =
        `${compiler.solidity}+commit.${compiler.sourceRevision.slice(0, 8)}`;
      if (buildInfo.solcLongVersion !== canonicalIdentity) {
        errors.push(
          `build info solcLongVersion must equal canonical compiler identity ${canonicalIdentity}`
        );
      }
    }
  }
}

function validateDeclaredCompiler(declaredCompiler, errors) {
  const compiler = {
    solidity: null,
    sourceRevision: null,
    evmVersion: null,
    optimizer: null,
    optimizerRuns: null,
    viaIR: null,
    metadataBytecodeHash: null,
    cborMetadata: null
  };

  if (
    typeof declaredCompiler.solidity !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(declaredCompiler.solidity)
  ) {
    errors.push("declared compiler solidity must be an exact release version");
  } else {
    compiler.solidity = declaredCompiler.solidity;
  }

  if (
    typeof declaredCompiler.sourceRevision !== "string" ||
    !/^[a-f0-9]{40}$/.test(declaredCompiler.sourceRevision)
  ) {
    errors.push(
      "declared compiler sourceRevision must be an exact lowercase 40-character Git commit"
    );
  } else {
    compiler.sourceRevision = declaredCompiler.sourceRevision;
  }

  if (
    typeof declaredCompiler.evmVersion !== "string" ||
    declaredCompiler.evmVersion.length === 0 ||
    declaredCompiler.evmVersion.length > 64
  ) {
    errors.push("declared compiler evmVersion must be a non-empty bounded string");
  } else {
    compiler.evmVersion = declaredCompiler.evmVersion;
  }

  if (typeof declaredCompiler.optimizer !== "boolean") {
    errors.push("declared compiler optimizer must be a boolean");
  } else {
    compiler.optimizer = declaredCompiler.optimizer;
  }

  if (
    !Number.isInteger(declaredCompiler.optimizerRuns) ||
    declaredCompiler.optimizerRuns < 0 ||
    declaredCompiler.optimizerRuns > 4_294_967_295
  ) {
    errors.push("declared compiler optimizerRuns must be an unsigned 32-bit integer");
  } else {
    compiler.optimizerRuns = declaredCompiler.optimizerRuns;
  }

  if (typeof declaredCompiler.viaIR !== "boolean") {
    errors.push("declared compiler viaIR must be a boolean");
  } else {
    compiler.viaIR = declaredCompiler.viaIR;
  }

  if (!["ipfs", "bzzr1", "none"].includes(declaredCompiler.metadataBytecodeHash)) {
    errors.push('declared compiler metadataBytecodeHash must be "ipfs", "bzzr1" or "none"');
  } else {
    compiler.metadataBytecodeHash = declaredCompiler.metadataBytecodeHash;
  }

  if (typeof declaredCompiler.cborMetadata !== "boolean") {
    errors.push("declared compiler cborMetadata must be a boolean");
  } else {
    compiler.cborMetadata = declaredCompiler.cborMetadata;
  }

  return compiler;
}

function validatePathMetadata(pathMetadata, errors) {
  const metadata = {
    firstPartyRoots: [],
    remappings: null
  };

  if (
    typeof pathMetadata.repositoryRoot !== "string" ||
    !path.isAbsolute(pathMetadata.repositoryRoot) ||
    path.resolve(pathMetadata.repositoryRoot) !== pathMetadata.repositoryRoot ||
    pathMetadata.repositoryRoot === path.parse(pathMetadata.repositoryRoot).root ||
    containsControlCharacter(pathMetadata.repositoryRoot)
  ) {
    errors.push(
      "repository path metadata repositoryRoot must be an absolute normalized path"
    );
  }

  if (
    !safeRelativePath(pathMetadata.buildInfoPath) ||
    !pathMetadata.buildInfoPath.endsWith(".json")
  ) {
    errors.push(
      "repository path metadata buildInfoPath must be a safe relative JSON path"
    );
  }

  if (
    !Array.isArray(pathMetadata.firstPartyRoots) ||
    pathMetadata.firstPartyRoots.length === 0 ||
    pathMetadata.firstPartyRoots.length > MAX_REPOSITORY_ROOTS
  ) {
    errors.push(
      `repository path metadata firstPartyRoots must contain 1 to ${MAX_REPOSITORY_ROOTS} safe relative roots`
    );
  } else {
    const seen = new Set();
    for (const root of pathMetadata.firstPartyRoots) {
      if (!safeRelativePath(root) || root.endsWith(".sol")) {
        errors.push(`repository path metadata contains unsafe first-party root: ${String(root)}`);
      } else if (seen.has(root)) {
        errors.push(`repository path metadata contains duplicate first-party root: ${root}`);
      } else {
        seen.add(root);
        metadata.firstPartyRoots.push(root);
      }
    }
  }

  if (
    !Array.isArray(pathMetadata.remappings) ||
    pathMetadata.remappings.length > MAX_REMAPPINGS
  ) {
    errors.push(
      `repository path metadata remappings must be an array with at most ${MAX_REMAPPINGS} entries`
    );
  } else {
    metadata.remappings = [];
    const seen = new Set();
    for (const remapping of pathMetadata.remappings) {
      if (!validRelativeRemapping(remapping)) {
        errors.push(`repository path metadata contains unsafe remapping: ${String(remapping)}`);
      } else if (seen.has(remapping)) {
        errors.push(`repository path metadata contains duplicate remapping: ${remapping}`);
      } else {
        seen.add(remapping);
        metadata.remappings.push(remapping);
      }
    }
  }

  return metadata;
}

function collectReviewSources(reviewTarget, errors) {
  const sources = new Map();
  if (!Array.isArray(reviewTarget.files)) {
    errors.push("review target files must be an array");
    return sources;
  }
  if (reviewTarget.files.length > MAX_FILES) {
    errors.push(`review target exceeds ${MAX_FILES} files`);
    return sources;
  }

  const seen = new Set();
  let totalBytes = 0;
  for (const [index, record] of reviewTarget.files.entries()) {
    if (!isPlainObject(record)) {
      errors.push(`review target files[${index}] must be an object`);
      continue;
    }
    if (!safeRelativePath(record.path)) {
      errors.push(`review target contains unsafe path: ${String(record.path)}`);
      continue;
    }
    if (seen.has(record.path)) {
      errors.push(`review target contains duplicate path: ${record.path}`);
      continue;
    }
    seen.add(record.path);
    if (!record.path.endsWith(".sol")) continue;

    if (!Number.isInteger(record.bytes) || record.bytes < 0) {
      errors.push(`review target source has invalid byte count: ${record.path}`);
    } else {
      if (record.bytes > MAX_FILE_BYTES) {
        errors.push(`review target source exceeds ${MAX_FILE_BYTES} bytes: ${record.path}`);
      }
      totalBytes += record.bytes;
    }
    if (!/^[a-f0-9]{64}$/.test(record.sha256 ?? "")) {
      errors.push(`review target source has invalid SHA-256 digest: ${record.path}`);
    }
    sources.set(record.path, record);
  }

  if (sources.size === 0) {
    errors.push("review target must contain at least one Solidity source");
  }
  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
    errors.push(`review target Solidity sources exceed ${MAX_TOTAL_SOURCE_BYTES} total bytes`);
  }
  return sources;
}

function validateCompilerInput(
  compilerInput,
  reviewSources,
  compiler,
  repositoryPaths,
  errors
) {
  const sources = new Map();
  if (!isPlainObject(compilerInput)) {
    errors.push("build info input must be an object");
    return sources;
  }
  if (compilerInput.language !== "Solidity") {
    errors.push('build info input.language must be "Solidity"');
  }

  const settings = compilerInput.settings;
  if (!isPlainObject(settings)) {
    errors.push("build info input.settings must be an object");
  } else {
    validateCompilerSettings(settings, compiler, repositoryPaths, errors);
  }

  if (!isPlainObject(compilerInput.sources)) {
    errors.push("build info input.sources must be an object");
    return sources;
  }

  const sourcePaths = Object.keys(compilerInput.sources).sort();
  if (sourcePaths.length === 0) {
    errors.push("build info input.sources must contain at least one Solidity source");
  }
  if (sourcePaths.length > MAX_FILES) {
    errors.push(`build info input.sources exceeds ${MAX_FILES} files`);
    return sources;
  }

  let totalBytes = 0;
  for (const sourcePath of sourcePaths) {
    if (!safeRelativePath(sourcePath) || !sourcePath.endsWith(".sol")) {
      errors.push(`build info input contains unsafe source path: ${sourcePath}`);
      continue;
    }

    const source = compilerInput.sources[sourcePath];
    if (!isPlainObject(source) || typeof source.content !== "string") {
      errors.push(`build info input source must contain literal content: ${sourcePath}`);
      continue;
    }

    const bytes = Buffer.byteLength(source.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      errors.push(`build info input source exceeds ${MAX_FILE_BYTES} bytes: ${sourcePath}`);
    }
    totalBytes += bytes;
    sources.set(sourcePath, {
      bytes,
      sha256: crypto.createHash("sha256").update(source.content, "utf8").digest("hex")
    });
  }

  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
    errors.push(`build info input sources exceed ${MAX_TOTAL_SOURCE_BYTES} total bytes`);
  }

  for (const [sourcePath, record] of [...reviewSources.entries()].sort(byMapKey)) {
    const actual = sources.get(sourcePath);
    if (!actual) {
      const qualifier = isFirstParty(sourcePath, repositoryPaths.firstPartyRoots)
        ? "first-party "
        : "";
      errors.push(`build info input is missing ${qualifier}source: ${sourcePath}`);
      continue;
    }
    if (Number.isInteger(record.bytes) && actual.bytes !== record.bytes) {
      errors.push(`build info source byte count differs from review target: ${sourcePath}`);
    }
    if (/^[a-f0-9]{64}$/.test(record.sha256 ?? "") && actual.sha256 !== record.sha256) {
      errors.push(`build info source hash differs from review target: ${sourcePath}`);
    }
  }

  for (const sourcePath of [...sources.keys()].sort()) {
    if (reviewSources.has(sourcePath)) continue;
    const qualifier = isFirstParty(sourcePath, repositoryPaths.firstPartyRoots)
      ? "first-party "
      : "";
    errors.push(`build info input contains undeclared ${qualifier}source: ${sourcePath}`);
  }

  return sources;
}

function validateCompilerSettings(settings, compiler, repositoryPaths, errors) {
  const remappings = settings.remappings;
  if (!Array.isArray(remappings) || remappings.length > MAX_REMAPPINGS) {
    errors.push(`build info remappings must be an array with at most ${MAX_REMAPPINGS} entries`);
  } else {
    const seen = new Set();
    for (const remapping of remappings) {
      if (!validRelativeRemapping(remapping)) {
        errors.push(`build info contains unsafe remapping: ${String(remapping)}`);
      } else if (seen.has(remapping)) {
        errors.push(`build info contains duplicate remapping: ${remapping}`);
      } else {
        seen.add(remapping);
      }
    }
    if (
      repositoryPaths.remappings !== null &&
      !sameStringArray(remappings, repositoryPaths.remappings)
    ) {
      errors.push("build info remappings differ from repository path metadata");
    }
  }

  if (!isPlainObject(settings.optimizer)) {
    errors.push("build info optimizer settings must be an object");
  } else {
    if (
      compiler.optimizer !== null &&
      settings.optimizer.enabled !== compiler.optimizer
    ) {
      errors.push(
        `build info optimizer.enabled must equal declared compiler optimizer ${compiler.optimizer}`
      );
    }
    if (
      compiler.optimizerRuns !== null &&
      settings.optimizer.runs !== compiler.optimizerRuns
    ) {
      errors.push(
        `build info optimizer.runs must equal declared compiler optimizerRuns ${compiler.optimizerRuns}`
      );
    }
  }

  if (compiler.evmVersion !== null && settings.evmVersion !== compiler.evmVersion) {
    errors.push(
      `build info evmVersion must equal declared compiler evmVersion ${JSON.stringify(compiler.evmVersion)}`
    );
  }
  if (compiler.viaIR !== null && settings.viaIR !== compiler.viaIR) {
    errors.push(`build info viaIR must equal declared compiler viaIR ${compiler.viaIR}`);
  }

  if (!isPlainObject(settings.metadata)) {
    errors.push("build info metadata settings must be an object");
  } else {
    if (
      compiler.metadataBytecodeHash !== null &&
      settings.metadata.bytecodeHash !== compiler.metadataBytecodeHash
    ) {
      errors.push(
        `build info metadata.bytecodeHash must equal declared compiler metadataBytecodeHash ${JSON.stringify(compiler.metadataBytecodeHash)}`
      );
    }
    if (
      compiler.cborMetadata !== null &&
      settings.metadata.appendCBOR !== compiler.cborMetadata
    ) {
      errors.push(
        `build info metadata.appendCBOR must equal declared compiler cborMetadata ${compiler.cborMetadata}`
      );
    }
  }

  if (!requestsRequiredCompilerOutputs(settings.outputSelection)) {
    errors.push(
      "build info outputSelection must request AST, ABI and creation bytecode for every Solidity source"
    );
  }
}

function validateCompilerOutput(output, sourceIdToPath, inputSources, errors) {
  if (!isPlainObject(output)) {
    errors.push("build info output must be an object");
    return;
  }
  validateDiagnostics(output.errors, errors);

  if (!isPlainObject(output.sources)) {
    errors.push("build info output.sources must be an object");
    return;
  }

  const outputPaths = Object.keys(output.sources).sort();
  if (outputPaths.length > MAX_FILES) {
    errors.push(`build info output.sources exceeds ${MAX_FILES} files`);
    return;
  }
  for (const sourcePath of [...inputSources.keys()].sort()) {
    if (!Object.hasOwn(output.sources, sourcePath)) {
      errors.push(`build info output is missing source: ${sourcePath}`);
    }
  }
  for (const sourcePath of outputPaths) {
    if (!inputSources.has(sourcePath)) {
      errors.push(`build info output contains undeclared source: ${sourcePath}`);
    }
    if (!safeRelativePath(sourcePath) || !sourcePath.endsWith(".sol")) {
      errors.push(`build info output contains unsafe source path: ${sourcePath}`);
    }
  }

  const contractDefinitions = new Map();
  let concreteContracts = 0;
  const outputIdToPath = new Map();
  for (const sourcePath of outputPaths) {
    const record = output.sources[sourcePath];
    if (
      !isPlainObject(record) ||
      !Number.isInteger(record.id) ||
      record.id < 0 ||
      record.id > MAX_SOURCE_ID
    ) {
      errors.push(`build info output source has invalid id: ${sourcePath}`);
      continue;
    }
    if (outputIdToPath.has(record.id)) {
      errors.push(`build info output sources contain duplicate id: ${record.id}`);
    } else {
      outputIdToPath.set(record.id, sourcePath);
    }

    const definitions = validateSourceUnitAst(record?.ast, sourcePath, errors);
    contractDefinitions.set(sourcePath, definitions);
    concreteContracts += [...definitions.values()].filter(
      ({ requiresBytecode }) => requiresBytecode
    ).length;
  }
  if (concreteContracts === 0) {
    errors.push(
      "build info output must include at least one concrete deployable contract"
    );
  }

  if (!isPlainObject(sourceIdToPath)) {
    errors.push("build info source_id_to_path must be an object");
    return;
  }

  const mappedPaths = new Set();
  const mappingEntries = Object.entries(sourceIdToPath).sort(
    ([left], [right]) => Number(left) - Number(right) || left.localeCompare(right)
  );
  if (mappingEntries.length > MAX_FILES) {
    errors.push(`build info source_id_to_path exceeds ${MAX_FILES} entries`);
    return;
  }
  for (const [sourceId, sourcePath] of mappingEntries) {
    if (
      !/^(?:0|[1-9]\d*)$/.test(sourceId) ||
      Number(sourceId) > MAX_SOURCE_ID
    ) {
      errors.push(`build info source_id_to_path contains invalid id: ${sourceId}`);
      continue;
    }
    if (!safeRelativePath(sourcePath) || !String(sourcePath).endsWith(".sol")) {
      errors.push(
        `build info source_id_to_path contains unsafe source path: ${String(sourcePath)}`
      );
      continue;
    }
    if (mappedPaths.has(sourcePath)) {
      errors.push(`build info source_id_to_path contains duplicate path: ${sourcePath}`);
    } else {
      mappedPaths.add(sourcePath);
    }
  }

  for (const [sourceId, sourcePath] of [...outputIdToPath.entries()].sort(
    ([left], [right]) => left - right
  )) {
    const mappedPath = sourceIdToPath[String(sourceId)];
    if (mappedPath !== sourcePath) {
      errors.push(
        `build info source_id_to_path[${sourceId}] must equal output source path ${sourcePath}`
      );
    }
  }
  for (const [sourceId, sourcePath] of mappingEntries) {
    if (!/^(?:0|[1-9]\d*)$/.test(sourceId)) continue;
    const outputPath = outputIdToPath.get(Number(sourceId));
    if (outputPath === undefined) {
      errors.push(
        `build info source_id_to_path[${sourceId}] has no output source id`
      );
    } else if (sourcePath !== outputPath) {
      errors.push(
        `build info source_id_to_path[${sourceId}] differs from output source path ${outputPath}`
      );
    }
  }

  validateCompiledContracts(output.contracts, contractDefinitions, inputSources, errors);
}

function validateDiagnostics(diagnostics, errors) {
  if (diagnostics === null || diagnostics === undefined) return;
  if (!Array.isArray(diagnostics)) {
    errors.push("build info output.errors must be null or an array");
    return;
  }
  if (diagnostics.length > MAX_DIAGNOSTICS) {
    errors.push(`build info output.errors exceeds ${MAX_DIAGNOSTICS} diagnostics`);
    return;
  }

  let compileErrors = 0;
  for (const [index, diagnostic] of diagnostics.entries()) {
    if (!isPlainObject(diagnostic) || typeof diagnostic.severity !== "string") {
      errors.push(`build info output.errors[${index}] has no severity`);
      continue;
    }
    if (diagnostic.severity === "error") compileErrors += 1;
  }
  if (compileErrors > 0) {
    errors.push(
      `build info output contains ${compileErrors} Solidity compile ${compileErrors === 1 ? "error" : "errors"}`
    );
  }
}

function validateJsonStructure(value, label, errors) {
  if (value === undefined) {
    errors.push(`${label} is required`);
    return false;
  }

  const stack = [{ value, depth: 0 }];
  const seen = new Set();
  let nodes = 0;
  let stringBytes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      errors.push(`${label} exceeds ${MAX_JSON_NODES} JSON values`);
      return false;
    }
    if (current.depth > MAX_JSON_DEPTH) {
      errors.push(`${label} exceeds maximum depth ${MAX_JSON_DEPTH}`);
      return false;
    }

    const valueType = typeof current.value;
    if (current.value === null || valueType === "boolean") continue;
    if (valueType === "string") {
      stringBytes += Buffer.byteLength(current.value, "utf8");
      if (stringBytes > MAX_JSON_STRING_BYTES) {
        errors.push(`${label} exceeds ${MAX_JSON_STRING_BYTES} string bytes`);
        return false;
      }
      continue;
    }
    if (valueType === "number") {
      if (!Number.isFinite(current.value)) {
        errors.push(`${label} contains a non-finite number`);
        return false;
      }
      continue;
    }
    if (valueType !== "object") {
      errors.push(`${label} contains a non-JSON value`);
      return false;
    }
    if (!Array.isArray(current.value) && !isPlainObject(current.value)) {
      errors.push(`${label} contains a non-JSON object`);
      return false;
    }
    if (seen.has(current.value)) {
      errors.push(`${label} contains a repeated or cyclic object reference`);
      return false;
    }
    seen.add(current.value);

    if (
      Array.isArray(current.value) &&
      current.value.length > MAX_COLLECTION_ENTRIES
    ) {
      errors.push(`${label} contains an oversized array`);
      return false;
    }

    const descriptors = Object.getOwnPropertyDescriptors(current.value);
    const keys = Object.keys(descriptors).filter(
      (key) => descriptors[key].enumerable
    );
    if (keys.length > MAX_COLLECTION_ENTRIES) {
      errors.push(`${label} contains an oversized object`);
      return false;
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, "value")) {
        errors.push(`${label} contains an accessor property`);
        return false;
      }
      stringBytes += Buffer.byteLength(key, "utf8");
      if (stringBytes > MAX_JSON_STRING_BYTES) {
        errors.push(`${label} exceeds ${MAX_JSON_STRING_BYTES} string bytes`);
        return false;
      }
      stack.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  return true;
}

function matchesSolidityRelease(value, expected) {
  if (typeof value !== "string") return false;
  if (value === expected) return true;
  if (!value.startsWith(`${expected}+`)) return false;
  return /^[0-9A-Za-z.+-]+$/.test(value);
}

function requestsRequiredCompilerOutputs(outputSelection) {
  if (!isPlainObject(outputSelection)) return false;
  const allSources = outputSelection["*"];
  if (!isPlainObject(allSources)) return false;
  const sourceOutputs = allSources[""];
  const contractOutputs = allSources["*"];
  return (
    Array.isArray(sourceOutputs) &&
    sourceOutputs.includes("ast") &&
    Array.isArray(contractOutputs) &&
    contractOutputs.includes("abi") &&
    contractOutputs.includes("evm.bytecode.object")
  );
}

function validateSourceUnitAst(ast, sourcePath, errors) {
  const definitions = new Map();
  if (
    !isPlainObject(ast) ||
    ast.nodeType !== "SourceUnit" ||
    ast.absolutePath !== sourcePath ||
    !Array.isArray(ast.nodes)
  ) {
    errors.push(
      `build info output source is missing a Solidity SourceUnit AST: ${sourcePath}`
    );
    return definitions;
  }

  for (const node of ast.nodes) {
    if (!isPlainObject(node) || node.nodeType !== "ContractDefinition") continue;
    if (
      typeof node.name !== "string" ||
      node.name.length === 0 ||
      !["contract", "interface", "library"].includes(node.contractKind) ||
      typeof node.abstract !== "boolean"
    ) {
      errors.push(
        `build info output source contains an invalid contract definition: ${sourcePath}`
      );
      continue;
    }
    if (definitions.has(node.name)) {
      errors.push(
        `build info output source contains duplicate contract definition ${node.name}: ${sourcePath}`
      );
      continue;
    }
    definitions.set(node.name, {
      requiresBytecode:
        node.contractKind === "library" ||
        (node.contractKind === "contract" && node.abstract === false)
    });
  }
  return definitions;
}

function validateCompiledContracts(
  contracts,
  contractDefinitions,
  inputSources,
  errors
) {
  if (!isPlainObject(contracts)) {
    errors.push("build info output.contracts must be an object");
    return;
  }

  const actualSourcePaths = Object.keys(contracts).sort();
  if (actualSourcePaths.length > MAX_FILES) {
    errors.push(`build info output.contracts exceeds ${MAX_FILES} source entries`);
    return;
  }

  for (const sourcePath of actualSourcePaths) {
    if (!inputSources.has(sourcePath)) {
      errors.push(`build info output.contracts contains undeclared source: ${sourcePath}`);
    }
    const sourceContracts = contracts[sourcePath];
    if (!isPlainObject(sourceContracts)) {
      errors.push(`build info output contracts must be an object: ${sourcePath}`);
      continue;
    }
    const expected = contractDefinitions.get(sourcePath) ?? new Map();
    for (const contractName of Object.keys(sourceContracts).sort()) {
      if (!expected.has(contractName)) {
        errors.push(
          `build info output contains contract absent from its source AST: ${sourcePath}:${contractName}`
        );
      }
    }
  }

  for (const [sourcePath, expected] of [...contractDefinitions.entries()].sort(byMapKey)) {
    const sourceContracts = contracts[sourcePath];
    for (const [contractName, definition] of [...expected.entries()].sort(byMapKey)) {
      if (!isPlainObject(sourceContracts) || !Object.hasOwn(sourceContracts, contractName)) {
        errors.push(`build info output is missing contract ${contractName} from ${sourcePath}`);
        continue;
      }
      validateCompiledContract(
        sourceContracts[contractName],
        sourcePath,
        contractName,
        definition,
        errors
      );
    }
  }
}

function validateCompiledContract(
  contract,
  sourcePath,
  contractName,
  definition,
  errors
) {
  const label = `${sourcePath}:${contractName}`;
  if (!isPlainObject(contract)) {
    errors.push(`build info output contract must be an object: ${label}`);
    return;
  }
  if (!Array.isArray(contract.abi)) {
    errors.push(`build info output contract is missing an ABI: ${label}`);
  }

  const bytecode = contract.evm?.bytecode?.object;
  if (typeof bytecode !== "string") {
    errors.push(`build info output contract is missing creation bytecode: ${label}`);
    return;
  }
  if (definition.requiresBytecode && bytecode.length === 0) {
    errors.push(`build info output contract has no creation bytecode: ${label}`);
    return;
  }
  if (bytecode.length > 0 && !validSolidityBytecodeObject(bytecode)) {
    errors.push(`build info output contract has malformed creation bytecode: ${label}`);
  }
}

function validSolidityBytecodeObject(value) {
  return /^(?:[a-fA-F0-9]{2}|__\$[a-fA-F0-9]{34}\$__)+$/.test(value);
}

function safeRelativePath(value) {
  return isCanonicalReviewTargetPath(value);
}

function validRelativeRemapping(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_024 ||
    value.includes("\\") ||
    containsControlCharacter(value)
  ) {
    return false;
  }
  const separator = value.indexOf("=");
  if (separator <= 0 || separator !== value.lastIndexOf("=")) return false;

  const left = value.slice(0, separator);
  const target = stripTrailingSlash(value.slice(separator + 1));
  if (!safeRelativePath(target)) return false;

  const contextSeparator = left.lastIndexOf(":");
  const context =
    contextSeparator === -1 ? null : stripTrailingSlash(left.slice(0, contextSeparator));
  const prefix =
    contextSeparator === -1 ? left : left.slice(contextSeparator + 1);
  if (context !== null && !safeRelativePath(context)) return false;
  if (
    prefix.length === 0 ||
    prefix.length > MAX_PATH_BYTES ||
    prefix.startsWith("/") ||
    prefix.includes("\\") ||
    containsControlCharacter(prefix) ||
    !/^[A-Za-z0-9@_./-]+$/.test(prefix) ||
    prefix.split("/").some((part) => part === "." || part === "..")
  ) {
    return false;
  }
  return true;
}

function stripTrailingSlash(value) {
  return typeof value === "string" && value.endsWith("/")
    ? value.slice(0, -1)
    : value;
}

function containsControlCharacter(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isFirstParty(sourcePath, roots) {
  return roots.some(
    (root) => sourcePath === root || sourcePath.startsWith(`${root}/`)
  );
}

function sameStringArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function byMapKey([left], [right]) {
  return left.localeCompare(right);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finalize(errors) {
  return [...new Set(errors)].sort();
}
