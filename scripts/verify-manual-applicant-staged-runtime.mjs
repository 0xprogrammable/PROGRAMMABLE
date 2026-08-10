#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const ROUTE = "/api/custom-launch/manual/submissions";
const AUTHENTICATION_PROBE = Object.freeze({
  schemaVersion: "programmable.manual-router-applicant-list-request.v1",
  launchWallet: "0x1111111111111111111111111111111111111111",
});
const CHECKS = Object.freeze([
  Object.freeze({
    route: ROUTE,
    status: 400,
    code: "invalid_request",
    body: "{}",
  }),
  Object.freeze({
    route: ROUTE,
    status: 401,
    code: "applicant_authentication_required",
    body: JSON.stringify(AUTHENTICATION_PROBE),
  }),
  Object.freeze({
    route: "/api/custom-launch/manual/route-acceptance",
    status: 401,
    code: "session_required",
    body: "{}",
  }),
]);

export async function verifyManualApplicantStagedRuntime({
  targetUrl,
  bypassSecret,
  fetchImpl = fetch,
  attempts = 12,
  retryDelayMs = 5_000,
}) {
  const origin = new URL(targetUrl);
  if (
    origin.protocol !== "https:"
    || !origin.hostname.endsWith(".vercel.app")
    || origin.pathname !== "/"
    || origin.search !== ""
    || origin.hash !== ""
  ) throw new Error("manual Applicant stage target is not an exact Vercel origin");
  const bypassLength = Buffer.byteLength(bypassSecret ?? "", "utf8");
  if (
    typeof bypassSecret !== "string"
    || bypassLength < 32
    || bypassLength > 512
    || /[\r\n]/u.test(bypassSecret)
  ) throw new Error("manual Applicant stage bypass is unavailable");
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 12) {
    throw new Error("manual Applicant stage attempts are invalid");
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const observed = [];
      for (const check of CHECKS) {
        const result = await postProbe(
          fetchImpl,
          origin,
          bypassSecret,
          check.route,
          check.body,
        );
        assertTypedError(result, check.status, check.code);
        observed.push(result);
      }
      const [invalid, unauthenticated, acceptance] = observed;
      return Object.freeze({
        status: "verified",
        route: ROUTE,
        httpStatus: invalid.response.status,
        code: invalid.body.code,
        authenticationHttpStatus: unauthenticated.response.status,
        authenticationCode: unauthenticated.body.code,
        acceptanceHttpStatus: acceptance.response.status,
        acceptanceCode: acceptance.body.code,
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastError ?? new Error("manual Applicant staged authority preflight failed");
}

async function postProbe(fetchImpl, origin, bypassSecret, route, body) {
  const response = await fetchImpl(new URL(route, origin), {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-vercel-protection-bypass": bypassSecret,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const responseText = await response.text();
  if (Buffer.byteLength(responseText, "utf8") > 4_096) {
    throw new Error("manual Applicant stage response is oversized");
  }
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("manual Applicant stage response is not JSON");
  }
  return Object.freeze({ response, body: parsed });
}

function assertTypedError(observed, status, code) {
  const { response, body } = observed;
  if (
    response.status !== status
    || response.headers.get("content-type") !== "application/json; charset=utf-8"
    || !response.headers.get("cache-control")?.startsWith("no-store")
    || body === null
    || typeof body !== "object"
    || Array.isArray(body)
    || Object.keys(body).sort().join("\0")
      !== "code\0message\0retryable\0schemaVersion"
    || body.schemaVersion !== "programmable.manual-router-website-error.v1"
    || body.code !== code
    || body.message !== code
    || body.retryable !== false
  ) throw new Error("manual Applicant staged authority preflight failed");
}

function argumentsFrom(argv) {
  if (
    argv.length !== 2
    || argv[0] !== "--target-url"
    || !argv[1]
    || argv[1].startsWith("--")
  ) throw new Error("--target-url is required");
  return Object.freeze({ targetUrl: argv[1] });
}

async function main(argv) {
  const args = argumentsFrom(argv);
  const result = await verifyManualApplicantStagedRuntime({
    targetUrl: args.targetUrl,
    bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "manual Applicant stage failed"}\n`,
    );
    process.exitCode = 1;
  });
}
