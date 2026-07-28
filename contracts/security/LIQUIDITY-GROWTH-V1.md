# LiquidityGrowth V1

> **Status: IN DEVELOPMENT**
>
> **DO NOT DEPLOY. DO NOT EXPOSE THIS MODEL IN THE APP.**
>
> **Legacy range-based prototype.** The current Deep release candidate uses one immutable FullRange position and a
> fixed economic policy. See [`DEEP-FULL-RANGE-V1-TECHNICAL-REVIEW.md`](./DEEP-FULL-RANGE-V1-TECHNICAL-REVIEW.md)
> and [`../release/DEEP-FULL-RANGE-V1.md`](../release/DEEP-FULL-RANGE-V1.md).

LiquidityGrowth is a proposed launch model that redirects creator swap fees into the token's main Uniswap v4 pool
until its immutable native-liquidity completion rule is satisfied. Creator rewards begin only after that point.

This repository contains an atomic launch prototype, its composite fee-and-oracle hook, deterministic factories,
range policy, vault and tests. It is not a production deployment or a security approval.

## Fee flow

LiquidityGrowth uses a separate composite hook because a v4 pool can bind only one hook. Its fee path preserves the
Classic v3 economics while its oracle path records the same pool's pre-swap observations. Classic deployments and
their hook are unchanged.

1. A swap pays the configured total fee.
2. The composite hook accounts for the fixed 0.10 percentage-point Programmable fee separately.
3. The remaining creator fee accrues to a factory-authenticated upstream vault.
4. Anyone may call `process()` to pull newly accrued creator fees.
5. Until completion, creator-fee ETH is paired with a launch-funded token reserve and added to active Uniswap v4 core positions.
6. Fees above the nominal target remain deferred until the full target is allocated and the immutable minimum is actually committed to liquidity.
7. After the target, creator fees are routed to the immutable beneficiary split.

The nominal target and its derived minimum are denominated in native ETH actually added to locked positions. They are
not market capitalization, USD value, trading volume, or fees merely received by the vault.

## Why a token reserve is required

ETH alone cannot deepen active two-sided liquidity. A future launcher must atomically transfer a fixed token reserve into the vault when the token and pool are created.

The reserve is immutable in purpose:

- it can only remain in the vault or move into the configured pool as liquidity
- the vault exposes no token withdrawal or sweep function
- the vault exposes no liquidity-removal function
- the vault cannot transfer or approve ownership of a position

The existing Classic NFT forwarder is intentionally not reused. It cannot safely increase its position after launch. LiquidityGrowth instead owns add-only Uniswap v4 core positions directly.

## Immutable launch configuration

Creators choose the economic terms that are specific to their launch:

- native-liquidity target
- token reserve target
- reward beneficiaries
- beneficiary shares

The canonical V1 launcher fixes the manipulation and execution policy:

- 30-minute truncated same-pool TWAP
- 192 observation slots
- 400-tick maximum truncated-oracle movement per observation
- 600-tick maximum spot-to-TWAP deviation
- 20,000-tick active range half-width
- five-minute timestamp-based minimum interval between successful compounds
- maximum compound amount equal to the smaller of 0.25 ETH and 2.5% of the native target

The compound limit is always below the separate safety ceiling of the smaller of 0.5 ETH and 5% of the native
target. Creators cannot override any of these policy values.

The five-minute interval limits compounding cadence; it does not replace the 30-minute oracle-maturity requirement.
Contracts cannot wake themselves up. Any account or external keeper may submit `process()` or `compoundPending()`
after the interval, and every attempted compound must still pass the exact-pool TWAP checks.

Oracle storage is allocated separately from historical maturity. Launch allocates only the first `1 -> 2`
observation stage. The immutable permissionless coordinator then grows capacity in bounded 16-slot stages up to 192.
Fee processing remains unavailable until capacity reaches 192, and the range source independently requires a real
30-minute observation history. Allocating storage never manufactures history.

The pool, hook, range source, economic terms and release policy are immutable after launch.

There is no owner, admin, upgrade, rescue, withdrawal, position transfer, or configuration-change path.

Beneficiaries may only claim their own post-target rewards and change their own payout address. Any account may trigger fee processing or a bounded compound, but cannot redirect assets.

## Accounting and failure behavior

The public accounting separates:

- creator fees received
- ETH allocated to growth
- ETH pending a compound
- ETH actually added to liquidity
- tokens actually added to liquidity
- native and token position fees or donations recycled into growth
- deferred post-target rewards
- claimable and claimed rewards

The implementation is fail-closed. Rewards do not start merely because fees were received. The full nominal target
must be allocated to growth and the disclosed minimum must actually be added to locked liquidity.

Increasing an existing core position may realize position fees or donations. The vault separates those credits from
the principal delta, retains them in growth accounting and never treats a positive fee credit as removable principal.

Completion has one immutable rounding tolerance. It is the smaller of:

- one basis point of the configured native target
- `0.000001 ETH`

The complete nominal target must first have been allocated from creator fees. Rewards may then start only after the
native amount actually added to locked liquidity reaches `growthTargetNative - completionToleranceNative`.

Any shortfall at completion is recorded onchain. It remains in `pendingGrowthNative`, cannot be claimed, swept,
redirected or withdrawn, and may still be added by a later permissionless compound if matching reserve becomes
available. It is never reclassified as a creator reward.

This rule handles only bounded arithmetic or uneconomic final dust. A materially underfunded token reserve does not
qualify: the vault remains incomplete and rewards remain deferred.

## Current deployment status

The vault no longer centers liquidity on the current spot tick. It uses an immutable exact-pool range source backed
by truncated same-pool TWAP observations from the composite hook. There is no spot fallback. Insufficient history or
excessive spot-to-TWAP deviation blocks compounding atomically.

The launch path initializes the oracle, registers the exact factory-authenticated vault with the immutable
coordinator and allocates capacity from one to two observations. Permissionless bounded calls grow capacity by no
more than 16 slots at a time and cap it at 192. Compounding requires both the full capacity target and a mature
30-minute history, and separately enforces a five-minute timestamp-based minimum interval. A one-transaction spot
move is rejected in unit and regression tests, and the locked-position lifecycle passes against the pinned official
mainnet PoolManager. The canonical launcher rejects a fee-oracle hook configured with any tick-delta value other than
400 and derives every vault's compound limit from its immutable target.

Sustained-manipulation testing has confirmed that a distortion held for the full 30-minute window can become the
same-pool TWAP and be accepted. The spot-to-TWAP breaker then prevents further compounding after price restoration
until a healthy window develops, but it cannot establish an independent fair price.

**LiquidityGrowth V1 remains non-deployable until that sustained-manipulation risk has an explicit safe design,
gas is reviewed and a deployment manifest is verified.**

## Required release gates

- sustained-manipulation, thin-liquidity, reordering and repeated permissionless-processing tests against that exact
  policy
- adversarial proof that the bounded completion rule releases only after its disclosed minimum and that material
  reserve underfunding remains fail-closed
- disclose the chosen native target and token reserve before signature
- mainnet-fork gas review for the atomic two-slot launch prime, bounded observation staging and permissionless
  processing
- source verification and deployment manifest for every new component
- application gating so an unregistered or underfunded vault cannot be presented as available

## Product decisions still open

- native-liquidity target
- token reserve amount or supply percentage
- reward beneficiary split
- whether post-target fees go to beneficiaries, buybacks, burns, or a separate future model

Buybacks, burns, and holder distributions are not part of this prototype. They require separate mechanisms and separate security analysis.
