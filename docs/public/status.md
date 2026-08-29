---
description: Check current Programmable website, launch feed and developer service status
---

# Service status

The current public status is available from the website and the read only developer service. These endpoints separate service availability from data freshness so an HTTP 200 response is not mistaken for a current index.

| Resource            | URL                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Product             | [programmable.market](https://programmable.market)                                                       |
| Explore             | [programmable.market/explore](https://programmable.market/explore)                                       |
| Developer status    | [developers.programmable.family/api/v2/status](https://developers.programmable.family/api/v2/status)     |
| Deployment manifest | [developers.programmable.family/api/v2/manifest](https://developers.programmable.family/api/v2/manifest) |
| Launch feed         | [developers.programmable.family/api/v2/launches](https://developers.programmable.family/api/v2/launches) |
| Product discovery   | [programmable.market/.well-known/programmable.json](https://programmable.market/.well-known/programmable.json) |

The status response reports the Ethereum head, finalized block, scan coverage, feed freshness and current Classic and Custom discovery counts. Consumers should inspect those fields rather than relying only on the top level service label.

Robinhood Chain Mainnet V4 is `planned` and `planned-not-deployed` in product discovery. Its public write and authorization
flags remain false. A stable route or schema pointer is not deployment evidence, and external indexing may lag or be
unavailable. Treat it as live only after discovery changes following separate deployment, simulation, wallet-binding,
Router-finality, source-verification and indexing gates.

When price or liquidity data is unavailable or stale, the token and launch record can still be valid. Price, token valuation, liquidity and chart support should remain unavailable rather than being filled with guessed values.
