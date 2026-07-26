// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DirectLiquidityLauncherV1 } from "../src/DirectLiquidityLauncherV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { PlatformFeeHookFactoryV1 } from "../src/PlatformFeeHookFactoryV1.sol";
import { DeploySepoliaInfrastructureV1 } from "../script/DeploySepoliaInfrastructureV1.s.sol";

contract DeploySepoliaInfrastructureV1Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 11_350_986;
    address internal constant TEST_DEPLOYMENT_WALLET = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant PLATFORM_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;

    DeploySepoliaInfrastructureV1 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://sepolia.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(TEST_DEPLOYMENT_WALLET, 100 ether);
        deployment = new DeploySepoliaInfrastructureV1();
    }

    function test_dependencyPreflightPassesOnPinnedSepoliaSnapshot() public view {
        deployment.validateDependencies();
    }

    function test_runDeploysPermissionlessInfrastructureFromExpectedWallet() public {
        (
            PlatformFeeHookFactoryV1 hookFactory,
            LockedPositionFeeForwarderFactoryV1 positionFactory,
            DirectLiquidityLauncherV1 directLauncher
        ) = deployment.run();

        assertGt(address(hookFactory).code.length, 0);
        assertGt(address(positionFactory).code.length, 0);
        assertGt(address(directLauncher).code.length, 0);
        assertEq(address(positionFactory.positionManager()), POSITION_MANAGER);
        assertEq(address(directLauncher.poolManager()), POOL_MANAGER);
        assertEq(address(directLauncher.positionManager()), POSITION_MANAGER);
        assertEq(address(directLauncher.tokenFactory()), UERC20_FACTORY);
        assertEq(address(directLauncher.hookFactory()), address(hookFactory));
        assertEq(address(directLauncher.positionForwarderFactory()), address(positionFactory));
        assertEq(directLauncher.platformFeeRecipient(), PLATFORM_TREASURY);
    }

    function test_rejectsWrongChain() public {
        vm.chainId(1);

        vm.expectRevert(
            abi.encodeWithSelector(
                DeploySepoliaInfrastructureV1.UnexpectedChain.selector, uint256(1), uint256(11_155_111)
            )
        );
        deployment.validateDependencies();
    }
}
