// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";
import { Test } from "forge-std/Test.sol";

import { FeeSplitVaultFactoryV1 } from "../../src/FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../../src/LiquidityGrowthRangeSourceV1.sol";
import { LiquidityGrowthVaultFactoryV1 } from "../../src/LiquidityGrowthVaultFactoryV1.sol";
import { LiquidityGrowthVaultV1 } from "../../src/LiquidityGrowthVaultV1.sol";
import { ILiquidityGrowthOracleV1 } from "../../src/interfaces/ILiquidityGrowthOracleV1.sol";

contract LiquidityGrowthInvariantToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Liquidity Growth Invariant", "GROWI", 18) {
        creator = creator_;
    }
}

contract LiquidityGrowthHandler is Test {
    using SafeCast for uint256;

    PoolSwapTest internal immutable router;
    PoolKey internal growthKey;
    LiquidityGrowthVaultV1 internal immutable vault;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    constructor(PoolSwapTest router_, PoolKey memory growthKey_, LiquidityGrowthVaultV1 vault_) payable {
        router = router_;
        growthKey = growthKey_;
        vault = vault_;
    }

    function buy(uint96 rawAmount) external {
        uint256 amount = 0.001 ether + (uint256(rawAmount) % 0.2 ether);
        if (address(this).balance < amount) return;
        vm.warp(block.timestamp + 1 minutes);
        router.swap{ value: amount }(
            growthKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -amount.toInt256(), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function process() external {
        vault.process();
    }

    function compoundPending() external {
        vm.warp(block.timestamp + vault.compoundCooldownSeconds());
        vault.compoundPending();
    }

    receive() external payable { }
}

contract LiquidityGrowthVaultV1InvariantTest is Deployers {
    uint256 internal constant GROWTH_TARGET = 0.05 ether;
    uint256 internal constant MAX_COMPOUND = 0.01 ether;
    uint256 internal constant TOKEN_RESERVE = 10_000 ether;
    int24 internal constant RANGE_HALF_WIDTH = 10_000;
    int24 internal constant MAX_SPOT_TWAP_DEVIATION = 1000;
    int24 internal constant MAX_ABS_TICK_DELTA = 5;
    uint32 internal constant TWAP_WINDOW = 30 minutes;
    uint64 internal constant COMPOUND_COOLDOWN = 1;

    LiquidityGrowthFeeOracleHookV1 internal hook;
    LiquidityGrowthRangeSourceV1 internal rangeSource;
    LiquidityGrowthVaultV1 internal vault;
    LiquidityGrowthInvariantToken internal token;
    LiquidityGrowthHandler internal handler;
    PoolKey internal growthKey;
    bytes32 internal poolId;
    address internal treasury;
    address internal beneficiary;

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);
        treasury = makeAddr("treasury");
        beneficiary = makeAddr("beneficiary");

        FeeSplitVaultFactoryV1 splitFactory = new FeeSplitVaultFactoryV1();
        LiquidityGrowthFeeOracleHookFactoryV1 hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(manager, treasury, splitFactory, MAX_ABS_TICK_DELTA)
        );
        hook = hookFactory.deploy(hookSalt, manager, treasury, splitFactory, MAX_ABS_TICK_DELTA);

        token = new LiquidityGrowthInvariantToken(address(this));
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        growthKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 0,
            tickSpacing: 200,
            hooks: hook
        });
        poolId = PoolId.unwrap(growthKey.toId());
        rangeSource = new LiquidityGrowthRangeSourceV1(
            manager,
            growthKey,
            ILiquidityGrowthOracleV1(address(hook)),
            TWAP_WINDOW,
            RANGE_HALF_WIDTH,
            MAX_SPOT_TWAP_DEVIATION
        );

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = beneficiary;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        LiquidityGrowthVaultV1.Configuration memory configuration = LiquidityGrowthVaultV1.Configuration({
            poolKey: growthKey,
            rangeSource: rangeSource,
            growthTargetNative: GROWTH_TARGET,
            maxCompoundNative: MAX_COMPOUND,
            tokenReserveTarget: TOKEN_RESERVE,
            activeRangeHalfWidthTicks: RANGE_HALF_WIDTH,
            compoundCooldownSeconds: COMPOUND_COOLDOWN,
            beneficiaries: beneficiaries,
            sharesBps: shares
        });
        LiquidityGrowthVaultFactoryV1 growthFactory = new LiquidityGrowthVaultFactoryV1();
        vault = growthFactory.deployOrGet(bytes32("invariant"), hook, splitFactory, configuration);
        assertTrue(token.transfer(address(vault), TOKEN_RESERVE));

        hook.registerPool(growthKey, address(vault.upstreamVault()), 100, 100);
        manager.initialize(growthKey, SQRT_PRICE_1_1);
        hook.increaseObservationCardinalityNext(192, PoolId.wrap(poolId));
        LIQUIDITY_PARAMS =
            ModifyLiquidityParams({ tickLower: -20_000, tickUpper: 20_000, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(growthKey, LIQUIDITY_PARAMS, ZERO_BYTES);
        vm.warp(block.timestamp + TWAP_WINDOW);

        handler = new LiquidityGrowthHandler{ value: 1000 ether }(swapRouter, growthKey, vault);
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = LiquidityGrowthHandler.buy.selector;
        selectors[1] = LiquidityGrowthHandler.process.selector;
        selectors[2] = LiquidityGrowthHandler.compoundPending.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_growthTargetAndRoutingConserveAllCreatorFees() public view {
        assertLe(vault.totalNativeAllocatedToGrowth(), GROWTH_TARGET);
        if (vault.growthTargetReached()) {
            assertEq(vault.totalNativeAllocatedToGrowth(), GROWTH_TARGET);
            assertGe(vault.totalNativeAddedToLiquidity(), vault.minimumNativeLiquidityForCompletion());
            assertLe(vault.nativeLiquidityShortfallAtCompletion(), vault.completionToleranceNative());
        }
        assertEq(
            vault.totalNativeAddedToLiquidity() + vault.pendingGrowthNative(),
            vault.totalNativeAllocatedToGrowth() + vault.totalNativeRecycled()
        );
        assertEq(
            vault.totalNativeAllocatedToGrowth() + vault.deferredRewardFees() + vault.totalRewardFeesReceived(),
            vault.totalCreatorFeesReceived()
        );
        assertLe(vault.totalRewardFeesClaimed(), vault.totalRewardFeesReceived());
    }

    function invariant_tokenReserveCanOnlyMoveIntoLockedLiquidity() public view {
        assertEq(
            token.balanceOf(address(vault)) + vault.totalTokenAddedToLiquidity(),
            TOKEN_RESERVE + vault.totalTokenRecycled()
        );
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(address(hook).balance, 0);
    }

    function invariant_vaultNativeBalanceCoversEveryPendingObligation() public view {
        uint256 unclaimedRewards = vault.totalRewardFeesReceived() - vault.totalRewardFeesClaimed();
        uint256 accountedBalance = vault.pendingGrowthNative() + vault.deferredRewardFees() + unclaimedRewards;
        assertGe(address(vault).balance, accountedBalance);
    }

    function invariant_hookClaimsExactlyCoverItsAccounting() public view {
        uint256 nativeClaims = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        assertEq(nativeClaims, hook.totalNativeFeesAccrued());
        (,,,,, uint256 creatorFeesAccrued) = hook.poolFeeConfig(poolId);
        assertEq(creatorFeesAccrued + hook.launcherFeesAccrued(), hook.totalNativeFeesAccrued());
    }

    function invariant_configurationAndAuthoritiesNeverChange() public view {
        assertEq(vault.growthTargetNative(), GROWTH_TARGET);
        assertEq(vault.maxCompoundNative(), MAX_COMPOUND);
        assertEq(vault.tokenReserveTarget(), TOKEN_RESERVE);
        assertEq(vault.activeRangeHalfWidthTicks(), RANGE_HALF_WIDTH);
        assertEq(vault.compoundCooldownSeconds(), COMPOUND_COOLDOWN);
        assertEq(address(vault.rangeSource()), address(rangeSource));
        assertEq(address(rangeSource.poolManager()), address(manager));
        assertEq(address(rangeSource.oracleHook()), address(hook));
        assertEq(rangeSource.poolId(), poolId);
        assertEq(rangeSource.twapWindow(), TWAP_WINDOW);
        assertEq(rangeSource.rangeHalfWidthTicks(), RANGE_HALF_WIDTH);
        assertEq(rangeSource.maxSpotTwapDeviationTicks(), MAX_SPOT_TWAP_DEVIATION);
        uint256 expectedTolerance = GROWTH_TARGET / vault.BASIS_POINTS();
        if (expectedTolerance > 0.000_001 ether) {
            expectedTolerance = 0.000_001 ether;
        }
        assertEq(vault.completionToleranceNative(), expectedTolerance);
        assertEq(vault.minimumNativeLiquidityForCompletion(), GROWTH_TARGET - vault.completionToleranceNative());
        assertEq(vault.beneficiaryAt(0), beneficiary);
        assertEq(vault.shareBpsOf(beneficiary), 10_000);
        assertEq(vault.payoutAddressOf(beneficiary), beneficiary);
    }
}
