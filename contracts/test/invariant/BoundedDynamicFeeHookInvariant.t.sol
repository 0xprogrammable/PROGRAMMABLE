// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { BoundedDynamicFeeHookFactoryV1 } from "../../src/BoundedDynamicFeeHookFactoryV1.sol";
import { BoundedDynamicFeeHookV1 } from "../../src/BoundedDynamicFeeHookV1.sol";

contract DynamicFeePermissionlessCollector {
    function collect(BoundedDynamicFeeHookV1 hook) external {
        hook.handleHookFees(new Currency[](0));
    }
}

contract BoundedDynamicFeeHookHandler is Test {
    using SafeCast for uint256;

    PoolSwapTest internal immutable router;
    BoundedDynamicFeeHookV1 internal immutable hook;
    DynamicFeePermissionlessCollector internal immutable collector;
    PoolKey internal key;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    constructor(
        PoolSwapTest router_,
        BoundedDynamicFeeHookV1 hook_,
        DynamicFeePermissionlessCollector collector_,
        Currency currency0,
        Currency currency1
    ) {
        router = router_;
        hook = hook_;
        collector = collector_;
        key = hook_.poolKey();

        IERC20(Currency.unwrap(currency0)).approve(address(router_), type(uint256).max);
        IERC20(Currency.unwrap(currency1)).approve(address(router_), type(uint256).max);
    }

    function swapExactInput(uint128 rawAmount, bool zeroForOne) external {
        _swap(rawAmount, zeroForOne);
    }

    function advanceBlockAndSwap(uint32 rawBlocks, uint128 rawAmount, bool zeroForOne) external {
        vm.roll(block.number + 1 + (uint256(rawBlocks) % 32));
        _swap(rawAmount, zeroForOne);
    }

    function collect() external {
        collector.collect(hook);
    }

    function _swap(uint128 rawAmount, bool zeroForOne) private {
        uint256 amount = 1e8 + (uint256(rawAmount) % 1e14);
        router.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -amount.toInt256(),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }
}

contract BoundedDynamicFeeHookInvariantTest is Deployers {
    using LPFeeLibrary for uint24;
    using StateLibrary for IPoolManager;

    BoundedDynamicFeeHookFactoryV1 internal factory;
    BoundedDynamicFeeHookV1 internal hook;
    BoundedDynamicFeeHookHandler internal handler;
    DynamicFeePermissionlessCollector internal collector;
    PoolKey internal dynamicKey;

    address internal feeRecipient;
    bytes32 internal initialConfigurationHash;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        factory = new BoundedDynamicFeeHookFactoryV1();
        feeRecipient = makeAddr("dynamicInvariantFeeRecipient");

        (address predicted, bytes32 salt) = HookMiner.find(
            address(factory),
            factory.REQUIRED_HOOK_FLAGS(),
            type(BoundedDynamicFeeHookV1).creationCode,
            abi.encode(manager, address(this), feeRecipient, currency0, currency1)
        );
        hook = factory.deploy(salt, manager, address(this), feeRecipient, currency0, currency1);
        assertEq(address(hook), predicted);

        dynamicKey = hook.poolKey();
        manager.initialize(dynamicKey, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(dynamicKey, LIQUIDITY_PARAMS, ZERO_BYTES);

        collector = new DynamicFeePermissionlessCollector();
        handler = new BoundedDynamicFeeHookHandler(swapRouter, hook, collector, currency0, currency1);
        currency0.transfer(address(handler), 1e30);
        currency1.transfer(address(handler), 1e30);

        initialConfigurationHash = hook.configurationHash();

        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = BoundedDynamicFeeHookHandler.swapExactInput.selector;
        selectors[1] = BoundedDynamicFeeHookHandler.advanceBlockAndSwap.selector;
        selectors[2] = BoundedDynamicFeeHookHandler.collect.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_configurationAndAuthoritiesNeverChange() public view {
        assertEq(hook.configurationHash(), initialConfigurationHash);
        assertEq(factory.configurationHashOf(address(hook)), initialConfigurationHash);
        assertTrue(factory.isFactoryHook(address(hook)));
        assertEq(hook.authorized(), address(this));
        assertEq(hook.feeRecipient(), feeRecipient);
        assertEq(hook.currency0(), Currency.unwrap(currency0));
        assertEq(hook.currency1(), Currency.unwrap(currency1));
        assertEq(hook.poolId(), PoolId.unwrap(dynamicKey.toId()));
    }

    function invariant_dynamicLpFeeIsAlwaysInstalledAndBounded() public view {
        uint24 currentFee = hook.currentLpFee();
        (,,, uint24 installedFee) = manager.getSlot0(dynamicKey.toId());

        assertTrue(dynamicKey.fee.isDynamicFee());
        assertGe(currentFee, hook.BASE_LP_FEE_PIPS());
        assertLe(currentFee, hook.MAX_LP_FEE_PIPS());
        assertEq(installedFee, currentFee);
        assertLe(hook.referenceBlock(), block.number);
    }

    function invariant_onlyImmutableRecipientReceivesCollectedFees() public view {
        assertEq(currency0.balanceOf(address(collector)), 0);
        assertEq(currency1.balanceOf(address(collector)), 0);
        assertEq(currency0.balanceOf(address(hook)), 0);
        assertEq(currency1.balanceOf(address(hook)), 0);
        assertEq(address(collector).balance, 0);
        assertEq(address(hook).balance, 0);
    }

    function invariant_callbackMaskRemainsExact() public view {
        assertEq(uint160(address(hook)) & factory.ALL_HOOK_MASK(), factory.REQUIRED_HOOK_FLAGS());

        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.afterInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.afterSwapReturnDelta);
        assertFalse(permissions.beforeSwapReturnDelta);
        assertFalse(permissions.beforeAddLiquidity);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertFalse(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
        assertFalse(permissions.afterAddLiquidityReturnDelta);
        assertFalse(permissions.afterRemoveLiquidityReturnDelta);
    }
}
