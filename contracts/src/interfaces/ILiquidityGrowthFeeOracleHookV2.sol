// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

interface ILiquidityGrowthFullRangeVaultFactoryV3 {
    function configurationHashOf(address vault) external view returns (bytes32);
    function vaultBindingHash(address vault) external view returns (bytes32);
}

/// @title ILiquidityGrowthFeeOracleHookV2
/// @notice Exact hook boundary consumed by the Deep V3 launcher, planner, vault and automation.
interface ILiquidityGrowthFeeOracleHookV2 {
    function BASIS_POINTS() external view returns (uint16);
    function TOTAL_HOOK_FEE_BPS() external view returns (uint16);
    function PROGRAMMABLE_FEE_BPS() external view returns (uint16);
    function GROWTH_FEE_BPS() external view returns (uint16);
    function LP_FEE_PIPS() external view returns (uint24);
    function TICK_SPACING() external view returns (int24);
    function COMPOUND_DOMAIN_TAG() external view returns (bytes32);

    function poolManager() external view returns (IPoolManager);
    function positionManager() external view returns (IPositionManager);
    function growthVaultFactory() external view returns (ILiquidityGrowthFullRangeVaultFactoryV3);
    function launcherFeeRecipient() external view returns (address);
    function maxAbsTickDelta() external view returns (int24);
    function launcherFeesAccrued() external view returns (uint256);
    function totalNativeFeesAccrued() external view returns (uint256);
    function initialPositionSaltByPool(bytes32 poolId) external view returns (bytes32);

    function poolFeeConfig(bytes32 poolId)
        external
        view
        returns (address growthVault, address registrar, uint8 lifecycle, uint256 growthFeesAccrued);

    function stateById(PoolId poolId) external view returns (uint16 index, uint16 cardinality, uint16 cardinalityNext);

    function registerPool(PoolKey calldata key, address growthVault) external returns (bytes32 poolId);
    function finalizePool(PoolKey calldata key) external;

    function feeDisclosure(bytes32 poolId)
        external
        view
        returns (
            uint16 totalHookFeeBps,
            uint16 growthFeeBps,
            uint16 programmableFeeBps,
            uint16 transferTaxBps,
            uint24 lpFeePips,
            address growthVault
        );

    function quoteGrossFees(uint256 grossNativeAmount)
        external
        pure
        returns (uint256 growthFee, uint256 programmableFee);

    function quoteExactOutputFees(uint256 netNativeAmount)
        external
        pure
        returns (uint256 growthFee, uint256 programmableFee);

    function claimGrowthFees(bytes32 poolId) external returns (uint256 amount);
    function claimLauncherFees() external returns (uint256 amount);

    function armCompound(bytes32 poolId, bytes32 digest) external;
    function closeCompound(bytes32 poolId, bytes32 digest) external;
    function compoundIntentState(bytes32 poolId) external view returns (uint8 state, bytes32 digest);

    function observe(uint32[] calldata secondsAgos, PoolId underlyingPoolId)
        external
        view
        returns (int56[] memory tickCumulatives, int56[] memory truncatedTickCumulatives);

    function increaseObservationCardinalityNext(uint16 observationCardinalityNext, PoolId underlyingPoolId) external;
}
