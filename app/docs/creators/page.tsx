import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Creators · Programmable",
  description:
    "Package a Custom project locally and understand current creator paths and earnings.",
  alternates: { canonical: "/docs/creators" },
};

const sections = [
  { id: "paths", label: "Choose a creator path" },
  { id: "project", label: "Launch a project" },
  { id: "template", label: "Public templates" },
  { id: "review", label: "Checks and wallet action" },
  { id: "earn", label: "How creators earn" },
  { id: "tools", label: "Tools and programs" },
] as const;

export default function CreatorsDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/creators"
      description="Package, submit and track a Custom project, then review current creator programs."
      sections={sections}
      title="Create with Programmable"
    >
      <section id="paths">
        <h2>Choose a creator path</h2>
        <p>
          Public V3 general-hook creation and lifecycle reads are live on
          Ethereum Mainnet. Wallet review and signing remain separate.
          Reusable-template intake is closed.
        </p>

        <div className={styles.pathGrid}>
          <Link className={styles.pathCard} href="/docs/creators/launch">
            <span>Custom Launch API</span>
            <strong>Package one Custom project</strong>
            <small>
              Build and validate one deterministic bundle locally, then review
              the current API availability boundary.
            </small>
          </Link>
          <Link className={styles.pathCard} href="/docs/creators/templates">
            <span>Planned</span>
            <strong>Understand public templates</strong>
            <small>
              Read the planned versioning, attribution and fee policy. Public
              template submissions are not active.
            </small>
          </Link>
        </div>
      </section>

      <section id="project">
        <h2>Launch a project</h2>
        <p>
          Build and test the project, then create a deterministic source and
          graph bundle with project-specific tooling. Package and validate it
          locally, then submit and track the byte-identical public V3 request.
        </p>
        <p>
          A prepared result contains the artifact but no wallet transaction.
          After authorization, the controller wallet must review, sign and
          broadcast the exact transaction separately. The API key cannot do so.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/launch">
            Read the complete launch path
          </Link>
        </p>
      </section>

      <section id="template">
        <h2>Public templates are planned</h2>
        <p>
          A public template uses one 20 bps fee: 10 bps goes to the template
          creator and 10 bps goes to Programmable. The share is tied to the
          exact template version and its official payout path; no share accrues
          before the program, registry and recipient path are activated.
        </p>
        <p>
          Public template intake is not active. The retained Custom Launch API
          contract models one concrete project and token bundle; it does not
          publish reusable templates.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/templates">Read the template model</Link>
        </p>
      </section>

      <section id="review">
        <h2>Checks and wallet action</h2>
        <p>
          Existing Custom Launch resources record checks for one deterministic
          bundle and an exact artifact. An already authorized resource exposes
          the exact transaction for separate wallet review. A future template
          program would separately bind one reusable version, parameter range
          and payout identity.
        </p>
        <p>
          Preparation and wallet execution are separate. An API result does not
          authorize the controller wallet, sign a transaction or broadcast it.
          The matching wallet action and final onchain record provide those
          separate results.
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
          Revenue depends on qualifying activity. API preparation, publication
          and listing do not promise volume or a fixed payment.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/earnings">Compare creator earnings</Link>
        </p>
      </section>

      <section id="tools">
        <h2>Tools and programs</h2>
        <ul className={styles.linkList}>
          <li>
            <Link href="/docs/creators/programs">
              <span>
                <strong>Creator programs</strong>
                <small>
                  Understand partnerships and contribution work.
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
