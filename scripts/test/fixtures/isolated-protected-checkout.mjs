import assert from "node:assert/strict";
import { lstat, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CANONICAL_ORIGIN = "https://github.com/programmablehq/PROGRAMMABLE";
const PROTECTED_ENVIRONMENT = Object.freeze({
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "programmablehq/PROGRAMMABLE",
  GITHUB_REPOSITORY_ID: "1314365508",
  GITHUB_REF: "refs/heads/production",
  GITHUB_REF_PROTECTED: "true",
});
const SANITIZED_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
});
const REMOVED_ENVIRONMENT = Object.freeze([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PROGRAMMABLE_API_KEY",
  "PROGRAMMABLE_PRODUCTION_VERIFY_PROOF",
  "PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION",
]);

export async function withIsolatedProtectedCheckout({
  repositoryRoot,
  materialize = null,
}, callback) {
  assert.equal(runGit(repositoryRoot, ["rev-parse", "--is-shallow-repository"]), "false",
    "protected-checkout fixture requires complete Git history");
  const sourceRevision = runGit(repositoryRoot, ["rev-parse", "HEAD^{commit}"]);
  const custodyRoot = await mkdtemp(path.join(os.tmpdir(), "programmable-v4-protected-"));
  const isolatedRoot = path.join(custodyRoot, "repository");
  try {
    runGit(null, ["clone", "--shared", "--no-checkout", "--", repositoryRoot, isolatedRoot]);
    runGit(isolatedRoot, ["checkout", "--detach", sourceRevision]);
    runGit(isolatedRoot, ["remote", "set-url", "origin", CANONICAL_ORIGIN]);
    await linkDependencies(repositoryRoot, isolatedRoot);

    const changedPaths = materialize === null
      ? []
      : await materialize({ isolatedRoot, sourceRevision });
    assert.ok(Array.isArray(changedPaths), "fixture materializer must return changed paths");
    if (changedPaths.length > 0) {
      for (const relativePath of changedPaths) assertSafeRelativePath(relativePath);
      runGit(isolatedRoot, ["add", "--", ...changedPaths]);
      if (runGitStatus(isolatedRoot, ["diff", "--cached", "--quiet"]) === 1) {
        runGit(isolatedRoot, [
          "-c", "commit.gpgsign=false",
          "-c", "user.name=Programmable Release Test",
          "-c", "user.email=release-test@programmable.invalid",
          "commit", "-m", "materialize isolated protected-checkout fixture",
        ]);
      }
    }

    const revision = runGit(isolatedRoot, ["rev-parse", "HEAD^{commit}"]);
    runGit(isolatedRoot, ["update-ref", "refs/remotes/origin/production", revision]);
    assert.equal(runGit(isolatedRoot, ["remote", "get-url", "origin"]), CANONICAL_ORIGIN);
    assert.equal(runGit(isolatedRoot, ["rev-parse", "refs/remotes/origin/production^{commit}"]),
      revision);
    assert.equal(runGit(isolatedRoot, ["rev-parse", "--is-shallow-repository"]), "false");
    assert.equal(runGit(isolatedRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
      "");
    const symbolic = spawnGit(isolatedRoot, ["symbolic-ref", "-q", "HEAD"]);
    assert.equal(symbolic.status, 1, "protected-checkout fixture must use detached HEAD");
    assert.equal(symbolic.stdout, "");
    assert.equal(symbolic.stderr, "");

    return await withProtectedEnvironment(revision,
      () => callback({ isolatedRoot, revision, sourceRevision }));
  } finally {
    await rm(custodyRoot, { recursive: true, force: true });
  }
}

function assertSafeRelativePath(relativePath) {
  assert.equal(typeof relativePath, "string");
  assert.equal(path.isAbsolute(relativePath), false);
  assert.ok(relativePath.length > 0
    && !relativePath.split("/").some((segment) => segment === "" || segment === "."
      || segment === ".."), `unsafe fixture path: ${relativePath}`);
}

async function linkDependencies(repositoryRoot, isolatedRoot) {
  const source = await realpath(path.join(repositoryRoot, "node_modules"));
  const info = await lstat(source);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(),
    "protected-checkout fixture requires installed root dependencies");
  await symlink(source, path.join(isolatedRoot, "node_modules"), "dir");
}

function runGit(root, args) {
  const result = spawnGit(root, args);
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function runGitStatus(root, args) {
  const result = spawnGit(root, args);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return result.status;
}

function spawnGit(root, args) {
  const commandArgs = root === null ? args : ["-C", root, ...args];
  return spawnSync("git", commandArgs, {
    encoding: "utf8",
    env: sanitizedEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
}

function sanitizedEnvironment() {
  const environment = { ...process.env, ...SANITIZED_ENVIRONMENT };
  for (const name of REMOVED_ENVIRONMENT) delete environment[name];
  return environment;
}

async function withProtectedEnvironment(revision, callback) {
  const replacements = {
    ...SANITIZED_ENVIRONMENT,
    ...PROTECTED_ENVIRONMENT,
    GITHUB_SHA: revision,
  };
  const names = new Set([...Object.keys(replacements), ...REMOVED_ENVIRONMENT]);
  const previous = new Map([...names].map((name) => [name, process.env[name]]));
  try {
    for (const name of REMOVED_ENVIRONMENT) delete process.env[name];
    Object.assign(process.env, replacements);
    return await callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
