import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import yaml from "js-yaml";
import { buildCleanRoomEvidence, buildCleanRoomRecoveryReceipt, canonicalJsonBytes } from "../programmable-launch-v41-clean-room.mjs";
import { validCleanRoomTranscriptV41 } from "./fixtures/programmable-launch-v41-clean-room.mjs";

const workflow = readFileSync(new URL("../../.github/workflows/programmable-launch-v41-clean-room.yml", import.meta.url), "utf8");

function verifyWorkflow(source) {
  const parsed = yaml.load(source);
  assert.deepEqual(Object.keys(parsed.on), ["workflow_dispatch"]);
  for (const name of ["initial_buy_wei", "minimum_tokens_out", "max_gas_cost_wei"]) {
    const budget = parsed.on.workflow_dispatch.inputs[name];
    assert.equal(budget.type, "string");
    assert.equal(budget.required, true);
    assert.equal(budget.default, undefined);
  }
  const job = parsed.jobs["clean-room"];
  for (const guard of ["github.repository_id == 1314365508", "github.ref == 'refs/heads/production'",
    "github.ref_protected == true", "github.actor == 'hazarxyz'", "github.actor_id == '258789013'",
    "github.triggering_actor == 'hazarxyz'", "github.run_attempt == 1", "github.event.sender.id == 258789013"])
    assert.ok(job.if.includes(guard), guard);
  assert.equal(job.environment, "production");
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.deepEqual(job.permissions, { actions: "read", attestations: "read", contents: "read" });
  const checkout = job.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with["fetch-depth"], 0);
  const prepare = job.steps.find(step => step.name === "Fresh-download, attest, install, pack, and validate locally");
  assert.equal(prepare.env.MINIMUM_TOKENS_OUT, "${{ inputs.minimum_tokens_out }}");
  assert.ok(prepare.run.includes('--minimum-tokens-out "$MINIMUM_TOKENS_OUT"'));
  assert.equal(prepare.env.INITIAL_BUY_WEI, "${{ inputs.initial_buy_wei }}");
  assert.ok(prepare.run.includes('--initial-buy-wei "$INITIAL_BUY_WEI"'));
  assert.equal(prepare.env.MAX_GAS_COST_WEI, "${{ inputs.max_gas_cost_wei }}");
  assert.ok(prepare.run.includes('--max-gas-cost-wei "$MAX_GAS_COST_WEI"'));
  assert.ok(prepare.run.includes('test -z "${PROGRAMMABLE_API_KEY:-}"'));
  const reconfirm = job.steps.findIndex(step => step.name === "Reconfirm protected production tip immediately before credential use");
  const run = job.steps.findIndex(step => step.name === "Remote validate, submit, replay, and stop before wallet signing");
  assert.equal(run, reconfirm + 1);
  assert.ok(job.steps[reconfirm].run.includes('test "$(git rev-parse refs/remotes/origin/production^{commit})" = "$GITHUB_SHA"'));
  assert.equal(source.match(/secrets\.PROGRAMMABLE_V4_CLEAN_ROOM_PRODUCTION_API_KEY/gu)?.length, 1);
  assert.equal(job.steps[run].env.PROGRAMMABLE_API_KEY, "${{ secrets.PROGRAMMABLE_V4_CLEAN_ROOM_PRODUCTION_API_KEY }}");
  assert.equal(source.includes("https://api.programmable.market/v3/"), false);
  assert.equal(source.includes("PLATFORM_KEY_DUAL_CHAIN_CHECK_FAILED"), false);
  for (const id of ["provenance", "evidence-provenance"]) {
    const attestation = parsed.jobs[id];
    assert.equal(attestation.environment, undefined);
    assert.equal(JSON.stringify(attestation).includes("secrets."), false);
    assert.deepEqual(attestation.permissions, { actions: "read", attestations: "write", contents: "read", "id-token": "write" });
  }
  const evidence = parsed.jobs["evidence-provenance"];
  assert.equal(evidence.if, "${{ needs.clean-room.result == 'success' }}");
  const download = evidence.steps.find(step => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(download.with["artifact-ids"], "${{ needs.clean-room.outputs.evidence-artifact-id }}");
  assert.equal(download.with["digest-mismatch"], "error");
  const validation = evidence.steps.find(step => step.name === "Reverify canonical successful evidence and exact producer binding");
  for (const binding of ["await verifyEvidenceFile(", "assert.deepEqual({ ...evidence.producer },",
    'schemaVersion: "programmable.launch-v4-clean-room-producer.v2"', "workflowSha: process.env.GITHUB_WORKFLOW_SHA",
    "EVIDENCE_PRODUCER_BINDING_MISMATCH"]) assert.ok(validation.run.includes(binding), binding);
  for (const candidate of Object.values(parsed.jobs)) for (const step of candidate.steps ?? []) {
    if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/u);
  }
}

test("4.1 workflow isolates the production key, preserves exact producer attestation and requires explicit buy, minimum output and gas budgets", () => {
  verifyWorkflow(workflow);
  for (const [before, after] of [
    ["github.ref_protected == true", "true"],
    ["persist-credentials: false", "persist-credentials: true"],
    ["max_gas_cost_wei:\n", "ignored_gas_cost_wei:\n"],
    ["initial_buy_wei:\n", "ignored_initial_buy_wei:\n"],
    ["minimum_tokens_out:\n", "ignored_minimum_tokens_out:\n"],
    ["needs.clean-room.result == 'success'", "always()"],
    ["digest-mismatch: error", "digest-mismatch: warn"],
    ["artifact-ids: ${{ needs.clean-room.outputs.evidence-artifact-id }}", "name: unbound-evidence"],
    ["assert.deepEqual({ ...evidence.producer },", "assert.ok(true, //"],
  ]) assert.throws(() => verifyWorkflow(workflow.replace(before, after)), undefined, before);
});

test("4.0 proof-bound runner and workflow bytes remain frozen", () => {
  for (const [relative, expected] of [
    ["../programmable-launch-v4-clean-room.mjs", "77319589bcc9f60a29f7572f428eca497c94d421697b23731091c606b258cd4a"],
    ["../../.github/workflows/programmable-launch-v4-clean-room.yml", "b5912c7934b23aae2efb9bccd6b7d7afd28a2c73fc57c6a9de80357ecc778199"],
  ]) assert.equal(createHash("sha256").update(readFileSync(new URL(relative, import.meta.url))).digest("hex"), expected);
});

test("the actual 4.1 attestation step revalidates canonical evidence and rejects a different workflow producer", () => {
  const step = yaml.load(workflow).jobs["evidence-provenance"].steps.find(
    item => item.name === "Reverify canonical successful evidence and exact producer binding");
  const source = step.run.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\nNODE/u)?.[1];
  assert.ok(source);
  const input = validCleanRoomTranscriptV41();
  input.recovery = buildCleanRoomRecoveryReceipt(input);
  const evidence = buildCleanRoomEvidence(input);
  const producer = evidence.producer;
  const temp = mkdtempSync(path.join(os.tmpdir(), "programmable-v41-provenance-step-"));
  try {
    const directory = path.join(temp, "programmable-launch-v41-clean-room-evidence");
    mkdirSync(directory);
    writeFileSync(path.join(directory, "programmable-launch-v41-clean-room-evidence.json"), canonicalJsonBytes(evidence));
    const env = { RUNNER_TEMP: temp, GITHUB_REPOSITORY: producer.repository,
      GITHUB_REPOSITORY_ID: producer.repositoryId, GITHUB_WORKFLOW_REF: producer.workflowRef,
      GITHUB_SHA: producer.sourceSha, GITHUB_WORKFLOW_SHA: producer.workflowSha,
      GITHUB_RUN_ID: producer.runId, GITHUB_RUN_ATTEMPT: producer.runAttempt,
      GITHUB_ACTOR: producer.actor, GITHUB_ACTOR_ID: producer.actorId };
    const options = { cwd: fileURLToPath(new URL("../../", import.meta.url)), env,
      stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 };
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--input-type=module", "-e", source], options));
    assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      ...options, env: { ...env, GITHUB_WORKFLOW_SHA: "f".repeat(40) },
    }), /EVIDENCE_PRODUCER_BINDING_MISMATCH/u);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
