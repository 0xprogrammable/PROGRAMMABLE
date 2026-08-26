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
  { id: "existing-project-integration", label: "Existing projects" },
  { id: "v3-general", label: "V3 general hooks" },
  { id: "liquidity", label: "Liquidity and limits" },
  { id: "request", label: "Request contract" },
  { id: "fees", label: "Platform fee policy" },
  { id: "verification", label: "Exact-source verification" },
  { id: "checks", label: "Attested checks" },
  { id: "submit", label: "Submit safely" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "discovery", label: "Explore, Profile and claims" },
  { id: "errors", label: "Errors" },
  { id: "extensions", label: "Future extensions" },
] as const;

const requestFields = [
  ["schemaVersion", "programmable.custom-launch-create-request.v3"],
  ["launchWallet", "The Ethereum wallet bound to the API key"],
  ["chainId", "String 1"],
  ["nonce", "A nonzero lowercase bytes32"],
  ["sourceDescriptor", "One DeterministicSourceBundleV2 descriptor"],
  [
    "sourceBundleManifest",
    "One complete, non-empty, UTF-8 path-sorted SourceBundleManifestV2",
  ],
  ["graphBundle", "One executable CustomGraphBundleV1"],
  ["permitWindow", "The bounded Router permit validity window"],
  ["launchProfile", "The complete general hook profile"],
  ["launchProfileSelection", "The exact target-role and deployment bindings"],
  ["launchProfileHash", "The CLI-derived canonical profile digest"],
  ["launchIntentHash", "The CLI-derived request intent digest"],
  ["agentAttestation", "One self-attestation for the exact launch intent"],
  ["verificationBundle", "Exact source, compiler and constructor bindings"],
] as const;

const lifecycle = [
  ["received", "The request is durably accepted."],
  ["validating", "Request and graph validation are running."],
  [
    "pending_review",
    "Exact-source admission or Router preparation is still running. No wallet transaction exists.",
  ],
  [
    "action_required",
    "One of the current profile's exact hard-blocking code-and-role rules matched. Read the exact bound report and contact support with the request ID when directed. This is not a wallet-signing stage.",
  ],
  [
    "awaiting_funding_authorization",
    "EIP-3009 mode only: review and sign the exact typed data in the connected controller wallet.",
  ],
  [
    "funding_authorization_verified",
    "The separate funding signature was verified and final calldata construction can continue.",
  ],
  ["simulating", "The final graph and exact Router transaction are being simulated."],
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

const cliInstallCommands = [
  [
    'programmable_cli_dir="$(mktemp -d)"',
    "Create an isolated download directory.",
  ],
  [
    'curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.1.tgz" https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.1/programmable-launch-3.3.1.tgz',
    "Download the pinned release asset.",
  ],
  [
    'curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.1.tgz.sha256" https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.1/programmable-launch-3.3.1.tgz.sha256',
    "Download its checksum sidecar.",
  ],
  [
    '(cd "$programmable_cli_dir" && shasum -a 256 -c programmable-launch-3.3.1.tgz.sha256)',
    "Continue only after this reports OK.",
  ],
  [
    'npm install --global "$programmable_cli_dir/programmable-launch-3.3.1.tgz"',
    "Install the verified local bytes.",
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
  [
    "500",
    "Keep error.requestId for support and preserve the original request-byte binding.",
  ],
] as const;

export default function CustomLaunchApiDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers/custom-launch"
      description="Package exact launch artifacts locally, submit byte-identical V3 requests, and stop for separate controller-wallet review and signing."
      kicker="Developer integration"
      parentHref="/docs/developers"
      parentLabel="Developers"
      sections={customLaunchSections}
      title="Custom Launch API"
    >
      <p className={styles.bodyCopy}>
        Public V3 is the general custom-hook creation contract. V2 and V1
        history remain readable, while
        V1 creation is permanently write fenced with the nonretryable error{" "}
        <code>CUSTOM_LAUNCH_V1_READ_ONLY</code>.
      </p>

      <section id="quickstart">
        <div className={styles.sectionIntro}>
          <h2>Quickstart</h2>
          <p>
            Public V3 launch creation is live on Ethereum Mainnet. V1 history
            reads remain available, while V1 creation stays read-only. Legacy
            Registry and GitHub submission intake is closed. Use the{" "}
            <a href="/openapi/custom-launch-v3.json">
              public V3 machine contract
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
            Install <code>@programmable/launch</code> 3.3.1 from the{" "}
            <a href="https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.1/programmable-launch-3.3.1.tgz">
              immutable GitHub Release asset
            </a>
            . The binary is{" "}
            <code>programmable-launch</code>.
          </li>
          <li>
            Run <code>pack</code> and <code>validate --remote</code> against exact
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
            Follow <code>pack -&gt; validate --remote -&gt; submit -&gt; wallet -&gt; status</code>.
            Wallet is a separate controller action, not a CLI command. At <code>authorized</code>, stop for exact wallet review and signing,
            then run <code>status REQUEST_UUID --watch --until finalized</code>.
          </li>
        </ol>

        <ul className={styles.codeList}>
          {cliInstallCommands.map(([command, description]) => (
            <li key={command}>
              <code>{command}</code>
              <span>{description}</span>
            </li>
          ))}
        </ul>

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

      <section id="existing-project-integration">
        <div className={styles.sectionIntro}>
          <h2>Integrate an existing project without private instructions</h2>
          <p>
            An API key authorizes operations for its bound wallet. It does not
            contain policy or project instructions. Every cold agent starts at{" "}
            <a href="/.well-known/programmable.json">
              <code>/.well-known/programmable.json</code>
            </a>
            , reads <code>customLaunchApi.agentIntegration</code>, then fetches
            the advertised public contracts.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            Use the{" "}
            <a href="/policies/custom-launch-agent-remediation-v1.json">
              machine-readable remediation catalog
            </a>{" "}
            to inspect the exact repository, create{" "}
            <code>programmable-launch.config.json</code> and recover from local
            or API findings. The same catalog applies to every project; there
            is no project allowlist or private approval route.
          </li>
          <li>
            Pin the public source repository and exact immutable Git object,
            compile every target with{" "}
            <code>solc 0.8.26+commit.8a97fa7a</code>, identify the distinct
            token, hook and initializer roles, map address dependencies, and
            declare the real hook permissions, pool, funding, liquidity, fee,
            custody and withdrawal behavior.
          </li>
          <li>
            Create a <code>programmable.launch-pack-config.v3</code> input from
            exact source, Standard JSON, artifacts and structured ABI values,
            following the{" "}
            <a href="/schemas/custom-launch/v3/pack-config.json">
              machine-readable pack-config schema
            </a>
            . The CLI derives every digest, locator, CREATE2 address and request
            byte. Never copy or invent them.
          </li>
          <li>
            Fetch public <code>GET /v3/capabilities</code>, then run the exact
            request through <code>validate --remote</code>. The authenticated
            <code> POST /v3/custom-launches/preflight</code> uses those same bytes,
            consumes no launch quota, allocates no nonce, persists no launch and
            never signs or broadcasts. It returns additive
             <code> riskClassification</code>, platform-owned
             <code> behaviorEvidence</code> and all six
             <code> productTruthAxes</code>: <code>deployment</code>,{" "}
             <code>trading</code>, <code>platform_fee_evidence</code>,{" "}
             <code>source_verification</code>, <code>indexing</code> and{" "}
             <code>featured</code>. A not-executed behavior vector remains
             outstanding; it is not a caller-declared pass.
          </li>
          <li>
            In EIP-3009 mode, accept the exact CLI-derived funding descriptor.
            Do not replace its funding intent or nonce domain. Current V2
            authorization patching binds four zero ABI leaves:{" "}
            <code>bytes32 nonce</code>, <code>bytes32 r</code>,{" "}
            <code>bytes32 s</code> and <code>uint8 v</code>. Configure their
            numeric ABI argument paths with 1–16 indices from 0 through 255.
            Static tuple and fixed-array descendants are supported; dynamic
            parents and applicant-supplied calldata offsets are not.
          </li>
          <li>
            Tooling may report{" "}
            <code>FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED</code> or{" "}
            <code>FUNDING_NONCE_CONFORMANCE_UNPROVEN</code> when exact source,
            ABI and compiler artifacts cannot prove the complete nonce dataflow
            offline. Inspect a suspected conflict. The mandatory exact Router
            simulation is the final execution-compatibility detector, not a
            safety, admission, liquidity or fee-behavior claim.
          </li>
          <li>
            Pool initialization does not add liquidity, and trading volume
            cannot create the initial liquidity from nothing. Select the exact
            external, launch-seeded or hook-inventory model implemented by the
            project. V3 does not inject Classic liquidity automatically.
          </li>
          <li>
            Admission is automatic. At <code>action_required</code>, read the
            exact single-resource remediation, fix the reported target and
            source or config, rebuild, repack and submit a new immutable
            request. Retrying unchanged bytes or requesting a manual allowlist
            cannot bypass a blocking finding.
          </li>
        </ul>

        <aside className={styles.callout}>
          <strong>One public contract for every project</strong>
          <p>
            Discovery, the remediation catalog, this guide, OpenAPI and the
            pinned CLI release provide the complete public handoff. Only the
            two controller-wallet signatures remain outside the agent flow.
          </p>
        </aside>
      </section>

      <section id="v3-general">
        <div className={styles.sectionIntro}>
          <h2>Use the general V3 hook profile</h2>
          <p>
            The versioned{" "}
            <a href="/openapi/custom-launch-v3.json">
              direct-native V3 OpenAPI document
            </a>{" "}
            is the production contract for project-owned tokens, hooks and
            multi-contract launch graphs. The default profile uses{" "}
            <code>programmable.direct-native-hook-graph-profile.v3</code>,{" "}
            <code>profileRevision: 3</code> and{" "}
            <code>profileVersion: 3.1.0</code>. Its selection uses{" "}
            <code>
              programmable.direct-native-hook-graph-profile-selection-binding.v3
            </code>
            . Exact 3.0.0 requests remain readable and byte-identical retryable
            under their original immutable policy. Revision 2 also remains
            compatible; do not reinterpret its receipt as revision-3 admission.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            The Router supports 2–16 targets, while this profile requires 3–16
            because token, hook and initializer roles are distinct. All fourteen
            Uniswap v4 permission bits are supported, including custom-accounting
            return deltas, provided the declared mask, compiled permissions and
            low address bits match exactly.
          </li>
          <li>
            The 10 bps Programmable share may be additive or included in the
            selected total. The declared economics are bound to the launch
            intent. Revision 3 does not issue a fee-conformance certification;
            it requires role-aware static admission and final Router simulation
            before its permit signer is called. Static fees and the{" "}
            <code>0x800000</code> dynamic-fee sentinel are supported.
          </li>
          <li>
            Native and ERC-20 quote currencies are structurally supported.
            Funding can be absent, carried as the exact native value of the
            separately reviewed Router transaction, or use an unsigned USDC
            EIP-3009 descriptor. Only the EIP-3009 mode contains a funding
            challenge and authorization patch. CLI 3.3.1 uses{" "}
            <code>programmable.eip3009-authorization-patch.v2</code> to bind
            the zero nonce, r, s and v ABI leaves before any wallet signature.
          </li>
          <li>
            For EIP-3009 funding, the website first validates and explicitly asks
            for <code>eth_signTypedData_v4</code>. Only after backend signature
            verification, final calldata construction and simulation does it
            present a separately reviewed Router transaction. Neither action
            is auto-signed or auto-broadcast.
          </li>
          <li>
            Initializer source, build, runtime, unsigned patch, final calldata
            and simulation are exact per-launch bindings. There is no separate
            global initializer trust root.
          </li>
          <li>
            Profile 3.1.0 binds every static finding but hard-blocks only seven
            objective code-and-role conditions: CALLCODE, source or runtime
            SELFDESTRUCT, definitively missing or invalid callback authentication,
            a literal wrong PoolManager, or a missing enabled callback. Proxy,
            delegatecall, mint, tax, pause, liquidity and return-delta surfaces
            require evidence instead of categorical rejection. Hard-blocking
            matches return <code>action_required</code>; all other findings remain
            visible as needs-evidence or warning conditions. There is no manual
            project allowlist.
          </li>
          <li>
            Every enabled v4 permission must resolve to a concrete reachable
            callback implementation. An interface declaration or fallback-only
            route does not qualify.
          </li>
          <li>
            With no blocking match, server-authored{" "}
            <code>platformAdmission</code> binds the report hash and warning
            codes with <code>no_blocking_static_finding</code>, requires Router
            simulation and carries <code>safetyClaim: false</code> and{" "}
            <code>feeBehaviorClaim: false</code>.
          </li>
        </ul>
      </section>

      <section id="liquidity">
        <div className={styles.sectionIntro}>
          <h2>Choose liquidity and controls explicitly</h2>
          <p>
            Pool initialization sets a Uniswap v4 starting price but does not
            add liquidity. The project graph owns the liquidity design.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            The CLI binds one explicit model into the request hash: external
            concentrated liquidity remains <code>liquidity_required</code>;
            launch-seeded and hook-inventory custom accounting remain{" "}
            <code>assessment_required</code> until separate exact evidence
            exists. A project cannot declare its own pass.
          </li>
          <li>
            Ordinary concentrated liquidity requires the project to fund and
            create a position. Trading volume cannot create initial liquidity
            from nothing. Position custody, withdrawal and any lock or burn
            must be disclosed.
          </li>
          <li>
            Zero classical LP works only when the project hook and initializer
            implement custom accounting or hold inventory that can exchange
            against incoming assets. Funding mode <code>none</code> does not
            make an empty ordinary pool liquid.
          </li>
          <li>
            Exact-source static admission and Router simulation are not an audit
            or a guarantee of safety, honeypot resistance, liquidity,
            tradeability or fee behavior. Disclose transfer, pause, upgrade,
            mint, liquidity-custody and buy/sell controls.
          </li>
        </ul>
      </section>

      <section id="request">
        <div className={styles.sectionIntro}>
          <h2>Understand the public V3 request contract</h2>
          <p>
            <code>POST /v3/custom-launches</code> accepts only the exact,
            byte-bound general-profile request. Earlier versions remain
            available for existing history; V1 POST stays read-only.
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
          accepts 3 to 16 acyclic direct targets, exactly one token target and
          one hook target. The complete graph input is limited to 524,288 bytes;
          per-target init code is limited to 49,152 bytes and initializer
          calldata to 131,072 bytes. Use the{" "}
          <a href="/openapi/custom-launch-v3.json">V3 OpenAPI contract</a> for every
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
          <h2>Review the V3 platform fee policy</h2>
          <p>
            The general revision-3 profile is public on Ethereum Mainnet only
            (<code>chainId: &quot;1&quot;</code>) and has{" "}
            <code>productionLaunchAuthorized: true</code>.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          Every V3 request must bind and disclose a Programmable share of{" "}
          <code>1,000 ppm = 0.10% = 10 bps</code> of its declared assessment
          basis. It may be additive to the selected fee or included in that
          selected total. The server recomputes the declared buy and sell
          project share, effective total, fee currency and rounding. The request-bound
          claim destination is controlled by{" "}
          <code>0x4957f49620AFf3Adbbe8195a4f633E49cc93376c</code>.
          Revision-3 static admission carries <code>feeBehaviorClaim: false</code>.
          It does not certify or enforce how arbitrary custom code charges or
          routes fees on later swaps; inspect the exact implementation.
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
            Required V3 <code>verificationBundle</code> binds exact UTF-8 Solidity
            Standard JSON bytes, their SHA-256, the exact solc build, source and
            contract identity and resolved constructor arguments to the
            prepared artifact.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          Standard JSON sources contain inline <code>content</code>; URL-only
          sources fail. Compilation units and components are uniquely UTF-8
          sorted, and components exactly cover the graph. The default revision-3
          profile pins <code>solc 0.8.26+commit.8a97fa7a</code>. Decoded Standard
          JSON is limited to 5,242,880 bytes per unit and in aggregate, with at
          most 2,048 inline sources. Revision-2 requests retain their
          compatibility contract. Existing legacy resources without a bundle
          remain readable and unverified.
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
            Use <code>POST /v3/custom-launches</code>. The CLI persistently binds
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
          <li>
            Keep deployment, trading, platform-fee evidence, source verification,
            indexing and featured placement as independent product-truth axes.
            Preflight eligibility does not prove any later external state.
          </li>
        </ul>

        <p className={styles.bodyCopy}>
          Service readiness and API authorization do not replace controller
          approval. The connected wallet must review the exact chain, sender,
          Router, value and calldata before a separate signature.
        </p>

        <p className={styles.bodyCopy}>
          New V3 requests share a durable global admission cap of 120 created
          requests per hour and 500 per day. An exact idempotent replay is
          checked first and consumes no additional capacity.
        </p>
      </section>

      <section id="lifecycle">
        <div className={styles.sectionIntro}>
          <h2>Track the resource, not an assumed transaction</h2>
          <p>
            Read <code>GET /v3/custom-launches/{"{launchId}"}</code> with the same
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
          reconciliation. <code>GET /v3/custom-launches</code> is a newest-first
          wallet-owned history view with bounded summaries; its{" "}
          <code>output</code> is always <code>null</code>. Use the single-resource
          route for the artifact, wallet transaction and durable failure. Its
          additive <code>lifecycleQueue</code> reports bounded worker scheduling
          and retry state only; queue completion is not launch finality.
        </p>

        <aside className={styles.callout}>
          <strong>API access is not wallet authorization</strong>
          <p>
            At <code>authorized</code>, review and sign in the connected
            controller wallet. Follow only the HTTPS <code>walletHandoffUrl</code>
            before its <code>expiresAt</code>; refetch status after expiry. The API
            and CLI never auto-sign or auto-broadcast. The API key is never proof
            of wallet approval.
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
          For <code>action_required</code>, preserve the resource{" "}
          <code>requestId</code> and exact static report. For HTTP errors,
          preserve <code>error.requestId</code>. For support, send only that
          request ID, HTTP status, UTC time and error code. Never send the API
          key.
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
          and a public Hookbuilder are not granted by the V3 Custom Launch API.
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
              Inspect V2 compatibility
            </a>
          </li>
          <li>
            <a href="/openapi/custom-launch-v3.json">
              Open the live V3 contract
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
