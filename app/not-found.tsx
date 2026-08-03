import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";

import { SiteFooter } from "@/components/site-footer";
import styles from "@/app/not-found.module.css";

export default function NotFound() {
  return (
    <>
      <div className={`${styles.page} page-width`}>
        <section className={styles.stage} aria-labelledby="not-found-title">
          <div className={styles.copy}>
            <h1 id="not-found-title">This page isn’t available.</h1>
            <p className={styles.description}>
              The link may have moved. Explore current tokens or return to the
              documentation.
            </p>
            <div className={styles.actions}>
              <Link className={styles.primaryAction} href="/">
                <ArrowLeft aria-hidden="true" size={17} />
                Explore tokens
              </Link>
              <Link className={styles.secondaryAction} href="/docs">
                <BookOpen aria-hidden="true" size={17} />
                Open docs
              </Link>
            </div>
          </div>

          <div className={styles.art} aria-hidden="true">
            <Image
              src="/brand/projects/open-atlas-v1.webp"
              alt=""
              fill
              priority
              sizes="(max-width: 760px) calc(100vw - 28px), 560px"
            />
            <span>404</span>
          </div>
        </section>
      </div>
      <SiteFooter />
    </>
  );
}
