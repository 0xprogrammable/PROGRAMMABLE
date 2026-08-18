"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";

import { ExploreView } from "@/components/explore-view";
import styles from "@/components/landing-page.module.css";

const loopMark = "/brand/loop/programmable-loop-mark-header-white-v1-1536.png";
const HERO_TWINKLE_COUNT = 164;

type HeroStarStyle = CSSProperties & {
  "--hero-star-delay": string;
  "--hero-star-duration": string;
  "--hero-star-size": string;
};

function heroStarStyle(index: number): HeroStarStyle {
  const horizontal = (index * 47.13 + 19.7) % 96;
  const vertical = (index * 29.71 + 7.3) % 62;
  const duration = 4.4 + ((index * 17) % 41) / 10;
  const delay = -((index * 23) % 97) / 10;
  const sizeStep = ((index * 7) % 11) / 20;
  const emphasis = index % 29 === 0 ? 0.5 : index % 13 === 0 ? 0.26 : 0;
  const size = 0.64 + sizeStep + emphasis;

  return {
    left: `${horizontal + 2}%`,
    top: `${vertical + 1}%`,
    "--hero-star-delay": `${delay}s`,
    "--hero-star-duration": `${duration}s`,
    "--hero-star-size": `${size}px`,
  };
}

export function LandingPage() {
  const pageRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const alignLandingHash = () => {
      if (window.location.hash === "") {
        window.scrollTo({ behavior: "auto", left: 0, top: 0 });
        return;
      }

      if (window.location.hash !== "#explore") return;

      const chapter = document.getElementById("explore");
      const header = document.querySelector<HTMLElement>(".header-inner");
      const target = chapter?.querySelector<HTMLElement>("h1") ?? chapter;
      if (!target) return;

      const headerHeight = header?.getBoundingClientRect().height ?? 0;
      const breathingRoom = window.innerWidth <= 960 ? 16 : 24;
      const top =
        window.scrollY +
        target.getBoundingClientRect().top -
        headerHeight -
        breathingRoom;

      window.scrollTo({ behavior: "auto", left: 0, top });
    };

    alignLandingHash();
    window.addEventListener("hashchange", alignLandingHash);
    return () => window.removeEventListener("hashchange", alignLandingHash);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const sections = Array.from(
      page.querySelectorAll<HTMLElement>("[data-reveal-section]"),
    );

    page.dataset.revealReady = "true";

    if (!("IntersectionObserver" in window)) {
      sections.forEach((section) => {
        section.dataset.visible = "true";
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const section = entry.target as HTMLElement;
          section.dataset.visible = "true";
          observer.unobserve(section);
        });
      },
      {
        rootMargin: "0px 0px 48% 0px",
        threshold: 0.12,
      },
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  return (
    <article ref={pageRef} className={`${styles.page} landing-page-root`}>
      <section
        className={styles.hero}
        id="intro"
        aria-labelledby="landing-title"
      >
        <div className={styles.heroArtwork} aria-hidden="true">
          <picture className={styles.heroGardenFrame}>
            <source
              media="(max-width: 42.5rem)"
              srcSet="/brand/atmosphere/programmable-floral-foreground-mobile-v1.avif"
              type="image/avif"
            />
            <source
              media="(max-width: 60rem)"
              srcSet="/brand/atmosphere/programmable-floral-foreground-tablet-v1.avif"
              type="image/avif"
            />
            <Image
              className={styles.heroGarden}
              src="/brand/atmosphere/programmable-floral-foreground-v1.avif"
              alt=""
              fill
              fetchPriority="high"
              loading="eager"
              sizes="100vw"
              unoptimized
            />
          </picture>
          <span className={styles.heroTwinkles}>
            {Array.from({ length: HERO_TWINKLE_COUNT }, (_, index) => (
              <i key={index} style={heroStarStyle(index)} />
            ))}
          </span>
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
        className={`${styles.definition} ${styles.revealSection}`}
        id="what-is-programmable"
        aria-labelledby="programmable-definition-title"
        data-reveal-section
      >
        <header className={styles.definitionHeader}>
          <h2
            id="programmable-definition-title"
            aria-label="What is Programmable?"
          >
            <span>What is</span>
            <span className={styles.definitionLogoFrame} aria-hidden="true">
              <Image
                className={styles.definitionLogo}
                src={loopMark}
                alt=""
                width={1168}
                height={1536}
                sizes="96px"
              />
            </span>
            <span className={styles.definitionQuestion} aria-hidden="true">
              ?
            </span>
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
        className={`${styles.definition} ${styles.revealSection}`}
        id="what-is-a-hook"
        aria-labelledby="hook-definition-title"
        data-reveal-section
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
              Those rules can run at specific moments, such as before or after a
              trade or when liquidity changes.
            </p>
            <p>
              They can adjust a fee, reward an action, or shape what happens
              when people use the pool.
            </p>
          </div>
        </div>
      </section>

      <div
        className={`${styles.exploreChapter} ${styles.revealSection}`}
        id="explore"
        data-reveal-section
      >
        <ExploreView />
      </div>
    </article>
  );
}
