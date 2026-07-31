// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, console2 } from "forge-std/Test.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams, ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IERC20Minimal } from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { ShardErrorsV1 } from "../src/ShardErrorsV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";

/*//////////////////////////////////////////////////////////////
                             HARNESS
//////////////////////////////////////////////////////////////*/

/// @dev Exposes the internal `_sweepClaims` only. No behaviour is overridden.
contract ShardHookHarnessV1 is ShardHookV1 {
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
}

/*//////////////////////////////////////////////////////////////
                            ROUTERS
//////////////////////////////////////////////////////////////*/

contract TestSwapRouter is IUnlockCallback {
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

/// @dev Positions key on THIS contract, so it can only ever address an empty position.
contract TestLiquidityRouter is IUnlockCallback {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    receive() external payable { }

    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params)
        external
        payable
        returns (BalanceDelta delta)
    {
        delta = abi.decode(poolManager.unlock(abi.encode(key, params)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (PoolKey memory key, ModifyLiquidityParams memory params) =
            abi.decode(rawData, (PoolKey, ModifyLiquidityParams));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(key, params, "");
        return abi.encode(delta);
    }
}

/// @dev Mints ERC-6909 native claims to an arbitrary holder, paid for with real ETH.
contract TestClaimMinter is IUnlockCallback {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    receive() external payable { }

    function mintClaimTo(address to, uint256 amount) external payable {
        poolManager.unlock(abi.encode(to, amount));
    }

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (address to, uint256 amount) = abi.decode(rawData, (address, uint256));
        poolManager.mint(to, CurrencyLibrary.ADDRESS_ZERO.toId(), amount);
        poolManager.settle{ value: amount }();
        return "";
    }
}

/*//////////////////////////////////////////////////////////////
                              TESTS
//////////////////////////////////////////////////////////////*/

contract ShardHookLiquidityV1Test is Test {
    using StateLibrary for IPoolManager;

    error Boom();

    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_UPPER = 115_080;
    int24 internal constant TICK_BAND = 22_980; // ~0.1 ETH per NFT, the concentrated band edge
    int24 internal TICK_LOWER;

    uint256 internal constant SEED_AMOUNT = 10_000 ether;

    /// @dev The hook caps a single third-party swap at MAX_BATCH SHARD (50e18). At TICK_UPPER
    ///      the price is ~1e-5 ETH per SHARD, so a whole ETH would move ~99,000 SHARD and be
    ///      refused; this buys ~39 SHARD, inside the cap, and still walks the tick ~79 down.
    uint256 internal constant UNDER_CAP_ETH = 0.0004 ether;

    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    IPoolManager internal manager;
    ShardTokenV1 internal shard;
    ShardHookHarnessV1 internal hook;
    TestSwapRouter internal swapRouter;
    TestLiquidityRouter internal liquidityRouter;
    TestClaimMinter internal claimMinter;

    PoolKey internal key;
    PoolId internal poolId;
    uint160 internal startSqrtPriceX96;

    address internal attacker = address(0xBEEF);
    address internal launcher = makeAddr("launcher");
    address internal builder = makeAddr("builder");

    function setUp() public {
        TICK_LOWER = TickMath.minUsableTick(TICK_SPACING);
        assertEq(TICK_LOWER, -887_220, "minUsableTick(60)");

        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        manager = IPoolManager(address(new PoolManager(address(this))));
        shard = new ShardTokenV1();
        swapRouter = new TestSwapRouter(manager);
        liquidityRouter = new TestLiquidityRouter(manager);
        claimMinter = new TestClaimMinter(manager);

        hook = _deployHook(shard, TICK_LOWER, TICK_UPPER, startSqrtPriceX96);

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = key.toId();

        shard.transfer(address(hook), SEED_AMOUNT);

        vm.deal(address(this), 1000 ether);
        vm.deal(attacker, 100 ether);
    }

    /*//////////////////////////////////////////////////////////
                              HELPERS
    //////////////////////////////////////////////////////////*/

    function _deployHook(ShardTokenV1 _shard, int24 lower, int24 upper, uint160 startPrice)
        internal
        returns (ShardHookHarnessV1 deployed)
    {
        return _deployHook(_shard, lower, TICK_BAND, upper, startPrice);
    }

    /// @dev The miner hashes the constructor args, so the `abi.encode` list and the actual
    ///      `new` call MUST stay identical, argument for argument.
    function _deployHook(ShardTokenV1 _shard, int24 lower, int24 band, int24 upper, uint160 startPrice)
        internal
        returns (ShardHookHarnessV1 deployed)
    {
        (address expected, bytes32 salt) = HookMiner.find(
            address(this),
            HOOK_FLAGS,
            type(ShardHookHarnessV1).creationCode,
            abi.encode(manager, _shard, lower, band, upper, startPrice, address(this), launcher, builder)
        );
        deployed = new ShardHookHarnessV1{ salt: salt }(
            manager, _shard, lower, band, upper, startPrice, address(this), launcher, builder
        );
        assertEq(address(deployed), expected, "hook address mismatch");
    }

    function _positionLiquidityAt(int24 lower, int24 upper) internal view returns (uint128 liquidity) {
        (liquidity,,) = manager.getPositionInfo(poolId, address(hook), lower, upper, bytes32(0));
    }

    function _hookPositionLiquidity() internal view returns (uint128 liquidity) {
        (liquidity,,) = manager.getPositionInfo(poolId, address(hook), TICK_LOWER, TICK_UPPER, bytes32(0));
    }

    /// @dev v4 wraps a reverting hook call in ERC-7751 `WrappedError`.
    function _expectHookRevert(bytes4 hookSelector, bytes memory inner) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                hookSelector,
                inner,
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function _buy(uint256 amountIn) internal {
        swapRouter.swap{ value: amountIn }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
    }

    /*//////////////////////////////////////////////////////////
                              TESTS
    //////////////////////////////////////////////////////////*/

    function test_hookPermissionsMatchAddressBits() public view {
        Hooks.Permissions memory p = hook.getHookPermissions();

        assertTrue(p.beforeInitialize && p.beforeSwap && p.afterSwap, "action flags");
        assertTrue(p.beforeSwapReturnDelta && p.afterSwapReturnDelta, "delta flags");
        assertFalse(p.afterInitialize, "afterInitialize");
        assertFalse(p.beforeAddLiquidity || p.afterAddLiquidity, "add liquidity");
        assertFalse(p.beforeRemoveLiquidity || p.afterRemoveLiquidity, "remove liquidity");
        assertFalse(p.beforeDonate || p.afterDonate, "donate");
        assertFalse(p.afterAddLiquidityReturnDelta || p.afterRemoveLiquidityReturnDelta, "lp deltas");

        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, HOOK_FLAGS, "address bits != permissions");
    }

    function test_initialiseSeedsAllTenThousandShards() public {
        hook.initialise();

        // Rounding down to whole liquidity units strands a little SHARD in the hook, so the two
        // sides only add up — never assert exact equality on the pool side.
        assertEq(shard.balanceOf(address(manager)) + hook.seedDust(), SEED_AMOUNT, "SHARD went missing");
        assertApproxEqAbs(shard.balanceOf(address(manager)), SEED_AMOUNT, 1e6, "pool underfunded");
        assertGt(_hookPositionLiquidity(), 0, "no liquidity minted");
        assertEq(_hookPositionLiquidity(), hook.seedLiquidity(), "position/record mismatch");
        assertTrue(hook.initialised(), "not marked initialised");
    }

    function test_initialiseRecordsSeedDust() public {
        hook.initialise();

        uint256 dust = hook.seedDust();
        assertGt(dust, 0, "rounding dust should not be zero");
        assertLt(dust, 1e6, "dust unexpectedly large");
        assertEq(dust, shard.balanceOf(address(hook)), "seedDust != hook SHARD balance");

        console2.log("seedDust (wei of SHARD):", dust);
    }

    function test_initialiseRequiresNoEth() public {
        vm.deal(address(hook), 5 ether);
        uint256 before = address(hook).balance;

        hook.initialise();

        assertEq(address(hook).balance, before, "hook spent ETH seeding");
        assertEq(address(manager).balance, 0, "manager received ETH");
    }

    function test_initialiseIsOneShot() public {
        hook.initialise();

        vm.expectRevert(ShardErrorsV1.AlreadyInitialised.selector);
        hook.initialise();
    }

    function test_initialiseOnlyDeployer() public {
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NotDeployer.selector);
        hook.initialise();
    }

    function test_initialiseRevertsOnWrongShardBalance() public {
        ShardTokenV1 other = new ShardTokenV1();
        ShardHookHarnessV1 lean = _deployHook(other, TICK_LOWER, TICK_UPPER, startSqrtPriceX96);

        other.transfer(address(lean), SEED_AMOUNT - 1);

        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.WrongShardBalance.selector, SEED_AMOUNT, SEED_AMOUNT - 1));
        lean.initialise();
    }

    function test_initialiseSurvivesFrontRunAtSamePrice() public {
        // A front-runner initialises the canonical pool first, at the canonical price.
        vm.prank(attacker);
        manager.initialize(key, startSqrtPriceX96);

        // The hook tolerates it: PoolAlreadyInitialized is caught and seeding proceeds.
        hook.initialise();

        assertGt(_hookPositionLiquidity(), 0, "seed did not happen after front-run");
        assertEq(shard.balanceOf(address(manager)) + hook.seedDust(), SEED_AMOUNT, "SHARD went missing");
    }

    function test_frontRunAtDifferentPriceReverts() public {
        uint160 badPrice = TickMath.getSqrtPriceAtTick(TICK_UPPER - TICK_SPACING);

        _expectHookRevert(
            IHooks.beforeInitialize.selector,
            abi.encodeWithSelector(ShardErrorsV1.WrongStartPrice.selector, startSqrtPriceX96, badPrice)
        );
        vm.prank(attacker);
        manager.initialize(key, badPrice);

        // And the canonical path still works afterwards.
        hook.initialise();
        assertGt(_hookPositionLiquidity(), 0, "hook could not initialise after a failed front-run");
    }

    function test_initialiseRerevertsNonAlreadyInitialisedErrors() public {
        // Anything that is NOT PoolAlreadyInitialized must bubble out, never be swallowed —
        // otherwise the hook would seed into a pool that does not exist.
        vm.mockCallRevert(
            address(manager),
            abi.encodeWithSelector(IPoolManager.initialize.selector),
            abi.encodeWithSelector(Boom.selector)
        );

        vm.expectRevert(Boom.selector);
        hook.initialise();
    }

    function test_beforeInitializeRejectsForeignPool() public {
        // A SHARD/USDC pool wired to this hook must be rejected outright.
        ShardTokenV1 usdc = new ShardTokenV1();
        (Currency c0, Currency c1) = address(usdc) < address(shard)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(shard)))
            : (Currency.wrap(address(shard)), Currency.wrap(address(usdc)));

        PoolKey memory foreign = PoolKey({
            currency0: c0,
            currency1: c1,
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        _expectHookRevert(IHooks.beforeInitialize.selector, abi.encodeWithSelector(ShardErrorsV1.WrongPool.selector));
        manager.initialize(foreign, startSqrtPriceX96);
    }

    function test_startPriceMustBeAtOrAboveTickUpper() public {
        // Start below tickUpper => the range is not entirely below spot => the seed would demand
        // currency0 (ETH) the hook does not have.
        ShardTokenV1 other = new ShardTokenV1();
        uint160 lowPrice = TickMath.getSqrtPriceAtTick(TICK_UPPER - TICK_SPACING);
        ShardHookHarnessV1 low = _deployHook(other, TICK_LOWER, TICK_UPPER, lowPrice);

        other.transfer(address(low), SEED_AMOUNT);

        vm.expectRevert(ShardErrorsV1.InvalidStartPrice.selector);
        low.initialise();
    }

    function test_noWithdrawalFunctionExists() public {
        hook.initialise();
        uint128 liquidity = _hookPositionLiquidity();
        assertGt(liquidity, 0);

        // (a) No external surface for removal, under any of the usual names. The hook has a
        //     `receive()` but no fallback, so a call carrying data must revert.
        string[6] memory sigs = [
            "withdraw()",
            "withdrawLiquidity()",
            "removeLiquidity()",
            "emergencyWithdraw()",
            "modifyLiquidity((address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)",
            "rescue(address,uint256)"
        ];
        for (uint256 i = 0; i < sigs.length; i++) {
            (bool ok,) = address(hook).call(abi.encodeWithSignature(sigs[i]));
            assertFalse(ok, "an unexpected external function exists");
        }

        // (b) Routing a negative delta through any other contract addresses a DIFFERENT
        //     (empty) position, because v4 positions key on msg.sender.
        vm.prank(attacker);
        vm.expectRevert();
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: -int256(uint256(liquidity)),
                salt: bytes32(0)
            })
        );

        assertEq(_hookPositionLiquidity(), liquidity, "hook position was drained");
        assertEq(shard.balanceOf(attacker), 0, "attacker extracted SHARD");
    }

    function test_buyingMovesTickDown() public {
        hook.initialise();

        (, int24 tickBefore,,) = manager.getSlot0(poolId);
        uint256 managerEthBefore = address(manager).balance;

        _buy(UNDER_CAP_ETH); // sized to the 50 SHARD swap cap; the direction is what is asserted

        (, int24 tickAfter,,) = manager.getSlot0(poolId);

        assertLt(tickAfter, tickBefore, "tick did not move down");
        assertGt(address(manager).balance, managerEthBefore, "pool did not accumulate ETH");
        assertGt(shard.balanceOf(address(this)), 0, "buyer received no SHARD");
    }

    function test_constructorRejectsUnalignedTicks() public {
        int24 badUpper = TICK_UPPER + 1; // not a multiple of 60

        (, bytes32 salt) = HookMiner.find(
            address(this),
            HOOK_FLAGS,
            type(ShardHookHarnessV1).creationCode,
            abi.encode(
                manager, shard, TICK_LOWER, TICK_BAND, badUpper, startSqrtPriceX96, address(this), launcher, builder
            )
        );

        // The address is valid, so BaseHook's validateHookAddress passes and the tick check runs.
        vm.expectRevert(ShardErrorsV1.InvalidTickRange.selector);
        new ShardHookHarnessV1{ salt: salt }(
            manager, shard, TICK_LOWER, TICK_BAND, badUpper, startSqrtPriceX96, address(this), launcher, builder
        );
    }

    function test_unlockCallbackOnlyPoolManager() public {
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NotPoolManager.selector);
        hook.unlockCallback(abi.encode(ShardHookV1.Action.SWEEP, uint256(0)));
    }

    function test_sweepRedeems6909ClaimsToRealEth() public {
        uint256 amount = 3 ether;
        uint256 nativeId = CurrencyLibrary.ADDRESS_ZERO.toId();
        assertEq(nativeId, 0, "native ERC-6909 id must be 0");

        claimMinter.mintClaimTo{ value: amount }(address(hook), amount);
        assertEq(manager.balanceOf(address(hook), nativeId), amount, "claim not minted");

        uint256 hookEthBefore = address(hook).balance;

        hook.sweep();

        assertEq(manager.balanceOf(address(hook), nativeId), 0, "claim not burned");
        assertEq(address(hook).balance, hookEthBefore + amount, "real ETH did not arrive");

        // Idempotent: a second sweep with nothing outstanding is a no-op.
        hook.sweep();
        assertEq(address(hook).balance, hookEthBefore + amount, "second sweep changed balance");
    }

    /*//////////////////////////////////////////////////////////
                        TWO OVERLAPPING POSITIONS
    //////////////////////////////////////////////////////////*/

    function test_seedSplitAccountsForTheWholeSupply() public pure {
        assertEq(
            ShardConstantsV1.SEED_FULL_RANGE + ShardConstantsV1.SEED_BAND,
            ShardConstantsV1.MAX_NFTS * ShardConstantsV1.SHARDS_PER_NFT,
            "the two positions must seed exactly the whole supply"
        );
    }

    /// Both positions must exist after initialise, each holding its own share.
    /// NOTE: `setUp` funds the hook but does NOT initialise — each test seeds for itself.
    function test_seedsTwoOverlappingPositions() public {
        hook.initialise();
        uint128 full = _positionLiquidityAt(hook.tickLower(), hook.tickUpper());
        uint128 band = _positionLiquidityAt(hook.tickBand(), hook.tickUpper());

        assertGt(full, 0, "full-range position was not seeded");
        assertGt(band, 0, "band position was not seeded");
        assertEq(full, hook.seedLiquidity(), "full-range record does not match the position");
        assertEq(band, hook.seedLiquidityBand(), "band record does not match the position");
    }

    /// The band is stacked ON TOP of the full range, so it must be the denser of the two.
    /// If this inverts, the curve is shaped the wrong way round.
    function test_bandIsDenserThanTheFullRange() public {
        hook.initialise();
        assertGt(hook.seedLiquidityBand(), hook.seedLiquidity(), "band is not denser than the full range");
    }

    /// Below the band edge BOTH positions are active; above it only the full-range one is.
    /// That overlap is the entire point of the shape.
    ///
    /// The pool opens exactly AT `tickUpper`, and a v4 position is NOT active at its own upper
    /// bound, so active liquidity is legitimately ZERO until the first trade pushes the tick
    /// down into the range. Hence the buy: asserting at the start price would be vacuous.
    function test_activeLiquidityIsTheSumInsideTheBand() public {
        hook.initialise();
        assertEq(manager.getLiquidity(poolId), 0, "sanity: nothing is in range at the opening tick");

        _buy(0.0001 ether);

        (, int24 tick,,) = manager.getSlot0(poolId);
        assertLt(tick, TICK_UPPER, "the buy did not move the tick into the range");
        assertGt(tick, TICK_BAND, "the buy overshot the band edge - it should still be inside");

        assertEq(
            manager.getLiquidity(poolId),
            hook.seedLiquidity() + hook.seedLiquidityBand(),
            "inside the band, active liquidity must be BOTH positions summed"
        );
    }

    /// Two positions means two roundings, so dust is larger than the single-position 221 wei.
    /// The backing invariant is stated RELATIVE to seedDust, so it only has to be recorded.
    /// This suite wires no NFT, so nothing circulates and the backing identity reduces to
    /// "every SHARD is either in the position or recorded as dust". Two positions means two
    /// roundings, so the dust is larger than the single-position 221 wei — it only has to be
    /// RECORDED, because the invariant is stated relative to it.
    function test_seedDustIsRecordedAndBackingHolds() public {
        hook.initialise();
        assertEq(shard.balanceOf(address(hook)), hook.seedDust(), "hook holds SHARD beyond the recorded dust");
        assertEq(shard.balanceOf(address(manager)) + hook.seedDust(), SEED_AMOUNT, "SHARD went missing at seed time");
        assertLt(hook.seedDust(), 1e18, "dust should still be a fraction of one SHARD");
    }

    receive() external payable { }
}
