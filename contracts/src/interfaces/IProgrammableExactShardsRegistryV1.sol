// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCustomRegistryV1 } from "./IProgrammableCustomRegistryV1.sol";
import { IProgrammableExactShardsFeePolicyVerifierV1 } from "./IProgrammableExactShardsFeePolicyVerifierV1.sol";

/// @title IProgrammableExactShardsRegistryV1
/// @notice Append-only launch registry restricted to the reviewed Shards three-claim economics.
/// @dev Registration is an origin record. It does not deploy, activate, approve or certify a launch.
interface IProgrammableExactShardsRegistryV1 {
    struct LaunchRegistrationV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 launchId;
        bytes32 projectId;
        bytes32 approvalId;
        bytes32 approvalBindingHash;
        /// @dev Stable numeric GitHub repository ID; independent of owner/name, transfer and rename.
        uint64 githubRepositoryId;
        bytes32 commitId;
        bytes32 sourceCommitment;
        bytes32 buildCommitment;
        bytes32 artifactSetHash;
        bytes32 deploymentConfigurationHash;
        /// @dev Reviewed technical configuration commitment. It MUST NOT contain website presentation data.
        bytes32 configurationHash;
        /// @dev keccak256(bytes(tokenName)) for the exact name selected on the Website after technical approval.
        bytes32 tokenNameHash;
        /// @dev keccak256(bytes(tokenSymbol)) for the exact symbol selected on the Website after technical approval.
        bytes32 tokenSymbolHash;
        /// @dev Exact Website presentation-record binding for description, image and links; never a source input.
        bytes32 presentationBindingHash;
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
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 feePolicy;
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] orderedFeeLegs;
    }

    struct LaunchStateV1 {
        IProgrammableCustomRegistryV1.LaunchStatus status;
        uint64 observedAtBlock;
        uint64 finalizedAtBlock;
        uint64 latestRecordRevision;
        bytes32 latestRecordHash;
        bytes32 identityHash;
        bytes32 feePolicyHash;
        bytes32 feePolicyRecordHash;
        bytes32 finalityEvidenceHash;
    }

    struct StoredFeePolicyV1 {
        bytes32 profileKey;
        address feeAsset;
        bytes32 feeBasisHash;
        uint16 totalFeeBps;
        bytes32 legsHash;
        bytes32 policyHash;
        bytes32 claimSetHash;
        bytes32 verifierBindingHash;
        bytes32 verifierRuntimeCodeHash;
        bytes32 feePolicyRecordHash;
    }

    struct StoredFeeClaimV1 {
        uint8 ordinal;
        bytes32 roleHash;
        uint16 grossVolumeFeeBps;
        uint16 shareOfFeeBps;
        address initialRecipientOrAccumulator;
        bytes32 recipientModeHash;
        bytes4 claimSelector;
        bytes4 handoffSelector;
        bytes32 legHash;
        bytes32 storedClaimHash;
    }

    event ExactShardsApprovalAuthorizedV1(
        bytes32 indexed approvalId,
        bytes32 indexed launchId,
        bytes32 indexed approvalBindingHash,
        bytes32 registrationBindingHash,
        uint64 transitionSequence,
        uint64 validAfterBlock,
        uint64 expiresAtBlock,
        bytes32 evidenceHash
    );

    struct LaunchIntentStateV1 {
        bytes32 bindingHash;
        bytes32 evidenceHash;
        uint64 validAfterBlock;
        uint64 expiresAtBlock;
    }

    event ExactShardsLaunchRegisteredV1(
        bytes32 indexed launchId,
        bytes32 indexed projectId,
        address indexed primaryContract,
        uint64 registrationSequence,
        bytes32 approvalId,
        bytes32 deploymentId,
        bytes32 identityHash,
        bytes32 registeredRecordCommitment,
        bytes32 feePolicyHash,
        bytes32 feePolicyRecordHash,
        uint64 observedAtBlock
    );

    event ExactShardsFeePolicyBoundV1(
        bytes32 indexed launchId,
        bytes32 indexed policyHash,
        bytes32 indexed feePolicyRecordHash,
        bytes32 claimSetHash,
        bytes32 verifierBindingHash,
        bytes32 profileKey,
        address feeAsset,
        bytes32 feeBasisHash,
        uint16 totalFeeBps,
        bytes32 legsHash
    );

    event ExactShardsFeeClaimBoundV1(
        bytes32 indexed launchId,
        uint8 indexed ordinal,
        bytes32 indexed roleHash,
        uint16 grossVolumeFeeBps,
        uint16 shareOfFeeBps,
        address initialRecipientOrAccumulator,
        bytes32 recipientModeHash,
        bytes4 claimSelector,
        bytes4 handoffSelector,
        bytes32 legHash,
        bytes32 storedClaimHash
    );

    event ExactShardsLaunchFinalizedV1(
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

    event ExactShardsLaunchRecordCorrectedV1(
        bytes32 indexed launchId,
        uint64 indexed revision,
        bytes32 indexed correctedRecordHash,
        uint64 transitionSequence,
        bytes32 previousRecordHash,
        bytes32 reasonCode,
        bytes32 evidenceHash
    );

    event ExactShardsLaunchRevokedV1(
        bytes32 indexed launchId,
        bytes32 indexed reasonCode,
        bytes32 indexed evidenceHash,
        uint64 transitionSequence,
        uint64 latestRecordRevision,
        bytes32 latestRecordHash,
        uint64 revokedAtBlock,
        uint64 revokedAtTimestamp
    );

    function authorizeApproval(IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 calldata authorization) external;
    function authorizeLaunchIntent(IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 calldata authorization)
        external;
    function registerLaunch(LaunchRegistrationV1 calldata registration) external;
    function finalizeLaunch(IProgrammableCustomRegistryV1.FinalityProofV1 calldata proof) external;
    function correctLaunchRecord(IProgrammableCustomRegistryV1.RecordCorrectionV1 calldata correction) external;
    function revokeLaunch(IProgrammableCustomRegistryV1.LaunchRevocationV1 calldata revocation) external;

    function launchState(bytes32 launchId) external view returns (LaunchStateV1 memory);
    function launchDetails(bytes32 launchId)
        external
        view
        returns (IProgrammableCustomRegistryV1.LaunchDetailsV1 memory);
    function approvalState(bytes32 approvalId)
        external
        view
        returns (IProgrammableCustomRegistryV1.ApprovalStateV1 memory);
    function feePolicyState(bytes32 launchId) external view returns (StoredFeePolicyV1 memory);
    function feeClaim(bytes32 launchId, uint8 ordinal) external view returns (StoredFeeClaimV1 memory);
    function recordHashAtRevision(bytes32 launchId, uint64 revision) external view returns (bytes32);

    /// @dev Deterministic binding helpers are deliberately offchain/test-only so the production Registry
    ///      remains below EIP-170. Every submitted binding is recomputed and checked during registration.
}
