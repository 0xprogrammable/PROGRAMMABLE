# Programmable Custom Launch API V1

Use a wallet-bound API key to submit one deterministic Custom launch bundle, receive the exact prepared Router action
and read its durable status.

## Access boundaries

| Surface | Origin | Authentication |
| --- | --- | --- |
| Public discovery and Registry reads | `https://programmable.market` | None |
| Custom Launch API | `https://api.programmable.market` | `Authorization: Bearer pm_live_...` |

Create or revoke keys at <https://programmable.market/developers/api-keys>. V1 keys have exactly
`custom-launch:create` and `custom-launch:read`. The reserved `fees:claim` and `buybacks:manage` scopes are disabled.

An API key is not a wallet key. It cannot sign or broadcast a transaction.

## Create a launch

```sh
curl --fail-with-body https://api.programmable.market/v1/custom-launches \
  --request POST \
  --header "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: agent-launch-2026-0001" \
  --data-binary @launch.json
```

The closed request is limited to 2 MiB and requires all eight fields:

| Field | Requirement |
| --- | --- |
| `schemaVersion` | `programmable.custom-launch-create-request.v1` |
| `launchWallet` | The linked Ethereum wallet bound to the API key |
| `chainId` | String `1` |
| `nonce` | Nonzero lowercase `bytes32` |
| `sourceDescriptor` | Closed `DeterministicSourceBundleV2` descriptor |
| `sourceBundleManifest` | Complete, non-empty `SourceBundleManifestV2` |
| `graphBundle` | Executable `CustomGraphBundleV1` |
| `agentAttestation` | `AgentLaunchAttestationV1` with evidence digests for the exact graph |

Unknown fields fail before preparation.

### Source commitment

`sourceDescriptor` contains exactly:

- `schemaVersion: "2.0.0"`
- `kind: "deterministic-source-bundle"`
- `controllerWallet`
- `sourceLineageNonce`
- `sourceBundleDigest`
- `bundleContentSha256`
- `publicOriginCommitment`

`controllerWallet` must equal `launchWallet`.

`sourceBundleManifest` contains `schemaVersion: "2.0.0"` and at least one path-sorted entry. Every entry includes
`path`, `kind`, `mode`, decimal `byteLength`, `contentSha256` and `symlinkTarget`.

The platform recomputes:

```text
sourceBundleDigest = keccak256(
  utf8("programmable.source-bundle.v2") || 0x00 || JCS(sourceBundleManifest)
)
```

That digest must equal `sourceDescriptor.sourceBundleDigest`.
`graphBundle.sourceBundleSha256` must equal `sourceDescriptor.bundleContentSha256`.

These checks bind caller-declared commitments. They do not prove that source bytes exist or produced the submitted
bytecode.

### Executable graph

`graphBundle` contains exactly `schemaVersion`, `sourceBundleSha256`, `targets` and `pool`.

- `schemaVersion` is `programmable.custom-graph-bundle.v1`.
- The graph has 1 to 16 acyclic targets, exactly one `token` and exactly one `hook`.
- Every target declares creation bytecode, arguments, initializer calldata, address locators, native values, expected
  runtime code hash, component kind and hook permissions.
- Non-hook targets use `declaredHookPermissions: null`.
- Hook permission bits in the predicted address must equal the unique declared permission set.
- The pool names the declared token and hook targets, fee and tick spacing.

The complete graph input is limited to 524,288 bytes. Per-target init code is limited to 49,152 bytes and initializer
calldata to 131,072 bytes.

### Required agent attestation

`agentAttestation` contains exactly:

- `schemaVersion: "programmable.agent-launch-attestation.v1"`
- `subjectGraphBundleHash`, matching the canonical graph hash
- `agentId`
- canonical UTC `checkedAt`
- `checks`, with 1 to 64 unique entries

Every check requires `checkId` and a non-null `evidenceSha256` matching `sha256:<64 lowercase hex>`.

The attestation is the agent's claim. Programmable validates its shape, evidence-digest presence and graph-subject
binding, but does not fetch or assess the evidence. It is excluded from permit authorization.

## What the platform validates

The platform validates:

- API-key scope and linked-wallet binding
- closed request shape and bounds
- source-manifest digest consistency
- graph structure, fixed Mainnet contracts and hook permission/address binding
- required attestation shape, evidence digests and graph subject
- exact platform-permit and unsigned Router-action binding

The platform does not:

- compile or execute source
- reconstruct dependencies or compiler inputs
- verify that source produced bytecode
- simulate the transaction
- audit the project
- approve the project or attest safety
- sign or broadcast the controller wallet's transaction

## Idempotency and nonce conflicts

`Idempotency-Key` is 16 to 128 characters from `[A-Za-z0-9._:-]`.

- A new request returns `202`.
- An exact replay may return `200` with the original launch.
- Reusing the key with a different body returns `409`.
- Reusing a conflicting nonce for the bound wallet returns `409`.

Retry an ambiguous timeout with the same key and identical request body. Response `requestHash` values are labeled
`sha256:<64 lowercase hex>` digests.

## Read launch status

```sh
curl --fail-with-body \
  --header "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  https://api.programmable.market/v1/custom-launches/$LAUNCH_ID
```

The lifecycle is:

```text
received -> validating -> prepared -> authorized -> submitted -> finalized
```

`failed` and `cancelled` are terminal alternatives.

- `prepared`: the exact artifact and unsigned transaction exist.
- `authorized`: the platform permit is attached and the exact wallet handoff is ready. It is not wallet-signed or
  broadcast.
- `submitted`: the exact transaction was observed. It is not finalized.
- `finalized`: the transaction and Programmable Router stamp passed finality readback. This does not imply Registry
  publication or website availability.

The controller wallet, or an agent separately authorized to use that wallet, must review, sign and broadcast the exact
Router action.

## Provenance claim

A finalized, verified Router stamp can establish that a coin was launched through Programmable and bind its onchain
launch to the caller-declared source commitments and graph. It does not establish approval, source-to-bytecode
verification, audit coverage, safety, liquidity, tradability, endorsement or future value.

Machine contract: <https://programmable.market/openapi/custom-launch-v1.json>
