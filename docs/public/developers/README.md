---
description: Read only contracts and verification rules for detecting Programmable Classic and Custom launches
---

# Developer reference

Programmable has two separate developer surfaces. The Developer API at `https://developers.programmable.family` is read only, requires no API key and never authorizes a transaction. At `https://api.programmable.market`, authenticated V1 list and single-resource reads remain live for existing wallet-owned requests. V1 launch creation is read-only and V2 remains held until canary and explicit public activation.

## Package locally and read existing launches

Start with the [Custom Launch API guide](custom-launch.md). Install the pinned public `programmable-launch` CLI to pack and validate locally, and manage a key at [Custom Launch API keys](https://programmable.market/developers/api-keys) to read existing V1 resources. Do not submit to V1: authenticated POST returns non-retryable `409 CUSTOM_LAUNCH_V1_READ_ONLY`. The [fee-enforced V2 release-candidate contract](https://programmable.market/openapi/custom-launch-v2.json) is published for offline/private-canary integration, but public V2 requests return `503 CUSTOM_LAUNCH_V2_UNAVAILABLE` with `Retry-After` until activation. Legacy Registry and GitHub submission intake is closed.

The key can create and read launch preparations for its wallet principal. Keep it only as `PROGRAMMABLE_API_KEY` in an encrypted secret store. It cannot authorize, sign or broadcast. A `prepared` response contains an exact artifact but no wallet transaction. Only `authorized` contains the exact transaction for the controller wallet to review, sign and broadcast separately.

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
