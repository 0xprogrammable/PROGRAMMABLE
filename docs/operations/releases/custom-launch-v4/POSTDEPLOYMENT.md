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
`RUNNER_TEMP`, and verifies the three public PROGRAMMABLE attestations offline. The private
backend's public-safe input is instead verified with the SHA-256-pinned Cosign v3.1.3 binary, a
standardized Sigstore v0.3 bundle, exact GitHub Actions certificate identity, repository, protected
`main` ref, source SHA, workflow name and `workflow_dispatch` trigger. Transparency-log and SCT
verification remain enabled. Phase B then emits and attests the canonical backend authorization and
promotion bundle, materializes the exact live descriptor and CLI binding into an
outside-repository artifact tree, preserves attestation bytes, and uploads the eight exact
public-safe handoff files. It accepts no operator-supplied trusted root and serializes no
credentials.

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
- `release/robinhood-chain-4663/backend-promotion-input.attestation.json` is the standardized
  Sigstore v0.3 Cosign bundle for the public-safe input. Keyless signing publishes the subject
  digest and GitHub Actions identity metadata to the public transparency service; it does not
  publish, authorize or disclose the private raw file.

The public-safe input is validated against the exact staged deployment, active OpenAPI digest,
policy/profile/finality identity, backend source commit/tree, readiness response and Fly release.
Its `publicInputDigest` and public-semantic `backendPromotionInputDigest` are carried independently
through the final authorization, finalized bindings and all four consumer inputs. Provider-only
private fields cannot alter either digest or any other public byte.

## Canonical artifact paths and schemas

| Artifact | Canonical path | Schema or role |
| --- | --- | --- |
| Raw Phase A capture | `release/robinhood-chain-4663/programmable-postdeployment-capture.json` | Top-level `programmable.robinhood-custom-launch.postdeployment-input.v3`; nested `capture` is `programmable.robinhood-custom-launch.production-capture.v3` |
| Capture attestation | `release/robinhood-chain-4663/programmable-postdeployment-capture.attestation.json` | Portable GitHub bundle |
| Historical Verify proof | `release/robinhood-chain-4663/production-verify-proof.json` | Protected `verify.yml` artifact |
| Verify proof attestation | `release/robinhood-chain-4663/production-verify-proof.attestation.json` | Portable GitHub bundle |
| Phase A stage | `release/robinhood-chain-4663/programmable-stage-bundle.json` | `programmable.robinhood-custom-launch.stage-bundle.v1` |
| Stage attestation | `release/robinhood-chain-4663/programmable-stage-bundle.attestation.json` | Portable GitHub bundle |
| Private backend raw input | `release/robinhood-chain-4663/backend-promotion-input.json` | `programmable.robinhood-custom-launch.backend-promotion-input.v1`; restricted |
| Public backend input | `release/robinhood-chain-4663/backend-promotion-input.public.json` | `programmable.robinhood-custom-launch.backend-promotion-public-input.v2` |
| Public backend attestation | `release/robinhood-chain-4663/backend-promotion-input.attestation.json` | Standardized Sigstore v0.3 Cosign bundle |
| Backend Phase A capture bridge | `release/robinhood-v4-phase-a-production-capture.v3.json` | Exact authenticated Phase A production-capture subject bytes copied into the backend repository |
| Backend Phase A capture attestation bridge | `release/robinhood-v4-phase-a-production-capture.v3.attestation.json` | Exact existing portable PROGRAMMABLE capture-attestation bytes copied into the backend repository |
| Backend Phase A stage bridge | `release/robinhood-v4-phase-a-stage-bundle.v1.json` | Exact authenticated Phase A stage bytes copied into the backend repository |
| Backend Phase A stage attestation bridge | `release/robinhood-v4-phase-a-stage-bundle.v1.attestation.json` | Exact existing portable PROGRAMMABLE stage-attestation bytes copied into the backend repository |
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

Before any capture or fresh replay request, code rejects every URL outside the reviewed credential
forms: dRPC live is `https://lb.drpc.live/{robinhood|ethereum}/{credential}`; dRPC org is exactly
`https://lb.drpc.org/ogrpc?network={robinhood|ethereum}[-mainnet]&dkey={credential}` with that query
order; Robinhood Alchemy is `https://robinhood-mainnet.g.alchemy.com/v2/{credential}`; Ethereum
QuickNode is `https://{endpoint-name}.ethereum-mainnet.quiknode.pro/{credential}/`, matching the
existing Programmable production endpoint contract. Userinfo, explicit ports,
fragments, extra or reordered query parameters, wrong-chain paths and public endpoints fail before
the first network request. Ethereum chain ID and the complete retained readback inventory bind the
QuickNode endpoint to mainnet. Credential values and full URLs are never serialized or printed.

These are the historical Phase A capture identities: Robinhood dRPC then
Alchemy, and Ethereum dRPC then QuickNode. They intentionally remain byte-for-byte
separate from the next owner action-time pair, which is Robinhood
QuickNode **Hood Explorer Indexer** then Alchemy **Programmable Production 3**.
Never reinterpret, rewrite or re-hash an existing Phase A readback as if it came
from the current action-time pair. The action-time endpoint commitments prove
only the fresh wallet-preparation reads; the retained Phase A identities prove
only the deployment observations they actually performed.

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
`--backend-service-root`. Both `--capture-attestation-bundle` and
`--stage-attestation-bundle` are mandatory CLI inputs. It writes exactly eight fixed files: the
four Phase A backend-image assets, the byte-exact credential-free production capture at
`release/robinhood-v4-phase-a-production-capture.v3.json`, its already verified portable
attestation bytes at
`release/robinhood-v4-phase-a-production-capture.v3.attestation.json`, the exact authenticated
Stage A subject bytes at
`release/robinhood-v4-phase-a-stage-bundle.v1.json`, and its existing portable attestation bytes
at `release/robinhood-v4-phase-a-stage-bundle.v1.attestation.json`. It verifies all bytes before
creation, rejects symbolic-link parents and replays only when every existing byte is identical.
The raw capture is never normalized: its digest is the subject digest in the embedded capture
authorization and its own `captureClosureDigest` is computed with that field set to `null`. The
signed stage, not a reconstructed manifest, binds the complete deployment descriptor, including
`captureClosureDigest`, `postingEventDigest` and `l1EvidenceDigest`, to the four raw backend assets.
A renderer must separately verify the capture and stage subjects before trusting that inventory.

```sh
npm run contracts:robinhood:postdeploy:stage-backend-assets -- \
  --stage /absolute/path/programmable-stage-bundle.json \
  --capture /absolute/path/programmable-postdeployment-capture.json \
  --capture-attestation-bundle /absolute/path/programmable-postdeployment-capture.attestation.json \
  --stage-attestation-bundle /absolute/path/programmable-stage-bundle.attestation.json \
  --source-verify-proof /absolute/path/production-verify-proof.json \
  --source-verify-attestation-bundle /absolute/path/production-verify-proof.attestation.json \
  --source-verify-run-id "$VERIFY_RUN_ID" \
  --source-verify-run-attempt "$VERIFY_RUN_ATTEMPT" \
  --source-verify-artifact-id "$VERIFY_ARTIFACT_ID" \
  --source-verify-artifact-digest "$VERIFY_ARTIFACT_DIGEST" \
  --backend-service-root \
    /absolute/path/to/programmable-open-hook-v2-internal/services/custom-launch-api-v1
```

The backend service root is the private repository's `services/custom-launch-api-v1` directory,
not the private repository root; all eight paths above are relative to that service root.

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
`programmable.robinhood-custom-launch.postdeployment-input.v3`:

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

### Sourcify publication and composite exact binding

If either source is not yet public, first run the repo-root GET-only review into
an existing owner-only directory outside the repository and OS temporary tree:

```sh
npm run contracts:robinhood:sourcify:review -- \
  --creation-transaction-hash "$ROBINHOOD_FOUNDATION_TX_HASH" \
  --output /absolute/owner-only/sourcify-review.json
```

This does not publish, sign or broadcast. The returned authorization digest is
valid only for that protected production tree, finalized creation transaction,
exact request bytes and disclosed legal/Blockscout side effects. `submit` is a
separate owner-authorized irreversible public-source publication and license
grant; see `contracts/security/ROBINHOOD-CUSTOM-LAUNCH.md` for the exact compound
acknowledgement. Never place credentials in either command or retain the plan or
receipt inside the source repository.

| Observed state | Safe recovery |
| --- | --- |
| Review/preflight fails before a POST | Correct the read-only/source issue and create a new review plan; nothing was published. |
| Durable attempt-marker write or its file/parent `fsync` fails | The operator sends zero POSTs and removes only its unused reservation. Correct the local owner-only filesystem issue and start from review. |
| One target published, the other failed or timed out | Keep the digest-valid `externalActionPossible=true` marker and its exact-readback checkpoints. Run `contracts:robinhood:sourcify:recover` against that marker first; it uses GET only. If one target remains missing, keep the marker and, only after renewed owner approval, re-run `submit` with the same still-valid plan and acknowledgements into a different absent output path. It never POSTs an already verified target. |
| Provider returns `exact_match`, runtime-only success, schema drift or mismatched bytes | Stop. Do not normalize it to success, change metadata or weaken the gate. Investigate and create a newly reviewed plan only after code review. |
| POST may have succeeded but local receipt temp-write, `fsync` or rename failed | Never delete the retained marker. Run GET-only `recover`; exact readback of both targets atomically replaces it with a `recovered-read-only` receipt without repeating a POST. |
| Parent-directory `fsync` or protected-source recheck fails after the atomic receipt rename | Keep the completed receipt exactly where written. Treat it as retained recovery evidence, not promotion authority, until source and filesystem state are reviewed. |
| Protected revision/tree changes after review | The submit step fails before POST. Re-run review against the new protected tree and obtain a new explicit authorization. |

The GET-only recovery command is:

```sh
npm run contracts:robinhood:sourcify:recover -- \
  --review-plan /absolute/owner-only/sourcify-review.json \
  --recovery-marker /absolute/owner-only/sourcify-publication-receipt.json
```

The review and every action-time rebind require a stable clean checkout equal
to both the local `origin/production` tracking ref and the freshly queried live
`refs/heads/production` revision. No mutable local tracking ref alone can
authorize publication.

Sourcify evidence retains bounded response bytes for Router and GraphFactory:

```text
GET /server/v2/contract/4663/{EIP55Address}?fields=all
```

`match`, `creationMatch` and `runtimeMatch` must all be `match`, with
`providerClassification=PARTIAL_NO_CBOR_EXACT_BYTES` and
`providerReleaseAuthority=false`. `exact_match` is rejected: the pinned Standard JSON inputs set
`metadata.appendCBOR=false`, so Sourcify cannot produce its metadata-backed exact classification.
The provider validator still binds compiler settings, metadata, sources and the repository Standard
JSON input into the source-verification closure.

The release-authoritative exact claim is a separate
`programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1` record. It
binds the protected revision/tree and capture authorization, the attested hosted Verify proof and
pinned Linux solc binary, both Standard JSON/compiler-settings digests, exact creation-code hashes,
the owner transaction hash/data hash and finalized block, and exact deployed runtime hashes observed
by both dRPC and Alchemy. A Sourcify response cannot replace or weaken this binding. These retained
historical Phase A provider URLs are code-owned HTTPS dRPC/Alchemy for Robinhood and HTTPS
dRPC/QuickNode for Ethereum; they are not the current owner action-time endpoint commitments. Only
sanitized hostnames enter evidence.

### Optional Blockscout observation

Blockscout is explorer evidence only and is not a Phase A, closure, stage, fresh-replay or
promotion requirement. The reviewed Standard JSON inputs set `metadata.appendCBOR=false`, while
Blockscout v11.2.8 derives its `FULL` classification from matching CBOR metadata. Consequently these
unchanged exact binaries are expected to be provider-classified `PARTIAL`; changing the compiler
profile, bytecode, CREATE2 addresses or owner envelope to obtain `FULL` is forbidden.

After an explicitly authorized optional Blockscout publication, a bounded read-only observation can
be captured from the repository root into a new owner-only file:

```sh
npm run contracts:robinhood:blockscout:observe -- \
  --output /absolute/protected/new-blockscout-observation.json
```

The observer queries the official
[`GET /api/v2/smart-contracts/{address}`](https://docs.blockscout.com/api-reference/get-smart-contract)
endpoint at `https://robinhoodchain.blockscout.com` for both contracts. It requires HTTP 200 JSON
within fixed per-response and aggregate byte/time bounds,
requires the exact `PARTIAL`/unchanged/no-twin provider flags, and independently compares the full
source closure, compiler version/settings, constructor arguments, creation bytes and deployed-byte
hash to the pinned Standard JSON and deployment bindings. Its receipt is permanently labeled
`PARTIAL_NO_CBOR_NOT_RELEASE_AUTHORITY`, `releaseAuthority=false`,
`promotionRequirement=false`, and
`exactSourceAuthority=protected-hosted-build-finalized-transaction-bytecode`.

A successful Blockscout submission, `is_verified` flag or this degraded observation never satisfies
exact source verification. A per-instance API deprecation, non-JSON response, rate limit or
Cloudflare challenge is an optional observation failure only; it must not weaken or replace the
required Sourcify V2 match or the independent exact byte/source/build/transaction binding.

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
subjectSha256
attestationBundlePath
attestationBundleSha256
bundleMediaType
verifier
certificateIdentity
certificateOidcIssuer
certificateGithubWorkflowName
certificateGithubWorkflowRepository
certificateGithubWorkflowRef
certificateGithubWorkflowSha
certificateGithubWorkflowTrigger
repository
repositoryId
workflow
sourceRef
sourceRevision
sourceTree
verifiedAt
verificationDigest
```

The authorization schema is
`programmable.robinhood-custom-launch.backend-capture-authorization.v3`; its production
`trustClass` is `sigstore-keyless-github-actions-protected-main-v1`. `verifier` fixes `cosign`,
version `v3.1.3`, and the exact Linux amd64 binary digest. Legacy bundles, public-key fallback,
wrong subject bytes, certificate-claim drift and insecure transparency/SCT bypasses fail closed.

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
programmable.robinhood-custom-launch.capture-authorization.v2
programmable.robinhood-custom-launch.capture-closure.v3
programmable.robinhood-custom-launch.sourcify-normalized-response.v2
programmable.robinhood-custom-launch.sourcify-response-closure.v5
programmable.robinhood-custom-launch.source-verification-closure.v5
programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1
programmable.robinhood-custom-launch.backend-promotion-input.v1
programmable.robinhood-custom-launch.backend-promotion-public-input.v2
programmable.robinhood-custom-launch.backend-promotion-semantic-input.v1
programmable.robinhood-custom-launch.backend-capture-authorization.v3
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
