# Proposal

**Submission stage:** Prototype
**Model id:** `antifragile-floor-hook`
**Compatibility decision:** `PROTOTYPE_READY` · inherent risk tier `high` (base `medium`, raised by feature triggers) · score 13

A single Uniswap v4 hook that launches one token against WETH and, out of its own swap-fee income, funds a **monotonic price floor** every seller can always redeem against — while enforcing the mandatory Programmable volume fee non-bypassably on the same canonical pool. There is no custom AMM curve: the constant-product core swap always executes first, and the floor is paid as a *reserve-funded subsidy* on top of the AMM output.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | A creator launches `FLOOR` in one canonical `WETH/FLOOR` v4 pool. Buyers trade normally; an exact-input seller is guaranteed at least the floor price, subsidised from a reserve the project's own fee slice fills. LPs keep the standard pool LP fee. |
| Pool | Two assets — WETH (quote, `currency0`) and the launched token (`currency1`). One canonical PoolKey bound at `_afterInitialize`; alternative pools never inherit floor or fee behavior. |
| During a trade | `_beforeSwap` carves the volume fee when the quote is the *specified* currency; `_afterSwap` carves it when the quote is *unspecified*, ratchets the floor, and — on an exact-input sell only — pays the reserve-funded top-up. The core AMM leg is never zeroed. |
| Value | 10 bps of every swap → owner-claimable platform liability. The remaining `effective-1000` → the floor `reserveQuote`. The reserve pays exact-input sellers up to the floor. LP fee → LPs. |
| Creator choices | `feeTotalBps` (immutable ctor arg → `effectiveRate = max(feeTotalBps*100, 1000)`), the quote currency, and the token. All fixed at construction. |
| Fixed platform rules | 10 bps platform slice, immutable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, owner-only claim, monotonic floor, executed-basis fee, no rescue/sweep/pause. |
| Authorities | Exactly one: the immutable Programmable-fee owner (claim-only, no reserve access). No admin, upgrade, pause, or mutable recipient. |
| Dependencies | Uniswap v4 PoolManager singleton `0x000000000004444c5dc75cB358380D2e3dE08A90` (chain 1), bound by runtime hash + Sourcify match. Compiles against `@uniswap/v4-core@1.0.2` and `@openzeppelin/uniswap-hooks@1.1.1`. |
| Failure | Every callback is `onlyPoolManager`; any settlement failure reverts the whole swap atomically. A reserve too small to reach the floor is *partially honored*, never reverted. |
| Project surfaces | One onchain contract surface (`src/AntifragileFloorHook.sol` + `src/lib/FloorMath.sol`). No UI/API/indexer implemented yet. |
| Product surfaces | Indexer/monitoring boundary is specified (events reconstruct reserve + liabilities); UI/quote/trade/claim remain future maintainer-owned handoff work. |
| Not used | No donate callbacks, no add/remove-liquidity return deltas, no ERC-20 transfer tax, no keeper, no oracle, no cross-chain, no upgradeability, no `hookData`. |

## Why Uniswap v4 and architecture choice

`hook.used = true`. This project **integrates the mandatory fee into its one custom hook** rather than using the standard fee-only profile, because the floor mechanism needs the swap callbacks anyway: v4's `beforeSwap`/`afterSwap` return-delta capability is what lets the hook (a) carve the fee out of the swapped amount and (b) pay a reserve-funded subsidy to a seller in the same atomic swap, using PoolManager ERC-6909 claims as custody. None of this is possible with a router charge, an LP fee, or a transfer tax; all of those are explicitly rejected as fee substitutes.

The floor is deliberately **not** a custom curve. A custom curve (`beforeSwapReturnDelta` replacing the whole swap) would zero the AMM leg and require re-deriving concentrated-liquidity math. Instead the constant-product swap runs unchanged and the hook only adds a bounded top-up afterward — a much smaller trust surface that reuses the audited v4 core math.

Everything lives onchain in the hook; there is no offchain component in the trust path. Indexing/monitoring is a read-only reconstruction, not an authority.

## Lifecycle

- **Token + pool creation / initialization** — The deployer creates `FLOOR`, mines a CREATE2 hook address encoding mask `0x10cc`, and initializes exactly one `WETH/FLOOR` PoolKey whose `hooks` field is that address. `_afterInitialize` binds the first pool containing the immutable `quoteCurrency`, records `tknCurrency` and `poolId`, and snapshots `backedSupplySnapshot = totalSupply(tkn)` **once**. Reverts `NotQuotePool` (no quote side) or `PoolAlreadyBound` (second init). Deployment MUST initialize atomically (see finding 4.1).
- **Liquidity formation** — Standard v4 `modifyLiquidity`; no hook liquidity callbacks are enabled. LPs own their positions and exit normally at any time.
- **Trading (buys and sells)** — `_beforeSwap` collects the fee for before-quadrants and returns a positive `beforeSwapReturnDelta`; `_afterSwap` collects it for after-quadrants, ratchets `floorHigh`, and tops up exact-input sellers. Fee basis is the executed gross quote volume in every quadrant.
- **Fees and claims** — 10 bps accrues into `programmableFeeOwed[poolId][currency]` as a claimable liability; `effective-1000` accrues into `reserveQuote`. The immutable owner calls `claimProgrammableFee(poolId, currency, destination)` at any time to pay a chosen destination; the reserve is never touched by a claim.
- **Dependency failure** — A PoolManager revert or a settlement failure reverts the whole swap atomically; no partial state is committed. A TKN whose `totalSupply()` reverts at bind time fails-safe (the pool never binds); post-init it is irrelevant (the floor reads the frozen snapshot).
- **Retirement** — No explicit teardown. The pool and hook are immutable; liquidity can always be withdrawn and the owner can always claim outstanding liability. The floor and reserve remain governed only by code.

## Assets, pool behavior, callbacks, and integration

- **Assets** — WETH (quote, `currency0`, standard ERC-20 assumed non-reentrant/non-fee-on-transfer); `FLOOR` (launched, `currency1`, intended fixed-supply ERC-20). Fee and reserve are held as the hook's **ERC-6909 quote claims** in the PoolManager, so solvency is exact.
- **Canonical PoolKey** — `WETH/FLOOR` with this hook; canonical `true`. Alternative pools are unaffected and never inherit behavior.
- **Permission mask `0x10cc`** — `afterInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, `afterSwapReturnDelta` = true; all other ten permissions false. `getHookPermissions()` returns exactly those five; the mined address low bits equal `0x10cc`; `BaseHook`'s constructor re-validates.
- **PoolManager authentication** — Every entrypoint (`beforeSwap`, `afterSwap`, `unlockCallback`, `afterInitialize`) is `onlyPoolManager`; a non-manager caller reverts `NotPoolManager`.
- **`hookData`** — unused (`false`); standard-router compatible, no model-specific calldata.
- **Return shapes** — `beforeSwapReturnDelta` returns a positive specified-currency delta (the fee) or `ZERO_DELTA`; `afterSwap` returns a single `int128` net = `feeDelta - topUp` on the unspecified (quote) currency.
- **Nested-action / self-call** — `selfCallPolicy = same-pool-swap-forbidden`: the hook contains no `poolManager.swap` call, v4 no-ops callbacks on self-calls, and all entrypoints are `onlyPoolManager`.
- **Router / swap modes** — external router; all four swap modes supported; only executed amounts are charged/honored (partial fills create no fee, reserve change, or floor obligation); slippage and deadline are enforced by the external router against the final caller delta.

## Fees, recipients, and settlement

The root `programmableFee` record (`programmable-volume-fee-v1`, version `1.0.0`) is the authority.

- **Split** — `effective = max(selected, 1000)` (hundredths-of-bip); `platform = 1000` (exactly 10 bps); `project = effective - 1000`. The split is **non-additive** (the 10 bps is carved *out* of the total; `platform + project ≡ total`) and excludes the LP fee.
- **Worked examples** — `selected 0 → effective 1000 → 10 bps platform + 0 project`; `selected 300000 (3%) → effective 300000 → 1000 platform (0.1%) + 299000 project (2.9%)`, never `3.1%`.
- **Basis** — executed gross quote-side swap volume in the pool's quote asset, measured on the actual post-partial-fill amount. Rounding is `ceil` in the protocol's favor (a 1-wei swap still charges ≥1 wei; fragmentation never undercharges).
- **Quadrants** — collect BEFORE iff the quote is the swap's *specified* currency, else AFTER. With WETH as `currency0`: `zeroForOne exactIn → before`, `zeroForOne exactOut → after`, `oneForZero exactIn → after`, `oneForZero exactOut → before` (mirrored if WETH were `currency1`). All four modes covered.
- **Ownership** — immutable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, sole claim authority, claim anytime to itself or an owner-selected per-claim destination. `storedMutableRecipient = false`; no builder/project/administrator mutation; no rescue, sweep, or redirect.
- **Accounting** — 10 bps accrues as a **claimable liability** keyed `(poolId, currency, owner)`, not auto-transferred; no cross-pool netting. `collectionEvent = ProgrammableFeeCollected`, `claimEvent = ProgrammableFeeClaimed`; value-flow id `swap-volume-charge`.
- **The floor (project value)** — the project slice funds `reserveQuote`. `floorPrice = reserveQuote * 1e18 / backedSupply` (QUOTE-per-TKN, WAD); `floorHigh` is a monotonic high-water mark. On an exact-input sell, `topUp = min(max(floorHigh * executedTknIn / 1e18 - ammQuoteOut, 0), reserveQuote)`. It is a reserve-funded subsidy, **not** swap volume, and never changes the fee basis. `reserveQuote` has no external setter and is never owner-withdrawable.

### Two design decisions that define the security posture

1. **Executed-tkn top-up (closes the CRITICAL reserve-drain).** The subsidy is sized on the TKN the pool *actually received* (`execTknIn`, read from the swap `BalanceDelta`), never the requested `|amountSpecified|`. A tight `sqrtPriceLimitX96` can partial-fill and deliver only dust TKN; sizing on the request would pay a floor subsidy for TKN never delivered and drain the shared reserve. Fixed at commit `cd2109a`; re-proven by `ReserveDrainRegression.*`.
2. **Immutable `backedSupplySnapshot` (closes audit finding 1.2).** The floor denominator is a snapshot of `totalSupply()` taken **once** at bind time, not a live read. A malicious `burn-anyone` / negative-rebase TKN can no longer crater supply post-init to spike `floorHigh` and over-extract the reserve. In the PoC the spike collapses from ~99× to 0 and extraction from 294.3 → 2.49 QUOTE (fair value). For a fixed-supply token the snapshot equals the live value, so the canonical case is unchanged.

**Solvency (hard invariant):** the hook's realized ERC-6909 quote-claim balance always equals `reserveQuote + Σ programmableFeeOwed`. `topUp ≤ reserveQuote ≤ balance`, so the hook can never pay more than it holds; a short reserve is partially honored, never reverted. Proven by `testFuzz_08_solvencyInvariant`, `AntifragileInvariants.invariant_solvency`, and the mainnet-fork test.

## Product integration plan

| Surface | State | Notes |
| --- | --- | --- |
| UI / Quote / Trade / Claim | Not implemented (planned) | Future maintainer-owned handoff; no product code shipped in this prototype. |
| Indexer / Monitoring | Specified boundary | `ProgrammableFeeCollected`, `FloorRatcheted`, `FloorToppedUp`, `ProgrammableFeeClaimed` reconstruct reserve + liabilities; the getters `reserveQuote()` / `programmableFeeOwed()` reconcile against the confirmed ERC-6909 balance (`balance == reserveQuote + owed`). Finality depth 12; withhold on any mismatch. |
| Routing / listing | Not submitted | `routingMode = not-planned`; external providers remain behind their own review gates. |

`submission.json.integration.platformHandoff` mirrors this: `reviewStatus = not-requested`, `maintainerReviewRequired = true`, `selfApproval = false`, `availabilityClaimed = false`.

## Fact provenance

- **evidence-backed** — 88 tests green (85 local + 3 mainnet-fork); permission mask `0x10cc`; Slither 12 src findings all FP/info; PoolManager runtime hash `0x785f…ce1293` observed + Sourcify-matched; hook runtime size 8,004 bytes.
- **agent-derived** — the quadrant predicate table; the `effective/platform/project` split arithmetic; the solvency identity.
- **builder-stated** — the product intent (self-funded floor + mandatory fee), the immutable owner address, the MIT license.

## Open decisions

- Should the launch tooling enforce atomic pool initialization in-contract (factory) to remove the finding-4.1 binding front-run entirely, or keep it a documented deployment requirement?
- For a future multi-pool product, should each launch deploy its own single-pool hook (current model) or should a shared-hook variant with per-pool namespacing be reviewed separately?

This is a public, non-confidential proposal. `PROTOTYPE_READY` is local builder evidence only; it is not acceptance, an audit, deployment, routing approval, or availability. Independent economic/security review, product integration, deployment, runtime matching, and monitoring each require separate maintainer-owned evidence.
