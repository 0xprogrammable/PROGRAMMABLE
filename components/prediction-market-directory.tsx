"use client";

import Link from "next/link";
import { Activity, ArrowRight, Clock3, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "@/components/prediction-market-experience.module.css";
import { predictionPreviewMarkets } from "@/components/prediction-market-preview";
import { getPredictionMarketReleaseConfig } from "@/lib/prediction-market-chain";
import { predictionMarketErrorMessage } from "@/lib/prediction-market-errors";
import {
  formatPredictionUsdg,
  readPredictionMarketDirectory,
  type PredictionMarketView,
} from "@/lib/prediction-market-trading";

type DirectoryState =
  | { kind: "loading" }
  | { kind: "preview"; markets: readonly PredictionMarketView[] }
  | {
      kind: "live";
      blockNumber: bigint;
      marketCount: bigint;
      markets: readonly PredictionMarketView[];
      nextCursor: bigint;
    }
  | { kind: "error"; message: string };

const DIRECTORY_PAGE_SIZE = 12;

function errorMessage(error: unknown) {
  return predictionMarketErrorMessage(error, "Markets are temporarily unavailable");
}

function countdown(target: bigint, now: bigint) {
  const seconds = target > now ? Number(target - now) : 0;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function MarketRow({ market, preview }: { market: PredictionMarketView; preview: boolean }) {
  const yes = market.probabilityYesBps / 100;
  const no = 100 - yes;
  const tradingOpen = market.state === "OPEN" && market.blockTimestamp < market.cutoff;
  return (
    <Link
      className={styles.marketRow}
      href={`/markets/${market.semanticKey}`}
      aria-label={`${market.title}, YES ${yes.toFixed(0)} percent`}
    >
      <span className={styles.assetMark} aria-hidden="true">₿</span>
      <span className={styles.marketIdentity}>
        <span className={styles.marketMeta}>
          <span>{tradingOpen ? "TRADING" : market.state.replaceAll("_", " ")}</span>
          <span>BTC</span>
          {preview ? <span>PREVIEW</span> : null}
        </span>
        <strong>{market.title}</strong>
        <span className={styles.marketFoot}>
          <span><Clock3 aria-hidden="true" size={13} /> {countdown(market.observationTime, market.blockTimestamp)}</span>
          <span>{formatPredictionUsdg(market.accountedLiabilityAtoms)} backed</span>
        </span>
      </span>
      <span className={styles.marketProbability}>
        <span className={styles.probabilityNumbers}>
          <span><small>YES</small><strong>{yes.toFixed(0)}¢</strong></span>
          <span><small>NO</small><strong>{no.toFixed(0)}¢</strong></span>
        </span>
        <span className={styles.probabilityRail} aria-hidden="true">
          <span style={{ width: `${yes}%` }} />
        </span>
      </span>
      <ArrowRight className={styles.rowArrow} aria-hidden="true" size={20} />
    </Link>
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
            blockNumber: directory.blockNumber,
            marketCount: directory.marketCount,
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
    if (!release.config || state.kind !== "live" || state.nextCursor === 0n || loadingOlder) return;
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
        const known = new Set(current.markets.map((market) => market.semanticKey.toLowerCase()));
        return {
          ...current,
          blockNumber: directory.blockNumber,
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
  const totalBacking = markets.reduce(
    (total, market) => total + market.accountedLiabilityAtoms,
    0n,
  );
  const openMarkets = markets.filter(
    (market) => market.state === "OPEN" && market.blockTimestamp < market.cutoff,
  ).length;

  return (
    <main className={`page-width ${styles.directoryPage}`}>
      <section className={styles.directoryHero} aria-labelledby="markets-title">
        <div className={styles.heroCopy}>
          <span className={styles.kicker}>PREDICTION MARKETS · ROBINHOOD CHAIN</span>
          <h1 id="markets-title">Trade the outcome.<br />Keep the rules onchain.</h1>
          <p>
            Permissionless BTC markets, fully backed by USDG and priced through
            a native Uniswap v4 YES/NO pool.
          </p>
        </div>
        <Link className={styles.createMarketLink} href="/launch">
          <Plus aria-hidden="true" size={17} />
          Create market
        </Link>
      </section>

      <section className={styles.marketStatusStrip} aria-label="Market system status">
        <div>
          <Activity aria-hidden="true" size={17} />
          <span><small>OPEN IN VIEW</small><strong>{state.kind === "loading" ? "—" : openMarkets}</strong></span>
        </div>
        <div>
          <ShieldCheck aria-hidden="true" size={17} />
          <span><small>VISIBLE BACKING</small><strong>{state.kind === "loading" ? "—" : formatPredictionUsdg(totalBacking)}</strong></span>
        </div>
        <div>
          <span className={styles.v4Glyph}>v4</span>
          <span><small>POOL FEE</small><strong>2 bps</strong></span>
        </div>
        <div className={styles.systemMode}>
          <span className={state.kind === "live" ? styles.liveDot : styles.previewDot} />
          <span>
            <small>SYSTEM</small>
            <strong>
              {state.kind === "live"
                ? `LIVE · BLOCK ${state.blockNumber}`
                : state.kind === "preview"
                  ? "TECHNICAL PREVIEW"
                  : state.kind === "error"
                    ? "READS BLOCKED"
                    : "CHECKING"}
            </strong>
          </span>
        </div>
      </section>

      {state.kind === "preview" ? (
        <p className={styles.previewBanner} role="status">
          <strong>Interface preview.</strong> The reviewed release is not configured,
          so these sample markets cannot request signatures or transactions.
        </p>
      ) : null}
      {release.error ? <p className={styles.errorBanner}>{release.error}</p> : null}
      {state.kind === "error" ? (
        <p className={styles.errorBanner} role="alert">{state.message}</p>
      ) : null}

      <section className={styles.directoryList} aria-labelledby="open-markets-title">
        <header>
          <div>
            <span className={styles.sectionIndex}>01</span>
            <h2 id="open-markets-title">Markets</h2>
          </div>
          <span>
            {state.kind === "live"
              ? `Showing ${markets.length} of ${state.marketCount.toString()} · probability · UTC`
              : "Probability · backing · UTC result time"}
          </span>
        </header>
        {state.kind === "loading" ? (
          <div className={styles.marketLoading} aria-live="polite">Checking both public Robinhood RPCs…</div>
        ) : markets.length ? (
          <div className={styles.marketRows}>
            {markets.map((market) => (
              <MarketRow
                key={market.semanticKey}
                market={market}
                preview={state.kind === "preview"}
              />
            ))}
          </div>
        ) : state.kind === "live" ? (
          <div className={styles.marketLoading}>
            No market exists yet. The first creator can launch one for 2 USDG plus gas.
          </div>
        ) : null}
        {state.kind === "live" && state.nextCursor > 0n ? (
          <button
            className={styles.loadMoreMarkets}
            disabled={loadingOlder}
            onClick={() => void loadOlderMarkets()}
            type="button"
          >
            {loadingOlder ? "Checking both RPCs…" : "Load older markets"}
          </button>
        ) : null}
        {olderError ? <p className={styles.errorBanner} role="alert">{olderError}</p> : null}
      </section>
    </main>
  );
}
