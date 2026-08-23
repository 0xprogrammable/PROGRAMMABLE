import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PredictionMarketAssetSelectorV2 } from "../components/prediction-market-asset-selector-v2";

describe("PredictionMarketAssetSelectorV2", () => {
  it("renders the four presets without suggesting an unreleased market is tradable", () => {
    const html = renderToStaticMarkup(
      createElement(PredictionMarketAssetSelectorV2, {
        value: { mode: "preset", presetId: "btc" },
        onChange: () => undefined,
      }),
    );

    expect(html).toContain("Bitcoin");
    expect(html).toContain("Ethereum");
    expect(html).toContain("Solana");
    expect(html).toContain("BNB");
    expect(html).toContain("Not available yet");
    expect(html).toContain("No released price source is configured");
    expect(html).not.toContain("Create market");
    expect(html).not.toContain("Market cap bet");
  });

  it("requires an explicit custom network and labels reference data as reference", () => {
    const html = renderToStaticMarkup(
      createElement(PredictionMarketAssetSelectorV2, {
        value: {
          mode: "custom",
          sourceNetwork: "ethereum",
          assetLocator: "0x1111111111111111111111111111111111111111",
        },
        onChange: () => undefined,
        discoverySnapshot: {
          assetKey:
            "evm:1:0x1111111111111111111111111111111111111111",
          status: "available",
          currentPriceUsd: 0.25,
          marketCapUsd: 100_000,
        },
      }),
    );

    expect(html).toContain("Select network");
    expect(html).toContain("Ethereum");
    expect(html).toContain("Base");
    expect(html).toContain("BNB Chain");
    expect(html).toContain("Robinhood Chain");
    expect(html).toContain("Solana");
    expect(html).toContain("Contract address");
    expect(html).toContain("The address alone does not identify its network");
    expect(html).toContain("Current price · info only");
    expect(html).toContain("Market cap · info only");
    expect(html).toContain("Not available yet");
  });
});
