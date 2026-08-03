# Threat model

Derived from the internal adversarial audit (`docs/AUDIT.md`): every plausible attack is met by either a Foundry PoC proving a real bug (fixed + regression) or a documented mitigation citing the exact invariant/line and test. Two criticals were found and fixed; one Low lifecycle griefing is accepted with rationale.

## Assets and value at risk

- **Floor reserve `reserveQuote`** — accumulated project fee slice, held as the hook's WETH ERC-6909 claims in the PoolManager. No external setter: rises only via the project fee slice in `_collect`, falls only via a below-floor top-up in `_topUpToFloor`. Never owner-withdrawable.
- **Platform liability `programmableFeeOwed[poolId][currency]`** — the accrued 10 bps, held as WETH ERC-6909 claims. Paid out only by `claimProgrammableFee` to an owner-selected destination. Keyed `(poolId, currency, owner)`; no cross-pool netting.
- **LP positions** — owned by liquidity providers; the hook enables no liquidity callbacks and cannot touch positions.
- **`FLOOR` token supply** — the launched token; its live supply is untrusted after bind and is *not* read on the swap path (only the immutable `backedSupplySnapshot` is used).
- No secrets, no offchain authority, no signing capability exist in the trust path.

**Solvency identity (asset conservation):** the hook's realized WETH ERC-6909 claim balance `== reserveQuote + Σ programmableFeeOwed` after every swap and claim. This is the master invariant; every value attack below is judged against it.

## Trust boundaries

- **Uniswap v4 PoolManager** (`0x000000000004444c5dc75cB358380D2e3dE08A90`, chain 1) — trusted execution environment. It authenticates the hook (only it may call the hook's callbacks), holds ERC-6909 claims, and settles deltas atomically. It cannot mint the hook's claims out of thin air; the hook only ever `take`s/`settle`s its own quote claims inside the PoolManager lock.
- **External router** — untrusted for value but enforces the trader's slippage/deadline against the final caller delta. The hook holds no router allowance and no `hookData` trust.
- **Launched token `FLOOR`** — untrusted ERC-20. The hook is solvent against any ERC-20 (top-up capped by `reserveQuote`); post-bind supply manipulation cannot move the floor (immutable snapshot).
- **Quote token WETH** — assumed standard, non-reentrant, non-fee-on-transfer. A FoT quote would short the owner's chosen claim destination — an owner-accepted property, not an insolvency.
- **Immutable owner** `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` — may claim the platform liability only; cannot touch the reserve, cannot pause, upgrade, or redirect via a stored recipient.
- **Deployer** — trusted to initialize the canonical pool atomically (see finding 4.1). No other privileged role exists.

## Custom hook boundary

Permission mask **`0x10cc`** — enabled: `afterInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, `afterSwapReturnDelta`. Disabled (false): `beforeInitialize`, `beforeAddLiquidity`, `afterAddLiquidity`, `beforeRemoveLiquidity`, `afterRemoveLiquidity`, `beforeDonate`, `afterDonate`, `afterAddLiquidityReturnDelta`, `afterRemoveLiquidityReturnDelta`. `getHookPermissions()` returns exactly those five; the CREATE2 address low bits equal `0x10cc`; `BaseHook`'s constructor re-validates the address-to-permissions match (`test_hookAddress_encodesMask0x10cc`, `test_getHookPermissions_exactlyFiveFlags`, finding 4.4).

Why each callback is necessary:
- **`afterInitialize`** — bind the single canonical PoolId, record `tknCurrency`, and snapshot the backed supply once. No swap/liquidity/nested call. Reverts `NotQuotePool` / `PoolAlreadyBound`.
- **`beforeSwap` + `beforeSwapReturnDelta`** — for before-quadrants (quote is specified), mint the fee as quote claims and return it as a positive specified-currency delta so v4 carves it out. Returns `IHooks.beforeSwap.selector` + delta + `0`.
- **`afterSwap` + `afterSwapReturnDelta`** — for after-quadrants (quote is unspecified), collect the fee on the executed quote read from the `BalanceDelta`; ratchet the floor; pay the exact-input-sell top-up. Returns `IHooks.afterSwap.selector` + `int128 net = feeDelta - topUp`.

Every entrypoint (`beforeSwap`, `afterSwap`, `unlockCallback`, `afterInitialize`) is `onlyPoolManager`; a non-manager caller reverts `NotPoolManager`. `sender` is the swap initiator forwarded by the PoolManager (typically a router, not the EOA) and is used only as an event field, never as an authority. No `hookData` is read. `selfCallPolicy = same-pool-swap-forbidden`: the hook issues no `poolManager.swap`, v4 no-ops callbacks on self-calls, and reentry through a nested `manager.unlock` reverts `AlreadyUnlocked`.

## Value flows and accounting

- **Fee collect (`_collect`)** — `take(quote, total, claims=true)` mints `total` quote claims to the hook (offsetting the swap delta); `programmableFeeOwed += platform`; `reserveQuote += project`; emit `ProgrammableFeeCollected`. `total = ceil(gross*effective/1e6)`, `platform = ceil(gross*1000/1e6)`, `project = total - platform` → `platform + project ≡ total` exactly (no drift).
- **Floor top-up (`_topUpToFloor`)** — `reserveQuote -= topUp` (effect) **before** `quoteCurrency.settle(..., topUp, claims=true)` (interaction) which burns `topUp` claims to produce the negative caller delta; emit `FloorToppedUp`. `topUp ≤ reserveQuote ≤ balance`.
- **Owner claim (`claimProgrammableFee`)** — `programmableFeeOwed[poolId][currency] = 0` (effect) **before** `poolManager.unlock(...)` (interaction); `unlockCallback` burns `amount` claims and `take`s the underlying to the destination (net-zero hook delta); emit `ProgrammableFeeClaimed`. CEI respected → a reentrant claim observes `amount = 0`.
- **Every-swap delta closes to zero:** the fee mint (`+total`) minus the top-up burn (`-topUp`) equals the change in `reserveQuote + Σ programmableFeeOwed`, so every PoolManager delta the hook creates reaches zero before the unlock ends. Proven by `delta-conservation` / `erc6909-liability-solvency` invariants.

ERC-6909 claims: currency-id = the WETH currency; owner = the hook; no operator delegation; liability keys `(poolId, currency)`; reserve is a single scalar (single canonical pool); dust (a direct token/claim donation) is inert — it inflates the raw balance but never `reserveQuote`/floor and is unstealable (`FeeBypassAndAccounting.test_erc6909Donation_inert_notStealable`, finding 1.5).

## Mandatory fee — bypass and theft scenarios

- **Route around the fee** (alt pool / transfer / LP fee / multi-hop) → the fee accrues only on the one bound canonical pool; hookless/alt pools and transfers never touch the hook (`test_05_onlyCanonicalPoolAccrues`, 2.1).
- **Rounding / fragmentation undercharge** → every slice ceils independently; fragmenting a swap pays more, a 1-wei swap charges ≥1 wei (`test_fragmentation_neverUndercharges`, 2.2).
- **Exact-output gross-up** → basis is executed gross across all four quadrants × both orderings; exact-out charges on executed input (`test_03_quadrants_*`, `test_04_basisIsExecutedNotRequested`, fork, 2.3).
- **Unauthorized claim / redirect / zeroing** → `claimProgrammableFee` is `msg.sender == OWNER` (immutable) only; no stored recipient; strangers revert `NotOwner` (`test_07/08/09`, `test_nonOwnerClaim_reverts_*`, `invariant_platformLiabilityClaimable`, 2.4).
- **Cross-contamination reserve ↔ liability** → a claim burns only `owed`; a top-up burns only `reserveQuote` (capped ≤ it). The two pots never cross (`OwnerReserveIsolation.*`, 2.5).
- **Cross-pool netting** → liabilities keyed by PoolId; `invariant_noCrossPoolNetting` on a two-pool deployment.

## Floor / reserve economics scenarios (the two fixed criticals)

- **1.1 — partial-fill top-up sized on requested not executed tkn (prior CRITICAL, FIXED `cd2109a`).** A tight `sqrtPriceLimitX96` partial-fills so the pool receives only dust TKN; sizing the subsidy on `|amountSpecified|` would pay for TKN never delivered and drain the shared reserve. Fix: `execTknIn = tknDelta < 0 ? uint256(-tknDelta) : 0`, read from the executed `BalanceDelta` (src ~L357-358), used in `_topUpToFloor`. Regression: `ReserveDrainRegression.*`.
- **1.2 — malicious/rebasing TKN craters `totalSupply` to spike `floorHigh` and over-extract (Medium, High-impact, FIXED via immutable snapshot).** The floor denominator is now `backedSupplySnapshot`, captured once at `_afterInitialize` (src ~L261); the live `totalSupply()` is removed from the floor path (`_backedSupply()` returns the snapshot). A `burn-anyone`/negative-rebase attacker cannot move the floor: in the PoC the ~99× spike collapses (floor 0.0598 → 0.0599, not 5.9203), extraction drops 294.3 → 2.49 QUOTE, reserve drain 294.3 → 0.82 QUOTE. Solvency + the 10 bps liability preserved. PoC: `TokenModel.test_adminBurnAnyone_mitigatedByImmutableSnapshot_noOverExtraction`, `test_burnOwnSupply_topUpBoundedByExecutedFairValue`, `test_floorImmuneToPostInitSupply_mintAndBurn`.
- **1.4 — supply inflation to grief/drain** → `floorHigh` is a monotonic max; inflation lowers the candidate but never ratchets down; a buy/above-floor sell pays no subsidy → no drain (`test_mintInflateSupply_noDrain_floorMonotonic`).
- **1.6 — stale-high floor promises more than backing** → payout is *always* additionally capped by live `reserveQuote`; a stale-high floor causes partial honor, never insolvency (`FloorHonor.test_03_partialHonor`, `test_reserveDrainToZero_leavesLiabilityFullyBacked`).

## Delta / accounting / reentrancy scenarios

- **3.1 sign/precision error across quadrants×orderings** → both fee and top-up legs land on the same unspecified-quote currency; validated against the REAL mainnet PoolManager (`test_03_quadrants_*`, `FloorHonor.*`, `AntifragileFork.*`).
- **3.2 rounding accumulation breaks solvency** → `project = total - platform` gives `platform+project ≡ total`; `balance ≡ reserve+owed` after every op (`testFuzz_08_solvencyInvariant`, `invariant_solvency`).
- **3.3 reentrancy via a hostile token `transfer`/`transferFrom`** → callbacks are `onlyPoolManager`; a nested `manager.unlock` reverts `AlreadyUnlocked` (`Reentrancy.test_reentrantToken_asTkn/asQuote_blocked`).
- **3.4 reentrancy via a malicious `totalSupply()`** → `_backedSupply()` is `view` (STATICCALL) and, post-snapshot, is never invoked on the swap path; a state-changing reentry there reverts (`ReentrancyDeeper.test_reentrantTotalSupply_cannotDrainOrDoubleSpend`, defense-in-depth).
- **3.5 reentrant double-claim during payout** → liability zeroed before the external unlock (CEI); a reentrant claim sees 0 (`ReentrancyDeeper.test_claimPayout_isCEI_liabilityZeroedBeforeInteraction`).

## Access / lifecycle / DoS scenarios

- **4.1 — binding front-run (Low, accepted-with-rationale).** Anyone can pre-bind the hook to a `(quote, attackerToken)` pool, souring the mined CREATE2 address; the attacker gains nothing (owner + reserve inert on a junk pair), and the remedy is a cheap redeploy/re-mine. **Mitigation requirement: the canonical pool MUST be initialized atomically with (or under exclusive control of) the deployer.** PoC: `BindingFrontrun.test_bindingFrontRun_bindsWrongTkn_thenRealPoolDoSed`.
- **4.2 re-bind an already-bound hook** → `_bound` guard reverts `PoolAlreadyBound` (`test_cannotRebindToDifferentTkn`, `test_initializeTwice_reverts`).
- **4.3 bind a pool without the quote currency** → reverts `NotQuotePool` (`test_nonQuotePoolNeverBinds`, `test_wrongPool_notQuotePool_reverts`).
- **4.5 reverting counterparty / reserve math / `totalSupply()`** → a reverting settlement reverts the whole swap atomically (no stuck state); a TKN whose `totalSupply()` reverts bricks only its own pool (out-of-model) and never corrupts hook state (`Reentrancy.test_revertingToken_atomicNoStuckState`, `TokenModel.test_revertingTotalSupply_bricksSwaps_noCorruption`).

## Out-of-model token assumptions

- Fee-on-transfer / deflationary-on-transfer TKN — out-of-model; TKN-side FoT changes the executed `tknDelta` only; the floor denominator is frozen; quote-side accounting keeps solvency.
- A `totalSupply()` that reverts at *bind* time → the pool never binds (fail-safe). Post-init it is never read.
- The quote (WETH) is assumed standard/non-reentrant/non-FoT; a FoT quote shorts only the owner's chosen destination (owner-accepted).

## Dependency identity

| Id | Chain / address | Binding | Failure |
| --- | --- | --- | --- |
| `v4-poolmanager` | chain 1, `0x000000000004444c5dc75cB358380D2e3dE08A90` | runtime hash `0x785f…ce1293` observed (block 25666892 + head) + Sourcify runtime+creation match; deployment record `v4-poolmanager-ethereum`; compiles vs `@uniswap/v4-core@1.0.2` | any PoolManager revert reverts the swap atomically; contributor-declared until maintainers reproduce |

No offchain dependency exists in the trust path.

## Authorities and recovery

| Capability | Controller | Mutable | Delay | User-exit impact |
| --- | --- | --- | --- | --- |
| Claim platform liability | immutable `OWNER` | no | none | none — liquidity removal and swaps are always available; claim never touches the reserve |

No admin, pause, upgrade, rescue, sweep, stored-recipient, or mutable-parameter authority exists. The floor can only rise, so an existing redemption right cannot be revoked. Incident response: the immutable hook has no lever; on a confirmed solvency mismatch, publish the affected PoolId and reconstructed reserve — code remains the only governor.

## Known limitations

- The skill/local checks do **not** prove live fee collection; that requires a deployed hook and maintainer-reproduced runtime evidence.
- The hook is **not deployed**; the fork suite validates against the real mainnet PoolManager but the hook address itself is undeployed.
- No product UI/API/indexer is implemented; those are specified boundaries only.
- `PROTOTYPE_READY` is a local decision — not acceptance, an audit, routing approval, or availability. This model is **not** described as safe or audited; independent economic/security review, deployment, verification, and monitoring are separate maintainer-owned trust decisions.
