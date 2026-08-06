// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IERC20Minimal } from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";

/// @title ShardSwapRouterV1
/// @notice Minimal ETH <-> SHARD router for the SHARDS pool. Holds nothing, owns nothing, and
///         has no privileged access to the hook — swaps through it are ordinary third-party
///         swaps and pay the hook's 1% through its beforeSwap/afterSwap callbacks.
/// @dev Deliberately separate from ShardHookV1: the hook's own swap paths mint and burn NFTs,
///      and its LP position is permanently locked, so its surface is kept minimal.
contract ShardSwapRouterV1 is IUnlockCallback, ReentrancyGuard {
    using CurrencyLibrary for Currency;

    error NotPoolManager();
    error Expired();
    error ZeroAmount();
    error InsufficientOutput(uint256 minOut, uint256 actual);
    error EthTransferFailed();
    error TokenTransferFailed();
    /// @dev The supplied PoolKey is not the pool this router was deployed for.
    error WrongPool();

    IPoolManager public immutable poolManager;

    /// @dev The one pool this router serves, fixed at deployment. Callers still pass a PoolKey
    ///      (v4's swap signature needs the struct), but anything else is rejected. Not currently
    ///      exploitable — payer and recipient are both msg.sender and the router holds nothing —
    ///      but the pool never changes, so pinning it costs nothing and removes the question.
    bytes32 public immutable poolId;

    constructor(IPoolManager _poolManager, PoolKey memory _key) {
        poolManager = _poolManager;
        poolId = keccak256(abi.encode(_key));
    }

    function _requireCanonicalPool(PoolKey calldata key) internal view {
        if (keccak256(abi.encode(key)) != poolId) revert WrongPool();
    }

    /// @dev NO `receive()`, deliberately. This router never legitimately receives a plain ETH
    ///      transfer: it settles native currency INTO the PoolManager, and takes proceeds
    ///      straight to the swapper rather than through itself. Accepting stray ETH would only
    ///      create a balance for the refund path to hand to an unrelated caller.
    ///      Force-sent ETH (`selfdestruct`) is still possible and is left stuck rather than made
    ///      claimable — stuck is the safer of the two.

    /// @notice Swap exact ETH for SHARD. Unspent ETH is refunded to the caller.
    /// @param key The SHARDS pool key (currency0 = native ETH, currency1 = SHARD).
    /// @param minShardOut Minimum SHARD the caller will accept, else `InsufficientOutput`.
    /// @param deadline Unix timestamp after which the swap reverts with `Expired`.
    /// @return shardOut SHARD delivered to the caller.
    function swapEthForShard(PoolKey calldata key, uint256 minShardOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 shardOut)
    {
        _requireCanonicalPool(key);
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert ZeroAmount();

        BalanceDelta delta = abi.decode(
            poolManager.unlock(
                abi.encode(
                    msg.sender,
                    key,
                    SwapParams({
                        zeroForOne: true,
                        amountSpecified: -int256(msg.value),
                        // The hook rejects a partial fill when ETH is the specified currency,
                        // so use a limit that cannot bind on an ordinary swap.
                        sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                    })
                )
            ),
            (BalanceDelta)
        );

        int128 amount1 = delta.amount1();
        shardOut = amount1 > 0 ? uint256(uint128(amount1)) : 0;
        if (shardOut < minShardOut) revert InsufficientOutput(minShardOut, shardOut);

        // Refund THIS swap's own leftover, computed from the delta — never `address(this).balance`.
        // The balance is not the same quantity: any ETH that reached this contract by another
        // route would be swept to whoever happened to call next, which is a stranger's ETH paid
        // out to an arbitrary caller.
        //
        // `delta.amount0()` is negative and INCLUDES the hook's 1% — v4 subtracts the hook's
        // delta from the swapper's before returning it (`Hooks.afterSwap`), so what comes back
        // is the caller's total ETH cost, curve plus fee. On a full fill that is exactly
        // `-msg.value` and nothing is refunded, which is what
        // `test_ethForShardRefundsOnlyItsOwnUnspentEth` pins. Were it the curve cost alone, the
        // subtraction below would hand the fee back and the swap would not settle.
        //
        // Refunded AFTER unlock returns, never inside the callback: a contract caller that
        // re-enters on receipt would hit `AlreadyUnlocked` and DoS itself.
        int128 amount0 = delta.amount0();
        uint256 ethSpent = amount0 < 0 ? uint256(uint128(-amount0)) : 0;
        // Cannot underflow: the swap is exact-input for `msg.value`, so the pool plus the hook
        // can never take more than that. Reverting beats refunding a wrong number if it ever did.
        uint256 leftover = msg.value - ethSpent;
        if (leftover != 0) {
            (bool ok,) = msg.sender.call{ value: leftover }("");
            if (!ok) revert EthTransferFailed();
        }
    }

    /// @notice Swap exact SHARD for ETH. Caller must have approved this router for `shardIn`.
    /// @param key The SHARDS pool key (currency0 = native ETH, currency1 = SHARD).
    /// @param shardIn Exact SHARD to sell; pulled from the caller during the swap.
    /// @param minEthOut Minimum ETH the caller will accept, else `InsufficientOutput`.
    /// @param deadline Unix timestamp after which the swap reverts with `Expired`.
    /// @return ethOut ETH delivered to the caller.
    function swapShardForEth(PoolKey calldata key, uint256 shardIn, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        _requireCanonicalPool(key);
        if (block.timestamp > deadline) revert Expired();
        if (shardIn == 0) revert ZeroAmount();

        BalanceDelta delta = abi.decode(
            poolManager.unlock(
                abi.encode(
                    msg.sender,
                    key,
                    SwapParams({
                        zeroForOne: false,
                        amountSpecified: -int256(shardIn),
                        sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
                    })
                )
            ),
            (BalanceDelta)
        );

        int128 amount0 = delta.amount0();
        ethOut = amount0 > 0 ? uint256(uint128(amount0)) : 0;
        if (ethOut < minEthOut) revert InsufficientOutput(minEthOut, ethOut);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        (address swapper, PoolKey memory key, SwapParams memory params) =
            abi.decode(rawData, (address, PoolKey, SwapParams));

        BalanceDelta delta = poolManager.swap(key, params, "");

        // ETH owed to the pool is paid from this contract's balance (the caller's msg.value);
        // SHARD owed is pulled straight from the swapper. Proceeds go straight to the swapper.
        _resolve(key.currency0, delta.amount0(), swapper, swapper);
        _resolve(key.currency1, delta.amount1(), swapper, swapper);

        return abi.encode(delta);
    }

    /// @dev Negative delta = we owe the pool; positive = the pool owes us.
    function _resolve(Currency currency, int128 amount, address payer, address recipient) internal {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            if (currency.isAddressZero()) {
                poolManager.settle{ value: owed }();
            } else {
                poolManager.sync(currency);
                if (!IERC20Minimal(Currency.unwrap(currency)).transferFrom(payer, address(poolManager), owed)) {
                    revert TokenTransferFailed();
                }
                poolManager.settle();
            }
        } else if (amount > 0) {
            poolManager.take(currency, recipient, uint256(uint128(amount)));
        }
    }
}
