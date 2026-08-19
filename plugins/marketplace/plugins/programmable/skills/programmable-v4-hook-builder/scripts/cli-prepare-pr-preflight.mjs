import fs from "node:fs";
import path from "node:path";

import {
  assertInsideRepository,
  resolveRepositoryRoot
} from "./repository-root.mjs";
import { normalizeCompanionManifest } from "./companion-manifest-contract.mjs";
import { normalizeCompanionDescriptors } from "./cli-github-source.mjs";
import {
  CliFailure,
  sanitizeMessage
} from "./cli-runtime.mjs";
import { isCanonicalGitHubRepositoryPathV1 } from "./github-public-source-core.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { git, gitBinary } from "./cli-prepare-pr-transport.mjs";
import {
  MAX_COMPANION_MANIFEST_BYTES,
  MAX_COMPANION_MANIFESTS,
  compareUtf8,
  containsUnsafeText,
  relativeRepositoryPath
} from "./cli-prepare-pr-values.mjs";

export function resolveRoot(input) {
  try {
    return resolveRepositoryRoot(input);
  } catch (error) {
    throw new CliFailure("REPOSITORY_REQUIRED", error.message);
  }
}

export function resolvePackage(repositoryRoot, input) {
  if (typeof input !== "string" || input.length === 0 || containsUnsafeText(input)) {
    throw new CliFailure("INVALID_PATH", "submission package path is invalid");
  }
  try {
    const target = assertInsideRepository(repositoryRoot, path.resolve(repositoryRoot, input));
    if (!fs.statSync(target).isDirectory()) throw new Error("submission package is not a directory");
    return target;
  } catch (error) {
    throw new CliFailure("INVALID_PATH", error.message);
  }
}

export function assertOutputOutsideRepository(repositoryRoot, targetDirectory) {
  const contains = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === ""
      || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  if (contains(repositoryRoot, targetDirectory) || contains(targetDirectory, repositoryRoot)) {
    throw new CliFailure(
      "OUTPUT_PATH_INVALID",
      "prepare-pr output must be completely outside the builder source repository",
      { exitCode: 1 }
    );
  }
}

export function resolveCompanionManifestPaths(repositoryRoot, inputs) {
  if (!Array.isArray(inputs) || inputs.length > MAX_COMPANION_MANIFESTS) {
    throw new CliFailure("COMPANION_MANIFEST_INVALID", "prepare-pr accepts at most eight companion manifests", {
      exitCode: 1
    });
  }
  const paths = [];
  const seen = new Set();
  for (const input of inputs) {
    if (typeof input !== "string" || input.length === 0 || containsUnsafeText(input)) {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion manifest path is invalid", { exitCode: 1 });
    }
    const unresolved = path.resolve(repositoryRoot, input);
    let resolved;
    try {
      resolved = assertInsideRepository(repositoryRoot, unresolved);
    } catch (error) {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", error.message, { exitCode: 1 });
    }
    if (resolved !== unresolved) {
      throw new CliFailure(
        "COMPANION_MANIFEST_INVALID",
        "companion manifest paths cannot use symbolic aliases",
        { exitCode: 1 }
      );
    }
    const repositoryPath = relativeRepositoryPath(repositoryRoot, resolved);
    if (
      !isCanonicalGitHubRepositoryPathV1(repositoryPath)
      || seen.has(repositoryPath)
    ) {
      throw new CliFailure(
        "COMPANION_MANIFEST_INVALID",
        "companion manifest paths must be unique canonical repository paths",
        { exitCode: 1 }
      );
    }
    seen.add(repositoryPath);
    paths.push(repositoryPath);
  }
  return Object.freeze(paths.sort(compareUtf8));
}

export function readCompanionManifestsFromHead({
  repositoryRoot,
  commit,
  manifestPaths,
  gitImplementation,
  gitBinaryImplementation
}) {
  const parsed = [];
  for (const manifestPath of manifestPaths) {
    const treeRecord = git(
      repositoryRoot,
      ["ls-tree", "--full-tree", commit, "--", manifestPath],
      gitImplementation,
      { code: "COMPANION_MANIFEST_NOT_HEAD", message: "companion manifest is absent from the exact primary HEAD" }
    );
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(treeRecord);
    if (!match || match[3] !== manifestPath) {
      throw new CliFailure(
        "COMPANION_MANIFEST_NOT_HEAD",
        "every companion manifest must be a regular blob in the exact primary HEAD",
        { exitCode: 1 }
      );
    }
    const indexRecord = git(
      repositoryRoot,
      ["ls-files", "-v", "--", manifestPath],
      gitImplementation,
      { code: "COMPANION_MANIFEST_NOT_HEAD", message: "companion manifest index state is unavailable" }
    );
    if (indexRecord !== `H ${manifestPath}`) {
      throw new CliFailure(
        "COMPANION_MANIFEST_NOT_HEAD",
        "companion manifests cannot use assume-unchanged, skip-worktree, symlink, or gitlink state",
        { exitCode: 1 }
      );
    }
    const bytes = gitBinary(
      repositoryRoot,
      ["cat-file", "blob", `${commit}:${manifestPath}`],
      gitBinaryImplementation
    );
    if (bytes.length < 2 || bytes.length > MAX_COMPANION_MANIFEST_BYTES) {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion manifest exceeds the bounded byte limit", {
        exitCode: 1
      });
    }
    let value;
    try {
      value = parseBoundedStrictJsonBytes(bytes, { maxSourceBytes: MAX_COMPANION_MANIFEST_BYTES });
    } catch {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion manifest must be valid UTF-8 JSON", {
        exitCode: 1
      });
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion manifest must be a JSON object", {
        exitCode: 1
      });
    }
    const canonicalBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    if (!bytes.equals(canonicalBytes)) {
      throw new CliFailure(
        "COMPANION_MANIFEST_INVALID",
        "companion manifest must use canonical JSON with one trailing newline",
        { exitCode: 1 }
      );
    }
    let normalized;
    try {
      normalized = normalizeCompanionManifest(value);
    } catch (error) {
      throw new CliFailure(
        "COMPANION_MANIFEST_INVALID",
        sanitizeMessage(error?.message ?? "companion manifest is invalid"),
        { exitCode: 1 }
      );
    }
    parsed.push({ path: manifestPath, ...normalized });
  }
  const normalized = normalizeCompanionDescriptors(parsed.map((binding) => ({
    ...binding.source,
    manifestPath: binding.path,
    ...(binding.manifestV2 === null ? {} : { companionManifestV2: binding.manifestV2 })
  })));
  return parsed.map((binding, index) => Object.freeze({
    path: binding.path,
    schemaVersion: binding.schemaVersion,
    source: Object.freeze({
      repositoryUri: normalized[index].repositoryUri,
      revisionObjectId: normalized[index].revisionObjectId,
      sourcePaths: normalized[index].sourcePaths,
      contractPaths: normalized[index].contractPaths,
      ...(normalized[index].numericRepositoryId === null ? {} : {
        numericRepositoryId: normalized[index].numericRepositoryId,
        treeObjectId: normalized[index].treeObjectId,
        githubActionsRunIds: normalized[index].githubActionsRunIds
      })
    }),
    manifestV2: binding.manifestV2,
    closureStatus: binding.closureStatus
  }));
}

export function assertCompanionClosureVerification(bindings, attestations) {
  const required = bindings.filter(({ manifestV2 }) => manifestV2 !== null);
  if (required.length === 0) return;
  if (!Array.isArray(attestations)) {
    throw new CliFailure(
      "TOOLING_BLOCKED",
      "companion manifest v2 requires exact remote closure verification",
      { exitCode: 1 }
    );
  }
  const verifiedByRepository = new Map(attestations.map((entry) => [entry?.repositoryUri, entry]));
  for (const binding of required) {
    const verified = verifiedByRepository.get(binding.manifestV2.repositoryUri);
    if (
      verified?.status !== "verified"
      || verified.manifestPath !== binding.path
      || verified.numericRepositoryId !== binding.manifestV2.numericRepositoryId
      || verified.revisionObjectId !== binding.manifestV2.revisionObjectId
      || verified.treeObjectId !== binding.manifestV2.treeObjectId
    ) {
      throw new CliFailure(
        "PACKAGE_INVALID",
        "companion manifest v2 did not verify the exact repository, commit, tree, source, test, build, and dependency closure",
        { exitCode: 1, details: { path: binding.path } }
      );
    }
  }
}

export function assertCleanWorktree(repositoryRoot, packageRoot, gitImplementation) {
  const status = git(
    repositoryRoot,
    ["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"],
    gitImplementation
  );
  const packageRelative = relativeRepositoryPath(repositoryRoot, packageRoot);
  const packageStatus = git(
    repositoryRoot,
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignored=matching",
      "--ignore-submodules=none",
      "--",
      packageRelative
    ],
    gitImplementation
  );
  if (status.length > 0 || packageStatus.length > 0) {
    throw new CliFailure(
      "WORKTREE_DIRTY",
      "prepare-pr requires a clean worktree and a fully tracked submission package",
      { exitCode: 1 }
    );
  }
}

export function assertGitSnapshotUnchanged({
  repositoryRoot,
  packageRoot,
  branch,
  commit,
  tree,
  remoteName,
  mergeRef,
  upstreamCommit,
  remoteUrl,
  gitImplementation
}) {
  assertCleanWorktree(repositoryRoot, packageRoot, gitImplementation);
  const failure = {
    code: "GIT_STATE_CHANGED",
    message: "the Git identity changed while prepare-pr was building the bundle"
  };
  const observed = {
    branch: git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], gitImplementation, failure),
    commit: git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"], gitImplementation, failure),
    tree: git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{tree}"], gitImplementation, failure),
    remoteName: git(repositoryRoot, ["config", "--get", `branch.${branch}.remote`], gitImplementation, failure),
    mergeRef: git(repositoryRoot, ["config", "--get", `branch.${branch}.merge`], gitImplementation, failure),
    upstreamCommit: git(repositoryRoot, ["rev-parse", "--verify", "@{upstream}^{commit}"], gitImplementation, failure),
    remoteUrl: git(repositoryRoot, ["config", "--get", `remote.${remoteName}.url`], gitImplementation, failure)
  };
  const expected = { branch, commit, tree, remoteName, mergeRef, upstreamCommit, remoteUrl };
  if (Object.keys(expected).some((key) => observed[key] !== expected[key])) {
    throw new CliFailure(failure.code, failure.message, { exitCode: 1 });
  }
}
