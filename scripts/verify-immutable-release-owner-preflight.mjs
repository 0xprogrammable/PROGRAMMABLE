#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";
import {
  canonicalizeJson,
  parseStrictJson,
} from "../packages/launch/src/canonical-json.mjs";

export const IMMUTABLE_RELEASE_PREFLIGHT_SCHEMA =
  "programmable.github-immutable-release-owner-preflight.v2";
export const IMMUTABLE_RELEASE_PREFLIGHT_API_VERSION = "2026-03-10";
export const IMMUTABLE_RELEASE_PREFLIGHT_SIGNER =
  "258789013+hazarxyz@users.noreply.github.com";
export const IMMUTABLE_RELEASE_PREFLIGHT_SIGNING_KEY_FINGERPRINT =
  "SHA256:RTXVJ3XspKUc+Qmj/daOWwU2WyT+qbRBtsJJwNpItdI";
export const IMMUTABLE_RELEASE_PREFLIGHT_NAMESPACE =
  "immutable-release-preflight@programmable.xyz";
export const IMMUTABLE_RELEASE_PREFLIGHT_PUBLIC_KEY_BASE64 =
  "AAAAC3NzaC1lZDI1NTE5AAAAINHVNMDJ/5vEDDMuHf5DJai/95eorr7zymQvgxUUpoBp";
export const IMMUTABLE_RELEASE_PREFLIGHT_ALLOWED_SIGNERS_PATH =
  ".github/release-trust/programmable-launch-immutable-release-owner.allowed_signers";
export const IMMUTABLE_RELEASE_PREFLIGHT_ALLOWED_SIGNERS =
  `${IMMUTABLE_RELEASE_PREFLIGHT_SIGNER} ` +
  `namespaces="${IMMUTABLE_RELEASE_PREFLIGHT_NAMESPACE}" ` +
  `ssh-ed25519 ${IMMUTABLE_RELEASE_PREFLIGHT_PUBLIC_KEY_BASE64}\n`;

export const IMMUTABLE_RELEASE_PREFLIGHT_TRUST_POLICY = Object.freeze({
  allowedSigners: IMMUTABLE_RELEASE_PREFLIGHT_ALLOWED_SIGNERS,
  keyFingerprint: IMMUTABLE_RELEASE_PREFLIGHT_SIGNING_KEY_FINGERPRINT,
  namespace: IMMUTABLE_RELEASE_PREFLIGHT_NAMESPACE,
  principal: IMMUTABLE_RELEASE_PREFLIGHT_SIGNER,
  publicKeyBase64: IMMUTABLE_RELEASE_PREFLIGHT_PUBLIC_KEY_BASE64,
});

const SSH_KEYGEN = "/usr/bin/ssh-keygen";
const MAXIMUM_RECORD_BYTES = 16_384;
const MAXIMUM_SIGNATURE_BYTES = 4_096;
const MAXIMUM_RESPONSE_BODY_BYTES = 4_096;
const MAXIMUM_ALLOWED_SIGNERS_BYTES = 1_024;
const MAXIMUM_AGE_MS = 10 * 60_000;
const MAXIMUM_FUTURE_SKEW_MS = 30_000;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const CANONICAL_SHA256 = /^sha256:[0-9a-f]{64}$/u;
const CANONICAL_COMMIT = /^[0-9a-f]{40}$/u;
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const CANONICAL_UTC_SECOND =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/u;
const GITHUB_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9:-]{7,127}$/u;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const RECORD_KEYS = Object.freeze([
  "actorId",
  "actorLogin",
  "apiVersion",
  "environment",
  "observedAt",
  "repository",
  "repositoryId",
  "response",
  "revision",
  "schemaVersion",
  "url",
]);
const RESPONSE_KEYS = Object.freeze([
  "bodyBase64",
  "bodySha256",
  "date",
  "enabled",
  "enforcedByOwner",
  "requestId",
  "status",
]);
const CLI_FLAGS = Object.freeze([
  "--actor-id",
  "--actor-login",
  "--allowed-signers",
  "--environment",
  "--record-base64",
  "--repository",
  "--repository-id",
  "--revision",
  "--signature-base64",
]);

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) {
    throw new TypeError(`${label} shape is invalid`);
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fingerprint(publicKeyBase64) {
  if (typeof publicKeyBase64 !== "string" || !CANONICAL_BASE64.test(publicKeyBase64)) {
    throw new TypeError("immutable-release owner public key is invalid");
  }
  const keyBytes = Buffer.from(publicKeyBase64, "base64");
  if (keyBytes.toString("base64") !== publicKeyBase64) {
    throw new TypeError("immutable-release owner public key is not canonical base64");
  }
  return `SHA256:${createHash("sha256").update(keyBytes).digest("base64").replace(/=+$/u, "")}`;
}

function decodeCanonicalBase64(value, label, maximumBytes) {
  if (typeof value !== "string" || value.length === 0
    || value.length > Math.ceil(maximumBytes / 3) * 4
    || !CANONICAL_BASE64.test(value)) {
    throw new TypeError(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > maximumBytes || bytes.toString("base64") !== value) {
    throw new TypeError(`${label} is not canonical base64`);
  }
  return bytes;
}

function decodeUtf8(bytes, label) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new TypeError(`${label} must not contain a UTF-8 BOM`);
  }
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    throw new TypeError(`${label} is not valid UTF-8`);
  }
}

function validateTrustPolicy(policy) {
  exactKeys(
    policy,
    ["allowedSigners", "keyFingerprint", "namespace", "principal", "publicKeyBase64"],
    "immutable-release trust policy",
  );
  const expectedAllowedSigners =
    `${policy.principal} namespaces="${policy.namespace}" ssh-ed25519 ${policy.publicKeyBase64}\n`;
  if (policy.allowedSigners !== expectedAllowedSigners
    || policy.principal.length === 0
    || policy.principal.includes(",")
    || policy.namespace.length === 0
    || /[*,!]/u.test(policy.namespace)
    || fingerprint(policy.publicKeyBase64) !== policy.keyFingerprint) {
    throw new TypeError("immutable-release trust policy is invalid");
  }
  return policy;
}

function validateAllowedSigners(path, policy) {
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("immutable-release allowed-signers path is invalid");
  }
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new TypeError("immutable-release allowed-signers file is unavailable");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0
    || stat.size > MAXIMUM_ALLOWED_SIGNERS_BYTES) {
    throw new TypeError("immutable-release allowed-signers file is invalid");
  }
  const bytes = readFileSync(path);
  if (!bytes.equals(Buffer.from(policy.allowedSigners, "utf8"))) {
    throw new TypeError("immutable-release allowed-signers trust root differs");
  }
  return bytes;
}

function verifyOpenSshSignature({ recordBytes, signatureBytes, allowedSignersBytes, policy }) {
  const signatureText = decodeUtf8(signatureBytes, "immutable-release OpenSSH signature");
  if (!signatureText.startsWith("-----BEGIN SSH SIGNATURE-----\n")
    || !signatureText.endsWith("-----END SSH SIGNATURE-----\n")) {
    throw new TypeError("immutable-release OpenSSH signature armor is invalid");
  }

  const directory = mkdtempSync(join(tmpdir(), "programmable-immutable-release-preflight-"));
  chmodSync(directory, 0o700);
  const signaturePath = join(directory, "record.sshsig");
  const allowedSignersPath = join(directory, "allowed_signers");
  try {
    writeFileSync(signaturePath, signatureBytes, { flag: "wx", mode: 0o600 });
    writeFileSync(allowedSignersPath, allowedSignersBytes, { flag: "wx", mode: 0o600 });
    const result = spawnSync(SSH_KEYGEN, [
      "-Y",
      "verify",
      "-f",
      allowedSignersPath,
      "-I",
      policy.principal,
      "-n",
      policy.namespace,
      "-s",
      signaturePath,
    ], {
      input: recordBytes,
      maxBuffer: 64 * 1024,
      shell: false,
      windowsHide: true,
    });
    if (result.error !== undefined || result.signal !== null || result.status !== 0) {
      throw new TypeError("immutable-release owner OpenSSH signature is not trusted");
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

export function canonicalImmutableReleaseOwnerPreflightBytes(value) {
  return Buffer.from(`${canonicalizeJson(value)}\n`, "utf8");
}

export function verifyImmutableReleaseOwnerPreflight({
  recordBase64,
  signatureBase64,
  allowedSignersPath,
  repository,
  repositoryId,
  revision,
  environment,
  actorId,
  actorLogin,
  now = new Date(),
  trustPolicy = IMMUTABLE_RELEASE_PREFLIGHT_TRUST_POLICY,
}) {
  const policy = validateTrustPolicy(trustPolicy);
  const allowedSignersBytes = validateAllowedSigners(allowedSignersPath, policy);

  const recordBytes = decodeCanonicalBase64(
    recordBase64,
    "immutable-release owner record",
    MAXIMUM_RECORD_BYTES,
  );
  const signatureBytes = decodeCanonicalBase64(
    signatureBase64,
    "immutable-release owner signature",
    MAXIMUM_SIGNATURE_BYTES,
  );
  verifyOpenSshSignature({ recordBytes, signatureBytes, allowedSignersBytes, policy });

  if (recordBytes.length < 3 || recordBytes.at(-1) !== 0x0a
    || recordBytes.at(-2) === 0x0a || recordBytes.at(-2) === 0x0d) {
    throw new TypeError("immutable-release owner record must have one trailing LF");
  }
  const serialized = decodeUtf8(
    recordBytes.subarray(0, recordBytes.length - 1),
    "immutable-release owner record",
  );
  const value = parseStrictJson(serialized, {
    maximumBytes: MAXIMUM_RECORD_BYTES - 1,
    maximumDepth: 8,
  });
  exactKeys(value, RECORD_KEYS, "immutable-release owner record");
  const response = exactKeys(value.response, RESPONSE_KEYS, "immutable-release owner response");
  if (!canonicalImmutableReleaseOwnerPreflightBytes(value).equals(recordBytes)) {
    throw new TypeError("immutable-release owner record bytes are not canonical");
  }

  const responseBody = decodeCanonicalBase64(
    response.bodyBase64,
    "immutable-release endpoint body",
    MAXIMUM_RESPONSE_BODY_BYTES,
  );
  const responseBodyText = decodeUtf8(responseBody, "immutable-release endpoint body");
  const responseValue = parseStrictJson(responseBodyText, {
    maximumBytes: MAXIMUM_RESPONSE_BODY_BYTES,
    maximumDepth: 4,
  });
  exactKeys(
    responseValue,
    ["enabled", "enforced_by_owner"],
    "immutable-release endpoint body",
  );
  if (response.enabled !== true || responseValue.enabled !== true
    || typeof response.enforcedByOwner !== "boolean"
    || typeof responseValue.enforced_by_owner !== "boolean"
    || response.enforcedByOwner !== responseValue.enforced_by_owner) {
    throw new TypeError("immutable-release endpoint response is not exactly enabled");
  }

  const responseDateMilliseconds = Date.parse(response.date);
  const observedAtMilliseconds = Date.parse(value.observedAt);
  const nowMilliseconds = now instanceof Date ? now.getTime() : Number.NaN;
  const expectedUrl = `https://api.github.com/repos/${repository}/immutable-releases`;
  if (typeof repository !== "string" || repository.length === 0
    || typeof repositoryId !== "string" || !CANONICAL_DECIMAL.test(repositoryId)
    || typeof revision !== "string" || !CANONICAL_COMMIT.test(revision)
    || typeof environment !== "string" || environment.length === 0
    || typeof actorId !== "string" || !CANONICAL_DECIMAL.test(actorId)
    || typeof actorLogin !== "string" || actorLogin.length === 0
    || value.schemaVersion !== IMMUTABLE_RELEASE_PREFLIGHT_SCHEMA
    || value.repositoryId !== repositoryId
    || value.repository !== repository
    || value.revision !== revision
    || value.environment !== environment
    || value.actorId !== actorId
    || value.actorLogin !== actorLogin
    || value.url !== expectedUrl
    || value.apiVersion !== IMMUTABLE_RELEASE_PREFLIGHT_API_VERSION
    || response.status !== 200
    || typeof response.bodySha256 !== "string"
    || !CANONICAL_SHA256.test(response.bodySha256)
    || response.bodySha256 !== sha256(responseBody)
    || typeof response.requestId !== "string"
    || !GITHUB_REQUEST_ID.test(response.requestId)
    || typeof response.date !== "string"
    || !Number.isFinite(responseDateMilliseconds)
    || new Date(responseDateMilliseconds).toUTCString() !== response.date
    || typeof value.observedAt !== "string"
    || !CANONICAL_UTC_SECOND.test(value.observedAt)
    || !Number.isFinite(observedAtMilliseconds)
    || new Date(observedAtMilliseconds).toISOString().replace(".000Z", "Z") !== value.observedAt
    || observedAtMilliseconds !== responseDateMilliseconds
    || !Number.isFinite(nowMilliseconds)
    || observedAtMilliseconds > nowMilliseconds + MAXIMUM_FUTURE_SKEW_MS
    || nowMilliseconds - observedAtMilliseconds > MAXIMUM_AGE_MS) {
    throw new TypeError("immutable-release owner preflight is stale or differs");
  }

  return Object.freeze({
    actorId,
    actorLogin,
    apiVersion: IMMUTABLE_RELEASE_PREFLIGHT_API_VERSION,
    enforcedByOwner: response.enforcedByOwner,
    environment,
    keyFingerprint: policy.keyFingerprint,
    namespace: policy.namespace,
    observedAt: value.observedAt,
    recordSha256: sha256(recordBytes),
    repository,
    repositoryId,
    requestId: response.requestId,
    responseBodySha256: response.bodySha256,
    revision,
    schemaVersion: IMMUTABLE_RELEASE_PREFLIGHT_SCHEMA,
    signer: policy.principal,
    url: expectedUrl,
  });
}

function parseCli(argv) {
  if (argv.length !== CLI_FLAGS.length * 2) {
    throw new TypeError("immutable-release preflight arguments differ");
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!CLI_FLAGS.includes(flag) || values.has(flag)
      || typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new TypeError("immutable-release preflight arguments differ");
    }
    values.set(flag, value);
  }
  return values;
}

export function runImmutableReleaseOwnerPreflightCli(argv = process.argv.slice(2)) {
  const values = parseCli(argv);
  return verifyImmutableReleaseOwnerPreflight({
    actorId: values.get("--actor-id"),
    actorLogin: values.get("--actor-login"),
    allowedSignersPath: values.get("--allowed-signers"),
    environment: values.get("--environment"),
    recordBase64: values.get("--record-base64"),
    repository: values.get("--repository"),
    repositoryId: values.get("--repository-id"),
    revision: values.get("--revision"),
    signatureBase64: values.get("--signature-base64"),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    runImmutableReleaseOwnerPreflightCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
