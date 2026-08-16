import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateFeeConformance } from "../fee-conformance-core.mjs";
import { buildRuntimeAssetReview } from "../runtime-assets-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const scriptsRoot = path.join(skillRoot, "scripts");
const duplicateInputs = Object.freeze([
  Object.freeze({
    name: "same-value",
    source: '{"stage":"proposal","stage":"proposal"}',
    shadowedSecret: null
  }),
  Object.freeze({
    name: "conflicting",
    source: '{"privateKey":"shadowed-conflicting-secret","privateKey":"redacted"}',
    shadowedSecret: "shadowed-conflicting-secret"
  }),
  Object.freeze({
    name: "escaped-equivalent",
    source: '{"priv\\u0061teKey":"shadowed-escaped-secret","privateKey":"redacted"}',
    shadowedSecret: "shadowed-escaped-secret"
  })
]);

test("legacy check and package inputs reject every duplicate-key form before output or semantics", () => {
  const root = temporaryGitRepository("programmable-legacy-json-");
  const packageRoot = path.join(root, "submission");
  const submissionPath = path.join(packageRoot, "submission.json");
  fs.mkdirSync(packageRoot, { recursive: true });
  try {
    for (const [index, candidate] of duplicateInputs.entries()) {
      fs.writeFileSync(submissionPath, candidate.source);
      const reportPath = path.join(root, `report-${index}.json`);
      const check = run("validate-submission.mjs", [submissionPath, "--write-report", reportPath]);
      assert.equal(check.status, 2, `${candidate.name}: ${check.stdout}\n${check.stderr}`);
      assert.match(check.stderr, /duplicate key/u, candidate.name);
      assert.equal(fs.existsSync(reportPath), false, candidate.name);
      assertSecretAbsent(check, candidate.shadowedSecret);

      const verification = run("verify-package.mjs", [
        "--repository-root",
        root,
        packageRoot
      ]);
      assert.equal(verification.status, 1, `${candidate.name}: ${verification.stdout}\n${verification.stderr}`);
      assert.match(verification.stdout, /duplicate key/u, candidate.name);
      assertSecretAbsent(verification, candidate.shadowedSecret);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("template-plan consumers reject every duplicate-key form without scaffolding", () => {
  const root = temporaryGitRepository("programmable-template-json-");
  const planPath = path.join(root, "programmable-template.json");
  try {
    for (const [index, candidate] of duplicateInputs.entries()) {
      fs.writeFileSync(planPath, candidate.source);
      const context = run("knowledge-router.mjs", [
        "--mode",
        "explore",
        "--template-plan",
        planPath
      ]);
      assert.equal(context.status, 1, `${candidate.name}: ${context.stdout}\n${context.stderr}`);
      assert.match(context.stdout, /TEMPLATE_PLAN_INVALID/u, candidate.name);
      assertSecretAbsent(context, candidate.shadowedSecret);

      const modelId = `duplicate-plan-${index}`;
      const scaffold = run("scaffold-submission.mjs", [
        modelId,
        "--repository-root",
        root,
        "--template-plan",
        planPath
      ]);
      assert.notEqual(scaffold.status, 0, `${candidate.name}: ${scaffold.stdout}\n${scaffold.stderr}`);
      assert.match(scaffold.stderr, /bounded duplicate-free UTF-8 JSON/u, candidate.name);
      assert.equal(fs.existsSync(path.join(root, "submissions", modelId)), false, candidate.name);
      assertSecretAbsent(scaffold, candidate.shadowedSecret);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime and fee manifests reject every duplicate-key form before structural review", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-manifest-json-")));
  const manifestPath = path.join(root, "fee-conformance.json");
  try {
    for (const candidate of duplicateInputs) {
      assert.throws(
        () => buildRuntimeAssetReview({
          repositoryRoot: root,
          manifestPath: "assets/runtime-assets.json",
          manifestBytes: Buffer.from(candidate.source)
        }),
        /duplicate key/u,
        candidate.name
      );

      fs.writeFileSync(manifestPath, candidate.source);
      const result = validateFeeConformance({ root, manifestPath });
      assert.equal(result.ok, false, candidate.name);
      assert.match(result.errors.join("\n"), /duplicate key/u, candidate.name);
      if (candidate.shadowedSecret !== null) {
        assert.doesNotMatch(result.errors.join("\n"), new RegExp(candidate.shadowedSecret, "u"));
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function temporaryGitRepository(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const initialized = childProcess.spawnSync("git", ["init", "-q", root], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  return root;
}

function run(script, args) {
  return childProcess.spawnSync(process.execPath, [path.join(scriptsRoot, script), ...args], {
    cwd: skillRoot,
    encoding: "utf8",
    shell: false
  });
}

function assertSecretAbsent(result, secret) {
  if (secret === null) return;
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secret, "u"));
}
