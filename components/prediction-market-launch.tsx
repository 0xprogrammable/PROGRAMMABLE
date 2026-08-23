"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { formatEther } from "viem";

import styles from "@/components/prediction-market-launch.module.css";
import { useWallet } from "@/components/wallet-provider";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import {
  createPredictionMarketPublicClients,
  getPredictionMarketReleaseConfig,
  preflightPredictionMarketLaunch,
  preparePredictionMarketLaunch,
  requestPredictionMarketSourceMatches,
  waitForPredictionMarketCreation,
  type ConfirmedPredictionMarket,
} from "@/lib/prediction-market-chain";
import {
  defaultPredictionObservationUtc,
  PREDICTION_PERMIT_DURATION_SECONDS,
  validatePredictionMarketDraft,
  type PredictionMarketDraft,
} from "@/lib/prediction-market";
import { predictionMarketErrorMessage } from "@/lib/prediction-market-errors";

type PredictionMarketLaunchProps = Readonly<{
  onBack: () => void;
}>;

const initialDraft: PredictionMarketDraft = {
  observationUtc: "",
  thresholdUsd: "60000",
};

type LaunchPhase =
  | "idle"
  | "checking"
  | "signing"
  | "estimating"
  | "submitting"
  | "confirming"
  | "confirmed"
  | "error";

function getErrorMessage(error: unknown) {
  return predictionMarketErrorMessage(error, "Market creation failed");
}

function formatEthMaximum(value: bigint) {
  const [whole, fraction = ""] = formatEther(value).split(".");
  const shortFraction = fraction.slice(0, 6).replace(/0+$/, "");
  return `${whole}${shortFraction ? `.${shortFraction}` : ""} ETH`;
}

export function PredictionMarketLaunch({ onBack }: PredictionMarketLaunchProps) {
  const [draft, setDraft] = useState<PredictionMarketDraft>(initialDraft);
  const [nowMs, setNowMs] = useState(0);
  const [phase, setPhase] = useState<LaunchPhase>("idle");
  const [status, setStatus] = useState("");
  const [maximumGasCostWei, setMaximumGasCostWei] = useState<bigint | null>(null);
  const [confirmedMarket, setConfirmedMarket] =
    useState<ConfirmedPredictionMarket | null>(null);
  const {
    connecting,
    openWallet,
    sendTransaction,
    signPredictionPermit,
    wallet,
  } = useWallet();
  const releaseConfig = useMemo(() => {
    try {
      return getPredictionMarketReleaseConfig();
    } catch {
      return null;
    }
  }, []);

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
  const busy =
    phase === "checking" ||
    phase === "signing" ||
    phase === "estimating" ||
    phase === "submitting" ||
    phase === "confirming";
  const createButtonLabel = (() => {
    if (!releaseConfig) return "Preview only";
    if (connecting) return "Wallet loading";
    if (!wallet) return "Connect wallet";
    if (phase === "checking") return "Checking market";
    if (phase === "signing") return "Approve 2 USDG";
    if (phase === "estimating") return "Preparing market";
    if (phase === "submitting") return "Confirm in wallet";
    if (phase === "confirming") return "Creating market";
    if (phase === "confirmed") return "Market created";
    return "Create market · 2 USDG";
  })();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!releaseConfig || busy) return;
    if (!wallet) {
      openWallet();
      return;
    }
    const latestValidation = validatePredictionMarketDraft(draft, Date.now());
    if (!latestValidation.ok) {
      setPhase("error");
      setStatus("Fix the highlighted market details before continuing.");
      return;
    }

    setConfirmedMarket(null);
    setMaximumGasCostWei(null);
    try {
      const clients = createPredictionMarketPublicClients();
      setPhase("checking");
      setStatus("Checking your market…");
      const preflight = await preflightPredictionMarketLaunch({
        clients,
        config: releaseConfig,
        market: latestValidation.market,
        owner: wallet.account,
      });
      const deadline =
        BigInt(Math.floor(Date.now() / 1_000)) +
        BigInt(PREDICTION_PERMIT_DURATION_SECONDS);

      setPhase("signing");
      setStatus("Approve 2 USDG in your wallet.");
      const permit = await signPredictionPermit({
        deadline,
        factoryAddress: releaseConfig.factoryAddress,
        nonce: preflight.nonce,
      });

      setPhase("estimating");
      setStatus("Preparing your market…");
      const recheck = await preflightPredictionMarketLaunch({
        clients,
        config: releaseConfig,
        market: latestValidation.market,
        owner: wallet.account,
      });
      if (
        recheck.nonce !== preflight.nonce ||
        recheck.semanticKey.toLowerCase() !== preflight.semanticKey.toLowerCase()
      ) {
        throw new Error("The market changed while you were approving. Please try again.");
      }
      const prepared = await preparePredictionMarketLaunch({
        client: clients[0],
        config: releaseConfig,
        expectedNonce: preflight.nonce,
        expectedSemanticKey: preflight.semanticKey,
        market: latestValidation.market,
        owner: wallet.account,
        permit,
      });
      setMaximumGasCostWei(prepared.maximumGasCostWei);

      setPhase("submitting");
      setStatus(
        `Confirm in your wallet. Maximum estimated network fee: ${formatEthMaximum(prepared.maximumGasCostWei)}.`,
      );
      const transactionHash = await sendTransaction(prepared.transaction);

      setPhase("confirming");
      setStatus("Transaction sent. Creating your market…");
      const confirmed = await waitForPredictionMarketCreation({
        clients,
        config: releaseConfig,
        creator: wallet.account,
        expectedSemanticKey: preflight.semanticKey,
        transactionHash,
      });
      setConfirmedMarket(confirmed);
      setPhase("confirmed");
      setStatus("Market created.");
      const sourceMatches = await requestPredictionMarketSourceMatches(confirmed);
      const verifiedSourceCount = sourceMatches.filter(
        (result) => result.verified,
      ).length;
      setStatus(
        verifiedSourceCount === sourceMatches.length
          ? "Market created. Contracts verified."
          : "Market created. Contract verification is still processing.",
      );
    } catch (error) {
      setPhase("error");
      setStatus(getErrorMessage(error));
    }
  };

  return (
    <div className={`launch-page page-width ${styles.page}`}>
      <header className={styles.header}>
        <button className={styles.back} type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={16} />
          Back
        </button>
        <div className={styles.heading}>
          <h1>Create a prediction</h1>
        </div>
      </header>

      {!releaseConfig ? (
        <p className={styles.previewNotice} role="status">
          <strong>Preview only</strong>
          <span>Market creation is not available in this environment.</span>
        </p>
      ) : null}

      <div className={styles.layout}>
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formIntro}>
            <h2>Set the BTC price and result time</h2>
          </div>

          <div className={styles.fields}>
            <label className={styles.field}>
              <span>BTC price</span>
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
              <span>Result time (UTC)</span>
              <input
                aria-describedby={errors.observationUtc ? "prediction-time-error" : "prediction-time-help"}
                aria-invalid={Boolean(errors.observationUtc)}
                name="observationUtc"
                min={
                  nowMs
                    ? new Date(
                        nowMs + (24 * 60 * 60 + 60) * 1_000,
                      ).toISOString().slice(0, 16)
                    : undefined
                }
                max={
                  nowMs
                    ? new Date(
                        nowMs + 30 * 24 * 60 * 60 * 1_000,
                      ).toISOString().slice(0, 16)
                    : undefined
                }
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
                <small id="prediction-time-help">Shown and resolved in UTC.</small>
              )}
            </label>
          </div>

          <div className={styles.costRow}>
            <span>Creation cost</span>
            <strong>2 USDG + network fee</strong>
            <small>The 2 USDG starts the market and is not refunded.</small>
          </div>

          <button
            className={styles.createButton}
            type="submit"
            disabled={Boolean(
              !releaseConfig ||
              busy ||
              connecting ||
              phase === "confirmed" ||
              (wallet && !market),
            )}
          >
            {createButtonLabel}
          </button>
          {status ? (
            <p
              className={`${styles.launchStatus} ${phase === "error" ? styles.launchError : ""}`}
              role={phase === "error" ? "alert" : "status"}
            >
              {phase === "confirmed" ? <CheckCircle2 aria-hidden="true" size={15} /> : null}
              <span>{status}</span>
            </p>
          ) : null}
          {maximumGasCostWei !== null && phase !== "submitting" ? (
            <p className={styles.gasNote}>
              Estimated maximum network fee: {formatEthMaximum(maximumGasCostWei)}
            </p>
          ) : null}
          {confirmedMarket ? (
            <div className={styles.confirmedLinks}>
              <Link
                className={styles.marketLink}
                href={`/markets/${confirmedMarket.semanticKey}`}
              >
                Open market
              </Link>
              <a
                className={styles.explorerLink}
                href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${confirmedMarket.transactionHash}`}
                rel="noreferrer"
                target="_blank"
              >
                Confirmed transaction
                <ExternalLink aria-hidden="true" size={14} />
              </a>
            </div>
          ) : null}
        </form>

        <section className={styles.preview} aria-labelledby="prediction-preview-title" aria-live="polite">
          <div className={styles.previewTopline}>
            <span>Preview</span>
            {market ? <span>in {market.countdownLabel}</span> : null}
          </div>
          <h2 id="prediction-preview-title">
            {market
              ? `Will BTC be at or above ${market.thresholdLabel}?`
              : "Enter a valid price and result time."}
          </h2>
          {market ? (
            <p className={styles.previewTime}>
              Resolves {market.observationLabel} · Trading closes one minute earlier
            </p>
          ) : null}

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

          <details className={styles.details}>
            <summary>How this market resolves</summary>
            <p>
              YES wins if BTC is at or above the chosen price at the result
              time. Chainlink&apos;s last completed BTC/USD price at or before
              that time is used. If no valid result can be proven, YES and NO
              each redeem for 0.50 USDG.
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}
