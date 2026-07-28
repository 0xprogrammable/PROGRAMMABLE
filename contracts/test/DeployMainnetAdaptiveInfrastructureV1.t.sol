// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Test } from "forge-std/Test.sol";

import { DeployMainnetAdaptiveInfrastructureV1 } from "../script/DeployMainnetAdaptiveInfrastructureV1.s.sol";
import { AdaptiveCurveFeeHookV1 } from "../src/AdaptiveCurveFeeHookV1.sol";
import { AdaptiveCurveLaunchV1 } from "../src/AdaptiveCurveLaunchV1.sol";
import { AdaptiveCurvePositionPlannerV1 } from "../src/AdaptiveCurvePositionPlannerV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";

contract DeployMainnetAdaptiveInfrastructureV1Test is Test {
    using StateLibrary for IPoolManager;

    uint256 internal constant SNAPSHOT_BLOCK = 25_622_180;
    address internal constant DEPLOYER = 0xa11ce00000000000000000000000000000000001;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant LOCKED_POSITION_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;

    DeployMainnetAdaptiveInfrastructureV1 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 100 ether);
        deployment = new DeployMainnetAdaptiveInfrastructureV1();
    }

    function test_dependencyPreflightPassesOnPinnedMainnetSnapshot() public view {
        deployment.validateOfficialDependencies();
    }

    function test_planAndDeploymentAreDeterministicAndRuntimePinned() public {
        DeployMainnetAdaptiveInfrastructureV1.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 0);
        DeployMainnetAdaptiveInfrastructureV1.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);

        assertEq(address(result.positionPlanner), plan.positionPlanner);
        assertEq(address(result.hookFactory), plan.hookFactory);
        assertEq(address(result.launcher), plan.launcher);
        assertEq(result.sampleHook, plan.sampleHook);
        assertEq(result.sampleHookSalt, plan.sampleHookSalt);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.sourceCommitment, deployment.deploymentSourceCommitment());
        assertEq(vm.getNonce(DEPLOYER), 3);

        assertEq(address(result.positionPlanner).codehash, keccak256(type(AdaptiveCurvePositionPlannerV1).runtimeCode));
        assertEq(address(result.launcher.positionPlanner()), address(result.positionPlanner));
        assertEq(address(result.launcher.positionForwarderFactory()), LOCKED_POSITION_FACTORY);
        assertLe(address(result.launcher).code.length, 23_000);
        assertEq(deployment.predictHook(address(result.hookFactory), result.sampleHookSalt), result.sampleHook);
    }

    function test_mainnetForkRehearsalDeploysAndCompletesAtomicLaunchLifecycle() public {
        DeployMainnetAdaptiveInfrastructureV1.DeploymentResult memory infrastructure =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);
        AdaptiveCurveLaunchV1 launcher = infrastructure.launcher;
        address creator = makeAddr("adaptiveRehearsalCreator");
        uint256 initialBuy = 0.002 ether;
        vm.deal(creator, initialBuy);

        AdaptiveCurveLaunchV1.LaunchParameters memory parameters = _parameters(launcher, infrastructure.sampleHookSalt);
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);

        vm.prank(creator);
        AdaptiveCurveLaunchV1.LaunchResult memory result = launcher.launch{ value: initialBuy }(abi.encode(parameters));

        AdaptiveCurveLaunchV1.LaunchRecord memory record = launcher.launchRecord(result.token);
        AdaptiveCurveFeeHookV1 hook = AdaptiveCurveFeeHookV1(result.feeHook);
        PoolKey memory key = launcher.poolKey(result.token, result.feeHook);
        IPositionManager positionManager = IPositionManager(POSITION_MANAGER);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));

        assertEq(result.token, predictedToken);
        assertEq(result.feeHook, infrastructure.sampleHook);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(address(launcher).balance, 0);
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(address(positionManager)), 0);

        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        assertGt(positionManager.getPositionLiquidity(result.positionTokenId), 0);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        assertTrue(
            LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY).isFactoryForwarder(result.positionRecipient)
        );
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();

        (, int24 tick,,) = IPoolManager(address(launcher.poolManager())).getSlot0(key.toId());
        (, int24 fdvIndex,) = hook.currentFee(result.poolId);
        assertLt(tick, launcher.INITIAL_TICK());
        assertEq(fdvIndex, -tick);
        assertEq(hook.TRANSFER_TAX_BPS(), 0);
        assertEq(hook.LAUNCHER_FEE_BPS(), 10);

        assertEq(record.creator, creator);
        assertEq(record.feeHook, result.feeHook);
        assertEq(record.positionRecipient, result.positionRecipient);
        assertEq(record.positionTokenId, result.positionTokenId);
        assertEq(record.poolId, result.poolId);
        assertEq(record.curveHash, result.curveHash);
        assertTrue(record.metadataHash != bytes32(0));
        assertEq(record.launchHash, result.launchHash);
        assertEq(launcher.launchHashOf(result.token), result.launchHash);
    }

    function test_rejectsStaleNonceAndWrongTreasury() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetAdaptiveInfrastructureV1.UnexpectedNonce.selector, DEPLOYER, uint64(0), uint64(1)
            )
        );
        deployment.deployReviewed(DEPLOYER, 1, TREASURY);

        address wrongTreasury = makeAddr("wrongAdaptiveTreasury");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetAdaptiveInfrastructureV1.UnexpectedTreasury.selector, wrongTreasury, TREASURY
            )
        );
        deployment.deployReviewed(DEPLOYER, 0, wrongTreasury);
    }

    function _parameters(AdaptiveCurveLaunchV1 launcher, bytes32 hookSalt)
        private
        view
        returns (AdaptiveCurveLaunchV1.LaunchParameters memory parameters)
    {
        int24[] memory indexes = new int24[](4);
        indexes[0] = launcher.MIN_FDV_INDEX();
        indexes[1] = -204_200;
        indexes[2] = -160_000;
        indexes[3] = launcher.MAX_FDV_INDEX();

        uint16[] memory fees = new uint16[](4);
        fees[0] = 500;
        fees[1] = 500;
        fees[2] = 200;
        fees[3] = 100;

        parameters = AdaptiveCurveLaunchV1.LaunchParameters({
            name: "Adaptive Mainnet Rehearsal",
            symbol: "AMR",
            creatorSalt: keccak256("adaptive-mainnet-rehearsal-v1"),
            metadata: UERC20Metadata({
                description: "Adaptive V1 deterministic deployment rehearsal",
                website: "https://programmable.family",
                image: "ipfs://programmable-adaptive-rehearsal",
                extraData: bytes('{"v":1,"model":"adaptive-v1"}')
            }),
            curve: AdaptiveCurveLaunchV1.CurveConfiguration({
                hookSalt: hookSalt, fdvIndexes: indexes, totalSwapFeeBps: fees
            })
        });
    }
}
