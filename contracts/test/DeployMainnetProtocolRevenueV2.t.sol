// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DeployMainnetProtocolRevenueV2 } from "../script/DeployMainnetProtocolRevenueV2.s.sol";

contract DeployMainnetProtocolRevenueV2Test is Test {
    DeployMainnetProtocolRevenueV2 internal deployment;
    address internal broadcaster;
    address internal keeper;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        vm.createSelectFork(rpc);
        deployment = new DeployMainnetProtocolRevenueV2();
        broadcaster = makeAddr("protocolRevenueV2Broadcaster");
        keeper = makeAddr("protocolRevenueV2Keeper");
        vm.deal(broadcaster, 10 ether);
    }

    function test_reviewedPlanDeploysExactTwoContractStack() public {
        uint64 startingNonce = vm.getNonce(broadcaster);
        DeployMainnetProtocolRevenueV2.DeploymentPlan memory plan =
            deployment.deploymentPlan(broadcaster, startingNonce, keeper);
        assertEq(plan.coordinator, vm.computeCreateAddress(broadcaster, startingNonce));
        assertEq(plan.vault, vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1));
        assertEq(plan.keeper, keeper);
        assertEq(plan.sourceCommitment, deployment.deploymentSourceCommitment(keeper));

        DeployMainnetProtocolRevenueV2.DeploymentResult memory result =
            deployment.deployReviewed(broadcaster, startingNonce, keeper);
        assertEq(address(result.coordinator), plan.coordinator);
        assertEq(address(result.vault), plan.vault);
        assertEq(result.coordinator.keeper(), keeper);
        assertEq(result.vault.keeper(), keeper);
        assertEq(result.vault.TREASURY_SHARE_BPS(), 5000);
        assertEq(result.vault.BUY_SHARE_BPS(), 4950);
        assertEq(result.vault.KEEPER_GAS_SHARE_BPS(), 50);
        assertEq(result.vault.CYCLE_INTERVAL(), 1 days);
        assertEq(result.vault.MAX_DAILY_REVENUE(), 5 ether);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.coordinatorRuntimeCodeHash, address(result.coordinator).codehash);
        assertEq(result.vaultRuntimeCodeHash, address(result.vault).codehash);
        assertEq(vm.getNonce(broadcaster), uint256(startingNonce) + 2);
    }

    function test_reviewedDeploymentRejectsStaleNonce() public {
        uint64 startingNonce = vm.getNonce(broadcaster);
        vm.setNonce(broadcaster, startingNonce + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetProtocolRevenueV2.UnexpectedNonce.selector,
                broadcaster,
                uint64(startingNonce + 1),
                startingNonce
            )
        );
        deployment.deployReviewed(broadcaster, startingNonce, keeper);
    }
}
