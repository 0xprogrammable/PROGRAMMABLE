import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import styles from "@/components/docs-hub.module.css";
import {
  PROGRAMMABLE_PRODUCT_STATES,
  PROGRAMMABLE_PUBLIC_REPOSITORIES,
} from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Creators · Programmable",
  description:
    "Launch a project, understand creator earnings or follow the planned template publishing path.",
  alternates: { canonical: "/docs/creators" },
};

const sections = [
  { id: "paths", label: "Choose a creator path" },
  { id: "project", label: "Launch a project" },
  { id: "template", label: "Publish a template" },
  { id: "earn", label: "How creators earn" },
  { id: "tools", label: "Tools and programs" },
] as const;

export default function CreatorsDocsPage() {
  const custom = PROGRAMMABLE_PRODUCT_STATES.custom;
  const templates = PROGRAMMABLE_PRODUCT_STATES.publicTemplates;

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
            <span>One project</span>
            <strong>Launch a token and hook</strong>
            <small>
              Build one exact release, submit it for review and launch it from
              the bound wallet when its path is available.
            </small>
          </Link>
          <Link className={styles.pathCard} href="/docs/creators/templates">
            <span>Reusable logic</span>
            <strong>Publish a template</strong>
            <small>
              Prepare one version that other creators can use. The public
              workflow is planned and not accepting submissions yet.
            </small>
          </Link>
          <Link className={styles.pathCard} href="/docs/creators/programs">
            <span>Programs</span>
            <strong>Join a Hookathon or partnership</strong>
            <small>
              Follow the current event page or discuss an exact partner template
              with Programmable.
            </small>
          </Link>
        </div>
      </section>

      <section id="project">
        <h2>Launch a project</h2>
        <div className={styles.statusLine}>
          <span
            className={styles.statusBadge}
            data-lifecycle={custom.lifecycle}
          >
            {custom.lifecycle}
          </span>
          <span className={styles.statusBadge}>{custom.availability}</span>
        </div>
        <p>{custom.detail}</p>
        <p>
          Start with Hookbuilder, freeze the source revision you want reviewed,
          then follow Submit Launch. Review applies only to that revision and
          the launch wallet named in the request.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/launch">
            Read the complete launch path
          </Link>
        </p>
      </section>

      <section id="template">
        <h2>Publish a template</h2>
        <div className={styles.statusLine}>
          <span
            className={styles.statusBadge}
            data-lifecycle={templates.lifecycle}
          >
            {templates.lifecycle}
          </span>
          <span className={styles.statusBadge}>{templates.availability}</span>
        </div>
        <p>{templates.detail}</p>
        <p>
          The intended public template policy uses one 20 bps fee, split evenly
          between the template creator and Programmable. That policy is not live
          until the submission, registry and payout path are activated.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/templates">
            Read the planned template model
          </Link>
        </p>
      </section>

      <section id="earn">
        <h2>How creators earn</h2>
        <p>
          Classic creators receive the selected swap fee minus the 10 bps
          Programmable share. Template and partner shares apply only to an
          activated version on its official market path.
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
                <strong>Hookbuilder</strong>
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
                <strong>Current Hookathon</strong>
                <small>
                  Read the current deadline, award and submission instructions.
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
