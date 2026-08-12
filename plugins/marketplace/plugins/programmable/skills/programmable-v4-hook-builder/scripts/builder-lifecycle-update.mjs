import crypto from "node:crypto";
import { canonicalJson } from "./submission-core.mjs";
import {
  BUILDER_LIFECYCLE_SCHEMA_VERSION,
  RELEASE_CHANNELS,
  SHA256_PATTERN,
  TEST_ONLY_KEY_IDS,
  TEST_ONLY_PIN_PREFIX,
  BuilderLifecycleError,
  assertExactKeys,
  assertPlainObject,
  cloneJson,
  compareDecimal,
  compareSemver,
  compareText,
  decodeCanonicalBase64Url,
  digestCanonical,
  invalid,
  normalizeTimestamp,
  parseSemver,
  requireDecimal,
  requireKeyId,
  requireText,
  timestampMs
} from "./builder-lifecycle-shared.mjs";
import {
  validEvidenceCoordinates,
  validateEvidenceMap
} from "./builder-lifecycle-evidence.mjs";

export function checkSignedUpdate({ state, signedUpdate, trustedPin, now }) {
  validateInstalledState(state);
  const verified = verifySignedUpdate({ state, signedUpdate, trustedPin, now });
  const currentVersion = parseSemver(state.releaseVersion, "state.releaseVersion");
  const targetVersion = parseSemver(verified.payload.releaseVersion, "update.payload.releaseVersion");
  const versionOrder = compareSemver(targetVersion, currentVersion);
  const sequenceOrder = compareDecimal(verified.payload.releaseSequence, state.releaseSequence);

  if (versionOrder < 0 || sequenceOrder < 0) {
    throw new BuilderLifecycleError(
      "UPDATE_DOWNGRADE_REJECTED",
      "the authenticated update would downgrade release version or release sequence"
    );
  }
  if ((versionOrder === 0) !== (sequenceOrder === 0)) {
    throw new BuilderLifecycleError(
      "UPDATE_VERSION_SEQUENCE_CONFLICT",
      "release version and release sequence must advance together"
    );
  }
  if (compareSemver(currentVersion, parseSemver(verified.payload.minimumInstalledVersion, "update.payload.minimumInstalledVersion")) < 0) {
    throw new BuilderLifecycleError(
      "UPDATE_INTERMEDIATE_REQUIRED",
      "the installed release is older than the authenticated update's minimum supported version"
    );
  }
  let majorStandardChange = false;
  for (const field of ["skill", "engine", "policy", "schema", "submission"]) {
    const installedStandard = parseSemver(state.standards[field], `state.standards.${field}`);
    const candidateStandard = parseSemver(verified.payload.standards[field], `update.payload.standards.${field}`);
    if (compareSemver(candidateStandard, installedStandard) < 0) {
      throw new BuilderLifecycleError(
        "UPDATE_STANDARD_DOWNGRADE_REJECTED",
        `the authenticated update would downgrade the ${field} standard`
      );
    }
    if (candidateStandard.major !== installedStandard.major) majorStandardChange = true;
  }

  let status = "update-available";
  let blocker = null;
  if (verified.payload.channel !== state.channel) {
    status = "channel-mismatch";
    blocker = `installed channel is ${state.channel}; authenticated update is ${verified.payload.channel}`;
  } else if (versionOrder === 0) {
    status = "up-to-date";
  } else if (targetVersion.major !== currentVersion.major || majorStandardChange) {
    status = "major-migration-required";
    blocker = "a major release requires explicit migration review and consent";
  } else if (verified.payload.migration.required) {
    status = "migration-required";
    blocker = "the authenticated update requires an explicit field-by-field migration dry-run";
  }

  const fixtureOnly = trustedPin.pinId.startsWith(TEST_ONLY_PIN_PREFIX) || TEST_ONLY_KEY_IDS.has(trustedPin.keyId);
  return {
    kind: "builder-update-check",
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    installed: {
      channel: state.channel,
      publicationState: "not-verified",
      releaseSequence: state.releaseSequence,
      releaseVersion: state.releaseVersion,
      standards: cloneJson(state.standards)
    },
    candidate: {
      channel: verified.payload.channel,
      publicationState: "not-verified",
      releaseSequence: verified.payload.releaseSequence,
      releaseVersion: verified.payload.releaseVersion,
      standards: cloneJson(verified.payload.standards),
      releasedAt: verified.payload.releasedAt,
      validUntil: verified.payload.validUntil,
      payloadSha256: verified.payloadSha256,
      artifacts: cloneJson(verified.payload.artifacts),
      evidence: cloneJson(verified.payload.evidence)
    },
    verification: {
      authenticated: true,
      authenticationScope: fixtureOnly ? "test-fixture-only" : "supplied-pinned-local-update",
      fixtureOnly,
      authenticatedToSuppliedInstalledPin: true,
      productionTrustEstablishedByThisCommand: false,
      keyId: verified.keyId,
      pinId: trustedPin.pinId,
      pinSha256: verified.pinSha256,
      signatureValid: true,
      timeValidAt: verified.now
    },
    status,
    blocker,
    compatibleUpdate: status === "update-available" && !fixtureOnly,
    activationAllowedThisSession: false,
    migrationDryRunRequired: new Set(["major-migration-required", "migration-required"]).has(status),
    historicalStandardsPreserved: true,
    networkAccessed: false,
    externalActionsPerformed: [],
    nextAction: nextUpdateAction(status, fixtureOnly)
  };
}

export function verifySignedUpdate({ state, signedUpdate, trustedPin, now }) {
  validateInstalledState(state);
  assertPlainObject(trustedPin, "trusted pin");
  assertExactKeys(
    trustedPin,
    ["schemaVersion", "pinId", "keyId", "publicKey", "validFrom", "validUntil", "channels", "minimumReleaseSequence"],
    "trusted pin"
  );
  if (trustedPin.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION) invalid("TRUST_PIN_INVALID", "unsupported trusted pin schema");
  requireText(trustedPin.pinId, "trusted pin id");
  requireKeyId(trustedPin.keyId, "trusted pin key id");
  const rawPublicKey = decodeCanonicalBase64Url(trustedPin.publicKey, 32, "trusted pin public key");
  const derivedKeyId = crypto.createHash("sha256").update(rawPublicKey).digest("hex");
  if (derivedKeyId !== trustedPin.keyId) invalid("TRUST_PIN_INVALID", "trusted pin key id does not match its public key");
  if (!Array.isArray(trustedPin.channels) || trustedPin.channels.length === 0 || trustedPin.channels.some((channel) => !RELEASE_CHANNELS.has(channel))) {
    invalid("TRUST_PIN_INVALID", "trusted pin channels are invalid");
  }
  if (new Set(trustedPin.channels).size !== trustedPin.channels.length) invalid("TRUST_PIN_INVALID", "trusted pin channels contain duplicates");
  requireDecimal(trustedPin.minimumReleaseSequence, "trusted pin minimum release sequence");

  const normalizedNow = normalizeTimestamp(now, "trusted time");
  const pinValidFrom = timestampMs(trustedPin.validFrom, "trusted pin validFrom");
  const pinValidUntil = timestampMs(trustedPin.validUntil, "trusted pin validUntil");
  const nowMs = timestampMs(normalizedNow, "trusted time");
  if (pinValidFrom > pinValidUntil || nowMs < pinValidFrom || nowMs > pinValidUntil) {
    throw new BuilderLifecycleError("TRUST_PIN_STALE", "trusted pin is not valid at the supplied trusted time");
  }
  const pinSha256 = digestCanonical(trustedPin);
  if (pinSha256 !== state.trustedPinSha256 || trustedPin.keyId !== state.trustedKeyId) {
    throw new BuilderLifecycleError("TRUST_PIN_MISMATCH", "trusted pin does not match the installed pinned trust identity");
  }

  assertPlainObject(signedUpdate, "signed update");
  assertExactKeys(signedUpdate, ["payload", "signature"], "signed update");
  validateUpdatePayload(signedUpdate.payload);
  validateUpdateSignature(signedUpdate.signature);
  if (!trustedPin.channels.includes(signedUpdate.payload.channel)) {
    throw new BuilderLifecycleError("UPDATE_CHANNEL_UNTRUSTED", "trusted pin does not authorize the update channel");
  }
  if (compareDecimal(signedUpdate.payload.releaseSequence, trustedPin.minimumReleaseSequence) < 0) {
    throw new BuilderLifecycleError("UPDATE_PIN_ROLLBACK", "update sequence is older than the trusted pin minimum");
  }
  if (signedUpdate.signature.keyId !== trustedPin.keyId) {
    throw new BuilderLifecycleError("UPDATE_SIGNATURE_KEY_MISMATCH", "update signature key does not match the trusted pin");
  }
  const issuedAt = timestampMs(signedUpdate.signature.issuedAt, "update signature issuedAt");
  const signatureValidUntil = timestampMs(signedUpdate.signature.validUntil, "update signature validUntil");
  const payloadValidUntil = timestampMs(signedUpdate.payload.validUntil, "update payload validUntil");
  if (issuedAt > signatureValidUntil || nowMs < issuedAt || nowMs > signatureValidUntil || nowMs > payloadValidUntil) {
    throw new BuilderLifecycleError("UPDATE_SIGNATURE_STALE", "update signature or payload is not valid at the supplied trusted time");
  }
  if (signatureValidUntil > payloadValidUntil) {
    throw new BuilderLifecycleError("UPDATE_SIGNATURE_WINDOW_INVALID", "update signature outlives its authenticated payload");
  }
  const payloadBytes = Buffer.from(canonicalJson(signedUpdate.payload), "utf8");
  const payloadSha256 = `sha256:${crypto.createHash("sha256").update(payloadBytes).digest("hex")}`;
  if (payloadSha256 !== signedUpdate.signature.payloadSha256) {
    throw new BuilderLifecycleError("UPDATE_PAYLOAD_HASH_MISMATCH", "update payload hash does not match the signature envelope");
  }
  const signatureBytes = decodeCanonicalBase64Url(signedUpdate.signature.signature, 64, "update signature");
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawPublicKey]);
  const publicKey = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  if (!crypto.verify(null, payloadBytes, publicKey, signatureBytes)) {
    throw new BuilderLifecycleError("UPDATE_SIGNATURE_INVALID", "update signature is invalid");
  }

  return {
    payload: cloneJson(signedUpdate.payload),
    payloadSha256,
    keyId: trustedPin.keyId,
    pinSha256,
    now: normalizedNow
  };
}

export function validateInstalledState(state) {
  assertPlainObject(state, "installed state");
  assertExactKeys(
    state,
    ["schemaVersion", "releaseVersion", "releaseSequence", "channel", "standards", "trustedPinSha256", "trustedKeyId"],
    "installed state"
  );
  if (state.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION) invalid("STATE_INVALID", "unsupported installed state schema");
  parseSemver(state.releaseVersion, "state.releaseVersion");
  requireDecimal(state.releaseSequence, "state.releaseSequence");
  if (!RELEASE_CHANNELS.has(state.channel)) invalid("STATE_INVALID", "installed channel is invalid");
  validateStandards(state.standards, "state.standards");
  if (!SHA256_PATTERN.test(state.trustedPinSha256 ?? "")) invalid("STATE_INVALID", "installed trust pin digest is invalid");
  requireKeyId(state.trustedKeyId, "installed trusted key id");
}

export function validateUpdatePayload(payload) {
  assertPlainObject(payload, "update payload");
  assertExactKeys(
    payload,
    ["schemaVersion", "releaseSequence", "channel", "releaseVersion", "minimumInstalledVersion", "releasedAt", "validUntil", "standards", "migration", "artifacts", "evidence"],
    "update payload"
  );
  if (payload.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION) invalid("UPDATE_PAYLOAD_INVALID", "unsupported update payload schema");
  requireDecimal(payload.releaseSequence, "update releaseSequence");
  if (!RELEASE_CHANNELS.has(payload.channel)) invalid("UPDATE_PAYLOAD_INVALID", "update channel is invalid");
  const version = parseSemver(payload.releaseVersion, "update releaseVersion");
  parseSemver(payload.minimumInstalledVersion, "update minimumInstalledVersion");
  if (payload.channel === "stable" && version.prerelease.length > 0) invalid("UPDATE_PAYLOAD_INVALID", "stable update cannot be a prerelease");
  const releasedAt = timestampMs(payload.releasedAt, "update releasedAt");
  const validUntil = timestampMs(payload.validUntil, "update validUntil");
  if (releasedAt > validUntil) invalid("UPDATE_PAYLOAD_INVALID", "update validity ends before release time");
  validateStandards(payload.standards, "update standards");
  assertPlainObject(payload.migration, "update migration");
  assertExactKeys(payload.migration, ["required", "fromStandard", "toStandard", "majorConsentRequired"], "update migration");
  if (typeof payload.migration.required !== "boolean" || typeof payload.migration.majorConsentRequired !== "boolean") invalid("UPDATE_PAYLOAD_INVALID", "update migration booleans are invalid");
  parseSemver(payload.migration.fromStandard, "update migration fromStandard");
  parseSemver(payload.migration.toStandard, "update migration toStandard");
  if (payload.migration.toStandard !== payload.standards.submission) invalid("UPDATE_PAYLOAD_INVALID", "migration target and submission standard disagree");
  if (!Array.isArray(payload.artifacts) || payload.artifacts.length === 0 || payload.artifacts.length > 64) invalid("UPDATE_PAYLOAD_INVALID", "update artifacts are invalid");
  const artifactIds = new Set();
  for (const artifact of payload.artifacts) {
    assertPlainObject(artifact, "update artifact");
    assertExactKeys(artifact, ["id", "bytes", "sha256"], "update artifact");
    requireText(artifact.id, "update artifact id");
    if (artifactIds.has(artifact.id)) invalid("UPDATE_PAYLOAD_INVALID", "update artifact ids must be unique");
    artifactIds.add(artifact.id);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 268_435_456) invalid("UPDATE_PAYLOAD_INVALID", "update artifact byte length is invalid");
    if (!SHA256_PATTERN.test(artifact.sha256 ?? "")) invalid("UPDATE_PAYLOAD_INVALID", "update artifact digest is invalid");
  }
  if (payload.artifacts.map((entry) => entry.id).join("\n") !== [...payload.artifacts].sort((a, b) => compareText(a.id, b.id)).map((entry) => entry.id).join("\n")) {
    invalid("UPDATE_PAYLOAD_INVALID", "update artifacts must be sorted by id");
  }
  validateEvidenceMap(payload.evidence, "update evidence", ["checksums", "sbom", "evals", "canary"]);
  for (const id of ["checksums", "sbom", "evals", "canary"]) {
    if (payload.evidence[id].status !== "complete" || !validEvidenceCoordinates(payload.evidence[id])) {
      invalid("UPDATE_EVIDENCE_INCOMPLETE", `update evidence ${id} must be complete and content addressed`);
    }
  }
}

export function validateUpdateSignature(signature) {
  assertPlainObject(signature, "update signature");
  assertExactKeys(signature, ["algorithm", "keyId", "issuedAt", "validUntil", "payloadSha256", "signature"], "update signature");
  if (signature.algorithm !== "Ed25519") invalid("UPDATE_SIGNATURE_INVALID", "update signature algorithm must be Ed25519");
  requireKeyId(signature.keyId, "update signature key id");
  timestampMs(signature.issuedAt, "update signature issuedAt");
  timestampMs(signature.validUntil, "update signature validUntil");
  if (!SHA256_PATTERN.test(signature.payloadSha256 ?? "")) invalid("UPDATE_SIGNATURE_INVALID", "update payload digest is invalid");
  decodeCanonicalBase64Url(signature.signature, 64, "update signature");
}

export function validateStandards(value, location) {
  assertPlainObject(value, location);
  assertExactKeys(value, ["skill", "engine", "policy", "schema", "submission"], location);
  for (const field of ["skill", "engine", "policy", "schema", "submission"]) parseSemver(value[field], `${location}.${field}`);
}

export function nextUpdateAction(status, fixtureOnly = false) {
  if (fixtureOnly) return "Use these signed bytes only to exercise the local fixture workflow; never install, trust, or publish them as a production update.";
  if (status === "update-available") return "Stage the authenticated bytes for a later session; do not activate them in this session.";
  if (status === "major-migration-required" || status === "migration-required") return "Run migrate --dry-run, review every field diff, then request explicit consent in a later step.";
  if (status === "channel-mismatch") return "Keep the installed channel or explicitly change channel policy outside this command.";
  return "No update action is required.";
}
