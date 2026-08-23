"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/components/prediction-market-experience.module.css";
import { predictionPreviewMarkets } from "@/components/prediction-market-preview";
import { useWallet } from "@/components/wallet-provider";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import {
  createPredictionMarketPublicClients,
  getPredictionMarketReleaseConfig,
} from "@/lib/prediction-market-chain";
import {
  PREDICTION_DEFAULT_SLIPPAGE_BPS,
  discoverPredictionResolutionProof,
  formatPredictionMarketObservation,
  formatPredictionOutcome,
  formatPredictionPriceAtoms,
  formatPredictionUsdg,
  parsePredictionBuyAmount,
  parsePredictionSellAmount,
  predictionDirectionalProtocolFee,
  preparePredictionBuy,
  preparePredictionFallbackAction,
  preparePredictionRedeem,
  preparePredictionResolution,
  preparePredictionSell,
  quotePredictionBuy,
  quotePredictionSell,
  readPredictionMarket,
  readPredictionPermitNonceQuorum,
  waitForPredictionAction,
  type PredictionBuyQuote,
  type PredictionFallbackAction,
  type PredictionMarketView,
  type PredictionOutcome,
  type PredictionSellQuote,
} from "@/lib/prediction-market-trading";
import {
  PREDICTION_PERMIT_DURATION_SECONDS,
  ROBINHOOD_USDG_ADDRESS,
} from "@/lib/prediction-market";
import { predictionMarketErrorMessage } from "@/lib/prediction-market-errors";

type MarketLoadState =
  | { kind: "loading" }
  | { kind: "preview"; market: PredictionMarketView }
  | { kind: "live"; market: PredictionMarketView }
  | { kind: "error"; message: string };

type TradeMode = "BUY" | "SELL";
type LiveQuote =
  | { kind: "BUY"; value: PredictionBuyQuote }
  | { kind: "SELL"; value: PredictionSellQuote };

type DisplayQuote = Readonly<{
  afterYesBps: number;
  averagePriceBps: number;
  depthLabel: string;
  minimumLabel: string;
  outputLabel: string;
  priceImpactBps: number;
  refundLabel?: string;
}>;

function quoteDepthLabel(priceImpactBps: number) {
  if (priceImpactBps <= 100) return "Low impact at this size";
  if (priceImpactBps <= 500) return "Moderate impact at this size";
  return "Thin backstop at this size";
}

function getErrorMessage(error: unknown) {
  return predictionMarketErrorMessage(error, "The market action failed");
}

function probabilityLabel(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
}

function centsLabel(bps: number) {
  return `${(bps / 100).toFixed(1).replace(/\.0$/u, "")}¢`;
}

function utcDate(timestamp: bigint) {
  return formatPredictionMarketObservation(timestamp);
}

function countdown(target: bigint, now: bigint) {
  if (target <= now) return "time passed";
  const seconds = Number(target - now);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function displayQuote(quote: LiveQuote): DisplayQuote {
  if (quote.kind === "BUY") {
    return {
      afterYesBps: quote.value.probabilityAfterBps,
      averagePriceBps: quote.value.averagePriceBps,
      depthLabel: quoteDepthLabel(quote.value.priceImpactBps),
      minimumLabel: formatPredictionOutcome(
        quote.value.minOutcomeAtoms,
        quote.value.outcome,
      ),
      outputLabel: formatPredictionOutcome(
        quote.value.outcomeAtoms,
        quote.value.outcome,
      ),
      priceImpactBps: quote.value.priceImpactBps,
      ...(quote.value.collateralRefundAtoms
        ? { refundLabel: formatPredictionUsdg(quote.value.collateralRefundAtoms) }
        : {}),
    };
  }
  return {
    afterYesBps: quote.value.probabilityAfterBps,
    averagePriceBps: quote.value.averagePriceBps,
    depthLabel: quoteDepthLabel(quote.value.priceImpactBps),
    minimumLabel: formatPredictionUsdg(quote.value.minCollateralAtoms),
    outputLabel: formatPredictionUsdg(quote.value.collateralAtoms),
    priceImpactBps: quote.value.priceImpactBps,
    ...(quote.value.soldRefundAtoms || quote.value.complementRefundAtoms
      ? {
          refundLabel: `${formatPredictionOutcome(quote.value.soldRefundAtoms)} sold + ${formatPredictionOutcome(quote.value.complementRefundAtoms)} complement`,
        }
      : {}),
  };
}

function previewQuote(
  market: PredictionMarketView,
  mode: TradeMode,
  outcome: PredictionOutcome,
  amount: string,
): DisplayQuote {
  const amountAtoms = mode === "BUY"
    ? parsePredictionBuyAmount(amount)
    : parsePredictionSellAmount(amount);
  if (amountAtoms === null) {
    throw new Error(
      mode === "BUY"
        ? "Enter a positive USDG amount with no more than five decimals"
        : "Enter a positive token amount with no more than five decimals",
    );
  }
  const selectedProbability = outcome === "YES"
    ? market.probabilityYesBps
    : 10_000 - market.probabilityYesBps;
  const notionalCollateral = mode === "BUY" ? amountAtoms : amountAtoms * 10n;
  const impact = Math.max(
    1,
    Math.min(
      1_200,
      Number(notionalCollateral * 1_500n / market.accountedLiabilityAtoms),
    ),
  );
  const selectedAfter = mode === "BUY"
    ? Math.min(9_900, selectedProbability + impact)
    : Math.max(100, selectedProbability - impact);
  const averagePriceBps = Math.max(
    1,
    Math.round((selectedProbability + selectedAfter) / 2),
  );
  const afterYesBps = outcome === "YES" ? selectedAfter : 10_000 - selectedAfter;
  if (mode === "BUY") {
    const outputAtoms = amountAtoms * 10_000n / (BigInt(averagePriceBps) * 10n);
    return {
      afterYesBps,
      averagePriceBps,
      depthLabel: quoteDepthLabel(impact),
      minimumLabel: formatPredictionOutcome(outputAtoms * 9_950n / 10_000n, outcome),
      outputLabel: formatPredictionOutcome(outputAtoms, outcome),
      priceImpactBps: impact,
    };
  }
  const outputAtoms = amountAtoms * 10n * BigInt(averagePriceBps) / 10_000n;
  return {
    afterYesBps,
    averagePriceBps,
    depthLabel: quoteDepthLabel(impact),
    minimumLabel: formatPredictionUsdg(outputAtoms * 9_950n / 10_000n),
    outputLabel: formatPredictionUsdg(outputAtoms),
    priceImpactBps: impact,
  };
}

export function PredictionMarketDetail({ semanticKey }: { semanticKey: string }) {
  const release = useMemo(() => {
    try {
      return { config: getPredictionMarketReleaseConfig(), error: "" };
    } catch (error) {
      return { config: null, error: getErrorMessage(error) };
    }
  }, []);
  const { openWallet, sendTransaction, signPredictionTokenPermit, wallet } = useWallet();
  const walletAccount = wallet?.account;
  const [loadState, setLoadState] = useState<MarketLoadState>({ kind: "loading" });
  const [mode, setMode] = useState<TradeMode>("BUY");
  const [outcome, setOutcome] = useState<PredictionOutcome>("YES");
  const [amount, setAmount] = useState("10");
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [shownQuote, setShownQuote] = useState<DisplayQuote | null>(null);
  const [phase, setPhase] = useState<"idle" | "quoting" | "signing" | "submitting" | "confirming">("idle");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    await Promise.resolve();
    if (!release.config) {
      const market = predictionPreviewMarkets(Math.floor(Date.now() / 1_000)).find(
        (candidate) => candidate.semanticKey.toLowerCase() === semanticKey.toLowerCase(),
      );
      if (!market) {
        setLoadState({ kind: "error", message: "This preview market does not exist" });
        return;
      }
      setLoadState({ kind: "preview", market });
      return;
    }
    setLoadState({ kind: "loading" });
    try {
      const market = await readPredictionMarket({
        account: walletAccount,
        config: release.config,
        semanticKey,
      });
      setLoadState({ kind: "live", market });
    } catch (error) {
      setLoadState({ kind: "error", message: getErrorMessage(error) });
    }
  }, [release.config, semanticKey, walletAccount]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const market = "market" in loadState ? loadState.market : null;
  const preview = loadState.kind === "preview";
  const busy = phase !== "idle";

  function clearQuote() {
    setLiveQuote(null);
    setShownQuote(null);
    setMessage("");
  }

  async function handleQuote() {
    if (!market || busy) return;
    setPhase("quoting");
    setMessage(preview ? "Checking the preview price…" : "Finding your price…");
    try {
      if (preview || !release.config) {
        setShownQuote(previewQuote(market, mode, outcome, amount));
        setLiveQuote(null);
      } else if (mode === "BUY") {
        const collateralAtoms = parsePredictionBuyAmount(amount);
        if (collateralAtoms === null) throw new Error("Enter a positive USDG amount with no more than five decimals");
        const quote = await quotePredictionBuy({
          collateralAtoms,
          config: release.config,
          outcome,
          semanticKey,
        });
        const wrapped = { kind: "BUY" as const, value: quote };
        setLiveQuote(wrapped);
        setShownQuote(displayQuote(wrapped));
      } else {
        const outcomeAtoms = parsePredictionSellAmount(amount);
        if (outcomeAtoms === null) throw new Error("Enter a positive token amount with no more than five decimals");
        const balance = outcome === "YES" ? market.yesBalanceAtoms : market.noBalanceAtoms;
        if (wallet && outcomeAtoms > balance) throw new Error(`Your wallet does not hold enough ${outcome}`);
        const quote = await quotePredictionSell({
          config: release.config,
          outcome,
          outcomeAtoms,
          semanticKey,
        });
        const wrapped = { kind: "SELL" as const, value: quote };
        setLiveQuote(wrapped);
        setShownQuote(displayQuote(wrapped));
      }
      setMessage(preview ? "Preview only. No wallet request will be made." : "Quote reconciled at one confirmed block. Review the minimum before submitting.");
    } catch (error) {
      setLiveQuote(null);
      setShownQuote(null);
      setMessage(getErrorMessage(error));
    } finally {
      setPhase("idle");
    }
  }

  async function handleTrade() {
    if (!market || !release.config || !liveQuote || busy) return;
    if (!wallet) {
      openWallet();
      return;
    }
    const clients = createPredictionMarketPublicClients();
    const permitDeadline = BigInt(Math.floor(Date.now() / 1_000) + PREDICTION_PERMIT_DURATION_SECONDS);
    const tokenAddress = liveQuote.kind === "BUY"
      ? ROBINHOOD_USDG_ADDRESS
      : liveQuote.value.outcome === "YES"
        ? market.yesToken
        : market.noToken;
    const tokenName = liveQuote.kind === "BUY"
      ? "Global Dollar"
      : liveQuote.value.outcome === "YES"
        ? market.yesTokenName
        : market.noTokenName;
    const value = liveQuote.kind === "BUY"
      ? liveQuote.value.collateralInAtoms
      : liveQuote.value.outcomeAtoms;
    try {
      setPhase("signing");
      setMessage(`Sign an exact ${mode === "BUY" ? "USDG" : outcome} permit. The signature alone spends no gas.`);
      const { nonce } = await readPredictionPermitNonceQuorum({
        clients,
        config: release.config,
        owner: wallet.account,
        token: tokenAddress,
      });
      const permit = await signPredictionTokenPermit({
        deadline: permitDeadline,
        nonce,
        spender: market.router,
        tokenAddress,
        tokenName,
        value,
      });

      setPhase("quoting");
      setMessage("Refreshing the executable quote after signature…");
      const tradeDeadline = BigInt(Math.floor(Date.now() / 1_000) + 5 * 60);
      let prepared;
      if (liveQuote.kind === "BUY") {
        const freshQuote = await quotePredictionBuy({
            collateralAtoms: liveQuote.value.collateralInAtoms,
            clients,
            config: release.config,
            outcome: liveQuote.value.outcome,
            semanticKey,
          });
        if (freshQuote.outcomeAtoms < liveQuote.value.minOutcomeAtoms) {
          setLiveQuote(null);
          setShownQuote(null);
          throw new Error("The price moved beyond the minimum you reviewed. Get a new quote before trading.");
        }
        prepared = await preparePredictionBuy({
          client: clients[0],
          deadline: tradeDeadline,
          owner: wallet.account,
          permit,
          quote: {
            ...freshQuote,
            minOutcomeAtoms: liveQuote.value.minOutcomeAtoms,
          },
        });
      } else {
        const freshQuote = await quotePredictionSell({
          clients,
          config: release.config,
          outcome: liveQuote.value.outcome,
          outcomeAtoms: liveQuote.value.outcomeAtoms,
          semanticKey,
        });
        if (freshQuote.collateralAtoms < liveQuote.value.minCollateralAtoms) {
          setLiveQuote(null);
          setShownQuote(null);
          throw new Error("The price moved beyond the minimum you reviewed. Get a new quote before trading.");
        }
        prepared = await preparePredictionSell({
          client: clients[0],
          deadline: tradeDeadline,
          owner: wallet.account,
          permit,
          quote: {
            ...freshQuote,
            minCollateralAtoms: liveQuote.value.minCollateralAtoms,
          },
        });
      }
      setPhase("submitting");
      setMessage("Confirm the simulated market transaction in your wallet.");
      const transactionHash = await sendTransaction(prepared);
      setPhase("confirming");
      setMessage("Transaction submitted. Waiting for both RPCs to confirm the same receipt…");
      await waitForPredictionAction({ clients, transactionHash });
      setMessage("Trade confirmed onchain.");
      setLiveQuote(null);
      setShownQuote(null);
      await refresh();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setPhase("idle");
    }
  }

  async function handleLifecycle(action: "RESOLVE" | "REDEEM" | PredictionFallbackAction) {
    if (!market || !release.config || busy) return;
    if (!wallet) {
      openWallet();
      return;
    }
    const clients = createPredictionMarketPublicClients();
    try {
      setPhase("quoting");
      setMessage(action === "RESOLVE" ? "Finding the unique adjacent Chainlink rounds across both RPCs…" : "Simulating the exact lifecycle transaction…");
      const prepared = action === "RESOLVE"
        ? await discoverPredictionResolutionProof({
            clients,
            config: release.config,
            semanticKey,
          }).then((proof) => preparePredictionResolution({
            client: clients[0],
            owner: wallet.account,
            proof,
          }))
        : action === "REDEEM"
          ? await preparePredictionRedeem({ client: clients[0], market, owner: wallet.account })
          : await preparePredictionFallbackAction({
              action,
              client: clients[0],
              market,
              owner: wallet.account,
            });
      setPhase("submitting");
      setMessage("Confirm the simulated lifecycle transaction in your wallet.");
      const transactionHash = await sendTransaction(prepared);
      setPhase("confirming");
      setMessage("Waiting for both RPCs to confirm the same receipt…");
      await waitForPredictionAction({ clients, transactionHash });
      setMessage(action === "REDEEM" ? "Payout confirmed in your wallet." : "Market state updated onchain.");
      await refresh();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setPhase("idle");
    }
  }

  if (loadState.kind === "loading") {
    return (
      <main className={`page-width ${styles.detailPage}`}>
        <div className={styles.detailLoading}>Loading market…</div>
      </main>
    );
  }
  if (loadState.kind === "error" || !market) {
    return (
      <main className={`page-width ${styles.detailPage}`}>
        <Link className={styles.detailBack} href="/markets">
          <ArrowLeft aria-hidden="true" size={15} /> Predictions
        </Link>
        <div className={styles.detailError}><strong>Market unavailable</strong><p>{loadState.kind === "error" ? loadState.message : "Unknown market"}</p></div>
      </main>
    );
  }

  const tradingOpen = market.state === "OPEN" && market.blockTimestamp < market.cutoff;
  const displayTitle = `Will BTC be at or above ${formatPredictionPriceAtoms(market.thresholdAtoms)}?`;
  const selectedBalance = outcome === "YES" ? market.yesBalanceAtoms : market.noBalanceAtoms;
  const selectedProtocolFee = liveQuote
    ? predictionDirectionalProtocolFee(liveQuote.value.swap.protocolFee, liveQuote.value.zeroForOne)
    : 0;
  const lifecycleAction = market.checkpointStatus !== "AWAITING" && market.state === "OPEN"
    ? "FINALIZE_CHECKPOINT"
    : market.fallbackChallengeDeadline && market.blockTimestamp > market.fallbackChallengeDeadline
      ? "FINALIZE_UNPROVEN"
      : market.blockTimestamp >= market.hardResolutionDeadline && market.fallbackRequestedAt === 0n
        ? "REQUEST_UNPROVEN_FALLBACK"
        : market.blockTimestamp >= market.resolutionDeadline
          ? "FINALIZE_UNAVAILABLE"
          : null;

  return (
    <main className={`page-width ${styles.detailPage}`}>
      <Link className={styles.detailBack} href="/markets">
        <ArrowLeft aria-hidden="true" size={15} /> Predictions
      </Link>
      {preview ? (
        <p className={styles.previewBanner}>
          <strong>Preview data.</strong> No wallet signatures or transactions.
        </p>
      ) : null}

      <div className={styles.detailLayout}>
        <section className={styles.marketCanvas}>
          <h1>{displayTitle}</h1>
          <div className={styles.detailMeta}>
            <span className={tradingOpen ? styles.openBadge : styles.closedBadge}>
              {tradingOpen ? "Open" : "Closed"}
            </span>
            <span>
              <Clock3 aria-hidden="true" size={15} />
              {tradingOpen
                ? `Closes in ${countdown(market.cutoff, market.blockTimestamp)}`
                : "Trading closed"}
            </span>
            <span>Resolves {utcDate(market.observationTime)}</span>
          </div>

          <div className={styles.heroProbability}>
            <div>
              <span>YES</span>
              <strong>{probabilityLabel(market.probabilityYesBps)}</strong>
            </div>
            <div>
              <span>NO</span>
              <strong>{probabilityLabel(10_000 - market.probabilityYesBps)}</strong>
            </div>
            <span className={styles.heroRail} aria-hidden="true">
              <span style={{ width: `${market.probabilityYesBps / 100}%` }} />
            </span>
          </div>

          <details className={styles.marketInfo}>
            <summary>
              <span>How this market resolves</span>
              <i aria-hidden="true" />
            </summary>
            <div className={styles.marketInfoBody}>
              <p>
                <strong>YES wins</strong> if BTC is {formatPredictionPriceAtoms(market.thresholdAtoms)}
                {" "}or higher at {utcDate(market.observationTime)}.
              </p>
              <p>
                The result uses Chainlink&apos;s last completed BTC/USD price at or
                before that time. If no valid result can be proven, YES and NO
                each redeem for 0.50 USDG.
              </p>
              {!preview ? (
                <div className={styles.contractLinks}>
                  <a href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/address/${market.vault}`} target="_blank" rel="noreferrer">Market contract <ExternalLink size={12} /></a>
                  <a href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/address/${market.yesToken}`} target="_blank" rel="noreferrer">YES token <ExternalLink size={12} /></a>
                  <a href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/address/${market.noToken}`} target="_blank" rel="noreferrer">NO token <ExternalLink size={12} /></a>
                </div>
              ) : null}
            </div>
          </details>
        </section>

        <aside className={styles.tradeTerminal} aria-label="Prediction market trade terminal">
          {tradingOpen ? (
            <>
              <div className={styles.terminalTopline}>
                <h2>Trade</h2>
                {preview ? <span>Preview</span> : null}
              </div>
              <div className={styles.modeTabs} role="tablist" aria-label="Trade direction">
                {(["BUY", "SELL"] as const).map((value) => (
                  <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? styles.activeMode : ""} onClick={() => { setMode(value); clearQuote(); }}>{value}</button>
                ))}
              </div>
              <div className={styles.outcomeToggle}>
                {(["YES", "NO"] as const).map((value) => (
                  <button key={value} type="button" className={outcome === value ? (value === "YES" ? styles.yesSelected : styles.noSelected) : ""} onClick={() => { setOutcome(value); clearQuote(); }}>
                    <span>{value}</span><strong>{centsLabel(value === "YES" ? market.probabilityYesBps : 10_000 - market.probabilityYesBps)}</strong>
                  </button>
                ))}
              </div>
              <label className={styles.amountField}>
                <span>{mode === "BUY" ? "You pay" : "You sell"}</span>
                <span><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); clearQuote(); }} aria-label={mode === "BUY" ? "USDG amount" : `${outcome} amount`} /><strong>{mode === "BUY" ? "USDG" : outcome}</strong></span>
                {mode === "SELL" && wallet ? <small>Balance {formatPredictionOutcome(selectedBalance, outcome)}</small> : null}
              </label>

              {shownQuote ? (
                <div className={styles.quoteReceipt} aria-live="polite">
                  <div><span>You receive</span><strong>{shownQuote.outputLabel}</strong></div>
                  <div><span>Minimum received</span><strong>{shownQuote.minimumLabel}</strong></div>
                  <div><span>Average price</span><strong>{centsLabel(shownQuote.averagePriceBps)}</strong></div>
                  <div><span>Trading fee</span><strong>0.02%{selectedProtocolFee ? ` + ${selectedProtocolFee / 100} bps protocol` : ""}</strong></div>
                  <details className={styles.quoteDetails}>
                    <summary>Price details</summary>
                    <div><span>YES chance after trade</span><strong>{probabilityLabel(shownQuote.afterYesBps)}</strong></div>
                    <div><span>Price impact</span><strong>{probabilityLabel(shownQuote.priceImpactBps)}</strong></div>
                    <div><span>Market depth</span><strong>{shownQuote.depthLabel}</strong></div>
                    {shownQuote.refundLabel ? <div><span>Refund</span><strong>{shownQuote.refundLabel}</strong></div> : null}
                    <div><span>Slippage limit</span><strong>{PREDICTION_DEFAULT_SLIPPAGE_BPS / 100}%</strong></div>
                  </details>
                </div>
              ) : null}

              <button
                className={styles.terminalAction}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!shownQuote || preview) void handleQuote();
                  else if (!wallet) openWallet();
                  else void handleTrade();
                }}
              >
                {busy
                  ? phase === "signing" ? "Sign in wallet" : phase === "confirming" ? "Confirming" : "Getting price"
                  : !shownQuote ? preview ? "Preview price" : "Review price"
                  : preview ? "Update preview"
                  : !wallet ? "Connect wallet"
                  : `${mode} ${outcome}`}
              </button>
              <p className={styles.terminalNote}>
                Your wallet shows the final amount and network fee before you
                confirm.
              </p>
            </>
          ) : market.state !== "OPEN" ? (
            <div className={styles.settlementTerminal}>
              <CheckCircle2 aria-hidden="true" size={24} />
              <span className={styles.terminalLabel}>Market resolved</span>
              <h2>{market.state === "FINAL_INVALID" ? "Neutral payout" : market.state === "FINAL_YES" ? "YES won" : "NO won"}</h2>
              <p>{market.state === "FINAL_INVALID" ? "Every YES and NO token redeems for 0.50 USDG." : "Each winning token redeems for 1 USDG. Losing tokens redeem for zero."}</p>
              {wallet ? <div className={styles.balancePair}><span>YES <strong>{formatPredictionOutcome(market.yesBalanceAtoms)}</strong></span><span>NO <strong>{formatPredictionOutcome(market.noBalanceAtoms)}</strong></span></div> : null}
              <button className={styles.terminalAction} disabled={busy || Boolean(wallet && market.yesBalanceAtoms === 0n && market.noBalanceAtoms === 0n)} type="button" onClick={() => preview ? setMessage("Preview only. No wallet request will be made.") : wallet ? void handleLifecycle("REDEEM") : openWallet()}>
                {busy ? "Confirming payout" : !wallet ? "Connect to redeem" : "Redeem to wallet"}
              </button>
            </div>
          ) : (
            <div className={styles.settlementTerminal}>
              <LockKeyhole aria-hidden="true" size={24} />
              <span className={styles.terminalLabel}>Trading closed</span>
              <h2>{market.blockTimestamp <= market.observationTime ? "Waiting for result time" : "Ready to resolve"}</h2>
              <p>{market.blockTimestamp <= market.observationTime ? `Trading stopped one minute before the result time. The result can be checked after ${utcDate(market.observationTime)}.` : "The result can now be checked from Chainlink. Anyone can finish the market."}</p>
              {market.blockTimestamp > market.observationTime ? (
                <button className={styles.terminalAction} disabled={busy} type="button" onClick={() => preview ? setMessage("Preview only. No wallet request will be made.") : wallet ? void handleLifecycle("RESOLVE") : openWallet()}>{busy ? "Checking result" : !wallet ? "Connect to resolve" : "Resolve market"}</button>
              ) : null}
              {lifecycleAction && market.blockTimestamp > market.observationTime ? (
                <button className={styles.secondaryTerminalAction} disabled={busy} type="button" onClick={() => preview ? setMessage("Preview only.") : wallet ? void handleLifecycle(lifecycleAction) : openWallet()}>
                  {lifecycleAction === "FINALIZE_CHECKPOINT" ? "Use confirmed result" : lifecycleAction === "FINALIZE_UNAVAILABLE" ? "Close as neutral" : lifecycleAction === "REQUEST_UNPROVEN_FALLBACK" ? "Start neutral fallback" : "Finish neutral fallback"}
                </button>
              ) : null}
            </div>
          )}
          {message ? <p className={styles.terminalStatus} role="status">{message}</p> : null}
          <button className={styles.refreshMarket} type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw aria-hidden="true" size={13} /> Refresh market</button>
        </aside>
      </div>
    </main>
  );
}
