# Custom Launch V4 CLI release binding

`cli-release-binding.json` is the committed machine binding for
`@programmable/launch` 4.0.0 on Robinhood Chain mainnet. It binds the package and tag, the frozen
production profile, the finality policy, the policy repository revision, the chain deployment
identity, and the SHA-256 digest of every published V4 OpenAPI and standalone JSON Schema byte.

The committed binding is intentionally blocked:

- `releaseReady` is `false`.
- `chainDeploymentEvidence`, `profileEvidence`, `releaseManifestEvidence`,
  `sourceClosureEvidence`, and `finalityEvidence` are all required blockers.
- The corresponding five evidence values remain `null`.

A digest-shaped placeholder does not remove a blocker. `releaseReady` may become `true` only in the
same reviewed commit that supplies all five closed evidence objects, recomputes every
domain-separated digest, cross-binds them, and passes the release-ready verifier.

## Frozen policy source

The release identity does not describe policy as a floating branch or four unrelated hashes. It
pins this exact source tuple:

- Repository: `programmablehq/Launch-Policy`
- Repository ID: `1320171831`
- Protected branch: `main`
- Verified merge commit: `987215867472229690e30e11000c626d58f46e16`
- Verified tree: `284fb19f05cdf9b5b60b8bacfbd480f6b98decd3`

The four artifacts at that tree are:

| Role | Path | SHA-256 digest |
| --- | --- | --- |
| Admission descriptor | `policy/custom-launch-admission-v4.json` | `sha256:99b4ccabdaaf143bad28a8f6af441a1b93e1f113d0179236328b7fa594d1f948` |
| Business policy | `policy/launch-policy.v1.json` | `sha256:31e6b286ca839b31cb1edfe30c05d9f334892f3d84377961dc10b93959c7e216` |
| Generated binding | `.programmable/custom-launch-admission.v4.json` | `sha256:f31643e6e9ff6d5409d59a2fc3ac7fb5ac9cfcb3af08e95c9478bc95ddfa66a2` |
| Admission schema | `policy/schemas/custom-launch-admission-v4.schema.json` | `sha256:a28a6de6208d6ba7b65b4b706174509570955ba9ce9714624bcb2046ab7beae7` |

Changing the merge commit, tree, path, role, or digest changes the release identity and must fail
closed.

## Per-contract deployment provenance

The deployment evidence must preserve the source model of each root. A global “all contracts are
Sourcify exact matches” claim is invalid.

- `ProgrammableLaunchStampRouter` and `GraphFactory` are the two Sourcify exact-match roots in the
  atomic deployment receipt.
- `PermitAuthority` is the Safe proxy root. It is bound to the pinned Safe 1.4.1 source commitment,
  exact singleton and fallback-handler runtimes, owners, threshold, modules, guard, storage words,
  ordered dRPC/Alchemy configuration observations, and the complete Robinhood L2 checkpoint to
  Ethereum-finalized proof. Its `atomicRootStateEvidenceDigest` must equal the PermitAuthority
  atomic result-state digest.
- Each of the three atomic results carries ordered dRPC then Alchemy D-1/D runtime-transition
  readbacks. The predecessor block is exactly deployment block minus one, its runtime is empty,
  both providers agree on the predecessor hash, and both bind the deployment block/hash and final
  runtime. Each readback and full result state has its own framed digest.
- `Permit2` is an exact genesis predeploy at block `0`, bound to the official Robinhood genesis URL,
  the pinned genesis-document digest, the 9,152-byte alloc runtime, and matching ordered dRPC and
  Alchemy block-0 readbacks.
- `PoolManager`, `PositionManager`, `StateView`, `V4Quoter`, and `UniversalRouter` are an exact
  positional tuple sourced from `Uniswap/contracts` commit
  `4cfc406c8e34da3ce04e60657a7825075b64fd22`, path `deployments/json/4663.json`, and raw-file digest
  `sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15`.
  Every registry root requires matching ordered dRPC and Alchemy deployment-receipt readbacks.

The release-level finality evidence must match both the atomic deployment checkpoint and the Safe
checkpoint byte for byte. The nested proof requires ordered dRPC/Alchemy Robinhood observations,
ordered dRPC/QuickNode Ethereum observations, the pinned rollup and sequencer inbox, and an
Ethereum `finalized` checkpoint whose block is not earlier than the batch-posting block.

## Evidence gates

The five gates have distinct jobs:

1. `chainDeployment` contains the normalized full descriptor plus recomputed Keccak descriptor and
   framed binding digests.
2. `profile` binds the complete frozen profile, deployment descriptor digest, allowed funding
   modes, and deliberately false unproven capability claims.
3. `source` binds an exact `production` Git revision and tree to the required source bytes in
   unique UTF-8 order.
4. `finality` binds the deployment transaction and L2 checkpoint to the same complete Ethereum
   finality evidence carried by the atomic deployment and Safe configuration.
5. `manifest` cross-binds the release identity, all four other evidence objects, and every public
   machine-contract digest before recomputing its own digest.

A foundation source commitment, planned address, prepared owner transaction, local file hash,
transaction submission, or provider-shaped placeholder is not deployment or finality evidence.
The committed prepared-not-broadcast artifacts do not satisfy these gates.

## Offline audit

Run the binding audit from the repository root:

```sh
node scripts/programmable-launch-v4-release-binding.mjs audit \
  --repository-root "$PWD"

node scripts/programmable-launch-v4-release-binding.mjs verify-release-ready \
  --repository-root "$PWD"

node --test scripts/test/programmable-launch-v4-release-binding.test.mjs
```

The first command must currently report `releaseReady: false` and all five blockers. The second is
the immutable release workflow gate and must currently fail. The focused test validates the
committed JSON against `cli-release-binding.schema.json` offline, exercises a mechanically complete
synthetic binding, and proves that policy, provenance, evidence, and machine-byte mutations fail
closed.

These commands do not contact an RPC or provider, publish, tag, sign a wallet transaction, or
broadcast. They verify committed evidence bytes and internal cross-bindings; they do not create
external proof.

## Postdeployment materialization

Do not replace the nulls in the prepared deployment JSON or this binding by hand. The offline
postdeployment assembler consumes the exact successful owner transaction, ordered independent L2
readbacks, Ethereum posting/finality evidence, per-contract source-verification closure and exact
`production` source revision. It derives a separate live deployment descriptor, every nested digest,
the `chainDeploymentDescriptorDigest`, all five release evidence objects and a closed promotion
bundle.

See [POSTDEPLOYMENT.md](POSTDEPLOYMENT.md) for the strict input contract, commands, digest formulas,
consumer outputs and remaining owner/runtime boundary. The generated bundle state is
`closed-awaiting-separate-runtime-promotion`; neither assembly nor applying its local artifacts
activates an indexer, Developers API, public write path, npm release or external deployment.
