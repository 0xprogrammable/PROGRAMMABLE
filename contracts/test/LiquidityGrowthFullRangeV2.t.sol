// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { StdStorage, stdStorage } from "forge-std/StdStorage.sol";

import { LiquidityGrowthFullRangeAutomationV2 } from "../src/LiquidityGrowthFullRangeAutomationV2.sol";
import { LiquidityGrowthFullRangeLaunchV2 } from "../src/LiquidityGrowthFullRangeLaunchV2.sol";
import { LiquidityGrowthFullRangePolicyV2 as PolicyV2 } from "../src/LiquidityGrowthFullRangePolicyV2.sol";
import { LiquidityGrowthFullRangePositionPlannerV2 } from "../src/LiquidityGrowthFullRangePositionPlannerV2.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { LiquidityGrowthFullRangeVaultFactoryV2 } from "../src/LiquidityGrowthFullRangeVaultFactoryV2.sol";
import { LiquidityGrowthFullRangeVaultV2 } from "../src/LiquidityGrowthFullRangeVaultV2.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "../src/interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";
import { LiquidityGrowthFullRangeFixture } from "./utils/LiquidityGrowthFullRangeFixture.sol";

/// @notice RED specification for the first public Deep V2 fee-to-liquidity lifecycle.
/// @dev Deep V1 remains unchanged. V2 keeps one protocol-fixed target and exposes no target, timing or split input.
contract LiquidityGrowthFullRangeV2Test is LiquidityGrowthFullRangeFixture {
    using SafeCast for uint256;
    using stdStorage for StdStorage;

    uint256 private constant EXPECTED_GROWTH_TARGET = 0.05 ether;
    uint256 private constant EXPECTED_TOKEN_RESERVE = 150_000_000 ether;
    uint64 private constant EXPECTED_COMPOUND_COOLDOWN = 5 minutes;
    uint16 private constant EXPECTED_TOTAL_SWAP_FEE_BPS = 100;
    uint16 private constant EXPECTED_CREATOR_FEE_BPS = 90;
    uint16 private constant EXPECTED_PROGRAMMABLE_FEE_BPS = 10;
    uint256 private constant CROSSING_REMAINDER = 0.0001 ether;
    uint256 private constant FINAL_COMPOUND_REMAINDER = 0.000_001 ether;

    LiquidityGrowthFullRangeVaultFactoryV2 private v2VaultFactory;
    LiquidityGrowthFullRangeLaunchV2 private v2Launcher;
    LiquidityGrowthFullRangeAutomationV2 private v2Automation;

    function setUp() public override {
        super.setUp();
        v2VaultFactory = new LiquidityGrowthFullRangeVaultFactoryV2(
            hookFactory, splitFactory, positionManager, positionForwarderFactory, rangeSourceFactory
        );
        v2Launcher = new LiquidityGrowthFullRangeLaunchV2(
            manager,
            positionManager,
            tokenFactory,
            ILiquidityGrowthFullRangeOracleHookV1(address(hook)),
            splitFactory,
            rangeSourceFactory,
            v2VaultFactory,
            positionForwarderFactory
        );
        v2Automation = v2Launcher.automation();
    }

    function test_v2LauncherUsesThePlannerBoundToTheV2Policy() public {
        LiquidityGrowthFullRangePositionPlannerV2 planner = v2Launcher.positionPlanner();
        assertEq(planner.POOL_TOKEN_BUDGET(), 850_000_000 ether);

        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,,) =
            _launchV2(keccak256("v2-policy-bound-planner"));
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, planner.POOL_TOKEN_BUDGET());
    }

    function test_v2VaultFactoryRejectsAuthenticatedForwarderForAnotherCreator() public {
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result, PoolKey memory key,) =
            _launchV2(keccak256("v2-forwarder-creator-binding"));
        address wrongCreator = makeAddr("wrong-deep-v2-creator");
        assertEq(PositionFeesForwarder(payable(result.positionRecipient)).feeRecipient(), creator);

        LiquidityGrowthFullRangeVaultV2.Configuration memory configuration =
            LiquidityGrowthFullRangeVaultV2.Configuration({
                poolKey: key,
                oracleGuard: LiquidityGrowthRangeSourceV1(result.oracleGuard),
                positionManager: positionManager,
                positionForwarderFactory: positionForwarderFactory,
                initialPositionTokenId: result.positionTokenId,
                initialPositionRecipient: result.positionRecipient,
                creator: wrongCreator
            });

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeVaultFactoryV2.InvalidInitialPositionRecipient.selector,
                result.positionRecipient
            )
        );
        v2VaultFactory.deployOrGet(
            keccak256("v2-authenticated-forwarder-wrong-recipient"),
            ILiquidityGrowthFullRangeOracleHookV1(address(hook)),
            configuration
        );
    }

    function test_v2UsesOneFixedTargetAndEnforcesTheFiveMinuteCompoundCooldown() public {
        (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 vault
        ) = _launchV2(keccak256("v2-five-minute-cooldown"));

        assertEq(v2Launcher.GROWTH_TARGET_NATIVE(), EXPECTED_GROWTH_TARGET);
        assertEq(v2Launcher.TOKEN_RESERVE_TARGET(), EXPECTED_TOKEN_RESERVE);
        assertEq(v2Launcher.TOTAL_SWAP_FEE_BPS(), EXPECTED_TOTAL_SWAP_FEE_BPS);
        assertEq(v2Launcher.CREATOR_FEE_BPS(), EXPECTED_CREATOR_FEE_BPS);
        assertEq(v2Launcher.PROGRAMMABLE_FEE_BPS(), EXPECTED_PROGRAMMABLE_FEE_BPS);
        assertEq(vault.growthTargetNative(), EXPECTED_GROWTH_TARGET);
        assertEq(vault.tokenReserveTarget(), EXPECTED_TOKEN_RESERVE);
        assertEq(vault.COMPOUND_COOLDOWN_SECONDS(), EXPECTED_COMPOUND_COOLDOWN);
        assertEq(PolicyV2.COMPOUND_COOLDOWN_SECONDS, EXPECTED_COMPOUND_COOLDOWN);
        (address rewardVault,, uint16 buyFeeBps, uint16 sellFeeBps, bool registered,) =
            hook.poolFeeConfig(result.poolId);
        assertEq(rewardVault, result.upstreamRewardVault);
        assertEq(buyFeeBps, EXPECTED_TOTAL_SWAP_FEE_BPS);
        assertEq(sellFeeBps, EXPECTED_TOTAL_SWAP_FEE_BPS);
        assertTrue(registered);

        _seedV2CreatorFees(key, 1 ether);
        (uint256 received,) = vault.process();
        assertGt(received, 0);
        _stageV2Oracle(vault);
        _matureV2Oracle(key);

        uint256 firstTimestamp = block.timestamp - EXPECTED_COMPOUND_COOLDOWN + 1;
        stdstore.target(address(vault)).sig("lastCompoundTimestamp()").checked_write(firstTimestamp);
        uint256 nextTimestamp = firstTimestamp + EXPECTED_COMPOUND_COOLDOWN;
        uint256 pendingBeforeSkippedAttempt = vault.pendingGrowthNative();
        assertGt(vault.pendingGrowthNative(), 0);

        vm.warp(nextTimestamp - 1);
        (LiquidityGrowthFullRangeVaultV2.WorkAction beforeDeadline,,, uint256 reportedNext,,) = vault.workState();
        assertEq(uint8(beforeDeadline), uint8(LiquidityGrowthFullRangeVaultV2.WorkAction.None));
        assertEq(reportedNext, nextTimestamp);
        (bool skipped, LiquidityGrowthFullRangeAutomationV2.Action skippedAction) =
            v2Automation.performVault(address(vault));
        assertFalse(skipped);
        assertEq(uint8(skippedAction), uint8(LiquidityGrowthFullRangeAutomationV2.Action.None));
        assertEq(vault.lastCompoundTimestamp(), firstTimestamp);
        assertEq(vault.pendingGrowthNative(), pendingBeforeSkippedAttempt);

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeVaultV2.CompoundCooldown.selector, block.timestamp, nextTimestamp
            )
        );
        vault.compoundPending();
        assertEq(vault.lastCompoundTimestamp(), firstTimestamp);
        assertEq(vault.pendingGrowthNative(), pendingBeforeSkippedAttempt);

        vm.warp(nextTimestamp);
        (LiquidityGrowthFullRangeVaultV2.WorkAction atDeadline,,,,,) = vault.workState();
        assertEq(uint8(atDeadline), uint8(LiquidityGrowthFullRangeVaultV2.WorkAction.Compound));
        LiquidityGrowthFullRangeVaultV2.CompoundResult memory compounded = vault.compoundPending();
        assertGt(compounded.nativeAdded, 0);
        assertEq(vault.lastCompoundTimestamp(), nextTimestamp);
    }

    function test_v2RoutesTheEntireCreatorShareIntoTheLockedGrowthPositionBeforeTarget() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) = _launchV2(keccak256("v2-all-fees-to-growth"));

        assertEq(vault.beneficiaryCount(), 1);
        assertEq(vault.beneficiaryAt(0), creator);
        assertEq(vault.shareBpsOf(creator), 10_000);

        _seedV2CreatorFees(key, 1 ether);
        (uint256 received, LiquidityGrowthFullRangeVaultV2.CompoundResult memory waiting) = vault.process();
        assertGt(received, 0);
        assertEq(waiting.nativeAdded, 0);
        assertEq(vault.totalCreatorFeesReceived(), received);
        assertEq(vault.totalNativeAllocatedToGrowth(), received);
        assertEq(vault.pendingGrowthNative(), received);
        assertEq(vault.deferredRewardFees(), 0);
        assertEq(vault.totalRewardFeesReceived(), 0);
        assertEq(vault.claimable(creator), 0);

        _stageV2Oracle(vault);
        _matureV2Oracle(key);
        LiquidityGrowthFullRangeVaultV2.CompoundResult memory compounded = vault.compoundPending();
        assertGt(compounded.nativeAdded, 0);
        assertGt(compounded.liquidityAdded, 0);
        assertEq(vault.lockedLiquidity(), compounded.liquidityAdded);
        assertEq(vault.totalRewardFeesReceived(), 0);
        assertEq(vault.claimable(creator), 0);
    }

    function test_v2CrossingChunkRoutesOnlyTheTargetRemainderToGrowthAndDefersOverflow() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) = _launchV2(keccak256("v2-crossing-chunk"));

        uint256 target = vault.growthTargetNative();
        uint256 allocatedBefore = target - CROSSING_REMAINDER;
        stdstore.target(address(vault)).sig("totalCreatorFeesReceived()").checked_write(allocatedBefore);
        stdstore.target(address(vault)).sig("totalNativeAllocatedToGrowth()").checked_write(allocatedBefore);
        stdstore.target(address(vault)).sig("pendingGrowthNative()").checked_write(allocatedBefore);
        vm.deal(address(vault), allocatedBefore);

        _seedV2CreatorFees(key, 0.1 ether);
        (uint256 received, LiquidityGrowthFullRangeVaultV2.CompoundResult memory waiting) = vault.process();
        assertGt(received, CROSSING_REMAINDER);
        assertEq(waiting.nativeAdded, 0);

        assertEq(vault.totalCreatorFeesReceived(), allocatedBefore + received);
        assertEq(vault.totalNativeAllocatedToGrowth(), target);
        assertEq(vault.pendingGrowthNative(), target);
        assertEq(vault.deferredRewardFees(), received - CROSSING_REMAINDER);
        assertEq(vault.totalRewardFeesReceived(), 0);
        assertEq(vault.claimable(creator), 0);
        assertFalse(vault.growthTargetReached());
    }

    function test_v2AfterTargetMakesTheEntireCreatorShareClaimableAndStopsWhenIdle() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) = _launchV2(keccak256("v2-post-target-rewards"));

        uint256 target = vault.growthTargetNative();
        uint256 nativeAddedBeforeFinalCompound = target - FINAL_COMPOUND_REMAINDER;
        stdstore.target(address(vault)).sig("totalCreatorFeesReceived()").checked_write(target);
        stdstore.target(address(vault)).sig("totalNativeAllocatedToGrowth()").checked_write(target);
        stdstore.target(address(vault)).sig("totalNativeAddedToLiquidity()")
            .checked_write(nativeAddedBeforeFinalCompound);
        stdstore.target(address(vault)).sig("pendingGrowthNative()").checked_write(FINAL_COMPOUND_REMAINDER);
        vm.deal(address(vault), FINAL_COMPOUND_REMAINDER);
        _stageV2Oracle(vault);
        _matureV2Oracle(key);
        LiquidityGrowthFullRangeVaultV2.CompoundResult memory completed = vault.compoundPending();
        assertGt(completed.nativeAdded, 0);
        assertTrue(vault.growthTargetReached());
        assertGe(vault.totalNativeAddedToLiquidity(), vault.minimumNativeLiquidityForCompletion());
        uint256 rewardsBeforePostTargetFees = vault.totalRewardFeesReceived();

        _seedV2CreatorFees(key, 0.1 ether);
        (uint256 received, LiquidityGrowthFullRangeVaultV2.CompoundResult memory noCompound) = vault.process();
        assertGt(received, 0);
        assertEq(noCompound.nativeAdded, 0);
        assertEq(vault.totalNativeAllocatedToGrowth(), target);
        assertEq(vault.pendingGrowthNative(), 0);
        assertEq(vault.deferredRewardFees(), 0);
        assertEq(vault.totalRewardFeesReceived(), rewardsBeforePostTargetFees + received);
        assertEq(vault.claimable(creator), rewardsBeforePostTargetFees + received);

        (LiquidityGrowthFullRangeVaultV2.WorkAction action,,,,,) = vault.workState();
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeVaultV2.WorkAction.None));

        uint256 creatorBalanceBefore = creator.balance;
        vm.prank(creator);
        assertEq(vault.claimRewards(), rewardsBeforePostTargetFees + received);
        assertEq(creator.balance - creatorBalanceBefore, rewardsBeforePostTargetFees + received);
        assertEq(vault.claimable(creator), 0);

        (action,,,,,) = vault.workState();
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeVaultV2.WorkAction.None));
    }

    function test_v2RollingThirtyMinuteExposureCapBoundsSuccessesAndFailedAttemptsConsumeNothing() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) = _launchV2(keccak256("v2-rolling-exposure-cap"));

        _seedV2CreatorFees(key, 1 ether);
        vault.process();
        uint256 pendingBeforeFailedAttempt = vault.pendingGrowthNative();

        vm.expectRevert();
        vault.compoundPending();
        assertEq(vault.lastCompoundTimestamp(), 0);
        assertEq(vault.totalNativeAddedToLiquidity(), 0);
        assertEq(vault.pendingGrowthNative(), pendingBeforeFailedAttempt);
        assertEq(vault.rollingWindowNativeAdded(), 0);

        _stageV2Oracle(vault);
        _matureV2Oracle(key);
        uint256 windowStart = block.timestamp;
        uint256 nativeAddedAtWindowStart = vault.totalNativeAddedToLiquidity();
        uint256 successfulCompounds = 0;

        for (uint256 interval; interval < 6; interval++) {
            if (interval != 0) {
                vm.warp(windowStart + interval * EXPECTED_COMPOUND_COOLDOWN);
            }
            (, uint256 rollingWindowCap) = vault.trustedDepthAndCap();
            (LiquidityGrowthFullRangeVaultV2.WorkAction action,,,,,) = vault.workState();
            if (action == LiquidityGrowthFullRangeVaultV2.WorkAction.Compound) {
                LiquidityGrowthFullRangeVaultV2.CompoundResult memory compounded = vault.compoundPending();
                assertGt(compounded.nativeAdded, 0);
                successfulCompounds++;
            } else {
                uint256 timestampBeforeFailedAttempt = vault.lastCompoundTimestamp();
                uint256 nativeAddedBeforeFailedAttempt = vault.totalNativeAddedToLiquidity();
                uint256 pendingBeforeBlockedAttempt = vault.pendingGrowthNative();
                uint256 exposureBeforeBlockedAttempt = vault.rollingWindowNativeAdded();
                vm.expectRevert();
                vault.compoundPending();
                assertEq(vault.lastCompoundTimestamp(), timestampBeforeFailedAttempt);
                assertEq(vault.totalNativeAddedToLiquidity(), nativeAddedBeforeFailedAttempt);
                assertEq(vault.pendingGrowthNative(), pendingBeforeBlockedAttempt);
                assertEq(vault.rollingWindowNativeAdded(), exposureBeforeBlockedAttempt);
            }
            assertLe(vault.rollingWindowNativeAdded(), rollingWindowCap);
            assertLe(vault.totalNativeAddedToLiquidity() - nativeAddedAtWindowStart, rollingWindowCap);
        }
        assertGt(successfulCompounds, 0);
    }

    function test_v2RollingCapUsesTheTrustedDepthSnapshotFromTheFirstSuccessfulAddition() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) =
            _launchV2(keccak256("v2-fixed-window-depth-anchor"));

        _seedV2CreatorFees(key, 1 ether);
        vault.process();
        _stageV2Oracle(vault);
        _matureV2Oracle(key);

        (, uint256 capAtWindowStart) = vault.trustedDepthAndCap();
        LiquidityGrowthFullRangeVaultV2.CompoundResult memory compounded = vault.compoundPending();
        (uint256 activeExposure, uint256 anchoredCap, uint256 remainingCapacity) = vault.rollingWindowCapacity();
        (, uint256 currentDepthCapAfterAddition) = vault.trustedDepthAndCap();

        assertEq(activeExposure, compounded.nativeAdded);
        assertEq(anchoredCap, capAtWindowStart);
        assertEq(remainingCapacity, capAtWindowStart - compounded.nativeAdded);
        assertGt(currentDepthCapAfterAddition, capAtWindowStart);
    }

    function test_v2SuccessfulExposureExpiresAtTheExactThirtyMinuteBoundary() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) =
            _launchV2(keccak256("v2-rolling-exposure-expiry"));

        _seedV2CreatorFees(key, 1 ether);
        vault.process();
        _stageV2Oracle(vault);
        _matureV2Oracle(key);
        (, uint256 firstWindowCap) = vault.trustedDepthAndCap();
        LiquidityGrowthFullRangeVaultV2.CompoundResult memory compounded = vault.compoundPending();
        assertGt(compounded.nativeAdded, 0);
        assertEq(vault.rollingWindowNativeAdded(), compounded.nativeAdded);
        (, uint256 anchoredCap,) = vault.rollingWindowCapacity();
        assertEq(anchoredCap, firstWindowCap);

        uint256 recordedAt = vault.lastCompoundTimestamp();
        vm.warp(recordedAt + vault.ROLLING_EXPOSURE_WINDOW_SECONDS() - 1);
        assertEq(vault.rollingWindowNativeAdded(), compounded.nativeAdded);
        (, anchoredCap,) = vault.rollingWindowCapacity();
        assertEq(anchoredCap, firstWindowCap);
        vm.warp(recordedAt + vault.ROLLING_EXPOSURE_WINDOW_SECONDS());
        assertEq(vault.rollingWindowNativeAdded(), 0);
        (, uint256 refreshedCap, uint256 refreshedCapacity) = vault.rollingWindowCapacity();
        assertGt(refreshedCap, firstWindowCap);
        assertEq(refreshedCapacity, refreshedCap);

        (LiquidityGrowthFullRangeVaultV2.WorkAction action,,,,,) = vault.workState();
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeVaultV2.WorkAction.Compound));
        LiquidityGrowthFullRangeVaultV2.CompoundResult memory nextWindow = vault.compoundPending();
        assertGt(nextWindow.nativeAdded, 0);
        assertEq(vault.rollingWindowNativeAdded(), nextWindow.nativeAdded);
        (, uint256 nextWindowAnchoredCap,) = vault.rollingWindowCapacity();
        assertEq(nextWindowAnchoredCap, refreshedCap);
    }

    function test_v2OnlyTheSoleCreatorCanManageAndClaimRewards() public {
        (,, LiquidityGrowthFullRangeVaultV2 vault) = _launchV2(keccak256("v2-sole-creator"));
        address outsider = makeAddr("deep-v2-outsider");

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV2.UnauthorizedBeneficiary.selector, outsider)
        );
        vault.setPayoutAddress(outsider);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV2.UnauthorizedBeneficiary.selector, outsider)
        );
        vault.claimRewards();

        address newPayout = makeAddr("deep-v2-payout");
        vm.prank(creator);
        vault.setPayoutAddress(newPayout);
        assertEq(vault.payoutAddressOf(creator), newPayout);
        assertEq(vault.shareBpsOf(outsider), 0);
        assertEq(vault.claimable(outsider), 0);
    }

    function test_v2OppositeDirectionSustainedStatesRemainLossMakingWithinEveryFixedBound() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) =
            _launchV2(keccak256("v2-opposite-direction-review"));
        _stageV2Oracle(vault);
        _matureV2Oracle(key);

        uint256[3] memory tokenInputs = [uint256(25_000 ether), 150_000 ether, 300_000 ether];
        for (uint256 index; index < tokenInputs.length; index++) {
            uint256 baseline = vm.snapshotState();
            int256 outcome = _reviewV2OppositeDirectionState(key, vault, tokenInputs[index]);
            assertLt(outcome, 0);
            assertTrue(vm.revertToState(baseline));
        }
    }

    function _launchV2(bytes32 salt)
        private
        returns (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 vault
        )
    {
        LiquidityGrowthFullRangeLaunchV2.LaunchParameters memory parameters =
            LiquidityGrowthFullRangeLaunchV2.LaunchParameters({
                name: "Deep V2",
                symbol: "DEEP2",
                creatorSalt: salt,
                metadata: UERC20Metadata({
                    description: "Deep V2 fixed liquidity-growth test fixture",
                    website: "https://programmable.family",
                    image: "ipfs://deep-v2",
                    extraData: bytes("")
                })
            });
        vm.prank(creator);
        result = v2Launcher.launch{ value: INITIAL_BUY }(parameters);
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(result.token),
            fee: v2Launcher.LP_FEE_PIPS(),
            tickSpacing: v2Launcher.TICK_SPACING(),
            hooks: hook
        });
        vault = LiquidityGrowthFullRangeVaultV2(payable(result.growthVault));
    }

    function _stageV2Oracle(LiquidityGrowthFullRangeVaultV2 vault) private {
        uint16 target = v2Automation.OBSERVATION_CARDINALITY_TARGET();
        PoolId id = PoolId.wrap(vault.poolId());
        (,, uint16 next) = hook.stateById(id);
        for (uint256 stage; stage < 16 && next < target; stage++) {
            (bool grew,, uint16 stagedNext) = v2Automation.stageOracle(address(vault));
            assertTrue(grew);
            next = stagedNext;
        }
        assertEq(next, target);
    }

    function _matureV2Oracle(PoolKey memory key) private {
        for (uint256 write; write < 32; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            swap(key, true, -int256(0.000_001 ether), "");
        }
        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
    }

    function _seedV2CreatorFees(PoolKey memory key, uint256 nativeIn) private {
        swap(key, true, -int256(nativeIn), "");
    }

    function _reviewV2OppositeDirectionState(
        PoolKey memory key,
        LiquidityGrowthFullRangeVaultV2 vault,
        uint256 tokenInput
    ) private returns (int256 outcome) {
        IERC20 launchedToken = IERC20(vault.token());
        uint256 sustainedWritesTokenInput = 100 ether * 32;
        uint256 totalTokenInventory = tokenInput + sustainedWritesTokenInput;

        vm.prank(creator);
        assertTrue(launchedToken.transfer(address(this), totalTokenInventory));

        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = launchedToken.balanceOf(address(this));
        launchedToken.approve(address(swapRouter), totalTokenInventory);

        swap(key, false, -tokenInput.toInt256(), "");
        for (uint256 write; write < 32; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            swap(key, false, -int256(100 ether), "");
        }
        assertEq(tokenBefore - launchedToken.balanceOf(address(this)), totalTokenInventory);
        uint256 nativeProceeds = address(this).balance - nativeBefore;
        assertGt(nativeProceeds, 0);

        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
        assertTrue(vault.oracleReady());
        _fundCompleteV2GrowthTarget(vault);

        for (uint256 cycle; cycle < 32 && !vault.growthTargetReached(); cycle++) {
            if (cycle != 0) {
                vm.warp(block.timestamp + vault.ROLLING_EXPOSURE_WINDOW_SECONDS());
                vm.roll(block.number + 150);
            }
            (, uint256 depthCap) = vault.trustedDepthAndCap();
            LiquidityGrowthFullRangeVaultV2.CompoundResult memory result = vault.compoundPending();
            assertLe(result.nativeAdded, depthCap);
            assertLe(vault.rollingWindowNativeAdded(), depthCap);
            assertLe(vault.totalNativeAddedToLiquidity(), vault.growthTargetNative());
        }
        assertTrue(vault.growthTargetReached());
        assertGe(vault.totalNativeAddedToLiquidity(), vault.minimumNativeLiquidityForCompletion());

        swap(key, true, -nativeProceeds.toInt256(), "");
        assertEq(address(this).balance, nativeBefore);
        outcome = launchedToken.balanceOf(address(this)).toInt256() - tokenBefore.toInt256();
    }

    function _fundCompleteV2GrowthTarget(LiquidityGrowthFullRangeVaultV2 vault) private {
        uint256 target = vault.growthTargetNative();
        vm.deal(address(vault), target);
        stdstore.target(address(vault)).sig("totalCreatorFeesReceived()").checked_write(target);
        stdstore.target(address(vault)).sig("totalNativeAllocatedToGrowth()").checked_write(target);
        stdstore.target(address(vault)).sig("pendingGrowthNative()").checked_write(target);
    }
}
