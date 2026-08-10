import type { Metadata } from "next";
import Link from "next/link";

import {
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_RESOURCES,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI,
} from "@/components/launch-stamp-docs-contract";
import styles from "@/components/developer-docs.module.css";
import { DocsAddress } from "@/components/docs-address";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Index new launches · Programmable",
  description:
    "Discover Router-stamped Programmable launches with canonical events, getter verification, finality checkpoints and reorg handling.",
  alternates: { canonical: "/docs/developers/indexing" },
};

const manifest = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST;
const router = manifest.launchStampRouter;
const reads = PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI;
const events = Object.values(router.events);

const indexingSections = [
  { id: "scope", label: "When to index" },
  { id: "binding", label: "Router binding" },
  { id: "events", label: "Discovery events" },
  { id: "verification", label: "Verify candidates" },
  { id: "finality", label: "Finality and reorgs" },
  { id: "storage", label: "Stored fields" },
] as const;

export default function IndexLaunchesPage() {
  return (
    <DocsShell
      currentPath="/docs/developers/indexing"
      description="Discover launches from Router events, then establish provenance with canonical contract reads."
      kicker="Developer integration"
      parentHref="/docs/developers"
      parentLabel="Developer integration"
      sections={indexingSections}
      title="Index new launches"
    >
      <section id="scope">
        <div className={styles.sectionIntro}>
          <h2>Index only when you need discovery</h2>
          <p>
            Point verification needs an Ethereum provider, the manifest and the
            Router ABI. Continuous event indexing is optional.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          If your product already has a token address or pool ID, use the{" "}
          <Link href="/docs/developers/verify">point-verification guide</Link>.
          Build an indexer when you need a complete feed of new Router-stamped
          launches.
        </p>
      </section>

      <section id="binding">
        <div className={styles.sectionIntro}>
          <h2>Start at the published block</h2>
          <p>
            Verify the live Router binding before reading logs. Ignore events
            from every other emitter.
          </p>
        </div>

        <dl className={styles.dataList}>
          <div>
            <dt>Network</dt>
            <dd>
              Ethereum mainnet · <code>chainId {manifest.chainId}</code>
            </dd>
          </div>
          <div>
            <dt>Router</dt>
            <dd>
              <DocsAddress
                address={router.address}
                label="Launch Stamp Router"
              />
            </dd>
          </div>
          <div>
            <dt>Start block</dt>
            <dd>
              <code>{router.startBlock}</code>
            </dd>
          </div>
          <div>
            <dt>End block</dt>
            <dd>
              <code>{router.endBlock ?? "open"}</code>
            </dd>
          </div>
          <div>
            <dt>Explicit-block finality</dt>
            <dd>
              At least <code>{router.finalityConfirmations}</code> confirmations
            </dd>
          </div>
        </dl>

        <p className={styles.bodyCopy}>
          Resolve these values from the{" "}
          <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl}>
            live manifest
          </a>
          . Also verify the Router runtime, immutable bindings, hosted ABI and
          ABI digest before the backfill begins.
        </p>
      </section>

      <section id="events">
        <div className={styles.sectionIntro}>
          <h2>Treat events as candidates</h2>
          <p>
            Filter by the exact Router address and full event topics. Logs help
            you discover a launch; getter verification establishes provenance.
          </p>
        </div>

        <div
          aria-label="Launch Stamp Router discovery events"
          className={styles.tableScroll}
          role="region"
          tabIndex={0}
        >
          <table className={styles.eventTable}>
            <caption>Launch Stamp Router discovery events</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Full signature</th>
                <th scope="col">topic0</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.topic0}>
                  <th scope="row">{event.name}</th>
                  <td>
                    <code>{event.signature}</code>
                  </td>
                  <td>
                    <code>{event.topic0}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="verification">
        <div className={styles.sectionIntro}>
          <h2>Backfill, verify, then follow live</h2>
        </div>

        <ol className={styles.steps}>
          <li>
            Read bounded <code>eth_getLogs</code> chunks from{" "}
            <code>{router.startBlock}</code> through a finalized boundary.
          </li>
          <li>
            Require the exact Router emitter and published topic signatures.
            Correlate the three event types by <code>launchId</code>.
          </li>
          <li>
            Reproduce every candidate with{" "}
            <code>{reads.primaryReads[2].signature}</code> and the
            identity-specific token or pool lookup at the same canonical block.
          </li>
          <li>
            Accept the launch only when the Router binding, record, launch kind,
            identity and required proof checks succeed.
          </li>
          <li>
            Begin polling or subscription from an overlapping checkpoint so the
            backfill and live follow have no gap.
          </li>
        </ol>

        <aside className={styles.callout}>
          <strong>Reuse point verification</strong>
          <p>
            Event ingestion and point verification should return the same record
            for the same canonical block. Do not maintain a second, weaker
            acceptance path for indexed launches.
          </p>
        </aside>
      </section>

      <section id="finality">
        <div className={styles.sectionIntro}>
          <h2>Advance checkpoints only through finality</h2>
          <p>
            Keep an overlap between the stored checkpoint and the next query.
            Replay that overlap on every run.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>Deduplicate identical block, transaction and log coordinates.</li>
          <li>
            Prefer EIP-1898 reads with <code>requireCanonical: true</code>.
          </li>
          <li>
            After a reorg, rewind to the last common finalized checkpoint and
            replay.
          </li>
          <li>
            Respect <code>endBlock</code> if a future manifest retires this
            Router.
          </li>
          <li>
            Keep <code>ORPHANED</code> as an event-observation state. It is not
            a point-verification result.
          </li>
        </ul>
      </section>

      <section id="storage">
        <div className={styles.sectionIntro}>
          <h2>Store enough data to replay</h2>
          <p>
            A minimal durable index keeps the source coordinates, the
            verification block and the facts your product displays.
          </p>
        </div>

        <dl className={styles.dataList}>
          <div>
            <dt>Event coordinate</dt>
            <dd>
              Block number and hash, transaction hash and index, and log index.
            </dd>
          </div>
          <div>
            <dt>Correlation</dt>
            <dd>Launch ID, event topic and the exact Router address.</dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>
              Canonical block number and hash, result state, launch kind and the
              token or pool identity you verified.
            </dd>
          </div>
          <div>
            <dt>Checkpoint</dt>
            <dd>The last finalized block number and hash.</dd>
          </div>
        </dl>
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
            <Link href="/docs/developers/machine-readable">
              Use machine-readable docs
            </Link>
          </li>
          <li>
            <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.terminalGuideUrl}>
              Read the terminal guide on GitHub
            </a>
          </li>
        </ul>
      </nav>
    </DocsShell>
  );
}
