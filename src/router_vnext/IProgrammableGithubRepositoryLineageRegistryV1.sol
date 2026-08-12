// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IProgrammableGithubRepositoryLineageRegistryV1
/// @notice Canonical cross-route authority that allows one successful launch per numeric GitHub repository lineage.
interface IProgrammableGithubRepositoryLineageRegistryV1 {
    struct RepositoryConsumptionV1 {
        uint64 githubRepositoryId;
        uint64 consumedAtBlock;
        bytes32 launchId;
        bytes32 routeId;
        address consumer;
    }

    event GithubRepositoryLineageConsumedV1(
        bytes32 indexed repositoryKey,
        bytes32 indexed launchId,
        bytes32 indexed routeId,
        uint64 githubRepositoryId,
        address consumer,
        uint64 consumedAtBlock
    );

    /// @notice Atomically consumes a repository lineage for one launch.
    /// @dev An exact retry by the same consumer and route is a no-op. Every non-exact duplicate reverts.
    function consume(uint64 githubRepositoryId, bytes32 launchId, bytes32 routeId)
        external
        returns (bytes32 repositoryKey);

    /// @notice The only canonical repository-key derivation.
    function computeRepositoryKey(uint64 githubRepositoryId) external pure returns (bytes32);

    function consumption(bytes32 repositoryKey) external view returns (RepositoryConsumptionV1 memory);

    function repositoryKeyByLaunchId(bytes32 launchId) external view returns (bytes32);

    function consumptionCount() external view returns (uint64);
}
