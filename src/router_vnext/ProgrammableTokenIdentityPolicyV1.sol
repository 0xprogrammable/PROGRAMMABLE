// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Exact on-chain half of the Website token identity policy.
/// @dev The Website normalizes and commits exact UTF-8 bytes before permit issuance. This library independently
///      enforces byte/code-point bounds, valid UTF-8, unsafe-display exclusions, trim boundaries and the symbol class.
library ProgrammableTokenIdentityPolicyV1 {
    uint256 internal constant MAX_NAME_CHARACTERS = 32;
    uint256 internal constant MAX_NAME_BYTES = 48;
    uint256 internal constant MAX_SYMBOL_CHARACTERS = 10;
    uint256 internal constant MAX_SYMBOL_BYTES = 12;

    bytes32 internal constant SYMBOL_CLASS_HASH = keccak256("^[A-Z0-9]+$");
    bytes32 internal constant UNSAFE_DISPLAY_SET_HASH = keccak256("U+0000-001F,U+007F-009F,U+200B-200D,U+2060,U+FEFF");
    bytes32 internal constant TRIM_BOUNDARY_SET_HASH = keccak256("ECMAScript-WhiteSpace-LineTerminator");
    bytes32 internal constant NORMALIZATION_POLICY_HASH = keccak256("website-normalized-exact-utf8-bytes");
    bytes32 internal constant CONSTRAINTS_TYPEHASH = keccak256(
        "ProgrammableTokenIdentityConstraintsV1(uint256 maxNameCharacters,uint256 maxNameBytes,uint256 maxSymbolCharacters,uint256 maxSymbolBytes,bytes32 symbolClassHash,bytes32 unsafeDisplaySetHash,bytes32 trimBoundarySetHash,bytes32 normalizationPolicyHash)"
    );

    error InvalidTokenName();
    error InvalidTokenSymbol();

    function constraintsHash() internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CONSTRAINTS_TYPEHASH,
                MAX_NAME_CHARACTERS,
                MAX_NAME_BYTES,
                MAX_SYMBOL_CHARACTERS,
                MAX_SYMBOL_BYTES,
                SYMBOL_CLASS_HASH,
                UNSAFE_DISPLAY_SET_HASH,
                TRIM_BOUNDARY_SET_HASH,
                NORMALIZATION_POLICY_HASH
            )
        );
    }

    function validate(string calldata name_, string calldata symbol_)
        internal
        pure
        returns (bytes32 nameHash, bytes32 symbolHash)
    {
        bytes calldata nameBytes = bytes(name_);
        if (
            nameBytes.length == 0 || nameBytes.length > MAX_NAME_BYTES
                || !_isValidDisplayUtf8(nameBytes, MAX_NAME_CHARACTERS)
        ) revert InvalidTokenName();

        bytes calldata symbolBytes = bytes(symbol_);
        if (
            symbolBytes.length == 0 || symbolBytes.length > MAX_SYMBOL_BYTES
                || symbolBytes.length > MAX_SYMBOL_CHARACTERS
        ) revert InvalidTokenSymbol();
        for (uint256 index; index < symbolBytes.length; ++index) {
            uint8 character = uint8(symbolBytes[index]);
            if ((character < 0x41 || character > 0x5a) && (character < 0x30 || character > 0x39)) {
                revert InvalidTokenSymbol();
            }
        }
        nameHash = keccak256(nameBytes);
        symbolHash = keccak256(symbolBytes);
    }

    function _isValidDisplayUtf8(bytes calldata value, uint256 maximumCharacters) private pure returns (bool) {
        uint256 index;
        uint256 characters;
        while (index < value.length) {
            uint8 first = uint8(value[index]);
            uint32 codePoint;
            uint256 sequenceLength;

            if (first <= 0x7f) {
                codePoint = first;
                sequenceLength = 1;
            } else if (first >= 0xc2 && first <= 0xdf) {
                if (index + 1 >= value.length) return false;
                uint8 second = uint8(value[index + 1]);
                if (!_isContinuation(second)) return false;
                codePoint = (uint32(first & 0x1f) << 6) | uint32(second & 0x3f);
                sequenceLength = 2;
            } else if (first >= 0xe0 && first <= 0xef) {
                if (index + 2 >= value.length) return false;
                uint8 second = uint8(value[index + 1]);
                uint8 third = uint8(value[index + 2]);
                if (
                    !_isContinuation(second) || !_isContinuation(third) || (first == 0xe0 && second < 0xa0)
                        || (first == 0xed && second >= 0xa0)
                ) return false;
                codePoint = (uint32(first & 0x0f) << 12) | (uint32(second & 0x3f) << 6) | uint32(third & 0x3f);
                sequenceLength = 3;
            } else if (first >= 0xf0 && first <= 0xf4) {
                if (index + 3 >= value.length) return false;
                uint8 second = uint8(value[index + 1]);
                uint8 third = uint8(value[index + 2]);
                uint8 fourth = uint8(value[index + 3]);
                if (
                    !_isContinuation(second) || !_isContinuation(third) || !_isContinuation(fourth)
                        || (first == 0xf0 && second < 0x90) || (first == 0xf4 && second > 0x8f)
                ) return false;
                codePoint = (uint32(first & 0x07) << 18) | (uint32(second & 0x3f) << 12) | (uint32(third & 0x3f) << 6)
                    | uint32(fourth & 0x3f);
                sequenceLength = 4;
            } else {
                return false;
            }

            if (
                _isUnsafeDisplayCodePoint(codePoint)
                    || ((index == 0 || index + sequenceLength == value.length) && _isTrimCodePoint(codePoint))
            ) return false;
            unchecked {
                ++characters;
                index += sequenceLength;
            }
            if (characters > maximumCharacters) return false;
        }
        return true;
    }

    function _isContinuation(uint8 value) private pure returns (bool) {
        return value >= 0x80 && value <= 0xbf;
    }

    function _isUnsafeDisplayCodePoint(uint32 codePoint) private pure returns (bool) {
        return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
            || (codePoint >= 0x200b && codePoint <= 0x200d) || codePoint == 0x2060 || codePoint == 0xfeff;
    }

    function _isTrimCodePoint(uint32 codePoint) private pure returns (bool) {
        return codePoint == 0x20 || codePoint == 0xa0 || codePoint == 0x1680
            || (codePoint >= 0x2000 && codePoint <= 0x200a) || codePoint == 0x2028 || codePoint == 0x2029
            || codePoint == 0x202f || codePoint == 0x205f || codePoint == 0x3000 || codePoint == 0xfeff;
    }
}
