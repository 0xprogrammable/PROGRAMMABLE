// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IProgrammableCreate2GraphDeployerV1 } from "./IProgrammableCreate2GraphDeployerV1.sol";
import { IMemeLaunchV3 } from "./IMemeLaunchV3.sol";

interface IProgrammableLaunchStampRouterV1 {
    enum LaunchKindV1 {
        Invalid,
        CustomGraph,
        Classic
    }

    enum ComponentKindV1 {
        Other,
        Token,
        Hook
    }

    enum ComponentScopeV1 {
        Invalid,
        Exclusive,
        SharedInfrastructure
    }

    struct ExpectedGraphOutputV1 {
        uint8 targetIndex;
        bytes32 targetIdHash;
        address account;
        bytes32 runtimeCodeHash;
    }

    struct CustomGraphRouteV1 {
        bytes32 routeNamespace;
        bytes32 routeNonce;
        bytes32 topologyHash;
        bytes32 graphCommitment;
        IProgrammableCreate2GraphDeployerV1.Target[] targets;
        ExpectedGraphOutputV1[] expectedOutputs;
        bytes32 expectedGraphDeploymentHash;
    }

    struct ClassicRouteV1 {
        address launcher;
        bytes32 launcherRuntimeCodeHash;
        IMemeLaunchV3.LaunchParameters parameters;
        IMemeLaunchV3.LaunchResult expectedResult;
    }

    struct ComponentV1 {
        uint8 resultIndex;
        address account;
        bytes32 runtimeCodeHash;
        ComponentKindV1 kind;
        ComponentScopeV1 scope;
    }

    struct StampRequestV1 {
        bytes32 launchId;
        address token;
        bytes32 tokenRuntimeCodeHash;
        PoolKey poolKey;
        bytes32 hookRuntimeCodeHash;
        ComponentV1[] components;
    }

    struct LaunchPermitV1 {
        uint256 chainId;
        address router;
        address launchWallet;
        LaunchKindV1 kind;
        bytes32 routePayloadHash;
        bytes32 expectedResultHash;
        bytes32 stampRequestHash;
        bytes32 nonce;
        uint64 validAfter;
        uint64 deadline;
        uint256 value;
    }

    struct StampRecordV1 {
        LaunchKindV1 kind;
        address launchWallet;
        address token;
        address hook;
        address poolManager;
        bytes32 poolId;
        bytes32 poolKeyHash;
        bytes32 componentSetHash;
        bytes32 routePayloadHash;
        address routeLauncher;
        bytes32 routeLauncherRuntimeCodeHash;
        bytes32 expectedResultHash;
        bytes32 permitDigest;
        bytes32 stampHash;
    }

    event ProgrammableLaunchStampedV1(
        bytes32 indexed launchId,
        address indexed token,
        address indexed hook,
        address poolManager,
        bytes32 poolId,
        bytes32 stampHash
    );

    event ProgrammableLaunchRouteStampedV1(
        bytes32 indexed launchId,
        LaunchKindV1 indexed kind,
        bytes32 indexed routePayloadHash,
        bytes32 expectedResultHash,
        bytes32 permitDigest
    );

    event ProgrammableComponentStampedV1(
        bytes32 indexed launchId, address indexed component, ComponentKindV1 indexed kind, bytes32 runtimeCodeHash
    );

    function launchAndStampV1(
        LaunchPermitV1 calldata permit,
        StampRequestV1 calldata stampRequest,
        bytes calldata routePayload,
        bytes calldata signature
    ) external payable returns (bytes32 stampHash);

    function launchStamp(bytes32 launchId) external view returns (StampRecordV1 memory);

    function launchIdByToken(address token) external view returns (bytes32 launchId);

    function launchIdByPool(address poolManager, bytes32 poolId) external view returns (bytes32 launchId);

    function launchIdByComponent(address component) external view returns (bytes32 launchId);

    function componentRuntimeCodeHash(address component) external view returns (bytes32 runtimeCodeHash);

    function stampProof(address component) external view returns (bytes32 launchId, bytes32 stampHash);
}
