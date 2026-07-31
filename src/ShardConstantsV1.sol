// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library ShardConstantsV1 {
    uint256 internal constant MAX_NFTS = 10_000;
    uint256 internal constant SHARDS_PER_NFT = 1 ether;
    uint256 internal constant FEE_BPS = 100; // 1%
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint24 internal constant POOL_FEE = 0; // the hook takes the fee, not the LP
    int24 internal constant TICK_SPACING = 60;
    uint256 internal constant ACC_PRECISION = 1e18;

    /// @notice SHARD seeded into the FULL-RANGE position, the one that runs to infinity.
    ///         Thin on its own: it is what keeps the collection undrainable.
    uint256 internal constant SEED_FULL_RANGE = 3000 ether;

    /// @notice SHARD seeded into the concentrated BAND, stacked on top of the full range so
    ///         both are active below the band edge. This is what holds prices affordable
    ///         through the bulk of the collection.
    uint256 internal constant SEED_BAND = 7000 ether;
}
