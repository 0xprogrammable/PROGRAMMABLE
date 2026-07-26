// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { IInitializerHook } from "@uniswap/liquidity-launcher/src/interfaces/IInitializerHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
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

import { BoundedDynamicFeeHookFactoryV1 } from "../src/BoundedDynamicFeeHookFactoryV1.sol";
import { BoundedDynamicFeeHookV1 } from "../src/BoundedDynamicFeeHookV1.sol";

contract BoundedDynamicFeeHookV1Test is Deployers {
    using LPFeeLibrary for uint24;
    using StateLibrary for IPoolManager;

    BoundedDynamicFeeHookFactoryV1 internal factory;
    BoundedDynamicFeeHookV1 internal hook;
    PoolKey internal hookKey;

    address internal feeRecipient;
    bytes32 internal hookSalt;
    int24 internal initialTick;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        factory = new BoundedDynamicFeeHookFactoryV1();
        feeRecipient = makeAddr("dynamicFeeRecipient");
        (hook, hookSalt) = _deployHook(address(this), feeRecipient);

        hookKey = hook.poolKey();
        initialTick = manager.initialize(hookKey, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(hookKey, LIQUIDITY_PARAMS, ZERO_BYTES);
    }

    function test_configurationIsImmutableAndFactoryRecorded() public view {
        assertEq(hook.authorized(), address(this));
        assertEq(hook.feeRecipient(), feeRecipient);
        assertEq(hook.currency0(), Currency.unwrap(currency0));
        assertEq(hook.currency1(), Currency.unwrap(currency1));
        assertEq(hook.poolId(), PoolId.unwrap(hookKey.toId()));
        assertEq(hook.referenceBlock(), block.number);
        assertEq(hook.referenceTick(), initialTick);
        assertEq(hook.currentLpFee(), hook.BASE_LP_FEE_PIPS());
        assertEq(factory.configurationHashOf(address(hook)), hook.configurationHash());
        assertTrue(factory.isFactoryHook(address(hook)));
        assertFalse(factory.isFactoryHook(address(0xBEEF)));
    }

    function test_permissionsAreExact() public view {
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.afterInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.afterSwapReturnDelta);
        assertFalse(permissions.beforeAddLiquidity);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertFalse(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
        assertFalse(permissions.beforeSwapReturnDelta);
        assertFalse(permissions.afterAddLiquidityReturnDelta);
        assertFalse(permissions.afterRemoveLiquidityReturnDelta);

        assertEq(uint160(address(hook)) & factory.ALL_HOOK_MASK(), factory.REQUIRED_HOOK_FLAGS(), "hook address flags");
    }

    function test_initializationInstallsDynamicBaseFee() public view {
        assertTrue(hookKey.fee.isDynamicFee());
        (,,, uint24 installedFee) = manager.getSlot0(hookKey.toId());
        assertEq(installedFee, hook.BASE_LP_FEE_PIPS());
    }

    function test_supportsInitializerInterface() public view {
        assertTrue(hook.supportsInterface(type(IInitializerHook).interfaceId));
        assertTrue(hook.supportsInterface(type(IERC165).interfaceId));
        assertFalse(hook.supportsInterface(0xffffffff));
    }

    function test_feeRuleIsBoundedAndPublic() public view {
        assertEq(hook.feeForTickMovement(0), hook.BASE_LP_FEE_PIPS());
        assertEq(hook.feeForTickMovement(1), hook.BASE_LP_FEE_PIPS() + hook.FEE_PIPS_PER_TICK());
        assertEq(hook.feeForTickMovement(699), 9990);
        assertEq(hook.feeForTickMovement(700), hook.MAX_LP_FEE_PIPS());
        assertEq(hook.feeForTickMovement(type(uint24).max), hook.MAX_LP_FEE_PIPS());
        assertEq(hook.feeForTickMovement(type(uint256).max), hook.MAX_LP_FEE_PIPS());
    }

    /// forge-config: default.fuzz.runs = 256
    /// forge-config: ci.fuzz.runs = 10000
    function testFuzz_feeNeverLeavesBounds(uint256 movement) public view {
        uint24 fee = hook.feeForTickMovement(movement);
        assertGe(fee, hook.BASE_LP_FEE_PIPS());
        assertLe(fee, hook.MAX_LP_FEE_PIPS());
    }

    function test_feeRespondsToPriorBlockMovementAndStaysBounded() public {
        _swap(true, -1 ether);
        (, int24 movedTick,, uint24 feeInMovementBlock) = manager.getSlot0(hookKey.toId());
        assertNotEq(movedTick, initialTick);
        assertEq(feeInMovementBlock, hook.BASE_LP_FEE_PIPS());

        vm.roll(block.number + 1);
        _swap(false, -0.01 ether);

        (,,, uint24 installedFee) = manager.getSlot0(hookKey.toId());
        assertEq(installedFee, hook.currentLpFee());
        assertGt(installedFee, hook.BASE_LP_FEE_PIPS());
        assertLe(installedFee, hook.MAX_LP_FEE_PIPS());
        assertEq(hook.referenceTick(), movedTick);
        assertEq(hook.referenceBlock(), block.number);
    }

    function test_sameBlockSwapsCannotChangeTheInstalledLpFee() public {
        uint24 startingFee = hook.currentLpFee();
        _swap(true, -0.2 ether);
        _swap(false, -0.1 ether);

        (,,, uint24 installedFee) = manager.getSlot0(hookKey.toId());
        assertEq(hook.currentLpFee(), startingFee);
        assertEq(installedFee, startingFee);
    }

    function test_platformFeeStillAccruesAndCannotBeRedirected() public {
        _swap(true, -0.5 ether);

        uint256 claims = manager.balanceOf(address(hook), currency1.toId());
        assertGt(claims, 0);
        uint256 recipientBefore = currency1.balanceOf(feeRecipient);
        address caller = makeAddr("permissionlessDynamicFeeCollector");
        uint256 callerBefore = currency1.balanceOf(caller);

        vm.prank(caller);
        hook.handleHookFees(new Currency[](0));

        assertEq(currency1.balanceOf(feeRecipient), recipientBefore + claims);
        assertEq(currency1.balanceOf(caller), callerBefore);
        assertEq(manager.balanceOf(address(hook), currency1.toId()), 0);
    }

    function test_rejectsUnauthorizedInitializer() public {
        (BoundedDynamicFeeHookV1 gatedHook,) = _deployHook(makeAddr("authorizedDynamicStrategy"), feeRecipient);
        PoolKey memory gatedKey = gatedHook.poolKey();

        vm.expectRevert();
        manager.initialize(gatedKey, SQRT_PRICE_1_1);
    }

    function test_onlyPoolManagerCanCallUnlockCallback() public {
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.unlockCallback("");
    }

    function test_factoryRejectsUnminedSalt() public {
        bytes32 invalidSalt;
        address predicted = factory.predict(invalidSalt, manager, address(this), feeRecipient, currency0, currency1);
        uint160 actualFlags = uint160(predicted) & factory.ALL_HOOK_MASK();

        while (actualFlags == factory.REQUIRED_HOOK_FLAGS()) {
            invalidSalt = bytes32(uint256(invalidSalt) + 1);
            predicted = factory.predict(invalidSalt, manager, address(this), feeRecipient, currency0, currency1);
            actualFlags = uint160(predicted) & factory.ALL_HOOK_MASK();
        }

        vm.expectRevert(
            abi.encodeWithSelector(
                BoundedDynamicFeeHookFactoryV1.InvalidHookAddress.selector,
                predicted,
                actualFlags,
                factory.REQUIRED_HOOK_FLAGS()
            )
        );
        factory.deploy(invalidSalt, manager, address(this), feeRecipient, currency0, currency1);
    }

    function test_factoryRejectsDuplicateDeployment() public {
        vm.expectRevert(
            abi.encodeWithSelector(BoundedDynamicFeeHookFactoryV1.HookAlreadyDeployed.selector, address(hook))
        );
        factory.deploy(hookSalt, manager, address(this), feeRecipient, currency0, currency1);
    }

    function test_rejectsZeroFeeRecipient() public {
        (, bytes32 salt) = HookMiner.find(
            address(factory),
            factory.REQUIRED_HOOK_FLAGS(),
            type(BoundedDynamicFeeHookV1).creationCode,
            abi.encode(manager, address(this), address(0), currency0, currency1)
        );

        vm.expectRevert(BoundedDynamicFeeHookV1.ZeroAddress.selector);
        factory.deploy(salt, manager, address(this), address(0), currency0, currency1);
    }

    function test_rejectsUnsortedCurrencies() public {
        (, bytes32 salt) = HookMiner.find(
            address(factory),
            factory.REQUIRED_HOOK_FLAGS(),
            type(BoundedDynamicFeeHookV1).creationCode,
            abi.encode(manager, address(this), feeRecipient, currency1, currency0)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                BoundedDynamicFeeHookV1.InvalidCurrencyOrder.selector,
                Currency.unwrap(currency1),
                Currency.unwrap(currency0)
            )
        );
        factory.deploy(salt, manager, address(this), feeRecipient, currency1, currency0);
    }

    function _deployHook(address authorized, address recipient)
        private
        returns (BoundedDynamicFeeHookV1 deployedHook, bytes32 salt)
    {
        (, salt) = HookMiner.find(
            address(factory),
            factory.REQUIRED_HOOK_FLAGS(),
            type(BoundedDynamicFeeHookV1).creationCode,
            abi.encode(manager, authorized, recipient, currency0, currency1)
        );
        deployedHook = factory.deploy(salt, manager, authorized, recipient, currency0, currency1);
    }

    function _swap(bool zeroForOne, int256 amountSpecified) private {
        swapRouter.swap(
            hookKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ZERO_BYTES
        );
    }
}
