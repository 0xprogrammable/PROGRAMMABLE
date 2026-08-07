// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProgrammableCustomTradeCapabilityLibV1 } from "./ProgrammableCustomTradeCapabilityLibV1.sol";
import { ProgrammableCustomTradeCapabilityValidatorV1 } from "./ProgrammableCustomTradeCapabilityValidatorV1.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "./interfaces/IProgrammableCustomExecutionPolicyV2.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "./interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";
import { IProgrammableCustomRegistryV1 } from "./interfaces/IProgrammableCustomRegistryV1.sol";

/// @title ProgrammableCustomExecutionPolicyRegistryV2
/// @notice Fixed Gen2 companion emitter/storage for exact trade routes and market-data sources.
/// @dev Registration and companions must be in one transaction for public validity. Runtime/config drift changes
///      capability availability, never the immutable Registry origin record.
contract ProgrammableCustomExecutionPolicyRegistryV2 is IProgrammableCustomExecutionPolicyV2 {
    uint64 public constant REQUIRED_REGISTRY_GENERATION = 2;
    bytes32 public constant MARKET_DATA_PRICE_METRIC_ID = keccak256("programmable.market-data-metric.price.v1");
    bytes32 public constant MARKET_DATA_VOLUME_METRIC_ID = keccak256("programmable.market-data-metric.volume.v1");
    bytes32 public constant MARKET_DATA_LIQUIDITY_METRIC_ID = keccak256("programmable.market-data-metric.liquidity.v1");
    bytes32 public constant MARKET_DATA_CHARTING_METRIC_ID = keccak256("programmable.market-data-metric.charting.v1");
    bytes32 public constant MARKET_EVENT_ABI_DOMAIN = keccak256("programmable.market-event-abi.v1");
    bytes32 public constant MARKET_EVENT_FILTER_DOMAIN = keccak256("programmable.market-event-filter.v1");
    bytes32 public constant MARKET_DATA_DERIVATION_DOMAIN = keccak256("programmable.market-data-derivation.v1");

    // Immutable protocol bindings intentionally use the uppercase convention.
    // slither-disable-next-line naming-convention
    IProgrammableCustomRegistryV1 public immutable REGISTRY;
    // slither-disable-next-line naming-convention
    IProgrammableCustomPartnerFactoryRegistryV1 public immutable PARTNER_FACTORY_REGISTRY;
    // slither-disable-next-line naming-convention
    address public immutable ATOMIC_REGISTRAR;
    // slither-disable-next-line naming-convention
    address public immutable POLICY_REVISION_REGISTRY;
    // slither-disable-next-line naming-convention
    uint256 public immutable CHAIN_ID;

    mapping(bytes32 launchId => bytes32 capabilityHash) public tradeCapabilityHash;

    error ExecutionPolicyAlreadyBound(bytes32 launchId);
    error ExecutionPolicyBindingMismatch(bytes32 supplied, bytes32 actual);
    error ExecutionPolicyRegistrationMismatch(bytes32 field);
    error ExecutionPolicyScopeMismatch(bytes32 launchId);
    error ExecutionPolicyUnauthorized(address caller, bytes32 launchId);
    error InvalidBinding(bytes32 field);

    constructor(
        IProgrammableCustomRegistryV1 predictedRegistry,
        IProgrammableCustomPartnerFactoryRegistryV1 partnerFactoryRegistry,
        address atomicRegistrar,
        address policyRevisionRegistry
    ) {
        if (address(predictedRegistry) == address(0)) {
            revert InvalidBinding(bytes32("registry"));
        }
        if (address(partnerFactoryRegistry) == address(0) || address(partnerFactoryRegistry).code.length == 0) {
            revert InvalidBinding(bytes32("partner-factory-registry"));
        }
        if (
            partnerFactoryRegistry.CHAIN_ID() != block.chainid
                || partnerFactoryRegistry.REGISTRY_GENERATION() != REQUIRED_REGISTRY_GENERATION
        ) revert InvalidBinding(bytes32("partner-factory-scope"));
        if (atomicRegistrar == address(0)) revert InvalidBinding(bytes32("atomic-registrar"));
        if (policyRevisionRegistry == address(0)) revert InvalidBinding(bytes32("policy-revision-registry"));
        REGISTRY = predictedRegistry;
        PARTNER_FACTORY_REGISTRY = partnerFactoryRegistry;
        ATOMIC_REGISTRAR = atomicRegistrar;
        POLICY_REVISION_REGISTRY = policyRevisionRegistry;
        CHAIN_ID = block.chainid;
    }

    function computeTradeRouteHashV1(TradeRouteV1 calldata route) external pure returns (bytes32) {
        return ProgrammableCustomTradeCapabilityLibV1.routeHash(route);
    }

    function computeTradeRouteSetHashV1(TradeRouteV1[] calldata routes) external pure returns (bytes32) {
        return ProgrammableCustomTradeCapabilityLibV1.routeSetHash(routes);
    }

    function computeMarketSetHashV1(TradeRouteV1[] calldata routes) external pure returns (bytes32) {
        return ProgrammableCustomTradeCapabilityLibV1.marketSetHash(routes);
    }

    function computeMarketDataMetricSetHashV1(bytes32[] calldata metricIds) external pure returns (bytes32) {
        return ProgrammableCustomTradeCapabilityLibV1.marketDataMetricSetHash(metricIds);
    }

    function computeMarketEventAbiHashV1(string calldata eventSignature, bytes32 abiContentHash, bytes32 abiVersionHash)
        external
        pure
        returns (bytes32 topic0, bytes32 eventAbiHash)
    {
        topic0 = keccak256(bytes(eventSignature));
        eventAbiHash = keccak256(abi.encode(MARKET_EVENT_ABI_DOMAIN, topic0, abiContentHash, abiVersionHash));
    }

    function computeMarketEventFilterHashV1(
        bytes32 marketId,
        bytes32 marketPathId,
        bytes32 poolId,
        address poolAddress,
        bytes32[] calldata indexedValues,
        bytes32 filterVersionHash
    ) external pure returns (bytes32 filterHash) {
        filterHash = keccak256(
            abi.encode(
                MARKET_EVENT_FILTER_DOMAIN,
                marketId,
                marketPathId,
                poolId,
                poolAddress,
                indexedValues,
                filterVersionHash
            )
        );
    }

    function computeMarketDataDerivationHashV1(
        bytes32 metricsHash,
        bytes32 formulaHash,
        bytes32 calldataPolicyHash,
        bytes32 derivationVersionHash
    ) external pure returns (bytes32 derivationPolicyHash) {
        derivationPolicyHash = keccak256(
            abi.encode(
                MARKET_DATA_DERIVATION_DOMAIN, metricsHash, formulaHash, calldataPolicyHash, derivationVersionHash
            )
        );
    }

    function computeMarketDataSourceHashV1(MarketDataSourceV1 calldata source) external pure returns (bytes32) {
        return ProgrammableCustomTradeCapabilityLibV1.marketDataSourceHash(source);
    }

    function computeMarketDataSourceSetHashV1(MarketDataSourceV1[] calldata sources) external pure returns (bytes32) {
        return ProgrammableCustomTradeCapabilityLibV1.marketDataSourceSetHash(sources);
    }

    function computeTradeCapabilityHashV1(TradeCapabilityV1 calldata capability) external pure returns (bytes32) {
        return ProgrammableCustomTradeCapabilityLibV1.capabilityHash(capability);
    }

    function bindTradeCapabilityV1(
        TradeCapabilityV1 calldata capability,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration
    ) external {
        if (
            capability.chainId != CHAIN_ID || capability.registryGeneration != REQUIRED_REGISTRY_GENERATION
                || capability.evidenceHash == bytes32(0) || capability.revocationPolicyHash == bytes32(0)
        ) {
            revert ExecutionPolicyScopeMismatch(capability.launchId);
        }
        bytes32 actual =
            ProgrammableCustomTradeCapabilityValidatorV1.validate(capability, CHAIN_ID, REQUIRED_REGISTRY_GENERATION);
        if (
            capability.launchId != registration.launchId || capability.marketSetHash != registration.marketSetHash
                || actual != registration.capabilitySetHash
        ) revert ExecutionPolicyBindingMismatch(registration.capabilitySetHash, actual);

        IProgrammableCustomRegistryV1.LaunchStateV1 memory state = REGISTRY.launchState(capability.launchId);
        if (
            state.status != IProgrammableCustomRegistryV1.LaunchStatus.Observed || state.observedAtBlock != block.number
        ) revert ExecutionPolicyScopeMismatch(capability.launchId);
        _validateRegistrationBinding(registration, state);
        if (msg.sender != ATOMIC_REGISTRAR) {
            revert ExecutionPolicyUnauthorized(msg.sender, capability.launchId);
        }
        if (tradeCapabilityHash[capability.launchId] != bytes32(0)) {
            revert ExecutionPolicyAlreadyBound(capability.launchId);
        }

        tradeCapabilityHash[capability.launchId] = actual;
        _emitTradeCapability(capability, actual);
    }

    /// @dev The sole correction contract calls this only after Registry.correctLaunchRecord. A failure reverts both.
    function emitTradeCapabilityRevisionV1(TradeCapabilityV1 calldata capability, bytes32 expectedPolicyHash)
        external
        returns (bytes32 actualPolicyHash)
    {
        if (msg.sender != POLICY_REVISION_REGISTRY) {
            revert ExecutionPolicyUnauthorized(msg.sender, capability.launchId);
        }
        actualPolicyHash =
            ProgrammableCustomTradeCapabilityValidatorV1.validate(capability, CHAIN_ID, REQUIRED_REGISTRY_GENERATION);
        if (actualPolicyHash != expectedPolicyHash) {
            revert ExecutionPolicyBindingMismatch(expectedPolicyHash, actualPolicyHash);
        }
        _emitTradeCapability(capability, actualPolicyHash);
    }

    function _emitTradeCapability(TradeCapabilityV1 calldata capability, bytes32 actual) private {
        emit CustomLaunchExecutionPolicyBoundV2(
            capability.launchId,
            actual,
            capability.routeSetHash,
            capability.marketSetHash,
            uint32(capability.routes.length),
            capability.marketDataSourceSetHash,
            uint32(capability.marketDataSources.length),
            capability.executionEnabled,
            capability.evidenceHash,
            capability.revocationPolicyHash
        );
        for (uint256 index; index < capability.routes.length; index++) {
            _emitTradeRoute(capability.launchId, actual, uint32(index), capability.routes[index]);
        }
        for (uint256 index; index < capability.marketDataSources.length; index++) {
            _emitMarketDataSource(capability.launchId, actual, uint32(index), capability.marketDataSources[index]);
        }
    }

    function _emitTradeRoute(bytes32 launchId, bytes32 policyHash, uint32 index, TradeRouteV1 calldata route) private {
        emit CustomLaunchExecutionRouteBoundV2(
            launchId,
            policyHash,
            index,
            route.marketId,
            route.marketPathId,
            uint8(route.mode),
            route.adapterId,
            route.executionTarget,
            route.executionTargetRuntimeCodeHash,
            route.configurationHash,
            route.dependencyRuntimeCodeSetHash,
            _proxyBindingHash(route),
            ProgrammableCustomTradeCapabilityLibV1.routeHash(route)
        );
    }

    function _emitMarketDataSource(
        bytes32 launchId,
        bytes32 policyHash,
        uint32 index,
        MarketDataSourceV1 calldata source
    ) private {
        emit CustomLaunchMarketDataSourceBoundV2(
            launchId,
            policyHash,
            index,
            source.marketId,
            source.sourceId,
            uint8(source.kind),
            source.kind == MarketDataSourceKindV1.Event ? source.emitter : source.stateView,
            source.kind == MarketDataSourceKindV1.Event
                ? source.emitterRuntimeCodeHash
                : source.stateViewRuntimeCodeHash,
            source.startBlock,
            _sourceIdentityHash(source),
            source.metricsHash,
            source.configurationHash,
            ProgrammableCustomTradeCapabilityLibV1.marketDataSourceHash(source)
        );
        emit CustomLaunchMarketDataMetricsBoundV2(launchId, policyHash, index, source.metricsHash, source.metricIds);
    }

    function _proxyBindingHash(TradeRouteV1 calldata route) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                route.proxy,
                route.proxyKind,
                route.proxyBindingEvidenceHash,
                route.proxyPolicyHash,
                route.implementation,
                route.implementationRuntimeCodeHash,
                route.admin,
                route.adminRuntimeCodeHash,
                route.beacon,
                route.beaconRuntimeCodeHash,
                route.adapterVersion,
                route.executionSelector,
                route.interfaceId
            )
        );
    }

    function _sourceIdentityHash(MarketDataSourceV1 calldata source) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                source.topic0,
                source.eventAbiHash,
                source.filterHash,
                source.metricsHash,
                source.derivationPolicyHash,
                source.readSelector,
                _sourceProxyBindingHash(source)
            )
        );
    }

    function _sourceProxyBindingHash(MarketDataSourceV1 calldata source) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                source.proxy,
                source.proxyKind,
                source.proxyBindingEvidenceHash,
                source.proxyPolicyHash,
                source.implementation,
                source.implementationRuntimeCodeHash,
                source.admin,
                source.adminRuntimeCodeHash,
                source.beacon,
                source.beaconRuntimeCodeHash
            )
        );
    }

    function _validateRegistrationBinding(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration,
        IProgrammableCustomRegistryV1.LaunchStateV1 memory state
    ) private view {
        if (
            registration.chainId != CHAIN_ID || registration.registryGeneration != REQUIRED_REGISTRY_GENERATION
                || registration.registeredRecordCommitment != state.latestRecordHash || state.latestRecordRevision != 1
                || REGISTRY.recordHashAtRevision(registration.launchId, 1) != registration.registeredRecordCommitment
        ) revert ExecutionPolicyRegistrationMismatch(bytes32("record"));

        bytes32 feePolicyHash = REGISTRY.computeFeePolicyHash(registration.feePolicy);
        bytes32 identityHash = REGISTRY.computeRegistrationBindingHash(registration, feePolicyHash);
        IProgrammableCustomRegistryV1.ApprovalStateV1 memory approval = REGISTRY.approvalState(registration.approvalId);
        if (
            feePolicyHash != state.feePolicyHash || identityHash != state.identityHash
                || identityHash != approval.registrationBindingHash || approval.launchId != registration.launchId
                || approval.approvalBindingHash != registration.approvalBindingHash || !approval.consumed
        ) revert ExecutionPolicyRegistrationMismatch(bytes32("approval"));

        IProgrammableCustomRegistryV1.LaunchDetailsV1 memory details = REGISTRY.launchDetails(registration.launchId);
        if (keccak256(abi.encode(details)) != _registrationDetailsHash(registration)) {
            revert ExecutionPolicyRegistrationMismatch(bytes32("details"));
        }
    }

    function _registrationDetailsHash(IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration)
        private
        pure
        returns (bytes32)
    {
        IProgrammableCustomRegistryV1.LaunchDetailsV1 memory supplied;
        supplied.projectId = registration.projectId;
        supplied.approvalId = registration.approvalId;
        supplied.approvalBindingHash = registration.approvalBindingHash;
        supplied.deploymentId = registration.deploymentId;
        supplied.deploymentSetHash = registration.deploymentSetHash;
        supplied.runtimeCodeSetHash = registration.runtimeCodeSetHash;
        supplied.primaryContract = registration.primaryContract;
        supplied.primaryRuntimeCodeHash = registration.primaryRuntimeCodeHash;
        supplied.launchWallet = registration.launchWallet;
        supplied.modelId = registration.modelId;
        supplied.modelVersion = registration.modelVersion;
        supplied.templateId = registration.templateId;
        supplied.templateVersion = registration.templateVersion;
        supplied.providerId = registration.providerId;
        supplied.configurationHash = registration.configurationHash;
        supplied.permissionsHash = registration.permissionsHash;
        supplied.marketPathId = registration.marketPathId;
        supplied.reviewPolicyHash = registration.reviewPolicyHash;
        supplied.securityReviewHash = registration.securityReviewHash;
        supplied.reviewResultId = registration.reviewResultId;
        supplied.reviewDeploymentBindingHash = registration.reviewDeploymentBindingHash;
        supplied.finalityPolicyHash = registration.finalityPolicyHash;
        return keccak256(abi.encode(supplied));
    }
}
