import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");
const schemaPath = path.join(
  skillRoot,
  "references",
  "application-api.schema.json"
);

test("application API schema keeps the canonical identity and launch states", () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  assert.equal(
    schema.$id,
    "https://programmable.family/schemas/custom-hook-application-api-1.0.0.json"
  );
  assert.equal(schema.$defs.schemaVersion.const, "1.0.0");
  assert.deepEqual(schema.$defs.applicationStatus.enum, [
    "draft-unclaimed",
    "submitted",
    "in-review",
    "changes-requested",
    "approved",
    "launched",
    "not-supported",
    "withdrawn"
  ]);

  const applicationRequired = new Set(schema.$defs.application.required);
  for (const field of [
    "revision",
    "status",
    "claimState",
    "repositoryId",
    "repositoryKey",
    "commit",
    "submissionHash",
    "reviewTargetHash"
  ]) {
    assert.ok(applicationRequired.has(field), `missing application field ${field}`);
  }

  const ownerRequired = new Set(schema.$defs.ownerEligibility.required);
  for (const field of [
    "wallet",
    "github",
    "repositoryOptions",
    "repository",
    "application",
    "eligibility",
    "repositoryLaunchState",
    "launchDraft",
    "transactionState",
    "launchRecord"
  ]) {
    assert.ok(ownerRequired.has(field), `missing owner field ${field}`);
  }

  assert.equal(
    schema.$defs.githubSession.properties.effectivePermission.enum[0],
    "ADMIN"
  );
  assert.ok(
    schema.$defs.eligibilityReason.enum.includes("REPOSITORY_CLAIMED")
  );
  assert.ok(schema.$defs.eligibilityReason.enum.includes("PERMIT_READY"));
  assert.ok(schema.$defs.eligibilityReason.enum.includes("PERMIT_CONSUMED"));

  const eligibleRule =
    schema.$defs.ownerEligibility.properties.eligibility.allOf[0];
  assert.equal(
    eligibleRule.then.properties.reason.const,
    "PERMIT_READY"
  );
  assert.equal(eligibleRule.then.properties.permitState.const, "ready");

  const ownerRules = schema.$defs.ownerEligibility.allOf;
  assert.ok(
    ownerRules.some(
      (rule) =>
        rule.if?.properties?.application?.properties?.status?.const ===
          "launched" &&
        rule.then?.properties?.launchRecord?.$ref === "#/$defs/launchRecord"
    )
  );
  assert.ok(
    ownerRules.some(
      (rule) =>
        rule.if?.properties?.eligibility?.properties?.reason?.const ===
          "LAUNCH_DETAILS_REQUIRED" &&
        rule.then?.properties?.application?.properties?.status?.const ===
          "approved"
    )
  );
});
