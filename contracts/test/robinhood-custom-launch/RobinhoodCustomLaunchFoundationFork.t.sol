// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, console2 } from "forge-std/Test.sol";

import {
    IMulticall3,
    PrepareRobinhoodCustomLaunchFoundationV1
} from "../../script/robinhood-custom-launch/PrepareRobinhoodCustomLaunchFoundationV1.s.sol";

contract RobinhoodAtomicFailureTarget {
    fallback() external payable {
        revert("intentional atomic rollback");
    }
}

contract RobinhoodCustomLaunchFoundationForkTest is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 49_220_000;
    // Robinhood's public node serves the pinned block header but prunes the historical state required by this fork.
    // QuickNode documents this chain-specific demo endpoint and currently serves the exact archive snapshot.
    string internal constant FALLBACK_RPC = "https://docs-demo.robinhood-mainnet.quiknode.pro/";

    PrepareRobinhoodCustomLaunchFoundationV1 internal preparation;

    function setUp() public {
        vm.createSelectFork(vm.envOr("ROBINHOOD_MAINNET_RPC_URL", FALLBACK_RPC), SNAPSHOT_BLOCK);
        preparation = new PrepareRobinhoodCustomLaunchFoundationV1();
    }

    function test_atomicOwnerTransactionDeploysAndValidatesExactFoundation() public {
        PrepareRobinhoodCustomLaunchFoundationV1.DeploymentPlan memory plan =
            preparation.deploymentPlan(preparation.OWNER_0());
        PrepareRobinhoodCustomLaunchFoundationV1.PreparedTransaction[] memory componentCalls =
            preparation.componentCalls();

        assertEq(plan.chainId, 4663);
        assertEq(componentCalls.length, 3);
        assertEq(componentCalls[0].to, preparation.SAFE_PROXY_FACTORY());
        assertEq(componentCalls[1].to, preparation.DETERMINISTIC_DEPLOYER());
        assertEq(componentCalls[2].to, preparation.DETERMINISTIC_DEPLOYER());
        for (uint256 index; index < componentCalls.length; ++index) {
            assertEq(componentCalls[index].value, 0);
            assertEq(componentCalls[index].dataHash, keccak256(componentCalls[index].data));
        }
        assertEq(plan.ownerTransaction.to, preparation.MULTICALL3());
        assertEq(plan.ownerTransaction.value, 0);
        assertEq(plan.ownerTransaction.dataHash, keccak256(plan.ownerTransaction.data));

        preparation.validatePinnedDependencies();
        preparation.validateVacancy(plan);

        uint256 gasBefore = gasleft();
        vm.prank(plan.sender);
        (bool success, bytes memory returnData) =
            plan.ownerTransaction.to.call{ value: plan.ownerTransaction.value }(plan.ownerTransaction.data);
        uint256 executionGas = gasBefore - gasleft();
        assertTrue(success, string(returnData));

        assertGt(plan.permitAuthority.code.length, 0);
        assertGt(plan.graphFactory.code.length, 0);
        assertGt(plan.router.code.length, 0);
        bytes32 routerRuntimeCodeHash = plan.router.codehash;
        console2.log("ROBINHOOD_ROUTER", plan.router);
        console2.log("ROBINHOOD_GRAPH_FACTORY", plan.graphFactory);
        console2.log("ROBINHOOD_PERMIT_AUTHORITY", plan.permitAuthority);
        console2.log("ATOMIC_OWNER_TRANSACTION_CALLDATA_BYTES", plan.ownerTransaction.data.length);
        console2.log("ATOMIC_OWNER_TRANSACTION_EXECUTION_GAS", executionGas);
        console2.logBytes32(plan.ownerTransaction.dataHash);
        console2.logBytes32(plan.sourceCommitment);
        console2.logBytes32(routerRuntimeCodeHash);

        assertEq(routerRuntimeCodeHash, preparation.ROUTER_RUNTIME_CODE_HASH());
        preparation.validateDeployedFoundation(plan);
    }

    function test_wrongChainAndWrongPoolManagerRuntimeFailClosed() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(PrepareRobinhoodCustomLaunchFoundationV1.InvalidChain.selector, 1, 4663));
        preparation.validatePinnedDependencies();

        vm.chainId(4663);
        address poolManager = preparation.POOL_MANAGER();
        vm.etch(poolManager, hex"6000");
        vm.expectRevert(
            abi.encodeWithSelector(
                PrepareRobinhoodCustomLaunchFoundationV1.UnexpectedCodeHash.selector,
                poolManager,
                keccak256(hex"6000"),
                preparation.POOL_MANAGER_RUNTIME_CODE_HASH()
            )
        );
        preparation.validatePinnedDependencies();
    }

    function test_onlyObservedEthereumAuthorityOwnersCanBeSelectedAsSender() public {
        preparation.deploymentPlan(preparation.OWNER_0());
        preparation.deploymentPlan(preparation.OWNER_1());

        address unknown = makeAddr("unknown");
        vm.expectRevert(
            abi.encodeWithSelector(PrepareRobinhoodCustomLaunchFoundationV1.InvalidSender.selector, unknown)
        );
        preparation.deploymentPlan(unknown);
    }

    function test_create2PlanIsSenderNonceIndependent() public view {
        PrepareRobinhoodCustomLaunchFoundationV1.DeploymentPlan memory owner0 =
            preparation.deploymentPlan(preparation.OWNER_0());
        PrepareRobinhoodCustomLaunchFoundationV1.DeploymentPlan memory owner1 =
            preparation.deploymentPlan(preparation.OWNER_1());

        assertEq(owner0.permitAuthority, owner1.permitAuthority);
        assertEq(owner0.graphFactory, owner1.graphFactory);
        assertEq(owner0.router, owner1.router);
        assertEq(owner0.sourceCommitment, owner1.sourceCommitment);
        assertEq(owner0.ownerTransaction.dataHash, owner1.ownerTransaction.dataHash);
    }

    function test_atomicOwnerTransactionRollsBackEarlierComponentCalls() public {
        PrepareRobinhoodCustomLaunchFoundationV1.DeploymentPlan memory plan =
            preparation.deploymentPlan(preparation.OWNER_0());
        PrepareRobinhoodCustomLaunchFoundationV1.PreparedTransaction[] memory componentCalls =
            preparation.componentCalls();
        RobinhoodAtomicFailureTarget failureTarget = new RobinhoodAtomicFailureTarget();
        IMulticall3.Call3[] memory calls = new IMulticall3.Call3[](3);
        calls[0] =
            IMulticall3.Call3({ target: componentCalls[0].to, allowFailure: false, callData: componentCalls[0].data });
        calls[1] =
            IMulticall3.Call3({ target: componentCalls[1].to, allowFailure: false, callData: componentCalls[1].data });
        calls[2] = IMulticall3.Call3({ target: address(failureTarget), allowFailure: false, callData: hex"deadbeef" });

        vm.prank(plan.sender);
        (bool success,) = preparation.MULTICALL3().call(abi.encodeCall(IMulticall3.aggregate3, (calls)));
        assertFalse(success);
        assertEq(plan.permitAuthority.code.length, 0);
        assertEq(plan.graphFactory.code.length, 0);
        assertEq(plan.router.code.length, 0);
    }
}
