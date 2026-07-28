// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { StdStorage, stdStorage } from "forge-std/StdStorage.sol";

import { LiquidityGrowthFullRangeAutomationV1 } from "../src/LiquidityGrowthFullRangeAutomationV1.sol";
import { LiquidityGrowthFullRangeLaunchV1 } from "../src/LiquidityGrowthFullRangeLaunchV1.sol";
import { LiquidityGrowthFullRangePolicyV1 as Policy } from "../src/LiquidityGrowthFullRangePolicyV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "../src/LiquidityGrowthFullRangeVaultV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "../src/interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";
import { LiquidityGrowthFullRangeFixture } from "./utils/LiquidityGrowthFullRangeFixture.sol";

contract LiquidityGrowthFullRangePolicyHarness {
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

contract RevertingFullRangePayout {
    receive() external payable {
        revert();
    }
}

contract LiquidityGrowthFullRangeSecurityTest is LiquidityGrowthFullRangeFixture {
    using stdStorage for StdStorage;
    using StateLibrary for IPoolManager;

    LiquidityGrowthFullRangePolicyHarness private policyHarness;

    function setUp() public override {
        super.setUp();
        policyHarness = new LiquidityGrowthFullRangePolicyHarness();
    }

    function test_oracleRequiresAllocatedCapacityAndRealHistory() public {
        (LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,, LiquidityGrowthFullRangeVaultV1 vault) =
            _launchFullRange(keccak256("oracle-maturity"));

        (,, uint16 cardinalityNextAtLaunch) = hook.stateById(
            // The hook and vault must use the exact same immutable pool.
            // forge-lint: disable-next-line(unsafe-typecast)
            _poolId(result.poolId)
        );
        assertEq(cardinalityNextAtLaunch, 2);
        assertFalse(vault.oracleReady());

        _stageFullRangeOracle(result.growthVault);
        assertFalse(vault.oracleReady());

        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
        assertTrue(vault.oracleReady());
    }

    function test_atomicSpotMoveBeyondBreakerCannotCompound() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) =
            _launchFullRange(keccak256("atomic-spot-breaker"));
        _stageFullRangeOracle(address(vault));
        _matureFullRangeOracle(key);
        assertTrue(vault.oracleReady());

        (, int24 tickBefore,,) = manager.getSlot0(key.toId());
        swap(key, true, -int256(0.2 ether), "");
        (, int24 tickAfter,,) = manager.getSlot0(key.toId());

        assertGt(_absoluteTickDifference(tickBefore, tickAfter), 600);
        assertFalse(vault.oracleReady());
    }

    function test_sustainedSamePoolMoveCanMatureButRemainsInsideEveryFixedEconomicBound() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) =
            _launchFullRange(keccak256("sustained-same-pool-move"));
        _stageFullRangeOracle(address(vault));
        _matureFullRangeOracle(key);
        assertTrue(vault.oracleReady());

        (, int24 tickBefore,,) = manager.getSlot0(key.toId());
        swap(key, true, -int256(0.1 ether), "");
        (, int24 tickAfterAtomicMove,,) = manager.getSlot0(key.toId());
        assertGt(_absoluteTickDifference(tickBefore, tickAfterAtomicMove), 600);
        assertFalse(vault.oracleReady());

        // A same-pool TWAP is not an independent price source. If a move is sustained and the truncated
        // observation follows it over a complete window, it eventually becomes accepted history.
        _buyInSteps(key, 0.052 ether, 64);
        _waitOneTwap();
        assertTrue(vault.oracleReady());

        (uint160 acceptedSqrtPriceX96, int24 acceptedTick,,) = manager.getSlot0(key.toId());
        assertLe(acceptedTick, Policy.STRESS_TICK);
        assertTrue(policyHarness.priceWithinEnvelope(acceptedSqrtPriceX96));

        (, uint256 depthCapBefore) = vault.trustedDepthAndCap();
        (LiquidityGrowthFullRangeVaultV1.WorkAction action,,,,,) = vault.workState();
        assertEq(uint256(action), uint256(LiquidityGrowthFullRangeVaultV1.WorkAction.Process));

        (, LiquidityGrowthFullRangeVaultV1.CompoundResult memory result) = vault.process();
        assertGt(result.nativeAdded, 0);
        assertLe(result.nativeBudget, depthCapBefore);
        assertLe(result.nativeBudget, Policy.MAX_COMPOUND_NATIVE);
        assertLe(vault.totalNativeAddedToLiquidity(), Policy.GROWTH_TARGET_NATIVE);

        uint256 remainingTarget = vault.growthTargetNative() - vault.totalNativeAddedToLiquidity();
        assertGe(
            IERC20(vault.token()).balanceOf(address(vault)), policyHarness.requiredReserveAtStress(remainingTarget)
        );
    }

    function test_lowerSpotCannotInflateTrustedDepthAndExternalLiquidityIsExcluded() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) = _launchFullRange(keccak256("trusted-depth"));

        (uint256 depthBefore, uint256 capBefore) = vault.trustedDepthAndCap();
        assertGt(depthBefore, 0);
        assertGt(capBefore, 0);

        swap(key, true, -int256(0.05 ether), "");
        (uint256 depthAfterLowerSpot, uint256 capAfterLowerSpot) = vault.trustedDepthAndCap();
        assertEq(depthAfterLowerSpot, depthBefore);
        assertEq(capAfterLowerSpot, capBefore);

        uint256 externalTokenBalance = IERC20(vault.token()).balanceOf(address(this));
        assertGt(externalTokenBalance, 0);
        IERC20(vault.token()).approve(address(modifyLiquidityRouter), type(uint256).max);
        modifyLiquidityRouter.modifyLiquidity{ value: 1 ether }(
            key,
            ModifyLiquidityParams({
                tickLower: vault.FULL_RANGE_TICK_LOWER(),
                tickUpper: vault.FULL_RANGE_TICK_UPPER(),
                liquidityDelta: int256(1 ether),
                salt: keccak256("external-untrusted-liquidity")
            }),
            ZERO_BYTES
        );

        (uint256 depthAfterExternalLiquidity, uint256 capAfterExternalLiquidity) = vault.trustedDepthAndCap();
        assertEq(depthAfterExternalLiquidity, depthBefore);
        assertEq(capAfterExternalLiquidity, capBefore);
        assertEq(vault.lockedLiquidity(), 0);
    }

    function test_onlyTheFactoryForwarderThatOwnsTheInitialPositionContributesDepth() public {
        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 canonicalVault
        ) = _launchFullRange(keccak256("initial-position-binding"));

        PositionFeesForwarder canonicalForwarder = PositionFeesForwarder(payable(result.positionRecipient));
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(address(canonicalForwarder.positionManager()), address(positionManager));
        assertEq(canonicalForwarder.operator(), address(0));
        assertEq(canonicalForwarder.timelockBlockNumber(), type(uint256).max);
        assertTrue(positionForwarderFactory.configurationHashOf(result.positionRecipient) != bytes32(0));
        (uint256 canonicalDepth,) = canonicalVault.trustedDepthAndCap();
        assertGt(canonicalDepth, 0);

        address wrongForwarder =
            address(positionForwarderFactory.deploy(keccak256("wrong-initial-position-owner"), creator));
        LiquidityGrowthFullRangeLaunchV1.LaunchParameters memory parameters =
            _fullRangeParameters(keccak256("wrong-initial-position-config"));
        LiquidityGrowthFullRangeVaultV1.Configuration memory configuration =
            LiquidityGrowthFullRangeVaultV1.Configuration({
                poolKey: key,
                oracleGuard: LiquidityGrowthRangeSourceV1(result.oracleGuard),
                positionManager: positionManager,
                positionForwarderFactory: positionForwarderFactory,
                initialPositionTokenId: result.positionTokenId,
                initialPositionRecipient: wrongForwarder,
                beneficiaries: parameters.rewardBeneficiaries,
                sharesBps: parameters.rewardSharesBps
            });
        LiquidityGrowthFullRangeVaultV1 wrongVault = fullRangeVaultFactory.deployOrGet(
            keccak256("wrong-initial-position-vault"),
            ILiquidityGrowthFullRangeOracleHookV1(address(hook)),
            configuration
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeVaultV1.InvalidInitialPosition.selector, result.positionTokenId
            )
        );
        wrongVault.trustedDepthAndCap();
    }

    function test_onlyPoolManagerCanEnterLaunchAndVaultUnlockCallbacksOrFundTheVault() public {
        (,, LiquidityGrowthFullRangeVaultV1 vault) = _launchFullRange(keccak256("callback-authentication"));

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeLaunchV1.UnauthorizedUnlockCallback.selector, address(this))
        );
        fullRangeLauncher.unlockCallback("");

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV1.UnauthorizedUnlockCallback.selector, address(this))
        );
        vault.unlockCallback("");

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV1.UnauthorizedNativeSender.selector, address(this))
        );
        payable(address(vault)).transfer(1 wei);
    }

    function test_fullSafeChunkCombinesPendingAndUnclaimedFeesWithoutDustCooldownReset() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) = _launchFullRange(keccak256("full-safe-chunk"));
        _stageFullRangeOracle(address(vault));

        _buyInSteps(key, 0.1 ether, 20);
        _waitOneTwap();
        assertTrue(vault.oracleReady());
        vault.process();

        (, uint256 safeChunk) = vault.trustedDepthAndCap();
        uint256 pendingBefore = vault.pendingGrowthNative();
        assertGt(pendingBefore, 0);
        assertLt(pendingBefore, safeChunk);
        assertEq(vault.lastCompoundTimestamp(), 0);
        assertEq(vault.lockedLiquidity(), 0);

        vm.expectRevert(LiquidityGrowthFullRangeVaultV1.NoGrowthFunds.selector);
        vault.compoundPending();
        assertEq(vault.lastCompoundTimestamp(), 0);

        _buyInSteps(key, 0.052 ether, 13);
        _waitOneTwap();
        assertTrue(vault.oracleReady());

        (LiquidityGrowthFullRangeVaultV1.WorkAction action,,,,,) = vault.workState();
        assertEq(uint256(action), uint256(LiquidityGrowthFullRangeVaultV1.WorkAction.Process));

        (, LiquidityGrowthFullRangeVaultV1.CompoundResult memory result) = vault.process();
        assertEq(result.nativeBudget, safeChunk);
        assertGt(result.nativeAdded, 0);
        assertGt(result.liquidityAdded, 0);
        assertGt(vault.lastCompoundTimestamp(), 0);
        assertEq(vault.lockedLiquidity(), result.liquidityAdded);
        assertEq(vault.totalLiquidityAdded(), result.liquidityAdded);

        uint256 remainingTarget = vault.growthTargetNative() - vault.totalNativeAddedToLiquidity();
        uint256 requiredAtStress = policyHarness.requiredReserveAtStress(remainingTarget);
        uint256 currentReserve = IERC20(vault.token()).balanceOf(address(vault));
        assertGe(currentReserve, requiredAtStress);
        assertGe(currentReserve + vault.totalTokenAddedToLiquidity(), vault.tokenReserveTarget());
    }

    function test_onlyBeneficiariesCanClaimOrRedirectAndOneBadPayoutCannotBlockAnother() public {
        (,, LiquidityGrowthFullRangeVaultV1 vault) = _launchFullRange(keccak256("beneficiary-isolation"));
        uint256 rewards = 1 ether;
        vm.deal(address(vault), rewards);
        stdstore.target(address(vault)).sig("totalRewardFeesReceived()").checked_write(rewards);

        address attacker = makeAddr("fullRangeAttacker");
        address beneficiaryPayout = makeAddr("fullRangeBeneficiaryPayout");
        RevertingFullRangePayout revertingPayout = new RevertingFullRangePayout();

        assertEq(vault.claimable(creator), 0.7 ether);
        assertEq(vault.claimable(beneficiary), 0.3 ether);
        assertEq(vault.claimable(attacker), 0);

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV1.UnauthorizedBeneficiary.selector, attacker)
        );
        vault.setPayoutAddress(attacker);

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV1.UnauthorizedBeneficiary.selector, attacker)
        );
        vault.claimRewards();

        vm.prank(beneficiary);
        vault.setPayoutAddress(address(revertingPayout));
        vm.prank(beneficiary);
        vm.expectRevert();
        vault.claimRewards();
        assertEq(vault.claimedBy(beneficiary), 0);

        uint256 creatorBalanceBefore = creator.balance;
        vm.prank(creator);
        assertEq(vault.claimRewards(), 0.7 ether);
        assertEq(creator.balance - creatorBalanceBefore, 0.7 ether);

        vm.prank(beneficiary);
        vault.setPayoutAddress(beneficiaryPayout);
        vm.prank(beneficiaryPayout);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV1.UnauthorizedBeneficiary.selector, beneficiaryPayout)
        );
        vault.claimRewards();

        vm.prank(beneficiary);
        assertEq(vault.claimRewards(), 0.3 ether);
        assertEq(beneficiaryPayout.balance, 0.3 ether);
        assertEq(vault.totalRewardFeesClaimed(), rewards);
        assertEq(address(vault).balance, 0);
    }

    function test_stressEnvelopeRejectsAnyPriceAboveTheFixedBoundary() public {
        uint160 atStress = TickMath.getSqrtPriceAtTick(Policy.STRESS_TICK);
        uint160 aboveStress = TickMath.getSqrtPriceAtTick(Policy.STRESS_TICK + 1);

        assertTrue(policyHarness.priceWithinEnvelope(atStress));
        assertFalse(policyHarness.priceWithinEnvelope(aboveStress));
        vm.expectPartialRevert(Policy.PriceOutsideReserveEnvelope.selector);
        policyHarness.pairingTokenBudget(aboveStress, 0.01 ether);
    }

    function testFuzz_fixedReserveCoversEveryRemainingTargetAtStress(uint256 remainingNative) public view {
        remainingNative = bound(remainingNative, 0, Policy.GROWTH_TARGET_NATIVE);
        assertLe(policyHarness.requiredReserveAtStress(remainingNative), Policy.TOKEN_RESERVE_TARGET);
    }

    function testFuzz_everyAcceptedSpotBudgetFitsTheStressReserve(int256 rawTick, uint256 nativeAmount) public view {
        int256 boundedTick = bound(rawTick, int256(Policy.FULL_RANGE_TICK_LOWER), int256(Policy.STRESS_TICK));
        nativeAmount = bound(nativeAmount, 1, Policy.GROWTH_TARGET_NATIVE);
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(int24(boundedTick));

        uint256 currentBudget = policyHarness.pairingTokenBudget(sqrtPriceX96, nativeAmount);
        uint256 stressBudget = policyHarness.requiredReserveAtStress(nativeAmount);
        assertLe(currentBudget, stressBudget);
    }

    function _buyInSteps(PoolKey memory key, uint256 totalNative, uint256 steps) private {
        uint256 perStep = totalNative / steps;
        for (uint256 index; index < steps; index++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            swap(key, true, -int256(perStep), "");
        }
    }

    function _waitOneTwap() private {
        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
    }

    function _absoluteTickDifference(int24 a, int24 b) private pure returns (uint256 difference) {
        int256 signed = int256(a) - int256(b);
        difference = uint256(signed < 0 ? -signed : signed);
    }

    function _poolId(bytes32 raw) private pure returns (PoolId wrapped) {
        wrapped = PoolId.wrap(raw);
    }
}
