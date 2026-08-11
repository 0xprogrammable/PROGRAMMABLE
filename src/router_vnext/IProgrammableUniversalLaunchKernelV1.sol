// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Closed, versioned lifecycle shared by reusable typed launch profiles.
/// @dev Profile modules expose their own typed applicant entry points. The kernel never accepts an
///      arbitrary target, selector, calldata payload, initcode payload, delegatecall, or generic value cap.
interface IProgrammableUniversalLaunchKernelV1 {
    enum CapabilitySemantics {
        None,
        Execute,
        Adopt
    }

    enum ProfileStatus {
        None,
        Active,
        Suspended,
        Deprecated
    }

    enum LaunchGrantStatus {
        None,
        Active,
        Revoked,
        Consumed
    }

    enum ReceiptStatus {
        None,
        Prepared,
        Executed,
        Adopted,
        Finalized,
        IndexedPublished
    }

    enum ReservationKind {
        None,
        Component,
        Token,
        Pool
    }

    enum ReservationScope {
        None,
        Exclusive,
        SharedInfrastructure
    }

    struct ControlStateV1 {
        bytes32 securityControlHeadHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        uint64 reviewGeneration;
        bytes32 reviewGenerationHash;
        bool globalKilled;
    }

    struct ProfileDescriptorV1 {
        bytes32 profileKey;
        bytes32 schemaId;
        uint32 profileVersion;
        CapabilitySemantics capabilitySemantics;
        address module;
        bytes32 moduleRuntimeCodeHash;
        bytes32 actionTypeHash;
        bytes32 exactContractBindingHash;
        bytes32 providerBindingHash;
        bytes32 revenuePolicyHash;
        bytes32 securityControlHeadHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        uint64 reviewGeneration;
        bytes32 reviewGenerationHash;
        ProfileStatus status;
    }

    /// @dev Raw Git objects are bytes20. Their domain-separated commitments are recomputed onchain.
    struct LaunchGrantV1 {
        uint16 schemaVersion;
        address applicantWallet;
        bytes32 applicantIdHash;
        bytes32 profileKey;
        bytes32 planHash;
        bytes32 sourceRepoHash;
        bytes20 sourceCommit;
        bytes20 sourceTree;
        bytes32 sourceLaunchId;
        bytes32 stampLaunchId;
        bytes32 antiReplayNonce;
        bytes32 componentGraphHash;
        bytes32 componentRuntimeSetHash;
        bytes32 configurationHash;
        bytes32 builderEvidenceHash;
        bytes32 reviewerAttestationHash;
        bytes32 exactContractBindingHash;
        bytes32 providerBindingHash;
        bytes32 revenueBindingHash;
        bytes32 securityControlHeadHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        uint64 reviewGeneration;
        bytes32 reviewGenerationHash;
    }

    /// @dev Short-lived reviewer-authenticated currentness is transport safety, not Applicant approval.
    struct ExecutionCurrentnessV1 {
        bytes32 grantDigest;
        bytes32 profileKey;
        bytes32 planHash;
        CapabilitySemantics executionMode;
        bytes32 kernelPreflightReadbackHash;
        bytes32 profilePreflightReadbackHash;
        bytes32 dualProviderQuorumEvidenceHash;
        bytes32 simulationEvidenceHash;
        bytes32 serviceDeploymentBindingHash;
        bytes32 currentnessNonce;
        bytes32 securityControlHeadHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        uint64 reviewGeneration;
        bytes32 reviewGenerationHash;
        uint64 validAfter;
        uint64 deadline;
    }

    struct ApplicantWalletIntentV1 {
        bytes32 grantDigest;
        bytes32 stampLaunchId;
        bytes32 antiReplayNonce;
        address profileModule;
        bytes32 intentNonce;
        uint64 validAfter;
        uint64 deadline;
    }

    struct LaunchGrantStateHeadV1 {
        LaunchGrantStatus status;
        bytes32 grantHash;
        bytes32 winnerKeyHash;
        bytes32 stateHeadHash;
    }

    struct ReservationV1 {
        ReservationKind kind;
        ReservationScope scope;
        address account;
        address manager;
        bytes32 identifier;
        bytes32 expectedRuntimeCodeHash;
        bytes32 expectedManagerRuntimeCodeHash;
        bytes32 sharedIdentityHash;
    }

    struct ProfileExecutionEnvelopeV1 {
        ExecutionCurrentnessV1 currentness;
        bytes currentnessSignature;
        ApplicantWalletIntentV1 walletIntent;
        bytes walletSignature;
        ReservationV1[] reservations;
    }

    struct ExecutionResultV1 {
        bytes32 grantDigest;
        bytes32 stampLaunchId;
        bytes32 planHash;
        bytes32 componentSetHash;
        bytes32 componentRuntimeSetHash;
        bytes32 configurationHash;
        bytes32 reservationSetHash;
        bytes32 providerResultHash;
        bytes32 postconditionHash;
        bytes32 valueFlowHash;
        bytes32 deploymentLineageHash;
    }

    struct CanonicalLaunchReceiptV1 {
        uint256 chainId;
        address kernel;
        uint32 routerVersion;
        bytes32 profileKey;
        uint32 profileVersion;
        CapabilitySemantics capabilitySemantics;
        address applicantWallet;
        bytes32 applicantIdHash;
        bytes32 sourceRepoHash;
        bytes32 sourceCommitment;
        bytes32 sourceTreeCommitment;
        bytes32 sourceLaunchId;
        bytes32 stampLaunchId;
        bytes32 antiReplayNonce;
        bytes32 planHash;
        bytes32 builderEvidenceHash;
        bytes32 reviewerAttestationHash;
        bytes32 grantDigest;
        bytes32 componentGraphHash;
        bytes32 reservationSetHash;
        bytes32 componentSetHash;
        bytes32 componentRuntimeSetHash;
        bytes32 configurationHash;
        bytes32 providerBindingHash;
        bytes32 providerResultHash;
        bytes32 revenueBindingHash;
        bytes32 valueFlowHash;
        bytes32 deploymentLineageHash;
        bytes32 postconditionHash;
        bytes32 securityControlHeadHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        uint64 reviewGeneration;
        bytes32 reviewGenerationHash;
        ReceiptStatus status;
        bytes32 receiptCoreHash;
        bytes32 finalityIndexingReceiptHash;
    }

    struct FinalityIndexingReceiptV1 {
        bytes32 grantDigest;
        bytes32 stampLaunchId;
        bytes32 receiptCoreHash;
        bytes32 transactionHash;
        uint64 blockNumber;
        bytes32 blockHash;
        uint64 finalizedAt;
        bytes32 deploymentReceiptHash;
        bytes32 sourceVerificationReceiptHash;
        bytes32 indexingReceiptHash;
        ReceiptStatus status;
    }

    function registerProfileV1(ProfileDescriptorV1 calldata descriptor) external;

    function setProfileStatusV1(bytes32 profileKey, ProfileStatus status) external;

    function setGlobalKillV1(bool killed) external;

    function advanceControlV1(ControlStateV1 calldata next) external;

    function activateLaunchGrantV1(LaunchGrantV1 calldata grant, bytes calldata reviewerSignature)
        external
        returns (bytes32 grantDigest);

    function revokeLaunchGrantV1(bytes32 grantDigest) external;

    function revokeExecutionCurrentnessV1(bytes32 currentnessDigest) external;

    function beginProfileExecutionV1(bytes32 grantDigest, ProfileExecutionEnvelopeV1 calldata envelope)
        external
        returns (bytes32 executionKey);

    function finalizeProfileExecutionV1(ExecutionResultV1 calldata result) external returns (bytes32 receiptCoreHash);

    function appendFinalityIndexingV1(FinalityIndexingReceiptV1 calldata receipt, bytes calldata authoritySignature)
        external;

    function computeSourceCommitmentV1(bytes20 sourceCommit) external pure returns (bytes32);

    function computeSourceTreeCommitmentV1(bytes20 sourceTree) external pure returns (bytes32);

    function computeStampLaunchIdV1(LaunchGrantV1 calldata grant) external view returns (bytes32);

    function computeWinnerKeyHashV1(LaunchGrantV1 calldata grant) external view returns (bytes32);

    function computeLaunchGrantDigestV1(LaunchGrantV1 calldata grant) external view returns (bytes32);

    function computeExecutionCurrentnessDigestV1(ExecutionCurrentnessV1 calldata currentness)
        external
        view
        returns (bytes32);

    function computeWalletIntentDigestV1(ApplicantWalletIntentV1 calldata intent) external view returns (bytes32);

    function computeReservationKeyV1(ReservationV1 calldata reservation) external view returns (bytes32);

    function computeReservationSetHashV1(ReservationV1[] calldata reservations) external view returns (bytes32);

    function profileDescriptorV1(bytes32 profileKey) external view returns (ProfileDescriptorV1 memory);

    function launchGrantV1(bytes32 grantDigest) external view returns (LaunchGrantV1 memory);

    function launchGrantStateHeadV1(bytes32 grantDigest) external view returns (LaunchGrantStateHeadV1 memory);

    function canonicalLaunchReceiptV1(bytes32 grantDigest) external view returns (CanonicalLaunchReceiptV1 memory);

    function controlStateV1() external view returns (ControlStateV1 memory);

    function winnerByNonceV1(bytes32 antiReplayNonce) external view returns (bytes32);

    function winnerByKeyV1(bytes32 winnerKeyHash) external view returns (bytes32);

    function currentnessStatusV1(bytes32 digest) external view returns (bool used, bool revoked);

    function activeExecutionGrantDigestV1() external view returns (bytes32);

    function reservationOccupantsV1(ReservationV1 calldata reservation)
        external
        view
        returns (bytes32 reservationKey, bytes32 exclusiveGrantDigest, bytes32 sharedIdentityHash);
}
