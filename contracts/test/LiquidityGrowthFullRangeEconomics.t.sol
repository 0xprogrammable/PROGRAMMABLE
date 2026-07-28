// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FixedPoint96 } from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { StdStorage, stdStorage } from "forge-std/StdStorage.sol";
import { Test } from "forge-std/Test.sol";

import { LiquidityGrowthFullRangeAutomationV1 } from "../src/LiquidityGrowthFullRangeAutomationV1.sol";
import { LiquidityGrowthFullRangeLaunchV1 } from "../src/LiquidityGrowthFullRangeLaunchV1.sol";
import { LiquidityGrowthFullRangePolicyV1 as Policy } from "../src/LiquidityGrowthFullRangePolicyV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "../src/LiquidityGrowthFullRangeVaultV1.sol";
import { LiquidityGrowthFullRangeFixture } from "./utils/LiquidityGrowthFullRangeFixture.sol";

/// @notice Independent executable specification for the fixed Full-Range V1 economic policy.
/// @dev The reference functions deliberately use the official v4 libraries rather than the policy implementation.
contract LiquidityGrowthFullRangeEconomicPolicyHarness {
    function policyTokensRequired(uint160 sqrtPriceX96, uint256 nativeAmount) external pure returns (uint256) {
        return Policy.tokensRequiredForNative(sqrtPriceX96, nativeAmount);
    }

    function policyPairingBudget(uint160 sqrtPriceX96, uint256 nativeAmount) external pure returns (uint256) {
        return Policy.pairingTokenBudget(sqrtPriceX96, nativeAmount);
    }

    function policyRequiredAtStress(uint256 remainingNativeTarget) external pure returns (uint256) {
        return Policy.requiredReserveAtStress(remainingNativeTarget);
    }

    function policyRequiredAtLaunch() external pure returns (uint256) {
        return Policy.requiredReserveAtLaunch();
    }

    function officialTokensRequired(uint160 sqrtPriceX96, uint256 nativeAmount)
        public
        pure
        returns (uint256 tokenAmount, uint128 liquidity, uint256 actualNativeAmount)
    {
        uint160 sqrtLowerX96 = TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_LOWER);
        uint160 sqrtUpperX96 = TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_UPPER);
        liquidity = LiquidityAmounts.getLiquidityForAmount0(sqrtPriceX96, sqrtUpperX96, nativeAmount);
        tokenAmount = SqrtPriceMath.getAmount1Delta(sqrtLowerX96, sqrtPriceX96, liquidity, true);
        actualNativeAmount = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtUpperX96, liquidity, true);
    }

    function anchoredDepth(uint128 trustedLiquidity, uint160 currentSqrtPriceX96)
        external
        pure
        returns (uint256 depth, uint256 cap)
    {
        uint160 initial = Policy.initialSqrtPriceX96();
        uint160 anchor = currentSqrtPriceX96 > initial ? currentSqrtPriceX96 : initial;
        depth = FullMath.mulDiv(uint256(trustedLiquidity), FixedPoint96.Q96, anchor);
        cap = FullMath.mulDiv(depth, Policy.TRUSTED_DEPTH_CAP_BPS, Policy.BASIS_POINTS);
    }

    function initialPositionIsActive(int24 currentTick) external pure returns (bool) {
        return currentTick >= Policy.FULL_RANGE_TICK_LOWER && currentTick < Policy.INITIAL_TICK;
    }

    function completionEligible(uint256 allocatedNative, uint256 nativeAdded, uint256 tokenBudgeted, uint256 tokenAdded)
        external
        pure
        returns (bool)
    {
        uint256 tolerance = Policy.GROWTH_TARGET_NATIVE / Policy.BASIS_POINTS;
        if (tolerance > 0.000_001 ether) tolerance = 0.000_001 ether;
        uint256 minimumNative = Policy.GROWTH_TARGET_NATIVE - tolerance;
        return allocatedNative == Policy.GROWTH_TARGET_NATIVE && nativeAdded >= minimumNative && tokenBudgeted != 0
            && tokenAdded * Policy.BASIS_POINTS >= tokenBudgeted * Policy.MIN_UTILIZATION_BPS;
    }

    function aggregateBudget(
        uint256 pending,
        uint256 depthCap,
        uint256 nativeAdded,
        uint256 totalNativeAllocated,
        uint256 minimumNativeForCompletion
    ) external pure returns (uint256 budget) {
        if (depthCap == 0 || nativeAdded >= Policy.GROWTH_TARGET_NATIVE) return 0;
        budget = Policy.GROWTH_TARGET_NATIVE - nativeAdded;
        if (budget > Policy.MAX_COMPOUND_NATIVE) budget = Policy.MAX_COMPOUND_NATIVE;
        if (budget > depthCap) budget = depthCap;
        if (budget == 0 || pending < budget) return 0;
        if (budget >= Policy.MIN_COMPOUND_NATIVE) return budget;
        if (totalNativeAllocated != Policy.GROWTH_TARGET_NATIVE || nativeAdded + budget < minimumNativeForCompletion) {
            return 0;
        }
    }
}

contract LiquidityGrowthFullRangeEconomicMathTest is Test {
    uint256 private constant FIXED_RESERVE = 150_000_000 ether;
    uint256 private constant FIXED_TARGET = 0.05 ether;
    uint256 private constant FIXED_SUPPLY = 1_000_000_000 ether;

    LiquidityGrowthFullRangeEconomicPolicyHarness private harness;

    function setUp() public {
        harness = new LiquidityGrowthFullRangeEconomicPolicyHarness();
    }

    function test_exactLaunchAndStressReserveNumbersMatchOfficialV4Math() public view {
        uint160 launchSqrtPriceX96 = TickMath.getSqrtPriceAtTick(Policy.INITIAL_TICK);
        uint160 stressSqrtPriceX96 = TickMath.getSqrtPriceAtTick(Policy.STRESS_TICK);

        uint256 requiredAtLaunch = harness.policyTokensRequired(launchSqrtPriceX96, FIXED_TARGET);
        uint256 requiredAtStress = harness.policyRequiredAtStress(FIXED_TARGET);
        (uint256 officialLaunchTokens,,) = harness.officialTokensRequired(launchSqrtPriceX96, FIXED_TARGET);
        (uint256 officialStressTokens,,) = harness.officialTokensRequired(stressSqrtPriceX96, FIXED_TARGET);

        assertEq(launchSqrtPriceX96, 2_151_813_121_295_408_910_812_139_624_586_144);
        assertEq(requiredAtLaunch, 36_882_465_062_467_736_383_588_825);
        assertEq(requiredAtLaunch, officialLaunchTokens);
        assertEq(harness.policyRequiredAtLaunch(), 147_529_860_249_870_945_534_355_300);
        assertEq(requiredAtStress, 146_594_055_738_328_897_705_609_642);
        assertEq(requiredAtStress, officialStressTokens);
        assertGe(FIXED_RESERVE, harness.policyRequiredAtLaunch());
        assertGe(FIXED_RESERVE, requiredAtStress);
    }

    function test_unusedReserveAtLaunchPriceIsExplicitAndNotLiquidity() public view {
        uint256 requiredAtLaunch =
            harness.policyTokensRequired(TickMath.getSqrtPriceAtTick(Policy.INITIAL_TICK), FIXED_TARGET);
        uint256 unusedIfPriceStaysAtLaunch = FIXED_RESERVE - requiredAtLaunch;

        assertEq(unusedIfPriceStaysAtLaunch, 113_117_534_937_532_263_616_411_175);
        assertEq(FullMath.mulDiv(unusedIfPriceStaysAtLaunch, 10_000, FIXED_SUPPLY), 1131);
        assertEq(FullMath.mulDiv(requiredAtLaunch, 10_000, FIXED_RESERVE), 2458);
    }

    function testFuzz_policyPairingMathDifferentialsAgainstOfficialV4(int256 rawTick, uint256 rawNativeAmount)
        public
        view
    {
        int256 boundedTick = bound(rawTick, int256(Policy.FULL_RANGE_TICK_LOWER), int256(Policy.STRESS_TICK));
        uint256 nativeAmount = bound(rawNativeAmount, 1, FIXED_TARGET);
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(SafeCast.toInt24(boundedTick));

        (uint256 officialTokens, uint128 officialLiquidity, uint256 actualNative) =
            harness.officialTokensRequired(sqrtPriceX96, nativeAmount);
        uint256 policyTokens = harness.policyTokensRequired(sqrtPriceX96, nativeAmount);
        uint128 pairedLiquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_LOWER),
            TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_UPPER),
            nativeAmount,
            policyTokens
        );

        assertEq(policyTokens, officialTokens);
        assertEq(pairedLiquidity, officialLiquidity);
        assertLe(actualNative, nativeAmount);
    }

    function testFuzz_tokenRequirementIsMonotonicInTickAndNativeAmount(
        int256 rawTickA,
        int256 rawTickB,
        uint256 rawNativeA,
        uint256 rawNativeB
    ) public view {
        int256 tickA = bound(rawTickA, int256(Policy.FULL_RANGE_TICK_LOWER), int256(Policy.STRESS_TICK));
        int256 tickB = bound(rawTickB, int256(Policy.FULL_RANGE_TICK_LOWER), int256(Policy.STRESS_TICK));
        if (tickA > tickB) (tickA, tickB) = (tickB, tickA);

        uint256 nativeA = bound(rawNativeA, 1, FIXED_TARGET);
        uint256 nativeB = bound(rawNativeB, 1, FIXED_TARGET);
        if (nativeA > nativeB) (nativeA, nativeB) = (nativeB, nativeA);

        uint256 lowerRequirement =
            harness.policyTokensRequired(TickMath.getSqrtPriceAtTick(SafeCast.toInt24(tickA)), nativeA);
        uint256 higherTickRequirement =
            harness.policyTokensRequired(TickMath.getSqrtPriceAtTick(SafeCast.toInt24(tickB)), nativeA);
        uint256 higherAmountRequirement =
            harness.policyTokensRequired(TickMath.getSqrtPriceAtTick(SafeCast.toInt24(tickB)), nativeB);

        assertLe(lowerRequirement, higherTickRequirement);
        assertLe(higherTickRequirement, higherAmountRequirement);
    }

    function testFuzz_reserveRemainsStressSolventAcrossBoundedCompoundSequence(
        uint256[8] calldata rawNativeAmounts,
        int256[8] calldata rawTicks
    ) public view {
        uint256 remainingReserve = FIXED_RESERVE;
        uint256 remainingTarget = FIXED_TARGET;

        for (uint256 index; index < rawNativeAmounts.length && remainingTarget != 0; index++) {
            uint256 nativeChunk = bound(rawNativeAmounts[index], 1, remainingTarget);
            int256 tick = bound(rawTicks[index], int256(Policy.FULL_RANGE_TICK_LOWER), int256(Policy.STRESS_TICK));
            uint256 tokenBudget =
                harness.policyPairingBudget(TickMath.getSqrtPriceAtTick(SafeCast.toInt24(tick)), nativeChunk);

            assertLe(tokenBudget, remainingReserve);
            remainingReserve -= tokenBudget;
            remainingTarget -= nativeChunk;
            assertGe(remainingReserve, harness.policyRequiredAtStress(remainingTarget));
        }
    }

    function test_depthAnchorAndInitialPositionActivityHaveExactBoundaries() public view {
        uint128 trustedLiquidity = 1_000_000 ether;
        uint160 initial = TickMath.getSqrtPriceAtTick(Policy.INITIAL_TICK);
        uint160 lower = TickMath.getSqrtPriceAtTick(Policy.INITIAL_TICK - 10_000);
        uint160 higher = TickMath.getSqrtPriceAtTick(Policy.INITIAL_TICK + 10_000);

        (uint256 initialDepth, uint256 initialCap) = harness.anchoredDepth(trustedLiquidity, initial);
        (uint256 lowerDepth, uint256 lowerCap) = harness.anchoredDepth(trustedLiquidity, lower);
        (uint256 higherDepth, uint256 higherCap) = harness.anchoredDepth(trustedLiquidity, higher);

        assertEq(lowerDepth, initialDepth);
        assertEq(lowerCap, initialCap);
        assertLt(higherDepth, initialDepth);
        assertLt(higherCap, initialCap);
        assertTrue(harness.initialPositionIsActive(Policy.INITIAL_TICK - 1));
        assertFalse(harness.initialPositionIsActive(Policy.INITIAL_TICK));
        assertTrue(harness.initialPositionIsActive(Policy.FULL_RANGE_TICK_LOWER));
        assertFalse(harness.initialPositionIsActive(Policy.FULL_RANGE_TICK_LOWER - 1));
    }

    function test_completionRequiresFullAllocationThresholdAndMinimumUtilization() public view {
        uint256 minimumNative = FIXED_TARGET - 0.000_001 ether;

        assertFalse(harness.completionEligible(FIXED_TARGET - 1, FIXED_TARGET, 1 ether, 1 ether));
        assertFalse(harness.completionEligible(FIXED_TARGET, minimumNative - 1, 1 ether, 1 ether));
        assertFalse(harness.completionEligible(FIXED_TARGET, minimumNative, 0, 0));
        assertFalse(harness.completionEligible(FIXED_TARGET, minimumNative, 1 ether, 0.849_999 ether));
        assertTrue(harness.completionEligible(FIXED_TARGET, minimumNative, 1 ether, 0.85 ether));
    }

    function test_aggregateBudgetWaitsForCompleteChunkAndAllowsOnlyFinalCompletionDust() public view {
        uint256 minimumNative = FIXED_TARGET - 0.000_001 ether;
        uint256 depthCap = 0.002_88 ether;

        assertEq(harness.aggregateBudget(0.002 ether, depthCap, 0, 0.002 ether, minimumNative), 0);
        assertEq(harness.aggregateBudget(depthCap, depthCap, 0, depthCap, minimumNative), depthCap);

        uint256 nativeAdded = minimumNative - 0.0005 ether;
        uint256 finalChunk = FIXED_TARGET - nativeAdded;
        assertLt(finalChunk, Policy.MIN_COMPOUND_NATIVE);
        assertEq(harness.aggregateBudget(finalChunk, depthCap, nativeAdded, FIXED_TARGET - 1, minimumNative), 0);
        assertEq(harness.aggregateBudget(finalChunk, depthCap, nativeAdded, FIXED_TARGET, minimumNative), finalChunk);
    }
}

contract LiquidityGrowthFullRangeEconomicIntegrationTest is LiquidityGrowthFullRangeFixture {
    using stdStorage for StdStorage;
    using StateLibrary for IPoolManager;

    function test_launchBindsEconomicDisclosureAndCountsOnlyTheActiveLockedInitialPosition() public {
        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 vault
        ) = _launchFullRange(keccak256("economic-disclosure"));

        (uint160 currentSqrtPriceX96, int24 currentTick,,) = manager.getSlot0(key.toId());
        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(Policy.INITIAL_TICK);
        uint128 initialLiquidity = positionManager.getPositionLiquidity(result.positionTokenId);
        uint256 expectedDepth = FullMath.mulDiv(initialLiquidity, FixedPoint96.Q96, initialSqrtPriceX96);
        uint256 expectedCap = FullMath.mulDiv(expectedDepth, Policy.TRUSTED_DEPTH_CAP_BPS, Policy.BASIS_POINTS);
        (uint256 trustedDepth, uint256 depthCap) = vault.trustedDepthAndCap();

        assertLt(currentSqrtPriceX96, initialSqrtPriceX96);
        assertLt(currentTick, Policy.INITIAL_TICK);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(vault.growthTargetNative(), Policy.GROWTH_TARGET_NATIVE);
        assertEq(vault.tokenReserveTarget(), Policy.TOKEN_RESERVE_TARGET);
        assertEq(vault.completionToleranceNative(), 0.000_001 ether);
        assertEq(vault.minimumNativeLiquidityForCompletion(), 0.049_999 ether);
        assertEq(IERC20(result.token).balanceOf(address(vault)), Policy.TOKEN_RESERVE_TARGET);
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, 850_000_000 ether);
        assertEq(vault.lockedLiquidity(), 0);
        assertEq(trustedDepth, expectedDepth);
        assertEq(depthCap, expectedCap);
    }

    function test_creatorFeesAboveTargetRemainDeferredUntilActualCompletion() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) = _launchFullRange(keccak256("economic-deferral"));

        _seedFullRangeCreatorFees(key, 3 ether);
        (uint256 received, LiquidityGrowthFullRangeVaultV1.CompoundResult memory result) = vault.process();

        assertGt(received, Policy.GROWTH_TARGET_NATIVE);
        assertEq(result.nativeAdded, 0);
        assertEq(vault.totalCreatorFeesReceived(), received);
        assertEq(vault.totalNativeAllocatedToGrowth(), Policy.GROWTH_TARGET_NATIVE);
        assertEq(vault.pendingGrowthNative(), Policy.GROWTH_TARGET_NATIVE);
        assertEq(vault.deferredRewardFees(), received - Policy.GROWTH_TARGET_NATIVE);
        assertEq(vault.totalRewardFeesReceived(), 0);
        assertEq(vault.claimable(creator), 0);
        assertEq(vault.claimable(beneficiary), 0);
        assertFalse(vault.growthTargetReached());
        assertEq(IERC20(vault.token()).balanceOf(address(vault)), Policy.TOKEN_RESERVE_TARGET);
    }

    function test_aggregateReadySchedulerWaitsForFullDepthChunkAndCooldown() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) = _launchFullRange(keccak256("aggregate-ready"));
        _stageFullRangeOracle(address(vault));

        _buyInSteps(key, 0.05 ether, 10);
        assertEq(
            uint256(fullRangeAutomation.checkVault(address(vault))),
            uint256(LiquidityGrowthFullRangeAutomationV1.Action.None)
        );

        _buyInSteps(key, 0.06 ether, 12);
        assertEq(
            uint256(fullRangeAutomation.checkVault(address(vault))),
            uint256(LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees)
        );
        vault.process();
        (, uint256 firstCap) = vault.trustedDepthAndCap();
        assertGt(vault.pendingGrowthNative(), 0);
        assertLt(vault.pendingGrowthNative(), firstCap);
        assertEq(vault.lastCompoundTimestamp(), 0);
        assertEq(
            uint256(fullRangeAutomation.checkVault(address(vault))),
            uint256(LiquidityGrowthFullRangeAutomationV1.Action.None)
        );

        _buyInSteps(key, 0.05 ether, 10);
        _matureFullRangeOracle(key);
        assertTrue(vault.oracleReady());
        assertEq(
            uint256(fullRangeAutomation.checkVault(address(vault))),
            uint256(LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees)
        );

        (, LiquidityGrowthFullRangeVaultV1.CompoundResult memory compounded) = vault.process();
        assertEq(compounded.nativeBudget, firstCap);
        assertGe(compounded.nativeBudget, Policy.MIN_COMPOUND_NATIVE);
        assertLe(compounded.nativeBudget, Policy.MAX_COMPOUND_NATIVE);
        assertGt(compounded.nativeAdded, 0);

        uint256 lastCompound = vault.lastCompoundTimestamp();
        (, uint256 nextCap) = vault.trustedDepthAndCap();
        stdstore.target(address(vault)).sig("pendingGrowthNative()").checked_write(nextCap);
        vm.deal(address(vault), address(vault).balance + nextCap);

        (LiquidityGrowthFullRangeVaultV1.WorkAction immediateAction,,, uint256 nextTimestamp,,) = vault.workState();
        assertEq(uint256(immediateAction), uint256(LiquidityGrowthFullRangeVaultV1.WorkAction.None));
        assertEq(nextTimestamp, lastCompound + Policy.COMPOUND_COOLDOWN_SECONDS);

        vm.warp(lastCompound + Policy.COMPOUND_COOLDOWN_SECONDS - 1);
        assertEq(
            uint256(fullRangeAutomation.checkVault(address(vault))),
            uint256(LiquidityGrowthFullRangeAutomationV1.Action.None)
        );

        vm.warp(lastCompound + Policy.COMPOUND_COOLDOWN_SECONDS);
        assertEq(
            uint256(fullRangeAutomation.checkVault(address(vault))),
            uint256(LiquidityGrowthFullRangeAutomationV1.Action.CompoundPending)
        );
    }

    function _buyInSteps(PoolKey memory key, uint256 totalNative, uint256 steps) private {
        uint256 perStep = totalNative / steps;
        for (uint256 index; index < steps; index++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            swap(key, true, -SafeCast.toInt256(perStep), "");
        }
    }
}
