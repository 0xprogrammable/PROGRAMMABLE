// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal interface used by the shared Classic CTO authority.
interface IClassicCtoVaultV1 {
    function executeCto(address[] calldata beneficiaries, uint16[] calldata sharesBps, bytes32 approvalReference)
        external;
}
