// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { AdaptiveCurveFeeHookFactoryV1 } from "../src/AdaptiveCurveFeeHookFactoryV1.sol";
import { AdaptiveCurveFeeHookV1 } from "../src/AdaptiveCurveFeeHookV1.sol";
import { AdaptiveCurveLaunchV1 } from "../src/AdaptiveCurveLaunchV1.sol";
import { AdaptiveCurvePositionPlannerV1 } from "../src/AdaptiveCurvePositionPlannerV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";

/// @title DeployMainnetAdaptiveInfrastructureV1
/// @notice Deterministic, fail-closed deployment script for Programmable Adaptive V1 on Ethereum.
/// @dev A normal run is simulation-only. Broadcasting still requires Forge's separate `--broadcast` flag and an
/// operator-controlled keystore. Adaptive hooks are created per launch, so the infrastructure deploys the stateless
/// planner, hook factory and launcher while proving one counterfactual hook address.
contract DeployMainnetAdaptiveInfrastructureV1 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant MAX_LAUNCHER_RUNTIME_BYTES = 23_000;

    address public constant LAUNCHER_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address public constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address public constant STATE_VIEW = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    address public constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
    address public constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant UNIVERSAL_ROUTER = 0xd92A36B0000531EF3063dEd4De20A0783308446C;
    address public constant LOCKED_POSITION_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;

    bytes32 public constant POOL_MANAGER_CODEHASH = 0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 public constant POSITION_MANAGER_CODEHASH =
        0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b;
    bytes32 public constant STATE_VIEW_CODEHASH = 0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878;
    bytes32 public constant V4_QUOTER_CODEHASH = 0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441;
    bytes32 public constant UERC20_FACTORY_CODEHASH =
        0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb;
    bytes32 public constant PERMIT2_CODEHASH = 0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131;
    bytes32 public constant UNIVERSAL_ROUTER_CODEHASH =
        0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49;
    bytes32 public constant LOCKED_POSITION_FACTORY_CODEHASH =
        0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2;

    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    struct DeploymentPlan {
        address broadcaster;
        uint64 startingNonce;
        address positionPlanner;
        address hookFactory;
        address launcher;
        address sampleHook;
        bytes32 sampleHookSalt;
        bytes32 sourceCommitment;
    }

    struct DeploymentResult {
        AdaptiveCurvePositionPlannerV1 positionPlanner;
        AdaptiveCurveFeeHookFactoryV1 hookFactory;
        AdaptiveCurveLaunchV1 launcher;
        address sampleHook;
        bytes32 sampleHookSalt;
        bytes32 sourceCommitment;
        uint64 startingNonce;
    }

    error DeploymentAddressOccupied(address target);
    error InvalidBroadcaster(address broadcaster);
    error UnexpectedAddress(bytes32 field, address actual, address expected);
    error UnexpectedChain(uint256 actual, uint256 expected);
    error UnexpectedCodeHash(address target, bytes32 actual, bytes32 expected);
    error UnexpectedHookFlags(uint160 actual, uint160 expected);
    error UnexpectedNonce(address broadcaster, uint64 actual, uint64 expected);
    error UnexpectedTreasury(address actual, address expected);
    error UnexpectedValue(bytes32 field, uint256 actual, uint256 expected);

    function run() external returns (DeploymentResult memory result) {
        address broadcaster = vm.envAddress("ADAPTIVE_MAINNET_DEPLOYER");
        address configuredTreasury = vm.envAddress("ADAPTIVE_MAINNET_TREASURY");
        uint256 configuredNonce = vm.envUint("ADAPTIVE_MAINNET_START_NONCE");
        if (configuredNonce > type(uint64).max) {
            revert UnexpectedValue(keccak256("startingNonce"), configuredNonce, type(uint64).max);
        }

        // The explicit bound above makes this narrowing conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        return deployReviewed(broadcaster, uint64(configuredNonce), configuredTreasury);
    }

    function deployReviewed(address broadcaster, uint64 startingNonce, address configuredTreasury)
        public
        returns (DeploymentResult memory result)
    {
        validateOfficialDependencies();
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        if (configuredTreasury != LAUNCHER_TREASURY) {
            revert UnexpectedTreasury(configuredTreasury, LAUNCHER_TREASURY);
        }

        uint64 actualNonce = vm.getNonce(broadcaster);
        if (actualNonce != startingNonce) revert UnexpectedNonce(broadcaster, actualNonce, startingNonce);

        DeploymentPlan memory plan = deploymentPlan(broadcaster, startingNonce);
        _assertVacant(plan.positionPlanner);
        _assertVacant(plan.hookFactory);
        _assertVacant(plan.launcher);

        vm.startBroadcast(broadcaster);
        result.positionPlanner = new AdaptiveCurvePositionPlannerV1();
        result.hookFactory = new AdaptiveCurveFeeHookFactoryV1();
        result.launcher = new AdaptiveCurveLaunchV1(
            IPoolManager(POOL_MANAGER),
            IPositionManager(POSITION_MANAGER),
            UERC20Factory(UERC20_FACTORY),
            result.hookFactory,
            result.positionPlanner,
            LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY),
            configuredTreasury
        );
        vm.stopBroadcast();

        _assertAddress(keccak256("positionPlanner"), address(result.positionPlanner), plan.positionPlanner);
        _assertAddress(keccak256("hookFactory"), address(result.hookFactory), plan.hookFactory);
        _assertAddress(keccak256("launcher"), address(result.launcher), plan.launcher);

        result.sampleHook = plan.sampleHook;
        result.sampleHookSalt = plan.sampleHookSalt;
        result.sourceCommitment = plan.sourceCommitment;
        result.startingNonce = startingNonce;
        _validateDeployedStack(result);

        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 3) {
            revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 3);
        }
    }

    function deploymentPlan(address broadcaster, uint64 startingNonce)
        public
        view
        returns (DeploymentPlan memory plan)
    {
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);

        plan.broadcaster = broadcaster;
        plan.startingNonce = startingNonce;
        plan.positionPlanner = vm.computeCreateAddress(broadcaster, startingNonce);
        plan.hookFactory = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1);
        plan.launcher = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 2);
        (plan.sampleHook, plan.sampleHookSalt) = HookMiner.find(
            plan.hookFactory,
            REQUIRED_HOOK_FLAGS,
            type(AdaptiveCurveFeeHookV1).creationCode,
            abi.encode(IPoolManager(POOL_MANAGER), LAUNCHER_TREASURY)
        );
        plan.sourceCommitment = deploymentSourceCommitment();
    }

    function predictHook(address hookFactory, bytes32 hookSalt) public pure returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(AdaptiveCurveFeeHookV1).creationCode, abi.encode(IPoolManager(POOL_MANAGER), LAUNCHER_TREASURY)
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), hookFactory, hookSalt, initCodeHash)))));
    }

    function validateOfficialDependencies() public view {
        if (block.chainid != MAINNET_CHAIN_ID) {
            revert UnexpectedChain(block.chainid, MAINNET_CHAIN_ID);
        }

        _assertCodeHash(POOL_MANAGER, POOL_MANAGER_CODEHASH);
        _assertCodeHash(POSITION_MANAGER, POSITION_MANAGER_CODEHASH);
        _assertCodeHash(STATE_VIEW, STATE_VIEW_CODEHASH);
        _assertCodeHash(V4_QUOTER, V4_QUOTER_CODEHASH);
        _assertCodeHash(UERC20_FACTORY, UERC20_FACTORY_CODEHASH);
        _assertCodeHash(PERMIT2, PERMIT2_CODEHASH);
        _assertCodeHash(UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_CODEHASH);
        _assertCodeHash(LOCKED_POSITION_FACTORY, LOCKED_POSITION_FACTORY_CODEHASH);
    }

    function deploymentSourceCommitment() public pure returns (bytes32) {
        bytes32 bytecodeCommitment = keccak256(
            abi.encode(
                keccak256(type(AdaptiveCurvePositionPlannerV1).creationCode),
                keccak256(type(AdaptiveCurveFeeHookFactoryV1).creationCode),
                keccak256(type(AdaptiveCurveFeeHookV1).creationCode),
                keccak256(type(AdaptiveCurveLaunchV1).creationCode)
            )
        );
        bytes32 dependencyCommitment = keccak256(
            abi.encode(
                POOL_MANAGER,
                POSITION_MANAGER,
                STATE_VIEW,
                V4_QUOTER,
                UERC20_FACTORY,
                PERMIT2,
                UNIVERSAL_ROUTER,
                LOCKED_POSITION_FACTORY,
                LAUNCHER_TREASURY
            )
        );
        bytes32 economicsCommitment = keccak256(
            abi.encode(
                uint256(10),
                uint256(0),
                int256(200),
                int256(204_200),
                uint256(1_000_000_000 ether),
                uint256(2),
                uint256(8),
                uint256(100),
                uint256(1000),
                keccak256("immutable-piecewise-linear-negated-pre-swap-tick"),
                keccak256("optional-atomic-creator-buy"),
                keccak256("one-sided-permanently-locked-official-v4-position")
            )
        );
        bytes32 securityCommitment = keccak256(
            abi.encode(
                keccak256("creator-bound-hook-nonce"),
                keccak256("forced-native-balance-preserved"),
                keccak256("creator-initiated-fee-claim")
            )
        );
        return keccak256(
            abi.encode(
                keccak256("programmable.adaptive.infrastructure.v1.ethereum"),
                bytecodeCommitment,
                dependencyCommitment,
                economicsCommitment,
                securityCommitment
            )
        );
    }

    function _validateDeployedStack(DeploymentResult memory result) private view {
        _assertCodeHash(address(result.positionPlanner), keccak256(type(AdaptiveCurvePositionPlannerV1).runtimeCode));
        _assertCodeHash(address(result.hookFactory), keccak256(type(AdaptiveCurveFeeHookFactoryV1).runtimeCode));
        if (address(result.launcher).code.length > MAX_LAUNCHER_RUNTIME_BYTES) {
            revert UnexpectedValue(
                keccak256("launcher.runtimeBytes"), address(result.launcher).code.length, MAX_LAUNCHER_RUNTIME_BYTES
            );
        }

        _assertAddress(keccak256("launcher.poolManager"), address(result.launcher.poolManager()), POOL_MANAGER);
        _assertAddress(
            keccak256("launcher.positionManager"), address(result.launcher.positionManager()), POSITION_MANAGER
        );
        _assertAddress(keccak256("launcher.tokenFactory"), address(result.launcher.tokenFactory()), UERC20_FACTORY);
        _assertAddress(
            keccak256("launcher.hookFactory"),
            address(result.launcher.adaptiveHookFactory()),
            address(result.hookFactory)
        );
        _assertAddress(
            keccak256("launcher.positionPlanner"),
            address(result.launcher.positionPlanner()),
            address(result.positionPlanner)
        );
        _assertAddress(
            keccak256("launcher.positionForwarderFactory"),
            address(result.launcher.positionForwarderFactory()),
            LOCKED_POSITION_FACTORY
        );
        _assertAddress(
            keccak256("launcher.launcherFeeRecipient"), result.launcher.launcherFeeRecipient(), LAUNCHER_TREASURY
        );

        _assertValue(keccak256("launcher.lpFeePips"), result.launcher.LP_FEE_PIPS(), 0);
        _assertValue(keccak256("launcher.tickSpacing"), uint24(result.launcher.TICK_SPACING()), 200);
        _assertValue(keccak256("launcher.initialTick"), uint24(result.launcher.INITIAL_TICK()), 204_200);

        address predicted = predictHook(address(result.hookFactory), result.sampleHookSalt);
        _assertAddress(keccak256("sampleHook"), result.sampleHook, predicted);
        uint160 actualFlags = uint160(result.sampleHook) & result.hookFactory.ALL_HOOK_MASK();
        uint160 expectedFlags = result.hookFactory.REQUIRED_HOOK_FLAGS();
        if (actualFlags != expectedFlags) revert UnexpectedHookFlags(actualFlags, expectedFlags);
    }

    function _assertVacant(address target) private view {
        if (target.code.length != 0) revert DeploymentAddressOccupied(target);
    }

    function _assertCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert UnexpectedCodeHash(target, actual, expected);
    }

    function _assertAddress(bytes32 field, address actual, address expected) private pure {
        if (actual != expected) revert UnexpectedAddress(field, actual, expected);
    }

    function _assertValue(bytes32 field, uint256 actual, uint256 expected) private pure {
        if (actual != expected) revert UnexpectedValue(field, actual, expected);
    }
}
