"use client";

import styles from "@/components/view-chain-unavailable.module.css";
import { useViewChain } from "@/components/view-chain";

export function isRobinhoodUnavailableRoute(pathname: string): boolean {
  return ["/profile"].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function ViewChainUnavailable() {
  const { setViewChainId } = useViewChain();

  return (
    <section
      aria-labelledby="view-chain-unavailable-title"
      className={styles.page}
    >
      <div className={styles.panel}>
        <div className={styles.chainStatus} role="status">
          <span className={styles.statusDot} aria-hidden="true" />
          Robinhood Chain
        </div>

        <h1 id="view-chain-unavailable-title">
          This view is being prepared for Robinhood.
        </h1>
        <p className={styles.description}>
          The public Robinhood deployment and index are being prepared.
          Ethereum remains live for launches, profiles and token data.
        </p>

        <button
          className={styles.action}
          onClick={() => setViewChainId(1)}
          type="button"
        >
          View on Ethereum
        </button>
        <p className={styles.walletNote}>
          Your connected wallet stays connected when you change this view.
        </p>
      </div>
    </section>
  );
}

export function ViewChainPending() {
  return (
    <div className={styles.pending} aria-busy="true">
      <span className={styles.pendingStatus} role="status">
        Loading network view
      </span>
    </div>
  );
}
