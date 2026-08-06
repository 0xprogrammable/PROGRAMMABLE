// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IShardRendererV1 {
    function generate(uint256 seed) external pure returns (string memory);
    function generateDormant(uint256 tokenId) external pure returns (string memory);
    function attributes(uint256 seed) external pure returns (string memory);
}
