// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Exact 65-byte, low-s ECDSA recovery utility.
/// @dev This utility does not classify an address as permanently EOA and does not define Scope semantics.
library CanonicalEOASignatureV1 {
    uint256 internal constant SECP256K1N_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    error InvalidSignatureLength(uint256 actualLength);
    error InvalidSignatureS(bytes32 s);
    error InvalidSignatureV(uint8 v);
    error InvalidRecoveredSigner();

    function recover(bytes32 digest, bytes memory signature) internal pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignatureLength(signature.length);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        if (uint256(s) > SECP256K1N_HALF || s == bytes32(0)) revert InvalidSignatureS(s);
        if (v != 27 && v != 28) revert InvalidSignatureV(v);

        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidRecoveredSigner();
    }
}
