# Programmable Custom Launch API

V3.3 is public and live: general custom-hook launch creation, list and single-resource reads are available at
`https://api.programmable.market` for wallet keys, partner roots and bounded partner subkeys. V2 and V1 history remain
available for existing requests, and their schemas remain published. Fresh authenticated `POST /v2/custom-launches`
and `POST /v1/custom-launches` are permanently read only with non-retryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and
`409 CUSTOM_LAUNCH_V1_READ_ONLY`. Only V3.3 accepts new submissions. Legacy Registry and GitHub submission intake is
closed.

V2 detail reads are observation-only while an existing request is `prepared` or `simulating`: GET does not advance
simulation or authorization and cannot expose a new `walletTransaction`. Existing `authorized` and `submitted`
reconciliation and finalized reads remain available.

Normative public V3 OpenAPI: <https://programmable.market/openapi/custom-launch-v3.json>

V2 compatibility OpenAPI: <https://programmable.market/openapi/custom-launch-v2.json>

V1 compatibility OpenAPI: <https://programmable.market/openapi/custom-launch-v1.json>

Human guide: <https://programmable.market/docs/developers/custom-launch>

Readiness: <https://api.programmable.market/readyz>

The live unauthenticated `GET /v3/finalized-custom-launches` response uses top-level `launches` and required top-level
`quality`. Quality contains `status` (`complete` or `partial`), `sourceRowCount`, `publishedRowCount`,
`quarantinedRowCount`, and row-indexed `FINALIZED_ROW_QUARANTINED` diagnostics. A partial page is not a complete
inventory. Each launch item also carries required `launchProfileVersion` (`2.0.0`, `3.0.0`, `3.1.0`, `3.2.0`,
`3.3.0`, or `3.4.0`) so clients can interpret profile-conditional metadata without inference.

## Existing-project integration

The API key is scoped API authorization, not an instruction bundle or wallet authority. Start every cold-agent run at
<https://programmable.market/.well-known/programmable.json>. Read `customLaunchApi.partnerCredentials` to distinguish
partner roots and bounded subkeys from wallet keys. Then read `customLaunchApi.agentIntegration` and fetch the advertised
machine-readable remediation catalog:
<https://programmable.market/policies/custom-launch-agent-remediation-v1.json>. The catalog, this guide, V3 OpenAPI and
the pinned CLI release are the complete public integration path. There is no project allowlist or private approval
step.

Fetch public `GET https://api.programmable.market/v3/capabilities`, then use the exact state machine
`pack -> validate --remote -> submit -> status --watch --until authorized -> wallet -> status --watch --until
finalized`. `validate --remote` first repeats local byte-identical
validation and then posts those same bytes to Bearer-authenticated `POST /v3/custom-launches/preflight`. The preflight
uses scope `custom-launch:create`, consumes no launch-creation quota, allocates no nonce, persists no launch, requires a
later wallet signature and never broadcasts. `quotaConsumed: false` does not mean the HTTP call is unmetered: its
ordinary authenticated route rate budget still applies, and partner preflight counts against `prepareRequestsPerHour`. `wallet` is a
separate connected-controller action, not a CLI command.
Authenticated CLI traffic is fixed to exact origin `https://api.programmable.market`; there is no origin override.
Local CLI results and preflight prepare and classify the exact request; neither is the launch decision. After durable
submission, the API server independently enforces the objective static hard blocks and exact Router simulation before
it exposes a wallet handoff. Missing or unavailable behavior execution leaves behavior, fee, liquidity and routability
claims unverified; an authenticated executed failure blocks the handoff. A client, model or caller attestation cannot
declare evidence verified or bypass a server gate.

For an existing repository, pin the exact public source object, compile every direct graph target with
`solc 0.8.26+commit.8a97fa7a`, map the distinct token, hook and initializer roles plus all address dependencies, declare
the exact permission mask, and choose the real funding, liquidity, fee, custody and withdrawal behavior. Create
`programmable-launch.config.json` with `schemaVersion: programmable.launch-pack-config.v3` and validate it against
<https://programmable.market/schemas/custom-launch/v3/pack-config.json>. The CLI derives every digest, locator, CREATE2
address and request byte; never copy or hand-write them.

USDC EIP-3009 projects must accept and forward the CLI-derived descriptor exactly. The funding domains are
`programmable.direct-native-hook-graph.funding-intent.v1` and
`programmable.direct-native-hook-graph.funding-nonce.v1`; project code must not replace them with an application-specific
domain or nonce. Current authorization patch V2 binds four distinct zero ABI leaves: `bytes32 nonce`, `bytes32 r`,
`bytes32 s` and `uint8 v`. Configure 1–16 zero-based ABI argument indices from 0 through 255 for each leaf. Paths can
descend static tuple components and fixed arrays but not dynamic parents. The CLI derives exact offsets from the compiled ABI and
proves canonical decode and re-encode; applicants never submit offsets. The backend later inserts only the derived
nonce and verified signature.

Tooling may report `FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED` or
`FUNDING_NONCE_CONFORMANCE_UNPROVEN` when source, ABI and compiler artifacts cannot prove complete nonce dataflow
offline. These are nonblocking warnings, not conformance or safety claims. Inspect a real conflict before submitting.
The mandatory exact Router simulation is one server-side execution-compatibility check for the prepared transaction; a
successful simulation is not by itself the server decision or a safety, admission, liquidity, fee-behavior or
economic-solvency claim.

Pool initialization does not add liquidity, volume cannot create initial liquidity from nothing, and V3 does not
inject Classic liquidity. Bind the implementation's actual `external-concentrated-liquidity`,
`launch-seeded-concentrated-liquidity` or `hook-inventory-custom-accounting` model. After submission,
`action_required` means fix the exact bound target/source finding, rebuild, repack and submit a new immutable request.
Retrying unchanged bytes or asking for a manual allowlist cannot bypass it.

## V3 general hook boundary

The `programmable.direct-native-hook-graph.v1` document is the V3 production request, resource and wallet-handoff
contract. The default profile uses `schemaVersion: programmable.direct-native-hook-graph-profile.v3`,
`profileRevision: 3` and `profileVersion: 3.3.0`; its selection binding uses
`programmable.direct-native-hook-graph-profile-selection-binding.v3`. Exact `3.2.0` requests retain their original metadata rules; metadata-absent `3.1.0` and `3.0.0` requests remain readable and
byte-identical retryable under their original immutable policy; revision 2 also remains a compatible profile contract
for existing clients and resources. The Router primitive supports 2-16 targets; the direct
native profile requires 3-16 because token, hook and initializer roles are distinct. It accepts a project-owned token,
a project-owned hook, native or ERC-20 quote currency, all fourteen Uniswap v4 permission bits across masks `0` through
`16383`, and an exact multi-contract graph. It does not substitute a Programmable-owned hook. Every enabled v4
permission must resolve to a concrete reachable callback implementation;
an interface declaration or fallback-only route does not qualify.

CLI `3.3.9` is the current installable release and defaults fresh packs to live profile `3.3.0`. Explicit profile
`3.4.0` output remains preparatory and is rejected by live capabilities until backend and `.well-known` activation.
Pending `3.4.0` requires 4-16 targets inclusive of the exact
`programmable:settlement-fee-vault:v1`; applicants cannot select another platform fee target. Its release binding is
`sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9`, source SHA-256 is
`sha256:0a01ee8c22d103343d14b1d3890902e3edeecef25ea84a0f03f23a3fe8f1042b`, and creation/runtime Keccak-256 are
`0xdbc32e835739b50f33a101a8927008fc46af4c11604f7a5da006e5c56288b21e` and
`0x92620fe3f83839334c9a264bea5bfcc819868ca5607cbd2260e5a9664dbd7554`. The vault uses solc 0.8.26, EVM Paris,
optimizer 1000 and no CBOR; its constructor binds the GraphFactory and `bindRoute(address)` locates one distinct route.
Exactly one constructor or initializer locator on that project-owned route points back to the vault. The route may be
the hook or a custom AMM, while `settlementFeeVault()` and full fee-path behavior remain server-evidence requirements.

The open arbitrary-custom-hook lane does not carry a Programmable fee claim. A 10 bps share applies only when the
request selects a fee-certified profile or adapter and the API server verifies its per-launch behavior for the exact
stamped PoolKey. Revision 3 does not turn a declaration, local check, static report or Router simulation into a fee
certification. Source, compiler settings, constructor arguments, final calldata and server evidence remain bound per
launch.
The pool may use a static fee or the Uniswap v4 dynamic-fee sentinel. Funding may be absent, carried as the exact
native value of the separately reviewed Router transaction, or use an unsigned USDC EIP-3009 descriptor. Any later
funding signature and the Router transaction remain separate explicit wallet actions and are never produced or sent
by the API key.

## Platform fee policy

The general V3 production profile is available on Ethereum Mainnet only (`chainId: "1"`) and has
`productionLaunchAuthorized: true`.

A Programmable share of `1,000` hundredths of a bip, equal to `0.10% = 10 bps`, is claimed only for a fee-certified profile or adapter and its
exact stamped PoolKey. That lane binds the accounting mode, fee currency, rounding and claim destination and requires
server-authored per-launch fee-path evidence before the platform makes that claim. Arbitrary custom hooks are not automatically
fee-enforced, and the open arbitrary-hook lane carries no Programmable fee claim. Revision-3 local validation, static
admission and Router simulation do not independently create `feeBehaviorClaim: true`.
For that certified lane, the bound Programmable recipient is `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`.

Where a selected lane uses applicant buy or sell rates, each rate is capped at `100,000` hundredths of a bip:
`1,000 bps = 10%`. The API server enforces the cap in both `additive-platform-share` and
`inclusive-selected-total` modes. The separate platform value is `1,000` hundredths of a bip, equal to `10 bps`; the
additive and inclusive accounting meanings do not change.

The pool's LP fee is separate from this platform charge and must be disclosed separately. Generic fee claiming and
buyback management for arbitrary hooks are not live. The reserved `fees:claim` and `buybacks:manage` scopes remain
disabled.

## Liquidity and safety boundary

Normal Uniswap v4 pool initialization sets the starting price but adds no liquidity. A project using ordinary
concentrated liquidity must fund and create its own position; trading volume cannot create the initial liquidity from
nothing. Position custody, withdrawal and any lock or burn are project behavior and must be disclosed.

New CLI requests bind `external-concentrated-liquidity`, `launch-seeded-concentrated-liquidity`, or
`hook-inventory-custom-accounting` into the exact request hash. The external model remains `liquidity_required`; the
seeded and hook-inventory models remain `assessment_required` until the platform has separate exact evidence. A
request cannot self-declare that assessment as passed.

Zero classical LP works only when the project hook and initializer implement custom accounting or hold launch
inventory that can exchange against incoming assets. Buys may then grow assets held by the hook, but the initial token
inventory and the buy, sell, redemption and withdrawal paths still come from the exact project graph. Funding mode
`none` does not make an empty ordinary pool liquid.

Current profile `3.3.0` checks exact source/build bindings, hook permissions and address bits, then applies a role-aware static
baseline. Exactly seven objective code-and-role rules hard-block deployment: runtime `CALLCODE`, runtime or source
`SELFDESTRUCT`, a definitively missing or invalid callback authentication guard, a literal noncanonical PoolManager,
or a missing enabled callback implementation. Proxy or delegatecall use, mint/tax/pause/transfer controls, liquidity
custody or locking, external dependencies and return-delta custom accounting remain bound evidence duties rather than
categorical deployment blocks. A hard-block match returns `action_required`; other findings populate
`needsEvidenceFindingCodes` or warnings. There is no manual project allowlist. A final Router simulation is mandatory,
and the API server independently requires it to pass before wallet handoff. Behavior execution is additional evidence:
absence leaves behavior-derived claims unverified, while an authenticated executed failure blocks the handoff.

When no blocking pair matches, the server-authored `platformAdmission` status binds the report SHA-256 and warning
codes with disposition `no_blocking_static_finding`, while requiring Router simulation and explicitly setting
`safetyClaim: false` and `feeBehaviorClaim: false`. A blocking match instead exposes the exact static report through
`action_required`.

Static admission and simulation do not prove that arbitrary custom code has no honeypot behavior, privileged controls
or economic risk. They are not an audit or a guarantee of safety, liquidity, tradeability or fee behavior. A project
must disclose transfer restrictions, pause or upgrade controls, liquidity custody, withdrawal behavior and buy/sell
conditions.

Capabilities keeps six product-truth axes independent: `deployment`, `trading`, `platform_fee_evidence`,
`source_verification`, `indexing` and `featured`. Preflight `launchEligibility.deployable`, `routable` and `featured`
are bounded classifications at the returned `evidenceTier`; they do not prove a deployment occurred, live trading or
liquidity exists, platform-fee behavior was proven, source verification reached `exact_match`, indexing refreshed, or
feature placement happened. The response disposition is `supported`, `supported_with_warnings`, `needs_evidence` or
`unsupported` and includes typed finding-code arrays, `riskClassification`, `behaviorEvidence`, `productTruthAxes`,
`staticBaseline` and `remediations`. A `not_executed` or `needs_evidence` result remains outstanding; it is neither a
failure nor a caller-declared pass and cannot support a positive behavior, fee, liquidity or routability claim. None is
an audit, universal compatibility statement or safety guarantee.

## Install the public CLI

Install only the immutable GitHub Release asset:

```sh
programmable_cli_dir="$(mktemp -d)"
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.9.tgz" \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.9.tgz.sha256" \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz.sha256
(cd "$programmable_cli_dir" && shasum -a 256 -c programmable-launch-3.3.9.tgz.sha256)
npm install --global "$programmable_cli_dir/programmable-launch-3.3.9.tgz"
programmable-launch --version
```

Continue only after the checksum command reports `OK` and the version command prints `3.3.9`. The package name is
`@programmable/launch`; the binary is `programmable-launch`. Omit `profileVersion` for live `3.3.0`; explicit `3.4.0`
output is rejected until backend activation. Do not substitute an unverified npm registry package.

The CLI has exactly four commands:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json --remote
programmable-launch submit launch.json --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

`pack` derives the sorted manifest, source descriptor, ABI encoded arguments, graph, target locators, CREATE2
predictions, evidence digests, canonical hashes and exact source verification bundle from exact source, Standard JSON,
compiler artifacts and evidence files. It accepts no hand written derived hashes. `validate` recomputes those
commitments and, with `--config`, requires byte identical reproduction of `launch.json`.

Current profile `3.3.0` requires `projectMetadata`: owner-supplied token name and symbol, a useful 20–4,096 UTF-8 byte
description with at least eight Unicode letters or numbers, non-empty local PNG/JPEG/WebP/GIF bytes, exactly one public
HTTPS website and exactly one canonical `https://x.com/<handle>` profile. Other link kinds remain optional. The CLI
binds the exact image digest, byte length, media type, dimensions, and source-manifest file; it never invents or uploads
metadata. Discovery advertises `requiredForProfileVersions = ["3.2.0","3.3.0","3.4.0"]`,
`strictMetadataProfileVersions = ["3.3.0","3.4.0"]`, and `legacyMetadataProfileVersions = ["3.2.0"]`, so exact
`3.2.0`, `3.3.0` and pending `3.4.0` all carry metadata while only exact `3.3.0` and pending `3.4.0` use the strict
current policy and only exact `3.2.0` preserves its older nullable-image semantics.

Use a stable content URI and make HTTPS image bytes browser-readable with CORS. Wallet review fetches the raw bytes
and checks the bound SHA-256, length, type and dimensions before rendering; IPFS and Arweave use fixed public gateways.
An unavailable or mismatched remote image remains a digest plus placeholder. The platform does not upload or replace
the image, mutate the launch, or sign automatically.

Partner root keys and subkeys use the same `PROGRAMMABLE_API_KEY` and canonical V3 create, preflight, list and status
flow as wallet keys. The current Router V1 permit-reissue disposition route is wallet-key-only. The server
derives immutable `partnerAttribution`; callers cannot set it, and it is provenance only, not a safety or verification
claim. A wallet key requires `launchWallet` to equal its bound wallet. A partner credential instead selects the exact
controller in the immutable request but never acquires that wallet's authority. The selected controller remains the
signer and broadcaster, and the same complete name, symbol, description, image, website and X metadata policy applies.
For an expired partner launch, recover directly by repacking a new request with a fresh nonce and Idempotency-Key, with
full gates rerun.

### Public partner subkeys

A partner root with `partner-subkeys:manage` may list, issue, rotate, and revoke bounded child credentials at the four
public `/v1/partner/subkeys` operations in the V3 OpenAPI. The root credential is read only from
`PROGRAMMABLE_API_KEY`. Children
may hold `custom-launch:create` and/or `custom-launch:read`, never `partner-subkeys:manage`, and cannot exceed the root's
budgets or expiry. Every subkey-admin operation, including list, consumes the root's
`subkeyAdminRequestsPerHour` budget. Private partner and root administration routes are not public.

Launch reads follow immutable partner lineage. A partner root reads every launch attributed to its partner, including
launches created by current and rotated subkeys. Each subkey sees only its own lineage, including launches for the
different controller wallets it selected, and cannot read root or sibling launches. Rotation atomically revokes the old
credential and gives its replacement the same lineage, so its private launch history remains readable. A separately
issued subkey starts a new isolated lineage. Finalized public metadata remains a separate unauthenticated feed.

```sh
curl --fail-with-body \
  --header "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  https://api.programmable.market/v1/partner/subkeys

curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: $PROGRAMMABLE_IDEMPOTENCY_KEY" \
  --data-binary @partner-subkey.json \
  https://api.programmable.market/v1/partner/subkeys
```

The closed `programmable.partner-subkey-request.v1` body contains `displayName`, one or both child launch scopes,
`prepareRequestsPerHour`, `readRequestsPerMinute`, and a millisecond UTC `expiresAt`. The first committed issue or
rotation returns `201` with `secretState: delivered-once` and the one-time `apiKey`; an exact replay returns `200` with
`secretState: already-delivered` and `apiKey: null`. Keep the exact body and Idempotency-Key for retry. Rotation is
`POST /v1/partner/subkeys/{subkeyId}/rotate`; revocation is `DELETE /v1/partner/subkeys/{subkeyId}`. The replacement
credential retains access to its stable lineage history; export anything needed before permanent revocation. Honor
`Retry-After` on `429`. Every error includes a correlation `requestId`, and a bounded `500` never includes secrets.

When the selected token ABI and exact constructor or initializer values expose one unambiguous name or symbol string,
the declaration must match. Arbitrary tokens are not forced into one constructor shape: non-extractable declarations
are request-and-launch-ID bound and require post-deployment `name()` / `symbol()` readback where supported. The wallet
reviews the same canonical `programmable.project-metadata.v1` and `projectMetadataHash`; neither the client nor the
API can substitute display metadata after packaging.

The release includes `examples/direct-native-v3-no-broadcast/README.md`. It compiles real project-owned token, hook and
initializer targets, then stops after deterministic `pack` and `validate`. It never submits, polls, signs,
broadcasts or creates a Mainnet coin.

## Secret and wallet boundary

Create or revoke a key at <https://programmable.market/developers/api-keys>. Store it only in an encrypted secret or
environment variable named `PROGRAMMABLE_API_KEY`, or in the supported operating system secret store. Put only
`$PROGRAMMABLE_API_KEY` in chat, prompts and agent setup. The CLI has no API key argument, never prints the key and
never stores it in its journal.

Wallet keys are bound to their controller wallet and API scopes. Partner credentials are bound to their own isolated
launch principal; they select an exact controller in each request but cannot sign for it. The API and CLI never sign or broadcast. The API server
exposes a wallet handoff only after its objective static hard blocks and exact Router simulation pass. Missing behavior
execution keeps the related claims unverified; an authenticated executed failure blocks the handoff. Client output
cannot bypass either mandatory server gate. At `authorized`, the API returns the exact prepared wallet
transaction. Stop the agent flow so the connected controller can independently review the chain, sender, Router,
value, selector and calldata before signing.

## Public V3 request

`POST /v3/custom-launches` accepts the exact `programmable.custom-launch-create-request.v3` body. The CLI derives and
validates every required field, including the exact source descriptor and manifest, graph bundle, general profile and
selection, canonical profile and intent hashes, agent attestation and `verificationBundle` exact source material. Use
the normative V3 OpenAPI for every nested field, enum and size bound.

The complete request is limited to 8,388,608 bytes. For the default revision-3 profile, every compilation unit uses
exact `solc 0.8.26+commit.8a97fa7a`. Decoded Standard JSON is limited to 5,242,880 bytes per compilation unit and
across all units in one request, with at most 2,048 inline sources. Compiler version, settings, libraries, constructor
arguments, runtime materialization and every exclusive graph component are bound to the launch intent. Revision-2
requests retain their compatibility contract.

## Idempotent submission

`submit` freshly repacks the config and proves that `launch.json` is byte identical before network access. It then
writes a mode `0600` journal that permanently binds the idempotency key, API origin and exact request bytes. Reusing
the key with different bytes fails locally.

Timeouts, ambiguous transport results, `429` and `503` retry only those persisted bytes. Honor `Retry-After`. Never
rotate the nonce, idempotency key or request bytes to work around an ambiguous result. The API can return `202` for a
new durable request or `200` for an exact replay.

New requests share a durable global admission cap of 120 created requests per hour and 500 per day. An exact
idempotent replay is resolved before admission and consumes no additional capacity.

## Status and wallet handoff

V3 is the CLI default. Read one resource with:

```sh
programmable-launch status REQUEST_UUID --watch --until authorized
```

The list route may make a bounded best-effort reconciliation pass over pending rows, but it returns `output: null`.
The single resource GET is the precise status and full output path. Its additive `lifecycleQueue` reports only bounded
worker scheduling and retry state; queue completion is not launch finality, and queue retry never changes the launch
status.

```text
received -> validating
validating -> pending_review <-> action_required
pending_review -> server evidence gate
server evidence gate -> awaiting_funding_authorization -> funding_authorization_verified (EIP-3009 only)
server evidence gate or funding_authorization_verified -> prepared -> simulating -> authorized -> submitted -> finalized
```

`failed` and `cancelled` are terminal alternatives. `pending_review` has no wallet action. `action_required` means a
current exact hard-blocking finding code matched its target role. Inspect the exact bound report and contact support
with the request ID when directed; it is not a wallet-signing stage. Send only the request ID, status, UTC time and
public error code. Never send the API key. Nonblocking findings remain bound and visible as warnings. With
`--until authorized`, the CLI also stops at
`awaiting_funding_authorization`, but the server exposes that handoff only after the evidence gate required by the
selected lane has passed. Complete the exact typed-data signature in the website, then run status again.
`prepared` has no wallet transaction. During `simulating`, a signed permit may exist only inside a worker-private
simulation envelope; public output remains null in `simulating` and `failed`, so the evidence gate controls permit and
wallet-transaction exposure rather than internal simulation signing. `authorized` contains the exact Router transaction for separate controller
wallet review, signing and broadcast. When present, follow only the HTTPS `walletHandoffUrl` before its `expiresAt`;
refetch status after expiry. The API and CLI never sign or broadcast. After the wallet broadcasts, run:

```sh
programmable-launch status REQUEST_UUID --watch --until finalized
```

## Exact source verification and discovery

Finality is independent from explorer availability. After a bundled request is finalized, the server enqueues
idempotent verification work for each exclusive component. Optional `sourceVerification` is server authored and uses
`queued`, `retrying`, `exact_match` or `needs_attention`. Only literal `exact_match` for every component means Source
verified. A client must never submit or infer this state. Legacy or unbundled requests remain compatible and
unverified.

Finalized Router identities remain eligible for Explore and Profile after discovery refreshes even when optional
market enrichment or an explorer is unavailable. Provenance is not an audit, liquidity guarantee or endorsement.

## Errors and support

Fix nonretryable `400`, `401`, `403`, `404`, `409`, `413`, `415` and `422` responses before sending a new request.
Preserve the exact journal binding for retryable `429`, `503` and ambiguous transport results. A `500` response keeps
the correlation request ID but does not authorize changing request bytes. For support, send only
`error.requestId`, HTTP status, UTC time and the public error code. Never send the API key.

Generic fee claiming and buyback management for arbitrary hooks are not live. FADE uses a specifically bound adapter.
The reserved `fees:claim` and `buybacks:manage` scopes are disabled and promise no future behavior. Public Hookbuilder
and reusable template intake are not part of the Custom Launch API.
