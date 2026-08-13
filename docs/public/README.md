---
description: Official documentation for creating, reviewing and verifying Programmable launches on Ethereum
cover: .gitbook/assets/programmable-night-garden.webp
coverY: 0
---

# Programmable

Programmable is a launch platform for tokens whose trading rules are part of the product. Classic gives a creator a fixed supply token, a permanently locked Uniswap v4 position and separately configured buy and sell transaction fees. Custom releases use individually reviewed hooks when the standard model is not enough.

The public interface runs on Ethereum. A creator can launch Classic directly from the website, while a Custom project moves through public source review and an exact release binding before its creator wallet receives an executable launch path. The wallet still reviews and signs the final transaction. Programmable does not sign it on the creator's behalf.

{% hint style="info" %}
These docs describe current public products and the evidence available for them. A successful check, accepted source revision or visible token page is not a guarantee of safety, liquidity or future value.
{% endhint %}

## Start with the product

Creators who want the standard public path can open [Create](https://programmable.market/launch) and choose Classic. Builders who need a project specific hook can start with the [Programmable v4 Builder](https://github.com/0xprogrammable/hookbuilder/releases/latest), then submit one exact public revision through [Submit a Launch](https://github.com/0xprogrammable/submit-launch).

Readers who are checking an existing token should begin with [Explore](https://programmable.market/explore), use the contract address rather than a name or ticker, and continue to the verification pages when provenance matters.

{% content-ref url="tokens.md" %}
[tokens.md](tokens.md)
{% endcontent-ref %}

{% content-ref url="creators/launch.md" %}
[launch.md](creators/launch.md)
{% endcontent-ref %}

{% content-ref url="developers/README.md" %}
[README.md](developers/README.md)
{% endcontent-ref %}

## What Programmable records

Each supported launch has a token, pool identity and launch model. New Router based launches can also carry a launch stamp that binds the token, hook, PoolManager and pool to one canonical execution record. Historical launches remain discoverable through the public data service even when they predate the Router.

Programmable keeps source review, launch authority, wallet execution, chain finality and public indexing separate. That separation is deliberate: it makes it possible to say exactly what has been proven without turning one green check into a broader claim.

## Official sources

The website is [programmable.market](https://programmable.market), the public organization is [0xprogrammable](https://github.com/0xprogrammable), and the read only developer service is [developers.programmable.family](https://developers.programmable.family). Contract addresses and integration data should come from the versioned developer manifest rather than copied screenshots or third party token metadata.
