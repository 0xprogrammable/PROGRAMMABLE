# Proposal

**Submission stage:** Proposal
**Model id:** `egregore`

Egregore is a Uniswap v4 launch surface: a presale funds a fixed-supply token, permanently seeds one canonical ETH/token
pool, and a single custom hook then taxes swaps and short-term LP exits to run a staking reward stream, a treasury
buyback-and-burn, and a stress-mode market-support mechanism.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | Contributors get a proportional claim on the launched EGR token once the soft-cap-gated presale finalizes; ongoing traders pay a hook-owned tax that funds staker rewards, a burn-and-treasury reserve, and a market-support buyback; LPs who exit within 7 days of opening a position pay a 300 bps exit tax. |
| Pool | currency0 = native ETH, currency1 = EGR (fixed 100,000,000 supply). One canonical PoolKey, registered once via `configurePool()`. Static 3000 (0.30%) LP fee. Alternative pools using the same hook address receive zero tax and zero effect. |
| During a trade | Buys: flat 5% tax. Sells: continuous 10%-20% anti-dump tax as price runs above a rolling snapshot. Tax always lands on the swap's unspecified side (H-1 audit fix), so both exact-input and exact-output settle correctly on the real PoolManager. |
| Value | 5% builder/dev fee (hardcoded `DEV_FEE_RECIPIENT`), 10 bps mandatory Programmable fee (hardcoded `PROGRAMMABLE_FEE_RECIPIENT`), then 50/30/20 (normal) or 20/50/30 (stress) reward/reserve/market-support split of the remainder. Reserve flush burns 20%, routes 10% to LP incentives, pays 70% to the treasury recipient. Stress-mode support release buys EGR back through the pool and burns half. |
| Creator choices | Soft cap, hard cap, presale duration, guardian/treasuryRecipient/builderManager/securityRecipient addresses — all fixed at deploy time via the `EgregorePresale` constructor. |
| Fixed platform rules | Tax rates, split percentages, the 5% builder fee, the mandatory 10 bps Programmable fee, the 7-day LP-exit window, the unstake-tax decay schedule and the reservoir release rate are all compile-time constants with no setter. |
| Authorities | guardian (pause, auto-expires 7d), treasuryRecipient (two-step transferable; stress thresholds, LP-incentive recipient, buyback slippage bound), presale (one-shot setup), securityRecipient (one-time allocation). See `submission.json.authorities`. |
| Dependencies | Uniswap v4 PoolManager (onchain, canonical per-chain address enforced); OpenZeppelin, Uniswap v4-core/v4-periphery, solmate (build-time libraries). See `submission.json.dependencies`. |
| Failure | A revert during finalize() leaves contributions intact and opens the grace-period refund path. A reverted swap/LP-removal/buyback reverts the whole call atomically; no bucket is ever partially updated. |
| Project surfaces | One onchain project boundary (`EgregorePresale`, `EgregoreBootstrapper`, `EgregoreHookDeployer`, `EgregoreHook`, `EgregoreToken`), Solidity, no app/game/service/keeper/oracle/indexer built yet. |
| Product surfaces | None planned through Programmable; Egregore launches and operates entirely through its own contracts (`integration.platformHandoff.intended = false`). |
| Not used | ERC-6909 claims, cross-chain messaging, proof systems, external oracles, keepers, permissioned assets, async swaps, custom curves — none of these apply to this design. |

## Why Uniswap v4 and architecture choice

`hook.used = true`. Egregore needs a v4 hook because the flywheel requires atomic callback execution the token or a
router alone cannot provide: `afterSwap` charges a hook-owned tax on the unspecified side of every swap (buy vs sell,
exact-in vs exact-out); `afterRemoveLiquidity` charges a separate short-term LP-exit tax via return delta; `beforeSwap`
refreshes an anti-dump price snapshot; and the hook's own `unlockCallback` runs protocol-owned buybacks through the same
PoolKey without taxing itself. None of this is expressible as a plain ERC20 transfer tax or an external fee switch.

Egregore integrates the mandatory Programmable fee policy into this one custom hook rather than implementing the
separate standard fee-hook profile; see `programmableFee` and the single largest open question below. All other
protocol logic (presale, token, staking, treasury, buyback) is contract-only; there is no app, game, service, keeper,
oracle or indexer surface in this proposal.

## Lifecycle

See `submission.json.launchLifecycle` for the full per-phase actor/value-flow/custody/failure/event breakdown of token
creation, pool initialization, liquidity formation, trading, fees and claims, and dependency failure. `initialTransaction`
and `retirement` are explicitly not applicable: there is no creator initial buy, and the hook/pool/staking loop is
intended to run indefinitely with no retirement path beyond the bounded guardian pause.

## Assets, pool behavior, optional callbacks, and integration

Two assets: native ETH (quote) and EGR (launched, fixed-supply, burnable via OpenZeppelin's ERC20Burnable). Canonical
PoolKey: `(ETH, EGR, 3000, 60, EgregoreHook)`, formed once at presale finalize by `EgregoreBootstrapper` seeding a
single full-range position from the raised ETH and a fixed 49,500,000 EGR allocation. No router is bundled; any
standard v4 router works. All four swap modes are supported; no partial fills (v4 exact-in/out swaps against this pool
either fully execute or revert).

`hook.used = true`. Permissions: `afterInitialize`, `beforeAddLiquidity`, `afterRemoveLiquidity`,
`afterRemoveLiquidityReturnDelta`, `beforeSwap`, `afterSwap`, `afterSwapReturnDelta` are enabled; every other flag
(including `beforeSwapReturnDelta`) is false. Every callback authenticates `onlyPoolManager`; `configurePool`/`activate`
authenticate `onlyPresale`. The hook is CREATE2-deployed once by `EgregoreHookDeployer` (a small factory owned by the
presale, not a general registry) and admits exactly one PoolKey for its lifetime. Return-delta shape: a single
non-negative `int128` against the unspecified currency for `afterSwap`; a `BalanceDelta` with up to two non-negative
components for `afterRemoveLiquidity`. Self-calls (the hook's own buyback swap) are always suppressed in both
`beforeSwap` and `afterSwap`.

## Product integration plan

Not planned. `integration.platformHandoff.intended = false`; Egregore does not request a Programmable registry, UI,
API, or indexer surface in this proposal. `routingAndDiscoverability.routingMode = not-planned`.

## Fees, recipients, and settlement

**Mandatory Programmable fee** (`programmableFee`): `effective = max(selected, 10 bps)`; Egregore's selected totals
(500 bps buy, 1000-2000 bps sell) are always far above the 10 bps floor, so `effective` always equals the selected
total and the split is `10 bps Programmable + (selected - 10 bps) project`, never additive. Basis is the swap's gross
volume on the same side Egregore's own tax already charges — **not** always the fixed quote asset via a mixed
before/after path per the canonical quadrant table; see the single unresolved question below.
`collection.status = pending-hook-integration` for exactly that reason, even though the 10-bps carve-out itself is
implemented and tested. Immutable owner and sole claim authority: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`.
`claimProgrammableFees()` is permissionless and always pays that address; only that address can redirect a claim via
`claimProgrammableFeesTo(recipient)`. Accrued as a `claimable-liability` keyed by `(poolId, currency, owner)`, not
auto-transferred. The mandatory fee applies to swap tax only, not to the LP-exit or unstake taxes (also disclosed as
an open question).

**Egregore's own tax**: builder/dev 5% (hardcoded `DEV_FEE_RECIPIENT`, `flushBuilderFees()` permissionless), then the
remainder splits 50/30/20 (normal) or 20/50/30 (stress) into a staker reward pool, a reserve, and a market-support
bucket — all internal accounting buckets inside `EgregoreHook`, not separate contracts. See `submission.json.valueFlows`
for the exact settlement path of every value-moving action (presale contribute/claim/refund, swap-tax, lp-exit-tax,
unstake-tax, reward-claim, treasury-flush, programmable-fee-claim).

## Semantic examples

- Buy of 100 EGR gross output, normal mode: tax = 5 EGR. Programmable share = grossAmount * 10/10000 = 0.1 EGR
  (carved out of the 5 EGR, not added). Remaining 4.9 EGR: builder 0.245 EGR (5%), then 4.655 EGR splits 2.3275/1.3965/0.931
  EGR (50/30/20 reward/reserve/support). Verified in `test/egregore.spec.js` and against the real PoolManager in
  `test/egregore.v4.spec.js`.
- Sell pushing price 11%+ above the rolling snapshot: tax hits the 20% surge ceiling; below that, the curve is linear
  between 10% and 20%. Verified by `ramps the sell tax continuously between base and surge`.
- LP exit within 7 days of opening: 3% tax on both withdrawn currencies. LP exit after 7 days: 0% tax. Verified by
  `collects short-term LP exit tax only for recent LP positions`.
- Stress-mode support release: releases 25% of the support bucket per day, buys EGR back through the pool bounded by
  `maxBuybackSlippageBps`, burns 50% of the result, recycles 50% into the reward pool. A too-tight slippage bound
  (0 bps) correctly reverts the whole release and leaves every bucket untouched, verified against the real PoolManager
  in `reverts a protocol buyback when the slippage bound is too tight`.

## Fact provenance

- **Evidence-backed**: every specific bps value, function name, event name, split percentage, and test name in this
  proposal is taken directly from the reviewed source (`src/*.sol`) and the passing test suite
  (`test/egregore.spec.js`, `test/egregore.v4.spec.js`, `test/hook-planner.spec.js`), not inferred.
- **Agent-derived**: the `submission.json` structured fields (permission mask, return-delta quadrant mapping, risk
  dimensions, dependency closure) were derived from that same source by an AI-assisted process across two audit passes
  plus a dedicated review for this submission.
- **Builder-stated**: the deploy-time role addresses (guardian, treasuryRecipient, builderManager, securityRecipient)
  are placeholders selected at deployment; no specific production addresses are claimed live in this proposal.

## Open decisions

1. Should Egregore adopt the canonical fixed-quote-asset (always-ETH) Programmable fee basis via a
   `beforeSwapReturnDelta` hook permission and a re-mined CREATE2 salt, or is the current same-side-as-protocol-tax
   implementation an acceptable variant for this custom hook?
2. Should the mandatory Programmable fee also apply to the short-term LP-exit tax, given that LP removal is not
   literally a "swap" but does move value out of the canonical pool?
3. Should the one-time protocol-owned liquidity position gain an explicit lock/forwarder/unlock path, or is permanent
   bootstrapper custody with no removal path the intended design?
4. What monitoring, alerting and indexing (if any) should back the emitted events before or after any future mainnet
   deployment?

This is a public, non-confidential proposal. The skill and local checker do not prove that fees are collected live.
Acceptance, independent review, product integration, deployment, runtime matching, lifecycle evidence, monitoring,
routing, listing, scheduling and availability require separate evidence records.
