# Liquidity Growth fee and oracle hook

Status: in development. Do not deploy.

## Scope

`LiquidityGrowthFeeOracleHookV1` is the defensive composite-hook prototype for a future Liquidity Growth launch
model. A Uniswap v4 pool can bind only one hook, so the existing Classic fee callbacks and the observation recorder
must live at the same hook address.

The hook and its factory are independent of Classic production contracts, deployment manifests and scripts. They are
not available in the application.

## Preserved fee semantics

The composite hook deliberately preserves `EthCreatorFeeHookV3` economics and control boundaries:

- immutable buy and sell fees from 100 to 1,000 basis points in 100-basis-point steps;
- a fixed 10-basis-point Programmable share deducted from the selected fee;
- no ERC-20 transfer tax and no v4 LP fee;
- factory-authenticated immutable reward vaults;
- exact-input floor rounding and exact-output gross-up rounding;
- partial-fill rejection;
- vault-only creator claims and treasury-only Programmable claims.

Registration validates each directional fee once. The oracle path does not add another fee validator, setter,
administrator or external pricing dependency.

The dedicated parity tests execute the composite hook and `EthCreatorFeeHookV3` from identical pool states for:

- exact-input buys;
- exact-output buys;
- exact-input sells;
- exact-output sells.

Each path asserts the complete returned `BalanceDelta`, creator accrual, Programmable accrual, total accrual and
PoolManager claim balance.

## Observation behavior

The hook uses the vendored OpenZeppelin/Panoptic `Oracle` library without copying or changing its arithmetic.

- `afterInitialize` creates the baseline observation.
- `beforeSwap` records the pre-swap tick before fee accounting.
- The recorder writes at most once for one block timestamp.
- Anyone may pay to increase the next observation cardinality.
- `observe` reverts for an unregistered or uninitialized pool.
- The library reverts when requested history predates the oldest populated observation.
- `maxAbsTickDelta` is immutable and positive.

The truncated cumulative series constrains one recorded tick jump. It is not an independent price oracle and does not
make a thin market manipulation resistant on its own. The consumer must still enforce observation maturity, a
meaningful window, spot-versus-TWAP deviation limits, bounded actions and cooldowns.

## Hook address and deployment identity

The required permission mask is exactly:

- `beforeInitialize`;
- `afterInitialize`;
- `beforeSwap`;
- `afterSwap`;
- `beforeSwapReturnDelta`;
- `afterSwapReturnDelta`.

The factory rejects addresses with any different low-bit permission mask. Its deterministic deployment commitment
includes the PoolManager, Programmable treasury, reward-vault factory and `maxAbsTickDelta`.

## Verification completed

- 16 focused tests pass, including 1,000 fuzz runs.
- Cardinality growth, one-write-per-block behavior and insufficient-history failure are covered.
- CREATE2 prediction and exact permission bits are covered.
- Full-project Slither reports zero findings across 128 contracts.
- Runtime size is 18,085 bytes, 6,491 bytes below the EIP-170 limit.
- Factory runtime size is 21,096 bytes, 3,480 bytes below the EIP-170 limit.

These checks are local evidence, not an audit or deployment approval. Mainnet-fork manipulation tests, integration
with the range source and vault, deployment-record verification and independent review remain release gates.
