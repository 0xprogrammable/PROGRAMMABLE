import type { Metadata } from "next";
import Link from "next/link";

import { DocsExternalLink } from "@/components/docs-external-link";
import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import { PROGRAMMABLE_PUBLIC_REPOSITORIES } from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Creator programs · Programmable",
  description:
    "Understand Programmable Hookathons, partnerships and contribution opportunities.",
  alternates: { canonical: "/docs/creators/programs" },
};

const sections = [
  { id: "hookathons", label: "Hookathons" },
  { id: "partnerships", label: "Partnerships" },
  { id: "contributions", label: "Contributions" },
  { id: "support", label: "Support" },
] as const;

export default function CreatorProgramsDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/creators/programs"
      description="Programmable supports builders through scheduled events, exact partnerships and public contribution work."
      parentHref="/docs/creators"
      parentLabel="Creators"
      sections={sections}
      title="Creator programs"
    >
      <section id="hookathons">
        <h2>Hookathons</h2>
        <p>
          Programmable runs Hookathons to fund useful experiments and bring new
          hook projects onchain. Each event publishes its own deadline, award,
          eligibility and submission path.
        </p>
        <p>
          These permanent docs do not copy the current prize or countdown.
          Always use the event page for those details.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/hookathon">Open Hookathon events</Link>
        </p>
      </section>

      <section id="partnerships">
        <h2>Partnerships</h2>
        <p>
          A partner template uses one 20 bps fee, split 15 bps to the partner
          and 5 bps to Programmable. A partnership is bound to the exact
          provider, template version, fee path and payout identity.
        </p>
        <p>
          No partner version is assumed active by this reference. The exact
          repository and activation record control when a partner path can
          accrue a share.
        </p>
        <p>
          Partnership support does not replace technical review or create a
          general endorsement of every project launched from that template.
        </p>
      </section>

      <section id="contributions">
        <h2>Contributions</h2>
        <p>
          Builders can improve the public product, Hook Builder, developer
          references and submission workflows through their respective
          repositories. A contribution is reviewed against that
          repository&apos;s scope and rules.
        </p>
        <p>
          Paid work, bounties or grants are offered only when an issue or
          program says so explicitly. A pull request does not create an
          automatic payment.
        </p>
        <div className={docsStyles.sourceLinks}>
          <DocsExternalLink
            href={PROGRAMMABLE_PUBLIC_REPOSITORIES.product}
            variant="chip"
          >
            Product repository
          </DocsExternalLink>
          <DocsExternalLink
            href={PROGRAMMABLE_PUBLIC_REPOSITORIES.hookbuilder}
            variant="chip"
          >
            Hook Builder
          </DocsExternalLink>
          <DocsExternalLink
            href={PROGRAMMABLE_PUBLIC_REPOSITORIES.developers}
            variant="chip"
          >
            Developer docs
          </DocsExternalLink>
        </div>
      </section>

      <section id="support">
        <h2>Support</h2>
        <p>
          Use the repository that owns the issue. Include the exact URL, source
          revision, reproduction steps that do not depend on a wallet and the
          result you expected.
        </p>
        <DocsExternalLink
          href={PROGRAMMABLE_PUBLIC_REPOSITORIES.productIssues}
          variant="chip"
        >
          Report a product or docs issue
        </DocsExternalLink>
      </section>
    </DocsShell>
  );
}
