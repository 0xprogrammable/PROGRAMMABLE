import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const AUDIT_ARGUMENTS = Object.freeze([
  "audit",
  "--omit=dev",
  "--audit-level=moderate",
  "--json",
]);

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MILLISECONDS = 10_000;
const BULK_ENDPOINT =
  "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const SERVICE_UNAVAILABLE_MESSAGE =
  `503 Service Unavailable - POST ${BULK_ENDPOINT} - Service Unavailable`;

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, expected) {
  return isPlainObject(value)
    && Object.keys(value).sort().join("\n") === [...expected].sort().join("\n");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function auditSeverityCounts(value) {
  const severities = ["info", "low", "moderate", "high", "critical"];
  if (!hasExactKeys(value, [...severities, "total"])
    || ![...severities, "total"].every((key) => isNonnegativeInteger(value[key]))) {
    return undefined;
  }
  if (severities.reduce((total, severity) => total + value[severity], 0) !== value.total) {
    return undefined;
  }
  return value;
}

function isAuditReport(value) {
  if (!hasExactKeys(value, ["auditReportVersion", "vulnerabilities", "metadata"])
    || value.auditReportVersion !== 2
    || !isPlainObject(value.vulnerabilities)
    || !hasExactKeys(value.metadata, ["vulnerabilities", "dependencies"])) {
    return false;
  }
  const counts = auditSeverityCounts(value.metadata.vulnerabilities);
  const dependencyKeys = ["prod", "dev", "optional", "peer", "peerOptional", "total"];
  if (counts === undefined
    || !hasExactKeys(value.metadata.dependencies, dependencyKeys)
    || !dependencyKeys.every((key) => isNonnegativeInteger(value.metadata.dependencies[key]))) {
    return false;
  }
  const actualCounts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const [name, vulnerability] of Object.entries(value.vulnerabilities)) {
    if (!isPlainObject(vulnerability)
      || vulnerability.name !== name
      || !Object.hasOwn(actualCounts, vulnerability.severity)) {
      return false;
    }
    actualCounts[vulnerability.severity] += 1;
  }
  return Object.entries(actualCounts).every(
    ([severity, count]) => counts[severity] === count,
  ) && counts.total === Object.keys(value.vulnerabilities).length;
}

function isExactNpmJsonError(value) {
  return hasExactKeys(value, ["summary", "detail"])
    && value.summary === ""
    && value.detail === "";
}

function isExactBulk503(value) {
  return hasExactKeys(value, [
    "message",
    "method",
    "uri",
    "headers",
    "statusCode",
    "body",
    "error",
  ])
    && value.message === SERVICE_UNAVAILABLE_MESSAGE
    && value.method === "POST"
    && value.uri === BULK_ENDPOINT
    && isPlainObject(value.headers)
    && value.statusCode === 503
    && hasExactKeys(value.body, ["error"])
    && value.body.error === "Service Unavailable"
    && isExactNpmJsonError(value.error);
}

function isExactBulkTimeout(value) {
  return hasExactKeys(value, ["message", "error"])
    && value.message === `network timeout at: ${BULK_ENDPOINT}`
    && isExactNpmJsonError(value.error);
}

function isRetryableTransportFailure(result, output) {
  return typeof result.status === "number"
    && result.status > 0
    && !result.error
    && !result.signal
    && (isExactBulk503(output) || isExactBulkTimeout(output));
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

export async function runProductionDependencyAudit({
  runAttempt = defaultRunAttempt,
  sleep = defaultSleep,
  writeStdout = (value) => process.stdout.write(value),
  writeStderr = (value) => process.stderr.write(value),
} = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = runAttempt("npm", [...AUDIT_ARGUMENTS]);
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    if (stdout !== "") writeStdout(stdout);
    if (stderr !== "") writeStderr(stderr);

    const output = parseJson(stdout);
    if (isAuditReport(output)) {
      const thresholdFinding = output.metadata.vulnerabilities.moderate > 0
        || output.metadata.vulnerabilities.high > 0
        || output.metadata.vulnerabilities.critical > 0;
      if (result.status === 0 && !result.error && !result.signal && !thresholdFinding) return 0;
      return failureStatus(result.status);
    }

    if (!isRetryableTransportFailure(result, output)) {
      return failureStatus(result.status);
    }

    if (attempt === MAX_ATTEMPTS) {
      writeStderr("Production dependency audit transport failure exhausted its single retry.\n");
      return failureStatus(result.status);
    }

    writeStderr("Production dependency audit hit an allowed transport failure; retrying once in 10 seconds.\n");
    await sleep(RETRY_DELAY_MILLISECONDS);
  }

  return 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  process.exitCode = await runProductionDependencyAudit();
}
