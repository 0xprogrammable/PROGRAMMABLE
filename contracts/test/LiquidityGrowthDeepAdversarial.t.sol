// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Oracle } from "@openzeppelin/uniswap-hooks/src/oracles/panoptic/libraries/Oracle.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { LiquidityAmounts as TestLiquidityAmounts } from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { LiquidityGrowthVaultFactoryV1 } from "../src/LiquidityGrowthVaultFactoryV1.sol";
import { LiquidityGrowthVaultV1 } from "../src/LiquidityGrowthVaultV1.sol";
import { ILiquidityGrowthOracleV1 } from "../src/interfaces/ILiquidityGrowthOracleV1.sol";

contract LiquidityGrowthDeepToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Liquidity Growth Deep", "GDEEP", 18) {
        creator = creator_;
    }
}

contract LiquidityGrowthDeepAdversarialTest is Deployers {
    using SafeCast for int256;
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;

    uint16 internal constant TOTAL_SWAP_FEE_BPS = 100;
    uint256 internal constant GROWTH_TARGET = 10 ether;
    uint256 internal constant MAX_COMPOUND = 0.25 ether;
    uint256 internal constant TOKEN_RESERVE = 100_000_000 ether;
    int24 internal constant RANGE_HALF_WIDTH = 20_000;
    int24 internal constant MAX_SPOT_TWAP_DEVIATION = 600;
    int24 internal constant MAX_ABS_TICK_DELTA = 400;
    uint32 internal constant TWAP_WINDOW = 30 minutes;
    uint64 internal constant COMPOUND_COOLDOWN = 5 minutes;
    uint16 internal constant OBSERVATION_CARDINALITY = 192;
    uint256 internal constant OBSERVATION_SEED_BUY = 0.000_001 ether;
    uint256 internal constant OBSERVATION_KEEPALIVE_BUY = 0.000_001 ether;
    uint256 internal constant NORMAL_BASE_LIQUIDITY = 1000 ether;
    uint256 internal constant THIN_BASE_LIQUIDITY = 10 ether;
    uint256 internal constant LARGE_PRICE_MOVE = 500 ether;
    uint256 internal constant SUSTAINED_OBSERVATIONS = 180;
    uint256 internal constant OBSERVATION_INTERVAL = 10 seconds;

    FeeSplitVaultFactoryV1 internal splitFactory;
    LiquidityGrowthVaultFactoryV1 internal growthFactory;
    LiquidityGrowthFeeOracleHookV1 internal hook;
    address internal beneficiary;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    struct Market {
        LiquidityGrowthDeepToken token;
        LiquidityGrowthVaultV1 vault;
        LiquidityGrowthRangeSourceV1 rangeSource;
        PoolKey key;
        bytes32 poolId;
    }

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1_000_000 ether);

        beneficiary = makeAddr("deepBeneficiary");
        splitFactory = new FeeSplitVaultFactoryV1();
        growthFactory = new LiquidityGrowthVaultFactoryV1();
        LiquidityGrowthFeeOracleHookFactoryV1 hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        address treasury = makeAddr("deepTreasury");
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(manager, treasury, splitFactory, MAX_ABS_TICK_DELTA)
        );
        hook = hookFactory.deploy(hookSalt, manager, treasury, splitFactory, MAX_ABS_TICK_DELTA);
    }

    function test_insufficientTwapHistoryMakesProcessAtomic() public {
        Market memory market = _deployMarket(keccak256("deep-immature"), NORMAL_BASE_LIQUIDITY);
        _buy(market, 1 ether);
        uint256 creatorAccruedBefore = _creatorAccrued(market.poolId);

        uint32 targetTimestamp;
        unchecked {
            targetTimestamp = uint32(block.timestamp) - TWAP_WINDOW;
        }
        vm.expectRevert(
            abi.encodeWithSelector(
                Oracle.TargetPredatesOldestObservation.selector, uint32(block.timestamp), targetTimestamp
            )
        );
        market.vault.process();

        assertEq(_creatorAccrued(market.poolId), creatorAccruedBefore);
        assertEq(market.vault.totalCreatorFeesReceived(), 0);
        assertEq(market.vault.totalNativeAllocatedToGrowth(), 0);
        assertEq(market.vault.pendingGrowthNative(), 0);
        assertEq(market.vault.lastCompoundTimestamp(), 0);
        assertEq(address(market.vault).balance, 0);
    }

    function test_thinLiquidityLargeDeviationRejectsQuoteAndProcessAtomically() public {
        Market memory market = _deployMarket(keccak256("deep-thin"), THIN_BASE_LIQUIDITY);
        LiquidityGrowthRangeSourceV1.RangeQuote memory baseline = _matureBaseline(market);
        _buy(market, 1 ether);

        int24 spotTick = _currentTick(market);
        assertGt(_tickDistance(spotTick, baseline.twapTick), _maximumDeviation());
        bytes memory expectedError = _deviationError(spotTick, baseline.twapTick);
        uint256 creatorAccruedBefore = _creatorAccrued(market.poolId);

        vm.expectRevert(expectedError);
        market.rangeSource.quoteRange();
        vm.expectRevert(expectedError);
        market.vault.process();

        assertEq(_creatorAccrued(market.poolId), creatorAccruedBefore);
        assertEq(market.vault.totalCreatorFeesReceived(), 0);
        assertEq(market.vault.pendingGrowthNative(), 0);
        assertEq(market.vault.totalLiquidityAdded(), 0);
    }

    function test_sameBlockReorderingFailsClosedThenBackrunRestoresHealthyProcessing() public {
        Market memory market = _deployMarket(keccak256("deep-reordering"), NORMAL_BASE_LIQUIDITY);
        LiquidityGrowthRangeSourceV1.RangeQuote memory baseline = _matureBaseline(market);
        _buy(market, 1 ether);

        uint256 tokenBalanceBeforeMove = market.token.balanceOf(address(this));
        _buy(market, LARGE_PRICE_MOVE);
        uint256 acquiredTokens = market.token.balanceOf(address(this)) - tokenBalanceBeforeMove;
        int24 movedSpot = _currentTick(market);
        assertGt(_tickDistance(movedSpot, baseline.twapTick), _maximumDeviation());

        uint256 creatorBeforeRejectedProcess = _creatorAccrued(market.poolId);
        vm.expectRevert(_deviationError(movedSpot, baseline.twapTick));
        vm.prank(makeAddr("blockedKeeper"));
        market.vault.process();
        assertEq(_creatorAccrued(market.poolId), creatorBeforeRejectedProcess);
        assertEq(market.vault.totalCreatorFeesReceived(), 0);

        _sell(market, acquiredTokens);
        LiquidityGrowthRangeSourceV1.RangeQuote memory restored = market.rangeSource.quoteRange();
        assertLe(_tickDistance(restored.spotTick, restored.twapTick), _maximumDeviation());

        uint256 totalCreatorFees = _creatorAccrued(market.poolId);
        vm.prank(makeAddr("healthyKeeper"));
        (uint256 received, LiquidityGrowthVaultV1.CompoundResult memory result) = market.vault.process();
        assertEq(received, totalCreatorFees);
        assertEq(_creatorAccrued(market.poolId), 0);
        assertGt(result.liquidityAdded, 0);
        assertEq(result.tickLower, restored.tickLower);
        assertEq(result.tickUpper, restored.tickUpper);
        _assertGrowthAccounting(market);
    }

    function test_repeatedPermissionlessCallsPreserveCooldownAndAccounting() public {
        Market memory market = _deployMarket(keccak256("deep-repeat"), NORMAL_BASE_LIQUIDITY);
        _matureBaseline(market);
        _buy(market, 30 ether);
        market.rangeSource.quoteRange();

        address firstKeeper = makeAddr("firstKeeper");
        vm.prank(firstKeeper);
        (, LiquidityGrowthVaultV1.CompoundResult memory first) = market.vault.process();
        assertEq(first.nativeBudget, MAX_COMPOUND);
        assertGt(first.liquidityAdded, 0);
        assertGt(market.vault.pendingGrowthNative(), 0);
        uint64 firstCompoundTimestamp = market.vault.lastCompoundTimestamp();
        uint256 pendingAfterFirst = market.vault.pendingGrowthNative();

        vm.expectRevert(abi.encodeWithSelector(FeeSplitVaultV1.NoFeesToClaim.selector, address(market.vault)));
        vm.prank(makeAddr("redundantProcessor"));
        market.vault.process();
        assertEq(market.vault.pendingGrowthNative(), pendingAfterFirst);

        uint256 nextTimestamp = uint256(firstCompoundTimestamp) + COMPOUND_COOLDOWN;
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthVaultV1.CompoundCooldown.selector, block.timestamp, nextTimestamp)
        );
        vm.prank(makeAddr("earlyCompoundKeeper"));
        market.vault.compoundPending();

        vm.warp(nextTimestamp);
        vm.prank(makeAddr("boundaryKeeper"));
        LiquidityGrowthVaultV1.CompoundResult memory second = market.vault.compoundPending();
        assertGt(second.liquidityAdded, 0);
        assertEq(market.vault.pendingGrowthNative(), 0);
        _assertGrowthAccounting(market);

        vm.expectRevert(LiquidityGrowthVaultV1.NoGrowthFunds.selector);
        vm.prank(makeAddr("emptyCompoundKeeper"));
        market.vault.compoundPending();
    }

    function test_sustainedManipulationCanBecomeTwapThenHealthyWindowRecovers() public {
        Market memory market = _deployMarket(keccak256("deep-sustained"), NORMAL_BASE_LIQUIDITY);
        LiquidityGrowthRangeSourceV1.RangeQuote memory baseline = _matureBaseline(market);
        uint256 tokenBalanceBeforeMove = market.token.balanceOf(address(this));

        _buy(market, LARGE_PRICE_MOVE);
        int24 manipulatedSpot = _currentTick(market);
        assertGt(_tickDistance(manipulatedSpot, baseline.twapTick), _maximumDeviation());
        vm.expectRevert(_deviationError(manipulatedSpot, baseline.twapTick));
        market.rangeSource.quoteRange();

        _recordSustainedState(market);
        LiquidityGrowthRangeSourceV1.RangeQuote memory manipulatedQuote = market.rangeSource.quoteRange();
        assertLe(_tickDistance(manipulatedQuote.spotTick, manipulatedQuote.twapTick), _maximumDeviation());
        assertGt(_tickDistance(manipulatedQuote.twapTick, baseline.twapTick), _maximumDeviation());

        uint256 distortedState = vm.snapshotState();
        vm.prank(makeAddr("distortedStateKeeper"));
        (, LiquidityGrowthVaultV1.CompoundResult memory distortedResult) = market.vault.process();
        assertGt(distortedResult.liquidityAdded, 0);
        assertEq(distortedResult.tickLower, manipulatedQuote.tickLower);
        assertEq(distortedResult.tickUpper, manipulatedQuote.tickUpper);
        assertTrue(vm.revertToState(distortedState));

        uint256 acquiredTokens = market.token.balanceOf(address(this)) - tokenBalanceBeforeMove;
        _sell(market, acquiredTokens);
        int24 restoredSpot = _currentTick(market);
        assertGt(_tickDistance(restoredSpot, manipulatedQuote.twapTick), _maximumDeviation());
        vm.expectRevert(_deviationError(restoredSpot, manipulatedQuote.twapTick));
        market.rangeSource.quoteRange();

        _recordHealthyState(market);
        LiquidityGrowthRangeSourceV1.RangeQuote memory recovered = market.rangeSource.quoteRange();
        assertLe(_tickDistance(recovered.spotTick, recovered.twapTick), _maximumDeviation());
        assertLe(_tickDistance(recovered.twapTick, baseline.twapTick), _maximumDeviation());

        vm.prank(makeAddr("recoveryKeeper"));
        (, LiquidityGrowthVaultV1.CompoundResult memory result) = market.vault.process();
        assertGt(result.liquidityAdded, 0);
        assertEq(result.tickLower, recovered.tickLower);
        assertEq(result.tickUpper, recovered.tickUpper);
        _assertGrowthAccounting(market);
    }

    function test_fullRangeStillChangesTheDepositMixAtTheManipulatedSpot() public pure {
        int24 tickSpacing = 200;
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(tickSpacing));
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(TickMath.maxUsableTick(tickSpacing));
        uint160 sqrtBaseline = TickMath.getSqrtPriceAtTick(0);
        uint160 sqrtManipulated = TickMath.getSqrtPriceAtTick(-10_000);
        uint256 nativeBudget = 1 ether;
        uint256 tokenBudget = 1 ether;

        uint128 baselineLiquidity = TestLiquidityAmounts.getLiquidityForAmounts(
            sqrtBaseline, sqrtLower, sqrtUpper, nativeBudget, tokenBudget
        );
        (uint256 baselineNative, uint256 baselineToken) =
            TestLiquidityAmounts.getAmountsForLiquidity(sqrtBaseline, sqrtLower, sqrtUpper, baselineLiquidity);

        uint128 manipulatedLiquidity = TestLiquidityAmounts.getLiquidityForAmounts(
            sqrtManipulated, sqrtLower, sqrtUpper, nativeBudget, tokenBudget
        );
        (uint256 manipulatedNative, uint256 manipulatedToken) =
            TestLiquidityAmounts.getAmountsForLiquidity(sqrtManipulated, sqrtLower, sqrtUpper, manipulatedLiquidity);

        assertGt(baselineNative, 0);
        assertGt(baselineToken, 0);
        assertGt(manipulatedNative, 0);
        assertGt(manipulatedToken, 0);
        assertLt(manipulatedToken, baselineToken);
        assertGt(manipulatedNative * baselineToken, baselineNative * manipulatedToken);
    }

    function test_fixedLaunchAnchoredRangeStopsCompoundingAfterLegitimateRepricing() public pure {
        int24 launchTick = 204_200;
        int24 fixedLower = launchTick - RANGE_HALF_WIDTH;
        int24 fixedUpper = launchTick;
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(fixedLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(fixedUpper);
        uint160 sqrtRepriced = TickMath.getSqrtPriceAtTick(fixedLower - 200);

        uint128 liquidity =
            TestLiquidityAmounts.getLiquidityForAmounts(sqrtRepriced, sqrtLower, sqrtUpper, 1 ether, 1 ether);
        (uint256 nativeUsed, uint256 tokenUsed) =
            TestLiquidityAmounts.getAmountsForLiquidity(sqrtRepriced, sqrtLower, sqrtUpper, liquidity);

        assertGt(nativeUsed, 0);
        assertEq(tokenUsed, 0);
    }

    function test_perCycleCapDoesNotBoundAggregateExposureUnderSustainedManipulation() public {
        Market memory market = _deployMarket(keccak256("deep-repeated-cap"), NORMAL_BASE_LIQUIDITY);
        LiquidityGrowthRangeSourceV1.RangeQuote memory baseline = _matureBaseline(market);

        _buy(market, LARGE_PRICE_MOVE);
        assertGt(_tickDistance(_currentTick(market), baseline.twapTick), _maximumDeviation());
        _recordSustainedState(market);
        market.rangeSource.quoteRange();

        (, LiquidityGrowthVaultV1.CompoundResult memory first) = market.vault.process();
        uint256 aggregateNativeBudget = first.nativeBudget;

        for (uint256 index; index < 3; index++) {
            vm.warp(block.timestamp + COMPOUND_COOLDOWN);
            vm.roll(block.number + 1);
            _buy(market, OBSERVATION_KEEPALIVE_BUY);
            market.rangeSource.quoteRange();
            LiquidityGrowthVaultV1.CompoundResult memory next = market.vault.compoundPending();
            aggregateNativeBudget += next.nativeBudget;
        }

        assertEq(aggregateNativeBudget, MAX_COMPOUND * 4);
        assertGt(market.vault.totalNativeAddedToLiquidity(), MAX_COMPOUND);
        assertGt(market.vault.pendingGrowthNative(), 0);
    }

    function test_secondWarmupWindowCannotDistinguishAContinuouslyManipulatedPool() public {
        Market memory market = _deployMarket(keccak256("deep-two-stage"), NORMAL_BASE_LIQUIDITY);
        LiquidityGrowthRangeSourceV1.RangeQuote memory baseline = _matureBaseline(market);

        _buy(market, LARGE_PRICE_MOVE);
        _recordSustainedState(market);
        LiquidityGrowthRangeSourceV1.RangeQuote memory firstStage = market.rangeSource.quoteRange();
        assertGt(_tickDistance(firstStage.twapTick, baseline.twapTick), _maximumDeviation());

        _recordSustainedState(market);
        LiquidityGrowthRangeSourceV1.RangeQuote memory secondStage = market.rangeSource.quoteRange();

        assertLe(_tickDistance(secondStage.spotTick, secondStage.twapTick), _maximumDeviation());
        assertGt(_tickDistance(secondStage.twapTick, baseline.twapTick), _maximumDeviation());
        assertLe(_tickDistance(secondStage.twapTick, firstStage.twapTick), _maximumDeviation());
    }

    function _deployMarket(bytes32 salt, uint256 baseLiquidity) private returns (Market memory market) {
        market.token = new LiquidityGrowthDeepToken(address(this));
        market.token.mint(address(this), 2_000_000_000 ether);
        market.token.approve(address(modifyLiquidityRouter), type(uint256).max);
        market.token.approve(address(swapRouter), type(uint256).max);
        market.key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(market.token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        market.poolId = PoolId.unwrap(market.key.toId());
        market.rangeSource = new LiquidityGrowthRangeSourceV1(
            manager,
            market.key,
            ILiquidityGrowthOracleV1(address(hook)),
            TWAP_WINDOW,
            RANGE_HALF_WIDTH,
            MAX_SPOT_TWAP_DEVIATION
        );

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = beneficiary;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        LiquidityGrowthVaultV1.Configuration memory configuration = LiquidityGrowthVaultV1.Configuration({
            poolKey: market.key,
            rangeSource: market.rangeSource,
            growthTargetNative: GROWTH_TARGET,
            maxCompoundNative: MAX_COMPOUND,
            tokenReserveTarget: TOKEN_RESERVE,
            activeRangeHalfWidthTicks: RANGE_HALF_WIDTH,
            compoundCooldownSeconds: COMPOUND_COOLDOWN,
            beneficiaries: beneficiaries,
            sharesBps: shares
        });
        market.vault = growthFactory.deployOrGet(salt, hook, splitFactory, configuration);
        assertTrue(market.token.transfer(address(market.vault), TOKEN_RESERVE));

        hook.registerPool(market.key, address(market.vault.upstreamVault()), TOTAL_SWAP_FEE_BPS, TOTAL_SWAP_FEE_BPS);
        manager.initialize(market.key, SQRT_PRICE_1_1);
        hook.increaseObservationCardinalityNext(OBSERVATION_CARDINALITY, PoolId.wrap(market.poolId));
        modifyLiquidityRouter.modifyLiquidity{ value: baseLiquidity }(
            market.key,
            ModifyLiquidityParams({
                tickLower: -20_000, tickUpper: 20_000, liquidityDelta: baseLiquidity.toInt256(), salt: salt
            }),
            ZERO_BYTES
        );
    }

    function _matureBaseline(Market memory market)
        private
        returns (LiquidityGrowthRangeSourceV1.RangeQuote memory quote)
    {
        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 1);
        _buy(market, OBSERVATION_SEED_BUY);
        quote = market.rangeSource.quoteRange();
        assertLe(_tickDistance(quote.spotTick, quote.twapTick), _maximumDeviation());
        (, uint16 cardinality, uint16 cardinalityNext) = hook.stateById(PoolId.wrap(market.poolId));
        assertEq(cardinality, OBSERVATION_CARDINALITY);
        assertEq(cardinalityNext, OBSERVATION_CARDINALITY);
    }

    function _recordSustainedState(Market memory market) private {
        for (uint256 index; index < SUSTAINED_OBSERVATIONS; index++) {
            vm.warp(block.timestamp + OBSERVATION_INTERVAL);
            vm.roll(block.number + 1);
            _buy(market, OBSERVATION_KEEPALIVE_BUY);
        }
    }

    function _recordHealthyState(Market memory market) private {
        for (uint256 index; index < SUSTAINED_OBSERVATIONS; index++) {
            vm.warp(block.timestamp + OBSERVATION_INTERVAL);
            vm.roll(block.number + 1);
            uint256 tokenBalanceBefore = market.token.balanceOf(address(this));
            _buy(market, OBSERVATION_KEEPALIVE_BUY);
            _sell(market, market.token.balanceOf(address(this)) - tokenBalanceBefore);
        }
    }

    function _buy(Market memory market, uint256 grossNative) private returns (BalanceDelta) {
        return _swap(market, true, -grossNative.toInt256(), grossNative);
    }

    function _sell(Market memory market, uint256 tokenInput) private returns (BalanceDelta) {
        return _swap(market, false, -tokenInput.toInt256(), 0);
    }

    function _swap(Market memory market, bool zeroForOne, int256 amountSpecified, uint256 value)
        private
        returns (BalanceDelta)
    {
        return swapRouter.swap{ value: value }(
            market.key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function _creatorAccrued(bytes32 poolId) private view returns (uint256 accrued) {
        (,,,,, accrued) = hook.poolFeeConfig(poolId);
    }

    function _currentTick(Market memory market) private view returns (int24 tick) {
        (, tick,,) = manager.getSlot0(market.key.toId());
    }

    function _deviationError(int24 spotTick, int24 twapTick) private pure returns (bytes memory) {
        return abi.encodeWithSelector(
            LiquidityGrowthRangeSourceV1.SpotTwapDeviationExceeded.selector,
            spotTick,
            twapTick,
            _tickDistance(spotTick, twapTick),
            MAX_SPOT_TWAP_DEVIATION
        );
    }

    function _maximumDeviation() private pure returns (uint24) {
        return int256(MAX_SPOT_TWAP_DEVIATION).toUint256().toUint24();
    }

    function _tickDistance(int24 left, int24 right) private pure returns (uint24 distance) {
        int256 difference = int256(left) - int256(right);
        if (difference < 0) difference = -difference;
        distance = difference.toUint256().toUint24();
    }

    function _assertGrowthAccounting(Market memory market) private view {
        assertEq(
            market.vault.totalNativeAddedToLiquidity() + market.vault.pendingGrowthNative(),
            market.vault.totalNativeAllocatedToGrowth() + market.vault.totalNativeRecycled()
        );
        assertEq(
            market.token.balanceOf(address(market.vault)) + market.vault.totalTokenAddedToLiquidity(),
            TOKEN_RESERVE + market.vault.totalTokenRecycled()
        );
    }
}
