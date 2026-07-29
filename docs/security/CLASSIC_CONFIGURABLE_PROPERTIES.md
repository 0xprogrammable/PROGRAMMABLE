# Configurable Classic security properties

This document covers the configurable Classic candidate deployed on Sepolia. It is a review record, not an audit.

## Fixed boundaries

- Buy and sell fees are selected independently at launch from `1%` through `10%` in one-point steps.
- Programmable receives `0.10` percentage points from the applied fee. It is not added on top.
- Token transfers have no tax and the Uniswap v4 LP fee is zero.
- The complete token supply is accounted for between the permanently custodied position, the Initial Buy and bounded
  launch dust.
- A launch has one to five non-zero reward allocations that total exactly `100%`.
- Only a beneficiary can claim its own ETH or redirect its future allocation.
- A payout change or community takeover checkpoints accrued fees before changing future destinations.
- Fixed-lock and vesting custody always use the launch wallet as the immutable beneficiary.
- There is no owner mint, blacklist, pause or post-launch fee setter.

## Authority

`ClassicCtoAuthorityV1` is the only administrative component. It can replace future creator-reward allocations after a
disclosed community-takeover decision. It cannot take previously accrued rewards, modify swap fees, unlock liquidity,
mint tokens or change Initial Buy custody.

The authority itself uses a two-step transfer. A transfer does not change any vault until a separate takeover call is
made.

## Accounting

For a gross native ETH amount `x` and selected fee rate `t`:

```text
totalFee       = floor(x × t / 10,000)
programmable   = floor(x × 10 / 10,000)
creatorRewards = totalFee - programmable
```

Creator rewards are pulled from `PoolManager` into the launch-specific reward vault. Rounding remainder is assigned to
the final allocation, so the full amount remains claimable.

## Evidence

| Property | Primary test |
| --- | --- |
| Directional fee settings never change | `invariant_directionalEconomicsNeverChange` |
| Native claims cover accrued accounting | `invariant_nativeClaimsExactlyCoverAccruedAccounting` |
| Reward accounting is conserved | `invariant_claimAndPayoutAccountingIsConserved` |
| Active shares always total `100%` | `invariant_activeSharesAlwaysTotalOneHundredPercent` |
| Prior rewards survive payout changes and takeovers | `test_approvedCtoChangesOnlyFutureRewardConfiguration` |
| Beneficiaries cannot claim for each other | `test_noDoubleClaimAndNoCrossBeneficiaryClaim` |
| Five unequal allocations are supported | `test_supportsFiveBeneficiariesAtLaunch` |
| Initial Buy custody is immutable | `test_cliffLinearVestingStartsAtZeroAndUsesTheLaunchWalletForever` |

The complete candidate suites are listed in
[`spec.json`](../../models/classic/candidates/configurable/spec.json). The Sepolia deployment and lifecycle evidence is
in [`sepolia.json`](../../models/classic/candidates/configurable/sepolia.json).

## Remaining release boundary

Sepolia evidence does not activate this candidate on Ethereum Mainnet. Mainnet deployment, runtime verification,
source verification and a complete Mainnet lifecycle must be published before the production interface can mark the
configurable release available.
