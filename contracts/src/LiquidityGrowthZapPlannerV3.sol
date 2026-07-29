// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { ProtocolFeeLibrary } from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import { ILiquidityGrowthFeeOracleHookV2 } from "./interfaces/ILiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "./LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthSwapMathV3 } from "./libraries/LiquidityGrowthSwapMathV3.sol";

/// @title LiquidityGrowthZapPlannerV3
/// @notice Onchain quote and exact-input optimizer for one atomic Deep swap-and-add cycle.
contract LiquidityGrowthZapPlannerV3 {
    using ProtocolFeeLibrary for uint24;
    using StateLibrary for IPoolManager;

    uint8 private constant LIFECYCLE_FINALIZED = 5;

    struct OracleQuote {
        int24 longTwapTick;
        int24 shortTwapTick;
        int24 rawLongTwapTick;
        int24 spotTick;
        uint160 spotSqrtPriceX96;
        uint160 sqrtPriceLimitX96;
    }

    struct CompoundPlan {
        uint256 budgetNative;
        uint256 swapNative;
        uint256 expectedTokenOut;
        uint256 nativeForLiquidity;
        uint256 tokenForLiquidity;
        uint256 nativeDust;
        uint256 tokenDust;
        uint128 liquidity;
        uint160 postSwapSqrtPriceX96;
        int24 postSwapTick;
        uint24 protocolFeePips;
        bytes32 digest;
    }

    struct PlanningContext {
        PoolId poolId;
        uint160 spotSqrtPriceX96;
        uint160 sqrtPriceLimitX96;
        uint160 minFullRangeSqrtPriceX96;
        uint160 maxFullRangeSqrtPriceX96;
        int24 spotTick;
        uint128 activeLiquidity;
        int128 initialTickLiquidityNet;
        uint24 protocolFeePips;
    }

    struct Candidate {
        uint256 swapNative;
        uint256 expectedTokenOut;
        uint128 liquidity;
        uint128 nativeSupportedLiquidity;
        uint128 tokenSupportedLiquidity;
        uint160 postSwapSqrtPriceX96;
        int24 postSwapTick;
        bool fullFill;
    }

    error BudgetOutsidePolicy(uint256 budget);
    error CardinalityTargetTooSmall(uint16 actual, uint16 required);
    error InvalidCurrencyOrder(address currency0, address currency1);
    error InvalidHook(address hook);
    error InvalidLpFee(uint24 actual);
    error InvalidPoolLifecycle(uint8 actual);
    error InvalidTickSpacing(int24 actual);
    error InvalidTopologyTick(int24 tick, uint128 liquidityGross, int128 liquidityNet);
    error MalformedTickBitmap(int16 word, uint256 actual, uint256 expected);
    error NoFeasibleCompound();
    error NoSafePriceLimit(int24 spotTick, int24 limitTick);
    error PoolBindingMismatch(bytes32 poolId, address expectedVault, address actualVault);
    error RawOracleDivergence(int24 rawLongTick, int24 truncatedLongTick);
    error ShortOracleDivergence(int24 shortTick, int24 longTick);
    error SpotOracleDivergence(int24 spotTick, int24 longTick);
    error UnfittableLiquidity(uint128 liquidity);

    function plan(PoolKey calldata key, address vault, uint256 nonce, uint256 budgetNative, uint256 accountedTokenDust)
        external
        view
        returns (OracleQuote memory oracleQuote, CompoundPlan memory compoundPlan)
    {
        if (budgetNative < Policy.MIN_COMPOUND_NATIVE || budgetNative > Policy.MAX_COMPOUND_NATIVE) {
            revert BudgetOutsidePolicy(budgetNative);
        }

        ILiquidityGrowthFeeOracleHookV2 hook = _validatedHook(key);
        bytes32 rawPoolId = PoolId.unwrap(key.toId());
        (address configuredVault,, uint8 lifecycle,) = hook.poolFeeConfig(rawPoolId);
        if (configuredVault != vault) {
            revert PoolBindingMismatch(rawPoolId, configuredVault, vault);
        }
        if (lifecycle != LIFECYCLE_FINALIZED) revert InvalidPoolLifecycle(lifecycle);

        IPoolManager manager = hook.poolManager();
        PlanningContext memory context = _planningContext(manager, hook, PoolId.wrap(rawPoolId));
        oracleQuote = _oracleQuote(hook, context);
        context.sqrtPriceLimitX96 = oracleQuote.sqrtPriceLimitX96;
        Candidate memory best = _search(context, budgetNative, accountedTokenDust);
        compoundPlan = _materializePlan(key, vault, nonce, budgetNative, accountedTokenDust, context, best);
    }

    function _validatedHook(PoolKey calldata key) private view returns (ILiquidityGrowthFeeOracleHookV2 hook) {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (currency0 != address(0) || currency1 == address(0)) {
            revert InvalidCurrencyOrder(currency0, currency1);
        }
        address hookAddress = address(key.hooks);
        if (hookAddress == address(0) || hookAddress.code.length == 0) {
            revert InvalidHook(hookAddress);
        }
        hook = ILiquidityGrowthFeeOracleHookV2(hookAddress);
        if (
            hook.TOTAL_HOOK_FEE_BPS() != Policy.TOTAL_HOOK_FEE_BPS
                || hook.PROGRAMMABLE_FEE_BPS() != Policy.PROGRAMMABLE_FEE_BPS
                || hook.GROWTH_FEE_BPS() != Policy.GROWTH_FEE_BPS
                || hook.maxAbsTickDelta() != Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        ) {
            revert InvalidHook(hookAddress);
        }
        if (key.fee != Policy.LP_FEE_PIPS || hook.LP_FEE_PIPS() != Policy.LP_FEE_PIPS) {
            revert InvalidLpFee(key.fee);
        }
        if (key.tickSpacing != Policy.TICK_SPACING || hook.TICK_SPACING() != Policy.TICK_SPACING) {
            revert InvalidTickSpacing(key.tickSpacing);
        }
    }

    function _planningContext(IPoolManager manager, ILiquidityGrowthFeeOracleHookV2 hook, PoolId poolId)
        private
        view
        returns (PlanningContext memory context)
    {
        if (address(manager) == address(0) || address(manager) != address(hook.poolManager())) {
            revert InvalidHook(address(hook));
        }
        _validateTopology(manager, poolId);
        uint24 packedProtocolFee;
        uint24 lpFee;
        (context.spotSqrtPriceX96, context.spotTick, packedProtocolFee, lpFee) = manager.getSlot0(poolId);
        if (lpFee != Policy.LP_FEE_PIPS) revert InvalidLpFee(lpFee);
        context.poolId = poolId;
        context.activeLiquidity = manager.getLiquidity(poolId);
        (, context.initialTickLiquidityNet) = manager.getTickLiquidity(poolId, Policy.INITIAL_TICK);
        context.protocolFeePips = packedProtocolFee.getZeroForOneFee();
        context.minFullRangeSqrtPriceX96 = TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_LOWER);
        context.maxFullRangeSqrtPriceX96 = TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_UPPER);
    }

    function _oracleQuote(ILiquidityGrowthFeeOracleHookV2 hook, PlanningContext memory context)
        private
        view
        returns (OracleQuote memory quote)
    {
        (, uint16 cardinality, uint16 cardinalityNext) = hook.stateById(context.poolId);
        cardinality;
        if (cardinalityNext < Policy.MIN_OBSERVATION_CARDINALITY_NEXT) {
            revert CardinalityTargetTooSmall(cardinalityNext, Policy.MIN_OBSERVATION_CARDINALITY_NEXT);
        }

        uint32[] memory secondsAgos = new uint32[](3);
        secondsAgos[0] = uint32(Policy.TWAP_WINDOW);
        secondsAgos[1] = uint32(Policy.SHORT_TWAP_WINDOW);
        secondsAgos[2] = 0;
        (int56[] memory rawCumulatives, int56[] memory truncatedCumulatives) = hook.observe(secondsAgos, context.poolId);

        quote.rawLongTwapTick = _meanTick(rawCumulatives[2] - rawCumulatives[0], uint32(Policy.TWAP_WINDOW));
        quote.longTwapTick = _meanTick(truncatedCumulatives[2] - truncatedCumulatives[0], uint32(Policy.TWAP_WINDOW));
        quote.shortTwapTick = _meanTick(rawCumulatives[2] - rawCumulatives[1], uint32(Policy.SHORT_TWAP_WINDOW));
        quote.spotTick = context.spotTick;
        quote.spotSqrtPriceX96 = context.spotSqrtPriceX96;

        if (
            _absoluteTickDelta(quote.rawLongTwapTick, quote.longTwapTick)
                > uint24(Policy.MAX_RAW_TRUNCATED_TWAP_DELTA_TICKS)
        ) {
            revert RawOracleDivergence(quote.rawLongTwapTick, quote.longTwapTick);
        }
        if (
            _absoluteTickDelta(quote.shortTwapTick, quote.longTwapTick)
                > uint24(Policy.MAX_SHORT_LONG_TWAP_DEVIATION_TICKS)
        ) {
            revert ShortOracleDivergence(quote.shortTwapTick, quote.longTwapTick);
        }
        if (_absoluteTickDelta(quote.spotTick, quote.longTwapTick) > uint24(Policy.MAX_PRE_SPOT_TWAP_DEVIATION_TICKS)) {
            revert SpotOracleDivergence(quote.spotTick, quote.longTwapTick);
        }

        int24 limitTick = quote.spotTick - Policy.MAX_INTERNAL_SWAP_IMPACT_TICKS;
        int24 oracleFloor = quote.longTwapTick - Policy.MAX_POST_SPOT_TWAP_DEVIATION_TICKS;
        int24 absoluteFloor = Policy.FULL_RANGE_TICK_LOWER + 1;
        if (oracleFloor > limitTick) limitTick = oracleFloor;
        if (absoluteFloor > limitTick) limitTick = absoluteFloor;
        if (limitTick >= quote.spotTick) {
            revert NoSafePriceLimit(quote.spotTick, limitTick);
        }
        quote.sqrtPriceLimitX96 = TickMath.getSqrtPriceAtTick(limitTick);
    }

    function _search(PlanningContext memory context, uint256 budgetNative, uint256 accountedTokenDust)
        private
        pure
        returns (Candidate memory best)
    {
        uint256 low = 1;
        uint256 high = budgetNative;
        for (uint8 iteration; iteration < Policy.MAX_OPTIMIZER_ITERATIONS && low <= high; ++iteration) {
            uint256 midpoint = low + (high - low) / 2;
            Candidate memory candidate = _candidate(context, budgetNative, accountedTokenDust, midpoint);
            best = _better(best, candidate);

            if (!candidate.fullFill || candidate.nativeSupportedLiquidity < candidate.tokenSupportedLiquidity) {
                if (midpoint == 0) break;
                high = midpoint - 1;
            } else {
                low = midpoint + 1;
            }
        }

        if (low <= budgetNative) {
            best = _better(best, _candidate(context, budgetNative, accountedTokenDust, low));
        }
        if (high != 0 && high <= budgetNative) {
            best = _better(best, _candidate(context, budgetNative, accountedTokenDust, high));
        }
        if (best.swapNative > 1) {
            best = _better(best, _candidate(context, budgetNative, accountedTokenDust, best.swapNative - 1));
        }
        if (best.swapNative < budgetNative) {
            best = _better(best, _candidate(context, budgetNative, accountedTokenDust, best.swapNative + 1));
        }
        if (!best.fullFill || best.liquidity == 0) revert NoFeasibleCompound();
    }

    function _candidate(
        PlanningContext memory context,
        uint256 budgetNative,
        uint256 accountedTokenDust,
        uint256 swapNative
    ) private pure returns (Candidate memory candidate) {
        candidate.swapNative = swapNative;
        LiquidityGrowthSwapMathV3.Result memory simulation = LiquidityGrowthSwapMathV3.simulateExactInputZeroForOne(
            LiquidityGrowthSwapMathV3.State({
                sqrtPriceX96: context.spotSqrtPriceX96,
                sqrtPriceLimitX96: context.sqrtPriceLimitX96,
                tick: context.spotTick,
                liquidity: context.activeLiquidity,
                initialTickLiquidityNet: context.initialTickLiquidityNet,
                protocolFeePips: context.protocolFeePips
            }),
            swapNative
        );
        candidate.fullFill = simulation.fullFill;
        candidate.expectedTokenOut = simulation.amountOut;
        candidate.postSwapSqrtPriceX96 = simulation.sqrtPriceX96;
        candidate.postSwapTick = simulation.tick;
        if (
            !simulation.fullFill
                || _absoluteTickDelta(context.spotTick, simulation.tick) > uint24(Policy.MAX_INTERNAL_SWAP_IMPACT_TICKS)
        ) {
            candidate.fullFill = false;
            return candidate;
        }

        uint256 remainingNative = budgetNative - swapNative;
        uint256 availableToken = simulation.amountOut + accountedTokenDust;
        candidate.nativeSupportedLiquidity = LiquidityAmounts.getLiquidityForAmount0(
            simulation.sqrtPriceX96, context.maxFullRangeSqrtPriceX96, remainingNative
        );
        candidate.tokenSupportedLiquidity = LiquidityAmounts.getLiquidityForAmount1(
            context.minFullRangeSqrtPriceX96, simulation.sqrtPriceX96, availableToken
        );
        candidate.liquidity = candidate.nativeSupportedLiquidity < candidate.tokenSupportedLiquidity
            ? candidate.nativeSupportedLiquidity
            : candidate.tokenSupportedLiquidity;
    }

    function _better(Candidate memory current, Candidate memory candidate) private pure returns (Candidate memory) {
        if (!candidate.fullFill) return current;
        if (
            candidate.liquidity > current.liquidity
                || (candidate.liquidity == current.liquidity
                    && candidate.liquidity != 0
                    && (current.swapNative == 0 || candidate.swapNative < current.swapNative))
        ) {
            return candidate;
        }
        return current;
    }

    function _materializePlan(
        PoolKey calldata key,
        address vault,
        uint256 nonce,
        uint256 budgetNative,
        uint256 accountedTokenDust,
        PlanningContext memory context,
        Candidate memory best
    ) private view returns (CompoundPlan memory compoundPlan) {
        uint128 fittedLiquidity = best.liquidity;
        (uint256 nativeForLiquidity, uint256 tokenForLiquidity) = _amountsForLiquidity(
            best.postSwapSqrtPriceX96,
            context.minFullRangeSqrtPriceX96,
            context.maxFullRangeSqrtPriceX96,
            fittedLiquidity
        );
        uint256 availableToken = best.expectedTokenOut + accountedTokenDust;
        if (best.swapNative + nativeForLiquidity > budgetNative || tokenForLiquidity > availableToken) {
            if (fittedLiquidity == 0) revert UnfittableLiquidity(fittedLiquidity);
            --fittedLiquidity;
            (nativeForLiquidity, tokenForLiquidity) = _amountsForLiquidity(
                best.postSwapSqrtPriceX96,
                context.minFullRangeSqrtPriceX96,
                context.maxFullRangeSqrtPriceX96,
                fittedLiquidity
            );
        }
        if (
            fittedLiquidity == 0 || best.swapNative + nativeForLiquidity > budgetNative
                || tokenForLiquidity > availableToken
        ) {
            revert UnfittableLiquidity(fittedLiquidity);
        }

        compoundPlan.budgetNative = budgetNative;
        compoundPlan.swapNative = best.swapNative;
        compoundPlan.expectedTokenOut = best.expectedTokenOut;
        compoundPlan.nativeForLiquidity = nativeForLiquidity;
        compoundPlan.tokenForLiquidity = tokenForLiquidity;
        compoundPlan.nativeDust = budgetNative - best.swapNative - nativeForLiquidity;
        compoundPlan.tokenDust = availableToken - tokenForLiquidity;
        compoundPlan.liquidity = fittedLiquidity;
        compoundPlan.postSwapSqrtPriceX96 = best.postSwapSqrtPriceX96;
        compoundPlan.postSwapTick = best.postSwapTick;
        compoundPlan.protocolFeePips = context.protocolFeePips;
        compoundPlan.digest = keccak256(
            abi.encode(
                block.chainid,
                address(key.hooks),
                vault,
                context.poolId,
                nonce,
                best.swapNative,
                context.sqrtPriceLimitX96,
                best.expectedTokenOut,
                fittedLiquidity
            )
        );
    }

    function _amountsForLiquidity(
        uint160 sqrtPriceX96,
        uint160 minSqrtPriceX96,
        uint160 maxSqrtPriceX96,
        uint128 liquidity
    ) private pure returns (uint256 nativeAmount, uint256 tokenAmount) {
        nativeAmount = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, maxSqrtPriceX96, liquidity, true);
        tokenAmount = SqrtPriceMath.getAmount1Delta(minSqrtPriceX96, sqrtPriceX96, liquidity, true);
    }

    function _validateTopology(IPoolManager manager, PoolId poolId) private view {
        (uint128 lowerGross, int128 lowerNet) = manager.getTickLiquidity(poolId, Policy.FULL_RANGE_TICK_LOWER);
        (uint128 initialGross, int128 initialNet) = manager.getTickLiquidity(poolId, Policy.INITIAL_TICK);
        (uint128 upperGross, int128 upperNet) = manager.getTickLiquidity(poolId, Policy.FULL_RANGE_TICK_UPPER);
        if (lowerGross == 0 || lowerNet <= 0) {
            revert InvalidTopologyTick(Policy.FULL_RANGE_TICK_LOWER, lowerGross, lowerNet);
        }
        if (initialGross == 0 || initialNet >= 0) {
            revert InvalidTopologyTick(Policy.INITIAL_TICK, initialGross, initialNet);
        }
        if ((upperGross == 0 && upperNet != 0) || (upperGross != 0 && upperNet >= 0)) {
            revert InvalidTopologyTick(Policy.FULL_RANGE_TICK_UPPER, upperGross, upperNet);
        }

        (int16 lowerWord,) = _wordAndBit(Policy.FULL_RANGE_TICK_LOWER);
        (int16 upperWord,) = _wordAndBit(Policy.FULL_RANGE_TICK_UPPER);
        for (int256 word = lowerWord; word <= upperWord; ++word) {
            uint256 expected;
            expected |= _expectedBit(Policy.FULL_RANGE_TICK_LOWER, int16(word), lowerGross);
            expected |= _expectedBit(Policy.INITIAL_TICK, int16(word), initialGross);
            expected |= _expectedBit(Policy.FULL_RANGE_TICK_UPPER, int16(word), upperGross);
            uint256 actual = manager.getTickBitmap(poolId, int16(word));
            if (actual != expected) revert MalformedTickBitmap(int16(word), actual, expected);
        }
    }

    function _expectedBit(int24 tick, int16 word, uint128 liquidityGross) private pure returns (uint256) {
        if (liquidityGross == 0) return 0;
        (int16 expectedWord, uint8 bit) = _wordAndBit(tick);
        return expectedWord == word ? uint256(1) << bit : 0;
    }

    function _wordAndBit(int24 tick) private pure returns (int16 word, uint8 bit) {
        int24 compressed = tick / Policy.TICK_SPACING;
        word = int16(compressed >> 8);
        bit = uint8(uint24(compressed) & 0xff);
    }

    function _meanTick(int56 cumulativeDelta, uint32 secondsElapsed) private pure returns (int24 mean) {
        int256 numerator = int256(cumulativeDelta);
        int256 denominator = int256(uint256(secondsElapsed));
        int256 quotient = numerator / denominator;
        if (numerator < 0 && numerator % denominator != 0) --quotient;
        mean = int24(quotient);
    }

    function _absoluteTickDelta(int24 left, int24 right) private pure returns (uint24) {
        int256 delta = int256(left) - int256(right);
        return uint24(uint256(delta < 0 ? -delta : delta));
    }
}
