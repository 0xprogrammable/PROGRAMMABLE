---
description: Read only contracts and verification rules for detecting Programmable Classic and Custom launches
---

# Developer reference

The Programmable Developer API gives terminals, explorers, scanners, bots and applications one read only integration for current Classic records and approved Custom records. No API key or SDK is required, and the service never authorizes a transaction.

## Start with discovery

The well known document and manifest are the stable entry points. The manifest is the deployment authority for Router addresses, runtime hashes, ABI hashes, event descriptors, getters, start block and finality policy.

```bash
curl -fsSL https://developers.programmable.family/.well-known/programmable.json
curl -fsSL https://developers.programmable.family/api/v2/status
curl -fsSL https://developers.programmable.family/api/v2/manifest
```

Do not copy a Router address or event topic from token metadata, an old screenshot or a third party API. Resolve it from the current manifest and verify the returned deployment record before decoding events.

## Read normalized launches

The launch feed combines current and historical Classic records with approved Custom Registry records. Consumers should finish cursor traversal, deduplicate by launch id and preserve unknown launch shapes even when their own application cannot chart, quote or execute them.

```bash
curl -fsSL https://developers.programmable.family/api/v2/launches
curl -fsSL https://developers.programmable.family/api/v2/token-list
```

The hosted API is optional for Router verification. An integration can reproduce provenance directly from Ethereum using the manifest, ABI and canonical Router getters.

Protocol fee claim discovery is a separate execution index. The claim console
uses complete Classic Launcher and Custom Registry scans plus the fixed Stock
release set; see [Index Programmable launches](indexing.md#index-protocol-fee-claims-separately)
for the exact completeness and fail-closed rules.

{% content-ref url="verify.md" %}
[verify.md](verify.md)
{% endcontent-ref %}

{% content-ref url="machine-readable.md" %}
[machine-readable.md](machine-readable.md)
{% endcontent-ref %}
