// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { ILiquidityGrowthOracleV1 } from "./interfaces/ILiquidityGrowthOracleV1.sol";

/// @title LiquidityGrowthRangeSourceV1
/// @notice Derives an immutable, tick-aligned liquidity range from a truncated same-pool TWAP.
/// @dev This contract intentionally has no spot-price fallback. If the hook has not accumulated enough history,
///      the quote reverts and compounding must wait. The current spot tick is used only as a manipulation circuit
///      breaker, never as the range center.
contract LiquidityGrowthRangeSourceV1 {
    using SafeCast for int256;
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;

    uint32 public constant MIN_TWAP_WINDOW = 5 minutes;
    uint32 public constant MAX_TWAP_WINDOW = 1 days;

    IPoolManager public immutable poolManager;
    ILiquidityGrowthOracleV1 public immutable oracleHook;
    bytes32 public immutable poolId;
    int24 public immutable tickSpacing;
    int24 public immutable rangeHalfWidthTicks;
    int24 public immutable maxSpotTwapDeviationTicks;
    uint32 public immutable twapWindow;

    error InvalidDependency(address dependency);
    error InvalidOracleHook(address actual, address expected);
    error InvalidOracleManager(address actual, address expected);
    error InvalidOracleResponse(uint256 cumulativeLength, uint256 truncatedLength);
    error InvalidRangeConfiguration(int24 tickSpacing, int24 rangeHalfWidthTicks, int24 maxSpotTwapDeviationTicks);
    error InvalidTwapTick(int56 tick);
    error InvalidTwapWindow(uint32 twapWindow);
    error PoolNotInitialized(bytes32 poolId);
    error SpotTwapDeviationExceeded(int24 spotTick, int24 twapTick, uint24 deviation, int24 maximumDeviation);

    struct RangeQuote {
        int24 tickLower;
        int24 tickUpper;
        int24 twapTick;
        int24 spotTick;
    }

    constructor(
        IPoolManager poolManager_,
        PoolKey memory poolKey_,
        ILiquidityGrowthOracleV1 oracleHook_,
        uint32 twapWindow_,
        int24 rangeHalfWidthTicks_,
        int24 maxSpotTwapDeviationTicks_
    ) {
        if (address(poolManager_) == address(0) || address(poolManager_).code.length == 0) {
            revert InvalidDependency(address(poolManager_));
        }
        if (address(oracleHook_) == address(0) || address(oracleHook_).code.length == 0) {
            revert InvalidDependency(address(oracleHook_));
        }
        if (address(poolKey_.hooks) != address(oracleHook_)) {
            revert InvalidOracleHook(address(poolKey_.hooks), address(oracleHook_));
        }

        address oracleManager = address(oracleHook_.poolManager());
        if (oracleManager != address(poolManager_)) {
            revert InvalidOracleManager(oracleManager, address(poolManager_));
        }
        if (twapWindow_ < MIN_TWAP_WINDOW || twapWindow_ > MAX_TWAP_WINDOW) {
            revert InvalidTwapWindow(twapWindow_);
        }

        int24 spacing = poolKey_.tickSpacing;
        if (spacing < TickMath.MIN_TICK_SPACING || spacing > TickMath.MAX_TICK_SPACING) {
            revert InvalidRangeConfiguration(spacing, rangeHalfWidthTicks_, maxSpotTwapDeviationTicks_);
        }
        int24 minTick = TickMath.minUsableTick(spacing);
        int24 maxTick = TickMath.maxUsableTick(spacing);
        int256 fullRangeWidth = int256(maxTick) - int256(minTick);
        int256 configuredRangeWidth = int256(rangeHalfWidthTicks_) * 2;
        if (
            rangeHalfWidthTicks_ <= 0 || rangeHalfWidthTicks_ % spacing != 0 || configuredRangeWidth > fullRangeWidth
                || maxSpotTwapDeviationTicks_ <= 0
                || int256(rangeHalfWidthTicks_) < int256(maxSpotTwapDeviationTicks_) + int256(spacing)
        ) {
            revert InvalidRangeConfiguration(spacing, rangeHalfWidthTicks_, maxSpotTwapDeviationTicks_);
        }

        poolManager = poolManager_;
        oracleHook = oracleHook_;
        poolId = PoolId.unwrap(poolKey_.toId());
        tickSpacing = spacing;
        rangeHalfWidthTicks = rangeHalfWidthTicks_;
        maxSpotTwapDeviationTicks = maxSpotTwapDeviationTicks_;
        twapWindow = twapWindow_;
    }

    /// @notice Returns the range that a compounding operation may use at the current block.
    /// @dev Reverts when the pool is uninitialized, oracle history is immature, the response is malformed, or spot
    ///      has moved too far from the truncated TWAP.
    function quoteRange() external view returns (RangeQuote memory quote) {
        PoolId id = PoolId.wrap(poolId);
        // The range policy needs only the initialization sentinel and current tick from slot0.
        // slither-disable-next-line unused-return
        (uint160 sqrtPriceX96, int24 spotTick,,) = poolManager.getSlot0(id);
        if (sqrtPriceX96 == 0) revert PoolNotInitialized(poolId);

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives, int56[] memory truncatedTickCumulatives) = oracleHook.observe(secondsAgos, id);
        if (tickCumulatives.length != 2 || truncatedTickCumulatives.length != 2) {
            revert InvalidOracleResponse(tickCumulatives.length, truncatedTickCumulatives.length);
        }

        int24 twapTick = arithmeticMeanTick(truncatedTickCumulatives[0], truncatedTickCumulatives[1], twapWindow);
        uint24 deviation = _absoluteTickDifference(spotTick, twapTick);
        uint24 maximumDeviation = int256(maxSpotTwapDeviationTicks).toUint256().toUint24();
        if (deviation > maximumDeviation) {
            revert SpotTwapDeviationExceeded(spotTick, twapTick, deviation, maxSpotTwapDeviationTicks);
        }

        (quote.tickLower, quote.tickUpper) = rangeForTwap(twapTick);
        quote.twapTick = twapTick;
        quote.spotTick = spotTick;
    }

    /// @notice Converts two cumulative observations into an arithmetic mean tick.
    /// @dev Negative non-integral means round toward negative infinity, matching Uniswap's tick convention.
    function arithmeticMeanTick(int56 tickCumulativeStart, int56 tickCumulativeEnd, uint32 window)
        public
        pure
        returns (int24 meanTick)
    {
        if (window == 0) revert InvalidTwapWindow(window);

        int56 cumulativeDelta;
        unchecked {
            cumulativeDelta = tickCumulativeEnd - tickCumulativeStart;
        }
        int56 denominator = int56(uint56(window));
        int56 mean = cumulativeDelta / denominator;
        if (cumulativeDelta < 0 && cumulativeDelta % denominator != 0) mean--;
        if (mean < TickMath.MIN_TICK || mean > TickMath.MAX_TICK) revert InvalidTwapTick(mean);
        meanTick = int256(mean).toInt24();
    }

    /// @notice Returns a fixed-width, usable range centered as closely as possible on `twapTick`.
    function rangeForTwap(int24 twapTick) public view returns (int24 tickLower, int24 tickUpper) {
        if (twapTick < TickMath.MIN_TICK || twapTick > TickMath.MAX_TICK) {
            revert InvalidTwapTick(int56(twapTick));
        }

        int256 spacing = int256(tickSpacing);
        int256 center = int256(twapTick);
        int256 remainder = center % spacing;
        center -= remainder;
        if (remainder < 0) center -= spacing;

        int256 halfWidth = int256(rangeHalfWidthTicks);
        int256 lower = center - halfWidth;
        int256 upper = center + halfWidth;
        int256 minTick = int256(TickMath.minUsableTick(tickSpacing));
        int256 maxTick = int256(TickMath.maxUsableTick(tickSpacing));
        int256 width = halfWidth * 2;

        if (lower < minTick) {
            lower = minTick;
            upper = minTick + width;
        }
        if (upper > maxTick) {
            upper = maxTick;
            lower = maxTick - width;
        }

        tickLower = lower.toInt24();
        tickUpper = upper.toInt24();
    }

    // Slither cannot currently build the caller IR through the external oracle array response.
    // slither-disable-next-line dead-code
    function _absoluteTickDifference(int24 a, int24 b) private pure returns (uint24 difference) {
        int256 signedDifference = int256(a) - int256(b);
        if (signedDifference < 0) signedDifference = -signedDifference;
        difference = signedDifference.toUint256().toUint24();
    }
}
