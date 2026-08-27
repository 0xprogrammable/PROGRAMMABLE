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
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/// @title ClassicPositionPlannerV1
/// @notice Builds one immutable Classic bonding position from a reviewed preset.
/// @dev The launcher pins this stateless helper's runtime codehash. Standard preserves the legacy complete-supply,
///      full one-sided range. Bonding places exactly 800 million tokens in the finite launch curve and leaves the
///      remaining 200 million tokens outside this plan for the one-shot graduation lifecycle. The reviewed final
///      position remains in the same pool and uses ticks 9800 to 225200.
contract ClassicPositionPlannerV1 {
    uint8 public constant STANDARD_PRESET = 0;
    uint8 public constant BONDING_PRESET = 1;
    /// @notice Compatibility alias for integrations compiled against the pre-graduation preset name.
    uint8 public constant DEEP30_PRESET = BONDING_PRESET;

    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant BONDING_TOKEN_ALLOCATION = 800_000_000 ether;
    uint256 public constant GRADUATION_TOKEN_RESERVE = TOKEN_SUPPLY - BONDING_TOKEN_ALLOCATION;

    int24 public constant INITIAL_TICK = 204_200;
    int24 public constant BONDING_TICK_LOWER = 174_800;
    /// @notice Compatibility alias for integrations compiled against the pre-graduation tick name.
    int24 public constant DEEP30_TICK_LOWER = BONDING_TICK_LOWER;
    int24 public constant FINAL_TICK_LOWER = 9800;
    int24 public constant FINAL_TICK_UPPER = 225_200;
    int24 public constant TICK_SPACING = 200;
    uint24 private constant POSITION_WEIGHT = 10_000_000;

    error InvalidLiquidityPreset(uint8 preset);
    error InvalidPosition(uint256 count, uint256 amount0, int24 tickLower, int24 tickUpper);
    error InvalidTokenAllocation(uint256 actual, uint256 expected);

    /// @notice Returns the canonical lower tick represented by `preset`.
    function tickLowerForPreset(uint8 preset) public pure returns (int24 tickLower) {
        if (preset == STANDARD_PRESET) return TickMath.minUsableTick(TICK_SPACING);
        if (preset == BONDING_PRESET) return BONDING_TICK_LOWER;
        revert InvalidLiquidityPreset(preset);
    }

    /// @notice Returns the token amount assigned to the selected launch curve.
    function curveTokenAllocationForPreset(uint8 preset) public pure returns (uint256 tokenAllocation) {
        if (preset == STANDARD_PRESET) return TOKEN_SUPPLY;
        if (preset == BONDING_PRESET) return BONDING_TOKEN_ALLOCATION;
        revert InvalidLiquidityPreset(preset);
    }

    /// @notice Returns the token amount kept outside the selected curve for graduation.
    function graduationTokenReserveForPreset(uint8 preset) external pure returns (uint256 tokenReserve) {
        return TOKEN_SUPPLY - curveTokenAllocationForPreset(preset);
    }

    /// @notice Resolves the fixed final Bonding position from the canonical curve liquidity.
    function finalPositionForBonding(uint128 bondingLiquidity)
        external
        pure
        returns (uint128 finalLiquidity, uint256 nativeAmount, uint256 tokenAmount)
    {
        uint160 endpointSqrtPriceX96 = TickMath.getSqrtPriceAtTick(BONDING_TICK_LOWER);
        uint160 finalLowerSqrtPriceX96 = TickMath.getSqrtPriceAtTick(FINAL_TICK_LOWER);
        uint160 finalUpperSqrtPriceX96 = TickMath.getSqrtPriceAtTick(FINAL_TICK_UPPER);
        uint256 availableNative = SqrtPriceMath.getAmount0Delta(
            endpointSqrtPriceX96, TickMath.getSqrtPriceAtTick(INITIAL_TICK), bondingLiquidity, false
        );
        finalLiquidity = LiquidityAmounts.getLiquidityForAmounts(
            endpointSqrtPriceX96,
            finalLowerSqrtPriceX96,
            finalUpperSqrtPriceX96,
            availableNative,
            GRADUATION_TOKEN_RESERVE
        );
        nativeAmount = SqrtPriceMath.getAmount0Delta(endpointSqrtPriceX96, finalUpperSqrtPriceX96, finalLiquidity, true);
        tokenAmount = SqrtPriceMath.getAmount1Delta(finalLowerSqrtPriceX96, endpointSqrtPriceX96, finalLiquidity, true);
    }

    /// @notice Resolves one one-sided position and its PositionManager plan.
    /// @dev For Bonding, `unallocatedCurveTokenDust` is only rounding dust from the 800 million curve allocation.
    ///      It excludes `GRADUATION_TOKEN_RESERVE`, which the launcher must transfer directly to graduation custody.
    /// @return plan PositionManager actions for the selected curve allocation.
    /// @return position The single resolved one-sided position.
    /// @return unallocatedCurveTokenDust Rounding dust not consumed by the position from the selected allocation.
    function buildOneSidedPlan(PoolKey calldata key, address positionRecipient, uint8 preset)
        external
        pure
        returns (Plan memory plan, Position memory position, uint256 unallocatedCurveTokenDust)
    {
        int24 expectedTickLower = tickLowerForPreset(preset);
        uint256 expectedTokenAllocation = curveTokenAllocationForPreset(preset);
        PositionDefinition[] memory definitions = new PositionDefinition[](1);
        definitions[0] = PositionDefinition({
            offsetLower: expectedTickLower - INITIAL_TICK,
            offsetUpper: 0,
            weight: POSITION_WEIGHT,
            overridePositionRecipient: positionRecipient
        });

        (Position[] memory positions, CurrencyAmounts memory remaining) = PositionPlanner.resolve(
            definitions,
            TickMath.getSqrtPriceAtTick(INITIAL_TICK),
            TICK_SPACING,
            CurrencyAmounts({ amount0: 0, amount1: expectedTokenAllocation }),
            positionRecipient
        );
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
        unallocatedCurveTokenDust = remaining.amount1;
        if (position.amount1 + unallocatedCurveTokenDust != expectedTokenAllocation) {
            revert InvalidTokenAllocation(position.amount1 + unallocatedCurveTokenDust, expectedTokenAllocation);
        }
        plan = PositionPlanner.toPlan(positions, key, positionRecipient);
    }
}
