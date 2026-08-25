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
  title: "Public templates · Programmable",
  description:
    "Understand the planned reusable hook versioning, attribution and creator fee policy.",
  alternates: { canonical: "/docs/creators/templates" },
};

const sections = [
  { id: "overview", label: "Template model" },
  { id: "difference", label: "Template or project" },
  { id: "economics", label: "Template economics" },
  { id: "version", label: "Version and attribution" },
  { id: "requirements", label: "What a template needs" },
  { id: "next", label: "Current status" },
] as const;

export default function CreatorTemplateDocsPage() {
  const fee = PROGRAMMABLE_FEE_TABLE.publicTemplate;

  return (
    <DocsShell
      currentPath="/docs/creators/templates"
      description="A template is reusable hook logic that other creators can select for their own official launches."
      parentHref="/docs/creators"
      parentLabel="Creators"
      sections={sections}
      title="Public templates"
    >
      <section id="overview">
        <h2>Template model</h2>
        <p>
          A template is reusable hook logic with a defined parameter range. Each
          version would be bound and attributed separately so creators can see
          exactly which code their launches use.
        </p>
        <p>
          A concrete token and project belong in the Custom Launch API. A public
          template would be a separately versioned product for other creators to
          select, but that submission path is not active.
        </p>
        <div className={docsStyles.callout}>
          <strong>Public template intake is closed.</strong>
          <p>
            Do not open a repository application or send a reusable template to
            the Custom Launch API. Use the API only for one concrete project and
            token bundle.
          </p>
        </div>
      </section>

      <section id="difference">
        <h2>Template or project</h2>
        <div
          aria-label="Project and template comparison"
          className={styles.tableWrap}
          role="region"
          tabIndex={0}
        >
          <table className={`${styles.comparisonTable} ${styles.policyTable}`}>
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Project launch</th>
                <th scope="col">Public template</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Purpose</th>
                <td data-label="Project launch">
                  Create one token and market.
                </td>
                <td data-label="Public template">
                  Let other creators launch with reusable logic.
                </td>
              </tr>
              <tr>
                <th scope="row">Version target</th>
                <td data-label="Project launch">
                  One source revision and launch configuration.
                </td>
                <td data-label="Public template">
                  One template version, factory, parameter range and payout
                  identity.
                </td>
              </tr>
              <tr>
                <th scope="row">Creator action</th>
                <td data-label="Project launch">
                  Launch from the bound wallet.
                </td>
                <td data-label="Public template">
                  No public submission while the program is inactive.
                </td>
              </tr>
              <tr>
                <th scope="row">Earnings</th>
                <td data-label="Project launch">
                  Defined by the project market.
                </td>
                <td data-label="Public template">
                  Planned 10 bps from qualifying official template usage.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="economics">
        <h2>Template economics</h2>
        <p>
          The public template policy uses one {formatBps(fee.totalBps)} fee.{" "}
          {formatBps(fee.creatorBps)} goes to the template creator and{" "}
          {formatBps(fee.programmableBps)} goes to Programmable.
        </p>
        <div aria-label="Public template fee split" className={styles.splitBar}>
          <span>10 bps template creator</span>
          <span>10 bps Programmable</span>
        </div>
        <p>
          The share applies only to official Programmable launches that use the
          exact active template version. It does not create a royalty on
          unrelated deployments or forks outside Programmable.
        </p>
        <p>
          This policy is not a payout receipt. Payment requires the matching
          template registry, contract and recipient activation record.
        </p>
      </section>

      <section id="version">
        <h2>Version and attribution</h2>
        <p>
          Approval binds one template ID and version to exact source, artifacts,
          runtime code, parameter limits, fee policy and creator payout
          identity. A code, dependency or parameter range change creates a new
          version.
        </p>
        <p>
          A version can be paused for new launches if a credible issue appears.
          Launches already created from an immutable version remain onchain. A
          pause cannot rewrite their history.
        </p>
      </section>

      <section id="requirements">
        <h2>What a template needs</h2>
        <ul className={docsStyles.contentList}>
          <li>A clear use case and a bounded set of creator inputs.</li>
          <li>Exact source, reproducible artifacts and dependency versions.</li>
          <li>Hook permissions and every mutable or privileged control.</li>
          <li>Fee, liquidity, asset custody and withdrawal behavior.</li>
          <li>A creator payout identity and an approved software license.</li>
          <li>Tests for the complete allowed parameter range.</li>
        </ul>
      </section>

      <section id="next">
        <h2>Current status</h2>
        <p>
          Public template submissions and fee share activation are not active.
          Public Custom creation is also held. Package concrete projects locally
          and follow the Custom Launch API guide for activation status.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/developers/custom-launch">Read API availability</Link>
        </p>
      </section>
    </DocsShell>
  );
}
