import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CLASSIC_LAUNCH_AUTHORIZATION_REQUEST_SCHEMA_V1,
  CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1,
  ClassicLaunchAuthorizationBridgeErrorV1,
  createClassicLaunchAuthorizationBridgeV1,
} from "../lib/server/custom-launch/classic-launch-authorization-bridge-v1";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as const;
const LAUNCHER = "0x3333333333333333333333333333333333333333" as const;
const HOOK = "0x4444444444444444444444444444444444444444" as const;
const TOKEN = "0x5555555555555555555555555555555555555555" as const;
const ROUTER = "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56" as const;
const WEBSITE_TOKEN = "w".repeat(43);
const BFF_ASSERTION_KEY = "b".repeat(43);
const RELEASE_DIGEST = `0x${"11".repeat(32)}` as const;
const LAUNCHER_HASH = `0x${"22".repeat(32)}` as const;
const HOOK_HASH = `0x${"33".repeat(32)}` as const;
const BLOCK_HASH = `0x${"44".repeat(32)}` as const;
const PERMIT_DIGEST = `0x${"55".repeat(32)}` as const;
const STAMP_HASH = `0x${"66".repeat(32)}` as const;
const VALUE_WEI = "600000000000000";

function requestInput(launchWallet: `0x${string}` = WALLET) {
  return {
    schemaVersion: CLASSIC_LAUNCH_AUTHORIZATION_REQUEST_SCHEMA_V1,
    chainId: "1" as const,
    launchWallet,
    releaseManifestDigest: RELEASE_DIGEST,
    launcher: LAUNCHER,
    launcherRuntimeCodeHash: LAUNCHER_HASH,
    feeHook: HOOK,
    feeHookRuntimeCodeHash: HOOK_HASH,
    valueWei: VALUE_WEI,
    launcherCalldata: "0x12345678" as const,
  };
}

function authorization() {
  return {
    schemaVersion: CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1,
    chainId: "1",
    releaseManifestDigest: RELEASE_DIGEST,
    predictedToken: TOKEN,
    predictedHook: HOOK,
    permitDigest: PERMIT_DIGEST,
    validAfter: "1999999970",
    deadline: "2000000300",
    simulation: {
      blockNumber: "22000000",
      blockHash: BLOCK_HASH,
      blockTimestamp: "2000000000",
      gasEstimate: "1900000",
      stampHash: STAMP_HASH,
    },
    transaction: {
      chainId: "1",
      from: WALLET,
      to: ROUTER,
      valueWei: VALUE_WEI,
      calldata: "0xabcdef01",
      gasLimit: "2200000",
    },
  };
}

describe("Classic launch same-origin authorization bridge", () => {
  const authenticate = vi.fn();
  const fetchBackend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockResolvedValue({
      privyUserId: "did:privy:test-user",
      privySessionId: "session-1",
      wallets: [WALLET],
    });
    fetchBackend.mockResolvedValue(new Response(
      JSON.stringify(authorization()),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
  });

  function bridge() {
    return createClassicLaunchAuthorizationBridgeV1({
      authenticator: { authenticate },
      backendBaseUrl: "https://custom-launch-api.example/",
      websiteToken: WEBSITE_TOKEN,
      bffAssertionKeyV2: BFF_ASSERTION_KEY,
      fetchBackend,
      backendTimeoutMs: 1_000,
      assertionNow: () => new Date("2026-08-27T08:00:00.000Z"),
      assertionNonce: () => Buffer.alloc(16, 1).toString("base64url"),
    });
  }

  it("returns only an exact wallet-bound Router transaction", async () => {
    const input = requestInput();
    await expect(bridge().authorize(
      new Request("https://programmable.market/api/launch/preflight", {
        headers: { authorization: "Bearer browser-privy-token" },
      }),
      input,
    )).resolves.toEqual(authorization());

    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://custom-launch-api.example/v1/wallet-admin/classic-launches/authorization",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(input);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${WEBSITE_TOKEN}`);
    expect(headers.get("x-programmable-privy-user-id")).toBe(
      "did:privy:test-user",
    );
    expect(headers.get("x-programmable-wallet-address")).toBe(WALLET);
    expect(headers.get("x-programmable-bff-assertion-version")).toBe("2");
  });

  it("rejects a launch wallet that is not linked to the Privy user", async () => {
    await expect(bridge().authorize(
      new Request("https://programmable.market/api/launch/preflight"),
      requestInput(OTHER_WALLET),
    )).rejects.toMatchObject({
      status: 403,
      code: "wallet_not_linked",
    });
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("preserves only the safe Classic authorization outage code", async () => {
    fetchBackend.mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: "programmable.api-error.v1",
      error: {
        code: "CLASSIC_LAUNCH_AUTHORIZATION_UNAVAILABLE",
        message: "Classic launch authorization is unavailable.",
        requestId: "request-1",
      },
    }), {
      status: 503,
      headers: {
        "content-type": "application/json",
        "retry-after": "10",
        "x-request-id": "request-1",
      },
    }));

    await expect(bridge().authorize(
      new Request("https://programmable.market/api/launch/preflight"),
      requestInput(),
    )).rejects.toEqual(expect.objectContaining<
      Partial<ClassicLaunchAuthorizationBridgeErrorV1>
    >({
      status: 503,
      code: "CLASSIC_LAUNCH_AUTHORIZATION_UNAVAILABLE",
      requestId: "request-1",
      retryAfter: "10",
    }));
  });
});
