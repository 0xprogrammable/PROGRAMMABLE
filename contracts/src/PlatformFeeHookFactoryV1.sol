// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";

import { PlatformFeeHookV1 } from "./PlatformFeeHookV1.sol";

/// @title PlatformFeeHookFactoryV1
/// @notice Permissionless deterministic deployer and provenance registry for PlatformFeeHookV1.
/// @dev Salt mining happens offchain. The factory rejects addresses whose low bits do not exactly match V1.
contract PlatformFeeHookFactoryV1 {
    uint160 public constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 public constant REQUIRED_HOOK_FLAGS = (1 << 13) | (1 << 6) | (1 << 2);

    mapping(address hook => bytes32 configurationHash) public configurationHashOf;

    error HookAlreadyDeployed(address hook);
    error InvalidHookAddress(address predicted, uint160 actualFlags, uint160 requiredFlags);
    error DeploymentAddressMismatch(address actual, address predicted);

    event PlatformFeeHookDeployed(
        address indexed hook,
        bytes32 indexed configurationHash,
        bytes32 indexed salt,
        address poolManager,
        address authorized,
        address feeRecipient,
        address currency0,
        address currency1,
        bytes32 poolId
    );

    /// @notice Deploys a hook after its salt has been mined for the exact V1 callback mask.
    function deploy(
        bytes32 salt,
        IPoolManager poolManager,
        address authorized,
        address feeRecipient,
        Currency currency0,
        Currency currency1
    ) external returns (PlatformFeeHookV1 hook) {
        address predicted = predict(salt, poolManager, authorized, feeRecipient, currency0, currency1);
        uint160 actualFlags = uint160(predicted) & ALL_HOOK_MASK;
        if (actualFlags != REQUIRED_HOOK_FLAGS) {
            revert InvalidHookAddress(predicted, actualFlags, REQUIRED_HOOK_FLAGS);
        }
        if (predicted.code.length != 0) revert HookAlreadyDeployed(predicted);

        hook = new PlatformFeeHookV1{ salt: salt }(poolManager, authorized, feeRecipient, currency0, currency1);
        if (address(hook) != predicted) revert DeploymentAddressMismatch(address(hook), predicted);

        bytes32 configurationHash = hook.configurationHash();
        configurationHashOf[address(hook)] = configurationHash;

        emit PlatformFeeHookDeployed(
            address(hook),
            configurationHash,
            salt,
            address(poolManager),
            authorized,
            feeRecipient,
            Currency.unwrap(currency0),
            Currency.unwrap(currency1),
            hook.poolId()
        );
    }

    /// @notice Predicts the CREATE2 address for a hook configuration and salt.
    function predict(
        bytes32 salt,
        IPoolManager poolManager,
        address authorized,
        address feeRecipient,
        Currency currency0,
        Currency currency1
    ) public view returns (address) {
        bytes32 hash = initCodeHash(poolManager, authorized, feeRecipient, currency0, currency1);
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, hash)))));
    }

    /// @notice Returns the exact init-code hash used for CREATE2 salt mining.
    function initCodeHash(
        IPoolManager poolManager,
        address authorized,
        address feeRecipient,
        Currency currency0,
        Currency currency1
    ) public pure returns (bytes32) {
        // slither-disable-next-line too-many-digits
        return keccak256(
            abi.encodePacked(
                type(PlatformFeeHookV1).creationCode,
                abi.encode(poolManager, authorized, feeRecipient, currency0, currency1)
            )
        );
    }

    /// @notice True only for hooks deployed by this factory.
    function isFactoryHook(address hook) external view returns (bool) {
        return configurationHashOf[hook] != bytes32(0);
    }
}
