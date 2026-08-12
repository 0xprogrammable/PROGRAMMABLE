// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IProgrammableLaunchPermitAuthorityV1
/// @notice Canonical signed launch-permit and one-launch-per-GitHub-repository authority.
interface IProgrammableLaunchPermitAuthorityV1 {
    enum PermitStateV1 {
        UNSEEN,
        CANCELLED,
        CONSUMED
    }

    enum KernelEnvelopeModeV1 {
        NONE,
        REQUIRED
    }

    struct LaunchPermitV1 {
        uint64 githubRepositoryId;
        uint64 approvalGeneration;
        uint64 permitGeneration;
        uint64 notBefore;
        uint64 deadline;
        uint64 signerEpoch;
        uint256 nonce;
        uint256 chainId;
        bytes32 repositoryKey;
        address route;
        bytes32 routeId;
        address applicantWallet;
        bytes32 launchId;
        bytes32 approvalId;
        bytes32 technicalApprovalHash;
        bytes32 descriptorHash;
        bytes32 presentationBindingHash;
        bytes32 configurationHash;
        bytes32 walletOwnershipBindingHash;
        bytes32 executionPlanHash;
        /// @dev Raw Keccak-256 of the route-defined typed semantic execution-core preimage. The preimage excludes
        ///      this permit, every signature, release/kernel envelopes and the outer consume/launch wrappers.
        bytes32 executionCoreHash;
        /// @dev Raw Keccak-256 of the selector-included isolated downstream ABI calldata executed by the route.
        ///      It excludes this permit, every signature and the route/Authority wrapper calldata.
        bytes32 executionCalldataKeccak256;
        /// @dev Raw 32-byte SHA-256 of abi.encode(GENERATION_BINDING_TYPEHASH, every LaunchPermitV1 field in
        ///      declaration order except generationBindingHash). Never a UTF-8 "sha256:" tagged value.
        bytes32 generationBindingHash;
        uint256 executionValue;
        /// @dev Raw Keccak-256 of the exact typed ReleaseBindingV1 preimage.
        bytes32 releaseBindingHash;
        /// @dev Raw Keccak-256 of the exact typed KernelExecutionEnvelopeV1 preimage.
        bytes32 kernelExecutionEnvelopeHash;
    }

    struct ReleaseBindingV1 {
        uint64 authorityGeneration;
        uint64 releaseGeneration;
        address permitAuthority;
        bytes32 permitAuthorityRuntimeCodeHash;
        address launchRegistry;
        uint64 launchRegistryGeneration;
        bytes32 launchRegistryRuntimeCodeHash;
        bytes32 chainProfileHash;
        address profile;
        bytes32 profileId;
        bytes32 profileRuntimeCodeHash;
        /// @dev Exact immutable dependency/configuration binding read back from `profile` at activation and consume.
        bytes32 profileBindingHash;
        address route;
        bytes32 routeId;
        bytes32 routeRuntimeCodeHash;
        bytes32 executionAuthorityHash;
        KernelEnvelopeModeV1 kernelEnvelopeMode;
    }

    struct KernelExecutionEnvelopeV1 {
        bytes32 kernelGrantDigest;
        bytes32 reviewerCurrentnessDigest;
        bytes32 applicantWalletIntentDigest;
    }

    struct ActualExecutionV1 {
        address applicantWallet;
        bytes32 executionCoreHash;
        bytes32 executionCalldataKeccak256;
        uint256 executionValue;
    }

    struct PermitStatusV1 {
        PermitStateV1 state;
        bytes32 permitDigest;
        bytes32 repositoryKey;
        bytes32 launchId;
        bytes32 routeId;
        address route;
        address applicantWallet;
        uint64 approvalGeneration;
        uint64 permitGeneration;
        uint64 signerEpoch;
        uint64 deadline;
        uint64 stateChangedAtBlock;
        uint256 nonce;
        bytes32 reasonCode;
    }

    struct RepositoryConsumptionV1 {
        uint64 githubRepositoryId;
        uint64 approvalGeneration;
        uint64 permitGeneration;
        uint64 signerEpoch;
        uint64 consumedAtBlock;
        bytes32 permitDigest;
        bytes32 launchId;
        bytes32 routeId;
        address route;
        address applicantWallet;
        uint256 nonce;
    }

    struct SignerEpochV1 {
        address signer;
        bytes32 runtimeCodeHash;
        bool enabled;
        uint64 stateChangedAtBlock;
        bytes32 reasonCode;
    }

    struct ReleaseStatusV1 {
        bool active;
        uint64 releaseGeneration;
        uint64 stateChangedAtBlock;
        uint64 activeUntil;
        bytes32 reasonCode;
    }

    struct ApprovalGenerationCancellationV1 {
        bool cancelled;
        uint64 stateChangedAtBlock;
        bytes32 reasonCode;
        address cancelledBy;
    }

    event LaunchPermitConsumedV1(
        bytes32 indexed permitKey,
        bytes32 indexed repositoryKey,
        bytes32 indexed launchId,
        uint64 approvalGeneration,
        uint64 permitGeneration,
        uint256 nonce,
        uint64 signerEpoch,
        address route,
        bytes32 routeId,
        address applicantWallet,
        uint64 consumedAtBlock
    );

    event RepositoryLineageConsumedV1(
        bytes32 indexed repositoryKey,
        bytes32 indexed launchId,
        bytes32 indexed routeId,
        bytes32 permitKey,
        uint64 githubRepositoryId,
        address route,
        address applicantWallet,
        uint256 nonce,
        uint64 consumedAtBlock
    );

    event LaunchPermitCancelledV1(
        bytes32 indexed permitKey,
        bytes32 indexed repositoryKey,
        bytes32 indexed launchId,
        uint64 permitGeneration,
        uint256 nonce,
        uint64 signerEpoch,
        bytes32 reasonCode,
        address cancelledBy,
        uint64 cancelledAtBlock
    );

    event ApprovalGenerationCancelledV1(
        bytes32 indexed repositoryKey,
        uint64 indexed approvalGeneration,
        uint64 githubRepositoryId,
        bytes32 reasonCode,
        address cancelledBy,
        uint64 cancelledAtBlock
    );

    event SignerEpochCreatedV1(
        uint64 indexed signerEpoch, address indexed signer, bytes32 runtimeCodeHash, uint64 createdAtBlock
    );
    event SignerEpochDisabledV1(
        uint64 indexed signerEpoch, address indexed signer, bytes32 indexed reasonCode, uint64 disabledAtBlock
    );
    event ReleaseBindingActivatedV1(
        bytes32 indexed releaseBindingHash,
        uint64 indexed releaseGeneration,
        address indexed route,
        bytes32 routeId,
        uint64 activatedAtBlock
    );
    event ReleaseBindingDeactivatedV1(
        bytes32 indexed releaseBindingHash,
        uint64 indexed releaseGeneration,
        bytes32 indexed reasonCode,
        uint64 deactivatedAtBlock
    );
    event ReleaseBindingRetirementScheduledV1(
        bytes32 indexed releaseBindingHash,
        uint64 indexed releaseGeneration,
        uint64 activeUntil,
        uint64 scheduledAtBlock
    );
    event AuthorityPauseChangedV1(bool paused, address indexed changedBy);

    function consumePermit(
        LaunchPermitV1 calldata permit,
        ReleaseBindingV1 calldata releaseBinding,
        KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        bytes calldata permitSignature,
        ActualExecutionV1 calldata actualExecution
    ) external returns (bytes32 permitDigest, bytes32 repositoryKey, uint256 nonce);

    function cancelPermit(
        LaunchPermitV1 calldata permit,
        ReleaseBindingV1 calldata releaseBinding,
        KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        bytes32 reasonCode
    ) external returns (bytes32 permitDigest);

    function cancelApprovalGeneration(uint64 githubRepositoryId, uint64 approvalGeneration, bytes32 reasonCode) external;

    function createSignerEpoch(address expectedCurrentSigner, uint64 expectedCurrentEpoch, address newSigner)
        external
        returns (uint64 newSignerEpoch);
    function disableSignerEpoch(uint64 signerEpoch, bytes32 reasonCode) external;
    function activateReleaseBinding(ReleaseBindingV1 calldata releaseBinding)
        external
        returns (bytes32 releaseBindingHash);
    /// @notice Schedules retirement of one exact active release without affecting any other route or product.
    /// @dev `activeUntil` must be strictly in the future and no later than MAX_PERMIT_LIFETIME from now.
    function scheduleReleaseRetirement(bytes32 releaseBindingHash, uint64 activeUntil) external;
    function deactivateReleaseBinding(bytes32 releaseBindingHash, bytes32 reasonCode) external;
    function setPaused(bool paused_) external;

    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function hashPermit(LaunchPermitV1 calldata permit) external view returns (bytes32);
    function computeRepositoryKey(uint64 githubRepositoryId) external pure returns (bytes32);
    function computeGenerationBindingHash(LaunchPermitV1 calldata permit) external view returns (bytes32);
    function computeReleaseBindingHash(ReleaseBindingV1 calldata releaseBinding) external view returns (bytes32);
    function computeKernelExecutionEnvelopeHash(KernelExecutionEnvelopeV1 calldata kernelEnvelope)
        external
        view
        returns (bytes32);

    function permitStatus(bytes32 permitKey) external view returns (PermitStatusV1 memory);
    function repositoryConsumed(bytes32 repositoryKey) external view returns (bool);
    function repositoryConsumption(bytes32 repositoryKey) external view returns (RepositoryConsumptionV1 memory);
    function nextNonce(bytes32 repositoryKey) external view returns (uint256);
    function repositoryKeyByLaunchId(bytes32 launchId) external view returns (bytes32);
    function consumptionCount() external view returns (uint64);
    function signerEpochState(uint64 signerEpoch) external view returns (SignerEpochV1 memory);
    function currentSignerEpoch() external view returns (uint64);
    function releaseStatus(bytes32 releaseBindingHash) external view returns (ReleaseStatusV1 memory);
    function releaseBindingByHash(bytes32 releaseBindingHash) external view returns (ReleaseBindingV1 memory);
    function releaseBindingHashByGeneration(uint64 releaseGeneration) external view returns (bytes32);
    /// @notice Most recently activated release, provided only as an issuance/control-plane pointer.
    /// @dev Consumption is governed by each exact ReleaseStatusV1, not by this global pointer.
    function currentReleaseBindingHash() external view returns (bytes32);
    function currentReleaseGeneration() external view returns (uint64);
    function approvalGenerationCancelled(uint64 githubRepositoryId, uint64 approvalGeneration)
        external
        view
        returns (bool);
    function approvalGenerationCancellation(uint64 githubRepositoryId, uint64 approvalGeneration)
        external
        view
        returns (ApprovalGenerationCancellationV1 memory);

    function AUTHORITY_GENERATION() external view returns (uint64);
    function MAX_PERMIT_LIFETIME() external view returns (uint64);
    function paused() external view returns (bool);
    function CONSUMER_ROLE() external view returns (bytes32);
    function SIGNER_GOVERNOR_ROLE() external view returns (bytes32);
    function RELEASE_GOVERNOR_ROLE() external view returns (bytes32);
    function PAUSER_ROLE() external view returns (bytes32);
    function CANCELLER_ROLE() external view returns (bytes32);
    function PERMIT_VERIFIER() external view returns (address);
    function PERMIT_VERIFIER_RUNTIME_CODE_HASH() external view returns (bytes32);
}
