import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDeveloperLaunchHistoryBridgeV1,
  CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
  CUSTOM_LAUNCH_LIST_SCHEMA_V1,
  CUSTOM_LAUNCH_LIST_SCHEMA_V2,
  CUSTOM_LAUNCH_LIST_SCHEMA_V3,
} from "../lib/server/custom-launch/launch-history-bridge-v1";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as const;
const LAUNCH_ID = "40000000-0000-4000-8000-000000000004";
const V2_LAUNCH_ID = "50000000-0000-4000-8000-000000000005";
const V3_LAUNCH_ID = "60000000-0000-4000-8000-000000000006";
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

function cursor(
  launchId: string = LAUNCH_ID,
  createdAt = "2026-08-24T12:00:00.000Z",
) {
  return Buffer.from(JSON.stringify({
    createdAt,
    launchId,
  }), "utf8").toString("base64url");
}

function launchV2(ownerWallet: string = WALLET) {
  return {
    schemaVersion: "programmable.custom-launch.v2",
    launchId: V2_LAUNCH_ID,
    requestId: V2_LAUNCH_ID,
    onchainLaunchId: null,
    routeId: "custom-launch:create:v2",
    ownerWallet,
    status: "simulating",
    requestHash: `sha256:${"22".repeat(32)}`,
    launchProfileHash: `sha256:${"33".repeat(32)}`,
    launchIntentHash: `sha256:${"44".repeat(32)}`,
    createdAt: "2026-08-24T12:01:00.000Z",
    updatedAt: "2026-08-24T12:01:01.000Z",
    output: null,
    failure: null,
  };
}

function launchV3(ownerWallet: string = WALLET) {
  return {
    schemaVersion: "programmable.custom-launch.v3",
    launchId: V3_LAUNCH_ID,
    requestId: V3_LAUNCH_ID,
    onchainLaunchId: null,
    routeId: "custom-launch:create:v3",
    ownerWallet,
    status: "awaiting_funding_authorization",
    requestHash: `sha256:${"55".repeat(32)}`,
    launchProfileHash: `sha256:${"66".repeat(32)}`,
    launchIntentHash: `sha256:${"77".repeat(32)}`,
    fundingIntentHash: `0x${"88".repeat(32)}`,
    createdAt: "2026-08-24T12:02:00.000Z",
    updatedAt: "2026-08-24T12:02:01.000Z",
    output: null,
    failure: null,
  };
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

function backendJsonV2(body: Readonly<Record<string, unknown>>) {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V2,
    ...body,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function backendJsonV3(body: Readonly<Record<string, unknown>>) {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V3,
    ...body,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function missingV2() {
  return new Response(null, { status: 404 });
}

function v3IntegrationPending() {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V3,
    error: {
      code: "CUSTOM_LAUNCH_V3_INTEGRATION_PENDING",
      message: "V3 launch integration is not active yet.",
    },
  }), {
    status: 503,
    headers: {
      "content-type": "application/json",
      "retry-after": "30",
    },
  });
}

describe("developer launch history same-origin bridge", () => {
  const authenticate = vi.fn();
  const fetchBackend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockReset();
    fetchBackend.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authenticate.mockResolvedValue({
      privyUserId: "did:privy:test-user",
      privySessionId: "session-1",
      wallets: [WALLET],
    });
    fetchBackend.mockResolvedValue(new Response(null, { status: 404 }));
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
    })).mockResolvedValueOnce(missingV2());
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
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [launch()],
      nextCursor: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("internalDebug");
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://custom-launch-api.example/v1/wallet-admin/custom-launches?limit=5",
    );
    expect((fetchBackend.mock.calls[1]![0] as URL).toString()).toBe(
      "https://custom-launch-api.example/v2/wallet-admin/custom-launches?limit=5",
    );
    expect((fetchBackend.mock.calls[2]![0] as URL).toString()).toBe(
      "https://custom-launch-api.example/v3/wallet-admin/custom-launches?limit=5",
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
    })).mockResolvedValueOnce(missingV2());
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

  it.each([
    [400, "REQUEST_SCHEMA_INVALID", null],
    [409, "RECONCILIATION_CONFLICT", null],
    [429, "LAUNCH_QUOTA_EXCEEDED", "19"],
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
      })).mockResolvedValueOnce(missingV2());

      const response = await bridge().list(new Request(
        `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}`,
      ));

      expect(response.status).toBe(status);
      expect(response.headers.get("x-request-id")).toBe(requestId);
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(await response.json()).toEqual({
        schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
        error: {
          code,
          message: "The request could not be completed.",
          requestId,
        },
      });
    },
  );

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

  it("merges bounded route-isolated V1 and V2 pages without hiding simulating", async () => {
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [launch()], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({
        launches: [launchV2()],
        nextCursor: null,
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [launchV2(), launch()],
      nextCursor: null,
    });
  });

  it("preserves an exact compact authorized V2 list row with null output", async () => {
    const compact = {
      ...launchV2(),
      status: "authorized",
      output: null,
    };
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({
        launches: [compact],
        nextCursor: null,
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [compact],
      nextCursor: null,
    });
  });

  it("merges the additive compact V3 wallet lane without exposing output", async () => {
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV3({
        launches: [launchV3()],
        nextCursor: null,
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [launchV3()],
      nextCursor: null,
    });
  });

  it("keeps V1 and V2 history available during exact V3 integration pending", async () => {
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [launch()], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({
        launches: [launchV2()],
        nextCursor: null,
      }))
      .mockResolvedValueOnce(v3IntegrationPending());

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [launchV2(), launch()],
      nextCursor: null,
    });
  });

  it("forwards one exact V3 funding signature without echoing it", async () => {
    const signature = `0x${"11".repeat(64)}1b`;
    const resource = {
      ...launchV3(),
      status: "funding_authorization_verified",
      output: {
        schemaVersion: "programmable.custom-launch-authorization-result.v3",
        integrationState: "ready",
        stage: "funding-signature-verified",
        actionRequired: null,
      },
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 202,
      headers: { "content-type": "application/json" },
    }));
    const submission = {
      schemaVersion: "programmable.custom-launch-funding-authorization-signature.v1",
      fundingIntentHash: launchV3().fundingIntentHash,
      typedDataDigest: `0x${"99".repeat(32)}`,
      signature,
    };
    const response = await bridge().submitFundingAuthorization(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}/funding-authorization?walletAddress=${WALLET}&version=v3`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer browser-privy-token",
          "content-type": "application/json",
          "idempotency-key": "60000000-0000-4000-8000-000000000006",
        },
        body: JSON.stringify(submission),
      },
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual(resource);
    expect(JSON.stringify(body)).not.toContain(signature);
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      `https://custom-launch-api.example/v3/wallet-admin/custom-launches/${V3_LAUNCH_ID}/funding-authorization`,
    );
    expect(new Headers(init.headers).get("idempotency-key")).toBe(
      "60000000-0000-4000-8000-000000000006",
    );
    expect(JSON.parse(String(init.body))).toEqual(submission);
  });

  it("rejects a funding signature without exact V3 binding before backend access", async () => {
    const response = await bridge().submitFundingAuthorization(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}/funding-authorization?walletAddress=${WALLET}&version=v3`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "programmable.custom-launch-funding-authorization-signature.v1",
          fundingIntentHash: launchV3().fundingIntentHash,
          typedDataDigest: `0x${"99".repeat(32)}`,
          signature: `0x${"11".repeat(64)}1b`,
        }),
      },
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("idempotency_key_invalid");
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("keeps each backend cursor in its own route lane", async () => {
    const v1Cursor = cursor();
    const v2Cursor = cursor(V2_LAUNCH_ID, "2026-08-24T12:01:00.000Z");
    fetchBackend
      .mockResolvedValueOnce(backendJson({
        launches: [launch()],
        nextCursor: v1Cursor,
      }))
      .mockResolvedValueOnce(backendJsonV2({
        launches: [launchV2()],
        nextCursor: v2Cursor,
      }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    const first = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));
    const firstBody = await first.json();
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    ));

    expect(second.status).toBe(200);
    expect((fetchBackend.mock.calls[3]![0] as URL).searchParams.get("cursor"))
      .toBe(v1Cursor);
    expect((fetchBackend.mock.calls[4]![0] as URL).searchParams.get("cursor"))
      .toBe(v2Cursor);
    expect(await second.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [],
      nextCursor: null,
    });
  });

  it("reads an exact V2 resource only from the V2 wallet-admin route", async () => {
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(launchV2()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V2_LAUNCH_ID}?walletAddress=${WALLET}&version=v2`,
    ), V2_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(launchV2());
    expect((fetchBackend.mock.calls[0]![0] as URL).toString()).toBe(
      `https://custom-launch-api.example/v2/wallet-admin/custom-launches/${V2_LAUNCH_ID}`,
    );
  });

  it("streams a large exact V2 handoff separately from compact history pages", async () => {
    const repeatedGraphBytes = `0x${"ab".repeat(80_000)}`;
    const resource = {
      ...launchV2(),
      status: "authorized",
      output: {
        artifact: {
          route: { routePayload: repeatedGraphBytes },
          unsignedRouterTransaction: {
            calldataWithEmptySignature: repeatedGraphBytes,
          },
        },
        walletTransaction: { calldata: repeatedGraphBytes },
        simulation: { outcome: "passed" },
      },
    };
    const serialized = JSON.stringify(resource);
    expect(Buffer.byteLength(serialized, "utf8")).toBeGreaterThan(131_072);
    fetchBackend.mockResolvedValueOnce(new Response(serialized, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V2_LAUNCH_ID}?walletAddress=${WALLET}&version=v2`,
    ), V2_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(resource);
  });

  it("stops streaming an oversized single-resource response", async () => {
    const resource = {
      ...launchV2(),
      status: "authorized",
      output: { oversized: "a".repeat(1_050_000) },
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V2_LAUNCH_ID}?walletAddress=${WALLET}&version=v2`,
    ), V2_LAUNCH_ID);

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "launch_history_unavailable",
    );
  });

  it("preserves the bounded V2 unavailable response and Retry-After", async () => {
    const requestId = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: "programmable.custom-launch-list.v2",
        error: {
          code: "CUSTOM_LAUNCH_V2_UNAVAILABLE",
          message: "V2 launch history is temporarily unavailable.",
          requestId,
        },
      }), {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": "17",
          "x-request-id": requestId,
        },
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}`,
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      error: {
        code: "CUSTOM_LAUNCH_V2_UNAVAILABLE",
        message: "V2 launch history is temporarily unavailable.",
        requestId,
      },
    });
  });
});
