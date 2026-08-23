import { describe, expect, it } from "vitest";

import {
  PREDICTION_MARKET_DRAFT_SCHEMA_V2,
  PREDICTION_PRESET_ASSETS_V2,
  PREDICTION_SOURCE_NETWORKS_V2,
  formatPredictionAssetUsdV2,
  isPredictionAssetReleaseRegistryV2,
  isSolanaPredictionAssetLocatorV2,
  predictionAssetKeyV2,
  predictionAssetMarketStateV2,
  predictionAssetSnapshotMatchesSelectionV2,
  validatePredictionAssetSelectionV2,
  type PredictionAssetReleaseRegistryV2,
  type PredictionAssetSelectionV2,
} from "../lib/prediction-market-assets-v2";

const EVM_ADDRESS = "0x1111111111111111111111111111111111111111";
const SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("prediction market V2 asset model", () => {
  it("keeps the market type narrow and exposes the five explicit source networks", () => {
    expect(PREDICTION_MARKET_DRAFT_SCHEMA_V2).toMatchObject({
      marketType: "usd-price-at-utc",
      comparator: "greater-than-or-equal",
      quoteCurrency: "USD",
      observationTimezone: "UTC",
      settlementNetwork: { id: "robinhood", chainId: 4_663 },
    });
    expect(PREDICTION_SOURCE_NETWORKS_V2.map(({ id }) => id)).toEqual([
      "ethereum",
      "base",
      "bnb",
      "robinhood",
      "solana",
    ]);
    expect(PREDICTION_PRESET_ASSETS_V2.map(({ symbol }) => symbol)).toEqual([
      "BTC",
      "ETH",
      "SOL",
      "BNB",
    ]);
  });

  it("never infers an EVM network from the contract address", () => {
    const ethereum: PredictionAssetSelectionV2 = {
      mode: "custom",
      sourceNetwork: "ethereum",
      assetLocator: EVM_ADDRESS,
    };
    const base: PredictionAssetSelectionV2 = {
      ...ethereum,
      sourceNetwork: "base",
    };
    expect(predictionAssetKeyV2(ethereum)).toBe(
      `evm:1:${EVM_ADDRESS}`,
    );
    expect(predictionAssetKeyV2(base)).toBe(
      `evm:8453:${EVM_ADDRESS}`,
    );
    expect(predictionAssetKeyV2(ethereum)).not.toBe(predictionAssetKeyV2(base));
    expect(
      validatePredictionAssetSelectionV2({
        mode: "custom",
        sourceNetwork: "",
        assetLocator: EVM_ADDRESS,
      }),
    ).toMatchObject({
      ok: false,
      errors: { sourceNetwork: "Choose the token network." },
    });
  });

  it("validates Solana mints separately from EVM addresses", () => {
    expect(isSolanaPredictionAssetLocatorV2(SOLANA_MINT)).toBe(true);
    expect(isSolanaPredictionAssetLocatorV2(EVM_ADDRESS)).toBe(false);
    expect(
      predictionAssetKeyV2({
        mode: "custom",
        sourceNetwork: "solana",
        assetLocator: SOLANA_MINT,
      }),
    ).toBe(
      `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:${SOLANA_MINT}`,
    );
    expect(
      validatePredictionAssetSelectionV2({
        mode: "custom",
        sourceNetwork: "ethereum",
        assetLocator: SOLANA_MINT,
      }).ok,
    ).toBe(false);
  });

  it("fails closed until one released price source is ready", () => {
    const selection = { mode: "preset", presetId: "btc" } as const;
    expect(predictionAssetMarketStateV2(selection)).toMatchObject({
      state: "unavailable",
      code: "release-unconfigured",
    });

    const unsupportedRegistry: PredictionAssetReleaseRegistryV2 = {
      schemaVersion: 2,
      settlementNetwork: { id: "robinhood", chainId: 4_663 },
      entries: [],
    };
    expect(
      predictionAssetMarketStateV2(selection, unsupportedRegistry),
    ).toMatchObject({ state: "unavailable", code: "oracle-unsupported" });

    const unknownRegistry: PredictionAssetReleaseRegistryV2 = {
      ...unsupportedRegistry,
      entries: [
        {
          assetKey: "preset:btc",
          marketType: "usd-price-at-utc",
          oracleStatus: "unknown",
        },
      ],
    };
    expect(predictionAssetMarketStateV2(selection, unknownRegistry)).toMatchObject(
      { state: "unavailable", code: "oracle-unknown" },
    );

    const readyRegistry: PredictionAssetReleaseRegistryV2 = {
      ...unsupportedRegistry,
      entries: [
        {
          assetKey: "preset:btc",
          marketType: "usd-price-at-utc",
          oracleStatus: "ready",
          oraclePolicyId: "btc-usd-checkpoint-v2",
          releaseId: "protocol-v2",
        },
      ],
    };
    expect(predictionAssetMarketStateV2(selection, readyRegistry)).toMatchObject({
      state: "available",
      code: "ready",
    });
  });

  it("rejects ambiguous and malformed release configuration", () => {
    const malformed = {
      schemaVersion: 2,
      settlementNetwork: { id: "robinhood", chainId: 4_663 },
      entries: [
        {
          assetKey: "preset:btc",
          marketType: "usd-price-at-utc",
          oracleStatus: "ready",
        },
      ],
    };
    expect(isPredictionAssetReleaseRegistryV2(malformed)).toBe(false);
    expect(
      predictionAssetMarketStateV2(
        { mode: "preset", presetId: "btc" },
        malformed as PredictionAssetReleaseRegistryV2,
      ),
    ).toMatchObject({ state: "unavailable", code: "release-invalid" });

    const duplicate: PredictionAssetReleaseRegistryV2 = {
      schemaVersion: 2,
      settlementNetwork: { id: "robinhood", chainId: 4_663 },
      entries: [
        {
          assetKey: "preset:btc",
          marketType: "usd-price-at-utc",
          oracleStatus: "ready",
          oraclePolicyId: "policy-a",
          releaseId: "release-a",
        },
        {
          assetKey: "preset:btc",
          marketType: "usd-price-at-utc",
          oracleStatus: "ready",
          oraclePolicyId: "policy-b",
          releaseId: "release-b",
        },
      ],
    };
    expect(
      predictionAssetMarketStateV2(
        { mode: "preset", presetId: "btc" },
        duplicate,
      ),
    ).toMatchObject({ state: "unavailable", code: "oracle-ambiguous" });
  });

  it("keeps discovery data informational and bound to the exact asset key", () => {
    const selection = { mode: "preset", presetId: "btc" } as const;
    const snapshot = {
      assetKey: "preset:btc",
      status: "available",
      currentPriceUsd: 61_234.5,
      marketCapUsd: 1_210_000_000_000,
    } as const;
    expect(predictionAssetSnapshotMatchesSelectionV2(snapshot, selection)).toBe(
      true,
    );
    expect(
      predictionAssetSnapshotMatchesSelectionV2(
        { ...snapshot, assetKey: "preset:eth" },
        selection,
      ),
    ).toBe(false);
    expect(predictionAssetMarketStateV2(selection)).toMatchObject({
      state: "unavailable",
    });
    expect(formatPredictionAssetUsdV2(snapshot.currentPriceUsd, "price")).toBe(
      "$61,234.50",
    );
    expect(formatPredictionAssetUsdV2(snapshot.marketCapUsd, "market-cap")).toBe(
      "$1.21T",
    );
  });
});
