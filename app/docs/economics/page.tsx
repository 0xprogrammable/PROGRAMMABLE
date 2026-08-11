import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";

import { DocsExternalLink } from "@/components/docs-external-link";
import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import {
  formatBps,
  PROGRAMMABLE_FEE_TABLE,
  PROGRAMMABLE_PUBLIC_REPOSITORIES,
  PROGRAMMABLE_REVENUE_CURRENT,
  PROGRAMMABLE_REVENUE_TARGET,
} from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Economics · Programmable",
  description:
    "Understand Programmable fees, creator shares, template shares and protocol revenue allocation.",
  alternates: { canonical: "/docs/economics" },
};

const sections = [
  { id: "basis", label: "How to read the fees" },
  { id: "launch-fees", label: "Launch fee policies" },
  { id: "creator", label: "Creator earnings" },
  { id: "revenue", label: "Protocol revenue" },
  { id: "boundaries", label: "Boundaries" },
] as const;

const feeRows = [
  {
    path: "Classic",
    status: PROGRAMMABLE_FEE_TABLE.classic.status,
    total: PROGRAMMABLE_FEE_TABLE.classic.total,
    split: `${formatBps(PROGRAMMABLE_FEE_TABLE.classic.programmableBps)} to Programmable. The remainder becomes creator rewards.`,
    treatment: PROGRAMMABLE_FEE_TABLE.classic.chargeMode,
  },
  {
    path: "Standard Custom",
    status: PROGRAMMABLE_FEE_TABLE.standardCustom.status,
    total: formatBps(PROGRAMMABLE_FEE_TABLE.standardCustom.totalBps),
    split: `${formatBps(PROGRAMMABLE_FEE_TABLE.standardCustom.programmableBps)} to Programmable. Project economics are defined by the release.`,
    treatment: PROGRAMMABLE_FEE_TABLE.standardCustom.chargeMode,
  },
  {
    path: "Public template",
    status: PROGRAMMABLE_FEE_TABLE.publicTemplate.status,
    total: formatBps(PROGRAMMABLE_FEE_TABLE.publicTemplate.totalBps),
    split: `${formatBps(PROGRAMMABLE_FEE_TABLE.publicTemplate.creatorBps)} to the template creator and ${formatBps(PROGRAMMABLE_FEE_TABLE.publicTemplate.programmableBps)} to Programmable.`,
    treatment: PROGRAMMABLE_FEE_TABLE.publicTemplate.chargeMode,
  },
  {
    path: "Partner template",
    status: PROGRAMMABLE_FEE_TABLE.partnerTemplate.status,
    total: formatBps(PROGRAMMABLE_FEE_TABLE.partnerTemplate.totalBps),
    split: `${formatBps(PROGRAMMABLE_FEE_TABLE.partnerTemplate.partnerBps)} to the partner and ${formatBps(PROGRAMMABLE_FEE_TABLE.partnerTemplate.programmableBps)} to Programmable.`,
    treatment: PROGRAMMABLE_FEE_TABLE.partnerTemplate.chargeMode,
  },
] as const;

export default function EconomicsDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/economics"
      description="One place for launch fees, creator shares and the way Programmable allocates protocol revenue."
      sections={sections}
      title="Economics"
    >
      <section id="basis">
        <h2>How to read the fees</h2>
        <p>
          One basis point is 0.01%. A fee of 10 bps is 0.10% of the stated
          basis. The basis and charge treatment matter as much as the number.
        </p>
        <p>
          Classic includes the Programmable share inside the fee selected for
          that launch. Standard Custom uses a separate 10 bps policy on a
          verified official market path. Template fees are a different product
          path and are not stacked with another unnamed template charge.
        </p>
      </section>

      <section id="launch-fees">
        <h2>Launch fee policies</h2>
        <p>
          The status column is part of the policy. Planned economics are not
          collected until the matching contracts and exact template version are
          activated.
        </p>

        <div
          aria-label="Programmable launch fee policies"
          className={styles.tableWrap}
          role="region"
          tabIndex={0}
        >
          <table
            className={`${styles.comparisonTable} ${styles.policyTable}`}
          >
            <thead>
              <tr>
                <th scope="col">Path</th>
                <th scope="col">Total or selected fee</th>
                <th scope="col">Split</th>
                <th scope="col">Treatment</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {feeRows.map((row) => (
                <tr key={row.path}>
                  <th scope="row">{row.path}</th>
                  <td data-label="Total or selected fee">{row.total}</td>
                  <td data-label="Split">{row.split}</td>
                  <td data-label="Treatment">{row.treatment}</td>
                  <td data-label="Status">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={docsStyles.callout}>
          <strong>Activation is verified per path.</strong>
          <p>
            A policy in these docs does not prove that a particular launch,
            template or recipient is active. Check the exact release and public
            record before displaying or accounting for a fee.
          </p>
        </div>
      </section>

      <section id="creator">
        <h2>Creator earnings</h2>
        <p>
          Classic creator rewards are the selected swap fee minus the 10 bps
          Programmable share. Public template creators are intended to receive
          10 bps from official launches that use their exact active template
          version. An activated partner template uses a separate 15 bps partner
          share and 5 bps Programmable share.
        </p>
        <p>
          Earnings depend on actual qualifying activity. A review, listing or
          template publication does not promise trading volume or a fixed
          payment.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/earnings">Read the creator guide</Link>
        </p>
      </section>

      <section id="revenue">
        <h2>Protocol revenue</h2>
        <p>
          The current V2 revenue processor allocates 49.50% of processed revenue
          to V4 purchases, 50.00% to the treasury and 0.50% to the keeper. V4
          purchases go to the protocol revenue wallet. They are not burns.
        </p>

        <div
          aria-label="Current protocol revenue allocation"
          className={styles.splitBar}
          style={
            {
              "--split-first": `${PROGRAMMABLE_REVENUE_CURRENT.buybackBps + PROGRAMMABLE_REVENUE_CURRENT.keeperBps}fr`,
              "--split-second": `${PROGRAMMABLE_REVENUE_CURRENT.treasuryBps}fr`,
            } as CSSProperties
          }
        >
          <span>49.50% V4 purchases · 0.50% keeper</span>
          <span>50.00% treasury</span>
        </div>

        <h3>Next policy</h3>
        <p>
          Programmable intends to allocate 80% of attributable net protocol
          revenue to V4 purchases and 20% to the treasury, with no keeper share
          from revenue. This policy remains planned until its deployment and
          activation evidence are public.
        </p>

        <div
          aria-label="Planned protocol revenue allocation"
          className={styles.splitBar}
          style={
            {
              "--split-first": `${PROGRAMMABLE_REVENUE_TARGET.buybackBps}fr`,
              "--split-second": `${PROGRAMMABLE_REVENUE_TARGET.treasuryBps}fr`,
            } as CSSProperties
          }
        >
          <span>80% V4 purchases</span>
          <span>20% treasury</span>
        </div>

        <p className={styles.inlineAction}>
          <Link href="/docs/v4-token">Read about V4 and revenue cycles</Link>
        </p>
      </section>

      <section id="boundaries">
        <h2>Boundaries</h2>
        <ul className={docsStyles.contentList}>
          <li>
            Attributable net revenue means the amount that belongs to
            Programmable after creator and partner liabilities are separated.
          </li>
          <li>
            Revenue processing applies only to verified supported sources. A new
            fee source requires its own activated source profile.
          </li>
          <li>
            Eligible revenue is evaluated in cycles with a minimum interval of
            24 hours. Thresholds, finality, provider health or safety gates can
            delay execution.
          </li>
          <li>
            Fee and revenue documentation does not promise token value, volume,
            holder yield or future purchases.
          </li>
        </ul>

        <p>
          Technical integrators should use the versioned machine contracts in
          the developer repository rather than parsing this page.
        </p>
        <DocsExternalLink
          href={PROGRAMMABLE_PUBLIC_REPOSITORIES.developers}
          variant="chip"
        >
          Developer contracts
        </DocsExternalLink>
      </section>
    </DocsShell>
  );
}
