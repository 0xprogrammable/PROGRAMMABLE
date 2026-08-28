---
description: Read only contracts and verification rules for detecting Programmable Classic and Custom launches
---

# Developer reference

Programmable has two separate developer surfaces. The Developer API at `https://developers.programmable.family` is read only, requires no API key and never authorizes a transaction. At `https://api.programmable.market`, authenticated public V3.3 general-hook creation and lifecycle reads accept wallet keys, partner roots and bounded partner subkeys. V2 and V1 history and schemas remain readable, while fresh POSTs return non-retryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY`; only V3.3 accepts new submissions. CLI and preflight checks prepare and classify exact bytes, while the API server independently enforces objective static hard blocks and exact Router simulation. Missing behavior execution leaves routability, liquidity and fee claims unverified; an authenticated executed failure blocks wallet handoff.

## Package locally and read existing launches

Start at [Programmable discovery](https://programmable.market/.well-known/programmable.json), read
`customLaunchApi.partnerCredentials`, follow `customLaunchApi.agentIntegration`, and fetch the advertised [agent remediation
catalog](https://programmable.market/policies/custom-launch-agent-remediation-v1.json). Then use the [Custom Launch API
guide](custom-launch.md) and [pack-config schema](https://programmable.market/schemas/custom-launch/v3/pack-config.json).
Install the pinned public `programmable-launch` 3.3.7 CLI to
pack, validate, submit and track V3 requests, and manage a key at [Custom Launch API
keys](https://programmable.market/developers/api-keys). The [public V3
contract](https://programmable.market/openapi/custom-launch-v3.json) is the normative production contract. Its default
direct-native profile is revision 3 with `profileVersion: 3.3.0`; it binds canonical project name, symbol, meaningful
description, an exact non-empty source-bound image, one website, one X profile and optional additional links into the
launch hashes. Exact `3.2.0`, `3.1.0` and `3.0.0` requests remain readable and
byte-identical retryable under their original immutable policies, and revision 2 remains compatible. Profile `3.2.0`
keeps its original nullable-image metadata semantics. The [V2
contract](https://programmable.market/openapi/custom-launch-v2.json) remains available for existing V2 resources and
schemas, with fresh POST returning nonretryable `409 CUSTOM_LAUNCH_V2_READ_ONLY`. V1 fresh POST returns nonretryable
`409 CUSTOM_LAUNCH_V1_READ_ONLY`. Legacy Registry and GitHub submission intake is closed.
V2 detail reads are observation-only for `prepared` or `simulating` resources: GET cannot advance simulation or
authorization or expose a new wallet transaction. Existing authorized and submitted reconciliation and finalized reads remain.

Keep the selected credential only as `PROGRAMMABLE_API_KEY` in an encrypted secret store. Wallet keys, partner roots and bounded partner subkeys use the same canonical V3 create, preflight, list and status routes within their scopes; the Router V1 permit-reissue disposition route is wallet-key-only. A wallet key's `launchWallet` is its wallet binding. A partner credential may select the exact controller wallet, but that controller still reviews, signs and broadcasts and the partner credential receives no wallet authority. All credential kinds use the same current-profile metadata policy. A partner root alone may manage one level of subkeys, whose scopes, budgets and expiry cannot exceed the root. The root reads all launches attributed to its partner; a subkey reads only its stable lineage, and rotation preserves that lineage history. No credential can sign, broadcast or bypass launch gates. A `prepared` response contains an exact artifact but no wallet transaction; only `authorized` contains the exact Router transaction for separate controller-wallet review and signing. In EIP-3009 funding mode, `awaiting_funding_authorization` first exposes exact typed data for an explicit website wallet signature. Native-value mode instead carries the exact ETH value on the Router transaction and requires no separate funding signature. Neither signing action is automatic.

Revision 3 pins exact `solc 0.8.26+commit.8a97fa7a` Standard JSON, with a 5,242,880-byte limit per unit and in
aggregate and no more than 2,048 inline sources. Its role-aware exact-source static admission binds every finding to the
request. Exactly seven objective code-and-role rules hard-block profile 3.3.0; proxy/delegatecall, mint/tax/pause,
liquidity and return-delta surfaces remain evidence duties. A hard-block match returns `action_required`; all other
findings remain visible needs-evidence or warning conditions. No manual project allowlist exists. The API server must
enforce objective static hard blocks and exact Router simulation before wallet handoff. Local checks and preflight are
preparation, not the server decision. The exact Router simulation is not an audit or a guarantee of safety, honeypot
resistance, liquidity, tradeability or fee behavior. A 10 bps claim exists only for a fee-certified profile or adapter
and its exact stamped PoolKey; arbitrary custom hooks are not automatically fee-enforced.

## Start with discovery

The well known document and manifest are the stable entry points. The manifest is the deployment authority for Router addresses, runtime hashes, ABI hashes, event descriptors, getters, start block and finality policy.

```bash
curl -fsSL https://developers.programmable.family/.well-known/programmable.json
curl -fsSL https://developers.programmable.family/api/v2/status
curl -fsSL https://developers.programmable.family/api/v2/manifest
```

Do not copy a Router address or event topic from token metadata, an old screenshot or a third party API. Resolve it from the current manifest and verify the returned deployment record before decoding events.

## Read normalized launches

The launch feed combines current and historical Classic records with Registry-verified Custom records. Consumers should finish cursor traversal, deduplicate by launch id and preserve unknown launch shapes even when their own application cannot chart, quote or execute them.

```bash
curl -fsSL https://developers.programmable.family/api/v2/launches
curl -fsSL https://developers.programmable.family/api/v2/token-list
```

The hosted API is optional for Router verification. An integration can reproduce provenance directly from Ethereum using the manifest, ABI and canonical Router getters.

Protocol fee claim discovery is a separate execution index. The claim console
uses complete Classic Launcher and Custom Registry scans plus the fixed Stock
release set; see [Index Programmable launches](indexing.md#index-protocol-fee-claims-separately)
for the exact completeness and fail-closed rules.

{% content-ref url="custom-launch.md" %}
[custom-launch.md](custom-launch.md)
{% endcontent-ref %}

{% content-ref url="verify.md" %}
[verify.md](verify.md)
{% endcontent-ref %}

{% content-ref url="machine-readable.md" %}
[machine-readable.md](machine-readable.md)
{% endcontent-ref %}
