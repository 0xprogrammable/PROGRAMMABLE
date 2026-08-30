# Custom Launch V4 CLI release binding

`cli-release-binding.json` is the committed machine binding for
`@programmable/launch` 4.0.0 on Robinhood Chain mainnet. It binds the package and tag, the frozen
production profile, the finality policy, the policy repository revision, the chain deployment
identity, and the SHA-256 digest of every published V4 OpenAPI and standalone JSON Schema byte.

The committed binding is intentionally blocked:

- `releaseReady` is `false`.
- `chainDeploymentEvidence`, `profileEvidence`, `releaseManifestEvidence`,
  `sourceClosureEvidence`, and `finalityEvidence` are all required blockers.
- The five evidence values remain `null`; together with the separate backend gate they produce the six audit
  blockers listed below.

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

## Provider evidence separation

The owner-wallet action-time envelope uses the ordered,
credentialed Robinhood pair QuickNode **Hood Explorer Indexer** primary and
Alchemy **Programmable Production 3** secondary. Its provider identities are
compatible with backend provider-profile digest
`sha256:c03afd37c077e78bea30f69d1ce139d026cb4fad86fa74122257bba8f5e9a910`,
but that digest is not backend readiness evidence by itself.

Phase A deployment evidence uses the same ordered Robinhood provider identities,
QuickNode then Alchemy, while Ethereum remains dRPC then QuickNode. Its separately
supplied endpoints must match the exact review-frozen owner action-time commitments
before any provider request. Those credential-free commitments and the retained
inventories describe the endpoints and providers that actually performed the
postdeployment reads; fresh Phase B replay rechecks the same attested commitments.
Commitments must never replace, relabel or re-hash the provider evidence itself.

## Per-contract deployment provenance

The deployment evidence must preserve the source model of each root. A global “all contracts are
Sourcify exact matches” claim is both invalid and impossible for the reviewed no-CBOR compiler
profile.

- `ProgrammableLaunchStampRouter` and `GraphFactory` require Sourcify V2
  `match`/`match`/`match` and classification `PARTIAL_NO_CBOR_EXACT_BYTES` because their pinned
  Standard JSON inputs set `metadata.appendCBOR=false`. Sourcify is not the exact-source authority.
  Their exact claim is a separate composite binding across the protected source revision/tree,
  authenticated hosted reproduction build, pinned compiler settings and Standard JSON bytes,
  creation bytes in the finalized atomic transaction, and runtime bytes independently read by
  QuickNode and Alchemy.
- `PermitAuthority` is the Safe proxy root. It is bound to the pinned Safe 1.4.1 source commitment,
  exact singleton and fallback-handler runtimes, owners, threshold, modules, guard, storage words,
  ordered QuickNode/Alchemy configuration observations, and the complete Robinhood L2 checkpoint to
  Ethereum-finalized proof. Its `atomicRootStateEvidenceDigest` must equal the PermitAuthority
  atomic result-state digest.
- Each of the three atomic results carries ordered QuickNode then Alchemy D-1/D runtime-transition
  readbacks. The predecessor block is exactly deployment block minus one, its runtime is empty,
  both providers agree on the predecessor hash, and both bind the deployment block/hash and final
  runtime. Each readback and full result state has its own framed digest.
- `Permit2` is an exact genesis predeploy at block `0`, bound to the official Robinhood genesis URL,
  the pinned genesis-document digest, the 9,152-byte alloc runtime, and matching ordered QuickNode and
  Alchemy block-0 readbacks.
- `PoolManager`, `PositionManager`, `StateView`, `V4Quoter`, and `UniversalRouter` are an exact
  positional tuple sourced from `Uniswap/contracts` commit
  `4cfc406c8e34da3ce04e60657a7825075b64fd22`, path `deployments/json/4663.json`, and raw-file digest
  `sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15`.
  Every registry root requires matching ordered QuickNode and Alchemy deployment-receipt readbacks.

The release-level finality evidence must match both the atomic deployment checkpoint and the Safe
checkpoint byte for byte. The nested proof requires ordered QuickNode/Alchemy Robinhood observations,
ordered dRPC/QuickNode Ethereum observations, the pinned rollup and sequencer inbox, and an
Ethereum `finalized` checkpoint whose block is not earlier than the batch-posting block.

## Evidence gates

The six gates have distinct jobs:

1. `chainDeployment` contains the normalized full descriptor plus recomputed Keccak descriptor and
   framed binding digests.
2. `profile` binds the complete frozen profile, deployment descriptor digest, allowed funding
   modes, and deliberately false unproven capability claims.
3. `source` binds an exact `production` Git revision and tree to the required source bytes in
   unique UTF-8 order.
4. `finality` binds the deployment transaction and L2 checkpoint to the same complete Ethereum
   finality evidence carried by the atomic deployment and Safe configuration.
5. `backend` binds the final backend repository revision/tree, API/migration/OpenAPI/profile/policy
   identity, fresh V4 readiness receipt and a separate Fly release/machine/image receipt.
6. `manifest` cross-binds the release identity, all five other evidence objects, and every public
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

The first command must currently report `releaseReady: false` and all six blockers. The second is
the immutable release workflow gate and must currently fail. Even after all six structural objects
exist, `verify-release-ready` additionally requires `PROGRAMMABLE_PRODUCTION_VERIFY_PROOF` to name
the exact protected `verify.yml` artifact and cryptographically re-verifies its GitHub attestation;
it also requires `PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION` to name the separately attested
runtime/Fly authorization receipt. The unit-test verifier injections are not exposed by the CLI.
The focused test validates the
committed JSON against `cli-release-binding.schema.json` offline, exercises a mechanically complete
synthetic binding, and proves that policy, provenance, evidence, and machine-byte mutations fail
closed.

These commands do not contact an RPC or provider, publish, tag, sign a wallet transaction, or
broadcast. They verify committed evidence bytes and internal cross-bindings; they do not create
external proof.

## Postdeployment materialization

Do not replace the nulls in the prepared deployment JSON or this binding by hand. The read-only
Phase A collector consumes the exact successful owner transaction, bounded ordered independent L2
and L1 readbacks, Ethereum posting/finality evidence, per-contract source-verification closure, the
historical protected Verify proof and the exact `production` revision/tree. It emits the canonical
`release/robinhood-chain-4663/programmable-stage-bundle.json`, state
`closed-awaiting-backend-readiness`, with `releaseReady`, `publicAuthorization` and `publicWrites`
all false.

Backend readiness has an explicit privacy boundary. The backend repository retains the restricted
raw `backend-promotion-input.json`, but the PROGRAMMABLE finalizer accepts only the separately
attested `backend-promotion-input.public.json`. The public-safe object carries normalized readiness
and Fly bindings, safe byte/digest receipts, and a digest/length binding to the private artifact; it
contains no raw response body, raw request ID, machine configuration, environment or credential. The
final promotion bundle embeds only this public projection as `backendPromotionBinding`.

The two protected workflows are:

- `.github/workflows/capture-robinhood-custom-launch-postdeployment.yml` for capture, Phase A
  assembly and portable capture/stage attestations; and
- `.github/workflows/finalize-robinhood-custom-launch-promotion.yml` for offline portable-evidence
  verification, canonical backend authorization and Phase B promotion.

The Phase B producer does not claim the later protected evidence PR that lands its outputs. It
deterministically emits the exact live descriptor and final CLI binding with the four new
authorization/promotion files, so the later PR never hand-edits JSON. It does not accept an
operator trusted root, a cross-repository workflow token or the private raw backend file. The
final `apply` gate is read-only and freshly re-verifies the landed bytes and provider state. Neither
phase activates an indexer, Developers API, public write path, npm release or external deployment.

See [POSTDEPLOYMENT.md](POSTDEPLOYMENT.md) for the exact CLI interfaces, fixed environment-variable
names, canonical paths, key sets, digest domains, schemas and remaining owner/runtime boundary. The
strict checked-in contracts include the [Phase A stage schema](stage-bundle.schema.json),
[private raw backend schema](backend-promotion-input.schema.json),
[public-safe backend schema](backend-promotion-public-input.schema.json),
[backend capture authorization schema](backend-capture-authorization.schema.json),
[final backend authorization schema](backend-release-authorization.schema.json) and
[Phase B promotion schema](promotion-bundle.schema.json).
