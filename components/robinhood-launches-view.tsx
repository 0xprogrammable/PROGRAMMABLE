"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ExploreChainSelector } from "@/components/explore-chain-selector";
import { ExploreIndexResetView } from "@/components/explore-index-reset-view";
import { useViewChain } from "@/components/view-chain";
import { RobinhoodCoinArtwork } from "@/components/robinhood-coin-artwork";
import { useRobinhoodPresentation } from "@/components/use-robinhood-presentation";
import { coinAge, coinDollars, coinTicker } from "@/lib/robinhood-presentation";
import styles from "@/components/robinhood-launches-view.module.css";

type Launch = {
  launchId: string;
  tokenAddress: string;
  hookAddress: string;
  creator: string;
  transactionHash: string;
  blockNumber: string;
  launchedAt: string | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
};

type LaunchResponse = {
  chainId: 4663;
  status: "ready" | "syncing" | "stale" | "unavailable";
  updatedAt: string | null;
  items: Launch[];
  page: {
    number: number;
    size: number;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
  };
};

type Request = { page: number; q: string };
type Snapshot = { request: Request; data: LaunchResponse };

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const REFRESH_MS = 30_000;
const REQUEST_TIMEOUT_MS = 12_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 4_096);
}

function isLaunch(value: unknown): value is Launch {
  if (!isObject(value)) return false;
  return typeof value.launchId === "string" && HASH.test(value.launchId)
    && typeof value.tokenAddress === "string" && ADDRESS.test(value.tokenAddress)
    && typeof value.hookAddress === "string" && ADDRESS.test(value.hookAddress)
    && typeof value.creator === "string" && ADDRESS.test(value.creator)
    && typeof value.transactionHash === "string" && HASH.test(value.transactionHash)
    && typeof value.blockNumber === "string" && /^\d+$/.test(value.blockNumber)
    && isDate(value.launchedAt) && isText(value.name) && isText(value.symbol)
    && (value.decimals === null || (Number.isInteger(value.decimals)
      && Number(value.decimals) >= 0 && Number(value.decimals) <= 255));
}

function readResponse(value: unknown): LaunchResponse {
  if (!isObject(value) || value.chainId !== 4663
    || !["ready", "syncing", "stale", "unavailable"].includes(String(value.status))
    || !isDate(value.updatedAt) || !Array.isArray(value.items)
    || value.items.length > 50 || !value.items.every(isLaunch) || !isObject(value.page)) {
    throw new Error("Invalid launch response");
  }
  const page = value.page;
  if (!Number.isSafeInteger(page.number) || Number(page.number) < 1
    || page.size !== 50 || !Number.isSafeInteger(page.totalItems) || Number(page.totalItems) < 0
    || !Number.isSafeInteger(page.totalPages) || Number(page.totalPages) < 0
    || typeof page.hasMore !== "boolean") {
    throw new Error("Invalid launch pagination");
  }
  return value as LaunchResponse;
}

export function RobinhoodLaunchesView({
  embedded = false,
}: Readonly<{ embedded?: boolean }>) {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();

  useEffect(() => {
    if (!hydrated) return;
    const chains = new URLSearchParams(window.location.search).getAll("chain");
    if (chains.length === 1 && (chains[0] === "1" || chains[0] === "4663")) {
      // Apply an explicit link after the provider has restored its saved preference.
      const timer = window.setTimeout(() => setViewChainId(chains[0] === "4663" ? 4663 : 1), 0);
      return () => window.clearTimeout(timer);
    }
  }, [hydrated, setViewChainId]);

  if (viewChainId !== 4663) return <ExploreIndexResetView embedded={embedded} />;

  return <RobinhoodLaunchList embedded={embedded} enabled={hydrated} />;
}

function RobinhoodLaunchList({ embedded, enabled }: { embedded: boolean; enabled: boolean }) {
  const headingId = useId();
  const searchId = useId();
  const statusId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [request, setRequest] = useState<Request>({ page: 1, q: "" });
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const presentation = useRobinhoodPresentation(
    new URLSearchParams({ page: String(request.page), q: request.q }).toString(), enabled, refresh,
  );
  const presentations = new Map(presentation.items.map((item) => [item.tokenAddress.toLowerCase(), item]));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const q = search.trim();
      setRequest((current) => current.q === q ? current : { page: 1, q });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let refreshTimer: number | undefined;
    const isVisible = () => document.visibilityState !== "hidden";

    async function load() {
      if (disposed || controller || !isVisible()) return;
      const activeController = new AbortController();
      controller = activeController;
      const timeout = window.setTimeout(() => activeController.abort(), REQUEST_TIMEOUT_MS);
      setLoading(true);

      try {
        const query = new URLSearchParams({ page: String(request.page), q: request.q });
        const response = await fetch(`/api/explore/robinhood?${query}`, {
          signal: activeController.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error("Launch request failed");
        const data = readResponse(await response.json());
        if (disposed || activeController.signal.aborted) return;
        setSnapshot((current) => {
          const sameRequest = current?.request.page === request.page && current.request.q === request.q;
          if (sameRequest && current.data.items.length > 0
            && data.items.length === 0 && data.status !== "ready") {
            return { request, data: { ...current.data, status: data.status } };
          }
          return { request, data };
        });
        setFailed(false);
        setNow(Date.now());
      } catch {
        if (!disposed && isVisible()) setFailed(true);
      } finally {
        window.clearTimeout(timeout);
        controller = null;
        if (!disposed) {
          setLoading(false);
          if (isVisible()) refreshTimer = window.setTimeout(load, REFRESH_MS);
        }
      }
    }

    function visibilityChanged() {
      window.clearTimeout(refreshTimer);
      if (!isVisible()) controller?.abort();
      else void load();
    }

    void load();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [enabled, refresh, request]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequest({ page: 1, q: search.trim() });
  }

  function clearSearch() {
    setSearch("");
    setRequest({ page: 1, q: "" });
    searchRef.current?.focus();
  }

  const data = snapshot?.data;
  const items = data?.items ?? [];
  const hasRows = items.length > 0;
  const updatingSearch = search.trim() !== snapshot?.request.q;
  const Heading = embedded ? "h2" : "h1";
  const StateHeading = embedded ? "h3" : "h2";
  const count = data?.page.totalItems ?? 0;
  const statusText = loading ? hasRows ? "Updating launches…" : "Loading launches…" : failed
    ? hasRows ? "Could not refresh. Showing the last loaded results." : "Launches are temporarily unavailable."
    : data?.status === "stale" || data?.status === "unavailable"
      ? hasRows ? "Showing saved launches. Updates are temporarily unavailable." : "Launches are temporarily unavailable."
      : data?.status === "syncing"
        ? "New launches are being checked."
        : updatingSearch ? "Loading launches…" : "";
  const emptyTitle = loading
    ? "Loading Robinhood launches"
    : failed || data?.status === "unavailable" || data?.status === "stale"
      ? "Launches are temporarily unavailable"
      : data?.status === "syncing"
        ? "Checking Robinhood launches"
        : snapshot?.request.q ? "No matching launches" : "No finalized launches yet";

  return (
    <div className={`${styles.page} explore-page page-width`}>
      <header className={styles.heading}>
        <Heading data-explore-heading id={headingId}>Explore</Heading>
      </header>

      <section className={styles.body} aria-labelledby={headingId}>
        <div className={styles.toolbar}>
          <form className={styles.search} role="search" onSubmit={submitSearch}>
            <Search aria-hidden="true" size={18} />
            <label className="sr-only" htmlFor={searchId}>Search Robinhood launches by name, symbol or address</label>
            <input
              id={searchId}
              ref={searchRef}
              name="q"
              type="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              placeholder="Name, symbol or address"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-describedby={statusId}
            />
            {search ? (
              <button className={styles.clearSearch} type="button" onClick={clearSearch} aria-label="Clear search">
                <X aria-hidden="true" size={16} />
              </button>
            ) : null}
          </form>
          <ExploreChainSelector />
          <button
            className={styles.refresh}
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={loading}
            aria-label="Refresh Robinhood launches"
          >
            <RefreshCw aria-hidden="true" size={16} />
            <span>Refresh</span>
          </button>
        </div>

        <p className={failed || data?.status === "stale" || data?.status === "unavailable" ? styles.status : "sr-only"} id={statusId} role="status">
          {statusText || (data ? <span className="sr-only">{count} {count === 1 ? "launch found" : "launches found"}</span> : null)}
        </p>

        {hasRows ? (
          <ul className={styles.list} aria-label="Robinhood token launches" aria-busy={loading}>
            {items.map((launch) => {
              const details = presentations.get(launch.tokenAddress.toLowerCase());
              return (
              <li key={launch.launchId} className={styles.item}>
                <Link className={styles.row} href={`/token/${launch.tokenAddress}?chain=4663`} prefetch={false}>
                  <RobinhoodCoinArtwork
                    imageUrl={details?.imageUrl} loading={presentation.loading}
                    className={styles.artwork}
                  />
                  <div className={styles.identity}>
                    <strong className={styles.name} title={launch.name?.trim() || "Unnamed token"}>{launch.name?.trim() || "Unnamed token"}</strong>
                    <span className={styles.symbol} title={launch.symbol || undefined}>{coinTicker(launch.symbol)}</span>
                  </div>
                  <div className={styles.cardFooter}>
                    <div className={styles.marketCap}>
                      <span>Market cap</span>
                      <strong title={details?.market ? `DEX Screener · ${new Date(details.market.observedAt).toUTCString()}` : "Market data is not available yet"}>{coinDollars(details?.market?.marketCapUsd)}</strong>
                    </div>
                    {launch.launchedAt ? <time className={styles.launched} dateTime={launch.launchedAt} title={`Launched ${new Date(launch.launchedAt).toUTCString()}`}>{coinAge(launch.launchedAt, now)}</time> : null}
                  </div>
                </Link>
              </li>
            );})}
          </ul>
        ) : loading ? (
          <div className={styles.skeletonGrid} aria-label="Loading Robinhood launches" role="status">
            {Array.from({ length: 5 }, (_, index) => <div className={styles.skeletonCard} aria-hidden="true" key={index}><div /><span /><span /></div>)}
          </div>
        ) : (
          <div className={styles.empty} aria-busy={loading}>
            <StateHeading>{emptyTitle}</StateHeading>
            <p>{loading || data?.status === "syncing" ? "Verified launches will appear here." : failed || data?.status === "unavailable" || data?.status === "stale" ? "Try refreshing in a moment." : snapshot?.request.q ? "Try a token name, symbol or address." : "New Robinhood launches appear after verification."}</p>
            {!loading && snapshot?.request.q ? <button className={styles.textButton} type="button" onClick={clearSearch}>Clear search</button> : null}
          </div>
        )}

        {data && data.page.totalPages > 1 ? (
          <nav className={styles.pagination} aria-label="Launch pages">
            <button
              type="button"
              disabled={loading || data.page.number <= 1 || updatingSearch}
              onClick={() => setRequest({ page: data.page.number - 1, q: snapshot.request.q })}
            ><ChevronLeft aria-hidden="true" size={16} /> Previous</button>
            <span>Page {data.page.number} of {data.page.totalPages}</span>
            <button
              type="button"
              disabled={loading || !data.page.hasMore || updatingSearch}
              onClick={() => setRequest({ page: data.page.number + 1, q: snapshot.request.q })}
            >Next <ChevronRight aria-hidden="true" size={16} /></button>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
