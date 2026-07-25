// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IInitializerHook } from "@uniswap/liquidity-launcher/src/interfaces/IInitializerHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { PlatformFeeHookFactoryV1 } from "../src/PlatformFeeHookFactoryV1.sol";
import { PlatformFeeHookV1 } from "../src/PlatformFeeHookV1.sol";

contract PlatformFeeHookV1Test is Deployers {
    using SafeCast for *;

    uint256 private constant FEE_DENOMINATOR = 1_000_000;

    PlatformFeeHookFactoryV1 internal factory;
    PlatformFeeHookV1 internal hook;
    PoolKey internal hookKey;
    PoolKey internal noHookKey;

    address internal feeRecipient;
    bytes32 internal hookSalt;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        factory = new PlatformFeeHookFactoryV1();
        feeRecipient = makeAddr("feeRecipient");
        (hook, hookSalt) = _deployHook(address(this), feeRecipient);

        hookKey = hook.poolKey();
        manager.initialize(hookKey, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(hookKey, LIQUIDITY_PARAMS, ZERO_BYTES);

        (noHookKey,) = initPool(
            currency0, currency1, IHooks(address(0)), hook.LP_FEE_PIPS(), hook.TICK_SPACING(), SQRT_PRICE_1_1
        );
        modifyLiquidityRouter.modifyLiquidity(noHookKey, LIQUIDITY_PARAMS, ZERO_BYTES);
    }

    function test_configuration_isImmutableAndFactoryRecorded() public view {
        assertEq(hook.authorized(), address(this));
        assertEq(hook.feeRecipient(), feeRecipient);
        assertEq(hook.currency0(), Currency.unwrap(currency0));
        assertEq(hook.currency1(), Currency.unwrap(currency1));
        assertEq(hook.poolId(), PoolId.unwrap(hookKey.toId()));
        assertEq(factory.configurationHashOf(address(hook)), hook.configurationHash());
        assertTrue(factory.isFactoryHook(address(hook)));
        assertFalse(factory.isFactoryHook(address(0xBEEF)));
    }

    function test_permissions_areExact() public view {
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.afterSwapReturnDelta);
        assertFalse(permissions.afterInitialize);
        assertFalse(permissions.beforeAddLiquidity);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertFalse(permissions.beforeSwap);
        assertFalse(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
        assertFalse(permissions.beforeSwapReturnDelta);
        assertFalse(permissions.afterAddLiquidityReturnDelta);
        assertFalse(permissions.afterRemoveLiquidityReturnDelta);

        assertEq(uint160(address(hook)) & factory.ALL_HOOK_MASK(), factory.REQUIRED_HOOK_FLAGS(), "hook address flags");
    }

    function test_supportsInitializerInterface() public view {
        assertTrue(hook.supportsInterface(type(IInitializerHook).interfaceId));
        assertTrue(hook.supportsInterface(0x01ffc9a7));
        assertFalse(hook.supportsInterface(0xffffffff));
    }

    function test_revertsWhenUnauthorizedAddressInitializes() public {
        (PlatformFeeHookV1 gatedHook,) = _deployHook(makeAddr("authorizedStrategy"), feeRecipient);
        PoolKey memory gatedKey = gatedHook.poolKey();

        vm.prank(makeAddr("unauthorized"));
        vm.expectRevert();
        manager.initialize(gatedKey, SQRT_PRICE_1_1);
    }

    function test_revertsWhenInitializerUsesDifferentPoolConfiguration() public {
        (PlatformFeeHookV1 uninitializedHook,) = _deployHook(address(this), makeAddr("otherRecipient"));
        PoolKey memory wrongKey = uninitializedHook.poolKey();
        wrongKey.fee = 500;
        wrongKey.tickSpacing = 10;

        vm.expectRevert();
        manager.initialize(wrongKey, SQRT_PRICE_1_1);
    }

    function test_onlyPoolManagerCanCallUnlockCallback() public {
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.unlockCallback("");
    }

    function test_swap_zeroForOne_exactInput_chargesTenBasisPoints() public {
        _assertSwapFee(true, true, 1 ether);
    }

    function test_swap_zeroForOne_exactOutput_chargesTenBasisPoints() public {
        _assertSwapFee(true, false, 1 ether);
    }

    function test_swap_oneForZero_exactInput_chargesTenBasisPoints() public {
        _assertSwapFee(false, true, 1 ether);
    }

    function test_swap_oneForZero_exactOutput_chargesTenBasisPoints() public {
        _assertSwapFee(false, false, 1 ether);
    }

    function testFuzz_swapFeeMatchesReference(bool zeroForOne, bool exactInput, uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 10_000, 0.01 ether);
        _assertSwapFee(zeroForOne, exactInput, amount);
    }

    function test_anyoneCanCollectButCannotRedirectFees() public {
        _swapHook(true, -1 ether);
        _swapHook(false, -0.1 ether);

        uint256 claims0 = manager.balanceOf(address(hook), currency0.toId());
        uint256 claims1 = manager.balanceOf(address(hook), currency1.toId());
        assertGt(claims0, 0);
        assertGt(claims1, 0);

        address caller = makeAddr("permissionlessCaller");
        uint256 recipient0Before = currency0.balanceOf(feeRecipient);
        uint256 recipient1Before = currency1.balanceOf(feeRecipient);
        uint256 caller0Before = currency0.balanceOf(caller);
        uint256 caller1Before = currency1.balanceOf(caller);

        Currency[] memory maliciousCurrencies = new Currency[](1);
        maliciousCurrencies[0] = Currency.wrap(makeAddr("unboundCurrency"));

        vm.prank(caller);
        hook.handleHookFees(maliciousCurrencies);

        assertEq(currency0.balanceOf(feeRecipient), recipient0Before + claims0);
        assertEq(currency1.balanceOf(feeRecipient), recipient1Before + claims1);
        assertEq(currency0.balanceOf(caller), caller0Before);
        assertEq(currency1.balanceOf(caller), caller1Before);
        assertEq(manager.balanceOf(address(hook), currency0.toId()), 0);
        assertEq(manager.balanceOf(address(hook), currency1.toId()), 0);
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
                PlatformFeeHookFactoryV1.InvalidHookAddress.selector,
                predicted,
                actualFlags,
                factory.REQUIRED_HOOK_FLAGS()
            )
        );
        factory.deploy(invalidSalt, manager, address(this), feeRecipient, currency0, currency1);
    }

    function test_factoryRejectsDuplicateDeployment() public {
        vm.expectRevert(abi.encodeWithSelector(PlatformFeeHookFactoryV1.HookAlreadyDeployed.selector, address(hook)));
        factory.deploy(hookSalt, manager, address(this), feeRecipient, currency0, currency1);
    }

    function test_revertsForZeroFeeRecipient() public {
        uint160 flags = factory.REQUIRED_HOOK_FLAGS();
        (, bytes32 salt) = HookMiner.find(
            address(factory),
            flags,
            type(PlatformFeeHookV1).creationCode,
            abi.encode(manager, address(this), address(0), currency0, currency1)
        );

        vm.expectRevert(PlatformFeeHookV1.ZeroAddress.selector);
        factory.deploy(salt, manager, address(this), address(0), currency0, currency1);
    }

    function test_revertsForUnsortedCurrencies() public {
        uint160 flags = factory.REQUIRED_HOOK_FLAGS();
        (, bytes32 salt) = HookMiner.find(
            address(factory),
            flags,
            type(PlatformFeeHookV1).creationCode,
            abi.encode(manager, address(this), feeRecipient, currency1, currency0)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                PlatformFeeHookV1.InvalidCurrencyOrder.selector, Currency.unwrap(currency1), Currency.unwrap(currency0)
            )
        );
        factory.deploy(salt, manager, address(this), feeRecipient, currency1, currency0);
    }

    function _assertSwapFee(bool zeroForOne, bool exactInput, uint256 amount) private {
        int256 signedAmount = amount.toInt256();
        int256 specifiedAmount = exactInput ? -signedAmount : signedAmount;
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: specifiedAmount,
            sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });

        swapRouter.swap(hookKey, params, settings, "");
        BalanceDelta referenceDelta = swapRouter.swap(noHookKey, params, settings, "");

        bool feeInCurrency1 = exactInput == zeroForOne;
        int128 unspecifiedDelta = feeInCurrency1 ? referenceDelta.amount1() : referenceDelta.amount0();
        int256 signedUnspecified = unspecifiedDelta < 0 ? -int256(unspecifiedDelta) : int256(unspecifiedDelta);
        uint256 absoluteUnspecified = signedUnspecified.toUint256();
        uint256 expectedFee = FullMath.mulDiv(absoluteUnspecified, hook.PLATFORM_FEE_PIPS(), FEE_DENOMINATOR);

        assertEq(manager.balanceOf(address(hook), currency0.toId()), feeInCurrency1 ? 0 : expectedFee, "currency0 fee");
        assertEq(manager.balanceOf(address(hook), currency1.toId()), feeInCurrency1 ? expectedFee : 0, "currency1 fee");
    }

    function _swapHook(bool zeroForOne, int256 amountSpecified) private returns (BalanceDelta) {
        return swapRouter.swap(
            hookKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            settings,
            ""
        );
    }

    function _deployHook(address initializer, address recipient)
        private
        returns (PlatformFeeHookV1 deployed, bytes32 salt)
    {
        uint160 flags =
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);
        address predicted;
        (predicted, salt) = HookMiner.find(
            address(factory),
            flags,
            type(PlatformFeeHookV1).creationCode,
            abi.encode(manager, initializer, recipient, currency0, currency1)
        );

        deployed = factory.deploy(salt, manager, initializer, recipient, currency0, currency1);
        assertEq(address(deployed), predicted);
    }
}
