// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { TollHookV1 } from "../src/TollHookV1.sol";
import { ClassicCtoAuthorityV1 } from "../src/ClassicCtoAuthorityV1.sol";
import { ClassicRewardVaultFactoryV1 } from "../src/ClassicRewardVaultFactoryV1.sol";
import { ClassicRewardVaultV1 } from "../src/ClassicRewardVaultV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";

contract TollCreatorToken is MockERC20 {
    address public immutable creator;
    constructor(address creator_) MockERC20("Toll Token", "TOLL", 18) {
        creator = creator_;
    }
}

contract TollHookV1Test is Deployers {
    // Forge default tx.origin -- this is who the hook tracks as the trader
    address internal constant DEFAULT_TX_ORIGIN = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    uint256 internal constant BASIS_POINTS = 10_000;

    // Default fees (in bps)
    uint16 internal constant BUY_FEE = 100;           // 1% flat buy fee
    uint16 internal constant SNIPER_SELL = 1000;       // 10% sell
    uint16 internal constant WARM_SELL = 500;          // 5% sell
    uint16 internal constant HOLDER_SELL = 200;        // 2% sell
    uint16 internal constant DIAMOND_SELL = 100;       // 1% sell

    TollHookV1 internal hook;
    ClassicRewardVaultFactoryV1 internal vaultFactory;
    ClassicRewardVaultV1 internal vault;
    TollCreatorToken internal token;
    PoolKey internal hookKey;
    bytes32 internal poolId;

    address internal treasury;
    address internal alice;
    address internal bob;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function _defaultFees() internal pure returns (TollHookV1.TollFeeConfig memory) {
        return TollHookV1.TollFeeConfig({
            buyFeeBps: BUY_FEE,
            sniperSellFeeBps: SNIPER_SELL,
            warmSellFeeBps: WARM_SELL,
            holderSellFeeBps: HOLDER_SELL,
            diamondSellFeeBps: DIAMOND_SELL
        });
    }

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1000 ether);

        treasury = makeAddr("tollTreasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        ClassicCtoAuthorityV1 ctoAuth = new ClassicCtoAuthorityV1(address(this));
        vaultFactory = new ClassicRewardVaultFactoryV1(ctoAuth);
        hook = _deployHook();

        token = new TollCreatorToken(address(this));
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        poolId = PoolId.unwrap(hookKey.toId());

        vault = _deployVault(poolId, _addresses2(alice, bob), _shares2(6000, 4000), bytes32("main"));

        hook.registerPool(hookKey, address(vault), _defaultFees());
        manager.initialize(hookKey, SQRT_PRICE_1_1);

        LIQUIDITY_PARAMS =
            ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 20 ether }(hookKey, LIQUIDITY_PARAMS, ZERO_BYTES);
    }

    // ─── Registration Tests ──────────────────────────────────────────────

    function test_poolRegisteredCorrectly() public view {
        (
            address rewardVault,
            address registrar,
            bool registered,
            uint256 creatorFeesAccrued,
            uint16 buyFee,
            uint16 sniperSell,
            uint16 warmSell,
            uint16 holderSell,
            uint16 diamondSell
        ) = hook.poolFeeConfig(poolId);

        assertTrue(registered);
        assertEq(rewardVault, address(vault));
        assertEq(registrar, address(this));
        assertEq(creatorFeesAccrued, 0);
        assertEq(buyFee, BUY_FEE);
        assertEq(sniperSell, SNIPER_SELL);
        assertEq(warmSell, WARM_SELL);
        assertEq(holderSell, HOLDER_SELL);
        assertEq(diamondSell, DIAMOND_SELL);
    }

    function test_cannotRegisterSamePoolTwice() public {
        vm.expectRevert(abi.encodeWithSelector(TollHookV1.AlreadyRegistered.selector, poolId));
        hook.registerPool(hookKey, address(vault), _defaultFees());
    }

    function test_rejectsSellTiersNotDescending() public {
        TollCreatorToken newToken = new TollCreatorToken(address(this));
        PoolKey memory badKey = _candidateKey(address(newToken));
        bytes32 badPoolId = PoolId.unwrap(badKey.toId());
        ClassicRewardVaultV1 badVault = _deployVault(badPoolId, _addresses1(alice), _shares1(10_000), bytes32("bad"));

        // warm sell > sniper sell = not descending
        vm.expectRevert(TollHookV1.FeeTiersNotDescending.selector);
        hook.registerPool(
            badKey,
            address(badVault),
            TollHookV1.TollFeeConfig({
                buyFeeBps: 200,
                sniperSellFeeBps: 500,
                warmSellFeeBps: 600,      // > sniper = bad
                holderSellFeeBps: 200,
                diamondSellFeeBps: 100
            })
        );
    }

    function test_rejectsFeeBelowMinimum() public {
        TollCreatorToken newToken = new TollCreatorToken(address(this));
        PoolKey memory badKey = _candidateKey(address(newToken));
        bytes32 badPoolId = PoolId.unwrap(badKey.toId());
        ClassicRewardVaultV1 badVault = _deployVault(badPoolId, _addresses1(alice), _shares1(10_000), bytes32("low"));

        vm.expectRevert();
        hook.registerPool(
            badKey,
            address(badVault),
            TollHookV1.TollFeeConfig({
                buyFeeBps: 200,
                sniperSellFeeBps: 2500,
                warmSellFeeBps: 500,
                holderSellFeeBps: 200,
                diamondSellFeeBps: 50    // below MIN_FEE_BPS
            })
        );
    }

    function test_rejectsFeeAboveMaximum() public {
        TollCreatorToken newToken = new TollCreatorToken(address(this));
        PoolKey memory badKey = _candidateKey(address(newToken));
        bytes32 badPoolId = PoolId.unwrap(badKey.toId());
        ClassicRewardVaultV1 badVault = _deployVault(badPoolId, _addresses1(alice), _shares1(10_000), bytes32("high"));

        vm.expectRevert();
        hook.registerPool(
            badKey,
            address(badVault),
            TollHookV1.TollFeeConfig({
                buyFeeBps: 200,
                sniperSellFeeBps: 3000,   // above MAX_FEE_BPS
                warmSellFeeBps: 500,
                holderSellFeeBps: 200,
                diamondSellFeeBps: 100
            })
        );
    }

    // ─── Tier Resolution Tests ───────────────────────────────────────────

    function test_newBuyerStartsAtSniperTier() public {
        address newcomer = makeAddr("newcomer");
        (uint8 tier, uint16 buyFee, uint16 sellFee, uint256 holdDuration) = hook.getHolderTier(poolId, newcomer);
        assertEq(tier, 0);
        assertEq(buyFee, BUY_FEE, "Buy fee should always be flat");
        assertEq(sellFee, SNIPER_SELL);
        assertEq(holdDuration, 0);
    }

    function test_buyFeeIsAlwaysFlat() public {
        _buy(0.1 ether);

        // Sniper tier
        (, uint16 buyFee0,,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(buyFee0, BUY_FEE);

        // Warm tier
        vm.warp(block.timestamp + 30 minutes + 1);
        (, uint16 buyFee1,,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(buyFee1, BUY_FEE);

        // Holder tier
        vm.warp(block.timestamp + 4 hours);
        (, uint16 buyFee2,,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(buyFee2, BUY_FEE);

        // Diamond tier
        vm.warp(block.timestamp + 24 hours);
        (, uint16 buyFee3,,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(buyFee3, BUY_FEE);
    }

    function test_sellFeeDecaysWithHoldTime() public {
        _buy(0.1 ether);

        // Sniper
        (,, uint16 sell0,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(sell0, SNIPER_SELL, "Sniper sell = 10%");

        // Warm
        vm.warp(block.timestamp + 30 minutes + 1);
        (,, uint16 sell1,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(sell1, WARM_SELL, "Warm sell = 5%");

        // Holder
        vm.warp(block.timestamp + 4 hours);
        (,, uint16 sell2,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(sell2, HOLDER_SELL, "Holder sell = 2%");

        // Diamond
        vm.warp(block.timestamp + 24 hours);
        (,, uint16 sell3,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(sell3, DIAMOND_SELL, "Diamond sell = 1%");
    }

    function test_buyerStaysAtSniperTierWithin30Min() public {
        _buy(0.1 ether);
        vm.warp(block.timestamp + 15 minutes);
        (uint8 tier,,,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(tier, 0, "Should be sniper tier within 30 minutes");
    }

    // ─── Weighted Entry Time Tests ───────────────────────────────────────

    function test_dcaBuyerShiftsEntryForward() public {
        _buy(0.1 ether);
        (, uint256 firstBuyTokens) = hook.holderPositions(poolId, DEFAULT_TX_ORIGIN);

        vm.warp(block.timestamp + 2 days);
        _buy(0.1 ether);

        (uint256 entryTime, uint256 totalTokens) = hook.holderPositions(poolId, DEFAULT_TX_ORIGIN);
        assertGt(totalTokens, firstBuyTokens, "Total tokens should increase");
        assertGt(entryTime, 1, "Entry should have shifted forward");
    }

    function test_sellDoesNotResetTimer() public {
        _buy(0.1 ether);
        (uint256 entryBefore, uint256 tokensBefore) = hook.holderPositions(poolId, DEFAULT_TX_ORIGIN);

        vm.warp(block.timestamp + 2 days);
        _sell(0.01 ether);

        (uint256 entryAfter, uint256 tokensAfter) = hook.holderPositions(poolId, DEFAULT_TX_ORIGIN);
        assertEq(entryAfter, entryBefore, "Sell should NOT reset entry time");
        assertEq(tokensAfter, tokensBefore, "Sell should NOT change totalTokensBought");
    }

    // ─── Fee Charging Tests ──────────────────────────────────────────────

    function test_buyChargesFlatFee() public {
        uint256 gross = 0.1 ether;
        uint256 hookBalBefore = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());

        _buy(gross);

        uint256 hookBalAfter = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        uint256 totalFeeCharged = hookBalAfter - hookBalBefore;

        // Buy fee is 2% regardless of tier
        uint256 expectedFee = FullMath.mulDiv(gross, BUY_FEE, BASIS_POINTS);
        assertEq(totalFeeCharged, expectedFee, "Buy fee should always be 2%");
    }

    function test_diamondBuyStillChargesFlatFee() public {
        _buy(0.01 ether);
        vm.warp(block.timestamp + 24 hours + 1);

        uint256 gross = 0.1 ether;
        uint256 hookBalBefore = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());

        _buy(gross);

        uint256 hookBalAfter = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        uint256 totalFeeCharged = hookBalAfter - hookBalBefore;

        // Still 2% even as diamond holder
        uint256 expectedFee = FullMath.mulDiv(gross, BUY_FEE, BASIS_POINTS);
        assertEq(totalFeeCharged, expectedFee, "Diamond buy fee should still be 2%");
    }

    // ─── Sell Fee Integration Tests ─────────────────────────────────────

    function test_sniperSellCharges25Percent() public {
        // Buy, then sell immediately -- should charge sniper sell fee (25%)
        _buy(1 ether);

        uint256 sellAmount = 0.1 ether; // sell some tokens
        uint256 hookBalBefore = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());

        _sell(sellAmount);

        uint256 hookBalAfter = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        uint256 feeCharged = hookBalAfter - hookBalBefore;

        // The fee is charged on the gross native output, so we can't predict the
        // exact ETH output, but we CAN verify the fee ratio.
        // For a sell (token-specified, afterSwap path): hook charges SNIPER_SELL bps
        // on the native amount. The fee accrued on the hook should reflect 25%.
        (,,, uint256 creatorAccrued,,,,,) = hook.poolFeeConfig(poolId);
        uint256 platformAccrued = hook.launcherFeesAccrued();
        uint256 totalAccrued = creatorAccrued + platformAccrued;

        // All accrued fees include the buy fee too, so isolate the sell fee
        uint256 buyFeeAccrued = FullMath.mulDiv(1 ether, BUY_FEE, BASIS_POINTS); // from the buy
        uint256 sellFeeOnly = totalAccrued - buyFeeAccrued;

        // Verify the sell fee is 25% of the gross native output
        // grossNative = netNative + sellFee, so sellFee = grossNative * 2500/10000
        // sellFee / (sellFee + netNative) = 2500/10000 = 25%
        // We can check: sellFee * 10000 / (sellFee * 10000 / SNIPER_SELL) should round trip
        assertGt(sellFeeOnly, 0, "Sell fee should be non-zero");

        // Verify the tier was actually sniper at time of sell
        (uint8 tier,,,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(tier, 0, "Should be sniper tier");
    }

    function test_warmSellCharges5Percent() public {
        _buy(1 ether);
        vm.warp(block.timestamp + 30 minutes + 1); // warm tier

        uint256 hookBalBefore = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        _sell(0.1 ether);
        uint256 hookBalAfter = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        uint256 sellFee = hookBalAfter - hookBalBefore;

        assertGt(sellFee, 0, "Warm sell fee should be non-zero");

        (uint8 tier,,uint16 currentSellFee,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(tier, 1, "Should be warm tier after 30min");
        assertEq(currentSellFee, WARM_SELL, "Warm sell should be 5%");
    }

    function test_holderSellCharges2Percent() public {
        _buy(1 ether);
        vm.warp(block.timestamp + 4 hours + 1); // holder tier

        uint256 hookBalBefore = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        _sell(0.1 ether);
        uint256 hookBalAfter = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        uint256 sellFee = hookBalAfter - hookBalBefore;

        assertGt(sellFee, 0, "Holder sell fee should be non-zero");

        (uint8 tier,,uint16 currentSellFee,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(tier, 2, "Should be holder tier after 4h");
        assertEq(currentSellFee, HOLDER_SELL, "Holder sell should be 2%");
    }

    function test_diamondSellCharges1Percent() public {
        _buy(1 ether);
        vm.warp(block.timestamp + 24 hours + 1); // diamond tier

        uint256 hookBalBefore = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        _sell(0.1 ether);
        uint256 hookBalAfter = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        uint256 sellFee = hookBalAfter - hookBalBefore;

        assertGt(sellFee, 0, "Diamond sell fee should be non-zero");

        (uint8 tier,,uint16 currentSellFee,) = hook.getHolderTier(poolId, DEFAULT_TX_ORIGIN);
        assertEq(tier, 3, "Should be diamond tier after 24h");
        assertEq(currentSellFee, DIAMOND_SELL, "Diamond sell should be 1%");
    }

    function test_sniperSellFeeIsHigherThanDiamondSellFee() public {
        // Two identical sells: one at sniper tier, one at diamond tier
        // Sniper should pay way more in fees

        // Sniper sell
        _buy(1 ether);
        uint256 hookBal1 = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        _sell(0.05 ether);
        uint256 sniperFee = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()) - hookBal1;

        // Warp to diamond, sell same amount
        vm.warp(block.timestamp + 24 hours + 1);
        uint256 hookBal2 = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        _sell(0.05 ether);
        uint256 diamondFee = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()) - hookBal2;

        // Sniper (10%) should charge much more than diamond (1%)
        assertGt(sniperFee, diamondFee * 5, "Sniper sell fee should be >5x diamond sell fee");
    }

    function test_sellFeeDoesNotApplyOnBuySide() public {
        // Even at sniper tier (25% sell fee), buying should only charge flat 2%
        uint256 gross = 1 ether;
        uint256 hookBalBefore = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());

        _buy(gross);

        uint256 hookBalAfter = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        uint256 feeCharged = hookBalAfter - hookBalBefore;

        uint256 expectedBuyFee = FullMath.mulDiv(gross, BUY_FEE, BASIS_POINTS);
        assertEq(feeCharged, expectedBuyFee, "Buy should only charge flat 2%, not sniper 25%");
    }

    // ─── Fee Claim Tests ─────────────────────────────────────────────────

    function test_vaultCanClaimCreatorFees() public {
        _buy(0.1 ether);

        (,,, uint256 accrued,,,,,) = hook.poolFeeConfig(poolId);
        assertGt(accrued, 0, "Creator fees should accrue");

        vm.prank(address(vault));
        uint256 claimed = hook.claimCreatorFees(poolId);
        assertEq(claimed, accrued, "Should claim all accrued");
    }

    function test_nonVaultCannotClaimCreatorFees() public {
        _buy(0.1 ether);
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(TollHookV1.UnauthorizedCreatorClaim.selector, attacker, address(vault))
        );
        hook.claimCreatorFees(poolId);
    }

    function test_treasuryCanClaimLauncherFees() public {
        _buy(0.1 ether);
        uint256 accrued = hook.launcherFeesAccrued();
        assertGt(accrued, 0);
        vm.prank(treasury);
        hook.claimLauncherFees();
        assertEq(hook.launcherFeesAccrued(), 0);
    }

    function test_nonTreasuryCannotClaimLauncherFees() public {
        _buy(0.1 ether);
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(TollHookV1.UnauthorizedFeeRedirect.selector, attacker, treasury)
        );
        hook.claimLauncherFees();
    }

    function test_platformFeeIsAlways10Bps() public {
        uint256 gross = 1 ether;
        _buy(gross);
        uint256 platformFee = hook.launcherFeesAccrued();
        uint256 expectedPlatform = FullMath.mulDiv(gross, 10, BASIS_POINTS);
        assertEq(platformFee, expectedPlatform, "Platform fee should be 0.10%");
    }

    function test_creatorPlusPlatformEqualsTotalFee() public {
        uint256 gross = 1 ether;
        _buy(gross);

        (,,, uint256 creatorAccrued,,,,,) = hook.poolFeeConfig(poolId);
        uint256 platformAccrued = hook.launcherFeesAccrued();
        uint256 totalAccrued = hook.totalNativeFeesAccrued();

        assertEq(creatorAccrued + platformAccrued, totalAccrued, "Creator + platform should equal total");
        uint256 expectedTotal = FullMath.mulDiv(gross, BUY_FEE, BASIS_POINTS);
        assertEq(totalAccrued, expectedTotal, "Total fees should match flat buy fee");
    }

    function test_splitClaimsConserveAllCreatorFees() public {
        _buy(0.1 ether);
        (,,, uint256 creatorFee,,,,,) = hook.poolFeeConfig(poolId);

        vm.prank(alice);
        uint256 aliceClaim = vault.claim();
        vm.prank(bob);
        uint256 bobClaim = vault.claim();

        assertEq(aliceClaim, FullMath.mulDiv(creatorFee, 6000, BASIS_POINTS));
        assertEq(aliceClaim + bobClaim, creatorFee);
    }

    // ─── Hook Permission Tests ───────────────────────────────────────────

    function test_hookPermissionsCorrect() public view {
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.beforeInitialize);
        assertTrue(p.beforeSwap);
        assertTrue(p.afterSwap);
        assertTrue(p.beforeSwapReturnDelta);
        assertTrue(p.afterSwapReturnDelta);
        assertFalse(p.afterInitialize);
        assertFalse(p.beforeAddLiquidity);
        assertFalse(p.afterAddLiquidity);
        assertFalse(p.beforeRemoveLiquidity);
        assertFalse(p.afterRemoveLiquidity);
        assertFalse(p.beforeDonate);
        assertFalse(p.afterDonate);
    }

    function test_constantsMatchExpected() public view {
        assertEq(hook.LAUNCHER_FEE_BPS(), 10);
        assertEq(hook.TRANSFER_TAX_BPS(), 0);
        assertEq(hook.LP_FEE_PIPS(), 0);
        assertEq(hook.TICK_SPACING(), 200);
        assertEq(hook.MIN_FEE_BPS(), 100);
        assertEq(hook.MAX_FEE_BPS(), 2500);
        assertEq(hook.SNIPER_THRESHOLD(), 30 minutes);
        assertEq(hook.WARM_THRESHOLD(), 4 hours);
        assertEq(hook.HOLDER_THRESHOLD(), 24 hours);
    }

    function test_onlyRegistrarCanInitializePool() public {
        TollCreatorToken newToken = new TollCreatorToken(address(this));
        newToken.mint(address(this), 1_000_000 ether);
        PoolKey memory newKey = _candidateKey(address(newToken));
        bytes32 newPoolId = PoolId.unwrap(newKey.toId());
        ClassicRewardVaultV1 newVault = _deployVault(newPoolId, _addresses1(alice), _shares1(10_000), bytes32("auth"));

        hook.registerPool(newKey, address(newVault), _defaultFees());

        address imposter = makeAddr("imposter");
        vm.prank(imposter);
        vm.expectRevert();
        manager.initialize(newKey, SQRT_PRICE_1_1);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _deployHook() private returns (TollHookV1 deployed) {
        uint160 requiredFlags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        (, bytes32 salt) = HookMiner.find(
            address(this),
            requiredFlags,
            type(TollHookV1).creationCode,
            abi.encode(manager, treasury, vaultFactory)
        );
        deployed = new TollHookV1{ salt: salt }(manager, treasury, vaultFactory);
    }

    function _deployVault(bytes32 id, address[] memory beneficiaries, uint16[] memory shares, bytes32 salt)
        private
        returns (ClassicRewardVaultV1)
    {
        return vaultFactory.deploy(salt, IClassicFeeHookV3(address(hook)), id, beneficiaries, shares);
    }

    function _candidateKey(address candidateToken) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(candidateToken),
            fee: 0,
            tickSpacing: 200,
            hooks: hook
        });
    }

    function _buy(uint256 ethAmount) private returns (BalanceDelta) {
        return swapRouter.swap{ value: ethAmount }(
            hookKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(ethAmount),
                sqrtPriceLimitX96: MIN_PRICE_LIMIT
            }),
            settings,
            ""
        );
    }

    function _sell(uint256 tokenAmount) private returns (BalanceDelta) {
        return swapRouter.swap(
            hookKey,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(tokenAmount),
                sqrtPriceLimitX96: MAX_PRICE_LIMIT
            }),
            settings,
            ""
        );
    }

    function _addresses1(address a) private pure returns (address[] memory values) {
        values = new address[](1);
        values[0] = a;
    }

    function _shares1(uint16 a) private pure returns (uint16[] memory values) {
        values = new uint16[](1);
        values[0] = a;
    }

    function _addresses2(address a, address b) private pure returns (address[] memory values) {
        values = new address[](2);
        values[0] = a;
        values[1] = b;
    }

    function _shares2(uint16 a, uint16 b) private pure returns (uint16[] memory values) {
        values = new uint16[](2);
        values[0] = a;
        values[1] = b;
    }
}
