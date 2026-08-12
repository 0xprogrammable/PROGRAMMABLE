// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, Vm } from "forge-std/Test.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import { ProgrammableExactShardsAtomicLaunchRouteV1 } from "../src/ProgrammableExactShardsAtomicLaunchRouteV1.sol";
import { ProgrammableExactShardsFeePolicyVerifierV2 } from "../src/ProgrammableExactShardsFeePolicyVerifierV2.sol";
import {
    ProgrammableExactShardsPairDeploymentCoordinatorV1
} from "../src/ProgrammableExactShardsPairDeploymentCoordinatorV1.sol";
import { ProgrammableExactShardsRegistryV1 } from "../src/ProgrammableExactShardsRegistryV1.sol";
import { ProgrammableExactShardsRouteGatedFactoryV2 } from "../src/ProgrammableExactShardsRouteGatedFactoryV2.sol";
import { ProgrammableLaunchPermitAuthorityV1 } from "../src/ProgrammableLaunchPermitAuthorityV1.sol";
import { ProgrammableLaunchPermitVerifierV1 } from "../src/ProgrammableLaunchPermitVerifierV1.sol";
import { IProgrammableExactShardsRegistryV1 } from "../src/interfaces/IProgrammableExactShardsRegistryV1.sol";
import { IProgrammableLaunchPermitAuthorityV1 } from "../src/interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import { ShardHookV1 } from "shards-v1/src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "shards-v1/src/ShardLaunchFactoryV1.sol";

contract ExactShardsWrongRegistryAuthorityV1 {
    address public immutable LAUNCH_PERMIT_AUTHORITY;

    constructor(address authority) {
        LAUNCH_PERMIT_AUTHORITY = authority;
    }
}

contract ExactShardsForeignCoordinatorCallerV1 {
    function attempt(
        IProgrammableLaunchPermitAuthorityV1 authority,
        IProgrammableExactShardsRegistryV1 registry,
        address implementation,
        bytes32 runtimeCodeHash
    ) external {
        new ProgrammableExactShardsPairDeploymentCoordinatorV1(authority, registry, implementation, runtimeCodeHash);
    }
}

contract ProgrammableExactShardsTwoTransactionDeploymentV1Test is Test {
    uint256 private constant SIGNER_KEY = 0xA11CE;
    address private constant SIGNER_GOVERNOR = address(0x1001);
    address private constant RELEASE_GOVERNOR = address(0x1002);
    address private constant PAUSER = address(0x1003);
    address private constant CANCELLER = address(0x1004);
    address private constant APPROVER = address(0x2001);
    address private constant INTENT_APPROVER = address(0x2005);
    address private constant FINALIZER = address(0x2002);
    address private constant REVOKER = address(0x2004);

    ProgrammableLaunchPermitAuthorityV1 private authority;
    ProgrammableExactShardsFeePolicyVerifierV2 private feeVerifier;
    ShardLaunchFactoryV1 private implementation;

    function setUp() public {
        vm.chainId(1);
        ProgrammableLaunchPermitVerifierV1 permitVerifier = new ProgrammableLaunchPermitVerifierV1();
        authority = new ProgrammableLaunchPermitAuthorityV1(
            1,
            address(this),
            SIGNER_GOVERNOR,
            RELEASE_GOVERNOR,
            PAUSER,
            CANCELLER,
            vm.addr(SIGNER_KEY),
            900,
            permitVerifier,
            address(permitVerifier).codehash
        );
        feeVerifier = new ProgrammableExactShardsFeePolicyVerifierV2();
        IPoolManager manager = IPoolManager(address(new PoolManager(address(this))));
        implementation = new ShardLaunchFactoryV1(manager, keccak256(type(ShardHookV1).creationCode));
    }

    function test_exactTwoTransactionRegistryThenPairCeremonyIsDeterministicAndOneShot() public {
        ExactShardsForeignCoordinatorCallerV1 attacker = new ExactShardsForeignCoordinatorCallerV1();
        uint64 registryDeploymentNonce = vm.getNonce(address(this));
        address predictedRegistry = vm.computeCreateAddress(address(this), registryDeploymentNonce);
        address predictedCoordinator = vm.computeCreateAddress(address(this), registryDeploymentNonce + 1);
        address predictedRoute = vm.computeCreateAddress(predictedCoordinator, 2);

        ProgrammableExactShardsRegistryV1 registry = _deployRegistry(predictedRoute);
        assertEq(address(registry), predictedRegistry);
        assertEq(registry.LAUNCH_ROUTE(), predictedRoute);
        assertTrue(registry.hasRole(registry.WRITER_ROLE(), predictedRoute));
        assertEq(vm.getNonce(address(this)), registryDeploymentNonce + 1);

        vm.expectPartialRevert(ProgrammableExactShardsPairDeploymentCoordinatorV1.InvalidCoordinatorBinding.selector);
        attacker.attempt(authority, registry, address(implementation), address(implementation).codehash);
        assertEq(predictedRoute.code.length, 0);
        assertEq(vm.getNonce(address(this)), registryDeploymentNonce + 1);

        vm.recordLogs();
        ProgrammableExactShardsPairDeploymentCoordinatorV1 coordinator = new ProgrammableExactShardsPairDeploymentCoordinatorV1(
            authority, registry, address(implementation), address(implementation).codehash
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(address(coordinator), predictedCoordinator);
        (address predictedFactory, address readbackRoute) = coordinator.predictedPair();
        assertEq(readbackRoute, predictedRoute);
        assertEq(coordinator.route(), predictedRoute);
        assertEq(coordinator.factory(), predictedFactory);

        ProgrammableExactShardsRouteGatedFactoryV2 factory =
            ProgrammableExactShardsRouteGatedFactoryV2(payable(predictedFactory));
        ProgrammableExactShardsAtomicLaunchRouteV1 route = ProgrammableExactShardsAtomicLaunchRouteV1(predictedRoute);
        assertEq(factory.AUTHORIZED_ROUTE(), predictedRoute);
        assertEq(factory.IMPLEMENTATION(), address(implementation));
        assertEq(factory.IMPLEMENTATION_RUNTIME_CODE_HASH(), address(implementation).codehash);
        assertEq(address(route.PERMIT_AUTHORITY()), address(authority));
        assertEq(address(route.REGISTRY()), address(registry));
        assertEq(address(route.FACTORY()), predictedFactory);
        assertEq(route.FACTORY_RUNTIME_CODE_HASH(), predictedFactory.codehash);
        assertEq(registry.LAUNCH_ROUTE(), predictedRoute);
        assertTrue(registry.hasRole(registry.WRITER_ROLE(), predictedRoute));
        _assertPairEvent(logs, coordinator, predictedFactory, predictedRoute, registry);

        bytes32 factoryCodeHash = predictedFactory.codehash;
        bytes32 routeCodeHash = predictedRoute.codehash;
        (bool replayOk,) = address(coordinator).call(abi.encodeWithSignature("deployPair()"));
        assertFalse(replayOk);
        assertEq(predictedFactory.codehash, factoryCodeHash);
        assertEq(predictedRoute.codehash, routeCodeHash);
    }

    function test_ceremonyRejectsWrongAuthorityEoaAndImplementationRuntimeBeforeChildrenExist() public {
        ExactShardsWrongRegistryAuthorityV1 wrong = new ExactShardsWrongRegistryAuthorityV1(address(0xBAD));
        vm.expectPartialRevert(ProgrammableExactShardsPairDeploymentCoordinatorV1.InvalidCoordinatorBinding.selector);
        new ProgrammableExactShardsPairDeploymentCoordinatorV1(
            authority,
            IProgrammableExactShardsRegistryV1(address(wrong)),
            address(implementation),
            address(implementation).codehash
        );

        vm.expectPartialRevert(ProgrammableExactShardsPairDeploymentCoordinatorV1.InvalidCoordinatorBinding.selector);
        new ProgrammableExactShardsPairDeploymentCoordinatorV1(
            IProgrammableLaunchPermitAuthorityV1(address(0xA0)),
            IProgrammableExactShardsRegistryV1(address(wrong)),
            address(implementation),
            address(implementation).codehash
        );

        uint64 nonce = vm.getNonce(address(this));
        address predictedCoordinator = vm.computeCreateAddress(address(this), nonce + 1);
        ProgrammableExactShardsRegistryV1 registry = _deployRegistry(vm.computeCreateAddress(predictedCoordinator, 2));
        vm.expectPartialRevert(
            ProgrammableExactShardsPairDeploymentCoordinatorV1.DependencyRuntimeCodeHashMismatch.selector
        );
        new ProgrammableExactShardsPairDeploymentCoordinatorV1(
            authority, registry, address(implementation), bytes32(uint256(1))
        );
        assertEq(vm.computeCreateAddress(predictedCoordinator, 1).code.length, 0);
        assertEq(vm.computeCreateAddress(predictedCoordinator, 2).code.length, 0);
    }

    function _deployRegistry(address exactRoute) private returns (ProgrammableExactShardsRegistryV1) {
        return new ProgrammableExactShardsRegistryV1(
            ProgrammableExactShardsRegistryV1.RegistryConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: address(this),
                initialApprover: APPROVER,
                initialLaunchIntentApprover: INTENT_APPROVER,
                initialWriter: exactRoute,
                initialFinalizer: FINALIZER,
                initialRevoker: REVOKER,
                registryGeneration: 3,
                minimumFinalityBlocks: 3,
                chainProfileHash: keccak256("ethereum-mainnet-chain-profile"),
                registryPolicyHash: keccak256("exact-shards-registry-policy")
            }),
            feeVerifier,
            authority
        );
    }

    function _assertPairEvent(
        Vm.Log[] memory logs,
        ProgrammableExactShardsPairDeploymentCoordinatorV1 coordinator,
        address factory,
        address route,
        ProgrammableExactShardsRegistryV1 registry
    ) private {
        bytes32 topic = keccak256(
            "ExactShardsFactoryRoutePairDeployedV1(address,address,address,address,address,bytes32,bytes32)"
        );
        for (uint256 index; index < logs.length; ++index) {
            if (logs[index].emitter != address(coordinator) || logs[index].topics[0] != topic) continue;
            assertEq(address(uint160(uint256(logs[index].topics[1]))), factory);
            assertEq(address(uint160(uint256(logs[index].topics[2]))), route);
            assertEq(address(uint160(uint256(logs[index].topics[3]))), address(implementation));
            (address eventAuthority, address eventRegistry, bytes32 factoryHash, bytes32 routeHash) =
                abi.decode(logs[index].data, (address, address, bytes32, bytes32));
            assertEq(eventAuthority, address(authority));
            assertEq(eventRegistry, address(registry));
            assertEq(factoryHash, factory.codehash);
            assertEq(routeHash, route.codehash);
            return;
        }
        fail();
    }
}
