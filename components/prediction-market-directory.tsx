"use client";

import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

import { ExploreModeSwitch } from "@/components/explore-mode-switch";
import styles from "@/components/prediction-market-experience.module.css";
import { predictionPreviewMarkets } from "@/components/prediction-market-preview";
import { getPredictionMarketReleaseConfig } from "@/lib/prediction-market-chain";
import { predictionMarketErrorMessage } from "@/lib/prediction-market-errors";
import {
  formatPredictionPriceAtoms,
  readPredictionMarketDirectory,
  type PredictionMarketView,
} from "@/lib/prediction-market-trading";

type DirectoryState =
  | { kind: "loading" }
  | { kind: "preview"; markets: readonly PredictionMarketView[] }
  | {
      kind: "live";
      markets: readonly PredictionMarketView[];
      nextCursor: bigint;
    }
  | { kind: "error"; message: string };

const DIRECTORY_PAGE_SIZE = 12;

function errorMessage(error: unknown) {
  return predictionMarketErrorMessage(
    error,
    "Markets are temporarily unavailable",
  );
}

function compactUtcDate(timestamp: bigint) {
  const date = new Date(Number(timestamp) * 1_000);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()} · ${hour}:${minute} UTC`;
}

function MarketCard({
  market,
  preview,
}: {
  market: PredictionMarketView;
  preview: boolean;
}) {
  const yes = market.probabilityYesBps / 100;
  const no = 100 - yes;
  const cardTitle = `Will BTC be at or above ${formatPredictionPriceAtoms(market.thresholdAtoms)}?`;
  const tradingOpen =
    market.state === "OPEN" && market.blockTimestamp < market.cutoff;
  const marketStatus = tradingOpen
    ? `Closes ${compactUtcDate(market.cutoff)}`
    : market.state === "OPEN"
      ? "Trading closed"
      : market.state === "FINAL_YES"
        ? "YES won"
        : market.state === "FINAL_NO"
          ? "NO won"
          : market.state === "FINAL_INVALID"
            ? "Neutral result"
            : "Closed";

  return (
    <article className={styles.marketCard}>
      <Link
        className={styles.marketCardLink}
        href={`/markets/${market.semanticKey}`}
      >
        <span
          className={styles.marketCardArt}
          style={{ "--yes-share": `${yes}%` } as CSSProperties}
          aria-hidden="true"
        >
          <span className={styles.marketCardChance}>
            <strong>{yes.toFixed(0)}%</strong>
            <span>YES chance</span>
          </span>
          <span className={styles.marketCardPrices}>
            <span>YES {yes.toFixed(0)}¢</span>
            <span>NO {no.toFixed(0)}¢</span>
          </span>
        </span>

        <span className={styles.marketCardBody}>
          <strong>{cardTitle}</strong>
        </span>

        <span className={styles.marketCardMeta}>
          <span>{marketStatus}</span>
          {preview ? <span>Preview</span> : null}
          <ArrowRight aria-hidden="true" size={17} />
        </span>
      </Link>
    </article>
  );
}

export function PredictionMarketDirectoryView() {
  const release = useMemo(() => {
    try {
      return { config: getPredictionMarketReleaseConfig(), error: "" };
    } catch (error) {
      return { config: null, error: errorMessage(error) };
    }
  }, []);
  const [state, setState] = useState<DirectoryState>({ kind: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState("");

  useEffect(() => {
    let active = true;
    if (!release.config) {
      const timer = window.setTimeout(() => {
        if (!active) return;
        setState({
          kind: "preview",
          markets: predictionPreviewMarkets(Math.floor(Date.now() / 1_000)),
        });
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }
    void readPredictionMarketDirectory({
      config: release.config,
      limit: DIRECTORY_PAGE_SIZE,
    })
      .then((directory) => {
        if (active) {
          setState({
            kind: "live",
            markets: directory.markets,
            nextCursor: directory.nextCursor,
          });
        }
      })
      .catch((error) => {
        if (active) setState({ kind: "error", message: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [release.config]);

  async function loadOlderMarkets() {
    if (
      !release.config ||
      state.kind !== "live" ||
      state.nextCursor === 0n ||
      loadingOlder
    )
      return;
    setLoadingOlder(true);
    setOlderError("");
    try {
      const directory = await readPredictionMarketDirectory({
        config: release.config,
        cursor: state.nextCursor,
        limit: DIRECTORY_PAGE_SIZE,
      });
      setState((current) => {
        if (current.kind !== "live") return current;
        const known = new Set(
          current.markets.map((market) => market.semanticKey.toLowerCase()),
        );
        return {
          ...current,
          markets: [
            ...current.markets,
            ...directory.markets.filter(
              (market) => !known.has(market.semanticKey.toLowerCase()),
            ),
          ],
          nextCursor: directory.nextCursor,
        };
      });
    } catch (error) {
      setOlderError(errorMessage(error));
    } finally {
      setLoadingOlder(false);
    }
  }

  const markets = "markets" in state ? state.markets : [];

  return (
    <main className={`page-width ${styles.directoryPage}`}>
      <header className={styles.exploreHeader}>
        <h1>Explore</h1>
        <ExploreModeSwitch active="prediction" />
      </header>

      <div className={styles.directoryToolbar}>
        <Link className={styles.createMarketLink} href="/launch">
          <Plus aria-hidden="true" size={17} />
          Create market
        </Link>
      </div>

      {state.kind === "preview" ? (
        <p className={styles.previewBanner} role="status">
          <strong>Preview data.</strong> These sample markets never request a
          wallet signature.
        </p>
      ) : null}
      {release.error ? (
        <p className={styles.errorBanner}>{release.error}</p>
      ) : null}
      {state.kind === "error" ? (
        <p className={styles.errorBanner} role="alert">
          {state.message}
        </p>
      ) : null}

      <section className={styles.directoryList} aria-label="Prediction markets">
        {state.kind === "loading" ? (
          <div className={styles.marketLoading} aria-live="polite">
            Loading predictions…
          </div>
        ) : markets.length ? (
          <div className={styles.marketGrid}>
            {markets.map((market) => (
              <MarketCard
                key={market.semanticKey}
                market={market}
                preview={state.kind === "preview"}
              />
            ))}
          </div>
        ) : state.kind === "live" ? (
          <div className={styles.marketLoading}>
            <strong>No predictions yet</strong>
            <span>Create the first market.</span>
          </div>
        ) : null}
        {state.kind === "live" && state.nextCursor > 0n ? (
          <button
            className={styles.loadMoreMarkets}
            disabled={loadingOlder}
            onClick={() => void loadOlderMarkets()}
            type="button"
          >
            {loadingOlder ? "Loading…" : "Show more"}
          </button>
        ) : null}
        {olderError ? (
          <p className={styles.errorBanner} role="alert">
            {olderError}
          </p>
        ) : null}
      </section>
    </main>
  );
}
