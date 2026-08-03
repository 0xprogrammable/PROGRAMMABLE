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

import { type MarketCapMetric } from "@/components/animated-market-cap";
import { XBrandIcon } from "@/components/brand-icons";
import { EXPLORE_PREVIEW_TOKENS } from "@/components/explore-preview-data";
import { useInterfacePreview } from "@/components/interface-preview";
import { SiteFooter } from "@/components/site-footer";
import {
  LIVE_DATA_REFRESH_INTERVAL_MS,
  shouldRefreshLiveData,
  useLiveDataRefresh,
} from "@/components/use-live-data-refresh";
import { WebsiteLinkIcon } from "@/components/website-link-icon";
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
  description?: string;
  imageUrl: string;
  links: TokenLink[];
  usesFallbackImage: boolean;
  tokenAddress: `0x${string}`;
};

type TokenSort = "newest" | "oldest" | "market-cap" | "market-cap-asc";
export type ExploreSocialFilter = "all" | "yes" | "no";

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

export const EXPLORE_TOKENS_PER_PAGE = 9;
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
const socialFilterOptions: { id: ExploreSocialFilter; label: string }[] = [
  { id: "all", label: "Any" },
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
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
    pageSize: Math.max(
      1,
      positiveInteger(value.pageSize, EXPLORE_TOKENS_PER_PAGE),
    ),
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

export function getExplorePaginationItems(
  currentPage: number,
  pageCount: number,
): PaginationItem[] {
  if (pageCount <= 4) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, "end-gap", pageCount];
  }

  if (currentPage >= pageCount - 2) {
    return [
      1,
      "start-gap",
      pageCount - 2,
      pageCount - 1,
      pageCount,
    ];
  }

  return [
    1,
    "start-gap",
    currentPage,
    "end-gap",
    pageCount,
  ];
}

export function tokenHasSocialLinks(
  token: Pick<LauncherToken, "links">,
) {
  return Boolean(
    token.links?.some(
      (link) => link.kind === "x" || link.kind === "telegram",
    ),
  );
}

export function filterTokensBySocialPresence(
  tokens: LauncherToken[],
  socialFilter: ExploreSocialFilter,
) {
  if (socialFilter === "all") return tokens;
  const shouldHaveSocials = socialFilter === "yes";
  return tokens.filter(
    (token) => tokenHasSocialLinks(token) === shouldHaveSocials,
  );
}

function getTokenCards(tokens: LauncherToken[]): TokenCard[] {
  return tokens.map((token) => ({
    id: token.id,
    name: token.name,
    description: token.description?.trim() || undefined,
    imageUrl:
      token.imageUrl?.trim() || getFallbackTokenImage(token.tokenAddress),
    links: token.links ?? [],
    usesFallbackImage: !token.imageUrl?.trim(),
    tokenAddress: token.tokenAddress,
  }));
}

function getTokenLinkLabel(kind: TokenLink["kind"]) {
  if (kind === "website") return "Website";
  if (kind === "telegram") return "Telegram";
  return "X";
}

function TelegramBrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.8 3.2 19.5 20.1c-.25 1.2-.91 1.5-1.85.94l-5.03-3.71-2.43 2.34c-.27.27-.5.5-1.02.5l.36-5.13 9.34-8.44c.41-.36-.09-.56-.63-.2L6.7 13.67l-4.98-1.56c-1.08-.34-1.1-1.08.23-1.6L21.36 3c.9-.33 1.69.2 1.44 1.2Z"
      />
    </svg>
  );
}

function TokenLinkIcon({ kind }: { kind: TokenLink["kind"] }) {
  if (kind === "website") return <WebsiteLinkIcon />;
  if (kind === "telegram") return <TelegramBrandIcon />;
  return <XBrandIcon />;
}

export function ExploreView() {
  const preview = useInterfacePreview();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<TokenSort>("market-cap");
  const [socialFilter, setSocialFilter] =
    useState<ExploreSocialFilter>("all");
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
      limit: String(EXPLORE_TOKENS_PER_PAGE),
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
      pageSize: EXPLORE_TOKENS_PER_PAGE,
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
  const filteredTokens = useMemo(
    () =>
      filterTokensBySocialPresence(payload?.tokens ?? [], socialFilter),
    [payload?.tokens, socialFilter],
  );
  const cards = useMemo(
    () => getTokenCards(filteredTokens),
    [filteredTokens],
  );
  const pageCount = Math.max(1, payload?.totalPages ?? 0);
  const activePage = Math.min(payload?.page ?? currentPage, pageCount);
  const paginationItems = getExplorePaginationItems(activePage, pageCount);
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
      if (debouncedQuery || socialFilter !== "all") {
        const noMatchMessage = debouncedQuery
          ? socialFilter === "all"
            ? "No tokens match this search"
            : "No tokens match this search and filter"
          : socialFilter === "yes"
            ? "No tokens on this page have social links"
            : "Every token on this page has social links";
        return (
          <div className="token-empty">
            <p>{noMatchMessage}</p>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setQuery("");
                setSocialFilter("all");
                setCurrentPage(1);
              }}
            >
              Clear filters
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
                    loading={index < 6 ? "eager" : "lazy"}
                    sizes="(max-width: 700px) calc(100vw - 28px), (max-width: 1040px) 46vw, 31vw"
                    unoptimized={!canOptimizeTokenImage(imageSource)}
                  />
                </div>

                <div className={styles.runnerBody}>
                  <header className={styles.runnerHeading}>
                    <h3 title={token.name}>{token.name}</h3>
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
                </div>
              </Link>

              {token.links.length > 0 ? (
                <div
                  className={styles.runnerSocials}
                  role="group"
                  aria-label={`${token.name} links`}
                >
                  {token.links.map((link) => {
                    const label = getTokenLinkLabel(link.kind);
                    return (
                      <a
                        className={styles.runnerSocialLink}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${token.name} ${label}`}
                        title={label}
                        key={`${link.kind}:${link.url}`}
                      >
                        <TokenLinkIcon kind={link.kind} />
                      </a>
                    );
                  })}
                </div>
              ) : null}
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
          <h1>Launch tokens that work the way you imagine.</h1>
        </header>

        <section
          className={`${styles.runnersSection} token-section`}
          id="tokens"
          aria-busy={busy}
        >
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
                    <summary
                      aria-label={
                        socialFilter === "all"
                          ? "Filter and sort tokens"
                          : "Filter and sort tokens, one filter active"
                      }
                    >
                      <SlidersHorizontal aria-hidden="true" size={16} />
                      <span>Filter</span>
                      {socialFilter !== "all" ? (
                        <span
                          className={styles.activeFilterCount}
                          aria-hidden="true"
                        >
                          1
                        </span>
                      ) : null}
                      <ChevronDown
                        className="token-filter-chevron"
                        aria-hidden="true"
                        size={15}
                      />
                    </summary>
                    <div
                      className={`token-filter-menu ${styles.filterMenu}`}
                      role="group"
                      aria-label="Filter and sort tokens"
                    >
                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-sort-label"
                      >
                        <p
                          className={styles.filterLabel}
                          id="explore-sort-label"
                        >
                          Sort by
                        </p>
                        {sortOptions.map((option) => (
                          <button
                            key={option.id}
                            className={
                              sort === option.id ? "active" : undefined
                            }
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

                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-socials-label"
                      >
                        <p
                          className={styles.filterLabel}
                          id="explore-socials-label"
                        >
                          Socials
                        </p>
                        {socialFilterOptions.map((option) => (
                          <button
                            key={option.id}
                            className={
                              socialFilter === option.id
                                ? "active"
                                : undefined
                            }
                            type="button"
                            aria-pressed={socialFilter === option.id}
                            onClick={() => {
                              setSocialFilter(option.id);
                              setCurrentPage(1);
                              const filter = filterRef.current;
                              filter?.removeAttribute("open");
                              filter?.querySelector("summary")?.focus();
                            }}
                          >
                            <span>{option.label}</span>
                            {socialFilter === option.id ? (
                              <Check aria-hidden="true" size={15} />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  </details>

                  {displayState.phase === "ready" &&
                  displayState.payload.status === "ready" &&
                  displayState.payload.total > 0 &&
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
