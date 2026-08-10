import { describe, expect, it, vi } from "vitest";
import * as walletProvider from "../components/wallet-provider";

type WalletProviderContract = {
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

describe("wallet recovery state", () => {
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
