import Image from "next/image";
import Link from "next/link";

import {
  GitHubBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import styles from "@/components/landing-page.module.css";

export function LandingPage() {
  return (
    <article
      className={`${styles.page} landing-page-root`}
      aria-labelledby="landing-title"
    >
      <Link
        className={styles.brandLink}
        href="/"
        aria-label="Programmable home"
      >
        <Image
          className={styles.brandLogo}
          src="/brand/loop/programmable-loop-mark-header.png"
          alt=""
          width={146}
          height={192}
          sizes="44px"
          priority
        />
      </Link>
      <section className={styles.hero}>
        <div className={styles.content}>
          <h1
            id="landing-title"
            aria-label="Tokens that behave how you imagine"
          >
            <span aria-hidden="true">Tokens that behave</span>
            <span aria-hidden="true">how you imagine</span>
          </h1>
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
          <nav className={styles.supportingLinks} aria-label="Programmable links">
            <div className={styles.socialLinks}>
              <a
                className={styles.socialLink}
                href="https://x.com/0xProgrammable"
                target="_blank"
                rel="noreferrer"
                aria-label="Programmable on X"
              >
                <XBrandIcon />
              </a>
              <a
                className={styles.socialLink}
                href="https://github.com/0xprogrammable"
                target="_blank"
                rel="noreferrer"
                aria-label="Programmable on GitHub"
              >
                <GitHubBrandIcon />
              </a>
              <a
                className={styles.socialLink}
                href="https://dexscreener.com/ethereum/0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0"
                target="_blank"
                rel="noreferrer"
                aria-label="Programmable on Dexscreener"
              >
                <Image
                  className={styles.socialLogo}
                  src="/brand/platforms/dexscreener-mark-white.png"
                  alt=""
                  width={256}
                  height={256}
                  sizes="30px"
                />
              </a>
            </div>
            <Link className={styles.docsLink} href="/docs/developers">
              Docs
            </Link>
          </nav>
        </div>
      </section>
    </article>
  );
}
