// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Plan, Position } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { Test } from "forge-std/Test.sol";

import { ClassicPositionPlannerV1 } from "../src/ClassicPositionPlannerV1.sol";

contract ClassicPositionPlannerV1Test is Test {
    uint256 private constant Q96 = 1 << 96;
    uint256 private constant MPS = 1_000_000_000;
    uint256 private constant EXPECTED_LIQUIDITY_RATIO_MPS = 1_298_604_130;
    uint256 private constant EIP_170_RUNTIME_LIMIT = 24_576;
    uint256 private constant EIP_3860_INITCODE_LIMIT = 49_152;
    uint256 private constant PLANNER_INTERNAL_LIMIT = 9000;

    ClassicPositionPlannerV1 internal planner;
    PoolKey internal key;
    address internal recipient;

    function setUp() public {
        planner = new ClassicPositionPlannerV1();
        recipient = makeAddr("classicPositionRecipient");
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(makeAddr("classicToken")),
            fee: 0,
            tickSpacing: 200,
            hooks: IHooks(address(0))
        });
    }

    function test_canonicalDesignIsExactlyOneCompleteSupplyPosition() public view {
        (Plan memory plan, Position memory position, uint256 dust) =
            planner.buildOneSidedPlan(key, recipient);

        assertEq(position.tickLower, planner.LIQUIDITY_TICK_LOWER());
        assertEq(position.tickUpper, planner.INITIAL_TICK());
        assertEq(position.amount0, 0);
        assertEq(position.amount1 + dust, planner.TOKEN_SUPPLY());
        assertEq(position.recipient, recipient);
        assertEq(plan.actions.length, 4); // one MINT_POSITION plus settle/settle/take-pair
    }

    function test_canonicalLiquidityIsApproximately1298604PercentOfLegacyClassic() public view {
        (, Position memory canonical,) = planner.buildOneSidedPlan(key, recipient);
        uint256 legacyLiquidity = planner.TOKEN_SUPPLY() * Q96
            / (
                uint256(TickMath.getSqrtPriceAtTick(planner.INITIAL_TICK()))
                    - uint256(TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(planner.TICK_SPACING())))
            );

        uint256 ratioMps = canonical.liquidity * MPS / legacyLiquidity;
        assertApproxEqAbs(ratioMps, EXPECTED_LIQUIDITY_RATIO_MPS, 2);
        assertGt(canonical.liquidity, legacyLiquidity);
    }

    function test_plannerRuntimeAndInitcodeStayBelowReleaseCeilings() public view {
        uint256 runtimeSize = address(planner).code.length;
        uint256 initcodeSize = vm.getCode("src/ClassicPositionPlannerV1.sol:ClassicPositionPlannerV1").length;
        assertLt(runtimeSize, EIP_170_RUNTIME_LIMIT);
        assertLt(initcodeSize, EIP_3860_INITCODE_LIMIT);
        assertLt(runtimeSize, PLANNER_INTERNAL_LIMIT);
        assertLt(initcodeSize, PLANNER_INTERNAL_LIMIT);
    }
}
