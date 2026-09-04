import Link from "next/link";

import styles from "@/components/index-reset-view.module.css";

export function TokenIndexResetView() {
  return (
    <div className={`${styles.tokenPage} page-width`}>
      <Link className={styles.backLink} href="/explore">
        <span aria-hidden="true">←</span>
        Back to Explore
      </Link>

      <section
        className={styles.tokenResetState}
        aria-labelledby="token-index-reset-title"
      >
        <span className={styles.resetLabel}>Index reset</span>
        <div className={styles.resetCopy}>
          <h1 id="token-index-reset-title">Token indexing is being rebuilt</h1>
          <p>
            Token details and market data are unavailable until the new index is
            ready.
          </p>
        </div>
      </section>
    </div>
  );
}
