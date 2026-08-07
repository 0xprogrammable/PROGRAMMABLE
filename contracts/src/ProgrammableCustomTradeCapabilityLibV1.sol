// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCustomExecutionPolicyV2 } from "./interfaces/IProgrammableCustomExecutionPolicyV2.sol";

library ProgrammableCustomTradeCapabilityLibV1 {
    uint256 internal constant MAX_ROUTE_COUNT = 256;
    uint256 internal constant MAX_MARKET_DATA_SOURCE_COUNT = 256;
    uint256 internal constant MAX_MARKET_DATA_METRIC_COUNT = 256;

    bytes32 internal constant TRADE_CAPABILITY_DOMAIN = keccak256("programmable.trade-capability.v1");
    bytes32 internal constant TRADE_ROUTE_DOMAIN = keccak256("programmable.trade-route.v1");
    bytes32 internal constant TRADE_ROUTE_SET_DOMAIN = keccak256("programmable.trade-route-set.v1");
    bytes32 internal constant MARKET_DATA_SOURCE_DOMAIN = keccak256("programmable.market-data-source.v1");
    bytes32 internal constant MARKET_DATA_SOURCE_SET_DOMAIN = keccak256("programmable.market-data-source-set.v1");
    bytes32 internal constant MARKET_DATA_METRIC_SET_DOMAIN = keccak256("programmable.market-data-metric-set.v1");
    bytes32 internal constant MARKET_IDENTITY_DOMAIN = keccak256("programmable.trade-market-identity.v1");
    bytes32 internal constant MARKET_SET_DOMAIN = keccak256("programmable.trade-market-set.v1");

    error InvalidMarketDataSourceOrder(uint256 index);
    error InvalidMarketDataMetricOrder(uint256 index);
    error InvalidTradeRouteOrder(uint256 index);
    error MarketDataSourceSetHashMismatch(bytes32 supplied, bytes32 actual);
    error SetTooLarge(bytes32 set, uint256 supplied, uint256 maximum);
    error TradeRouteSetHashMismatch(bytes32 supplied, bytes32 actual);

    function routeHash(IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route) internal pure returns (bytes32) {
        return keccak256(abi.encode(TRADE_ROUTE_DOMAIN, route));
    }

    function routeSetHash(IProgrammableCustomExecutionPolicyV2.TradeRouteV1[] memory routes)
        internal
        pure
        returns (bytes32)
    {
        if (routes.length > MAX_ROUTE_COUNT) {
            revert SetTooLarge(bytes32("routes"), routes.length, MAX_ROUTE_COUNT);
        }
        bytes32[] memory routeHashes = new bytes32[](routes.length);
        for (uint256 index; index < routes.length; index++) {
            routeHashes[index] = routeHash(routes[index]);
            if (
                index != 0
                    && !_strictlyOrdered(routes[index - 1], routes[index], routeHashes[index - 1], routeHashes[index])
            ) {
                revert InvalidTradeRouteOrder(index);
            }
        }
        return keccak256(abi.encode(TRADE_ROUTE_SET_DOMAIN, routeHashes));
    }

    function marketDataSourceHash(IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory source)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(MARKET_DATA_SOURCE_DOMAIN, source));
    }

    function marketDataMetricSetHash(bytes32[] memory metricIds) internal pure returns (bytes32) {
        if (metricIds.length == 0) revert InvalidMarketDataMetricOrder(0);
        if (metricIds.length > MAX_MARKET_DATA_METRIC_COUNT) {
            revert SetTooLarge(bytes32("market-data-metrics"), metricIds.length, MAX_MARKET_DATA_METRIC_COUNT);
        }
        for (uint256 index; index < metricIds.length; index++) {
            if (metricIds[index] == bytes32(0) || (index != 0 && metricIds[index - 1] >= metricIds[index])) {
                revert InvalidMarketDataMetricOrder(index);
            }
        }
        return keccak256(abi.encode(MARKET_DATA_METRIC_SET_DOMAIN, metricIds));
    }

    function marketSetHash(IProgrammableCustomExecutionPolicyV2.TradeRouteV1[] memory routes)
        internal
        pure
        returns (bytes32)
    {
        if (routes.length > MAX_ROUTE_COUNT) {
            revert SetTooLarge(bytes32("routes"), routes.length, MAX_ROUTE_COUNT);
        }
        bytes32[] memory markets = new bytes32[](routes.length);
        uint256 marketCount;
        bytes32 previousMarketId;
        bytes32 previousMarketPathId;
        bytes32 previousRouteHash;
        for (uint256 index; index < routes.length; index++) {
            bytes32 currentRouteHash = routeHash(routes[index]);
            if (index != 0 && !_strictlyOrdered(routes[index - 1], routes[index], previousRouteHash, currentRouteHash)) revert InvalidTradeRouteOrder(index);
            if (
                index == 0 || routes[index].marketId != previousMarketId
                    || routes[index].marketPathId != previousMarketPathId
            ) {
                markets[marketCount++] = keccak256(
                    abi.encode(MARKET_IDENTITY_DOMAIN, routes[index].marketId, routes[index].marketPathId)
                );
                previousMarketId = routes[index].marketId;
                previousMarketPathId = routes[index].marketPathId;
            }
            previousRouteHash = currentRouteHash;
        }
        assembly ("memory-safe") {
            mstore(markets, marketCount)
        }
        return keccak256(abi.encode(MARKET_SET_DOMAIN, markets));
    }

    function marketDataSourceSetHash(IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[] memory sources)
        internal
        pure
        returns (bytes32)
    {
        if (sources.length > MAX_MARKET_DATA_SOURCE_COUNT) {
            revert SetTooLarge(bytes32("market-data-sources"), sources.length, MAX_MARKET_DATA_SOURCE_COUNT);
        }
        bytes32[] memory sourceHashes = new bytes32[](sources.length);
        for (uint256 index; index < sources.length; index++) {
            sourceHashes[index] = marketDataSourceHash(sources[index]);
            if (
                index != 0
                    && !_strictlyOrderedSource(
                        sources[index - 1], sources[index], sourceHashes[index - 1], sourceHashes[index]
                    )
            ) revert InvalidMarketDataSourceOrder(index);
        }
        return keccak256(abi.encode(MARKET_DATA_SOURCE_SET_DOMAIN, sourceHashes));
    }

    function capabilityHash(IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability)
        internal
        pure
        returns (bytes32)
    {
        bytes32 actualRouteSetHash = routeSetHash(capability.routes);
        if (capability.routeSetHash != actualRouteSetHash) {
            revert TradeRouteSetHashMismatch(capability.routeSetHash, actualRouteSetHash);
        }
        bytes32 actualMarketDataSourceSetHash = marketDataSourceSetHash(capability.marketDataSources);
        if (capability.marketDataSourceSetHash != actualMarketDataSourceSetHash) {
            revert MarketDataSourceSetHashMismatch(capability.marketDataSourceSetHash, actualMarketDataSourceSetHash);
        }
        return keccak256(
            abi.encode(
                TRADE_CAPABILITY_DOMAIN,
                capability.chainId,
                capability.registryGeneration,
                capability.launchId,
                capability.marketSetHash,
                capability.executionEnabled,
                capability.routeSetHash,
                uint32(capability.routes.length),
                capability.marketDataSourceSetHash,
                uint32(capability.marketDataSources.length),
                capability.evidenceHash,
                capability.revocationPolicyHash
            )
        );
    }

    function _strictlyOrdered(
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory left,
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory right,
        bytes32 leftHash,
        bytes32 rightHash
    ) private pure returns (bool) {
        if (left.marketId != right.marketId) return uint256(left.marketId) < uint256(right.marketId);
        if (left.marketPathId != right.marketPathId) return uint256(left.marketPathId) < uint256(right.marketPathId);
        if (left.mode != right.mode) return uint8(left.mode) < uint8(right.mode);
        if (left.executionTarget != right.executionTarget) {
            return uint160(left.executionTarget) < uint160(right.executionTarget);
        }
        if (left.adapterId != right.adapterId) return uint256(left.adapterId) < uint256(right.adapterId);
        if (left.executionSelector != right.executionSelector) {
            return uint32(left.executionSelector) < uint32(right.executionSelector);
        }
        if (left.configurationHash != right.configurationHash) {
            return uint256(left.configurationHash) < uint256(right.configurationHash);
        }
        return uint256(leftHash) < uint256(rightHash);
    }

    function _strictlyOrderedSource(
        IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory left,
        IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory right,
        bytes32 leftHash,
        bytes32 rightHash
    ) private pure returns (bool) {
        if (left.marketId != right.marketId) return uint256(left.marketId) < uint256(right.marketId);
        if (left.sourceId != right.sourceId) return uint256(left.sourceId) < uint256(right.sourceId);
        if (left.kind != right.kind) return uint8(left.kind) < uint8(right.kind);
        if (left.emitter != right.emitter) return uint160(left.emitter) < uint160(right.emitter);
        if (left.stateView != right.stateView) return uint160(left.stateView) < uint160(right.stateView);
        if (left.configurationHash != right.configurationHash) {
            return uint256(left.configurationHash) < uint256(right.configurationHash);
        }
        return uint256(leftHash) < uint256(rightHash);
    }
}
