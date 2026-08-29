# Robinhood foundation postdeployment closure

The Robinhood postdeployment tooling turns retained, authenticated evidence into two deterministic
bundles. Phase A closes the deployed chain and backend-image handoff. Phase B binds a separately
attested, public-safe backend readiness capture and emits the final promotion bundle. Neither phase
signs, broadcasts, deploys a service, publishes a package, or changes an external system.

The immutable prepared artifact remains
`contracts/deployments/robinhood-custom-launch-v1.predeployment.json`. Its exact SHA-256 and
`prepared-not-broadcast` state are checked before every materialization. The derived live path is
`contracts/deployments/robinhood-custom-launch-v1.json`; the prepared artifact is never edited or
renamed.

## Authority and evidence boundary

The production path has three distinct revisions and trees:

1. The historical protected `Verify` proof and its portable GitHub attestation bundle prove the
   exact `production` source subject used by Phase A.
2. A reviewed protected evidence-import commit contains the exact seven Phase A files plus the
   public-safe backend input and portable attestation as tracked Git blobs. The finalization
   workflow runs at this distinct commit and emits authenticated Phase B outputs. It performs no
   dynamic cross-private artifact download and needs no cross-repository token.
3. A later reviewed protected evidence PR imports the exact finalization output: the four new
   authorization/promotion files plus the deterministically materialized live descriptor and CLI
   binding. That later commit is a separate gate and must remain distinct from both earlier trees.

Phase A runs in
`.github/workflows/capture-robinhood-custom-launch-postdeployment.yml`. It checks detached
`HEAD`, `GITHUB_SHA`, the protected `refs/heads/production` ref and the fetched
`refs/remotes/origin/production` revision/tree before collecting evidence. The job imports the
historical Verify proof, preserves its portable attestation bytes, captures the exact bounded L2/L1
read inventory, attests the capture, assembles the stage bundle, attests the stage bundle, copies
each `actions/attest@v4` bundle byte-for-byte with `cp` plus `cmp`, and uploads the complete Phase A
evidence directory. All generated files stay in `RUNNER_TEMP`, so the protected checkout remains
clean.

Phase B runs in
`.github/workflows/finalize-robinhood-custom-launch-promotion.yml`. It consumes only the nine
tracked portable Phase A/public-safe backend files at the protected producer commit. It rejects the
private raw backend capture, creates the GitHub CLI embedded-TUF trusted root itself in
`RUNNER_TEMP`, and verifies all portable attestations offline. It then emits and attests the
canonical backend authorization and promotion bundle, materializes the exact live descriptor and
CLI binding into an outside-repository artifact tree, preserves attestation bytes, and uploads the
eight exact public-safe handoff files. It accepts no operator-supplied trusted root and serializes
no credentials.

An authenticated Phase A bundle is always non-public:

```text
state = closed-awaiting-backend-readiness
releaseReady = false
publicAuthorization = false
publicWrites = false
```

Only Phase B with all three production authorities can produce `finalized-live`. Explicit
in-process test authority produces `test-only-finalized`, which remains non-public. Test authority
is not available through a CLI flag or environment variable.

## Private raw versus public-safe backend evidence

The backend producer owns two different artifacts. They are intentionally not interchangeable.

- `release/robinhood-chain-4663/backend-promotion-input.json` is the restricted private raw input,
  schema `programmable.robinhood-custom-launch.backend-promotion-input.v1`. It retains sanitized
  request bytes, raw response bodies, request IDs and Fly machine/control-plane payloads. It never
  enters the PROGRAMMABLE Phase B artifact or promotion bundle.
- `release/robinhood-chain-4663/backend-promotion-input.public.json` is the public-safe handoff,
  schema `programmable.robinhood-custom-launch.backend-promotion-public-input.v2`. It contains
  safe byte/digest receipts, normalized readiness identity, normalized Fly release and machine
  bindings, and a semantic capture ID/digest derived only from those public facts. It contains no
  private raw artifact path or digest, raw request or response bytes, raw request ID, machine
  configuration, environment or private address.
- `release/robinhood-chain-4663/backend-promotion-input.attestation.json` is the portable GitHub
  attestation bundle for the public-safe input. It does not authorize or disclose the private raw
  file.

The public-safe input is validated against the exact staged deployment, active OpenAPI digest,
policy/profile/finality identity, backend source commit/tree, readiness response and Fly release.
Its `publicInputDigest` and public-semantic `backendPromotionInputDigest` are carried independently
through the final authorization, finalized bindings and all four consumer inputs. Provider-only
private fields cannot alter either digest or any other public byte.

## Canonical artifact paths and schemas

| Artifact | Canonical path | Schema or role |
| --- | --- | --- |
| Raw Phase A capture | `release/robinhood-chain-4663/programmable-postdeployment-capture.json` | Top-level `programmable.robinhood-custom-launch.postdeployment-input.v2`; nested `capture` is `programmable.robinhood-custom-launch.production-capture.v2` |
| Capture attestation | `release/robinhood-chain-4663/programmable-postdeployment-capture.attestation.json` | Portable GitHub bundle |
| Historical Verify proof | `release/robinhood-chain-4663/production-verify-proof.json` | Protected `verify.yml` artifact |
| Verify proof attestation | `release/robinhood-chain-4663/production-verify-proof.attestation.json` | Portable GitHub bundle |
| Phase A stage | `release/robinhood-chain-4663/programmable-stage-bundle.json` | `programmable.robinhood-custom-launch.stage-bundle.v1` |
| Stage attestation | `release/robinhood-chain-4663/programmable-stage-bundle.attestation.json` | Portable GitHub bundle |
| Private backend raw input | `release/robinhood-chain-4663/backend-promotion-input.json` | `programmable.robinhood-custom-launch.backend-promotion-input.v1`; restricted |
| Public backend input | `release/robinhood-chain-4663/backend-promotion-input.public.json` | `programmable.robinhood-custom-launch.backend-promotion-public-input.v2` |
| Public backend attestation | `release/robinhood-chain-4663/backend-promotion-input.attestation.json` | Portable GitHub bundle |
| Backend authorization | `release/robinhood-chain-4663/programmable-backend-authorization.json` | `programmable.launch-cli-v4-backend-release-authorization.v1` |
| Backend authorization attestation | `release/robinhood-chain-4663/programmable-backend-authorization.attestation.json` | Portable GitHub bundle |
| Phase B promotion | `release/robinhood-chain-4663/programmable-promotion-bundle.json` | `programmable.robinhood-custom-launch.promotion-bundle.v2` |
| Phase B promotion attestation | `release/robinhood-chain-4663/programmable-promotion-bundle.attestation.json` | Portable GitHub bundle |
| Live descriptor | `contracts/deployments/robinhood-custom-launch-v1.json` | Exact `artifacts.liveDeployment` bytes |
| Final CLI binding | `docs/operations/releases/custom-launch-v4/cli-release-binding.json` | Exact `artifacts.cliReleaseBinding` bytes |

The checked-in strict schemas are:

- [`stage-bundle.schema.json`](stage-bundle.schema.json)
- [`backend-promotion-input.schema.json`](backend-promotion-input.schema.json)
- [`backend-promotion-public-input.schema.json`](backend-promotion-public-input.schema.json)
- [`backend-capture-authorization.schema.json`](backend-capture-authorization.schema.json)
- [`backend-release-authorization.schema.json`](backend-release-authorization.schema.json)
- [`promotion-bundle.schema.json`](promotion-bundle.schema.json)

Every modeled fixed-shape object rejects unknown keys. Intentionally dynamic JSON values such as
verified contract state and consumer roots are closed by their code validators. Cross-field
equality, canonical byte encoding, sorted inventories, freshness windows, attestation verification
and domain-separated digest recomputation remain enforced by the code validators and deterministic
re-materialization.

## Commands

Run the focused implementation tests first:

```sh
npm run contracts:robinhood:postdeploy:test
npm run release:custom-launch:v4:test
```

### Phase A capture

The read-only collector requires the exact successful deployment transaction and a nonzero decimal
Ethereum posting-block locator. The locator bounds the SequencerInbox log query; the retained raw
posting transaction receipt, block header, decoded event and provider agreement remain authority.

```sh
npm run contracts:robinhood:postdeploy:capture -- \
  --transaction-hash "$DEPLOYMENT_TX_HASH" \
  --l1-posting-block "$L1_POSTING_BLOCK" \
  --output "$RUNNER_TEMP/programmable-postdeployment-capture.json" \
  --repository-root "$PWD"
```

The collector reads exactly these credentialed endpoints and never prints or serializes their
URLs, paths, query credentials or tokens:

```text
ROBINHOOD_MAINNET_RPC_URL_PRIMARY
ROBINHOOD_MAINNET_RPC_URL_SECONDARY
ETHEREUM_MAINNET_RPC_URL_PRIMARY
ETHEREUM_MAINNET_RPC_URL_SECONDARY
```

The protected workflow is the canonical production invocation. A manual production-equivalent
stage assembly must supply all portable Phase A proof coordinates:

```sh
npm run contracts:robinhood:postdeploy:assemble-stage -- \
  --input /absolute/path/programmable-postdeployment-capture.json \
  --output "$RUNNER_TEMP/programmable-stage-bundle.json" \
  --repository-root "$PWD" \
  --capture-attestation-bundle /absolute/path/programmable-postdeployment-capture.attestation.json \
  --source-verify-proof /absolute/path/production-verify-proof.json \
  --source-verify-attestation-bundle /absolute/path/production-verify-proof.attestation.json \
  --source-verify-run-id "$VERIFY_RUN_ID" \
  --source-verify-run-attempt "$VERIFY_RUN_ATTEMPT" \
  --source-verify-artifact-id "$VERIFY_ARTIFACT_ID" \
  --source-verify-artifact-digest "$VERIFY_ARTIFACT_DIGEST"
```

After `actions/attest@v4` produces the stage portable bundle, verify the retained bytes:

```sh
npm run contracts:robinhood:postdeploy:verify-stage -- \
  --stage /absolute/path/programmable-stage-bundle.json \
  --capture /absolute/path/programmable-postdeployment-capture.json \
  --repository-root "$PWD" \
  --capture-attestation-bundle /absolute/path/programmable-postdeployment-capture.attestation.json \
  --stage-attestation-bundle /absolute/path/programmable-stage-bundle.attestation.json \
  --source-verify-proof /absolute/path/production-verify-proof.json \
  --source-verify-attestation-bundle /absolute/path/production-verify-proof.attestation.json \
  --source-verify-run-id "$VERIFY_RUN_ID" \
  --source-verify-run-attempt "$VERIFY_RUN_ATTEMPT" \
  --source-verify-artifact-id "$VERIFY_ARTIFACT_ID" \
  --source-verify-artifact-digest "$VERIFY_ARTIFACT_DIGEST"
```

`stage-backend-assets` accepts the same stage/capture portable evidence and adds
`--backend-service-root`. It writes only the four fixed Phase A backend-image assets, verifies all
bytes before creation, rejects symbolic-link parents and replays only when every existing byte is
identical.

The backend fixture command exists for deterministic tests only:

```sh
npm run contracts:robinhood:postdeploy:backend-fixture -- \
  --stage /absolute/path/programmable-stage-bundle.json \
  --output /restricted/path/backend-promotion-input.json
```

It exclusively creates a mode-`0600` synthetic private raw input. It is not a production capture,
does not produce the public-safe artifact and must not be uploaded as public evidence.

### Phase B authorization and promotion

`authorize-backend` accepts the public-safe backend input and its portable attestation only. The
private raw input is deliberately not a CLI argument. The production workflow also supplies all
Phase A portable evidence shown above.

```sh
npm run contracts:robinhood:postdeploy:authorize-backend -- \
  --stage /absolute/path/programmable-stage-bundle.json \
  --capture /absolute/path/programmable-postdeployment-capture.json \
  --backend-input /absolute/path/backend-promotion-input.public.json \
  --backend-attestation-bundle /absolute/path/backend-promotion-input.attestation.json \
  --output "$RUNNER_TEMP/programmable-backend-authorization.json" \
  --repository-root "$PWD" \
  --capture-attestation-bundle /absolute/path/programmable-postdeployment-capture.attestation.json \
  --stage-attestation-bundle /absolute/path/programmable-stage-bundle.attestation.json \
  --source-verify-proof /absolute/path/production-verify-proof.json \
  --source-verify-attestation-bundle /absolute/path/production-verify-proof.attestation.json \
  --source-verify-run-id "$VERIFY_RUN_ID" \
  --source-verify-run-attempt "$VERIFY_RUN_ATTEMPT" \
  --source-verify-artifact-id "$VERIFY_ARTIFACT_ID" \
  --source-verify-artifact-digest "$VERIFY_ARTIFACT_DIGEST"
```

After the canonical authorization is attested, `promote` consumes that exact authorization path
and portable bundle:

```sh
npm run contracts:robinhood:postdeploy:promote -- \
  --stage /absolute/path/programmable-stage-bundle.json \
  --capture /absolute/path/programmable-postdeployment-capture.json \
  --backend-input /absolute/path/backend-promotion-input.public.json \
  --backend-attestation-bundle /absolute/path/backend-promotion-input.attestation.json \
  --backend-authorization /absolute/path/programmable-backend-authorization.json \
  --backend-authorization-attestation-bundle /absolute/path/programmable-backend-authorization.attestation.json \
  --output "$RUNNER_TEMP/programmable-promotion-bundle.json" \
  --repository-root "$PWD" \
  --capture-attestation-bundle /absolute/path/programmable-postdeployment-capture.attestation.json \
  --stage-attestation-bundle /absolute/path/programmable-stage-bundle.attestation.json \
  --source-verify-proof /absolute/path/production-verify-proof.json \
  --source-verify-attestation-bundle /absolute/path/production-verify-proof.attestation.json \
  --source-verify-run-id "$VERIFY_RUN_ID" \
  --source-verify-run-attempt "$VERIFY_RUN_ATTEMPT" \
  --source-verify-artifact-id "$VERIFY_ARTIFACT_ID" \
  --source-verify-artifact-digest "$VERIFY_ARTIFACT_DIGEST"
```

`verify-promotion` takes the same sidecars plus `--bundle`. The protected Phase B producer then
uses `materialize-release-assets` with those arguments plus an empty, real, outside-repository
`--asset-output-root`. That command exclusively creates only the root-relative live descriptor and
CLI binding bytes carried by the authenticated promotion bundle. The owner imports those exact
generated files with the four new Phase B files in the later evidence PR; no JSON is hand-edited.

```sh
npm run contracts:robinhood:postdeploy:materialize-release-assets -- \
  --bundle /absolute/path/programmable-promotion-bundle.json \
  --stage /absolute/path/programmable-stage-bundle.json \
  --capture /absolute/path/programmable-postdeployment-capture.json \
  --backend-input /absolute/path/backend-promotion-input.public.json \
  --backend-attestation-bundle /absolute/path/backend-promotion-input.attestation.json \
  --backend-authorization /absolute/path/programmable-backend-authorization.json \
  --backend-authorization-attestation-bundle /absolute/path/programmable-backend-authorization.attestation.json \
  --asset-output-root "$RUNNER_TEMP/robinhood-phase-b-public-evidence" \
  --repository-root "$PWD" \
  --capture-attestation-bundle /absolute/path/programmable-postdeployment-capture.attestation.json \
  --stage-attestation-bundle /absolute/path/programmable-stage-bundle.attestation.json \
  --source-verify-proof /absolute/path/production-verify-proof.json \
  --source-verify-attestation-bundle /absolute/path/production-verify-proof.attestation.json \
  --source-verify-run-id "$VERIFY_RUN_ID" \
  --source-verify-run-attempt "$VERIFY_RUN_ATTEMPT" \
  --source-verify-artifact-id "$VERIFY_ARTIFACT_ID" \
  --source-verify-artifact-digest "$VERIFY_ARTIFACT_DIGEST"
```

`apply` is deliberately read-only. It takes the same sidecars, the four RPC environment variables,
the current protected Verify proof, and the canonical backend authorization. It repeats the full
L2/L1 inventory, canonical Sourcify V2 query and backend readiness/Fly reads, verifies both landed
release assets byte-for-byte against Phase B, re-runs the outer #3 release-ready audit and re-hashes
the immutable prepared artifact. It does not write a journal or any release file, so replay and
crash behavior cannot leave a partial local promotion.

Inside the repository, omitted `--output` values resolve only to the canonical stage,
authorization or promotion path. The production workflows explicitly use `RUNNER_TEMP` outputs to
preserve the clean protected checkout. Outside-repository output requires a real non-symlink parent
and exclusive file creation.

## Exact Phase A capture

The top-level capture input has exactly these keys in schema
`programmable.robinhood-custom-launch.postdeployment-input.v2`:

```text
schemaVersion
chainDeploymentId
providers
sourceClosure
capture
```

`providers` contains normalized dRPC then Alchemy L2 state. Those summaries are not authority.
Every claimed value is proven by both providers' ordered retained JSON-RPC inventory under
`capture.l2ProviderReadbacks`: chain ID, raw and parsed transaction, successful receipt and logs,
deployment/predecessor headers, D-1/D contract code, Safe configuration/storage, Router getters,
Permit2 and pinned Uniswap roots, plus NodeInterface batch and confirmation calls.

The signed transaction must recover the pinned owner on chain `4663`, target Multicall3 with zero
value, use selector `0x82ad56cb`, contain exactly 33,412 calldata bytes and match the pinned calldata
hash. The receipt closes the ordered Safe setup/proxy path and all three deployed roots.

Each Ethereum inventory retains exact bytes for chain ID, the unique pinned
`SequencerBatchDelivered` log, its successful receipt, posting block and two `finalized` reads. dRPC
and QuickNode must agree on the event, decoded batch binding and finalized checkpoint. The event
address/topic/batch, accumulators, delayed accumulator/message count, time bounds, data location
and complete transaction/block/log inclusion tuple are closed into evidence.

Sourcify evidence retains bounded exact response bytes for Router and GraphFactory:

```text
GET /server/v2/contract/4663/{EIP55Address}?fields=all
```

`match`, `creationMatch` and `runtimeMatch` must all be `exact_match`. The validator binds compiler
settings, metadata, sources and the repository Standard JSON input into the source-verification
closure. Provider URLs are code-owned HTTPS dRPC/Alchemy for Robinhood and HTTPS dRPC/QuickNode for
Ethereum. Only sanitized hostnames enter evidence.

Production capture binds repository `programmablehq/PROGRAMMABLE`, repository ID `1314365508`,
protected ref `refs/heads/production`, exact revision/tree and source-closure digest. The capture's
profile digest must equal the backend runtime's frozen Robinhood provider-profile digest; callers
cannot select a different value to unlock readiness.

Capture observations have a maximum twenty-minute window. Phase B backend capture has a separate
fifteen-minute window, two-minute future skew allowance and ten-minute capture-authorization delay.

## Exact bundle and authorization shapes

The Phase A stage bundle has exactly:

```text
schemaVersion
state
releaseReady
publicAuthorization
publicWrites
chainDeploymentId
inputEvidenceDigest
preparedArtifact
captureAuthorization
captureClosure
sourceVerification
sourceClosure
backendReleaseAssets
finalizedBindings
artifacts
consumerInputs
stageBundleDigest
```

Its `finalizedBindings` and every consumer carry both
`backendPromotionPublicInputDigest` and `backendPromotionInputDigest` as `null`, followed by null
backend evidence, authorization and release-manifest digests. Phase A never authorizes indexer,
CLI, Developers API, backend public traffic or public writes.

The public-safe backend input has exactly:

```text
schemaVersion
captureId
observedAt
backendSource
backendPromotionInputDigest
readbackReceipts
runtimeReadiness
flyControlPlane
publicInputDigest
```

Its protected backend capture authorization has exactly:

```text
schemaVersion
trustClass
subjectPath
subjectByteLength
subjectSha256
attestationBundlePath
attestationBundleByteLength
attestationBundleSha256
trustedRootSource
trustedRootByteLength
trustedRootSha256
repository
repositoryId
workflow
sourceRef
sourceRevision
sourceTree
verifiedAt
verificationDigest
```

The canonical PROGRAMMABLE backend authorization has exactly:

```text
schemaVersion
trustClass
repository
repositoryId
workflow
sourceRef
producerRevision
producerTree
stageSourceRevision
stageSourceTree
stageBundlePath
stageBundleSha256
stageBundleDigest
backendPromotionPublicInputPath
backendPromotionPublicInputSha256
backendPromotionPublicInputDigest
backendPromotionInputDigest
chainDeploymentDescriptorDigest
backendReleaseEvidenceDigest
runtimeReadinessResponseSha256
flyRawReadbacksDigest
observedAt
authorizationDigest
```

Production authorization pins repository `programmablehq/PROGRAMMABLE`, repository ID
`1314365508`, workflow
`.github/workflows/finalize-robinhood-custom-launch-promotion.yml`, protected ref
`refs/heads/production`, the finalization producer revision/tree and the distinct staged source
revision/tree.

The Phase B promotion bundle has exactly:

```text
schemaVersion
state
releaseReady
publicAuthorization
publicWrites
stageBundle
chainDeploymentId
inputEvidenceDigest
preparedArtifact
captureAuthorization
captureClosure
sourceVerification
sourceClosure
backendReleaseAssets
backendPromotionBinding
backendCaptureAuthorization
backendAuthorization
finalizedBindings
artifacts
consumerInputs
promotionBundleDigest
```

`backendPromotionBinding` is a public projection. It carries the public artifact digest/length,
safe readback receipts, backend source, reduced capture authorization, reduced runtime/Fly evidence
and backend release-evidence digest. It never embeds or commits to the private raw input or ignored
provider payloads.

## Digest formulas

The live chain descriptor uses Ethereum Keccak-256:

```text
keccak256(UTF8(canonicalJson(normalizeV4ChainDeployment(descriptor))))
```

Closure, input, authorization, stage and promotion digests use framed SHA-256:

```text
sha256(UTF8(domain) || 0x00 || UTF8(canonicalJson(value)))
```

The relevant domains are:

```text
programmable.robinhood-custom-launch.capture-authorization.v1
programmable.robinhood-custom-launch.capture-closure.v2
programmable.robinhood-custom-launch.backend-promotion-input.v1
programmable.robinhood-custom-launch.backend-promotion-public-input.v2
programmable.robinhood-custom-launch.backend-promotion-semantic-input.v1
programmable.robinhood-custom-launch.backend-capture-authorization.v2
programmable.launch-cli-v4-backend-release-authorization.v1
programmable.launch-cli-v4-backend-release-evidence.v1
programmable.robinhood-custom-launch.stage-bundle.v1
programmable.robinhood-custom-launch.promotion-bundle.v2
```

The private input, public input, capture authorization, backend authorization, stage and promotion
builders null or omit their own terminal digest field exactly as defined by their validator before
hashing. Artifact `sha256` fields separately hash the exact retained bytes; they are not substitutes
for the domain digest.

## Remaining owner boundary

No secret belongs in a capture, authorization or bundle. Owners still control the successful
transaction, protected workflow approvals, backend credentials and deployment, the authenticated
download/import of the private-repository public-safe handoff, attestation publication, both
reviewed evidence PRs, and every public release or write-path activation. The tooling proves byte
and authority closure; it does not expand those permissions.
