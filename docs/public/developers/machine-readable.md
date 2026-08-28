---
description: Developer API reference and public V3 Custom launch resources
---

# API reference

The Developer API version 2 at `https://developers.programmable.family` is read only, requires no API key and publishes stable discovery, manifest, launch and compatibility responses. At `https://api.programmable.market`, V3.3 general-hook creation and lifecycle reads accept wallet keys, partner roots and bounded partner subkeys on Ethereum Mainnet. Public `GET /v3/capabilities` advertises the additive structural boundary; Bearer-authenticated `POST /v3/custom-launches/preflight` evaluates the exact create bytes without consuming launch-creation quota, allocating a nonce or persisting a launch. The authenticated preflight still consumes its ordinary route rate budget, including a partner credential's `prepareRequestsPerHour` budget. V2 and V1 history and schemas remain readable, while fresh POSTs return nonretryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY`; only V3.3 accepts new submissions. Start at [`/.well-known/programmable.json`](https://programmable.market/.well-known/programmable.json), read `customLaunchApi.partnerCredentials`, follow `customLaunchApi.agentIntegration`, and fetch the [versioned agent remediation catalog](https://programmable.market/policies/custom-launch-agent-remediation-v1.json) before inspecting an existing project. Validate `programmable-launch.config.json` against the advertised [pack-config schema](https://programmable.market/schemas/custom-launch/v3/pack-config.json). Then use the [Custom Launch API guide](custom-launch.md) and [public V3 OpenAPI contract](https://programmable.market/openapi/custom-launch-v3.json) for the normative production request, lifecycle, partner-lineage history and wallet handoff contract. A partner root aggregates all partner-attributed launches; each subkey sees only its stable lineage, rotation preserves that lineage history, and the Router V1 permit-reissue disposition route is wallet-key-only. CLI and preflight checks are preparation; the API server independently enforces objective static hard blocks and exact Router simulation. Missing behavior execution leaves behavior-derived claims unverified, while an authenticated executed failure blocks wallet handoff. No API key can sign, broadcast or bypass launch gates. The [V2 OpenAPI contract](https://programmable.market/openapi/custom-launch-v2.json) and [V1 OpenAPI contract](https://programmable.market/openapi/custom-launch-v1.json) preserve historical reads and schemas plus their write fences. The [raw agent guide](https://programmable.market/developers/custom-launch-api-v1.md) is executable by agents and scripts.

The public-read OpenAPI below describes the Developer API. The standalone V3 Custom Launch API contract defines capabilities, side-effect-free preflight, authenticated public creation, reads and separate wallet handoff for project-owned tokens, hooks and exact multi-contract graphs. It keeps deployment, trading, platform-fee evidence, source verification, indexing and featured state independent and makes no universal or safety claim. A 10 bps claim applies only to a fee-certified profile or adapter and its exact stamped PoolKey; arbitrary custom hooks are not automatically fee-enforced. The V2 and V1 contracts preserve historical reads and schemas with explicit `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY` fresh-write fences.

## Service status

{% openapi src="../.gitbook/assets/programmable-v2.yaml" path="/api/v2/status" method="get" %}
[programmable-v2.yaml](../.gitbook/assets/programmable-v2.yaml)
{% endopenapi %}

## Deployment manifest

{% openapi src="../.gitbook/assets/programmable-v2.yaml" path="/api/v2/manifest" method="get" %}
[programmable-v2.yaml](../.gitbook/assets/programmable-v2.yaml)
{% endopenapi %}

## Launches

{% openapi src="../.gitbook/assets/programmable-v2.yaml" path="/api/v2/launches" method="get" %}
[programmable-v2.yaml](../.gitbook/assets/programmable-v2.yaml)
{% endopenapi %}

## Token list

{% openapi src="../.gitbook/assets/programmable-v2.yaml" path="/api/v2/token-list" method="get" %}
[programmable-v2.yaml](../.gitbook/assets/programmable-v2.yaml)
{% endopenapi %}

The canonical OpenAPI source is maintained in the [developers repository](https://github.com/0xprogrammable/developers/blob/main/openapi/programmable-v2.yaml). This copy is included so GitBook can render the interactive reference together with the official product documentation.
