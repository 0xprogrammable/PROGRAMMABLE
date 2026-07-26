// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

/// @title LockedPositionFeeForwarderFactoryV1
/// @notice Deterministically deploys Uniswap PositionFeesForwarder instances under Launcher V1's lock policy.
/// @dev The official forwarder is configured with no operator and the maximum possible timelock block.
///      It can collect LP fees without decreasing liquidity, while no practical transfer or withdrawal path exists.
contract LockedPositionFeeForwarderFactoryV1 {
    /// @notice No address can receive approval to transfer a locked position.
    address public constant OPERATOR = address(0);

    /// @notice The block at which the official forwarder's approval path would unlock.
    uint256 public constant TIMELOCK_BLOCK = type(uint256).max;

    /// @notice The only PositionManager accepted by forwarders from this factory.
    IPositionManager public immutable positionManager;

    /// @notice Configuration commitment for each forwarder deployed by this factory.
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

    /// @notice Deploys the pinned official fee forwarder with Launcher V1's fixed custody parameters.
    function deploy(bytes32 salt, address feeRecipient) external returns (PositionFeesForwarder forwarder) {
        bytes memory code = initCode(feeRecipient);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) revert ForwarderAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        forwarder = PositionFeesForwarder(payable(deployed));

        bytes32 configurationHash = _configurationHash(deployed, feeRecipient);
        configurationHashOf[deployed] = configurationHash;

        emit LockedPositionFeeForwarderDeployed(
            deployed, feeRecipient, salt, configurationHash, address(positionManager)
        );
    }

    /// @notice Predicts the forwarder's counterfactual address.
    function predict(bytes32 salt, address feeRecipient) public view returns (address) {
        return Create2.computeAddress(salt, initCodeHash(feeRecipient));
    }

    /// @notice Returns the exact creation code used by this factory.
    function initCode(address feeRecipient) public view returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(PositionFeesForwarder).creationCode,
            abi.encode(positionManager, OPERATOR, TIMELOCK_BLOCK, feeRecipient)
        );
    }

    /// @notice Returns the exact creation-code hash used for CREATE2 prediction.
    function initCodeHash(address feeRecipient) public view returns (bytes32) {
        return keccak256(initCode(feeRecipient));
    }

    /// @notice True only for a forwarder successfully deployed by this factory.
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
