import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL(
  "../../.github/workflows/programmable-launch-v4-clean-room.yml",
  import.meta.url,
), "utf8");
const runner = readFileSync(new URL(
  "../programmable-launch-v4-clean-room.mjs",
  import.meta.url,
), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const verifyWorkflow = readFileSync(new URL("../../.github/workflows/verify.yml", import.meta.url), "utf8");

function contractFailures(workflowSource = workflow, runnerSource = runner) {
  const implementation = `${workflowSource}\n${runnerSource}`;
  const required = [
    "github.repository_id == 1314365508",
    "github.ref == 'refs/heads/production'",
    "github.ref_protected == true",
    "github.actor == 'hazarxyz'",
    "github.actor_id == '258789013'",
    "github.triggering_actor == 'hazarxyz'",
    "github.run_attempt == 1",
    "github.event.sender.login == 'hazarxyz'",
    "github.event.sender.id == 258789013",
    "environment: production",
    "runs-on: ubuntu-24.04",
    "timeout-minutes: 30",
    "actions: read",
    "attestations: read",
    "contents: read",
    "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
    "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "persist-credentials: false",
    "fetch-depth: 0",
    "+refs/heads/production:refs/remotes/origin/production",
    "test \"$(git rev-parse refs/remotes/origin/production^{commit})\" = \"$GITHUB_SHA\"",
    "test \"$GITHUB_REF_PROTECTED\" = \"true\"",
    "programmable-launch-v4-clean-room.yml@$GITHUB_REF",
    "test -z \"$(git status --porcelain=v1 --untracked-files=all)\"",
    "node-version: 24.14.0",
    "npm@11.16.0",
    "test -z \"${PROGRAMMABLE_API_KEY:-}\"",
    "PROGRAMMABLE_API_KEY: ${{ secrets.PROGRAMMABLE_V4_CLEAN_ROOM_PRODUCTION_API_KEY }}",
    "programmable-launch-v4-clean-room.mjs prepare",
    "programmable-launch-v4-clean-room.mjs run",
    "programmable-launch-v4-clean-room.mjs verify-evidence",
    "Upload only canonical redacted evidence",
    "path: ${{ runner.temp }}/programmable-launch-v4-clean-room-evidence.json",
    "include-hidden-files: false",
    "overwrite: false",
    "RELEASE_TAG = \"programmable-launch-v4.0.0\"",
    "RELEASE_VERSION = \"4.0.0\"",
    "runCommand(\"gh\", [",
    "\"release\", \"download\", RELEASE_TAG",
    "\"release\", \"verify\", RELEASE_TAG",
    "\"release\", \"verify-asset\", RELEASE_TAG",
    "\"attestation\", \"verify\", assetPath",
    "\"--signer-workflow\", RELEASE_SIGNER_WORKFLOW",
    "\"--source-ref\", PRODUCTION_REF",
    "\"--source-digest\", release.source.commitSha",
    "\"--signer-digest\", release.source.commitSha",
    "\"--deny-self-hosted-runners\"",
    "RELEASE_BYTES_CHANGED_AFTER_VERIFICATION",
    "PREPARE_REFUSES_PROGRAMMABLE_API_KEY",
    "\"pack\", \"--config\"",
    "\"validate\", launchPath, \"--config\", configPath, \"--remote\"",
    "const firstSubmit = await runCli(cliPath, submitArgs",
    "const replaySubmit = await runCli(cliPath, submitArgs",
    "\"status\", firstSubmit.resource?.launchId",
    "\"--api-version\", \"4\", \"--chain-id\", CHAIN_ID",
    "\"--watch\", \"--until\", \"authorized\"",
    "resource?.status === \"wallet_action_required\"",
    "IDEMPOTENCY_LAUNCH_REPLAY_DRIFT",
    "IDEMPOTENCY_REQUEST_DIGEST_REPLAY_DRIFT",
    "walletSignatureObserved: false",
    "transactionBroadcastObserved: false",
    "apiCredentialRecorded: false",
    "rawRequestRecorded: false",
    "rawTransactionRecorded: false",
    "await rm(stateDirectory, { recursive: true, force: true, maxRetries: 3 })",
  ];
  return required.filter((text) => !implementation.includes(text));
}

test("V4 clean-room workflow closes release, credential, replay, and no-broadcast gates", () => {
  assert.deepEqual(contractFailures(), []);
  assert.equal(packageJson.scripts["release:custom-launch:v4:clean-room:test"],
    "node --test scripts/test/programmable-launch-v4-clean-room.test.mjs scripts/test/programmable-launch-v4-clean-room-workflow.test.mjs");
  assert.equal(workflow.includes("actions/attest@"), false);
  assert.equal(workflow.includes("attestations: write"), false);
  assert.equal(workflow.includes("id-token: write"), false);
  assert.equal(workflow.includes("contents: write"), false);
  assert.equal(workflow.includes("gh release create"), false);
  assert.equal(workflow.includes("npm publish"), false);
  assert.equal(workflow.includes("git push"), false);
  assert.equal(workflow.includes("pull_request:"), false);
  assert.equal(workflow.includes("push:"), false);
  assert.equal(workflow.match(/secrets\.PROGRAMMABLE_V4_CLEAN_ROOM_PRODUCTION_API_KEY/gu)?.length, 1);
  assert.match(verifyWorkflow, /Verify V4 clean-room no-broadcast release gate[\s\S]*npm run release:custom-launch:v4:clean-room:test/u);
  assert.ok(
    workflow.indexOf("Fresh-download, attest, install, pack, and validate locally")
      < workflow.indexOf("Remote validate, submit, replay, and stop before wallet signing"),
  );
  assert.ok(runner.indexOf("const firstSubmit") < runner.indexOf("const replaySubmit"));
  assert.ok(runner.indexOf("const replaySubmit") < runner.indexOf("const status"));
});

test("workflow contract mutations fail closed", () => {
  const mutations = [
    workflow.replace("github.ref_protected == true", "true"),
    workflow.replace("github.ref == 'refs/heads/production'", "true"),
    workflow.replace("persist-credentials: false", "persist-credentials: true"),
    workflow.replace("runs-on: ubuntu-24.04", "runs-on: ubuntu-latest"),
    workflow.replace("attestations: read", "attestations: write"),
    workflow.replace("npm@11.16.0", "npm@latest"),
    workflow.replace("test -z \"${PROGRAMMABLE_API_KEY:-}\"", "true"),
    workflow.replace("programmable-launch-v4-clean-room.mjs verify-evidence", "echo trusted"),
    workflow.replace("include-hidden-files: false", "include-hidden-files: true"),
    workflow.replace("overwrite: false", "overwrite: true"),
  ];
  for (const [index, changed] of mutations.entries()) {
    assert.notDeepEqual(contractFailures(changed, runner), [], `workflow mutation ${index} escaped`);
  }
  const runnerMutations = [
    runner.replace("\"--signer-workflow\", RELEASE_SIGNER_WORKFLOW", ""),
    runner.replace("\"--source-digest\", release.source.commitSha", ""),
    runner.replace("const replaySubmit = await runCli(cliPath, submitArgs", "const replaySubmit = firstSubmit; //"),
    runner.replace("resource?.status === \"wallet_action_required\"", "resource?.status !== null"),
    runner.replace("walletSignatureObserved: false", "walletSignatureObserved: true"),
    runner.replace("transactionBroadcastObserved: false", "transactionBroadcastObserved: true"),
  ];
  for (const [index, changed] of runnerMutations.entries()) {
    assert.notDeepEqual(contractFailures(workflow, changed), [], `runner mutation ${index} escaped`);
  }
});
