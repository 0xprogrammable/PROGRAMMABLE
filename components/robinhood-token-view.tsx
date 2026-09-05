import Link from "next/link";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import styles from "./robinhood-token-view.module.css";

const EXPLORER = "https://robinhoodchain.blockscout.com";

export function RobinhoodTokenView({ address, token, status }: {
  address: string;
  token: RobinhoodLaunch | null;
  status: "ready" | "syncing" | "stale" | "unavailable";
}) {
  return (
    <div className={`${styles.page} page-width`}>
      <Link className={styles.back} href="/explore?chain=4663">← Back to Explore</Link>
      <section className={styles.content} aria-labelledby="robinhood-token-title">
        <p className={styles.network}>Robinhood Chain</p>
        <h1 id="robinhood-token-title">{token?.name || (token ? `${address.slice(0, 8)}…${address.slice(-6)}` : "Token details")}</h1>
        {token?.symbol ? <p className={styles.symbol}>{token.symbol}</p> : null}
        {token ? <>
          <p className={styles.stamp}>Programmable Custom</p>
          <p className={styles.description}>Launched through Programmable. The launch is recorded in the Programmable Stamp Router.</p>
          {status === "stale" ? <p className={styles.notice} role="status">Showing saved launch details. Updates are temporarily unavailable.</p> : null}
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
          <p className={styles.note}>The stamp identifies the launch origin. It is not a security audit of the token or hook.</p>
        </> : <>
          <p className={styles.description}>{status === "ready" ? "This token is not in the verified Robinhood launch index." : "Robinhood launch details are temporarily unavailable. Try again in a moment."}</p>
          <dl className={styles.facts}><Fact label="Requested token" value={address} href={`${EXPLORER}/token/${address}`} /></dl>
        </>}
      </section>
    </div>
  );
}

function Fact({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div><dt>{label}</dt><dd>{href ? <a href={href} target="_blank" rel="noreferrer">{value}<span className="sr-only"> (opens block explorer in a new tab)</span></a> : <span>{value}</span>}</dd></div>;
}
