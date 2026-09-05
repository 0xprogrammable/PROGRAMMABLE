---
description: Developer read endpoints, chain manifests, schemas, ABIs and Custom Launch API contracts
---

# API reference

The Developer API at `https://developers.programmable.family` is read only and requires no API key.
The Custom Launch API is hosted separately at `https://api.programmable.market` and uses scoped credentials.

## Developer read API

Start from [discovery](https://developers.programmable.family/.well-known/programmable.json) and select the chain.
The `/api/v2/manifest` compatibility alias refers to Ethereum.

| Resource | Endpoint |
| --- | --- |
| Chain manifest | `/api/v2/manifests/{chainId}` |
| Chain status | `/api/v2/status?chainId={chainId}` |
| Launch feed | `/api/v2/launches?chainId={chainId}` |
| Token list | `/api/v2/token-list?chainId={chainId}` |

- [HTTP reference](https://github.com/programmablehq/Developers/blob/main/docs/reference/http-api.md)
- [OpenAPI](https://developers.programmable.family/openapi/programmable-v2.yaml)
- [JSON Schemas](https://github.com/programmablehq/Developers/tree/main/schemas/v2)
- [ABIs](https://github.com/programmablehq/Developers/tree/main/abis)
- [Deployment evidence](https://github.com/programmablehq/Developers/tree/main/deployments)

## Custom Launch API

Use the [Custom Launch API guide](custom-launch.md) for API keys, partner credentials, preflight, requests and wallet
handoff. Select the API version and verified CLI release from [live launch discovery](https://programmable.market/.well-known/programmable.json).
For Robinhood, require `publicWrites`, `publicAuthorization` and `releaseReady` in the chain-specific discovery entries
before authenticated preflight or submission. A published schema does not establish activation. The API and CLI never
sign or broadcast.

| Contract | Scope |
| --- | --- |
| [V3 OpenAPI](https://programmable.market/openapi/custom-launch-v3.json) | Ethereum Custom launches |
| [V4 OpenAPI](https://programmable.market/openapi/custom-launch-v4.json) | Robinhood Custom launches |
| [V4 pack-config schema](https://programmable.market/schemas/custom-launch/v4/pack-config.json) | Local request packaging |
| [V4 source-verification schema](https://programmable.market/schemas/custom-launch/v4/source-verification-status.json) | Independent source-verification results |
| [V1 OpenAPI](https://programmable.market/openapi/custom-launch-v1.json), [V2 OpenAPI](https://programmable.market/openapi/custom-launch-v2.json) | Historical reads and schemas; fresh writes closed |

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

The interactive reference uses the pinned OpenAPI mirror maintained from the
[Developers repository](https://github.com/programmablehq/Developers/blob/main/openapi/programmable-v2.yaml).
