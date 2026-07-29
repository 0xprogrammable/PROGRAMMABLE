// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { StdStorage, stdStorage } from "forge-std/StdStorage.sol";

import { LiquidityGrowthFullRangePolicyV2 as Policy } from "../src/LiquidityGrowthFullRangePolicyV2.sol";
import { LiquidityGrowthFullRangeVaultV2 } from "../src/LiquidityGrowthFullRangeVaultV2.sol";
import { LiquidityGrowthFullRangeV2Fixture } from "./utils/LiquidityGrowthFullRangeV2Fixture.sol";

/// @notice Sampled same-direction manipulation regression. This is economic evidence, not an independent oracle proof.
contract LiquidityGrowthFullRangeV2AdversarialTest is LiquidityGrowthFullRangeV2Fixture {
    using SafeCast for uint256;
    using stdStorage for StdStorage;

    function test_v2SustainedSameDirectionRoundTripsRemainLossMakingWithinRollingBounds() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) =
            _launchV2Fixture(keccak256("v2-sustained-same-direction"));
        _stageV2Oracle(address(vault));
        _matureV2Oracle(key);

        uint256[3] memory nativeInputs = [uint256(0.02 ether), 0.1 ether, 0.5 ether];
        for (uint256 index; index < nativeInputs.length; index++) {
            uint256 baseline = vm.snapshotState();
            int256 outcome = _reviewSustainedState(key, vault, nativeInputs[index]);
            assertLt(outcome, 0);
            assertTrue(vm.revertToState(baseline));
        }
    }

    function _reviewSustainedState(PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault, uint256 nativeInput)
        private
        returns (int256 outcome)
    {
        IERC20 token = IERC20(vault.token());
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = token.balanceOf(address(this));

        swap(key, true, -nativeInput.toInt256(), "");
        for (uint256 write; write < 32; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            swap(key, true, -int256(0.000_001 ether), "");
        }
        uint256 acquired = token.balanceOf(address(this)) - tokenBefore;
        assertGt(acquired, 0);

        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
        assertTrue(vault.oracleReady());
        _fundCompleteGrowthTarget(vault);

        for (uint256 cycle; cycle < 32 && !vault.growthTargetReached(); cycle++) {
            if (cycle != 0) {
                vm.warp(block.timestamp + vault.ROLLING_EXPOSURE_WINDOW_SECONDS());
                vm.roll(block.number + 150);
            }
            (, uint256 depthCap) = vault.trustedDepthAndCap();
            LiquidityGrowthFullRangeVaultV2.CompoundResult memory result = vault.compoundPending();
            assertGt(result.nativeAdded, 0);
            assertLe(result.nativeAdded, depthCap);
            assertLe(vault.rollingWindowNativeAdded(), depthCap);
            assertLe(result.nativeBudget, Policy.MAX_COMPOUND_NATIVE);
            assertLe(vault.totalNativeAddedToLiquidity(), vault.growthTargetNative());

            uint256 remainingTarget = vault.growthTargetNative() - vault.totalNativeAddedToLiquidity();
            assertGe(token.balanceOf(address(vault)), Policy.requiredReserveAtStress(remainingTarget));
        }

        assertTrue(vault.growthTargetReached());
        assertGe(vault.totalNativeAddedToLiquidity(), vault.minimumNativeLiquidityForCompletion());
        assertEq(vault.FULL_RANGE_TICK_LOWER(), Policy.FULL_RANGE_TICK_LOWER);
        assertEq(vault.FULL_RANGE_TICK_UPPER(), Policy.FULL_RANGE_TICK_UPPER);

        token.approve(address(swapRouter), acquired);
        swap(key, false, -acquired.toInt256(), "");
        outcome = address(this).balance.toInt256() - nativeBefore.toInt256();
    }

    function _fundCompleteGrowthTarget(LiquidityGrowthFullRangeVaultV2 vault) private {
        uint256 target = vault.growthTargetNative();
        vm.deal(address(vault), target);
        stdstore.target(address(vault)).sig("totalCreatorFeesReceived()").checked_write(target);
        stdstore.target(address(vault)).sig("totalNativeAllocatedToGrowth()").checked_write(target);
        stdstore.target(address(vault)).sig("pendingGrowthNative()").checked_write(target);
    }
}
