"use client";

import Link from "next/link";
import { ArrowRight, CircleDollarSign } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "@/components/prediction-market-experience.module.css";
import { useWallet } from "@/components/wallet-provider";
import { getPredictionMarketReleaseConfig } from "@/lib/prediction-market-chain";
import {
  formatPredictionOutcome,
  readPredictionMarketDirectory,
  type PredictionMarketView,
} from "@/lib/prediction-market-trading";

type PortfolioState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ready";
      nextCursor: bigint;
      positions: readonly PredictionMarketView[];
      scannedMarkets: number;
    }
  | { kind: "error"; message: string };

const PORTFOLIO_SCAN_PAGE_SIZE = 24;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Prediction positions are unavailable";
}

export function PredictionMarketPortfolio() {
  const { openWallet, wallet } = useWallet();
  const release = useMemo(() => {
    try {
      return getPredictionMarketReleaseConfig();
    } catch {
      return null;
    }
  }, []);
  const [state, setState] = useState<PortfolioState>({ kind: "idle" });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState("");

  useEffect(() => {
    if (!wallet || !release) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setState({ kind: "loading" });
      void readPredictionMarketDirectory({
        account: wallet.account,
        config: release,
        limit: PORTFOLIO_SCAN_PAGE_SIZE,
      })
        .then((directory) => {
          if (!active) return;
          setState({
            kind: "ready",
            nextCursor: directory.nextCursor,
            positions: directory.markets.filter(
              (market) => market.yesBalanceAtoms > 0n || market.noBalanceAtoms > 0n,
            ),
            scannedMarkets: directory.markets.length,
          });
        })
        .catch((error) => {
          if (active) setState({ kind: "error", message: errorMessage(error) });
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [release, wallet]);

  async function loadOlderPositions() {
    if (!wallet || !release || state.kind !== "ready" || state.nextCursor === 0n || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError("");
    try {
      const directory = await readPredictionMarketDirectory({
        account: wallet.account,
        config: release,
        cursor: state.nextCursor,
        limit: PORTFOLIO_SCAN_PAGE_SIZE,
      });
      const positions = directory.markets.filter(
        (market) => market.yesBalanceAtoms > 0n || market.noBalanceAtoms > 0n,
      );
      setState((current) => {
        if (current.kind !== "ready") return current;
        const known = new Set(current.positions.map((market) => market.semanticKey.toLowerCase()));
        return {
          kind: "ready",
          nextCursor: directory.nextCursor,
          positions: [
            ...current.positions,
            ...positions.filter(
              (market) => !known.has(market.semanticKey.toLowerCase()),
            ),
          ],
          scannedMarkets: current.scannedMarkets + directory.markets.length,
        };
      });
    } catch (error) {
      setOlderError(errorMessage(error));
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <section className={styles.portfolioSection} aria-labelledby="prediction-portfolio-title">
      <header>
        <div>
          <span className={styles.sectionIndex}>PREDICTION</span>
          <h2 id="prediction-portfolio-title">Prediction positions</h2>
        </div>
        <Link href="/markets">All markets <ArrowRight aria-hidden="true" size={14} /></Link>
      </header>
      {!release ? (
        <div className={styles.portfolioEmpty}>
          <CircleDollarSign aria-hidden="true" size={20} />
          <span><strong>Deployment pending</strong><small>Positions appear here after the reviewed Robinhood release is configured.</small></span>
        </div>
      ) : !wallet ? (
        <button className={styles.portfolioConnect} type="button" onClick={openWallet}>Connect wallet to read positions</button>
      ) : state.kind === "loading" || state.kind === "idle" ? (
        <div className={styles.portfolioEmpty}>
          Checking the {PORTFOLIO_SCAN_PAGE_SIZE} most recent markets across both RPCs…
        </div>
      ) : state.kind === "error" ? (
        <div className={styles.portfolioEmpty}>{state.message}</div>
      ) : state.positions.length === 0 ? (
        <div className={styles.portfolioEmpty}>
          No YES or NO balance in the {state.scannedMarkets} markets checked so far.
        </div>
      ) : (
        <div className={styles.positionRows}>
          {state.positions.map((market) => (
            <Link href={`/markets/${market.semanticKey}`} key={market.semanticKey}>
              <span><strong>{market.title}</strong><small>{market.state.replaceAll("_", " ")}</small></span>
              <span><small>YES</small><strong>{formatPredictionOutcome(market.yesBalanceAtoms)}</strong></span>
              <span><small>NO</small><strong>{formatPredictionOutcome(market.noBalanceAtoms)}</strong></span>
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          ))}
        </div>
      )}
      {state.kind === "ready" && state.nextCursor > 0n ? (
        <button
          className={styles.portfolioConnect}
          disabled={loadingOlder}
          onClick={() => void loadOlderPositions()}
          type="button"
        >
          {loadingOlder ? "Checking older markets across both RPCs…" : "Check older markets for positions"}
        </button>
      ) : null}
      {olderError ? <div className={styles.portfolioEmpty}>{olderError}</div> : null}
    </section>
  );
}
