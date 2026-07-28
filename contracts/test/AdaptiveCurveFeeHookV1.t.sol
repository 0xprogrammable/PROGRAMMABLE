// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { AdaptiveCurveFeeHookFactoryV1 } from "../src/AdaptiveCurveFeeHookFactoryV1.sol";
import { AdaptiveCurveFeeHookV1 } from "../src/AdaptiveCurveFeeHookV1.sol";

contract AdaptiveCurveToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_, uint256 supply) MockERC20("Adaptive Token", "ADAPT", 18) {
        creator = creator_;
        _mint(creator_, supply);
    }
}

contract AdaptiveCurveFeeRecipient {
    bool public rejectsNative;

    function setRejectsNative(bool value) external {
        rejectsNative = value;
    }

    function claimCreatorFeesTo(AdaptiveCurveFeeHookV1 hook, bytes32 poolId, address recipient) external {
        hook.claimCreatorFeesTo(poolId, recipient);
    }

    function claimLauncherFeesTo(AdaptiveCurveFeeHookV1 hook, address recipient) external {
        hook.claimLauncherFeesTo(recipient);
    }

    receive() external payable {
        if (rejectsNative) revert();
    }
}

contract AdaptiveCurveFeeHookV1Test is Deployers {
    uint256 internal constant FIXED_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant BASIS_POINTS = 10_000;

    AdaptiveCurveFeeHookFactoryV1 internal factory;
    AdaptiveCurveFeeHookV1 internal hook;
    AdaptiveCurveToken internal token;
    PoolKey internal hookKey;
    bytes32 internal poolId;

    AdaptiveCurveFeeRecipient internal creatorRecipientContract;
    AdaptiveCurveFeeRecipient internal launcherTreasuryContract;
    address internal creatorRecipient;
    address internal launcherTreasury;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);

        token = new AdaptiveCurveToken(address(this), FIXED_SUPPLY);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        creatorRecipientContract = new AdaptiveCurveFeeRecipient();
        launcherTreasuryContract = new AdaptiveCurveFeeRecipient();
        creatorRecipient = address(creatorRecipientContract);
        launcherTreasury = address(launcherTreasuryContract);

        factory = new AdaptiveCurveFeeHookFactoryV1();
        hook = _deployHook();
        hookKey = _poolKey(token);
        (int24[] memory indexes, uint16[] memory fees) = _defaultCurve();
        poolId = hook.registerPool(hookKey, creatorRecipient, indexes, fees);
        manager.initialize(hookKey, SQRT_PRICE_1_1);

        LIQUIDITY_PARAMS =
            ModifyLiquidityParams({ tickLower: -20_000, tickUpper: 20_000, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(hookKey, LIQUIDITY_PARAMS, ZERO_BYTES);
    }

    function test_configurationPermissionsAndFactoryProvenanceAreExact() public view {
        assertEq(hook.launcherFeeRecipient(), launcherTreasury);
        assertEq(hook.LAUNCHER_FEE_BPS(), 10);
        assertEq(hook.MIN_TOTAL_SWAP_FEE_BPS(), 100);
        assertEq(hook.MAX_TOTAL_SWAP_FEE_BPS(), 1000);
        assertEq(hook.TRANSFER_TAX_BPS(), 0);
        assertEq(hook.LP_FEE_PIPS(), 0);
        assertEq(hook.MIN_CURVE_POINTS(), 2);
        assertEq(hook.MAX_CURVE_POINTS(), 8);
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

    function test_registrationStoresFixedSupplyAndImmutableCurve() public view {
        (
            address creator,
            address registrar,
            uint256 fixedSupply,
            bytes32 curveHash,
            uint8 curvePointCount,
            bool registered,
            uint256 accrued
        ) = hook.poolFeeConfig(poolId);

        assertEq(creator, creatorRecipient);
        assertEq(registrar, address(this));
        assertEq(fixedSupply, FIXED_SUPPLY);
        assertTrue(curveHash != bytes32(0));
        assertEq(curvePointCount, 5);
        assertTrue(registered);
        assertEq(accrued, 0);

        AdaptiveCurveFeeHookV1.CurvePoint[] memory points = hook.curvePoints(poolId);
        assertEq(points.length, 5);
        assertEq(points[0].fdvIndex, hook.MIN_FDV_INDEX());
        assertEq(points[0].totalSwapFeeBps, 1000);
        assertEq(points[2].fdvIndex, 0);
        assertEq(points[2].totalSwapFeeBps, 500);
        assertEq(points[4].fdvIndex, hook.MAX_FDV_INDEX());
        assertEq(points[4].totalSwapFeeBps, 100);
    }

    function test_fdvIndexIsNegatedTickAndRisesWithEthDenominatedFdv() public {
        assertEq(hook.fdvIndexForTick(10_000), -10_000);
        assertEq(hook.fdvIndexForTick(0), 0);
        assertEq(hook.fdvIndexForTick(-10_000), 10_000);

        (int24 highTokenPerEthTick, int24 lowFdvIndex, uint16 lowFdvFee) = _currentFeeForNewPool(10_000);
        (int24 lowTokenPerEthTick, int24 highFdvIndex, uint16 highFdvFee) = _currentFeeForNewPool(-10_000);

        assertEq(highTokenPerEthTick, 10_000);
        assertEq(lowTokenPerEthTick, -10_000);
        assertEq(lowFdvIndex, -10_000);
        assertEq(highFdvIndex, 10_000);
        assertGt(highFdvIndex, lowFdvIndex);
        assertEq(lowFdvFee, 800);
        assertEq(highFdvFee, 300);
    }

    function test_piecewiseLinearInterpolationHandlesBothSlopeDirections() public view {
        assertEq(hook.feeForFdvIndex(poolId, hook.MIN_FDV_INDEX()), 1000);
        assertEq(hook.feeForFdvIndex(poolId, -10_000), 800);
        assertEq(hook.feeForFdvIndex(poolId, -5000), 650);
        assertEq(hook.feeForFdvIndex(poolId, 0), 500);
        assertEq(hook.feeForFdvIndex(poolId, 5000), 400);
        assertEq(hook.feeForFdvIndex(poolId, 10_000), 300);
        assertEq(hook.feeForFdvIndex(poolId, hook.MAX_FDV_INDEX()), 100);
    }

    function test_currentFeeUsesTheCurrentPoolTick() public view {
        (int24 tick, int24 fdvIndex, uint16 totalSwapFeeBps) = hook.currentFee(poolId);
        assertEq(tick, 0);
        assertEq(fdvIndex, 0);
        assertEq(totalSwapFeeBps, 500);
    }

    function test_allFourSwapModesAccrueOnlyNativeClaims() public {
        _swap(true, -int256(0.01 ether), 0.01 ether);
        _swap(true, int256(0.005 ether), 1 ether);
        _swap(false, -int256(0.005 ether), 0);
        _swap(false, int256(0.002 ether), 0);

        assertGt(hook.totalNativeFeesAccrued(), 0);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), hook.totalNativeFeesAccrued());
        assertEq(manager.balanceOf(address(hook), hookKey.currency1.toId()), 0);
    }

    function test_buyExactInputUsesPreSwapCurveFeeAndSplitsLauncherShare() public {
        uint256 grossInput = 0.1 ether;
        // This fixed fixture is far below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        _swap(true, -int256(grossInput), grossInput);
        (uint256 expectedCreator, uint256 expectedLauncher) = hook.quoteGrossFees(grossInput, 500);

        _assertAccrued(expectedCreator, expectedLauncher);
        assertEq(expectedCreator + expectedLauncher, 0.005 ether);
        assertEq(expectedLauncher, 0.0001 ether);
    }

    function test_sellExactInputKeepsPreSwapFeeWhenTheSwapMovesTheTick() public {
        (, int24 beforeIndex, uint16 beforeFee) = hook.currentFee(poolId);
        BalanceDelta delta = _swap(false, -int256(2 ether), 0);
        (, int24 afterIndex, uint16 afterFee) = hook.currentFee(poolId);
        assertTrue(afterIndex != beforeIndex);

        (,,,,,, uint256 creatorFee) = hook.poolFeeConfig(poolId);
        uint256 launcherFee = hook.launcherFeesAccrued();
        uint256 grossNativeOutput = uint256(int256(delta.amount0())) + creatorFee + launcherFee;
        (uint256 expectedCreator, uint256 expectedLauncher) = hook.quoteGrossFees(grossNativeOutput, beforeFee);

        assertEq(creatorFee, expectedCreator);
        assertEq(launcherFee, expectedLauncher);
        if (afterFee != beforeFee) {
            (uint256 postCreator, uint256 postLauncher) = hook.quoteGrossFees(grossNativeOutput, afterFee);
            assertTrue(creatorFee != postCreator || launcherFee != postLauncher);
        }
    }

    function test_buyExactOutputPreservesRequestedTokenOutput() public {
        uint256 tokenOutput = 0.01 ether;
        // This fixed fixture is far below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        BalanceDelta delta = _swap(true, int256(tokenOutput), 1 ether);

        assertEq(uint256(int256(delta.amount1())), tokenOutput);
        assertGt(hook.totalNativeFeesAccrued(), 0);
    }

    function test_sellExactOutputPreservesRequestedNetEthOutput() public {
        uint256 netNativeOutput = 0.005 ether;
        // This fixed fixture is far below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        BalanceDelta delta = _swap(false, int256(netNativeOutput), 0);
        (uint256 expectedCreator, uint256 expectedLauncher) = hook.quoteExactOutputFees(netNativeOutput, 500);

        assertEq(uint256(int256(delta.amount0())), netNativeOutput);
        _assertAccrued(expectedCreator, expectedLauncher);
    }

    function test_buyExactInputRejectsPartialFillAtPriceLimit() public {
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

    function test_sellExactOutputRejectsPartialFillAtPriceLimit() public {
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

    function test_permissionlessClaimsCannotRedirectFees() public {
        _swap(true, -int256(0.1 ether), 0.1 ether);
        (,,,,,, uint256 creatorFee) = hook.poolFeeConfig(poolId);
        uint256 launcherFee = hook.launcherFeesAccrued();
        uint256 creatorBefore = creatorRecipient.balance;
        uint256 treasuryBefore = launcherTreasury.balance;
        address caller = makeAddr("claimCaller");

        vm.startPrank(caller);
        hook.claimCreatorFees(poolId);
        hook.claimLauncherFees();
        vm.stopPrank();

        assertEq(creatorRecipient.balance, creatorBefore + creatorFee);
        assertEq(launcherTreasury.balance, treasuryBefore + launcherFee);
        assertEq(caller.balance, 0);
        assertEq(hook.totalNativeFeesAccrued(), 0);
    }

    function test_onlyImmutableRecipientsCanRedirectClaims() public {
        _swap(true, -int256(0.1 ether), 0.1 ether);
        address attacker = makeAddr("attacker");

        vm.startPrank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(AdaptiveCurveFeeHookV1.UnauthorizedFeeRedirect.selector, attacker, creatorRecipient)
        );
        hook.claimCreatorFeesTo(poolId, attacker);
        vm.expectRevert(
            abi.encodeWithSelector(AdaptiveCurveFeeHookV1.UnauthorizedFeeRedirect.selector, attacker, launcherTreasury)
        );
        hook.claimLauncherFeesTo(attacker);
        vm.stopPrank();
    }

    function test_recordedRecipientsCanRecoverWhenDirectEthReceptionFails() public {
        _swap(true, -int256(0.1 ether), 0.1 ether);
        (,,,,,, uint256 creatorFee) = hook.poolFeeConfig(poolId);
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
    }

    function test_tokenTransfersHaveNoTaxAndDoNotTouchHookAccounting() public {
        address recipient = makeAddr("tokenRecipient");
        uint256 amount = 123 ether;
        uint256 beforeBalance = token.balanceOf(recipient);

        assertTrue(token.transfer(recipient, amount));

        assertEq(token.balanceOf(recipient), beforeBalance + amount);
        assertEq(hook.totalNativeFeesAccrued(), 0);
    }

    function test_registrationCannotBeMutated() public {
        (int24[] memory indexes, uint16[] memory fees) = _defaultCurve();
        vm.expectRevert(abi.encodeWithSelector(AdaptiveCurveFeeHookV1.AlreadyRegistered.selector, poolId));
        hook.registerPool(hookKey, creatorRecipient, indexes, fees);
    }

    function test_rejectsMalformedCurves() public {
        AdaptiveCurveToken candidateToken = new AdaptiveCurveToken(address(this), FIXED_SUPPLY);
        PoolKey memory candidate = _poolKey(candidateToken);

        int24[] memory indexes = new int24[](2);
        indexes[0] = hook.MIN_FDV_INDEX();
        indexes[1] = hook.MAX_FDV_INDEX();
        uint16[] memory oneFee = new uint16[](1);
        oneFee[0] = 100;
        vm.expectRevert(abi.encodeWithSelector(AdaptiveCurveFeeHookV1.CurveLengthMismatch.selector, 2, 1));
        hook.registerPool(candidate, creatorRecipient, indexes, oneFee);

        uint16[] memory fees = new uint16[](2);
        fees[0] = 100;
        fees[1] = 100;
        indexes[0] += 1;
        vm.expectRevert();
        hook.registerPool(candidate, creatorRecipient, indexes, fees);

        indexes[0] = hook.MIN_FDV_INDEX();
        indexes[1] = hook.MIN_FDV_INDEX();
        vm.expectRevert(
            abi.encodeWithSelector(
                AdaptiveCurveFeeHookV1.InvalidCurveEndpoint.selector,
                hook.MIN_FDV_INDEX(),
                hook.MIN_FDV_INDEX(),
                hook.MIN_FDV_INDEX(),
                hook.MAX_FDV_INDEX()
            )
        );
        hook.registerPool(candidate, creatorRecipient, indexes, fees);

        indexes[1] = hook.MAX_FDV_INDEX();
        fees[0] = 99;
        vm.expectRevert(abi.encodeWithSelector(AdaptiveCurveFeeHookV1.InvalidTotalSwapFee.selector, 99));
        hook.registerPool(candidate, creatorRecipient, indexes, fees);

        fees[0] = 100;
        fees[1] = 1001;
        vm.expectRevert(abi.encodeWithSelector(AdaptiveCurveFeeHookV1.InvalidTotalSwapFee.selector, 1001));
        hook.registerPool(candidate, creatorRecipient, indexes, fees);
    }

    function test_rejectsUnorderedInteriorPoints() public {
        AdaptiveCurveToken candidateToken = new AdaptiveCurveToken(address(this), FIXED_SUPPLY);
        PoolKey memory candidate = _poolKey(candidateToken);
        int24[] memory indexes = new int24[](4);
        indexes[0] = hook.MIN_FDV_INDEX();
        indexes[1] = 100;
        indexes[2] = 99;
        indexes[3] = hook.MAX_FDV_INDEX();
        uint16[] memory fees = new uint16[](4);
        fees[0] = 100;
        fees[1] = 200;
        fees[2] = 300;
        fees[3] = 400;

        vm.expectRevert(
            abi.encodeWithSelector(AdaptiveCurveFeeHookV1.InvalidCurveOrder.selector, 2, int24(100), int24(99))
        );
        hook.registerPool(candidate, creatorRecipient, indexes, fees);
    }

    function test_rejectsMoreThanEightControlPoints() public {
        AdaptiveCurveToken candidateToken = new AdaptiveCurveToken(address(this), FIXED_SUPPLY);
        PoolKey memory candidate = _poolKey(candidateToken);
        int24[] memory indexes = new int24[](9);
        uint16[] memory fees = new uint16[](9);
        indexes[0] = hook.MIN_FDV_INDEX();
        for (uint256 i = 1; i < 8; ++i) {
            // The loop is bounded to 1..7, so this expression is within int24 range.
            // forge-lint: disable-next-line(unsafe-typecast)
            indexes[i] = int24(int256(i) * 1000 - 4000);
            fees[i] = 500;
        }
        indexes[8] = hook.MAX_FDV_INDEX();
        fees[0] = 500;
        fees[8] = 500;

        vm.expectRevert(abi.encodeWithSelector(AdaptiveCurveFeeHookV1.InvalidCurveLength.selector, 9, 2, 8));
        hook.registerPool(candidate, creatorRecipient, indexes, fees);
    }

    function test_onlyTokenRecordedCreatorCanRegister() public {
        address recordedCreator = makeAddr("recordedCreator");
        AdaptiveCurveToken candidateToken = new AdaptiveCurveToken(recordedCreator, FIXED_SUPPLY);
        PoolKey memory candidate = _poolKey(candidateToken);
        (int24[] memory indexes, uint16[] memory fees) = _defaultCurve();

        vm.expectRevert(
            abi.encodeWithSelector(AdaptiveCurveFeeHookV1.InvalidRegistrar.selector, address(this), recordedCreator)
        );
        hook.registerPool(candidate, creatorRecipient, indexes, fees);
    }

    function test_onlyRegistrarCanInitializeRegisteredPool() public {
        address recordedCreator = makeAddr("initializingCreator");
        address attacker = makeAddr("initializationAttacker");
        AdaptiveCurveToken candidateToken = new AdaptiveCurveToken(recordedCreator, FIXED_SUPPLY);
        PoolKey memory candidate = _poolKey(candidateToken);
        (int24[] memory indexes, uint16[] memory fees) = _defaultCurve();

        vm.prank(recordedCreator);
        hook.registerPool(candidate, creatorRecipient, indexes, fees);

        vm.prank(attacker);
        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
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
                AdaptiveCurveFeeHookFactoryV1.InvalidHookAddress.selector,
                predicted,
                actualFlags,
                factory.REQUIRED_HOOK_FLAGS()
            )
        );
        factory.deploy(invalidSalt, manager, launcherTreasury);
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_interpolatedFeeAlwaysStaysWithinControlPointBounds(int24 rawIndex) public view {
        int24 fdvIndex = int24(bound(int256(rawIndex), int256(hook.MIN_FDV_INDEX()), int256(hook.MAX_FDV_INDEX())));
        uint16 fee = hook.feeForFdvIndex(poolId, fdvIndex);
        assertGe(fee, 100);
        assertLe(fee, 1000);
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_feeQuotesAlwaysDeductExactlyPointOnePercentForLauncher(uint96 rawGross, uint16 rawFee)
        public
        view
    {
        uint256 gross = bound(uint256(rawGross), 10_000, 100_000 ether);
        uint16 totalFeeBps = uint16(bound(uint256(rawFee), 100, 1000));
        (uint256 creatorFee, uint256 launcherFee) = hook.quoteGrossFees(gross, totalFeeBps);

        assertEq(creatorFee + launcherFee, FullMath.mulDiv(gross, totalFeeBps, BASIS_POINTS));
        assertEq(launcherFee, FullMath.mulDiv(gross, hook.LAUNCHER_FEE_BPS(), BASIS_POINTS));
        assertLt(creatorFee + launcherFee, gross);
    }

    function _deployHook() private returns (AdaptiveCurveFeeHookV1 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(factory),
            factory.REQUIRED_HOOK_FLAGS(),
            type(AdaptiveCurveFeeHookV1).creationCode,
            abi.encode(manager, launcherTreasury)
        );
        deployed = factory.deploy(salt, manager, launcherTreasury);
    }

    function _poolKey(AdaptiveCurveToken poolToken) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(poolToken)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
    }

    function _defaultCurve() private view returns (int24[] memory indexes, uint16[] memory fees) {
        indexes = new int24[](5);
        indexes[0] = hook.MIN_FDV_INDEX();
        indexes[1] = -10_000;
        indexes[2] = 0;
        indexes[3] = 10_000;
        indexes[4] = hook.MAX_FDV_INDEX();

        fees = new uint16[](5);
        fees[0] = 1000;
        fees[1] = 800;
        fees[2] = 500;
        fees[3] = 300;
        fees[4] = 100;
    }

    function _currentFeeForNewPool(int24 initialTick)
        private
        returns (int24 tick, int24 fdvIndex, uint16 totalSwapFeeBps)
    {
        AdaptiveCurveToken otherToken = new AdaptiveCurveToken(address(this), FIXED_SUPPLY);
        PoolKey memory key = _poolKey(otherToken);
        (int24[] memory indexes, uint16[] memory fees) = _defaultCurve();
        bytes32 otherPoolId = hook.registerPool(key, creatorRecipient, indexes, fees);
        manager.initialize(key, TickMath.getSqrtPriceAtTick(initialTick));
        return hook.currentFee(otherPoolId);
    }

    function _swap(bool zeroForOne, int256 amountSpecified, uint256 value) private returns (BalanceDelta) {
        return swapRouter.swap{ value: value }(
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

    function _assertAccrued(uint256 creatorFee, uint256 launcherFee) private view {
        (,,,,,, uint256 actualCreatorFee) = hook.poolFeeConfig(poolId);
        assertEq(actualCreatorFee, creatorFee);
        assertEq(hook.launcherFeesAccrued(), launcherFee);
        assertEq(hook.totalNativeFeesAccrued(), creatorFee + launcherFee);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), creatorFee + launcherFee);
    }
}
