// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { FixedPoint96 } from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/// @title LiquidityGrowthFullRangePolicyV2
/// @notice The fixed economic and execution envelope for the first full-range liquidity-growth launch model.
/// @dev V2 has one public configuration: a 0.05 ETH target and 150M-token reserve. The reserve is at least four times
///      the launch-price pairing requirement and remains solvent for the complete native target at tick 218000.
///      Compounds use only their exact spot quote; unused reserve stays permanently locked inside the vault.
library LiquidityGrowthFullRangePolicyV2 {
    uint16 internal constant BASIS_POINTS = 10_000;
    uint16 internal constant MIN_UTILIZATION_BPS = 8500;
    uint16 internal constant TRUSTED_DEPTH_CAP_BPS = 25;
    uint16 internal constant REQUIRED_RESERVE_MULTIPLE = 4;

    uint256 internal constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant TOKEN_RESERVE_TARGET = 150_000_000 ether;
    uint256 internal constant GROWTH_TARGET_NATIVE = 0.05 ether;
    uint256 internal constant MAX_COMPOUND_NATIVE = 0.25 ether;
    uint256 internal constant MIN_COMPOUND_NATIVE = 0.002 ether;
    uint64 internal constant COMPOUND_COOLDOWN_SECONDS = 5 minutes;
    uint64 internal constant ROLLING_EXPOSURE_WINDOW_SECONDS = 30 minutes;
    uint8 internal constant ROLLING_EXPOSURE_RECORD_CAPACITY = 8;

    int24 internal constant INITIAL_TICK = 204_200;
    int24 internal constant STRESS_TICK = 218_000;
    int24 internal constant TICK_SPACING = 200;
    int24 internal constant FULL_RANGE_TICK_LOWER = -887_200;
    int24 internal constant FULL_RANGE_TICK_UPPER = 887_200;

    bytes32 internal constant LOCKED_POSITION_SALT = keccak256("programmable.liquidity-growth.full-range.position.v2");

    error FixedPolicyInvalid(uint256 reserve, uint256 requiredReserve);
    error PriceOutsideReserveEnvelope(uint256 tokenBudget, uint256 maximumTokenBudget);

    function initialSqrtPriceX96() internal pure returns (uint160) {
        return TickMath.getSqrtPriceAtTick(INITIAL_TICK);
    }

    /// @notice Tokens required for a full-range position whose native side is exactly `nativeAmount`.
    function tokensRequiredForNative(uint160 sqrtPriceX96, uint256 nativeAmount)
        internal
        pure
        returns (uint256 tokenAmount)
    {
        uint160 sqrtLowerX96 = TickMath.getSqrtPriceAtTick(FULL_RANGE_TICK_LOWER);
        uint160 sqrtUpperX96 = TickMath.getSqrtPriceAtTick(FULL_RANGE_TICK_UPPER);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount0(sqrtPriceX96, sqrtUpperX96, nativeAmount);
        tokenAmount = FullMath.mulDivRoundingUp(uint256(liquidity), sqrtPriceX96 - sqrtLowerX96, FixedPoint96.Q96);
    }

    /// @notice Exact token budget used for a compound at the current pool price.
    function pairingTokenBudget(uint160 sqrtPriceX96, uint256 nativeAmount)
        internal
        pure
        returns (uint256 tokenAmount)
    {
        tokenAmount = tokensRequiredForNative(sqrtPriceX96, nativeAmount);
        uint256 maximum = tokensRequiredForNative(TickMath.getSqrtPriceAtTick(STRESS_TICK), nativeAmount);
        if (tokenAmount > maximum) revert PriceOutsideReserveEnvelope(tokenAmount, maximum);
    }

    function priceWithinEnvelope(uint160 sqrtPriceX96) internal pure returns (bool) {
        return tokensRequiredForNative(sqrtPriceX96, 1 ether)
            <= tokensRequiredForNative(TickMath.getSqrtPriceAtTick(STRESS_TICK), 1 ether);
    }

    function requiredReserveAtLaunch() internal pure returns (uint256 requiredReserve) {
        uint256 requiredForTarget = tokensRequiredForNative(initialSqrtPriceX96(), GROWTH_TARGET_NATIVE);
        requiredReserve = requiredForTarget * REQUIRED_RESERVE_MULTIPLE;
    }

    function requiredReserveAtStress(uint256 remainingNativeTarget) internal pure returns (uint256 requiredReserve) {
        requiredReserve = tokensRequiredForNative(TickMath.getSqrtPriceAtTick(STRESS_TICK), remainingNativeTarget);
    }

    function reserveBufferBpsAtLaunch() internal pure returns (uint256 bufferBps) {
        uint256 requiredForTarget = tokensRequiredForNative(initialSqrtPriceX96(), GROWTH_TARGET_NATIVE);
        bufferBps = FullMath.mulDiv(TOKEN_RESERVE_TARGET, BASIS_POINTS, requiredForTarget);
    }

    function validateFixedPolicy() internal pure {
        uint256 launchRequirement = requiredReserveAtLaunch();
        uint256 stressRequirement = requiredReserveAtStress(GROWTH_TARGET_NATIVE);
        uint256 requiredReserve = launchRequirement > stressRequirement ? launchRequirement : stressRequirement;
        if (TOKEN_RESERVE_TARGET < requiredReserve) {
            revert FixedPolicyInvalid(TOKEN_RESERVE_TARGET, requiredReserve);
        }
        assert(FULL_RANGE_TICK_LOWER == TickMath.minUsableTick(TICK_SPACING));
        assert(FULL_RANGE_TICK_UPPER == TickMath.maxUsableTick(TICK_SPACING));
    }
}
