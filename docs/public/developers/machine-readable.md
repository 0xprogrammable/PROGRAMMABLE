---
description: Developer API reference and public wallet-owned V2 Custom launch resources
---

# API reference

The Developer API version 2 at `https://developers.programmable.family` is read only, requires no API key and publishes stable discovery, manifest, launch and compatibility responses. At `https://api.programmable.market`, wallet-bound V2 creation and lifecycle reads are public on Ethereum Mainnet. V1 history remains readable while V1 POST remains read only. Start with the [Custom Launch API guide](custom-launch.md), then use the [public V2 OpenAPI contract](https://programmable.market/openapi/custom-launch-v2.json) for the normative request, lifecycle and wallet handoff contract. The [V1 OpenAPI contract](https://programmable.market/openapi/custom-launch-v1.json) remains available for compatibility. The [raw agent guide](https://programmable.market/developers/custom-launch-api-v1.md) is executable by agents and scripts.

The public-read OpenAPI below describes the Developer API. The standalone V2 Custom Launch API contract defines authenticated public creation, reads and separate wallet handoff. The V1 contract retains its authenticated reads and explicit `409 CUSTOM_LAUNCH_V1_READ_ONLY` write fence.

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
