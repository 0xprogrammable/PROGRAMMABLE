# Public indexer feed

Programmable publishes machine-readable metadata for every launch accepted by
the production read model.

## Endpoints

- `GET /api/indexers/v1/tokens`
- `GET /api/indexers/v1/tokens/{contractAddress}`
- `GET /api/indexers/v1/token-list`

These endpoints are intended for indexers, wallets and trading applications.
They include token identity, project metadata, the canonical Uniswap v4 pool,
the hook, fee disclosure and launch provenance.

## Launch models

`launch.modelId` is the stable product model, such as `classic`, `deep` or
`stock-paired`. `launch.modelVersion` identifies the contract release where a
version is required.

Stock-Paired records also disclose the quote-asset address, symbol and its
currency ordering in the v4 pool. Fees are denominated in that quote asset,
not ETH.

Third-party platforms control their own ingestion and refresh schedules.
Publishing a record here does not guarantee that another platform will display
it immediately.
