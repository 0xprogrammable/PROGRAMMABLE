// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";

import { ProgrammableCreate2GraphDeployerV1 } from "../src/ProgrammableCreate2GraphDeployerV1.sol";

contract ProgrammableGraphNodeV1 {
    address public immutable self;
    address public immutable constructorDependency;
    address public immutable constructorCaller;
    uint256 public immutable constructorValue;
    address public initializerCaller;
    address public peer;
    uint256 public initializerValue;

    constructor(address dependency) payable {
        self = address(this);
        constructorDependency = dependency;
        constructorCaller = msg.sender;
        constructorValue = msg.value;
    }

    function initialize(address peer_) external payable {
        require(peer == address(0), "already initialized");
        initializerCaller = msg.sender;
        peer = peer_;
        initializerValue = msg.value;
    }
}

contract ProgrammableGraphRevertingInitializerV1 {
    error GraphInitializerFailure(bytes payload);

    function initialize() external pure {
        revert GraphInitializerFailure(new bytes(4096));
    }
}

contract ProgrammableGraphRevertingConstructorV1 {
    error GraphConstructorFailure();

    constructor() payable {
        revert GraphConstructorFailure();
    }
}

contract ProgrammableGraphForceEtherV1 {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}

contract ProgrammableGraphReentrantInitializerV1 {
    function initialize(address factory, bytes calldata nestedGraphCalldata) external {
        (bool success, bytes memory reason) = factory.call(nestedGraphCalldata);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(reason, 0x20), mload(reason))
            }
        }
    }
}

contract ProgrammableCreate2GraphDeployerV1Test is Test {
    ProgrammableCreate2GraphDeployerV1 private deployer;

    address private constant ATTACKER = address(0xBAD);
    bytes32 private constant ROUTE_NAMESPACE = keccak256("application-source-chain-launcher-route");
    bytes32 private constant ROUTE_NONCE = keccak256("pre-intent-route-nonce");
    bytes32 private constant TOPOLOGY_HASH = keccak256("reviewed-constructor-dag-and-initializer-graph");
    bytes32 private constant TARGET_A = keccak256("component:token");
    bytes32 private constant TARGET_B = keccak256("component:hook");
    bytes32 private constant SALT_A = keccak256("applicant:token");
    bytes32 private constant SALT_B = keccak256("applicant:hook");

    function setUp() external {
        deployer = new ProgrammableCreate2GraphDeployerV1();
        vm.deal(address(this), 100 ether);
        vm.deal(ATTACKER, 100 ether);
    }

    function testAtomicDagDeploysAllTargetsThenInitializesMutualReferencesAndMaterializesImmutables() external {
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization = authorizationFor(3 ether);
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets = new ProgrammableCreate2GraphDeployerV1.Target[](2);

        targets[0] = target(
            TARGET_A,
            SALT_A,
            1 ether,
            abi.encodePacked(type(ProgrammableGraphNodeV1).creationCode, abi.encode(address(0))),
            ""
        );
        address predictedA = deployer.predictTarget(authorization, targets[0]);
        targets[1] = target(
            TARGET_B,
            SALT_B,
            2 ether,
            abi.encodePacked(type(ProgrammableGraphNodeV1).creationCode, abi.encode(predictedA)),
            ""
        );
        address predictedB = deployer.predictTarget(authorization, targets[1]);
        targets[0].initializerCalldata = abi.encodeCall(ProgrammableGraphNodeV1.initialize, (predictedB));
        targets[1].initializerCalldata = abi.encodeCall(ProgrammableGraphNodeV1.initialize, (predictedA));
        authorization = withReviewedCommitment(authorization, targets);

        vm.recordLogs();
        (
            address[] memory deployments,
            bytes32[] memory runtimeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        ) = deployer.deployGraph{ value: 3 ether }(authorization, targets);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(deployments.length, 2);
        assertEq(deployments[0], predictedA);
        assertEq(deployments[1], predictedB);
        assertEq(runtimeHashes.length, 2);
        assertEq(runtimeCodes.length, 2);
        assertEq(runtimeHashes[0], keccak256(runtimeCodes[0]));
        assertEq(runtimeHashes[1], keccak256(runtimeCodes[1]));
        assertEq(keccak256(predictedA.code), runtimeHashes[0]);
        assertEq(keccak256(predictedB.code), runtimeHashes[1]);
        assertNotEq(runtimeHashes[0], runtimeHashes[1]);
        assertEq(predictedA.balance, 1 ether);
        assertEq(predictedB.balance, 2 ether);
        assertEq(address(deployer).balance, 0);

        ProgrammableGraphNodeV1 nodeA = ProgrammableGraphNodeV1(payable(predictedA));
        ProgrammableGraphNodeV1 nodeB = ProgrammableGraphNodeV1(payable(predictedB));
        assertEq(nodeA.self(), predictedA);
        assertEq(nodeB.self(), predictedB);
        assertEq(nodeA.constructorDependency(), address(0));
        assertEq(nodeB.constructorDependency(), predictedA);
        assertEq(nodeA.constructorCaller(), address(deployer));
        assertEq(nodeB.constructorCaller(), address(deployer));
        assertEq(nodeA.initializerCaller(), address(deployer));
        assertEq(nodeB.initializerCaller(), address(deployer));
        assertEq(nodeA.peer(), predictedB);
        assertEq(nodeB.peer(), predictedA);

        assertEq(logs.length, 3);
        bytes32 targetTopic = keccak256(
            "ProgrammableCreate2GraphTargetDeployed(bytes32,bytes32,address,uint256,bytes32,bytes32,bytes32,bytes32,uint256,uint256)"
        );
        bytes32 summaryTopic = keccak256(
            "ProgrammableCreate2GraphDeployed(bytes32,bytes32,bytes32,bytes32,bytes32,address,uint256,uint256)"
        );
        assertEq(logs[0].topics[0], targetTopic);
        assertEq(logs[1].topics[0], targetTopic);
        assertEq(logs[2].topics[0], summaryTopic);
        assertEq(logs[2].topics[1], ROUTE_NAMESPACE);
        assertEq(logs[2].topics[2], authorization.graphCommitment);
        assertEq(logs[2].topics[3], graphDeploymentHash);
    }

    function testInitializerFailureRollsBackEveryDeploymentValueAndAuthorizationConsumption() external {
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization = authorizationFor(1 ether);
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets = new ProgrammableCreate2GraphDeployerV1.Target[](2);
        targets[0] = target(
            TARGET_A,
            SALT_A,
            1 ether,
            abi.encodePacked(type(ProgrammableGraphNodeV1).creationCode, abi.encode(address(0))),
            ""
        );
        targets[1] = target(
            TARGET_B,
            SALT_B,
            0,
            type(ProgrammableGraphRevertingInitializerV1).creationCode,
            abi.encodeCall(ProgrammableGraphRevertingInitializerV1.initialize, ())
        );
        address predictedA = deployer.predictTarget(authorization, targets[0]);
        address predictedB = deployer.predictTarget(authorization, targets[1]);
        authorization = withReviewedCommitment(authorization, targets);
        bytes32 authorizationKey = deployer.graphAuthorizationKey(authorization);

        (bool success, bytes memory revertData) = address(deployer).call{ value: 1 ether }(
            abi.encodeCall(ProgrammableCreate2GraphDeployerV1.deployGraph, (authorization, targets))
        );

        assertFalse(success);
        assertEq(bytes4(revertData), ProgrammableCreate2GraphDeployerV1.InitializerCallFailed.selector);
        assertEq(predictedA.code.length, 0);
        assertEq(predictedB.code.length, 0);
        assertEq(predictedA.balance, 0);
        assertEq(address(deployer).balance, 0);
        assertFalse(deployer.consumedGraphAuthorization(authorizationKey));
    }

    function testConstructorFailureRollsBackEarlierTargets() external {
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization = authorizationFor(1 ether);
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets = new ProgrammableCreate2GraphDeployerV1.Target[](2);
        targets[0] = target(
            TARGET_A,
            SALT_A,
            1 ether,
            abi.encodePacked(type(ProgrammableGraphNodeV1).creationCode, abi.encode(address(0))),
            ""
        );
        targets[1] = target(TARGET_B, SALT_B, 0, type(ProgrammableGraphRevertingConstructorV1).creationCode, "");
        address predictedA = deployer.predictTarget(authorization, targets[0]);
        authorization = withReviewedCommitment(authorization, targets);

        vm.expectPartialRevert(ProgrammableCreate2GraphDeployerV1.DeploymentAddressMismatch.selector);
        deployer.deployGraph{ value: 1 ether }(authorization, targets);
        assertEq(predictedA.code.length, 0);
        assertEq(predictedA.balance, 0);
        assertFalse(deployer.consumedGraphAuthorization(deployer.graphAuthorizationKey(authorization)));
    }

    function testCopiedGraphCannotFrontRunAuthorizedLauncher() external {
        (
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
            ProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = oneTargetGraph(0);
        vm.prank(ATTACKER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCreate2GraphDeployerV1.UnauthorizedLauncher.selector, ATTACKER, address(this)
            )
        );
        deployer.deployGraph(authorization, targets);

        (address[] memory deployments,,,) = deployer.deployGraph(authorization, targets);
        assertEq(deployments.length, 1);
    }

    function testGraphAuthorizationIsOneUse() external {
        (
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
            ProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = oneTargetGraph(0);
        bytes32 authorizationKey = deployer.graphAuthorizationKey(authorization);
        deployer.deployGraph(authorization, targets);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCreate2GraphDeployerV1.GraphAuthorizationAlreadyConsumed.selector, authorizationKey
            )
        );
        deployer.deployGraph(authorization, targets);
    }

    function testGraphCommitmentAndValueSubstitutionFailClosed() external {
        (
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
            ProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = oneTargetGraph(1 ether);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCreate2GraphDeployerV1.GraphValueMismatch.selector, 0, 1 ether)
        );
        deployer.deployGraph(authorization, targets);

        authorization.totalValue = 0;
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCreate2GraphDeployerV1.GraphTargetValueSumMismatch.selector, 1 ether, 0)
        );
        deployer.deployGraph(authorization, targets);

        authorization.totalValue = 1 ether;
        authorization.graphCommitment = bytes32(uint256(authorization.graphCommitment) ^ 1);
        vm.expectPartialRevert(ProgrammableCreate2GraphDeployerV1.GraphCommitmentMismatch.selector);
        deployer.deployGraph{ value: 1 ether }(authorization, targets);
    }

    function testDuplicateTargetIdRejectsButApplicantSaltReuseIsAllowed() external {
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization = authorizationFor(0);
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets = new ProgrammableCreate2GraphDeployerV1.Target[](2);
        bytes memory initCode = abi.encodePacked(type(ProgrammableGraphNodeV1).creationCode, abi.encode(address(0)));
        targets[0] = target(TARGET_A, SALT_A, 0, initCode, "");
        targets[1] = target(TARGET_A, SALT_B, 0, initCode, "");
        authorization = withReviewedCommitment(authorization, targets);
        vm.expectPartialRevert(ProgrammableCreate2GraphDeployerV1.DuplicateTargetId.selector);
        deployer.deployGraph(authorization, targets);

        targets[1] = target(TARGET_B, SALT_A, 0, initCode, "");
        authorization = withReviewedCommitment(authorization, targets);
        (address[] memory deployments,,,) = deployer.deployGraph(authorization, targets);
        assertEq(deployments.length, 2);
        assertNotEq(deployments[0], deployments[1]);
    }

    function testPayableInitializerValueIsExactAndSeparateFromConstructorValue() external {
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization = authorizationFor(1 ether);
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets = new ProgrammableCreate2GraphDeployerV1.Target[](1);
        targets[0] = target(
            TARGET_A,
            SALT_A,
            0,
            abi.encodePacked(type(ProgrammableGraphNodeV1).creationCode, abi.encode(address(0))),
            abi.encodeCall(ProgrammableGraphNodeV1.initialize, (address(0xBEEF)))
        );
        targets[0].initializerValue = 1 ether;
        authorization = withReviewedCommitment(authorization, targets);

        (address[] memory deployments,,,) = deployer.deployGraph{ value: 1 ether }(authorization, targets);
        ProgrammableGraphNodeV1 node = ProgrammableGraphNodeV1(payable(deployments[0]));
        assertEq(node.constructorValue(), 0);
        assertEq(node.initializerValue(), 1 ether);
        assertEq(node.peer(), address(0xBEEF));
        assertEq(deployments[0].balance, 1 ether);
        assertEq(address(deployer).balance, 0);
    }

    function testNestedGraphSessionIsRejectedAndOuterGraphRollsBack() external {
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory outer = authorizationFor(0);
        ProgrammableCreate2GraphDeployerV1.Target[] memory outerTargets =
            new ProgrammableCreate2GraphDeployerV1.Target[](1);
        outerTargets[0] = target(TARGET_A, SALT_A, 0, type(ProgrammableGraphReentrantInitializerV1).creationCode, "");
        address predictedOuter = deployer.predictTarget(outer, outerTargets[0]);

        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory nested =
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization({
                routeNamespace: keccak256("nested-route"),
                routeNonce: keccak256("nested-nonce"),
                topologyHash: keccak256("nested-topology"),
                graphCommitment: bytes32(0),
                authorizedLauncher: predictedOuter,
                totalValue: 0
            });
        ProgrammableCreate2GraphDeployerV1.Target[] memory nestedTargets =
            new ProgrammableCreate2GraphDeployerV1.Target[](1);
        nestedTargets[0] = target(
            TARGET_B,
            SALT_B,
            0,
            abi.encodePacked(type(ProgrammableGraphNodeV1).creationCode, abi.encode(address(0))),
            ""
        );
        nested = withReviewedCommitment(nested, nestedTargets);
        bytes memory nestedCalldata =
            abi.encodeCall(ProgrammableCreate2GraphDeployerV1.deployGraph, (nested, nestedTargets));
        outerTargets[0].initializerCalldata =
            abi.encodeCall(ProgrammableGraphReentrantInitializerV1.initialize, (address(deployer), nestedCalldata));
        outer = withReviewedCommitment(outer, outerTargets);

        (bool success, bytes memory revertData) = address(deployer)
            .call(abi.encodeCall(ProgrammableCreate2GraphDeployerV1.deployGraph, (outer, outerTargets)));
        assertFalse(success);
        assertEq(bytes4(revertData), ProgrammableCreate2GraphDeployerV1.InitializerCallFailed.selector);
        assertEq(predictedOuter.code.length, 0);
        assertFalse(deployer.consumedGraphAuthorization(deployer.graphAuthorizationKey(outer)));
        assertFalse(deployer.consumedGraphAuthorization(deployer.graphAuthorizationKey(nested)));
    }

    function testSameRouteNonceCannotAuthorizeASecondDifferentGraph() external {
        (
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory first,
            ProgrammableCreate2GraphDeployerV1.Target[] memory firstTargets
        ) = oneTargetGraph(0);
        bytes32 routeKey = deployer.graphAuthorizationKey(first);
        deployer.deployGraph(first, firstTargets);

        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory second = first;
        second.topologyHash = keccak256("different-reviewed-topology");
        ProgrammableCreate2GraphDeployerV1.Target[] memory secondTargets =
            new ProgrammableCreate2GraphDeployerV1.Target[](1);
        secondTargets[0] = target(
            TARGET_B,
            SALT_B,
            0,
            abi.encodePacked(type(ProgrammableGraphNodeV1).creationCode, abi.encode(address(0))),
            ""
        );
        second = withReviewedCommitment(second, secondTargets);
        assertEq(deployer.graphAuthorizationKey(second), routeKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCreate2GraphDeployerV1.GraphAuthorizationAlreadyConsumed.selector, routeKey
            )
        );
        deployer.deployGraph(second, secondTargets);
    }

    function testTargetCountCapAndEmptyGraphFailBeforeDeployment() external {
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization = authorizationFor(0);
        ProgrammableCreate2GraphDeployerV1.Target[] memory empty = new ProgrammableCreate2GraphDeployerV1.Target[](0);
        vm.expectRevert(ProgrammableCreate2GraphDeployerV1.EmptyGraph.selector);
        deployer.computeGraphCommitment(authorization, empty);

        ProgrammableCreate2GraphDeployerV1.Target[] memory tooMany = new ProgrammableCreate2GraphDeployerV1.Target[](17);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCreate2GraphDeployerV1.GraphTargetLimitExceeded.selector, 17, 16)
        );
        deployer.computeGraphCommitment(authorization, tooMany);
    }

    function testForcedEtherIsInertAndNeverDistributedToGraphTargets() external {
        new ProgrammableGraphForceEtherV1{ value: 0.5 ether }(payable(address(deployer)));
        (
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
            ProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = oneTargetGraph(1 ether);
        (address[] memory deployments,,,) = deployer.deployGraph{ value: 1 ether }(authorization, targets);
        assertEq(deployments[0].balance, 1 ether);
        assertEq(address(deployer).balance, 0.5 ether);
    }

    function oneTargetGraph(uint256 value)
        private
        view
        returns (
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
            ProgrammableCreate2GraphDeployerV1.Target[] memory targets
        )
    {
        authorization = authorizationFor(value);
        targets = new ProgrammableCreate2GraphDeployerV1.Target[](1);
        targets[0] = target(
            TARGET_A,
            SALT_A,
            value,
            abi.encodePacked(type(ProgrammableGraphNodeV1).creationCode, abi.encode(address(0))),
            ""
        );
        authorization = withReviewedCommitment(authorization, targets);
    }

    function authorizationFor(uint256 totalValue)
        private
        view
        returns (ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory)
    {
        return ProgrammableCreate2GraphDeployerV1.GraphAuthorization({
            routeNamespace: ROUTE_NAMESPACE,
            routeNonce: ROUTE_NONCE,
            topologyHash: TOPOLOGY_HASH,
            graphCommitment: bytes32(0),
            authorizedLauncher: address(this),
            totalValue: totalValue
        });
    }

    function withReviewedCommitment(
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets
    ) private view returns (ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory) {
        (authorization.graphCommitment,) = deployer.computeGraphCommitment(authorization, targets);
        return authorization;
    }

    function target(
        bytes32 targetIdHash,
        bytes32 applicantSalt,
        uint256 value,
        bytes memory initCode,
        bytes memory initializerCalldata
    ) private pure returns (ProgrammableCreate2GraphDeployerV1.Target memory) {
        return ProgrammableCreate2GraphDeployerV1.Target({
                targetIdHash: targetIdHash,
                applicantSalt: applicantSalt,
                deploymentValue: value,
                initializerValue: 0,
                initCode: initCode,
                initializerCalldata: initializerCalldata
            });
    }
}
