import { describe, expect, it } from "vitest";

import {
  PREDICTION_V2_CREATE_METRICS,
  PREDICTION_V2_CREATE_SOURCE_NETWORKS,
  PREDICTION_V2_CREATE_STEPS,
  PREDICTION_V2_CREATE_TEMPLATES,
  PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS,
  PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS,
  PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
  PREDICTION_V2_SETTLEMENT_CHAIN_ID,
  buildPredictionV2CreateReview,
  formatPredictionV2DecimalAtoms,
  nextPredictionV2CreateStep,
  normalizePredictionV2DetectedAssetIdentity,
  parsePredictionV2DecimalAtoms,
  predictionV2ExactUtcToUnixSeconds,
  predictionV2MarketCapTargetToPriceStrike,
  previousPredictionV2CreateStep,
  type PredictionV2CreatePrediction,
  type PredictionV2CreationReferenceSnapshot,
  type PredictionV2DetectedAsset,
  type PredictionV2PercentChangePrediction,
  type PredictionV2ReferenceMetricSnapshot,
  type PredictionV2ReferenceSupplySnapshot,
  type PredictionV2TargetPrediction,
} from "../lib/prediction-v2/create-flow-v2";

const EVM_ADDRESS = "0xAbCdEf0000000000000000000000000000001234";
const NORMALIZED_EVM_ADDRESS = EVM_ADDRESS.toLowerCase();
const OTHER_EVM_ADDRESS = "0x123456000000000000000000000000000000abcd";
const SOLANA_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CREATION_UTC = "2026-08-23T12:00:00Z";
const OBSERVATION_UTC = "2026-09-01T12:00:00Z";
const BASE_REFERENCE = "eip155:8453:block:34900000";
const SETTLEMENT_REFERENCE = "eip155:4663:block:9100000";
const CREATION_DIGEST = `0x${"11".repeat(32)}`;
const SUPPLY_DIGEST = `0x${"22".repeat(32)}`;
const METRIC_DIGEST = `0x${"33".repeat(32)}`;

const CREATION_SNAPSHOT = {
  settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
  capturedAtUtc: CREATION_UTC,
  snapshotReference: SETTLEMENT_REFERENCE,
  evidenceDigest: CREATION_DIGEST,
  verificationStatus: "verified",
} as const satisfies PredictionV2CreationReferenceSnapshot;

const BILLION_TOKEN_FIXED_SUPPLY = {
  sourceNetwork: "base",
  address: NORMALIZED_EVM_ADDRESS,
  fixedSupplyAtoms: "1000000000000000000000000000",
  tokenDecimals: 18,
  capturedAtUtc: CREATION_UTC,
  snapshotReference: BASE_REFERENCE,
  evidenceDigest: SUPPLY_DIGEST,
  verificationStatus: "verified",
  supplyDefinition: "fixed-supply-fully-circulating",
} as const satisfies PredictionV2ReferenceSupplySnapshot;

function metricSnapshot(
  metric: "price" | "market-cap",
  valueUsd: string,
  overrides: Partial<PredictionV2ReferenceMetricSnapshot> = {},
): PredictionV2ReferenceMetricSnapshot {
  return {
    metric,
    valueUsd,
    sourceNetwork: "base",
    address: NORMALIZED_EVM_ADDRESS,
    capturedAtUtc: CREATION_UTC,
    snapshotReference: BASE_REFERENCE,
    evidenceDigest: METRIC_DIGEST,
    verificationStatus: "verified",
    ...overrides,
  };
}

function asset(
  overrides: Partial<PredictionV2DetectedAsset> = {},
): PredictionV2DetectedAsset {
  return {
    identity: { sourceNetwork: "base", address: EVM_ADDRESS },
    name: "Example Coin",
    symbol: "EXAMPLE",
    referenceSupplySnapshot: BILLION_TOKEN_FIXED_SUPPLY,
    ...overrides,
  };
}

function target(
  overrides: Partial<PredictionV2TargetPrediction> = {},
): PredictionV2TargetPrediction {
  return {
    metric: "price",
    template: "target",
    targetUsd: "0.015",
    observationUtc: OBSERVATION_UTC,
    creationSnapshot: CREATION_SNAPSHOT,
    priceDecimals: PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
    ...overrides,
  };
}

function percentChange(
  metric: "price" | "market-cap",
  referenceMetricUsd: string,
  percent: string,
  overrides: Partial<PredictionV2PercentChangePrediction> = {},
): PredictionV2PercentChangePrediction {
  return {
    metric,
    template: "percent-change",
    percentChange: percent,
    referenceMetricSnapshot: metricSnapshot(metric, referenceMetricUsd),
    observationUtc: OBSERVATION_UTC,
    creationSnapshot: CREATION_SNAPSHOT,
    priceDecimals: PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
    ...overrides,
  };
}

describe("Prediction V2 progressive create-flow model", () => {
  it("exposes the bounded flow, networks and fixed protocol constants", () => {
    expect(PREDICTION_V2_CREATE_STEPS).toEqual([
      "address",
      "asset",
      "prediction",
      "review",
    ]);
    expect(PREDICTION_V2_CREATE_SOURCE_NETWORKS.map(({ id }) => id)).toEqual([
      "ethereum",
      "base",
      "bnb",
      "robinhood",
      "solana",
    ]);
    expect(PREDICTION_V2_CREATE_METRICS.map(({ id }) => id)).toEqual([
      "price",
      "market-cap",
    ]);
    expect(PREDICTION_V2_PROTOCOL_PRICE_DECIMALS).toBe(8);
    expect(PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS).toBe(86_400n);
    expect(PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS).toBe(2_592_000n);
    expect(nextPredictionV2CreateStep("address")).toBe("asset");
    expect(nextPredictionV2CreateStep("review")).toBe("review");
    expect(previousPredictionV2CreateStep("review")).toBe("prediction");
    expect(previousPredictionV2CreateStep("address")).toBe("address");
  });

  it.each(["ethereum", "base", "bnb", "robinhood"] as const)(
    "binds a detected %s asset to its chain and canonical EVM address",
    (sourceNetwork) => {
      expect(normalizePredictionV2DetectedAssetIdentity({
        sourceNetwork,
        address: EVM_ADDRESS,
      })).toEqual({ sourceNetwork, address: NORMALIZED_EVM_ADDRESS });
    },
  );

  it("accepts a nonzero 32-byte Solana address and rejects cross-namespace input", () => {
    expect(normalizePredictionV2DetectedAssetIdentity({
      sourceNetwork: "solana",
      address: SOLANA_ADDRESS,
    })).toEqual({ sourceNetwork: "solana", address: SOLANA_ADDRESS });
    expect(normalizePredictionV2DetectedAssetIdentity({
      sourceNetwork: "base",
      address: SOLANA_ADDRESS,
    })).toBeNull();
    expect(normalizePredictionV2DetectedAssetIdentity({
      sourceNetwork: "solana",
      address: EVM_ADDRESS,
    })).toBeNull();
    expect(normalizePredictionV2DetectedAssetIdentity({
      sourceNetwork: "solana",
      address: "1".repeat(32),
    })).toBeNull();
  });

  it("keeps reach visible but disabled", () => {
    expect(PREDICTION_V2_CREATE_TEMPLATES).toEqual([
      { id: "target", label: "Target", enabled: true },
      { id: "percent-change", label: "Percentage change", enabled: true },
      {
        id: "reach",
        label: "Reach before deadline",
        enabled: false,
        reason: expect.stringContaining("continuous-observation"),
      },
    ]);
    expect(buildPredictionV2CreateReview(asset(), {
      ...target(),
      template: "reach",
      targetUsd: "0.02",
    })).toMatchObject({
      ok: false,
      errors: { template: expect.stringContaining("not enabled") },
    });
  });
});

describe("Prediction V2 exact protocol-value derivation", () => {
  it("builds an explicit 8-decimal >= USD-price predicate with evidence binding", () => {
    const result = buildPredictionV2CreateReview(asset(), target());

    expect(result).toEqual({
      ok: true,
      review: {
        schemaVersion: 2,
        asset: { sourceNetwork: "base", address: NORMALIZED_EVM_ADDRESS },
        assetName: "Example Coin",
        assetSymbol: "EXAMPLE",
        selectedMetric: "price",
        template: "target",
        metricTargetUsd: "0.015",
        inputTargetUsd: "0.015",
        percentChange: null,
        referenceMetricUsd: null,
        creationSnapshot: CREATION_SNAPSHOT,
        referenceMetricSnapshot: null,
        referenceSupplySnapshot: null,
        protocolPredicate: {
          metric: "usd-price",
          comparator: "greater-than-or-equal",
          quoteCurrency: "USD",
          strikeUsd: "0.015",
          strikeAtoms: "1500000",
          priceDecimals: 8,
          observationUtc: OBSERVATION_UTC,
          observationUnixSeconds: "1788264000",
          timezone: "UTC",
          evidenceBinding: {
            creationSnapshot: CREATION_SNAPSHOT,
            referenceMetricSnapshot: null,
            referenceSupplySnapshot: null,
          },
        },
        settlementEligibility: "not-evaluated",
      },
    });
    if (!result.ok) throw new Error("expected valid create review");
    expect(() => JSON.stringify(result.review)).not.toThrow();
    expect(JSON.stringify(result.review)).not.toContain("settlementEligible");
  });

  it("derives a positive percentage threshold only from a verified baseline", () => {
    const baseline = metricSnapshot("price", "1.25");
    const result = buildPredictionV2CreateReview(asset(), percentChange(
      "price",
      "1.25",
      "20.00",
      { referenceMetricSnapshot: baseline },
    ));

    expect(result).toMatchObject({
      ok: true,
      review: {
        selectedMetric: "price",
        template: "percent-change",
        metricTargetUsd: "1.5",
        inputTargetUsd: null,
        percentChange: "20",
        referenceMetricUsd: "1.25",
        referenceMetricSnapshot: baseline,
        protocolPredicate: {
          comparator: "greater-than-or-equal",
          strikeUsd: "1.5",
          strikeAtoms: "150000000",
          evidenceBinding: { referenceMetricSnapshot: baseline },
        },
      },
    });
  });

  it("converts an exact market-cap target using only fixed fully circulating supply", () => {
    const result = buildPredictionV2CreateReview(asset(), target({
      metric: "market-cap",
      targetUsd: "10000000",
    }));

    expect(result).toMatchObject({
      ok: true,
      review: {
        selectedMetric: "market-cap",
        metricTargetUsd: "10000000",
        referenceSupplySnapshot: BILLION_TOKEN_FIXED_SUPPLY,
        protocolPredicate: {
          metric: "usd-price",
          comparator: "greater-than-or-equal",
          strikeUsd: "0.01",
          strikeAtoms: "1000000",
          evidenceBinding: {
            referenceSupplySnapshot: BILLION_TOKEN_FIXED_SUPPLY,
          },
        },
        settlementEligibility: "not-evaluated",
      },
    });
    if (!result.ok) throw new Error("expected exact market-cap review");
    expect(result.review.creationSnapshot.snapshotReference)
      .toBe(SETTLEMENT_REFERENCE);
    expect(result.review.referenceSupplySnapshot?.snapshotReference)
      .toBe(BASE_REFERENCE);
    expect(result.review.referenceSupplySnapshot?.snapshotReference)
      .not.toBe(result.review.creationSnapshot.snapshotReference);
  });

  it("supports an exactly representable positive market-cap percentage threshold", () => {
    const result = buildPredictionV2CreateReview(
      asset(),
      percentChange("market-cap", "8000000", "25"),
    );
    expect(result).toMatchObject({
      ok: true,
      review: {
        metricTargetUsd: "10000000",
        protocolPredicate: { strikeUsd: "0.01", strikeAtoms: "1000000" },
      },
    });
  });

  it("requires exact market-cap representation instead of ceiling the target", () => {
    const threeTokenSupply = {
      ...BILLION_TOKEN_FIXED_SUPPLY,
      fixedSupplyAtoms: "3",
      tokenDecimals: 0,
    } as const;
    expect(predictionV2MarketCapTargetToPriceStrike(
      "1",
      threeTokenSupply,
      PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
    )).toBeNull();
    expect(predictionV2MarketCapTargetToPriceStrike(
      "3",
      threeTokenSupply,
      PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
    )).toEqual({ strikeAtoms: "100000000", strikeUsd: "1" });
    expect(predictionV2MarketCapTargetToPriceStrike(
      "3",
      threeTokenSupply,
      18,
    )).toBeNull();
  });

  it("round-trips exact decimal atoms without Number-based protocol math", () => {
    expect(parsePredictionV2DecimalAtoms("123.00000001", 8)).toBe(
      12_300_000_001n,
    );
    expect(formatPredictionV2DecimalAtoms(12_300_000_001n, 8)).toBe(
      "123.00000001",
    );
    expect(parsePredictionV2DecimalAtoms("0.000000001", 8)).toBeNull();
  });
});

describe("Prediction V2 fail-closed precision and direction", () => {
  it.each(["0", "-0", "-20", "-99.99", "-100"])(
    "rejects non-upward percentage %s under the >= predicate",
    (percent) => {
      expect(buildPredictionV2CreateReview(
        asset(),
        percentChange("price", "100", percent),
      )).toMatchObject({
        ok: false,
        errors: { percentChange: expect.stringContaining("positive upward") },
      });
    },
  );

  it("rejects percentage precision drift instead of silently rounding upward", () => {
    expect(buildPredictionV2CreateReview(
      asset(),
      percentChange("price", "0.00000001", "50"),
    )).toMatchObject({
      ok: false,
      errors: { precision: expect.stringContaining("exact target") },
    });
  });

  it("rejects amplified market-cap tick drift for high-supply tokens", () => {
    const hugeSupply = {
      ...BILLION_TOKEN_FIXED_SUPPLY,
      fixedSupplyAtoms: "1000000000000000000000000000000000",
    } as const;
    expect(buildPredictionV2CreateReview(
      asset({ referenceSupplySnapshot: hugeSupply }),
      target({ metric: "market-cap", targetUsd: "100000" }),
    )).toMatchObject({
      ok: false,
      errors: { precision: expect.stringContaining("exact market-cap target") },
    });
  });

  it.each([1, 7, 9, 18])(
    "rejects %i price decimals because the current protocol is fixed at 8",
    (priceDecimals) => {
      expect(buildPredictionV2CreateReview(
        asset(),
        { ...target(), priceDecimals } as unknown as PredictionV2CreatePrediction,
      )).toMatchObject({
        ok: false,
        errors: { priceDecimals: expect.stringContaining("exactly 8") },
      });
    },
  );

  it("rejects a direct price target that needs more than 8 decimals", () => {
    expect(buildPredictionV2CreateReview(
      asset(),
      target({ targetUsd: "0.000000001" }),
    )).toMatchObject({
      ok: false,
      errors: { precision: expect.stringContaining("8-decimal") },
    });
  });
});

describe("Prediction V2 immutable snapshot bindings", () => {
  it.each([
    ["wrong chain", { settlementChainId: "8453" }],
    ["wrong reference", { snapshotReference: "eip155:8453:block:9100000" }],
    ["oversized block", {
      snapshotReference: "eip155:4663:block:18446744073709551616",
    }],
    ["zero digest", { evidenceDigest: `0x${"0".repeat(64)}` }],
    ["uppercase digest", { evidenceDigest: `0x${"AA".repeat(32)}` }],
    ["unverified", { verificationStatus: "unverified" }],
  ] as const)("rejects a %s creation snapshot", (_label, overrides) => {
    expect(buildPredictionV2CreateReview(
      asset(),
      target({
        creationSnapshot: {
          ...CREATION_SNAPSHOT,
          ...overrides,
        } as unknown as PredictionV2CreationReferenceSnapshot,
      }),
    )).toMatchObject({
      ok: false,
      errors: { creationSnapshot: expect.any(String) },
    });
  });

  it.each([
    [null, "missing"],
    [{ ...BILLION_TOKEN_FIXED_SUPPLY, fixedSupplyAtoms: "0" }, "zero"],
    [{ ...BILLION_TOKEN_FIXED_SUPPLY, fixedSupplyAtoms: "01" }, "noncanonical"],
    [{ ...BILLION_TOKEN_FIXED_SUPPLY, fixedSupplyAtoms: [123] }, "coerced array"],
    [{ ...BILLION_TOKEN_FIXED_SUPPLY, sourceNetwork: "ethereum" }, "wrong chain"],
    [{ ...BILLION_TOKEN_FIXED_SUPPLY, address: OTHER_EVM_ADDRESS }, "wrong token"],
    [{ ...BILLION_TOKEN_FIXED_SUPPLY, capturedAtUtc: "2026-08-23T11:59:59Z" }, "stale"],
    [{ ...BILLION_TOKEN_FIXED_SUPPLY, snapshotReference: "eip155:1:block:34899999" }, "wrong chain reference"],
    [{ ...BILLION_TOKEN_FIXED_SUPPLY, evidenceDigest: `0x${"0".repeat(64)}` }, "zero digest"],
    [{ ...BILLION_TOKEN_FIXED_SUPPLY, verificationStatus: "unverified" }, "unverified"],
    [{
      ...BILLION_TOKEN_FIXED_SUPPLY,
      supplyDefinition: "circulating-at-creation",
    }, "mutable circulating supply"],
  ] as ReadonlyArray<readonly [unknown, string]>)(
    "rejects %s fixed-supply evidence",
    (snapshot, label) => {
      const result = buildPredictionV2CreateReview(
        asset({
          referenceSupplySnapshot:
            snapshot as PredictionV2ReferenceSupplySnapshot | null,
        }),
        target({ metric: "market-cap", targetUsd: "10000000" }),
      );
      expect(result, label).toMatchObject({
        ok: false,
        errors: { referenceSupplySnapshot: expect.any(String) },
      });
    },
  );

  it.each([
    ["wrong metric", { metric: "market-cap" }],
    ["wrong chain", { sourceNetwork: "ethereum" }],
    ["wrong token", { address: OTHER_EVM_ADDRESS }],
    ["stale time", { capturedAtUtc: "2026-08-23T11:59:59Z" }],
    ["wrong reference", { snapshotReference: "eip155:1:block:34899999" }],
    ["zero digest", { evidenceDigest: `0x${"0".repeat(64)}` }],
    ["unverified", { verificationStatus: "unverified" }],
  ] as const)("rejects a %s percentage baseline", (_label, overrides) => {
    expect(buildPredictionV2CreateReview(
      asset(),
      percentChange("price", "1", "20", {
        referenceMetricSnapshot: {
          ...metricSnapshot("price", "1"),
          ...overrides,
        } as unknown as PredictionV2ReferenceMetricSnapshot,
      }),
    )).toMatchObject({
      ok: false,
      errors: { referenceMetricSnapshot: expect.any(String) },
    });
  });

  it("rejects a raw, unauthenticated percentage baseline", () => {
    const prediction = {
      ...percentChange("price", "1", "20"),
      referenceMetricSnapshot: undefined,
      referenceMetricUsd: "1",
    } as unknown as PredictionV2CreatePrediction;
    expect(buildPredictionV2CreateReview(asset(), prediction)).toMatchObject({
      ok: false,
      errors: { referenceMetricSnapshot: expect.any(String) },
    });
  });
});

describe("Prediction V2 deadline and protocol bounds", () => {
  it("matches the Factory's strict >24h and inclusive <=30d boundaries", () => {
    expect(buildPredictionV2CreateReview(
      asset(),
      target({ observationUtc: "2026-08-24T12:00:00Z" }),
    )).toMatchObject({
      ok: false,
      errors: { observationUtc: expect.stringContaining("more than 24 hours") },
    });
    expect(buildPredictionV2CreateReview(
      asset(),
      target({ observationUtc: "2026-08-24T12:00:01Z" }),
    ).ok).toBe(true);
    expect(buildPredictionV2CreateReview(
      asset(),
      target({ observationUtc: "2026-09-22T12:00:00Z" }),
    ).ok).toBe(true);
    expect(buildPredictionV2CreateReview(
      asset(),
      target({ observationUtc: "2026-09-22T12:00:01Z" }),
    )).toMatchObject({
      ok: false,
      errors: { observationUtc: expect.stringContaining("no more than 30 days") },
    });
  });

  it("rejects malformed UTC, invalid calendar dates and unsupported uint32 time", () => {
    for (const observationUtc of [
      "2026-09-01T12:00",
      "2026-09-01T14:00:00+02:00",
      "2026-02-30T18:00:00Z",
      "2107-01-01T00:00:00Z",
    ]) {
      expect(predictionV2ExactUtcToUnixSeconds(observationUtc)).toBeNull();
      expect(buildPredictionV2CreateReview(
        asset(),
        target({ observationUtc }),
      )).toMatchObject({
        ok: false,
        errors: { observationUtc: expect.any(String) },
      });
    }
    expect(predictionV2ExactUtcToUnixSeconds("2106-02-07T06:28:15Z"))
      .toBe("4294967295");
    expect(predictionV2ExactUtcToUnixSeconds("2106-02-07T06:28:16Z"))
      .toBeNull();
  });

  it("rejects invalid identity, malformed decimals and unsupported runtime enums", () => {
    expect(buildPredictionV2CreateReview(
      asset({
        identity: { sourceNetwork: "base", address: `0x${"0".repeat(40)}` },
      }),
      target(),
    )).toMatchObject({ ok: false, errors: { asset: expect.any(String) } });

    for (const targetUsd of ["0", "-1", "+1", "01", "1e3", "NaN"] as const) {
      expect(buildPredictionV2CreateReview(
        asset(),
        target({ targetUsd }),
      )).toMatchObject({ ok: false, errors: { targetUsd: expect.any(String) } });
    }

    expect(buildPredictionV2CreateReview(
      asset(),
      { ...target(), metric: "volume" } as unknown as PredictionV2CreatePrediction,
    )).toMatchObject({
      ok: false,
      errors: { metric: expect.any(String) },
    });
  });

  it("returns byte-for-byte deterministic JSON-safe review data", () => {
    const first = buildPredictionV2CreateReview(asset(), target({
      metric: "market-cap",
      targetUsd: "10000000.00",
    }));
    const second = buildPredictionV2CreateReview(asset(), target({
      metric: "market-cap",
      targetUsd: "10000000.00",
    }));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
