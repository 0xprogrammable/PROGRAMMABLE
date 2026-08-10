// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { IProgrammableNestedFactoryV1 } from "./IProgrammableNestedFactoryV1.sol";

interface IProgrammableLaunchStampRouterV2 {
    enum ComponentKindV2 {
        Invalid,
        ProfileModule,
        Factory,
        Renderer,
        Token,
        Hook,
        Nft
    }

    enum ComponentScopeV2 {
        Invalid,
        Exclusive,
        SharedInfrastructure
    }

    /// @dev A bounded profile for the exact Shards factory ABI. `params.renderer` must be zero, selecting the
    ///      factory-created default renderer whose address and runtime are both bound here. The deployment calldata
    ///      hash is an offchain ceremony commitment; factory identity is independently proven by CREATE2 inputs.
    struct NestedFactoryRouteV1 {
        bytes32 profileIdHash;
        bytes32 profileVersionHash;
        bytes32 profileKey;
        bytes32 sourceRevisionHash;
        bytes32 manifestHash;
        bytes32 revenuePolicyHash;
        address factoryDeploymentProxy;
        bytes32 factorySalt;
        bytes32 factoryCreationCodeHash;
        bytes32 factoryInitCodeHash;
        bytes32 factoryDeploymentCalldataHash;
        address factory;
        bytes32 factoryRuntimeCodeHash;
        address renderer;
        bytes32 rendererCreationCodeHash;
        bytes32 rendererRuntimeCodeHash;
        address launcherFeeRecipient;
        address builderFeeRecipient;
        bytes32 tokenCreationCodeHash;
        bytes32 hookCreationCodeHash;
        bytes32 nftCreationCodeHash;
        bytes32 tokenSalt;
        bytes32 effectiveTokenSalt;
        bytes32 hookSalt;
        bytes hookCreationCode;
        IProgrammableNestedFactoryV1.LaunchParams params;
        address expectedToken;
        bytes32 expectedTokenRuntimeCodeHash;
        address expectedHook;
        bytes32 expectedHookRuntimeCodeHash;
        address expectedNft;
        bytes32 expectedNftRuntimeCodeHash;
        bytes32 expectedConfigurationHash;
        bytes32 expectedLaunchCalldataHash;
    }

    struct StampRequestV2 {
        bytes32 launchId;
        address token;
        bytes32 tokenRuntimeCodeHash;
        address hook;
        bytes32 hookRuntimeCodeHash;
        address nft;
        bytes32 nftRuntimeCodeHash;
        PoolKey poolKey;
    }

    struct LaunchPermitV2 {
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

    struct StampRecordV2 {
        address launchWallet;
        address factory;
        address renderer;
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
        address profileModule;
        bytes32 sourceRevisionHash;
        bytes32 manifestHash;
        bytes32 revenuePolicyHash;
        bytes32 routePayloadHash;
        bytes32 expectedConfigurationHash;
        bytes32 expectedResultHash;
        bytes32 permitDigest;
        bytes32 stampHash;
    }

    struct ProfileCapabilityV2 {
        bytes32 profileIdHash;
        bytes32 profileVersionHash;
        address module;
        bytes32 moduleRuntimeCodeHash;
        bytes32 schemaHash;
        bytes32 planHash;
        bool enabled;
        bool builtin;
    }

    event ProgrammableLaunchStampedV2(
        bytes32 indexed launchId,
        address indexed token,
        address indexed hook,
        address nft,
        address factory,
        address renderer,
        address poolManager,
        bytes32 poolId,
        bytes32 stampHash
    );

    event ProgrammableNestedFactoryRouteStampedV2(
        bytes32 indexed launchId,
        bytes32 indexed profileKey,
        address indexed factory,
        bytes32 routePayloadHash,
        bytes32 sourceRevisionHash,
        bytes32 manifestHash,
        bytes32 revenuePolicyHash,
        bytes32 expectedConfigurationHash,
        bytes32 expectedResultHash,
        bytes32 permitDigest
    );

    event ProgrammableNestedFactoryProfileRegisteredV2(
        bytes32 indexed profileKey,
        bytes32 indexed profileIdHash,
        bytes32 indexed profileVersionHash,
        address module,
        bytes32 moduleRuntimeCodeHash,
        bytes32 schemaHash,
        bytes32 planHash
    );

    event ProgrammableComponentStampedV2(
        bytes32 indexed launchId,
        address indexed component,
        ComponentKindV2 indexed kind,
        bytes32 runtimeCodeHash,
        ComponentScopeV2 scope
    );

    function launchAndStampV2(
        LaunchPermitV2 calldata permit,
        StampRequestV2 calldata stampRequest,
        NestedFactoryRouteV1 calldata route,
        bytes calldata signature
    ) external payable returns (bytes32 stampHash);

    function launchRegisteredProfileAndStampV2(LaunchPermitV2 calldata permit, bytes calldata signature)
        external
        payable
        returns (bytes32 stampHash);

    function registerProfileV2(
        bytes32 profileIdHash,
        bytes32 profileVersionHash,
        address module,
        bytes32 moduleRuntimeCodeHash,
        bytes32 schemaHash
    ) external returns (bytes32 profileKey);

    function permitDigest(LaunchPermitV2 calldata permit) external view returns (bytes32);

    function computeRoutePayloadHash(NestedFactoryRouteV1 calldata route) external pure returns (bytes32);

    function computeProfileKey(bytes32 profileIdHash, bytes32 profileVersionHash) external pure returns (bytes32);

    function computeLaunchId(address launchWallet, bytes32 profileKey, bytes32 routePayloadHash)
        external
        pure
        returns (bytes32);

    function computeStampRequestHash(StampRequestV2 calldata request) external pure returns (bytes32);

    function computeExpectedResultHash(NestedFactoryRouteV1 calldata route, StampRequestV2 calldata request)
        external
        view
        returns (bytes32);

    function profileCapability(bytes32 profileKey) external view returns (ProfileCapabilityV2 memory);

    function launchStamp(bytes32 launchId) external view returns (StampRecordV2 memory);

    function launchIdByToken(address token) external view returns (bytes32 launchId);

    function launchIdByPool(address poolManager, bytes32 poolId) external view returns (bytes32 launchId);

    function launchIdByComponent(address component) external view returns (bytes32 launchId);

    function componentRuntimeCodeHash(address component) external view returns (bytes32 runtimeCodeHash);

    function stampProof(address component) external view returns (bytes32 launchId, bytes32 stampHash);

    function nonceUsed(address launchWallet, bytes32 nonce) external view returns (bool);

    function permitDigestUsed(bytes32 digest) external view returns (bool);
}
