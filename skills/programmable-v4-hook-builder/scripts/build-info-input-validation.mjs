import crypto from "node:crypto";
import path from "node:path";
import {
  containsControlCharacter,
  FOUNDRY_BUILD_INFO_FORMAT,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_PATH_BYTES,
  MAX_REMAPPINGS,
  MAX_REPOSITORY_ROOTS,
  MAX_TOTAL_SOURCE_BYTES,
  byMapKey,
  isFirstParty,
  isPlainObject,
  safeRelativePath,
  sameStringArray,
  validRelativeRemapping
} from "./build-info-shared.mjs";

export function validateBuildInfoIdentity(buildInfo, compiler, errors) {
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

export function validateDeclaredCompiler(declaredCompiler, errors) {
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

export function validatePathMetadata(pathMetadata, errors) {
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

export function collectReviewSources(reviewTarget, errors) {
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

export function validateCompilerInput(
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
      (settings.metadata.appendCBOR ?? true) !== compiler.cborMetadata
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
