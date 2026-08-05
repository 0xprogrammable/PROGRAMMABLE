import Link from "next/link";

import { LandingBackdrop } from "@/components/landing-backdrop";
import styles from "@/components/landing-page.module.css";

const desktopBackground =
  "/brand/landing/programmable-botanical-cosmos-desktop-v2.avif";
const desktopBackgroundStandard =
  "/brand/landing/programmable-botanical-cosmos-desktop-v2-1920.avif";
const mobileBackground =
  "/brand/landing/programmable-botanical-cosmos-mobile-v2.avif";
const mobileBackgroundStandard =
  "/brand/landing/programmable-botanical-cosmos-mobile-v2-1080.avif";

export function LandingPage() {
  return (
    <article
      className={`${styles.page} landing-page-root`}
      aria-labelledby="landing-title"
    >
      <picture className={styles.backdrop}>
        <source
          media="(max-width: 640px)"
          srcSet={`${mobileBackgroundStandard} 1080w, ${mobileBackground} 2160w`}
          sizes="100vw"
        />
        <source
          media="(min-width: 641px)"
          srcSet={`${desktopBackgroundStandard} 1920w, ${desktopBackground} 3840w`}
          sizes="100vw"
        />
        <img
          src={desktopBackgroundStandard}
          srcSet={`${desktopBackgroundStandard} 1920w, ${desktopBackground} 3840w`}
          sizes="100vw"
          width={3840}
          height={2160}
          fetchPriority="high"
          decoding="async"
          alt=""
        />
      </picture>
      <LandingBackdrop />
      <div className={styles.veil} aria-hidden="true" />

      <section className={styles.hero}>
        <div className={styles.content}>
          <h1 id="landing-title">Launch what you imagine</h1>
          <div className={styles.actions} aria-label="Get started">
            <Link className={styles.primaryAction} href="/launch">
              Create a token
              <span aria-hidden="true">↗</span>
            </Link>
            <Link className={styles.secondaryAction} href="/explore">
              Explore launches
            </Link>
          </div>
        </div>
      </section>
    </article>
  );
}
