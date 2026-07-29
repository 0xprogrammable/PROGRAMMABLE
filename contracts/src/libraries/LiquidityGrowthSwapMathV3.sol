// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { LiquidityMath } from "@uniswap/v4-core/src/libraries/LiquidityMath.sol";
import { SwapMath } from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../LiquidityGrowthFullRangePolicyV3.sol";

/// @title LiquidityGrowthSwapMathV3
/// @notice Exact-input ETH-to-token simulation for Deep's hook-enforced one-boundary topology.
/// @dev The pool can contain only the launch position and the vault's full-range position. A zero-for-one compound
///      therefore crosses at most the launch position's upper tick before reaching its strict price limit.
library LiquidityGrowthSwapMathV3 {
    uint8 internal constant MAXIMUM_STEPS = 2;

    struct State {
        uint160 sqrtPriceX96;
        uint160 sqrtPriceLimitX96;
        int24 tick;
        uint128 liquidity;
        int128 initialTickLiquidityNet;
        uint24 protocolFeePips;
    }

    struct Result {
        uint160 sqrtPriceX96;
        int24 tick;
        uint128 liquidity;
        uint256 amountInConsumed;
        uint256 amountOut;
        uint256 protocolFeeAmount;
        bool fullFill;
        bool crossedInitialTick;
    }

    struct Step {
        uint160 startSqrtPriceX96;
        uint160 nextSqrtPriceX96;
        uint160 targetSqrtPriceX96;
        int24 nextTick;
        uint256 amountIn;
        uint256 amountOut;
        uint256 feeAmount;
        bool initialTickAhead;
    }

    error AmountTooLarge(uint256 amount);
    error BoundaryBeyondModel(int24 tick);
    error InsufficientActiveLiquidity();
    error InvalidInitialTickLiquidity(int128 liquidityNet);
    error InvalidPriceLimit(uint160 current, uint160 limit);
    error InvalidProtocolFee(uint24 protocolFeePips);
    error StepLimitExceeded();

    function maximumSteps() internal pure returns (uint8) {
        return MAXIMUM_STEPS;
    }

    function simulateExactInputZeroForOne(State memory state, uint256 amountIn)
        internal
        pure
        returns (Result memory result)
    {
        if (amountIn > uint256(type(int256).max)) revert AmountTooLarge(amountIn);
        if (state.sqrtPriceLimitX96 <= TickMath.MIN_SQRT_PRICE || state.sqrtPriceLimitX96 >= state.sqrtPriceX96) {
            revert InvalidPriceLimit(state.sqrtPriceX96, state.sqrtPriceLimitX96);
        }
        if (state.protocolFeePips > 1000) revert InvalidProtocolFee(state.protocolFeePips);
        if (state.liquidity == 0) revert InsufficientActiveLiquidity();
        if (state.initialTickLiquidityNet >= 0 || state.initialTickLiquidityNet == type(int128).min) {
            revert InvalidInitialTickLiquidity(state.initialTickLiquidityNet);
        }

        result.sqrtPriceX96 = state.sqrtPriceX96;
        result.tick = state.tick;
        result.liquidity = state.liquidity;
        int256 remaining = -int256(amountIn);

        for (uint8 stepIndex; stepIndex < MAXIMUM_STEPS; ++stepIndex) {
            if (remaining == 0 || result.sqrtPriceX96 == state.sqrtPriceLimitX96) break;

            Step memory step;
            step.initialTickAhead = result.tick >= Policy.INITIAL_TICK;
            step.nextTick = step.initialTickAhead ? Policy.INITIAL_TICK : Policy.FULL_RANGE_TICK_LOWER;
            step.nextSqrtPriceX96 = TickMath.getSqrtPriceAtTick(step.nextTick);
            step.targetSqrtPriceX96 =
                step.nextSqrtPriceX96 < state.sqrtPriceLimitX96 ? state.sqrtPriceLimitX96 : step.nextSqrtPriceX96;
            step.startSqrtPriceX96 = result.sqrtPriceX96;

            (result.sqrtPriceX96, step.amountIn, step.amountOut, step.feeAmount) = SwapMath.computeSwapStep(
                result.sqrtPriceX96, step.targetSqrtPriceX96, result.liquidity, remaining, state.protocolFeePips
            );

            result.amountOut += step.amountOut;
            result.protocolFeeAmount += step.feeAmount;
            remaining += int256(step.amountIn + step.feeAmount);

            if (result.sqrtPriceX96 == step.nextSqrtPriceX96) {
                if (!step.initialTickAhead) revert BoundaryBeyondModel(step.nextTick);
                result.liquidity = LiquidityMath.addDelta(result.liquidity, -state.initialTickLiquidityNet);
                result.tick = step.nextTick - 1;
                result.crossedInitialTick = true;
            } else if (result.sqrtPriceX96 != step.startSqrtPriceX96) {
                result.tick = TickMath.getTickAtSqrtPrice(result.sqrtPriceX96);
            }
        }

        if (remaining != 0 && result.sqrtPriceX96 != state.sqrtPriceLimitX96) {
            revert StepLimitExceeded();
        }
        result.fullFill = remaining == 0;
        result.amountInConsumed = amountIn - uint256(-remaining);
    }
}
