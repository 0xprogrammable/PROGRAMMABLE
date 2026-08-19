import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { runBoundedChildProcess } from "./bounded-child-process-core.mjs";

const TEST_BATCH_COUNT = 2;
const TEST_TIMEOUT_MS = 15 * 60 * 1000;
const TEST_OUTPUT_BYTES = 128 * 1024 * 1024;
const monotonicNow = () => performance.now();

export function createDeterministicTestBatches(testFiles) {
  return Array.from({ length: TEST_BATCH_COUNT }, (_, batchIndex) =>
    testFiles.filter((_, testIndex) => testIndex % TEST_BATCH_COUNT === batchIndex)
  ).filter((batch) => batch.length > 0);
}

export async function runDeterministicTestBatches({
  command,
  cwd,
  env,
  maximumOutputBytes = TEST_OUTPUT_BYTES,
  now = monotonicNow,
  runChildProcess = runBoundedChildProcess,
  testFiles,
  timeoutMs = TEST_TIMEOUT_MS
}) {
  const batches = createDeterministicTestBatches(testFiles);
  const deadline = now() + timeoutMs;
  const results = [];
  let remainingOutputBytes = maximumOutputBytes;

  for (const [batchIndex, batch] of batches.entries()) {
    const timeoutMs = Math.floor(deadline - now());
    if (timeoutMs < 1) {
      return { batches, failure: { batchIndex, kind: "timeout", signal: null, status: null }, results };
    }
    if (remainingOutputBytes < 1) {
      return { batches, failure: { batchIndex, kind: "output", signal: null, status: null }, results };
    }
    const result = await runChildProcess({
      command,
      args: ["--test", "--test-concurrency=2", ...batch],
      cwd,
      env,
      maximumOutputBytes: remainingOutputBytes,
      timeoutMs
    });
    results.push(result);
    if (result.timedOut) return { batches, failure: { ...result, batchIndex, kind: "timeout" }, results };
    if (result.outputExceeded) return { batches, failure: { ...result, batchIndex, kind: "output" }, results };
    if (result.status !== 0) return { batches, failure: { ...result, batchIndex, kind: "status" }, results };
    remainingOutputBytes -= Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
  }
  return { batches, failure: null, results };
}

export async function validateScriptsAndTests({
  errors,
  installedMode,
  relative,
  skillRoot,
  untrustedDataMode,
  walk
}) {
  for (const script of walk(path.join(skillRoot, "scripts")).filter((entry) => entry.stat.isFile() && entry.path.endsWith(".mjs")).map((entry) => entry.path)) {
    const result = childProcess.spawnSync(process.execPath, ["--check", script], { encoding: "utf8", shell: false });
    if (result.status !== 0) errors.push(`${relative(script)}: ${result.stderr.trim()}`);
  }

  const testDirectory = path.join(skillRoot, "scripts", "test");
  if (!untrustedDataMode) {
    const testFiles = fs.readdirSync(testDirectory)
      .filter((name) => name.endsWith(".test.mjs") && (!installedMode || name === "cli.test.mjs"))
      .sort()
      .map((name) => path.join(testDirectory, name));
    const tests = await runDeterministicTestBatches({
      command: process.execPath,
      cwd: skillRoot,
      env: process.env,
      testFiles
    });
    if (tests.failure) {
      const { batchIndex, kind, signal, status, stderr = "", stdout = "" } = tests.failure;
      const shard = `shard ${batchIndex + 1}/${tests.batches.length}`;
      if (kind === "timeout") {
        errors.push(`deterministic tests exceeded the shared 15-minute aggregate bound in ${shard}:\n${stdout}${stderr}`.trim());
      } else if (kind === "output") {
        errors.push(`deterministic tests exceeded the shared 128 MiB aggregate output bound in ${shard}`);
      } else {
        errors.push(`deterministic tests failed in ${shard} (status ${status ?? "null"}, signal ${signal ?? "none"}):\n${stdout}${stderr}`.trim());
      }
    }
  }
}
