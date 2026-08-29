// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TransferObservationV1 } from "../interfaces/IDomainVaultV1.sol";

/// @notice Exact measured native-ETH transfer primitive with fixed gas and returndata caps.
library NativeETHProfileV1 {
    // A nonzero-value CALL adds the 2,300-gas stipend: 47,700 + 2,300 = 50,000.
    uint256 internal constant RECIPIENT_CALL_GAS_ARGUMENT = 47_700;
    uint256 internal constant POST_RECIPIENT_GAS_RESERVE = 75_000;
    uint256 internal constant PRE_CALL_OVERHEAD_ALLOWANCE = 40_000;
    uint256 internal constant MAX_RETURN_BYTES = 256;

    error InvalidRecipient(address recipient);
    error ZeroAmount();
    error InsufficientNativeCallGas(uint256 available, uint256 required);
    error NativeTransferFailed(address recipient, uint256 amount);
    error NativeReturnDataTooLarge(uint256 actualLength, uint256 maximumLength);
    error NativeSourceDebitMismatch(uint256 requested, uint256 observed);
    error NativeDestinationCreditMismatch(uint256 requested, uint256 observed);

    function pushExact(address payable recipient, uint128 amount)
        internal
        returns (TransferObservationV1 memory observation)
    {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient(recipient);
        if (amount == 0) revert ZeroAmount();

        uint256 required = RECIPIENT_CALL_GAS_ARGUMENT + POST_RECIPIENT_GAS_RESERVE + PRE_CALL_OVERHEAD_ALLOWANCE;
        uint256 available = gasleft();
        if (available <= required) revert InsufficientNativeCallGas(available, required);

        uint256 sourceBefore = address(this).balance;
        uint256 destinationBefore = recipient.balance;
        bool success;
        uint256 returnSize;
        assembly ("memory-safe") {
            success := call(RECIPIENT_CALL_GAS_ARGUMENT, recipient, amount, 0, 0, 0, 0)
            returnSize := returndatasize()
        }
        uint256 postCallGas = gasleft();
        if (postCallGas <= POST_RECIPIENT_GAS_RESERVE) {
            revert InsufficientNativeCallGas(postCallGas, POST_RECIPIENT_GAS_RESERVE);
        }
        if (!success) revert NativeTransferFailed(recipient, amount);
        if (returnSize > MAX_RETURN_BYTES) revert NativeReturnDataTooLarge(returnSize, MAX_RETURN_BYTES);

        uint256 sourceAfter = address(this).balance;
        uint256 destinationAfter = recipient.balance;
        if (sourceAfter > sourceBefore) revert NativeSourceDebitMismatch(amount, 0);
        if (destinationAfter < destinationBefore) revert NativeDestinationCreditMismatch(amount, 0);

        uint256 sourceDebit = sourceBefore - sourceAfter;
        uint256 destinationCredit = destinationAfter - destinationBefore;
        if (sourceDebit != amount) revert NativeSourceDebitMismatch(amount, sourceDebit);
        if (destinationCredit != amount) revert NativeDestinationCreditMismatch(amount, destinationCredit);

        observation =
            TransferObservationV1({ grossSourceDebit: sourceDebit, spendableDestinationCredit: destinationCredit });
    }
}
