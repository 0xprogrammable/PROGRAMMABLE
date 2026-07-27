// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DeployMainnetMemeInfrastructureV1 } from "../script/DeployMainnetMemeInfrastructureV1.s.sol";
import { EthCreatorFeeHookFactoryV1 } from "../src/EthCreatorFeeHookFactoryV1.sol";

contract DeployMainnetMemeInfrastructureV1Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_612_664;
    address internal constant DEPLOYER = 0xa11ce00000000000000000000000000000000001;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    DeployMainnetMemeInfrastructureV1 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 100 ether);

        deployment = new DeployMainnetMemeInfrastructureV1();
    }

    function test_dependencyPreflightPassesOnPinnedMainnetSnapshot() public view {
        deployment.validateOfficialDependencies();
    }

    function test_planAndRunDeployExactlyFourReviewedContracts() public {
        DeployMainnetMemeInfrastructureV1.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 0);
        DeployMainnetMemeInfrastructureV1.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);

        assertEq(result.startingNonce, 0);
        assertEq(result.hookSalt, plan.hookSalt);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.sourceCommitment, deployment.deploymentSourceCommitment());

        assertEq(address(result.positionForwarderFactory), plan.positionForwarderFactory);
        assertEq(address(result.hookFactory), plan.hookFactory);
        assertEq(address(result.feeHook), plan.feeHook);
        assertEq(address(result.memeLauncher), plan.memeLauncher);
        assertEq(vm.getNonce(DEPLOYER), 4);

        assertGt(plan.positionForwarderFactory.code.length, 0);
        assertGt(plan.hookFactory.code.length, 0);
        assertGt(plan.feeHook.code.length, 0);
        assertGt(plan.memeLauncher.code.length, 0);
        assertEq(plan.hookFactory.codehash, keccak256(type(EthCreatorFeeHookFactoryV1).runtimeCode));

        assertEq(address(result.positionForwarderFactory.positionManager()), deployment.POSITION_MANAGER());
        assertEq(result.positionForwarderFactory.OPERATOR(), address(0));
        assertEq(result.positionForwarderFactory.TIMELOCK_BLOCK(), type(uint256).max);

        assertEq(address(result.feeHook.poolManager()), deployment.POOL_MANAGER());
        assertEq(result.feeHook.launcherFeeRecipient(), TREASURY);
        assertTrue(result.hookFactory.isFactoryHook(address(result.feeHook)));
        assertEq(
            uint160(address(result.feeHook)) & result.hookFactory.ALL_HOOK_MASK(),
            result.hookFactory.REQUIRED_HOOK_FLAGS()
        );

        assertEq(address(result.memeLauncher.poolManager()), deployment.POOL_MANAGER());
        assertEq(address(result.memeLauncher.positionManager()), deployment.POSITION_MANAGER());
        assertEq(address(result.memeLauncher.tokenFactory()), deployment.UERC20_FACTORY());
        assertEq(address(result.memeLauncher.feeHook()), address(result.feeHook));
        assertEq(address(result.memeLauncher.positionForwarderFactory()), address(result.positionForwarderFactory));
        assertEq(result.memeLauncher.LP_FEE_PIPS(), 0);
        assertEq(result.memeLauncher.TICK_SPACING(), 200);
        assertEq(result.memeLauncher.MIN_INITIAL_BUY_WEI(), 0.0006 ether);
        assertEq(result.feeHook.LAUNCHER_FEE_BPS(), 10);
    }

    function test_planBindsEveryCreateAddressToTheReviewedStartingNonce() public view {
        DeployMainnetMemeInfrastructureV1.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 17);

        assertEq(plan.positionForwarderFactory, vm.computeCreateAddress(DEPLOYER, 17));
        assertEq(plan.hookFactory, vm.computeCreateAddress(DEPLOYER, 18));
        assertEq(plan.memeLauncher, vm.computeCreateAddress(DEPLOYER, 20));
        assertEq(uint160(plan.feeHook) & ((1 << 14) - 1), uint160(8396), "mined hook permissions changed");
    }

    function test_rejectsWrongChainBeforeReadingDependencies() public {
        vm.chainId(11_155_111);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetMemeInfrastructureV1.UnexpectedChain.selector, uint256(11_155_111), uint256(1)
            )
        );
        deployment.validateOfficialDependencies();
    }

    function test_rejectsAStaleReviewedNonce() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetMemeInfrastructureV1.UnexpectedNonce.selector, DEPLOYER, uint64(0), uint64(1)
            )
        );
        deployment.deployReviewed(DEPLOYER, 1, TREASURY);
    }

    function test_rejectsAnyTreasuryOtherThanTheOwnerApprovedAddress() public {
        address wrongTreasury = makeAddr("wrongMainnetTreasury");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetMemeInfrastructureV1.UnexpectedTreasury.selector, wrongTreasury, TREASURY
            )
        );
        deployment.deployReviewed(DEPLOYER, 0, wrongTreasury);
    }
}
