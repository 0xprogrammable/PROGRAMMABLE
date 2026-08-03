# Proposal

## Elevator pitch
Liquidity you can never lazily squat on. Every LP self-prices their custodied position, pre-pays a
continuous Harberger holding tax that is rebated to active LPs, and **anyone can buy them out at that
self-price**. Over-priced or unfunded liquidity is recycled to people who will use it — Weyl–Posner
*Radical Markets*, enforced natively by one Uniswap v4 hook, with no admin, oracle, keeper or upgrade.

## User outcome
A launched token is paired with a quote asset in one canonical v4 pool bound to the `HarbergerHook`. LPs add
liquidity only through the hook (custody gate), receiving self-priced ERC-6909-style share claims. Each claim
pre-pays a tax; the tax rebates to all LPs; delinquent claims are recycled; and every swap pays the mandatory
10 bps Programmable volume fee to the immutable platform owner.

## Mechanism (see `src/HarbergerHook.sol`)
1. **Custody.** The hook owns ONE full-range v4 position. `beforeAddLiquidity`/`beforeRemoveLiquidity` revert
   any add/remove not made by the hook, forcing every deposit through `deposit(...)`, which mints pro-rata
   `Shares` claims (first deposit 1:1) and pulls both pool currencies plus a pre-paid QUOTE tax deposit.
2. **Harberger tax (model A — pre-paid QUOTE deposit).** Each claim carries `selfPrice` + a `taxDeposit`.
   `_settleTax` draws `taxOwed(selfPrice, taxRatePerYear, elapsed)` from the deposit into a MasterChef
   `accRewardPerShare` accumulator, rebating it to all LPs (harvest with `harvest`; top up with `topUpTax`).
   The reserve invariant `IERC20(quote).balanceOf(hook) >= quoteTaxReserve` always holds.
3. **Buyout (always-for-sale).** `buyout(id, newSelfPrice, newTaxDeposit)` — anyone but the owner pays the
   claim's `selfPrice` in QUOTE directly to the seller, settles the seller's tax, pays their pending reward +
   unused deposit, and takes over the claim with a fresh self-price + deposit. Shares/liquidity are unchanged.
4. **Liquidation.** When a claim's deposit is exhausted (`isLiquidatable`), `liquidate(id)` is permissionless:
   it burns the delinquent claim's shares (`totalShares` shrinks, `totalLiquidity` unchanged), redistributing
   its liquidity pro-rata to the remaining LPs via the shares denominator — no swap, no `unlock`. The
   forfeiter keeps its earned reward. Requires other LPs to exist (`NoOtherLPs`).
5. **Mandatory Programmable fee.** `beforeSwap`/`afterSwap` collect the `programmable-volume-fee-v1` charge
   quadrant-dependently on the executed gross quote-side volume; `effective = max(feeTotalBps*100, 1000)`.
   The whole charge (Harberger deploys at exactly 10 bps ⇒ `project == 0`) accrues to `programmableFeeOwed`
   as ERC-6909 quote claims, claimable only by the immutable owner `0x4957f4…6c` via `claimProgrammableFee`.
   Fee claims are held SEPARATELY from the plain-ERC20 tax reserve, so fees never disturb the tax accounting.
6. **Anti-abuse params.** `minSelfPriceWad` floors the self-price per share (no ~0 self-price to dodge tax);
   `buyoutCooldown` throttles re-buyout churn. Both default 0 (disabled).

## Why v4
Only a hook can (a) custody the single position and enforce self-priced claims + continuous tax + buyout +
liquidation atomically from aggregate pool state, and (b) collect the mandatory fee non-bypassably via
quadrant-dependent before/after return deltas on every canonical-pool swap.

## Trust & safety
No admin, oracle, keeper or upgrade; all parameters immutable at construction. All value-moving entry points
are `nonReentrant` (OpenZeppelin ReentrancyGuard) with checks-effects-interactions ordering. See
`THREAT_MODEL.md` for the full adversarial review (including the fixed reentrancy finding). This is a
PROTOTYPE: not deployed, not independently reviewed, not source-verified, not available through Programmable.
