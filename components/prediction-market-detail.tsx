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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
  PREDICTION_COLLATERAL_DECIMALS,
  applyPredictionSlippageFloor,
  discoverPredictionResolutionProof,
  formatPredictionMarketObservation,
  formatPredictionOutcome,
  formatPredictionPriceAtoms,
  isPredictionMarketLoadRequestCurrent,
  parsePredictionBuyAmount,
  parsePredictionSellAmount,
  predictionBuyPayoutSummary,
  predictionDirectionalProtocolFee,
  predictionMarketRedeemableAtoms,
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
  type PredictionMarketLoadRequestV1,
  type PredictionOutcome,
  type PredictionSellQuote,
} from "@/lib/prediction-market-trading";
import {
  PREDICTION_PERMIT_DURATION_SECONDS,
  ROBINHOOD_USDG_ADDRESS,
} from "@/lib/prediction-market";
import { predictionMarketErrorMessage } from "@/lib/prediction-market-errors";
import {
  predictionQuoteSelectionKey,
  type PredictionTradeMode,
} from "@/lib/prediction-market-quote-selection";

type MarketLoadState =
  | { kind: "loading" }
  | { kind: "preview"; market: PredictionMarketView }
  | { kind: "live"; market: PredictionMarketView }
  | { kind: "error"; message: string };

type LiveQuote =
  | { kind: "BUY"; value: PredictionBuyQuote }
  | { kind: "SELL"; value: PredictionSellQuote };

type DisplayBuyPayout = Readonly<{
  estimatedCostLabel: string;
  maximumLossLabel: string;
  minimumNeutralPayoutLabel: string;
  minimumWinningProfitLabel: string;
  minimumWinningPayoutLabel: string;
  outcome: PredictionOutcome;
  potentialProfitAtoms: bigint;
  potentialProfitLabel: string;
  winningPayoutLabel: string;
}>;

type DisplayQuote = Readonly<{
  afterYesBps: number;
  averagePriceBps: number;
  buyPayout?: DisplayBuyPayout;
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

function traderUsdgLabel(
  atoms: bigint,
  precision: "adaptive" | "exact" = "adaptive",
) {
  const negative = atoms < 0n;
  const absolute = negative ? -atoms : atoms;
  const collateralScale = 10n ** BigInt(PREDICTION_COLLATERAL_DECIMALS);
  const fractionDigits =
    precision === "exact"
      ? PREDICTION_COLLATERAL_DECIMALS
      : absolute >= collateralScale
        ? 2
        : absolute >= collateralScale / 100n
          ? 4
          : PREDICTION_COLLATERAL_DECIMALS;
  const roundingScale =
    10n ** BigInt(PREDICTION_COLLATERAL_DECIMALS - fractionDigits);
  const rounded =
    precision === "exact"
      ? absolute
      : (absolute + roundingScale / 2n) / roundingScale;
  const displayScale = 10n ** BigInt(fractionDigits);
  const whole = (rounded / displayScale).toString();
  const fraction = (rounded % displayScale)
    .toString()
    .padStart(fractionDigits, "0")
    .replace(/0+$/u, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${negative ? "−" : ""}${grouped}${fraction ? `.${fraction}` : ""} USDG`;
}

function signedUsdgLabel(
  atoms: bigint,
  precision: "adaptive" | "exact" = "adaptive",
) {
  if (atoms === 0n) return traderUsdgLabel(0n, precision);
  return `${atoms > 0n ? "+" : "−"}${traderUsdgLabel(
    atoms > 0n ? atoms : -atoms,
    precision,
  )}`;
}

function traderOutcomeLabel(atoms: bigint, outcome: PredictionOutcome) {
  const [amount] = formatPredictionOutcome(atoms, outcome).split(" ");
  const [whole, fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${grouped}${fraction ? `.${fraction}` : ""} ${outcome}`;
}

function displayBuyPayout(
  quote: Pick<
    PredictionBuyQuote,
    | "collateralInAtoms"
    | "collateralRefundAtoms"
    | "minOutcomeAtoms"
    | "outcomeAtoms"
  >,
  outcome: PredictionOutcome,
): DisplayBuyPayout {
  const payout = predictionBuyPayoutSummary(quote);
  return {
    estimatedCostLabel: traderUsdgLabel(payout.estimatedCostAtoms),
    maximumLossLabel: traderUsdgLabel(payout.maximumLossAtoms, "exact"),
    minimumWinningProfitLabel: signedUsdgLabel(
      payout.minimumWinningProfitAtoms,
      "exact",
    ),
    minimumWinningPayoutLabel: traderUsdgLabel(
      payout.minimumWinningPayoutAtoms,
      "exact",
    ),
    minimumNeutralPayoutLabel: traderUsdgLabel(
      payout.minimumNeutralPayoutAtoms,
      "exact",
    ),
    outcome,
    potentialProfitAtoms: payout.potentialProfitAtoms,
    potentialProfitLabel: signedUsdgLabel(payout.potentialProfitAtoms),
    winningPayoutLabel: traderUsdgLabel(payout.winningPayoutAtoms),
  };
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
      buyPayout: displayBuyPayout(quote.value, quote.value.outcome),
      depthLabel: quoteDepthLabel(quote.value.priceImpactBps),
      minimumLabel: traderOutcomeLabel(
        quote.value.minOutcomeAtoms,
        quote.value.outcome,
      ),
      outputLabel: traderOutcomeLabel(
        quote.value.outcomeAtoms,
        quote.value.outcome,
      ),
      priceImpactBps: quote.value.priceImpactBps,
      ...(quote.value.collateralRefundAtoms
        ? { refundLabel: traderUsdgLabel(quote.value.collateralRefundAtoms) }
        : {}),
    };
  }
  const complement = quote.value.outcome === "YES" ? "NO" : "YES";
  const returnedShares = [
    quote.value.soldRefundAtoms > 0n
      ? formatPredictionOutcome(
          quote.value.soldRefundAtoms,
          quote.value.outcome,
        )
      : null,
    quote.value.complementRefundAtoms > 0n
      ? formatPredictionOutcome(quote.value.complementRefundAtoms, complement)
      : null,
  ].filter((label): label is string => label !== null);
  return {
    afterYesBps: quote.value.probabilityAfterBps,
    averagePriceBps: quote.value.averagePriceBps,
    depthLabel: quoteDepthLabel(quote.value.priceImpactBps),
    minimumLabel: traderUsdgLabel(quote.value.minCollateralAtoms, "exact"),
    outputLabel: traderUsdgLabel(quote.value.collateralAtoms),
    priceImpactBps: quote.value.priceImpactBps,
    ...(returnedShares.length > 0
      ? { refundLabel: `${returnedShares.join(" + ")} returned` }
      : {}),
  };
}

function previewQuote(
  market: PredictionMarketView,
  mode: PredictionTradeMode,
  outcome: PredictionOutcome,
  amount: string,
): DisplayQuote {
  const amountAtoms =
    mode === "BUY"
      ? parsePredictionBuyAmount(amount)
      : parsePredictionSellAmount(amount);
  if (amountAtoms === null) {
    throw new Error(
      mode === "BUY"
        ? "Enter a positive USDG amount with no more than five decimals"
        : "Enter a positive token amount with no more than five decimals",
    );
  }
  const selectedProbability =
    outcome === "YES"
      ? market.probabilityYesBps
      : 10_000 - market.probabilityYesBps;
  const notionalCollateral = mode === "BUY" ? amountAtoms : amountAtoms * 10n;
  const impact = Math.max(
    1,
    Math.min(
      1_200,
      Number((notionalCollateral * 1_500n) / market.accountedLiabilityAtoms),
    ),
  );
  const selectedAfter =
    mode === "BUY"
      ? Math.min(9_900, selectedProbability + impact)
      : Math.max(100, selectedProbability - impact);
  const averagePriceBps = Math.max(
    1,
    Math.round((selectedProbability + selectedAfter) / 2),
  );
  const afterYesBps =
    outcome === "YES" ? selectedAfter : 10_000 - selectedAfter;
  if (mode === "BUY") {
    const outputAtoms =
      (amountAtoms * 10_000n) / (BigInt(averagePriceBps) * 10n);
    const minOutcomeAtoms = applyPredictionSlippageFloor(
      outputAtoms,
      PREDICTION_DEFAULT_SLIPPAGE_BPS,
    );
    const payoutQuote = {
      collateralInAtoms: amountAtoms,
      collateralRefundAtoms: 0n,
      minOutcomeAtoms,
      outcomeAtoms: outputAtoms,
    };
    return {
      afterYesBps,
      averagePriceBps,
      buyPayout: displayBuyPayout(payoutQuote, outcome),
      depthLabel: quoteDepthLabel(impact),
      minimumLabel: traderOutcomeLabel(minOutcomeAtoms, outcome),
      outputLabel: traderOutcomeLabel(outputAtoms, outcome),
      priceImpactBps: impact,
    };
  }
  const outputAtoms = (amountAtoms * 10n * BigInt(averagePriceBps)) / 10_000n;
  return {
    afterYesBps,
    averagePriceBps,
    depthLabel: quoteDepthLabel(impact),
    minimumLabel: traderUsdgLabel((outputAtoms * 9_950n) / 10_000n, "exact"),
    outputLabel: traderUsdgLabel(outputAtoms),
    priceImpactBps: impact,
  };
}

export function PredictionMarketDetail({
  semanticKey,
}: {
  semanticKey: string;
}) {
  const release = useMemo(() => {
    try {
      return { config: getPredictionMarketReleaseConfig(), error: "" };
    } catch (error) {
      return { config: null, error: getErrorMessage(error) };
    }
  }, []);
  const { openWallet, sendTransaction, signPredictionTokenPermit, wallet } =
    useWallet();
  const walletAccount = wallet?.account;
  const walletAccountKey = walletAccount?.toLowerCase() ?? "";
  const normalizedSemanticKey = semanticKey.toLowerCase();
  const [loadState, setLoadState] = useState<MarketLoadState>({
    kind: "loading",
  });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [mode, setMode] = useState<PredictionTradeMode>("BUY");
  const [outcome, setOutcome] = useState<PredictionOutcome>("YES");
  const [amount, setAmount] = useState("10");
  const [storedLiveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [storedShownQuote, setShownQuote] = useState<DisplayQuote | null>(null);
  const [quotedSelectionKey, setQuotedSelectionKey] = useState<string | null>(
    null,
  );
  const [phase, setPhase] = useState<
    "idle" | "quoting" | "signing" | "submitting" | "confirming"
  >("idle");
  const [message, setMessage] = useState("");
  const quoteRequestId = useRef(0);
  const quotePhaseRequestId = useRef<number | null>(null);
  const marketLoadGeneration = useRef(0);
  const activeMarketLoadRequest = useRef<PredictionMarketLoadRequestV1 | null>(
    null,
  );
  const lastMarketRef = useRef<PredictionMarketView | null>(null);
  const marketActionGeneration = useRef(0);
  const activeMarketActionRequest =
    useRef<PredictionMarketLoadRequestV1 | null>(null);
  const walletAccountKeyRef = useRef(walletAccountKey);
  const semanticKeyRef = useRef(normalizedSemanticKey);

  useLayoutEffect(() => {
    walletAccountKeyRef.current = walletAccountKey;
    semanticKeyRef.current = normalizedSemanticKey;
    return () => {
      activeMarketLoadRequest.current = null;
      marketLoadGeneration.current += 1;
      quoteRequestId.current += 1;
      quotePhaseRequestId.current = null;
      activeMarketActionRequest.current = null;
      marketActionGeneration.current += 1;
    };
  }, [normalizedSemanticKey, walletAccountKey]);

  function marketActionIsCurrent(request: PredictionMarketLoadRequestV1) {
    return (
      isPredictionMarketLoadRequestCurrent(
        request,
        activeMarketActionRequest.current,
      ) &&
      request.accountKey === walletAccountKeyRef.current &&
      request.semanticKey === semanticKeyRef.current
    );
  }

  function requireCurrentMarketAction(request: PredictionMarketLoadRequestV1) {
    if (!marketActionIsCurrent(request)) {
      throw new Error(
        "The wallet or market changed. The action was stopped before submission.",
      );
    }
  }

  const refresh = useCallback(async () => {
    const request = {
      accountKey: walletAccountKey,
      generation: ++marketLoadGeneration.current,
      semanticKey: normalizedSemanticKey,
    } satisfies PredictionMarketLoadRequestV1;
    activeMarketLoadRequest.current = request;
    quoteRequestId.current += 1;
    if (quotePhaseRequestId.current !== null) {
      quotePhaseRequestId.current = null;
      setPhase((current) => (current === "quoting" ? "idle" : current));
    }
    if (activeMarketActionRequest.current !== null) {
      activeMarketActionRequest.current = null;
      marketActionGeneration.current += 1;
      setPhase("idle");
    }
    setLiveQuote(null);
    setShownQuote(null);
    setQuotedSelectionKey(null);
    setRefreshError("");
    const preserveCurrentMarket =
      lastMarketRef.current?.semanticKey.toLowerCase() === normalizedSemanticKey;
    setRefreshing(preserveCurrentMarket);
    if (!preserveCurrentMarket) {
      setLoadState({ kind: "loading" });
    }
    await Promise.resolve();
    if (
      !isPredictionMarketLoadRequestCurrent(
        request,
        activeMarketLoadRequest.current,
      )
    )
      return;
    try {
      if (!release.config) {
        const market = predictionPreviewMarkets(
          Math.floor(Date.now() / 1_000),
        ).find(
          (candidate) =>
            candidate.semanticKey.toLowerCase() === semanticKey.toLowerCase(),
        );
        if (!market) {
          if (
            isPredictionMarketLoadRequestCurrent(
              request,
              activeMarketLoadRequest.current,
            )
          ) {
            lastMarketRef.current = null;
            setLoadState({
              kind: "error",
              message: "This preview market does not exist",
            });
          }
          return;
        }
        if (
          isPredictionMarketLoadRequestCurrent(
            request,
            activeMarketLoadRequest.current,
          )
        ) {
          lastMarketRef.current = market;
          setLoadState({ kind: "preview", market });
        }
        return;
      }
      const market = await readPredictionMarket({
        account: walletAccount,
        config: release.config,
        semanticKey,
      });
      if (
        isPredictionMarketLoadRequestCurrent(
          request,
          activeMarketLoadRequest.current,
        )
      ) {
        lastMarketRef.current = market;
        setLoadState({ kind: "live", market });
      }
    } catch (error) {
      if (
        isPredictionMarketLoadRequestCurrent(
          request,
          activeMarketLoadRequest.current,
        )
      ) {
        if (preserveCurrentMarket) {
          setRefreshError(
            "Unable to refresh. Showing the last loaded market.",
          );
        } else {
          lastMarketRef.current = null;
          setLoadState({ kind: "error", message: getErrorMessage(error) });
        }
      }
    } finally {
      if (
        isPredictionMarketLoadRequestCurrent(
          request,
          activeMarketLoadRequest.current,
        )
      ) {
        setRefreshing(false);
      }
    }
  }, [
    normalizedSemanticKey,
    release.config,
    semanticKey,
    walletAccount,
    walletAccountKey,
  ]);

  useEffect(() => {
    quoteRequestId.current += 1;
    quotePhaseRequestId.current = null;
    activeMarketActionRequest.current = null;
    marketActionGeneration.current += 1;
    const timer = window.setTimeout(() => {
      setPhase("idle");
      setMessage("");
      void refresh();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      activeMarketLoadRequest.current = null;
      marketLoadGeneration.current += 1;
      quoteRequestId.current += 1;
      quotePhaseRequestId.current = null;
      activeMarketActionRequest.current = null;
      marketActionGeneration.current += 1;
    };
  }, [refresh]);

  const market = "market" in loadState ? loadState.market : null;
  const preview = loadState.kind === "preview";
  const busy = phase !== "idle" || refreshing;
  const currentQuoteSelectionKey = predictionQuoteSelectionKey({
    amount,
    marketIdentity: market
      ? `${market.semanticKey}:${market.canonicalPoolId}:${market.vault}`
      : normalizedSemanticKey,
    mode,
    outcome,
  });
  const quoteSelectionIsCurrent =
    quotedSelectionKey === currentQuoteSelectionKey;
  const liveQuote = quoteSelectionIsCurrent ? storedLiveQuote : null;
  const shownQuote = quoteSelectionIsCurrent ? storedShownQuote : null;

  function clearQuote() {
    quoteRequestId.current += 1;
    if (quotePhaseRequestId.current !== null) {
      quotePhaseRequestId.current = null;
      setPhase((current) => (current === "quoting" ? "idle" : current));
    }
    setLiveQuote(null);
    setShownQuote(null);
    setQuotedSelectionKey(null);
    setMessage("");
  }

  async function handleQuote() {
    if (!market || busy) return;
    const requestId = ++quoteRequestId.current;
    const requestedAmount = amount;
    const requestedMarket = market;
    const requestedMode = mode;
    const requestedOutcome = outcome;
    const requestedSelectionKey = currentQuoteSelectionKey;
    quotePhaseRequestId.current = requestId;
    setPhase("quoting");
    setMessage(preview ? "Checking the preview price…" : "Finding your price…");
    try {
      let nextLiveQuote: LiveQuote | null = null;
      let nextShownQuote: DisplayQuote;
      if (preview || !release.config) {
        nextShownQuote = previewQuote(
          requestedMarket,
          requestedMode,
          requestedOutcome,
          requestedAmount,
        );
      } else if (requestedMode === "BUY") {
        const collateralAtoms = parsePredictionBuyAmount(requestedAmount);
        if (collateralAtoms === null)
          throw new Error(
            "Enter a positive USDG amount with no more than five decimals",
          );
        const quote = await quotePredictionBuy({
          collateralAtoms,
          config: release.config,
          outcome: requestedOutcome,
          semanticKey,
        });
        nextLiveQuote = { kind: "BUY", value: quote };
        nextShownQuote = displayQuote(nextLiveQuote);
      } else {
        const outcomeAtoms = parsePredictionSellAmount(requestedAmount);
        if (outcomeAtoms === null)
          throw new Error(
            "Enter a positive token amount with no more than five decimals",
          );
        const balance =
          requestedOutcome === "YES"
            ? requestedMarket.yesBalanceAtoms
            : requestedMarket.noBalanceAtoms;
        if (wallet && outcomeAtoms > balance)
          throw new Error(
            `Your wallet does not hold enough ${requestedOutcome}`,
          );
        const quote = await quotePredictionSell({
          config: release.config,
          outcome: requestedOutcome,
          outcomeAtoms,
          semanticKey,
        });
        nextLiveQuote = { kind: "SELL", value: quote };
        nextShownQuote = displayQuote(nextLiveQuote);
      }
      if (requestId !== quoteRequestId.current) return;
      setLiveQuote(nextLiveQuote);
      setShownQuote(nextShownQuote);
      setQuotedSelectionKey(requestedSelectionKey);
      setMessage(
        preview
          ? "Preview only. No wallet request will be made."
          : "Quote reconciled at one confirmed block. Review the minimum before submitting.",
      );
    } catch (error) {
      if (requestId !== quoteRequestId.current) return;
      setLiveQuote(null);
      setShownQuote(null);
      setQuotedSelectionKey(null);
      setMessage(getErrorMessage(error));
    } finally {
      if (requestId === quoteRequestId.current) {
        quotePhaseRequestId.current = null;
        setPhase("idle");
      }
    }
  }

  async function handleTrade() {
    if (!market || !release.config || !liveQuote || busy) return;
    if (!wallet) {
      openWallet();
      return;
    }
    const actionRequest = {
      accountKey: wallet.account.toLowerCase(),
      generation: ++marketActionGeneration.current,
      semanticKey: semanticKey.toLowerCase(),
    } satisfies PredictionMarketLoadRequestV1;
    activeMarketActionRequest.current = actionRequest;
    const requestedMarket = market;
    const requestedQuote = liveQuote;
    const requestedWallet = wallet;
    const requestedMode = mode;
    const requestedOutcome = outcome;
    const clients = createPredictionMarketPublicClients();
    const permitDeadline = BigInt(
      Math.floor(Date.now() / 1_000) + PREDICTION_PERMIT_DURATION_SECONDS,
    );
    const tokenAddress =
      requestedQuote.kind === "BUY"
        ? ROBINHOOD_USDG_ADDRESS
        : requestedQuote.value.outcome === "YES"
          ? requestedMarket.yesToken
          : requestedMarket.noToken;
    const tokenName =
      requestedQuote.kind === "BUY"
        ? "Global Dollar"
        : requestedQuote.value.outcome === "YES"
          ? requestedMarket.yesTokenName
          : requestedMarket.noTokenName;
    const value =
      requestedQuote.kind === "BUY"
        ? requestedQuote.value.collateralInAtoms
        : requestedQuote.value.outcomeAtoms;
    try {
      setPhase("signing");
      setMessage(
        `Sign an exact ${requestedMode === "BUY" ? "USDG" : requestedOutcome} permit. The signature alone spends no gas.`,
      );
      const { nonce } = await readPredictionPermitNonceQuorum({
        clients,
        config: release.config,
        owner: requestedWallet.account,
        token: tokenAddress,
      });
      requireCurrentMarketAction(actionRequest);
      const permit = await signPredictionTokenPermit({
        deadline: permitDeadline,
        nonce,
        spender: requestedMarket.router,
        tokenAddress,
        tokenName,
        value,
      });
      requireCurrentMarketAction(actionRequest);

      setPhase("quoting");
      setMessage("Refreshing the executable quote after signature…");
      const tradeDeadline = BigInt(Math.floor(Date.now() / 1_000) + 5 * 60);
      let prepared;
      if (requestedQuote.kind === "BUY") {
        const freshQuote = await quotePredictionBuy({
          collateralAtoms: requestedQuote.value.collateralInAtoms,
          clients,
          config: release.config,
          outcome: requestedQuote.value.outcome,
          semanticKey,
        });
        requireCurrentMarketAction(actionRequest);
        if (freshQuote.outcomeAtoms < requestedQuote.value.minOutcomeAtoms) {
          setLiveQuote(null);
          setShownQuote(null);
          setQuotedSelectionKey(null);
          throw new Error(
            "The price moved beyond the minimum you reviewed. Get a new quote before trading.",
          );
        }
        prepared = await preparePredictionBuy({
          client: clients[0],
          deadline: tradeDeadline,
          owner: requestedWallet.account,
          permit,
          quote: {
            ...freshQuote,
            minOutcomeAtoms: requestedQuote.value.minOutcomeAtoms,
          },
        });
      } else {
        const freshQuote = await quotePredictionSell({
          clients,
          config: release.config,
          outcome: requestedQuote.value.outcome,
          outcomeAtoms: requestedQuote.value.outcomeAtoms,
          semanticKey,
        });
        requireCurrentMarketAction(actionRequest);
        if (
          freshQuote.collateralAtoms < requestedQuote.value.minCollateralAtoms
        ) {
          setLiveQuote(null);
          setShownQuote(null);
          setQuotedSelectionKey(null);
          throw new Error(
            "The price moved beyond the minimum you reviewed. Get a new quote before trading.",
          );
        }
        prepared = await preparePredictionSell({
          client: clients[0],
          deadline: tradeDeadline,
          owner: requestedWallet.account,
          permit,
          quote: {
            ...freshQuote,
            minCollateralAtoms: requestedQuote.value.minCollateralAtoms,
          },
        });
      }
      requireCurrentMarketAction(actionRequest);
      setPhase("submitting");
      setMessage("Confirm the simulated market transaction in your wallet.");
      const transactionHash = await sendTransaction(prepared);
      if (!marketActionIsCurrent(actionRequest)) return;
      setPhase("confirming");
      setMessage(
        "Transaction submitted. Waiting for both RPCs to confirm the same receipt…",
      );
      await waitForPredictionAction({ clients, transactionHash });
      if (marketActionIsCurrent(actionRequest)) {
        setMessage("Trade confirmed onchain.");
        setLiveQuote(null);
        setShownQuote(null);
        setQuotedSelectionKey(null);
        await refresh();
      }
    } catch (error) {
      if (marketActionIsCurrent(actionRequest)) {
        setMessage(getErrorMessage(error));
      }
    } finally {
      if (
        isPredictionMarketLoadRequestCurrent(
          actionRequest,
          activeMarketActionRequest.current,
        )
      ) {
        activeMarketActionRequest.current = null;
        setPhase("idle");
      }
    }
  }

  async function handleLifecycle(
    action: "RESOLVE" | "REDEEM" | PredictionFallbackAction,
  ) {
    if (!market || !release.config || busy) return;
    if (!wallet) {
      openWallet();
      return;
    }
    const actionRequest = {
      accountKey: wallet.account.toLowerCase(),
      generation: ++marketActionGeneration.current,
      semanticKey: semanticKey.toLowerCase(),
    } satisfies PredictionMarketLoadRequestV1;
    activeMarketActionRequest.current = actionRequest;
    const requestedMarket = market;
    const requestedWallet = wallet;
    const clients = createPredictionMarketPublicClients();
    try {
      setPhase("quoting");
      setMessage(
        action === "RESOLVE"
          ? "Finding the unique adjacent Chainlink rounds across both RPCs…"
          : "Simulating the exact lifecycle transaction…",
      );
      let prepared;
      if (action === "RESOLVE") {
        const proof = await discoverPredictionResolutionProof({
          clients,
          config: release.config,
          semanticKey,
        });
        requireCurrentMarketAction(actionRequest);
        prepared = await preparePredictionResolution({
          client: clients[0],
          owner: requestedWallet.account,
          proof,
        });
      } else if (action === "REDEEM") {
        prepared = await preparePredictionRedeem({
          client: clients[0],
          market: requestedMarket,
          owner: requestedWallet.account,
        });
      } else {
        prepared = await preparePredictionFallbackAction({
          action,
          client: clients[0],
          market: requestedMarket,
          owner: requestedWallet.account,
        });
      }
      requireCurrentMarketAction(actionRequest);
      setPhase("submitting");
      setMessage("Confirm the simulated lifecycle transaction in your wallet.");
      const transactionHash = await sendTransaction(prepared);
      if (!marketActionIsCurrent(actionRequest)) return;
      setPhase("confirming");
      setMessage("Waiting for both RPCs to confirm the same receipt…");
      await waitForPredictionAction({ clients, transactionHash });
      if (marketActionIsCurrent(actionRequest)) {
        setMessage(
          action === "REDEEM"
            ? "Payout confirmed in your wallet."
            : "Market state updated onchain.",
        );
        await refresh();
      }
    } catch (error) {
      if (marketActionIsCurrent(actionRequest)) {
        setMessage(getErrorMessage(error));
      }
    } finally {
      if (
        isPredictionMarketLoadRequestCurrent(
          actionRequest,
          activeMarketActionRequest.current,
        )
      ) {
        activeMarketActionRequest.current = null;
        setPhase("idle");
      }
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
        <div className={styles.detailError}>
          <strong>Market unavailable</strong>
          <p>
            {loadState.kind === "error" ? loadState.message : "Unknown market"}
          </p>
        </div>
      </main>
    );
  }

  const tradingOpen =
    market.state === "OPEN" && market.blockTimestamp < market.cutoff;
  const displayTitle = `Will BTC be at or above ${formatPredictionPriceAtoms(market.thresholdAtoms)}?`;
  const selectedBalance =
    outcome === "YES" ? market.yesBalanceAtoms : market.noBalanceAtoms;
  const redeemableAtoms = predictionMarketRedeemableAtoms(market);
  const selectedProtocolFee = liveQuote
    ? predictionDirectionalProtocolFee(
        liveQuote.value.swap.protocolFee,
        liveQuote.value.zeroForOne,
      )
    : 0;
  const orderAnnouncement = shownQuote?.buyPayout
    ? `Potential payout ${shownQuote.buyPayout.winningPayoutLabel} if ${shownQuote.buyPayout.outcome} wins, based on the current quote; potential profit ${shownQuote.buyPayout.potentialProfitLabel}; max market loss ${shownQuote.buyPayout.maximumLossLabel}; network fee excluded.`
    : shownQuote
      ? `Estimated proceeds ${shownQuote.outputLabel}; minimum proceeds ${shownQuote.minimumLabel}.`
      : "";
  const lifecycleAction =
    market.checkpointStatus !== "AWAITING" && market.state === "OPEN"
      ? "FINALIZE_CHECKPOINT"
      : market.fallbackChallengeDeadline &&
          market.blockTimestamp > market.fallbackChallengeDeadline
        ? "FINALIZE_UNPROVEN"
        : market.blockTimestamp >= market.hardResolutionDeadline &&
            market.fallbackRequestedAt === 0n
          ? "REQUEST_UNPROVEN_FALLBACK"
          : market.blockTimestamp >= market.resolutionDeadline
            ? "FINALIZE_UNAVAILABLE"
            : null;

  return (
    <main
      aria-busy={refreshing}
      className={`page-width ${styles.detailPage}`}
    >
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
            <span
              className={tradingOpen ? styles.openBadge : styles.closedBadge}
            >
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
              <strong>
                {probabilityLabel(10_000 - market.probabilityYesBps)}
              </strong>
            </div>
            <span className={styles.heroRail} aria-hidden="true">
              <span style={{ width: `${market.probabilityYesBps / 100}%` }} />
            </span>
          </div>

          <details className={styles.marketInfo}>
            <summary>
              <span>Rules</span>
              <i aria-hidden="true" />
            </summary>
            <div className={styles.marketInfoBody}>
              <p>
                <strong>YES wins</strong> when Chainlink&apos;s last completed
                BTC/USD price at or before {utcDate(market.observationTime)} is{" "}
                {formatPredictionPriceAtoms(market.thresholdAtoms)} or higher.
                If no valid result can be proven, YES and NO each redeem for
                0.50 USDG.
              </p>
              {!preview ? (
                <div className={styles.contractLinks}>
                  <a
                    href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/address/${market.vault}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Market contract <ExternalLink size={12} />
                  </a>
                  <a
                    href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/address/${market.yesToken}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    YES token <ExternalLink size={12} />
                  </a>
                  <a
                    href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/address/${market.noToken}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    NO token <ExternalLink size={12} />
                  </a>
                </div>
              ) : null}
            </div>
          </details>
        </section>

        <aside
          className={styles.tradeTerminal}
          aria-label="Prediction market trade terminal"
        >
          {tradingOpen ? (
            <>
              <div className={styles.terminalTopline}>
                <h2>Trade</h2>
                {preview ? <span>Preview</span> : null}
              </div>
              <div
                className={styles.modeTabs}
                role="group"
                aria-label="Trade direction"
              >
                {(["BUY", "SELL"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={busy}
                    aria-pressed={mode === value}
                    className={mode === value ? styles.activeMode : ""}
                    onClick={() => {
                      setMode(value);
                      clearQuote();
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div
                className={styles.outcomeToggle}
                role="group"
                aria-label="Outcome"
              >
                {(["YES", "NO"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={busy}
                    aria-pressed={outcome === value}
                    className={
                      outcome === value
                        ? value === "YES"
                          ? styles.yesSelected
                          : styles.noSelected
                        : ""
                    }
                    onClick={() => {
                      setOutcome(value);
                      clearQuote();
                    }}
                  >
                    <span>{value}</span>
                    <strong>
                      {centsLabel(
                        value === "YES"
                          ? market.probabilityYesBps
                          : 10_000 - market.probabilityYesBps,
                      )}
                    </strong>
                  </button>
                ))}
              </div>
              <label className={styles.amountField}>
                <span>{mode === "BUY" ? "You pay" : "You sell"}</span>
                <span>
                  <input
                    inputMode="decimal"
                    disabled={busy}
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      clearQuote();
                    }}
                    aria-label={
                      mode === "BUY" ? "USDG amount" : `${outcome} amount`
                    }
                  />
                  <strong>{mode === "BUY" ? "USDG" : outcome}</strong>
                </span>
                {mode === "SELL" && wallet ? (
                  <small>
                    Balance {formatPredictionOutcome(selectedBalance, outcome)}
                  </small>
                ) : null}
              </label>

              {shownQuote ? (
                <div className={styles.orderPreview}>
                  <p
                    className="sr-only"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {orderAnnouncement}
                  </p>
                  {shownQuote.buyPayout ? (
                    <section
                      className={styles.payoutSummary}
                      data-outcome={shownQuote.buyPayout.outcome}
                      aria-label="Potential payout"
                    >
                      <div className={styles.payoutHeadline}>
                        <span>Potential payout</span>
                        <strong>
                          {shownQuote.buyPayout.winningPayoutLabel}
                        </strong>
                        <small>
                          This order if {shownQuote.buyPayout.outcome} wins,
                          based on the current quote. Trading fees included;{" "}
                          network fee excluded.
                        </small>
                      </div>
                      <dl className={styles.payoutMetrics}>
                        <div>
                          <dt>Potential profit</dt>
                          <dd
                            data-tone={
                              shownQuote.buyPayout.potentialProfitAtoms >= 0n
                                ? "positive"
                                : "negative"
                            }
                          >
                            {shownQuote.buyPayout.potentialProfitLabel}
                          </dd>
                        </div>
                        <div>
                          <dt>Max market loss</dt>
                          <dd>{shownQuote.buyPayout.maximumLossLabel}</dd>
                        </div>
                      </dl>
                    </section>
                  ) : null}
                  <div className={styles.quoteReceipt}>
                    <div>
                      <span>
                        {shownQuote.buyPayout
                          ? "Shares received"
                          : "Estimated proceeds"}
                      </span>
                      <strong>{shownQuote.outputLabel}</strong>
                    </div>
                    <div>
                      <span>
                        {shownQuote.buyPayout
                          ? "Minimum shares"
                          : "Minimum proceeds"}
                      </span>
                      <strong>{shownQuote.minimumLabel}</strong>
                    </div>
                    <div>
                      <span>Average price</span>
                      <strong>{centsLabel(shownQuote.averagePriceBps)}</strong>
                    </div>
                    <div>
                      <span>Trading fee</span>
                      <strong>
                        0.02%
                        {selectedProtocolFee
                          ? ` + ${selectedProtocolFee / 100} bps protocol`
                          : ""}
                      </strong>
                    </div>
                    <details className={styles.quoteDetails}>
                      <summary>Price details</summary>
                      <div>
                        <span>YES chance after trade</span>
                        <strong>
                          {probabilityLabel(shownQuote.afterYesBps)}
                        </strong>
                      </div>
                      <div>
                        <span>Price impact</span>
                        <strong>
                          {probabilityLabel(shownQuote.priceImpactBps)}
                        </strong>
                      </div>
                      <div>
                        <span>Market depth</span>
                        <strong>{shownQuote.depthLabel}</strong>
                      </div>
                      {shownQuote.buyPayout ? (
                        <div>
                          <span>Minimum payout</span>
                          <strong>
                            {shownQuote.buyPayout.minimumWinningPayoutLabel}
                          </strong>
                        </div>
                      ) : null}
                      {shownQuote.buyPayout ? (
                        <div>
                          <span>
                            Minimum profit if {shownQuote.buyPayout.outcome}{" "}
                            wins
                          </span>
                          <strong>
                            {shownQuote.buyPayout.minimumWinningProfitLabel}
                          </strong>
                        </div>
                      ) : null}
                      {shownQuote.buyPayout ? (
                        <div>
                          <span>Minimum neutral payout</span>
                          <strong>
                            {shownQuote.buyPayout.minimumNeutralPayoutLabel}
                          </strong>
                        </div>
                      ) : null}
                      {shownQuote.refundLabel ? (
                        <div>
                          <span>Estimated refund</span>
                          <strong>{shownQuote.refundLabel}</strong>
                        </div>
                      ) : null}
                      {shownQuote.refundLabel && shownQuote.buyPayout ? (
                        <div>
                          <span>Estimated cost after refund</span>
                          <strong>
                            {shownQuote.buyPayout.estimatedCostLabel}
                          </strong>
                        </div>
                      ) : null}
                      <div>
                        <span>Slippage limit</span>
                        <strong>
                          {PREDICTION_DEFAULT_SLIPPAGE_BPS / 100}%
                        </strong>
                      </div>
                    </details>
                  </div>
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
                  ? phase === "signing"
                    ? "Sign in wallet"
                    : phase === "confirming"
                      ? "Confirming"
                      : "Getting price"
                  : !shownQuote
                    ? preview
                      ? "Preview order"
                      : "Review order"
                    : preview
                      ? "Update preview"
                      : !wallet
                        ? "Connect wallet"
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
              <h2>
                {market.state === "FINAL_INVALID"
                  ? "Neutral payout"
                  : market.state === "FINAL_YES"
                    ? "YES won"
                    : "NO won"}
              </h2>
              <p>
                {market.state === "FINAL_INVALID"
                  ? "Every YES and NO token redeems for 0.50 USDG."
                  : "Each winning token redeems for 1 USDG. Losing tokens redeem for zero."}
              </p>
              {wallet ? (
                <div className={styles.balancePair}>
                  <span>
                    YES{" "}
                    <strong>
                      {formatPredictionOutcome(market.yesBalanceAtoms)}
                    </strong>
                  </span>
                  <span>
                    NO{" "}
                    <strong>
                      {formatPredictionOutcome(market.noBalanceAtoms)}
                    </strong>
                  </span>
                </div>
              ) : null}
              <button
                className={styles.terminalAction}
                disabled={busy || Boolean(wallet && redeemableAtoms === 0n)}
                type="button"
                onClick={() =>
                  preview
                    ? setMessage(
                        "Preview only. No wallet request will be made.",
                      )
                    : wallet
                      ? void handleLifecycle("REDEEM")
                      : openWallet()
                }
              >
                {busy
                  ? "Confirming payout"
                  : !wallet
                    ? "Connect to redeem"
                    : redeemableAtoms > 0n
                      ? "Redeem to wallet"
                      : "No payout available"}
              </button>
            </div>
          ) : (
            <div className={styles.settlementTerminal}>
              <LockKeyhole aria-hidden="true" size={24} />
              <span className={styles.terminalLabel}>Trading closed</span>
              <h2>
                {market.blockTimestamp <= market.observationTime
                  ? "Waiting for result time"
                  : "Ready to resolve"}
              </h2>
              <p>
                {market.blockTimestamp <= market.observationTime
                  ? `Trading stopped one minute before the result time. The result can be checked after ${utcDate(market.observationTime)}.`
                  : "The result can now be checked from Chainlink. Anyone can finish the market."}
              </p>
              {market.blockTimestamp > market.observationTime ? (
                <button
                  className={styles.terminalAction}
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    preview
                      ? setMessage(
                          "Preview only. No wallet request will be made.",
                        )
                      : wallet
                        ? void handleLifecycle("RESOLVE")
                        : openWallet()
                  }
                >
                  {busy
                    ? "Checking result"
                    : !wallet
                      ? "Connect to resolve"
                      : "Resolve market"}
                </button>
              ) : null}
              {lifecycleAction &&
              market.blockTimestamp > market.observationTime ? (
                <button
                  className={styles.secondaryTerminalAction}
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    preview
                      ? setMessage("Preview only.")
                      : wallet
                        ? void handleLifecycle(lifecycleAction)
                        : openWallet()
                  }
                >
                  {lifecycleAction === "FINALIZE_CHECKPOINT"
                    ? "Use confirmed result"
                    : lifecycleAction === "FINALIZE_UNAVAILABLE"
                      ? "Close as neutral"
                      : lifecycleAction === "REQUEST_UNPROVEN_FALLBACK"
                        ? "Start neutral fallback"
                        : "Finish neutral fallback"}
                </button>
              ) : null}
            </div>
          )}
          {message ? (
            <p className={styles.terminalStatus} role="status">
              {message}
            </p>
          ) : null}
          <p
            aria-atomic="true"
            aria-live="polite"
            className="sr-only"
            role="status"
          >
            {refreshing ? "Refreshing market data." : refreshError}
          </p>
          {refreshError ? (
            <p className={styles.refreshMarketStatus} id="market-refresh-status">
              {refreshError}
            </p>
          ) : null}
          <button
            aria-busy={refreshing}
            aria-describedby={refreshError ? "market-refresh-status" : undefined}
            className={styles.refreshMarket}
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" size={13} />
            {refreshing ? "Refreshing" : "Refresh market"}
          </button>
        </aside>
      </div>
    </main>
  );
}
