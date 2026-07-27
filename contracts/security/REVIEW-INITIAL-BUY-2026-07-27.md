# Classic creator Dev Buy review

Date: 2026-07-27

Scope: the creator-selected initial buy added to `MemeLaunchV1`, its server transaction preparation, release manifests and
regression evidence.

This is an internal engineering review, not an external audit or Mainnet approval.

## Decision

Every Classic launch requires at least `600000000000000` wei. The creator may choose a larger Dev Buy. The amount is
not a launch fee and is not supplied as liquidity. After the complete token supply enters the permanent one-sided
position, the launcher uses the complete selected amount for one market buy in the canonical v4 pool and transfers the
purchased tokens directly to the creator.

The minimum is fixed in ETH rather than USD. A "$1 minimum" would otherwise require a trusted ETH/USD oracle and would
make transaction validation time-dependent.

## Atomic flow

1. Reject any value below 0.0006 ETH before token creation.
2. Create the fixed-supply UERC20.
3. Register and initialize the canonical hooked pool.
4. Mint the complete token supply into the permanent one-sided position.
5. Unlock PoolManager and execute an exact-input native-ETH-to-token swap.
6. Require a negative native delta equal to the complete selected Dev Buy and a positive token delta.
7. Settle the exact native delta and take the purchased tokens directly to the creator.
8. Require zero residual launcher ETH and record the launch hash and events.

Any failure reverts token creation, pool state, liquidity placement, fee accounting and transfers together.

## Security boundary

- Only the immutable PoolManager may call `unlockCallback`.
- The swap uses the already registered canonical PoolKey and shared immutable fee hook.
- The native delta must equal the exact creator-selected input.
- A zero or negative token result is rejected.
- The launcher retains neither ETH nor launched tokens after success.
- The actual initial-buy amount and purchased token amount are committed into the launch hash and emitted event.
- `nonReentrant` covers the complete launch, including token callbacks, PositionManager calls, hook callbacks and the
  PoolManager unlock.

## Regression evidence

- Exactly 0.0006 ETH succeeds.
- A larger Dev Buy succeeds and returns more tokens to the creator.
- One wei below the minimum reverts before deployment and leaves no token or launch record.
- Direct unauthorized `unlockCallback` invocation reverts.
- Mainnet-fork launch moves the price below the initial boundary, produces active liquidity and sends bought tokens to
  the creator.
- Creator, launcher, PositionManager and permanent-position custody balances reconcile after success.

## Release consequence

The source change invalidated the previous Sepolia deployment as current release evidence. The exact changed release
has now been deployed and source-verified, then exercised through an atomic Dev Buy launch, Permit2 authorization,
Universal Router sell and both native fee claims. Two independent RPCs reconcile the current release, so Sepolia is
`ready`; the previous deployment remains historical.

No Mainnet broadcast is authorized or recorded.
