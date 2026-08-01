import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");

for (const policyPath of [
  "references/official-launchpad-deployments.json",
  "references/official-model-patterns.md",
  "references/routing-and-discovery.md",
  "scripts/official-launchpad-core.mjs"
]) {
  test(`policy bundle binds ${policyPath}`, () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-policy-bundle-"));
    const copiedSkill = path.join(fixtureRoot, "programmable-v4-hook-builder");

    try {
      fs.cpSync(skillRoot, copiedSkill, { recursive: true });
      const firstHash = validate(copiedSkill).toolchain.policyBundleSha256;
      const fixtureChange = policyPath.endsWith(".mjs")
        ? "\n// Policy fixture change.\n"
        : "\nPolicy fixture change.\n";
      fs.appendFileSync(path.join(copiedSkill, policyPath), fixtureChange);
      const secondHash = validate(copiedSkill).toolchain.policyBundleSha256;

      assert.match(firstHash, /^sha256:[a-f0-9]{64}$/);
      assert.match(secondHash, /^sha256:[a-f0-9]{64}$/);
      assert.notEqual(secondHash, firstHash);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}

function validate(copiedSkill) {
  const submissionPath = path.join(copiedSkill, "assets", "templates", "submission.example.json");
  const validatorPath = path.join(copiedSkill, "scripts", "validate-submission.mjs");
  const result = childProcess.spawnSync(process.execPath, [validatorPath, submissionPath], {
    cwd: copiedSkill,
    encoding: "utf8",
    shell: false
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
