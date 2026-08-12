import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const templates = [
  {
    path: "assets/templates/primary-foundry-evidence-workflow.yml",
    commands: ["forge fmt --check", "forge build", "forge test"],
    actions: ["actions/checkout", "foundry-rs/foundry-toolchain"],
  },
  {
    path: "assets/templates/primary-npm-evidence-workflow.yml",
    commands: [
      "npm ci --ignore-scripts --no-audit --no-fund",
      "npm run build",
      "npm test",
    ],
    actions: ["actions/checkout", "actions/setup-node"],
  },
];

for (const fixture of templates) {
  test(`${fixture.path} is a closed read-only exact-source evidence example`, () => {
    const workflow = JSON.parse(
      fs.readFileSync(path.join(skillRoot, fixture.path), "utf8"),
    );
    assert.deepEqual(workflow.on, ["push"]);
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.deepEqual(Object.keys(workflow.jobs), ["programmable-primary-evidence"]);
    const job = workflow.jobs["programmable-primary-evidence"];
    assert.equal(job["runs-on"], "ubuntu-24.04");
    assert.ok(Number.isInteger(job["timeout-minutes"]));
    assert.ok(job["timeout-minutes"] > 0 && job["timeout-minutes"] <= 30);
    const uses = job.steps.filter((step) => step.uses).map((step) => step.uses);
    assert.deepEqual(uses.map((value) => value.split("@")[0]), fixture.actions);
    assert.ok(uses.every((value) => /@[0-9a-f]{40}$/u.test(value)));
    const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with["persist-credentials"], false);
    assert.equal(checkout.with["fetch-depth"], 1);
    const commands = job.steps.filter((step) => step.run).map((step) => step.run);
    assert.deepEqual(commands, fixture.commands);
    assert.ok(commands.every((command) => !/(?:curl|wget|--if-present|\$\{\{|sudo)/u.test(command)));
  });
}
