import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LaunchExperience } from "../components/launch-entry";
import { ViewChainProvider } from "../components/view-chain";
import {
  PredictionMarketV2LocalPreview,
  createPredictionV2LocalPreviewDiscovery,
} from "../components/prediction-market-v2-local-preview";
import { parsePredictionAssetAutoDiscoveryV2 } from "../lib/prediction-v2/asset-auto-discovery-v2";

const root = process.cwd();
const BASE_TOKEN_ADDRESS = `0x${"ab".repeat(20)}`;
const SOLANA_FIXTURE_LOCATOR =
  "4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw";

function preview(
  initialState: Parameters<typeof PredictionMarketV2LocalPreview>[0]["initialState"],
  fixture: Parameters<typeof PredictionMarketV2LocalPreview>[0]["fixture"] = "base",
) {
  return renderToStaticMarkup(
    <PredictionMarketV2LocalPreview
      fixture={fixture}
      initialState={initialState}
      onBack={() => undefined}
    />,
  );
}

describe("Prediction V2 development-only local preview", () => {
  it("keeps the internal fixture out of the public launch runtime", () => {
    expect(process.env.NODE_ENV).not.toBe("development");
    const html = renderToStaticMarkup(
      <ViewChainProvider><LaunchExperience /></ViewChainProvider>,
    );

    expect(html).not.toContain('data-launch-model-option="prediction"');
    expect(html).not.toContain("programmable-prediction-v2-local-preview-v1");

    const source = readFileSync(
      join(root, "components/launch-entry.tsx"),
      "utf8",
    );
    expect(source).not.toContain("prediction-market-v2-local-preview");
    expect(source).not.toContain('previewCandidate === "prediction-v2"');
    expect(source).not.toContain("custom-launch-experience");
    expect(source).not.toContain("custom-launch-local-preview");
  });

  it.each([
    ["base", BASE_TOKEN_ADDRESS],
    ["solana", SOLANA_FIXTURE_LOCATOR],
  ] as const)(
    "starts the %s fixture with only the Token address decision",
    (fixture, address) => {
      const html = preview("address", fixture);

      expect(html).toContain(
        'data-local-preview="programmable-prediction-v2-local-preview-v1"',
      );
      expect(html).toContain(`data-prediction-v2-fixture="${fixture}"`);
      expect(html).toContain("Token address");
      expect(html).toContain(`value="${address}"`);
      expect(html).toContain("Find token");
      expect(html).not.toContain("Choose chain");
      expect(html).not.toContain("Solana mint");
      expect(html).not.toContain("Connect wallet");
    },
  );

  it("shows deterministic ambiguous and error states without a provider call", () => {
    const ambiguous = preview("ambiguous");
    expect(ambiguous).toContain("Choose the matching token");
    expect(ambiguous).toContain("Ethereum");
    expect(ambiguous).toContain("Base");

    const error = preview("error");
    expect(error).toContain("Enter a valid token address.");
    expect(error).toContain('value="not-an-address"');
  });

  it.each([
    ["base", "Base Test Token", "BTST"],
    ["solana", "Solana Test Token", "STST"],
  ] as const)(
    "renders the detected %s token before prediction choices",
    (fixture, name, symbol) => {
      const html = preview("asset", fixture);

      expect(html).toContain("Token found");
      expect(html).toContain(name);
      expect(html).toContain(symbol);
      expect(html).toContain("Price");
      expect(html).toContain("Market cap");
      expect(html).toContain("Liquidity");
      expect(html).toContain(`Continue with ${fixture === "base" ? "Base" : "Solana"}`);
      expect(html).not.toContain("Prediction unavailable");
    },
  );

  it("renders the prediction and review states from bound immutable evidence", () => {
    const prediction = preview("prediction");
    expect(prediction).toContain("Set the prediction");
    expect(prediction).toContain("Market cap");
    expect(prediction).toContain("Price");
    expect(prediction).toContain("Target");
    expect(prediction).toContain("Percentage change");
    expect(prediction).toContain("Reach before deadline");
    expect(prediction).toContain('value="10000000"');
    expect(prediction).toContain('value="2026-08-30T18:00"');

    const review = preview("review");
    expect(review).toContain("Review the market");
    expect(review).toContain('data-prediction-asset-preview-card-v2=""');
    expect(review).toContain("Base Test Token");
    expect(review).toContain("$BTST");
    expect(review).toContain(
      "Market-cap intent · ≥ $10,000,000 · Price settles",
    );
    expect(review).toContain("Aug 30, 2026 · 18:00:00 UTC");
    expect(review).toContain("YES resolves if");
    expect(review).toContain("$0.01");
    expect(review).toContain("Preview only");
    expect(review).not.toContain("Create market");
  });

  it("injects deterministic discovery and never calls fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const discover = createPredictionV2LocalPreviewDiscovery("base");
      const raw = await discover(BASE_TOKEN_ADDRESS, new AbortController().signal);
      expect(parsePredictionAssetAutoDiscoveryV2(raw, BASE_TOKEN_ADDRESS)).toMatchObject({
        status: "unique",
        locator: BASE_TOKEN_ADDRESS,
        candidate: {
          selection: { sourceNetwork: "base" },
        },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("contains no wallet, transaction, RPC or network client in the preview wrapper", () => {
    const source = readFileSync(
      join(root, "components/prediction-market-v2-local-preview.tsx"),
      "utf8",
    );

    expect(source).toContain("discoverToken={createPredictionV2LocalPreviewDiscovery(fixtureName)}");
    expect(source).not.toMatch(
      /wallet-provider|prediction-market-chain|\bviem\b|\bwagmi\b|\bethers\b|\bfetch\s*\(|\/api\/prediction/u,
    );
  });
});
