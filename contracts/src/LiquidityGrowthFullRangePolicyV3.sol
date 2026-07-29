// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title LiquidityGrowthFullRangePolicyV3
/// @notice Fixed economic, oracle and execution policy for Deep's ETH buy-and-lock lifecycle.
/// @dev This library contains no user-selectable economic parameter. Product-facing releases call the model Deep;
///      V3 is only the internal source and release identifier.
library LiquidityGrowthFullRangePolicyV3 {
    uint16 internal constant BASIS_POINTS = 10_000;
    uint16 internal constant TOTAL_HOOK_FEE_BPS = 100;
    uint16 internal constant PROGRAMMABLE_FEE_BPS = 10;
    uint16 internal constant GROWTH_FEE_BPS = 90;
    uint16 internal constant TRUSTED_DEPTH_CYCLE_CAP_BPS = 25;

    uint24 internal constant LP_FEE_PIPS = 0;
    int24 internal constant TICK_SPACING = 200;
    int24 internal constant INITIAL_TICK = 204_200;
    int24 internal constant FULL_RANGE_TICK_LOWER = -887_200;
    int24 internal constant FULL_RANGE_TICK_UPPER = 887_200;

    uint256 internal constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;
    uint256 internal constant MIN_COMPOUND_NATIVE = 0.002 ether;
    uint256 internal constant MAX_COMPOUND_NATIVE = 0.25 ether;

    uint64 internal constant COMPOUND_COOLDOWN_SECONDS = 5 minutes;
    uint64 internal constant TWAP_WINDOW = 30 minutes;
    uint64 internal constant SHORT_TWAP_WINDOW = 5 minutes;
    uint64 internal constant ROLLING_EXPOSURE_WINDOW_SECONDS = 30 minutes;
    uint8 internal constant ROLLING_EXPOSURE_RECORD_CAPACITY = 8;
    uint8 internal constant MAX_OPTIMIZER_ITERATIONS = 64;

    uint16 internal constant MIN_OBSERVATION_CARDINALITY_NEXT = 192;
    int24 internal constant MAX_ABS_OBSERVATION_TICK_DELTA = 400;
    int24 internal constant MAX_RAW_TRUNCATED_TWAP_DELTA_TICKS = 25;
    int24 internal constant MAX_SHORT_LONG_TWAP_DEVIATION_TICKS = 50;
    int24 internal constant MAX_PRE_SPOT_TWAP_DEVIATION_TICKS = 100;
    int24 internal constant MAX_INTERNAL_SWAP_IMPACT_TICKS = 25;
    int24 internal constant MAX_POST_SPOT_TWAP_DEVIATION_TICKS = 125;

    uint8 internal constant INTENT_EMPTY = 0;
    uint8 internal constant INTENT_ARMED = 1;
    uint8 internal constant INTENT_IN_SWAP = 2;
    uint8 internal constant INTENT_SWAPPED = 3;
    uint8 internal constant INTENT_ADDED = 4;

    uint256 internal constant MAX_TOKEN_NAME_BYTES = 48;
    uint256 internal constant MAX_TOKEN_SYMBOL_BYTES = 12;
    uint256 internal constant MAX_TOKEN_DESCRIPTION_BYTES = 280;
    uint256 internal constant MAX_METADATA_URL_BYTES = 2048;
    uint256 internal constant MAX_SOCIAL_EXTRA_DATA_BYTES = 1200;

    bytes32 internal constant LOCKED_POSITION_SALT = keccak256("programmable.deep.full-range.position.v3");
    bytes32 internal constant COMPOUND_DOMAIN_TAG = keccak256("programmable.deep.compound.v3");

    function initialSqrtPriceX96() internal pure returns (uint160) {
        return TickMath.getSqrtPriceAtTick(INITIAL_TICK);
    }

    function validateFixedPolicy() internal pure {
        assert(TOTAL_HOOK_FEE_BPS == PROGRAMMABLE_FEE_BPS + GROWTH_FEE_BPS);
        assert(MAX_PRE_SPOT_TWAP_DEVIATION_TICKS + MAX_INTERNAL_SWAP_IMPACT_TICKS == MAX_POST_SPOT_TWAP_DEVIATION_TICKS);
        assert(
            uint256(ROLLING_EXPOSURE_RECORD_CAPACITY)
                >= uint256(ROLLING_EXPOSURE_WINDOW_SECONDS) / uint256(COMPOUND_COOLDOWN_SECONDS) + 2
        );
        assert(SHORT_TWAP_WINDOW < TWAP_WINDOW);
        assert(FULL_RANGE_TICK_LOWER == TickMath.minUsableTick(TICK_SPACING));
        assert(FULL_RANGE_TICK_UPPER == TickMath.maxUsableTick(TICK_SPACING));
        assert(INITIAL_TICK > FULL_RANGE_TICK_LOWER && INITIAL_TICK < FULL_RANGE_TICK_UPPER);
        assert(MIN_COMPOUND_NATIVE <= MAX_COMPOUND_NATIVE);
        assert(MAX_OPTIMIZER_ITERATIONS >= 64);
    }
}
