# Ladder test plan

## Unit behavior

- `registerPool` rejects: a non-creator registrar, a vault bound to another hook or pool, a vault whose
  configuration hash does not match the factory's, descending or duplicate ticks, ticks off the pool's spacing,
  ticks outside range, zero tranches, more than five, a dwell outside `[7200, 216000]`, and a fee outside Classic's
  bounds or off its step. Covered for the schedule in `test/LadderScheduleV1.t.sol`; the hook-level paths are listed
  under Integration lifecycle.
- `_validateTaperTerms` equivalents in `LadderScheduleV1.validate`: tranche count, ascending ticks, per-tranche
  minimum share, shares totalling exactly 10,000, dwell bounds, expiry bounds. Complete.
- Fee arithmetic with exact examples: a 1.00% pool splits 0.80% creator, 0.10% builder, 0.10% Programmable on a
  known gross amount, and both fixed shares come out of the total rather than on top. Complete for the split; the
  swap-path assertion is listed under Integration lifecycle.
- Authorized and unauthorized callers for `claimCreatorFees`, `claimLauncherFees`, `claimLauncherFeesTo`,
  `claimBuilderFees`, `claimBuilderFeesTo`, `release` and `forfeit`. Outstanding.

## Integration lifecycle

- Create the token, register the pool, initialize it, and assert the anchor equals the initialization block and
  cannot be written twice. Outstanding.
- Execute both directions in exact-input and exact-output modes and assert the fee split matches
  `quoteGrossFees` and `quoteExactOutputFees` to the wei. Outstanding.
- Assert the fee path is behaviourally identical to `EthCreatorFeeHookV3` on identical swaps once the builder share
  is accounted for. Outstanding.
- Observation: a swap leaving the pool below tranche *i* stamps a breach on *i* and every tranche above it and none
  below; a swap at or above every tranche writes no breach slot. Outstanding.
- Unlock: false until the dwell elapses and true immediately after; a mid-window breach resets the clock in full; a
  pool held above a tranche for the dwell and then sold below reports false again. Complete at the schedule level in
  `test/LadderScheduleV1.t.sol`, outstanding through the hook.
- Custody: release pays exactly the tranche's share, refuses a second release of the same tranche, refuses an
  unearned one, and the final tranche pays the remaining balance. Outstanding.
- Forfeiture: reverts before expiry, succeeds after, is callable by anyone, and can only send to the burn address.
  Outstanding.
- External-call and recipient failures: a token whose `creator()` reverts, a reward vault that rejects its claim, a
  beneficiary contract that reverts on receipt. Outstanding.

## Properties

- Stateful invariants over an observation sequence, in `test/invariant/LadderScheduleInvariant.t.sol`: recorded
  breaches never decrease; the unlocked set is always a prefix of the ladder; no tranche reports unlocked while the
  pool sits below its tick; nothing unlocks before a full dwell window has passed since the anchor; the predicate
  never reverts. Complete.
- Fuzzed bounded parameters: start and end fees, tranche counts, shares, dwell lengths, tick values, anchor and
  breach heights, native amounts to 1e9 ether. Complete for the schedule; native amount ranges through the swap path
  are outstanding.
- Ordering assumptions: the schedule is a pure function of `block.number` and the pool's tick, asserted independent
  of timestamp and caller. Complete.
- Oracle assumptions: none, by construction. There is no external feed to model.
- Liquidity assumptions: the model deliberately does not constrain the depth at which a level is reached. This is
  recorded as a limitation rather than tested as a property.

## Release evidence

- Run against pinned dependencies. The pinned revisions belong in `spec/ladder.json`; the suite currently runs
  against the revisions installed by `scripts/bootstrap-deps.sh`.
- Add a mainnet-fork lifecycle before any Ethereum release, covering registration through release and forfeiture
  against the live `PoolManager`. Outstanding.
- Record runtime code hashes and source verification after deployment. Not applicable at `design` status; no Ladder
  contract is deployed.
