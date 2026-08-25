"use client";

import Link from "next/link";
import {
  ArrowRight,
  CircleDollarSign,
  Plus,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import styles from "@/components/prediction-market-experience.module.css";
import { useWallet } from "@/components/wallet-provider";
import { getPredictionMarketReleaseConfig } from "@/lib/prediction-market-chain";
import {
  PredictionPortfolioReadError,
  createPredictionPortfolioRequest,
  derivePredictionPortfolioPosition,
  isPredictionPortfolioRequestCurrent,
  readPredictionMarketPortfolio,
  type PredictionMarketPortfolio as PredictionMarketPortfolioData,
  type PredictionPortfolioCreatedMarket,
  type PredictionPortfolioHistoryEntry,
  type PredictionPortfolioPosition,
  type PredictionPortfolioRequest,
} from "@/lib/prediction-market-portfolio";
import {
  formatPredictionMarketObservation,
  formatPredictionOutcome,
  formatPredictionUsdg,
  type PredictionMarketView,
  type PredictionOutcome,
} from "@/lib/prediction-market-trading";

export type PredictionPortfolioTabV1 = "positions" | "created" | "history";
export type PredictionPortfolioPhaseV1 = "loading" | "ready" | "error";

export type PredictionPortfolioSideViewModelV1 = Readonly<{
  outcome: PredictionOutcome;
  shares: string;
}>;

export type PredictionPortfolioPositionSourceV1 = PredictionPortfolioPosition;

export type PredictionPortfolioItemViewModelV1 = Readonly<{
  actionLabel: string;
  actionTone: "primary" | "quiet";
  artworkLabel: string;
  href: string;
  id: string;
  metricLabel: string;
  payoutDetail: string;
  payoutLabel: string;
  payoutTone: "pending" | "ready" | "settled";
  positionLabel: string;
  probabilityLabel: string;
  probabilityMetricLabel: "Probability" | "Result";
  probabilityYesPercent: number;
  sides: readonly PredictionPortfolioSideViewModelV1[];
  statusLabel: string;
  statusTone: "open" | "pending" | "final";
  timeLabel: string;
  title: string;
}>;

/**
 * Stable presentation boundary for the profile activity API. The current
 * component builds this from the complete portfolio reader; a profile API can provide
 * all three arrays without changing the panel or card layout.
 */
export type PredictionPortfolioViewModelV1 = Readonly<{
  created: readonly PredictionPortfolioItemViewModelV1[];
  errorMessage: string | null;
  history: readonly PredictionPortfolioItemViewModelV1[];
  phase: PredictionPortfolioPhaseV1;
  positions: readonly PredictionPortfolioItemViewModelV1[];
  refreshing: boolean;
  statusMessage: string;
}>;

export type PredictionMarketPortfolioProps = Readonly<{
  onRefresh?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  viewModel?: PredictionPortfolioViewModelV1;
}>;

type InternalPortfolioState = Readonly<{
  accountKey: string | null;
  data: PredictionMarketPortfolioData | null;
  errorMessage: string;
  phase: "idle" | PredictionPortfolioPhaseV1;
}>;

const INITIAL_INTERNAL_STATE: InternalPortfolioState = Object.freeze({
  accountKey: null,
  data: null,
  errorMessage: "",
  phase: "idle",
});

const OUTCOME_FACE_SCALE = 10n;
const PORTFOLIO_ERROR =
  "Unable to load your prediction activity. Check your connection and try again.";
const PORTFOLIO_PARTIAL_ERROR =
  "Some markets could not be verified. Refresh to try them again.";
const PORTFOLIO_INITIAL_VISIBLE_ITEMS = 12;
const PORTFOLIO_VISIBLE_ITEM_STEP = 12;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const predictionPortfolioLoadingPlaceholderCount = 3;

const PORTFOLIO_TABS = [
  { id: "positions", label: "Positions" },
  { id: "created", label: "Created" },
  { id: "history", label: "History" },
] as const;

function clampProbability(probabilityYesBps: number) {
  return Math.min(100, Math.max(0, probabilityYesBps / 100));
}

function marketProbabilityPresentation(market: PredictionMarketView) {
  if (market.state === "FINAL_YES") {
    return {
      probabilityLabel: "YES won",
      probabilityMetricLabel: "Result" as const,
      probabilityYesPercent: 100,
    };
  }
  if (market.state === "FINAL_NO") {
    return {
      probabilityLabel: "NO won",
      probabilityMetricLabel: "Result" as const,
      probabilityYesPercent: 0,
    };
  }
  if (market.state === "FINAL_INVALID") {
    return {
      probabilityLabel: "Neutral",
      probabilityMetricLabel: "Result" as const,
      probabilityYesPercent: 50,
    };
  }
  const probabilityYesPercent = clampProbability(market.probabilityYesBps);
  return {
    probabilityLabel: `${probabilityYesPercent.toFixed(0)}% YES`,
    probabilityMetricLabel: "Probability" as const,
    probabilityYesPercent,
  };
}

function countdown(target: bigint, current: bigint) {
  const seconds = target > current ? Number(target - current) : 0;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function resultTimeLabel(timestamp: bigint) {
  try {
    return formatPredictionMarketObservation(timestamp);
  } catch {
    return "Result time unavailable";
  }
}

export function predictionPortfolioPositionViewModelV1(
  input: PredictionMarketView | PredictionPortfolioPositionSourceV1,
): PredictionPortfolioItemViewModelV1 {
  const source = "market" in input ? input : predictionPortfolioPositionSourceV1(input);
  const market = source.market;
  const probability = marketProbabilityPresentation(market);
  const sides = ([
    ["YES", source.yesAtoms],
    ["NO", source.noAtoms],
  ] as const).flatMap(([outcome, balance]) => balance > 0n
    ? [{ outcome, shares: formatPredictionOutcome(balance) }]
    : []);
  const resultTime = resultTimeLabel(market.observationTime);
  const tradingOpen = source.lifecycle === "open" && !source.tradingClosed;
  const maximumPayoutAtoms = (source.yesAtoms > source.noAtoms
    ? source.yesAtoms
    : source.noAtoms) * OUTCOME_FACE_SCALE;
  const potentialPayoutLabel = formatPredictionUsdg(maximumPayoutAtoms);
  const potentialPayoutDetail = source.yesAtoms > 0n && source.noAtoms > 0n
    ? "The winning side pays 1 USDG per share; a neutral result pays 0.50 per YES and NO share."
    : "Pays 1 USDG per share if your held side wins; a neutral result pays 0.50 per share.";

  if (tradingOpen) {
    return Object.freeze({
      actionLabel: "Trade",
      actionTone: "primary",
      artworkLabel: "BTC",
      href: `/markets/${market.semanticKey}`,
      id: market.semanticKey,
      metricLabel: "Potential payout",
      payoutDetail: potentialPayoutDetail,
      payoutLabel: potentialPayoutLabel,
      payoutTone: "pending",
      positionLabel: "Open position",
      ...probability,
      sides: Object.freeze(sides),
      statusLabel: "Trading open",
      statusTone: "open",
      timeLabel: `Closes in ${countdown(market.cutoff, market.blockTimestamp)}`,
      title: market.title,
    });
  }

  if (source.result === "pending") {
    return Object.freeze({
      actionLabel: "View market",
      actionTone: "quiet",
      artworkLabel: "BTC",
      href: `/markets/${market.semanticKey}`,
      id: market.semanticKey,
      metricLabel: "Potential payout",
      payoutDetail: potentialPayoutDetail,
      payoutLabel: potentialPayoutLabel,
      payoutTone: "pending",
      positionLabel: "Position held",
      ...probability,
      sides: Object.freeze(sides),
      statusLabel: "Awaiting result",
      statusTone: "pending",
      timeLabel: `Result ${resultTime}`,
      title: market.title,
    });
  }

  const invalid = source.result === "neutral";
  const winningOutcome = source.finalOutcome === "YES" ? "YES" : "NO";
  const redeemable = source.redeemableAtoms > 0n;
  const resultLabel = source.result === "won"
    ? "Won"
    : source.result === "lost"
      ? "Lost"
      : source.result === "mixed"
        ? `${winningOutcome} won`
        : "Neutral";
  const payoutDetail = invalid
    ? `${redeemable ? "Redeemable now. " : ""}YES and NO each redeem for 0.50 USDG per share.`
    : redeemable
      ? `Redeemable now. ${winningOutcome} redeems for 1 USDG per share; the other side settles at zero.`
      : `${winningOutcome} won; your held side settles at zero.`;

  return Object.freeze({
    actionLabel: redeemable ? "Redeem payout" : "View market",
    actionTone: redeemable ? "primary" : "quiet",
    artworkLabel: "BTC",
    href: `/markets/${market.semanticKey}`,
    id: market.semanticKey,
    metricLabel: "Final payout",
    payoutDetail,
    payoutLabel: formatPredictionUsdg(source.redeemableAtoms),
    payoutTone: redeemable ? "ready" : "settled",
    positionLabel: "Final position",
    ...probability,
    sides: Object.freeze(sides),
    statusLabel: resultLabel,
    statusTone: "final",
    timeLabel: `Result ${resultTime}`,
    title: market.title,
  });
}

function predictionPortfolioPositionSourceV1(
  market: PredictionMarketView,
): PredictionPortfolioPositionSourceV1 {
  return derivePredictionPortfolioPosition(market);
}

function marketLifecycleSummary(market: PredictionMarketView) {
  const resultTime = resultTimeLabel(market.observationTime);
  if (market.state === "FINAL_YES") {
    return {
      statusLabel: "YES won",
      statusTone: "final" as const,
      timeLabel: `Result ${resultTime}`,
    };
  }
  if (market.state === "FINAL_NO") {
    return {
      statusLabel: "NO won",
      statusTone: "final" as const,
      timeLabel: `Result ${resultTime}`,
    };
  }
  if (market.state === "FINAL_INVALID") {
    return {
      statusLabel: "Neutral result",
      statusTone: "final" as const,
      timeLabel: `Result ${resultTime}`,
    };
  }
  if (market.blockTimestamp >= market.cutoff) {
    return {
      statusLabel: "Awaiting result",
      statusTone: "pending" as const,
      timeLabel: `Result ${resultTime}`,
    };
  }
  return {
    statusLabel: "Trading open",
    statusTone: "open" as const,
    timeLabel: `Closes in ${countdown(market.cutoff, market.blockTimestamp)}`,
  };
}

export function predictionPortfolioCreatedViewModelV1(
  entry: PredictionPortfolioCreatedMarket,
): PredictionPortfolioItemViewModelV1 {
  const market = entry.market;
  const probability = marketProbabilityPresentation(market);
  const lifecycle = marketLifecycleSummary(market);
  return Object.freeze({
    actionLabel: "View market",
    actionTone: "quiet",
    artworkLabel: "BTC",
    href: `/markets/${market.semanticKey}`,
    id: `created:${market.semanticKey}:${entry.transactionHash}:${entry.logIndex}`,
    metricLabel: "Position",
    payoutDetail: "Creating a market does not add YES or NO shares.",
    payoutLabel: "No shares",
    payoutTone: "pending",
    positionLabel: "Created market",
    ...probability,
    sides: Object.freeze([]),
    ...lifecycle,
    title: market.title,
  });
}

function historySides(
  entry: PredictionPortfolioHistoryEntry,
): readonly PredictionPortfolioSideViewModelV1[] {
  const signed = (atoms: bigint, sign: "+" | "-") =>
    `${sign}${formatPredictionOutcome(atoms)}`;
  if (entry.kind === "bought") {
    return Object.freeze([{
      outcome: entry.outcome,
      shares: signed(entry.outcomeAtoms, "+"),
    }]);
  }
  if (entry.kind === "sold") {
    const complement: PredictionOutcome = entry.outcome === "YES" ? "NO" : "YES";
    const netSoldAtoms = entry.outcomeAtoms - entry.soldRefundAtoms;
    return Object.freeze([
      ...(netSoldAtoms > 0n
        ? [{ outcome: entry.outcome, shares: signed(netSoldAtoms, "-") }]
        : []),
      ...(entry.complementRefundAtoms > 0n
        ? [{
            outcome: complement,
            shares: signed(entry.complementRefundAtoms, "+"),
          }]
        : []),
    ]);
  }
  if (entry.kind === "transfer") {
    const sign = entry.direction === "in" ? "+" : entry.direction === "out" ? "-" : null;
    return Object.freeze([{
      outcome: entry.outcome,
      shares: sign
        ? signed(entry.outcomeAtoms, sign)
        : formatPredictionOutcome(entry.outcomeAtoms),
    }]);
  }
  if (
    entry.kind === "split" &&
    (entry.accountRole === "recipient" || entry.accountRole === "self")
  ) {
    return Object.freeze(([
      { outcome: "YES", shares: signed(entry.outcomeAtoms, "+") },
      { outcome: "NO", shares: signed(entry.outcomeAtoms, "+") },
    ] as const));
  }
  if (
    entry.kind === "merged" &&
    (entry.accountRole === "holder" || entry.accountRole === "self")
  ) {
    return Object.freeze(([
      { outcome: "YES", shares: signed(entry.outcomeAtoms, "-") },
      { outcome: "NO", shares: signed(entry.outcomeAtoms, "-") },
    ] as const));
  }
  if (entry.kind === "redeemed") {
    if (entry.accountRole === "recipient") return Object.freeze([]);
    return Object.freeze(([
      ["YES", entry.yesAtoms],
      ["NO", entry.noAtoms],
    ] as const).flatMap(([outcome, atoms]) => atoms > 0n
      ? [{ outcome, shares: signed(atoms, "-") }]
      : []));
  }
  return Object.freeze([]);
}

function historyPresentation(entry: PredictionPortfolioHistoryEntry) {
  if (entry.kind === "created") {
    return {
      metricLabel: "Activity",
      payoutDetail: "Market created by this wallet.",
      payoutLabel: "Created",
      payoutTone: "pending" as const,
      statusLabel: "Market created",
      statusTone: "pending" as const,
    };
  }
  if (entry.kind === "bought") {
    const spent = entry.collateralInAtoms - entry.collateralRefundAtoms;
    return {
      metricLabel: "Spent",
      payoutDetail: `${formatPredictionOutcome(entry.outcomeAtoms)} ${entry.outcome} shares received.`,
      payoutLabel: formatPredictionUsdg(spent),
      payoutTone: "pending" as const,
      statusLabel: `Bought ${entry.outcome}`,
      statusTone: "open" as const,
    };
  }
  if (entry.kind === "sold") {
    const complement = entry.outcome === "YES" ? "NO" : "YES";
    const soldAtoms = entry.outcomeAtoms - entry.soldRefundAtoms;
    const returned = [
      entry.soldRefundAtoms > 0n
        ? `${formatPredictionOutcome(entry.soldRefundAtoms)} ${entry.outcome}`
        : null,
      entry.complementRefundAtoms > 0n
        ? `${formatPredictionOutcome(entry.complementRefundAtoms)} ${complement}`
        : null,
    ].filter((value): value is string => Boolean(value));
    return {
      metricLabel: "Received",
      payoutDetail: `${formatPredictionOutcome(soldAtoms)} ${entry.outcome} sold.${returned.length > 0 ? ` ${returned.join(" and ")} returned.` : " No outcome shares returned."}`,
      payoutLabel: formatPredictionUsdg(entry.collateralAtoms),
      payoutTone: "settled" as const,
      statusLabel: `Sold ${entry.outcome}`,
      statusTone: "pending" as const,
    };
  }
  if (entry.kind === "split") {
    const shares = formatPredictionOutcome(entry.outcomeAtoms);
    if (entry.accountRole === "recipient") {
      return {
        metricLabel: "Shares received",
        payoutDetail: `Received ${shares} YES and ${shares} NO from a direct split.`,
        payoutLabel: `${shares} each`,
        payoutTone: "pending" as const,
        statusLabel: "Received YES + NO",
        statusTone: "open" as const,
      };
    }
    return {
      metricLabel: "Spent",
      payoutDetail: entry.accountRole === "self"
        ? `Created ${shares} YES and ${shares} NO shares.`
        : `Created ${shares} YES and ${shares} NO for another wallet.`,
      payoutLabel: formatPredictionUsdg(entry.collateralAtoms),
      payoutTone: "pending" as const,
      statusLabel: entry.accountRole === "self" ? "Split USDG" : "Funded split",
      statusTone: "open" as const,
    };
  }
  if (entry.kind === "merged") {
    const shares = formatPredictionOutcome(entry.outcomeAtoms);
    return {
      metricLabel: entry.accountRole === "holder" ? "Released" : "Received",
      payoutDetail: entry.accountRole === "self"
        ? `Merged ${shares} YES and ${shares} NO into USDG.`
        : entry.accountRole === "holder"
          ? `Merged ${shares} YES and ${shares} NO; USDG went to another wallet.`
          : "Received USDG from another wallet's direct merge.",
      payoutLabel: formatPredictionUsdg(entry.collateralAtoms),
      payoutTone: "settled" as const,
      statusLabel: "Merged YES + NO",
      statusTone: "pending" as const,
    };
  }
  if (entry.kind === "redeemed") {
    return {
      metricLabel: entry.accountRole === "holder" ? "Payout sent" : "Payout",
      payoutDetail: entry.accountRole === "self"
        ? "Outcome shares redeemed to this wallet."
        : entry.accountRole === "holder"
          ? "Outcome shares redeemed; payout sent to another wallet."
          : "Payout received from another wallet's redemption.",
      payoutLabel: formatPredictionUsdg(entry.collateralAtoms),
      payoutTone: "settled" as const,
      statusLabel: "Payout redeemed",
      statusTone: "final" as const,
    };
  }
  const burned = entry.direction === "out" && entry.to.toLowerCase() === ZERO_ADDRESS;
  const direction = burned
    ? "Burned"
    : entry.direction === "in"
    ? "Received"
    : entry.direction === "out"
      ? "Sent"
      : "Moved";
  return {
    metricLabel: "Shares",
    payoutDetail: burned
      ? "Outcome shares burned onchain."
      : "Outcome shares transferred onchain.",
    payoutLabel: `${formatPredictionOutcome(entry.outcomeAtoms)} ${entry.outcome}`,
    payoutTone: "pending" as const,
    statusLabel: `${direction} ${entry.outcome}`,
    statusTone: "pending" as const,
  };
}

export function predictionPortfolioHistoryViewModelV1(
  entry: PredictionPortfolioHistoryEntry,
): PredictionPortfolioItemViewModelV1 {
  const market = entry.market;
  const probability = marketProbabilityPresentation(market);
  const presentation = historyPresentation(entry);
  return Object.freeze({
    actionLabel: "View market",
    actionTone: "quiet",
    artworkLabel: "BTC",
    href: `/markets/${market.semanticKey}`,
    id: `history:${entry.transactionHash}:${entry.logIndex}`,
    positionLabel: presentation.statusLabel,
    ...probability,
    sides: historySides(entry),
    timeLabel: "Observed onchain",
    title: market.title,
    ...presentation,
  });
}

function tabLabel(tab: PredictionPortfolioTabV1) {
  return PORTFOLIO_TABS.find((candidate) => candidate.id === tab)?.label ?? "Prediction activity";
}

function itemCount(
  model: PredictionPortfolioViewModelV1,
  tab: PredictionPortfolioTabV1,
) {
  return model[tab].length;
}

export function PredictionMarketPortfolio({
  onRefresh,
  onRetry,
  viewModel,
}: PredictionMarketPortfolioProps = {}) {
  const { openWallet, wallet } = useWallet();
  const account = wallet?.account ?? null;
  const release = useMemo(() => {
    try {
      return getPredictionMarketReleaseConfig();
    } catch {
      return null;
    }
  }, []);
  const [state, setState] = useState<InternalPortfolioState>(INITIAL_INTERNAL_STATE);
  const [refreshing, setRefreshing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [activeTab, setActiveTab] = useState<PredictionPortfolioTabV1>("positions");
  const [visibleCounts, setVisibleCounts] = useState<Record<PredictionPortfolioTabV1, number>>({
    positions: PORTFOLIO_INITIAL_VISIBLE_ITEMS,
    created: PORTFOLIO_INITIAL_VISIBLE_ITEMS,
    history: PORTFOLIO_INITIAL_VISIBLE_ITEMS,
  });
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<PredictionPortfolioRequest | null>(null);
  const tabRefs = useRef(new Map<PredictionPortfolioTabV1, HTMLButtonElement>());

  const loadPortfolio = useCallback(async (mode: "initial" | "refresh" | "retry") => {
    if (!account || !release) return;
    const accountKey = account.toLowerCase();
    const request = createPredictionPortfolioRequest(
      account,
      `${mode}:${++requestSequenceRef.current}`,
    );
    activeRequestRef.current = request;
    setRefreshing(true);
    setAnnouncement(mode === "initial"
      ? "Loading prediction activity."
      : "Refreshing prediction activity.");
    setState((current) => ({
      ...(mode === "refresh"
        && current.accountKey === accountKey
        && current.phase === "ready"
        ? current
        : INITIAL_INTERNAL_STATE),
      accountKey,
      errorMessage: "",
      phase: mode === "refresh"
        && current.accountKey === accountKey
        && current.phase === "ready"
        ? "ready"
        : "loading",
    }));
    try {
      const data = await readPredictionMarketPortfolio({
        config: release,
        request,
      });
      if (!isPredictionPortfolioRequestCurrent(data, activeRequestRef.current)) return;
      setState({
        accountKey,
        data,
        errorMessage: data.failures.length > 0 ? PORTFOLIO_PARTIAL_ERROR : "",
        phase: "ready",
      });
      const count = data.positions.length;
      setAnnouncement(mode === "initial"
        ? `Prediction activity loaded. ${count} ${count === 1 ? "position" : "positions"}.`
        : `Prediction activity refreshed. ${count} ${count === 1 ? "position" : "positions"}.`);
    } catch (error) {
      const failedRequest = error instanceof PredictionPortfolioReadError
        ? error.request
        : request;
      if (!isPredictionPortfolioRequestCurrent(failedRequest, activeRequestRef.current)) return;
      setState((current) => current.accountKey === accountKey
        && current.phase === "ready"
        && current.data
        ? { ...current, errorMessage: PORTFOLIO_ERROR }
        : {
            ...INITIAL_INTERNAL_STATE,
            accountKey,
            errorMessage: PORTFOLIO_ERROR,
            phase: "error",
          });
      setAnnouncement("Prediction activity could not be loaded.");
    } finally {
      if (isPredictionPortfolioRequestCurrent(request, activeRequestRef.current)) {
        setRefreshing(false);
      }
    }
  }, [account, release]);

  useEffect(() => {
    if (viewModel || !account || !release) return;
    const timer = window.setTimeout(() => void loadPortfolio("initial"), 0);
    return () => {
      window.clearTimeout(timer);
      if (activeRequestRef.current?.account.toLowerCase() === account.toLowerCase()) {
        activeRequestRef.current = null;
      }
    };
  }, [account, loadPortfolio, release, viewModel]);

  const internalViewModel = useMemo<PredictionPortfolioViewModelV1>(() => {
    const accountKey = account?.toLowerCase() ?? null;
    const isCurrentAccount = state.accountKey === accountKey;
    const data = isCurrentAccount ? state.data : null;
    return {
      created: data
        ? data.created.map(predictionPortfolioCreatedViewModelV1)
        : Object.freeze([]),
      errorMessage: isCurrentAccount ? state.errorMessage || null : null,
      history: data
        ? data.history.map(predictionPortfolioHistoryViewModelV1)
        : Object.freeze([]),
      phase: !isCurrentAccount || state.phase === "idle" ? "loading" : state.phase,
      positions: data
        ? data.positions.map(predictionPortfolioPositionViewModelV1)
        : Object.freeze([]),
      refreshing,
      statusMessage: announcement,
    };
  }, [account, announcement, refreshing, state]);
  const model = viewModel ?? internalViewModel;
  const accessState = viewModel
    ? "ready"
    : !release
      ? "unavailable"
      : !account
        ? "wallet"
        : "ready";
  const isBusy = accessState === "ready"
    && (model.phase === "loading" || model.refreshing);
  const canRefresh = viewModel
    ? Boolean(onRefresh || onRetry)
    : accessState === "ready";
  const activeItems = model[activeTab];
  const visibleItems = activeItems.slice(0, visibleCounts[activeTab]);
  const remainingItemCount = Math.max(0, activeItems.length - visibleItems.length);

  const runControlledAction = useCallback(async (
    action: (() => void | Promise<void>) | undefined,
    pendingMessage: string,
  ) => {
    if (!action) return;
    setAnnouncement(pendingMessage);
    try {
      await action();
      setAnnouncement("");
    } catch {
      setAnnouncement("Prediction activity could not be updated.");
    }
  }, []);

  const refreshPortfolio = useCallback(() => {
    if (viewModel) {
      void runControlledAction(onRefresh ?? onRetry, "Refreshing prediction activity.");
      return;
    }
    void loadPortfolio("refresh");
  }, [loadPortfolio, onRefresh, onRetry, runControlledAction, viewModel]);

  const retryPortfolio = useCallback(() => {
    if (viewModel) {
      void runControlledAction(onRetry ?? onRefresh, "Retrying prediction activity.");
      return;
    }
    void loadPortfolio("retry");
  }, [loadPortfolio, onRefresh, onRetry, runControlledAction, viewModel]);

  function selectTab(tab: PredictionPortfolioTabV1, moveFocus = false) {
    const count = itemCount(model, tab);
    setActiveTab(tab);
    setAnnouncement(
      `${tabLabel(tab)} tab. ${count} ${count === 1 ? "item" : "items"}.`,
    );
    if (moveFocus) window.requestAnimationFrame(() => tabRefs.current.get(tab)?.focus());
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tab: PredictionPortfolioTabV1,
  ) {
    const currentIndex = PORTFOLIO_TABS.findIndex((candidate) => candidate.id === tab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % PORTFOLIO_TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + PORTFOLIO_TABS.length) % PORTFOLIO_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = PORTFOLIO_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(PORTFOLIO_TABS[nextIndex].id, true);
  }

  return (
    <section
      className={styles.portfolioSection}
      aria-busy={isBusy}
      aria-labelledby="prediction-portfolio-title"
      data-visible-card-count={
        visibleItems.length > 0
          ? Math.min(visibleItems.length, 2)
          : undefined
      }
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement || model.statusMessage}
      </p>

      <header className={styles.portfolioHeading}>
        <div>
          <h2 id="prediction-portfolio-title">Predictions</h2>
        </div>
        {canRefresh ? (
          <button
            className={styles.portfolioRefresh}
            type="button"
            aria-busy={isBusy || undefined}
            disabled={isBusy}
            onClick={refreshPortfolio}
          >
            <RefreshCw
              className={styles.portfolioRefreshIcon}
              aria-hidden="true"
              size={15}
              strokeWidth={2}
            />
            <span>{isBusy ? "Refreshing" : "Refresh"}</span>
          </button>
        ) : null}
      </header>

      <div className={styles.portfolioTabs} role="tablist" aria-label="Prediction activity">
        {PORTFOLIO_TABS.map((tab) => (
          <button
            aria-controls={`prediction-${tab.id}-panel`}
            aria-selected={activeTab === tab.id}
            id={`prediction-${tab.id}-tab`}
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            ref={(node) => {
              if (node) tabRefs.current.set(tab.id, node);
              else tabRefs.current.delete(tab.id);
            }}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            <span>{tab.label}</span>
            {model[tab.id].length > 0 ? <small>{model[tab.id].length}</small> : null}
          </button>
        ))}
      </div>

      {PORTFOLIO_TABS.map((tab) => (
        <div
          aria-labelledby={`prediction-${tab.id}-tab`}
          className={styles.portfolioTabPanel}
          hidden={activeTab !== tab.id}
          id={`prediction-${tab.id}-panel`}
          key={tab.id}
          role="tabpanel"
          tabIndex={activeTab === tab.id ? 0 : -1}
        >
          {activeTab === tab.id ? (
            <>
              {accessState === "wallet" ? (
                <PortfolioEmptyState
                  icon={<WalletCards aria-hidden="true" size={21} strokeWidth={1.8} />}
                  title="Connect to see prediction activity"
                  description="Your positions, markets and payouts stay tied to your wallet."
                  action={(
                    <button
                      className={styles.portfolioPrimaryAction}
                      type="button"
                      onClick={openWallet}
                    >
                      Connect wallet
                    </button>
                  )}
                />
              ) : accessState === "unavailable" ? (
                <PortfolioEmptyState
                  icon={<CircleDollarSign aria-hidden="true" size={21} strokeWidth={1.8} />}
                  title="Prediction activity is unavailable"
                  description="Browse current markets while profile activity is being restored."
                  action={(
                    <Link className={styles.portfolioSecondaryAction} href="/markets">
                      Browse markets
                    </Link>
                  )}
                />
              ) : model.phase === "loading" && visibleItems.length === 0 ? (
                <PredictionPortfolioLoadingState />
              ) : model.phase === "error" && visibleItems.length === 0 ? (
                <div className={styles.portfolioError} role="alert">
                  <span>
                    <strong>Prediction activity could not be loaded</strong>
                    <small>{model.errorMessage ?? PORTFOLIO_ERROR}</small>
                  </span>
                  <button type="button" onClick={retryPortfolio}>Retry</button>
                </div>
              ) : (
                <>
                  {model.errorMessage ? (
                    <div className={styles.portfolioInlineError} role="alert">
                      <span>{model.errorMessage}</span>
                      <button type="button" onClick={retryPortfolio}>Retry</button>
                    </div>
                  ) : null}
                  {visibleItems.length > 0 ? (
                    <>
                      <div className={styles.portfolioCards}>
                        {visibleItems.map((item) => (
                          <PortfolioCard item={item} key={item.id} />
                        ))}
                      </div>
                      {remainingItemCount > 0 ? (
                        <button
                          className={styles.portfolioShowMore}
                          type="button"
                          onClick={() => {
                            const increment = Math.min(
                              PORTFOLIO_VISIBLE_ITEM_STEP,
                              remainingItemCount,
                            );
                            setVisibleCounts((current) => ({
                              ...current,
                              [activeTab]: current[activeTab] + increment,
                            }));
                            setAnnouncement(
                              `${increment} more items shown in ${tabLabel(activeTab)}.`,
                            );
                            if (increment === remainingItemCount) {
                              window.requestAnimationFrame(() => {
                                tabRefs.current.get(activeTab)?.focus();
                              });
                            }
                          }}
                        >
                          Show {Math.min(PORTFOLIO_VISIBLE_ITEM_STEP, remainingItemCount)} more
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <PortfolioTabEmptyState tab={activeTab} />
                  )}
                </>
              )}

            </>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function PredictionPortfolioLoadingState() {
  return (
    <div className={styles.portfolioLoadingCards} aria-hidden="true">
      {Array.from(
        { length: predictionPortfolioLoadingPlaceholderCount },
        (_, item) => (
          <div className={styles.portfolioLoadingCard} key={item}>
            <span className={styles.portfolioLoadingArtwork} />
            <span className={styles.portfolioLoadingCopy}>
              <span />
              <span />
            </span>
            <span className={styles.portfolioLoadingMetrics}>
              <span />
              <span />
            </span>
            <span className={styles.portfolioLoadingAction} />
          </div>
        ),
      )}
    </div>
  );
}

function PortfolioCard({ item }: Readonly<{ item: PredictionPortfolioItemViewModelV1 }>) {
  const probabilityStyle = {
    "--portfolio-probability": `${item.probabilityYesPercent}%`,
  } as CSSProperties;

  return (
    <article className={styles.portfolioCard}>
      <div className={styles.portfolioArtwork} style={probabilityStyle} aria-hidden="true">
        <span>{item.artworkLabel}</span>
        <strong>{item.probabilityYesPercent.toFixed(0)}%</strong>
      </div>

      <div className={styles.portfolioCardCopy}>
        <div className={styles.portfolioCardStatus} data-tone={item.statusTone}>
          <span>{item.statusLabel}</span>
          <small>{item.timeLabel}</small>
        </div>
        <h3>
          <Link href={item.href}>{item.title}</Link>
        </h3>
        <span className="sr-only">{item.positionLabel}: </span>
        <div className={styles.portfolioHoldings}>
          {item.sides.length > 0 ? item.sides.map((side) => (
            <span data-outcome={side.outcome} key={side.outcome}>
              <strong>{side.outcome}</strong>
              <small>{side.shares} shares</small>
            </span>
          )) : <small>{item.positionLabel}</small>}
        </div>
      </div>

      <dl className={styles.portfolioMetrics}>
        <div>
          <dt>{item.probabilityMetricLabel}</dt>
          <dd>{item.probabilityLabel}</dd>
        </div>
        <div data-tone={item.payoutTone}>
          <dt>{item.metricLabel}</dt>
          <dd>{item.payoutLabel}</dd>
          <small>{item.payoutDetail}</small>
        </div>
      </dl>

      <div className={styles.portfolioCardActions}>
        <Link data-tone={item.actionTone} href={item.href}>
          <span>{item.actionLabel}</span>
          <ArrowRight aria-hidden="true" size={15} strokeWidth={2} />
        </Link>
      </div>
    </article>
  );
}

function PortfolioTabEmptyState({ tab }: Readonly<{ tab: PredictionPortfolioTabV1 }>) {
  if (tab === "created") {
    return (
      <PortfolioEmptyState
        icon={<Plus aria-hidden="true" size={21} strokeWidth={1.8} />}
        title="No created markets yet"
        description="Create a prediction and it will appear here."
        action={<Link className={styles.portfolioPrimaryAction} href="/launch">Create a prediction</Link>}
      />
    );
  }
  if (tab === "history") {
    return (
      <PortfolioEmptyState
        icon={<CircleDollarSign aria-hidden="true" size={21} strokeWidth={1.8} />}
        title="No prediction history yet"
        description="Trades, transfers and payouts will appear here."
        action={<Link className={styles.portfolioSecondaryAction} href="/markets">Browse markets</Link>}
      />
    );
  }
  return (
    <PortfolioEmptyState
      icon={<WalletCards aria-hidden="true" size={21} strokeWidth={1.8} />}
      title="No open positions yet"
      description="Markets you trade will appear here with their current result status."
      action={<Link className={styles.portfolioPrimaryAction} href="/markets">Find a market</Link>}
    />
  );
}

function PortfolioEmptyState({
  action,
  description,
  icon,
  title,
}: Readonly<{
  action?: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}>) {
  return (
    <div className={styles.portfolioEmpty}>
      <span className={styles.portfolioEmptyIcon}>{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      {action ? <div className={styles.portfolioEmptyAction}>{action}</div> : null}
    </div>
  );
}
