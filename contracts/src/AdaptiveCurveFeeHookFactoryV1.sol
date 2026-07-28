// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";

import { AdaptiveCurveFeeHookV1 } from "./AdaptiveCurveFeeHookV1.sol";

/// @title AdaptiveCurveFeeHookFactoryV1
/// @notice Deterministically deploys the shared Adaptive Curve hook at an exact Uniswap v4 hook address.
contract AdaptiveCurveFeeHookFactoryV1 {
    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    mapping(address hook => bytes32 configurationHash) public configurationHashOf;

    error HookAlreadyDeployed(address hook);
    error InvalidHookAddress(address hook, uint160 actualFlags, uint160 requiredFlags);
    error DeploymentAddressMismatch(address actual, address predicted);

    event AdaptiveCurveFeeHookDeployed(
        address indexed hook,
        address indexed poolManager,
        address indexed launcherFeeRecipient,
        bytes32 salt,
        bytes32 configurationHash
    );

    function deploy(bytes32 salt, IPoolManager poolManager, address launcherFeeRecipient)
        external
        returns (AdaptiveCurveFeeHookV1 hook)
    {
        bytes memory code = initCode(poolManager, launcherFeeRecipient);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        uint160 actualFlags = uint160(predicted) & ALL_HOOK_MASK;
        if (actualFlags != REQUIRED_HOOK_FLAGS) {
            revert InvalidHookAddress(predicted, actualFlags, REQUIRED_HOOK_FLAGS);
        }
        if (predicted.code.length != 0) revert HookAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        hook = AdaptiveCurveFeeHookV1(deployed);

        bytes32 configurationHash =
            keccak256(abi.encode(block.chainid, address(this), deployed, address(poolManager), launcherFeeRecipient));
        configurationHashOf[deployed] = configurationHash;

        emit AdaptiveCurveFeeHookDeployed(deployed, address(poolManager), launcherFeeRecipient, salt, configurationHash);
    }

    function predict(bytes32 salt, IPoolManager poolManager, address launcherFeeRecipient)
        public
        view
        returns (address)
    {
        return Create2.computeAddress(salt, initCodeHash(poolManager, launcherFeeRecipient));
    }

    function initCode(IPoolManager poolManager, address launcherFeeRecipient) public pure returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return
            abi.encodePacked(type(AdaptiveCurveFeeHookV1).creationCode, abi.encode(poolManager, launcherFeeRecipient));
    }

    function initCodeHash(IPoolManager poolManager, address launcherFeeRecipient) public pure returns (bytes32) {
        return keccak256(initCode(poolManager, launcherFeeRecipient));
    }

    function isFactoryHook(address hook) external view returns (bool) {
        return configurationHashOf[hook] != bytes32(0);
    }
}
