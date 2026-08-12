// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Exact Website-facing subset of reviewed ShardLaunchFactoryV1 at source commit 91b38f3d...da59.
interface IProgrammableExactShardsLaunchFactoryV1 {
    struct LaunchParams {
        int24 tickLower;
        int24 tickBand;
        int24 tickUpper;
        uint160 startSqrtPriceX96;
        address renderer;
        string tokenName;
        string tokenSymbol;
        string nftName;
        string nftSymbol;
    }

    function launch(bytes32 tokenSalt, bytes32 hookSalt, bytes calldata hookCreationCode, LaunchParams calldata params)
        external
        returns (address hook, address shard, address nft);
}
