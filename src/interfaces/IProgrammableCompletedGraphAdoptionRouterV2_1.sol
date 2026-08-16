// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Typed, adoption-only interface for completed graphs whose contracts were deployed with normal CREATE.
/// @dev The first values of the component/scope/execution enums preserve the Router V2 ordinals. This route adds
///      only `Auxiliary` and `COMPLETED_GRAPH_ADOPTED`; it does not reinterpret any Router V2 value.
interface IProgrammableCompletedGraphAdoptionRouterV2_1 {
    enum ComponentKindV2_1 {
        Invalid,
        ProfileModule,
        Factory,
        Renderer,
        Token,
        Hook,
        Nft,
        Auxiliary
    }

    enum ComponentScopeV2_1 {
        Invalid,
        Exclusive,
        SharedInfrastructure
    }

    enum ExecutionModeV2_1 {
        INVALID,
        EXACT_FACTORY_LAUNCH_EXECUTED,
        EXACT_EXISTING_LAUNCH_ADOPTED,
        REGISTERED_PROFILE_EXECUTED,
        COMPLETED_GRAPH_ADOPTED
    }

    enum EdgeKindV1 {
        Invalid,
        References,
        Controls,
        Uses,
        Renders,
        Mints,
        Configures,
        PoolBinds
    }

    /// @dev Components are canonically ordered by strictly increasing CREATE nonce. Every address is independently
    ///      recomputed from `plan.creator` and `createNonce`. `configurationHash` is a typed derivation of the other
    ///      immutable component fields; this profile does not claim to verify arbitrary mutable storage.
    struct ComponentV1 {
        address account;
        ComponentKindV2_1 kind;
        uint64 createNonce;
        bytes32 creationCodeHash;
        bytes32 runtimeCodeHash;
        bytes32 configurationHash;
        bytes32 creationEvidenceHash;
    }

    /// @dev Edges are canonically ordered by `(fromIndex,toIndex,kind,relationHash)` and must connect the full graph.
    struct GraphEdgeV1 {
        uint8 fromIndex;
        uint8 toIndex;
        EdgeKindV1 kind;
        bytes32 relationHash;
    }

    /// @dev No target, selector, opaque payload, execution value, token approval, or allowance is representable.
    struct CompletedGraphPlanV1 {
        bytes32 profileIdHash;
        bytes32 profileVersionHash;
        bytes32 routeSchemaHash;
        bytes32 sourceCommitHash;
        bytes32 sourceTreeHash;
        bytes32 manifestHash;
        bytes32 policyHash;
        bytes32 reviewAdmissionHash;
        address launchWallet;
        address creator;
        bytes32 creationEvidenceHash;
        bytes32 componentGraphHash;
        bytes32 configurationHash;
        PoolKey poolKey;
        uint160 initializedSqrtPriceX96;
        bytes32 poolInitializationEvidenceHash;
        bytes32 poolResultHash;
        bytes32 resultHash;
        uint256 maxNativeValueWei;
        bytes32 allowanceCapsHash;
    }

    struct LaunchPermitV2_1 {
        uint256 chainId;
        address router;
        address launchWallet;
        bytes32 routeIdHash;
        bytes32 routeVersionHash;
        bytes32 profileKey;
        bytes32 routePayloadHash;
        bytes32 expectedResultHash;
        bytes32 stampRequestHash;
        bytes32 nonce;
        uint64 validAfter;
        uint64 deadline;
        uint256 value;
    }

    struct StampRequestV2_1 {
        bytes32 launchId;
        bytes32 profileKey;
        bytes32 componentGraphHash;
        bytes32 poolId;
        bytes32 poolKeyHash;
        bytes32 resultHash;
        bytes32 currentPoolStateHash;
    }

    struct ProfileCapabilityV2_1 {
        bytes32 profileIdHash;
        bytes32 profileVersionHash;
        bytes32 schemaHash;
        bytes32 policyHash;
        bool enabled;
    }

    struct StampRecordV2_1 {
        address launchWallet;
        address creator;
        address token;
        address hook;
        address nft;
        address poolManager;
        bytes32 poolId;
        bytes32 poolKeyHash;
        bytes32 routeIdHash;
        bytes32 routeVersionHash;
        bytes32 profileKey;
        bytes32 profileIdHash;
        bytes32 profileVersionHash;
        bytes32 sourceCommitHash;
        bytes32 sourceTreeHash;
        bytes32 manifestHash;
        bytes32 policyHash;
        bytes32 reviewAdmissionHash;
        bytes32 creationEvidenceHash;
        bytes32 componentGraphHash;
        bytes32 configurationHash;
        bytes32 poolResultHash;
        bytes32 currentPoolStateHash;
        bytes32 resultHash;
        bytes32 planHash;
        bytes32 permitDigest;
        bytes32 stampHash;
        ExecutionModeV2_1 executionMode;
    }

    event ProgrammableCompletedGraphProfileRegisteredV2_1(
        bytes32 indexed profileKey,
        bytes32 indexed profileIdHash,
        bytes32 indexed profileVersionHash,
        bytes32 schemaHash,
        bytes32 policyHash
    );

    event ProgrammableCompletedGraphComponentStampedV2_1(
        bytes32 indexed launchId,
        address indexed component,
        ComponentKindV2_1 indexed kind,
        bytes32 runtimeCodeHash,
        bytes32 configurationHash,
        ComponentScopeV2_1 scope
    );

    event ProgrammableCompletedGraphRouteStampedV2_1(
        bytes32 indexed launchId,
        bytes32 indexed profileKey,
        address indexed creator,
        bytes32 planHash,
        bytes32 componentGraphHash,
        bytes32 manifestHash,
        bytes32 policyHash,
        bytes32 reviewAdmissionHash,
        bytes32 resultHash,
        bytes32 currentPoolStateHash,
        bytes32 permitDigest,
        ExecutionModeV2_1 executionMode
    );

    event ProgrammableCompletedGraphLaunchStampedV2_1(
        bytes32 indexed launchId,
        address indexed token,
        address indexed hook,
        address nft,
        address poolManager,
        bytes32 poolId,
        bytes32 stampHash,
        ExecutionModeV2_1 executionMode
    );

    function registerCompletedGraphProfileV1(
        bytes32 profileIdHash,
        bytes32 profileVersionHash,
        bytes32 schemaHash,
        bytes32 policyHash
    ) external returns (bytes32 profileKey);

    function adoptCompletedGraphV1(
        LaunchPermitV2_1 calldata permit,
        CompletedGraphPlanV1 calldata plan,
        StampRequestV2_1 calldata request,
        ComponentV1[] calldata components,
        GraphEdgeV1[] calldata edges,
        bytes calldata signature
    ) external payable returns (bytes32 stampHash);

    function permitDigest(LaunchPermitV2_1 calldata permit) external view returns (bytes32);

    function computeProfileKey(bytes32 profileIdHash, bytes32 profileVersionHash) external pure returns (bytes32);

    function computeComponentGraphHash(address creator, ComponentV1[] calldata components, GraphEdgeV1[] calldata edges)
        external
        pure
        returns (bytes32);

    function computeConfigurationHash(bytes32 componentGraphHash, bytes32 policyHash, bytes32 poolKeyHash)
        external
        pure
        returns (bytes32);

    function computePoolKeyHash(PoolKey calldata poolKey) external pure returns (bytes32);

    function computePoolResultHash(
        PoolKey calldata poolKey,
        uint160 initializedSqrtPriceX96,
        bytes32 initializationEvidenceHash
    ) external pure returns (bytes32);

    function computePoolStateHash(
        PoolKey calldata poolKey,
        uint160 sqrtPriceX96,
        int24 tick,
        uint24 protocolFee,
        uint24 lpFee,
        uint128 activeLiquidity,
        uint256 feeGrowthGlobal0X128,
        uint256 feeGrowthGlobal1X128
    ) external pure returns (bytes32);

    function computeResultHash(bytes32 componentGraphHash, bytes32 configurationHash, bytes32 poolResultHash)
        external
        pure
        returns (bytes32);

    function computePlanHash(CompletedGraphPlanV1 calldata plan) external pure returns (bytes32);

    function computeLaunchId(address launchWallet, bytes32 profileKey, bytes32 planHash) external pure returns (bytes32);

    function computeStampRequestHash(StampRequestV2_1 calldata request) external pure returns (bytes32);

    function profileCapability(bytes32 profileKey) external view returns (ProfileCapabilityV2_1 memory);

    function launchStamp(bytes32 launchId) external view returns (StampRecordV2_1 memory);

    function launchIdByToken(address token) external view returns (bytes32);

    function launchIdByComponent(address component) external view returns (bytes32);

    function launchIdByPool(address poolManager, bytes32 poolId) external view returns (bytes32);

    function launchIdByGraphHash(bytes32 componentGraphHash) external view returns (bytes32);

    function componentRuntimeCodeHash(address component) external view returns (bytes32);

    function stampProof(address component) external view returns (bytes32 launchId, bytes32 stampHash);

    function nonceUsed(address launchWallet, bytes32 nonce) external view returns (bool);

    function permitDigestUsed(bytes32 digest) external view returns (bool);
}
