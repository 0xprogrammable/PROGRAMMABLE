import type { Metadata } from "next";

import { DocsExternalLink } from "@/components/docs-external-link";
import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import {
  formatBps,
  PROGRAMMABLE_FEE_TABLE,
  PROGRAMMABLE_PRODUCT_STATES,
  PROGRAMMABLE_PUBLIC_REPOSITORIES,
} from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Publish a template · Programmable",
  description:
    "Understand the planned public template workflow, version binding and creator fee share.",
  alternates: { canonical: "/docs/creators/templates" },
};

const sections = [
  { id: "status", label: "Status" },
  { id: "difference", label: "Template or project" },
  { id: "economics", label: "Template economics" },
  { id: "version", label: "Version and attribution" },
  { id: "requirements", label: "What a template needs" },
  { id: "next", label: "What happens next" },
] as const;

export default function CreatorTemplateDocsPage() {
  const state = PROGRAMMABLE_PRODUCT_STATES.publicTemplates;
  const fee = PROGRAMMABLE_FEE_TABLE.publicTemplate;

  return (
    <DocsShell
      currentPath="/docs/creators/templates"
      description="A template is reusable hook logic that other creators can select for their own official launches."
      parentHref="/docs/creators"
      parentLabel="Creators"
      sections={sections}
      title="Publish a template"
    >
      <section id="status">
        <h2>Status</h2>
        <div className={styles.statusLine}>
          <span className={styles.statusBadge} data-lifecycle={state.lifecycle}>
            {state.lifecycle}
          </span>
          <span className={styles.statusBadge}>{state.availability}</span>
        </div>
        <p>{state.detail}</p>
        <div className={docsStyles.callout}>
          <strong>Template submission is not open yet.</strong>
          <p>
            The repository exists so the workflow can be published cleanly.
            Until it contains an active schema and intake instructions, do not
            create a template application PR.
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
          <table
            className={`${styles.comparisonTable} ${styles.policyTable}`}
          >
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
                <td data-label="Project launch">Create one token and market.</td>
                <td data-label="Public template">
                  Let other creators launch with reusable logic.
                </td>
              </tr>
              <tr>
                <th scope="row">Review target</th>
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
                <td data-label="Project launch">Launch from the bound wallet.</td>
                <td data-label="Public template">
                  Publish a version for future official launches.
                </td>
              </tr>
              <tr>
                <th scope="row">Earnings</th>
                <td data-label="Project launch">
                  Defined by the project market.
                </td>
                <td data-label="Public template">
                  Planned fee share from qualifying template usage.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="economics">
        <h2>Template economics</h2>
        <p>
          The intended public template policy uses one {formatBps(fee.totalBps)}{" "}
          fee. {formatBps(fee.creatorBps)} goes to the template creator and{" "}
          {formatBps(fee.programmableBps)} goes to Programmable.
        </p>
        <div
          aria-label="Planned public template fee split"
          className={styles.splitBar}
        >
          <span>10 bps template creator</span>
          <span>10 bps Programmable</span>
        </div>
        <p>
          The share applies only to official Programmable launches that use the
          exact active template version. It does not create a royalty on
          unrelated deployments or forks outside Programmable.
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
        <h2>What happens next</h2>
        <p>
          Submit Template will publish the schema, examples and review process
          before intake opens. The repository is the only source for that
          opening.
        </p>
        <DocsExternalLink
          href={PROGRAMMABLE_PUBLIC_REPOSITORIES.submitTemplate}
          variant="chip"
        >
          Follow Submit Template
        </DocsExternalLink>
      </section>
    </DocsShell>
  );
}
