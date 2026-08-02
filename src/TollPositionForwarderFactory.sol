// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { TollPositionForwarder } from "./TollPositionForwarder.sol";

/// @title TollPositionForwarderFactory
/// @notice Deterministically deploys TollPositionForwarder instances with permanent LP lock.
///         Drop-in replacement for LockedPositionFeeForwarderFactoryV1 without the
///         BlockNumberish/Arbitrum dependency.
contract TollPositionForwarderFactory {
    address public constant OPERATOR = address(0);
    uint256 public constant TIMELOCK_BLOCK = type(uint256).max;

    IPositionManager public immutable positionManager;
    mapping(address forwarder => bytes32 configurationHash) public configurationHashOf;

    error ForwarderAlreadyDeployed(address forwarder);
    error InvalidPositionManager(address positionManager);
    error DeploymentAddressMismatch(address actual, address predicted);

    event LockedPositionFeeForwarderDeployed(
        address indexed forwarder,
        address indexed feeRecipient,
        bytes32 indexed salt,
        bytes32 configurationHash,
        address positionManager
    );

    constructor(IPositionManager positionManager_) {
        if (address(positionManager_) == address(0) || address(positionManager_).code.length == 0) {
            revert InvalidPositionManager(address(positionManager_));
        }
        positionManager = positionManager_;
    }

    function deploy(bytes32 salt, address feeRecipient) external returns (TollPositionForwarder forwarder) {
        bytes memory code = initCode(feeRecipient);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) revert ForwarderAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        forwarder = TollPositionForwarder(payable(deployed));

        bytes32 configHash = _configurationHash(deployed, feeRecipient);
        configurationHashOf[deployed] = configHash;

        emit LockedPositionFeeForwarderDeployed(deployed, feeRecipient, salt, configHash, address(positionManager));
    }

    function predict(bytes32 salt, address feeRecipient) public view returns (address) {
        return Create2.computeAddress(salt, initCodeHash(feeRecipient));
    }

    function initCode(address feeRecipient) public view returns (bytes memory) {
        return abi.encodePacked(
            type(TollPositionForwarder).creationCode,
            abi.encode(positionManager, OPERATOR, TIMELOCK_BLOCK, feeRecipient)
        );
    }

    function initCodeHash(address feeRecipient) public view returns (bytes32) {
        return keccak256(initCode(feeRecipient));
    }

    function isFactoryForwarder(address forwarder) external view returns (bool) {
        return configurationHashOf[forwarder] != bytes32(0);
    }

    function _configurationHash(address forwarder, address feeRecipient) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                forwarder,
                address(positionManager),
                OPERATOR,
                TIMELOCK_BLOCK,
                feeRecipient
            )
        );
    }
}
