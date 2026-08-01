import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { materializeExample } from "../example-materializer-core.mjs";
import { validateAgainstSchema } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const cliPath = path.join(skillRoot, "scripts", "materialize-example.mjs");
const schema = readJson(path.join(skillRoot, "references", "submission.schema.json"));

const expectedExamples = [
  "dynamic-lp-fee",
  "managed-usdc-quote",
  "transparent-pool-scoped-fee",
  "unsafe-hidden-curve"
];

test("lists packaged scenario patches in stable order", () => {
  const result = runCli("--list");

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), expectedExamples);
});

test("prints concise help without reading or writing an example", () => {
  const result = runCli("--help");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: materialize-example\.mjs/);
  assert.match(result.stdout, /--example <id>/);
  assert.equal(result.stderr, "");
});

test("materializes every step as a complete schema-valid submission", () => {
  const fixturesDirectory = path.join(skillRoot, "assets", "examples");

  for (const exampleId of expectedExamples) {
    const fixture = readJson(path.join(fixturesDirectory, `${exampleId}.json`));

    for (const step of fixture.steps) {
      const result = runCli("--example", exampleId, "--step", step.id);
      assert.equal(result.status, 0, `${exampleId}/${step.id}: ${result.stderr}`);

      const submission = JSON.parse(result.stdout);
      assert.deepEqual(
        validateAgainstSchema(submission, schema),
        [],
        `${exampleId}/${step.id} must satisfy the submission schema`
      );
      assert.equal("steps" in submission, false);
      assert.equal("expected" in submission, false);
      assert.equal(submission.schemaVersion, 1);
      assert.equal(submission.model.id.length > 0, true);
    }
  }
});

test("writes byte-identical output for the same example and step", () => {
  const firstDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-example-a-"));
  const secondDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-example-b-"));
  const firstOutput = path.join(firstDirectory, "submission.json");
  const secondOutput = path.join(secondDirectory, "submission.json");

  try {
    const first = runCli(
      "--example",
      "dynamic-lp-fee",
      "--step",
      "fully-specified",
      "--output",
      firstOutput
    );
    const second = runCli(
      "--example",
      "dynamic-lp-fee",
      "--step",
      "fully-specified",
      "--output",
      secondOutput
    );

    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(firstOutput, "utf8"), fs.readFileSync(secondOutput, "utf8"));
  } finally {
    fs.rmSync(firstDirectory, { recursive: true, force: true });
    fs.rmSync(secondDirectory, { recursive: true, force: true });
  }
});

test("rejects path traversal and unknown steps without creating output", () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-example-reject-"));
  const outputPath = path.join(outputDirectory, "submission.json");

  try {
    const traversal = runCli(
      "--example",
      "../templates/submission.example",
      "--output",
      outputPath
    );
    assert.notEqual(traversal.status, 0);
    assert.match(traversal.stderr, /example id/i);
    assert.equal(fs.existsSync(outputPath), false);

    const unknownStep = runCli(
      "--example",
      "dynamic-lp-fee",
      "--step",
      "missing",
      "--output",
      outputPath
    );
    assert.notEqual(unknownStep.status, 0);
    assert.match(unknownStep.stderr, /step/i);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("reports the schema code and path for an invalid scenario patch", () => {
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-example-schema-"));
  const examplesDirectory = path.join(isolatedRoot, "assets", "examples");
  const templatesDirectory = path.join(isolatedRoot, "assets", "templates");
  const referencesDirectory = path.join(isolatedRoot, "references");

  try {
    fs.mkdirSync(examplesDirectory, { recursive: true });
    fs.mkdirSync(templatesDirectory, { recursive: true });
    fs.mkdirSync(referencesDirectory, { recursive: true });
    fs.copyFileSync(
      path.join(skillRoot, "assets", "templates", "submission.example.json"),
      path.join(templatesDirectory, "submission.example.json")
    );
    fs.copyFileSync(
      path.join(skillRoot, "references", "submission.schema.json"),
      path.join(referencesDirectory, "submission.schema.json")
    );
    fs.writeFileSync(
      path.join(examplesDirectory, "invalid-summary.json"),
      `${JSON.stringify({
        fixtureVersion: 1,
        id: "invalid-summary",
        name: "invalid summary",
        description: "This scenario intentionally exceeds one schema limit.",
        steps: [{
          id: "too-long",
          patch: { model: { summary: "x".repeat(501) } },
          expected: {}
        }]
      }, null, 2)}\n`
    );

    assert.throws(
      () => materializeExample({
        skillRoot: isolatedRoot,
        exampleId: "invalid-summary",
        stepId: "too-long"
      }),
      (error) => {
        assert.match(error.message, /SCHEMA_MAX_LENGTH/);
        assert.match(error.message, /\$\.model\.summary/);
        return true;
      }
    );
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});

test("the positive custom-accounting example exposes the complete accounting boundary", () => {
  const result = runCli(
    "--example",
    "transparent-pool-scoped-fee",
    "--step",
    "fully-specified"
  );
  assert.equal(result.status, 0, result.stderr);

  const submission = JSON.parse(result.stdout);
  const quadrants = submission.hook.feeMechanism.swapQuadrants;
  assert.deepEqual(Object.keys(quadrants).sort(), [
    "oneForZeroExactInput",
    "oneForZeroExactOutput",
    "zeroForOneExactInput",
    "zeroForOneExactOutput"
  ]);
  assert.equal(Object.values(quadrants).every((quadrant) => quadrant !== null), true);
  assert.equal(submission.hook.customAccounting.used, true);
  assert.deepEqual(submission.hook.customAccounting.liabilityKeyDimensions, [
    "poolId",
    "currency",
    "beneficiary"
  ]);
  assert.equal(submission.hook.customAccounting.crossPoolNetting, false);
  assert.equal(submission.integration.dataReconstruction.reserveReconstruction.used, true);
  assert.deepEqual(
    submission.integration.dataReconstruction.reserveReconstruction.attributionKeys,
    ["poolId", "currency", "beneficiary"]
  );
  assert.equal(submission.capabilities.externalCalls.used, true);
  assert.deepEqual(submission.risk.featureTriggers, [
    "custom-accounting",
    "external-calls",
    "price-impact",
    "return-delta"
  ]);
  assert.match(
    quadrants.zeroForOneExactOutput.formula,
    /1000000 minus 1000/
  );
  assert.equal(submission.hook.erc6909Claims.used, false);
  assert.equal(submission.security.hiddenControls, false);
});

function runCli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: skillRoot,
    encoding: "utf8"
  });
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}
