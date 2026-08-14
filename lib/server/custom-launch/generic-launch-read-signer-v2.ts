import "server-only";

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "../projection-target/hashing";
import {
  parseGenericLaunchReadBindingV2,
  type GenericLaunchReadBindingV2,
} from "./generic-launch-read-v2";

export const GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2 =
  "programmable.generic-launch-read.v2" as const;
export const GENERIC_LAUNCH_READ_SIGNER_BINDING_ENV_V2 =
  "PROGRAMMABLE_GENERIC_LAUNCH_READ_SIGNER_V2_JSON" as const;

const MAXIMUM_CONFIGURATION_BYTES = 16_384;
const MAXIMUM_RESPONSE_BYTES = 65_536;
const MAXIMUM_SIGNED_ENVELOPE_BYTES = 2_097_152;
const MAXIMUM_PROVIDER_RECEIPT_AGE_MS = 300_000;
const MAXIMUM_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const BASE64URL_SPKI = /^[A-Za-z0-9_-]{59}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const VERCEL_OIDC = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const moduleFetch = globalThis.fetch.bind(globalThis);

export type GenericLaunchReadSignerBindingV2 = Readonly<{
  schemaVersion: "programmable.generic-launch-read-signer-binding.v2";
  endpoint: string;
  audience: typeof GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2;
  keyId: string;
  keyEpoch: string;
  publicKeySpkiBase64Url: string;
  publicKeySpkiSha256: Sha256Digest;
  providerIdentityHash: Sha256Digest;
  credentialMode: "vercel-oidc-bearer";
}>;

export interface GenericLaunchReadSignerV2 {
  readonly binding: GenericLaunchReadSignerBindingV2;
  sign(input: Readonly<{
    requestBindingHash: Sha256Digest;
    payload: JsonValue;
    signal?: AbortSignal;
  }>): Promise<string>;
}

type ProviderReceiptV2 = Readonly<{
  schemaVersion: "programmable.remote-signing-provider-receipt.v2";
  outcome: "completed";
  audience: typeof GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2;
  keyId: string;
  keyEpoch: string;
  algorithm: "Ed25519";
  providerIdentityHash: Sha256Digest;
  idempotencyKey: Sha256Digest;
  messageSha256: Sha256Digest;
  requestDigest: Sha256Digest;
  signature: string;
  observedAt: string;
  expiresAt: string;
}>;

export function parseGenericLaunchReadSignerBindingV2(
  value: unknown,
): GenericLaunchReadSignerBindingV2 {
  const parsed = record(value, "Generic launch V2 signer binding");
  exactKeys(parsed, [
    "audience", "credentialMode", "endpoint", "keyEpoch", "keyId",
    "providerIdentityHash", "publicKeySpkiBase64Url", "publicKeySpkiSha256",
    "schemaVersion",
  ], "Generic launch V2 signer binding");
  if (
    parsed.schemaVersion !== "programmable.generic-launch-read-signer-binding.v2"
    || parsed.audience !== GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2
    || parsed.credentialMode !== "vercel-oidc-bearer"
  ) throw new TypeError("Generic launch V2 signer binding schema is invalid");
  const endpoint = endpointUrl(parsed.endpoint);
  const keyId = safeId(parsed.keyId, "Generic launch V2 signer key id");
  const keyEpoch = safeId(parsed.keyEpoch, "Generic launch V2 signer key epoch");
  const publicKeySpkiBase64Url = spkiBase64Url(parsed.publicKeySpkiBase64Url);
  const spki = Buffer.from(publicKeySpkiBase64Url, "base64url");
  publicKeyFromSpki(spki);
  const publicKeySpkiSha256 = digest(
    parsed.publicKeySpkiSha256,
    "Generic launch V2 signer public key hash",
  );
  if (rawDigest(spki) !== publicKeySpkiSha256) {
    throw new TypeError("Generic launch V2 signer public key binding is invalid");
  }
  const providerIdentityHash = canonicalSha256(
    "programmable.remote-ed25519-provider-identity.v2",
    Object.freeze({
      schemaVersion: "programmable.remote-ed25519-provider-identity.v2" as const,
      endpoint,
      audience: GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2,
      keyId,
      keyEpoch,
      publicKeySpkiSha256,
    }),
  );
  if (digest(
    parsed.providerIdentityHash,
    "Generic launch V2 signer provider identity",
  ) !== providerIdentityHash) {
    throw new TypeError("Generic launch V2 signer provider identity is invalid");
  }
  return Object.freeze({
    schemaVersion: "programmable.generic-launch-read-signer-binding.v2" as const,
    endpoint,
    audience: GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2,
    keyId,
    keyEpoch,
    publicKeySpkiBase64Url,
    publicKeySpkiSha256,
    providerIdentityHash,
    credentialMode: "vercel-oidc-bearer" as const,
  });
}

export function productionGenericLaunchReadSignerBindingV2(
  activeReadBinding: GenericLaunchReadBindingV2,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): GenericLaunchReadSignerBindingV2 {
  const source = environment[GENERIC_LAUNCH_READ_SIGNER_BINDING_ENV_V2]?.trim();
  if (!source) throw new TypeError("Generic launch V2 signer is not configured");
  if (Buffer.byteLength(source, "utf8") > MAXIMUM_CONFIGURATION_BYTES) {
    throw new TypeError("Generic launch V2 signer configuration is too large");
  }
  const signerBinding = parseGenericLaunchReadSignerBindingV2(
    parseStrictJson(source, {
      maximumBytes: MAXIMUM_CONFIGURATION_BYTES,
      maximumDepth: 4,
    }),
  );
  assertActiveVerifierMatch(activeReadBinding, signerBinding);
  return signerBinding;
}

export async function createProductionGenericLaunchReadSignerV2(
  options: Readonly<{
    activeReadBinding: GenericLaunchReadBindingV2;
    environment?: Readonly<Record<string, string | undefined>>;
    credentialProvider?: () => Promise<string>;
    fetch?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
  }>,
): Promise<GenericLaunchReadSignerV2> {
  const binding = productionGenericLaunchReadSignerBindingV2(
    options.activeReadBinding,
    options.environment ?? process.env,
  );
  const credential = (await (
    options.credentialProvider ?? getVercelOidcToken
  )()).trim();
  if (
    credential.length < 20
    || credential.length > 131_072
    || !VERCEL_OIDC.test(credential)
  ) throw new TypeError("Vercel workload identity is unavailable");
  return createRemoteGenericLaunchReadSignerV2({
    binding,
    activeReadBinding: options.activeReadBinding,
    credential,
    fetch: options.fetch ?? moduleFetch,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

export function createRemoteGenericLaunchReadSignerV2(input: Readonly<{
  binding: GenericLaunchReadSignerBindingV2;
  activeReadBinding: GenericLaunchReadBindingV2;
  credential: string;
  fetch: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}>): GenericLaunchReadSignerV2 {
  const binding = parseGenericLaunchReadSignerBindingV2(input.binding);
  const activeReadBinding = assertActiveVerifierMatch(
    input.activeReadBinding,
    binding,
  );
  if (
    typeof input.credential !== "string"
    || input.credential.length < 20
    || input.credential.length > 131_072
    || !VERCEL_OIDC.test(input.credential)
  ) throw new TypeError("Generic launch V2 signer credential is invalid");
  if (typeof input.fetch !== "function") {
    throw new TypeError("Generic launch V2 signer transport is invalid");
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 500
    || timeoutMs > MAXIMUM_TIMEOUT_MS
  ) throw new TypeError("Generic launch V2 signer timeout is invalid");
  const now = input.now ?? (() => new Date());
  const fetchTransport = input.fetch;
  const credential = input.credential;
  const publicKey = publicKeyFromSpki(
    Buffer.from(binding.publicKeySpkiBase64Url, "base64url"),
  );

  return Object.freeze({
    binding,
    async sign(
      signingInput: Parameters<GenericLaunchReadSignerV2["sign"]>[0],
    ): Promise<string> {
      signingInput.signal?.throwIfAborted();
      const requestBindingHash = digest(
        signingInput.requestBindingHash,
        "Generic launch V2 signing request binding",
      );
      const canonicalMessage = canonicalizeJson(Object.freeze({
        schemaVersion:
          "programmable.generic-launch-read-signature-message.v2" as const,
        activationBindingHash: activeReadBinding.activationBindingHash,
        readModelBindingHash: activeReadBinding.readModelBindingHash,
        requestBindingHash,
        payload: signingInput.payload,
      }));
      if (Buffer.byteLength(canonicalMessage, "utf8") > MAXIMUM_SIGNED_ENVELOPE_BYTES) {
        throw new TypeError("Generic launch V2 signing message is too large");
      }
      const messageSnapshot = parseStrictJson(canonicalMessage, {
        maximumBytes: MAXIMUM_SIGNED_ENVELOPE_BYTES,
        maximumDepth: 128,
      });
      const snapshot = record(messageSnapshot, "Generic launch V2 signing message");
      exactKeys(snapshot, [
        "activationBindingHash", "payload", "readModelBindingHash",
        "requestBindingHash", "schemaVersion",
      ], "Generic launch V2 signing message");
      const message = Buffer.from(canonicalMessage, "utf8");
      const messageSha256 = rawDigest(message);
      const idempotencyKey = canonicalSha256(
        "programmable.generic-launch-read-signing-idempotency.v2",
        Object.freeze({
          schemaVersion:
            "programmable.generic-launch-read-signing-idempotency.v2" as const,
          activationBindingHash: activeReadBinding.activationBindingHash,
          readModelBindingHash: activeReadBinding.readModelBindingHash,
          requestBindingHash,
          messageSha256,
        }),
      );
      const unsignedRequest = Object.freeze({
        schemaVersion: "programmable.remote-signing-request.v2" as const,
        audience: binding.audience,
        keyId: binding.keyId,
        keyEpoch: binding.keyEpoch,
        algorithm: "Ed25519" as const,
        providerIdentityHash: binding.providerIdentityHash,
        idempotencyKey,
        messageEncoding: "base64url" as const,
        message: message.toString("base64url"),
        messageSha256,
      });
      const requestDigest = canonicalSha256(
        "programmable.remote-signing-request.v2",
        unsignedRequest,
      );
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(
          new Error("Generic launch V2 signer deadline exceeded"),
        ),
        timeoutMs,
      );
      const signal = signingInput.signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, signingInput.signal]);
      try {
        const response = await fetchTransport(new URL(binding.endpoint), {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
          signal,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${credential}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            "x-programmable-operation": "sign-v2",
            "x-programmable-request-digest": requestDigest,
          },
          body: canonicalizeJson({ ...unsignedRequest, requestDigest }),
        });
        if (response.redirected || response.status !== 200) {
          throw new TypeError("Generic launch V2 signer rejected the request");
        }
        const contentType = response.headers.get("content-type")
          ?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType !== "application/json") {
          throw new TypeError("Generic launch V2 signer response is invalid");
        }
        const authenticated = parseAuthenticatedResponse(
          await readBoundedResponse(response, MAXIMUM_RESPONSE_BYTES, signal),
        );
      const providerReceipt = authenticated.providerReceipt;
      if (
        providerReceipt.audience !== binding.audience
        || providerReceipt.keyId !== binding.keyId
        || providerReceipt.keyEpoch !== binding.keyEpoch
        || providerReceipt.providerIdentityHash !== binding.providerIdentityHash
        || providerReceipt.idempotencyKey !== idempotencyKey
        || providerReceipt.messageSha256 !== messageSha256
        || providerReceipt.requestDigest !== requestDigest
      ) throw new TypeError("Generic launch V2 signer response binding is invalid");
      validateProviderWindow(providerReceipt, now());
      const providerReceiptBytes = Buffer.from(
        canonicalizeJson(providerReceipt),
        "utf8",
      );
      if (rawDigest(providerReceiptBytes) !== authenticated.providerReceiptDigest) {
        throw new TypeError("Generic launch V2 signer evidence hash is invalid");
      }
      const signature = signatureBytes(providerReceipt.signature);
      const providerReceiptSignature = signatureBytes(
        authenticated.providerReceiptSignature,
      );
      if (
        !verifySignature(null, message, publicKey, signature)
        || !verifySignature(
          null,
          providerReceiptBytes,
          publicKey,
          providerReceiptSignature,
        )
      ) throw new TypeError("Generic launch V2 signer signature is invalid");
      const envelope = canonicalizeJson(Object.freeze({
        schemaVersion: "programmable.signed-generic-launch-read-envelope.v2" as const,
        activationBindingHash: activeReadBinding.activationBindingHash,
        readModelBindingHash: activeReadBinding.readModelBindingHash,
        requestBindingHash,
        payload: snapshot.payload as JsonValue,
        signatureBase64Url: providerReceipt.signature,
      }));
      if (Buffer.byteLength(envelope, "utf8") > MAXIMUM_SIGNED_ENVELOPE_BYTES) {
        throw new TypeError("Generic launch V2 signed envelope is too large");
      }
      return envelope;
      } catch (error) {
        if (controller.signal.aborted && !signingInput.signal?.aborted) {
          throw new TypeError("Generic launch V2 signer deadline exceeded");
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

function assertActiveVerifierMatch(
  rawReadBinding: GenericLaunchReadBindingV2,
  signerBinding: GenericLaunchReadSignerBindingV2,
): GenericLaunchReadBindingV2 {
  const readBinding = parseGenericLaunchReadBindingV2(rawReadBinding);
  const verifier = readBinding.readModelVerifier;
  const verifierSpki = Buffer.from(verifier.publicKeySpkiBase64Url, "base64url");
  if (
    verifierSpki.toString("base64url") !== verifier.publicKeySpkiBase64Url
    || rawDigest(verifierSpki) !== verifier.publicKeySha256
    || verifier.publicKeySpkiBase64Url !== signerBinding.publicKeySpkiBase64Url
    || verifier.publicKeySha256 !== signerBinding.publicKeySpkiSha256
  ) throw new TypeError(
    "Generic launch V2 signer does not match the active Generic V2 verifier",
  );
  publicKeyFromSpki(verifierSpki);
  return readBinding;
}

function parseAuthenticatedResponse(bytes: Uint8Array): Readonly<{
  providerReceipt: ProviderReceiptV2;
  providerReceiptDigest: Sha256Digest;
  providerReceiptSignature: string;
}> {
  const parsed = record(parseStrictJson(Buffer.from(bytes).toString("utf8"), {
    maximumBytes: MAXIMUM_RESPONSE_BYTES,
    maximumDepth: 8,
  }), "Generic launch V2 signer response");
  exactKeys(parsed, [
    "providerReceipt", "providerReceiptDigest", "providerReceiptSignature",
    "schemaVersion",
  ], "Generic launch V2 signer response");
  if (parsed.schemaVersion
      !== "programmable.remote-signing-authenticated-response.v2") {
    throw new TypeError("Generic launch V2 signer response schema is invalid");
  }
  const receipt = record(
    parsed.providerReceipt,
    "Generic launch V2 signer provider receipt",
  );
  exactKeys(receipt, [
    "algorithm", "audience", "expiresAt", "idempotencyKey", "keyEpoch",
    "keyId", "messageSha256", "observedAt", "outcome", "providerIdentityHash",
    "requestDigest", "schemaVersion", "signature",
  ], "Generic launch V2 signer provider receipt");
  if (
    receipt.schemaVersion !== "programmable.remote-signing-provider-receipt.v2"
    || receipt.outcome !== "completed"
    || receipt.audience !== GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2
    || receipt.algorithm !== "Ed25519"
  ) throw new TypeError("Generic launch V2 signer provider receipt is invalid");
  return Object.freeze({
    providerReceipt: Object.freeze({
      schemaVersion: receipt.schemaVersion,
      outcome: receipt.outcome,
      audience: receipt.audience,
      keyId: safeId(receipt.keyId, "Generic launch V2 signer receipt key id"),
      keyEpoch: safeId(
        receipt.keyEpoch,
        "Generic launch V2 signer receipt key epoch",
      ),
      algorithm: receipt.algorithm,
      providerIdentityHash: digest(
        receipt.providerIdentityHash,
        "Generic launch V2 signer receipt provider identity",
      ),
      idempotencyKey: digest(
        receipt.idempotencyKey,
        "Generic launch V2 signer idempotency key",
      ),
      messageSha256: digest(
        receipt.messageSha256,
        "Generic launch V2 signer message hash",
      ),
      requestDigest: digest(
        receipt.requestDigest,
        "Generic launch V2 signer request hash",
      ),
      signature: canonicalSignature(receipt.signature),
      observedAt: canonicalTimestamp(receipt.observedAt),
      expiresAt: canonicalTimestamp(receipt.expiresAt),
    }),
    providerReceiptDigest: digest(
      parsed.providerReceiptDigest,
      "Generic launch V2 signer provider receipt hash",
    ),
    providerReceiptSignature: canonicalSignature(
      parsed.providerReceiptSignature,
    ),
  });
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) {
      throw new TypeError("Generic launch V2 signer response length is invalid");
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > maximumBytes) {
      throw new TypeError("Generic launch V2 signer response is too large");
    }
  }
  if (response.body === null) {
    throw new TypeError("Generic launch V2 signer response is empty");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        throw new TypeError("Generic launch V2 signer response is too large");
      }
      chunks.push(value);
    }
  } finally {
    if (signal.aborted) await reader.cancel(signal.reason).catch(() => undefined);
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  signal.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    void reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}

function validateProviderWindow(receipt: ProviderReceiptV2, now: Date): void {
  const observedMs = Date.parse(receipt.observedAt);
  const expiresMs = Date.parse(receipt.expiresAt);
  const nowMs = now.getTime();
  if (
    !Number.isFinite(nowMs)
    || observedMs > nowMs
    || nowMs >= expiresMs
    || expiresMs - observedMs > MAXIMUM_PROVIDER_RECEIPT_AGE_MS
  ) throw new TypeError("Generic launch V2 signer provider window is invalid");
}

function publicKeyFromSpki(spki: Uint8Array): KeyObject {
  const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("Generic launch V2 signer public key is not Ed25519");
  }
  const normalized = publicKey.export({ format: "der", type: "spki" });
  if (!Buffer.from(normalized).equals(Buffer.from(spki))) {
    throw new TypeError("Generic launch V2 signer SPKI is not canonical");
  }
  return publicKey;
}

function endpointUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new TypeError("Generic launch V2 signer endpoint is invalid");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.pathname === "/"
  ) throw new TypeError("Generic launch V2 signer endpoint is invalid");
  return url.toString();
}

function spkiBase64Url(value: unknown): string {
  if (typeof value !== "string" || !BASE64URL_SPKI.test(value)) {
    throw new TypeError("Generic launch V2 signer SPKI is invalid");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 44 || bytes.toString("base64url") !== value) {
    throw new TypeError("Generic launch V2 signer SPKI is invalid");
  }
  return value;
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Sha256Digest;
}

function canonicalSignature(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Generic launch V2 signer signature is invalid");
  }
  signatureBytes(value);
  return value;
}

function signatureBytes(value: string): Buffer {
  if (!BASE64URL_SIGNATURE.test(value)) {
    throw new TypeError("Generic launch V2 signer signature is invalid");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 64 || bytes.toString("base64url") !== value) {
    throw new TypeError("Generic launch V2 signer signature is invalid");
  }
  return bytes;
}

function canonicalTimestamp(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || new Date(value).toISOString() !== value
  ) throw new TypeError("Generic launch V2 signer timestamp is invalid");
  return value;
}

function rawDigest(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`${label} is invalid`);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} contains symbols`);
    }
    const descriptor = descriptors[key];
    if (
      descriptor === undefined
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || !descriptor.enumerable
      || !("value" in descriptor)
    ) throw new TypeError(`${label} contains non-data properties`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) throw new TypeError(`${label} has unknown or missing fields`);
}
