# LiquidityGrowth V1

> **Status: IN DEVELOPMENT**
>
> **DO NOT DEPLOY. DO NOT EXPOSE THIS MODEL IN THE APP.**

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

Each vault fixes the following values at deployment:

- pool and hook
- native-liquidity target
- token reserve target
- maximum native amount per compound
- active range width
- block cooldown
- reward beneficiaries
- beneficiary shares

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

The launch path initializes 192 observation slots and tests a mature 30-minute history. A one-transaction spot move
is rejected in unit and regression tests, and the locked-position lifecycle passes against the pinned official
mainnet PoolManager.

**LiquidityGrowth V1 remains non-deployable until the release configuration is pinned, sustained-manipulation tests
pass with that exact configuration, gas is reviewed and a deployment manifest is verified.**

## Required release gates

- pin one disclosed release policy for TWAP window, cardinality, tick-delta cap, spot deviation, range width, compound
  size and cooldown
- sustained-manipulation, thin-liquidity, reordering and repeated permissionless-processing tests against that exact
  policy
- adversarial proof that the bounded completion rule releases only after its disclosed minimum and that material
  reserve underfunding remains fail-closed
- pin economic bounds for the native target and token reserve
- gas review for launch-time observation-cardinality initialization and permissionless processing
- source verification and deployment manifest for every new component
- application gating so an unregistered or underfunded vault cannot be presented as available

## Product decisions still open

- native-liquidity target
- token reserve amount or supply percentage
- maximum compound size
- range policy and width
- cooldown
- reward beneficiary split
- whether post-target fees go to beneficiaries, buybacks, burns, or a separate future model

Buybacks, burns, and holder distributions are not part of this prototype. They require separate mechanisms and separate security analysis.
