// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

type Currency is address;
type BeforeSwapDelta is int256;

struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

contract RobinhoodCleanRoomHook {
    error NotPoolManager();

    address public immutable poolManager;

    constructor(address poolManager_) {
        require(poolManager_ != address(0), "zero PoolManager");
        poolManager = poolManager_;
    }

    function beforeSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        bytes calldata
    ) external view returns (bytes4, BeforeSwapDelta, uint24) {
        if (msg.sender != poolManager) revert NotPoolManager();
        return (this.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);
    }
}
