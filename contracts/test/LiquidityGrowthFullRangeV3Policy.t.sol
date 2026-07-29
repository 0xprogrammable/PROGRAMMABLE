// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";

contract LiquidityGrowthFullRangeV3PolicyTest is Test {
    function test_fixedPolicyMatchesApprovedDeepEconomics() public pure {
        assertEq(Policy.BASIS_POINTS, 10_000);
        assertEq(Policy.TOTAL_HOOK_FEE_BPS, 100);
        assertEq(Policy.PROGRAMMABLE_FEE_BPS, 10);
        assertEq(Policy.GROWTH_FEE_BPS, 90);
        assertEq(Policy.LP_FEE_PIPS, 0);
        assertEq(Policy.COMPOUND_COOLDOWN_SECONDS, 5 minutes);
        assertEq(Policy.TWAP_WINDOW, 30 minutes);
        assertEq(Policy.SHORT_TWAP_WINDOW, 5 minutes);
        assertEq(Policy.ROLLING_EXPOSURE_WINDOW_SECONDS, 30 minutes);
        assertEq(Policy.ROLLING_EXPOSURE_RECORD_CAPACITY, 8);
        assertEq(Policy.MIN_COMPOUND_NATIVE, 0.002 ether);
        assertEq(Policy.MAX_COMPOUND_NATIVE, 0.25 ether);
        assertEq(Policy.TRUSTED_DEPTH_CYCLE_CAP_BPS, 25);
    }

    function test_fixedPolicyMatchesApprovedOracleEnvelope() public pure {
        assertEq(Policy.MIN_OBSERVATION_CARDINALITY_NEXT, 192);
        assertEq(Policy.MAX_ABS_OBSERVATION_TICK_DELTA, 400);
        assertEq(Policy.MAX_RAW_TRUNCATED_TWAP_DELTA_TICKS, 25);
        assertEq(Policy.MAX_SHORT_LONG_TWAP_DEVIATION_TICKS, 50);
        assertEq(Policy.MAX_PRE_SPOT_TWAP_DEVIATION_TICKS, 100);
        assertEq(Policy.MAX_INTERNAL_SWAP_IMPACT_TICKS, 25);
        assertEq(Policy.MAX_POST_SPOT_TWAP_DEVIATION_TICKS, 125);
    }

    function test_fixedPolicyValidatesTickAndWindowRelationships() public pure {
        Policy.validateFixedPolicy();
        assertEq(Policy.FULL_RANGE_TICK_LOWER, TickMath.minUsableTick(Policy.TICK_SPACING));
        assertEq(Policy.FULL_RANGE_TICK_UPPER, TickMath.maxUsableTick(Policy.TICK_SPACING));
        assertEq(
            Policy.MAX_PRE_SPOT_TWAP_DEVIATION_TICKS + Policy.MAX_INTERNAL_SWAP_IMPACT_TICKS,
            Policy.MAX_POST_SPOT_TWAP_DEVIATION_TICKS
        );
        assertGe(
            Policy.ROLLING_EXPOSURE_RECORD_CAPACITY,
            Policy.ROLLING_EXPOSURE_WINDOW_SECONDS / Policy.COMPOUND_COOLDOWN_SECONDS + 2
        );
    }
}
