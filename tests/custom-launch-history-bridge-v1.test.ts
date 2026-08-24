import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDeveloperLaunchHistoryBridgeV1,
  CUSTOM_LAUNCH_LIST_SCHEMA_V1,
} from "../lib/server/custom-launch/launch-history-bridge-v1";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as const;
const LAUNCH_ID = "40000000-0000-4000-8000-000000000004";
const WEBSITE_TOKEN = "w".repeat(43);

function launch(ownerWallet: string = WALLET) {
  return {
    schemaVersion: "programmable.custom-launch.v1",
    launchId: LAUNCH_ID,
    requestId: LAUNCH_ID,
    onchainLaunchId: null,
    routeId: "custom-launch:create:v1",
    ownerWallet,
    status: "authorized",
    requestHash: `sha256:${"11".repeat(32)}`,
    createdAt: "2026-08-24T12:00:00.000Z",
    updatedAt: "2026-08-24T12:00:01.000Z",
    output: {
      walletTransaction: {
        to: "0x3333333333333333333333333333333333333333",
        calldata: "0x1234",
        requiresControllerWalletSignature: true,
        broadcastByService: false,
      },
    },
    failure: null,
  };
}

function cursor() {
  return Buffer.from(JSON.stringify({
    createdAt: "2026-08-24T12:00:00.000Z",
    launchId: LAUNCH_ID,
  }), "utf8").toString("base64url");
}

function backendJson(body: Readonly<Record<string, unknown>>) {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V1,
    ...body,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("developer launch history same-origin bridge", () => {
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
    return createDeveloperLaunchHistoryBridgeV1({
      authenticator: { authenticate },
      backendBaseUrl: "https://custom-launch-api.example/",
      websiteToken: WEBSITE_TOKEN,
      fetchBackend,
      backendTimeoutMs: 1_000,
    });
  }

  it("returns the exact wallet history and preserves its prepared wallet transaction", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      launches: [launch()],
      nextCursor: cursor(),
      internalDebug: "must-not-cross-the-bff",
    }));
    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
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
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V1,
      launches: [launch()],
      nextCursor: cursor(),
    });
    expect(JSON.stringify(body)).not.toContain("internalDebug");
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://custom-launch-api.example/v1/wallet-admin/custom-launches?limit=5",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${WEBSITE_TOKEN}`);
    expect(headers.get("x-programmable-privy-user-id")).toBe(
      "did:privy:test-user",
    );
    expect(headers.get("x-programmable-wallet-address")).toBe(WALLET);
    expect(headers.get("x-privy-identity-token")).toBeNull();
  });

  it("fails closed if the backend returns any other wallet", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      launches: [launch(OTHER_WALLET)],
      nextCursor: null,
    }));
    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}`,
    ));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "launch_history_unavailable",
    );
  });

  it("checks one exact wallet-owned request through the reconciliation read", async () => {
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(launch()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${LAUNCH_ID}?walletAddress=${WALLET}`,
      { headers: { authorization: "Bearer browser-privy-token" } },
    ), LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(launch());
    const [url] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      `https://custom-launch-api.example/v1/wallet-admin/custom-launches/${LAUNCH_ID}`,
    );
  });

  it("rejects non-linked wallets and malformed opaque cursors before backend access", async () => {
    const foreign = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${OTHER_WALLET}`,
    ));
    expect(foreign.status).toBe(403);

    const malformed = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&cursor=not-a-cursor`,
    ));
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("pagination_invalid");
    expect(fetchBackend).not.toHaveBeenCalled();
  });
});
