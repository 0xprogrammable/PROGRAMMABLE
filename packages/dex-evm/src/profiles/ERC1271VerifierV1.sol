// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC1271V1 } from "../interfaces/IERC1271V1.sol";

/// @notice Hostile-call verifier for one exact ERC-1271 return profile.
/// @dev Accepts exactly one ABI word whose leading four bytes equal 0x1626ba7e.
library ERC1271VerifierV1 {
    bytes4 internal constant MAGIC_VALUE = 0x1626ba7e;
    uint256 internal constant WALLET_CALL_GAS_LIMIT = 50_000;
    uint256 internal constant POST_WALLET_GAS_RESERVE = 75_000;
    uint256 internal constant PRE_CALL_OVERHEAD_ALLOWANCE = 20_000;
    uint256 internal constant MAX_SIGNATURE_BYTES = 1024;
    uint256 internal constant EXACT_RETURN_BYTES = 32;

    error WalletHasNoCode(address wallet);
    error SignatureTooLarge(uint256 actualLength, uint256 maximumLength);
    error InsufficientVerifierGas(uint256 available, uint256 required);
    error WalletCallFailed(address wallet);
    error InvalidWalletReturnLength(uint256 actualLength);
    error InvalidWalletMagic(bytes32 actualWord);

    function verify(address wallet, bytes32 digest, bytes memory signature) internal view {
        if (wallet.code.length == 0) revert WalletHasNoCode(wallet);
        if (signature.length > MAX_SIGNATURE_BYTES) {
            revert SignatureTooLarge(signature.length, MAX_SIGNATURE_BYTES);
        }

        uint256 requiredGas = WALLET_CALL_GAS_LIMIT + POST_WALLET_GAS_RESERVE + PRE_CALL_OVERHEAD_ALLOWANCE;
        uint256 availableGas = gasleft();
        if (availableGas <= requiredGas) revert InsufficientVerifierGas(availableGas, requiredGas);

        bytes memory payload = abi.encodeCall(IERC1271V1.isValidSignature, (digest, signature));
        bool success;
        uint256 returnSize;
        bytes32 returnWord = bytes32(0);
        assembly ("memory-safe") {
            success := staticcall(WALLET_CALL_GAS_LIMIT, wallet, add(payload, 0x20), mload(payload), 0, 0)
            returnSize := returndatasize()
            if and(success, eq(returnSize, EXACT_RETURN_BYTES)) {
                returndatacopy(0, 0, EXACT_RETURN_BYTES)
                returnWord := mload(0)
            }
        }
        uint256 postCallGas = gasleft();
        if (postCallGas <= POST_WALLET_GAS_RESERVE) {
            revert InsufficientVerifierGas(postCallGas, POST_WALLET_GAS_RESERVE);
        }

        if (!success) revert WalletCallFailed(wallet);
        if (returnSize != EXACT_RETURN_BYTES) revert InvalidWalletReturnLength(returnSize);
        if (returnWord != bytes32(MAGIC_VALUE)) revert InvalidWalletMagic(returnWord);
    }
}
