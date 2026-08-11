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
const bindings = router.bindings;
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
      parentLabel="Developers"
      sections={verifySections}
      title="Verify a token or pool"
    >
      <section id="binding">
        <div className={styles.sectionIntro}>
          <h2>Bind to the canonical Router</h2>
          <p>
            Read the stable discovery document, follow its{" "}
            <code>manifestUrl</code> and use the <code>launchStampRouter</code>{" "}
            entry from the deployment manifest.
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
            <dt>Published block range</dt>
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
          , hash its exact bytes and match the published digest. From that same
          ABI, derive and match every published getter selector. For every
          published event, derive and match its full signature,{" "}
          <code>topic0</code> and indexed input names and order. Derive and
          match the sole payable atomic signature{" "}
          <code>{reads.market.signature}</code> and selector{" "}
          <code>{reads.market.selector}</code> from that ABI too. If the digest
          or any derived descriptor disagrees, return <code>INDETERMINATE</code>
          {". "}At the selected block, verify the Router runtime and every
          immutable binding from the manifest.
        </p>

        <ol className={styles.steps}>
          <li>
            Require <code>status: live</code>, or <code>retired</code> only for
            a historical read inside the published block range. Require complete
            activation data from the manifest: deployment evidence, finalized
            canary evidence, getter descriptors and event descriptors.
          </li>
          <li>
            At the same canonical block, call <code>CHAIN_ID()</code> and all
            six immutable binding getters below. Match every returned value to
            the manifest.
          </li>
          <li>
            At that block, call <code>eth_getCode</code> for the permit
            authority, Graph Factory and PoolManager. Hash each runtime with EVM
            Keccak-256 and require the exact manifest runtime hash.
          </li>
        </ol>

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
            Use HTTPS for every remote Ethereum RPC. Allow plaintext HTTP only
            for loopback development endpoints.
          </li>
          <li>
            Prefer the provider&apos;s <code>finalized</code> block tag.
          </li>
          <li>
            For an explicit block, require at least{" "}
            <code>{router.finalityConfirmations}</code> confirmations.
          </li>
          <li>
            Use EIP-1898 reads with <code>requireCanonical: true</code> when the
            provider supports them.
          </li>
          <li>
            Otherwise bind every read to the resolved block number. After the
            last call, fetch that height again and require the same block hash
            before returning <code>STAMPED</code> or <code>NOT_STAMPED</code>.
          </li>
          <li>
            Require the block to fall inside the Router&apos;s published block
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
                If the canonical call returns zero, complete the closing block
                hash check when required, then return <code>NOT_STAMPED</code>.
              </li>
              <li>
                For a nonzero launch ID, continue with the complete record and
                token proof checks below.
              </li>
            </ol>
          </article>

          <article>
            <h3>From a Uniswap v4 pool</h3>
            <ol className={styles.steps}>
              <li>
                Require the supplied PoolManager to equal the immutable binding{" "}
                <code>{bindings.poolManager}</code>.
              </li>
              <li>
                Call <code>{reads.primaryReads[1].signature}</code> with that
                bound PoolManager and the pool ID.
              </li>
              <li>
                If the canonical call returns zero, complete the closing block
                hash check when required, then return <code>NOT_STAMPED</code>.
              </li>
              <li>
                For a nonzero launch ID, continue with the complete record and
                pool identity checks below.
              </li>
            </ol>
          </article>
        </div>
      </section>

      <section id="cross-check">
        <div className={styles.sectionIntro}>
          <h2>Cross-check the stamp</h2>
          <p>
            A nonzero lookup is only a candidate. Complete every check below at
            the same canonical block before returning <code>STAMPED</code>.
          </p>
        </div>

        <ol className={styles.steps}>
          <li>
            Read <code>{reads.primaryReads[2].signature}</code> with the nonzero
            launch ID and require a supported, nonzero launch kind.
          </li>
          <li>
            Require valid <code>launchWallet</code>, <code>token</code>,{" "}
            <code>hook</code>, <code>poolManager</code> and{" "}
            <code>routeLauncher</code> address fields.
          </li>
          <li>
            Require nonzero <code>poolId</code>, <code>poolKeyHash</code>,{" "}
            <code>componentSetHash</code>, <code>routePayloadHash</code>,{" "}
            <code>routeLauncherRuntimeCodeHash</code>,{" "}
            <code>expectedResultHash</code>, <code>permitDigest</code> and{" "}
            <code>stampHash</code> commitments.
          </li>
          <li>
            For every token, pool or exclusive-component query, require{" "}
            <code>record.poolManager == {bindings.poolManager}</code>. Also
            require the queried token or exact PoolManager and pool ID to match
            the record.
          </li>
          <li>
            For a token or exclusive component, require{" "}
            <code>{reads.componentReads[0].signature}</code> to return the same
            launch ID and <code>record.stampHash</code>. Also require{" "}
            <code>{reads.componentReads[2].signature}</code> for the queried
            address to return a nonzero recorded runtime hash.
          </li>
          <li>
            For <code>LaunchKindV1.CustomGraph</code>, require{" "}
            <code>record.routeLauncher</code> and{" "}
            <code>record.routeLauncherRuntimeCodeHash</code> to equal the
            immutable Graph Factory address and runtime hash. For Classic,
            retain the permit-bound values in the record; there is no Classic
            launcher immutable.
          </li>
          <li>
            Complete the closing block-hash check for number-bound reads, then
            classify only from <code>record.kind</code>.
          </li>
        </ol>

        <p className={styles.bodyCopy}>
          Names, tickers, logos, creator metadata, factory lookalikes and shared
          hook addresses are not provenance.
        </p>

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
          nonzero launch ID and stamp hash, plus a nonzero recorded runtime
          hash. You may compare the runtime returned by <code>eth_getCode</code>{" "}
          at the canonical block with that recorded hash. Report a mismatch as
          code drift. It does not change the historical Router-provenance
          result.
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
              Every canonical binding, lookup, record, identity, commitment,
              route and proof check succeeds, including the closing block-hash
              check when required.
            </dd>
          </div>
          <div>
            <dt>
              <code>NOT_STAMPED</code>
            </dt>
            <dd>
              The canonical token, pool or exclusive-component lookup succeeds,
              returns zero and passes the closing block-hash check when
              required.
            </dd>
          </div>
          <div>
            <dt>
              <code>UNAVAILABLE</code>
            </dt>
            <dd>
              The Router binding does not cover the requested block, the chain
              is inactive or required activation data is incomplete.
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
