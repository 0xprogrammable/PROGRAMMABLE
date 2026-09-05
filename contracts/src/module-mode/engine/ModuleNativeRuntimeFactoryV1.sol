// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleNativeRuntimeV1 } from "../ModuleNativeRuntimeV1.sol";

/// @notice Creates exactly one fixed runtime for each already-deployed engine; no administrator or substitutions.
/// @dev Kept outside hook runtime bytecode to preserve EIP-170 deployment size limits.
contract ModuleNativeRuntimeFactoryV1 {
    mapping(address engine => ModuleNativeRuntimeV1) public runtimeOf;

    function create() external returns (ModuleNativeRuntimeV1 runtime) {
        runtime = runtimeOf[msg.sender];
        if (address(runtime) == address(0)) {
            runtime = new ModuleNativeRuntimeV1(msg.sender);
            runtimeOf[msg.sender] = runtime;
        }
    }
}
