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
    bytes32 public constant EMPTY_MARKET_DATA_METRIC_SET_HASH =
        0x7b5384e78f1bd4310c1264ebe06d19b2fc61f8ff2781748daa2e14df0387082a;

    // Immutable protocol bindings intentionally use the uppercase convention.
    // slither-disable-next-line naming-convention
    IProgrammableCustomRegistryV1 public immutable REGISTRY;
    // slither-disable-next-line naming-convention
    IProgrammableCustomPartnerFactoryRegistryV1 public immutable PARTNER_FACTORY_REGISTRY;
    // slither-disable-next-line naming-convention
    address public immutable ATOMIC_REGISTRAR;
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
        address atomicRegistrar
    ) {
        if (address(predictedRegistry) == address(0)) revert InvalidBinding(bytes32("registry"));
        if (address(partnerFactoryRegistry) == address(0) || address(partnerFactoryRegistry).code.length == 0) {
            revert InvalidBinding(bytes32("partner-factory-registry"));
        }
        if (
            partnerFactoryRegistry.CHAIN_ID() != block.chainid
                || partnerFactoryRegistry.REGISTRY_GENERATION() != REQUIRED_REGISTRY_GENERATION
        ) revert InvalidBinding(bytes32("partner-factory-scope"));
        if (atomicRegistrar == address(0)) revert InvalidBinding(bytes32("atomic-registrar"));
        REGISTRY = predictedRegistry;
        PARTNER_FACTORY_REGISTRY = partnerFactoryRegistry;
        ATOMIC_REGISTRAR = atomicRegistrar;
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
        _validatePolicyBinder(capability.launchId, state);
        if (tradeCapabilityHash[capability.launchId] != bytes32(0)) {
            revert ExecutionPolicyAlreadyBound(capability.launchId);
        }

        tradeCapabilityHash[capability.launchId] = actual;

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
            source.configurationHash,
            ProgrammableCustomTradeCapabilityLibV1.marketDataSourceHash(source)
        );
    }

    function _proxyBindingHash(TradeRouteV1 calldata route) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                route.proxy,
                route.implementation,
                route.implementationRuntimeCodeHash,
                route.admin,
                route.adminRuntimeCodeHash,
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
                source.proxy,
                source.implementation,
                source.implementationRuntimeCodeHash,
                source.admin,
                source.adminRuntimeCodeHash
            )
        );
    }

    function _validatePolicyBinder(bytes32 launchId, IProgrammableCustomRegistryV1.LaunchStateV1 memory state)
        private
        view
    {
        if (msg.sender == ATOMIC_REGISTRAR) return;

        IProgrammableCustomRegistryV1.LaunchDetailsV1 memory details = REGISTRY.launchDetails(launchId);
        if (details.providerId == bytes32(0)) revert ExecutionPolicyUnauthorized(msg.sender, launchId);
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryStateV1 memory factory =
            PARTNER_FACTORY_REGISTRY.factoryState(details.configurationHash);
        if (
            factory.factory != msg.sender || factory.providerId != details.providerId
                || factory.modelId != details.modelId || factory.modelVersion != details.modelVersion
                || factory.templateId != details.templateId || factory.templateVersion != details.templateVersion
                || factory.launchRuntimeCodeSetHash != details.runtimeCodeSetHash
                || factory.permissionsHash != details.permissionsHash || factory.feePolicyHash != state.feePolicyHash
        ) revert ExecutionPolicyUnauthorized(msg.sender, launchId);

        PARTNER_FACTORY_REGISTRY.validateRegistration(
            msg.sender,
            IProgrammableCustomPartnerFactoryRegistryV1.RegistrationContextV1({
                configurationHash: details.configurationHash,
                providerId: details.providerId,
                modelId: details.modelId,
                modelVersion: details.modelVersion,
                templateId: details.templateId,
                templateVersion: details.templateVersion,
                modelRepositoryId: factory.modelRepositoryId,
                modelSourceCommitId: factory.modelSourceCommitId,
                launchRuntimeCodeSetHash: details.runtimeCodeSetHash,
                permissionsHash: details.permissionsHash,
                feePolicyHash: state.feePolicyHash
            })
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
