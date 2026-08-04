# Test plan

`forge test` — **61 tests, 0 failures** (solc 0.8.26 / cancun / optimizer 200).

## VolMath pure library (`test/VolMath.t.sol`, 24)
absTickDelta over full int24 range; EWMA alpha bounds (0/max/revert), convergence, monotonic; fee clamps to [min,max]; bad-bounds/bad-k reverts. Fuzz (~10k): fee always in [min,max]; fee monotonic non-decreasing in volatility; EWMA bounded by min/max of inputs.

## Mandatory Programmable fee (`test/ProgrammableFee.t.sol`, 18)
Dynamic-fee pool init + NotDynamicFee revert on a static pool; platform always 10 bps; non-additive 3% split; all four swap quadrants (quote as currency0/1); executed-not-requested basis; only the canonical pool accrues; onlyPoolManager entry points; owner claims platform / non-owner cannot; PROJECT claims project fee / non-project cannot; solvency (hook 6909 balance == platform + project owed); events reconcile; fuzz fee split.

## Vol-adaptive LP fee (`test/VolAdaptiveFee.t.sol`, 12)
Calm market keeps base fee; volatile swaps raise the fee (clamped at max); **manipulation resistance** (a swap cannot lower its own fee — `ewmaAfter > ewmaBefore`, `feeAfter ≥ feeBefore`, monotonic); fee always in bounds (fuzz); lastTick/ewmaVol update in afterSwap only; mandatory fee unaffected by the override.

## Stateful invariants (`test/invariant/VolFeeInvariant.t.sol`, 4; 7680 fuzzed calls, 0 reverts)
`invariant_feeAlwaysInBounds` (fee ∈ [MIN,MAX] under any swap sequence); `invariant_solvency` (hook 6909 quote balance == programmableFeeOwed + projectFeeOwed); `invariant_lastTickTracksPool` (hook lastTick == pool tick).

## Mainnet fork (`test/fork/VolFeeFork.t.sol`, 3; archive RPC)
Real PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90` identity by codehash; deploy + dynamic-fee pool + swaps prove mandatory-fee accrual, solvency, and volatility-responsive fee on real infrastructure; head smoke.

## Static analysis
Slither 0.11.6: 17 findings, **0 true-positive** (see `evidence/slither-hook-triage.md`).
