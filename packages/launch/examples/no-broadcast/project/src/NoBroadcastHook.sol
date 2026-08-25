// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

type Currency is address;

interface IHooks {
    function afterInitialize(
        address sender,
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        int24 tick,
        bytes calldata hookData
    ) external returns (bytes4);
}

struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;
    int24 tickSpacing;
    IHooks hooks;
}

contract NoBroadcastHook is IHooks {
    address public token;
    address public poolManager;

    constructor(address token_, address poolManager_) {
        require(token_ != address(0), "token");
        require(poolManager_ != address(0), "poolManager");
        token = token_;
        poolManager = poolManager_;
    }

    function afterInitialize(
        address,
        PoolKey calldata,
        uint160,
        int24,
        bytes calldata
    ) external view returns (bytes4) {
        require(msg.sender == poolManager, "PoolManager only");
        return this.afterInitialize.selector;
    }
}
