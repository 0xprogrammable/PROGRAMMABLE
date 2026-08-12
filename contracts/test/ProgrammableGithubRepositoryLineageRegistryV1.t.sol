// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Test } from "forge-std/Test.sol";

import {
    ProgrammableGithubRepositoryLineageRegistryV1
} from "../src/ProgrammableGithubRepositoryLineageRegistryV1.sol";
import {
    IProgrammableGithubRepositoryLineageRegistryV1
} from "../src/interfaces/IProgrammableGithubRepositoryLineageRegistryV1.sol";

contract MockRepositoryRouteConsumerV1 {
    IProgrammableGithubRepositoryLineageRegistryV1 public immutable REGISTRY;
    bytes32 public immutable ROUTE_ID;
    uint256 public irreversibleExecutionCount;

    error MockRouteExecutionReverted();

    constructor(IProgrammableGithubRepositoryLineageRegistryV1 registry, bytes32 routeId) {
        REGISTRY = registry;
        ROUTE_ID = routeId;
    }

    function consumeOnly(uint64 githubRepositoryId, bytes32 launchId) external returns (bytes32) {
        return REGISTRY.consume(githubRepositoryId, launchId, ROUTE_ID);
    }

    function consumeThenExecute(uint64 githubRepositoryId, bytes32 launchId, bool revertAfterConsume) external {
        REGISTRY.consume(githubRepositoryId, launchId, ROUTE_ID);
        if (revertAfterConsume) revert MockRouteExecutionReverted();
        irreversibleExecutionCount++;
    }
}

contract ProgrammableGithubRepositoryLineageRegistryV1Test is Test {
    address internal constant ADMIN = address(0xA11CE);
    uint64 internal constant SHARDS_GITHUB_REPOSITORY_ID = 1_329_073_878;
    uint64 internal constant HOOKEMON_GITHUB_REPOSITORY_ID = 1_324_982_531;
    bytes32 internal constant SHARDS_REPOSITORY_KEY =
        0x02ed38e86a7c41d5dea93cf5e3f829420837c4d351d9f4675929c6ce0041e835;
    bytes32 internal constant HOOKEMON_REPOSITORY_KEY =
        0x85af67313879b9844f94b66f3eb6bdc2f200e2647507f73f43242a576580961b;
    bytes32 internal constant MIN_REPOSITORY_KEY = 0x84f907641e97fb220312430fcf0f98c1d513664a984d99df24aee57c226d174c;
    bytes32 internal constant MAX_REPOSITORY_KEY = 0x97316281428a106b570b0e26031c4ae18b9e959742ea4cc41c1e7cd43b921dfb;
    bytes32 internal constant ROUTE_A_ID = keccak256("programmable.mock.route-a.v1");
    bytes32 internal constant ROUTE_B_ID = keccak256("programmable.mock.route-b.v1");

    ProgrammableGithubRepositoryLineageRegistryV1 internal registry;
    MockRepositoryRouteConsumerV1 internal routeA;
    MockRepositoryRouteConsumerV1 internal routeB;

    function setUp() public {
        vm.roll(100);
        registry = new ProgrammableGithubRepositoryLineageRegistryV1(2 days, ADMIN);
        routeA = new MockRepositoryRouteConsumerV1(registry, ROUTE_A_ID);
        routeB = new MockRepositoryRouteConsumerV1(registry, ROUTE_B_ID);

        vm.startPrank(ADMIN);
        registry.grantRole(registry.CONSUMER_ROLE(), address(routeA));
        registry.grantRole(registry.CONSUMER_ROLE(), address(routeB));
        vm.stopPrank();
    }

    function test_exactOffchainRepositoryKeyVectorUsesLiteralDomainAndUint256Slot() public view {
        assertEq(registry.computeRepositoryKey(SHARDS_GITHUB_REPOSITORY_ID), SHARDS_REPOSITORY_KEY);
        assertEq(
            SHARDS_REPOSITORY_KEY,
            keccak256(abi.encode("programmable.github.repository.v1", uint256(SHARDS_GITHUB_REPOSITORY_ID)))
        );
    }

    function test_offchainRepositoryKeyVectorsCoverAllowedUint64RangeAndBothCanaries() public view {
        assertEq(registry.computeRepositoryKey(1), MIN_REPOSITORY_KEY);
        assertEq(registry.computeRepositoryKey(SHARDS_GITHUB_REPOSITORY_ID), SHARDS_REPOSITORY_KEY);
        assertEq(registry.computeRepositoryKey(HOOKEMON_GITHUB_REPOSITORY_ID), HOOKEMON_REPOSITORY_KEY);
        assertEq(registry.computeRepositoryKey(type(uint64).max), MAX_REPOSITORY_KEY);
    }

    function test_machineCheckableSpecKeepsCanonicalDeploymentUnsetAndActivationFalse() public view {
        string memory json =
            vm.readFile(string.concat(vm.projectRoot(), "/spec/github-repository-lineage-registry-v1.json"));
        assertEq(vm.parseJsonString(json, ".schemaVersion"), "programmable.github-repository-lineage-registry.v1");
        assertEq(vm.parseJsonString(json, ".status"), "IMPLEMENTATION_READY_NOT_DEPLOYED");
        assertFalse(vm.parseJsonBool(json, ".activationAllowed"));
        assertEq(vm.parseJsonString(json, ".deployment.addressState"), "UNSET");
        assertEq(vm.parseJsonString(json, ".authority.authorizedConsumerState"), "NONE_UNTIL_CANONICAL_DEPLOYMENT");
        assertEq(vm.parseJsonUint(json, ".repositoryKey.allowedRange.minimum"), 1);
        assertEq(vm.parseJsonString(json, ".repositoryKey.allowedRange.maximum"), "18446744073709551615");
        assertTrue(vm.parseJsonBool(json, ".repositoryKey.allowedRange.approvalDatabaseMustEnforceSameRange"));
        assertEq(vm.parseJsonUint(json, ".repositoryKey.knownVectors[0].githubRepositoryId"), 1);
        assertEq(vm.parseJsonBytes32(json, ".repositoryKey.knownVectors[0].repositoryKey"), MIN_REPOSITORY_KEY);
        assertEq(
            vm.parseJsonUint(json, ".repositoryKey.knownVectors[1].githubRepositoryId"), SHARDS_GITHUB_REPOSITORY_ID
        );
        assertEq(vm.parseJsonBytes32(json, ".repositoryKey.knownVectors[1].repositoryKey"), SHARDS_REPOSITORY_KEY);
        assertEq(
            vm.parseJsonUint(json, ".repositoryKey.knownVectors[2].githubRepositoryId"), HOOKEMON_GITHUB_REPOSITORY_ID
        );
        assertEq(vm.parseJsonBytes32(json, ".repositoryKey.knownVectors[2].repositoryKey"), HOOKEMON_REPOSITORY_KEY);
        assertEq(vm.parseJsonString(json, ".repositoryKey.knownVectors[3].githubRepositoryId"), "18446744073709551615");
        assertEq(vm.parseJsonBytes32(json, ".repositoryKey.knownVectors[3].repositoryKey"), MAX_REPOSITORY_KEY);
        assertTrue(vm.parseJsonBool(json, ".semantics.oneSuccessfulLaunchPerRepositoryLineage"));
        assertTrue(vm.parseJsonBool(json, ".semantics.crossRouteAndFactoryAuthority"));
        assertFalse(vm.parseJsonBool(json, ".implementation.compiler.viaIr"));
        assertEq(vm.parseJsonUint(json, ".implementation.compiler.optimizerRuns"), 1000);
        assertEq(
            keccak256(type(ProgrammableGithubRepositoryLineageRegistryV1).creationCode),
            vm.parseJsonBytes32(json, ".implementation.artifact.creationCodeKeccak256")
        );
        string memory buildArtifact = vm.readFile(
            string.concat(
                vm.projectRoot(),
                "/out/ProgrammableGithubRepositoryLineageRegistryV1.sol/ProgrammableGithubRepositoryLineageRegistryV1.json"
            )
        );
        bytes memory unlinkedRuntime = vm.parseBytes(vm.parseJsonString(buildArtifact, ".deployedBytecode.object"));
        assertEq(
            keccak256(unlinkedRuntime),
            vm.parseJsonBytes32(json, ".implementation.artifact.unlinkedRuntimeCodeKeccak256")
        );
        assertEq(
            unlinkedRuntime.length, vm.parseJsonUint(json, ".implementation.artifact.unlinkedRuntimeCodeByteLength")
        );
        assertEq(
            24_576 - unlinkedRuntime.length,
            vm.parseJsonUint(json, ".implementation.artifact.runtimeCodeLimitMarginBytes")
        );
    }

    function test_twoAuthorizedConsumersCannotLaunchSameRepositoryLineage() public {
        bytes32 firstLaunchId = keccak256("first-launch");
        bytes32 secondLaunchId = keccak256("second-launch");
        routeA.consumeThenExecute(SHARDS_GITHUB_REPOSITORY_ID, firstLaunchId, false);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableGithubRepositoryLineageRegistryV1.RepositoryAlreadyConsumed.selector,
                SHARDS_REPOSITORY_KEY,
                firstLaunchId,
                ROUTE_A_ID,
                address(routeA)
            )
        );
        routeB.consumeThenExecute(SHARDS_GITHUB_REPOSITORY_ID, secondLaunchId, false);

        assertEq(routeA.irreversibleExecutionCount(), 1);
        assertEq(routeB.irreversibleExecutionCount(), 0);
        assertEq(registry.consumptionCount(), 1);
    }

    function test_exactReceiptRetryIsIdempotentAndCannotCreateSecondConsumption() public {
        bytes32 launchId = keccak256("same-receipt");
        assertEq(routeA.consumeOnly(SHARDS_GITHUB_REPOSITORY_ID, launchId), SHARDS_REPOSITORY_KEY);
        assertEq(routeA.consumeOnly(SHARDS_GITHUB_REPOSITORY_ID, launchId), SHARDS_REPOSITORY_KEY);
        assertEq(registry.consumptionCount(), 1);

        IProgrammableGithubRepositoryLineageRegistryV1.RepositoryConsumptionV1 memory record =
            registry.consumption(SHARDS_REPOSITORY_KEY);
        assertEq(record.githubRepositoryId, SHARDS_GITHUB_REPOSITORY_ID);
        assertEq(record.launchId, launchId);
        assertEq(record.routeId, ROUTE_A_ID);
        assertEq(record.consumer, address(routeA));
        assertEq(record.consumedAtBlock, 100);
        assertEq(registry.repositoryKeyByLaunchId(launchId), SHARDS_REPOSITORY_KEY);
    }

    function test_revertAfterConsumeRollsBackAndAllowsLaterRetry() public {
        bytes32 launchId = keccak256("rollback-retry");
        vm.expectRevert(MockRepositoryRouteConsumerV1.MockRouteExecutionReverted.selector);
        routeA.consumeThenExecute(SHARDS_GITHUB_REPOSITORY_ID, launchId, true);

        assertEq(registry.consumptionCount(), 0);
        assertEq(registry.repositoryKeyByLaunchId(launchId), bytes32(0));
        assertEq(registry.consumption(SHARDS_REPOSITORY_KEY).launchId, bytes32(0));

        routeB.consumeThenExecute(SHARDS_GITHUB_REPOSITORY_ID, launchId, false);
        assertEq(registry.consumptionCount(), 1);
        assertEq(routeB.irreversibleExecutionCount(), 1);
    }

    function test_sameLaunchIdCannotConsumeTwoRepositories() public {
        bytes32 launchId = keccak256("one-launch-id");
        routeA.consumeOnly(SHARDS_GITHUB_REPOSITORY_ID, launchId);
        uint64 otherRepositoryId = SHARDS_GITHUB_REPOSITORY_ID + 1;
        bytes32 existingKey = registry.computeRepositoryKey(SHARDS_GITHUB_REPOSITORY_ID);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableGithubRepositoryLineageRegistryV1.LaunchAlreadyConsumed.selector, launchId, existingKey
            )
        );
        routeA.consumeOnly(otherRepositoryId, launchId);
    }

    function test_unauthorizedCallerCannotConsume() public {
        bytes32 launchId = keccak256("unauthorized");
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), registry.CONSUMER_ROLE()
            )
        );
        registry.consume(SHARDS_GITHUB_REPOSITORY_ID, launchId, ROUTE_A_ID);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ADMIN, registry.CONSUMER_ROLE()
            )
        );
        vm.prank(ADMIN);
        registry.consume(SHARDS_GITHUB_REPOSITORY_ID, launchId, ROUTE_A_ID);
    }

    function test_adminCannotGrantConsumerRoleToEoaOrItself() public {
        bytes32 consumerRole = registry.CONSUMER_ROLE();
        vm.startPrank(ADMIN);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableGithubRepositoryLineageRegistryV1.ConsumerMustBeContract.selector, address(0xBEEF)
            )
        );
        registry.grantRole(consumerRole, address(0xBEEF));
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableGithubRepositoryLineageRegistryV1.ConsumerMustBeContract.selector, ADMIN)
        );
        registry.grantRole(consumerRole, ADMIN);
        vm.stopPrank();
    }

    function testFuzz_distinctRepositoryIdsProduceDistinctKeysAndRecords(uint64 firstId, uint64 secondId) public {
        firstId = uint64(bound(firstId, 1, type(uint64).max));
        secondId = uint64(bound(secondId, 1, type(uint64).max));
        vm.assume(firstId != secondId);

        bytes32 firstKey = routeA.consumeOnly(firstId, keccak256(abi.encode("first", firstId)));
        bytes32 secondKey = routeB.consumeOnly(secondId, keccak256(abi.encode("second", secondId)));
        assertNotEq(firstKey, secondKey);
        assertEq(registry.consumption(firstKey).githubRepositoryId, firstId);
        assertEq(registry.consumption(secondKey).githubRepositoryId, secondId);
        assertEq(registry.consumptionCount(), 2);
    }
}
