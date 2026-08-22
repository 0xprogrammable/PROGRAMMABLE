"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock3, Database, ShieldCheck } from "lucide-react";

import styles from "@/components/prediction-market-launch.module.css";
import {
  defaultPredictionObservationUtc,
  formatUtcObservation,
  ROBINHOOD_CHAIN_ID,
  validatePredictionMarketDraft,
  type PredictionMarketDraft,
} from "@/lib/prediction-market";

type PredictionMarketLaunchProps = Readonly<{
  onBack: () => void;
}>;

const initialDraft: PredictionMarketDraft = {
  observationUtc: "",
  thresholdUsd: "60000",
};

export function PredictionMarketLaunch({ onBack }: PredictionMarketLaunchProps) {
  const [draft, setDraft] = useState<PredictionMarketDraft>(initialDraft);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    const syncCurrentTime = () => {
      const currentTime = Date.now();
      setNowMs(currentTime);
      setDraft((currentDraft) =>
        currentDraft.observationUtc
          ? currentDraft
          : {
              ...currentDraft,
              observationUtc: defaultPredictionObservationUtc(currentTime),
            },
      );
    };

    const initialTimer = window.setTimeout(syncCurrentTime, 0);
    const interval = window.setInterval(syncCurrentTime, 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  const validation = useMemo(
    () => validatePredictionMarketDraft(draft, nowMs),
    [draft, nowMs],
  );
  const market = validation.ok ? validation.market : null;
  const errors = validation.ok ? {} : validation.errors;

  return (
    <div className={`launch-page page-width ${styles.page}`}>
      <header className={styles.header}>
        <button className={styles.back} type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={16} />
          Back
        </button>
        <div className={styles.heading}>
          <span>Prediction · BTC V1</span>
          <h1>Create a BTC market</h1>
        </div>
      </header>

      <p className={styles.previewNotice} role="status">
        <strong>Technical preview</strong>
        The contracts are not deployed. This page will not request a wallet
        signature or transaction.
      </p>

      <div className={styles.layout}>
        <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
          <div className={styles.formIntro}>
            <div>
              <span className={styles.eyebrow}>One market, two outcomes</span>
              <h2>Set the price and UTC result time</h2>
            </div>
            <span className={styles.chainBadge}>Robinhood Chain · {ROBINHOOD_CHAIN_ID}</span>
          </div>

          <div className={styles.fixedAsset} aria-label="Market asset Bitcoin">
            <span className={styles.bitcoinMark} aria-hidden="true">₿</span>
            <span>
              <strong>Bitcoin</strong>
              <small>BTC/USD</small>
            </span>
            <span className={styles.fixedLabel}>Fixed for V1</span>
          </div>

          <div className={styles.fields}>
            <label className={styles.field}>
              <span>Target price</span>
              <span className={styles.priceInput}>
                <span aria-hidden="true">$</span>
                <input
                  aria-describedby={errors.thresholdUsd ? "prediction-threshold-error" : "prediction-threshold-help"}
                  aria-invalid={Boolean(errors.thresholdUsd)}
                  autoComplete="off"
                  inputMode="decimal"
                  name="thresholdUsd"
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      thresholdUsd: event.target.value,
                    }))
                  }
                  placeholder="60000"
                  spellCheck={false}
                  type="text"
                  value={draft.thresholdUsd}
                />
              </span>
              {errors.thresholdUsd ? (
                <small className={styles.error} id="prediction-threshold-error">
                  {errors.thresholdUsd}
                </small>
              ) : (
                <small id="prediction-threshold-help">YES wins at this price or higher.</small>
              )}
            </label>

            <label className={styles.field}>
              <span>Result time · UTC</span>
              <input
                aria-describedby={errors.observationUtc ? "prediction-time-error" : "prediction-time-help"}
                aria-invalid={Boolean(errors.observationUtc)}
                name="observationUtc"
                onChange={(event) =>
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    observationUtc: event.target.value,
                  }))
                }
                step={60}
                type="datetime-local"
                value={draft.observationUtc}
              />
              {errors.observationUtc ? (
                <small className={styles.error} id="prediction-time-error">
                  {errors.observationUtc}
                </small>
              ) : (
                <small id="prediction-time-help">Always interpreted as UTC, not your device timezone.</small>
              )}
            </label>
          </div>

          <div className={styles.costRow}>
            <span>
              <strong>2 USDG</strong>
              <small>Non-refundable market seed</small>
            </span>
            <span>
              <strong>1 signature</strong>
              <small>USDG permit</small>
            </span>
            <span>
              <strong>1 transaction</strong>
              <small>Plus Robinhood gas</small>
            </span>
          </div>

          <button className={styles.createButton} type="submit" disabled>
            Deployment pending
          </button>
          <p className={styles.actionNote}>
            After creation, the creator can make an optional YES or NO trade like any other trader.
          </p>
        </form>

        <section className={styles.preview} aria-labelledby="prediction-preview-title" aria-live="polite">
          <div className={styles.previewTopline}>
            <span>Market preview</span>
            {market ? <span>in {market.countdownLabel}</span> : null}
          </div>
          <h2 id="prediction-preview-title">
            {market?.marketTitle ?? "Enter a valid price and UTC result time."}
          </h2>

          <div className={styles.outcomes} aria-label="Initial market outcomes">
            <div className={styles.yesOutcome}>
              <span>YES</span>
              <strong>50%</strong>
            </div>
            <div className={styles.noOutcome}>
              <span>NO</span>
              <strong>50%</strong>
            </div>
          </div>

          <dl className={styles.facts}>
            <div>
              <dt><Clock3 aria-hidden="true" size={16} />Trading</dt>
              <dd>
                {market
                  ? `Closes ${formatUtcObservation(market.cutoffTime)}`
                  : "Closes 60 seconds before the result time"}
              </dd>
            </div>
            <div>
              <dt><Database aria-hidden="true" size={16} />Result source</dt>
              <dd>Official Chainlink BTC/USD round at or immediately before the UTC result time</dd>
            </div>
            <div>
              <dt><ShieldCheck aria-hidden="true" size={16} />Invalid result</dt>
              <dd>Each YES or NO token keeps half-value if a result cannot be proven safely</dd>
            </div>
          </dl>

          <details className={styles.details}>
            <summary>Exact resolution rule</summary>
            <p>
              Anyone can submit the adjacent Chainlink rounds that bracket the result time. The earlier completed round decides the market. Stale, malformed, or unprovable data fails closed; it cannot pick a convenient price.
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}
