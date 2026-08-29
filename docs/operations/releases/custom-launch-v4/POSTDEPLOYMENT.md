# Robinhood foundation postdeployment closure

The postdeployment assembler is the only supported path from the immutable
`prepared-not-broadcast` foundation to a live Robinhood chain-deployment descriptor. It is
offline. It cannot sign, broadcast, submit source verification, call an RPC, activate an indexer,
publish a package, or authorize public writes.

The prepared artifact remains at
`contracts/deployments/robinhood-custom-launch-v1.predeployment.json`. The assembler pins its exact
SHA-256 digest and refuses to continue if its bytes or prepared state change. It derives a new file
at `contracts/deployments/robinhood-custom-launch-v1.json`; it never edits or renames the prepared
artifact.

## Commands

Run the focused offline tests:

```sh
npm run contracts:robinhood:postdeploy:test
npm run release:custom-launch:v4:test
```

Assemble and verify a closed bundle without changing either canonical artifact:

```sh
npm run contracts:robinhood:postdeploy:assemble -- \
  --input /absolute/path/postdeployment-input.json \
  --output /absolute/path/robinhood-mainnet-promotion-bundle.json \
  --repository-root "$PWD"

npm run contracts:robinhood:postdeploy:verify -- \
  --bundle /absolute/path/robinhood-mainnet-promotion-bundle.json \
  --repository-root "$PWD"
```

After independent review, materialize the derived live descriptor and replace the blocked CLI
binding with the closed binding:

```sh
npm run contracts:robinhood:postdeploy:apply -- \
  --bundle /absolute/path/robinhood-mainnet-promotion-bundle.json \
  --repository-root "$PWD"
```

`apply` writes the live descriptor first and `cli-release-binding.json` last, then runs the existing
release-ready verifier. A partial write cannot make the release binding ready. The command also
re-hashes the prepared artifact after the write. It does not change an external system.

## Exact input contract

The top-level input has exactly these fields:

```text
schemaVersion
chainDeploymentId
providers
ethereumFinality
sourceVerification
sourceClosure
```

`schemaVersion` is
`programmable.robinhood-custom-launch.postdeployment-input.v1` and `chainDeploymentId` is
`robinhood-mainnet-custom-launch-v1`.

`providers` contains exactly two entries in this order:

1. `providerId: drpc`, `trustDomain: drpc.org`
2. `providerId: alchemy`, `trustDomain: alchemy.com`

Each entry is a closed, normalized provider capture with exactly:

- `transaction`: transaction hash, exact allowed sender, Multicall3 target, zero value,
  `0x82ad56cb` selector, 33,412-byte calldata hash, nonce, transaction index and deployment block;
- `receipt`: the matching successful receipt and its strictly ordered canonical logs;
- `multicall3`: the pinned target address and runtime hash at the deployment block;
- `atomicRoots`: ordered D-1 and D code observations for PermitAuthority, GraphFactory and Router;
- `routerState`: exact chain ID and the Router's PermitAuthority, GraphFactory and PoolManager
  address/runtime getter bindings;
- `safeState`: proxy, singleton and fallback-handler code; version; ordered owners; threshold; fresh
  nonce; modules page; guard; and exact storage words at the deployment block;
- `permit2Genesis`: exact block-zero Permit2 allocation readback; and
- `externalRoots`: ordered PoolManager, PositionManager, StateView, V4Quoter and UniversalRouter
  deployment receipt/runtime readbacks tied to the pinned Uniswap registry tuple.

The two normalized transaction and receipt objects must match byte-for-byte after canonical JSON
normalization. Both providers must agree on the deployment block, every D-1 hash, each final
runtime, Safe state, Permit2 genesis block and every external-root receipt. Provider labels alone
are not transport authentication. The operator must retain the independently captured raw provider
responses whose digests produced the normalized input.

`ethereumFinality` uses
`programmable.robinhood-l2-checkpoint-ethereum-finality-input.v1`. It binds the exact L2 deployment
block to the Robinhood batch, ordered dRPC/Alchemy L2 observations, ordered dRPC/QuickNode Ethereum
observations, pinned Rollup and SequencerInbox, posting transaction/log/block, and an Ethereum
`finalized` checkpoint not earlier than the posting block. L2 confirmation depth alone is rejected.

`sourceVerification` uses
`programmable.robinhood-custom-launch.source-verification-closure.v1`. It requires Sourcify V2
`exact` response digests for the GraphFactory and Router at their prepared addresses and exact
Standard JSON input digests. The Safe remains `official-source-pinned`; it is not recast as a
Sourcify exact match.

`sourceClosure` contains exactly repository `programmablehq/PROGRAMMABLE`, branch `production`, an
exact 40-character revision and its exact tree. The revision must be an ancestor of the local
`production` ref. The assembler reads the four required source/Standard JSON files from Git, checks
the working bytes are identical, cross-binds both Sourcify input digests, checks each primary source
against the source content embedded in its Standard JSON input, and derives ordered byte lengths,
SHA-256 digests and the framed source-closure digest. Entries are never accepted from hand-authored
input.

## Derived descriptor and digests

The live descriptor has exactly:

```text
schemaVersion
chainDeploymentId
chainId
caip2
finality
foundationSourceCommitment
deploymentEvidence
permit2GenesisProvenance
permitAuthoritySourceProvenance
externalRootDeploymentEvidence
contracts
```

Every nested evidence digest is recomputed with its schema-version domain, one zero byte and
canonical JSON. The chain deployment descriptor digest is the existing V4 formula:

```text
keccak256(UTF8(canonicalJson(normalizeV4ChainDeployment(descriptor))))
```

Object keys are sorted by UTF-8 bytes and array order is preserved. This is Ethereum Keccak-256,
not NIST SHA3-256. The assembler then re-runs `normalizeV4ChainDeployment` and
`hashV4ChainDeployment`, so an address, runtime, provider order, Safe field, source kind or finality
cross-binding drift fails before output.

## Closed promotion bundle

The closed bundle uses
`programmable.robinhood-custom-launch.promotion-bundle.v1` and has exactly:

```text
schemaVersion
state
chainDeploymentId
inputEvidenceDigest
preparedArtifact
sourceVerification
sourceClosure
finalizedBindings
artifacts
consumerInputs
promotionBundleDigest
```

Its state is `closed-awaiting-separate-runtime-promotion`, not `finalized-live`. The bundle embeds
the exact derived bytes for the live descriptor and release binding, plus finalized transaction,
block, start-block, source-closure, finality and release-manifest bindings. Its digest is:

```text
sha256("programmable.robinhood-custom-launch.promotion-bundle.v1" || 0x00 ||
       UTF8(canonicalJson(bundleWithoutPromotionBundleDigest)))
```

A machine consumer recognizes an evidence-closed bundle only when the schema and state above match,
the embedded release binding has `releaseReady: true` and an empty `blockers` array, and the bundle
digest recomputes. This predicate still does not authorize or prove runtime activation.

`consumerInputs.indexer` supplies the Router, GraphFactory and PermitAuthority address/runtime/start
block, finalized checkpoint, descriptor/finality digests, source revision/tree/closure digest and
both Standard JSON input digests. `consumerInputs.cli` supplies the descriptor path/digest, frozen
profile and release-manifest digest. `consumerInputs.developers` supplies the finalized roots and
source/finality bindings but deliberately leaves `publicAuthorization` and `publicWrites` false.

A closed bundle proves that the deployment evidence can be promoted deterministically. It does not
prove that an indexer is running, the Developers API is serving it, the CLI was published, public
writes were enabled, or a launch is available.

## Required runtime evidence

The assembler cannot proceed until the operator supplies all of the following from the real owner
transaction and retained provider captures:

1. one successful canonical receipt for the exact owner-selected transaction;
2. independent dRPC and Alchemy transaction, receipt, code, Router getter and Safe state readbacks;
3. independent dRPC and Alchemy block-zero Permit2 plus pinned Uniswap deployment readbacks;
4. the exact Robinhood batch-posting evidence and an Ethereum-finalized checkpoint observed through
   the pinned independent provider identities;
5. Sourcify V2 exact-match response digests for Router and GraphFactory; and
6. the exact integrated `production` revision and tree that contain the reviewed source bytes.

No wallet key, provider secret, bearer credential or source-verification token belongs in the input
or bundle.
