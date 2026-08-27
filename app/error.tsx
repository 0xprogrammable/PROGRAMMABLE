"use client";

import styles from "@/app/error-boundary.module.css";

type ErrorPageProps = Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>;

export default function ErrorPage({ error, unstable_retry }: ErrorPageProps) {
  return (
    <section
      className={`${styles.page} page-width`}
      aria-labelledby="page-error-title"
    >
      <div className={styles.stage}>
        <div
          className={styles.message}
          role="alert"
          aria-describedby="page-error-description"
        >
          <p className={styles.eyebrow}>Page unavailable</p>
          <h1 id="page-error-title">Unable to display this page.</h1>
          <p className={styles.description} id="page-error-description">
            Try loading this view again. If it still does not load, reload the
            site.
          </p>
        </div>

        <p className={styles.guidance}>
          Before repeating a launch or transaction, check your wallet and
          launch history.
        </p>

        <div className={styles.actions}>
          <button
            className={styles.primaryAction}
            type="button"
            onClick={unstable_retry}
          >
            Try again
          </button>
          <button
            className={styles.secondaryAction}
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload site
          </button>
        </div>

        {error.digest ? (
          <p className={styles.reference}>
            Error reference <code>{error.digest}</code>
          </p>
        ) : null}
      </div>
    </section>
  );
}
