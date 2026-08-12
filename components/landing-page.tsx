import Image from "next/image";
import Link from "next/link";

import {
  DiscordBrandIcon,
  DuneBrandIcon,
  GitHubBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import styles from "@/components/landing-page.module.css";

const modelCards = [
  {
    eyebrow: "Live launch model",
    title: "Classic",
    description:
      "Create a fixed supply token with permanently locked, one sided Uniswap v4 liquidity. Set fees, recipients, and the initial buy before you sign.",
    image: "/brand/create/classic-botanical-v4.webp",
    href: "/launch",
    action: "Open Classic",
  },
  {
    eyebrow: "For project creators",
    title: "Build a project",
    description:
      "Read the creator guide for the review path around custom projects and what is public in the launch today.",
    image: "/brand/create/custom-galaxy-v3.webp",
    href: "/docs/creators/launch",
    action: "Read the creator guide",
  },
  {
    eyebrow: "Explore what is public",
    title: "Token index",
    description:
      "Browse Programmable tokens, inspect their details, and follow the public record behind each one.",
    image: "/brand/programmable-token-fallback-04-mint.webp",
    href: "/explore",
    action: "Explore tokens",
  },
] as const;

export function LandingPage() {
  return (
    <article className={`${styles.page} landing-page-root`}>
      <header className={styles.topbar}>
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
        <nav className={styles.primaryNav} aria-label="Primary navigation">
          <Link href="/explore">Explore</Link>
          <Link href="/docs">Docs</Link>
          <Link className={styles.navAction} href="/launch">
            Create a token <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>

      <div>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={`${styles.heroCopy} ${styles.content}`}>
            <p className={styles.kicker}>
              <span aria-hidden="true">✳</span> Uniswap v4 launch surface
            </p>
            <h1 id="landing-title">Launch with the behavior in view.</h1>
            <p className={styles.heroLead}>
              Choose Classic, set the details that matter, and review the launch
              surface before your wallet signs.
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
              Classic is the public launch path today.
            </p>
          </div>
          <figure className={styles.heroVisual}>
            <div className={styles.visualFrame}>
              <Image
                src="/brand/create/classic-botanical-v4.webp"
                alt="Botanical artwork for the Classic launch model"
                fill
                priority
                sizes="(max-width: 760px) 100vw, 48vw"
              />
              <div className={styles.visualOverlay}>
                <span>01 / Launch model</span>
                <strong>Classic</strong>
                <span>Fixed supply · Uniswap v4 liquidity</span>
              </div>
            </div>
            <figcaption
              id="classic-preview-caption"
              className={styles.visualCaption}
            >
              Fixed supply · one-sided liquidity · permanent lock
            </figcaption>
          </figure>
        </section>

        <section className={styles.intro} aria-labelledby="intro-title">
          <p className={styles.sectionLabel}>A clear launch surface</p>
          <div className={styles.introGrid}>
            <h2 id="intro-title">A token is more than a name and ticker.</h2>
            <p>
              Classic keeps the model visible from the first input to the final
              record: fixed supply, one-sided Uniswap v4 liquidity, and a
              permanent lock.
            </p>
          </div>
        </section>

        <section
          className={styles.models}
          id="models"
          aria-labelledby="models-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionLabel}>Choose where to start</p>
              <h2 id="models-title">Launch, learn, explore.</h2>
            </div>
            <Link className={styles.textLink} href="/launch">
              Open the launch flow <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div className={styles.modelGrid}>
            {modelCards.map((model, index) => (
              <Link
                className={styles.modelCard}
                href={model.href}
                key={model.title}
              >
                <div className={styles.modelArt}>
                  <Image
                    src={model.image}
                    alt=""
                    fill
                    sizes="(max-width: 760px) 100vw, 33vw"
                    loading={index === 0 ? "eager" : "lazy"}
                  />
                  <span className={styles.modelIndex} aria-hidden="true">
                    0{index + 1}
                  </span>
                </div>
                <div className={styles.modelBody}>
                  <p className={styles.modelEyebrow}>{model.eyebrow}</p>
                  <h3>{model.title}</h3>
                  <p>{model.description}</p>
                  <span className={styles.modelAction}>
                    {model.action} <span aria-hidden="true">↗</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section
          className={styles.principles}
          aria-labelledby="principles-title"
        >
          <div className={styles.principlesMark} aria-hidden="true">
            ↻
          </div>
          <div>
            <p className={styles.sectionLabel}>Our starting point</p>
            <h2 id="principles-title">
              Clear inputs.
              <br />
              Visible behavior.
            </h2>
          </div>
          <p className={styles.principlesCopy}>
            Read the launch details, inspect public records, and keep the
            important choices close to the idea.
          </p>
        </section>

        <section className={styles.finalCta} aria-labelledby="final-title">
          <p className={styles.sectionLabel}>Ready when you are</p>
          <h2 id="final-title">Start with Classic.</h2>
          <Link className={styles.primaryAction} href="/launch">
            Read the launch details <span aria-hidden="true">↗</span>
          </Link>
        </section>
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
    </article>
  );
}
