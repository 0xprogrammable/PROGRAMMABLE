import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";

import Ajv from "ajv";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  SignedTokenImageUploadReceiptV1,
  TokenImageUploadReceiptLaunchScopeV1,
} from "../lib/custom-launch/token-image-upload-receipt-v1";
import {
  parseSignedTokenImageUploadReceiptV1,
  TOKEN_IMAGE_UPLOAD_RECEIPT_SCHEMA_SHA256_V1,
} from "../lib/custom-launch/token-image-upload-receipt-v1";
import { canonicalizeJson } from "../lib/server/projection-target/canonical-json";
import { canonicalSha256 } from "../lib/server/projection-target/hashing";
import {
  createRemoteTokenImageUploadReceiptSignerV1,
  createProductionTokenImageUploadReceiptSignerV1,
  authorizeTokenImagePresentationMutationV1,
  parseTokenImageUploadReceiptSignerBindingV1,
  verifyTokenImageUploadReceiptForPresentationV1,
  type TokenImageUploadReceiptSignerBindingV1,
} from "../lib/server/token-image-upload-receipt-v1";
import {
  PROGRAMMABLE_TOKEN_IMAGE_HOST,
  PROGRAMMABLE_TOKEN_IMAGE_STORE_ID,
} from "../lib/token-image";
import receiptSchema from "../lib/custom-launch/artifacts/token-image-upload-receipt-v1.schema.json";
import receiptGolden from "./fixtures/token-image-upload-receipt-v1.json";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const IMAGE_URL = `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/example.webp`;
const CONTENT_HASH = digest(0x11);
const PRINCIPAL_HASH = digest(0x22);
const GRANT_HASH = digest(0x33);
const SCOPE: TokenImageUploadReceiptLaunchScopeV1 = Object.freeze({
  applicationId: "application-1",
  applicationHandle: `github-${"a".repeat(64)}`,
  grantId: "123e4567-e89b-42d3-a456-426614174002",
  grantBindingHash: GRANT_HASH,
});

type SignerHarness = Readonly<{
  privateKey: KeyObject;
  publicKey: KeyObject;
  binding: TokenImageUploadReceiptSignerBindingV1;
  fetch: typeof fetch;
}>;

describe("token image upload receipt v1", () => {
  it("keeps the portable JSON schema and cryptographic golden fixture exact", () => {
    expect(rawDigest(readFileSync(new URL(
      "../lib/custom-launch/artifacts/token-image-upload-receipt-v1.schema.json",
      import.meta.url,
    )))).toBe(TOKEN_IMAGE_UPLOAD_RECEIPT_SCHEMA_SHA256_V1);
    const validate = new Ajv({ allErrors: true, strict: true }).compile(receiptSchema);
    expect(validate(receiptGolden.receipt), JSON.stringify(validate.errors)).toBe(true);
    const parsed = parseSignedTokenImageUploadReceiptV1(receiptGolden.receipt);
    expect(parsed).toEqual(receiptGolden.receipt);
    expect(verifyTokenImageUploadReceiptForPresentationV1({
      receipt: parsed,
      trustedSigner: parseTokenImageUploadReceiptSignerBindingV1(
        receiptGolden.signerBinding,
      ),
      expectedLaunchScope: parsed.payload.launchScope,
      expectedPrincipal: {
        githubUserId: "123",
        githubPrincipalHash: parsed.payload.uploadOwner.githubPrincipalHash,
      },
      expectedImage: {
        uri: parsed.payload.blob.url,
        ...parsed.payload.image,
      },
      now: new Date("2026-08-12T12:00:01.000Z"),
    })).toEqual(parsed.payload);
  });

  it("authenticates an exact principal, grant, immutable Blob and image", async () => {
    const harness = signerHarness();
    const receipt = await issueReceipt(harness);
    expect(parseSignedTokenImageUploadReceiptV1(receipt)).toEqual(receipt);
    expect(verify(receipt, harness.binding)).toMatchObject({
      launchScope: SCOPE,
      image: {
        contentSha256: CONTENT_HASH,
        byteLength: 12_345,
        width: 1_000,
        height: 1_000,
      },
      blob: {
        storeId: PROGRAMMABLE_TOKEN_IMAGE_STORE_ID,
        host: PROGRAMMABLE_TOKEN_IMAGE_HOST,
        etag: "etag-1",
      },
    });
  });

  it("rejects foreign principals and replay across application or grant", async () => {
    const harness = signerHarness();
    const receipt = await issueReceipt(harness);
    expect(() => verify(receipt, harness.binding, {
      principal: { githubUserId: "999", githubPrincipalHash: digest(0x99) },
    })).toThrow("another principal");
    expect(() => verify(receipt, harness.binding, {
      scope: { ...SCOPE, applicationId: "application-2" },
    })).toThrow("presentation");
    expect(() => verify(receipt, harness.binding, {
      scope: { ...SCOPE, grantId: "123e4567-e89b-42d3-a456-426614174099" },
    })).toThrow("presentation");
  });

  it("rejects expired receipts and old signer epochs", async () => {
    const harness = signerHarness();
    const receipt = await issueReceipt(harness);
    expect(() => verify(receipt, harness.binding, {
      now: new Date("2026-08-12T12:05:00.000Z"),
    })).toThrow("expired");
    const oldEpoch = bindingForPublicKey(harness.publicKey, "epoch-0");
    expect(() => verify(receipt, oldEpoch)).toThrow("untrusted signer");
  });

  it("rejects URL, hash, size and dimension substitutions", async () => {
    const harness = signerHarness();
    const receipt = await issueReceipt(harness);
    expect(() => verify(receipt, harness.binding, {
      image: { uri: `${IMAGE_URL}.other` },
    })).toThrow("presentation");
    expect(() => verify(receipt, harness.binding, {
      image: { contentSha256: digest(0x44) },
    })).toThrow("presentation");
    expect(() => verify(receipt, harness.binding, {
      image: { byteLength: 12_346 },
    })).toThrow("presentation");
    expect(() => verify(receipt, harness.binding, {
      image: { width: 999 },
    })).toThrow("presentation");
    expect(() => verify(receipt, harness.binding, {
      image: { mediaType: "image/png" as "image/webp" },
    })).toThrow("presentation");
  });

  it("rejects signed-field tampering including the Blob ETag", async () => {
    const harness = signerHarness();
    const receipt = await issueReceipt(harness);
    const tampered = structuredClone(receipt) as {
      payload: { blob: { etag: string } };
    } & SignedTokenImageUploadReceiptV1;
    tampered.payload.blob.etag = "etag-2";
    expect(() => verify(tampered, harness.binding)).toThrow("byte integrity");
  });

  it("rejects unknown receipt fields before cryptographic verification", async () => {
    const harness = signerHarness();
    const receipt = await issueReceipt(harness);
    expect(() => parseSignedTokenImageUploadReceiptV1({
      ...receipt,
      localSignerFallback: true,
    })).toThrow("unknown or missing");
  });

  it("fails closed on signer redirect, timeout and oversized response", async () => {
    const base = signerHarness();
    const redirected = createRemoteTokenImageUploadReceiptSignerV1({
      binding: base.binding,
      credential: "opaque-workload-token-value",
      now: () => NOW,
      fetch: async () => ({ redirected: true, status: 200 }) as Response,
    });
    await expect(redirected.sign(signingInput())).rejects.toThrow("rejected");

    const timedOut = createRemoteTokenImageUploadReceiptSignerV1({
      binding: base.binding,
      credential: "opaque-workload-token-value",
      now: () => NOW,
      timeoutMs: 500,
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      }),
    });
    await expect(timedOut.sign(signingInput())).rejects.toThrow("deadline");

    const oversized = createRemoteTokenImageUploadReceiptSignerV1({
      binding: base.binding,
      credential: "opaque-workload-token-value",
      now: () => NOW,
      fetch: async () => new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "999999",
        },
      }),
    });
    await expect(oversized.sign(signingInput())).rejects.toThrow("too large");
  });

  it("gets signer credentials from the Vercel authority, not a caller header", async () => {
    const harness = signerHarness();
    const hostileRequest = new Request("https://programmable.example/api/token-image", {
      headers: { "x-vercel-oidc-token": "attacker-selected-token" },
    });
    expect(hostileRequest.headers.get("x-vercel-oidc-token")).toBe(
      "attacker-selected-token",
    );
    vi.stubEnv(
      "PROGRAMMABLE_TOKEN_IMAGE_UPLOAD_RECEIPT_SIGNER_V1_JSON",
      canonicalizeJson(harness.binding),
    );
    let authorization = "";
    const signer = await createProductionTokenImageUploadReceiptSignerV1({
      credentialProvider: async () => "vercel-context-header.payload.signature",
      now: () => NOW,
      fetch: async (url, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return harness.fetch(url, init);
      },
    });
    await signer.sign(signingInput());
    expect(authorization).toBe("Bearer vercel-context-header.payload.signature");
    expect(authorization).not.toContain("attacker-selected-token");
    vi.unstubAllEnvs();
  });

  it("reuses an unchanged durable image after receipt expiry but gates create/change", async () => {
    const harness = signerHarness();
    const receipt = await issueReceipt(harness);
    const image = signingInput().image;
    const presentationImage = {
      uri: IMAGE_URL,
      ...image,
    };
    const common = {
      trustedSigner: harness.binding,
      expectedLaunchScope: SCOPE,
      expectedPrincipal: {
        githubUserId: "123",
        githubPrincipalHash: PRINCIPAL_HASH,
      },
      now: new Date("2026-08-12T13:00:00.000Z"),
    };
    expect(authorizeTokenImagePresentationMutationV1({
      ...common,
      currentImage: presentationImage,
      requestedImage: { ...presentationImage },
      receipt: null,
    })).toBe("unchanged");
    expect(() => authorizeTokenImagePresentationMutationV1({
      ...common,
      currentImage: null,
      requestedImage: presentationImage,
      receipt: null,
    })).toThrow("required");
    expect(() => authorizeTokenImagePresentationMutationV1({
      ...common,
      currentImage: null,
      requestedImage: presentationImage,
      receipt,
    })).toThrow("expired");
  });
});

function signerHarness(): SignerHarness {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const binding = bindingForPublicKey(publicKey, "epoch-1");
  const transport: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as Record<string, string>;
    const message = Buffer.from(request.message!, "base64url");
    const signature = signBytes(null, message, privateKey).toString("base64url");
    const providerReceipt = {
      schemaVersion: "programmable.remote-signing-provider-receipt.v2",
      outcome: "completed",
      audience: request.audience,
      keyId: request.keyId,
      keyEpoch: request.keyEpoch,
      algorithm: "Ed25519",
      providerIdentityHash: request.providerIdentityHash,
      idempotencyKey: request.idempotencyKey,
      messageSha256: request.messageSha256,
      requestDigest: request.requestDigest,
      signature,
      observedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
    };
    const receiptBytes = Buffer.from(canonicalizeJson(providerReceipt), "utf8");
    const response = {
      schemaVersion: "programmable.remote-signing-authenticated-response.v2",
      providerReceipt,
      providerReceiptDigest: rawDigest(receiptBytes),
      providerReceiptSignature: signBytes(null, receiptBytes, privateKey)
        .toString("base64url"),
    };
    return new Response(canonicalizeJson(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return Object.freeze({ privateKey, publicKey, binding, fetch: transport });
}

async function issueReceipt(harness: SignerHarness) {
  const signer = createRemoteTokenImageUploadReceiptSignerV1({
    binding: harness.binding,
    credential: "opaque-workload-token-value",
    fetch: harness.fetch,
    now: () => NOW,
  });
  return signer.sign(signingInput());
}

function signingInput() {
  return {
    launchScope: SCOPE,
    uploadOwner: {
      provider: "privy-github" as const,
      privyUserId: "did:privy:user-1",
      githubUserId: "123",
      githubPrincipalHash: PRINCIPAL_HASH,
    },
    blob: {
      storeId: PROGRAMMABLE_TOKEN_IMAGE_STORE_ID,
      host: PROGRAMMABLE_TOKEN_IMAGE_HOST,
      pathname: "token-images/example.webp",
      url: IMAGE_URL,
      etag: "etag-1",
    },
    image: {
      contentSha256: CONTENT_HASH,
      mediaType: "image/webp" as const,
      byteLength: 12_345,
      width: 1_000 as const,
      height: 1_000 as const,
    },
  };
}

function verify(
  receipt: unknown,
  binding: TokenImageUploadReceiptSignerBindingV1,
  overrides: Readonly<{
    now?: Date;
    scope?: TokenImageUploadReceiptLaunchScopeV1;
    principal?: Readonly<{
      githubUserId: string;
      githubPrincipalHash: `sha256:${string}`;
    }>;
    image?: Partial<{
      uri: string;
      contentSha256: `sha256:${string}`;
      mediaType: "image/webp";
      byteLength: number;
      width: number;
      height: number;
    }>;
  }> = {},
) {
  return verifyTokenImageUploadReceiptForPresentationV1({
    receipt,
    trustedSigner: binding,
    expectedLaunchScope: overrides.scope ?? SCOPE,
    expectedPrincipal: overrides.principal ?? {
      githubUserId: "123",
      githubPrincipalHash: PRINCIPAL_HASH,
    },
    expectedImage: {
      uri: IMAGE_URL,
      contentSha256: CONTENT_HASH,
      mediaType: "image/webp",
      byteLength: 12_345,
      width: 1_000,
      height: 1_000,
      ...overrides.image,
    },
    now: overrides.now ?? new Date(NOW.getTime() + 1_000),
  });
}

function bindingForPublicKey(
  publicKey: KeyObject,
  keyEpoch: string,
): TokenImageUploadReceiptSignerBindingV1 {
  const spki = publicKey.export({ format: "der", type: "spki" });
  const publicKeyBase64Url = spki.subarray(-32).toString("base64url");
  const publicKeySpkiSha256 = rawDigest(spki);
  const endpoint = "https://signer.example/v1/sign";
  const core = {
    schemaVersion: "programmable.remote-ed25519-provider-identity.v2" as const,
    endpoint,
    audience: "programmable.launch-presentation-image.v1" as const,
    keyId: "token-image-receipt",
    keyEpoch,
    publicKeySpkiSha256,
  };
  return parseTokenImageUploadReceiptSignerBindingV1({
    schemaVersion: "programmable.token-image-upload-receipt-signer-binding.v1",
    endpoint,
    audience: core.audience,
    keyId: core.keyId,
    keyEpoch,
    publicKeyBase64Url,
    publicKeySpkiSha256,
    providerIdentityHash: canonicalSha256(core.schemaVersion, core),
    credentialMode: "vercel-oidc-bearer",
  });
}

function digest(byte: number): `sha256:${string}` {
  return `sha256:${byte.toString(16).padStart(2, "0").repeat(32)}`;
}

function rawDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
