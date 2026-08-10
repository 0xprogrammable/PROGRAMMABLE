// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Source-neutral, adoption-only compatibility ABI for completed immutable component graphs.
/// @dev This ABI deliberately has no deployment, target, selector, opaque action-data, delegatecall, transfer,
///      approval, allowance, or payable execution surface. A future architecture-specific module must consume this
///      typed provenance interface; it is not a Hookemon approval or a Hookemon execution module.
interface IProgrammableCompletedGraphAdoptionCompatV1 {
    enum GrantStatusV1 {
        None,
        Active,
        Revoked,
        Consumed
    }

    enum ReceiptStatusV1 {
        None,
        Prepared,
        Adopted,
        Finalized,
        Indexed,
        Published
    }

    enum CapabilitySemanticsV1 {
        Invalid,
        Adopt
    }

    enum AdmissionStatusV1 {
        Invalid,
        DenyPendingReviewAndDeploymentEvidence,
        Admitted
    }

    enum ProfileStatusV1 {
        Invalid,
        Active,
        Suspended,
        Deprecated
    }

    enum ExecutionTimeConstraintV1 {
        Invalid,
        AdoptionOnlyNoExecution,
        ExternalExecutionTimeBound
    }

    /// @notice Readiness of this compatibility ABI. It never authorizes source execution.
    /// @dev Any source execution deadline is recorded separately below. Re-anchoring that source execution creates
    ///      a different plan and requires a fresh review and grant; this ABI has no execution entry point.
    enum ExecutionReadinessV1 {
        Invalid,
        CompletedGraphAdoptionOnly,
        DenyPendingReviewAndDeploymentEvidence
    }

    enum LaunchClassificationV1 {
        Invalid,
        CompletedGraphAdoption,
        OptionalComponentGraphAdoption
    }

    enum ComponentKindV1 {
        Invalid,
        Token,
        Hook,
        Nft,
        Application,
        Factory,
        Auxiliary
    }

    enum ComponentScopeV1 {
        Invalid,
        Exclusive,
        SharedInfrastructure
    }

    enum DeploymentKindV1 {
        Invalid,
        Create,
        Create2,
        ExternalCanonical
    }

    enum EdgeKindV1 {
        Invalid,
        References,
        Controls,
        Uses,
        Renders,
        Mints,
        Configures,
        PoolBinds
    }

    struct PrimaryIdentitiesV1 {
        address token;
        address hook;
        address nft;
        bytes32 applicationHash;
    }

    /// @notice Finalized top-level CREATE transaction evidence. This package does not execute CREATE.
    /// @dev `to` is required to be zero and `inputHash` must equal the component init-code hash. The reviewer
    ///      attestation binds the finalized dual-provider evidence; the Validator derives the created address.
    struct CreateTransactionEvidenceV1 {
        bytes32 transactionHash;
        uint64 blockNumber;
        bytes32 blockHash;
        uint32 transactionIndex;
        address sender;
        uint64 senderNonce;
        address to;
        uint256 valueWei;
        bytes32 inputHash;
        bool receiptSucceeded;
        address createdAddress;
        bytes32 finalityEvidenceHash;
        bytes32 dualProviderEvidenceHash;
    }

    /// @dev Every component has exact CREATE/CREATE2 provenance and an observed runtime/config commitment.
    struct ComponentV1 {
        address account;
        ComponentKindV1 kind;
        ComponentScopeV1 scope;
        DeploymentKindV1 deploymentKind;
        address deployer;
        uint64 createNonce;
        bytes32 create2Salt;
        bytes32 initCodeHash;
        CreateTransactionEvidenceV1 createTransactionEvidence;
        bytes32 externalCanonicalIdHash;
        bytes32 runtimeCodeHash;
        bytes32 configurationHash;
        bytes32 creationEvidenceHash;
    }

    struct GraphEdgeV1 {
        uint8 fromIndex;
        uint8 toIndex;
        EdgeKindV1 kind;
        bytes32 relationHash;
    }

    /// @notice Immutable applicant plan. No executable calldata is representable.
    struct CompletedGraphPlanV1 {
        bytes32 profileKey;
        bytes32 profileDescriptorHash;
        bytes32 exactContractBindingHash;
        bytes32 routeSchemaHash;
        bytes32 planSchemaArtifactHash;
        bytes32 sourceRepositoryHash;
        bytes32 sourceCommitHash;
        bytes32 sourceTreeHash;
        bytes32 manifestHash;
        bytes32 policyHash;
        /// @dev V1 has no revenue activation path; this must be zero until a separately frozen profile version exists.
        bytes32 revenueBindingHash;
        bytes32 compilerArtifactHash;
        bytes32 applicantPlanArtifactHash;
        bytes32 adoptionIntentHash;
        ExecutionReadinessV1 executionReadiness;
        bytes32 executionReadinessConstraintHash;
        ExecutionTimeConstraintV1 executionTimeConstraint;
        bytes32 executionTimeConstraintEvidenceHash;
        address launchWallet;
        LaunchClassificationV1 launchClassification;
        uint16 identityMask;
        PrimaryIdentitiesV1 identities;
        bytes32 componentGraphHash;
        bytes32 exactRuntimeSetHash;
        bytes32 componentConfigurationSetHash;
        bytes32 configurationHash;
        address poolManager;
        bytes32 poolManagerRuntimeCodeHash;
        uint8 poolManagerComponentIndex;
        bytes32 poolId;
        bytes32 poolKeyHash;
        bytes32 poolResultHash;
        bytes32 architectureResultHash;
        bytes32 deploymentLineageHash;
        bytes32 resultHash;
    }

    /// @notice Evergreen reviewed authority. No expiry field exists; revocation and epochs control currentness.
    struct LaunchGrantV1 {
        /// @dev `grantHash` is the codec's canonical binding/review hash; `grantDigest` is the Registry EIP-712 digest.
        ///      Neither field is included in the preimage, so the reviewer can compute then populate both values.
        bytes32 grantHash;
        bytes32 grantDigest;
        uint256 chainId;
        address registry;
        address launchWallet;
        bytes32 applicantIdHash;
        bytes32 profileKey;
        bytes32 profileDescriptorHash;
        bytes32 exactContractBindingHash;
        bytes32 contractPlanHash;
        bytes32 applicantPlanArtifactHash;
        bytes32 adoptionIntentHash;
        ExecutionReadinessV1 executionReadiness;
        bytes32 executionReadinessConstraintHash;
        ExecutionTimeConstraintV1 executionTimeConstraint;
        bytes32 executionTimeConstraintEvidenceHash;
        bytes32 sourceRepositoryHash;
        bytes32 sourceCommitHash;
        bytes32 sourceTreeHash;
        bytes32 componentGraphHash;
        bytes32 exactRuntimeSetHash;
        bytes32 componentConfigurationSetHash;
        bytes32 revenueBindingHash;
        bytes32 resultHash;
        bytes32 builderEvidenceHash;
        bytes32 reviewerAttestationHash;
        bytes32 securityControlHeadHash;
        bytes32 securityEpochHash;
        bytes32 policyHash;
        bytes32 policyEpochHash;
        uint64 securityEpoch;
        uint64 policyEpoch;
        bytes32 oneWinnerNonce;
        bytes32 winnerKeyHash;
    }

    struct LaunchGrantStateHeadV1 {
        bytes32 grantDigest;
        bytes32 grantHash;
        bytes32 stateHeadHash;
        bytes32 launchId;
        GrantStatusV1 status;
    }

    /// @notice Short-lived execution-currentness transport; it cannot authorize an applicant without LaunchGrantV1.
    struct ExecutionCurrentnessV1 {
        uint256 chainId;
        address registry;
        address launchWallet;
        bytes32 launchGrantDigest;
        bytes32 contractPlanHash;
        bytes32 receiptRequestHash;
        bytes32 expectedResultHash;
        bytes32 adoptionIntentHash;
        bytes32 securityControlHeadHash;
        bytes32 securityEpochHash;
        bytes32 policyEpochHash;
        uint64 securityEpoch;
        uint64 policyEpoch;
        bytes32 nonce;
        uint64 validAfter;
        uint64 deadline;
    }

    struct AdoptionRequestV1 {
        bytes32 launchId;
        bytes32 profileKey;
        bytes32 componentGraphHash;
        bytes32 resultHash;
        bytes32 currentArchitectureStateHash;
        bytes32 currentPoolStateHash;
        bytes32 currentRevenueStateHash;
    }

    /// @notice Closed typed adoption envelope. The only bytes field is the bounded ERC-1271 currentness signature.
    struct CompletedGraphAdoptionV1 {
        LaunchGrantV1 grant;
        CompletedGraphPlanV1 plan;
        AdoptionRequestV1 request;
        ComponentV1[] components;
        GraphEdgeV1[] edges;
        ExecutionCurrentnessV1 currentness;
        bytes currentnessSignature;
    }

    /// @notice Governance-registered reusable adoption capability. `module` is intentionally absent.
    struct AdoptionProfileCapabilityV1 {
        bytes32 profileKey;
        bytes32 profileDescriptorHash;
        bytes32 exactContractBindingHash;
        bytes32 routeSchemaHash;
        bytes32 planSchemaArtifactHash;
        bytes32 policyHash;
        address stateVerifier;
        bytes32 stateVerifierRuntimeCodeHash;
        bytes32 stateSchemaHash;
        uint256 canonicalPoolManagerChainId;
        address canonicalPoolManager;
        bytes32 canonicalPoolManagerRuntimeCodeHash;
        CapabilitySemanticsV1 capabilitySemantics;
        AdmissionStatusV1 admissionStatus;
        LaunchClassificationV1 launchClassification;
        ExecutionReadinessV1 executionReadiness;
        bytes32 executionReadinessConstraintHash;
        ExecutionTimeConstraintV1 executionTimeConstraint;
        bytes32 executionTimeConstraintEvidenceHash;
        uint16 requiredIdentityMask;
        uint16 forbiddenIdentityMask;
        bool enabled;
    }

    /// @notice Canonical immutable receipt identity after a grant is consumed by typed adoption.
    /// @dev The compact onchain core hash-binds the complete typed Plan, Grant, registered capability and
    ///      current-state request. Each of those inputs has its own closed codec preimage, so a mutable URL or
    ///      indexer append can never rewrite launch identity.
    struct CanonicalReceiptCoreV1 {
        bytes32 launchId;
        bytes32 receiptCoreHash;
        bytes32 launchGrantDigest;
        bytes32 launchGrantHash;
        bytes32 executionCurrentnessDigest;
        bytes32 contractPlanHash;
        bytes32 profileCapabilityHash;
        bytes32 adoptionRequestHash;
    }

    struct FinalityIndexingReceiptV1 {
        bytes32 launchId;
        bytes32 receiptCoreHash;
        bytes32 launchGrantDigest;
        ReceiptStatusV1 nextStatus;
        bytes32 previousFinalityIndexingReceiptHash;
        bytes32 finalityIndexingReceiptHash;
        bytes32 evidenceHash;
    }

    event AdoptionProfileRegisteredV1(bytes32 indexed profileKey, bytes32 profileDescriptorHash, bytes32 policyHash);
    event AdoptionProfileStatusUpdatedV1(bytes32 indexed profileKey, ProfileStatusV1 indexed status);
    event GlobalAdoptionKillSetV1(bool indexed killed);
    event LaunchGrantActivatedV1(
        bytes32 indexed launchId,
        bytes32 indexed launchGrantDigest,
        address indexed launchWallet,
        bytes32 oneWinnerNonce,
        bytes32 winnerKeyHash
    );
    event LaunchGrantRevokedV1(bytes32 indexed launchId, bytes32 indexed launchGrantDigest);
    event LaunchGrantConsumedV1(bytes32 indexed launchId, bytes32 indexed launchGrantDigest);
    event ExecutionCurrentnessRevokedV1(bytes32 indexed executionCurrentnessDigest);
    event SecurityPolicyEpochsAdvancedV1(
        bytes32 indexed securityControlHeadHash,
        uint64 securityEpoch,
        bytes32 securityEpochHash,
        uint64 policyEpoch,
        bytes32 policyEpochHash
    );
    event CanonicalReceiptAdoptedV1(bytes32 indexed launchId, bytes32 indexed receiptCoreHash, bytes32 grantDigest);
    event CanonicalComponentRecordedV1(
        bytes32 indexed launchId,
        uint8 indexed componentIndex,
        address indexed account,
        ComponentKindV1 kind,
        ComponentScopeV1 scope,
        DeploymentKindV1 deploymentKind,
        bytes32 runtimeCodeHash,
        bytes32 configurationHash,
        bytes32 creationEvidenceHash
    );
    event FinalityIndexingAdvancedV1(
        bytes32 indexed launchId,
        ReceiptStatusV1 indexed status,
        bytes32 indexed finalityIndexingReceiptHash,
        bytes32 evidenceHash
    );

    function registerAdoptionProfileV1(AdoptionProfileCapabilityV1 calldata capability) external;

    function setAdoptionProfileStatusV1(bytes32 profileKey, ProfileStatusV1 status) external;

    function setGlobalAdoptionKillV1(bool killed) external;

    function activateLaunchGrantV1(LaunchGrantV1 calldata grant, bytes calldata reviewerSignature)
        external
        returns (bytes32 digest);

    function revokeLaunchGrantV1(bytes32 grantDigest) external;

    /// @notice Revokes an otherwise-valid short-lived currentness transport before its deadline.
    function revokeExecutionCurrentnessV1(bytes32 currentnessDigest) external;

    function advanceSecurityPolicyEpochsV1(
        bytes32 securityControlHeadHash,
        uint64 securityEpoch,
        bytes32 securityEpochHash,
        uint64 policyEpoch,
        bytes32 policyEpochHash
    ) external;

    function adoptCompletedGraphV1(CompletedGraphAdoptionV1 calldata adoption)
        external
        returns (bytes32 receiptCoreHash);

    function advanceFinalityIndexingV1(FinalityIndexingReceiptV1 calldata receipt) external;

    function launchGrantDigest(LaunchGrantV1 calldata grant) external view returns (bytes32);

    function executionCurrentnessDigest(ExecutionCurrentnessV1 calldata currentness) external view returns (bytes32);

    function launchGrantStatus(bytes32 grantDigest) external view returns (GrantStatusV1);

    function adoptionProfileStatusV1(bytes32 profileKey) external view returns (ProfileStatusV1);

    function globalAdoptionKilledV1() external view returns (bool);

    function executionCurrentnessRevokedV1(bytes32 currentnessDigest) external view returns (bool);

    function currentSecurityPolicyEpochs()
        external
        view
        returns (
            bytes32 securityControlHeadHash,
            uint64 securityEpoch,
            bytes32 securityEpochHash,
            uint64 policyEpoch,
            bytes32 policyEpochHash
        );

    function launchGrantStateHead(bytes32 grantDigest) external view returns (LaunchGrantStateHeadV1 memory);

    function receiptStatus(bytes32 launchId) external view returns (ReceiptStatusV1);

    function canonicalReceiptCore(bytes32 launchId) external view returns (CanonicalReceiptCoreV1 memory);

    function finalityIndexingReceiptHash(bytes32 launchId) external view returns (bytes32);
}

/// @notice Fixed typed current-state verifier for one governance-registered ADOPT capability.
/// @dev The Registry/Validator pin this dependency's runtime code hash. No target, selector or opaque action bytes
///      are accepted from an applicant, and the return must be exactly three words.
interface IProgrammableCompletedGraphAdoptionStateVerifierV1 {
    function verifyCurrentStateV1(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability,
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] calldata components,
        IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[] calldata edges,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionRequestV1 calldata request
    ) external view returns (bytes32 architectureStateHash, bytes32 poolStateHash, bytes32 revenueStateHash);
}
