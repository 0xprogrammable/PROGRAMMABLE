// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IProgrammableCustomRegistryV2
/// @notice Applicant-neutral commitment registry for approved Programmable Custom launches.
interface IProgrammableCustomRegistryV2 {
    enum LaunchStatus {
        None,
        Observed,
        Finalized,
        Revoked
    }

    enum MarketMode {
        NoMarket,
        Market
    }

    struct LaunchDescriptorV2 {
        uint256 chainId;
        address launchWallet;
        address primaryContract;
        bytes32 primaryRuntimeCodeHash;
        bytes32 componentSetHash;
        bytes32 sourceArtifactHash;
        bytes32 configurationHash;
        bytes32 launchPlanHash;
        bytes32 projectCommitment;
        MarketMode marketMode;
        uint16 protocolFeeBps;
    }

    struct ApprovalAuthorizationV2 {
        bytes32 approvalId;
        bytes32 descriptorHash;
        uint64 validAfterBlock;
        uint64 expiresAtBlock;
        bytes32 approvalEvidenceHash;
    }

    struct ApprovalStateV2 {
        bytes32 descriptorHash;
        uint64 validAfterBlock;
        uint64 expiresAtBlock;
        bytes32 approvalEvidenceHash;
        bool consumed;
    }

    struct FinalityEvidenceV2 {
        bytes32 observedBlockHash;
        uint64 confirmedHeadBlock;
        bytes32 confirmedHeadBlockHash;
        bytes32 finalityEvidenceHash;
    }

    struct LaunchStateV2 {
        LaunchStatus status;
        uint64 observedAtBlock;
        uint64 finalizedAtBlock;
        uint64 revokedAtBlock;
        uint64 transitionSequence;
        bytes32 descriptorHash;
        bytes32 approvalId;
        bytes32 approvalEvidenceHash;
        bytes32 registrationEvidenceHash;
        bytes32 finalityEvidenceHash;
        bytes32 revocationEvidenceHash;
    }

    event CustomLaunchApprovalAuthorizedV2(
        bytes32 indexed approvalId,
        bytes32 indexed descriptorHash,
        uint64 validAfterBlock,
        uint64 expiresAtBlock,
        bytes32 approvalEvidenceHash,
        uint64 transitionSequence
    );

    event CustomLaunchRegisteredV2(
        bytes32 indexed launchId,
        bytes32 indexed descriptorHash,
        address indexed primaryContract,
        bytes32 approvalId,
        bytes32 approvalEvidenceHash,
        bytes32 registrationEvidenceHash,
        uint64 observedAtBlock,
        uint64 transitionSequence
    );

    event CustomLaunchDescriptorCommittedV2(
        bytes32 indexed launchId,
        bytes32 indexed descriptorHash,
        address indexed primaryContract,
        address launchWallet,
        bytes32 primaryRuntimeCodeHash,
        bytes32 componentSetHash,
        bytes32 projectCommitment,
        uint8 marketMode,
        uint16 protocolFeeBps
    );

    event CustomLaunchDescriptorEvidenceCommittedV2(
        bytes32 indexed launchId,
        bytes32 indexed sourceArtifactHash,
        bytes32 indexed configurationHash,
        bytes32 launchPlanHash
    );

    event CustomLaunchFinalizedV2(
        bytes32 indexed launchId,
        bytes32 indexed descriptorHash,
        bytes32 indexed finalityEvidenceHash,
        uint64 observedAtBlock,
        bytes32 observedBlockHash,
        uint64 confirmedHeadBlock,
        bytes32 confirmedHeadBlockHash,
        uint64 finalizedAtBlock,
        uint64 transitionSequence
    );

    event CustomLaunchRevokedV2(
        bytes32 indexed launchId,
        bytes32 indexed descriptorHash,
        bytes32 indexed revocationEvidenceHash,
        bytes32 reasonHash,
        uint64 revokedAtBlock,
        uint64 transitionSequence
    );

    function authorizeApproval(ApprovalAuthorizationV2 calldata authorization) external;

    function registerLaunch(
        LaunchDescriptorV2 calldata descriptor,
        bytes32 approvalId,
        bytes32 registrationEvidenceHash
    ) external returns (bytes32 launchId, bytes32 descriptorHash);

    function finalizeLaunch(bytes32 launchId, FinalityEvidenceV2 calldata evidence) external;

    function revokeLaunch(bytes32 launchId, bytes32 revocationEvidenceHash, bytes32 reasonHash) external;

    function computeDescriptorHash(LaunchDescriptorV2 calldata descriptor) external view returns (bytes32);

    function computeLaunchId(bytes32 descriptorHash) external view returns (bytes32);

    function approvalState(bytes32 approvalId) external view returns (ApprovalStateV2 memory);

    function launchState(bytes32 launchId) external view returns (LaunchStateV2 memory);

    function launchDescriptor(bytes32 launchId) external view returns (LaunchDescriptorV2 memory);

    function descriptorRegistered(bytes32 descriptorHash) external view returns (bool);

    function primaryContractRegistered(address primaryContract) external view returns (bool);

    function evidenceConsumed(bytes32 evidenceHash) external view returns (bool);
}
