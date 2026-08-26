---
description: Read only contracts and verification rules for detecting Programmable Classic and Custom launches
---

# Developer reference

Programmable has two separate developer surfaces. The Developer API at `https://developers.programmable.family` is read only, requires no API key and never authorizes a transaction. At `https://api.programmable.market`, authenticated public V3 general-hook creation and lifecycle reads are live for wallet-owned requests. V2 and V1 history remain readable and V1 creation remains read only.

## Package locally and read existing launches

Start at [Programmable discovery](https://programmable.market/.well-known/programmable.json), follow
`customLaunchApi.agentIntegration`, and fetch the advertised [agent remediation
catalog](https://programmable.market/policies/custom-launch-agent-remediation-v1.json). Then use the [Custom Launch API
guide](custom-launch.md) and [pack-config schema](https://programmable.market/schemas/custom-launch/v3/pack-config.json).
Install the pinned public `programmable-launch` 3.3.0 CLI to
pack, validate, submit and track V3 requests, and manage a key at [Custom Launch API
keys](https://programmable.market/developers/api-keys). The [public V3
contract](https://programmable.market/openapi/custom-launch-v3.json) is the normative production contract. Its default
direct-native profile is revision 3 with `profileVersion: 3.1.0`; exact `3.0.0` requests remain readable and
byte-identical retryable, and revision 2 remains compatible. The [V2
contract](https://programmable.market/openapi/custom-launch-v2.json) remains available for existing V2 resources. V1
POST remains nonretryable `409 CUSTOM_LAUNCH_V1_READ_ONLY`. Legacy Registry and GitHub submission intake is closed.

The key can create and read launch preparations for its wallet principal. Keep it only as `PROGRAMMABLE_API_KEY` in an encrypted secret store. It cannot authorize, sign or broadcast. A `prepared` response contains an exact artifact but no wallet transaction; only `authorized` contains the exact Router transaction for separate controller-wallet review and signing. In EIP-3009 funding mode, `awaiting_funding_authorization` first exposes exact typed data for an explicit website wallet signature. Native-value mode instead carries the exact ETH value on the Router transaction and requires no separate funding signature. Neither signing action is automatic.

Revision 3 pins exact `solc 0.8.26+commit.8a97fa7a` Standard JSON, with a 5,242,880-byte limit per unit and in
aggregate and no more than 2,048 inline sources. Its role-aware exact-source static admission binds every finding to the
request. Exactly seven objective code-and-role rules hard-block profile 3.1.0; proxy/delegatecall, mint/tax/pause,
liquidity and return-delta surfaces remain evidence duties. A hard-block match returns `action_required`; all other
findings remain visible needs-evidence or warning conditions. No manual project allowlist exists. Router simulation is mandatory before authorization. Admission and simulation are not an audit or a guarantee
of safety, honeypot resistance, liquidity, tradeability or fee behavior.

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
