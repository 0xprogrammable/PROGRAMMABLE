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

/// @dev Minimal third-party router, so the callback fee path can be told apart from the
///      explicit fee the batch entry points must charge themselves.
contract BatchSwapRouter is IUnlockCallback {
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

/*//////////////////////////////////////////////////////////////
                               TESTS
//////////////////////////////////////////////////////////////*/

contract ShardHookBatchV1Test is Test {
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
    BatchSwapRouter internal swapRouter;

    PoolKey internal key;
    PoolId internal poolId;
    uint160 internal startSqrtPriceX96;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal launcher = makeAddr("launcher");
    address internal builder = makeAddr("builder");

    uint256 internal constant FAR = 1e18; // deadline far in the future

    function setUp() public {
        TICK_LOWER = TickMath.minUsableTick(TICK_SPACING);
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        manager = IPoolManager(address(new PoolManager(address(this))));
        factory = new ShardLaunchFactoryV1(manager, launcher, keccak256(type(ShardHookV1).creationCode));
        swapRouter = new BatchSwapRouter(manager);
        ShardLaunchFactoryV1.LaunchParams memory params = ShardLaunchFactoryV1.LaunchParams({
            tickLower: TICK_LOWER,
            tickBand: TICK_BAND,
            tickUpper: TICK_UPPER,
            startSqrtPriceX96: startSqrtPriceX96,
            builderFeeRecipient: builder
        });
        (hook, shard, nft,) =
            ShardLaunchLib.mineAndLaunch(factory, keccak256("ShardHookBatchV1Test"), bytes32(0), params);
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

    function _buy(address who, uint256 send) internal returns (uint256 tokenId, uint256 spent) {
        uint256 before = who.balance;
        vm.prank(who);
        tokenId = hook.buyNFT{ value: send }(type(uint256).max, FAR);
        spent = before - who.balance;
    }

    function _buyMany(address who, uint256 count, uint256 send) internal returns (uint256[] memory ids, uint256 spent) {
        uint256 before = who.balance;
        vm.prank(who);
        ids = hook.buyMany{ value: send }(count, type(uint256).max, FAR);
        spent = before - who.balance;
    }

    function _buyMax(address who, uint256 send) internal returns (uint256[] memory ids, uint256 spent) {
        uint256 before = who.balance;
        vm.prank(who);
        ids = hook.buyMax{ value: send }(0, FAR);
        spent = before - who.balance;
    }

    /// @dev The core supply invariant, stated with the seedDust term that
    ///      getLiquidityForAmount1's rounding makes necessary.
    function _assertBacking() internal view {
        assertEq(
            shard.balanceOf(address(hook)),
            nft.circulatingSupply() * 1e18 + hook.seedDust(),
            "shard backing != circulating NFTs"
        );
    }

    /*//////////////////////////////////////////////////////////
                              BUY MANY
    //////////////////////////////////////////////////////////*/

    function test_buyManyMintsExactlyCount() public {
        (uint256[] memory ids,) = _buyMany(alice, 5, 1 ether);

        assertEq(ids.length, 5, "wrong number of ids returned");
        assertEq(nft.circulatingSupply(), 5, "circulating supply wrong");
        for (uint256 i; i < ids.length; ++i) {
            assertEq(nft.ownerOf(ids[i]), alice, "buyer does not own a minted id");
        }
        _assertBacking();
    }

    /// THE regression: v4 skips this hook's own callbacks, so buyMany must charge the 1%
    /// itself. If this reads 0, bulk buying is free and holder revenue collapses.
    function test_buyManyChargesOnePercentInclusiveOnce() public {
        (, uint256 spent) = _buyMany(alice, 5, 1 ether);

        uint256 fee = _feesHeld();
        assertGt(fee, 0, "buyMany charged NO fee - bulk buying is free");
        // Inclusive: 1% of the TOTAL paid, charged exactly once (not twice, not 0.990%).
        assertApproxEqAbs(fee, spent * FEE_BPS / BPS, 2, "batch fee != inclusive 1% of total");
    }

    function test_buyManyIsCheaperThanLoopingBuyNFT() public {
        // Warm the pool/hook storage so neither measurement eats the cold-slot cost.
        _buy(address(this), 0.1 ether);

        uint256 gasBefore = gasleft();
        for (uint256 i; i < 5; ++i) {
            vm.prank(bob);
            hook.buyNFT{ value: 0.1 ether }(type(uint256).max, FAR);
        }
        uint256 loopGas = gasBefore - gasleft();

        gasBefore = gasleft();
        vm.prank(alice);
        hook.buyMany{ value: 0.1 ether }(5, type(uint256).max, FAR);
        uint256 batchGas = gasBefore - gasleft();

        console2.log("5x buyNFT gas:", loopGas);
        console2.log("buyMany(5) gas:", batchGas);
        assertLt(batchGas, loopGas, "batch buy is not cheaper than looping buyNFT");
    }

    function test_buyManyRefundsExcess() public {
        uint256 before = alice.balance;
        (, uint256 spent) = _buyMany(alice, 3, 1 ether);

        assertLt(spent, 1 ether, "excess ETH was not refunded");
        assertEq(alice.balance, before - spent, "refund accounting mismatch");
        // Everything the hook kept is the fee; the curve cost went to the PoolManager and the
        // rest went straight back to the buyer.
        assertApproxEqAbs(address(hook).balance, spent * FEE_BPS / BPS, 2, "hook kept more than the fee");
    }

    function test_buyManyRespectsMaxEthIn() public {
        vm.prank(alice);
        vm.expectRevert();
        hook.buyMany{ value: 1 ether }(3, 1, FAR); // maxEthIn of 1 wei
    }

    function test_buyManyRespectsDeadline() public {
        vm.warp(1000);
        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.Expired.selector);
        hook.buyMany{ value: 1 ether }(3, type(uint256).max, 999);
    }

    function test_buyManyRevertsAboveCap() public {
        uint256 max = hook.MAX_BATCH();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.BatchTooLarge.selector, max + 1, max));
        hook.buyMany{ value: 100 ether }(max + 1, type(uint256).max, FAR);
    }

    function test_buyManyRevertsOnZeroCount() public {
        uint256 max = hook.MAX_BATCH();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.BatchTooLarge.selector, 0, max));
        hook.buyMany{ value: 1 ether }(0, type(uint256).max, FAR);
    }

    function test_buyManyBackingInvariantHolds() public {
        _assertBacking();
        _buyMany(alice, 4, 1 ether);
        _assertBacking();
        vm.roll(block.number + 1);
        _buyMany(bob, 7, 1 ether);
        _assertBacking();

        (uint256[] memory ids,) = _buyMany(alice, 1, 1 ether);
        vm.prank(alice);
        hook.sellNFT(ids[0], 0, FAR);
        _assertBacking();
    }

    /// @dev A THIRD-PARTY swap may move at most `MAX_BATCH` SHARD — `_afterSwap` reverts
    ///      `SwapTooLarge` above it. The hook's own batch entry points move exactly that much
    ///      SHARD in a single swap, and must not be caught by their own cap: v4 skips a hook's
    ///      beforeSwap/afterSwap when the hook IS the swapper (Hooks.sol:253/:293), so
    ///      `buyMany(MAX_BATCH)` and `sellMany` of the same ids never reach the check.
    ///
    ///      Get this wrong and the cap silently amputates the largest batch the contract
    ///      advertises, on a contract that cannot be upgraded — while every third-party test
    ///      stays green, because they exercise the other side of the same branch.
    function test_hookOwnBatchIsNotBoundByTheSwapCap() public {
        uint256 max = hook.MAX_BATCH();
        assertEq(max * ONE_SHARD, 50 ether, "sanity: the cap is not where this test assumes");

        // Exactly MAX_BATCH SHARD out of the pool, in ONE hook-initiated swap.
        (uint256[] memory ids,) = _buyMany(alice, max, 100 ether);
        assertEq(ids.length, max, "a full batch buy was refused - the swap cap caught the hook");
        assertEq(nft.circulatingSupply(), max, "wrong supply after a full batch");
        _assertBacking();

        // And the same size back the other way, which is a hook swap too.
        vm.roll(block.number + 1);
        uint256 payout = _sellMany(alice, ids, 0);
        assertGt(payout, 0, "a full batch sell was refused - the swap cap caught the hook");
        assertEq(nft.circulatingSupply(), 0, "the batch did not fully unwind");
        _assertBacking();

        // The other side of the branch, for contrast: the SAME 50 SHARD asked for as a
        // third-party swap is allowed, and one wei more is not.
        _acquireShards(bob, max, 100 ether);
        vm.prank(bob);
        vm.expectRevert();
        swapRouter.swap{ value: 100 ether }(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: int256(max * ONE_SHARD + 1),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
    }

    /*//////////////////////////////////////////////////////////
                               BUY MAX
    //////////////////////////////////////////////////////////*/

    function test_buyMaxSpendsTheEthAndMintsWholeNfts() public {
        (uint256[] memory ids, uint256 spent) = _buyMax(alice, 0.0001 ether);

        assertGt(ids.length, 0, "buyMax minted nothing");
        assertEq(spent, 0.0001 ether, "buyMax should consume the whole msg.value");
        assertEq(nft.circulatingSupply(), ids.length, "circulating supply wrong");
        for (uint256 i; i < ids.length; ++i) {
            assertEq(nft.ownerOf(ids[i]), alice, "buyer does not own a minted id");
        }
        _assertBacking();
    }

    function test_buyMaxReturnsLeftoverShardsToCaller() public {
        uint256 before = shard.balanceOf(alice);
        _buyMax(alice, 0.0001 ether);

        assertGt(shard.balanceOf(alice) - before, 0, "leftover shards were not returned");
        assertLt(shard.balanceOf(alice) - before, ONE_SHARD, "leftover should be a fraction of one shard");
        _assertBacking();
    }

    function test_buyMaxChargesOnePercentInclusiveOnce() public {
        uint256 sent = 0.0001 ether;
        _buyMax(alice, sent);

        uint256 fee = _feesHeld();
        assertGt(fee, 0, "buyMax charged NO fee - bulk buying is free");
        assertApproxEqAbs(fee, sent * FEE_BPS / BPS, 2, "buyMax fee != inclusive 1% of ETH sent");
    }

    /// @dev Without this guard a zero-value buyMax either reverts opaquely deep inside v4 or,
    ///      with minCount 0, succeeds as a confusing no-op that mints nothing.
    function test_buyMaxRevertsOnZeroValue() public {
        vm.expectRevert(ShardErrorsV1.ZeroAmount.selector);
        hook.buyMax{ value: 0 }(0, block.timestamp + 1000);
    }

    function test_buyMaxRespectsMinCount() public {
        // 0.0001 ETH buys a handful of shards, nowhere near 40 NFTs.
        vm.prank(alice);
        vm.expectRevert();
        hook.buyMax{ value: 0.0001 ether }(40, FAR);
    }

    /// Sending more ETH than MAX_BATCH costs must REVERT, not quietly mint the cap
    /// and hand back the rest as SHARD. A buyer asking for art should never be given
    /// hundreds of tokens they then have to redeem 50 at a time.
    function test_buyMaxRevertsRatherThanExceedingTheCap() public {
        uint256 max = hook.MAX_BATCH();
        uint256 shardBefore = shard.balanceOf(alice);
        uint256 ethBefore = alice.balance;

        vm.prank(alice);
        vm.expectRevert();
        hook.buyMax{ value: 0.002 ether }(0, FAR);

        assertEq(shard.balanceOf(alice), shardBefore, "a rejected buy still moved SHARD");
        assertEq(alice.balance, ethBefore, "a rejected buy still took ETH");
        assertEq(nft.circulatingSupply(), 0, "a rejected buy still minted");
        assertLe(max, max);
        _assertBacking();
    }

    /// Just under the cap still works, and still returns only fractional SHARD.
    function test_buyMaxAtTheCapBoundaryStillMints() public {
        vm.prank(alice);
        uint256[] memory ids = hook.buyMax{ value: 0.0002 ether }(0, FAR);

        assertGt(ids.length, 0, "nothing minted below the cap");
        assertLe(ids.length, hook.MAX_BATCH(), "minted above the cap");
        assertLt(shard.balanceOf(alice), ONE_SHARD, "leftover should be a fraction of one SHARD");
        _assertBacking();
    }

    function test_buyMaxBackingInvariantHolds() public {
        _assertBacking();
        _buyMax(alice, 0.0001 ether);
        _assertBacking();
        vm.roll(block.number + 1);
        (uint256[] memory ids,) = _buyMax(bob, 0.0002 ether);
        _assertBacking();

        vm.prank(bob);
        hook.sellNFT(ids[0], 0, FAR);
        _assertBacking();
    }

    /*//////////////////////////////////////////////////////////
                          HOLDER FEE ETH
    //////////////////////////////////////////////////////////*/

    /// A batch buy must never dip into ETH already owed to fee claimants. Assert the hook's
    /// balance grew by EXACTLY the new fee — a dip shows up as a shortfall.
    function test_batchBuysCannotSpendHolderFeeEth() public {
        _buy(alice, 0.1 ether);
        uint256 holderEth = address(hook).balance;
        assertGt(holderEth, 0, "no holder ETH to protect - test would be vacuous");

        (, uint256 spent) = _buyMany(bob, 4, 0.1 ether);
        uint256 gained = address(hook).balance - holderEth;
        assertApproxEqAbs(gained, spent * FEE_BPS / BPS, 2, "buyMany did not contribute exactly its own fee");

        holderEth = address(hook).balance;
        uint256 sent = 0.0001 ether;
        _buyMax(bob, sent);
        gained = address(hook).balance - holderEth;
        assertApproxEqAbs(gained, sent * FEE_BPS / BPS, 2, "buyMax did not contribute exactly its own fee");
    }

    /*//////////////////////////////////////////////////////////
                              SELL MANY
    //////////////////////////////////////////////////////////*/

    function _sellMany(address who, uint256[] memory ids, uint256 minEthOut) internal returns (uint256 payout) {
        vm.prank(who);
        payout = hook.sellMany(ids, minEthOut, FAR);
    }

    function test_sellManyReleasesEveryIdAndPaysTheSeller() public {
        (uint256[] memory ids,) = _buyMany(alice, 5, 1 ether);

        uint256 before = alice.balance;
        uint256 payout = _sellMany(alice, ids, 0);

        assertGt(payout, 0, "sellMany paid nothing");
        assertEq(alice.balance - before, payout, "reported payout != ETH received");
        assertEq(nft.circulatingSupply(), 0, "ids were not returned to the archive");
        for (uint256 i; i < ids.length; ++i) {
            assertEq(nft.ownerOf(ids[i]), address(nft), "id did not go back to the archive");
            assertEq(nft.tokenSeed(ids[i]), 0, "art was not destroyed");
        }
        _assertBacking();
    }

    /// The sell-side twin of the buyMany regression: v4 skips this hook's own callbacks, so
    /// sellMany must charge the 1% in its own body. If this reads 0, bulk exits are free.
    function test_sellManyChargesOnePercentInclusiveOnce() public {
        (uint256[] memory ids,) = _buyMany(alice, 5, 1 ether);

        uint256 feesBefore = _feesHeld();
        uint256 payout = _sellMany(alice, ids, 0);
        uint256 fee = _feesHeld() - feesBefore;

        assertGt(fee, 0, "sellMany charged NO fee - bulk exits are free");
        // Inclusive: the pool released (payout + fee) and the fee is 1% of that gross.
        assertApproxEqAbs(fee, (payout + fee) * FEE_BPS / BPS, 2, "batch exit fee != inclusive 1% of gross");
    }

    function test_sellManyIsCheaperThanLoopingSellNFT() public {
        // Warm the shared storage so neither measurement eats the cold-slot cost.
        (uint256 warm,) = _buy(address(this), 0.1 ether);
        hook.sellNFT(warm, 0, FAR);

        (uint256[] memory bobIds,) = _buyMany(bob, 5, 1 ether);
        (uint256[] memory aliceIds,) = _buyMany(alice, 5, 1 ether);

        uint256 gasBefore = gasleft();
        for (uint256 i; i < bobIds.length; ++i) {
            vm.prank(bob);
            hook.sellNFT(bobIds[i], 0, FAR);
        }
        uint256 loopGas = gasBefore - gasleft();

        gasBefore = gasleft();
        vm.prank(alice);
        hook.sellMany(aliceIds, 0, FAR);
        uint256 batchGas = gasBefore - gasleft();

        console2.log("5x sellNFT gas:", loopGas);
        console2.log("sellMany(5) gas:", batchGas);
        assertLt(batchGas, loopGas, "batch sell is not cheaper than looping sellNFT");
    }

    function test_sellManyRespectsMinEthOut() public {
        (uint256[] memory ids,) = _buyMany(alice, 3, 1 ether);

        vm.prank(alice);
        vm.expectRevert();
        hook.sellMany(ids, 100 ether, FAR);
    }

    function test_sellManyRespectsDeadline() public {
        (uint256[] memory ids,) = _buyMany(alice, 3, 1 ether);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.Expired.selector);
        hook.sellMany(ids, 0, block.timestamp - 1);
    }

    function test_sellManyRevertsAboveCap() public {
        uint256[] memory ids = new uint256[](hook.MAX_BATCH() + 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ShardErrorsV1.BatchTooLarge.selector, hook.MAX_BATCH() + 1, hook.MAX_BATCH())
        );
        hook.sellMany(ids, 0, FAR);
    }

    function test_sellManyRevertsOnEmptyList() public {
        uint256[] memory ids = new uint256[](0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.BatchTooLarge.selector, 0, hook.MAX_BATCH()));
        hook.sellMany(ids, 0, FAR);
    }

    /// Ownership is enforced by `nft.release`'s `_transfer`, which reverts if the caller is
    /// not the holder — rolling back the accounting done a line earlier.
    function test_sellManyRejectsSomeoneElsesToken() public {
        (uint256[] memory aliceIds,) = _buyMany(alice, 2, 1 ether);

        vm.prank(bob);
        vm.expectRevert();
        hook.sellMany(aliceIds, 0, FAR);

        assertEq(nft.ownerOf(aliceIds[0]), alice, "alice lost a token to a failed sale");
    }

    /// The second copy hits an id the archive already owns, so `_transfer` reverts and the
    /// whole batch rolls back. Without this the hook would swap out shards it does not hold.
    function test_sellManyRejectsDuplicateIds() public {
        (uint256 tokenId,) = _buy(alice, 1 ether);

        uint256[] memory ids = new uint256[](2);
        ids[0] = tokenId;
        ids[1] = tokenId;

        vm.prank(alice);
        vm.expectRevert();
        hook.sellMany(ids, 0, FAR);

        assertEq(nft.ownerOf(tokenId), alice, "a duplicate batch partially executed");
        _assertBacking();
    }

    /// Every seller must leave the earning set BEFORE their own exit fee is distributed.
    /// Bob is the only holder left, so the whole fee must accrue to him.
    function test_sellManySellersDoNotEarnFromTheirOwnExitFee() public {
        (uint256 bobId,) = _buy(bob, 1 ether);
        // A holder never earns from fees taken in their own acquisition block, so bob has to
        // be one block old before alice's buy fee can accrue to him at all.
        vm.roll(block.number + 1);
        (uint256[] memory aliceIds,) = _buyMany(alice, 4, 1 ether);

        uint256[] memory bobIds = new uint256[](1);
        bobIds[0] = bobId;

        // Drain what alice's BUY fee already owes bob, so the second claim below measures the
        // exit fee alone. Rolling clears the same-block accrual guard each time.
        vm.roll(block.number + 1);
        vm.prank(bob);
        hook.claim(bobIds);

        vm.roll(block.number + 1);
        uint256 feesBefore = _feesHeld();
        uint256 payout = _sellMany(alice, aliceIds, 0);
        uint256 fee = _feesHeld() - feesBefore;
        assertGt(fee, 0, "no exit fee - test would be vacuous");

        vm.roll(block.number + 1);
        uint256 balBefore = bob.balance;
        vm.prank(bob);
        hook.claim(bobIds);

        // Bob is the sole remaining holder, so he receives the whole HOLDER share of the exit
        // fee (less rounding dust carried in the accumulator). Alice earned none of it. The
        // builder and launcher each take 10% off the top before the holder pool sees anything,
        // so the holder share is `fee - 2 * floor(fee * 1000 / 10000)`.
        uint256 holderShare = fee - 2 * (fee * 1000 / BPS);
        assertApproxEqAbs(bob.balance - balBefore, holderShare, 4, "exit fee did not go wholly to the remaining holder");
        assertGt(payout, 0, "seller was not paid");
    }

    function test_sellManyBackingInvariantHolds() public {
        (uint256[] memory a,) = _buyMany(alice, 7, 2 ether);
        _assertBacking();

        uint256[] memory half = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            half[i] = a[i];
        }
        _sellMany(alice, half, 0);
        _assertBacking();
        assertEq(nft.circulatingSupply(), 4, "wrong supply after a partial batch exit");
    }

    /*//////////////////////////////////////////////////////////
                             REDEEM MANY
    //////////////////////////////////////////////////////////*/

    /// Buys `count` whole SHARD through a THIRD-PARTY router — the path a user who bought on
    /// Uniswap arrives by, and the reason redeemMany exists at all.
    function _acquireShards(address who, uint256 count, uint256 value) internal {
        vm.prank(who);
        swapRouter.swap{ value: value }(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: int256(count * ONE_SHARD),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
    }

    function test_redeemManyMintsCountAndBurnsTheShards() public {
        _acquireShards(alice, 5, 50 ether);
        uint256 shardsBefore = shard.balanceOf(alice);

        vm.startPrank(alice);
        shard.approve(address(hook), type(uint256).max);
        uint256[] memory ids = hook.redeemMany(5);
        vm.stopPrank();

        assertEq(ids.length, 5, "wrong number of ids returned");
        assertEq(nft.circulatingSupply(), 5, "circulating supply wrong");
        for (uint256 i; i < ids.length; ++i) {
            assertEq(nft.ownerOf(ids[i]), alice, "redeemer does not own a minted id");
            assertGt(nft.tokenSeed(ids[i]), 0, "redeemed id has no art");
        }
        assertEq(shardsBefore - shard.balanceOf(alice), 5 * ONE_SHARD, "wrong number of shards taken");
        _assertBacking();
    }

    /// Those shards already paid their 1% on the way through the router. Charging again here
    /// would make swap-then-redeem strictly worse than buyMany.
    function test_redeemManyChargesNoAdditionalFee() public {
        _acquireShards(alice, 4, 50 ether);
        uint256 feesAfterSwap = _feesHeld();
        uint256 accBefore = hook.accFeePerNFT();
        uint256 escrowBefore = hook.escrowBalance();
        uint256 ethBefore = alice.balance;

        vm.startPrank(alice);
        shard.approve(address(hook), type(uint256).max);
        hook.redeemMany(4);
        vm.stopPrank();

        assertEq(_feesHeld(), feesAfterSwap, "redeemMany moved ETH into or out of the fee pot");
        assertEq(alice.balance, ethBefore, "redeemMany took ETH from the redeemer");
        // The accumulator is the real detector: _distribute does not move ETH, it reallocates
        // it, so a fee charged here would be invisible to a balance check alone.
        assertEq(hook.accFeePerNFT(), accBefore, "redeemMany distributed a second fee to holders");
        assertEq(hook.escrowBalance(), escrowBefore, "redeemMany escrowed a second fee");
    }

    function test_redeemManyIsCheaperThanLoopingRedeem() public {
        _acquireShards(bob, 5, 50 ether);
        _acquireShards(alice, 5, 50 ether);

        vm.prank(bob);
        shard.approve(address(hook), type(uint256).max);
        vm.prank(alice);
        shard.approve(address(hook), type(uint256).max);

        uint256 gasBefore = gasleft();
        for (uint256 i; i < 5; ++i) {
            vm.prank(bob);
            hook.redeem();
        }
        uint256 loopGas = gasBefore - gasleft();

        gasBefore = gasleft();
        vm.prank(alice);
        hook.redeemMany(5);
        uint256 batchGas = gasBefore - gasleft();

        console2.log("5x redeem gas:", loopGas);
        console2.log("redeemMany(5) gas:", batchGas);
        assertLt(batchGas, loopGas, "batch redeem is not cheaper than looping redeem");
    }

    function test_redeemManyRequiresTheFullAllowance() public {
        _acquireShards(alice, 5, 50 ether);

        vm.startPrank(alice);
        shard.approve(address(hook), 4 * ONE_SHARD); // one short
        vm.expectRevert();
        hook.redeemMany(5);
        vm.stopPrank();
    }

    function test_redeemManyRevertsAboveCap() public {
        // Cached deliberately: an inline `hook.MAX_BATCH()` in the redeemMany argument would be
        // evaluated AFTER expectRevert arms, making that view call the "next call".
        uint256 over = hook.MAX_BATCH() + 1;

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.BatchTooLarge.selector, over, hook.MAX_BATCH()));
        hook.redeemMany(over);
    }

    function test_redeemManyRevertsOnZeroCount() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.BatchTooLarge.selector, 0, hook.MAX_BATCH()));
        hook.redeemMany(0);
    }

    function test_redeemManyBackingInvariantHolds() public {
        _acquireShards(alice, 6, 50 ether);
        _assertBacking();

        vm.startPrank(alice);
        shard.approve(address(hook), type(uint256).max);
        hook.redeemMany(6);
        vm.stopPrank();

        _assertBacking();
        assertEq(nft.circulatingSupply(), 6, "wrong supply after a batch redeem");
    }

    receive() external payable { }
}
