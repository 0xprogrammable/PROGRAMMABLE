// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IProgrammableHookemonLaunchRegistryV1
/// @notice General Registry for exact reusable Hookemon launch releases.
interface IProgrammableHookemonLaunchRegistryV1 {
    struct TechnicalApprovalV1 {
        uint64 githubRepositoryId;
        bytes32 repositoryKey;
        bytes32 approvalId;
        bytes32 technicalApprovalHash;
        bytes32 approvedRepositoryHeadHash;
        bytes32 executableArtifactSourceHash;
        bytes32 exactContractBindingHash;
    }

    struct JitLaunchIdentityV1 {
        bytes32 launchId;
        address applicantWallet;
        bytes32 descriptorHash;
        bytes32 tokenNameHash;
        bytes32 tokenSymbolHash;
        bytes32 presentationBindingHash;
        bytes32 configurationHash;
        bytes32 executionPlanHash;
        bytes32 executionCoreHash;
        bytes32 executionCalldataKeccak256;
        bytes32 releaseBindingHash;
    }

    struct HookemonGraphV1 {
        address executor;
        bytes32 executorRuntimeCodeHash;
        address launcher;
        bytes32 launcherRuntimeCodeHash;
        address token;
        bytes32 tokenRuntimeCodeHash;
        address hook;
        bytes32 hookRuntimeCodeHash;
        address poolManager;
        bytes32 poolManagerRuntimeCodeHash;
        bytes32 canonicalPoolId;
        bytes32 componentGraphHash;
        bytes32 componentRuntimeSetHash;
        bytes32 architectureStateHash;
        bytes32 poolStateHash;
        bytes32 revenueStateHash;
        bytes32 revenueBindingHash;
    }

    struct LaunchRegistrationV1 {
        uint16 schemaVersion;
        uint256 chainId;
        uint64 registryGeneration;
        uint64 approvalGeneration;
        uint64 permitGeneration;
        uint256 permitNonce;
        bytes32 permitDigest;
        bytes32 routeId;
        bytes32 profileId;
        TechnicalApprovalV1 technicalApproval;
        JitLaunchIdentityV1 launchIdentity;
        HookemonGraphV1 graph;
        bytes32 registeredRecordCommitment;
    }

    struct LaunchStateV1 {
        bool registered;
        uint64 observedAtBlock;
        uint64 githubRepositoryId;
        uint64 approvalGeneration;
        uint64 permitGeneration;
        uint256 permitNonce;
        bytes32 repositoryKey;
        bytes32 permitDigest;
        bytes32 approvalId;
        bytes32 technicalApprovalHash;
        bytes32 routeId;
        bytes32 profileId;
        address applicantWallet;
        bytes32 registeredRecordCommitment;
    }

    struct TechnicalApprovalStateV1 {
        bytes32 launchId;
        TechnicalApprovalV1 approval;
    }

    event HookemonLaunchRegisteredV1(
        bytes32 indexed launchId,
        bytes32 indexed repositoryKey,
        bytes32 indexed permitDigest,
        address applicantWallet,
        bytes32 componentGraphHash,
        bytes32 registeredRecordCommitment,
        bytes32 revenueBindingHash,
        uint64 observedAtBlock
    );

    function registerLaunchFromConsumedPermitV1(LaunchRegistrationV1 calldata registration) external;
    function computeRepositoryKey(uint64 githubRepositoryId) external pure returns (bytes32 repositoryKey);
    function computeRegisteredRecordCommitmentV1(LaunchRegistrationV1 calldata registration)
        external
        pure
        returns (bytes32 registeredRecordCommitment);
    function computeTechnicalApprovalCommitmentV1(TechnicalApprovalV1 calldata technicalApproval)
        external
        pure
        returns (bytes32 technicalApprovalCommitment);
    function computeJitLaunchIdentityCommitmentV1(JitLaunchIdentityV1 calldata launchIdentity)
        external
        pure
        returns (bytes32 launchIdentityCommitment);
    function launchState(bytes32 launchId) external view returns (LaunchStateV1 memory state);
    function technicalApprovalState(bytes32 approvalId) external view returns (TechnicalApprovalStateV1 memory state);
    function launchIdentityState(bytes32 launchId) external view returns (JitLaunchIdentityV1 memory identity);
    function hookemonGraphState(bytes32 launchId) external view returns (HookemonGraphV1 memory graph);
    function launchIdByRepositoryKey(bytes32 repositoryKey) external view returns (bytes32 launchId);
    function launchIdByPermitDigest(bytes32 permitDigest) external view returns (bytes32 launchId);
    function launchIdByComponentGraphHash(bytes32 componentGraphHash) external view returns (bytes32 launchId);
    function repositoryKeyByLaunchId(bytes32 launchId) external view returns (bytes32 repositoryKey);
    function LAUNCH_PERMIT_AUTHORITY() external view returns (address);
    function REGISTRY_GENERATION() external view returns (uint64);
    function CHAIN_PROFILE_HASH() external view returns (bytes32);
    function LAUNCH_ROUTE() external view returns (address);
    function ROUTE_ID() external view returns (bytes32);
    function PROFILE_ID() external view returns (bytes32);
    function HOOKEMON_REVENUE_BINDING_HASH() external view returns (bytes32);
    function WRITER_ROLE() external view returns (bytes32);
    function hasRole(bytes32 role, address account) external view returns (bool);
    function runtimeBindingHashV1() external view returns (bytes32);
}
