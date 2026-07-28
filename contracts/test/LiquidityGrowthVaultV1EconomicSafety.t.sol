// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { LiquidityGrowthVaultFactoryV1 } from "../src/LiquidityGrowthVaultFactoryV1.sol";
import { LiquidityGrowthVaultV1 } from "../src/LiquidityGrowthVaultV1.sol";
import { ILiquidityGrowthOracleV1 } from "../src/interfaces/ILiquidityGrowthOracleV1.sol";

contract LiquidityGrowthEconomicSafetyToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_, string memory symbol_) MockERC20("Liquidity Growth Safety", symbol_, 18) {
        creator = creator_;
    }
}

contract LiquidityGrowthVaultV1EconomicSafetyTest is Deployers {
    uint16 internal constant TOTAL_SWAP_FEE_BPS = 100;
    uint256 internal constant STANDARD_TARGET = 0.009 ether;
    uint256 internal constant STANDARD_RESERVE = 10_000 ether;
    uint256 internal constant NEAR_TARGET_RESERVE = 8_954_600_000_000_000;
    uint256 internal constant MATERIAL_TOKEN_LIMIT = 1_000_000_000;
    int24 internal constant RANGE_HALF_WIDTH = 10_000;
    int24 internal constant MAX_ABS_TICK_DELTA = 5;
    int24 internal constant MAX_SPOT_TWAP_DEVIATION = 400;
    uint32 internal constant TWAP_WINDOW = 5 minutes;
    uint64 internal constant COMPOUND_COOLDOWN = 5;

    FeeSplitVaultFactoryV1 internal splitFactory;
    LiquidityGrowthVaultFactoryV1 internal growthFactory;
    LiquidityGrowthFeeOracleHookV1 internal hook;

    address internal alice;
    address internal bob;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    struct Market {
        LiquidityGrowthEconomicSafetyToken token;
        LiquidityGrowthVaultV1 vault;
        PoolKey key;
        bytes32 poolId;
        uint256 fundedReserve;
    }

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1_000_000 ether);

        alice = makeAddr("alice");
        bob = makeAddr("bob");
        splitFactory = new FeeSplitVaultFactoryV1();
        growthFactory = new LiquidityGrowthVaultFactoryV1();

        LiquidityGrowthFeeOracleHookFactoryV1 hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        address treasury = makeAddr("programmableTreasury");
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(manager, treasury, splitFactory, MAX_ABS_TICK_DELTA)
        );
        hook = hookFactory.deploy(hookSalt, manager, treasury, splitFactory, MAX_ABS_TICK_DELTA);
    }

    function test_exactTargetAccountingNeverAllocatesOneWeiTooMuch() public {
        Market memory market = _deploySingleBeneficiaryMarket(
            keccak256("economic-exact-target"),
            "EXACT",
            STANDARD_TARGET,
            STANDARD_TARGET,
            STANDARD_RESERVE,
            STANDARD_RESERVE,
            alice
        );

        uint256 gross = 1 ether;
        _buy(market.key, gross);
        (uint256 creatorFee, uint256 launcherFee) = hook.quoteGrossFees(gross, TOTAL_SWAP_FEE_BPS);
        assertEq(creatorFee, STANDARD_TARGET);

        (uint256 received, LiquidityGrowthVaultV1.CompoundResult memory result) = market.vault.process();

        assertEq(received, STANDARD_TARGET);
        assertEq(market.vault.totalCreatorFeesReceived(), STANDARD_TARGET);
        assertEq(market.vault.totalNativeAllocatedToGrowth(), STANDARD_TARGET);
        assertEq(market.vault.deferredRewardFees(), 0);
        assertEq(market.vault.totalRewardFeesReceived(), 0);
        assertEq(result.nativeAdded + result.nativeDust, STANDARD_TARGET);
        assertEq(market.vault.totalNativeAddedToLiquidity() + market.vault.pendingGrowthNative(), STANDARD_TARGET);
        assertEq(hook.launcherFeesAccrued(), launcherFee);
        assertEq(_creatorAccrued(market.poolId), 0);
        _assertCreatorFeeConservation(market.vault);
    }

    function test_completionOnlyUsesTheExplicitBoundedTolerance() public {
        Market memory market = _deploySingleBeneficiaryMarket(
            keccak256("economic-bounded-completion"),
            "BOUND",
            STANDARD_TARGET,
            STANDARD_TARGET,
            NEAR_TARGET_RESERVE,
            NEAR_TARGET_RESERVE,
            alice
        );

        _buy(market.key, 1 ether);
        (, LiquidityGrowthVaultV1.CompoundResult memory result) = market.vault.process();
        uint256 shortfall = STANDARD_TARGET - result.nativeAdded;

        assertGt(shortfall, 0);
        assertEq(result.nativeDust, shortfall);
        assertTrue(market.vault.growthTargetReached());
        assertEq(market.vault.totalNativeAllocatedToGrowth(), STANDARD_TARGET);
        assertEq(market.vault.nativeLiquidityShortfallAtCompletion(), shortfall);
        assertEq(market.vault.pendingGrowthNative(), shortfall);
        assertLe(shortfall, market.vault.completionToleranceNative());
        assertGe(result.nativeAdded, market.vault.minimumNativeLiquidityForCompletion());
        assertEq(
            market.vault.minimumNativeLiquidityForCompletion(),
            STANDARD_TARGET - market.vault.completionToleranceNative()
        );
        _assertCreatorFeeConservation(market.vault);
    }

    function test_materialReserveUnderfundingRemainsAtomicAndFailClosed() public {
        uint256 fundedReserve = STANDARD_RESERVE - 1 ether;
        Market memory market = _deploySingleBeneficiaryMarket(
            keccak256("economic-underfunded"),
            "UNDER",
            STANDARD_TARGET,
            STANDARD_TARGET,
            STANDARD_RESERVE,
            fundedReserve,
            alice
        );

        _buy(market.key, 1 ether);
        uint256 creatorAccruedBefore = _creatorAccrued(market.poolId);
        assertGt(creatorAccruedBefore, 0);

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthVaultV1.ReserveUnderfunded.selector, fundedReserve, STANDARD_RESERVE)
        );
        market.vault.process();

        assertEq(_creatorAccrued(market.poolId), creatorAccruedBefore);
        assertEq(market.vault.totalCreatorFeesReceived(), 0);
        assertEq(market.vault.totalNativeAllocatedToGrowth(), 0);
        assertEq(market.vault.pendingGrowthNative(), 0);
        assertEq(market.vault.totalNativeAddedToLiquidity(), 0);
        assertEq(market.vault.totalRewardFeesReceived(), 0);
        assertEq(market.token.balanceOf(address(market.vault)), fundedReserve);
    }

    function test_pendingCompletionDustNeverBecomesClaimableReward() public {
        Market memory market = _deploySingleBeneficiaryMarket(
            keccak256("economic-dust-isolation"),
            "DUST",
            STANDARD_TARGET,
            STANDARD_TARGET,
            NEAR_TARGET_RESERVE,
            NEAR_TARGET_RESERVE,
            alice
        );

        _buy(market.key, 1 ether);
        market.vault.process();
        uint256 pendingDust = market.vault.pendingGrowthNative();
        assertGt(pendingDust, 0);
        assertTrue(market.vault.growthTargetReached());
        assertEq(market.vault.claimable(alice), 0);

        uint256 rewardGross = 0.1 ether;
        _buy(market.key, rewardGross);
        (uint256 expectedReward,) = hook.quoteGrossFees(rewardGross, TOTAL_SWAP_FEE_BPS);
        market.vault.process();

        assertEq(market.vault.pendingGrowthNative(), pendingDust);
        assertEq(market.vault.totalRewardFeesReceived(), expectedReward);
        assertEq(market.vault.claimable(alice), expectedReward);
        vm.prank(alice);
        uint256 claimed = market.vault.claimRewards();

        assertEq(claimed, expectedReward);
        assertEq(alice.balance, expectedReward);
        assertEq(market.vault.totalRewardFeesClaimed(), expectedReward);
        assertEq(market.vault.claimable(alice), 0);
        assertEq(market.vault.pendingGrowthNative(), pendingDust);
        assertEq(address(market.vault).balance, pendingDust);
        _assertCreatorFeeConservation(market.vault);
    }

    function test_beneficiariesCannotClaimDeferredFeesBeforeMaterialShortfallCompletes() public {
        Market memory market = _deployTwoBeneficiaryMarket(
            keccak256("economic-no-early-claims"),
            "EARLY",
            STANDARD_TARGET,
            STANDARD_TARGET,
            MATERIAL_TOKEN_LIMIT,
            MATERIAL_TOKEN_LIMIT
        );

        _buy(market.key, 1 ether);
        market.vault.process();
        assertFalse(market.vault.growthTargetReached());
        assertGt(STANDARD_TARGET - market.vault.totalNativeAddedToLiquidity(), market.vault.completionToleranceNative());

        _buy(market.key, 1 ether);
        market.vault.process();
        assertGt(market.vault.deferredRewardFees(), 0);
        assertEq(market.vault.totalRewardFeesReceived(), 0);
        assertEq(market.vault.claimable(alice), 0);
        assertEq(market.vault.claimable(bob), 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LiquidityGrowthVaultV1.NoRewardsToClaim.selector, alice));
        market.vault.claimRewards();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LiquidityGrowthVaultV1.NoRewardsToClaim.selector, bob));
        market.vault.claimRewards();

        assertEq(market.vault.totalRewardFeesClaimed(), 0);
        assertEq(market.vault.claimedBy(alice), 0);
        assertEq(market.vault.claimedBy(bob), 0);
        _assertCreatorFeeConservation(market.vault);
    }

    function test_duplicatePayoutAddressConvergenceKeepsBeneficiaryLedgersIndependent() public {
        Market memory market = _deployTwoBeneficiaryMarket(
            keccak256("economic-payout-convergence"),
            "MERGE",
            STANDARD_TARGET,
            STANDARD_TARGET,
            STANDARD_RESERVE,
            STANDARD_RESERVE
        );

        _buy(market.key, 1 ether);
        market.vault.process();
        assertTrue(market.vault.growthTargetReached());

        address sharedPayout = makeAddr("sharedPayout");
        vm.prank(alice);
        market.vault.setPayoutAddress(sharedPayout);
        vm.prank(bob);
        market.vault.setPayoutAddress(sharedPayout);

        uint256 rewardGross = 1 ether;
        _buy(market.key, rewardGross);
        (uint256 expectedRewards,) = hook.quoteGrossFees(rewardGross, TOTAL_SWAP_FEE_BPS);
        market.vault.process();

        uint256 aliceEntitlement = market.vault.claimable(alice);
        uint256 bobEntitlement = market.vault.claimable(bob);
        assertEq(aliceEntitlement + bobEntitlement, expectedRewards);

        vm.prank(alice);
        uint256 aliceClaim = market.vault.claimRewards();
        vm.prank(bob);
        uint256 bobClaim = market.vault.claimRewards();

        assertEq(aliceClaim, aliceEntitlement);
        assertEq(bobClaim, bobEntitlement);
        assertEq(sharedPayout.balance, expectedRewards);
        assertEq(market.vault.claimedBy(alice), aliceEntitlement);
        assertEq(market.vault.claimedBy(bob), bobEntitlement);
        assertEq(market.vault.totalRewardFeesClaimed(), expectedRewards);
        assertEq(market.vault.claimable(alice), 0);
        assertEq(market.vault.claimable(bob), 0);
        _assertCreatorFeeConservation(market.vault);
    }

    function test_repeatedProcessingConservesEveryCreatorFeeAcrossGrowthAndRewards() public {
        uint256 target = 0.018 ether;
        uint256 maxCompound = 0.0045 ether;
        Market memory market = _deploySingleBeneficiaryMarket(
            keccak256("economic-repeated-processing"),
            "REPEAT",
            target,
            maxCompound,
            STANDARD_RESERVE,
            STANDARD_RESERVE,
            alice
        );

        uint256 gross = 0.25 ether;
        (uint256 creatorPerSwap, uint256 launcherPerSwap) = hook.quoteGrossFees(gross, TOTAL_SWAP_FEE_BPS);
        uint256 creatorFeesProcessed;

        for (uint256 iteration; iteration < 10; iteration++) {
            _buy(market.key, gross);
            vm.warp(block.timestamp + COMPOUND_COOLDOWN);
            (uint256 received,) = market.vault.process();
            assertEq(received, creatorPerSwap);
            creatorFeesProcessed += received;

            assertEq(_creatorAccrued(market.poolId), 0);
            assertEq(market.vault.totalCreatorFeesReceived(), creatorFeesProcessed);
            assertEq(hook.launcherFeesAccrued(), launcherPerSwap * (iteration + 1));
            assertLe(market.vault.totalNativeAllocatedToGrowth(), target);
            _assertCreatorFeeConservation(market.vault);
        }

        assertTrue(market.vault.growthTargetReached());
        assertEq(market.vault.totalNativeAllocatedToGrowth(), target);
        assertEq(market.vault.deferredRewardFees(), 0);
        assertEq(market.vault.totalRewardFeesReceived(), creatorFeesProcessed - target);
        assertEq(market.vault.claimable(alice), creatorFeesProcessed - target);
        assertEq(
            address(market.vault).balance, market.vault.pendingGrowthNative() + market.vault.totalRewardFeesReceived()
        );
    }

    function _deploySingleBeneficiaryMarket(
        bytes32 salt,
        string memory symbol,
        uint256 growthTarget,
        uint256 maxCompound,
        uint256 reserveTarget,
        uint256 fundedReserve,
        address beneficiary
    ) private returns (Market memory market) {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = beneficiary;
        uint16[] memory sharesBps = new uint16[](1);
        sharesBps[0] = 10_000;
        return _deployMarket(
            salt, symbol, growthTarget, maxCompound, reserveTarget, fundedReserve, beneficiaries, sharesBps
        );
    }

    function _deployTwoBeneficiaryMarket(
        bytes32 salt,
        string memory symbol,
        uint256 growthTarget,
        uint256 maxCompound,
        uint256 reserveTarget,
        uint256 fundedReserve
    ) private returns (Market memory market) {
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = alice;
        beneficiaries[1] = bob;
        uint16[] memory sharesBps = new uint16[](2);
        sharesBps[0] = 6000;
        sharesBps[1] = 4000;
        return _deployMarket(
            salt, symbol, growthTarget, maxCompound, reserveTarget, fundedReserve, beneficiaries, sharesBps
        );
    }

    function _deployMarket(
        bytes32 salt,
        string memory symbol,
        uint256 growthTarget,
        uint256 maxCompound,
        uint256 reserveTarget,
        uint256 fundedReserve,
        address[] memory beneficiaries,
        uint16[] memory sharesBps
    ) private returns (Market memory market) {
        market.token = new LiquidityGrowthEconomicSafetyToken(address(this), symbol);
        market.token.mint(address(this), 2_000_000 ether);
        market.token.approve(address(modifyLiquidityRouter), type(uint256).max);
        market.token.approve(address(swapRouter), type(uint256).max);
        market.key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(market.token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        market.poolId = PoolId.unwrap(market.key.toId());

        LiquidityGrowthRangeSourceV1 rangeSource = new LiquidityGrowthRangeSourceV1(
            manager,
            market.key,
            ILiquidityGrowthOracleV1(address(hook)),
            TWAP_WINDOW,
            RANGE_HALF_WIDTH,
            MAX_SPOT_TWAP_DEVIATION
        );
        LiquidityGrowthVaultV1.Configuration memory configuration = LiquidityGrowthVaultV1.Configuration({
            poolKey: market.key,
            rangeSource: rangeSource,
            growthTargetNative: growthTarget,
            maxCompoundNative: maxCompound,
            tokenReserveTarget: reserveTarget,
            activeRangeHalfWidthTicks: RANGE_HALF_WIDTH,
            compoundCooldownSeconds: COMPOUND_COOLDOWN,
            beneficiaries: beneficiaries,
            sharesBps: sharesBps
        });
        market.vault = growthFactory.deployOrGet(salt, hook, splitFactory, configuration);
        market.fundedReserve = fundedReserve;
        assertTrue(market.token.transfer(address(market.vault), fundedReserve));
        _initializeMarketPool(market.vault, market.key, market.poolId, salt);
    }

    function _initializeMarketPool(LiquidityGrowthVaultV1 vault, PoolKey memory key, bytes32 poolId, bytes32 salt)
        private
    {
        hook.registerPool(key, address(vault.upstreamVault()), TOTAL_SWAP_FEE_BPS, TOTAL_SWAP_FEE_BPS);
        manager.initialize(key, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(
            key,
            ModifyLiquidityParams({ tickLower: -20_000, tickUpper: 20_000, liquidityDelta: 1000 ether, salt: salt }),
            ZERO_BYTES
        );
        hook.increaseObservationCardinalityNext(192, PoolId.wrap(poolId));
        vm.warp(block.timestamp + TWAP_WINDOW);
    }

    function _buy(PoolKey memory key, uint256 grossNative) private {
        swapRouter.swap{ value: grossNative }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(grossNative), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function _creatorAccrued(bytes32 id) private view returns (uint256 accrued) {
        (,,,,, accrued) = hook.poolFeeConfig(id);
    }

    function _assertCreatorFeeConservation(LiquidityGrowthVaultV1 vault) private view {
        assertEq(
            vault.totalNativeAllocatedToGrowth() + vault.deferredRewardFees() + vault.totalRewardFeesReceived(),
            vault.totalCreatorFeesReceived()
        );
        assertEq(
            vault.totalNativeAddedToLiquidity() + vault.pendingGrowthNative(),
            vault.totalNativeAllocatedToGrowth() + vault.totalNativeRecycled()
        );
        assertLe(vault.totalRewardFeesClaimed(), vault.totalRewardFeesReceived());
    }
}
