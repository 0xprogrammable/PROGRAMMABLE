---
description: Start a Classic token or package one exact Custom project locally
---

# Create

Choose Classic when the product fits the standard token launch settings. Choose Custom when behavior depends on project specific hook code or a wider execution graph. The paths share one public product, but their transaction and release requirements differ.

## Launch Classic

Classic is available from [Create](https://programmable.market/launch). The launch wallet supplies token metadata, selects buy and sell transaction fees, chooses reward recipients and Initial Buy custody, then reviews one Ethereum transaction. The standard model does not require a source bundle or Custom Launch API key.

## Build a Custom project

Build and test the exact hook project. Use the versioned public `programmable-launch` CLI to derive the deterministic source manifest, graph bundle, address locators, evidence digests and exact-source verification metadata described by the [Custom Launch API schema](../developers/custom-launch.md).

Run `pack`, `validate`, `submit` and `status` for the byte identical current V3.3 request with a wallet key, partner root or bounded partner subkey; [wallet keys are managed here](https://programmable.market/developers/api-keys). Keep the credential in an encrypted environment or secret store, never in chat or prompts. Local CLI checks and preflight prepare the request; the API server is the decision authority and exposes a wallet handoff only after objective static hard blocks and exact Router simulation pass. Missing behavior execution leaves related claims unverified; an authenticated executed failure blocks. At `authorized`, the controller reviews and signs the exact Router transaction separately.

## Reusable work

Reusable public templates remain a planned product with a separate fee and versioning model because one template can affect many later launches. Public template intake and fee share activation are not open. The retained Custom Launch API schema models one concrete project and token bundle; it does not publish reusable templates.

{% content-ref url="launch.md" %}
[launch.md](launch.md)
{% endcontent-ref %}

{% content-ref url="templates.md" %}
[templates.md](templates.md)
{% endcontent-ref %}
