// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Test } from "forge-std/Test.sol";

import { LiquidityGrowthFullRangeAutomationV1 } from "../../src/LiquidityGrowthFullRangeAutomationV1.sol";
import { LiquidityGrowthFullRangeLaunchV1 } from "../../src/LiquidityGrowthFullRangeLaunchV1.sol";
import { LiquidityGrowthFullRangePolicyV1 as Policy } from "../../src/LiquidityGrowthFullRangePolicyV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "../../src/LiquidityGrowthFullRangeVaultV1.sol";
import { LiquidityGrowthFullRangeFixture } from "../utils/LiquidityGrowthFullRangeFixture.sol";

contract LiquidityGrowthFullRangeHandler is Test {
    LiquidityGrowthFullRangeVaultV1 public immutable vault;
    LiquidityGrowthFullRangeAutomationV1 public immutable automation;
    PoolSwapTest public immutable swapRouter;
    PoolKey private _key;
    address public immutable creator;
    address public immutable beneficiary;

    PoolSwapTest.TestSettings private _settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    constructor(
        LiquidityGrowthFullRangeVaultV1 vault_,
        LiquidityGrowthFullRangeAutomationV1 automation_,
        PoolSwapTest swapRouter_,
        PoolKey memory key_,
        address creator_,
        address beneficiary_
    ) {
        vault = vault_;
        automation = automation_;
        swapRouter = swapRouter_;
        _key = key_;
        creator = creator_;
        beneficiary = beneficiary_;
    }

    receive() external payable { }

    function seedBuy(uint96 rawAmount) external {
        uint256 amount = 0.000_001 ether + uint256(rawAmount) % (0.02 ether - 0.000_001 ether);
        if (address(this).balance < amount) return;
        try swapRouter.swap{ value: amount }(
            _key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            _settings,
            ""
        ) { }
            catch { }
    }

    function stageOracle() external {
        try automation.stageOracle(address(vault)) { } catch { }
    }

    function perform() external {
        try automation.performVault(address(vault)) { } catch { }
    }

    function process() external {
        try vault.process() { } catch { }
    }

    function compound() external {
        try vault.compoundPending() { } catch { }
    }

    function advance(uint32 rawSeconds) external {
        uint256 elapsed = 1 + uint256(rawSeconds) % 30 minutes;
        vm.warp(block.timestamp + elapsed);
        vm.roll(block.number + 1);
    }

    function claimCreator() external {
        vm.prank(creator);
        try vault.claimRewards() { } catch { }
    }

    function claimBeneficiary() external {
        vm.prank(beneficiary);
        try vault.claimRewards() { } catch { }
    }

    function redirectCreatorToHandler() external {
        vm.prank(creator);
        try vault.setPayoutAddress(address(this)) { } catch { }
    }
}

contract LiquidityGrowthFullRangeInvariantTest is LiquidityGrowthFullRangeFixture {
    LiquidityGrowthFullRangeLaunchV1.LaunchResult internal launchResult;
    LiquidityGrowthFullRangeVaultV1 internal vault;
    LiquidityGrowthFullRangeHandler internal handler;

    function setUp() public override {
        super.setUp();
        PoolKey memory key;
        (launchResult, key, vault) = _launchFullRange(keccak256("full-range-invariant"));
        handler = new LiquidityGrowthFullRangeHandler(vault, fullRangeAutomation, swapRouter, key, creator, beneficiary);
        vm.deal(address(handler), 100 ether);
        targetContract(address(handler));
    }

    function invariant_fixedReserveCannotLeaveTheVaultAccountingEnvelope() public view {
        uint256 remaining = IERC20(vault.token()).balanceOf(address(vault));
        assertEq(
            remaining + vault.totalTokenAddedToLiquidity(), vault.tokenReserveTarget() + vault.totalTokenRecycled()
        );
    }

    function invariant_currentReserveAlwaysCoversTheCompleteStressEnvelope() public view {
        uint256 nativeAdded = vault.totalNativeAddedToLiquidity();
        uint256 target = vault.growthTargetNative();
        uint256 remainingTarget = nativeAdded < target ? target - nativeAdded : 0;
        uint256 currentReserve = IERC20(vault.token()).balanceOf(address(vault));
        assertGe(currentReserve, Policy.requiredReserveAtStress(remainingTarget));
    }

    function invariant_growthNativeAccountingIsConserved() public view {
        uint256 allocated = vault.totalNativeAllocatedToGrowth();
        uint256 added = vault.totalNativeAddedToLiquidity();
        assertLe(allocated, vault.growthTargetNative());
        assertLe(added, vault.growthTargetNative());
        if (!vault.growthTargetReached()) {
            assertEq(added + vault.pendingGrowthNative(), allocated + vault.totalNativeRecycled());
        } else {
            assertEq(allocated, vault.growthTargetNative());
            assertEq(added + vault.nativeLiquidityShortfallAtCompletion(), vault.growthTargetNative());
            assertEq(vault.pendingGrowthNative(), 0);
            assertGe(added, vault.minimumNativeLiquidityForCompletion());
        }
    }

    function invariant_everyProcessedNativeWeiHasExactlyOneAccountingDestination() public view {
        assertEq(
            vault.totalCreatorFeesReceived() + vault.totalNativeRecycled(),
            vault.totalNativeAddedToLiquidity() + vault.pendingGrowthNative() + vault.deferredRewardFees()
                + vault.totalRewardFeesReceived()
        );
    }

    function invariant_vaultBalanceCoversPendingDeferredAndUnclaimedRewards() public view {
        uint256 unclaimedRewards = vault.totalRewardFeesReceived() - vault.totalRewardFeesClaimed();
        uint256 accountedBalance = vault.pendingGrowthNative() + vault.deferredRewardFees() + unclaimedRewards;
        assertGe(address(vault).balance, accountedBalance);
    }

    function invariant_onlyOneAddOnlyFullRangePositionExistsForGrowth() public view {
        assertEq(vault.lockedLiquidity(), vault.totalLiquidityAdded());
        assertEq(vault.FULL_RANGE_TICK_LOWER(), -887_200);
        assertEq(vault.FULL_RANGE_TICK_UPPER(), 887_200);
        assertEq(vault.FULL_RANGE_TICK_LOWER(), TickMath.minUsableTick(200));
        assertEq(vault.FULL_RANGE_TICK_UPPER(), TickMath.maxUsableTick(200));
    }

    function invariant_initialPositionCustodyNeverChanges() public view {
        assertEq(
            IERC721(address(positionManager)).ownerOf(launchResult.positionTokenId), launchResult.positionRecipient
        );
    }

    function invariant_rewardClaimsNeverExceedRecognizedRewards() public view {
        uint256 claimed = vault.claimedBy(creator) + vault.claimedBy(beneficiary);
        assertEq(claimed, vault.totalRewardFeesClaimed());
        assertLe(claimed, vault.totalRewardFeesReceived());
    }

    function invariant_depthCapAlwaysUsesTheFixedTwentyFiveBasisPointLimit() public view {
        (uint256 trustedDepth, uint256 cap) = vault.trustedDepthAndCap();
        assertEq(cap, trustedDepth * vault.TRUSTED_DEPTH_CAP_BPS() / vault.BASIS_POINTS());
    }
}
