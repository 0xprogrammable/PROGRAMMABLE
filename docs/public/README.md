---
description: Official documentation for launching, verifying and integrating Programmable products
cover: .gitbook/assets/programmable-warm-night-v3.gif
coverY: 0
---

# Programmable

Programmable is a launch platform for Uniswap v4 products. Classic turns a focused set of choices into a fixed supply token, a permanently locked ETH pool and creator rewards. Custom is the deterministic bundle model for products that need their own hook, application logic or execution graph.

Classic is available from Create. Public V3.3 general-hook creation and credential-principal lifecycle reads accept wallet keys, partner roots and bounded partner subkeys on Ethereum Mainnet. V2 and V1 history and schemas remain readable, while fresh authenticated POSTs return nonretryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY`. Only V3.3 accepts new submissions. Legacy Registry and GitHub submission intake is closed. In every active wallet flow, the controller wallet reviews and signs its own transaction on the required network.

Robinhood Chain V4 Router and backend are deployed and ready and target a public self-serve launch path. This source
snapshot remains `pending-public-discovery-promotion`; deployed runtime is not activated discovery. Require live
`publicWrites: true`, `publicAuthorization: true` and `releaseReady: true` discovery before creating. The required policy and default configuration for new Robinhood V4 API Custom launches is
`20 bps` (`0.20%`, `2,000 ppm`) to `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. Existing launches and Ethereum
are unchanged. This is not canonical onchain fee enforcement, charged-fee or revenue evidence, and fee-path absence is
not itself a write blocker. External indexing, finality, source verification, market support and fee behavior remain
separate.

{% hint style="info" %}
These docs describe current public products and the evidence available for them. A successful check, prepared artifact, authorized transaction or visible token page is not a guarantee of safety, liquidity or future value.
{% endhint %}

## Choose a path

| I want to                    | Start here                                                                               | What happens next                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Launch a standard token      | [Create Classic](https://programmable.market/launch)                                     | Configure the token, fees, reward recipients and Initial Buy before signing one Ethereum transaction                         |
| Build with a custom hook     | [Custom Launch API guide](developers/custom-launch.md)                                  | Build, package, validate, submit and track the exact V3 request; stop for separate wallet review and signing                    |
| Integrate a Robinhood terminal | [Robinhood terminal contract](https://programmable.market/docs/developers/robinhood-terminal-indexer) | Bind to `eip155:4663`, index finalized Router stamps and preserve explicit fee, market and security states                     |
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

1. The creator configures a supported launch or prepares and submits one exact Custom API bundle. CLI and preflight results are preparation, not the server's launch decision.
2. For a released Custom lane, the API server enforces objective static hard blocks and exact Router simulation before it exposes a wallet handoff. For new Robinhood V4 API Custom launch requests, the required policy and disclosure is 20 bps to the published recipient, but the current request and Router path do not prove per-launch binding, application or enforcement; missing canonical onchain fee enforcement is not itself a write blocker. Missing behavior evidence keeps related product claims unverified; an authenticated executed hard-invariant failure blocks. The creator wallet then checks the network, destination, calldata, value and disclosed policy before signing the transaction.
3. The required network confirms the transaction and the launch reaches the required finality.
4. The appropriate website surface publishes the canonical token and pool identity. The developer feeds currently cover the Ethereum launch records. Optional price, chart and liquidity data remain separate.

## What Programmable proves

Each supported launch has one or more tokens, a pool identity and a launch model. Router based Ethereum launches can also carry a launch stamp that binds the token, hook, PoolManager and pool to one canonical execution record. Historical Ethereum launches remain discoverable through the public data service even when they predate the Router.

Programmable keeps agent evidence, exact-source provider status, API preparation, wallet execution, chain finality and public indexing separate. That separation is deliberate: it makes it possible to say exactly what has been proven without turning one green check into a broader claim.

## Official sources

The website is [programmable.market](https://programmable.market), the authenticated Custom write API is [api.programmable.market](https://api.programmable.market), and the read only Ethereum developer service is [developers.programmable.family](https://developers.programmable.family). The public organization is [programmablehq](https://github.com/programmablehq). Contract addresses and integration data should come from canonical release evidence rather than copied screenshots or third party token metadata.
