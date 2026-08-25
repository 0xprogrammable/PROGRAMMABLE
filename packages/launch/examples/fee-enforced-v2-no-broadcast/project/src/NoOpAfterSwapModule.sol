// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

type BalanceDelta is int256;

/// @notice Clean-room isolated module that deliberately adds no swap delta.
contract NoOpAfterSwapModule {
    function afterSwapCustom(
        address,
        PoolKey calldata,
        SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) external returns (bytes4 selector, int128 customDelta) {
        return (this.afterSwapCustom.selector, 0);
    }
}
