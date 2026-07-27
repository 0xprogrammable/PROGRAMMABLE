// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { EthCreatorFeeHookFactoryV1 } from "../src/EthCreatorFeeHookFactoryV1.sol";
import { EthCreatorFeeHookV1 } from "../src/EthCreatorFeeHookV1.sol";

contract CreatorMockToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Creator Token", "CRT", 18) {
        creator = creator_;
    }
}

contract ToggleFeeRecipient {
    bool public rejectsNative;

    function setRejectsNative(bool value) external {
        rejectsNative = value;
    }

    function claimCreatorFeesTo(EthCreatorFeeHookV1 hook, bytes32 poolId, address recipient) external {
        hook.claimCreatorFeesTo(poolId, recipient);
    }

    function claimLauncherFeesTo(EthCreatorFeeHookV1 hook, address recipient) external {
        hook.claimLauncherFeesTo(recipient);
    }

    receive() external payable {
        if (rejectsNative) revert();
    }
}

contract EthCreatorFeeHookV1Test is Deployers {
    uint16 internal constant TOTAL_SWAP_FEE_BPS = 100;
    uint256 internal constant BASIS_POINTS = 10_000;

    EthCreatorFeeHookFactoryV1 internal factory;
    EthCreatorFeeHookV1 internal hook;
    CreatorMockToken internal token;
    PoolKey internal hookKey;
    PoolKey internal noHookKey;
    bytes32 internal poolId;

    address internal creatorRecipient;
    address internal launcherTreasury;
    ToggleFeeRecipient internal creatorRecipientContract;
    ToggleFeeRecipient internal launcherTreasuryContract;
    bytes32 internal hookSalt;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1000 ether);

        token = new CreatorMockToken(address(this));
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        creatorRecipientContract = new ToggleFeeRecipient();
        launcherTreasuryContract = new ToggleFeeRecipient();
        creatorRecipient = address(creatorRecipientContract);
        launcherTreasury = address(launcherTreasuryContract);
        factory = new EthCreatorFeeHookFactoryV1();
        (hook, hookSalt) = _deployHook();

        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        poolId = hook.registerPool(hookKey, creatorRecipient, TOTAL_SWAP_FEE_BPS);
        manager.initialize(hookKey, SQRT_PRICE_1_1);

        noHookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 0,
            tickSpacing: hook.TICK_SPACING(),
            hooks: IHooks(address(0))
        });
        manager.initialize(noHookKey, SQRT_PRICE_1_1);

        LIQUIDITY_PARAMS =
            ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 20 ether }(hookKey, LIQUIDITY_PARAMS, ZERO_BYTES);
        modifyLiquidityRouter.modifyLiquidity{ value: 20 ether }(noHookKey, LIQUIDITY_PARAMS, ZERO_BYTES);
    }

    function test_configurationAndPermissionsAreExact() public view {
        assertEq(hook.launcherFeeRecipient(), launcherTreasury);
        assertEq(hook.LAUNCHER_FEE_BPS(), 10);
        assertEq(hook.MIN_TOTAL_SWAP_FEE_BPS(), 100);
        assertEq(hook.MAX_TOTAL_SWAP_FEE_BPS(), 1000);
        assertEq(hook.TOTAL_SWAP_FEE_STEP_BPS(), 100);
        assertEq(hook.LP_FEE_PIPS(), 0);
        assertEq(hook.TICK_SPACING(), 200);
        assertEq(uint160(address(hook)) & factory.ALL_HOOK_MASK(), factory.REQUIRED_HOOK_FLAGS());
        assertTrue(factory.isFactoryHook(address(hook)));

        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
        assertFalse(permissions.afterInitialize);
        assertFalse(permissions.beforeAddLiquidity);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertFalse(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
        assertFalse(permissions.afterAddLiquidityReturnDelta);
        assertFalse(permissions.afterRemoveLiquidityReturnDelta);
    }

    function test_poolRegistrationIsImmutableAndCreatorBound() public view {
        (address creator, address registrar, uint16 totalSwapFeeBps, bool registered, uint256 accrued) =
            hook.poolFeeConfig(poolId);
        assertEq(creator, creatorRecipient);
        assertEq(registrar, address(this));
        assertEq(totalSwapFeeBps, TOTAL_SWAP_FEE_BPS);
        assertTrue(registered);
        assertEq(accrued, 0);
        assertEq(poolId, PoolId.unwrap(hookKey.toId()));
    }

    function test_buyExactInputChargesCreatorAndLauncherInEth() public {
        uint256 grossInput = 0.1 ether;
        // This fixed fixture is far below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        BalanceDelta delta = _swap(hookKey, true, -int256(grossInput), grossInput);
        (uint256 creatorFee, uint256 launcherFee) = hook.quoteGrossFees(grossInput, TOTAL_SWAP_FEE_BPS);

        assertEq(uint256(-int256(delta.amount0())), grossInput);
        _assertAccrued(creatorFee, launcherFee);
    }

    function test_buyExactOutputChargesCreatorAndLauncherInEth() public {
        uint256 tokenOutput = 0.01 ether;
        // This fixed fixture is far below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        BalanceDelta delta = _swap(hookKey, true, int256(tokenOutput), 1 ether);
        (,,,, uint256 creatorFee) = hook.poolFeeConfig(poolId);
        uint256 launcherFee = hook.launcherFeesAccrued();
        uint256 grossNativeInput = uint256(-int256(delta.amount0()));
        uint256 netNativeInput = grossNativeInput - creatorFee - launcherFee;
        (uint256 expectedCreator, uint256 expectedLauncher) =
            hook.quoteExactOutputFees(netNativeInput, TOTAL_SWAP_FEE_BPS);

        assertEq(uint256(int256(delta.amount1())), tokenOutput);
        _assertAccrued(expectedCreator, expectedLauncher);
    }

    function test_sellExactInputChargesCreatorAndLauncherInEth() public {
        uint256 tokenInput = 0.01 ether;
        // This fixed fixture is far below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        BalanceDelta delta = _swap(hookKey, false, -int256(tokenInput), 0);

        assertEq(uint256(-int256(delta.amount1())), tokenInput);
        (,,,, uint256 creatorFee) = hook.poolFeeConfig(poolId);
        uint256 launcherFee = hook.launcherFeesAccrued();
        uint256 grossNativeOutput = uint256(int256(delta.amount0())) + creatorFee + launcherFee;
        _assertAccruedRatesFromGross(grossNativeOutput);
    }

    function test_sellExactOutputPreservesRequestedNetEthOutput() public {
        uint256 netNativeOutput = 0.005 ether;
        // This fixed fixture is far below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        BalanceDelta delta = _swap(hookKey, false, int256(netNativeOutput), 0);
        (uint256 creatorFee, uint256 launcherFee) = hook.quoteExactOutputFees(netNativeOutput, TOTAL_SWAP_FEE_BPS);

        assertEq(uint256(int256(delta.amount0())), netNativeOutput);
        _assertAccrued(creatorFee, launcherFee);
    }

    function test_buyExactInputRevertsInsteadOfChargingARequestedPartialFill() public {
        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        swapRouter.swap{ value: 1 ether }(
            hookKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(-1)
            }),
            settings,
            ""
        );
    }

    function test_buyExactInputRevertsWhenItWouldExhaustAvailableLiquidity() public {
        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        swapRouter.swap{ value: 100 ether }(
            hookKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(100 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function test_sellExactOutputRevertsInsteadOfChargingARequestedPartialFill() public {
        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        swapRouter.swap(
            hookKey,
            SwapParams({
                zeroForOne: false, amountSpecified: int256(0.1 ether), sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(1)
            }),
            settings,
            ""
        );
    }

    function test_anAlternativePoolDoesNotAccrueHookFees() public {
        _swap(noHookKey, true, -int256(0.1 ether), 0.1 ether);

        assertEq(hook.totalNativeFeesAccrued(), 0);
        assertEq(hook.launcherFeesAccrued(), 0);
        (,,,, uint256 creatorFees) = hook.poolFeeConfig(poolId);
        assertEq(creatorFees, 0);
    }

    function test_allFourSwapModesAccrueOnlyNativeClaims() public {
        _swap(hookKey, true, -int256(0.01 ether), 0.01 ether);
        _swap(hookKey, true, int256(0.005 ether), 1 ether);
        _swap(hookKey, false, -int256(0.005 ether), 0);
        _swap(hookKey, false, int256(0.002 ether), 0);

        assertGt(hook.totalNativeFeesAccrued(), 0);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), hook.totalNativeFeesAccrued());
        assertEq(manager.balanceOf(address(hook), hookKey.currency1.toId()), 0);
    }

    function test_permissionlessClaimsCannotRedirectFees() public {
        _swap(hookKey, true, -int256(0.1 ether), 0.1 ether);
        (,,,, uint256 creatorFee) = hook.poolFeeConfig(poolId);
        uint256 launcherFee = hook.launcherFeesAccrued();
        uint256 creatorBefore = creatorRecipient.balance;
        uint256 treasuryBefore = launcherTreasury.balance;
        address caller = makeAddr("permissionlessClaimCaller");

        vm.startPrank(caller);
        hook.claimCreatorFees(poolId);
        hook.claimLauncherFees();
        vm.stopPrank();

        assertEq(creatorRecipient.balance, creatorBefore + creatorFee);
        assertEq(launcherTreasury.balance, treasuryBefore + launcherFee);
        assertEq(caller.balance, 0);
        assertEq(hook.totalNativeFeesAccrued(), 0);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), 0);
    }

    function test_recordedRecipientsCanRecoverClaimsWhenDirectEthReceptionFails() public {
        _swap(hookKey, true, -int256(0.1 ether), 0.1 ether);
        (,,,, uint256 creatorFee) = hook.poolFeeConfig(poolId);
        uint256 launcherFee = hook.launcherFeesAccrued();
        address creatorRecovery = makeAddr("creatorRecovery");
        address launcherRecovery = makeAddr("launcherRecovery");

        creatorRecipientContract.setRejectsNative(true);
        launcherTreasuryContract.setRejectsNative(true);

        vm.expectRevert();
        hook.claimCreatorFees(poolId);
        vm.expectRevert();
        hook.claimLauncherFees();

        creatorRecipientContract.claimCreatorFeesTo(hook, poolId, creatorRecovery);
        launcherTreasuryContract.claimLauncherFeesTo(hook, launcherRecovery);

        assertEq(creatorRecovery.balance, creatorFee);
        assertEq(launcherRecovery.balance, launcherFee);
        assertEq(hook.totalNativeFeesAccrued(), 0);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), 0);
    }

    function test_onlyRecordedRecipientsCanRedirectClaims() public {
        _swap(hookKey, true, -int256(0.1 ether), 0.1 ether);
        address attacker = makeAddr("feeRedirectAttacker");

        vm.startPrank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(EthCreatorFeeHookV1.UnauthorizedFeeRedirect.selector, attacker, creatorRecipient)
        );
        hook.claimCreatorFeesTo(poolId, attacker);
        vm.expectRevert(
            abi.encodeWithSelector(EthCreatorFeeHookV1.UnauthorizedFeeRedirect.selector, attacker, launcherTreasury)
        );
        hook.claimLauncherFeesTo(attacker);
        vm.stopPrank();
    }

    function test_rejectsFeesOutsideIntegerOneToTenPercentSteps() public {
        for (uint16 feeBps = 0; feeBps <= 1100; feeBps += 50) {
            bool valid = feeBps >= 100 && feeBps <= 1000 && feeBps % 100 == 0;
            if (valid) continue;

            PoolKey memory candidate = hookKey;
            candidate.currency1 = Currency.wrap(address(new CreatorMockToken(address(this))));
            vm.expectRevert(abi.encodeWithSelector(EthCreatorFeeHookV1.InvalidTotalSwapFee.selector, feeBps));
            hook.registerPool(candidate, creatorRecipient, feeBps);
        }
    }

    function test_rejectsRegistrationByAnAddressOtherThanTokenCreator() public {
        address recordedCreator = makeAddr("recordedCreator");
        CreatorMockToken otherToken = new CreatorMockToken(recordedCreator);
        PoolKey memory candidate = hookKey;
        candidate.currency1 = Currency.wrap(address(otherToken));

        vm.expectRevert(
            abi.encodeWithSelector(EthCreatorFeeHookV1.InvalidRegistrar.selector, address(this), recordedCreator)
        );
        hook.registerPool(candidate, creatorRecipient, TOTAL_SWAP_FEE_BPS);
    }

    function test_rejectsUnregisteredPoolInitialization() public {
        CreatorMockToken otherToken = new CreatorMockToken(address(this));
        PoolKey memory candidate = hookKey;
        candidate.currency1 = Currency.wrap(address(otherToken));

        vm.expectRevert();
        manager.initialize(candidate, SQRT_PRICE_1_1);
    }

    function test_onlyPoolManagerCanCallUnlockCallback() public {
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.unlockCallback("");
    }

    function test_factoryRejectsUnminedSalt() public {
        bytes32 invalidSalt;
        address predicted = factory.predict(invalidSalt, manager, launcherTreasury);
        uint160 actualFlags = uint160(predicted) & factory.ALL_HOOK_MASK();
        while (actualFlags == factory.REQUIRED_HOOK_FLAGS()) {
            invalidSalt = bytes32(uint256(invalidSalt) + 1);
            predicted = factory.predict(invalidSalt, manager, launcherTreasury);
            actualFlags = uint160(predicted) & factory.ALL_HOOK_MASK();
        }

        vm.expectRevert(
            abi.encodeWithSelector(
                EthCreatorFeeHookFactoryV1.InvalidHookAddress.selector,
                predicted,
                actualFlags,
                factory.REQUIRED_HOOK_FLAGS()
            )
        );
        factory.deploy(invalidSalt, manager, launcherTreasury);
    }

    /// forge-config: default.fuzz.runs = 10000
    function test_onePercentTotalFeeSplitsPointNineToCreatorAndPointOneToLauncher() public view {
        (uint256 creatorFee, uint256 launcherFee) = hook.quoteGrossFees(1 ether, 100);

        assertEq(creatorFee, 0.009 ether);
        assertEq(launcherFee, 0.001 ether);
        assertEq(creatorFee + launcherFee, 0.01 ether);
    }

    function test_tinyGrossAmountsUseExplicitFloorRounding() public view {
        (uint256 creatorAtOne, uint256 launcherAtOne) = hook.quoteGrossFees(1, 100);
        (uint256 creatorAt999, uint256 launcherAt999) = hook.quoteGrossFees(999, 100);
        (uint256 creatorAt1000, uint256 launcherAt1000) = hook.quoteGrossFees(1000, 100);

        assertEq(creatorAtOne + launcherAtOne, 0);
        assertEq(creatorAt999, 9);
        assertEq(launcherAt999, 0);
        assertEq(creatorAt1000, 9);
        assertEq(launcherAt1000, 1);
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_grossFeeQuotesSplitTheSelectedTotal(uint96 rawGross, uint8 rawPercent) public view {
        uint256 gross = bound(uint256(rawGross), 10_000, 100_000 ether);
        uint16 totalSwapFeeBps = uint16(bound(uint256(rawPercent), 1, 10) * 100);
        (uint256 creatorFee, uint256 launcherFee) = hook.quoteGrossFees(gross, totalSwapFeeBps);

        assertEq(creatorFee + launcherFee, FullMath.mulDiv(gross, totalSwapFeeBps, BASIS_POINTS));
        assertEq(launcherFee, FullMath.mulDiv(gross, hook.LAUNCHER_FEE_BPS(), BASIS_POINTS));
        assertLt(creatorFee + launcherFee, gross);
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_exactOutputQuotesPreserveNetAmount(uint96 rawNet, uint8 rawPercent) public view {
        uint256 net = bound(uint256(rawNet), 10_000, 100_000 ether);
        uint16 totalSwapFeeBps = uint16(bound(uint256(rawPercent), 1, 10) * 100);
        (uint256 creatorFee, uint256 launcherFee) = hook.quoteExactOutputFees(net, totalSwapFeeBps);
        uint256 gross = net + creatorFee + launcherFee;
        uint256 expectedGross = FullMath.mulDivRoundingUp(net, BASIS_POINTS, BASIS_POINTS - totalSwapFeeBps);

        assertEq(gross, expectedGross);
        assertEq(launcherFee, FullMath.mulDiv(gross, hook.LAUNCHER_FEE_BPS(), BASIS_POINTS));
        assertEq(creatorFee, gross - net - launcherFee);
        assertLt(creatorFee + launcherFee, gross);
    }

    function _deployHook() private returns (EthCreatorFeeHookV1 deployed, bytes32 salt) {
        (, salt) = HookMiner.find(
            address(factory),
            factory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV1).creationCode,
            abi.encode(manager, launcherTreasury)
        );
        deployed = factory.deploy(salt, manager, launcherTreasury);
    }

    function _swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint256 value)
        private
        returns (BalanceDelta)
    {
        return swapRouter.swap{ value: value }(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            settings,
            ""
        );
    }

    function _assertAccrued(uint256 creatorFee, uint256 launcherFee) private view {
        (,,,, uint256 actualCreatorFee) = hook.poolFeeConfig(poolId);
        assertEq(actualCreatorFee, creatorFee);
        assertEq(hook.launcherFeesAccrued(), launcherFee);
        assertEq(hook.totalNativeFeesAccrued(), creatorFee + launcherFee);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), creatorFee + launcherFee);
    }

    function _assertAccruedRatesFromGross(uint256 grossNativeAmount) private view {
        (uint256 expectedCreator, uint256 expectedLauncher) = hook.quoteGrossFees(grossNativeAmount, TOTAL_SWAP_FEE_BPS);
        _assertAccrued(expectedCreator, expectedLauncher);
    }
}
