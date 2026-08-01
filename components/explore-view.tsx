"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AnimatedMarketCap,
  type MarketCapMetric,
} from "@/components/animated-market-cap";
import { SiteFooter } from "@/components/site-footer";
import {
  canOptimizeTokenImage,
  getTokenCardImageSource,
} from "@/lib/token-image";
import { type LauncherToken, type TokenLink } from "@/lib/tokens";

type TokenCard = {
  id: string;
  name: string;
  symbol: string;
  imageUrl: string;
  usesFallbackImage: boolean;
  tokenAddress: `0x${string}`;
  marketCap?: MarketCapMetric;
};

type TokenSort = "newest" | "oldest" | "market-cap" | "market-cap-asc";

type ExplorePayload = {
  status: "ready" | "not-deployed";
  tokens: LauncherToken[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ExploreState =
  | { phase: "loading" }
  | {
      phase: "error";
      message: string;
      requestKey: string;
      contentKey: string;
    }
  | {
      phase: "ready";
      payload: ExplorePayload;
      requestKey: string;
      contentKey: string;
      refreshError?: string;
    };

export function preserveExplorePayloadOnRefreshFailure(
  current: ExploreState,
  input: {
    contentKey: string;
    requestKey: string;
    message: string;
  },
): ExploreState {
  return current.phase === "ready" && current.contentKey === input.contentKey
    ? {
        ...current,
        requestKey: input.requestKey,
        refreshError: input.message,
      }
    : {
        phase: "error",
        contentKey: input.contentKey,
        requestKey: input.requestKey,
        message: input.message,
      };
}

type PaginationItem = number | "start-gap" | "end-gap";

const TOKENS_PER_PAGE = 10;
const QUERY_DEBOUNCE_MS = 200;
const EXPLORE_REQUEST_TIMEOUT_MS = 12_000;
export const EXPLORE_REFRESH_INTERVAL_MS = 10_000;
const PROGRAMMABLE_TOKEN_ADDRESS = "0x7987f03462200b3d8a072e02c89a8a41dcb124ee";
const fallbackTokenImages = [
  "/brand/programmable-token-fallback-01-dawn.webp",
  "/brand/programmable-token-fallback-02-moon.webp",
  "/brand/programmable-token-fallback-03-sun.webp",
  "/brand/programmable-token-fallback-04-mint.webp",
  "/brand/programmable-token-fallback-05-lavender.webp",
  "/brand/programmable-token-fallback-06-dusk.webp",
] as const;
const sortOptions: { id: TokenSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "market-cap", label: "Highest market cap" },
  { id: "market-cap-asc", label: "Lowest market cap" },
];

export function shouldRefreshExplore(input: {
  visibilityState: DocumentVisibilityState;
  lastRefreshAt: number;
  now: number;
}) {
  return (
    input.visibilityState === "visible" &&
    input.now - input.lastRefreshAt >= EXPLORE_REFRESH_INTERVAL_MS
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function safeImageUrl(value: unknown) {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.hostname
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function parseTokenLink(value: unknown): TokenLink | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== "website" &&
    value.kind !== "x" &&
    value.kind !== "telegram"
  ) {
    return null;
  }
  if (typeof value.url !== "string") return null;

  try {
    const url = new URL(value.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return { kind: value.kind, url: value.url };
}

function parseLauncherToken(value: unknown): LauncherToken | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.symbol !== "string" ||
    !isTokenAddress(value.tokenAddress) ||
    !isTokenAddress(value.hookAddress) ||
    !isBytes32(value.poolId) ||
    typeof value.launchedAt !== "string" ||
    typeof value.totalSwapFeeBps !== "number" ||
    !Number.isSafeInteger(value.totalSwapFeeBps) ||
    value.totalSwapFeeBps < 0 ||
    value.liquidityPath !== "meme"
  ) {
    return null;
  }

  const links = Array.isArray(value.links)
    ? value.links
        .map(parseTokenLink)
        .filter((link): link is TokenLink => link !== null)
    : [];

  return {
    ...(value as unknown as LauncherToken),
    links,
    description:
      typeof value.description === "string" ? value.description : undefined,
    imageUrl: safeImageUrl(value.imageUrl),
  };
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function parseExplorePayload(value: unknown): ExplorePayload {
  if (!isRecord(value)) {
    throw new Error("The token registry returned an invalid response");
  }
  if (value.status !== "ready" && value.status !== "not-deployed") {
    throw new Error("The token registry returned an unknown status");
  }
  if (!Array.isArray(value.tokens)) {
    throw new Error("The token registry returned invalid token data");
  }

  const tokens = value.tokens.map(parseLauncherToken);
  if (tokens.some((token) => token === null)) {
    throw new Error("The token registry returned an invalid token record");
  }

  return {
    status: value.status,
    tokens: tokens as LauncherToken[],
    page: Math.max(1, positiveInteger(value.page, 1)),
    pageSize: Math.max(1, positiveInteger(value.pageSize, TOKENS_PER_PAGE)),
    total: positiveInteger(value.total, tokens.length),
    totalPages: positiveInteger(value.totalPages, 0),
  };
}

function readApiError(value: unknown) {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : "Tokens are temporarily unavailable";
}

type PendingExploreRequest = {
  controller: AbortController;
  promise: Promise<ExplorePayload>;
};

const pendingExploreRequests = new Map<string, PendingExploreRequest>();

export function loadExplorePayload(
  contentKey: string,
  search: URLSearchParams,
) {
  const pendingRequest = pendingExploreRequests.get(contentKey);
  if (pendingRequest) return pendingRequest.promise;

  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, EXPLORE_REQUEST_TIMEOUT_MS);
  const request = (async (): Promise<ExplorePayload> => {
    try {
      const response = await fetch(`/api/explore?${search.toString()}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readApiError(body));
      }
      return parseExplorePayload(body);
    } catch (error) {
      if (timedOut) {
        throw new Error("Tokens took too long to respond");
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  })();

  const entry = { controller, promise: request };
  pendingExploreRequests.set(contentKey, entry);
  const clearPendingRequest = () => {
    if (pendingExploreRequests.get(contentKey) === entry) {
      pendingExploreRequests.delete(contentKey);
    }
  };
  void request.then(clearPendingRequest, clearPendingRequest);

  return request;
}

function abortExplorePayload(contentKey: string) {
  const pendingRequest = pendingExploreRequests.get(contentKey);
  if (!pendingRequest) return;
  pendingExploreRequests.delete(contentKey);
  pendingRequest.controller.abort();
}

function getFallbackTokenImage(address: string) {
  const suffix = Number.parseInt(address.slice(-8), 16);
  const index = Number.isFinite(suffix)
    ? suffix % fallbackTokenImages.length
    : 0;
  return fallbackTokenImages[index];
}

export function getMarketCap(
  token: LauncherToken,
): MarketCapMetric | undefined {
  if (
    token.indexedMarketCapUsdWad &&
    /^\d+$/.test(token.indexedMarketCapUsdWad)
  ) {
    const value = Number(BigInt(token.indexedMarketCapUsdWad)) / 1e18;
    if (Number.isFinite(value) && value > 0) {
      return { kind: "usd", value };
    }
  }

  if (token.fdvUsdWad && /^\d+$/.test(token.fdvUsdWad)) {
    const value = Number(BigInt(token.fdvUsdWad)) / 1e18;
    if (Number.isFinite(value) && value > 0) {
      return { kind: "usd", value };
    }
  }

  if (
    token.marketCapQuote &&
    token.quoteAssetSymbol &&
    /^\d+(?:\.\d+)?$/.test(token.marketCapQuote)
  ) {
    const value = Number(token.marketCapQuote);
    if (Number.isFinite(value) && value >= 0) {
      return {
        kind: "quote",
        symbol: token.quoteAssetSymbol,
        value,
      };
    }
  }

  const marketCapEth = token.indexedMarketCapEth ?? token.marketCapEth;
  if (!marketCapEth) return undefined;
  const value = Number(marketCapEth);
  if (!Number.isFinite(value) || value < 0) return undefined;

  return { kind: "eth", value };
}

function getPaginationItems(
  currentPage: number,
  pageCount: number,
): PaginationItem[] {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, "end-gap", pageCount];
  }

  if (currentPage >= pageCount - 2) {
    return [
      1,
      "start-gap",
      pageCount - 3,
      pageCount - 2,
      pageCount - 1,
      pageCount,
    ];
  }

  return [
    1,
    "start-gap",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "end-gap",
    pageCount,
  ];
}

function getTokenCards(tokens: LauncherToken[]): TokenCard[] {
  return tokens.map((token) => ({
    id: token.id,
    name: token.name,
    symbol: token.symbol,
    imageUrl:
      token.imageUrl?.trim() || getFallbackTokenImage(token.tokenAddress),
    usesFallbackImage: !token.imageUrl?.trim(),
    tokenAddress: token.tokenAddress,
    marketCap: getMarketCap(token),
  }));
}

export function ExploreView() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<TokenSort>("market-cap");
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedAddress, setCopiedAddress] = useState("");
  const [copyError, setCopyError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<ExploreState>({ phase: "loading" });
  const copyResetTimer = useRef<number | null>(null);
  const activeExploreContentKey = useRef<string | null>(null);
  const lastExploreRefreshAt = useRef(0);
  const filterRef = useRef<HTMLDetailsElement>(null);
  const contentKey = `${debouncedQuery}\u0000${sort}\u0000${currentPage}`;
  const requestKey = `${contentKey}\u0000${retryKey}\u0000${refreshKey}`;

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
      if (activeExploreContentKey.current) {
        abortExplorePayload(activeExploreContentKey.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (normalizedQuery === debouncedQuery) return;

    const timer = window.setTimeout(() => {
      setCurrentPage(1);
      setDebouncedQuery(normalizedQuery);
    }, QUERY_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [debouncedQuery, normalizedQuery]);

  useEffect(() => {
    lastExploreRefreshAt.current = Date.now();

    function refreshIfDue() {
      const now = Date.now();
      if (
        !shouldRefreshExplore({
          visibilityState: document.visibilityState,
          lastRefreshAt: lastExploreRefreshAt.current,
          now,
        })
      )
        return;
      lastExploreRefreshAt.current = now;
      setRefreshKey((value) => value + 1);
    }

    const interval = window.setInterval(
      refreshIfDue,
      EXPLORE_REFRESH_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", refreshIfDue);
    window.addEventListener("focus", refreshIfDue);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfDue);
      window.removeEventListener("focus", refreshIfDue);
    };
  }, []);

  useEffect(() => {
    function closeFilter(event: PointerEvent | KeyboardEvent) {
      const filter = filterRef.current;
      if (!filter?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        filter.removeAttribute("open");
        filter.querySelector("summary")?.focus();
        return;
      }
      if (
        event instanceof PointerEvent &&
        event.target instanceof Node &&
        !filter.contains(event.target)
      ) {
        filter.removeAttribute("open");
      }
    }

    document.addEventListener("pointerdown", closeFilter);
    document.addEventListener("keydown", closeFilter);
    return () => {
      document.removeEventListener("pointerdown", closeFilter);
      document.removeEventListener("keydown", closeFilter);
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    const previousContentKey = activeExploreContentKey.current;
    if (previousContentKey && previousContentKey !== contentKey) {
      abortExplorePayload(previousContentKey);
    }
    activeExploreContentKey.current = contentKey;
    const search = new URLSearchParams({
      q: debouncedQuery,
      sort,
      page: String(currentPage),
      limit: String(TOKENS_PER_PAGE),
    });

    async function loadTokens() {
      try {
        const payload = await loadExplorePayload(contentKey, search);
        if (ignore) return;
        if (payload.page !== currentPage) {
          setCurrentPage(payload.page);
        }
        setState({
          phase: "ready",
          payload,
          requestKey,
          contentKey,
        });
      } catch (error) {
        if (ignore) return;
        const message =
          error instanceof Error
            ? error.message
            : "Tokens are temporarily unavailable";
        setState((current) =>
          preserveExplorePayloadOnRefreshFailure(current, {
            contentKey,
            requestKey,
            message,
          }),
        );
      }
    }

    void loadTokens();
    return () => {
      ignore = true;
    };
  }, [contentKey, currentPage, debouncedQuery, requestKey, sort]);

  const payload = state.phase === "ready" ? state.payload : null;
  const cards = useMemo(
    () => getTokenCards(payload?.tokens ?? []),
    [payload?.tokens],
  );
  const pageCount = Math.max(1, payload?.totalPages ?? 0);
  const activePage = Math.min(payload?.page ?? currentPage, pageCount);
  const paginationItems = getPaginationItems(activePage, pageCount);
  const busy = state.phase === "loading" || state.requestKey !== requestKey;
  const hasPublicTokens =
    state.phase !== "ready" ||
    state.payload.total > 0 ||
    Boolean(debouncedQuery);

  async function copyAddress(address: string) {
    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
    }
    setCopyError("");
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      copyResetTimer.current = window.setTimeout(
        () => setCopiedAddress(""),
        1600,
      );
    } catch {
      setCopiedAddress("");
      setCopyError("Could not copy address");
      copyResetTimer.current = window.setTimeout(() => setCopyError(""), 2400);
    }
  }

  function renderTokenState() {
    if (
      state.phase === "loading" ||
      (state.phase === "error" && state.requestKey !== requestKey)
    ) {
      return (
        <div className="token-empty" role="status">
          <p>Loading tokens</p>
        </div>
      );
    }

    if (state.phase === "error") {
      return (
        <div className="token-empty" role="alert">
          <p>{state.message}</p>
          <button
            className="text-button"
            type="button"
            onClick={() => setRetryKey((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      );
    }

    if (state.payload.status === "not-deployed") {
      return (
        <div className="token-empty">
          <p>No verified tokens yet</p>
        </div>
      );
    }

    if (cards.length === 0) {
      if (debouncedQuery) {
        return (
          <div className="token-empty">
            <p>No tokens match this search</p>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setQuery("");
                setCurrentPage(1);
              }}
            >
              Clear search
            </button>
          </div>
        );
      }

      return (
        <div className="token-empty token-empty-initial">
          <div>
            <h2>No public tokens yet</h2>
            <p>The first public launch will appear here.</p>
          </div>
          <Link className="text-button" href="/launch">
            Launch a token
          </Link>
        </div>
      );
    }

    return (
      <div
        className="token-card-grid"
        key={`${activePage}:${sort}:${debouncedQuery}`}
      >
        {cards.map((token, index) => {
          const href = `/token/${token.tokenAddress}`;
          const imageSource = getTokenCardImageSource(token.imageUrl);

          return (
            <article className="token-card" key={token.id}>
              <Link
                className="token-card-hit-area"
                href={href}
                aria-label={`View ${token.name}`}
              />

              <span className="token-card-art">
                <Image
                  className="token-card-image"
                  src={imageSource}
                  alt={
                    token.usesFallbackImage ? "" : `${token.name} token image`
                  }
                  fill
                  sizes="(max-width: 800px) 46vw, 104px"
                  unoptimized={!canOptimizeTokenImage(imageSource)}
                />
              </span>

              <div className="token-card-body">
                <header className="token-card-heading">
                  <span className="token-card-title">
                    <h3>{token.name}</h3>
                    <span>${token.symbol}</span>
                  </span>
                </header>

                {token.marketCap ? (
                  <span className="token-card-market-cap">
                    <AnimatedMarketCap
                      delay={index * 18}
                      metric={token.marketCap}
                      replayKey={`${activePage}:${sort}:${debouncedQuery}`}
                    />
                    <span>Market cap</span>
                  </span>
                ) : (
                  <span className="token-card-market-cap token-card-market-cap-pending">
                    <strong>—</strong>
                    <span>Market cap</span>
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className="explore-page page-width">
        <section className="explore-intro">
          <div className="explore-intro-copy">
            <span className="explore-eyebrow">Programmable · Ethereum</span>
            <h1>Uniswap v4 token infrastructure.</h1>
            <p>
              Explore indexed launches, inspect their onchain configuration,
              and create tokens with defined rules.
            </p>
            <div className="explore-intro-actions">
              <Link className="explore-primary-action" href="/launch">
                Launch a token
                <ArrowRight aria-hidden="true" size={16} />
              </Link>
              <a className="explore-secondary-action" href="#tokens">
                View projects
              </a>
            </div>
          </div>

          <aside className="explore-protocol-card" aria-label="Protocol record">
            <div className="explore-protocol-brand">
              <Image
                className="explore-brand-logo"
                src="/brand/loop/programmable-loop-mark-transparent-v1.png"
                alt=""
                width={1254}
                height={1254}
                priority
              />
              <div>
                <strong>Programmable</strong>
                <span>Token systems</span>
              </div>
            </div>
            <dl className="explore-protocol-facts">
              <div>
                <dt>Network</dt>
                <dd>Ethereum</dd>
              </div>
              <div>
                <dt>Liquidity</dt>
                <dd>Uniswap v4</dd>
              </div>
              <div>
                <dt>Execution</dt>
                <dd>Your wallet</dd>
              </div>
            </dl>
            <button
              className="explore-token-address"
              type="button"
              aria-label={
                copiedAddress === PROGRAMMABLE_TOKEN_ADDRESS
                  ? "Programmable token address copied"
                  : "Copy Programmable token address"
              }
              title={
                copiedAddress === PROGRAMMABLE_TOKEN_ADDRESS
                  ? "Copied"
                  : "Copy token address"
              }
              onClick={() => copyAddress(PROGRAMMABLE_TOKEN_ADDRESS)}
            >
              <span>Programmable token</span>
              <code>{PROGRAMMABLE_TOKEN_ADDRESS}</code>
              {copiedAddress === PROGRAMMABLE_TOKEN_ADDRESS ? (
                <Check aria-hidden="true" size={13} />
              ) : (
                <Copy aria-hidden="true" size={13} />
              )}
            </button>
          </aside>
        </section>

        <section className="token-section" id="tokens" aria-busy={busy}>
          <div className="token-section-heading">
            <div className="token-section-title">
              <span>Project directory</span>
              <h2>Explore launches</h2>
              <p>
                {state.phase === "ready" && state.payload.total > 0
                  ? `${state.payload.total} indexed projects`
                  : "Onchain launch records"}
              </p>
            </div>
            {hasPublicTokens ? (
              <div className="token-toolbar">
                <label className="token-search">
                  <Search aria-hidden="true" size={17} />
                  <span className="sr-only">
                    Search tokens by name, ticker or contract address
                  </span>
                  <input
                    value={query}
                    placeholder="Search tokens"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>

                <details className="token-filter" ref={filterRef}>
                  <summary>
                    <SlidersHorizontal aria-hidden="true" size={16} />
                    <span>Filter</span>
                    <ChevronDown
                      className="token-filter-chevron"
                      aria-hidden="true"
                      size={15}
                    />
                  </summary>
                  <div
                    className="token-filter-menu"
                    role="group"
                    aria-label="Sort tokens"
                  >
                    {sortOptions.map((option) => (
                      <button
                        key={option.id}
                        className={sort === option.id ? "active" : undefined}
                        type="button"
                        aria-pressed={sort === option.id}
                        onClick={() => {
                          setSort(option.id);
                          setCurrentPage(1);
                          const filter = filterRef.current;
                          filter?.removeAttribute("open");
                          filter?.querySelector("summary")?.focus();
                        }}
                      >
                        <span>{option.label}</span>
                        {sort === option.id ? (
                          <Check aria-hidden="true" size={15} />
                        ) : null}
                      </button>
                    ))}
                  </div>
                </details>

                {state.phase === "ready" &&
                state.payload.status === "ready" &&
                state.payload.total > 0 &&
                cards.length > 0 ? (
                  <nav className="token-pagination" aria-label="Token pages">
                    <button
                      type="button"
                      aria-label="Previous token page"
                      disabled={activePage === 1 || busy}
                      onClick={() =>
                        setCurrentPage((page) => Math.max(1, page - 1))
                      }
                    >
                      <ChevronLeft aria-hidden="true" size={15} />
                    </button>

                    <div className="token-pagination-pages">
                      {paginationItems.map((item) =>
                        typeof item === "number" ? (
                          <button
                            key={item}
                            className={
                              activePage === item ? "active" : undefined
                            }
                            type="button"
                            aria-label={`Token page ${item}`}
                            aria-current={
                              activePage === item ? "page" : undefined
                            }
                            disabled={busy}
                            onClick={() => setCurrentPage(item)}
                          >
                            {item}
                          </button>
                        ) : (
                          <span key={item} aria-hidden="true">
                            …
                          </span>
                        ),
                      )}
                    </div>

                    <button
                      type="button"
                      aria-label="Next token page"
                      disabled={activePage === pageCount || busy}
                      onClick={() =>
                        setCurrentPage((page) => Math.min(pageCount, page + 1))
                      }
                    >
                      <ChevronRight aria-hidden="true" size={15} />
                    </button>

                    <span className="sr-only" aria-live="polite">
                      Page {activePage} of {pageCount}
                    </span>
                  </nav>
                ) : null}
              </div>
            ) : null}
          </div>

          {state.phase === "ready" && state.refreshError ? (
            <div className="token-refresh-warning" role="status">
              <span>Prices may be out of date</span>
              <button
                type="button"
                onClick={() => setRetryKey((value) => value + 1)}
              >
                Refresh
              </button>
            </div>
          ) : null}

          {state.phase === "ready" && busy ? (
            <span className="sr-only" role="status">
              Updating tokens
            </span>
          ) : null}
          {renderTokenState()}
        </section>
      </div>
      <SiteFooter />
      {copyError ? (
        <div className="toast-region" aria-live="assertive" aria-atomic="true">
          <p className="toast" role="alert">
            {copyError}
          </p>
        </div>
      ) : null}
    </>
  );
}
