// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import { IProgrammableLaunchStampRouterV2 } from "./IProgrammableLaunchStampRouterV2.sol";

/// @notice Stateless, exactly pinned validation module for the first Router V2 profile.
interface IProgrammableExactShardsProfileV1 {
    function validatePreV1(
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 calldata route,
        IProgrammableLaunchStampRouterV2.StampRequestV2 calldata request,
        IPoolManager poolManager
    )
        external
        view
        returns (
            bytes32 poolId,
            bytes32 poolKeyHash,
            bytes32 expectedResultHash,
            IProgrammableLaunchStampRouterV2.ExecutionModeV2 executionMode
        );

    function validatePostV1(
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 calldata route,
        IProgrammableLaunchStampRouterV2.StampRequestV2 calldata request,
        IPoolManager poolManager,
        IProgrammableLaunchStampRouterV2.ExecutionModeV2 executionMode
    ) external view returns (bytes32 observedResultHash);

    function computeExpectedResultHash(
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 calldata route,
        IProgrammableLaunchStampRouterV2.StampRequestV2 calldata request
    ) external pure returns (bytes32);
}
