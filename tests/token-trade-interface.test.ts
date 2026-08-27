import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = readFileSync(
  join(root, "components/token-trade.tsx"),
  "utf8",
);
const detailSource = readFileSync(
  join(root, "components/token-detail-view.tsx"),
  "utf8",
);
const styles = readFileSync(
  join(root, "components/token-experience.module.css"),
  "utf8",
);

describe("token trade amount interface", () => {
  it("keeps validation neutral until an amount submission fails", () => {
    expect(source).toContain(
      "amountInvalid ? styles.amountCardInvalid : \"\"",
    );
    expect(source).toContain(
      "aria-invalid={amountInvalid || undefined}",
    );
    expect(styles).toMatch(
      /\.amountInputRow:focus-within\s*\{[^}]*outline-color:\s*transparent;/s,
    );
    expect(styles).toMatch(
      /\.amountCardInvalid \.amountInputRow:focus-within\s*\{[^}]*outline-color:\s*var\(--danger\);/s,
    );
    expect(styles).toMatch(
      /\.amountInput:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 var\(--focus\);[^}]*outline:\s*0;/s,
    );
    expect(styles).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.amountInput:focus-visible\s*\{[^}]*outline:\s*2px solid ButtonText;/s,
    );
  });

  it("uses a compact amount surface without shrinking touch controls", () => {
    expect(styles).toMatch(
      /\.amountCard\s*\{[^}]*min-height:\s*116px;[^}]*padding:\s*10px 14px 9px;/s,
    );
    expect(styles).toMatch(
      /\.amountInput\s*\{[^}]*height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /\.maxButton\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/s,
    );
    expect(styles).toMatch(
      /\.sideButton\s*\{[^}]*min-height:\s*44px;/s,
    );
  });

  it("keeps Classic V4 hook costs distinct without relabeling legacy trades", () => {
    expect(source).toContain(
      'feePresentation = "legacy-pool"',
    );
    expect(source).toContain('"Hook swap fee"');
    expect(source).toContain('"Curve price impact"');
    expect(source).toContain("Total execution cost");
    expect(source).toContain("TRADE_SLIPPAGE_PRESET_BPS.map");
    expect(detailSource).toContain(
      'token.launchModelVersion === "classic-v4"',
    );
    expect(
      detailSource.match(/feePresentation=\{classicTradeFeePresentation\}/gu),
    ).toHaveLength(2);
    expect(detailSource).toContain(
      "Math.floor(Date.now() / 1_000) + TRADE_QUOTE_VALIDITY_SECONDS",
    );
    expect(detailSource).toContain(
      "const next = await prepareNextTrade(submitted)",
    );
    expect(detailSource).not.toContain(
      "Math.floor(Date.now() / 1_000) + 1_200",
    );
  });

  it("turns Classic V4 Max into the verified one-shot Bonding completion", () => {
    expect(source).toContain('fetch("/api/trade/bonding-max"');
    expect(source).toContain("validatePreparedBondingGraduationResponse");
    expect(source).toContain('raw.code === "bonding-inactive"');
    expect(source).toContain("Complete Bonding");
    expect(source).toContain("Buy & graduate");
    expect(source).toContain("Permanently locked");
    expect(source).toContain("Token and Pool ID");
    expect(detailSource).toContain(
      'transaction.kind === "bonding-max-buy"',
    );
  });
});
