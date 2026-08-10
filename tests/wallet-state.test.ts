import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { getCreateAddress, keccak256 } from "viem";
import * as walletProvider from "../components/wallet-provider";
import {
  HOOKEMON_APPROVE_SELECTOR,
  HOOKEMON_MAINNET_USDC,
  parseHookemonBrowserWalletActionV1,
  type HookemonApplicantFlowBindingV1,
  type HookemonBrowserWalletActionV1,
} from "../lib/custom-launch/hookemon-applicant-contract-v1";

type WalletProviderContract = {
  assertHookemonPendingNonceV1: (
    observed: unknown,
    expected: `0x${string}`,
  ) => void;
  buildHookemonEip1193TransactionV1: (
    action: HookemonBrowserWalletActionV1,
    binding: HookemonApplicantFlowBindingV1,
    connectedAccount: `0x${string}`,
    currentEpochSeconds: string,
  ) => Readonly<{
    from: `0x${string}`;
    to?: `0x${string}`;
    nonce: `0x${string}`;
    gas: `0x${string}`;
    data: `0x${string}`;
    value: "0x0";
  }>;
  assertExternalWalletAuthorityCurrent: (input: Readonly<{
    expectedAccount: `0x${string}`;
    expectedChainId: string;
    networkName: string;
    request: (method: "eth_chainId" | "eth_accounts") => Promise<unknown>;
  }>) => Promise<void>;
  getWalletSessionAction: (
    ready: boolean,
    authenticated: boolean,
  ) => "wait" | "login" | "manage";
  isWalletProviderSettled: (
    privyReady: boolean,
    walletsReady: boolean,
    authenticated: boolean,
  ) => boolean;
  resolveWalletIdentityToken: (input: Readonly<{
    authenticated: boolean;
    cachedIdentityToken: string | null;
    loadIdentityToken: () => Promise<string | null>;
  }>) => Promise<string | null>;
  selectAuthenticatedWallet: <T extends {
    address: string;
    connectedAt: number;
    linked: boolean;
    walletClientType: string;
  }>(
    authenticated: boolean,
    wallets: readonly T[],
    primaryAddress?: string,
  ) => T | undefined;
  getWalletProfileStorageKey: (account: string) => string;
  readUsernameFromProfileValue: (value: string | null) => string;
  getWalletLoginErrorMessage: (errorCode: string) => string;
  getWalletTransactionErrorMessage: (error: unknown) => string;
  getWalletDisconnectOutcome: (succeeded: boolean) => {
    dialogOpen: boolean;
    error: string;
    sessionSuppressed: boolean;
  };
  executeWalletDisconnect: (input: {
    authenticated: boolean;
    logout: () => Promise<unknown>;
    disconnectProviderWallets: () => Promise<boolean>;
    markAppDisconnected: () => void;
  }) => Promise<boolean>;
  selectConnectedWallet: <T extends {
    address: string;
    connectedAt: number;
    linked: boolean;
    walletClientType: string;
  }>(
    wallets: readonly T[],
    primaryAddress?: string,
  ) => T | undefined;
};

const subject = walletProvider as unknown as WalletProviderContract;

const APPLICANT_PRIVY_USER_ID = "did:privy:approved";
const APPLICANT_GITHUB_USER_ID = "155705664";
const APPLICANT_GITHUB_LOGIN = "jesse-stahl";
const APPLICANT_WALLET =
  "0xceebb3a6543cebeb2ed66963897a0abea52a50cc" as const;
const OTHER_WALLET = `0x${"b".repeat(40)}` as const;
const applicantRequirement = Object.freeze({
  githubUserId: APPLICANT_GITHUB_USER_ID,
  githubLogin: APPLICANT_GITHUB_LOGIN,
  launchWallet: APPLICANT_WALLET,
});

type ApplicantLinkedAccountFixture = {
  type: string;
  subject?: string;
  username?: string | null;
  address?: string;
  chainType?: string;
};

function applicantAuthority(overrides?: Partial<{
  privyUserId: string | null;
  githubUserId: string | null;
  githubLogin: string | null;
  walletAddress: string | null;
}>) {
  return {
    privyUserId: APPLICANT_PRIVY_USER_ID,
    githubUserId: APPLICANT_GITHUB_USER_ID,
    githubLogin: APPLICANT_GITHUB_LOGIN,
    walletAddress: APPLICANT_WALLET,
    ...overrides,
  };
}

function applicantUser(overrides?: Partial<{
  id: string;
  githubUserId: string;
  githubLogin: string;
  wallet: `0x${string}`;
}>) {
  const id = overrides?.id ?? APPLICANT_PRIVY_USER_ID;
  const githubUserId = overrides?.githubUserId ?? APPLICANT_GITHUB_USER_ID;
  const githubLogin = overrides?.githubLogin ?? APPLICANT_GITHUB_LOGIN;
  const wallet = overrides?.wallet ?? APPLICANT_WALLET;
  const linkedAccounts: ApplicantLinkedAccountFixture[] = [
    {
      type: "github_oauth",
      subject: githubUserId,
      username: githubLogin,
    },
    {
      type: "wallet",
      chainType: "ethereum",
      address: wallet,
    },
  ];
  return {
    id,
    github: {
      subject: githubUserId,
      username: githubLogin,
    },
    linkedAccounts,
  };
}

describe("wallet recovery state", () => {
  it("holds approval and CREATE until exact identifier authority is frozen", () => {
    for (const actionIndex of [0, 1] as const) {
      const action = validatedHookemonAction(actionIndex);
      expect(() => subject.buildHookemonEip1193TransactionV1(
        action,
        hookemonBinding,
        hookemonBinding.launchWallet,
        "1000",
      )).toThrow(/identifier authority is unavailable/u);
    }
  });

  it("does not promote structurally valid gas, identifiers or currentness to send authority", () => {
    const candidates = [
      forgeRawHookemonAction(0, {
        transaction: { gas: "0x10001" },
      }),
      forgeRawHookemonAction(0, {
        actionHash: hookemonSha(0xd1),
      }),
      forgeRawHookemonAction(0, {
        selectorHash: hookemonSha(0xd2),
      }),
      forgeRawHookemonAction(0, {
        currentness: {
          observedBlockNumber: "2",
          observedBlockHash: hookemonBytes32(0xd3),
          evidenceHash: hookemonSha(0xd4),
        },
      }),
    ];
    for (const candidate of candidates) {
      const parsed = parseHookemonBrowserWalletActionV1(
        candidate,
        hookemonBinding,
        "1000",
      );
      expect(() => subject.buildHookemonEip1193TransactionV1(
        parsed,
        hookemonBinding,
        hookemonBinding.launchWallet,
        "1000",
      )).toThrow(/identifier authority is unavailable/u);
    }
  });

  it("keeps unvalidated actions, adoption and pending-nonce drift disabled", () => {
    expect(() => subject.buildHookemonEip1193TransactionV1(
      rawHookemonAction(2),
      hookemonBinding,
      hookemonBinding.launchWallet,
      "1000",
    )).toThrow(/not runtime-validated/u);
    expect(() => subject.buildHookemonEip1193TransactionV1(
      validatedHookemonAction(0),
      hookemonBinding,
      `0x${"9".repeat(40)}`,
      "1000",
    )).toThrow(/not executable/u);
    expect(() => subject.assertHookemonPendingNonceV1("0x8", "0x8"))
      .not.toThrow();
    expect(() => subject.assertHookemonPendingNonceV1("0x9", "0x8"))
      .toThrow(/nonce changed/u);
    expect(() => subject.assertHookemonPendingNonceV1("0x08", "0x8"))
      .toThrow(/nonce changed/u);
  });

  it("rejects Hookemon action-kind and currentness substitutions", () => {
    expect(() => subject.buildHookemonEip1193TransactionV1({
      ...validatedHookemonAction(0),
      actionKind: "EOA_CREATE",
    }, hookemonBinding, hookemonBinding.launchWallet, "1000"))
      .toThrow(/not runtime-validated/u);
    expect(() => subject.buildHookemonEip1193TransactionV1({
      ...validatedHookemonAction(1),
      currentness: {
        ...validatedHookemonAction(1).currentness,
        kind: "PRE_APPROVAL",
      },
    }, hookemonBinding, hookemonBinding.launchWallet, "1000"))
      .toThrow(/not runtime-validated/u);
  });

  it("fuzzes tx/currentness drift, relabeling and expiry before send", () => {
    const approval = validatedHookemonAction(0);
    const create = validatedHookemonAction(1);
    const transactionMutations = [
      { method: "eth_signTransaction" },
      { chainId: "0xaa36a7" },
      { from: `0x${"9".repeat(40)}` },
      { to: `0x${"9".repeat(40)}` },
      { data: "0x6001" },
      { data: approval.transaction.data, value: "0x1" },
      { gas: "0x10001" },
      { nonce: "0x8" },
    ] as const;
    for (const mutation of transactionMutations) {
      expect(() => subject.buildHookemonEip1193TransactionV1(
        forgeHookemonAction(approval, { transaction: mutation }),
        hookemonBinding,
        hookemonBinding.launchWallet,
        "1000",
      )).toThrow(/not runtime-validated/u);
    }
    const currentnessMutations = [
      { kind: "PRE_APPROVAL" },
      { observedBlockNumber: "2" },
      { observedBlockHash: hookemonBytes32(0xe1) },
      { observedPendingNonce: "0x9" },
      { evidenceHash: hookemonSha(0xe2) },
      { previousFinalityEvidenceHash: hookemonSha(0xe3) },
      { completedGraphHash: hookemonBytes32(0xe4) },
      { currentPoolStateHash: hookemonBytes32(0xe5) },
      { runtimeStatusHash: hookemonSha(0xe6) },
    ] as const;
    for (const mutation of currentnessMutations) {
      expect(() => subject.buildHookemonEip1193TransactionV1(
        forgeHookemonAction(create, { currentness: mutation }),
        hookemonBinding,
        hookemonBinding.launchWallet,
        "1000",
      )).toThrow(/not runtime-validated/u);
    }
    const relabeledActions = [
      { ...approval, actionIndex: 1 as const },
      { ...approval, actionKind: "EOA_CREATE" as const },
      { ...approval, selectorHash: hookemonSha(0xe7) },
      { ...approval, actionHash: hookemonSha(0xe8) },
      { ...approval, bindingHash: hookemonSha(0xe9) },
      { ...approval, dataHash: hookemonBytes32(0xea) },
    ] as const;
    for (const relabeled of relabeledActions) {
      expect(() => subject.buildHookemonEip1193TransactionV1(
        relabeled,
        hookemonBinding,
        hookemonBinding.launchWallet,
        "1000",
      )).toThrow(/not runtime-validated/u);
    }
    expect(() => subject.buildHookemonEip1193TransactionV1(
      approval,
      hookemonBinding,
      hookemonBinding.launchWallet,
      "1200",
    )).toThrow(/not current/u);
    expect(() => subject.buildHookemonEip1193TransactionV1(
      approval,
      hookemonBinding,
      hookemonBinding.launchWallet,
      "899",
    )).toThrow(/not current/u);
  });

  it("refreshes an authenticated Privy identity token when hook hydration is still null", async () => {
    const loadIdentityToken = vi.fn(async () => "fresh-identity-token");

    await expect(subject.resolveWalletIdentityToken({
      authenticated: true,
      cachedIdentityToken: null,
      loadIdentityToken,
    })).resolves.toBe("fresh-identity-token");
    expect(loadIdentityToken).toHaveBeenCalledTimes(1);
  });

  it("does not retrieve an identity token for an unauthenticated session", async () => {
    const loadIdentityToken = vi.fn(async () => "unexpected-token");

    await expect(subject.resolveWalletIdentityToken({
      authenticated: false,
      cachedIdentityToken: null,
      loadIdentityToken,
    })).resolves.toBeNull();
    expect(loadIdentityToken).not.toHaveBeenCalled();
  });

  it("keeps identity-token retrieval failures fail closed", async () => {
    await expect(subject.resolveWalletIdentityToken({
      authenticated: true,
      cachedIdentityToken: null,
      loadIdentityToken: async () => null,
    })).resolves.toBeNull();
    await expect(subject.resolveWalletIdentityToken({
      authenticated: true,
      cachedIdentityToken: null,
      loadIdentityToken: async () => {
        throw new Error("Privy unavailable");
      },
    })).resolves.toBeNull();
  });

  it("uses the Privy hook token without reading browser storage or refreshing", async () => {
    const loadIdentityToken = vi.fn(async () => "unexpected-token");

    await expect(subject.resolveWalletIdentityToken({
      authenticated: true,
      cachedIdentityToken: "hook-identity-token",
      loadIdentityToken,
    })).resolves.toBe("hook-identity-token");
    expect(loadIdentityToken).not.toHaveBeenCalled();
  });

  it("pins Privy 3.35.2 refreshUser to updateUserAndIdToken before Applicant tokens", () => {
    const packageRoot = join(
      process.cwd(),
      "node_modules/@privy-io/react-auth",
    );
    const packageJson = JSON.parse(readFileSync(
      join(packageRoot, "package.json"),
      "utf8",
    )) as { version?: unknown };
    const dts = readFileSync(join(packageRoot, "dist/dts/index.d.ts"), "utf8");
    const cjsIndex = readFileSync(join(packageRoot, "dist/cjs/index.js"), "utf8");
    const implementationFile = cjsIndex.match(/require\("\.\/(index-[^"]+\.js)"\)/u)?.[1];
    expect(packageJson.version).toBe("3.35.2");
    expect(dts).toContain("refreshUser: () => Promise<User>");
    expect(implementationFile).toBeTypeOf("string");
    const implementation = readFileSync(
      join(packageRoot, "dist/cjs", implementationFile!),
      "utf8",
    );
    expect(implementation).toContain("updateUserAndIdToken");
    const provider = readFileSync(
      join(process.cwd(), "components/wallet-provider.tsx"),
      "utf8",
    );
    expect(provider).toContain("const { refreshUser } = useUser();");
    expect(provider).toContain("getIdentityToken: getPrivyIdentityToken");
  });

  it("does not refresh or acquire tokens before authentication is current", async () => {
    const refreshUser = vi.fn(async () => applicantUser());
    const getAccessToken = vi.fn(async () => "unexpected-access");
    const getIdentityToken = vi.fn(async () => "unexpected-identity");
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: false,
      readCurrentAuthority: applicantAuthority,
      refreshUser,
      getAccessToken,
      getIdentityToken,
      requirement: applicantRequirement,
    })).resolves.toBeNull();
    expect(refreshUser).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();
  });

  it("refreshes user before tokens and binds the exact GitHub identity and linked wallet", async () => {
    const events: string[] = [];
    const authority = applicantAuthority();
    const session = await walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: () => authority,
      refreshUser: async () => {
        events.push("refresh-user");
        return applicantUser();
      },
      getAccessToken: async () => {
        events.push("access-token");
        return "access-token";
      },
      getIdentityToken: async () => {
        events.push("identity-token");
        return "identity-token";
      },
      requirement: applicantRequirement,
    });

    expect(events).toEqual([
      "refresh-user",
      "access-token",
      "identity-token",
    ]);
    expect(session).toEqual({
      accessToken: "access-token",
      identityToken: "identity-token",
      privyUserId: APPLICANT_PRIVY_USER_ID,
      githubUserId: APPLICANT_GITHUB_USER_ID,
      githubLogin: APPLICANT_GITHUB_LOGIN,
      launchWallet: APPLICANT_WALLET,
    });
  });

  it("rejects missing refresh results and refresh failures before token acquisition", async () => {
    for (const refreshUser of [
      async () => undefined,
      async () => null,
      async () => { throw new Error("refresh failed"); },
    ]) {
      const getAccessToken = vi.fn(async () => "unexpected-access");
      const getIdentityToken = vi.fn(async () => "unexpected-identity");
      await expect(walletProvider.refreshWalletApplicantSessionV1({
        authenticated: true,
        readCurrentAuthority: applicantAuthority,
        refreshUser,
        getAccessToken,
        getIdentityToken,
        requirement: applicantRequirement,
      })).resolves.toBeNull();
      expect(getAccessToken).not.toHaveBeenCalled();
      expect(getIdentityToken).not.toHaveBeenCalled();
    }
  });

  it("rejects wrong or missing identity and wallet data before token acquisition", async () => {
    const candidates = [
      { id: APPLICANT_PRIVY_USER_ID, linkedAccounts: [] },
      applicantUser({ id: "did:privy:other" }),
      applicantUser({ githubUserId: "1" }),
      applicantUser({ githubLogin: "other-user" }),
      applicantUser({ wallet: OTHER_WALLET }),
    ];
    for (const refreshedUser of candidates) {
      const getAccessToken = vi.fn(async () => "unexpected-access");
      const getIdentityToken = vi.fn(async () => "unexpected-identity");
      await expect(walletProvider.refreshWalletApplicantSessionV1({
        authenticated: true,
        readCurrentAuthority: applicantAuthority,
        refreshUser: async () => refreshedUser,
        getAccessToken,
        getIdentityToken,
        requirement: applicantRequirement,
      })).resolves.toBeNull();
      expect(getAccessToken).not.toHaveBeenCalled();
      expect(getIdentityToken).not.toHaveBeenCalled();
    }
  });

  it("rejects a same-DID GitHub switch even without an exact lane requirement", async () => {
    const getAccessToken = vi.fn(async () => "unexpected-access");
    const getIdentityToken = vi.fn(async () => "unexpected-identity");
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: applicantAuthority,
      refreshUser: async () => applicantUser({
        githubUserId: "999",
        githubLogin: "other-user",
      }),
      getAccessToken,
      getIdentityToken,
    })).resolves.toBeNull();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();
  });

  it("rejects ambiguous GitHub linkage and account reload drift before any request", async () => {
    const ambiguous = applicantUser();
    ambiguous.linkedAccounts.push({
      type: "github_oauth",
      subject: "999",
      username: "other-user",
    });
    const getAccessToken = vi.fn(async () => "unexpected-access");
    const getIdentityToken = vi.fn(async () => "unexpected-identity");
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: applicantAuthority,
      refreshUser: async () => ambiguous,
      getAccessToken,
      getIdentityToken,
      requirement: applicantRequirement,
    })).resolves.toBeNull();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();

    let readCount = 0;
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: () => {
        readCount += 1;
        return readCount === 1
          ? applicantAuthority()
          : applicantAuthority({ walletAddress: OTHER_WALLET });
      },
      refreshUser: async () => applicantUser(),
      getAccessToken,
      getIdentityToken,
      requirement: applicantRequirement,
    })).resolves.toBeNull();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();
  });

  it("acquires each token once after refresh and rejects either null without retry", async () => {
    for (const tokens of [
      { access: null, identity: "identity-token" },
      { access: "access-token", identity: null },
    ] as const) {
      const getAccessToken = vi.fn(async () => tokens.access);
      const getIdentityToken = vi.fn(async () => tokens.identity);
      await expect(walletProvider.refreshWalletApplicantSessionV1({
        authenticated: true,
        readCurrentAuthority: applicantAuthority,
        refreshUser: async () => applicantUser(),
        getAccessToken,
        getIdentityToken,
        requirement: applicantRequirement,
      })).resolves.toBeNull();
      expect(getAccessToken).toHaveBeenCalledTimes(1);
      expect(getIdentityToken).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects account drift detected only after token acquisition", async () => {
    let readCount = 0;
    const getAccessToken = vi.fn(async () => "access-token");
    const getIdentityToken = vi.fn(async () => "identity-token");
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: () => {
        readCount += 1;
        return readCount < 3
          ? applicantAuthority()
          : applicantAuthority({ githubLogin: "other-user" });
      },
      refreshUser: async () => applicantUser(),
      getAccessToken,
      getIdentityToken,
      requirement: applicantRequirement,
    })).resolves.toBeNull();
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(getIdentityToken).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an external provider mutates chain before a wallet action", async () => {
    const request = vi.fn(async (method: "eth_chainId" | "eth_accounts") =>
      method === "eth_chainId"
        ? "0xaa36a7"
        : [`0x${"a".repeat(40)}`]
    );

    await expect(subject.assertExternalWalletAuthorityCurrent({
      expectedAccount: `0x${"a".repeat(40)}`,
      expectedChainId: "0x1",
      networkName: "Ethereum",
      request,
    })).rejects.toThrow("not connected to Ethereum");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("eth_chainId");
  });

  it("fails closed when an external provider mutates account before a wallet action", async () => {
    const request = vi.fn(async (method: "eth_chainId" | "eth_accounts") =>
      method === "eth_chainId"
        ? "0x1"
        : [`0x${"b".repeat(40)}`]
    );

    await expect(subject.assertExternalWalletAuthorityCurrent({
      expectedAccount: `0x${"a".repeat(40)}`,
      expectedChainId: "0x1",
      networkName: "Ethereum",
      request,
    })).rejects.toThrow("active wallet account changed");
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      "eth_chainId",
      "eth_accounts",
    ]);
  });

  it("does not treat a detected browser wallet as an authenticated app session", () => {
    expect(subject.getWalletSessionAction).toBeTypeOf("function");
    expect(subject.getWalletSessionAction(true, false)).toBe("login");
  });

  it("opens login only when Privy is ready and no recoverable session exists", () => {
    expect(subject.getWalletSessionAction).toBeTypeOf("function");
    expect(subject.getWalletSessionAction(false, false)).toBe("wait");
    expect(subject.getWalletSessionAction(true, false)).toBe("login");
    expect(subject.getWalletSessionAction(true, true)).toBe("manage");
  });

  it("does not block login while the unauthenticated wallet list is still loading", () => {
    expect(subject.isWalletProviderSettled).toBeTypeOf("function");
    expect(subject.isWalletProviderSettled(true, false, false)).toBe(true);
    expect(subject.getWalletSessionAction(true, false)).toBe("login");
    expect(subject.isWalletProviderSettled(true, false, true)).toBe(false);
  });

  it("uses the lowercase wallet-scoped profile key", () => {
    expect(subject.getWalletProfileStorageKey).toBeTypeOf("function");
    expect(
      subject.getWalletProfileStorageKey(
        "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      ),
    ).toBe(
      "programmable-profile:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );
  });

  it("accepts only a valid username from the stored profile", () => {
    expect(subject.readUsernameFromProfileValue).toBeTypeOf("function");
    expect(
      subject.readUsernameFromProfileValue(
        JSON.stringify({ username: "Bloom36", bio: "preserved" }),
      ),
    ).toBe("Bloom36");
    expect(
      subject.readUsernameFromProfileValue(
        JSON.stringify({ username: "not valid" }),
      ),
    ).toBe("");
    expect(subject.readUsernameFromProfileValue("{broken")).toBe("");
  });

  it("turns Privy failures into a clean retry message without treating cancellation as an error", () => {
    expect(subject.getWalletLoginErrorMessage).toBeTypeOf("function");
    expect(
      subject.getWalletLoginErrorMessage("generic_connect_wallet_error"),
    ).toBe("Unable to connect wallet. Try again.");
    expect(subject.getWalletLoginErrorMessage("exited_auth_flow")).toBe("");
    expect(subject.getWalletLoginErrorMessage("exited_link_flow")).toBe("");
  });

  it("turns wallet provider failures into useful launch errors", () => {
    expect(subject.getWalletTransactionErrorMessage).toBeTypeOf("function");
    expect(
      subject.getWalletTransactionErrorMessage({
        code: 4900,
        message: "MetaMask is disconnected",
      }),
    ).toBe(
      "Wallet connection was interrupted. Reload the page and try again",
    );
    expect(
      subject.getWalletTransactionErrorMessage({
        code: 4001,
        message: "User rejected the request",
      }),
    ).toBe("Transaction cancelled in wallet");
    expect(
      subject.getWalletTransactionErrorMessage(
        new Error("Wallet request failed"),
      ),
    ).toBe("Wallet request failed");
  });

  it("keeps the visible wallet session and dialog open when disconnect fails", () => {
    expect(subject.getWalletDisconnectOutcome(false)).toEqual({
      dialogOpen: true,
      error: "Unable to disconnect wallet. Try again.",
      sessionSuppressed: false,
    });
    expect(subject.getWalletDisconnectOutcome(true)).toEqual({
      dialogOpen: false,
      error: "",
      sessionSuppressed: true,
    });
  });

  it("does not disconnect provider wallets when authenticated logout fails", async () => {
    const events: string[] = [];
    const succeeded = await subject.executeWalletDisconnect({
      authenticated: true,
      logout: async () => {
        events.push("logout");
        throw new Error("logout failed");
      },
      disconnectProviderWallets: async () => {
        events.push("provider cleanup");
        return true;
      },
      markAppDisconnected: () => {
        events.push("mark disconnected");
      },
    });

    expect(succeeded).toBe(false);
    expect(events).toEqual(["logout"]);
  });

  it("keeps reconnect blocked until authenticated provider cleanup settles", async () => {
    const events: string[] = [];
    let finishCleanup: ((value: boolean) => void) | undefined;
    const cleanup = new Promise<boolean>((resolve) => {
      finishCleanup = resolve;
    });

    let disconnectSettled = false;
    const disconnect = subject.executeWalletDisconnect({
      authenticated: true,
      logout: async () => {
        events.push("logout");
      },
      disconnectProviderWallets: () => {
        events.push("provider cleanup");
        return cleanup;
      },
      markAppDisconnected: () => {
        events.push("mark disconnected");
      },
    });
    void disconnect.finally(() => {
      disconnectSettled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(disconnectSettled).toBe(false);
    expect(events).toEqual(["logout", "provider cleanup"]);

    finishCleanup?.(true);
    const succeeded = await disconnect;
    expect(succeeded).toBe(true);
    expect(disconnectSettled).toBe(true);
    expect(events).toEqual([
      "logout",
      "provider cleanup",
      "mark disconnected",
    ]);
  });

  it("completes authenticated logout when best-effort provider cleanup fails", async () => {
    const events: string[] = [];
    const succeeded = await subject.executeWalletDisconnect({
      authenticated: true,
      logout: async () => {
        events.push("logout");
      },
      disconnectProviderWallets: async () => {
        events.push("provider cleanup");
        throw new Error("provider cleanup failed");
      },
      markAppDisconnected: () => {
        events.push("mark disconnected");
      },
    });

    expect(succeeded).toBe(true);
    expect(events).toEqual([
      "logout",
      "provider cleanup",
      "mark disconnected",
    ]);
  });

  it("uses provider cleanup as the deterministic boundary without an authenticated session", async () => {
    const failedEvents: string[] = [];
    const failed = await subject.executeWalletDisconnect({
      authenticated: false,
      logout: async () => {
        failedEvents.push("logout");
      },
      disconnectProviderWallets: async () => {
        failedEvents.push("provider cleanup");
        return false;
      },
      markAppDisconnected: () => {
        failedEvents.push("mark disconnected");
      },
    });

    expect(failed).toBe(false);
    expect(failedEvents).toEqual(["provider cleanup"]);

    const succeededEvents: string[] = [];
    const succeeded = await subject.executeWalletDisconnect({
      authenticated: false,
      logout: async () => {
        succeededEvents.push("logout");
      },
      disconnectProviderWallets: async () => {
        succeededEvents.push("provider cleanup");
        return true;
      },
      markAppDisconnected: () => {
        succeededEvents.push("mark disconnected");
      },
    });

    expect(succeeded).toBe(true);
    expect(succeededEvents).toEqual([
      "provider cleanup",
      "mark disconnected",
    ]);
  });

  it("only exposes a connected wallet to the app after authentication", () => {
    const externalWallet = {
      address: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
      connectedAt: 20,
      linked: false,
      walletClientType: "metamask",
    };
    const embeddedWallet = {
      address: "0xaA5A000000000000000000000000000000005787",
      connectedAt: 10,
      linked: true,
      walletClientType: "privy",
    };

    expect(subject.selectAuthenticatedWallet).toBeTypeOf("function");
    expect(
      subject.selectAuthenticatedWallet(
        false,
        [embeddedWallet, externalWallet],
        embeddedWallet.address,
      ),
    ).toBeUndefined();
    expect(
      subject.selectAuthenticatedWallet(
        true,
        [embeddedWallet, externalWallet],
        embeddedWallet.address,
      ),
    ).toBe(externalWallet);
  });

  it("uses the most recently connected external wallet when more than one is available", () => {
    const older = {
      address: "0x1111111111111111111111111111111111111111",
      connectedAt: 10,
      linked: true,
      walletClientType: "metamask",
    };
    const newer = {
      address: "0x2222222222222222222222222222222222222222",
      connectedAt: 20,
      linked: true,
      walletClientType: "phantom",
    };

    expect(subject.selectConnectedWallet([older, newer])).toBe(newer);
  });
});

const hookemonSha = (byte: number) =>
  `sha256:${byte.toString(16).padStart(2, "0").repeat(32)}` as const;
const hookemonBytes32 = (byte: number) =>
  `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as const;
const hookemonLaunchWallet = `0x${"1".repeat(40)}` as const;
const hookemonLauncher = getCreateAddress({
  from: hookemonLaunchWallet,
  nonce: 8n,
});
const hookemonFundingUsdc = "1000000";
const hookemonApprovalData = `${HOOKEMON_APPROVE_SELECTOR}${
  hookemonLauncher.slice(2).toLowerCase().padStart(64, "0")
}${BigInt(hookemonFundingUsdc).toString(16).padStart(64, "0")}` as const;
const hookemonCreateData = "0x600060005560016000f3" as const;
const hookemonBinding = Object.freeze({
  bindingHash: hookemonSha(1),
  subjectHash: hookemonSha(2),
  profileKey: hookemonBytes32(3),
  profileSchemaHash: hookemonBytes32(4),
  planHash: hookemonBytes32(5),
  sourceCommit: "11".repeat(20),
  sourceTree: "22".repeat(20),
  launchWallet: hookemonLaunchWallet,
  launcher: hookemonLauncher,
  launcherInitCodeHash: keccak256(hookemonCreateData),
  fundingUsdc: hookemonFundingUsdc,
  approvalNonce: "7",
  launcherNonce: "8",
  adoptionTarget: `0x${"3".repeat(40)}`,
  adoptionSelector: "0x12345678",
  requiredConfirmations: 64,
} as const satisfies HookemonApplicantFlowBindingV1);

function rawHookemonAction(
  actionIndex: 0 | 1 | 2,
): HookemonBrowserWalletActionV1 {
  const actionKind = [
    "ERC20_APPROVAL",
    "EOA_CREATE",
    "COMPLETED_GRAPH_ADOPTION",
  ][actionIndex] as HookemonBrowserWalletActionV1["actionKind"];
  const nonce = actionIndex === 0 ? "0x7" : actionIndex === 1 ? "0x8" : "0x9";
  const data = actionIndex === 0
    ? hookemonApprovalData
    : actionIndex === 1
      ? hookemonCreateData
      : `${hookemonBinding.adoptionSelector}${"00".repeat(32)}` as const;
  return {
    schemaVersion: "programmable.hookemon-browser-wallet-action.v1",
    bindingHash: hookemonBinding.bindingHash,
    stateVersion: "1",
    actionIndex,
    actionKind,
    selectorHash: hookemonSha(6),
    actionHash: hookemonSha(7),
    dataHash: keccak256(data),
    previousFinalityEvidenceHash: actionIndex === 0
      ? null
      : hookemonSha(8),
    permitDigest: actionIndex === 2 ? hookemonBytes32(9) : null,
    validAfterEpochSeconds: "900",
    expiresAtEpochSeconds: "1200",
    currentness: {
      schemaVersion: "programmable.hookemon-action-currentness.v1",
      kind: ["PRE_APPROVAL", "PRE_CREATE", "PRE_ADOPTION"][actionIndex] as
        HookemonBrowserWalletActionV1["currentness"]["kind"],
      observedBlockNumber: "1",
      observedBlockHash: hookemonBytes32(10),
      observedPendingNonce: nonce,
      evidenceHash: hookemonSha(11),
      previousFinalityEvidenceHash: actionIndex === 0
        ? null
        : hookemonSha(8),
      completedGraphHash: actionIndex === 2 ? hookemonBytes32(12) : null,
      currentPoolStateHash: actionIndex === 2 ? hookemonBytes32(13) : null,
      runtimeStatusHash: actionIndex === 2
        ? hookemonSha(14)
        : null,
    },
    transaction: {
      method: "eth_sendTransaction",
      chainId: "0x1",
      from: hookemonBinding.launchWallet,
      to: actionIndex === 0
        ? HOOKEMON_MAINNET_USDC
        : actionIndex === 1
          ? null
          : hookemonBinding.adoptionTarget,
      nonce,
      gas: "0x10000",
      data,
      value: "0x0",
    },
  };
}

function validatedHookemonAction(
  actionIndex: 0 | 1,
): HookemonBrowserWalletActionV1 {
  return parseHookemonBrowserWalletActionV1(
    rawHookemonAction(actionIndex),
    hookemonBinding,
    "1000",
  );
}

function forgeHookemonAction(
  action: HookemonBrowserWalletActionV1,
  patch: Readonly<{
    transaction?: Readonly<Record<string, unknown>>;
    currentness?: Readonly<Record<string, unknown>>;
  }>,
): HookemonBrowserWalletActionV1 {
  return {
    ...action,
    ...(patch.transaction === undefined ? {} : {
      transaction: { ...action.transaction, ...patch.transaction },
    }),
    ...(patch.currentness === undefined ? {} : {
      currentness: { ...action.currentness, ...patch.currentness },
    }),
  } as unknown as HookemonBrowserWalletActionV1;
}

function forgeRawHookemonAction(
  actionIndex: 0 | 1,
  patch: Readonly<{
    actionHash?: HookemonBrowserWalletActionV1["actionHash"];
    selectorHash?: HookemonBrowserWalletActionV1["selectorHash"];
    transaction?: Readonly<Record<string, unknown>>;
    currentness?: Readonly<Record<string, unknown>>;
  }>,
): HookemonBrowserWalletActionV1 {
  const action = rawHookemonAction(actionIndex);
  return {
    ...action,
    ...(patch.actionHash === undefined ? {} : {
      actionHash: patch.actionHash,
    }),
    ...(patch.selectorHash === undefined ? {} : {
      selectorHash: patch.selectorHash,
    }),
    ...(patch.transaction === undefined ? {} : {
      transaction: { ...action.transaction, ...patch.transaction },
    }),
    ...(patch.currentness === undefined ? {} : {
      currentness: { ...action.currentness, ...patch.currentness },
    }),
  } as HookemonBrowserWalletActionV1;
}
