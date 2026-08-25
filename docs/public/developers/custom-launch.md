---
description: Package, submit and track one wallet-bound Custom launch through the live API
---

# Custom Launch API

The Custom Launch API is live for one concrete Custom hook project and token per request on Ethereum Mainnet. The legacy Registry
and GitHub submission intake is closed. A launch no longer requires a GitHub pull request.

An external agent can package exact source and build artifacts, validate the request, submit it with a wallet-bound API
key and poll one durable resource. At `authorized`, the agent stops. The controller wallet separately reviews and signs
the exact prepared transaction. The API key never signs or broadcasts it.

The normative request and response contract is the
[standalone OpenAPI document](https://programmable.market/openapi/custom-launch-v1.json). The raw
[V1 agent guide](https://programmable.market/developers/custom-launch-api-v1.md) remains compatible.

## Cold-agent quickstart

Install the pinned public GitHub Release asset. Do not substitute an unverified npm-registry package with the same name.

```bash
npm install --global \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.0/programmable-launch-1.0.0.tgz
programmable-launch --version
```

The release includes `examples/no-broadcast/README.md`, real Solidity sources, exact Standard JSON and matching solc
artifacts. Its generated config uses the pack-native deterministic hook-permission salt grind, reaches `authorized`
with a real wallet-bound request and then stops without signing or broadcasting.

Build the project from one pinned source revision and preserve:

- exact UTF-8 Solidity Standard JSON input with inline `sources[*].content`, never source URLs;
- the matching compiler artifacts with ABI, creation bytecode, deployed bytecode and compiler metadata;
- project-specific check evidence;
- exact constructor values, initializer values, salts and declared hook permissions.

Create the closed `programmable.launch-pack-config.v1` file described in the installed package README, then run:

```bash
programmable-launch pack \
  --config programmable-launch.config.json \
  --output launch.json
programmable-launch validate launch.json \
  --config programmable-launch.config.json
programmable-launch submit launch.json \
  --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

Create the wallet-bound key at [API keys](https://programmable.market/developers/api-keys). Store it in an encrypted
secret or environment variable named `PROGRAMMABLE_API_KEY`. Put only the literal placeholder
`$PROGRAMMABLE_API_KEY` in chat, prompts, agent setup and documentation. The CLI also supports the operating system
secret store. It has no `--api-key` flag and does not persist the key.

After the controller wallet broadcasts the reviewed transaction, resume only status polling:

```bash
programmable-launch status REQUEST_UUID --watch --until finalized
```

`finalized`, `failed` and `cancelled` always stop polling.

## What `pack` derives

`pack` consumes exact files and structured ABI values. It does not accept hand-written source, graph, verification or
runtime hashes. Do not enter derived hashes by hand or copy test-only hashes. It derives:

- `launch.json` and a deterministic pack receipt;
- a UTF-8 path-byte-sorted source manifest and exact file or symlink content commitments;
- `SourceDescriptor`, source bundle digest and canonical content SHA-256;
- ABI-encoded constructor arguments and initializer calldata;
- target-address locators, graph topological order, effective salts and CREATE2 predictions;
- normalized `CustomGraphBundleV1` and its canonical hash;
- check evidence digests and the agent attestation subject;
- exact Standard JSON bytes, solc build, settings, optimizer, EVM target, libraries, contract identity and resolved
  constructor arguments in `verificationBundle`;
- the domain-separated verification bundle hash and exact request-byte SHA-256.

For a hook, `applicantSalt` can use `deterministic-hook-permission-grind-v1`. After the source bundle, wallet, nonce,
init code and declared permissions are fixed, `pack` tries salts in unsigned integer order and chooses the first
predicted address whose low 14 bits match those permissions. A bounded miss fails with `HOOK_SALT_GRIND_EXHAUSTED`.

The source-content digest hashes RFC 8785/JCS bytes for
`{schemaVersion:"programmable.source-bundle-content.v1",entries:[manifest fields plus contentBase64]}`. Entries are
unique and sorted by UTF-8 path bytes. `contentBase64` is canonical base64 of exact file bytes or exact UTF-8 symlink
target bytes.

The full expected runtime code hash is derived only when deployed bytecode has no unresolved link or immutable
references. Otherwise `pack` fails closed with `RUNTIME_MATERIALIZATION_REQUIRED`. It never trusts a user-entered
runtime hash or metadata-stripped compiler template.

`validate` recalculates the manifest, source, graph, evidence and verification commitments. With `--config`, it also
requires `launch.json` to be byte-identical to a fresh pack of the same source and build inputs.

## Request contract

`POST /v1/custom-launches` accepts a closed JSON object up to 8,388,608 bytes (8 MiB). These eight V1 fields remain required:

| Field | Requirement |
| --- | --- |
| `schemaVersion` | `programmable.custom-launch-create-request.v1` |
| `launchWallet` | The Ethereum wallet bound to the API key |
| `chainId` | String `1` |
| `nonce` | A nonzero lowercase `bytes32` |
| `sourceDescriptor` | One `DeterministicSourceBundleV2` descriptor |
| `sourceBundleManifest` | One complete, non-empty, UTF-8 path-sorted manifest |
| `graphBundle` | One executable `CustomGraphBundleV1` |
| `agentAttestation` | One self-attestation for the exact graph subject |

`verificationBundle` is additive and optional so legacy V1 requests remain valid. When present, its compilation units
are uniquely UTF-8 sorted by `compilationUnitId`; its components are uniquely UTF-8 sorted by `targetId` and exactly
cover every graph target. The API validates the exact Standard JSON bytes and SHA-256, exact compiler build, source and
contract identity, and resolved constructor arguments against the prepared init code. URL-only source inputs fail.
Decoded Standard JSON is limited to 5,242,880 bytes per compilation unit and across all units in one request.

The graph accepts 1 to 16 acyclic targets, exactly one token and one hook. Complete graph input is limited to 524,288
bytes. Per-target init code is limited to 49,152 bytes and initializer calldata to 131,072 bytes. Use OpenAPI for every
nested field, enum and bound.

`agentAttestation` contains 1 to 64 unique `{ checkId, evidenceSha256 }` entries for checks the agent actually ran.
Programmable does not publish a universal check-ID catalog, fetch or assess that evidence, or adopt it as an audit,
approval or safety claim.

## Submit and retry safely

`submit` first proves that `launch.json` is byte-identical to a fresh pack of the supplied config and exact artifacts.
It then writes a mode `0600` journal before the first network request and binds the API origin and Idempotency-Key to
the exact request bytes. The key itself is never written.

Raw HTTP clients send `Authorization: Bearer $PROGRAMMABLE_API_KEY` only to `https://api.programmable.market`.

- A new request returns `202`; an identical replay may return `200`.
- A timeout, transport ambiguity, `429` or `503` retries only the persisted bytes with the same Idempotency-Key.
- `Retry-After` is honored as either seconds or an HTTP date.
- Reusing the key with different bytes fails locally. The server also returns `409 IDEMPOTENCY_CONFLICT`.
- `400`, `401`, `403`, `409`, `413`, `415` and `422` are not retried unchanged.

The response `requestHash` is the server's canonical idempotency digest. It is distinct from the CLI receipt's local
SHA-256 of exact `launch.json` bytes.

## Lifecycle and wallet boundary

Use `GET /v1/custom-launches/{launchId}` as the precise polling route. The legacy path name receives the API request
UUID returned as both `launchId` and `requestId`; `onchainLaunchId` is a different Router `bytes32` value. The bounded
history list can opportunistically reconcile pending rows, but returns `output: null`. It does not replace the
single-resource route. The single-resource response is the resource-level source of the exact prepared output and
failure state.

| Status | Meaning |
| --- | --- |
| `received` | The request is durably accepted. |
| `validating` | Request and graph validation are running. |
| `prepared` | The exact artifact exists. There is no wallet transaction to sign yet. |
| `authorized` | The permit and exact wallet transaction exist. Review and sign in the controller wallet. |
| `submitted` | Canonical Router evidence matches below 64 confirmations. |
| `finalized` | The matching canonical evidence reached at least 64 confirmations. |
| `failed` or `cancelled` | The request is terminal. |

Before signing, the wallet surface checks `chainId: "1"`, the connected controller as `from`, the exact production
Router as `to`, exact value and the response-contract selector and calldata. It never auto-signs or auto-broadcasts.

## Exact-source status

After a bundled request becomes finalized, provider verification is queued independently for every exclusive
component. Explorer failure never blocks or revises launch finality. `sourceVerification.status` is server-authored and
uses `queued`, `retrying`, `exact_match` or `needs_attention`. Only literal `exact_match` for every component means
Source verified. Clients must never infer, promote or submit that state. Legacy requests and requests without a bundle
remain compatible and unverified.

A finalized Router launch remains eligible for Explore and the connected wallet's Profile after discovery refreshes.
Router provenance is not approval, audit coverage, active liquidity, tradability or a safety claim.

## Errors and support

The live readiness endpoint is [api.programmable.market/readyz](https://api.programmable.market/readyz). For support,
send only the response `error.requestId`, HTTP status, UTC time and public error code. Never send the API key.

| HTTP | Action |
| --- | --- |
| `400` | Fix malformed JSON, fields, query values or Idempotency-Key. |
| `401` | Use an active key from the encrypted secret store. |
| `403` | Use the required scope and exact bound wallet. |
| `404` | Verify the request UUID and key without inferring another wallet's ownership. |
| `409` | Preserve exact bytes for replay, or create a new nonce and key only when the error code requires it. |
| `413` | Reduce the request to at most 8,388,608 bytes. |
| `415` | Send `Content-Type: application/json`. |
| `422` | Fix the reported source, graph, attestation, verification or permit binding. |
| `429` | Honor `Retry-After`. |
| `503` | Retry the identical request after `Retry-After` when present. |

## Current boundary

Generic fee claiming and buyback management for arbitrary hooks are not live. FADE uses a specifically bound adapter;
an arbitrary Custom hook is not automatically claimable. That adapter does not create a generic capability. The
reserved `fees:claim` and `buybacks:manage` scopes remain disabled and
promise no future behavior. Public Hookbuilder and reusable-template intake are not part of this API.
