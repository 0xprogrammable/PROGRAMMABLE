// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProtocolRevenueExecutionEnforcerV1 } from "../src/ProtocolRevenueExecutionEnforcerV1.sol";
import {
    IProtocolRevenueExecutionEnforcerTargetV1,
    ProtocolRevenueMetaMaskExecutorV1
} from "../src/ProtocolRevenueMetaMaskExecutorV1.sol";
import { ProtocolRevenueRouterV1 } from "../src/ProtocolRevenueRouterV1.sol";
import { IProtocolRevenueRouterTargetV1 } from "../src/interfaces/IProtocolRevenueMetaMaskV1.sol";

/// @title DeployMainnetProtocolRevenueV1
/// @notice Fail-closed three-transaction deployment for Programmable's immutable daily revenue policy.
/// @dev This script never reads a private key. A normal run is simulation only; broadcasting still requires Forge's
///      separate `--broadcast` flag. Deployment does not configure the signed MetaMask permission or activate Vercel.
contract DeployMainnetProtocolRevenueV1 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant EIP170_RUNTIME_LIMIT = 24_576;

    address public constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant TREASURY = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address public constant V4_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
    address public constant METAMASK_DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    bytes32 public constant MAIN_POOL_ID = 0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0;

    struct DeploymentPlan {
        address broadcaster;
        uint64 startingNonce;
        address router;
        address enforcer;
        address executor;
        address keeper;
        bytes32 sourceCommitment;
    }

    struct DeploymentResult {
        ProtocolRevenueRouterV1 router;
        ProtocolRevenueExecutionEnforcerV1 enforcer;
        ProtocolRevenueMetaMaskExecutorV1 executor;
        uint64 startingNonce;
        bytes32 sourceCommitment;
        bytes32 routerRuntimeCodeHash;
        bytes32 enforcerRuntimeCodeHash;
        bytes32 executorRuntimeCodeHash;
    }

    error DeploymentAddressOccupied(address target);
    error InvalidBroadcaster(address broadcaster);
    error InvalidKeeper(address keeper);
    error UnexpectedAddress(bytes32 field, address actual, address expected);
    error UnexpectedChain(uint256 actual, uint256 expected);
    error UnexpectedCodeSize(address target, uint256 actual, uint256 maximum);
    error UnexpectedNonce(address broadcaster, uint64 actual, uint64 expected);
    error UnexpectedValue(bytes32 field, bytes32 actual, bytes32 expected);

    function run() external returns (DeploymentResult memory result) {
        address broadcaster = vm.envAddress("PROTOCOL_REVENUE_MAINNET_DEPLOYER");
        address keeper = vm.envAddress("PROTOCOL_REVENUE_KEEPER_ADDRESS");
        uint256 configuredNonce = vm.envUint("PROTOCOL_REVENUE_MAINNET_START_NONCE");
        if (configuredNonce > type(uint64).max - 3) {
            revert UnexpectedNonce(broadcaster, type(uint64).max, type(uint64).max - 3);
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        return deployReviewed(broadcaster, uint64(configuredNonce), keeper);
    }

    function deployReviewed(address broadcaster, uint64 startingNonce, address keeper)
        public
        returns (DeploymentResult memory result)
    {
        if (block.chainid != MAINNET_CHAIN_ID) revert UnexpectedChain(block.chainid, MAINNET_CHAIN_ID);
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        if (keeper == address(0) || keeper == REVENUE_AUTHORITY || keeper == TREASURY) revert InvalidKeeper(keeper);
        if (startingNonce > type(uint64).max - 3) {
            revert UnexpectedNonce(broadcaster, startingNonce, type(uint64).max - 3);
        }
        uint64 actualNonce = vm.getNonce(broadcaster);
        if (actualNonce != startingNonce) revert UnexpectedNonce(broadcaster, actualNonce, startingNonce);

        DeploymentPlan memory plan = deploymentPlan(broadcaster, startingNonce, keeper);
        _assertVacant(plan.router);
        _assertVacant(plan.enforcer);
        _assertVacant(plan.executor);

        vm.startBroadcast(broadcaster);
        result.router = new ProtocolRevenueRouterV1(keeper);
        result.enforcer = new ProtocolRevenueExecutionEnforcerV1(IProtocolRevenueRouterTargetV1(address(result.router)));
        result.executor = new ProtocolRevenueMetaMaskExecutorV1(
            IProtocolRevenueRouterTargetV1(address(result.router)),
            IProtocolRevenueExecutionEnforcerTargetV1(address(result.enforcer)),
            keeper
        );
        vm.stopBroadcast();

        _assertAddress(keccak256("router"), address(result.router), plan.router);
        _assertAddress(keccak256("enforcer"), address(result.enforcer), plan.enforcer);
        _assertAddress(keccak256("executor"), address(result.executor), plan.executor);
        _validateConfiguration(result, keeper);

        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 3) revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 3);

        result.startingNonce = startingNonce;
        result.sourceCommitment = plan.sourceCommitment;
        result.routerRuntimeCodeHash = address(result.router).codehash;
        result.enforcerRuntimeCodeHash = address(result.enforcer).codehash;
        result.executorRuntimeCodeHash = address(result.executor).codehash;
    }

    function deploymentPlan(address broadcaster, uint64 startingNonce, address keeper)
        public
        pure
        returns (DeploymentPlan memory plan)
    {
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        if (keeper == address(0) || keeper == REVENUE_AUTHORITY || keeper == TREASURY) revert InvalidKeeper(keeper);
        plan = DeploymentPlan({
            broadcaster: broadcaster,
            startingNonce: startingNonce,
            router: vm.computeCreateAddress(broadcaster, startingNonce),
            enforcer: vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1),
            executor: vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 2),
            keeper: keeper,
            sourceCommitment: deploymentSourceCommitment(keeper)
        });
    }

    function deploymentSourceCommitment(address keeper) public pure returns (bytes32) {
        if (keeper == address(0) || keeper == REVENUE_AUTHORITY || keeper == TREASURY) revert InvalidKeeper(keeper);
        bytes32 policyCommitment = keccak256(
            abi.encode(
                uint16(5000),
                uint16(4950),
                uint16(50),
                uint64(1 days),
                uint256(0.1 ether),
                uint256(32),
                int24(100),
                int24(500)
            )
        );
        bytes32 automationCommitment = keccak256(abi.encode(METAMASK_DELEGATION_MANAGER, keeper, uint64(30 minutes)));
        return keccak256(
            abi.encode(
                keccak256(type(ProtocolRevenueRouterV1).creationCode),
                keccak256(type(ProtocolRevenueExecutionEnforcerV1).creationCode),
                keccak256(type(ProtocolRevenueMetaMaskExecutorV1).creationCode),
                REVENUE_AUTHORITY,
                TREASURY,
                V4_TOKEN,
                MAIN_POOL_ID,
                policyCommitment,
                automationCommitment
            )
        );
    }

    function _validateConfiguration(DeploymentResult memory result, address expectedKeeper) private view {
        if (result.router.REVENUE_AUTHORITY() != REVENUE_AUTHORITY) {
            revert UnexpectedAddress(
                keccak256("revenueAuthority"), result.router.REVENUE_AUTHORITY(), REVENUE_AUTHORITY
            );
        }
        if (result.router.TREASURY() != TREASURY) {
            revert UnexpectedAddress(keccak256("treasury"), result.router.TREASURY(), TREASURY);
        }
        if (result.router.V4_TOKEN() != V4_TOKEN) {
            revert UnexpectedAddress(keccak256("v4Token"), result.router.V4_TOKEN(), V4_TOKEN);
        }
        if (result.router.MAIN_POOL_ID() != MAIN_POOL_ID) {
            revert UnexpectedValue(keccak256("mainPoolId"), result.router.MAIN_POOL_ID(), MAIN_POOL_ID);
        }
        if (result.router.keeper() != expectedKeeper) {
            revert UnexpectedAddress(keccak256("routerKeeper"), result.router.keeper(), expectedKeeper);
        }
        if (address(result.enforcer.router()) != address(result.router)) {
            revert UnexpectedAddress(
                keccak256("enforcerRouter"), address(result.enforcer.router()), address(result.router)
            );
        }
        if (address(result.executor.router()) != address(result.router)) {
            revert UnexpectedAddress(
                keccak256("executorRouter"), address(result.executor.router()), address(result.router)
            );
        }
        if (address(result.executor.enforcer()) != address(result.enforcer)) {
            revert UnexpectedAddress(
                keccak256("executorEnforcer"), address(result.executor.enforcer()), address(result.enforcer)
            );
        }
        if (result.executor.keeper() != expectedKeeper) {
            revert UnexpectedAddress(keccak256("keeper"), result.executor.keeper(), expectedKeeper);
        }
        _assertSize(address(result.router));
        _assertSize(address(result.enforcer));
        _assertSize(address(result.executor));
    }

    function _assertVacant(address target) private view {
        if (target.code.length != 0) revert DeploymentAddressOccupied(target);
    }

    function _assertSize(address target) private view {
        uint256 size = target.code.length;
        if (size > EIP170_RUNTIME_LIMIT) revert UnexpectedCodeSize(target, size, EIP170_RUNTIME_LIMIT);
    }

    function _assertAddress(bytes32 field, address actual, address expected) private pure {
        if (actual != expected) revert UnexpectedAddress(field, actual, expected);
    }
}
