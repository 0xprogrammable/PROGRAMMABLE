// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {
    IProgrammableGithubRepositoryLineageRegistryV1
} from "./interfaces/IProgrammableGithubRepositoryLineageRegistryV1.sol";

/// @title ProgrammableGithubRepositoryLineageRegistryV1
/// @notice Shared, route-neutral one-launch authority for stable numeric GitHub repository IDs.
/// @dev Every launch route/factory must use the same deployed instance and consume in the launch transaction.
contract ProgrammableGithubRepositoryLineageRegistryV1 is
    AccessControlDefaultAdminRules,
    IProgrammableGithubRepositoryLineageRegistryV1
{
    using SafeCast for uint256;

    bytes32 public constant CONSUMER_ROLE = keccak256("programmable.github-repository-lineage.consumer.v1");

    uint64 public consumptionCount;
    mapping(bytes32 repositoryKey => RepositoryConsumptionV1 record) private _consumptions;
    mapping(bytes32 launchId => bytes32 repositoryKey) public repositoryKeyByLaunchId;

    error GithubRepositoryIdIsZero();
    error LaunchIdIsZero();
    error RouteIdIsZero();
    error RepositoryAlreadyConsumed(
        bytes32 repositoryKey, bytes32 existingLaunchId, bytes32 existingRouteId, address existingConsumer
    );
    error LaunchAlreadyConsumed(bytes32 launchId, bytes32 existingRepositoryKey);
    error ConsumerMustBeContract(address consumer);

    constructor(uint48 initialAdminDelay, address initialAdmin)
        AccessControlDefaultAdminRules(initialAdminDelay, initialAdmin)
    { }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlDefaultAdminRules)
        returns (bool)
    {
        return interfaceId == type(IProgrammableGithubRepositoryLineageRegistryV1).interfaceId
            || super.supportsInterface(interfaceId);
    }

    function consume(uint64 githubRepositoryId, bytes32 launchId, bytes32 routeId)
        external
        onlyRole(CONSUMER_ROLE)
        returns (bytes32 repositoryKey)
    {
        repositoryKey = _repositoryKey(githubRepositoryId);
        if (launchId == bytes32(0)) revert LaunchIdIsZero();
        if (routeId == bytes32(0)) revert RouteIdIsZero();

        RepositoryConsumptionV1 storage existing = _consumptions[repositoryKey];
        if (existing.launchId != bytes32(0)) {
            if (existing.launchId == launchId && existing.routeId == routeId && existing.consumer == msg.sender) {
                return repositoryKey;
            }
            revert RepositoryAlreadyConsumed(repositoryKey, existing.launchId, existing.routeId, existing.consumer);
        }

        bytes32 existingRepositoryKey = repositoryKeyByLaunchId[launchId];
        if (existingRepositoryKey != bytes32(0)) revert LaunchAlreadyConsumed(launchId, existingRepositoryKey);

        uint64 consumedAtBlock = block.number.toUint64();
        uint64 nextCount = consumptionCount + 1;
        _consumptions[repositoryKey] = RepositoryConsumptionV1({
            githubRepositoryId: githubRepositoryId,
            consumedAtBlock: consumedAtBlock,
            launchId: launchId,
            routeId: routeId,
            consumer: msg.sender
        });
        repositoryKeyByLaunchId[launchId] = repositoryKey;
        consumptionCount = nextCount;

        emit GithubRepositoryLineageConsumedV1(
            repositoryKey, launchId, routeId, githubRepositoryId, msg.sender, consumedAtBlock
        );
    }

    function computeRepositoryKey(uint64 githubRepositoryId) external pure returns (bytes32) {
        return _repositoryKey(githubRepositoryId);
    }

    function consumption(bytes32 repositoryKey) external view returns (RepositoryConsumptionV1 memory) {
        return _consumptions[repositoryKey];
    }

    function _repositoryKey(uint64 githubRepositoryId) private pure returns (bytes32) {
        if (githubRepositoryId == 0) revert GithubRepositoryIdIsZero();
        return keccak256(abi.encode("programmable.github.repository.v1", uint256(githubRepositoryId)));
    }

    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        // Role identity and deployed-code existence are intentionally exact authorization predicates;
        // neither comparison is time-based or an approximate numeric condition.
        // slither-disable-next-line incorrect-equality,timestamp
        if (role == CONSUMER_ROLE && account.code.length == 0) revert ConsumerMustBeContract(account);
        return super._grantRole(role, account);
    }
}
