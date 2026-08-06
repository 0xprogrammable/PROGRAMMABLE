#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

export const WEBSITE_LAUNCH_PERMIT_GOLDEN_PATH = resolve(
  repositoryRoot,
  "tests/fixtures/service-launch-permit-v2-golden.json",
);
export const WEBSITE_LAUNCH_PERMIT_GOLDEN_RECEIPT_PATH = resolve(
  repositoryRoot,
  "tests/fixtures/service-launch-permit-v2-golden.receipt.json",
);
export const CANONICAL_FIXTURE_ENV =
  "PROGRAMMABLE_CANONICAL_LAUNCH_PERMIT_V2_GOLDEN_PATH";
export const CANONICAL_RECEIPT_ENV =
  "PROGRAMMABLE_CANONICAL_LAUNCH_PERMIT_V2_GOLDEN_RECEIPT_PATH";

const MAXIMUM_FIXTURE_BYTES = 512_000;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const RECEIPT_SCHEMA =
  "programmable.launch-permit-v2-golden-sync-receipt.v1";
const FIXTURE_SCHEMA = "programmable.launch-permit-browser-golden.v2";
const FIXTURE_SOURCE = "autonomous-approval-v1 service permit protocol";
const GENERATOR_ID =
  "programmable.autonomous-approval.launch-permit-v2-golden.v1";
const BACKEND_FIXTURE_PATH =
  "test/fixtures/launch-permit-v2/canonical-launch-permit-v2.golden.json";
const GENERATOR_PATH = "test/helpers/canonical-launch-permit-v2-golden.ts";
const PROTOCOL_PATH = "src/permits/v2/protocol.ts";
const FIXTURE_BUILDER_PATH =
  "test/helpers/launch-permit-v2-historical-fixture.ts";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const FORBIDDEN_PRIVATE_MATERIAL =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"(?:privateKey|privateKeyPem|secretKey|mnemonic|seedPhrase)"\s*:)/u;

export async function verifyServiceLaunchPermitV2Golden(input = {}) {
  const mirrorFixturePath = input.mirrorFixturePath
    ?? WEBSITE_LAUNCH_PERMIT_GOLDEN_PATH;
  const mirrorReceiptPath = input.mirrorReceiptPath
    ?? WEBSITE_LAUNCH_PERMIT_GOLDEN_RECEIPT_PATH;
  const canonicalFixturePath = input.canonicalFixturePath ?? null;
  const canonicalReceiptPath = input.canonicalReceiptPath ?? null;

  if ((canonicalFixturePath === null) !== (canonicalReceiptPath === null)) {
    throw new TypeError("canonical fixture and receipt paths must be supplied together");
  }

  const [fixtureBytes, receiptBytes] = await Promise.all([
    readBoundedRegularFile(mirrorFixturePath, "website launch-permit golden"),
    readBoundedRegularFile(mirrorReceiptPath, "website launch-permit golden receipt"),
  ]);
  const fixture = parseCanonicalJson(fixtureBytes, "website launch-permit golden");
  const receipt = parseCanonicalJson(receiptBytes, "website launch-permit golden receipt");
  assertExactKeys(receipt, [
    "containsPrivateMaterial",
    "fixture",
    "generator",
    "publicTestSigner",
    "schemaVersion",
    "serviceProtocol",
  ], "website launch-permit golden receipt");
  assertExactKeys(fixture, [
    "canonicalSignedPermitBase64Url",
    "permitId",
    "permitPayloadHash",
    "schemaVersion",
    "signedPermitArtifactHash",
    "source",
    "trustedSigner",
    "validUntil",
  ], "website launch-permit golden");
  assertExactKeys(receipt.generator, [
    "checkCommand",
    "id",
    "sourcePath",
    "sourceSha256",
    "writeCommand",
  ], "launch-permit golden generator binding");
  assertExactKeys(receipt.fixture, [
    "byteLength",
    "canonicalEncoding",
    "relativePath",
    "schemaVersion",
    "sha256",
  ], "launch-permit golden fixture binding");
  assertExactKeys(receipt.serviceProtocol, [
    "canonicalSignedPermitSha256",
    "canonicalSigningEnvelopeSha256",
    "fixtureBuilderPath",
    "fixtureBuilderSha256",
    "permitId",
    "permitPayloadHash",
    "signatureHash",
    "signedPermitArtifactHash",
    "signingEnvelopeHash",
    "sourcePath",
    "sourceSha256",
  ], "launch-permit golden service protocol binding");
  assertExactKeys(receipt.publicTestSigner, [
    "algorithm",
    "keyId",
    "publicKeySpkiSha256",
    "signerEpoch",
  ], "launch-permit golden public test signer binding");
  assertExactKeys(fixture.trustedSigner, [
    "keyId",
    "publicKeyBase64Url",
    "publicKeySpkiSha256",
    "signerComponentBindingHash",
    "signerEpoch",
  ], "launch-permit golden trusted signer");
  assertEqual(receipt.schemaVersion, RECEIPT_SCHEMA, "receipt schemaVersion");
  assertEqual(fixture.schemaVersion, FIXTURE_SCHEMA, "fixture schemaVersion");
  assertEqual(fixture.source, FIXTURE_SOURCE, "fixture source");
  assertEqual(receipt.generator.id, GENERATOR_ID, "generator id");
  assertEqual(receipt.generator.sourcePath, GENERATOR_PATH, "generator sourcePath");
  assertEqual(receipt.fixture.relativePath, BACKEND_FIXTURE_PATH, "fixture relativePath");
  assertEqual(receipt.fixture.schemaVersion, FIXTURE_SCHEMA, "receipt fixture schemaVersion");
  assertEqual(
    receipt.fixture.canonicalEncoding,
    "programmable-canonical-json-utf8-plus-lf.v1",
    "fixture canonicalEncoding",
  );
  assertEqual(receipt.serviceProtocol.sourcePath, PROTOCOL_PATH, "protocol sourcePath");
  assertEqual(
    receipt.serviceProtocol.fixtureBuilderPath,
    FIXTURE_BUILDER_PATH,
    "fixture builder path",
  );
  assertEqual(receipt.publicTestSigner.algorithm, "Ed25519", "public signer algorithm");
  if (receipt.containsPrivateMaterial !== false) {
    throw new TypeError("launch-permit golden receipt must exclude private material");
  }
  if (FORBIDDEN_PRIVATE_MATERIAL.test(fixtureBytes.toString("utf8"))) {
    throw new TypeError("launch-permit golden contains private material");
  }
  const binding = resolveFixtureBinding(receipt.fixture);
  const observedFixtureSha256 = sha256(fixtureBytes);
  if (binding.sha256 !== observedFixtureSha256) {
    throw new TypeError("website launch-permit golden digest differs from its backend receipt");
  }
  if (binding.byteLength !== fixtureBytes.byteLength) {
    throw new TypeError("website launch-permit golden length differs from its backend receipt");
  }
  for (const [value, label] of [
    [fixture.permitId, "fixture permitId"],
    [fixture.permitPayloadHash, "fixture permitPayloadHash"],
    [fixture.signedPermitArtifactHash, "fixture signedPermitArtifactHash"],
    [fixture.trustedSigner.signerComponentBindingHash, "fixture signer binding hash"],
    [fixture.trustedSigner.publicKeySpkiSha256, "fixture public key SPKI hash"],
    [receipt.generator.sourceSha256, "generator source hash"],
    [receipt.serviceProtocol.sourceSha256, "protocol source hash"],
    [receipt.serviceProtocol.fixtureBuilderSha256, "fixture builder source hash"],
    [receipt.serviceProtocol.signingEnvelopeHash, "signing envelope hash"],
    [receipt.serviceProtocol.signatureHash, "signature hash"],
    [receipt.serviceProtocol.canonicalSigningEnvelopeSha256, "canonical signing envelope hash"],
    [receipt.serviceProtocol.canonicalSignedPermitSha256, "canonical signed permit hash"],
  ]) assertDigest(value, label);
  assertEqual(receipt.serviceProtocol.permitId, fixture.permitId, "permitId binding");
  assertEqual(
    receipt.serviceProtocol.permitPayloadHash,
    fixture.permitPayloadHash,
    "permit payload hash binding",
  );
  assertEqual(
    receipt.serviceProtocol.signedPermitArtifactHash,
    fixture.signedPermitArtifactHash,
    "signed permit artifact hash binding",
  );
  assertEqual(receipt.publicTestSigner.keyId, fixture.trustedSigner.keyId, "signer key binding");
  assertEqual(
    receipt.publicTestSigner.signerEpoch,
    fixture.trustedSigner.signerEpoch,
    "signer epoch binding",
  );
  assertEqual(
    receipt.publicTestSigner.publicKeySpkiSha256,
    fixture.trustedSigner.publicKeySpkiSha256,
    "signer public key binding",
  );
  verifyCanonicalSignedPermit(fixture, receipt);

  if (canonicalFixturePath !== null && canonicalReceiptPath !== null) {
    const [canonicalFixtureBytes, canonicalReceiptBytes] = await Promise.all([
      readBoundedRegularFile(canonicalFixturePath, "canonical service launch-permit golden"),
      readBoundedRegularFile(canonicalReceiptPath, "canonical service launch-permit golden receipt"),
    ]);
    if (!canonicalFixtureBytes.equals(fixtureBytes)) {
      throw new TypeError("website launch-permit golden is not byte-identical to the backend fixture");
    }
    if (!canonicalReceiptBytes.equals(receiptBytes)) {
      throw new TypeError("website launch-permit receipt is not byte-identical to the backend receipt");
    }
  }

  return Object.freeze({
    schemaVersion: "programmable.website-service-launch-permit-golden-sync.v1",
    fixtureSha256: observedFixtureSha256,
    fixtureByteLength: fixtureBytes.byteLength,
    receiptSha256: sha256(receiptBytes),
    canonicalBytesCompared: canonicalFixturePath !== null,
    fixtureSchemaVersion: requiredString(fixture.schemaVersion, "fixture schemaVersion"),
    receiptSchemaVersion: requiredString(receipt.schemaVersion, "receipt schemaVersion"),
  });
}

async function readBoundedRegularFile(path, label) {
  const resolved = resolve(path);
  const metadata = await lstat(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TypeError(`${label} must be a regular non-symlink file`);
  }
  if (metadata.size <= 0 || metadata.size > MAXIMUM_FIXTURE_BYTES) {
    throw new TypeError(`${label} has an invalid byte length`);
  }
  return readFile(resolved);
}

function parseCanonicalJson(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new TypeError(`${label} must be valid JSON`, { cause: error });
  }
  if (canonicalJson(value) + "\n" !== bytes.toString("utf8")) {
    throw new TypeError(`${label} must use canonical sorted JSON with one trailing newline`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function resolveFixtureBinding(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("launch-permit golden receipt fixture binding must be an object");
  }
  const sha256Value = value.sha256;
  const byteLengthValue = value.byteLength;
  if (typeof sha256Value !== "string" || !DIGEST.test(sha256Value)) {
    throw new TypeError("launch-permit golden receipt fixture digest is invalid");
  }
  if (typeof byteLengthValue !== "string" || !POSITIVE_DECIMAL.test(byteLengthValue)) {
    throw new TypeError("launch-permit golden receipt fixture byte length is invalid");
  }
  const byteLength = Number(byteLengthValue);
  if (!Number.isSafeInteger(byteLength)) {
    throw new TypeError("launch-permit golden receipt fixture byte length is unsafe");
  }
  return Object.freeze({ sha256: sha256Value, byteLength });
}

function verifyCanonicalSignedPermit(fixture, receipt) {
  const encoded = requiredString(
    fixture.canonicalSignedPermitBase64Url,
    "canonicalSignedPermitBase64Url",
  );
  if (!BASE64URL.test(encoded)) {
    throw new TypeError("canonicalSignedPermitBase64Url is invalid");
  }
  const signedPermitBytes = Buffer.from(encoded, "base64url");
  if (signedPermitBytes.toString("base64url") !== encoded) {
    throw new TypeError("canonicalSignedPermitBase64Url is not canonical base64url");
  }
  assertEqual(
    sha256(signedPermitBytes),
    receipt.serviceProtocol.canonicalSignedPermitSha256,
    "canonical signed permit byte hash",
  );
  const signedPermit = parseCanonicalJsonWithoutLf(
    signedPermitBytes,
    "decoded canonical signed permit",
  );
  assertEqual(signedPermit.schemaVersion, "programmable.signed-launch-permit.v2", "signed permit schema");
  const publicKey = requiredString(
    fixture.trustedSigner.publicKeyBase64Url,
    "trusted signer publicKeyBase64Url",
  );
  if (!BASE64URL.test(publicKey)) throw new TypeError("trusted signer public key is invalid");
  const publicKeyBytes = Buffer.from(publicKey, "base64url");
  if (publicKeyBytes.byteLength !== 32 || publicKeyBytes.toString("base64url") !== publicKey) {
    throw new TypeError("trusted signer public key must be canonical raw Ed25519 bytes");
  }
  assertEqual(
    sha256(Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes])),
    fixture.trustedSigner.publicKeySpkiSha256,
    "trusted signer SPKI hash",
  );
}

function parseCanonicalJsonWithoutLf(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new TypeError(`${label} must be valid JSON`, { cause: error });
  }
  if (canonicalJson(value) !== bytes.toString("utf8")) {
    throw new TypeError(`${label} must use canonical sorted JSON`);
  }
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertExactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${label} has unsupported or missing fields`);
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new TypeError(`${label} does not match the canonical binding`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function main(argv) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--require-canonical")) {
    throw new TypeError("usage: verify-service-launch-permit-v2-golden.mjs [--require-canonical]");
  }
  const requireCanonical = argv[0] === "--require-canonical";
  const canonicalFixturePath = process.env[CANONICAL_FIXTURE_ENV] ?? null;
  const canonicalReceiptPath = process.env[CANONICAL_RECEIPT_ENV] ?? null;
  if (requireCanonical && (canonicalFixturePath === null || canonicalReceiptPath === null)) {
    throw new TypeError(
      `cross-stack verification requires ${CANONICAL_FIXTURE_ENV} and ${CANONICAL_RECEIPT_ENV}`,
    );
  }
  const result = await verifyServiceLaunchPermitV2Golden({
    canonicalFixturePath,
    canonicalReceiptPath,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
