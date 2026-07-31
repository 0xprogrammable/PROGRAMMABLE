# First Mover test plan

## Unit behavior

- Symbol normalization folds ASCII case and distinguishes different symbols. Complete:
  `test_symbolNormalizationFoldsCase`.
- `registerPool` rejects a non-creator registrar. Complete: `test_rejectsNonCreatorRegistrar`.
  Outstanding: a token whose `symbol()` reverts, an empty symbol, a symbol over 32 bytes.
- Claim lifecycle states resolve correctly from a record and a block height. Covered indirectly through the
  integration tests; a dedicated pure-library suite is outstanding.

## Integration lifecycle

- First registration takes a provisional claim and is not yet original. Complete:
  `test_firstRegistrationTakesAProvisionalClaim`.
- A claim confirms once the pool accrues the threshold in creator fees. Complete:
  `test_claimIsEarnedByTradingNotByRegistering`.
- A confirmed claim never lapses. Complete: `test_confirmedClaimNeverLapses`.
- An unearned claim lapses after the grace window and the ticker becomes takeable. Complete:
  `test_unearnedClaimLapsesAndFreesTheTicker`.
- A second launch of a live ticker is recorded as a derivative rather than rejected, with case folding applied.
  Complete: `test_copyIsRecordedAsDerivativeNotRejected`.
- Unrelated symbols do not collide. Complete: `test_differentSymbolsDoNotCollide`.
- Tribute routes to the original's accrued balance, and the derivative keeps the remainder. Complete:
  `test_tributeRoutesToTheOriginalsVault`.
- The launcher share, builder share and total charged are identical on a derivative. Complete:
  `test_tributeIsInvisibleToTheTrader`.
- No tribute flows while the original's claim is provisional, or after it lapses. Complete:
  `test_noTributeWhileTheOriginalIsOnlyProvisional`, `test_tributeStopsIfTheOriginalsClaimLapses`.
- A derivative cannot confirm the ticker however much it trades. Complete: `test_derivativeCannotTakeTheTicker`.
- Hook callbacks reject callers other than the PoolManager. Complete: `test_onlyPoolManagerCanCallHookCallbacks`.
- Only the builder beneficiary can claim the builder share. Complete: `test_onlyBuilderCanClaimTheBuilderShare`.
- Outstanding: exact-output and sell-direction fee assertions; a chain of three or more copies of one ticker;
  tribute accruing across a claim on the original's vault.

## Properties

- Outstanding: stateful invariants over a sequence of launches and swaps, asserting that a confirmed claim is never
  reassigned, that tribute plus retained always equals the creator fee, and that the launcher and builder shares are
  invariant to derivative status.
- Outstanding: fuzzed symbol normalization over arbitrary byte strings.

## Release evidence

- The suite runs against the revisions installed by `scripts/bootstrap-deps.sh`. Pinning them is a release gate.
- A mainnet-fork lifecycle is a release gate and is not yet included.
- Runtime hashes and source verification are recorded after deployment. Not applicable at `design` status.
