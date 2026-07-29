// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { StdStorage, stdStorage } from "forge-std/StdStorage.sol";

import { LiquidityGrowthFullRangeAutomationV2 } from "../src/LiquidityGrowthFullRangeAutomationV2.sol";
import { LiquidityGrowthFullRangeLaunchV2 } from "../src/LiquidityGrowthFullRangeLaunchV2.sol";
import { LiquidityGrowthFullRangePolicyV2 as Policy } from "../src/LiquidityGrowthFullRangePolicyV2.sol";
import { LiquidityGrowthFullRangeVaultFactoryV2 } from "../src/LiquidityGrowthFullRangeVaultFactoryV2.sol";
import { LiquidityGrowthFullRangeVaultV2 } from "../src/LiquidityGrowthFullRangeVaultV2.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "../src/interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";
import { LiquidityGrowthFullRangeV2Fixture } from "./utils/LiquidityGrowthFullRangeV2Fixture.sol";

contract LiquidityGrowthFullRangePolicyV2Harness {
    function requiredReserveAtStress(uint256 remainingNativeTarget) external pure returns (uint256) {
        return Policy.requiredReserveAtStress(remainingNativeTarget);
    }

    function pairingTokenBudget(uint160 sqrtPriceX96, uint256 nativeAmount) external pure returns (uint256) {
        return Policy.pairingTokenBudget(sqrtPriceX96, nativeAmount);
    }

    function priceWithinEnvelope(uint160 sqrtPriceX96) external pure returns (bool) {
        return Policy.priceWithinEnvelope(sqrtPriceX96);
    }
}

contract RevertingDeepV2Payout {
    receive() external payable {
        revert();
    }
}

/// @notice Deep V2 security regression that does not modify or mock the reviewed V2 implementation.
contract LiquidityGrowthFullRangeV2SecurityTest is LiquidityGrowthFullRangeV2Fixture {
    using StateLibrary for IPoolManager;
    using stdStorage for StdStorage;

    LiquidityGrowthFullRangePolicyV2Harness private policyHarness;

    function setUp() public override {
        super.setUp();
        policyHarness = new LiquidityGrowthFullRangePolicyV2Harness();
    }

    function test_v2OracleRequiresAllocatedCapacityAndRealHistory() public {
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,, LiquidityGrowthFullRangeVaultV2 vault) =
            _launchV2Fixture(keccak256("v2-oracle-maturity"));
        (,, uint16 cardinalityNextAtLaunch) = hook.stateById(PoolId.wrap(result.poolId));

        assertEq(cardinalityNextAtLaunch, 2);
        assertFalse(vault.oracleReady());
        _stageV2Oracle(address(vault));
        assertFalse(vault.oracleReady());

        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
        assertTrue(vault.oracleReady());
    }

    function test_v2AtomicSpotMoveBeyondBreakerCannotCompound() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) =
            _launchV2Fixture(keccak256("v2-atomic-spot-breaker"));
        _stageV2Oracle(address(vault));
        _matureV2Oracle(key);
        assertTrue(vault.oracleReady());

        (, int24 tickBefore,,) = manager.getSlot0(key.toId());
        swap(key, true, -int256(0.2 ether), "");
        (, int24 tickAfter,,) = manager.getSlot0(key.toId());

        assertGt(_absoluteTickDifference(tickBefore, tickAfter), 600);
        assertFalse(vault.oracleReady());
        vm.expectRevert();
        vault.compoundPending();
    }

    function test_v2LowerSpotAndExternalLiquidityCannotInflateTrustedDepth() public {
        (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 vault
        ) = _launchV2Fixture(keccak256("v2-trusted-depth"));
        (uint256 depthBefore, uint256 capBefore) = vault.trustedDepthAndCap();

        swap(key, true, -int256(0.05 ether), "");
        (uint256 depthAfterLowerSpot, uint256 capAfterLowerSpot) = vault.trustedDepthAndCap();
        assertEq(depthAfterLowerSpot, depthBefore);
        assertEq(capAfterLowerSpot, capBefore);

        IERC20(result.token).approve(address(modifyLiquidityRouter), type(uint256).max);
        modifyLiquidityRouter.modifyLiquidity{ value: 1 ether }(
            key,
            ModifyLiquidityParams({
                tickLower: vault.FULL_RANGE_TICK_LOWER(),
                tickUpper: vault.FULL_RANGE_TICK_UPPER(),
                liquidityDelta: int256(1 ether),
                salt: keccak256("v2-external-untrusted-liquidity")
            }),
            ZERO_BYTES
        );

        (uint256 depthAfterExternalLiquidity, uint256 capAfterExternalLiquidity) = vault.trustedDepthAndCap();
        assertEq(depthAfterExternalLiquidity, depthBefore);
        assertEq(capAfterExternalLiquidity, capBefore);
        assertEq(vault.lockedLiquidity(), 0);
    }

    function test_v2CloneImplementationIsLockedAndFactoryInitializationIsCommittedAndDeterministic() public {
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result, PoolKey memory key,) =
            _launchV2Fixture(keccak256("v2-clone-commitment-source"));
        LiquidityGrowthFullRangeVaultV2.Configuration memory configuration =
            _configuration(result, key, result.positionRecipient, creator);
        LiquidityGrowthFullRangeVaultV2 implementation =
            LiquidityGrowthFullRangeVaultV2(payable(v2VaultFactory.implementation()));

        assertTrue(implementation.initialized());
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV2.UnauthorizedInitializer.selector, address(this))
        );
        implementation.initialize(ILiquidityGrowthFullRangeOracleHookV1(address(hook)), splitFactory, configuration);

        bytes32 salt = keccak256("v2-deterministic-committed-clone");
        address predicted =
            v2VaultFactory.predict(salt, ILiquidityGrowthFullRangeOracleHookV1(address(hook)), configuration);
        LiquidityGrowthFullRangeVaultV2 deployed =
            v2VaultFactory.deployOrGet(salt, ILiquidityGrowthFullRangeOracleHookV1(address(hook)), configuration);

        assertEq(address(deployed), predicted);
        assertTrue(deployed.initialized());
        assertTrue(deployed.configurationHash() != bytes32(0));
        assertEq(v2VaultFactory.configurationHashOf(predicted), deployed.configurationHash());
        assertEq(v2VaultFactory.initializationCommitment(predicted), bytes32(0));
        assertEq(
            address(
                v2VaultFactory.deployOrGet(salt, ILiquidityGrowthFullRangeOracleHookV1(address(hook)), configuration)
            ),
            predicted
        );
    }

    function test_v2FactoryRejectsUnrecognizedInitialPositionForwarder() public {
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result, PoolKey memory key,) =
            _launchV2Fixture(keccak256("v2-unrecognized-forwarder-source"));
        PositionFeesForwarder unrecognized =
            new PositionFeesForwarder(positionManager, address(0), type(uint256).max, creator);
        LiquidityGrowthFullRangeVaultV2.Configuration memory configuration =
            _configuration(result, key, address(unrecognized), creator);

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeVaultFactoryV2.InvalidInitialPositionRecipient.selector, address(unrecognized)
            )
        );
        v2VaultFactory.deployOrGet(
            keccak256("v2-unrecognized-forwarder-vault"),
            ILiquidityGrowthFullRangeOracleHookV1(address(hook)),
            configuration
        );
    }

    /// @dev This is deliberately a source-level release gate: factory membership is insufficient when the immutable
    ///      forwarder sends fees to someone other than the configured creator.
    function test_v2FactoryRejectsFactoryForwarderWhoseFeeRecipientDoesNotMatchCreator() public {
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result, PoolKey memory key,) =
            _launchV2Fixture(keccak256("v2-mismatched-forwarder-source"));
        address mismatched = address(positionForwarderFactory.deploy(keccak256("v2-mismatched-forwarder"), beneficiary));
        LiquidityGrowthFullRangeVaultV2.Configuration memory configuration =
            _configuration(result, key, mismatched, creator);

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeVaultFactoryV2.InvalidInitialPositionRecipient.selector, mismatched
            )
        );
        v2VaultFactory.deployOrGet(
            keccak256("v2-mismatched-forwarder-vault"),
            ILiquidityGrowthFullRangeOracleHookV1(address(hook)),
            configuration
        );
    }

    function test_v2WrongFactoryForwarderCannotContributeAnotherForwardersInitialPosition() public {
        (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 canonicalVault
        ) = _launchV2Fixture(keccak256("v2-position-owner-source"));
        (uint256 canonicalDepth,) = canonicalVault.trustedDepthAndCap();
        assertGt(canonicalDepth, 0);

        address wrongForwarder = address(positionForwarderFactory.deploy(keccak256("v2-wrong-position-owner"), creator));
        LiquidityGrowthFullRangeVaultV2.Configuration memory configuration =
            _configuration(result, key, wrongForwarder, creator);
        LiquidityGrowthFullRangeVaultV2 wrongVault = v2VaultFactory.deployOrGet(
            keccak256("v2-wrong-position-vault"), ILiquidityGrowthFullRangeOracleHookV1(address(hook)), configuration
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeVaultV2.InvalidInitialPosition.selector, result.positionTokenId
            )
        );
        wrongVault.trustedDepthAndCap();
    }

    function test_v2OnlyPoolManagerCanEnterCallbacksOrSendNativeNormally() public {
        (,, LiquidityGrowthFullRangeVaultV2 vault) = _launchV2Fixture(keccak256("v2-callback-authentication"));

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeLaunchV2.UnauthorizedUnlockCallback.selector, address(this))
        );
        v2Launcher.unlockCallback("");

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV2.UnauthorizedUnlockCallback.selector, address(this))
        );
        vault.unlockCallback("");

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV2.UnauthorizedNativeSender.selector, address(this))
        );
        payable(address(vault)).transfer(1 wei);
    }

    function test_v2ForcedEthAndTokensAreExcludedFromGrowthAccountingAndCannotSubsidizeLaunch() public {
        uint256 forcedLauncherEth = 0.5 ether;
        vm.deal(address(v2Launcher), forcedLauncherEth);
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,, LiquidityGrowthFullRangeVaultV2 vault) =
            _launchV2Fixture(keccak256("v2-forced-assets"));
        assertEq(address(v2Launcher).balance, forcedLauncherEth);

        uint256 forcedVaultEth = 0.25 ether;
        vm.deal(address(vault), forcedVaultEth);
        vm.prank(creator);
        assertTrue(IERC20(result.token).transfer(address(vault), 1 ether));

        assertEq(vault.pendingGrowthNative(), 0);
        assertEq(vault.totalNativeAllocatedToGrowth(), 0);
        assertEq(vault.totalNativeAddedToLiquidity(), 0);
        assertEq(address(vault).balance, forcedVaultEth);
        assertEq(IERC20(result.token).balanceOf(address(vault)), vault.tokenReserveTarget() + 1 ether);
        (LiquidityGrowthFullRangeVaultV2.WorkAction action,,,,,) = vault.workState();
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeVaultV2.WorkAction.None));

        vm.expectRevert(LiquidityGrowthFullRangeVaultV2.NoGrowthFunds.selector);
        vault.compoundPending();
        assertEq(address(vault).balance, forcedVaultEth);
    }

    function test_v2FailedPoolManagerSettlementRollsBackEveryGrowthAndExposureWrite() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) =
            _launchV2Fixture(keccak256("v2-settlement-rollback"));
        _stageV2Oracle(address(vault));
        _matureV2Oracle(key);
        (, uint256 depthCap) = vault.trustedDepthAndCap();
        assertGe(depthCap, vault.MIN_COMPOUND_NATIVE());

        stdstore.target(address(vault)).sig("totalCreatorFeesReceived()").checked_write(depthCap);
        stdstore.target(address(vault)).sig("totalNativeAllocatedToGrowth()").checked_write(depthCap);
        stdstore.target(address(vault)).sig("pendingGrowthNative()").checked_write(depthCap);
        vm.deal(address(vault), 0);

        uint256 pendingBefore = vault.pendingGrowthNative();
        uint256 addedBefore = vault.totalNativeAddedToLiquidity();
        uint256 exposureBefore = vault.rollingWindowNativeAdded();
        uint256 timestampBefore = vault.lastCompoundTimestamp();
        uint128 liquidityBefore = vault.lockedLiquidity();

        vm.expectRevert();
        vault.compoundPending();

        assertEq(vault.pendingGrowthNative(), pendingBefore);
        assertEq(vault.totalNativeAddedToLiquidity(), addedBefore);
        assertEq(vault.rollingWindowNativeAdded(), exposureBefore);
        assertEq(vault.lastCompoundTimestamp(), timestampBefore);
        assertEq(vault.lockedLiquidity(), liquidityBefore);
    }

    function test_v2InitialNftRemainsLockedAndEveryGrowthCompoundAddsOnlyToOneVaultPosition() public {
        (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 vault
        ) = _launchV2Fixture(keccak256("v2-add-only-custody"));
        uint128 initialNftLiquidity = positionManager.getPositionLiquidity(result.positionTokenId);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));

        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        vm.expectRevert();
        forwarder.approveOperator();

        _seedV2CreatorFees(key, 1 ether);
        vault.process();
        _stageV2Oracle(address(vault));
        _matureV2Oracle(key);
        LiquidityGrowthFullRangeVaultV2.CompoundResult memory compounded = vault.compoundPending();
        assertGt(compounded.liquidityAdded, 0);

        (uint128 managerLockedLiquidity,,) = manager.getPositionInfo(
            PoolId.wrap(result.poolId),
            address(vault),
            vault.FULL_RANGE_TICK_LOWER(),
            vault.FULL_RANGE_TICK_UPPER(),
            vault.LOCKED_POSITION_SALT()
        );
        assertEq(managerLockedLiquidity, compounded.liquidityAdded);
        assertEq(vault.lockedLiquidity(), managerLockedLiquidity);
        assertEq(vault.totalLiquidityAdded(), managerLockedLiquidity);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(positionManager.getPositionLiquidity(result.positionTokenId), initialNftLiquidity);

        forwarder.collectFees(result.positionTokenId);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(positionManager.getPositionLiquidity(result.positionTokenId), initialNftLiquidity);

        (bool removeSucceeded,) = address(vault).call(abi.encodeWithSignature("removeLiquidity(uint128)", uint128(1)));
        (bool rescueSucceeded,) = address(vault).call(abi.encodeWithSignature("rescue(address,uint256)", creator, 1));
        assertFalse(removeSucceeded);
        assertFalse(rescueSucceeded);
    }

    function test_v2ReserveUnderfundingRollsBackTheCreatorFeePull() public {
        (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 vault
        ) = _launchV2Fixture(keccak256("v2-reserve-underfunded"));
        _seedV2CreatorFees(key, 0.1 ether);
        uint256 hookFeesBefore = _creatorFees(result.poolId);
        assertGt(hookFeesBefore, 0);

        deal(result.token, address(vault), vault.tokenReserveTarget() - 1, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeVaultV2.ReserveUnderfunded.selector,
                vault.tokenReserveTarget() - 1,
                vault.tokenReserveTarget()
            )
        );
        vault.process();

        assertEq(_creatorFees(result.poolId), hookFeesBefore);
        assertEq(vault.totalCreatorFeesReceived(), 0);
        assertEq(vault.pendingGrowthNative(), 0);
    }

    function test_v2RevertingCreatorPayoutCannotCorruptClaimAccounting() public {
        (,, LiquidityGrowthFullRangeVaultV2 vault) = _launchV2Fixture(keccak256("v2-reverting-payout"));
        uint256 rewards = 1 ether;
        vm.deal(address(vault), rewards);
        stdstore.target(address(vault)).sig("totalRewardFeesReceived()").checked_write(rewards);
        RevertingDeepV2Payout revertingPayout = new RevertingDeepV2Payout();

        vm.prank(creator);
        vault.setPayoutAddress(address(revertingPayout));
        vm.prank(creator);
        vm.expectRevert();
        vault.claimRewards();

        assertEq(vault.claimedBy(creator), 0);
        assertEq(vault.totalRewardFeesClaimed(), 0);
        assertEq(vault.claimable(creator), rewards);
        assertEq(address(vault).balance, rewards);
    }

    function test_v2KeeperMixedInvalidAndReadyCandidatesAreFailureIsolated() public {
        (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 vault
        ) = _launchV2Fixture(keccak256("v2-keeper-mixed"));
        assertEq(
            uint8(v2Automation.checkVault(address(vault))), uint8(LiquidityGrowthFullRangeAutomationV2.Action.None)
        );
        (bool noActionSucceeded, LiquidityGrowthFullRangeAutomationV2.Action noAction) =
            v2Automation.performVault(address(vault));
        assertFalse(noActionSucceeded);
        assertEq(uint8(noAction), uint8(LiquidityGrowthFullRangeAutomationV2.Action.None));

        _seedV2CreatorFees(key, 1 ether);
        address[] memory candidates = new address[](2);
        candidates[0] = address(0xbeef);
        candidates[1] = address(vault);
        (uint256 attempted, uint256 succeeded) = v2Automation.performBatch(candidates);

        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        (,, uint16 cardinalityNext) = hook.stateById(PoolId.wrap(result.poolId));
        assertEq(cardinalityNext, 18);
        assertTrue(v2Automation.isRegisteredVault(address(vault)));
    }

    function test_v2KeeperDoesNotTreatCooldownAsFailureOrConsumeState() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) =
            _launchV2Fixture(keccak256("v2-keeper-cooldown"));
        _seedV2CreatorFees(key, 1 ether);
        vault.process();
        _stageV2Oracle(address(vault));
        _matureV2Oracle(key);
        vault.compoundPending();

        uint256 pendingBefore = vault.pendingGrowthNative();
        uint256 exposureBefore = vault.rollingWindowNativeAdded();
        uint256 lastCompound = vault.lastCompoundTimestamp();
        (bool succeeded, LiquidityGrowthFullRangeAutomationV2.Action action) = v2Automation.performVault(address(vault));

        assertFalse(succeeded);
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeAutomationV2.Action.None));
        assertEq(vault.pendingGrowthNative(), pendingBefore);
        assertEq(vault.rollingWindowNativeAdded(), exposureBefore);
        assertEq(vault.lastCompoundTimestamp(), lastCompound);
    }

    function test_v2StressEnvelopeAcceptsTheBoundaryAndRejectsOneTickAbove() public {
        uint160 atStress = TickMath.getSqrtPriceAtTick(Policy.STRESS_TICK);
        uint160 aboveStress = TickMath.getSqrtPriceAtTick(Policy.STRESS_TICK + 1);

        assertTrue(policyHarness.priceWithinEnvelope(atStress));
        assertFalse(policyHarness.priceWithinEnvelope(aboveStress));
        vm.expectPartialRevert(Policy.PriceOutsideReserveEnvelope.selector);
        policyHarness.pairingTokenBudget(aboveStress, 0.01 ether);
    }

    function testFuzz_v2FixedReserveCoversEveryRemainingTargetAtStress(uint256 remainingNative) public view {
        remainingNative = bound(remainingNative, 0, Policy.GROWTH_TARGET_NATIVE);
        assertLe(policyHarness.requiredReserveAtStress(remainingNative), Policy.TOKEN_RESERVE_TARGET);
    }

    function testFuzz_v2EveryAcceptedSpotBudgetFitsTheStressReserve(int256 rawTick, uint256 nativeAmount) public view {
        int256 boundedTick = bound(rawTick, int256(Policy.FULL_RANGE_TICK_LOWER), int256(Policy.STRESS_TICK));
        nativeAmount = bound(nativeAmount, 1, Policy.GROWTH_TARGET_NATIVE);
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(int24(boundedTick));

        uint256 currentBudget = policyHarness.pairingTokenBudget(sqrtPriceX96, nativeAmount);
        uint256 stressBudget = policyHarness.requiredReserveAtStress(nativeAmount);
        assertLe(currentBudget, stressBudget);
    }

    function _configuration(
        LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
        PoolKey memory key,
        address initialPositionRecipient,
        address configuredCreator
    ) private view returns (LiquidityGrowthFullRangeVaultV2.Configuration memory configuration) {
        configuration = LiquidityGrowthFullRangeVaultV2.Configuration({
            poolKey: key,
            oracleGuard: LiquidityGrowthRangeSourceV1(result.oracleGuard),
            positionManager: positionManager,
            positionForwarderFactory: positionForwarderFactory,
            initialPositionTokenId: result.positionTokenId,
            initialPositionRecipient: initialPositionRecipient,
            creator: configuredCreator
        });
    }

    function _absoluteTickDifference(int24 a, int24 b) private pure returns (uint256 difference) {
        int256 signed = int256(a) - int256(b);
        difference = uint256(signed < 0 ? -signed : signed);
    }
}
