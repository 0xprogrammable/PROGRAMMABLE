# Protocol Revenue Deepener V1

**Status:** Candidate, not deployed

**Network:** Ethereum

**Target:** Programmable `$V4` / ETH

The Protocol Revenue Deepener converts ETH revenue into permanent liquidity for one immutable Uniswap v4 pool.
Anyone may run its public maintenance functions, but nobody can withdraw assets or change the target.

## Cycle

1. ETH reaches the contract through `fund()` or a compatible revenue source.
2. `snapshotPrice()` records the current pool tick.
3. After 30 minutes, `compound()` checks the live tick against that observation.
4. The contract swaps half of one bounded batch for `$V4`.
5. It adds the ETH and `$V4` to one full-range position owned by the contract.
6. The next successful cycle cannot run for six hours.

An expired observation can be replaced after two hours. If the price or available liquidity falls outside policy, the
complete transaction reverts and the assets remain for a later cycle.

## Immutable target

| Parameter | Value |
| --- | --- |
| PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` |
| `$V4` token | `0x7987f03462200b3D8A072E02C89A8A41dCB124EE` |
| Pool hook | `0x025a386eAa79f6067d29848FD05ccC71bEAb20CC` |
| Pool ID | `0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0` |
| Position range | Full range |
| Minimum batch | `0.001 ETH` |
| Maximum batch | `0.05 ETH` |
| Minimum interval | 6 hours |

The constructor rejects the deployment unless the live pool, hook, fee disclosure and PoolManager match these values.

## Control model

The contract has:

- no owner or administrator;
- no withdrawal or rescue function;
- no token approval or arbitrary-call function;
- no path that removes liquidity;
- no configurable pool, token, hook, position or interval; and
- no caller-selected compound amount.

`unlockCallback` accepts calls only from the canonical PoolManager while a transient request digest is active.
Successful cycles reconcile the exact ETH and token balance changes before recording their result.

## Price and execution bounds

The observation is a delayed two-point check, not a full time-weighted oracle. A cycle requires:

- an observation between 30 minutes and two hours old;
- no more than 50 ticks between the observation and the pre-swap spot price;
- no more than 25 ticks of movement from the contract's own swap; and
- a batch capped by both current active liquidity and `0.05 ETH`.

These bounds limit one execution. They do not remove public mempool, sandwich or sustained price-manipulation risk.

## Revenue sources

`pullRevenue(source)` accepts only a contract whose immutable `launcherFeeRecipient()` is this deepener. The claim
amount, received ETH and accounting change must match exactly.

Existing hooks that name an EOA treasury cannot be redirected by this contract. Their revenue needs a treasury-signed
sweep, or future launches must use a hook deployed with this deepener as its immutable recipient.

## Evidence

| Property | Evidence |
| --- | --- |
| Target binding and fixed parameters | `test_configurationIsImmutableAndBoundToOnePool` |
| Source validation and exact claim accounting | `test_pullsProtocolRevenueAndCompoundsMaximumSafeBatch` |
| Direct PoolManager payout accounting | `test_directSourceClaimIsAccountedByPoolManagerReceive` |
| Six-hour cooldown | `test_compoundCannotRunTwiceInsideSixHours` |
| Delayed observation | `test_compoundCannotRunBeforeObservationMatures` |
| Price divergence fails closed | `test_compoundFailsClosedAfterLargePriceMove` |
| Liquidity only increases | `test_everySuccessfulCycleOnlyIncreasesLockedLiquidity` and stateful invariants |
| No withdrawal, rescue, approval or arbitrary call | `test_noWithdrawalRescueApprovalOrArbitraryCallSurfaceExists` |
| Forced ETH and token donations remain add-only | `test_forcedNativeDonationCanOnlyBeCompounded` and `test_donatedTargetTokensCanOnlyBeCompounded` |
| Canonical live-pool compatibility | `testFork_compoundsTheCanonicalProgrammablePool` |

The candidate passes unit, fuzz, stateful invariant, static-analysis and Mainnet-fork checks. It has not received an
independent audit or public security contest. Deployment and source-verification records must be added before its
status changes from candidate.
