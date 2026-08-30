# Public indexer feed

Programmable publishes machine-readable metadata for launches recognized by
the production read model.

## Public feeds

- Developer API v2
  [`GET /api/v2/status`](https://developers.programmable.family/api/v2/status)
- Developer API v2 Ethereum launch feed
  [`GET /api/v2/launches?chainId=1`](https://developers.programmable.family/api/v2/launches?chainId=1)
- Developer API v2 Ethereum token list
  [`GET /api/v2/token-list?chainId=1`](https://developers.programmable.family/api/v2/token-list?chainId=1)
- Product Ethereum Explore read model
  [`GET /api/explore?chain=1`](https://programmable.market/api/explore?chain=1)

These read-only endpoints require no API key and are intended for indexers,
wallets and trading applications. They publish launch identity, project
metadata and available market enrichment with explicit source and quality
states. Keep a recognized launch when optional market data is unavailable.

The former `/api/indexers/v1/tokens`, `/api/indexers/v1/token` and
`/api/indexers/v1/token-list` routes are retired. Do not use them for new
integrations.

## Chain availability

Ethereum Mainnet (`chainId: 1`) is the active production indexing lane.

Robinhood Chain Mainnet (`chainId: 4663`) is planned and fail-closed. Until its
production deployment, manifest and indexer binding are published, the
[`GET /api/explore?chain=4663`](https://programmable.market/api/explore?chain=4663)
response remains `not-deployed` with the activation stage
`planned-not-deployed`. Do not interpret that planned empty response as
authoritative evidence that no launches exist, and do not infer Router addresses
or start blocks.

## Launch models

`launch.modelId` is the stable product model, such as `classic` or
`stock-paired`. `launch.modelVersion` identifies the contract release where a
version is required.

Stock-Paired records also disclose the quote-asset address, symbol and its
currency ordering in the v4 pool. Public launches select the launched token as
`currency0`; the quote asset is therefore `currency1`. Fees are denominated in
that quote asset, not ETH.

Third-party platforms control their own ingestion and refresh schedules.
Publishing a record here does not guarantee that another platform will display
it immediately.
