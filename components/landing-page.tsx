import { getImageProps } from "next/image";
import Link from "next/link";

import styles from "@/components/landing-page.module.css";

const desktopBackground = {
  src: "/brand/landing/programmable-botanical-cosmos-desktop-v1.avif",
  width: 1672,
  height: 941,
};

const mobileBackground = {
  src: "/brand/landing/programmable-botanical-cosmos-mobile-v1.avif",
  width: 941,
  height: 1672,
};

export function LandingPage() {
  const {
    props: { srcSet: desktopSrcSet, ...desktopImageProps },
  } = getImageProps({
    ...desktopBackground,
    alt: "",
    priority: true,
    sizes: "100vw",
  });
  const {
    props: { srcSet: mobileSrcSet },
  } = getImageProps({
    ...mobileBackground,
    alt: "",
    priority: true,
    sizes: "100vw",
  });

  return (
    <article
      className={`${styles.page} landing-page-root`}
      aria-labelledby="landing-title"
    >
      <picture className={styles.backdrop}>
        <source media="(max-width: 640px)" srcSet={mobileSrcSet} />
        <source media="(min-width: 641px)" srcSet={desktopSrcSet} />
        <img {...desktopImageProps} alt="" />
      </picture>
      <div className={styles.veil} aria-hidden="true" />

      <section className={styles.hero}>
        <div className={styles.content}>
          <p className={styles.proof}>Built on Uniswap v4</p>
          <h1 id="landing-title">Launch what you imagine</h1>
          <p className={styles.summary}>
            Choose a launch model and make it yours on Ethereum.
          </p>
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
