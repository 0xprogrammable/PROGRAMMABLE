// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableCompletedGraphAdoptionCompatV1,
    IProgrammableCompletedGraphAdoptionStateVerifierV1
} from "programmable-src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol";

/// @notice Stateless current-runtime verifier for the source-neutral completed-graph adoption profile.
/// @dev This verifier never executes an applicant graph and deliberately supports no pool or revenue state. The
///      Registry's codehash-pinned Validator independently proves the typed provenance and plan commitments; this
///      contract binds those commitments to the current ordered component runtimes and graph edges.
contract ProgrammableCompletedGraphRuntimeStateVerifierV1 is IProgrammableCompletedGraphAdoptionStateVerifierV1 {
    uint16 public constant IDENTITY_APPLICATION = 1 << 3;
    uint16 public constant IDENTITY_POOL = 1 << 4;

    bytes32 public constant PROFILE_DESCRIPTOR_HASH = keccak256("PROGRAMMABLE_COMPLETED_GRAPH_RUNTIME_PROFILE_V1");
    bytes32 public constant ROUTE_SCHEMA_HASH = keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_ROUTE_SCHEMA_V1");
    bytes32 public constant PLAN_SCHEMA_ARTIFACT_HASH =
        keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_PLAN_SCHEMA_ARTIFACT_V1");
    bytes32 public constant POLICY_HASH =
        keccak256("PROGRAMMABLE_COMPLETED_GRAPH_RUNTIME_ONLY_NO_POOL_NO_REVENUE_POLICY_V1");
    bytes32 public constant STATE_SCHEMA_HASH =
        keccak256("ProgrammableCompletedGraphRuntimeStateV1(bytes32 contextHash,bytes32 liveStateHash)");
    bytes32 public constant STATE_CONTEXT_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphRuntimeStateContextV1(uint256 chainId,address registry,bytes32 profileKey,bytes32 exactContractBindingHash,bytes32 planStateHash)"
    );
    bytes32 public constant LIVE_STATE_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphRuntimeLiveStateV1(bytes32 orderedRuntimeStateHash,bytes32 orderedEdgeStateHash,uint256 componentCount,uint256 edgeCount)"
    );
    bytes32 public constant PLAN_STATE_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphPlanStateV1(bytes32 componentGraphHash,bytes32 exactRuntimeSetHash,bytes32 componentConfigurationSetHash,bytes32 configurationHash,bytes32 architectureResultHash,bytes32 deploymentLineageHash)"
    );
    bytes32 public constant STATE_VERIFIER_BEHAVIOR_EVIDENCE_HASH =
        keccak256("PROGRAMMABLE_COMPLETED_GRAPH_RUNTIME_STATE_VERIFIER_REVIEWED_BEHAVIOR_V1");
    bytes32 public constant EXACT_CONTRACT_BINDING_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphRuntimeExactBindingV1(uint256 chainId,address registry,bytes32 registryRuntimeCodeHash,address stateVerifier,bytes32 stateVerifierRuntimeCodeHash,bytes32 profileDescriptorHash,bytes32 routeSchemaHash,bytes32 planSchemaArtifactHash,bytes32 policyHash,bytes32 stateSchemaHash,bytes32 behaviorEvidenceHash)"
    );
    bytes32 public constant RUNTIME_STATE_HEAD_TYPEHASH =
        keccak256("ProgrammableCompletedGraphRuntimeStateHeadV1(uint256 componentCount)");
    bytes32 public constant RUNTIME_STATE_LEAF_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphRuntimeStateLeafV1(uint256 index,address account,uint8 kind,uint8 scope,bytes32 expectedRuntimeCodeHash,bytes32 actualRuntimeCodeHash,bytes32 configurationHash)"
    );
    bytes32 public constant RUNTIME_STATE_STEP_TYPEHASH =
        keccak256("ProgrammableCompletedGraphRuntimeStateStepV1(bytes32 priorHead,bytes32 leafHash)");
    bytes32 public constant EDGE_STATE_HEAD_TYPEHASH =
        keccak256("ProgrammableCompletedGraphEdgeStateHeadV1(uint256 edgeCount)");
    bytes32 public constant EDGE_STATE_LEAF_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphEdgeStateLeafV1(uint256 index,uint8 fromIndex,uint8 toIndex,uint8 kind,bytes32 relationHash)"
    );
    bytes32 public constant EDGE_STATE_STEP_TYPEHASH =
        keccak256("ProgrammableCompletedGraphEdgeStateStepV1(bytes32 priorHead,bytes32 leafHash)");

    struct StateComputationV1 {
        bytes32 planStateHash;
        bytes32 runtimeStateHash;
        bytes32 edgeStateHash;
        bytes32 contextHash;
        bytes32 liveStateHash;
    }

    error InvalidBinding(uint8 field);

    function exactContractBindingHashV1(address registry) public view returns (bytes32) {
        if (registry.code.length == 0) revert InvalidBinding(1);
        return keccak256(
            abi.encode(
                EXACT_CONTRACT_BINDING_TYPEHASH,
                block.chainid,
                registry,
                registry.codehash,
                address(this),
                address(this).codehash,
                PROFILE_DESCRIPTOR_HASH,
                ROUTE_SCHEMA_HASH,
                PLAN_SCHEMA_ARTIFACT_HASH,
                POLICY_HASH,
                STATE_SCHEMA_HASH,
                STATE_VERIFIER_BEHAVIOR_EVIDENCE_HASH
            )
        );
    }

    function verifyCurrentStateV1(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability,
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] calldata components,
        IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[] calldata edges,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionRequestV1 calldata request
    ) external view returns (bytes32 architectureStateHash, bytes32 poolStateHash, bytes32 revenueStateHash) {
        _requireCapability(registry, capability);
        _requirePlan(capability, plan, request);

        StateComputationV1 memory state;
        state.planStateHash = _planStateHash(plan);
        state.runtimeStateHash = _runtimeStateHash(components);
        state.edgeStateHash = _edgeStateHash(edges);
        state.contextHash =
            _contextHash(registry, capability.profileKey, capability.exactContractBindingHash, state.planStateHash);
        state.liveStateHash =
            _liveStateHash(state.runtimeStateHash, state.edgeStateHash, components.length, edges.length);
        architectureStateHash = keccak256(abi.encode(STATE_SCHEMA_HASH, state.contextHash, state.liveStateHash));
        poolStateHash = bytes32(0);
        revenueStateHash = bytes32(0);
    }

    function _runtimeStateHash(IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] calldata components)
        private
        view
        returns (bytes32 runtimeStateHash)
    {
        runtimeStateHash = keccak256(abi.encode(RUNTIME_STATE_HEAD_TYPEHASH, components.length));
        for (uint256 i; i < components.length; ++i) {
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component = components[i];
            bytes32 actualRuntimeCodeHash = component.account.codehash;
            if (
                component.account == address(0) || component.account.code.length == 0
                    || component.runtimeCodeHash == bytes32(0) || actualRuntimeCodeHash != component.runtimeCodeHash
                    || component.configurationHash == bytes32(0)
            ) revert InvalidBinding(4);
            bytes32 leafHash = keccak256(
                abi.encode(
                    RUNTIME_STATE_LEAF_TYPEHASH,
                    i,
                    component.account,
                    uint8(component.kind),
                    uint8(component.scope),
                    component.runtimeCodeHash,
                    actualRuntimeCodeHash,
                    component.configurationHash
                )
            );
            runtimeStateHash = keccak256(abi.encode(RUNTIME_STATE_STEP_TYPEHASH, runtimeStateHash, leafHash));
        }
    }

    function _edgeStateHash(IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[] calldata edges)
        private
        pure
        returns (bytes32 edgeStateHash)
    {
        edgeStateHash = keccak256(abi.encode(EDGE_STATE_HEAD_TYPEHASH, edges.length));
        for (uint256 i; i < edges.length; ++i) {
            IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1 calldata edge = edges[i];
            if (edge.relationHash == bytes32(0)) revert InvalidBinding(5);
            bytes32 leafHash = keccak256(
                abi.encode(
                    EDGE_STATE_LEAF_TYPEHASH, i, edge.fromIndex, edge.toIndex, uint8(edge.kind), edge.relationHash
                )
            );
            edgeStateHash = keccak256(abi.encode(EDGE_STATE_STEP_TYPEHASH, edgeStateHash, leafHash));
        }
    }

    function _contextHash(address registry, bytes32 profileKey, bytes32 exactContractBindingHash, bytes32 planStateHash)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                STATE_CONTEXT_TYPEHASH, block.chainid, registry, profileKey, exactContractBindingHash, planStateHash
            )
        );
    }

    function _liveStateHash(bytes32 runtimeStateHash, bytes32 edgeStateHash, uint256 componentCount, uint256 edgeCount)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(LIVE_STATE_TYPEHASH, runtimeStateHash, edgeStateHash, componentCount, edgeCount));
    }

    function _planStateHash(IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                PLAN_STATE_TYPEHASH,
                plan.componentGraphHash,
                plan.exactRuntimeSetHash,
                plan.componentConfigurationSetHash,
                plan.configurationHash,
                plan.architectureResultHash,
                plan.deploymentLineageHash
            )
        );
    }

    function _requireCapability(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability
    ) private view {
        if (
            capability.profileDescriptorHash != PROFILE_DESCRIPTOR_HASH
                || capability.routeSchemaHash != ROUTE_SCHEMA_HASH
                || capability.planSchemaArtifactHash != PLAN_SCHEMA_ARTIFACT_HASH
                || capability.policyHash != POLICY_HASH
                || capability.exactContractBindingHash != exactContractBindingHashV1(registry)
                || capability.stateVerifierBinding.stateVerifier != address(this)
                || capability.stateVerifierBinding.stateVerifierRuntimeCodeHash != address(this).codehash
                || capability.stateVerifierBinding.stateSchemaHash != STATE_SCHEMA_HASH
                || capability.stateVerifierBinding.stateVerifierBehaviorEvidenceHash
                    != STATE_VERIFIER_BEHAVIOR_EVIDENCE_HASH
        ) {
            revert InvalidBinding(2);
        }
        if (
            capability.canonicalPoolManagerChainId != 0 || capability.canonicalPoolManager != address(0)
                || capability.canonicalPoolManagerRuntimeCodeHash != bytes32(0)
                || capability.capabilitySemantics
                    != IProgrammableCompletedGraphAdoptionCompatV1.CapabilitySemanticsV1.Adopt
                || capability.admissionStatus != IProgrammableCompletedGraphAdoptionCompatV1.AdmissionStatusV1.Admitted
                || capability.launchClassification
                    != IProgrammableCompletedGraphAdoptionCompatV1.LaunchClassificationV1.CompletedGraphAdoption
                || capability.executionReadiness
                    != IProgrammableCompletedGraphAdoptionCompatV1.ExecutionReadinessV1.CompletedGraphAdoptionOnly
                || capability.executionTimeConstraint
                    != IProgrammableCompletedGraphAdoptionCompatV1.ExecutionTimeConstraintV1.AdoptionOnlyNoExecution
                || capability.executionTimeConstraintEvidenceHash != bytes32(0)
                || capability.requiredIdentityMask != IDENTITY_APPLICATION
                || capability.forbiddenIdentityMask != IDENTITY_POOL || !capability.enabled
        ) revert InvalidBinding(2);
    }

    function _requirePlan(
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability,
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionRequestV1 calldata request
    ) private pure {
        if (
            plan.profileKey != capability.profileKey || plan.profileDescriptorHash != PROFILE_DESCRIPTOR_HASH
                || plan.exactContractBindingHash != capability.exactContractBindingHash
                || plan.routeSchemaHash != ROUTE_SCHEMA_HASH || plan.planSchemaArtifactHash != PLAN_SCHEMA_ARTIFACT_HASH
                || plan.policyHash != POLICY_HASH || plan.revenueBindingHash != bytes32(0)
                || plan.executionReadiness
                    != IProgrammableCompletedGraphAdoptionCompatV1.ExecutionReadinessV1.CompletedGraphAdoptionOnly
                || plan.executionTimeConstraint
                    != IProgrammableCompletedGraphAdoptionCompatV1.ExecutionTimeConstraintV1.AdoptionOnlyNoExecution
                || plan.executionTimeConstraintEvidenceHash != bytes32(0)
                || plan.launchClassification
                    != IProgrammableCompletedGraphAdoptionCompatV1.LaunchClassificationV1.CompletedGraphAdoption
                || (plan.identityMask & IDENTITY_APPLICATION) == 0 || (plan.identityMask & IDENTITY_POOL) != 0
                || plan.poolManager != address(0) || plan.poolManagerRuntimeCodeHash != bytes32(0)
                || plan.poolId != bytes32(0) || plan.poolKeyHash != bytes32(0) || plan.poolResultHash != bytes32(0)
                || request.profileKey != plan.profileKey || request.componentGraphHash != plan.componentGraphHash
                || request.resultHash != plan.resultHash || request.currentPoolStateHash != bytes32(0)
                || request.currentRevenueStateHash != bytes32(0)
        ) revert InvalidBinding(3);
    }
}
