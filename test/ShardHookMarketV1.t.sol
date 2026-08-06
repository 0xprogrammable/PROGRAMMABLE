// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, console2 } from "forge-std/Test.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IERC20Minimal } from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "../src/ShardLaunchFactoryV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { ShardNFTV1 } from "../src/ShardNFTV1.sol";
import { GeometricRendererV1 } from "../src/GeometricRendererV1.sol";
import { ShardErrorsV1 } from "../src/ShardErrorsV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";
import { IShardNFTV1 } from "../src/interfaces/IShardNFTV1.sol";
import { ShardLaunchLib } from "./utils/ShardLaunchLib.sol";

/*//////////////////////////////////////////////////////////////
                              ROUTER
//////////////////////////////////////////////////////////////*/

contract MarketSwapRouter is IUnlockCallback {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    receive() external payable { }

    function swap(PoolKey memory key, SwapParams memory params) external payable returns (BalanceDelta delta) {
        delta = abi.decode(poolManager.unlock(abi.encode(msg.sender, key, params)), (BalanceDelta));
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok,) = msg.sender.call{ value: bal }("");
            require(ok, "refund failed");
        }
    }

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (address sender, PoolKey memory key, SwapParams memory params) =
            abi.decode(rawData, (address, PoolKey, SwapParams));
        BalanceDelta delta = poolManager.swap(key, params, "");
        _resolve(key.currency0, delta.amount0(), sender);
        _resolve(key.currency1, delta.amount1(), sender);
        return abi.encode(delta);
    }

    function _resolve(Currency currency, int128 amount, address sender) internal {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            if (currency.isAddressZero()) {
                poolManager.settle{ value: owed }();
            } else {
                poolManager.sync(currency);
                IERC20Minimal(Currency.unwrap(currency)).transferFrom(sender, address(poolManager), owed);
                poolManager.settle();
            }
        } else if (amount > 0) {
            poolManager.take(currency, sender, uint256(uint128(amount)));
        }
    }
}

/// @dev Re-enters claim() on receipt. Solady's ReentrancyGuard must stop it.
contract ReentrantClaimer {
    ShardHookV1 public hook;
    bool public armed;

    function arm(ShardHookV1 h) external {
        hook = h;
        armed = true;
    }

    uint256[] internal ids;

    function setIds(uint256 id) external {
        ids.push(id);
    }

    function go() external returns (uint256) {
        return hook.claim(ids);
    }

    receive() external payable {
        if (armed) {
            armed = false;
            hook.claim(ids);
        }
    }
}

/*//////////////////////////////////////////////////////////////
                               TESTS
//////////////////////////////////////////////////////////////*/

contract ShardHookMarketV1Test is Test {
    using StateLibrary for IPoolManager;

    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_UPPER = 115_080;
    int24 internal constant TICK_BAND = 22_980; // ~0.1 ETH per NFT, the concentrated band edge
    int24 internal TICK_LOWER;

    uint256 internal constant SEED_AMOUNT = 10_000 ether;
    uint256 internal constant ONE_SHARD = 1 ether;
    uint256 internal constant FEE_BPS = 100;
    uint256 internal constant BPS = 10_000;

    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    IPoolManager internal manager;
    ShardLaunchFactoryV1 internal factory;
    ShardTokenV1 internal shard;
    GeometricRendererV1 internal renderer;
    ShardHookV1 internal hook;
    ShardNFTV1 internal nft;
    MarketSwapRouter internal swapRouter;

    PoolKey internal key;
    PoolId internal poolId;
    uint160 internal startSqrtPriceX96;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal constant launcher = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal builder = makeAddr("builder");

    uint256 internal constant FAR = 1e18; // deadline far in the future

    /// @dev The hook caps a single third-party swap at MAX_BATCH SHARD (50e18). At TICK_UPPER
    ///      the price is ~1e-5 ETH per SHARD, so third-party flow here is sized in fractions of
    ///      a milli-ETH: this buys ~39 SHARD, inside the cap, and still leaves a fee above dust.
    uint256 internal constant UNDER_CAP_ETH = 0.0004 ether;

    function setUp() public {
        TICK_LOWER = TickMath.minUsableTick(TICK_SPACING);
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        manager = IPoolManager(address(new PoolManager(address(this))));
        factory = new ShardLaunchFactoryV1(manager, keccak256(type(ShardHookV1).creationCode));
        swapRouter = new MarketSwapRouter(manager);
        ShardLaunchFactoryV1.LaunchParams memory params = ShardLaunchFactoryV1.LaunchParams({
            tickLower: TICK_LOWER,
            tickBand: TICK_BAND,
            tickUpper: TICK_UPPER,
            startSqrtPriceX96: startSqrtPriceX96,
            builderFeeRecipient: builder
        });
        (hook, shard, nft,) =
            ShardLaunchLib.mineAndLaunch(factory, keccak256("ShardHookMarketV1Test"), bytes32(0), params);
        renderer = factory.renderer();

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = key.toId();

        vm.deal(address(this), 10_000 ether);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    /*//////////////////////////////////////////////////////////
                              HELPERS
    //////////////////////////////////////////////////////////*/

    function test_setupUsesAtomicFactory() public view {
        assertEq(hook.deployer(), address(factory));
    }

    function _feesHeld() internal view returns (uint256) {
        return manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()) + address(hook).balance;
    }

    function _price() internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = manager.getSlot0(poolId);
    }

    function _buy(address who, uint256 send) internal returns (uint256 tokenId, uint256 spent) {
        uint256 before = who.balance;
        vm.prank(who);
        tokenId = hook.buyNFT{ value: send }(type(uint256).max, FAR);
        spent = before - who.balance;
    }

    /// @dev The core supply invariant, stated with the seedDust term that
    ///      getLiquidityForAmount1's rounding makes necessary.
    function _assertBacking() internal view {
        assertEq(
            shard.balanceOf(address(hook)),
            nft.circulatingSupply() * ONE_SHARD + hook.seedDust(),
            "shard backing != circulating NFTs"
        );
    }

    /*//////////////////////////////////////////////////////////
                        THE C1 REGRESSION TESTS
    //////////////////////////////////////////////////////////*/

    /// v4 skips a hook's own callbacks, so buyNFT MUST charge explicitly. If this reads 0,
    /// buying is free, holder revenue is zero and the art-reroll loop is wide open.
    function test_buyNftChargesOnePercentExplicitly() public {
        (, uint256 spent) = _buy(alice, 1 ether);

        uint256 fee = _feesHeld();
        assertGt(fee, 0, "buyNFT charged NO fee - the two-path design is broken");
        assertApproxEqAbs(fee, spent * FEE_BPS / BPS, 2, "buy fee != inclusive 1% of total");
    }

    function test_sellNftChargesOnePercentExplicitly() public {
        (uint256 tokenId,) = _buy(alice, 1 ether);
        uint256 feesAfterBuy = _feesHeld();

        vm.prank(alice);
        uint256 payout = hook.sellNFT(tokenId, 0, FAR);

        uint256 sellFee = _feesHeld() - feesAfterBuy;
        assertGt(sellFee, 0, "sellNFT charged NO fee");
        assertApproxEqAbs(sellFee, (payout + sellFee) * FEE_BPS / BPS, 2, "sell fee != 1% of gross released");
    }

    /// The two paths must be mutually exclusive: a hook-initiated swap must not ALSO
    /// trigger the callback path.
    function test_hookSelfSwapDoesNotDoubleCharge() public {
        (, uint256 spent) = _buy(alice, 1 ether);
        // Exactly one 1% charge, not two.
        assertApproxEqAbs(_feesHeld(), spent * FEE_BPS / BPS, 2, "double-charged");
    }

    function test_feeBasisIsInclusiveOnBuy() public {
        (, uint256 spent) = _buy(alice, 1 ether);
        uint256 fee = _feesHeld();
        // fee is 1% of the TOTAL paid, not 1% of the curve cost (which would be 0.990%).
        assertApproxEqAbs(fee * BPS / spent, FEE_BPS, 1, "not an inclusive 1%");
    }

    /// Both entry paths must cost the same, or one is quietly cheaper and arbitrageable.
    function test_buyNftAndSwapThenRedeemCostTheSame() public {
        (, uint256 buyCost) = _buy(alice, 1 ether);

        // Now the other way: swap ETH for exactly 1 SHARD via a router, then redeem.
        uint256 before = bob.balance;
        vm.startPrank(bob);
        swapRouter.swap{ value: 1 ether }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: int256(ONE_SHARD), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        uint256 swapCost = before - bob.balance;
        shard.approve(address(hook), type(uint256).max);
        hook.redeem();
        vm.stopPrank();

        // Both bought one NFT's worth. The second buy walks slightly further up the curve,
        // so allow for curve movement, not for a rate difference.
        assertApproxEqRel(swapCost, buyCost, 0.02e18, "entry paths diverge in cost");
    }

    /// A buy/sell round trip must cost ~2%, which is what prices the art-reroll loop out.
    function test_buyThenSellRoundTripCostsAboutTwoPercent() public {
        (uint256 tokenId, uint256 spent) = _buy(alice, 1 ether);

        vm.prank(alice);
        uint256 payout = hook.sellNFT(tokenId, 0, FAR);

        uint256 loss = spent - payout;
        assertGt(loss, spent * 15 / 1000, "round trip cost less than 1.5% - reroll is too cheap");
        assertLt(loss, spent * 30 / 1000, "round trip cost more than 3%");
    }

    /*//////////////////////////////////////////////////////////
                                BUY
    //////////////////////////////////////////////////////////*/

    function test_buyNftMintsAndChargesBondingCurvePrice() public {
        (uint256 tokenId, uint256 spent) = _buy(alice, 1 ether);
        assertEq(tokenId, 1, "first id should be 1");
        assertEq(nft.ownerOf(1), alice, "buyer does not own it");
        assertGt(spent, 0, "nothing charged");
        assertEq(nft.circulatingSupply(), 1, "circulating not tracked");
        _assertBacking();
    }

    function test_buyNftRefundsExcessEth() public {
        (, uint256 spent) = _buy(alice, 500 ether);
        assertLt(spent, 1 ether, "excess not refunded");
    }

    function test_buyNftRevertsOnInsufficientEth() public {
        vm.prank(alice);
        vm.expectRevert();
        hook.buyNFT{ value: 1 }(type(uint256).max, FAR);
    }

    function test_buyNftRespectsMaxEthIn() public {
        vm.prank(alice);
        vm.expectRevert();
        hook.buyNFT{ value: 1 ether }(1, FAR); // maxEthIn of 1 wei
    }

    function test_deadlineIsEnforced() public {
        vm.warp(1000);
        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.Expired.selector);
        hook.buyNFT{ value: 1 ether }(type(uint256).max, 999);
    }

    /// A buy must never dip into ETH already owed to fee claimants.
    /// @dev `assertGe` here would be near-vacuous: the hook's balance always grows by the
    ///      new buy's fee, so a buy that quietly consumed some holder ETH would still leave
    ///      the balance higher and the test green. Assert the balance grew by EXACTLY the
    ///      fee — any dip into holder ETH shows up as a shortfall.
    function test_buyNftCannotSpendHolderFeeEth() public {
        _buy(alice, 1 ether);
        uint256 holderEthBefore = address(hook).balance;
        assertGt(holderEthBefore, 0, "no holder ETH to protect - test would be vacuous");

        (, uint256 spent) = _buy(bob, 1 ether);

        uint256 gained = address(hook).balance - holderEthBefore;
        assertApproxEqAbs(gained, spent * FEE_BPS / BPS, 2, "buy did not contribute exactly its own fee");
    }

    function test_priceRisesAsSupplyIsBought() public {
        uint160 p0 = _price();
        _buy(alice, 1 ether);
        uint160 p1 = _price();
        _buy(bob, 1 ether);
        uint160 p2 = _price();
        // Buying SHARD moves the tick DOWN, so sqrtPriceX96 decreases as SHARD gets pricier.
        assertLt(p1, p0, "price did not move on first buy");
        assertLt(p2, p1, "price did not move on second buy");
    }

    /*//////////////////////////////////////////////////////////
                                SELL
    //////////////////////////////////////////////////////////*/

    function test_sellNftReturnsEthToSeller() public {
        (uint256 tokenId,) = _buy(alice, 1 ether);
        uint256 before = alice.balance;

        vm.prank(alice);
        uint256 payout = hook.sellNFT(tokenId, 0, FAR);

        assertEq(alice.balance - before, payout, "payout not delivered");
        assertGt(payout, 0, "no payout");
    }

    function test_sellNftReleasesIdBackToPool() public {
        (uint256 tokenId,) = _buy(alice, 1 ether);
        vm.prank(alice);
        hook.sellNFT(tokenId, 0, FAR);

        assertTrue(nft.isPoolHeld(tokenId), "id not returned to the archive");
        assertEq(nft.ownerOf(tokenId), address(nft), "archive does not hold it");
        assertEq(nft.circulatingSupply(), 0, "still counted as circulating");
        _assertBacking();
    }

    function test_sellNftDestroysArt() public {
        (uint256 tokenId,) = _buy(alice, 1 ether);
        assertGt(nft.tokenSeed(tokenId), 0, "no seed after buy");

        vm.prank(alice);
        hook.sellNFT(tokenId, 0, FAR);

        assertEq(nft.tokenSeed(tokenId), 0, "art survived the sale");
    }

    function test_sellNftRespectsMinEthOut() public {
        (uint256 tokenId,) = _buy(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        hook.sellNFT(tokenId, 1000 ether, FAR);
    }

    function test_sellNftRevertsIfNotOwner() public {
        (uint256 tokenId,) = _buy(alice, 1 ether);
        vm.prank(bob);
        vm.expectRevert();
        hook.sellNFT(tokenId, 0, FAR);
    }

    /// Ordering guarantee: the seller settles OUT before their own exit fee distributes.
    function test_sellNftSellerDoesNotEarnFromOwnExitFee() public {
        (uint256 tokenIdA,) = _buy(alice, 1 ether);
        (uint256 tokenIdB,) = _buy(bob, 1 ether);
        vm.roll(block.number + 1); // clear the same-block accrual guard

        vm.prank(alice);
        hook.sellNFT(tokenIdA, 0, FAR);

        // Alice is out of the earning set before her fee lands; bob takes all of it.
        assertEq(hook.claimable(alice), 0, "seller earned from their own exit fee");
        assertEq(nft.ownerOf(tokenIdB), bob, "sanity: bob still holds his");
    }

    function test_priceFallsAfterSelling() public {
        (uint256 tokenId,) = _buy(alice, 1 ether);
        uint160 afterBuy = _price();

        vm.prank(alice);
        hook.sellNFT(tokenId, 0, FAR);

        assertGt(_price(), afterBuy, "price did not recover after a sale");
    }

    /*//////////////////////////////////////////////////////////
                           REDEEM / NO REVERSE
    //////////////////////////////////////////////////////////*/

    function test_redeemConvertsOneShardToNft() public {
        vm.startPrank(alice);
        swapRouter.swap{ value: 5 ether }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: int256(ONE_SHARD), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        shard.approve(address(hook), type(uint256).max);
        uint256 tokenId = hook.redeem();
        vm.stopPrank();

        assertEq(nft.ownerOf(tokenId), alice, "redeemer does not own it");
        _assertBacking();
    }

    function test_redeemChargesNoAdditionalFee() public {
        vm.startPrank(alice);
        swapRouter.swap{ value: 5 ether }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: int256(ONE_SHARD), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        uint256 feesAfterSwap = _feesHeld();
        shard.approve(address(hook), type(uint256).max);
        hook.redeem();
        vm.stopPrank();

        assertEq(_feesHeld(), feesAfterSwap, "redeem charged a second fee");
    }

    function test_thereIsNoNftToShardPath() public view {
        // The asymmetry is deliberate: shards can become an NFT, an NFT can only become ETH.
        // Without it, deposit-then-redeem would be a free art reroll.
        assertEq(address(hook).code.length > 0 ? uint256(1) : uint256(0), 1, "hook has no code");
        bytes4[3] memory forbidden = [
            bytes4(keccak256("deposit(uint256)")),
            bytes4(keccak256("depositNFT(uint256)")),
            bytes4(keccak256("unwrap(uint256)"))
        ];
        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok,) = address(hook).staticcall(abi.encodeWithSelector(forbidden[i], 1));
            assertFalse(ok, "an NFT-to-SHARD path exists");
        }
    }

    /*//////////////////////////////////////////////////////////
                               CLAIM
    //////////////////////////////////////////////////////////*/

    function test_claimSweepsClaimsThenPays() public {
        _buy(alice, 1 ether);
        vm.roll(block.number + 1);

        // A third-party swap accrues its fee as an ERC-6909 claim, not real ETH. Sized to the
        // 50 SHARD swap cap; what matters here is that a fee accrued at all.
        swapRouter.swap{ value: UNDER_CAP_ETH }(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(UNDER_CAP_ETH),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        assertGt(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), 0, "no 6909 claims accrued");

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 paid = hook.claim(ids);

        assertGt(paid, 0, "nothing paid");
        assertEq(alice.balance - before, paid, "ETH did not arrive");
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), 0, "claims not swept");
    }

    function test_claimRevertsWhenNothingOwed() public {
        vm.prank(bob);
        vm.expectRevert(ShardErrorsV1.NothingToClaim.selector);
        hook.claim(new uint256[](0));
    }

    function test_reentrantClaimReverts() public {
        ReentrantClaimer attacker = new ReentrantClaimer();
        vm.deal(address(attacker), 1 ether);

        vm.prank(address(attacker));
        hook.buyNFT{ value: 1 ether }(type(uint256).max, FAR);
        vm.roll(block.number + 1);

        // Sized to the 50 SHARD swap cap; this swap only exists to accrue a fee to re-enter on.
        swapRouter.swap{ value: UNDER_CAP_ETH }(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(UNDER_CAP_ETH),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );

        attacker.setIds(1);
        attacker.arm(hook);
        vm.expectRevert();
        attacker.go();
    }

    /*//////////////////////////////////////////////////////////
                               WIRING
    //////////////////////////////////////////////////////////*/

    function test_setNftOnlyDeployerAndOneShot() public {
        vm.prank(bob);
        vm.expectRevert(ShardErrorsV1.NotDeployer.selector);
        hook.setNFT(IShardNFTV1(address(0xDEAD)));

        vm.prank(address(factory));
        vm.expectRevert(ShardErrorsV1.AlreadyInitialised.selector);
        hook.setNFT(IShardNFTV1(address(0xDEAD)));
    }

    function test_settleOnTransferOnlyCallableByNft() public {
        vm.prank(bob);
        vm.expectRevert(ShardErrorsV1.NotNFT.selector);
        hook.settleOnTransfer(1, bob, alice);
    }

    /*//////////////////////////////////////////////////////////
                            THE INVARIANT
    //////////////////////////////////////////////////////////*/

    function test_shardBackingInvariantHolds() public {
        _assertBacking();
        (uint256 a,) = _buy(alice, 1 ether);
        _assertBacking();
        _buy(bob, 1 ether);
        _assertBacking();
        vm.prank(alice);
        hook.sellNFT(a, 0, FAR);
        _assertBacking();
    }

    function testFuzz_invariantHoldsUnderRandomSequence(uint8 ops) public {
        uint256 n = uint256(ops) % 8 + 1;
        uint256[] memory held = new uint256[](n);
        uint256 count;

        for (uint256 i = 0; i < n; i++) {
            if (count == 0 || i % 3 != 2) {
                (uint256 id,) = _buy(alice, 5 ether);
                held[count++] = id;
            } else {
                uint256 id = held[--count];
                vm.prank(alice);
                hook.sellNFT(id, 0, FAR);
            }
            vm.roll(block.number + 1);
            _assertBacking();
        }
    }

    receive() external payable { }
}
