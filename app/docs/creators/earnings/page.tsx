import type { Metadata } from "next";
import Link from "next/link";

import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import {
  formatBps,
  PROGRAMMABLE_FEE_TABLE,
} from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Creator earnings · Programmable",
  description:
    "Compare creator rewards and public template shares.",
  alternates: { canonical: "/docs/creators/earnings" },
};

const sections = [
  { id: "paths", label: "Earning paths" },
  { id: "classic", label: "Classic rewards" },
  { id: "public-template", label: "Public templates" },
  { id: "claims", label: "Accrual and claims" },
  { id: "limits", label: "Limits" },
] as const;

export default function CreatorEarningsDocsPage() {
  const classic = PROGRAMMABLE_FEE_TABLE.classic;
  const publicTemplate = PROGRAMMABLE_FEE_TABLE.publicTemplate;

  return (
    <DocsShell
      currentPath="/docs/creators/earnings"
      description="Creator income depends on the launch path, the active fee policy and actual qualifying activity."
      parentHref="/docs/creators"
      parentLabel="Creators"
      sections={sections}
      title="Creator earnings"
    >
      <section id="paths">
        <h2>Earning paths</h2>
        <div
          aria-label="Creator earning paths"
          className={styles.tableWrap}
          role="region"
          tabIndex={0}
        >
          <table className={`${styles.comparisonTable} ${styles.policyTable}`}>
            <thead>
              <tr>
                <th scope="col">Path</th>
                <th scope="col">Creator or partner share</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Classic project</th>
                <td data-label="Creator or partner share">
                  Selected swap fee minus {formatBps(classic.programmableBps)}
                </td>
              </tr>
              <tr>
                <th scope="row">Public template</th>
                <td data-label="Creator or partner share">
                  {formatBps(publicTemplate.creatorBps)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="classic">
        <h2>Classic rewards</h2>
        <p>
          The launch wallet selects the buy fee and sell fee. Each rate can be
          1% through 10%. Programmable receives 0.10 percentage points of the
          gross native swap amount. The remainder accrues as creator rewards.
        </p>
        <p>
          A 1% swap fee therefore leaves 0.90% for creator rewards. The
          Programmable share is inside the selected fee rather than added as a
          second charge.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/models/classic">Read the Classic reward flow</Link>
        </p>
      </section>

      <section id="public-template">
        <h2>Public templates</h2>
        <p>
          The public template fee is 20 bps in total. The exact template creator
          receives 10 bps and Programmable receives 10 bps from qualifying
          official launches that use that version.
        </p>
        <p>
          The current template repository does not accept public applications. A
          share accrues only when the matching template registry and payout path
          are active for the launch.
        </p>
      </section>

      <section id="claims">
        <h2>Accrual and claims</h2>
        <p>
          The exact contract and asset determine how a share accrues and how it
          is claimed. Classic creator rewards accrue in ETH. Each template
          version defines its fee event, asset, recipient and claim method in
          its release record.
        </p>
        <p>
          A payout address must be verified before a launch or template version
          becomes active. Changing a payout identity does not silently redirect
          previously accrued funds.
        </p>
      </section>

      <section id="limits">
        <h2>Limits</h2>
        <ul className={docsStyles.contentList}>
          <li>Fees depend on qualifying activity and may be zero.</li>
          <li>Programmable does not promise trading volume or fixed income.</li>
          <li>
            Review, approval, listing and program participation do not create a
            payment by themselves.
          </li>
          <li>
            Gas and transaction conditions can affect when a claim is practical.
          </li>
          <li>
            A fork outside the official template path does not create a
            Programmable template share.
          </li>
        </ul>
      </section>
    </DocsShell>
  );
}
