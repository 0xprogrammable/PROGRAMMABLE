# Protocol V2 UI integration foundation

Status: local foundation only. It is not connected to the production prediction-market routes and must not be described as live.

## Exact protocol closure

The isolated `lib/prediction-v2` lane binds only the current Protocol V2 surface:

- `GenericPredictionMarketFactoryV2`: 10-field `markets`, `assetRegistry`, `activeMarketId`, pool-key reads, and the exact identity + observation + threshold `createMarketWithPermit` signature.
- `AssetRegistryV2`: canonical identity, 17-field `OraclePolicy`, full `Snapshot`, `hashSnapshot`, and current-active-revision bindings.
- `PredictionQuoterV2`: 9-field `BuyQuote` and 8-field `SellQuote`, each containing the 6-field live v4 swap result.
- `ExecutionRouterV2`: exact buy and sell request tuples and EIP-2612 permit signatures.
- `GlobalExposureControllerV2`: `requireIncreaseCapacity(address,uint256)` as a reverting view preflight with no return value.
- `PredictionVaultV2`: `exposureController()` and `finalize(bytes)`. The Chainlink helper encodes exactly two adjacent nonzero `uint80` round IDs and sends zero native value.

No V1 module, production route, Gates code, Indexer code, or Dune code is changed by this foundation.

## Fail-closed transaction rules

- A buy permit must equal `requestedCollateralAtoms + floor(requestedCollateralAtoms * 10 / 10_000)`. It cannot authorize collateral alone.
- A sell permit must equal the exact outcome-token input.
- Buy minimum receive is floored from quoted outcome atoms. Sell minimum proceeds is floored from net collateral after the 10 bps protocol fee, never from gross collateral.
- Every quote is bound to chain 4663, exact Quoter, vault, five-field pool key, side, requested amount, sqrt-price limit, confirmed block number, and block hash. Preparation rejects cross-market, cross-side, changed-limit, changed-amount, and stale-block reuse.
- BUY preparation also requires successful `vault.exposureController()` and `controller.requireIncreaseCapacity(vault, requestedCollateralAtoms)` calls at the quote's exact block number and hash. Capacity uses the full requested split notional, not executed collateral, because the Router splits before applying the price-limit refund.
- Capacity is never promised. The read is point-in-state and execution rechecks atomically; another transaction can consume capacity first. Refresh quote and capacity together immediately before signing and present a normal revert as a race, not as lost funds.
- Creation binds `selectionKey`, canonical identity, derived onchain asset key, full Registry snapshot, locally reproduced `hashSnapshot`, live Registry `hashSnapshot` result, Factory `activeMarketId` snapshot hash, and the released snapshot hash. All four hashes must agree.
- Pool fee and tick spacing are fixed to the deployed V2 invariants: 200 pips and 10.

## Pre-sign preview model

The V2 preview model exposes maximum and actual fee-inclusive payment, protocol fee, refunds, quoted and minimum shares, average executable price, current-to-post probability, signed percentage-point impact, relative impact, live LP and directional PoolManager fee, gross winning payout, signed net profit, conservative maximum loss, and neutral payout. Sell previews expose gross proceeds, fee, net proceeds, net minimum, and both token-refund classes.

Liquidity remains conservative. Without a separately verified live-depth read, callers must use `factory-backstop-only`; the preview then always reports thin depth and the 2 USDG backstop warning, including for a small quote below the impact thresholds. That warning remains the highest-priority message. With verified depth, price impact warns from two percentage points. From five percentage points, `riskState` is `explicit-confirmation-required`; the trade must not remain a normal one-click action. Complement-token refunds suppress a misleading cash-only sell average. Signed minimum profit remains signed when it is negative.

## Remaining release blockers

1. Add a signed deployment/release manifest for exact V2 Factory, Registry, Quoter, Router, Vault implementations, runtime code hashes, deployment blocks, and the release snapshot hashes.
2. Implement a same-confirmed-block read orchestrator for Factory market record, Registry active revision and snapshot hash, pool key, current slot0, Quoter result, Vault exposure-controller getter, capacity preflight, and block hash. Revalidate quote and capacity immediately before wallet submission; neither read removes the execution race.
3. Add the V2 read model and Indexer projection for 10-field market identity, Registry revision/hash, lifecycle, outcomes, balances, and transactions. This lane intentionally does not touch Indexer or Gates.
4. Connect the isolated preview and prepared transactions to a V2-only UI route. Do not reuse or reinterpret V1 tuple results.
5. Add wallet E2E on the released contracts: create with permit, quote/buy, partial-fill refund, sell with net minimum, deadline/slippage rejection, finalization proof, redemption, reorg/stale-quote rejection, and mobile/desktop browser checks.
6. Add an exact executable-depth read. Until then the UI must retain the backstop-only warning and cannot upgrade the depth label from thin.
7. Add the adjacent Chainlink-round discovery service and confirm its proof against the market's exact checkpoint policy before offering finalization.
8. Add a server-only bounded/cached CoinGecko public `simple/price` reader for fixed BTC/ETH/SOL/BNB IDs if preset discovery is required. The existing discovery route covers custom contract/mint selections only. This data is informational and must never decide settlement or release eligibility.
9. Add production configuration, browser evidence, and onchain receipts before any live claim. A green unit test or build is not release evidence.
