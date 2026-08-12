// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title ProtocolRevenueCollectorV1
/// @notice Native-only, non-custodial policy anchor for future Custom protocol revenue.
/// @dev Standard fee sources pay the fixed reward wallet directly. This contract only exposes its native balance for
///      delta accounting and forwards ETH accidentally or forcibly sent here to that same fixed wallet. It has no
///      ERC-20, owner, upgrade, arbitrary-call, arbitrary-recipient or normal custody surface.
contract ProtocolRevenueCollectorV1 is ReentrancyGuardTransient {
    using Address for address payable;

    address public constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    error LossyForward(address asset, uint256 expected, uint256 received);
    error NoStrayBalance(address asset);
    error UnsupportedProtocolRevenueAsset(address asset);

    event StrayAssetForwarded(address indexed asset, address indexed caller, uint256 amount);

    /// @dev A normal native transfer is forwarded in the same transaction, leaving this contract non-custodial.
    receive() external payable nonReentrant {
        uint256 balanceBefore = REWARD_WALLET.balance;
        payable(REWARD_WALLET).sendValue(msg.value);
        uint256 received = REWARD_WALLET.balance - balanceBefore;
        if (received != msg.value) revert LossyForward(address(0), msg.value, received);
        emit StrayAssetForwarded(address(0), msg.sender, msg.value);
    }

    function rewardWallet() external pure returns (address) {
        return REWARD_WALLET;
    }

    function rewardWalletBalance(address asset) public view returns (uint256) {
        if (asset != address(0)) revert UnsupportedProtocolRevenueAsset(asset);
        return REWARD_WALLET.balance;
    }

    /// @notice Permissionlessly forwards a forced native balance to the immutable reward wallet.
    /// @dev The destination is not caller-controlled and the full recipient delta must equal the collector debit.
    function forwardStrayAsset(address asset) external nonReentrant returns (uint256 amount) {
        if (asset != address(0)) revert UnsupportedProtocolRevenueAsset(asset);
        amount = address(this).balance;
        if (amount == 0) revert NoStrayBalance(asset);
        uint256 balanceBefore = REWARD_WALLET.balance;
        payable(REWARD_WALLET).sendValue(amount);
        uint256 received = REWARD_WALLET.balance - balanceBefore;
        if (received != amount) revert LossyForward(asset, amount, received);
        emit StrayAssetForwarded(asset, msg.sender, amount);
    }
}
