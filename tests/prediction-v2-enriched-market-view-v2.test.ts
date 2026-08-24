import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import {
  enrichPredictionV2BaseMarketView,
} from "../lib/prediction-v2/enriched-market-view-v2";
import type { PredictionV2BaseMarketView } from
  "../lib/prediction-v2/base-market-view-v2";
import type { PublicPredictionMarketViewV2 } from
  "../lib/prediction-v2/public-market-view-v2";

const ADDRESS = getAddress(`0x${"ab".repeat(20)}`).toLowerCase();
const FACTORY = getAddress(`0x${"12".repeat(20)}`).toLowerCase();
const MARKET_ID = `0x${"22".repeat(32)}` as const;
const ECONOMIC_KEY = `0x${"21".repeat(32)}` as const;
const ASSET_KEY = `0x${"26".repeat(32)}` as const;
const BLOCK_HASH = `0x${"24".repeat(32)}` as const;
const MARKET_KEY = `eip155:4663:${FACTORY}:${ECONOMIC_KEY}` as const;

const BASE = Object.freeze({
  schemaVersion: 2,
  source: "dual-rpc-onchain",
  marketKey: MARKET_KEY,
  marketId: MARKET_ID,
  economicKey: ECONOMIC_KEY,
  asset: {
    kind: "token",
    presetId: null,
    sourceNetwork: "base",
    chainLabel: "Base",
    address: ADDRESS,
    explorerUrl: `https://basescan.org/token/${ADDRESS}`,
    name: null,
    symbol: "EXAMPLE",
  },
  condition: {
    kind: "usd-price-at-utc",
    metric: "usd-price",
    comparator: "greater-than-or-equal",
    quoteCurrency: "USD",
    strikeAtoms: "1500000",
    priceDecimals: 8,
    observationUnixSeconds: "1788264000",
    observationUtc: "2026-09-01T12:00:00.000Z",
    oracleSnapshotRule: {
      source: "chainlink-data-feed",
      winningPrice: "latest-completed-round-at-or-before-observation",
      requiredAfterRound: "first-completed-round-after-observation",
      maximumBeforeAgeSeconds: "90000",
      maximumAfterDelaySeconds: "90000",
    },
  },
  lifecycle: {
    protocolState: "OPEN",
    checkpointStatus: "AWAITING",
    tradingPhase: "OPEN",
    tradable: true,
    tradabilityReason: "tradable",
    checkpointTradingHealthy: true,
    resolvedPrice: 0n,
  },
  poolState: {
    sqrtPriceX96: 1n,
    tick: 0,
    poolManagerProtocolFee: 0,
    lpFee: 200,
    yesProbabilityBps: 5000,
  },
  artwork: { kind: "bundled-fallback", url: "/brand/fallback.webp" },
  links: [],
  onchain: {
    releaseId: "prediction-v2.release-1",
    settlementChainId: 4663,
    factoryAddress: FACTORY,
    factoryRuntimeCodeHash: `0x${"41".repeat(32)}`,
    assetKey: ASSET_KEY,
    registryRevision: "7",
    registrySnapshotHash: `0x${"23".repeat(32)}`,
    resolutionPolicyHash: `0x${"28".repeat(32)}`,
    vaultAddress: getAddress(`0x${"13".repeat(20)}`).toLowerCase(),
    checkpointAddress: getAddress(`0x${"14".repeat(20)}`).toLowerCase(),
    poolId: `0x${"27".repeat(32)}`,
    confirmedBlockNumber: "9100020",
    confirmedBlockHash: BLOCK_HASH,
  },
} as const satisfies PredictionV2BaseMarketView);

function enrichment(): PublicPredictionMarketViewV2 {
  return {
    schemaVersion: 2,
    marketKey: MARKET_KEY,
    marketId: MARKET_ID,
    asset: {
      sourceNetwork: "base",
      chainLabel: "Base",
      address: ADDRESS,
      name: "Example Coin",
      symbol: "EXAMPLE",
      explorerUrl: `https://basescan.org/token/${ADDRESS}`,
    },
    condition: {
      kind: "usd-price-at-utc",
      metric: "usd-price",
      comparator: "greater-than-or-equal",
      quoteCurrency: "USD",
      strikeUsd: "0.015",
      strikeAtoms: "1500000",
      priceDecimals: 8,
      observationUtc: "2026-09-01T12:00:00.000Z",
      observationUnixSeconds: "1788264000",
      timezone: "UTC",
    },
    creationIntent: null,
    artwork: {
      kind: "bundled-fallback",
      url: "/brand/programmable-token-fallback-01-dawn.webp",
      digest: `sha256:${"11".repeat(32)}`,
      contentType: "image/webp",
      sourceAssetId: null,
    },
    links: [],
    presentation: {
      revision: "1",
      revisionHash: `sha256:${"12".repeat(32)}`,
      observedAt: "2026-08-24T12:00:00.000Z",
    },
    attestedProjection: {
      releaseId: BASE.onchain.releaseId,
      settlementChainId: "4663",
      factoryAddress: FACTORY,
      factoryRuntimeCodeHash: BASE.onchain.factoryRuntimeCodeHash,
      economicKey: ECONOMIC_KEY,
      onchainAssetKey: ASSET_KEY,
      registryRevision: "7",
      registrySnapshotHash: BASE.onchain.registrySnapshotHash,
      confirmedBlockNumber: "9100020",
      confirmedBlockHash: BLOCK_HASH,
      attestorAddress: getAddress(`0x${"42".repeat(20)}`).toLowerCase(),
    },
  };
}

describe("Prediction V2 optional market enrichment", () => {
  it("adds exact-bound display data without replacing onchain fields", () => {
    const result = enrichPredictionV2BaseMarketView(BASE, enrichment());
    expect(result.enrichment?.name).toBe("Example Coin");
    expect(result.condition).toBe(BASE.condition);
    expect(result.onchain).toBe(BASE.onchain);
  });

  it("drops stale or forged enrichment without hiding the base market", () => {
    const original = enrichment();
    const forged = {
      ...original,
      attestedProjection: {
        ...original.attestedProjection,
        confirmedBlockHash: `0x${"ff".repeat(32)}`,
      },
    } satisfies PublicPredictionMarketViewV2;
    const result = enrichPredictionV2BaseMarketView(BASE, forged);
    expect(result.enrichment).toBeNull();
    expect(result.marketId).toBe(MARKET_ID);
    expect(result.asset.symbol).toBe("EXAMPLE");
  });

  it("does not require enrichment", () => {
    expect(enrichPredictionV2BaseMarketView(BASE, null).enrichment).toBeNull();
  });
});
