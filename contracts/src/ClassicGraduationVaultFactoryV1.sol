// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { ClassicGraduationConfigV1, ClassicGraduationVaultV1 } from "./ClassicGraduationVaultV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";

/// @title ClassicGraduationVaultFactoryV1
/// @notice Deterministically deploys authenticated, ownerless Classic graduation custody.
contract ClassicGraduationVaultFactoryV1 {
    IPositionManager public immutable positionManager;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;

    mapping(address vault => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error InvalidDependency(address dependency);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error UnrecognizedFactoryDeployment(address deployment);
    error VaultAlreadyDeployed(address vault);
    error VaultConfigurationMismatch(bytes32 actual, bytes32 expected);

    event ClassicGraduationVaultDeployed(
        address indexed vault,
        bytes32 indexed poolId,
        address indexed token,
        uint256 bondingPositionTokenId,
        address finalPositionRecipient,
        bytes32 salt,
        bytes32 configurationHash
    );

    constructor(IPositionManager positionManager_, LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_) {
        if (address(positionManager_) == address(0) || address(positionManager_).code.length == 0) {
            revert InvalidDependency(address(positionManager_));
        }
        if (
            address(positionManager_.poolManager()) == address(0)
                || address(positionManager_.poolManager()).code.length == 0
        ) {
            revert InvalidDependency(address(positionManager_.poolManager()));
        }
        if (address(positionForwarderFactory_) == address(0) || address(positionForwarderFactory_).code.length == 0) {
            revert InvalidDependency(address(positionForwarderFactory_));
        }
        if (address(positionForwarderFactory_.positionManager()) != address(positionManager_)) {
            revert InvalidPositionManagerFactory(
                address(positionManager_), address(positionForwarderFactory_.positionManager())
            );
        }

        positionManager = positionManager_;
        positionForwarderFactory = positionForwarderFactory_;
    }

    function deploy(bytes32 salt, ClassicGraduationConfigV1 memory config)
        external
        returns (ClassicGraduationVaultV1 vault)
    {
        bytes memory code = initCode(config);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) revert VaultAlreadyDeployed(predicted);
        vault = _deploy(salt, predicted, code, config);
    }

    /// @notice Deploys the exact configured vault or returns the already authenticated counterfactual deployment.
    function deployOrGet(bytes32 salt, ClassicGraduationConfigV1 memory config)
        external
        returns (ClassicGraduationVaultV1 vault)
    {
        address predicted = Create2.computeAddress(salt, initCodeHash(config));
        if (predicted.code.length == 0) {
            return _deploy(salt, predicted, initCode(config), config);
        }

        bytes32 recordedConfigurationHash = configurationHashOf[predicted];
        if (recordedConfigurationHash == bytes32(0)) revert UnrecognizedFactoryDeployment(predicted);
        bytes32 actualConfigurationHash = ClassicGraduationVaultV1(payable(predicted)).configurationHash();
        if (actualConfigurationHash != recordedConfigurationHash) {
            revert VaultConfigurationMismatch(actualConfigurationHash, recordedConfigurationHash);
        }
        return ClassicGraduationVaultV1(payable(predicted));
    }

    function predict(bytes32 salt, ClassicGraduationConfigV1 memory config) external view returns (address) {
        return Create2.computeAddress(salt, initCodeHash(config));
    }

    function initCode(ClassicGraduationConfigV1 memory config) public view returns (bytes memory) {
        // Slither mistakes the creation-code expression for a long numeric literal.
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(ClassicGraduationVaultV1).creationCode, abi.encode(positionManager, positionForwarderFactory, config)
        );
    }

    function initCodeHash(ClassicGraduationConfigV1 memory config) public view returns (bytes32) {
        return keccak256(initCode(config));
    }

    function isFactoryVault(address vault) external view returns (bool) {
        return configurationHashOf[vault] != bytes32(0);
    }

    function _deploy(bytes32 salt, address predicted, bytes memory code, ClassicGraduationConfigV1 memory config)
        private
        returns (ClassicGraduationVaultV1 vault)
    {
        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        vault = ClassicGraduationVaultV1(payable(deployed));

        bytes32 configurationHash = vault.configurationHash();
        configurationHashOf[deployed] = configurationHash;
        emit ClassicGraduationVaultDeployed(
            deployed,
            PoolId.unwrap(config.poolKey.toId()),
            Currency.unwrap(config.poolKey.currency1),
            config.bondingPositionTokenId,
            config.finalPositionRecipient,
            salt,
            configurationHash
        );
    }
}
