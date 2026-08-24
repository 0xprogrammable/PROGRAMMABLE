import type { Metadata } from "next";
import Link from "next/link";

import { DocsExternalLink } from "@/components/docs-external-link";
import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import { PROGRAMMABLE_PUBLIC_REPOSITORIES } from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Launch a project · Programmable",
  description:
    "Use a wallet-bound API key to check a Custom launch bundle and prepare the exact wallet action.",
  alternates: { canonical: "/docs/creators/launch" },
};

const sections = [
  { id: "access", label: "Start here" },
  { id: "prepare", label: "Prepare the project" },
  { id: "key", label: "Create an API key" },
  { id: "submit", label: "Submit the bundle" },
  { id: "prepared", label: "Prepared launch" },
  { id: "launch", label: "Wallet confirmation" },
  { id: "after", label: "After launch" },
] as const;

export default function CreatorLaunchDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/creators/launch"
      description="Create a wallet-bound API key, submit one deterministic bundle for checks and review the prepared launch in your wallet."
      parentHref="/docs/creators"
      parentLabel="Creators"
      sections={sections}
      title="Launch a project"
    >
      <section id="access">
        <h2>Start here</h2>
        <p>
          Custom launch access is API-first. Connect the controller wallet,
          create a scoped API key and give it only to the agent or workflow that
          should prepare launches for that wallet.
        </p>
        <div className={docsStyles.callout}>
          <strong>The API does not control your wallet.</strong>
          <p>
            An API key can submit and read launch preparations. It cannot sign
            or broadcast the prepared transaction. The controller wallet must
            review and confirm the final action separately.
          </p>
        </div>
      </section>

      <section id="prepare">
        <h2>Prepare the project</h2>
        <ol className={docsStyles.steps}>
          <li>
            <strong>Build a deterministic source bundle.</strong>
            <span>
              Keep contracts, tests, deployment logic and public project data
              together in the bundle described by the API schema.
            </span>
          </li>
          <li>
            <strong>Run the project checks.</strong>
            <span>
              Compile, test and verify the graph bundle before sending it to the
              API. The API rechecks the declared manifest digest and exact graph
              bindings, but does not reproduce your build.
            </span>
          </li>
          <li>
            <strong>Bind the controller wallet.</strong>
            <span>
              The bundle&apos;s controller wallet and launch wallet must match the
              wallet that owns the API key.
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

      <section id="key">
        <h2>Create an API key</h2>
        <p>
          Connect the wallet that will control the launch and create a scoped
          key. The key receives only <code>custom-launch:create</code> and
          <code>custom-launch:read</code>. Save the secret when it is shown and
          keep it out of source control and public chats.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/developers/api-keys">Create a Custom launch API key</Link>
        </p>
      </section>

      <section id="submit">
        <h2>Submit the bundle</h2>
        <p>
          Send the source descriptor and executable graph bundle to the Custom
          Launch API with the key as a Bearer credential. The API validates the
          declared manifest commitment, wallet binding, graph, hook permissions
          and launch constraints before it prepares an action. It does not
          compile or simulate the submitted project.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/developers/machine-readable">
            Read the machine-readable API guide
          </Link>
        </p>
      </section>

      <section id="prepared">
        <h2>Prepared launch</h2>
        <p>
          A <code>prepared</code> result means the exact launch artifact exists.
          It is not a signed transaction, a broadcast, an approval, an audit or
          a safety claim. Read the launch status with the same API key and stop
          on any failed or mismatched check.
        </p>
      </section>

      <section id="launch">
        <h2>Wallet confirmation</h2>
        <p>
          Review the exact prepared action with the controller wallet. Only that
          wallet, or an agent separately authorized to use it, can sign and
          broadcast the transaction. The API key alone cannot do either.
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
