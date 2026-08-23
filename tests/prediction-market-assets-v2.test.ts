import { describe, expect, it } from "vitest";

import {
  PREDICTION_MARKET_DRAFT_SCHEMA_V2,
  PREDICTION_PRESET_ASSETS_V2,
  PREDICTION_SOLANA_MAINNET_GENESIS_V2,
  PREDICTION_SOLANA_TOKEN_2022_PROGRAM_V2,
  PREDICTION_SOLANA_TOKEN_PROGRAM_V2,
  PREDICTION_SOURCE_NETWORKS_V2,
  formatPredictionAssetUsdV2,
  isPredictionAssetReleaseRegistryV2,
  isSolanaPredictionAssetLocatorV2,
  predictionAssetIdentityCandidatesV2,
  predictionAssetMarketStateV2,
  predictionAssetSelectionKeyV2,
  predictionAssetSnapshotMatchesSelectionV2,
  predictionOnchainAssetKeyV2,
  validatePredictionAssetSelectionV2,
  type PredictionAssetIdentityV2,
  type PredictionAssetReleaseEntryV2,
  type PredictionAssetReleaseRegistryV2,
  type PredictionAssetSelectionV2,
} from "../lib/prediction-market-assets-v2";

const EVM_ADDRESS = "0x1111111111111111111111111111111111111111";
const SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SNAPSHOT_HASH = `0x${"ab".repeat(32)}` as const;

function entryFor(
  selection: PredictionAssetSelectionV2,
  oracleStatus: "ready" | "unknown" | "unsupported" | "paused",
  identityIndex = 0,
): PredictionAssetReleaseEntryV2 {
  const selectionKey = predictionAssetSelectionKeyV2(selection);
  const identity = predictionAssetIdentityCandidatesV2(selection)[identityIndex];
  if (!selectionKey || !identity) throw new Error("invalid test selection");
  const onchainAssetKey = predictionOnchainAssetKeyV2(identity);
  const base = {
    selectionKey,
    onchainAssetKey,
    identity,
    marketType: "usd-price-at-utc" as const,
  };
  if (oracleStatus === "unknown" || oracleStatus === "unsupported") {
    return { ...base, oracleStatus, snapshot: null, release: null };
  }
  return {
    ...base,
    oracleStatus,
    snapshot: { assetKey: onchainAssetKey, revision: 1, snapshotHash: SNAPSHOT_HASH },
    release: { id: "protocol-v2", oraclePolicyId: "btc-usd-checkpoint-v2" },
  };
}

function registry(entries: readonly PredictionAssetReleaseEntryV2[]) {
  return {
    schemaVersion: 2,
    settlementNetwork: { id: "robinhood", chainId: 4_663 },
    entries,
  } as const satisfies PredictionAssetReleaseRegistryV2;
}

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

  it("separates the preset lookup key from its canonical GLOBAL onchain identity", () => {
    const selection = { mode: "preset", presetId: "btc" } as const;
    const [identity] = predictionAssetIdentityCandidatesV2(selection);

    expect(predictionAssetSelectionKeyV2(selection)).toBe("preset:btc");
    expect(identity).toEqual({
      sourceNamespace:
        "0x474c4f42414c5f43525950544f00000000000000000000000000000000000000",
      sourceChain:
        "0x474c4f42414c0000000000000000000000000000000000000000000000000000",
      assetIdentifier:
        "0x4254430000000000000000000000000000000000000000000000000000000000",
      assetStandard:
        "0x4e41544956450000000000000000000000000000000000000000000000000000",
    });
    expect(predictionOnchainAssetKeyV2(identity)).toBe(
      "0x3d828bf330119f559432fd0e22c4b301bb8d7406b7f1183e70581179a3bff8c2",
    );
    expect(predictionOnchainAssetKeyV2(identity)).not.toBe("preset:btc");
  });

  it("never infers an EVM network from the contract address", () => {
    const ethereum: PredictionAssetSelectionV2 = {
      mode: "custom",
      sourceNetwork: "ethereum",
      assetLocator: EVM_ADDRESS,
    };
    const base: PredictionAssetSelectionV2 = { ...ethereum, sourceNetwork: "base" };

    expect(predictionAssetSelectionKeyV2(ethereum)).toBe(`evm:1:${EVM_ADDRESS}`);
    expect(predictionAssetSelectionKeyV2(base)).toBe(`evm:8453:${EVM_ADDRESS}`);
    const [ethereumIdentity] = predictionAssetIdentityCandidatesV2(ethereum);
    const [baseIdentity] = predictionAssetIdentityCandidatesV2(base);
    expect(ethereumIdentity).toMatchObject({
      sourceNamespace:
        "0x4549503135350000000000000000000000000000000000000000000000000000",
      sourceChain: `0x${"0".repeat(63)}1`,
      assetIdentifier: `0x${"0".repeat(24)}${EVM_ADDRESS.slice(2)}`,
      assetStandard:
        "0x4552433230000000000000000000000000000000000000000000000000000000",
    });
    expect(predictionOnchainAssetKeyV2(ethereumIdentity)).not.toBe(
      predictionOnchainAssetKeyV2(baseIdentity),
    );
    expect(validatePredictionAssetSelectionV2({
      mode: "custom",
      sourceNetwork: "ethereum",
      assetLocator: `0x${"0".repeat(40)}`,
    }).ok).toBe(false);
    expect(validatePredictionAssetSelectionV2({
      mode: "custom",
      sourceNetwork: "",
      assetLocator: EVM_ADDRESS,
    })).toMatchObject({
      ok: false,
      errors: { sourceNetwork: "Choose the token network." },
    });
  });

  it("binds a Solana mainnet mint to the exact released token program", () => {
    const selection = {
      mode: "custom",
      sourceNetwork: "solana",
      assetLocator: SOLANA_MINT,
    } as const;
    expect(isSolanaPredictionAssetLocatorV2(SOLANA_MINT)).toBe(true);
    expect(isSolanaPredictionAssetLocatorV2(EVM_ADDRESS)).toBe(false);
    expect(isSolanaPredictionAssetLocatorV2("1".repeat(32))).toBe(false);
    expect(predictionAssetSelectionKeyV2(selection)).toBe(
      `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:${SOLANA_MINT}`,
    );

    const identities = predictionAssetIdentityCandidatesV2(selection);
    expect(identities).toHaveLength(2);
    expect(identities.map(({ sourceChain }) => sourceChain)).toEqual([
      PREDICTION_SOLANA_MAINNET_GENESIS_V2,
      PREDICTION_SOLANA_MAINNET_GENESIS_V2,
    ]);
    expect(identities.map(({ assetStandard }) => assetStandard)).toEqual([
      PREDICTION_SOLANA_TOKEN_PROGRAM_V2,
      PREDICTION_SOLANA_TOKEN_2022_PROGRAM_V2,
    ]);
    expect(identities[0].assetIdentifier).toBe(
      "0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61",
    );
  });

  it("fails closed until one exact released snapshot is ready", () => {
    const selection = { mode: "preset", presetId: "btc" } as const;
    expect(predictionAssetMarketStateV2(selection)).toMatchObject({
      state: "unavailable",
      code: "release-unconfigured",
      selectionKey: "preset:btc",
    });
    expect(predictionAssetMarketStateV2(selection, registry([]))).toMatchObject({
      state: "unavailable",
      code: "oracle-unsupported",
    });
    expect(
      predictionAssetMarketStateV2(selection, registry([entryFor(selection, "unknown")])),
    ).toMatchObject({ state: "unavailable", code: "oracle-unknown" });

    const ready = entryFor(selection, "ready");
    expect(predictionAssetMarketStateV2(selection, registry([ready]))).toMatchObject({
      state: "available",
      code: "ready",
      selectionKey: "preset:btc",
      onchainAssetKey: ready.onchainAssetKey,
    });
  });

  it("rejects a lookup key masquerading as assetKey and any identity or snapshot mismatch", () => {
    const selection = { mode: "preset", presetId: "btc" } as const;
    const ready = entryFor(selection, "ready");
    const invalidKey = {
      ...registry([ready]),
      entries: [{ ...ready, onchainAssetKey: "preset:btc" }],
    };
    expect(isPredictionAssetReleaseRegistryV2(invalidKey)).toBe(false);
    expect(isPredictionAssetReleaseRegistryV2({
      ...registry([ready]),
      entries: [{ ...ready, assetKey: ready.onchainAssetKey }],
    })).toBe(false);

    const wrongIdentity: PredictionAssetIdentityV2 = {
      ...ready.identity,
      assetIdentifier:
        "0x4554480000000000000000000000000000000000000000000000000000000000",
    };
    expect(isPredictionAssetReleaseRegistryV2({
      ...registry([ready]),
      entries: [{
        ...ready,
        identity: wrongIdentity,
        onchainAssetKey: predictionOnchainAssetKeyV2(wrongIdentity),
        snapshot: {
          ...ready.snapshot,
          assetKey: predictionOnchainAssetKeyV2(wrongIdentity),
        },
      }],
    })).toBe(false);
    expect(isPredictionAssetReleaseRegistryV2({
      ...registry([ready]),
      entries: [{ ...ready, snapshot: { ...ready.snapshot, assetKey: `0x${"12".repeat(32)}` } }],
    })).toBe(false);
  });

  it("rejects ambiguous release configuration", () => {
    const selection = { mode: "preset", presetId: "btc" } as const;
    const first = entryFor(selection, "ready");
    if (first.oracleStatus !== "ready") throw new Error("expected ready entry");
    const duplicate = {
      ...first,
      release: { id: "protocol-v2-b", oraclePolicyId: "policy-b" },
    } as const;
    expect(isPredictionAssetReleaseRegistryV2(registry([first, duplicate]))).toBe(true);
    expect(predictionAssetMarketStateV2(selection, registry([first, duplicate]))).toMatchObject({
      state: "unavailable",
      code: "oracle-ambiguous",
    });
  });

  it("keeps discovery informational and bound only to selectionKey", () => {
    const selection = { mode: "preset", presetId: "btc" } as const;
    const snapshot = {
      selectionKey: "preset:btc",
      status: "available",
      currentPriceUsd: 61_234.5,
      marketCapUsd: 1_210_000_000_000,
    } as const;
    expect(predictionAssetSnapshotMatchesSelectionV2(snapshot, selection)).toBe(true);
    expect(predictionAssetSnapshotMatchesSelectionV2(
      { ...snapshot, selectionKey: "preset:eth" },
      selection,
    )).toBe(false);
    expect(snapshot).not.toHaveProperty("onchainAssetKey");
    expect(formatPredictionAssetUsdV2(snapshot.currentPriceUsd, "price")).toBe(
      "$61,234.50",
    );
    expect(formatPredictionAssetUsdV2(snapshot.marketCapUsd, "market-cap")).toBe(
      "$1.21T",
    );
  });
});
