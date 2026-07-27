import { describe, expect, it } from "vitest";
import * as walletProvider from "../components/wallet-provider";

type WalletProviderContract = {
  getWalletSessionAction: (
    ready: boolean,
    authenticated: boolean,
    connectedWalletCount: number,
  ) => "wait" | "login" | "manage";
  getWalletProfileStorageKey: (account: string) => string;
  readUsernameFromProfileValue: (value: string | null) => string;
  getWalletLoginErrorMessage: (errorCode: string) => string;
};

const subject = walletProvider as unknown as WalletProviderContract;

describe("wallet recovery state", () => {
  it("opens account management for an external wallet session even before Privy authentication completes", () => {
    expect(subject.getWalletSessionAction).toBeTypeOf("function");
    expect(subject.getWalletSessionAction(true, false, 1)).toBe("manage");
  });

  it("opens login only when Privy is ready and no recoverable session exists", () => {
    expect(subject.getWalletSessionAction).toBeTypeOf("function");
    expect(subject.getWalletSessionAction(false, false, 0)).toBe("wait");
    expect(subject.getWalletSessionAction(true, false, 0)).toBe("login");
    expect(subject.getWalletSessionAction(true, true, 0)).toBe("manage");
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
        JSON.stringify({ username: "Kemal36", bio: "preserved" }),
      ),
    ).toBe("Kemal36");
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
});
