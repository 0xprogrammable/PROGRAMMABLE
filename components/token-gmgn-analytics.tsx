"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import styles from "./token-gmgn-analytics.module.css";

const ANALYTICS_LIMIT = 20;
const ADDRESS = /^0x[0-9a-f]{40}$/u;

type AnalyticsSection = "summary" | "holders" | "traders";
type ViewSection = "overview" | "holders" | "traders";
type ReadState<T> =
  | Readonly<{ status: "loading"; data: null }>
  | Readonly<{ status: "ready"; data: T }>
  | Readonly<{ status: "unavailable"; data: T | null }>
  | Readonly<{ status: "error"; data: null }>;

type SecuritySignals = Readonly<{
  fetchedAt: string;
  isBlacklisted: boolean | null;
  isHoneypot: boolean | null;
  isOwnerRenounced: boolean | null;
  top10HolderRatio: string | null;
  suspectedInsiderHoldRatio: string | null;
  buyTaxRatio: string | null;
  sellTaxRatio: string | null;
}>;

type PoolSignals = Readonly<{
  fetchedAt: string;
  liquidityUsd: string;
  feeRatio: string | null;
}>;

export type TokenAnalyticsSummary = Readonly<{
  status: "ready" | "partial" | "unavailable";
  security: SecuritySignals | null;
  pool: PoolSignals | null;
}>;

export type TokenAnalyticsWallet = Readonly<{
  address: string;
  usdValue: number | null;
  amountRatio: number | null;
  buyVolumeUsd: number | null;
  sellVolumeUsd: number | null;
  profitUsd: number | null;
  profitRatio: number | null;
}>;

export type TokenAnalyticsRanking = Readonly<{
  status: "ready" | "unavailable";
  kind: "holders" | "traders";
  fetchedAt: string;
  wallets: readonly TokenAnalyticsWallet[];
}>;

const EMPTY_RANKING_STATE: ReadState<TokenAnalyticsRanking> = {
  status: "unavailable",
  data: null,
};

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});

const SECTION_OPTIONS = [
  { value: "overview", label: "Overview" },
  { value: "holders", label: "Top holders" },
  { value: "traders", label: "Top traders" },
] as const;

export function TokenGmgnAnalytics({
  tokenAddress,
  tokenName,
}: Readonly<{
  tokenAddress: string;
  tokenName: string;
}>) {
  const normalizedAddress = tokenAddress.trim().toLowerCase();
  return (
    <TokenGmgnAnalyticsContent
      key={normalizedAddress}
      tokenAddress={normalizedAddress}
      tokenName={tokenName}
    />
  );
}

function TokenGmgnAnalyticsContent({
  tokenAddress: normalizedAddress,
  tokenName,
}: Readonly<{
  tokenAddress: string;
  tokenName: string;
}>) {
  const [activeSection, setActiveSection] = useState<ViewSection>("overview");
  const [summary, setSummary] = useState<ReadState<TokenAnalyticsSummary>>(
    ADDRESS.test(normalizedAddress)
      ? { status: "loading", data: null }
      : { status: "error", data: null },
  );
  const [holders, setHolders] =
    useState<ReadState<TokenAnalyticsRanking>>(EMPTY_RANKING_STATE);
  const [traders, setTraders] =
    useState<ReadState<TokenAnalyticsRanking>>(EMPTY_RANKING_STATE);
  const requestGeneration = useRef(0);
  const summaryController = useRef<AbortController | null>(null);
  const rankingControllers = useRef<Partial<Record<"holders" | "traders", AbortController>>>({});
  const sectionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const headingId = useId();
  const descriptionId = useId();
  const panelId = useId();

  useEffect(() => {
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    summaryController.current?.abort();
    summaryController.current = controller;
    for (const current of Object.values(rankingControllers.current)) {
      current?.abort();
    }
    rankingControllers.current = {};
    if (!ADDRESS.test(normalizedAddress)) {
      return () => controller.abort();
    }

    void readAnalyticsSection(
      normalizedAddress,
      "summary",
      controller.signal,
    ).then((result) => {
      if (generation !== requestGeneration.current || controller.signal.aborted) {
        return;
      }
      setSummary(result === null
        ? { status: "error", data: null }
        : result.status === "unavailable"
          ? { status: "unavailable", data: result }
          : { status: "ready", data: result });
    });

    return () => {
      requestGeneration.current += 1;
      controller.abort();
      summaryController.current?.abort();
      for (const current of Object.values(rankingControllers.current)) {
        current?.abort();
      }
    };
  }, [normalizedAddress]);

  async function loadRanking(section: "holders" | "traders") {
    const current = section === "holders" ? holders : traders;
    if (current.status === "loading" || current.status === "ready") return;

    rankingControllers.current[section]?.abort();
    const controller = new AbortController();
    rankingControllers.current[section] = controller;
    const generation = requestGeneration.current;
    const update = section === "holders" ? setHolders : setTraders;
    update({ status: "loading", data: null });

    const result = await readAnalyticsSection(
      normalizedAddress,
      section,
      controller.signal,
    );
    if (generation !== requestGeneration.current || controller.signal.aborted) {
      return;
    }
    update(result === null
      ? { status: "error", data: null }
      : result.status === "unavailable"
        ? { status: "unavailable", data: null }
        : { status: "ready", data: result });
  }

  function activateSection(section: ViewSection) {
    setActiveSection(section);
    if (section !== "overview") void loadRanking(section);
  }

  function onSectionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = SECTION_OPTIONS.findIndex(
      ({ value }) => value === activeSection,
    );
    const targetIndex = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? (currentIndex + 1) % SECTION_OPTIONS.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? (currentIndex - 1 + SECTION_OPTIONS.length) % SECTION_OPTIONS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? SECTION_OPTIONS.length - 1
            : -1;
    if (targetIndex < 0) return;
    event.preventDefault();
    const next = SECTION_OPTIONS[targetIndex]!;
    activateSection(next.value);
    sectionButtonRefs.current[targetIndex]?.focus();
  }

  const activeRanking = activeSection === "holders"
    ? holders
    : activeSection === "traders"
      ? traders
      : null;
  const liveStatus = activeSection === "overview"
    ? readStateAnnouncement(summary.status, "Overview")
    : readStateAnnouncement(activeRanking?.status ?? "unavailable", activeSection);

  return (
    <section
      className={styles.analytics}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <div className={styles.headingRow}>
        <div>
          <p className={styles.eyebrow}>GMGN analytics</p>
          <h2 id={headingId}>Market intelligence</h2>
        </div>
        <p className={styles.disclaimer} id={descriptionId}>
          Third-party signals can be incomplete or delayed. They are
          informational, never a safety rating.
        </p>
      </div>

      <div
        className={styles.sectionTabs}
        role="tablist"
        aria-label={`${tokenName} analytics`}
      >
        {SECTION_OPTIONS.map((option, index) => (
          <button
            ref={(node) => {
              sectionButtonRefs.current[index] = node;
            }}
            className={styles.sectionTab}
            id={`${panelId}-${option.value}-tab`}
            type="button"
            role="tab"
            aria-controls={panelId}
            aria-selected={activeSection === option.value}
            tabIndex={activeSection === option.value ? 0 : -1}
            onClick={() => activateSection(option.value)}
            onKeyDown={onSectionKeyDown}
            key={option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        className={styles.panel}
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${panelId}-${activeSection}-tab`}
        aria-busy={activeSection === "overview"
          ? summary.status === "loading"
          : activeRanking?.status === "loading"}
      >
        {activeSection === "overview" ? (
          <SummaryPanel
            state={summary}
            retry={() => {
              summaryController.current?.abort();
              const controller = new AbortController();
              summaryController.current = controller;
              setSummary({ status: "loading", data: null });
              const generation = requestGeneration.current;
              void readAnalyticsSection(
                normalizedAddress,
                "summary",
                controller.signal,
              ).then(
                (result) => {
                  if (
                    generation !== requestGeneration.current ||
                    controller.signal.aborted
                  ) return;
                  setSummary(result === null
                    ? { status: "error", data: null }
                    : result.status === "unavailable"
                      ? { status: "unavailable", data: result }
                      : { status: "ready", data: result });
                },
              );
            }}
          />
        ) : (
          <RankingPanel
            section={activeSection}
            state={activeRanking ?? EMPTY_RANKING_STATE}
            retry={() => void loadRanking(activeSection)}
          />
        )}
      </div>
      <p className={styles.liveStatus} role="status" aria-live="polite">
        {liveStatus}
      </p>
    </section>
  );
}

function SummaryPanel({
  state,
  retry,
}: Readonly<{
  state: ReadState<TokenAnalyticsSummary>;
  retry: () => void;
}>) {
  if (state.status === "loading") return <SummarySkeleton />;
  if (state.status === "error") {
    return (
      <AnalyticsMessage
        title="Analytics could not be loaded"
        body="The token page is still available. Try the GMGN read again."
        retry={retry}
      />
    );
  }
  if (state.data === null || (
    state.data.security === null && state.data.pool === null
  )) {
    return (
      <AnalyticsMessage
        title="No GMGN analytics yet"
        body="GMGN has not returned verified token analytics yet."
      />
    );
  }

  const security = state.data.security;
  const pool = state.data.pool;
  const metrics = [
    { label: "GMGN liquidity", value: formatUsd(pool?.liquidityUsd ?? null) },
    { label: "GMGN fee", value: formatRatio(pool?.feeRatio ?? null) },
    {
      label: "Top 10 concentration",
      value: formatRatio(security?.top10HolderRatio ?? null),
    },
    {
      label: "Suspected insiders",
      value: formatRatio(security?.suspectedInsiderHoldRatio ?? null),
    },
    { label: "Buy tax", value: formatRatio(security?.buyTaxRatio ?? null) },
    { label: "Sell tax", value: formatRatio(security?.sellTaxRatio ?? null) },
  ];

  return (
    <div className={styles.summaryContent}>
      <dl className={styles.metricGrid}>
        {metrics.map((metric) => (
          <div className={styles.metric} key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.heuristics} aria-label="GMGN heuristic signals">
        <Signal
          label="Honeypot signal"
          value={flagLabel(security?.isHoneypot ?? null)}
        />
        <Signal
          label="Blacklist signal"
          value={flagLabel(security?.isBlacklisted ?? null)}
        />
        <Signal
          label="Owner control"
          value={renouncedLabel(security?.isOwnerRenounced ?? null)}
        />
      </div>
      <p className={styles.provenance}>
        Security and pool figures are token-level GMGN observations bound to
        this verified Programmable token. Pool attribution is unavailable.
      </p>
    </div>
  );
}

function Signal({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className={styles.signal}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RankingPanel({
  section,
  state,
  retry,
}: Readonly<{
  section: "holders" | "traders";
  state: ReadState<TokenAnalyticsRanking>;
  retry: () => void;
}>) {
  if (state.status === "loading") return <RankingSkeleton />;
  if (state.status === "error") {
    return (
      <AnalyticsMessage
        title={`${section === "holders" ? "Holder" : "Trader"} analytics could not be loaded`}
        body="The provider read failed before a verified ranking was available."
        retry={retry}
      />
    );
  }
  if (state.status === "unavailable" || state.data === null) {
    return (
      <AnalyticsMessage
        title={`No ${section} ranking yet`}
        body="GMGN has not returned a token-level ranking for this verified Programmable token."
        retry={retry}
      />
    );
  }
  if (state.data.wallets.length === 0) {
    return (
      <AnalyticsMessage
        title={`No ${section} found`}
        body="The verified GMGN response contains no wallet rows."
      />
    );
  }

  return (
    <div
      className={styles.rankingViewport}
      role="region"
      aria-label={`Top ${section} ranking, scrollable`}
      tabIndex={0}
    >
      <div className={styles.rankingHeader} aria-hidden="true">
        <span>Wallet</span>
        <span>{section === "holders" ? "Holding" : "Profit"}</span>
        <span>{section === "holders" ? "Value" : "Volume"}</span>
      </div>
      <ol className={styles.rankingList}>
        {state.data.wallets.map((wallet, index) => (
          <li className={styles.rankingRow} key={wallet.address}>
            <span className={styles.rank} aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <a
              className={styles.walletAddress}
              href={`https://etherscan.io/address/${wallet.address}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Wallet ${wallet.address} on Etherscan, opens in a new tab`}
            >
              <code>{conciseAddress(wallet.address)}</code>
            </a>
            <div className={styles.walletMetric}>
              <span>{section === "holders" ? "Holding" : "Profit"}</span>
              <strong>{section === "holders"
                ? formatNumberRatio(wallet.amountRatio)
                : formatSignedUsd(wallet.profitUsd)}</strong>
              {section === "traders" ? (
                <small>{formatSignedNumberRatio(wallet.profitRatio)}</small>
              ) : null}
            </div>
            <div className={styles.walletMetric}>
              <span>{section === "holders" ? "Value" : "Volume"}</span>
              <strong>{section === "holders"
                ? formatUsd(wallet.usdValue)
                : formatUsd(sumNullable(
                    wallet.buyVolumeUsd,
                    wallet.sellVolumeUsd,
                  ))}</strong>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AnalyticsMessage({
  title,
  body,
  retry,
}: Readonly<{
  title: string;
  body: string;
  retry?: () => void;
}>) {
  return (
    <div className={styles.message}>
      <strong>{title}</strong>
      <p>{body}</p>
      {retry ? (
        <button type="button" onClick={retry}>Try again</button>
      ) : null}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className={styles.summaryContent} aria-hidden="true">
      <div className={styles.metricGrid}>
        {Array.from({ length: 6 }, (_, index) => (
          <div className={styles.metric} key={index}>
            <span className={`${styles.skeleton} ${styles.skeletonLabel}`} />
            <span className={`${styles.skeleton} ${styles.skeletonValue}`} />
          </div>
        ))}
      </div>
      <div className={styles.heuristics}>
        {Array.from({ length: 3 }, (_, index) => (
          <span className={`${styles.skeleton} ${styles.skeletonSignal}`} key={index} />
        ))}
      </div>
      <span className={`${styles.skeleton} ${styles.skeletonNote}`} />
    </div>
  );
}

function RankingSkeleton() {
  return (
    <div className={styles.rankingViewport} aria-hidden="true">
      <div className={styles.rankingSkeleton}>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index}>
            <span className={`${styles.skeleton} ${styles.skeletonWallet}`} />
            <span className={`${styles.skeleton} ${styles.skeletonRankingValue}`} />
            <span className={`${styles.skeleton} ${styles.skeletonRankingValue}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

async function readAnalyticsSection(
  tokenAddress: string,
  section: "summary",
  signal?: AbortSignal,
): Promise<TokenAnalyticsSummary | null>;
async function readAnalyticsSection(
  tokenAddress: string,
  section: "holders" | "traders",
  signal?: AbortSignal,
): Promise<TokenAnalyticsRanking | null>;
async function readAnalyticsSection(
  tokenAddress: string,
  section: AnalyticsSection,
  signal?: AbortSignal,
): Promise<TokenAnalyticsSummary | TokenAnalyticsRanking | null> {
  try {
    const search = new URLSearchParams({
      address: tokenAddress,
      chain: "1",
      section,
    });
    if (section !== "summary") search.set("limit", String(ANALYTICS_LIMIT));
    const response = await fetch(`/api/explore/token/analytics?${search}`, {
      headers: { Accept: "application/json" },
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return null;
    return parseTokenAnalyticsResponse(body, section, tokenAddress);
  } catch (error) {
    if (signal?.aborted || (
      error instanceof DOMException && error.name === "AbortError"
    )) return null;
    return null;
  }
}

export function parseTokenAnalyticsResponse(
  value: unknown,
  section: "summary",
  expectedTokenAddress: string,
): TokenAnalyticsSummary | null;
export function parseTokenAnalyticsResponse(
  value: unknown,
  section: "holders" | "traders",
  expectedTokenAddress: string,
): TokenAnalyticsRanking | null;
export function parseTokenAnalyticsResponse(
  value: unknown,
  section: AnalyticsSection,
  expectedTokenAddress: string,
): TokenAnalyticsSummary | TokenAnalyticsRanking | null;
export function parseTokenAnalyticsResponse(
  value: unknown,
  section: AnalyticsSection,
  expectedTokenAddress: string,
): TokenAnalyticsSummary | TokenAnalyticsRanking | null {
  const expected = expectedTokenAddress.trim().toLowerCase();
  if (
    !ADDRESS.test(expected) ||
    !isRecord(value) ||
    value.schemaVersion !== "programmable.token-analytics.v1" ||
    value.provider !== "gmgn" ||
    value.analyticsScope !== "token" ||
    value.poolAttribution !== "unavailable" ||
    value.section !== section ||
    !isAnalyticsStatus(value.status) ||
    !isRecord(value.analytics)
  ) return null;

  const responseIdentity = isAnalyticsIdentity(value.identity, expected)
    ? value.identity
    : null;
  if (responseIdentity === null) {
    if (value.status !== "unavailable" || value.identity !== null) return null;
    if (
      section === "summary" &&
      value.analytics.security === null &&
      value.analytics.pool === null
    ) {
      return { status: "unavailable", security: null, pool: null };
    }
    if (section !== "summary" && value.analytics.ranking === null) {
      return {
        status: "unavailable",
        kind: section,
        fetchedAt: "",
        wallets: [],
      };
    }
    return null;
  }

  if (section === "summary") {
    const security = value.analytics.security === null
      ? null
      : parseSecurity(value.analytics.security, expected, responseIdentity);
    const pool = value.analytics.pool === null
      ? null
      : parsePool(value.analytics.pool, expected, responseIdentity);
    if (
      (value.analytics.security !== null && security === null) ||
      (value.analytics.pool !== null && pool === null) ||
      (value.status === "ready" && (security === null || pool === null)) ||
      (value.status === "partial" && Number(security !== null) + Number(pool !== null) !== 1) ||
      (value.status === "unavailable" && (security !== null || pool !== null))
    ) return null;
    return { status: value.status, security, pool };
  }

  if (value.status === "unavailable" && value.analytics.ranking === null) {
    return {
      status: "unavailable",
      kind: section,
      fetchedAt: "",
      wallets: [],
    };
  }
  if (value.status !== "ready") return null;
  const ranking = value.analytics.ranking;
  if (
    !isRecord(ranking) ||
    !isExactIsoTime(ranking.fetchedAt) ||
    !Array.isArray(ranking.wallets) ||
    ranking.wallets.length > ANALYTICS_LIMIT
  ) return null;
  const wallets = ranking.wallets.map(parseWallet);
  if (wallets.some((wallet) => wallet === null)) return null;
  return {
    status: "ready",
    kind: section,
    fetchedAt: ranking.fetchedAt,
    wallets: wallets as TokenAnalyticsWallet[],
  };
}

function parseSecurity(
  value: unknown,
  tokenAddress: string,
  identity: Record<string, unknown>,
): SecuritySignals | null {
  if (
    !isRecord(value) ||
    value.source !== "gmgn" ||
    value.tokenAddress !== tokenAddress ||
    !sameAnalyticsIdentity(value.identity, identity) ||
    !isExactIsoTime(value.fetchedAt)
  ) return null;
  const booleans = [value.isBlacklisted, value.isHoneypot, value.isOwnerRenounced];
  const ratios = [
    value.top10HolderRatio,
    value.suspectedInsiderHoldRatio,
    value.buyTaxRatio,
    value.sellTaxRatio,
  ];
  if (!booleans.every(isNullableBoolean) || !ratios.every(isNullableRatio)) {
    return null;
  }
  return {
    fetchedAt: value.fetchedAt,
    isBlacklisted: value.isBlacklisted as boolean | null,
    isHoneypot: value.isHoneypot as boolean | null,
    isOwnerRenounced: value.isOwnerRenounced as boolean | null,
    top10HolderRatio: value.top10HolderRatio as string | null,
    suspectedInsiderHoldRatio: value.suspectedInsiderHoldRatio as string | null,
    buyTaxRatio: value.buyTaxRatio as string | null,
    sellTaxRatio: value.sellTaxRatio as string | null,
  };
}

function parsePool(
  value: unknown,
  tokenAddress: string,
  identity: Record<string, unknown>,
): PoolSignals | null {
  if (
    !isRecord(value) ||
    value.source !== "gmgn" ||
    value.marketScope !== "token" ||
    value.poolAttribution !== "unavailable" ||
    value.exchange !== "uniswap_v4" ||
    value.tokenAddress !== tokenAddress ||
    value.providerAddress !== tokenAddress ||
    value.baseAddress !== tokenAddress ||
    !sameAnalyticsIdentity(value.identity, identity) ||
    !isExactIsoTime(value.fetchedAt) ||
    !isNonNegativeDecimal(value.liquidityUsd) ||
    !isNullableRatio(value.feeRatio)
  ) return null;
  return {
    fetchedAt: value.fetchedAt,
    liquidityUsd: value.liquidityUsd,
    feeRatio: value.feeRatio as string | null,
  };
}

function parseWallet(value: unknown): TokenAnalyticsWallet | null {
  if (!isRecord(value) || typeof value.address !== "string" || !ADDRESS.test(value.address)) {
    return null;
  }
  const fields = [
    value.usdValue,
    value.amountRatio,
    value.buyVolumeUsd,
    value.sellVolumeUsd,
    value.profitUsd,
    value.profitRatio,
  ];
  if (!fields.every(isNullableFiniteNumber)) return null;
  return {
    address: value.address,
    usdValue: value.usdValue as number | null,
    amountRatio: value.amountRatio as number | null,
    buyVolumeUsd: value.buyVolumeUsd as number | null,
    sellVolumeUsd: value.sellVolumeUsd as number | null,
    profitUsd: value.profitUsd as number | null,
    profitRatio: value.profitRatio as number | null,
  };
}

function readStateAnnouncement(status: ReadState<unknown>["status"], label: string) {
  return status === "loading"
    ? `Loading ${label.toLowerCase()} analytics`
    : status === "ready"
      ? `${label} analytics loaded`
      : status === "error"
        ? `${label} analytics could not be loaded`
        : `${label} analytics are unavailable`;
}

function formatUsd(value: string | number | null): string {
  if (value === null) return "Unavailable";
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? USD_FORMATTER.format(parsed) : "Unavailable";
}

function formatSignedUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  const absolute = USD_FORMATTER.format(Math.abs(value));
  return value > 0 ? `+${absolute}` : value < 0 ? `−${absolute}` : absolute;
}

function formatRatio(value: string | null): string {
  if (value === null) return "Unavailable";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? PERCENT_FORMATTER.format(parsed) : "Unavailable";
}

function formatNumberRatio(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "Unavailable"
    : PERCENT_FORMATTER.format(value);
}

function formatSignedNumberRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "PnL unavailable";
  const percentage = PERCENT_FORMATTER.format(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${percentage} PnL`;
}

function flagLabel(value: boolean | null): string {
  return value === true ? "Flagged" : value === false ? "Not flagged" : "Unavailable";
}

function renouncedLabel(value: boolean | null): string {
  return value === true ? "Renounced" : value === false ? "Not renounced" : "Unavailable";
}

function conciseAddress(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function sumNullable(first: number | null, second: number | null): number | null {
  if (first === null && second === null) return null;
  return (first ?? 0) + (second ?? 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnalyticsStatus(value: unknown): value is TokenAnalyticsSummary["status"] {
  return value === "ready" || value === "partial" || value === "unavailable";
}

function isAnalyticsIdentity(
  value: unknown,
  tokenAddress: string,
): value is Record<string, unknown> {
  return isRecord(value) &&
    value.chainId === "1" &&
    value.protocol === "uniswap_v4" &&
    value.tokenAddress === tokenAddress &&
    typeof value.poolId === "string" &&
    /^0x[0-9a-f]{64}$/u.test(value.poolId) &&
    typeof value.quoteAddress === "string" &&
    ADDRESS.test(value.quoteAddress);
}

function sameAnalyticsIdentity(
  candidate: unknown,
  expected: Record<string, unknown>,
): boolean {
  return isRecord(candidate) &&
    candidate.chainId === expected.chainId &&
    candidate.protocol === expected.protocol &&
    candidate.tokenAddress === expected.tokenAddress &&
    candidate.poolId === expected.poolId &&
    candidate.quoteAddress === expected.quoteAddress;
}

function isNullableBoolean(value: unknown): boolean {
  return value === null || typeof value === "boolean";
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNullableRatio(value: unknown): boolean {
  if (value === null) return true;
  if (!isNonNegativeDecimal(value)) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed <= 1;
}

function isNonNegativeDecimal(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 160 &&
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
}

function isExactIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
