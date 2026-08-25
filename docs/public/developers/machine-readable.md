---
description: Read-only Developer API reference and authenticated Custom Launch API resources
---

# API reference

The Developer API version 2 at `https://developers.programmable.family` is read only, requires no API key and publishes stable discovery, manifest, launch and compatibility responses. The separate Custom Launch API at `https://api.programmable.market` is an authenticated write path. Start with the [Custom Launch API guide](custom-launch.md), then use the [standalone OpenAPI contract](https://programmable.market/openapi/custom-launch-v1.json) for the normative request and response schema. The existing [raw V1 guide](https://programmable.market/developers/custom-launch-api-v1.md) remains compatible for agents and scripts.

The public-read OpenAPI below describes the Developer API. It does not define Custom launch writes. The standalone Custom Launch API contract defines those authenticated operations.

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
