// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import {
    ProgrammableGithubRepositoryLineageRegistryV1
} from "../../src/ProgrammableGithubRepositoryLineageRegistryV1.sol";
import {
    IProgrammableGithubRepositoryLineageRegistryV1
} from "../../src/interfaces/IProgrammableGithubRepositoryLineageRegistryV1.sol";

contract LineageInvariantRouteV1 {
    IProgrammableGithubRepositoryLineageRegistryV1 public immutable REGISTRY;
    bytes32 public immutable ROUTE_ID;

    constructor(IProgrammableGithubRepositoryLineageRegistryV1 registry, bytes32 routeId) {
        REGISTRY = registry;
        ROUTE_ID = routeId;
    }

    function consume(uint64 githubRepositoryId, bytes32 launchId) external returns (bytes32) {
        return REGISTRY.consume(githubRepositoryId, launchId, ROUTE_ID);
    }
}

contract LineageInvariantHandlerV1 is Test {
    ProgrammableGithubRepositoryLineageRegistryV1 public immutable REGISTRY;
    LineageInvariantRouteV1 public immutable ROUTE_A;
    LineageInvariantRouteV1 public immutable ROUTE_B;

    bytes32[] private _successfulRepositoryKeys;
    mapping(bytes32 repositoryKey => bool tracked) private _trackedRepositoryKeys;
    uint64 public successfulConsumptionCount;

    constructor(
        ProgrammableGithubRepositoryLineageRegistryV1 registry,
        LineageInvariantRouteV1 routeA,
        LineageInvariantRouteV1 routeB
    ) {
        REGISTRY = registry;
        ROUTE_A = routeA;
        ROUTE_B = routeB;
    }

    function consume(uint64 rawRepositoryId, bytes32 rawLaunchId, bool useRouteB) external {
        uint64 repositoryId = rawRepositoryId == 0 ? 1 : rawRepositoryId;
        bytes32 launchId = rawLaunchId == bytes32(0) ? keccak256(abi.encode(repositoryId, useRouteB)) : rawLaunchId;
        LineageInvariantRouteV1 route = useRouteB ? ROUTE_B : ROUTE_A;
        try route.consume(repositoryId, launchId) returns (bytes32 repositoryKey) {
            if (!_trackedRepositoryKeys[repositoryKey]) {
                _trackedRepositoryKeys[repositoryKey] = true;
                _successfulRepositoryKeys.push(repositoryKey);
                successfulConsumptionCount++;
            }
        } catch { }
    }

    function retryKnown(uint256 seed) external {
        if (_successfulRepositoryKeys.length == 0) return;
        bytes32 repositoryKey = _successfulRepositoryKeys[seed % _successfulRepositoryKeys.length];
        IProgrammableGithubRepositoryLineageRegistryV1.RepositoryConsumptionV1 memory record =
            REGISTRY.consumption(repositoryKey);
        LineageInvariantRouteV1 route = record.consumer == address(ROUTE_A) ? ROUTE_A : ROUTE_B;
        route.consume(record.githubRepositoryId, record.launchId);
    }

    function successfulRepositoryKeyAt(uint256 index) external view returns (bytes32) {
        return _successfulRepositoryKeys[index];
    }
}

contract ProgrammableGithubRepositoryLineageRegistryV1InvariantTest is StdInvariant, Test {
    address internal constant ADMIN = address(0xA11CE);

    ProgrammableGithubRepositoryLineageRegistryV1 internal registry;
    LineageInvariantRouteV1 internal routeA;
    LineageInvariantRouteV1 internal routeB;
    LineageInvariantHandlerV1 internal handler;

    function setUp() public {
        registry = new ProgrammableGithubRepositoryLineageRegistryV1(2 days, ADMIN);
        routeA = new LineageInvariantRouteV1(registry, keccak256("programmable.invariant.route-a.v1"));
        routeB = new LineageInvariantRouteV1(registry, keccak256("programmable.invariant.route-b.v1"));
        vm.startPrank(ADMIN);
        registry.grantRole(registry.CONSUMER_ROLE(), address(routeA));
        registry.grantRole(registry.CONSUMER_ROLE(), address(routeB));
        vm.stopPrank();

        handler = new LineageInvariantHandlerV1(registry, routeA, routeB);
        targetContract(address(handler));
    }

    function invariant_oneStoredRecordPerSuccessfulRepositoryKey() public view {
        uint64 count = registry.consumptionCount();
        assertEq(count, handler.successfulConsumptionCount());
        for (uint256 i; i < count; ++i) {
            bytes32 repositoryKey = handler.successfulRepositoryKeyAt(i);
            IProgrammableGithubRepositoryLineageRegistryV1.RepositoryConsumptionV1 memory record =
                registry.consumption(repositoryKey);
            assertNotEq(record.launchId, bytes32(0));
            assertEq(registry.repositoryKeyByLaunchId(record.launchId), repositoryKey);
            assertEq(registry.computeRepositoryKey(record.githubRepositoryId), repositoryKey);
            assertTrue(record.consumer == address(routeA) || record.consumer == address(routeB));
        }
    }
}
