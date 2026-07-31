# Shards test plan

Suites live in [`test/`](../../test/), and each one owns a named area so no coverage is claimed twice.

| Suite | Owns |
| --- | --- |
| [`ShardTokenV1.t.sol`](../../test/ShardTokenV1.t.sol) | Fixed supply, no mint, no burn, 1 SHARD == 1 NFT |
| [`ShardNFTV1.t.sol`](../../test/ShardNFTV1.t.sol) | Archive inventory, seeds, transfer guards, `tokenURI` |
| [`GeometricRendererV1.t.sol`](../../test/GeometricRendererV1.t.sol) | Fully on-chain SVG, determinism, flat traits |
| [`ShardScaffoldV1.t.sol`](../../test/ShardScaffoldV1.t.sol) | Pinned-dependency import and type surface |
| [`ShardHookLiquidityV1.t.sol`](../../test/ShardHookLiquidityV1.t.sol) | Permissions, `initialise`, seeding, the lock |
| [`ShardHookMarketV1.t.sol`](../../test/ShardHookMarketV1.t.sol) | `buyNFT`/`sellNFT`, inclusive-fee basis, slippage, deadlines |
| [`ShardHookBatchV1.t.sol`](../../test/ShardHookBatchV1.t.sol) | `buyMany`, `buyMax`, `sellMany`, `redeemMany`, `MAX_BATCH` |
| [`ShardHookExhaustionV1.t.sol`](../../test/ShardHookExhaustionV1.t.sol) | Short fills, thin curve, `buyMax` fee basis |
| [`ShardHookFeesV1.t.sol`](../../test/ShardHookFeesV1.t.sol) | Third-party fee capture across all four quadrants, the swap cap |
| [`ShardHookAttackV1.t.sol`](../../test/ShardHookAttackV1.t.sol) | Adversarial paths: withdrawal, front-running, reentrancy, fee snipes |
| [`ShardFeeSplitV1.t.sol`](../../test/ShardFeeSplitV1.t.sol) | The 80/10/10 split, both claim paths, recipient handover |
| [`ShardFeeDistributorV1.t.sol`](../../test/ShardFeeDistributorV1.t.sol) | Accumulator, escrow, dust, same-block guard, settlement paths |
| [`ShardFeeDonationV1.t.sol`](../../test/ShardFeeDonationV1.t.sol) | `donate()`, the forwarder, donations bypassing the split |
| [`ShardLaunchSequenceV1.t.sol`](../../test/ShardLaunchSequenceV1.t.sol) | Deploy → `setNFT` → `initialise` ordering and its failure modes |
| [`ShardSwapRouterV1.t.sol`](../../test/ShardSwapRouterV1.t.sol) | Third-party routing, refunds, approvals, wrong-pool rejection |
| [`invariant/ShardV1.t.sol`](../../test/invariant/ShardV1.t.sol) | Stateful backing, custody, conservation and lock invariants |

## Unit behavior

- **Validate every parameter boundary and revert path.** Constructor tick ordering and spacing
  (`InvalidTickRange`), zero addresses (`ZeroAddress`), wrong seed balance (`WrongShardBalance`), start price
  below `tickUpper` (`InvalidStartPrice`), foreign pool key or wrong start price
  (`test_beforeInitializeRejectsForeignPool`, `test_frontRunAtDifferentPriceReverts`,
  `test_startPriceMustBeAtOrAboveTickUpper` in `ShardHookLiquidityV1.t.sol`), batch bounds
  (`test_buyManyRevertsAboveCap`, `test_buyManyRevertsOnZeroCount`, `test_buyMaxRevertsOnZeroValue` in
  `ShardHookBatchV1.t.sol`), slippage and deadline bounds (`test_buyNftRespectsMaxEthIn`,
  `test_deadlineIsEnforced`, `test_buyNftRevertsOnInsufficientEth` in `ShardHookMarketV1.t.sol`), NFT range and
  deposit guards (`test_outOfRangeTokenUriReverts`, `test_directTransferFromToArchiveReverts`,
  `test_directTransferFromToHookReverts` in `ShardNFTV1.t.sol`), and `PartialFillNotSupported` on a short fill
  (`test_buyNftRevertsRatherThanMintingOnAShortFill` in `ShardHookExhaustionV1.t.sol`). `SwapTooLarge` is pinned
  one wei either side of the cap by `test_swapOneWeiOverTheCapReverts`, `test_sellOneWeiOverTheCapReverts` and
  `test_exactInputBuyOverTheCapReverts` in `ShardHookFeesV1.t.sol`, which assert the revert selector rather than
  merely that the call reverted. `ShardSwapRouterV1.t.sol` covers the router's own bounds
  (`test_respectsMinAmountOut`, `test_respectsDeadline`, `test_revertsOnZeroAmount`,
  `test_shardForEthRequiresApproval`, `test_rejectsPlainEthTransfers`).
- **Test fee arithmetic and rounding with exact examples.** `ShardFeeSplitV1.t.sol` pins the split at exact
  tenths (`test_split_exactTenthsOnRoundAmount`), proves rounding dust favours holders
  (`test_split_roundingDustFavorsHolders`), proves a dust-sized fee goes entirely to holders
  (`test_split_dustFeeGoesEntirelyToHolders`) and that donations are never split
  (`test_donationIsNotSplit`). The inclusive basis is pinned by `test_feeBasisIsInclusiveOnBuy`,
  `test_buyNftAndSwapThenRedeemCostTheSame` and `test_buyThenSellRoundTripCostsAboutTwoPercent` in
  `ShardHookMarketV1.t.sol`, and by `test_buyManyChargesOnePercentInclusiveOnce`,
  `test_buyMaxChargesOnePercentInclusiveOnce` and `test_buyMaxChargesOnlyOnWhatTheCurveConsumed`.
- **Test each authorized and unauthorized caller.** `test_claimBuilderFees_revertsForStranger`,
  `test_claimLauncherFees_revertsForStranger`, `test_setBuilderFeeRecipient_revertsForStranger`,
  `test_setBuilderFeeRecipient_revertsOnZero`, `test_constructor_rejectsZeroRecipients` in
  `ShardFeeSplitV1.t.sol`; `test_initialiseOnlyDeployer`, `test_initialiseIsOneShot` in
  `ShardHookLiquidityV1.t.sol`; `test_onlyTheDeployerCanRunTheLaunch`,
  `test_setNFTIsOneShotSoABlindRerunWouldBrickTheLaunch` and `test_launchIsOneShotSoItCannotBeReplayed` in
  `ShardLaunchSequenceV1.t.sol`; `test_ATTACK_cannotHijackSetNft` in `ShardHookAttackV1.t.sol`. `NotHook` is
  covered by `test_onlyHookCanAcquire` and `test_onlyHookCanRelease` in `ShardNFTV1.t.sol`, `NotNFT` and
  `NotPoolManager` by `ShardHookAttackV1.t.sol`, and `NotPoolManager` again by
  `test_unlockCallbackOnlyPoolManager` in `ShardHookLiquidityV1.t.sol` and `ShardSwapRouterV1.t.sol`.

## Integration lifecycle

- **Create the token and pool.** `test_initialiseSeedsAllTenThousandShards`, `test_initialiseRecordsSeedDust`,
  `test_initialiseRequiresNoEth`, `test_initialiseSurvivesFrontRunAtSamePrice` and
  `test_initialiseRerevertsNonAlreadyInitialisedErrors` in `ShardHookLiquidityV1.t.sol` cover the whole
  deploy-to-seeded path, including the front-run case. `ShardLaunchSequenceV1.t.sol` runs the launch as a
  creator would (`test_threeStepLaunchMintsTheFirstFiftyIds`, `test_buyingIsClosedUntilInitialise`,
  `test_launchFeeSplitsWithoutChangingWhatTheBuyerPays`) and pins the shipped tick configurations
  (`test_productionTicksStillLaunchAtAboutAThousandthOfAnEth`,
  `test_cheapCurveIsTheProductionCurveShiftedByAConstant`).
- **Execute both swap directions and exact input/output modes.** `_buySwap` (exact output),
  `_buyExactOutSwap`, `_buyExactInSwap` and `_sellSwap` are exercised through `buyNFT`, `buyMany`, `buyMax`,
  `sellNFT` and `sellMany` in `ShardHookMarketV1.t.sol` and `ShardHookBatchV1.t.sol`.
  `test_priceRisesAsSupplyIsBought` and `test_buyingMovesTickDown` pin the curve direction. All four direction ×
  exactness quadrants of a third-party swap are covered one per test by
  `test_feeIsExactlyOnePercent_zeroForOne_exactIn`, `..._zeroForOne_exactOut`, `..._oneForZero_exactIn` and
  `..._oneForZero_exactOut` in `ShardHookFeesV1.t.sol`, alongside
  `test_feeIsAlwaysDenominatedInEth`, `test_swapperReceivesExpectedAmountAfterFee` and
  `test_firstSwapSucceedsOnFreshPoolManager`, which covers the ERC-6909 claim path on a manager holding no
  native liquidity. Router-level routing is covered by `test_swapEthForShardDeliversShard` and
  `test_swapShardForEthDeliversEth` in `ShardSwapRouterV1.t.sol`.
- **Exercise fee accrual, custody and claims.** `test_poolSwapFeeIsSplit`, `test_buyNFTFeeIsSplit`,
  `test_claimBuilderFees_paysAndZeroes`, `test_claimLauncherFees_paysAndZeroes`,
  `test_holderClaimLeavesCutsIntact` and `test_setBuilderFeeRecipient_transfersClaimRights` in
  `ShardFeeSplitV1.t.sol`; `test_buyNftCannotSpendHolderFeeEth` in `ShardHookMarketV1.t.sol`;
  `test_ATTACK_sameBlockFeeSnipeEarnsNothing`, `test_ATTACK_transferInAcquisitionBlockEarnsNothing` and
  `test_ATTACK_cannotClaimTwice` in `ShardHookAttackV1.t.sol`. Escrow, release, the scaled dust carry, the
  same-block guard and settlement on transfer and sale are owned by `ShardFeeDistributorV1.t.sol`
  (`test_feesWithNoHoldersGoToEscrow`, `test_escrowFoldsInOnFirstDistributionWithHolders`,
  `test_evenSplitAcrossHolders`, `test_sameBlockAcquisitionEarnsNothing`, `test_holderEarnsFromNextBlockOnward`,
  `test_dustIsCarriedNotLost`, `test_settlePreservesFractionalRemainder`,
  `test_releaseSettlesToOutgoingOwner`). Donation routing is owned by `ShardFeeDonationV1.t.sol`
  (`test_donateIsNeverSplitWithTheBeneficiaries`, `test_donateEscrowsWhenNothingCirculates`,
  `test_donateLeavesTheBackingInvariantIntact`, `test_flushPushesEverythingIntoTheFeePool`).
  `test_hookClaimBalancePlusEthCoversFeesTaken` in `ShardHookFeesV1.t.sol` pins the custody bound.
- **Cover external-call and recipient failures.** Reentrancy from a contract counterparty is covered by
  `test_ATTACK_reentrantBuyDuringUnlockFails`, `test_ATTACK_reentrantSellDuringUnlockFails`,
  `test_ATTACK_reentrantClaimFails` and `test_ATTACK_reentrantTransferDuringReleasingFails` in
  `ShardHookAttackV1.t.sol`; the direct-deposit guard by `test_ATTACK_directNftTransferStrandsNothing`; the
  absence of a liquidity exit by `test_noWithdrawalFunctionExists`; and ERC-6909 claim theft by
  `test_ATTACK_cannotStealErc6909FeeClaims`. **Gap:** no suite yet asserts `EthTransferFailed` for a
  reverting recipient on a buy refund, a sell payout, a holder claim, `claimBuilderFees` or
  `claimLauncherFees`. That coverage is required before release.

## Properties

- **Add stateful invariants for accounting and immutable configuration.** `invariant/ShardV1.t.sol` drives a
  random mix of buys, batch buys, sells, redeems, third-party swaps, transfers, donations and claims through a
  handler and holds: backing (`invariant_shardBackingMatchesNftCirculating`, `invariant_shardSupplyIsConserved`,
  `invariant_buyMaxNeverReturnsAWholeShard`, `invariant_earningSetMatchesBackingSet`); supply and inventory
  (`invariant_circulatingNeverExceedsMaxSupply`, `invariant_poolHeldPlusCirculatingEqualsTenThousand`,
  `invariant_lowestAvailableIdIsActuallyAvailable`); custody and conservation
  (`invariant_hookAssetsCoverAllClaims`, `invariant_claimsNeverExceedFeesTaken`,
  `invariant_builderAndLauncherCutsMatch`, `invariant_builderFeesAreAlwaysClaimable`,
  `invariant_accumulatorNeverDecreases`, `invariant_dustStaysSubWei`, `invariant_dustNeverExceedsMaxSupply`);
  and the lock (`invariant_liquidityPositionIsNeverReduced`, `invariant_bandPositionIsNeverReduced`,
  `invariant_bandStaysDenserThanTheFullRange`).
- **Fuzz all bounded parameters and native/token amount ranges.** `testFuzz_split_conserves` in
  `ShardFeeSplitV1.t.sol` fuzzes the split over fee amounts bounded to `[0, 1_000_000 ether]`;
  `testFuzz_buyMaxNeverOverspendsMsgValue` in `ShardHookExhaustionV1.t.sol` fuzzes the exact-input buy against
  `msg.value`; `testFuzz_neverReverts` in `GeometricRendererV1.t.sol` fuzzes the seed space;
  `testFuzz_feeNeverExceedsOnePercent` and `testFuzz_poolIsNeverLeftWithNegativeDelta` in
  `ShardHookFeesV1.t.sol` fuzz third-party swap sizes, and `testFuzz_theSplitConservesEveryFee` in the same
  suite fuzzes the split over real swap flow; `testFuzz_totalDistributedIsConserved` in
  `ShardFeeDistributorV1.t.sol` fuzzes the accumulator; `testFuzz_invariantHoldsUnderRandomSequence` in
  `ShardHookMarketV1.t.sol` fuzzes market sequences; `testFuzz_lowestAvailableIdIsAlwaysUnheld` in
  `ShardNFTV1.t.sol` fuzzes the inventory; and `testFuzz_swapNeverLeavesRouterHoldingFunds` in
  `ShardSwapRouterV1.t.sol` fuzzes the router. Fuzz runs are 1,000 by default and 10,000
  under the `ci` profile; invariant runs are 256 × 64 by default and 1,000 × 128 under `ci`.
- **Test ordering, oracle and liquidity assumptions when applicable.** There is no oracle. Ordering coverage is
  the same-block accrual guard, the front-run-tolerant `initialise`, the free-reroll asymmetry
  (`test_ATTACK_cannotRerollArtForFree`, `test_walletTransferDoesNotChangeSeed`) and the per-swap size cap,
  including its deliberate non-application to the hook's own batches
  (`test_hookOwnBatchIsNotBoundByTheSwapCap`). Sandwich bounds are covered by
  `test_ATTACK_sandwichBuyNftIsBoundedByMaxEthIn`, `test_buyNftRespectsMaxEthIn` and
  `test_buyManyRespectsMaxEthIn`. Liquidity assumptions are covered by
  `test_ATTACK_cannotWithdrawLiquidity` and by the exhaustion suite, which drives the curve thin enough to
  exercise the short-fill guards.

## Release evidence

- **Run against pinned dependencies.** solc `0.8.26`, `cancun`, optimizer on at 1,000 runs, `bytecode_hash`
  none, from [`foundry.toml`](../../foundry.toml). Uniswap v4 core and periphery, OpenZeppelin contracts,
  OpenZeppelin uniswap-hooks and Solady revisions are recorded in
  [`spec/shards-v1.json`](../../spec/shards-v1.json). `ShardScaffoldV1.t.sol` pins the import and type surface
  those libraries expose, so a dependency bump that moves a path or a constant fails the build rather than the
  economics.
- **Add a mainnet-fork lifecycle before Ethereum release.** A release gate. The whole lifecycle — deploy, wire,
  initialise, third-party swap, hook-market buy and sell, batch paths, accrual, and all three claim paths — must
  run against the pinned Uniswap v4 `PoolManager` on an Ethereum fork, in the style of
  [`test/ClassicV3MainnetFork.t.sol`](../../test/ClassicV3MainnetFork.t.sol). The fork run must also confirm the
  hook mines to an address whose low bits match `getHookPermissions()`
  (`test_hookPermissionsMatchAddressBits`).
- **Record runtime code hashes and source verification after deployment.** For every deployed contract, publish
  the deployment transaction, the runtime code hash and the explorer verification state, and record the hook's
  runtime size against the 24,576-byte EIP-170 limit — 24,388 bytes at the pinned settings, 188 bytes of
  headroom, which is small enough that any compiler or dependency change must be re-measured before release.
