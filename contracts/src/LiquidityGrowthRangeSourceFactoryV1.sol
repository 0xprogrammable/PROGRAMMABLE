// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { LiquidityGrowthRangeSourceV1 } from "./LiquidityGrowthRangeSourceV1.sol";
import { ILiquidityGrowthOracleV1 } from "./interfaces/ILiquidityGrowthOracleV1.sol";

/// @title LiquidityGrowthRangeSourceFactoryV1
/// @notice Deterministically deploys immutable Liquidity Growth range policies.
/// @dev Constructor validation remains in LiquidityGrowthRangeSourceV1 so direct and factory deployments enforce
///      exactly the same dependency and range rules.
contract LiquidityGrowthRangeSourceFactoryV1 {
    mapping(address source => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error SourceAlreadyDeployed(address source);
    error UnrecognizedSource(address source);

    event LiquidityGrowthRangeSourceDeployed(
        address indexed source,
        address indexed poolManager,
        address indexed oracleHook,
        bytes32 poolId,
        bytes32 salt,
        bytes32 configurationHash
    );

    function deploy(
        bytes32 salt,
        IPoolManager poolManager,
        PoolKey calldata poolKey,
        ILiquidityGrowthOracleV1 oracleHook,
        uint32 twapWindow,
        int24 rangeHalfWidthTicks,
        int24 maxSpotTwapDeviationTicks
    ) external returns (LiquidityGrowthRangeSourceV1 source) {
        bytes memory code = initCode(
            poolManager, poolKey, oracleHook, twapWindow, rangeHalfWidthTicks, maxSpotTwapDeviationTicks
        );
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) revert SourceAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        source = LiquidityGrowthRangeSourceV1(deployed);

        _recordDeployment(source, salt);
    }

    /// @notice Deploys the exact deterministic source or returns the previously factory-recorded instance.
    /// @dev A contract occupying the CREATE2 address without the matching factory provenance is rejected.
    function deployOrGet(
        bytes32 salt,
        IPoolManager poolManager,
        PoolKey calldata poolKey,
        ILiquidityGrowthOracleV1 oracleHook,
        uint32 twapWindow,
        int24 rangeHalfWidthTicks,
        int24 maxSpotTwapDeviationTicks
    ) external returns (LiquidityGrowthRangeSourceV1 source) {
        bytes32 codeHash = initCodeHash(
            poolManager, poolKey, oracleHook, twapWindow, rangeHalfWidthTicks, maxSpotTwapDeviationTicks
        );
        address predicted = Create2.computeAddress(salt, codeHash);
        if (predicted.code.length == 0) {
            address deployed = Create2.deploy(
                0,
                salt,
                initCode(poolManager, poolKey, oracleHook, twapWindow, rangeHalfWidthTicks, maxSpotTwapDeviationTicks)
            );
            if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
            source = LiquidityGrowthRangeSourceV1(deployed);
            _recordDeployment(source, salt);
            return source;
        }

        source = LiquidityGrowthRangeSourceV1(predicted);
        bytes32 recordedHash = configurationHashOf[predicted];
        if (recordedHash == bytes32(0) || recordedHash != _configurationHash(source)) {
            revert UnrecognizedSource(predicted);
        }
    }

    function _recordDeployment(LiquidityGrowthRangeSourceV1 source, bytes32 salt) private {
        bytes32 configurationHash = _configurationHash(source);
        configurationHashOf[address(source)] = configurationHash;
        emit LiquidityGrowthRangeSourceDeployed(
            address(source),
            address(source.poolManager()),
            address(source.oracleHook()),
            source.poolId(),
            salt,
            configurationHash
        );
    }

    function predict(
        bytes32 salt,
        IPoolManager poolManager,
        PoolKey calldata poolKey,
        ILiquidityGrowthOracleV1 oracleHook,
        uint32 twapWindow,
        int24 rangeHalfWidthTicks,
        int24 maxSpotTwapDeviationTicks
    ) external view returns (address) {
        return Create2.computeAddress(
            salt,
            initCodeHash(poolManager, poolKey, oracleHook, twapWindow, rangeHalfWidthTicks, maxSpotTwapDeviationTicks)
        );
    }

    function initCode(
        IPoolManager poolManager,
        PoolKey calldata poolKey,
        ILiquidityGrowthOracleV1 oracleHook,
        uint32 twapWindow,
        int24 rangeHalfWidthTicks,
        int24 maxSpotTwapDeviationTicks
    ) public pure returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(LiquidityGrowthRangeSourceV1).creationCode,
            abi.encode(poolManager, poolKey, oracleHook, twapWindow, rangeHalfWidthTicks, maxSpotTwapDeviationTicks)
        );
    }

    function initCodeHash(
        IPoolManager poolManager,
        PoolKey calldata poolKey,
        ILiquidityGrowthOracleV1 oracleHook,
        uint32 twapWindow,
        int24 rangeHalfWidthTicks,
        int24 maxSpotTwapDeviationTicks
    ) public pure returns (bytes32) {
        return keccak256(
            initCode(poolManager, poolKey, oracleHook, twapWindow, rangeHalfWidthTicks, maxSpotTwapDeviationTicks)
        );
    }

    function isFactorySource(address source) external view returns (bool) {
        return configurationHashOf[source] != bytes32(0);
    }

    function _configurationHash(LiquidityGrowthRangeSourceV1 source) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                address(source),
                address(source.poolManager()),
                source.poolId(),
                address(source.oracleHook()),
                source.twapWindow(),
                source.tickSpacing(),
                source.rangeHalfWidthTicks(),
                source.maxSpotTwapDeviationTicks()
            )
        );
    }
}
