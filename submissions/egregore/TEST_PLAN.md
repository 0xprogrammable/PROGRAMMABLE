# Test plan

This submission-scoped test plan summarizes the repository's own [`TEST_PLAN.md`](../../TEST_PLAN.md), which is the
canonical, more detailed version and is bound as evidence below.

## Universal prototype evidence

Run:

```bash
npm ci
npx hardhat test
```

Compiler: Solidity `0.8.26`, `viaIR: true`, optimizer `runs: 200`, EVM `cancun` (pinned in `hardhat.config.js`;
dependencies pinned in `package-lock.json`). Every declared onchain contract (`src/*.sol`), every authority, value
flow, configuration bound, state transition, event, failure and exit path this design actually introduces is covered
by the suite below. No app, game, service, keeper, oracle, or indexer surface exists in this proposal, so their
sections of the universal checklist are not applicable.

## Solidity contracts

**Result: 46 passing, 0 failing.**

- `test/egregore.spec.js` (34 tests) — unit/behavioral suite against `HookPoolManagerMock`: token supply, reward
  reservoir streaming and remainder carry-over, same-block exit blocking, decaying unstake-tax bands, lock-tier
  weighting and lock enforcement, buy/sell tax on all four swap quadrants (exact-in/out), continuous anti-dump curve,
  short-term LP-exit tax, unstake-tax routing, stress-mode entry and split, treasury-flush burn/LP-incentive/buyback,
  ETH-side stress buyback, builder-fee routing to the hardcoded `DEV_FEE_RECIPIENT`, the new mandatory-Programmable-fee
  carve-out and its permissionless-claim/owner-redirect authorization test, treasury handoff, guardian pause with
  auto-expiry, `emergencyUnstake` during pause, a dedicated reentrancy-guard test (`ReentrantFlushCaller`), and the
  full presale lifecycle (refunds, hard-cap excess refund, per-wallet cap, finalize-grace refunds, canonical
  PoolManager address checks, `onlyPresale` bootstrap, the documented malicious-PoolManager dev-mode risk, and two
  100-participant end-to-end lifecycle runs).
- `test/egregore.v4.spec.js` (10 tests) — **integration suite against the real, compiled `@uniswap/v4-core`
  PoolManager** (not a mock), via `src/test/V4RealImports.sol` and `PoolSwapTest`/`PoolModifyLiquidityTest`: presale
  bootstrap, buy/sell tax on exact-input and exact-output through the actual currency-delta invariant, short-term
  LP-exit tax via real `afterRemoveLiquidity` return delta, EGR+ETH reward streaming and claim, the stress-mode
  support buyback executed as a real pool swap with burn, a dedicated slippage-guard test (buyback reverts and leaves
  the reserve untouched when the bound is too tight), and the reserve-flush buyback+burn through the real pool. This
  is the evidence that the hook's `take()`/return-delta accounting actually settles on-chain, not just against a mock.
- `test/hook-planner.spec.js` (2 tests) — predicts the nested presale/bootstrapper/hookDeployer/token CREATE
  addresses and mines a valid hook-flag CREATE2 salt, then verifies the finalize path deploys the hook at the
  predicted address with `validateHookAddress = true`.

Static analysis (Slither or equivalent) has not been run; `forge`/`cast`/`anvil` are not installed in this Hardhat
project, so Foundry-specific evidence (gas/size snapshots, fuzz/invariant harnesses in Foundry's own format) is not
available. This is recorded as a tooling gap, not a claim that the properties are untested — the equivalent behavior
is covered by the Hardhat/Mocha suite above, including invariant-style checks (solvency, reentrancy, slippage bound)
run against the real PoolManager.

## Custom hook (`hook.used = true`)

- Permission mask and CREATE2 salt: reproduced and verified by `test/hook-planner.spec.js`.
- PoolManager/PoolKey authentication, `onlyPoolManager`/`onlyPresale` gating: exercised implicitly by every test that
  calls hook functions from a non-authorized address and expects a revert (e.g. `rejects bootstrap calls from anyone
  but the presale`).
- Self-call suppression (sender == address(this)): exercised by every buyback test, where the hook's own swap through
  the pool never appears as a taxed swap.
- All four swap quadrants (exact-input/output x buy/sell): covered by both `egregore.spec.js` and
  `egregore.v4.spec.js`.
- Ordered settlement, final-zero deltas: proven by the real-PoolManager suite, since a non-zero final delta would
  revert the whole swap under `PoolSwapTest`'s own delta assertions.
- No dynamic LP fee is used (static 3000 hundredths-of-bip); not applicable.
- Hook-owned charge collection path, liability keys, event, recipient shares, and duplicate/zero/failed-recipient
  behavior: see `hook.feeMechanism` in `submission.json` and the corresponding tests above (builder-fee flush,
  reward/reserve/support bucket assertions in every tax test).

## Mandatory Programmable fee

- `effective = max(selected, 10 bps)` with selected totals of 500/1000-2000 bps (always above the floor): implicitly
  proven by every tax test, since the carve-out is always `grossAmount * 10/10000`, strictly less than the collected
  tax at Egregore's rates. A dedicated below/at/above-floor sweep across selected totals of 0/5/10 bps is not present
  (Egregore's own rates never approach the floor), which is disclosed rather than fabricated.
- `3% -> 0.1% + 2.9%` non-additive worked example: verified arithmetically in PROPOSAL.md's semantic examples and
  structurally by every `programmableShareOf(...)` assertion in `test/egregore.spec.js`.
- Token-to-quote and quote-to-token, exact-input and exact-output, on the canonical PoolKey: covered by
  `egregore.v4.spec.js`'s four swap-mode tests.
- Quadrant-dependent before/after path: **not proven**, because Egregore's implementation does not use the canonical
  fixed-quote-asset basis (disclosed as the single largest open question). All four quadrants use `after-swap-return-delta`
  in this proposal; there is no before-swap path to test.
- Actually-executed gross volume after partial fills: not applicable (this pool's exact-in/out swaps never partially
  fill).
- LP fees, token taxes, router paths, donations and alternative pools cannot satisfy or bypass the mandatory fee: the
  LP-exit and unstake taxes are explicitly disclosed as **not** carving out a Programmable share (open question 2);
  this is a known, disclosed gap rather than a hidden bypass.
- Owner-only claim, anytime, to itself or an owner-selected destination; builder/project/administrator/recipient
  cannot redirect: proven by the dedicated
  `carves 10 bps of gross swap volume into the mandatory Programmable fee and lets only it redirect the claim` test in
  `test/egregore.spec.js`, including an explicit revert for a non-owner `claimProgrammableFeesTo` call and a
  successful redirect using an impersonated owner signer.
- Claimable-liability accrual (not auto-transfer), accrual/claim reconciliation: proven by the same test asserting
  `programmableFeeEgr` accrues on tax collection and zeroes exactly on claim.
- `(poolId, currency, owner)` liability solvency, no cross-pool netting: single-pool design, not applicable beyond
  what the accounting-bucket solvency tests already cover.
- Exact source/test path binding: `programmableFee.evidence` in `submission.json` points to `src/EgregoreHook.sol` and
  both `egregore.spec.js`/`egregore.v4.spec.js`.

## No-hook proposal path

Not applicable; `hook.used = true` for this entire proposal.

## App, game, service, keeper, oracle, or indexer

None declared; not applicable.

## Product integration cases

None planned (`integration.platformHandoff.intended = false`); not applicable.

## Semantic cases

See PROPOSAL.md's "Semantic examples" section for the worked buy-tax, sell-tax-curve, LP-exit-tax and stress-buyback
numerical examples, each with a named passing test.

## Evidence status

| Command | Tool version | Result |
| --- | --- | --- |
| `npm ci` | npm (Node 20.20.0) | passed |
| `npx hardhat compile` | hardhat ^2.28.0, solc 0.8.26 | passed |
| `npx hardhat test` | hardhat ^2.28.0, mocha/chai | passed — 46/46 |
| Slither / static analysis | not installed | not-applicable-with-reason (no Foundry/Slither toolchain in this Hardhat project) |
| `forge`/`cast`/`anvil` evidence | not installed | not-applicable-with-reason (Hardhat project, not Foundry) |

Maintainer acceptance, platform review, deployment authorization, deployment execution, source verification, runtime
matching, lifecycle verification, monitoring readiness, routing/discovery, and availability are all separate gates
with separate evidence, none of which is claimed by this test plan.
