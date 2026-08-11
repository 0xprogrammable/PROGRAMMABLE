// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableRuntimeBindingV1,
    IProgrammableUniversalLaunchKernelV1
} from "./IProgrammableUniversalLaunchKernelV1.sol";
import {
    IProgrammableNestedFactoryProfileV1,
    IProgrammableNestedFactoryProviderV1,
    IProgrammableNestedFactoryPostconditionVerifierV1
} from "./IProgrammableNestedFactoryProfileV1.sol";

/// @notice Reusable typed NESTED_FACTORY execution profile.
/// @dev Provider and verifier are immutable. Every external call has a fixed target, selector, gas bound and exact
///      return size. The same deployed profile accepts multiple reviewed applicant plans.
contract ProgrammableNestedFactoryProfileV1 is IProgrammableNestedFactoryProfileV1 {
    uint16 private constant PLAN_SCHEMA_VERSION = 1;
    uint256 private constant MAX_COMPONENTS = 16;
    uint256 private constant PROVIDER_RETURN_BYTES = 256;
    uint256 private constant VERIFIER_RETURN_BYTES = 128;

    bytes32 public constant ACTION_IDENTITY_TYPEHASH = keccak256(
        "NestedFactoryActionIdentityV1(bytes32 providerPlanId,bytes32 factorySalt,address applicantWallet,bytes32 sourceLaunchId,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 poolId,address tokenOwner,address hookOwner,address treasury)"
    );
    bytes32 public constant ACTION_ECONOMICS_TYPEHASH = keccak256(
        "NestedFactoryActionEconomicsV1(uint256 tokenSupply,uint256 nativeValue,bytes32 hookPermissionsHash,bytes32 configurationHash)"
    );
    bytes32 public constant ACTION_TYPEHASH =
        keccak256("NestedFactoryActionV1(bytes32 identityHash,bytes32 economicsHash)");
    bytes32 public constant COMPONENT_TYPEHASH = keccak256(
        "NestedFactoryComponentV1(uint8 role,uint8 scope,address account,bytes32 runtimeCodeHash,bytes32 creationProvenanceHash,bytes32 ownershipBindingHash,bytes32 configurationHash)"
    );
    bytes32 public constant SHARED_COMPONENT_IDENTITY_TYPEHASH = keccak256(
        "NestedFactorySharedComponentIdentityV1(uint8 role,address account,bytes32 runtimeCodeHash,bytes32 creationProvenanceHash,bytes32 ownershipBindingHash,bytes32 configurationHash)"
    );
    bytes32 public constant EXPECTED_STATE_TYPEHASH = keccak256(
        "NestedFactoryExpectedStateV1(bytes32 returnedIdentitiesHash,bytes32 architectureStateHash,bytes32 poolStateHash,bytes32 revenueStateHash,bytes32 valueFlowHash)"
    );
    bytes32 public constant NESTED_FACTORY_PLAN_TYPEHASH = keccak256(
        "NestedFactoryPlanV1(uint16 schemaVersion,bytes32 actionHash,bytes32 orderedComponentHeadHash,bytes32 componentGraphHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash,bytes32 expectedStateHash)"
    );
    bytes32 public constant PROVIDER_EXECUTION_ID_TYPEHASH = keccak256(
        "NestedFactoryProviderExecutionIdV1(bytes32 providerBindingHash,bytes32 executionKey,bytes32 grantDigest,bytes32 stampLaunchId,bytes32 antiReplayNonce,bytes32 actionHash,bytes32 orderedComponentHeadHash)"
    );
    bytes32 public constant POSTCONDITION_TYPEHASH = keccak256(
        "NestedFactoryPostconditionV1(bytes32 providerExecutionId,bytes32 architectureStateHash,bytes32 poolStateHash,bytes32 revenueStateHash,bytes32 valueFlowHash,bytes32 returnedIdentitiesHash)"
    );

    IProgrammableUniversalLaunchKernelV1 public immutable KERNEL;
    bytes32 public immutable KERNEL_RUNTIME_CODEHASH;
    address public immutable PROVIDER;
    bytes32 public immutable PROVIDER_RUNTIME_CODEHASH;
    address public immutable POSTCONDITION_VERIFIER;
    bytes32 public immutable POSTCONDITION_VERIFIER_RUNTIME_CODEHASH;
    bytes32 public immutable VERIFIER_BINDING_HASH;
    bytes32 public immutable PROFILE_KEY;
    bytes32 public immutable PROVIDER_BINDING_HASH;
    uint32 public immutable PROVIDER_GAS_LIMIT;
    uint32 public immutable VERIFIER_GAS_LIMIT;

    bytes32 private _activeGrantDigest;

    struct ExecutionCorrelationV1 {
        bytes32 grantDigest;
        bytes32 stampLaunchId;
        bytes32 antiReplayNonce;
        bytes32 executionKey;
        bytes32 reservationSetHash;
    }

    error InvalidField(uint256 field);
    error RuntimeCodeHashDrift(address account);
    error UnauthorizedApplicant();
    error ReentrantExecution();
    error ComponentCollision(address account);
    error ProviderCallFailed();
    error ProviderReturnMalformed();
    error VerifierCallFailed();
    error VerifierReturnMalformed();
    error PostconditionMismatch();
    error UnexpectedValueFlow();

    event NestedFactoryLaunchFinalized(
        bytes32 indexed grantDigest,
        bytes32 indexed stampLaunchId,
        bytes32 indexed receiptCoreHash,
        bytes32 providerExecutionId
    );

    constructor(
        IProgrammableUniversalLaunchKernelV1 kernel,
        bytes32 kernelRuntimeCodeHash,
        address provider,
        bytes32 providerRuntimeCodeHash,
        address postconditionVerifier,
        bytes32 postconditionVerifierRuntimeCodeHash,
        bytes32 verifierBindingHash,
        bytes32 profileKey,
        bytes32 providerBindingHash,
        uint32 providerGasLimit,
        uint32 verifierGasLimit
    ) {
        if (
            address(kernel) == address(0) || profileKey == bytes32(0) || providerBindingHash == bytes32(0)
                || verifierBindingHash == bytes32(0)
        ) {
            revert InvalidField(1);
        }
        if (providerGasLimit < 100_000 || verifierGasLimit < 50_000) revert InvalidField(2);
        _requireRuntime(address(kernel), kernelRuntimeCodeHash);
        _requireRuntime(provider, providerRuntimeCodeHash);
        _requireRuntime(postconditionVerifier, postconditionVerifierRuntimeCodeHash);
        kernel.assertClosedRuntimeBindingV1(provider, providerRuntimeCodeHash, providerBindingHash, true);
        kernel.assertClosedRuntimeBindingV1(
            postconditionVerifier, postconditionVerifierRuntimeCodeHash, verifierBindingHash, true
        );
        KERNEL = kernel;
        KERNEL_RUNTIME_CODEHASH = kernelRuntimeCodeHash;
        PROVIDER = provider;
        PROVIDER_RUNTIME_CODEHASH = providerRuntimeCodeHash;
        POSTCONDITION_VERIFIER = postconditionVerifier;
        POSTCONDITION_VERIFIER_RUNTIME_CODEHASH = postconditionVerifierRuntimeCodeHash;
        VERIFIER_BINDING_HASH = verifierBindingHash;
        PROFILE_KEY = profileKey;
        PROVIDER_BINDING_HASH = providerBindingHash;
        PROVIDER_GAS_LIMIT = providerGasLimit;
        VERIFIER_GAS_LIMIT = verifierGasLimit;
    }

    function launchNestedFactoryV1(
        bytes32 grantDigest,
        NestedFactoryPlanV1 calldata plan,
        LaunchTransportV1 calldata transport
    ) external payable returns (bytes32 receiptCoreHash) {
        if (_activeGrantDigest != bytes32(0)) revert ReentrantExecution();
        _requireRuntime(address(KERNEL), KERNEL_RUNTIME_CODEHASH);
        _requireBoundRuntime(PROVIDER, PROVIDER_RUNTIME_CODEHASH, PROVIDER_BINDING_HASH);
        _requireBoundRuntime(POSTCONDITION_VERIFIER, POSTCONDITION_VERIFIER_RUNTIME_CODEHASH, VERIFIER_BINDING_HASH);

        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant = KERNEL.launchGrantV1(grantDigest);
        if (msg.sender != grant.applicantWallet || plan.action.applicantWallet != msg.sender) {
            revert UnauthorizedApplicant();
        }
        _validatePlan(grantDigest, plan, grant);
        if (
            transport.currentness.profilePreflightReadbackHash == bytes32(0)
                || transport.currentness.profilePreflightReadbackHash != _profilePreflightHash(plan)
        ) revert PostconditionMismatch();
        if (msg.value != plan.action.nativeValue) revert UnexpectedValueFlow();
        uint256 balanceBefore = address(this).balance - msg.value;
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations = _buildReservations(plan);
        bytes32 reservationSetHash = KERNEL.computeReservationSetHashV1(reservations);

        _activeGrantDigest = grantDigest;
        IProgrammableUniversalLaunchKernelV1.ProfileExecutionEnvelopeV1 memory envelope =
            IProgrammableUniversalLaunchKernelV1.ProfileExecutionEnvelopeV1({
                currentness: transport.currentness,
                currentnessSignature: transport.currentnessSignature,
                walletIntent: transport.walletIntent,
                walletSignature: transport.walletSignature,
                reservations: reservations
            });
        bytes32 executionKey = KERNEL.beginProfileExecutionV1(grantDigest, envelope);
        ExecutionCorrelationV1 memory correlation = ExecutionCorrelationV1({
            grantDigest: grantDigest,
            stampLaunchId: grant.stampLaunchId,
            antiReplayNonce: grant.antiReplayNonce,
            executionKey: executionKey,
            reservationSetHash: reservationSetHash
        });
        bytes32 providerExecutionId;
        (receiptCoreHash, providerExecutionId) = _executeVerifyFinalize(plan, correlation, balanceBefore);
        _activeGrantDigest = bytes32(0);
        emit NestedFactoryLaunchFinalized(
            correlation.grantDigest, correlation.stampLaunchId, receiptCoreHash, providerExecutionId
        );
    }

    function computeNestedFactoryPlanHashV1(NestedFactoryPlanV1 calldata plan) external pure returns (bytes32) {
        return _hashPlan(plan);
    }

    function nestedFactoryReservationsV1(NestedFactoryPlanV1 calldata plan)
        external
        pure
        returns (IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations)
    {
        return _buildReservations(plan);
    }

    function computeNestedFactoryPreflightHashV1(NestedFactoryPlanV1 calldata plan) external view returns (bytes32) {
        return _profilePreflightHash(plan);
    }

    function runtimeBindingHashV1() external view returns (bytes32) {
        return PROVIDER_BINDING_HASH;
    }

    function _profilePreflightHash(NestedFactoryPlanV1 calldata plan) private view returns (bytes32 readbackHash) {
        _requireBoundRuntime(POSTCONDITION_VERIFIER, POSTCONDITION_VERIFIER_RUNTIME_CODEHASH, VERIFIER_BINDING_HASH);
        bytes memory payload = abi.encodeCall(
            IProgrammableNestedFactoryPostconditionVerifierV1.verifyNestedPreflightV1, (address(this), plan)
        );
        bool success;
        uint256 returnedSize;
        address verifier = POSTCONDITION_VERIFIER;
        uint256 gasLimit = VERIFIER_GAS_LIMIT;
        assembly ("memory-safe") {
            success := staticcall(gasLimit, verifier, add(payload, 32), mload(payload), 0, 0)
            returnedSize := returndatasize()
            if and(success, eq(returnedSize, 32)) {
                returndatacopy(0, 0, 32)
                readbackHash := mload(0)
            }
        }
        if (!success) revert VerifierCallFailed();
        if (returnedSize != 32 || readbackHash == bytes32(0)) revert VerifierReturnMalformed();
        _requireBoundRuntime(POSTCONDITION_VERIFIER, POSTCONDITION_VERIFIER_RUNTIME_CODEHASH, VERIFIER_BINDING_HASH);
    }

    function _executeVerifyFinalize(
        NestedFactoryPlanV1 calldata plan,
        ExecutionCorrelationV1 memory correlation,
        uint256 balanceBefore
    ) private returns (bytes32 receiptCoreHash, bytes32 providerExecutionId) {
        NestedFactoryResultV1 memory providerResult = _executeProvider(plan, correlation);
        NestedPostconditionResultV1 memory postconditions = _verifyPostconditions(plan, providerResult);
        if (address(this).balance != balanceBefore) revert UnexpectedValueFlow();
        receiptCoreHash = _finalizeLaunch(plan, correlation, providerResult, postconditions);
        providerExecutionId = providerResult.providerExecutionId;
    }

    function _finalizeLaunch(
        NestedFactoryPlanV1 calldata plan,
        ExecutionCorrelationV1 memory correlation,
        NestedFactoryResultV1 memory providerResult,
        NestedPostconditionResultV1 memory postconditions
    ) private returns (bytes32 receiptCoreHash) {
        bytes32 postconditionHash = keccak256(
            abi.encode(
                POSTCONDITION_TYPEHASH,
                providerResult.providerExecutionId,
                postconditions.architectureStateHash,
                postconditions.poolStateHash,
                postconditions.revenueStateHash,
                postconditions.valueFlowHash,
                providerResult.returnedIdentitiesHash
            )
        );
        IProgrammableUniversalLaunchKernelV1.ExecutionResultV1 memory executionResult;
        executionResult.grantDigest = correlation.grantDigest;
        executionResult.stampLaunchId = correlation.stampLaunchId;
        executionResult.planHash = _hashPlan(plan);
        executionResult.componentSetHash = plan.componentSetHash;
        executionResult.componentRuntimeSetHash = plan.componentRuntimeSetHash;
        executionResult.configurationHash = plan.action.configurationHash;
        executionResult.reservationSetHash = correlation.reservationSetHash;
        executionResult.providerResultHash = keccak256(abi.encode(providerResult));
        executionResult.postconditionHash = postconditionHash;
        executionResult.valueFlowHash = postconditions.valueFlowHash;
        executionResult.deploymentLineageHash = providerResult.providerExecutionId;
        return KERNEL.finalizeProfileExecutionV1(executionResult);
    }

    function _validatePlan(
        bytes32 grantDigest,
        NestedFactoryPlanV1 calldata plan,
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant
    ) private view {
        if (
            plan.schemaVersion != PLAN_SCHEMA_VERSION || grantDigest == bytes32(0)
                || plan.action.providerPlanId == bytes32(0) || plan.action.factorySalt == bytes32(0)
                || plan.action.sourceLaunchId != grant.sourceLaunchId || grant.sourceLaunchId == grant.stampLaunchId
                || grant.sourceLaunchId == grant.antiReplayNonce || grant.stampLaunchId == grant.antiReplayNonce
                || plan.action.poolManager == address(0) || plan.action.poolManagerRuntimeCodeHash == bytes32(0)
                || plan.action.poolId == bytes32(0) || plan.action.tokenOwner == address(0)
                || plan.action.hookOwner == address(0) || plan.action.treasury == address(0)
                || plan.action.tokenSupply == 0 || plan.action.hookPermissionsHash == bytes32(0)
                || plan.action.configurationHash != grant.configurationHash
                || plan.componentGraphHash != grant.componentGraphHash
                || plan.componentRuntimeSetHash != grant.componentRuntimeSetHash
                || plan.expectedReturnedIdentitiesHash == bytes32(0) || plan.expectedArchitectureStateHash == bytes32(0)
                || plan.expectedPoolStateHash == bytes32(0) || plan.expectedRevenueStateHash == bytes32(0)
                || plan.expectedValueFlowHash == bytes32(0) || _hashPlan(plan) != grant.planHash
        ) revert InvalidField(3);
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor =
            KERNEL.profileDescriptorV1(PROFILE_KEY);
        if (
            grant.profileKey != PROFILE_KEY || descriptor.module != address(this)
                || descriptor.moduleRuntimeCodeHash != address(this).codehash
                || descriptor.providerBindingHash != PROVIDER_BINDING_HASH
                || descriptor.actionTypeHash != NESTED_FACTORY_PLAN_TYPEHASH
                || descriptor.capabilitySemantics != IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute
        ) revert InvalidField(4);
        (bytes32 componentHead, bytes32 componentSetHash, bytes32 runtimeSetHash) = _componentHashes(plan.components);
        if (
            componentHead == bytes32(0) || componentSetHash != plan.componentSetHash
                || runtimeSetHash != plan.componentRuntimeSetHash
        ) revert InvalidField(5);
        _validateComponentPrestate(plan.components);
    }

    function _executeProvider(NestedFactoryPlanV1 calldata plan, ExecutionCorrelationV1 memory correlation)
        private
        returns (NestedFactoryResultV1 memory result)
    {
        _requireBoundRuntime(PROVIDER, PROVIDER_RUNTIME_CODEHASH, PROVIDER_BINDING_HASH);
        result = _callProvider(plan, correlation);
        _requireBoundRuntime(PROVIDER, PROVIDER_RUNTIME_CODEHASH, PROVIDER_BINDING_HASH);
        _validateProviderResult(plan, correlation, result);
        _validateComponentPoststate(plan.components);
    }

    function _callProvider(NestedFactoryPlanV1 calldata plan, ExecutionCorrelationV1 memory correlation)
        private
        returns (NestedFactoryResultV1 memory result)
    {
        bytes memory payload = abi.encodeCall(
            IProgrammableNestedFactoryProviderV1.executeNestedFactoryV1,
            (
                correlation.executionKey,
                correlation.grantDigest,
                correlation.stampLaunchId,
                correlation.antiReplayNonce,
                plan.action,
                plan.components
            )
        );
        bytes memory output = new bytes(PROVIDER_RETURN_BYTES);
        bool success;
        uint256 returnedSize;
        address provider = PROVIDER;
        uint256 value = plan.action.nativeValue;
        uint256 gasLimit = PROVIDER_GAS_LIMIT;
        assembly ("memory-safe") {
            success := call(gasLimit, provider, value, add(payload, 32), mload(payload), add(output, 32), 256)
            returnedSize := returndatasize()
        }
        if (!success) revert ProviderCallFailed();
        if (returnedSize != PROVIDER_RETURN_BYTES) revert ProviderReturnMalformed();
        result = abi.decode(output, (NestedFactoryResultV1));
    }

    function _validateProviderResult(
        NestedFactoryPlanV1 calldata plan,
        ExecutionCorrelationV1 memory correlation,
        NestedFactoryResultV1 memory result
    ) private view {
        (bytes32 componentHead,,) = _componentHashes(plan.components);
        bytes32 expectedExecutionId = _expectedProviderExecutionId(plan, correlation, componentHead);
        if (
            result.providerExecutionId != expectedExecutionId
                || result.configurationHash != plan.action.configurationHash
                || result.componentSetHash != plan.componentSetHash
                || result.componentRuntimeSetHash != plan.componentRuntimeSetHash
                || result.architectureStateHash != plan.expectedArchitectureStateHash
                || result.poolStateHash != plan.expectedPoolStateHash
                || result.supplyValueFlowHash != plan.expectedValueFlowHash
                || result.returnedIdentitiesHash != plan.expectedReturnedIdentitiesHash
        ) revert PostconditionMismatch();
    }

    function _verifyPostconditions(NestedFactoryPlanV1 calldata plan, NestedFactoryResultV1 memory providerResult)
        private
        view
        returns (NestedPostconditionResultV1 memory postconditions)
    {
        _requireBoundRuntime(POSTCONDITION_VERIFIER, POSTCONDITION_VERIFIER_RUNTIME_CODEHASH, VERIFIER_BINDING_HASH);
        bytes memory payload = abi.encodeCall(
            IProgrammableNestedFactoryPostconditionVerifierV1.verifyNestedPostconditionsV1,
            (address(this), plan, providerResult)
        );
        bytes memory output = new bytes(VERIFIER_RETURN_BYTES);
        bool success;
        uint256 returnedSize;
        address verifier = POSTCONDITION_VERIFIER;
        uint256 gasLimit = VERIFIER_GAS_LIMIT;
        assembly ("memory-safe") {
            success := staticcall(gasLimit, verifier, add(payload, 32), mload(payload), add(output, 32), 128)
            returnedSize := returndatasize()
        }
        if (!success) revert VerifierCallFailed();
        if (returnedSize != VERIFIER_RETURN_BYTES) revert VerifierReturnMalformed();
        _requireBoundRuntime(POSTCONDITION_VERIFIER, POSTCONDITION_VERIFIER_RUNTIME_CODEHASH, VERIFIER_BINDING_HASH);
        postconditions = abi.decode(output, (NestedPostconditionResultV1));
        if (
            postconditions.architectureStateHash != plan.expectedArchitectureStateHash
                || postconditions.poolStateHash != plan.expectedPoolStateHash
                || postconditions.revenueStateHash != plan.expectedRevenueStateHash
                || postconditions.valueFlowHash != plan.expectedValueFlowHash
                || postconditions.architectureStateHash != providerResult.architectureStateHash
                || postconditions.poolStateHash != providerResult.poolStateHash
        ) revert PostconditionMismatch();
    }

    function _expectedProviderExecutionId(
        NestedFactoryPlanV1 calldata plan,
        ExecutionCorrelationV1 memory correlation,
        bytes32 componentHead
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                PROVIDER_EXECUTION_ID_TYPEHASH,
                PROVIDER_BINDING_HASH,
                correlation.executionKey,
                correlation.grantDigest,
                correlation.stampLaunchId,
                correlation.antiReplayNonce,
                _hashAction(plan.action),
                componentHead
            )
        );
    }

    function _validateComponentPrestate(ComponentExpectationV1[] calldata components) private view {
        uint256 length = components.length;
        if (length == 0 || length > MAX_COMPONENTS) revert InvalidField(6);
        for (uint256 i; i < length; ++i) {
            ComponentExpectationV1 calldata component = components[i];
            if (
                component.role == 0 || component.scope == ComponentScopeV1.None || component.account == address(0)
                    || component.runtimeCodeHash == bytes32(0) || component.creationProvenanceHash == bytes32(0)
                    || component.ownershipBindingHash == bytes32(0) || component.configurationHash == bytes32(0)
            ) revert InvalidField(7);
            for (uint256 j; j < i; ++j) {
                if (components[j].account == component.account) revert InvalidField(8);
            }
            if (component.scope == ComponentScopeV1.ExclusiveCreate) {
                if (component.account.code.length != 0) revert ComponentCollision(component.account);
            } else if (component.account.code.length == 0 || component.account.codehash != component.runtimeCodeHash) {
                revert RuntimeCodeHashDrift(component.account);
            }
        }
    }

    function _validateComponentPoststate(ComponentExpectationV1[] calldata components) private view {
        uint256 length = components.length;
        for (uint256 i; i < length; ++i) {
            ComponentExpectationV1 calldata component = components[i];
            if (component.account.code.length == 0 || component.account.codehash != component.runtimeCodeHash) {
                revert RuntimeCodeHashDrift(component.account);
            }
        }
    }

    function _buildReservations(NestedFactoryPlanV1 calldata plan)
        private
        pure
        returns (IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations)
    {
        uint256 length = plan.components.length;
        reservations = new IProgrammableUniversalLaunchKernelV1.ReservationV1[](length + 2);
        address token;
        bytes32 tokenRuntimeCodeHash;
        for (uint256 i; i < length; ++i) {
            ComponentExpectationV1 calldata component = plan.components[i];
            bool shared = component.scope == ComponentScopeV1.SharedInfrastructure;
            bytes32 sharedIdentityHash;
            if (shared) {
                sharedIdentityHash = keccak256(
                    abi.encode(
                        SHARED_COMPONENT_IDENTITY_TYPEHASH,
                        component.role,
                        component.account,
                        component.runtimeCodeHash,
                        component.creationProvenanceHash,
                        component.ownershipBindingHash,
                        component.configurationHash
                    )
                );
            }
            reservations[i] = IProgrammableUniversalLaunchKernelV1.ReservationV1({
                kind: IProgrammableUniversalLaunchKernelV1.ReservationKind.Component,
                scope: shared
                    ? IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure
                    : IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive,
                account: component.account,
                manager: address(0),
                identifier: bytes32(0),
                expectedRuntimeCodeHash: component.runtimeCodeHash,
                expectedManagerRuntimeCodeHash: bytes32(0),
                sharedIdentityHash: sharedIdentityHash
            });
            if (component.role == 1) {
                if (token != address(0)) revert InvalidField(9);
                token = component.account;
                tokenRuntimeCodeHash = component.runtimeCodeHash;
            }
        }
        if (token == address(0)) revert InvalidField(10);
        reservations[length] = IProgrammableUniversalLaunchKernelV1.ReservationV1({
            kind: IProgrammableUniversalLaunchKernelV1.ReservationKind.Token,
            scope: IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive,
            account: token,
            manager: address(0),
            identifier: bytes32(0),
            expectedRuntimeCodeHash: tokenRuntimeCodeHash,
            expectedManagerRuntimeCodeHash: bytes32(0),
            sharedIdentityHash: bytes32(0)
        });
        reservations[length + 1] = IProgrammableUniversalLaunchKernelV1.ReservationV1({
            kind: IProgrammableUniversalLaunchKernelV1.ReservationKind.Pool,
            scope: IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive,
            account: address(0),
            manager: plan.action.poolManager,
            identifier: plan.action.poolId,
            expectedRuntimeCodeHash: bytes32(0),
            expectedManagerRuntimeCodeHash: plan.action.poolManagerRuntimeCodeHash,
            sharedIdentityHash: bytes32(0)
        });
    }

    function _hashPlan(NestedFactoryPlanV1 calldata plan) private pure returns (bytes32) {
        (bytes32 componentHead,,) = _componentHashes(plan.components);
        bytes32 expectedStateHash = keccak256(
            abi.encode(
                EXPECTED_STATE_TYPEHASH,
                plan.expectedReturnedIdentitiesHash,
                plan.expectedArchitectureStateHash,
                plan.expectedPoolStateHash,
                plan.expectedRevenueStateHash,
                plan.expectedValueFlowHash
            )
        );
        return keccak256(
            abi.encode(
                NESTED_FACTORY_PLAN_TYPEHASH,
                plan.schemaVersion,
                _hashAction(plan.action),
                componentHead,
                plan.componentGraphHash,
                plan.componentSetHash,
                plan.componentRuntimeSetHash,
                expectedStateHash
            )
        );
    }

    function _hashAction(NestedFactoryActionV1 calldata action) private pure returns (bytes32) {
        bytes32 identityHash = keccak256(
            abi.encode(
                ACTION_IDENTITY_TYPEHASH,
                action.providerPlanId,
                action.factorySalt,
                action.applicantWallet,
                action.sourceLaunchId,
                action.poolManager,
                action.poolManagerRuntimeCodeHash,
                action.poolId,
                action.tokenOwner,
                action.hookOwner,
                action.treasury
            )
        );
        bytes32 economicsHash = keccak256(
            abi.encode(
                ACTION_ECONOMICS_TYPEHASH,
                action.tokenSupply,
                action.nativeValue,
                action.hookPermissionsHash,
                action.configurationHash
            )
        );
        return keccak256(abi.encode(ACTION_TYPEHASH, identityHash, economicsHash));
    }

    function _componentHashes(ComponentExpectationV1[] calldata components)
        private
        pure
        returns (bytes32 orderedHead, bytes32 componentSetHash, bytes32 runtimeSetHash)
    {
        uint256 length = components.length;
        if (length == 0 || length > MAX_COMPONENTS) return (bytes32(0), bytes32(0), bytes32(0));
        for (uint256 i; i < length; ++i) {
            ComponentExpectationV1 calldata component = components[i];
            bytes32 leaf = keccak256(
                abi.encode(
                    COMPONENT_TYPEHASH,
                    component.role,
                    uint8(component.scope),
                    component.account,
                    component.runtimeCodeHash,
                    component.creationProvenanceHash,
                    component.ownershipBindingHash,
                    component.configurationHash
                )
            );
            orderedHead = keccak256(abi.encode(orderedHead, i, leaf));
            componentSetHash = keccak256(abi.encode(componentSetHash, i, component.role, component.account, leaf));
            runtimeSetHash = keccak256(
                abi.encode(runtimeSetHash, i, component.role, component.account, component.runtimeCodeHash)
            );
        }
    }

    function _requireRuntime(address account, bytes32 expectedCodeHash) private view {
        if (
            account == address(0) || expectedCodeHash == bytes32(0) || account.code.length == 0
                || account.codehash != expectedCodeHash
        ) revert RuntimeCodeHashDrift(account);
    }

    function _requireBoundRuntime(address account, bytes32 expectedCodeHash, bytes32 expectedBindingHash) private view {
        _requireRuntime(account, expectedCodeHash);
        bytes memory payload = abi.encodeCall(IProgrammableRuntimeBindingV1.runtimeBindingHashV1, ());
        bool success;
        uint256 returnedSize;
        bytes32 actualBindingHash;
        assembly ("memory-safe") {
            success := staticcall(100000, account, add(payload, 32), mload(payload), 0, 0)
            returnedSize := returndatasize()
            if and(success, eq(returnedSize, 32)) {
                returndatacopy(0, 0, 32)
                actualBindingHash := mload(0)
            }
        }
        if (!success || returnedSize != 32 || actualBindingHash != expectedBindingHash) {
            revert RuntimeCodeHashDrift(account);
        }
        _requireRuntime(account, expectedCodeHash);
    }
}
