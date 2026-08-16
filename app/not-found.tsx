import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";

import styles from "@/app/not-found.module.css";

export default function NotFound() {
  return (
    <div className={`${styles.page} page-width`}>
      <section className={styles.stage} aria-labelledby="not-found-title">
        <div className={styles.copy}>
          <h1 id="not-found-title">This page isn’t available.</h1>
          <p className={styles.description}>
            The link may have moved. Explore current tokens or return to the
            documentation.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href="/explore">
              Explore tokens
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <Link className={styles.secondaryAction} href="/docs">
              <BookOpen aria-hidden="true" size={17} />
              Open docs
            </Link>
          </div>
        </div>

        <p className={styles.code} aria-hidden="true">
          404
        </p>
      </section>
    </div>
  );
}
