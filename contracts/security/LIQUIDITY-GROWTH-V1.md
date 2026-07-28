# LiquidityGrowth V1

> **Status: IN DEVELOPMENT**
>
> **DO NOT DEPLOY. DO NOT EXPOSE THIS MODEL IN THE APP.**

LiquidityGrowth is a proposed launch model that redirects creator swap fees into the token's main Uniswap v4 pool until an immutable native-liquidity target has actually been added. Creator rewards begin only after that target is reached.

This repository currently contains a contract and test prototype. It is not a production deployment, a completed launch flow, or a security approval.

## Fee flow

LiquidityGrowth reuses the existing Classic v3 fee hook. It does not change the hook permissions or the fixed Programmable fee.

1. A swap pays the configured total fee.
2. The Classic hook accounts for the fixed 0.10 percentage-point Programmable fee separately.
3. The remaining creator fee accrues to a factory-authenticated upstream vault.
4. Anyone may call `process()` to pull newly accrued creator fees.
5. Until the immutable target is reached, creator-fee ETH is paired with a launch-funded token reserve and added to active Uniswap v4 core positions.
6. Fees above the target remain deferred until the target has been reached with ETH actually committed to liquidity.
7. After the target, creator fees are routed to the immutable beneficiary split.

The target is denominated in native ETH actually added to locked positions. It is not market capitalization, USD value, trading volume, or fees merely received by the vault.

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

The implementation is fail-closed. Rewards do not start merely because the allocation target was reached. They start only when the full native target was actually added to liquidity.

Increasing an existing core position may realize position fees or donations. The vault separates those credits from
the principal delta, retains them in growth accounting and never treats a positive fee credit as removable principal.

If rounding or an uneconomic remainder prevents the last amount from being added, rewards remain deferred. A production version needs an explicit and tested dust policy before deployment.

## Current deployment blocker

The prototype derives its active tick range from the pool's current spot state. An attacker may manipulate that state immediately before `compoundPending()` or permissionless `process()`, causing liquidity to be placed in an unfavorable range.

The cooldown and maximum batch reduce exposure but do not solve this manipulation risk.

**LiquidityGrowth V1 must not be deployed until a manipulation-resistant range policy is implemented and proven.**

## Required release gates

- atomic token creation, pool initialization, vault deployment, reserve funding, registration, and ownership checks
- a manipulation-resistant TWAP or oracle policy with explicit observation and fallback rules
- adversarial tests for spot manipulation, thin liquidity, reordering, sandwiching, and repeated permissionless processing
- a defined dust policy that cannot release rewards before the actual target
- mainnet-fork coverage for launch, buy, sell, fee accrual, processing, liquidity addition, reward release, payout updates, and claims
- parameter bounds for target, reserve, batch size, range width, and cooldown
- full fuzz and invariant coverage for accounting, token conservation, access control, and permanently add-only liquidity
- Slither review, bytecode-size check, gas review, source verification, and deployment manifest
- application gating so an unregistered or underfunded vault cannot be presented as available

## Product decisions still open

- native-liquidity target
- token reserve amount or supply percentage
- maximum compound size
- range policy and width
- cooldown
- dust treatment
- reward beneficiary split
- whether post-target fees go to beneficiaries, buybacks, burns, or a separate future model

Buybacks, burns, and holder distributions are not part of this prototype. They require separate mechanisms and separate security analysis.
