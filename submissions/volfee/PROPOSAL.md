# Proposal

## Elevator pitch
A single Uniswap v4 hook whose canonical **dynamic-fee** pool reprices its LP fee **every swap from the pool's own realized volatility** — an EWMA of the per-swap tick delta, measured on-chain with **no external price source, no keeper, no governance**. LPs are paid the most exactly when adverse selection is worst; traders pay the least in calm markets. The same hook enforces the mandatory Programmable volume fee non-bypassably.

## User outcome
A creator launches a WETH-paired token in one canonical v4 pool. The LP fee auto-calibrates to volatility, so passive LPs are fairly compensated for toxic flow without any oracle or admin. The value is **launchpad-independent**: it helps any LP on any v4 pool.

## Mechanism (`src/VolFeeHook.sol`, `src/lib/VolMath.sol`)
1. **Dynamic LP fee (to LPs).** `afterInitialize` sets an immutable base fee via `updateDynamicLPFee`; each `beforeSwap` returns `VolMath.feeFromVol(ewmaVol, base, k, minLpFee, maxLpFee) | OVERRIDE_FEE_FLAG`; each `afterSwap` updates `ewmaVol`/`lastTick` from the executed post-swap tick. `lpFee = clamp(base + k·ewmaVol, min, max)`, monotonic, hard-bounded.
2. **Manipulation resistance.** The fee for swap N is read from state accumulated **before** N (update happens in `afterSwap`), so a swap cannot lower its own fee.
3. **Mandatory Programmable fee.** `effective = max(selected,1000)`; `platform = 1000` → immutable owner liability; `project = effective−1000` → immutable PROJECT-claimable liability. Both are ERC-6909 quote claims; solvency: hook balance == platform + project owed. No reserve, no subsidy.

## Why Uniswap v4
Only a v4 hook can return a per-swap LP fee override computed from the pool's own state (no oracle/keeper) and collect the mandatory fee via quadrant-dependent before/after return deltas — atomically, from aggregate pool state.

## Not used
No oracle, keeper, admin, upgrade, reserve, pool-liquidity custody, hookData, cross-chain, or transfer tax.
