// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { ActionConstants } from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title TollPositionForwarder
/// @notice Holds a V4 LP position permanently and forwards collected fees to a recipient.
///         Drop-in replacement for Programmable's PositionFeesForwarder without the
///         BlockNumberish/Arbitrum dependency that breaks on non-Arbitrum chains.
contract TollPositionForwarder is ReentrancyGuardTransient {
    error InvalidFeeRecipient(address feeRecipient);
    error Timelocked();

    event FeesForwarded(address indexed feeRecipient);
    event OperatorApproved(address indexed operator);

    IPositionManager public immutable positionManager;
    address public immutable operator;
    uint256 public immutable timelockBlockNumber;
    address public immutable feeRecipient;

    constructor(
        IPositionManager _positionManager,
        address _operator,
        uint256 _timelockBlockNumber,
        address _feeRecipient
    ) {
        if (
            _feeRecipient == address(0) || _feeRecipient == ActionConstants.MSG_SENDER
                || _feeRecipient == ActionConstants.ADDRESS_THIS
        ) {
            revert InvalidFeeRecipient(_feeRecipient);
        }
        positionManager = _positionManager;
        operator = _operator;
        timelockBlockNumber = _timelockBlockNumber;
        feeRecipient = _feeRecipient;
    }

    function approveOperator() external {
        if (block.number < timelockBlockNumber) revert Timelocked();
        IERC721(address(positionManager)).setApprovalForAll(operator, true);
        emit OperatorApproved(operator);
    }

    function collectFees(uint256 _tokenId) external nonReentrant {
        (PoolKey memory poolKey,) = positionManager.getPoolAndPositionInfo(_tokenId);

        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(_tokenId, 0, 0, 0, bytes(""));
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, feeRecipient);

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        emit FeesForwarded(feeRecipient);
    }

    receive() external payable {}
}
