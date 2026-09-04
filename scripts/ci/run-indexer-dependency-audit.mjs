import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const AUDIT_ARGUMENTS = Object.freeze([
  "audit",
  "--prod",
  "--audit-level",
  "high",
  "--json",
]);

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MILLISECONDS = 10_000;
const QUICK_ENDPOINT =
  "https://registry.npmjs.org/-/npm/v1/security/audits/quick";
const FALLBACK_ENDPOINT =
  "https://registry.npmjs.org/-/npm/v1/security/audits";
const BAD_RESPONSE_PREFIX =
  `The audit endpoint (at ${QUICK_ENDPOINT}) responded with `;
const BAD_RESPONSE_SEPARATOR =
  `. Fallback endpoint (at ${FALLBACK_ENDPOINT}) responded with `;

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isAuditReport(value) {
  return isPlainObject(value)
    && isPlainObject(value.advisories)
    && isPlainObject(value.metadata);
}

function pnpmErrorFrom(value) {
  if (!isPlainObject(value) || Object.keys(value).length !== 1) return undefined;
  const error = value.error;
  if (
    !isPlainObject(error)
    || Object.keys(error).sort().join(",") !== "code,message"
    || typeof error.code !== "string"
    || typeof error.message !== "string"
  ) {
    return undefined;
  }
  return error;
}

function isExactSocketTimeout(error) {
  if (error.code !== "ERR_SOCKET_TIMEOUT") return false;
  return error.message ===
    `request to ${QUICK_ENDPOINT} failed, reason: Socket timeout`;
}

function isExactDouble503(error) {
  if (
    error.code !== "ERR_PNPM_AUDIT_BAD_RESPONSE"
    || !error.message.startsWith(BAD_RESPONSE_PREFIX)
  ) {
    return false;
  }
  const tail = error.message.slice(BAD_RESPONSE_PREFIX.length);
  const separatorIndex = tail.indexOf(BAD_RESPONSE_SEPARATOR);
  if (
    separatorIndex < 0
    || separatorIndex !== tail.lastIndexOf(BAD_RESPONSE_SEPARATOR)
  ) {
    return false;
  }
  const quickResponse = tail.slice(0, separatorIndex);
  const fallbackResponse = tail.slice(
    separatorIndex + BAD_RESPONSE_SEPARATOR.length,
  );
  return quickResponse.startsWith("503: ")
    && fallbackResponse.startsWith("503: ");
}

function isRetryableTransportFailure(result, output) {
  if (!(typeof result.status === "number" && result.status > 0)) return false;
  if (result.error || result.signal) return false;
  const error = pnpmErrorFrom(output);
  return error !== undefined
    && (isExactSocketTimeout(error) || isExactDouble503(error));
}

function failureStatus(status) {
  return typeof status === "number" && status > 0 ? status : 1;
}

function defaultRunAttempt(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runIndexerDependencyAudit({
  runAttempt = defaultRunAttempt,
  sleep = defaultSleep,
  writeStdout = (value) => process.stdout.write(value),
  writeStderr = (value) => process.stderr.write(value),
} = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = runAttempt("pnpm", [...AUDIT_ARGUMENTS]);
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    if (stdout !== "") writeStdout(stdout);
    if (stderr !== "") writeStderr(stderr);

    const output = parseJson(stdout);
    if (isAuditReport(output)) {
      return result.status === 0 ? 0 : failureStatus(result.status);
    }

    if (!isRetryableTransportFailure(result, output)) {
      return failureStatus(result.status);
    }

    if (attempt === MAX_ATTEMPTS) {
      writeStderr("Indexer dependency audit transport failure exhausted its single retry.\n");
      return failureStatus(result.status);
    }

    writeStderr("Indexer dependency audit hit an allowed transport failure; retrying once in 10 seconds.\n");
    await sleep(RETRY_DELAY_MILLISECONDS);
  }

  return 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  process.exitCode = await runIndexerDependencyAudit();
}
