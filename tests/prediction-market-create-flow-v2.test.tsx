import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PredictionMarketCreateFlowV2 } from "../components/prediction-market-create-flow-v2";
import type {
  PredictionAssetAutoDiscoveryClientCandidateV2,
  PredictionAssetAutoDiscoveryClientResultV2,
} from "../lib/prediction-v2/asset-auto-discovery-v2";
import type {
  PredictionV2CreationReferenceSnapshot,
  PredictionV2ReferenceMetricSnapshot,
  PredictionV2ReferenceSupplySnapshot,
} from "../lib/prediction-v2/create-flow-v2";

const ADDRESS = `0x${"ab".repeat(20)}`;
const OBSERVED_AT = "2026-08-23T18:00:00.000Z";
const IMAGE_ASSET_ID = "12".repeat(32);
const LOGO_CAPABILITY = `v2.preview-1.1800000600.${"a".repeat(43)}`;

function candidate(
  overrides: Partial<PredictionAssetAutoDiscoveryClientCandidateV2> = {},
): PredictionAssetAutoDiscoveryClientCandidateV2 {
  return {
    selectionKey: `evm:8453:${ADDRESS}`,
    selection: {
      mode: "custom",
      sourceNetwork: "base",
      assetLocator: ADDRESS,
    },
    namespace: "evm",
    chainReference: "8453",
    providerChainId: "base",
    provenance: {
      identity: { source: "onchain-rpc" },
      enrichment: { source: "dexscreener" },
    },
    currentPriceUsd: 0.008,
    marketCapUsd: 8_000_000,
    fdvUsd: 9_500_000,
    matchingPairCount: 2,
    logoProxy: {
      assetId: IMAGE_ASSET_ID,
      capability: LOGO_CAPABILITY,
    },
    pair: {
      dexId: "uniswap",
      pairAddress: `0x${"cd".repeat(20)}`,
      matchedSide: "base",
      liquidityUsd: 420_000,
      volume24hUsd: 180_000,
      pairCreatedAt: Date.parse("2026-08-20T18:00:00.000Z"),
    },
    profile: {
      schemaVersion: 2,
      chain: { id: "base", reference: "8453", label: "Base" },
      address: ADDRESS,
      explorerUrl: `https://basescan.org/token/${ADDRESS}`,
      name: "Example Coin",
      symbol: "EXAMPLE",
      links: [
        { kind: "website", url: "https://example.com/" },
        { kind: "x", url: "https://x.com/example" },
        { kind: "telegram", url: "https://t.me/example" },
      ],
      priceUsd: 0.008,
      marketCapUsd: 8_000_000,
      fdvUsd: 9_500_000,
      liquidityUsd: 420_000,
      age: {
        pairCreatedAt: "2026-08-20T18:00:00.000Z",
        seconds: 259_200,
      },
    },
    ...overrides,
  };
}

function identityOnlyCandidate() {
  return candidate({
    currentPriceUsd: null,
    marketCapUsd: null,
    fdvUsd: null,
    matchingPairCount: 0,
    pair: null,
    logoProxy: null,
    provenance: {
      identity: { source: "onchain-rpc" },
      enrichment: null,
    },
    profile: {
      schemaVersion: 2,
      chain: { id: "base", reference: "8453", label: "Base" },
      address: ADDRESS,
      explorerUrl: `https://basescan.org/token/${ADDRESS}`,
    },
  });
}

function uniqueResult(
  token = candidate(),
): PredictionAssetAutoDiscoveryClientResultV2 {
  return {
    schemaVersion: 2,
    locator: ADDRESS,
    source: token.provenance.enrichment?.source ?? null,
    observedAt: OBSERVED_AT,
    usage: "informational-only",
    status: "unique",
    candidate: token,
  };
}

const SNAPSHOT_TIME = "2026-08-23T12:00:00Z";

const CREATION_SNAPSHOT = {
  settlementChainId: "4663",
  capturedAtUtc: SNAPSHOT_TIME,
  snapshotReference: "eip155:4663:block:9100000",
  evidenceDigest: `0x${"11".repeat(32)}`,
  verificationStatus: "verified",
} as const satisfies PredictionV2CreationReferenceSnapshot;

const SUPPLY_SNAPSHOT = {
  sourceNetwork: "base",
  address: ADDRESS,
  fixedSupplyAtoms: "1000000000000000000000000000",
  tokenDecimals: 18,
  capturedAtUtc: SNAPSHOT_TIME,
  snapshotReference: "eip155:8453:block:34900000",
  evidenceDigest: `0x${"22".repeat(32)}`,
  verificationStatus: "verified",
  supplyDefinition: "fixed-supply-fully-circulating",
} as const satisfies PredictionV2ReferenceSupplySnapshot;

const PRICE_REFERENCE_SNAPSHOT = {
  metric: "price",
  valueUsd: "0.008",
  sourceNetwork: "base",
  address: ADDRESS,
  capturedAtUtc: "2026-08-23T12:00:00Z",
  snapshotReference: "eip155:8453:block:34900000",
  evidenceDigest: `0x${"33".repeat(32)}`,
  verificationStatus: "verified",
} as const satisfies PredictionV2ReferenceMetricSnapshot;

describe("PredictionMarketCreateFlowV2", () => {
  it("starts with one token-address lookup and no chain or wallet decision", () => {
    const html = renderToStaticMarkup(<PredictionMarketCreateFlowV2 />);

    expect(html).toContain("Find a token");
    expect(html).toContain("Token address");
    expect(html).toContain("Find token");
    expect(html).toContain('name="tokenAddress"');
    expect(html).toContain('maxLength="128"');
    expect(html).not.toContain("Choose chain");
    expect(html).not.toContain("Solana mint");
    expect(html).not.toContain("Contract address");
    expect(html).not.toContain("wallet");
    expect(html).not.toContain("<select");
  });

  it("reveals the detected token profile, market data and safe project links", () => {
    const html = renderToStaticMarkup(
      <PredictionMarketCreateFlowV2
        initialDiscoveryResult={uniqueResult()}
      />,
    );

    expect(html).toContain("Token found");
    expect(html).toContain("Example Coin");
    expect(html).toContain("EXAMPLE");
    expect(html).toContain("Base");
    expect(html).toContain("Price");
    expect(html).toContain("Market cap");
    expect(html).toContain("FDV");
    expect(html).toContain("Liquidity");
    expect(html).toContain("Age");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('href="https://x.com/example"');
    expect(html).toContain('href="https://t.me/example"');
    expect(html).toContain(
      `src="/api/prediction/asset-logo/${IMAGE_ASSET_ID}` +
        `?capability=${LOGO_CAPABILITY}"`,
    );
    expect(html).not.toContain("cdn.dexscreener.com");
    expect(html).toContain("Continue with Base");
  });

  it("shows every prediction template and enables market cap only with bound supply evidence", () => {
    const available = renderToStaticMarkup(
      <PredictionMarketCreateFlowV2
        initialDiscoveryResult={uniqueResult()}
        initialCreationSnapshot={CREATION_SNAPSHOT}
        initialPrediction={{ metric: "market-cap" }}
        initialReferenceSupplySnapshot={SUPPLY_SNAPSHOT}
        initialView="prediction"
      />,
    );
    expect(available).toContain("Set the prediction");
    expect(available).toContain("Market cap");
    expect(available).toContain("Price");
    expect(available).toContain("Target");
    expect(available).toContain("Percentage change");
    expect(available).toContain("Reach before deadline");
    expect(available).toMatch(/aria-pressed="true"[^>]*>Market cap<\/button>/u);
    expect(available).toMatch(/disabled=""[^>]*>Reach before deadline<\/button>/u);

    const unavailable = renderToStaticMarkup(
      <PredictionMarketCreateFlowV2
        initialDiscoveryResult={uniqueResult()}
        initialView="prediction"
      />,
    );
    expect(unavailable).toMatch(/disabled=""[^>]*>Market cap<\/button>/u);
    expect(unavailable).toContain(
      "Market cap isn’t available for this token yet.",
    );
    expect(unavailable).toMatch(/aria-pressed="true"[^>]*>Price<\/button>/u);
  });

  it("enables percentage change only with a bound verified starting value", () => {
    const available = renderToStaticMarkup(
      <PredictionMarketCreateFlowV2
        initialCreationSnapshot={CREATION_SNAPSHOT}
        initialDiscoveryResult={uniqueResult()}
        initialReferenceMetricSnapshot={PRICE_REFERENCE_SNAPSHOT}
        initialView="prediction"
      />,
    );

    expect(available).not.toMatch(
      /disabled=""[^>]*>Percentage change<\/button>/u,
    );
    expect(available).toContain("Reach markets are coming later.");
  });

  it("shows incomplete market data without treating DEX quality as eligibility", () => {
    const base = candidate();
    if (!base.pair) throw new Error("expected enriched pair fixture");
    const lowLiquidity = candidate({
      pair: { ...base.pair, liquidityUsd: 49_000 },
      profile: { ...base.profile, liquidityUsd: 49_000 },
    });
    const html = renderToStaticMarkup(
      <PredictionMarketCreateFlowV2
        initialCreationSnapshot={CREATION_SNAPSHOT}
        initialDiscoveryResult={uniqueResult(lowLiquidity)}
      />,
    );

    expect(html).toContain("Market data incomplete");
    expect(html).toContain("The token needs at least $50K in liquidity.");
    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Continue with Base<\/button>/u,
    );
  });

  it("uses deterministic identity fallbacks when DEX enrichment is absent", () => {
    const html = renderToStaticMarkup(
      <PredictionMarketCreateFlowV2
        initialCreationSnapshot={CREATION_SNAPSHOT}
        initialDiscoveryResult={uniqueResult(identityOnlyCandidate())}
      />,
    );

    expect(html).toContain("Base token");
    expect(html).toContain("0xababa…babab");
    expect(html).toContain("Market data incomplete");
    expect(html).not.toContain("Token name and symbol are unavailable");
    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Continue with Base<\/button>/u,
    );
  });

  it("carries identity fallbacks into the deterministic review", () => {
    const html = renderToStaticMarkup(
      <PredictionMarketCreateFlowV2
        initialCreationSnapshot={CREATION_SNAPSHOT}
        initialDiscoveryResult={uniqueResult(identityOnlyCandidate())}
        initialPrediction={{
          metric: "price",
          template: "target",
          targetUsd: "0.01",
          observationUtc: "2026-09-20T18:00:00Z",
          priceDecimals: 8,
        }}
        initialView="review"
      />,
    );

    expect(html).toContain("Review the market");
    expect(html).toContain("Base token");
    expect(html).toContain("$0xababa…babab");
    expect(html).toContain("Price ≥ $0.01");
  });

  it("reviews the token-style card against its authoritative absolute price rule", () => {
    const html = renderToStaticMarkup(
      <PredictionMarketCreateFlowV2
        initialDiscoveryResult={uniqueResult()}
        initialPrediction={{
          metric: "market-cap",
          template: "target",
          targetUsd: "10000000",
          observationUtc: "2026-09-20T18:00:00Z",
          priceDecimals: 8,
        }}
        initialCreationSnapshot={CREATION_SNAPSHOT}
        initialReferenceSupplySnapshot={SUPPLY_SNAPSHOT}
        initialView="review"
      />,
    );

    expect(html).toContain("Review the market");
    expect(html).toContain('data-prediction-asset-preview-card-v2=""');
    expect(html).not.toContain('data-prediction-asset-card-v2=""');
    expect(html).toContain("Example Coin");
    expect(html).toContain("$EXAMPLE");
    expect(html).toContain("Price ≥ $0.01");
    expect(html).toContain(
      "Market-cap intent · ≥ $10,000,000 · Price settles",
    );
    expect(html).toContain("Result time");
    expect(html).toContain("YES resolves if");
    expect(html).toContain("The USD price is at least");
    expect(html).toContain("$0.01");
    expect(html).toContain("18:00:00 UTC");
    expect(html).toContain("Preview only");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Preview only<\/button>/u);
    expect(html).not.toContain("Create market");
    expect(html).toContain(
      `src="/api/prediction/asset-logo/${IMAGE_ASSET_ID}` +
        `?capability=${LOGO_CAPABILITY}"`,
    );
    expect(html).not.toContain("cdn.dexscreener.com");
  });
});
