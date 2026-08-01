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
  Send,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AnimatedMarketCap,
  type MarketCapMetric,
} from "@/components/animated-market-cap";
import { XBrandIcon } from "@/components/brand-icons";
import { showcaseProjects } from "@/components/project-showcase-data";
import { SiteFooter } from "@/components/site-footer";
import { WebsiteLinkIcon } from "@/components/website-link-icon";
import styles from "@/components/explore-experience.module.css";
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
  description: string;
  links: TokenLink[];
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
    description:
      token.description?.trim() ||
      "Open the project profile to inspect its hook and pool configuration.",
    links: token.links ?? [],
  }));
}

function TokenLinkIcon({ kind }: { kind: TokenLink["kind"] }) {
  if (kind === "x") return <XBrandIcon />;
  if (kind === "telegram") {
    return <Send aria-hidden="true" size={16} strokeWidth={1.7} />;
  }
  return <WebsiteLinkIcon />;
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
        <div className={styles.directoryState} role="status">
          <span className={styles.loadingLine} aria-hidden="true" />
          <p>Loading projects…</p>
        </div>
      );
    }

    if (state.phase === "error") {
      return (
        <div className={styles.directoryState} role="alert">
          <p>{state.message}</p>
          <button
            className={styles.textAction}
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
        <div className={styles.directoryState}>
          <div>
            <span className={styles.stateLabel}>Live directory</span>
            <h3>No indexed launches yet</h3>
            <p>
              Verified launches will appear here automatically. The project
              previews above demonstrate the complete profile structure.
            </p>
          </div>
          <Link className={styles.textAction} href="/launch">
            Open launch builder
          </Link>
        </div>
      );
    }

    if (cards.length === 0) {
      if (debouncedQuery) {
        return (
          <div className={styles.directoryState}>
            <p>No tokens match this search</p>
            <button
              className={styles.textAction}
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
        <div className={styles.directoryState}>
          <div>
            <span className={styles.stateLabel}>Live directory</span>
            <h3>No indexed launches yet</h3>
            <p>
              Verified launches will appear here automatically. The project
              previews above demonstrate the complete profile structure.
            </p>
          </div>
          <Link className={styles.textAction} href="/launch">
            Open launch builder
          </Link>
        </div>
      );
    }

    return (
      <div
        className={styles.tokenGrid}
        key={`${activePage}:${sort}:${debouncedQuery}`}
      >
        {cards.map((token, index) => {
          const href = `/token/${token.tokenAddress}`;
          const imageSource = getTokenCardImageSource(token.imageUrl);

          return (
            <article className={styles.tokenCard} key={token.id}>
              <Link
                className={styles.tokenCardHitArea}
                href={href}
                aria-label={`View ${token.name}`}
              />

              <span className={styles.tokenArtwork}>
                <Image
                  className={styles.tokenImage}
                  src={imageSource}
                  alt={
                    token.usesFallbackImage ? "" : `${token.name} token image`
                  }
                  fill
                  sizes="(max-width: 900px) 92vw, 30vw"
                  unoptimized={!canOptimizeTokenImage(imageSource)}
                />
                <span className={styles.indexedBadge}>Indexed launch</span>
              </span>

              <div className={styles.tokenBody}>
                <header className={styles.tokenHeading}>
                  <span>Uniswap v4 project</span>
                  <div>
                    <h3>{token.name}</h3>
                    <strong>${token.symbol}</strong>
                  </div>
                </header>

                <p className={styles.tokenDescription}>{token.description}</p>

                <footer className={styles.tokenFooter}>
                  {token.marketCap ? (
                    <span className={styles.marketCap}>
                      <span>Market cap</span>
                      <AnimatedMarketCap
                        delay={index * 18}
                        metric={token.marketCap}
                        replayKey={`${activePage}:${sort}:${debouncedQuery}`}
                      />
                    </span>
                  ) : (
                    <span className={styles.marketCap}>
                      <span>Market cap</span>
                      <strong>—</strong>
                    </span>
                  )}

                  <span className={styles.tokenLinks}>
                    <button
                      type="button"
                      aria-label={
                        copiedAddress === token.tokenAddress
                          ? `${token.name} contract address copied`
                          : `Copy ${token.name} contract address`
                      }
                      title={
                        copiedAddress === token.tokenAddress
                          ? "Copied"
                          : "Copy contract address"
                      }
                      onClick={() => copyAddress(token.tokenAddress)}
                    >
                      {copiedAddress === token.tokenAddress ? (
                        <Check aria-hidden="true" size={15} />
                      ) : (
                        <Copy aria-hidden="true" size={15} />
                      )}
                    </button>
                    {token.links.slice(0, 3).map((link) => (
                      <a
                        key={`${link.kind}:${link.url}`}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${token.name} ${link.kind}`}
                      >
                        <TokenLinkIcon kind={link.kind} />
                      </a>
                    ))}
                    <span className={styles.profileArrow} aria-hidden="true">
                      <ArrowRight size={16} />
                    </span>
                  </span>
                </footer>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <h1>The home of Uniswap v4 projects.</h1>
            <p>
              Discover tokens as complete projects — their idea, hook, market,
              creator, and community in one place.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.primaryAction} href="#projects">
                Explore projects
                <ArrowRight aria-hidden="true" size={16} />
              </a>
              <Link className={styles.secondaryAction} href="/launch">
                Launch a project
              </Link>
            </div>
          </div>

          <aside className={styles.heroIndex} aria-label="Project preview index">
            <div className={styles.heroIndexHeading}>
              <span>Project atlas</span>
              <strong>Preview</strong>
            </div>
            <ol>
              {showcaseProjects.map((project, index) => (
                <li key={project.slug}>
                  <Link href={`/projects/${project.slug}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{project.name}</strong>
                    <small>{project.category}</small>
                    <ArrowRight aria-hidden="true" size={15} />
                  </Link>
                </li>
              ))}
            </ol>
          </aside>
        </section>

        <section className={styles.showcase} id="projects">
          <header className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>Project previews</span>
              <h2>Every token gets a room.</h2>
            </div>
            <p>
              Illustrative profiles for the new project experience. These
              concepts are not deployed tokens or live markets.
            </p>
          </header>

          <div className={styles.showcaseFeed}>
            {showcaseProjects.map((project, index) => (
              <article
                className={`${styles.showcaseCard} ${
                  index % 2 === 1 ? styles.showcaseCardReverse : ""
                }`}
                data-palette={project.palette}
                key={project.slug}
              >
                <Link
                  className={styles.showcaseHitArea}
                  href={`/projects/${project.slug}`}
                  aria-label={`Open ${project.name} project preview`}
                />
                <div className={styles.showcaseArtwork}>
                  <Image
                    src={project.image}
                    alt={`${project.name} project artwork`}
                    fill
                    loading="eager"
                    sizes="(max-width: 900px) 100vw, 55vw"
                    unoptimized={project.slug === "studio-pass"}
                  />
                  <span>Interface preview</span>
                </div>
                <div className={styles.showcaseBody}>
                  <div className={styles.showcaseTopline}>
                    <span>{project.category}</span>
                    <strong>${project.symbol}</strong>
                  </div>
                  <h3>{project.name}</h3>
                  <p>{project.summary}</p>
                  <div className={styles.showcaseMeta}>
                    <span>
                      <small>Model</small>
                      <strong>{project.model}</strong>
                    </span>
                    <span>
                      <small>Market cap</small>
                      <strong>Not live</strong>
                    </span>
                  </div>
                  <span className={styles.showcaseAction}>
                    Open project profile
                    <ArrowRight aria-hidden="true" size={16} />
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.directory} id="tokens" aria-busy={busy}>
          <div className={styles.directoryHeading}>
            <div className={styles.directoryTitle}>
              <span className={styles.eyebrow}>Live directory</span>
              <h2>Indexed launches</h2>
              <p>
                {state.phase === "ready" && state.payload.total > 0
                  ? `${state.payload.total} indexed projects`
                  : "Verified onchain records"}
              </p>
            </div>
            {hasPublicTokens ? (
              <div className={styles.toolbar}>
                <label className={styles.search}>
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

                <details className={styles.filter} ref={filterRef}>
                  <summary>
                    <SlidersHorizontal aria-hidden="true" size={16} />
                    <span>Sort</span>
                    <ChevronDown
                      className={styles.filterChevron}
                      aria-hidden="true"
                      size={15}
                    />
                  </summary>
                  <div
                    className={styles.filterMenu}
                    role="group"
                    aria-label="Sort tokens"
                  >
                    {sortOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        data-active={sort === option.id ? "true" : undefined}
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
                  <nav className={styles.pagination} aria-label="Token pages">
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

                    <div className={styles.paginationPages}>
                      {paginationItems.map((item) =>
                        typeof item === "number" ? (
                          <button
                            key={item}
                            data-active={
                              activePage === item ? "true" : undefined
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
            <div className={styles.refreshWarning} role="status">
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
      </main>
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
