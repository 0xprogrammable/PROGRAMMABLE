// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { QuoteAssetFeeSplitVaultV1 } from "./QuoteAssetFeeSplitVaultV1.sol";
import { IQuoteAssetCreatorFeeHookV1 } from "./interfaces/IQuoteAssetCreatorFeeHookV1.sol";

/// @title QuoteAssetFeeSplitVaultFactoryV1
/// @notice Deterministically deploys immutable Stock-Paired creator-reward vaults.
contract QuoteAssetFeeSplitVaultFactoryV1 {
    mapping(address vault => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error VaultAlreadyDeployed(address vault);

    event QuoteAssetFeeSplitVaultDeployed(
        address indexed vault, address indexed feeHook, bytes32 indexed poolId, address quoteAsset
    );

    function deploy(
        bytes32 salt,
        IQuoteAssetCreatorFeeHookV1 feeHook,
        bytes32 poolId,
        IERC20 quoteAsset,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) external returns (QuoteAssetFeeSplitVaultV1 vault) {
        bytes memory code = initCode(feeHook, poolId, quoteAsset, beneficiaries, sharesBps);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) revert VaultAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        vault = QuoteAssetFeeSplitVaultV1(deployed);

        bytes32 configurationHash = vault.configurationHash();
        configurationHashOf[deployed] = configurationHash;
        emit QuoteAssetFeeSplitVaultDeployed(deployed, address(feeHook), poolId, address(quoteAsset));
    }

    function predict(
        bytes32 salt,
        IQuoteAssetCreatorFeeHookV1 feeHook,
        bytes32 poolId,
        IERC20 quoteAsset,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) external view returns (address) {
        return Create2.computeAddress(salt, initCodeHash(feeHook, poolId, quoteAsset, beneficiaries, sharesBps));
    }

    function initCode(
        IQuoteAssetCreatorFeeHookV1 feeHook,
        bytes32 poolId,
        IERC20 quoteAsset,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) public pure returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(QuoteAssetFeeSplitVaultV1).creationCode,
            abi.encode(feeHook, poolId, quoteAsset, beneficiaries, sharesBps)
        );
    }

    function initCodeHash(
        IQuoteAssetCreatorFeeHookV1 feeHook,
        bytes32 poolId,
        IERC20 quoteAsset,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) public pure returns (bytes32) {
        return keccak256(initCode(feeHook, poolId, quoteAsset, beneficiaries, sharesBps));
    }

    function isFactoryVault(address vault) external view returns (bool) {
        return configurationHashOf[vault] != bytes32(0);
    }
}
