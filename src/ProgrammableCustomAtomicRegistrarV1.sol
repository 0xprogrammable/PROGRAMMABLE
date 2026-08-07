// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IProgrammableCustomRegistryV1 } from "./interfaces/IProgrammableCustomRegistryV1.sol";

/// @title ProgrammableCustomAtomicRegistrarV1
/// @notice Deploys, initializes, runtime-checks, and registers a Custom launch in one transaction.
/// @dev The registry must grant WRITER_ROLE to this contract. Any failed step reverts the whole launch.
contract ProgrammableCustomAtomicRegistrarV1 is ReentrancyGuard {
    bytes32 public constant ATOMIC_REQUEST_DOMAIN = keccak256("programmable.custom-atomic-request.v1");

    // Immutable protocol binding intentionally uses the uppercase convention.
    // slither-disable-next-line naming-convention
    IProgrammableCustomRegistryV1 public immutable REGISTRY;

    struct AtomicLaunchRequestV1 {
        bytes32 salt;
        bytes creationCode;
        uint256 constructorValue;
        bytes initializationCall;
        uint256 initializationValue;
        bytes32 initializationResultHash;
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 registration;
    }

    event AtomicCustomLaunchExecutedV1(
        bytes32 indexed launchId,
        address indexed primaryContract,
        bytes32 indexed salt,
        bytes32 creationCodeHash,
        bytes32 initializationResultHash
    );

    error InitializationFailed(bytes32 returnDataHash);
    error InitializationResultHashMismatch(bytes32 supplied, bytes32 actual);
    error AtomicRequestBindingMismatch(bytes32 supplied, bytes32 actual);
    error InvalidRegistry();
    error LaunchWalletMismatch(address caller, address launchWallet);
    error PredictedAddressMismatch(address supplied, address predicted);
    error ResidualValue(uint256 balance);
    error RuntimeCodeHashMismatch(address target, bytes32 supplied, bytes32 actual);
    error UnexpectedInitializationValue(uint256 value);
    error ValueMismatch(uint256 supplied, uint256 expected);

    constructor(IProgrammableCustomRegistryV1 registry) {
        if (address(registry) == address(0) || address(registry).code.length == 0) revert InvalidRegistry();
        REGISTRY = registry;
    }

    function predictAddress(bytes32 salt, bytes32 creationCodeHash) external view returns (address) {
        return Create2.computeAddress(salt, creationCodeHash);
    }

    function computeAtomicRequestCommitment(AtomicLaunchRequestV1 calldata request) external view returns (bytes32) {
        bytes32 creationCodeHash = keccak256(request.creationCode);
        address predicted = Create2.computeAddress(request.salt, creationCodeHash);
        return _atomicRequestCommitment(request, predicted, creationCodeHash);
    }

    function deployInitializeAndRegister(AtomicLaunchRequestV1 calldata request)
        external
        payable
        nonReentrant
        returns (address primaryContract)
    {
        (address predicted, bytes32 creationCodeHash) = _validateRequest(request);
        primaryContract = Create2.deploy(request.constructorValue, request.salt, request.creationCode);
        if (primaryContract == address(0)) revert PredictedAddressMismatch(address(0), predicted);
        bytes32 actualInitializationResultHash = _initialize(request, primaryContract);

        bytes32 actualRuntimeCodeHash = primaryContract.codehash;
        if (actualRuntimeCodeHash != request.registration.primaryRuntimeCodeHash) {
            revert RuntimeCodeHashMismatch(
                primaryContract, request.registration.primaryRuntimeCodeHash, actualRuntimeCodeHash
            );
        }

        REGISTRY.registerLaunch(request.registration);
        if (address(this).balance != 0) revert ResidualValue(address(this).balance);

        emit AtomicCustomLaunchExecutedV1(
            request.registration.launchId,
            primaryContract,
            request.salt,
            creationCodeHash,
            actualInitializationResultHash
        );
    }

    function _validateRequest(AtomicLaunchRequestV1 calldata request)
        private
        view
        returns (address predicted, bytes32 creationCodeHash)
    {
        if (msg.sender != request.registration.launchWallet) {
            revert LaunchWalletMismatch(msg.sender, request.registration.launchWallet);
        }
        uint256 expectedValue = request.constructorValue + request.initializationValue;
        if (msg.value != expectedValue) revert ValueMismatch(msg.value, expectedValue);
        if (request.initializationCall.length == 0 && request.initializationValue != 0) {
            revert UnexpectedInitializationValue(request.initializationValue);
        }

        creationCodeHash = keccak256(request.creationCode);
        predicted = Create2.computeAddress(request.salt, creationCodeHash);
        if (request.registration.primaryContract != predicted) {
            revert PredictedAddressMismatch(request.registration.primaryContract, predicted);
        }
        bytes32 atomicRequestCommitment = _atomicRequestCommitment(request, predicted, creationCodeHash);
        if (request.registration.deploymentConfigurationHash != atomicRequestCommitment) {
            revert AtomicRequestBindingMismatch(
                request.registration.deploymentConfigurationHash, atomicRequestCommitment
            );
        }
    }

    function _initialize(AtomicLaunchRequestV1 calldata request, address primaryContract)
        private
        returns (bytes32 actualInitializationResultHash)
    {
        bytes memory initializationResult = new bytes(0);
        if (request.initializationCall.length != 0) {
            bool success;
            // The arbitrary approved initializer requires a low-level call so return data can be committed.
            // The recipient is the deterministic approved CREATE2 target, and msg.value must match the bound request.
            // slither-disable-next-line arbitrary-send-eth,low-level-calls
            (success, initializationResult) =
                primaryContract.call{ value: request.initializationValue }(request.initializationCall);
            if (!success) revert InitializationFailed(keccak256(initializationResult));
        }
        actualInitializationResultHash = keccak256(initializationResult);
        if (actualInitializationResultHash != request.initializationResultHash) {
            revert InitializationResultHashMismatch(request.initializationResultHash, actualInitializationResultHash);
        }
    }

    function _atomicRequestCommitment(
        AtomicLaunchRequestV1 calldata request,
        address predicted,
        bytes32 creationCodeHash
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ATOMIC_REQUEST_DOMAIN,
                creationCodeHash,
                request.salt,
                predicted,
                request.constructorValue,
                keccak256(request.initializationCall),
                request.initializationValue,
                request.initializationResultHash,
                request.registration.primaryRuntimeCodeHash
            )
        );
    }
}
