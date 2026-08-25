import type { Metadata } from "next";
import Link from "next/link";

import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Launch a project · Programmable",
  description:
    "Package, submit and track a deterministic Custom launch bundle.",
  alternates: { canonical: "/docs/creators/launch" },
};

const sections = [
  { id: "access", label: "Start here" },
  { id: "prepare", label: "Prepare the project" },
  { id: "key", label: "Create an API key" },
  { id: "submit", label: "Submit safely" },
  { id: "prepared", label: "Prepared launch" },
  { id: "launch", label: "Wallet confirmation" },
  { id: "after", label: "After launch" },
] as const;

export default function CreatorLaunchDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/creators/launch"
      description="Package one deterministic bundle locally, submit the exact V2 request and stop for separate wallet review."
      parentHref="/docs/creators"
      parentLabel="Creators"
      sections={sections}
      title="Launch a project"
    >
      <section id="access">
        <h2>Start here</h2>
        <p>
          Public V2 Custom launch creation is live on Ethereum Mainnet. Package
          and validate locally, then use a scoped API key to submit and track
          the bound wallet&apos;s request.
        </p>
        <div className={docsStyles.callout}>
          <strong>The API does not control your wallet.</strong>
          <p>
            An API key can use its authorized API operations for the bound
            wallet. It cannot authorize, sign or broadcast a wallet transaction.
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
      </section>

      <section id="key">
        <h2>Manage an API key</h2>
        <p>
          Connect the controller wallet to manage its scoped keys. Use only the
          authorized V2 operations for that bound wallet. API scopes never
          grant wallet signing. Keep every secret out of source control and
          public chats.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/developers/api-keys">Manage Custom launch API keys</Link>
        </p>
      </section>

      <section id="submit">
        <h2>Submit the exact V2 request</h2>
        <p>
          Use <code>POST /v2/custom-launches</code>. Preserve the exact request
          bytes and idempotency key across timeout, <code>429</code> and{" "}
          <code>503</code> retries, and honor <code>Retry-After</code>.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/developers/custom-launch">
            Read the Custom Launch API guide
          </Link>
        </p>
      </section>

      <section id="prepared">
        <h2>Prepared launch</h2>
        <p>
          A <code>prepared</code> result means the exact launch artifact exists.
          Its signed permit and wallet transaction are still null. It is not a
          wallet authorization, approval, audit or safety claim. Read the launch
          status with the same API key and stop on any failed or mismatched
          binding.
        </p>
      </section>

      <section id="launch">
        <h2>Wallet confirmation</h2>
        <p>
          Wait for <code>authorized</code>, then review the exact permit-attached
          transaction with the controller wallet. Only that wallet, or an agent
          separately authorized to use it, can sign and broadcast. The API key
          alone cannot do either.
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
            new launch subject.
          </li>
        </ul>
      </section>
    </DocsShell>
  );
}
