// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC1271V1 {
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4 magicValue);
}
