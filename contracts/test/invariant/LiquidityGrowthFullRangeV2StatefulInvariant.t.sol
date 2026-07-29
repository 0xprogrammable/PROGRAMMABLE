// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Test } from "forge-std/Test.sol";

import { LiquidityGrowthFeeOracleHookV1 } from "../../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthFullRangeAutomationV2 } from "../../src/LiquidityGrowthFullRangeAutomationV2.sol";
import { LiquidityGrowthFullRangeLaunchV2 } from "../../src/LiquidityGrowthFullRangeLaunchV2.sol";
import { LiquidityGrowthFullRangePolicyV2 as Policy } from "../../src/LiquidityGrowthFullRangePolicyV2.sol";
import { LiquidityGrowthFullRangeVaultFactoryV2 } from "../../src/LiquidityGrowthFullRangeVaultFactoryV2.sol";
import { LiquidityGrowthFullRangeVaultV2 } from "../../src/LiquidityGrowthFullRangeVaultV2.sol";
import { LiquidityGrowthRangeSourceV1 } from "../../src/LiquidityGrowthRangeSourceV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "../../src/interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";
import { LiquidityGrowthFullRangeFixture } from "../utils/LiquidityGrowthFullRangeFixture.sol";

/// @notice Stateful Deep V2 actions using only public launch, swap, keeper and beneficiary entry points.
/// @dev Price perturbation is deliberately limited to real exact-input v4 swaps. The harness does not mutate pool
///      ticks, oracle observations, fee balances or vault accounting with storage cheatcodes.
contract LiquidityGrowthFullRangeV2StatefulHandler is Test {
    using SafeCast for uint256;

    struct GrowthSnapshot {
        uint256 totalNativeAdded;
        uint256 rollingExposure;
        uint256 depthCap;
        uint256 pendingNative;
        uint256 totalAllocated;
        uint256 totalReceived;
        uint256 lockedLiquidity;
        uint64 lastCompoundTimestamp;
    }

    struct FixedWindowAnchor {
        uint64 startedAt;
        uint256 nativeAddedBefore;
        uint256 depthCapAtStart;
    }

    LiquidityGrowthFullRangeVaultV2 public immutable vault;
    LiquidityGrowthFullRangeVaultV2 public immutable unregisteredFactoryVault;
    LiquidityGrowthFullRangeAutomationV2 public immutable automation;
    LiquidityGrowthFeeOracleHookV1 public immutable feeHook;
    PoolSwapTest public immutable swapRouter;
    IERC20 public immutable token;
    address public immutable creator;
    address public immutable outsider;
    address public immutable alternatePayout;

    PoolKey private _key;
    FixedWindowAnchor[] private _fixedWindowAnchors;
    PoolSwapTest.TestSettings private _settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    bool public feeSplitBreached;
    bool public fixedAnchorCapBreached;
    bool public failedExecutionConsumedState;
    bool public liquidityDecreased;
    bool public rollingCapBreached;
    bool public unauthorizedBeneficiaryActionSucceeded;
    bool public unregisteredVaultAutomated;

    uint256 public lastObservedLockedLiquidity;
    uint256 public lastObservedTotalLiquidity;
    uint256 public successfulFeeSwaps;

    constructor(
        LiquidityGrowthFullRangeVaultV2 vault_,
        LiquidityGrowthFullRangeVaultV2 unregisteredFactoryVault_,
        LiquidityGrowthFullRangeAutomationV2 automation_,
        LiquidityGrowthFeeOracleHookV1 feeHook_,
        PoolSwapTest swapRouter_,
        PoolKey memory key_,
        address creator_,
        address outsider_,
        address alternatePayout_
    ) {
        vault = vault_;
        unregisteredFactoryVault = unregisteredFactoryVault_;
        automation = automation_;
        feeHook = feeHook_;
        swapRouter = swapRouter_;
        _key = key_;
        token = IERC20(vault_.token());
        creator = creator_;
        outsider = outsider_;
        alternatePayout = alternatePayout_;
        token.approve(address(swapRouter_), type(uint256).max);
        lastObservedLockedLiquidity = vault_.lockedLiquidity();
        lastObservedTotalLiquidity = vault_.totalLiquidityAdded();
    }

    receive() external payable { }

    /// @notice Random gross-native fee arrivals also move the real pool tick and write the real oracle.
    function seedBuy(uint96 rawAmount) external {
        uint256 amount = 0.000_01 ether + uint256(rawAmount) % (0.5 ether - 0.000_01 ether);
        if (address(this).balance < amount) return;

        (uint256 creatorBefore, uint256 launcherBefore) = _cumulativeFeeSplit();
        try swapRouter.swap{ value: amount }(
            _key,
            SwapParams({
                zeroForOne: true, amountSpecified: -amount.toInt256(), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            _settings,
            ""
        ) {
            _checkFeeSplitDelta(creatorBefore, launcherBefore);
        } catch { }
        _observeState();
    }

    /// @notice Opposite-direction real swaps perturb price and exercise native-output fee accounting.
    function seedSell(uint96 rawAmount) external {
        uint256 balance = token.balanceOf(address(this));
        uint256 minimum = 10_000 ether;
        if (balance < minimum) return;
        uint256 ceiling = balance < 2_000_000 ether ? balance : 2_000_000 ether;
        uint256 amount = minimum + uint256(rawAmount) % (ceiling - minimum + 1);

        (uint256 creatorBefore, uint256 launcherBefore) = _cumulativeFeeSplit();
        try swapRouter.swap(
            _key,
            SwapParams({
                zeroForOne: false, amountSpecified: -amount.toInt256(), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            _settings,
            ""
        ) {
            _checkFeeSplitDelta(creatorBefore, launcherBefore);
        } catch { }
        _observeState();
    }

    /// @notice Exercises cooldown boundaries and exact rolling-window expiry without time-traveling backwards.
    function advance(uint32 rawSeconds) external {
        uint256 elapsed = 1 + uint256(rawSeconds) % (35 minutes);
        vm.warp(block.timestamp + elapsed);
        vm.roll(block.number + 1);
        _observeState();
    }

    function stageOracle() external {
        try automation.stageOracle(address(vault)) { } catch { }
        _observeState();
    }

    function performKeeperWork() external {
        GrowthSnapshot memory beforeState = _snapshot();
        (bool callSucceeded, bytes memory returnData) =
            address(automation).call(abi.encodeCall(automation.performVault, (address(vault))));
        bool workSucceeded;
        if (callSucceeded) {
            (workSucceeded,) = abi.decode(returnData, (bool, LiquidityGrowthFullRangeAutomationV2.Action));
        }
        _afterGrowthAttempt(beforeState, callSucceeded && workSucceeded);
    }

    function processFees() external {
        GrowthSnapshot memory beforeState = _snapshot();
        (bool succeeded,) = address(vault).call(abi.encodeCall(vault.process, ()));
        _afterGrowthAttempt(beforeState, succeeded);
    }

    function compoundPending() external {
        GrowthSnapshot memory beforeState = _snapshot();
        (bool succeeded,) = address(vault).call(abi.encodeCall(vault.compoundPending, ()));
        _afterGrowthAttempt(beforeState, succeeded);
    }

    function claimCreatorRewards() external {
        vm.prank(creator);
        try vault.claimRewards() { } catch { }
        _observeState();
    }

    function updateCreatorPayout(bool useAlternate) external {
        address nextPayout = useAlternate ? alternatePayout : address(this);
        vm.prank(creator);
        try vault.setPayoutAddress(nextPayout) { } catch { }
        _observeState();
    }

    function attemptUnauthorizedPayout(bool useCreatorAsPayout) external {
        address creatorPayoutBefore = vault.payoutAddressOf(creator);
        address requested = useCreatorAsPayout ? creator : outsider;
        vm.prank(outsider);
        (bool succeeded,) = address(vault).call(abi.encodeCall(vault.setPayoutAddress, (requested)));
        if (succeeded || vault.payoutAddressOf(creator) != creatorPayoutBefore) {
            unauthorizedBeneficiaryActionSucceeded = true;
        }
        _observeState();
    }

    function attemptUnauthorizedClaim() external {
        uint256 claimedBefore = vault.totalRewardFeesClaimed();
        vm.prank(outsider);
        (bool succeeded,) = address(vault).call(abi.encodeCall(vault.claimRewards, ()));
        if (succeeded || vault.totalRewardFeesClaimed() != claimedBefore) {
            unauthorizedBeneficiaryActionSucceeded = true;
        }
        _observeState();
    }

    /// @notice A factory-recorded clone is still ineligible until the immutable launcher registers it.
    function probeUnregisteredFactoryVault() external {
        uint256 countBefore = automation.registeredVaultCount();
        (bool performed, LiquidityGrowthFullRangeAutomationV2.Action action) =
            automation.performVault(address(unregisteredFactoryVault));
        if (performed || action != LiquidityGrowthFullRangeAutomationV2.Action.None) {
            unregisteredVaultAutomated = true;
        }

        (bool staged,) =
            address(automation).call(abi.encodeCall(automation.stageOracle, (address(unregisteredFactoryVault))));
        (bool registered,) = address(automation)
            .call(abi.encodeCall(automation.registerAndStageOracle, (address(unregisteredFactoryVault))));
        if (staged || registered || automation.registeredVaultCount() != countBefore) {
            unregisteredVaultAutomated = true;
        }
        _observeState();
    }

    function fixedWindowAnchorCount() external view returns (uint256) {
        return _fixedWindowAnchors.length;
    }

    function _afterGrowthAttempt(GrowthSnapshot memory beforeState, bool succeeded) private {
        GrowthSnapshot memory afterState = _snapshot();
        if (!succeeded && !_sameState(beforeState, afterState)) {
            failedExecutionConsumedState = true;
        }

        if (afterState.totalNativeAdded > beforeState.totalNativeAdded) {
            _fixedWindowAnchors.push(
                FixedWindowAnchor({
                    startedAt: block.timestamp.toUint64(),
                    nativeAddedBefore: beforeState.totalNativeAdded,
                    depthCapAtStart: beforeState.depthCap
                })
            );
        }
        _observeState();
    }

    function _observeState() private {
        uint256 locked = vault.lockedLiquidity();
        uint256 totalLiquidity = vault.totalLiquidityAdded();
        if (locked < lastObservedLockedLiquidity || totalLiquidity < lastObservedTotalLiquidity) {
            liquidityDecreased = true;
        }
        lastObservedLockedLiquidity = locked;
        lastObservedTotalLiquidity = totalLiquidity;

        (, uint256 currentCap) = vault.trustedDepthAndCap();
        if (vault.rollingWindowNativeAdded() > currentCap) {
            rollingCapBreached = true;
        }

        uint256 totalNativeAdded = vault.totalNativeAddedToLiquidity();
        uint256 window = vault.ROLLING_EXPOSURE_WINDOW_SECONDS();
        uint256 count = _fixedWindowAnchors.length;
        for (uint256 index; index < count; index++) {
            FixedWindowAnchor memory anchor = _fixedWindowAnchors[index];
            if (
                // Stateful tests intentionally exercise the protocol's timestamp-defined 30-minute boundary.
                // forge-lint: disable-next-line(block-timestamp)
                uint256(anchor.startedAt) + window > block.timestamp
                    && totalNativeAdded - anchor.nativeAddedBefore > anchor.depthCapAtStart
            ) {
                fixedAnchorCapBreached = true;
            }
        }
    }

    function _snapshot() private view returns (GrowthSnapshot memory state) {
        state.totalNativeAdded = vault.totalNativeAddedToLiquidity();
        state.rollingExposure = vault.rollingWindowNativeAdded();
        (, state.depthCap) = vault.trustedDepthAndCap();
        state.pendingNative = vault.pendingGrowthNative();
        state.totalAllocated = vault.totalNativeAllocatedToGrowth();
        state.totalReceived = vault.totalCreatorFeesReceived();
        state.lockedLiquidity = vault.lockedLiquidity();
        state.lastCompoundTimestamp = vault.lastCompoundTimestamp();
    }

    function _sameState(GrowthSnapshot memory left, GrowthSnapshot memory right) private pure returns (bool) {
        return left.totalNativeAdded == right.totalNativeAdded && left.rollingExposure == right.rollingExposure
            && left.pendingNative == right.pendingNative && left.totalAllocated == right.totalAllocated
            && left.totalReceived == right.totalReceived && left.lockedLiquidity == right.lockedLiquidity
            && left.lastCompoundTimestamp == right.lastCompoundTimestamp;
    }

    function _cumulativeFeeSplit() private view returns (uint256 creatorFees, uint256 launcherFees) {
        (,,,,, uint256 creatorAccrued) = feeHook.poolFeeConfig(vault.poolId());
        creatorFees = creatorAccrued + vault.totalCreatorFeesReceived();
        launcherFees = feeHook.launcherFeesAccrued();
    }

    function _checkFeeSplitDelta(uint256 creatorBefore, uint256 launcherBefore) private {
        (uint256 creatorAfter, uint256 launcherAfter) = _cumulativeFeeSplit();
        uint256 creatorDelta = creatorAfter - creatorBefore;
        uint256 launcherDelta = launcherAfter - launcherBefore;
        if (creatorDelta == 0 && launcherDelta == 0) return;
        successfulFeeSwaps++;

        // For a 1% fee, each gross-native charge is floor(90 bps) + floor(10 bps).
        // Independent integer rounding leaves at most nine wei above the exact 9:1 ratio per swap.
        if (launcherDelta == 0 || creatorDelta < launcherDelta * 9 || creatorDelta > launcherDelta * 9 + 9) {
            feeSplitBreached = true;
        }
    }
}

/// @notice Stateful release gate for Deep V2.
/// @dev The fixed 0.05 ETH completion path can require more volume and rolling windows than a bounded invariant run.
///      Completion accounting is therefore asserted conditionally, while the deterministic completion transition
///      remains covered by LiquidityGrowthFullRangeV2.t.sol. This harness does not pretend to prove arbitrary token
///      behavior: it covers the canonical UERC20 launch plus one unregistered factory clone.
contract LiquidityGrowthFullRangeV2StatefulInvariantTest is LiquidityGrowthFullRangeFixture {
    LiquidityGrowthFullRangeVaultFactoryV2 internal v2VaultFactory;
    LiquidityGrowthFullRangeLaunchV2 internal v2Launcher;
    LiquidityGrowthFullRangeAutomationV2 internal v2Automation;
    LiquidityGrowthFullRangeLaunchV2.LaunchResult internal launchResult;
    LiquidityGrowthFullRangeVaultV2 internal vault;
    LiquidityGrowthFullRangeVaultV2 internal unregisteredFactoryVault;
    LiquidityGrowthFullRangeV2StatefulHandler internal handler;
    PoolKey internal v2Key;

    address internal outsider;
    address internal alternatePayout;

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

        vm.prank(creator);
        launchResult = v2Launcher.launch{ value: INITIAL_BUY }(
            LiquidityGrowthFullRangeLaunchV2.LaunchParameters({
                name: "Deep V2 Stateful",
                symbol: "D2STATE",
                creatorSalt: keccak256("deep-v2-stateful-invariant"),
                metadata: _statefulMetadata()
            })
        );
        v2Key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(launchResult.token),
            fee: v2Launcher.LP_FEE_PIPS(),
            tickSpacing: v2Launcher.TICK_SPACING(),
            hooks: hook
        });
        vault = LiquidityGrowthFullRangeVaultV2(payable(launchResult.growthVault));

        _stageOracle();
        _matureOracle();
        unregisteredFactoryVault = _deployUnregisteredFactoryVault();

        outsider = makeAddr("deep-v2-stateful-outsider");
        alternatePayout = makeAddr("deep-v2-stateful-alternate-payout");
        handler = new LiquidityGrowthFullRangeV2StatefulHandler(
            vault, unregisteredFactoryVault, v2Automation, hook, swapRouter, v2Key, creator, outsider, alternatePayout
        );
        vm.deal(address(handler), 100 ether);

        IERC20 launchedToken = IERC20(launchResult.token);
        uint256 creatorInventory = launchedToken.balanceOf(creator);
        if (creatorInventory != 0) {
            vm.prank(creator);
            assertTrue(launchedToken.transfer(address(handler), creatorInventory / 2));
        }

        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = LiquidityGrowthFullRangeV2StatefulHandler.seedBuy.selector;
        selectors[1] = LiquidityGrowthFullRangeV2StatefulHandler.seedSell.selector;
        selectors[2] = LiquidityGrowthFullRangeV2StatefulHandler.advance.selector;
        selectors[3] = LiquidityGrowthFullRangeV2StatefulHandler.stageOracle.selector;
        selectors[4] = LiquidityGrowthFullRangeV2StatefulHandler.performKeeperWork.selector;
        selectors[5] = LiquidityGrowthFullRangeV2StatefulHandler.processFees.selector;
        selectors[6] = LiquidityGrowthFullRangeV2StatefulHandler.compoundPending.selector;
        selectors[7] = LiquidityGrowthFullRangeV2StatefulHandler.claimCreatorRewards.selector;
        selectors[8] = LiquidityGrowthFullRangeV2StatefulHandler.updateCreatorPayout.selector;
        selectors[9] = LiquidityGrowthFullRangeV2StatefulHandler.attemptUnauthorizedPayout.selector;
        selectors[10] = LiquidityGrowthFullRangeV2StatefulHandler.attemptUnauthorizedClaim.selector;
        selectors[11] = LiquidityGrowthFullRangeV2StatefulHandler.probeUnregisteredFactoryVault.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_growthNativeAndCompletionToleranceStayBounded() public view {
        uint256 allocated = vault.totalNativeAllocatedToGrowth();
        uint256 added = vault.totalNativeAddedToLiquidity();
        uint256 target = vault.growthTargetNative();
        assertLe(allocated, target);
        assertLe(added, target);

        if (!vault.growthTargetReached()) {
            assertEq(added + vault.pendingGrowthNative(), allocated + vault.totalNativeRecycled());
        } else {
            assertEq(allocated, target);
            assertEq(added + vault.nativeLiquidityShortfallAtCompletion(), target);
            assertLe(vault.nativeLiquidityShortfallAtCompletion(), vault.completionToleranceNative());
            assertGe(added, vault.minimumNativeLiquidityForCompletion());
            assertEq(vault.pendingGrowthNative(), 0);
        }
    }

    function invariant_everyProcessedNativeWeiHasOneAccountingDestination() public view {
        assertEq(
            vault.totalCreatorFeesReceived() + vault.totalNativeRecycled(),
            vault.totalNativeAddedToLiquidity() + vault.pendingGrowthNative() + vault.deferredRewardFees()
                + vault.totalRewardFeesReceived()
        );
        uint256 unclaimed = vault.totalRewardFeesReceived() - vault.totalRewardFeesClaimed();
        assertGe(address(vault).balance, vault.pendingGrowthNative() + vault.deferredRewardFees() + unclaimed);
    }

    function invariant_tokenReserveNeverLeavesItsFixedEnvelope() public view {
        uint256 remaining = IERC20(vault.token()).balanceOf(address(vault));
        assertEq(
            remaining + vault.totalTokenAddedToLiquidity(), vault.tokenReserveTarget() + vault.totalTokenRecycled()
        );

        uint256 added = vault.totalNativeAddedToLiquidity();
        uint256 target = vault.growthTargetNative();
        uint256 remainingTarget = added < target ? target - added : 0;
        assertGe(remaining, Policy.requiredReserveAtStress(remainingTarget));
    }

    function invariant_liquidityIsAddOnlyAndBothPositionsRemainLocked() public view {
        assertFalse(handler.liquidityDecreased());
        assertEq(vault.lockedLiquidity(), vault.totalLiquidityAdded());
        assertEq(
            IERC721(address(positionManager)).ownerOf(launchResult.positionTokenId), launchResult.positionRecipient
        );
    }

    function invariant_feesStayAtTheDisclosedNinetyTenSplit() public view {
        assertFalse(handler.feeSplitBreached());
        (
            uint16 buyFee,
            uint16 sellFee,
            uint16 buyCreatorFee,
            uint16 sellCreatorFee,
            uint16 launcherFee,
            uint16 transferTax,
            uint24 lpFee,
            address rewardVault
        ) = hook.feeDisclosure(vault.poolId());
        assertEq(buyFee, 100);
        assertEq(sellFee, 100);
        assertEq(buyCreatorFee, 90);
        assertEq(sellCreatorFee, 90);
        assertEq(launcherFee, 10);
        assertEq(transferTax, 0);
        assertEq(lpFee, 0);
        assertEq(rewardVault, address(vault.upstreamVault()));

        (,,,,, uint256 creatorAccrued) = hook.poolFeeConfig(vault.poolId());
        assertEq(creatorAccrued + hook.launcherFeesAccrued(), hook.totalNativeFeesAccrued());
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), hook.totalNativeFeesAccrued());
    }

    function invariant_rollingExposureUsesCurrentAndFixedWindowCaps() public view {
        assertFalse(handler.rollingCapBreached());
        assertFalse(handler.fixedAnchorCapBreached());
        (, uint256 currentCap) = vault.trustedDepthAndCap();
        assertLe(vault.rollingWindowNativeAdded(), currentCap);
    }

    function invariant_failedWorkNeverConsumesCooldownOrGrowthAccounting() public view {
        assertFalse(handler.failedExecutionConsumedState());
    }

    function invariant_onlyTheCanonicalLauncherVaultCanBeAutomated() public view {
        assertEq(v2Automation.registeredVaultCount(), 1);
        assertEq(v2Automation.registeredVaultAt(0), address(vault));
        assertTrue(v2Automation.isRegisteredVault(address(vault)));
        assertFalse(v2Automation.isRegisteredVault(address(unregisteredFactoryVault)));
        assertFalse(handler.unregisteredVaultAutomated());
    }

    function invariant_onlyTheCreatorControlsPayoutAndClaims() public view {
        assertFalse(handler.unauthorizedBeneficiaryActionSucceeded());
        assertEq(vault.beneficiaryCount(), 1);
        assertEq(vault.beneficiaryAt(0), creator);
        assertEq(vault.shareBpsOf(creator), 10_000);
        assertEq(vault.shareBpsOf(outsider), 0);
        assertEq(vault.claimable(outsider), 0);
        assertEq(vault.claimedBy(creator), vault.totalRewardFeesClaimed());
        assertLe(vault.totalRewardFeesClaimed(), vault.totalRewardFeesReceived());

        address payout = vault.payoutAddressOf(creator);
        assertTrue(payout == creator || payout == address(handler) || payout == alternatePayout);
    }

    function _stageOracle() private {
        uint16 target = v2Automation.OBSERVATION_CARDINALITY_TARGET();
        (,, uint16 next) = hook.stateById(PoolId.wrap(vault.poolId()));
        for (uint256 stage; stage < 16 && next < target; stage++) {
            (bool grew,, uint16 stagedNext) = v2Automation.stageOracle(address(vault));
            assertTrue(grew);
            next = stagedNext;
        }
        assertEq(next, target);
    }

    function _matureOracle() private {
        for (uint256 write; write < 32; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            swap(v2Key, true, -int256(0.000_001 ether), "");
        }
        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
        assertTrue(vault.oracleReady());
    }

    function _deployUnregisteredFactoryVault() private returns (LiquidityGrowthFullRangeVaultV2 candidate) {
        LiquidityGrowthFullRangeVaultV2.Configuration memory configuration =
            LiquidityGrowthFullRangeVaultV2.Configuration({
                poolKey: v2Key,
                oracleGuard: LiquidityGrowthRangeSourceV1(launchResult.oracleGuard),
                positionManager: positionManager,
                positionForwarderFactory: positionForwarderFactory,
                initialPositionTokenId: launchResult.positionTokenId,
                initialPositionRecipient: launchResult.positionRecipient,
                creator: creator
            });
        candidate = v2VaultFactory.deployOrGet(
            keccak256("deep-v2-unregistered-factory-vault"),
            ILiquidityGrowthFullRangeOracleHookV1(address(hook)),
            configuration
        );
        assertTrue(v2VaultFactory.isFactoryVault(address(candidate)));
        assertFalse(v2Automation.isRegisteredVault(address(candidate)));
    }

    function _statefulMetadata() private pure returns (UERC20Metadata memory metadata) {
        metadata = UERC20Metadata({
            description: "Deep V2 stateful invariant fixture",
            website: "https://programmable.family",
            image: "ipfs://deep-v2-stateful",
            extraData: bytes("")
        });
    }
}
