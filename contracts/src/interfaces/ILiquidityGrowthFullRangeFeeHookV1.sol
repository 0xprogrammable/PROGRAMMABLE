// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { FeeSplitVaultFactoryV1 } from "../FeeSplitVaultFactoryV1.sol";
import { IClassicFeeHookV3 } from "./IClassicFeeHookV3.sol";

/// @notice Fee-source surface shared by the Classic and staged-oracle hook candidates for Full-Range V1.
/// @dev Keeping the vault on this narrow interface avoids committing the model to either hook implementation while
///      the independent price-guard review is open.
interface ILiquidityGrowthFullRangeFeeHookV1 is IClassicFeeHookV3 {
    function LP_FEE_PIPS() external view returns (uint24);
    function TICK_SPACING() external view returns (int24);
    function feeSplitVaultFactory() external view returns (FeeSplitVaultFactoryV1);

    function registerPool(PoolKey calldata key, address rewardVault, uint16 buySwapFeeBps, uint16 sellSwapFeeBps)
        external
        returns (bytes32 poolId);

    function quoteGrossFees(uint256 grossNativeAmount, uint16 totalSwapFeeBps)
        external
        view
        returns (uint256 creatorFee, uint256 launcherFee);

    function poolFeeConfig(bytes32 poolId)
        external
        view
        returns (
            address rewardVault,
            address registrar,
            uint16 buySwapFeeBps,
            uint16 sellSwapFeeBps,
            bool registered,
            uint256 creatorFeesAccrued
        );
}
