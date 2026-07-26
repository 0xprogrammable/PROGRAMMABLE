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

The official Uniswap LiquidityLauncher creates a fixed-supply UERC20. The standard composition auctions half the supply over four hours and reserves the other half for liquidity. A Continuous Clearing Auction establishes the opening price. LBPStrategy allocates all auction proceeds and the reserved tokens to the bound full-range v4 pool. The initial LP position is permanently locked while its fees remain claimable by the launch creator. Any tokens left after the auction and pool setup are recoverable by that creator. Launcher verifies that the pinned CCA factory has no protocol fee controller before preparing the transaction.

### Direct v4 pool

`DirectLiquidityLauncherV1` predicts the token address, deploys the bound fee hook and locked position recipient, creates the fixed-supply UERC20, initializes the pool and mints one full-range position in a single transaction. The creator supplies ETH and a token budget. Any unused budget and the remaining token supply return to the creator.

The two CREATE2 factories are permissionless. If another account deploys the exact matching hook or position recipient first, the direct launcher verifies and reuses the factory-recorded immutable configuration. It rejects any unrecognized deployment. A visible mempool transaction therefore cannot be blocked merely by predeploying its public configuration.

### Existing token pool

`DirectLiquidityLauncherV1.launchExistingUERC20` accepts only an existing token whose address can be reconstructed through the configured Uniswap UERC20Factory from its immutable name, symbol, decimals, creator and graffiti fields. The caller must be that recorded creator. The method pulls the exact token budget, initializes the bound pool and mints the locked full-range position atomically.

This is not a generic ERC-20 importer. Arbitrary tokens, proxies, new mint authority, transfer taxes and mutable transfer behavior remain in a separate research lane.

### Auction with bounded dynamic fees

This path keeps the same official auction, fixed-supply token and locked full-range position. It replaces the fixed-fee hook with `BoundedDynamicFeeHookV1`. The LP fee begins at 0.30%, adds 0.001% for each tick of observed movement and never exceeds 1.00%. The first swap in a new block updates the fee from movement since the previous reference block. Further swaps in that block use the same installed fee.

The rule uses the pool tick, not an external fair-value oracle. A trader can move that tick and influence a later block’s fee. The fixed 1.00% ceiling bounds that influence but does not make the hook MEV protection.

The fixed-fee variants use `PlatformFeeHookV1`. The dynamic variant uses its separate immutable factory and hook family. Neither family has an owner, proxy or pause control. Both bind the 0.10% Launcher fee to the immutable platform recipient.

## Status language

`protocol-tested` means the code passes the repository’s local and fork tests. It does not mean audited, deployed or approved for mainnet.

`planned` means the product and security boundary exists but the contracts are incomplete.

`research` means the accounting model, upstream dependencies or security invariants are not settled.

The website must not turn these labels into claims such as safe, certified, unruggable or scam-proof.

## Scaling the catalog

New variants should normally add one reviewed module or one compatible composition. They should not duplicate the token, fee, custody and indexing machinery. This keeps a large catalog possible without creating thousands of unrelated contracts.

Custom hooks stay in a separate unverified lane. Their callback flags, runtime bytecode, source verification, mutable authorities, external calls, return-delta accounting and audit status must be visible before a user can sign anything.

`npm run contracts:variants` validates unique IDs, status semantics, required axes, implementation evidence, invariants, fees and treasury consistency across the catalog and all four protocol-tested standards.
