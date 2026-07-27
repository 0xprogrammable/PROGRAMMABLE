// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { EthCreatorFeeHookFactoryV1 } from "../src/EthCreatorFeeHookFactoryV1.sol";
import { EthCreatorFeeHookV1 } from "../src/EthCreatorFeeHookV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { MemeLaunchV1 } from "../src/MemeLaunchV1.sol";

/// @title DeploySepoliaMemeInfrastructureV1
/// @notice Deploys the first public Classic stack after validating its official Uniswap dependencies.
/// @dev The script reuses Launcher’s verified permanent-position factory. It reads no private key and broadcasts only
///      through the explicitly configured Sepolia test wallet.
contract DeploySepoliaMemeInfrastructureV1 is Script {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11_155_111;

    address internal constant TEST_DEPLOYMENT_WALLET = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant LAUNCHER_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address internal constant LOCKED_POSITION_FACTORY = 0xaE3C324B742a7576863A546120c4280b7c9E8448;

    bytes32 internal constant POOL_MANAGER_CODEHASH =
        0x09930125a49f5b95caf8052991cc14d1240dca8b43f42b899115b86867e4bce1;
    bytes32 internal constant POSITION_MANAGER_CODEHASH =
        0xcffd746f78c2b50aafd19076bbe9c48f14446e5248fc5d76b9b4896610e51aab;
    bytes32 internal constant UERC20_FACTORY_CODEHASH =
        0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb;
    bytes32 internal constant LOCKED_POSITION_FACTORY_CODEHASH =
        0x49e040806b0664b2fa4f41c5abc11241cdb8f847c538c13d6874c32804b74ebc;

    error UnexpectedBroadcaster(address actual, address expected);
    error UnexpectedChain(uint256 actual, uint256 expected);
    error UnexpectedCodeHash(address target, bytes32 actual, bytes32 expected);

    function run()
        external
        returns (
            EthCreatorFeeHookFactoryV1 hookFactory,
            EthCreatorFeeHookV1 feeHook,
            MemeLaunchV1 memeLauncher,
            bytes32 hookSalt
        )
    {
        validateDependencies();

        address broadcaster = vm.envOr("LAUNCHER_TEST_DEPLOYER", TEST_DEPLOYMENT_WALLET);
        if (broadcaster != TEST_DEPLOYMENT_WALLET) {
            revert UnexpectedBroadcaster(broadcaster, TEST_DEPLOYMENT_WALLET);
        }

        vm.startBroadcast(broadcaster);
        hookFactory = new EthCreatorFeeHookFactoryV1();
        vm.stopBroadcast();

        (, hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV1).creationCode,
            abi.encode(IPoolManager(POOL_MANAGER), LAUNCHER_TREASURY)
        );

        vm.startBroadcast(broadcaster);
        feeHook = hookFactory.deploy(hookSalt, IPoolManager(POOL_MANAGER), LAUNCHER_TREASURY);
        memeLauncher = new MemeLaunchV1(
            IPoolManager(POOL_MANAGER),
            IPositionManager(POSITION_MANAGER),
            UERC20Factory(UERC20_FACTORY),
            feeHook,
            LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY)
        );
        vm.stopBroadcast();
    }

    /// @notice Read-only preflight that fails closed if the selected chain or runtime bytecode drifts.
    function validateDependencies() public view {
        if (block.chainid != SEPOLIA_CHAIN_ID) {
            revert UnexpectedChain(block.chainid, SEPOLIA_CHAIN_ID);
        }

        _assertCodeHash(POOL_MANAGER, POOL_MANAGER_CODEHASH);
        _assertCodeHash(POSITION_MANAGER, POSITION_MANAGER_CODEHASH);
        _assertCodeHash(UERC20_FACTORY, UERC20_FACTORY_CODEHASH);
        _assertCodeHash(LOCKED_POSITION_FACTORY, LOCKED_POSITION_FACTORY_CODEHASH);
    }

    function _assertCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert UnexpectedCodeHash(target, actual, expected);
    }
}
