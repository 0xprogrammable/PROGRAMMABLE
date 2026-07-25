// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { PlatformFeeHookFactoryV1 } from "../../src/PlatformFeeHookFactoryV1.sol";
import { PlatformFeeHookV1 } from "../../src/PlatformFeeHookV1.sol";

contract PermissionlessCollector {
    function collect(PlatformFeeHookV1 hook) external {
        Currency[] memory callerCurrencies = new Currency[](1);
        callerCurrencies[0] = Currency.wrap(address(0xdead));
        hook.handleHookFees(callerCurrencies);
    }
}

contract PlatformFeeHookHandler {
    using SafeCast for uint256;

    PoolSwapTest internal immutable router;
    PlatformFeeHookV1 internal immutable hook;
    PermissionlessCollector internal immutable collector;
    PoolKey internal key;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    constructor(
        PoolSwapTest router_,
        PlatformFeeHookV1 hook_,
        PermissionlessCollector collector_,
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

    function collect() external {
        collector.collect(hook);
    }
}

contract PlatformFeeHookInvariantTest is Deployers {
    PlatformFeeHookFactoryV1 internal factory;
    PlatformFeeHookV1 internal hook;
    PlatformFeeHookHandler internal handler;
    PermissionlessCollector internal collector;

    address internal feeRecipient;
    bytes32 internal initialConfigurationHash;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        factory = new PlatformFeeHookFactoryV1();
        feeRecipient = makeAddr("invariantFeeRecipient");

        uint160 flags =
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);
        (address predicted, bytes32 salt) = HookMiner.find(
            address(factory),
            flags,
            type(PlatformFeeHookV1).creationCode,
            abi.encode(manager, address(this), feeRecipient, currency0, currency1)
        );
        hook = factory.deploy(salt, manager, address(this), feeRecipient, currency0, currency1);
        assertEq(address(hook), predicted);

        PoolKey memory key = hook.poolKey();
        manager.initialize(key, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(key, LIQUIDITY_PARAMS, ZERO_BYTES);

        collector = new PermissionlessCollector();
        handler = new PlatformFeeHookHandler(swapRouter, hook, collector, currency0, currency1);
        currency0.transfer(address(handler), 1e30);
        currency1.transfer(address(handler), 1e30);

        initialConfigurationHash = hook.configurationHash();

        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = PlatformFeeHookHandler.swapExactInput.selector;
        selectors[1] = PlatformFeeHookHandler.collect.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_configurationAndAuthoritiesNeverChange() public view {
        assertEq(hook.configurationHash(), initialConfigurationHash);
        assertEq(factory.configurationHashOf(address(hook)), initialConfigurationHash);
        assertEq(hook.authorized(), address(this));
        assertEq(hook.feeRecipient(), feeRecipient);
        assertEq(hook.currency0(), Currency.unwrap(currency0));
        assertEq(hook.currency1(), Currency.unwrap(currency1));
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
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.afterSwapReturnDelta);
        assertFalse(permissions.beforeSwap);
        assertFalse(permissions.beforeSwapReturnDelta);
    }
}
