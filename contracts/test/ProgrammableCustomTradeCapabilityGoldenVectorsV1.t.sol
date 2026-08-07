// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProgrammableCustomAtomicRegistrarV2 } from "../src/ProgrammableCustomAtomicRegistrarV2.sol";
import { ProgrammableCustomTradeCapabilityLibV1 } from "../src/ProgrammableCustomTradeCapabilityLibV1.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "../src/interfaces/IProgrammableCustomExecutionPolicyV2.sol";

contract ProgrammableCustomTradeCapabilityGoldenVectorsV1Test is Test {
    bytes32 private constant ROUTE_HASH = 0xdab317aad3c8bf77f43037ec10b87153b0fdf8c07b9155597cf616fb53cd1ff5;
    bytes32 private constant ROUTE_SET_HASH = 0x673c04857c9dea03a98c34d171cd4939e40dfe7890ed44ca69073acc21793d64;
    bytes32 private constant MARKET_SET_HASH = 0x2979e28b64b2675345eaea3c8f9d799f79debb4c256e333cd0d6bff7b7b923bf;
    bytes32 private constant EMPTY_MARKET_SET_HASH = 0xbd6f28a96b79921f21d91177e262ccb903f8cee746201feb41bcd74385ae3eef;
    bytes32 private constant DIRECT_SOURCE_HASH = 0xad7716fceb70c098f56f95fedcafed340954650f32a4f1b6bcfd518490b487de;
    bytes32 private constant PROXY_SOURCE_HASH = 0xd2029f210425831d5442bde7f0a37f5968ced7b56e10f4d2a967cc4744a369a3;
    bytes32 private constant SOURCE_SET_HASH = 0x1049e07a90dd575cd46c1184c77c2feb30118e50ae42f00a8afe6214606dc8df;
    bytes32 private constant CAPABILITY_HASH = 0x19a4c583304c9a59eb6239f660bd188f88fb9116d87d79e131054a0d8d98340b;
    bytes32 private constant DIRECT_METRIC_SET_HASH =
        0xf3e9aada876355d21cdbbc03cecd9c9d23f2a8a3ef9644a6d38c21fd05650eaf;
    bytes32 private constant PROXY_METRIC_SET_HASH = 0x6e54d472f4b24c9c2c54eb7f582349bca14e21dce5c2ecfe345a75ce1a34dccd;
    bytes32 private constant EMPTY_METRIC_SET_HASH = 0x7b5384e78f1bd4310c1264ebe06d19b2fc61f8ff2781748daa2e14df0387082a;
    bytes32 private constant REVOCATION_POLICY = 0x1544379a9cb3a1e46b22e31cc01d03cb06871847f78ee5673827a928f158e642;

    function test_hashSelectorsTopicsAndEventDataMatchPublishedGoldenVectors() public pure {
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route = _route();
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1[] memory routes =
            new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](1);
        routes[0] = route;
        assertEq(ProgrammableCustomTradeCapabilityLibV1.routeHash(route), ROUTE_HASH);
        assertEq(ProgrammableCustomTradeCapabilityLibV1.routeSetHash(routes), ROUTE_SET_HASH);
        assertEq(ProgrammableCustomTradeCapabilityLibV1.marketSetHash(routes), MARKET_SET_HASH);
        assertEq(
            ProgrammableCustomTradeCapabilityLibV1.marketSetHash(
                new IProgrammableCustomExecutionPolicyV2.TradeRouteV1[](0)
            ),
            EMPTY_MARKET_SET_HASH
        );

        bytes32[] memory directMetricIds = new bytes32[](4);
        directMetricIds[0] = keccak256("programmable.market-data-metric.charting.v1");
        directMetricIds[1] = keccak256("programmable.market-data-metric.price.v1");
        directMetricIds[2] = keccak256("programmable.market-data-metric.volume.v1");
        directMetricIds[3] = keccak256("programmable.market-data-metric.liquidity.v1");
        assertEq(
            ProgrammableCustomTradeCapabilityLibV1.marketDataMetricSetHash(directMetricIds), DIRECT_METRIC_SET_HASH
        );
        bytes32[] memory proxyMetricIds = new bytes32[](2);
        proxyMetricIds[0] = directMetricIds[1];
        proxyMetricIds[1] = directMetricIds[3];
        assertEq(ProgrammableCustomTradeCapabilityLibV1.marketDataMetricSetHash(proxyMetricIds), PROXY_METRIC_SET_HASH);
        assertEq(
            keccak256(abi.encode(keccak256("programmable.market-data-metric-set.v1"), new bytes32[](0))),
            EMPTY_METRIC_SET_HASH
        );

        IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory directSource = _directSource();
        IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory proxySource = _proxySource();
        IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[] memory sources =
            new IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1[](2);
        sources[0] = directSource;
        sources[1] = proxySource;
        assertEq(ProgrammableCustomTradeCapabilityLibV1.marketDataSourceHash(directSource), DIRECT_SOURCE_HASH);
        assertEq(ProgrammableCustomTradeCapabilityLibV1.marketDataSourceHash(proxySource), PROXY_SOURCE_HASH);
        assertEq(ProgrammableCustomTradeCapabilityLibV1.marketDataSourceSetHash(sources), SOURCE_SET_HASH);

        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1({
                chainId: 1,
                registryGeneration: 2,
                launchId: bytes32(uint256(300)),
                marketSetHash: MARKET_SET_HASH,
                executionEnabled: true,
                routeSetHash: ROUTE_SET_HASH,
                routes: routes,
                marketDataSourceSetHash: SOURCE_SET_HASH,
                marketDataSources: sources,
                evidenceHash: bytes32(uint256(301)),
                revocationPolicyHash: REVOCATION_POLICY
            });
        assertEq(ProgrammableCustomTradeCapabilityLibV1.capabilityHash(capability), CAPABILITY_HASH);

        assertEq(
            ProgrammableCustomAtomicRegistrarV2.deployInitializeRegisterAndBindTradeCapabilityV1.selector,
            bytes4(0x02562444)
        );
        assertEq(IProgrammableCustomExecutionPolicyV2.bindTradeCapabilityV1.selector, bytes4(0x515b4f17));
        _assertEventVectors(route, directSource, capability);
    }

    function test_marketEventFilterAndDerivationPreimagesMatchPublishedGoldenVectors() public pure {
        bytes32 eventAbiDomain = keccak256("programmable.market-event-abi.v1");
        bytes32 filterDomain = keccak256("programmable.market-event-filter.v1");
        bytes32 derivationDomain = keccak256("programmable.market-data-derivation.v1");
        bytes32 topic0 = keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
        assertEq(topic0, 0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f);
        assertEq(
            keccak256(abi.encode(eventAbiDomain, topic0, bytes32(uint256(500)), bytes32(uint256(501)))),
            0x1f78f08e9f5b4cc333d23763649077ecf88c57fc71d45bc351e5041ecabf7ec7
        );
        bytes32[] memory indexedValues = new bytes32[](2);
        indexedValues[0] = bytes32(uint256(4));
        indexedValues[1] = bytes32(uint256(5));
        assertEq(
            keccak256(
                abi.encode(
                    filterDomain,
                    bytes32(uint256(1)),
                    bytes32(uint256(2)),
                    bytes32(uint256(3)),
                    address(0x11),
                    indexedValues,
                    bytes32(uint256(6))
                )
            ),
            0x0c1fb95e388d80a8e44f4385b55c6a0ca53f81c34fa4339ae3b246dccf6b1887
        );
        assertEq(
            keccak256(
                abi.encode(
                    derivationDomain,
                    DIRECT_METRIC_SET_HASH,
                    bytes32(uint256(7)),
                    bytes32(uint256(8)),
                    bytes32(uint256(9))
                )
            ),
            0xafa2d5423e506aa7bfd536bbfd10eb2fec4b23219557a053af7be2a52019c330
        );
    }

    function _assertEventVectors(
        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route,
        IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory source,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability
    ) private pure {
        assertEq(
            keccak256(
                "CustomLaunchExecutionPolicyBoundV2(bytes32,bytes32,bytes32,bytes32,uint32,bytes32,uint32,bool,bytes32,bytes32)"
            ),
            0x9b151aeb52499c57b4f540b411ff14ac2e34ac01334f7e2461a3f2f4e5b5d93f
        );
        assertEq(
            keccak256(
                "CustomLaunchExecutionRouteBoundV2(bytes32,bytes32,uint32,bytes32,bytes32,uint8,bytes32,address,bytes32,bytes32,bytes32,bytes32,bytes32)"
            ),
            0xf0763dea7eac2631823ece83bf0eceef82bff47840141315afa3d3eb002c8a19
        );
        assertEq(
            keccak256(
                "CustomLaunchMarketDataSourceBoundV2(bytes32,bytes32,uint32,bytes32,bytes32,uint8,address,bytes32,uint64,bytes32,bytes32,bytes32,bytes32)"
            ),
            0xb3f02634ec5cdde695d4b565d9498b0aa4aa7522fe160df1b07eb425738c9292
        );
        assertEq(
            keccak256("CustomLaunchMarketDataMetricsBoundV2(bytes32,bytes32,uint32,bytes32,bytes32[])"),
            0xaf2c4521ed669ee0b31f567d3fe62ea93314a5d0554993310bbe1f9d2a4ca00b
        );

        assertEq(
            keccak256(
                abi.encode(
                    MARKET_SET_HASH,
                    uint32(1),
                    SOURCE_SET_HASH,
                    uint32(2),
                    true,
                    capability.evidenceHash,
                    capability.revocationPolicyHash
                )
            ),
            0x29caa7fe0668f67fc706ac47c11824f16b8a271d3993faf35b38a3c38da21677
        );
        bytes32 proxyBindingHash = keccak256(
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
        assertEq(
            keccak256(
                abi.encode(
                    route.marketId,
                    route.marketPathId,
                    uint8(route.mode),
                    route.adapterId,
                    route.executionTarget,
                    route.executionTargetRuntimeCodeHash,
                    route.configurationHash,
                    route.dependencyRuntimeCodeSetHash,
                    proxyBindingHash,
                    ROUTE_HASH
                )
            ),
            0x330240f50786e2cdc39fad8aaf9e97fa6df4d64f3df124717873266035d7e96d
        );
        bytes32 sourceProxyBindingHash = keccak256(
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
        bytes32 sourceIdentityHash = keccak256(
            abi.encode(
                source.topic0,
                source.eventAbiHash,
                source.filterHash,
                source.metricsHash,
                source.derivationPolicyHash,
                source.readSelector,
                sourceProxyBindingHash
            )
        );
        assertEq(
            keccak256(
                abi.encode(
                    source.marketId,
                    source.sourceId,
                    uint8(source.kind),
                    source.emitter,
                    source.emitterRuntimeCodeHash,
                    source.startBlock,
                    sourceIdentityHash,
                    source.metricsHash,
                    source.configurationHash,
                    DIRECT_SOURCE_HASH
                )
            ),
            0xfc9f2a5e8e7a70a28beb0de3510bfd824c5dd1ebd396dffd368385a5a40b2f99
        );
    }

    function _route() private pure returns (IProgrammableCustomExecutionPolicyV2.TradeRouteV1 memory route) {
        route.marketId = bytes32(uint256(1));
        route.marketPathId = bytes32(uint256(2));
        route.mode = IProgrammableCustomExecutionPolicyV2.TradeExecutionModeV1.Standard;
        route.activationBlock = 100;
        route.executionTarget = address(0x11);
        route.executionTargetRuntimeCodeHash = bytes32(uint256(3));
        route.executionSelector = 0x12345678;
        route.interfaceId = 0x87654321;
        route.poolManager = address(0x22);
        route.poolManagerRuntimeCodeHash = bytes32(uint256(4));
        route.permit2 = address(0x33);
        route.permit2RuntimeCodeHash = bytes32(uint256(5));
        route.quoteSupported = true;
        route.simulationSupported = true;
        route.quoter = address(0x44);
        route.quoterRuntimeCodeHash = bytes32(uint256(6));
        route.readSupported = true;
        route.stateView = address(0x55);
        route.stateViewRuntimeCodeHash = bytes32(uint256(7));
        route.hook = address(0x66);
        route.hookRuntimeCodeHash = bytes32(uint256(8));
        route.hookPermissionsHash = bytes32(uint256(9));
        route.hookReviewEvidenceHash = bytes32(uint256(10));
        route.callerAllowlistHash = bytes32(uint256(11));
        route.plannerCommandPolicyHash = bytes32(uint256(12));
        route.hookDataPolicyHash = bytes32(uint256(13));
        route.calldataPolicyHash = bytes32(uint256(14));
        route.valuePolicyHash = bytes32(uint256(15));
        route.recipientPolicyHash = bytes32(uint256(16));
        route.deadlinePolicyHash = bytes32(uint256(17));
        route.slippagePolicyHash = bytes32(uint256(18));
        route.permit2PolicyHash = bytes32(uint256(19));
        route.deltaAccountingPolicyHash = bytes32(uint256(20));
        route.settlementPolicyHash = bytes32(uint256(21));
        route.nonstandardTokenPolicyHash = bytes32(uint256(22));
        route.dependencyRuntimeCodeSetHash = bytes32(uint256(23));
        route.configurationHash = bytes32(uint256(24));
        route.evidenceHash = bytes32(uint256(25));
    }

    function _directSource()
        private
        pure
        returns (IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory source)
    {
        source.marketId = bytes32(uint256(1));
        source.sourceId = bytes32(uint256(100));
        source.kind = IProgrammableCustomExecutionPolicyV2.MarketDataSourceKindV1.Event;
        source.emitter = address(0x77);
        source.emitterRuntimeCodeHash = bytes32(uint256(101));
        source.startBlock = 99;
        source.topic0 = 0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f;
        source.eventAbiHash = 0x1f78f08e9f5b4cc333d23763649077ecf88c57fc71d45bc351e5041ecabf7ec7;
        source.filterHash = 0x0c1fb95e388d80a8e44f4385b55c6a0ca53f81c34fa4339ae3b246dccf6b1887;
        source.metricsHash = DIRECT_METRIC_SET_HASH;
        source.metricIds = new bytes32[](4);
        source.metricIds[0] = keccak256("programmable.market-data-metric.charting.v1");
        source.metricIds[1] = keccak256("programmable.market-data-metric.price.v1");
        source.metricIds[2] = keccak256("programmable.market-data-metric.volume.v1");
        source.metricIds[3] = keccak256("programmable.market-data-metric.liquidity.v1");
        source.derivationPolicyHash = 0xafa2d5423e506aa7bfd536bbfd10eb2fec4b23219557a053af7be2a52019c330;
        source.configurationHash = bytes32(uint256(107));
        source.evidenceHash = bytes32(uint256(108));
    }

    function _proxySource()
        private
        pure
        returns (IProgrammableCustomExecutionPolicyV2.MarketDataSourceV1 memory source)
    {
        source.marketId = bytes32(uint256(1));
        source.sourceId = bytes32(uint256(200));
        source.kind = IProgrammableCustomExecutionPolicyV2.MarketDataSourceKindV1.StateRead;
        source.proxy = true;
        source.proxyKind = IProgrammableCustomExecutionPolicyV2.ProxyKindV1.Eip1967Admin;
        source.proxyBindingEvidenceHash = bytes32(uint256(209));
        source.proxyPolicyHash = bytes32(uint256(210));
        source.implementation = address(0x88);
        source.implementationRuntimeCodeHash = bytes32(uint256(201));
        source.admin = address(0x99);
        source.adminRuntimeCodeHash = bytes32(uint256(202));
        source.startBlock = 200;
        source.filterHash = bytes32(uint256(203));
        source.metricsHash = PROXY_METRIC_SET_HASH;
        source.metricIds = new bytes32[](2);
        source.metricIds[0] = keccak256("programmable.market-data-metric.price.v1");
        source.metricIds[1] = keccak256("programmable.market-data-metric.liquidity.v1");
        source.derivationPolicyHash = bytes32(uint256(205));
        source.stateView = address(0xaa);
        source.stateViewRuntimeCodeHash = bytes32(uint256(206));
        source.readSelector = 0xabcdef01;
        source.configurationHash = bytes32(uint256(207));
        source.evidenceHash = bytes32(uint256(208));
    }
}
