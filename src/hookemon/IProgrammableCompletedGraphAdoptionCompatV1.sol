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

    /// @notice Monotonic global review control, nested to keep the non-viaIR ABI decoder bounded.
    struct ReviewGenerationV1 {
        bytes32 reviewGenerationHash;
        uint64 reviewGeneration;
    }

    struct StateVerifierBindingV1 {
        address stateVerifier;
        bytes32 stateVerifierRuntimeCodeHash;
        bytes32 stateSchemaHash;
        bytes32 stateVerifierBehaviorEvidenceHash;
    }

    struct PrimaryIdentitiesV1 {
        address token;
        address hook;
        address nft;
        bytes32 applicationHash;
    }

    /// @notice Finalized transaction/receipt context for an observed CREATE or CREATE2. This package never deploys.
    /// @dev CREATE requires a contract-creation transaction (`transactionTo == 0`) whose sender, nonce and input
    ///      hash derive the component. CREATE2 may be nested under either a normal call or an outer CREATE; the
    ///      optional `topLevelCreatedAddress` distinguishes those receipt contexts while a nonzero internal trace
    ///      binds the nested call chain/deployer/opcode result. The component separately binds the CREATE2 deployer,
    ///      salt and init-code hash. Trace/history hashes are reviewer-authenticated evidence, not onchain facts.
    struct CreationReceiptEvidenceV1 {
        bytes32 transactionHash;
        uint64 blockNumber;
        bytes32 blockHash;
        uint32 transactionIndex;
        address transactionSender;
        uint64 transactionSenderNonce;
        address transactionTo;
        uint256 transactionValueWei;
        bytes32 transactionInputHash;
        bool receiptSucceeded;
        address topLevelCreatedAddress;
        bytes32 internalCreationTraceHash;
        bytes32 finalityEvidenceHash;
        bytes32 dualProviderEvidenceHash;
    }

    /// @dev Every component has exact CREATE/CREATE2 provenance, an observed runtime and a plan-independent
    ///      configuration commitment. Source/plan-bound creation evidence remains separate so shared identity cannot
    ///      accidentally depend on a later applicant plan.
    struct ComponentV1 {
        address account;
        ComponentKindV1 kind;
        ComponentScopeV1 scope;
        DeploymentKindV1 deploymentKind;
        address deployer;
        uint64 createNonce;
        bytes32 create2Salt;
        bytes32 initCodeHash;
        CreationReceiptEvidenceV1 creationReceiptEvidence;
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
        /// @dev Exact raw Git object identity of the executable/evidence source revision. It is neither the
        ///      applicant-request/review-admission revision nor an offchain carrier/evidence commit. The paired
        ///      commitment must use the Codec domain helper.
        bytes20 sourceCommitId;
        /// @dev Exact raw Git tree identity of that same executable/evidence source revision. It is never compared
        ///      to a padded bytes32 value and cannot be substituted by a request or carrier tree.
        bytes20 sourceTreeId;
        /// @dev Source-defined graph identity. The Router never equates it with an anti-replay nonce.
        bytes32 sourceLaunchId;
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
        /// @dev The codec derives the canonical grant hash and the Registry derives its EIP-712 digest. Neither
        ///      self-hash is applicant-supplied, which keeps this already-large non-viaIR ABI bounded.
        uint256 chainId;
        address registry;
        address launchWallet;
        /// @dev Applicant/request identity. The reviewed attestation below must transitively bind the exact
        ///      review-admission hash and request receipt; it is separate from executable-source Git objects.
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
        /// @dev Repository identity for the executable/evidence source revision named by sourceCommitHash/treeHash.
        bytes32 sourceRepositoryHash;
        /// @dev Domain-separated commitment to the executable/evidence source commit, never a raw padded Git OID.
        bytes32 sourceCommitHash;
        /// @dev Domain-separated commitment to the executable/evidence source tree, never a raw padded Git OID.
        bytes32 sourceTreeHash;
        /// @dev Source-defined graph identity, copied exactly from the reviewed plan.
        bytes32 sourceLaunchId;
        bytes32 componentGraphHash;
        bytes32 exactRuntimeSetHash;
        bytes32 componentConfigurationSetHash;
        bytes32 revenueBindingHash;
        bytes32 resultHash;
        /// @dev May bind the offchain carrier/evidence provenance, but cannot replace the executable-source fields.
        bytes32 builderEvidenceHash;
        /// @dev Must bind the exact applicant/request review-admission hash and request receipt. It cannot replace
        ///      executable-source Git commitments or carrier provenance.
        bytes32 reviewerAttestationHash;
        bytes32 securityControlHeadHash;
        bytes32 securityEpochHash;
        bytes32 policyHash;
        bytes32 policyEpochHash;
        uint64 securityEpoch;
        uint64 policyEpoch;
        ReviewGenerationV1 reviewControl;
        /// @dev Independent one-winner nonce. It is never a Source or Registry stamp identifier.
        bytes32 antiReplayNonce;
        bytes32 winnerKeyHash;
    }

    struct LaunchGrantStateHeadV1 {
        bytes32 grantDigest;
        bytes32 grantHash;
        bytes32 stateHeadHash;
        bytes32 stampLaunchId;
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
        /// @dev Hash of the exact typed onchain preflight readback returned by this Registry. It is diagnostic and
        ///      currentness evidence, never an evergreen applicant deadline or a substitute LaunchGrant.
        bytes32 preflightReadbackHash;
        /// @dev Purpose-bound simulation evidence for the exact plan/request/value-zero adoption transaction.
        bytes32 simulationEvidenceHash;
        /// @dev Exact content-addressed service/deployment identity used to obtain this currentness transport.
        bytes32 serviceDeploymentBindingHash;
        /// @dev Authority-attested evidence that two independent providers returned the same typed preflight state.
        bytes32 dualProviderQuorumEvidenceHash;
        bytes32 expectedResultHash;
        bytes32 adoptionIntentHash;
        bytes32 securityControlHeadHash;
        bytes32 securityEpochHash;
        bytes32 policyEpochHash;
        uint64 securityEpoch;
        uint64 policyEpoch;
        ReviewGenerationV1 reviewControl;
        bytes32 nonce;
        uint64 validAfter;
        uint64 deadline;
    }

    /// @notice Exact keys for a side-effect-free state read. A caller queries every component in canonical order;
    ///         candidateCurrentnessDigest is diagnostic and excluded from the signed aggregate to avoid circularity.
    struct AdoptionPreflightQueryV1 {
        bytes32 profileKey;
        bytes32 launchGrantDigest;
        bytes32 expectedContractPlanHash;
        bytes32 stampLaunchId;
        bytes32 antiReplayNonce;
        bytes32 winnerKeyHash;
        bytes32 componentGraphHash;
        uint8 componentIndex;
        address component;
        ComponentScopeV1 componentScope;
        bytes32 expectedSharedIdentityHash;
        bytes32 expectedRuntimeCodeHash;
        address exclusiveToken;
        address poolManager;
        bytes32 poolId;
        bytes32 currentnessNonce;
    }

    /// @notice Typed side-effect-free diagnostic surface. It never verifies a signature, reserves state or issues a
    ///         permit. Provider quorum is an Authority policy over byte-identical readbacks, not an onchain claim.
    struct AdoptionPreflightReadbackV1 {
        bytes32 queryHash;
        uint256 chainId;
        address registry;
        bytes32 runtimeAuthorityBindingHash;
        uint16 liveRuntimeMask;
        bytes32 dependencyBehaviorEvidenceHash;
        bytes32 securityControlHeadHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        ReviewGenerationV1 reviewControl;
        bool globalAdoptionKilled;
        ProfileStatusV1 profileStatus;
        bytes32 profileCapabilityHash;
        LaunchGrantStateHeadV1 grantStateHead;
        bytes32 winnerNonceOccupantGrantDigest;
        bytes32 winnerKeyOccupantGrantDigest;
        bool currentnessRevoked;
        bool currentnessUsed;
        bool currentnessNonceUsed;
        ReceiptStatusV1 receiptStatus;
        bytes32 receiptCoreHash;
        bytes32 finalityIndexingReceiptHash;
        bytes32 graphOccupantStampLaunchId;
        bytes32 exclusiveComponentOccupantStampLaunchId;
        bytes32 sharedComponentIdentityHash;
        bytes32 exclusiveTokenOccupantStampLaunchId;
        bytes32 poolOccupantStampLaunchId;
        bytes32 actualComponentRuntimeCodeHash;
        bytes32 componentLeafHash;
        bytes32 globalReadbackHeadHash;
    }

    /// @dev Compact Registry-only slices consumed by the codehash-pinned Preflight companion.
    struct AdoptionPreflightControlStateV1 {
        bytes32 runtimeAuthorityBindingHash;
        uint16 liveRuntimeMask;
        bytes32 dependencyBehaviorEvidenceHash;
        bytes32 securityControlHeadHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        ReviewGenerationV1 reviewControl;
        bool globalAdoptionKilled;
        ProfileStatusV1 profileStatus;
        bytes32 profileCapabilityHash;
    }

    struct AdoptionPreflightGrantReceiptStateV1 {
        LaunchGrantStateHeadV1 grantStateHead;
        bytes32 winnerNonceOccupantGrantDigest;
        bytes32 winnerKeyOccupantGrantDigest;
        bool currentnessRevoked;
        bool currentnessUsed;
        bool currentnessNonceUsed;
        ReceiptStatusV1 receiptStatus;
        bytes32 receiptCoreHash;
        bytes32 finalityIndexingReceiptHash;
        bytes32 graphOccupantStampLaunchId;
        bytes32 exclusiveTokenOccupantStampLaunchId;
        bytes32 poolOccupantStampLaunchId;
    }

    struct AdoptionPreflightComponentStateV1 {
        bytes32 exclusiveComponentOccupantStampLaunchId;
        bytes32 sharedComponentIdentityHash;
        bytes32 actualComponentRuntimeCodeHash;
    }

    struct AdoptionRequestV1 {
        bytes32 stampLaunchId;
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
        /// @dev Behavior evidence proves that any forwarding/mutable dependency behind the verifier is frozen;
        ///      absence of a DELEGATECALL opcode alone cannot establish that property.
        StateVerifierBindingV1 stateVerifierBinding;
        ReviewGenerationV1 reviewControl;
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
        /// @dev Router/Registry identifier derived only by the published STAMP_LAUNCH_ID_TYPEHASH formula.
        bytes32 stampLaunchId;
        /// @dev Source-defined identity retained separately for public discovery and consumer reconciliation.
        bytes32 sourceLaunchId;
        bytes32 receiptCoreHash;
        bytes32 launchGrantDigest;
        bytes32 launchGrantHash;
        bytes32 executionCurrentnessDigest;
        bytes32 contractPlanHash;
        bytes32 profileCapabilityHash;
        bytes32 adoptionRequestHash;
    }

    struct FinalityIndexingReceiptV1 {
        bytes32 stampLaunchId;
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
        bytes32 indexed stampLaunchId,
        bytes32 indexed launchGrantDigest,
        address indexed launchWallet,
        bytes32 antiReplayNonce,
        bytes32 winnerKeyHash
    );
    event LaunchGrantRevokedV1(bytes32 indexed stampLaunchId, bytes32 indexed launchGrantDigest);
    event LaunchGrantConsumedV1(bytes32 indexed stampLaunchId, bytes32 indexed launchGrantDigest);
    event ExecutionCurrentnessRevokedV1(bytes32 indexed executionCurrentnessDigest);
    event SecurityPolicyReviewControlsAdvancedV1(
        bytes32 indexed securityControlHeadHash,
        uint64 securityEpoch,
        bytes32 securityEpochHash,
        uint64 policyEpoch,
        bytes32 policyEpochHash,
        uint64 reviewGeneration,
        bytes32 reviewGenerationHash
    );
    event CanonicalReceiptAdoptedV1(
        bytes32 indexed stampLaunchId, bytes32 indexed receiptCoreHash, bytes32 grantDigest
    );
    event CanonicalComponentRecordedV1(
        bytes32 indexed stampLaunchId,
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
        bytes32 indexed stampLaunchId,
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
        bytes32 policyEpochHash,
        uint64 reviewGeneration,
        bytes32 reviewGenerationHash
    ) external;

    function adoptCompletedGraphV1(CompletedGraphAdoptionV1 calldata adoption)
        external
        returns (bytes32 receiptCoreHash);

    function advanceFinalityIndexingV1(FinalityIndexingReceiptV1 calldata receipt) external;

    function launchGrantDigest(LaunchGrantV1 calldata grant) external view returns (bytes32);

    function executionCurrentnessDigest(ExecutionCurrentnessV1 calldata currentness) external view returns (bytes32);

    function preflightControlStateV1(bytes32 profileKey) external view returns (AdoptionPreflightControlStateV1 memory);

    function preflightGrantReceiptStateV1(AdoptionPreflightQueryV1 calldata query, bytes32 candidateCurrentnessDigest)
        external
        view
        returns (AdoptionPreflightGrantReceiptStateV1 memory);

    function preflightComponentStateV1(address component)
        external
        view
        returns (AdoptionPreflightComponentStateV1 memory);

    function canonicalReceiptCore(bytes32 stampLaunchId) external view returns (CanonicalReceiptCoreV1 memory);
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

/// @notice Immutable typed preflight projection and aggregate verifier. It has no state-changing or signing surface.
interface IProgrammableCompletedGraphAdoptionPreflightV1 {
    function CODEC() external view returns (address);

    function adoptionPreflightReadbackV1(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 calldata query,
        bytes32 candidateCurrentnessDigest
    ) external view returns (IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory);

    function computeAdoptionPreflightAggregateV1(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphAdoptionV1 calldata adoption,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability,
        bytes32 grantDigest,
        bytes32 contractPlanHash
    ) external view returns (bytes32);
}
