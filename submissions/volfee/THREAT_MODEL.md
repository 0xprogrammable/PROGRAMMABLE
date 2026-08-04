# Threat model

Adversarial internal audit of `src/VolFeeHook.sol` + `src/lib/VolMath.sol`. 61 tests pass (24 VolMath, 18 fee, 12 vol-adaptive, 4 stateful invariants, 3 mainnet-fork). Slither: 0 true-positive.

## Threat model surface

- **Fee manipulation (dynamic LP fee).** The fee for swap *N* is read in `beforeSwap` from the volatility state accumulated by prior swaps; the state is updated only in `afterSwap`. A trader cannot lower their own fee with their own trade. Test: `test/VolAdaptiveFee.t.sol::test_manipulation_ownSwapCannotLowerOwnFee` (asserts `ewmaAfter > ewmaBefore`, `feeAfter ≥ feeBefore`, monotonic).
- **Fee bounds.** `VolMath.feeFromVol` is pure with overflow guards that clamp to `MAX_LP_FEE`; the fee can never leave `[MIN_LP_FEE, MAX_LP_FEE]` for any `ewmaVol`. Tests: `VolMath.t.sol` fuzz + `VolAdaptiveFee.t.sol::test_fee_always_in_bounds` + invariant `invariant_feeAlwaysInBounds` (7680 fuzzed calls, 0 reverts).
- **Volatility suppression.** Wash-trading tiny swaps to keep `ewmaVol` low costs the mandatory volume fee on every swap and yields no private advantage (a lower fee is a public good), and the fee floor `MIN_LP_FEE` bounds the downside. Considered residual, accepted.
- **Solvency.** The hook holds exactly `programmableFeeOwed + projectFeeOwed` in ERC-6909 quote claims; there is no reserve or subsidy. Invariant `invariant_solvency` asserts `manager.balanceOf(hook, quote) == owed` across all fuzzed swap sequences.
- **Reentrancy.** All swap-path work is inside the PoolManager unlock (no external call to attacker code); claims are zero-before-pay (CEI) and a nested `unlock` reverts, so a malicious claim destination cannot double-claim. No `ReentrancyGuard` is required (all value-moving work runs inside the PoolManager unlock with CEI-ordered claims).
- **Fee bypass.** The mandatory fee is collected in all four quadrants on the executed basis; the dynamic LP fee override does not change the mandatory-fee accrual. Test: `test_mandatory_fee_still_works`.
- **Pool binding.** `afterInitialize` binds the first quote-pool once (`PoolAlreadyBound` on any second init), requires a dynamic-fee pool (`NotDynamicFee`), and sets the base fee + volatility state. Alternative pools never inherit VolFee behavior.

## Static analysis (Slither)

17 findings, **0 true-positive**: 3 `unused-return` (intentional — `poolManager.unlock()` returns empty bytes; `getSlot0` partial destructure), 5 `reentrancy-benign`/`reentrancy-events` (calls are to the trusted PoolManager inside its lock; claims are CEI), 9 `naming-convention` (SCREAMING_CASE immutables + `_`-prefixed params, an intentional style). See `evidence/slither-hook-findings.json`.

## Real-infrastructure evidence

`test/fork/VolFeeFork.t.sol` deploys the hook against the real mainnet PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90` (identity by codehash), initializes a dynamic-fee pool, and verifies mandatory-fee accrual, solvency, and that `previewLpFee()` rises after volatile swaps and stays within bounds.
