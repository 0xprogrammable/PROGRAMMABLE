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
    "Public-read and Bearer-authenticated Custom Launch API contracts, Markdown guides, manifests and canonical verification files.",
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
              Canonical human guide for authentication, request construction,
              lifecycle, errors, discovery and claims.
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
              Standalone OpenAPI contract for the Bearer-authenticated Custom
              Launch API.
            </span>
          </li>
          <li>
            <a href="/developers/custom-launch-api-v1.md">
              <code>/developers/custom-launch-api-v1.md</code>
            </a>
            <span>
              Existing raw guide for agent and script compatibility.
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
            <code>https://api.programmable.market/v1/custom-launches</code>{" "}
            requires a wallet-bound <code>pm_live_</code> Bearer key.
          </li>
          <li>
            Keys default to 90 days, are capped at 366 days and are limited to
            10 active keys per wallet. New launch reservations are limited to
            30 per rolling hour and 100 per rolling day; exact idempotent replays
            bypass launch quota.
          </li>
          <li>
            The platform validates manifest digest, graph, attestation shape,
            evidence digests, optional exact-source build inputs and permit
            bindings. It does not simulate the wallet transaction, audit the
            project or attest safety.
          </li>
          <li>
            <code>prepared</code> contains an artifact but no wallet transaction.
            <code>authorized</code> contains the permit-attached transaction for
            the bound wallet to review, sign and broadcast. The API key is not
            wallet authority.
          </li>
          <li>
            <code>GET /v1/custom-launches</code> returns a wallet-owned,
            cursor-paginated snapshot. It makes a bounded best-effort
            reconciliation pass over pending rows and still returns durable
            history when RPC is unavailable.
          </li>
          <li>
            After broadcast, poll the single-launch status route. It reconciles
            the canonical Router event and getter on demand; there is no
            background reconciliation timer. Finality requires 64 confirmations.
          </li>
          <li>
            The API request UUID is returned as <code>requestId</code> and the
            legacy <code>launchId</code> alias. The distinct bytes32
            <code>onchainLaunchId</code> identifies the Router launch.
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
            operations in V1.
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
              Use the Custom Launch API
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
