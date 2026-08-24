import { describe, expect, it } from "vitest";

import {
  evaluatePredictionAssetDiscoveryEligibilityV2,
  PREDICTION_ASSET_DISCOVERY_SCOPE_V2,
  PREDICTION_ASSET_DISCOVERY_THRESHOLDS_V2,
  type PredictionAssetMarketCapSupplyEvidenceV2,
} from "../lib/prediction-v2/asset-eligibility-v2";
import {
  normalizePredictionTokenProfileV2,
  type PredictionTokenProfileV2,
} from "../lib/prediction-v2/token-profile-v2";

const ADDRESS = `0x${"ab".repeat(20)}`;
const OBSERVED_AT_MS = Date.parse("2026-08-23T18:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

function profile(
  overrides: Readonly<Record<string, unknown>> = {},
): PredictionTokenProfileV2 {
  const normalized = normalizePredictionTokenProfileV2({
    chain: "base",
    address: ADDRESS,
    priceUsd: 0.000_001,
    marketCapUsd: 1_000_000,
    fdvUsd: 9_000_000,
    liquidityUsd: 50_000,
    pairCreatedAtMs: OBSERVED_AT_MS - DAY_MS,
    ...overrides,
  }, OBSERVED_AT_MS);
  if (!normalized) throw new Error("test profile must normalize");
  return normalized;
}

function supplyEvidence(
  overrides: Partial<PredictionAssetMarketCapSupplyEvidenceV2> = {},
): PredictionAssetMarketCapSupplyEvidenceV2 {
  return {
    schemaVersion: 2,
    kind: "fixed-supply-fully-circulating",
    chainReference: "8453",
    tokenAddress: ADDRESS,
    supplyBaseUnits: "1000000000000000",
    decimals: 9,
    immutable: true,
    verification: {
      status: "verified",
      method: "verified-fixed-supply-fully-circulating",
      chainStateReference: "34567890",
      evidenceDigest: `0x${"12".repeat(32)}`,
    },
    ...overrides,
  };
}

describe("prediction asset discovery eligibility v2", () => {
  it("passes every beta boundary and enables fixed fully-circulating market cap", () => {
    const result = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile(),
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: 25_000,
      marketCapSupplyEvidence: supplyEvidence(),
    });

    expect(result).toEqual({
      schemaVersion: 2,
      scope: "discovery-quality-only",
      status: "eligible",
      observedAt: "2026-08-23T18:00:00.000Z",
      reasonCodes: [],
      thresholds: {
        minimumPoolAgeSeconds: 86_400,
        minimumLiquidityUsd: 50_000,
        minimumVolume24hUsd: 25_000,
      },
      observed: {
        priceUsd: 0.000_001,
        poolAgeSeconds: 86_400,
        liquidityUsd: 50_000,
        volume24hUsd: 25_000,
      },
      metrics: {
        price: { available: true, reasonCodes: [] },
        marketCap: { available: true, reasonCodes: [] },
      },
    });
    expect(result.scope).toBe(PREDICTION_ASSET_DISCOVERY_SCOPE_V2);
    expect(result.thresholds).toBe(PREDICTION_ASSET_DISCOVERY_THRESHOLDS_V2);
    expect(result).not.toHaveProperty("settlementEligible");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reasonCodes)).toBe(true);
    expect(Object.isFrozen(result.observed)).toBe(true);
    expect(Object.isFrozen(result.metrics.marketCap.reasonCodes)).toBe(true);
  });

  it.each([
    {
      label: "pool age",
      profile: () => profile({ pairCreatedAtMs: OBSERVED_AT_MS - DAY_MS + 1 }),
      volume24hUsd: 25_000,
      reason: "pool-too-new",
    },
    {
      label: "liquidity",
      profile: () => profile({ liquidityUsd: 49_999.99 }),
      volume24hUsd: 25_000,
      reason: "liquidity-below-minimum",
    },
    {
      label: "24h volume",
      profile: () => profile(),
      volume24hUsd: 24_999.99,
      reason: "volume-24h-below-minimum",
    },
  ])("fails one deterministic unit below the $label boundary", ({
    profile: buildProfile,
    volume24hUsd,
    reason,
  }) => {
    const result = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: buildProfile(),
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd,
    });
    expect(result.status).toBe("ineligible");
    expect(result.reasonCodes).toEqual([reason]);
  });

  it("keeps missing values unknown instead of coercing them to zero", () => {
    const result = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile({
        priceUsd: null,
        liquidityUsd: null,
        pairCreatedAtMs: null,
        marketCapUsd: null,
      }),
      observedAtMs: OBSERVED_AT_MS,
    });

    expect(result.status).toBe("unknown");
    expect(result.reasonCodes).toEqual([
      "price-unavailable",
      "pool-age-unavailable",
      "liquidity-unavailable",
      "volume-24h-unavailable",
    ]);
    expect(result.observed).toEqual({
      priceUsd: null,
      poolAgeSeconds: null,
      liquidityUsd: null,
      volume24hUsd: null,
    });
  });

  it("treats explicit zero liquidity and volume as known ineligibility", () => {
    const result = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile({ liquidityUsd: 0 }),
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: 0,
    });

    expect(result.status).toBe("ineligible");
    expect(result.reasonCodes).toEqual([
      "liquidity-below-minimum",
      "volume-24h-below-minimum",
    ]);
    expect(result.observed.liquidityUsd).toBe(0);
    expect(result.observed.volume24hUsd).toBe(0);
  });

  it("defensively treats an explicit zero price as known ineligibility", () => {
    const result = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: { ...profile(), priceUsd: 0 },
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: 25_000,
    });

    expect(result.status).toBe("ineligible");
    expect(result.reasonCodes).toEqual(["price-not-positive"]);
    expect(result.observed.priceUsd).toBe(0);
    expect(result.metrics.price).toEqual({
      available: false,
      reasonCodes: ["price-not-positive"],
    });
  });

  it("lets a known failed check dominate unrelated unknown checks", () => {
    const result = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile({ priceUsd: null, liquidityUsd: 0 }),
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: null,
    });

    expect(result.status).toBe("ineligible");
    expect(result.reasonCodes).toEqual([
      "price-unavailable",
      "liquidity-below-minimum",
      "volume-24h-unavailable",
    ]);
  });

  it("keeps market cap unavailable until exact fixed-supply evidence exists", () => {
    const withoutEvidence = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile(),
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: 25_000,
    });
    expect(withoutEvidence.status).toBe("eligible");
    expect(withoutEvidence.metrics.marketCap).toEqual({
      available: false,
      reasonCodes: ["market-cap-supply-evidence-unavailable"],
    });

    const wrongIdentity = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile(),
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: 25_000,
      marketCapSupplyEvidence: supplyEvidence({ chainReference: "1" }),
    });
    expect(wrongIdentity.status).toBe("eligible");
    expect(wrongIdentity.metrics.marketCap).toEqual({
      available: false,
      reasonCodes: ["market-cap-supply-evidence-invalid"],
    });

    const unauthenticated = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile(),
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: 25_000,
      marketCapSupplyEvidence: {
        ...supplyEvidence(),
        verification: {
          ...supplyEvidence().verification,
          evidenceDigest: "self-asserted",
        },
      },
    });
    expect(unauthenticated.metrics.marketCap).toEqual({
      available: false,
      reasonCodes: ["market-cap-supply-evidence-invalid"],
    });
  });

  it("keeps a valid circulating-supply snapshot calculator-only", () => {
    const fixedEvidence = supplyEvidence();
    const result = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile(),
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: 25_000,
      marketCapSupplyEvidence: {
        ...fixedEvidence,
        kind: "immutable-circulating-supply",
        verification: {
          ...fixedEvidence.verification,
          method: "verified-immutable-circulating-supply",
        },
      },
    });

    expect(result.status).toBe("eligible");
    expect(result.metrics.marketCap).toEqual({
      available: false,
      reasonCodes: ["market-cap-fixed-supply-required"],
    });
  });

  it.each([
    {
      label: "token identity",
      value: {
        ...supplyEvidence(),
        tokenAddress: `0x${"cd".repeat(20)}`,
      },
    },
    {
      label: "kind-bound verification method",
      value: {
        ...supplyEvidence(),
        kind: "immutable-circulating-supply",
      },
    },
    {
      label: "chain state reference",
      value: {
        ...supplyEvidence(),
        verification: {
          ...supplyEvidence().verification,
          chainStateReference: "latest",
        },
      },
    },
    {
      label: "zero evidence digest",
      value: {
        ...supplyEvidence(),
        verification: {
          ...supplyEvidence().verification,
          evidenceDigest: `0x${"00".repeat(32)}`,
        },
      },
    },
    {
      label: "runtime JSON types",
      value: {
        ...supplyEvidence(),
        supplyBaseUnits: [123],
        verification: {
          ...supplyEvidence().verification,
          chainStateReference: [34_567_890],
          evidenceDigest: [`0x${"12".repeat(32)}`],
        },
      },
    },
  ])("rejects supply evidence with an invalid $label binding", ({ value }) => {
    const result = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile(),
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: 25_000,
      marketCapSupplyEvidence:
        value as unknown as PredictionAssetMarketCapSupplyEvidenceV2,
    });

    expect(result.metrics.marketCap).toEqual({
      available: false,
      reasonCodes: ["market-cap-supply-evidence-invalid"],
    });
  });

  it("never relabels FDV as market cap even when fixed-supply evidence exists", () => {
    const result = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile({ marketCapUsd: null, fdvUsd: 9_000_000 }),
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: 25_000,
      marketCapSupplyEvidence: supplyEvidence({
        kind: "fixed-supply-fully-circulating",
        verification: {
          ...supplyEvidence().verification,
          method: "verified-fixed-supply-fully-circulating",
        },
      }),
    });

    expect(result.status).toBe("eligible");
    expect(result.metrics.marketCap).toEqual({
      available: false,
      reasonCodes: ["market-cap-unavailable"],
    });
  });

  it("recomputes age at the explicit observation time rather than trusting cached seconds", () => {
    const sourceProfile = profile({
      pairCreatedAtMs: OBSERVED_AT_MS - DAY_MS,
    });
    const staleAgeProfile = {
      ...sourceProfile,
      age: {
        ...sourceProfile.age!,
        seconds: 0,
      },
    };
    const result = evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: staleAgeProfile,
      observedAtMs: OBSERVED_AT_MS,
      volume24hUsd: 25_000,
    });

    expect(result.status).toBe("eligible");
    expect(result.observed.poolAgeSeconds).toBe(86_400);
  });

  it("rejects a nondeterministic observation timestamp", () => {
    expect(() => evaluatePredictionAssetDiscoveryEligibilityV2({
      profile: profile(),
      observedAtMs: Number.NaN,
      volume24hUsd: 25_000,
    })).toThrow(TypeError);
  });
});
