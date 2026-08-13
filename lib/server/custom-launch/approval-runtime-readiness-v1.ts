import "server-only";

import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";

import { isReviewAuthorityModeV1 } from
  "@/lib/custom-launch/review-authority-v1";
import {
  canonicalizeJson,
  parseStrictJson,
} from "../projection-target/canonical-json";

export const APPROVAL_RUNTIME_AGGREGATE_PATH_V1 =
  "/readyz/custom-launch/v2" as const;
export const APPROVAL_RUNTIME_AGGREGATE_AUDIENCE_V1 =
  "programmable.website.custom-launch.v2" as const;
export const APPROVAL_DESCRIPTOR_AUDIENCE_V2 =
  "programmable.custom-registry.v2" as const;

const RESPONSE_SCHEMA =
  "programmable.approval-runtime-aggregate-readiness.v1" as const;
const SIGNATURE_SCHEMA =
  "programmable.approval-runtime-aggregate-readiness-signature.v1" as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const POSITIVE_EPOCH = /^[1-9][0-9]{0,19}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const GIT_OBJECT_ID = /^[0-9a-f]{40}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const MAXIMUM_RESPONSE_BYTES = 65_536;
const REQUEST_TIMEOUT_MS = 5_000;
const MAXIMUM_CLOCK_SKEW_MS = 5_000;
const MAXIMUM_ATTESTATION_LIFETIME_MS = 60_000;

export type ApprovalRuntimeServiceBindingV1 = Readonly<{
  serviceId: string;
  deploymentId: string;
  imageDigest: `sha256:${string}`;
  configurationBindingHash: `sha256:${string}`;
  status: "ready";
}>;

export type ExpectedApprovalRuntimeAggregateBindingV1 = Readonly<{
  packageArtifactHash: `sha256:${string}`;
  sourceCommit: string;
  sourceTree: string;
  reviewAuthorityMode: "manual_review" | "autonomous_ai";
  policyCommitment: `0x${string}`;
  acceptanceSchemaSha256: `sha256:${string}`;
  descriptorAuthority: Readonly<{
    audience: typeof APPROVAL_DESCRIPTOR_AUDIENCE_V2;
    keyId: string;
    keyEpoch: string;
    publicKeySpkiSha256: `sha256:${string}`;
  }>;
  readinessAuthority: Readonly<{
    algorithm: "ed25519";
    keyId: string;
    keyEpoch: string;
    publicKeySpkiBase64Url: string;
    publicKeySpkiSha256: `sha256:${string}`;
  }>;
  services: readonly ApprovalRuntimeServiceBindingV1[];
}>;

export async function assertApprovalRuntimeAggregateReadinessV1(input: Readonly<{
  origin: URL;
  expected: ExpectedApprovalRuntimeAggregateBindingV1;
  serviceFetch: typeof fetch;
  now: () => Date;
}>): Promise<void> {
  const origin = exactOrigin(input.origin);
  parseExpectedBinding(input.expected);
  const challenge = randomBytes(32).toString("base64url");
  const url = new URL(APPROVAL_RUNTIME_AGGREGATE_PATH_V1, origin);
  url.searchParams.set("audience", APPROVAL_RUNTIME_AGGREGATE_AUDIENCE_V1);
  url.searchParams.set("challenge", challenge);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await input.serviceFetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type")
      ?.split(";", 1)[0]?.trim().toLowerCase();
    const declaredLength = response.headers.get("content-length");
    if (
      response.status !== 200
      || contentType !== "application/json"
      || (declaredLength !== null && (!/^\d+$/u.test(declaredLength)
        || Number(declaredLength) > MAXIMUM_RESPONSE_BYTES))
    ) {
      await response.body?.cancel();
      throw new TypeError("Approval aggregate readiness response is invalid");
    }
    const raw = await readBoundedResponse(response, MAXIMUM_RESPONSE_BYTES);
    verifyAggregateReadinessEnvelope(
      new TextDecoder("utf-8", { fatal: true }).decode(raw),
      challenge,
      input.expected,
      input.now(),
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function verifyAggregateReadinessEnvelope(
  raw: string,
  expectedChallenge: string,
  expectedInput: ExpectedApprovalRuntimeAggregateBindingV1,
  now: Date,
): void {
  if (!BASE64URL.test(expectedChallenge) || expectedChallenge.length !== 43) {
    throw new TypeError("Approval aggregate readiness challenge is invalid");
  }
  const expected = parseExpectedBinding(expectedInput);
  const parsed = parseStrictJson(raw, {
    maximumBytes: MAXIMUM_RESPONSE_BYTES,
    maximumDepth: 16,
  });
  if (canonicalizeJson(parsed) !== raw) {
    throw new TypeError("Approval aggregate readiness response is not canonical");
  }
  const value = exactObject(parsed, "Approval aggregate readiness envelope", [
    "audience", "challengeBase64Url", "checkedAt", "descriptorAuthority",
    "expiresAt", "readinessAuthority", "release", "schemaVersion", "services",
    "signatureBase64Url", "status",
  ]);
  if (
    value.schemaVersion !== RESPONSE_SCHEMA
    || value.audience !== APPROVAL_RUNTIME_AGGREGATE_AUDIENCE_V1
    || value.challengeBase64Url !== expectedChallenge
    || value.status !== "ready"
    || typeof value.signatureBase64Url !== "string"
    || !SIGNATURE.test(value.signatureBase64Url)
  ) throw new TypeError("Approval aggregate readiness identity is invalid");

  const checkedAt = instant(value.checkedAt, "checkedAt");
  const expiresAt = instant(value.expiresAt, "expiresAt");
  const nowMs = validNow(now);
  if (
    checkedAt > nowMs + MAXIMUM_CLOCK_SKEW_MS
    || checkedAt < nowMs - MAXIMUM_ATTESTATION_LIFETIME_MS
    || expiresAt < nowMs
    || expiresAt <= checkedAt
    || expiresAt - checkedAt > MAXIMUM_ATTESTATION_LIFETIME_MS
  ) throw new TypeError("Approval aggregate readiness validity is invalid");

  const release = parseRelease(value.release);
  const descriptorAuthority = parseDescriptorAuthority(value.descriptorAuthority);
  const readinessAuthority = parseReadinessAuthority(value.readinessAuthority);
  const services = parseServices(value.services);
  if (
    canonicalizeJson(release) !== canonicalizeJson(expected.release)
    || canonicalizeJson(descriptorAuthority)
      !== canonicalizeJson(expected.descriptorAuthority)
    || canonicalizeJson(readinessAuthority.publicIdentity)
      !== canonicalizeJson(expected.readinessAuthority.publicIdentity)
    || canonicalizeJson(services) !== canonicalizeJson(expected.services)
  ) throw new TypeError("Approval aggregate readiness binding is invalid");

  const core = Object.freeze({
    schemaVersion: RESPONSE_SCHEMA,
    audience: APPROVAL_RUNTIME_AGGREGATE_AUDIENCE_V1,
    challengeBase64Url: expectedChallenge,
    checkedAt: value.checkedAt,
    expiresAt: value.expiresAt,
    status: "ready" as const,
    release,
    descriptorAuthority,
    readinessAuthority: readinessAuthority.publicIdentity,
    services,
  });
  const signed = canonicalizeJson(Object.freeze({
    schemaVersion: SIGNATURE_SCHEMA,
    payload: core,
  }));
  if (!verifySignature(
    null,
    Buffer.from(signed, "utf8"),
    expected.readinessAuthority.publicKey,
    Buffer.from(value.signatureBase64Url, "base64url"),
  )) throw new TypeError("Approval aggregate readiness signature is invalid");
}

function parseExpectedBinding(value: ExpectedApprovalRuntimeAggregateBindingV1) {
  const object = exactObject(value, "expected Approval aggregate binding", [
    "acceptanceSchemaSha256", "descriptorAuthority", "packageArtifactHash",
    "policyCommitment", "readinessAuthority", "reviewAuthorityMode",
    "services", "sourceCommit", "sourceTree",
  ]);
  const release = parseRelease({
    packageArtifactHash: object.packageArtifactHash,
    sourceCommit: object.sourceCommit,
    sourceTree: object.sourceTree,
    reviewAuthorityMode: object.reviewAuthorityMode,
    policyCommitment: object.policyCommitment,
    acceptanceSchemaSha256: object.acceptanceSchemaSha256,
  });
  const descriptorAuthority = parseDescriptorAuthority(object.descriptorAuthority);
  const readinessAuthority = parseReadinessAuthority(object.readinessAuthority);
  const services = parseServices(object.services);
  return Object.freeze({ release, descriptorAuthority, readinessAuthority, services });
}

function parseRelease(value: unknown) {
  const object = exactObject(value, "Approval aggregate release", [
    "acceptanceSchemaSha256", "packageArtifactHash", "policyCommitment",
    "reviewAuthorityMode", "sourceCommit", "sourceTree",
  ]);
  if (!isReviewAuthorityModeV1(object.reviewAuthorityMode)) {
    throw new TypeError("Approval aggregate review authority mode is invalid");
  }
  return Object.freeze({
    packageArtifactHash: sha256(object.packageArtifactHash, "package artifact"),
    sourceCommit: gitObject(object.sourceCommit, "source commit"),
    sourceTree: gitObject(object.sourceTree, "source tree"),
    reviewAuthorityMode: object.reviewAuthorityMode,
    policyCommitment: hash32(object.policyCommitment, "policy commitment"),
    acceptanceSchemaSha256: sha256(
      object.acceptanceSchemaSha256,
      "acceptance schema",
    ),
  });
}

function parseDescriptorAuthority(value: unknown) {
  const object = exactObject(value, "Approval descriptor authority", [
    "audience", "keyEpoch", "keyId", "publicKeySpkiSha256",
  ]);
  if (object.audience !== APPROVAL_DESCRIPTOR_AUDIENCE_V2) {
    throw new TypeError("Approval descriptor audience is invalid");
  }
  return Object.freeze({
    audience: APPROVAL_DESCRIPTOR_AUDIENCE_V2,
    keyId: safeId(object.keyId, "descriptor key ID"),
    keyEpoch: epoch(object.keyEpoch, "descriptor key epoch"),
    publicKeySpkiSha256: sha256(
      object.publicKeySpkiSha256,
      "descriptor public key",
    ),
  });
}

function parseReadinessAuthority(value: unknown) {
  const object = exactObject(value, "Approval readiness authority", [
    "algorithm", "keyEpoch", "keyId", "publicKeySpkiBase64Url",
    "publicKeySpkiSha256",
  ]);
  if (
    object.algorithm !== "ed25519"
    || typeof object.publicKeySpkiBase64Url !== "string"
    || !BASE64URL.test(object.publicKeySpkiBase64Url)
  ) throw new TypeError("Approval readiness authority is invalid");
  const publicKeyBytes = Buffer.from(object.publicKeySpkiBase64Url, "base64url");
  if (publicKeyBytes.toString("base64url") !== object.publicKeySpkiBase64Url) {
    throw new TypeError("Approval readiness authority key is invalid");
  }
  const publicKeySpkiSha256 = sha256(
    object.publicKeySpkiSha256,
    "readiness public key",
  );
  if (
    `sha256:${createHash("sha256").update(publicKeyBytes).digest("hex")}`
      !== publicKeySpkiSha256
  ) throw new TypeError("Approval readiness authority key binding is invalid");
  const publicKey = createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" });
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("Approval readiness authority key is invalid");
  }
  return Object.freeze({
    publicIdentity: Object.freeze({
      algorithm: "ed25519" as const,
      keyId: safeId(object.keyId, "readiness key ID"),
      keyEpoch: epoch(object.keyEpoch, "readiness key epoch"),
      publicKeySpkiBase64Url: object.publicKeySpkiBase64Url,
      publicKeySpkiSha256,
    }),
    publicKey,
  });
}

function parseServices(value: unknown): readonly ApprovalRuntimeServiceBindingV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new TypeError("Approval runtime service set is invalid");
  }
  const identities = new Set<string>();
  const services = value.map((candidate) => {
    const object = exactObject(candidate, "Approval runtime service", [
      "configurationBindingHash", "deploymentId", "imageDigest", "serviceId",
      "status",
    ]);
    if (object.status !== "ready") {
      throw new TypeError("Approval runtime service is not ready");
    }
    const service = Object.freeze({
      serviceId: safeId(object.serviceId, "service ID"),
      deploymentId: safeId(object.deploymentId, "deployment ID"),
      imageDigest: sha256(object.imageDigest, "service image"),
      configurationBindingHash: sha256(
        object.configurationBindingHash,
        "service configuration",
      ),
      status: "ready" as const,
    });
    if (identities.has(service.serviceId)) {
      throw new TypeError("Approval runtime service set contains duplicates");
    }
    identities.add(service.serviceId);
    return service;
  });
  if (services.some((service, index) => index > 0
    && services[index - 1]!.serviceId.localeCompare(service.serviceId) >= 0)) {
    throw new TypeError("Approval runtime service set is not ordered");
  }
  return Object.freeze(services);
}

function exactObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) throw new TypeError(`${label} keys are invalid`);
  return value as Readonly<Record<string, unknown>>;
}

function sha256(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`Approval aggregate ${label} is invalid`);
  }
  return value as `sha256:${string}`;
}

function hash32(value: unknown, label: string): `0x${string}` {
  if (
    typeof value !== "string"
    || !HASH32.test(value)
    || value === `0x${"00".repeat(32)}`
  ) throw new TypeError(`Approval aggregate ${label} is invalid`);
  return value as `0x${string}`;
}

function gitObject(value: unknown, label: string): string {
  if (typeof value !== "string" || !GIT_OBJECT_ID.test(value)) {
    throw new TypeError(`Approval aggregate ${label} is invalid`);
  }
  return value;
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`Approval aggregate ${label} is invalid`);
  }
  return value;
}

function epoch(value: unknown, label: string): string {
  if (typeof value !== "string" || !POSITIVE_EPOCH.test(value)) {
    throw new TypeError(`Approval aggregate ${label} is invalid`);
  }
  return value;
}

function instant(value: unknown, label: string): number {
  if (typeof value !== "string") {
    throw new TypeError(`Approval aggregate ${label} is invalid`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new TypeError(`Approval aggregate ${label} is invalid`);
  }
  return time;
}

function validNow(value: Date): number {
  const time = value.getTime();
  if (!Number.isFinite(time)) throw new TypeError("Approval readiness clock is invalid");
  return time;
}

function exactOrigin(value: URL): URL {
  if (
    !(value instanceof URL)
    || value.protocol !== "https:"
    || value.username !== ""
    || value.password !== ""
    || value.pathname !== "/"
    || value.search !== ""
    || value.hash !== ""
  ) throw new TypeError("Approval aggregate origin is invalid");
  return new URL(value.origin);
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (response.body === null) throw new TypeError("Approval readiness body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) throw new TypeError("Approval readiness body is too large");
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
