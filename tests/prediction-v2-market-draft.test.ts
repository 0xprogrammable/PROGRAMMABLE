import { describe, expect, it } from "vitest";
import { formatUnits } from "viem";

import {
  formatPredictionAssetUsdV2,
  type PredictionMarketDraftV2,
} from "../lib/prediction-market-assets-v2";
import { predictionV2RegistrySnapshotHash } from
  "../lib/prediction-v2/codec";
import {
  PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS,
  PREDICTION_V2_MAX_THRESHOLD,
  PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS,
  formatPredictionV2StrikeUsd,
  parsePredictionV2ObservationUtc,
  parsePredictionV2StrikeUsd,
  validatePredictionV2MarketDraft,
} from "../lib/prediction-v2/market-draft";
import {
  HASH_11,
  NOW,
  registrySnapshot,
} from "./prediction-v2-fixtures";

const MINUTE = 60n;
const DAY = 24n * 60n * 60n;

function utcInput(timestamp: bigint) {
  return new Date(Number(timestamp) * 1_000).toISOString().slice(0, 16);
}

function snapshotWith(input: Readonly<{
  feedDecimals?: number;
  revision?: bigint;
  validUntil?: bigint;
  active?: boolean;
}> = {}) {
  const base = registrySnapshot(input.active ?? true);
  return {
    ...base,
    revision: input.revision ?? base.revision,
    policy: {
      ...base.policy,
      feedDecimals: input.feedDecimals ?? base.policy.feedDecimals,
      validUntil: input.validUntil ?? base.policy.validUntil,
    },
  };
}

function draft(input: Readonly<{
  strikeUsd?: string;
  observationTime?: bigint;
}> = {}): PredictionMarketDraftV2 {
  return {
    schemaVersion: 2,
    asset: { mode: "preset", presetId: "btc" },
    marketType: "usd-price-at-utc",
    comparator: "greater-than-or-equal",
    quoteCurrency: "USD",
    strikeUsd: input.strikeUsd ?? "60000.125",
    observationUtc: utcInput(input.observationTime ?? NOW + 2n * DAY),
  };
}

function binding(
  snapshot = snapshotWith(),
  overrides: Readonly<{
    registryHashSnapshotResult?: typeof HASH_11;
    releaseRegistrySnapshotHash?: typeof HASH_11;
    releaseRegistryRevision?: bigint;
    nowUnixSeconds?: bigint;
  }> = {},
) {
  const snapshotHash = predictionV2RegistrySnapshotHash(snapshot);
  return {
    registrySnapshot: snapshot,
    registryHashSnapshotResult:
      overrides.registryHashSnapshotResult ?? snapshotHash,
    releaseRegistrySnapshotHash:
      overrides.releaseRegistrySnapshotHash ?? snapshotHash,
    releaseRegistryRevision:
      overrides.releaseRegistryRevision ?? snapshot.revision,
    nowUnixSeconds: overrides.nowUnixSeconds ?? NOW,
  };
}

describe("Prediction V2 USD strike codec", () => {
  it.each([6, 8, 18])(
    "parses exact positive values at %i feed decimals",
    (feedDecimals) => {
      const scale = 10n ** BigInt(feedDecimals);
      const minimum = `0.${"0".repeat(feedDecimals - 1)}1`;

      expect(parsePredictionV2StrikeUsd("123.45", feedDecimals)).toBe(
        12345n * (scale / 100n),
      );
      expect(parsePredictionV2StrikeUsd(minimum, feedDecimals)).toBe(1n);
      expect(formatPredictionV2StrikeUsd(1n, feedDecimals)).toBe(minimum);
    },
  );

  it.each([6, 8, 18])(
    "accepts int192 max and rejects max plus one at %i decimals",
    (feedDecimals) => {
      const maximum = formatUnits(
        PREDICTION_V2_MAX_THRESHOLD,
        feedDecimals,
      );
      const aboveMaximum = formatUnits(
        PREDICTION_V2_MAX_THRESHOLD + 1n,
        feedDecimals,
      );

      expect(parsePredictionV2StrikeUsd(maximum, feedDecimals)).toBe(
        PREDICTION_V2_MAX_THRESHOLD,
      );
      expect(parsePredictionV2StrikeUsd(aboveMaximum, feedDecimals)).toBeNull();
    },
  );

  it("rejects non-canonical syntax and every value that viem would round", () => {
    for (const value of [
      "",
      "0",
      "-1",
      "+1",
      "01",
      ".1",
      "1.",
      "1,000",
      "1e3",
      "NaN",
      "Infinity",
    ]) {
      expect(parsePredictionV2StrikeUsd(value, 6), value).toBeNull();
    }
    for (const roundedByParseUnits of [
      "1.0000001",
      "1.0000009",
      "1.2345678",
      "0.0000009",
    ]) {
      expect(
        parsePredictionV2StrikeUsd(roundedByParseUnits, 6),
        roundedByParseUnits,
      ).toBeNull();
    }
    expect(parsePredictionV2StrikeUsd(" 1.25 ", 6)).toBe(1_250_000n);
    expect(parsePredictionV2StrikeUsd("1", 0)).toBeNull();
    expect(parsePredictionV2StrikeUsd("1", 19)).toBeNull();
    expect(parsePredictionV2StrikeUsd("1", 6.5)).toBeNull();
    expect(() => formatPredictionV2StrikeUsd(0n, 8)).toThrow(TypeError);
    expect(() => formatPredictionV2StrikeUsd(
      PREDICTION_V2_MAX_THRESHOLD + 1n,
      8,
    )).toThrow(TypeError);
  });

  it.each([6, 8, 18])(
    "round-trips every canonical boundary at %i decimals",
    (feedDecimals) => {
      const scale = 10n ** BigInt(feedDecimals);
      for (const atoms of [
        1n,
        scale - 1n,
        scale,
        12_345n * scale + 6789n,
        PREDICTION_V2_MAX_THRESHOLD,
      ]) {
        expect(parsePredictionV2StrikeUsd(
          formatPredictionV2StrikeUsd(atoms, feedDecimals),
          feedDecimals,
        )).toBe(atoms);
      }
    },
  );
});

describe("Prediction V2 market draft release binding", () => {
  it.each([
    [6, "1.000001", 1_000_001n],
    [8, "1.00000001", 100_000_001n],
    [18, "1.000000000000000001", 1_000_000_000_000_000_001n],
  ] as const)(
    "derives threshold atoms only from the bound %i-decimal snapshot",
    (feedDecimals, strikeUsd, expectedAtoms) => {
      const snapshot = snapshotWith({ feedDecimals });
      const result = validatePredictionV2MarketDraft(
        draft({ strikeUsd }),
        binding(snapshot),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected a valid bound market draft");
      expect(result.market).toMatchObject({
        selectionKey: "preset:btc",
        onchainAssetKey: snapshot.assetKey,
        registryRevision: snapshot.revision,
        registrySnapshotHash: predictionV2RegistrySnapshotHash(snapshot),
        feedDecimals,
        thresholdAtoms: expectedAtoms,
        strikeUsd,
        policyValidUntil: snapshot.policy.validUntil,
      });
    },
  );

  it("fails closed on stale revision, Registry hash, release hash or decimals", () => {
    const eightDecimals = snapshotWith({ feedDecimals: 8, revision: 7n });
    const eightHash = predictionV2RegistrySnapshotHash(eightDecimals);
    expect(validatePredictionV2MarketDraft(
      draft({ strikeUsd: "1.00000001" }),
      binding(eightDecimals, { releaseRegistryRevision: 8n }),
    )).toMatchObject({ ok: false, errors: { binding: expect.any(String) } });
    expect(validatePredictionV2MarketDraft(
      draft({ strikeUsd: "1.00000001" }),
      binding(eightDecimals, { registryHashSnapshotResult: HASH_11 }),
    )).toMatchObject({ ok: false, errors: { binding: expect.any(String) } });
    expect(validatePredictionV2MarketDraft(
      draft({ strikeUsd: "1.00000001" }),
      binding(eightDecimals, { releaseRegistrySnapshotHash: HASH_11 }),
    )).toMatchObject({ ok: false, errors: { binding: expect.any(String) } });

    const sixDecimals = snapshotWith({ feedDecimals: 6, revision: 7n });
    expect(validatePredictionV2MarketDraft(
      draft({ strikeUsd: "1.00000001" }),
      binding(sixDecimals),
    )).toMatchObject({ ok: false, errors: { strikeUsd: expect.any(String) } });
    expect(validatePredictionV2MarketDraft(
      draft({ strikeUsd: "1.000001" }),
      {
        ...binding(sixDecimals),
        registryHashSnapshotResult: eightHash,
        releaseRegistrySnapshotHash: eightHash,
      },
    )).toMatchObject({ ok: false, errors: { binding: expect.any(String) } });
  });

  it("binds the released snapshot identity to the explicit asset selection", () => {
    expect(validatePredictionV2MarketDraft(
      {
        ...draft(),
        asset: { mode: "preset", presetId: "eth" },
      },
      binding(),
    )).toMatchObject({ ok: false, errors: { asset: expect.any(String) } });
  });
});

describe("Prediction V2 UTC market horizon", () => {
  it("requires strictly more than 24 hours and allows exactly 30 days", () => {
    const atMinimum = validatePredictionV2MarketDraft(
      draft({
        observationTime:
          NOW + PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS,
      }),
      binding(),
    );
    expect(atMinimum).toMatchObject({
      ok: false,
      errors: { observationUtc: expect.stringContaining("more than 24 hours") },
    });

    expect(validatePredictionV2MarketDraft(
      draft({
        observationTime:
          NOW + PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS + MINUTE,
      }),
      binding(),
    ).ok).toBe(true);
    expect(validatePredictionV2MarketDraft(
      draft({
        observationTime:
          NOW + PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS,
      }),
      binding(),
    ).ok).toBe(true);
    expect(validatePredictionV2MarketDraft(
      draft({
        observationTime:
          NOW + PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS + MINUTE,
      }),
      binding(),
    )).toMatchObject({
      ok: false,
      errors: { observationUtc: expect.stringContaining("no more than 30 days") },
    });
  });

  it("never creates past the bound Oracle policy validUntil", () => {
    const observationTime = NOW + 2n * DAY;
    const expiringBefore = snapshotWith({
      validUntil: observationTime - MINUTE,
    });
    const expiringAt = snapshotWith({ validUntil: observationTime });

    expect(validatePredictionV2MarketDraft(
      draft({ observationTime }),
      binding(expiringBefore),
    )).toMatchObject({
      ok: false,
      errors: { observationUtc: expect.stringContaining("expires") },
    });
    expect(validatePredictionV2MarketDraft(
      draft({ observationTime }),
      binding(expiringAt),
    ).ok).toBe(true);
  });

  it("parses only real minute-precision UTC timestamps inside uint32", () => {
    expect(parsePredictionV2ObservationUtc("2027-01-17T08:00")).toBe(
      NOW + 2n * DAY,
    );
    expect(parsePredictionV2ObservationUtc("2026-02-30T08:00")).toBeNull();
    expect(parsePredictionV2ObservationUtc("2027-01-17 08:00")).toBeNull();
    expect(parsePredictionV2ObservationUtc("2107-01-01T00:00")).toBeNull();
  });
});

describe("Prediction V2 informational price formatting", () => {
  it("never presents a positive tiny price as $0.00", () => {
    for (const value of [
      0.0000001234,
      1e-12,
      1e-18,
      1e-19,
      Number.MIN_VALUE,
    ]) {
      expect(formatPredictionAssetUsdV2(value, "price"), String(value))
        .not.toBe("$0.00");
    }
    expect(formatPredictionAssetUsdV2(0.0000001234, "price")).toBe(
      "$0.0000001234",
    );
    expect(formatPredictionAssetUsdV2(1e-19, "price")).toBe(
      "<$0.000000000000000001",
    );
    expect(formatPredictionAssetUsdV2(0, "price")).toBe("$0.00");
  });
});
