import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  Braces,
  Coins,
  Network,
} from "lucide-react";

import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Documentation · Programmable",
  description:
    "Understand Programmable, compare its token launch types, inspect the public infrastructure, or integrate launch verification.",
  alternates: { canonical: "/docs" },
};

const sections = [
  { id: "start", label: "Choose a starting point" },
  { id: "system", label: "How it fits together" },
  { id: "boundaries", label: "Important distinctions" },
] as const;

const documentationPaths = [
  {
    description: "Learn what Programmable is and how these docs are organized.",
    href: "/docs",
    icon: BookOpenText,
    label: "Overview",
  },
  {
    description: "Compare Classic, Custom and historical Stock-Paired launches.",
    href: "/docs/tokens",
    icon: Coins,
    label: "Tokens and launches",
  },
  {
    description: "Understand launch execution, onchain identity and Router provenance.",
    href: "/docs/infrastructure",
    icon: Network,
    label: "Infrastructure",
  },
  {
    description: "Add launch verification to terminals, wallets, scanners and apps.",
    href: "/docs/developers",
    icon: Braces,
    label: "Developer integration",
  },
] as const;

const startingPoints = [
  {
    description:
      "Compare the documented launch types, their economics and their current status.",
    href: "/docs/tokens",
    label: "Understand a token or launch",
  },
  {
    description:
      "See which checks are required before a Router record establishes provenance.",
    href: "/docs/infrastructure",
    label: "Understand the infrastructure",
  },
  {
    description:
      "Add reliable Programmable labels to a terminal, wallet, scanner or indexer.",
    href: "/docs/developers",
    label: "Build an integration",
  },
] as const;

export default function DocsIndexPage() {
  return (
    <DocsShell
      currentPath="/docs"
      description="Use this documentation to understand the project, compare token launch types, inspect the public infrastructure, or build an integration. Each section states what is available and what its evidence proves."
      heroAside={
        <nav aria-label="Documentation map" className={styles.map}>
          {documentationPaths.map((path, index) => {
            const Icon = path.icon;
            return (
              <Link
                aria-current={path.href === "/docs" ? "page" : undefined}
                className={styles.mapItem}
                href={path.href}
                key={path.href}
              >
                <span className={styles.mapIndex}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
                <span className={styles.mapCopy}>
                  <strong>{path.label}</strong>
                  <small>{path.description}</small>
                </span>
                <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
              </Link>
            );
          })}
        </nav>
      }
      heroId="map"
      kicker="Overview"
      sections={sections}
      title="Programmable documentation"
    >
      <section id="start">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Start here</p>
          <h2>Choose the question you need answered</h2>
          <p>
            The documentation is organized by subject instead of by contract
            name. You can begin with the product, the infrastructure or the
            integration work and move into the technical reference when you
            need it.
          </p>
        </div>

        <div className={styles.routeList}>
          {startingPoints.map((path) => (
            <Link className={styles.routeLink} href={path.href} key={path.href}>
              <span>
                <strong>{path.label}</strong>
                <small>{path.description}</small>
              </span>
              <ArrowRight aria-hidden="true" size={18} strokeWidth={1.8} />
            </Link>
          ))}
        </div>
      </section>

      <section id="system">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>System map</p>
          <h2>What Programmable covers</h2>
          <p>
            Programmable is an Ethereum launchpad built on Uniswap v4. These
            docs cover Classic launches, individually activated Custom
            launches and historical Stock-Paired tokens. The terms below
            describe different parts of that system.
          </p>
        </div>

        <dl className={styles.definitionList}>
          <div>
            <dt>Project</dt>
            <dd>
              A project contains the creator-provided name, description,
              artwork and public links.
            </dd>
          </div>
          <div>
            <dt>Token</dt>
            <dd>The token is the ERC-20 asset created by a launch.</dd>
          </div>
          <div>
            <dt>Launch</dt>
            <dd>
              A launch is the transaction and configuration that created the
              token and its Uniswap v4 market.
            </dd>
          </div>
          <div>
            <dt>Infrastructure</dt>
            <dd>
              The infrastructure consists of the contracts and public records
              used to create, discover and verify a launch.
            </dd>
          </div>
        </dl>
      </section>

      <section id="boundaries">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Reading the data</p>
          <h2>Keep launch type, provenance and current market data separate</h2>
        </div>

        <div className={styles.boundaryList}>
          <article>
            <strong>Launch type</strong>
            <p>
              Classic, Custom and Stock-Paired describe how a token was
              launched. They do not describe its current market condition.
            </p>
          </article>
          <article>
            <strong>Provenance</strong>
            <p>
              A Router record establishes provenance only after the published
              address, runtime, binding, lookup and cross-check requirements
              pass. It is not a safety guarantee.
            </p>
          </article>
          <article>
            <strong>Current state</strong>
            <p>
              Price, liquidity and claimable rewards change over time.
              Tradability also depends on the current pool, hook and routing
              state.
            </p>
          </article>
        </div>
      </section>
    </DocsShell>
  );
}
