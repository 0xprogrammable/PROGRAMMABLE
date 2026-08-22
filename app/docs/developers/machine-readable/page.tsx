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
    "Markdown, model context, manifest, ABI and canonical source files for Programmable launch verification.",
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
            <a href="/openapi.json">
              <code>/openapi.json</code>
            </a>
            <span>
              The stable, unauthenticated public read API for verified launch
              discovery and exact token lookup.
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
            Programmable documentation endpoints require no authentication.
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
