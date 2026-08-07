// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProgrammableCustomAtomicRegistrarV2 } from "../src/ProgrammableCustomAtomicRegistrarV2.sol";
import { ProgrammableCustomTradeCapabilityLibV1 } from "../src/ProgrammableCustomTradeCapabilityLibV1.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "../src/interfaces/IProgrammableCustomExecutionPolicyV2.sol";

contract ProgrammableCustomTradeCapabilityGoldenVectorsV1Test is Test {
    bytes32 private constant ROUTE_HASH = 0x7a08fd2947d6bc608810c73c394e83fa167f1eb97ef444219c2eeee6af97d8a7;
    bytes32 private constant ROUTE_SET_HASH = 0xc127cd6895a9ef52b5f08d58df15c8b98611eb6e82f62d7c6c46c14aa0ebf509;
    bytes32 private constant MARKET_SET_HASH = 0x2979e28b64b2675345eaea3c8f9d799f79debb4c256e333cd0d6bff7b7b923bf;
    bytes32 private constant EMPTY_MARKET_SET_HASH = 0xbd6f28a96b79921f21d91177e262ccb903f8cee746201feb41bcd74385ae3eef;
    bytes32 private constant DIRECT_SOURCE_HASH = 0x0f999087bd83dfdce9269c6088f5f1963d40bc0794efd9a8167063d9f6eb99d2;
    bytes32 private constant PROXY_SOURCE_HASH = 0xc0602839191feb9f99d0612184f24a74d99cf944285782bb9dc4d8ca8f1ea463;
    bytes32 private constant SOURCE_SET_HASH = 0xdeb3a95d17922e5a2e1f7e0ae834415725e5fb6d13bd041a52563cd914405d98;
    bytes32 private constant CAPABILITY_HASH = 0x772dad1715e737c3e8f7390576869606dc6a8608fe0e4b0fd7a46e4a16cc32d8;
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
            bytes4(0x0ae882ed)
        );
        assertEq(IProgrammableCustomExecutionPolicyV2.bindTradeCapabilityV1.selector, bytes4(0x4eb3cb48));
        _assertEventVectors(route, directSource, capability);
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
                "CustomLaunchMarketDataSourceBoundV2(bytes32,bytes32,uint32,bytes32,bytes32,uint8,address,bytes32,uint64,bytes32,bytes32,bytes32)"
            ),
            0xe64b9e53b8e5c278f41e9302d9f341e9006bfa3b4c3c919d4983696478d130a0
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
            0x015cfedc2c4bc5f1a7d4237b2a1f245fd51da8a9797deadabbe482ec3bc6f6cd
        );
        bytes32 proxyBindingHash = keccak256(
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
            0xd896fa8e82fe80ea13742d282bfd9e08e135faaca135778bf8e08956a985d577
        );
        bytes32 sourceIdentityHash = keccak256(
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
                    source.configurationHash,
                    DIRECT_SOURCE_HASH
                )
            ),
            0x5e95ade9a11ca18b4a27d34fd102952477a2d755b09da264ac1c36006b49c6be
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
        source.topic0 = bytes32(uint256(102));
        source.eventAbiHash = bytes32(uint256(103));
        source.filterHash = bytes32(uint256(104));
        source.metricsHash = DIRECT_METRIC_SET_HASH;
        source.derivationPolicyHash = bytes32(uint256(106));
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
        source.implementation = address(0x88);
        source.implementationRuntimeCodeHash = bytes32(uint256(201));
        source.admin = address(0x99);
        source.adminRuntimeCodeHash = bytes32(uint256(202));
        source.startBlock = 200;
        source.filterHash = bytes32(uint256(203));
        source.metricsHash = PROXY_METRIC_SET_HASH;
        source.derivationPolicyHash = bytes32(uint256(205));
        source.stateView = address(0xaa);
        source.stateViewRuntimeCodeHash = bytes32(uint256(206));
        source.readSelector = 0xabcdef01;
        source.configurationHash = bytes32(uint256(207));
        source.evidenceHash = bytes32(uint256(208));
    }
}
