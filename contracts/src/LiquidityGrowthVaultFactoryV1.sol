// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "./LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthVaultV1 } from "./LiquidityGrowthVaultV1.sol";

/// @title LiquidityGrowthVaultFactoryV1
/// @notice Deterministically deploys immutable LiquidityGrowth routing and compounding vaults.
contract LiquidityGrowthVaultFactoryV1 {
    mapping(address vault => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error UnrecognizedVault(address vault);

    event LiquidityGrowthVaultDeployed(
        address indexed vault,
        address indexed feeHook,
        bytes32 indexed poolId,
        address upstreamVault,
        bytes32 salt,
        bytes32 configurationHash
    );

    /// @notice Deploys the exact deterministic vault or returns the previously factory-recorded instance.
    /// @dev A contract occupying the CREATE2 address without matching factory provenance is rejected.
    function deployOrGet(
        bytes32 salt,
        LiquidityGrowthFeeOracleHookV1 feeHook,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory,
        LiquidityGrowthVaultV1.Configuration calldata configuration
    ) external returns (LiquidityGrowthVaultV1 vault) {
        bytes memory code = _initCode(feeHook, feeSplitVaultFactory, configuration);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) {
            vault = LiquidityGrowthVaultV1(payable(predicted));
            bytes32 recordedHash = configurationHashOf[predicted];
            if (recordedHash == bytes32(0) || vault.configurationHash() != recordedHash) {
                revert UnrecognizedVault(predicted);
            }
            return vault;
        }

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        vault = LiquidityGrowthVaultV1(payable(deployed));

        bytes32 configurationHash = vault.configurationHash();
        configurationHashOf[deployed] = configurationHash;
        emit LiquidityGrowthVaultDeployed(
            deployed, address(feeHook), vault.poolId(), address(vault.upstreamVault()), salt, configurationHash
        );
    }

    function _initCode(
        LiquidityGrowthFeeOracleHookV1 feeHook,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory,
        LiquidityGrowthVaultV1.Configuration calldata configuration
    ) private pure returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(LiquidityGrowthVaultV1).creationCode, abi.encode(feeHook, feeSplitVaultFactory, configuration)
        );
    }
}
