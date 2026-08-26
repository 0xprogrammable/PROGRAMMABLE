---
description: Developer API reference and public wallet-owned V3 Custom launch resources
---

# API reference

The Developer API version 2 at `https://developers.programmable.family` is read only, requires no API key and publishes stable discovery, manifest, launch and compatibility responses. At `https://api.programmable.market`, wallet-bound V3 general-hook creation and lifecycle reads are public on Ethereum Mainnet. V2 and V1 history remain readable while V1 POST remains read only. Start at [`/.well-known/programmable.json`](https://programmable.market/.well-known/programmable.json), follow `customLaunchApi.agentIntegration`, and fetch the [versioned agent remediation catalog](https://programmable.market/policies/custom-launch-agent-remediation-v1.json) before inspecting an existing project. Validate `programmable-launch.config.json` against the advertised [pack-config schema](https://programmable.market/schemas/custom-launch/v3/pack-config.json). Then use the [Custom Launch API guide](custom-launch.md) and [public V3 OpenAPI contract](https://programmable.market/openapi/custom-launch-v3.json) for the normative production request, lifecycle and wallet handoff contract. The [V2 OpenAPI contract](https://programmable.market/openapi/custom-launch-v2.json) and [V1 OpenAPI contract](https://programmable.market/openapi/custom-launch-v1.json) remain available for compatibility. The [raw agent guide](https://programmable.market/developers/custom-launch-api-v1.md) is executable by agents and scripts.

The public-read OpenAPI below describes the Developer API. The standalone V3 Custom Launch API contract defines authenticated public creation, reads and separate wallet handoff for project-owned tokens, hooks and exact multi-contract graphs. The V2 contract remains a compatibility surface. The V1 contract retains its authenticated reads and explicit `409 CUSTOM_LAUNCH_V1_READ_ONLY` write fence.

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
