import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = readFileSync(
  join(root, "components/token-trade.tsx"),
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
      /\.amountInputRow:focus-within\s*\{[^}]*outline-color:\s*var\(--text-soft\);/s,
    );
    expect(styles).toMatch(
      /\.amountCardInvalid \.amountInputRow:focus-within\s*\{[^}]*outline-color:\s*var\(--danger\);/s,
    );
    expect(styles).toMatch(
      /\.amountInput:focus-visible\s*\{[^}]*outline:\s*0;/s,
    );
  });

  it("uses a compact amount surface without shrinking touch controls", () => {
    expect(styles).toMatch(
      /\.amountCard\s*\{[^}]*min-height:\s*132px;[^}]*padding:\s*10px 14px 9px;/s,
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
});
