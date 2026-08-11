import type { Metadata } from "next";

import { DocsExternalLink } from "@/components/docs-external-link";
import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import { PROGRAMMABLE_PUBLIC_REPOSITORIES } from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Launch a project · Programmable",
  description:
    "Follow the path from a reproducible hook project to review, wallet launch and public verification.",
  alternates: { canonical: "/docs/creators/launch" },
};

const sections = [
  { id: "access", label: "Start here" },
  { id: "prepare", label: "Prepare the project" },
  { id: "submit", label: "Submit one revision" },
  { id: "review", label: "Review" },
  { id: "launch", label: "Launch" },
  { id: "after", label: "After launch" },
] as const;

export default function CreatorLaunchDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/creators/launch"
      description="Build one exact project revision, submit it for review and launch it from the wallet bound to that release."
      parentHref="/docs/creators"
      parentLabel="Creators"
      sections={sections}
      title="Launch a project"
    >
      <section id="access">
        <h2>Start here</h2>
        <p>
          Use Hook Builder to create the project. When Submit a Launch accepts
          applications, it packages the exact revision for review. The
          submission repository defines the request format and required files.
        </p>
        <div className={docsStyles.callout}>
          <strong>Use the repository instructions.</strong>
          <p>
            Intake rules can change with the review system. Read the current
            Submit a Launch README before creating a pull request; do not invent
            a submission format or open a manual PR while the README keeps the
            intake in prelaunch review.
          </p>
        </div>
      </section>

      <section id="prepare">
        <h2>Prepare the project</h2>
        <ol className={docsStyles.steps}>
          <li>
            <strong>Build with a clean source repository.</strong>
            <span>
              Keep contracts, tests, deployment logic and public project data
              together at one reviewable revision.
            </span>
          </li>
          <li>
            <strong>Run the project gates.</strong>
            <span>
              Compile, test and reproduce the artifacts on the exact commit you
              intend to submit.
            </span>
          </li>
          <li>
            <strong>Choose the launch wallet.</strong>
            <span>
              The GitHub identity, source revision and wallet must match the
              application.
            </span>
          </li>
          <li>
            <strong>Describe every important control.</strong>
            <span>
              Include fees, recipients, liquidity custody, privileged roles,
              dependencies and mutable behavior.
            </span>
          </li>
        </ol>
        <DocsExternalLink
          href={PROGRAMMABLE_PUBLIC_REPOSITORIES.hookbuilder}
          variant="chip"
        >
          Open Hook Builder
        </DocsExternalLink>
      </section>

      <section id="submit">
        <h2>Submit one revision</h2>
        <p>
          A submission identifies one source repository, commit, tree, launch
          wallet and requested launch path. Changing any of those values creates
          a new review target.
        </p>
        <p>
          Submit a Launch is the public home for this workflow when its README
          accepts applications. Its README defines the intake rules and the
          files to provide.
        </p>
        <p>
          This repository is for one concrete project and token. Reusable hook
          logic belongs in Submit a Template, not in a project submission.
        </p>
        <DocsExternalLink
          href={PROGRAMMABLE_PUBLIC_REPOSITORIES.submitLaunch}
          variant="chip"
        >
          Open Submit a Launch
        </DocsExternalLink>
      </section>

      <section id="review">
        <h2>Review</h2>
        <p>
          Review checks the exact source revision, behavior, evidence and launch
          compatibility. A reviewer can accept the revision, request specific
          changes or keep the result pending when required evidence is missing.
        </p>
        <dl className={styles.definitionList}>
          <div>
            <dt>Changes requested</dt>
            <dd>
              The submission names the smallest complete correction. Push a new
              revision and let the checks run again.
            </dd>
          </div>
          <div>
            <dt>Approved revision</dt>
            <dd>
              The named revision passed the review gates. This is not a safety
              guarantee or a launch transaction.
            </dd>
          </div>
          <div>
            <dt>Pending</dt>
            <dd>
              Evidence or an external dependency is incomplete. Pending does not
              mean that the project is unsafe.
            </dd>
          </div>
        </dl>
      </section>

      <section id="launch">
        <h2>Launch</h2>
        <p>
          When the approved revision has an active execution path, the bound
          creator wallet can open Launch, review the final transaction and sign
          it. The connected wallet is the only party that can submit that user
          transaction.
        </p>
        <p>
          The launch is not complete when a transaction is merely submitted. It
          must finalize and its token, pool and Router record must agree.
        </p>
      </section>

      <section id="after">
        <h2>After launch</h2>
        <ul className={docsStyles.contentList}>
          <li>
            Confirm the finalized transaction and canonical token address.
          </li>
          <li>Check that the launch appears in Explore and public feeds.</li>
          <li>Share the contract address, not only a name or ticker.</li>
          <li>
            Disclose material changes, incidents or unavailable project links.
          </li>
          <li>
            Treat a new contract version or materially changed control path as a
            new review target.
          </li>
        </ul>
      </section>
    </DocsShell>
  );
}
