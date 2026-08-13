import type {
  ApplicationHandleV3,
  Sha256DigestV2,
} from "./contract-v2";
import {
  getProgrammableTokenImageAssetName,
  PROGRAMMABLE_TOKEN_IMAGE_HOST,
  PROGRAMMABLE_TOKEN_IMAGE_STORE_ID,
} from "../token-image";

export const TOKEN_IMAGE_UPLOAD_RECEIPT_AUDIENCE_V1 =
  "programmable.launch-presentation-image.v1" as const;
export const TOKEN_IMAGE_UPLOAD_RECEIPT_MAX_AGE_MS_V1 = 300_000;
export const TOKEN_IMAGE_UPLOAD_RECEIPT_SCHEMA_SHA256_V1 =
  "sha256:e04adb01d0a522a31a4167021fbac2626457b2b6b2f0becc30c59ea329506de8" as const;

export type TokenImageUploadReceiptLaunchScopeV1 = Readonly<{
  applicationId: string;
  applicationHandle: ApplicationHandleV3;
  grantId: string;
  grantBindingHash: Sha256DigestV2;
}>;

export type TokenImageUploadReceiptOwnerV1 = Readonly<{
  provider: "privy-github";
  privyUserId: string;
  githubUserId: string;
  githubPrincipalHash: Sha256DigestV2;
}>;

export type TokenImageUploadReceiptPayloadV1 = Readonly<{
  schemaVersion: "programmable.token-image-upload-receipt.v1";
  audience: typeof TOKEN_IMAGE_UPLOAD_RECEIPT_AUDIENCE_V1;
  launchScope: TokenImageUploadReceiptLaunchScopeV1;
  uploadOwner: TokenImageUploadReceiptOwnerV1;
  blob: Readonly<{
    storeId: string;
    host: string;
    pathname: string;
    url: string;
    etag: string;
  }>;
  image: Readonly<{
    contentSha256: Sha256DigestV2;
    mediaType: "image/webp";
    byteLength: number;
    width: 1000;
    height: 1000;
  }>;
  signingAuthority: Readonly<{
    providerIdentityHash: Sha256DigestV2;
    keyId: string;
    keyEpoch: string;
    publicKeySpkiSha256: Sha256DigestV2;
  }>;
  issuedAt: string;
  expiresAt: string;
}>;

export type TokenImageRemoteSigningProviderReceiptV2 = Readonly<{
  schemaVersion: "programmable.remote-signing-provider-receipt.v2";
  outcome: "completed";
  audience: typeof TOKEN_IMAGE_UPLOAD_RECEIPT_AUDIENCE_V1;
  keyId: string;
  keyEpoch: string;
  algorithm: "Ed25519";
  providerIdentityHash: Sha256DigestV2;
  idempotencyKey: Sha256DigestV2;
  messageSha256: Sha256DigestV2;
  requestDigest: Sha256DigestV2;
  signature: string;
  observedAt: string;
  expiresAt: string;
}>;

export type SignedTokenImageUploadReceiptV1 = Readonly<{
  schemaVersion: "programmable.signed-token-image-upload-receipt.v1";
  payload: TokenImageUploadReceiptPayloadV1;
  payloadSha256: Sha256DigestV2;
  signature: string;
  signatureSha256: Sha256DigestV2;
  providerReceipt: TokenImageRemoteSigningProviderReceiptV2;
  providerReceiptSha256: Sha256DigestV2;
  providerReceiptSignature: string;
  providerReceiptSignatureSha256: Sha256DigestV2;
}>;

export function parseSignedTokenImageUploadReceiptV1(
  value: unknown,
): SignedTokenImageUploadReceiptV1 {
  const receipt = record(value, "image upload receipt");
  exactKeys(receipt, [
    "payload",
    "payloadSha256",
    "providerReceipt",
    "providerReceiptSha256",
    "providerReceiptSignature",
    "providerReceiptSignatureSha256",
    "schemaVersion",
    "signature",
    "signatureSha256",
  ], "image upload receipt");
  if (receipt.schemaVersion !== "programmable.signed-token-image-upload-receipt.v1") {
    throw new TypeError("image upload receipt schema is invalid");
  }
  const payload = parsePayload(receipt.payload);
  const providerReceipt = parseProviderReceipt(receipt.providerReceipt);
  const parsed = Object.freeze({
    schemaVersion: receipt.schemaVersion,
    payload,
    payloadSha256: digest(receipt.payloadSha256, "image upload receipt payload hash"),
    signature: signature(receipt.signature, "image upload receipt signature"),
    signatureSha256: digest(receipt.signatureSha256, "image upload receipt signature hash"),
    providerReceipt,
    providerReceiptSha256: digest(
      receipt.providerReceiptSha256,
      "image upload provider receipt hash",
    ),
    providerReceiptSignature: signature(
      receipt.providerReceiptSignature,
      "image upload provider receipt signature",
    ),
    providerReceiptSignatureSha256: digest(
      receipt.providerReceiptSignatureSha256,
      "image upload provider receipt signature hash",
    ),
  });
  if (
    providerReceipt.audience !== payload.audience
    || providerReceipt.keyId !== payload.signingAuthority.keyId
    || providerReceipt.keyEpoch !== payload.signingAuthority.keyEpoch
    || providerReceipt.providerIdentityHash
      !== payload.signingAuthority.providerIdentityHash
    || providerReceipt.messageSha256 !== parsed.payloadSha256
    || providerReceipt.signature !== parsed.signature
  ) throw new TypeError("image upload receipt signer binding is invalid");
  return parsed;
}

export function tokenImageUploadReceiptMatchesV1(
  receipt: SignedTokenImageUploadReceiptV1,
  expected: Readonly<{
    launchScope: TokenImageUploadReceiptLaunchScopeV1;
    uri: string;
    contentSha256: Sha256DigestV2;
    byteLength: number;
    width: number;
    height: number;
  }>,
): boolean {
  const { payload } = receipt;
  return payload.launchScope.applicationId === expected.launchScope.applicationId
    && payload.launchScope.applicationHandle === expected.launchScope.applicationHandle
    && payload.launchScope.grantId === expected.launchScope.grantId
    && payload.launchScope.grantBindingHash === expected.launchScope.grantBindingHash
    && payload.blob.url === expected.uri
    && payload.image.contentSha256 === expected.contentSha256
    && payload.image.byteLength === expected.byteLength
    && payload.image.width === expected.width
    && payload.image.height === expected.height;
}

function parsePayload(value: unknown): TokenImageUploadReceiptPayloadV1 {
  const payload = record(value, "image upload receipt payload");
  exactKeys(payload, [
    "audience", "blob", "expiresAt", "image", "issuedAt", "launchScope",
    "schemaVersion", "signingAuthority", "uploadOwner",
  ], "image upload receipt payload");
  if (
    payload.schemaVersion !== "programmable.token-image-upload-receipt.v1"
    || payload.audience !== TOKEN_IMAGE_UPLOAD_RECEIPT_AUDIENCE_V1
  ) throw new TypeError("image upload receipt payload schema is invalid");

  const launchScope = record(payload.launchScope, "image upload launch scope");
  exactKeys(launchScope, [
    "applicationHandle", "applicationId", "grantBindingHash", "grantId",
  ], "image upload launch scope");
  const uploadOwner = record(payload.uploadOwner, "image upload owner");
  exactKeys(uploadOwner, [
    "githubPrincipalHash", "githubUserId", "privyUserId", "provider",
  ], "image upload owner");
  const blob = record(payload.blob, "image upload blob");
  exactKeys(blob, ["etag", "host", "pathname", "storeId", "url"], "image upload blob");
  const image = record(payload.image, "image upload metadata");
  exactKeys(image, [
    "byteLength", "contentSha256", "height", "mediaType", "width",
  ], "image upload metadata");
  const authority = record(payload.signingAuthority, "image upload signing authority");
  exactKeys(authority, [
    "keyEpoch", "keyId", "providerIdentityHash", "publicKeySpkiSha256",
  ], "image upload signing authority");

  if (
    uploadOwner.provider !== "privy-github"
    || image.mediaType !== "image/webp"
    || image.width !== 1000
    || image.height !== 1000
    || typeof image.byteLength !== "number"
    || !Number.isSafeInteger(image.byteLength)
    || image.byteLength < 1
    || image.byteLength > 1_000_000
  ) throw new TypeError("image upload receipt metadata is invalid");
  const applicationId = safeString(launchScope.applicationId, "application id", 80);
  const applicationHandle = safeString(
    launchScope.applicationHandle,
    "application handle",
    80,
  );
  const grantId = safeString(launchScope.grantId, "grant id", 36);
  const githubUserId = safeString(uploadOwner.githubUserId, "GitHub user id", 20);
  const blobUrl = safeString(blob.url, "blob URL", 1_024);
  const blobPathname = safeString(blob.pathname, "blob pathname", 512);
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(applicationId)
    || !/^github-[0-9a-f]{64}$/u.test(applicationHandle)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(grantId)
    || !/^[1-9][0-9]{0,19}$/u.test(githubUserId)
    || blob.storeId !== PROGRAMMABLE_TOKEN_IMAGE_STORE_ID
    || blob.host !== PROGRAMMABLE_TOKEN_IMAGE_HOST
    || !isExactTokenImageBlob(blobUrl, blobPathname)
  ) throw new TypeError("image upload receipt authority is invalid");
  const issuedAt = timestamp(payload.issuedAt, "image receipt issue time");
  const expiresAt = timestamp(payload.expiresAt, "image receipt expiry time");
  if (
    Date.parse(expiresAt) <= Date.parse(issuedAt)
    || Date.parse(expiresAt) - Date.parse(issuedAt)
      > TOKEN_IMAGE_UPLOAD_RECEIPT_MAX_AGE_MS_V1
  ) throw new TypeError("image upload receipt time window is invalid");
  return Object.freeze({
    schemaVersion: payload.schemaVersion,
    audience: payload.audience,
    launchScope: Object.freeze({
      applicationId,
      applicationHandle: applicationHandle as ApplicationHandleV3,
      grantId,
      grantBindingHash: digest(launchScope.grantBindingHash, "grant binding hash"),
    }),
    uploadOwner: Object.freeze({
      provider: uploadOwner.provider,
      privyUserId: safeString(uploadOwner.privyUserId, "Privy user id", 512),
      githubUserId,
      githubPrincipalHash: digest(
        uploadOwner.githubPrincipalHash,
        "GitHub principal hash",
      ),
    }),
    blob: Object.freeze({
      storeId: PROGRAMMABLE_TOKEN_IMAGE_STORE_ID,
      host: PROGRAMMABLE_TOKEN_IMAGE_HOST,
      pathname: blobPathname,
      url: blobUrl,
      etag: safeString(blob.etag, "blob etag", 256),
    }),
    image: Object.freeze({
      contentSha256: digest(image.contentSha256, "image content hash"),
      mediaType: "image/webp",
      byteLength: image.byteLength,
      width: image.width,
      height: image.height,
    }),
    signingAuthority: Object.freeze({
      providerIdentityHash: digest(
        authority.providerIdentityHash,
        "image signer provider identity hash",
      ),
      keyId: safeString(authority.keyId, "image signer key id", 128),
      keyEpoch: safeString(authority.keyEpoch, "image signer key epoch", 128),
      publicKeySpkiSha256: digest(
        authority.publicKeySpkiSha256,
        "image signer public key hash",
      ),
    }),
    issuedAt,
    expiresAt,
  });
}

function parseProviderReceipt(value: unknown): TokenImageRemoteSigningProviderReceiptV2 {
  const receipt = record(value, "remote image signer receipt");
  exactKeys(receipt, [
    "algorithm", "audience", "expiresAt", "idempotencyKey", "keyEpoch",
    "keyId", "messageSha256", "observedAt", "outcome", "providerIdentityHash",
    "requestDigest", "schemaVersion", "signature",
  ], "remote image signer receipt");
  if (
    receipt.schemaVersion !== "programmable.remote-signing-provider-receipt.v2"
    || receipt.outcome !== "completed"
    || receipt.audience !== TOKEN_IMAGE_UPLOAD_RECEIPT_AUDIENCE_V1
    || receipt.algorithm !== "Ed25519"
  ) throw new TypeError("remote image signer receipt schema is invalid");
  const observedAt = timestamp(receipt.observedAt, "remote image signer observed time");
  const expiresAt = timestamp(receipt.expiresAt, "remote image signer expiry time");
  if (
    Date.parse(expiresAt) <= Date.parse(observedAt)
    || Date.parse(expiresAt) - Date.parse(observedAt)
      > TOKEN_IMAGE_UPLOAD_RECEIPT_MAX_AGE_MS_V1
  ) throw new TypeError("remote image signer receipt time window is invalid");
  return Object.freeze({
    schemaVersion: receipt.schemaVersion,
    outcome: receipt.outcome,
    audience: receipt.audience,
    keyId: safeString(receipt.keyId, "remote image signer key id", 128),
    keyEpoch: safeString(receipt.keyEpoch, "remote image signer key epoch", 128),
    algorithm: receipt.algorithm,
    providerIdentityHash: digest(
      receipt.providerIdentityHash,
      "remote image signer provider hash",
    ),
    idempotencyKey: digest(receipt.idempotencyKey, "remote image signer idempotency key"),
    messageSha256: digest(receipt.messageSha256, "remote image signer message hash"),
    requestDigest: digest(receipt.requestDigest, "remote image signer request hash"),
    signature: signature(receipt.signature, "remote image signer signature"),
    observedAt,
    expiresAt,
  });
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

function digest(value: unknown, label: string): Sha256DigestV2 {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Sha256DigestV2;
}

function signature(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^[A-Za-z0-9_-]{86}$/u.test(value)
  ) throw new TypeError(`${label} is invalid`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || new Date(value).toISOString() !== value
  ) throw new TypeError(`${label} is invalid`);
  return value;
}

function safeString(value: unknown, label: string, maximumBytes: number): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || new TextEncoder().encode(value).byteLength > maximumBytes
    || value.normalize("NFC") !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new TypeError(`${label} is invalid`);
  return value;
}

function isExactTokenImageBlob(url: string, pathname: string): boolean {
  try {
    const parsed = new URL(url);
    return getProgrammableTokenImageAssetName(url) !== ""
      && parsed.pathname.slice(1) === pathname;
  } catch {
    return false;
  }
}
