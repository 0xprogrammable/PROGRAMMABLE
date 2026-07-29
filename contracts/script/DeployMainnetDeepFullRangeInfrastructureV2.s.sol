// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthFullRangeAutomationV2 } from "../src/LiquidityGrowthFullRangeAutomationV2.sol";
import { LiquidityGrowthFullRangeLaunchV2 } from "../src/LiquidityGrowthFullRangeLaunchV2.sol";
import { LiquidityGrowthFullRangePositionPlannerV2 } from "../src/LiquidityGrowthFullRangePositionPlannerV2.sol";
import { LiquidityGrowthFullRangeVaultFactoryV2 } from "../src/LiquidityGrowthFullRangeVaultFactoryV2.sol";
import { LiquidityGrowthFullRangeVaultV2 } from "../src/LiquidityGrowthFullRangeVaultV2.sol";
import { LiquidityGrowthRangeSourceFactoryV1 } from "../src/LiquidityGrowthRangeSourceFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "../src/interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";

/// @title DeployMainnetDeepFullRangeInfrastructureV2
/// @notice Deterministic, fail-closed Mainnet deployment script for the reviewed Deep V2 stack.
/// @dev Reuses the already deployed, source-verified V1 fee/oracle stack because V2 was explicitly designed around
///      those immutable interfaces and parameters. A normal Forge script run is simulation-only. Broadcasting still
///      requires Forge's explicit `--broadcast` flag and an operator-controlled signer. The reviewed sequence is
///      exactly two broadcaster transactions.
contract DeployMainnetDeepFullRangeInfrastructureV2 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant EIP170_RUNTIME_LIMIT = 24_576;

    address public constant LAUNCHER_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant FEE_SPLIT_VAULT_FACTORY = 0xF15D4528Db481732Cdb94FC2558d04ce4D85Cb54;
    address public constant HOOK_FACTORY = 0xb003a14Ef04D5022A8CfB4158b49f77e2e73b5E9;
    address public constant FEE_HOOK = 0x48dC3009eC1d3298BBA31f718A9A29d02fC9B0cC;
    address public constant RANGE_SOURCE_FACTORY = 0xb2Ec2573bB6968b9fA85f1A0b82E33bB0A388a43;
    address public constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address public constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address public constant STATE_VIEW = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    address public constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
    address public constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant UNIVERSAL_ROUTER = 0xd92A36B0000531EF3063dEd4De20A0783308446C;
    address public constant LOCKED_POSITION_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;

    bytes32 public constant POOL_MANAGER_CODEHASH = 0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 public constant FEE_SPLIT_VAULT_FACTORY_CODEHASH =
        0x6e0fed3c3598d32458b9c7ce04a97ae3e0cc847e4022e3dec5a14cd1f29c88fc;
    bytes32 public constant HOOK_FACTORY_CODEHASH = 0x786c4720eeb3583c6021794e39360369f52510d2d0b29b8212b99bb9e6efe5ae;
    bytes32 public constant FEE_HOOK_CODEHASH = 0xda536944ead25d438a8a957ec1c7997115fb36d7e1af963d162b1ce99229b002;
    bytes32 public constant RANGE_SOURCE_FACTORY_CODEHASH =
        0x3c909216b8f1200c19d6d01f65b332fe3eca4728e27d671a86a346089df69373;
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
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    struct DeploymentPlan {
        address broadcaster;
        uint64 startingNonce;
        address feeSplitVaultFactory;
        address hookFactory;
        address feeHook;
        address rangeSourceFactory;
        address growthVaultFactory;
        address growthVaultImplementation;
        address launcher;
        address automation;
        address positionPlanner;
        bytes32 sourceCommitment;
    }

    struct DeploymentResult {
        FeeSplitVaultFactoryV1 feeSplitVaultFactory;
        LiquidityGrowthFeeOracleHookFactoryV1 hookFactory;
        LiquidityGrowthFeeOracleHookV1 feeHook;
        LiquidityGrowthRangeSourceFactoryV1 rangeSourceFactory;
        LiquidityGrowthFullRangeVaultFactoryV2 growthVaultFactory;
        LiquidityGrowthFullRangeLaunchV2 launcher;
        LiquidityGrowthFullRangeAutomationV2 automation;
        LiquidityGrowthFullRangePositionPlannerV2 positionPlanner;
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
        address broadcaster = vm.envAddress("DEEP_V2_MAINNET_DEPLOYER");
        address configuredTreasury = vm.envAddress("DEEP_V2_MAINNET_TREASURY");
        uint256 configuredNonce = vm.envUint("DEEP_V2_MAINNET_START_NONCE");
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
        _assertVacant(plan.growthVaultFactory);
        _assertVacant(plan.growthVaultImplementation);
        _assertVacant(plan.launcher);
        _assertVacant(plan.automation);
        _assertVacant(plan.positionPlanner);

        result.feeSplitVaultFactory = FeeSplitVaultFactoryV1(FEE_SPLIT_VAULT_FACTORY);
        result.hookFactory = LiquidityGrowthFeeOracleHookFactoryV1(HOOK_FACTORY);
        result.feeHook = LiquidityGrowthFeeOracleHookV1(payable(FEE_HOOK));
        result.rangeSourceFactory = LiquidityGrowthRangeSourceFactoryV1(RANGE_SOURCE_FACTORY);

        vm.startBroadcast(broadcaster);
        result.growthVaultFactory = new LiquidityGrowthFullRangeVaultFactoryV2(
            result.hookFactory,
            result.feeSplitVaultFactory,
            IPositionManager(POSITION_MANAGER),
            LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY),
            result.rangeSourceFactory
        );
        result.launcher = new LiquidityGrowthFullRangeLaunchV2(
            IPoolManager(POOL_MANAGER),
            IPositionManager(POSITION_MANAGER),
            UERC20Factory(UERC20_FACTORY),
            ILiquidityGrowthFullRangeOracleHookV1(address(result.feeHook)),
            result.feeSplitVaultFactory,
            result.rangeSourceFactory,
            result.growthVaultFactory,
            LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY)
        );
        vm.stopBroadcast();

        _assertAddress(
            keccak256("feeSplitVaultFactory"), address(result.feeSplitVaultFactory), plan.feeSplitVaultFactory
        );
        _assertAddress(keccak256("hookFactory"), address(result.hookFactory), plan.hookFactory);
        _assertAddress(keccak256("feeHook"), address(result.feeHook), plan.feeHook);
        _assertAddress(keccak256("rangeSourceFactory"), address(result.rangeSourceFactory), plan.rangeSourceFactory);
        _assertAddress(keccak256("growthVaultFactory"), address(result.growthVaultFactory), plan.growthVaultFactory);
        _assertAddress(
            keccak256("growthVaultImplementation"),
            result.growthVaultFactory.implementation(),
            plan.growthVaultImplementation
        );
        _assertAddress(keccak256("launcher"), address(result.launcher), plan.launcher);
        result.automation = result.launcher.automation();
        result.positionPlanner = result.launcher.positionPlanner();
        _assertAddress(keccak256("automation"), address(result.automation), plan.automation);
        _assertAddress(keccak256("positionPlanner"), address(result.positionPlanner), plan.positionPlanner);

        result.sourceCommitment = plan.sourceCommitment;
        result.startingNonce = startingNonce;
        _validateDeployedStack(result);

        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 2) {
            revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 2);
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
        plan.feeSplitVaultFactory = FEE_SPLIT_VAULT_FACTORY;
        plan.hookFactory = HOOK_FACTORY;
        plan.feeHook = FEE_HOOK;
        plan.rangeSourceFactory = RANGE_SOURCE_FACTORY;
        plan.growthVaultFactory = vm.computeCreateAddress(broadcaster, startingNonce);
        plan.growthVaultImplementation = vm.computeCreateAddress(plan.growthVaultFactory, 1);
        plan.launcher = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1);
        plan.automation = vm.computeCreateAddress(plan.launcher, 1);
        plan.positionPlanner = vm.computeCreateAddress(plan.launcher, 2);
        plan.sourceCommitment = deploymentSourceCommitment();
    }

    function validateOfficialDependencies() public view {
        if (block.chainid != MAINNET_CHAIN_ID) revert UnexpectedChain(block.chainid, MAINNET_CHAIN_ID);
        _assertCodeHash(FEE_SPLIT_VAULT_FACTORY, FEE_SPLIT_VAULT_FACTORY_CODEHASH);
        _assertCodeHash(HOOK_FACTORY, HOOK_FACTORY_CODEHASH);
        _assertCodeHash(FEE_HOOK, FEE_HOOK_CODEHASH);
        _assertCodeHash(RANGE_SOURCE_FACTORY, RANGE_SOURCE_FACTORY_CODEHASH);
        _assertCodeHash(POOL_MANAGER, POOL_MANAGER_CODEHASH);
        _assertCodeHash(POSITION_MANAGER, POSITION_MANAGER_CODEHASH);
        _assertCodeHash(STATE_VIEW, STATE_VIEW_CODEHASH);
        _assertCodeHash(V4_QUOTER, V4_QUOTER_CODEHASH);
        _assertCodeHash(UERC20_FACTORY, UERC20_FACTORY_CODEHASH);
        _assertCodeHash(PERMIT2, PERMIT2_CODEHASH);
        _assertCodeHash(UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_CODEHASH);
        _assertCodeHash(LOCKED_POSITION_FACTORY, LOCKED_POSITION_FACTORY_CODEHASH);

        LiquidityGrowthFeeOracleHookFactoryV1 hookFactory = LiquidityGrowthFeeOracleHookFactoryV1(HOOK_FACTORY);
        LiquidityGrowthFeeOracleHookV1 feeHook = LiquidityGrowthFeeOracleHookV1(payable(FEE_HOOK));
        _assertAddress(keccak256("sharedHook.poolManager"), address(feeHook.poolManager()), POOL_MANAGER);
        _assertAddress(keccak256("sharedHook.treasury"), feeHook.launcherFeeRecipient(), LAUNCHER_TREASURY);
        _assertAddress(
            keccak256("sharedHook.feeSplitVaultFactory"),
            address(feeHook.feeSplitVaultFactory()),
            FEE_SPLIT_VAULT_FACTORY
        );
        _assertValue(keccak256("sharedHook.maxAbsTickDelta"), uint24(feeHook.maxAbsTickDelta()), 400);
        _assertValue(keccak256("sharedHook.tickSpacing"), uint24(feeHook.TICK_SPACING()), 200);
        _assertValue(keccak256("sharedHook.lpFeePips"), feeHook.LP_FEE_PIPS(), 0);
        uint160 actualFlags = uint160(FEE_HOOK) & hookFactory.ALL_HOOK_MASK();
        uint160 expectedFlags = hookFactory.REQUIRED_HOOK_FLAGS();
        if (expectedFlags != REQUIRED_HOOK_FLAGS) revert UnexpectedHookFlags(expectedFlags, REQUIRED_HOOK_FLAGS);
        if (actualFlags != expectedFlags) revert UnexpectedHookFlags(actualFlags, expectedFlags);
        if (!hookFactory.isFactoryHook(FEE_HOOK)) {
            revert UnexpectedAddress(keccak256("sharedHookFactory.provenance"), address(0), FEE_HOOK);
        }
        (uint256 creatorFee, uint256 programmableFee) = feeHook.quoteGrossFees(1 ether, 100);
        _assertValue(keccak256("sharedHook.creatorFee"), creatorFee, 0.009 ether);
        _assertValue(keccak256("sharedHook.programmableFee"), programmableFee, 0.001 ether);
    }

    function deploymentSourceCommitment() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("programmable.deep.full-range.infrastructure.v2.ethereum"),
                _v2BytecodeCommitment(),
                _dependencyCommitment(),
                _policyCommitment(),
                _securityCommitment()
            )
        );
    }

    function _v2BytecodeCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(LiquidityGrowthFullRangeVaultFactoryV2).creationCode),
                keccak256(type(LiquidityGrowthFullRangeVaultV2).creationCode),
                keccak256(type(LiquidityGrowthFullRangeLaunchV2).creationCode),
                keccak256(type(LiquidityGrowthFullRangeAutomationV2).creationCode),
                keccak256(type(LiquidityGrowthFullRangePositionPlannerV2).creationCode)
            )
        );
    }

    function _dependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _sharedDependencyCommitment(),
                _uniswapCoreDependencyCommitment(),
                _uniswapRoutingDependencyCommitment(),
                _lockingDependencyCommitment()
            )
        );
    }

    function _sharedDependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FEE_SPLIT_VAULT_FACTORY,
                FEE_SPLIT_VAULT_FACTORY_CODEHASH,
                HOOK_FACTORY,
                HOOK_FACTORY_CODEHASH,
                FEE_HOOK,
                FEE_HOOK_CODEHASH,
                RANGE_SOURCE_FACTORY,
                RANGE_SOURCE_FACTORY_CODEHASH
            )
        );
    }

    function _uniswapCoreDependencyCommitment() private pure returns (bytes32) {
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

    function _uniswapRoutingDependencyCommitment() private pure returns (bytes32) {
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
        return keccak256(abi.encode(_marketPolicyCommitment(), _automationPolicyCommitment()));
    }

    function _marketPolicyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                uint256(100),
                uint256(90),
                uint256(10),
                uint256(0),
                int256(200),
                int256(204_200),
                int256(218_000),
                int256(-887_200),
                int256(887_200),
                uint256(1_000_000_000 ether),
                uint256(150_000_000 ether),
                uint256(0.05 ether),
                uint256(0.0006 ether)
            )
        );
    }

    function _automationPolicyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                uint256(0.002 ether),
                uint256(0.25 ether),
                uint256(5 minutes),
                uint256(30 minutes),
                uint256(8),
                uint256(30 minutes),
                uint256(600),
                uint256(400),
                uint256(25),
                uint256(8500),
                uint256(192),
                uint256(0.002 ether)
            )
        );
    }

    function _securityCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("one-immutable-add-only-full-range-position"),
                keccak256("v2-fixed-one-percent-ninety-ten-fee-split"),
                keccak256("staged-192-observation-30-minute-twap"),
                keccak256("fixed-window-start-trusted-depth-cap"),
                keccak256("creator-bound-permanent-position-fee-forwarder"),
                keccak256("permanently-locked-unused-reserve"),
                keccak256("zero-admin-zero-withdrawal")
            )
        );
    }

    function _validateDeployedStack(DeploymentResult memory result) private view {
        _assertCodeHash(address(result.feeSplitVaultFactory), keccak256(type(FeeSplitVaultFactoryV1).runtimeCode));
        _assertCodeHash(address(result.hookFactory), keccak256(type(LiquidityGrowthFeeOracleHookFactoryV1).runtimeCode));
        _assertCodeHash(
            address(result.rangeSourceFactory), keccak256(type(LiquidityGrowthRangeSourceFactoryV1).runtimeCode)
        );
        _assertCodeHash(
            address(result.positionPlanner), keccak256(type(LiquidityGrowthFullRangePositionPlannerV2).runtimeCode)
        );

        _assertAddress(keccak256("hook.poolManager"), address(result.feeHook.poolManager()), POOL_MANAGER);
        _assertAddress(keccak256("hook.treasury"), result.feeHook.launcherFeeRecipient(), LAUNCHER_TREASURY);
        _assertAddress(
            keccak256("hook.feeSplitVaultFactory"),
            address(result.feeHook.feeSplitVaultFactory()),
            address(result.feeSplitVaultFactory)
        );
        _assertValue(keccak256("hook.maxAbsTickDelta"), uint24(result.feeHook.maxAbsTickDelta()), 400);
        _assertValue(keccak256("hook.launcherFeeBps"), result.feeHook.LAUNCHER_FEE_BPS(), 10);
        _assertValue(keccak256("hook.lpFeePips"), result.feeHook.LP_FEE_PIPS(), 0);
        uint160 actualFlags = uint160(address(result.feeHook)) & result.hookFactory.ALL_HOOK_MASK();
        uint160 expectedFlags = result.hookFactory.REQUIRED_HOOK_FLAGS();
        if (actualFlags != expectedFlags) revert UnexpectedHookFlags(actualFlags, expectedFlags);
        if (!result.hookFactory.isFactoryHook(address(result.feeHook))) {
            revert UnexpectedAddress(keccak256("hookFactory.provenance"), address(0), address(result.feeHook));
        }

        _assertAddress(
            keccak256("vaultFactory.hookFactory"),
            address(result.growthVaultFactory.hookFactory()),
            address(result.hookFactory)
        );
        _assertAddress(
            keccak256("vaultFactory.feeSplitVaultFactory"),
            address(result.growthVaultFactory.feeSplitVaultFactory()),
            address(result.feeSplitVaultFactory)
        );
        _assertAddress(
            keccak256("vaultFactory.positionManager"),
            address(result.growthVaultFactory.positionManager()),
            POSITION_MANAGER
        );
        _assertAddress(
            keccak256("vaultFactory.poolManager"), address(result.growthVaultFactory.poolManager()), POOL_MANAGER
        );
        _assertAddress(
            keccak256("vaultFactory.positionForwarderFactory"),
            address(result.growthVaultFactory.positionForwarderFactory()),
            LOCKED_POSITION_FACTORY
        );
        _assertAddress(
            keccak256("vaultFactory.rangeSourceFactory"),
            address(result.growthVaultFactory.rangeSourceFactory()),
            address(result.rangeSourceFactory)
        );
        LiquidityGrowthFullRangeVaultV2 implementation =
            LiquidityGrowthFullRangeVaultV2(payable(result.growthVaultFactory.implementation()));
        _assertAddress(
            keccak256("vaultImplementation.factory"), implementation.FACTORY(), address(result.growthVaultFactory)
        );

        _assertAddress(keccak256("launcher.poolManager"), address(result.launcher.poolManager()), POOL_MANAGER);
        _assertAddress(
            keccak256("launcher.positionManager"), address(result.launcher.positionManager()), POSITION_MANAGER
        );
        _assertAddress(keccak256("launcher.tokenFactory"), address(result.launcher.tokenFactory()), UERC20_FACTORY);
        _assertAddress(keccak256("launcher.feeHook"), address(result.launcher.feeHook()), address(result.feeHook));
        _assertAddress(
            keccak256("launcher.feeSplitVaultFactory"),
            address(result.launcher.feeSplitVaultFactory()),
            address(result.feeSplitVaultFactory)
        );
        _assertAddress(
            keccak256("launcher.rangeSourceFactory"),
            address(result.launcher.rangeSourceFactory()),
            address(result.rangeSourceFactory)
        );
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
            keccak256("launcher.automation"), address(result.launcher.automation()), address(result.automation)
        );
        _assertAddress(
            keccak256("launcher.positionPlanner"),
            address(result.launcher.positionPlanner()),
            address(result.positionPlanner)
        );
        _assertAddress(
            keccak256("automation.vaultFactory"),
            address(result.automation.vaultFactory()),
            address(result.growthVaultFactory)
        );
        _assertAddress(keccak256("automation.launcher"), result.automation.launcher(), address(result.launcher));

        _assertValue(keccak256("launcher.tokenSupply"), result.launcher.TOKEN_SUPPLY(), 1_000_000_000 ether);
        _assertValue(keccak256("launcher.tokenReserve"), result.launcher.TOKEN_RESERVE_TARGET(), 150_000_000 ether);
        _assertValue(keccak256("launcher.nativeTarget"), result.launcher.GROWTH_TARGET_NATIVE(), 0.05 ether);
        _assertValue(keccak256("launcher.totalFeeBps"), result.launcher.TOTAL_SWAP_FEE_BPS(), 100);
        _assertValue(keccak256("launcher.creatorFeeBps"), result.launcher.CREATOR_FEE_BPS(), 90);
        _assertValue(keccak256("launcher.programmableFeeBps"), result.launcher.PROGRAMMABLE_FEE_BPS(), 10);
        _assertValue(keccak256("launcher.minimumInitialBuy"), result.launcher.MIN_INITIAL_BUY_WEI(), 0.0006 ether);
        _assertValue(keccak256("launcher.twapWindow"), result.launcher.TWAP_WINDOW(), 30 minutes);
        _assertValue(
            keccak256("launcher.spotTwapDeviation"), uint24(result.launcher.MAX_SPOT_TWAP_DEVIATION_TICKS()), 600
        );
        _assertValue(keccak256("launcher.initialTick"), uint24(result.launcher.INITIAL_TICK()), 204_200);

        _assertValue(keccak256("automation.maxBatchSize"), result.automation.MAX_BATCH_SIZE(), 32);
        _assertValue(keccak256("automation.observationTarget"), result.automation.OBSERVATION_CARDINALITY_TARGET(), 192);
        _assertValue(
            keccak256("automation.minimumOracleActivation"),
            result.automation.MIN_ORACLE_ACTIVATION_NATIVE(),
            0.002 ether
        );
        _assertValue(keccak256("vault.minimumCompound"), implementation.MIN_COMPOUND_NATIVE(), 0.002 ether);
        _assertValue(keccak256("vault.maximumCompound"), implementation.MAX_COMPOUND_NATIVE(), 0.25 ether);
        _assertValue(keccak256("vault.compoundCooldown"), implementation.COMPOUND_COOLDOWN_SECONDS(), 5 minutes);
        _assertValue(keccak256("vault.rollingWindow"), implementation.ROLLING_EXPOSURE_WINDOW_SECONDS(), 30 minutes);
        _assertValue(keccak256("vault.rollingCapacity"), implementation.ROLLING_EXPOSURE_RECORD_CAPACITY(), 8);
        _assertValue(keccak256("vault.trustedDepthCap"), implementation.TRUSTED_DEPTH_CAP_BPS(), 25);
        _assertValue(keccak256("vault.minimumUtilization"), implementation.MIN_UTILIZATION_BPS(), 8500);
        _assertValue(
            keccak256("planner.poolTokenBudget"), result.positionPlanner.POOL_TOKEN_BUDGET(), 850_000_000 ether
        );

        _assertRuntimeSize(address(result.feeSplitVaultFactory));
        _assertRuntimeSize(address(result.hookFactory));
        _assertRuntimeSize(address(result.feeHook));
        _assertRuntimeSize(address(result.rangeSourceFactory));
        _assertRuntimeSize(address(result.growthVaultFactory));
        _assertRuntimeSize(result.growthVaultFactory.implementation());
        _assertRuntimeSize(address(result.launcher));
        _assertRuntimeSize(address(result.automation));
        _assertRuntimeSize(address(result.positionPlanner));
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
