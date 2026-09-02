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

Robinhood Chain Mainnet V4 has a deployed Router and backend routes. This release snapshot is
`pending-public-discovery-promotion`; its public write, authorization and release-ready flags remain false. Deployed
runtime and stable route or schema pointers are not public-activation evidence, and external indexing may lag or be
unavailable. Submit only after live discovery reports all three create gates true. Router provenance, finality,
source verification and indexing remain independent.

The public finalized V4 contract admits only canonical V3-finalized rows whose aggregate and every component carry
the separate protected source/build/compiler/finalized-creation/bytecode `exact_match` authority. No such per-launch
composite is yet proven and persisted for public promotion in this source snapshot, so no existing public item is
claimed. A Sourcify match is a non-authoritative provider observation, and optional Robinhood Blockscout is not an
activation or finality blocker. Separately, refreshed release hashes must close the current
`V4_RELEASE_BINDING_NOT_READY` clean-room binding before release.

CLI `3.3.9` remains the installable live Ethereum V3 release. Package `4.0.0` is an unpublished and non-installable
Robinhood V4 source candidate, and this snapshot remains `publicWrites: false`, `publicAuthorization: false` and
`releaseReady: false`. The V4 lifecycle is `received`, `validating`, `action_required`, `authorized`,
`awaiting_wallet_signature`, `wallet_action_required`, `submitted`, `sequencer_soft_confirmed`, `ethereum_posted`,
`finalized` or `failed`; `action_required` is remediation, not a wallet action. Guard status reads with
`programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until finalized`. The CLI never
signs or broadcasts. V4 source verification starts after finality and does not revise it. Finality, source
verification, Programmable indexing, third-party indexing, trading readiness and publication must be checked
separately.

When price or liquidity data is unavailable or stale, the token and launch record can still be valid. Price, token valuation, liquidity and chart support should remain unavailable rather than being filled with guessed values.
