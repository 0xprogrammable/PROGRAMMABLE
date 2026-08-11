import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Tokens and launches · Programmable",
  description:
    "Compare Programmable Classic, Custom and Stock-Paired launches by market, fee path and identity.",
  alternates: { canonical: "/docs/tokens" },
};

const sections = [
  { id: "launch-types", label: "Compare launch types" },
  { id: "identity", label: "Shared identity" },
  { id: "labels", label: "Public labels" },
  { id: "next", label: "Next steps" },
] as const;

const launchTypes = [
  {
    feePath:
      "Selected buy and sell fees include 10 bps to Programmable; the remainder is creator rewards.",
    href: "/docs/models/classic",
    label: "Classic",
    market:
      "Fixed-supply token with an ETH market, configurable directional fees, creator rewards and permanently locked one-sided liquidity.",
  },
  {
    feePath:
      "A release-specific hook fee with a 10 bps Programmable share on the supported official path.",
    href: "/docs/models/custom",
    label: "Custom hooks",
    market:
      "Token market with Uniswap v4 hook logic and a configuration defined for that release.",
  },
  {
    feePath:
      "A historical quote-asset path documented for existing records and integrations.",
    href: "/docs/models/stock-paired",
    label: "Stock-Paired",
    market:
      "Existing token paired with a configured Ondo Global Markets quote asset.",
  },
] as const;

export default function TokensDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/tokens"
      description="Programmable launch types differ in their market configuration, fee path and public identity."
      sections={sections}
      title="Tokens and launches"
    >
      <section id="launch-types">
        <h2>Compare launch types</h2>
        <p>
          Open a launch guide for the complete token structure, fee behavior,
          reward flow and product boundaries.
        </p>
        <div
          aria-label="Launch type comparison"
          className={styles.tableWrap}
          role="region"
          tabIndex={0}
        >
          <table className={styles.comparisonTable}>
            <thead>
              <tr>
                <th scope="col">Launch type</th>
                <th scope="col">Market</th>
                <th scope="col">Fee path</th>
              </tr>
            </thead>
            <tbody>
              {launchTypes.map((launchType) => (
                <tr key={launchType.href}>
                  <th scope="row">
                    <Link href={launchType.href}>{launchType.label}</Link>
                  </th>
                  <td>{launchType.market}</td>
                  <td>{launchType.feePath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="identity">
        <h2>What every launch has in common</h2>
        <p>
          Every documented launch creates an ERC-20 token and a Uniswap v4
          market. The hook, quote asset, fee path, reward flow and available
          actions can differ.
        </p>
        <ul className={styles.plainList}>
          <li>
            <strong>Token identity:</strong> use the chain and token address.
          </li>
          <li>
            <strong>Market identity:</strong> use PoolManager and poolId.
          </li>
          <li>
            <strong>Current market data:</strong> read price, liquidity, volume
            and rewards from current data sources.
          </li>
        </ul>
      </section>

      <section id="labels">
        <h2>Public labels</h2>
        <p>
          For a Router-stamped launch that passes the published verification
          checks, use <strong>Programmable</strong> as the broad provenance
          label. Use <strong>Programmable Classic</strong> or{" "}
          <strong>Programmable Custom</strong> when the recorded launch kind is
          useful to the reader.
        </p>
        <p>
          <code>CustomGraph</code> is the Router enum name for kind 1. It is not
          a public product label. A verified label describes Router provenance,
          not current safety, liquidity or tradability.
        </p>
      </section>

      <section id="next">
        <h2>Next steps</h2>
        <ul className={styles.linkList}>
          <li>
            <Link href="/docs/infrastructure">
              <span>
                <strong>How Programmable works</strong>
                <small>
                  Understand launch execution, market identity and Router
                  provenance.
                </small>
              </span>
              <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </Link>
          </li>
          <li>
            <Link href="/docs/economics">
              <span>
                <strong>Fees and economics</strong>
                <small>
                  Compare the fee basis, creator share and Programmable share
                  for every path.
                </small>
              </span>
              <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </Link>
          </li>
          <li>
            <Link href="/docs/developers">
              <span>
                <strong>Developer integration</strong>
                <small>
                  Add Programmable launch verification to an application.
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
