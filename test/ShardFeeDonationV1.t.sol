// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";

import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "../src/ShardLaunchFactoryV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { ShardNFTV1 } from "../src/ShardNFTV1.sol";
import { GeometricRendererV1 } from "../src/GeometricRendererV1.sol";
import { ShardErrorsV1 } from "../src/ShardErrorsV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";
import { ShardFeeForwarderV1 } from "../src/ShardFeeForwarderV1.sol";
import { IShardNFTV1 } from "../src/interfaces/IShardNFTV1.sol";
import { ShardLaunchLib } from "./utils/ShardLaunchLib.sol";

/// @dev A stand-in for a future launchpad: it only knows how to send plain ETH.
contract PlainSender {
    function send(address payable to, uint256 amount) external {
        (bool ok,) = to.call{ value: amount }("");
        require(ok, "send failed");
    }

    receive() external payable { }
}

contract ShardFeeDonationV1Test is Test {
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_UPPER = 115_080;
    int24 internal constant TICK_BAND = 22_980; // ~0.1 ETH per NFT, the concentrated band edge
    int24 internal TICK_LOWER;

    uint256 internal constant SEED_AMOUNT = 10_000 ether;
    uint256 internal constant FEE_BPS = 100;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant FAR = 1e18;

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
    ShardFeeForwarderV1 internal forwarder;

    PoolKey internal key;
    uint160 internal startSqrtPriceX96;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    address internal constant launcher = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal builder = makeAddr("builder");

    function setUp() public {
        TICK_LOWER = TickMath.minUsableTick(TICK_SPACING);
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        manager = IPoolManager(address(new PoolManager(address(this))));
        factory = new ShardLaunchFactoryV1(manager, keccak256(type(ShardHookV1).creationCode));
        ShardLaunchFactoryV1.LaunchParams memory params = ShardLaunchFactoryV1.LaunchParams({
            tickLower: TICK_LOWER,
            tickBand: TICK_BAND,
            tickUpper: TICK_UPPER,
            startSqrtPriceX96: startSqrtPriceX96,
            builderFeeRecipient: builder
        });
        (hook, shard, nft,) =
            ShardLaunchLib.mineAndLaunch(factory, keccak256("ShardFeeDonationV1Test"), bytes32(0), params);
        renderer = factory.renderer();

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        forwarder = new ShardFeeForwarderV1(payable(address(hook)));

        vm.deal(address(this), 10_000 ether);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    function _buy(address who, uint256 send) internal returns (uint256 tokenId) {
        vm.prank(who);
        tokenId = hook.buyNFT{ value: send }(type(uint256).max, FAR);
    }

    function test_setupUsesAtomicFactory() public view {
        assertEq(hook.deployer(), address(factory));
    }

    /*//////////////////////////////////////////////////////////
                              DONATE
    //////////////////////////////////////////////////////////*/

    function test_donateRaisesTheAccumulator() public {
        _buy(alice, 1 ether);
        vm.roll(block.number + 1);

        uint256 accBefore = hook.accFeePerNFT();
        hook.donate{ value: 1 ether }();

        assertGt(hook.accFeePerNFT(), accBefore, "a donation did not reach holders");
    }

    /// The whole point: outside ETH must become claimable by NFT holders.
    function test_donatedEthIsClaimableByAHolder() public {
        uint256 id = _buy(alice, 1 ether);
        vm.roll(block.number + 1);

        hook.donate{ value: 1 ether }();
        vm.roll(block.number + 1);

        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        uint256 before = alice.balance;
        vm.prank(alice);
        hook.claim(ids);

        // Alice is the only holder, so she receives the whole donation plus the holder
        // share of the buy fee. The donation is never split, so the floor is exact.
        assertGe(alice.balance - before, 1 ether, "the donation did not reach the holder");
    }

    function test_donateSplitsAcrossEveryHolder() public {
        uint256 a = _buy(alice, 1 ether);
        uint256 b = _buy(bob, 1 ether);
        vm.roll(block.number + 1);

        hook.donate{ value: 2 ether }();
        vm.roll(block.number + 1);

        uint256[] memory aIds = new uint256[](1);
        aIds[0] = a;
        uint256[] memory bIds = new uint256[](1);
        bIds[0] = b;

        uint256 aBefore = alice.balance;
        vm.prank(alice);
        hook.claim(aIds);
        uint256 bBefore = bob.balance;
        vm.prank(bob);
        hook.claim(bIds);

        uint256 aGot = alice.balance - aBefore;
        uint256 bGot = bob.balance - bBefore;
        assertApproxEqRel(aGot, bGot, 0.01e18, "holders did not split the donation evenly");
        assertGe(aGot + bGot, 2 ether, "less than the donation was paid out");
    }

    /// A donation is a gift to holders, not swap volume: it must bypass the
    /// builder/launcher carve entirely.
    function test_donateIsNeverSplitWithTheBeneficiaries() public {
        uint256 builderBefore = hook.builderFeesAccrued();
        uint256 launcherBefore = hook.launcherFeesAccrued();

        hook.donate{ value: 1 ether }();

        assertEq(hook.builderFeesAccrued(), builderBefore, "builder took a cut of a donation");
        assertEq(hook.launcherFeesAccrued(), launcherBefore, "launcher took a cut of a donation");
        assertEq(hook.escrowBalance(), 1 ether, "donation did not reach holders whole");
    }

    /// With nothing circulating there is nobody to pay, so it must escrow rather
    /// than vanish into the contract balance.
    function test_donateEscrowsWhenNothingCirculates() public {
        assertEq(nft.circulatingSupply(), 0, "test needs an empty collection");

        hook.donate{ value: 1 ether }();

        assertEq(hook.escrowBalance(), 1 ether, "donation was not escrowed");
    }

    /// Escrow is NOT released by the buy that ends the empty period. `_distribute`
    /// runs before the buyer joins the earning set, so `circulating` is still zero
    /// at that moment and the escrow (plus that buy's own holder share) stays put.
    /// It is the NEXT distribution, once someone is circulating, that releases it.
    function test_escrowedDonationReleasesOnTheNextDistribution() public {
        hook.donate{ value: 1 ether }();
        assertEq(hook.escrowBalance(), 1 ether, "donation was not escrowed");

        uint256 id = _buy(alice, 1 ether);
        // Still escrowed, and now larger: the holder share of this buy's fee joined it
        // rather than being paid out. The exact fee is whatever the curve charged, not
        // 1% of the ETH sent, because buyNFT refunds the excess.
        assertGt(hook.escrowBalance(), 1 ether, "escrow released too early");

        // Any later fee event does it. A second donation is the simplest one.
        vm.roll(block.number + 1);
        hook.donate{ value: 0.1 ether }();
        assertEq(hook.escrowBalance(), 0, "escrow never released");

        vm.roll(block.number + 1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        uint256 before = alice.balance;
        vm.prank(alice);
        hook.claim(ids);

        assertGe(alice.balance - before, 1 ether, "escrowed donation never reached the holder");
    }

    function test_donateRevertsOnZeroValue() public {
        vm.expectRevert(ShardErrorsV1.ZeroAmount.selector);
        hook.donate{ value: 0 }();
    }

    function test_anyoneCanDonate() public {
        _buy(alice, 1 ether);
        vm.roll(block.number + 1);

        uint256 accBefore = hook.accFeePerNFT();
        vm.prank(bob);
        hook.donate{ value: 0.5 ether }();
        assertGt(hook.accFeePerNFT(), accBefore, "a third party could not donate");
    }

    /// A donation is ETH only. It must not disturb the SHARD backing identity.
    function test_donateLeavesTheBackingInvariantIntact() public {
        _buy(alice, 1 ether);
        vm.roll(block.number + 1);
        hook.donate{ value: 3 ether }();

        assertEq(
            shard.balanceOf(address(hook)),
            nft.circulatingSupply() * 1e18 + hook.seedDust(),
            "donation moved the SHARD backing"
        );
    }

    /*//////////////////////////////////////////////////////////
                            FEE FORWARDER
    //////////////////////////////////////////////////////////*/

    function test_forwarderAcceptsPlainEth() public {
        PlainSender sender = new PlainSender();
        vm.deal(address(sender), 5 ether);

        sender.send(payable(address(forwarder)), 2 ether);

        assertEq(address(forwarder).balance, 2 ether, "forwarder rejected a plain transfer");
    }

    /// The reason the forwarder exists: a contract that can only `transfer` ETH
    /// still ends up paying holders, without needing to know the hook's ABI.
    function test_flushPushesEverythingIntoTheFeePool() public {
        _buy(alice, 1 ether);
        vm.roll(block.number + 1);

        PlainSender sender = new PlainSender();
        vm.deal(address(sender), 5 ether);
        sender.send(payable(address(forwarder)), 2 ether);

        uint256 accBefore = hook.accFeePerNFT();
        forwarder.flush();

        assertEq(address(forwarder).balance, 0, "forwarder kept ETH back");
        assertGt(hook.accFeePerNFT(), accBefore, "flushed ETH never reached holders");
    }

    /// The forwarder routes through `donate`, so flushed ETH is a gift too: no cut.
    function test_flushedEthIsNotSplitWithTheBeneficiaries() public {
        _buy(alice, 1 ether);
        vm.roll(block.number + 1);

        uint256 builderBefore = hook.builderFeesAccrued();
        uint256 launcherBefore = hook.launcherFeesAccrued();

        vm.deal(address(forwarder), 4 ether);
        forwarder.flush();

        assertEq(hook.builderFeesAccrued(), builderBefore, "builder took a cut of a flush");
        assertEq(hook.launcherFeesAccrued(), launcherBefore, "launcher took a cut of a flush");
    }

    function test_anyoneCanFlush() public {
        _buy(alice, 1 ether);
        vm.roll(block.number + 1);
        vm.deal(address(forwarder), 1 ether);

        vm.prank(bob);
        forwarder.flush();

        assertEq(address(forwarder).balance, 0, "a third party could not flush");
    }

    function test_flushRevertsWhenEmpty() public {
        vm.expectRevert(ShardFeeForwarderV1.NothingToFlush.selector);
        forwarder.flush();
    }

    function test_forwarderRejectsAZeroHook() public {
        vm.expectRevert(ShardFeeForwarderV1.ZeroAddress.selector);
        new ShardFeeForwarderV1(payable(address(0)));
    }

    function test_forwarderHoldsNoEthAfterFlush() public {
        _buy(alice, 1 ether);
        vm.roll(block.number + 1);
        vm.deal(address(forwarder), 7 ether);

        uint256 hookBefore = address(hook).balance;
        forwarder.flush();

        assertEq(address(forwarder).balance, 0, "forwarder retained a balance");
        assertEq(address(hook).balance - hookBefore, 7 ether, "the hook did not receive it all");
    }

    receive() external payable { }
}
