import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  configuredLaunchPermitSignersV2,
  isCustomLaunchPublicEnabled,
  isCustomLaunchRegistryPublicReadEnabled,
} from "../lib/server/custom-launch/public-readiness";
import { handleProductionCustomLaunchBridgeV2 } from "../lib/server/custom-launch/launch-bridge-v2";
import { canonicalSha256 } from "../lib/server/projection-target/hashing";
import { GET as legacyEntitlementGET } from "../app/api/custom-launch/entitlements/route";
import { GET as trustedTimeGET } from "../app/api/custom-launch/trusted-time/route";

const rawPermitPublicKey = Buffer.alloc(32, 1);
const permitSigner = {
  keyId: "launch-permit-primary",
  signerEpoch: "1",
  signerComponentBindingHash: `sha256:${"a".repeat(64)}`,
  publicKeyBase64Url: rawPermitPublicKey.toString("base64url"),
  publicKeySpkiSha256: `sha256:${createHash("sha256").update(Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    rawPermitPublicKey,
  ])).digest("hex")}`,
};
const receiptSignerCore = {
  schemaVersion: "programmable.remote-ed25519-provider-identity.v2" as const,
  endpoint: "https://signer.programmable.example/v1/sign",
  audience: "programmable.launch-presentation-image.v1",
  keyId: "token-image-receipt",
  keyEpoch: "1",
  publicKeySpkiSha256: permitSigner.publicKeySpkiSha256,
};
const receiptSigner = {
  schemaVersion: "programmable.token-image-upload-receipt-signer-binding.v1",
  endpoint: receiptSignerCore.endpoint,
  audience: receiptSignerCore.audience,
  keyId: receiptSignerCore.keyId,
  keyEpoch: receiptSignerCore.keyEpoch,
  publicKeyBase64Url: permitSigner.publicKeyBase64Url,
  publicKeySpkiSha256: receiptSignerCore.publicKeySpkiSha256,
  providerIdentityHash: canonicalSha256(receiptSignerCore.schemaVersion, receiptSignerCore),
  credentialMode: "vercel-oidc-bearer",
};

const configured = {
  PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED: "true",
  PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN: "https://approval.programmable.example",
  PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: `sha256:${"9".repeat(64)}`,
  PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "manual_review",
  NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
  PRIVY_APP_SECRET: "privy-secret",
  TOKEN_IMAGE_BLOB_READ_WRITE_TOKEN: "blob-token",
  PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON: JSON.stringify([permitSigner]),
  PROGRAMMABLE_TOKEN_IMAGE_UPLOAD_RECEIPT_SIGNER_V1_JSON:
    JSON.stringify(receiptSigner),
};

function trustedTimeRequest(signer = permitSigner): Request {
  const query = new URLSearchParams({
    keyId: signer.keyId,
    signerEpoch: signer.signerEpoch,
    signerComponentBindingHash: signer.signerComponentBindingHash,
    publicKeySpkiSha256: signer.publicKeySpkiSha256,
  });
  return new Request(
    `https://website.example/api/custom-launch/trusted-time?${query.toString()}`,
    { headers: { accept: "application/json" } },
  );
}

describe("Custom launch public readiness", () => {
  it("requires the explicit public switch and every authentication/service binding", () => {
    expect(isCustomLaunchPublicEnabled(configured)).toBe(true);
    expect(isCustomLaunchPublicEnabled({ ...configured, PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED: "false" })).toBe(false);
    expect(isCustomLaunchPublicEnabled({ ...configured, PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN: "" })).toBe(false);
    expect(isCustomLaunchPublicEnabled({
      ...configured,
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: "",
    })).toBe(false);
    expect(isCustomLaunchPublicEnabled({
      ...configured,
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "autonomous_ai",
    })).toBe(true);
    expect(isCustomLaunchPublicEnabled({
      ...configured,
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "unconfigured",
    })).toBe(false);
    expect(isCustomLaunchPublicEnabled({ ...configured, NEXT_PUBLIC_PRIVY_APP_ID: "" })).toBe(false);
    expect(isCustomLaunchPublicEnabled({ ...configured, PRIVY_APP_SECRET: "" })).toBe(false);
    expect(isCustomLaunchPublicEnabled({
      ...configured,
      TOKEN_IMAGE_BLOB_READ_WRITE_TOKEN: "",
    })).toBe(false);
    expect(isCustomLaunchPublicEnabled({
      ...configured,
      PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON: "",
    })).toBe(false);
    expect(isCustomLaunchPublicEnabled({
      ...configured,
      PROGRAMMABLE_TOKEN_IMAGE_UPLOAD_RECEIPT_SIGNER_V1_JSON: "",
    })).toBe(false);
  });

  it("separates finalized Registry reads from launch-write service readiness", () => {
    expect(isCustomLaunchRegistryPublicReadEnabled({
      PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED: "true",
    })).toBe(false);
    expect(isCustomLaunchRegistryPublicReadEnabled({
      ...configured,
      PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED: "false",
    })).toBe(false);
  });

  it("fails closed on malformed, substituted, or duplicate permit signer pins", () => {
    expect(configuredLaunchPermitSignersV2(configured)).toEqual([permitSigner]);
    for (const keyring of [
      "not-json",
      "[]",
      JSON.stringify([{ ...permitSigner, extra: true }]),
      JSON.stringify([{ ...permitSigner, signerEpoch: "0" }]),
      JSON.stringify([{ ...permitSigner, publicKeyBase64Url: "not+base64" }]),
      JSON.stringify([{ ...permitSigner, publicKeySpkiSha256: `sha256:${"b".repeat(64)}` }]),
      JSON.stringify([permitSigner, permitSigner]),
    ]) {
      const environment = {
        ...configured,
        PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON: keyring,
      };
      expect(configuredLaunchPermitSignersV2(environment)).toEqual([]);
      expect(isCustomLaunchPublicEnabled(environment)).toBe(false);
    }
  });

  it("rejects non-HTTPS or non-origin service values", () => {
    expect(isCustomLaunchPublicEnabled({ ...configured, PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN: "http://approval.programmable.example" })).toBe(false);
    expect(isCustomLaunchPublicEnabled({ ...configured, PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN: "https://approval.programmable.example/path" })).toBe(false);
    expect(isCustomLaunchPublicEnabled({ ...configured, PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN: "https://user@approval.programmable.example" })).toBe(false);
  });

  it("accepts the canonical root origin with or without its trailing slash", () => {
    expect(isCustomLaunchPublicEnabled(configured)).toBe(true);
    expect(isCustomLaunchPublicEnabled({
      ...configured,
      PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN: "https://approval.programmable.example/",
    })).toBe(true);
  });

  it("blocks both V2 and legacy entitlement APIs when Custom is not public", async () => {
    const previous = process.env.PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED;
    process.env.PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED = "false";
    try {
      const request = new Request("https://website.example/api/custom-launch/v3/applications", {
        headers: { accept: "application/json" },
      });
      const response = await handleProductionCustomLaunchBridgeV2(request, {
        kind: "application-list",
      });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "custom_launch_not_public",
      });

      const legacy = await legacyEntitlementGET(new Request(
        "https://website.example/api/custom-launch/entitlements",
        { headers: { accept: "application/json" } },
      ));
      expect(legacy.status).toBe(503);
      await expect(legacy.json()).resolves.toMatchObject({
        code: "custom_launch_not_public",
      });
    } finally {
      if (previous === undefined) delete process.env.PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED;
      else process.env.PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED = previous;
    }
  });

  it("serves trusted time only behind complete readiness and never caches it", async () => {
    const keys = Object.keys(configured) as (keyof typeof configured)[];
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) process.env[key] = configured[key];
      const request = trustedTimeRequest();
      const response = trustedTimeGET(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
      await expect(response.json()).resolves.toEqual({
        schemaVersion: "programmable.trusted-time.v1",
        now: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
      });

      const invalidRequest = trustedTimeGET(new Request(
        "https://website.example/api/custom-launch/trusted-time?cache=1",
        { headers: { accept: "application/json" } },
      ));
      expect(invalidRequest.status).toBe(400);
      expect(invalidRequest.headers.get("cache-control")).toBe("no-store, max-age=0");

      const oldSigner = permitSigner;
      const replacement = {
        ...permitSigner,
        keyId: "launch-permit-replacement",
      };
      process.env.PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON = JSON.stringify([replacement]);
      const revoked = trustedTimeGET(trustedTimeRequest(oldSigner));
      expect(revoked.status).toBe(409);
      await expect(revoked.json()).resolves.toMatchObject({
        code: "launch_permit_signer_not_current",
      });

      process.env.PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON = "malformed";
      const unavailable = trustedTimeGET(request);
      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.get("cache-control")).toBe("no-store, max-age=0");
    } finally {
      for (const key of keys) {
        const value = previous.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
