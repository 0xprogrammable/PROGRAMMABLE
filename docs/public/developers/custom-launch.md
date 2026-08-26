---
description: Package, submit and track deterministic wallet-bound Custom launches
---

# Custom Launch API

Public V3 general-hook creation, list and single-resource reads are live for wallet-bound requests on Ethereum Mainnet. V2 and V1 history
reads remain available, while authenticated `POST /v1/custom-launches` stays permanently read only with
`409 CUSTOM_LAUNCH_V1_READ_ONLY`. Legacy Registry and GitHub submission intake is closed.

An external agent can package exact source and build artifacts, submit a byte-identical V3 request and track its
resource. An API key never signs or broadcasts a controller wallet transaction.

The [public V3 OpenAPI document](https://programmable.market/openapi/custom-launch-v3.json) is normative for creation
and current resources. The [V2 OpenAPI document](https://programmable.market/openapi/custom-launch-v2.json) and
[V1 OpenAPI document](https://programmable.market/openapi/custom-launch-v1.json) remain
compatibility contracts. The [raw agent guide](https://programmable.market/developers/custom-launch-api-v1.md) is
executable by a cold external agent.

## V3 general hook profile

The versioned [`programmable.direct-native-hook-graph.v1` OpenAPI](https://programmable.market/openapi/custom-launch-v3.json)
defines the live create, list and single-resource shapes. Discovery reports
`productionLaunchAuthorized: true`. Do not fall back to a different create version.

The Router primitive supports 2–16 targets; this V3 profile requires 3–16 direct CREATE2 graph targets because its
token, hook and initializer roles are distinct. The token, hook and all other targets are project-owned exact artifacts.
All valid v4 permission masks are supported; return-delta permissions require their matching action permissions, and
the compiled declaration must match the hook-address low bits. The request binds exact source, compiler,
creation bytecode, runtime, pool key, predicted initializer, expected pool ID and a flat
`programmable.eip3009-signature-patch.v1` descriptor. The patch names the initializer target, unsigned calldata hash,
calldata length and distinct selector-relative ABI-word offsets for `r`, `s` and `v`; those words must be zero before
the wallet signature exists and is present only in EIP-3009 mode. The initializer has per-launch exact source, build,
runtime, final-calldata and simulation evidence. There is no separate global initializer trust root.

The V3 platform share may be additive or included inside the selected buy or sell total. The backend derives and
discloses the exact effective, project and Programmable shares; the request never self-declares those results. The fixed
Programmable share is therefore `1,000 / 1,000,000 = 0.10% = 10 bps` of the documented kernel basis, paid to
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. Static pool fees and the `0x800000` dynamic-fee sentinel are supported.

Funding may be absent, carried as exact native Router-transaction value, or use an unsigned nine-field
`programmable.funding-authorization-descriptor.v1` for USDC EIP-3009
`receiveWithAuthorization`. Its separate `fundingIntentHash` is derived before a signature from the fixed route, launch
intent, wallet, predicted initializer, amount and validity window; it does not hash a final graph commitment containing
signature-bearing calldata. It also excludes the signature itself, `initializerCalldataHash` and `permitDigest`.
The create request contains no signature, `v`, `r` or `s`.

For EIP-3009 funding, one single-resource flow keeps the two wallet actions separate:

1. The API-key request reaches `awaiting_funding_authorization` and returns the exact `ReceiveWithAuthorization`
   typed data and digest.
2. The website checks the connected wallet, chain, USDC domain, `to`, value, nonce and
   `validAfter < now < validBefore`, then requests `eth_signTypedData_v4` only after an explicit user action. The
   65-byte lower-case `r || s || v` signature is posted once to the resource-specific wallet-admin URL. The CLI does
   not accept or submit this wallet signature.
3. The backend verifies and inserts the signature only at the bound zero ABI words, derives the final graph commitment,
   permit, artifact and Router transaction, and requires the exact simulation postconditions.
4. The website revalidates the exact Router transaction and asks for a second explicit wallet send. Nothing
   auto-signs or auto-broadcasts.

The public API key remains available only through `PROGRAMMABLE_API_KEY` or the supported operating-system secret
store. There is no key argument or prompt. V3 includes no ERC-20 approval, Permit2 approval, signer or
platform-approval shortcut.

## Liquidity is a project design

Calling `PoolManager.initialize` creates a Uniswap v4 pool and its starting price; it does not add liquidity. A project
using ordinary concentrated liquidity must fund and create its own position. Trading volume cannot create that initial
liquidity from nothing. The exact position owner, withdrawal path and any lock or burn must be part of the project
design and disclosed; the general profile does not silently lock a project-owned position.

The current CLI binds one explicit model into the request hash: `external-concentrated-liquidity` remains
`liquidity_required`; `launch-seeded-concentrated-liquidity` binds the exact seed target and remains
`assessment_required`; `hook-inventory-custom-accounting` binds the exact hook inventory path and remains
`assessment_required`. A project can request the required checks but cannot declare its own pass.

A launch can start with zero classical LP only when its project-owned hook and initializer implement custom accounting
or hold launch inventory that can exchange against incoming assets. Buys can then increase assets held by that hook,
but the token inventory, accounting and redemption or sell path still come from the project graph. `fundingMode: none`
only means the Router transfers no launch funding; it does not make an empty ordinary pool liquid.

The API checks exact source/build bindings, hook permission consistency, runtime trust roots, the declared platform-fee
conformance receipt and the final Router simulation. These checks do not prove that arbitrary custom token or hook
logic is free of honeypot behavior, privileged controls or economic risk. Projects must disclose transfer restrictions,
pause or upgrade controls, liquidity custody, withdrawal rules and buy/sell behavior, and users must review them.

## Platform fee policy

The general V3 profile is public on Ethereum Mainnet only (`chainId: "1"`) and has
`productionLaunchAuthorized: true`.

For each successful swap, the mandatory platform charge is 1,000 parts per 1,000,000 of the request-bound declared
assessment basis: `1,000 ppm = 0.10% = 10 bps`. The accounting mode is either
`additive-platform-share` or `inclusive-selected-total`; the server recomputes the buy and sell project share,
effective total, fee currency and rounding from the exact binding. Its exact claim binding is controlled by
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. A platform-signed receipt must bind the exact final graph and fee
behavior before the launch permit is signed. A reverted swap must roll back the fee with the rest of the transaction.

The pool's LP fee is separate from this platform charge and must be disclosed separately. Generic fee claiming and
buyback management for arbitrary hooks are not live. The reserved `fees:claim` and `buybacks:manage` scopes remain
disabled.

## Cold-agent quickstart

Install the pinned public GitHub Release asset. Do not substitute an unverified npm-registry package with the same name.

```bash
npm install --global \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.0.0/programmable-launch-3.0.0.tgz
programmable-launch --version
```

The release includes `examples/direct-native-v3-no-broadcast/README.md`, real Solidity sources, exact Standard JSON and
matching solc artifacts. Its generated evidence is limited to `pre-submit`. The deterministic permission salt grind
remains usable locally, and the example never submits, polls, signs or broadcasts.

Build the project from one pinned source revision and preserve:

- exact UTF-8 Solidity Standard JSON input with inline `sources[*].content`, never source URLs;
- the matching compiler artifacts with ABI, creation bytecode, deployed bytecode and compiler metadata;
- project-specific check evidence;
- exact constructor values, initializer values, salts and declared hook permissions.

Create the closed `programmable.launch-pack-config.v3` file described in the installed package README. Set
`source.publicOrigin.url` to the public HTTPS source repository and `source.publicOrigin.revision` to the exact
lowercase 40-character Git commit containing the submitted source bytes (`PROGRAMMABLE_SOURCE_REVISION` in the packaged revision-2 sample),
then run:

```bash
programmable-launch pack \
  --config programmable-launch.config.json \
  --output launch.json
programmable-launch validate launch.json \
  --config programmable-launch.config.json
programmable-launch submit ./launch.json \
  --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

With `--until authorized`, the status command stops at either the EIP-3009 funding handoff or the Router handoff. In
EIP-3009 mode, first complete the exact funding signature in the website, then run the same status command again. At
`authorized`, stop again so the connected controller can review and sign the exact Router transaction separately.
After the wallet broadcasts, continue with `--until finalized`; terminal failures always stop polling.

Manage a wallet-bound key at [API keys](https://programmable.market/developers/api-keys). Store it in an encrypted
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

## Public V3 request contract

`POST /v3/custom-launches` accepts the exact general-profile request. V1 POST remains read only for compatibility. The V3 fields
are:

| Field | Requirement |
| --- | --- |
| `schemaVersion` | `programmable.custom-launch-create-request.v3` |
| `launchWallet` | The Ethereum wallet bound to the API key |
| `chainId` | String `1` |
| `nonce` | A nonzero lowercase `bytes32` |
| `sourceDescriptor` | One `DeterministicSourceBundleV2` descriptor |
| `sourceBundleManifest` | One complete, non-empty, UTF-8 path-sorted manifest |
| `graphBundle` | One executable `CustomGraphBundleV1` |
| `agentAttestation` | One self-attestation for the exact graph subject |
| `permitWindow` | The exact bounded Router permit window |
| `launchProfile` | The complete general V3 production profile |
| `launchProfileSelection` | Exact target role and deployment bindings |
| `launchProfileHash` | CLI derived canonical profile digest |
| `launchIntentHash` | CLI derived exact request intent digest |
| `verificationBundle` | Exact source, compiler, runtime and constructor bindings |

`verificationBundle` is required in V3. Its compilation units
are uniquely UTF-8 sorted by `compilationUnitId`; its components are uniquely UTF-8 sorted by `targetId` and exactly
cover every graph target. The API validates the exact Standard JSON bytes and SHA-256, exact compiler build, source and
contract identity, and resolved constructor arguments against the prepared init code. URL-only source inputs fail.
Decoded Standard JSON is limited to 5,242,880 bytes per compilation unit and across all units in one request.

The graph accepts 3 to 16 acyclic direct targets, exactly one token and one hook. Complete graph input is limited to 524,288
bytes. Per-target init code is limited to 49,152 bytes and initializer calldata to 131,072 bytes. Use OpenAPI for every
nested field, enum and bound.

`agentAttestation` contains 1 to 64 unique `{ checkId, evidenceSha256 }` entries for checks the agent actually ran.
Programmable does not publish a universal check-ID catalog, fetch or assess that evidence, or adopt it as an audit,
approval or safety claim.

## Submit safely

`submit` proves that `launch.json` is byte identical to a fresh pack and writes its mode `0600` journal before network
access. Raw HTTP clients send `Authorization: Bearer $PROGRAMMABLE_API_KEY` only to
`https://api.programmable.market`. Retry timeout, `429` and `503` responses only with the exact persisted bytes and
idempotency key. Honor `Retry-After`.

New requests share a durable global admission cap of 120 created requests per hour and 500 per day. Exact
idempotent replay is checked first and consumes no additional capacity.

The response `requestHash` is the server's canonical idempotency digest. It is distinct from the CLI receipt's local
SHA-256 of exact `launch.json` bytes.

## Lifecycle and wallet boundary

Use `GET /v3/custom-launches/{launchId}` as the precise polling route. The path receives the API request
UUID returned as both `launchId` and `requestId`; `onchainLaunchId` is a different Router `bytes32` value. The bounded
history list can opportunistically reconcile pending rows, but returns `output: null`. It does not replace the
single-resource route. The single-resource response is the resource-level source of the exact prepared output and
failure state.

| Status | Meaning |
| --- | --- |
| `received` | The request is durably accepted. |
| `validating` | Request and graph validation are running. |
| `pending_review` | The exact graph is waiting for platform fee-conformance review. There is no wallet transaction to sign. |
| `action_required` | A deterministic indicator requires additional platform review. Read the exact report and contact support with the request ID when directed; this is not a wallet-signing stage. |
| `awaiting_funding_authorization` | EIP-3009 mode only: review and sign the exact typed data in the connected controller wallet. |
| `funding_authorization_verified` | The separate funding signature was verified and final calldata construction can continue. |
| `simulating` | The final graph and exact Router transaction are being simulated. |
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

The service readiness endpoint is [api.programmable.market/readyz](https://api.programmable.market/readyz). Readiness
does not grant wallet signing authority. For support, send only the response `error.requestId`, HTTP status, UTC time and
public error code. Never send the API key.

| HTTP | Action |
| --- | --- |
| `400` | Fix malformed JSON, fields, query values or Idempotency-Key. |
| `401` | Use an active key from the encrypted secret store. |
| `403` | Use the required scope and exact bound wallet. |
| `404` | Verify the request UUID and key without inferring another wallet's ownership. |
| `409` | Preserve the original idempotency binding. Fix a byte conflict locally before sending a new request. |
| `413` | Reduce the request to at most 8,388,608 bytes. |
| `415` | Send `Content-Type: application/json`. |
| `422` | Fix the reported source, graph, attestation, verification or permit binding. |
| `429` | Honor `Retry-After`. |
| `500` | Keep the response `error.requestId`; do not expose the key. Retry only when the operation is safe and the original bytes remain bound. |
| `503` | Honor `Retry-After` and retry only the byte identical journaled request. |

## Current boundary

Generic fee claiming and buyback management for arbitrary hooks are not live. FADE uses a specifically bound adapter;
an arbitrary Custom hook is not automatically claimable. That adapter does not create a generic capability. The
reserved `fees:claim` and `buybacks:manage` scopes remain disabled and
promise no future behavior. Public Hookbuilder and reusable-template intake are not part of this API.
