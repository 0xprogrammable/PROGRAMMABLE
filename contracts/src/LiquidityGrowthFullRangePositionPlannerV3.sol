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

import { LiquidityGrowthFullRangePolicyV3 as Policy } from "./LiquidityGrowthFullRangePolicyV3.sol";

/// @title LiquidityGrowthFullRangePositionPlannerV3
/// @notice Builds Deep's single complete-supply bootstrap position with the official Uniswap PositionPlanner.
contract LiquidityGrowthFullRangePositionPlannerV3 {
    uint256 public constant POOL_TOKEN_BUDGET = Policy.TOKEN_SUPPLY;
    uint24 private constant POSITION_WEIGHT = 10_000_000;
    address private constant QUOTE_RECIPIENT = address(3);

    error EmptyBootstrapTag();
    error InvalidDustRecipient(address recipient);
    error InvalidPosition(uint256 count, uint256 amount0, int24 tickLower, int24 tickUpper);
    error InvalidPositionRecipient(address recipient);

    function initialTokenDust() external pure returns (uint256 dust) {
        (, dust) = _resolve(QUOTE_RECIPIENT);
    }

    function buildOneSidedPlan(
        PoolKey calldata key,
        address positionRecipient,
        address dustRecipient,
        bytes32 bootstrapTag
    ) external pure returns (Plan memory plan, Position memory position, uint256 lockedTokenDust) {
        if (uint160(positionRecipient) <= 2) revert InvalidPositionRecipient(positionRecipient);
        if (uint160(dustRecipient) <= 2) revert InvalidDustRecipient(dustRecipient);
        if (bootstrapTag == bytes32(0)) revert EmptyBootstrapTag();

        (position, lockedTokenDust) = _resolve(positionRecipient);
        Position[] memory positions = new Position[](1);
        positions[0] = position;
        plan = PositionPlanner.toPlan(positions, key, dustRecipient);
        plan.params[0] = abi.encode(
            key,
            position.tickLower,
            position.tickUpper,
            position.liquidity,
            position.amount0,
            position.amount1,
            position.recipient,
            abi.encode(bootstrapTag)
        );
    }

    function _resolve(address positionRecipient) private pure returns (Position memory position, uint256 dust) {
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
            definitions, Policy.initialSqrtPriceX96(), Policy.TICK_SPACING, available, positionRecipient
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
        dust = remaining.amount1;
    }
}
