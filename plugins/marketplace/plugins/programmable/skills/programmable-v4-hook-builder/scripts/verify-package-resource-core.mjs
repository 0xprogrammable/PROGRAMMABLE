import fs from "node:fs";
import path from "node:path";
import { parseRemappings } from "./review-target-core.mjs";
import {
  declaredSoliditySourceAndTestPaths,
  isCanonicalReviewTargetPath
} from "./review-target-contract.mjs";
import { assertInsideRepository } from "./repository-root.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import {
  MAX_ENTRIES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_PATH_DEPTH,
  MAX_TOTAL_BYTES,
  MAX_TOTAL_INTAKE_BYTES,
  TRUSTED_FIRST_PARTY_ROOTS
} from "./verify-package-contracts.mjs";

export function readJson(target, maxFileBytes = MAX_FILE_BYTES) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error("symbolic links are not allowed");
  if (!stat.isFile()) throw new Error("not a regular file");
  if (stat.size > maxFileBytes) throw new Error(`file exceeds ${maxFileBytes} bytes`);
  return parseBoundedStrictJsonBytes(fs.readFileSync(target), {
    maxSourceBytes: maxFileBytes,
    maxNodes: Math.max(250_000, Math.min(8_000_000, maxFileBytes))
  });
}

export function createVerifyPackageResourceRuntime({
  repositoryRoot,
  packageRoot,
  errors,
  toolingBlockers
}) {
  const repositoryResources = new Map();
  let repositoryResourceBytes = 0;
  let repositoryNormalResourceBytes = 0;
  let repositoryResourceBlocked = false;

  function resolveRepositoryFile(
    relativePath,
    resolutionErrors,
    {
      errorPrefix = null,
      maxFileBytes = MAX_FILE_BYTES,
      resourceClass = "normal"
    } = {}
  ) {
    const addError = (message) => {
      resolutionErrors.push(errorPrefix ? `${errorPrefix}: ${message}` : message);
    };
    if (!safeRepositoryRelativePath(relativePath)) {
      addError(`invalid repository-relative path: ${String(relativePath)}`);
      return null;
    }

    const lexicalTarget = path.resolve(repositoryRoot, relativePath);
    try {
      if (fs.lstatSync(lexicalTarget).isSymbolicLink()) {
        addError(`implementation path contains a symbolic link: ${relativePath}`);
        return null;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        addError(repositoryPathResolutionError(error, relativePath));
        return null;
      }
    }

    let target;
    try {
      target = assertInsideRepository(repositoryRoot, lexicalTarget);
    } catch (error) {
      addError(repositoryPathResolutionError(error, relativePath));
      return null;
    }

    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      addError(repositoryPathResolutionError(error, relativePath));
      return null;
    }
    if (stat.isSymbolicLink()) {
      addError(`implementation path contains a symbolic link: ${relativePath}`);
      return null;
    }
    if (!stat.isFile()) {
      addError(`implementation path is not a file: ${relativePath}`);
      return null;
    }
    if (stat.size > maxFileBytes) {
      addError(`implementation file exceeds the ${maxFileBytes} byte review limit: ${relativePath}`);
      repositoryResourceBlocked = true;
      return null;
    }

    const repositoryPath = path.relative(repositoryRoot, target).replaceAll(path.sep, "/");
    if (repositoryPath.split("/").length > MAX_PATH_DEPTH) {
      addError(`implementation path exceeds the ${MAX_PATH_DEPTH} segment review limit: ${relativePath}`);
      repositoryResourceBlocked = true;
      return null;
    }
    if (!repositoryResources.has(target)) {
      if (repositoryResources.size >= MAX_FILES) {
        addError(`declared repository resources exceed the ${MAX_FILES} file review limit`);
        repositoryResourceBlocked = true;
        return null;
      }
      if (
        resourceClass === "normal" &&
        repositoryNormalResourceBytes + stat.size > MAX_TOTAL_BYTES
      ) {
        addError(`declared normal repository resources exceed the ${MAX_TOTAL_BYTES} byte review limit`);
        repositoryResourceBlocked = true;
        return null;
      }
      if (repositoryResourceBytes + stat.size > MAX_TOTAL_INTAKE_BYTES) {
        addError(`declared repository resources exceed the ${MAX_TOTAL_INTAKE_BYTES} byte review limit`);
        repositoryResourceBlocked = true;
        return null;
      }
      repositoryResources.set(target, { size: stat.size, resourceClass });
      repositoryResourceBytes += stat.size;
      if (resourceClass === "normal") repositoryNormalResourceBytes += stat.size;
    }
    return target;
  }


  function walkPackage(directory, depth = 0, state = { entries: 0, files: 0, bytes: 0 }) {
    if (depth > MAX_PATH_DEPTH) throw new Error(`package contains a directory deeper than ${MAX_PATH_DEPTH} segments`);
    const entries = [];
    const directoryHandle = fs.opendirSync(directory);
    try {
      let directoryEntry;
      while ((directoryEntry = directoryHandle.readSync()) !== null) {
        const target = path.join(directory, directoryEntry.name);
        const stat = fs.lstatSync(target);
        state.entries += 1;
        if (state.entries > MAX_ENTRIES) throw new Error(`package exceeds the ${MAX_ENTRIES} filesystem entry review limit`);
        if (stat.isSymbolicLink()) throw new Error(`symbolic links are not allowed: ${path.relative(packageRoot, target).replaceAll(path.sep, "/")}`);
        entries.push({ path: target, stat });
        if (stat.isFile()) {
          state.files += 1;
          state.bytes += stat.size;
          const relativePath = path.relative(packageRoot, target).replaceAll(path.sep, "/");
          if (state.files > MAX_FILES) throw new Error(`package exceeds the ${MAX_FILES} file review limit`);
          if (relativePath === "submission.json" && stat.size > MAX_FILE_BYTES) {
            throw new Error(`file exceeds the ${MAX_FILE_BYTES} byte review limit: ${relativePath}`);
          }
          if (state.bytes > MAX_TOTAL_INTAKE_BYTES) {
            throw new Error(`package exceeds the ${MAX_TOTAL_INTAKE_BYTES} byte review limit`);
          }
          if (relativePath.split("/").length > MAX_PATH_DEPTH) throw new Error(`path exceeds the ${MAX_PATH_DEPTH} segment review limit: ${relativePath}`);
        } else if (stat.isDirectory()) {
          entries.push(...walkPackage(target, depth + 1, state));
        } else {
          throw new Error(`unsupported filesystem entry: ${path.relative(packageRoot, target).replaceAll(path.sep, "/")}`);
        }
      }
    } finally {
      directoryHandle.closeSync();
    }
    return entries;
  }

  function validatePackageBudgets(entries, buildInfoTarget, budgetErrors) {
    let normalBytes = 0;
    let blocked = false;
    for (const entry of entries) {
      if (!entry.stat.isFile()) continue;
      const relativePath = path.relative(packageRoot, entry.path).replaceAll(path.sep, "/");
      const exactBuildInfo =
        buildInfoTarget !== null && path.resolve(entry.path) === buildInfoTarget;
      if (exactBuildInfo) continue;
      normalBytes += entry.stat.size;
      if (entry.stat.size > MAX_FILE_BYTES) {
        budgetErrors.push(
          `package resource preflight: file exceeds the ${MAX_FILE_BYTES} byte review limit: ${relativePath}`
        );
        blocked = true;
      }
    }
    if (normalBytes > MAX_TOTAL_BYTES) {
      budgetErrors.push(
        `package resource preflight: normal files exceed the ${MAX_TOTAL_BYTES} byte review limit`
      );
      blocked = true;
    }
    if (blocked) repositoryResourceBlocked = true;
  }

  function declaredBuildInfoBudgetPath(value) {
    if (value?.stage !== "prototype") return null;
    if (declaredSoliditySourceAndTestPaths(value).length === 0) return null;
    const paths = value.implementation?.compilerBuildInfoPaths;
    if (
      !Array.isArray(paths) ||
      paths.length !== 1 ||
      !safeRepositoryRelativePath(paths[0])
    ) {
      return null;
    }
    return path.resolve(repositoryRoot, paths[0]);
  }

  function loadTrustedOrderedRemappings() {
    const source = fs.readFileSync(path.join(repositoryRoot, "remappings.txt"), "utf8");
    const validated = new Map(
      parseRemappings(source).map(({ prefix, target }) => [prefix, target])
    );
    const ordered = [];
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      const prefix = line.slice(0, separator).trim();
      ordered.push(`${prefix}=${validated.get(prefix)}`);
    }
    return ordered;
  }

  function trustedFirstPartyRoots() {
    const packagePath = path.relative(repositoryRoot, packageRoot).replaceAll(path.sep, "/");
    return [...new Set([
      ...TRUSTED_FIRST_PARTY_ROOTS,
      ...(packagePath ? [packagePath] : [])
    ])].sort();
  }

  function safeRepositoryRelativePath(value) {
    return isCanonicalReviewTargetPath(value);
  }

  function addToolingBlocker(message) {
    const normalized = `tooling blocked: ${message}`;
    toolingBlockers.push(normalized);
    errors.push(normalized);
  }

  function repositoryPathResolutionError(error, relativePath) {
    if (
      error?.code === "ENOENT" ||
      /(?:does not exist|no existing ancestor)/i.test(error?.message ?? "")
    ) {
      return `implementation path does not exist: ${relativePath}`;
    }
    if (/symbolic|symlink/i.test(error?.message ?? "")) {
      return `implementation path contains a symbolic link: ${relativePath}`;
    }
    if (/(?:outside|escape)/i.test(error?.message ?? "")) {
      return `implementation path resolves outside repository: ${relativePath}`;
    }
    return `implementation path cannot be resolved: ${relativePath}`;
  }

  function relative(target) {
    return path.relative(repositoryRoot, target).replaceAll(path.sep, "/");
  }


  return {
    get repositoryResourceBlocked() {
      return repositoryResourceBlocked;
    },
    resolveRepositoryFile,
    walkPackage,
    validatePackageBudgets,
    declaredBuildInfoBudgetPath,
    loadTrustedOrderedRemappings,
    trustedFirstPartyRoots,
    addToolingBlocker,
    relative
  };
}
