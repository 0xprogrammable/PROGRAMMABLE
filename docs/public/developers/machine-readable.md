---
description: Read-only Developer API reference and wallet-owned V1 Custom launch resources
---

# API reference

The Developer API version 2 at `https://developers.programmable.family` is read only, requires no API key and publishes stable discovery, manifest, launch and compatibility responses. At `https://api.programmable.market`, wallet-bound V1 list and single-resource reads remain live for existing requests. V1 POST is read-only and V2 remains held until canary and explicit public activation. Start with the [Custom Launch API guide](custom-launch.md), then use the [standalone V1 OpenAPI contract](https://programmable.market/openapi/custom-launch-v1.json) for the normative V1 read and write-fence contract. The separate [held V2 release-candidate contract](https://programmable.market/openapi/custom-launch-v2.json) describes future/private-canary request and lifecycle shapes without activating public submission. The existing [raw V1 guide](https://programmable.market/developers/custom-launch-api-v1.md) remains compatible for agents and scripts.

The public-read OpenAPI below describes the Developer API. The standalone V1 Custom Launch API contract defines its authenticated reads and explicit `409 CUSTOM_LAUNCH_V1_READ_ONLY` write fence. The separate V2 release-candidate contract is machine-readable but held and does not grant public access.

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
