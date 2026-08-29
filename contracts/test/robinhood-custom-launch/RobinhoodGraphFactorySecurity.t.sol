// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProgrammableCreate2GraphDeployerV1 } from "../../src/ProgrammableCreate2GraphDeployerV1.sol";

contract RobinhoodGraphInitializationRecorder {
    bytes32[] internal _order;

    function record(bytes32 targetIdHash) external {
        _order.push(targetIdHash);
    }

    function at(uint256 index) external view returns (bytes32) {
        return _order[index];
    }

    function length() external view returns (uint256) {
        return _order.length;
    }
}

contract RobinhoodGraphInitializableProbe {
    RobinhoodGraphInitializationRecorder public immutable recorder;
    bool public initialized;

    constructor(RobinhoodGraphInitializationRecorder recorder_) {
        recorder = recorder_;
    }

    function initialize(bytes32 targetIdHash) external {
        require(!initialized, "already initialized");
        initialized = true;
        recorder.record(targetIdHash);
    }
}

contract RobinhoodGraphFactorySecurityTest is Test {
    bytes32 internal constant ROUTE_NAMESPACE = keccak256("robinhood-custom-launch-v4");
    bytes32 internal constant ROUTE_NONCE = keccak256("launch-request-1");
    bytes32 internal constant TOPOLOGY_HASH = keccak256("target-a-before-target-b");
    bytes32 internal constant TARGET_A = keccak256("target-a");
    bytes32 internal constant TARGET_B = keccak256("target-b");

    ProgrammableCreate2GraphDeployerV1 internal factory;
    RobinhoodGraphInitializationRecorder internal recorder;

    function setUp() public {
        vm.chainId(4663);
        factory = new ProgrammableCreate2GraphDeployerV1();
        recorder = new RobinhoodGraphInitializationRecorder();
    }

    function test_create2PredictionsInitializationOrderAndReplayProtection() public {
        (
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
            ProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _reviewedGraph();

        address predictedA = factory.predictTarget(authorization, targets[0]);
        address predictedB = factory.predictTarget(authorization, targets[1]);
        bytes32 authorizationKey = factory.graphAuthorizationKey(authorization);

        (address[] memory deployments,, bytes[] memory runtimeCodes,) = factory.deployGraph(authorization, targets);

        assertEq(deployments[0], predictedA);
        assertEq(deployments[1], predictedB);
        assertGt(runtimeCodes[0].length, 0);
        assertGt(runtimeCodes[1].length, 0);
        assertEq(recorder.length(), 2);
        assertEq(recorder.at(0), TARGET_A);
        assertEq(recorder.at(1), TARGET_B);
        assertTrue(factory.consumedGraphAuthorization(authorizationKey));

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCreate2GraphDeployerV1.GraphAuthorizationAlreadyConsumed.selector, authorizationKey
            )
        );
        factory.deployGraph(authorization, targets);
    }

    function test_targetOrderMutationBreaksTheReviewedCommitment() public {
        (
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
            ProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _reviewedGraph();
        ProgrammableCreate2GraphDeployerV1.Target memory first = targets[0];
        targets[0] = targets[1];
        targets[1] = first;

        (bytes32 mutated,) = factory.computeGraphCommitment(authorization, targets);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCreate2GraphDeployerV1.GraphCommitmentMismatch.selector,
                mutated,
                authorization.graphCommitment
            )
        );
        factory.deployGraph(authorization, targets);
    }

    function test_crossChainReplayBreaksTheGraphCommitmentDomain() public {
        (
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
            ProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _reviewedGraph();

        vm.chainId(1);
        (bytes32 ethereumCommitment,) = factory.computeGraphCommitment(authorization, targets);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCreate2GraphDeployerV1.GraphCommitmentMismatch.selector,
                ethereumCommitment,
                authorization.graphCommitment
            )
        );
        factory.deployGraph(authorization, targets);
    }

    function _reviewedGraph()
        private
        view
        returns (
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
            ProgrammableCreate2GraphDeployerV1.Target[] memory targets
        )
    {
        targets = new ProgrammableCreate2GraphDeployerV1.Target[](2);
        targets[0] = _target(TARGET_A, bytes32(uint256(1)));
        targets[1] = _target(TARGET_B, bytes32(uint256(2)));
        authorization = ProgrammableCreate2GraphDeployerV1.GraphAuthorization({
            routeNamespace: ROUTE_NAMESPACE,
            routeNonce: ROUTE_NONCE,
            topologyHash: TOPOLOGY_HASH,
            graphCommitment: bytes32(0),
            authorizedLauncher: address(this),
            totalValue: 0
        });
        (authorization.graphCommitment,) = factory.computeGraphCommitment(authorization, targets);
    }

    function _target(bytes32 targetIdHash, bytes32 applicantSalt)
        private
        view
        returns (ProgrammableCreate2GraphDeployerV1.Target memory)
    {
        return ProgrammableCreate2GraphDeployerV1.Target({
            targetIdHash: targetIdHash,
            applicantSalt: applicantSalt,
            deploymentValue: 0,
            initializerValue: 0,
            initCode: abi.encodePacked(type(RobinhoodGraphInitializableProbe).creationCode, abi.encode(recorder)),
            initializerCalldata: abi.encodeCall(RobinhoodGraphInitializableProbe.initialize, (targetIdHash))
        });
    }
}
