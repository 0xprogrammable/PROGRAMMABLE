import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import styles from "@/components/docs-hub.module.css";
import { PROGRAMMABLE_PUBLIC_REPOSITORIES } from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Creators · Programmable",
  description:
    "Build a project, publish reusable hook logic and understand how creators earn.",
  alternates: { canonical: "/docs/creators" },
};

const sections = [
  { id: "paths", label: "Choose a creator path" },
  { id: "project", label: "Launch a project" },
  { id: "template", label: "Publish a template" },
  { id: "review", label: "Review and activation" },
  { id: "earn", label: "How creators earn" },
  { id: "tools", label: "Tools and programs" },
] as const;

export default function CreatorsDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/creators"
      description="Build a project, publish reusable hook logic or work with Programmable through a creator program."
      sections={sections}
      title="Create with Programmable"
    >
      <section id="paths">
        <h2>Choose a creator path</h2>
        <p>
          A project launch and a reusable template are different products. A
          launch creates one token and market. A template is reviewed for other
          people to use in future launches.
        </p>

        <div className={styles.pathGrid}>
          <Link className={styles.pathCard} href="/docs/creators/launch">
            <span>Submit a Launch</span>
            <strong>Launch one project</strong>
            <small>
              Submit one token and hook configuration for review. The approved
              revision is tied to one source commit and launch wallet.
            </small>
          </Link>
          <Link className={styles.pathCard} href="/docs/creators/templates">
            <span>Submit a Template</span>
            <strong>Publish reusable logic</strong>
            <small>
              Submit a reusable hook template that other creators can use in
              their own official launches. The repository currently does not
              accept public template applications.
            </small>
          </Link>
          <a
            className={styles.pathCard}
            href={PROGRAMMABLE_PUBLIC_REPOSITORIES.hookbuilder}
            rel="noreferrer"
            target="_blank"
          >
            <span>Hook Builder</span>
            <strong>Build with the skill and tools</strong>
            <small>
              Use the Hook Builder skill to create a reproducible Uniswap v4
              project before sending it to Submit a Launch or Submit a Template.
            </small>
            <span className="sr-only">Opens Hook Builder on GitHub</span>
          </a>
        </div>
      </section>

      <section id="project">
        <h2>Launch a project</h2>
        <p>
          Start with Hook Builder, freeze the source revision you want reviewed,
          then submit the application through Submit a Launch. Review applies
          only to that revision and the launch wallet named in the request.
        </p>
        <p>
          Submit a Launch is for one concrete project, token and hook. Do not
          send a reusable template to that repository.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/launch">
            Read the complete launch path
          </Link>
        </p>
      </section>

      <section id="template">
        <h2>Publish a template</h2>
        <p>
          A public template uses one 20 bps fee: 10 bps goes to the template
          creator and 10 bps goes to Programmable. The share is tied to the
          exact template version and its official payout path; no share accrues
          before the repository, registry and recipient path are activated.
        </p>
        <p>
          Submit a Template is the separate path for reusable hook logic. Do not
          submit template applications to Hook Builder or Submit a Launch.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/templates">Read the template model</Link>
        </p>
      </section>

      <section id="review">
        <h2>Review and activation</h2>
        <p>
          Launch Reviewer checks one concrete project revision. Template
          Reviewer checks one reusable template version, its parameter range and
          its payout identity. Both reviewers bind their result to the exact
          source and artifacts they examined.
        </p>
        <p>
          Authority and activation are separate from review. A review result
          does not itself deploy a contract, authorize a wallet transaction or
          create a fee recipient. The matching release record must provide that
          binding before a launch can use it.
        </p>
      </section>

      <section id="earn">
        <h2>How creators earn</h2>
        <p>
          Classic creators receive the selected swap fee minus the 10 bps
          Programmable share. Public templates use a 10/10 bps split when
          their separately documented payout path is active.
        </p>
        <p>
          Revenue depends on qualifying activity. Review, publication and
          listing do not promise volume or a fixed payment.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/earnings">Compare creator earnings</Link>
        </p>
      </section>

      <section id="tools">
        <h2>Tools and programs</h2>
        <ul className={styles.linkList}>
          <li>
            <a
              href={PROGRAMMABLE_PUBLIC_REPOSITORIES.hookbuilder}
              rel="noreferrer"
              target="_blank"
            >
              <span>
                <strong>Hook Builder</strong>
                <small>
                  The skill and local tools for building a reproducible Uniswap
                  v4 project.
                </small>
              </span>
              <ArrowUpRight aria-hidden="true" size={17} strokeWidth={1.8} />
              <span className="sr-only">Opens in a new tab</span>
            </a>
          </li>
          <li>
            <Link href="/hookathon">
              <span>
                <strong>Hookathons</strong>
                <small>
                  Open the event page for its deadline, award and submission
                  instructions.
                </small>
              </span>
              <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </Link>
          </li>
          <li>
            <Link href="/docs/creators/programs">
              <span>
                <strong>Creator programs</strong>
                <small>
                  Understand Hookathons, partnerships and contribution work.
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
