// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DeployMainnetDeepKeeperExecutorV1 } from "../script/DeployMainnetDeepKeeperExecutorV1.s.sol";

contract DeployMainnetDeepKeeperExecutorV1Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_632_886;
    address internal constant DEPLOYER = 0xDeef000000000000000000000000000000000002;

    DeployMainnetDeepKeeperExecutorV1 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 10 ether);
        deployment = new DeployMainnetDeepKeeperExecutorV1();
    }

    function test_officialAutomationAndSourceCommitmentPassOnPinnedMainnetSnapshot() public view {
        deployment.validateOfficialAutomation();
        assertNotEq(deployment.deploymentSourceCommitment(), bytes32(0));
    }

    function test_planAndOneTransactionDeploymentAreDeterministic() public {
        DeployMainnetDeepKeeperExecutorV1.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 0);
        DeployMainnetDeepKeeperExecutorV1.DeploymentResult memory result = deployment.deployReviewed(DEPLOYER, 0);

        assertEq(address(result.executor), plan.executor);
        assertEq(address(result.executor.automation()), deployment.AUTOMATION());
        assertEq(result.startingNonce, 0);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.sourceCommitment, deployment.deploymentSourceCommitment());
        assertEq(result.runtimeCodeHash, address(result.executor).codehash);
        assertEq(vm.getNonce(DEPLOYER), 1);
        assertEq(result.executor.MAX_BATCH_SIZE(), 8);
        assertEq(result.executor.PROCESS_FEES_GAS_STIPEND(), 700_000);
        assertEq(result.executor.COMPOUND_PENDING_GAS_STIPEND(), 220_000);
        assertEq(result.executor.GROW_ORACLE_GAS_STIPEND(), 450_000);
        emit log_named_bytes32("Deep Keeper Executor V1 source commitment", result.sourceCommitment);
        emit log_named_bytes32("Deep Keeper Executor V1 runtime hash", result.runtimeCodeHash);
    }

    function test_rejectsStaleNonceAndOccupiedPredictedAddress() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepKeeperExecutorV1.UnexpectedNonce.selector, DEPLOYER, uint64(0), uint64(1)
            )
        );
        deployment.deployReviewed(DEPLOYER, 1);

        DeployMainnetDeepKeeperExecutorV1.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 0);
        vm.etch(plan.executor, hex"60006000f3");
        vm.expectRevert(
            abi.encodeWithSelector(DeployMainnetDeepKeeperExecutorV1.DeploymentAddressOccupied.selector, plan.executor)
        );
        deployment.deployReviewed(DEPLOYER, 0);
    }

    function test_rejectsWrongChain() public {
        vm.chainId(11_155_111);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepKeeperExecutorV1.UnexpectedChain.selector, uint256(11_155_111), uint256(1)
            )
        );
        deployment.validateOfficialAutomation();
    }
}
