# Liquidity Growth range source

Status: prototype only. Do not deploy.

## Decision

Uniswap v4 core does not store price observations or expose a reusable TWAP. Its pool state contains the current
`slot0`, fee growth, active liquidity, ticks, the tick bitmap and positions. `StateLibrary` reads that current state;
it does not reconstruct historical prices.

Every v4 pool has at most one hook, selected in the pool key at initialization. The existing Classic hook already
occupies that slot, so an oracle cannot be attached later as a second hook. A permissionless external contract that
occasionally samples `slot0` is also insufficient: it cannot know when the tick changed between samples and its
sampling schedule is gameable.

The production design therefore needs a new composite hook release that records observations while it performs the
existing fee logic. Observation storage should remain inside that hook so swaps do not depend on an untrusted external
call. The already vendored OpenZeppelin Uniswap Hooks package contains a Panoptic-derived `BaseOracleHook` and `Oracle`
library that can be reused as an implementation pattern. This is OpenZeppelin code, not a v4-core oracle primitive.

`LiquidityGrowthRangeSourceV1` is the independent consumer-side policy:

1. Bind permanently to the pool's actual hook and PoolManager.
2. Query `[twapWindow, 0]` from that hook.
3. Use only the truncated cumulative series.
4. Revert if the requested history is not populated. There is no spot fallback.
5. Reject compounding when the current spot tick differs from the truncated TWAP by more than the immutable limit.
6. Center an immutable-width, spacing-aligned range on the TWAP and clamp it at the global usable ticks.

The constructor also requires enough half-width to keep every accepted spot strictly inside the range after
tick-spacing rounding.

## Why truncated observations

The OpenZeppelin/Panoptic oracle tracks both the normal cumulative tick and a cumulative tick whose movement per
observation is capped by `MAX_ABS_TICK_DELTA`. Using the truncated series limits the effect of a single observation
jump. It does not make the price independently correct.

The same-pool TWAP can still be manipulated if an attacker sustains a distorted price for enough of the configured
window, particularly while liquidity is thin. The release configuration must therefore combine:

- a meaningful TWAP window;
- a conservative per-observation tick-delta cap;
- sufficient populated observation cardinality before the first compound;
- the spot-versus-TWAP circuit breaker in this source;
- bounded compound size and cooldown in the vault;
- mainnet-fork manipulation tests at realistic liquidity.

An active-liquidity threshold is deliberately not treated as an oracle guarantee. Active liquidity has pool-specific
units and can be supplied temporarily, so it may be a separate operational guard but not evidence that the price is
safe.

## Canonical V1 policy

The canonical launcher does not accept oracle or range parameters from creators. It fixes:

- a 30-minute TWAP window
- 192 observation slots
- a 400-tick truncated-oracle movement limit
- a 600-tick spot-to-TWAP deviation limit
- a 20,000-tick range half-width aligned to the pool's 200-tick spacing

The 192-slot ring retains about 38 minutes of history under the worst-case one-write-per-12-second-block schedule.
Compounding still fails until the requested 30-minute history is actually populated. Cardinality is capacity, not
proof of maturity.

Launch allocates only the first `1 -> 2` stage. `LiquidityGrowthAutomationV1` authenticates the vault through its
immutable factory and grows only that vault's exact hook and pool ID. Each later call adds at most 16 slots and caps
at 192. The range source rejects every quote while `cardinalityNext` is below 192, even when a caller bypasses the
coordinator and calls the vault directly. Its subsequent `observe([30 minutes, 0])` call separately proves historical
maturity and fails closed when the required older observation is unavailable.

The canonical vault separately enforces a five-minute timestamp-based minimum interval between successful compounds.
That interval only bounds cadence. It does not make the same-pool TWAP independently manipulation resistant, and
every compound must still obtain a mature range quote from this source.

## Integration requirements

The current Classic hook cannot be upgraded in place and existing pools cannot change their hook. Liquidity Growth
must use a newly deployed composite hook whose address flags include its existing callbacks plus `afterInitialize`.
Its `beforeSwap` path must record the pre-swap observation before applying fee accounting.

Before wiring this source into the vault:

- implement the observation recorder in the new composite hook;
- pin and review the exact OpenZeppelin oracle code used;
- prime observation capacity from one to two during launch, then use the factory-bound permissionless coordinator to
  grow in bounded 16-slot stages to 192;
- expose `poolManager()` and `observe(uint32[], PoolId)` exactly as
  `ILiquidityGrowthOracleV1` specifies;
- replace the vault's spot-derived `_activeGrowthRange()` with a call to this source;
- make the source address immutable in both the vault and its configuration hash;
- test insufficient history, stale/thin markets, same-block movement, sustained manipulation and tick-boundary cases;
- run Slither and the complete unit, fuzz, invariant and mainnet-fork suites.

## Primary references

- Uniswap v4 hooks: https://developers.uniswap.org/docs/protocols/v4/concepts/hooks
- Uniswap v4 state reads: https://developers.uniswap.org/docs/protocols/v4/guides/state-view
- Uniswap v4 pool state:
  https://github.com/Uniswap/v4-core/blob/main/src/libraries/Pool.sol
- Uniswap v4 `StateLibrary`:
  https://github.com/Uniswap/v4-core/blob/main/src/libraries/StateLibrary.sol
- OpenZeppelin `BaseOracleHook`:
  https://github.com/OpenZeppelin/uniswap-hooks/blob/master/src/oracles/panoptic/BaseOracleHook.sol
- OpenZeppelin/Panoptic `Oracle` library:
  https://github.com/OpenZeppelin/uniswap-hooks/blob/master/src/oracles/panoptic/libraries/Oracle.sol

The local dependency commits reviewed for this prototype are:

- `v4-core`: `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`
- `openzeppelin-uniswap-hooks`: `26dc8e53f812a1ca390d470342adb6cd8c3286ad`
