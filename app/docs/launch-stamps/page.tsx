import type { Metadata } from "next";

import docsStyles from "@/components/docs-experience.module.css";
import {
  LAUNCH_STAMP_RUNTIME_HASH_DEFINITION,
  LAUNCH_KIND_V1,
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ARTIFACT,
  STAMP_RECORD_V1_FIELDS,
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
  { id: "abi", label: "Frozen ABI" },
  { id: "record", label: "Returned record" },
  { id: "boundary", label: "Trust boundary" },
  { id: "integration", label: "Integration seam" },
] as const;

const abiBoundVerifier = [
  "input := token OR (PoolManager, poolId)",
  "",
  "step 1  launchId := input is token",
  "          ? launchIdByToken(token)",
  "          : launchIdByPool(PoolManager, poolId)",
  "        if launchId == bytes32(0) → NOT_STAMPED",
  "",
  "step 2  record := launchStamp(launchId)",
  "        if record.stampHash == bytes32(0) → INDETERMINATE",
  "        if identity or kind is inconsistent → INDETERMINATE",
  "",
  "return STAMPED(record)",
].join("\n");

const router = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter;
const artifact = PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ARTIFACT;
const abi = PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI;

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
        The ABI is frozen to the source artifact documented below. No address,
        authority, start block, or runtime binding is published before the
        final Router deployment is verified.
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
            <span className={styles.conceptLabel}>ABI-bound read sequence</span>
            <span>Unavailable while address is null</span>
          </div>
          <pre aria-label="Launch stamp verifier pseudocode using the frozen ABI">
            {abiBoundVerifier}
          </pre>
        </div>

        <p className={styles.scopeLine}>
          A successful zero lookup is <code>NOT_STAMPED</code>. A failed call or
          inconsistent nonzero record is <code>INDETERMINATE</code>, not a
          provenance result and not a claim that the token, pool, or project is
          unsafe.
        </p>
      </section>

      <section id="abi">
        <h2>Bind to the frozen Router ABI</h2>
        <p>
          The signatures and selectors below come from the final Router source
          artifact. They fix the call encoding, but they do not activate an
          address or make the Router live.
        </p>

        <dl className={styles.artifactBinding}>
          <div>
            <dt>Contract</dt>
            <dd>{artifact.contractName}</dd>
          </div>
          <div>
            <dt>Source commit</dt>
            <dd>{artifact.sourceCommit}</dd>
          </div>
          <div>
            <dt>Source tree</dt>
            <dd>{artifact.sourceTree}</dd>
          </div>
          <div>
            <dt>Forge artifact</dt>
            <dd>{artifact.artifactPath}</dd>
          </div>
        </dl>

        <h3 className={styles.subheading}>Primary verification reads</h3>
        <dl className={styles.abiList}>
          {abi.primaryReads.map((entry) => (
            <div key={entry.signature}>
              <dt>{entry.label}</dt>
              <dd>
                <code>{entry.signature}</code>
                <span>
                  selector <code>{entry.selector}</code> · returns{" "}
                  <code>{entry.returns}</code>
                </span>
              </dd>
            </div>
          ))}
        </dl>

        <h3 className={styles.subheading}>Exclusive-component reads</h3>
        <dl className={styles.abiList}>
          {abi.componentReads.map((entry) => (
            <div key={entry.signature}>
              <dt>{entry.label}</dt>
              <dd>
                <code>{entry.signature}</code>
                <span>
                  selector <code>{entry.selector}</code> · returns{" "}
                  <code>{entry.returns}</code>
                </span>
              </dd>
            </div>
          ))}
        </dl>

        <p className={styles.scopeLine}>
          <code>stampProof(address)</code> returns the component&apos;s exclusive
          assignment and the corresponding record hash. A Classic hook is
          shared infrastructure, so its component proof is intentionally{" "}
          <code>(bytes32(0), bytes32(0))</code> even when its launch is stamped.
          There is no universal hook getter.
        </p>

        <h3 className={styles.subheading}>Atomic write selector</h3>
        <div className={styles.atomicSignature}>
          <code>{abi.market.signature}</code>
          <span>
            selector <code>{abi.market.selector}</code> · payable · returns{" "}
            <code>{abi.market.returns}</code>
          </span>
        </div>
        <p className={styles.detailLine}>
          This is the sole market-bearing state-changing selector. Verification
          uses the read calls above and does not require a permit service,
          Registry, or application server.
        </p>
      </section>

      <section id="record">
        <h2>Decode the frozen record in order</h2>
        <p>
          <code>launchStamp(bytes32)</code> returns{" "}
          <code>StampRecordV1</code> with these fourteen fields in this exact
          order. Decode the tuple with the frozen ABI rather than a locally
          reconstructed type.
        </p>

        <div className={styles.recordLayout}>
          <div>
            <span>StampRecordV1</span>
            <span>ABI tuple order</span>
          </div>
          <ol aria-label="StampRecordV1 fields in ABI order">
            {STAMP_RECORD_V1_FIELDS.map(([type, name]) => (
              <li key={name}>
                <code>{type}</code> <strong>{name}</strong>
              </li>
            ))}
          </ol>
        </div>

        <dl className={styles.kindMap}>
          {LAUNCH_KIND_V1.map((kind) => (
            <div key={kind.name}>
              <dt>
                <code>{kind.value}</code> · {kind.name}
              </dt>
              <dd>{kind.publicLabel ?? "Not a valid stamped record kind"}</dd>
            </div>
          ))}
        </dl>

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
              Map <code>LaunchKindV1.CustomGraph</code> (<code>1</code>) to
              Programmable Custom and <code>LaunchKindV1.Classic</code> ({" "}
              <code>2</code>) to Programmable Classic. Kind is returned
              metadata; it never selects another trust root.
            </dd>
          </div>
          <div>
            <dt>Hook</dt>
            <dd>
              <code>record.hook</code> is descriptive metadata. The Classic
              hook is shared by multiple launches, so it is never a universal
              lookup or classification key.
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
        <h2>Inject the verified deployment binding</h2>
        <p>
          Keep the frozen ABI and selector map together with the eventual
          Router address, start block, runtime hash, and authority in one
          versioned binding. Application logic should receive that binding
          rather than copy addresses or rebuild calldata locally.
        </p>

        <div className={styles.implementationRule}>
          <strong>Prelaunch rule</strong>
          <p>
            The ABI and tuple layout are final. The deployment is not. While
            the address, runtime code hash, start block, or authority remains{" "}
            <code>null</code>, do not issue Router reads and do not present any
            launch as stamped. Enable the frozen read sequence only after those
            fields are published and independently verified together.
          </p>
        </div>
      </section>
    </DocsShell>
  );
}
