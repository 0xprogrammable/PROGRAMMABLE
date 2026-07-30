// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Plan, Position } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Test } from "forge-std/Test.sol";

import { StockPairedPositionPlannerV3 } from "../src/StockPairedPositionPlannerV3.sol";

contract StockPairedPositionPlannerV3Test is Test {
    uint256 private constant TOKEN_SUPPLY = 1_000_000_000 ether;
    int24 private constant TICK_SPACING = 200;

    StockPairedPositionPlannerV3 private planner;

    function setUp() public {
        planner = new StockPairedPositionPlannerV3();
    }

    function test_allConfiguredTicksBuildTheSameOneSidedTopologyForBothCurrencyOrders() public view {
        int24[6] memory configuredTicks =
            [int24(181_200), int24(194_600), int24(186_800), int24(168_200), int24(185_600), int24(187_000)];

        for (uint256 index; index < configuredTicks.length; index++) {
            _assertPlan(configuredTicks[index], true);
            _assertPlan(configuredTicks[index], false);
        }
    }

    function test_rejectsZeroNegativeUnalignedAndBoundaryTicks() public {
        int24 maxUsableTick = TickMath.maxUsableTick(TICK_SPACING);
        int24[6] memory invalidTicks =
            [int24(0), int24(-200), int24(181_401), maxUsableTick, TickMath.MAX_TICK, int24(887_200)];

        PoolKey memory key = _poolKey(true);
        for (uint256 index; index < invalidTicks.length; index++) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    StockPairedPositionPlannerV3.InvalidInitialAbsoluteTick.selector, invalidTicks[index]
                )
            );
            planner.buildOneSidedPlan(key, address(0xBEEF), true, invalidTicks[index]);
        }
    }

    function _assertPlan(int24 absoluteTick, bool quoteIsCurrency0) private view {
        PoolKey memory key = _poolKey(quoteIsCurrency0);
        (Plan memory plan, Position memory position, uint256 lockedTokenDust) =
            planner.buildOneSidedPlan(key, address(0xBEEF), quoteIsCurrency0, absoluteTick);

        int24 signedTick = quoteIsCurrency0 ? absoluteTick : -absoluteTick;
        assertEq(position.amount0 + position.amount1 + lockedTokenDust, TOKEN_SUPPLY);
        assertEq(position.amount0 == 0, quoteIsCurrency0);
        assertEq(position.amount1 == 0, !quoteIsCurrency0);
        assertEq(position.tickLower, quoteIsCurrency0 ? TickMath.minUsableTick(TICK_SPACING) : signedTick);
        assertEq(position.tickUpper, quoteIsCurrency0 ? signedTick : TickMath.maxUsableTick(TICK_SPACING));
        assertEq(position.recipient, address(0xBEEF));
        assertGt(plan.actions.length, 0);
        assertGt(plan.params.length, 0);
    }

    function _poolKey(bool quoteIsCurrency0) private pure returns (PoolKey memory key) {
        address quote = quoteIsCurrency0 ? address(0x1000) : address(0x2000);
        address token = quoteIsCurrency0 ? address(0x2000) : address(0x1000);
        key = PoolKey({
            currency0: Currency.wrap(quoteIsCurrency0 ? quote : token),
            currency1: Currency.wrap(quoteIsCurrency0 ? token : quote),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }
}
