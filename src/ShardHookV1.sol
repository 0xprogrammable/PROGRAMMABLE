// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { Pool } from "@uniswap/v4-core/src/libraries/Pool.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { SafeCast } from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import { SwapParams, ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IERC20Minimal } from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { ShardFeeDistributorV1 } from "./ShardFeeDistributorV1.sol";
import { ShardTokenV1 } from "./ShardTokenV1.sol";
import { ShardErrorsV1 } from "./ShardErrorsV1.sol";
import { ShardConstantsV1 } from "./ShardConstantsV1.sol";
import { IShardNFTV1 } from "./interfaces/IShardNFTV1.sol";

/// @title ShardHookV1
/// @notice Uniswap v4 hook owning a permanently-locked, single-sided SHARD position.
///
/// @dev ============================ LIQUIDITY IS LOCKED FOREVER ============================
///      THERE IS NO LIQUIDITY WITHDRAWAL PATH IN THIS CONTRACT AND THERE NEVER MAY BE.
///      `poolManager.modifyLiquidity` is called ONLY from `_mintPosition`, and ALWAYS with a
///      POSITIVE `liquidityDelta`. There are two seeded positions and there is no counterpart
///      that ever removes either of them. The invariant is NEVER A NEGATIVE DELTA — not "one
///      call site". A negative `liquidityDelta` anywhere — behind any guard, owner, timelock or
///      emergency path — would break the entire trust model of this protocol. v4 positions key on `msg.sender`, so no
/// external contract can address this position; the only party that could ever remove it is this contract itself, and
/// it
///      deliberately has no code to do so. DO NOT ADD ONE.
///      ======================================================================================
contract ShardHookV1 is BaseHook, ShardFeeDistributorV1, IUnlockCallback, ReentrancyGuard {
    using CurrencyLibrary for Currency;

    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    /// @dev Append only — never reorder (payloads are abi-encoded).
    enum Action {
        SEED_LIQUIDITY,
        SWEEP,
        BUY,
        SELL,
        BUY_EXACT_OUT,
        BUY_EXACT_IN
    }

    /*//////////////////////////////////////////////////////////////
                             IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice The only address permitted to call {initialise}. This gate is what closes the
    ///         window between deployment and seeding.
    address public immutable deployer;

    ShardTokenV1 public immutable shard;

    int24 public immutable tickLower;

    /// @notice Lower edge of the CONCENTRATED band, stacked on top of the full-range position.
    ///         The band spans `[tickBand, tickUpper]`, so AT OR ABOVE this tick both positions
    ///         are active and below it only the full range is. Mind the direction: buying
    ///         pushes the tick DOWN, so "above `tickBand`" is the early, cheap part of the
    ///         collection — the deep region — and the pool thins out as it sells through.
    int24 public immutable tickBand;

    int24 public immutable tickUpper;
    uint160 public immutable startSqrtPriceX96;

    /// @notice The full seed: 10,000 SHARD, one per NFT.
    uint256 public constant SEED_AMOUNT = ShardConstantsV1.MAX_NFTS * ShardConstantsV1.SHARDS_PER_NFT;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The canonical pool. Fixed at construction; ETH is currency0, SHARD is currency1.
    PoolKey public poolKey;

    /// @notice True once {initialise} has run. One-shot.
    bool public initialised;

    /// @notice SHARD left with the hook by `getLiquidityForAmount1` rounding the seed liquidity
    ///         down (~221 wei). Load-bearing: the core invariant is
    ///         `shard.balanceOf(hook) == nft.circulatingSupply() * 1e18 + seedDust`.
    uint256 public seedDust;

    /// @notice The NFT contract. Set post-deployment (a CREATE2 cycle rules out a ctor arg).
    /// @dev Task 13 adds the deployer-gated one-shot `setNFT`.
    IShardNFTV1 public nft;

    /// @notice Liquidity minted into the FULL-RANGE position.
    uint128 public seedLiquidity;

    /// @notice Liquidity minted into the concentrated BAND position.
    uint128 public seedLiquidityBand;

    event Initialised(PoolId indexed poolId, uint128 liquidityFull, uint128 liquidityBand, uint256 seedDust);

    /// @notice Outside ETH paid into the holder fee pool.
    event Donated(address indexed from, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param _deployer The address permitted to call {setNFT} and {initialise}.
    /// @dev  This is an explicit argument, NOT `msg.sender`, and that is load-bearing.
    ///       A hook address must encode its permission flags in its low bits, so it has to
    ///       be CREATE2-deployed at a mined salt — but an EOA cannot execute CREATE2. Under
    ///       `vm.broadcast`, forge rewrites `new ShardHookV1{salt:}` into a call to the
    ///       canonical CREATE2 factory, so `msg.sender` here would be `0x4e59…`, never the
    ///       deployer's wallet, and both gated functions would be PERMANENTLY UNREACHABLE.
    ///       (It works in tests only because a test *contract* can execute CREATE2 itself,
    ///       which is exactly why the bug hid behind a green suite.)
    ///       Unlike the NFT address, the wallet is known before mining, so passing it in
    ///       creates no CREATE2 cycle.
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
    ) BaseHook(_poolManager) ShardFeeDistributorV1(_launcherFeeRecipient, _builderFeeRecipient) {
        if (address(_shard) == address(0)) revert ShardErrorsV1.ZeroAddress();
        if (_deployer == address(0)) revert ShardErrorsV1.ZeroAddress();
        if (_tickLower >= _tickUpper) revert ShardErrorsV1.InvalidTickRange();
        if (_tickLower % ShardConstantsV1.TICK_SPACING != 0) revert ShardErrorsV1.InvalidTickRange();
        if (_tickUpper % ShardConstantsV1.TICK_SPACING != 0) revert ShardErrorsV1.InvalidTickRange();
        if (_tickLower >= _tickBand || _tickBand >= _tickUpper) revert ShardErrorsV1.InvalidTickRange();
        if (_tickBand % ShardConstantsV1.TICK_SPACING != 0) revert ShardErrorsV1.InvalidTickRange();

        deployer = _deployer;
        shard = _shard;
        tickLower = _tickLower;
        tickBand = _tickBand;
        tickUpper = _tickUpper;
        startSqrtPriceX96 = _startSqrtPriceX96;

        poolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO, // native ETH always sorts first
            currency1: Currency.wrap(address(_shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: ShardConstantsV1.TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    /// @dev The hook must be able to hold native ETH (swap proceeds and fee claims).
    receive() external payable { }

    /*//////////////////////////////////////////////////////////////
                            HOOK PERMISSIONS
    //////////////////////////////////////////////////////////////*/

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /*//////////////////////////////////////////////////////////////
                            BEFORE INITIALIZE
    //////////////////////////////////////////////////////////////*/

    /// @dev Validates the KEY *and* the PRICE. A stored-poolId guard cannot work here:
    ///      `beforeInitialize` carries `noSelfCall` (Hooks.sol:171) so it never fires for this
    ///      hook's own {initialise}, and before that a stored id is zero so any pool would pass.
    ///      It ALWAYS fires for a front-runner though — which is exactly the leverage needed.
    function _beforeInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96)
        internal
        view
        override
        returns (bytes4)
    {
        if (Currency.unwrap(key.currency0) != address(0)) revert ShardErrorsV1.WrongPool();
        if (Currency.unwrap(key.currency1) != address(shard)) revert ShardErrorsV1.WrongPool();
        if (key.fee != ShardConstantsV1.POOL_FEE) revert ShardErrorsV1.WrongPool();
        if (key.tickSpacing != ShardConstantsV1.TICK_SPACING) revert ShardErrorsV1.WrongPool();
        // Without this, a front-runner initialises the canonical pool at ANY price:
        // below tickUpper the seed would demand ETH the hook doesn't have (permanent
        // grief); far above it, the first buyer collapses the price for free.
        if (sqrtPriceX96 != startSqrtPriceX96) {
            revert ShardErrorsV1.WrongStartPrice(startSqrtPriceX96, sqrtPriceX96);
        }
        return BaseHook.beforeInitialize.selector;
    }

    /*//////////////////////////////////////////////////////////////
                              INITIALISE
    //////////////////////////////////////////////////////////////*/

    /// @notice Initialises the canonical pool and locks all 10,000 SHARD into a single-sided
    ///         position for ever. Deployer-gated, one-shot, front-run tolerant, spends no ETH.
    function initialise() external returns (uint128 liquidity) {
        if (msg.sender != deployer) revert ShardErrorsV1.NotDeployer();
        if (initialised) revert ShardErrorsV1.AlreadyInitialised();

        uint256 balance = shard.balanceOf(address(this));
        if (balance != SEED_AMOUNT) revert ShardErrorsV1.WrongShardBalance(SEED_AMOUNT, balance);

        // The whole range must sit at or below the current tick, otherwise the position is
        // partly priced in ETH and the seed would demand ETH the hook does not have.
        if (TickMath.getTickAtSqrtPrice(startSqrtPriceX96) < tickUpper) {
            revert ShardErrorsV1.InvalidStartPrice();
        }

        initialised = true;

        try poolManager.initialize(poolKey, startSqrtPriceX96) returns (int24) { }
        catch (bytes memory reason) {
            // Narrow catch. A blanket `catch {}` would swallow a genuine config error and then
            // seed into a pool that does not exist.
            if (bytes4(reason) != Pool.PoolAlreadyInitialized.selector) {
                assembly ("memory-safe") {
                    revert(add(reason, 0x20), mload(reason))
                }
            }
            // Safe to continue: `_beforeInitialize` guarantees any pre-existing pool is the
            // canonical one at the canonical price.
        }

        (uint128 liquidityFull, uint128 liquidityBand) =
            abi.decode(poolManager.unlock(abi.encode(Action.SEED_LIQUIDITY, SEED_AMOUNT)), (uint128, uint128));
        seedLiquidity = liquidityFull;
        seedLiquidityBand = liquidityBand;
        liquidity = liquidityFull;

        // `getLiquidityForAmount1` rounds down ONCE PER POSITION, so a little SHARD never made
        // it in. Record it — the core supply invariant is stated relative to this.
        seedDust = shard.balanceOf(address(this));

        emit Initialised(poolKey.toId(), liquidityFull, liquidityBand, seedDust);
    }

    /*//////////////////////////////////////////////////////////////
                           UNLOCK CALLBACK
    //////////////////////////////////////////////////////////////*/

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert ShardErrorsV1.NotPoolManager();

        Action action = abi.decode(rawData[:32], (Action));

        if (action == Action.SEED_LIQUIDITY) {
            (, uint256 amount1) = abi.decode(rawData, (Action, uint256));
            return _seedLiquidity(amount1);
        }
        if (action == Action.SWEEP) {
            (, uint256 amount) = abi.decode(rawData, (Action, uint256));
            return _sweep(amount);
        }
        if (action == Action.BUY) {
            (, uint256 maxSpend) = abi.decode(rawData, (Action, uint256));
            return _buySwap(maxSpend);
        }
        if (action == Action.BUY_EXACT_OUT) {
            (, uint256 shardsOut, uint256 maxSpend) = abi.decode(rawData, (Action, uint256, uint256));
            return _buyExactOutSwap(shardsOut, maxSpend);
        }
        if (action == Action.BUY_EXACT_IN) {
            (, uint256 ethIn) = abi.decode(rawData, (Action, uint256));
            return _buyExactInSwap(ethIn);
        }
        // Action.SELL — `shardsIn` is 1e18 for a single sale and count * 1e18 for a batch.
        (, uint256 shardsIn) = abi.decode(rawData, (Action, uint256));
        return _sellSwap(shardsIn);
    }

    /// @dev Seeds BOTH positions. They overlap: the band sits inside the full range, so at or
    ///      above `tickBand` the pool's active liquidity is the sum of the two and below it only
    ///      the full-range position remains. That step is the whole shape of the curve.
    function _seedLiquidity(uint256) internal returns (bytes memory) {
        uint128 liquidityFull = _mintPosition(tickLower, tickUpper, ShardConstantsV1.SEED_FULL_RANGE);
        uint128 liquidityBand = _mintPosition(tickBand, tickUpper, ShardConstantsV1.SEED_BAND);
        return abi.encode(liquidityFull, liquidityBand);
    }

    /// @dev The ONLY `modifyLiquidity` call site in this contract. `liquidityDelta` is POSITIVE
    ///      and there is no counterpart that ever removes. See the contract-level notice.
    ///
    ///      Both positions use salt 0: v4 keys a position on (owner, tickLower, tickUpper, salt)
    ///      and the tick ranges differ, so these are two distinct positions.
    function _mintPosition(int24 lower, int24 upper, uint256 amount1) private returns (uint128 liquidity) {
        // Single-sided currency1 liquidity: the whole range sits at/below the current tick, so
        // the position is priced entirely in currency1 and needs zero currency0.
        liquidity = LiquidityAmounts.getLiquidityForAmount1(
            TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), amount1
        );

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower: lower,
                tickUpper: upper,
                liquidityDelta: int256(uint256(liquidity)), // POSITIVE — always, forever
                salt: bytes32(0)
            }),
            ""
        );

        // delta0 must be zero — no ETH is owed. delta1 is the SHARD debt.
        if (delta.amount0() != 0) revert ShardErrorsV1.InvalidStartPrice();
        _settleCurrency(poolKey.currency1, uint256(uint128(-delta.amount1())));
    }

    /*//////////////////////////////////////////////////////////////
                             CLAIM SWEEP
    //////////////////////////////////////////////////////////////*/

    /// @dev Redeems ERC-6909 ETH claims into real ETH so _claim has funds.
    ///      Idempotent; safe to call anytime.
    function _sweepClaims() internal {
        uint256 bal = poolManager.balanceOf(address(this), CurrencyLibrary.ADDRESS_ZERO.toId());
        if (bal != 0) poolManager.unlock(abi.encode(Action.SWEEP, bal));
    }

    function _sweep(uint256 amount) internal returns (bytes memory) {
        Currency native = CurrencyLibrary.ADDRESS_ZERO;
        // burn creates a POSITIVE delta (a credit) which can then be taken as real ETH.
        poolManager.burn(address(this), native.toId(), amount);
        poolManager.take(native, address(this), amount);
        return "";
    }

    /*//////////////////////////////////////////////////////////////
                          SETTLEMENT HELPERS
    //////////////////////////////////////////////////////////////*/

    function _settleCurrency(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        if (currency.isAddressZero()) {
            // native: no sync required, the value is carried by the call
            poolManager.settle{ value: amount }();
        } else {
            poolManager.sync(currency);
            if (!IERC20Minimal(Currency.unwrap(currency)).transfer(address(poolManager), amount)) {
                revert ShardErrorsV1.TokenTransferFailed();
            }
            poolManager.settle();
        }
    }

    /*//////////////////////////////////////////////////////////////
                             FEE ACCOUNTING
    //////////////////////////////////////////////////////////////*/

    /// @notice Settles the outgoing holder's accrued fees before ownership moves.
    function settleOnTransfer(uint256 tokenId, address from, address) external override {
        if (msg.sender != address(nft)) revert ShardErrorsV1.NotNFT();
        _flushPending();
        _settle(tokenId, from);
    }

    /*//////////////////////////////////////////////////////////////
                                 SWAP
    //////////////////////////////////////////////////////////////*/

    // Task 12: _beforeSwap / _afterSwap third-party fee capture

    /// @dev ===================== THIS PATH IS FOR THIRD PARTIES ONLY =====================
    ///      v4 SKIPS hook callbacks when the hook is itself the swapper (Hooks.sol:253 and
    ///      :293 return early on `msg.sender == address(self)`). So {buyNFT} and {sellNFT},
    ///      which swap via `poolManager.unlock()`, never reach here — they charge the 1%
    ///      explicitly in their own bodies. The two paths are mutually exclusive by
    ///      construction, so nothing is ever double-charged and nothing is ever free.
    ///      ==============================================================================
    ///
    ///      The fee is ALWAYS 1% of the total ETH the swap moves, and is ALWAYS inclusive.
    ///      ETH is currency0, so it is the "specified" currency exactly when
    ///      `zeroForOne == exactIn` — the same rule v4 itself uses. Which side it lands on
    ///      decides which callback charges it:
    ///
    ///        zeroForOne  | kind     | ETH is       | charged in
    ///        ------------|----------|--------------|------------
    ///        true        | exactIn  | specified    | beforeSwap
    ///        true        | exactOut | unspecified  | afterSwap
    ///        false       | exactIn  | unspecified  | afterSwap
    ///        false       | exactOut | specified    | beforeSwap
    ///
    ///      The rate differs by exactness, not by direction. For exactIn the known amount is
    ///      already the total that moves, so the fee is 1% of it. For exactOut the known
    ///      amount is the NET the user receives (or the pool must find), so the total is
    ///      `net + fee` and the fee is `net * 100 / 9900` — solving `fee = 1% * (net + fee)`.
    ///      Charging `net * 100 / 10000` there would be 0.990%, quietly cheaper.
    /// @dev Carried fee numerators so the 1% fee is cumulative and transaction-frequency invariant:
    ///      a stream of tiny swaps accrues the same total fee as one aggregated swap instead of each
    ///      swap flooring its sub-wei share to zero. Two accumulators because exact-input fees divide
    ///      by BPS_DENOMINATOR and exact-output fees by (BPS_DENOMINATOR - FEE_BPS).
    uint256 internal feeCarryIn;
    uint256 internal feeCarryOut;
    /// @dev The fee {_beforeSwap} charged, handed to {_afterSwap} so it reconstructs the exact
    ///      requested swap size without recomputing (which would double-consume the carry). Written
    ///      by {_beforeSwap} immediately before {_afterSwap} reads it within the same swap, so it is
    ///      pure scratch — any value left between swaps is always overwritten before the next read.
    uint256 private pendingBeforeSwapFee;

    /// @dev The actual 1% fee taken on a swap, carrying the sub-wei remainder forward so nothing is
    ///      floored away over a stream of swaps: a run of tiny swaps accrues the same total as one
    ///      aggregated swap. `exactIn` selects the inclusive basis (fee is 1% of the total moved,
    ///      divide by BPS_DENOMINATOR) versus the exact-output gross-up (fee is net*100/9900).
    function _chargeFee(uint256 gross, bool exactIn) internal returns (uint256 fee) {
        uint256 denom =
            exactIn ? ShardConstantsV1.BPS_DENOMINATOR : ShardConstantsV1.BPS_DENOMINATOR - ShardConstantsV1.FEE_BPS;
        uint256 num = gross * ShardConstantsV1.FEE_BPS + (exactIn ? feeCarryIn : feeCarryOut);
        fee = num / denom;
        uint256 rem = num % denom;
        if (exactIn) feeCarryIn = rem;
        else feeCarryOut = rem;
    }

    /// @dev Takes the ETH fee as an ERC-6909 claim rather than `poolManager.take`.
    ///      `take` moves REAL ETH out of the PoolManager before the swapper has settled, so on
    ///      a manager holding no other native liquidity the very first swap reverts. Minting a
    ///      claim balances the hook's delta identically without touching real balances; the
    ///      claims are redeemed to ETH by {_sweepClaims}, which {claim} runs first.
    function _takeEthFee(uint256 fee) private {
        poolManager.mint(address(this), CurrencyLibrary.ADDRESS_ZERO.toId(), fee);
        _distributeFee(fee);
    }

    function _guardPool(PoolKey calldata key) private view {
        // Blocks a front-runner who initialised the canonical pool from swapping the price
        // away before the hook seeds it.
        if (!initialised) revert ShardErrorsV1.NotInitialised();
        // Without this a foreign pool routes a fee in the WRONG CURRENCY into _distribute,
        // inflating accFeePerNFT against ETH the hook does not hold and permanently bricking
        // _claim for real holders.
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(poolKey.toId())) {
            revert ShardErrorsV1.WrongPool();
        }
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        virtual
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _guardPool(key);

        bool exactIn = params.amountSpecified < 0;
        // ETH (currency0) is the specified currency exactly when zeroForOne == exactIn.
        if (params.zeroForOne != exactIn) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 specified = exactIn ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint256 fee = _chargeFee(specified, exactIn);
        // Hand the exact charged fee to _afterSwap so its partial-fill check reconstructs the
        // requested size without recomputing (which would double-consume the carry). Recorded even
        // when zero, so a later swap in the same transaction never reads a stale value.
        pendingBeforeSwapFee = fee;
        if (fee == 0) return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        _takeEthFee(fee);

        // POSITIVE specified delta == the hook is owed, which exactly cancels the mint above.
        // v4 folds it into amountToSwap: exactIn -100 becomes -99 (pool swaps 99, hook keeps 1);
        // exactOut +100 becomes +101 (pool releases 101, user gets 100, hook keeps 1).
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(SafeCast.toInt128(int256(fee)), int128(0)), 0);
    }

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        virtual
        override
        returns (bytes4, int128)
    {
        _guardPool(key);

        // ================== ONE SWAP MAY MOVE AT MOST MAX_BATCH SHARD ==================
        // {buyMany}, {buyMax}, {sellMany} and {redeemMany} have always capped a single action
        // at MAX_BATCH NFTs. That cap was decorative while anyone could bypass it by swapping
        // SHARD directly — through {ShardSwapRouterV1}, through Uniswap's own interface, or
        // through any aggregator — and then calling {redeemMany}. Capping the SWAP makes the
        // limit a property of the pool rather than of which front end was used.
        //
        // Measured on the SHARD leg, which is why ONE check covers all four
        // direction x exactness quadrants: the fee is always taken on the ETH leg, so
        // `delta.amount1()` is exactly the SHARD that moved no matter which side was
        // specified. Exact-input buys in particular cannot be checked any earlier — they
        // specify ETH, and the SHARD they buy is not known until the pool has run.
        //
        // Symmetric by decision: capping only buys would let a position be unwound in one go
        // through the other direction. The accepted cost is that exiting a large position
        // takes several transactions.
        //
        // This runs only for THIRD-PARTY swaps. v4 skips hook callbacks when the hook is the
        // swapper (Hooks.sol:253/:293), so {buyNFT} and friends never reach here — their own
        // MAX_BATCH checks are what bound them, and this cap does not double-bind them.
        // Widened to int256 BEFORE negating. `-x` on `type(int128).min` overflows and
        // reverts in 0.8, so taking the absolute value in int128 would brick the swap at
        // that one input. Unreachable here — the pool can never hold more than the 10,000
        // SHARD supply, twenty orders of magnitude below that bound — but the widening is
        // free and does not depend on the supply staying where it is.
        int256 shardDelta = int256(delta.amount1());
        uint256 shardMoved = uint256(shardDelta < 0 ? -shardDelta : shardDelta);
        uint256 maxShard = MAX_BATCH * ShardConstantsV1.SHARDS_PER_NFT;
        if (shardMoved > maxShard) revert ShardErrorsV1.SwapTooLarge(shardMoved, maxShard);
        // ==============================================================================

        bool exactIn = params.amountSpecified < 0;

        // ETH was the SPECIFIED currency, so beforeSwap already charged the fee — before
        // execution, and therefore on the REQUESTED size. If the swap then stopped at its
        // price limit and only partially filled, that fee is a far larger share of what
        // actually executed: measured at 7,655 bps (76.5%) on a 1 ETH request that filled
        // 0.013 ETH. The fee cannot be corrected here, because afterSwap's return value
        // adjusts only the UNSPECIFIED currency and the fee must stay denominated in ETH.
        // So reject the swap instead of overcharging it. Swaps whose limit never binds —
        // ordinary slippage protection, which is most routing — are unaffected.
        //
        // Measured off the DELTA, not off the resulting price. Comparing `sqrtPriceNow` to
        // the limit cannot tell a partial fill from a complete one that happens to land
        // exactly ON the limit, and would reject the latter. `delta` here is the raw pool
        // delta for the post-beforeSwap size, so the two are directly comparable: v4 leaves
        // the specified amount unfilled ONLY when the limit binds.
        if (params.zeroForOne == exactIn) {
            uint256 specified = exactIn ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            // What beforeSwap actually handed the pool, after taking its cut out of the specified
            // side: exactIn swaps less, exactOut asks for more. Read the exact fee beforeSwap charged
            // (via transient storage) rather than recomputing, since the carry has since moved on.
            uint256 hookFee = pendingBeforeSwapFee;
            uint256 requested = exactIn ? specified - hookFee : specified + hookFee;

            int128 ethDelta = delta.amount0();
            uint256 filled = ethDelta < 0 ? uint256(uint128(-ethDelta)) : uint256(uint128(ethDelta));
            if (filled != requested) revert ShardErrorsV1.PartialFillNotSupported();
            return (BaseHook.afterSwap.selector, int128(0));
        }

        // ETH is unspecified, so its amount is whatever the pool computed: delta.amount0().
        int128 eth0 = delta.amount0();
        uint256 gross = eth0 < 0 ? uint256(uint128(-eth0)) : uint256(uint128(eth0));
        uint256 fee = _chargeFee(gross, exactIn);
        if (fee == 0) return (BaseHook.afterSwap.selector, int128(0));

        _takeEthFee(fee);

        // Applies to the UNSPECIFIED currency; positive again means the hook is owed.
        return (BaseHook.afterSwap.selector, SafeCast.toInt128(int256(fee)));
    }

    // Task 13: buyNFT / sellNFT / redeem / claim + explicit fee on hook-initiated swaps

    /*//////////////////////////////////////////////////////////////
                                MARKET
    //////////////////////////////////////////////////////////////*/

    /// @dev ================== WHY THE FEE IS CHARGED TWICE OVER ==================
    ///      v4 skips hook callbacks when the hook is the swapper (Hooks.sol:253/:293).
    ///      {buyNFT} and {sellNFT} swap via `poolManager.unlock()`, so their swaps NEVER
    ///      reach {_beforeSwap}/{_afterSwap} — they must charge the 1% themselves, right
    ///      here. Third-party router swaps take the callback path instead. The two are
    ///      mutually exclusive, so nothing is double-charged and nothing is free.
    ///      Deleting either half silently guts the economics while tests stay green.
    ///      =========================================================================

    /// @notice ETH in, one NFT out. Excess ETH is refunded.
    /// @param maxEthIn Largest total (curve cost + 1% fee) you will accept. Sandwich bound.
    /// @param deadline Unix timestamp after which this reverts.
    function buyNFT(uint256 maxEthIn, uint256 deadline) external payable nonReentrant returns (uint256 tokenId) {
        if (block.timestamp > deadline) revert ShardErrorsV1.Expired();
        if (!initialised || address(nft) == address(0)) revert ShardErrorsV1.NotInitialised();

        // ETH already held on behalf of fee claimants. A buy must never dip into it.
        uint256 holderEth = address(this).balance - msg.value;

        uint256 ethSpent = abi.decode(poolManager.unlock(abi.encode(Action.BUY, msg.value)), (uint256));

        (uint256 fee, uint256 total) = _chargeBuy(ethSpent, maxEthIn);

        tokenId = nft.acquire(msg.sender, _nextSeed(msg.sender));
        _acquireAccounting(tokenId, msg.sender);

        // Refund AFTER unlock has returned — forwarding inside the callback would make a
        // contract buyer's re-entry hit AlreadyUnlocked and self-DoS.
        _sendEth(msg.sender, msg.value - total);

        _verifyFeeHeld(holderEth, fee);
    }

    /// @notice The largest number of NFTs one transaction may mint. Each acquire is a fresh
    ///         storage write, so an unbounded batch would exceed the block gas limit.
    uint256 public constant MAX_BATCH = 50;

    /// @notice ETH in, `count` NFTs out, in ONE swap. Excess ETH is refunded.
    /// @dev v4 skips this hook's own beforeSwap/afterSwap (Hooks.sol:253/:293) because the
    ///      hook is the swapper, so the 1% is charged EXPLICITLY here. Removing it makes
    ///      bulk buying free while every test stays green.
    function buyMany(uint256 count, uint256 maxEthIn, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256[] memory tokenIds)
    {
        if (block.timestamp > deadline) revert ShardErrorsV1.Expired();
        if (!initialised || address(nft) == address(0)) revert ShardErrorsV1.NotInitialised();
        if (count == 0 || count > MAX_BATCH) revert ShardErrorsV1.BatchTooLarge(count, MAX_BATCH);

        uint256 holderEth = address(this).balance - msg.value;

        uint256 ethSpent = abi.decode(
            poolManager.unlock(abi.encode(Action.BUY_EXACT_OUT, count * ShardConstantsV1.SHARDS_PER_NFT, msg.value)),
            (uint256)
        );

        (uint256 fee, uint256 total) = _chargeBuy(ethSpent, maxEthIn);

        tokenIds = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            uint256 id = nft.acquire(msg.sender, _nextSeed(msg.sender));
            _acquireAccounting(id, msg.sender);
            tokenIds[i] = id;
        }

        _sendEth(msg.sender, msg.value - total); // after unlock returns, never inside it

        _verifyFeeHeld(holderEth, fee);
    }

    /// @notice Spend as much of `msg.value` as the curve takes and mint as many whole NFTs as
    ///         that buys. Any leftover fractional SHARD is transferred to the caller, so no
    ///         value is stranded and the backing invariant stays exact.
    /// @dev Reverts above `MAX_BATCH` rather than clamping, so no path can ever hand out
    ///      more than the cap OR a large SHARD balance in its place. Below the cap the
    ///      leftover is always under one whole SHARD, by construction.
    function buyMax(uint256 minCount, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256[] memory tokenIds)
    {
        if (block.timestamp > deadline) revert ShardErrorsV1.Expired();
        if (!initialised || address(nft) == address(0)) revert ShardErrorsV1.NotInitialised();
        if (msg.value == 0) revert ShardErrorsV1.ZeroAmount();

        uint256 holderEth = address(this).balance - msg.value;

        // Size the swap against the WORST-CASE fee, so the reserve is always sufficient. This is a
        // pure ceiling used only to size the swap; it must NOT consume the carry, so it does not go
        // through {_chargeFee}.
        uint256 maxFee = (msg.value * ShardConstantsV1.FEE_BPS) / ShardConstantsV1.BPS_DENOMINATOR;
        uint256 ethForSwap = msg.value - maxFee;

        (uint256 shardsOut, uint256 ethConsumed) =
            abi.decode(poolManager.unlock(abi.encode(Action.BUY_EXACT_IN, ethForSwap)), (uint256, uint256));

        // Then charge on what the curve ACTUALLY consumed, not on what was sent. An exact-input
        // swap can stop early at the price limit, and billing the reserve in full would charge
        // 1% of the refunded remainder too — 1 ETH of fee on a 1 ETH purchase if 100 ETH was
        // sent into a pool whose limit binds immediately. That is precisely the
        // fee-out-of-proportion-to-what-executed failure {_afterSwap} refuses to inflict on
        // third parties; it must not be inflicted here either.
        //
        // `ethConsumed` is the NET the curve took, so the fee is inclusive on top of it, the
        // same basis {buyNFT} and {buyMany} use. Clamped to `maxFee` because at full
        // consumption the two bases agree only up to rounding: with
        // `msg.value = 100 * maxFee + 99` the inclusive form lands one wei higher, which would
        // overspend `msg.value` by that wei.
        uint256 fee = _chargeFee(ethConsumed, false);
        // The inclusive basis can land above the exact-input reserve at full consumption; clamp so the
        // buyer is never overspent, and return the uncollected wei to the carry so the entitlement is
        // preserved and collected on a later exact-output swap — not shed once per qualifying call.
        if (fee > maxFee) {
            // `fee - maxFee` is an exact whole-wei count and its sub-wei remainder is already held in
            // feeCarryOut, so multiplying by the constant denominator converts those wei back into
            // carry-numerator units with no precision loss. Slither flags this as divide-before-
            // multiply; it is an intentional, exact unit conversion, not a rounding hazard.
            unchecked {
                feeCarryOut += (fee - maxFee) * (ShardConstantsV1.BPS_DENOMINATOR - ShardConstantsV1.FEE_BPS);
            }
            fee = maxFee;
        }

        _distributeFee(fee);

        // Refund whatever neither the curve nor the fee took. Without this the remainder is
        // stranded in the hook permanently — never distributed as a fee, never sweepable, on a
        // contract that cannot be upgraded.
        uint256 unspent = msg.value - ethConsumed - fee;

        uint256 count = shardsOut / ShardConstantsV1.SHARDS_PER_NFT;
        // HARD cap, not a silent clamp. Clamping used to mint MAX_BATCH and hand the
        // rest back as ERC-20, so 0.01 ETH could return 50 NFTs plus 845 SHARD that
        // the buyer then had to redeem fifty at a time. Somebody asking for art
        // should never be given a pile of tokens instead. Send less and try again.
        if (count > MAX_BATCH) revert ShardErrorsV1.BatchTooLarge(count, MAX_BATCH);
        if (count < minCount) revert ShardErrorsV1.InsufficientOutput(minCount, count);

        tokenIds = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            uint256 id = nft.acquire(msg.sender, _nextSeed(msg.sender));
            _acquireAccounting(id, msg.sender);
            tokenIds[i] = id;
        }

        // Whatever did not become a whole NFT goes to the caller as ERC-20. Keeping it would
        // break `shard.balanceOf(hook) == circulatingSupply * 1e18 + seedDust`.
        uint256 leftover = shardsOut - count * ShardConstantsV1.SHARDS_PER_NFT;
        if (leftover != 0 && !shard.transfer(msg.sender, leftover)) revert ShardErrorsV1.TokenTransferFailed();

        _sendEth(msg.sender, unspent); // after unlock returns, never inside it

        _verifyFeeHeld(holderEth, fee);
    }

    /// @notice One NFT in, ETH out. The artwork is destroyed.
    /// @param minEthOut Smallest payout you will accept, after the 1% fee. Sandwich bound.
    function sellNFT(uint256 tokenId, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 payout)
    {
        if (block.timestamp > deadline) revert ShardErrorsV1.Expired();
        if (!initialised || address(nft) == address(0)) revert ShardErrorsV1.NotInitialised();

        // Ordering is economically meaningful and must stay this way: settle the seller out
        // of the earning set BEFORE the exit fee is distributed, so they do not earn from
        // their own fee — and if this was the last NFT, the fee correctly escrows.
        //
        // _releaseAccounting trusts its caller. `nft.release` is what enforces ownership:
        // OZ's _transfer reverts ERC721IncorrectOwner if msg.sender is not the holder, which
        // rolls back the accounting above. That check is load-bearing, not incidental.
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = tokenId;
        payout = _sellBatch(tokenIds, minEthOut);
    }

    /// @notice Several NFTs in, ETH out, in ONE swap. Every artwork is destroyed.
    /// @param tokenIds The ids to sell. Must all be held by the caller; duplicates revert.
    /// @param minEthOut Smallest TOTAL payout you will accept, after the 1% fee.
    /// @dev v4 skips this hook's own beforeSwap/afterSwap (Hooks.sol:253/:293) because the
    ///      hook is the swapper, so the 1% is charged EXPLICITLY here — the sell-side twin of
    ///      the {buyMany} note. Removing it makes bulk exits free while every test stays green.
    function sellMany(uint256[] calldata tokenIds, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 payout)
    {
        if (block.timestamp > deadline) revert ShardErrorsV1.Expired();
        if (!initialised || address(nft) == address(0)) revert ShardErrorsV1.NotInitialised();

        payout = _sellBatch(tokenIds, minEthOut);
    }

    /// @dev The whole sell side, shared by {sellNFT} and {sellMany}. Callers do the deadline
    ///      and initialisation checks; this does the batch bound, the release loop, the single
    ///      swap and the single fee.
    function _sellBatch(uint256[] memory tokenIds, uint256 minEthOut) private returns (uint256 payout) {
        uint256 count = tokenIds.length;
        if (count == 0 || count > MAX_BATCH) revert ShardErrorsV1.BatchTooLarge(count, MAX_BATCH);

        // Ordering is economically meaningful and must stay this way: settle EVERY seller out
        // of the earning set BEFORE the exit fee is distributed, so they do not earn from
        // their own fee — and if these were the last NFTs, the fee correctly escrows. That is
        // why the whole loop runs before `_distribute` below, not once per id.
        //
        // _releaseAccounting trusts its caller. `nft.release` is what enforces ownership:
        // OZ's _transfer reverts ERC721IncorrectOwner if msg.sender is not the holder, which
        // rolls back the accounting above. That check is load-bearing, not incidental — and
        // it is also what rejects a duplicated id, whose second copy the archive now owns.
        for (uint256 i; i < count; ++i) {
            _releaseAccounting(tokenIds[i], msg.sender);
            nft.release(msg.sender, tokenIds[i]);
        }

        uint256 ethOut =
            abi.decode(poolManager.unlock(abi.encode(Action.SELL, count * ShardConstantsV1.SHARDS_PER_NFT)), (uint256));

        // Inclusive: the pool released `ethOut` in total, so the fee is 1% of that.
        uint256 fee = _chargeFee(ethOut, true);
        payout = ethOut - fee;
        if (payout < minEthOut) revert ShardErrorsV1.SlippageExceeded(minEthOut, payout);

        _distributeFee(fee);
        _sendEth(msg.sender, payout); // after unlock, as above
    }

    /// @notice 1.0 SHARD in, one NFT out. No extra fee — that shard already paid 1% when it
    ///         was swapped. There is deliberately NO reverse path (NFT to SHARD): the
    ///         asymmetry is what makes a free art reroll impossible.
    function redeem() external nonReentrant returns (uint256 tokenId) {
        if (!initialised || address(nft) == address(0)) revert ShardErrorsV1.NotInitialised();

        tokenId = _redeemBatch(1)[0];
    }

    /// @notice `count` SHARD in, `count` NFTs out. Still no extra fee, for the same reason.
    /// @dev The arrival path for anyone who bought SHARD on a third-party router: those shards
    ///      paid their 1% in {_beforeSwap}/{_afterSwap} on the way out, so charging again here
    ///      would make swap-then-redeem strictly worse than {buyMany}.
    function redeemMany(uint256 count) external nonReentrant returns (uint256[] memory tokenIds) {
        if (!initialised || address(nft) == address(0)) revert ShardErrorsV1.NotInitialised();

        tokenIds = _redeemBatch(count);
    }

    /// @dev Shared by {redeem} and {redeemMany}. One `transferFrom` for the whole batch, so a
    ///      caller needs a single allowance covering `count * 1e18`.
    function _redeemBatch(uint256 count) private returns (uint256[] memory tokenIds) {
        if (count == 0 || count > MAX_BATCH) revert ShardErrorsV1.BatchTooLarge(count, MAX_BATCH);

        if (!shard.transferFrom(msg.sender, address(this), count * ShardConstantsV1.SHARDS_PER_NFT)) {
            revert ShardErrorsV1.TokenTransferFailed();
        }

        tokenIds = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            uint256 id = nft.acquire(msg.sender, _nextSeed(msg.sender));
            _acquireAccounting(id, msg.sender);
            tokenIds[i] = id;
        }
    }

    /// @notice Pay ETH into the fee pool, to be shared out to NFT holders.
    ///
    /// @dev The entry point for outside revenue: a launchpad, a royalty router, or
    ///      anything else that wants to pay this collection's holders. Permissionless
    ///      on purpose, because the only thing a caller can do is give away ETH.
    ///
    ///      Use this rather than sending ETH to the contract directly. `receive` has
    ///      to stay silent, because v4's `take` delivers native ETH that way during
    ///      every swap, so a plain transfer lands in the balance and is NEVER
    ///      distributed, never claimable, and unrecoverable on a contract that cannot
    ///      be upgraded. {ShardFeeForwarderV1} exists for senders that can only transfer.
    ///
    ///      Distribution is exactly the one used for trading fees, so a donation
    ///      escrows when nothing is circulating and is released to the first buyer.
    function donate() external payable nonReentrant {
        if (msg.value == 0) revert ShardErrorsV1.ZeroAmount();
        _distribute(msg.value);
        emit Donated(msg.sender, msg.value);
    }

    /// @notice Settle the given tokens and withdraw everything owed to the caller.
    /// @param tokenIds Tokens to settle first. Pass the ones you hold. May be empty, which
    ///        withdraws only what is ALREADY settled (a transfer or sale settles for you).
    ///
    /// @dev Why this takes an argument at all: fees accrue into `accFeePerNFT`, but a
    ///      holder's `claimable` balance is only materialised by {_settle}, which fires on
    ///      transfer and on sale. Someone who merely HOLDS has accrued value that has never
    ///      been written to their balance — so a no-argument claim would revert
    ///      NothingToClaim while they were genuinely owed money. The hook does not track
    ///      which ids an address holds (that would cost gas on every transfer), so the
    ///      caller supplies them.
    ///
    ///      Settlement is deliberately permissionless: each token settles to
    ///      `nft.ownerOf(id)`, its rightful owner, never to the caller. So passing someone
    ///      else's id is harmless — it credits them, and only the caller's own balance is
    ///      ever paid out.
    ///
    ///      NOTE: this is NOT a keeper hook. If the caller ends up owed nothing, `_claim`
    ///      reverts `NothingToClaim` and the whole transaction — including the settlement
    ///      above — rolls back. Settling on someone else's behalf therefore only persists
    ///      when the caller is also claiming something of their own. Holders must settle
    ///      their own tokens.
    function claim(uint256[] calldata tokenIds) external nonReentrant returns (uint256) {
        // Third-party fees arrive as ERC-6909 claims; realise them before paying out or
        // _claim's transfer reverts once claims exceed whatever real ETH happens to be held.
        _sweepClaims();
        _flushPending();

        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 id = tokenIds[i];
            address owner = IERC721(address(nft)).ownerOf(id);
            // Pool-held ids earn nothing; settling one would credit the archive, which has
            // no way to claim and would strand the ETH permanently.
            if (owner != address(nft)) _settle(id, owner);
        }

        return _claim(msg.sender);
    }

    /// @notice Pays out the builder's accrued 0.10% share. Beneficiary-only.
    function claimBuilderFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != builderFeeRecipient) revert ShardErrorsV1.NotBuilder();
        _sweepClaims();
        amount = builderFeesAccrued;
        if (amount == 0) revert ShardErrorsV1.NothingToClaim();
        builderFeesAccrued = 0; // effects before interaction
        _sendEth(msg.sender, amount);
        emit BuilderFeesClaimed(msg.sender, amount);
    }

    /// @notice Pays out Programmable's accrued 0.10% share. Beneficiary-only.
    function claimLauncherFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) revert ShardErrorsV1.NotLauncher();
        _sweepClaims();
        amount = launcherFeesAccrued;
        if (amount == 0) revert ShardErrorsV1.NothingToClaim();
        launcherFeesAccrued = 0; // effects before interaction
        _sendEth(msg.sender, amount);
        emit LauncherFeesClaimed(msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                             MARKET SWAPS
    //////////////////////////////////////////////////////////////*/

    function _buySwap(uint256 maxSpend) internal returns (bytes memory) {
        BalanceDelta delta = poolManager.swap(
            poolKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: int256(ShardConstantsV1.SHARDS_PER_NFT), // exact output: 1 SHARD
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        uint256 ethOwed = uint256(uint128(-delta.amount0()));
        if (ethOwed > maxSpend) revert ShardErrorsV1.InsufficientPayment(ethOwed, maxSpend);

        // {buyNFT} mints one NFT on the strength of this swap, so a partial fill would mint an
        // NFT the hook has no SHARD to back — breaking
        // `balanceOf(hook) == circulatingSupply * 1e18 + seedDust` on a contract that cannot be
        // upgraded. The twin of the guards in {_sellSwap} and {_buyExactOutSwap}: unreachable at
        // the shipped tick range, asserted anyway so the identity belongs to THIS contract
        // rather than to whatever ticks the deployment happened to pass.
        uint256 shardsIn = uint256(uint128(delta.amount1()));
        if (shardsIn != ShardConstantsV1.SHARDS_PER_NFT) revert ShardErrorsV1.PartialFillNotSupported();

        _settleCurrency(poolKey.currency0, ethOwed);
        poolManager.take(poolKey.currency1, address(this), shardsIn);

        return abi.encode(ethOwed);
    }

    function _sellSwap(uint256 shardsIn) internal returns (bytes memory) {
        BalanceDelta delta = poolManager.swap(
            poolKey,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(shardsIn), // exact input: the whole batch at once
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        // The caller has already released `shardsIn / 1e18` NFTs on the strength of this swap,
        // so a partial fill would leave the hook holding shards for NFTs no longer in
        // circulation — breaking `balanceOf(hook) == circulatingSupply * 1e18 + seedDust` on a
        // contract that cannot be upgraded. Unreachable at the shipped tick range; asserted
        // anyway so the identity belongs to THIS contract, not to the deployment's ticks.
        uint256 shardsSpent = uint256(uint128(-delta.amount1()));
        if (shardsSpent != shardsIn) revert ShardErrorsV1.PartialFillNotSupported();

        _settleCurrency(poolKey.currency1, shardsSpent);

        uint256 ethOut = uint256(uint128(delta.amount0()));
        poolManager.take(poolKey.currency0, address(this), ethOut);

        return abi.encode(ethOut);
    }

    /// @dev Exact-output: buy exactly `shardsOut` SHARD, spending at most `maxSpend` ETH.
    function _buyExactOutSwap(uint256 shardsOut, uint256 maxSpend) internal returns (bytes memory) {
        BalanceDelta delta = poolManager.swap(
            poolKey,
            SwapParams({
                zeroForOne: true, amountSpecified: int256(shardsOut), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );
        uint256 ethOwed = uint256(uint128(-delta.amount0()));
        if (ethOwed > maxSpend) revert ShardErrorsV1.InsufficientPayment(ethOwed, maxSpend);

        // The caller mints `count` NFTs on the strength of this swap, so a partial fill would
        // mint NFTs the hook has no SHARD to back. Unreachable at the shipped tick range, but
        // the hook is immutable — make the backing identity a property of THIS contract rather
        // than of whatever ticks the deployment happened to pass.
        uint256 shardsIn = uint256(uint128(delta.amount1()));
        if (shardsIn != shardsOut) revert ShardErrorsV1.PartialFillNotSupported();

        _settleCurrency(poolKey.currency0, ethOwed);
        poolManager.take(poolKey.currency1, address(this), shardsIn);
        return abi.encode(ethOwed);
    }

    /// @dev Exact-input: spend exactly `ethIn` ETH, take whatever SHARD it buys.
    function _buyExactInSwap(uint256 ethIn) internal returns (bytes memory) {
        BalanceDelta delta = poolManager.swap(
            poolKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );
        // Report what the pool ACTUALLY consumed. An exact-input swap can stop early at the
        // price limit, and the unconsumed remainder would otherwise sit in the hook forever —
        // never distributed as a fee, never sweepable, on an immutable contract.
        uint256 ethConsumed = uint256(uint128(-delta.amount0()));
        _settleCurrency(poolKey.currency0, ethConsumed);
        uint256 shardsOut = uint256(uint128(delta.amount1()));
        poolManager.take(poolKey.currency1, address(this), shardsOut);
        return abi.encode(shardsOut, ethConsumed);
    }

    /*//////////////////////////////////////////////////////////////
                                 WIRING
    //////////////////////////////////////////////////////////////*/

    /// @notice One-shot, deployer-only. A CREATE2 cycle rules out a constructor argument
    ///         (each address would depend on the other's constructor args), so this gate is
    ///         what closes the window in which an attacker could bind a malicious NFT and
    ///         drain the accumulator via settleOnTransfer across all 10,000 ids.
    function setNFT(IShardNFTV1 nft_) external {
        if (msg.sender != deployer) revert ShardErrorsV1.NotDeployer();
        if (address(nft) != address(0)) revert ShardErrorsV1.AlreadyInitialised();
        if (address(nft_) == address(0)) revert ShardErrorsV1.ZeroAddress();
        bool valid;
        bytes4 selector = IShardNFTV1.hook.selector;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            let ok := staticcall(10000, nft_, ptr, 4, ptr, 32)
            valid := and(and(ok, eq(returndatasize(), 32)), eq(mload(ptr), address()))
        }
        if (!valid) {
            revert ShardErrorsV1.WrongNFT(address(nft_), address(this));
        }
        nft = nft_;
    }

    /*//////////////////////////////////////////////////////////////
                                ENTROPY
    //////////////////////////////////////////////////////////////*/

    /// @dev This is not secure randomness. Block producers and transaction ordering can
    ///      influence art seeds, and callers can observe all inputs before inclusion. No
    ///      security property relies on unpredictability: traits are flat, and a reroll only
    ///      affects the roller's own draw. The nonce and recipient provide per-acquisition
    ///      variation while the previous-block hash and timestamp add Ethereum block context.
    function _nextSeed(address to) private returns (uint256) {
        unchecked {
            _seedNonce++;
        }
        return uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, to, _seedNonce)));
    }

    uint256 private _seedNonce;

    function _sendEth(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{ value: amount }("");
        if (!ok) revert ShardErrorsV1.EthTransferFailed();
    }

    /// @dev Post-condition shared by every buy path: after the refund, the hook must still hold the
    ///      ETH it owes fee claimants (`holderEth` from before the buy plus this buy's `fee`). A buy
    ///      that dipped into claimant ETH would fail here.
    function _verifyFeeHeld(uint256 holderEth, uint256 fee) private view {
        uint256 expected = holderEth + fee;
        if (address(this).balance < expected) revert ShardErrorsV1.FeeEthMissing(expected, address(this).balance);
    }

    /// @dev Shared buy head for {buyNFT} and {buyMany}: charge the inclusive 1% fee (carrying its
    ///      remainder), bound the total against payment and slippage, then distribute the fee.
    ///      `ethSpent` is the NET curve cost, so the fee is 1% of the total — `ethSpent * 100 / 10_000`
    ///      would be 0.990% and quietly cheaper than swap-then-redeem.
    function _chargeBuy(uint256 ethSpent, uint256 maxEthIn) private returns (uint256 fee, uint256 total) {
        fee = _chargeFee(ethSpent, false);
        total = ethSpent + fee;
        if (total > msg.value) revert ShardErrorsV1.InsufficientPayment(total, msg.value);
        if (total > maxEthIn) revert ShardErrorsV1.SlippageExceeded(maxEthIn, total);
        _distributeFee(fee);
    }
}
