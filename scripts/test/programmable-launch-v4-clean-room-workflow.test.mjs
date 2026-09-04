import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

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
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26",
    "persist-credentials: false",
    "fetch-depth: 0",
    "+refs/heads/production:refs/remotes/origin/production",
    "test \"$(git rev-parse refs/remotes/origin/production^{commit})\" = \"$GITHUB_SHA\"",
    "Reconfirm protected production tip immediately before credential use",
    "test \"$GITHUB_REF_PROTECTED\" = \"true\"",
    "programmable-launch-v4-clean-room.yml@$GITHUB_REF",
    "test -z \"$(git status --porcelain=v1 --untracked-files=all)\"",
    "node-version: 24.14.0",
    "npm@11.16.0",
    "Install exact protected-source verifier dependencies without credentials",
    "npm ci --ignore-scripts --no-audit --no-fund",
    "test -z \"${PROGRAMMABLE_API_KEY:-}\"",
    "PROGRAMMABLE_API_KEY: ${{ secrets.PROGRAMMABLE_V4_CLEAN_ROOM_PRODUCTION_API_KEY }}",
    "PROGRAMMABLE_CLEAN_ROOM_ENVIRONMENT: production",
    "programmable-launch-v4-clean-room.mjs prepare",
    "programmable-launch-v4-clean-room.mjs run",
    "programmable-launch-v4-clean-room.mjs verify-evidence",
    "programmable-launch-v4-clean-room.mjs verify-recovery",
    "--recovery-output \"$RUNNER_TEMP/programmable-launch-v4-clean-room-recovery.json\"",
    "Upload only canonical redacted evidence",
    "path: ${{ runner.temp }}/programmable-launch-v4-clean-room-evidence.json",
    "include-hidden-files: false",
    "overwrite: false",
    "Upload canonical redacted recovery on success or later failure",
    "Attest canonical redacted recovery without production credentials",
    "create-storage-record: true",
    "RELEASE_TAG = \"programmable-launch-v4.0.0\"",
    "RELEASE_VERSION = \"4.0.0\"",
    "REVIEWED_RELEASE_COORDINATE_PATH",
    "V4_RELEASE_BINDING_NOT_READY",
    "REVIEWED_RELEASE_COORDINATE_BLOCKED",
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
    "transactionCalldataRecorded: false",
    "producerProvenanceFromEnvironment",
    "buildCleanRoomRecoveryReceipt",
    "await writeFile(recoveryOutput, canonicalJsonBytes(recovery)",
    "await rm(stateDirectory, { recursive: true, force: true, maxRetries: 3 })",
  ];
  const failures = required.filter((text) => !implementation.includes(text));
  try {
    const parsed = yaml.load(workflowSource);
    const clean = parsed.jobs["clean-room"];
    assert.deepEqual(clean.permissions, { actions: "read", attestations: "read", contents: "read" });
    assert.equal(clean.environment, "production");
    assert.equal(clean.steps.find(step => step.uses?.startsWith("actions/checkout@"))
      .with["persist-credentials"], false);
    assert.ok(clean.steps.find(step => step.name === "Set up exact npm").run.includes("npm@11.16.0"));
    assert.equal(clean.outputs["evidence-artifact-id"], "${{ steps.upload-evidence.outputs.artifact-id }}");
    for (const id of ["provenance", "evidence-provenance"]) {
      const job = parsed.jobs[id];
      assert.equal(job.environment, undefined);
      assert.equal(JSON.stringify(job).includes("secrets."), false);
      assert.deepEqual(job.permissions, { actions: "read", attestations: "write", contents: "read", "id-token": "write" });
      assert.equal(job.steps.find(step => step.uses?.startsWith("actions/attest@"))
        .with["create-storage-record"], true);
    }
    const success = parsed.jobs["evidence-provenance"];
    assert.equal(success.if, "${{ needs.clean-room.result == 'success' }}");
    assert.equal(success.needs, "clean-room");
    const download = success.steps.find(step => step.uses?.startsWith("actions/download-artifact@"));
    assert.equal(download.with["artifact-ids"], "${{ needs.clean-room.outputs.evidence-artifact-id }}");
    assert.equal(download.with["digest-mismatch"], "error");
    assert.equal(download.with["run-id"], undefined);
    const validation = success.steps.find(step => step.name === "Reverify canonical successful evidence and exact producer binding").run;
    assert.ok(validation.includes("await verifyEvidenceFile("));
    assert.ok(validation.includes("assert.deepEqual(evidence.producer,"));
    assert.ok(validation.includes("workflowSha: process.env.GITHUB_WORKFLOW_SHA"));
    assert.ok(validation.includes("EVIDENCE_PRODUCER_BINDING_MISMATCH"));
  } catch (error) { failures.push(`workflow job boundary: ${error.message}`); }
  return failures;
}

test("V4 clean-room workflow closes release, credential, replay, and no-broadcast gates", () => {
  assert.deepEqual(contractFailures(), []);
  assert.equal(packageJson.scripts["release:custom-launch:v4:clean-room:test"],
    "node --test scripts/test/programmable-launch-v4-clean-room.test.mjs scripts/test/programmable-launch-v4-clean-room-workflow.test.mjs");
  const provenanceJob = workflow.slice(workflow.indexOf("\n  provenance:"), workflow.indexOf("\n  evidence-provenance:"));
  const evidenceJob = workflow.slice(workflow.indexOf("\n  evidence-provenance:"));
  assert.equal(evidenceJob.includes("secrets."), false);
  assert.equal(evidenceJob.includes("environment: production"), false);
  assert.match(evidenceJob, /needs.clean-room.result == 'success'/u);
  assert.match(evidenceJob, /verifyEvidenceFile/u);
  assert.match(evidenceJob, /EVIDENCE_PRODUCER_BINDING_MISMATCH/u);
  assert.match(evidenceJob, /artifact-ids: \$\{\{ needs.clean-room.outputs.evidence-artifact-id \}\}/u);
  assert.match(evidenceJob, /evidence-attestation-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/u);
  const cleanRoomJob = workflow.slice(0, workflow.indexOf("\n  provenance:"));
  assert.equal(cleanRoomJob.includes("actions/attest@"), false);
  assert.equal(cleanRoomJob.includes("attestations: write"), false);
  assert.equal(cleanRoomJob.includes("id-token: write"), false);
  assert.equal(workflow.includes("contents: write"), false);
  assert.equal(workflow.includes("gh release create"), false);
  assert.equal(workflow.includes("npm publish"), false);
  assert.equal(workflow.includes("git push"), false);
  assert.equal(workflow.includes("pull_request:"), false);
  assert.equal(workflow.includes("push:"), false);
  assert.equal(workflow.match(/secrets\.PROGRAMMABLE_V4_CLEAN_ROOM_PRODUCTION_API_KEY/gu)?.length, 1);
  assert.equal(provenanceJob.includes("PROGRAMMABLE_API_KEY"), false);
  assert.match(provenanceJob, /attestations: write/u);
  assert.match(provenanceJob, /id-token: write/u);
  assert.match(verifyWorkflow, /Verify V4 clean-room no-broadcast release gate[\s\S]*npm run release:custom-launch:v4:clean-room:test/u);
  assert.ok(
    workflow.indexOf("Fresh-download, attest, install, pack, and validate locally")
      < workflow.indexOf("Remote validate, submit, replay, and stop before wallet signing"),
  );
  assert.ok(runner.indexOf("const firstSubmit") < runner.indexOf("const replaySubmit"));
  assert.ok(runner.indexOf("const replaySubmit") < runner.indexOf("const status"));
  assert.ok(
    runner.indexOf("recovery = buildCleanRoomRecoveryReceipt")
      < runner.indexOf("const replaySubmit = await runCli"),
  );
  assert.ok(
    runner.indexOf("await writeFile(recoveryOutput, canonicalJsonBytes(recovery)")
      < runner.indexOf("const replaySubmit = await runCli"),
  );
});

test("workflow contract mutations fail closed", () => {
  const mutations = [
    workflow.replace("github.ref_protected == true", "true"),
    workflow.replace("github.ref == 'refs/heads/production'", "true"),
    workflow.replace("persist-credentials: false", "persist-credentials: true"),
    workflow.replaceAll("runs-on: ubuntu-24.04", "runs-on: ubuntu-latest"),
    workflow.replace("attestations: read", "attestations: write"),
    workflow.replace("npm@11.16.0", "npm@latest"),
    workflow.replaceAll("test -z \"${PROGRAMMABLE_API_KEY:-}\"", "true"),
    workflow.replace("programmable-launch-v4-clean-room.mjs verify-evidence", "echo trusted"),
    workflow.replaceAll("include-hidden-files: false", "include-hidden-files: true"),
    workflow.replaceAll("overwrite: false", "overwrite: true"),
    workflow.replace("Reconfirm protected production tip immediately before credential use", "Skip tip"),
    workflow.replace("verify-recovery", "echo recovery"),
    workflow.replace("create-storage-record: true", "create-storage-record: false"),
    workflow.replace("needs.clean-room.result == 'success'", "always()"),
    workflow.replace("digest-mismatch: error", "digest-mismatch: warn"),
    workflow.replace("assert.deepEqual(evidence.producer,", "assert.ok(true, //"),
    workflow.replace("artifact-ids: ${{ needs.clean-room.outputs.evidence-artifact-id }}", "name: any-evidence"),
  ];
  for (const [index, changed] of mutations.entries()) {
    assert.notDeepEqual(contractFailures(changed, runner), [], `workflow mutation ${index} escaped`);
  }
  const runnerMutations = [
    runner.replace("\"--signer-workflow\", RELEASE_SIGNER_WORKFLOW", ""),
    runner.replace("\"--source-digest\", release.source.commitSha", ""),
    runner.replace("const replaySubmit = await runCli(cliPath, submitArgs", "const replaySubmit = firstSubmit; //"),
    runner.replace("resource?.status === \"wallet_action_required\"", "resource?.status !== null"),
    runner.replaceAll("walletSignatureObserved: false", "walletSignatureObserved: true"),
    runner.replaceAll("transactionBroadcastObserved: false", "transactionBroadcastObserved: true"),
    runner.replace("await writeFile(recoveryOutput, canonicalJsonBytes(recovery)", "await Promise.resolve("),
  ];
  for (const [index, changed] of runnerMutations.entries()) {
    assert.notDeepEqual(contractFailures(workflow, changed), [], `runner mutation ${index} escaped`);
  }
});
