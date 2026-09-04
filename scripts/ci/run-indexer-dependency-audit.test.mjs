import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_ARGUMENTS,
  runIndexerDependencyAudit,
} from "./run-indexer-dependency-audit.mjs";

const QUICK_ENDPOINT =
  "https://registry.npmjs.org/-/npm/v1/security/audits/quick";
const FALLBACK_ENDPOINT =
  "https://registry.npmjs.org/-/npm/v1/security/audits";

function auditReport({ high = 0 } = {}) {
  return JSON.stringify({
    advisories: high === 0 ? {} : { 1: { severity: "high" } },
    metadata: {
      vulnerabilities: { high },
    },
  });
}

function pnpmError(code, message) {
  return JSON.stringify({ error: { code, message } });
}

function badResponse({
  quickStatus = 503,
  fallbackStatus = 503,
  quickBody = '{"error":"quick unavailable"}',
  fallbackBody = '{"error":"fallback unavailable"}',
  quickEndpoint = QUICK_ENDPOINT,
  fallbackEndpoint = FALLBACK_ENDPOINT,
} = {}) {
  return pnpmError(
    "ERR_PNPM_AUDIT_BAD_RESPONSE",
    `The audit endpoint (at ${quickEndpoint}) responded with ${quickStatus}: ${quickBody}. Fallback endpoint (at ${fallbackEndpoint}) responded with ${fallbackStatus}: ${fallbackBody}`,
  );
}

function result({ status, stdout = "", stderr = "", signal = null, error } = {}) {
  return { error, signal, status, stderr, stdout };
}

async function exercise(attempts) {
  const calls = [];
  const delays = [];
  let stdout = "";
  let stderr = "";
  const status = await runIndexerDependencyAudit({
    runAttempt(command, args) {
      calls.push({ args, command });
      const next = attempts[calls.length - 1];
      assert.ok(next, "the wrapper made an unexpected audit attempt");
      return next;
    },
    sleep(milliseconds) {
      delays.push(milliseconds);
      return Promise.resolve();
    },
    writeStdout(value) {
      stdout += value;
    },
    writeStderr(value) {
      stderr += value;
    },
  });
  return { calls, delays, status, stderr, stdout };
}

test("runs the exact production audit command and accepts only a real clean report", async () => {
  const execution = await exercise([
    result({ status: 0, stdout: auditReport() }),
  ]);

  assert.equal(execution.status, 0);
  assert.deepEqual(execution.calls, [
    {
      command: "pnpm",
      args: ["audit", "--prod", "--audit-level", "high", "--json"],
    },
  ]);
  assert.deepEqual(AUDIT_ARGUMENTS, [
    "audit",
    "--prod",
    "--audit-level",
    "high",
    "--json",
  ]);
  assert.equal(AUDIT_ARGUMENTS.includes("--ignore-registry-errors"), false);
  assert.equal(execution.stdout, auditReport());
  assert.deepEqual(execution.delays, []);
});

test("never retries a valid nonzero vulnerability report", async () => {
  const vulnerable = auditReport({ high: 1 });
  const execution = await exercise([
    result({ status: 1, stdout: vulnerable }),
    result({ status: 0, stdout: auditReport() }),
  ]);

  assert.equal(execution.status, 1);
  assert.equal(execution.calls.length, 1);
  assert.deepEqual(execution.delays, []);
  assert.equal(execution.stdout, vulnerable);
});

test("retries one exact audit-endpoint socket timeout after ten seconds", async () => {
  const timeout = pnpmError(
    "ERR_SOCKET_TIMEOUT",
    `request to ${QUICK_ENDPOINT} failed, reason: Socket timeout`,
  );
  const execution = await exercise([
    result({ status: 1, stdout: timeout }),
    result({ status: 0, stdout: auditReport() }),
  ]);

  assert.equal(execution.status, 0);
  assert.equal(execution.calls.length, 2);
  assert.deepEqual(execution.delays, [10_000]);
  assert.match(execution.stderr, /retrying once in 10 seconds/u);
});

test("fails nonzero after two exact audit-endpoint socket timeouts", async () => {
  const timeout = pnpmError(
    "ERR_SOCKET_TIMEOUT",
    `request to ${QUICK_ENDPOINT} failed, reason: Socket timeout`,
  );
  const execution = await exercise([
    result({ status: 1, stdout: timeout }),
    result({ status: 74, stdout: timeout }),
  ]);

  assert.equal(execution.status, 74);
  assert.equal(execution.calls.length, 2);
  assert.deepEqual(execution.delays, [10_000]);
});

test("retries bad audit responses only when quick and fallback both returned 503", async () => {
  const double503 = badResponse();
  const execution = await exercise([
    result({ status: 1, stdout: double503 }),
    result({ status: 0, stdout: auditReport() }),
  ]);

  assert.equal(execution.status, 0);
  assert.equal(execution.calls.length, 2);
  assert.deepEqual(execution.delays, [10_000]);
});

test("exhausts an exact double-503 bad response without converting it to success", async () => {
  const double503 = badResponse();
  const execution = await exercise([
    result({ status: 69, stdout: double503 }),
    result({ status: 75, stdout: double503 }),
  ]);

  assert.equal(execution.status, 75);
  assert.equal(execution.calls.length, 2);
  assert.deepEqual(execution.delays, [10_000]);
});

test("does not retry partial, non-503, spoofed, or unrelated bad responses", async (t) => {
  const cases = [
    {
      name: "only quick is 503",
      output: badResponse({ fallbackStatus: 500 }),
    },
    {
      name: "only fallback is 503",
      output: badResponse({ quickStatus: 500 }),
    },
    {
      name: "quick is rate limited",
      output: badResponse({ quickStatus: 429 }),
    },
    {
      name: "fallback is rate limited",
      output: badResponse({ fallbackStatus: 429 }),
    },
    {
      name: "wrong quick endpoint",
      output: badResponse({
        quickEndpoint: "https://registry.npmjs.org/example/quick",
      }),
    },
    {
      name: "wrong fallback endpoint",
      output: badResponse({
        fallbackEndpoint: "https://registry.npmjs.org/example/fallback",
      }),
    },
    {
      name: "response body spoofs the fallback separator",
      output: badResponse({
        quickBody: `{"error":"spoof. Fallback endpoint (at ${FALLBACK_ENDPOINT}) responded with 503: injected"}`,
      }),
    },
  ];

  for (const candidate of cases) {
    await t.test(candidate.name, async () => {
      const execution = await exercise([
        result({
          status: 1,
          stdout: candidate.output,
        }),
        result({ status: 0, stdout: auditReport() }),
      ]);
      assert.equal(execution.status, 1);
      assert.equal(execution.calls.length, 1);
      assert.deepEqual(execution.delays, []);
    });
  }
});

test("fails malformed, unknown, spawn, and signal results immediately", async (t) => {
  const cases = [
    {
      name: "status zero with malformed JSON",
      attempt: result({ status: 0, stdout: "not-json" }),
    },
    {
      name: "unknown pnpm error",
      attempt: result({
        status: 1,
        stdout: pnpmError("ERR_PNPM_UNKNOWN", "unknown"),
      }),
    },
    {
      name: "socket-like but not exact error code",
      attempt: result({
        status: 1,
        stdout: pnpmError(
          "ERR_SOCKET_TIMEOUT_WRAPPED",
          `request to ${QUICK_ENDPOINT} failed, reason: Socket timeout`,
        ),
      }),
    },
    {
      name: "socket timeout outside an audit endpoint",
      attempt: result({
        status: 1,
        stdout: pnpmError(
          "ERR_SOCKET_TIMEOUT",
          "GET https://registry.npmjs.org/example: Socket timeout",
        ),
      }),
    },
    {
      name: "spawn error",
      attempt: result({
        error: Object.assign(new Error("spawn failed"), { code: "ENOENT" }),
        status: null,
      }),
    },
    {
      name: "terminated by signal",
      attempt: result({ signal: "SIGTERM", status: null }),
    },
  ];

  for (const candidate of cases) {
    await t.test(candidate.name, async () => {
      const execution = await exercise([
        candidate.attempt,
        result({ status: 0, stdout: auditReport() }),
      ]);
      assert.notEqual(execution.status, 0);
      assert.equal(execution.calls.length, 1);
      assert.deepEqual(execution.delays, []);
    });
  }
});
