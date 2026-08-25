import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDeveloperApiKeyBridgeV1,
  CUSTOM_LAUNCH_API_SCHEMA_V1,
} from "../lib/server/custom-launch/api-key-bridge-v1";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as const;
const CREDENTIAL_ID = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
const KEY_ID = "A".repeat(22);
const API_KEY_SECRET = `pm_live_${KEY_ID}_${"B".repeat(43)}`;
const WEBSITE_TOKEN = "w".repeat(43);

function summary(extra: Readonly<Record<string, unknown>> = {}) {
  return {
    id: CREDENTIAL_ID,
    label: "Launch agent",
    keyPrefix: `pm_live_${KEY_ID}`,
    scopes: ["custom-launch:create", "custom-launch:read"],
    createdAt: "2026-08-24T12:00:00.000Z",
    expiresAt: "2026-11-22T12:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...extra,
  };
}

function backendJson(body: Readonly<Record<string, unknown>>, status = 200) {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
    ...body,
  }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("developer API key same-origin bridge", () => {
  const authenticate = vi.fn();
  const fetchBackend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authenticate.mockResolvedValue({
      privyUserId: "did:privy:test-user",
      privySessionId: "session-1",
      wallets: [WALLET],
    });
  });

  function bridge() {
    return createDeveloperApiKeyBridgeV1({
      authenticator: { authenticate },
      backendBaseUrl: "https://custom-launch-api.example/",
      websiteToken: WEBSITE_TOKEN,
      fetchBackend,
      backendTimeoutMs: 1_000,
    });
  }

  it("lists only canonical metadata and sends the verified identity server-to-server", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKeys: [summary({ apiKeySecret: "must-not-cross-the-bff" })],
      internalDebug: "must-not-cross-the-bff",
    }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
      {
        headers: {
          accept: "application/json",
          authorization: "Bearer browser-privy-token",
          "x-privy-identity-token": "identity-token",
        },
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      apiKeys: [summary()],
    });
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://custom-launch-api.example/v1/wallet-admin/api-keys",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${WEBSITE_TOKEN}`);
    expect(headers.get("x-programmable-privy-user-id")).toBe(
      "did:privy:test-user",
    );
    expect(headers.get("x-programmable-wallet-address")).toBe(WALLET);
    expect(headers.get("x-privy-identity-token")).toBeNull();
  });

  it("creates an exact two-scope key and exposes its raw value once", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKey: summary(),
      apiKeySecret: API_KEY_SECRET,
    }, 201));
    const request = new Request(
      "https://programmable.market/api/developer/api-keys",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: "Bearer browser-privy-token",
        },
        body: JSON.stringify({
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          walletAddress: WALLET,
          label: "Launch agent",
        }),
      },
    );

    const response = await bridge().create(request);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      apiKey: summary(),
      apiKeySecret: API_KEY_SECRET,
    });
    const [, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      label: "Launch agent",
      expiresInDays: 90,
    });
    expect(String(init.body)).not.toContain(WALLET);
    expect(String(init.body)).not.toContain("browser-privy-token");
  });

  it("rejects a wallet outside the current Privy linked-wallet set", async () => {
    const response = await bridge().create(new Request(
      "https://programmable.market/api/developer/api-keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer browser-privy-token",
        },
        body: JSON.stringify({
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          walletAddress: OTHER_WALLET,
          label: "Wrong wallet",
          expiresInDays: 30,
        }),
      },
    ));

    expect(response.status).toBe(403);
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("fails closed on unknown fields, duplicate fields and non-expiring keys", async () => {
    const bodies = [
      JSON.stringify({
        schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
        walletAddress: WALLET,
        label: "Key",
        scopes: ["fees:claim"],
      }),
      `{"schemaVersion":"${CUSTOM_LAUNCH_API_SCHEMA_V1}","walletAddress":"${WALLET}","label":"one","label":"two"}`,
      JSON.stringify({
        schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
        walletAddress: WALLET,
        label: "Key",
        expiresInDays: null,
      }),
    ];
    for (const body of bodies) {
      const response = await bridge().create(new Request(
        "https://programmable.market/api/developer/api-keys",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
      ));
      expect(response.status).toBe(400);
    }
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("revokes by credential id without exposing the internal service response", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      revoked: true,
      credentialId: CREDENTIAL_ID,
      internalReceipt: "hidden",
    }));
    const response = await bridge().revoke(new Request(
      `https://programmable.market/api/developer/api-keys/${CREDENTIAL_ID}?walletAddress=${WALLET}`,
      {
        method: "DELETE",
        headers: {
          accept: "application/json",
          authorization: "Bearer browser-privy-token",
        },
      },
    ), CREDENTIAL_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      revoked: true,
      credentialId: CREDENTIAL_ID,
    });
    const [, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
    });
  });

  it.each([
    [400, "REQUEST_SCHEMA_INVALID", null],
    [409, "WALLET_BINDING_CONFLICT", null],
    [429, "API_CREDENTIAL_QUOTA_EXCEEDED", "37"],
  ] as const)(
    "preserves bounded backend HTTP %i errors and correlation metadata",
    async (status, code, retryAfter) => {
      const requestId = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
      fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: "programmable.api-error.v1",
        error: {
          code,
          message: "The request could not be completed.",
          requestId,
        },
      }), {
        status,
        headers: {
          "content-type": "application/json",
          ...(retryAfter ? { "retry-after": retryAfter } : {}),
        },
      }));

      const response = await bridge().list(new Request(
        `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
      ));

      expect(response.status).toBe(status);
      expect(response.headers.get("x-request-id")).toBe(requestId);
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(await response.json()).toEqual({
        schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
        error: {
          code,
          message: "The request could not be completed.",
          requestId,
        },
      });
    },
  );

  it("maps malformed or unavailable backend responses to one generic 503", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({ apiKeys: [{ secret: "leak" }] }));
    const malformed = await bridge().list(new Request(
      `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
    ));
    expect(malformed.status).toBe(503);
    expect((await malformed.json()).error.code).toBe("api_key_service_unavailable");

    fetchBackend.mockRejectedValueOnce(new Error("private backend detail"));
    const unavailable = await bridge().list(new Request(
      `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
    ));
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.code).toBe("api_key_service_unavailable");
  });
});
