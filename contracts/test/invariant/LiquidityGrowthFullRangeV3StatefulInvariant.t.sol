// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Test } from "forge-std/Test.sol";

import { LiquidityGrowthFeeOracleHookV2 } from "../../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../../src/LiquidityGrowthFullRangeVaultV3.sol";
import { LiquidityGrowthFullRangeV3Fixture } from "../utils/LiquidityGrowthFullRangeV3Fixture.sol";

contract LiquidityGrowthFullRangeV3StatefulHandler is Test {
    struct Snapshot {
        uint256 growthAccrued;
        uint256 totalHookFees;
        uint256 pendingNative;
        uint256 growthReceived;
        uint256 nativeSwapped;
        uint256 nativeAdded;
        uint256 tokenAcquired;
        uint256 tokenAdded;
        uint256 liquidityAdded;
        uint256 rollingExposure;
        uint256 nonce;
        uint64 lastCompoundTimestamp;
    }

    LiquidityGrowthFullRangeVaultV3 public immutable vault;
    LiquidityGrowthFeeOracleHookV2 public immutable hook;
    IPoolManager public immutable manager;
    PoolSwapTest public immutable swapRouter;
    IERC20 public immutable token;

    PoolKey private _key;
    PoolSwapTest.TestSettings private _settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    bool public failedAttemptMutatedState;
    bool public feeSplitBreached;
    bool public intentLeaked;
    bool public liquidityDecreased;
    bool public rollingCapBreached;
    uint256 public successfulCompounds;
    uint256 public successfulFeeSwaps;
    uint256 public lastLockedLiquidity;
    uint256 public lastTotalLiquidity;

    constructor(
        LiquidityGrowthFullRangeVaultV3 vault_,
        LiquidityGrowthFeeOracleHookV2 hook_,
        IPoolManager manager_,
        PoolSwapTest swapRouter_,
        PoolKey memory key_
    ) {
        vault = vault_;
        hook = hook_;
        manager = manager_;
        swapRouter = swapRouter_;
        token = IERC20(vault_.token());
        _key = key_;
        token.approve(address(swapRouter_), type(uint256).max);
        lastLockedLiquidity = vault_.lockedLiquidity();
        lastTotalLiquidity = vault_.totalLiquidityAdded();
    }

    receive() external payable { }

    function seedBuy(uint96 rawAmount) external {
        uint256 amount = 0.000_001 ether + uint256(rawAmount) % (0.05 ether - 0.000_001 ether);
        if (address(this).balance < amount) return;
        (uint256 growthBefore, uint256 programmableBefore) = _cumulativeFeeSplit();
        try swapRouter.swap{ value: amount }(
            _key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            _settings,
            ""
        ) {
            _checkFeeSplit(growthBefore, programmableBefore);
        } catch { }
        _observe();
    }

    function seedSell(uint96 rawAmount) external {
        uint256 balance = token.balanceOf(address(this));
        if (balance < 1 ether) return;
        uint256 ceiling = balance < 1_000_000 ether ? balance : 1_000_000 ether;
        uint256 amount = 1 ether + uint256(rawAmount) % ceiling;
        if (amount > balance) amount = balance;
        (uint256 growthBefore, uint256 programmableBefore) = _cumulativeFeeSplit();
        try swapRouter.swap(
            _key,
            SwapParams({
                zeroForOne: false, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            _settings,
            ""
        ) {
            _checkFeeSplit(growthBefore, programmableBefore);
        } catch { }
        _observe();
    }

    function advance(uint32 rawSeconds) external {
        vm.warp(block.timestamp + 1 + uint256(rawSeconds) % (35 minutes));
        vm.roll(block.number + 1);
        _observe();
    }

    function compound() external {
        Snapshot memory beforeState = _snapshot();
        uint256 rollingBefore = vault.rollingExposure();
        (LiquidityGrowthFullRangeVaultV3.WorkAction action,,,, uint256 rollingCapacity,) = vault.workState();
        (bool succeeded,) = address(vault).call(abi.encodeCall(vault.compound, ()));
        if (!succeeded) {
            if (!_sameSnapshot(beforeState, _snapshot())) failedAttemptMutatedState = true;
        } else {
            ++successfulCompounds;
            if (
                action != LiquidityGrowthFullRangeVaultV3.WorkAction.Compound
                    || vault.rollingExposure() > rollingBefore + rollingCapacity
            ) {
                rollingCapBreached = true;
            }
        }
        _observe();
    }

    function forceNative(uint96 rawAmount) external {
        uint256 amount = uint256(rawAmount) % 10 ether;
        vm.deal(address(vault), address(vault).balance + amount);
        _observe();
    }

    function donateToken(uint96 rawAmount) external {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = uint256(rawAmount) % (balance + 1);
        if (amount != 0) token.transfer(address(vault), amount);
        _observe();
    }

    function _observe() private {
        uint256 locked = vault.lockedLiquidity();
        uint256 totalLiquidity = vault.totalLiquidityAdded();
        if (locked < lastLockedLiquidity || totalLiquidity < lastTotalLiquidity) {
            liquidityDecreased = true;
        }
        lastLockedLiquidity = locked;
        lastTotalLiquidity = totalLiquidity;

        (uint8 intentState, bytes32 intentDigest) = hook.compoundIntentState(vault.poolId());
        if (intentState != Policy.INTENT_EMPTY || intentDigest != bytes32(0)) {
            intentLeaked = true;
        }
    }

    function _snapshot() private view returns (Snapshot memory state) {
        (,,, state.growthAccrued) = hook.poolFeeConfig(vault.poolId());
        state.totalHookFees = hook.totalNativeFeesAccrued();
        state.pendingNative = vault.pendingGrowthNative();
        state.growthReceived = vault.totalGrowthETHReceived();
        state.nativeSwapped = vault.totalNativeSwapped();
        state.nativeAdded = vault.totalNativeAdded();
        state.tokenAcquired = vault.totalTokenAcquired();
        state.tokenAdded = vault.totalTokenAdded();
        state.liquidityAdded = vault.totalLiquidityAdded();
        state.rollingExposure = vault.rollingExposure();
        state.nonce = vault.compoundNonce();
        state.lastCompoundTimestamp = vault.lastCompoundTimestamp();
    }

    function _sameSnapshot(Snapshot memory left, Snapshot memory right) private pure returns (bool) {
        return left.growthAccrued == right.growthAccrued && left.totalHookFees == right.totalHookFees
            && left.pendingNative == right.pendingNative && left.growthReceived == right.growthReceived
            && left.nativeSwapped == right.nativeSwapped && left.nativeAdded == right.nativeAdded
            && left.tokenAcquired == right.tokenAcquired && left.tokenAdded == right.tokenAdded
            && left.liquidityAdded == right.liquidityAdded && left.rollingExposure == right.rollingExposure
            && left.nonce == right.nonce && left.lastCompoundTimestamp == right.lastCompoundTimestamp;
    }

    function _cumulativeFeeSplit() private view returns (uint256 growth, uint256 programmable) {
        (,,, uint256 accrued) = hook.poolFeeConfig(vault.poolId());
        growth = accrued + vault.totalGrowthETHReceived();
        programmable = hook.launcherFeesAccrued();
    }

    function _checkFeeSplit(uint256 growthBefore, uint256 programmableBefore) private {
        (uint256 growthAfter, uint256 programmableAfter) = _cumulativeFeeSplit();
        uint256 growthDelta = growthAfter - growthBefore;
        uint256 programmableDelta = programmableAfter - programmableBefore;
        if (growthDelta == 0 && programmableDelta == 0) return;
        ++successfulFeeSwaps;
        if (programmableDelta == 0 || growthDelta < programmableDelta * 9 || growthDelta > programmableDelta * 9 + 9) {
            feeSplitBreached = true;
        }
    }
}

contract LiquidityGrowthFullRangeV3StatefulInvariantTest is LiquidityGrowthFullRangeV3Fixture {
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    LiquidityGrowthFullRangeV3StatefulHandler internal handler;
    bytes32 internal initialConfigurationHash;

    function setUp() public override {
        super.setUp();
        _matureV3Oracle();
        initialConfigurationHash = v3Vault.configurationHash();
        handler = new LiquidityGrowthFullRangeV3StatefulHandler(v3Vault, v3Hook, manager, swapRouter, v3Key);
        vm.deal(address(handler), 100 ether);

        uint256 inventory = v3Token.balanceOf(address(this));
        if (inventory != 0) {
            assertTrue(v3Token.transfer(address(handler), inventory / 2));
        }

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = LiquidityGrowthFullRangeV3StatefulHandler.seedBuy.selector;
        selectors[1] = LiquidityGrowthFullRangeV3StatefulHandler.seedSell.selector;
        selectors[2] = LiquidityGrowthFullRangeV3StatefulHandler.advance.selector;
        selectors[3] = LiquidityGrowthFullRangeV3StatefulHandler.compound.selector;
        selectors[4] = LiquidityGrowthFullRangeV3StatefulHandler.forceNative.selector;
        selectors[5] = LiquidityGrowthFullRangeV3StatefulHandler.donateToken.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_everyGrowthWeiAndTokenHasExactlyOneAccountingDestination() public view {
        assertEq(
            v3Vault.totalGrowthETHReceived(),
            v3Vault.totalNativeSwapped() + v3Vault.totalNativeAdded() + v3Vault.pendingGrowthNative()
        );
        assertEq(
            v3Vault.initialTokenDust() + v3Vault.totalTokenAcquired(),
            v3Vault.totalTokenAdded() + v3Vault.accountedTokenDust()
        );
        assertGe(address(v3Vault).balance, v3Vault.pendingGrowthNative());
        assertGe(v3Token.balanceOf(address(v3Vault)), v3Vault.accountedTokenDust());
    }

    function invariant_feeClaimsAndFixedNinetyTenSplitRemainConserved() public view {
        (,,, uint256 growthAccrued) = v3Hook.poolFeeConfig(v3PoolId);
        assertEq(v3Hook.totalNativeFeesAccrued(), growthAccrued + v3Hook.launcherFeesAccrued());
        assertEq(
            manager.balanceOf(address(v3Hook), CurrencyLibrary.ADDRESS_ZERO.toId()), v3Hook.totalNativeFeesAccrued()
        );
        assertFalse(handler.feeSplitBreached());
    }

    function invariant_liquidityIsAddOnlyAndBoundToTheOriginalPool() public view {
        assertFalse(handler.liquidityDecreased());
        assertEq(v3Vault.lockedLiquidity(), v3Vault.totalLiquidityAdded());
        assertEq(v3Vault.poolId(), v3PoolId);
        assertEq(v3Vault.configurationHash(), initialConfigurationHash);
        assertTrue(v3VaultFactory.isFactoryVault(address(v3Vault)));
    }

    function invariant_failedWorkConsumesNothingAndSuccessfulWorkRespectsTheRollingCap() public view {
        assertFalse(handler.failedAttemptMutatedState());
        assertFalse(handler.rollingCapBreached());
    }

    function invariant_compoundIntentAndPoolManagerDeltasAlwaysClose() public view {
        assertFalse(handler.intentLeaked());
        (uint8 intentState, bytes32 intentDigest) = v3Hook.compoundIntentState(v3PoolId);
        assertEq(intentState, Policy.INTENT_EMPTY);
        assertEq(intentDigest, bytes32(0));
        assertEq(manager.currencyDelta(address(v3Vault), v3Key.currency0), 0);
        assertEq(manager.currencyDelta(address(v3Vault), v3Key.currency1), 0);
        assertEq(manager.currencyDelta(address(handler), v3Key.currency0), 0);
        assertEq(manager.currencyDelta(address(handler), v3Key.currency1), 0);
    }
}
