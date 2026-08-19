import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(testDirectory, "..", "cli.mjs");

test("fresh ordinary launch scaffolds a permissionless token with the mandatory standard fee hook", () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-ordinary-cli-"));
  try {
    const initialized = childProcess.spawnSync("git", ["init", "--quiet", repository], {
      encoding: "utf8",
      shell: false
    });
    assert.equal(initialized.status, 0, initialized.stderr);

    const planDirectory = path.join(repository, "ordinary-plan");
    const started = run([
      "start",
      "--starter",
      "ordinary-launch",
      "--target",
      planDirectory
    ], repository);
    assert.equal(started.status, 0, started.stdout || started.stderr);

    const scaffolded = run([
      "scaffold",
      "ordinary-token",
      "--template-plan",
      path.join(planDirectory, "programmable-template.json"),
      "--repository-root",
      repository
    ], repository);
    assert.equal(scaffolded.status, 0, scaffolded.stdout || scaffolded.stderr);

    const submissionPath = path.join(repository, "submissions", "ordinary-token", "submission.json");
    const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
    assert.equal(submission.model.category, "permissionless-token");
    assert.match(submission.model.summary, /mandatory standard Programmable fee-hook profile/u);
    assert.match(submission.model.userOutcome, /no project-defined callback behavior beyond mandatory fee collection/u);
    assert.equal(submission.hook.used, true);
    assert.equal(submission.builderTemplate.templateSelection.starterId, "ordinary-launch");
    assert.ok(
      submission.builderTemplate.templateSelection.selectedCapabilityIds.includes("standard-programmable-fee-hook")
    );

    const checked = run([
      "check",
      submissionPath,
      "--no-write",
      "--repository-root",
      repository
    ], repository);
    assert.equal(checked.status, 0, checked.stdout || checked.stderr);
    const output = JSON.parse(checked.stdout);
    const codes = new Set(output.result.findings.map(({ code }) => code));
    assert.equal(codes.has("NOVEL_PROJECT_CATEGORY_REQUIRES_ARCHITECTURE_REVIEW"), false);
    assert.equal(codes.has("HOOK_USAGE_UNRESOLVED"), false);
    assert.equal(output.result.commandOutcome.zeroExitMeaning, "REPORT_GENERATED_ONLY_NOT_READINESS");
    assert.equal(output.result.reportWritten, null);
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

function run(args, cwd) {
  return childProcess.spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 120_000
  });
}
