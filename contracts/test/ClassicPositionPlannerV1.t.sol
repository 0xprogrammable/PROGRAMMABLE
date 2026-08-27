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
    uint256 private constant EIP_170_RUNTIME_LIMIT = 24_576;
    uint256 private constant EIP_3860_INITCODE_LIMIT = 49_152;
    uint256 private constant PLANNER_INTERNAL_LIMIT = 10_000;

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

    function test_standardPresetExactlyPreservesLegacyOnePositionRange() public view {
        (Plan memory plan, Position memory position, uint256 dust) =
            planner.buildOneSidedPlan(key, recipient, planner.STANDARD_PRESET());

        assertEq(position.tickLower, TickMath.minUsableTick(planner.TICK_SPACING()));
        assertEq(position.tickUpper, planner.INITIAL_TICK());
        assertEq(position.amount0, 0);
        assertEq(position.amount1 + dust, planner.TOKEN_SUPPLY());
        assertEq(position.recipient, recipient);
        assertEq(plan.actions.length, 4); // one MINT_POSITION plus settle/settle/take-pair
    }

    function test_bondingPresetUsesExactCurveAllocationAndGraduationReserve() public view {
        (Plan memory plan, Position memory bonding, uint256 curveDust) =
            planner.buildOneSidedPlan(key, recipient, planner.BONDING_PRESET());

        assertEq(planner.curveTokenAllocationForPreset(planner.BONDING_PRESET()), 800_000_000 ether);
        assertEq(planner.graduationTokenReserveForPreset(planner.BONDING_PRESET()), 200_000_000 ether);
        assertEq(bonding.amount0, 0);
        assertEq(bonding.amount1 + curveDust, planner.BONDING_TOKEN_ALLOCATION());
        assertEq(bonding.amount1 + curveDust + planner.GRADUATION_TOKEN_RESERVE(), planner.TOKEN_SUPPLY());
        assertEq(bonding.recipient, recipient);
        assertEq(plan.actions.length, 4);
    }

    function test_bondingAndFinalRangesAreFixedAndTickAligned() public view {
        (, Position memory bonding,) = planner.buildOneSidedPlan(key, recipient, planner.BONDING_PRESET());

        assertEq(bonding.tickLower, planner.BONDING_TICK_LOWER());
        assertEq(bonding.tickUpper, planner.INITIAL_TICK());
        assertEq(planner.FINAL_TICK_LOWER(), 9800);
        assertEq(planner.FINAL_TICK_UPPER(), 225_200);
        assertLt(planner.FINAL_TICK_LOWER(), planner.BONDING_TICK_LOWER());
        assertGt(planner.FINAL_TICK_UPPER(), planner.BONDING_TICK_LOWER());
        assertEq(planner.BONDING_TICK_LOWER() % planner.TICK_SPACING(), 0);
        assertEq(planner.FINAL_TICK_LOWER() % planner.TICK_SPACING(), 0);
        assertEq(planner.FINAL_TICK_UPPER() % planner.TICK_SPACING(), 0);
    }

    function test_deep30AliasesRemainCompileCompatible() public view {
        assertEq(planner.DEEP30_PRESET(), planner.BONDING_PRESET());
        assertEq(planner.DEEP30_TICK_LOWER(), planner.BONDING_TICK_LOWER());
    }

    function test_allocationViewsPreserveStandardAndBondingSupplyAccounting() public view {
        assertEq(planner.curveTokenAllocationForPreset(planner.STANDARD_PRESET()), planner.TOKEN_SUPPLY());
        assertEq(planner.graduationTokenReserveForPreset(planner.STANDARD_PRESET()), 0);
        assertEq(
            planner.curveTokenAllocationForPreset(planner.BONDING_PRESET())
                + planner.graduationTokenReserveForPreset(planner.BONDING_PRESET()),
            planner.TOKEN_SUPPLY()
        );
    }

    function test_finalBondingPositionConsumesRaisedNativeAndAlmostAllReserve() public view {
        (, Position memory bonding,) = planner.buildOneSidedPlan(key, recipient, planner.BONDING_PRESET());
        (uint128 finalLiquidity, uint256 nativeAmount, uint256 tokenAmount) =
            planner.finalPositionForBonding(uint128(bonding.liquidity));

        assertGt(finalLiquidity, 0);
        assertEq(nativeAmount, 4_716_512_844_756_726_511);
        assertEq(tokenAmount, 199_999_757_406_838_248_114_639_031);
        assertEq(planner.GRADUATION_TOKEN_RESERVE() - tokenAmount, 242_593_161_751_885_360_969);
    }

    function test_invalidPresetFailsClosed() public {
        vm.expectRevert(abi.encodeWithSelector(ClassicPositionPlannerV1.InvalidLiquidityPreset.selector, uint8(2)));
        planner.buildOneSidedPlan(key, recipient, 2);
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
