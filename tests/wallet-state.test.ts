import { describe, expect, it, vi } from "vitest";
import * as walletProvider from "../components/wallet-provider";
import type {
  HookemonBrowserWalletActionV1,
} from "../lib/custom-launch/hookemon-applicant-contract-v1";

type WalletProviderContract = {
  assertHookemonPendingNonceV1: (
    observed: unknown,
    expected: `0x${string}`,
  ) => void;
  buildHookemonEip1193TransactionV1: (
    action: HookemonBrowserWalletActionV1,
    connectedAccount: `0x${string}`,
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

describe("wallet recovery state", () => {
  it("builds exact-nonce Hookemon approval and null-to CREATE requests in isolation", () => {
    const account = `0x${"1".repeat(40)}` as const;
    const approval = subject.buildHookemonEip1193TransactionV1(
      hookemonAction(0),
      account,
    );
    expect(approval).toMatchObject({
      from: account,
      to: `0x${"2".repeat(40)}`,
      nonce: "0x7",
      gas: "0x10000",
      value: "0x0",
    });

    const create = subject.buildHookemonEip1193TransactionV1(
      hookemonAction(1),
      account,
    );
    expect(create).toMatchObject({
      from: account,
      nonce: "0x8",
      gas: "0x10000",
      value: "0x0",
    });
    expect(Object.hasOwn(create, "to")).toBe(false);
  });

  it("keeps adoption disabled and rejects any pending-nonce drift", () => {
    const account = `0x${"1".repeat(40)}` as const;
    expect(() => subject.buildHookemonEip1193TransactionV1(
      hookemonAction(2),
      account,
    )).toThrow(/not executable/u);
    expect(() => subject.buildHookemonEip1193TransactionV1(
      hookemonAction(0),
      `0x${"9".repeat(40)}`,
    )).toThrow(/not executable/u);
    expect(() => subject.assertHookemonPendingNonceV1("0x8", "0x8"))
      .not.toThrow();
    expect(() => subject.assertHookemonPendingNonceV1("0x9", "0x8"))
      .toThrow(/nonce changed/u);
    expect(() => subject.assertHookemonPendingNonceV1("0x08", "0x8"))
      .toThrow(/nonce changed/u);
  });

  it("rejects Hookemon action-kind and currentness substitutions", () => {
    const account = `0x${"1".repeat(40)}` as const;
    expect(() => subject.buildHookemonEip1193TransactionV1({
      ...hookemonAction(0),
      actionKind: "EOA_CREATE",
    }, account)).toThrow(/not executable/u);
    expect(() => subject.buildHookemonEip1193TransactionV1({
      ...hookemonAction(1),
      currentness: {
        ...hookemonAction(1).currentness,
        kind: "PRE_APPROVAL",
      },
    }, account)).toThrow(/not executable/u);
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

function hookemonAction(
  actionIndex: 0 | 1 | 2,
): HookemonBrowserWalletActionV1 {
  const actionKind = [
    "ERC20_APPROVAL",
    "EOA_CREATE",
    "COMPLETED_GRAPH_ADOPTION",
  ][actionIndex] as HookemonBrowserWalletActionV1["actionKind"];
  const nonce = actionIndex === 0 ? "0x7" : actionIndex === 1 ? "0x8" : "0x9";
  return {
    schemaVersion: "programmable.hookemon-browser-wallet-action.v1",
    bindingHash: `sha256:${"1".repeat(64)}`,
    stateVersion: "1",
    actionIndex,
    actionKind,
    selectorHash: `sha256:${"2".repeat(64)}`,
    actionHash: `sha256:${"3".repeat(64)}`,
    dataHash: `0x${"4".repeat(64)}`,
    previousFinalityEvidenceHash: actionIndex === 0
      ? null
      : `sha256:${"5".repeat(64)}`,
    permitDigest: actionIndex === 2 ? `0x${"6".repeat(64)}` : null,
    validAfterEpochSeconds: "1",
    expiresAtEpochSeconds: "2",
    currentness: {
      schemaVersion: "programmable.hookemon-action-currentness.v1",
      kind: ["PRE_APPROVAL", "PRE_CREATE", "PRE_ADOPTION"][actionIndex] as
        HookemonBrowserWalletActionV1["currentness"]["kind"],
      observedBlockNumber: "1",
      observedBlockHash: `0x${"7".repeat(64)}`,
      observedPendingNonce: nonce,
      evidenceHash: `sha256:${"8".repeat(64)}`,
      previousFinalityEvidenceHash: actionIndex === 0
        ? null
        : `sha256:${"5".repeat(64)}`,
      completedGraphHash: actionIndex === 2 ? `0x${"9".repeat(64)}` : null,
      currentPoolStateHash: actionIndex === 2 ? `0x${"a".repeat(64)}` : null,
      runtimeStatusHash: actionIndex === 2
        ? `sha256:${"b".repeat(64)}`
        : null,
    },
    transaction: {
      method: "eth_sendTransaction",
      chainId: "0x1",
      from: `0x${"1".repeat(40)}`,
      to: actionIndex === 1 ? null : `0x${"2".repeat(40)}`,
      nonce,
      gas: "0x10000",
      data: "0x6000",
      value: "0x0",
    },
  };
}
