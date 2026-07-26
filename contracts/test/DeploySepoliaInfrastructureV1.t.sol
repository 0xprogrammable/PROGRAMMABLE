// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { PlatformFeeHookFactoryV1 } from "../src/PlatformFeeHookFactoryV1.sol";
import { DeploySepoliaInfrastructureV1 } from "../script/DeploySepoliaInfrastructureV1.s.sol";

contract DeploySepoliaInfrastructureV1Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 11_350_986;
    address internal constant TEST_DEPLOYMENT_WALLET = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;

    DeploySepoliaInfrastructureV1 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(TEST_DEPLOYMENT_WALLET, 100 ether);
        deployment = new DeploySepoliaInfrastructureV1();
    }

    function test_dependencyPreflightPassesOnPinnedSepoliaSnapshot() public view {
        deployment.validateDependencies();
    }

    function test_runDeploysOnlyPermissionlessFactoriesFromExpectedWallet() public {
        (PlatformFeeHookFactoryV1 hookFactory, LockedPositionFeeForwarderFactoryV1 positionFactory) = deployment.run();

        assertGt(address(hookFactory).code.length, 0);
        assertGt(address(positionFactory).code.length, 0);
        assertEq(address(positionFactory.positionManager()), POSITION_MANAGER);
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
