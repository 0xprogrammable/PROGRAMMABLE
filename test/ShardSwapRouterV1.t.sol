// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, console2 } from "forge-std/Test.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";

import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "../src/ShardLaunchFactoryV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { ShardNFTV1 } from "../src/ShardNFTV1.sol";
import { GeometricRendererV1 } from "../src/GeometricRendererV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";
import { IShardNFTV1 } from "../src/interfaces/IShardNFTV1.sol";
import { ShardSwapRouterV1 } from "../src/ShardSwapRouterV1.sol";
import { ShardLaunchLib } from "./utils/ShardLaunchLib.sol";

contract ShardSwapRouterV1Test is Test {
    using StateLibrary for IPoolManager;

    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_UPPER = 115_080;
    int24 internal constant TICK_BAND = 22_980; // ~0.1 ETH per NFT, the concentrated band edge
    int24 internal TICK_LOWER;

    uint256 internal constant SEED_AMOUNT = 10_000 ether;
    uint256 internal constant FEE_BPS = 100;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant FAR = 1e18; // deadline far in the future

    /// @dev The size every swap in this file is written against. The hook caps a single
    ///      third-party swap at MAX_BATCH SHARD (50e18), and at TICK_UPPER the price is ~1e-5
    ///      ETH per SHARD — so even 0.01 ETH would move ~990 SHARD and be refused. This buys
    ///      ~39 SHARD, inside the cap, and still leaves a 1% fee far above dust.
    uint256 internal constant UNDER_CAP_ETH = 0.0004 ether;

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
    ShardSwapRouterV1 internal router;

    PoolKey internal key;
    PoolId internal poolId;
    uint160 internal startSqrtPriceX96;

    address internal launcher = makeAddr("launcher");
    address internal builder = makeAddr("builder");
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        TICK_LOWER = TickMath.minUsableTick(TICK_SPACING);
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        manager = IPoolManager(address(new PoolManager(address(this))));
        factory = new ShardLaunchFactoryV1(manager, launcher, keccak256(type(ShardHookV1).creationCode));
        ShardLaunchFactoryV1.LaunchParams memory params = ShardLaunchFactoryV1.LaunchParams({
            tickLower: TICK_LOWER,
            tickBand: TICK_BAND,
            tickUpper: TICK_UPPER,
            startSqrtPriceX96: startSqrtPriceX96,
            builderFeeRecipient: builder
        });
        (hook, shard, nft,) =
            ShardLaunchLib.mineAndLaunch(factory, keccak256("ShardSwapRouterV1Test"), bytes32(0), params);
        renderer = factory.renderer();

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = key.toId();

        // Constructed AFTER `key` is populated: the router pins the pool at deployment, so a
        // zero-value key here would make it reject every swap.
        router = new ShardSwapRouterV1(manager, key);

        vm.deal(address(this), 1000 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
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

    function _assertRouterEmpty() internal view {
        assertEq(address(router).balance, 0, "router holds ETH");
        assertEq(shard.balanceOf(address(router)), 0, "router holds SHARD");
    }

    /// @dev Give `who` some SHARD by buying through the router.
    function _acquireShard(address who, uint256 ethIn) internal returns (uint256 shardOut) {
        vm.prank(who);
        shardOut = router.swapEthForShard{ value: ethIn }(key, 0, FAR);
    }

    /*//////////////////////////////////////////////////////////
                              SWAPS
    //////////////////////////////////////////////////////////*/

    function test_swapEthForShardDeliversShard() public {
        uint256 ethIn = UNDER_CAP_ETH;
        uint256 ethBefore = alice.balance;

        vm.prank(alice);
        uint256 shardOut = router.swapEthForShard{ value: ethIn }(key, 0, FAR);

        assertGt(shardOut, 0, "no SHARD out");
        assertEq(shard.balanceOf(alice), shardOut, "reported amount != delivered amount");
        assertEq(ethBefore - alice.balance, ethIn, "swapper paid more than msg.value");
        _assertRouterEmpty();
    }

    function test_swapShardForEthDeliversEth() public {
        _acquireShard(alice, UNDER_CAP_ETH);
        uint256 shardIn = shard.balanceOf(alice) / 2;
        assertGt(shardIn, 0, "no SHARD to sell");

        uint256 ethBefore = alice.balance;
        vm.startPrank(alice);
        shard.approve(address(router), shardIn);
        uint256 ethOut = router.swapShardForEth(key, shardIn, 0, FAR);
        vm.stopPrank();

        assertGt(ethOut, 0, "no ETH out");
        assertEq(alice.balance - ethBefore, ethOut, "reported amount != delivered amount");
        assertEq(shard.balanceOf(address(router)), 0, "router kept SHARD");
        _assertRouterEmpty();
    }

    /// The router has no privileged access, so the hook's beforeSwap/afterSwap callbacks
    /// fire and charge the ordinary third-party 1%.
    function test_swapChargesTheHookOnePercent() public {
        uint256 ethIn = UNDER_CAP_ETH;

        vm.prank(alice);
        router.swapEthForShard{ value: ethIn }(key, 0, FAR);

        // ETH is the SPECIFIED currency here -> inclusive 1% of what the swapper paid.
        // The 10%/10% builder and launcher cuts are carved out of this fee but stay
        // hook-held until claimed, so the total the hook holds is unchanged.
        assertEq(_feesHeld(), ethIn * FEE_BPS / BPS, "buy fee != 1%");

        uint256 feesAfterBuy = _feesHeld();
        uint256 shardIn = shard.balanceOf(alice);
        vm.startPrank(alice);
        shard.approve(address(router), shardIn);
        uint256 ethOut = router.swapShardForEth(key, shardIn, 0, FAR);
        vm.stopPrank();

        // ETH is the UNSPECIFIED currency (the output) -> the fee is 1% of the gross released.
        uint256 sellFee = _feesHeld() - feesAfterBuy;
        assertGt(sellFee, 0, "sell charged no fee");
        assertApproxEqAbs((ethOut + sellFee) * FEE_BPS / BPS, sellFee, 2, "sell fee != 1% of gross");
    }

    /// Any ETH the router ends up holding after `unlock` goes back to the caller — the
    /// router must never keep a wei, whatever the source.
    /// @dev The refund is THIS swap's own leftover, computed from the delta — not the router's
    ///      balance. The hook rejects a partial fill when ETH is the specified currency, so an
    ///      ordinary swap consumes the whole `msg.value` and there is nothing to refund.
    function test_ethForShardRefundsOnlyItsOwnUnspentEth() public {
        uint256 ethIn = UNDER_CAP_ETH;
        uint256 before = alice.balance;
        vm.prank(alice);
        router.swapEthForShard{ value: ethIn }(key, 0, FAR);

        assertEq(before - alice.balance, ethIn, "caller was charged the wrong amount");
        _assertRouterEmpty();
    }

    /// @dev Regression: the refund used to pay out `address(this).balance`, so ETH that reached
    ///      the router by any other route was swept to whoever swapped next — a stranger's ETH
    ///      handed to an arbitrary caller. Force-sent ETH must stay put.
    function test_ethForShardDoesNotSweepStrandedEth() public {
        uint256 stranded = 0.005 ether;
        vm.deal(address(router), stranded); // force-send; the router has no `receive()`

        uint256 ethIn = UNDER_CAP_ETH;
        uint256 before = alice.balance;
        vm.prank(alice);
        router.swapEthForShard{ value: ethIn }(key, 0, FAR);

        assertEq(before - alice.balance, ethIn, "stranded ETH was swept to the caller");
        assertEq(address(router).balance, stranded, "stranded ETH moved");
    }

    /// @dev The router settles ETH into the PoolManager and takes proceeds straight to the
    ///      swapper, so it never needs to accept a plain transfer. Keeping `receive()` off is
    ///      what stops stray ETH accumulating for the refund path to find.
    function test_rejectsPlainEthTransfers() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(router).call{ value: 0.1 ether }("");
        assertFalse(ok, "router accepted a plain ETH transfer");
    }

    /*//////////////////////////////////////////////////////////
                              GUARDS
    //////////////////////////////////////////////////////////*/

    function test_respectsMinAmountOut() public {
        // Ask for far more SHARD than UNDER_CAP_ETH can buy.
        vm.prank(alice);
        vm.expectPartialRevert(ShardSwapRouterV1.InsufficientOutput.selector);
        router.swapEthForShard{ value: UNDER_CAP_ETH }(key, 1_000_000 ether, FAR);

        _acquireShard(bob, UNDER_CAP_ETH);
        uint256 shardIn = shard.balanceOf(bob);
        vm.startPrank(bob);
        shard.approve(address(router), shardIn);
        vm.expectPartialRevert(ShardSwapRouterV1.InsufficientOutput.selector);
        router.swapShardForEth(key, shardIn, 100 ether, FAR);
        vm.stopPrank();

        _assertRouterEmpty();
    }

    function test_respectsDeadline() public {
        vm.warp(1_000_000);

        vm.prank(alice);
        vm.expectRevert(ShardSwapRouterV1.Expired.selector);
        router.swapEthForShard{ value: 0.01 ether }(key, 0, block.timestamp - 1);

        vm.prank(alice);
        vm.expectRevert(ShardSwapRouterV1.Expired.selector);
        router.swapShardForEth(key, 1 ether, 0, block.timestamp - 1);
    }

    function test_shardForEthRequiresApproval() public {
        _acquireShard(alice, UNDER_CAP_ETH);
        uint256 shardIn = shard.balanceOf(alice);

        vm.prank(alice);
        vm.expectRevert();
        router.swapShardForEth(key, shardIn, 0, FAR);

        // And it works the moment the approval exists.
        vm.startPrank(alice);
        shard.approve(address(router), shardIn);
        uint256 ethOut = router.swapShardForEth(key, shardIn, 0, FAR);
        vm.stopPrank();
        assertGt(ethOut, 0, "approved sell produced nothing");
    }

    function test_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(ShardSwapRouterV1.ZeroAmount.selector);
        router.swapEthForShard{ value: 0 }(key, 0, FAR);

        vm.prank(alice);
        vm.expectRevert(ShardSwapRouterV1.ZeroAmount.selector);
        router.swapShardForEth(key, 0, 0, FAR);
    }

    function test_unlockCallbackOnlyPoolManager() public {
        vm.prank(alice);
        vm.expectRevert(ShardSwapRouterV1.NotPoolManager.selector);
        router.unlockCallback(hex"");
    }

    /*//////////////////////////////////////////////////////////
                               FUZZ
    //////////////////////////////////////////////////////////*/

    /// The pool is thin (~0.04 ETH halves the price), so stay in fractions of an ETH — and
    /// under UNDER_CAP_ETH, above which a single swap trips the hook's 50 SHARD cap.
    function testFuzz_swapNeverLeavesRouterHoldingFunds(uint96 rawBuy, uint16 sellPct) public {
        uint256 ethIn = bound(uint256(rawBuy), 1e12, UNDER_CAP_ETH);
        uint256 pct = bound(uint256(sellPct), 1, 100);

        vm.deal(alice, ethIn + 1 ether);
        vm.prank(alice);
        uint256 shardOut = router.swapEthForShard{ value: ethIn }(key, 0, FAR);
        _assertRouterEmpty();
        assertGt(shardOut, 0, "buy produced no SHARD");

        uint256 shardIn = shardOut * pct / 100;
        vm.assume(shardIn > 0);

        vm.startPrank(alice);
        shard.approve(address(router), shardIn);
        router.swapShardForEth(key, shardIn, 0, FAR);
        vm.stopPrank();

        _assertRouterEmpty();
    }

    receive() external payable { }
}
