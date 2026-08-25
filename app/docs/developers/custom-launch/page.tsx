import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/developer-docs.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Custom Launch API · Programmable",
  description:
    "Package, submit and track deterministic wallet-bound Custom launches on Ethereum Mainnet.",
  alternates: { canonical: "/docs/developers/custom-launch" },
};

const customLaunchSections = [
  { id: "quickstart", label: "Quickstart" },
  { id: "authentication", label: "Authentication" },
  { id: "request", label: "Request contract" },
  { id: "fees", label: "Rev3 fee policy" },
  { id: "verification", label: "Exact-source verification" },
  { id: "checks", label: "Attested checks" },
  { id: "submit", label: "Submit safely" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "discovery", label: "Explore, Profile and claims" },
  { id: "errors", label: "Errors" },
  { id: "extensions", label: "Future extensions" },
] as const;

const requestFields = [
  ["schemaVersion", "programmable.custom-launch-create-request.v2"],
  ["launchWallet", "The Ethereum wallet bound to the API key"],
  ["chainId", "String 1"],
  ["nonce", "A nonzero lowercase bytes32"],
  ["sourceDescriptor", "One DeterministicSourceBundleV2 descriptor"],
  [
    "sourceBundleManifest",
    "One complete, non-empty, UTF-8 path-sorted SourceBundleManifestV2",
  ],
  ["graphBundle", "One executable CustomGraphBundleV1"],
  ["launchProfile", "The complete closed Rev3 production profile"],
  ["launchProfileSelection", "The exact target-role and deployment bindings"],
  ["launchProfileHash", "The CLI-derived canonical Rev3 profile digest"],
  ["launchIntentHash", "The CLI-derived request intent digest"],
  ["agentAttestation", "One self-attestation for the exact launch intent"],
  ["verificationBundle", "Exact source, compiler and constructor bindings"],
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
    "Keep the original idempotency key and bytes. A conflicting binding must be fixed locally, not retried with changed bytes.",
  ],
  ["413", "Reduce the body to at most 8,388,608 bytes."],
  ["415", "Send Content-Type: application/json."],
  [
    "422",
    "Fix the reported source, graph, attestation, verification or permit binding. Do not retry unchanged.",
  ],
  [
    "429",
    "Honor Retry-After. An exact replay does not consume reservation quota.",
  ],
  [
    "503",
    "Honor Retry-After and retry only the byte-identical request. Service availability never grants wallet signing authority.",
  ],
] as const;

export default function CustomLaunchApiDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers/custom-launch"
      description="Package exact launch artifacts locally, submit byte-identical V2 requests, and stop for separate controller-wallet review and signing."
      kicker="Developer integration"
      parentHref="/docs/developers"
      parentLabel="Developers"
      sections={customLaunchSections}
      title="Custom Launch API"
    >
      <p className={styles.bodyCopy}>
        Public V2 is the creation contract. V1 history remains readable, while
        V1 creation is permanently write fenced with the nonretryable error{" "}
        <code>CUSTOM_LAUNCH_V1_READ_ONLY</code>.
      </p>

      <section id="quickstart">
        <div className={styles.sectionIntro}>
          <h2>Quickstart</h2>
          <p>
            Public V2 launch creation is live on Ethereum Mainnet. V1 history
            reads remain available, while V1 creation stays read-only. Legacy
            Registry and GitHub submission intake is closed. Use the{" "}
            <a href="/openapi/custom-launch-v2.json">
              public V2 machine contract
            </a>{" "}
            for the exact request, response and retry contract.
          </p>
        </div>

        <ol className={styles.steps}>
          <li>
            Build and test the hook and every launch component from one exact
            source revision.
          </li>
          <li>
            Install <code>@programmable/launch</code> from the versioned GitHub
            Release asset linked in the raw guide. The binary is{" "}
            <code>programmable-launch</code>.
          </li>
          <li>
            Run <code>pack</code> and <code>validate</code> against exact
            Standard JSON, compiler artifacts and evidence files. Never enter
            derived hashes by hand.
          </li>
          <li>
            Use <Link href="/developers/api-keys">API keys</Link> to manage the
            wallet-bound key. Store it as{" "}
            <code>PROGRAMMABLE_API_KEY</code>.
          </li>
          <li>
            Run <code>submit ./launch.json --config programmable-launch.config.json</code>.
            At <code>authorized</code>, stop for exact wallet review and signing,
            then run <code>status REQUEST_UUID --watch --until finalized</code>.
          </li>
        </ol>

        <aside className={styles.callout}>
          <strong>Generate the request from the exact project</strong>
          <p>
            The CLI derives the sorted manifest, SourceDescriptor, graph,
            locators, CREATE2 addresses, canonical hashes and verification
            metadata. Do not copy test-only hashes or another project&apos;s file.
          </p>
        </aside>

        <p className={styles.inlineAction}>
          <a href="/developers/custom-launch-api-v1.md">Open the raw compatibility guide</a>
        </p>
      </section>

      <section id="authentication">
        <div className={styles.sectionIntro}>
          <h2>Keep wallet and API authentication separate</h2>
        </div>

        <ul className={styles.checkList}>
          <li>
            The CLI writes a mode <code>0600</code> journal before the first
            request and binds the Idempotency-Key to exact request bytes. It
            never writes the API key.
          </li>
          <li>
            Connect the controller wallet on <code>programmable.market</code> to
            list or revoke its keys.
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
            A key can access only requests owned by its bound wallet. API
            scopes grant API operations only; they never grant wallet signing.
          </li>
          <li>
            Store the secret outside source control and logs. Key lists never
            return the full secret again. Put only{" "}
            <code>$PROGRAMMABLE_API_KEY</code> in chat, prompts and agent setup.
          </li>
        </ul>

        <p className={styles.bodyCopy}>
          The V1 contract states a 90-day default expiry, a 366-day maximum and
          no more than 10 active keys per wallet.
        </p>
      </section>

      <section id="request">
        <div className={styles.sectionIntro}>
          <h2>Understand the public V2 request contract</h2>
          <p>
            <code>POST /v2/custom-launches</code> accepts only the closed,
            byte-bound Rev3 request. V1 remains available for existing history;
            its POST route stays read-only.
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
          <a href="/openapi/custom-launch-v2.json">V2 OpenAPI contract</a> for every
          nested field, enum and bound. The retained{" "}
          <a href="/openapi/custom-launch-v1.json">V1 contract</a> documents
          compatibility reads and its read-only creation route.
        </p>

        <p className={styles.bodyCopy}>
          The public CLI derives every commitment from exact source, build and
          evidence files. It derives the full runtime hash only when deployed
          bytecode has no unresolved link or immutable references. Otherwise it
          fails closed with <code>RUNTIME_MATERIALIZATION_REQUIRED</code>.
        </p>
      </section>

      <section id="fees">
        <div className={styles.sectionIntro}>
          <h2>Review the Rev3 fee policy</h2>
          <p>
            The frozen Rev3 profile is public on Ethereum Mainnet only
            (<code>chainId: &quot;1&quot;</code>) and has{" "}
            <code>productionLaunchAuthorized: true</code>.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          For each successful swap, the mandatory platform charge is 1,000
          parts per 1,000,000 of the documented{" "}
          <code>gross-unspecified-pool-currency-amount</code> basis:{" "}
          <code>1,000 ppm = 0.10% = 10 bps</code>. It accrues in the
          profile&apos;s unspecified pool currency to{" "}
          <code>0x4957f49620AFf3Adbbe8195a4f633E49cc93376c</code>.
          The frozen profile enforces this path independently of custom
          behavior; a Custom module cannot reduce or redirect it. A reverted
          swap rolls back the fee with the rest of the transaction.
        </p>

        <aside className={styles.callout}>
          <strong>Keep platform, LP and future operations separate</strong>
          <p>
            The pool&apos;s LP fee is separate from this platform charge and must
            be disclosed separately. Generic fee claiming and buyback
            management for arbitrary hooks are not live. The reserved{" "}
            <code>fees:claim</code> and <code>buybacks:manage</code> scopes remain
            disabled.
          </p>
        </aside>
      </section>

      <section id="verification">
        <div className={styles.sectionIntro}>
          <h2>Bind exact source and follow server-authored status</h2>
          <p>
            Optional <code>verificationBundle</code> binds exact UTF-8 Solidity
            Standard JSON bytes, their SHA-256, the exact solc build, source and
            contract identity and resolved constructor arguments to the
            prepared artifact.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          Standard JSON sources contain inline <code>content</code>; URL-only
          sources fail. Compilation units and components are uniquely UTF-8
          sorted, and components exactly cover the graph. Existing legacy
          resources without a bundle remain readable and unverified.
        </p>

        <aside className={styles.callout}>
          <strong>Exact match is server-authored</strong>
          <p>
            After finality, provider verification runs independently. Only
            literal <code>exact_match</code> for every component means Source
            verified. Clients must not submit or infer that state. Explorer
            failure never blocks or revises launch finality.
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
          <h2>Submit byte-identical requests</h2>
          <p>
            Use <code>POST /v2/custom-launches</code>. The CLI persistently binds
            the idempotency key to the exact request bytes before network access.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            On timeout, <code>429</code> or <code>503</code>, retry only the exact
            persisted bytes and honor <code>Retry-After</code>.
          </li>
          <li>
            A byte-identical replay can return the existing resource. A reused
            key bound to different bytes is a conflict.
          </li>
          <li>
            Stop at <code>authorized</code>. The API and CLI never sign or
            broadcast the returned transaction.
          </li>
        </ul>

        <p className={styles.bodyCopy}>
          Service readiness and API authorization do not replace controller
          approval. The connected wallet must review the exact chain, sender,
          Router, value and calldata before a separate signature.
        </p>

        <p className={styles.bodyCopy}>
          New V2 requests share a durable global admission cap of 120 created
          requests per hour and 500 per day. An exact idempotent replay is
          checked first and consumes no additional capacity.
        </p>
      </section>

      <section id="lifecycle">
        <div className={styles.sectionIntro}>
          <h2>Track the resource, not an assumed transaction</h2>
          <p>
            Read <code>GET /v2/custom-launches/{"{launchId}"}</code> with the same
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
          reconciliation. <code>GET /v2/custom-launches</code> is a newest-first
          wallet-owned history view with bounded summaries; its{" "}
          <code>output</code> is always <code>null</code>. Use the single-resource
          route for the artifact, wallet transaction and durable failure.
        </p>

        <aside className={styles.callout}>
          <strong>API access is not wallet authorization</strong>
          <p>
            At <code>authorized</code>, review and sign in the connected
            controller wallet. The API and CLI never auto-sign or
            auto-broadcast. The API key is never proof of wallet approval.
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
            FADE uses a specifically bound adapter. That does not create generic
            fee claiming or buyback management for arbitrary hooks.
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

        <p className={styles.bodyCopy}>
          Check <a href="https://api.programmable.market/readyz">API readiness</a>.
          For support, send only the public request ID, HTTP status, UTC time and
          error code. Never send the API key.
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
          Generic fee claims, buyback management, reusable-template publication
          and a public Hookbuilder are not granted by the V1 Custom Launch API.
          Reserved scopes promise no future behavior.
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
            <a href="/openapi/custom-launch-v2.json">
              Inspect the public V2 contract
            </a>
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
