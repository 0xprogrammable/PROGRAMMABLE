import type { Metadata } from "next";
import Link from "next/link";

import {
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_RESOURCES,
} from "@/components/launch-stamp-docs-contract";
import styles from "@/components/developer-docs.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Machine-readable docs · Programmable",
  description:
    "Public-read contracts, wallet-owned V3 resources, compatibility history, Markdown guides, manifests and canonical verification files.",
  alternates: { canonical: "/docs/developers/machine-readable" },
};

const router = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter;

const machineSections = [
  { id: "documents", label: "Documentation files" },
  { id: "artifacts", label: "Contract artifacts" },
  { id: "authority", label: "Source authority" },
  { id: "access", label: "Access" },
] as const;

export default function MachineReadableDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers/machine-readable"
      description="Use the same published source set in agents, terminals, scanners and build pipelines."
      kicker="Developer integration"
      parentHref="/docs/developers"
      parentLabel="Developers"
      sections={machineSections}
      title="Machine-readable docs"
    >
      <section id="documents">
        <div className={styles.sectionIntro}>
          <h2>Documentation files</h2>
          <p>
            Choose the smallest document that contains the context your
            integration needs.
          </p>
        </div>

        <ul className={styles.linkList}>
          <li>
            <Link href="/docs/developers/custom-launch">
              Custom Launch API guide
            </Link>
            <span>
              Canonical human guide for public V3 creation, lifecycle, wallet
              handoff, errors, discovery and claims.
            </span>
          </li>
          <li>
            <a href="/openapi.json">
              <code>/openapi.json</code>
            </a>
            <span>
              Combined developer contract. Public discovery and Registry reads
              are unauthenticated; Custom launch routes use a wallet-bound
              Bearer API key.
            </span>
          </li>
          <li>
            <a href="/openapi/custom-launch-v1.json">
              <code>/openapi/custom-launch-v1.json</code>
            </a>
            <span>
              Standalone OpenAPI contract for live Bearer-authenticated V1
              reads and the explicit V1 write fence.
            </span>
          </li>
          <li>
            <a href="/openapi/custom-launch-v2.json">
              <code>/openapi/custom-launch-v2.json</code>
            </a>
            <span>
              Compatibility contract for existing V2 resources and clients.
            </span>
          </li>
          <li>
            <a href="/openapi/custom-launch-v3.json">
              <code>/openapi/custom-launch-v3.json</code>
            </a>
            <span>
              Live V3 capabilities, side-effect-free preflight, general-hook
              request, lifecycle and separate Router-transaction schemas.
            </span>
          </li>
          <li>
            <a href="/policies/custom-launch-agent-remediation-v1.json">
              <code>/policies/custom-launch-agent-remediation-v1.json</code>
            </a>
            <span>
              Versioned cold-agent contract for inspecting existing projects,
              building V3 pack config, EIP-3009 compatibility, liquidity and
              automatic remediation without a project allowlist.
            </span>
          </li>
          <li>
            <a href="/schemas/custom-launch/v3/pack-config.json">
              <code>/schemas/custom-launch/v3/pack-config.json</code>
            </a>
            <span>
              Canonical JSON Schema for{" "}
              <code>programmable.launch-pack-config.v3</code>, including current
              EIP-3009 authorization-patch argument paths.
            </span>
          </li>
          <li>
            <a href="/developers/custom-launch-api-v1.md">
              <code>/developers/custom-launch-api-v1.md</code>
            </a>
            <span>
              Raw guide for agent and script compatibility.
            </span>
          </li>
          <li>
            <a href="https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.2/programmable-launch-3.3.2.tgz">
              <code>@programmable/launch 3.3.2</code>
            </a>
            <span>
              Immutable CLI asset with exactly pack, validate, submit and
              status; validate --remote adds public capabilities and
              non-persisting preflight.
            </span>
          </li>
          <li>
            <a href="/docs/developers.md">
              <code>/docs/developers.md</code>
            </a>
            <span>The integration guide as Markdown.</span>
          </li>
          <li>
            <a href="/llms.txt">
              <code>/llms.txt</code>
            </a>
            <span>
              A short source index and the required interpretation rules.
            </span>
          </li>
          <li>
            <a href="/llms-full.txt">
              <code>/llms-full.txt</code>
            </a>
            <span>
              Expanded context for readers that need the complete overview in
              one response.
            </span>
          </li>
        </ul>
      </section>

      <section id="artifacts">
        <div className={styles.sectionIntro}>
          <h2>Contract artifacts</h2>
          <p>
            Resolve the current Router first. Then pin the exact ABI bytes and
            verification reference used by your build.
          </p>
        </div>

        <ul className={styles.linkList}>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.discoveryUrl}>
              Discovery document
            </a>
            <span>
              Stable entry point that supplies <code>manifestUrl</code>.
            </span>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl}>
              Deployment manifest
            </a>
            <span>
              Chain, Router, published range, runtime, immutable bindings, event
              topics, ABI URL and digest.
            </span>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl}>
              Hosted Router ABI
            </a>
            <span>
              Hash the exact downloaded bytes and match{" "}
              <code>{router.abiSha256}</code>.
            </span>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiGithubUrl}>
              Router ABI on GitHub
            </a>
            <span>The same interface in the public developer repository.</span>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.referenceUrl}>
              GitHub Router reference
            </a>
            <span>
              Complete point-verification specification and finalized PCAN test
              case.
            </span>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.terminalGuideUrl}>
              Terminal and scanner guide
            </a>
            <span>
              Backfill, checkpoint continuation, overlap, reorg and finality
              handling.
            </span>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.jsonRpcVerifierUrl}>
              JSON-RPC verifier
            </a>
            <span>Dependency-light reference implementation.</span>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.viemVerifierUrl}>
              viem verifier
            </a>
            <span>Typed application reference implementation.</span>
          </li>
        </ul>
      </section>

      <section id="authority">
        <div className={styles.sectionIntro}>
          <h2>Know which source defines what</h2>
          <p>
            The files have different jobs. Do not treat a model-context file as
            a replacement for the deployed contract binding.
          </p>
        </div>

        <dl className={styles.dataList}>
          <div>
            <dt>Deployment manifest</dt>
            <dd>
              Supplies the current chain, Router, block range, runtime,
              bindings, topics and ABI digest.
            </dd>
          </div>
          <div>
            <dt>Hosted ABI</dt>
            <dd>
              Defines the contract interface. Verify its exact bytes against the
              manifest digest.
            </dd>
          </div>
          <div>
            <dt>GitHub Router reference</dt>
            <dd>
              Defines the canonical point-verification algorithm and test
              vector.
            </dd>
          </div>
          <div>
            <dt>Custom Launch API contract</dt>
            <dd>
              Defines the authenticated request, manifest and attestation
              shapes, graph constraints, permit binding and wallet handoff. It
              does not define a universal check-ID catalog or a safety review.
            </dd>
          </div>
          <div>
            <dt>Web, Markdown and model context</dt>
            <dd>
              Explain and route the integration. <code>/llms-full.txt</code> is
              expanded convenience context, not the normative algorithm.
            </dd>
          </div>
        </dl>
      </section>

      <section id="access">
        <div className={styles.sectionIntro}>
          <h2>Access</h2>
        </div>

        <ul className={styles.checkList}>
          <li>
            Public documentation, discovery and Registry-read endpoints require
            no authentication.
          </li>
          <li>
            <code>https://api.programmable.market/v3/custom-launches</code>{" "}
            requires a wallet-bound <code>pm_live_</code> Bearer key.
          </li>
          <li>
            Public V3 creation, list and single-resource reads are live. V2 and
            V1 history remain readable, while authenticated V1 POST returns
            non-retryable <code>409 CUSTOM_LAUNCH_V1_READ_ONLY</code>.
          </li>
          <li>
            The default V3 profile uses{" "}
            <code>programmable.direct-native-hook-graph-profile.v3</code>,{" "}
            <code>profileRevision: 3</code> and{" "}
            <code>profileVersion: 3.2.0</code>. It supports project-owned tokens,
            hooks, 3–16 exact direct graph targets and every valid Uniswap v4
            permission mask. Profile 3.2.0 also binds canonical project name,
            symbol, presentation and image bytes into the launch identity. Its selection uses{" "}
            <code>
              programmable.direct-native-hook-graph-profile-selection-binding.v3
            </code>
            . Exact metadata-absent 3.1.0 and 3.0.0 requests remain readable and
            byte-identical retryable under their original policies. Revision 2
            also remains compatible.
          </li>
          <li>
            Revision 3 pins exact{" "}
            <code>solc 0.8.26+commit.8a97fa7a</code> Standard JSON, limited to
            5,242,880 bytes per unit and in aggregate and 2,048 inline sources.
          </li>
          <li>
            Role-aware exact-source static admission binds every finding.
            Profile 3.2.0 has exactly seven objective hard-block rules. Proxy,
            delegatecall, mint, tax, pause, liquidity and return-delta surfaces
            require evidence instead of categorical rejection. A hard-block
            code-and-role match returns <code>action_required</code>; other
            findings remain visible. There is no manual project allowlist. A
            final Router simulation is mandatory before authorization.
          </li>
          <li>
            Public <code>GET /v3/capabilities</code> and authenticated,
            side-effect-free <code>POST /v3/custom-launches/preflight</code>
            expose risk classification, platform-owned behavior evidence and
            six separate product-truth axes. A not-executed behavior vector is
            outstanding, not verified.
          </li>
          <li>
            Admission and simulation are not an audit or a guarantee of safety,
            honeypot resistance, liquidity, tradeability or fee behavior.
          </li>
          <li>
            <code>prepared</code> contains an artifact but no wallet transaction.
            <code>authorized</code> contains the permit-attached transaction for
            the bound wallet to review, sign and broadcast. The API key is not
            wallet authority.
          </li>
          <li>
            <code>GET /v3/custom-launches</code> returns a wallet-owned,
            cursor-paginated snapshot. It makes a bounded best-effort
            reconciliation pass over pending rows and still returns durable
            history when RPC is unavailable. Resource
            <code> lifecycleQueue</code> is bounded worker scheduling guidance,
            not launch finality.
          </li>
          <li>
            After broadcast, poll the single-launch status route. It is the
            canonical full-resource path while the durable worker and bounded
            list reconciliation may also advance pending state. Finality
            requires 64 confirmations.
          </li>
          <li>
            The API request UUID is returned as <code>requestId</code> and the
            legacy <code>launchId</code> alias. The distinct bytes32
            <code>onchainLaunchId</code> identifies the Router launch.
          </li>
          <li>
            For <code>action_required</code>, keep the exact report and resource{" "}
            <code>requestId</code>. Send support only that ID, status, UTC time
            and public code. Never send the API key.
          </li>
          <li>
            Finalized Router launches are eligible for Explore and Profile
            discovery after refresh. Third-party discovery and listing remain
            consumer-controlled.
          </li>
          <li>
            Router verification proves initialization and fixed runtime and pool
            bindings, not active liquidity or tradability. Agent checks remain
            caller-declared and are not an audit. Exact-source status is
            server-authored only after a real provider exact match.
          </li>
          <li>
            Fee claims and automated buybacks are not active Custom Launch API
            operations for arbitrary hooks. FADE uses a specifically bound
            adapter, not a generic capability.
          </li>
          <li>Ethereum RPC authentication depends on your provider.</li>
          <li>
            After manifest and ABI bootstrap, point verification needs an
            Ethereum provider only.
          </li>
        </ul>
      </section>

      <nav
        aria-label="Continue developer integration"
        className={styles.nextLinks}
      >
        <p>Continue</p>
        <ul>
          <li>
            <Link href="/docs/developers/custom-launch">
              Read Custom Launch API availability
            </Link>
          </li>
          <li>
            <Link href="/docs/developers/verify">Verify a token or pool</Link>
          </li>
          <li>
            <Link href="/docs/developers/indexing">Index new launches</Link>
          </li>
          <li>
            <Link href="/docs/launch-stamps">
              Open the full Router reference
            </Link>
          </li>
        </ul>
      </nav>
    </DocsShell>
  );
}
