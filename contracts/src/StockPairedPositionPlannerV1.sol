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

/// @title StockPairedPositionPlannerV1
/// @notice Stateless adapter around Uniswap's official PositionPlanner for either Stock-Paired currency order.
contract StockPairedPositionPlannerV1 {
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    int24 public constant INITIAL_ABSOLUTE_TICK = 191_200;
    int24 public constant TICK_SPACING = 200;
    uint24 private constant POSITION_WEIGHT = 10_000_000;

    error InvalidPosition(uint256 count, uint256 tokenAmount, uint256 oppositeAmount, int24 tickLower, int24 tickUpper);

    function buildOneSidedPlan(PoolKey calldata key, address positionRecipient, bool quoteIsCurrency0)
        external
        pure
        returns (Plan memory plan, Position memory position, uint256 lockedTokenDust)
    {
        int24 initialTick = quoteIsCurrency0 ? INITIAL_ABSOLUTE_TICK : -INITIAL_ABSOLUTE_TICK;
        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(initialTick);
        return quoteIsCurrency0
            ? _buildToken1Plan(key, positionRecipient, initialSqrtPriceX96, initialTick)
            : _buildToken0Plan(key, positionRecipient, initialSqrtPriceX96, initialTick);
    }

    function _buildToken1Plan(
        PoolKey calldata key,
        address positionRecipient,
        uint160 initialSqrtPriceX96,
        int24 initialTick
    ) private pure returns (Plan memory plan, Position memory position, uint256 lockedTokenDust) {
        int24 minUsableTick = TickMath.minUsableTick(TICK_SPACING);
        PositionDefinition[] memory definitions = new PositionDefinition[](1);
        definitions[0] = PositionDefinition({
            offsetLower: minUsableTick - initialTick,
            offsetUpper: 0,
            weight: POSITION_WEIGHT,
            overridePositionRecipient: positionRecipient
        });

        (Position[] memory positions, CurrencyAmounts memory remaining) = PositionPlanner.resolve(
            definitions,
            initialSqrtPriceX96,
            TICK_SPACING,
            CurrencyAmounts({ amount0: 0, amount1: TOKEN_SUPPLY }),
            positionRecipient
        );
        if (positions.length != 1) revert InvalidPosition(positions.length, 0, 0, 0, 0);

        position = positions[0];
        if (
            position.amount1 == 0 || position.amount0 != 0 || position.tickLower != minUsableTick
                || position.tickUpper != initialTick
        ) {
            revert InvalidPosition(
                positions.length, position.amount1, position.amount0, position.tickLower, position.tickUpper
            );
        }

        lockedTokenDust = remaining.amount1;
        plan = PositionPlanner.toPlan(positions, key, positionRecipient);
    }

    function _buildToken0Plan(
        PoolKey calldata key,
        address positionRecipient,
        uint160 initialSqrtPriceX96,
        int24 initialTick
    ) private pure returns (Plan memory plan, Position memory position, uint256 lockedTokenDust) {
        int24 maxUsableTick = TickMath.maxUsableTick(TICK_SPACING);
        PositionDefinition[] memory definitions = new PositionDefinition[](1);
        definitions[0] = PositionDefinition({
            offsetLower: 0,
            offsetUpper: maxUsableTick - initialTick,
            weight: POSITION_WEIGHT,
            overridePositionRecipient: positionRecipient
        });

        (Position[] memory positions, CurrencyAmounts memory remaining) = PositionPlanner.resolve(
            definitions,
            initialSqrtPriceX96,
            TICK_SPACING,
            CurrencyAmounts({ amount0: TOKEN_SUPPLY, amount1: 0 }),
            positionRecipient
        );
        if (positions.length != 1) revert InvalidPosition(positions.length, 0, 0, 0, 0);

        position = positions[0];
        if (
            position.amount0 == 0 || position.amount1 != 0 || position.tickLower != initialTick
                || position.tickUpper != maxUsableTick
        ) {
            revert InvalidPosition(
                positions.length, position.amount0, position.amount1, position.tickLower, position.tickUpper
            );
        }

        lockedTokenDust = remaining.amount0;
        plan = PositionPlanner.toPlan(positions, key, positionRecipient);
    }
}
