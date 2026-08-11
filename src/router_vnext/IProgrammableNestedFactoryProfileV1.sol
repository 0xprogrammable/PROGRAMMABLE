// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableUniversalLaunchKernelV1 } from "./IProgrammableUniversalLaunchKernelV1.sol";

/// @notice Closed typed interfaces for reusable nested-factory launch profiles.
interface IProgrammableNestedFactoryProfileV1 {
    enum ComponentScopeV1 {
        None,
        ExclusiveCreate,
        SharedInfrastructure
    }

    struct NestedFactoryActionV1 {
        bytes32 providerPlanId;
        bytes32 factorySalt;
        address applicantWallet;
        bytes32 sourceLaunchId;
        address poolManager;
        bytes32 poolManagerRuntimeCodeHash;
        bytes32 poolId;
        address tokenOwner;
        address hookOwner;
        address treasury;
        uint256 tokenSupply;
        uint256 nativeValue;
        bytes32 hookPermissionsHash;
        bytes32 configurationHash;
    }

    struct ComponentExpectationV1 {
        uint8 role;
        ComponentScopeV1 scope;
        address account;
        bytes32 runtimeCodeHash;
        bytes32 creationProvenanceHash;
        bytes32 ownershipBindingHash;
        bytes32 configurationHash;
    }

    struct NestedFactoryPlanV1 {
        uint16 schemaVersion;
        NestedFactoryActionV1 action;
        ComponentExpectationV1[] components;
        bytes32 componentGraphHash;
        bytes32 componentSetHash;
        bytes32 componentRuntimeSetHash;
        bytes32 expectedReturnedIdentitiesHash;
        bytes32 expectedArchitectureStateHash;
        bytes32 expectedPoolStateHash;
        bytes32 expectedRevenueStateHash;
        bytes32 expectedValueFlowHash;
    }

    struct NestedFactoryResultV1 {
        bytes32 providerExecutionId;
        bytes32 configurationHash;
        bytes32 componentSetHash;
        bytes32 componentRuntimeSetHash;
        bytes32 architectureStateHash;
        bytes32 poolStateHash;
        bytes32 supplyValueFlowHash;
        bytes32 returnedIdentitiesHash;
    }

    struct NestedPostconditionResultV1 {
        bytes32 architectureStateHash;
        bytes32 poolStateHash;
        bytes32 revenueStateHash;
        bytes32 valueFlowHash;
    }

    struct LaunchTransportV1 {
        IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1 currentness;
        bytes currentnessSignature;
        IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1 walletIntent;
        bytes walletSignature;
    }

    function launchNestedFactoryV1(
        bytes32 grantDigest,
        NestedFactoryPlanV1 calldata plan,
        LaunchTransportV1 calldata transport
    ) external payable returns (bytes32 receiptCoreHash);

    function computeNestedFactoryPlanHashV1(NestedFactoryPlanV1 calldata plan) external pure returns (bytes32);

    function nestedFactoryReservationsV1(NestedFactoryPlanV1 calldata plan)
        external
        pure
        returns (IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations);

    function computeNestedFactoryPreflightHashV1(NestedFactoryPlanV1 calldata plan) external view returns (bytes32);
}

interface IProgrammableNestedFactoryProviderV1 {
    function executeNestedFactoryV1(
        bytes32 executionKey,
        bytes32 grantDigest,
        bytes32 stampLaunchId,
        bytes32 antiReplayNonce,
        IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 calldata action,
        IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] calldata components
    ) external payable returns (IProgrammableNestedFactoryProfileV1.NestedFactoryResultV1 memory result);
}

interface IProgrammableNestedFactoryPostconditionVerifierV1 {
    function verifyNestedPreflightV1(
        address profile,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan
    ) external view returns (bytes32 profilePreflightReadbackHash);

    function verifyNestedPostconditionsV1(
        address profile,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan,
        IProgrammableNestedFactoryProfileV1.NestedFactoryResultV1 calldata result
    ) external view returns (IProgrammableNestedFactoryProfileV1.NestedPostconditionResultV1 memory postconditions);
}
