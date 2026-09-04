import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUDIT_ARGUMENTS,
  runProductionDependencyAudit,
} from "./run-production-dependency-audit.mjs";

const BULK_ENDPOINT =
  "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const packageJson = JSON.parse(readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
));
const verifyWorkflow = readFileSync(
  new URL("../../.github/workflows/verify.yml", import.meta.url),
  "utf8",
);

function auditReport({ low = 0, moderate = 0, high = 0, critical = 0 } = {}) {
  const vulnerabilities = {};
  for (const [severity, count] of Object.entries({ low, moderate, high, critical })) {
    for (let index = 0; index < count; index += 1) {
      vulnerabilities[`${severity}-${index}`] = {
        name: `${severity}-${index}`,
        severity,
      };
    }
  }
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: {
        info: 0,
        low,
        moderate,
        high,
        critical,
        total: low + moderate + high + critical,
      },
      dependencies: {
        prod: 10,
        dev: 5,
        optional: 1,
        peer: 0,
        peerOptional: 0,
        total: 16,
      },
    },
  });
}

function npm503({
  endpoint = BULK_ENDPOINT,
  method = "POST",
  statusCode = 503,
  message = `503 Service Unavailable - POST ${BULK_ENDPOINT} - Service Unavailable`,
  body = { error: "Service Unavailable" },
  error = { summary: "", detail: "" },
} = {}) {
  return JSON.stringify({
    message,
    method,
    uri: endpoint,
    headers: { "content-type": "application/json" },
    statusCode,
    body,
    error,
  });
}

function npmTimeout({
  endpoint = BULK_ENDPOINT,
  message,
  error = { summary: "", detail: "" },
} = {}) {
  return JSON.stringify({
    message: message ?? `network timeout at: ${endpoint}`,
    error,
  });
}

function result({ status, stdout = "", stderr = "", signal = null, error } = {}) {
  return { error, signal, status, stderr, stdout };
}

async function exercise(attempts) {
  const calls = [];
  const delays = [];
  let stdout = "";
  let stderr = "";
  const status = await runProductionDependencyAudit({
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

test("runs the exact npm production audit and accepts only a clean report", async () => {
  const clean = auditReport({ low: 2 });
  const execution = await exercise([result({ status: 0, stdout: clean })]);

  assert.equal(execution.status, 0);
  assert.deepEqual(execution.calls, [{ command: "npm", args: [
    "audit",
    "--omit=dev",
    "--audit-level=moderate",
    "--json",
  ] }]);
  assert.deepEqual(AUDIT_ARGUMENTS, [
    "audit",
    "--omit=dev",
    "--audit-level=moderate",
    "--json",
  ]);
  assert.equal(AUDIT_ARGUMENTS.includes("--ignore-registry-errors"), false);
  assert.equal(
    packageJson.scripts["audit:prod"],
    "node scripts/ci/run-production-dependency-audit.mjs",
  );
  assert.match(
    verifyWorkflow,
    /Audit production dependencies[\s\S]*?node --test scripts\/ci\/run-production-dependency-audit\.test\.mjs\n\s+npm run audit:prod/u,
  );
  assert.equal(execution.stdout, clean);
  assert.deepEqual(execution.delays, []);
});

test("never retries a valid nonzero vulnerability report", async () => {
  const vulnerable = auditReport({ moderate: 1 });
  const execution = await exercise([
    result({ status: 1, stdout: vulnerable }),
    result({ status: 0, stdout: auditReport() }),
  ]);

  assert.equal(execution.status, 1);
  assert.equal(execution.calls.length, 1);
  assert.deepEqual(execution.delays, []);
  assert.equal(execution.stdout, vulnerable);
});

test("rejects a threshold vulnerability even if npm returns zero", async () => {
  const execution = await exercise([
    result({ status: 0, stdout: auditReport({ high: 1 }) }),
    result({ status: 0, stdout: auditReport() }),
  ]);

  assert.equal(execution.status, 1);
  assert.equal(execution.calls.length, 1);
  assert.deepEqual(execution.delays, []);
});

test("rejects a low-only report when npm itself returns nonzero", async () => {
  const execution = await exercise([
    result({ status: 1, stdout: auditReport({ low: 1 }) }),
    result({ status: 0, stdout: auditReport() }),
  ]);

  assert.equal(execution.status, 1);
  assert.equal(execution.calls.length, 1);
  assert.deepEqual(execution.delays, []);
});

test("retries one exact official bulk-endpoint 503 after ten seconds", async () => {
  const execution = await exercise([
    result({ status: 1, stdout: npm503() }),
    result({ status: 0, stdout: auditReport() }),
  ]);

  assert.equal(execution.status, 0);
  assert.equal(execution.calls.length, 2);
  assert.deepEqual(execution.delays, [10_000]);
  assert.match(execution.stderr, /retrying once in 10 seconds/u);
});

test("retries one exact official bulk-endpoint timeout after ten seconds", async () => {
  const execution = await exercise([
    result({ status: 1, stdout: npmTimeout() }),
    result({ status: 0, stdout: auditReport() }),
  ]);

  assert.equal(execution.status, 0);
  assert.equal(execution.calls.length, 2);
  assert.deepEqual(execution.delays, [10_000]);
});

test("transport exhaustion remains nonzero", async () => {
  const execution = await exercise([
    result({ status: 69, stdout: npm503() }),
    result({ status: 75, stdout: npmTimeout() }),
  ]);

  assert.equal(execution.status, 75);
  assert.equal(execution.calls.length, 2);
  assert.deepEqual(execution.delays, [10_000]);
  assert.match(execution.stderr, /exhausted its single retry/u);
});

test("does not retry non-503, spoofed, or unrelated transport output", async (t) => {
  const extraField503 = JSON.parse(npm503());
  extraField503.unexpected = true;
  const missingField503 = JSON.parse(npm503());
  delete missingField503.headers;
  const cases = [
    ["server error", npm503({ statusCode: 500 })],
    ["gateway timeout", npm503({ statusCode: 504 })],
    ["rate limit", npm503({ statusCode: 429 })],
    ["wrong endpoint", npm503({ endpoint: "https://registry.npmjs.org/example" })],
    ["wrong scheme", npm503({ endpoint: "http://registry.npmjs.org/-/npm/v1/security/advisories/bulk" })],
    ["wrong host", npm503({ endpoint: "https://registry.example/-/npm/v1/security/advisories/bulk" })],
    ["query-bearing endpoint", npm503({ endpoint: `${BULK_ENDPOINT}?retry=true` })],
    ["wrong method", npm503({ method: "GET" })],
    ["wrong message", npm503({ message: "503 Service Unavailable" })],
    ["wrong body", npm503({ body: { error: "temporarily unavailable" } })],
    ["extra error field", npm503({ error: { summary: "", detail: "", code: "E503" } })],
    ["extra envelope field", JSON.stringify(extraField503)],
    ["missing envelope field", JSON.stringify(missingField503)],
    ["timeout outside bulk endpoint", npmTimeout({
      endpoint: "https://registry.npmjs.org/example",
    })],
    ["timeout-like message", npmTimeout({ message: `socket timeout at: ${BULK_ENDPOINT}` })],
    ["unobserved no-colon timeout", npmTimeout({
      message: `network timeout at ${BULK_ENDPOINT}`,
    })],
  ];

  for (const [name, output] of cases) {
    await t.test(name, async () => {
      const execution = await exercise([
        result({ status: 1, stdout: output }),
        result({ status: 0, stdout: auditReport() }),
      ]);
      assert.equal(execution.status, 1);
      assert.equal(execution.calls.length, 1);
      assert.deepEqual(execution.delays, []);
    });
  }
});

test("fails malformed reports, unknown errors, spawn errors, and signals immediately", async (t) => {
  const malformedReport = JSON.parse(auditReport());
  delete malformedReport.metadata.dependencies.total;
  const inconsistentCounts = JSON.parse(auditReport({ low: 1 }));
  inconsistentCounts.metadata.vulnerabilities.total = 2;
  const cases = [
    ["status zero without JSON", result({ status: 0, stdout: "not-json" })],
    ["status zero with transport JSON", result({ status: 0, stdout: npm503() })],
    ["malformed audit report", result({ status: 0, stdout: JSON.stringify(malformedReport) })],
    ["inconsistent audit counts", result({
      status: 0,
      stdout: JSON.stringify(inconsistentCounts),
    })],
    ["unknown JSON error", result({ status: 1, stdout: JSON.stringify({ error: "unknown" }) })],
    ["clean report plus spawn error", result({
      error: Object.assign(new Error("spawn failed"), { code: "EIO" }),
      status: 0,
      stdout: auditReport(),
    })],
    ["clean report plus signal", result({
      signal: "SIGTERM",
      status: 0,
      stdout: auditReport(),
    })],
    ["spawn error", result({
      error: Object.assign(new Error("spawn failed"), { code: "ENOENT" }),
      status: null,
    })],
    ["terminated by signal", result({ signal: "SIGTERM", status: null })],
  ];

  for (const [name, attempt] of cases) {
    await t.test(name, async () => {
      const execution = await exercise([
        attempt,
        result({ status: 0, stdout: auditReport() }),
      ]);
      assert.notEqual(execution.status, 0);
      assert.equal(execution.calls.length, 1);
      assert.deepEqual(execution.delays, []);
    });
  }
});
