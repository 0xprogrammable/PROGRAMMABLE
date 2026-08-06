// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { BatchSwapRouter } from "./ShardHookBatchV1.t.sol";

import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "../src/ShardLaunchFactoryV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { ShardNFTV1 } from "../src/ShardNFTV1.sol";
import { GeometricRendererV1 } from "../src/GeometricRendererV1.sol";
import { ShardErrorsV1 } from "../src/ShardErrorsV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";
import { IShardNFTV1 } from "../src/interfaces/IShardNFTV1.sol";
import { ShardLaunchLib } from "./utils/ShardLaunchLib.sol";

/**
 * What happens when the curve actually runs out.
 *
 * The shipped ticks put `tickLower` at `minUsableTick`, which makes exhaustion cost more ETH
 * than exists — every guard that fires on a short fill is unreachable there, and so is every
 * bug hiding behind one. That is exactly the argument the contract's own comments reject: the
 * backing identity has to be a property of THIS contract, not of whatever ticks
 * `Deploy.s.sol` happens to pass.
 *
 * So this fixture deploys the same hook over a DELIBERATELY SHALLOW range — 600 ticks instead
 * of ~1.77 million — where the whole 10,000 SHARD seed can be bought out for a few thousand
 * test ETH. Nothing else changes. The hook, the NFT and the fee logic are the shipped ones.
 */
contract ShardHookExhaustionV1Test is Test {
    using StateLibrary for IPoolManager;

    int24 internal constant TICK_SPACING = 60;

    /// @dev A 600-tick curve. The band covers its upper half, mirroring the shipped shape:
    ///      at or above `TICK_BAND` both positions are active, below it only the full range.
    int24 internal constant TICK_UPPER = 600;
    int24 internal constant TICK_BAND = 300;
    int24 internal constant TICK_LOWER = 0;

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
    address internal whale = address(0xBEEF);
    address internal constant launcher = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal builder = makeAddr("builder");

    uint256 internal constant FAR = 1e18;

    function setUp() public {
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        manager = IPoolManager(address(new PoolManager(address(this))));
        factory = new ShardLaunchFactoryV1(manager, keccak256(type(ShardHookV1).creationCode));
        swapRouter = new BatchSwapRouter(manager);
        ShardLaunchFactoryV1.LaunchParams memory params = ShardLaunchFactoryV1.LaunchParams({
            tickLower: TICK_LOWER,
            tickBand: TICK_BAND,
            tickUpper: TICK_UPPER,
            startSqrtPriceX96: startSqrtPriceX96,
            builderFeeRecipient: builder
        });
        (hook, shard, nft,) =
            ShardLaunchLib.mineAndLaunch(factory, keccak256("ShardHookExhaustionV1Test"), bytes32(0), params);
        renderer = factory.renderer();

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = key.toId();

        vm.deal(alice, 100_000 ether);
        vm.deal(whale, 1_000_000 ether);
    }

    /*//////////////////////////////////////////////////////////
                              HELPERS
    //////////////////////////////////////////////////////////*/

    function test_setupUsesAtomicFactory() public view {
        assertEq(hook.deployer(), address(factory));
    }

    /// @dev Buy SHARD out of the pool as an ordinary third party, leaving the NFT supply
    ///      untouched. This is how the curve gets walked down without minting anything.
    ///
    ///      EXACT-OUTPUT, deliberately. An exact-input ETH swap makes ETH the specified
    ///      currency, and the hook rejects those outright once they stop short at the price
    ///      limit — which is exactly what happens near exhaustion. Specifying the SHARD side
    ///      instead puts ETH on the unspecified leg, where a short fill is priced rather than
    ///      refused, so the curve can actually be walked to the bottom.
    ///
    ///      IN CHUNKS, because the hook caps a single third-party swap at `MAX_BATCH` SHARD.
    ///      The drain is the point of this fixture, so the total is unchanged — it is simply
    ///      walked there in cap-sized steps rather than in one swap.
    function _drainShardExactOut(uint256 shardsOut) internal {
        uint256 maxPerSwap = hook.MAX_BATCH() * ONE_SHARD;
        while (shardsOut > 0) {
            uint256 chunk = shardsOut > maxPerSwap ? maxPerSwap : shardsOut;
            vm.prank(whale);
            swapRouter.swap{ value: 500_000 ether }(
                key,
                SwapParams({
                    zeroForOne: true, amountSpecified: int256(chunk), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                })
            );
            shardsOut -= chunk;
        }
    }

    /// @dev Walk the curve down until exactly `keep` SHARD is left for it to sell.
    function _drainToRemaining(uint256 keep) internal {
        _drainShardExactOut(_poolShard() - keep);
    }

    /// @dev SHARD left in the pool, i.e. what the curve can still sell.
    function _poolShard() internal view returns (uint256) {
        return shard.balanceOf(address(manager));
    }

    function _assertBacking(string memory what) internal view {
        assertEq(shard.balanceOf(address(hook)), nft.circulatingSupply() * ONE_SHARD + hook.seedDust(), what);
    }

    /*//////////////////////////////////////////////////////////
              M1 — buyNFT MUST NOT MINT ON A SHORT FILL
    //////////////////////////////////////////////////////////*/

    /// @dev `_buySwap` used to check only the ETH leg, so at exhaustion `buyNFT` could take
    ///      LESS than one whole SHARD out of the pool and still mint an NFT — permanently
    ///      breaking `balanceOf(hook) == circulatingSupply * 1e18 + seedDust` on a contract
    ///      that cannot be upgraded. Its two siblings, `_sellSwap` and `_buyExactOutSwap`,
    ///      have always asserted a full fill; this is the one that did not.
    function test_buyNftRevertsRatherThanMintingOnAShortFill() public {
        // Leave the curve with less than the one whole SHARD `buyNFT` needs, but NOT bone dry:
        // drained to the very last wei the price sits exactly on `MIN_SQRT_PRICE + 1` and v4
        // rejects the next swap itself with `PriceLimitAlreadyExceeded`, before the hook is
        // ever consulted. Half a SHARD is the case that actually reaches `_buySwap`.
        _drainToRemaining(0.5 ether);
        assertLt(_poolShard(), ONE_SHARD, "the pool still has a whole SHARD to sell");
        assertGt(_poolShard(), 0, "the pool is bone dry; v4 will reject before the hook runs");

        uint256 circulatingBefore = nft.circulatingSupply();
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.PartialFillNotSupported.selector);
        hook.buyNFT{ value: 10_000 ether }(type(uint256).max, FAR);

        assertEq(nft.circulatingSupply(), circulatingBefore, "an unbacked NFT was minted");
        assertEq(alice.balance, balanceBefore, "ETH was taken for a mint that could not happen");
        _assertBacking("SHARD backing broke at exhaustion");
    }

    /// @dev The guard must not fire on an ordinary buy. A full fill is the normal case and has
    ///      to keep working on the same fixture that reaches exhaustion.
    function test_buyNftStillWorksWhileTheCurveHasDepth() public {
        vm.prank(alice);
        uint256 id = hook.buyNFT{ value: 10 ether }(type(uint256).max, FAR);

        assertEq(nft.ownerOf(id), alice, "an ordinary buy was rejected");
        _assertBacking("SHARD backing broke on an ordinary buy");
    }

    /*//////////////////////////////////////////////////////////
           M2 — buyMax MUST NOT BILL THE REFUNDED REMAINDER
    //////////////////////////////////////////////////////////*/

    /// @dev The fee used to be fixed at 1% of `msg.value` BEFORE the swap, while only
    ///      `ethForSwap - ethConsumed` was refunded. Any exact-input swap that stopped early at
    ///      its price limit therefore paid 1% of the refunded remainder too — send 100 ETH into
    ///      a curve with 1 ETH of depth left and the fee is 1 ETH on a 1 ETH purchase. That is
    ///      the same fee-out-of-proportion-to-what-executed failure `_afterSwap` refuses to
    ///      inflict on third parties. The fee is now billed on what the curve actually took.
    function test_buyMaxChargesOnlyOnWhatTheCurveConsumed() public {
        // Walk the curve down until only a handful of whole SHARD is left, so a large send
        // cannot possibly be consumed and `MAX_BATCH` is not in the way.
        _drainToRemaining(30 ether);
        uint256 remaining = _poolShard();
        assertGt(remaining, ONE_SHARD, "nothing left to buy");
        assertLt(remaining, hook.MAX_BATCH() * ONE_SHARD, "too much left; buyMax would hit the cap");

        uint256 sent = 50_000 ether; // vastly more than the remaining depth
        uint256 feesBefore = _feesHeld();
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        uint256[] memory ids = hook.buyMax{ value: sent }(0, FAR);
        assertGt(ids.length, 0, "buyMax minted nothing");

        uint256 charged = alice.balance == balanceBefore ? 0 : balanceBefore - alice.balance;
        uint256 fee = _feesHeld() - feesBefore;
        assertGt(fee, 0, "buyMax charged no fee at all");

        // The whole point: the fee is 1% of what was CHARGED, not 1% of what was SENT.
        assertApproxEqAbs(fee, charged * FEE_BPS / BPS, 2, "fee was not 1% of the amount charged");
        assertLt(charged, sent, "the swap did not actually stop early - the test proves nothing");

        // And the old behaviour, stated directly: 1% of `msg.value` would have been enormous.
        assertLt(fee, sent * FEE_BPS / BPS, "buyMax billed the refunded remainder");

        // Everything neither the curve nor the fee took came back.
        assertEq(balanceBefore - alice.balance, charged, "refund did not reconcile");
        _assertBacking("SHARD backing broke on a short-filled buyMax");
    }

    /// @dev The common case still bills the full amount: when the curve consumes everything,
    ///      the inclusive basis and the exact-input basis agree, and nothing is refunded.
    function test_buyMaxStillChargesTheWholeSendWhenFullyConsumed() public {
        uint256 sent = 10 ether;
        uint256 feesBefore = _feesHeld();
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        hook.buyMax{ value: sent }(0, FAR);

        assertEq(balanceBefore - alice.balance, sent, "buyMax refunded ETH the curve did take");
        assertApproxEqAbs(_feesHeld() - feesBefore, sent * FEE_BPS / BPS, 2, "fee moved off 1%");
        _assertBacking("SHARD backing broke on a fully consumed buyMax");
    }

    /// @dev The clamp is load-bearing. The inclusive form `consumed * 100 / 9900` can land one
    ///      wei ABOVE the exact-input reserve at full consumption, which would overspend
    ///      `msg.value` and underflow the refund. Fuzzed across the awkward residues.
    function testFuzz_buyMaxNeverOverspendsMsgValue(uint96 raw) public {
        uint256 sent = bound(uint256(raw), 1e15, 1000 ether);
        vm.deal(alice, sent);

        uint256 feesBefore = _feesHeld();

        vm.prank(alice);
        try hook.buyMax{ value: sent }(0, FAR) {
            uint256 charged = sent - alice.balance;
            assertLe(charged, sent, "buyMax spent more than msg.value");
            assertLe(_feesHeld() - feesBefore, sent * FEE_BPS / BPS + 1, "fee exceeded the reserve");
            _assertBacking("SHARD backing broke under fuzz");
        } catch {
            // BatchTooLarge and InsufficientOutput are legitimate outcomes across this range.
        }
    }

    function _feesHeld() internal view returns (uint256) {
        return manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()) + address(hook).balance;
    }
}
