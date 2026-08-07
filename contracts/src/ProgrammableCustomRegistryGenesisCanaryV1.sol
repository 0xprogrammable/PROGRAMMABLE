// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ProgrammableCustomRegistryGenesisCanaryV1
/// @notice Immutable project-only marker used for the first production Registry lifecycle.
/// @dev It has no owner, storage, initializer, external calls, payable path, token, pool, or market.
contract ProgrammableCustomRegistryGenesisCanaryV1 {
    bytes32 public constant CANARY_ID = keccak256("programmable.custom-registry-genesis-canary.v1");
    uint256 public constant CHAIN_ID = 1;
    uint64 public constant REGISTRY_GENERATION = 1;
    bool public constant PROJECT_ONLY = true;
}
