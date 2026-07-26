// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DirectLiquidityLauncherV1 } from "../src/DirectLiquidityLauncherV1.sol";
import { BoundedDynamicFeeHookFactoryV1 } from "../src/BoundedDynamicFeeHookFactoryV1.sol";
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
    address internal constant PLATFORM_FEE_HOOK_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;
    address internal constant LOCKED_POSITION_FACTORY = 0xaE3C324B742a7576863A546120c4280b7c9E8448;
    address internal constant DIRECT_LIQUIDITY_LAUNCHER = 0x5fc6aDd062329742EFefA9c4b11C355AAe02Fa1E;
    address internal constant BOUNDED_DYNAMIC_FEE_FACTORY = 0x51d702731db281EE223904A4663E05BfCA26C775;

    bytes32 internal constant PLATFORM_FEE_HOOK_FACTORY_CODEHASH =
        0x7792dba76c190e746dc7fbf7f8a8f690f7cf5ce6fab448c858069b1852974306;
    bytes32 internal constant LOCKED_POSITION_FACTORY_CODEHASH =
        0x49e040806b0664b2fa4f41c5abc11241cdb8f847c538c13d6874c32804b74ebc;
    bytes32 internal constant DIRECT_LIQUIDITY_LAUNCHER_CODEHASH =
        0x41fa4dbe9709e93f601e0406a3a9d61826144ca56e16f748e063f850fc0af48b;
    bytes32 internal constant BOUNDED_DYNAMIC_FEE_FACTORY_CODEHASH =
        0xe6bbbdba0194caba268f5546db2574dc416b3c74331bd44f33d04d4b2251ffbc;

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
            DirectLiquidityLauncherV1 directLauncher,
            BoundedDynamicFeeHookFactoryV1 dynamicHookFactory
        ) = deployment.run();

        assertEq(address(hookFactory), PLATFORM_FEE_HOOK_FACTORY);
        assertEq(address(positionFactory), LOCKED_POSITION_FACTORY);
        assertEq(address(directLauncher), DIRECT_LIQUIDITY_LAUNCHER);
        assertEq(address(dynamicHookFactory), BOUNDED_DYNAMIC_FEE_FACTORY);
        assertEq(address(hookFactory).codehash, PLATFORM_FEE_HOOK_FACTORY_CODEHASH);
        assertEq(address(positionFactory).codehash, LOCKED_POSITION_FACTORY_CODEHASH);
        assertEq(address(directLauncher).codehash, DIRECT_LIQUIDITY_LAUNCHER_CODEHASH);
        assertEq(address(dynamicHookFactory).codehash, BOUNDED_DYNAMIC_FEE_FACTORY_CODEHASH);
        assertGt(address(hookFactory).code.length, 0);
        assertGt(address(positionFactory).code.length, 0);
        assertGt(address(directLauncher).code.length, 0);
        assertGt(address(dynamicHookFactory).code.length, 0);
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
