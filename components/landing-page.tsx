import Image from "next/image";
import Link from "next/link";

import { ExploreView } from "@/components/explore-view";
import styles from "@/components/landing-page.module.css";

const loopMark = "/brand/loop/programmable-loop-mark-header-white-v1-1536.png";

export function LandingPage() {
  return (
    <article className={`${styles.page} landing-page-root`}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroArtwork} aria-hidden="true">
          <Image
            className={styles.heroGarden}
            src="/brand/atmosphere/programmable-floral-foreground-v1.avif"
            alt=""
            fill
            priority
            sizes="100vw"
          />
        </div>

        <div className={styles.heroContent}>
          <Image
            className={styles.heroLogo}
            src={loopMark}
            alt=""
            width={1168}
            height={1536}
            sizes="80px"
            priority
          />
          <h1 id="landing-title">Programmable</h1>
          <p>Shape what assets can do</p>
        </div>

        <a className={styles.scrollCue} href="#what-is-programmable">
          <span>Scroll to discover Programmable</span>
          <span aria-hidden="true">↓</span>
        </a>
      </section>

      <section
        className={styles.definition}
        id="what-is-programmable"
        aria-labelledby="programmable-definition-title"
      >
        <header className={styles.definitionHeader}>
          <h2
            id="programmable-definition-title"
            aria-label="What is Programmable?"
          >
            <span>What is</span>
            <Image
              className={styles.definitionLogo}
              src={loopMark}
              alt=""
              width={1168}
              height={1536}
              sizes="96px"
              aria-hidden="true"
            />
            <span aria-hidden="true">?</span>
          </h2>
          <Link className={styles.docsLink} href="/docs">
            Read more in our docs
          </Link>
        </header>

        <div className={styles.definitionColumns}>
          <p className={styles.definitionLead}>
            Programmable brings products built with Uniswap v4 hooks into one
            place, together with tools to create your own.
          </p>
          <p>
            Explore what each project does, how its hook changes the way its
            pool works, and the public information behind it. Our goal is
            simple: if you can describe an idea, you should be able to turn it
            into a Hook without writing Solidity.
          </p>
        </div>
      </section>

      <section
        className={styles.definition}
        id="what-is-a-hook"
        aria-labelledby="hook-definition-title"
      >
        <header className={styles.definitionHeader}>
          <h2 id="hook-definition-title">What is a Hook?</h2>
        </header>

        <div className={styles.definitionColumns}>
          <p className={styles.definitionLead}>
            A{" "}
            <a
              className={styles.inlineLink}
              href="https://docs.uniswap.org/contracts/v4/overview"
              target="_blank"
              rel="noreferrer"
            >
              Uniswap v4
            </a>{" "}
            pool is a market where two assets can be traded. A Hook is a smart
            contract connected to that pool. It adds rules for how that market
            works.
          </p>
          <div className={styles.definitionDetail}>
            <p>
              Those rules can run at specific moments, such as before or after
              a trade or when liquidity changes.
            </p>
            <p>
              They can adjust a fee, reward an action, or shape what happens
              when people use the pool.
            </p>
          </div>
        </div>
      </section>

      <div className={styles.exploreChapter}>
        <ExploreView />
      </div>
    </article>
  );
}
