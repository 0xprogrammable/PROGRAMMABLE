// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { ProgrammableCustomAtomicRegistrarV1 } from "./ProgrammableCustomAtomicRegistrarV1.sol";
import { ProgrammableCustomExecutionPolicyRegistryV2 } from "./ProgrammableCustomExecutionPolicyRegistryV2.sol";
import { ProgrammableCustomTradeCapabilityLibV1 } from "./ProgrammableCustomTradeCapabilityLibV1.sol";
import { ProgrammableCustomTradeCapabilityValidatorV1 } from "./ProgrammableCustomTradeCapabilityValidatorV1.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "./interfaces/IProgrammableCustomExecutionPolicyV2.sol";
import { IProgrammableCustomRegistryV1 } from "./interfaces/IProgrammableCustomRegistryV1.sol";

/// @title ProgrammableCustomAtomicRegistrarV2
/// @notice Generation 2 atomic deployment, initialization, registration and capability-proof entry point.
/// @dev The frozen V1 selector/event are retained. This independent implementation tolerates forced ETH by
///      preserving the balance that predates a launch. Every successful path also binds the mandatory Generation 2
///      execution-policy companion; a binding failure rolls the deployment, initialization and registration back.
contract ProgrammableCustomAtomicRegistrarV2 is ReentrancyGuard {
    bytes32 public constant ATOMIC_REQUEST_DOMAIN = keccak256("programmable.custom-atomic-request.v1");
    bytes32 public constant UNSUPPORTED_TRADE_EVIDENCE = keccak256("programmable.trade-capability.unsupported.v1");
    /// @notice Canonical hash of an empty ordered `programmable.trade-market-set.v1` vector.
    bytes32 public constant PROJECT_ONLY_MARKET_SET_HASH =
        0xbd6f28a96b79921f21d91177e262ccb903f8cee746201feb41bcd74385ae3eef;
    bytes32 public constant TRADE_REVOCATION_POLICY =
        keccak256("programmable.trade-capability.runtime-drift-revokes-execution.v1");
    bytes32 public constant SYNC_TRANSFER_SETTLE_POLICY =
        keccak256("programmable.v4.settlement.sync-transfer-settle.v1");

    // Immutable protocol binding intentionally uses the uppercase convention.
    // slither-disable-next-line naming-convention
    IProgrammableCustomRegistryV1 public immutable REGISTRY;
    // slither-disable-next-line naming-convention
    ProgrammableCustomExecutionPolicyRegistryV2 public immutable EXECUTION_POLICY_REGISTRY;

    event AtomicCustomLaunchExecutedV1(
        bytes32 indexed launchId,
        address indexed primaryContract,
        bytes32 indexed salt,
        bytes32 creationCodeHash,
        bytes32 initializationResultHash
    );

    error AtomicRequestBindingMismatch(bytes32 supplied, bytes32 actual);
    error InitializationFailed(bytes32 returnDataHash);
    error InitializationResultHashMismatch(bytes32 supplied, bytes32 actual);
    error InvalidRegistry();
    error InvalidTradeCapability(bytes32 field, uint256 index);
    error LaunchWalletMismatch(address caller, address launchWallet);
    error PredictedAddressMismatch(address supplied, address predicted);
    error ResidualValue(uint256 balance);
    error RuntimeCodeHashMismatch(address target, bytes32 supplied, bytes32 actual);
    error TradeCapabilityBindingMismatch(bytes32 supplied, bytes32 actual);
    error UnexpectedInitializationValue(uint256 value);
    error ValueMismatch(uint256 supplied, uint256 expected);

    constructor(
        IProgrammableCustomRegistryV1 registry,
        ProgrammableCustomExecutionPolicyRegistryV2 executionPolicyRegistry
    ) {
        if (address(registry) == address(0) || address(registry).code.length == 0) revert InvalidRegistry();
        if (
            address(executionPolicyRegistry) == address(0) || address(executionPolicyRegistry).code.length == 0
                || address(executionPolicyRegistry.REGISTRY()) != address(registry)
                || executionPolicyRegistry.ATOMIC_REGISTRAR() != address(this)
        ) revert InvalidRegistry();
        REGISTRY = registry;
        EXECUTION_POLICY_REGISTRY = executionPolicyRegistry;
    }

    function predictAddress(bytes32 salt, bytes32 creationCodeHash) external view returns (address) {
        return Create2.computeAddress(salt, creationCodeHash);
    }

    function computeAtomicRequestCommitment(ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 calldata request)
        external
        view
        returns (bytes32)
    {
        bytes32 creationCodeHash = keccak256(request.creationCode);
        address predicted = Create2.computeAddress(request.salt, creationCodeHash);
        return _atomicRequestCommitment(request, predicted, creationCodeHash);
    }

    function computeTradeCapabilityHashV1(IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability)
        external
        pure
        returns (bytes32)
    {
        return ProgrammableCustomTradeCapabilityLibV1.capabilityHash(capability);
    }

    function unsupportedTradeCapabilityV1(IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration)
        external
        pure
        returns (IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory)
    {
        return _unsupportedTradeCapability(registration);
    }

    /// @notice Frozen V1-compatible selector restricted to canonical project-only/no-market launches.
    function deployInitializeAndRegister(ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 calldata request)
        external
        payable
        nonReentrant
        returns (address primaryContract)
    {
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _unsupportedTradeCapability(request.registration);
        primaryContract = _deployInitializeAndRegister(request, capability);
    }

    /// @notice Atomic Generation 2 launch with a canonical ordered route and market-source set.
    function deployInitializeRegisterAndBindTradeCapabilityV1(
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 calldata request,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability
    ) external payable nonReentrant returns (address primaryContract) {
        primaryContract = _deployInitializeAndRegister(request, capability);
    }

    function _deployInitializeAndRegister(
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 calldata request,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability
    ) private returns (address primaryContract) {
        // msg.value is already included at entry. The snapshot excludes this launch's value and therefore preserves
        // unrelated ETH delivered earlier, including through SELFDESTRUCT without invoking this contract.
        uint256 preexistingBalance = address(this).balance - msg.value;
        (address predicted, bytes32 creationCodeHash) = _validateRequest(request);
        _validateTradeCapability(request.registration, capability);

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
        EXECUTION_POLICY_REGISTRY.bindTradeCapabilityV1(capability, request.registration);
        if (address(this).balance != preexistingBalance) revert ResidualValue(address(this).balance);

        emit AtomicCustomLaunchExecutedV1(
            request.registration.launchId,
            primaryContract,
            request.salt,
            creationCodeHash,
            actualInitializationResultHash
        );
    }

    function _validateRequest(ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 calldata request)
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

    function _validateTradeCapability(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability
    ) private view {
        if (capability.launchId != registration.launchId) {
            revert InvalidTradeCapability(bytes32("launch-id"), type(uint256).max);
        }
        bytes32 actual = ProgrammableCustomTradeCapabilityValidatorV1.validate(
            capability, registration.chainId, registration.registryGeneration
        );
        if (registration.capabilitySetHash != actual) {
            revert TradeCapabilityBindingMismatch(registration.capabilitySetHash, actual);
        }
    }

    function _initialize(
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 calldata request,
        address primaryContract
    ) private returns (bytes32 actualInitializationResultHash) {
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

    function _unsupportedTradeCapability(IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration)
        private
        pure
        returns (IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability)
    {
        if (
            registration.providerId != bytes32(0)
                || registration.feePolicy.kind != IProgrammableCustomRegistryV1.FeePolicyKind.NoQualifyingMarket
                || registration.marketPathId != bytes32(0) || registration.marketSetHash != PROJECT_ONLY_MARKET_SET_HASH
        ) revert InvalidTradeCapability(bytes32("legacy-project-only"), type(uint256).max);
        capability.chainId = registration.chainId;
        capability.registryGeneration = registration.registryGeneration;
        capability.launchId = registration.launchId;
        capability.marketSetHash = registration.marketSetHash;
        capability.routes = new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](0);
        capability.routeSetHash = ProgrammableCustomTradeCapabilityLibV1.routeSetHash(capability.routes);
        capability.marketDataSources = new IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[](0);
        capability.marketDataSourceSetHash =
            ProgrammableCustomTradeCapabilityLibV1.marketDataSourceSetHash(capability.marketDataSources);
        capability.evidenceHash = UNSUPPORTED_TRADE_EVIDENCE;
        capability.revocationPolicyHash = TRADE_REVOCATION_POLICY;
    }

    function _atomicRequestCommitment(
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 calldata request,
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
