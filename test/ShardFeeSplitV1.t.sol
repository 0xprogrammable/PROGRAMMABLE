// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IERC20Minimal } from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { ShardNFTV1 } from "../src/ShardNFTV1.sol";
import { GeometricRendererV1 } from "../src/GeometricRendererV1.sol";
import { ShardErrorsV1 } from "../src/ShardErrorsV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";
import { IShardNFTV1 } from "../src/interfaces/IShardNFTV1.sol";

/// @dev Exposes the internal fee entry point so split arithmetic can be pinned with exact
///      wei amounts, independent of curve pricing.
contract FeeSplitHarness is ShardHookV1 {
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

    function distributeFee(uint256 amount) external {
        _distributeFee(amount);
    }
}

contract SplitSwapRouter is IUnlockCallback {
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

contract RejectShardEth {
    receive() external payable {
        revert("reject ETH");
    }
}

contract ShardFeeSplitV1Test is Test {
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_UPPER = 115_080;
    int24 internal constant TICK_BAND = 22_980;
    int24 internal TICK_LOWER;

    uint256 internal constant SEED_AMOUNT = 10_000 ether;
    uint256 internal constant FEE_BPS = 100;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant UNDER_CAP_ETH = 0.0004 ether;
    uint256 internal constant FAR = 1e18;

    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    IPoolManager internal manager;
    ShardTokenV1 internal shard;
    GeometricRendererV1 internal renderer;
    FeeSplitHarness internal hook;
    ShardNFTV1 internal nft;
    SplitSwapRouter internal swapRouter;

    PoolKey internal key;
    PoolId internal poolId;
    uint160 internal startSqrtPriceX96;

    address internal launcher = makeAddr("launcher");
    address internal builder = makeAddr("builder");
    address internal alice = makeAddr("alice");

    /// @dev buyNFT refunds unspent ETH to the caller; the test contract must accept it.
    receive() external payable { }

    function setUp() public {
        TICK_LOWER = TickMath.minUsableTick(TICK_SPACING);
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        manager = IPoolManager(address(new PoolManager(address(this))));
        shard = new ShardTokenV1();
        renderer = new GeometricRendererV1();
        swapRouter = new SplitSwapRouter(manager);

        (address expected, bytes32 salt) = HookMiner.find(
            address(this),
            HOOK_FLAGS,
            type(FeeSplitHarness).creationCode,
            abi.encode(
                manager, shard, TICK_LOWER, TICK_BAND, TICK_UPPER, startSqrtPriceX96, address(this), launcher, builder
            )
        );
        hook = new FeeSplitHarness{ salt: salt }(
            manager, shard, TICK_LOWER, TICK_BAND, TICK_UPPER, startSqrtPriceX96, address(this), launcher, builder
        );
        assertEq(address(hook), expected, "hook address mismatch");

        nft = new ShardNFTV1(address(hook), address(renderer));
        hook.setNFT(IShardNFTV1(address(nft)));

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

    /// @dev Total ETH the hook has captured, in whatever form it currently holds it.
    function _feesHeld() internal view returns (uint256) {
        return manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()) + address(hook).balance;
    }

    function _rejectEthAt(address account) internal {
        RejectShardEth rejector = new RejectShardEth();
        vm.etch(account, address(rejector).code);
    }

    /*//////////////////////////////////////////////////////////
                        SPLIT ARITHMETIC
    //////////////////////////////////////////////////////////*/

    /// A 1 ether fee splits exactly 0.8 / 0.1 / 0.1.
    function test_split_exactTenthsOnRoundAmount() public {
        hook.distributeFee(1 ether);

        assertEq(hook.builderFeesAccrued(), 0.1 ether, "builder cut");
        assertEq(hook.launcherFeesAccrued(), 0.1 ether, "launcher cut");
        assertEq(hook.escrowBalance(), 0.8 ether, "holder pool (escrow: nothing circulates)");
    }

    /// The operator cut is the floor of the combined 20%; the odd wei goes to the launcher.
    /// 999 wei -> operator floor(1998/10) = 199, split 99 builder / 100 launcher, 800 to holders.
    function test_split_roundingRemainderGoesToLauncher() public {
        hook.distributeFee(999);

        assertEq(hook.builderFeesAccrued(), 99, "builder cut");
        assertEq(hook.launcherFeesAccrued(), 100, "launcher takes the odd wei");
        assertEq(hook.escrowBalance(), 800, "holders get the remainder");
    }

    /// A tiny fee no longer floors the entitlement away: 9 wei credits 1 wei to the operator
    /// (launcher first), 8 to holders — the carried remainder is what makes the cut cumulative.
    function test_split_tinyFeeStillCreditsOperator() public {
        hook.distributeFee(9);

        assertEq(hook.builderFeesAccrued(), 0, "builder cut");
        assertEq(hook.launcherFeesAccrued(), 1, "launcher takes the floored operator wei");
        assertEq(hook.escrowBalance(), 8, "holder pool");
    }

    /// Conservation: cuts + holder pool always equal the fee, for any single amount. The combined
    /// operator (builder+launcher) cut is the floor of the true 20%; the launcher takes the odd wei.
    function testFuzz_split_conserves(uint256 amount) public {
        amount = bound(amount, 0, 1_000_000 ether);
        hook.distributeFee(amount);

        uint256 operator = amount * 2000 / BPS; // floor(20%), taken as one cut then split
        assertEq(hook.builderFeesAccrued() + hook.launcherFeesAccrued(), operator, "operator = floor(20%)");
        assertGe(hook.launcherFeesAccrued(), hook.builderFeesAccrued(), "launcher takes the odd wei");
        assertLe(hook.launcherFeesAccrued() - hook.builderFeesAccrued(), 1, "split balanced within a wei");
        assertEq(hook.builderFeesAccrued() + hook.launcherFeesAccrued() + hook.escrowBalance(), amount, "conservation");
    }

    /// The Programmable entitlement is cumulative: a stream of sub-threshold fees accrues the same
    /// launcher/builder total as one aggregated fee, so splitting volume into tiny swaps cannot evade
    /// the 10 bps cut. Ten 9-wei fees (1% of a 900-wei swap) must match one 90-wei fee (1% of 9,000).
    function test_tinyFeesAccumulateToTheSameEntitlement() public {
        for (uint256 i = 0; i < 10; i++) {
            hook.distributeFee(9);
        }
        assertEq(hook.launcherFeesAccrued(), 9, "launcher entitlement evaded by fee splitting");
        assertEq(hook.builderFeesAccrued(), 9, "builder entitlement evaded by fee splitting");
    }

    /// Split-invariant across any stream: conservation is exact, and both cuts stay within one wei of
    /// the ideal cumulative 10%, with the launcher never shorted below the builder.
    function testFuzz_splitIsConservativeAndCumulative(uint256[] memory rawAmounts) public {
        vm.assume(rawAmounts.length > 0 && rawAmounts.length <= 64);
        uint256 total;
        for (uint256 i = 0; i < rawAmounts.length; i++) {
            uint256 amount = rawAmounts[i] % 1e18;
            total += amount;
            hook.distributeFee(amount);
        }
        uint256 launcher = hook.launcherFeesAccrued();
        uint256 builder = hook.builderFeesAccrued();
        // No NFTs circulate in this harness, so every holder wei lands in escrow.
        assertEq(launcher + builder + hook.escrowBalance(), total, "split lost or minted wei");
        assertApproxEqAbs(launcher, (total * 1000) / BPS, 1, "launcher not cumulative-exact");
        assertApproxEqAbs(builder, (total * 1000) / BPS, 1, "builder not cumulative-exact");
        assertGe(launcher, builder, "launcher shorted vs builder");
        assertLe(launcher - builder, 1, "split drifted beyond one wei");
    }

    /*//////////////////////////////////////////////////////////
                        REAL FEE PATHS
    //////////////////////////////////////////////////////////*/

    /// A third-party pool swap routes its 1% fee through the split.
    function test_poolSwapFeeIsSplit() public {
        hook.initialise();

        uint256 ethIn = UNDER_CAP_ETH;
        _swap(true, -int256(ethIn), ethIn);

        uint256 fee = ethIn * FEE_BPS / BPS;
        assertEq(_feesHeld(), fee, "total fee captured");
        assertEq(hook.builderFeesAccrued(), fee * 1000 / BPS, "builder cut");
        assertEq(hook.launcherFeesAccrued(), fee * 1000 / BPS, "launcher cut");
        assertEq(hook.escrowBalance(), fee - 2 * (fee * 1000 / BPS), "holder pool");
    }

    /// The hook-market buy path (which bypasses swap callbacks) splits the same way.
    function test_buyNFTFeeIsSplit() public {
        hook.initialise();

        uint256 escrowBefore = hook.escrowBalance();
        hook.buyNFT{ value: 1 ether }(1 ether, FAR);

        uint256 builderCut = hook.builderFeesAccrued();
        uint256 launcherCut = hook.launcherFeesAccrued();
        uint256 holderDelta = hook.escrowBalance() - escrowBefore;

        assertGt(builderCut, 0, "builder accrued");
        assertEq(builderCut, launcherCut, "equal 10% cuts");
        // holderDelta = fee - 2 * floor(fee/10); 8 * floor(fee/10) differs by at most fee % 10.
        assertApproxEqAbs(holderDelta, 8 * builderCut, 9, "holders get ~80%");
        assertEq(_feesHeld(), builderCut + launcherCut + holderDelta, "conservation vs ETH actually held");
    }

    /// Donations are gifts to holders, not swap fees: never split.
    function test_donationIsNotSplit() public {
        hook.donate{ value: 1 ether }();

        assertEq(hook.builderFeesAccrued(), 0, "builder cut on a donation");
        assertEq(hook.launcherFeesAccrued(), 0, "launcher cut on a donation");
        assertEq(hook.escrowBalance(), 1 ether, "donation goes to holders whole");
    }

    /*//////////////////////////////////////////////////////////
                             CLAIMS
    //////////////////////////////////////////////////////////*/

    function _accrueRealFees() internal returns (uint256 fee) {
        hook.initialise();
        _swap(true, -int256(UNDER_CAP_ETH), UNDER_CAP_ETH);
        fee = UNDER_CAP_ETH * FEE_BPS / BPS;
    }

    function test_claimBuilderFees_paysAndZeroes() public {
        uint256 fee = _accrueRealFees();
        uint256 cut = fee * 1000 / BPS;

        vm.prank(builder);
        uint256 paid = hook.claimBuilderFees();

        assertEq(paid, cut, "claim amount");
        assertEq(builder.balance, cut, "builder received ETH");
        assertEq(hook.builderFeesAccrued(), 0, "accrual zeroed");
    }

    function test_claimBuilderFees_revertsForStranger() public {
        _accrueRealFees();

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.NotBuilder.selector);
        hook.claimBuilderFees();
    }

    function test_claimBuilderFees_revertsWhenNothingAccrued() public {
        vm.prank(builder);
        vm.expectRevert(ShardErrorsV1.NothingToClaim.selector);
        hook.claimBuilderFees();
    }

    function test_claimLauncherFees_paysAndZeroes() public {
        uint256 fee = _accrueRealFees();
        uint256 cut = fee * 1000 / BPS;

        vm.prank(launcher);
        uint256 paid = hook.claimLauncherFees();

        assertEq(paid, cut, "claim amount");
        assertEq(launcher.balance, cut, "launcher received ETH");
        assertEq(hook.launcherFeesAccrued(), 0, "accrual zeroed");
    }

    function test_claimLauncherFees_revertsForStranger() public {
        _accrueRealFees();

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.NotLauncher.selector);
        hook.claimLauncherFees();
    }

    /// Holder claims still work alongside the new accruals and never touch them.
    function test_holderClaimLeavesCutsIntact() public {
        hook.initialise();
        uint256 tokenId = hook.buyNFT{ value: 1 ether }(1 ether, FAR);
        vm.roll(block.number + 1);

        // A second fee event accrues to the now-circulating holder.
        _swap(true, -int256(UNDER_CAP_ETH), UNDER_CAP_ETH);

        uint256 builderBefore = hook.builderFeesAccrued();
        uint256 launcherBefore = hook.launcherFeesAccrued();
        assertGt(builderBefore, 0, "builder accrued");

        uint256[] memory ids = new uint256[](1);
        ids[0] = tokenId;
        uint256 paid = hook.claim(ids);

        assertGt(paid, 0, "holder claimed");
        assertEq(hook.builderFeesAccrued(), builderBefore, "builder accrual untouched");
        assertEq(hook.launcherFeesAccrued(), launcherBefore, "launcher accrual untouched");
    }

    function test_buyRefundRevertsAndRollsBackForRejectingRecipient() public {
        hook.initialise();
        vm.deal(alice, 1 ether);
        _rejectEthAt(alice);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.EthTransferFailed.selector);
        hook.buyNFT{ value: 1 ether }(1 ether, FAR);

        assertEq(nft.balanceOf(alice), 0, "acquisition rolled back");
        assertEq(hook.builderFeesAccrued(), 0, "builder accrual rolled back");
        assertEq(hook.launcherFeesAccrued(), 0, "launcher accrual rolled back");
    }

    function test_sellPayoutRevertsAndRollsBackForRejectingRecipient() public {
        hook.initialise();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokenId = hook.buyNFT{ value: 1 ether }(1 ether, FAR);
        uint256 builderBefore = hook.builderFeesAccrued();
        uint256 launcherBefore = hook.launcherFeesAccrued();
        _rejectEthAt(alice);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.EthTransferFailed.selector);
        hook.sellNFT(tokenId, 0, FAR);

        assertEq(nft.ownerOf(tokenId), alice, "release rolled back");
        assertEq(hook.builderFeesAccrued(), builderBefore, "builder accrual rolled back");
        assertEq(hook.launcherFeesAccrued(), launcherBefore, "launcher accrual rolled back");
    }

    function test_holderClaimRevertsAndRollsBackForRejectingRecipient() public {
        hook.initialise();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokenId = hook.buyNFT{ value: 1 ether }(1 ether, FAR);
        vm.roll(block.number + 1);
        _swap(true, -int256(UNDER_CAP_ETH), UNDER_CAP_ETH);
        uint256[] memory ids = new uint256[](1);
        ids[0] = tokenId;
        _rejectEthAt(alice);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.EthTransferFailed.selector);
        hook.claim(ids);

        assertEq(hook.claimable(alice), 0, "claim materialisation rolled back");
    }

    function test_builderClaimRevertsAndRestoresAccrualForRejectingRecipient() public {
        _accrueRealFees();
        uint256 accrued = hook.builderFeesAccrued();
        _rejectEthAt(builder);

        vm.prank(builder);
        vm.expectRevert(ShardErrorsV1.EthTransferFailed.selector);
        hook.claimBuilderFees();

        assertEq(hook.builderFeesAccrued(), accrued, "builder accrual restored");
    }

    function test_launcherClaimRevertsAndRestoresAccrualForRejectingRecipient() public {
        _accrueRealFees();
        uint256 accrued = hook.launcherFeesAccrued();
        _rejectEthAt(launcher);

        vm.prank(launcher);
        vm.expectRevert(ShardErrorsV1.EthTransferFailed.selector);
        hook.claimLauncherFees();

        assertEq(hook.launcherFeesAccrued(), accrued, "launcher accrual restored");
    }

    /*//////////////////////////////////////////////////////////
                       PAYOUT ADDRESS CHANGES
    //////////////////////////////////////////////////////////*/

    function test_setBuilderFeeRecipient_transfersClaimRights() public {
        uint256 fee = _accrueRealFees();
        uint256 cut = fee * 1000 / BPS;
        address successor = makeAddr("successor");

        vm.prank(builder);
        hook.setBuilderFeeRecipient(successor);
        assertEq(hook.builderFeeRecipient(), successor, "recipient updated");

        // Old recipient is locked out.
        vm.prank(builder);
        vm.expectRevert(ShardErrorsV1.NotBuilder.selector);
        hook.claimBuilderFees();

        // Successor claims the full accrual, including pre-change fees.
        vm.prank(successor);
        assertEq(hook.claimBuilderFees(), cut, "successor claims");
    }

    function test_setBuilderFeeRecipient_revertsForStranger() public {
        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.NotBuilder.selector);
        hook.setBuilderFeeRecipient(alice);
    }

    function test_setBuilderFeeRecipient_revertsOnZero() public {
        vm.prank(builder);
        vm.expectRevert(ShardErrorsV1.ZeroAddress.selector);
        hook.setBuilderFeeRecipient(address(0));
    }

    /*//////////////////////////////////////////////////////////
                          CONSTRUCTION
    //////////////////////////////////////////////////////////*/

    /// @dev BaseHook validates the deployment address before recipient checks run, so the
    ///      hook must sit at a mined address for the ZeroAddress revert to be reachable.
    function test_constructor_rejectsZeroRecipients() public {
        (, bytes32 saltA) = HookMiner.find(
            address(this),
            HOOK_FLAGS,
            type(ShardHookV1).creationCode,
            abi.encode(
                manager, shard, TICK_LOWER, TICK_BAND, TICK_UPPER, startSqrtPriceX96, address(this), address(0), builder
            )
        );
        vm.expectRevert(ShardErrorsV1.ZeroAddress.selector);
        new ShardHookV1{ salt: saltA }(
            manager, shard, TICK_LOWER, TICK_BAND, TICK_UPPER, startSqrtPriceX96, address(this), address(0), builder
        );

        (, bytes32 saltB) = HookMiner.find(
            address(this),
            HOOK_FLAGS,
            type(ShardHookV1).creationCode,
            abi.encode(
                manager,
                shard,
                TICK_LOWER,
                TICK_BAND,
                TICK_UPPER,
                startSqrtPriceX96,
                address(this),
                launcher,
                address(0)
            )
        );
        vm.expectRevert(ShardErrorsV1.ZeroAddress.selector);
        new ShardHookV1{ salt: saltB }(
            manager, shard, TICK_LOWER, TICK_BAND, TICK_UPPER, startSqrtPriceX96, address(this), launcher, address(0)
        );
    }
}
