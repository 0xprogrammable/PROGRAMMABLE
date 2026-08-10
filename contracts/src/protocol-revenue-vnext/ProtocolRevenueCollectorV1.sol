// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title ProtocolRevenueCollectorV1
/// @notice Non-custodial policy anchor for Programmable protocol revenue.
/// @dev Standard fee sources pay the fixed reward wallet directly. This contract only exposes its balances for
///      delta accounting and forwards assets accidentally or forcibly sent here to that same fixed wallet. It has no
///      owner, upgrade, arbitrary-call, arbitrary-recipient or normal custody surface.
contract ProtocolRevenueCollectorV1 is ReentrancyGuardTransient {
    using Address for address payable;
    using SafeERC20 for IERC20;

    address public constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    error LossyForward(address asset, uint256 expected, uint256 received);
    error NoStrayBalance(address asset);
    error TokenBalanceCallFailed(address token, address account);
    error TokenBalanceReturnMalformed(address token, address account, uint256 returnDataSize);
    error TokenHasNoCode(address token);

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
        if (asset == address(0)) return REWARD_WALLET.balance;
        if (asset.code.length == 0) revert TokenHasNoCode(asset);
        return _tokenBalance(asset, REWARD_WALLET);
    }

    /// @notice Permissionlessly forwards a forced native balance or accidentally transferred ERC20 balance.
    /// @dev The destination is not caller-controlled and the full recipient delta must equal the collector debit.
    function forwardStrayAsset(address asset) external nonReentrant returns (uint256 amount) {
        if (asset == address(0)) {
            amount = address(this).balance;
            if (amount == 0) revert NoStrayBalance(asset);
            uint256 balanceBefore = REWARD_WALLET.balance;
            payable(REWARD_WALLET).sendValue(amount);
            uint256 received = REWARD_WALLET.balance - balanceBefore;
            if (received != amount) revert LossyForward(asset, amount, received);
        } else {
            if (asset.code.length == 0) revert TokenHasNoCode(asset);
            IERC20 token = IERC20(asset);
            amount = _tokenBalance(asset, address(this));
            if (amount == 0) revert NoStrayBalance(asset);
            uint256 recipientBefore = _tokenBalance(asset, REWARD_WALLET);
            uint256 collectorBefore = amount;
            token.safeTransfer(REWARD_WALLET, amount);
            uint256 collectorDebit = collectorBefore - _tokenBalance(asset, address(this));
            uint256 recipientCredit = _tokenBalance(asset, REWARD_WALLET) - recipientBefore;
            if (collectorDebit != amount || recipientCredit != amount) {
                revert LossyForward(asset, amount, recipientCredit);
            }
        }
        emit StrayAssetForwarded(asset, msg.sender, amount);
    }

    /// @dev Reads one ERC20 balance without copying attacker-controlled return or revert data into memory.
    function _tokenBalance(address token, address account) private view returns (uint256 tokenBalance) {
        bytes memory callData = abi.encodeCall(IERC20.balanceOf, (account));
        bool success;
        uint256 returnDataSize;
        assembly ("memory-safe") {
            success := staticcall(gas(), token, add(callData, 0x20), mload(callData), 0, 0)
            returnDataSize := returndatasize()
            if and(success, eq(returnDataSize, 0x20)) {
                returndatacopy(0, 0, 0x20)
                tokenBalance := mload(0)
            }
        }
        if (!success) revert TokenBalanceCallFailed(token, account);
        if (returnDataSize != 32) revert TokenBalanceReturnMalformed(token, account, returnDataSize);
    }
}
