import type { Metadata } from "next";
import Link from "next/link";

import { DocsAddress } from "@/components/docs-address";
import docsStyles from "@/components/docs-experience.module.css";
import {
  PROGRAMMABLE_REVENUE_TARGET,
  V4_TOKEN_ADDRESS,
} from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "V4 token · Programmable",
  description:
    "Understand the V4 token, protocol revenue purchases and the limits of the published policy.",
  alternates: { canonical: "/docs/v4-token" },
};

const sections = [
  { id: "token", label: "V4 token" },
  { id: "allocation", label: "Protocol allocation" },
  { id: "cycles", label: "Revenue cycles" },
  { id: "boundaries", label: "What the policy does not mean" },
] as const;

export default function V4TokenDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/v4-token"
      description="V4 is the ecosystem token designated for purchases under Programmable's published revenue policy."
      sections={sections}
      title="V4 token"
    >
      <section id="token">
        <h2>V4 on Ethereum</h2>
        <p>
          Use the contract address, not a name or ticker, to identify the token.
        </p>
        <div className={docsStyles.factGrid}>
          <div className={docsStyles.fact}>
            <span>Network</span>
            <strong>Ethereum mainnet</strong>
          </div>
          <div className={docsStyles.fact}>
            <span>Contract</span>
            <DocsAddress address={V4_TOKEN_ADDRESS} label="V4 token" />
          </div>
          <div className={docsStyles.fact}>
            <span>Revenue purchases</span>
            <strong>Held by the protocol revenue wallet when processed</strong>
          </div>
          <div className={docsStyles.fact}>
            <span>Burn</span>
            <strong>No burn in the published revenue policy</strong>
          </div>
        </div>
      </section>

      <section id="allocation">
        <h2>Protocol allocation</h2>
        <p>
          The published protocol allocation assigns 80% of attributable net
          protocol revenue to V4 purchases and 20% to the treasury. The keeper
          receives no share of revenue under that policy.
        </p>
        <div className={docsStyles.callout}>
          <strong>Read this split with its deployment record.</strong>
          <p>
            The 80/20 split is the published policy. The exact deployment and
            activation receipts identify which processor is in effect; the
            current deployment record may bind a different processor until this
            policy is activated. This policy page is not an execution receipt.
          </p>
        </div>
        <div className={docsStyles.factGrid}>
          <div className={docsStyles.fact}>
            <span>V4 purchases</span>
            <strong>{PROGRAMMABLE_REVENUE_TARGET.buybackBps / 100}%</strong>
          </div>
          <div className={docsStyles.fact}>
            <span>Treasury</span>
            <strong>{PROGRAMMABLE_REVENUE_TARGET.treasuryBps / 100}%</strong>
          </div>
          <div className={docsStyles.fact}>
            <span>Keeper revenue share</span>
            <strong>{PROGRAMMABLE_REVENUE_TARGET.keeperBps}%</strong>
          </div>
        </div>
      </section>

      <section id="cycles">
        <h2>Revenue cycles</h2>
        <p>
          Eligible revenue is evaluated in cycles with a minimum interval of 24
          hours. This is not a promise that a transaction will execute at the
          same clock time every day.
        </p>
        <ol className={docsStyles.steps}>
          <li>
            <strong>Recognize a supported source.</strong>
            <span>
              The source must match an activated profile and the expected asset.
            </span>
          </li>
          <li>
            <strong>Separate liabilities.</strong>
            <span>
              Creator and partner shares remain distinct from Programmable net
              revenue.
            </span>
          </li>
          <li>
            <strong>Check execution conditions.</strong>
            <span>
              Finality, provider agreement, balances and minimum thresholds must
              pass.
            </span>
          </li>
          <li>
            <strong>Process the active allocation.</strong>
            <span>
              The active policy determines the purchase and treasury amounts.
            </span>
          </li>
        </ol>
      </section>

      <section id="boundaries">
        <h2>What the policy does not mean</h2>
        <ul className={docsStyles.contentList}>
          <li>V4 does not represent equity in Programmable.</li>
          <li>Holding V4 does not create a claim on protocol revenue.</li>
          <li>
            Revenue purchases do not guarantee price, liquidity or returns.
          </li>
          <li>
            A new revenue source is not processed until its source profile is
            verified and activated.
          </li>
          <li>
            Quote assets that cannot be safely processed remain separate rather
            than being relabeled as ETH revenue.
          </li>
        </ul>
        <p>
          Read the complete fee basis and creator splits on the{" "}
          <Link href="/docs/economics">Economics page</Link>.
        </p>
      </section>
    </DocsShell>
  );
}
