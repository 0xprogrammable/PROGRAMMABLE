import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PredictionMarketAssetCardV2,
  PredictionMarketAssetPreviewCardV2,
  predictionAssetConditionLabelV2,
  predictionAssetResultTimeLabelV2,
  predictionMarketAssetCardHrefV2,
} from "../components/prediction-market-asset-card-v2";
import { predictionAssetCardImageV2 } from
  "../lib/prediction-v2/asset-logo-v2";
import type { PredictionV2BaseMarketView } from
  "../lib/prediction-v2/base-market-view-v2";
import type { PredictionV2CreateReview } from
  "../lib/prediction-v2/create-flow-v2";
import {
  enrichPredictionV2BaseMarketView,
  type PredictionV2EnrichedMarketView,
} from "../lib/prediction-v2/enriched-market-view-v2";
import type { PublicPredictionMarketViewV2 } from
  "../lib/prediction-v2/public-market-view-v2";
import type { PredictionTokenProfileV2 } from
  "../lib/prediction-v2/token-profile-v2";

const ADDRESS = `0x${"ab".repeat(20)}`;
const OTHER_ADDRESS = `0x${"cd".repeat(20)}`;
const FACTORY = `0x${"11".repeat(20)}`;
const MARKET_ID = `0x${"22".repeat(32)}` as const;
const ECONOMIC_KEY = `0x${"21".repeat(32)}` as const;
const MARKET_KEY = `eip155:4663:${FACTORY}:${ECONOMIC_KEY}` as const;
const CONFIRMED_BLOCK_NUMBER = "9100020";
const CONFIRMED_BLOCK_HASH = `0x${"24".repeat(32)}` as const;
const ARTWORK_DIGEST = "33".repeat(32);
const PROVIDER_ASSET_ID = "12".repeat(32);
const LOGO_CAPABILITY = `v2.preview-1.1800000000.${"a".repeat(43)}`;
const LOGO_PROXY = Object.freeze({
  assetId: PROVIDER_ASSET_ID,
  capability: LOGO_CAPABILITY,
});

const OPEN_LIFECYCLE = Object.freeze({
  protocolState: "OPEN",
  checkpointStatus: "AWAITING",
  tradingPhase: "OPEN",
  tradable: true,
  tradabilityReason: "tradable",
  checkpointTradingHealthy: true,
  resolvedPrice: 0n,
} as const);

const BASE_MARKET = Object.freeze({
  schemaVersion: 2,
  source: "dual-rpc-onchain",
  marketKey: MARKET_KEY,
  marketId: MARKET_ID,
  economicKey: ECONOMIC_KEY,
  asset: Object.freeze({
    kind: "token",
    presetId: null,
    sourceNetwork: "base",
    chainLabel: "Base",
    address: ADDRESS,
    explorerUrl: `https://basescan.org/token/${ADDRESS}`,
    name: null,
    symbol: "EXAMPLE",
  }),
  condition: Object.freeze({
    kind: "usd-price-at-utc",
    metric: "usd-price",
    comparator: "greater-than-or-equal",
    quoteCurrency: "USD",
    strikeAtoms: "1000000",
    priceDecimals: 8,
    observationUnixSeconds: "1788112800",
    observationUtc: "2026-08-30T18:00:00.000Z",
    oracleSnapshotRule: Object.freeze({
      source: "chainlink-data-feed",
      winningPrice: "latest-completed-round-at-or-before-observation",
      requiredAfterRound: "first-completed-round-after-observation",
      maximumBeforeAgeSeconds: "90000",
      maximumAfterDelaySeconds: "90000",
    }),
  }),
  lifecycle: OPEN_LIFECYCLE,
  poolState: Object.freeze({
    sqrtPriceX96: 1n << 96n,
    tick: 0,
    poolManagerProtocolFee: 0,
    lpFee: 200,
    yesProbabilityBps: 5_000,
  }),
  artwork: Object.freeze({
    kind: "bundled-fallback",
    url: "/brand/programmable-token-fallback-01-dawn.webp",
  }),
  links: Object.freeze([]) as readonly [],
  onchain: Object.freeze({
    releaseId: "prediction-v2.release-1",
    settlementChainId: 4_663,
    factoryAddress: FACTORY,
    factoryRuntimeCodeHash: `0x${"41".repeat(32)}`,
    assetKey: `0x${"13".repeat(32)}`,
    registryRevision: "7",
    registrySnapshotHash: `0x${"23".repeat(32)}`,
    resolutionPolicyHash: `0x${"28".repeat(32)}`,
    vaultAddress: `0x${"31".repeat(20)}`,
    checkpointAddress: `0x${"32".repeat(20)}`,
    poolId: `0x${"27".repeat(32)}`,
    confirmedBlockNumber: CONFIRMED_BLOCK_NUMBER,
    confirmedBlockHash: CONFIRMED_BLOCK_HASH,
  }),
} as const) satisfies PredictionV2BaseMarketView;

const PUBLIC_ENRICHMENT = Object.freeze({
  schemaVersion: 2,
  marketKey: MARKET_KEY,
  marketId: MARKET_ID,
  asset: Object.freeze({
    sourceNetwork: "base",
    chainLabel: "Base",
    address: ADDRESS,
    name: "Example Coin",
    symbol: "EXAMPLE",
    explorerUrl: `https://basescan.org/token/${ADDRESS}`,
  }),
  condition: Object.freeze({
    kind: "usd-price-at-utc",
    metric: "usd-price",
    comparator: "greater-than-or-equal",
    quoteCurrency: "USD",
    strikeUsd: "0.01",
    strikeAtoms: "1000000",
    priceDecimals: 8,
    observationUtc: "2026-08-30T18:00:00.000Z",
    observationUnixSeconds: "1788112800",
    timezone: "UTC",
  }),
  creationIntent: Object.freeze({
    kind: "market-cap-equivalent",
    settlementRole: "secondary-non-settlement",
    comparator: "greater-than-or-equal",
    targetUsd: "10000000",
    template: "target",
    percentChange: null,
    equivalentPriceStrikeUsd: "0.01",
    evidence: Object.freeze({
      creationSnapshot: Object.freeze({
        settlementChainId: "4663",
        capturedAtUtc: "2026-08-23T18:00:00Z",
        snapshotReference: "eip155:4663:block:9100000",
        evidenceDigest: `0x${"15".repeat(32)}`,
        verificationStatus: "verified",
      }),
      referenceSupplySnapshot: Object.freeze({
        sourceNetwork: "base",
        address: ADDRESS,
        fixedSupplyAtoms: "1000000000000000000",
        tokenDecimals: 18,
        capturedAtUtc: "2026-08-23T18:00:00Z",
        snapshotReference: "eip155:8453:block:35000000",
        evidenceDigest: `0x${"16".repeat(32)}`,
        verificationStatus: "verified",
        supplyDefinition: "fixed-supply-fully-circulating",
      }),
      referenceMetricSnapshot: null,
    }),
  }),
  artwork: Object.freeze({
    kind: "owned-provider-snapshot",
    url: `/media/prediction/sha256-${ARTWORK_DIGEST}.webp`,
    digest: `sha256:${ARTWORK_DIGEST}`,
    contentType: "image/webp",
    sourceAssetId: PROVIDER_ASSET_ID,
  }),
  links: Object.freeze([
    Object.freeze({ kind: "website", url: "https://example.com/" }),
    Object.freeze({ kind: "x", url: "https://x.com/example" }),
    Object.freeze({ kind: "telegram", url: "https://t.me/example" }),
  ]),
  presentation: Object.freeze({
    revision: "1",
    revisionHash: `sha256:${"44".repeat(32)}`,
    observedAt: "2026-08-23T18:00:00.000Z",
  }),
  attestedProjection: Object.freeze({
    releaseId: BASE_MARKET.onchain.releaseId,
    settlementChainId: "4663",
    factoryAddress: FACTORY,
    factoryRuntimeCodeHash: BASE_MARKET.onchain.factoryRuntimeCodeHash,
    economicKey: ECONOMIC_KEY,
    onchainAssetKey: BASE_MARKET.onchain.assetKey,
    registryRevision: BASE_MARKET.onchain.registryRevision,
    registrySnapshotHash: BASE_MARKET.onchain.registrySnapshotHash,
    confirmedBlockNumber: CONFIRMED_BLOCK_NUMBER,
    confirmedBlockHash: CONFIRMED_BLOCK_HASH,
    attestorAddress: `0x${"14".repeat(20)}`,
  }),
} as const) satisfies PublicPredictionMarketViewV2;

const BASE_ONLY = enrichPredictionV2BaseMarketView(BASE_MARKET, null);
const ENRICHED = enrichPredictionV2BaseMarketView(
  BASE_MARKET,
  PUBLIC_ENRICHMENT,
);

const PROFILE = {
  schemaVersion: 2,
  chain: { id: "base", reference: "8453", label: "Base" },
  address: ADDRESS,
  explorerUrl: `https://basescan.org/token/${ADDRESS}`,
  name: "Example Coin",
  symbol: "EXAMPLE",
  logoUrl: `https://cdn.dexscreener.com/cms/images/${PROVIDER_ASSET_ID}`,
  links: PUBLIC_ENRICHMENT.links,
} as const satisfies PredictionTokenProfileV2;

const CREATION_SNAPSHOT = {
  settlementChainId: "4663",
  capturedAtUtc: "2026-08-23T18:00:00Z",
  snapshotReference: "eip155:4663:block:9100000",
  evidenceDigest: `0x${"11".repeat(32)}`,
  verificationStatus: "verified",
} as const;

const REVIEW = {
  schemaVersion: 2,
  asset: { sourceNetwork: "base", address: ADDRESS },
  assetName: "Example Coin",
  assetSymbol: "EXAMPLE",
  selectedMetric: "market-cap",
  template: "target",
  metricTargetUsd: "10000000",
  inputTargetUsd: "10000000",
  percentChange: null,
  referenceMetricUsd: null,
  creationSnapshot: CREATION_SNAPSHOT,
  referenceMetricSnapshot: null,
  referenceSupplySnapshot: null,
  protocolPredicate: {
    metric: "usd-price",
    comparator: "greater-than-or-equal",
    quoteCurrency: "USD",
    strikeUsd: "0.01",
    strikeAtoms: "1000000",
    priceDecimals: 8,
    observationUtc: "2026-08-30T18:00:00Z",
    observationUnixSeconds: "1788112800",
    timezone: "UTC",
    evidenceBinding: {
      creationSnapshot: CREATION_SNAPSHOT,
      referenceMetricSnapshot: null,
      referenceSupplySnapshot: null,
    },
  },
  settlementEligibility: "not-evaluated",
} as const satisfies PredictionV2CreateReview;

type PublicCardProps = Parameters<typeof PredictionMarketAssetCardV2>[0];
type PublicIndependentTrustKeys = Extract<
  keyof PublicCardProps,
  | "cardState"
  | "lifecycle"
  | "probability"
  | "snapshot"
  | "profile"
  | "review"
  | "href"
  | "status"
  | "transaction"
  | "preparedTransaction"
  | "calldata"
  | "wallet"
  | "account"
>;
const PUBLIC_CARD_HAS_NO_INDEPENDENT_TRUST_INPUTS:
  PublicIndependentTrustKeys extends never ? true : false = true;
const PUBLIC_CARD_ACCEPTS_ENRICHED_VIEW:
  PublicCardProps["market"] extends PredictionV2EnrichedMarketView
    ? true
    : false = true;

function renderPublicCard(
  market: PredictionV2EnrichedMarketView = ENRICHED,
) {
  return renderToStaticMarkup(<PredictionMarketAssetCardV2 market={market} />);
}

function withLifecycle(
  lifecycle: PredictionV2EnrichedMarketView["lifecycle"],
): PredictionV2EnrichedMarketView {
  return Object.freeze({
    ...BASE_ONLY,
    lifecycle: Object.freeze(lifecycle),
  });
}

describe("PredictionMarketAssetCardV2", () => {
  it("accepts one enriched dual-RPC view and keeps price primary", () => {
    const html = renderToStaticMarkup(
      <PredictionMarketAssetCardV2 headingLevel="h2" market={ENRICHED} />,
    );
    const conditionIndex = html.indexOf("Price ≥ $0.01");
    const intentIndex = html.indexOf("Market-cap intent");
    const resultTime = "Aug 30, 2026 · 18:00:00 UTC";

    expect(PUBLIC_CARD_HAS_NO_INDEPENDENT_TRUST_INPUTS).toBe(true);
    expect(PUBLIC_CARD_ACCEPTS_ENRICHED_VIEW).toBe(true);
    expect(html).toContain('data-prediction-asset-card-v2=""');
    expect(html).toContain('data-runtime-binding="bound"');
    expect(html).toContain(
      `data-snapshot-block="${CONFIRMED_BLOCK_NUMBER}"`,
    );
    expect(html).toContain(`<h2 title="Example Coin">Example Coin</h2>`);
    expect(html).toContain(`href="/markets/v2/${MARKET_ID}"`);
    expect(html).toContain(
      `aria-label="Open Example Coin prediction: Price ≥ $0.01; result at ${resultTime}"`,
    );
    expect(conditionIndex).toBeGreaterThan(0);
    expect(intentIndex).toBeGreaterThan(conditionIndex);
    expect(html).toContain(
      "Market-cap intent · ≥ $10,000,000 · Price settles",
    );
    expect(html).toContain("<dt>Result time</dt>");
    expect(html).not.toContain("<dt>Closes</dt>");
    expect(predictionAssetConditionLabelV2(ENRICHED)).toBe("Price ≥ $0.01");
    expect(predictionAssetResultTimeLabelV2(ENRICHED)).toBe(resultTime);
    expect(predictionMarketAssetCardHrefV2(ENRICHED)).toBe(
      `/markets/v2/${MARKET_ID}`,
    );
  });

  it("cannot pair copied ids with an independently supplied probability", () => {
    const legacyInjection = {
      market: BASE_ONLY,
      cardState: {
        marketId: MARKET_ID,
        marketKey: MARKET_KEY,
        probability: { status: "available", yesProbabilityBps: 9_999 },
      },
      probability: { status: "available", yesProbabilityBps: 9_999 },
    } as unknown as PublicCardProps;
    const html = renderToStaticMarkup(
      <PredictionMarketAssetCardV2 {...legacyInjection} />,
    );

    expect(html).toContain("<dt>Probability</dt><dd>50%</dd>");
    expect(html).not.toContain("99.99%");
  });

  it("keeps the base market visible without attestor enrichment", () => {
    const html = renderPublicCard(BASE_ONLY);

    expect(html).toContain(`<h3 title="EXAMPLE">EXAMPLE</h3>`);
    expect(html).toContain(`href="/markets/v2/${MARKET_ID}"`);
    expect(html).toContain('data-artwork-source="bundled-fallback"');
    expect(html).toContain(
      'src="/brand/programmable-token-fallback-01-dawn.webp"',
    );
    expect(html).toContain("<dt>Status</dt><dd>Open</dd>");
    expect(html).toContain("<dt>Probability</dt><dd>50%</dd>");
    expect(html).not.toContain("<nav");
  });

  it("drops mismatched enrichment without hiding or rewriting the base", () => {
    const forged = {
      ...PUBLIC_ENRICHMENT,
      asset: {
        ...PUBLIC_ENRICHMENT.asset,
        address: OTHER_ADDRESS,
        name: "Attacker Coin",
      },
    } satisfies PublicPredictionMarketViewV2;
    const mismatch = enrichPredictionV2BaseMarketView(BASE_MARKET, forged);
    const html = renderPublicCard(mismatch);

    expect(mismatch.enrichment).toBeNull();
    expect(html).toContain(`<h3 title="EXAMPLE">EXAMPLE</h3>`);
    expect(html).toContain(`href="/markets/v2/${MARKET_ID}"`);
    expect(html).not.toContain("Attacker Coin");
    expect(html).not.toContain("attacker");
  });

  it("uses only content-addressed public artwork and safe enrichment links", () => {
    const html = renderPublicCard();

    expect(html).toContain('data-artwork-source="owned-provider-snapshot"');
    expect(html).toContain(
      `src="/media/prediction/sha256-${ARTWORK_DIGEST}.webp"`,
    );
    expect(html).not.toContain("cdn.dexscreener.com");
    expect(html).not.toContain("capability=");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('href="https://x.com/example"');
    expect(html).toContain('href="https://t.me/example"');
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
  });

  it.each([
    [
      "paused",
      {
        ...OPEN_LIFECYCLE,
        tradable: false,
        tradabilityReason: "checkpoint-unhealthy",
        checkpointTradingHealthy: false,
      },
      "Trading paused",
      "50%",
    ],
    [
      "closed",
      {
        ...OPEN_LIFECYCLE,
        tradingPhase: "CLOSED",
        tradable: false,
        tradabilityReason: "cutoff-reached",
      },
      "Closed",
      "50%",
    ],
    [
      "final YES",
      {
        protocolState: "FINAL_YES",
        checkpointStatus: "FINAL",
        tradingPhase: "FINAL",
        tradable: false,
        tradabilityReason: "market-final",
        checkpointTradingHealthy: false,
        resolvedPrice: 1_000_000n,
      },
      "Resolved YES",
      "100%",
    ],
    [
      "final NO",
      {
        protocolState: "FINAL_NO",
        checkpointStatus: "FINAL",
        tradingPhase: "FINAL",
        tradable: false,
        tradabilityReason: "market-final",
        checkpointTradingHealthy: false,
        resolvedPrice: 999_999n,
      },
      "Resolved NO",
      "0%",
    ],
    [
      "final invalid",
      {
        protocolState: "FINAL_INVALID",
        checkpointStatus: "INVALID",
        tradingPhase: "FINAL",
        tradable: false,
        tradabilityReason: "market-final",
        checkpointTradingHealthy: false,
        resolvedPrice: 0n,
      },
      "Invalid",
      "Not available",
    ],
  ] as const)("derives %s lifecycle and probability from the view", (
    _label,
    lifecycle,
    expectedStatus,
    expectedProbability,
  ) => {
    const html = renderPublicCard(withLifecycle(lifecycle));

    expect(html).toContain(`<dt>Status</dt><dd>${expectedStatus}</dd>`);
    expect(html).toContain(
      `<dt>Probability</dt><dd>${expectedProbability}</dd>`,
    );
  });

  it("fails a malformed base view closed without throwing", () => {
    const wrongKey = {
      ...BASE_ONLY,
      marketKey:
        `eip155:4663:${FACTORY}:0x${"99".repeat(32)}`,
    } as unknown as PredictionV2EnrichedMarketView;
    const arbitraryProbability = {
      ...BASE_ONLY,
      poolState: { ...BASE_ONLY.poolState, yesProbabilityBps: 9_999 },
    } as unknown as PredictionV2EnrichedMarketView;
    const mismatchedPreset = {
      ...BASE_ONLY,
      asset: {
        kind: "preset",
        presetId: "btc",
        sourceNetwork: "global",
        chainLabel: "Global crypto asset",
        address: null,
        explorerUrl: null,
        name: "Ethereum",
        symbol: "ETH",
      },
    } as unknown as PredictionV2EnrichedMarketView;

    for (const malformed of [
      wrongKey,
      arbitraryProbability,
      mismatchedPreset,
    ]) {
      const html = renderPublicCard(malformed);
      expect(html).toContain('data-runtime-binding="unavailable"');
      expect(html).toContain("Market unavailable");
      expect(html).toContain("<dt>Status</dt><dd>Unavailable</dd>");
      expect(html).toContain("<dt>Probability</dt><dd>Not available</dd>");
      expect(html).not.toContain("/markets/v2/");
      expect(html).not.toContain("50%");
      expect(predictionMarketAssetCardHrefV2(malformed)).toBeNull();
    }
  });

  it("keeps every 44px project link outside the primary market link", () => {
    const html = renderPublicCard();
    const marketLinkEnd = html.indexOf("</a>");
    const firstSocial = html.indexOf(
      "Example Coin Website (opens in a new tab)",
    );

    expect(marketLinkEnd).toBeGreaterThan(0);
    expect(firstSocial).toBeGreaterThan(marketLinkEnd);

    const css = readFileSync(
      join(
        process.cwd(),
        "components/prediction-market-asset-card-v2.module.css",
      ),
      "utf8",
    );
    expect(css).toMatch(
      /\.socialLink\s*\{[\s\S]*?height:\s*44px;[\s\S]*?width:\s*44px;/u,
    );
  });

  it("keeps the transient logo capability inside the create-only preview", () => {
    const html = renderToStaticMarkup(
      <PredictionMarketAssetPreviewCardV2
        headingLevel="h2"
        imageLoading="eager"
        logoProxy={LOGO_PROXY}
        profile={PROFILE}
        review={REVIEW}
      />,
    );

    expect(html).toContain('data-prediction-asset-preview-card-v2=""');
    expect(html).not.toContain("data-prediction-asset-card-v2");
    expect(html).toContain('data-profile-bound="true"');
    expect(html).toContain('data-runtime-binding="preview"');
    expect(html).toContain('data-artwork-source="preview-proxy"');
    expect(html).toContain(
      `src="/api/prediction/asset-logo/${PROVIDER_ASSET_ID}` +
        `?capability=${LOGO_CAPABILITY}"`,
    );
    expect(html).not.toContain("cdn.dexscreener.com");
    expect(html).not.toContain("/markets/v2/");
    expect(html).toContain("<dt>Status</dt><dd>Preview</dd>");
  });

  it("fails the create preview closed when the profile identity drifts", () => {
    const unboundProfile = {
      ...PROFILE,
      address: OTHER_ADDRESS,
      logoUrl: "https://attacker.example/logo.png",
      links: [{ kind: "website", url: "https://attacker.example/" }],
    } as const satisfies PredictionTokenProfileV2;
    const html = renderToStaticMarkup(
      <PredictionMarketAssetPreviewCardV2
        logoProxy={LOGO_PROXY}
        profile={unboundProfile}
        review={REVIEW}
      />,
    );
    const fallback = predictionAssetCardImageV2({
      chainId: "base",
      address: ADDRESS,
    }).source;

    expect(html).toContain('data-profile-bound="false"');
    expect(html).toContain('data-artwork-source="bundled-fallback"');
    expect(html).toContain(`src="${fallback}"`);
    expect(html).not.toContain("attacker.example");
    expect(html).not.toContain("<nav");
  });
});
