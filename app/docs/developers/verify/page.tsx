import type { Metadata } from "next";
import Link from "next/link";

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
  title: "Verify a token or pool · Programmable",
  description:
    "Verify Programmable provenance for a token or Uniswap v4 pool through the canonical Launch Stamp Router.",
  alternates: { canonical: "/docs/developers/verify" },
};

const manifest = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST;
const router = manifest.launchStampRouter;
const reads = PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI;
const canary = router.canaryEvidence;
const supportedKinds = LAUNCH_KIND_V1.filter(
  (kind) => kind.publicLabel !== null,
);

const verifySections = [
  { id: "binding", label: "Router binding" },
  { id: "canonical-block", label: "Canonical block" },
  { id: "resolve", label: "Resolve the launch" },
  { id: "cross-check", label: "Cross-check the stamp" },
  { id: "results", label: "Result states" },
  { id: "pcan", label: "PCAN test vector" },
  { id: "failures", label: "Failure handling" },
] as const;

export default function VerifyLaunchPage() {
  return (
    <DocsShell
      currentPath="/docs/developers/verify"
      description="Resolve a token or Uniswap v4 pool to one Router record and cross-check it at a single canonical block."
      kicker="Developer integration"
      parentHref="/docs/developers"
      parentLabel="Developer integration"
      sections={verifySections}
      title="Verify a token or pool"
    >
      <section id="binding">
        <div className={styles.sectionIntro}>
          <h2>Bind to the canonical Router</h2>
          <p>
            Read the stable discovery document, follow its{" "}
            <code>manifestUrl</code> and use the <code>launchStampRouter</code>{" "}
            entry from the live manifest.
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
            <dt>Live range</dt>
            <dd>
              <code>{router.startBlock}</code> to{" "}
              <code>{router.endBlock ?? "open"}</code>
            </dd>
          </div>
          <div>
            <dt>Runtime code hash</dt>
            <dd className={styles.breakableValue}>
              <code>{router.runtimeCodeHash}</code>
            </dd>
          </div>
          <div>
            <dt>ABI SHA-256</dt>
            <dd className={styles.breakableValue}>
              <code>{router.abiSha256}</code>
            </dd>
          </div>
        </dl>

        <p className={styles.bodyCopy}>
          Download the{" "}
          <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl}>
            hosted Router ABI
          </a>
          , hash its exact bytes and match the published digest. At the selected
          block, verify the Router runtime and every immutable binding from the
          manifest.
        </p>

        <ul className={styles.codeList}>
          {reads.bindingReads.map((read) => (
            <li key={read.selector}>
              <code>{read.signature}</code>
              <span>{read.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="canonical-block">
        <div className={styles.sectionIntro}>
          <h2>Use one canonical block</h2>
          <p>
            Resolve one finalized block before the first contract read. Use that
            same block for the Router runtime, bindings, lookup, stamp record
            and proof.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            Prefer the provider&apos;s <code>finalized</code> block tag.
          </li>
          <li>
            For an explicit block, require at least{" "}
            <code>{router.finalityConfirmations}</code> confirmations.
          </li>
          <li>
            Prefer EIP-1898 reads with <code>requireCanonical: true</code>.
          </li>
          <li>
            Require the block to fall inside the Router&apos;s published live
            range.
          </li>
        </ul>
      </section>

      <section id="resolve">
        <div className={styles.sectionIntro}>
          <h2>Resolve the launch ID</h2>
          <p>
            Start from the identity your product already has. A successful zero
            lookup is the only direct <code>NOT_STAMPED</code> result.
          </p>
        </div>

        <div className={styles.guideColumns}>
          <article>
            <h3>From a token address</h3>
            <ol className={styles.steps}>
              <li>
                Call <code>{reads.primaryReads[0].signature}</code>.
              </li>
              <li>
                If the canonical call returns zero, return{" "}
                <code>NOT_STAMPED</code>.
              </li>
              <li>
                Call <code>{reads.primaryReads[2].signature}</code> with the
                nonzero launch ID.
              </li>
              <li>
                Require <code>record.token == token</code> and a supported,
                nonzero launch kind.
              </li>
              <li>
                Call <code>{reads.componentReads[0].signature}</code> for the
                token. Require the same launch ID and{" "}
                <code>record.stampHash</code>.
              </li>
            </ol>
          </article>

          <article>
            <h3>From a Uniswap v4 pool</h3>
            <ol className={styles.steps}>
              <li>
                Call <code>{reads.primaryReads[1].signature}</code> with the
                PoolManager and pool ID.
              </li>
              <li>
                If the canonical call returns zero, return{" "}
                <code>NOT_STAMPED</code>.
              </li>
              <li>
                Call <code>{reads.primaryReads[2].signature}</code> with the
                nonzero launch ID.
              </li>
              <li>
                Require exact equality with <code>record.poolManager</code> and{" "}
                <code>record.poolId</code>, plus a supported, nonzero launch
                kind.
              </li>
            </ol>
          </article>
        </div>
      </section>

      <section id="cross-check">
        <div className={styles.sectionIntro}>
          <h2>Cross-check the stamp</h2>
          <p>
            Classify the launch only from the returned record. Names, tickers,
            logos, creator metadata, factory lookalikes and shared hook
            addresses are not provenance.
          </p>
        </div>

        <dl className={styles.resultList}>
          {supportedKinds.map((kind) => (
            <div key={kind.value}>
              <dt>
                <code>{kind.value}</code>
              </dt>
              <dd>
                <strong>{kind.publicLabel}</strong>
                <span>
                  <code>LaunchKindV1.{kind.name}</code>
                </span>
              </dd>
            </div>
          ))}
        </dl>

        <h3 className={styles.subheading}>Exclusive components</h3>
        <p className={styles.bodyCopy}>
          For a component used by only one launch, call{" "}
          <code>{reads.componentReads[1].signature}</code>,{" "}
          <code>{reads.componentReads[0].signature}</code> and{" "}
          <code>{reads.componentReads[2].signature}</code>. Require the same
          nonzero launch ID and stamp hash. Hash the runtime bytecode returned
          by <code>eth_getCode</code> at the same block with EVM Keccak-256 and
          match the recorded runtime hash.
        </p>

        <aside className={styles.callout}>
          <strong>Shared Classic hook</strong>
          <p>
            The shared Classic hook is not a launch identifier. Use the token or
            exact pool identity for a Classic launch.
          </p>
        </aside>
      </section>

      <section id="results">
        <div className={styles.sectionIntro}>
          <h2>Return one of four results</h2>
        </div>

        <dl className={styles.resultList}>
          <div>
            <dt>
              <code>STAMPED</code>
            </dt>
            <dd>
              Every canonical binding, lookup, identity, kind and proof check
              succeeds.
            </dd>
          </div>
          <div>
            <dt>
              <code>NOT_STAMPED</code>
            </dt>
            <dd>
              The canonical token or pool lookup succeeds and returns zero.
            </dd>
          </div>
          <div>
            <dt>
              <code>UNAVAILABLE</code>
            </dt>
            <dd>
              The Router is not live for the requested block, the chain is
              inactive or required activation data is incomplete.
            </dd>
          </div>
          <div>
            <dt>
              <code>INDETERMINATE</code>
            </dt>
            <dd>
              RPC, ABI, runtime, block, decoding or cross-check evidence is
              incomplete or inconsistent.
            </dd>
          </div>
        </dl>
      </section>

      <section id="pcan">
        <div className={styles.sectionIntro}>
          <h2>Test with the finalized PCAN vector</h2>
          <p>
            This CustomGraph launch is the published end-to-end integration
            vector.
          </p>
        </div>

        <dl className={styles.dataList + " " + styles.technicalData}>
          <div>
            <dt>Transaction</dt>
            <dd>
              <code>{canary.transactionHash}</code>
            </dd>
          </div>
          <div>
            <dt>Block</dt>
            <dd>
              <code>{canary.blockNumber}</code>
            </dd>
          </div>
          <div>
            <dt>Launch ID</dt>
            <dd>
              <code>{canary.launchId}</code>
            </dd>
          </div>
          <div>
            <dt>Stamp hash</dt>
            <dd>
              <code>{canary.stampHash}</code>
            </dd>
          </div>
          <div>
            <dt>Token</dt>
            <dd>
              <code>{canary.components.token}</code>
            </dd>
          </div>
          <div>
            <dt>Hook</dt>
            <dd>
              <code>{canary.components.hook}</code>
            </dd>
          </div>
          <div>
            <dt>Initializer</dt>
            <dd>
              <code>{canary.components.initializer}</code>
            </dd>
          </div>
          <div>
            <dt>PoolManager</dt>
            <dd>
              <code>{canary.pool.poolManager}</code>
            </dd>
          </div>
          <div>
            <dt>Pool ID</dt>
            <dd>
              <code>{canary.pool.poolId}</code>
            </dd>
          </div>
          <div>
            <dt>Launch kind</dt>
            <dd>
              <code>{canary.launchKind}</code> · Programmable Custom
            </dd>
          </div>
        </dl>

        <p className={styles.bodyCopy}>
          The token, pool and exclusive components must resolve to the same
          launch ID and stamp hash.
        </p>
      </section>

      <section id="failures">
        <div className={styles.sectionIntro}>
          <h2>Do not turn missing evidence into a negative result</h2>
        </div>

        <ul className={styles.checkList}>
          <li>
            A timeout, pruned block, malformed response or chain mismatch is{" "}
            <code>INDETERMINATE</code>.
          </li>
          <li>
            An unavailable finalized block or inconsistent nonzero response is{" "}
            <code>INDETERMINATE</code>.
          </li>
          <li>
            <code>ORPHANED</code> describes an event observation after a reorg.
            It is not a point-verification result.
          </li>
        </ul>

        <aside className={styles.callout}>
          <strong>Verification boundary</strong>
          <p>
            A Router record establishes provenance after these checks pass. It
            does not establish safety, tradability, current liquidity or pool
            state, audit coverage, review status, endorsement or terminal
            support.
          </p>
        </aside>
      </section>

      <nav
        aria-label="Continue developer integration"
        className={styles.nextLinks}
      >
        <p>Continue</p>
        <ul>
          <li>
            <Link href="/docs/developers/indexing">Index new launches</Link>
          </li>
          <li>
            <Link href="/docs/developers/machine-readable">
              Use machine-readable docs
            </Link>
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
