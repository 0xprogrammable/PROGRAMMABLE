# Shards V1 security properties

This is a design-stage property record for exact source, not an audit. Shards has no production deployment and remains unavailable.

## P1. Launch is atomic and rollback is complete

`ShardLaunchFactoryV1.launch` validates the supplied hook bytes and permission bits, deploys the token and hook with CREATE2, deploys the NFT, binds both directions, transfers the full fixed supply, and initialises the pool in one transaction. Failure at any later step rolls back token, hook, NFT, configuration mapping, event, and factory balances.

Evidence: `test_failureAfterDeploymentsRollsBackTokenHookNftMappingAndEvent`, `test_duplicateTokenSaltForSameBuilderRevertsWithoutChangingFirstLaunch`, and `test_factoryHoldsZeroShardAfterSuccess` in `test/ShardLaunchFactoryV1.t.sol`.

## P2. Hook and NFT wiring is exact

The hook accepts an NFT only if a bounded `staticcall` to `hook()` returns exactly one ABI word equal to the hook. Missing, malformed, reverting, zero, wrong-hook, unauthorized, and repeat bindings revert. The NFT independently stores its immutable hook.

Evidence: all `ShardWiringV1Test` tests, especially `test_correctNftBackReferenceBindsAndMarketRemainsUsable`, `test_setNftRejectsNftBoundToAnotherValidHook`, and the missing/malformed getter cases.

## P3. Configuration evidence binds every launch input

The stored and emitted configuration hash binds chain id, factory, PoolManager, shared renderer, launcher and builder recipients, CREATE2-predicted token, hook and NFT, ticks, start price, raw and effective token salts, hook salt, and actual hook creation-code hash. Unrelated launches cannot change any predicted address.

Evidence: `test_launchStoresExactConfigurationHashAndEmitsExactEvent`, deterministic prediction tests in `ShardLaunchFactoryV1.t.sol`, and `test_factoryPredictionAndConfigurationEvidenceAreReproducible` on the pinned Mainnet fork.

## P4. Hook permissions and callback authentication are exact

The predicted hook's low 14 bits must equal the five permissions returned by `getHookPermissions`: `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta`. The hook rejects foreign pool keys, wrong start prices, non-PoolManager unlock callbacks, and swaps before initialization.

Evidence: `test_launchRejectsHookSaltWithWrongPermissionBitsBeforeDeployment`, `test_hookPermissionsMatchAddressBits`, `test_beforeInitializeRejectsForeignPool`, and both router/hook `test_unlockCallbackOnlyPoolManager` tests.

## P5. Every circulating NFT is backed

At all reachable states:

```text
shard.balanceOf(hook) == nft.circulatingSupply() * 1e18 + hook.seedDust()
```

The fixed SHARD supply is conserved across the PoolManager, hook, NFT, handler, and actors. Partial fills revert instead of creating unbacked art.

Evidence: `invariant_shardBackingMatchesNftCirculating`, `invariant_shardSupplyIsConserved`, the market/batch backing tests, and `ShardHookExhaustionV1Test`.

## P6. Both seeded liquidity positions are permanent

The only production `modifyLiquidity` path adds positive liquidity during initialization. There is no removal, rescue, owner, or upgrade path. Both the full-range and concentrated-band positions never decrease.

Evidence: `invariant_liquidityPositionIsNeverReduced`, `invariant_bandPositionIsNeverReduced`, `invariant_bandStaysDenserThanTheFullRange`, and `test_ATTACK_cannotWithdrawLiquidity`.

## P7. Fee accounting is conserved and solvent

Each swap fee is native ETH and splits exactly into builder, launcher, and holder amounts; rounding favors holders. Real ETH plus PoolManager native claims covers holder, builder, launcher, and escrow liabilities. Donations bypass the beneficiary split.

Evidence: `invariant_hookAssetsCoverAllClaims`, `invariant_builderAndLauncherCutsMatch`, `testFuzz_theSplitConservesEveryFee`, `test_hookClaimBalancePlusEthCoversFeesTaken`, and `ShardFeeDonationV1Test`.

## P8. New holders cannot earn their acquisition-block fee

A piece joins the earning set only after its acquisition block. Transfer and release settle the outgoing owner before membership changes. Same-block buy/transfer/sell strategies cannot capture their own fee.

Evidence: `test_sameBlockAcquisitionEarnsNothing`, `test_transferInAcquisitionBlockEarnsNothing`, `test_ATTACK_sameBlockFeeSnipeEarnsNothing`, `invariant_earningSetMatchesBackingSet`, and accumulator invariants.

## P9. Token and ETH transfer failures revert

Every production ERC20 transfer/transferFrom whose result affects accounting checks the returned boolean. ETH refunds, payouts, and claims check call success and are reentrancy guarded.

Evidence: `ShardCheckedTransferV1Test` covers settlement transfer, `buyMax` leftover transfer, redeem transferFrom, and router transferFrom; the factory rollback test covers its full-supply transfer. `ShardFeeSplitV1Test` covers rejecting recipients and rollback for buy refunds, sell payouts, holder claims, builder claims, and launcher claims. Reentrant refund, sell, claim, and NFT-release paths are exercised in `ShardHookAttackV1Test`.

## P10. Launch powers are authorized and consumed

Only the factory is the production hook deployer. Its `setNFT` and `initialise` powers are consumed during the atomic transaction. Neither the factory nor an external account can replay them, and the factory retains no SHARD.

Evidence: `test_hookDeployerIsFactoryAndBothOneShotPowersAreConsumed`, factory-deployer assertions in migrated production suites, and focused manual authorization tests in `ShardLaunchSequenceV1.t.sol`.

## P11. Partial fills and oversized swaps fail closed

The hook rejects partial fills where the precomputed ETH fee would no longer match execution and caps each third-party swap to 50 SHARD of movement. Hook-market methods enforce deadlines, count bounds, and slippage bounds.

Evidence: `test_partialFillIsRejectedNotOvercharged`, `test_partialFillIsRejectedOnExactOutputEthToo`, boundary tests in `ShardHookFeesV1.t.sol`, and the shallow-range exhaustion suite.

## P12. Public salts do not grant role redirection

Launch inputs and mined salts are public. An observer can submit an exact configuration first and thereby sponsor the same launch. The effective token salt commits to the raw token salt, hook salt, ticks, start price, and builder recipient. Changing any committed value changes the token prediction, so a different configuration cannot consume the intended token address. The NFT is CREATE2-predicted from the hook and shared renderer, so unrelated launches cannot race the NFT or configuration hash.

Evidence: `test_effectiveTokenSaltBindsHookSaltAndEveryLaunchParameter`, `test_sameRawSaltAndBuilderWithDifferentConfigurationCannotConsumeIntendedToken`, `test_nftPredictionIsStableAcrossUnrelatedLaunches`, deterministic-miner tests, and duplicate configuration tests.

## P13. Art seeds are non-secure Ethereum inputs

Seeds mix the preceding block hash, timestamp, recipient, and an acquisition nonce. They support deterministic on-chain rendering and practical per-acquisition variation, not unpredictability. Block producers and callers can observe or influence inputs.

Evidence: `test_ethereumArtSeedDoesNotDependOnArbitrumPrecompileAddress`, renderer determinism/difference tests, and `test_ethereumSeedInputsProduceDistinctRenderedArt` on the pinned Mainnet fork.

## Remaining release gates

1. Maintainer re-review of the exact final source.
2. Independent security-review status recorded for that source.
3. User-authorized Ethereum deployment and exact source verification.
4. Deployment, runtime, and release evidence published.
5. Bytecode and lifecycle checks passing for the deployed addresses.
6. Production interface configured for that exact release.
