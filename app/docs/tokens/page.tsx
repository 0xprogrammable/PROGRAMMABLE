import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Tokens and launches · Programmable",
  description:
    "Compare Programmable Classic, Custom and historical Stock-Paired launches, including the availability rules and boundaries for each.",
  alternates: { canonical: "/docs/tokens" },
};

const sections = [
  { id: "models", label: "Launch types" },
  { id: "shared", label: "What they share" },
  { id: "labels", label: "How they are labeled" },
] as const;

const launchTypes = [
  {
    description:
      "Classic creates a fixed-supply token with an ETH market, configurable directional fees, creator rewards and permanently locked one-sided liquidity.",
    href: "/docs/models/classic",
    label: "Classic",
    status: "Availability shown in Create",
    tone: "available",
  },
  {
    description:
      "A Custom launch creates a token whose Uniswap v4 market uses release-specific hook logic. Individually activated Custom launches can be discovered and their Router provenance verified. General public submission and self-service Custom launching are not available.",
    href: "/docs/models/custom",
    label: "Custom",
    status: "Public submissions unavailable",
    tone: "limited",
  },
  {
    description:
      "Stock-Paired describes existing tokens paired with configured Ondo Global Markets quote assets. New Stock-Paired launches are closed.",
    href: "/docs/models/stock-paired",
    label: "Stock-Paired",
    status: "Historical",
    tone: "historical",
  },
] as const;

export default function TokensDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/tokens"
      description="Programmable supports more than one launch type. This page explains what each type means, where to check whether a launch is available and which facts are shared across them."
      kicker="Tokens and launches"
      sections={sections}
      title="Token launch types"
    >
      <section id="models">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Launch model reference</p>
          <h2>Choose the launch type</h2>
          <p>
            Each guide covers the token structure, fee behavior, liquidity
            path and current product status for that launch type.
          </p>
        </div>

        <div className={styles.modelList}>
          {launchTypes.map((model, index) => (
            <Link className={styles.modelRow} href={model.href} key={model.href}>
              <span className={styles.modelIndex}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className={styles.modelCopy}>
                <span className={styles.modelHeading}>
                  <strong>{model.label}</strong>
                  <small data-tone={model.tone}>{model.status}</small>
                </span>
                <span className={styles.modelDescription}>
                  {model.description}
                </span>
              </span>
              <ArrowRight aria-hidden="true" size={18} strokeWidth={1.8} />
            </Link>
          ))}
        </div>
      </section>

      <section id="shared">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Shared foundation</p>
          <h2>What the launch types have in common</h2>
          <p>
            Every documented launch creates an ERC-20 token and a Uniswap v4
            market. The hook, fee path, quote asset, reward flow and available
            actions can differ. Those differences are described in the
            individual model guides.
          </p>
        </div>

        <div className={styles.boundaryList}>
          <article>
            <strong>Token identity</strong>
            <p>
              Use the chain and token address. A name, symbol or image is not a
              unique identifier.
            </p>
          </article>
          <article>
            <strong>Market identity</strong>
            <p>
              A Uniswap v4 market is identified by PoolManager and poolId. The
              hook address alone is not always unique to one launch.
            </p>
          </article>
          <article>
            <strong>Live values</strong>
            <p>
              Price, liquidity, volume and rewards change after launch and must
              be read from current data sources.
            </p>
          </article>
        </div>
      </section>

      <section id="labels">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Public labels</p>
          <h2>Use the broad label or the exact launch type</h2>
          <p>
            After the Router checks pass, use Programmable as the broad
            provenance label. Use Programmable Classic or Programmable Custom
            when the recorded launch kind matters. CustomGraph is the Router
            enum name for kind 1, not a public product label.
          </p>
        </div>
        <div className={styles.inlineAction}>
          <Link href="/docs/infrastructure">
            Read how launch identity is verified
            <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
          </Link>
        </div>
      </section>
    </DocsShell>
  );
}
