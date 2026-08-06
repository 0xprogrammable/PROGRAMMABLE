// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IProgrammableCustomRegistryV1
/// @notice Canonical append-only origin interface for Programmable Custom launches.
/// @dev A record proves origin and exact bindings. It does not claim that a launch is risk-free.
interface IProgrammableCustomRegistryV1 {
    enum FeePolicyKind {
        NativeCustom,
        PartnerTemplate,
        NoQualifyingMarket
    }

    enum LaunchStatus {
        None,
        Observed,
        Finalized,
        Revoked
    }

    struct FeeLegV1 {
        uint16 shareBps;
        address recipient;
        address currency;
        bytes32 chargeModeId;
        bytes32 basisId;
        bytes32 roundingId;
        bytes32 accrualId;
        bytes32 claimId;
        bytes32 claimRightId;
        bytes32 controlEvidenceHash;
    }

    struct FeePolicyV1 {
        FeePolicyKind kind;
        bytes32 providerId;
        bytes32 partnerStatusId;
        bytes32 modelId;
        bytes32 modelVersion;
        bytes32 templateId;
        bytes32 templateVersion;
        bytes32 marketPathId;
        bytes32 partnerRepositoryId;
        bytes32 partnerCommitId;
        bytes32 partnerRuntimeCodeSetHash;
        uint16 totalFeeBps;
        uint16 nativeCustomFeeBps;
        FeeLegV1 partner;
        FeeLegV1 programmable;
        bytes32 activationVersion;
        uint64 activationBlock;
        bool paused;
        bool retired;
        bytes32 publicPolicyBindingHash;
        bytes32 claimIsolationEvidenceHash;
        bytes32 accountingSafetyEvidenceHash;
        bytes32 verificationEvidenceHash;
    }

    struct LaunchRegistrationV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 launchId;
        bytes32 projectId;
        bytes32 approvalId;
        bytes32 approvalBindingHash;
        bytes32 repositoryId;
        bytes32 commitId;
        bytes32 sourceCommitment;
        bytes32 buildCommitment;
        bytes32 artifactSetHash;
        bytes32 deploymentConfigurationHash;
        bytes32 configurationHash;
        bytes32 permissionsHash;
        bytes32 deploymentId;
        bytes32 deploymentSetHash;
        bytes32 runtimeCodeSetHash;
        address primaryContract;
        bytes32 primaryRuntimeCodeHash;
        address launchWallet;
        bytes32 modelId;
        bytes32 modelVersion;
        bytes32 templateId;
        bytes32 templateVersion;
        bytes32 providerId;
        bytes32 builderAttributionHash;
        bytes32 originHash;
        bytes32 assetSetHash;
        bytes32 marketSetHash;
        bytes32 marketPathId;
        bytes32 capabilitySetHash;
        bytes32 reviewPolicyHash;
        bytes32 securityReviewHash;
        bytes32 reviewResultId;
        bytes32 reviewDeploymentBindingHash;
        bytes32 finalityPolicyHash;
        bytes32 registeredRecordCommitment;
        FeePolicyV1 feePolicy;
    }

    struct LaunchStateV1 {
        LaunchStatus status;
        uint64 observedAtBlock;
        uint64 finalizedAtBlock;
        uint64 latestRecordRevision;
        bytes32 latestRecordHash;
        bytes32 identityHash;
        bytes32 feePolicyHash;
        bytes32 finalityEvidenceHash;
    }

    struct ApprovalAuthorizationV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 approvalId;
        bytes32 launchId;
        bytes32 approvalBindingHash;
        bytes32 registrationBindingHash;
        uint64 validAfterBlock;
        uint64 expiresAtBlock;
        bytes32 evidenceHash;
    }

    struct ApprovalStateV1 {
        bytes32 launchId;
        bytes32 approvalBindingHash;
        bytes32 registrationBindingHash;
        uint64 validAfterBlock;
        uint64 expiresAtBlock;
        bytes32 evidenceHash;
        bool consumed;
    }

    struct LaunchDetailsV1 {
        bytes32 projectId;
        bytes32 approvalId;
        bytes32 approvalBindingHash;
        bytes32 deploymentId;
        bytes32 deploymentSetHash;
        bytes32 runtimeCodeSetHash;
        address primaryContract;
        bytes32 primaryRuntimeCodeHash;
        address launchWallet;
        bytes32 modelId;
        bytes32 modelVersion;
        bytes32 templateId;
        bytes32 templateVersion;
        bytes32 providerId;
        bytes32 configurationHash;
        bytes32 permissionsHash;
        bytes32 marketPathId;
        bytes32 reviewPolicyHash;
        bytes32 securityReviewHash;
        bytes32 reviewResultId;
        bytes32 reviewDeploymentBindingHash;
        bytes32 finalityPolicyHash;
    }

    struct FinalityProofV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 launchId;
        uint64 observedBlockNumber;
        bytes32 observedBlockHash;
        bytes32 observedTransactionHash;
        uint32 observedTransactionIndex;
        uint32 observedLogIndex;
        uint64 confirmedHeadBlockNumber;
        bytes32 confirmedHeadBlockHash;
        bytes32 finalityPolicyHash;
        bytes32 finalityEvidenceHash;
    }

    struct RecordCorrectionV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 launchId;
        uint64 revision;
        bytes32 previousRecordHash;
        bytes32 correctedRecordHash;
        bytes32 reasonCode;
        bytes32 evidenceHash;
    }

    struct LaunchRevocationV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 launchId;
        bytes32 reasonCode;
        bytes32 evidenceHash;
    }

    event CustomLaunchRegisteredV1(
        bytes32 indexed launchId,
        bytes32 indexed projectId,
        address indexed primaryContract,
        uint64 registrationSequence,
        uint256 chainId,
        uint64 registryGeneration,
        bytes32 approvalId,
        bytes32 deploymentId,
        address launchWallet,
        bytes32 identityHash,
        bytes32 registeredRecordCommitment,
        uint64 observedAtBlock
    );

    event CustomLaunchApprovalAuthorizedV1(
        bytes32 indexed approvalId,
        bytes32 indexed launchId,
        bytes32 indexed approvalBindingHash,
        bytes32 registrationBindingHash,
        uint64 transitionSequence,
        uint64 validAfterBlock,
        uint64 expiresAtBlock,
        bytes32 evidenceHash
    );

    event CustomLaunchProvenanceBoundV1(
        bytes32 indexed launchId,
        bytes32 indexed repositoryId,
        bytes32 indexed commitId,
        bytes32 sourceCommitment,
        bytes32 buildCommitment,
        bytes32 artifactSetHash,
        bytes32 deploymentConfigurationHash,
        bytes32 deploymentSetHash,
        bytes32 runtimeCodeSetHash,
        bytes32 primaryRuntimeCodeHash
    );

    event CustomLaunchReviewBoundV1(
        bytes32 indexed launchId,
        bytes32 indexed approvalBindingHash,
        bytes32 indexed securityReviewHash,
        bytes32 reviewPolicyHash,
        bytes32 reviewResultId,
        bytes32 reviewDeploymentBindingHash,
        bytes32 feePolicyHash,
        bytes32 finalityPolicyHash
    );

    event CustomLaunchAttributionBoundV1(
        bytes32 indexed launchId,
        bytes32 indexed modelId,
        bytes32 indexed templateId,
        bytes32 modelVersion,
        bytes32 templateVersion,
        bytes32 providerId,
        bytes32 builderAttributionHash,
        bytes32 originHash,
        bytes32 assetSetHash,
        bytes32 marketSetHash,
        bytes32 marketPathId,
        bytes32 configurationHash,
        bytes32 permissionsHash,
        bytes32 capabilitySetHash
    );

    event CustomLaunchFeePolicyBoundV1(
        bytes32 indexed launchId,
        bytes32 indexed feePolicyHash,
        bytes32 indexed providerId,
        FeePolicyKind kind,
        uint16 totalFeeBps,
        uint16 nativeCustomFeeBps,
        uint16 partnerShareBps,
        uint16 programmableShareBps,
        address partnerRecipient,
        address programmableRecipient
    );

    event CustomLaunchFeeScopeBoundV1(
        bytes32 indexed launchId,
        bytes32 indexed feePolicyHash,
        bytes32 indexed publicPolicyBindingHash,
        bytes32 modelId,
        bytes32 modelVersion,
        bytes32 templateId,
        bytes32 templateVersion,
        bytes32 marketPathId
    );

    event CustomLaunchFeeEvidenceBoundV1(
        bytes32 indexed launchId,
        bytes32 indexed feePolicyHash,
        bytes32 indexed verificationEvidenceHash,
        address currency,
        bytes32 chargeModeId,
        bytes32 basisId,
        bytes32 roundingId,
        bytes32 partnerAccrualId,
        bytes32 programmableAccrualId,
        bytes32 claimIsolationEvidenceHash,
        bytes32 accountingSafetyEvidenceHash
    );

    event CustomLaunchFinalizedV1(
        bytes32 indexed launchId,
        bytes32 indexed observedTransactionHash,
        bytes32 indexed finalityEvidenceHash,
        uint64 transitionSequence,
        uint64 observedBlockNumber,
        bytes32 observedBlockHash,
        uint32 observedTransactionIndex,
        uint32 observedLogIndex,
        uint64 confirmedHeadBlockNumber,
        bytes32 confirmedHeadBlockHash,
        bytes32 finalityPolicyHash,
        uint64 finalizedAtBlock,
        uint64 finalizedAtTimestamp
    );

    event CustomLaunchRecordCorrectedV1(
        bytes32 indexed launchId,
        uint64 indexed revision,
        bytes32 indexed correctedRecordHash,
        uint64 transitionSequence,
        bytes32 previousRecordHash,
        bytes32 reasonCode,
        bytes32 evidenceHash
    );

    event CustomLaunchRevokedV1(
        bytes32 indexed launchId,
        bytes32 indexed reasonCode,
        bytes32 indexed evidenceHash,
        uint64 transitionSequence,
        uint64 latestRecordRevision,
        bytes32 latestRecordHash,
        uint64 revokedAtBlock,
        uint64 revokedAtTimestamp
    );

    function authorizeApproval(ApprovalAuthorizationV1 calldata authorization) external;
    function registerLaunch(LaunchRegistrationV1 calldata registration) external;
    function finalizeLaunch(FinalityProofV1 calldata proof) external;
    function correctLaunchRecord(RecordCorrectionV1 calldata correction) external;
    function revokeLaunch(LaunchRevocationV1 calldata revocation) external;
    function launchState(bytes32 launchId) external view returns (LaunchStateV1 memory);
    function launchDetails(bytes32 launchId) external view returns (LaunchDetailsV1 memory);
    function approvalState(bytes32 approvalId) external view returns (ApprovalStateV1 memory);
    function recordHashAtRevision(bytes32 launchId, uint64 revision) external view returns (bytes32);
    function computeFeePolicyHash(FeePolicyV1 calldata policy) external view returns (bytes32);
    function computeApprovalBindingHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        external
        pure
        returns (bytes32);
    function computeRegistrationBindingHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        external
        pure
        returns (bytes32);
    function computeRegisteredRecordCommitment(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        external
        pure
        returns (bytes32);
    function computeReviewDeploymentBindingHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        external
        pure
        returns (bytes32);
}
