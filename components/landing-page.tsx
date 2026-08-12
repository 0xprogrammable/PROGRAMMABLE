import Image from "next/image";
import Link from "next/link";

import {
  DiscordBrandIcon,
  DuneBrandIcon,
  GitHubBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import styles from "@/components/landing-page.module.css";

export function LandingPage() {
  return (
    <article className={`${styles.page} landing-page-root`}>
      <div className={styles.scene}>
        <section className={styles.panel} aria-labelledby="landing-title">
          <div className={styles.panelArt} aria-hidden="true">
            <picture className={styles.panelPicture}>
              <source
                media="(max-width: 760px)"
                srcSet="/brand/atmosphere/night-sky-botanical-mobile-v2.avif"
              />
              <Image
                src="/brand/atmosphere/night-sky-botanical-desktop-v2-1920.avif"
                alt=""
                fill
                priority
                sizes="(max-width: 760px) 100vw, 82vw"
              />
            </picture>
          </div>
          <Image
            className={styles.flowerLeft}
            src="/brand/atmosphere/programmable-botanical-left-v2.webp"
            alt=""
            aria-hidden="true"
            width={1024}
            height={1536}
            sizes="(max-width: 760px) 35vw, 24vw"
          />
          <Image
            className={styles.flowerRight}
            src="/brand/atmosphere/programmable-botanical-right-v2.webp"
            alt=""
            aria-hidden="true"
            width={1024}
            height={1536}
            sizes="(max-width: 760px) 35vw, 24vw"
          />
          <div className={styles.panelTint} aria-hidden="true" />

          <header className={styles.panelHeader}>
            <Link
              className={styles.brandLink}
              href="/"
              aria-label="Programmable home"
            >
              <Image
                className={styles.brandLogo}
                src="/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"
                alt=""
                width={1168}
                height={1536}
                sizes="36px"
                priority
              />
              <span>Programmable</span>
            </Link>

            <nav
              className={styles.segmentedNav}
              aria-label="Landing navigation"
            >
              <Link className={styles.segmentedActive} href="/explore">
                Explore
              </Link>
              <Link href="/launch">Create</Link>
              <Link href="/docs">Docs</Link>
            </nav>

            <Link className={styles.headerAction} href="/launch">
              Create a token <span aria-hidden="true">↗</span>
            </Link>
          </header>

          <div className={styles.panelRule} aria-hidden="true" />

          <div className={`${styles.hero} ${styles.panelBody}`}>
            <div className={`${styles.heroCopy} ${styles.content}`}>
              <h1 id="landing-title">
                <span>Tokens with</span>
                <span>behavior</span>
                <span>in view.</span>
              </h1>
              <nav className={styles.actions} aria-label="Get started">
                <Link className={styles.primaryAction} href="/launch">
                  Create a token <span aria-hidden="true">↗</span>
                </Link>
                <Link className={styles.secondaryAction} href="/explore">
                  Explore tokens
                </Link>
              </nav>
            </div>
          </div>

          <footer className={styles.footer}>
            <nav
              className={`${styles.footerIcons} ${styles.supportingLinks}`}
              aria-label="Programmable links"
            >
              <a
                className={styles.socialLink}
                href="https://x.com/0xProgrammable"
                target="_blank"
                rel="noreferrer"
                aria-label="Programmable on X"
                aria-describedby="landing-external-link-note"
              >
                <XBrandIcon />
              </a>
              <a
                className={styles.socialLink}
                href="https://github.com/0xprogrammable"
                target="_blank"
                rel="noreferrer"
                aria-label="Programmable on GitHub"
                aria-describedby="landing-external-link-note"
              >
                <GitHubBrandIcon />
              </a>
              <a
                className={styles.socialLink}
                href="https://dexscreener.com/ethereum/0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0"
                target="_blank"
                rel="noreferrer"
                aria-label="Programmable on Dexscreener"
                aria-describedby="landing-external-link-note"
              >
                <Image
                  className={styles.socialLogo}
                  src="/brand/platforms/dexscreener-mark-warm-ivory-v1.png"
                  alt=""
                  width={256}
                  height={256}
                  sizes="28px"
                />
              </a>
              <a
                className={styles.socialLink}
                href="https://dune.com/0xprogrammable6098/programmable-analytics"
                target="_blank"
                rel="noreferrer"
                aria-label="Programmable analytics on Dune"
                aria-describedby="landing-external-link-note"
              >
                <DuneBrandIcon />
              </a>
              <a
                className={styles.socialLink}
                href="https://discord.com/invite/programmable"
                target="_blank"
                rel="noreferrer"
                aria-label="Programmable on Discord"
                aria-describedby="landing-external-link-note"
              >
                <DiscordBrandIcon />
              </a>
              <span id="landing-external-link-note" className={styles.srOnly}>
                Opens in a new tab.
              </span>
            </nav>
          </footer>
        </section>
      </div>
    </article>
  );
}
