import { describe, expect, it } from "vitest";
import * as walletProvider from "../components/wallet-provider";

type WalletProviderContract = {
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
