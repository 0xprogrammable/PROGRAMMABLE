// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { ClassicCtoAuthorityV1 } from "./ClassicCtoAuthorityV1.sol";
import { ClassicRewardVaultV1 } from "./ClassicRewardVaultV1.sol";
import { IClassicFeeHookV3 } from "./interfaces/IClassicFeeHookV3.sol";

/// @title ClassicRewardVaultFactoryV1
/// @notice Deterministically deploys authenticated Classic reward vaults governed by one disclosed CTO authority.
contract ClassicRewardVaultFactoryV1 {
    ClassicCtoAuthorityV1 public immutable ctoAuthority;

    mapping(address vault => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error InvalidCtoAuthority(address authority);
    error UnrecognizedFactoryDeployment(address deployment);
    error VaultAlreadyDeployed(address vault);

    event ClassicRewardVaultDeployed(
        address indexed vault, bytes32 indexed poolId, address indexed feeHook, bytes32 salt, bytes32 configurationHash
    );

    constructor(ClassicCtoAuthorityV1 ctoAuthority_) {
        address authorityAddress = address(ctoAuthority_);
        if (authorityAddress == address(0) || authorityAddress.code.length == 0) {
            revert InvalidCtoAuthority(authorityAddress);
        }
        ctoAuthority = ctoAuthority_;
    }

    function deploy(
        bytes32 salt,
        IClassicFeeHookV3 feeHook,
        bytes32 poolId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) external returns (ClassicRewardVaultV1 vault) {
        bytes memory code = initCode(feeHook, poolId, beneficiaries, sharesBps);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) revert VaultAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        vault = ClassicRewardVaultV1(payable(deployed));

        bytes32 configurationHash = vault.configurationHash();
        configurationHashOf[deployed] = configurationHash;
        emit ClassicRewardVaultDeployed(deployed, poolId, address(feeHook), salt, configurationHash);
    }

    /// @notice Deploys the configured vault or returns the same authenticated counterfactual vault if it already
    /// exists. @dev This makes a launch resistant to third parties predeploying its publicly predictable CREATE2 vault.
    function deployOrGet(
        bytes32 salt,
        IClassicFeeHookV3 feeHook,
        bytes32 poolId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) external returns (ClassicRewardVaultV1 vault) {
        address predicted = Create2.computeAddress(salt, initCodeHash(feeHook, poolId, beneficiaries, sharesBps));
        if (predicted.code.length == 0) {
            bytes memory code = initCode(feeHook, poolId, beneficiaries, sharesBps);
            address deployed = Create2.deploy(0, salt, code);
            if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
            vault = ClassicRewardVaultV1(payable(deployed));

            bytes32 configurationHash = vault.configurationHash();
            configurationHashOf[deployed] = configurationHash;
            emit ClassicRewardVaultDeployed(deployed, poolId, address(feeHook), salt, configurationHash);
            return vault;
        }
        if (configurationHashOf[predicted] == bytes32(0)) revert UnrecognizedFactoryDeployment(predicted);
        return ClassicRewardVaultV1(payable(predicted));
    }

    function predict(
        bytes32 salt,
        IClassicFeeHookV3 feeHook,
        bytes32 poolId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) external view returns (address) {
        return Create2.computeAddress(salt, initCodeHash(feeHook, poolId, beneficiaries, sharesBps));
    }

    function initCode(
        IClassicFeeHookV3 feeHook,
        bytes32 poolId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) public view returns (bytes memory) {
        // Slither mistakes the creation-code expression for a long numeric literal.
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(ClassicRewardVaultV1).creationCode, abi.encode(feeHook, poolId, ctoAuthority, beneficiaries, sharesBps)
        );
    }

    function initCodeHash(
        IClassicFeeHookV3 feeHook,
        bytes32 poolId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) public view returns (bytes32) {
        return keccak256(initCode(feeHook, poolId, beneficiaries, sharesBps));
    }

    function isFactoryVault(address vault) external view returns (bool) {
        return configurationHashOf[vault] != bytes32(0);
    }
}
