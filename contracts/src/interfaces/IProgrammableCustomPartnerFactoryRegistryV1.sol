// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IProgrammableCustomPartnerFactoryRegistryV1
/// @notice Exact provider-owned factory approvals used by the Custom launch registry.
interface IProgrammableCustomPartnerFactoryRegistryV1 {
    struct FactoryAuthorizationV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 configurationHash;
        bytes32 providerId;
        bytes32 modelId;
        bytes32 modelVersion;
        bytes32 templateId;
        bytes32 templateVersion;
        bytes32 modelRepositoryId;
        bytes32 modelSourceCommitId;
        bytes32 factorySourceRepositoryId;
        bytes32 factorySourceCommitId;
        address factory;
        bytes32 factoryRuntimeCodeHash;
        bytes32 launchRuntimeCodeSetHash;
        bytes32 permissionsHash;
        bytes32 feePolicyHash;
        uint64 validAfterBlock;
        uint64 expiresAtBlock;
        bytes32 evidenceHash;
    }

    struct FactoryStateV1 {
        bytes32 providerId;
        bytes32 modelId;
        bytes32 modelVersion;
        bytes32 templateId;
        bytes32 templateVersion;
        bytes32 modelRepositoryId;
        bytes32 modelSourceCommitId;
        bytes32 factorySourceRepositoryId;
        bytes32 factorySourceCommitId;
        address factory;
        bytes32 factoryRuntimeCodeHash;
        bytes32 launchRuntimeCodeSetHash;
        bytes32 permissionsHash;
        bytes32 feePolicyHash;
        uint64 validAfterBlock;
        uint64 expiresAtBlock;
        bytes32 evidenceHash;
        bool revoked;
    }

    struct RegistrationContextV1 {
        bytes32 configurationHash;
        bytes32 providerId;
        bytes32 modelId;
        bytes32 modelVersion;
        bytes32 templateId;
        bytes32 templateVersion;
        bytes32 modelRepositoryId;
        bytes32 modelSourceCommitId;
        bytes32 launchRuntimeCodeSetHash;
        bytes32 permissionsHash;
        bytes32 feePolicyHash;
    }

    event CustomPartnerFactoryAuthorizedV1(
        bytes32 indexed configurationHash,
        bytes32 indexed providerId,
        address indexed factory,
        bytes32 modelId,
        bytes32 modelVersion,
        bytes32 templateId,
        bytes32 templateVersion,
        uint64 validAfterBlock,
        uint64 expiresAtBlock,
        bytes32 evidenceHash
    );

    event CustomPartnerFactorySourceBoundV1(
        bytes32 indexed configurationHash,
        bytes32 indexed modelRepositoryId,
        bytes32 indexed modelSourceCommitId,
        bytes32 factorySourceRepositoryId,
        bytes32 factorySourceCommitId,
        bytes32 factoryRuntimeCodeHash,
        bytes32 launchRuntimeCodeSetHash,
        bytes32 permissionsHash,
        bytes32 feePolicyHash
    );

    event CustomPartnerFactoryRevokedV1(
        bytes32 indexed configurationHash,
        bytes32 indexed providerId,
        address indexed factory,
        bytes32 reasonCode,
        bytes32 evidenceHash
    );

    function authorizeFactory(FactoryAuthorizationV1 calldata authorization) external;
    function revokeFactory(bytes32 configurationHash, bytes32 reasonCode, bytes32 evidenceHash) external;
    function factoryState(bytes32 configurationHash) external view returns (FactoryStateV1 memory);
    function computeConfigurationHash(FactoryAuthorizationV1 calldata authorization) external pure returns (bytes32);
    function validateRegistration(address caller, RegistrationContextV1 calldata context) external view;
    function CHAIN_ID() external view returns (uint256);
    function REGISTRY_GENERATION() external view returns (uint64);
}
