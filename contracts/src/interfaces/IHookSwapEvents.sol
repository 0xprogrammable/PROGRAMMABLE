// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.26;

import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

/// @notice Standard event interface for custom-accounting hook swaps.
/// @dev Implements the URC-2 reference event proposed by Uniswap Labs.
interface IHookSwapEvents {
    /// @notice Emitted once for every successful swap where the hook contributes a token delta.
    /// @param id The Uniswap v4 pool ID.
    /// @param sender The sender supplied to the hook, commonly a router.
    /// @param amount0 The hook delta for currency0 from the swapper perspective.
    /// @param amount1 The hook delta for currency1 from the swapper perspective.
    /// @param swapFee The hook fee in pips, where 1_000_000 is 100%.
    event HookSwap(PoolId indexed id, address indexed sender, int128 amount0, int128 amount1, uint24 swapFee);
}
