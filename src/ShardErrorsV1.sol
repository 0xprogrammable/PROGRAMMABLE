// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library ShardErrorsV1 {
    error NotHook();
    error NotNFT();
    error NotDeployer();
    error NotPoolManager();
    error AlreadyInitialised();
    error NotInitialised();
    error WrongPool();
    error WrongStartPrice(uint160 expected, uint160 provided);
    error PoolExhausted();
    error TokenDoesNotExist(uint256 tokenId);
    error InsufficientPayment(uint256 required, uint256 provided);
    error SlippageExceeded(uint256 limit, uint256 actual);
    error Expired();
    error NothingToClaim();
    error EthTransferFailed();
    error DirectTransferRejected();
    error ZeroAddress();
    error InvalidTickRange();
    error InvalidStartPrice();
    error WrongShardBalance(uint256 expected, uint256 actual);
    error WrongNFT(address nft, address expectedHook);
    error TokenTransferFailed();
    /// @dev A buy consumed ETH that belonged to fee holders rather than to the buyer.
    error FeeEthMissing(uint256 expected, uint256 actual);
    /// @dev A swap stopped at its price limit while ETH was the specified currency. The fee
    ///      for that case is fixed before execution and cannot be reduced afterwards, so the
    ///      swap is rejected rather than overcharged. See {ShardHookV1._afterSwap}.
    error PartialFillNotSupported();
    /// @dev A buy was sent no ETH at all. Without this the swap reverts opaquely deep in v4,
    ///      or (with minCount 0) succeeds as a confusing no-op that mints nothing.
    error ZeroAmount();
    /// @dev A batch buy asked for more NFTs than one transaction can safely mint.
    error BatchTooLarge(uint256 requested, uint256 max);
    /// @dev buyMax bought fewer whole NFTs than the caller was willing to accept.
    error InsufficientOutput(uint256 minCount, uint256 actual);
    /// @dev A third-party swap tried to move more SHARD than one swap is allowed to, in either
    ///      direction. Amounts are in SHARD wei, not whole SHARD. See {ShardHookV1._afterSwap}.
    error SwapTooLarge(uint256 shard, uint256 maxShard);
    /// @dev Caller is not the current builder beneficiary.
    error NotBuilder();
    /// @dev Caller is not the launcher (Programmable) fee recipient.
    error NotLauncher();
}
