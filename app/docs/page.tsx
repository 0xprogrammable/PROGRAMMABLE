import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Documentation · Programmable",
  description:
    "Understand Programmable, launch a project, publish a template or integrate verified launch data.",
  alternates: { canonical: "/docs" },
};

const sections = [
  { id: "start", label: "Choose a path" },
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
      "A historical model paired with supported Ondo Global Markets quote assets. New launches are closed.",
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
            <Link href="/docs/status">
              <span>
                <strong>Product status</strong>
                <small>
                  Keep lifecycle, access and service health separate.
                </small>
              </span>
              <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </Link>
          </li>
        </ul>
      </section>
    </DocsShell>
  );
}
