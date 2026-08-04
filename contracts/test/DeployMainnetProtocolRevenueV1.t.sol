// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DeployMainnetProtocolRevenueV1 } from "../script/DeployMainnetProtocolRevenueV1.s.sol";

contract DeployMainnetProtocolRevenueV1Test is Test {
    DeployMainnetProtocolRevenueV1 internal deployment;
    address internal broadcaster;
    address internal keeper;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        vm.createSelectFork(rpc);
        deployment = new DeployMainnetProtocolRevenueV1();
        broadcaster = makeAddr("protocolRevenueBroadcaster");
        keeper = makeAddr("protocolRevenueKeeper");
        vm.deal(broadcaster, 10 ether);
    }

    function test_reviewedPlanDeploysExactThreeContractStack() public {
        uint64 startingNonce = vm.getNonce(broadcaster);
        DeployMainnetProtocolRevenueV1.DeploymentPlan memory plan =
            deployment.deploymentPlan(broadcaster, startingNonce, keeper);
        assertEq(plan.router, vm.computeCreateAddress(broadcaster, startingNonce));
        assertEq(plan.enforcer, vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1));
        assertEq(plan.executor, vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 2));
        assertEq(plan.keeper, keeper);
        assertEq(plan.sourceCommitment, deployment.deploymentSourceCommitment(keeper));

        DeployMainnetProtocolRevenueV1.DeploymentResult memory result =
            deployment.deployReviewed(broadcaster, startingNonce, keeper);

        assertEq(address(result.router), plan.router);
        assertEq(address(result.enforcer), plan.enforcer);
        assertEq(address(result.executor), plan.executor);
        assertEq(address(result.enforcer.router()), plan.router);
        assertEq(address(result.executor.router()), plan.router);
        assertEq(address(result.executor.enforcer()), plan.enforcer);
        assertEq(result.router.REVENUE_AUTHORITY(), deployment.REVENUE_AUTHORITY());
        assertEq(result.router.TREASURY(), deployment.TREASURY());
        assertEq(result.router.V4_TOKEN(), deployment.V4_TOKEN());
        assertEq(result.router.MAIN_POOL_ID(), deployment.MAIN_POOL_ID());
        assertEq(result.router.keeper(), keeper);
        assertEq(result.router.TREASURY_SHARE_BPS(), 5000);
        assertEq(result.router.BUY_SHARE_BPS(), 4950);
        assertEq(result.router.KEEPER_GAS_SHARE_BPS(), 50);
        assertEq(result.router.CYCLE_INTERVAL(), 1 days);
        assertEq(result.router.MAX_NATIVE_SWAP_CHUNK(), 0.1 ether);
        assertEq(result.router.MAX_SWAP_CHUNKS(), 32);
        assertEq(result.router.MAX_TOTAL_SWAP_TICK_MOVE(), 500);
        assertEq(result.executor.keeper(), keeper);
        assertEq(result.executor.MAX_OBSERVATION_AGE(), 30 minutes);
        assertEq(result.executor.METAMASK_DELEGATION_MANAGER(), deployment.METAMASK_DELEGATION_MANAGER());
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.routerRuntimeCodeHash, address(result.router).codehash);
        assertEq(result.enforcerRuntimeCodeHash, address(result.enforcer).codehash);
        assertEq(result.executorRuntimeCodeHash, address(result.executor).codehash);
        assertEq(vm.getNonce(broadcaster), uint256(startingNonce) + 3);
    }

    function test_planRejectsZeroBroadcaster() public {
        vm.expectRevert(abi.encodeWithSelector(DeployMainnetProtocolRevenueV1.InvalidBroadcaster.selector, address(0)));
        deployment.deploymentPlan(address(0), 0, keeper);
    }

    function test_planRejectsZeroOrRevenueAuthorityKeeper() public {
        address revenueAuthority = deployment.REVENUE_AUTHORITY();
        address treasury = deployment.TREASURY();
        vm.expectRevert(abi.encodeWithSelector(DeployMainnetProtocolRevenueV1.InvalidKeeper.selector, address(0)));
        deployment.deploymentPlan(broadcaster, 0, address(0));
        vm.expectRevert(abi.encodeWithSelector(DeployMainnetProtocolRevenueV1.InvalidKeeper.selector, revenueAuthority));
        deployment.deploymentPlan(broadcaster, 0, revenueAuthority);
        vm.expectRevert(abi.encodeWithSelector(DeployMainnetProtocolRevenueV1.InvalidKeeper.selector, treasury));
        deployment.deploymentPlan(broadcaster, 0, treasury);
    }

    function test_reviewedDeploymentRejectsStaleNonce() public {
        uint64 startingNonce = vm.getNonce(broadcaster);
        vm.setNonce(broadcaster, uint64(startingNonce + 1));
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetProtocolRevenueV1.UnexpectedNonce.selector,
                broadcaster,
                uint64(startingNonce + 1),
                startingNonce
            )
        );
        deployment.deployReviewed(broadcaster, startingNonce, keeper);
    }
}
