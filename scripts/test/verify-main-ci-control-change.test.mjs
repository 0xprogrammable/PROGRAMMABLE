import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  evaluateMainCiControlChange,
  isMainCiControlPath,
  readCandidateChange
} from "../verify-main-ci-control-change.mjs";

const APPROVED_COMMIT = "4758c979ce1538eacaa33e35b4f1297809af79e3";
const APPROVED_TREE = "990af077adcc3dcdc4f134882f8fac489938474b";

test("ordinary Website and intake paths remain on the fast trusted path", () => {
  const result = evaluateMainCiControlChange({
    changedPaths: [
      "app/(market)/page.tsx",
      "components/market-card.tsx",
      "submissions/example/application.json"
    ],
    candidateCommit: "1111111111111111111111111111111111111111",
    candidateTree: "2222222222222222222222222222222222222222",
    approvedCommit: APPROVED_COMMIT,
    approvedTree: APPROVED_TREE
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    result: "no-main-ci-control-change",
    changedPathCount: 3,
    controlPaths: []
  });
});

test("only the exact audited commit and tree may change the main CI control plane", () => {
  const changedPaths = [
    ".github/workflows/security.yml",
    ".github/workflows/verify.yml",
    "scripts/ci/classify-required-gates.mjs"
  ];
  const result = evaluateMainCiControlChange({
    changedPaths,
    candidateCommit: APPROVED_COMMIT,
    candidateTree: APPROVED_TREE,
    approvedCommit: APPROVED_COMMIT,
    approvedTree: APPROVED_TREE
  });
  assert.deepEqual(result, {
    schemaVersion: 1,
    result: "approved-exact-main-ci-control-change",
    changedPathCount: 3,
    controlPaths: changedPaths
  });

  assert.throws(
    () => evaluateMainCiControlChange({
      changedPaths,
      candidateCommit: "3333333333333333333333333333333333333333",
      candidateTree: APPROVED_TREE,
      approvedCommit: APPROVED_COMMIT,
      approvedTree: APPROVED_TREE
    }),
    /exactly match the audited candidate/u
  );
  assert.throws(
    () => evaluateMainCiControlChange({
      changedPaths,
      candidateCommit: APPROVED_COMMIT,
      candidateTree: "4444444444444444444444444444444444444444",
      approvedCommit: APPROVED_COMMIT,
      approvedTree: APPROVED_TREE
    }),
    /exactly match the audited candidate/u
  );
});

test("workflow, local action, ownership, submodule, and routing controls are protected", () => {
  for (const changedPath of [
    ".github/workflows/new-bypass.yml",
    ".github/actions/local/action.yml",
    ".github/CODEOWNERS",
    ".gitmodules",
    "scripts/ci/future-router.mjs",
    "scripts/test/classify-required-gates.test.mjs"
  ]) {
    assert.equal(isMainCiControlPath(changedPath), true, changedPath);
  }
  for (const changedPath of [
    ".github/workflows-archive/verify.yml",
    "app/page.tsx",
    "docs/README.md",
    "submissions/example/application.json"
  ]) {
    assert.equal(isMainCiControlPath(changedPath), false, changedPath);
  }
});

test("candidate Git evidence retains both sides of a protected rename and exact merge identity", (t) => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-main-ci-guard-"));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  git(repositoryRoot, ["init", "--quiet"]);
  git(repositoryRoot, ["config", "user.name", "Main CI Guard Test"]);
  git(repositoryRoot, ["config", "user.email", "main-ci-guard@example.invalid"]);

  fs.mkdirSync(path.join(repositoryRoot, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(repositoryRoot, ".github", "workflows", "verify.yml"), "name: Verify\n");
  git(repositoryRoot, ["add", "."]);
  git(repositoryRoot, ["commit", "--quiet", "-m", "base"]);
  const baseCommit = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const baseBranch = git(repositoryRoot, ["branch", "--show-current"]).trim();

  git(repositoryRoot, ["checkout", "--quiet", "-b", "candidate"]);
  fs.mkdirSync(path.join(repositoryRoot, "docs"));
  git(repositoryRoot, ["mv", ".github/workflows/verify.yml", "docs/verify.md"]);
  git(repositoryRoot, ["commit", "--quiet", "-m", "candidate"]);
  const candidateCommit = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const candidateTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]).trim();

  git(repositoryRoot, ["checkout", "--quiet", baseBranch]);
  git(repositoryRoot, ["merge", "--quiet", "--no-ff", "candidate", "-m", "merge"]);
  const mergeCommit = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();

  const evidence = readCandidateChange({
    candidateRoot: repositoryRoot,
    expectedBaseCommit: baseCommit,
    expectedCandidateCommit: candidateCommit,
    expectedMergeCommit: mergeCommit
  });
  assert.equal(evidence.candidateTree, candidateTree);
  assert.deepEqual(evidence.changedPaths.sort(), [
    ".github/workflows/verify.yml",
    "docs/verify.md"
  ]);

  assert.throws(
    () => readCandidateChange({
      candidateRoot: repositoryRoot,
      expectedBaseCommit: candidateCommit,
      expectedCandidateCommit: baseCommit,
      expectedMergeCommit: mergeCommit
    }),
    /merge parents/u
  );
});

test("unsafe and ambiguous changed paths fail closed", () => {
  for (const changedPaths of [
    ["../.github/workflows/verify.yml"],
    [".github/workflows/verify.yml\napp/page.tsx"],
    [".github/workflows/verify.yml", ".github/workflows/verify.yml"]
  ]) {
    assert.throws(() => evaluateMainCiControlChange({
      changedPaths,
      candidateCommit: APPROVED_COMMIT,
      candidateTree: APPROVED_TREE,
      approvedCommit: APPROVED_COMMIT,
      approvedTree: APPROVED_TREE
    }));
  }
});

function git(repositoryRoot, arguments_) {
  return execFileSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
