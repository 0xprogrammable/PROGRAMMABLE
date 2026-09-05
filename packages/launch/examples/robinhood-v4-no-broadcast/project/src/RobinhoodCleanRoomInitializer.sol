// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "./RobinhoodCleanRoomHook.sol";

interface ICleanRoomPoolManager {
    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24);
}

contract RobinhoodCleanRoomInitializer {
    constructor(address poolManager, address token, address hook) {
        ICleanRoomPoolManager(poolManager).initialize(
            PoolKey({
                currency0: address(0),
                currency1: token,
                fee: 3000,
                tickSpacing: 60,
                hooks: hook
            }),
            uint160(1 << 96)
        );
    }

    function noLiquidityAction() external pure returns (bytes4) {
        return this.noLiquidityAction.selector;
    }
}
