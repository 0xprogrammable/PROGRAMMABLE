import type { Metadata } from "next";

import { DocsExternalLink } from "@/components/docs-external-link";
import docsStyles from "@/components/docs-experience.module.css";
import { PROGRAMMABLE_PUBLIC_REPOSITORIES } from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Trust · Programmable",
  description:
    "Understand what source review, launch activation, wallet execution and Router provenance prove.",
  alternates: { canonical: "/docs/trust" },
};

const sections = [
  { id: "layers", label: "Evidence layers" },
  { id: "review", label: "Review and approval" },
  { id: "router", label: "Router provenance" },
  { id: "roles", label: "Roles and controls" },
  { id: "audits", label: "Independent review" },
  { id: "report", label: "Report an issue" },
] as const;

export default function TrustDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/trust"
      description="Programmable separates source review, launch authority, wallet execution and public onchain verification."
      sections={sections}
      title="Trust"
    >
      <section id="layers">
        <h2>Evidence layers</h2>
        <p>
          No single green check proves the whole lifecycle. Each layer answers a
          narrower question.
        </p>
        <ol className={docsStyles.steps}>
          <li>
            <strong>Source review</strong>
            <span>
              Did the exact source revision and its evidence pass the published
              review gates?
            </span>
          </li>
          <li>
            <strong>Launch activation</strong>
            <span>
              Is the matching execution profile active for the named revision,
              wallet and chain?
            </span>
          </li>
          <li>
            <strong>Wallet execution</strong>
            <span>
              Did the creator inspect and submit the expected transaction?
            </span>
          </li>
          <li>
            <strong>Finality</strong>
            <span>
              Is the successful transaction part of the canonical finalized
              chain?
            </span>
          </li>
          <li>
            <strong>Router provenance</strong>
            <span>
              Does the canonical Router record bind the token, pool, hook and
              launch kind?
            </span>
          </li>
          <li>
            <strong>Public projection</strong>
            <span>
              Do the indexer, API and website show the same finalized identity?
            </span>
          </li>
        </ol>
      </section>

      <section id="review">
        <h2>Review and approval</h2>
        <p>
          A review applies to one exact source revision and evidence set. A
          later commit is a different target, even when its project name is
          unchanged.
        </p>
        <div className={docsStyles.factGrid}>
          <div className={docsStyles.fact}>
            <span>Accepted revision</span>
            <strong>Passed the defined review gates</strong>
          </div>
          <div className={docsStyles.fact}>
            <span>Changes requested</span>
            <strong>Needs a specific correction and a new review target</strong>
          </div>
          <div className={docsStyles.fact}>
            <span>Pending</span>
            <strong>Required evidence is incomplete or unavailable</strong>
          </div>
        </div>
        <p>
          Acceptance is technical readiness for the named scope. It is not an
          external audit, endorsement, price opinion or promise that a launch
          will trade.
        </p>
      </section>

      <section id="router">
        <h2>Router provenance</h2>
        <p>
          A valid Launch Stamp Router record establishes that a launch was
          executed and stamped through the published Router path. Applications
          can use the recorded kind to label it Programmable Classic or
          Programmable Custom.
        </p>
        <div className={docsStyles.callout}>
          <strong>Provenance is not a safety guarantee.</strong>
          <p>
            A stamp does not establish current liquidity, tradability, price,
            audit coverage or support in an external application. Direct factory
            calls outside the Router do not receive the label.
          </p>
        </div>
      </section>

      <section id="roles">
        <h2>Roles and controls</h2>
        <p>
          Every release should disclose who can change fees, recipients,
          dependencies, template configuration and future launch controls. The
          creator wallet controls its own launch transaction. Protocol roles do
          not sign that transaction on the creator&apos;s behalf.
        </p>
        <p>
          A pause can stop new launches or new authority actions when the
          relevant contract supports it. It cannot rewrite finalized launches or
          silently change immutable contracts already deployed.
        </p>
        <p>
          Use the exact release and deployment records for addresses, code
          hashes, roles and current control state.
        </p>
      </section>

      <section id="audits">
        <h2>Independent review</h2>
        <p>
          The Programmable contracts in the public product repository have not
          undergone an external audit or public security contest. Internal
          reviews, tests, static analysis and reproducible release evidence are
          not substitutes for an independent audit.
        </p>
        <p>
          A project can publish its own audit or security work. That evidence
          applies only to the version and scope it names.
        </p>
      </section>

      <section id="report">
        <h2>Report an issue</h2>
        <p>
          Include the affected chain, contract or URL, the exact source revision
          and a minimal reproduction. Do not post private keys, access tokens,
          wallet signatures or unpublished exploit details in a public issue.
        </p>
        <div className={docsStyles.sourceLinks}>
          <DocsExternalLink
            href={PROGRAMMABLE_PUBLIC_REPOSITORIES.product + "/security"}
            variant="chip"
          >
            Security reporting
          </DocsExternalLink>
          <DocsExternalLink
            href={PROGRAMMABLE_PUBLIC_REPOSITORIES.productIssues}
            variant="chip"
          >
            Product and docs issues
          </DocsExternalLink>
        </div>
      </section>
    </DocsShell>
  );
}
