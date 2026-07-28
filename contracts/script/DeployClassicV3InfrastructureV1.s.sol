// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { EthCreatorFeeHookFactoryV3 } from "../src/EthCreatorFeeHookFactoryV3.sol";
import { EthCreatorFeeHookV3 } from "../src/EthCreatorFeeHookV3.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { MemeLaunchV2 } from "../src/MemeLaunchV2.sol";

/// @title DeployClassicV3InfrastructureV1
/// @notice Deterministic, fail-closed deployment path for the configurable Classic stack.
/// @dev Supports Ethereum Mainnet and Sepolia. It never reads a private key and does not broadcast unless Forge
/// receives an explicit `--broadcast` flag. The reviewed sequence is exactly four transactions.
contract DeployClassicV3InfrastructureV1 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant SEPOLIA_CHAIN_ID = 11_155_111;
    uint256 internal constant MAX_LAUNCHER_RUNTIME_BYTES = 23_000;

    address public constant LAUNCHER_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    struct Dependencies {
        address poolManager;
        address positionManager;
        address stateView;
        address v4Quoter;
        address uerc20Factory;
        address permit2;
        address universalRouter;
        address positionForwarderFactory;
        bytes32 poolManagerCodeHash;
        bytes32 positionManagerCodeHash;
        bytes32 stateViewCodeHash;
        bytes32 v4QuoterCodeHash;
        bytes32 uerc20FactoryCodeHash;
        bytes32 permit2CodeHash;
        bytes32 universalRouterCodeHash;
        bytes32 positionForwarderFactoryCodeHash;
    }

    struct DeploymentPlan {
        uint256 chainId;
        address broadcaster;
        uint64 startingNonce;
        address feeSplitVaultFactory;
        address hookFactory;
        address feeHook;
        address launcher;
        bytes32 hookSalt;
        bytes32 sourceCommitment;
    }

    struct DeploymentResult {
        FeeSplitVaultFactoryV1 feeSplitVaultFactory;
        EthCreatorFeeHookFactoryV3 hookFactory;
        EthCreatorFeeHookV3 feeHook;
        MemeLaunchV2 launcher;
        bytes32 hookSalt;
        bytes32 sourceCommitment;
        uint64 startingNonce;
    }

    error DeploymentAddressOccupied(address target);
    error InvalidBroadcaster(address broadcaster);
    error UnexpectedAddress(bytes32 field, address actual, address expected);
    error UnexpectedChain(uint256 actual);
    error UnexpectedCodeHash(address target, bytes32 actual, bytes32 expected);
    error UnexpectedHookFlags(uint160 actual, uint160 expected);
    error UnexpectedNonce(address broadcaster, uint64 actual, uint64 expected);
    error UnexpectedTreasury(address actual, address expected);
    error UnexpectedValue(bytes32 field, uint256 actual, uint256 expected);

    /// @notice Simulates or broadcasts the reviewed four-transaction sequence.
    /// @dev Required environment: CLASSIC_V3_DEPLOYER, CLASSIC_V3_START_NONCE and CLASSIC_V3_TREASURY.
    function run() external returns (DeploymentResult memory result) {
        address broadcaster = vm.envAddress("CLASSIC_V3_DEPLOYER");
        address configuredTreasury = vm.envAddress("CLASSIC_V3_TREASURY");
        uint256 configuredNonce = vm.envUint("CLASSIC_V3_START_NONCE");
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
        Dependencies memory dependencies = validateOfficialDependencies();
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        if (configuredTreasury != LAUNCHER_TREASURY) {
            revert UnexpectedTreasury(configuredTreasury, LAUNCHER_TREASURY);
        }

        uint64 actualNonce = vm.getNonce(broadcaster);
        if (actualNonce != startingNonce) revert UnexpectedNonce(broadcaster, actualNonce, startingNonce);

        DeploymentPlan memory plan = deploymentPlan(broadcaster, startingNonce);
        _assertVacant(plan.feeSplitVaultFactory);
        _assertVacant(plan.hookFactory);
        _assertVacant(plan.feeHook);
        _assertVacant(plan.launcher);

        vm.startBroadcast(broadcaster);
        result.feeSplitVaultFactory = new FeeSplitVaultFactoryV1();
        result.hookFactory = new EthCreatorFeeHookFactoryV3();
        result.feeHook = result.hookFactory
            .deploy(
                plan.hookSalt, IPoolManager(dependencies.poolManager), configuredTreasury, result.feeSplitVaultFactory
            );
        result.launcher = new MemeLaunchV2(
            IPoolManager(dependencies.poolManager),
            IPositionManager(dependencies.positionManager),
            UERC20Factory(dependencies.uerc20Factory),
            result.feeHook,
            result.feeSplitVaultFactory,
            LockedPositionFeeForwarderFactoryV1(dependencies.positionForwarderFactory)
        );
        vm.stopBroadcast();

        _assertAddress(
            keccak256("feeSplitVaultFactory"), address(result.feeSplitVaultFactory), plan.feeSplitVaultFactory
        );
        _assertAddress(keccak256("hookFactory"), address(result.hookFactory), plan.hookFactory);
        _assertAddress(keccak256("feeHook"), address(result.feeHook), plan.feeHook);
        _assertAddress(keccak256("launcher"), address(result.launcher), plan.launcher);

        result.hookSalt = plan.hookSalt;
        result.sourceCommitment = plan.sourceCommitment;
        result.startingNonce = startingNonce;
        _validateDeployedStack(result, dependencies);

        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 4) {
            revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 4);
        }
    }

    function deploymentPlan(address broadcaster, uint64 startingNonce)
        public
        view
        returns (DeploymentPlan memory plan)
    {
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        Dependencies memory dependencies = _dependencies();

        plan.chainId = block.chainid;
        plan.broadcaster = broadcaster;
        plan.startingNonce = startingNonce;
        plan.feeSplitVaultFactory = vm.computeCreateAddress(broadcaster, startingNonce);
        plan.hookFactory = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1);
        (plan.feeHook, plan.hookSalt) = HookMiner.find(
            plan.hookFactory,
            REQUIRED_HOOK_FLAGS,
            type(EthCreatorFeeHookV3).creationCode,
            abi.encode(
                IPoolManager(dependencies.poolManager),
                LAUNCHER_TREASURY,
                FeeSplitVaultFactoryV1(plan.feeSplitVaultFactory)
            )
        );
        plan.launcher = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 3);
        plan.sourceCommitment = deploymentSourceCommitment();
    }

    function predictHook(address hookFactory, address feeSplitVaultFactory, bytes32 hookSalt)
        public
        view
        returns (address)
    {
        Dependencies memory dependencies = _dependencies();
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(EthCreatorFeeHookV3).creationCode,
                abi.encode(
                    IPoolManager(dependencies.poolManager),
                    LAUNCHER_TREASURY,
                    FeeSplitVaultFactoryV1(feeSplitVaultFactory)
                )
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), hookFactory, hookSalt, initCodeHash)))));
    }

    /// @notice Checks every official dependency needed for deployment and the signed launch lifecycle.
    function validateOfficialDependencies() public view returns (Dependencies memory dependencies) {
        dependencies = _dependencies();
        _assertCodeHash(dependencies.poolManager, dependencies.poolManagerCodeHash);
        _assertCodeHash(dependencies.positionManager, dependencies.positionManagerCodeHash);
        _assertCodeHash(dependencies.stateView, dependencies.stateViewCodeHash);
        _assertCodeHash(dependencies.v4Quoter, dependencies.v4QuoterCodeHash);
        _assertCodeHash(dependencies.uerc20Factory, dependencies.uerc20FactoryCodeHash);
        _assertCodeHash(dependencies.permit2, dependencies.permit2CodeHash);
        _assertCodeHash(dependencies.universalRouter, dependencies.universalRouterCodeHash);
        _assertCodeHash(dependencies.positionForwarderFactory, dependencies.positionForwarderFactoryCodeHash);
    }

    function deploymentSourceCommitment() public view returns (bytes32) {
        Dependencies memory dependencies = _dependencies();
        bytes32 bytecodeCommitment = keccak256(
            abi.encode(
                keccak256(type(FeeSplitVaultFactoryV1).creationCode),
                keccak256(type(EthCreatorFeeHookFactoryV3).creationCode),
                keccak256(type(EthCreatorFeeHookV3).creationCode),
                keccak256(type(MemeLaunchV2).creationCode)
            )
        );
        bytes32 dependencyCommitment = keccak256(
            abi.encode(
                block.chainid,
                dependencies.poolManager,
                dependencies.positionManager,
                dependencies.stateView,
                dependencies.v4Quoter,
                dependencies.uerc20Factory,
                dependencies.permit2,
                dependencies.universalRouter,
                dependencies.positionForwarderFactory,
                LAUNCHER_TREASURY
            )
        );
        bytes32 economicsCommitment = keccak256(
            abi.encode(
                uint256(10),
                uint256(100),
                uint256(1000),
                uint256(100),
                uint256(0),
                int256(200),
                uint256(0.0006 ether),
                uint256(1_000_000_000 ether),
                uint256(8),
                uint256(10_000),
                keccak256("immutable-directional-buy-and-sell-fees"),
                keccak256("immutable-beneficiaries-and-shares"),
                keccak256("beneficiary-authorized-claim-and-payout-update"),
                keccak256("one-sided-permanently-locked-official-v4-position")
            )
        );
        return keccak256(
            abi.encode(
                keccak256("programmable.classic.infrastructure.v3.ethereum"),
                bytecodeCommitment,
                dependencyCommitment,
                economicsCommitment
            )
        );
    }

    function _validateDeployedStack(DeploymentResult memory result, Dependencies memory dependencies) private view {
        _assertCodeHash(address(result.feeSplitVaultFactory), keccak256(type(FeeSplitVaultFactoryV1).runtimeCode));
        _assertCodeHash(address(result.hookFactory), keccak256(type(EthCreatorFeeHookFactoryV3).runtimeCode));
        if (address(result.launcher).code.length > MAX_LAUNCHER_RUNTIME_BYTES) {
            revert UnexpectedValue(
                keccak256("launcher.runtimeBytes"), address(result.launcher).code.length, MAX_LAUNCHER_RUNTIME_BYTES
            );
        }

        _assertAddress(keccak256("hook.poolManager"), address(result.feeHook.poolManager()), dependencies.poolManager);
        _assertAddress(keccak256("hook.launcherFeeRecipient"), result.feeHook.launcherFeeRecipient(), LAUNCHER_TREASURY);
        _assertAddress(
            keccak256("hook.feeSplitVaultFactory"),
            address(result.feeHook.feeSplitVaultFactory()),
            address(result.feeSplitVaultFactory)
        );
        uint160 actualFlags = uint160(address(result.feeHook)) & result.hookFactory.ALL_HOOK_MASK();
        if (actualFlags != REQUIRED_HOOK_FLAGS) revert UnexpectedHookFlags(actualFlags, REQUIRED_HOOK_FLAGS);
        if (!result.hookFactory.isFactoryHook(address(result.feeHook))) {
            revert UnexpectedAddress(keccak256("hookFactory.provenance"), address(0), address(result.feeHook));
        }

        _assertAddress(
            keccak256("launcher.poolManager"), address(result.launcher.poolManager()), dependencies.poolManager
        );
        _assertAddress(
            keccak256("launcher.positionManager"),
            address(result.launcher.positionManager()),
            dependencies.positionManager
        );
        _assertAddress(
            keccak256("launcher.tokenFactory"), address(result.launcher.tokenFactory()), dependencies.uerc20Factory
        );
        _assertAddress(keccak256("launcher.feeHook"), address(result.launcher.feeHook()), address(result.feeHook));
        _assertAddress(
            keccak256("launcher.feeSplitVaultFactory"),
            address(result.launcher.feeSplitVaultFactory()),
            address(result.feeSplitVaultFactory)
        );
        _assertAddress(
            keccak256("launcher.positionForwarderFactory"),
            address(result.launcher.positionForwarderFactory()),
            dependencies.positionForwarderFactory
        );
        _assertValue(keccak256("hook.launcherFeeBps"), result.feeHook.LAUNCHER_FEE_BPS(), 10);
        _assertValue(keccak256("hook.minimumFeeBps"), result.feeHook.MIN_TOTAL_SWAP_FEE_BPS(), 100);
        _assertValue(keccak256("hook.maximumFeeBps"), result.feeHook.MAX_TOTAL_SWAP_FEE_BPS(), 1000);
        _assertValue(keccak256("hook.feeStepBps"), result.feeHook.TOTAL_SWAP_FEE_STEP_BPS(), 100);
        _assertValue(keccak256("hook.transferTaxBps"), result.feeHook.TRANSFER_TAX_BPS(), 0);
        _assertValue(keccak256("hook.lpFeePips"), result.feeHook.LP_FEE_PIPS(), 0);
        _assertValue(keccak256("hook.tickSpacing"), uint24(result.feeHook.TICK_SPACING()), 200);
        _assertValue(keccak256("launcher.minimumInitialBuyWei"), result.launcher.MIN_INITIAL_BUY_WEI(), 0.0006 ether);
    }

    function _dependencies() private view returns (Dependencies memory dependencies) {
        if (block.chainid == MAINNET_CHAIN_ID) {
            return Dependencies({
                poolManager: 0x000000000004444c5dc75cB358380D2e3dE08A90,
                positionManager: 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e,
                stateView: 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227,
                v4Quoter: 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203,
                uerc20Factory: 0x000000e200088D55C39a11F609E5F667729ad49b,
                permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3,
                universalRouter: 0xd92A36B0000531EF3063dEd4De20A0783308446C,
                positionForwarderFactory: 0x291a9ff1059d225d02B1659430804486404dB507,
                poolManagerCodeHash: 0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293,
                positionManagerCodeHash: 0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b,
                stateViewCodeHash: 0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878,
                v4QuoterCodeHash: 0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441,
                uerc20FactoryCodeHash: 0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb,
                permit2CodeHash: 0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131,
                universalRouterCodeHash: 0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49,
                positionForwarderFactoryCodeHash: 0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2
            });
        }
        if (block.chainid == SEPOLIA_CHAIN_ID) {
            return Dependencies({
                poolManager: 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543,
                positionManager: 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4,
                stateView: 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C,
                v4Quoter: 0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227,
                uerc20Factory: 0x000000e200088D55C39a11F609E5F667729ad49b,
                permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3,
                universalRouter: 0x470FFC67b1feEEC31D16C46AC7545C98716a194c,
                positionForwarderFactory: 0xaE3C324B742a7576863A546120c4280b7c9E8448,
                poolManagerCodeHash: 0x09930125a49f5b95caf8052991cc14d1240dca8b43f42b899115b86867e4bce1,
                positionManagerCodeHash: 0xcffd746f78c2b50aafd19076bbe9c48f14446e5248fc5d76b9b4896610e51aab,
                stateViewCodeHash: 0xaaed3db8eb8ebde8014ce4c8a3938496687f4c6374e17a7d735288f6c65ceb9e,
                v4QuoterCodeHash: 0xf481a751ac453d40c46d12360b85b05472028c1b113ab63749d69a5f8b0e47d1,
                uerc20FactoryCodeHash: 0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb,
                permit2CodeHash: 0x96d9f5c3f0fb0423426b7f970186235b7347027f4e5c19c40c412b7d97fc3751,
                universalRouterCodeHash: 0x14b733fce7cfcca643ef884ed59d2cb2d23b3fead8692613dcee311d65555caf,
                positionForwarderFactoryCodeHash: 0x49e040806b0664b2fa4f41c5abc11241cdb8f847c538c13d6874c32804b74ebc
            });
        }
        revert UnexpectedChain(block.chainid);
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
