import type { Metadata } from "next";
import Link from "next/link";

import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Launch a project · Programmable",
  description:
    "Package a Custom launch bundle locally and understand the held public creation boundary.",
  alternates: { canonical: "/docs/creators/launch" },
};

const sections = [
  { id: "access", label: "Start here" },
  { id: "prepare", label: "Prepare the project" },
  { id: "key", label: "Create an API key" },
  { id: "submit", label: "Public write fence" },
  { id: "prepared", label: "Prepared launch" },
  { id: "launch", label: "Wallet confirmation" },
  { id: "after", label: "After launch" },
] as const;

export default function CreatorLaunchDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/creators/launch"
      description="Package one deterministic bundle locally, then read existing V1 history while public launch creation is held."
      parentHref="/docs/creators"
      parentLabel="Creators"
      sections={sections}
      title="Launch a project"
    >
      <section id="access">
        <h2>Start here</h2>
        <p>
          Public Custom launch creation is currently held. You can package and
          validate locally, and use an existing scoped API key to read the
          bound wallet&apos;s existing V1 launch history.
        </p>
        <div className={docsStyles.callout}>
          <strong>The API does not control your wallet.</strong>
          <p>
            An API key can read its wallet-owned V1 launch history. A legacy
            create scope does not override the V1 write fence, and a key cannot
            authorize, sign or broadcast a wallet transaction.
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
          Connect the controller wallet to manage its scoped keys. Existing
          keys can use <code>custom-launch:read</code>; a legacy{" "}
          <code>custom-launch:create</code> scope does not reopen V1 creation.
          Keep every secret out of source control and public chats.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/developers/api-keys">Manage Custom launch API keys</Link>
        </p>
      </section>

      <section id="submit">
        <h2>Stop at the public write fence</h2>
        <p>
          Do not submit the bundle to V1. Authenticated{" "}
          <code>POST /v1/custom-launches</code> returns non-retryable{" "}
          <code>409 CUSTOM_LAUNCH_V1_READ_ONLY</code>. The fee-enforced V2
          release candidate returns <code>503 CUSTOM_LAUNCH_V2_UNAVAILABLE</code>{" "}
          with <code>Retry-After</code> until canary and public activation.
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
