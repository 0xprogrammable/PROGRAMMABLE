# Deep FullRange V1 public and external functions

Generated from the Solidity compiler AST. Modifier names are shown exactly as declared. Sender checks implemented
inside function bodies are summarized separately in `state-authorization.md`.

## LiquidityGrowthFullRangeLaunchV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `constructor(IPoolManager,IPositionManager,UERC20Factory,ILiquidityGrowthFullRangeOracleHookV1,FeeSplitVaultFactoryV1,LiquidityGrowthRangeSourceFactoryV1,LiquidityGrowthFullRangeVaultFactoryV1,LockedPositionFeeForwarderFactoryV1)` | public | nonpayable | None | N/A |
| `launch(LiquidityGrowthFullRangeLaunchV1.LaunchParameters)` | external | payable | `nonReentrant` | `0xb4870fa2` |
| `predictTokenAddress(string,string,address,bytes32)` | external | view | None | `0xcf1008fe` |
| `unlockCallback(bytes)` | external | nonpayable | None | `0x91dd7346` |

## LiquidityGrowthFullRangeAutomationV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `assessVault(address)` | external | view | None | `0x23ac1524` |
| `checkBatch(address[])` | external | view | None | `0x16952724` |
| `checkVault(address)` | public | view | None | `0xa764a2ba` |
| `constructor(LiquidityGrowthFullRangeVaultFactoryV1,address)` | public | nonpayable | None | N/A |
| `performBatch(address[])` | external | nonpayable | `nonReentrant` | `0xcb20fb57` |
| `performVault(address)` | external | nonpayable | `nonReentrant` | `0xe94328b7` |
| `registerAndStageOracle(address)` | external | nonpayable | None | `0x5105a071` |
| `registeredVaultAt(uint256)` | external | view | None | `0x2dd3519d` |
| `registeredVaultCount()` | external | view | None | `0xafa16280` |
| `scan(uint256,uint256)` | external | view | None | `0xc5221bc4` |
| `stageOracle(address)` | external | nonpayable | None | `0x9c15215c` |
| `stageOracleBatch(address[])` | external | nonpayable | `nonReentrant` | `0xa774cfba` |

## LiquidityGrowthFullRangeVaultFactoryV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `constructor(LiquidityGrowthFeeOracleHookFactoryV1,FeeSplitVaultFactoryV1,IPositionManager,LockedPositionFeeForwarderFactoryV1,LiquidityGrowthRangeSourceFactoryV1)` | public | nonpayable | None | N/A |
| `deployOrGet(bytes32,ILiquidityGrowthFullRangeOracleHookV1,LiquidityGrowthFullRangeVaultV1.Configuration)` | external | nonpayable | None | `0xfb6424ba` |
| `effectiveSalt(bytes32,ILiquidityGrowthFullRangeOracleHookV1,LiquidityGrowthFullRangeVaultV1.Configuration)` | public | pure | None | `0xf611d037` |
| `isFactoryVault(address)` | external | view | None | `0x58c62442` |
| `predict(bytes32,ILiquidityGrowthFullRangeOracleHookV1,LiquidityGrowthFullRangeVaultV1.Configuration)` | external | view | None | `0x77121bdc` |

## LiquidityGrowthFullRangeVaultV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `beneficiaryAt(uint256)` | external | view | None | `0xcee1c11d` |
| `claimable(address)` | public | view | None | `0x402914f5` |
| `claimRewards()` | external | nonpayable | `nonReentrant` | `0x372500ab` |
| `compoundPending()` | external | nonpayable | `nonReentrant` | `0x1b338c9f` |
| `constructor(address)` | public | nonpayable | None | N/A |
| `initialize(ILiquidityGrowthFullRangeOracleHookV1,FeeSplitVaultFactoryV1,LiquidityGrowthFullRangeVaultV1.Configuration)` | external | nonpayable | None | `0x7400922d` |
| `lockedLiquidity()` | public | view | None | `0xb4398244` |
| `oracleReady()` | public | view | None | `0x4dd7fab1` |
| `process()` | external | nonpayable | `nonReentrant` | `0xc33fb877` |
| `receive()` | external | payable | None | N/A |
| `setPayoutAddress(address)` | external | nonpayable | `nonReentrant` | `0x33ea51a8` |
| `trustedDepthAndCap()` | public | view | None | `0x1f2afa42` |
| `unlockCallback(bytes)` | external | nonpayable | None | `0x91dd7346` |
| `workState()` | external | view | None | `0x387da07c` |

## LiquidityGrowthFullRangePositionPlannerV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `buildOneSidedPlan(PoolKey,address)` | external | pure | None | `0xed116629` |

## LiquidityGrowthFullRangePolicyV1

No declared public or external functions. This contract is an internal library.

## LiquidityGrowthFeeOracleHookV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `claimCreatorFees(bytes32)` | external | nonpayable | `nonReentrant` | `0xaf8d60b5` |
| `claimLauncherFees()` | external | nonpayable | `nonReentrant` | `0x64d46b85` |
| `claimLauncherFeesTo(address)` | external | nonpayable | `nonReentrant` | `0x6884ef07` |
| `constructor(IPoolManager,address,FeeSplitVaultFactoryV1,int24)` | public | nonpayable | `BaseHook` | N/A |
| `feeDisclosure(bytes32)` | external | view | None | `0xb4b01335` |
| `getHookPermissions()` | public | pure | None | `0xc4e833ce` |
| `increaseObservationCardinalityNext(uint16,PoolId)` | external | nonpayable | None | `0x4f413237` |
| `observe(uint32[],PoolId)` | external | view | None | `0x0520d445` |
| `quoteExactOutputFees(uint256,uint16)` | external | pure | None | `0x9d2786a5` |
| `quoteGrossFees(uint256,uint16)` | external | pure | None | `0x383f307e` |
| `registerPool(PoolKey,address,uint16,uint16)` | external | nonpayable | None | `0x5fd07da5` |
| `totalSwapFeeBpsFor(bytes32,bool)` | public | view | None | `0xb6c27662` |
| `unlockCallback(bytes)` | external | nonpayable | `onlyPoolManager` | `0x91dd7346` |

## LiquidityGrowthFeeOracleHookFactoryV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `deploy(bytes32,IPoolManager,address,FeeSplitVaultFactoryV1,int24)` | external | nonpayable | None | `0xd4191b14` |
| `initCode(IPoolManager,address,FeeSplitVaultFactoryV1,int24)` | public | pure | None | `0x5d975956` |
| `initCodeHash(IPoolManager,address,FeeSplitVaultFactoryV1,int24)` | public | pure | None | `0xea3062b6` |
| `isFactoryHook(address)` | external | view | None | `0x03607b2c` |
| `predict(bytes32,IPoolManager,address,FeeSplitVaultFactoryV1,int24)` | external | view | None | `0xfc16130c` |

## LiquidityGrowthRangeSourceV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `arithmeticMeanTick(int56,int56,uint32)` | public | pure | None | `0x24cae52b` |
| `constructor(IPoolManager,PoolKey,ILiquidityGrowthOracleV1,uint32,int24,int24)` | public | nonpayable | None | N/A |
| `quoteRange()` | external | view | None | `0x240016b4` |
| `rangeForTwap(int24)` | public | view | None | `0x873c5e4b` |

## LiquidityGrowthRangeSourceFactoryV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `deploy(bytes32,IPoolManager,PoolKey,ILiquidityGrowthOracleV1,uint32,int24,int24)` | external | nonpayable | None | `0x35438750` |
| `deployOrGet(bytes32,IPoolManager,PoolKey,ILiquidityGrowthOracleV1,uint32,int24,int24)` | external | nonpayable | None | `0x411f25b5` |
| `initCode(IPoolManager,PoolKey,ILiquidityGrowthOracleV1,uint32,int24,int24)` | public | pure | None | `0xdc249b9f` |
| `initCodeHash(IPoolManager,PoolKey,ILiquidityGrowthOracleV1,uint32,int24,int24)` | public | pure | None | `0x883df76a` |
| `isFactorySource(address)` | external | view | None | `0x98955c3d` |
| `predict(bytes32,IPoolManager,PoolKey,ILiquidityGrowthOracleV1,uint32,int24,int24)` | external | view | None | `0x13251835` |

## FeeSplitVaultV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `beneficiaryAt(uint256)` | external | view | None | `0xcee1c11d` |
| `claim()` | external | nonpayable | `nonReentrant` | `0x4e71d92d` |
| `claimable(address)` | public | view | None | `0x402914f5` |
| `constructor(IClassicFeeHookV3,bytes32,address[],uint16[])` | public | nonpayable | None | N/A |
| `receive()` | external | payable | None | N/A |
| `setPayoutAddress(address)` | external | nonpayable | `nonReentrant` | `0x33ea51a8` |

## FeeSplitVaultFactoryV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `deploy(bytes32,IClassicFeeHookV3,bytes32,address[],uint16[])` | external | nonpayable | None | `0x19e3bddc` |
| `initCode(IClassicFeeHookV3,bytes32,address[],uint16[])` | public | pure | None | `0x02afa9ce` |
| `initCodeHash(IClassicFeeHookV3,bytes32,address[],uint16[])` | public | pure | None | `0x1f941132` |
| `isFactoryVault(address)` | external | view | None | `0x58c62442` |
| `predict(bytes32,IClassicFeeHookV3,bytes32,address[],uint16[])` | external | view | None | `0xb25372cd` |

## LockedPositionFeeForwarderFactoryV1

| Function | Visibility | Mutability | Declared modifiers | Selector |
| --- | --- | --- | --- | --- |
| `constructor(IPositionManager)` | public | nonpayable | None | N/A |
| `deploy(bytes32,address)` | external | nonpayable | None | `0x8c1fb931` |
| `initCode(address)` | public | view | None | `0x21b7cd61` |
| `initCodeHash(address)` | public | view | None | `0x75fd9f28` |
| `isFactoryForwarder(address)` | external | view | None | `0xe917e427` |
| `predict(bytes32,address)` | public | view | None | `0xc4b9f746` |

