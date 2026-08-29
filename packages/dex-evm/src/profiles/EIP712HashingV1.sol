// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Isolated EIP-712 digest framing with no Authorization Scope conformance claim.
/// @dev The portable-to-native domain and signed-structure grammar are BLOCKED_BY_SPEC,
///      so this library intentionally does not define a domain separator or type hash.
library EIP712HashingV1 {
    function hashTypedData(bytes32 domainSeparator_, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", domainSeparator_, structHash));
    }
}
