// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

import { DeploySepoliaMemeInfrastructureV2 } from "../script/DeploySepoliaMemeInfrastructureV2.s.sol";
import { EthCreatorFeeHookFactoryV2 } from "../src/EthCreatorFeeHookFactoryV2.sol";
import { EthCreatorFeeHookV2 } from "../src/EthCreatorFeeHookV2.sol";
import { MemeLaunchV1 } from "../src/MemeLaunchV1.sol";

contract DeploySepoliaMemeInfrastructureV2Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 11_353_915;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;
    address internal constant TEST_DEPLOYMENT_WALLET = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant LAUNCHER_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address internal constant LOCKED_POSITION_FACTORY = 0xaE3C324B742a7576863A546120c4280b7c9E8448;

    DeploySepoliaMemeInfrastructureV2 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://sepolia.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(TEST_DEPLOYMENT_WALLET, 100 ether);
        vm.setEnv("LAUNCHER_TEST_DEPLOYER", vm.toString(TEST_DEPLOYMENT_WALLET));
        vm.setEnv("LAUNCHER_TEST_START_NONCE", vm.toString(vm.getNonce(TEST_DEPLOYMENT_WALLET)));
        deployment = new DeploySepoliaMemeInfrastructureV2();
    }

    function test_dependencyPreflightPassesOnPinnedSepoliaSnapshot() public view {
        deployment.validateDependencies();
    }

    function test_runDeploysIndexerCompatibleStack() public {
        (
            EthCreatorFeeHookFactoryV2 hookFactory,
            EthCreatorFeeHookV2 feeHook,
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
        assertEq(feeHook.TRANSFER_TAX_BPS(), 0);
        assertEq(address(memeLauncher.poolManager()), POOL_MANAGER);
        assertEq(address(memeLauncher.positionManager()), POSITION_MANAGER);
        assertEq(address(memeLauncher.tokenFactory()), UERC20_FACTORY);
        assertEq(address(memeLauncher.feeHook()), address(feeHook));
        assertEq(address(memeLauncher.positionForwarderFactory()), LOCKED_POSITION_FACTORY);
    }

    function test_deployedV2StackLaunchesAgainstOfficialSepoliaContracts() public {
        (, EthCreatorFeeHookV2 feeHook, MemeLaunchV1 memeLauncher,) = deployment.run();
        address creator = makeAddr("sepoliaV2Creator");
        MemeLaunchV1.LaunchParameters memory parameters = MemeLaunchV1.LaunchParameters({
            name: "Sepolia V2 Fixture",
            symbol: "SV2",
            totalSwapFeeBps: 100,
            creatorSalt: keccak256("sepolia-v2-fixture"),
            metadata: UERC20Metadata({
                description: "Indexer-compatible Sepolia integration fixture",
                website: "https://programmable.family",
                image: "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
                extraData: bytes("{\"v\":1,\"x\":\"https://x.com/0xProgrammable\"}")
            })
        });

        vm.deal(creator, MIN_INITIAL_BUY_WEI);
        vm.prank(creator);
        MemeLaunchV1.LaunchResult memory result = memeLauncher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);

        assertGt(result.token.code.length, 0);
        assertEq(result.poolId, PoolId.unwrap(memeLauncher.poolKey(result.token).toId()));
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, memeLauncher.TOKEN_SUPPLY());
        assertGt(result.initialBuyTokenAmount, 0);

        (
            uint16 buySwapFeeBps,
            uint16 sellSwapFeeBps,
            uint16 creatorFeeBps,
            uint16 launcherFeeBps,
            uint16 transferTaxBps,
            uint24 lpFeePips
        ) = feeHook.feeDisclosure(result.poolId);
        assertEq(buySwapFeeBps, 100);
        assertEq(sellSwapFeeBps, 100);
        assertEq(creatorFeeBps, 90);
        assertEq(launcherFeeBps, 10);
        assertEq(transferTaxBps, 0);
        assertEq(lpFeePips, 0);
    }

    function test_rejectsWrongChain() public {
        vm.chainId(1);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeploySepoliaMemeInfrastructureV2.UnexpectedChain.selector, uint256(1), uint256(11_155_111)
            )
        );
        deployment.validateDependencies();
    }
}
