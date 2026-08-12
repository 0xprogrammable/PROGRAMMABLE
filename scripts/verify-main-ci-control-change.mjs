#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_CHANGED_PATHS = 4_096;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

export function isMainCiControlPath(changedPath) {
  return changedPath === ".gitmodules"
    || changedPath === ".github/CODEOWNERS"
    || changedPath.startsWith(".github/actions/")
    || changedPath.startsWith(".github/workflows/")
    || changedPath.startsWith("scripts/ci/")
    || changedPath === "scripts/test/classify-required-gates.test.mjs";
}

export function evaluateMainCiControlChange({
  changedPaths,
  candidateCommit,
  candidateTree,
  approvedCommit,
  approvedTree
}) {
  requireObjectId(candidateCommit, "candidate commit");
  requireObjectId(candidateTree, "candidate tree");
  requireObjectId(approvedCommit, "approved commit");
  requireObjectId(approvedTree, "approved tree");

  const validatedPaths = validateChangedPaths(changedPaths);
  const controlPaths = validatedPaths.filter(isMainCiControlPath);
  if (controlPaths.length === 0) {
    return {
      schemaVersion: 1,
      result: "no-main-ci-control-change",
      changedPathCount: validatedPaths.length,
      controlPaths: []
    };
  }

  if (candidateCommit !== approvedCommit || candidateTree !== approvedTree) {
    throw new Error([
      "main CI control-plane changes are denied unless they exactly match the audited candidate",
      `candidateCommit=${candidateCommit}`,
      `candidateTree=${candidateTree}`
    ].join("; "));
  }

  return {
    schemaVersion: 1,
    result: "approved-exact-main-ci-control-change",
    changedPathCount: validatedPaths.length,
    controlPaths
  };
}

export function readCandidateChange({
  candidateRoot,
  expectedBaseCommit,
  expectedCandidateCommit,
  expectedMergeCommit
}) {
  const root = path.resolve(candidateRoot);
  for (const [value, label] of [
    [expectedBaseCommit, "expected base commit"],
    [expectedCandidateCommit, "expected candidate commit"],
    [expectedMergeCommit, "expected merge commit"]
  ]) {
    requireObjectId(value, label);
  }

  if (!fs.existsSync(root)) throw new Error(`candidate Git store does not exist: ${root}`);
  execGit(root, ["cat-file", "-e", `${expectedBaseCommit}^{commit}`]);
  execGit(root, ["cat-file", "-e", `${expectedCandidateCommit}^{commit}`]);
  execGit(root, ["cat-file", "-e", `${expectedMergeCommit}^{commit}`]);

  const mergeParents = readCommitParents(root, expectedMergeCommit);
  if (
    mergeParents.length !== 2
    || mergeParents[0] !== expectedBaseCommit
    || mergeParents[1] !== expectedCandidateCommit
  ) {
    throw new Error("candidate merge parents do not match the authenticated base and head commits");
  }

  const candidateTree = execGit(root, ["rev-parse", `${expectedCandidateCommit}^{tree}`], "utf8").trim();
  requireObjectId(candidateTree, "resolved candidate tree");

  const output = execGit(root, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    `${expectedBaseCommit}...${expectedCandidateCommit}`,
    "--"
  ]);
  const changedPaths = parseChangedPathStream(output);
  return {
    candidateTree,
    changedPaths
  };
}

function readCommitParents(repositoryRoot, commit) {
  const commitBytes = execGit(repositoryRoot, ["cat-file", "commit", commit]);
  const headerEnd = commitBytes.indexOf("\n\n");
  if (headerEnd === -1) throw new Error("candidate merge commit has no canonical header boundary");

  const parents = [];
  const headerLines = commitBytes.subarray(0, headerEnd).toString("utf8").split("\n");
  for (const line of headerLines) {
    if (!line.startsWith("parent ")) continue;
    const parent = line.slice("parent ".length);
    requireObjectId(parent, "candidate merge parent");
    parents.push(parent);
  }
  return parents;
}

function parseChangedPathStream(output) {
  if (output.length === 0) return [];
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(output);
  if (!decoded.endsWith("\0")) throw new Error("Git returned a non-NUL-terminated changed-path stream");
  return validateChangedPaths(decoded.slice(0, -1).split("\0"));
}

function validateChangedPaths(inputPaths) {
  if (!Array.isArray(inputPaths)) throw new Error("changed paths must be an array");
  if (inputPaths.length > MAX_CHANGED_PATHS) {
    throw new Error(`candidate changes more than ${MAX_CHANGED_PATHS} paths`);
  }

  const seen = new Set();
  const validated = [];
  for (const changedPath of inputPaths) {
    if (
      typeof changedPath !== "string"
      || changedPath.length === 0
      || Buffer.byteLength(changedPath, "utf8") > 4_096
    ) {
      throw new Error("changed paths must be non-empty repository-relative strings of at most 4096 bytes");
    }
    if (
      changedPath.startsWith("/")
      || changedPath.includes("\\")
      || /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(changedPath)
    ) {
      throw new Error(`unsafe changed path: ${JSON.stringify(changedPath)}`);
    }
    const segments = changedPath.split("/");
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment === ".git")) {
      throw new Error(`non-canonical changed path: ${JSON.stringify(changedPath)}`);
    }
    if (seen.has(changedPath)) throw new Error(`duplicate changed path: ${JSON.stringify(changedPath)}`);
    seen.add(changedPath);
    validated.push(changedPath);
  }
  return validated;
}

function execGit(repositoryRoot, arguments_, encoding = null) {
  return execFileSync("git", ["--no-pager", "--no-replace-objects", ...arguments_], {
    cwd: repositoryRoot,
    encoding,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function requireObjectId(value, label) {
  if (!COMMIT_PATTERN.test(value ?? "")) throw new Error(`${label} must be a lowercase full Git SHA-1`);
}

function parseArguments(arguments_) {
  const parsed = {
    candidateRoot: null,
    expectedBaseCommit: null,
    expectedCandidateCommit: null,
    expectedMergeCommit: null,
    approvedCommit: null,
    approvedTree: null
  };
  const allowed = new Map([
    ["--candidate-root", "candidateRoot"],
    ["--expected-base-commit", "expectedBaseCommit"],
    ["--expected-candidate-commit", "expectedCandidateCommit"],
    ["--expected-merge-commit", "expectedMergeCommit"],
    ["--approved-commit", "approvedCommit"],
    ["--approved-tree", "approvedTree"]
  ]);

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const field = allowed.get(argument);
    if (!field || parsed[field] !== null || index + 1 >= arguments_.length) {
      throw new Error(`invalid argument: ${argument}`);
    }
    parsed[field] = arguments_[index + 1];
    index += 1;
  }
  for (const [field, value] of Object.entries(parsed)) {
    if (value === null) throw new Error(`missing required argument: ${field}`);
  }
  return parsed;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const { candidateTree, changedPaths } = readCandidateChange(options);
    const result = evaluateMainCiControlChange({
      changedPaths,
      candidateCommit: options.expectedCandidateCommit,
      candidateTree,
      approvedCommit: options.approvedCommit,
      approvedTree: options.approvedTree
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
