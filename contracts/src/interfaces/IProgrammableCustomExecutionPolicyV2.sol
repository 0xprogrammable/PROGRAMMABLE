// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCustomRegistryV1 } from "./IProgrammableCustomRegistryV1.sol";

/// @notice Additive Generation 2 companion proof for exact launch trade and market-data capabilities.
/// @dev The frozen V1 launch events remain unchanged. A Generation 2 registration is publishable only when the
///      matching summary and all route/source companions occur in the same transaction as registration.
interface IProgrammableCustomExecutionPolicyV2 {
    enum TradeExecutionModeV1 {
        Unsupported,
        Standard,
        Adapter
    }

    enum MarketDataSourceKindV1 {
        Event,
        StateRead
    }

    struct TradeRouteV1 {
        bytes32 marketId;
        bytes32 marketPathId;
        TradeExecutionModeV1 mode;
        uint64 activationBlock;
        bool paused;
        bool retired;
        bytes32 adapterId;
        bytes32 adapterVersion;
        address executionTarget;
        bytes32 executionTargetRuntimeCodeHash;
        bool proxy;
        address implementation;
        bytes32 implementationRuntimeCodeHash;
        address admin;
        bytes32 adminRuntimeCodeHash;
        bytes4 executionSelector;
        bytes4 interfaceId;
        address poolManager;
        bytes32 poolManagerRuntimeCodeHash;
        address permit2;
        bytes32 permit2RuntimeCodeHash;
        bool quoteSupported;
        bool simulationSupported;
        address quoter;
        bytes32 quoterRuntimeCodeHash;
        bool readSupported;
        address stateView;
        bytes32 stateViewRuntimeCodeHash;
        address hook;
        bytes32 hookRuntimeCodeHash;
        bytes32 hookPermissionsHash;
        bytes32 hookReviewEvidenceHash;
        bool beforeSwapReturnDeltaEnabled;
        bytes32 callerAllowlistHash;
        bytes32 plannerCommandPolicyHash;
        bytes32 hookDataPolicyHash;
        bytes32 calldataPolicyHash;
        bytes32 valuePolicyHash;
        bytes32 recipientPolicyHash;
        bytes32 deadlinePolicyHash;
        bytes32 slippagePolicyHash;
        bytes32 permit2PolicyHash;
        bytes32 deltaAccountingPolicyHash;
        bytes32 settlementPolicyHash;
        bytes32 nonstandardTokenPolicyHash;
        bytes32 dependencyRuntimeCodeSetHash;
        bytes32 configurationHash;
        bytes32 evidenceHash;
    }

    struct MarketDataSourceV1 {
        bytes32 marketId;
        bytes32 sourceId;
        MarketDataSourceKindV1 kind;
        address emitter;
        bytes32 emitterRuntimeCodeHash;
        bool proxy;
        address implementation;
        bytes32 implementationRuntimeCodeHash;
        address admin;
        bytes32 adminRuntimeCodeHash;
        uint64 startBlock;
        bytes32 topic0;
        bytes32 eventAbiHash;
        bytes32 filterHash;
        bytes32 metricsHash;
        bytes32 derivationPolicyHash;
        address stateView;
        bytes32 stateViewRuntimeCodeHash;
        bytes4 readSelector;
        bytes32 configurationHash;
        bytes32 evidenceHash;
    }

    struct TradeCapabilityV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 launchId;
        bytes32 marketSetHash;
        bool executionEnabled;
        bytes32 routeSetHash;
        TradeRouteV1[] routes;
        bytes32 marketDataSourceSetHash;
        MarketDataSourceV1[] marketDataSources;
        bytes32 evidenceHash;
        bytes32 revocationPolicyHash;
    }

    event CustomLaunchExecutionPolicyBoundV2(
        bytes32 indexed launchId,
        bytes32 indexed executionPolicyHash,
        bytes32 indexed routeSetHash,
        bytes32 marketSetHash,
        uint32 routeCount,
        bytes32 marketDataSourceSetHash,
        uint32 marketDataSourceCount,
        bool executionEnabled,
        bytes32 evidenceHash,
        bytes32 revocationPolicyHash
    );

    event CustomLaunchExecutionRouteBoundV2(
        bytes32 indexed launchId,
        bytes32 indexed executionPolicyHash,
        uint32 indexed routeIndex,
        bytes32 marketId,
        bytes32 marketPathId,
        uint8 mode,
        bytes32 executorId,
        address executionTarget,
        bytes32 executionTargetRuntimeCodeHash,
        bytes32 configurationHash,
        bytes32 dependencyRuntimeCodeSetHash,
        bytes32 proxyBindingHash,
        bytes32 routeHash
    );

    event CustomLaunchMarketDataSourceBoundV2(
        bytes32 indexed launchId,
        bytes32 indexed executionPolicyHash,
        uint32 indexed sourceIndex,
        bytes32 marketId,
        bytes32 sourceId,
        uint8 kind,
        address sourceTarget,
        bytes32 sourceRuntimeCodeHash,
        uint64 startBlock,
        bytes32 sourceIdentityHash,
        bytes32 configurationHash,
        bytes32 sourceHash
    );

    function computeTradeRouteHashV1(TradeRouteV1 calldata route) external pure returns (bytes32);
    function MARKET_DATA_PRICE_METRIC_ID() external view returns (bytes32);
    function MARKET_DATA_VOLUME_METRIC_ID() external view returns (bytes32);
    function MARKET_DATA_LIQUIDITY_METRIC_ID() external view returns (bytes32);
    function MARKET_DATA_CHARTING_METRIC_ID() external view returns (bytes32);
    function EMPTY_MARKET_DATA_METRIC_SET_HASH() external view returns (bytes32);
    function computeTradeRouteSetHashV1(TradeRouteV1[] calldata routes) external pure returns (bytes32);
    function computeMarketSetHashV1(TradeRouteV1[] calldata routes) external pure returns (bytes32);
    function computeMarketDataMetricSetHashV1(bytes32[] calldata metricIds) external pure returns (bytes32);
    function computeMarketDataSourceHashV1(MarketDataSourceV1 calldata source) external pure returns (bytes32);
    function computeMarketDataSourceSetHashV1(MarketDataSourceV1[] calldata sources) external pure returns (bytes32);
    function computeTradeCapabilityHashV1(TradeCapabilityV1 calldata capability) external pure returns (bytes32);
    function bindTradeCapabilityV1(
        TradeCapabilityV1 calldata capability,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration
    ) external;
    function tradeCapabilityHash(bytes32 launchId) external view returns (bytes32);
}
