// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";

import { DeployMainnetMemeInfrastructureV2 } from "../script/DeployMainnetMemeInfrastructureV2.s.sol";
import { EthCreatorFeeHookFactoryV2 } from "../src/EthCreatorFeeHookFactoryV2.sol";
import { MemeLaunchV1 } from "../src/MemeLaunchV1.sol";

contract DeployMainnetMemeInfrastructureV2Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_622_180;
    address internal constant DEPLOYER = 0xa11ce00000000000000000000000000000000001;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant LOCKED_POSITION_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;

    DeployMainnetMemeInfrastructureV2 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 100 ether);
        deployment = new DeployMainnetMemeInfrastructureV2();
    }

    function test_dependencyPreflightPassesOnPinnedMainnetSnapshot() public view {
        deployment.validateOfficialDependencies();
    }

    function test_planAndRunDeployExactlyThreeReviewedContracts() public {
        DeployMainnetMemeInfrastructureV2.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 0);
        DeployMainnetMemeInfrastructureV2.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);

        assertEq(result.startingNonce, 0);
        assertEq(result.hookSalt, plan.hookSalt);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.sourceCommitment, deployment.deploymentSourceCommitment());
        assertEq(address(result.positionForwarderFactory), LOCKED_POSITION_FACTORY);
        assertEq(address(result.hookFactory), plan.hookFactory);
        assertEq(address(result.feeHook), plan.feeHook);
        assertEq(address(result.memeLauncher), plan.memeLauncher);
        assertEq(vm.getNonce(DEPLOYER), 3);

        assertEq(plan.hookFactory, vm.computeCreateAddress(DEPLOYER, 0));
        assertEq(plan.memeLauncher, vm.computeCreateAddress(DEPLOYER, 2));
        assertEq(plan.hookFactory.codehash, keccak256(type(EthCreatorFeeHookFactoryV2).runtimeCode));
        assertEq(result.feeHook.TRANSFER_TAX_BPS(), 0);
        assertEq(address(result.memeLauncher.feeHook()), address(result.feeHook));
        assertEq(address(result.memeLauncher.positionForwarderFactory()), LOCKED_POSITION_FACTORY);
    }

    function test_deployedV2StackLaunchesOnPinnedMainnetFork() public {
        DeployMainnetMemeInfrastructureV2.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);
        address creator = makeAddr("mainnetV2Creator");
        MemeLaunchV1.LaunchParameters memory parameters = MemeLaunchV1.LaunchParameters({
            name: "Mainnet V2 Fixture",
            symbol: "MV2",
            totalSwapFeeBps: 100,
            creatorSalt: keccak256("mainnet-v2-fixture"),
            metadata: UERC20Metadata({
                description: "Indexer-compatible Mainnet fork fixture",
                website: "https://programmable.family",
                image: "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
                extraData: bytes("{\"v\":1,\"x\":\"https://x.com/0xProgrammable\"}")
            })
        });

        vm.deal(creator, 0.0006 ether);
        vm.prank(creator);
        MemeLaunchV1.LaunchResult memory launch = result.memeLauncher.launch{ value: 0.0006 ether }(parameters);

        assertGt(launch.token.code.length, 0);
        assertGt(launch.initialBuyTokenAmount, 0);
        (
            uint16 buySwapFeeBps,
            uint16 sellSwapFeeBps,
            uint16 creatorFeeBps,
            uint16 launcherFeeBps,
            uint16 transferTaxBps,
            uint24 lpFeePips
        ) = result.feeHook.feeDisclosure(launch.poolId);
        assertEq(buySwapFeeBps, 100);
        assertEq(sellSwapFeeBps, 100);
        assertEq(creatorFeeBps, 90);
        assertEq(launcherFeeBps, 10);
        assertEq(transferTaxBps, 0);
        assertEq(lpFeePips, 0);
    }

    function test_rejectsStaleNonceAndWrongTreasury() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetMemeInfrastructureV2.UnexpectedNonce.selector, DEPLOYER, uint64(0), uint64(1)
            )
        );
        deployment.deployReviewed(DEPLOYER, 1, TREASURY);

        address wrongTreasury = makeAddr("wrongMainnetTreasury");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetMemeInfrastructureV2.UnexpectedTreasury.selector, wrongTreasury, TREASURY
            )
        );
        deployment.deployReviewed(DEPLOYER, 0, wrongTreasury);
    }
}
