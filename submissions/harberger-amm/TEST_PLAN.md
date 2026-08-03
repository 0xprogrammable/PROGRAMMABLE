# Test plan

Toolchain pinned per `compatibility.lock.json` (solc 0.8.26 / cancun / optimizer 200 / bytecode_hash none;
`@openzeppelin/uniswap-hooks` 1.1.1 + `@openzeppelin/contracts` 5.5.0, `@uniswap/v4-core` 1.0.2,
`@uniswap/v4-periphery` 1.0.3, forge-std 1.9.3). Run: `forge test` (fuzz.runs 256, invariant.runs 256
depth 30). **74/74 pass, 0 failed, 0 skipped** across 11 suites (see `EVIDENCE.md`).

## Unit / library
- `HarbergerMath.t.sol` (11) — `taxOwed`, `isLiquidatable`, `accIncrement`, `pending` incl. fuzz monotonicity.
- `Shares.t.sol` (5) — pro-rata `toShares`/`toLiquidity` + fuzz round-trip.
- `HarbergerHook.t.sol` (3) — permission mask `0x1acc`, constructor wiring (tax rate, quote, feeTotalBps, OWNER).

## Custody & Harberger lifecycle
- `Custody.t.sol` (6) — custody gate blocks non-hook adds; deposit mints pro-rata claims; withdraw round-trip;
  refund; `_assertSolvent` (`totalLiquidity == real v4 position`, `Σ shares == totalShares`, no raw ERC-20).
- `Tax.t.sol` (8) — pre-paid deposit → reward-per-share; harvest pays; topUp; liquidatable predicate;
  **`testFuzz_solvency` (256 runs)**: `quote balance >= quoteTaxReserve == Σ taxDeposit + Σ pending`.
- `Buyout.t.sol` (8) — buyout transfers ownership + reprices; seller receives price + reward + leftover;
  price=0 free seize; new owner can withdraw / old cannot; guards; **fuzz buyout solvency (256)**.
- `Liquidation.t.sol` (8) — share-burn redistribution (survivor redeemable strictly rises, `totalLiquidity`
  unchanged); EXACT forfeiter payout; permissionless; final-tax settle; guards; **fuzz solvency (256)**.

## Mandatory Programmable fee (`programmable-volume-fee-v1`)
- `Fee.t.sol` (13) — rate levels + platform-always-10bps; non-additive split; **all four swap quadrants ×
  quote=currency0 AND currency1**; basis = EXECUTED gross (partial-fill); only-canonical-pool-accrues;
  `onlyPoolManager` entry points; owner-only claim to arbitrary destination / non-owner reverts / zero-dest
  reverts; solvency + no cross-pool netting; collection & claim events reconcile; fuzz fee split.

## Parameter hardening
- `ParamsHarden.t.sol` (9) — `minSelfPrice` floor (deposit + buyout revert below floor / accept at floor /
  disabled at 0) and `buyoutCooldown` (blocks early / resets on buyout / disabled at 0); `lastAcquiredTs`
  wiring; fuzz floor + fuzz cooldown with exact thresholds.

## Adversarial & invariants
- `test/audit/Reentrancy.t.sol` (1) — a malicious/ERC-777 QUOTE token re-entering `withdraw` during its own
  payout is REJECTED by the `nonReentrant` guard; the attacker receives only its single legitimate payout,
  no drain, baseline LP reserve intact (proves the CRITICAL finding in `THREAT_MODEL.md` is closed).
- `test/invariant/HarbergerInvariant.t.sol` (2) — stateful invariants over a 4-actor random interleaving of
  deposit/withdraw/buyout/liquidate/harvest/topUp/poke/warp: (a) reserve solvent
  (`quote balance >= quoteTaxReserve`) and (b) custody synced (`totalLiquidity == real v4 position`).

## Out of scope (maintainer-owned)
Independent security review, deployment, source verification, runtime matching, and any off-chain product
surface remain future maintainer-owned work; local tests prove only the declared rules for this revision.
