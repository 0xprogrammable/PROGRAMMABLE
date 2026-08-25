import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/developer-docs.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Custom Launch API · Programmable",
  description:
    "Package exact build artifacts locally and read existing wallet-bound V1 Custom launch history.",
  alternates: { canonical: "/docs/developers/custom-launch" },
};

const customLaunchSections = [
  { id: "quickstart", label: "Quickstart" },
  { id: "authentication", label: "Authentication" },
  { id: "request", label: "Request contract" },
  { id: "verification", label: "Exact-source verification" },
  { id: "checks", label: "Attested checks" },
  { id: "submit", label: "Write fence" },
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
    "CUSTOM_LAUNCH_V1_READ_ONLY is the permanent V1 POST result. Do not retry it.",
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
    "Honor Retry-After for reads. CUSTOM_LAUNCH_V2_UNAVAILABLE means the V2 release candidate remains held.",
  ],
] as const;

export default function CustomLaunchApiDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers/custom-launch"
      description="Package and validate exact launch artifacts locally, then read existing V1 launch history while public creation is held."
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
            V1 launch-history reads remain live, but V1 creation is read-only.
            The fee-enforced V2 release candidate remains held until canary and
            explicit public activation. Legacy Registry and GitHub submission
            intake is closed. Its separate{" "}
            <a href="/openapi/custom-launch-v2.json">
              V2 machine contract
            </a>{" "}
            is for offline and private-canary integration, not public
            authorization.
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
            wallet-bound key for existing history. Store it as{" "}
            <code>PROGRAMMABLE_API_KEY</code>.
          </li>
          <li>
            Run <code>status REQUEST_UUID --watch --until finalized</code> only
            for an existing V1 request. Do not run <code>submit</code> against
            V1; it receives non-retryable{" "}
            <code>409 CUSTOM_LAUNCH_V1_READ_ONLY</code>.
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
          <a href="/developers/custom-launch-api-v1.md">Open the raw V1 guide</a>
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
            Existing V1 keys can use <code>custom-launch:read</code>. A legacy
            <code>custom-launch:create</code> scope does not override the write
            fence. A key can access only requests owned by its bound wallet.
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
          <h2>Understand the retained V1 request contract</h2>
          <p>
            After successful authentication and scope checks,{" "}
            <code>POST /v1/custom-launches</code> returns{" "}
            <code>409 CUSTOM_LAUNCH_V1_READ_ONLY</code> before reading an
            idempotency key or body. The schema below remains available for
            compatibility with existing resources and local tooling.
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
          V1 nested field, enum and bound. The held V2 profile, exact runtime
          materialization and simulation response are defined separately in the{" "}
          <a href="/openapi/custom-launch-v2.json">V2 RC contract</a>.
        </p>

        <p className={styles.bodyCopy}>
          The public CLI derives every commitment from exact source, build and
          evidence files. It derives the full runtime hash only when deployed
          bytecode has no unresolved link or immutable references. Otherwise it
          fails closed with <code>RUNTIME_MATERIALIZATION_REQUIRED</code>.
        </p>
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
          <h2>Stop at the public write fence</h2>
          <p>
            V1 POST is not an active public creation path. Its authenticated
            result is <code>409 CUSTOM_LAUNCH_V1_READ_ONLY</code>.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            Do not retry, rotate a nonce or change request bytes to bypass the
            fence.
          </li>
          <li>
            V1 list and single-resource reads remain live. Honor{" "}
            <code>Retry-After</code> on read <code>429</code> or <code>503</code>.
          </li>
          <li>
            The V2 release candidate is not public. Until canary and public
            activation, unavailable V2 requests return{" "}
            <code>503 CUSTOM_LAUNCH_V2_UNAVAILABLE</code> with{" "}
            <code>Retry-After</code>.
          </li>
        </ul>

        <p className={styles.bodyCopy}>
          Service readiness does not activate a held write route. Wait for a
          versioned public V2 contract and explicit activation notice before
          treating launch creation as available.
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
              Inspect the held V2 RC contract
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
