import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";

import {
  PREDICTION_BOOTSTRAP_USDG_ATOMS,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_USDG_ADDRESS,
  buildUsdgPermitTypedData,
  defaultPredictionObservationUtc,
  encodePredictionMarketCreation,
  formatPredictionCountdown,
  parseBtcUsdThreshold,
  parseUtcObservation,
  validatePredictionMarketDraft,
} from "../lib/prediction-market";

const nowMs = Date.UTC(2026, 7, 22, 12, 0, 0);
const owner = "0x1111111111111111111111111111111111111111";
const factory = "0x2222222222222222222222222222222222222222";

describe("BTC prediction market launch model", () => {
  it("parses the Chainlink 8-decimal threshold without floating point", () => {
    expect(parseBtcUsdThreshold("60000")).toBe(6_000_000_000_000n);
    expect(parseBtcUsdThreshold("60000.125")).toBe(6_000_012_500_000n);
    expect(parseBtcUsdThreshold("0")).toBeNull();
    expect(parseBtcUsdThreshold("1.000000001")).toBeNull();
    expect(parseBtcUsdThreshold("6e4")).toBeNull();
  });

  it("treats the date-time input as UTC and rejects normalized dates", () => {
    expect(parseUtcObservation("2026-08-24T13:30")).toBe(1_787_578_200);
    expect(parseUtcObservation("2026-02-30T13:30")).toBeNull();
    expect(parseUtcObservation("2026-08-24 13:30")).toBeNull();
    expect(parseUtcObservation("1969-12-31T23:59")).toBeNull();
  });

  it("requires strictly more than 24 hours and derives the exact cutoff", () => {
    const boundary = validatePredictionMarketDraft(
      { observationUtc: "2026-08-23T12:00", thresholdUsd: "60000" },
      nowMs,
    );
    const valid = validatePredictionMarketDraft(
      { observationUtc: "2026-08-23T12:01", thresholdUsd: "60000.125" },
      nowMs,
    );

    expect(boundary).toEqual({
      ok: false,
      errors: {
        observationUtc: "The result time must be more than 24 hours from now.",
      },
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error("Expected valid prediction market");
    expect(valid.market.cutoffTime).toBe(valid.market.observationTime - 60);
    expect(valid.market.thresholdLabel).toBe("$60,000.125");
    expect(valid.market.marketTitle).toBe(
      "Will BTC/USD be at or above $60,000.125 at 2026-08-23 12:01 UTC?",
    );
  });

  it("uses a stable UTC default and human countdown", () => {
    expect(defaultPredictionObservationUtc(nowMs)).toBe("2026-08-24T12:00");
    expect(formatPredictionCountdown(1_787_576_400, nowMs)).toBe(
      "2 days 1 hour",
    );
  });

  it("builds the exact Global Dollar permit domain and fixed seed", () => {
    const typedData = buildUsdgPermitTypedData({
      deadline: 1_800_000_000n,
      factoryAddress: factory,
      nonce: 7n,
      owner,
    });

    expect(typedData.domain).toEqual({
      chainId: ROBINHOOD_CHAIN_ID,
      name: "Global Dollar",
      verifyingContract: ROBINHOOD_USDG_ADDRESS,
      version: "1",
    });
    expect(typedData.message).toMatchObject({
      owner,
      spender: factory,
      value: PREDICTION_BOOTSTRAP_USDG_ATOMS,
      nonce: 7n,
    });

    expect(() =>
      buildUsdgPermitTypedData({
        deadline: 1_800_000_000n,
        factoryAddress: factory,
        nonce: -1n,
        owner,
      }),
    ).toThrow("Permit nonce or deadline is outside uint256 bounds");
  });

  it("encodes the one-transaction permit creation call", () => {
    const validation = validatePredictionMarketDraft(
      { observationUtc: "2026-08-24T12:00", thresholdUsd: "60000" },
      nowMs,
    );
    if (!validation.ok) throw new Error("Expected valid prediction market");

    const transaction = encodePredictionMarketCreation({
      factoryAddress: factory,
      market: validation.market,
      permit: {
        deadline: 1_800_000_000n,
        r: `0x${"11".repeat(32)}`,
        s: `0x${"22".repeat(32)}`,
        v: 27,
      },
    });

    expect(transaction.to).toBe(factory);
    expect(transaction.value).toBe(0n);
    expect(transaction.data.slice(0, 10)).toBe(
      toFunctionSelector(
        "createMarketWithPermit(uint32,int192,uint256,uint8,bytes32,bytes32)",
      ),
    );
  });

  it("rejects malformed permit and market bounds before wallet submission", () => {
    const validation = validatePredictionMarketDraft(
      { observationUtc: "2026-08-24T12:00", thresholdUsd: "60000" },
      nowMs,
    );
    if (!validation.ok) throw new Error("Expected valid prediction market");

    expect(() =>
      encodePredictionMarketCreation({
        factoryAddress: factory,
        market: validation.market,
        permit: {
          deadline: 1_800_000_000n,
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
          v: Number.NaN,
        },
      }),
    ).toThrow("Permit signature is invalid");

    expect(() =>
      encodePredictionMarketCreation({
        factoryAddress: factory,
        market: validation.market,
        permit: {
          deadline: 1_800_000_000n,
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
          v: 1,
        },
      }),
    ).toThrow("Permit signature is invalid");

    expect(() =>
      encodePredictionMarketCreation({
        factoryAddress: factory,
        market: validation.market,
        permit: {
          deadline: 0n,
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
          v: 27,
        },
      }),
    ).toThrow("Prediction market or permit bounds are invalid");
  });
});
