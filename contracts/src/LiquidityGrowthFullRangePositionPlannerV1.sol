// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PositionPlanner } from "@uniswap/liquidity-launcher/src/libraries/PositionPlanner.sol";
import {
    CurrencyAmounts,
    Plan,
    Position,
    PositionDefinition
} from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { LiquidityGrowthFullRangePolicyV1 as Policy } from "./LiquidityGrowthFullRangePolicyV1.sol";

/// @title LiquidityGrowthFullRangePositionPlannerV1
/// @notice Stateless adapter around Uniswap's official PositionPlanner for the fixed launch position.
/// @dev The launcher deploys this helper itself. It has no storage, authority or external calls and is reached by
///      STATICCALL because its only entrypoint is pure.
contract LiquidityGrowthFullRangePositionPlannerV1 {
    uint256 public constant POOL_TOKEN_BUDGET = Policy.TOKEN_SUPPLY - Policy.TOKEN_RESERVE_TARGET;
    uint24 private constant POSITION_WEIGHT = 10_000_000;

    error InvalidPosition(uint256 count, uint256 amount0, int24 tickLower, int24 tickUpper);

    function buildOneSidedPlan(PoolKey calldata key, address positionRecipient)
        external
        pure
        returns (Plan memory plan, Position memory position, uint256 lockedTokenDust)
    {
        uint160 initialSqrtPriceX96 = Policy.initialSqrtPriceX96();
        int24 minTick = TickMath.minUsableTick(Policy.TICK_SPACING);
        PositionDefinition[] memory definitions = new PositionDefinition[](1);
        definitions[0] = PositionDefinition({
            offsetLower: minTick - Policy.INITIAL_TICK,
            offsetUpper: 0,
            weight: POSITION_WEIGHT,
            overridePositionRecipient: positionRecipient
        });

        CurrencyAmounts memory available = CurrencyAmounts({ amount0: 0, amount1: POOL_TOKEN_BUDGET });
        (Position[] memory positions, CurrencyAmounts memory remaining) = PositionPlanner.resolve(
            definitions, initialSqrtPriceX96, Policy.TICK_SPACING, available, positionRecipient
        );
        if (
            positions.length != 1 || positions[0].amount0 != 0 || positions[0].tickLower != minTick
                || positions[0].tickUpper != Policy.INITIAL_TICK
                || positions[0].amount1 + remaining.amount1 != POOL_TOKEN_BUDGET
        ) {
            uint256 amount0 = positions.length == 0 ? 0 : positions[0].amount0;
            int24 lower = positions.length == 0 ? int24(0) : positions[0].tickLower;
            int24 upper = positions.length == 0 ? int24(0) : positions[0].tickUpper;
            revert InvalidPosition(positions.length, amount0, lower, upper);
        }

        position = positions[0];
        lockedTokenDust = remaining.amount1;
        plan = PositionPlanner.toPlan(positions, key, positionRecipient);
    }
}
