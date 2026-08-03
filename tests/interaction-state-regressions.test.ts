import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("interaction state regressions", () => {
  it("keeps the profile claim surface free of payout-setting controls", () => {
    const source = readFileSync(
      join(root, "components/profile-view.tsx"),
      "utf8",
    );

    expect(source).not.toContain("{payoutActionLabel(payoutState)}");
    expect(source).not.toContain("New payout address");
    expect(source).not.toContain("Payouts, fee terms and splits");
    expect(source).toContain('onClick={() => onClassicV3Action(reward, "claim")}');
  });

  it("uses the active profile network for transaction links", () => {
    const source = readFileSync(
      join(root, "components/profile-view.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /function transactionHref[\s\S]*?chainId === 11_155_111[\s\S]*?sepolia\.etherscan\.io[\s\S]*?etherscan\.io/,
    );
    expect(source).toContain("View transaction");
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

  it("shows visible feedback when the detail-page address copy fails", () => {
    const detailSource = readFileSync(
      join(root, "components/token-detail-view.tsx"),
      "utf8",
    );
    const exploreSource = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );

    expect(detailSource).toContain('setCopyError("Could not copy address")');
    expect(detailSource).toContain('<p className="toast" role="alert">');
    expect(exploreSource).not.toContain("Copy contract address");
  });

  it("keeps Explore project-first and removes the repeated footer slogan", () => {
    const exploreSource = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );
    const footerSource = readFileSync(
      join(root, "components/site-footer.tsx"),
      "utf8",
    );
    const exploreStyles = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );

    expect(exploreSource).not.toContain("All tokens");
    expect(exploreSource).not.toContain("V4 model");
    expect(exploreSource).not.toContain("<dt>Market cap</dt>");
    expect(exploreSource).not.toContain("runnerMeta");
    expect(footerSource).not.toContain(
      "Launch tokens that work the way you imagine.",
    );
    expect(exploreStyles).toMatch(
      /\.page\s*\{[^}]*display:\s*block;[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s,
    );
  });
});
