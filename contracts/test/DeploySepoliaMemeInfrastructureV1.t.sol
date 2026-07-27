// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

import { DeploySepoliaMemeInfrastructureV1 } from "../script/DeploySepoliaMemeInfrastructureV1.s.sol";
import { EthCreatorFeeHookFactoryV1 } from "../src/EthCreatorFeeHookFactoryV1.sol";
import { EthCreatorFeeHookV1 } from "../src/EthCreatorFeeHookV1.sol";
import { MemeLaunchV1 } from "../src/MemeLaunchV1.sol";

contract DeploySepoliaMemeInfrastructureV1Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 11_353_915;
    uint256 internal constant RELEASE_PREFLIGHT_BLOCK = 11_358_653;
    uint256 internal constant CURRENT_DEPLOYMENT_PREFLIGHT_BLOCK = 11_359_162;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;
    address internal constant TEST_DEPLOYMENT_WALLET = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant LAUNCHER_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address internal constant LOCKED_POSITION_FACTORY = 0xaE3C324B742a7576863A546120c4280b7c9E8448;
    address internal constant REVIEWED_HOOK_FACTORY = 0xDc7db04244b58Cb3E921958F163203e8b40e12A9;
    address internal constant REVIEWED_FEE_HOOK = 0x9F943aCeFc675DDE34F3998069A958Eb726Da0cC;
    address internal constant REVIEWED_MEME_LAUNCHER = 0x73543625D0F8B7ae917135709dD8f25e0cd2aceB;
    address internal constant CURRENT_HOOK_FACTORY = 0x630B8a1392601AE1d989323CC8051e8A17A0e5BF;
    address internal constant CURRENT_FEE_HOOK = 0x13c34016c74bc43F4CBa97EDb48cC36b4bb620cc;
    address internal constant CURRENT_MEME_LAUNCHER = 0x341edf9399C8c5dF361aec2939C4a17c2163a245;
    bytes32 internal constant REVIEWED_HOOK_FACTORY_CODEHASH =
        0x3014de1f275dc60ae289f7a3a8ab038fdf76929aff19e0efdb19138e4ce8e0d5;
    bytes32 internal constant REVIEWED_FEE_HOOK_CODEHASH =
        0x0e0dd0bc1b007e979c0a93412afd282fcbe88b270dc2f26edb94310c334fbf06;
    bytes32 internal constant PREVIOUS_RELEASE_MEME_LAUNCHER_CODEHASH =
        0x29358eef43ecd6ed09d58b98415a584b6c4e8567c64197af9f035cdb52ec9efb;
    bytes32 internal constant CURRENT_REBUILT_MEME_LAUNCHER_CODEHASH =
        0xf1331590256d2d7865e5929e00afa48ff471acde4e98dea443b2aaef920073b1;
    bytes32 internal constant CURRENT_DEPLOYED_MEME_LAUNCHER_CODEHASH =
        0x6e1fa1f21df7712433695c1ac584ed4c89b09ed11732cf62058dfc486639e3c2;

    DeploySepoliaMemeInfrastructureV1 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://sepolia.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(TEST_DEPLOYMENT_WALLET, 100 ether);
        deployment = new DeploySepoliaMemeInfrastructureV1();
    }

    function test_dependencyPreflightPassesOnPinnedSepoliaSnapshot() public view {
        deployment.validateDependencies();
    }

    function test_runDeploysConfiguredMemeLaunchStack() public {
        (
            EthCreatorFeeHookFactoryV1 hookFactory,
            EthCreatorFeeHookV1 feeHook,
            MemeLaunchV1 memeLauncher,
            bytes32 hookSalt
        ) = deployment.run();

        assertGt(address(hookFactory).code.length, 0);
        assertGt(address(feeHook).code.length, 0);
        assertGt(address(memeLauncher).code.length, 0);
        assertEq(hookFactory.predict(hookSalt, feeHook.poolManager(), LAUNCHER_TREASURY), address(feeHook));
        assertTrue(hookFactory.isFactoryHook(address(feeHook)));
        assertEq(address(feeHook.poolManager()), POOL_MANAGER);
        assertEq(feeHook.launcherFeeRecipient(), LAUNCHER_TREASURY);
        assertEq(address(memeLauncher.poolManager()), POOL_MANAGER);
        assertEq(address(memeLauncher.positionManager()), POSITION_MANAGER);
        assertEq(address(memeLauncher.tokenFactory()), UERC20_FACTORY);
        assertEq(address(memeLauncher.feeHook()), address(feeHook));
        assertEq(address(memeLauncher.positionForwarderFactory()), LOCKED_POSITION_FACTORY);
        assertEq(memeLauncher.LP_FEE_PIPS(), 0);
        assertEq(memeLauncher.TICK_SPACING(), 200);
    }

    function test_deployedStackLaunchesAgainstOfficialSepoliaContracts() public {
        (, EthCreatorFeeHookV1 feeHook, MemeLaunchV1 memeLauncher,) = deployment.run();
        address creator = makeAddr("sepoliaMemeCreator");
        MemeLaunchV1.LaunchParameters memory parameters = MemeLaunchV1.LaunchParameters({
            name: "Sepolia Meme Fixture",
            symbol: "SMF",
            totalSwapFeeBps: 100,
            creatorSalt: keccak256("sepolia-meme-fixture"),
            metadata: UERC20Metadata({
                description: "Pinned Sepolia integration fixture", website: "", image: "", extraData: bytes("")
            })
        });

        vm.deal(creator, MIN_INITIAL_BUY_WEI);
        vm.prank(creator);
        MemeLaunchV1.LaunchResult memory result = memeLauncher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);

        assertGt(result.token.code.length, 0);
        assertTrue(result.poolId != bytes32(0));
        assertTrue(result.launchHash != bytes32(0));
        assertEq(result.poolId, PoolId.unwrap(memeLauncher.poolKey(result.token).toId()));
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, memeLauncher.TOKEN_SUPPLY());
        assertEq(result.initialBuyNativeAmount, MIN_INITIAL_BUY_WEI);
        assertGt(result.initialBuyTokenAmount, 0);
        (address feeCreator, address registrar, uint16 totalFee, bool registered,) =
            feeHook.poolFeeConfig(result.poolId);
        assertEq(feeCreator, creator);
        assertEq(registrar, address(memeLauncher));
        assertEq(totalFee, 100);
        assertTrue(registered);
    }

    function test_rebuiltReleaseAtHistoricalNonceShowsLauncherBytecodeChanged() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://sepolia.drpc.org"));
        vm.createSelectFork(rpc, RELEASE_PREFLIGHT_BLOCK);
        vm.deal(TEST_DEPLOYMENT_WALLET, 100 ether);

        assertEq(vm.getNonce(TEST_DEPLOYMENT_WALLET), 13);
        assertEq(REVIEWED_HOOK_FACTORY.code.length, 0);
        assertEq(REVIEWED_FEE_HOOK.code.length, 0);
        assertEq(REVIEWED_MEME_LAUNCHER.code.length, 0);

        DeploySepoliaMemeInfrastructureV1 reviewedDeployment = new DeploySepoliaMemeInfrastructureV1();
        (EthCreatorFeeHookFactoryV1 hookFactory, EthCreatorFeeHookV1 feeHook, MemeLaunchV1 memeLauncher,) =
            reviewedDeployment.run();

        assertEq(address(hookFactory), REVIEWED_HOOK_FACTORY);
        assertEq(address(feeHook), REVIEWED_FEE_HOOK);
        assertEq(address(memeLauncher), REVIEWED_MEME_LAUNCHER);
        assertEq(address(hookFactory).codehash, REVIEWED_HOOK_FACTORY_CODEHASH);
        assertEq(address(feeHook).codehash, REVIEWED_FEE_HOOK_CODEHASH);
        assertEq(address(memeLauncher).codehash, CURRENT_REBUILT_MEME_LAUNCHER_CODEHASH);
        assertTrue(address(memeLauncher).codehash != PREVIOUS_RELEASE_MEME_LAUNCHER_CODEHASH);
    }

    function test_currentDeploymentNonceRebuildMatchesReleasedBytecode() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://sepolia.drpc.org"));
        vm.createSelectFork(rpc, CURRENT_DEPLOYMENT_PREFLIGHT_BLOCK);
        vm.deal(TEST_DEPLOYMENT_WALLET, 100 ether);

        assertEq(vm.getNonce(TEST_DEPLOYMENT_WALLET), 22);
        assertEq(CURRENT_HOOK_FACTORY.code.length, 0);
        assertEq(CURRENT_FEE_HOOK.code.length, 0);
        assertEq(CURRENT_MEME_LAUNCHER.code.length, 0);

        DeploySepoliaMemeInfrastructureV1 currentDeployment = new DeploySepoliaMemeInfrastructureV1();
        (EthCreatorFeeHookFactoryV1 hookFactory, EthCreatorFeeHookV1 feeHook, MemeLaunchV1 memeLauncher,) =
            currentDeployment.run();

        assertEq(address(hookFactory), CURRENT_HOOK_FACTORY);
        assertEq(address(feeHook), CURRENT_FEE_HOOK);
        assertEq(address(memeLauncher), CURRENT_MEME_LAUNCHER);
        assertEq(address(hookFactory).codehash, REVIEWED_HOOK_FACTORY_CODEHASH);
        assertEq(address(feeHook).codehash, REVIEWED_FEE_HOOK_CODEHASH);
        assertEq(address(memeLauncher).codehash, CURRENT_DEPLOYED_MEME_LAUNCHER_CODEHASH);
        assertEq(memeLauncher.MIN_INITIAL_BUY_WEI(), MIN_INITIAL_BUY_WEI);
    }

    function test_rejectsWrongChain() public {
        vm.chainId(1);

        vm.expectRevert(
            abi.encodeWithSelector(
                DeploySepoliaMemeInfrastructureV1.UnexpectedChain.selector, uint256(1), uint256(11_155_111)
            )
        );
        deployment.validateDependencies();
    }
}
