import Image from "next/image";
import Link from "next/link";

import {
  DiscordBrandIcon,
  DuneBrandIcon,
  GitHubBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import styles from "@/components/landing-page.module.css";

const launchSignals = [
  {
    index: "01",
    title: "Classic",
    detail: "Fixed supply",
    href: "/launch",
  },
  {
    index: "02",
    title: "Uniswap v4",
    detail: "One sided liquidity",
    href: "/docs/creators/launch",
  },
  {
    index: "03",
    title: "Public record",
    detail: "Review before signing",
    href: "/explore",
  },
] as const;

export function LandingPage() {
  return (
    <article className={`${styles.page} landing-page-root`}>
      <div className={styles.scene}>
        <section className={styles.panel} aria-labelledby="landing-title">
          <div className={styles.panelArt} aria-hidden="true">
            <Image
              src="/brand/programmable-floral-night-background-2172.webp"
              alt=""
              fill
              priority
              sizes="(max-width: 760px) 100vw, 92vw"
            />
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
              <p className={styles.kicker}>
                <span aria-hidden="true">✳</span> Uniswap v4 launch surface
              </p>
              <h1 id="landing-title">
                <span>Tokens with</span>
                <span>behavior</span>
                <span>in view.</span>
              </h1>
              <p className={styles.heroLead}>
                Choose a model, set the details that matter, and review the
                launch surface before your wallet signs.
              </p>
              <nav className={styles.actions} aria-label="Get started">
                <Link className={styles.primaryAction} href="/launch">
                  Create a token <span aria-hidden="true">↗</span>
                </Link>
                <Link className={styles.secondaryAction} href="/explore">
                  Explore tokens
                </Link>
              </nav>
              <p className={styles.heroNote}>
                <span aria-hidden="true">↳</span> Classic is the public launch
                path today.
              </p>
            </div>

            <aside className={styles.heroAside} aria-labelledby="aside-title">
              <p className={styles.asideLabel} id="aside-title">
                Make the important choices visible.
              </p>
              <p className={styles.asideCopy}>
                Fixed supply, one sided Uniswap v4 liquidity, and a permanent
                lock from the first review.
              </p>
              <dl className={styles.signalList}>
                {launchSignals.map((signal) => (
                  <div className={styles.signal} key={signal.index}>
                    <dt>{signal.index}</dt>
                    <dd>
                      <Link href={signal.href}>
                        <strong>{signal.title}</strong>
                        <span>{signal.detail}</span>
                      </Link>
                    </dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>

          <div className={styles.panelBottom}>
            <p className={styles.bottomNote}>
              Programmable <span aria-hidden="true">/</span> Night Garden
            </p>
            <div className={styles.quickLinks}>
              <Link className={styles.quickCard} href="/launch">
                <span>Start here</span>
                <strong>Create a token</strong>
                <span aria-hidden="true">↗</span>
              </Link>
              <Link className={styles.quickCard} href="/explore">
                <span>Public index</span>
                <strong>Explore tokens</strong>
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>

          <footer className={styles.footer}>
            <Link
              className={styles.footerBrand}
              href="/"
              aria-label="Programmable home"
            >
              Programmable<span aria-hidden="true">©</span>
            </Link>
            <nav className={styles.footerLinks} aria-label="Footer navigation">
              <Link className={styles.docsLink} href="/docs">
                Docs
              </Link>
              <Link href="/explore">Explore</Link>
            </nav>
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
