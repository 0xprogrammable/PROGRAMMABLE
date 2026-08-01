import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { materializeExample } from "../example-materializer-core.mjs";
import { analyzeSubmission } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const examplesDirectory = path.join(skillRoot, "assets", "examples");
const schema = readJson(path.join(skillRoot, "references", "submission.schema.json"));
const fixtureNames = [
  "dynamic-lp-fee.json",
  "managed-usdc-quote.json",
  "transparent-pool-scoped-fee.json",
  "unsafe-hidden-curve.json"
];

for (const fixtureName of fixtureNames) {
  const fixture = readJson(path.join(examplesDirectory, fixtureName));

  test(fixture.name, () => {
    for (const step of fixture.steps) {
      const submission = materializeExample({
        skillRoot,
        exampleId: fixture.id,
        stepId: step.id
      });
      const report = analyzeSubmission(submission, { schema });

      assert.equal(
        report.decision,
        step.expected.decision,
        `${fixture.id}/${step.id}: ${JSON.stringify(report.findings)}`
      );

      if (step.expected.hookPermissionMask) {
        assert.equal(report.hookPermissionMask, step.expected.hookPermissionMask);
      }

      for (const [field, expected] of Object.entries(step.expected.risk ?? {})) {
        assert.deepEqual(report.risk[field], expected, `${fixture.id}/${step.id} risk.${field}`);
      }

      assert.deepEqual(
        report.findings.map(({ code, path: findingPath, severity }) =>
          `${severity}|${code}|${findingPath}`
        ),
        step.expected.findingKeys ?? [],
        `${fixture.id}/${step.id} findings changed`
      );
      assert.deepEqual(
        report.requiredGates.map(({ id, stage }) => `${stage}|${id}`),
        step.expected.gateKeys ?? [],
        `${fixture.id}/${step.id} required gates changed`
      );

      if (step.expected.decision === "PROTOTYPE_READY") {
        assert.equal(
          report.findings.some(({ severity }) => severity === "hard" || severity === "blocker"),
          false,
          `${fixture.id}/${step.id} ready state cannot contain a hard finding or blocker`
        );
      }
    }
  });
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}
