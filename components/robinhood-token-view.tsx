"use client";

import Link from "next/link";
import { ArrowLeft, Check, Copy, ExternalLink, ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
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
      <Link className={styles.back} href="/explore?chain=4663"><ArrowLeft aria-hidden="true" size={16} /> Explore</Link>
      {token ? <>
        <header className={styles.header}>
          <div className={styles.identity}>
            <RobinhoodCoinArtwork className={styles.avatar} imageUrl={details?.imageUrl} name={token.name} symbol={token.symbol} />
            <div className={styles.identityText}>
              <h1>{name}</h1>
              <p><span>{coinTicker(token.symbol)}</span><span>Robinhood</span></p>
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
        <p className="sr-only" role="status">{copyState === "failed" ? "Could not copy. The full address is available in Launch details below." : copyState === "copied" ? "Token address copied" : ""}</p>
        {status === "stale" ? <p className={styles.notice} role="status">Showing saved launch details. Updates are temporarily unavailable.</p> : null}

        <div className={styles.layout}>
          <section className={styles.market} aria-label={`${name} market`}>
            <dl className={styles.metrics}>
              <Metric label="Market cap" value={coinDollars(market?.marketCapUsd)} />
              <Metric label="Liquidity" value={coinDollars(market?.liquidityUsd)} />
              <Metric label="24h volume" value={coinDollars(market?.volume24hUsd)} />
            </dl>
            <div className={styles.priceHeading}>
              <div><span className={styles.label}>Price</span><p className={styles.price}>{coinDollars(market?.priceUsd, true)}</p></div>
              {change != null && Number.isFinite(change) ? <p className={styles.change} data-direction={change < 0 ? "down" : change > 0 ? "up" : "flat"}>{change > 0 ? "+" : ""}{change.toFixed(2)}% <span>24h</span></p> : null}
            </div>
            <RobinhoodChart poolId={token.poolId} name={name} available={Boolean(market)} loading={presentation.loading} />
            <div className={styles.chartFooter}>
              <span>{market ? <>DEX Screener · Updated <time dateTime={market.observedAt}>{new Date(market.observedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time></> : "Market data appears when this pool is available."}</span>
              {market ? <a href={market.sourceUrl} target="_blank" rel="noreferrer">Open chart <ExternalLink aria-hidden="true" size={12} /><span className="sr-only"> (opens in a new tab)</span></a> : null}
            </div>
          </section>

          <aside className={styles.trade} aria-labelledby="robinhood-trade-title">
            <h2 id="robinhood-trade-title">Buy &amp; sell</h2>
            <div className={styles.tradeToken}>
              <RobinhoodCoinArtwork className={styles.tradeAvatar} imageUrl={details?.imageUrl} name={token.name} symbol={token.symbol} />
              <div><strong>{name}</strong><span>{coinTicker(token.symbol)}</span></div>
            </div>
            <p className={styles.tradeDescription}>Trading on Programmable is not available for this token yet.</p>
            {market ? <a className={styles.primaryButton} href={market.sourceUrl} target="_blank" rel="noreferrer">Open external market <ArrowUpRight aria-hidden="true" size={16} /><span className="sr-only"> (opens DEX Screener in a new tab)</span></a> : <p className={styles.tradeUnavailable}>{presentation.loading ? "Checking market availability…" : "No external market is available yet."}</p>}
            <dl className={styles.tradeFacts}>
              <Metric label="Network" value="Robinhood" />
              <Metric label="Launched" value={token.launchedAt ? new Date(token.launchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—"} />
            </dl>
          </aside>
        </div>

        {details?.description || details?.links.length ? <section className={styles.about} aria-labelledby="robinhood-about-title">
          <h2 id="robinhood-about-title">About {name}</h2>
          {details.description ? <p>{details.description}</p> : null}
          {details.links.length ? <div className={styles.links}>{details.links.map((link) => <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noreferrer">{link.label}<ArrowUpRight aria-hidden="true" size={14} /><span className="sr-only"> (opens in a new tab)</span></a>)}</div> : null}
        </section> : null}

        <details className={styles.provenance}>
          <summary>Launch details<span>Programmable stamp</span></summary>
          <dl className={styles.facts}>
            <Fact label="Token" value={token.tokenAddress} href={`${EXPLORER}/token/${token.tokenAddress}`} />
            <Fact label="Hook" value={token.hookAddress} href={`${EXPLORER}/address/${token.hookAddress}`} />
            <Fact label="Creator" value={token.creator} href={`${EXPLORER}/address/${token.creator}`} />
            <Fact label="Launch transaction" value={token.transactionHash} href={`${EXPLORER}/tx/${token.transactionHash}`} />
            <Fact label="Launch ID" value={token.launchId} />
            <Fact label="Stamp hash" value={token.stampHash} />
            <Fact label="Pool ID" value={token.poolId} />
            {token.launchedAt ? <div><dt>Launched</dt><dd><time dateTime={token.launchedAt}>{new Date(token.launchedAt).toUTCString()}</time></dd></div> : null}
          </dl>
        </details>
      </> : <section className={styles.empty}>
        <h1>Token details</h1>
        <p>{status === "ready" ? "This token is not in the verified Robinhood launch index." : "Robinhood launch details are temporarily unavailable. Try again in a moment."}</p>
        <a href={`${EXPLORER}/token/${address}`} target="_blank" rel="noreferrer">View on explorer <ArrowUpRight aria-hidden="true" size={14} /></a>
      </section>}
    </div>
  );
}

function RobinhoodChart({ poolId, name, available, loading }: { poolId: string; name: string; available: boolean; loading: boolean }) {
  const [loadedPool, setLoadedPool] = useState<string | null>(null);
  const safePool = /^0x[0-9a-f]{64}$/i.test(poolId);
  const showChart = available && safePool;
  return <div className={styles.chart}>
    {showChart ? <>
      {loadedPool !== poolId ? <div className={styles.chartState} role="status">Loading chart…</div> : null}
      <iframe
        key={poolId}
        title={`${name} price chart on DEX Screener`}
        src={`https://dexscreener.com/robinhood/${poolId}?embed=1&loadChartSettings=0&trades=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=2&chartType=usd&interval=15`}
        onLoad={() => setLoadedPool(poolId)}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
    </> : <div className={styles.chartState} role="status"><strong>{loading ? "Loading market data…" : "No chart data yet"}</strong>{loading ? null : <p>The chart will appear when market data is available for this pool.</p>}</div>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Fact({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div><dt>{label}</dt><dd>{href ? <a href={href} target="_blank" rel="noreferrer">{value}<span className="sr-only"> (opens block explorer in a new tab)</span></a> : <span>{value}</span>}</dd></div>;
}
