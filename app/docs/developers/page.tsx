import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Braces,
  FileJson2,
  ShieldCheck,
} from "lucide-react";

import {
  LAUNCH_KIND_V1,
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_RESOURCES,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI,
} from "@/components/launch-stamp-docs-contract";
import styles from "@/components/developer-docs.module.css";
import { DocsAddress } from "@/components/docs-address";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Developer integration · Programmable",
  description:
    "Integrate the canonical Launch Stamp Router to verify Router-stamped Programmable Classic and Custom launches on Ethereum.",
  alternates: { canonical: "/docs/developers" },
  openGraph: {
    type: "website",
    siteName: "Programmable",
    title: "Programmable developer integration",
    description:
      "Router address, ABI, event stream, verification reads, finality policy and integration guidance for Router-stamped Programmable launches.",
    url: "/docs/developers",
    images: [
      {
        url: "/og/programmable-night-garden-og-1200x630.png",
        width: 1200,
        height: 630,
        type: "image/png",
        alt: "A starry night garden with pink wildflowers and a violet glow",
      },
    ],
  },
};

const router = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter;
const chainId = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.chainId;
const events = Object.values(router.events);
const customKind = LAUNCH_KIND_V1.find((kind) => kind.name === "CustomGraph");
const classicKind = LAUNCH_KIND_V1.find((kind) => kind.name === "Classic");
const reads = PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI;

const developerSections = [
  { id: "paths", label: "Start here" },
  { id: "trust-root", label: "Router binding" },
  { id: "identity", label: "Match a token or pool" },
  { id: "indexing", label: "Discover new launches" },
  { id: "resources", label: "Resources" },
  { id: "boundary", label: "What verification proves" },
  { id: "checklist", label: "Checklist" },
  { id: "agents", label: "Machine-readable docs" },
] as const;

const developerPaths = [
  {
    description:
      "Resolve the live Router, start block, runtime and ABI binding.",
    href: PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl,
    icon: FileJson2,
    label: "Open the live manifest",
    external: true,
  },
  {
    description: "Download the exact hosted ABI and verify its SHA-256 digest.",
    href: PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl,
    icon: Braces,
    label: "Download the Router ABI",
    external: true,
  },
  {
    description:
      "Use the full algorithm and runnable verifier implementations.",
    href: PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.referenceUrl,
    icon: BookOpen,
    label: "Open the GitHub reference",
    external: true,
  },
  {
    description:
      "Read the full verification reference and its finalized CustomGraph test case (PCAN).",
    href: "/docs/launch-stamps",
    icon: ShieldCheck,
    label: "Read the Router reference",
    external: false,
  },
] as const;

function ExternalResource({
  children,
  href,
  meta,
}: {
  children: ReactNode;
  href: string;
  meta: string;
}) {
  return (
    <a
      className={styles.resourceLink}
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <span>
        <strong>{children}</strong>
        <small>{meta}</small>
      </span>
      <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.8} />
    </a>
  );
}

export default function DeveloperDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers"
      description="For launches executed and stamped through Router V1, this guide explains how to verify Programmable provenance from a token or Uniswap v4 pool. Historical launches and direct factory calls are outside this verification path."
      heroAside={
        <nav
          aria-label="Developer integration paths"
          className={styles.pathList}
        >
          {developerPaths.map((path) => {
            const Icon = path.icon;
            return (
              <a
                href={path.href}
                key={path.href}
                rel={path.external ? "noreferrer" : undefined}
                target={path.external ? "_blank" : undefined}
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                <span>
                  <strong>{path.label}</strong>
                  <small>{path.description}</small>
                </span>
                <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.8} />
              </a>
            );
          })}
        </nav>
      }
      heroId="paths"
      kicker="Developer integration"
      sections={developerSections}
      title="Integrate launch verification"
    >
      <section id="trust-root">
        <div className={styles.sectionIntro}>
          <h2>Start with one live contract</h2>
          <p>
            Bind your integration to Ethereum, the exact Router address, its
            deployment range and runtime hash. Treat every other emitter as a
            different system.
          </p>
        </div>

        <div
          aria-label="Canonical Launch Stamp Router binding"
          className={styles.fieldTable}
          role="table"
        >
          <div role="row">
            <code role="rowheader">chainId</code>
            <span role="cell">{chainId} · Ethereum mainnet</span>
          </div>
          <div role="row">
            <code role="rowheader">Router</code>
            <span role="cell">
              <DocsAddress
                address={router.address}
                label="Launch Stamp Router"
              />
            </span>
          </div>
          <div role="row">
            <code role="rowheader">status</code>
            <span role="cell">{router.status}</span>
          </div>
          <div role="row">
            <code role="rowheader">startBlock</code>
            <span role="cell">{router.startBlock}</span>
          </div>
          <div role="row">
            <code role="rowheader">runtimeCodeHash</code>
            <span className={styles.breakableValue} role="cell">
              {router.runtimeCodeHash}
            </span>
          </div>
          <div role="row">
            <code role="rowheader">ABI SHA-256</code>
            <span className={styles.breakableValue} role="cell">
              {router.abiSha256}
            </span>
          </div>
          <div role="row">
            <code role="rowheader">finality</code>
            <span role="cell">
              finalized tag · explicit block reads require at least{" "}
              {router.finalityConfirmations} confirmations
            </span>
          </div>
        </div>

        <div className={styles.labelGrid}>
          <article>
            <span className={styles.labelIcon} aria-hidden="true">
              <Braces size={19} strokeWidth={1.8} />
            </span>
            <code>
              LaunchKindV1.{customKind?.name} = {customKind?.value}
            </code>
            <h3>{customKind?.publicLabel}</h3>
            <p>
              A CustomGraph launch executed and stamped through this Router.
              The token, hook and pool can differ between launches.
            </p>
          </article>
          <article>
            <span className={styles.labelIcon} aria-hidden="true">
              <ShieldCheck size={19} strokeWidth={1.8} />
            </span>
            <code>
              LaunchKindV1.{classicKind?.name} = {classicKind?.value}
            </code>
            <h3>{classicKind?.publicLabel}</h3>
            <p>
              A Classic launch, when executed and stamped through this Router,
              uses the same verification path. Shared Classic infrastructure
              does not replace token or pool identity.
            </p>
          </article>
        </div>

        <p className={styles.scopeNote}>
          This Router covers only launches executed and stamped through it from
          {" "}<code>startBlock</code> onward. Historical launches and direct
          factory calls are outside its provenance record.
        </p>
      </section>

      <section id="identity">
        <div className={styles.sectionIntro}>
          <h2>Resolve one record from token or pool</h2>
          <p>
            A terminal can start with a token address or the Uniswap v4 market
            identity. Both paths must resolve the same nonzero launch ID and the
            same stamp record.
          </p>
        </div>

        <div className={styles.originFlow} aria-label="Launch stamp read flow">
          <span>token or (PoolManager, poolId)</span>
          <span aria-hidden="true">→</span>
          <span>launchId</span>
          <span aria-hidden="true">→</span>
          <span>launchStamp record</span>
          <span aria-hidden="true">→</span>
          <span>Programmable Classic or Custom</span>
        </div>

        <div className={styles.identityRules}>
          <article>
            <strong>Token</strong>
            <p>
              Call <code>{reads.primaryReads[0].signature}</code>, require{" "}
              <code>record.token == token</code>, then match{" "}
              <code>stampProof(token)</code> to the record hash.
            </p>
          </article>
          <article>
            <strong>Uniswap v4 pool</strong>
            <p>
              Call <code>{reads.primaryReads[1].signature}</code> and require
              exact equality with <code>record.poolManager</code> and
              <code>record.poolId</code>.
            </p>
          </article>
          <article>
            <strong>Exclusive component</strong>
            <p>
              Require <code>{reads.componentReads[1].signature}</code>, matching{" "}
              <code>{reads.componentReads[0].signature}</code>, and equality
              between <code>{reads.componentReads[2].signature}</code> and the
              Keccak-256 hash of the component runtime bytecode returned by{" "}
              <code>eth_getCode</code> at the same canonical block. The shared
              Classic hook is not a launch identifier.
            </p>
          </article>
        </div>

        <div className={styles.statusNote}>
          <strong>Return one of four verification results</strong>
          <p>
            Return stamped, not-stamped, unavailable or indeterminate. Only a
            successful canonical zero lookup is not-stamped. Unavailable means
            the Router is outside its live block range, the chain is inactive or
            activation data is incomplete. RPC, ABI, runtime, block, decoding or
            cross-check failures are indeterminate. Orphaned is a separate event
            or reorg observation, not a point-verification outcome.
          </p>
        </div>
      </section>

      <section id="indexing">
        <div className={styles.sectionIntro}>
          <h2>Discover new launches when needed</h2>
          <p>
            Point verification needs only an Ethereum provider and the getter
            sequence above. If you need continuous discovery, follow the Router
            events from <code>{router.startBlock}</code> and verify every
            candidate with the same canonical reads. An indexer is an
            implementation choice, not a trust dependency.
          </p>
        </div>

        <ol className={styles.syncSteps}>
          <li>
            <span className={styles.stepNumber}>1</span>
            <div>
              <strong>Verify the Router binding</strong>
              <p>
                Verify chain ID, address, start block, runtime code hash, ABI
                URL and ABI digest before reading logs.
              </p>
              <code>address = {router.address}</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>2</span>
            <div>
              <strong>Backfill to finality</strong>
              <p>
                Read bounded <code>eth_getLogs</code> chunks from the start
                block through a finalized boundary. Persist block and log
                coordinates.
              </p>
              <code>fromBlock = {router.startBlock}</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>3</span>
            <div>
              <strong>Verify every candidate</strong>
              <p>
                Require the exact Router emitter, correlate events by
                <code>launchId</code>, then reproduce the record with canonical
                getter reads.
              </p>
              <code>{reads.primaryReads[2].signature}</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>4</span>
            <div>
              <strong>Replay an overlap</strong>
              <p>
                Re-read an overlap window, deduplicate identical coordinates and
                rewind to the last common finalized checkpoint after a reorg.
              </p>
              <code>EIP-1898 requireCanonical: true</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>5</span>
            <div>
              <strong>Continue without a gap</strong>
              <p>
                Poll or subscribe from the overlapping checkpoint and pass each
                notification through the same log and getter verification.
              </p>
              <code>backfill → overlap → live follow</code>
            </div>
          </li>
        </ol>

        <div className={styles.subsectionHeader}>
          <div>
            <h3>Canonical discovery events</h3>
            <p>Use every full signature and topic exactly as published.</p>
          </div>
          <a href="/docs/launch-stamps#indexing">
            Open the full indexing reference
            <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.8} />
          </a>
        </div>

        <div
          aria-label="Launch Stamp Router event reference"
          className={styles.fieldTable}
          role="table"
        >
          {events.map((event) => (
            <div key={event.topic0} role="row">
              <code role="rowheader">{event.name}</code>
              <span className={styles.eventDetails} role="cell">
                <code>{event.signature}</code>
                <small>topic0 {event.topic0}</small>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section id="resources">
        <div className={styles.sectionIntro}>
          <h2>Use the manifest, ABI and verification reference together</h2>
          <p>
            Read the discovery document, follow <code>manifestUrl</code>, and
            use <code>launchStampRouter</code> from the live manifest. Verify
            the downloaded ABI bytes against <code>abiSha256</code> before the
            first lookup. GitHub contains the full algorithm and runnable
            verifiers.
          </p>
        </div>

        <div className={styles.resourceGrid}>
          <ExternalResource
            href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl}
            meta="Live chain, Router, start block, runtime and ABI binding"
          >
            Live manifest
          </ExternalResource>
          <ExternalResource
            href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.discoveryUrl}
            meta="Stable entry point that supplies manifestUrl"
          >
            Discovery document
          </ExternalResource>
          <ExternalResource
            href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl}
            meta={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiSha256}
          >
            Hosted Router ABI
          </ExternalResource>
          <ExternalResource
            href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.referenceUrl}
            meta="Canonical point-verification specification"
          >
            Router reference
          </ExternalResource>
          <ExternalResource
            href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.terminalGuideUrl}
            meta="Backfill, live follow, overlap, reorg and finality policy"
          >
            Terminal guide
          </ExternalResource>
          <ExternalResource
            href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.jsonRpcVerifierUrl}
            meta="Dependency-light JSON-RPC implementation"
          >
            JSON-RPC verifier
          </ExternalResource>
          <ExternalResource
            href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.viemVerifierUrl}
            meta="Typed application integration"
          >
            viem verifier
          </ExternalResource>
        </div>

        <p className={styles.scopeNote}>
          The finalized PCAN vector in the Router reference provides one exact
          CustomGraph transaction, token, hook, pool ID, launch ID and stamp
          hash for an end-to-end integration test.
        </p>
      </section>

      <section id="boundary">
        <div className={styles.sectionIntro}>
          <h2>Keep provenance separate from market risk</h2>
          <p>
            A Router record establishes provenance only after the address,
            runtime, binding, lookup and cross-check requirements above pass.
            It does not establish safety, tradability, current liquidity or
            pool state, audit coverage, review status, endorsement or terminal
            support.
          </p>
        </div>

        <div className={styles.identityRules}>
          <article>
            <strong>It establishes</strong>
            <p>
              Canonical Router origin, launch ID, launch kind, token, pool and
              recorded component facts. The exact pool was initialized during
              the same atomic launch transaction.
            </p>
          </article>
          <article>
            <strong>It does not establish</strong>
            <p>
              Safety, tradability, current liquidity, current pool state, audit
              coverage, approval, endorsement or automatic terminal listing.
            </p>
          </article>
          <article>
            <strong>It does not require</strong>
            <p>
              A Programmable launch feed, indexer, Supabase project or
              application server. After bootstrap from the manifest and ABI, a
              terminal can read the Router through any Ethereum provider.
            </p>
          </article>
        </div>

        <div className={styles.statusNote}>
          <strong>Discovery and provenance are different</strong>
          <p>
            A third-party terminal may discover a token or v4 pool without
            recognizing its Programmable stamp. Each terminal must implement
            the published Router verification procedure to add that
            provenance. General public Custom submission and wallet
            self-service launching are not live.
          </p>
        </div>
      </section>

      <section id="checklist">
        <div className={styles.sectionIntro}>
          <h2>Integration checklist</h2>
          <p>
            Keep the acceptance path small and fail closed on missing or
            inconsistent chain evidence.
          </p>
        </div>

        <ol className={styles.integrationChecklist}>
          <li>
            <span>
              Require <code>chainId={chainId}</code>, Router{" "}
              <code>{router.address}</code> and{" "}
              <code>startBlock={router.startBlock}</code>.
            </span>
          </li>
          <li>
            <span>
              Verify the deployed runtime code hash and every immutable binding
              from the manifest at one canonical block.
            </span>
          </li>
          <li>
            <span>
              Download the hosted ABI, hash its exact bytes and match{" "}
              <code>{router.abiSha256}</code>.
            </span>
          </li>
          <li>
            <span>
              If you need continuous discovery, backfill all three Router events
              through finality and persist block, transaction and log
              coordinates for replay.
            </span>
          </li>
          <li>
            <span>
              Resolve the token or pool to one launch ID, read the record and
              verify the identity-specific proof at the same block.
            </span>
          </li>
          <li>
            <span>
              Map only kind <code>{customKind?.value}</code> to Programmable
              Custom and kind <code>{classicKind?.value}</code> to Programmable
              Classic.
            </span>
          </li>
          <li>
            <span>
              Keep stamped, not-stamped, unavailable and indeterminate separate.
              Keep orphaned as an event or reorg observation. Never convert an
              RPC failure into a negative provenance result.
            </span>
          </li>
        </ol>
      </section>

      <section id="agents">
        <div className={styles.sectionIntro}>
          <h2>Give agents the same source set</h2>
          <p>
            Use the Markdown overview for the short integration guide and the
            full Router reference for selectors, events, records, finality and
            the PCAN test case.
          </p>
        </div>

        <div
          aria-label="Machine-readable documentation entry points"
          className={styles.fieldTable}
          role="table"
        >
          <div role="row">
            <code role="rowheader">Overview</code>
            <span role="cell">
              <a href="/docs/developers.md">/docs/developers.md</a>
            </span>
          </div>
          <div role="row">
            <code role="rowheader">Short context</code>
            <span role="cell">
              <a href="/llms.txt">/llms.txt</a>
            </span>
          </div>
          <div role="row">
            <code role="rowheader">Full context</code>
            <span role="cell">
              <a href="/llms-full.txt">/llms-full.txt</a>
            </span>
          </div>
          <div role="row">
            <code role="rowheader">Canonical source</code>
            <span className={styles.breakableValue} role="cell">
              {PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.referenceUrl}
            </span>
          </div>
        </div>

        <div className={styles.finalCta}>
          <div>
            <strong>Implement against the exact Router contract</strong>
            <p>
              Start with the manifest and ABI, then validate your reader against
              the finalized PCAN vector before following live logs.
            </p>
          </div>
          <a href="/docs/launch-stamps">
            Open Router reference
            <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.8} />
          </a>
        </div>
      </section>
    </DocsShell>
  );
}
