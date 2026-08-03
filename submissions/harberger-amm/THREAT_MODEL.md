# Threat model

Adversarial review of `src/HarbergerHook.sol` (custody · Harberger tax · buyout · liquidation · mandatory
programmable fee · param hardening). Evidence: 74 tests incl. per-phase fuzz solvency, a reentrancy exploit
harness, and stateful invariants. All green.

## Assumptions
- **QUOTE is a normal ERC-20** used both as the pool's quote side and the tax-deposit asset. A malicious /
  ERC-777-style QUOTE is explicitly considered below and mitigated with a reentrancy guard.
- **OWNER** is the immutable platform address `0x4957f4…6c` (programmable-volume-fee-v1); no setter, no admin
  upgrade, no oracle, no keeper.
- The hook custodies ONE full-range v4 position; LPs interact only through it.

## Findings

### 1. [CRITICAL — FIXED] Reentrancy on the plain-ERC20 tax path
The Harberger tax money (deposits, rewards, buyout price, liquidation payouts) moves as **plain ERC-20**
(`safeTransfer` / `safeTransferFrom`), deliberately OUTSIDE `poolManager.unlock` (to avoid `CurrencyNotSettled`).
`buyout` / `withdraw` / `liquidate` finalize state (ownership, `delete claims[id]`, `quoteTaxReserve -= …`)
*around/after* those transfers. A malicious or ERC-777 QUOTE token (an attacker can deploy this hook on a pool
whose QUOTE they control, then attract LPs) could re-enter the hook mid-payout and **double-spend the reserve**
(re-`withdraw` the same claim before it is deleted; `quoteTaxReserve` decremented twice → drains other LPs).
- **Fix:** the hook inherits OpenZeppelin `ReentrancyGuard`; every value-moving entry point
  (`deposit`, `withdraw`, `buyout`, `liquidate`, `harvest`, `topUpTax`, `claimProgrammableFee`) is
  `nonReentrant`. The buyout anti-abuse guards were additionally moved to the FRONT of the function
  (checks-effects-interactions).
- **Proof:** `test/audit/Reentrancy.t.sol` deploys a reentrant `MaliciousToken` as QUOTE, has an attacker LP
  re-enter `withdraw` during its own payout, and asserts the re-entrant call is REJECTED and the attacker
  receives only its single legitimate payout (deposit + own liquidity leg ≈ 21e18), never a doubled drain
  (≈ 41e18). The baseline LP's reserve survives intact.

### 2. Reserve & custody solvency (invariant-verified)
- **`invariant_reserveSolvent`**: `IERC20(quote).balanceOf(hook) ≥ quoteTaxReserve` under any interleaving of
  deposit/withdraw/buyout/liquidate/harvest/topUp/poke/warp across 4 actors (`test/invariant/…`). Every reward
  distributed was first drawn from a real deposit; `accIncrement`/`pending` floor (round in the pool's favor),
  so the reserve is always over- or exactly-collateralized. Per-phase `testFuzz_solvency` corroborate.
- **`invariant_custodyLiquiditySynced`**: `totalLiquidity == the real v4 position liquidity` always — deposits
  add, withdraws remove, liquidation redistributes via the shares denominator WITHOUT moving liquidity.
- Fee is held as **ERC-6909 claims**, SEPARATE from the plain-ERC20 tax reserve, so fee accrual never
  commingles with (or breaks the refund math of) the tax reserve; `Fee.t.sol` asserts
  `6909 balance == programmableFeeOwed` with no cross-pool netting.

## Surfaces reviewed — no issue
- **First-depositor / inflation attack:** liquidity can be added ONLY through `deposit` (custody gate reverts
  any external `modifyLiquidity`), which always mints shares; nobody can donate bare liquidity to skew the
  share price. Redeem rounds down.
- **Self-price = 0 tax dodge:** `minSelfPriceWad` floor (`selfPrice ≥ minSelfPriceWad·shares/1e18`) enforced on
  every self-price set (deposit + buyout). `BelowMinSelfPrice`.
- **Buyout griefing / instant re-flip:** `buyoutCooldown` + `lastAcquiredTs` (reset each acquisition) gate
  re-buyout; each buyout also costs the real self-price. `BuyoutOnCooldown`.
- **`quoteTaxReserve` underflow:** every debit (`harvest`/`withdraw`/`buyout`/`liquidate`) is a claim's own
  `pending + leftover`, both subsets of the tracked reserve → never underflows (fuzz-verified).
- **Reward theft by a fresh/incoming owner:** `rewardCheckpoint` is set to the current `accRewardPerShare` at
  deposit and reset on buyout, so a new owner cannot claim rewards accrued before it held the claim.
- **Fee evasion / cross-pool netting / non-owner claim:** fee collected on every canonical-pool swap
  (quadrant-correct), liability keyed `(poolId, currency)`, claimable only by `OWNER` to a per-call
  destination; alt/hookless pools and plain transfers do not accrue (`Fee.t.sol #05/#07/#08/#10`).
- **Access control on hook callbacks:** all v4 callbacks + `unlockCallback` are `onlyPoolManager`; the hook
  never initiates a swap on its own pool. `Fee.t.sol #06`.
- **Liquidation of a sole LP:** rejected (`NoOtherLPs`) so forfeited liquidity is never stranded ownerless.
