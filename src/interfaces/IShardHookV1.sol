// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IShardHookV1 {
    function settleOnTransfer(uint256 tokenId, address from, address to) external;
    function claimable(address account) external view returns (uint256);
}
