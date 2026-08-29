// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TransferObservationV1 } from "../interfaces/IDomainVaultV1.sol";

/// @notice Exact measured transfer primitives for the strict ERC-20 profile.
/// @dev This profile rejects empty, malformed, false, taxed, and over-debit transfers.
///      A successful observation is not a claim about proxy storage, issuer powers,
///      future rebases, confiscation, or deceptive balanceOf implementations.
library StrictMeasuredERC20ProfileV1 {
    uint256 internal constant BALANCE_CALL_GAS_LIMIT = 40_000;
    uint256 internal constant TRANSFER_CALL_GAS_LIMIT = 120_000;
    uint256 internal constant POST_TOKEN_GAS_RESERVE = 100_000;
    uint256 internal constant PRE_CALL_OVERHEAD_ALLOWANCE = 10_000;
    uint256 internal constant EXACT_RETURN_BYTES = 32;

    bytes4 internal constant BALANCE_OF_SELECTOR = 0x70a08231;
    bytes4 internal constant TRANSFER_SELECTOR = 0xa9059cbb;
    bytes4 internal constant TRANSFER_FROM_SELECTOR = 0x23b872dd;

    error InvalidToken(address token);
    error InvalidEndpoint(address endpoint);
    error AliasedEndpoints(address endpoint);
    error ZeroAmount();
    error InsufficientTokenCallGas(uint256 available, uint256 required);
    error TokenCallFailed(address token, bytes4 selector);
    error InvalidTokenReturnLength(address token, bytes4 selector, uint256 actualLength);
    error InvalidTokenBoolean(address token, bytes4 selector, uint256 actualValue);
    error InvalidBalanceDirection(address token, address account, uint256 beforeBalance, uint256 afterBalance);
    error SourceDebitMismatch(uint256 requested, uint256 observed);
    error DestinationCreditMismatch(uint256 requested, uint256 observed);

    function pullExact(address token, address source, uint128 amount)
        internal
        returns (TransferObservationV1 memory observation)
    {
        _validateTokenAndEndpoints(token, source, address(this), amount);

        uint256 sourceBefore = balanceOfExact(token, source);
        uint256 destinationBefore = balanceOfExact(token, address(this));
        _callBoolean(
            token,
            TRANSFER_FROM_SELECTOR,
            abi.encodeWithSelector(TRANSFER_FROM_SELECTOR, source, address(this), uint256(amount))
        );
        uint256 sourceAfter = balanceOfExact(token, source);
        uint256 destinationAfter = balanceOfExact(token, address(this));

        observation = _measure(
            token,
            source,
            address(this),
            uint256(amount),
            sourceBefore,
            sourceAfter,
            destinationBefore,
            destinationAfter
        );
    }

    function pushExact(address token, address recipient, uint128 amount)
        internal
        returns (TransferObservationV1 memory observation)
    {
        _validateTokenAndEndpoints(token, address(this), recipient, amount);

        uint256 sourceBefore = balanceOfExact(token, address(this));
        uint256 destinationBefore = balanceOfExact(token, recipient);
        _callBoolean(token, TRANSFER_SELECTOR, abi.encodeWithSelector(TRANSFER_SELECTOR, recipient, uint256(amount)));
        uint256 sourceAfter = balanceOfExact(token, address(this));
        uint256 destinationAfter = balanceOfExact(token, recipient);

        observation = _measure(
            token,
            address(this),
            recipient,
            uint256(amount),
            sourceBefore,
            sourceAfter,
            destinationBefore,
            destinationAfter
        );
    }

    function balanceOfExact(address token, address account) internal view returns (uint256 value) {
        if (token.code.length == 0) revert InvalidToken(token);
        _requireGas(BALANCE_CALL_GAS_LIMIT);

        bytes memory payload = abi.encodeWithSelector(BALANCE_OF_SELECTOR, account);
        bool success;
        uint256 returnSize;
        assembly ("memory-safe") {
            success := staticcall(BALANCE_CALL_GAS_LIMIT, token, add(payload, 0x20), mload(payload), 0, 0)
            returnSize := returndatasize()
            if and(success, eq(returnSize, EXACT_RETURN_BYTES)) {
                returndatacopy(0, 0, EXACT_RETURN_BYTES)
                value := mload(0)
            }
        }
        _requirePostCallGas();

        if (!success) revert TokenCallFailed(token, BALANCE_OF_SELECTOR);
        if (returnSize != EXACT_RETURN_BYTES) {
            revert InvalidTokenReturnLength(token, BALANCE_OF_SELECTOR, returnSize);
        }
    }

    function _callBoolean(address token, bytes4 selector, bytes memory payload) private {
        _requireGas(TRANSFER_CALL_GAS_LIMIT);

        bool success;
        uint256 returnSize;
        uint256 returnWord = 0;
        assembly ("memory-safe") {
            success := call(TRANSFER_CALL_GAS_LIMIT, token, 0, add(payload, 0x20), mload(payload), 0, 0)
            returnSize := returndatasize()
            if and(success, eq(returnSize, EXACT_RETURN_BYTES)) {
                returndatacopy(0, 0, EXACT_RETURN_BYTES)
                returnWord := mload(0)
            }
        }
        _requirePostCallGas();

        if (!success) revert TokenCallFailed(token, selector);
        if (returnSize != EXACT_RETURN_BYTES) revert InvalidTokenReturnLength(token, selector, returnSize);
        if (returnWord != 1) revert InvalidTokenBoolean(token, selector, returnWord);
    }

    function _measure(
        address token,
        address source,
        address destination,
        uint256 requested,
        uint256 sourceBefore,
        uint256 sourceAfter,
        uint256 destinationBefore,
        uint256 destinationAfter
    ) private pure returns (TransferObservationV1 memory observation) {
        if (sourceAfter > sourceBefore) {
            revert InvalidBalanceDirection(token, source, sourceBefore, sourceAfter);
        }
        if (destinationAfter < destinationBefore) {
            revert InvalidBalanceDirection(token, destination, destinationBefore, destinationAfter);
        }

        uint256 sourceDebit = sourceBefore - sourceAfter;
        uint256 destinationCredit = destinationAfter - destinationBefore;
        if (sourceDebit != requested) revert SourceDebitMismatch(requested, sourceDebit);
        if (destinationCredit != requested) revert DestinationCreditMismatch(requested, destinationCredit);

        observation =
            TransferObservationV1({ grossSourceDebit: sourceDebit, spendableDestinationCredit: destinationCredit });
    }

    function _validateTokenAndEndpoints(address token, address source, address destination, uint128 amount)
        private
        view
    {
        if (token.code.length == 0) revert InvalidToken(token);
        if (source == address(0)) revert InvalidEndpoint(source);
        if (destination == address(0)) revert InvalidEndpoint(destination);
        if (source == destination) revert AliasedEndpoints(source);
        if (amount == 0) revert ZeroAmount();
    }

    function _requireGas(uint256 callLimit) private view {
        uint256 required = callLimit + POST_TOKEN_GAS_RESERVE + PRE_CALL_OVERHEAD_ALLOWANCE;
        uint256 available = gasleft();
        if (available <= required) revert InsufficientTokenCallGas(available, required);
    }

    function _requirePostCallGas() private view {
        uint256 available = gasleft();
        if (available <= POST_TOKEN_GAS_RESERVE) {
            revert InsufficientTokenCallGas(available, POST_TOKEN_GAS_RESERVE);
        }
    }
}
