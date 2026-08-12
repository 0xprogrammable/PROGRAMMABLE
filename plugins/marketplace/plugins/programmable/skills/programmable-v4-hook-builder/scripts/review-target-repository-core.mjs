import fs from "node:fs";
import path from "node:path";
import { spawnSafeGitSync } from "./repository-root.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { isExactPackageDependency } from "./package-dependency-contract.mjs";
import {
  isCanonicalReviewTargetPath,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";

export function stripSolidityComments(source) {
  let output = "";
  let mode = "code";
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (current === "\n") {
        output += "\n";
        mode = "code";
      } else output += " ";
      continue;
    }
    if (mode === "block-comment") {
      if (current === "*" && next === "/") {
        output += "  ";
        index += 1;
        mode = "code";
      } else output += current === "\n" ? "\n" : " ";
      continue;
    }
    if (mode === "string") {
      output += current;
      if (current === "\\") {
        if (next !== undefined) {
          output += next;
          index += 1;
        }
      } else if (current === quote) {
        mode = "code";
        quote = null;
      }
      continue;
    }
    if (current === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line-comment";
    } else if (current === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block-comment";
    } else {
      output += current;
      if (current === '"' || current === "'") {
        mode = "string";
        quote = current;
      }
    }
  }
  return output;
}

export function inspectRepositoryEntry(repository, target, { allowMissing = false } = {}) {
  const absolute = path.resolve(target);
  if (!inside(repository, absolute)) throw new Error(`review target resolves outside the repository: ${absolute}`);
  const relativePath = path.relative(repository, absolute).replaceAll(path.sep, "/");
  const segments = relativePath === "" ? [] : relativePath.split("/");
  let current = repository;
  let stat = fs.lstatSync(repository);

  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    stat = lstatOrNull(current);
    if (!stat) {
      if (allowMissing) return null;
      throw new Error(`review target file does not exist: ${relativePath}`);
    }
    const currentRelative = path.relative(repository, current).replaceAll(path.sep, "/");
    if (stat.isSymbolicLink()) throw new Error(`review target contains a symbolic link: ${currentRelative}`);
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`review target path component is not a directory: ${currentRelative}`);
    }
  }

  return { path: absolute, relativePath, stat };
}

export function readValidatedFile(file, expectedStat, repositoryPath) {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === "ELOOP") throw new Error(`review target contains a symbolic link: ${repositoryPath}`);
    throw error;
  }
  try {
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile()) throw new Error(`review target entry is not a file: ${repositoryPath}`);
    if (
      openedStat.dev !== expectedStat.dev
      || openedStat.ino !== expectedStat.ino
      || openedStat.size !== expectedStat.size
    ) {
      throw new Error(`review target file changed while it was being validated: ${repositoryPath}`);
    }
    if (openedStat.size > REVIEW_TARGET_CONTRACT_V1.maximumFileBytes) throw new Error(`review target file exceeds ${REVIEW_TARGET_CONTRACT_V1.maximumFileBytes} bytes: ${repositoryPath}`);
    const contents = fs.readFileSync(descriptor);
    if (contents.byteLength !== openedStat.size) {
      throw new Error(`review target file changed while it was being read: ${repositoryPath}`);
    }
    return contents;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function decodeReviewText(contents, repositoryPath) {
  if (!Buffer.isBuffer(contents)) throw new Error(`review target file was not captured: ${repositoryPath}`);
  const source = contents.toString("utf8");
  if (source.includes("\0")) throw new Error(`review target text file contains a NUL byte: ${repositoryPath}`);
  return source;
}

export function validateDependencyLock(
  lock,
  externalImports,
  { submission, testedBaselineLock, importResolutions = [], repositoryRoot = null } = {}
) {
  const errors = [];
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) return ["dependency lock must be an object"];
  if (lock.schemaVersion !== 1) errors.push("dependency lock schemaVersion must be 1");
  if (!["programmable-tested", "model-specific-pinned", "model-specific-reviewed"].includes(lock.baseline)) errors.push("dependency lock baseline must be programmable-tested, model-specific-pinned or model-specific-reviewed");
  const compiler = lock.compiler ?? {};
  for (const field of ["solidity", "sourceRepository", "sourceRevision", "sourceTree", "evmVersion", "optimizer", "optimizerRuns", "viaIR", "metadataBytecodeHash", "cborMetadata", "ffi"]) {
    if (compiler[field] === null || compiler[field] === undefined) errors.push(`dependency lock compiler.${field} is required`);
  }
  if (typeof compiler.sourceRepository !== "string" || !compiler.sourceRepository.startsWith("https://github.com/")) errors.push("dependency lock compiler.sourceRepository must be an HTTPS GitHub repository");
  if (!/^[a-fA-F0-9]{40}$/.test(compiler.sourceRevision ?? "")) errors.push("dependency lock compiler.sourceRevision must be an exact 40-character commit");
  if (!/^[a-fA-F0-9]{40}$/.test(compiler.sourceTree ?? "")) errors.push("dependency lock compiler.sourceTree must be an exact 40-character tree");
  if (submission) {
    if (compiler.solidity !== submission.target?.solidityVersion) errors.push("dependency lock compiler.solidity differs from submission.target.solidityVersion");
    if (compiler.evmVersion !== submission.target?.evmVersion) errors.push("dependency lock compiler.evmVersion differs from submission.target.evmVersion");
    if (lock.baseline !== submission.target?.dependencyBaseline) errors.push("dependency lock baseline differs from submission.target.dependencyBaseline");
  }
  if (lock.baseline === "programmable-tested") {
    const expected = {
      solidity: "0.8.26",
      sourceRepository: "https://github.com/argotorg/solidity.git",
      sourceRevision: "8a97fa7a1db1ec509221ead6fea6802c684ee887",
      sourceTree: "4ecc702563263869217d8a42262d09bd6015f597",
      evmVersion: "cancun",
      optimizer: true,
      optimizerRuns: 1000,
      viaIR: false,
      metadataBytecodeHash: "none",
      cborMetadata: false,
      ffi: false
    };
    for (const [field, value] of Object.entries(expected)) if (compiler[field] !== value) errors.push(`programmable-tested baseline requires compiler.${field}=${JSON.stringify(value)}`);
    if (!testedBaselineLock || testedBaselineLock.baseline !== "programmable-tested") {
      errors.push("trusted programmable-tested baseline definition is unavailable");
    } else {
      const expectedNames = new Set((testedBaselineLock.dependencies ?? []).map((dependency) => dependency.name));
      for (const dependency of lock.dependencies ?? []) if (!expectedNames.has(dependency?.name)) errors.push(`programmable-tested baseline contains unreviewed extra dependency ${String(dependency?.name)}`);
      if ((lock.dependencies ?? []).length !== expectedNames.size) errors.push("programmable-tested baseline dependency count differs from the trusted definition");
      for (const expectedDependency of testedBaselineLock.dependencies ?? []) {
        const actual = (lock.dependencies ?? []).find((dependency) => dependency.name === expectedDependency.name);
        if (!actual) {
          errors.push(`programmable-tested baseline is missing ${expectedDependency.name}`);
          continue;
        }
        for (const field of ["repository", "revision", "packageVersion", "integrity", "sourceTree", "license", "importPrefixes"]) {
          if (canonicalJson(actual[field]) !== canonicalJson(expectedDependency[field])) errors.push(`programmable-tested baseline ${expectedDependency.name}.${field} differs from the trusted definition`);
        }
      }
    }
  } else if (lock.baseline === "model-specific-reviewed") {
    errors.push("model-specific-reviewed cannot be self-attested by a public prototype; a maintainer must register one coherent dependency baseline before intake can pass");
  }
  const dependencies = Array.isArray(lock.dependencies) ? lock.dependencies : [];
  if (dependencies.length === 0) errors.push("dependency lock requires at least one dependency");
  for (const [index, dependency] of dependencies.entries()) {
    const context = `dependency lock dependencies[${index}]`;
    if (typeof dependency.name !== "string" || dependency.name.length === 0) errors.push(`${context}.name is required`);
    if (typeof dependency.repository !== "string" || !dependency.repository.startsWith("https://")) errors.push(`${context}.repository must be an HTTPS URL`);
    if (dependency.revision !== null && !/^[a-fA-F0-9]{40}$/.test(dependency.revision ?? "")) errors.push(`${context}.revision must be an exact 40-character commit`);
    if (dependency.revision === null && (typeof dependency.packageVersion !== "string" || typeof dependency.integrity !== "string")) {
      errors.push(`${context} needs an exact revision or an exact package version with integrity`);
    }
    if (dependency.revision !== null && !/^[a-fA-F0-9]{40}$/.test(dependency.sourceTree ?? "")) errors.push(`${context}.sourceTree must bind the exact Git tree for a revision dependency`);
    if (dependency.revision === null && !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(dependency.integrity ?? "")) errors.push(`${context}.integrity must be an exact sha512 package integrity`);
    if (dependency.packageVersion && /[~^*xX><=| ]/.test(dependency.packageVersion)) errors.push(`${context}.packageVersion must be exact`);
    if (typeof dependency.license !== "string" || dependency.license.length === 0) errors.push(`${context}.license is required`);
    if (!Array.isArray(dependency.importPrefixes)) errors.push(`${context}.importPrefixes must be an array`);
    for (const prefix of dependency.importPrefixes ?? []) {
      if (typeof prefix !== "string" || prefix.length < 3 || !prefix.endsWith("/") || ["@/", "src/", "test/", "lib/"].includes(prefix)) {
        errors.push(`${context}.importPrefixes contains an unsafe or overly broad prefix: ${String(prefix)}`);
      }
    }
  }
  const prefixes = dependencies.flatMap((dependency) => dependency.importPrefixes ?? []);
  const resolutionsBySpecifier = new Map();
  for (const resolution of importResolutions ?? []) {
    if (!resolutionsBySpecifier.has(resolution.specifier)) resolutionsBySpecifier.set(resolution.specifier, []);
    resolutionsBySpecifier.get(resolution.specifier).push(resolution);
  }
  for (const specifier of externalImports) {
    const matchingDependencies = dependencies.filter((dependency) => (
      (dependency.importPrefixes ?? []).some((prefix) => typeof prefix === "string" && prefix.length > 0 && specifier.startsWith(prefix))
    ));
    const matches = prefixes.filter((prefix) => typeof prefix === "string" && prefix.length > 0 && specifier.startsWith(prefix));
    if (matches.length === 0) {
      errors.push(`external import is not covered by the dependency lock: ${specifier}`);
    } else if (matches.length !== 1) {
      errors.push(`external import is ambiguously covered by ${matches.length} dependency prefixes: ${specifier}`);
    } else {
      const dependency = matchingDependencies[0];
      const resolutions = resolutionsBySpecifier.get(specifier) ?? [];
      if (resolutions.length === 0) {
        errors.push(`external import has no resolved compiler source in the review target: ${specifier}`);
        continue;
      }
      for (const resolution of resolutions) {
        if (!(dependency.importPrefixes ?? []).includes(resolution.remappingPrefix)) {
          errors.push(`external import ${specifier} uses undeclared remapping prefix ${String(resolution.remappingPrefix)}`);
        }
        if (resolution.kind !== "solidity-dependency-import" && resolution.kind !== "solidity-package-dependency-import") {
          errors.push(`external import ${specifier} resolves outside a pinned dependency checkout: ${String(resolution.resolvedPath)}`);
        }
      }
    }
  }
  const verifiedCheckouts = new Set();
  const verifiedSources = new Set();
  for (const resolution of importResolutions ?? []) {
    if (resolution.kind !== "solidity-dependency-import" && resolution.kind !== "solidity-package-dependency-import") continue;
    const matchingDependencies = dependencies.filter((dependency) => (
      (dependency.importPrefixes ?? []).includes(resolution.remappingPrefix)
    ));
    if (matchingDependencies.length === 0) {
      errors.push(`resolved dependency source ${String(resolution.resolvedPath)} has no dependency for remapping prefix ${String(resolution.remappingPrefix)}`);
      continue;
    }
    if (matchingDependencies.length !== 1) {
      errors.push(`resolved dependency source ${String(resolution.resolvedPath)} is ambiguously covered by ${matchingDependencies.length} dependencies`);
      continue;
    }
    if (resolution.kind === "solidity-package-dependency-import") {
      const declaredPackage = (submission?.integration?.sdkDependencies ?? []).find((dependency) => (
        dependency?.packageName === resolution.packageName
      ));
      if (!declaredPackage || !isExactPackageDependency(declaredPackage)) {
        errors.push(`resolved package source ${String(resolution.resolvedPath)} has no exact package declaration`);
        continue;
      }
      const lockedPackage = matchingDependencies[0];
      for (const [field, declaredField] of [
        ["packageVersion", "version"],
        ["integrity", "integrity"],
        ["repository", "repository"],
        ["revision", "revision"]
      ]) {
        if (lockedPackage[field] !== declaredPackage[declaredField]) {
          errors.push(`dependency ${lockedPackage.name} ${field} differs from the exact package declaration`);
        }
      }
      continue;
    }
    if (!repositoryRoot) {
      errors.push(`resolved dependency source ${String(resolution.resolvedPath)} cannot verify its checkout without a repository root`);
      continue;
    }
    verifyDependencyCheckout(
      matchingDependencies[0],
      resolution,
      repositoryRoot,
      errors,
      verifiedCheckouts,
      verifiedSources
    );
  }
  return errors;
}

export function parseRemappings(source) {
  const records = [];
  const prefixes = new Set();
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0 || separator !== line.lastIndexOf("=")) {
      throw new Error(`invalid remappings.txt entry on line ${index + 1}`);
    }
    const prefix = line.slice(0, separator).trim();
    const target = line.slice(separator + 1).trim();
    if (prefix.includes(":")) throw new Error(`context-specific remappings are not supported on line ${index + 1}`);
    if (!prefix.endsWith("/") || prefix.includes("\\") || prefix.startsWith("/") || prefix.split("/").includes("..")) {
      throw new Error(`unsafe Solidity remapping prefix on line ${index + 1}`);
    }
    if (!safeRelativeDirectory(target)) throw new Error(`unsafe Solidity remapping target on line ${index + 1}`);
    if (prefixes.has(prefix)) throw new Error(`duplicate Solidity remapping prefix ${prefix}`);
    prefixes.add(prefix);
    records.push({ prefix, target });
  }
  return records.sort((left, right) => right.prefix.length - left.prefix.length || left.prefix.localeCompare(right.prefix));
}

export function hasFoundryRemappingsSetting(source) {
  return source.split(/\r?\n/).some((line) => /^\s*remappings\s*=/.test(line.replace(/#.*$/, "")));
}

function verifyDependencyCheckout(
  dependency,
  resolution,
  repositoryRoot,
  errors,
  verifiedCheckouts,
  verifiedSources
) {
  const repositoryInput = path.resolve(repositoryRoot);
  const repositoryInputStat = lstatOrNull(repositoryInput);
  if (!repositoryInputStat?.isDirectory() || repositoryInputStat.isSymbolicLink()) {
    errors.push(`dependency ${dependency.name} repository root is not a real directory`);
    return;
  }
  const repository = fs.realpathSync(repositoryInput);
  const resolved = path.resolve(repository, resolution.resolvedPath);
  let resolvedEntry;
  try {
    resolvedEntry = inspectRepositoryEntry(repository, resolved);
  } catch (error) {
    errors.push(`external import ${resolution.specifier} resolves to an invalid dependency source: ${error.message}`);
    return;
  }
  if (!resolvedEntry.stat.isFile()) {
    errors.push(`external import ${resolution.specifier} does not resolve to a dependency file`);
    return;
  }
  let checkout;
  try {
    checkout = findGitCheckout(path.dirname(resolved), repository);
  } catch (error) {
    errors.push(`external import ${resolution.specifier} has an invalid Git checkout: ${error.message}`);
    return;
  }
  if (!checkout) {
    errors.push(`external import ${resolution.specifier} is not inside a Git checkout pinned by the dependency lock`);
    return;
  }
  const cacheKey = `${checkout}\0${dependency.name}`;
  if (!verifiedCheckouts.has(cacheKey)) {
    verifiedCheckouts.add(cacheKey);
    const revision = runGit(checkout, ["rev-parse", "HEAD"]);
    if (revision !== dependency.revision) {
      errors.push(`dependency ${dependency.name} checkout revision differs from the dependency lock`);
    }
    const tree = runGit(checkout, ["rev-parse", "HEAD^{tree}"]);
    if (tree !== dependency.sourceTree) {
      errors.push(`dependency ${dependency.name} checkout tree differs from the dependency lock`);
    }
    const status = runGit(checkout, ["status", "--porcelain", "--untracked-files=all"]);
    if (status !== "") errors.push(`dependency ${dependency.name} checkout contains modified or untracked files`);
    const remote = runGit(checkout, ["remote", "get-url", "origin"]);
    if (!sameRepository(remote, dependency.repository)) {
      errors.push(`dependency ${dependency.name} checkout origin differs from the dependency lock`);
    }
  }

  if (!inside(checkout, resolved)) {
    errors.push(`dependency ${dependency.name} resolved source is outside its Git checkout`);
    return;
  }
  const checkoutPath = path.relative(checkout, resolved).replaceAll(path.sep, "/");
  if (!isCanonicalReviewTargetPath(checkoutPath)) {
    errors.push(`dependency ${dependency.name} resolved source has an unsafe checkout path`);
    return;
  }
  const sourceKey = `${cacheKey}\0${checkoutPath}`;
  if (verifiedSources.has(sourceKey)) return;
  verifiedSources.add(sourceKey);

  const headObject = `HEAD:${checkoutPath}`;
  const headType = runGit(checkout, ["cat-file", "-t", headObject]);
  if (headType !== "blob") {
    errors.push(`dependency ${dependency.name} resolved source ${checkoutPath} is not a blob in HEAD`);
    return;
  }
  const headBlob = runGit(checkout, ["rev-parse", "--verify", headObject]);
  const workingBlob = runGit(checkout, ["hash-object", "--no-filters", "--", checkoutPath]);
  if (!headBlob || !workingBlob) {
    errors.push(`dependency ${dependency.name} could not bind resolved source ${checkoutPath} to its HEAD blob`);
  } else if (workingBlob !== headBlob) {
    errors.push(`dependency ${dependency.name} resolved source ${checkoutPath} differs from its HEAD blob`);
  }
}

function findGitCheckout(start, repository) {
  let current = path.resolve(start);
  while (inside(repository, current) && current !== repository) {
    const markerPath = path.join(current, ".git");
    const marker = lstatOrNull(markerPath);
    if (marker?.isSymbolicLink()) {
      throw new Error(`Git metadata is a symbolic link: ${path.relative(repository, markerPath).replaceAll(path.sep, "/")}`);
    }
    if (marker) return current;
    current = path.dirname(current);
  }
  return null;
}

function runGit(directory, args) {
  const result = spawnSafeGitSync(["-C", directory, ...args], {
    encoding: "utf8",
    timeout: 5000
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function sameRepository(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const normalize = (value) => value.trim().replace(/^git@github\.com:/i, "https://github.com/").replace(/\.git\/?$/i, "").replace(/\/$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function safeRelativeDirectory(value) {
  return typeof value === "string"
    && value.endsWith("/")
    && isCanonicalReviewTargetPath(value.slice(0, -1));
}

export function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

export function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
