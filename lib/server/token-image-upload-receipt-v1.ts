import "server-only";

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";

import {
  TOKEN_IMAGE_UPLOAD_RECEIPT_AUDIENCE_V1,
  TOKEN_IMAGE_UPLOAD_RECEIPT_MAX_AGE_MS_V1,
  parseSignedTokenImageUploadReceiptV1,
  tokenImageUploadReceiptMatchesV1,
  type SignedTokenImageUploadReceiptV1,
  type TokenImageRemoteSigningProviderReceiptV2,
  type TokenImageUploadReceiptLaunchScopeV1,
  type TokenImageUploadReceiptOwnerV1,
  type TokenImageUploadReceiptPayloadV1,
} from "@/lib/custom-launch/token-image-upload-receipt-v1";
import type { Sha256DigestV2 } from "@/lib/custom-launch/contract-v2";
import {
  canonicalizeJson,
  parseStrictJson,
} from "@/lib/server/projection-target/canonical-json";
import { canonicalSha256 } from "@/lib/server/projection-target/hashing";
import {
  getProgrammableTokenImageAssetName,
  PROGRAMMABLE_TOKEN_IMAGE_HOST,
  PROGRAMMABLE_TOKEN_IMAGE_STORE_ID,
} from "@/lib/token-image";

const SIGNER_CONFIGURATION_ENV =
  "PROGRAMMABLE_TOKEN_IMAGE_UPLOAD_RECEIPT_SIGNER_V1_JSON";
const MAXIMUM_SIGNER_CONFIGURATION_BYTES = 16_384;
const MAXIMUM_SIGNER_RESPONSE_BYTES = 65_536;
const MAXIMUM_SIGNER_TIMEOUT_MS = 10_000;
const DEFAULT_SIGNER_TIMEOUT_MS = 5_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const moduleFetch = globalThis.fetch.bind(globalThis);

export type TokenImageUploadReceiptSignerBindingV1 = Readonly<{
  schemaVersion: "programmable.token-image-upload-receipt-signer-binding.v1";
  endpoint: string;
  audience: typeof TOKEN_IMAGE_UPLOAD_RECEIPT_AUDIENCE_V1;
  keyId: string;
  keyEpoch: string;
  publicKeyBase64Url: string;
  publicKeySpkiSha256: Sha256DigestV2;
  providerIdentityHash: Sha256DigestV2;
  credentialMode: "vercel-oidc-bearer";
}>;

export type TokenImageUploadReceiptSigningInputV1 = Readonly<{
  launchScope: TokenImageUploadReceiptLaunchScopeV1;
  uploadOwner: TokenImageUploadReceiptOwnerV1;
  blob: TokenImageUploadReceiptPayloadV1["blob"];
  image: TokenImageUploadReceiptPayloadV1["image"];
  signal?: AbortSignal;
}>;

export interface TokenImageUploadReceiptSignerV1 {
  readonly binding: TokenImageUploadReceiptSignerBindingV1;
  sign(input: TokenImageUploadReceiptSigningInputV1):
    Promise<SignedTokenImageUploadReceiptV1>;
}

export type PresentationTokenImageV1 = Readonly<{
  uri: string;
  contentSha256: Sha256DigestV2;
  mediaType: "image/webp";
  byteLength: number;
  width: number;
  height: number;
}>;

export function authorizeTokenImagePresentationMutationV1(input: Readonly<{
  currentImage: PresentationTokenImageV1 | null;
  requestedImage: PresentationTokenImageV1 | null;
  receipt: unknown;
  trustedSigner: TokenImageUploadReceiptSignerBindingV1;
  expectedLaunchScope: TokenImageUploadReceiptLaunchScopeV1;
  expectedPrincipal: Readonly<{
    privyUserId?: string;
    githubUserId: string;
    githubPrincipalHash: Sha256DigestV2;
  }>;
  now: Date;
}>): "created-or-changed" | "removed" | "unchanged" {
  if (samePresentationImage(input.currentImage, input.requestedImage)) {
    // A previously verified immutable digest remains the durable authority.
    // Its short-lived upload receipt is intentionally not revalidated.
    return "unchanged";
  }
  if (input.requestedImage === null) return "removed";
  if (input.receipt === null || input.receipt === undefined) {
    throw new TypeError("image upload receipt is required for a new image revision");
  }
  verifyTokenImageUploadReceiptForPresentationV1({
    receipt: input.receipt,
    trustedSigner: input.trustedSigner,
    expectedLaunchScope: input.expectedLaunchScope,
    expectedPrincipal: input.expectedPrincipal,
    expectedImage: input.requestedImage,
    now: input.now,
  });
  return "created-or-changed";
}

export function verifyTokenImageUploadReceiptForPresentationV1(input: Readonly<{
  receipt: unknown;
  trustedSigner: TokenImageUploadReceiptSignerBindingV1;
  expectedLaunchScope: TokenImageUploadReceiptLaunchScopeV1;
  expectedPrincipal: Readonly<{
    privyUserId?: string;
    githubUserId: string;
    githubPrincipalHash: Sha256DigestV2;
  }>;
  expectedImage: Readonly<{
    uri: string;
    contentSha256: Sha256DigestV2;
    mediaType: "image/webp";
    byteLength: number;
    width: number;
    height: number;
  }>;
  now: Date;
}>): TokenImageUploadReceiptPayloadV1 {
  const trusted = parseTokenImageUploadReceiptSignerBindingV1(input.trustedSigner);
  const receipt = parseSignedTokenImageUploadReceiptV1(input.receipt);
  const payload = receipt.payload;
  if (
    payload.signingAuthority.providerIdentityHash !== trusted.providerIdentityHash
    || payload.signingAuthority.keyId !== trusted.keyId
    || payload.signingAuthority.keyEpoch !== trusted.keyEpoch
    || payload.signingAuthority.publicKeySpkiSha256 !== trusted.publicKeySpkiSha256
  ) throw new TypeError("image upload receipt uses an untrusted signer");
  if (
    payload.uploadOwner.githubUserId !== input.expectedPrincipal.githubUserId
    || payload.uploadOwner.githubPrincipalHash
      !== input.expectedPrincipal.githubPrincipalHash
    || (
      input.expectedPrincipal.privyUserId !== undefined
      && payload.uploadOwner.privyUserId !== input.expectedPrincipal.privyUserId
    )
  ) throw new TypeError("image upload receipt belongs to another principal");
  if (!tokenImageUploadReceiptMatchesV1(receipt, {
    launchScope: input.expectedLaunchScope,
    uri: input.expectedImage.uri,
    contentSha256: input.expectedImage.contentSha256,
    byteLength: input.expectedImage.byteLength,
    width: input.expectedImage.width,
    height: input.expectedImage.height,
  }) || input.expectedImage.mediaType !== "image/webp") {
    throw new TypeError("image upload receipt does not match the presentation");
  }
  if (
    payload.blob.storeId !== PROGRAMMABLE_TOKEN_IMAGE_STORE_ID
    || payload.blob.host !== PROGRAMMABLE_TOKEN_IMAGE_HOST
    || payload.blob.url !== input.expectedImage.uri
    || payload.blob.pathname !== new URL(payload.blob.url).pathname.slice(1)
    || getProgrammableTokenImageAssetName(payload.blob.url) === ""
  ) throw new TypeError("image upload receipt Blob authority is invalid");

  const nowMs = input.now.getTime();
  const issuedMs = Date.parse(payload.issuedAt);
  const expiresMs = Date.parse(payload.expiresAt);
  const observedMs = Date.parse(receipt.providerReceipt.observedAt);
  const providerExpiresMs = Date.parse(receipt.providerReceipt.expiresAt);
  if (
    !Number.isFinite(nowMs)
    || issuedMs > nowMs
    || nowMs >= expiresMs
    || expiresMs - issuedMs > TOKEN_IMAGE_UPLOAD_RECEIPT_MAX_AGE_MS_V1
    || observedMs < issuedMs
    || observedMs > nowMs
    || nowMs >= providerExpiresMs
    || providerExpiresMs - observedMs > TOKEN_IMAGE_UPLOAD_RECEIPT_MAX_AGE_MS_V1
  ) throw new TypeError("image upload receipt is expired or not yet valid");

  const payloadBytes = Buffer.from(canonicalizeJson(payload), "utf8");
  const signature = decodeSignature(receipt.signature);
  const providerReceiptBytes = Buffer.from(
    canonicalizeJson(receipt.providerReceipt),
    "utf8",
  );
  const providerReceiptSignature = decodeSignature(
    receipt.providerReceiptSignature,
  );
  const expectedIdempotencyKey = canonicalSha256(
    "programmable.token-image-upload-receipt-signing-idempotency.v1",
    Object.freeze({
      schemaVersion:
        "programmable.token-image-upload-receipt-signing-idempotency.v1" as const,
      payloadSha256: receipt.payloadSha256,
      blobEtag: payload.blob.etag,
      githubPrincipalHash: payload.uploadOwner.githubPrincipalHash,
      applicationId: payload.launchScope.applicationId,
      grantId: payload.launchScope.grantId,
    }),
  );
  const expectedRequestDigest = canonicalSha256(
    "programmable.remote-signing-request.v2",
    Object.freeze({
      schemaVersion: "programmable.remote-signing-request.v2" as const,
      audience: trusted.audience,
      keyId: trusted.keyId,
      keyEpoch: trusted.keyEpoch,
      algorithm: "Ed25519" as const,
      providerIdentityHash: trusted.providerIdentityHash,
      idempotencyKey: expectedIdempotencyKey,
      messageEncoding: "base64url" as const,
      message: payloadBytes.toString("base64url"),
      messageSha256: receipt.payloadSha256,
    }),
  );
  if (
    rawDigest(payloadBytes) !== receipt.payloadSha256
    || rawDigest(signature) !== receipt.signatureSha256
    || rawDigest(providerReceiptBytes) !== receipt.providerReceiptSha256
    || rawDigest(providerReceiptSignature)
      !== receipt.providerReceiptSignatureSha256
    || receipt.providerReceipt.idempotencyKey !== expectedIdempotencyKey
    || receipt.providerReceipt.requestDigest !== expectedRequestDigest
  ) throw new TypeError("image upload receipt byte integrity is invalid");
  const publicKey = publicKeyForBinding(trusted);
  if (
    !verifySignature(null, payloadBytes, publicKey, signature)
    || !verifySignature(
      null,
      providerReceiptBytes,
      publicKey,
      providerReceiptSignature,
    )
  ) throw new TypeError("image upload receipt signature is invalid");
  return payload;
}

export function productionTokenImageUploadReceiptSignerBindingV1(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TokenImageUploadReceiptSignerBindingV1 {
  const source = environment[SIGNER_CONFIGURATION_ENV]?.trim();
  if (!source) throw new TypeError("token image receipt signer is not configured");
  if (Buffer.byteLength(source, "utf8") > MAXIMUM_SIGNER_CONFIGURATION_BYTES) {
    throw new TypeError("token image receipt signer configuration is too large");
  }
  return parseTokenImageUploadReceiptSignerBindingV1(
    parseStrictJson(source, {
      maximumBytes: MAXIMUM_SIGNER_CONFIGURATION_BYTES,
      maximumDepth: 4,
    }),
  );
}

export function isProductionTokenImageUploadReceiptSignerConfiguredV1(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  try {
    productionTokenImageUploadReceiptSignerBindingV1(environment);
    return true;
  } catch {
    return false;
  }
}

export async function createProductionTokenImageUploadReceiptSignerV1(
  options: Readonly<{
    credentialProvider?: () => Promise<string>;
    fetch?: typeof fetch;
    now?: () => Date;
  }> = {},
): Promise<TokenImageUploadReceiptSignerV1> {
  // The credential comes from Vercel's request-context/env authority, never
  // from the user-controlled Request headers passed to the upload handler.
  const credential = (await (options.credentialProvider ?? getVercelOidcToken)()).trim();
  if (
    credential.length < 20
    || credential.length > 131_072
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(credential)
  ) throw new TypeError("Vercel workload identity is unavailable");
  return createRemoteTokenImageUploadReceiptSignerV1({
    binding: productionTokenImageUploadReceiptSignerBindingV1(),
    credential,
    fetch: options.fetch ?? moduleFetch,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

export function createRemoteTokenImageUploadReceiptSignerV1(input: Readonly<{
  binding: TokenImageUploadReceiptSignerBindingV1;
  credential: string;
  fetch: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}>): TokenImageUploadReceiptSignerV1 {
  const binding = parseTokenImageUploadReceiptSignerBindingV1(input.binding);
  if (
    typeof input.credential !== "string"
    || input.credential.length < 20
    || input.credential.length > 131_072
    || /[\s\u0000]/u.test(input.credential)
  ) throw new TypeError("image receipt signer credential is invalid");
  if (typeof input.fetch !== "function") {
    throw new TypeError("image receipt signer transport is invalid");
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_SIGNER_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 500
    || timeoutMs > MAXIMUM_SIGNER_TIMEOUT_MS
  ) throw new TypeError("image receipt signer timeout is invalid");
  const now = input.now ?? (() => new Date());
  const publicKey = publicKeyForBinding(binding);

  return Object.freeze({
    binding,
    async sign(
      signingInput: TokenImageUploadReceiptSigningInputV1,
    ): Promise<SignedTokenImageUploadReceiptV1> {
      signingInput.signal?.throwIfAborted();
      const issued = now();
      const issuedMs = issued.getTime();
      if (!Number.isFinite(issuedMs)) throw new TypeError("image receipt clock is invalid");
      const issuedAt = issued.toISOString();
      const expiresAt = new Date(
        issuedMs + TOKEN_IMAGE_UPLOAD_RECEIPT_MAX_AGE_MS_V1,
      ).toISOString();
      const payload = Object.freeze({
        schemaVersion: "programmable.token-image-upload-receipt.v1" as const,
        audience: binding.audience,
        launchScope: Object.freeze({ ...signingInput.launchScope }),
        uploadOwner: Object.freeze({ ...signingInput.uploadOwner }),
        blob: Object.freeze({ ...signingInput.blob }),
        image: Object.freeze({ ...signingInput.image }),
        signingAuthority: Object.freeze({
          providerIdentityHash: binding.providerIdentityHash,
          keyId: binding.keyId,
          keyEpoch: binding.keyEpoch,
          publicKeySpkiSha256: binding.publicKeySpkiSha256,
        }),
        issuedAt,
        expiresAt,
      }) satisfies TokenImageUploadReceiptPayloadV1;
      const message = Buffer.from(canonicalizeJson(payload), "utf8");
      const payloadSha256 = rawDigest(message);
      const idempotencyKey = canonicalSha256(
        "programmable.token-image-upload-receipt-signing-idempotency.v1",
        Object.freeze({
          schemaVersion:
            "programmable.token-image-upload-receipt-signing-idempotency.v1" as const,
          payloadSha256,
          blobEtag: payload.blob.etag,
          githubPrincipalHash: payload.uploadOwner.githubPrincipalHash,
          applicationId: payload.launchScope.applicationId,
          grantId: payload.launchScope.grantId,
        }),
      ) as Sha256DigestV2;
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
        messageSha256: payloadSha256,
      });
      const requestDigest = canonicalSha256(
        "programmable.remote-signing-request.v2",
        unsignedRequest,
      ) as Sha256DigestV2;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("image receipt signer deadline exceeded")),
        timeoutMs,
      );
      const signal = signingInput.signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, signingInput.signal]);
      let response: Response;
      try {
        response = await input.fetch(new URL(binding.endpoint), {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
          signal,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${input.credential}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            "x-programmable-operation": "sign-v2",
            "x-programmable-request-digest": requestDigest,
          },
          body: canonicalizeJson({ ...unsignedRequest, requestDigest }),
        });
      } finally {
        clearTimeout(timeout);
      }
      if (response.redirected || response.status !== 200) {
        throw new TypeError("image receipt signer rejected the request");
      }
      const contentType = response.headers.get("content-type")
        ?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        throw new TypeError("image receipt signer response is invalid");
      }
      const responseBytes = await readBoundedResponse(
        response,
        MAXIMUM_SIGNER_RESPONSE_BYTES,
      );
      const authenticated = parseAuthenticatedSignerResponse(responseBytes);
      const providerReceipt = authenticated.providerReceipt;
      if (
        providerReceipt.outcome !== "completed"
        || providerReceipt.audience !== binding.audience
        || providerReceipt.keyId !== binding.keyId
        || providerReceipt.keyEpoch !== binding.keyEpoch
        || providerReceipt.providerIdentityHash !== binding.providerIdentityHash
        || providerReceipt.idempotencyKey !== idempotencyKey
        || providerReceipt.messageSha256 !== payloadSha256
        || providerReceipt.requestDigest !== requestDigest
      ) throw new TypeError("image receipt signer response binding is invalid");
      validateProviderWindow(providerReceipt, now());
      const providerReceiptBytes = Buffer.from(
        canonicalizeJson(providerReceipt),
        "utf8",
      );
      const providerReceiptSha256 = rawDigest(providerReceiptBytes);
      if (authenticated.providerReceiptDigest !== providerReceiptSha256) {
        throw new TypeError("image receipt signer evidence hash is invalid");
      }
      const signature = decodeSignature(providerReceipt.signature);
      const providerReceiptSignature = decodeSignature(
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
      ) throw new TypeError("image receipt signer signature is invalid");
      return Object.freeze({
        schemaVersion: "programmable.signed-token-image-upload-receipt.v1" as const,
        payload,
        payloadSha256,
        signature: providerReceipt.signature,
        signatureSha256: rawDigest(signature),
        providerReceipt,
        providerReceiptSha256,
        providerReceiptSignature: authenticated.providerReceiptSignature,
        providerReceiptSignatureSha256: rawDigest(providerReceiptSignature),
      });
    },
  });
}

export function parseTokenImageUploadReceiptSignerBindingV1(
  value: unknown,
): TokenImageUploadReceiptSignerBindingV1 {
  const parsed = record(value, "image receipt signer binding");
  exactKeys(parsed, [
    "audience", "credentialMode", "endpoint", "keyEpoch", "keyId",
    "providerIdentityHash", "publicKeyBase64Url", "publicKeySpkiSha256",
    "schemaVersion",
  ], "image receipt signer binding");
  if (
    parsed.schemaVersion !== "programmable.token-image-upload-receipt-signer-binding.v1"
    || parsed.audience !== TOKEN_IMAGE_UPLOAD_RECEIPT_AUDIENCE_V1
    || parsed.credentialMode !== "vercel-oidc-bearer"
  ) throw new TypeError("image receipt signer binding schema is invalid");
  const endpoint = validateEndpoint(parsed.endpoint);
  const keyId = safeId(parsed.keyId, "image receipt signer key id");
  const keyEpoch = safeId(parsed.keyEpoch, "image receipt signer key epoch");
  const publicKeyBase64Url = rawPublicKey(parsed.publicKeyBase64Url);
  const spki = Buffer.concat([
    ED25519_SPKI_PREFIX,
    Buffer.from(publicKeyBase64Url, "base64url"),
  ]);
  const publicKeySpkiSha256 = digest(
    parsed.publicKeySpkiSha256,
    "image receipt signer public key hash",
  );
  if (rawDigest(spki) !== publicKeySpkiSha256) {
    throw new TypeError("image receipt signer public key binding is invalid");
  }
  const computedProviderIdentity = canonicalSha256(
    "programmable.remote-ed25519-provider-identity.v2",
    Object.freeze({
      schemaVersion: "programmable.remote-ed25519-provider-identity.v2" as const,
      endpoint,
      audience: parsed.audience,
      keyId,
      keyEpoch,
      publicKeySpkiSha256,
    }),
  ) as Sha256DigestV2;
  if (
    digest(parsed.providerIdentityHash, "image receipt signer provider identity")
      !== computedProviderIdentity
  ) throw new TypeError("image receipt signer provider identity is invalid");
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    endpoint,
    audience: parsed.audience,
    keyId,
    keyEpoch,
    publicKeyBase64Url,
    publicKeySpkiSha256,
    providerIdentityHash: computedProviderIdentity,
    credentialMode: parsed.credentialMode,
  });
}

function parseAuthenticatedSignerResponse(bytes: Uint8Array): Readonly<{
  providerReceipt: TokenImageRemoteSigningProviderReceiptV2;
  providerReceiptDigest: Sha256DigestV2;
  providerReceiptSignature: string;
}> {
  const parsed = record(parseStrictJson(Buffer.from(bytes).toString("utf8"), {
    maximumBytes: MAXIMUM_SIGNER_RESPONSE_BYTES,
    maximumDepth: 8,
  }), "image receipt signer response");
  exactKeys(parsed, [
    "providerReceipt", "providerReceiptDigest", "providerReceiptSignature",
    "schemaVersion",
  ], "image receipt signer response");
  if (parsed.schemaVersion !== "programmable.remote-signing-authenticated-response.v2") {
    throw new TypeError("image receipt signer response schema is invalid");
  }
  const receipt = record(parsed.providerReceipt, "image signer provider receipt");
  exactKeys(receipt, [
    "algorithm", "audience", "expiresAt", "idempotencyKey", "keyEpoch",
    "keyId", "messageSha256", "observedAt", "outcome", "providerIdentityHash",
    "requestDigest", "schemaVersion", "signature",
  ], "image signer provider receipt");
  if (
    receipt.schemaVersion !== "programmable.remote-signing-provider-receipt.v2"
    || receipt.outcome !== "completed"
    || receipt.audience !== TOKEN_IMAGE_UPLOAD_RECEIPT_AUDIENCE_V1
    || receipt.algorithm !== "Ed25519"
  ) throw new TypeError("image signer provider receipt is invalid");
  return Object.freeze({
    providerReceipt: Object.freeze({
      schemaVersion: receipt.schemaVersion,
      outcome: receipt.outcome,
      audience: receipt.audience,
      keyId: safeId(receipt.keyId, "image signer receipt key id"),
      keyEpoch: safeId(receipt.keyEpoch, "image signer receipt key epoch"),
      algorithm: receipt.algorithm,
      providerIdentityHash: digest(
        receipt.providerIdentityHash,
        "image signer receipt provider identity",
      ),
      idempotencyKey: digest(receipt.idempotencyKey, "image signer idempotency key"),
      messageSha256: digest(receipt.messageSha256, "image signer message hash"),
      requestDigest: digest(receipt.requestDigest, "image signer request hash"),
      signature: canonicalSignature(receipt.signature, "image signer signature"),
      observedAt: canonicalTimestamp(receipt.observedAt, "image signer observed time"),
      expiresAt: canonicalTimestamp(receipt.expiresAt, "image signer expiry time"),
    }),
    providerReceiptDigest: digest(
      parsed.providerReceiptDigest,
      "image signer provider receipt hash",
    ),
    providerReceiptSignature: canonicalSignature(
      parsed.providerReceiptSignature,
      "image signer provider receipt signature",
    ),
  });
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new TypeError("image receipt signer response is too large");
  }
  if (response.body === null) throw new TypeError("image receipt signer response is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new TypeError("image receipt signer response is too large");
      chunks.push(value);
    }
  } finally {
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

function validateProviderWindow(
  receipt: TokenImageRemoteSigningProviderReceiptV2,
  now: Date,
): void {
  const observed = Date.parse(receipt.observedAt);
  const expires = Date.parse(receipt.expiresAt);
  const nowMs = now.getTime();
  if (
    !Number.isFinite(nowMs)
    || observed > nowMs
    || nowMs >= expires
    || expires - observed > TOKEN_IMAGE_UPLOAD_RECEIPT_MAX_AGE_MS_V1
  ) throw new TypeError("image signer provider receipt window is invalid");
}

function publicKeyForBinding(binding: TokenImageUploadReceiptSignerBindingV1): KeyObject {
  const spki = Buffer.concat([
    ED25519_SPKI_PREFIX,
    Buffer.from(binding.publicKeyBase64Url, "base64url"),
  ]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError("image receipt signer public key is not Ed25519");
  }
  return key;
}

function validateEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new TypeError("image receipt signer endpoint is invalid");
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
  ) throw new TypeError("image receipt signer endpoint is invalid");
  return url.toString();
}

function rawPublicKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new TypeError("image receipt signer public key is invalid");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    throw new TypeError("image receipt signer public key is invalid");
  }
  return value;
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): Sha256DigestV2 {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Sha256DigestV2;
}

function canonicalSignature(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  decodeSignature(value);
  return value;
}

function decodeSignature(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]{86}$/u.test(value)) {
    throw new TypeError("image signer signature is invalid");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 64 || bytes.toString("base64url") !== value) {
    throw new TypeError("image signer signature is invalid");
  }
  return bytes;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || new Date(value).toISOString() !== value
  ) throw new TypeError(`${label} is invalid`);
  return value;
}

function rawDigest(bytes: Uint8Array): Sha256DigestV2 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`${label} is invalid`);
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
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

function samePresentationImage(
  left: PresentationTokenImageV1 | null,
  right: PresentationTokenImageV1 | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.uri === right.uri
    && left.contentSha256 === right.contentSha256
    && left.mediaType === right.mediaType
    && left.byteLength === right.byteLength
    && left.width === right.width
    && left.height === right.height;
}
