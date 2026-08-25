---
description: How Programmable separates launch preparation, execution, finality and public discovery
---

# How Programmable works

Programmable records each part of a launch separately. The product interface prepares the launch, the creator wallet signs its transaction, the required network finalizes it, and the public product adds the resulting token, pool or prediction market to the appropriate discovery surface.

## Classic execution

Classic uses the current launcher and shared hook on Ethereum. One transaction creates the fixed supply token, initializes its Uniswap v4 ETH pool, locks the one sided position and completes the Initial Buy. The configuration selected before signing determines fees, rewards and custody.

## Custom execution

Custom begins with one deterministic source and graph bundle submitted through the authenticated API. The platform validates the declared manifest digest, graph constraints, attestation shape, evidence digests and permit binding. A `prepared` result contains the exact artifact but no wallet transaction. An `authorized` result contains the permit-attached transaction for separate controller-wallet signing and broadcast. The platform does not compile the source, reproduce the build or audit the project, and the resulting launch must agree with the authorized transaction and final chain record.

## Prediction Markets execution

Prediction Markets uses a separately versioned Uniswap v4 protocol release. Its [canonical repository](https://github.com/0xprogrammable/programmable-prediction-markets) defines the current network, market components, transaction paths, resolution rules and deployment evidence. The public Ethereum developer feed covers Ethereum Router records; use the canonical repository for Prediction Markets integrations.

## Launch stamps

The Launch Stamp Router provides a canonical provenance record for future Router based Classic and Custom launches. Its Ethereum deployment is live, and the developer manifest publishes the address, code hash, ABI hash, start block and finality rules required for independent verification.

## Public discovery

The website combines verified launch records with price and liquidity data when those values are available. The read only Ethereum developer service publishes consistent Classic and Custom records for terminals, scanners, explorers and applications. Prediction Markets uses its own versioned release records. Integrators should treat origin, indexing freshness, chart availability and transaction support as separate capabilities.

{% content-ref url="launch-stamps.md" %}
[launch-stamps.md](launch-stamps.md)
{% endcontent-ref %}

{% content-ref url="developers/README.md" %}
[README.md](developers/README.md)
{% endcontent-ref %}
