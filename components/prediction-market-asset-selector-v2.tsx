"use client";

import { useId } from "react";

import styles from "@/components/prediction-market-asset-selector-v2.module.css";
import {
  PREDICTION_PRESET_ASSETS_V2,
  PREDICTION_SOURCE_NETWORKS_V2,
  formatPredictionAssetUsdV2,
  isPredictionSourceNetworkIdV2,
  predictionAssetMarketStateV2,
  predictionAssetSnapshotMatchesSelectionV2,
  predictionSourceNetworkV2,
  validatePredictionAssetSelectionV2,
  type PredictionAssetDiscoverySnapshotV2,
  type PredictionAssetReleaseRegistryV2,
  type PredictionAssetSelectionV2,
  type PredictionPresetAssetIdV2,
} from "@/lib/prediction-market-assets-v2";

export type PredictionMarketAssetSelectorV2Props = Readonly<{
  value: PredictionAssetSelectionV2;
  onChange: (selection: PredictionAssetSelectionV2) => void;
  releaseRegistry?: PredictionAssetReleaseRegistryV2 | null;
  discoverySnapshot?: PredictionAssetDiscoverySnapshotV2 | null;
  disabled?: boolean;
}>;

export function PredictionMarketAssetSelectorV2({
  value,
  onChange,
  releaseRegistry,
  discoverySnapshot,
  disabled = false,
}: PredictionMarketAssetSelectorV2Props) {
  const generatedId = useId();
  const headingId = `${generatedId}-heading`;
  const networkId = `${generatedId}-network`;
  const locatorId = `${generatedId}-locator`;
  const locatorFeedbackId = `${generatedId}-locator-feedback`;
  const validation = validatePredictionAssetSelectionV2(value);
  const marketState = predictionAssetMarketStateV2(value, releaseRegistry);
  const sourceNetwork =
    value.mode === "custom"
      ? predictionSourceNetworkV2(value.sourceNetwork)
      : undefined;
  const locatorLabel =
    sourceNetwork?.namespace === "solana" ? "Token mint" : "Contract address";
  const locatorPlaceholder =
    sourceNetwork?.namespace === "solana" ? "Solana token mint" : "0x…";
  const matchingSnapshot = predictionAssetSnapshotMatchesSelectionV2(
    discoverySnapshot,
    value,
  )
    ? discoverySnapshot
    : null;

  function selectPreset(presetId: PredictionPresetAssetIdV2) {
    onChange({ mode: "preset", presetId });
  }

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <div className={styles.heading}>
        <div>
          <h2 id={headingId}>Asset</h2>
          <p>Choose a popular asset or add a token.</p>
        </div>
        <div className={styles.modeSwitch} role="group" aria-label="Asset type">
          <button
            aria-pressed={value.mode === "preset"}
            data-active={value.mode === "preset"}
            disabled={disabled}
            onClick={() => selectPreset("btc")}
            type="button"
          >
            Popular
          </button>
          <button
            aria-pressed={value.mode === "custom"}
            data-active={value.mode === "custom"}
            disabled={disabled}
            onClick={() =>
              onChange({ mode: "custom", sourceNetwork: "", assetLocator: "" })
            }
            type="button"
          >
            Custom token
          </button>
        </div>
      </div>

      {value.mode === "preset" ? (
        <div className={styles.presetGrid} role="group" aria-label="Popular assets">
          {PREDICTION_PRESET_ASSETS_V2.map((asset) => {
            const selected = value.presetId === asset.id;
            return (
              <button
                aria-pressed={selected}
                className={styles.preset}
                data-selected={selected}
                disabled={disabled}
                key={asset.id}
                onClick={() => selectPreset(asset.id)}
                type="button"
              >
                <strong>{asset.symbol}</strong>
                <span>{asset.name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={styles.customFields}>
          <div className={styles.field}>
            <label htmlFor={networkId}>Network</label>
            <select
              aria-describedby={
                validation.errors.sourceNetwork
                  ? `${networkId}-feedback`
                  : undefined
              }
              aria-invalid={
                value.sourceNetwork
                  ? Boolean(validation.errors.sourceNetwork)
                  : undefined
              }
              disabled={disabled}
              id={networkId}
              name="predictionSourceNetwork"
              onChange={(event) => {
                const candidate = event.target.value;
                onChange({
                  ...value,
                  sourceNetwork: isPredictionSourceNetworkIdV2(candidate)
                    ? candidate
                    : "",
                });
              }}
              value={value.sourceNetwork}
            >
              <option value="">Choose network</option>
              {PREDICTION_SOURCE_NETWORKS_V2.map((network) => (
                <option key={network.id} value={network.id}>
                  {network.label}
                </option>
              ))}
            </select>
            <small id={`${networkId}-feedback`}>
              {validation.errors.sourceNetwork ?? "\u00a0"}
            </small>
          </div>

          <div className={styles.field}>
            <label htmlFor={locatorId}>{locatorLabel}</label>
            <input
              aria-describedby={locatorFeedbackId}
              aria-invalid={
                value.assetLocator.trim()
                  ? Boolean(validation.errors.assetLocator)
                  : undefined
              }
              autoCapitalize="none"
              autoComplete="off"
              disabled={disabled}
              id={locatorId}
              name="predictionAssetLocator"
              onChange={(event) =>
                onChange({ ...value, assetLocator: event.target.value })
              }
              placeholder={locatorPlaceholder}
              spellCheck={false}
              type="text"
              value={value.assetLocator}
            />
            <small id={locatorFeedbackId}>
              {validation.errors.assetLocator ??
                (sourceNetwork?.namespace === "solana"
                  ? "Use the token mint on Solana mainnet."
                  : "Use the token contract on the selected network.")}
            </small>
          </div>
        </div>
      )}

      {matchingSnapshot ? (
        <dl
          className={styles.referenceData}
          aria-label="Current asset data, informational only"
        >
          <div>
            <dt>Current price</dt>
            <dd>
              {formatPredictionAssetUsdV2(
                matchingSnapshot.currentPriceUsd,
                "price",
              )}
            </dd>
          </div>
          <div>
            <dt>Market cap</dt>
            <dd>
              {formatPredictionAssetUsdV2(
                matchingSnapshot.marketCapUsd,
                "market-cap",
              )}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className={styles.statusRegion} role="status" aria-live="polite">
        {marketState.state === "unavailable" ? (
          <div className={styles.marketState} data-state={marketState.state}>
            <strong>{marketState.title}</strong>
            <span>{marketState.detail}</span>
          </div>
        ) : (
          <span className={styles.srOnly}>{marketState.detail}</span>
        )}
      </div>
    </section>
  );
}
