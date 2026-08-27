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

## Existing-project integration

An API key authorizes API operations for its bound wallet; it does not contain integration instructions. A cold agent
must start at [`/.well-known/programmable.json`](https://programmable.market/.well-known/programmable.json), select
`customLaunchApi.agentIntegration`, then fetch the advertised
[`programmable.custom-launch-agent-remediation-catalog.v1`](https://programmable.market/policies/custom-launch-agent-remediation-v1.json),
this guide, the V3 OpenAPI contract and the pinned CLI release. That public chain is the integration contract for every
project. There is no project-specific allowlist or private approval path.

For an existing project, the agent must inspect the exact repository rather than guess a profile:

1. Pin the public source repository and exact immutable Git object containing every submitted source byte.
2. Compile every direct graph target with `solc 0.8.26+commit.8a97fa7a`; preserve exact Standard JSON, artifacts,
   libraries, constructor values and runtime immutables.
3. Identify the distinct token, hook and initializer targets, map all address dependencies, declare the exact hook
   permission mask, and select the real pool, funding, liquidity, fee, custody and withdrawal behavior.
4. Create `programmable-launch.config.json` with `schemaVersion: programmable.launch-pack-config.v3` and validate it
   against the [machine-readable pack-config schema](https://programmable.market/schemas/custom-launch/v3/pack-config.json).
   Ask for the public token name and symbol plus description, image choice and social links. Use exact source, build,
   ABI and owner-supplied presentation values only; the CLI owns every digest, locator, CREATE2 prediction and request byte.
5. Follow machine-readable local diagnostics. After submission, follow the single-resource remediation payload and
   exact static report. `action_required` means change the reported source or config, rebuild, repack and submit a new
   immutable request. It is not a request for manual approval and cannot be bypassed by retrying unchanged bytes.

Before submission, fetch unauthenticated `GET https://api.programmable.market/v3/capabilities`, then run
`programmable-launch validate launch.json --config programmable-launch.config.json --remote`. Remote validation first
repeats the exact local validation and byte reproduction, then sends those same request bytes to authenticated
`POST /v3/custom-launches/preflight` with the wallet-bound Bearer API key. Preflight consumes no launch quota, allocates
no nonce and persists no launch. It never signs or broadcasts. A successful response is
`programmable.custom-launch-preflight.v1` and carries the exact `requestHash`, `profileRevision`, `serverTime`,
`disposition`, `launchEligibility`, `evidenceTier`, `riskClassification`, platform-owned `behaviorEvidence`, all six
`productTruthAxes`, hard-block, needs-evidence and warning code arrays, the bounded `staticBaseline`, typed
`remediations`, and the five fixed side-effect fields. A `not_executed` behavior vector is outstanding, not failed or
verified. Unknown additive fields may be preserved; they never relax a required false or true invariant.

For USDC EIP-3009 funding, the CLI is the derivation authority. Project code must accept and forward the exact
`from`, predicted-initializer `to`, `value`, validity window and nonce. It must not substitute an application-specific
funding domain or nonce. The published domains are
`programmable.direct-native-hook-graph.funding-intent.v1` and
`programmable.direct-native-hook-graph.funding-nonce.v1`. Current authorization patch V2 binds four distinct zero ABI
leaves: `bytes32 nonce`, `bytes32 r`, `bytes32 s` and `uint8 v`. Configure only
`nonceArgumentPath`, `rArgumentPath`, `sArgumentPath` and `vArgumentPath`; each has 1–16 zero-based indices from 0
through 255. The first index selects a top-level initializer input and later indices may descend static tuple components
or fixed arrays. Dynamic parents are not supported. The CLI derives the exact calldata offsets from the compiled ABI and proves
canonical decode and re-encode; applicants do not submit offsets. The backend later inserts only the derived nonce and
verified signature. The create request still contains no wallet signature.

When exact source, ABI and compiler artifacts do not contain enough AST or IR evidence to prove the initializer's nonce
dataflow offline, tooling may report the nonblocking warnings `FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED` or
`FUNDING_NONCE_CONFORMANCE_UNPROVEN`. Inspect and fix a real conflict before submitting. The mandatory exact Router
simulation is the final execution-compatibility detector for the prepared transaction; neither a warning nor a
successful simulation is a safety, admission, liquidity, fee-behavior or economic-solvency claim.

The catalog also makes the liquidity boundary explicit. Pool initialization does not add liquidity, volume cannot
create initial liquidity from nothing, and V3 does not inject the Classic liquidity engine. Select and fully bind one
of `external-concentrated-liquidity`, `launch-seeded-concentrated-liquidity` or
`hook-inventory-custom-accounting` according to the project's actual implementation.

## V3 general hook profile

The versioned [`programmable.direct-native-hook-graph.v1` OpenAPI](https://programmable.market/openapi/custom-launch-v3.json)
defines the live create, list and single-resource shapes. The default profile uses
`schemaVersion: programmable.direct-native-hook-graph-profile.v3`, `profileRevision: 3` and
`profileVersion: 3.2.0`; its selection binding uses
`programmable.direct-native-hook-graph-profile-selection-binding.v3`. Exact metadata-absent `3.1.0` and `3.0.0` requests remain readable and
byte-identical retryable under their original immutable policy; revision 2 also remains a compatible profile contract
for existing clients and resources. Discovery reports `productionLaunchAuthorized: true`. Do not fall back
to a different create version.

The Router primitive supports 2–16 targets; this V3 profile requires 3–16 direct CREATE2 graph targets because its
token, hook and initializer roles are distinct. The primary token and hook are project-owned exact artifacts, as are all
other direct targets. Native and ERC-20 quote currencies are structurally supported. All fourteen Uniswap v4 permission
bits are structurally supported across masks `0` through `16383`; return-delta permissions require their matching action
permissions, every enabled callback must have concrete reachable code, and the compiled declaration must match the
hook-address low bits. Structural support is not a universal behavior or safety promise. The request binds exact source, compiler,
creation bytecode, runtime, pool key, predicted initializer, expected pool ID and a
`programmable.eip3009-authorization-patch.v2` descriptor. The patch names the initializer target, unsigned calldata
hash, calldata length, authorization encoding and numeric ABI paths for the zero `nonce`, `r`, `s` and `v` leaves. The
CLI derives their offsets from the exact compiled ABI; the backend patches only those proven leaves. Existing exact V1
requests retain their original descriptor semantics. The initializer has per-launch exact source, build, runtime,
final-calldata and simulation evidence. There is no separate global initializer trust root.

The V3 platform share may be additive or included inside the selected buy or sell total. The backend derives and
discloses the exact effective, project and Programmable shares; the request never self-declares those results. The fixed
Programmable share is therefore `1,000 / 1,000,000 = 0.10% = 10 bps` of the documented kernel basis, paid to
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. Static pool fees and the `0x800000` dynamic-fee sentinel are supported.

Funding may be absent, carried as exact native Router-transaction value, or use an unsigned nine-field
`programmable.funding-authorization-descriptor.v1` for USDC EIP-3009
`receiveWithAuthorization`. Its separate `fundingIntentHash` is derived before a signature from the fixed route, launch
intent with four zero authorization leaves, wallet, predicted initializer, amount and validity window. The funding nonce
is then derived from that intent. It does not hash the final graph containing the patched nonce or signature. It also
excludes the signature itself, `initializerCalldataHash` and `permitDigest`. The create request contains the derived
funding descriptor and authorization patch, but no signature, `v`, `r` or `s` value.

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

Profiles `3.1.0` and `3.2.0` check exact source/build bindings and hook permission consistency, then apply role-aware static admission.
Every enabled Uniswap v4 permission must resolve to a concrete reachable callback implementation; an interface
declaration or fallback-only route does not qualify.
Every finding remains bound and visible. Exactly seven objective code-and-role rules hard-block deployment: runtime
`CALLCODE`, runtime or source `SELFDESTRUCT`, definitively missing or invalid callback authentication, a literal wrong
PoolManager, and a missing enabled callback implementation. Proxy or delegatecall use, mint/tax/pause/transfer
controls, liquidity custody or locking, external dependencies and return-delta custom accounting are evidence duties,
not categorical deployment blocks. A hard-block match returns `action_required`; other findings populate
`needsEvidenceFindingCodes` or warnings. There is no manual project allowlist. A final Router simulation is mandatory
before authorization.

When no hard-blocking pair matches, the server-authored `platformAdmission` status binds the report SHA-256,
needs-evidence and warning codes with disposition `no_blocking_static_finding`, while requiring Router simulation and explicitly setting
`safetyClaim: false` and `feeBehaviorClaim: false`. A blocking match instead exposes the exact static report through
`action_required`.

Static admission and simulation do not prove that arbitrary custom token or hook logic is free of honeypot behavior,
privileged controls or economic risk. They are not an audit or a guarantee of safety, liquidity, tradeability or fee
behavior. Projects must disclose transfer restrictions, pause or upgrade controls, liquidity custody, withdrawal rules
and buy/sell behavior, and users must review them.

## Platform fee policy

The general V3 profile is public on Ethereum Mainnet only (`chainId: "1"`) and has
`productionLaunchAuthorized: true`.

Every V3 request must bind and disclose a Programmable share of 1,000 parts per 1,000,000 of its declared assessment
basis: `1,000 ppm = 0.10% = 10 bps`. The accounting mode is either
`additive-platform-share` or `inclusive-selected-total`; the server recomputes the buy and sell project share,
effective total, fee currency and rounding from the exact binding. Its exact claim binding is controlled by
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. Revision 3 does not issue a fee-conformance certification. The declared
fee bindings remain part of the exact launch intent, but `feeBehaviorClaim: false` means static admission and Router
simulation do not certify or enforce how arbitrary custom code charges or routes fees on later swaps. Inspect the
exact project implementation.

The pool's LP fee is separate from this platform charge and must be disclosed separately. Generic fee claiming and
buyback management for arbitrary hooks are not live. The reserved `fees:claim` and `buybacks:manage` scopes remain
disabled.

## Product-truth axes stay separate

Capabilities publishes six independent `productTruthAxes`: `deployment`, `trading`, `platform_fee_evidence`,
`source_verification`, `indexing` and `featured`. Evidence on one axis never proves another. In particular:

- preflight `launchEligibility.deployable` means the exact request clears the bounded deployment-mechanics preflight;
  it does not mean a transaction was signed, broadcast or finalized;
- `routable` is a current evidence classification, not proof of live trading, liquidity, price quality or economic
  safety;
- request-bound platform-fee declarations and static admission do not replace separate platform-fee behavior evidence;
- only server-authored `sourceVerification.status: exact_match` for every required component means source verified;
- Router finality does not itself prove an indexing refresh, and indexing does not prove trading or source verification;
- `featured` is a separate placement decision and must never be inferred from deployment, routing or indexing.

The four preflight dispositions are `supported`, `supported_with_warnings`, `needs_evidence` and `unsupported`. They
classify the exact submitted bytes at the stated evidence tier. None is an audit, universal compatibility statement or
safety guarantee.

Every durable resource also has additive `lifecycleQueue` readback. It reports bounded worker scheduling, attempts and
poll guidance only. Queue completion is not launch finality, and a queue retry does not change the durable launch
status. The single-resource GET remains the canonical polling path.

## Cold-agent quickstart

Install the pinned public GitHub Release asset. Do not substitute an unverified npm-registry package with the same name.

```bash
programmable_cli_dir="$(mktemp -d)"
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.5.tgz" \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.5/programmable-launch-3.3.5.tgz
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.5.tgz.sha256" \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.5/programmable-launch-3.3.5.tgz.sha256
(cd "$programmable_cli_dir" && shasum -a 256 -c programmable-launch-3.3.5.tgz.sha256)
npm install --global "$programmable_cli_dir/programmable-launch-3.3.5.tgz"
programmable-launch --version
```

Continue only after the checksum command reports `OK` and the version command prints `3.3.5`.

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
lowercase 40-character Git commit containing the submitted source bytes (`PROGRAMMABLE_SOURCE_REVISION` in the packaged sample),
then run:

```bash
programmable-launch pack \
  --config programmable-launch.config.json \
  --output launch.json
programmable-launch validate launch.json \
  --config programmable-launch.config.json \
  --remote
programmable-launch submit ./launch.json \
  --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

The agent state machine is `pack -> validate --remote -> submit -> status --watch --until authorized -> wallet ->
status --watch --until finalized`. `wallet` means stop for the connected controller to review and sign; it is not a
fifth CLI command. Authenticated CLI traffic is fixed to exact origin `https://api.programmable.market`; there is no
origin override. Remote validation and later submission use the same exact request bytes. Preflight has no
Idempotency-Key because it creates no durable resource; `submit` keeps its existing durable idempotency and retry
rules.

With `--until authorized`, the status command stops at either the EIP-3009 funding handoff or the Router handoff. In
EIP-3009 mode, first complete the exact funding signature in the website, then run the same status command again. At
`authorized`, stop again so the connected controller can review and sign the exact Router transaction separately. When
present, use only the resource's HTTPS `walletHandoffUrl` before its `expiresAt`; refetch the single-resource status after
expiry rather than signing stale material.
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
| `projectMetadata` | Canonical token declaration and presentation, required by current profile `3.2.0` |
| `projectMetadataHash` | Domain-framed SHA-256 bound into the graph hash and launch identity |
| `agentAttestation` | One self-attestation for the exact graph subject |
| `permitWindow` | The exact bounded Router permit window |
| `launchProfile` | The complete general V3 production profile |
| `launchProfileSelection` | Exact target role and deployment bindings |
| `launchProfileHash` | CLI derived canonical profile digest |
| `launchIntentHash` | CLI derived exact request intent digest |
| `verificationBundle` | Exact source, compiler, runtime and constructor bindings |

The pack config asks explicitly for `token.name`, `token.symbol`, `presentation.description`,
`presentation.image`, and `presentation.links`. Name and symbol are owner-supplied canonical public text bounded to 64
and 16 UTF-8 bytes. Image is either an explicit `null` or exact local PNG/JPEG/WebP/GIF bytes paired with a canonical
public HTTPS, `ipfs://`, or `ar://` URI; links are at most 32 canonical public HTTPS entries. The packer includes image
bytes in the source manifest, sorts links and derives `projectMetadata`, `projectMetadataHash` and the metadata-bound
`graphBundleHash`. It statically compares an unambiguous constructor or initializer name/symbol argument when one
exists, without forcing arbitrary tokens into a specific constructor. Finalized launches expose the declaration plus
server-authored onchain name/symbol readback through the public finalized-metadata endpoint.

Use a stable content URI and enable browser-readable CORS for HTTPS image bytes. Wallet review verifies raw bytes
against the bound SHA-256, length, media type and dimensions before rendering; IPFS and Arweave use fixed public
gateways. If the bytes cannot be read or do not match, the review uses the digest and a placeholder. It never uploads
or substitutes content, mutates the launch, or signs automatically.

`verificationBundle` is required in V3. Its compilation units
are uniquely UTF-8 sorted by `compilationUnitId`; its components are uniquely UTF-8 sorted by `targetId` and exactly
cover every graph target. For the default revision-3 profile, every unit uses exact
`solc 0.8.26+commit.8a97fa7a`. The API validates exact Standard JSON bytes and SHA-256, source and contract identity,
and resolved constructor arguments against the prepared init code. URL-only source inputs fail. Decoded Standard JSON
is limited to 5,242,880 bytes per compilation unit and across all units in one request, with at most 2,048 inline
sources. Revision-2 requests retain their compatibility contract.

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
| `pending_review` | Exact-source admission or Router preparation is still running. There is no wallet transaction to sign. |
| `action_required` | One of the current profile's exact hard-blocking code-and-role rules matched. Read the exact bound report and contact support with the request ID when directed; this is not a wallet-signing stage. |
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
does not grant wallet signing authority. For `action_required`, preserve the resource `requestId` and exact static
report. For HTTP errors, preserve `error.requestId`. For support, send only that request ID, HTTP status, UTC time and
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
