// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProgrammableCustomTradeCapabilityLibV1 } from "./ProgrammableCustomTradeCapabilityLibV1.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "./interfaces/IProgrammableCustomExecutionPolicyV2.sol";

library ProgrammableCustomTradeCapabilityValidatorV1 {
    bytes32 internal constant TRADE_REVOCATION_POLICY =
        keccak256("programmable.trade-capability.runtime-drift-revokes-execution.v1");
    bytes32 internal constant SYNC_TRANSFER_SETTLE_POLICY =
        keccak256("programmable.v4.settlement.sync-transfer-settle.v1");
    bytes32 internal constant EMPTY_MARKET_DATA_METRIC_SET_HASH =
        0x7b5384e78f1bd4310c1264ebe06d19b2fc61f8ff2781748daa2e14df0387082a;
    error InvalidMarketDataSource(bytes32 field, uint256 index);
    error InvalidTradeCapability(bytes32 field, uint256 index);
    error RuntimeCodeHashMismatch(address target, bytes32 supplied, bytes32 actual);

    function validate(
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability,
        uint256 chainId,
        uint64 registryGeneration
    ) internal view returns (bytes32 capabilityHash) {
        if (
            capability.chainId != chainId || capability.registryGeneration != registryGeneration
                || capability.launchId == bytes32(0) || capability.marketSetHash == bytes32(0)
                || capability.evidenceHash == bytes32(0) || capability.revocationPolicyHash != TRADE_REVOCATION_POLICY
        ) revert InvalidTradeCapability(bytes32("scope"), type(uint256).max);

        bytes32 actualMarketSetHash = ProgrammableCustomTradeCapabilityLibV1.marketSetHash(capability.routes);
        if (
            capability.marketSetHash != actualMarketSetHash
                || (capability.routes.length == 0 && capability.marketDataSources.length != 0)
        ) revert InvalidTradeCapability(bytes32("market-set"), type(uint256).max);

        capabilityHash = ProgrammableCustomTradeCapabilityLibV1.capabilityHash(capability);
        bool hasActiveExecutableRoute;
        for (uint256 index; index < capability.routes.length; index++) {
            IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route = capability.routes[index];
            if (
                route.marketId == bytes32(0) || route.marketPathId == bytes32(0) || route.activationBlock == 0
                    || route.evidenceHash == bytes32(0)
            ) revert InvalidTradeCapability(bytes32("route-identity"), index);
            if (route.mode == IProgrammableCustomExecutionPolicyV2.TradeExecutionModeV1.Unsupported) {
                _validateUnsupportedRoute(route, index);
            } else {
                _validateExecutableRoute(route, index);
                if (!route.paused && !route.retired && route.activationBlock <= block.number) {
                    hasActiveExecutableRoute = true;
                }
            }
        }
        if (capability.executionEnabled != hasActiveExecutableRoute) {
            revert InvalidTradeCapability(bytes32("execution-enabled"), type(uint256).max);
        }

        for (uint256 index; index < capability.marketDataSources.length; index++) {
            IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory source = capability.marketDataSources[index];
            if (!_marketExists(capability.routes, source.marketId)) {
                revert InvalidMarketDataSource(bytes32("unknown-market"), index);
            }
            _validateMarketDataSource(source, index);
        }
    }

    function _validateUnsupportedRoute(IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route, uint256 index)
        private
        view
    {
        if (
            route.adapterId != bytes32(0) || route.adapterVersion != bytes32(0) || route.executionTarget != address(0)
                || route.executionTargetRuntimeCodeHash != bytes32(0) || route.proxy
                || route.implementation != address(0) || route.implementationRuntimeCodeHash != bytes32(0)
                || route.admin != address(0) || route.adminRuntimeCodeHash != bytes32(0)
                || route.executionSelector != bytes4(0) || route.interfaceId != bytes4(0)
                || route.poolManager != address(0) || route.poolManagerRuntimeCodeHash != bytes32(0)
                || route.permit2 != address(0) || route.permit2RuntimeCodeHash != bytes32(0)
                || route.beforeSwapReturnDeltaEnabled || route.callerAllowlistHash != bytes32(0)
                || route.plannerCommandPolicyHash != bytes32(0) || route.hookDataPolicyHash != bytes32(0)
                || route.calldataPolicyHash != bytes32(0) || route.valuePolicyHash != bytes32(0)
                || route.recipientPolicyHash != bytes32(0) || route.deadlinePolicyHash != bytes32(0)
                || route.slippagePolicyHash != bytes32(0) || route.permit2PolicyHash != bytes32(0)
                || route.deltaAccountingPolicyHash != bytes32(0) || route.settlementPolicyHash != bytes32(0)
                || route.nonstandardTokenPolicyHash != bytes32(0) || route.dependencyRuntimeCodeSetHash != bytes32(0)
                || route.configurationHash != bytes32(0)
        ) revert InvalidTradeCapability(bytes32("unsupported"), index);

        _validateReadCapability(
            route.quoteSupported || route.simulationSupported, route.quoter, route.quoterRuntimeCodeHash, index
        );
        _validateReadCapability(route.readSupported, route.stateView, route.stateViewRuntimeCodeHash, index);
        _validateHookCapability(route, index);
    }

    function _validateExecutableRoute(IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route, uint256 index)
        private
        view
    {
        if (
            route.executionSelector == bytes4(0) || route.interfaceId == bytes4(0)
                || route.callerAllowlistHash == bytes32(0) || route.plannerCommandPolicyHash == bytes32(0)
                || route.hookDataPolicyHash == bytes32(0) || route.calldataPolicyHash == bytes32(0)
                || route.valuePolicyHash == bytes32(0) || route.recipientPolicyHash == bytes32(0)
                || route.deadlinePolicyHash == bytes32(0) || route.slippagePolicyHash == bytes32(0)
                || route.permit2PolicyHash == bytes32(0) || route.deltaAccountingPolicyHash == bytes32(0)
                || route.settlementPolicyHash == bytes32(0) || route.nonstandardTokenPolicyHash == bytes32(0)
                || route.dependencyRuntimeCodeSetHash == bytes32(0) || route.configurationHash == bytes32(0)
        ) revert InvalidTradeCapability(bytes32("execution-policy"), index);

        _requireRuntime(route.executionTarget, route.executionTargetRuntimeCodeHash, bytes32("execution-target"));
        if (route.executionTarget == route.poolManager) {
            revert InvalidTradeCapability(bytes32("direct-pool-manager"), index);
        }

        if (route.mode == IProgrammableCustomExecutionPolicyV2.TradeExecutionModeV1.Standard) {
            if (
                route.adapterId != bytes32(0) || route.adapterVersion != bytes32(0) || route.proxy
                    || route.implementation != address(0) || route.implementationRuntimeCodeHash != bytes32(0)
                    || route.admin != address(0) || route.adminRuntimeCodeHash != bytes32(0)
                    || route.poolManager == address(0) || route.permit2 == address(0)
                    || route.settlementPolicyHash != SYNC_TRANSFER_SETTLE_POLICY
            ) revert InvalidTradeCapability(bytes32("standard"), index);
        } else if (route.mode == IProgrammableCustomExecutionPolicyV2.TradeExecutionModeV1.Adapter) {
            if (route.adapterId == bytes32(0) || route.adapterVersion == bytes32(0)) {
                revert InvalidTradeCapability(bytes32("adapter-identity"), index);
            }
            _validateAdapterImplementation(route, index);
        } else {
            revert InvalidTradeCapability(bytes32("mode"), index);
        }

        _requireOptionalRuntime(route.poolManager, route.poolManagerRuntimeCodeHash, bytes32("pool-manager"));
        _requireOptionalRuntime(route.permit2, route.permit2RuntimeCodeHash, bytes32("permit2"));
        _validateReadCapability(
            route.quoteSupported || route.simulationSupported, route.quoter, route.quoterRuntimeCodeHash, index
        );
        _validateReadCapability(route.readSupported, route.stateView, route.stateViewRuntimeCodeHash, index);
        _validateHookCapability(route, index);
    }

    function _validateAdapterImplementation(
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route,
        uint256 index
    ) private view {
        if (route.implementation == address(0)) {
            revert InvalidTradeCapability(bytes32("implementation"), index);
        }
        _requireRuntime(route.implementation, route.implementationRuntimeCodeHash, bytes32("implementation"));
        if (route.proxy) {
            if (route.implementation == route.executionTarget || route.admin == address(0)) {
                revert InvalidTradeCapability(bytes32("proxy"), index);
            }
            if (route.adminRuntimeCodeHash != bytes32(0)) {
                _requireRuntime(route.admin, route.adminRuntimeCodeHash, bytes32("admin"));
            }
        } else if (
            route.implementation != route.executionTarget
                || route.implementationRuntimeCodeHash != route.executionTargetRuntimeCodeHash
                || route.admin != address(0) || route.adminRuntimeCodeHash != bytes32(0)
        ) {
            revert InvalidTradeCapability(bytes32("non-proxy"), index);
        }
    }

    function _validateReadCapability(bool supported, address target, bytes32 runtimeCodeHash, uint256 index)
        private
        view
    {
        if (!supported) {
            if (target != address(0) || runtimeCodeHash != bytes32(0)) {
                revert InvalidTradeCapability(bytes32("disabled-read-target"), index);
            }
            return;
        }
        _requireRuntime(target, runtimeCodeHash, bytes32("read-target"));
    }

    function _validateHookCapability(IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route, uint256 index)
        private
        view
    {
        if (route.hook == address(0)) {
            if (
                route.hookRuntimeCodeHash != bytes32(0) || route.hookPermissionsHash != bytes32(0)
                    || route.hookReviewEvidenceHash != bytes32(0) || route.beforeSwapReturnDeltaEnabled
            ) revert InvalidTradeCapability(bytes32("hook"), index);
            return;
        }
        _requireRuntime(route.hook, route.hookRuntimeCodeHash, bytes32("hook"));
        if (route.hookPermissionsHash == bytes32(0) || route.hookReviewEvidenceHash == bytes32(0)) {
            revert InvalidTradeCapability(bytes32("hook-review"), index);
        }
        if (route.beforeSwapReturnDeltaEnabled && route.deltaAccountingPolicyHash == bytes32(0)) {
            revert InvalidTradeCapability(bytes32("before-swap-return-delta"), index);
        }
    }

    function _validateMarketDataSource(
        IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory source,
        uint256 index
    ) private view {
        if (
            source.marketId == bytes32(0) || source.sourceId == bytes32(0) || source.startBlock == 0
                || source.filterHash == bytes32(0) || source.metricsHash == bytes32(0)
                || source.metricsHash == EMPTY_MARKET_DATA_METRIC_SET_HASH || source.derivationPolicyHash == bytes32(0)
                || source.configurationHash == bytes32(0) || source.evidenceHash == bytes32(0)
        ) {
            revert InvalidMarketDataSource(bytes32("source-identity"), index);
        }

        if (source.kind == IProgrammableCustomExecutionPolicyV2.MarketDataSourceKindV1.Event) {
            if (
                source.topic0 == bytes32(0) || source.eventAbiHash == bytes32(0) || source.stateView != address(0)
                    || source.stateViewRuntimeCodeHash != bytes32(0) || source.readSelector != bytes4(0)
            ) revert InvalidMarketDataSource(bytes32("event-source"), index);
            _requireRuntime(source.emitter, source.emitterRuntimeCodeHash, bytes32("event-emitter"));
            _validateMarketDataSourceImplementation(source, source.emitter, source.emitterRuntimeCodeHash, index);
        } else if (source.kind == IProgrammableCustomExecutionPolicyV2.MarketDataSourceKindV1.StateRead) {
            if (
                source.emitter != address(0) || source.emitterRuntimeCodeHash != bytes32(0)
                    || source.topic0 != bytes32(0) || source.eventAbiHash != bytes32(0)
                    || source.readSelector == bytes4(0)
            ) revert InvalidMarketDataSource(bytes32("state-read-source"), index);
            _requireRuntime(source.stateView, source.stateViewRuntimeCodeHash, bytes32("state-view"));
            _validateMarketDataSourceImplementation(source, source.stateView, source.stateViewRuntimeCodeHash, index);
        } else {
            revert InvalidMarketDataSource(bytes32("source-kind"), index);
        }
    }

    function _validateMarketDataSourceImplementation(
        IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory source,
        address sourceTarget,
        bytes32 sourceTargetRuntimeCodeHash,
        uint256 index
    ) private view {
        if (!source.proxy) {
            if (
                source.implementation != address(0) || source.implementationRuntimeCodeHash != bytes32(0)
                    || source.admin != address(0) || source.adminRuntimeCodeHash != bytes32(0)
            ) revert InvalidMarketDataSource(bytes32("non-proxy"), index);
            return;
        }

        if (source.implementation == address(0) || source.implementation == sourceTarget || source.admin == address(0))
        {
            revert InvalidMarketDataSource(bytes32("proxy"), index);
        }
        _requireRuntime(source.implementation, source.implementationRuntimeCodeHash, bytes32("source-implementation"));
        if (source.adminRuntimeCodeHash != bytes32(0)) {
            _requireRuntime(source.admin, source.adminRuntimeCodeHash, bytes32("source-admin"));
        }

        // The proxy runtime remains independently bound even when implementation/admin identities are supplied.
        if (sourceTargetRuntimeCodeHash == bytes32(0)) {
            revert InvalidMarketDataSource(bytes32("source-target"), index);
        }
    }

    function _marketExists(IProgrammableCustomExecutionPolicyV2.TradeRouteV1[] memory routes, bytes32 marketId)
        private
        pure
        returns (bool)
    {
        for (uint256 index; index < routes.length; index++) {
            if (routes[index].marketId == marketId) return true;
        }
        return false;
    }

    function _requireOptionalRuntime(address target, bytes32 expected, bytes32 field) private view {
        if (target == address(0)) {
            if (expected != bytes32(0)) revert InvalidTradeCapability(field, type(uint256).max);
            return;
        }
        _requireRuntime(target, expected, field);
    }

    function _requireRuntime(address target, bytes32 expected, bytes32 field) private view {
        if (target == address(0) || target.code.length == 0 || expected == bytes32(0)) {
            revert InvalidTradeCapability(field, type(uint256).max);
        }
        bytes32 actual = target.codehash;
        if (actual != expected) revert RuntimeCodeHashMismatch(target, expected, actual);
    }
}
