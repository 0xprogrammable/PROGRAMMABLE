import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import { PROGRAMMABLE_PUBLIC_REPOSITORIES } from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Documentation · Programmable",
  description:
    "Understand Programmable, launch a project, publish a template or integrate verified launch data.",
  alternates: { canonical: "/docs" },
};

const sections = [
  { id: "start", label: "Choose a path" },
  { id: "vision", label: "What Programmable is" },
  { id: "system", label: "How the system fits together" },
  { id: "launch-types", label: "Launch models" },
  { id: "identity", label: "Public identity" },
  { id: "reference", label: "Reference" },
] as const;

const paths = [
  {
    description:
      "Compare launch models, fees, protocol revenue and public trust boundaries.",
    href: "/docs/tokens",
    label: "Understand Programmable",
    meta: "Product",
  },
  {
    description:
      "Build a project, follow the review path and understand how creators earn.",
    href: "/docs/creators",
    label: "Create with Programmable",
    meta: "Creators",
  },
  {
    description:
      "Verify Router-stamped launches or index them in a terminal, wallet or app.",
    href: "/docs/developers",
    label: "Integrate Programmable",
    meta: "Developers",
  },
] as const;

const launchTypes = [
  {
    description:
      "A fixed-supply token with an ETH market, creator-selected swap fees and creator rewards.",
    href: "/docs/models/classic",
    label: "Classic",
  },
  {
    description:
      "A token market whose behavior is defined by Uniswap v4 hook logic for that release.",
    href: "/docs/models/custom",
    label: "Custom hooks",
  },
  {
    description:
      "Create and trade onchain outcome markets through a separately versioned Uniswap v4 release.",
    href: "/docs/models/prediction-markets",
    label: "Prediction Markets",
  },
  {
    description:
      "Existing records use supported Ondo Global Markets quote assets; see the reference for its market and integration details.",
    href: "/docs/models/stock-paired",
    label: "Stock-Paired",
  },
] as const;

export default function DocsIndexPage() {
  return (
    <DocsShell
      currentPath="/docs"
      description="Programmable is infrastructure for creating, launching and discovering token markets built with Uniswap v4."
      sections={sections}
      title="Programmable"
    >
      <section id="start">
        <h2>Choose a path</h2>
        <p>
          Start with what you want to do. The product, creator and developer
          guides share the same launch models and public records.
        </p>

        <div className={styles.pathGrid}>
          {paths.map((path) => (
            <Link className={styles.pathCard} href={path.href} key={path.href}>
              <span>{path.meta}</span>
              <strong>{path.label}</strong>
              <small>{path.description}</small>
            </Link>
          ))}
        </div>
      </section>

      <section id="vision">
        <h2>What Programmable is</h2>
        <p>
          Programmable is the public infrastructure for building, launching and
          discovering Uniswap v4 markets. The long-term goal is a clear,
          verifiable home for hook builders, creators, integrators and the
          communities that use their markets.
        </p>
        <div className={styles.topicList}>
          <div>
            <h3>Creators</h3>
            <p>
              Build a concrete project or publish reusable hook logic, then
              understand the review, attribution and fee path before launch.
            </p>
          </div>
          <div>
            <h3>Builders</h3>
            <p>
              Use Hook Builder as the skill and tooling layer. It produces the
              reproducible project that belongs in Submit a Launch or Submit a
              Template.
            </p>
          </div>
          <div>
            <h3>Integrators</h3>
            <p>
              Read the Router record, token identity and market data through the
              developer references instead of relying on names or tickers.
            </p>
          </div>
        </div>
      </section>

      <section id="system">
        <h2>How the system fits together</h2>
        <p>
          Programmable separates creation, review, execution and verification.
          Each step has its own evidence and its own result.
        </p>

        <div className={docsStyles.flow}>
          <div className={docsStyles.flowItem}>
            <span>01</span>
            <strong>Build the hook and project</strong>
          </div>
          <div className={docsStyles.flowItem}>
            <span>02</span>
            <strong>Review one exact source revision</strong>
          </div>
          <div className={docsStyles.flowItem}>
            <span>03</span>
            <strong>Launch from the approved path</strong>
          </div>
          <div className={docsStyles.flowItem}>
            <span>04</span>
            <strong>Verify and index the onchain result</strong>
          </div>
        </div>

        <p>
          A review result applies only to the revision it names. A launch still
          requires the matching execution path and a wallet transaction. Public
          applications can then verify the resulting onchain record.
        </p>
      </section>

      <section id="launch-types">
        <h2>Launch models</h2>
        <p>
          Each launch model defines a different market, fee path and set of
          controls. Do not infer one model from another.
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

      <section id="identity">
        <h2>Public identity</h2>
        <p>
          Names, symbols and images are not unique identifiers. A token starts
          with its chain and contract address. A Uniswap v4 market starts with
          its PoolManager and poolId.
        </p>
        <p>
          Launches executed and stamped through the Launch Stamp Router have a
          public provenance record. That record can identify a Programmable
          Classic or Programmable Custom launch. It does not promise safety,
          liquidity, price or support in another application.
        </p>
        <p>
          Prediction Markets has its own versioned protocol release. Use the
          canonical Prediction Markets repository for current networks, market
          types, economics, resolution rules and contract identity.
        </p>
      </section>

      <section id="reference">
        <h2>Reference</h2>
        <ul className={styles.linkList}>
          <li>
            <Link href="/docs/economics">
              <span>
                <strong>Fees and protocol revenue</strong>
                <small>
                  See the fee basis, creator share and Programmable share for
                  each path.
                </small>
              </span>
              <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </Link>
          </li>
          <li>
            <Link href="/docs/trust">
              <span>
                <strong>Trust and verification</strong>
                <small>
                  Understand what review, activation and Router provenance
                  establish.
                </small>
              </span>
              <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </Link>
          </li>
          <li>
            <Link href="/docs/creators">
              <span>
                <strong>Creator paths</strong>
                <small>
                  Choose Hook Builder, Submit a Launch or Submit a Template.
                </small>
              </span>
              <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </Link>
          </li>
          <li>
            <a
              href={PROGRAMMABLE_PUBLIC_REPOSITORIES.submitLaunch}
              rel="noreferrer"
              target="_blank"
            >
              <span>
                <strong>Submit a Launch</strong>
                <small>
                  Submit one concrete project, token and hook revision.
                </small>
              </span>
              <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
              <span className="sr-only">Opens GitHub in a new tab</span>
            </a>
          </li>
          <li>
            <a
              href={PROGRAMMABLE_PUBLIC_REPOSITORIES.submitTemplate}
              rel="noreferrer"
              target="_blank"
            >
              <span>
                <strong>Submit a Template</strong>
                <small>
                  Read the requirements; submit only when the repository accepts
                  applications.
                </small>
              </span>
              <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
              <span className="sr-only">Opens GitHub in a new tab</span>
            </a>
          </li>
        </ul>
      </section>
    </DocsShell>
  );
}
