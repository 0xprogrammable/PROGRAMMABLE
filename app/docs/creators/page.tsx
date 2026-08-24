import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import styles from "@/components/docs-hub.module.css";
import { PROGRAMMABLE_PUBLIC_REPOSITORIES } from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Creators · Programmable",
  description:
    "Prepare a Custom launch through the API and understand current creator paths and earnings.",
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
      description="Prepare a Custom launch through the API, understand the planned template policy or work with Programmable through a creator program."
      sections={sections}
      title="Create with Programmable"
    >
      <section id="paths">
        <h2>Choose a creator path</h2>
        <p>
          Custom project launches are available through the API. A reusable
          template would be a different product for other people to use in
          future launches, and its public intake is not open.
        </p>

        <div className={styles.pathGrid}>
          <Link className={styles.pathCard} href="/docs/creators/launch">
            <span>Custom Launch API</span>
            <strong>Prepare one Custom launch</strong>
            <small>
              Create a wallet-bound API key, submit one deterministic bundle for
              checks and receive a prepared wallet action.
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
              project before packaging it for the Custom Launch API.
            </small>
            <span className="sr-only">Opens Hook Builder on GitHub</span>
          </a>
        </div>
      </section>

      <section id="project">
        <h2>Launch a project</h2>
        <p>
          Start with Hook Builder, create a deterministic source and graph
          bundle, then submit it through the Custom Launch API with a
          wallet-bound key. The API validates its declared commitments and graph
          bindings, then prepares the exact wallet action without reproducing
          the build.
        </p>
        <p>
          The API key cannot sign or broadcast. The controller wallet must
          review and confirm the prepared launch separately.
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
          Public template intake is not active. The Custom Launch API accepts
          one concrete project and token bundle; it does not publish reusable
          templates.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/templates">Read the template model</Link>
        </p>
      </section>

      <section id="review">
        <h2>Checks and wallet action</h2>
        <p>
          The Custom Launch API checks one deterministic bundle and prepares an
          exact wallet action. A future template program would separately bind
          one reusable version, parameter range and payout identity.
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
