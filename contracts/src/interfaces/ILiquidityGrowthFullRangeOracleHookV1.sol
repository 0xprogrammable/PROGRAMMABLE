// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

import { IClassicFeeHookV3 } from "./IClassicFeeHookV3.sol";
import { ILiquidityGrowthOracleV1 } from "./ILiquidityGrowthOracleV1.sol";
import { ILiquidityGrowthFullRangeFeeHookV1 } from "./ILiquidityGrowthFullRangeFeeHookV1.sol";

/// @notice Composite fee and observation surface required by Full-Range V1.
interface ILiquidityGrowthFullRangeOracleHookV1 is ILiquidityGrowthFullRangeFeeHookV1, ILiquidityGrowthOracleV1 {
    function poolManager() external view override(IClassicFeeHookV3, ILiquidityGrowthOracleV1) returns (IPoolManager);

    function maxAbsTickDelta() external view returns (int24);
    function increaseObservationCardinalityNext(uint16 cardinalityNext, PoolId poolId) external;
}
