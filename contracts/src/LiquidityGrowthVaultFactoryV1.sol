// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { EthCreatorFeeHookV3 } from "./EthCreatorFeeHookV3.sol";
import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthVaultV1 } from "./LiquidityGrowthVaultV1.sol";

/// @title LiquidityGrowthVaultFactoryV1
/// @notice Deterministically deploys immutable LiquidityGrowth routing and compounding vaults.
contract LiquidityGrowthVaultFactoryV1 {
    mapping(address vault => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error VaultAlreadyDeployed(address vault);

    event LiquidityGrowthVaultDeployed(
        address indexed vault,
        address indexed feeHook,
        bytes32 indexed poolId,
        address upstreamVault,
        bytes32 salt,
        bytes32 configurationHash
    );

    function deploy(
        bytes32 salt,
        EthCreatorFeeHookV3 feeHook,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory,
        LiquidityGrowthVaultV1.Configuration calldata configuration
    ) external returns (LiquidityGrowthVaultV1 vault) {
        bytes memory code = initCode(feeHook, feeSplitVaultFactory, configuration);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) revert VaultAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        vault = LiquidityGrowthVaultV1(payable(deployed));

        bytes32 configurationHash = vault.configurationHash();
        configurationHashOf[deployed] = configurationHash;
        emit LiquidityGrowthVaultDeployed(
            deployed, address(feeHook), vault.poolId(), address(vault.upstreamVault()), salt, configurationHash
        );
    }

    function predict(
        bytes32 salt,
        EthCreatorFeeHookV3 feeHook,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory,
        LiquidityGrowthVaultV1.Configuration calldata configuration
    ) external view returns (address) {
        return Create2.computeAddress(salt, initCodeHash(feeHook, feeSplitVaultFactory, configuration));
    }

    function initCode(
        EthCreatorFeeHookV3 feeHook,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory,
        LiquidityGrowthVaultV1.Configuration calldata configuration
    ) public pure returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(LiquidityGrowthVaultV1).creationCode, abi.encode(feeHook, feeSplitVaultFactory, configuration)
        );
    }

    function initCodeHash(
        EthCreatorFeeHookV3 feeHook,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory,
        LiquidityGrowthVaultV1.Configuration calldata configuration
    ) public pure returns (bytes32) {
        return keccak256(initCode(feeHook, feeSplitVaultFactory, configuration));
    }

    function isFactoryVault(address vault) external view returns (bool) {
        return configurationHashOf[vault] != bytes32(0);
    }
}
