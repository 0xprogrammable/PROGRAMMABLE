// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Terminal initializer fixture that exposes the exact static EIP-3009 signature-word ABI shape.
/// @dev This contract intentionally cannot move funding or initialize a pool. The V3 no-broadcast example stops
///      before any wallet signature. A production initializer is a separately reviewed artifact and is not simulated
///      by this fixture.
contract NoBroadcastFundingInitializerV1 {
    error NoBroadcastFixture();

    /// @dev `r`, `s`, and `v` are top-level scalar words at calldata byte offsets 4, 36, and 68 respectively.
    function initialize(bytes32 r, bytes32 s, uint8 v) external pure {
        r;
        s;
        v;
        revert NoBroadcastFixture();
    }
}
