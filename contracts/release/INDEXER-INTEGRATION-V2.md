# Programmable Classic V2 integration

Programmable Classic launches a fixed-supply UERC20 into a canonical native ETH/Token Uniswap v4 pool. The token has no
transfer tax. The pool hook charges the same disclosed custom-accounting fee on buys and sells.

## Fee interpretation

- Total hook fee: 1–10%, selected in whole percentage points at launch
- Programmable share: 0.10 percentage points, included in the selected total
- Creator share: selected total minus 0.10 percentage points
- ERC-20 transfer tax: 0%
- Canonical pool LP fee: 0 pips
- Fee currency: native ETH for buys and sells

Do not add the Programmable share to the selected total. A 1% launch is 0.90% to the creator and 0.10% to Programmable,
not 1.10%.

## Contract signals

Index the V2 hook's `PoolFeeDisclosure` event and `feeDisclosure(poolId)` getter for static configuration. For executed
swaps, reconcile PoolManager's core `Swap` event with:

```solidity
HookFee(bytes32,address,uint128,uint128)
HookSwap(bytes32,address,int128,int128,uint24)
NativeSwapFeesAccrued(bytes32,address,uint256,uint256,uint256)
```

`HookSwap` follows the current URC-2 custom-accounting proposal. The hook fee is represented as a negative native
`amount0`; `amount1` is zero. The detailed Programmable/creator split is in `NativeSwapFeesAccrued`.

Accept a Programmable launch only when the paired launch, liquidity and initial-buy events come from the verified
launcher address and share the same launch commitment. A bare `PoolRegistered` event is not platform provenance because
the hook is intentionally shared across pools.

## Public data

The application exposes two read-only feeds after the exact release is marked ready:

- `/api/indexers/v1/tokens` for launch, pool, position, metadata and explicit fee fields
- `/api/indexers/v1/token-list` for a Uniswap Token Lists-compatible base record with Programmable extensions

The registry preserves the confirmed block snapshot used to derive the record. Project links are decoded from UERC20
metadata plus Programmable's versioned `extraData`; this is necessary because the upstream UERC20 `tokenURI()` does not
include `extraData`.

## Integration boundary

The feeds and events are public inputs, not evidence that a third-party scanner currently consumes them. The public
DexScreener API is read-only. Mobula and GMGN need a launchpad-level integration to understand the permanent Uniswap v4
position reliably. Never describe a token as accepted by a scanner until that service shows the expected result.
