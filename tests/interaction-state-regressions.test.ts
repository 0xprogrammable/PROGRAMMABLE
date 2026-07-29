import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("interaction state regressions", () => {
  it("keeps Classic payout editing aligned with the shared transaction state", () => {
    const source = readFileSync(
      join(root, "components/profile-view.tsx"),
      "utf8",
    );

    expect(source).toContain("{payoutActionLabel(payoutState)}");
    expect(source).toMatch(
      /aria-label=\{`New payout address[\s\S]*?disabled=\{payoutPending \|\| actionCanCheckStatus\(payoutState\)\}/,
    );
    expect(source).toContain(
      "disabled={payoutPending || actionCanCheckStatus(payoutState)}",
    );
  });

  it("uses the active profile network for Stock-Paired payout links", () => {
    const source = readFileSync(
      join(root, "components/profile-view.tsx"),
      "utf8",
    );

    expect(source).not.toContain(
      'href={`https://etherscan.io/address/${reward.payoutAddress}`}',
    );
    expect(source).toMatch(
      /chainId === 11_155_111[\s\S]*?sepolia\.etherscan\.io[\s\S]*?reward\.payoutAddress/,
    );
  });

  it("remounts token-detail trade state when the connected account changes", () => {
    const source = readFileSync(
      join(root, "components/token-detail-view.tsx"),
      "utf8",
    );

    expect(source).toContain("const { wallet: activeWallet } = useWallet()");
    expect(source).toContain(
      'activeWallet?.account.toLowerCase() ?? "disconnected"',
    );
  });

  it("shows visible feedback when address copying fails", () => {
    for (const file of [
      "components/explore-view.tsx",
      "components/token-detail-view.tsx",
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).toContain('setCopyError("Could not copy address")');
      expect(source).toContain('<p className="toast" role="alert">');
    }
  });
});
