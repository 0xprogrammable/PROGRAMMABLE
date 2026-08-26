# Programmable Custom Launch API

V3 is public and live: general custom-hook launch creation, list and single-resource reads are available at
`https://api.programmable.market` for wallet-bound API keys. V2 and V1 history remain available for existing requests, while authenticated
`POST /v1/custom-launches` remains permanently read only with `409 CUSTOM_LAUNCH_V1_READ_ONLY`. Legacy Registry and
GitHub submission intake is closed.

Normative public V3 OpenAPI: <https://programmable.market/openapi/custom-launch-v3.json>

V2 compatibility OpenAPI: <https://programmable.market/openapi/custom-launch-v2.json>

V1 compatibility OpenAPI: <https://programmable.market/openapi/custom-launch-v1.json>

Human guide: <https://programmable.market/docs/developers/custom-launch>

Readiness: <https://api.programmable.market/readyz>

## Existing-project integration

The API key is authorization, not an instruction bundle. Start every cold-agent run at
<https://programmable.market/.well-known/programmable.json>. Read `customLaunchApi.agentIntegration`, then fetch the
advertised machine-readable remediation catalog:
<https://programmable.market/policies/custom-launch-agent-remediation-v1.json>. The catalog, this guide, V3 OpenAPI and
the pinned CLI release are the complete public integration path. There is no project allowlist or private approval
step.

Fetch public `GET https://api.programmable.market/v3/capabilities`, then use the exact quickstart
`pack -> validate --remote -> submit -> wallet -> status`. `validate --remote` first repeats local byte-identical
validation and then posts those same bytes to Bearer-authenticated `POST /v3/custom-launches/preflight`. The preflight
uses scope `custom-launch:create`, consumes no launch quota, allocates no nonce, persists no launch, requires a later
wallet signature and never broadcasts. `wallet` is a separate connected-controller action, not a CLI command.

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
The mandatory exact Router simulation is the final execution-compatibility detector for the prepared transaction; a
successful simulation is not a safety, admission, liquidity, fee-behavior or economic-solvency claim.

Pool initialization does not add liquidity, volume cannot create initial liquidity from nothing, and V3 does not
inject Classic liquidity. Bind the implementation's actual `external-concentrated-liquidity`,
`launch-seeded-concentrated-liquidity` or `hook-inventory-custom-accounting` model. After submission,
`action_required` means fix the exact bound target/source finding, rebuild, repack and submit a new immutable request.
Retrying unchanged bytes or asking for a manual allowlist cannot bypass it.

## V3 general hook boundary

The `programmable.direct-native-hook-graph.v1` document is the V3 production request, resource and wallet-handoff
contract. The default profile uses `schemaVersion: programmable.direct-native-hook-graph-profile.v3`,
`profileRevision: 3` and `profileVersion: 3.1.0`; its selection binding uses
`programmable.direct-native-hook-graph-profile-selection-binding.v3`. Exact `3.0.0` requests remain readable and
byte-identical retryable under their original immutable policy; revision 2 also remains a compatible profile contract
for existing clients and resources. The Router primitive supports 2-16 targets; the direct
native profile requires 3-16 because token, hook and initializer roles are distinct. It accepts a project-owned token,
a project-owned hook, native or ERC-20 quote currency, all fourteen Uniswap v4 permission bits across masks `0` through
`16383`, and an exact multi-contract graph. It does not substitute a Programmable-owned hook. Every enabled v4
permission must resolve to a concrete reachable callback implementation;
an interface declaration or fallback-only route does not qualify.

Every V3 request must bind and disclose a 1,000-hundredths-of-a-bip Programmable share, declared as an additive
platform share or included inside the selected total. The request binds the selected buy and sell economics. Revision 3 does not issue a
fee-conformance certification. It runs role-aware exact-source static admission, binds the resulting report and
warnings, and requires a final Router simulation before the permit authority can sign. Source, compiler settings,
constructor arguments, final calldata and simulation are bound per launch.
The pool may use a static fee or the Uniswap v4 dynamic-fee sentinel. Funding may be absent, carried as the exact
native value of the separately reviewed Router transaction, or use an unsigned USDC EIP-3009 descriptor. Any later
funding signature and the Router transaction remain separate explicit wallet actions and are never produced or sent
by the API key.

## Platform fee policy

The general V3 production profile is available on Ethereum Mainnet only (`chainId: "1"`) and has
`productionLaunchAuthorized: true`.

Every V3 request must bind and disclose a Programmable share of 1,000 parts per 1,000,000 of the request-bound declared
assessment basis: `1,000 ppm = 0.10% = 10 bps`. The accounting mode is either `additive-platform-share` or
`inclusive-selected-total`; the server recomputes buy and sell project share, effective total, fee currency and
rounding. The exact claim binding is controlled by
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. This request-bound policy does not certify or enforce the behavior of
arbitrary custom code. Revision-3 admission and the required Router simulation carry `feeBehaviorClaim: false`;
inspect the exact project implementation.

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

Profile `3.1.0` checks exact source/build bindings, hook permissions and address bits, then applies a role-aware static
baseline. Exactly seven objective code-and-role rules hard-block deployment: runtime `CALLCODE`, runtime or source
`SELFDESTRUCT`, a definitively missing or invalid callback authentication guard, a literal noncanonical PoolManager,
or a missing enabled callback implementation. Proxy or delegatecall use, mint/tax/pause/transfer controls, liquidity
custody or locking, external dependencies and return-delta custom accounting remain bound evidence duties rather than
categorical deployment blocks. A hard-block match returns `action_required`; other findings populate
`needsEvidenceFindingCodes` or warnings. There is no manual project allowlist. A final Router simulation is mandatory
before authorization.

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
`staticBaseline` and `remediations`. A `not_executed` behavior vector remains outstanding; it is neither a failure nor
a caller-declared pass. None is an audit, universal compatibility statement or safety guarantee.

## Install the public CLI

Install only the immutable GitHub Release asset:

```sh
programmable_cli_dir="$(mktemp -d)"
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.1.tgz" \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.1/programmable-launch-3.3.1.tgz
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.1.tgz.sha256" \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.1/programmable-launch-3.3.1.tgz.sha256
(cd "$programmable_cli_dir" && shasum -a 256 -c programmable-launch-3.3.1.tgz.sha256)
npm install --global "$programmable_cli_dir/programmable-launch-3.3.1.tgz"
programmable-launch --version
```

Continue only after the checksum command reports `OK` and the version command prints `3.3.1`. The package name is
`@programmable/launch`; the binary is `programmable-launch`. Do not substitute an unverified npm registry package.

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

The release includes `examples/direct-native-v3-no-broadcast/README.md`. It compiles real project-owned token, hook and
initializer targets, then stops after deterministic `pack` and `validate`. It never submits, polls, signs,
broadcasts or creates a Mainnet coin.

## Secret and wallet boundary

Create or revoke a key at <https://programmable.market/developers/api-keys>. Store it only in an encrypted secret or
environment variable named `PROGRAMMABLE_API_KEY`, or in the supported operating system secret store. Put only
`$PROGRAMMABLE_API_KEY` in chat, prompts and agent setup. The CLI has no API key argument, never prints the key and
never stores it in its journal.

The API key is bound to its controller wallet and API scopes. The API and CLI never sign or broadcast.
At `authorized`, the API returns the exact prepared wallet transaction. Stop the agent flow so the connected controller
can independently review the chain, sender, Router, value, selector and calldata before signing.

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
validating -> awaiting_funding_authorization -> funding_authorization_verified (EIP-3009 only)
validating or funding_authorization_verified -> pending_review <-> action_required
pending_review -> prepared -> simulating -> authorized -> submitted -> finalized
```

`failed` and `cancelled` are terminal alternatives. `pending_review` has no wallet action. `action_required` means a
current exact hard-blocking finding code matched its target role. Inspect the exact bound report and contact support
with the request ID when directed; it is not a wallet-signing stage. Send only the request ID, status, UTC time and
public error code. Never send the API key. Nonblocking findings remain bound and visible as warnings. With
`--until authorized`, the CLI also stops at
`awaiting_funding_authorization`; complete the exact typed-data signature in the website, then run status again.
`prepared` has no wallet transaction. `authorized` contains the exact Router transaction for separate controller
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
