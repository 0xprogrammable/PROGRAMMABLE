import type { Metadata } from "next";

import docsStyles from "@/components/docs-experience.module.css";
import {
  LAUNCH_STAMP_RUNTIME_HASH_DEFINITION,
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
} from "@/components/launch-stamp-docs-contract";
import styles from "@/components/launch-stamp-docs.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Launch stamps · Programmable",
  description:
    "Verify provenance for future Programmable Classic and Custom launches through the canonical Launch Stamp Router.",
  alternates: { canonical: "/docs/launch-stamps" },
};

const sections = [
  { id: "trust-root", label: "Trust root" },
  { id: "algorithm", label: "Verification algorithm" },
  { id: "record", label: "Returned record" },
  { id: "boundary", label: "Trust boundary" },
  { id: "integration", label: "Integration seam" },
] as const;

const conceptualVerifier = [
  "input := token OR (PoolManager, poolId)",
  "",
  "step 1  resolve input with the canonical Router → launchId",
  "        if no launchId is returned → NOT_STAMPED",
  "",
  "step 2  read launchStamp at launchId from the same Router",
  "        if no record is returned → NOT_STAMPED",
  "",
  "return launchStamp",
].join("\n");

const router = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter;

const manifestFields = [
  ["version", router.version],
  ["generation", router.generation],
  ["address", router.address],
  ["startBlock", router.startBlock],
  ["runtimeCodeHash", router.runtimeCodeHash],
  ["authority", router.authority],
  ["abi", router.abi],
] as const;

function PrelaunchTrustRoot() {
  return (
    <section
      aria-labelledby="trust-root-heading"
      className={styles.trustRoot}
      data-launch-stamp-docs
    >
      <div className={styles.trustRootHeader}>
        <div>
          <p>Canonical trust root</p>
          <h2 id="trust-root-heading">Launch Stamp Router</h2>
        </div>
        <span className={styles.status}>Status: {router.status}</span>
      </div>

      <dl className={styles.manifest}>
        {manifestFields.map(([field, value]) => (
          <div key={field}>
            <dt>{field}</dt>
            <dd>{value ?? "null"}</dd>
          </div>
        ))}
      </dl>

      <p className={styles.hashDefinition}>
        <code>runtimeCodeHash</code> means {LAUNCH_STAMP_RUNTIME_HASH_DEFINITION}{" "}
        No address, ABI, authority, start block, or runtime binding is published
        before the final Router deployment is verified.
      </p>
    </section>
  );
}

export default function LaunchStampDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/launch-stamps"
      description="For launches created after Router activation, resolve a token or Uniswap v4 market and read its launch stamp from one canonical contract. The result establishes Programmable provenance only."
      heroAside={<PrelaunchTrustRoot />}
      heroId="trust-root"
      kicker="Developer provenance"
      sections={sections}
      title="Verify future launches at one trust root."
    >
      <section id="algorithm">
        <h2>Use one verification algorithm</h2>
        <p className={docsStyles.lead}>
          Recognition has two steps. Resolve the launch identifier from either
          the token or the Uniswap v4 market identity, then read the launch
          stamp at that identifier from the same Router.
        </p>

        <ol
          aria-label="Launch stamp verification flow"
          className={styles.algorithmTrace}
        >
          <li className={styles.traceNode}>
            <span>Recognition input</span>
            <strong>token or (PoolManager, poolId)</strong>
          </li>
          <li className={styles.traceNode}>
            <span>Step 1</span>
            <strong>launchId</strong>
          </li>
          <li className={styles.traceNode}>
            <span>Step 2</span>
            <strong>launchStamp record</strong>
          </li>
        </ol>

        <div className={styles.concept}>
          <div className={styles.conceptHeader}>
            <span className={styles.conceptLabel}>Conceptual pseudocode</span>
            <span>Not executable calldata</span>
          </div>
          <pre aria-label="Conceptual launch stamp verifier pseudocode">
            {conceptualVerifier}
          </pre>
        </div>

        <p className={styles.scopeLine}>
          A missing record means Programmable provenance is not established. It
          is not a claim that the token, pool, or project is unsafe.
        </p>
      </section>

      <section id="record">
        <h2>Keep record semantics separate</h2>
        <p>
          The final ABI will define the encoded tuple. Until that artifact is
          frozen, consumers should bind only to these stable interpretation
          rules and keep decoding behind an injected ABI adapter.
        </p>

        <dl className={styles.recordList}>
          <div>
            <dt>Identity</dt>
            <dd>
              <code>launchId</code> is the key used to read the stamp. Do not
              replace it with a name, ticker, creator label, or hook address.
            </dd>
          </div>
          <div>
            <dt>Recognition</dt>
            <dd>
              Accept either a token address or the pair{" "}
              <code>(PoolManager, poolId)</code>. These are two inputs to the
              same Router algorithm, not separate trust systems.
            </dd>
          </div>
          <div>
            <dt>Launch kind</dt>
            <dd>
              Read <code>LaunchKindV1.CustomGraph</code> or{" "}
              <code>LaunchKindV1.Classic</code> as returned metadata. Do not
              choose a trust root or verification path from the kind.
            </dd>
          </div>
          <div>
            <dt>Hook</dt>
            <dd>
              A returned hook is descriptive metadata. It is not a universal
              lookup key because more than one launch can use the same hook.
            </dd>
          </div>
        </dl>
      </section>

      <section id="boundary">
        <h2>A stamp proves provenance, and only provenance</h2>
        <p>
          A valid record says that the canonical Router recognizes the launch
          under the returned identity. Keep every other product or risk decision
          outside this result.
        </p>

        <dl className={styles.boundaryList}>
          <div>
            <dt>It establishes</dt>
            <dd>
              Programmable origin for the returned future Classic or Custom
              launch record on the configured chain.
            </dd>
          </div>
          <div>
            <dt>It does not establish</dt>
            <dd>
              Safety, tradability, liquidity, audit coverage, review status,
              approval, endorsement, or permission to launch.
            </dd>
          </div>
          <div>
            <dt>It does not require</dt>
            <dd>
              A Registry, indexer, Supabase project, Programmable API, or
              application server. Read the Router directly through an Ethereum
              provider.
            </dd>
          </div>
          <div>
            <dt>It excludes</dt>
            <dd>
              Historical launches created before Router activation. Do not
              backfill them or infer stamps from legacy contracts and events.
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.finalSection} id="integration">
        <h2>Inject the final binding</h2>
        <p>
          Keep the Router address, ABI, start block, runtime hash, authority,
          and selector encoding in one versioned binding. Application logic
          should receive that binding rather than hardcode provisional names or
          calldata.
        </p>

        <div className={styles.implementationRule}>
          <strong>Prelaunch rule</strong>
          <p>
            While any required binding field above is <code>null</code>, do not
            issue Router reads and do not present any launch as stamped. Replace
            the conceptual pseudocode only after the final artifact and
            deployment evidence are published together.
          </p>
        </div>
      </section>
    </DocsShell>
  );
}
