// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { EthCreatorFeeHookFactoryV3 } from "../src/EthCreatorFeeHookFactoryV3.sol";
import { EthCreatorFeeHookV3 } from "../src/EthCreatorFeeHookV3.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { LiquidityGrowthVaultFactoryV1 } from "../src/LiquidityGrowthVaultFactoryV1.sol";
import { LiquidityGrowthVaultV1 } from "../src/LiquidityGrowthVaultV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";

contract LiquidityGrowthCreatorToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Liquidity Growth", "GROW", 18) {
        creator = creator_;
    }
}

contract LiquidityGrowthVaultV1Test is Deployers {
    using StateLibrary for IPoolManager;

    uint16 internal constant TOTAL_SWAP_FEE_BPS = 100;
    uint256 internal constant GROWTH_TARGET = 0.009 ether;
    uint256 internal constant MAX_COMPOUND = 0.009 ether;
    uint256 internal constant TOKEN_RESERVE = 10_000 ether;
    int24 internal constant RANGE_HALF_WIDTH = 10_000;
    uint64 internal constant COMPOUND_COOLDOWN = 1;

    EthCreatorFeeHookFactoryV3 internal hookFactory;
    FeeSplitVaultFactoryV1 internal feeSplitVaultFactory;
    LiquidityGrowthVaultFactoryV1 internal growthFactory;
    EthCreatorFeeHookV3 internal hook;
    LiquidityGrowthVaultV1 internal vault;
    LiquidityGrowthCreatorToken internal token;
    PoolKey internal growthKey;
    bytes32 internal poolId;

    address internal treasury;
    address internal alice;
    address internal bob;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);

        treasury = makeAddr("programmableTreasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        feeSplitVaultFactory = new FeeSplitVaultFactoryV1();
        growthFactory = new LiquidityGrowthVaultFactoryV1();
        hookFactory = new EthCreatorFeeHookFactoryV3();
        hook = _deployHook();

        token = new LiquidityGrowthCreatorToken(address(this));
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);
        token.approve(address(donateRouter), type(uint256).max);

        growthKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        poolId = PoolId.unwrap(growthKey.toId());
        LiquidityGrowthVaultV1.Configuration memory configuration = _configuration(GROWTH_TARGET);
        address predicted = growthFactory.predict(bytes32("growth"), hook, feeSplitVaultFactory, configuration);
        vault = growthFactory.deploy(bytes32("growth"), hook, feeSplitVaultFactory, configuration);
        assertEq(address(vault), predicted);
        assertTrue(token.transfer(address(vault), TOKEN_RESERVE));

        hook.registerPool(growthKey, address(vault.upstreamVault()), TOTAL_SWAP_FEE_BPS, TOTAL_SWAP_FEE_BPS);
        manager.initialize(growthKey, SQRT_PRICE_1_1);

        LIQUIDITY_PARAMS =
            ModifyLiquidityParams({ tickLower: -20_000, tickUpper: 20_000, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(growthKey, LIQUIDITY_PARAMS, ZERO_BYTES);
    }

    function test_configurationIsImmutableAndReusesClassicHook() public view {
        assertEq(address(vault.feeHook()), address(hook));
        assertEq(address(vault.poolManager()), address(manager));
        assertEq(vault.poolId(), poolId);
        assertEq(vault.token(), address(token));
        assertEq(vault.growthTargetNative(), GROWTH_TARGET);
        assertEq(vault.maxCompoundNative(), MAX_COMPOUND);
        assertEq(vault.tokenReserveTarget(), TOKEN_RESERVE);
        assertEq(vault.activeRangeHalfWidthTicks(), RANGE_HALF_WIDTH);
        assertEq(vault.compoundCooldownBlocks(), COMPOUND_COOLDOWN);
        assertEq(vault.beneficiaryCount(), 2);
        assertEq(vault.beneficiaryAt(0), alice);
        assertEq(vault.beneficiaryAt(1), bob);
        assertEq(vault.shareBpsOf(alice), 6000);
        assertEq(vault.shareBpsOf(bob), 4000);
        assertEq(vault.payoutAddressOf(alice), alice);
        assertEq(vault.payoutAddressOf(bob), bob);
        assertEq(growthFactory.configurationHashOf(address(vault)), vault.configurationHash());

        FeeSplitVaultV1 upstream = vault.upstreamVault();
        assertEq(upstream.beneficiaryCount(), 1);
        assertEq(upstream.beneficiaryAt(0), address(vault));
        assertEq(upstream.shareBpsOf(address(vault)), 10_000);
        assertEq(address(upstream.feeHook()), address(hook));
        assertEq(upstream.poolId(), poolId);

        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
        assertFalse(permissions.beforeAddLiquidity);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
    }

    function test_creatorFeesBecomePermanentMainPoolLiquidityUntilTarget() public {
        uint256 gross = 1 ether;
        _buy(gross);
        (uint256 expectedCreatorFee, uint256 expectedProtocolFee) = hook.quoteGrossFees(gross, TOTAL_SWAP_FEE_BPS);
        assertEq(expectedCreatorFee, GROWTH_TARGET);

        uint128 liquidityBefore = _lastLockedLiquidity();
        (uint256 received, LiquidityGrowthVaultV1.CompoundResult memory result) = vault.process();

        assertEq(received, expectedCreatorFee);
        assertEq(vault.totalNativeAllocatedToGrowth(), GROWTH_TARGET);
        assertEq(vault.totalRewardFeesReceived(), 0);
        assertEq(vault.totalCreatorFeesReceived(), expectedCreatorFee);
        assertGt(result.nativeAdded, 0);
        assertGt(result.tokenAdded, 0);
        assertLe(result.nativeAdded, received);
        assertGt(result.liquidityAdded, 0);
        assertEq(result.tickUpper - result.tickLower, RANGE_HALF_WIDTH * 2);
        assertLt(result.tickLower, _currentTick());
        assertGt(result.tickUpper, _currentTick());
        assertEq(vault.lockedLiquidityAt(result.tickLower, result.tickUpper), result.liquidityAdded);
        assertGt(_lastLockedLiquidity(), liquidityBefore);
        assertEq(vault.totalNativeAddedToLiquidity(), result.nativeAdded);
        assertEq(vault.totalTokenAddedToLiquidity(), result.tokenAdded);
        assertEq(vault.totalLiquidityAdded(), result.liquidityAdded);
        assertEq(vault.totalNativeAddedToLiquidity() + vault.pendingGrowthNative(), GROWTH_TARGET);
        assertEq(hook.launcherFeesAccrued(), expectedProtocolFee);
        assertEq(_creatorAccrued(), 0);
    }

    function test_postTargetCreatorFeesRouteToImmutableBeneficiaries() public {
        _buy(1 ether);
        vault.process();

        _buy(1 ether);
        vm.roll(block.number + COMPOUND_COOLDOWN);
        (uint256 creatorFee,) = hook.quoteGrossFees(1 ether, TOTAL_SWAP_FEE_BPS);
        (uint256 received, LiquidityGrowthVaultV1.CompoundResult memory result) = vault.process();
        assertEq(received, creatorFee);
        assertEq(result.liquidityAdded, 0);
        assertEq(vault.totalNativeAllocatedToGrowth(), GROWTH_TARGET);
        assertEq(vault.totalRewardFeesReceived(), creatorFee);

        vm.prank(alice);
        uint256 aliceClaim = vault.claimRewards();
        vm.prank(bob);
        uint256 bobClaim = vault.claimRewards();
        assertEq(aliceClaim, FullMath.mulDiv(creatorFee, 6000, 10_000));
        assertEq(aliceClaim + bobClaim, creatorFee);
        assertEq(alice.balance, aliceClaim);
        assertEq(bob.balance, bobClaim);
        assertEq(vault.totalRewardFeesClaimed(), creatorFee);
    }

    function test_onlyBeneficiaryControlsClaimAndPayoutAddress() public {
        _buy(1 ether);
        vault.process();
        _buy(1 ether);
        vm.roll(block.number + COMPOUND_COOLDOWN);
        vault.process();

        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(LiquidityGrowthVaultV1.UnauthorizedBeneficiary.selector, attacker));
        vault.claimRewards();

        address destination = makeAddr("destination");
        vm.prank(alice);
        vault.setPayoutAddress(destination);
        vm.prank(alice);
        uint256 amount = vault.claimRewards();
        assertEq(destination.balance, amount);

        vm.prank(destination);
        vm.expectRevert(abi.encodeWithSelector(LiquidityGrowthVaultV1.UnauthorizedBeneficiary.selector, destination));
        vault.claimRewards();
    }

    function test_processIsPermissionlessButAssetsCannotBeWithdrawn() public {
        _buy(1 ether);
        address keeper = makeAddr("keeper");
        vm.prank(keeper);
        vault.process();

        (bool withdrawSuccess,) = address(vault).call(abi.encodeWithSignature("withdraw(address)", keeper));
        (bool removeSuccess,) =
            address(vault).call(abi.encodeWithSignature("removeLiquidity(int24,int24,uint128)", -200, 200, 1));
        assertFalse(withdrawSuccess);
        assertFalse(removeSuccess);
        assertGt(vault.totalNativeAddedToLiquidity(), 0);
    }

    function test_positionDonationsAreRecycledWithoutBlockingLaterCompounds() public {
        _buy(0.5 ether);
        (, LiquidityGrowthVaultV1.CompoundResult memory first) = vault.process();
        assertGt(first.liquidityAdded, 0);

        donateRouter.donate{ value: 2000 ether }(growthKey, 2000 ether, 0, "");
        _buy(0.5 ether);
        vm.roll(block.number + COMPOUND_COOLDOWN);
        (, LiquidityGrowthVaultV1.CompoundResult memory second) = vault.process();

        assertGt(second.nativeRecycled, 0);
        assertGt(second.nativeAdded, 0);
        assertEq(vault.totalNativeRecycled(), second.nativeRecycled);
        assertEq(
            vault.totalNativeAddedToLiquidity() + vault.pendingGrowthNative(),
            vault.totalNativeAllocatedToGrowth() + vault.totalNativeRecycled()
        );
    }

    function test_matchingPredeployedUpstreamVaultIsReused() public {
        LiquidityGrowthVaultV1.Configuration memory configuration = _configuration(GROWTH_TARGET);
        bytes32 growthSalt = bytes32("predeployed-upstream");
        address predicted = growthFactory.predict(growthSalt, hook, feeSplitVaultFactory, configuration);

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = predicted;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        bytes32 upstreamSalt = keccak256(abi.encode("programmable.liquidity-growth.upstream.v1", predicted, poolId));
        address predeployed = address(
            feeSplitVaultFactory.deploy(upstreamSalt, IClassicFeeHookV3(address(hook)), poolId, beneficiaries, shares)
        );

        LiquidityGrowthVaultV1 reused = growthFactory.deploy(growthSalt, hook, feeSplitVaultFactory, configuration);
        assertEq(address(reused), predicted);
        assertEq(address(reused.upstreamVault()), predeployed);
    }

    function test_onlyPoolManagerCanEnterUnlockCallback() public {
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthVaultV1.UnauthorizedUnlockCallback.selector, address(this))
        );
        vault.unlockCallback(abi.encode(1 ether));

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.unlockCallback("");
    }

    /// forge-config: default.fuzz.runs = 250
    function testFuzz_growthAllocationNeverExceedsTarget(uint96 rawGross) public {
        uint256 gross = bound(uint256(rawGross), 0.01 ether, 2 ether);
        _buy(gross);
        (uint256 creatorFee, uint256 protocolFee) = hook.quoteGrossFees(gross, TOTAL_SWAP_FEE_BPS);

        vault.process();
        uint256 expectedGrowth = creatorFee < GROWTH_TARGET ? creatorFee : GROWTH_TARGET;
        assertEq(vault.totalNativeAllocatedToGrowth(), expectedGrowth);
        assertEq(vault.totalRewardFeesReceived(), creatorFee - expectedGrowth);
        assertEq(vault.totalCreatorFeesReceived(), creatorFee);
        assertEq(hook.launcherFeesAccrued(), protocolFee);
        assertLe(vault.totalNativeAllocatedToGrowth(), GROWTH_TARGET);
        assertEq(
            vault.totalNativeAddedToLiquidity() + vault.pendingGrowthNative(),
            vault.totalNativeAllocatedToGrowth() + vault.totalNativeRecycled()
        );
    }

    function _deployHook() private returns (EthCreatorFeeHookV3 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV3).creationCode,
            abi.encode(manager, treasury, feeSplitVaultFactory)
        );
        deployed = hookFactory.deploy(salt, manager, treasury, feeSplitVaultFactory);
    }

    function _configuration(uint256 target)
        private
        view
        returns (LiquidityGrowthVaultV1.Configuration memory configuration)
    {
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = alice;
        beneficiaries[1] = bob;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 6000;
        shares[1] = 4000;
        configuration = LiquidityGrowthVaultV1.Configuration({
            poolKey: growthKey,
            growthTargetNative: target,
            maxCompoundNative: target,
            tokenReserveTarget: TOKEN_RESERVE,
            activeRangeHalfWidthTicks: RANGE_HALF_WIDTH,
            compoundCooldownBlocks: COMPOUND_COOLDOWN,
            beneficiaries: beneficiaries,
            sharesBps: shares
        });
    }

    function _buy(uint256 gross) private {
        swapRouter.swap{ value: gross }(
            growthKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(gross), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function _creatorAccrued() private view returns (uint256 accrued) {
        (,,,,, accrued) = hook.poolFeeConfig(poolId);
    }

    function _currentTick() private view returns (int24 tick) {
        (, tick,,) = manager.getSlot0(PoolId.wrap(poolId));
    }

    function _lastLockedLiquidity() private view returns (uint128) {
        return vault.lockedLiquidityAt(vault.lastLockedTickLower(), vault.lastLockedTickUpper());
    }
}
