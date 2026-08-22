"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  ShieldCheck,
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
  formatUtcObservation,
  PREDICTION_PERMIT_DURATION_SECONDS,
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
  return error instanceof Error ? error.message : "Market creation failed";
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
  const release = useMemo(() => {
    try {
      return {
        config: getPredictionMarketReleaseConfig(),
        error: "",
      };
    } catch (error) {
      return {
        config: null,
        error: getErrorMessage(error),
      };
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
    if (!release.config) return release.error ? "Release configuration blocked" : "Deployment pending";
    if (connecting) return "Wallet loading";
    if (!wallet) return "Connect wallet";
    if (phase === "checking") return "Checking both RPCs";
    if (phase === "signing") return "Sign 2 USDG permit";
    if (phase === "estimating") return "Simulating creation";
    if (phase === "submitting") return "Confirm in wallet";
    if (phase === "confirming") return "Confirming onchain";
    if (phase === "confirmed") return "Market created";
    return "Create market · 2 USDG";
  })();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!release.config || busy) return;
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
      setStatus("Checking the reviewed release against two public Robinhood RPCs…");
      const preflight = await preflightPredictionMarketLaunch({
        clients,
        config: release.config,
        market: latestValidation.market,
        owner: wallet.account,
      });
      const deadline =
        BigInt(Math.floor(Date.now() / 1_000)) +
        BigInt(PREDICTION_PERMIT_DURATION_SECONDS);

      setPhase("signing");
      setStatus("Sign the exact 2 USDG permit. This signature alone spends no gas.");
      const permit = await signPredictionPermit({
        deadline,
        factoryAddress: release.config.factoryAddress,
        nonce: preflight.nonce,
      });

      setPhase("estimating");
      setStatus("Rechecking state and simulating the exact market transaction…");
      const recheck = await preflightPredictionMarketLaunch({
        clients,
        config: release.config,
        market: latestValidation.market,
        owner: wallet.account,
      });
      if (
        recheck.nonce !== preflight.nonce ||
        recheck.semanticKey.toLowerCase() !== preflight.semanticKey.toLowerCase()
      ) {
        throw new Error("Market state changed while signing. Start again with a fresh permit.");
      }
      const prepared = await preparePredictionMarketLaunch({
        client: clients[0],
        config: release.config,
        expectedNonce: preflight.nonce,
        expectedSemanticKey: preflight.semanticKey,
        market: latestValidation.market,
        owner: wallet.account,
        permit,
      });
      setMaximumGasCostWei(prepared.maximumGasCostWei);

      setPhase("submitting");
      setStatus(
        `Your wallet will show the market transaction. Estimated maximum gas: ${formatEthMaximum(prepared.maximumGasCostWei)}.`,
      );
      const transactionHash = await sendTransaction(prepared.transaction);

      setPhase("confirming");
      setStatus("Transaction submitted. Verifying the canonical market and its YES/NO contracts…");
      const confirmed = await waitForPredictionMarketCreation({
        client: clients[0],
        config: release.config,
        creator: wallet.account,
        expectedSemanticKey: preflight.semanticKey,
        transactionHash,
      });
      setConfirmedMarket(confirmed);
      setPhase("confirmed");
      setStatus("Market created and matched against the factory registry.");
      const sourceMatches = await requestPredictionMarketSourceMatches(confirmed);
      const verifiedSourceCount = sourceMatches.filter(
        (result) => result.verified,
      ).length;
      setStatus(
        verifiedSourceCount === sourceMatches.length
          ? "Market created. All four market contracts are publicly source-verified."
          : `Market created. Public source verification is pending or temporarily unavailable (${verifiedSourceCount}/4 verified).`,
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
          <span>Prediction · BTC V1</span>
          <h1>Create a BTC market</h1>
        </div>
      </header>

      <p
        className={`${styles.previewNotice} ${release.config ? styles.releaseReady : ""}`}
        role="status"
      >
        <strong>{release.config ? "Zero-server launch" : "Technical preview"}</strong>
        {release.config
          ? "Every launch is checked against two free public RPCs. No hosted backend or monitoring subscription is required."
          : release.error || "The reviewed contracts are not deployed. This page cannot request a signature or transaction."}
      </p>

      <div className={styles.layout}>
        <form className={styles.form} onSubmit={handleSubmit}>
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

          <button
            className={styles.createButton}
            type="submit"
            disabled={Boolean(
              !release.config ||
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
          ) : (
            <p className={styles.actionNote}>
              After creation, the creator can make an optional YES or NO trade like any other trader.
            </p>
          )}
          {maximumGasCostWei !== null && phase !== "submitting" ? (
            <p className={styles.gasNote}>
              Last simulated gas ceiling: {formatEthMaximum(maximumGasCostWei)}
            </p>
          ) : null}
          {confirmedMarket ? (
            <a
              className={styles.explorerLink}
              href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${confirmedMarket.transactionHash}`}
              rel="noreferrer"
              target="_blank"
            >
              View confirmed transaction
              <ExternalLink aria-hidden="true" size={14} />
            </a>
          ) : null}
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
