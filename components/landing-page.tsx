import Link from "next/link";

import styles from "@/components/landing-page.module.css";

export function LandingPage() {
  return (
    <article
      className={`${styles.page} landing-page-root`}
      aria-labelledby="landing-title"
    >
      <section className={styles.hero}>
        <div className={styles.content}>
          <h1 id="landing-title">Launch what you imagine</h1>
          <div className={styles.actions} aria-label="Get started">
            <Link
              className={`${styles.primaryAction} liquid-glass-control liquid-glass-distortion`}
              href="/launch"
            >
              Create a Token
            </Link>
            <Link
              className={`${styles.secondaryAction} liquid-glass-control liquid-glass-distortion`}
              href="/explore"
            >
              Explore Tokens
            </Link>
          </div>
        </div>
      </section>
    </article>
  );
}
