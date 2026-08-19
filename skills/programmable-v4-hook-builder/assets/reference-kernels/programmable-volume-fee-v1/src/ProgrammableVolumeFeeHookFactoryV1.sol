// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";

import { ProgrammableVolumeFeeHookV1 } from "./ProgrammableVolumeFeeHookV1.sol";

/// @notice Reference-only CREATE2 factory that enforces the exact v4 callback permission address bits.
/// @dev Reference candidate, not independently audited or deployed.
contract ProgrammableVolumeFeeHookFactoryV1 {
    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    mapping(address hook => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error HookAlreadyDeployed(address hook);
    error InvalidHookAddress(address hook, uint160 actualFlags, uint160 requiredFlags);

    event ProgrammableVolumeFeeHookDeployed(
        address indexed hook,
        address indexed poolManager,
        address indexed registrar,
        address quoteCurrency,
        address programmableFeeOwner,
        bytes32 salt,
        bytes32 configurationHash
    );

    function deploy(bytes32 salt, IPoolManager poolManager, address registrar, address quoteCurrency)
        external
        returns (ProgrammableVolumeFeeHookV1 hook)
    {
        bytes memory code = initCode(poolManager, registrar, quoteCurrency);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        uint160 actualFlags = uint160(predicted) & ALL_HOOK_MASK;
        if (actualFlags != REQUIRED_HOOK_FLAGS) {
            revert InvalidHookAddress(predicted, actualFlags, REQUIRED_HOOK_FLAGS);
        }
        if (predicted.code.length != 0) revert HookAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        hook = ProgrammableVolumeFeeHookV1(deployed);

        bytes32 configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                deployed,
                address(poolManager),
                registrar,
                quoteCurrency,
                hook.PROGRAMMABLE_FEE_OWNER(),
                hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP()
            )
        );
        configurationHashOf[deployed] = configurationHash;
        emit ProgrammableVolumeFeeHookDeployed(
            deployed,
            address(poolManager),
            registrar,
            quoteCurrency,
            hook.PROGRAMMABLE_FEE_OWNER(),
            salt,
            configurationHash
        );
    }

    function initCode(IPoolManager poolManager, address registrar, address quoteCurrency)
        public
        pure
        returns (bytes memory)
    {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(ProgrammableVolumeFeeHookV1).creationCode, abi.encode(poolManager, registrar, quoteCurrency)
        );
    }

    function initCodeHash(IPoolManager poolManager, address registrar, address quoteCurrency)
        external
        pure
        returns (bytes32)
    {
        return keccak256(initCode(poolManager, registrar, quoteCurrency));
    }
}
