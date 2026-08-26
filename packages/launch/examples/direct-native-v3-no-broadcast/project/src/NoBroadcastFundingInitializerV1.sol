// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface INoBroadcastEip3009Usdc {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @notice Offline fixture for the v2 nonce+r+s+v ABI-path authorization patch.
/// @dev It executes the real receiveWithAuthorization call shape and then deliberately reverts, so the packaged
///      example can never retain or move wallet funds even if someone ignores the no-broadcast instructions.
contract NoBroadcastFundingInitializerV1 {
    address private constant MAINNET_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    struct AuthorizationSignature {
        bytes32 r;
        bytes32 s;
        uint8 v;
    }

    struct FundingAuthorization {
        address from;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        AuthorizationSignature signature;
    }

    error NoBroadcastFixture();

    function initialize(FundingAuthorization calldata authorization) external {
        INoBroadcastEip3009Usdc(MAINNET_USDC).receiveWithAuthorization(
            authorization.from,
            address(this),
            authorization.value,
            authorization.validAfter,
            authorization.validBefore,
            authorization.nonce,
            authorization.signature.v,
            authorization.signature.r,
            authorization.signature.s
        );
        revert NoBroadcastFixture();
    }
}
