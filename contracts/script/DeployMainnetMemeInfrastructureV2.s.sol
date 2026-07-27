// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { EthCreatorFeeHookFactoryV2 } from "../src/EthCreatorFeeHookFactoryV2.sol";
import { EthCreatorFeeHookV1 } from "../src/EthCreatorFeeHookV1.sol";
import { EthCreatorFeeHookV2 } from "../src/EthCreatorFeeHookV2.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { MemeLaunchV1 } from "../src/MemeLaunchV1.sol";

/// @title DeployMainnetMemeInfrastructureV2
/// @notice Fail-closed deployment script for the indexer-compatible Programmable Classic V2 stack on Ethereum.
/// @dev This script never reads a private key. Use a Foundry keystore and explicitly configure the sender,
///      reviewed starting nonce, and treasury. A normal run is simulation-only; `--broadcast` remains an explicit
///      operator action outside this contract. It reuses the verified V1 permanent-position factory.
contract DeployMainnetMemeInfrastructureV2 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;

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
        address hookFactory;
        address feeHook;
        address memeLauncher;
        bytes32 hookSalt;
        bytes32 sourceCommitment;
    }

    struct DeploymentResult {
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory;
        EthCreatorFeeHookFactoryV2 hookFactory;
        EthCreatorFeeHookV2 feeHook;
        MemeLaunchV1 memeLauncher;
        bytes32 hookSalt;
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

    /// @notice Simulates or broadcasts the reviewed three-transaction deployment sequence.
    /// @dev Required environment:
    ///      LAUNCHER_MAINNET_DEPLOYER, LAUNCHER_MAINNET_START_NONCE, LAUNCHER_MAINNET_TREASURY.
    function run() external returns (DeploymentResult memory result) {
        address broadcaster = vm.envAddress("LAUNCHER_MAINNET_DEPLOYER");
        address configuredTreasury = vm.envAddress("LAUNCHER_MAINNET_TREASURY");
        uint256 configuredNonce = vm.envUint("LAUNCHER_MAINNET_START_NONCE");
        if (configuredNonce > type(uint64).max) {
            revert UnexpectedValue(keccak256("startingNonce"), configuredNonce, type(uint64).max);
        }

        // The explicit bound above makes this narrowing conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        return deployReviewed(broadcaster, uint64(configuredNonce), configuredTreasury);
    }

    /// @notice Explicit-argument entrypoint used by fork tests and reviewed simulations.
    /// @dev It has exactly the same fail-closed checks as `run`; no call broadcasts unless Forge receives
    ///      the separate `--broadcast` flag.
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
        _assertVacant(plan.hookFactory);
        _assertVacant(plan.feeHook);
        _assertVacant(plan.memeLauncher);

        vm.startBroadcast(broadcaster);
        result.hookFactory = new EthCreatorFeeHookFactoryV2();
        vm.stopBroadcast();

        result.positionForwarderFactory = LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY);
        _assertAddress(keccak256("hookFactory"), address(result.hookFactory), plan.hookFactory);

        vm.startBroadcast(broadcaster);
        result.feeHook = result.hookFactory.deploy(plan.hookSalt, IPoolManager(POOL_MANAGER), configuredTreasury);
        result.memeLauncher = new MemeLaunchV1(
            IPoolManager(POOL_MANAGER),
            IPositionManager(POSITION_MANAGER),
            UERC20Factory(UERC20_FACTORY),
            EthCreatorFeeHookV1(address(result.feeHook)),
            result.positionForwarderFactory
        );
        vm.stopBroadcast();

        _assertAddress(keccak256("feeHook"), address(result.feeHook), plan.feeHook);
        _assertAddress(keccak256("memeLauncher"), address(result.memeLauncher), plan.memeLauncher);

        result.hookSalt = plan.hookSalt;
        result.sourceCommitment = plan.sourceCommitment;
        result.startingNonce = startingNonce;
        _validateDeployedStack(result);

        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 3) {
            revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 3);
        }
    }

    /// @notice Computes every reviewed deployment address before a transaction is signed.
    function deploymentPlan(address broadcaster, uint64 startingNonce)
        public
        view
        returns (DeploymentPlan memory plan)
    {
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);

        plan.broadcaster = broadcaster;
        plan.startingNonce = startingNonce;
        plan.hookFactory = vm.computeCreateAddress(broadcaster, startingNonce);
        (plan.feeHook, plan.hookSalt) = HookMiner.find(
            plan.hookFactory,
            REQUIRED_HOOK_FLAGS,
            type(EthCreatorFeeHookV2).creationCode,
            abi.encode(IPoolManager(POOL_MANAGER), LAUNCHER_TREASURY)
        );
        plan.memeLauncher = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 2);
        plan.sourceCommitment = deploymentSourceCommitment();
    }

    /// @notice Read-only preflight over every official Mainnet dependency used by deployment or lifecycle testing.
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

    /// @notice Commitment to the exact compiled creation code, official dependencies, economics, and treasury.
    /// @dev Record this value with any reviewed simulation. It is not a source-code audit or an explorer verification.
    function deploymentSourceCommitment() public pure returns (bytes32) {
        bytes32 bytecodeCommitment = keccak256(
            abi.encode(
                keccak256(type(EthCreatorFeeHookFactoryV2).creationCode),
                keccak256(type(EthCreatorFeeHookV2).creationCode),
                keccak256(type(MemeLaunchV1).creationCode)
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
                uint256(1_000_000_000 ether),
                keccak256("creator-selected-atomic-dev-buy-at-or-above-minimum"),
                uint256(0.0006 ether),
                keccak256("openzeppelin-hook-fee-event"),
                keccak256("urc-2-hook-swap-proposal"),
                keccak256("zero-erc20-transfer-tax")
            )
        );
        return keccak256(
            abi.encode(
                keccak256("programmable.meme.infrastructure.v2.ethereum"),
                bytecodeCommitment,
                dependencyCommitment,
                economicsCommitment
            )
        );
    }

    function _validateDeployedStack(DeploymentResult memory result) private view {
        _assertAddress(
            keccak256("positionForwarderFactory"), address(result.positionForwarderFactory), LOCKED_POSITION_FACTORY
        );
        _assertAddress(
            keccak256("forwarderFactory.positionManager"),
            address(result.positionForwarderFactory.positionManager()),
            POSITION_MANAGER
        );
        _assertAddress(keccak256("forwarderFactory.operator"), result.positionForwarderFactory.OPERATOR(), address(0));
        _assertValue(
            keccak256("forwarderFactory.timelock"), result.positionForwarderFactory.TIMELOCK_BLOCK(), type(uint256).max
        );

        _assertAddress(keccak256("feeHook.poolManager"), address(result.feeHook.poolManager()), POOL_MANAGER);
        _assertAddress(
            keccak256("feeHook.launcherFeeRecipient"), result.feeHook.launcherFeeRecipient(), LAUNCHER_TREASURY
        );
        uint160 actualFlags = uint160(address(result.feeHook)) & result.hookFactory.ALL_HOOK_MASK();
        uint160 expectedFlags = result.hookFactory.REQUIRED_HOOK_FLAGS();
        if (actualFlags != expectedFlags) revert UnexpectedHookFlags(actualFlags, expectedFlags);
        if (!result.hookFactory.isFactoryHook(address(result.feeHook))) {
            revert UnexpectedAddress(keccak256("hookFactory.provenance"), address(0), address(result.feeHook));
        }

        _assertAddress(keccak256("memeLauncher.poolManager"), address(result.memeLauncher.poolManager()), POOL_MANAGER);
        _assertAddress(
            keccak256("memeLauncher.positionManager"), address(result.memeLauncher.positionManager()), POSITION_MANAGER
        );
        _assertAddress(
            keccak256("memeLauncher.tokenFactory"), address(result.memeLauncher.tokenFactory()), UERC20_FACTORY
        );
        _assertAddress(
            keccak256("memeLauncher.feeHook"), address(result.memeLauncher.feeHook()), address(result.feeHook)
        );
        _assertAddress(
            keccak256("memeLauncher.positionForwarderFactory"),
            address(result.memeLauncher.positionForwarderFactory()),
            address(result.positionForwarderFactory)
        );
        _assertValue(keccak256("memeLauncher.lpFeePips"), result.memeLauncher.LP_FEE_PIPS(), 0);
        _assertValue(keccak256("memeLauncher.tickSpacing"), uint24(result.memeLauncher.TICK_SPACING()), 200);
        _assertValue(
            keccak256("memeLauncher.minimumInitialBuyWei"), result.memeLauncher.MIN_INITIAL_BUY_WEI(), 0.0006 ether
        );
        _assertValue(keccak256("feeHook.launcherFeeBps"), result.feeHook.LAUNCHER_FEE_BPS(), 10);
        _assertValue(keccak256("feeHook.transferTaxBps"), result.feeHook.TRANSFER_TAX_BPS(), 0);
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
