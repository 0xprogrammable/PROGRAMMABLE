# Security properties

This document defines the properties expected from `PlatformFeeHookV1`, `BoundedDynamicFeeHookV1`, their permissionless factories, `LockedPositionFeeForwarderFactoryV1` and `DirectLiquidityLauncherV1`. It is a testable engineering specification, not an audit certificate.

## Trust boundary

Each hook trusts the immutable Uniswap v4 `PoolManager` supplied at deployment. It accepts pool initialization only when the `PoolManager` reports its immutable launcher or LBP strategy as the sender. It accepts swap callbacks only from that `PoolManager` and only for its precomputed `PoolId`.

Neither hook has an owner, proxy, pause function or mutable parameter. The bounded dynamic hook stores only its latest reference block, reference tick and installed LP fee. Its fee formula and bounds remain fixed in bytecode. Both factories are permissionless and have no administrator. A factory deployment proves provenance, not production approval.

Initial LP NFTs are assigned to the official Uniswap `PositionFeesForwarder`, deployed through Launcher’s deterministic factory. The forwarder has the zero address as operator and `type(uint256).max` as its approval block. Its immutable fee recipient is the launch creator. This gives the creator the LP fee economics without a practical position-transfer or liquidity-removal path.

The direct launcher trusts six immutable dependencies fixed at its deployment. Its constructor checks that every dependency has code, that PositionManager points to the selected PoolManager and that the forwarder factory points to the selected PositionManager. The Sepolia deployment script additionally checks the runtime-code hashes of the official Uniswap dependencies.

The existing-token entry point accepts only a UERC20 whose CREATE2 address can be reconstructed through that configured token factory. It also requires the caller to equal the creator recorded in the token at deployment. This proves the selected factory origin and fixed UERC20 implementation; it does not admit arbitrary ERC-20 contracts.

The standard auction path calls the official LiquidityLauncher directly from the creator wallet. Launcher’s server derives the token, auction, pool, hook and position-recipient addresses from the pinned SDK and deployment snapshot. It enables the promise that all auction proceeds fund the pool only when the CCA factory’s immutable protocol fee controller is the zero address.

## Core properties

| ID | Property | Evidence |
| --- | --- | --- |
| AUTH-01 | Only the configured PoolManager can invoke hook callbacks and `unlockCallback`. | `BaseHook.onlyPoolManager`; `test_onlyPoolManagerCanCallUnlockCallback` |
| AUTH-02 | Only the immutable launch strategy may initialize the pool. | `_beforeInitialize`; `test_revertsWhenUnauthorizedAddressInitializes` |
| POOL-01 | A hook accepts exactly one currency pair, LP fee, tick spacing and hook address. | immutable `poolId`; `test_revertsWhenInitializerUsesDifferentPoolConfiguration` |
| FEE-01 | The platform fee is fixed at 1,000 pips out of 1,000,000, or 0.10%. | `PLATFORM_FEE_PIPS`; four directional unit tests; fuzz reference test |
| FEE-02 | Fees are charged on the absolute unspecified swap amount and rounded down. | OpenZeppelin `BaseHookFee`; `testFuzz_swapFeeMatchesReference` |
| FEE-03 | Anyone may trigger redemption, but no caller can redirect proceeds. | immutable `feeRecipient`; `test_anyoneCanCollectButCannotRedirectFees` |
| FEE-04 | Both ERC-20 and native-currency claims redeem to the same immutable recipient. | full migration and post-migration swap integration test |
| FLAGS-01 | The hook address has exactly `beforeInitialize`, `afterSwap` and `afterSwapReturnDelta`. | factory mask validation; `test_permissions_areExact`; invariant suite |
| DFEE-01 | The bounded dynamic LP fee is always between 3,000 and 10,000 pips, or 0.30% and 1.00%. | `feeForTickMovement`; unit fuzz test; dynamic invariant suite |
| DFEE-02 | The first swap in a later block updates the fee from absolute reference-tick movement; further swaps in that block cannot update it again. | `referenceBlock`; prior-block and same-block unit tests; dynamic invariant handler |
| DFEE-03 | PoolManager’s installed dynamic LP fee always equals the hook’s recorded current fee. | `invariant_dynamicLpFeeIsAlwaysInstalledAndBounded` |
| DFEE-04 | The dynamic rule has no admin or external oracle and cannot alter the separate immutable 0.10% platform fee destination. | immutable constants and recipient; migration integration; collection tests |
| FLAGS-02 | The dynamic hook address has exactly `beforeInitialize`, `afterInitialize`, `beforeSwap`, `afterSwap` and `afterSwapReturnDelta`. | dynamic factory mask validation; permission unit test; invariant suite |
| FACTORY-01 | The factory deploys only a correctly mined CREATE2 address and records its configuration hash. | `deploy`; `test_factoryRejectsUnminedSalt`; provenance assertions |
| LOCK-01 | Every verified initial LP position is minted to a forwarder deployed by Launcher’s deterministic factory. | `test_deploysOfficialForwarderWithFixedLockPolicy`; migration integration assertions |
| LOCK-02 | The forwarder has no operator and cannot approve a transfer before the maximum `uint256` block. | fixed factory constructor arguments; `test_revertsBeforeMaximumTimelockBlock`; migration integration assertions |
| LOCK-03 | Permissionless LP fee collection forwards both currencies to the immutable creator without reducing liquidity. | official `PositionFeesForwarder`; bidirectional integration swaps and before/after liquidity assertion |
| LOCK-04 | Platform hook fees and creator LP fees remain separate and cannot redirect one another. | separate immutable recipients; integration balance assertions |
| IMM-01 | Authorities, pool configuration and fee parameters cannot change after construction. | immutable bytecode fields; empty hook storage layout; invariant suite |
| FLOW-01 | Token creation and distribution can execute atomically through the official launcher and UERC20 factory. | `test_atomicOfficialTokenCreationAndStrategyRegistration` |
| FLOW-02 | The official LBP strategy can migrate into the bound pool, mint a position and enable fee-bearing swaps. | `test_migrationInitializesBoundPoolAndCollectsFeeAfterSwap` |
| FLOW-03 | The official CCA factory and auction can accept a bid, finalize, graduate and migrate through LBPStrategy into the bound pool. | `test_realAuctionBidsFinalizeAndMigrateIntoBoundV4Pool` |
| FLOW-04 | A direct launch creates the token, hook, locked recipient, pool and full-range LP position atomically. | `test_launchesFixedSupplyTokenIntoLockedV4Position`; invalid-salt rollback test |
| FLOW-05 | Actual native and token liquidity never exceed the caller’s budgets; unused budgets and the remaining fixed supply return to the caller. | `testFuzz_launchAccountingNeverExceedsCreatorBudgets` |
| FLOW-06 | A matching hook or forwarder predeployed through Launcher’s permissionless factory cannot block the launch; unrecognized code is rejected. | `_deployOrReuseHook`; `_deployOrReusePositionRecipient`; mempool-griefing regression test |
| FLOW-07 | A successful direct launch leaves no launched-token balance or transaction-supplied native ETH in the launcher. | direct unit and fuzz accounting assertions |
| FLOW-08 | An existing token is accepted only when its address is reproduced by the configured UERC20Factory from its immutable identity fields. | `test_rejectsTokenFromDifferentFactory`; successful existing-token launch assertions |
| FLOW-09 | Only the creator recorded by an existing UERC20 may open its Launcher pool. | `test_rejectsCallerWhoIsNotFactoryRecordedCreator` |
| FLOW-10 | Existing-token liquidity is pulled exactly, stays within both caller budgets and leaves no token balance in the launcher. | `testFuzz_existingLaunchAccountingNeverExceedsCreatorBudgets`; invalid-input and balance assertions |
| AUCTION-01 | The standard auction fixes a four-hour, 1,200-block window with 50% of supply auctioned and 50% reserved for LP. | `auction-transaction.test.ts`; `test_realAuctionBidsFinalizeAndMigrateIntoBoundV4Pool` |
| AUCTION-02 | All settled auction proceeds reach LBPStrategy because the pinned CCA factory has no protocol fee controller. | `test_officialAuctionStackMatchesLauncherPolicy`; live preflight configuration read |
| AUCTION-03 | The minimum valuation is converted with integer Q96 math, snapped to the official CCA tick boundary and bounded by the CCA supply, price and `uint128` limits. | `buildStandardAuctionEconomics`; exact fixture and policy-drift tests |
| AUCTION-04 | The official SDK resolves exactly one atomic LiquidityLauncher multicall that creates the token and distributes the complete supply to LBPStrategy. | exact calldata decoding in `auction-transaction.test.ts` |
| AUCTION-05 | The auction cannot be prepared unless the official LBPStrategy points to the pinned PoolManager, PositionManager and CCA factory. | Mainnet snapshot test; live preflight configuration reads |
| AUCTION-06 | The official LBP strategy can register, migrate and trade a pool using the v4 dynamic-fee flag and Launcher’s bounded hook. | `test_officialAuctionMigrationInstallsAndUpdatesBoundedDynamicFee` |
| REENT-01 | The complete direct launch is protected against reentrant entry while it composes external contracts. | OpenZeppelin `ReentrancyGuardTransient`; direct integration suite |
| PRICE-01 | The initialized pool price is exactly the creator-supplied valid v4 square-root price. | returned-tick validation; `test_launchesFixedSupplyTokenIntoLockedV4Position` |
| PROV-01 | Every new-token direct launch records a chain- and contract-bound commitment to its infrastructure, budgets, actual liquidity, price and hook configuration. | `launchHashOf`; `DirectTokenLaunched`; `DirectLiquidityConfigured` |
| PROV-02 | Every existing-token launch additionally commits to its configured factory, recorded creator, identity fields and original fixed supply. | `ExistingUERC20Launched`; `ExistingUERC20LiquidityConfigured`; provenance-hash construction |
| UI-01 | Human token amounts and the opening rate are converted without JavaScript floating point arithmetic. | `launch-transaction.test.ts`; integer decimal parser and square-root price tests |
| UI-02 | The browser cannot choose the transaction target or calldata; the server derives both from the fixed ABI and deployment manifest. | `/api/launch/preflight`; typed transaction response |
| UI-03 | A wallet prompt is unavailable until runtime bytecode, launcher immutables, balances, allowance and the exact call have passed the configured preflight. | fail-closed deployment manifest; preflight route; Review state machine |

## Fuzz and invariant scope

The fixed-fee reference test covers exact-input and exact-output swaps in both directions over 1,000 generated cases per default run. The dynamic fee rule is fuzzed across its input range. Each of the new-token and existing-token direct accounting properties covers 64 generated native/token budget pairs locally and 256 in the CI profile. Each hook invariant handler performs 16,384 state-changing calls per property. The dynamic handler includes swaps, explicit block advances and permissionless collections while checking fee bounds, PoolManager state, immutable configuration, callback permissions and payout isolation.

The current fuzz range is intentionally below pathological `int128` boundaries. Boundary behavior in upstream v4 and `BaseHookFee` remains part of the external dependency review.

## Failure behavior

- An incorrect hook salt reverts before deployment.
- A duplicate position-forwarder salt and recipient pair reverts before deployment.
- A matching hook or position forwarder that was deployed first through Launcher’s factory is reused after its provenance and immutable configuration are checked.
- A zero, sentinel or non-contract PositionManager configuration reverts.
- A mismatched PoolManager/PositionManager/factory dependency set reverts in the direct launcher constructor.
- A wrong pool configuration reverts before initialization or fee collection.
- A direct callback from any address other than PoolManager reverts.
- Zero budgets, a token budget above total supply, a budget above `uint128` and an invalid initial price revert before token creation.
- An existing token from another factory, a caller other than its factory-recorded creator, a duplicate existing-token launch or a non-exact token pull reverts the complete transaction.
- A failed native or ERC-20 payout reverts the whole collection. Accrued ERC-6909 claims remain in the hook.
- Amounts below the fee’s integer precision may round to zero. This is expected and does not accumulate fractional dust.
- A stale auction schedule is replaced before transaction preparation; the wallet never receives calldata with fewer than 20 preparation blocks remaining.
- A nonzero CCA protocol fee controller, mismatched official strategy dependency, occupied auction address or initialized pool blocks auction preparation.
- A dynamic hook never accepts a static-fee PoolKey. An incorrect callback mask or unrecognized factory deployment blocks setup.
- Pool-tick movement can change the dynamic LP fee only on the first successful swap in a later block and never beyond the fixed 1.00% ceiling.

## Out of scope

The properties do not certify the Continuous Clearing Auction implementation beyond the tested path. They do not
provide formal verification of upstream contracts or guarantee market value, scanner classification, sandwich
protection or profitable price discovery. The bounded dynamic rule is not an oracle: a trader can move the pool tick
and influence the fee selected in a later block, subject to the fixed ceiling. Unbounded or externally administered
dynamic fees, arbitrary existing ERC-20s, oracle-based hooks, arbitrary third-party hooks, regulated assets, indexer
correctness and production signer custody remain out of scope. The Launcher infrastructure is deployed and
source-verified on Sepolia, but the frontend paths still lack complete signed launch, swap and fee-collection rehearsals
and an independent audit.
