// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {
    ClassicInitialBuyCustodyConfig,
    ClassicInitialBuyCustodyMode,
    ClassicInitialBuyScheduleV1,
    ClassicInitialBuyVestingWalletV1
} from "./ClassicInitialBuyVestingWalletV1.sol";

/// @title ClassicInitialBuyVestingWalletFactoryV1
/// @notice Deterministically deploys authenticated, non-transferable Initial Buy custody wallets.
contract ClassicInitialBuyVestingWalletFactoryV1 {
    uint16 public constant MIN_DURATION_DAYS = 1;
    uint16 public constant MAX_DURATION_DAYS = 3650;

    mapping(address wallet => bytes32 configurationHash) public configurationHashOf;

    error CustodyNotRequired();
    error DeploymentAddressMismatch(address actual, address predicted);
    error UnrecognizedFactoryDeployment(address deployment);
    error WalletAlreadyDeployed(address wallet);

    event ClassicInitialBuyVestingWalletDeployed(
        address indexed wallet,
        address indexed token,
        address indexed beneficiary,
        bytes32 salt,
        bytes32 configurationHash
    );

    function validateConfig(ClassicInitialBuyCustodyConfig memory config) public pure {
        ClassicInitialBuyScheduleV1.validate(config);
    }

    function deploy(
        bytes32 salt,
        IERC20 token,
        address beneficiary,
        uint64 launchTimestamp,
        ClassicInitialBuyCustodyConfig memory config
    ) external returns (ClassicInitialBuyVestingWalletV1 wallet) {
        if (config.mode == ClassicInitialBuyCustodyMode.Unlocked) {
            revert CustodyNotRequired();
        }
        bytes memory code = initCode(token, beneficiary, launchTimestamp, config);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) revert WalletAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        wallet = ClassicInitialBuyVestingWalletV1(payable(deployed));

        bytes32 configurationHash = wallet.configurationHash();
        configurationHashOf[deployed] = configurationHash;
        emit ClassicInitialBuyVestingWalletDeployed(deployed, address(token), beneficiary, salt, configurationHash);
    }

    /// @notice Deploys the configured custody or returns the same authenticated counterfactual wallet if it exists.
    /// @dev This makes a launch resistant to third parties predeploying its publicly predictable CREATE2 custody.
    function deployOrGet(
        bytes32 salt,
        IERC20 token,
        address beneficiary,
        uint64 launchTimestamp,
        ClassicInitialBuyCustodyConfig memory config
    ) external returns (ClassicInitialBuyVestingWalletV1 wallet) {
        if (config.mode == ClassicInitialBuyCustodyMode.Unlocked) {
            revert CustodyNotRequired();
        }
        address predicted = Create2.computeAddress(salt, initCodeHash(token, beneficiary, launchTimestamp, config));
        if (predicted.code.length == 0) {
            bytes memory code = initCode(token, beneficiary, launchTimestamp, config);
            address deployed = Create2.deploy(0, salt, code);
            if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
            wallet = ClassicInitialBuyVestingWalletV1(payable(deployed));

            bytes32 configurationHash = wallet.configurationHash();
            configurationHashOf[deployed] = configurationHash;
            emit ClassicInitialBuyVestingWalletDeployed(deployed, address(token), beneficiary, salt, configurationHash);
            return wallet;
        }
        if (configurationHashOf[predicted] == bytes32(0)) revert UnrecognizedFactoryDeployment(predicted);
        return ClassicInitialBuyVestingWalletV1(payable(predicted));
    }

    function predict(
        bytes32 salt,
        IERC20 token,
        address beneficiary,
        uint64 launchTimestamp,
        ClassicInitialBuyCustodyConfig memory config
    ) external view returns (address) {
        if (config.mode == ClassicInitialBuyCustodyMode.Unlocked) revert CustodyNotRequired();
        return Create2.computeAddress(salt, initCodeHash(token, beneficiary, launchTimestamp, config));
    }

    function initCode(
        IERC20 token,
        address beneficiary,
        uint64 launchTimestamp,
        ClassicInitialBuyCustodyConfig memory config
    ) public pure returns (bytes memory) {
        ClassicInitialBuyScheduleV1.validate(config);
        if (config.mode == ClassicInitialBuyCustodyMode.Unlocked) revert CustodyNotRequired();
        // Slither mistakes the creation-code expression for a long numeric literal.
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(ClassicInitialBuyVestingWalletV1).creationCode, abi.encode(token, beneficiary, launchTimestamp, config)
        );
    }

    function initCodeHash(
        IERC20 token,
        address beneficiary,
        uint64 launchTimestamp,
        ClassicInitialBuyCustodyConfig memory config
    ) public pure returns (bytes32) {
        return keccak256(initCode(token, beneficiary, launchTimestamp, config));
    }

    function isFactoryWallet(address wallet) external view returns (bool) {
        return configurationHashOf[wallet] != bytes32(0);
    }
}
