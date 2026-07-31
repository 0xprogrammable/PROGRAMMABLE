// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IShardHookDonate {
    function donate() external payable;
}

/// @title ShardFeeForwarderV1
/// @notice Turns a plain ETH transfer into a payment to SHARDS holders.
///
/// @dev A cousin contract, deliberately tiny and stateless. It exists because most
///      things that might want to pay holders (a launchpad, a royalty splitter, a
///      marketplace payout) know how to send ETH to an address and nothing more.
///      They cannot be expected to encode a call to {ShardHookV1-donate}.
///
///      So: send ETH here, then anyone calls {flush} to push the whole balance into
///      the fee pool. Sending straight to the hook instead would strand the ETH
///      forever, because the hook's `receive` cannot distribute (v4 delivers swap
///      proceeds through it).
///
///      Holding no state and no privileges is the point. There is no owner, no
///      withdrawal path and no way to redirect the ETH: every wei that arrives can
///      only ever leave through `donate`. Anyone may flush, so nobody has to be
///      trusted to do it.
contract ShardFeeForwarderV1 {
    error ZeroAddress();
    error NothingToFlush();

    /// @notice The hook whose holders get paid. Fixed at deployment.
    address payable public immutable hook;

    /// @notice ETH pushed into the fee pool.
    event Flushed(address indexed caller, uint256 amount);

    constructor(address payable _hook) {
        if (_hook == address(0)) revert ZeroAddress();
        hook = _hook;
    }

    /// @notice Accepts ETH from anyone, with no calldata. Held until {flush}.
    receive() external payable { }

    /// @notice Push the entire balance into the hook's fee pool.
    /// @dev Permissionless. The contract has no other exit, so an untrusted caller
    ///      can only move ETH to the one destination it was built for.
    function flush() external {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToFlush();

        // Balance is read and spent in the same call and the contract keeps no
        // accounting, so there is nothing a re-entrant caller could double spend.
        IShardHookDonate(hook).donate{ value: amount }();

        emit Flushed(msg.sender, amount);
    }
}
