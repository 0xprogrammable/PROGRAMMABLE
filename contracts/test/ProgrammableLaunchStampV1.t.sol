// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";

import { ProgrammableCustomAtomicRegistrarV1 } from "../src/ProgrammableCustomAtomicRegistrarV1.sol";
import { ProgrammableCustomAtomicRegistrarV2 } from "../src/ProgrammableCustomAtomicRegistrarV2.sol";
import { ProgrammableCustomExecutionPolicyRegistryV2 } from "../src/ProgrammableCustomExecutionPolicyRegistryV2.sol";
import {
    ProgrammableCustomExecutionPolicyRevisionRegistryV2
} from "../src/ProgrammableCustomExecutionPolicyRevisionRegistryV2.sol";
import { ProgrammableCustomFeePolicyVerifierV2 } from "../src/ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "../src/ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";
import { ProgrammableCustomRegistryV2 } from "../src/ProgrammableCustomRegistryV2.sol";
import { ProgrammableLaunchStampV1 } from "../src/ProgrammableLaunchStampV1.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "../src/interfaces/IProgrammableCustomExecutionPolicyV2.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "../src/interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV2
} from "../src/interfaces/IProgrammableCustomPartnerFactoryRegistryV2.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";

contract StampRuntimeTargetV1 {
    function marker() external pure returns (bytes32) {
        return keccak256("programmable-launch-stamp-test-target");
    }
}

contract StampPoolManagerV1 {
    mapping(bytes32 slot => bytes32 value) private _slots;

    function setInitialized(bytes32 poolId, bool initialized) external {
        bytes32 stateSlot = keccak256(abi.encodePacked(poolId, bytes32(uint256(6))));
        _slots[stateSlot] = initialized ? bytes32(uint256(1 << 96)) : bytes32(0);
    }

    function extsload(bytes32 slot) external view returns (bytes32 value) {
        value = _slots[slot];
    }

    function getSlot0(PoolId poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)
    {
        bytes32 stateSlot = keccak256(abi.encodePacked(PoolId.unwrap(poolId), bytes32(uint256(6))));
        sqrtPriceX96 = uint160(uint256(_slots[stateSlot]));
        tick = 0;
        protocolFee = 0;
        lpFee = 3000;
    }
}

contract StampPartnerFactoryV1 {
    function deploy(bytes32 salt) external returns (address primaryContract) {
        primaryContract = address(new StampRuntimeTargetV1{ salt: salt }());
    }

    function predict(bytes32 salt) external view returns (address predicted) {
        bytes32 digest = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(type(StampRuntimeTargetV1).creationCode))
        );
        predicted = address(uint160(uint256(digest)));
    }
}

contract StampRegistrarHarnessV1 {
    function registerBindAndStamp(
        IProgrammableCustomRegistryV1 registry,
        ProgrammableCustomExecutionPolicyRegistryV2 executionPolicyRegistry,
        ProgrammableLaunchStampV1 stamp,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability,
        ProgrammableLaunchStampV1.StampRequestV1 calldata request
    ) external returns (bytes32 stampHash) {
        registry.registerLaunch(registration);
        executionPolicyRegistry.bindTradeCapabilityV1(capability, registration);
        stampHash = stamp.stampLaunchV1(request, registration, capability);
    }

    function stampOnly(
        ProgrammableLaunchStampV1 stamp,
        ProgrammableLaunchStampV1.StampRequestV1 calldata request,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability
    ) external returns (bytes32 stampHash) {
        stampHash = stamp.stampLaunchV1(request, registration, capability);
    }
}

contract FakeProgrammableLaunchStampV1 {
    event ProgrammableLaunchStampedV1(
        bytes32 indexed launchId,
        address indexed token,
        address indexed hook,
        address poolManager,
        bytes32 poolId,
        bytes32 stampHash
    );

    function forge(bytes32 launchId, address token, address hook) external {
        emit ProgrammableLaunchStampedV1(
            launchId, token, hook, address(0xBEEF), keccak256("fake-pool"), keccak256("fake-stamp")
        );
    }
}

contract ProgrammableLaunchStampV1Test is Test {
    using PoolIdLibrary for PoolKey;

    uint64 private constant GENERATION = 2;
    address private constant ADMIN = address(0xA001);
    address private constant APPROVER = address(0xA002);
    address private constant FINALIZER = address(0xA003);
    address private constant CORRECTOR = address(0xA004);
    address private constant REVOKER = address(0xA005);
    address private constant FACTORY_APPROVER = address(0xB001);
    address private constant FACTORY_REVOKER = address(0xB002);
    address private constant PROGRAMMABLE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address private constant FEE_CURRENCY = address(0xCAFE);

    ProgrammableCustomFeePolicyVerifierV2 internal verifier;
    ProgrammableCustomPartnerFactoryRegistryV2 internal factoryRegistry;
    ProgrammableCustomExecutionPolicyRegistryV2 internal executionPolicyRegistry;
    ProgrammableCustomExecutionPolicyRevisionRegistryV2 internal executionPolicyRevisionRegistry;
    ProgrammableCustomRegistryV2 internal registry;
    ProgrammableLaunchStampV1 internal stamp;
    StampRegistrarHarnessV1 internal registrar;

    StampRuntimeTargetV1 internal token;
    StampRuntimeTargetV1 internal quote;
    StampRuntimeTargetV1 internal hook;
    StampRuntimeTargetV1 internal secondHook;
    StampPoolManagerV1 internal poolManager;
    StampPoolManagerV1 internal secondPoolManager;
    StampRuntimeTargetV1 internal router;
    StampRuntimeTargetV1 internal permit2;
    StampRuntimeTargetV1 internal otherComponent;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);

        registrar = new StampRegistrarHarnessV1();
        verifier = new ProgrammableCustomFeePolicyVerifierV2();

        uint256 nextNonce = vm.getNonce(address(this));
        address predictedRevisionRegistry = vm.computeCreateAddress(address(this), nextNonce + 2);
        address predictedRegistry = vm.computeCreateAddress(address(this), nextNonce + 3);
        factoryRegistry = new ProgrammableCustomPartnerFactoryRegistryV2(
            2 days, ADMIN, FACTORY_APPROVER, FACTORY_REVOKER, address(registrar)
        );
        executionPolicyRegistry = new ProgrammableCustomExecutionPolicyRegistryV2(
            IProgrammableCustomRegistryV1(predictedRegistry),
            factoryRegistry,
            address(registrar),
            predictedRevisionRegistry
        );
        executionPolicyRevisionRegistry = new ProgrammableCustomExecutionPolicyRevisionRegistryV2(
            IProgrammableCustomRegistryV1(predictedRegistry),
            executionPolicyRegistry,
            2 days,
            ADMIN,
            APPROVER,
            CORRECTOR,
            REVOKER
        );

        ProgrammableCustomRegistryV1.RegistryConfigV1 memory config = _registryConfig();
        config.initialWriter = address(registrar);
        config.initialCorrector = address(executionPolicyRevisionRegistry);
        registry = new ProgrammableCustomRegistryV2(
            config, factoryRegistry, verifier, executionPolicyRegistry, executionPolicyRevisionRegistry
        );
        stamp = new ProgrammableLaunchStampV1(registry, executionPolicyRegistry, address(registrar));

        token = new StampRuntimeTargetV1();
        quote = new StampRuntimeTargetV1();
        hook = new StampRuntimeTargetV1();
        secondHook = new StampRuntimeTargetV1();
        poolManager = new StampPoolManagerV1();
        secondPoolManager = new StampPoolManagerV1();
        router = new StampRuntimeTargetV1();
        permit2 = new StampRuntimeTargetV1();
        otherComponent = new StampRuntimeTargetV1();
    }

    function test_stampsCanonicalLaunchAndExposesDirectTerminalGetters() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("canonical");

        bytes32 expectedStampHash = registration.originHash;
        bytes32 actualStampHash = _execute(registration, capability, request);
        bytes32 poolId = PoolId.unwrap(request.poolKey.toId());

        assertEq(actualStampHash, expectedStampHash);
        assertEq(stamp.launchIdByToken(address(token)), registration.launchId);
        assertEq(stamp.launchIdByHook(address(hook)), registration.launchId);
        assertEq(stamp.launchIdByPool(address(poolManager), poolId), registration.launchId);
        assertEq(stamp.launchIdByComponent(address(token)), registration.launchId);
        assertEq(stamp.launchIdByComponent(address(hook)), registration.launchId);
        assertEq(stamp.launchIdByComponent(address(otherComponent)), registration.launchId);
        assertEq(stamp.componentRuntimeCodeHash(address(token)), address(token).codehash);
        assertEq(stamp.componentRuntimeCodeHash(address(hook)), address(hook).codehash);
        assertEq(uint8(stamp.componentKind(address(token))), uint8(ProgrammableLaunchStampV1.ComponentKindV1.Token));
        assertEq(uint8(stamp.componentKind(address(hook))), uint8(ProgrammableLaunchStampV1.ComponentKindV1.Hook));

        (
            address recordedToken,
            address recordedHook,
            address recordedManager,
            bytes32 recordedPoolId,
            bytes32 recordedPoolKeyHash,
            bytes32 recordedComponentSetHash,
            bytes32 recordedCapabilityHash,
            bytes32 recordedStampHash
        ) = stamp.launchStamp(registration.launchId);
        assertEq(recordedToken, address(token));
        assertEq(recordedHook, address(hook));
        assertEq(recordedManager, address(poolManager));
        assertEq(recordedPoolId, poolId);
        assertEq(recordedPoolKeyHash, stamp.computePoolKeyHash(request.poolKey));
        assertEq(recordedComponentSetHash, stamp.computeComponentSetHash(request.components));
        assertEq(recordedCapabilityHash, registration.capabilitySetHash);
        assertEq(recordedStampHash, expectedStampHash);
    }

    function test_rejectsUnauthorizedStampCaller() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("unauthorized");

        vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampV1.Unauthorized.selector, address(this)));
        stamp.stampLaunchV1(request, registration, capability);
    }

    function test_copiedEventFromFakeRegistryDoesNotCreateCanonicalProof() public {
        FakeProgrammableLaunchStampV1 fake = new FakeProgrammableLaunchStampV1();
        bytes32 launchId = _hash("forged-launch");

        vm.recordLogs();
        fake.forge(launchId, address(token), address(hook));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 canonicalTopic0 =
            keccak256("ProgrammableLaunchStampedV1(bytes32,address,address,address,bytes32,bytes32)");

        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], canonicalTopic0);
        assertEq(logs[0].emitter, address(fake));
        assertTrue(logs[0].emitter != address(stamp));
        assertEq(stamp.launchIdByToken(address(token)), bytes32(0));
        assertEq(stamp.launchIdByHook(address(hook)), bytes32(0));
        (,,,,,,, bytes32 canonicalStampHash) = stamp.launchStamp(launchId);
        assertEq(canonicalStampHash, bytes32(0));
    }

    function test_atomicRollbackWhenStampRejectsNoCodeComponent() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("no-code-component");
        address noCode = address(0x123456);
        request.components[2] = ProgrammableLaunchStampV1.ComponentV1({
            account: noCode,
            runtimeCodeHash: keccak256("declared-runtime"),
            kind: ProgrammableLaunchStampV1.ComponentKindV1.Other
        });
        _sortComponents(request.components);
        _refresh(registration, capability, request);
        _authorize(registration);

        vm.expectPartialRevert(ProgrammableLaunchStampV1.InvalidComponent.selector);
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);

        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
        assertEq(executionPolicyRegistry.tradeCapabilityHash(registration.launchId), bytes32(0));
        (,,,,,,, bytes32 stampHash) = stamp.launchStamp(registration.launchId);
        assertEq(stampHash, bytes32(0));
    }

    function test_atomicRollbackWhenComponentRuntimeCodeHashIsWrong() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("wrong-component-runtime");
        uint256 componentIndex = _componentIndex(request.components, address(otherComponent));
        request.components[componentIndex].runtimeCodeHash = keccak256("wrong-runtime");
        _refresh(registration, capability, request);
        _authorize(registration);

        vm.expectPartialRevert(ProgrammableLaunchStampV1.InvalidComponent.selector);
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);

        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
        assertEq(stamp.launchIdByComponent(address(otherComponent)), bytes32(0));
    }

    function test_rejectsTokenSubstitutionAgainstRegisteredPrimaryContract() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("token-substitution");
        request.token = address(quote);
        request.tokenRuntimeCodeHash = address(quote).codehash;
        _refresh(registration, capability, request);
        _authorize(registration);

        vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampV1.InvalidBinding.selector, bytes32("v4-route")));
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);
    }

    function test_rejectsHookSubstitutionAgainstCapabilityRoute() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("hook-substitution");
        request.poolKey.hooks = IHooks(address(secondHook));
        request.hookRuntimeCodeHash = address(secondHook).codehash;
        _replaceComponent(request.components, address(hook), address(secondHook), request.hookRuntimeCodeHash);
        _sortComponents(request.components);
        _refresh(registration, capability, request);
        _authorize(registration);

        vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampV1.InvalidBinding.selector, bytes32("v4-route")));
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);
    }

    function test_rejectsPoolIdSubstitutionFromFeeMutation() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("fee-substitution");
        request.poolKey.fee = 500;
        _refresh(registration, capability, request);
        _authorize(registration);

        vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampV1.InvalidBinding.selector, bytes32("v4-route")));
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);
    }

    function test_rejectsPoolIdSubstitutionFromTickSpacingMutation() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("tick-substitution");
        request.poolKey.tickSpacing = 10;
        _refresh(registration, capability, request);
        _authorize(registration);

        vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampV1.InvalidBinding.selector, bytes32("v4-route")));
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);
    }

    function test_rejectsUninitializedDerivedPool() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("uninitialized-pool");
        poolManager.setInitialized(PoolId.unwrap(request.poolKey.toId()), false);
        _authorize(registration);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableLaunchStampV1.InvalidBinding.selector, bytes32("pool-uninitialized"))
        );
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);
    }

    function test_rejectsUnsortedCurrencyPairEvenWhenCapabilityIsRebound() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("unsorted-currencies");
        (request.poolKey.currency0, request.poolKey.currency1) = (request.poolKey.currency1, request.poolKey.currency0);
        capability.routes[0].marketId = PoolId.unwrap(request.poolKey.toId());
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _refresh(registration, capability, request);
        _authorize(registration);

        vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampV1.InvalidBinding.selector, bytes32("v4-route")));
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);
    }

    function test_rejectsEqualCurrenciesEvenWhenCapabilityIsRebound() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("equal-currencies");
        request.poolKey.currency1 = request.poolKey.currency0;
        capability.routes[0].marketId = PoolId.unwrap(request.poolKey.toId());
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _refresh(registration, capability, request);
        _authorize(registration);

        vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampV1.InvalidBinding.selector, bytes32("v4-route")));
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);
    }

    function test_rejectsDuplicateLaunchReplay() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("launch-replay");
        _execute(registration, capability, request);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableLaunchStampV1.LaunchAlreadyStamped.selector, registration.launchId)
        );
        registrar.stampOnly(stamp, request, registration, capability);
    }

    function test_rejectsCrossLaunchTokenComponentAndHookReuse() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory firstRegistration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory firstCapability,
            ProgrammableLaunchStampV1.StampRequestV1 memory firstRequest
        ) = _prepared("first-components");
        _execute(firstRegistration, firstCapability, firstRequest);

        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory secondRegistration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory secondCapability,
            ProgrammableLaunchStampV1.StampRequestV1 memory secondRequest
        ) = _prepared("second-components");
        _refresh(secondRegistration, secondCapability, secondRequest);
        _authorize(secondRegistration);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLaunchStampV1.ComponentAlreadyStamped.selector,
                _lowestComponent(firstRequest.components),
                firstRegistration.launchId
            )
        );
        registrar.registerBindAndStamp(
            registry, executionPolicyRegistry, stamp, secondRegistration, secondCapability, secondRequest
        );
    }

    function test_rejectsDuplicateAndUnsortedComponents() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("duplicate-component");
        request.components[1] = request.components[0];
        _refresh(registration, capability, request);
        _authorize(registration);

        vm.expectPartialRevert(ProgrammableLaunchStampV1.DuplicateOrUnsortedComponent.selector);
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);
    }

    function test_rejectsTokenEqualsHookRoleCollision() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("token-hook-collision");
        request.poolKey.hooks = IHooks(address(token));
        request.hookRuntimeCodeHash = address(token).codehash;
        capability.routes[0].hook = address(token);
        capability.routes[0].hookRuntimeCodeHash = address(token).codehash;
        capability.routes[0].marketId = PoolId.unwrap(request.poolKey.toId());
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _refresh(registration, capability, request);
        _authorize(registration);

        vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampV1.InvalidBinding.selector, bytes32("v4-route")));
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);
    }

    function test_stampHashIsDomainSeparatedAcrossCompanionInstances() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("domain-separation");
        ProgrammableLaunchStampV1 secondStamp =
            new ProgrammableLaunchStampV1(registry, executionPolicyRegistry, address(registrar));
        bytes32 capabilityHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);

        assertTrue(
            stamp.computeStampHash(request, capabilityHash) != secondStamp.computeStampHash(request, capabilityHash)
        );
        registration.originHash = stamp.computeStampHash(request, capabilityHash);
        _rebind(registration);
        _authorize(registration);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableLaunchStampV1.InvalidBinding.selector, bytes32("origin-hash"))
        );
        registrar.registerBindAndStamp(
            registry, executionPolicyRegistry, secondStamp, registration, capability, request
        );
    }

    function test_realAtomicRegistrarDeploysRegistersBindsAndStampsInOneCall() public {
        ProgrammableCustomAtomicRegistrarV2 atomicRegistrar = _deployActualRegistrarStack();
        (
            ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory atomicRequest,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory stampRequest
        ) = _actualAtomicPrepared(atomicRegistrar, "real-atomic-success");
        _authorize(atomicRequest.registration);

        (address deployed, bytes32 stampHash) =
            atomicRegistrar.deployInitializeRegisterBindAndStampV1(atomicRequest, capability, stampRequest);

        assertEq(deployed, atomicRequest.registration.primaryContract);
        assertGt(deployed.code.length, 0);
        assertEq(stampHash, atomicRequest.registration.originHash);
        assertEq(stamp.launchIdByToken(deployed), atomicRequest.registration.launchId);
        assertEq(
            executionPolicyRegistry.tradeCapabilityHash(atomicRequest.registration.launchId),
            atomicRequest.registration.capabilitySetHash
        );
    }

    function test_realAtomicRegistrarRollsBackDeploymentRegistryAndPolicyOnRuntimeDrift() public {
        ProgrammableCustomAtomicRegistrarV2 atomicRegistrar = _deployActualRegistrarStack();
        (
            ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory atomicRequest,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory stampRequest
        ) = _actualAtomicPrepared(atomicRegistrar, "real-atomic-rollback");
        _authorize(atomicRequest.registration);
        vm.etch(address(otherComponent), hex"6000");

        vm.expectPartialRevert(ProgrammableLaunchStampV1.InvalidComponent.selector);
        atomicRegistrar.deployInitializeRegisterBindAndStampV1(atomicRequest, capability, stampRequest);

        assertEq(atomicRequest.registration.primaryContract.code.length, 0);
        assertEq(uint8(registry.launchState(atomicRequest.registration.launchId).status), 0);
        assertFalse(registry.approvalConsumed(atomicRequest.registration.approvalId));
        assertEq(executionPolicyRegistry.tradeCapabilityHash(atomicRequest.registration.launchId), bytes32(0));
        assertEq(stamp.launchIdByToken(atomicRequest.registration.primaryContract), bytes32(0));
    }

    function test_realPartnerRegistrarLaunchesRegistersBindsAndStampsInOneCall() public {
        ProgrammableCustomAtomicRegistrarV2 atomicRegistrar = _deployActualRegistrarStack();
        StampPartnerFactoryV1 providerFactory = new StampPartnerFactoryV1();
        bytes32 salt = _hash("real-partner-salt");
        bytes memory factoryCalldata = abi.encodeCall(StampPartnerFactoryV1.deploy, (salt));
        address predictedToken = providerFactory.predict(salt);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _registration("real-partner");
        registration.providerId = _hash("future-partner-provider");
        registration.feePolicy = _partnerPolicy(registration);
        registration.primaryContract = predictedToken;
        registration.primaryRuntimeCodeHash = keccak256(type(StampRuntimeTargetV1).runtimeCode);
        ProgrammableLaunchStampV1.StampRequestV1 memory stampRequest =
            _stampRequestForToken(registration.launchId, predictedToken, registration.primaryRuntimeCodeHash);
        poolManager.setInitialized(PoolId.unwrap(stampRequest.poolKey.toId()), true);
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _capability(registration, stampRequest);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        registration.originHash = stamp.computeStampHash(stampRequest, registration.capabilitySetHash);

        _authorizePartnerFactory(registration, atomicRegistrar, providerFactory, factoryCalldata);
        _rebind(registration);
        _authorize(registration);
        ProgrammableCustomAtomicRegistrarV2.PartnerFactoryLaunchRequestV2 memory partnerRequest =
            ProgrammableCustomAtomicRegistrarV2.PartnerFactoryLaunchRequestV2({
                registration: registration, factoryCalldata: factoryCalldata
            });

        (address deployed, bytes32 stampHash) =
            atomicRegistrar.launchPartnerFactoryRegisterBindAndStampV1(partnerRequest, capability, stampRequest);

        assertEq(deployed, predictedToken);
        assertGt(deployed.code.length, 0);
        assertEq(stampHash, registration.originHash);
        assertEq(stamp.launchIdByToken(deployed), registration.launchId);
        assertEq(stamp.launchIdByHook(address(hook)), registration.launchId);
    }

    function test_atomicRollbackWhenPoolManagerRuntimeDrifts() public {
        (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("pool-manager-runtime-drift");
        _authorize(registration);
        vm.etch(address(poolManager), hex"6000");

        vm.expectRevert();
        registrar.registerBindAndStamp(registry, executionPolicyRegistry, stamp, registration, capability, request);

        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
        assertEq(executionPolicyRegistry.tradeCapabilityHash(registration.launchId), bytes32(0));
    }

    function testFuzz_poolKeyMutationNeverAliasesCanonicalStamp(uint24 fee, int24 tickSpacing) public {
        (
            ,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        ) = _prepared("pool-key-fuzz");
        bytes32 canonicalCapabilityHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        bytes32 canonicalStampHash = stamp.computeStampHash(request, canonicalCapabilityHash);
        fee = uint24(bound(fee, 1, 1_000_000));
        tickSpacing = int24(bound(tickSpacing, 1, 16_383));
        if (fee == request.poolKey.fee && tickSpacing == request.poolKey.tickSpacing) return;

        request.poolKey.fee = fee;
        request.poolKey.tickSpacing = tickSpacing;
        bytes32 mutatedStampHash = stamp.computeStampHash(request, canonicalCapabilityHash);

        assertTrue(mutatedStampHash != canonicalStampHash);
    }

    function _execute(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
        ProgrammableLaunchStampV1.StampRequestV1 memory request
    ) private returns (bytes32 stampHash) {
        _authorize(registration);
        stampHash = registrar.registerBindAndStamp(
            registry, executionPolicyRegistry, stamp, registration, capability, request
        );
    }

    function _deployActualRegistrarStack() private returns (ProgrammableCustomAtomicRegistrarV2 atomicRegistrar) {
        verifier = new ProgrammableCustomFeePolicyVerifierV2();
        uint256 nextNonce = vm.getNonce(address(this));
        address predictedRevisionRegistry = vm.computeCreateAddress(address(this), nextNonce + 2);
        address predictedRegistry = vm.computeCreateAddress(address(this), nextNonce + 3);
        address predictedRegistrar = vm.computeCreateAddress(address(this), nextNonce + 4);
        address predictedStamp = vm.computeCreateAddress(address(this), nextNonce + 5);
        factoryRegistry = new ProgrammableCustomPartnerFactoryRegistryV2(
            2 days, ADMIN, FACTORY_APPROVER, FACTORY_REVOKER, predictedRegistrar
        );
        executionPolicyRegistry = new ProgrammableCustomExecutionPolicyRegistryV2(
            IProgrammableCustomRegistryV1(predictedRegistry),
            factoryRegistry,
            predictedRegistrar,
            predictedRevisionRegistry
        );
        executionPolicyRevisionRegistry = new ProgrammableCustomExecutionPolicyRevisionRegistryV2(
            IProgrammableCustomRegistryV1(predictedRegistry),
            executionPolicyRegistry,
            2 days,
            ADMIN,
            APPROVER,
            CORRECTOR,
            REVOKER
        );
        ProgrammableCustomRegistryV1.RegistryConfigV1 memory config = _registryConfig();
        config.initialWriter = predictedRegistrar;
        config.initialCorrector = predictedRevisionRegistry;
        registry = new ProgrammableCustomRegistryV2(
            config, factoryRegistry, verifier, executionPolicyRegistry, executionPolicyRevisionRegistry
        );
        atomicRegistrar = new ProgrammableCustomAtomicRegistrarV2(
            registry, executionPolicyRegistry, factoryRegistry, ProgrammableLaunchStampV1(predictedStamp)
        );
        stamp = new ProgrammableLaunchStampV1(registry, executionPolicyRegistry, address(atomicRegistrar));
        assertEq(address(atomicRegistrar), predictedRegistrar);
        assertEq(address(stamp), predictedStamp);
    }

    function _actualAtomicPrepared(ProgrammableCustomAtomicRegistrarV2 atomicRegistrar, string memory label)
        private
        returns (
            ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory atomicRequest,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory stampRequest
        )
    {
        atomicRequest.salt = _hash(string.concat(label, "-salt"));
        atomicRequest.creationCode = type(StampRuntimeTargetV1).creationCode;
        atomicRequest.initializationResultHash = keccak256(new bytes(0));

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _registration(label);
        address predicted = atomicRegistrar.predictAddress(atomicRequest.salt, keccak256(atomicRequest.creationCode));
        registration.primaryContract = predicted;
        registration.primaryRuntimeCodeHash = keccak256(type(StampRuntimeTargetV1).runtimeCode);
        stampRequest = _stampRequestForToken(registration.launchId, predicted, registration.primaryRuntimeCodeHash);
        poolManager.setInitialized(PoolId.unwrap(stampRequest.poolKey.toId()), true);
        capability = _capability(registration, stampRequest);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        registration.originHash = stamp.computeStampHash(stampRequest, registration.capabilitySetHash);

        atomicRequest.registration = registration;
        registration.deploymentConfigurationHash = atomicRegistrar.computeAtomicRequestCommitment(atomicRequest);
        _rebind(registration);
        atomicRequest.registration = registration;
    }

    function _authorizePartnerFactory(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
        ProgrammableCustomAtomicRegistrarV2 atomicRegistrar,
        StampPartnerFactoryV1 providerFactory,
        bytes memory factoryCalldata
    ) private {
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization;
        authorization.chainId = registration.chainId;
        authorization.registryGeneration = registration.registryGeneration;
        authorization.providerId = registration.providerId;
        authorization.modelId = registration.modelId;
        authorization.modelVersion = registration.modelVersion;
        authorization.templateId = registration.templateId;
        authorization.templateVersion = registration.templateVersion;
        authorization.modelRepositoryId = registration.repositoryId;
        authorization.modelSourceCommitId = registration.commitId;
        authorization.factorySourceRepositoryId = _hash("partner-factory-repository");
        authorization.factorySourceCommitId = _hash("partner-factory-commit");
        authorization.factory = address(atomicRegistrar);
        authorization.factoryRuntimeCodeHash = address(atomicRegistrar).codehash;
        authorization.launchRuntimeCodeSetHash = registration.runtimeCodeSetHash;
        authorization.permissionsHash = registration.permissionsHash;
        authorization.feePolicyHash = verifier.verify(registration.feePolicy);
        authorization.validAfterBlock = uint64(block.number);
        authorization.expiresAtBlock = uint64(block.number + 100);
        authorization.evidenceHash = _hash("partner-factory-authorization-evidence");

        IProgrammableCustomPartnerFactoryRegistryV2.ProviderFactoryBindingV2 memory binding;
        binding.launchId = registration.launchId;
        binding.approvalId = registration.approvalId;
        binding.expectedPrimaryContract = registration.primaryContract;
        binding.expectedPrimaryRuntimeCodeHash = registration.primaryRuntimeCodeHash;
        binding.providerFactory = address(providerFactory);
        binding.providerFactoryRuntimeCodeHash = address(providerFactory).codehash;
        binding.proxyKind = IProgrammableCustomExecutionPolicyV2.ProxyKindV1.None;
        binding.implementation = address(providerFactory);
        binding.implementationRuntimeCodeHash = address(providerFactory).codehash;
        binding.launchSelector = StampPartnerFactoryV1.deploy.selector;
        binding.launchCalldataHash = keccak256(factoryCalldata);
        binding.launchResultHash = keccak256(abi.encode(registration.primaryContract));
        binding.resultDecodingPolicyHash = factoryRegistry.ADDRESS_RESULT_POLICY_HASH();
        binding.sourceRepositoryId = _hash("partner-factory-repository");
        binding.sourceCommitId = _hash("partner-factory-commit");
        binding.sourceCommitment = _hash("partner-factory-source");
        binding.buildCommitment = _hash("partner-factory-build");
        binding.artifactSetHash = _hash("partner-factory-artifacts");
        binding.evidenceHash = _hash("partner-factory-binding-evidence");

        authorization.configurationHash = factoryRegistry.computeConfigurationHashV2(authorization, binding);
        registration.configurationHash = authorization.configurationHash;
        vm.prank(FACTORY_APPROVER);
        factoryRegistry.authorizeFactoryV2(authorization, binding);
    }

    function _prepared(string memory label)
        private
        returns (
            IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
            ProgrammableLaunchStampV1.StampRequestV1 memory request
        )
    {
        registration = _registration(label);
        request = _stampRequest(registration.launchId);
        poolManager.setInitialized(PoolId.unwrap(request.poolKey.toId()), true);
        capability = _capability(registration, request);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        registration.originHash = stamp.computeStampHash(request, registration.capabilitySetHash);
        _rebind(registration);
    }

    function _refresh(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
        ProgrammableLaunchStampV1.StampRequestV1 memory request
    ) private view {
        registration.originHash =
            stamp.computeStampHash(request, executionPolicyRegistry.computeTradeCapabilityHashV1(capability));
        _rebind(registration);
    }

    function _stampRequest(bytes32 launchId)
        private
        view
        returns (ProgrammableLaunchStampV1.StampRequestV1 memory request)
    {
        request = _stampRequestForToken(launchId, address(token), address(token).codehash);
    }

    function _stampRequestForToken(bytes32 launchId, address tokenAddress, bytes32 tokenRuntimeCodeHash)
        private
        view
        returns (ProgrammableLaunchStampV1.StampRequestV1 memory request)
    {
        (address currency0, address currency1) = _sorted(tokenAddress, address(quote));
        request.chainId = block.chainid;
        request.registryGeneration = GENERATION;
        request.launchId = launchId;
        request.token = tokenAddress;
        request.tokenRuntimeCodeHash = tokenRuntimeCodeHash;
        request.poolManager = address(poolManager);
        request.poolManagerRuntimeCodeHash = address(poolManager).codehash;
        request.poolKey = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        request.hookRuntimeCodeHash = address(hook).codehash;
        request.components = new ProgrammableLaunchStampV1.ComponentV1[](3);
        request.components[0] = ProgrammableLaunchStampV1.ComponentV1({
            account: tokenAddress,
            runtimeCodeHash: tokenRuntimeCodeHash,
            kind: ProgrammableLaunchStampV1.ComponentKindV1.Token
        });
        request.components[1] = ProgrammableLaunchStampV1.ComponentV1({
            account: address(hook),
            runtimeCodeHash: address(hook).codehash,
            kind: ProgrammableLaunchStampV1.ComponentKindV1.Hook
        });
        request.components[2] = ProgrammableLaunchStampV1.ComponentV1({
            account: address(otherComponent),
            runtimeCodeHash: address(otherComponent).codehash,
            kind: ProgrammableLaunchStampV1.ComponentKindV1.Other
        });
        _sortComponents(request.components);
    }

    function _capability(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
        ProgrammableLaunchStampV1.StampRequestV1 memory request
    ) private view returns (IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability) {
        capability.chainId = block.chainid;
        capability.registryGeneration = GENERATION;
        capability.launchId = registration.launchId;
        capability.executionEnabled = true;
        capability.routes = new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](1);
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route;
        route.marketId = PoolId.unwrap(request.poolKey.toId());
        route.marketPathId = registration.marketPathId;
        route.mode = IProgrammableCustomExecutionPolicyV2.TradeExecutionModeV1.Standard;
        route.activationBlock = uint64(block.number);
        route.executionTarget = address(router);
        route.executionTargetRuntimeCodeHash = address(router).codehash;
        route.executionSelector = bytes4(keccak256("execute(bytes,bytes[],uint256)"));
        route.interfaceId = bytes4(keccak256("programmable.v4.universal-router.v1"));
        route.poolManager = request.poolManager;
        route.poolManagerRuntimeCodeHash = request.poolManagerRuntimeCodeHash;
        route.permit2 = address(permit2);
        route.permit2RuntimeCodeHash = address(permit2).codehash;
        route.hook = address(request.poolKey.hooks);
        route.hookRuntimeCodeHash = request.hookRuntimeCodeHash;
        route.hookPermissionsHash = _hash("hook-permissions");
        route.hookReviewEvidenceHash = _hash("hook-review");
        route.callerAllowlistHash = _hash("caller-allowlist");
        route.plannerCommandPolicyHash = _hash("planner-policy");
        route.hookDataPolicyHash = _hash("hook-data-policy");
        route.calldataPolicyHash = _hash("calldata-policy");
        route.valuePolicyHash = _hash("value-policy");
        route.recipientPolicyHash = _hash("recipient-policy");
        route.deadlinePolicyHash = _hash("deadline-policy");
        route.slippagePolicyHash = _hash("slippage-policy");
        route.permit2PolicyHash = _hash("permit2-policy");
        route.deltaAccountingPolicyHash = _hash("delta-accounting-policy");
        route.settlementPolicyHash = keccak256("programmable.v4.settlement.sync-transfer-settle.v1");
        route.nonstandardTokenPolicyHash = _hash("nonstandard-token-policy");
        route.dependencyRuntimeCodeSetHash = _hash("dependency-runtime-set");
        route.configurationHash = _hash("route-configuration");
        route.evidenceHash = _hash("route-evidence");
        capability.routes[0] = route;
        capability.marketDataSources = new IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[](0);
        capability.evidenceHash = _hash("capability-evidence");
        capability.revocationPolicyHash = keccak256("programmable.trade-capability.runtime-drift-revokes-execution.v1");
        _finalizeCapability(capability);
    }

    function _finalizeCapability(IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability)
        private
        view
    {
        capability.routeSetHash = executionPolicyRegistry.computeTradeRouteSetHashV1(capability.routes);
        capability.marketSetHash = executionPolicyRegistry.computeMarketSetHashV1(capability.routes);
        capability.marketDataSourceSetHash =
            executionPolicyRegistry.computeMarketDataSourceSetHashV1(capability.marketDataSources);
    }

    function _registration(string memory label)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration.chainId = block.chainid;
        registration.registryGeneration = GENERATION;
        registration.launchId = _hash(string.concat(label, "-launch"));
        registration.projectId = _hash(string.concat(label, "-project"));
        registration.approvalId = _hash(string.concat(label, "-approval"));
        registration.repositoryId = _hash(string.concat(label, "-repository"));
        registration.commitId = _hash(string.concat(label, "-commit"));
        registration.sourceCommitment = _hash(string.concat(label, "-source"));
        registration.buildCommitment = _hash(string.concat(label, "-build"));
        registration.artifactSetHash = _hash(string.concat(label, "-artifacts"));
        registration.deploymentConfigurationHash = _hash(string.concat(label, "-deployment-config"));
        registration.configurationHash = _hash(string.concat(label, "-configuration"));
        registration.permissionsHash = _hash(string.concat(label, "-permissions"));
        registration.deploymentId = _hash(string.concat(label, "-deployment-id"));
        registration.deploymentSetHash = _hash(string.concat(label, "-deployment-set"));
        registration.runtimeCodeSetHash = _hash(string.concat(label, "-runtime-set"));
        registration.primaryContract = address(token);
        registration.primaryRuntimeCodeHash = address(token).codehash;
        registration.launchWallet = address(this);
        registration.modelId = _hash("generic-custom-model");
        registration.modelVersion = _hash("model-v2");
        registration.templateId = _hash("native-template");
        registration.templateVersion = _hash("template-v2");
        registration.builderAttributionHash = _hash(string.concat(label, "-builder"));
        registration.originHash = _hash(string.concat(label, "-origin-placeholder"));
        registration.assetSetHash = _hash(string.concat(label, "-assets"));
        registration.marketSetHash = _hash(string.concat(label, "-markets-placeholder"));
        registration.marketPathId = _hash("native-market-path");
        registration.capabilitySetHash = _hash(string.concat(label, "-capabilities-placeholder"));
        registration.reviewPolicyHash = _hash("published-security-policy-v2");
        registration.securityReviewHash = _hash(string.concat(label, "-security-review"));
        registration.reviewResultId = _hash("reviewed-exact-deployment");
        registration.finalityPolicyHash = _hash("native-blockhash-depth-v2");
        registration.feePolicy = _nativePolicy();
    }

    function _nativePolicy() private pure returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy) {
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NativeCustom;
        policy.totalFeeBps = 10;
        policy.nativeCustomFeeBps = 10;
        policy.modelId = _hash("generic-custom-model");
        policy.modelVersion = _hash("model-v2");
        policy.templateId = _hash("native-template");
        policy.templateVersion = _hash("template-v2");
        policy.marketPathId = _hash("native-market-path");
        policy.programmable.shareBps = 10;
        policy.programmable.recipient = PROGRAMMABLE_RECIPIENT;
        policy.programmable.currency = FEE_CURRENCY;
        policy.programmable.chargeModeId = _hash("verified-official-market-path");
        policy.programmable.basisId = _hash("actual-settled-market-basis");
        policy.programmable.roundingId = _hash("cumulative-floor");
        policy.programmable.accrualId = _hash("programmable-accrual");
        policy.programmable.claimId = _hash("programmable-claim");
        policy.programmable.claimRightId = _hash("programmable-claim-right");
        policy.programmable.controlEvidenceHash = _hash("programmable-control");
        policy.publicPolicyBindingHash = _hash("native-public-policy");
        policy.claimIsolationEvidenceHash = _hash("native-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("native-accounting-safety");
        policy.verificationEvidenceHash = _hash("native-verification");
    }

    function _partnerPolicy(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
        private
        pure
        returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy)
    {
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.PartnerTemplate;
        policy.providerId = registration.providerId;
        policy.partnerStatusId = keccak256("programmable.partner-status.active.v1");
        policy.modelId = registration.modelId;
        policy.modelVersion = registration.modelVersion;
        policy.templateId = registration.templateId;
        policy.templateVersion = registration.templateVersion;
        policy.marketPathId = registration.marketPathId;
        policy.partnerRepositoryId = registration.repositoryId;
        policy.partnerCommitId = registration.commitId;
        policy.partnerRuntimeCodeSetHash = registration.runtimeCodeSetHash;
        policy.totalFeeBps = 20;
        policy.partner.shareBps = 15;
        policy.partner.recipient = address(0xBEEF);
        policy.partner.currency = FEE_CURRENCY;
        policy.programmable.shareBps = 5;
        policy.programmable.recipient = PROGRAMMABLE_RECIPIENT;
        policy.programmable.currency = FEE_CURRENCY;
        policy.partner.chargeModeId = _hash("verified-official-market-path");
        policy.partner.basisId = _hash("actual-settled-market-basis");
        policy.partner.roundingId = _hash("cumulative-floor");
        policy.partner.accrualId = _hash("partner-accrual");
        policy.partner.claimId = _hash("partner-claim");
        policy.partner.claimRightId = _hash("partner-claim-right");
        policy.partner.controlEvidenceHash = _hash("partner-control");
        policy.programmable.chargeModeId = policy.partner.chargeModeId;
        policy.programmable.basisId = policy.partner.basisId;
        policy.programmable.roundingId = policy.partner.roundingId;
        policy.programmable.accrualId = _hash("programmable-accrual");
        policy.programmable.claimId = _hash("programmable-claim");
        policy.programmable.claimRightId = _hash("programmable-claim-right");
        policy.programmable.controlEvidenceHash = _hash("programmable-control");
        policy.activationVersion = _hash("partner-activation-v2");
        policy.activationBlock = 50;
        policy.publicPolicyBindingHash = _hash("partner-public-policy");
        policy.claimIsolationEvidenceHash = _hash("partner-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("partner-accounting-safety");
        policy.verificationEvidenceHash = _hash("partner-verification");
    }

    function _rebind(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private view {
        bytes32 feePolicyHash = verifier.verify(registration.feePolicy);
        registration.approvalBindingHash = registry.computeApprovalBindingHash(registration, feePolicyHash);
        registration.reviewDeploymentBindingHash =
            registry.computeReviewDeploymentBindingHash(registration, feePolicyHash);
        registration.registeredRecordCommitment =
            registry.computeRegisteredRecordCommitment(registration, feePolicyHash);
    }

    function _authorize(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private {
        bytes32 feePolicyHash = verifier.verify(registration.feePolicy);
        bytes32 registrationBindingHash = registry.computeRegistrationBindingHash(registration, feePolicyHash);
        vm.prank(APPROVER);
        registry.authorizeApproval(
            IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
                chainId: registration.chainId,
                registryGeneration: registration.registryGeneration,
                approvalId: registration.approvalId,
                launchId: registration.launchId,
                approvalBindingHash: registration.approvalBindingHash,
                registrationBindingHash: registrationBindingHash,
                validAfterBlock: uint64(block.number),
                expiresAtBlock: uint64(block.number + 100),
                evidenceHash: keccak256(abi.encode("stamp-approval-evidence", registration.approvalId))
            })
        );
    }

    function _registryConfig() private pure returns (ProgrammableCustomRegistryV1.RegistryConfigV1 memory config) {
        config = ProgrammableCustomRegistryV1.RegistryConfigV1({
            initialAdminDelay: 2 days,
            initialAdmin: ADMIN,
            initialApprover: APPROVER,
            initialWriter: address(0xBEEF),
            initialFinalizer: FINALIZER,
            initialCorrector: CORRECTOR,
            initialRevoker: REVOKER,
            registryGeneration: GENERATION,
            minimumFinalityBlocks: 3,
            chainProfileHash: _hash("ethereum-mainnet-chain-profile-v2"),
            registryPolicyHash: _hash("registry-policy-v2")
        });
    }

    function _replaceComponent(
        ProgrammableLaunchStampV1.ComponentV1[] memory components,
        address oldAccount,
        address newAccount,
        bytes32 newRuntimeCodeHash
    ) private pure {
        uint256 index = _componentIndex(components, oldAccount);
        components[index].account = newAccount;
        components[index].runtimeCodeHash = newRuntimeCodeHash;
    }

    function _componentIndex(ProgrammableLaunchStampV1.ComponentV1[] memory components, address account)
        private
        pure
        returns (uint256)
    {
        for (uint256 index; index < components.length; ++index) {
            if (components[index].account == account) return index;
        }
        revert("component not found");
    }

    function _lowestComponent(ProgrammableLaunchStampV1.ComponentV1[] memory components)
        private
        pure
        returns (address)
    {
        return components[0].account;
    }

    function _sortComponents(ProgrammableLaunchStampV1.ComponentV1[] memory components) private pure {
        for (uint256 i = 1; i < components.length; ++i) {
            ProgrammableLaunchStampV1.ComponentV1 memory current = components[i];
            uint256 j = i;
            while (j != 0 && uint160(components[j - 1].account) > uint160(current.account)) {
                components[j] = components[j - 1];
                --j;
            }
            components[j] = current;
        }
    }

    function _sorted(address first, address second) private pure returns (address low, address high) {
        return uint160(first) < uint160(second) ? (first, second) : (second, first);
    }

    function _hash(string memory label) private pure returns (bytes32) {
        return keccak256(bytes(label));
    }
}
