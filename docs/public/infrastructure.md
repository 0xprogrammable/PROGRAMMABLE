---
description: How Programmable separates launch creation, review, execution, finality and public discovery
---

# How Programmable works

Programmable records each part of a launch separately. The product interface prepares the launch, the creator wallet signs its transaction, Ethereum finalizes it, and the public data service adds the resulting token and pool to Explore and the developer feeds.

## Classic execution

Classic uses the current launcher and shared hook on Ethereum. One transaction creates the fixed supply token, initializes its Uniswap v4 ETH pool, locks the one sided position and completes the Initial Buy. The configuration selected before signing determines fees, rewards and custody.

## Custom execution

Custom begins with an exact public source revision and review application. An accepted release identifies the code, wallet, permissions and transaction plan that may use the route. The creator wallet still submits the transaction, and the resulting launch must agree with the release and final chain record.

## Launch stamps

The Launch Stamp Router provides a canonical provenance record for future Router based Classic and Custom launches. Its Ethereum deployment is live, and the developer manifest publishes the address, code hash, ABI hash, start block and finality rules required for independent verification.

## Public discovery

The website combines verified launch records with price and liquidity data when those values are available. The read only developer service publishes consistent Classic and Custom records for terminals, scanners, explorers and applications. Integrators should treat origin, indexing freshness, chart availability and transaction support as separate capabilities.

{% content-ref url="launch-stamps.md" %}
[launch-stamps.md](launch-stamps.md)
{% endcontent-ref %}

{% content-ref url="developers/README.md" %}
[README.md](developers/README.md)
{% endcontent-ref %}
