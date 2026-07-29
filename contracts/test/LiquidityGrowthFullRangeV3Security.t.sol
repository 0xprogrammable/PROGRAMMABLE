// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultFactoryV3 } from "../src/LiquidityGrowthFullRangeVaultFactoryV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../src/LiquidityGrowthFullRangeVaultV3.sol";
import { LiquidityGrowthZapPlannerV3 } from "../src/LiquidityGrowthZapPlannerV3.sol";
import { ILiquidityGrowthFeeOracleHookV2 } from "../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangeV3Fixture } from "./utils/LiquidityGrowthFullRangeV3Fixture.sol";

contract LiquidityGrowthFullRangeV3SecurityTest is LiquidityGrowthFullRangeV3Fixture {
    using StateLibrary for IPoolManager;

    function test_failedOraclePreflightRollsBackTheFeeClaimAndAllVaultState() public {
        uint256 growthBefore = _growthFeesAccrued();
        uint256 hookTotalBefore = v3Hook.totalNativeFeesAccrued();
        uint256 vaultNativeBefore = address(v3Vault).balance;

        vm.expectRevert();
        v3Vault.compound();

        assertEq(_growthFeesAccrued(), growthBefore);
        assertEq(v3Hook.totalNativeFeesAccrued(), hookTotalBefore);
        assertEq(address(v3Vault).balance, vaultNativeBefore);
        assertEq(v3Vault.totalGrowthETHReceived(), 0);
        assertEq(v3Vault.compoundNonce(), 0);
        assertEq(v3Vault.lockedLiquidity(), 0);
        (uint8 intentState, bytes32 intentDigest) = v3Hook.compoundIntentState(v3PoolId);
        assertEq(intentState, Policy.INTENT_EMPTY);
        assertEq(intentDigest, bytes32(0));
    }

    function test_spotManipulationBlocksCompoundingWithoutConsumingGrowthFees() public {
        _matureV3Oracle();
        _ordinaryV3Buy(0.2 ether);
        uint256 growthBefore = _growthFeesAccrued();
        uint256 hookTotalBefore = v3Hook.totalNativeFeesAccrued();
        (LiquidityGrowthFullRangeVaultV3.WorkAction action,,,,, bytes4 blockedReason) = v3Vault.workState();
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeVaultV3.WorkAction.None));
        assertEq(blockedReason, LiquidityGrowthZapPlannerV3.SpotOracleDivergence.selector);

        vm.expectRevert();
        v3Vault.compound();

        assertEq(_growthFeesAccrued(), growthBefore);
        assertEq(v3Hook.totalNativeFeesAccrued(), hookTotalBefore);
        assertEq(v3Vault.totalGrowthETHReceived(), 0);
        assertEq(v3Vault.pendingGrowthNative(), 0);
        assertEq(v3Vault.compoundNonce(), 0);
        assertEq(v3Vault.lockedLiquidity(), 0);
    }

    function test_sustainedSamePoolCaptureAndCompoundBackrunRemainLossMakingWithinRollingExposureCap() public {
        _matureV3Oracle();

        uint256[3] memory nativeInputs = [uint256(0.02 ether), 0.1 ether, 0.5 ether];
        for (uint256 index; index < nativeInputs.length; ++index) {
            uint256 baseline = vm.snapshotState();
            _assertSustainedCaptureBackrunBoundary(nativeInputs[index]);
            assertTrue(vm.revertToState(baseline));
        }
    }

    function test_forcedNativeAndUnsolicitedTokensRemainOutsideCompoundAccounting() public {
        _matureV3Oracle();
        uint256 forcedNative = 0.5 ether;
        uint256 tokenDonation = 1000 ether;
        vm.deal(address(v3Vault), forcedNative);
        assertTrue(v3Token.transfer(address(v3Vault), tokenDonation));

        LiquidityGrowthFullRangeVaultV3.CompoundResult memory result = v3Vault.compound();

        assertEq(address(v3Vault).balance, forcedNative + v3Vault.pendingGrowthNative());
        assertEq(IERC20(address(v3Token)).balanceOf(address(v3Vault)), tokenDonation + v3Vault.accountedTokenDust());
        assertEq(v3Vault.totalGrowthETHReceived(), result.growthFeesClaimed);
        assertEq(
            v3Vault.totalGrowthETHReceived(),
            v3Vault.totalNativeSwapped() + v3Vault.totalNativeAdded() + v3Vault.pendingGrowthNative()
        );
        assertEq(
            v3Vault.initialTokenDust() + v3Vault.totalTokenAcquired(),
            v3Vault.totalTokenAdded() + v3Vault.accountedTokenDust()
        );
    }

    function test_factoryCannotOverwriteAnExistingDeterministicVault() public {
        bytes32 salt = keccak256("programmable.deep.v3.fixture.vault");
        address predicted = v3VaultFactory.predict(
            salt, address(this), ILiquidityGrowthFeeOracleHookV2(address(v3Hook)), v3Key, v3InitialTokenDust
        );
        assertEq(predicted, address(v3Vault));

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeVaultFactoryV3.PredictedVaultAlreadyExists.selector, predicted
            )
        );
        v3VaultFactory.deploy(salt, ILiquidityGrowthFeeOracleHookV2(address(v3Hook)), v3Key, v3InitialTokenDust);
    }

    function test_factorySaltIsBoundToCallerPoolHookAndInitialDust() public {
        bytes32 creatorSalt = keccak256("domain-separated-deep-v3");
        address canonical = v3VaultFactory.predict(
            creatorSalt, address(this), ILiquidityGrowthFeeOracleHookV2(address(v3Hook)), v3Key, v3InitialTokenDust
        );
        address otherCaller = v3VaultFactory.predict(
            creatorSalt,
            makeAddr("frontRunner"),
            ILiquidityGrowthFeeOracleHookV2(address(v3Hook)),
            v3Key,
            v3InitialTokenDust
        );
        address otherDust = v3VaultFactory.predict(
            creatorSalt, address(this), ILiquidityGrowthFeeOracleHookV2(address(v3Hook)), v3Key, v3InitialTokenDust + 1
        );

        assertNotEq(canonical, otherCaller);
        assertNotEq(canonical, otherDust);
    }

    function test_implementationAndCloneCannotBeReinitialized() public {
        LiquidityGrowthFullRangeVaultV3.Configuration memory configuration =
            LiquidityGrowthFullRangeVaultV3.Configuration({
                poolKey: v3Key, planner: v3Planner, initialTokenDust: v3InitialTokenDust
            });
        address implementation = v3VaultFactory.implementation();

        vm.expectRevert(LiquidityGrowthFullRangeVaultV3.AlreadyInitialized.selector);
        vm.prank(address(v3VaultFactory));
        LiquidityGrowthFullRangeVaultV3(payable(implementation))
            .initialize(ILiquidityGrowthFeeOracleHookV2(address(v3Hook)), configuration);

        vm.expectRevert(LiquidityGrowthFullRangeVaultV3.AlreadyInitialized.selector);
        vm.prank(address(v3VaultFactory));
        v3Vault.initialize(ILiquidityGrowthFeeOracleHookV2(address(v3Hook)), configuration);
    }

    function test_vaultExposesNoOwnerUpgradeRescueWithdrawalOrLiquidityRemovalEntryPoint() public {
        bytes4[6] memory forbiddenSelectors = [
            bytes4(keccak256("owner()")),
            bytes4(keccak256("transferOwnership(address)")),
            bytes4(keccak256("upgradeToAndCall(address,bytes)")),
            bytes4(keccak256("rescue(address,uint256)")),
            bytes4(keccak256("withdraw()")),
            bytes4(keccak256("removeLiquidity(uint128)"))
        ];

        for (uint256 index; index < forbiddenSelectors.length; ++index) {
            (bool success,) = address(v3Vault).call(abi.encodeWithSelector(forbiddenSelectors[index]));
            assertFalse(success);
        }
    }

    function testFuzz_forcedBalancesDoNotChangeKeeperEligibility(uint96 forcedNativeSeed, uint96 tokenSeed) public {
        _matureV3Oracle();
        (
            LiquidityGrowthFullRangeVaultV3.WorkAction actionBefore,
            uint256 hookGrowthBefore,
            uint256 pendingBefore,
            uint256 nextBefore,
            uint256 capacityBefore,
            bytes4 blockedBefore
        ) = v3Vault.workState();

        uint256 forcedNative = bound(uint256(forcedNativeSeed), 0, 100 ether);
        uint256 tokenDonation = bound(uint256(tokenSeed), 0, 1_000_000 ether);
        vm.deal(address(v3Vault), forcedNative);
        if (tokenDonation != 0) {
            assertTrue(v3Token.transfer(address(v3Vault), tokenDonation));
        }

        (
            LiquidityGrowthFullRangeVaultV3.WorkAction actionAfter,
            uint256 hookGrowthAfter,
            uint256 pendingAfter,
            uint256 nextAfter,
            uint256 capacityAfter,
            bytes4 blockedAfter
        ) = v3Vault.workState();
        assertEq(uint8(actionAfter), uint8(actionBefore));
        assertEq(hookGrowthAfter, hookGrowthBefore);
        assertEq(pendingAfter, pendingBefore);
        assertEq(nextAfter, nextBefore);
        assertEq(capacityAfter, capacityBefore);
        assertEq(blockedAfter, blockedBefore);
        assertEq(PoolId.unwrap(v3Vault.poolKey().toId()), v3PoolId);
    }

    function _assertSustainedCaptureBackrunBoundary(uint256 nativeInput) private {
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = IERC20(address(v3Token)).balanceOf(address(this));

        _ordinaryV3Buy(nativeInput);
        for (uint256 write; write < 64; ++write) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            _ordinaryV3Buy(0.000_001 ether);
        }

        vm.warp(block.timestamp + Policy.TWAP_WINDOW);
        vm.roll(block.number + 150);

        (LiquidityGrowthFullRangeVaultV3.WorkAction action, uint256 hookGrowthFees, uint256 pendingNative,,,) =
            v3Vault.workState();
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeVaultV3.WorkAction.Compound));

        uint256 available = hookGrowthFees + pendingNative;
        uint256 trustedDepth = v3Vault.trustedNativeDepth();
        uint256 exposureCap = FullMath.mulDiv(trustedDepth, Policy.TRUSTED_DEPTH_CYCLE_CAP_BPS, Policy.BASIS_POINTS);
        uint256 planningBudget = available;
        if (planningBudget > Policy.MAX_COMPOUND_NATIVE) planningBudget = Policy.MAX_COMPOUND_NATIVE;
        if (planningBudget > exposureCap) planningBudget = exposureCap;

        (LiquidityGrowthZapPlannerV3.OracleQuote memory quote,) = v3Planner.plan(
            v3Key, address(v3Vault), v3Vault.compoundNonce(), planningBudget, v3Vault.accountedTokenDust()
        );
        assertLe(
            _absoluteTickDelta(quote.spotTick, quote.longTwapTick), uint24(Policy.MAX_PRE_SPOT_TWAP_DEVIATION_TICKS)
        );
        assertLe(
            _absoluteTickDelta(quote.shortTwapTick, quote.longTwapTick),
            uint24(Policy.MAX_SHORT_LONG_TWAP_DEVIATION_TICKS)
        );
        assertLe(
            _absoluteTickDelta(quote.rawLongTwapTick, quote.longTwapTick),
            uint24(Policy.MAX_RAW_TRUNCATED_TWAP_DELTA_TICKS)
        );

        LiquidityGrowthFullRangeVaultV3.CompoundResult memory result = v3Vault.compound();
        assertLe(result.rollingExposure, exposureCap);
        assertLe(result.swapNative + result.nativeAdded, exposureCap);

        uint256 acquired = IERC20(address(v3Token)).balanceOf(address(this)) - tokenBefore;
        swapRouter.swap(
            v3Key,
            SwapParams({
                zeroForOne: false, amountSpecified: -int256(acquired), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            v3SwapSettings,
            ""
        );

        assertEq(IERC20(address(v3Token)).balanceOf(address(this)), tokenBefore);
        assertLt(address(this).balance, nativeBefore);
    }

    function _absoluteTickDelta(int24 left, int24 right) private pure returns (uint24) {
        int256 delta = int256(left) - int256(right);
        if (delta < 0) delta = -delta;
        return uint24(uint256(delta));
    }
}
