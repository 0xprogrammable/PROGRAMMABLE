// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
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

contract LiquidityGrowthAdversarialToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_, string memory symbol_) MockERC20("Liquidity Growth Adversarial", symbol_, 18) {
        creator = creator_;
    }
}

contract LiquidityGrowthRejectingPayout {
    receive() external payable {
        revert();
    }
}

contract LiquidityGrowthReentrantBeneficiary {
    LiquidityGrowthVaultV1 public vault;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    function bind(LiquidityGrowthVaultV1 vault_) external {
        require(address(vault) == address(0));
        vault = vault_;
    }

    function setPayoutAddress(address payoutAddress) external {
        vault.setPayoutAddress(payoutAddress);
    }

    function claim() external returns (uint256) {
        return vault.claimRewards();
    }

    receive() external payable {
        if (!reentryAttempted) {
            reentryAttempted = true;
            (reentrySucceeded,) = address(vault).call(abi.encodeCall(LiquidityGrowthVaultV1.claimRewards, ()));
        }
    }
}

contract LiquidityGrowthVaultV1AdversarialTest is Deployers {
    using SafeCast for int256;
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;

    uint16 internal constant TOTAL_SWAP_FEE_BPS = 100;
    uint256 internal constant GROWTH_TARGET = 0.018 ether;
    uint256 internal constant MAX_COMPOUND = 0.009 ether;
    uint256 internal constant TOKEN_RESERVE = 10_000 ether;
    int24 internal constant RANGE_HALF_WIDTH = 10_000;
    int24 internal constant MAX_ABS_TICK_DELTA = 5;
    int24 internal constant MAX_SPOT_TWAP_DEVIATION = 400;
    uint32 internal constant TWAP_WINDOW = 5 minutes;
    uint256 internal constant OBSERVATION_SEED_BUY = 0.000_001 ether;
    uint64 internal constant COMPOUND_COOLDOWN = 5;

    FeeSplitVaultFactoryV1 internal splitFactory;
    LiquidityGrowthVaultFactoryV1 internal growthFactory;
    LiquidityGrowthFeeOracleHookV1 internal hook;
    LiquidityGrowthVaultV1 internal vault;
    LiquidityGrowthRangeSourceV1 internal rangeSource;
    LiquidityGrowthAdversarialToken internal token;
    LiquidityGrowthReentrantBeneficiary internal beneficiary;
    PoolKey internal growthKey;
    bytes32 internal poolId;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    struct Market {
        LiquidityGrowthAdversarialToken token;
        LiquidityGrowthVaultV1 vault;
        LiquidityGrowthRangeSourceV1 rangeSource;
        PoolKey key;
        bytes32 poolId;
    }

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1_000_000 ether);

        splitFactory = new FeeSplitVaultFactoryV1();
        growthFactory = new LiquidityGrowthVaultFactoryV1();
        LiquidityGrowthFeeOracleHookFactoryV1 hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(manager, makeAddr("programmableTreasury"), splitFactory, MAX_ABS_TICK_DELTA)
        );
        hook = hookFactory.deploy(hookSalt, manager, makeAddr("programmableTreasury"), splitFactory, MAX_ABS_TICK_DELTA);

        beneficiary = new LiquidityGrowthReentrantBeneficiary();
        Market memory market = _deployMarket(
            keccak256("adversarial-main"), "GROWA", GROWTH_TARGET, MAX_COMPOUND, TOKEN_RESERVE, address(beneficiary)
        );
        token = market.token;
        vault = market.vault;
        rangeSource = market.rangeSource;
        growthKey = market.key;
        poolId = market.poolId;
        beneficiary.bind(vault);
    }

    function test_exactOutputBuyAndSellRemainReconciledThroughGrowthProcessing() public {
        uint256 tokenOutput = 0.5 ether;
        BalanceDelta buyDelta = _swap(growthKey, true, tokenOutput.toInt256(), 2 ether);
        assertEq(uint256(int256(buyDelta.amount1())), tokenOutput);
        uint256 creatorAfterBuy = _creatorAccrued(poolId);
        assertGt(creatorAfterBuy, 0);

        uint256 nativeOutput = 0.25 ether;
        BalanceDelta sellDelta = _swap(growthKey, false, nativeOutput.toInt256(), 0);
        assertEq(uint256(int256(sellDelta.amount0())), nativeOutput);
        uint256 creatorAfterSell = _creatorAccrued(poolId);
        assertGt(creatorAfterSell, creatorAfterBuy);

        (uint256 received, LiquidityGrowthVaultV1.CompoundResult memory result) = vault.process();
        assertEq(received, creatorAfterSell);
        assertEq(vault.totalCreatorFeesReceived(), creatorAfterSell);
        assertGt(result.liquidityAdded, 0);
        assertEq(_creatorAccrued(poolId), 0);
        assertEq(
            vault.totalNativeAddedToLiquidity() + vault.pendingGrowthNative(),
            vault.totalNativeAllocatedToGrowth() + vault.totalNativeRecycled()
        );
    }

    function test_cooldownAllowsFeeRoutingButBlocksCompoundingUntilExactBoundary() public {
        _buyExactInput(growthKey, 1 ether);
        vault.process();
        uint256 firstCompoundTimestamp = vault.lastCompoundTimestamp();

        _buyExactInput(growthKey, 1 ether);
        (uint256 received, LiquidityGrowthVaultV1.CompoundResult memory duringCooldown) = vault.process();
        assertGt(received, 0);
        assertEq(duringCooldown.liquidityAdded, 0);
        assertGt(vault.pendingGrowthNative(), 0);

        uint256 nextTimestamp = firstCompoundTimestamp + COMPOUND_COOLDOWN;
        vm.warp(nextTimestamp - 1);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthVaultV1.CompoundCooldown.selector, nextTimestamp - 1, nextTimestamp)
        );
        vault.compoundPending();

        vm.warp(nextTimestamp);
        LiquidityGrowthVaultV1.CompoundResult memory result = vault.compoundPending();
        assertGt(result.liquidityAdded, 0);
        assertEq(vault.lastCompoundTimestamp(), nextTimestamp);
        assertTrue(vault.growthTargetReached());
    }

    function test_matureHistoryCompoundsAtTheExactPoolTwapRange() public {
        _buyExactInput(growthKey, 1 ether);
        LiquidityGrowthRangeSourceV1.RangeQuote memory quote = rangeSource.quoteRange();

        (, LiquidityGrowthVaultV1.CompoundResult memory result) = vault.process();

        assertGt(result.liquidityAdded, 0);
        assertEq(result.tickLower, quote.tickLower);
        assertEq(result.tickUpper, quote.tickUpper);
        assertEq(address(vault.rangeSource()), address(rangeSource));
        assertEq(rangeSource.poolId(), poolId);
        assertEq(address(rangeSource.oracleHook()), address(hook));
    }

    function test_permissionlessCompoundRejectsSpotManipulationViaTwapCircuitBreaker() public {
        _buyExactInput(growthKey, 1 ether);
        vault.process();
        _buyExactInput(growthKey, 1 ether);
        vault.process();
        uint256 nextTimestamp = vault.lastCompoundTimestamp() + COMPOUND_COOLDOWN;
        vm.warp(nextTimestamp);

        LiquidityGrowthRangeSourceV1.RangeQuote memory preManipulationQuote = rangeSource.quoteRange();
        uint256 snapshot = vm.snapshotState();
        int24 unmanipulatedTick = _currentTick(growthKey);
        LiquidityGrowthVaultV1.CompoundResult memory unmanipulated = vault.compoundPending();
        assertGt(unmanipulated.liquidityAdded, 0);
        assertTrue(vm.revertToState(snapshot));
        vm.warp(nextTimestamp);

        address attacker = makeAddr("rangeManipulator");
        uint256 attackTokens = 500 ether;
        assertTrue(token.transfer(attacker, attackTokens));
        vm.prank(attacker);
        token.approve(address(swapRouter), type(uint256).max);
        vm.prank(attacker);
        _sellExactInput(growthKey, attackTokens);
        int24 manipulatedTick = _currentTick(growthKey);
        assertGt(
            _absoluteTickDistance(manipulatedTick, unmanipulatedTick),
            int256(MAX_SPOT_TWAP_DEVIATION).toUint256().toUint24()
        );
        uint24 deviation = _absoluteTickDistance(manipulatedTick, preManipulationQuote.twapTick);
        bytes memory expectedError = abi.encodeWithSelector(
            LiquidityGrowthRangeSourceV1.SpotTwapDeviationExceeded.selector,
            manipulatedTick,
            preManipulationQuote.twapTick,
            deviation,
            MAX_SPOT_TWAP_DEVIATION
        );

        uint256 pendingBefore = vault.pendingGrowthNative();
        uint64 lastCompoundTimestampBefore = vault.lastCompoundTimestamp();
        vm.expectRevert(expectedError);
        rangeSource.quoteRange();
        vm.expectRevert(expectedError);
        vm.prank(attacker);
        vault.compoundPending();
        assertEq(vault.pendingGrowthNative(), pendingBefore);
        assertEq(vault.lastCompoundTimestamp(), lastCompoundTimestampBefore);
    }

    function test_nativeAndTokenDonationsAreRecycledAndCannotBeWithdrawn() public {
        _buyExactInput(growthKey, 1 ether);
        vm.warp(block.timestamp + COMPOUND_COOLDOWN);
        LiquidityGrowthVaultV1.CompoundResult memory first;
        (, first) = vault.process();
        assertGt(first.liquidityAdded, 0);

        donateRouter.donate{ value: 1 ether }(growthKey, 1 ether, 100 ether, "");
        _buyExactInput(growthKey, 1 ether);
        vm.warp(vault.lastCompoundTimestamp() + COMPOUND_COOLDOWN);
        (, LiquidityGrowthVaultV1.CompoundResult memory recycled) = vault.process();

        assertGt(recycled.nativeRecycled, 0);
        assertGt(recycled.tokenRecycled, 0);
        assertEq(vault.totalNativeRecycled(), recycled.nativeRecycled);
        assertEq(vault.totalTokenRecycled(), recycled.tokenRecycled);
        assertEq(
            vault.totalNativeAddedToLiquidity() + vault.pendingGrowthNative(),
            vault.totalNativeAllocatedToGrowth() + vault.totalNativeRecycled()
        );
        assertEq(
            token.balanceOf(address(vault)) + vault.totalTokenAddedToLiquidity(),
            TOKEN_RESERVE + vault.totalTokenRecycled()
        );

        uint256 liquidityBefore = vault.totalLiquidityAdded();
        vm.warp(block.timestamp + COMPOUND_COOLDOWN);
        vault.compoundPending();
        assertGt(vault.totalLiquidityAdded(), liquidityBefore);

        (bool withdrawSuccess,) =
            address(vault).call(abi.encodeWithSignature("withdraw(address,uint256)", address(this), 1));
        assertFalse(withdrawSuccess);
    }

    function test_reentrantBeneficiaryCanOnlyReceiveOneRewardPayment() public {
        _reachTargetAndAccrueRewards();
        uint256 claimable = vault.claimable(address(beneficiary));
        assertGt(claimable, 0);

        uint256 claimed = beneficiary.claim();

        assertEq(claimed, claimable);
        assertTrue(beneficiary.reentryAttempted());
        assertFalse(beneficiary.reentrySucceeded());
        assertEq(address(beneficiary).balance, claimable);
        assertEq(vault.claimedBy(address(beneficiary)), claimable);
        assertEq(vault.totalRewardFeesClaimed(), claimable);
        assertEq(vault.claimable(address(beneficiary)), 0);
    }

    function test_revertingPayoutCannotCorruptClaimAccountingAndBeneficiaryCanRecover() public {
        _reachTargetAndAccrueRewards();
        uint256 claimable = vault.claimable(address(beneficiary));
        LiquidityGrowthRejectingPayout rejecting = new LiquidityGrowthRejectingPayout();
        beneficiary.setPayoutAddress(address(rejecting));

        vm.expectRevert();
        beneficiary.claim();
        assertEq(vault.claimedBy(address(beneficiary)), 0);
        assertEq(vault.totalRewardFeesClaimed(), 0);
        assertEq(vault.claimable(address(beneficiary)), claimable);

        address safePayout = makeAddr("safePayout");
        beneficiary.setPayoutAddress(safePayout);
        uint256 paid = beneficiary.claim();
        assertEq(paid, claimable);
        assertEq(safePayout.balance, claimable);
        assertEq(vault.totalRewardFeesClaimed(), claimable);
    }

    function test_nearTargetTokenLimitWithinToleranceFinalizesAndReleasesRewards() public {
        uint256 nearTargetReserve = 8_954_600_000_000_000;
        Market memory nearTargetMarket = _deployMarket(
            keccak256("adversarial-near-target"),
            "NEAR",
            MAX_COMPOUND,
            MAX_COMPOUND,
            nearTargetReserve,
            address(beneficiary)
        );

        _buyExactInput(nearTargetMarket.key, 1 ether);
        (, LiquidityGrowthVaultV1.CompoundResult memory first) = nearTargetMarket.vault.process();
        uint256 shortfall = nearTargetMarket.vault.growthTargetNative() - first.nativeAdded;

        assertGt(first.liquidityAdded, 0);
        assertGt(first.nativeDust, 0);
        assertEq(first.nativeDust, shortfall);
        assertGt(shortfall, 0);
        assertEq(nearTargetMarket.vault.totalNativeAllocatedToGrowth(), nearTargetMarket.vault.growthTargetNative());
        assertGe(
            nearTargetMarket.vault.totalNativeAddedToLiquidity(),
            nearTargetMarket.vault.minimumNativeLiquidityForCompletion()
        );
        assertLe(shortfall, nearTargetMarket.vault.completionToleranceNative());
        assertTrue(nearTargetMarket.vault.growthTargetReached());
        assertEq(nearTargetMarket.vault.nativeLiquidityShortfallAtCompletion(), shortfall);
        assertEq(nearTargetMarket.vault.pendingGrowthNative(), shortfall);

        _buyExactInput(nearTargetMarket.key, 1 ether);
        nearTargetMarket.vault.process();
        assertGt(nearTargetMarket.vault.totalRewardFeesReceived(), 0);
        assertGt(nearTargetMarket.vault.claimable(address(beneficiary)), 0);
        assertEq(nearTargetMarket.vault.deferredRewardFees(), 0);
    }

    function test_materialTokenUnderfundingBeyondToleranceRemainsBlockedAndRewardsDeferred() public {
        uint256 thinReserve = 1_000_000_000;
        Market memory thinMarket = _deployMarket(
            keccak256("adversarial-dust"), "DUST", MAX_COMPOUND, MAX_COMPOUND, thinReserve, address(beneficiary)
        );

        _buyExactInput(thinMarket.key, 1 ether);
        (, LiquidityGrowthVaultV1.CompoundResult memory first) = thinMarket.vault.process();
        assertGt(first.liquidityAdded, 0);
        assertGt(first.nativeDust, 0);
        assertLt(first.nativeAdded, thinMarket.vault.growthTargetNative());
        assertGt(
            thinMarket.vault.growthTargetNative() - first.nativeAdded, thinMarket.vault.completionToleranceNative()
        );
        assertFalse(thinMarket.vault.growthTargetReached());

        bool blocked;
        for (uint256 attempt; attempt < 8 && !blocked; attempt++) {
            vm.warp(block.timestamp + COMPOUND_COOLDOWN);
            try thinMarket.vault.compoundPending() returns (LiquidityGrowthVaultV1.CompoundResult memory) { }
            catch {
                blocked = true;
            }
        }
        assertTrue(blocked);
        assertFalse(thinMarket.vault.growthTargetReached());
        assertGt(thinMarket.vault.pendingGrowthNative(), 0);
        assertEq(thinMarket.token.balanceOf(address(thinMarket.vault)), 0);

        _buyExactInput(thinMarket.key, 1 ether);
        thinMarket.vault.process();
        assertGt(thinMarket.vault.deferredRewardFees(), 0);
        assertEq(thinMarket.vault.totalRewardFeesReceived(), 0);
        assertEq(thinMarket.vault.claimable(address(beneficiary)), 0);
        assertEq(_creatorAccrued(thinMarket.poolId), 0);
    }

    function _deployMarket(
        bytes32 salt,
        string memory symbol,
        uint256 target,
        uint256 maxCompound,
        uint256 reserve,
        address rewardBeneficiary
    ) private returns (Market memory market) {
        market.token = new LiquidityGrowthAdversarialToken(address(this), symbol);
        market.token.mint(address(this), 2_000_000 ether);
        market.token.approve(address(modifyLiquidityRouter), type(uint256).max);
        market.token.approve(address(swapRouter), type(uint256).max);
        market.token.approve(address(donateRouter), type(uint256).max);
        market.key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(market.token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        market.poolId = PoolId.unwrap(market.key.toId());
        market.rangeSource = new LiquidityGrowthRangeSourceV1(
            manager,
            market.key,
            ILiquidityGrowthOracleV1(address(hook)),
            TWAP_WINDOW,
            RANGE_HALF_WIDTH,
            MAX_SPOT_TWAP_DEVIATION
        );

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = rewardBeneficiary;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        LiquidityGrowthVaultV1.Configuration memory configuration = LiquidityGrowthVaultV1.Configuration({
            poolKey: market.key,
            rangeSource: market.rangeSource,
            growthTargetNative: target,
            maxCompoundNative: maxCompound,
            tokenReserveTarget: reserve,
            activeRangeHalfWidthTicks: RANGE_HALF_WIDTH,
            compoundCooldownSeconds: COMPOUND_COOLDOWN,
            beneficiaries: beneficiaries,
            sharesBps: shares
        });
        market.vault = growthFactory.deployOrGet(salt, hook, splitFactory, configuration);
        assertTrue(market.token.transfer(address(market.vault), reserve));
        _initializeMarketPool(market.vault, market.key, market.poolId, salt);
    }

    function _initializeMarketPool(
        LiquidityGrowthVaultV1 deployedVault,
        PoolKey memory key,
        bytes32 deployedPoolId,
        bytes32 salt
    ) private {
        hook.registerPool(key, address(deployedVault.upstreamVault()), TOTAL_SWAP_FEE_BPS, TOTAL_SWAP_FEE_BPS);
        manager.initialize(key, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(
            key,
            ModifyLiquidityParams({ tickLower: -20_000, tickUpper: 20_000, liquidityDelta: 1000 ether, salt: salt }),
            ZERO_BYTES
        );
        hook.increaseObservationCardinalityNext(192, PoolId.wrap(deployedPoolId));
        vm.warp(block.timestamp + TWAP_WINDOW);
        _buyExactInput(key, OBSERVATION_SEED_BUY);
    }

    function _reachTargetAndAccrueRewards() private {
        _buyExactInput(growthKey, 1 ether);
        vault.process();
        _buyExactInput(growthKey, 1 ether);
        vault.process();
        vm.warp(vault.lastCompoundTimestamp() + COMPOUND_COOLDOWN);
        vault.compoundPending();
        assertTrue(vault.growthTargetReached());

        _buyExactInput(growthKey, 1 ether);
        vault.process();
        assertGt(vault.totalRewardFeesReceived(), 0);
    }

    function _buyExactInput(PoolKey memory key, uint256 grossNative) private returns (BalanceDelta) {
        return _swap(key, true, -grossNative.toInt256(), grossNative);
    }

    function _sellExactInput(PoolKey memory key, uint256 tokenInput) private returns (BalanceDelta) {
        return _swap(key, false, -tokenInput.toInt256(), 0);
    }

    function _swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint256 value)
        private
        returns (BalanceDelta)
    {
        return swapRouter.swap{ value: value }(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function _creatorAccrued(bytes32 id) private view returns (uint256 accrued) {
        (,,,,, accrued) = hook.poolFeeConfig(id);
    }

    function _currentTick(PoolKey memory key) private view returns (int24 tick) {
        (, tick,,) = manager.getSlot0(key.toId());
    }

    function _absoluteTickDistance(int24 left, int24 right) private pure returns (uint24 distance) {
        int256 difference = int256(left) - int256(right);
        if (difference < 0) difference = -difference;
        distance = difference.toUint256().toUint24();
    }
}
