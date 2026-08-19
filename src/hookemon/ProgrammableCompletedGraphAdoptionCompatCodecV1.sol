// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCompletedGraphAdoptionCompatV1 } from "./IProgrammableCompletedGraphAdoptionCompatV1.sol";

/// @notice Pure canonical hash codec for the source-neutral adoption compatibility package.
/// @dev These hashes are deliberately not EIP-712 domain digests. The Registry applies its own EIP-712 domain to
///      `computeLaunchGrantStructHash` and `computeExecutionCurrentnessStructHash` before ERC-1271 verification.
contract ProgrammableCompletedGraphAdoptionCompatCodecV1 {
    uint256 public constant MAX_COMPONENTS = 24;
    uint256 public constant MAX_EDGES = 64;

    bytes32 public constant CODEC_ID_HASH = keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_COMPAT_CODEC_V1");
    bytes32 public constant ADOPTION_ONLY_READINESS_CONSTRAINT_HASH =
        keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_ONLY_NO_SOURCE_EXECUTION_V1");
    bytes32 public constant SOURCE_COMMIT_TYPEHASH =
        keccak256("ProgrammableCompletedGraphSourceCommitV1(bytes20 gitObjectId)");
    bytes32 public constant SOURCE_TREE_TYPEHASH =
        keccak256("ProgrammableCompletedGraphSourceTreeV1(bytes20 gitObjectId)");
    bytes32 public constant PROFILE_KEY_TYPEHASH =
        keccak256("ProgrammableCompletedGraphAdoptionProfileV1(bytes32 profileDescriptorHash,bytes32 routeSchemaHash)");
    bytes32 public constant PLAN_TYPEHASH =
        keccak256("ProgrammableCompletedGraphAdoptionPlanV1(bytes32 abiEncodedPlanHash)");
    bytes32 public constant LAUNCH_GRANT_BINDING_A_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphLaunchGrantBindingAV1(uint256 chainId,address registry,address launchWallet,bytes32 applicantIdHash,bytes32 profileKey,bytes32 profileDescriptorHash,bytes32 exactContractBindingHash,bytes32 contractPlanHash,bytes32 applicantPlanArtifactHash,bytes32 adoptionIntentHash,uint8 executionReadiness,bytes32 executionReadinessConstraintHash)"
    );
    bytes32 public constant LAUNCH_GRANT_BINDING_B_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphLaunchGrantBindingBV1(uint8 executionTimeConstraint,bytes32 executionTimeConstraintEvidenceHash,bytes32 sourceRepositoryHash,bytes32 sourceCommitHash,bytes32 sourceTreeHash,bytes32 sourceLaunchId,bytes32 componentGraphHash,bytes32 exactRuntimeSetHash,bytes32 componentConfigurationSetHash,bytes32 revenueBindingHash,bytes32 resultHash)"
    );
    bytes32 public constant LAUNCH_GRANT_REVIEW_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphLaunchGrantReviewV1(bytes32 builderEvidenceHash,bytes32 reviewerAttestationHash,bytes32 securityControlHeadHash,bytes32 securityEpochHash,bytes32 policyHash,bytes32 policyEpochHash,bytes32 reviewGenerationHash,uint64 securityEpoch,uint64 policyEpoch,uint64 reviewGeneration,bytes32 antiReplayNonce,bytes32 winnerKeyHash)"
    );
    bytes32 public constant LAUNCH_GRANT_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphLaunchGrantV1(bytes32 bindingAHash,bytes32 bindingBHash,bytes32 reviewHash)"
    );
    bytes32 public constant EXECUTION_CURRENTNESS_TYPEHASH =
        keccak256("ProgrammableCompletedGraphExecutionCurrentnessV1(bytes32 abiEncodedCurrentnessHash)");
    bytes32 public constant PREFLIGHT_QUERY_TYPEHASH =
        keccak256("ProgrammableCompletedGraphAdoptionPreflightQueryV1(bytes32 abiEncodedQueryHash)");
    bytes32 public constant PREFLIGHT_RUNTIME_CONTROL_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightRuntimeControlV1(uint256 chainId,address registry,bytes32 runtimeAuthorityBindingHash,uint16 liveRuntimeMask,bytes32 dependencyBehaviorEvidenceHash,bytes32 securityControlHeadHash,uint64 securityEpoch,bytes32 securityEpochHash,uint64 policyEpoch,bytes32 policyEpochHash,bytes32 reviewGenerationHash,uint64 reviewGeneration,bool globalAdoptionKilled)"
    );
    bytes32 public constant PREFLIGHT_LIFECYCLE_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightLifecycleV1(uint8 profileStatus,bytes32 profileCapabilityHash,bytes32 grantStateHeadHash,bytes32 winnerNonceOccupantGrantDigest,bytes32 winnerKeyOccupantGrantDigest,bool currentnessNonceUsed,uint8 receiptStatus,bytes32 receiptCoreHash,bytes32 finalityIndexingReceiptHash)"
    );
    bytes32 public constant PREFLIGHT_RESERVATION_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightReservationV1(bytes32 graphOccupantStampLaunchId,bytes32 exclusiveTokenOccupantStampLaunchId,bytes32 poolOccupantStampLaunchId)"
    );
    bytes32 public constant PREFLIGHT_COMPONENT_LEAF_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightComponentLeafV1(uint8 componentIndex,address component,uint8 componentScope,bytes32 expectedSharedIdentityHash,bytes32 expectedRuntimeCodeHash,bytes32 actualRuntimeCodeHash,bytes32 exclusiveComponentOccupantStampLaunchId,bytes32 sharedComponentIdentityHash)"
    );
    bytes32 public constant PREFLIGHT_GLOBAL_HEAD_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightGlobalHeadV1(bytes32 queryHash,bytes32 runtimeControlHash,bytes32 lifecycleHash,bytes32 reservationHash)"
    );
    bytes32 public constant PREFLIGHT_READBACK_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightReadbackV1(bytes32 globalReadbackHeadHash,bytes32 orderedComponentLeavesHash)"
    );
    bytes32 public constant ADOPTION_REQUEST_TYPEHASH =
        keccak256("ProgrammableCompletedGraphAdoptionRequestV1(bytes32 abiEncodedRequestHash)");
    bytes32 public constant PROFILE_CAPABILITY_TYPEHASH =
        keccak256("ProgrammableCompletedGraphAdoptionProfileCapabilityV1(bytes32 abiEncodedCapabilityHash)");
    bytes32 public constant STAMP_LAUNCH_ID_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionStampLaunchIdV1(uint256 chainId,address registry,address launchWallet,bytes32 profileKey,bytes32 contractPlanHash,bytes32 sourceLaunchId)"
    );
    bytes32 public constant WINNER_KEY_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionWinnerKeyV1(uint256 chainId,address registry,address launchWallet,bytes32 applicantIdHash,bytes32 profileKey,bytes32 profileDescriptorHash,bytes32 exactContractBindingHash,bytes32 sourceRepositoryHash,bytes32 sourceCommitHash,bytes32 sourceTreeHash,bytes32 sourceLaunchId,bytes32 contractPlanHash,bytes32 applicantPlanArtifactHash,bytes32 componentGraphHash,bytes32 adoptionIntentHash,uint64 securityEpoch,bytes32 securityEpochHash,uint64 policyEpoch,bytes32 policyEpochHash,uint64 reviewGeneration,bytes32 reviewGenerationHash)"
    );
    bytes32 public constant COMPONENT_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionComponentV1(address account,uint8 kind,uint8 scope,uint8 deploymentKind,address deployer,uint64 createNonce,bytes32 create2Salt,bytes32 initCodeHash,bytes32 creationReceiptEvidenceHash,bytes32 externalCanonicalIdHash,bytes32 runtimeCodeHash,bytes32 configurationHash,bytes32 creationEvidenceHash)"
    );
    bytes32 public constant COMPONENT_CONFIGURATION_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionComponentConfigurationV1(address account,uint8 kind,uint8 scope,uint8 deploymentKind,address deployer,uint64 createNonce,bytes32 create2Salt,bytes32 initCodeHash,bytes32 creationReceiptEvidenceHash,bytes32 externalCanonicalIdHash,bytes32 runtimeCodeHash)"
    );
    bytes32 public constant SHARED_COMPONENT_IDENTITY_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphSharedComponentIdentityV1(address account,uint8 kind,uint8 deploymentKind,address deployer,uint64 createNonce,bytes32 create2Salt,bytes32 initCodeHash,bytes32 creationReceiptEvidenceHash,bytes32 externalCanonicalIdHash,bytes32 runtimeCodeHash,bytes32 intrinsicConfigurationHash)"
    );
    bytes32 public constant COMPONENT_CREATION_EVIDENCE_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionCreationEvidenceV1(bytes32 sourceBindingHash,bytes32 componentBindingHash)"
    );
    bytes32 public constant COMPONENT_CREATION_EVIDENCE_SOURCE_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionCreationEvidenceSourceV1(uint256 chainId,address registry,bytes32 sourceRepositoryHash,bytes32 sourceCommitHash,bytes32 sourceTreeHash,bytes32 sourceLaunchId,bytes32 manifestHash,bytes32 policyHash,bytes32 applicantPlanArtifactHash,address launchWallet)"
    );
    bytes32 public constant COMPONENT_CREATION_EVIDENCE_COMPONENT_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionCreationEvidenceComponentV1(uint256 componentIndex,address account,uint8 kind,uint8 scope,uint8 deploymentKind,address deployer,uint64 createNonce,bytes32 create2Salt,bytes32 initCodeHash,bytes32 creationReceiptEvidenceHash,bytes32 externalCanonicalIdHash,bytes32 runtimeCodeHash)"
    );
    bytes32 public constant CREATION_RECEIPT_EVIDENCE_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphCreationReceiptEvidenceV1(bytes32 transactionHash,uint64 blockNumber,bytes32 blockHash,uint32 transactionIndex,address transactionSender,uint64 transactionSenderNonce,address transactionTo,uint256 transactionValueWei,bytes32 transactionInputHash,bool receiptSucceeded,address topLevelCreatedAddress,bytes32 internalCreationTraceHash,bytes32 finalityEvidenceHash,bytes32 dualProviderEvidenceHash)"
    );
    bytes32 public constant EDGE_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionEdgeV1(uint8 fromIndex,uint8 toIndex,uint8 kind,bytes32 relationHash)"
    );
    bytes32 public constant COMPONENT_GRAPH_TYPEHASH =
        keccak256("ProgrammableCompletedGraphAdoptionGraphV1(bytes32 componentsHash,bytes32 edgesHash)");
    bytes32 public constant RUNTIME_SET_TYPEHASH =
        keccak256("ProgrammableCompletedGraphAdoptionRuntimeSetV1(bytes32 orderedCommitmentsHash)");
    bytes32 public constant CONFIGURATION_SET_TYPEHASH =
        keccak256("ProgrammableCompletedGraphAdoptionConfigurationSetV1(bytes32 orderedCommitmentsHash)");
    bytes32 public constant CONFIGURATION_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionConfigurationV1(bytes32 componentGraphHash,bytes32 componentConfigurationSetHash,bytes32 policyHash,bytes32 revenueBindingHash,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 poolKeyHash,bytes32 architectureResultHash)"
    );
    bytes32 public constant RESULT_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionResultV1(bytes32 componentGraphHash,bytes32 configurationHash,bytes32 architectureResultHash,bytes32 poolResultHash,bytes32 deploymentLineageHash)"
    );
    bytes32 public constant APPLICATION_IDENTITY_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphApplicationIdentityV1(address account,bytes32 runtimeCodeHash,bytes32 configurationHash)"
    );
    bytes32 public constant CANONICAL_RECEIPT_CORE_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphCanonicalReceiptCoreV1(bytes32 stampLaunchId,bytes32 sourceLaunchId,bytes32 launchGrantDigest,bytes32 launchGrantHash,bytes32 executionCurrentnessDigest,bytes32 contractPlanHash,bytes32 profileCapabilityHash,bytes32 adoptionRequestHash)"
    );
    bytes32 public constant FINALITY_INDEXING_RECEIPT_TYPEHASH =
        keccak256("ProgrammableCompletedGraphFinalityIndexingReceiptV1(bytes32 abiEncodedReceiptWithoutHash)");

    /// @dev Static tuple used only to avoid compiler stack pressure. ABI encoding is the exact flat winner preimage.
    struct WinnerKeyDomainV1 {
        uint256 chainId;
        address registry;
        address launchWallet;
        bytes32 applicantIdHash;
        bytes32 profileKey;
        bytes32 profileDescriptorHash;
        bytes32 exactContractBindingHash;
        bytes32 sourceRepositoryHash;
        bytes32 sourceCommitHash;
        bytes32 sourceTreeHash;
        bytes32 sourceLaunchId;
        bytes32 contractPlanHash;
        bytes32 applicantPlanArtifactHash;
        bytes32 componentGraphHash;
        bytes32 adoptionIntentHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        uint64 reviewGeneration;
        bytes32 reviewGenerationHash;
    }

    struct LaunchGrantReviewDomainV1 {
        bytes32 builderEvidenceHash;
        bytes32 reviewerAttestationHash;
        bytes32 securityControlHeadHash;
        bytes32 securityEpochHash;
        bytes32 policyHash;
        bytes32 policyEpochHash;
        bytes32 reviewGenerationHash;
        uint64 securityEpoch;
        uint64 policyEpoch;
        uint64 reviewGeneration;
        bytes32 antiReplayNonce;
        bytes32 winnerKeyHash;
    }

    error InvalidGitObjectId();

    function computeSourceCommitHash(bytes20 gitObjectId) external pure returns (bytes32) {
        return _sourceCommitHash(gitObjectId);
    }

    function computeSourceTreeHash(bytes20 gitObjectId) external pure returns (bytes32) {
        return _sourceTreeHash(gitObjectId);
    }

    function sourceRevisionMatches(
        bytes20 sourceCommitId,
        bytes20 sourceTreeId,
        bytes32 sourceCommitHash,
        bytes32 sourceTreeHash
    ) external pure returns (bool) {
        return sourceCommitId != bytes20(0) && sourceTreeId != bytes20(0)
            && sourceCommitHash == _sourceCommitHash(sourceCommitId) && sourceTreeHash == _sourceTreeHash(sourceTreeId);
    }

    function computeProfileKey(bytes32 profileDescriptorHash, bytes32 routeSchemaHash) external pure returns (bytes32) {
        return keccak256(abi.encode(PROFILE_KEY_TYPEHASH, profileDescriptorHash, routeSchemaHash));
    }

    function computePlanHash(IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(PLAN_TYPEHASH, keccak256(abi.encode(plan))));
    }

    function computeLaunchGrantStructHash(IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 calldata grant)
        external
        pure
        returns (bytes32)
    {
        return _launchGrantHash(grant);
    }

    function computeLaunchGrantHash(IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 calldata grant)
        external
        pure
        returns (bytes32)
    {
        return _launchGrantHash(grant);
    }

    function computeAdoptionPreflightQueryHash(
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 calldata query
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(PREFLIGHT_QUERY_TYPEHASH, keccak256(abi.encode(query))));
    }

    function computeAdoptionPreflightReadbackHash(bytes32 globalReadbackHeadHash, bytes32 orderedComponentLeavesHash)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(PREFLIGHT_READBACK_TYPEHASH, globalReadbackHeadHash, orderedComponentLeavesHash));
    }

    function computeAdoptionPreflightComponentLeafHash(
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 calldata query,
        bytes32 actualRuntimeCodeHash,
        bytes32 exclusiveComponentOccupantStampLaunchId,
        bytes32 sharedComponentIdentityHash
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PREFLIGHT_COMPONENT_LEAF_TYPEHASH,
                query.componentIndex,
                query.component,
                query.componentScope,
                query.expectedSharedIdentityHash,
                query.expectedRuntimeCodeHash,
                actualRuntimeCodeHash,
                exclusiveComponentOccupantStampLaunchId,
                sharedComponentIdentityHash
            )
        );
    }

    function computeAdoptionPreflightGlobalHeadHash(
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 calldata readback
    ) external pure returns (bytes32) {
        bytes32 runtimeControlHash = keccak256(
            abi.encode(
                PREFLIGHT_RUNTIME_CONTROL_TYPEHASH,
                readback.chainId,
                readback.registry,
                readback.runtimeAuthorityBindingHash,
                readback.liveRuntimeMask,
                readback.dependencyBehaviorEvidenceHash,
                readback.securityControlHeadHash,
                readback.securityEpoch,
                readback.securityEpochHash,
                readback.policyEpoch,
                readback.policyEpochHash,
                readback.reviewControl.reviewGenerationHash,
                readback.reviewControl.reviewGeneration,
                readback.globalAdoptionKilled
            )
        );
        bytes32 lifecycleHash = keccak256(
            abi.encode(
                PREFLIGHT_LIFECYCLE_TYPEHASH,
                readback.profileStatus,
                readback.profileCapabilityHash,
                readback.grantStateHead.stateHeadHash,
                readback.winnerNonceOccupantGrantDigest,
                readback.winnerKeyOccupantGrantDigest,
                readback.currentnessNonceUsed,
                readback.receiptStatus,
                readback.receiptCoreHash,
                readback.finalityIndexingReceiptHash
            )
        );
        bytes32 reservationHash = keccak256(
            abi.encode(
                PREFLIGHT_RESERVATION_TYPEHASH,
                readback.graphOccupantStampLaunchId,
                readback.exclusiveTokenOccupantStampLaunchId,
                readback.poolOccupantStampLaunchId
            )
        );
        return keccak256(
            abi.encode(
                PREFLIGHT_GLOBAL_HEAD_TYPEHASH, readback.queryHash, runtimeControlHash, lifecycleHash, reservationHash
            )
        );
    }

    function computeExecutionCurrentnessStructHash(
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionCurrentnessV1 calldata currentness
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(EXECUTION_CURRENTNESS_TYPEHASH, keccak256(abi.encode(currentness))));
    }

    function computeAdoptionRequestHash(IProgrammableCompletedGraphAdoptionCompatV1.AdoptionRequestV1 calldata request)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(ADOPTION_REQUEST_TYPEHASH, keccak256(abi.encode(request))));
    }

    function computeAdoptionProfileCapabilityHash(
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(PROFILE_CAPABILITY_TYPEHASH, keccak256(abi.encode(capability))));
    }

    function computeStampLaunchId(
        address registry,
        address launchWallet,
        bytes32 profileKey,
        bytes32 contractPlanHash,
        bytes32 sourceLaunchId
    ) external view returns (bytes32) {
        return keccak256(
            abi.encode(
                STAMP_LAUNCH_ID_TYPEHASH,
                block.chainid,
                registry,
                launchWallet,
                profileKey,
                contractPlanHash,
                sourceLaunchId
            )
        );
    }

    /// @notice Canonical one-winner domain. The supplied `winnerKeyHash` is deliberately excluded from its preimage.
    function computeWinnerKeyHash(IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 calldata grant)
        external
        pure
        returns (bytes32)
    {
        return _winnerKeyHash(grant);
    }

    function computeComponentConfigurationHash(
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component
    ) external pure returns (bytes32) {
        return _componentConfigurationHash(component);
    }

    /// @notice Plan-independent canonical identity for a shared component account.
    /// @dev Deliberately excludes source/plan-bound creation evidence and the derived configuration hash.
    function computeSharedComponentIdentityHash(
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component
    ) external pure returns (bytes32) {
        return _sharedComponentIdentityHash(component);
    }

    function computeCreationReceiptEvidenceHash(
        IProgrammableCompletedGraphAdoptionCompatV1.CreationReceiptEvidenceV1 calldata evidence
    ) external pure returns (bytes32) {
        return _creationReceiptEvidenceHash(evidence);
    }

    function computeComponentCreationEvidenceHash(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan,
        uint256 componentIndex,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component
    ) external view returns (bytes32) {
        bytes32 sourceBindingHash = keccak256(
            abi.encode(
                COMPONENT_CREATION_EVIDENCE_SOURCE_TYPEHASH,
                block.chainid,
                registry,
                plan.sourceRepositoryHash,
                _sourceCommitHash(plan.sourceCommitId),
                _sourceTreeHash(plan.sourceTreeId),
                plan.sourceLaunchId,
                plan.manifestHash,
                plan.policyHash,
                plan.applicantPlanArtifactHash,
                plan.launchWallet
            )
        );
        bytes32 componentBindingHash = keccak256(
            abi.encode(
                COMPONENT_CREATION_EVIDENCE_COMPONENT_TYPEHASH,
                componentIndex,
                component.account,
                uint8(component.kind),
                uint8(component.scope),
                uint8(component.deploymentKind),
                component.deployer,
                component.createNonce,
                component.create2Salt,
                component.initCodeHash,
                _creationReceiptEvidenceHash(component.creationReceiptEvidence),
                component.externalCanonicalIdHash,
                component.runtimeCodeHash
            )
        );
        return keccak256(abi.encode(COMPONENT_CREATION_EVIDENCE_TYPEHASH, sourceBindingHash, componentBindingHash));
    }

    function computeComponentGraphHash(
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] calldata components,
        IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[] calldata edges
    ) external pure returns (bytes32) {
        bytes32[] memory componentHashes = new bytes32[](components.length);
        for (uint256 i; i < components.length; ++i) {
            componentHashes[i] = _componentHash(components[i]);
        }
        bytes32[] memory edgeHashes = new bytes32[](edges.length);
        for (uint256 i; i < edges.length; ++i) {
            IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1 calldata edge = edges[i];
            edgeHashes[i] =
                keccak256(abi.encode(EDGE_TYPEHASH, edge.fromIndex, edge.toIndex, uint8(edge.kind), edge.relationHash));
        }
        return keccak256(
            abi.encode(
                COMPONENT_GRAPH_TYPEHASH,
                keccak256(abi.encodePacked(componentHashes)),
                keccak256(abi.encodePacked(edgeHashes))
            )
        );
    }

    function computeExactRuntimeSetHash(IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] calldata components)
        external
        pure
        returns (bytes32 result)
    {
        result = keccak256(abi.encode(RUNTIME_SET_TYPEHASH));
        for (uint256 i; i < components.length; ++i) {
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component = components[i];
            result = keccak256(abi.encode(result, component.account, component.runtimeCodeHash));
        }
    }

    function computeComponentConfigurationSetHash(IProgrammableCompletedGraphAdoptionCompatV1
                .ComponentV1[] calldata components) external pure returns (bytes32 result) {
        result = keccak256(abi.encode(CONFIGURATION_SET_TYPEHASH));
        for (uint256 i; i < components.length; ++i) {
            result = keccak256(abi.encode(result, components[i].configurationHash));
        }
    }

    function computeConfigurationHash(
        bytes32 componentGraphHash,
        bytes32 componentConfigurationSetHash,
        bytes32 policyHash,
        bytes32 revenueBindingHash,
        address poolManager,
        bytes32 poolManagerRuntimeCodeHash,
        bytes32 poolKeyHash,
        bytes32 architectureResultHash
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CONFIGURATION_TYPEHASH,
                componentGraphHash,
                componentConfigurationSetHash,
                policyHash,
                revenueBindingHash,
                poolManager,
                poolManagerRuntimeCodeHash,
                poolKeyHash,
                architectureResultHash
            )
        );
    }

    function computeResultHash(
        bytes32 componentGraphHash,
        bytes32 configurationHash,
        bytes32 architectureResultHash,
        bytes32 poolResultHash,
        bytes32 deploymentLineageHash
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RESULT_TYPEHASH,
                componentGraphHash,
                configurationHash,
                architectureResultHash,
                poolResultHash,
                deploymentLineageHash
            )
        );
    }

    function computeApplicationIdentityHash(IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component)
        external
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                APPLICATION_IDENTITY_TYPEHASH, component.account, component.runtimeCodeHash, component.configurationHash
            )
        );
    }

    /// @notice Hashes the compact canonical receipt after forcing its self-hash field to zero.
    function computeCanonicalReceiptCoreHash(
        IProgrammableCompletedGraphAdoptionCompatV1.CanonicalReceiptCoreV1 calldata core
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CANONICAL_RECEIPT_CORE_TYPEHASH,
                core.stampLaunchId,
                core.sourceLaunchId,
                core.launchGrantDigest,
                core.launchGrantHash,
                core.executionCurrentnessDigest,
                core.contractPlanHash,
                core.profileCapabilityHash,
                core.adoptionRequestHash
            )
        );
    }

    /// @notice Hashes a finality/indexing append after forcing its self-hash field to zero.
    function computeFinalityIndexingReceiptHash(
        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 calldata receipt
    ) external pure returns (bytes32) {
        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 memory normalized = receipt;
        normalized.finalityIndexingReceiptHash = bytes32(0);
        return keccak256(abi.encode(FINALITY_INDEXING_RECEIPT_TYPEHASH, keccak256(abi.encode(normalized))));
    }

    function _componentConfigurationHash(IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                COMPONENT_CONFIGURATION_TYPEHASH,
                component.account,
                uint8(component.kind),
                uint8(component.scope),
                uint8(component.deploymentKind),
                component.deployer,
                component.createNonce,
                component.create2Salt,
                component.initCodeHash,
                _creationReceiptEvidenceHash(component.creationReceiptEvidence),
                component.externalCanonicalIdHash,
                component.runtimeCodeHash
            )
        );
    }

    function _componentHash(IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                COMPONENT_TYPEHASH,
                component.account,
                uint8(component.kind),
                uint8(component.scope),
                uint8(component.deploymentKind),
                component.deployer,
                component.createNonce,
                component.create2Salt,
                component.initCodeHash,
                _creationReceiptEvidenceHash(component.creationReceiptEvidence),
                component.externalCanonicalIdHash,
                component.runtimeCodeHash,
                component.configurationHash,
                component.creationEvidenceHash
            )
        );
    }

    function _sharedComponentIdentityHash(IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                SHARED_COMPONENT_IDENTITY_TYPEHASH,
                component.account,
                uint8(component.kind),
                uint8(component.deploymentKind),
                component.deployer,
                component.createNonce,
                component.create2Salt,
                component.initCodeHash,
                _creationReceiptEvidenceHash(component.creationReceiptEvidence),
                component.externalCanonicalIdHash,
                component.runtimeCodeHash,
                component.configurationHash
            )
        );
    }

    function _launchGrantHash(IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 calldata grant)
        private
        pure
        returns (bytes32)
    {
        bytes32 bindingAHash = keccak256(
            abi.encode(
                LAUNCH_GRANT_BINDING_A_TYPEHASH,
                grant.chainId,
                grant.registry,
                grant.launchWallet,
                grant.applicantIdHash,
                grant.profileKey,
                grant.profileDescriptorHash,
                grant.exactContractBindingHash,
                grant.contractPlanHash,
                grant.applicantPlanArtifactHash,
                grant.adoptionIntentHash,
                uint8(grant.executionReadiness),
                grant.executionReadinessConstraintHash
            )
        );
        bytes32 bindingBHash = keccak256(
            abi.encode(
                LAUNCH_GRANT_BINDING_B_TYPEHASH,
                uint8(grant.executionTimeConstraint),
                grant.executionTimeConstraintEvidenceHash,
                grant.sourceRepositoryHash,
                grant.sourceCommitHash,
                grant.sourceTreeHash,
                grant.sourceLaunchId,
                grant.componentGraphHash,
                grant.exactRuntimeSetHash,
                grant.componentConfigurationSetHash,
                grant.revenueBindingHash,
                grant.resultHash
            )
        );
        LaunchGrantReviewDomainV1 memory review;
        review.builderEvidenceHash = grant.builderEvidenceHash;
        review.reviewerAttestationHash = grant.reviewerAttestationHash;
        review.securityControlHeadHash = grant.securityControlHeadHash;
        review.securityEpochHash = grant.securityEpochHash;
        review.policyHash = grant.policyHash;
        review.policyEpochHash = grant.policyEpochHash;
        review.reviewGenerationHash = grant.reviewControl.reviewGenerationHash;
        review.securityEpoch = grant.securityEpoch;
        review.policyEpoch = grant.policyEpoch;
        review.reviewGeneration = grant.reviewControl.reviewGeneration;
        review.antiReplayNonce = grant.antiReplayNonce;
        review.winnerKeyHash = grant.winnerKeyHash;
        bytes32 reviewHash = keccak256(abi.encode(LAUNCH_GRANT_REVIEW_TYPEHASH, review));
        return keccak256(abi.encode(LAUNCH_GRANT_TYPEHASH, bindingAHash, bindingBHash, reviewHash));
    }

    function _winnerKeyHash(IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 calldata grant)
        private
        pure
        returns (bytes32)
    {
        WinnerKeyDomainV1 memory domain;
        domain.chainId = grant.chainId;
        domain.registry = grant.registry;
        domain.launchWallet = grant.launchWallet;
        domain.applicantIdHash = grant.applicantIdHash;
        domain.profileKey = grant.profileKey;
        domain.profileDescriptorHash = grant.profileDescriptorHash;
        domain.exactContractBindingHash = grant.exactContractBindingHash;
        domain.sourceRepositoryHash = grant.sourceRepositoryHash;
        domain.sourceCommitHash = grant.sourceCommitHash;
        domain.sourceTreeHash = grant.sourceTreeHash;
        domain.sourceLaunchId = grant.sourceLaunchId;
        domain.contractPlanHash = grant.contractPlanHash;
        domain.applicantPlanArtifactHash = grant.applicantPlanArtifactHash;
        domain.componentGraphHash = grant.componentGraphHash;
        domain.adoptionIntentHash = grant.adoptionIntentHash;
        domain.securityEpoch = grant.securityEpoch;
        domain.securityEpochHash = grant.securityEpochHash;
        domain.policyEpoch = grant.policyEpoch;
        domain.policyEpochHash = grant.policyEpochHash;
        domain.reviewGeneration = grant.reviewControl.reviewGeneration;
        domain.reviewGenerationHash = grant.reviewControl.reviewGenerationHash;
        return keccak256(abi.encode(WINNER_KEY_TYPEHASH, domain));
    }

    function _creationReceiptEvidenceHash(
        IProgrammableCompletedGraphAdoptionCompatV1.CreationReceiptEvidenceV1 calldata evidence
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(CREATION_RECEIPT_EVIDENCE_TYPEHASH, evidence));
    }

    function _sourceCommitHash(bytes20 gitObjectId) private pure returns (bytes32) {
        if (gitObjectId == bytes20(0)) revert InvalidGitObjectId();
        return keccak256(abi.encode(SOURCE_COMMIT_TYPEHASH, gitObjectId));
    }

    function _sourceTreeHash(bytes20 gitObjectId) private pure returns (bytes32) {
        if (gitObjectId == bytes20(0)) revert InvalidGitObjectId();
        return keccak256(abi.encode(SOURCE_TREE_TYPEHASH, gitObjectId));
    }
}
