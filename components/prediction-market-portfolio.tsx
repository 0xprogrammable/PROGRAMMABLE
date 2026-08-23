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
  formatPredictionMarketObservation,
  formatPredictionOutcome,
  readPredictionMarketDirectory,
  type PredictionMarketView,
  type PredictionOutcome,
} from "@/lib/prediction-market-trading";

export type PredictionPortfolioTabV1 = "positions" | "created" | "history";
export type PredictionPortfolioPhaseV1 = "loading" | "ready" | "error";

export type PredictionPortfolioSideViewModelV1 = Readonly<{
  outcome: PredictionOutcome;
  shares: string;
}>;

export type PredictionPortfolioPositionSourceV1 = Readonly<{
  finalOutcome: "YES" | "NO" | "INVALID" | null;
  lifecycle:
    | "open"
    | "trading_closed"
    | "final_yes"
    | "final_no"
    | "final_invalid";
  market: PredictionMarketView;
  noAtoms: bigint;
  redeemableAtoms: bigint;
  result: "pending" | "won" | "lost" | "neutral";
  tradingClosed: boolean;
  yesAtoms: bigint;
}>;

export type PredictionPortfolioItemViewModelV1 = Readonly<{
  actionLabel: string;
  actionTone: "primary" | "quiet";
  artworkLabel: string;
  href: string;
  id: string;
  payoutDetail: string;
  payoutLabel: string;
  payoutTone: "pending" | "ready" | "settled";
  positionLabel: string;
  probabilityLabel: string;
  probabilityYesPercent: number;
  sides: readonly PredictionPortfolioSideViewModelV1[];
  statusLabel: string;
  statusTone: "open" | "pending" | "final";
  timeLabel: string;
  title: string;
}>;

/**
 * Stable presentation boundary for the profile activity API. The current
 * component builds this from the directory reader; a profile API can provide
 * all three arrays without changing the panel or card layout.
 */
export type PredictionPortfolioViewModelV1 = Readonly<{
  canLoadMorePositions: boolean;
  created: readonly PredictionPortfolioItemViewModelV1[];
  errorMessage: string | null;
  history: readonly PredictionPortfolioItemViewModelV1[];
  loadMoreErrorMessage: string | null;
  loadingMorePositions: boolean;
  phase: PredictionPortfolioPhaseV1;
  positions: readonly PredictionPortfolioItemViewModelV1[];
  refreshing: boolean;
  statusMessage: string;
}>;

export type PredictionMarketPortfolioProps = Readonly<{
  onLoadMorePositions?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  viewModel?: PredictionPortfolioViewModelV1;
}>;

type InternalPortfolioState = Readonly<{
  accountKey: string | null;
  errorMessage: string;
  markets: readonly PredictionMarketView[];
  nextCursor: bigint;
  phase: "idle" | PredictionPortfolioPhaseV1;
}>;

type InternalPortfolioRequest = Readonly<{
  accountKey: string;
  requestKey: string;
}>;

const INITIAL_INTERNAL_STATE: InternalPortfolioState = Object.freeze({
  accountKey: null,
  errorMessage: "",
  markets: Object.freeze([]),
  nextCursor: 0n,
  phase: "idle",
});

const PORTFOLIO_SCAN_PAGE_SIZE = 24;
const OUTCOME_FACE_SCALE = 10n;
const PORTFOLIO_ERROR =
  "Unable to load your prediction activity. Check your connection and try again.";
const PORTFOLIO_OLDER_ERROR =
  "Unable to load older positions. Check your connection and try again.";

const PORTFOLIO_TABS = [
  { id: "positions", label: "Positions" },
  { id: "created", label: "Created" },
  { id: "history", label: "History" },
] as const;

function isInternalPortfolioRequestCurrent(
  candidate: InternalPortfolioRequest,
  current: InternalPortfolioRequest | null,
) {
  return Boolean(
    current
    && candidate.accountKey === current.accountKey
    && candidate.requestKey === current.requestKey,
  );
}

function clampProbability(probabilityYesBps: number) {
  return Math.min(100, Math.max(0, probabilityYesBps / 100));
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
  const probabilityYesPercent = clampProbability(market.probabilityYesBps);
  const sides = ([
    ["YES", source.yesAtoms],
    ["NO", source.noAtoms],
  ] as const).flatMap(([outcome, balance]) => balance > 0n
    ? [{ outcome, shares: formatPredictionOutcome(balance) }]
    : []);
  const resultTime = resultTimeLabel(market.observationTime);
  const tradingOpen = source.lifecycle === "open" && !source.tradingClosed;

  if (tradingOpen) {
    return Object.freeze({
      actionLabel: "Trade",
      actionTone: "primary",
      artworkLabel: "BTC",
      href: `/markets/${market.semanticKey}`,
      id: market.semanticKey,
      payoutDetail: "Payout is available after the result is final.",
      payoutLabel: "Not settled",
      payoutTone: "pending",
      positionLabel: "Open position",
      probabilityLabel: `${probabilityYesPercent.toFixed(0)}% YES`,
      probabilityYesPercent,
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
      payoutDetail: "Payout is available when the result is final.",
      payoutLabel: "Awaiting result",
      payoutTone: "pending",
      positionLabel: "Position held",
      probabilityLabel: `${probabilityYesPercent.toFixed(0)}% YES`,
      probabilityYesPercent,
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
      : "Neutral";
  const payoutDetail = invalid
    ? "YES and NO each redeem for 0.50 USDG per share."
    : source.result === "won"
      ? `${winningOutcome} redeems for 1 USDG per share; the other side settles at zero.`
      : `${winningOutcome} won; your held side settles at zero.`;

  return Object.freeze({
    actionLabel: redeemable ? "Redeem payout" : "View market",
    actionTone: redeemable ? "primary" : "quiet",
    artworkLabel: "BTC",
    href: `/markets/${market.semanticKey}`,
    id: market.semanticKey,
    payoutDetail,
    payoutLabel: redeemable ? "Redeemable" : "Settled",
    payoutTone: redeemable ? "ready" : "settled",
    positionLabel: "Final position",
    probabilityLabel: `${probabilityYesPercent.toFixed(0)}% YES`,
    probabilityYesPercent,
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
  const yesAtoms = market.yesBalanceAtoms;
  const noAtoms = market.noBalanceAtoms;
  if (market.state === "FINAL_YES") {
    return {
      finalOutcome: "YES",
      lifecycle: "final_yes",
      market,
      noAtoms,
      redeemableAtoms: yesAtoms * OUTCOME_FACE_SCALE,
      result: yesAtoms > 0n ? "won" : "lost",
      tradingClosed: true,
      yesAtoms,
    };
  }
  if (market.state === "FINAL_NO") {
    return {
      finalOutcome: "NO",
      lifecycle: "final_no",
      market,
      noAtoms,
      redeemableAtoms: noAtoms * OUTCOME_FACE_SCALE,
      result: noAtoms > 0n ? "won" : "lost",
      tradingClosed: true,
      yesAtoms,
    };
  }
  if (market.state === "FINAL_INVALID") {
    return {
      finalOutcome: "INVALID",
      lifecycle: "final_invalid",
      market,
      noAtoms,
      redeemableAtoms: (yesAtoms + noAtoms) * OUTCOME_FACE_SCALE / 2n,
      result: "neutral",
      tradingClosed: true,
      yesAtoms,
    };
  }
  const tradingClosed = market.blockTimestamp >= market.cutoff;
  return {
    finalOutcome: null,
    lifecycle: tradingClosed ? "trading_closed" : "open",
    market,
    noAtoms,
    redeemableAtoms: 0n,
    result: "pending",
    tradingClosed,
    yesAtoms,
  };
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
  onLoadMorePositions,
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
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [activeTab, setActiveTab] = useState<PredictionPortfolioTabV1>("positions");
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<InternalPortfolioRequest | null>(null);
  const tabRefs = useRef(new Map<PredictionPortfolioTabV1, HTMLButtonElement>());

  const loadPortfolio = useCallback(async (mode: "initial" | "refresh" | "retry") => {
    if (!account || !release) return;
    const accountKey = account.toLowerCase();
    const request = {
      accountKey,
      requestKey: `${mode}:${++requestSequenceRef.current}`,
    } satisfies InternalPortfolioRequest;
    activeRequestRef.current = request;
    setOlderError("");
    setLoadingOlder(false);
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
      const directory = await readPredictionMarketDirectory({
        account,
        config: release,
        limit: PORTFOLIO_SCAN_PAGE_SIZE,
      });
      if (!isInternalPortfolioRequestCurrent(request, activeRequestRef.current)) return;
      const markets = directory.markets.filter(
        (market) => market.yesBalanceAtoms > 0n || market.noBalanceAtoms > 0n,
      );
      setState({
        accountKey,
        errorMessage: "",
        markets,
        nextCursor: directory.nextCursor,
        phase: "ready",
      });
      setAnnouncement(mode === "initial"
        ? `Prediction activity loaded. ${markets.length} ${markets.length === 1 ? "position" : "positions"}.`
        : `Prediction activity refreshed. ${markets.length} ${markets.length === 1 ? "position" : "positions"}.`);
    } catch {
      if (!isInternalPortfolioRequestCurrent(request, activeRequestRef.current)) return;
      setState((current) => current.accountKey === accountKey && current.phase === "ready"
        ? { ...current, errorMessage: PORTFOLIO_ERROR }
        : {
            ...INITIAL_INTERNAL_STATE,
            accountKey,
            errorMessage: PORTFOLIO_ERROR,
            phase: "error",
          });
      setAnnouncement("Prediction activity could not be loaded.");
    } finally {
      if (isInternalPortfolioRequestCurrent(request, activeRequestRef.current)) {
        setRefreshing(false);
      }
    }
  }, [account, release]);

  useEffect(() => {
    if (viewModel || !account || !release) return;
    const timer = window.setTimeout(() => void loadPortfolio("initial"), 0);
    return () => {
      window.clearTimeout(timer);
      if (activeRequestRef.current?.accountKey === account.toLowerCase()) {
        activeRequestRef.current = null;
      }
    };
  }, [account, loadPortfolio, release, viewModel]);

  const loadOlderPositions = useCallback(async () => {
    if (
      !account
      || !release
      || state.accountKey !== account.toLowerCase()
      || state.phase !== "ready"
      || state.nextCursor === 0n
      || loadingOlder
    ) return;
    const accountKey = account.toLowerCase();
    const request = {
      accountKey,
      requestKey: `older:${++requestSequenceRef.current}`,
    } satisfies InternalPortfolioRequest;
    activeRequestRef.current = request;
    setLoadingOlder(true);
    setOlderError("");
    setAnnouncement("Loading older positions.");
    try {
      const directory = await readPredictionMarketDirectory({
        account,
        config: release,
        cursor: state.nextCursor,
        limit: PORTFOLIO_SCAN_PAGE_SIZE,
      });
      if (!isInternalPortfolioRequestCurrent(request, activeRequestRef.current)) return;
      const markets = directory.markets.filter(
        (market) => market.yesBalanceAtoms > 0n || market.noBalanceAtoms > 0n,
      );
      setState((current) => {
        if (current.accountKey !== accountKey || current.phase !== "ready") return current;
        const known = new Set(current.markets.map((market) => market.semanticKey.toLowerCase()));
        return {
          ...current,
          markets: [
            ...current.markets,
            ...markets.filter((market) => !known.has(market.semanticKey.toLowerCase())),
          ],
          nextCursor: directory.nextCursor,
        };
      });
      setAnnouncement(
        `${markets.length} older ${markets.length === 1 ? "position" : "positions"} loaded.`,
      );
    } catch {
      if (!isInternalPortfolioRequestCurrent(request, activeRequestRef.current)) return;
      setOlderError(PORTFOLIO_OLDER_ERROR);
      setAnnouncement("Older positions could not be loaded.");
    } finally {
      if (isInternalPortfolioRequestCurrent(request, activeRequestRef.current)) {
        setLoadingOlder(false);
      }
    }
  }, [account, loadingOlder, release, state.accountKey, state.nextCursor, state.phase]);

  const internalViewModel = useMemo<PredictionPortfolioViewModelV1>(() => {
    const accountKey = account?.toLowerCase() ?? null;
    const isCurrentAccount = state.accountKey === accountKey;
    return {
      canLoadMorePositions: isCurrentAccount
        && state.phase === "ready"
        && state.nextCursor > 0n,
      created: Object.freeze([]),
      errorMessage: isCurrentAccount ? state.errorMessage || null : null,
      history: Object.freeze([]),
      loadMoreErrorMessage: olderError || null,
      loadingMorePositions: loadingOlder,
      phase: !isCurrentAccount || state.phase === "idle" ? "loading" : state.phase,
      positions: isCurrentAccount
        ? state.markets.map(predictionPortfolioPositionViewModelV1)
        : Object.freeze([]),
      refreshing,
      statusMessage: announcement,
    };
  }, [account, announcement, loadingOlder, olderError, refreshing, state]);
  const model = viewModel ?? internalViewModel;
  const accessState = viewModel
    ? "ready"
    : !release
      ? "unavailable"
      : !account
        ? "wallet"
        : "ready";
  const isBusy = accessState === "ready"
    && (model.phase === "loading" || model.refreshing || model.loadingMorePositions);
  const canRefresh = viewModel
    ? Boolean(onRefresh || onRetry)
    : accessState === "ready";
  const visibleItems = model[activeTab];

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

  const requestOlderPositions = useCallback(() => {
    if (viewModel) {
      void runControlledAction(onLoadMorePositions, "Loading older positions.");
      return;
    }
    void loadOlderPositions();
  }, [loadOlderPositions, onLoadMorePositions, runControlledAction, viewModel]);

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
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement || model.statusMessage}
      </p>

      <header className={styles.portfolioHeading}>
        <div>
          <span className={styles.portfolioEyebrow}>Profile activity</span>
          <h2 id="prediction-portfolio-title">Predictions</h2>
        </div>
        {canRefresh ? (
          <button
            className={styles.portfolioRefresh}
            type="button"
            disabled={isBusy}
            onClick={refreshPortfolio}
          >
            <RefreshCw aria-hidden="true" size={15} strokeWidth={2} />
            <span>{model.refreshing ? "Refreshing" : "Refresh"}</span>
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
                <PortfolioEmptyState
                  icon={<CircleDollarSign aria-hidden="true" size={21} strokeWidth={1.8} />}
                  title="Loading prediction activity"
                  description="Your latest positions will appear here."
                />
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
                    <div className={styles.portfolioCards}>
                      {visibleItems.map((item) => (
                        <PortfolioCard item={item} key={item.id} />
                      ))}
                    </div>
                  ) : (
                    <PortfolioTabEmptyState tab={activeTab} />
                  )}
                </>
              )}

              {accessState === "ready"
                && activeTab === "positions"
                && model.canLoadMorePositions ? (
                  <button
                    className={styles.portfolioLoadMore}
                    disabled={model.loadingMorePositions}
                    onClick={requestOlderPositions}
                    type="button"
                  >
                    {model.loadingMorePositions
                      ? "Loading older positions"
                      : "Show older positions"}
                  </button>
                ) : null}
              {activeTab === "positions" && model.loadMoreErrorMessage ? (
                <p className={styles.portfolioLoadMoreError} role="alert">
                  {model.loadMoreErrorMessage}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
    </section>
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
        <div className={styles.portfolioHoldings} aria-label={item.positionLabel}>
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
          <dt>Probability</dt>
          <dd>{item.probabilityLabel}</dd>
        </div>
        <div data-tone={item.payoutTone}>
          <dt>Payout</dt>
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
        description="Completed positions and payouts will appear here."
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
