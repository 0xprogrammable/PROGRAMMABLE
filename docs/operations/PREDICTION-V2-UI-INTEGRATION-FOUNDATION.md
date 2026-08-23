# Protocol V2 UI integration foundation

Status: local foundation only. It is not connected to the production prediction-market routes and must not be described as live.

## Exact protocol closure

The isolated `lib/prediction-v2` lane binds only the current Protocol V2 surface:

- `GenericPredictionMarketFactoryV2`: 10-field `markets`, `assetRegistry`, `manager`, `activeMarketId`, pool-key reads, and `createMarketWithPermit(identity, observationTime, threshold, expectedMarketId, permit...)`.
- `AssetRegistryV2`: canonical identity, 17-field `OraclePolicy`, full current and historical `Snapshot` reads, `hashSnapshot`, and current-active-revision bindings.
- `PredictionQuoterV2`: 9-field `BuyQuote` and 8-field `SellQuote`, each containing the 6-field live v4 swap result.
- `ExecutionRouterV2`: exact buy and sell request tuples and EIP-2612 permit signatures.
- `GlobalExposureControllerV2`: `requireIncreaseCapacity(address,uint256)` as a reverting view preflight with no return value.
- `PredictionVaultV2`: exact dependency, identity, accounting and lifecycle reads plus `finalize`, atomic `finalizeAndRedeem`, unavailable/unproven fallbacks, terminal consumption, and `redeem`. Chainlink lifecycle helpers send zero native value and every prepared payload is pinned to chain 4663.
- `IPriceCheckpointV2`: adapter-neutral status, result, deadline, fallback, policy and resolution reads/actions. Adapter-specific proof discovery remains server-side.
- `PoolManager`: raw `extsload(bytes32)` only. The UI derives `poolId = keccak256(abi.encode(PoolKey))` and the v4 `pools[poolId]` state slot, then decodes the packed current sqrt price, tick, directional protocol fee, and LP fee.

No V1 module, production route, Gates code, Indexer code, or Dune code is changed by this foundation.

The committed release binding is deliberately `disabled` and contains no address or environment indirection. Its
schema cannot be turned live by adding fields; activation requires a separately reviewed, fully pinned production
binding. This prevents a dormant UI foundation from being mistaken for a deployed release.

## Fail-closed transaction rules

- A buy permit must equal `requestedCollateralAtoms + floor(requestedCollateralAtoms * 10 / 10_000)`. It cannot authorize collateral alone.
- A sell permit must equal the exact outcome-token input.
- Buy minimum receive is floored from quoted outcome atoms. Sell minimum proceeds is floored from net collateral after the 10 bps protocol fee, never from gross collateral.
- Every quote is decoded from and retains the raw successful Quoter `eth_call`: exact target, exact encoded calldata, exact result bytes, vault, five-field pool key, side, requested amount, sqrt-price limit, chain 4663, confirmed block number, and block hash. The same quote also retains raw `vault.checkpoint()`, `checkpoint.isTradingHealthy()`, `vault.yesToken()`, `vault.noToken()`, and PoolManager `extsload(poolStateSlot)` calls and results from that exact block. Preparation reconstructs and decodes every call instead of trusting caller-labelled token roles, health, price, fee, or tuple metadata, and refuses to prepare a trade while checkpoint health is false. Cross-market, swapped-role, cross-side, changed-limit, changed-amount, malformed-result, changed-slot, and stale-block reuse fail closed.
- BUY preparation also requires successful `vault.exposureController()` and `controller.requireIncreaseCapacity(vault, requestedCollateralAtoms)` calls at the quote's exact block number and hash. Capacity uses the full requested split notional, not executed collateral, because the Router splits before applying the price-limit refund.
- Capacity is never promised. The read is point-in-state and execution rechecks atomically; another transaction can consume capacity first. Refresh quote and capacity together immediately before signing and present a normal revert as a race, not as lost funds.
- Every prepared transaction carries `chainId: 4663`; the wallet integration must refuse submission after any chain change and must never silently reinterpret the payload on another network.
- Creation binds `selectionKey`, canonical identity, derived onchain asset key, full Registry snapshot, locally reproduced `hashSnapshot`, live Registry `hashSnapshot` result, Factory `activeMarketId` market id/snapshot hash/revision, and the released snapshot hash. The exact nonzero `expectedMarketId` is encoded after `threshold`, so a Registry revision between preview/signing and mining reverts before creator permit funding instead of silently creating under changed oracle semantics.
- Pool fee and tick spacing are fixed to the Protocol V2 candidate invariants: 200 pips and 10.

## Pre-sign preview model

The V2 preview model exposes maximum and actual fee-inclusive payment, protocol fee, refunds, quoted and minimum shares, average executable price, current-to-post probability, signed percentage-point impact, relative impact, live LP and directional PoolManager fee, gross winning payout, signed net profit, conservative maximum loss, and neutral payout. Sell previews expose gross proceeds, fee, net proceeds, net minimum, and both token-refund classes. Side, pool orientation, token roles, current price, and directional fee are derived from the raw same-block evidence bound into the quote. BUY cannot lower the selected outcome probability; SELL cannot raise it. A reversed sqrt-price or selected-probability direction fails closed, while a zero-execution partial quote may leave it unchanged.

Liquidity remains conservative. This foundation has no caller-controlled depth label: every preview reports thin depth and the 2 USDG backstop warning until a separately reviewed live-depth evidence binder exists. An extra `verified-live-depth` property cannot upgrade that result. `priceImpactRiskState` is normal through 199 bps, warns from 200 through 499 bps, and requires explicit confirmation from 500 bps. That final threshold is an executable buy/sell preparation gate, not display copy: calldata preparation throws unless the caller supplies the confirmation state. The backstop warning remains the highest-priority message, while `partialFill` and the price-impact state remain independently readable. Complement-token refunds suppress a misleading cash-only sell average. Signed minimum profit remains signed when it is negative.

## Remaining release blockers

1. Add a signed deployment/release manifest for exact V2 Factory, Registry, Quoter, Router, Vault implementations, runtime code hashes, deployment blocks, and the release snapshot hashes.
2. Implement the RPC orchestration that executes the provided exact call encodings at one confirmed block for Factory market record, Registry active revision and snapshot hash, pool key, Vault token roles, raw PoolManager slot0, Quoter result, Vault exposure-controller getter, capacity preflight, and block hash. Revalidate the fully bound quote and capacity immediately before wallet submission; neither read removes the execution race.
3. Add the first V2 read model using bounded Factory pagination and same-block RPC reads. An Indexer projection may be added later for scale; this lane intentionally does not touch the protected Indexer or Gates work.
4. Connect the isolated preview and prepared transactions to a V2-only UI route. Do not reuse or reinterpret V1 tuple results.
5. Add wallet E2E on the released contracts: create with permit, quote/buy, partial-fill refund, sell with net minimum, deadline/slippage rejection, finalization proof, redemption, reorg/stale-quote rejection, and mobile/desktop browser checks.
6. Add an exact executable-depth read. Until then the UI must retain the backstop-only warning and cannot upgrade the depth label from thin.
7. Add the Chainlink-round discovery service and confirm its same-phase adjacent-round proof against the market's exact checkpoint policy before offering finalization. A feed phase rollover after the observation time invalidates the old-phase proof and resolves through the neutral fallback; never infer proof rules from a display symbol.
8. Review provider availability and terms for the server-only BTC/ETH/SOL/BNB preset reader. The implemented keyless CoinGecko endpoint is bounded, short-cached, best-effort and display-only; the existing DexScreener route covers custom contract/mint display data. Neither source decides settlement or Registry eligibility.
9. Add production configuration, browser evidence, and onchain receipts before any live claim. A green unit test or build is not release evidence.
