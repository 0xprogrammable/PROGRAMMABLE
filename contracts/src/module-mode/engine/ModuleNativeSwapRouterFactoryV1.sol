// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { ModuleNativeHookV1 } from "./ModuleNativeHookV1.sol";
import { ModuleNativeSwapRouterV1 } from "./ModuleNativeSwapRouterV1.sol";

/// @notice Fixed router construction, separated to keep launcher initcode below EIP-3860.
/// @dev The launch source binds this factory's reviewed deployed code hash in its constructor/release manifest.
contract ModuleNativeSwapRouterFactoryV1 {
    mapping(address source => ModuleNativeSwapRouterV1) public routerOf;
    error RouterAlreadyCreated();

    function create(IPoolManager manager, ModuleNativeHookV1 hook) external returns (ModuleNativeSwapRouterV1 router) {
        if (address(routerOf[msg.sender]) != address(0)) revert RouterAlreadyCreated();
        router = new ModuleNativeSwapRouterV1(manager, hook, msg.sender);
        routerOf[msg.sender] = router;
    }
}
