import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const tradeSource = readFileSync(
  join(root, "components/custom-market-trade.tsx"),
  "utf8",
);
const tradeStyles = readFileSync(
  join(root, "components/token-experience.module.css"),
  "utf8",
);

describe("Custom market selector UI", () => {
  it("renders one bound market as a branded static value", () => {
    expect(tradeSource).toContain("if (markets.length === 1)");
    expect(tradeSource).toContain("styles.customMarketValue");
    expect(tradeSource).toContain("customMarketLabel(selected)");
  });

  it("uses branded native radio semantics when more markets exist", () => {
    expect(tradeSource).toContain("<fieldset");
    expect(tradeSource).toContain("<legend>Verified market</legend>");
    expect(tradeSource).toContain('type="radio"');
    expect(tradeSource).toContain("checked={selectedOption}");
    expect(tradeSource).toContain("onChange={() => onChange(market.marketId)}");
    expect(tradeSource).not.toContain("<select");
    expect(tradeStyles).not.toContain(".customMarketSelect select");
  });

  it("keeps the branded options touch-sized with visible keyboard focus", () => {
    expect(tradeStyles).toMatch(
      /\.customMarketOption\s*\{[^}]*min-height:\s*44px;/s,
    );
    expect(tradeStyles).toContain(
      ".customMarketOption:has(.customMarketOptionInput:focus-visible)",
    );
    expect(tradeStyles).toContain('.customMarketOption[data-selected="true"]');
  });
});
