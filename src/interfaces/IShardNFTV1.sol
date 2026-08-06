// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IShardNFTV1 {
    function hook() external view returns (address);
    function MAX_SUPPLY() external view returns (uint256);
    function lowestAvailableId() external view returns (uint256);
    function isPoolHeld(uint256 tokenId) external view returns (bool);
    /// @notice IDs owned by users — the BACKING set. The core invariant
    ///         `shard.balanceOf(hook) == circulatingSupply() * 1e18` uses THIS,
    ///         not ShardFeeDistributorV1.circulating (the earning set, which lags a block).
    function circulatingSupply() external view returns (uint256);
    function acquire(address to, uint256 seed) external returns (uint256 tokenId);
    function release(address from, uint256 tokenId) external;
    function tokenSeed(uint256 tokenId) external view returns (uint256);
}
