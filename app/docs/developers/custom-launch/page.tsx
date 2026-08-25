import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/developer-docs.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Custom Launch API · Programmable",
  description:
    "Authenticate, submit and track one wallet-bound Custom launch through the V1 API.",
  alternates: { canonical: "/docs/developers/custom-launch" },
};

const customLaunchSections = [
  { id: "quickstart", label: "Quickstart" },
  { id: "authentication", label: "Authentication" },
  { id: "request", label: "Request contract" },
  { id: "checks", label: "Attested checks" },
  { id: "submit", label: "Submit and retry" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "discovery", label: "Explore, Profile and claims" },
  { id: "errors", label: "Errors" },
  { id: "extensions", label: "Future extensions" },
] as const;

const requestFields = [
  ["schemaVersion", "programmable.custom-launch-create-request.v1"],
  ["launchWallet", "The Ethereum wallet bound to the API key"],
  ["chainId", "String 1"],
  ["nonce", "A nonzero lowercase bytes32"],
  ["sourceDescriptor", "One DeterministicSourceBundleV2 descriptor"],
  [
    "sourceBundleManifest",
    "One complete, non-empty, UTF-8 path-sorted SourceBundleManifestV2",
  ],
  ["graphBundle", "One executable CustomGraphBundleV1"],
  ["agentAttestation", "One self-attestation for the exact graph subject"],
] as const;

const lifecycle = [
  ["received", "The request is durably accepted."],
  ["validating", "Request and graph validation are running."],
  [
    "prepared",
    "The exact artifact exists. output.signedPermit and output.walletTransaction are both null. There is nothing for the wallet to sign yet.",
  ],
  [
    "authorized",
    "The platform permit and exact output.walletTransaction exist. The controller wallet has not signed or broadcast it.",
  ],
  [
    "submitted",
    "Canonical Router event and same-block getter evidence match below 64 confirmations.",
  ],
  [
    "finalized",
    "The matching canonical evidence has at least 64 confirmations.",
  ],
  [
    "failed / cancelled",
    "The request is terminal. Read failure before deciding whether to create a new request.",
  ],
] as const;

const errors = [
  [
    "400",
    "Fix malformed JSON, fields, query values or the idempotency key before retrying.",
  ],
  ["401", "Use an active, unexpired and unrevoked pm_live_ key."],
  [
    "403",
    "Use a key with the required scope and the exact wallet named by the request.",
  ],
  [
    "404",
    "Verify the request UUID and key. Do not infer whether another wallet owns that ID.",
  ],
  [
    "409",
    "Replay an ambiguous request with its original body. For nonce conflict or permit expiry, use a new nonce and idempotency key as directed by the error code.",
  ],
  ["413", "Reduce the body below 2 MiB."],
  ["415", "Send Content-Type: application/json."],
  [
    "422",
    "Fix the reported manifest, graph, attestation or permit binding. Do not retry unchanged.",
  ],
  [
    "429",
    "Honor Retry-After. An exact replay does not consume reservation quota.",
  ],
  [
    "503",
    "Retry later. If create is ambiguous, keep the same idempotency key and identical body.",
  ],
] as const;

export default function CustomLaunchApiDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers/custom-launch"
      description="Submit one deterministic launch request, wait for an authorized wallet transaction and track the exact onchain result."
      kicker="Developer integration"
      parentHref="/docs/developers"
      parentLabel="Developers"
      sections={customLaunchSections}
      title="Custom Launch API"
    >
      <section id="quickstart">
        <div className={styles.sectionIntro}>
          <h2>Quickstart</h2>
          <p>
            Create a key, generate <code>launch.json</code> from the built
            project, submit it and wait for the controller wallet transaction.
            The API key never signs or broadcasts that transaction.
          </p>
        </div>

        <ol className={styles.steps}>
          <li>
            Build and test the hook and every launch component. The{" "}
            <a href="https://github.com/0xprogrammable/Hookbuilder-Skill">
              Hookbuilder-Skill
            </a>{" "}
            is an optional way to build and check the project.
          </li>
          <li>
            Generate <code>launch.json</code> from that exact build with the
            project&apos;s packaging tooling, then validate it against the{" "}
            <a href="/openapi/custom-launch-v1.json">OpenAPI contract</a>.
          </li>
          <li>
            Connect the controller wallet at{" "}
            <Link href="/developers/api-keys">API keys</Link>, create a key and
            submit <code>launch.json</code> with a stable idempotency key.
          </li>
          <li>
            Poll the request until it is <code>authorized</code>. The controller
            wallet then reviews, signs and broadcasts{" "}
            <code>output.walletTransaction</code>. Keep polling until the request
            is <code>finalized</code> or terminally failed.
          </li>
        </ol>

        <aside className={styles.callout}>
          <strong>Generate the request from the exact project</strong>
          <p>
            <code>launch.json</code> contains project-specific bytecode,
            addresses, permission bits and hashes from one exact build.
            Generate it from the project being launched.{" "}
            {"Do not copy test-only hashes or another project's file."}
          </p>
        </aside>

        <p className={styles.inlineAction}>
          <a href="/developers/custom-launch-api-v1.md">Open the raw V1 guide</a>
        </p>
      </section>

      <section id="authentication">
        <div className={styles.sectionIntro}>
          <h2>Keep wallet and API authentication separate</h2>
        </div>

        <ul className={styles.checkList}>
          <li>
            Connect the controller wallet on <code>programmable.market</code> to
            create, list or revoke its keys.
          </li>
          <li>
            Send <code>Authorization: Bearer pm_live_...</code> only to{" "}
            <code>https://api.programmable.market</code>.
          </li>
          <li>
            Do not send the website wallet session token to the Custom Launch
            API.
          </li>
          <li>
            V1 keys have <code>custom-launch:create</code> and{" "}
            <code>custom-launch:read</code>. A key can access only requests owned
            by its bound wallet.
          </li>
          <li>
            Store the secret outside source control and logs. Key lists never
            return the full secret again.
          </li>
        </ul>

        <p className={styles.bodyCopy}>
          The V1 contract states a 90-day default expiry, a 366-day maximum and
          no more than 10 active keys per wallet.
        </p>
      </section>

      <section id="request">
        <div className={styles.sectionIntro}>
          <h2>Use the closed request contract</h2>
          <p>
            <code>POST /v1/custom-launches</code> accepts a JSON object up to 2
            MiB with all eight fields.
          </p>
        </div>

        <dl className={`${styles.dataList} ${styles.technicalData}`}>
          {requestFields.map(([field, requirement]) => (
            <div key={field}>
              <dt>
                <code>{field}</code>
              </dt>
              <dd>{requirement}</dd>
            </div>
          ))}
        </dl>

        <p className={styles.bodyCopy}>
          The platform recomputes the manifest digest and checks that the source
          descriptor, manifest and graph name the same source bundle. The graph
          accepts 1 to 16 acyclic targets, exactly one token target and one hook
          target. The complete graph input is limited to 524,288 bytes;
          per-target init code is limited to 49,152 bytes and initializer
          calldata to 131,072 bytes. Use the{" "}
          <a href="/openapi/custom-launch-v1.json">OpenAPI contract</a> for every
          nested field, enum and bound.
        </p>

        <aside className={styles.callout}>
          <strong>Validation is not source verification</strong>
          <p>
            The platform does not fetch source files, reproduce dependencies,
            compile the project, prove source-to-bytecode correspondence,
            simulate the transaction, audit the project or attest safety.
          </p>
        </aside>
      </section>

      <section id="checks">
        <div className={styles.sectionIntro}>
          <h2>Attest the checks you ran</h2>
          <p>
            <code>agentAttestation</code> requires the exact schema version,
            canonical graph hash, agent identifier, canonical UTC timestamp and
            1 to 64 unique <code>{"{ checkId, evidenceSha256 }"}</code> entries.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          V1 does not publish a universal check-ID catalog or define
          project-independent pass/fail semantics for those IDs. The submitting
          workflow chooses stable IDs for checks it actually ran, preserves the
          underlying evidence and attests each <code>sha256:</code> digest.
          Programmable validates shape, digest presence and graph-subject
          binding; it does not fetch or assess the evidence or adopt the
          attestation as its own claim.
        </p>
      </section>

      <section id="submit">
        <div className={styles.sectionIntro}>
          <h2>Submit and retry safely</h2>
          <p>
            <code>Idempotency-Key</code> must contain 16 to 128 characters from{" "}
            <code>[A-Za-z0-9._:-]</code>.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>A new request returns <code>202</code>.</li>
          <li>
            An identical replay may return <code>200</code> with the original
            resource.
          </li>
          <li>
            After an ambiguous timeout or <code>503</code>, retry with the same
            key and byte-identical body.
          </li>
          <li>
            Reusing the key with a changed body returns{" "}
            <code>409 IDEMPOTENCY_CONFLICT</code>.
          </li>
          <li>
            A conflicting wallet nonce returns <code>409 NONCE_CONFLICT</code>.
            An expired permit requires a new request with a new nonce and
            idempotency key.
          </li>
        </ul>

        <p className={styles.bodyCopy}>
          The V1 contract states limits of 30 new reservations per rolling hour
          and 100 per rolling day for the wallet principal and route. Exact
          idempotent replays bypass quota. For <code>429</code>, wait for the{" "}
          <code>Retry-After</code> delay.
        </p>
      </section>

      <section id="lifecycle">
        <div className={styles.sectionIntro}>
          <h2>Track the resource, not an assumed transaction</h2>
          <p>
            Read <code>GET /v1/custom-launches/{"{launchId}"}</code> with the same
            Bearer key. The path value and resource <code>requestId</code> are
            the API request UUID; <code>onchainLaunchId</code> is the distinct
            Router <code>bytes32</code> identifier.
          </p>
        </div>

        <dl className={styles.resultList}>
          {lifecycle.map(([status, meaning]) => (
            <div key={status}>
              <dt>
                <code>{status}</code>
              </dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>

        <p className={styles.bodyCopy}>
          After wallet broadcast, poll the single-resource route to drive exact
          reconciliation. <code>GET /v1/custom-launches</code> is a newest-first
          wallet-owned history view with bounded summaries; its{" "}
          <code>output</code> is always <code>null</code>. Use the single-resource
          route for the artifact, wallet transaction and durable failure.
        </p>

        <aside className={styles.callout}>
          <strong>API access is not wallet authorization</strong>
          <p>
            The API key authorizes only the API request. It is never proof that
            the controller wallet approved the transaction.
          </p>
        </aside>
      </section>

      <section id="discovery">
        <div className={styles.sectionIntro}>
          <h2>Keep discovery and claims separate</h2>
        </div>

        <ul className={styles.checkList}>
          <li>
            A finalized Router launch is eligible for Explore and the connected
            wallet&apos;s Profile after website discovery data refreshes. Finality
            is not an immediate listing SLA.
          </li>
          <li>
            Router provenance does not require a Custom Registry record.
            Third-party discovery remains controlled by each indexer.
          </li>
          <li>
            Router provenance alone does not create a claim route. Only
            explicitly supported fee models appear in the current website claim
            flow; an arbitrary Custom hook is not automatically claimable.
          </li>
          <li>
            V1 scopes <code>fees:claim</code> and{" "}
            <code>buybacks:manage</code> are reserved and disabled.
          </li>
        </ul>
      </section>

      <section id="errors">
        <div className={styles.sectionIntro}>
          <h2>Handle errors by status and code</h2>
        </div>

        <dl className={styles.resultList}>
          {errors.map(([status, recovery]) => (
            <div key={status}>
              <dt>
                <code>{status}</code>
              </dt>
              <dd>{recovery}</dd>
            </div>
          ))}
        </dl>

        <p className={styles.bodyCopy}>
          In an HTTP error, <code>error.requestId</code> is a correlation ID for
          that response. It is not the Custom launch resource{" "}
          <code>requestId</code>. A resource-level <code>failure</code> is the
          durable lifecycle failure for that launch request.
        </p>
      </section>

      <section id="extensions">
        <div className={styles.sectionIntro}>
          <h2>Treat future capabilities as separate contracts</h2>
          <p>
            Only operations and scopes in the current OpenAPI contract are
            active. New scopes or endpoints require an explicit contract update,
            and existing keys do not gain a newly enabled scope automatically.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          Wallet signing, fee claims, buyback management, reusable-template
          publication and source review are not granted by the V1 Custom Launch
          API.
        </p>
      </section>

      <nav
        aria-label="Continue developer integration"
        className={styles.nextLinks}
      >
        <p>Continue</p>
        <ul>
          <li>
            <Link href="/developers/api-keys">Create or manage API keys</Link>
          </li>
          <li>
            <a href="/openapi/custom-launch-v1.json">Open the V1 contract</a>
          </li>
          <li>
            <Link href="/docs/developers/verify">Verify a token or pool</Link>
          </li>
          <li>
            <Link href="/docs/developers/indexing">Index new launches</Link>
          </li>
        </ul>
      </nav>
    </DocsShell>
  );
}
