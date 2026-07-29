// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Script } from "forge-std/Script.sol";

import { DeepKeeperExecutorV2 } from "../src/DeepKeeperExecutorV2.sol";
import { LiquidityGrowthFeeOracleHookFactoryV2 } from "../src/LiquidityGrowthFeeOracleHookFactoryV2.sol";
import { LiquidityGrowthFeeOracleHookV2 } from "../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangeAutomationV3 } from "../src/LiquidityGrowthFullRangeAutomationV3.sol";
import { LiquidityGrowthFullRangeLaunchV3 } from "../src/LiquidityGrowthFullRangeLaunchV3.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangePositionPlannerV3 } from "../src/LiquidityGrowthFullRangePositionPlannerV3.sol";
import { LiquidityGrowthFullRangeVaultFactoryV3 } from "../src/LiquidityGrowthFullRangeVaultFactoryV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../src/LiquidityGrowthFullRangeVaultV3.sol";
import { LiquidityGrowthZapPlannerV3 } from "../src/LiquidityGrowthZapPlannerV3.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { ILiquidityGrowthFullRangeVaultFactoryV3 } from "../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";

/// @title DeployMainnetDeepFullRangeInfrastructureV3
/// @notice Deterministic, fail-closed deployment script for the reviewed Deep release candidate.
/// @dev A normal Forge script run is simulation-only. Broadcasting requires an explicit operator-controlled signer
///      and Forge's `--broadcast` flag. The reviewed sequence contains exactly six broadcaster transactions.
contract DeployMainnetDeepFullRangeInfrastructureV3 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant EIP170_RUNTIME_LIMIT = 24_576;
    uint256 internal constant EIP3860_INITCODE_LIMIT = 49_152;

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
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
            | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_DONATE_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    struct DeploymentPlan {
        address broadcaster;
        uint64 startingNonce;
        bytes32 hookSalt;
        address zapPlanner;
        address growthVaultFactory;
        address growthVaultImplementation;
        address hookFactory;
        address feeHook;
        address launcher;
        address positionPlanner;
        address automation;
        address keeperExecutor;
        bytes32 sourceCommitment;
    }

    struct DeploymentResult {
        LiquidityGrowthZapPlannerV3 zapPlanner;
        LiquidityGrowthFullRangeVaultFactoryV3 growthVaultFactory;
        LiquidityGrowthFeeOracleHookFactoryV2 hookFactory;
        LiquidityGrowthFeeOracleHookV2 feeHook;
        LiquidityGrowthFullRangeLaunchV3 launcher;
        LiquidityGrowthFullRangePositionPlannerV3 positionPlanner;
        LiquidityGrowthFullRangeAutomationV3 automation;
        DeepKeeperExecutorV2 keeperExecutor;
        bytes32 sourceCommitment;
        bytes32 hookSalt;
        uint64 startingNonce;
    }

    error DeploymentAddressOccupied(address target);
    error InvalidBroadcaster(address broadcaster);
    error InvalidHookSalt(bytes32 salt);
    error UnexpectedAddress(bytes32 field, address actual, address expected);
    error UnexpectedChain(uint256 actual, uint256 expected);
    error UnexpectedCodeHash(address target, bytes32 actual, bytes32 expected);
    error UnexpectedHookFlags(uint160 actual, uint160 expected);
    error UnexpectedNonce(address broadcaster, uint64 actual, uint64 expected);
    error UnexpectedTreasury(address actual, address expected);
    error UnexpectedValue(bytes32 field, uint256 actual, uint256 expected);

    function run() external returns (DeploymentResult memory result) {
        address broadcaster = vm.envAddress("DEEP_V3_MAINNET_DEPLOYER");
        address configuredTreasury = vm.envAddress("DEEP_V3_MAINNET_TREASURY");
        uint256 configuredNonce = vm.envUint("DEEP_V3_MAINNET_START_NONCE");
        bytes32 hookSalt = vm.envBytes32("DEEP_V3_HOOK_SALT");
        if (configuredNonce > type(uint64).max - 6) {
            revert UnexpectedValue(keccak256("startingNonce"), configuredNonce, type(uint64).max - 6);
        }

        // The explicit bound above makes this narrowing conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        return deployReviewed(broadcaster, uint64(configuredNonce), configuredTreasury, hookSalt);
    }

    function deployReviewed(address broadcaster, uint64 startingNonce, address configuredTreasury, bytes32 hookSalt)
        public
        returns (DeploymentResult memory result)
    {
        validateOfficialDependencies();
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        if (configuredTreasury != LAUNCHER_TREASURY) {
            revert UnexpectedTreasury(configuredTreasury, LAUNCHER_TREASURY);
        }
        if (hookSalt == bytes32(0)) revert InvalidHookSalt(hookSalt);
        if (startingNonce > type(uint64).max - 6) {
            revert UnexpectedValue(keccak256("startingNonce"), startingNonce, type(uint64).max - 6);
        }

        uint64 actualNonce = vm.getNonce(broadcaster);
        if (actualNonce != startingNonce) revert UnexpectedNonce(broadcaster, actualNonce, startingNonce);

        DeploymentPlan memory plan = deploymentPlan(broadcaster, startingNonce, hookSalt);
        _validatePlannedHook(plan);
        _assertVacant(plan.zapPlanner);
        _assertVacant(plan.growthVaultFactory);
        _assertVacant(plan.growthVaultImplementation);
        _assertVacant(plan.hookFactory);
        _assertVacant(plan.feeHook);
        _assertVacant(plan.launcher);
        _assertVacant(plan.positionPlanner);
        _assertVacant(plan.automation);
        _assertVacant(plan.keeperExecutor);

        vm.startBroadcast(broadcaster);
        result.zapPlanner = new LiquidityGrowthZapPlannerV3();
        result.growthVaultFactory = new LiquidityGrowthFullRangeVaultFactoryV3(result.zapPlanner);
        result.hookFactory = new LiquidityGrowthFeeOracleHookFactoryV2();
        result.feeHook = result.hookFactory
            .deploy(
                hookSalt,
                IPoolManager(POOL_MANAGER),
                configuredTreasury,
                ILiquidityGrowthFullRangeVaultFactoryV3(address(result.growthVaultFactory)),
                IPositionManager(POSITION_MANAGER),
                Policy.MAX_ABS_OBSERVATION_TICK_DELTA
            );
        result.launcher = new LiquidityGrowthFullRangeLaunchV3(
            IPoolManager(POOL_MANAGER),
            IPositionManager(POSITION_MANAGER),
            UERC20Factory(UERC20_FACTORY),
            result.feeHook,
            result.growthVaultFactory,
            LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY)
        );
        result.keeperExecutor = new DeepKeeperExecutorV2(result.launcher.automation());
        vm.stopBroadcast();

        result.positionPlanner = result.launcher.positionPlanner();
        result.automation = result.launcher.automation();
        result.sourceCommitment = plan.sourceCommitment;
        result.hookSalt = hookSalt;
        result.startingNonce = startingNonce;

        _assertAddress(keccak256("zapPlanner"), address(result.zapPlanner), plan.zapPlanner);
        _assertAddress(keccak256("growthVaultFactory"), address(result.growthVaultFactory), plan.growthVaultFactory);
        _assertAddress(
            keccak256("growthVaultImplementation"),
            result.growthVaultFactory.implementation(),
            plan.growthVaultImplementation
        );
        _assertAddress(keccak256("hookFactory"), address(result.hookFactory), plan.hookFactory);
        _assertAddress(keccak256("feeHook"), address(result.feeHook), plan.feeHook);
        _assertAddress(keccak256("launcher"), address(result.launcher), plan.launcher);
        _assertAddress(keccak256("positionPlanner"), address(result.positionPlanner), plan.positionPlanner);
        _assertAddress(keccak256("automation"), address(result.automation), plan.automation);
        _assertAddress(keccak256("keeperExecutor"), address(result.keeperExecutor), plan.keeperExecutor);

        _validateDeployedStack(result);
        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 6) {
            revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 6);
        }
    }

    function deploymentPlan(address broadcaster, uint64 startingNonce, bytes32 hookSalt)
        public
        pure
        returns (DeploymentPlan memory plan)
    {
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        if (hookSalt == bytes32(0)) revert InvalidHookSalt(hookSalt);
        if (startingNonce > type(uint64).max - 6) {
            revert UnexpectedValue(keccak256("startingNonce"), startingNonce, type(uint64).max - 6);
        }

        plan.broadcaster = broadcaster;
        plan.startingNonce = startingNonce;
        plan.hookSalt = hookSalt;
        plan.zapPlanner = vm.computeCreateAddress(broadcaster, startingNonce);
        plan.growthVaultFactory = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1);
        plan.growthVaultImplementation = vm.computeCreateAddress(plan.growthVaultFactory, 1);
        plan.hookFactory = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 2);
        plan.feeHook = Create2.computeAddress(hookSalt, _hookInitCodeHash(plan.growthVaultFactory), plan.hookFactory);
        plan.launcher = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 4);
        plan.positionPlanner = vm.computeCreateAddress(plan.launcher, 1);
        plan.automation = vm.computeCreateAddress(plan.launcher, 2);
        plan.keeperExecutor = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 5);
        plan.sourceCommitment = deploymentSourceCommitment();
    }

    function validateOfficialDependencies() public view {
        if (block.chainid != MAINNET_CHAIN_ID) revert UnexpectedChain(block.chainid, MAINNET_CHAIN_ID);
        _assertCodeHash(POOL_MANAGER, POOL_MANAGER_CODEHASH);
        _assertCodeHash(POSITION_MANAGER, POSITION_MANAGER_CODEHASH);
        _assertCodeHash(STATE_VIEW, STATE_VIEW_CODEHASH);
        _assertCodeHash(V4_QUOTER, V4_QUOTER_CODEHASH);
        _assertCodeHash(UERC20_FACTORY, UERC20_FACTORY_CODEHASH);
        _assertCodeHash(PERMIT2, PERMIT2_CODEHASH);
        _assertCodeHash(UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_CODEHASH);
        _assertCodeHash(LOCKED_POSITION_FACTORY, LOCKED_POSITION_FACTORY_CODEHASH);
        _assertAddress(
            keccak256("positionManager.poolManager"),
            address(IPositionManager(POSITION_MANAGER).poolManager()),
            POOL_MANAGER
        );
        _assertAddress(
            keccak256("lockedPositionFactory.positionManager"),
            address(LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY).positionManager()),
            POSITION_MANAGER
        );
    }

    function deploymentSourceCommitment() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("programmable.deep.full-range.infrastructure.v3.ethereum"),
                _bytecodeCommitment(),
                _dependencyCommitment(),
                _policyCommitment(),
                _securityCommitment()
            )
        );
    }

    function _hookInitCodeHash(address growthVaultFactory) private pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(LiquidityGrowthFeeOracleHookV2).creationCode,
                abi.encode(
                    IPoolManager(POOL_MANAGER),
                    LAUNCHER_TREASURY,
                    ILiquidityGrowthFullRangeVaultFactoryV3(growthVaultFactory),
                    IPositionManager(POSITION_MANAGER),
                    Policy.MAX_ABS_OBSERVATION_TICK_DELTA
                )
            )
        );
    }

    function _bytecodeCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(LiquidityGrowthZapPlannerV3).creationCode),
                keccak256(type(LiquidityGrowthFullRangeVaultFactoryV3).creationCode),
                keccak256(type(LiquidityGrowthFullRangeVaultV3).creationCode),
                keccak256(type(LiquidityGrowthFeeOracleHookFactoryV2).creationCode),
                keccak256(type(LiquidityGrowthFeeOracleHookV2).creationCode),
                keccak256(type(LiquidityGrowthFullRangeLaunchV3).creationCode),
                keccak256(type(LiquidityGrowthFullRangePositionPlannerV3).creationCode),
                keccak256(type(LiquidityGrowthFullRangeAutomationV3).creationCode),
                keccak256(type(DeepKeeperExecutorV2).creationCode)
            )
        );
    }

    function _dependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(_coreDependencyCommitment(), _routingDependencyCommitment(), _lockingDependencyCommitment())
        );
    }

    function _coreDependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POOL_MANAGER,
                POOL_MANAGER_CODEHASH,
                POSITION_MANAGER,
                POSITION_MANAGER_CODEHASH,
                STATE_VIEW,
                STATE_VIEW_CODEHASH,
                V4_QUOTER,
                V4_QUOTER_CODEHASH
            )
        );
    }

    function _routingDependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                UERC20_FACTORY,
                UERC20_FACTORY_CODEHASH,
                PERMIT2,
                PERMIT2_CODEHASH,
                UNIVERSAL_ROUTER,
                UNIVERSAL_ROUTER_CODEHASH
            )
        );
    }

    function _lockingDependencyCommitment() private pure returns (bytes32) {
        return keccak256(abi.encode(LOCKED_POSITION_FACTORY, LOCKED_POSITION_FACTORY_CODEHASH, LAUNCHER_TREASURY));
    }

    function _policyCommitment() private pure returns (bytes32) {
        return
            keccak256(abi.encode(_marketPolicyCommitment(), _automationPolicyCommitment(), _oraclePolicyCommitment()));
    }

    function _marketPolicyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                Policy.TOTAL_HOOK_FEE_BPS,
                Policy.GROWTH_FEE_BPS,
                Policy.PROGRAMMABLE_FEE_BPS,
                Policy.LP_FEE_PIPS,
                Policy.TICK_SPACING,
                Policy.INITIAL_TICK,
                Policy.FULL_RANGE_TICK_LOWER,
                Policy.FULL_RANGE_TICK_UPPER,
                Policy.TOKEN_SUPPLY,
                Policy.MIN_INITIAL_BUY_WEI,
                Policy.MIN_COMPOUND_NATIVE,
                Policy.MAX_COMPOUND_NATIVE
            )
        );
    }

    function _automationPolicyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                Policy.COMPOUND_COOLDOWN_SECONDS,
                Policy.ROLLING_EXPOSURE_WINDOW_SECONDS,
                Policy.ROLLING_EXPOSURE_RECORD_CAPACITY,
                Policy.TRUSTED_DEPTH_CYCLE_CAP_BPS,
                Policy.MAX_OPTIMIZER_ITERATIONS,
                Policy.LOCKED_POSITION_SALT,
                Policy.COMPOUND_DOMAIN_TAG
            )
        );
    }

    function _oraclePolicyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                Policy.TWAP_WINDOW,
                Policy.SHORT_TWAP_WINDOW,
                Policy.MIN_OBSERVATION_CARDINALITY_NEXT,
                Policy.MAX_ABS_OBSERVATION_TICK_DELTA,
                Policy.MAX_RAW_TRUNCATED_TWAP_DELTA_TICKS,
                Policy.MAX_SHORT_LONG_TWAP_DEVIATION_TICKS,
                Policy.MAX_PRE_SPOT_TWAP_DEVIATION_TICKS,
                Policy.MAX_INTERNAL_SWAP_IMPACT_TICKS,
                Policy.MAX_POST_SPOT_TWAP_DEVIATION_TICKS
            )
        );
    }

    function _securityCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("exact-original-pool-id"),
                keccak256("atomic-native-buy-and-permanent-add"),
                keccak256("vault-only-transient-fee-exemption"),
                keccak256("fixed-one-percent-ninety-ten-native-split"),
                keccak256("staged-192-observation-thirty-minute-twap"),
                keccak256("five-minute-minimum-cooldown"),
                keccak256("bounded-rolling-exposure"),
                keccak256("zero-admin-zero-withdrawal-zero-rescue"),
                keccak256("permissionless-fail-closed-keeper")
            )
        );
    }

    function _validatePlannedHook(DeploymentPlan memory plan) private pure {
        uint160 actualFlags = uint160(plan.feeHook) & uint160((1 << 14) - 1);
        if (actualFlags != REQUIRED_HOOK_FLAGS) {
            revert UnexpectedHookFlags(actualFlags, REQUIRED_HOOK_FLAGS);
        }
    }

    function _validateDeployedStack(DeploymentResult memory result) private view {
        _assertCodeHash(address(result.zapPlanner), keccak256(type(LiquidityGrowthZapPlannerV3).runtimeCode));
        _assertCodeHash(address(result.hookFactory), keccak256(type(LiquidityGrowthFeeOracleHookFactoryV2).runtimeCode));
        _assertCodeHash(
            address(result.positionPlanner), keccak256(type(LiquidityGrowthFullRangePositionPlannerV3).runtimeCode)
        );

        _assertAddress(
            keccak256("vaultFactory.planner"), address(result.growthVaultFactory.planner()), address(result.zapPlanner)
        );
        LiquidityGrowthFullRangeVaultV3 implementation =
            LiquidityGrowthFullRangeVaultV3(payable(result.growthVaultFactory.implementation()));
        _assertAddress(
            keccak256("vaultImplementation.factory"), implementation.FACTORY(), address(result.growthVaultFactory)
        );

        _assertAddress(keccak256("hook.poolManager"), address(result.feeHook.poolManager()), POOL_MANAGER);
        _assertAddress(keccak256("hook.positionManager"), address(result.feeHook.positionManager()), POSITION_MANAGER);
        _assertAddress(keccak256("hook.treasury"), result.feeHook.launcherFeeRecipient(), LAUNCHER_TREASURY);
        _assertAddress(
            keccak256("hook.growthVaultFactory"),
            address(result.feeHook.growthVaultFactory()),
            address(result.growthVaultFactory)
        );
        _assertValue(keccak256("hook.totalFeeBps"), result.feeHook.TOTAL_HOOK_FEE_BPS(), 100);
        _assertValue(keccak256("hook.growthFeeBps"), result.feeHook.GROWTH_FEE_BPS(), 90);
        _assertValue(keccak256("hook.programmableFeeBps"), result.feeHook.PROGRAMMABLE_FEE_BPS(), 10);
        _assertValue(keccak256("hook.transferTaxBps"), result.feeHook.TRANSFER_TAX_BPS(), 0);
        _assertValue(keccak256("hook.lpFeePips"), result.feeHook.LP_FEE_PIPS(), 0);
        _assertValue(
            keccak256("hook.maxAbsTickDelta"),
            uint24(result.feeHook.maxAbsTickDelta()),
            uint24(Policy.MAX_ABS_OBSERVATION_TICK_DELTA)
        );
        uint160 actualFlags = uint160(address(result.feeHook)) & result.hookFactory.ALL_HOOK_MASK();
        if (actualFlags != result.hookFactory.REQUIRED_HOOK_FLAGS()) {
            revert UnexpectedHookFlags(actualFlags, result.hookFactory.REQUIRED_HOOK_FLAGS());
        }
        if (!result.hookFactory.isFactoryHook(address(result.feeHook))) {
            revert UnexpectedAddress(keccak256("hookFactory.provenance"), address(0), address(result.feeHook));
        }

        _assertAddress(keccak256("launcher.poolManager"), address(result.launcher.poolManager()), POOL_MANAGER);
        _assertAddress(
            keccak256("launcher.positionManager"), address(result.launcher.positionManager()), POSITION_MANAGER
        );
        _assertAddress(keccak256("launcher.tokenFactory"), address(result.launcher.tokenFactory()), UERC20_FACTORY);
        _assertAddress(keccak256("launcher.feeHook"), address(result.launcher.feeHook()), address(result.feeHook));
        _assertAddress(
            keccak256("launcher.growthVaultFactory"),
            address(result.launcher.growthVaultFactory()),
            address(result.growthVaultFactory)
        );
        _assertAddress(
            keccak256("launcher.positionForwarderFactory"),
            address(result.launcher.positionForwarderFactory()),
            LOCKED_POSITION_FACTORY
        );
        _assertAddress(
            keccak256("launcher.positionPlanner"),
            address(result.launcher.positionPlanner()),
            address(result.positionPlanner)
        );
        _assertAddress(
            keccak256("launcher.automation"), address(result.launcher.automation()), address(result.automation)
        );
        _assertAddress(
            keccak256("automation.vaultFactory"),
            address(result.automation.vaultFactory()),
            address(result.growthVaultFactory)
        );
        _assertAddress(keccak256("automation.launcher"), result.automation.launcher(), address(result.launcher));
        _assertAddress(
            keccak256("keeperExecutor.automation"),
            address(result.keeperExecutor.automation()),
            address(result.automation)
        );

        _assertValue(keccak256("launcher.tokenSupply"), result.launcher.TOKEN_SUPPLY(), Policy.TOKEN_SUPPLY);
        _assertValue(
            keccak256("launcher.minimumInitialBuy"), result.launcher.MIN_INITIAL_BUY_WEI(), Policy.MIN_INITIAL_BUY_WEI
        );
        _assertValue(
            keccak256("automation.observationTarget"),
            result.automation.OBSERVATION_CARDINALITY_TARGET(),
            Policy.MIN_OBSERVATION_CARDINALITY_NEXT
        );
        _assertValue(keccak256("executor.maxBatchSize"), result.keeperExecutor.MAX_BATCH_SIZE(), 4);

        _assertRuntimeSize(address(result.zapPlanner));
        _assertRuntimeSize(address(result.growthVaultFactory));
        _assertRuntimeSize(result.growthVaultFactory.implementation());
        _assertRuntimeSize(address(result.hookFactory));
        _assertRuntimeSize(address(result.feeHook));
        _assertRuntimeSize(address(result.launcher));
        _assertRuntimeSize(address(result.positionPlanner));
        _assertRuntimeSize(address(result.automation));
        _assertRuntimeSize(address(result.keeperExecutor));
        if (type(LiquidityGrowthFullRangeLaunchV3).creationCode.length > EIP3860_INITCODE_LIMIT) {
            revert UnexpectedValue(
                keccak256("launcherInitcodeBytes"),
                type(LiquidityGrowthFullRangeLaunchV3).creationCode.length,
                EIP3860_INITCODE_LIMIT
            );
        }
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

    function _assertRuntimeSize(address target) private view {
        if (target.code.length == 0 || target.code.length > EIP170_RUNTIME_LIMIT) {
            revert UnexpectedValue(keccak256("runtimeBytes"), target.code.length, EIP170_RUNTIME_LIMIT);
        }
    }
}
