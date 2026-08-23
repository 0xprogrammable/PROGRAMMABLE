import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { docsNavigation, docsSearchItems } from "../components/docs-data";
import sitemap from "../app/sitemap";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const modelPage = read("app/docs/models/[model]/page.tsx");
const canonicalPage = read("app/docs/tokens/prediction-markets/page.tsx");
const predictionDocsComponent = read("components/prediction-markets-docs.tsx");
const gitBookPage = read("docs/public/models/prediction-markets.md");
const readme = read("README.md");
const styleGuide = read("docs/public/.gitbook/STYLEGUIDE.md");
const vercelConfig = JSON.parse(read("vercel.json")) as {
  redirects?: Array<{
    destination: string;
    permanent: boolean;
    source: string;
  }>;
};
const predictionModelPage = predictionDocsComponent;
const canonicalSource =
  "https://github.com/0xprogrammable/programmable-prediction-markets";
const releaseBridgeSources = [
  predictionModelPage,
  gitBookPage,
  readme,
  read("app/docs/page.tsx"),
  read("app/docs/tokens/page.tsx"),
  read("components/docs-data.ts"),
  read("docs/public/README.md"),
  read("docs/public/creators/README.md"),
  read("docs/public/economics.md"),
  read("docs/public/infrastructure.md"),
  read("docs/public/tokens.md"),
];

describe("Prediction Markets documentation", () => {
  it("publishes one website and GitBook model route", () => {
    const navigationEntries = docsNavigation.flatMap((group) => group.items);

    expect(navigationEntries).toContainEqual(
      expect.objectContaining({
        href: "/docs/tokens/prediction-markets",
        label: "Prediction Markets",
      }),
    );
    expect(docsSearchItems).toContainEqual(
      expect.objectContaining({
        href: "/docs/tokens/prediction-markets",
        title: "Prediction Markets",
      }),
    );
    expect(sitemap().map((entry) => entry.url)).toContain(
      "https://programmable.market/docs/tokens/prediction-markets",
    );
    expect(sitemap().map((entry) => entry.url)).toContain(
      "https://programmable.market/markets",
    );
    expect(predictionDocsComponent).toContain(
      'currentPath="/docs/tokens/prediction-markets"',
    );
    expect(canonicalPage).toContain("<PredictionMarketsDocs />");
    expect(modelPage).toContain(
      'if (model === "prediction-markets") return predictionMarketsDocsMetadata;',
    );
    expect(modelPage).toContain('redirect("/docs/tokens/prediction-markets")');
    expect(predictionDocsComponent).toContain(
      'canonical: "/docs/tokens/prediction-markets"',
    );
    expect(gitBookPage).toContain("# Prediction Markets");
    expect(vercelConfig.redirects).toContainEqual({
      destination: "/docs/tokens/prediction-markets",
      permanent: true,
      source: "/docs/models/prediction-markets",
    });
  });

  it("keeps current release facts in the canonical source repository", () => {
    for (const source of [predictionModelPage, gitBookPage]) {
      const normalized = source.replace(/\s+/g, " ").toLowerCase();
      expect(source).toContain(canonicalSource);
      expect(normalized).toContain("current networks");
      expect(normalized).toContain("supported market types");
      expect(normalized).toContain("collateral and activation rules");
      expect(normalized).toContain("fees");
      expect(normalized).toContain("creator rewards");
      expect(normalized).toContain("resolution");
      expect(normalized).toContain("contract addresses");
      expect(normalized).toContain("release evidence");
    }
    expect(readme).toContain(canonicalSource);
    expect(styleGuide).toContain(
      "Do not duplicate those release-specific facts in these docs",
    );
  });

  it("does not duplicate release-specific values in the bridge docs", () => {
    const releaseSpecificValues = [
      "4663",
      "BTC/USD",
      "Robinhood Chain",
      "Chainlink",
      "2 USDG",
      "0.02%",
      "60 seconds",
      "25 hours",
    ];

    for (const source of releaseBridgeSources) {
      for (const value of releaseSpecificValues) {
        expect(source).not.toContain(value);
      }
    }
    expect(predictionModelPage).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(gitBookPage).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });
});
