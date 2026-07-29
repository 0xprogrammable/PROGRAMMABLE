# Deep V3 gas and bytecode evidence

Evidence date: 2026-07-29  
Source commit: `7627c46e5370e01186f627aba964615911f38af5`  
Compiler: Solidity 0.8.26, Cancun, optimizer enabled with 1,000 runs, no CBOR metadata

This is local and Mainnet-fork evidence. It is not a gas-price quote and it does not prove a Mainnet deployment.

## Bytecode limits

The exact-source `forge build --sizes --no-cache` passed. Sizes below are read from the resulting Foundry artifacts.

| Contract | Runtime | EIP-170 margin | Initcode | EIP-3860 margin |
| --- | ---: | ---: | ---: | ---: |
| `LiquidityGrowthFeeOracleHookFactoryV2` | 24,147 B | 429 B | 24,175 B | 24,977 B |
| `LiquidityGrowthFeeOracleHookV2` | 20,320 B | 4,256 B | 22,277 B | 26,875 B |
| `LiquidityGrowthZapPlannerV3` | 14,123 B | 10,453 B | 14,151 B | 35,001 B |
| `LiquidityGrowthFullRangeVaultFactoryV3` | 2,758 B | 21,818 B | 22,363 B | 26,789 B |
| `LiquidityGrowthFullRangeVaultV3` | 19,059 B | 5,517 B | 19,279 B | 29,873 B |
| `LiquidityGrowthFullRangePositionPlannerV3` | 8,555 B | 16,021 B | 8,583 B | 40,569 B |
| `LiquidityGrowthFullRangeAutomationV3` | 8,989 B | 15,587 B | 9,338 B | 39,814 B |
| `LiquidityGrowthFullRangeLaunchV3` | 18,531 B | 6,045 B | 40,314 B | 8,838 B |
| `DeepKeeperExecutorV2` | 3,673 B | 20,903 B | 4,632 B | 44,520 B |

The narrowest margin is the hook factory at 429 runtime bytes. Any source, compiler, optimizer or dependency change requires a fresh size check. The launcher's initcode uses 82.02% of the EIP-3860 limit.

## Measured execution

The focused gas report covered the launch, vault, executor and official Mainnet-fork tests.

| Operation | Evidence | Gas |
| --- | --- | ---: |
| `launch` | Foundry function report, maximum of 10 calls | 3,813,343 |
| `compound` | Foundry function report, maximum of 7 calls | 1,513,694 |
| keeper `execute` | Foundry function report, maximum of 13 calls | 3,300,130 |
| one keeper compound | explicit local measurement | 3,132,970 |
| one keeper compound | official Mainnet fork, block 25,635,400 | 2,884,090 |
| reviewed per-vault keeper ceiling | executor policy | 4,428,255 |

The official-fork compound used 65.13% of the reviewed ceiling, leaving 1,544,165 gas of headroom. Gas varies with pool state, oracle growth, protocol fees and EVM pricing. The keeper must still simulate each transaction and fail closed when its estimate exceeds the reviewed envelope.

## Keeper funding

Keeper gas is externally funded. The contracts pay no bounty and reserve none of the growth vault's ETH for gas.

At the 0.002 ETH minimum compound threshold, one measured 2.88 million gas execution costs more than the complete growth budget whenever the effective gas price exceeds roughly 0.69 gwei. The corresponding Programmable share that accrued alongside 0.002 ETH of growth fees is about 0.000222 ETH, so it is smaller still. Deep must not be described as self-funding, and an eligible five-minute slot is not a guarantee that a transaction will be economical or included.

Oracle staging and compounding are separate actions. The same accrued growth can qualify each action against
the per-action growth-to-gas ratio, so passing both checks does not prove that the combined lifecycle paid for
itself. A permissionless caller can also complete the work between simulation and inclusion, leaving the
official transaction stale or nonproductive while still consuming bounded signer gas. Monitoring must account
for the confirmed receipt and candidate logs, not only the preflight estimate.

Deferral does not redirect or discard fees. Unclaimed growth fees remain accounted to the pool in the hook, already claimed but unused ETH remains bound inside the vault as `pendingGrowthNative`, and any amount above the 0.25 ETH per-cycle maximum remains for later cycles. Cooldown, oracle, exposure, simulation and execution failures either return no work or revert atomically before consuming the accrued accounting.

The cold gas-report command skipped `QuoteAssetCreatorFeeHook`, `QuoteAssetFeeSplitVault` and `StockPairedLaunchV1`. Those unrelated sources currently hit stack-too-deep errors when Foundry compiles the full repository for instrumentation. The exact Deep V3 source graph, CI suite and Mainnet-fork suite compile without changing them.

## Commands

```sh
forge build --sizes --no-cache \
  src/LiquidityGrowthFeeOracleHookFactoryV2.sol \
  src/LiquidityGrowthFeeOracleHookV2.sol \
  src/LiquidityGrowthFullRangePolicyV3.sol \
  src/LiquidityGrowthZapPlannerV3.sol \
  src/LiquidityGrowthFullRangeVaultFactoryV3.sol \
  src/LiquidityGrowthFullRangeVaultV3.sol \
  src/LiquidityGrowthFullRangePositionPlannerV3.sol \
  src/LiquidityGrowthFullRangeAutomationV3.sol \
  src/LiquidityGrowthFullRangeLaunchV3.sol \
  src/DeepKeeperExecutorV2.sol \
  src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol \
  src/libraries/LiquidityGrowthSwapMathV3.sol

FOUNDRY_PROFILE=ci forge test \
  --match-contract '^(LiquidityGrowthFeeOracleHookV2PermissionsTest|LiquidityGrowthZapPlannerV3Test|LiquidityGrowthFullRangeV3PolicyTest|LiquidityGrowthFullRangeV3Test|LiquidityGrowthFullRangeV3FeeAccountingTest|LiquidityGrowthFullRangeV3SecurityTest|LiquidityGrowthDeepAdversarialTest|LiquidityGrowthFullRangeAutomationV3Test|LiquidityGrowthFullRangeLaunchV3Test|DeepKeeperExecutorV2Test|DeployMainnetDeepFullRangeInfrastructureV3Test|DeployMainnetDeepFullRangeInfrastructureV3SecurityTest|LiquidityGrowthFullRangeV3MainnetForkTest|LiquidityGrowthFullRangeV3StatefulInvariantTest)$' \
  -vv

forge test --no-cache \
  --match-contract '^(LiquidityGrowthFullRangeLaunchV3Test|LiquidityGrowthFullRangeV3Test|DeepKeeperExecutorV2Test|LiquidityGrowthFullRangeV3MainnetForkTest)$' \
  --skip QuoteAssetCreatorFeeHook \
  --skip QuoteAssetFeeSplitVault \
  --skip StockPairedLaunchV1 \
  --gas-report \
  -vv
```
