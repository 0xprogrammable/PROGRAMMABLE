// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import {
    ProgrammableCustomFeePolicyVerifierLibV2,
    ProgrammableCustomFeePolicyVerifierV2
} from "../src/ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableCustomAtomicRegistrarV1 } from "../src/ProgrammableCustomAtomicRegistrarV1.sol";
import { ProgrammableCustomAtomicRegistrarV2 } from "../src/ProgrammableCustomAtomicRegistrarV2.sol";
import { ProgrammableCustomExecutionPolicyRegistryV2 } from "../src/ProgrammableCustomExecutionPolicyRegistryV2.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "../src/ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";
import { ProgrammableCustomRegistryV2 } from "../src/ProgrammableCustomRegistryV2.sol";
import { ProgrammableCustomTradeCapabilityLibV1 } from "../src/ProgrammableCustomTradeCapabilityLibV1.sol";
import { ProgrammableCustomTradeCapabilityValidatorV1 } from "../src/ProgrammableCustomTradeCapabilityValidatorV1.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "../src/interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "../src/interfaces/IProgrammableCustomExecutionPolicyV2.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";

contract CustomRuntimeTargetV2 {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract AtomicLaunchTargetV2 {
    uint256 public configuredValue;

    function initialize(uint256 value) external returns (bytes32 result) {
        require(configuredValue == 0, "already initialized");
        configuredValue = value;
        result = keccak256(abi.encode(value));
    }
}

contract ForceEtherV2 {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}

contract FutureProviderFactoryV2 {
    function register(
        IProgrammableCustomRegistryV1 registry,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration
    ) external {
        registry.registerLaunch(registration);
    }

    function registerAndBind(
        IProgrammableCustomRegistryV1 registry,
        IProgrammableCustomExecutionPolicyV2 executionPolicyRegistry,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability
    ) external {
        registry.registerLaunch(registration);
        executionPolicyRegistry.bindTradeCapabilityV1(capability, registration);
    }
}

contract ProgrammableCustomRegistryV2Test is Test {
    uint64 private constant GENERATION = 2;
    address private constant PROGRAMMABLE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address private constant PARTNER_RECIPIENT = address(0xBEEF);
    address private constant FEE_CURRENCY = address(0xCAFE);
    address private constant ADMIN = address(0xA001);
    address private constant REGISTRY_APPROVER = address(0xA002);
    address private constant WRITER = address(0xA003);
    address private constant FINALIZER = address(0xA004);
    address private constant CORRECTOR = address(0xA005);
    address private constant REGISTRY_REVOKER = address(0xA006);
    address private constant FACTORY_APPROVER = address(0xB001);
    address private constant FACTORY_REVOKER = address(0xB002);

    ProgrammableCustomFeePolicyVerifierV2 internal verifier;
    ProgrammableCustomPartnerFactoryRegistryV2 internal factoryRegistry;
    ProgrammableCustomRegistryV2 internal registry;
    ProgrammableCustomExecutionPolicyRegistryV2 internal executionPolicyRegistry;
    ProgrammableCustomAtomicRegistrarV2 internal atomicRegistrar;
    FutureProviderFactoryV2 internal providerFactory;
    FutureProviderFactoryV2 internal wrongFactory;
    CustomRuntimeTargetV2 internal runtimeTarget;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        verifier = new ProgrammableCustomFeePolicyVerifierV2();
        factoryRegistry =
            new ProgrammableCustomPartnerFactoryRegistryV2(2 days, ADMIN, FACTORY_APPROVER, FACTORY_REVOKER);
        uint256 nextNonce = vm.getNonce(address(this));
        address predictedRegistry = vm.computeCreateAddress(address(this), nextNonce + 1);
        address predictedRegistrar = vm.computeCreateAddress(address(this), nextNonce + 2);
        executionPolicyRegistry = new ProgrammableCustomExecutionPolicyRegistryV2(
            IProgrammableCustomRegistryV1(predictedRegistry), factoryRegistry, predictedRegistrar
        );
        ProgrammableCustomRegistryV1.RegistryConfigV1 memory config = _registryConfig();
        config.initialWriter = predictedRegistrar;
        registry = new ProgrammableCustomRegistryV2(config, factoryRegistry, verifier, executionPolicyRegistry);
        atomicRegistrar = new ProgrammableCustomAtomicRegistrarV2(registry, executionPolicyRegistry);
        bytes32 writerRole = registry.WRITER_ROLE();
        vm.prank(ADMIN);
        registry.grantRole(writerRole, WRITER);
        providerFactory = new FutureProviderFactoryV2();
        wrongFactory = new FutureProviderFactoryV2();
        runtimeTarget = new CustomRuntimeTargetV2();
    }

    function test_generationTwoIsPinnedAndV1InterfaceIsRetained() public view {
        assertEq(registry.REGISTRY_GENERATION(), GENERATION);
        assertEq(factoryRegistry.REGISTRY_GENERATION(), GENERATION);
        assertEq(address(registry.FEE_POLICY_VERIFIER()), address(verifier));
        assertEq(address(registry.PARTNER_FACTORY_REGISTRY()), address(factoryRegistry));
        assertTrue(registry.supportsInterface(type(IProgrammableCustomRegistryV1).interfaceId));
    }

    function test_atomicRegistrarPreservesPreexistingForcedEtherAndStillLaunches() public {
        uint256 forcedBalance = 1 wei;
        new ForceEtherV2{ value: forcedBalance }(payable(address(atomicRegistrar)));
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request =
            _atomicRequest("forced-ether-unit", 42);
        _authorizeApproval(request.registration);

        address deployed = atomicRegistrar.deployInitializeAndRegister(request);

        assertEq(deployed, request.registration.primaryContract);
        assertEq(AtomicLaunchTargetV2(deployed).configuredValue(), 42);
        assertEq(address(atomicRegistrar).balance, forcedBalance);
        assertTrue(registry.approvalConsumed(request.registration.approvalId));
    }

    function test_legacyAtomicSelectorRejectsMarketBearingRegistrationWithoutRouteProofs() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _nativeRegistration("market-bearing-legacy-selector");
        vm.expectPartialRevert(ProgrammableCustomAtomicRegistrarV2.InvalidTradeCapability.selector);
        atomicRegistrar.unsupportedTradeCapabilityV1(registration);
    }

    function testFuzz_atomicRegistrarPreservesArbitraryPreexistingForcedEther(uint96 rawForcedBalance) public {
        uint256 forcedBalance = bound(uint256(rawForcedBalance), 1, 100 ether);
        vm.deal(address(this), forcedBalance);
        new ForceEtherV2{ value: forcedBalance }(payable(address(atomicRegistrar)));
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request =
            _atomicRequest("forced-ether-fuzz", forcedBalance);
        _authorizeApproval(request.registration);

        address deployed = atomicRegistrar.deployInitializeAndRegister(request);

        assertEq(AtomicLaunchTargetV2(deployed).configuredValue(), forcedBalance);
        assertEq(address(atomicRegistrar).balance, forcedBalance);
        assertEq(uint8(registry.launchState(request.registration.launchId).status), 1);
    }

    function test_providerNeutralVerifierAcceptsUnknownFutureProviderStructure() public view {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _partnerPolicy(_hash("future-provider"));
        assertTrue(verifier.verify(policy) != bytes32(0));
    }

    function test_nativeRegistrationThroughWriterConsumesExactApproval() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _nativeRegistration("native-generation-two");
        _rebind(registration);
        _authorizeApproval(registration);

        vm.prank(WRITER);
        registry.registerLaunch(registration);

        assertEq(
            uint8(registry.launchState(registration.launchId).status),
            uint8(IProgrammableCustomRegistryV1.LaunchStatus.Observed)
        );
        assertTrue(registry.approvalConsumed(registration.approvalId));
        assertTrue(registry.deploymentConsumed(registration.deploymentId));
        assertEq(registry.launchState(registration.launchId).feePolicyHash, verifier.verify(registration.feePolicy));
    }

    function test_unknownFutureProviderRegistersOnlyThroughExactAuthorizedFactory() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("future-provider-success", _hash("provider-never-seen-before"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _unsupportedMarketCapability(registration, false);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);

        IProgrammableCustomRegistryV1.LaunchStateV1 memory state = registry.launchState(registration.launchId);
        IProgrammableCustomRegistryV1.LaunchDetailsV1 memory details = registry.launchDetails(registration.launchId);
        assertEq(uint8(state.status), uint8(IProgrammableCustomRegistryV1.LaunchStatus.Observed));
        assertEq(details.providerId, registration.providerId);
        assertEq(state.feePolicyHash, verifier.verify(registration.feePolicy));
        assertEq(registration.feePolicy.totalFeeBps, 20);
        assertEq(registration.feePolicy.partner.shareBps, 15);
        assertEq(registration.feePolicy.programmable.shareBps, 5);
        assertEq(registration.feePolicy.nativeCustomFeeBps, 0);
        assertEq(executionPolicyRegistry.tradeCapabilityHash(registration.launchId), registration.capabilitySetHash);
    }

    function test_providerAttributedProjectOnlyRegistrationUsesZeroNoMarketFeeTuple() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("future-provider-project-only", _hash("provider-project-only"));
        registration.marketPathId = bytes32(0);
        registration.marketSetHash = atomicRegistrar.PROJECT_ONLY_MARKET_SET_HASH();
        registration.feePolicy = _noQualifyingMarketPolicy();
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability = _projectOnlyCapability(registration);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);

        IProgrammableCustomRegistryV1.LaunchStateV1 memory state = registry.launchState(registration.launchId);
        IProgrammableCustomRegistryV1.LaunchDetailsV1 memory details = registry.launchDetails(registration.launchId);
        assertEq(uint8(state.status), uint8(IProgrammableCustomRegistryV1.LaunchStatus.Observed));
        assertEq(details.providerId, registration.providerId);
        assertTrue(details.templateId != bytes32(0));
        assertEq(details.marketPathId, bytes32(0));
        assertEq(registration.marketSetHash, atomicRegistrar.PROJECT_ONLY_MARKET_SET_HASH());
        assertEq(registration.feePolicy.providerId, bytes32(0));
        assertEq(registration.feePolicy.modelId, bytes32(0));
        assertEq(registration.feePolicy.templateId, bytes32(0));
        assertEq(registration.feePolicy.totalFeeBps, 0);
        assertEq(registration.feePolicy.partner.shareBps, 0);
        assertEq(registration.feePolicy.programmable.shareBps, 0);
        assertEq(capability.routes.length, 0);
        assertEq(capability.marketDataSources.length, 0);
        assertEq(executionPolicyRegistry.tradeCapabilityHash(registration.launchId), registration.capabilitySetHash);
    }

    function test_multipleExecutorsForSameMarketPathUseDeterministicTieBreakersAndRejectDuplicates() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _nativeRegistration("multi-executor-order");
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability = _standardCapability(registration);
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory second = capability.routes[0];
        second.executionTarget = address(runtimeTarget);
        second.executionTargetRuntimeCodeHash = address(runtimeTarget).codehash;
        second.configurationHash = _hash("second-executor-configuration");
        capability.routes = new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](2);
        if (uint160(second.executionTarget) < uint160(address(providerFactory))) {
            capability.routes[0] = second;
            capability.routes[1] = _standardCapability(registration).routes[0];
        } else {
            capability.routes[0] = _standardCapability(registration).routes[0];
            capability.routes[1] = second;
        }
        bytes32 routeSetHash = executionPolicyRegistry.computeTradeRouteSetHashV1(capability.routes);
        bytes32 duplicateMarketSetHash = executionPolicyRegistry.computeMarketSetHashV1(capability.routes);
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1[] memory oneRoute =
            new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](1);
        oneRoute[0] = capability.routes[0];
        assertEq(duplicateMarketSetHash, executionPolicyRegistry.computeMarketSetHashV1(oneRoute));
        assertTrue(routeSetHash != bytes32(0));

        capability.routes[1] = capability.routes[0];
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityLibV1.InvalidTradeRouteOrder.selector);
        executionPolicyRegistry.computeTradeRouteSetHashV1(capability.routes);
    }

    function test_marketSetHashGoldenVectorsAndRouteMarketSubstitutionMismatch() public {
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1[] memory routes =
            new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](0);
        assertEq(
            executionPolicyRegistry.computeMarketSetHashV1(routes),
            0xbd6f28a96b79921f21d91177e262ccb903f8cee746201feb41bcd74385ae3eef
        );
        assertEq(executionPolicyRegistry.computeMarketSetHashV1(routes), atomicRegistrar.PROJECT_ONLY_MARKET_SET_HASH());

        routes = new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](1);
        routes[0].marketId = bytes32(uint256(1));
        routes[0].marketPathId = bytes32(uint256(2));
        assertEq(
            executionPolicyRegistry.computeMarketSetHashV1(routes),
            0x2979e28b64b2675345eaea3c8f9d799f79debb4c256e333cd0d6bff7b7b923bf
        );

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("route-market-substitution", _hash("provider-market-substitution"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _unsupportedMarketCapability(registration, false);
        registration.marketSetHash = capability.marketSetHash;
        capability.routes[0].marketId = _hash("substituted-market");
        capability.marketDataSources[0].marketId = capability.routes[0].marketId;
        _finalizeCapability(capability);
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.expectPartialRevert(ProgrammableCustomExecutionPolicyRegistryV2.ExecutionPolicyBindingMismatch.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
    }

    function test_providerFactoryCannotBindStaleTargetRuntimeOrConfiguration() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("provider-stale-target", _hash("provider-runtime-guard"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability = _standardCapability(registration);
        registration.marketSetHash = capability.marketSetHash;
        capability.routes[0].executionTargetRuntimeCodeHash = _hash("stale-runtime");
        _finalizeCapability(capability);
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.RuntimeCodeHashMismatch.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
    }

    function test_providerFactoryCannotBindStaleMarketSourceOrQuoteRuntime() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("provider-stale-source", _hash("provider-source-guard"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _unsupportedMarketCapability(registration, true);
        registration.marketSetHash = capability.marketSetHash;
        capability.marketDataSources[0].emitterRuntimeCodeHash = _hash("stale-emitter-runtime");
        _finalizeCapability(capability);
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.RuntimeCodeHashMismatch.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
    }

    function test_marketSourceCannotBindCanonicalEmptyMetricSet() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("provider-empty-metrics", _hash("provider-empty-metrics"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _unsupportedMarketCapability(registration, false);
        registration.marketSetHash = capability.marketSetHash;
        capability.marketDataSources[0].metricsHash = executionPolicyRegistry.EMPTY_MARKET_DATA_METRIC_SET_HASH();
        _finalizeCapability(capability);
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.InvalidMarketDataSource.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
    }

    function test_providerFactoryCannotBindDriftedProxyMarketSourceImplementation() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("provider-proxy-source", _hash("provider-proxy-source-guard"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _unsupportedMarketCapability(registration, false);
        registration.marketSetHash = capability.marketSetHash;
        capability.marketDataSources[0].proxy = true;
        capability.marketDataSources[0].implementation = address(wrongFactory);
        capability.marketDataSources[0].implementationRuntimeCodeHash = address(wrongFactory).codehash;
        capability.marketDataSources[0].admin = ADMIN;
        _finalizeCapability(capability);
        bytes32 canonicalSourceHash =
            executionPolicyRegistry.computeMarketDataSourceHashV1(capability.marketDataSources[0]);
        capability.marketDataSources[0].admin = address(0xA009);
        assertTrue(
            executionPolicyRegistry.computeMarketDataSourceHashV1(capability.marketDataSources[0])
                != canonicalSourceHash
        );
        capability.marketDataSources[0].admin = ADMIN;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.etch(address(wrongFactory), hex"60006000fd");
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.RuntimeCodeHashMismatch.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
    }

    function test_providerFactoryCannotBindStaleQuoteRuntime() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("provider-stale-quote", _hash("provider-quote-guard"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _unsupportedMarketCapability(registration, true);
        registration.marketSetHash = capability.marketSetHash;
        capability.routes[0].quoterRuntimeCodeHash = _hash("stale-quoter-runtime");
        _finalizeCapability(capability);
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.RuntimeCodeHashMismatch.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
    }

    function test_providerFactoryCannotBindInvalidProxyOrZeroConfiguration() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("provider-invalid-proxy", _hash("provider-proxy-guard"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability = _standardCapability(registration);
        registration.marketSetHash = capability.marketSetHash;
        capability.routes[0].mode = IProgrammableCustomExecutionPolicyV2.TradeExecutionModeV1.Adapter;
        capability.routes[0].adapterId = _hash("adapter");
        capability.routes[0].adapterVersion = _hash("adapter-v1");
        capability.routes[0].proxy = true;
        capability.routes[0].implementation = capability.routes[0].executionTarget;
        capability.routes[0].implementationRuntimeCodeHash = capability.routes[0].executionTargetRuntimeCodeHash;
        _finalizeCapability(capability);
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.InvalidTradeCapability.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);

        registration = _partnerRegistration("provider-zero-config", _hash("provider-config-guard"));
        capability = _standardCapability(registration);
        registration.marketSetHash = capability.marketSetHash;
        capability.routes[0].configurationHash = bytes32(0);
        _finalizeCapability(capability);
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.InvalidTradeCapability.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
    }

    function test_nativeAtomicStandardRouteBindsAndPolicyFailureRollsBackEverything() public {
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request =
            _marketAtomicRequest("native-atomic-standard", 73);
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _standardCapability(request.registration);
        request.registration.marketSetHash = capability.marketSetHash;
        request.registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _rebind(request.registration);
        _authorizeApproval(request.registration);

        address deployed = atomicRegistrar.deployInitializeRegisterAndBindTradeCapabilityV1(request, capability);
        assertEq(deployed, request.registration.primaryContract);
        assertEq(AtomicLaunchTargetV2(deployed).configuredValue(), 73);
        assertEq(
            executionPolicyRegistry.tradeCapabilityHash(request.registration.launchId),
            request.registration.capabilitySetHash
        );

        request = _marketAtomicRequest("native-atomic-policy-rollback", 91);
        capability = _standardCapability(request.registration);
        request.registration.marketSetHash = _hash("registration-market-set-substitution");
        request.registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _rebind(request.registration);
        _authorizeApproval(request.registration);

        vm.expectPartialRevert(ProgrammableCustomExecutionPolicyRegistryV2.ExecutionPolicyBindingMismatch.selector);
        atomicRegistrar.deployInitializeRegisterAndBindTradeCapabilityV1(request, capability);
        assertEq(request.registration.primaryContract.code.length, 0);
        assertEq(uint8(registry.launchState(request.registration.launchId).status), 0);
        assertFalse(registry.approvalConsumed(request.registration.approvalId));
    }

    function test_providerAdapterDirectAndProxyRoutesBind() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("direct-adapter", _hash("provider-adapter-direct"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _adapterCapability(registration, false);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(executionPolicyRegistry.tradeCapabilityHash(registration.launchId), registration.capabilitySetHash);

        registration = _partnerRegistration("proxy-adapter", _hash("provider-adapter-proxy"));
        capability = _adapterCapability(registration, true);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(executionPolicyRegistry.tradeCapabilityHash(registration.launchId), registration.capabilitySetHash);
    }

    function test_directPoolManagerExecutionFailsClosed() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("direct-pool-manager", _hash("provider-direct-pool-manager"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability = _standardCapability(registration);
        capability.routes[0].executionTarget = capability.routes[0].poolManager;
        capability.routes[0].executionTargetRuntimeCodeHash = capability.routes[0].poolManagerRuntimeCodeHash;
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.InvalidTradeCapability.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
    }

    function test_pausedRetiredAndDelayedExecutableRoutesStayExecutionDisabled() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("paused-execution", _hash("provider-paused"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability = _standardCapability(registration);
        capability.routes[0].paused = true;
        capability.executionEnabled = false;
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);

        registration = _partnerRegistration("retired-execution", _hash("provider-retired"));
        capability = _standardCapability(registration);
        capability.routes[0].retired = true;
        capability.executionEnabled = false;
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);

        registration = _partnerRegistration("delayed-execution", _hash("provider-delayed-execution"));
        capability = _standardCapability(registration);
        capability.routes[0].activationBlock = uint64(block.number + 20);
        capability.executionEnabled = false;
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
    }

    function test_delayedExecutionFlagIsRecheckedAtExactLaunchBlock() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("delayed-window", _hash("provider-delayed-window"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability = _standardCapability(registration);
        capability.routes[0].activationBlock = uint64(block.number + 20);
        capability.executionEnabled = false;
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        vm.roll(block.number + 20);
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.InvalidTradeCapability.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);

        registration = _partnerRegistration("future-enabled", _hash("provider-future-enabled"));
        capability = _standardCapability(registration);
        capability.routes[0].activationBlock = uint64(block.number + 20);
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.InvalidTradeCapability.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
    }

    function test_stateReadSourceAndReviewedBeforeSwapReturnDeltaBind() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("state-read", _hash("provider-state-read"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _unsupportedMarketCapability(registration, false);
        capability.marketDataSources[0] = _stateReadSource(capability.routes[0].marketId);
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);

        registration = _partnerRegistration("reviewed-delta", _hash("provider-reviewed-delta"));
        capability = _standardCapability(registration);
        capability.routes[0].hook = address(runtimeTarget);
        capability.routes[0].hookRuntimeCodeHash = address(runtimeTarget).codehash;
        capability.routes[0].hookPermissionsHash = _hash("hook-permission-bitmap");
        capability.routes[0].hookReviewEvidenceHash = _hash("hook-review-evidence");
        capability.routes[0].beforeSwapReturnDeltaEnabled = true;
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);

        registration = _partnerRegistration("unreviewed-delta", _hash("provider-unreviewed-delta"));
        capability = _standardCapability(registration);
        capability.routes[0].hook = address(runtimeTarget);
        capability.routes[0].hookRuntimeCodeHash = address(runtimeTarget).codehash;
        capability.routes[0].hookPermissionsHash = _hash("hook-permission-bitmap");
        capability.routes[0].beforeSwapReturnDeltaEnabled = true;
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.InvalidTradeCapability.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
    }

    function test_multiMarketMultiSourceOrderingAndMaximumCounts() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("multi-market", _hash("provider-multi-market"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _unsupportedMarketCapability(registration, false);
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory firstRoute = capability.routes[0];
        firstRoute.marketId = bytes32(uint256(1));
        firstRoute.marketPathId = bytes32(uint256(1));
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory secondRoute;
        secondRoute.marketId = bytes32(uint256(2));
        secondRoute.marketPathId = bytes32(uint256(2));
        secondRoute.mode = IProgrammableCustomExecutionPolicyV2.TradeExecutionModeV1.Unsupported;
        secondRoute.activationBlock = uint64(block.number);
        secondRoute.evidenceHash = _hash("second-unsupported-route-evidence");
        capability.routes = new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](2);
        capability.routes[0] = firstRoute;
        capability.routes[1] = secondRoute;
        capability.marketDataSources = new IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[](2);
        capability.marketDataSources[0] = _eventSource(firstRoute.marketId, bytes32(uint256(1)));
        capability.marketDataSources[1] = _stateReadSource(capability.routes[1].marketId);
        _finalizeCapability(capability);
        registration.marketSetHash = capability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);

        IProgrammableCustomExecutionPolicyV2.TradeRouteV1[] memory tooManyRoutes =
            new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](257);
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityLibV1.SetTooLarge.selector);
        executionPolicyRegistry.computeTradeRouteSetHashV1(tooManyRoutes);
        IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[] memory tooManySources =
            new IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[](257);
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityLibV1.SetTooLarge.selector);
        executionPolicyRegistry.computeMarketDataSourceSetHashV1(tooManySources);

        bytes32[] memory extensibleMetricIds = new bytes32[](2);
        extensibleMetricIds[0] = bytes32(uint256(1));
        extensibleMetricIds[1] = executionPolicyRegistry.MARKET_DATA_PRICE_METRIC_ID();
        assertTrue(executionPolicyRegistry.computeMarketDataMetricSetHashV1(extensibleMetricIds) != bytes32(0));
        extensibleMetricIds[1] = extensibleMetricIds[0];
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityLibV1.InvalidMarketDataMetricOrder.selector);
        executionPolicyRegistry.computeMarketDataMetricSetHashV1(extensibleMetricIds);
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityLibV1.InvalidMarketDataMetricOrder.selector);
        executionPolicyRegistry.computeMarketDataMetricSetHashV1(new bytes32[](0));
        bytes32[] memory invalidMetricIds = new bytes32[](1);
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityLibV1.InvalidMarketDataMetricOrder.selector);
        executionPolicyRegistry.computeMarketDataMetricSetHashV1(invalidMetricIds);
        invalidMetricIds = new bytes32[](2);
        invalidMetricIds[0] = bytes32(uint256(2));
        invalidMetricIds[1] = bytes32(uint256(1));
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityLibV1.InvalidMarketDataMetricOrder.selector);
        executionPolicyRegistry.computeMarketDataMetricSetHashV1(invalidMetricIds);
        invalidMetricIds = new bytes32[](257);
        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityLibV1.SetTooLarge.selector);
        executionPolicyRegistry.computeMarketDataMetricSetHashV1(invalidMetricIds);
    }

    function test_providerFactoryCannotRegisterCapabilityXAndBindCapabilityY() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("provider-policy-substitution", _hash("provider-policy-binding"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory approvedCapability =
            _unsupportedMarketCapability(registration, false);
        registration.marketSetHash = approvedCapability.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(approvedCapability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory substitutedCapability = approvedCapability;
        substitutedCapability.evidenceHash = _hash("substituted-policy-evidence");
        vm.expectPartialRevert(ProgrammableCustomExecutionPolicyRegistryV2.ExecutionPolicyBindingMismatch.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, substitutedCapability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
        assertFalse(registry.approvalConsumed(registration.approvalId));
    }

    function test_emptyCapabilityRejectsNoncanonicalMarketSet() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("provider-fake-project-only", _hash("provider-market-set-guard"));
        registration.marketPathId = bytes32(0);
        registration.feePolicy = _noQualifyingMarketPolicy();
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability = _projectOnlyCapability(registration);
        registration.marketSetHash = _hash("opaque-noncanonical-empty-market-set");
        capability.marketSetHash = registration.marketSetHash;
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.expectPartialRevert(ProgrammableCustomTradeCapabilityValidatorV1.InvalidTradeCapability.selector);
        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
    }

    function test_futureMarketSourceAndRouteAreBoundAsDelayedNotObserved() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("provider-delayed-market", _hash("provider-delayed"));
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            _unsupportedMarketCapability(registration, true);
        registration.marketSetHash = capability.marketSetHash;
        capability.routes[0].activationBlock = uint64(block.number + 20);
        capability.marketDataSources[0].startBlock = uint64(block.number + 30);
        _finalizeCapability(capability);
        registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        providerFactory.registerAndBind(registry, executionPolicyRegistry, registration, capability);
        assertFalse(capability.executionEnabled);
        assertGt(capability.marketDataSources[0].startBlock, block.number);
        assertEq(executionPolicyRegistry.tradeCapabilityHash(registration.launchId), registration.capabilitySetHash);
    }

    function test_fakeProviderTagWithoutFactoryAuthorizationFailsClosed() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("fake-provider-tag", _hash("fabricated-provider"));
        _rebind(registration);
        _authorizeApproval(registration);

        vm.prank(WRITER);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationNotActive.selector);
        registry.registerLaunch(registration);
    }

    function test_revokedFactoryAuthorizationCannotRegister() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("revoked-factory", _hash("future-provider-revoked"));
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.prank(FACTORY_REVOKER);
        factoryRegistry.revokeFactory(
            registration.configurationHash, _hash("retired"), _hash("factory-revocation-evidence")
        );

        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationNotActive.selector);
        providerFactory.register(registry, registration);
    }

    function test_factoryAuthorizationRejectsCrossGenerationReplay() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("cross-generation", _hash("future-provider-generation"));
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization =
            _factoryAuthorization(registration, address(providerFactory));
        authorization.registryGeneration = 1;
        authorization.configurationHash = factoryRegistry.computeConfigurationHash(authorization);

        vm.prank(FACTORY_APPROVER);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.RegistryScopeMismatch.selector);
        factoryRegistry.authorizeFactory(authorization);
    }

    function test_authorizedRecordRejectsWrongFactoryRuntimePermissionsConfigurationAndFee() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("exact-factory-binding", _hash("provider-x"));
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        bytes32 canonicalConfigurationHash = registration.configurationHash;

        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.FactoryCallerMismatch.selector);
        wrongFactory.register(registry, registration);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory mutated =
            _partnerRegistration("exact-factory-binding", _hash("provider-x"));
        mutated.configurationHash = canonicalConfigurationHash;
        mutated.permissionsHash = _hash("wrong-permissions");
        _rebind(mutated);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationMismatch.selector);
        providerFactory.register(registry, mutated);

        mutated = _partnerRegistration("exact-factory-binding", _hash("provider-x"));
        mutated.configurationHash = canonicalConfigurationHash;
        mutated.runtimeCodeSetHash = _hash("wrong-runtime-set");
        mutated.feePolicy.partnerRuntimeCodeSetHash = mutated.runtimeCodeSetHash;
        _rebind(mutated);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationMismatch.selector);
        providerFactory.register(registry, mutated);

        mutated = _partnerRegistration("exact-factory-binding", _hash("provider-x"));
        mutated.configurationHash = _hash("fake-configuration");
        _rebind(mutated);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationNotActive.selector);
        providerFactory.register(registry, mutated);

        mutated = _partnerRegistration("exact-factory-binding", _hash("provider-x"));
        mutated.configurationHash = canonicalConfigurationHash;
        mutated.feePolicy.verificationEvidenceHash = _hash("different-fee-evidence");
        _rebind(mutated);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationMismatch.selector);
        providerFactory.register(registry, mutated);

        vm.etch(address(providerFactory), hex"60006000fd");
        vm.prank(address(providerFactory));
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.FactoryRuntimeMismatch.selector);
        registry.registerLaunch(registration);
    }

    function test_nativePolicyIsExactlyTenBpsAndCannotCarryPartnerOverlay() public {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _nativePolicy();
        assertTrue(verifier.verify(policy) != bytes32(0));

        policy.totalFeeBps = 20;
        policy.programmable.shareBps = 20;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);

        policy = _nativePolicy();
        policy.partner = _activeLeg(15, PARTNER_RECIPIENT, "partner-overlay");
        policy.totalFeeBps = 25;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);
    }

    function test_partnerPolicyRejectsOverlayWrongBasisRecipientAndClaimCollision() public {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _partnerPolicy(_hash("provider-y"));
        policy.nativeCustomFeeBps = 10;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);

        policy = _partnerPolicy(_hash("provider-y"));
        policy.partner.basisId = _hash("different-basis");
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);

        policy = _partnerPolicy(_hash("provider-y"));
        policy.partner.recipient = PROGRAMMABLE_RECIPIENT;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);

        policy = _partnerPolicy(_hash("provider-y"));
        policy.partner.claimRightId = policy.programmable.claimRightId;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);
    }

    function test_configurationCommitmentBindsGenerationAndV2Domain() public view {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("configuration-domain", _hash("provider-z"));
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization =
            _factoryAuthorization(registration, address(providerFactory));
        bytes32 generationTwoHash = factoryRegistry.computeConfigurationHash(authorization);

        authorization.registryGeneration = 1;
        bytes32 generationOneScopedHash = factoryRegistry.computeConfigurationHash(authorization);
        assertTrue(generationTwoHash != generationOneScopedHash);

        authorization.registryGeneration = 2;
        bytes32 modelHash = keccak256(
            abi.encode(
                authorization.providerId,
                authorization.modelId,
                authorization.modelVersion,
                authorization.templateId,
                authorization.templateVersion,
                authorization.modelRepositoryId,
                authorization.modelSourceCommitId
            )
        );
        bytes32 factoryHash = keccak256(
            abi.encode(
                authorization.factorySourceRepositoryId,
                authorization.factorySourceCommitId,
                authorization.chainId,
                authorization.registryGeneration,
                authorization.factory,
                authorization.factoryRuntimeCodeHash,
                authorization.launchRuntimeCodeSetHash
            )
        );
        bytes32 independentlyComputed = keccak256(
            abi.encode(
                keccak256("programmable.custom-partner-configuration.v2"),
                modelHash,
                factoryHash,
                authorization.permissionsHash,
                authorization.feePolicyHash
            )
        );
        assertEq(generationTwoHash, independentlyComputed);
    }

    function test_registrationCommitmentBindsEveryStrongPreimageGroup() public view {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _nativeRegistration("strong-preimage");
        bytes32 feePolicyHash = verifier.verify(registration.feePolicy);
        _rebind(registration);
        bytes32 canonical = registry.computeRegisteredRecordCommitment(registration, feePolicyHash);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory mutated = registration;
        mutated.configurationHash = _hash("mutated-configuration");
        assertTrue(registry.computeRegisteredRecordCommitment(mutated, feePolicyHash) != canonical);
        mutated = registration;
        mutated.permissionsHash = _hash("mutated-permissions");
        assertTrue(registry.computeRegisteredRecordCommitment(mutated, feePolicyHash) != canonical);
        mutated = registration;
        mutated.marketPathId = _hash("mutated-market-path");
        assertTrue(registry.computeRegisteredRecordCommitment(mutated, feePolicyHash) != canonical);
        mutated = registration;
        mutated.runtimeCodeSetHash = _hash("mutated-runtime-set");
        assertTrue(registry.computeRegisteredRecordCommitment(mutated, feePolicyHash) != canonical);
        mutated = registration;
        mutated.registryGeneration = 1;
        assertTrue(registry.computeRegisteredRecordCommitment(mutated, feePolicyHash) != canonical);
    }

    function testFuzz_anyNonzeroProviderNeedsExactFifteenFivePolicy(
        bytes32 providerId,
        uint8 partner,
        uint8 programmable
    ) public {
        vm.assume(providerId != bytes32(0));
        partner = uint8(bound(partner, 0, 20));
        programmable = uint8(bound(programmable, 0, 20));
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _partnerPolicy(providerId);
        policy.partner.shareBps = partner;
        policy.programmable.shareBps = programmable;
        policy.totalFeeBps = uint16(partner) + uint16(programmable);
        if (partner == 15 && programmable == 5) {
            assertTrue(verifier.verify(policy) != bytes32(0));
        } else {
            vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
            verifier.verify(policy);
        }
    }

    function _projectOnlyCapability(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability)
    {
        capability.chainId = registration.chainId;
        capability.registryGeneration = registration.registryGeneration;
        capability.launchId = registration.launchId;
        capability.marketSetHash = registration.marketSetHash;
        capability.routes = new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](0);
        capability.marketDataSources = new IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[](0);
        capability.evidenceHash = _hash("project-only-trade-capability-evidence");
        capability.revocationPolicyHash = atomicRegistrar.TRADE_REVOCATION_POLICY();
        _finalizeCapability(capability);
    }

    function _unsupportedMarketCapability(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
        bool withQuote
    ) private view returns (IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability) {
        capability.chainId = registration.chainId;
        capability.registryGeneration = registration.registryGeneration;
        capability.launchId = registration.launchId;
        capability.marketSetHash = registration.marketSetHash;
        capability.routes = new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](1);
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route;
        route.marketId = _hash("known-market");
        route.marketPathId = registration.marketPathId;
        route.mode = IProgrammableCustomExecutionPolicyV2.TradeExecutionModeV1.Unsupported;
        route.activationBlock = uint64(block.number);
        route.evidenceHash = _hash("unsupported-route-evidence");
        if (withQuote) {
            route.quoteSupported = true;
            route.simulationSupported = true;
            route.quoter = address(runtimeTarget);
            route.quoterRuntimeCodeHash = address(runtimeTarget).codehash;
        }
        capability.routes[0] = route;

        capability.marketDataSources = new IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[](1);
        capability.marketDataSources[0] = _eventSource(route.marketId, _hash("market-swap-events"));
        capability.evidenceHash = _hash("trade-capability-evidence");
        capability.revocationPolicyHash = atomicRegistrar.TRADE_REVOCATION_POLICY();
        _finalizeCapability(capability);
    }

    function _adapterCapability(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration, bool proxy)
        private
        view
        returns (IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability)
    {
        capability = _standardCapability(registration);
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route = capability.routes[0];
        route.mode = IProgrammableCustomExecutionPolicyV2.TradeExecutionModeV1.Adapter;
        route.adapterId = _hash("execution-adapter");
        route.adapterVersion = _hash("execution-adapter-v1");
        route.proxy = proxy;
        if (proxy) {
            route.implementation = address(wrongFactory);
            route.implementationRuntimeCodeHash = address(wrongFactory).codehash;
            route.admin = ADMIN;
        } else {
            route.implementation = route.executionTarget;
            route.implementationRuntimeCodeHash = route.executionTargetRuntimeCodeHash;
        }
        capability.routes[0] = route;
        _finalizeCapability(capability);
    }

    function _eventSource(bytes32 marketId, bytes32 sourceId)
        private
        view
        returns (IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory source)
    {
        source.marketId = marketId;
        source.sourceId = sourceId;
        source.kind = IProgrammableCustomExecutionPolicyV2.MarketDataSourceKindV1.Event;
        source.emitter = address(runtimeTarget);
        source.emitterRuntimeCodeHash = address(runtimeTarget).codehash;
        source.startBlock = uint64(block.number);
        source.topic0 = _hash("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
        source.eventAbiHash = _hash("swap-event-abi-v1");
        source.filterHash = _hash("exact-pool-id-filter");
        bytes32[] memory metricIds = new bytes32[](4);
        metricIds[0] = executionPolicyRegistry.MARKET_DATA_CHARTING_METRIC_ID();
        metricIds[1] = executionPolicyRegistry.MARKET_DATA_PRICE_METRIC_ID();
        metricIds[2] = executionPolicyRegistry.MARKET_DATA_VOLUME_METRIC_ID();
        metricIds[3] = executionPolicyRegistry.MARKET_DATA_LIQUIDITY_METRIC_ID();
        source.metricsHash = executionPolicyRegistry.computeMarketDataMetricSetHashV1(metricIds);
        source.derivationPolicyHash = _hash("canonical-event-derivation-v1");
        source.configurationHash = _hash("market-source-configuration");
        source.evidenceHash = _hash("market-source-evidence");
    }

    function _stateReadSource(bytes32 marketId)
        private
        view
        returns (IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory source)
    {
        source.marketId = marketId;
        source.sourceId = _hash("state-view-source");
        source.kind = IProgrammableCustomExecutionPolicyV2.MarketDataSourceKindV1.StateRead;
        source.startBlock = uint64(block.number);
        source.filterHash = _hash("exact-pool-id-filter");
        bytes32[] memory metricIds = new bytes32[](2);
        metricIds[0] = executionPolicyRegistry.MARKET_DATA_PRICE_METRIC_ID();
        metricIds[1] = executionPolicyRegistry.MARKET_DATA_LIQUIDITY_METRIC_ID();
        source.metricsHash = executionPolicyRegistry.computeMarketDataMetricSetHashV1(metricIds);
        source.derivationPolicyHash = _hash("canonical-state-read-v1");
        source.stateView = address(runtimeTarget);
        source.stateViewRuntimeCodeHash = address(runtimeTarget).codehash;
        source.readSelector = bytes4(keccak256("getSlot0(bytes32)"));
        source.configurationHash = _hash("state-read-configuration");
        source.evidenceHash = _hash("state-read-evidence");
    }

    function _standardCapability(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability)
    {
        capability.chainId = registration.chainId;
        capability.registryGeneration = registration.registryGeneration;
        capability.launchId = registration.launchId;
        capability.marketSetHash = registration.marketSetHash;
        capability.executionEnabled = true;
        capability.routes = new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](1);
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route;
        route.marketId = _hash("standard-v4-market");
        route.marketPathId = registration.marketPathId;
        route.mode = IProgrammableCustomExecutionPolicyV2.TradeExecutionModeV1.Standard;
        route.activationBlock = uint64(block.number);
        route.executionTarget = address(providerFactory);
        route.executionTargetRuntimeCodeHash = address(providerFactory).codehash;
        route.executionSelector = bytes4(keccak256("execute(bytes,bytes[],uint256)"));
        route.interfaceId = bytes4(keccak256("programmable.v4.universal-router.v1"));
        route.poolManager = address(wrongFactory);
        route.poolManagerRuntimeCodeHash = address(wrongFactory).codehash;
        route.permit2 = address(runtimeTarget);
        route.permit2RuntimeCodeHash = address(runtimeTarget).codehash;
        route.callerAllowlistHash = _hash("router-caller-allowlist");
        route.plannerCommandPolicyHash = _hash("v4-planner-command-action-set");
        route.hookDataPolicyHash = _hash("hook-data-policy");
        route.calldataPolicyHash = _hash("calldata-policy");
        route.valuePolicyHash = _hash("value-policy");
        route.recipientPolicyHash = _hash("recipient-policy");
        route.deadlinePolicyHash = _hash("deadline-policy");
        route.slippagePolicyHash = _hash("slippage-policy");
        route.permit2PolicyHash = _hash("permit2-policy");
        route.deltaAccountingPolicyHash = _hash("zero-sum-delta-policy");
        route.settlementPolicyHash = atomicRegistrar.SYNC_TRANSFER_SETTLE_POLICY();
        route.nonstandardTokenPolicyHash = _hash("nonstandard-token-policy");
        route.dependencyRuntimeCodeSetHash = _hash("standard-dependency-runtime-set");
        route.configurationHash = _hash("standard-route-configuration");
        route.evidenceHash = _hash("standard-route-evidence");
        capability.routes[0] = route;
        capability.marketDataSources = new IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[](0);
        capability.evidenceHash = _hash("trade-capability-evidence");
        capability.revocationPolicyHash = atomicRegistrar.TRADE_REVOCATION_POLICY();
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

    function _authorizeFactoryAndApproval(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
        address factory
    ) private {
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory
            authorization = _factoryAuthorization(registration, factory);
        authorization.configurationHash = factoryRegistry.computeConfigurationHash(authorization);
        registration.configurationHash = authorization.configurationHash;
        vm.prank(FACTORY_APPROVER);
        factoryRegistry.authorizeFactory(authorization);
        _rebind(registration);
        _authorizeApproval(registration);
    }

    function _authorizeApproval(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private {
        bytes32 feePolicyHash = verifier.verify(registration.feePolicy);
        bytes32 registrationBindingHash = registry.computeRegistrationBindingHash(registration, feePolicyHash);
        vm.prank(REGISTRY_APPROVER);
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
                evidenceHash: keccak256(abi.encode("approval-evidence", registration.approvalId))
            })
        );
    }

    function _factoryAuthorization(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
        address factory
    ) private view returns (IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization) {
        authorization = IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1({
            chainId: registration.chainId,
            registryGeneration: registration.registryGeneration,
            configurationHash: bytes32(0),
            providerId: registration.providerId,
            modelId: registration.modelId,
            modelVersion: registration.modelVersion,
            templateId: registration.templateId,
            templateVersion: registration.templateVersion,
            modelRepositoryId: registration.repositoryId,
            modelSourceCommitId: registration.commitId,
            factorySourceRepositoryId: _hash("provider-factory-repository"),
            factorySourceCommitId: _hash("provider-factory-commit"),
            factory: factory,
            factoryRuntimeCodeHash: factory.codehash,
            launchRuntimeCodeSetHash: registration.runtimeCodeSetHash,
            permissionsHash: registration.permissionsHash,
            feePolicyHash: verifier.verify(registration.feePolicy),
            validAfterBlock: uint64(block.number),
            expiresAtBlock: uint64(block.number + 100),
            evidenceHash: keccak256(abi.encode("factory-evidence", registration.launchId))
        });
    }

    function _nativeRegistration(string memory label)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration = _baseRegistration(label);
        registration.feePolicy = _nativePolicy();
        registration.feePolicy.modelId = registration.modelId;
        registration.feePolicy.modelVersion = registration.modelVersion;
        registration.feePolicy.templateId = registration.templateId;
        registration.feePolicy.templateVersion = registration.templateVersion;
        registration.feePolicy.marketPathId = registration.marketPathId;
    }

    function _atomicRequest(string memory label, uint256 configuredValue)
        private
        view
        returns (ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request)
    {
        request.salt = _hash(string.concat(label, "-salt"));
        request.creationCode = type(AtomicLaunchTargetV2).creationCode;
        request.initializationCall = abi.encodeCall(AtomicLaunchTargetV2.initialize, (configuredValue));
        request.initializationResultHash = keccak256(abi.encode(keccak256(abi.encode(configuredValue))));
        request.registration = _nativeRegistration(label);
        request.registration.primaryContract =
            atomicRegistrar.predictAddress(request.salt, keccak256(request.creationCode));
        request.registration.primaryRuntimeCodeHash = keccak256(type(AtomicLaunchTargetV2).runtimeCode);
        request.registration.launchWallet = address(this);
        request.registration.marketPathId = bytes32(0);
        request.registration.marketSetHash = atomicRegistrar.PROJECT_ONLY_MARKET_SET_HASH();
        request.registration.feePolicy = _noQualifyingMarketPolicy();
        request.registration.deploymentConfigurationHash = atomicRegistrar.computeAtomicRequestCommitment(request);
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            atomicRegistrar.unsupportedTradeCapabilityV1(request.registration);
        request.registration.capabilitySetHash = atomicRegistrar.computeTradeCapabilityHashV1(capability);
        _rebind(request.registration);
    }

    function _marketAtomicRequest(string memory label, uint256 configuredValue)
        private
        view
        returns (ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request)
    {
        request = _atomicRequest(label, configuredValue);
        request.registration.marketPathId = _hash(string.concat(label, "-market-path"));
        request.registration.feePolicy = _nativePolicy();
        request.registration.feePolicy.modelId = request.registration.modelId;
        request.registration.feePolicy.modelVersion = request.registration.modelVersion;
        request.registration.feePolicy.templateId = request.registration.templateId;
        request.registration.feePolicy.templateVersion = request.registration.templateVersion;
        request.registration.feePolicy.marketPathId = request.registration.marketPathId;
    }

    function _partnerRegistration(string memory label, bytes32 providerId)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration = _baseRegistration(label);
        registration.providerId = providerId;
        registration.feePolicy = _partnerPolicy(providerId);
        registration.feePolicy.modelId = registration.modelId;
        registration.feePolicy.modelVersion = registration.modelVersion;
        registration.feePolicy.templateId = registration.templateId;
        registration.feePolicy.templateVersion = registration.templateVersion;
        registration.feePolicy.marketPathId = registration.marketPathId;
        registration.feePolicy.partnerRepositoryId = registration.repositoryId;
        registration.feePolicy.partnerCommitId = registration.commitId;
        registration.feePolicy.partnerRuntimeCodeSetHash = registration.runtimeCodeSetHash;
    }

    function _baseRegistration(string memory label)
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
        registration.primaryContract = address(runtimeTarget);
        registration.primaryRuntimeCodeHash = address(runtimeTarget).codehash;
        registration.launchWallet = address(0x1A00);
        registration.modelId = _hash("generic-custom-model");
        registration.modelVersion = _hash("model-v2");
        registration.templateId = _hash(string.concat(label, "-template"));
        registration.templateVersion = _hash("template-v2");
        registration.builderAttributionHash = _hash(string.concat(label, "-builder"));
        registration.originHash = _hash(string.concat(label, "-origin"));
        registration.assetSetHash = _hash(string.concat(label, "-assets"));
        registration.marketSetHash = _hash(string.concat(label, "-markets"));
        registration.marketPathId = _hash(string.concat(label, "-market-path"));
        registration.capabilitySetHash = _hash(string.concat(label, "-capabilities"));
        registration.reviewPolicyHash = _hash("published-security-policy-v2");
        registration.securityReviewHash = _hash(string.concat(label, "-security-review"));
        registration.reviewResultId = _hash("reviewed-exact-deployment");
        registration.finalityPolicyHash = _hash("native-blockhash-depth-v2");
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
        policy.programmable = _activeLeg(10, PROGRAMMABLE_RECIPIENT, "programmable");
        policy.publicPolicyBindingHash = _hash("native-public-policy");
        policy.claimIsolationEvidenceHash = _hash("native-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("native-accounting-safety");
        policy.verificationEvidenceHash = _hash("native-verification");
    }

    function _partnerPolicy(bytes32 providerId)
        private
        pure
        returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy)
    {
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.PartnerTemplate;
        policy.providerId = providerId;
        policy.partnerStatusId = keccak256("programmable.partner-status.active.v1");
        policy.modelId = _hash("generic-custom-model");
        policy.modelVersion = _hash("model-v2");
        policy.templateId = _hash("partner-template");
        policy.templateVersion = _hash("template-v2");
        policy.marketPathId = _hash("partner-market-path");
        policy.partnerRepositoryId = _hash("partner-repository");
        policy.partnerCommitId = _hash("partner-commit");
        policy.partnerRuntimeCodeSetHash = _hash("partner-runtimes");
        policy.totalFeeBps = 20;
        policy.nativeCustomFeeBps = 0;
        policy.partner = _activeLeg(15, PARTNER_RECIPIENT, "partner");
        policy.programmable = _activeLeg(5, PROGRAMMABLE_RECIPIENT, "programmable");
        policy.partner.chargeModeId = policy.programmable.chargeModeId;
        policy.partner.basisId = policy.programmable.basisId;
        policy.partner.roundingId = policy.programmable.roundingId;
        policy.activationVersion = _hash("partner-activation-v2");
        policy.activationBlock = 50;
        policy.publicPolicyBindingHash = _hash("partner-public-policy");
        policy.claimIsolationEvidenceHash = _hash("partner-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("partner-accounting-safety");
        policy.verificationEvidenceHash = _hash("partner-verification");
    }

    function _noQualifyingMarketPolicy()
        private
        pure
        returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy)
    {
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NoQualifyingMarket;
        policy.publicPolicyBindingHash = _hash("no-market-public-policy");
        policy.claimIsolationEvidenceHash = _hash("no-market-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("no-market-accounting-safety");
        policy.verificationEvidenceHash = _hash("no-market-verification");
    }

    function _activeLeg(uint16 shareBps, address recipient, string memory label)
        private
        pure
        returns (IProgrammableCustomRegistryV1.FeeLegV1 memory leg)
    {
        leg.shareBps = shareBps;
        leg.recipient = recipient;
        leg.currency = FEE_CURRENCY;
        leg.chargeModeId = _hash("verified-official-market-path");
        leg.basisId = _hash("actual-settled-market-basis");
        leg.roundingId = _hash("cumulative-floor");
        leg.accrualId = _hash(string.concat(label, "-accrual"));
        leg.claimId = _hash(string.concat(label, "-claim"));
        leg.claimRightId = _hash(string.concat(label, "-claim-right"));
        leg.controlEvidenceHash = _hash(string.concat(label, "-control"));
    }

    function _rebind(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private view {
        bytes32 feePolicyHash = verifier.verify(registration.feePolicy);
        registration.approvalBindingHash = registry.computeApprovalBindingHash(registration, feePolicyHash);
        registration.reviewDeploymentBindingHash =
            registry.computeReviewDeploymentBindingHash(registration, feePolicyHash);
        registration.registeredRecordCommitment =
            registry.computeRegisteredRecordCommitment(registration, feePolicyHash);
    }

    function _registryConfig() private pure returns (ProgrammableCustomRegistryV1.RegistryConfigV1 memory config) {
        config = ProgrammableCustomRegistryV1.RegistryConfigV1({
            initialAdminDelay: 2 days,
            initialAdmin: ADMIN,
            initialApprover: REGISTRY_APPROVER,
            initialWriter: WRITER,
            initialFinalizer: FINALIZER,
            initialCorrector: CORRECTOR,
            initialRevoker: REGISTRY_REVOKER,
            registryGeneration: GENERATION,
            minimumFinalityBlocks: 3,
            chainProfileHash: _hash("ethereum-mainnet-chain-profile-v2"),
            registryPolicyHash: _hash("registry-policy-v2")
        });
    }

    function _hash(string memory label) private pure returns (bytes32) {
        return keccak256(bytes(label));
    }
}
