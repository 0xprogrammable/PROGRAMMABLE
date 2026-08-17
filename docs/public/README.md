---
description: Official documentation for launching, reviewing and integrating Programmable on Ethereum
cover: .gitbook/assets/programmable-night-garden-v2.png
coverY: 0
---

# Programmable

Programmable is a launch platform for Uniswap v4 products. Classic turns a focused set of choices into a fixed supply token, a permanently locked ETH pool and creator rewards. Custom is the reviewed path for products that need their own hook, application logic or execution graph.

The public interface runs on Ethereum. Classic is available directly from Create. A Custom project moves through public source review and an exact release binding before the named creator wallet receives an executable launch path. In both cases, the wallet reviews and signs its own transaction.

{% hint style="info" %}
These docs describe current public products and the evidence available for them. A successful check, accepted source revision or visible token page is not a guarantee of safety, liquidity or future value.
{% endhint %}

## Choose a path

| I want to                    | Start here                                                                               | What happens next                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Launch a standard token      | [Create Classic](https://programmable.market/launch)                                     | Configure the token, fees, reward recipients and Initial Buy before signing one Ethereum transaction                         |
| Build with a custom hook     | [Programmable v4 Builder](https://github.com/0xprogrammable/hookbuilder/releases/latest) | Prepare one exact public revision, then submit it through [Submit a Launch](https://github.com/0xprogrammable/submit-launch) |
| Verify or integrate launches | [Developer reference](developers/README.md)                                              | Resolve current deployments from the manifest and reproduce provenance from Ethereum                                         |

To inspect an existing token, begin with [Explore](https://programmable.market/explore) and use its contract address rather than only a name or ticker.

{% content-ref url="tokens.md" %}
[tokens.md](tokens.md)
{% endcontent-ref %}

{% content-ref url="creators/launch.md" %}
[launch.md](creators/launch.md)
{% endcontent-ref %}

{% content-ref url="developers/README.md" %}
[README.md](developers/README.md)
{% endcontent-ref %}

## How a launch becomes public

1. The creator configures a supported launch or prepares one exact reviewed Custom release.
2. The creator wallet checks the network, destination, calldata and value, then signs the transaction.
3. Ethereum confirms the transaction and the launch reaches the required finality.
4. Explore and the developer feeds publish the canonical token and pool identity. Optional price, chart and liquidity data remain separate.

## What Programmable proves

Each supported launch has a token, pool identity and launch model. Router based launches can also carry a launch stamp that binds the token, hook, PoolManager and pool to one canonical execution record. Historical launches remain discoverable through the public data service even when they predate the Router.

Programmable keeps source review, launch authority, wallet execution, chain finality and public indexing separate. That separation is deliberate: it makes it possible to say exactly what has been proven without turning one green check into a broader claim.

## Official sources

The website is [programmable.market](https://programmable.market), the public organization is [0xprogrammable](https://github.com/0xprogrammable), and the read only developer service is [developers.programmable.family](https://developers.programmable.family). Contract addresses and integration data should come from the versioned developer manifest rather than copied screenshots or third party token metadata.
