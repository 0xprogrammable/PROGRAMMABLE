// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @notice Minimal interface used by a Stock-Paired creator-reward vault.
interface IQuoteAssetCreatorFeeHookV1 {
    function poolManager() external view returns (IPoolManager);

    /// @notice Redeems all currently accrued creator fees for `poolId` to its registered reward vault.
    /// @dev The registered vault must be the caller. Returns zero when no new fees have accrued.
    function claimCreatorFees(bytes32 poolId) external returns (uint256 amount);
}
