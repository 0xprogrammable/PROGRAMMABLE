// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { FeeSplitVaultV1 } from "./FeeSplitVaultV1.sol";
import { IClassicFeeHookV3 } from "./interfaces/IClassicFeeHookV3.sol";

/// @title FeeSplitVaultFactoryV1
/// @notice Deterministically deploys immutable Classic creator-reward vaults.
contract FeeSplitVaultFactoryV1 {
    mapping(address vault => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error VaultAlreadyDeployed(address vault);

    event FeeSplitVaultDeployed(
        address indexed vault, address indexed feeHook, bytes32 indexed poolId, bytes32 salt, bytes32 configurationHash
    );

    function deploy(
        bytes32 salt,
        IClassicFeeHookV3 feeHook,
        bytes32 poolId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) external returns (FeeSplitVaultV1 vault) {
        bytes memory code = initCode(feeHook, poolId, beneficiaries, sharesBps);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) revert VaultAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        vault = FeeSplitVaultV1(payable(deployed));

        bytes32 configurationHash = vault.configurationHash();
        configurationHashOf[deployed] = configurationHash;
        emit FeeSplitVaultDeployed(deployed, address(feeHook), poolId, salt, configurationHash);
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
    ) public pure returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return
            abi.encodePacked(type(FeeSplitVaultV1).creationCode, abi.encode(feeHook, poolId, beneficiaries, sharesBps));
    }

    function initCodeHash(
        IClassicFeeHookV3 feeHook,
        bytes32 poolId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) public pure returns (bytes32) {
        return keccak256(initCode(feeHook, poolId, beneficiaries, sharesBps));
    }

    function isFactoryVault(address vault) external view returns (bool) {
        return configurationHashOf[vault] != bytes32(0);
    }
}
