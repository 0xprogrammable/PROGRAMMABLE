---
description: Official documentation for launching, verifying and integrating Programmable products
cover: .gitbook/assets/programmable-night-garden-v2.png
coverY: 0
---

# Programmable

Programmable is a launch platform for Uniswap v4 products. Classic turns a focused set of choices into a fixed supply token, a permanently locked ETH pool and creator rewards. Custom is the API-first path for products that need their own hook, application logic or execution graph. Prediction Markets is the separately versioned launch model for onchain outcome markets.

Classic and Prediction Markets are available from Create. For Custom, the controller wallet creates a scoped API key and a workflow submits one deterministic bundle. The API first prepares an artifact without a wallet transaction; after authorization, it returns the exact transaction for separate wallet review. In every case, the wallet signs its own transaction on the required network.

{% hint style="info" %}
These docs describe current public products and the evidence available for them. A successful check, prepared artifact, authorized transaction or visible token page is not a guarantee of safety, liquidity or future value.
{% endhint %}

## Choose a path

| I want to                    | Start here                                                                               | What happens next                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Launch a standard token      | [Create Classic](https://programmable.market/launch)                                     | Configure the token, fees, reward recipients and Initial Buy before signing one Ethereum transaction                         |
| Create a prediction market   | [Create Prediction Market](https://programmable.market/launch)                           | Choose an available market and review the current release requirements before signing                                        |
| Build with a custom hook     | [Custom Launch API guide](developers/custom-launch.md)                                  | Build and package the exact project, create a wallet-bound key, submit the request, then review the wallet transaction only after it is authorized |
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

1. The creator configures a supported launch or prepares one exact Custom API bundle.
2. The creator wallet checks the network, destination, calldata and value, then signs the transaction.
3. The required network confirms the transaction and the launch reaches the required finality.
4. The appropriate website surface publishes the canonical token, pool or prediction market identity. The developer feeds currently cover the Ethereum launch records. Optional price, chart and liquidity data remain separate.

## What Programmable proves

Each supported launch has one or more tokens, a pool identity and a launch model. Router based Ethereum launches can also carry a launch stamp that binds the token, hook, PoolManager and pool to one canonical execution record. Historical Ethereum launches remain discoverable through the public data service even when they predate the Router. Prediction Markets has its own versioned identity and release records.

Programmable keeps caller-declared source evidence, API preparation, wallet execution, chain finality and public indexing separate. That separation is deliberate: it makes it possible to say exactly what has been proven without turning one green check into a broader claim.

## Official sources

The website is [programmable.market](https://programmable.market), the authenticated Custom write API is [api.programmable.market](https://api.programmable.market), and the read only Ethereum developer service is [developers.programmable.family](https://developers.programmable.family). The public organization is [0xprogrammable](https://github.com/0xprogrammable). Prediction Markets source and current release details live in the [public Prediction Markets repository](https://github.com/0xprogrammable/programmable-prediction-markets). Contract addresses and integration data should come from canonical release evidence rather than copied screenshots or third party token metadata.
