// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { StdStorage, stdStorage } from "forge-std/StdStorage.sol";

import { LiquidityGrowthFullRangePolicyV1 as Policy } from "../src/LiquidityGrowthFullRangePolicyV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "../src/LiquidityGrowthFullRangeVaultV1.sol";
import { LiquidityGrowthFullRangeFixture } from "./utils/LiquidityGrowthFullRangeFixture.sol";

/// @notice Defensive economic regression for the fixed full-range placement policy.
/// @dev The fixture injects the complete fixed growth target to isolate the maximum placement exposure. The sampled
///      round trips are regression evidence for the disclosed bounds, not a proof that same-pool price history is
///      independently correct.
contract LiquidityGrowthFullRangeEconomicReviewTest is LiquidityGrowthFullRangeFixture {
    using SafeCast for uint256;
    using stdStorage for StdStorage;

    function test_reviewedOppositeDirectionSustainedPoolStatesRemainLossMakingAtTheFixedBounds() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) =
            _launchFullRange(keccak256("full-range-economic-review-opposite"));
        _stageFullRangeOracle(address(vault));
        _matureFullRangeOracle(key);

        uint256[5] memory tokenInputs =
            [uint256(25_000 ether), 75_000 ether, 150_000 ether, 225_000 ether, 300_000 ether];
        for (uint256 index; index < tokenInputs.length; index++) {
            uint256 baseline = vm.snapshotState();
            int256 outcome = _reviewOneOppositeDirectionSustainedState(key, vault, tokenInputs[index]);
            assertLt(outcome, 0);
            assertTrue(vm.revertToState(baseline));
        }
    }

    function test_reviewedSustainedPoolStatesRemainLossMakingAtTheFixedBounds() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) =
            _launchFullRange(keccak256("full-range-economic-review"));
        _stageFullRangeOracle(address(vault));
        _matureFullRangeOracle(key);

        uint256[5] memory nativeInputs = [uint256(0.02 ether), 0.05 ether, 0.1 ether, 0.2 ether, 0.5 ether];
        for (uint256 index; index < nativeInputs.length; index++) {
            uint256 baseline = vm.snapshotState();
            int256 outcome = _reviewOneSustainedState(key, vault, nativeInputs[index]);
            assertLt(outcome, 0);
            assertTrue(vm.revertToState(baseline));
        }
    }

    function _reviewOneSustainedState(PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault, uint256 nativeInput)
        private
        returns (int256 outcome)
    {
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = IERC20(vault.token()).balanceOf(address(this));

        swap(key, true, -nativeInput.toInt256(), "");
        for (uint256 write; write < 32; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            swap(key, true, -int256(0.000_001 ether), "");
        }
        uint256 acquired = IERC20(vault.token()).balanceOf(address(this)) - tokenBefore;

        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
        assertTrue(vault.oracleReady());

        _fundCompleteGrowthTarget(vault);
        for (uint256 cycle; cycle < 64 && !vault.growthTargetReached(); cycle++) {
            if (cycle != 0) {
                vm.warp(block.timestamp + vault.COMPOUND_COOLDOWN_SECONDS());
                vm.roll(block.number + 150);
            }
            vault.compoundPending();
        }
        assertTrue(vault.growthTargetReached());
        assertGe(vault.totalNativeAddedToLiquidity(), vault.minimumNativeLiquidityForCompletion());
        assertEq(vault.FULL_RANGE_TICK_LOWER(), Policy.FULL_RANGE_TICK_LOWER);
        assertEq(vault.FULL_RANGE_TICK_UPPER(), Policy.FULL_RANGE_TICK_UPPER);

        IERC20(vault.token()).approve(address(swapRouter), acquired);
        swap(key, false, -acquired.toInt256(), "");
        outcome = address(this).balance.toInt256() - nativeBefore.toInt256();
    }

    function _reviewOneOppositeDirectionSustainedState(
        PoolKey memory key,
        LiquidityGrowthFullRangeVaultV1 vault,
        uint256 tokenInput
    ) private returns (int256 outcome) {
        IERC20 token = IERC20(vault.token());
        uint256 sustainedWritesTokenInput = 100 ether * 32;
        uint256 totalTokenInventory = tokenInput + sustainedWritesTokenInput;

        vm.prank(creator);
        assertTrue(token.transfer(address(this), totalTokenInventory));

        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = token.balanceOf(address(this));
        token.approve(address(swapRouter), totalTokenInventory);

        swap(key, false, -tokenInput.toInt256(), "");
        for (uint256 write; write < 32; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            swap(key, false, -int256(100 ether), "");
        }
        assertEq(tokenBefore - token.balanceOf(address(this)), totalTokenInventory);
        uint256 nativeProceeds = address(this).balance - nativeBefore;
        assertGt(nativeProceeds, 0);

        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
        assertTrue(vault.oracleReady());

        _fundCompleteGrowthTarget(vault);
        for (uint256 cycle; cycle < 64 && !vault.growthTargetReached(); cycle++) {
            if (cycle != 0) {
                vm.warp(block.timestamp + vault.COMPOUND_COOLDOWN_SECONDS());
                vm.roll(block.number + 150);
            }
            (, uint256 depthCap) = vault.trustedDepthAndCap();
            LiquidityGrowthFullRangeVaultV1.CompoundResult memory result = vault.compoundPending();
            assertLe(result.nativeBudget, depthCap);
            assertLe(result.nativeBudget, Policy.MAX_COMPOUND_NATIVE);
            assertLe(vault.totalNativeAddedToLiquidity(), vault.growthTargetNative());

            uint256 remainingTarget = vault.growthTargetNative() - vault.totalNativeAddedToLiquidity();
            assertGe(token.balanceOf(address(vault)), Policy.requiredReserveAtStress(remainingTarget));
        }
        assertTrue(vault.growthTargetReached());
        assertGe(vault.totalNativeAddedToLiquidity(), vault.minimumNativeLiquidityForCompletion());
        assertEq(vault.FULL_RANGE_TICK_LOWER(), Policy.FULL_RANGE_TICK_LOWER);
        assertEq(vault.FULL_RANGE_TICK_UPPER(), Policy.FULL_RANGE_TICK_UPPER);

        swap(key, true, -nativeProceeds.toInt256(), "");
        assertEq(address(this).balance, nativeBefore);
        outcome = token.balanceOf(address(this)).toInt256() - tokenBefore.toInt256();
    }

    function _fundCompleteGrowthTarget(LiquidityGrowthFullRangeVaultV1 vault) private {
        uint256 target = vault.growthTargetNative();
        vm.deal(address(vault), target);
        stdstore.target(address(vault)).sig("totalCreatorFeesReceived()").checked_write(target);
        stdstore.target(address(vault)).sig("totalNativeAllocatedToGrowth()").checked_write(target);
        stdstore.target(address(vault)).sig("pendingGrowthNative()").checked_write(target);
    }
}
