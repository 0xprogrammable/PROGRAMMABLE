import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Documentation · Programmable",
  description:
    "Learn how Programmable launches work, how launch types differ, and how applications can verify Router-stamped launches.",
  alternates: { canonical: "/docs" },
};

const sections = [
  { id: "launch-types", label: "Launch types" },
  { id: "identification", label: "How launches are identified" },
  { id: "terms", label: "Terms" },
  { id: "next", label: "Where to go next" },
] as const;

const launchTypes = [
  {
    description:
      "A fixed-supply token with an ETH market, configurable buy and sell fees, creator rewards and permanently locked one-sided liquidity.",
    href: "/docs/models/classic",
    label: "Classic",
  },
  {
    description:
      "A launch whose Uniswap v4 market uses release-specific hook logic. Approved applicants can launch an approved release through the gated flow. General public submissions and open public wallet self-service are unavailable.",
    href: "/docs/models/custom",
    label: "Custom hooks",
  },
  {
    description:
      "Historical launches paired with configured Ondo Global Markets quote assets. New Stock-Paired launches are closed.",
    href: "/docs/models/stock-paired",
    label: "Stock-Paired",
  },
] as const;

const nextSteps = [
  {
    description:
      "Compare launch rules, availability and the current boundaries of each model.",
    href: "/docs/tokens",
    label: "Tokens and launches",
  },
  {
    description:
      "See how launch execution, Uniswap v4 markets and Router provenance relate.",
    href: "/docs/infrastructure",
    label: "How Programmable works",
  },
  {
    description:
      "Verify Router-stamped launches in a terminal, wallet, scanner or indexer.",
    href: "/docs/developers",
    label: "Developer integration",
  },
] as const;

export default function DocsIndexPage() {
  return (
    <DocsShell
      currentPath="/docs"
      description="Programmable is an Ethereum launchpad for tokens and markets built on Uniswap v4."
      sections={sections}
      title="Programmable"
    >
      <section id="launch-types">
        <h2>Launch types</h2>
        <p>
          Programmable documents three launch types. Each type has its own
          market configuration, fee behavior and current availability.
        </p>

        <ul className={styles.linkList}>
          {launchTypes.map((launchType) => (
            <li key={launchType.href}>
              <Link href={launchType.href}>
                <span>
                  <strong>{launchType.label}</strong>
                  <small>{launchType.description}</small>
                </span>
                <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="identification">
        <h2>How launches are identified</h2>
        <p>
          Names, symbols and images are not unique identifiers. Start with the
          chain and token address. A Uniswap v4 market is identified by its
          PoolManager and poolId.
        </p>
        <p>
          Only launches executed and stamped through the Launch Stamp Router
          have a public Router provenance record. Applications can verify that
          record before showing a Programmable label. The published start block
          is the first block to scan for this Router. It does not cover earlier
          launches, and direct factory calls remain outside the Router path even
          when they occur later.
        </p>
      </section>

      <section id="terms">
        <h2>Terms used in these docs</h2>
        <dl className={styles.definitionList}>
          <div>
            <dt>Project</dt>
            <dd>
              Creator-provided information such as the name, description,
              artwork and public links.
            </dd>
          </div>
          <div>
            <dt>Token</dt>
            <dd>The ERC-20 asset created by a launch.</dd>
          </div>
          <div>
            <dt>Launch</dt>
            <dd>
              The transaction and configuration that create the token and its
              Uniswap v4 market.
            </dd>
          </div>
          <div>
            <dt>Provenance</dt>
            <dd>
              Evidence that a launch was executed through the recorded Router
              path. Provenance is not a safety or market guarantee.
            </dd>
          </div>
        </dl>
      </section>

      <section id="next">
        <h2>Where to go next</h2>
        <ul className={styles.linkList}>
          {nextSteps.map((step) => (
            <li key={step.href}>
              <Link href={step.href}>
                <span>
                  <strong>{step.label}</strong>
                  <small>{step.description}</small>
                </span>
                <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </DocsShell>
  );
}
