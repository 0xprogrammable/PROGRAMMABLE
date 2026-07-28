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

/// @title AdaptiveCurvePositionPlannerV1
/// @notice Stateless, bytecode-pinned adapter around Uniswap's official PositionPlanner.
/// @dev The Adaptive launcher verifies this contract's exact runtime codehash in its constructor. The helper has no
/// storage, authority or external calls and is invoked with STATICCALL because this entrypoint is pure.
contract AdaptiveCurvePositionPlannerV1 {
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    int24 public constant INITIAL_TICK = 204_200;
    int24 public constant TICK_SPACING = 200;
    uint24 private constant POSITION_WEIGHT = 10_000_000;

    error InvalidPosition(uint256 count, uint256 amount0, int24 tickLower, int24 tickUpper);

    function buildOneSidedPlan(PoolKey calldata key, address positionRecipient)
        external
        pure
        returns (Plan memory plan, Position memory position, uint256 lockedTokenDust)
    {
        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(INITIAL_TICK);
        int24 minUsableTick = TickMath.minUsableTick(TICK_SPACING);
        PositionDefinition[] memory definitions = new PositionDefinition[](1);
        definitions[0] = PositionDefinition({
            offsetLower: minUsableTick - INITIAL_TICK,
            offsetUpper: 0,
            weight: POSITION_WEIGHT,
            overridePositionRecipient: positionRecipient
        });

        CurrencyAmounts memory available = CurrencyAmounts({ amount0: 0, amount1: TOKEN_SUPPLY });
        (Position[] memory positions, CurrencyAmounts memory remaining) =
            PositionPlanner.resolve(definitions, initialSqrtPriceX96, TICK_SPACING, available, positionRecipient);
        if (
            positions.length != 1 || positions[0].amount0 != 0 || positions[0].tickLower != minUsableTick
                || positions[0].tickUpper != INITIAL_TICK
        ) {
            uint256 amount0 = positions.length == 0 ? 0 : positions[0].amount0;
            int24 tickLower = positions.length == 0 ? int24(0) : positions[0].tickLower;
            int24 tickUpper = positions.length == 0 ? int24(0) : positions[0].tickUpper;
            revert InvalidPosition(positions.length, amount0, tickLower, tickUpper);
        }

        position = positions[0];
        lockedTokenDust = remaining.amount1;
        plan = PositionPlanner.toPlan(positions, key, positionRecipient);
    }
}
