// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract RobinhoodCleanRoomInitializer {
    function noLiquidityAction() external pure returns (bytes4) {
        return this.noLiquidityAction.selector;
    }
}
