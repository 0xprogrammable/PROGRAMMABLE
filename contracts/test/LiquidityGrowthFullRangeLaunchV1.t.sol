// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { LiquidityGrowthFullRangeAutomationV1 } from "../src/LiquidityGrowthFullRangeAutomationV1.sol";
import { LiquidityGrowthFullRangeLaunchV1 } from "../src/LiquidityGrowthFullRangeLaunchV1.sol";
import { LiquidityGrowthFullRangePolicyV1 as Policy } from "../src/LiquidityGrowthFullRangePolicyV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "../src/LiquidityGrowthFullRangeVaultV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "../src/interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";
import { LiquidityGrowthFullRangeFixture } from "./utils/LiquidityGrowthFullRangeFixture.sol";

contract LiquidityGrowthFullRangePolicyHarness {
    function tokensRequiredForNative(uint160 sqrtPriceX96, uint256 nativeAmount) external pure returns (uint256) {
        return Policy.tokensRequiredForNative(sqrtPriceX96, nativeAmount);
    }

    function requiredReserveAtStress(uint256 remainingNativeTarget) external pure returns (uint256) {
        return Policy.requiredReserveAtStress(remainingNativeTarget);
    }

    function requiredReserveAtLaunch() external pure returns (uint256) {
        return Policy.requiredReserveAtLaunch();
    }

    function validate() external pure {
        Policy.validateFixedPolicy();
    }
}

contract LiquidityGrowthFullRangeLaunchV1Test is LiquidityGrowthFullRangeFixture {
    LiquidityGrowthFullRangePolicyHarness internal policyHarness;

    function setUp() public override {
        super.setUp();
        policyHarness = new LiquidityGrowthFullRangePolicyHarness();
    }

    function test_launchAtomicallyBindsFixedPolicyAndPermanentCustody() public {
        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 vault
        ) = _launchFullRange(bytes32("atomic"));

        UERC20 token = UERC20(result.token);
        assertEq(token.creator(), address(fullRangeLauncher));
        assertEq(token.totalSupply(), fullRangeLauncher.TOKEN_SUPPLY());
        assertEq(token.balanceOf(address(vault)), fullRangeLauncher.TOKEN_RESERVE_TARGET());
        assertEq(token.balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(token.balanceOf(address(fullRangeLauncher)), 0);
        assertEq(token.balanceOf(address(positionManager)), 0);
        assertEq(
            fullRangeLauncher.TOKEN_RESERVE_TARGET() + result.tokenLiquidityAmount + result.lockedTokenDust,
            fullRangeLauncher.TOKEN_SUPPLY()
        );

        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(vault.poolId(), result.poolId);
        assertEq(vault.token(), result.token);
        assertEq(address(vault.feeHook()), address(hook));
        assertEq(address(vault.poolManager()), address(manager));
        assertEq(address(vault.positionManager()), address(positionManager));
        assertEq(vault.initialPositionTokenId(), result.positionTokenId);
        assertEq(vault.initialPositionRecipient(), result.positionRecipient);
        assertEq(vault.growthTargetNative(), 0.05 ether);
        assertEq(vault.tokenReserveTarget(), 150_000_000 ether);
        assertEq(vault.FULL_RANGE_TICK_LOWER(), -887_200);
        assertEq(vault.FULL_RANGE_TICK_UPPER(), 887_200);
        assertEq(vault.COMPOUND_COOLDOWN_SECONDS(), 30 minutes);
        assertEq(vault.beneficiaryAt(0), creator);
        assertEq(vault.beneficiaryAt(1), beneficiary);
        assertEq(vault.shareBpsOf(creator), 7000);
        assertEq(vault.shareBpsOf(beneficiary), 3000);
        assertEq(vault.configurationHash(), result.vaultConfigurationHash);
        assertEq(fullRangeVaultFactory.configurationHashOf(address(vault)), result.vaultConfigurationHash);
        assertEq(fullRangeLauncher.launchHashOf(result.token), result.launchHash);
        assertEq(fullRangeLauncher.growthVaultOf(result.token), address(vault));

        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        assertEq(IERC20(result.token).balanceOf(result.positionRecipient), result.lockedTokenDust);
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();

        LiquidityGrowthRangeSourceV1 guard = LiquidityGrowthRangeSourceV1(result.oracleGuard);
        assertEq(address(guard.poolManager()), address(manager));
        assertEq(address(guard.oracleHook()), address(hook));
        assertEq(guard.poolId(), result.poolId);
        assertEq(guard.twapWindow(), 30 minutes);
        assertEq(guard.maxSpotTwapDeviationTicks(), 600);
        assertTrue(fullRangeAutomation.isRegisteredVault(address(vault)));
        assertEq(fullRangeAutomation.registeredVaultCount(), 1);
        assertEq(fullRangeAutomation.registeredVaultAt(0), address(vault));
        (address rewardVault,, uint16 buyFee, uint16 sellFee, bool registered,) = hook.poolFeeConfig(result.poolId);
        assertTrue(registered);
        assertEq(rewardVault, result.upstreamRewardVault);
        assertEq(buyFee, 200);
        assertEq(sellFee, 500);
        (, uint16 cardinality, uint16 cardinalityNext) = hook.stateById(PoolId.wrap(result.poolId));
        assertEq(cardinality, 1);
        assertEq(cardinalityNext, 2);
    }

    function test_processQueuesFeesUntilOracleMaturesThenCompoundsOneCompleteSafeChunk() public {
        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 vault
        ) = _launchFullRange(bytes32("safe-chunk"));
        _seedFullRangeCreatorFees(key, 0.25 ether);

        (uint256 received, LiquidityGrowthFullRangeVaultV1.CompoundResult memory notCompounded) = vault.process();
        assertGt(received, 0);
        assertEq(notCompounded.nativeBudget, 0);
        assertGt(vault.pendingGrowthNative(), 0);
        assertEq(vault.totalNativeAddedToLiquidity(), 0);

        _stageFullRangeOracle(address(vault));
        _matureFullRangeOracle(key);
        (, uint256 safeDepthCap) = vault.trustedDepthAndCap();
        assertGt(safeDepthCap, vault.MIN_COMPOUND_NATIVE());
        assertGe(vault.pendingGrowthNative(), safeDepthCap);

        (LiquidityGrowthFullRangeVaultV1.WorkAction action,,,,,) = vault.workState();
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeVaultV1.WorkAction.Compound));

        LiquidityGrowthFullRangeVaultV1.CompoundResult memory compounded = vault.compoundPending();
        assertEq(compounded.nativeBudget, safeDepthCap);
        assertGt(compounded.liquidityAdded, 0);
        assertGt(compounded.nativeAdded, 0);
        assertGt(compounded.tokenAdded, 0);
        assertEq(vault.lockedLiquidity(), compounded.liquidityAdded);
        assertEq(vault.totalLiquidityAdded(), compounded.liquidityAdded);
        assertEq(vault.lastCompoundTimestamp(), block.timestamp);
        assertEq(result.growthVault, address(vault));
    }

    function test_onlyLauncherCanRegisterVaultWithAutomation() public {
        (,, LiquidityGrowthFullRangeVaultV1 vault) = _launchFullRange(bytes32("automation-auth"));

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeAutomationV1.UnauthorizedLauncher.selector, address(this))
        );
        fullRangeAutomation.registerAndStageOracle(address(vault));
    }

    function test_automationAggregatesOnlyReadyVaultsAcrossBoundedBatchAndRegistryScan() public {
        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory firstResult,
            PoolKey memory firstKey,
            LiquidityGrowthFullRangeVaultV1 firstVault
        ) = _launchFullRange(bytes32("aggregate-ready-first"));
        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory secondResult,
            PoolKey memory secondKey,
            LiquidityGrowthFullRangeVaultV1 secondVault
        ) = _launchFullRange(bytes32("aggregate-ready-second"));
        (,, LiquidityGrowthFullRangeVaultV1 idleVault) = _launchFullRange(bytes32("aggregate-ready-idle"));

        _seedFullRangeCreatorFees(firstKey, 0.25 ether);
        _seedFullRangeCreatorFees(secondKey, 0.25 ether);

        address[] memory candidates = new address[](4);
        candidates[0] = address(firstVault);
        candidates[1] = address(0xbeef);
        candidates[2] = address(secondVault);
        candidates[3] = address(idleVault);

        LiquidityGrowthFullRangeAutomationV1.Work[] memory batchReady = fullRangeAutomation.checkBatch(candidates);
        assertEq(batchReady.length, 2);
        assertEq(batchReady[0].vault, address(firstVault));
        assertEq(uint8(batchReady[0].action), uint8(LiquidityGrowthFullRangeAutomationV1.Action.GrowOracle));
        assertEq(batchReady[1].vault, address(secondVault));
        assertEq(uint8(batchReady[1].action), uint8(LiquidityGrowthFullRangeAutomationV1.Action.GrowOracle));

        (LiquidityGrowthFullRangeAutomationV1.Work[] memory scanReady, uint256 nextCursor) =
            fullRangeAutomation.scan(0, 3);
        assertEq(scanReady.length, 2);
        assertEq(scanReady[0].vault, address(firstVault));
        assertEq(scanReady[1].vault, address(secondVault));
        assertEq(nextCursor, 0);

        (uint256 attempted, uint256 succeeded) = fullRangeAutomation.performBatch(candidates);
        assertEq(attempted, 2);
        assertEq(succeeded, 2);
        (,, uint16 firstCardinalityNext) = hook.stateById(PoolId.wrap(firstResult.poolId));
        (,, uint16 secondCardinalityNext) = hook.stateById(PoolId.wrap(secondResult.poolId));
        (,, uint16 idleCardinalityNext) = hook.stateById(PoolId.wrap(idleVault.poolId()));
        assertEq(firstCardinalityNext, 18);
        assertEq(secondCardinalityNext, 18);
        assertEq(idleCardinalityNext, 2);
    }

    function test_directImplementationInitializationIsLocked() public {
        LiquidityGrowthFullRangeVaultV1 implementation =
            LiquidityGrowthFullRangeVaultV1(payable(fullRangeVaultFactory.implementation()));
        LiquidityGrowthFullRangeVaultV1.Configuration memory empty;
        ILiquidityGrowthFullRangeOracleHookV1 immutableHook = fullRangeLauncher.feeHook();
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV1.UnauthorizedInitializer.selector, address(this))
        );
        implementation.initialize(immutableHook, splitFactory, empty);
    }

    function test_fixedReserveCoversLaunchAndStressEnvelope() public {
        policyHarness.validate();
        assertLt(policyHarness.requiredReserveAtLaunch(), 150_000_000 ether);
        assertLt(policyHarness.requiredReserveAtStress(0.05 ether), 150_000_000 ether);
    }

    function testFuzz_stressReserveRequirementScalesLinearlyWithinFixedTarget(uint96 rawRemaining) public view {
        uint256 remaining = bound(uint256(rawRemaining), 0, 0.05 ether);
        uint256 required = policyHarness.requiredReserveAtStress(remaining);
        assertLe(required, policyHarness.requiredReserveAtStress(0.05 ether));
        assertLe(required, 150_000_000 ether);
    }

    function testFuzz_pairingBudgetNeverExceedsStressRequirementBelowStressTick(int24 rawTick, uint96 rawNative)
        public
        view
    {
        int24 tick = int24(bound(int256(rawTick), TickMath.minUsableTick(200) + 200, 218_000));
        uint256 nativeAmount = bound(uint256(rawNative), 1, 0.05 ether);
        uint256 actual = policyHarness.tokensRequiredForNative(TickMath.getSqrtPriceAtTick(tick), nativeAmount);
        uint256 stress = policyHarness.requiredReserveAtStress(nativeAmount);
        assertLe(actual, stress);
    }
}
