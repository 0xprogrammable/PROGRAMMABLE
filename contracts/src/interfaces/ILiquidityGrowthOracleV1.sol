// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

/// @title ILiquidityGrowthOracleV1
/// @notice Minimal observation interface required by the Liquidity Growth range policy.
/// @dev A production implementation must record observations from the same hook attached to the pool. The return
///      shape matches OpenZeppelin's Panoptic-derived BaseOracleHook, but this interface does not make that
///      implementation a trusted dependency by itself.
interface ILiquidityGrowthOracleV1 {
    /// @notice Returns the PoolManager whose pools are observed.
    function poolManager() external view returns (IPoolManager);

    /// @notice Returns normal and per-observation truncated tick cumulatives for `poolId`.
    /// @dev Implementations must revert when the requested lookback predates the oldest populated observation.
    function observe(uint32[] calldata secondsAgos, PoolId poolId)
        external
        view
        returns (int56[] memory tickCumulatives, int56[] memory truncatedTickCumulatives);
}
