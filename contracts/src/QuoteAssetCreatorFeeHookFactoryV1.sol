// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";

import { QuoteAssetCreatorFeeHookV1 } from "./QuoteAssetCreatorFeeHookV1.sol";
import { QuoteAssetFeeSplitVaultFactoryV1 } from "./QuoteAssetFeeSplitVaultFactoryV1.sol";
import { StockQuoteRegistryV1 } from "./StockQuoteRegistryV1.sol";

/// @title QuoteAssetCreatorFeeHookFactoryV1
/// @notice Deterministically deploys the shared Stock-Paired fee hook at a valid v4 hook address.
contract QuoteAssetCreatorFeeHookFactoryV1 {
    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    mapping(address hook => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error HookAlreadyDeployed(address hook);
    error InvalidHookAddress(address hook, uint160 actualFlags, uint160 requiredFlags);

    event QuoteAssetCreatorFeeHookDeployed(
        address indexed hook, address indexed poolManager, address indexed launcherFeeRecipient, address quoteRegistry
    );

    function deploy(
        bytes32 salt,
        IPoolManager poolManager,
        address launcherFeeRecipient,
        StockQuoteRegistryV1 quoteRegistry,
        QuoteAssetFeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) external returns (QuoteAssetCreatorFeeHookV1 hook) {
        bytes memory code = initCode(poolManager, launcherFeeRecipient, quoteRegistry, feeSplitVaultFactory);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        uint160 actualFlags = uint160(predicted) & ALL_HOOK_MASK;
        if (actualFlags != REQUIRED_HOOK_FLAGS) {
            revert InvalidHookAddress(predicted, actualFlags, REQUIRED_HOOK_FLAGS);
        }
        if (predicted.code.length != 0) revert HookAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        hook = QuoteAssetCreatorFeeHookV1(deployed);

        bytes32 configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                deployed,
                address(poolManager),
                launcherFeeRecipient,
                address(quoteRegistry),
                quoteRegistry.configurationHash(),
                address(feeSplitVaultFactory)
            )
        );
        configurationHashOf[deployed] = configurationHash;
        emit QuoteAssetCreatorFeeHookDeployed(
            deployed, address(poolManager), launcherFeeRecipient, address(quoteRegistry)
        );
    }

    function predict(
        bytes32 salt,
        IPoolManager poolManager,
        address launcherFeeRecipient,
        StockQuoteRegistryV1 quoteRegistry,
        QuoteAssetFeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) external view returns (address) {
        return Create2.computeAddress(
            salt, initCodeHash(poolManager, launcherFeeRecipient, quoteRegistry, feeSplitVaultFactory)
        );
    }

    function initCode(
        IPoolManager poolManager,
        address launcherFeeRecipient,
        StockQuoteRegistryV1 quoteRegistry,
        QuoteAssetFeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) public pure returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(QuoteAssetCreatorFeeHookV1).creationCode,
            abi.encode(poolManager, launcherFeeRecipient, quoteRegistry, feeSplitVaultFactory)
        );
    }

    function initCodeHash(
        IPoolManager poolManager,
        address launcherFeeRecipient,
        StockQuoteRegistryV1 quoteRegistry,
        QuoteAssetFeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) public pure returns (bytes32) {
        return keccak256(initCode(poolManager, launcherFeeRecipient, quoteRegistry, feeSplitVaultFactory));
    }

    function isFactoryHook(address hook) external view returns (bool) {
        return configurationHashOf[hook] != bytes32(0);
    }
}
