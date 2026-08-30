#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalizeJson,
  parseStrictJson,
} from "../../packages/launch/src/canonical-json.mjs";
import {
  assertExactKeys,
  decodeExactUtf8,
  sha256Digest,
} from "../../packages/launch/src/io.mjs";
import {
  ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
  ROBINHOOD_SOURCIFY_LICENSE_NOTICE,
  ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION,
  attestRobinhoodSourcifyPublication,
  inspectRobinhoodSourcifyProtectedSource,
  inspectRobinhoodSourcifyPublication,
  prepareRobinhoodSourcifyPublication,
  robinhoodSourcifyPublicationAuthorizationDigest,
  submitRobinhoodSourcifyPublication,
  validateRobinhoodSourcifyPublicationPlan,
} from "./robinhood-custom-launch-sourcify-v2-core.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const REVIEW_SCHEMA =
  "programmable.robinhood-custom-launch.sourcify-publication-review.v1";
const MAX_REVIEW_BYTES = 4 * 1024 * 1024;
const ATTEMPT_SCHEMA =
  "programmable.robinhood-custom-launch.sourcify-publication-attempt.v1";
const ATTEMPT_DIGEST_DOMAIN =
  "programmable.robinhood-custom-launch.sourcify-publication-attempt-digest.v1";
const MAX_ATTEMPT_BYTES = 512 * 1024;

const DEFAULT_FILE_SYSTEM = Object.freeze({
  lstat,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  randomUUID,
});

function fail(message) {
  throw new TypeError(message);
}

export function parseRobinhoodSourcifyArguments(argv) {
  const forbidden = argv.find((argument) =>
    /^(?:--(?:broadcast|private-key|mnemonic|api-key|rpc-url|wallet))(?:=|$)/u.test(argument));
  if (forbidden) fail(`${forbidden.split("=", 1)[0]} is forbidden`);
  if (!new Set(["review", "submit", "recover"]).has(argv[0])) {
    fail("First argument must be review, submit, or recover");
  }
  const options = {
    mode: argv[0],
    creationTransactionHash: null,
    authorizationDigest: null,
    legalAcknowledgement: null,
    reviewPlan: null,
    recoveryMarker: null,
    output: null,
  };
  const fields = new Map([
    ["--creation-transaction-hash", "creationTransactionHash"],
    ["--acknowledge-publication-digest", "authorizationDigest"],
    ["--acknowledge-legal-effects", "legalAcknowledgement"],
    ["--review-plan", "reviewPlan"],
    ["--recovery-marker", "recoveryMarker"],
    ["--output", "output"],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const field = fields.get(key);
    if (!field) fail(`Unknown argument: ${key}`);
    if (options[field] !== null) fail(`${key} may be supplied only once`);
    const value = separator === -1 ? argv[++index] : argument.slice(separator + 1);
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      fail(`Missing value for ${key}`);
    }
    options[field] = value;
  }
  if (options.mode === "review") {
    if (!options.creationTransactionHash) fail("review requires --creation-transaction-hash");
    if (options.authorizationDigest || options.legalAcknowledgement || options.reviewPlan
      || options.recoveryMarker) {
      fail("review mode does not accept submit/recovery inputs");
    }
    if (!options.output || !path.isAbsolute(options.output)) {
      fail("review requires an absolute --output path");
    }
  } else if (options.mode === "submit") {
    if (options.creationTransactionHash) {
      fail("submit reads the transaction hash only from the protected --review-plan");
    }
    if (!options.reviewPlan || !path.isAbsolute(options.reviewPlan)) {
      fail("submit requires an absolute --review-plan path");
    }
    if (!options.authorizationDigest) fail("submit requires --acknowledge-publication-digest");
    if (options.legalAcknowledgement !== ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT) {
      fail(`submit requires --acknowledge-legal-effects ${ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT}`);
    }
    if (!options.output || !path.isAbsolute(options.output)) {
      fail("submit requires an absolute --output path");
    }
    if (options.recoveryMarker) fail("submit does not accept --recovery-marker");
  } else {
    if (options.creationTransactionHash || options.authorizationDigest
      || options.legalAcknowledgement || options.output) {
      fail("recover accepts only --review-plan and --recovery-marker");
    }
    if (!options.reviewPlan || !path.isAbsolute(options.reviewPlan)) {
      fail("recover requires an absolute --review-plan path");
    }
    if (!options.recoveryMarker || !path.isAbsolute(options.recoveryMarker)) {
      fail("recover requires an absolute --recovery-marker path");
    }
  }
  return Object.freeze(options);
}

function canonicalArtifactBytes(value) {
  return Buffer.from(`${canonicalizeJson(value)}\n`, "utf8");
}

async function assertOwnerOnlyOutputParent(parent, uid, fileSystem) {
  const [physicalParent, parentStats] = await Promise.all([
    fileSystem.realpath(parent),
    fileSystem.stat(parent),
  ]);
  if (physicalParent !== parent || !parentStats.isDirectory()
    || parentStats.nlink < 1 || (uid !== undefined && parentStats.uid !== uid)
    || (parentStats.mode & 0o077) !== 0) {
    fail("Sourcify output parent must be an owner-only real directory");
  }
}

async function syncOutputParent(parent, uid, fileSystem) {
  const handle = await fileSystem.open(parent, fsConstants.O_RDONLY);
  try {
    const metadata = await handle.stat();
    if (!metadata.isDirectory() || metadata.nlink < 1
      || (uid !== undefined && metadata.uid !== uid)
      || (metadata.mode & 0o077) !== 0
      || await fileSystem.realpath(parent) !== parent) {
      fail("Sourcify output parent changed before directory fsync");
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertLinkedOutput(reservation, expectedBytes = null) {
  const { fileSystem, path: output, parent, uid } = reservation;
  const [linked, physicalOutput, physicalParent] = await Promise.all([
    fileSystem.lstat(output),
    fileSystem.realpath(output),
    fileSystem.realpath(parent),
  ]);
  if (!linked.isFile() || linked.isSymbolicLink() || linked.nlink !== 1
    || (uid !== undefined && linked.uid !== uid)
    || (linked.mode & 0o777) !== 0o600 || physicalOutput !== output
    || physicalParent !== parent
    || (reservation.identity && (linked.dev !== reservation.identity.dev
      || linked.ino !== reservation.identity.ino))
    || (expectedBytes && linked.size !== expectedBytes.byteLength)) {
    fail("Sourcify output changed while reserved");
  }
  if (reservation.contentSha256) {
    const current = await fileSystem.readFile(output);
    if (sha256Digest(current) !== reservation.contentSha256) {
      fail("Sourcify output bytes changed while reserved");
    }
  }
  return linked;
}

async function safeUnlinkReservation(reservation) {
  if (reservation.handle && !reservation.closed) {
    reservation.identity ??= await reservation.handle.stat().catch(() => null);
    await reservation.handle.close().catch(() => {});
    reservation.closed = true;
  }
  if (reservation.externalActionPossible || reservation.finalized) return false;
  const linked = await reservation.fileSystem.lstat(reservation.path).catch(() => null);
  if (reservation.identity && linked && linked.dev === reservation.identity.dev
    && linked.ino === reservation.identity.ino && linked.nlink === 1) {
    await reservation.fileSystem.unlink(reservation.path);
    return true;
  }
  return false;
}

async function writeInitialArtifact(reservation, value) {
  if (reservation.closed || !reservation.handle) {
    fail("Sourcify output reservation is closed");
  }
  const bytes = canonicalArtifactBytes(value);
  const { bytesWritten } = await reservation.handle.write(bytes, 0, bytes.byteLength, 0);
  if (bytesWritten !== bytes.byteLength) fail("Sourcify output write was incomplete");
  await reservation.handle.truncate(bytes.byteLength);
  await reservation.handle.sync();
  await reservation.handle.chmod(0o600);
  const opened = await reservation.handle.stat();
  reservation.identity = opened;
  reservation.contentSha256 = sha256Digest(bytes);
  await assertLinkedOutput(reservation, bytes);
  await reservation.handle.close();
  reservation.closed = true;
  await syncOutputParent(reservation.parent, reservation.uid, reservation.fileSystem);
  return reservation.path;
}

async function atomicallyReplaceArtifact(reservation, value) {
  const { fileSystem, parent, path: output, uid } = reservation;
  await assertLinkedOutput(reservation);
  const bytes = canonicalArtifactBytes(value);
  const temporary = path.join(
    parent,
    `.${path.basename(output)}.${fileSystem.randomUUID()}.tmp`,
  );
  let temporaryHandle;
  let renamed = false;
  try {
    temporaryHandle = await fileSystem.open(temporary, "wx+", 0o600);
    const { bytesWritten } = await temporaryHandle.write(bytes, 0, bytes.byteLength, 0);
    if (bytesWritten !== bytes.byteLength) fail("Sourcify replacement write was incomplete");
    await temporaryHandle.truncate(bytes.byteLength);
    await temporaryHandle.sync();
    await temporaryHandle.chmod(0o600);
    const temporaryMetadata = await temporaryHandle.stat();
    const temporaryLinked = await fileSystem.lstat(temporary);
    if (!temporaryMetadata.isFile() || temporaryMetadata.nlink !== 1
      || temporaryLinked.nlink !== 1 || temporaryMetadata.dev !== temporaryLinked.dev
      || temporaryMetadata.ino !== temporaryLinked.ino
      || (uid !== undefined && temporaryMetadata.uid !== uid)
      || (temporaryMetadata.mode & 0o777) !== 0o600
      || temporaryMetadata.size !== bytes.byteLength
      || await fileSystem.realpath(temporary) !== temporary) {
      fail("Sourcify replacement file invariants differ");
    }
    await temporaryHandle.close();
    temporaryHandle = null;
    await assertLinkedOutput(reservation);
    await fileSystem.rename(temporary, output);
    renamed = true;
    const replaced = await fileSystem.lstat(output);
    if (!replaced.isFile() || replaced.nlink !== 1
      || replaced.dev !== temporaryMetadata.dev || replaced.ino !== temporaryMetadata.ino
      || (replaced.mode & 0o777) !== 0o600 || replaced.size !== bytes.byteLength
      || await fileSystem.realpath(output) !== output) {
      fail("Sourcify atomic replacement invariants differ");
    }
    reservation.identity = replaced;
    reservation.contentSha256 = sha256Digest(bytes);
    await syncOutputParent(parent, uid, fileSystem);
    return output;
  } finally {
    await temporaryHandle?.close().catch(() => {});
    if (!renamed) await fileSystem.unlink(temporary).catch(() => {});
  }
}

function buildOutputReservation(reservation) {
  return Object.freeze({
    path: reservation.path,
    async markAttempt(value) {
      if (reservation.finalized) fail("Sourcify output is already finalized");
      if (!reservation.externalActionPossible) {
        await writeInitialArtifact(reservation, value);
        reservation.externalActionPossible = true;
      } else {
        await atomicallyReplaceArtifact(reservation, value);
      }
      return reservation.path;
    },
    async commit(value) {
      if (reservation.finalized) fail("Sourcify output is already finalized");
      const output = reservation.externalActionPossible
        ? await atomicallyReplaceArtifact(reservation, value)
        : await writeInitialArtifact(reservation, value);
      reservation.finalized = true;
      return output;
    },
    async abort() {
      return safeUnlinkReservation(reservation);
    },
    externalActionPossible() {
      return reservation.externalActionPossible;
    },
  });
}

export async function reserveRobinhoodSourcifyOutput(
  output,
  {
    sourceRoot = repositoryRoot,
    temporaryRoot = tmpdir(),
    uid = process.getuid?.(),
    fileSystem = DEFAULT_FILE_SYSTEM,
  } = {},
) {
  const resolved = path.resolve(output);
  const relative = path.relative(path.resolve(sourceRoot), resolved);
  const temporaryRelative = path.relative(path.resolve(temporaryRoot), resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    fail("Sourcify receipt must be outside the source repository");
  }
  if (temporaryRelative === "" || (!temporaryRelative.startsWith("..")
    && !path.isAbsolute(temporaryRelative))) {
    fail("Sourcify receipt must not be written under the OS temporary directory");
  }
  const parent = path.dirname(resolved);
  await assertOwnerOnlyOutputParent(parent, uid, fileSystem);
  const handle = await fileSystem.open(resolved, "wx+", 0o600);
  const reservation = {
    path: resolved,
    parent,
    handle,
    closed: false,
    identity: null,
    contentSha256: null,
    externalActionPossible: false,
    finalized: false,
    fileSystem,
    uid,
  };
  try {
    const [opened, closingParent] = await Promise.all([
      handle.stat(),
      fileSystem.realpath(parent),
    ]);
    if (!opened.isFile() || opened.nlink !== 1 || (opened.mode & 0o777) !== 0o600
      || opened.size !== 0 || closingParent !== parent) {
      fail("Sourcify output reservation invariants differ");
    }
    reservation.identity = opened;
  } catch (error) {
    await safeUnlinkReservation(reservation);
    throw error;
  }
  return buildOutputReservation(reservation);
}

function sameSource(left, right) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

export function buildRobinhoodSourcifyReviewArtifact(review) {
  const artifact = {
    schemaVersion: REVIEW_SCHEMA,
    review,
    reviewDigest: null,
  };
  artifact.reviewDigest = sha256Digest(Buffer.from(canonicalizeJson(artifact), "utf8"));
  return Object.freeze(artifact);
}

function framedArtifactDigest(domain, value) {
  const domainBytes = Buffer.from(domain, "utf8");
  const payload = Buffer.from(canonicalizeJson(value), "utf8");
  const frame = Buffer.alloc(16);
  frame.writeBigUInt64BE(BigInt(domainBytes.byteLength), 0);
  frame.writeBigUInt64BE(BigInt(payload.byteLength), 8);
  return sha256Digest(Buffer.concat([frame, domainBytes, payload]));
}

function attemptTarget(target) {
  return Object.freeze({
    contract: target.contract,
    address: target.address,
    requestPath: target.requestPath,
    requestBodySha256: target.requestBodySha256,
  });
}

export function buildRobinhoodSourcifyAttemptMarker({
  reviewDigest,
  plan,
  authorizationDigest,
  attemptedTargets,
  exactReadbackCheckpoints = [],
}) {
  const validatedPlan = validateRobinhoodSourcifyPublicationPlan(plan);
  if (!/^sha256:[0-9a-f]{64}$/u.test(reviewDigest)
    || authorizationDigest
      !== robinhoodSourcifyPublicationAuthorizationDigest(validatedPlan)
    || !Array.isArray(attemptedTargets) || attemptedTargets.length < 1
    || attemptedTargets.length > validatedPlan.targets.length) {
    fail("Sourcify attempt marker inputs differ from the reviewed publication");
  }
  const available = new Map(validatedPlan.targets.map((target) => [
    target.contract,
    attemptTarget(target),
  ]));
  const normalizedTargets = attemptedTargets.map((target) => {
    const normalized = attemptTarget(target);
    if (canonicalizeJson(available.get(normalized.contract))
      !== canonicalizeJson(normalized)) {
      fail("Sourcify attempt target differs from the reviewed plan");
    }
    return normalized;
  });
  if (new Set(normalizedTargets.map(({ contract }) => contract)).size
    !== normalizedTargets.length) {
    fail("Sourcify attempt targets must be unique");
  }
  if (!Array.isArray(exactReadbackCheckpoints)
    || exactReadbackCheckpoints.length > validatedPlan.targets.length) {
    fail("Sourcify attempt checkpoints are invalid");
  }
  const planTargets = new Map(validatedPlan.targets.map((target) => [target.contract, target]));
  const normalizedCheckpoints = exactReadbackCheckpoints.map((checkpoint) => {
    assertExactKeys(checkpoint, [
      "contract", "submission", "verificationId", "jobResponseSha256",
      "externalBlockscout", "evidence",
    ], "Sourcify exact-readback checkpoint");
    const target = planTargets.get(checkpoint.contract);
    if (!target || !new Set([
      "already-verified-read-only",
      "submitted-and-completed",
      "concurrent-already-verified",
    ]).has(checkpoint.submission)) {
      fail("Sourcify exact-readback checkpoint identity differs");
    }
    validateReviewEvidence(checkpoint.evidence, target);
    return structuredClone(checkpoint);
  });
  if (new Set(normalizedCheckpoints.map(({ contract }) => contract)).size
    !== normalizedCheckpoints.length) {
    fail("Sourcify attempt checkpoints must be unique");
  }
  const marker = {
    schemaVersion: ATTEMPT_SCHEMA,
    state: "external-action-possible-recovery-required",
    provider: "sourcify-v2",
    chainId: "4663",
    externalActionPossible: true,
    reviewDigest,
    planDigest: validatedPlan.planDigest,
    authorizationDigest,
    sourceOrigin: validatedPlan.sourceOrigin,
    attemptedTargets: normalizedTargets,
    exactReadbackCheckpoints: normalizedCheckpoints,
    attemptDigest: null,
  };
  marker.attemptDigest = framedArtifactDigest(
    ATTEMPT_DIGEST_DOMAIN,
    { ...marker, attemptDigest: null },
  );
  return Object.freeze(structuredClone(marker));
}

export function validateRobinhoodSourcifyAttemptMarker(marker, reviewed) {
  assertExactKeys(marker, [
    "schemaVersion", "state", "provider", "chainId", "externalActionPossible",
    "reviewDigest", "planDigest", "authorizationDigest", "sourceOrigin",
    "attemptedTargets", "exactReadbackCheckpoints", "attemptDigest",
  ], "Sourcify attempt marker");
  if (marker.schemaVersion !== ATTEMPT_SCHEMA
    || marker.state !== "external-action-possible-recovery-required"
    || marker.provider !== "sourcify-v2" || marker.chainId !== "4663"
    || marker.externalActionPossible !== true
    || marker.reviewDigest !== reviewed.value.reviewDigest
    || marker.planDigest !== reviewed.plan.planDigest
    || marker.authorizationDigest !== reviewed.authorization
    || canonicalizeJson(marker.sourceOrigin)
      !== canonicalizeJson(reviewed.plan.sourceOrigin)
    || marker.attemptDigest !== framedArtifactDigest(
      ATTEMPT_DIGEST_DOMAIN,
      { ...marker, attemptDigest: null },
    )) {
    fail("Sourcify attempt marker differs from the protected review");
  }
  return buildRobinhoodSourcifyAttemptMarker({
    reviewDigest: marker.reviewDigest,
    plan: reviewed.plan,
    authorizationDigest: marker.authorizationDigest,
    attemptedTargets: marker.attemptedTargets,
    exactReadbackCheckpoints: marker.exactReadbackCheckpoints,
  });
}

function validateReviewEvidence(evidence, target) {
  assertExactKeys(evidence, [
    "contract", "address", "providerMatch", "creationMatch", "runtimeMatch",
    "providerClassification", "matchId", "verifiedAt", "responseSha256",
    "standardJsonInputSha256", "metadataSha256", "creationRecompiledKeccak256",
    "creationOnchainKeccak256", "runtimeRecompiledKeccak256",
    "runtimeOnchainKeccak256", "transformationPolicy",
  ], `Sourcify review ${target.contract} evidence`);
  if (evidence.contract !== target.contract || evidence.address !== target.address
    || evidence.providerMatch !== "match" || evidence.creationMatch !== "match"
    || evidence.runtimeMatch !== "match"
    || evidence.providerClassification !== ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION
    || !/^[1-9][0-9]*$/u.test(evidence.matchId)
    || !/^sha256:[0-9a-f]{64}$/u.test(evidence.responseSha256)
    || evidence.standardJsonInputSha256 !== target.standardJsonInputSha256
    || evidence.metadataSha256 !== target.metadataSha256
    || evidence.creationRecompiledKeccak256 !== target.bytecode.creationRecompiledKeccak256
    || evidence.creationOnchainKeccak256 !== target.bytecode.creationOnchainKeccak256
    || evidence.runtimeRecompiledKeccak256 !== target.bytecode.runtimeRecompiledKeccak256
    || evidence.runtimeOnchainKeccak256 !== target.bytecode.runtimeOnchainKeccak256
    || evidence.transformationPolicy
      !== "constructor-arguments-and-compiled-immutables-only"
    || !Number.isFinite(Date.parse(evidence.verifiedAt))
    || new Date(evidence.verifiedAt).toISOString() !== evidence.verifiedAt) {
    fail(`Sourcify review ${target.contract} evidence differs`);
  }
}

export async function readRobinhoodSourcifyReviewArtifact(file) {
  const resolved = path.resolve(file);
  const parent = path.dirname(resolved);
  const [physicalFile, physicalParent, fileStats, parentStats] = await Promise.all([
    realpath(resolved), realpath(parent), lstat(resolved), stat(parent),
  ]);
  const uid = process.getuid?.();
  if (physicalFile !== resolved || physicalParent !== parent || !fileStats.isFile()
    || fileStats.nlink !== 1 || (fileStats.mode & 0o777) !== 0o600
    || (uid !== undefined && (fileStats.uid !== uid || parentStats.uid !== uid))
    || !parentStats.isDirectory() || (parentStats.mode & 0o077) !== 0) {
    fail("Sourcify review plan is not an owner-protected regular file");
  }
  const bytes = await readFile(resolved);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_REVIEW_BYTES) {
    fail("Sourcify review plan is empty or oversized");
  }
  const value = parseStrictJson(decodeExactUtf8(bytes, "Sourcify review plan"), {
    maximumBytes: bytes.byteLength,
  });
  if (!Buffer.from(`${canonicalizeJson(value)}\n`, "utf8").equals(bytes)) {
    fail("Sourcify review plan bytes are not canonical one-LF JSON");
  }
  assertExactKeys(value, ["schemaVersion", "review", "reviewDigest"],
    "Sourcify review artifact");
  assertExactKeys(value.review, [
    "mode", "externalAction", "plan", "authorizationDigest", "legalNotice",
    "externalEffects", "providerApi", "targets",
  ], "Sourcify review");
  if (value.schemaVersion !== REVIEW_SCHEMA || value.review?.mode !== "review-only"
    || value.review?.externalAction !== false) {
    fail("Sourcify review artifact identity differs");
  }
  const expected = sha256Digest(Buffer.from(canonicalizeJson({
    ...value,
    reviewDigest: null,
  }), "utf8"));
  if (value.reviewDigest !== expected) fail("Sourcify review artifact digest differs");
  const plan = validateRobinhoodSourcifyPublicationPlan(value.review.plan);
  const authorization = robinhoodSourcifyPublicationAuthorizationDigest(plan);
  assertExactKeys(value.review.providerApi, ["openapiSha256", "chainsSha256"],
    "Sourcify review provider API");
  if (value.review.authorizationDigest !== authorization
    || value.review.legalNotice !== ROBINHOOD_SOURCIFY_LICENSE_NOTICE
    || canonicalizeJson(value.review.externalEffects)
      !== canonicalizeJson(plan.externalEffects)
    || !/^sha256:[0-9a-f]{64}$/u.test(value.review.providerApi.openapiSha256)
    || !/^sha256:[0-9a-f]{64}$/u.test(value.review.providerApi.chainsSha256)
    || !Array.isArray(value.review.targets)
    || value.review.targets.length !== plan.targets.length) {
    fail("Sourcify review display or provider closure differs");
  }
  for (const [index, target] of plan.targets.entries()) {
    const reviewedTarget = value.review.targets[index];
    assertExactKeys(reviewedTarget, ["contract", "state", "evidence"],
      `Sourcify review target ${index}`);
    if (reviewedTarget.contract !== target.contract
      || !new Set(["missing", "verified"]).has(reviewedTarget.state)
      || (reviewedTarget.state === "missing" && reviewedTarget.evidence !== null)
      || (reviewedTarget.state === "verified" && reviewedTarget.evidence === null)) {
      fail(`Sourcify review target ${index} differs`);
    }
    if (reviewedTarget.state === "verified") {
      validateReviewEvidence(reviewedTarget.evidence, target);
    }
  }
  return Object.freeze({ value, plan, authorization });
}

export async function openRobinhoodSourcifyRecoveryMarker(
  file,
  reviewed,
  {
    sourceRoot = repositoryRoot,
    temporaryRoot = tmpdir(),
    uid = process.getuid?.(),
    fileSystem = DEFAULT_FILE_SYSTEM,
  } = {},
) {
  const resolved = path.resolve(file);
  const sourceRelative = path.relative(path.resolve(sourceRoot), resolved);
  const temporaryRelative = path.relative(path.resolve(temporaryRoot), resolved);
  if (sourceRelative === "" || (!sourceRelative.startsWith("..")
    && !path.isAbsolute(sourceRelative))
    || temporaryRelative === "" || (!temporaryRelative.startsWith("..")
      && !path.isAbsolute(temporaryRelative))) {
    fail("Sourcify recovery marker must remain outside source and temporary roots");
  }
  const parent = path.dirname(resolved);
  await assertOwnerOnlyOutputParent(parent, uid, fileSystem);
  if (await fileSystem.realpath(resolved) !== resolved) {
    fail("Sourcify recovery marker must be one physical file");
  }
  const handle = await fileSystem.open(
    resolved,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  let metadata;
  let bytes;
  try {
    metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1
      || (uid !== undefined && metadata.uid !== uid)
      || (metadata.mode & 0o777) !== 0o600 || metadata.size < 1
      || metadata.size > MAX_ATTEMPT_BYTES) {
      fail("Sourcify recovery marker is not an owner-only bounded regular file");
    }
    bytes = await handle.readFile();
    const linked = await fileSystem.lstat(resolved);
    if (bytes.byteLength !== metadata.size || linked.dev !== metadata.dev
      || linked.ino !== metadata.ino || linked.nlink !== 1) {
      fail("Sourcify recovery marker changed while read");
    }
  } finally {
    await handle.close();
  }
  const value = parseStrictJson(decodeExactUtf8(bytes, "Sourcify recovery marker"), {
    maximumBytes: bytes.byteLength,
  });
  if (!canonicalArtifactBytes(value).equals(bytes)) {
    fail("Sourcify recovery marker is not canonical one-LF JSON");
  }
  const marker = validateRobinhoodSourcifyAttemptMarker(value, reviewed);
  const reservation = {
    path: resolved,
    parent,
    handle: null,
    closed: true,
    identity: metadata,
    contentSha256: sha256Digest(bytes),
    externalActionPossible: true,
    finalized: false,
    fileSystem,
    uid,
  };
  return Object.freeze({ marker, output: buildOutputReservation(reservation) });
}

export async function commitRobinhoodSourcifyReceipt({
  output,
  receipt,
  expectedSource,
  inspectSource,
  driftMessage,
}) {
  const written = await output.commit(receipt);
  const closingSource = await inspectSource();
  if (!sameSource(closingSource, expectedSource)) {
    fail(`${driftMessage}; receipt retained at ${written}`);
  }
  return written;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseRobinhoodSourcifyArguments(argv);
  if (options.mode === "review") {
    const reservation = await reserveRobinhoodSourcifyOutput(options.output);
    try {
      const prepared = await prepareRobinhoodSourcifyPublication({
        repositoryRoot,
        creationTransactionHash: options.creationTransactionHash,
      });
      const review = await inspectRobinhoodSourcifyPublication({ prepared });
      const artifact = buildRobinhoodSourcifyReviewArtifact(review);
      const output = await reservation.commit(artifact);
      process.stdout.write(`${canonicalizeJson({
        mode: "review-only",
        externalAction: false,
        output,
        planDigest: review.plan.planDigest,
        authorizationDigest: review.authorizationDigest,
        reviewDigest: artifact.reviewDigest,
        externalEffects: review.externalEffects,
      })}\n`);
      return;
    } catch (error) {
      await reservation.abort();
      throw error;
    }
  }
  const reviewed = await readRobinhoodSourcifyReviewArtifact(options.reviewPlan);
  if (options.mode === "submit" && options.authorizationDigest !== reviewed.authorization) {
    fail("--acknowledge-publication-digest differs from the protected review plan");
  }
  if (options.mode === "recover") {
    const recovery = await openRobinhoodSourcifyRecoveryMarker(
      options.recoveryMarker,
      reviewed,
    );
    try {
      const prepared = await prepareRobinhoodSourcifyPublication({
        repositoryRoot,
        creationTransactionHash: reviewed.plan.creationTransactionHash,
      });
      if (canonicalizeJson(prepared.plan) !== canonicalizeJson(reviewed.plan)) {
        fail("Protected source or publication plan changed before read-only recovery");
      }
      const receipt = await attestRobinhoodSourcifyPublication({ prepared });
      const sourceBeforeWrite = await inspectRobinhoodSourcifyProtectedSource({ repositoryRoot });
      if (!sameSource(sourceBeforeWrite, prepared.plan.sourceOrigin)) {
        fail("Protected production source changed during read-only Sourcify recovery");
      }
      const output = await commitRobinhoodSourcifyReceipt({
        output: recovery.output,
        receipt,
        expectedSource: prepared.plan.sourceOrigin,
        inspectSource: () => inspectRobinhoodSourcifyProtectedSource({ repositoryRoot }),
        driftMessage: "Protected production source changed after recovered Sourcify receipt write",
      });
      process.stdout.write(`${canonicalizeJson({
        mode: "recovered-and-read-back",
        externalAction: false,
        output,
        planDigest: receipt.planDigest,
        receiptDigest: receipt.receiptDigest,
        providerClassification: receipt.providerClassification,
        externalEffects: receipt.externalEffects,
      })}\n`);
      return;
    } catch (error) {
      await recovery.output.abort();
      throw error;
    }
  }
  const reservation = await reserveRobinhoodSourcifyOutput(options.output);
  try {
    const prepared = await prepareRobinhoodSourcifyPublication({
      repositoryRoot,
      creationTransactionHash: reviewed.plan.creationTransactionHash,
    });
    if (canonicalizeJson(prepared.plan) !== canonicalizeJson(reviewed.plan)) {
      fail("Protected source or publication plan changed after review");
    }
    const attemptedTargets = [];
    const exactReadbackCheckpoints = [];
    const receipt = await submitRobinhoodSourcifyPublication({
      prepared,
      authorizationDigest: options.authorizationDigest,
      licenseAcknowledgement: options.legalAcknowledgement,
      revalidateSource: async (expected) => {
        const current = await inspectRobinhoodSourcifyProtectedSource({ repositoryRoot });
        if (!sameSource(current, expected)) {
          fail("Protected production source changed before Sourcify POST");
        }
      },
      onBeforePost: async (target, plan) => {
        const marker = buildRobinhoodSourcifyAttemptMarker({
          reviewDigest: reviewed.value.reviewDigest,
          plan,
          authorizationDigest: reviewed.authorization,
          attemptedTargets: [...attemptedTargets, target],
          exactReadbackCheckpoints,
        });
        await reservation.markAttempt(marker);
        attemptedTargets.push(target);
      },
      onExactTargetReadback: async (result, plan) => {
        if (reservation.externalActionPossible()) {
          const marker = buildRobinhoodSourcifyAttemptMarker({
            reviewDigest: reviewed.value.reviewDigest,
            plan,
            authorizationDigest: reviewed.authorization,
            attemptedTargets,
            exactReadbackCheckpoints: [...exactReadbackCheckpoints, result],
          });
          await reservation.markAttempt(marker);
        }
        exactReadbackCheckpoints.push(result);
      },
    });
    const sourceBeforeWrite = await inspectRobinhoodSourcifyProtectedSource({ repositoryRoot });
    if (!sameSource(sourceBeforeWrite, prepared.plan.sourceOrigin)) {
      fail("Protected production source changed during Sourcify publication");
    }
    const output = await commitRobinhoodSourcifyReceipt({
      output: reservation,
      receipt,
      expectedSource: prepared.plan.sourceOrigin,
      inspectSource: () => inspectRobinhoodSourcifyProtectedSource({ repositoryRoot }),
      driftMessage: "Protected production source changed after Sourcify receipt write",
    });
    process.stdout.write(`${canonicalizeJson({
      mode: "submitted-and-read-back",
      externalAction: receipt.externalActionThisRun,
      output,
      planDigest: receipt.planDigest,
      receiptDigest: receipt.receiptDigest,
      providerClassification: receipt.providerClassification,
      externalEffects: receipt.externalEffects,
    })}\n`);
  } catch (error) {
    await reservation.abort();
    throw error;
  }
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`Robinhood Sourcify v2 operator failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
