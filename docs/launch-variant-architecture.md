# Launch variant architecture

Launcher should not maintain one contract for every product label. A launch is assembled from five explicit choices:

1. Asset
2. Opening
3. Liquidity
4. Pool behavior
5. Position custody

The catalog in `contracts/spec/launch-variants.v1.json` records the combinations that have a defined product boundary. A variant is public only when its exact composition has an implementation, tests, deployment evidence and a clear review status.

## Current protocol-tested variants

### Auction launch

The official Uniswap LiquidityLauncher creates a fixed-supply UERC20. A Continuous Clearing Auction establishes the opening price. LBPStrategy migrates the auction proceeds and reserved tokens into the bound v4 pool. The initial LP position is permanently locked while its fees remain claimable by the launch creator.

### Direct v4 pool

`DirectLiquidityLauncherV1` predicts the token address, deploys the bound fee hook and locked position recipient, creates the fixed-supply UERC20, initializes the pool and mints one full-range position in a single transaction. The creator supplies ETH and a token budget. Any unused budget and the remaining token supply return to the creator.

The two CREATE2 factories are permissionless. If another account deploys the exact matching hook or position recipient first, the direct launcher verifies and reuses the factory-recorded immutable configuration. It rejects any unrecognized deployment. A visible mempool transaction therefore cannot be blocked merely by predeploying its public configuration.

Both variants use the same `PlatformFeeHookV1`. It has no owner, proxy, pause control or mutable fee. The platform recipient and 0.10% fee are immutable for each hook.

## Status language

`protocol-tested` means the code passes the repository’s local and fork tests. It does not mean audited, deployed or approved for mainnet.

`planned` means the product and security boundary exists but the contracts are incomplete.

`research` means the accounting model, upstream dependencies or security invariants are not settled.

The website must not turn these labels into claims such as safe, certified, unruggable or scam-proof.

## Scaling the catalog

New variants should normally add one reviewed module or one compatible composition. They should not duplicate the token, fee, custody and indexing machinery. This keeps a large catalog possible without creating thousands of unrelated contracts.

Custom hooks stay in a separate unverified lane. Their callback flags, runtime bytecode, source verification, mutable authorities, external calls, return-delta accounting and audit status must be visible before a user can sign anything.

`npm run contracts:variants` validates unique IDs, status semantics, required axes, implementation evidence, invariants, fees and treasury consistency across the catalog and both standards.
