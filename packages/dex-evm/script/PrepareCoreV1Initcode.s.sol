// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CoreV1 } from "../src/core/CoreV1.sol";

/// @notice Foundations-only, no-broadcast CoreV1 initcode encoder.
/// @dev This helper cannot read keys, sign, broadcast, choose a Collector, or create an owner gate.
///      Protected execution and any deployment classification remain BLOCKED_BY_SPEC.
contract PrepareCoreV1Initcode {
    bytes32 public constant STATUS = keccak256("DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR_V1");

    error ZeroConstitutionId();
    error ZeroCollector();

    function prepare(bytes32 constitutionId, address collector)
        external
        pure
        returns (bytes memory initcode, bytes32 initcodeHash)
    {
        if (constitutionId == bytes32(0)) revert ZeroConstitutionId();
        if (collector == address(0)) revert ZeroCollector();
        initcode = bytes.concat(type(CoreV1).creationCode, abi.encode(constitutionId, collector));
        initcodeHash = keccak256(initcode);
    }
}
