/** Browser-safe wire validation; no credentials, SDK, filesystem or provider calls. */
export const PRIVY_POLICY_APP_USER_REQUEST_VERSION_V4 =
  "programmable.privy-permit-policy.app-user-request.v4";
export const PRIVY_POLICY_APP_USER_SIGNATURE_VERSION_V4 =
  "programmable.privy-permit-policy.app-user-signature.v4";
export const PRIVY_POLICY_APP_USER_REQUEST_LIFETIME_MS_V4 = 30_000;

export type PrivyPolicyAppUserBindingsV4 = Readonly<{
  appId: string;
  policyId: string;
  ownerId: string;
  conditionSetId: string;
}>;

export type PrivyPolicyAppUserRequestV4 = Readonly<{
  schemaVersion: typeof PRIVY_POLICY_APP_USER_REQUEST_VERSION_V4;
  operation: "reconcile" | "rollback";
  bindings: PrivyPolicyAppUserBindingsV4;
  ownerUserSha256: string;
  createdAt: string;
  expiresAt: string;
  sourcePolicySha256: string;
  targetPolicySha256: string;
  rollbackArtifactSha256: string;
  requestBodySha256: string;
  requestBytesBase64: string;
  requestSha256: string;
}>;

export type PrivyPolicyAppUserSignatureV4 = Readonly<{
  schemaVersion: typeof PRIVY_POLICY_APP_USER_SIGNATURE_VERSION_V4;
  requestArtifactSha256: string;
  requestSha256: string;
  authorizationSignature: string;
}>;

export type PrivyPolicyAppUserRequestExpectationV4 = Readonly<{
  bindings: PrivyPolicyAppUserBindingsV4;
  operation: "reconcile" | "rollback";
  /** Derived from the reviewed builder, never copied from the imported file. */
  requestBodySha256: string;
  /** Derive from the authenticated AppUser, not a user-supplied identifier. */
  ownerUserSha256: string;
}>;

/** RFC-8785-compatible for this closed JSON wire; no newline in signing bytes. */
export function canonicalPrivyOwnerJsonV4(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalPrivyOwnerJsonV4).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalPrivyOwnerJsonV4(Reflect.get(value, key))}`
    ).join(",")}}`;
  }
  throw new TypeError("OWNER_HANDOFF_NON_JSON_VALUE");
}

export async function digestPrivyOwnerBytesV4(
  value: string | Uint8Array,
): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function digestPrivyOwnerUserV4(userId: string): Promise<string> {
  if (!/^did:privy:[a-zA-Z0-9]{1,128}$/u.test(userId)) {
    throw new TypeError("OWNER_HANDOFF_USER_INVALID");
  }
  return digestPrivyOwnerBytesV4(`programmable.privy-policy-owner-user.v4\0${userId}`);
}

export function encodePrivyOwnerBytesBase64V4(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export function decodePrivyOwnerBytesBase64V4(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length < 4 || value.length > 65_536
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new TypeError("OWNER_HANDOFF_BASE64_INVALID");
  }
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (encodePrivyOwnerBytesBase64V4(bytes) !== value) {
    throw new TypeError("OWNER_HANDOFF_BASE64_INVALID");
  }
  return bytes;
}

export function serializePrivyOwnerArtifactV4(value: unknown): string {
  return `${canonicalPrivyOwnerJsonV4(value)}\n`;
}

export async function validatePrivyPolicyAppUserRequestV4(input: Readonly<{
  text: string;
  expected: PrivyPolicyAppUserRequestExpectationV4;
  nowMilliseconds: number;
}>): Promise<Readonly<{
  artifact: PrivyPolicyAppUserRequestV4;
  requestBytes: Uint8Array;
  requestArtifactSha256: string;
  request: Readonly<Record<string, unknown>>;
}>> {
  const value = parseCanonicalArtifact(input.text);
  exactKeys(value, ["schemaVersion", "operation", "bindings", "ownerUserSha256",
    "createdAt", "expiresAt", "sourcePolicySha256", "targetPolicySha256",
    "rollbackArtifactSha256", "requestBodySha256", "requestBytesBase64", "requestSha256"]);
  const bindings = record(value.bindings);
  exactKeys(bindings, ["appId", "policyId", "ownerId", "conditionSetId"]);
  for (const key of ["policyId", "ownerId", "conditionSetId"]) {
    if (typeof bindings[key] !== "string" || !/^[a-z0-9]{24}$/u.test(bindings[key])) {
      throw new TypeError("OWNER_HANDOFF_BINDING_INVALID");
    }
  }
  if (typeof bindings.appId !== "string" || !/^[a-z0-9]{1,128}$/u.test(bindings.appId)
    || canonicalPrivyOwnerJsonV4(bindings) !== canonicalPrivyOwnerJsonV4(input.expected.bindings)
    || value.schemaVersion !== PRIVY_POLICY_APP_USER_REQUEST_VERSION_V4
    || (value.operation !== "reconcile" && value.operation !== "rollback")
    || value.operation !== input.expected.operation
    || value.ownerUserSha256 !== input.expected.ownerUserSha256
    || value.requestBodySha256 !== input.expected.requestBodySha256) {
    throw new TypeError("OWNER_HANDOFF_BINDING_MISMATCH");
  }
  for (const key of ["ownerUserSha256", "sourcePolicySha256", "targetPolicySha256",
    "rollbackArtifactSha256", "requestBodySha256", "requestSha256"]) {
    if (typeof value[key] !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value[key])) {
      throw new TypeError("OWNER_HANDOFF_DIGEST_INVALID");
    }
  }
  const created = timestamp(value.createdAt);
  const expires = timestamp(value.expiresAt);
  if (!Number.isSafeInteger(input.nowMilliseconds) || created > input.nowMilliseconds
    || expires - created !== PRIVY_POLICY_APP_USER_REQUEST_LIFETIME_MS_V4
    || input.nowMilliseconds >= expires) {
    throw new TypeError("OWNER_HANDOFF_REQUEST_EXPIRED_OR_CLOCK_INVALID");
  }
  const requestBytes = decodePrivyOwnerBytesBase64V4(value.requestBytesBase64);
  const requestText = new TextDecoder("utf-8", { fatal: true }).decode(requestBytes);
  const request = record(JSON.parse(requestText));
  exactKeys(request, ["version", "method", "url", "body", "headers"]);
  const headers = record(request.headers);
  exactKeys(headers, ["privy-app-id", "privy-request-expiry"]);
  if (requestText !== canonicalPrivyOwnerJsonV4(request)
    || request.version !== 1 || request.method !== "PATCH"
    || request.url !== `https://api.privy.io/v1/policies/${bindings.policyId}`
    || headers["privy-app-id"] !== bindings.appId
    || headers["privy-request-expiry"] !== String(expires)
    || await digestPrivyOwnerBytesV4(requestBytes) !== value.requestSha256
    || await digestPrivyOwnerBytesV4(canonicalPrivyOwnerJsonV4(request.body))
      !== input.expected.requestBodySha256) {
    throw new TypeError("OWNER_HANDOFF_REQUEST_BYTES_MISMATCH");
  }
  return Object.freeze({
    artifact: value as PrivyPolicyAppUserRequestV4,
    requestBytes,
    request,
    requestArtifactSha256: await digestPrivyOwnerBytesV4(input.text),
  });
}

export function parsePrivyPolicyAppUserSignatureV4(
  text: string,
  expected: Readonly<{ requestArtifactSha256: string; requestSha256: string }>,
): PrivyPolicyAppUserSignatureV4 {
  const value = parseCanonicalArtifact(text);
  exactKeys(value, ["schemaVersion", "requestArtifactSha256", "requestSha256", "authorizationSignature"]);
  if (value.schemaVersion !== PRIVY_POLICY_APP_USER_SIGNATURE_VERSION_V4
    || value.requestArtifactSha256 !== expected.requestArtifactSha256
    || value.requestSha256 !== expected.requestSha256
    || typeof value.authorizationSignature !== "string"
    || !/^[\x21-\x7e]{1,8192}$/u.test(value.authorizationSignature)) {
    throw new TypeError("OWNER_HANDOFF_SIGNATURE_BINDING_INVALID");
  }
  return value as PrivyPolicyAppUserSignatureV4;
}

function parseCanonicalArtifact(text: string): Record<string, unknown> {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 65_536) {
    throw new TypeError("OWNER_HANDOFF_ARTIFACT_SIZE_INVALID");
  }
  const value = record(JSON.parse(text));
  if (serializePrivyOwnerArtifactV4(value) !== text) {
    throw new TypeError("OWNER_HANDOFF_ARTIFACT_NON_CANONICAL");
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("OWNER_HANDOFF_OBJECT_INVALID");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError("OWNER_HANDOFF_FIELDS_INVALID");
  }
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") throw new TypeError("OWNER_HANDOFF_TIME_INVALID");
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || time < 0 || new Date(time).toISOString() !== value) {
    throw new TypeError("OWNER_HANDOFF_TIME_INVALID");
  }
  return time;
}
