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

/// @title ClassicPositionPlannerV1
/// @notice Builds one immutable, complete-supply Classic liquidity position from a reviewed preset.
/// @dev The launcher pins this stateless helper's runtime codehash. Both presets create exactly one position/NFT;
///      Standard preserves the legacy full one-sided range and Deep30 concentrates it for about 29.86% more active
///      launch liquidity without changing the opening tick or token supply. Deep30 ends at tick 174800, about
///      18.913x the opening token price and 5.89564 ETH of net buy capacity for the complete supply. A launch buy
///      that would cross that endpoint reverts atomically; the fee hook does not permit a partial fill.
contract ClassicPositionPlannerV1 {
    uint8 public constant STANDARD_PRESET = 0;
    uint8 public constant DEEP30_PRESET = 1;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    int24 public constant INITIAL_TICK = 204_200;
    int24 public constant DEEP30_TICK_LOWER = 174_800;
    int24 public constant TICK_SPACING = 200;
    uint24 private constant POSITION_WEIGHT = 10_000_000;

    error InvalidLiquidityPreset(uint8 preset);
    error InvalidPosition(uint256 count, uint256 amount0, int24 tickLower, int24 tickUpper);

    /// @notice Returns the canonical lower tick represented by `preset`.
    function tickLowerForPreset(uint8 preset) public pure returns (int24 tickLower) {
        if (preset == STANDARD_PRESET) return TickMath.minUsableTick(TICK_SPACING);
        if (preset == DEEP30_PRESET) return DEEP30_TICK_LOWER;
        revert InvalidLiquidityPreset(preset);
    }

    /// @notice Resolves one complete-supply one-sided position and its PositionManager plan.
    function buildOneSidedPlan(PoolKey calldata key, address positionRecipient, uint8 preset)
        external
        pure
        returns (Plan memory plan, Position memory position, uint256 lockedTokenDust)
    {
        int24 expectedTickLower = tickLowerForPreset(preset);
        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(INITIAL_TICK);
        PositionDefinition[] memory definitions = new PositionDefinition[](1);
        definitions[0] = PositionDefinition({
            offsetLower: expectedTickLower - INITIAL_TICK,
            offsetUpper: 0,
            weight: POSITION_WEIGHT,
            overridePositionRecipient: positionRecipient
        });

        CurrencyAmounts memory available = CurrencyAmounts({ amount0: 0, amount1: TOKEN_SUPPLY });
        (Position[] memory positions, CurrencyAmounts memory remaining) =
            PositionPlanner.resolve(definitions, initialSqrtPriceX96, TICK_SPACING, available, positionRecipient);
        if (
            positions.length != 1 || positions[0].amount0 != 0 || positions[0].tickLower != expectedTickLower
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
