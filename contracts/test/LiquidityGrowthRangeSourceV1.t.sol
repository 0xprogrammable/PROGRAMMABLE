// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { ILiquidityGrowthOracleV1 } from "../src/interfaces/ILiquidityGrowthOracleV1.sol";
import { MockLiquidityGrowthOracleV1 } from "./mocks/MockLiquidityGrowthOracleV1.sol";

contract LiquidityGrowthRangeSourceV1Test is Deployers {
    uint32 internal constant TWAP_WINDOW = 30 minutes;
    int24 internal constant TICK_SPACING = 200;
    int24 internal constant RANGE_HALF_WIDTH = 2000;
    int24 internal constant MAX_DEVIATION = 600;

    MockLiquidityGrowthOracleV1 internal oracle;
    LiquidityGrowthRangeSourceV1 internal source;
    PoolKey internal observedKey;
    bytes32 internal observedPoolId;

    function setUp() public {
        deployFreshManager();
        oracle = _deployOracle(manager);
        observedKey = _keyFor(new MockERC20("Observed", "OBS", 18), oracle);
        observedPoolId = PoolId.unwrap(observedKey.toId());
        manager.initialize(observedKey, TickMath.getSqrtPriceAtTick(0));
        oracle.configure(observedPoolId, 0, 0, 0, 0);
        source = _deploySource(manager, observedKey, oracle, TWAP_WINDOW, RANGE_HALF_WIDTH, MAX_DEVIATION);
    }

    function test_quoteUsesTruncatedTwapRatherThanRawOrSpotTick() public {
        int56 rawMeanTick = -500;
        int56 truncatedMeanTick = 250;
        oracle.configure(
            observedPoolId,
            11,
            11 + rawMeanTick * int56(uint56(TWAP_WINDOW)),
            37,
            37 + truncatedMeanTick * int56(uint56(TWAP_WINDOW))
        );

        LiquidityGrowthRangeSourceV1.RangeQuote memory quote = source.quoteRange();

        assertEq(quote.spotTick, 0);
        assertEq(quote.twapTick, truncatedMeanTick);
        assertEq(quote.tickLower, -1800);
        assertEq(quote.tickUpper, 2200);
    }

    function test_negativeNonIntegralMeanRoundsTowardNegativeInfinity() public view {
        assertEq(source.arithmeticMeanTick(0, -1801, TWAP_WINDOW), -2);
        assertEq(source.arithmeticMeanTick(0, -1800, TWAP_WINDOW), -1);
        assertEq(source.arithmeticMeanTick(0, 1801, TWAP_WINDOW), 1);
    }

    function test_quoteRejectsSpotOutsideMaximumTwapDeviation() public {
        int56 manipulatedTwapTick = 601;
        oracle.configure(observedPoolId, 0, 0, 0, manipulatedTwapTick * int56(uint56(TWAP_WINDOW)));

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthRangeSourceV1.SpotTwapDeviationExceeded.selector,
                int24(0),
                int24(601),
                uint24(601),
                MAX_DEVIATION
            )
        );
        source.quoteRange();
    }

    function test_quoteAcceptsSpotAtMaximumTwapDeviationAndKeepsItInsideRange() public {
        int56 acceptedTwapTick = 600;
        oracle.configure(observedPoolId, 0, 0, 0, acceptedTwapTick * int56(uint56(TWAP_WINDOW)));

        LiquidityGrowthRangeSourceV1.RangeQuote memory quote = source.quoteRange();

        assertEq(quote.twapTick, 600);
        assertEq(quote.tickLower, -1400);
        assertEq(quote.tickUpper, 2600);
        assertGt(quote.spotTick, quote.tickLower);
        assertLt(quote.spotTick, quote.tickUpper);
    }

    function test_quoteFailsClosedWhenObservationHistoryIsImmature() public {
        oracle.setHistoryTooShort(true);

        vm.expectRevert(MockLiquidityGrowthOracleV1.ObservationHistoryTooShort.selector);
        source.quoteRange();
    }

    function test_quoteFailsClosedWhenAllocatedObservationCapacityIsBelowPolicy() public {
        uint16 insufficient = source.MIN_OBSERVATION_CARDINALITY_NEXT() - 1;
        oracle.setObservationCardinalityNext(insufficient);

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthRangeSourceV1.ObservationCapacityInsufficient.selector,
                insufficient,
                source.MIN_OBSERVATION_CARDINALITY_NEXT()
            )
        );
        source.quoteRange();
    }

    function test_quoteRejectsMalformedOracleResponse() public {
        oracle.setMalformed(true);

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthRangeSourceV1.InvalidOracleResponse.selector, uint256(1), uint256(2))
        );
        source.quoteRange();
    }

    function test_quoteRejectsUninitializedPoolBeforeConsultingOracle() public {
        PoolKey memory uninitializedKey = _keyFor(new MockERC20("Uninitialized", "NONE", 18), oracle);
        bytes32 uninitializedPoolId = PoolId.unwrap(uninitializedKey.toId());
        LiquidityGrowthRangeSourceV1 uninitializedSource =
            _deploySource(manager, uninitializedKey, oracle, TWAP_WINDOW, RANGE_HALF_WIDTH, MAX_DEVIATION);
        oracle.configure(uninitializedPoolId, 0, 0, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthRangeSourceV1.PoolNotInitialized.selector, uninitializedPoolId)
        );
        uninitializedSource.quoteRange();
    }

    function test_constructorRejectsOracleBoundToAnotherManager() public {
        deployFreshManager();
        IPoolManager otherManager = manager;
        MockLiquidityGrowthOracleV1 otherOracle = _deployOracle(otherManager);

        deployFreshManager();
        PoolKey memory mismatchedKey = _keyFor(new MockERC20("Mismatch", "BAD", 18), otherOracle);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthRangeSourceV1.InvalidOracleManager.selector, address(otherManager), address(manager)
            )
        );
        _deploySource(manager, mismatchedKey, otherOracle, TWAP_WINDOW, RANGE_HALF_WIDTH, MAX_DEVIATION);
    }

    function test_constructorRejectsRangeThatCannotContainEveryAcceptedSpot() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthRangeSourceV1.InvalidRangeConfiguration.selector, TICK_SPACING, int24(600), MAX_DEVIATION
            )
        );
        _deploySource(manager, observedKey, oracle, TWAP_WINDOW, 600, MAX_DEVIATION);
    }

    function test_rangeClampsAtGlobalTickBoundsWithoutChangingWidth() public view {
        (int24 lowerAtMinimum, int24 upperAtMinimum) = source.rangeForTwap(TickMath.MIN_TICK);
        (int24 lowerAtMaximum, int24 upperAtMaximum) = source.rangeForTwap(TickMath.MAX_TICK);

        assertEq(lowerAtMinimum, TickMath.minUsableTick(TICK_SPACING));
        assertEq(upperAtMinimum - lowerAtMinimum, RANGE_HALF_WIDTH * 2);
        assertEq(upperAtMaximum, TickMath.maxUsableTick(TICK_SPACING));
        assertEq(upperAtMaximum - lowerAtMaximum, RANGE_HALF_WIDTH * 2);
    }

    /// forge-config: default.fuzz.runs = 2000
    function testFuzz_rangeIsAlignedBoundedAndFixedWidth(int24 rawTwapTick) public view {
        int24 twapTick = int24(bound(rawTwapTick, TickMath.MIN_TICK, TickMath.MAX_TICK));
        (int24 tickLower, int24 tickUpper) = source.rangeForTwap(twapTick);

        assertEq(tickLower % TICK_SPACING, 0);
        assertEq(tickUpper % TICK_SPACING, 0);
        assertGe(tickLower, TickMath.minUsableTick(TICK_SPACING));
        assertLe(tickUpper, TickMath.maxUsableTick(TICK_SPACING));
        assertEq(tickUpper - tickLower, RANGE_HALF_WIDTH * 2);
    }

    function _deployOracle(IPoolManager poolManager_) private returns (MockLiquidityGrowthOracleV1 deployed) {
        (address predicted, bytes32 salt) =
            HookMiner.find(address(this), 0, type(MockLiquidityGrowthOracleV1).creationCode, abi.encode(poolManager_));
        deployed = new MockLiquidityGrowthOracleV1{ salt: salt }(poolManager_);
        assertEq(address(deployed), predicted);
    }

    function _deploySource(
        IPoolManager poolManager_,
        PoolKey memory poolKey_,
        ILiquidityGrowthOracleV1 oracle_,
        uint32 twapWindow_,
        int24 rangeHalfWidthTicks_,
        int24 maxDeviation_
    ) private returns (LiquidityGrowthRangeSourceV1 deployed) {
        deployed = new LiquidityGrowthRangeSourceV1(
            poolManager_, poolKey_, oracle_, twapWindow_, rangeHalfWidthTicks_, maxDeviation_
        );
    }

    function _keyFor(MockERC20 token, MockLiquidityGrowthOracleV1 oracle_) private pure returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(oracle_))
        });
    }
}
