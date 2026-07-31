// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

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
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { ShardErrorsV1 } from "../src/ShardErrorsV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";

/*//////////////////////////////////////////////////////////////
                             HARNESS
//////////////////////////////////////////////////////////////*/

/// @dev Exposes the sweep and lets a test fabricate a circulating holder, so the accumulator
///      path can be exercised without wiring the NFT in.
contract FeeHookHarness is ShardHookV1 {
    constructor(
        IPoolManager _poolManager,
        ShardTokenV1 _shard,
        int24 _tickLower,
        int24 _tickBand,
        int24 _tickUpper,
        uint160 _startSqrtPriceX96,
        address _deployer,
        address _launcherFeeRecipient,
        address _builderFeeRecipient
    )
        ShardHookV1(
            _poolManager,
            _shard,
            _tickLower,
            _tickBand,
            _tickUpper,
            _startSqrtPriceX96,
            _deployer,
            _launcherFeeRecipient,
            _builderFeeRecipient
        )
    { }

    function sweep() external {
        _sweepClaims();
    }

    function fabricateHolder(uint256 tokenId, address to) external {
        _acquireAccounting(tokenId, to);
    }

    function settleFor(uint256 tokenId, address owner) external {
        _settle(tokenId, owner);
    }
}

/*//////////////////////////////////////////////////////////////
                             ROUTER
//////////////////////////////////////////////////////////////*/

contract FeeSwapRouter is IUnlockCallback {
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

contract ShardHookFeesV1Test is Test {
    using StateLibrary for IPoolManager;

    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_UPPER = 115_080;
    int24 internal constant TICK_BAND = 22_980; // ~0.1 ETH per NFT, the concentrated band edge
    int24 internal TICK_LOWER;

    uint256 internal constant SEED_AMOUNT = 10_000 ether;
    uint256 internal constant FEE_BPS = 100;
    uint256 internal constant BPS = 10_000;

    /// @dev The two fixed beneficiary cuts, each 10% of the fee, taken before the remainder
    ///      reaches the holder pool. The TOTAL fee is unchanged by them.
    uint256 internal constant CUT_BPS = 1000;

    /// @dev The size every ordinary third-party swap in this file is written against. A single
    ///      third-party swap may move at most `MAX_SWAP_SHARD` (see MAX SWAP SIZE below), and at
    ///      TICK_UPPER the price is ~1e-5 ETH per SHARD — so a whole ETH would move ~99,000
    ///      SHARD and be refused. This buys ~39 SHARD, comfortably inside the cap, while its 1%
    ///      fee (4e12 wei) is still far above the dust where the fee would floor to zero.
    uint256 internal constant UNDER_CAP_ETH = 0.0004 ether;

    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    IPoolManager internal manager;
    ShardTokenV1 internal shard;
    FeeHookHarness internal hook;
    FeeSwapRouter internal swapRouter;

    PoolKey internal key;
    PoolId internal poolId;
    uint160 internal startSqrtPriceX96;

    address internal alice = address(0xA11CE);

    address internal launcher = makeAddr("launcher");
    address internal builder = makeAddr("builder");

    function setUp() public {
        TICK_LOWER = TickMath.minUsableTick(TICK_SPACING);
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        manager = IPoolManager(address(new PoolManager(address(this))));
        shard = new ShardTokenV1();
        swapRouter = new FeeSwapRouter(manager);
        hook = _deployHook();

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = key.toId();

        shard.transfer(address(hook), SEED_AMOUNT);
        vm.deal(address(this), 10_000 ether);
        shard.approve(address(swapRouter), type(uint256).max);
    }

    function _deployHook() internal returns (FeeHookHarness deployed) {
        (address expected, bytes32 salt) = HookMiner.find(
            address(this),
            HOOK_FLAGS,
            type(FeeHookHarness).creationCode,
            abi.encode(
                manager, shard, TICK_LOWER, TICK_BAND, TICK_UPPER, startSqrtPriceX96, address(this), launcher, builder
            )
        );
        deployed = new FeeHookHarness{ salt: salt }(
            manager, shard, TICK_LOWER, TICK_BAND, TICK_UPPER, startSqrtPriceX96, address(this), launcher, builder
        );
        assertEq(address(deployed), expected, "hook address mismatch");
    }

    /// @dev Total ETH the hook has captured, in whatever form it currently holds it. The
    ///      builder/launcher carve is an ACCOUNTING split inside the hook, not a payout, so
    ///      this total is unaffected by it: every wei stays hook-held until someone claims.
    function _feesHeld() internal view returns (uint256) {
        return manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()) + address(hook).balance;
    }

    /// @dev Every wei the hook has accounted for, across all three destinations.
    function _feesAccounted() internal view returns (uint256) {
        return hook.escrowBalance() + hook.builderFeesAccrued() + hook.launcherFeesAccrued();
    }

    /// @dev The holder pool's exact share of a fee: total minus the two floored 10% cuts, so
    ///      the rounding dust stays with holders and the three parts sum back to `fee`.
    function _holderShare(uint256 fee) internal pure returns (uint256) {
        uint256 cut = (fee * CUT_BPS) / BPS;
        return fee - 2 * cut;
    }

    function _swap(bool zeroForOne, int256 amountSpecified, uint256 value) internal returns (BalanceDelta) {
        return swapRouter.swap{ value: value }(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            })
        );
    }

    /// @dev Buy `shardsOut` SHARD so the test contract can exercise the sell direction.
    ///      Exact-OUTPUT and in chunks of at most `MAX_SWAP_SHARD`, because the hook caps a
    ///      single third-party swap at that size — one large buy would simply be refused.
    function _acquireShards(uint256 shardsOut) internal {
        while (shardsOut > 0) {
            uint256 chunk = shardsOut > MAX_SWAP_SHARD ? MAX_SWAP_SHARD : shardsOut;
            _swap(true, int256(chunk), 100 ether);
            shardsOut -= chunk;
        }
    }

    /*//////////////////////////////////////////////////////////
                       THE FOUR-CASE MATRIX
    //////////////////////////////////////////////////////////*/

    /// ETH is the SPECIFIED currency -> charged in beforeSwap, inclusive at bps/10000.
    ///
    /// @dev The TOTAL fee is untouched by the beneficiary split; only its destination
    ///      changes. UNDER_CAP_ETH * 100 / 10_000 = 4e12 wei, which splits 4e11 / 4e11 /
    ///      3.2e12 — the exact integers are pinned below rather than only the formula.
    function test_feeIsExactlyOnePercent_zeroForOne_exactIn() public {
        hook.initialise();

        uint256 ethIn = UNDER_CAP_ETH; // sized to the 50 SHARD swap cap, not to the fee
        _swap(true, -int256(ethIn), ethIn);

        uint256 fee = (ethIn * FEE_BPS) / BPS;
        assertEq(fee, 4e12, "premise: the fee on this swap is 4e12 wei");

        assertEq(_feesHeld(), fee, "fee != 1% of ETH paid");
        assertEq(_feesAccounted(), fee, "accounted fee != captured fee");

        assertEq(hook.builderFeesAccrued(), 4e11, "builder cut");
        assertEq(hook.launcherFeesAccrued(), 4e11, "launcher cut");
        assertEq(hook.escrowBalance(), 32e11, "holder share did not reach the accumulator");
        assertEq(hook.escrowBalance(), _holderShare(fee), "holder share disagrees with the split rule");
    }

    /// ETH is UNSPECIFIED (the input the pool computes) -> charged in afterSwap.
    /// @dev The router's returned delta is the NET the swapper settles: v4 reassigns
    ///      `swapperDelta = swapDelta - hookDelta` after afterSwap. For ETH flowing IN that
    ///      net already INCLUDES the fee (the user pays pool-cost + fee), so the check is
    ///      total * bps/10000 — even though the hook computed it as poolCost * bps/9900.
    ///      Both are the same number; they just start from different sides of the same total.
    function test_feeIsExactlyOnePercent_zeroForOne_exactOut() public {
        hook.initialise();

        uint256 before = address(this).balance;
        BalanceDelta delta = _swap(true, int256(1e18), 10 ether); // want exactly 1 SHARD out
        uint256 ethSpent = before - address(this).balance;

        uint256 totalPaid = uint256(uint128(-delta.amount0()));
        assertEq(_feesHeld(), (totalPaid * FEE_BPS) / BPS, "fee != 1% of total ETH paid");
        assertEq(ethSpent, totalPaid, "router settled a different amount than reported");
    }

    /// ETH is UNSPECIFIED (the output) -> charged in afterSwap.
    /// @dev Here the router's net is what the user RECEIVED, i.e. the pool released
    ///      `net + fee`. So the inclusive check runs the other way: net * bps/9900.
    function test_feeIsExactlyOnePercent_oneForZero_exactIn() public {
        hook.initialise();
        _acquireShards(40 ether); // 40 SHARD, so the sell below stays inside the 50 SHARD cap
        uint256 feesAfterBuy = _feesHeld();

        uint256 shardIn = shard.balanceOf(address(this)) / 2;
        BalanceDelta delta = _swap(false, -int256(shardIn), 0);

        uint256 netReceived = uint256(uint128(delta.amount0()));
        uint256 fee = _feesHeld() - feesAfterBuy;
        assertEq(fee, (netReceived * FEE_BPS) / (BPS - FEE_BPS), "sell fee != inclusive 1%");
        // And state the property directly: the fee is 1% of everything the pool released.
        assertApproxEqAbs(((netReceived + fee) * FEE_BPS) / BPS, fee, 1, "not 1% of gross");
    }

    /// ETH is the SPECIFIED currency (the exact output) -> charged in beforeSwap at bps/9900.
    function test_feeIsExactlyOnePercent_oneForZero_exactOut() public {
        hook.initialise();
        _acquireShards(50 ether);
        uint256 feesAfterBuy = _feesHeld();

        // ~0.0001 ETH is ~10 SHARD at this price, so the sell stays under the 50 SHARD cap.
        uint256 ethOut = 0.0001 ether;
        _swap(false, int256(ethOut), 0);

        assertEq(
            _feesHeld() - feesAfterBuy, (ethOut * FEE_BPS) / (BPS - FEE_BPS), "fee != inclusive 1% of exact output"
        );
    }

    /*//////////////////////////////////////////////////////////
                            PROPERTIES
    //////////////////////////////////////////////////////////*/

    function test_feeIsAlwaysDenominatedInEth() public {
        hook.initialise();
        uint256 shardBefore = shard.balanceOf(address(hook));

        _acquireShards(40 ether); // 40 SHARD; the sell below must stay under the 50 SHARD cap
        _swap(false, -int256(shard.balanceOf(address(this)) / 2), 0);

        assertEq(shard.balanceOf(address(hook)), shardBefore, "hook took SHARD as fee");
        assertGt(_feesHeld(), 0, "no ETH fee captured");
    }

    function test_swapperReceivesExpectedAmountAfterFee() public {
        hook.initialise();

        uint256 ethIn = UNDER_CAP_ETH; // sized to the 50 SHARD swap cap
        uint256 before = address(this).balance;
        _swap(true, -int256(ethIn), ethIn);

        assertEq(before - address(this).balance, ethIn, "swapper paid more than specified");
        assertEq(_feesHeld(), ethIn / 100, "fee not withheld from the input");
        assertGt(shard.balanceOf(address(this)), 0, "swapper got no SHARD");
    }

    function test_firstSwapSucceedsOnFreshPoolManager() public {
        // Regression: taking native ETH via poolManager.take in beforeSwap would revert here,
        // because the manager holds no other native liquidity. Minting a 6909 claim does not.
        hook.initialise();
        assertEq(address(manager).balance, 0, "manager should hold no ETH yet");
        _swap(true, -int256(UNDER_CAP_ETH), UNDER_CAP_ETH); // sized to the 50 SHARD swap cap
        assertGt(_feesHeld(), 0, "first swap captured no fee");
    }

    function test_feeGoesToEscrowWhenNothingCirculating() public {
        hook.initialise();
        assertEq(hook.circulating(), 0, "expected no holders");

        _swap(true, -int256(UNDER_CAP_ETH), UNDER_CAP_ETH); // sized to the 50 SHARD swap cap

        // 4e12 fee -> 4e11 builder, 4e11 launcher, 3.2e12 escrowed for holders.
        assertEq(hook.escrowBalance(), 32e11, "holder share did not escrow");
        assertEq(hook.builderFeesAccrued(), 4e11, "builder cut");
        assertEq(hook.launcherFeesAccrued(), 4e11, "launcher cut");
        assertEq(hook.accFeePerNFT(), 0, "accumulator moved with no holders");
    }

    function test_feeReachesAccumulatorWhenHoldersExist() public {
        hook.initialise();
        hook.fabricateHolder(1, alice);
        vm.roll(block.number + 1); // the same-block accrual guard

        _swap(true, -int256(UNDER_CAP_ETH), UNDER_CAP_ETH); // sized to the 50 SHARD swap cap

        hook.settleFor(1, alice);
        // The sole holder receives the holder share of the 4e12 fee, not the whole fee.
        assertEq(hook.claimable(alice), 32e11, "holder did not receive the holder share");
        assertEq(hook.claimable(alice), _holderShare(UNDER_CAP_ETH / 100), "holder share disagrees with the rule");
        assertEq(hook.builderFeesAccrued() + hook.launcherFeesAccrued(), 8e11, "the two cuts");
    }

    /// @dev The split moves fees between INTERNAL ledgers; custody is unchanged. Everything
    ///      the hook charged is still hook-held, as 6909 claims before the sweep and as real
    ///      ETH after it — including the builder and launcher accruals, which are only paid
    ///      out when those beneficiaries claim.
    function test_hookClaimBalancePlusEthCoversFeesTaken() public {
        hook.initialise();
        _swap(true, -int256(UNDER_CAP_ETH), UNDER_CAP_ETH); // sized to the 50 SHARD swap cap

        // Before the sweep the value is in 6909 claims, not real ETH. A balance-only
        // assertion would fail here — that is the point of counting both.
        assertEq(address(hook).balance, 0, "unexpected real ETH before sweep");
        assertEq(_feesHeld(), _feesAccounted(), "claims do not cover accounted fees");

        hook.sweep();
        assertEq(address(hook).balance, _feesAccounted(), "sweep did not realise ETH");
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), 0, "claims not fully burned");
    }

    /*//////////////////////////////////////////////////////////
                              GUARDS
    //////////////////////////////////////////////////////////*/

    function test_swapBeforeInitialiseReverts() public {
        // A front-runner may create the canonical pool (at the canonical price, forced by
        // _beforeInitialize) but must not be able to move it before the hook seeds.
        manager.initialize(key, startSqrtPriceX96);

        vm.expectRevert();
        _swap(true, -int256(uint256(1 ether)), 1 ether);
    }

    function test_foreignPoolSwapReverts() public {
        hook.initialise();

        ShardTokenV1 other = new ShardTokenV1();
        PoolKey memory foreign = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(other)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        // _beforeInitialize rejects it outright — the pool can never exist, so the fee path
        // can never be reached with a foreign currency.
        vm.expectRevert();
        manager.initialize(foreign, startSqrtPriceX96);
    }

    /*//////////////////////////////////////////////////////////
                            PARTIAL FILLS
    //////////////////////////////////////////////////////////*/

    /// @dev When ETH is the SPECIFIED currency the fee is fixed in `_beforeSwap`, before
    ///      execution, and therefore on the REQUESTED size. If the swap then stops at its
    ///      price limit, that fee becomes a huge share of what actually executed — measured
    ///      at 7,655 bps (76.5%) on a 1 ETH request that filled only 0.013 ETH. It cannot be
    ///      corrected in `_afterSwap`, whose return value adjusts only the UNSPECIFIED
    ///      currency while the fee must stay in ETH. So the swap is REJECTED instead.
    function test_partialFillIsRejectedNotOvercharged() public {
        hook.initialise();

        // Sized to the 50 SHARD swap cap: UNDER_CAP_ETH walks ~79 ticks if it fills, so a limit
        // 60 ticks down binds part-way through and the swap short-fills — while the ~30 SHARD it
        // does move stays inside the cap, so the revert here is the partial fill and nothing else.
        uint160 limit = TickMath.getSqrtPriceAtTick(TICK_UPPER - 60);

        vm.expectRevert();
        swapRouter.swap{ value: UNDER_CAP_ETH }(
            key, SwapParams({ zeroForOne: true, amountSpecified: -int256(UNDER_CAP_ETH), sqrtPriceLimitX96: limit })
        );

        // Nothing was taken: a rejected swap must not leave a fee behind.
        assertEq(_feesHeld(), 0, "a reverted swap still charged a fee");
        assertEq(_feesAccounted(), 0, "a reverted swap still accounted a fee");
    }

    /// @dev The MIRROR of the case above, in the other quadrant where ETH is the specified
    ///      currency: `!zeroForOne` exact-OUT, i.e. "give me exactly this much ETH for my
    ///      SHARD". The guard's arithmetic differs per quadrant — exact-in compares against
    ///      `specified - hookFee` because beforeSwap swaps LESS, exact-out against
    ///      `specified + hookFee` because it asks the pool for MORE — so covering only the
    ///      exact-in side leaves half the guard unexercised. Here the fee is fixed in
    ///      beforeSwap on the requested ETH out; if the limit then binds, the swapper is left
    ///      paying that fee against a fraction of the ETH, which is the overcharge the guard
    ///      exists to refuse.
    function test_partialFillIsRejectedOnExactOutputEthToo() public {
        hook.initialise();
        _acquireShards(50 ether);
        uint256 feesBefore = _feesHeld();

        // Selling SHARD pushes the price UP, so a limit a hair ABOVE spot binds almost
        // immediately and the pool cannot find anything like a whole ETH.
        (uint160 sqrtNow,,,) = manager.getSlot0(poolId);
        uint160 limit = sqrtNow + sqrtNow / 10_000;

        // Bare `expectRevert` because v4 wraps hook reverts in `CustomRevert.WrappedError`,
        // which makes the selector unmatchable from here. Verified by trace that the inner
        // revert really is `PartialFillNotSupported()` raised in `_afterSwap` — and the
        // non-binding twin below is what stops this passing for the wrong reason.
        // 0.0001 ETH out rather than a whole one: a complete fill would be ~10 SHARD, inside the
        // 50 SHARD swap cap, so the swap is refused for short-filling and not for its size.
        vm.expectRevert();
        swapRouter.swap(
            key,
            SwapParams({ zeroForOne: false, amountSpecified: int256(uint256(0.0001 ether)), sqrtPriceLimitX96: limit })
        );

        assertEq(_feesHeld(), feesBefore, "a reverted exact-output swap still charged a fee");
    }

    /// @dev And the same quadrant must still succeed when the limit does NOT bind — otherwise
    ///      the guard above would be indistinguishable from "exact-output sells are broken".
    function test_exactOutputEthSucceedsWhenTheLimitDoesNotBind() public {
        hook.initialise();
        _acquireShards(50 ether);
        uint256 feesBefore = _feesHeld();

        (uint160 sqrtNow,,,) = manager.getSlot0(poolId);
        uint160 limit = sqrtNow + sqrtNow / 4; // far above anything this sell will reach

        // ~10 SHARD in, so the sell stays inside the 50 SHARD swap cap.
        uint256 ethOut = 0.0001 ether;
        swapRouter.swap(
            key, SwapParams({ zeroForOne: false, amountSpecified: int256(ethOut), sqrtPriceLimitX96: limit })
        );

        assertEq(
            _feesHeld() - feesBefore, (ethOut * FEE_BPS) / (BPS - FEE_BPS), "a complete exact-output sell was mispriced"
        );
    }

    /// @dev The guard must not break ordinary slippage protection. A limit that exists but
    ///      never binds is the common routing case and has to keep working.
    function test_nonBindingPriceLimitStillWorks() public {
        hook.initialise();

        // Far below anything a swap this size will reach.
        uint160 limit = TickMath.getSqrtPriceAtTick(TICK_UPPER - 60_000);
        uint256 amountIn = UNDER_CAP_ETH; // sized to the 50 SHARD swap cap

        swapRouter.swap{ value: amountIn }(
            key, SwapParams({ zeroForOne: true, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit })
        );

        assertEq(_feesHeld(), (amountIn * FEE_BPS) / BPS, "non-binding limit changed the fee");
    }

    /// @dev A COMPLETE fill that happens to land exactly ON its price limit is not a partial
    ///      fill and must not be rejected. The guard used to compare the post-swap price to the
    ///      limit, which cannot tell the two apart — every complete fill that stopped exactly on
    ///      the boundary was refused. It now measures the delta against what was requested, so
    ///      the two are distinguishable.
    function test_completeFillLandingExactlyOnTheLimitSucceeds() public {
        hook.initialise();

        uint256 amountIn = UNDER_CAP_ETH; // sized to the 50 SHARD swap cap
        vm.deal(address(this), amountIn * 4);

        // Run it once with a limit that cannot bind, to learn where the swap lands.
        uint256 snap = vm.snapshotState();
        swapRouter.swap{ value: amountIn }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        (uint160 landedAt,,,) = manager.getSlot0(poolId);
        vm.revertToState(snap);

        // Now replay it with the limit set exactly at that price. The swap still fills in full;
        // it simply has nothing left to do by the time it touches the boundary.
        swapRouter.swap{ value: amountIn }(
            key, SwapParams({ zeroForOne: true, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: landedAt })
        );

        (uint160 nowAt,,,) = manager.getSlot0(poolId);
        assertEq(nowAt, landedAt, "the swap did not land on the limit after all");
        assertEq(_feesHeld(), (amountIn * FEE_BPS) / BPS, "a complete fill on the limit was mispriced");
    }

    /*//////////////////////////////////////////////////////////
                          MAX SWAP SIZE
    //////////////////////////////////////////////////////////*/

    /// @dev The hook's own entry points have always capped a single action at MAX_BATCH NFTs.
    ///      That cap meant nothing while anyone could bypass it by swapping SHARD directly —
    ///      through this router, through Uniswap's own interface, or through any aggregator —
    ///      and then redeeming. The cap now lives on the swap itself, so the limit is a
    ///      property of the pool rather than of which front end you happened to use.
    ///
    ///      Measured on the SHARD leg of the delta, which is why one check covers all four
    ///      direction x exactness quadrants: the fee is always taken on the ETH leg, so the
    ///      SHARD leg is exactly what moved regardless of which side was specified.
    uint256 internal constant MAX_SWAP_SHARD = 50 ether;

    /// @dev Asserts the swap reverts specifically with `SwapTooLarge` — not merely that it
    ///      reverts at all.
    ///
    ///      A bare `vm.expectRevert()` is not good enough here, and that is not theoretical:
    ///      `test_partialFillIsRejectedNotOvercharged` sat green in this very file while
    ///      reverting with the WRONG error, because a bare expectRevert accepts any of them.
    ///      The obvious fix is unavailable — v4 wraps every hook revert in
    ///      `CustomRevert.WrappedError`, so the selector is nested in the payload and
    ///      `vm.expectRevert(selector)` cannot match it. So scan the returndata instead,
    ///      which is exactly what the frontend detector had to do for the same reason.
    function _expectSwapTooLarge(bool zeroForOne, int256 amountSpecified, uint256 value) internal {
        (bool ok, bytes memory returndata) = address(swapRouter).call{ value: value }(
            abi.encodeCall(
                FeeSwapRouter.swap,
                (
                    key,
                    SwapParams({
                        zeroForOne: zeroForOne,
                        amountSpecified: amountSpecified,
                        sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                    })
                )
            )
        );
        assertFalse(ok, "the swap did not revert at all");
        assertTrue(
            _carriesSelector(returndata, ShardErrorsV1.SwapTooLarge.selector), "reverted, but not with SwapTooLarge"
        );
    }

    /// @dev Is this 4-byte selector anywhere in the payload? The wrapper puts it in the middle.
    function _carriesSelector(bytes memory data, bytes4 sel) internal pure returns (bool) {
        if (data.length < 4) return false;
        for (uint256 i = 0; i + 4 <= data.length; ++i) {
            if (data[i] == sel[0] && data[i + 1] == sel[1] && data[i + 2] == sel[2] && data[i + 3] == sel[3]) {
                return true;
            }
        }
        return false;
    }

    function test_swapOfExactlyTheCapSucceeds() public {
        hook.initialise();

        // Exact-OUTPUT buy: the specified amount IS the SHARD leg, so this lands on the
        // boundary exactly rather than approximately.
        _swap(true, int256(MAX_SWAP_SHARD), 100 ether);

        assertEq(shard.balanceOf(address(this)), MAX_SWAP_SHARD, "a swap of exactly the cap was rejected");
    }

    function test_swapOneWeiOverTheCapReverts() public {
        hook.initialise();

        _expectSwapTooLarge(true, int256(MAX_SWAP_SHARD + 1), 100 ether);

        assertEq(shard.balanceOf(address(this)), 0, "an over-cap swap still delivered SHARD");
        assertEq(_feesHeld(), 0, "a rejected swap still charged a fee");
        assertEq(_feesAccounted(), 0, "a rejected swap still accounted a fee");
    }

    /// @dev The cap is symmetric — selling is capped too, so the limit cannot be sidestepped
    ///      by acquiring through one direction and unwinding through the other.
    function test_sellOfExactlyTheCapSucceeds() public {
        hook.initialise();
        _acquireShards(60 ether); // buy in under the cap first, in chunks

        uint256 before = shard.balanceOf(address(this));
        assertGe(before, MAX_SWAP_SHARD, "not enough SHARD to test the sell boundary");

        _swap(false, -int256(MAX_SWAP_SHARD), 0);

        assertEq(shard.balanceOf(address(this)), before - MAX_SWAP_SHARD, "a sell of exactly the cap was rejected");
    }

    function test_sellOneWeiOverTheCapReverts() public {
        hook.initialise();
        _acquireShards(60 ether);

        uint256 before = shard.balanceOf(address(this));
        _expectSwapTooLarge(false, -int256(MAX_SWAP_SHARD + 1), 0);

        assertEq(shard.balanceOf(address(this)), before, "an over-cap sell still moved SHARD");
    }

    /// @dev Proves the returndata scan DISCRIMINATES, rather than matching any revert.
    ///      Without this, `_expectSwapTooLarge` could be quietly vacuous and every cap test
    ///      above would be worthless — which is exactly the failure mode a bare
    ///      `vm.expectRevert()` produced in this file once already.
    function test_theCapAssertionDoesNotMatchAnUnrelatedRevert() public {
        hook.initialise();
        _acquireShards(50 ether);

        // The same scenario as test_partialFillIsRejectedOnExactOutputEthToo: selling
        // pushes the price UP, so a limit a hair above spot binds immediately. A complete
        // fill here would be ~10 SHARD, well inside the cap, so the ONLY reason this can
        // revert is the short fill.
        (uint160 sqrtNow,,,) = manager.getSlot0(poolId);
        uint160 limit = sqrtNow + sqrtNow / 10_000;

        (bool ok, bytes memory data) = address(swapRouter)
            .call(
                abi.encodeCall(
                    FeeSwapRouter.swap,
                    (
                        key,
                        SwapParams({
                        zeroForOne: false, amountSpecified: int256(uint256(0.0001 ether)), sqrtPriceLimitX96: limit
                    })
                    )
                )
            );

        assertFalse(ok, "the setup swap was supposed to revert");
        assertTrue(
            _carriesSelector(data, ShardErrorsV1.PartialFillNotSupported.selector),
            "this scenario should revert with PartialFillNotSupported"
        );
        assertFalse(
            _carriesSelector(data, ShardErrorsV1.SwapTooLarge.selector),
            "the scan matched an unrelated revert, so every cap test is vacuous"
        );
    }

    /// @dev Exact-INPUT buys specify ETH, not SHARD, so the cap has to be enforced against the
    ///      delta after execution rather than against the requested amount. Sending far more
    ///      ETH than 50 SHARD costs must still be refused.
    function test_exactInputBuyOverTheCapReverts() public {
        hook.initialise();

        // Price near TICK_UPPER is ~1e-5 ETH per SHARD, so 100 ETH buys far more than 50.
        _expectSwapTooLarge(true, -int256(uint256(100 ether)), 100 ether);

        assertEq(shard.balanceOf(address(this)), 0, "an over-cap exact-input buy still delivered SHARD");
    }

    /*//////////////////////////////////////////////////////////
                               FUZZ
    //////////////////////////////////////////////////////////*/

    function testFuzz_feeNeverExceedsOnePercent(uint96 raw) public {
        // Upper bound is the 50 SHARD swap cap, not a fee concern; the lower bound keeps the
        // fee above the dust where it would floor to zero.
        uint256 ethIn = bound(uint256(raw), 1e12, UNDER_CAP_ETH);
        hook.initialise();
        vm.deal(address(this), ethIn + 1 ether);

        _swap(true, -int256(ethIn), ethIn);

        // Inclusive basis: the fee is at most 1% of what the swapper actually paid.
        assertLe(_feesHeld(), (ethIn * FEE_BPS) / BPS, "fee exceeded 1%");
        assertGt(_feesHeld(), 0, "no fee taken");
    }

    /// @dev Whatever the fee turns out to be, the three ledgers must add back up to it and
    ///      the two cuts must each be exactly 10%, floored.
    function testFuzz_theSplitConservesEveryFee(uint96 raw) public {
        uint256 ethIn = bound(uint256(raw), 1e12, UNDER_CAP_ETH);
        hook.initialise();
        vm.deal(address(this), ethIn + 1 ether);

        _swap(true, -int256(ethIn), ethIn);

        uint256 fee = _feesHeld();
        assertEq(hook.builderFeesAccrued(), (fee * CUT_BPS) / BPS, "builder = 10%");
        assertEq(hook.launcherFeesAccrued(), (fee * CUT_BPS) / BPS, "launcher = 10%");
        assertEq(hook.escrowBalance(), _holderShare(fee), "holders get the remainder plus dust");
        assertEq(_feesAccounted(), fee, "the split created or destroyed wei");
    }

    function testFuzz_poolIsNeverLeftWithNegativeDelta(uint96 raw, bool exactIn) public {
        uint256 ethIn = bound(uint256(raw), 1e12, UNDER_CAP_ETH); // upper bound: the 50 SHARD swap cap
        hook.initialise();
        vm.deal(address(this), ethIn + 100 ether);

        // If the hook's delta accounting were wrong in either direction, unlock would revert
        // with CurrencyNotSettled rather than returning.
        if (exactIn) {
            _swap(true, -int256(ethIn), ethIn);
        } else {
            _swap(true, int256(ethIn / 1000 + 1), ethIn + 50 ether);
        }

        assertGt(_feesHeld(), 0, "no fee captured");
        assertEq(shard.balanceOf(address(hook)), hook.seedDust(), "hook shard balance drifted");
    }

    receive() external payable { }
}
