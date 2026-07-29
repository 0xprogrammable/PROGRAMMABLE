// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FixedPoint96 } from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

import { LiquidityGrowthFeeOracleHookV2 } from "../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultFactoryV3 } from "../src/LiquidityGrowthFullRangeVaultFactoryV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../src/LiquidityGrowthFullRangeVaultV3.sol";
import { LiquidityGrowthFullRangeV3Fixture } from "./utils/LiquidityGrowthFullRangeV3Fixture.sol";

contract LiquidityGrowthFullRangeV3Test is LiquidityGrowthFullRangeV3Fixture {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    function test_factoryBindsOneImmutableVaultToTheExactOriginalPool() public view {
        assertEq(v3Vault.poolId(), v3PoolId);
        assertEq(PoolId.unwrap(v3Vault.poolKey().toId()), v3PoolId);
        assertEq(address(v3Vault.feeHook()), address(v3Hook));
        assertEq(address(v3Vault.poolManager()), address(manager));
        assertEq(address(v3Vault.positionManager()), address(modifyLiquidityRouter));
        assertEq(address(v3Vault.planner()), address(v3Planner));
        assertEq(v3Vault.token(), address(v3Token));
        assertEq(v3Vault.FACTORY(), address(v3VaultFactory));
        assertTrue(v3Vault.initialized());
        assertTrue(v3VaultFactory.isFactoryVault(address(v3Vault)));
        assertNotEq(v3Vault.configurationHash(), bytes32(0));
        assertEq(v3VaultFactory.configurationHashOf(address(v3Vault)), v3Vault.configurationHash());
        assertEq(v3Vault.initialTokenDust(), v3InitialTokenDust);
        assertEq(v3Vault.accountedTokenDust(), v3InitialTokenDust);
        assertEq(
            v3VaultFactory.vaultBindingHash(address(v3Vault)),
            keccak256(
                abi.encode(
                    block.chainid,
                    address(v3VaultFactory),
                    address(v3Vault),
                    address(v3Hook),
                    v3PoolId,
                    address(v3Token)
                )
            )
        );
        assertEq(v3Hook.initialPositionSaltByPool(v3PoolId), INITIAL_POSITION_SALT);
    }

    function test_trustedDepthUsesLaunchAnchoredVirtualNativeDepth() public {
        (uint160 sqrtPriceX96, int24 currentTick,,) = manager.getSlot0(PoolId.wrap(v3PoolId));
        assertLt(currentTick, Policy.INITIAL_TICK);

        bytes32 initialSalt = v3Hook.initialPositionSaltByPool(v3PoolId);
        (uint128 initialLiquidity,,) = manager.getPositionInfo(
            PoolId.wrap(v3PoolId),
            address(modifyLiquidityRouter),
            Policy.FULL_RANGE_TICK_LOWER,
            Policy.INITIAL_TICK,
            initialSalt
        );
        uint160 anchoredSqrtPriceX96 =
            sqrtPriceX96 > Policy.initialSqrtPriceX96() ? sqrtPriceX96 : Policy.initialSqrtPriceX96();
        uint256 expectedDepth = FullMath.mulDiv(
            uint256(initialLiquidity) + uint256(v3Vault.lockedLiquidity()), FixedPoint96.Q96, anchoredSqrtPriceX96
        );

        uint256 depthBefore = v3Vault.trustedNativeDepth();
        assertEq(depthBefore, expectedDepth);

        _ordinaryV3Buy(0.01 ether);
        (uint160 lowerSqrtPriceX96,,,) = manager.getSlot0(PoolId.wrap(v3PoolId));
        assertLt(lowerSqrtPriceX96, sqrtPriceX96);
        assertEq(v3Vault.trustedNativeDepth(), depthBefore);
    }

    function test_trustedDepthExcludesInitialPositionOnceItIsOutOfRange() public {
        _matureV3Oracle();
        v3Vault.compound();
        v3Token.mint(address(this), Policy.TOKEN_SUPPLY);
        uint256 tokenBalance = IERC20(address(v3Token)).balanceOf(address(this));
        assertGt(tokenBalance, 0);
        swapRouter.swap(
            v3Key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(tokenBalance),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            v3SwapSettings,
            ""
        );

        (uint160 sqrtPriceX96, int24 currentTick,,) = manager.getSlot0(PoolId.wrap(v3PoolId));
        assertGe(currentTick, Policy.INITIAL_TICK);
        uint256 expectedDepth = FullMath.mulDiv(v3Vault.lockedLiquidity(), FixedPoint96.Q96, sqrtPriceX96);
        assertEq(v3Vault.trustedNativeDepth(), expectedDepth);
    }

    function test_compoundClaimsGrowthBuysTokenAndAddsPermanentSamePoolLiquidityAtomically() public {
        _matureV3Oracle();

        uint256 growthBefore = _growthFeesAccrued();
        uint256 programmableBefore = v3Hook.launcherFeesAccrued();
        uint256 totalNativeFeesBefore = v3Hook.totalNativeFeesAccrued();
        uint256 nativeBalanceBefore = address(v3Vault).balance;
        uint256 tokenBalanceBefore = IERC20(address(v3Token)).balanceOf(address(v3Vault));
        uint128 lockedLiquidityBefore = v3Vault.lockedLiquidity();
        (uint160 sqrtPriceBefore,,,) = manager.getSlot0(PoolId.wrap(v3PoolId));
        uint256 trustedDepthBefore = v3Vault.trustedNativeDepth();
        uint256 exposureCap =
            FullMath.mulDiv(trustedDepthBefore, Policy.TRUSTED_DEPTH_CYCLE_CAP_BPS, Policy.BASIS_POINTS);

        assertGt(growthBefore, Policy.MIN_COMPOUND_NATIVE);
        assertEq(totalNativeFeesBefore, growthBefore + programmableBefore);
        LiquidityGrowthFullRangeVaultV3.CompoundResult memory result = v3Vault.compound();

        assertEq(result.growthFeesClaimed, growthBefore);
        assertGt(result.swapNative, 0);
        assertGt(result.tokenAcquired, 0);
        assertGt(result.nativeAdded, 0);
        assertGt(result.tokenAdded, 0);
        assertGt(result.liquidityAdded, 0);
        assertEq(result.preSqrtPriceX96, sqrtPriceBefore);
        assertEq(result.budgetNative, result.swapNative + result.nativeAdded + result.nativeDust);
        assertEq(tokenBalanceBefore + result.tokenAcquired, result.tokenAdded + result.tokenDust);
        assertEq(result.rollingExposure, result.swapNative + result.nativeAdded);
        assertLe(result.rollingExposure, exposureCap);

        assertEq(v3Vault.lockedLiquidity(), lockedLiquidityBefore + result.liquidityAdded);
        assertEq(v3Vault.totalGrowthETHReceived(), growthBefore);
        assertEq(v3Vault.totalNativeSwapped(), result.swapNative);
        assertEq(v3Vault.totalTokenAcquired(), result.tokenAcquired);
        assertEq(v3Vault.totalNativeAdded(), result.nativeAdded);
        assertEq(v3Vault.totalTokenAdded(), result.tokenAdded);
        assertEq(v3Vault.totalLiquidityAdded(), result.liquidityAdded);
        assertEq(address(v3Vault).balance, nativeBalanceBefore + growthBefore - result.swapNative - result.nativeAdded);
        assertEq(address(v3Vault).balance, v3Vault.pendingGrowthNative());
        assertEq(IERC20(address(v3Token)).balanceOf(address(v3Vault)), result.tokenDust);
        assertEq(v3Vault.accountedTokenDust(), result.tokenDust);

        assertEq(_growthFeesAccrued(), 0);
        assertEq(v3Hook.launcherFeesAccrued(), programmableBefore);
        assertEq(v3Hook.totalNativeFeesAccrued(), programmableBefore);
        (uint8 intentState, bytes32 intentDigest) = v3Hook.compoundIntentState(v3PoolId);
        assertEq(intentState, Policy.INTENT_EMPTY);
        assertEq(intentDigest, bytes32(0));
        assertEq(manager.currencyDelta(address(v3Vault), v3Key.currency0), 0);
        assertEq(manager.currencyDelta(address(v3Vault), v3Key.currency1), 0);
        assertEq(PoolId.unwrap(v3Vault.poolKey().toId()), v3PoolId);
    }

    function test_fiveMinuteCooldownAndRollingExposureFailClosedWithoutConsumingState() public {
        _matureV3Oracle();
        LiquidityGrowthFullRangeVaultV3.CompoundResult memory first = v3Vault.compound();
        uint256 pendingBefore = v3Vault.pendingGrowthNative();
        uint256 nonceBefore = v3Vault.compoundNonce();
        uint256 liquidityBefore = v3Vault.totalLiquidityAdded();
        uint256 nextTimestamp = block.timestamp + Policy.COMPOUND_COOLDOWN_SECONDS;

        (
            LiquidityGrowthFullRangeVaultV3.WorkAction action,,
            uint256 pendingReported,
            uint256 nextReported,,
            bytes4 blockedReason
        ) = v3Vault.workState();
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeVaultV3.WorkAction.None));
        assertEq(pendingReported, pendingBefore);
        assertEq(nextReported, nextTimestamp);
        assertEq(blockedReason, LiquidityGrowthFullRangeVaultV3.CompoundCooldown.selector);

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeVaultV3.CompoundCooldown.selector, block.timestamp, nextTimestamp
            )
        );
        v3Vault.compound();
        assertEq(v3Vault.pendingGrowthNative(), pendingBefore);
        assertEq(v3Vault.compoundNonce(), nonceBefore);
        assertEq(v3Vault.totalLiquidityAdded(), liquidityBefore);

        (uint64 recordedAt, uint128 recordedExposure) = v3Vault.exposureRecord(0);
        assertEq(recordedAt, v3Vault.lastCompoundTimestamp());
        assertEq(recordedExposure, first.rollingExposure);
        vm.warp(uint256(recordedAt) + Policy.ROLLING_EXPOSURE_WINDOW_SECONDS - 1);
        assertEq(v3Vault.rollingExposure(), first.rollingExposure);
        vm.warp(uint256(recordedAt) + Policy.ROLLING_EXPOSURE_WINDOW_SECONDS);
        assertEq(v3Vault.rollingExposure(), 0);
    }

    function test_noCallerCanRemoveLiquidityOrSendUnaccountedNative() public {
        _matureV3Oracle();
        LiquidityGrowthFullRangeVaultV3.CompoundResult memory result = v3Vault.compound();
        uint128 lockedBefore = v3Vault.lockedLiquidity();
        assertGt(lockedBefore, 0);

        vm.expectRevert();
        modifyLiquidityRouter.modifyLiquidity(
            v3Key,
            ModifyLiquidityParams({
                tickLower: Policy.FULL_RANGE_TICK_LOWER,
                tickUpper: Policy.FULL_RANGE_TICK_UPPER,
                liquidityDelta: -int256(uint256(result.liquidityAdded)),
                salt: Policy.LOCKED_POSITION_SALT
            }),
            abi.encode(Policy.COMPOUND_DOMAIN_TAG, result.digest)
        );
        assertEq(v3Vault.lockedLiquidity(), lockedBefore);

        (bool sent, bytes memory reason) = address(v3Vault).call{ value: 1 wei }("");
        assertFalse(sent);
        assertEq(bytes4(reason), LiquidityGrowthFullRangeVaultV3.UnauthorizedNativeSender.selector);
    }
}
