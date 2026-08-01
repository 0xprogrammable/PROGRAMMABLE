import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseCli } from "../cli-args.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const cli = path.join(skillRoot, "scripts", "cli.mjs");

test("CLI argument parser preserves repeated companion manifests in caller order", () => {
  const parsed = parseCli({
    command: "cli.mjs",
    options: [{
      name: "--companion-manifest",
      key: "companionManifests",
      type: "value",
      repeatable: true
    }],
    positionals: { min: 0, max: 0 }
  }, ["--companion-manifest", "a.json", "--companion-manifest=b.json"]);
  assert.deepEqual(parsed.options.companionManifests, ["a.json", "b.json"]);
});

test("doctor delegates to the existing readiness command and emits JSON", () => {
  const fixture = createRepository();
  try {
    const result = runCli(["doctor", "--repository-root", fixture.repository]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.schemaVersion, "1.0.0");
    assert.equal(output.command, "doctor");
    assert.equal(output.ok, true);
    assert.equal(output.result.repositoryRoot, fixture.repository);
    assert.equal(output.result.readyForDeterministicPreflight, true);
    assert.equal(output.result.readyForPublicBeta, false);
    assert.equal(output.result.publicBetaGit.publicReachability.status, "notChecked");
    assert.equal(output.result.publicBetaGit.readyForPreparePrLocal, false);
  } finally {
    fixture.cleanup();
  }
});

test("scaffold and check route through the canonical scripts", () => {
  const fixture = createRepository();
  try {
    const scaffold = runCli([
      "scaffold",
      "entry-model",
      "--name",
      "Entry Model",
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(scaffold.status, 0, scaffold.stdout || scaffold.stderr);
    assert.equal(scaffold.stderr, "");
    const scaffoldOutput = JSON.parse(scaffold.stdout);
    assert.equal(scaffoldOutput.command, "scaffold");
    assert.equal(scaffoldOutput.ok, true);
    assert.equal(scaffoldOutput.result.package, "submissions/entry-model");

    const submission = path.join(fixture.repository, "submissions", "entry-model", "submission.json");
    const report = path.join(fixture.repository, "submissions", "entry-model", "compatibility-report.json");
    const check = runCli(["check", submission, "--repository-root", fixture.repository]);
    assert.equal(check.status, 0, check.stdout || check.stderr);
    const checkOutput = JSON.parse(check.stdout);
    assert.equal(checkOutput.command, "check");
    assert.equal(checkOutput.ok, true);
    assert.equal(checkOutput.result.submissionHash, JSON.parse(fs.readFileSync(report, "utf8")).submissionHash);
    assert.deepEqual(checkOutput.result.reportWritten, {
      path: "submissions/entry-model/compatibility-report.json",
      submissionHash: checkOutput.result.submissionHash
    });
  } finally {
    fixture.cleanup();
  }
});

test("fresh scaffold, check and package reaches content gates without a hidden report flag", () => {
  const fixture = createRepository();
  try {
    const scaffold = runCli(["scaffold", "fresh-model", "--repository-root", fixture.repository]);
    assert.equal(scaffold.status, 0, scaffold.stdout || scaffold.stderr);
    const submission = path.join(fixture.repository, "submissions", "fresh-model", "submission.json");
    const report = path.join(fixture.repository, "submissions", "fresh-model", "compatibility-report.json");
    const check = runCli(["check", submission, "--repository-root", fixture.repository]);
    assert.equal(check.status, 0, check.stdout || check.stderr);
    assert.equal(fs.existsSync(report), true);

    const packaged = runCli([
      "package",
      path.dirname(submission),
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(packaged.status, 1, packaged.stdout || packaged.stderr);
    const output = JSON.parse(packaged.stdout);
    assert.equal(output.error.code, "PACKAGE_INVALID");
    assert.ok(output.error.details.errors.some((entry) => entry.includes("builder.github")));
    assert.ok(output.error.details.errors.every((entry) => !entry.includes("compatibility-report.json is missing")));
  } finally {
    fixture.cleanup();
  }
});

test("package reports a Git LFS source mutation as tooling blocked after a valid committed check", () => {
  const fixture = createRepository();
  try {
    let result = runCli([
      "scaffold",
      "lfs-model",
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const packageRoot = path.join(fixture.repository, "submissions", "lfs-model");
    const sourcePath = "submissions/lfs-model/app/main.ts";
    fs.mkdirSync(path.dirname(path.join(fixture.repository, sourcePath)), { recursive: true });
    fs.writeFileSync(path.join(fixture.repository, sourcePath), "export const ready = true;\n");

    const submissionPath = path.join(packageRoot, "submission.json");
    const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
    submission.builder.github = "lfs-builder";
    submission.builder.contact = "@lfs-builder";
    submission.builder.licenseDeclaration = "I own this proposal and submit it under MIT.";
    submission.implementation.sourcePaths = [sourcePath];
    fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);

    result = runCli(["check", submissionPath, "--repository-root", fixture.repository]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    runGit(fixture.repository, ["add", "."]);
    runGit(fixture.repository, ["commit", "--quiet", "-m", "valid checked proposal"]);

    fs.writeFileSync(path.join(fixture.repository, sourcePath), [
      "version https://git-lfs.github.com/spec/v1",
      `oid sha256:${"a".repeat(64)}`,
      "size 12345",
      ""
    ].join("\n"));
    result = runCli(["package", packageRoot, "--repository-root", fixture.repository]);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, "TOOLING_BLOCKED");
    assert.ok(output.error.details.errors.some((entry) => /Git LFS pointer is not materialized/u.test(entry)));
  } finally {
    fixture.cleanup();
  }
});

test("check rejects paths outside the selected repository and symbolic aliases", () => {
  const fixture = createRepository();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-cli-outside-"));
  try {
    const outsideSubmission = path.join(outside, "submission.json");
    fs.writeFileSync(outsideSubmission, "{}\n");
    const escaped = runCli([
      "check",
      outsideSubmission,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(escaped.status, 2);
    assert.equal(JSON.parse(escaped.stdout).error.code, "INVALID_PATH");

    const alias = path.join(fixture.repository, "submission-alias.json");
    fs.symlinkSync(outsideSubmission, alias);
    const linked = runCli([
      "check",
      alias,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(linked.status, 2);
    assert.equal(JSON.parse(linked.stdout).error.code, "INVALID_PATH");
  } finally {
    fixture.cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("package delegates to the existing package verifier", () => {
  const fixture = createReadyProposalRepository();
  try {
    const result = runCli([
      "package",
      fixture.packageRoot,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.command, "package");
    assert.equal(output.ok, true);
    assert.equal(output.result.intakeValidated, true);
    assert.match(output.result.submissionHash, /^sha256:[0-9a-f]{64}$/);
  } finally {
    fixture.cleanup();
  }
});

test("check writes unsupported proposal closure diagnostics and require-ready blocks the prototype", () => {
  const fixture = createReadyProposalRepository();
  try {
    const sourcePath = "submissions/ready-model/app/entry.ts";
    const sourceFile = path.join(fixture.repository, sourcePath);
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, 'import value from "@/game/value"; export { value };\n');
    const submissionPath = path.join(fixture.packageRoot, "submission.json");
    const reportPath = path.join(fixture.packageRoot, "compatibility-report.json");
    const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
    submission.stage = "proposal";
    submission.implementation.sourcePaths.push(sourcePath);
    fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);

    let result = runCli(["check", submissionPath, "--repository-root", fixture.repository]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    let report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.closure.status, "incomplete");
    assert.ok(report.closure.diagnostics.some(({ code }) => code === "JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN"));

    submission.stage = "prototype";
    fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);
    result = runCli([
      "check",
      submissionPath,
      "--require-ready",
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, "CHECK_NOT_READY");
    assert.equal(output.error.details.closure.status, "incomplete");
    assert.ok(output.error.details.findings.some(({ code }) => code === "JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN"));
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.closure.status, "incomplete");
  } finally {
    fixture.cleanup();
  }
});

test("prepare-pr entry fails closed with canonical JSON before external work", () => {
  const fixture = createReadyProposalRepository();
  try {
    const result = runCli([
      "prepare-pr",
      fixture.packageRoot,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.command, "prepare-pr");
    assert.equal(output.ok, false);
    assert.equal(output.error.code, "WORKTREE_DIRTY");
  } finally {
    fixture.cleanup();
  }
});

test("child failures stay machine-readable and do not leak control characters", () => {
  const fixture = createRepository();
  try {
    const malicious = `missing-${String.fromCharCode(27)}[31m-path`;
    const result = runCli([
      "package",
      malicious,
      "--repository-root",
      fixture.repository
    ]);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.error.code, "INVALID_PATH");
    assert.doesNotMatch(output.error.message, /\u001b|\[31m/);
  } finally {
    fixture.cleanup();
  }
});

function runCli(args, cwd = skillRoot) {
  return childProcess.spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    shell: false
  });
}

function createReadyProposalRepository() {
  const fixture = createRepository();
  const scaffold = childProcess.spawnSync(
    process.execPath,
    [path.join(skillRoot, "scripts", "scaffold-submission.mjs"), "ready-model", "--repository-root", fixture.repository],
    { cwd: fixture.repository, encoding: "utf8", shell: false }
  );
  assert.equal(scaffold.status, 0, scaffold.stderr);
  const packageRoot = path.join(fixture.repository, "submissions", "ready-model");
  const submissionPath = path.join(packageRoot, "submission.json");
  const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
  submission.builder.github = "example-builder";
  submission.builder.contact = "@example-builder";
  submission.builder.licenseDeclaration = "I own this work and submit it under MIT.";
  fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);
  const validation = childProcess.spawnSync(
    process.execPath,
    [
      path.join(skillRoot, "scripts", "validate-submission.mjs"),
      submissionPath,
      "--repository-root",
      fixture.repository,
      "--write-report",
      path.join(packageRoot, "compatibility-report.json")
    ],
    { cwd: fixture.repository, encoding: "utf8", shell: false }
  );
  assert.equal(validation.status, 0, validation.stderr);
  return { ...fixture, packageRoot };
}

function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-cli-entry-"));
  runGit(root, ["init", "--quiet", "--initial-branch=main"]);
  runGit(root, ["config", "user.name", "CLI Test"]);
  runGit(root, ["config", "user.email", "cli@example.invalid"]);
  fs.writeFileSync(path.join(root, "foundry.toml"), "[profile.default]\n");
  fs.writeFileSync(path.join(root, "remappings.txt"), "");
  const repository = fs.realpathSync(root);
  return {
    repository,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function runGit(cwd, args) {
  const result = childProcess.spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
