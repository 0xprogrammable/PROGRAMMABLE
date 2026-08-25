---
description: Start a Classic token or prediction market, or prepare one exact Custom project through the API
---

# Create

Choose Classic when the product fits the standard token launch settings. Choose Prediction Markets for an onchain outcome market. Choose Custom when behavior depends on project specific hook code or a wider execution graph. The paths share one public product, but their transaction and release requirements differ.

## Launch Classic

Classic is available from [Create](https://programmable.market/launch). The launch wallet supplies token metadata, selects buy and sell transaction fees, chooses reward recipients and Initial Buy custody, then reviews one Ethereum transaction. The standard model does not require a source bundle or Custom Launch API key.

## Create a Prediction Market

Prediction Markets is available from [Create](https://programmable.market/launch). The creator configures an available market and reviews the transaction required by the active release. Check the [canonical Prediction Markets repository](https://github.com/0xprogrammable/programmable-prediction-markets) for current networks, market types, costs, fees, creator rewards and resolution rules.

## Build a Custom project

Build and test the exact hook project. [Hookbuilder-Skill](https://github.com/0xprogrammable/Hookbuilder-Skill) is an optional starting point. Create the deterministic source manifest, graph bundle and evidence digests with project-specific packaging that follows the [Custom Launch API schema](../developers/custom-launch.md); do not assume the current stable Builder emits that request.

Connect the controller wallet and create a [wallet-bound API key](https://programmable.market/developers/api-keys). The authenticated write endpoint is `https://api.programmable.market/v1/custom-launches`. A `prepared` result contains the exact artifact but no wallet transaction. An `authorized` result contains the transaction for separate controller-wallet review, signing and broadcast. The API key cannot perform those wallet actions.

## Reusable work

Reusable public templates remain a planned product with a separate fee and versioning model because one template can affect many later launches. Public template intake and fee share activation are not open. The Custom Launch API accepts one concrete project and token bundle; it does not publish reusable templates.

{% content-ref url="launch.md" %}
[launch.md](launch.md)
{% endcontent-ref %}

{% content-ref url="templates.md" %}
[templates.md](templates.md)
{% endcontent-ref %}
