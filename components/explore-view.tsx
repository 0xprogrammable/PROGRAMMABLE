"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  formatMarketCapMetric,
  type MarketCapMetric,
} from "@/components/animated-market-cap";
import { EXPLORE_PREVIEW_TOKENS } from "@/components/explore-preview-data";
import { useInterfacePreview } from "@/components/interface-preview";
import { SiteFooter } from "@/components/site-footer";
import {
  LIVE_DATA_REFRESH_INTERVAL_MS,
  shouldRefreshLiveData,
  useLiveDataRefresh,
} from "@/components/use-live-data-refresh";
import {
  canOptimizeTokenImage,
  getTokenCardImageSource,
} from "@/lib/token-image";
import {
  type LauncherToken,
  type TokenLink,
} from "@/lib/tokens";
import styles from "./explore-experience.module.css";

type TokenCard = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl: string;
  usesFallbackImage: boolean;
  tokenAddress: `0x${string}`;
  marketCap?: MarketCapMetric;
  model: string;
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
export const EXPLORE_REFRESH_INTERVAL_MS = LIVE_DATA_REFRESH_INTERVAL_MS;
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
  return shouldRefreshLiveData({
    ...input,
    intervalMs: EXPLORE_REFRESH_INTERVAL_MS,
  });
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
    description: token.description?.trim() || undefined,
    imageUrl:
      token.imageUrl?.trim() || getFallbackTokenImage(token.tokenAddress),
    usesFallbackImage: !token.imageUrl?.trim(),
    tokenAddress: token.tokenAddress,
    marketCap: getMarketCap(token),
    model:
      token.launchModel === "adaptive"
        ? "Adaptive"
        : token.launchModel === "deep"
          ? "Deep"
          : token.launchModel === "stock-paired"
            ? "Custom"
            : "Classic",
  }));
}

export function ExploreView() {
  const preview = useInterfacePreview();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<TokenSort>("market-cap");
  const [currentPage, setCurrentPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const refreshKey = useLiveDataRefresh({ enabled: !preview });
  const [state, setState] = useState<ExploreState>({ phase: "loading" });
  const activeExploreContentKey = useRef<string | null>(null);
  const filterRef = useRef<HTMLDetailsElement>(null);
  const contentKey = `${debouncedQuery}\u0000${sort}\u0000${currentPage}`;
  const requestKey = `${contentKey}\u0000${retryKey}\u0000${refreshKey}`;

  useEffect(
    () => () => {
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
    if (preview) return;

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
  }, [contentKey, currentPage, debouncedQuery, preview, requestKey, sort]);

  const previewPayload = useMemo<ExplorePayload>(() => {
    const searchValue = debouncedQuery.toLowerCase();
    const filtered = EXPLORE_PREVIEW_TOKENS.filter((token) =>
      [token.name, token.symbol, token.tokenAddress].some((value) =>
        value.toLowerCase().includes(searchValue),
      ),
    );
    const ranked = [...filtered].sort((left, right) => {
      if (sort === "newest" || sort === "oldest") {
        const delta =
          new Date(right.launchedAt).getTime() -
          new Date(left.launchedAt).getTime();
        return sort === "newest" ? delta : -delta;
      }
      const leftMarketCap = BigInt(left.indexedMarketCapUsdWad ?? "0");
      const rightMarketCap = BigInt(right.indexedMarketCapUsdWad ?? "0");
      const delta =
        leftMarketCap === rightMarketCap
          ? 0
          : leftMarketCap > rightMarketCap
            ? -1
            : 1;
      return sort === "market-cap" ? delta : -delta;
    });

    return {
      status: "ready",
      tokens: ranked,
      page: 1,
      pageSize: TOKENS_PER_PAGE,
      total: ranked.length,
      totalPages: ranked.length > 0 ? 1 : 0,
    };
  }, [debouncedQuery, sort]);

  const displayState: ExploreState = preview
    ? {
        phase: "ready",
        payload: previewPayload,
        requestKey,
        contentKey,
      }
    : state;

  const payload =
    displayState.phase === "ready" ? displayState.payload : null;
  const cards = useMemo(
    () => getTokenCards(payload?.tokens ?? []),
    [payload?.tokens],
  );
  const pageCount = Math.max(1, payload?.totalPages ?? 0);
  const activePage = Math.min(payload?.page ?? currentPage, pageCount);
  const paginationItems = getPaginationItems(activePage, pageCount);
  const busy =
    !preview &&
    (displayState.phase === "loading" ||
      displayState.requestKey !== requestKey);
  const hasPublicTokens =
    displayState.phase !== "ready" ||
    displayState.payload.total > 0 ||
    Boolean(debouncedQuery);

  function renderTokenState() {
    if (
      displayState.phase === "loading" ||
      (displayState.phase === "error" &&
        displayState.requestKey !== requestKey)
    ) {
      return (
        <div className="token-empty" role="status">
          <p>Loading tokens</p>
        </div>
      );
    }

    if (displayState.phase === "error") {
      return (
        <div className="token-empty" role="alert">
          <p>{displayState.message}</p>
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

    if (displayState.payload.status === "not-deployed") {
      return (
        <div className={`${styles.emptyState} token-empty token-empty-initial`}>
          <div>
            <h2>Token index unavailable</h2>
            <p>Explore is not available in this environment.</p>
          </div>
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
        <div className={`${styles.emptyState} token-empty token-empty-initial`}>
          <div>
            <h2>No tokens yet</h2>
            <p>Create the first token.</p>
          </div>
          <Link className={styles.emptyAction} href="/launch">
            Create token
          </Link>
        </div>
      );
    }

    return (
      <div className={styles.runnerGrid}>
        {cards.map((token, index) => {
          const href = `/token/${token.tokenAddress}`;
          const imageSource = getTokenCardImageSource(token.imageUrl);

          return (
            <article className={styles.runnerCard} key={token.id}>
              <Link
                className={styles.runnerHitArea}
                href={href}
                aria-label={`Open ${token.name}`}
              >
                <div className={styles.runnerArt}>
                  <Image
                    className={styles.runnerImage}
                    src={imageSource}
                    alt={
                      token.usesFallbackImage ? "" : `${token.name} artwork`
                    }
                    fill
                    loading={index < 3 ? "eager" : "lazy"}
                    sizes="(max-width: 700px) calc(100vw - 28px), (max-width: 1040px) 46vw, 31vw"
                    unoptimized={!canOptimizeTokenImage(imageSource)}
                  />
                </div>

                <div className={styles.runnerBody}>
                  <header className={styles.runnerHeading}>
                    <h3>{token.name}</h3>
                    <span className={styles.runnerSymbol}>${token.symbol}</span>
                  </header>

                  <p
                    className={`${styles.runnerDescription}${
                      token.description
                        ? ""
                        : ` ${styles.runnerDescriptionEmpty}`
                    }`}
                  >
                    {token.description ?? "No description yet."}
                  </p>

                  <dl className={styles.runnerMeta}>
                    <div>
                      <dt>Market cap</dt>
                      <dd>
                        {token.marketCap
                          ? formatMarketCapMetric(token.marketCap)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>V4 model</dt>
                      <dd>{token.model}</dd>
                    </div>
                  </dl>
                </div>
              </Link>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className={`${styles.page} explore-page page-width`}>
        <header className={styles.pageHeading}>
          <h1>Explore</h1>
          <p>Launch tokens that work the way you imagine.</p>
        </header>

        <section
          className={`${styles.runnersSection} token-section`}
          id="tokens"
          aria-busy={busy}
        >
          <header className={styles.indexHeading}>
            <h2>All tokens</h2>
            {payload ? (
              <span>
                {payload.total} {payload.total === 1 ? "project" : "projects"}
              </span>
            ) : null}
          </header>

          <div className={styles.runnersIntro}>
            {hasPublicTokens ? (
              <div className="token-section-heading">
                <h2 className="sr-only">Tokens</h2>
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

                  {displayState.phase === "ready" &&
                  displayState.payload.status === "ready" &&
                  displayState.payload.total > 0 &&
                  cards.length > 0 &&
                  pageCount > 1 ? (
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
                          setCurrentPage((page) =>
                            Math.min(pageCount, page + 1),
                          )
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
              </div>
            ) : null}
          </div>

          {displayState.phase === "ready" &&
          displayState.refreshError ? (
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

          {displayState.phase === "ready" && busy ? (
            <span className="sr-only" role="status">
              Updating tokens
            </span>
          ) : null}
          {renderTokenState()}
        </section>
      </div>
      <SiteFooter />
    </>
  );
}
