# Security properties

This document defines the properties expected from `PlatformFeeHookV1`, `PlatformFeeHookFactoryV1` and `LockedPositionFeeForwarderFactoryV1`. It is a testable engineering specification, not an audit certificate.

## Trust boundary

The hook trusts the immutable Uniswap v4 `PoolManager` supplied at deployment. It accepts pool initialization only when the `PoolManager` reports the immutable LBP strategy as the sender. It accepts swap callbacks only from that `PoolManager` and only for its precomputed `PoolId`.

The hook has no owner, proxy, pause function or mutable parameter. The factory is permissionless and has no administrator. A factory deployment proves provenance, not production approval.

Initial LP NFTs are assigned to the official Uniswap `PositionFeesForwarder`, deployed through Launcher’s deterministic factory. The forwarder has the zero address as operator and `type(uint256).max` as its approval block. Its immutable fee recipient is the launch creator. This gives the creator the LP fee economics without a practical position-transfer or liquidity-removal path.

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
| FACTORY-01 | The factory deploys only a correctly mined CREATE2 address and records its configuration hash. | `deploy`; `test_factoryRejectsUnminedSalt`; provenance assertions |
| LOCK-01 | Every verified initial LP position is minted to a forwarder deployed by Launcher’s deterministic factory. | `test_deploysOfficialForwarderWithFixedLockPolicy`; migration integration assertions |
| LOCK-02 | The forwarder has no operator and cannot approve a transfer before the maximum `uint256` block. | fixed factory constructor arguments; `test_revertsBeforeMaximumTimelockBlock`; migration integration assertions |
| LOCK-03 | Permissionless LP fee collection forwards both currencies to the immutable creator without reducing liquidity. | official `PositionFeesForwarder`; bidirectional integration swaps and before/after liquidity assertion |
| LOCK-04 | Platform hook fees and creator LP fees remain separate and cannot redirect one another. | separate immutable recipients; integration balance assertions |
| IMM-01 | Authorities, pool configuration and fee parameters cannot change after construction. | immutable bytecode fields; empty hook storage layout; invariant suite |
| FLOW-01 | Token creation and distribution can execute atomically through the official launcher and UERC20 factory. | `test_atomicOfficialTokenCreationAndStrategyRegistration` |
| FLOW-02 | The official LBP strategy can migrate into the bound pool, mint a position and enable fee-bearing swaps. | `test_migrationInitializesBoundPoolAndCollectsFeeAfterSwap` |
| FLOW-03 | The official CCA factory and auction can accept a bid, finalize, graduate and migrate through LBPStrategy into the bound pool. | `test_realAuctionBidsFinalizeAndMigrateIntoBoundV4Pool` |

## Fuzz and invariant scope

The fee reference test covers exact-input and exact-output swaps in both directions over 1,000 generated cases per default run. The invariant handler performs 16,384 state-changing calls per property across swaps and permissionless collections. It checks immutable configuration, callback permissions and payout isolation.

The current fuzz range is intentionally below pathological `int128` boundaries. Boundary behavior in upstream v4 and `BaseHookFee` remains part of the external dependency review.

## Failure behavior

- An incorrect hook salt reverts before deployment.
- A duplicate position-forwarder salt and recipient pair reverts before deployment.
- A zero, sentinel or non-contract PositionManager configuration reverts.
- A wrong pool configuration reverts before initialization or fee collection.
- A direct callback from any address other than PoolManager reverts.
- A failed native or ERC-20 payout reverts the whole collection. Accrued ERC-6909 claims remain in the hook.
- Amounts below the fee’s integer precision may round to zero. This is expected and does not accumulate fractional dust.

## Out of scope

The properties do not certify the Continuous Clearing Auction implementation beyond the tested happy path. Oracle-based hooks, dynamic fees, arbitrary third-party hooks, regulated assets, frontend transaction construction and production signer custody remain out of scope.
