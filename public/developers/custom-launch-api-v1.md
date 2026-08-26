# Programmable Custom Launch API

V2 is public and live: launch creation, list and single resource reads are available at `https://api.programmable.market` for
wallet bound API keys. V1 history reads remain available for existing requests, while authenticated
`POST /v1/custom-launches` remains permanently read only with `409 CUSTOM_LAUNCH_V1_READ_ONLY`. Legacy Registry and
GitHub submission intake is closed.

Normative public V2 OpenAPI: <https://programmable.market/openapi/custom-launch-v2.json>

Integration-pending V3 profile preview: <https://programmable.market/openapi/custom-launch-v3.json>

V1 compatibility OpenAPI: <https://programmable.market/openapi/custom-launch-v1.json>

Human guide: <https://programmable.market/docs/developers/custom-launch>

Readiness: <https://api.programmable.market/readyz>

## V3 preview boundary

The `programmable.direct-native-hook-graph.v1` document freezes V3 request, resource and two-action wallet
handoff schemas but does not activate them. Discovery remains `integration-pending`; Public V2 stays the stable
production creation contract. The Router primitive supports 2-16 targets; this profile requires 3-16 because token,
hook and initializer roles are distinct. Revision 2 accepts a project-owned token, a project-owned hook, every valid
Uniswap v4 permission mask and an exact multi-contract graph. It does not substitute a Programmable-owned hook.

Its mandatory 1,000-hundredths-of-a-bip Programmable share may be declared as an additive platform share or included
inside the selected total. The server recomputes both buy and sell economics. Before the permit authority can sign, a
platform-issued conformance receipt must bind the final graph commitment, exact runtime set, fee semantics and claim
destination. Source, compiler settings, constructor arguments, final calldata and simulation are bound per launch.
The pool may use a static fee or the Uniswap v4 dynamic-fee sentinel. Funding may be absent or use an unsigned USDC
EIP-3009 descriptor; the later funding signature and Router transaction remain separate explicit wallet actions and
are never produced or sent by the API key.

## Rev3 fee policy

The frozen Rev3 production profile is available on Ethereum Mainnet only (`chainId: "1"`) and has
`productionLaunchAuthorized: true`.

For each successful swap, the mandatory platform charge is 1,000 parts per 1,000,000 of the documented
`gross-unspecified-pool-currency-amount` basis: `1,000 ppm = 0.10% = 10 bps`. It accrues in the profile's unspecified
pool currency to `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The frozen profile enforces this path independently
of custom behavior; a Custom module cannot reduce or redirect it. A reverted swap rolls back the fee with the rest of
the transaction.

The pool's LP fee is separate from this platform charge and must be disclosed separately. Generic fee claiming and
buyback management for arbitrary hooks are not live. The reserved `fees:claim` and `buybacks:manage` scopes remain
disabled.

## Install the public CLI

Install only the immutable GitHub Release asset:

```sh
npm install --global \
  https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v2.0.1/programmable-launch-2.0.1.tgz
programmable-launch --version
```

The package name is `@programmable/launch`; the binary is `programmable-launch`. Do not substitute an unverified
npm registry package.

The CLI has exactly four commands:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json
programmable-launch submit launch.json --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

`pack` derives the sorted manifest, source descriptor, ABI encoded arguments, graph, target locators, CREATE2
predictions, evidence digests, canonical hashes and exact source verification bundle from exact source, Standard JSON,
compiler artifacts and evidence files. It accepts no hand written derived hashes. `validate` recomputes those
commitments and, with `--config`, requires byte identical reproduction of `launch.json`.

The release includes `examples/fee-enforced-v2-no-broadcast/README.md`. It compiles a real custom module and the exact
distributed profile sources, then stops after deterministic `pack` and `validate`. It never submits, polls, signs,
broadcasts or creates a Mainnet coin.

## Secret and wallet boundary

Create or revoke a key at <https://programmable.market/developers/api-keys>. Store it only in an encrypted secret or
environment variable named `PROGRAMMABLE_API_KEY`, or in the supported operating system secret store. Put only
`$PROGRAMMABLE_API_KEY` in chat, prompts and agent setup. The CLI has no API key argument, never prints the key and
never stores it in its journal.

The API key is bound to its controller wallet and API scopes. The API and CLI never sign or broadcast.
At `authorized`, the API returns the exact prepared wallet transaction. Stop the agent flow so the connected controller
can independently review the chain, sender, Router, value, selector and calldata before signing.

## Public V2 request

`POST /v2/custom-launches` accepts the closed `programmable.custom-launch-create-request.v2` body. The CLI derives and
validates every required field, including the exact source descriptor and manifest, graph bundle, closed Rev3 launch
profile and selection, canonical profile and intent hashes, agent attestation and `verificationBundle` exact source material.
Use the normative V2 OpenAPI for every nested field, enum and size bound.

The complete request is limited to 8,388,608 bytes. Decoded Standard JSON is limited to 5,242,880 bytes per
compilation unit and across all units in one request. Sources use exact inline UTF 8 content. Compiler version,
settings, libraries, constructor arguments, runtime materialization and every exclusive graph component are bound to
the launch intent.

## Idempotent submission

`submit` freshly repacks the config and proves that `launch.json` is byte identical before network access. It then
writes a mode `0600` journal that permanently binds the idempotency key, API origin and exact request bytes. Reusing
the key with different bytes fails locally.

Timeouts, ambiguous transport results, `429` and `503` retry only those persisted bytes. Honor `Retry-After`. Never
rotate the nonce, idempotency key or request bytes to work around an ambiguous result. The API can return `202` for a
new durable request or `200` for an exact replay.

New V2 requests share a durable global admission cap of 120 created requests per hour and 500 per day. An exact
idempotent replay is resolved before admission and consumes no additional capacity.

## Status and wallet handoff

V2 is the CLI default. Read one resource with:

```sh
programmable-launch status REQUEST_UUID --watch --until authorized
```

The list route may make a bounded best-effort reconciliation pass over pending rows, but it returns `output: null`.
The single resource GET is the precise status and full output path.

```text
received -> validating -> simulating -> prepared -> authorized -> submitted -> finalized
```

`failed` and `cancelled` are terminal alternatives. `prepared` has no wallet transaction. `authorized` contains the
exact transaction for separate controller wallet review, signing and broadcast. The API and CLI never sign or
broadcast. After the wallet broadcasts, run:

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

Fix nonretryable `400`, `403`, `409`, `413`, `415` and `422` responses before sending a new request. Preserve the
exact journal binding for retryable `429`, `503` and ambiguous transport results. For support, send only
`error.requestId`, HTTP status, UTC time and the public error code. Never send the API key.

Generic fee claiming and buyback management for arbitrary hooks are not live. FADE uses a specifically bound adapter.
The reserved `fees:claim` and `buybacks:manage` scopes are disabled and promise no future behavior. Public Hookbuilder
and reusable template intake are not part of the Custom Launch API.
