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
import { SwapParams, ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
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
                        ATTACKER CONTRACTS
//////////////////////////////////////////////////////////////*/

/// @dev Generic third-party swap router, also used as the attacker's execution venue.
contract AttackRouter is IUnlockCallback {
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

/// @dev Tries to burn the hook's locked position from outside. v4 keys positions on
///      `msg.sender`, so this addresses an empty position — but the attempt must be
///      made, not assumed away.
contract LiquidityThief is IUnlockCallback {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    receive() external payable { }

    function steal(PoolKey memory key, int24 tickLower, int24 tickUpper, int256 liquidityDelta) external {
        poolManager.unlock(abi.encode(key, tickLower, tickUpper, liquidityDelta));
    }

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        (PoolKey memory key, int24 tickLower, int24 tickUpper, int256 liquidityDelta) =
            abi.decode(rawData, (PoolKey, int24, int24, int256));
        poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: liquidityDelta, salt: bytes32(0)
            }),
            ""
        );
        return "";
    }
}

/// @dev Re-enters {ShardHookV1-claim} from the payout callback.
contract ReentrantFeeClaimer {
    ShardHookV1 public hook;
    bool public armed;
    uint256[] internal ids;

    function arm(ShardHookV1 h, uint256 id) external {
        hook = h;
        ids.push(id);
        armed = true;
    }

    function buy(uint256 value) external payable returns (uint256) {
        return hook.buyNFT{ value: value }(type(uint256).max, type(uint256).max);
    }

    function setHook(ShardHookV1 h) external {
        hook = h;
    }

    function disarm() external {
        armed = false;
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

/// @dev Re-enters {ShardHookV1-buyNFT} from the excess-ETH refund, i.e. from INSIDE
///      the first buy's `nonReentrant` scope.
contract ReentrantBuyer {
    ShardHookV1 public hook;
    bool public armed;

    constructor(ShardHookV1 h) {
        hook = h;
    }

    function attack(uint256 value) external {
        armed = true;
        hook.buyNFT{ value: value }(type(uint256).max, type(uint256).max);
    }

    receive() external payable {
        if (armed) {
            armed = false;
            hook.buyNFT{ value: address(this).balance }(type(uint256).max, type(uint256).max);
        }
    }
}

/// @dev Re-enters {ShardHookV1-sellNFT} from the sale payout.
contract ReentrantSeller {
    ShardHookV1 public hook;
    ShardNFTV1 public nft;
    uint256 public secondId;
    bool public armed;

    constructor(ShardHookV1 h, ShardNFTV1 n) {
        hook = h;
        nft = n;
    }

    function buy(uint256 value) external returns (uint256) {
        return hook.buyNFT{ value: value }(type(uint256).max, type(uint256).max);
    }

    function attack(uint256 firstId, uint256 secondId_) external {
        secondId = secondId_;
        armed = true;
        hook.sellNFT(firstId, 0, type(uint256).max);
    }

    receive() external payable {
        if (armed) {
            armed = false;
            hook.sellNFT(secondId, 0, type(uint256).max);
        }
    }
}

/// @dev Watches for an ERC-721 receive callback that must never fire, and if it
///      does, immediately deposits another token straight into the archive while
///      `_releasing` is still set — the exact corruption the HARD RULE prevents.
contract HostileReceiver {
    ShardNFTV1 public nft;
    ShardHookV1 public hook;
    bool public callbackFired;
    uint256 public otherId;
    bool public depositOnPayout;

    constructor(ShardHookV1 h) {
        hook = h;
    }

    function setNft(ShardNFTV1 n) external {
        nft = n;
    }

    function setOtherId(uint256 id) external {
        otherId = id;
    }

    function armPayoutDeposit() external {
        depositOnPayout = true;
    }

    function buy(uint256 value) external returns (uint256) {
        return hook.buyNFT{ value: value }(type(uint256).max, type(uint256).max);
    }

    function sell(uint256 id) external returns (uint256) {
        return hook.sellNFT(id, 0, type(uint256).max);
    }

    function depositDirect(uint256 id, address to) external {
        nft.transferFrom(address(this), to, id);
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        callbackFired = true;
        // If we ever get here, `_releasing` is set: push another id into the
        // archive behind the hook's back.
        if (otherId != 0 && otherId != tokenId) {
            nft.transferFrom(address(this), address(nft), otherId);
        }
        return this.onERC721Received.selector;
    }

    receive() external payable {
        if (depositOnPayout && otherId != 0) {
            depositOnPayout = false;
            nft.transferFrom(address(this), address(nft), otherId);
        }
    }
}

/*//////////////////////////////////////////////////////////////
                              TESTS
//////////////////////////////////////////////////////////////*/

/// @title ShardHookAttackV1Test
/// @notice Adversarial suite. Every test here PROVES AN ATTACK FAILS.
///
///         The security posture of this project is self-audit plus invariant
///         testing, with NO paid audit, and the liquidity position is locked
///         permanently. Nothing found after launch can be fixed. These tests
///         and `test/invariant/` are the entire safety net.
contract ShardHookAttackV1Test is Test {
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_UPPER = 115_080;
    int24 internal constant TICK_BAND = 22_980; // ~0.1 ETH per NFT, the concentrated band edge
    int24 internal TICK_LOWER;

    uint256 internal constant SEED_AMOUNT = 10_000 ether;
    uint256 internal constant ONE_SHARD = 1 ether;
    uint256 internal constant FAR = type(uint256).max;

    /// @dev The size of an ordinary third-party swap here. The hook caps ONE third-party swap
    ///      at `MAX_BATCH` SHARD (50e18), and at TICK_UPPER the price is ~1e-5 ETH per SHARD —
    ///      so half an ETH would move ~8,000 SHARD and be refused. This buys ~39 SHARD, inside
    ///      the cap, and still charges a fee far above dust. Where a test needs the price
    ///      MOVED rather than merely a fee taken, use {_swapShardOutChunked} instead.
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
    AttackRouter internal router;

    PoolKey internal key;
    PoolId internal poolId;
    uint160 internal startSqrtPriceX96;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA401);
    address internal attacker = address(0xBADBAD);
    address internal launcher = makeAddr("launcher");
    address internal builder = makeAddr("builder");

    function setUp() public {
        TICK_LOWER = TickMath.minUsableTick(TICK_SPACING);
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        manager = IPoolManager(address(new PoolManager(address(this))));
        factory = new ShardLaunchFactoryV1(manager, launcher, keccak256(type(ShardHookV1).creationCode));
        router = new AttackRouter(manager);
        ShardLaunchFactoryV1.LaunchParams memory params = ShardLaunchFactoryV1.LaunchParams({
            tickLower: TICK_LOWER,
            tickBand: TICK_BAND,
            tickUpper: TICK_UPPER,
            startSqrtPriceX96: startSqrtPriceX96,
            builderFeeRecipient: builder
        });
        (hook, shard, nft,) =
            ShardLaunchLib.mineAndLaunch(factory, keccak256("ShardHookAttackV1Test"), bytes32(0), params);
        renderer = factory.renderer();

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = key.toId();

        vm.deal(address(this), 100_000 ether);
        vm.deal(alice, 10_000 ether);
        vm.deal(bob, 10_000 ether);
        vm.deal(carol, 10_000 ether);
        vm.deal(attacker, 10_000 ether);
        vm.roll(block.number + 1);
    }

    receive() external payable { }

    /*//////////////////////////////////////////////////////////
                              HELPERS
    //////////////////////////////////////////////////////////*/

    function test_setupUsesAtomicFactory() public view {
        assertEq(hook.deployer(), address(factory));
    }

    function _feeAssets() internal view returns (uint256) {
        return address(hook).balance + manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
    }

    function _positionLiquidity() internal view returns (uint128 liquidity) {
        (liquidity,,) = manager.getPositionInfo(poolId, address(hook), TICK_LOWER, TICK_UPPER, bytes32(0));
    }

    function _buy(address who, uint256 send) internal returns (uint256 tokenId, uint256 spent) {
        uint256 before = who.balance;
        vm.prank(who);
        tokenId = hook.buyNFT{ value: send }(FAR, FAR);
        spent = before - who.balance;
    }

    function _buyMany(address who, uint256 count, uint256 send) internal returns (uint256[] memory ids, uint256 spent) {
        uint256 before = who.balance;
        vm.prank(who);
        ids = hook.buyMany{ value: send }(count, FAR, FAR);
        spent = before - who.balance;
    }

    function _buyMax(address who, uint256 send) internal returns (uint256[] memory ids, uint256 spent) {
        uint256 before = who.balance;
        vm.prank(who);
        ids = hook.buyMax{ value: send }(0, FAR);
        spent = before - who.balance;
    }

    function _assertBacking(string memory what) internal view {
        assertEq(shard.balanceOf(address(hook)), nft.circulatingSupply() * ONE_SHARD + hook.seedDust(), what);
    }

    function _swapEthIn(address who, uint256 amount) internal {
        vm.prank(who);
        router.swap{ value: amount }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
    }

    /// @dev Walk the price the way one large swap used to. A single third-party swap may move
    ///      at most `MAX_BATCH` SHARD, so the same total is taken out of the pool in cap-sized
    ///      exact-output steps. Exact-output because the SHARD leg is what the cap measures,
    ///      so specifying it is what makes each step land exactly on the allowed size.
    function _swapShardOutChunked(address who, uint256 shardsOut) internal {
        uint256 maxPerSwap = hook.MAX_BATCH() * ONE_SHARD;
        while (shardsOut > 0) {
            uint256 chunk = shardsOut > maxPerSwap ? maxPerSwap : shardsOut;
            vm.prank(who);
            router.swap{ value: who.balance }(
                key,
                SwapParams({
                    zeroForOne: true, amountSpecified: int256(chunk), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                })
            );
            shardsOut -= chunk;
        }
    }

    function _swapShardIn(address who, uint256 amount) internal {
        vm.startPrank(who);
        shard.approve(address(router), type(uint256).max);
        router.swap(
            key,
            SwapParams({
                zeroForOne: false, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            })
        );
        vm.stopPrank();
    }

    /// @dev v4 wraps hook reverts in `Hooks.WrappedError`, so the custom error is
    ///      nested rather than top-level. Scan the returndata for the selector.
    function _revertsWith(bytes memory ret, bytes4 sel) internal pure returns (bool) {
        if (ret.length < 4) return false;
        for (uint256 i = 0; i + 4 <= ret.length; i++) {
            if (ret[i] == sel[0] && ret[i + 1] == sel[1] && ret[i + 2] == sel[2] && ret[i + 3] == sel[3]) return true;
        }
        return false;
    }

    /// @dev A second, deliberately UN-initialised stack, for the pre-seed window.
    struct Fresh {
        ShardTokenV1 shard;
        ShardHookV1 hook;
        ShardNFTV1 nft;
        PoolKey key;
    }

    function _freshStack(bool wireNft) internal returns (Fresh memory f) {
        f.shard = new ShardTokenV1();
        (address expected, bytes32 salt) = HookMiner.find(
            address(this),
            HOOK_FLAGS,
            type(ShardHookV1).creationCode,
            abi.encode(
                manager, f.shard, TICK_LOWER, TICK_BAND, TICK_UPPER, startSqrtPriceX96, address(this), launcher, builder
            )
        );
        f.hook = new ShardHookV1{ salt: salt }(
            manager, f.shard, TICK_LOWER, TICK_BAND, TICK_UPPER, startSqrtPriceX96, address(this), launcher, builder
        );
        assertEq(address(f.hook), expected, "fresh hook address mismatch");

        if (wireNft) {
            f.nft = new ShardNFTV1(address(f.hook), address(renderer));
            f.hook.setNFT(IShardNFTV1(address(f.nft)));
        }

        f.key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(f.shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(f.hook))
        });

        f.shard.transfer(address(f.hook), SEED_AMOUNT);
        // NOT initialised on purpose.
    }

    /*//////////////////////////////////////////////////////////
                     1. THE PERMANENTLY LOCKED LP
    //////////////////////////////////////////////////////////*/

    /// The entire trust model. There must be no reachable path — behind any guard,
    /// owner, timelock or "emergency" — that reduces the seed position. If this
    /// ever fails there is no upgrade path and the protocol is dead.
    function test_ATTACK_cannotWithdrawLiquidity() public {
        uint128 seeded = _positionLiquidity();
        assertGt(seeded, 0, "sanity: nothing was seeded");

        // (a) Probe every plausible withdrawal selector on the hook itself. None
        //     of these may exist, and none may succeed if they somehow do.
        string[16] memory sigs = [
            "withdraw()",
            "withdraw(uint256)",
            "withdrawLiquidity(uint256)",
            "removeLiquidity(uint256)",
            "removeLiquidity(int256)",
            "emergencyWithdraw()",
            "emergencyWithdraw(address)",
            "rescue(address,uint256)",
            "rescueTokens(address,uint256)",
            "sweep(address)",
            "sweepTo(address,uint256)",
            "collect()",
            "collectFees(address)",
            "burn(uint256)",
            "modifyLiquidity(int256)",
            "unseed()"
        ];
        for (uint256 i = 0; i < sigs.length; i++) {
            bytes4 sel = bytes4(keccak256(bytes(sigs[i])));
            vm.prank(attacker);
            (bool ok,) = address(hook).call(abi.encodeWithSelector(sel, uint256(1), uint256(1)));
            assertFalse(ok, string.concat("A LIQUIDITY EXIT EXISTS: ", sigs[i]));
        }

        // (b) The hook's own unlock callback is the only place modifyLiquidity is
        //     reachable. It must reject any caller other than the PoolManager,
        //     including a forged SEED_LIQUIDITY payload.
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NotPoolManager.selector);
        hook.unlockCallback(abi.encode(uint8(0), SEED_AMOUNT));

        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NotPoolManager.selector);
        hook.unlockCallback(abi.encode(uint8(1), uint256(1 ether)));

        // (c) Go at the PoolManager directly. v4 keys positions on msg.sender, so
        //     the thief addresses an empty position of its own, not the hook's.
        LiquidityThief thief = new LiquidityThief(manager);
        vm.deal(address(thief), 100 ether);
        vm.expectRevert();
        thief.steal(key, TICK_LOWER, TICK_UPPER, -int256(uint256(seeded)));

        // (d) `initialise` is one-shot, so it cannot be replayed into a second
        //     modifyLiquidity call either.
        vm.prank(address(factory));
        vm.expectRevert(ShardErrorsV1.AlreadyInitialised.selector);
        hook.initialise();
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NotDeployer.selector);
        hook.initialise();

        // (e) Trade hard against the pool, then re-check. Trading must never
        //     shrink the position. The same ~3,300 SHARD one 0.05 ETH swap used to
        //     move, now walked in steps of the 50 SHARD swap cap.
        _swapShardOutChunked(attacker, 3300 ether);
        _buy(alice, 10 ether);
        vm.roll(block.number + 1);
        vm.prank(alice);
        hook.sellNFT(1, 0, FAR);

        assertEq(_positionLiquidity(), seeded, "THE LOCKED POSITION MOVED");
        assertEq(hook.seedLiquidity(), seeded, "seedLiquidity record changed");
    }

    /*//////////////////////////////////////////////////////////
                    2. POOL / INITIALISATION GUARDS
    //////////////////////////////////////////////////////////*/

    /// @dev Asserts the pool was rejected BY THE HOOK for being the wrong pool, not
    ///      incidentally by some unrelated v4 validation.
    function _expectWrongPool(PoolKey memory k, string memory what) internal {
        vm.prank(attacker);
        (bool ok, bytes memory ret) =
            address(manager).call(abi.encodeWithSelector(IPoolManager.initialize.selector, k, startSqrtPriceX96));
        assertFalse(ok, string.concat("A FOREIGN POOL WAS BOUND TO THIS HOOK: ", what));
        assertTrue(
            _revertsWith(ret, ShardErrorsV1.WrongPool.selector), string.concat("rejected, but not as WrongPool: ", what)
        );
    }

    /// A foreign pool bound to this hook would route fees denominated in the WRONG
    /// currency into `_distribute`, inflating `accFeePerNFT` against ETH the hook
    /// does not hold and permanently bricking `claim` for real holders.
    function test_ATTACK_cannotInitialiseForeignPool() public {
        Currency usdc = Currency.wrap(address(type(uint160).max)); // sorts above SHARD

        // SHARD / "USDC" against this hook.
        PoolKey memory foreign = PoolKey({
            currency0: Currency.wrap(address(shard)),
            currency1: usdc,
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        _expectWrongPool(foreign, "SHARD/USDC");

        // ETH / "USDC" against this hook.
        foreign.currency0 = CurrencyLibrary.ADDRESS_ZERO;
        foreign.currency1 = usdc;
        _expectWrongPool(foreign, "ETH/USDC");

        // The canonical pair but a different fee tier — a distinct PoolId, so a
        // distinct fee stream the hook would mis-attribute.
        PoolKey memory wrongFee = key;
        wrongFee.fee = 3000;
        _expectWrongPool(wrongFee, "wrong fee tier");

        // The canonical pair but a different tick spacing.
        PoolKey memory wrongSpacing = key;
        wrongSpacing.tickSpacing = 10;
        _expectWrongPool(wrongSpacing, "wrong tick spacing");

        // And nothing leaked into the accumulator.
        assertEq(hook.accFeePerNFT(), 0, "a foreign pool moved the accumulator");
        assertEq(hook.escrowBalance(), 0, "a foreign pool escrowed a fee");
    }

    /// Below `tickUpper` the seed would demand ETH the hook does not have — a
    /// permanent, unfixable grief. Far above it, the first buyer collapses the
    /// price for free.
    function test_ATTACK_cannotFrontRunInitialiseAtDifferentPrice() public {
        Fresh memory f = _freshStack(true);

        uint160[4] memory bad = [
            TickMath.getSqrtPriceAtTick(TICK_UPPER - TICK_SPACING),
            TickMath.getSqrtPriceAtTick(TICK_UPPER + TICK_SPACING),
            TickMath.getSqrtPriceAtTick(0),
            TickMath.getSqrtPriceAtTick(TickMath.maxUsableTick(TICK_SPACING))
        ];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.prank(attacker);
            (bool ok, bytes memory ret) =
                address(manager).call(abi.encodeWithSelector(IPoolManager.initialize.selector, f.key, bad[i]));
            assertFalse(ok, "A FRONT-RUNNER SET THE START PRICE");
            assertTrue(_revertsWith(ret, ShardErrorsV1.WrongStartPrice.selector), "rejected, but not for the price");
        }

        // Initialising at the CANONICAL price is tolerated by design: the hook
        // swallows PoolAlreadyInitialized and seeds anyway. Prove the front-run
        // is a no-op rather than a denial of service.
        vm.prank(attacker);
        manager.initialize(f.key, startSqrtPriceX96);

        uint128 liquidity = f.hook.initialise();
        assertGt(liquidity, 0, "front-run bricked the seed");
        assertEq(f.shard.balanceOf(address(f.hook)), f.hook.seedDust(), "seed did not go in");
    }

    /// The pre-seed window: a front-runner who created the canonical pool must not
    /// be able to trade the price away before the hook seeds it.
    function test_ATTACK_cannotSwapBeforeInitialise() public {
        Fresh memory f = _freshStack(true);

        vm.prank(attacker);
        manager.initialize(f.key, startSqrtPriceX96);

        vm.prank(attacker);
        (bool ok, bytes memory ret) = address(router).call{ value: 1 ether }(
            abi.encodeCall(
                AttackRouter.swap,
                (
                    f.key,
                    SwapParams({
                        zeroForOne: true,
                        amountSpecified: -int256(uint256(1 ether)),
                        sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                    })
                )
            )
        );
        assertFalse(ok, "THE PRE-SEED POOL WAS TRADEABLE");
        assertTrue(_revertsWith(ret, ShardErrorsV1.NotInitialised.selector), "rejected, but not as NotInitialised");

        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NotInitialised.selector);
        f.hook.buyNFT{ value: 1 ether }(FAR, FAR);

        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NotInitialised.selector);
        f.hook.redeem();

        // The guard must lift once seeded — otherwise it is itself a permanent grief.
        // Sized to the 50 SHARD swap cap: what is asserted is that the swap goes through.
        f.hook.initialise();
        vm.prank(attacker);
        router.swap{ value: UNDER_CAP_ETH }(
            f.key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(UNDER_CAP_ETH),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        assertGt(f.shard.balanceOf(attacker), 0, "the guard never lifted");
    }

    /// A malicious NFT bound here could drain the accumulator via
    /// `settleOnTransfer` across all 10,000 ids.
    function test_ATTACK_cannotHijackSetNft() public {
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NotDeployer.selector);
        hook.setNFT(IShardNFTV1(address(0xDEAD)));

        // Even the deployer cannot rebind it.
        vm.prank(address(factory));
        vm.expectRevert(ShardErrorsV1.AlreadyInitialised.selector);
        hook.setNFT(IShardNFTV1(address(0xDEAD)));
        assertEq(address(hook.nft()), address(nft), "the NFT binding moved");

        // On an unbound hook the gate is the deployer check, not "first come".
        Fresh memory f = _freshStack(false);
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NotDeployer.selector);
        f.hook.setNFT(IShardNFTV1(address(0xDEAD)));
        vm.expectRevert(ShardErrorsV1.ZeroAddress.selector);
        f.hook.setNFT(IShardNFTV1(address(0)));

        // And nothing but the real NFT may drive fee settlement.
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NotNFT.selector);
        hook.settleOnTransfer(1, attacker, attacker);
    }

    /*//////////////////////////////////////////////////////////
                       3. FEE-TIMING ATTACKS
    //////////////////////////////////////////////////////////*/

    /// The same-block accrual guard exists for exactly this: buy in, capture the
    /// block's fees, leave. The sniper must end DOWN, and the fees must land on
    /// the holders who were already there.
    function test_ATTACK_sameBlockFeeSnipeEarnsNothing() public {
        // A genuine holder, from an earlier block.
        (uint256 bobId,) = _buy(bob, 5 ether);
        vm.roll(block.number + 1);

        uint256 attackerStart = attacker.balance;

        // --- everything below happens in ONE block ---
        (uint256 snipeId,) = _buy(attacker, 5 ether);

        // A large third-party flow, round-tripped so the price ends roughly where
        // it started. This isolates FEE capture from price movement.
        _swapEthIn(carol, UNDER_CAP_ETH); // sized to the 50 SHARD swap cap
        _swapShardIn(carol, shard.balanceOf(carol));

        vm.prank(attacker);
        hook.sellNFT(snipeId, 0, FAR);

        uint256[] memory ids = new uint256[](1);
        ids[0] = snipeId;
        vm.prank(attacker);
        try hook.claim(ids) returns (uint256 paid) {
            assertEq(paid, 0, "THE SNIPER WAS PAID");
        } catch { }
        // --- end of block ---

        assertEq(hook.claimable(attacker), 0, "sniper accrued a claimable balance");
        assertLt(attacker.balance, attackerStart, "THE SAME-BLOCK FEE SNIPE WAS PROFITABLE");

        // The fees went to the holder who was actually there.
        uint256[] memory bobIds = new uint256[](1);
        bobIds[0] = bobId;
        vm.prank(bob);
        uint256 bobPaid = hook.claim(bobIds);
        assertGt(bobPaid, 0, "the real holder got nothing");
    }

    /// The variant that routes around `sellNFT`: acquire, then hand the token on
    /// with a plain ERC-721 transfer inside the acquisition block. `settleOnTransfer`
    /// must credit nothing.
    function test_ATTACK_transferInAcquisitionBlockEarnsNothing() public {
        (uint256 bobId,) = _buy(bob, 5 ether);
        vm.roll(block.number + 1);

        // --- one block ---
        (uint256 snipeId,) = _buy(attacker, 5 ether);
        _swapEthIn(carol, UNDER_CAP_ETH); // fees for this block; sized to the 50 SHARD swap cap

        vm.prank(attacker);
        nft.transferFrom(attacker, alice, snipeId);
        // --- end of block ---

        assertEq(hook.claimable(attacker), 0, "TRANSFER-OUT SNIPED THE BLOCK'S FEES");
        assertEq(hook.claimable(alice), 0, "the receiver was credited for a block it did not hold");

        uint256[] memory ids = new uint256[](2);
        ids[0] = bobId;
        ids[1] = snipeId;

        // The sniper cannot even settle themselves into a payout.
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NothingToClaim.selector);
        hook.claim(ids);

        // The whole block's fee belongs to the holder who was already there.
        vm.prank(bob);
        uint256 bobPaid = hook.claim(ids);
        assertGt(bobPaid, 0, "the pre-existing holder earned nothing");
        assertEq(hook.claimable(attacker), 0, "the sniper accrued after the fact");
        assertEq(hook.claimable(alice), 0, "the receiver accrued for a block it did not hold");
    }

    /*//////////////////////////////////////////////////////////
                    4. THE ART-REROLL ECONOMICS
    //////////////////////////////////////////////////////////*/

    /// Art regenerates on every acquisition from the archive. If a round trip were
    /// cheap, the collection would be an infinite free reroll and the art means
    /// nothing. The 2% round trip is the entire defence — and there is deliberately
    /// no NFT-to-SHARD path that would sidestep it.
    function test_ATTACK_cannotRerollArtForFree() public {
        (uint256 id, uint256 spent) = _buy(attacker, 5 ether);
        uint256 seedBefore = nft.tokenSeed(id);
        assertGt(seedBefore, 0, "no art was generated");

        vm.prank(attacker);
        uint256 payout = hook.sellNFT(id, 0, FAR);

        uint256 cost = spent - payout;
        assertGt(cost, spent * 15 / 1000, "A REROLL COSTS LESS THAN 1.5% - the loop is open");
        assertLt(cost, spent * 30 / 1000, "round trip costs more than 3%");

        // Rerolling gets you different art, but you paid for it.
        (uint256 id2,) = _buy(attacker, 5 ether);
        assertEq(id2, id, "the archive did not hand back the same id");
        assertTrue(nft.tokenSeed(id2) != seedBefore, "sanity: the art did not change");

        // There is no cheaper door. Any NFT-to-SHARD path would be one.
        string[6] memory forbidden = [
            "deposit(uint256)",
            "depositNFT(uint256)",
            "unwrap(uint256)",
            "wrap(uint256)",
            "burnNFT(uint256)",
            "exchange(uint256)"
        ];
        for (uint256 i = 0; i < forbidden.length; i++) {
            vm.prank(attacker);
            (bool ok,) = address(hook).call(abi.encodeWithSelector(bytes4(keccak256(bytes(forbidden[i]))), id2));
            assertFalse(ok, string.concat("AN NFT-TO-SHARD PATH EXISTS: ", forbidden[i]));
        }
    }

    /// v4 skips a hook's own callbacks, so `buyNFT` must charge the 1% by hand. If
    /// it ever stops, buying is free relative to swap-then-redeem and the reroll
    /// loop opens from the other side.
    function test_ATTACK_buyNftIsNotAFreeFeeBypass() public {
        uint256 snap = vm.snapshotState();

        // Path A: buyNFT.
        uint256 f0 = _feeAssets();
        (, uint256 buyCost) = _buy(alice, 5 ether);
        uint256 buyFee = _feeAssets() - f0;

        vm.revertToState(snap);

        // Path B: third-party swap for exactly 1 SHARD, then redeem.
        uint256 g0 = _feeAssets();
        uint256 before = bob.balance;
        vm.startPrank(bob);
        router.swap{ value: 5 ether }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: int256(ONE_SHARD), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        uint256 swapCost = before - bob.balance;
        shard.approve(address(hook), type(uint256).max);
        hook.redeem();
        vm.stopPrank();
        uint256 swapFee = _feeAssets() - g0;

        assertGt(buyFee, 0, "buyNFT IS FREE - the explicit charge is gone");
        assertApproxEqRel(buyFee, swapFee, 0.01e18, "buyNFT is a cheaper door than swap-then-redeem");
        assertApproxEqRel(buyCost, swapCost, 0.01e18, "the two entry paths diverge in total cost");
        assertGe(buyFee, swapFee * 99 / 100, "BUYNFT UNDERCHARGES relative to the swap path");
    }

    /*//////////////////////////////////////////////////////////
                     5. NFT CUSTODY AND REENTRANCY
    //////////////////////////////////////////////////////////*/

    /// A plain `transferFrom` into the archive would strand the id: no `_markHeld`,
    /// no `_circulating` decrement, no hook accounting — a permanent hole in the
    /// core backing invariant on a contract with no upgrade path.
    function test_ATTACK_directNftTransferStrandsNothing() public {
        (uint256 id,) = _buy(alice, 5 ether);
        uint256 circBefore = nft.circulatingSupply();

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.DirectTransferRejected.selector);
        nft.transferFrom(alice, address(nft), id);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.DirectTransferRejected.selector);
        nft.transferFrom(alice, address(hook), id);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.DirectTransferRejected.selector);
        nft.safeTransferFrom(alice, address(nft), id);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.DirectTransferRejected.selector);
        nft.safeTransferFrom(alice, address(hook), id);

        // An approved operator is no better.
        vm.prank(alice);
        nft.setApprovalForAll(attacker, true);
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.DirectTransferRejected.selector);
        nft.transferFrom(alice, address(nft), id);

        assertEq(nft.ownerOf(id), alice, "the token moved anyway");
        assertEq(nft.circulatingSupply(), circBefore, "circulating supply drifted");
        assertEq(
            shard.balanceOf(address(hook)), nft.circulatingSupply() * ONE_SHARD + hook.seedDust(), "SHARD backing broke"
        );
    }

    /// `_releasing` bypasses the direct-deposit guard, and ShardNFTV1 has no
    /// reentrancy guard. It is safe ONLY because no external call happens while the
    /// flag is set — i.e. because acquire/release use `_mint`/`_transfer` and NEVER
    /// the `_safe*` variants. This proves the receiver hook never fires.
    function test_ATTACK_reentrantTransferDuringReleasingFails() public {
        HostileReceiver hostile = new HostileReceiver(hook);
        hostile.setNft(nft);
        vm.deal(address(hostile), 100 ether);

        uint256 first = hostile.buy(5 ether);
        uint256 second = hostile.buy(5 ether);
        hostile.setOtherId(second);

        // Acquisition must NOT call onERC721Received. If it did, the receiver could
        // deposit `second` into the archive while `_releasing` was still set.
        uint256 third = hostile.buy(5 ether);
        assertFalse(hostile.callbackFired(), "ACQUIRE USES A _safe* VARIANT - the archive is reentrable");
        assertEq(nft.ownerOf(third), address(hostile), "sanity: the buy failed");

        // Release must not call it either.
        vm.roll(block.number + 1);
        hostile.sell(third);
        assertFalse(hostile.callbackFired(), "RELEASE USES A _safe* VARIANT");

        // And the direct route into the archive stays shut for a contract too.
        vm.expectRevert(ShardErrorsV1.DirectTransferRejected.selector);
        hostile.depositDirect(second, address(nft));

        // Finally: re-enter from the sale payout, the one external call the hook
        // does make. The deposit guard must reject it, which unwinds the sale.
        hostile.armPayoutDeposit();
        vm.expectRevert();
        hostile.sell(first);

        assertEq(nft.ownerOf(first), address(hostile), "the sale half-completed");
        assertEq(nft.ownerOf(second), address(hostile), "an id was stranded in the archive");
        assertEq(
            shard.balanceOf(address(hook)), nft.circulatingSupply() * ONE_SHARD + hook.seedDust(), "SHARD backing broke"
        );
    }

    /// The refund at the end of `buyNFT` is an external call to the buyer. It sits
    /// inside `nonReentrant` on purpose.
    function test_ATTACK_reentrantBuyDuringUnlockFails() public {
        ReentrantBuyer buyer = new ReentrantBuyer(hook);
        vm.deal(address(buyer), 100 ether);

        vm.expectRevert();
        buyer.attack(50 ether); // huge overpay guarantees a refund, hence a callback

        assertEq(nft.circulatingSupply(), 0, "a reentrant buy minted something");
        assertEq(nft.lowestAvailableId(), 1, "the archive pointer moved");
    }

    /// The same for the sale payout.
    function test_ATTACK_reentrantSellDuringUnlockFails() public {
        ReentrantSeller seller = new ReentrantSeller(hook, nft);
        vm.deal(address(seller), 100 ether);

        uint256 a = seller.buy(5 ether);
        uint256 b = seller.buy(5 ether);
        vm.roll(block.number + 1);

        vm.expectRevert();
        seller.attack(a, b);

        assertEq(nft.ownerOf(a), address(seller), "the reentrant sale went through");
        assertEq(nft.ownerOf(b), address(seller), "the reentrant sale went through");
        assertEq(nft.circulatingSupply(), 2, "supply accounting drifted");
    }

    /*//////////////////////////////////////////////////////////
                        6. CLAIM ATTACKS
    //////////////////////////////////////////////////////////*/

    /// Solvency, not conservation: a same-block double claim once produced 2 ether
    /// of claims against 1 ether of fees. Repeat ids in one call, and repeat calls
    /// in one block, must both be worthless.
    function test_ATTACK_cannotClaimTwice() public {
        (uint256 id,) = _buy(alice, 5 ether);
        vm.roll(block.number + 1);

        _swapEthIn(carol, UNDER_CAP_ETH); // sized to the 50 SHARD swap cap
        // Nothing has been paid out yet, so everything the hook holds — in ETH and
        // in un-swept ERC-6909 claims — is exactly every fee ever taken.
        uint256 feesTaken = _feeAssets();
        assertGt(feesTaken, 0, "sanity: no fee was taken");

        // Repeat the same id four times in a single call.
        uint256[] memory dupes = new uint256[](4);
        for (uint256 i = 0; i < 4; i++) {
            dupes[i] = id;
        }
        vm.prank(alice);
        uint256 paid = hook.claim(dupes);
        assertGt(paid, 0, "sanity: nothing paid");
        assertLe(paid, feesTaken, "DUPLICATE IDS PAID MORE THAN WAS EVER COLLECTED");

        // Same block, again.
        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.NothingToClaim.selector);
        hook.claim(dupes);

        // Next block, with no new fees, still nothing.
        vm.roll(block.number + 1);
        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.NothingToClaim.selector);
        hook.claim(dupes);

        assertLe(paid + hook.claimable(alice), feesTaken, "INSOLVENT: claims exceed fees taken");
    }

    /// Settlement is permissionless by design. It must credit the OWNER, never the
    /// caller — otherwise anyone drains every holder by passing their ids.
    function test_ATTACK_cannotStealAnotherHoldersFees() public {
        (uint256 aliceId,) = _buy(alice, 5 ether);
        (uint256 attackerId,) = _buy(attacker, 5 ether);
        vm.roll(block.number + 1);
        _swapEthIn(carol, UNDER_CAP_ETH); // sized to the 50 SHARD swap cap

        // Case 1: an attacker holding NOTHING passes a holder's id. There is no
        // payout to take, so the call reverts and no ETH moves.
        uint256 carolBefore = carol.balance;
        uint256[] memory aliceOnly = new uint256[](1);
        aliceOnly[0] = aliceId;
        vm.prank(carol);
        vm.expectRevert(ShardErrorsV1.NothingToClaim.selector);
        hook.claim(aliceOnly);
        assertEq(carol.balance, carolBefore, "A NON-HOLDER WAS PAID SOMEONE ELSE'S FEES");

        // Case 2: an attacker who DOES hold something passes everyone's ids, so the
        // call succeeds. Settlement must still credit each id's OWNER, and pay the
        // caller only their own balance.
        uint256[] memory everything = new uint256[](2);
        everything[0] = aliceId;
        everything[1] = attackerId;

        uint256 attackerBefore = attacker.balance;
        vm.prank(attacker);
        uint256 paid = hook.claim(everything);

        assertEq(attacker.balance - attackerBefore, paid, "payout mismatch");
        assertGt(hook.claimable(alice), 0, "the rightful owner was NOT credited");
        assertApproxEqAbs(paid, hook.claimable(alice), 2, "THE ATTACKER TOOK MORE THAN THEIR OWN SHARE");
        assertEq(hook.claimable(attacker), 0, "the attacker kept a residual balance");

        // And alice can still take every wei of hers.
        uint256 owed = hook.claimable(alice);
        vm.prank(alice);
        assertEq(hook.claim(aliceOnly), owed, "the owner's balance was skimmed");
    }

    function test_ATTACK_reentrantClaimFails() public {
        ReentrantFeeClaimer claimer = new ReentrantFeeClaimer();
        claimer.setHook(hook);
        vm.deal(address(claimer), 100 ether);

        uint256 id = claimer.buy(5 ether);
        vm.roll(block.number + 1);
        _swapEthIn(carol, UNDER_CAP_ETH); // sized to the 50 SHARD swap cap

        uint256 balanceBefore = address(claimer).balance;
        uint256 owedBefore = _feeAssets();

        claimer.arm(hook, id);
        vm.expectRevert();
        claimer.go();

        // Nothing was paid and nothing was zeroed.
        assertEq(address(claimer).balance, balanceBefore, "the reentrant claim moved ETH");
        assertEq(_feeAssets(), owedBefore, "the reentrant claim drained the hook");
        // Disarmed, a single honest claim still works — the guard is not a brick.
        claimer.disarm();
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(address(claimer));
        uint256 paid = hook.claim(ids);
        assertGt(paid, 0, "the reentrancy guard permanently bricked claiming");
    }

    /*//////////////////////////////////////////////////////////
                    7. REDEEM AND SUPPLY LIMITS
    //////////////////////////////////////////////////////////*/

    function test_ATTACK_cannotRedeemWithoutShards() public {
        // No balance, no approval.
        vm.prank(attacker);
        vm.expectRevert();
        hook.redeem();

        // Approval but no balance.
        vm.startPrank(attacker);
        shard.approve(address(hook), type(uint256).max);
        vm.expectRevert();
        hook.redeem();
        vm.stopPrank();

        // A partial balance is not enough — the price of an NFT is exactly 1 SHARD.
        vm.prank(attacker);
        router.swap{ value: 5 ether }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: int256(ONE_SHARD / 2), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        assertEq(shard.balanceOf(attacker), ONE_SHARD / 2, "sanity: wrong balance");
        vm.prank(attacker);
        vm.expectRevert();
        hook.redeem();

        assertEq(nft.circulatingSupply(), 0, "an NFT was minted without a shard");
        assertEq(
            shard.balanceOf(address(hook)), nft.circulatingSupply() * ONE_SHARD + hook.seedDust(), "SHARD backing broke"
        );
    }

    /// 10,000 is the whole collection. The 10,001st acquisition must revert, and
    /// `_advanceLowest` must terminate rather than scanning forever.
    function test_ATTACK_cannotMintPastTenThousand() public {
        uint256 max = nft.MAX_SUPPLY();

        vm.startPrank(address(hook));
        for (uint256 i = 1; i <= max; i++) {
            uint256 id = nft.acquire(alice, i);
            assertEq(id, i, "ids were not handed out in order");
        }
        vm.stopPrank();

        assertEq(nft.circulatingSupply(), max, "circulating supply is wrong");
        assertEq(nft.lowestAvailableId(), max + 1, "_advanceLowest did not terminate at 10_001");

        vm.prank(address(hook));
        vm.expectRevert(ShardErrorsV1.PoolExhausted.selector);
        nft.acquire(attacker, 1);

        // And the market path reverts too, rather than taking money for nothing.
        uint256 balanceBefore = attacker.balance;
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.PoolExhausted.selector);
        hook.buyNFT{ value: 50 ether }(FAR, FAR);
        assertEq(attacker.balance, balanceBefore, "ETH was taken for a mint that could not happen");
    }

    /*//////////////////////////////////////////////////////////
                         8. GRIEFING / MEV
    //////////////////////////////////////////////////////////*/

    /// Fees are shared by integer division. Someone spamming sub-wei-per-holder
    /// distributions must not be able to strand value: the remainder is carried in
    /// SCALED units, so nothing is lost, only deferred.
    function test_ATTACK_dustCannotBeGriefedToStrandFunds() public {
        address[3] memory holders = [alice, bob, carol];
        uint256[] memory ids = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            (ids[i],) = _buy(holders[i], 5 ether);
        }
        vm.roll(block.number + 1);

        // 1-wei and 2-wei distributions: with 3 holders each one divides to zero
        // and lands entirely in `dustScaled`.
        uint256 landed;
        for (uint256 i = 0; i < 60; i++) {
            uint256 amount = (i % 2 == 0) ? 100 wei : 199 wei;
            vm.prank(attacker);
            try router.swap{ value: amount }(
                key,
                SwapParams({
                    zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                })
            ) {
                landed++;
            } catch { }
        }
        assertGt(landed, 0, "sanity: no dust distributions landed");

        // Nothing has been claimed yet, so what the hook holds IS every fee ever taken.
        uint256 feesTaken = _feeAssets();
        assertGt(feesTaken, 0, "sanity: the grief took no fees");

        // Everything must still come out.
        uint256 paidOut;
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(holders[i]);
            try hook.claim(ids) returns (uint256 paid) {
                paidOut += paid;
            } catch { }
        }

        uint256 stillOwed;
        for (uint256 i = 0; i < 3; i++) {
            stillOwed += hook.claimable(holders[i]);
        }

        // The hook still custodies the builder's and launcher's cuts until they claim, so they
        // are part of `feesTaken` but were never destined for the holder pool.
        uint256 cuts = hook.builderFeesAccrued() + hook.launcherFeesAccrued();

        // Solvency first.
        assertLe(paidOut + stillOwed + hook.escrowBalance() + cuts, feesTaken, "INSOLVENT after a dust grief");

        // Then: at most a sub-wei remainder per holder is deferred, and it is
        // carried, not lost.
        uint256 deferred = feesTaken - paidOut - stillOwed - hook.escrowBalance() - cuts;
        assertLe(deferred, hook.circulating(), "DUST WAS STRANDED, not carried");
        assertLt(hook.dustScaled(), hook.circulating(), "dustScaled exceeded a full unit");

        // A normal-sized fee afterwards still flows, i.e. the accumulator is not wedged.
        uint256 accBefore = hook.accFeePerNFT();
        _swapEthIn(attacker, UNDER_CAP_ETH); // sized to the 50 SHARD swap cap
        assertGt(hook.accFeePerNFT(), accBefore, "the accumulator was wedged by dust");
    }

    /// Third-party fees sit as ERC-6909 claims on the PoolManager, owned by the
    /// hook, until a `claim` call sweeps them. That balance is a live pot of ETH
    /// held under a token standard with its own transfer and operator surface —
    /// and the hook never approves anyone.
    function test_ATTACK_cannotStealErc6909FeeClaims() public {
        (uint256 id,) = _buy(alice, 5 ether);
        vm.roll(block.number + 1);
        _swapEthIn(carol, UNDER_CAP_ETH); // sized to the 50 SHARD swap cap

        uint256 ethId = CurrencyLibrary.ADDRESS_ZERO.toId();
        uint256 held = manager.balanceOf(address(hook), ethId);
        assertGt(held, 0, "sanity: no claims accrued");

        // Direct transfer of someone else's balance.
        vm.prank(attacker);
        (bool ok,) = address(manager)
            .call(
                abi.encodeWithSignature(
                    "transferFrom(address,address,uint256,uint256)", address(hook), attacker, ethId, held
                )
            );
        assertFalse(ok, "AN ATTACKER MOVED THE HOOK'S FEE CLAIMS");

        // Burning them out from under the hook.
        vm.prank(attacker);
        (ok,) =
            address(manager).call(abi.encodeWithSignature("burn(address,uint256,uint256)", address(hook), ethId, held));
        assertFalse(ok, "AN ATTACKER BURNED THE HOOK'S FEE CLAIMS");

        // Appointing themselves operator.
        vm.prank(attacker);
        (ok,) = address(manager).call(abi.encodeWithSignature("setOperator(address,bool)", address(hook), true));
        if (ok) {
            vm.prank(attacker);
            (ok,) = address(manager)
                .call(
                    abi.encodeWithSignature(
                        "transferFrom(address,address,uint256,uint256)", address(hook), attacker, ethId, held
                    )
                );
            assertFalse(ok, "AN ATTACKER BECAME OPERATOR OF THE HOOK'S CLAIMS");
        }

        assertEq(manager.balanceOf(address(hook), ethId), held, "the claim balance moved");

        // And the rightful holder still gets it all.
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(alice);
        assertGt(hook.claim(ids), 0, "the holder could not collect");
        assertEq(manager.balanceOf(address(hook), ethId), 0, "claims were not swept");
    }

    /// `buyNFT` walks the curve at whatever price the block leaves it at, so a
    /// sandwich CAN raise the cost. `maxEthIn` is the only protection, and it must
    /// actually bind.
    function test_ATTACK_sandwichBuyNftIsBoundedByMaxEthIn() public {
        // Establish the fair cost.
        uint256 snap = vm.snapshotState();
        (, uint256 fairCost) = _buy(alice, 50 ether);
        vm.revertToState(snap);

        // Attacker front-runs, pushing SHARD up. No single swap may move more than the 50 SHARD
        // cap, so the sandwich is four of them — enough to clear the victim's 1% bound below,
        // which is the whole point of this leg.
        _swapShardOutChunked(attacker, 200 ether);

        // With a 1% bound the victim is refused, not drained.
        vm.prank(alice);
        vm.expectPartialRevert(ShardErrorsV1.SlippageExceeded.selector);
        hook.buyNFT{ value: 50 ether }(fairCost * 101 / 100, FAR);
        assertEq(nft.circulatingSupply(), 0, "the bounded buy went through anyway");

        // And the bound is genuinely load-bearing: unbounded, the victim overpays.
        (, uint256 sandwichedCost) = _buy(alice, 50 ether);
        assertGt(sandwichedCost, fairCost * 101 / 100, "sanity: the sandwich did not move the price");

        // The deadline is the other half of the same protection.
        vm.warp(block.timestamp + 1);
        vm.prank(bob);
        vm.expectRevert(ShardErrorsV1.Expired.selector);
        hook.buyNFT{ value: 50 ether }(FAR, block.timestamp - 1);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.Expired.selector);
        hook.sellNFT(1, 0, block.timestamp - 1);
    }

    /*//////////////////////////////////////////////////////////
                          9. BATCH BUYING
    //////////////////////////////////////////////////////////*/

    /// v4 SKIPS a hook's own beforeSwap/afterSwap (Hooks.sol:253/:293) because the hook
    /// is the swapper, so `buyMany` charges the 1% EXPLICITLY in its own body. Delete
    /// that one line and bulk buying becomes FREE while every callback test stays green
    /// — this is the test that has to notice.
    ///
    /// The bar is a RATE, not an amount: N in a batch must cost the same 1% as N single
    /// buys and as a third-party swap-then-redeem of the same N shards.
    function test_ATTACK_buyManyIsNotAFreeFeeBypass() public {
        uint256 n = 5;
        uint256 snap = vm.snapshotState();

        // Path A: one batch.
        (uint256[] memory ids, uint256 batchSpent) = _buyMany(alice, n, 5 ether);
        uint256 batchFee = _feeAssets();
        assertEq(ids.length, n, "sanity: wrong count minted");

        vm.revertToState(snap);

        // Path B: the same N as individual buyNFT calls.
        uint256 singlesSpent;
        for (uint256 i = 0; i < n; i++) {
            (, uint256 s) = _buy(bob, 5 ether);
            singlesSpent += s;
        }
        uint256 singlesFee = _feeAssets();

        vm.revertToState(snap);

        // Path C: a third-party exact-output swap for N shards, then N redeems. This
        // path is charged by the CALLBACKS, so it is an independent measurement of the
        // same 1% — if the explicit charge in `buyMany` were gone, only A would be zero.
        uint256 carolBefore = carol.balance;
        vm.startPrank(carol);
        router.swap{ value: 50 ether }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: int256(n * ONE_SHARD), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        uint256 swapSpent = carolBefore - carol.balance;
        shard.approve(address(hook), type(uint256).max);
        for (uint256 i = 0; i < n; i++) {
            hook.redeem();
        }
        vm.stopPrank();
        uint256 swapFee = _feeAssets();

        vm.revertToState(snap);

        // 1. The batch is not free.
        assertGt(batchFee, 0, "buyMany IS FREE - the explicit 1% charge is gone");

        // 2. It is charged at the inclusive 1% of the TOTAL paid, exactly once. Twice
        //    would read ~2%, and the 0.990% (`net * 100 / 10000`) mistake reads low.
        assertApproxEqRel(batchFee, batchSpent / 100, 0.001e18, "batch fee is not an inclusive 1% charged ONCE");

        // 3. Same RATE as N single buys and as the callback-charged swap path. A batch
        //    that undercharges is a cheaper door into the collection and reopens the
        //    free-reroll loop from the bulk side.
        assertApproxEqRel(batchFee, singlesFee, 0.02e18, "buyMany charges a DIFFERENT RATE than N single buys");
        assertGe(batchFee * 100, singlesFee * 99, "BUYMANY UNDERCHARGES relative to N single buys");
        assertGe(batchFee * 100, swapFee * 99, "BUYMANY UNDERCHARGES relative to swap-then-redeem");

        // 4. And the ETH cost of the batch is the honest curve cost, not a discount.
        assertApproxEqRel(batchSpent, singlesSpent, 0.02e18, "the batch walked a different curve than N singles");
        assertApproxEqRel(batchSpent, swapSpent, 0.02e18, "batch cost diverges from the swap-then-redeem path");
    }

    /// `buyMax` reserves the 1% from `msg.value` BEFORE swapping, so its fee is exactly
    /// 1% of what was sent. Same hole, other door: the hook's own swap never reaches the
    /// callbacks, so this charge is the only one there is.
    function test_ATTACK_buyMaxIsNotAFreeFeeBypass() public {
        uint256 sent = 0.0002 ether;
        uint256 snap = vm.snapshotState();

        // Path A: buyMax.
        (uint256[] memory ids, uint256 spent) = _buyMax(attacker, sent);
        uint256 maxFee = _feeAssets();
        uint256 minted = ids.length;
        uint256 leftover = shard.balanceOf(attacker);
        assertGt(minted, 0, "sanity: buyMax minted nothing");
        assertEq(spent, sent, "sanity: buyMax did not consume the whole msg.value");

        vm.revertToState(snap);

        // Path B: the same ETH through a third-party exact-input swap (charged by
        // `_beforeSwap`), then redeem the whole shards.
        vm.startPrank(carol);
        router.swap{ value: sent }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(sent), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        uint256 swapFee = _feeAssets();
        uint256 bought = shard.balanceOf(carol);
        shard.approve(address(hook), type(uint256).max);
        for (uint256 i = 0; i < bought / ONE_SHARD; i++) {
            hook.redeem();
        }
        vm.stopPrank();

        vm.revertToState(snap);

        assertGt(maxFee, 0, "buyMax IS FREE - the explicit 1% charge is gone");
        // Exactly 1% of msg.value, on the exact-input basis. Not 0.990%, not zero.
        assertEq(maxFee, sent * 100 / 10_000, "buyMax fee != exactly 1% of the ETH sent");
        assertEq(maxFee, swapFee, "buyMax charges a DIFFERENT RATE than the callback path");

        // And it did not buy MORE goods for the same money than the fee-paying path.
        assertLe(minted * ONE_SHARD + leftover, bought, "BUYMAX GOT MORE SHARD PER ETH THAN THE TAXED PATH");
    }

    /// Each acquire is a fresh storage write, so an unbounded batch would exceed the
    /// block gas limit — and a caller who could ask for one would brick their own
    /// transaction after the swap had already moved the price. The cap must bind on
    /// BOTH entry points, and must take no ETH when it refuses.
    function test_ATTACK_buyManyCannotExceedBatchCap() public {
        uint256 max = hook.MAX_BATCH();
        uint256 before = attacker.balance;

        uint256[5] memory tooBig = [max + 1, max * 2, 1000, 10_001, type(uint256).max];
        for (uint256 i = 0; i < tooBig.length; i++) {
            vm.prank(attacker);
            vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.BatchTooLarge.selector, tooBig[i], max));
            hook.buyMany{ value: 100 ether }(tooBig[i], FAR, FAR);
        }

        // Zero is the other end of the same guard: a no-op that still charges a fee
        // would be a free donation to the accumulator.
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.BatchTooLarge.selector, 0, max));
        hook.buyMany{ value: 1 ether }(0, FAR, FAR);

        assertEq(attacker.balance, before, "ETH WAS TAKEN FOR AN OVERSIZED BATCH");
        assertEq(nft.circulatingSupply(), 0, "an oversized batch minted something");
        assertEq(hook.accFeePerNFT(), 0, "a refused batch moved the accumulator");
        assertEq(hook.escrowBalance(), 0, "a refused batch escrowed a fee");

        // `buyMax` takes no count at all, so the cap is enforced on the RESULT: sending
        // more ETH than MAX_BATCH costs reverts. It used to clamp and return the surplus
        // as SHARD, which meant 0.01 ETH bought 50 NFTs plus hundreds of loose tokens.
        uint256 attackerEth = attacker.balance;
        uint256 attackerShard = shard.balanceOf(attacker);
        vm.prank(attacker);
        vm.expectRevert();
        hook.buyMax{ value: 0.01 ether }(0, FAR);

        assertEq(attacker.balance, attackerEth, "an oversized buyMax still took ETH");
        assertEq(shard.balanceOf(attacker), attackerShard, "an oversized buyMax still moved SHARD");
        assertEq(nft.circulatingSupply(), 0, "an oversized buyMax still minted");
        _assertBacking("SHARD backing broke on a refused buyMax");

        // The cap is a bound, not a brick: exactly MAX_BATCH must still go through, and
        // buyMax must still work for any amount that lands under it.
        vm.roll(block.number + 1);
        (uint256[] memory atCap,) = _buyMany(alice, max, 100 ether);
        assertEq(atCap.length, max, "a batch of exactly MAX_BATCH was refused");
        _assertBacking("SHARD backing broke on a max-sized batch");

        vm.roll(block.number + 1);
        (uint256[] memory underCap,) = _buyMax(bob, 0.0001 ether);
        assertGt(underCap.length, 0, "buyMax stopped working below the cap");
        assertLe(underCap.length, max, "buyMax minted past the cap");
        assertLt(shard.balanceOf(bob), ONE_SHARD, "leftover should be a fraction of one SHARD");
    }

    /// `buyMax` is the ONLY function that ever moves SHARD OUT of the hook. Every wei of
    /// that leftover is unbacked ERC-20 until someone redeems it, and it must buy an NFT
    /// exactly once — never twice, and never while a copy stays claimable elsewhere.
    function test_ATTACK_buyMaxLeftoverShardsCannotBeDoubleSpent() public {
        uint256 supply = shard.totalSupply();

        (uint256[] memory ids,) = _buyMax(attacker, 0.0001 ether);
        uint256 leftover = shard.balanceOf(attacker);
        assertGt(ids.length, 0, "sanity: nothing minted");
        assertGt(leftover, 0, "sanity: no leftover was returned");
        assertLt(leftover, ONE_SHARD, "leftover should be a fraction of one SHARD");
        _assertBacking("the hook kept SHARD it had already handed out");

        // A fractional balance buys nothing. The price of an NFT is exactly 1 SHARD.
        vm.startPrank(attacker);
        shard.approve(address(hook), type(uint256).max);
        vm.expectRevert();
        hook.redeem();
        vm.stopPrank();

        // Accumulate past one whole SHARD, then spend it ONCE.
        while (shard.balanceOf(attacker) < ONE_SHARD) {
            _buyMax(attacker, 0.0001 ether);
        }
        uint256 heldBefore = shard.balanceOf(attacker);
        uint256 hookBefore = shard.balanceOf(address(hook));
        uint256 circBefore = nft.circulatingSupply();

        vm.prank(attacker);
        hook.redeem();

        assertEq(shard.balanceOf(attacker), heldBefore - ONE_SHARD, "the redeemed SHARD was not actually spent");
        assertEq(shard.balanceOf(address(hook)) - hookBefore, ONE_SHARD, "the hook minted without taking the backing");
        assertEq(nft.circulatingSupply(), circBefore + 1, "redeem minted the wrong number of NFTs");
        _assertBacking("SHARD backing broke after redeeming leftover");

        // The same wei cannot be spent again: what is left is once more a fraction.
        assertLt(shard.balanceOf(attacker), ONE_SHARD, "sanity: still a whole shard left");
        vm.prank(attacker);
        vm.expectRevert();
        hook.redeem();

        // Nor by handing it to an accomplice and both trying. Only one of the two can
        // ever hold it, so only one redemption exists.
        while (shard.balanceOf(attacker) < ONE_SHARD) {
            _buyMax(attacker, 0.0001 ether);
        }
        vm.prank(attacker);
        shard.transfer(bob, ONE_SHARD);

        vm.startPrank(bob);
        shard.approve(address(hook), type(uint256).max);
        hook.redeem();
        vm.stopPrank();

        assertLt(shard.balanceOf(attacker), ONE_SHARD, "the sender kept a copy of the transferred SHARD");
        vm.prank(attacker);
        vm.expectRevert();
        hook.redeem();

        // And every wei of a fixed, unmintable supply is still accounted for: the locked
        // position, the hook's backing, or a wallet.
        uint256 accounted = shard.balanceOf(address(hook)) + shard.balanceOf(address(manager))
            + shard.balanceOf(attacker) + shard.balanceOf(bob) + shard.balanceOf(alice) + shard.balanceOf(carol)
            + shard.balanceOf(address(this)) + shard.balanceOf(address(router));
        assertEq(accounted, supply, "SHARD APPEARED FROM NOWHERE OR WENT MISSING");
        _assertBacking("SHARD backing broke after the double-spend attempts");
    }

    /// Batches are the fattest possible same-block fee snipe: buy 50 NFTs, capture the
    /// block's fees against a 50x weight, dump them. The accrual guard is per token and
    /// keyed on `acquiredBlock`, so it must apply to every id in a batch — including the
    /// ones `buyMax` mints from a single swap.
    function test_ATTACK_batchBuyInSameBlockEarnsNoFees() public {
        // A genuine holder, from an earlier block.
        (uint256 bobId,) = _buy(bob, 5 ether);
        vm.roll(block.number + 1);

        uint256 attackerStart = attacker.balance;
        uint256 accBefore = hook.accFeePerNFT();

        // --- everything below happens in ONE block ---
        (uint256[] memory manyIds,) = _buyMany(attacker, 10, 5 ether);
        (uint256[] memory maxIds,) = _buyMax(attacker, 0.0002 ether);
        assertGt(manyIds.length + maxIds.length, 10, "sanity: the batch snipe bought too little to be a test");

        // Third-party flow, round-tripped so the price ends roughly where it started.
        // This isolates FEE capture from price movement.
        _swapEthIn(carol, UNDER_CAP_ETH); // sized to the 50 SHARD swap cap
        _swapShardIn(carol, shard.balanceOf(carol));
        assertGt(hook.accFeePerNFT(), accBefore, "sanity: no fees accrued during the snipe block");

        // Dump the whole batch inside the same block.
        vm.startPrank(attacker);
        for (uint256 i = 0; i < manyIds.length; i++) {
            hook.sellNFT(manyIds[i], 0, FAR);
        }
        for (uint256 i = 0; i < maxIds.length; i++) {
            hook.sellNFT(maxIds[i], 0, FAR);
        }
        vm.stopPrank();

        uint256[] memory all = new uint256[](manyIds.length + maxIds.length);
        for (uint256 i = 0; i < manyIds.length; i++) {
            all[i] = manyIds[i];
        }
        for (uint256 i = 0; i < maxIds.length; i++) {
            all[manyIds.length + i] = maxIds[i];
        }
        vm.prank(attacker);
        try hook.claim(all) returns (uint256 paid) {
            assertEq(paid, 0, "THE BATCH SNIPER WAS PAID");
        } catch { }
        // --- end of block ---

        assertEq(hook.claimable(attacker), 0, "the batch sniper accrued a claimable balance");
        assertLt(attacker.balance, attackerStart, "THE SAME-BLOCK BATCH FEE SNIPE WAS PROFITABLE");

        // Nor after the fact, in a later block, with no new fees.
        vm.roll(block.number + 1);
        vm.prank(attacker);
        vm.expectRevert(ShardErrorsV1.NothingToClaim.selector);
        hook.claim(all);

        // The whole block's fees belong to the holder who was actually there.
        uint256[] memory bobIds = new uint256[](1);
        bobIds[0] = bobId;
        vm.prank(bob);
        assertGt(hook.claim(bobIds), 0, "the real holder got nothing while a batch snipe ran");
        _assertBacking("SHARD backing broke across the batch snipe");
    }

    /// The full-range position runs to the minimum tick, so the pool can NEVER run out of
    /// SHARD to sell. `_buyExactOutSwap` asserts a full fill and reverts PartialFillNotSupported
    /// if it cannot get one — with this shape that must stay unreachable. Prove it by buying
    /// hard enough to cross the band edge into the thin tail and checking it still fills.
    function test_ATTACK_boundaryCrossingStillFillsCompletely() public {
        uint256 max = hook.MAX_BATCH();

        // Walk to the band edge with third-party swaps. This used to be ONE swap for the whole
        // 9,930 SHARD; the hook now caps a single swap at MAX_BATCH SHARD, so it is ~199 of
        // them. The TOTAL is unchanged — shrinking it would never reach the boundary, which is
        // the only reason this test exists. Walking there through buyMany instead would take
        // ~190 batches of hook-side mints and exhaust the test's gas long before the edge.
        vm.deal(attacker, 200_000 ether);
        _swapShardOutChunked(attacker, 9930 ether);

        // Parked just ABOVE the band edge, so the batch below has to cross it mid-swap.
        (, int24 before,,) = manager.getSlot0(poolId);
        assertGt(before, hook.tickBand(), "setup put the pool past the edge already");

        // THE assertion: a full batch that spans the liquidity step must still fill EXACTLY.
        // `_buyExactOutSwap` reverts PartialFillNotSupported on a short fill, because a
        // partial one would mint NFTs the hook has no SHARD to back.
        vm.prank(attacker);
        uint256[] memory ids = hook.buyMany{ value: 5000 ether }(max, type(uint256).max, FAR);
        assertEq(ids.length, max, "a batch across the boundary did not fill completely");

        (, int24 after_,,) = manager.getSlot0(poolId);
        assertLt(after_, hook.tickBand(), "the batch did not actually cross the band edge");

        _assertBacking("SHARD backing broke across the band boundary");
    }
}
