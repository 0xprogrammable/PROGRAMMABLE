import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const scriptsRoot = path.join(skillRoot, "scripts");
const commands = [
  "cli.mjs",
  "cli-review-target.mjs",
  "doctor.mjs",
  "scaffold-submission.mjs",
  "validate-submission.mjs",
  "verify-package.mjs",
  "verify-skill.mjs",
  "resolve-deployment.mjs",
  "build-review-target.mjs"
];

test("host-neutral entry lists exactly the five builder commands", () => {
  const result = run("cli.mjs", ["--help"]);
  assert.equal(result.status, 0, result.stderr);
  for (const command of ["doctor", "scaffold", "check", "package", "prepare-pr"]) {
    assert.match(result.stdout, new RegExp(`^  ${escapeRegExp(command)}\\b`, "m"));
  }
  assert.equal(result.stderr, "");
});

test("prepare-pr exposes output materialization only through an explicit value option", () => {
  const help = run("cli.mjs", ["prepare-pr", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--output-dir <path>/);
  assert.match(help.stdout, /--replace-existing/);
  assert.match(help.stdout, /--replace-draft/);

  const missing = run("cli.mjs", ["prepare-pr", "submission", "--output-dir"]);
  assert.equal(missing.status, 2, missing.stderr);
  const output = JSON.parse(missing.stdout);
  assert.equal(output.error.code, "USAGE_ERROR");
  assert.match(output.error.message, /--output-dir requires a value/);

  const replaceWithoutOutput = run("cli.mjs", ["prepare-pr", "submission", "--replace-existing"]);
  assert.equal(replaceWithoutOutput.status, 2, replaceWithoutOutput.stderr);
  const replaceOutput = JSON.parse(replaceWithoutOutput.stdout);
  assert.equal(replaceOutput.error.code, "USAGE_ERROR");
  assert.match(replaceOutput.error.message, /replacement requires --output-dir/);

  const draftWithoutOutput = run("cli.mjs", ["prepare-pr", "submission", "--replace-draft"]);
  assert.equal(draftWithoutOutput.status, 2, draftWithoutOutput.stderr);
  assert.match(JSON.parse(draftWithoutOutput.stdout).error.message, /replacement requires --output-dir/);

  const conflicting = run("cli.mjs", [
    "prepare-pr",
    "submission",
    "--output-dir",
    "/tmp/example-hook",
    "--replace-existing",
    "--replace-draft"
  ]);
  assert.equal(conflicting.status, 2, conflicting.stderr);
  assert.match(JSON.parse(conflicting.stdout).error.message, /mutually exclusive/);
});

test("host-neutral entry returns canonical JSON for usage failures", () => {
  const result = run("cli.mjs", ["unknown-command"]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    command: "unknown-command",
    error: {
      code: "UNKNOWN_COMMAND",
      message: "unknown command unknown-command"
    },
    ok: false,
    schemaVersion: "1.0.0"
  });
});

test("every bundled CLI exposes side-effect-free help", () => {
  for (const command of commands) {
    const result = run(command, ["--help"]);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`Usage: ${escapeRegExp(command)}`));
    assert.equal(result.stderr, "");
  }
});

test("direct doctor fails closed on executable Git config with unusual subsection characters", () => {
  const repository = createRepository();
  const hookRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-doctor-hooks-"));
  const fsmonitorMarker = path.join(hookRoot, "fsmonitor-executed");
  const filterMarker = path.join(hookRoot, "filter-executed");
  const diffMarker = path.join(hookRoot, "diff-executed");
  try {
    fs.writeFileSync(path.join(repository, ".gitattributes"), "tracked.txt filter=x=y diff=x=y\n");
    fs.writeFileSync(path.join(repository, "tracked.txt"), "original\n");
    runTestGit(repository, ["add", "."]);
    runTestGit(repository, [
      "-c", "user.name=Fixture",
      "-c", "user.email=fixture@example.invalid",
      "commit", "--quiet", "-m", "fixture"
    ]);
    const fsmonitorHook = createGitCommandProbe(hookRoot, fsmonitorMarker, "fsmonitor-probe");
    const filterCommand = createGitCommandProbe(hookRoot, filterMarker, "filter-probe");
    const diffCommand = createGitCommandProbe(hookRoot, diffMarker, "diff-probe");
    runTestGit(repository, ["config", "core.fsmonitor", fsmonitorHook]);
    runTestGit(repository, ["config", "filter.x=y.clean", filterCommand]);
    runTestGit(repository, ["config", "diff.odd name:!/@=driver.textconv", diffCommand]);
    fs.writeFileSync(path.join(repository, "tracked.txt"), "changed\n");

    const result = run("doctor.mjs", ["--json", "--repository-root", repository], { cwd: repository });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.repositoryRoot, repository);
    assert.equal(report.cleanWorktree, null);
    assert.equal(report.readyForRepositoryWork, false);
    assert.match(report.repositoryGitBlocker, /Remove filter\.\* clean\/smudge\/process\/required/u);
    assert.equal(fs.existsSync(fsmonitorMarker), false);
    assert.equal(fs.existsSync(filterMarker), false);
    assert.equal(fs.existsSync(diffMarker), false);
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
    fs.rmSync(hookRoot, { recursive: true, force: true });
  }
});

test("value options reject missing values before doing work", () => {
  const repository = createRepository();
  try {
    const cases = [
      ["doctor.mjs", ["--repository-root"], "--repository-root"],
      ["scaffold-submission.mjs", ["strict-model", "--repository-root"], "--repository-root"],
      ["scaffold-submission.mjs", ["strict-model", "--destination"], "--destination"],
      ["scaffold-submission.mjs", ["strict-model", "--name"], "--name"],
      ["validate-submission.mjs", ["submission.json", "--write-report"], "--write-report"],
      ["verify-package.mjs", ["package", "--repository-root"], "--repository-root"],
      ["resolve-deployment.mjs", ["--id"], "--id"],
      ["resolve-deployment.mjs", ["--chain-id"], "--chain-id"],
      ["resolve-deployment.mjs", ["--contract"], "--contract"],
      ["build-review-target.mjs", ["package", "--repository-root"], "--repository-root"],
      ["build-review-target.mjs", ["package", "--write"], "--write"]
    ];
    for (const [command, args, flag] of cases) {
      const result = run(command, args, { cwd: repository });
      assert.equal(result.status, 2, `${command} ${args.join(" ")}: ${result.stderr}`);
      assert.match(result.stderr, new RegExp(`${escapeRegExp(flag)} requires a value`));
      assert.match(result.stderr, new RegExp(`Try '${escapeRegExp(command)} --help'`));
    }
    assert.equal(fs.existsSync(path.join(repository, "submissions")), false);
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("scaffolder validates model identity and publishes one complete package", () => {
  const repository = createRepository();
  try {
    for (const [args, message] of [
      [["a".repeat(65)], /at most 64 characters/],
      [["valid-id", "--name", "bad\nname"], /control or bidirectional/],
      [["valid-id", "--name", "n".repeat(81)], /at most 80 characters/]
    ]) {
      const result = run("scaffold-submission.mjs", args, { cwd: repository });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, message);
    }
    assert.equal(fs.existsSync(path.join(repository, "submissions")), false);

    const result = run("scaffold-submission.mjs", ["valid-id", "--name", "Valid Model"], { cwd: repository });
    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(repository, "submissions", "valid-id");
    assert.deepEqual(
      fs.readdirSync(destination).sort(),
      ["EVIDENCE.md", "PROPOSAL.md", "TEST_PLAN.md", "THREAT_MODEL.md", "submission.json"]
    );
    const submission = JSON.parse(fs.readFileSync(path.join(destination, "submission.json"), "utf8"));
    assert.equal(submission.model.id, "valid-id");
    assert.equal(submission.model.name, "Valid Model");
    assert.deepEqual(
      fs.readdirSync(path.join(repository, "submissions")).filter((name) => name.startsWith(".valid-id.")),
      []
    );
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("scaffolder preloads every resource before creating a destination", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-skill-missing-template-"));
  const copiedSkill = path.join(fixture, "programmable-v4-hook-builder");
  const repository = createRepository();
  try {
    fs.cpSync(skillRoot, copiedSkill, { recursive: true });
    fs.rmSync(path.join(copiedSkill, "assets", "templates", "PROPOSAL.md"));
    const result = childProcess.spawnSync(
      process.execPath,
      [path.join(copiedSkill, "scripts", "scaffold-submission.mjs"), "atomic-model"],
      { cwd: repository, encoding: "utf8", shell: false }
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /cannot load scaffold resources/);
    assert.equal(fs.existsSync(path.join(repository, "submissions")), false);
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("verify-package rejects oversized input before parsing untrusted JSON", () => {
  const repository = createRepository();
  try {
    const packageRoot = path.join(repository, "submissions", "oversized");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "submission.json"), "{".padEnd(2_000_001, "x"));
    const result = run(
      "verify-package.mjs",
      ["--repository-root", fs.realpathSync(repository), fs.realpathSync(packageRoot)],
      { cwd: repository }
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /package resource preflight failed/);
    assert.match(result.stderr, /file exceeds the 2000000 byte review limit/);
    assert.doesNotMatch(result.stderr, /Unexpected token|not valid JSON|JSON\.parse/i);
    assert.equal(result.stdout, "");
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test("verify-package caps filesystem entries before parsing package content", () => {
  const repository = createRepository();
  try {
    const packageRoot = path.join(repository, "submissions", "many-files");
    fs.mkdirSync(packageRoot, { recursive: true });
    for (let index = 0; index < 513; index += 1) {
      fs.writeFileSync(path.join(packageRoot, `${String(index).padStart(4, "0")}.txt`), "");
    }
    const result = run(
      "verify-package.mjs",
      ["--repository-root", fs.realpathSync(repository), fs.realpathSync(packageRoot)],
      { cwd: repository }
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /package exceeds the 512 file review limit/);
    assert.equal(result.stdout, "");
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

function run(command, args, { cwd = skillRoot } = {}) {
  return childProcess.spawnSync(process.execPath, [path.join(scriptsRoot, command), ...args], {
    cwd,
    encoding: "utf8",
    shell: false
  });
}

function createRepository() {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-cli-test-"));
  const result = childProcess.spawnSync("git", ["-C", repository, "init", "--quiet"], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(result.status, 0, result.stderr);
  return fs.realpathSync(repository);
}

function runTestGit(repository, args) {
  const result = childProcess.spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createGitCommandProbe(hookRoot, marker, name) {
  const hook = path.join(hookRoot, name);
  fs.writeFileSync(hook, [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    `fs.writeFileSync(${JSON.stringify(marker)}, "executed\\n");`,
    'process.stdout.write("token\\n");',
    ""
  ].join("\n"));
  fs.chmodSync(hook, 0o755);
  return hook;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
