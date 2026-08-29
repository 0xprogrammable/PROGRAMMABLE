// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC1271V1 } from "../../src/interfaces/IERC1271V1.sol";

contract ValidERC1271WalletMock is IERC1271V1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return IERC1271V1.isValidSignature.selector;
    }
}

contract WrongMagicERC1271WalletMock is IERC1271V1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0xffffffff;
    }
}

contract NonCanonicalTrailingERC1271WalletMock is IERC1271V1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        bytes32 invalidWord = bytes32(IERC1271V1.isValidSignature.selector) | bytes32(uint256(1));
        assembly ("memory-safe") {
            mstore(0, invalidWord)
            return(0, 0x20)
        }
    }
}

contract RawFourByteERC1271WalletMock is IERC1271V1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        bytes4 magic = IERC1271V1.isValidSignature.selector;
        assembly ("memory-safe") {
            mstore(0, magic)
            return(0, 4)
        }
    }
}

contract OversizedERC1271WalletMock is IERC1271V1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        bytes4 magic = IERC1271V1.isValidSignature.selector;
        assembly ("memory-safe") {
            mstore(0, magic)
            mstore(0x20, 0)
            return(0, 0x40)
        }
    }
}

contract RevertingERC1271WalletMock is IERC1271V1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        revert("HOSTILE_WALLET");
    }
}

contract GasGriefERC1271WalletMock is IERC1271V1 {
    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
        uint256 accumulator = 0;
        while (gasleft() > 100) {
            unchecked {
                ++accumulator;
            }
        }
        if (accumulator == 0) return bytes4(0);
        return IERC1271V1.isValidSignature.selector;
    }
}
