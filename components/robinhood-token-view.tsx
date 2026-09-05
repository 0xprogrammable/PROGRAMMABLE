"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Copy, Globe, Link2, Send } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatedMarketCap } from "@/components/animated-market-cap";
import { DiscordBrandIcon, GitHubBrandIcon, XBrandIcon } from "@/components/brand-icons";
import { RobinhoodCoinArtwork } from "@/components/robinhood-coin-artwork";
import { useRobinhoodPresentation } from "@/components/use-robinhood-presentation";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import { coinDollars, coinTicker } from "@/lib/robinhood-presentation";
import styles from "./robinhood-token-view.module.css";

const EXPLORER = "https://robinhoodchain.blockscout.com";

export function RobinhoodTokenView({ address, token, status }: {
  address: string;
  token: RobinhoodLaunch | null;
  status: "ready" | "syncing" | "stale" | "unavailable";
}) {
  const presentation = useRobinhoodPresentation(`token=${encodeURIComponent(address)}`, token !== null);
  const details = presentation.items.find((item) => item.tokenAddress.toLowerCase() === address.toLowerCase());
  const market = details?.market;
  const name = token?.name?.trim() || "Unnamed token";
  const change = market?.change24hPercent;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [address]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), 3_000);
    return () => clearTimeout(timer);
  }, [copyState]);

  async function copyAddress() {
    try { await navigator.clipboard.writeText(address); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  }

  return (
    <div className={`${styles.page} page-width`}>
      <Link className={styles.back} href="/explore/robinhood"><ArrowLeft aria-hidden="true" size={16} /> Explore</Link>
      {token ? <>
        <section className={styles.market} aria-label={`${name} market`}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <RobinhoodCoinArtwork className={styles.avatar} imageUrl={details?.imageUrl} loading={presentation.loading} />
            <div className={styles.identityText}>
              <div className={styles.nameRow}>
                <h1>{name}</h1>
                {details?.links.length ? <nav className={styles.socials} aria-label={`${name} links`}>
                  {details.links.map((link) => <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noreferrer" title={link.label} aria-label={`${link.label} (opens in a new tab)`}>
                    <ProjectLinkIcon label={link.label} />
                  </a>)}
                </nav> : null}
              </div>
              <p className={styles.subtitle}><span>{coinTicker(token.symbol)}</span><span>Robinhood</span></p>
              {details?.description ? <p className={styles.bio}>{details.description}</p> : null}
            </div>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.secondaryButton} onClick={copyAddress} type="button" title={address}>
              {copyState === "copied" ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
              {copyState === "copied" ? "Copied" : "Copy address"}
            </button>
            <a className={styles.secondaryButton} href={`${EXPLORER}/token/${address}`} target="_blank" rel="noreferrer">Explorer <ArrowUpRight aria-hidden="true" size={16} /><span className="sr-only"> (opens in a new tab)</span></a>
          </div>
        </header>
        <p className="sr-only" role="status">{copyState === "copied" ? "Token address copied" : ""}</p>
        {copyState === "failed" ? <p className={styles.notice} role="status">Could not copy. <a href={`${EXPLORER}/token/${address}`} target="_blank" rel="noreferrer">View the address on Explorer.</a></p> : null}

            <dl className={styles.metrics}>
              <Metric label="Price" value={coinDollars(market?.priceUsd, true)} />
              <Metric label="Market cap" value={market?.marketCapUsd != null && Number.isFinite(market.marketCapUsd) && market.marketCapUsd >= 0
                ? <AnimatedMarketCap metric={{ kind: "usd", value: market.marketCapUsd }} replayKey={`4663:${address.toLowerCase()}:${market.poolId.toLowerCase()}:market-cap`} />
                : "—"} />
              <Metric label="Liquidity" value={coinDollars(market?.liquidityUsd)} />
              <Metric label="24h volume" value={coinDollars(market?.volume24hUsd)} />
              <div>
                <dt>24h change</dt>
                <dd className={styles.change} data-direction={change != null && change < 0 ? "down" : change != null && change > 0 ? "up" : "flat"}>
                  {change != null && Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
                </dd>
              </div>
            </dl>
            <RobinhoodChart poolId={token.poolId} name={name} />
          </section>
      </> : <section className={styles.empty}>
        <h1>Token details</h1>
        <p>{status === "ready" ? "This token is not in the verified Robinhood launch index." : "Robinhood launch details are temporarily unavailable. Try again in a moment."}</p>
        <a href={`${EXPLORER}/token/${address}`} target="_blank" rel="noreferrer">View on explorer <ArrowUpRight aria-hidden="true" size={14} /></a>
      </section>}
    </div>
  );
}

function RobinhoodChart({ poolId, name }: { poolId: string; name: string }) {
  const [loadedPool, setLoadedPool] = useState<string | null>(null);
  const safePool = /^0x[0-9a-f]{64}$/i.test(poolId);
  // The embedded chart fetches its own data; metric refreshes must not remove it.
  return <div className={styles.chart}>
    {safePool ? <>
      {loadedPool !== poolId ? <div className={styles.chartState} role="status">Loading chart…</div> : null}
      <iframe
        key={poolId}
        title={`${name} price chart on DEX Screener`}
        src={`https://dexscreener.com/robinhood/${poolId}?embed=1&loadChartSettings=0&trades=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=15`}
        onLoad={() => setLoadedPool(poolId)}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
    </> : <div className={styles.chartState} role="status">Chart unavailable.</div>}
  </div>;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function ProjectLinkIcon({ label }: { label: string }) {
  if (label === "X") return <XBrandIcon />;
  if (label === "Website") return <Globe aria-hidden="true" size={18} />;
  if (label === "GitHub") return <GitHubBrandIcon />;
  if (label === "Discord") return <DiscordBrandIcon />;
  if (label === "Telegram") return <Send aria-hidden="true" size={18} />;
  if (label === "Docs") return <BookOpen aria-hidden="true" size={18} />;
  return <Link2 aria-hidden="true" size={18} />;
}
