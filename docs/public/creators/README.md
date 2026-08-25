---
description: Start a Classic token or prediction market, or package one exact Custom project locally
---

# Create

Choose Classic when the product fits the standard token launch settings. Choose Prediction Markets for an onchain outcome market. Choose Custom when behavior depends on project specific hook code or a wider execution graph. The paths share one public product, but their transaction and release requirements differ.

## Launch Classic

Classic is available from [Create](https://programmable.market/launch). The launch wallet supplies token metadata, selects buy and sell transaction fees, chooses reward recipients and Initial Buy custody, then reviews one Ethereum transaction. The standard model does not require a source bundle or Custom Launch API key.

## Create a Prediction Market

Prediction Markets is available from [Create](https://programmable.market/launch). The creator configures an available market and reviews the transaction required by the active release. Check the [canonical Prediction Markets repository](https://github.com/0xprogrammable/Prediction-Markets) for current networks, market types, costs, fees, creator rewards and resolution rules.

## Build a Custom project

Build and test the exact hook project. Use the versioned public `programmable-launch` CLI to derive the deterministic source manifest, graph bundle, address locators, evidence digests and exact-source verification metadata described by the [Custom Launch API schema](../developers/custom-launch.md).

Pack and validate locally. Public Custom creation is currently held: authenticated V1 POST returns non-retryable `409 CUSTOM_LAUNCH_V1_READ_ONLY`, while V2 returns `503 CUSTOM_LAUNCH_V2_UNAVAILABLE` with `Retry-After` until canary and explicit public activation. A [wallet-bound API key](https://programmable.market/developers/api-keys) can still read its existing V1 history and must remain in an encrypted environment or secret store, never in chat or prompts.

## Reusable work

Reusable public templates remain a planned product with a separate fee and versioning model because one template can affect many later launches. Public template intake and fee share activation are not open. The retained Custom Launch API schema models one concrete project and token bundle; it does not publish reusable templates.

{% content-ref url="launch.md" %}
[launch.md](launch.md)
{% endcontent-ref %}

{% content-ref url="templates.md" %}
[templates.md](templates.md)
{% endcontent-ref %}
