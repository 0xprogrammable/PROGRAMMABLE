// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { ILiquidityGrowthFullRangeVaultFactoryV3 } from "./interfaces/ILiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFeeOracleHookV2 } from "./LiquidityGrowthFeeOracleHookV2.sol";

/// @title LiquidityGrowthFeeOracleHookFactoryV2
/// @notice Deterministically deploys Deep's fee, oracle and permanent-liquidity hook at a valid v4 address.
contract LiquidityGrowthFeeOracleHookFactoryV2 {
    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
            | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_DONATE_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    mapping(address hook => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error HookAlreadyDeployed(address hook);
    error InvalidHookAddress(address hook, uint160 actualFlags, uint160 requiredFlags);

    event LiquidityGrowthFeeOracleHookDeployedV2(
        address indexed hook,
        address indexed poolManager,
        address indexed launcherFeeRecipient,
        bytes32 salt,
        bytes32 configurationHash
    );

    function deploy(
        bytes32 salt,
        IPoolManager poolManager,
        address launcherFeeRecipient,
        ILiquidityGrowthFullRangeVaultFactoryV3 growthVaultFactory,
        IPositionManager positionManager,
        int24 maxAbsTickDelta
    ) external returns (LiquidityGrowthFeeOracleHookV2 hook) {
        bytes memory code = initCode(
            poolManager, launcherFeeRecipient, growthVaultFactory, positionManager, maxAbsTickDelta
        );
        address predicted = Create2.computeAddress(salt, keccak256(code));
        uint160 actualFlags = uint160(predicted) & ALL_HOOK_MASK;
        if (actualFlags != REQUIRED_HOOK_FLAGS) {
            revert InvalidHookAddress(predicted, actualFlags, REQUIRED_HOOK_FLAGS);
        }
        if (predicted.code.length != 0) revert HookAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        hook = LiquidityGrowthFeeOracleHookV2(deployed);

        bytes32 configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                deployed,
                address(poolManager),
                launcherFeeRecipient,
                address(growthVaultFactory),
                address(positionManager),
                maxAbsTickDelta
            )
        );
        configurationHashOf[deployed] = configurationHash;
        emit LiquidityGrowthFeeOracleHookDeployedV2(
            deployed, address(poolManager), launcherFeeRecipient, salt, configurationHash
        );
    }

    function predict(
        bytes32 salt,
        IPoolManager poolManager,
        address launcherFeeRecipient,
        ILiquidityGrowthFullRangeVaultFactoryV3 growthVaultFactory,
        IPositionManager positionManager,
        int24 maxAbsTickDelta
    ) external view returns (address) {
        return Create2.computeAddress(
            salt, initCodeHash(poolManager, launcherFeeRecipient, growthVaultFactory, positionManager, maxAbsTickDelta)
        );
    }

    function initCode(
        IPoolManager poolManager,
        address launcherFeeRecipient,
        ILiquidityGrowthFullRangeVaultFactoryV3 growthVaultFactory,
        IPositionManager positionManager,
        int24 maxAbsTickDelta
    ) public pure returns (bytes memory) {
        return abi.encodePacked(
            type(LiquidityGrowthFeeOracleHookV2).creationCode,
            abi.encode(poolManager, launcherFeeRecipient, growthVaultFactory, positionManager, maxAbsTickDelta)
        );
    }

    function initCodeHash(
        IPoolManager poolManager,
        address launcherFeeRecipient,
        ILiquidityGrowthFullRangeVaultFactoryV3 growthVaultFactory,
        IPositionManager positionManager,
        int24 maxAbsTickDelta
    ) public pure returns (bytes32) {
        return keccak256(
            initCode(poolManager, launcherFeeRecipient, growthVaultFactory, positionManager, maxAbsTickDelta)
        );
    }

    function isFactoryHook(address hook) external view returns (bool) {
        return configurationHashOf[hook] != bytes32(0);
    }
}
