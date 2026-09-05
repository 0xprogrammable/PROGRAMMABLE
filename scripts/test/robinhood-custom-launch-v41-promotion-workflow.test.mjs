import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "js-yaml";

const source = readFileSync(new URL("../../.github/workflows/finalize-robinhood-custom-launch-v41-promotion.yml", import.meta.url), "utf8");
const workflow = YAML.load(source);
const job = Object.values(workflow.jobs)[0];
const step = (name) => job.steps.find((value) => value.name === name);

test("successor producer isolates its input paths and exact production workflow identity", () => {
  assert.deepEqual(workflow.on.push.branches, ["production"]);
  assert.deepEqual(workflow.on.push.paths, [
    "release/robinhood-chain-4663/v4.1/backend-promotion-input.public.json",
    "release/robinhood-chain-4663/v4.1/backend-promotion-input.attestation.json",
  ]);
  assert.equal(job.environment, "production");
  assert.match(source, /GITHUB_WORKFLOW_REF.*finalize-robinhood-custom-launch-v41-promotion\.yml/u);
  assert.match(source, /test "\$\{#actual_changes\[@\]\}" -eq "\$\{#expected_changes\[@\]\}"/u);
  assert.match(source, /GITHUB_REF_PROTECTED/u);
  assert.match(source, /GITHUB_WORKFLOW_SHA/u);
  assert.doesNotMatch(source, /finalize-robinhood-custom-launch-deployment\.mjs/u);
  assert.equal(source.match(/node contracts\/scripts\/finalize-robinhood-custom-launch-v41-deployment\.mjs/gu)?.length, 3);
});

test("successor retains seven shared Phase A inputs and only its own two backend inputs", () => {
  const run = step("Bind exact tracked portable evidence set").run;
  assert.match(run, /phase_a="\$GITHUB_WORKSPACE\/release\/robinhood-chain-4663"/u);
  assert.match(run, /backend="\$phase_a\/v4\.1"/u);
  assert.match(run, /v4\.1\/backend-promotion-input\.public\.json/u);
  assert.match(run, /v4\.1\/backend-promotion-input\.attestation\.json/u);
  assert.match(run, /test ! -L "\$backend"/u);
  assert.match(run, /find "\$backend" -mindepth 1 -maxdepth 1/u);
  assert.match(run, /git cat-file -e "\$GITHUB_SHA:release\/robinhood-chain-4663\/\$evidence_file"/u);
  assert.match(run, /cmp --silent --/u);
  assert.match(run, /test ! -e "\$backend\/backend-promotion-input\.json"/u);
});

test("successor requires final artifact pins and retains all exact source and attestation guards", () => {
  const gate = step("Require final successor backend artifact pins");
  const verification = step("Verify PROGRAMMABLE bundles and backend Sigstore evidence");
  assert.match(gate.run, /requireRobinhoodV41BackendReleasePins\(\)/u);
  assert.ok(job.steps.indexOf(gate) < job.steps.indexOf(verification));
  assert.equal(verification.env.BACKEND_CAPTURE_CERTIFICATE_IDENTITY, "${{ steps.backend-pins.outputs.certificate_identity }}");
  for (const text of ["--certificate-identity", "--certificate-oidc-issuer",
    "--certificate-github-workflow-sha", "--certificate-github-workflow-trigger",
    "--deny-self-hosted-runners", "--source-digest", "--signer-digest"]) {
    assert.ok(verification.run.includes(text), text);
  }
  assert.match(source, /evidence="\$outputs\/release\/robinhood-chain-4663\/v4\.1"/u);
  assert.match(source, /docs\/operations\/releases\/custom-launch-v4\.1\/cli-release-binding\.json/u);
  assert.doesNotMatch(source, /git (?:push|commit)|gh pr create/u);
  assert.match(source, /Evidence PR merged:.*false/u);
});
