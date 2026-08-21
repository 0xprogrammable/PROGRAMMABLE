import { describe, expect, it } from "vitest";

vi.mock("server-only", () => ({}));

import { vi } from "vitest";
import {
  createCreatorArticleAuthorityReaderV1,
  listCreatorArticleAuthoritiesV1,
  requireCreatorArticleAuthorityV1,
} from "../lib/server/creator-article/authority.server";
import {
  createWalletPrincipalAuthenticatorFromBoundaryV1,
} from "../lib/server/creator-article/wallet-principal.server";
import type { ExploreEntry } from "../lib/tokens";

const CREATOR = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const CUSTOM = "0x4444444444444444444444444444444444444444" as const;

function request() {
  return new Request("https://programmable.market/api/profile/projects", {
    headers: {
      authorization: `Bearer ${"a".repeat(32)}`,
      "x-privy-identity-token": `${btoa("header")}.${Buffer.from(JSON.stringify({ sub: "did:privy:user", sid: "session" })).toString("base64url")}.signature`,
    },
  });
}

function classic(): ExploreEntry {
  return {
    exploreKind: "token",
    id: `1:${TOKEN.toLowerCase()}`,
    name: "Classic",
    symbol: "CLASSIC",
    tokenAddress: TOKEN,
    hookAddress: OTHER,
    poolId: `0x${"55".repeat(32)}`,
    creatorAddress: CREATOR,
    launchedAt: "2026-08-21T00:00:00.000Z",
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    liquidityPath: "meme",
    totalSwapFeeBps: 100,
    launchCategoryProvenance: {} as never,
  };
}

function custom(): ExploreEntry {
  return {
    exploreKind: "custom-project",
    id: "custom:test",
    name: "Custom",
    symbol: "CUSTOM",
    links: [],
    launchedAt: "2026-08-21T00:00:00.000Z",
    finalizedAt: "2026-08-21T00:00:00.000Z",
    chainId: "1",
    modelId: "custom",
    customProjectId: `sha256:${"66".repeat(32)}`,
    customLaunchId: `sha256:${"77".repeat(32)}`,
    launchingWallet: { namespace: "eip155:1", value: CREATOR },
    postLaunchAuthorityInventory: {} as never,
    postLaunchAuthorityInventoryHash: `sha256:${"88".repeat(32)}`,
    markets: [],
    tokenAddress: CUSTOM,
    launchCategoryProvenance: {} as never,
  };
}

describe("creator article wallet principal", () => {
  it("binds both Privy tokens and returns unique Ethereum wallets", async () => {
    const authenticator = createWalletPrincipalAuthenticatorFromBoundaryV1({
      appId: "app",
      boundary: {
        verifyAccessToken: vi.fn().mockResolvedValue({
          appId: "app", userId: "did:privy:user", sessionId: "session",
        }),
        verifyIdentityToken: vi.fn().mockResolvedValue({
          userId: "did:privy:user", sessionId: "session",
        }),
        getCurrentUser: vi.fn().mockResolvedValue({
          id: "did:privy:user",
          linkedAccounts: [
            { type: "wallet", chainType: "ethereum", address: CREATOR.toLowerCase() },
            { type: "wallet", chainType: "ethereum", address: CREATOR },
            { type: "wallet", chainType: "solana", address: CREATOR },
          ],
        }),
      },
    });
    const principal = await authenticator.authenticate(request());
    expect(principal.wallets).toEqual([CREATOR]);
  });

  it("accepts a verified access session when Privy omits the identity token", async () => {
    const verifyIdentityToken = vi.fn();
    const authenticator = createWalletPrincipalAuthenticatorFromBoundaryV1({
      appId: "app",
      boundary: {
        verifyAccessToken: vi.fn().mockResolvedValue({
          appId: "app", userId: "did:privy:user", sessionId: "session",
        }),
        verifyIdentityToken,
        getCurrentUser: vi.fn().mockResolvedValue({
          id: "did:privy:user",
          linkedAccounts: [
            { type: "wallet", chainType: "ethereum", address: CREATOR },
          ],
        }),
      },
    });
    const accessOnlyRequest = new Request(
      "https://programmable.market/api/profile/projects",
      { headers: { authorization: `Bearer ${"a".repeat(32)}` } },
    );

    await expect(authenticator.authenticate(accessOnlyRequest)).resolves.toEqual({
      privyUserId: "did:privy:user",
      privySessionId: "session",
      wallets: [CREATOR],
    });
    expect(verifyIdentityToken).not.toHaveBeenCalled();
  });

  it("rejects mismatched sessions and missing Ethereum wallets", async () => {
    const base = {
      verifyAccessToken: vi.fn().mockResolvedValue({ appId: "app", userId: "u", sessionId: "s1" }),
      verifyIdentityToken: vi.fn().mockResolvedValue({ userId: "u", sessionId: "s2" }),
      getCurrentUser: vi.fn().mockResolvedValue({ id: "u", linkedAccounts: [] }),
    };
    await expect(createWalletPrincipalAuthenticatorFromBoundaryV1({
      appId: "app", boundary: base,
    }).authenticate(request())).rejects.toMatchObject({ status: 401 });

    base.verifyIdentityToken.mockResolvedValue({ userId: "u", sessionId: "s1" });
    await expect(createWalletPrincipalAuthenticatorFromBoundaryV1({
      appId: "app", boundary: base,
    }).authenticate(request())).rejects.toMatchObject({ status: 403 });
  });
});

describe("creator article launch authority", () => {
  const principal = {
    privyUserId: "u",
    privySessionId: "s",
    wallets: [CREATOR],
  } as const;

  it("allows Classic V3 and Registry-verified Custom for their exact creator", async () => {
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockResolvedValue([classic()]),
      readCustom: vi.fn().mockResolvedValue([custom()]),
    });
    expect((await listCreatorArticleAuthoritiesV1({
      reader, principal, signal: new AbortController().signal,
    })).map(({ tokenAddress }) => tokenAddress)).toEqual([TOKEN, CUSTOM]);
    await expect(requireCreatorArticleAuthorityV1({
      reader, principal, tokenAddress: CUSTOM, signal: new AbortController().signal,
    })).resolves.toMatchObject({ source: "registry.custom-launched" });
  });

  it("keeps Custom fail-closed and rejects a different wallet", async () => {
    const reader = createCreatorArticleAuthorityReaderV1({
      readClassic: vi.fn().mockResolvedValue([classic()]),
      readCustom: vi.fn().mockRejectedValue(new Error("Registry unavailable")),
    });
    await expect(requireCreatorArticleAuthorityV1({
      reader, principal, tokenAddress: CUSTOM, signal: new AbortController().signal,
    })).rejects.toMatchObject({ status: 404 });
    await expect(requireCreatorArticleAuthorityV1({
      reader,
      principal: { ...principal, wallets: [OTHER] },
      tokenAddress: TOKEN,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ status: 403 });
  });
});
