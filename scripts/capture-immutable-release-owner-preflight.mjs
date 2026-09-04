#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";
import { canonicalizeJson, parseStrictJson } from "../packages/launch/src/canonical-json.mjs";
import { assertProgrammableLaunchTagRuleset } from "./verify-programmable-launch-tag-ruleset.mjs";
import {
  canonicalImmutableReleaseOwnerPreflightBytes,
  IMMUTABLE_RELEASE_PREFLIGHT_ALLOWED_SIGNERS_PATH,
  IMMUTABLE_RELEASE_PREFLIGHT_API_VERSION,
  IMMUTABLE_RELEASE_PREFLIGHT_NAMESPACE,
  IMMUTABLE_RELEASE_PREFLIGHT_SCHEMA,
  IMMUTABLE_RELEASE_PREFLIGHT_TRUST_POLICY,
  verifyImmutableReleaseOwnerPreflight,
} from "./verify-immutable-release-owner-preflight.mjs";

const GH = "gh";
const SSH_KEYGEN = "/usr/bin/ssh-keygen";
const REPOSITORY = "programmablehq/PROGRAMMABLE";
const REPOSITORY_ID = "1314365508";
const ACTOR_ID = "258789013";
const ACTOR_LOGIN = "hazarxyz";
const ENVIRONMENT = "production";
const PRODUCTION_REF = "refs/heads/production";
const MAXIMUM_GH_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAXIMUM_ENDPOINT_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_SIGNATURE_BYTES = 4_096;
const COMMIT = /^[0-9a-f]{40}$/u;
const DEFAULT_ALLOWED_SIGNERS_PATH = fileURLToPath(new URL(
  `../${IMMUTABLE_RELEASE_PREFLIGHT_ALLOWED_SIGNERS_PATH}`,
  import.meta.url,
));
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const CLI_FLAGS = Object.freeze([
  "--environment",
  "--repository",
  "--repository-id",
  "--revision",
  "--signing-key",
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function decodeUtf8(bytes, label) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError(`${label} bytes are invalid`);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new TypeError(`${label} must not contain a UTF-8 BOM`);
  }
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    throw new TypeError(`${label} is not valid UTF-8`);
  }
}

function command(command, args, { input, maximumBytes = MAXIMUM_GH_OUTPUT_BYTES } = {}) {
  const result = spawnSync(command, args, {
    input,
    maxBuffer: maximumBytes,
    shell: false,
    windowsHide: true,
  });
  if (result.error !== undefined || result.signal !== null || result.status !== 0
    || !Buffer.isBuffer(result.stdout) || result.stdout.length > maximumBytes) {
    throw new TypeError("owner preflight capture command failed closed");
  }
  return result.stdout;
}

function ghArguments(endpoint, { include = false } = {}) {
  return [
    "api",
    "--hostname",
    "github.com",
    "--method",
    "GET",
    "--header",
    "Accept: application/vnd.github+json",
    "--header",
    `X-GitHub-Api-Version: ${IMMUTABLE_RELEASE_PREFLIGHT_API_VERSION}`,
    ...(include ? ["--include"] : []),
    endpoint,
  ];
}

function ghJson(endpoint, runCommand = command) {
  const bytes = runCommand(GH, ghArguments(endpoint));
  const source = decodeUtf8(bytes, `GitHub ${endpoint} response`);
  return parseStrictJson(source, { maximumBytes: MAXIMUM_GH_OUTPUT_BYTES, maximumDepth: 64 });
}

function headerSeparator(bytes) {
  const crlf = bytes.indexOf(Buffer.from("\r\n\r\n", "ascii"));
  const lf = bytes.indexOf(Buffer.from("\n\n", "ascii"));
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { index: crlf, length: 4 };
  if (lf >= 0) return { index: lf, length: 2 };
  throw new TypeError("GitHub immutable-release response headers are missing");
}

export function parseIncludedGitHubResponse(bytes, { tagRuleset = false } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0
    || bytes.length > MAXIMUM_ENDPOINT_RESPONSE_BYTES) {
    throw new TypeError("GitHub immutable-release response is invalid");
  }
  const separator = headerSeparator(bytes);
  const headerBytes = bytes.subarray(0, separator.index);
  const bodyBytes = bytes.subarray(separator.index + separator.length);
  if (bodyBytes.length === 0 || bodyBytes.length > 4_096) {
    throw new TypeError("GitHub immutable-release response body is invalid");
  }
  const headerText = decodeUtf8(headerBytes, "GitHub immutable-release response headers");
  const lines = headerText.split(/\r?\n/u);
  if (!/^HTTP\/(?:1\.[01]|2(?:\.0)?) 200(?: |$)/u.test(lines[0] ?? "")
    || lines.slice(1).some((line) => line.startsWith("HTTP/"))) {
    throw new TypeError("GitHub immutable-release response status is not exactly 200");
  }
  const headers = new Map();
  const singularHeaders = new Set(["content-type", "date", "x-github-request-id"]);
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon <= 0) throw new TypeError("GitHub immutable-release response header is invalid");
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name.length === 0 || value.length === 0
      || (singularHeaders.has(name) && headers.has(name))) {
      throw new TypeError("GitHub immutable-release response headers are ambiguous");
    }
    if (!headers.has(name) || singularHeaders.has(name)) headers.set(name, value);
  }
  const contentType = headers.get("content-type") ?? "";
  const date = headers.get("date");
  const requestId = headers.get("x-github-request-id");
  if (!/^application\/json(?:;|$)/iu.test(contentType)
    || date === undefined || requestId === undefined) {
    throw new TypeError("GitHub immutable-release response provenance headers are missing");
  }
  const body = parseStrictJson(decodeUtf8(bodyBytes, "GitHub immutable-release response body"), {
    maximumBytes: 4_096,
    maximumDepth: 8,
  });
  if (tagRuleset) {
    assertProgrammableLaunchTagRuleset(body);
    return Object.freeze({ bodyBytes: Buffer.from(bodyBytes), date, requestId });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).sort().join(",") !== "enabled,enforced_by_owner"
    || body.enabled !== true || typeof body.enforced_by_owner !== "boolean") {
    throw new TypeError("GitHub immutable-release endpoint is not exactly enabled");
  }
  return Object.freeze({
    bodyBytes: Buffer.from(bodyBytes),
    date,
    enforcedByOwner: body.enforced_by_owner,
    requestId,
  });
}

export function buildImmutableReleaseOwnerPreflightRecord({
  revision,
  bodyBytes,
  date,
  enforcedByOwner,
  requestId,
  tagRuleset,
}) {
  const dateMilliseconds = Date.parse(date);
  if (typeof revision !== "string" || !COMMIT.test(revision)
    || !Buffer.isBuffer(bodyBytes) || bodyBytes.length === 0
    || typeof date !== "string" || !Number.isFinite(dateMilliseconds)
    || new Date(dateMilliseconds).toUTCString() !== date
    || typeof enforcedByOwner !== "boolean"
    || typeof requestId !== "string" || requestId.length === 0) {
    throw new TypeError("immutable-release owner capture evidence is invalid");
  }
  const observedAt = new Date(dateMilliseconds).toISOString().replace(".000Z", "Z");
  return Object.freeze({
    actorId: ACTOR_ID,
    actorLogin: ACTOR_LOGIN,
    apiVersion: IMMUTABLE_RELEASE_PREFLIGHT_API_VERSION,
    environment: ENVIRONMENT,
    observedAt,
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    response: {
      bodyBase64: bodyBytes.toString("base64"),
      bodySha256: sha256(bodyBytes),
      date,
      enabled: true,
      enforcedByOwner,
      requestId,
      status: 200,
    },
    revision,
    schemaVersion: IMMUTABLE_RELEASE_PREFLIGHT_SCHEMA,
    tagRuleset: {
      url: `https://api.github.com/repos/${REPOSITORY}/rulesets/21679403`,
      response: {
        bodyBase64: tagRuleset.bodyBytes.toString("base64"),
        bodySha256: sha256(tagRuleset.bodyBytes),
        date: tagRuleset.date,
        requestId: tagRuleset.requestId,
        status: 200,
      },
    },
    url: `https://api.github.com/repos/${REPOSITORY}/immutable-releases`,
  });
}

function assertLocalOwnerEnvironment(environment) {
  if (Object.hasOwn(environment, "GITHUB_ACTIONS")) {
    throw new TypeError("owner preflight capture is forbidden inside GitHub Actions");
  }
}

function parseCli(argv) {
  if (argv.length !== CLI_FLAGS.length * 2) {
    throw new TypeError("owner preflight capture arguments differ");
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!CLI_FLAGS.includes(flag) || values.has(flag)
      || typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new TypeError("owner preflight capture arguments differ");
    }
    values.set(flag, value);
  }
  if (values.get("--repository") !== REPOSITORY
    || values.get("--repository-id") !== REPOSITORY_ID
    || values.get("--environment") !== ENVIRONMENT
    || !COMMIT.test(values.get("--revision") ?? "")
    || values.get("--signing-key")?.startsWith("-")) {
    throw new TypeError("owner preflight capture target differs");
  }
  return values;
}

export function captureImmutableReleaseOwnerPreflight({
  argv = process.argv.slice(2),
  environment = process.env,
  now = new Date(),
  runCommand = command,
  allowedSignersPath = DEFAULT_ALLOWED_SIGNERS_PATH,
  trustPolicy = IMMUTABLE_RELEASE_PREFLIGHT_TRUST_POLICY,
} = {}) {
  assertLocalOwnerEnvironment(environment);
  const values = parseCli(argv);
  const revision = values.get("--revision");

  const user = ghJson("/user", runCommand);
  if (user === null || typeof user !== "object" || Array.isArray(user)
    || user.login !== ACTOR_LOGIN || user.id !== Number(ACTOR_ID)) {
    throw new TypeError("gh is not authenticated as the exact release owner");
  }

  const ref = ghJson(`/repos/${REPOSITORY}/git/ref/heads/production`, runCommand);
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)
    || ref.ref !== PRODUCTION_REF || ref.object?.type !== "commit"
    || ref.object?.sha !== revision) {
    throw new TypeError("GitHub production ref does not equal the requested revision");
  }

  const included = runCommand(
    GH,
    ghArguments(`/repos/${REPOSITORY}/immutable-releases`, { include: true }),
    { maximumBytes: MAXIMUM_ENDPOINT_RESPONSE_BYTES },
  );
  const endpoint = parseIncludedGitHubResponse(included);
  const tagRuleset = parseIncludedGitHubResponse(runCommand(GH,
    ghArguments(`/repos/${REPOSITORY}/rulesets/21679403`, { include: true }),
    { maximumBytes: MAXIMUM_ENDPOINT_RESPONSE_BYTES }), { tagRuleset: true });
  const record = buildImmutableReleaseOwnerPreflightRecord({
    revision,
    bodyBytes: endpoint.bodyBytes,
    date: endpoint.date,
    enforcedByOwner: endpoint.enforcedByOwner,
    requestId: endpoint.requestId,
    tagRuleset,
  });
  const recordBytes = canonicalImmutableReleaseOwnerPreflightBytes(record);
  const signatureBytes = runCommand(SSH_KEYGEN, [
    "-Y",
    "sign",
    "-f",
    values.get("--signing-key"),
    "-n",
    IMMUTABLE_RELEASE_PREFLIGHT_NAMESPACE,
  ], { input: recordBytes, maximumBytes: MAXIMUM_SIGNATURE_BYTES });

  const recordBase64 = recordBytes.toString("base64");
  const signatureBase64 = signatureBytes.toString("base64");
  verifyImmutableReleaseOwnerPreflight({
    actorId: ACTOR_ID,
    actorLogin: ACTOR_LOGIN,
    allowedSignersPath,
    environment: ENVIRONMENT,
    now,
    recordBase64,
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    revision,
    signatureBase64,
    trustPolicy,
  });

  return Object.freeze({
    keyFingerprint: trustPolicy.keyFingerprint,
    namespace: trustPolicy.namespace,
    recordBase64,
    recordSha256: sha256(recordBytes),
    schemaVersion: "programmable.github-immutable-release-owner-preflight-capture.v3",
    signatureBase64,
    signer: trustPolicy.principal,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const result = captureImmutableReleaseOwnerPreflight();
    process.stdout.write(`${canonicalizeJson(result)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
