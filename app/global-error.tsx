"use client";

import styles from "@/app/error-boundary.module.css";

type GlobalErrorProps = Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>;

export default function GlobalError({
  error,
  unstable_retry,
}: GlobalErrorProps) {
  return (
    <html lang="en" data-theme="dark">
      <body className={styles.globalBody}>
        <main
          className={styles.globalPage}
          aria-labelledby="global-error-title"
        >
          <div className={styles.stage}>
            <div
              className={styles.message}
              role="alert"
              aria-describedby="global-error-description"
            >
              <p className={styles.eyebrow}>Site unavailable</p>
              <h1 id="global-error-title">Programmable could not load.</h1>
              <p className={styles.description} id="global-error-description">
                Try again. If the problem continues, reload the site to start a
                new session.
              </p>
            </div>

            <p className={styles.guidance}>
              If you were reviewing a wallet action, check your wallet before
              retrying so you do not repeat an action.
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
        </main>
      </body>
    </html>
  );
}
