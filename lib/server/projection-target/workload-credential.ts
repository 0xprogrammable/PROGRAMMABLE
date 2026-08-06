import "server-only";

import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from "node:crypto";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "./canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "./hashing";
import {
  createProjectionTargetCredentialVerifierV1,
  type ProjectionTargetCredentialPreflightRequestV2,
  type ProjectionTargetCredentialClaimsV1,
  type ProjectionTargetCredentialVerificationRequestV1,
  type ProjectionTargetCredentialVerifierV1,
  type ProjectionTargetLaneV1,
} from "./protocol";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const SAFE_PROJECTION_KEY = /^[^\u0000-\u001f\u007f]{1,512}$/u;
const MAXIMUM_JWT_BYTES = 8_192;

export interface ProjectionWorkloadJwtConfigurationV1 {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly targetBindings: Readonly<
    Partial<Record<ProjectionTargetLaneV1, Sha256Digest>>
  >;
  readonly now?: () => Date;
}

interface ValidatedProjectionWorkloadJwtConfigurationV1 {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly keyId: string;
  readonly publicKey: KeyObject;
  readonly publicKeySpkiSha256: Sha256Digest;
  readonly targetBindings: ReadonlyMap<ProjectionTargetLaneV1, Sha256Digest>;
  readonly now: () => Date;
}

interface WorkloadTokenPayloadV2 {
  schemaVersion: "programmable.projection-workload-access-token.v2";
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  method: "GET" | "PUT";
  lane: ProjectionTargetLaneV1;
  targetBindingHash: Sha256Digest;
  projectionKey: string;
  idempotencyKey?: Sha256Digest;
  requestDigest?: Sha256Digest;
}

/**
 * Verifies a short-lived Ed25519 JWT issued by the configured workload token
 * exchange. No static bearer-token equality or caller-provided auth Boolean is
 * accepted.
 */
export function createEd25519ProjectionWorkloadCredentialVerifierV1(
  input: ProjectionWorkloadJwtConfigurationV1,
): ProjectionTargetCredentialVerifierV1 {
  const configuration = validateConfiguration(input);
  const verifierBindingHash = canonicalSha256(
    "programmable.website-projection-workload-verifier.v2",
    {
      issuer: configuration.issuer,
      subject: configuration.subject,
      audience: configuration.audience,
      keyId: configuration.keyId,
      publicKeySpkiSha256: configuration.publicKeySpkiSha256,
      targetBindings: Object.fromEntries(configuration.targetBindings),
      algorithm: "Ed25519",
      tokenSchemaVersion:
        "programmable.projection-workload-access-token.v2",
    },
  );

  return createProjectionTargetCredentialVerifierV1({
    verifierBindingHash,
    now: configuration.now,
    async preflightBearer(request) {
      return preflightWorkloadJwt(configuration, request);
    },
    async verifyBearer(request) {
      return verifyWorkloadJwt(configuration, request);
    },
  });
}

function preflightWorkloadJwt(
  configuration: Readonly<ValidatedProjectionWorkloadJwtConfigurationV1>,
  request: ProjectionTargetCredentialPreflightRequestV2,
): boolean {
  request.signal.throwIfAborted();
  try {
    const payload = verifiedWorkloadTokenPayload(configuration, request.bearerToken);
    return staticWorkloadClaimsMatch(configuration, payload, request)
      && payload.method === "PUT"
      && payload.idempotencyKey === request.idempotencyKey
      && typeof payload.requestDigest === "string"
      && DIGEST.test(payload.requestDigest);
  } catch {
    return false;
  }
}

function verifyWorkloadJwt(
  configuration: Readonly<ValidatedProjectionWorkloadJwtConfigurationV1>,
  request: ProjectionTargetCredentialVerificationRequestV1,
): ProjectionTargetCredentialClaimsV1 | null {
  request.signal.throwIfAborted();
  try {
    const payload = verifiedWorkloadTokenPayload(configuration, request.bearerToken);
    const issuedAtMs = numericDate(payload.iat, "workload token iat");
    const expiresAtMs = numericDate(payload.exp, "workload token exp");
    if (
      !staticWorkloadClaimsMatch(configuration, payload, request)
      || (payload.method === "PUT"
        ? payload.idempotencyKey !== request.idempotencyKey
          || payload.requestDigest !== request.requestDigest
          || typeof payload.idempotencyKey !== "string"
          || !DIGEST.test(payload.idempotencyKey)
          || typeof payload.requestDigest !== "string"
          || !DIGEST.test(payload.requestDigest)
        : request.idempotencyKey !== null || request.requestDigest !== null)
    ) return null;

    return Object.freeze({
      schemaVersion: "programmable.projection-target-credential-claims.v2",
      principalId: configuration.subject,
      credentialId: payload.jti,
      credentialTokenHash:
        `sha256:${createHash("sha256").update(request.bearerToken, "utf8").digest("hex")}`,
      method: request.method,
      lane: request.lane,
      audience: request.audience,
      targetBindingHash: request.targetBindingHash,
      projectionKey: request.projectionKey,
      idempotencyKey: request.idempotencyKey,
      requestDigest: request.requestDigest,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  } catch {
    return null;
  }
}

function verifiedWorkloadTokenPayload(
  configuration: Readonly<ValidatedProjectionWorkloadJwtConfigurationV1>,
  bearerToken: string,
): WorkloadTokenPayloadV2 {
  const segments = bearerToken.split(".");
  if (segments.length !== 3 || Buffer.byteLength(bearerToken, "utf8") > MAXIMUM_JWT_BYTES) {
    throw new TypeError("workload token is invalid");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  if (encodedHeader === undefined || encodedPayload === undefined
    || encodedSignature === undefined) {
    throw new TypeError("workload token is invalid");
  }
  const header = jsonRecord(
    decodeCanonicalSegment(encodedHeader, 4_096),
    "workload token header",
  );
  exactKeys(header, ["alg", "kid", "typ"]);
  if (header.alg !== "EdDSA" || header.typ !== "JWT"
    || header.kid !== configuration.keyId) {
    throw new TypeError("workload token header is invalid");
  }
  const signature = decodeBase64Url(encodedSignature, 64);
  if (signature.byteLength !== 64 || !verify(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
    configuration.publicKey,
    signature,
  )) throw new TypeError("workload token signature is invalid");
  const payload = jsonRecord(
    decodeCanonicalSegment(encodedPayload, 16_384),
    "workload token payload",
  ) as unknown as WorkloadTokenPayloadV2;
  exactKeys(payload, [
    "aud", "exp", "iat", "iss", "jti", "lane", "method", "projectionKey",
    "schemaVersion", "sub", "targetBindingHash",
    ...(payload.method === "PUT" ? ["idempotencyKey", "requestDigest"] : []),
  ]);
  return payload;
}

function staticWorkloadClaimsMatch(
  configuration: Readonly<ValidatedProjectionWorkloadJwtConfigurationV1>,
  payload: WorkloadTokenPayloadV2,
  request: Readonly<{
    lane: ProjectionTargetLaneV1;
    audience: string;
    targetBindingHash: Sha256Digest;
    method: "GET" | "PUT";
    projectionKey: string;
  }>,
): boolean {
  const configuredTarget = configuration.targetBindings.get(request.lane);
  const nowMs = configuration.now().getTime();
  const issuedAtMs = numericDate(payload.iat, "workload token iat");
  const expiresAtMs = numericDate(payload.exp, "workload token exp");
  return payload.schemaVersion === "programmable.projection-workload-access-token.v2"
    && payload.iss === configuration.issuer
    && payload.sub === configuration.subject
    && payload.aud === configuration.audience
    && payload.aud === request.audience
    && payload.method === request.method
    && payload.lane === request.lane
    && configuredTarget !== undefined
    && configuredTarget === request.targetBindingHash
    && payload.targetBindingHash === request.targetBindingHash
    && payload.projectionKey === request.projectionKey
    && SAFE_PROJECTION_KEY.test(payload.projectionKey)
    && SAFE_ID.test(payload.jti)
    && Number.isFinite(nowMs)
    && issuedAtMs <= nowMs
    && expiresAtMs > nowMs
    && expiresAtMs > issuedAtMs
    && expiresAtMs - issuedAtMs <= 600_000;
}

function validateConfiguration(
  input: ProjectionWorkloadJwtConfigurationV1,
): Readonly<ValidatedProjectionWorkloadJwtConfigurationV1> {
  const issuer = safeId(input.issuer, "workload issuer");
  const subject = safeId(input.subject, "workload subject");
  const audience = safeId(input.audience, "workload audience");
  const keyId = safeId(input.keyId, "workload key id");
  if (typeof input.publicKeyPem !== "string" || input.publicKeyPem.length > 16_384) {
    throw new TypeError("workload public key is invalid");
  }
  const publicKey = createPublicKey(input.publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("workload public key must be Ed25519");
  }
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const targetBindings = new Map<ProjectionTargetLaneV1, Sha256Digest>();
  for (const [lane, binding] of Object.entries(input.targetBindings)) {
    if (!isLane(lane) || typeof binding !== "string" || !DIGEST.test(binding)) {
      throw new TypeError("workload projection target binding is invalid");
    }
    targetBindings.set(lane, binding as Sha256Digest);
  }
  if (targetBindings.size < 1) {
    throw new TypeError("workload verifier requires one projection target");
  }
  if (input.now !== undefined && typeof input.now !== "function") {
    throw new TypeError("workload verifier clock is invalid");
  }
  return Object.freeze({
    issuer,
    subject,
    audience,
    keyId,
    publicKey,
    publicKeySpkiSha256:
      `sha256:${createHash("sha256").update(publicKeyDer).digest("hex")}`,
    targetBindings,
    now: input.now ?? (() => new Date()),
  });
}

function decodeCanonicalSegment(value: string, maximumBytes: number): JsonValue {
  const decoded = decodeBase64Url(value, maximumBytes);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  const parsed = parseStrictJson(source, { maximumBytes, maximumDepth: 32 });
  if (canonicalizeJson(parsed) !== source) {
    throw new TypeError("workload JWT segment is not canonical JSON");
  }
  return parsed;
}

function decodeBase64Url(value: string, maximumBytes: number): Buffer {
  if (!BASE64URL.test(value) || value.includes("=") || value.length > maximumBytes * 2) {
    throw new TypeError("workload JWT segment is invalid");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.byteLength > maximumBytes
    || decoded.toString("base64url") !== value
  ) {
    throw new TypeError("workload JWT segment is not canonical base64url");
  }
  return decoded;
}

function jsonRecord(
  value: JsonValue | undefined,
  label: string,
): Readonly<Record<string, JsonValue>> {
  if (value === null || value === undefined || Array.isArray(value)
    || typeof value !== "object") {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function exactKeys(value: object, expected: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    keys.length !== sorted.length
    || keys.some((key, index) => key !== sorted[index])
  ) throw new TypeError("workload JWT fields are invalid");
}

function numericDate(value: JsonValue, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return (value as number) * 1_000;
}

function safeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function isLane(value: string): value is ProjectionTargetLaneV1 {
  return value === "registry.publication"
    || value === "website.entitlement"
    || value === "registry.custom-launched"
    || value === "website.custom-launched";
}
