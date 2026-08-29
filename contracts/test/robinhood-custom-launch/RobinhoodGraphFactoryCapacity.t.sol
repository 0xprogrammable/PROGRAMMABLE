// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, console2 } from "forge-std/Test.sol";

import { ProgrammableCreate2GraphDeployerV1 } from "../../src/ProgrammableCreate2GraphDeployerV1.sol";

contract RobinhoodGraphCapacityTarget {
    uint256 public initializedValue;

    function initialize(uint256 value) external {
        require(initializedValue == 0, "already initialized");
        initializedValue = value;
    }
}

contract RobinhoodGraphFactoryCapacityTest is Test {
    ProgrammableCreate2GraphDeployerV1 internal factory;

    function setUp() public {
        vm.chainId(4663);
        factory = new ProgrammableCreate2GraphDeployerV1();
    }

    function test_threeTargetOperationalFloor() public {
        _measureAndDeploy(3);
    }

    function test_sixteenTargetOperationalBoundary() public {
        _measureAndDeploy(16);
    }

    function _measureAndDeploy(uint256 count) private {
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets =
            new ProgrammableCreate2GraphDeployerV1.Target[](count);
        for (uint256 index; index < count; ++index) {
            targets[index] = ProgrammableCreate2GraphDeployerV1.Target({
                targetIdHash: keccak256(abi.encode("capacity-target", index)),
                applicantSalt: bytes32(index + 1),
                deploymentValue: 0,
                initializerValue: 0,
                initCode: type(RobinhoodGraphCapacityTarget).creationCode,
                initializerCalldata: abi.encodeCall(RobinhoodGraphCapacityTarget.initialize, (index + 1))
            });
        }
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization =
            ProgrammableCreate2GraphDeployerV1.GraphAuthorization({
                routeNamespace: keccak256("robinhood-custom-launch-capacity"),
                routeNonce: keccak256(abi.encode("capacity-nonce", count)),
                topologyHash: keccak256(abi.encode("ordered-target-count", count)),
                graphCommitment: bytes32(0),
                authorizedLauncher: address(this),
                totalValue: 0
            });
        (authorization.graphCommitment,) = factory.computeGraphCommitment(authorization, targets);

        bytes memory callData = abi.encodeCall(factory.deployGraph, (authorization, targets));
        uint256 gasBefore = gasleft();
        (address[] memory deployments,, bytes[] memory runtimeCodes,) = factory.deployGraph(authorization, targets);
        uint256 executionGas = gasBefore - gasleft();

        assertEq(deployments.length, count);
        for (uint256 index; index < count; ++index) {
            assertGt(runtimeCodes[index].length, 0);
            assertEq(RobinhoodGraphCapacityTarget(deployments[index]).initializedValue(), index + 1);
        }
        console2.log("GRAPH_TARGET_COUNT", count);
        console2.log("GRAPH_DEPLOY_CALLDATA_BYTES", callData.length);
        console2.log("GRAPH_DEPLOY_EXECUTION_GAS", executionGas);
    }
}
