# Test plan

**Result: 88 tests green, 0 failed, 0 skipped** on the final code (commit `b1fa1fbce647273643f404bc920a0ee1c134960d`) — 85 local + 3 mainnet-fork. Toolchain: `forge 1.7.1 (4072e48705 2026-05-08)`, `slither 0.11.6`, `solc 0.8.26 / cancun / optimizer runs=200 / bytecode_hash=none`.

## Exact commands

| Command | Result | Evidence |
| --- | --- | --- |
| `forge build --force --build-info` | `passed` (0 errors; informational forge-lint notes only) | `evidence/forge-build.txt` |
| `forge test --no-match-path 'test/fork/*'` | `passed` — 85 passed / 0 failed / 0 skipped, 15 suites | `evidence/forge-test-local.txt` |
| `MAINNET_RPC_URL=https://eth.drpc.org forge test --match-path 'test/fork/*' -vv` | `passed` — 3 passed / 0 failed | `evidence/forge-test-fork.txt` |
| `slither . --foundry-compile-all --json .tmp/slither.json` | `passed` (1407 results; 12 touch src/, all FP/info) | `evidence/slither-hook-triage.md`, `evidence/slither-hook-findings.json` |
| `forge snapshot --no-match-path 'test/fork/*'` | `passed` | `.gas-snapshot` |

Fuzz `runs = 256`; invariant `runs = 256, depth = 30, fail_on_revert = false`.

## Suite-by-suite counts (88 total)

| Suite | Tests | Requirement covered |
| --- | ---: | --- |
| `test/ProgrammableFee.t.sol` | 13 | **Mandatory fee** — 4-quadrant × both orderings, non-additive split, executed basis, canonical-only accrual, owner-only claim, event reconciliation, solvency, no cross-pool netting |
| `test/FloorHonor.t.sol` | 10 | **Floor** — below-floor top-up (both orderings), no-top-up above floor, partial honor, monotonic ratchet, `testFuzz_08_solvencyInvariant` |
| `test/FloorMath.t.sol` | 13 | **Floor math** — `floorPrice`, `ratchet` monotonicity, WAD scaling, rounding, zero/edge cases |
| `test/AntifragileFloorHook.t.sol` | 3 | **Permission mask / wiring** — `test_hookAddress_encodesMask0x10cc`, `test_getHookPermissions_exactlyFiveFlags`, `test_constructor_wiring` |
| `test/Reentrancy.t.sol` | 4 | **Reentrancy** — hostile token as tkn/quote blocked, reverting-token atomic no-stuck-state |
| `test/HardValues.t.sol` | 14 | **Hard reverts / bounds** — non-owner claim reverts, init-twice reverts, wrong-pool reverts, boundary amounts |
| `test/ReserveDrainExploit.t.sol` | 4 | **CRITICAL reserve-drain regression** — top-up sized on executed, not requested, tkn |
| `test/invariant/AntifragileInvariants.t.sol` | 6 | **Invariants** — `invariant_solvency`, `neverPaysMoreThanReserve`, `floorMonotonic`, `noStuckHookDelta`, `platformLiabilityClaimable`, coverage |
| `test/invariant/AntifragileDrainInvariant.t.sol` | 1 | **Invariant** — `invariant_topUpFairness_noReserveDrain` |
| `test/invariant/AntifragileTwoPoolInvariant.t.sol` | 2 | **Invariants** — `invariant_eachPoolSolvent`, `invariant_noCrossPoolNetting` |
| `test/audit/TokenModel.t.sol` | 5 | **Audit 1.2/1.3/1.4/4.5** — immutable-snapshot floor immunity, burn-own bounded, inflation no-drain, reverting-`totalSupply` no corruption, floor immune to post-init mint+burn |
| `test/audit/BindingFrontrun.t.sol` | 3 | **Audit 4.1/4.2/4.3** — binding front-run griefing, re-bind forbidden, non-quote pool rejected |
| `test/audit/ReentrancyDeeper.t.sol` | 2 | **Audit 3.4/3.5** — `totalSupply()` reentry harmless, claim payout is CEI |
| `test/audit/OwnerReserveIsolation.t.sol` | 3 | **Audit 2.5/1.5/1.6** — owner can't reduce reserve, drain-to-zero leaves liability payable, no external reserve mutator |
| `test/audit/FeeBypassAndAccounting.t.sol` | 2 | **Audit 2.2/1.5** — fragmentation never undercharges, ERC-6909 donation inert/unstealable |
| `test/fork/AntifragileFork.t.sol` (pinned) | 2 | **Fork** — `test_fork_realPoolManager_identity`, `test_fork_buy_sell_topUp_againstRealPoolManager` at block 25666892 |
| `test/fork/AntifragileFork.t.sol` (head smoke) | 1 | **Fork head smoke** — `test_fork_head_initAndOneSwap_smoke` at chain head |

`test/audit/AuditBase.sol` is a shared harness (no tests). Sum = 13+10+13+3+4+14+4+6+1+2+5+3+2+3+2+2+1 = **88**.

## Custom-hook coverage (mask `0x10cc`)

- **Mask + CREATE2 address** — reproduced by `test_hookAddress_encodesMask0x10cc` (address low bits == `0x10cc`), `test_getHookPermissions_exactlyFiveFlags`; `BaseHook` ctor re-validates.
- **PoolManager authentication** — `test_06_hookEntrypointsAreOnlyPoolManager`, `test_09_entrypointsAreOnlyPoolManager` (every entrypoint reverts `NotPoolManager` for non-manager callers).
- **Both directions × exact-in/exact-out** — `test_03_quadrants_quote0`, `test_03_quadrants_quote1` cover all four quadrants for both currency orderings.
- **Selector / return shape** — asserted implicitly by every passing swap (v4 reverts on a wrong selector or return length).
- **Self-call suppression** — `selfCallPolicy = same-pool-swap-forbidden`; the hook has no `poolManager.swap`, so v4 self-call skipping and `AlreadyUnlocked` are proven by `Reentrancy.*` (a nested unlock reverts).
- **ERC-6909 solvency / final-zero deltas** — `invariant_solvency`, `invariant_noStuckHookDelta`, `testFuzz_08_solvencyInvariant`.
- **Partial fills / rounding** — `test_04_basisIsExecutedNotRequested`, `ReserveDrainRegression.*`, `test_fragmentation_neverUndercharges`.
- **Failure atomicity** — `Reentrancy.test_revertingToken_atomicNoStuckState`.

## Mandatory Programmable fee proof

- `effective = max(selected, 1000)` at selected = 0 / below / at / above the floor → `test_01_rateLevels_platformAlways10bps`.
- `3% → 0.1% platform + 2.9% project`, never `3.1%` → `test_02_nonAdditive_3pct`.
- token↔quote, exact-in/out, on the canonical PoolKey → `test_03_quadrants_*`.
- before-path when quote specified, after-path when quote unspecified → covered by the quadrant tests (with WETH=`currency0`: zeroForOne-exactIn/oneForZero-exactOut = before; the other two = after).
- executed gross basis after partial fills, rounding, reconciliation → `test_04_basisIsExecutedNotRequested`, `test_11_eventsReconcile`, `testFuzz_feeSplit`.
- LP/tax/router/donation/alt-pool neither satisfy nor bypass → `test_05_onlyCanonicalPoolAccrues`, `test_erc6909Donation_inert_notStealable`.
- owner-only claim, anytime, to owner-selected destination; reject others → `test_07_ownerClaimsToArbitraryDestinations`, `test_08_nonOwnerCannotClaim`, `test_09_noStoredRecipient_ownerOnlyRedirect`, `invariant_platformLiabilityClaimable`.
- claimable liability (not auto-transfer), partial/full claim, backing → `test_10_solvencyAndNoCrossPoolNetting`, `OwnerReserveIsolation.*`.
- `(poolId,currency,owner)` solvency + isolation, no cross-pool netting → `AntifragileTwoPoolInvariant.*`.
- Bound to `programmableFee.collection.hookFeeMechanismBinding = hook.feeMechanism` and value-flow `swap-volume-charge` in `submission.json`.

## Semantic cases (worked → tested)

- `selected 0 → 10 bps + 0` and `selected 3% → 0.1% + 2.9%` (non-additive) → `test_01`, `test_02`.
- Floor top-up: `topUp = min(max(floorHigh*execTknIn/1e18 - ammQuoteOut, 0), reserveQuote)`; value-conservation `balance == reserveQuote + Σ owed` → `FloorHonor.*`, `invariant_solvency`.
- Failure case: reserve < deficit → partial honor (`reserveQuote → 0`), never revert → `FloorHonor.test_03_partialHonor`.
- Finding 1.2 numeric (crater → floor immune, extraction 294.3 → 2.49) → `TokenModel.test_adminBurnAnyone_mitigatedByImmutableSnapshot_noOverExtraction`.

## Static analysis

Slither 0.11.6: 1407 results across 130 contracts; exactly 12 reference the review-target `src/`, all dispositioned false-positive or informational (the one Medium touching src/ — `unused-return` on `poolManager.unlock` — is safe because `unlockCallback` returns empty bytes by design). Of 176 High/Medium across all contracts, only that one touches src/; the rest are in `node_modules` deps and test scaffolding. No true-positive bug. Full disposition: `evidence/slither-hook-triage.md`.

## Gas / size

Hook runtime size **8,004 bytes** (16,572-byte margin under EIP-170). Per-test gas snapshot in `.gas-snapshot` (fuzz means seed-dependent; medians stable).

## Fork / deployment evidence

Pinned block 25666892 + chain-head smoke against the REAL mainnet PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90`; observed runtime codehash `0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293` (also at head) + Sourcify runtime/creation source match (`deployment-evidence.json`).

## Not applicable (with reason)

- **App / game surfaces** — none declared; the project is a single onchain contract. No client trust split exists.
- **Service / keeper / oracle** — none; no offchain authority is in the trust path (`operations.keeper.required = false`, `operations.oracle.required = false`).
- **Transfer tax / automatic liquidity** — the token is an ordinary ERC-20; the hook adds no transfer tax and no auto-liquidity path.
- **Cross-chain / proof / async-swap / custom-curve** — unused capabilities; the AMM leg is never replaced (not a custom curve).
- **Product-integration executable tests** — UI/quote/trade/claim are specified boundaries only; executable product-contract tests begin after maintainer acceptance and path assignment.

## Evidence status / separate gates

All commands above are `passed` with real content-hashed artifacts bound in `gate-status.json` and `review-target.json`. These prove only the exact revision they exercise. Maintainer acceptance, platform review, deployment authorization, deployment execution, source verification, runtime matching, lifecycle verification, monitoring readiness, routing/discovery, and availability remain **separate, uncompleted, maintainer-owned gates**. Planned product work is not test evidence, and none of this proves live fee collection.
