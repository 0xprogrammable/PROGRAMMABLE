# External function surface

| Contract | Function | Caller | Effect |
| --- | --- | --- | --- |
| `MemeLaunchV2` | `launch` | Anyone | Atomic token, pool, position, reward vault and Initial Buy |
| `MemeLaunchV2` | `unlockCallback` | PoolManager only | Settle the Initial Buy |
| `EthCreatorFeeHookV3` | v4 callbacks | PoolManager only | Apply and account directional native fees |
| `EthCreatorFeeHookV3` | `registerPool` | Recorded UERC20 creator | Bind one pool, vault and immutable fees |
| `EthCreatorFeeHookV3` | `claimCreatorFees` | Bound reward vault only | Redeem that pool's creator ETH |
| `EthCreatorFeeHookV3` | `claimLauncherFees` | Immutable revenue wallet only | Redeem Programmable ETH to itself |
| `EthCreatorFeeHookV3` | `claimLauncherFeesTo` | Immutable revenue wallet only | Redeem Programmable ETH to a chosen nonzero recipient |
| `ClassicRewardVaultV1` | `claim` | Payout wallet | Checkpoint and claim only caller-owned ETH |
| `ClassicRewardVaultV1` | `changePayoutWallet` | Current allocation owner | Move only one allocation's future rewards |
| `ClassicRewardVaultV1` | `executeCto` | Shared CTO contract only | Replace only future creator-reward allocations |
| `ClassicCtoAuthorityV1` | `executeCto` | Current authority only | Relay a disclosed CTO to one vault |
| `ClassicCtoAuthorityV1` | `proposeAuthority` | Current authority only | Begin two-step authority transfer |
| `ClassicCtoAuthorityV1` | `acceptAuthority` | Pending authority only | Finish two-step authority transfer |
| `ClassicInitialBuyVestingWalletV1` | `release` | Immutable beneficiary only | Release vested Initial Buy tokens |

View, quote and prediction functions are permissionless and do not mutate state.
