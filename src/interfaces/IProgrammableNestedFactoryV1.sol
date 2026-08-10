// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Fixed launch-facing ABI for the bounded nested-factory route.
/// @dev This is the exact ABI exposed by the reviewed ShardLaunchFactoryV1. Implementations may be reused only when
///      every getter and the fixed launch selector have identical semantics; the Router never accepts arbitrary calls.
interface IProgrammableNestedFactoryV1 {
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

    function poolManager() external view returns (IPoolManager);

    function renderer() external view returns (address);

    function hookCreationCodeHash() external view returns (bytes32);

    function launcherFeeRecipient() external view returns (address);

    function builderFeeRecipient() external view returns (address);

    function resolveRenderer(address requested) external view returns (address);

    function effectiveTokenSalt(bytes32 tokenSalt, bytes32 hookSalt, LaunchParams calldata params)
        external
        view
        returns (bytes32);

    function predictToken(bytes32 tokenSalt, bytes32 hookSalt, LaunchParams calldata params)
        external
        view
        returns (address);

    function predictHook(bytes32 hookSalt, bytes calldata hookCreationCode, address token, LaunchParams calldata params)
        external
        view
        returns (address);

    function predictNFT(address hook, LaunchParams calldata params) external view returns (address);

    function computeConfigurationHash(
        address hook,
        address token,
        address nft,
        bytes32 tokenSalt,
        bytes32 hookSalt,
        LaunchParams calldata params
    ) external view returns (bytes32);

    function configurationHashOf(address hook) external view returns (bytes32);

    function launch(bytes32 tokenSalt, bytes32 hookSalt, bytes calldata hookCreationCode, LaunchParams calldata params)
        external
        returns (address hook, address token, address nft);
}

/// @notice Required post-launch hook views for the bounded nested-factory profile.
interface IProgrammableNestedHookV1 {
    function poolManager() external view returns (IPoolManager);

    function deployer() external view returns (address);

    function shard() external view returns (address);

    function nft() external view returns (address);

    function initialised() external view returns (bool);

    function poolKey() external view returns (PoolKey memory);
}

/// @notice Required post-launch NFT views for the bounded nested-factory profile.
interface IProgrammableNestedNftV1 {
    function hook() external view returns (address);

    function renderer() external view returns (address);
}
