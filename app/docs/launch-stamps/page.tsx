import type { Metadata } from "next";

import docsStyles from "@/components/docs-experience.module.css";
import {
  LAUNCH_STAMP_RUNTIME_HASH_DEFINITION,
  LAUNCH_KIND_V1,
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_RESOURCES,
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
  { id: "indexing", label: "Terminal indexing" },
  { id: "record", label: "Returned record" },
  { id: "boundary", label: "Trust boundary" },
  { id: "integration", label: "Live deployment" },
] as const;

const abiBoundVerifier = [
  "input := token OR (PoolManager, poolId)",
  "",
  "preflight  resolve one finalized canonical block",
  "           require chainId, block range, Router runtime,",
  "           and immutable bindings to match the manifest",
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
const chainId = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.chainId;
const deployment = router.deploymentEvidence;
const bindings = router.bindings;
const canary = router.canaryEvidence;
const artifact = PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ARTIFACT;
const abi = PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI;
const events = Object.values(router.events);

const terminalLogFilter = JSON.stringify(
  {
    address: router.address,
    fromBlock: "0x1886b6c",
    toBlock: "finalized",
    topics: [events.map((event) => event.topic0)],
  },
  null,
  2,
);

const manifestFields = [
  ["chainId", chainId],
  ["version", router.version],
  ["generation", router.generation],
  ["address", router.address],
  ["startBlock", router.startBlock],
  ["endBlock", router.endBlock],
  ["runtimeCodeHash", router.runtimeCodeHash],
  ["finalityConfirmations", router.finalityConfirmations],
  ["abiSha256", router.abiSha256],
] as const;

const deploymentEvidenceFields = [
  ["verificationStatus", deployment.verificationStatus],
  ["address", deployment.address],
  ["deploymentTransactionHash", deployment.deploymentTransactionHash],
  ["deploymentBlockNumber", deployment.deploymentBlockNumber],
  ["deploymentBlockHash", deployment.deploymentBlockHash],
  ["finalizedBlockNumber", deployment.finalizedBlockNumber],
  ["finalizedBlockHash", deployment.finalizedBlockHash],
  ["finalityDepth", deployment.finalityDepth],
  ["runtimeCodeBytes", deployment.runtimeCodeBytes],
  ["runtimeCodeKeccak256", deployment.runtimeCodeKeccak256],
  ["runtimeCodeSha256", deployment.runtimeCodeSha256],
  ["getterBundleSha256", deployment.getterBundleSha256],
  ["evidenceSha256", deployment.evidenceSha256],
] as const;

const activationBindingFields = [
  ["permitAuthority", bindings.permitAuthority],
  ["permitAuthorityRuntimeCodeHash", bindings.permitAuthorityRuntimeCodeHash],
  ["graphFactory", bindings.graphFactory],
  ["graphFactoryRuntimeCodeHash", bindings.graphFactoryRuntimeCodeHash],
  ["poolManager", bindings.poolManager],
  ["poolManagerRuntimeCodeHash", bindings.poolManagerRuntimeCodeHash],
] as const;

const canaryIdentityFields = [
  ["finality", canary.finality],
  [
    "customGraphOnchainCanary",
    String(canary.routeCoverage.customGraphOnchainCanary),
  ],
  ["classicOnchainCanary", String(canary.routeCoverage.classicOnchainCanary)],
  ["transactionHash", canary.transactionHash],
  ["blockNumber", canary.blockNumber],
  ["blockHash", canary.blockHash],
  ["launchId", canary.launchId],
  ["stampHash", canary.stampHash],
  ["launchKind", canary.launchKind],
  ["sourceRepository", canary.source.sourceRepository],
  ["sourceCommit", canary.source.sourceCommit],
  ["commitSubject", canary.source.commitSubject],
  ["evidenceFileSha256", canary.evidenceFileSha256],
  ["evidenceLineSha256", canary.evidenceLineSha256],
] as const;

const canaryObservationFields = [
  ["initializer", canary.components.initializer],
  ["token", canary.components.token],
  ["hook", canary.components.hook],
  ["poolManager", canary.pool.poolManager],
  ["poolId", canary.pool.poolId],
  ["activeLiquidity", canary.pool.activeLiquidity],
  ["positionManager", canary.lpPosition.positionManager],
  ["lpNftTokenId", canary.lpPosition.tokenId],
  ["lpNftOwner", canary.lpPosition.owner],
  ["platformFeePips", canary.platformFee.feePips],
  ["platformFeeRecipient", canary.platformFee.recipient],
  ["tokenTotalSupply", canary.tokenTotalSupply],
] as const;

function LiveTrustRoot() {
  return (
    <section
      aria-labelledby="trust-root-heading"
      className={styles.trustRoot}
      data-launch-stamp-docs
    >
      <div className={styles.trustRootHeader}>
        <div>
          <p>Canonical activation binding</p>
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
        <code>runtimeCodeHash</code> means{" "}
        {LAUNCH_STAMP_RUNTIME_HASH_DEFINITION} The live tuple above activates
        direct verification for Router stamps at or after{" "}
        <code>startBlock</code>. A terminal must still validate the Router
        runtime and immutable bindings at the same canonical block as each
        lookup.
      </p>
    </section>
  );
}

export default function LaunchStampDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/launch-stamps"
      description="For launches stamped through the live Router, resolve a token or Uniswap v4 market and read its record from one canonical contract. The result establishes Programmable provenance only."
      heroAside={<LiveTrustRoot />}
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
            <span>Live on Ethereum · finalized reads</span>
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
          artifact. They fix the call encoding. Bind them to the live address,
          runtime code hash, and immutable getters before classifying a result.
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
          <div>
            <dt>Published ABI</dt>
            <dd>
              <a href={router.abiUrl}>{router.abiUrl}</a>
            </dd>
          </div>
          <div>
            <dt>ABI file SHA-256</dt>
            <dd>{router.abiSha256}</dd>
          </div>
          <div>
            <dt>GitHub ABI source</dt>
            <dd>
              <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiGithubUrl}>
                Exact published file
              </a>
            </dd>
          </div>
        </dl>

        <p className={styles.detailLine}>
          Hash the exact downloaded ABI file bytes. Do not normalize or
          reserialize the JSON before comparing its SHA-256 digest.
        </p>

        <h3 className={styles.subheading}>Trust-root reads</h3>
        <dl className={styles.abiList}>
          {abi.bindingReads.map((entry) => (
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
          <code>stampProof(address)</code> returns the component&apos;s
          exclusive assignment and the corresponding record hash. A Classic hook
          is shared infrastructure, so its component proof is intentionally{" "}
          <code>(bytes32(0), bytes32(0))</code> even when its launch is stamped.
          There is no universal hook getter.
        </p>

        <h3 className={styles.subheading}>Discovery events</h3>
        <dl className={styles.abiList}>
          {events.map((event) => (
            <div key={event.topic0}>
              <dt>{event.name}</dt>
              <dd>
                <code>{event.signature}</code>
                <span>
                  topic0 <code>{event.topic0}</code>
                </span>
                <span>
                  indexed: <code>{event.indexedInputs.join(", ")}</code>
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className={styles.detailLine}>
          A matching topic is only a discovery candidate. Accept it only when
          the emitter is the exact Router address on chain <code>1</code>, then
          reproduce the record with canonical getter reads.
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

      <section id="indexing">
        <h2>Backfill once, then follow finalized logs</h2>
        <p className={docsStyles.lead}>
          Terminals can discover every future Router stamp with one Ethereum log
          stream. The filter is exact; the log is only an index candidate until
          the point verifier reproduces it. Require{" "}
          <code>eth_chainId == 0x1</code> before issuing this standard JSON-RPC
          filter.
        </p>

        <div className={styles.concept}>
          <div className={styles.conceptHeader}>
            <span className={styles.conceptLabel}>eth_getLogs filter</span>
            <span>Ethereum · canonical Router only</span>
          </div>
          <pre aria-label="Launch stamp Router event filter">
            {terminalLogFilter}
          </pre>
        </div>

        <dl className={styles.recordList}>
          <div>
            <dt>1 · Bind</dt>
            <dd>
              Verify chain, Router address, runtime, ABI URL and SHA-256,
              topics, getters, immutable bindings, block range, and finality
              policy before accepting any log.
            </dd>
          </div>
          <div>
            <dt>2 · Backfill</dt>
            <dd>
              Scan <code>eth_getLogs</code> in bounded chunks from block{" "}
              <code>{router.startBlock}</code> to a finalized boundary. Respect{" "}
              <code>endBlock</code> if a future manifest retires this Router.
            </dd>
          </div>
          <div>
            <dt>3 · Persist and dedupe</dt>
            <dd>
              Retain block number and hash, transaction hash and index, and log
              index. Use those coordinates as the idempotency key so an overlap
              can be replayed without duplicate classifications.
            </dd>
          </div>
          <div>
            <dt>4 · Verify candidates</dt>
            <dd>
              Decode each log by its matched signature and correlate the three
              event types by <code>launchId</code>. Only{" "}
              <code>ProgrammableLaunchStampedV1</code> supplies token and hook,
              plus the non-indexed PoolManager, poolId, and stampHash. Read the
              record at the same canonical block and classify only from{" "}
              <code>record.kind</code>.
            </dd>
          </div>
          <div>
            <dt>5 · Checkpoint</dt>
            <dd>
              Advance a durable checkpoint only through the finalized boundary.
              Explicit block-number reads require at least{" "}
              <code>{router.finalityConfirmations}</code> confirmations.
            </dd>
          </div>
          <div>
            <dt>6 · Replay overlap</dt>
            <dd>
              Re-read an overlap window on every run. Deduplicate identical
              coordinates and apply corrections idempotently before moving the
              checkpoint.
            </dd>
          </div>
          <div>
            <dt>7 · Handle reorgs</dt>
            <dd>
              Prefer EIP-1898 reads with <code>requireCanonical: true</code>. If
              a stored block hash changes, orphan the affected observations,
              rewind to the last common finalized checkpoint, and replay.
            </dd>
          </div>
          <div>
            <dt>8 · Hand off to live</dt>
            <dd>
              After backfill reaches finality, poll or subscribe from the
              overlapping checkpoint. Reconcile every notification through the
              same log and getter checks before advancing, leaving no
              backfill-to-live gap.
            </dd>
          </div>
        </dl>

        <h3 className={styles.subheading}>Verify each supported identity</h3>
        <dl className={styles.boundaryList}>
          <div>
            <dt>Token</dt>
            <dd>
              Require <code>launchIdByToken(token)</code>,{" "}
              <code>record.token == token</code>, and{" "}
              <code>stampProof(token) == (launchId, record.stampHash)</code>.
            </dd>
          </div>
          <div>
            <dt>v4 pool</dt>
            <dd>
              Require <code>launchIdByPool(PoolManager, poolId)</code> and exact
              equality with <code>record.poolManager</code> and{" "}
              <code>record.poolId</code>. PoolManager must equal the published
              immutable binding.
            </dd>
          </div>
          <div>
            <dt>Exclusive component</dt>
            <dd>
              Require <code>launchIdByComponent(component)</code>, matching{" "}
              <code>stampProof(component)</code>, and equality between{" "}
              <code>componentRuntimeCodeHash(component)</code> and the component
              runtime read at the same block.
            </dd>
          </div>
        </dl>

        <p className={styles.scopeLine}>
          Token and pool are the interoperable terminal inputs. A Custom hook
          may also be an exclusive component; the shared Classic hook never
          identifies a launch. Zero means not stamped only after a successful
          canonical call. RPC or consistency failures remain indeterminate.
        </p>

        <h3 className={styles.subheading}>Canonical integration resources</h3>
        <dl className={styles.artifactBinding}>
          <div>
            <dt>Discovery</dt>
            <dd>
              <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.discoveryUrl}>
                {PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.discoveryUrl}
              </a>
            </dd>
          </div>
          <div>
            <dt>Router reference</dt>
            <dd>
              <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.referenceUrl}>
                Full verification contract
              </a>
            </dd>
          </div>
          <div>
            <dt>Terminal guide</dt>
            <dd>
              <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.terminalGuideUrl}>
                Backfill, live-follow, and reorg policy
              </a>
            </dd>
          </div>
          <div>
            <dt>JSON-RPC verifier</dt>
            <dd>
              <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.jsonRpcVerifierUrl}>
                Dependency-light implementation
              </a>
            </dd>
          </div>
          <div>
            <dt>viem verifier</dt>
            <dd>
              <a href={PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.viemVerifierUrl}>
                TypeScript implementation
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section id="record">
        <h2>Decode the frozen record in order</h2>
        <p>
          <code>launchStamp(bytes32)</code> returns <code>StampRecordV1</code>{" "}
          with these fourteen fields in this exact order. Decode the tuple with
          the frozen ABI rather than a locally reconstructed type.
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
              <code>record.hook</code> is descriptive metadata. The Classic hook
              is shared by multiple launches, so it is never a universal lookup
              or classification key.
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
              Canonical Router route and origin for the returned Classic or
              Custom launch record at or after <code>startBlock</code>. It does
              not claim that every recorded component was newly created; shared
              Classic infrastructure can be recorded by reference.
            </dd>
          </div>
          <div>
            <dt>Atomic v4 pool check</dt>
            <dd>
              For the exact recorded pool, the Router requires{" "}
              <code>slot0.sqrtPriceX96 == 0</code> immediately before its
              authorized launch call and <code>slot0.sqrtPriceX96 != 0</code>{" "}
              immediately after it, then writes the stamp in the same
              transaction. This establishes initialization during that atomic
              launch, not current pool state or liquidity.
            </dd>
          </div>
          <div>
            <dt>It does not establish</dt>
            <dd>
              Safety, tradability, current pool state, current liquidity, audit
              coverage, review status, approval, endorsement, or permission to
              launch.
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
              Direct Classic Factory, Graph Factory, or Single Factory calls
              outside the canonical Router do not create Router provenance.
            </dd>
          </div>
          <div>
            <dt>Third-party support</dt>
            <dd>
              A stamp does not automatically list a coin in GMGN, Axiom, FOMO,
              or any other terminal. Each consumer decides whether and how to
              integrate this public verification contract. Generic pool or token
              discovery in a third-party API is not Router stamp integration and
              must not be presented as Programmable provenance. GMGN market
              numbers are not canonical onchain stamp evidence; read current
              pool state separately through PoolManager or StateView.
            </dd>
          </div>
          <div>
            <dt>Launch operations</dt>
            <dd>
              The public GitHub approval → permit → wallet self-service flow is
              not live. This reference activates read-only provenance detection,
              not public launch authorization.
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.finalSection} id="integration">
        <h2>Bind to the live Router</h2>
        <p>
          The activation tuple is live on Ethereum. The deployment evidence
          identifies the exact Router runtime, and the immutable bindings below
          must match at the canonical block used for every lookup.
        </p>

        <h3 className={styles.subheading}>Finalized deployment evidence</h3>
        <dl className={styles.artifactBinding}>
          {deploymentEvidenceFields.map(([field, value]) => (
            <div key={field}>
              <dt>{field}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.detailLine}>
          <code>finalized-verified</code> describes the deployment receipt,
          runtime, and immutable getter evidence. It is not an Explorer source
          publication status. The SHA-256 values are supplied handoff digests;
          this Website repository did not independently download and recompute
          their source evidence files.
        </p>

        <h3 className={styles.subheading}>Live immutable bindings</h3>
        <dl className={styles.artifactBinding}>
          {activationBindingFields.map(([field, value]) => (
            <div key={field}>
              <dt>{field}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <h3 className={styles.subheading}>
          Finalized CustomGraph canary (PCAN vector)
        </h3>
        <p>
          The PCAN point-in-time test vector covers the CustomGraph route.
          <code>PCAN</code> is the human-readable token symbol, not another
          canary, launch, or trust identifier. There is no separate Classic
          onchain canary claim. Future Classic stamps use the same live Router
          ABI and become verifiable when their records exist.
        </p>
        <dl className={styles.artifactBinding}>
          {canaryIdentityFields.map(([field, value]) => (
            <div key={field}>
              <dt>{field}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.detailLine}>
          Canary source commit <code>{canary.source.sourceCommit}</code> is
          separate from Router artifact source commit{" "}
          <code>{artifact.sourceCommit}</code> and does not replace it. The
          canary SHA-256 fields are supplied handoff digests; this Website
          repository did not independently download or recompute their evidence
          files and does not host them.
        </p>

        <h3 className={styles.subheading}>Canary observations</h3>
        <dl className={styles.artifactBinding}>
          {canaryObservationFields.map(([field, value]) => (
            <div key={field}>
              <dt>{field}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <h3 className={styles.subheading}>Canary component proofs</h3>
        <dl className={`${styles.abiList} ${styles.proofList}`}>
          {canary.stampProofs.map((proof) => (
            <div key={proof.component}>
              <dt>{proof.component}</dt>
              <dd>
                <code>{proof.launchId}</code>
                <span>
                  stampHash <code>{proof.stampHash}</code>
                </span>
              </dd>
            </div>
          ))}
        </dl>

        <div className={styles.implementationRule}>
          <strong>Classification rule</strong>
          <p>
            Resolve one finalized canonical block, enforce the published block
            range, and validate the Router runtime and immutable bindings. Only
            a consistent nonzero record is stamped. A canonical zero lookup is
            not stamped; a failed call or mismatch is indeterminate.
          </p>
        </div>
      </section>
    </DocsShell>
  );
}
