import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createCustomLaunchDeploymentReadinessHandlerV1,
} from "../lib/server/custom-launch/deployment-readiness";
import { canonicalSha256 } from "../lib/server/projection-target/hashing";

const NOW = new Date("2026-08-05T12:00:00.000Z");
const PACKAGE_ARTIFACT_HASH = `sha256:${"9".repeat(64)}`;
const rawPermitPublicKey = Buffer.alloc(32, 7);
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
  PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED: "true",
  PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN: "https://approval.programmable.example",
  PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: PACKAGE_ARTIFACT_HASH,
  PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "manual_review",
  NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
  PRIVY_APP_SECRET: "privy-secret",
  TOKEN_IMAGE_BLOB_READ_WRITE_TOKEN: "blob-token",
  PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON: JSON.stringify([permitSigner]),
  PROGRAMMABLE_TOKEN_IMAGE_UPLOAD_RECEIPT_SIGNER_V1_JSON:
    JSON.stringify(receiptSigner),
  PROGRAMMABLE_RELEASE_COMMIT_SHA: "1".repeat(40),
  VERCEL_URL: "programmable-immutable-abc.vercel.app",
};

function request(extra: RequestInit = {}): Request {
  return new Request("https://programmable.example/api/custom-launch/readiness", {
    headers: { accept: "application/json" },
    ...extra,
  });
}

function readyServiceResponse(body: unknown = {
  schemaVersion: "2.0.0",
  requestId: "deployment-probe",
  data: {
    status: "ready",
    release: { packageArtifactHash: PACKAGE_ARTIFACT_HASH },
    reviewAuthorityMode: "manual_review",
  },
}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("Custom launch deployment readiness", () => {
  it("reports disabled only after the complete dark deployment is ready", async () => {
    const serviceFetch = vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse());
    const database = vi.fn<() => Promise<void>>().mockResolvedValue();
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: { ...configured, PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED: "false" },
      serviceFetch,
      assertWebsiteProjectionDatabaseReadiness: database,
      now: () => NOW,
    });
    const response = await handler(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: "programmable.custom-launch-deployment-readiness.v1",
      status: "disabled",
      chainId: "1",
      components: {
        approvalService: "ready",
        permitSignerKeyring: "ready",
        publicConfiguration: "ready",
        websiteProjectionDatabase: "ready",
      },
      approvalServiceRelease: {
        packageArtifactHash: PACKAGE_ARTIFACT_HASH,
        reviewAuthorityMode: "manual_review",
      },
      release: {
        commitSha: "1".repeat(40),
        deploymentHost: "programmable-immutable-abc.vercel.app",
      },
      checkedAt: NOW.toISOString(),
    });
    expect(serviceFetch).toHaveBeenCalledOnce();
    expect(database).toHaveBeenCalledOnce();
  });

  it("does not accept an off switch as dark readiness when dependencies are missing", async () => {
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: {
        PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED: "false",
        PROGRAMMABLE_RELEASE_COMMIT_SHA: "1".repeat(40),
        VERCEL_URL: "programmable-immutable-abc.vercel.app",
      },
      serviceFetch: vi.fn<typeof fetch>(),
      assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>(),
      now: () => NOW,
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "unready" });
  });

  it("reports ready only after database, service and signer bindings pass", async () => {
    const serviceFetch = vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse());
    const database = vi.fn<() => Promise<void>>().mockResolvedValue();
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: configured,
      serviceFetch,
      assertWebsiteProjectionDatabaseReadiness: database,
      now: () => NOW,
    });
    const response = await handler(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      schemaVersion: "programmable.custom-launch-deployment-readiness.v1",
      status: "ready",
      chainId: "1",
      components: {
        approvalService: "ready",
        permitSignerKeyring: "ready",
        publicConfiguration: "ready",
        websiteProjectionDatabase: "ready",
      },
      approvalServiceRelease: {
        packageArtifactHash: PACKAGE_ARTIFACT_HASH,
        reviewAuthorityMode: "manual_review",
      },
      release: {
        commitSha: "1".repeat(40),
        deploymentHost: "programmable-immutable-abc.vercel.app",
      },
      checkedAt: NOW.toISOString(),
    });
    expect(body.trustedTimePath).toBe(
      `/api/custom-launch/trusted-time?${new URLSearchParams({
        keyId: permitSigner.keyId,
        signerEpoch: permitSigner.signerEpoch,
        signerComponentBindingHash: permitSigner.signerComponentBindingHash,
        publicKeySpkiSha256: permitSigner.publicKeySpkiSha256,
      }).toString()}`,
    );
    expect(database).toHaveBeenCalledOnce();
    expect(serviceFetch).toHaveBeenCalledWith(
      new URL("https://approval.programmable.example/readyz"),
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("fails closed when an enabled configuration is incomplete", async () => {
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: { ...configured, PRIVY_APP_SECRET: "" },
      serviceFetch: vi.fn<typeof fetch>(),
      assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>(),
      now: () => NOW,
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unready",
      code: "custom_launch_not_ready",
      chainId: "1",
    });
  });

  it("does not mistake an absent or misspelled switch for an intentional disable", async () => {
    for (const value of [undefined, "TRUE", " false"]) {
      const handler = createCustomLaunchDeploymentReadinessHandlerV1({
        environment: {
          ...configured,
          PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED: value,
        },
        serviceFetch: vi.fn<typeof fetch>(),
        assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>(),
        now: () => NOW,
      });
      expect((await handler(request())).status).toBe(503);
    }
  });

  it("fails closed when the immutable release identity is missing or malformed", async () => {
    for (const environment of [
      { ...configured, PROGRAMMABLE_RELEASE_COMMIT_SHA: undefined },
      { ...configured, PROGRAMMABLE_RELEASE_COMMIT_SHA: "A".repeat(40) },
      { ...configured, VERCEL_URL: "https://programmable.example" },
    ]) {
      const handler = createCustomLaunchDeploymentReadinessHandlerV1({
        environment,
        serviceFetch: vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse()),
        assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>().mockResolvedValue(),
        now: () => NOW,
      });
      expect((await handler(request())).status).toBe(503);
    }
  });

  it("fails closed when the expected backend release identity is missing or malformed", async () => {
    for (const environment of [
      { ...configured, PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: undefined },
      { ...configured, PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: `sha256:${"A".repeat(64)}` },
      { ...configured, PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: undefined },
      { ...configured, PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "unconfigured" },
    ]) {
      const serviceFetch = vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse());
      const handler = createCustomLaunchDeploymentReadinessHandlerV1({
        environment,
        serviceFetch,
        assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>().mockResolvedValue(),
        now: () => NOW,
      });
      expect((await handler(request())).status).toBe(503);
      expect(serviceFetch).not.toHaveBeenCalled();
    }
  });

  it("accepts autonomous AI only when expected and runtime modes match exactly", async () => {
    const environment = {
      ...configured,
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "autonomous_ai",
    };
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment,
      serviceFetch: vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse({
        schemaVersion: "2.0.0",
        requestId: "deployment-probe",
        data: {
          status: "ready",
          release: { packageArtifactHash: PACKAGE_ARTIFACT_HASH },
          reviewAuthorityMode: "autonomous_ai",
        },
      })),
      assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>().mockResolvedValue(),
      now: () => NOW,
    });
    await expect((await handler(request())).json()).resolves.toMatchObject({
      status: "ready",
      approvalServiceRelease: { reviewAuthorityMode: "autonomous_ai" },
    });
  });

  it("rejects a ready backend with a missing, wrong or substituted release identity", async () => {
    const serviceBodies = [
      {
        schemaVersion: "2.0.0",
        requestId: "deployment-probe",
        data: { status: "ready" },
      },
      {
        schemaVersion: "2.0.0",
        requestId: "deployment-probe",
        data: {
          status: "ready",
          release: { packageArtifactHash: `sha256:${"8".repeat(64)}` },
          reviewAuthorityMode: "manual_review",
        },
      },
      {
        schemaVersion: "2.0.0",
        requestId: "deployment-probe",
        data: {
          status: "ready",
          release: { packageArtifactHash: PACKAGE_ARTIFACT_HASH },
          reviewAuthorityMode: "autonomous_ai",
        },
      },
      {
        schemaVersion: "2.0.0",
        requestId: "deployment-probe",
        data: {
          status: "ready",
          release: { packageArtifactHash: PACKAGE_ARTIFACT_HASH, unexpected: true },
          reviewAuthorityMode: "manual_review",
        },
      },
    ];
    for (const body of serviceBodies) {
      const handler = createCustomLaunchDeploymentReadinessHandlerV1({
        environment: configured,
        serviceFetch: vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse(body)),
        assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>().mockResolvedValue(),
        now: () => NOW,
      });
      expect((await handler(request())).status).toBe(503);
    }
  });

  it.each([
    ["database", async () => { throw new Error("unavailable"); }, async () => readyServiceResponse()],
    ["service status", async () => {}, async () => new Response("{}", {
      status: 503,
      headers: { "content-type": "application/json" },
    })],
    ["service redirect", async () => {}, async () => new Response(null, {
      status: 302,
      headers: { location: "https://old-approval.programmable.example/readyz" },
    })],
    ["service schema", async () => {}, async () => readyServiceResponse({
      schemaVersion: "2.0.0",
      requestId: "deployment-probe",
      data: {
        status: "ok",
        release: { packageArtifactHash: PACKAGE_ARTIFACT_HASH },
        reviewAuthorityMode: "manual_review",
      },
    })],
  ])("fails closed on %s failure", async (_name, database, serviceFetch) => {
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: configured,
      serviceFetch: serviceFetch as typeof fetch,
      assertWebsiteProjectionDatabaseReadiness: database,
      now: () => NOW,
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "unready" });
  });

  it("rejects query strings, request bodies and missing JSON accept headers", async () => {
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: configured,
      serviceFetch: vi.fn<typeof fetch>(),
      assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>(),
      now: () => NOW,
    });
    for (const invalid of [
      new Request("https://programmable.example/api/custom-launch/readiness?verbose=1", {
        headers: { accept: "application/json" },
      }),
      new Request("https://programmable.example/api/custom-launch/readiness"),
      request({ method: "POST", body: "{}", headers: {
        accept: "application/json",
        "content-type": "application/json",
      } }),
    ]) {
      expect((await handler(invalid)).status).toBe(400);
    }
  });
});
