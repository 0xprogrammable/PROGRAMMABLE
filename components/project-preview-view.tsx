import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";

import { GitHubBrandIcon, XBrandIcon } from "@/components/brand-icons";
import type { ShowcaseProject } from "@/components/project-showcase-data";
import { SiteFooter } from "@/components/site-footer";
import styles from "@/components/project-preview.module.css";

export function ProjectPreviewView({ project }: { project: ShowcaseProject }) {
  return (
    <>
      <main className={styles.page}>
        <Link className={styles.backLink} href="/#projects">
          <ArrowLeft aria-hidden="true" size={16} />
          Back to projects
        </Link>

        <article className={styles.project}>
          <div className={styles.artwork}>
            <Image
              src={project.image}
              alt={`${project.name} project artwork`}
              fill
              priority
              sizes="(max-width: 900px) 100vw, 58vw"
              unoptimized={project.slug === "studio-pass"}
            />
            <span className={styles.previewBadge}>Interface preview</span>
          </div>

          <header className={styles.identity}>
            <div className={styles.identityTopline}>
              <span>{project.category}</span>
              <span>${project.symbol}</span>
            </div>
            <h1>{project.name}</h1>
            <p>{project.summary}</p>
            <div className={styles.actions}>
              <Link className={styles.primaryAction} href="/launch">
                Launch a project
                <ArrowRight aria-hidden="true" size={16} />
              </Link>
              <a
                className={styles.iconAction}
                href="https://x.com/0xProgrammable"
                target="_blank"
                rel="noreferrer"
                aria-label="Programmable on X"
              >
                <XBrandIcon />
              </a>
              <a
                className={styles.iconAction}
                href="https://github.com/0xprogrammable"
                target="_blank"
                rel="noreferrer"
                aria-label="Programmable on GitHub"
              >
                <GitHubBrandIcon />
              </a>
            </div>
          </header>

          <dl className={styles.marketStrip}>
            <div>
              <dt>Status</dt>
              <dd>Not deployed</dd>
            </div>
            <div>
              <dt>Market cap</dt>
              <dd>—</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>Ethereum</dd>
            </div>
            <div>
              <dt>Liquidity</dt>
              <dd>Uniswap v4</dd>
            </div>
          </dl>

          <section className={styles.story}>
            <div>
              <span className={styles.sectionLabel}>Project statement</span>
              <h2>The idea and the market belong together.</h2>
            </div>
            <p>{project.story}</p>
          </section>

          <section className={styles.system}>
            <div className={styles.systemHeading}>
              <span className={styles.sectionLabel}>Hook profile</span>
              <h2>{project.model}</h2>
              <p>
                The profile should expose the rules that make the project
                distinct before asking anyone to trade it.
              </p>
            </div>
            <div className={styles.behaviors}>
              {project.hookBehaviors.map((behavior, index) => (
                <div key={behavior}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{behavior}</strong>
                </div>
              ))}
            </div>
          </section>

          <aside className={styles.notice}>
            <div>
              <strong>Illustrative project profile</strong>
              <p>
                This page demonstrates the intended Programmable project
                experience. It does not represent a deployed token, market, or
                investment opportunity.
              </p>
            </div>
            <a
              href="https://docs.uniswap.org/contracts/v4/overview"
              target="_blank"
              rel="noreferrer"
            >
              Read the Uniswap v4 overview
              <ExternalLink aria-hidden="true" size={15} />
            </a>
          </aside>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
