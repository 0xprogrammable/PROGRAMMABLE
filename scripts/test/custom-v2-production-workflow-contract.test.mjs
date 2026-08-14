import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deploy = readFileSync(".github/workflows/deploy-production.yml", "utf8");
const verify = readFileSync(".github/workflows/verify.yml", "utf8");
const proof = readFileSync("scripts/production-verify-proof.mjs", "utf8");

function stepBlock(source, name) {
  const start = source.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1, `missing step ${name}`);
  const end = source.indexOf("\n      - name:", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

test("Custom V2 production proof is a dedicated versioned protected lane", () => {
  assert.match(proof, /programmable\.production-verify-proof\.v3/u);
  assert.match(proof, /"custom_v2"/u);
  assert.match(proof, /id: "custom-v2", name: "Custom V2", scopeKey: "custom_v2"/u);
  assert.match(verify, /^  custom-v2:$/mu);
  assert.match(verify, /name: Verify exact Custom V2 surface[\s\S]*npm run verify:custom-v2:ci/u);
  assert.match(
    verify,
    /name: Verify exact Website projection database operator[\s\S]*node --test scripts\/website-projection-db-operator\.test\.mjs/u,
  );
  assert.match(verify, /PRODUCTION_VERIFY_SCOPE_CUSTOM_V2:/u);
  assert.match(verify, /PRODUCTION_VERIFY_CUSTOM_V2_RESULT:/u);
  assert.match(verify, /verified Custom V2|CUSTOM_V2_RESULT/u);
});

test("trusted-base classification bootstraps Custom V2 without narrowing legacy lanes", () => {
  const block = stepBlock(verify, "Classify changed paths");
  assert.match(block, /git show "\$BASE_SHA:scripts\/ci\/classify-verify-paths\.mjs"/u);
  assert.match(block, /if ! grep -Eq '\^custom_v2=\(true\|false\)\$'/u);
  assert.match(block, /echo 'custom_v2=true'/u);
  assert.match(block, /changing or narrowing any trusted-base legacy result/u);
});

test("Custom V2 stage expectations are explicit, observational, and default disabled", () => {
  for (const input of [
    "custom_v2_registry_live",
    "custom_v2_generic_public_read_enabled",
  ]) {
    assert.match(
      deploy,
      new RegExp(`${input}:[\\s\\S]{0,240}default: false[\\s\\S]{0,80}type: boolean`, "u"),
    );
  }
  assert.match(deploy, /this does not change configuration/u);
  assert.match(deploy, /this does not activate them/u);
  assert.match(deploy, /verified_custom_v2: \$\{\{ steps\.verify-proof\.outputs\.verified_custom_v2 \}\}/u);
  const gate = stepBlock(deploy, "Gate exact unaliased Custom V2 staged candidate");
  assert.match(gate, /if: needs\.release-gate\.outputs\.verified_custom_v2 == 'true'/u);
  assert.match(gate, /STAGED_DEPLOYMENT_ID: \$\{\{ steps\.staged-deployment\.outputs\.deployment_id \}\}/u);
  assert.match(gate, /STAGED_TARGET_URL: \$\{\{ steps\.staged-deployment\.outputs\.target_url \}\}/u);
  assert.match(gate, /EXPECTED_GIT_HEAD: \$\{\{ github\.sha \}\}/u);
  assert.match(gate, /vercel env run --environment=production/u);
  assert.match(gate, /npm run probe:custom-v2:stage/u);
  assert.match(gate, /--registry-mode/u);
  assert.match(gate, /--generic-mode/u);
  assert.match(gate, /--authenticated-ingress-evidence-sha256/u);
  assert.doesNotMatch(gate, /echo .*AUTHENTICATED_INGRESS|set -x/u);
});

test("Custom V2 evidence is immutable while the workflow remains stage-only", () => {
  assert.match(deploy, /name: custom-v2-stage-evidence-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
  assert.match(deploy, /retention-days: 90/u);
  assert.match(deploy, /vercel deploy --prebuilt --prod --skip-domain/u);
  assert.doesNotMatch(deploy, /vercel (?:promote|rollback|alias)|--scope-production-alias/u);
  assert.match(deploy, /Stage-only: no production promotion was attempted\./u);
  assert.ok(
    deploy.indexOf("Resolve exact staged deployment")
      < deploy.indexOf("Gate exact unaliased Custom V2 staged candidate"),
  );
  assert.ok(
    deploy.indexOf("Gate exact unaliased Custom V2 staged candidate")
      < deploy.indexOf("Reverify staged candidate binding"),
  );
});

test("Custom-only changes do not invoke the Bitquery Explore smoke", () => {
  const smoke = stepBlock(deploy, "Smoke staged Bitquery public APIs");
  assert.match(
    smoke,
    /if: >-[\s\S]*verified_custom_v2 != 'true'[\s\S]*verified_interface == 'true'[\s\S]*verified_read_model == 'true'/u,
  );
  assert.match(smoke, /\/api\/explore/u);
  assert.match(smoke, /\/api\/explore\/token\?address=/u);
  assert.match(smoke, /\/api\/explore\/token\/chart\?address=/u);

  for (const retired of [
    "Resolve read-model release policy",
    "Attest exact staged release policy",
    "Preserve staged release attestation",
    "Record staged release attestation",
    "Refresh and prove exact staged durable read model",
    "Smoke staged public market APIs",
    "Gate exact staged operational health",
  ]) {
    assert.equal(deploy.includes(`      - name: ${retired}`), false);
  }
});
