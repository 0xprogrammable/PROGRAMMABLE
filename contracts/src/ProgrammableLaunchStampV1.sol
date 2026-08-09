// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { ProgrammableCustomExecutionPolicyRegistryV2 } from "./ProgrammableCustomExecutionPolicyRegistryV2.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "./interfaces/IProgrammableCustomExecutionPolicyV2.sol";
import { IProgrammableCustomRegistryV1 } from "./interfaces/IProgrammableCustomRegistryV1.sol";

/// @title ProgrammableLaunchStampV1
/// @notice Canonical, registrar-only onchain provenance stamp for one approved Programmable launch and v4 pool.
/// @dev A stamp proves origin at this exact contract. It is not a security, audit or tradability guarantee.
contract ProgrammableLaunchStampV1 {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    enum ComponentKindV1 {
        Other,
        Token,
        Hook
    }

    struct ComponentV1 {
        address account;
        bytes32 runtimeCodeHash;
        ComponentKindV1 kind;
    }

    struct StampRequestV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 launchId;
        address token;
        bytes32 tokenRuntimeCodeHash;
        address poolManager;
        bytes32 poolManagerRuntimeCodeHash;
        PoolKey poolKey;
        bytes32 hookRuntimeCodeHash;
        ComponentV1[] components;
    }

    struct StampRecordV1 {
        address token;
        address hook;
        address poolManager;
        bytes32 poolId;
        bytes32 poolKeyHash;
        bytes32 componentSetHash;
        bytes32 capabilityHash;
        bytes32 stampHash;
    }

    bytes32 public constant COMPONENT_DOMAIN = keccak256("programmable.launch-component.v1");
    bytes32 public constant COMPONENT_SET_DOMAIN = keccak256("programmable.launch-component-set.v1");
    bytes32 public constant POOL_KEY_DOMAIN = keccak256("programmable.launch-pool-key.v1");
    bytes32 public constant STAMP_DOMAIN = keccak256("programmable.launch-stamp.v1");

    // Immutable protocol bindings intentionally use the uppercase convention.
    // slither-disable-next-line naming-convention
    IProgrammableCustomRegistryV1 public immutable REGISTRY;
    // slither-disable-next-line naming-convention
    ProgrammableCustomExecutionPolicyRegistryV2 public immutable EXECUTION_POLICY_REGISTRY;
    // slither-disable-next-line naming-convention
    address public immutable ATOMIC_REGISTRAR;
    // slither-disable-next-line naming-convention
    uint256 public immutable CHAIN_ID;
    // slither-disable-next-line naming-convention
    uint64 public immutable REGISTRY_GENERATION;

    mapping(bytes32 launchId => StampRecordV1 record) public launchStamp;
    mapping(address token => bytes32 launchId) public launchIdByToken;
    mapping(address component => bytes32 launchId) public launchIdByComponent;
    mapping(address component => bytes32 runtimeCodeHash) public componentRuntimeCodeHash;
    mapping(address component => ComponentKindV1 kind) public componentKind;
    mapping(bytes32 poolKey => bytes32 launchId) private _launchIdByPoolKey;

    event ProgrammableLaunchStampedV1(
        bytes32 indexed launchId,
        address indexed token,
        address indexed hook,
        address poolManager,
        bytes32 poolId,
        bytes32 stampHash
    );

    event ProgrammableComponentStampedV1(
        bytes32 indexed launchId, address indexed component, ComponentKindV1 indexed kind, bytes32 runtimeCodeHash
    );

    error ComponentAlreadyStamped(address component, bytes32 launchId);
    error DuplicateOrUnsortedComponent(address previous, address current);
    error InvalidBinding(bytes32 field);
    error InvalidComponent(address component, bytes32 supplied, bytes32 actual);
    error LaunchAlreadyStamped(bytes32 launchId);
    error PoolAlreadyStamped(address poolManager, bytes32 poolId, bytes32 launchId);
    error Unauthorized(address caller);

    constructor(
        IProgrammableCustomRegistryV1 registry,
        ProgrammableCustomExecutionPolicyRegistryV2 executionPolicyRegistry,
        address atomicRegistrar
    ) {
        if (
            address(registry) == address(0) || address(registry).code.length == 0
                || address(executionPolicyRegistry) == address(0) || address(executionPolicyRegistry).code.length == 0
                || atomicRegistrar == address(0)
        ) {
            revert InvalidBinding(bytes32("constructor"));
        }
        if (
            address(executionPolicyRegistry.REGISTRY()) != address(registry)
                || executionPolicyRegistry.ATOMIC_REGISTRAR() != atomicRegistrar
                || executionPolicyRegistry.CHAIN_ID() != block.chainid
        ) revert InvalidBinding(bytes32("execution-registry"));

        REGISTRY = registry;
        EXECUTION_POLICY_REGISTRY = executionPolicyRegistry;
        ATOMIC_REGISTRAR = atomicRegistrar;
        CHAIN_ID = block.chainid;
        REGISTRY_GENERATION = executionPolicyRegistry.REQUIRED_REGISTRY_GENERATION();
    }

    function stampLaunchV1(
        StampRequestV1 calldata request,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability
    ) external returns (bytes32 stampHash) {
        if (msg.sender != ATOMIC_REGISTRAR) revert Unauthorized(msg.sender);
        if (launchStamp[request.launchId].stampHash != bytes32(0)) revert LaunchAlreadyStamped(request.launchId);

        _validateRegistryBinding(request, registration);
        (bytes32 capabilityHash, address hook, bytes32 poolId, bytes32 poolKeyHash) =
            _validateCapabilityBinding(request, registration, capability);
        bytes32 componentSetHash = _validateComponents(request, registration, hook);

        stampHash = _computeStampHash(request, hook, poolId, poolKeyHash, componentSetHash, capabilityHash);
        if (registration.originHash != stampHash) revert InvalidBinding(bytes32("origin-hash"));

        bytes32 existingPoolLaunchId = _launchIdByPoolKey[poolKey(request.poolManager, poolId)];
        if (existingPoolLaunchId != bytes32(0)) {
            revert PoolAlreadyStamped(request.poolManager, poolId, existingPoolLaunchId);
        }

        launchStamp[request.launchId] = StampRecordV1({
            token: request.token,
            hook: hook,
            poolManager: request.poolManager,
            poolId: poolId,
            poolKeyHash: poolKeyHash,
            componentSetHash: componentSetHash,
            capabilityHash: capabilityHash,
            stampHash: stampHash
        });
        launchIdByToken[request.token] = request.launchId;
        _launchIdByPoolKey[poolKey(request.poolManager, poolId)] = request.launchId;

        uint256 length = request.components.length;
        for (uint256 index; index < length; ++index) {
            ComponentV1 calldata component = request.components[index];
            launchIdByComponent[component.account] = request.launchId;
            componentRuntimeCodeHash[component.account] = component.runtimeCodeHash;
            componentKind[component.account] = component.kind;
            emit ProgrammableComponentStampedV1(
                request.launchId, component.account, component.kind, component.runtimeCodeHash
            );
        }

        emit ProgrammableLaunchStampedV1(request.launchId, request.token, hook, request.poolManager, poolId, stampHash);
    }

    function computeComponentSetHash(ComponentV1[] calldata components) external pure returns (bytes32) {
        return _computeComponentSetHash(components);
    }

    function computeStampHash(StampRequestV1 calldata request, bytes32 capabilityHash) external view returns (bytes32) {
        address hook = address(request.poolKey.hooks);
        bytes32 poolId = PoolId.unwrap(request.poolKey.toId());
        bytes32 poolKeyHash = computePoolKeyHash(request.poolKey);
        return _computeStampHash(
            request, hook, poolId, poolKeyHash, _computeComponentSetHash(request.components), capabilityHash
        );
    }

    function computePoolKeyHash(PoolKey calldata key) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POOL_KEY_DOMAIN,
                Currency.unwrap(key.currency0),
                Currency.unwrap(key.currency1),
                key.fee,
                key.tickSpacing,
                address(key.hooks)
            )
        );
    }

    function poolKey(address poolManager, bytes32 poolId) public pure returns (bytes32) {
        return keccak256(abi.encode(poolManager, poolId));
    }

    function launchIdByPool(address poolManager, bytes32 poolId) external view returns (bytes32) {
        return _launchIdByPoolKey[poolKey(poolManager, poolId)];
    }

    function launchIdByHook(address hook) external view returns (bytes32) {
        if (componentKind[hook] != ComponentKindV1.Hook) return bytes32(0);
        return launchIdByComponent[hook];
    }

    function _validateRegistryBinding(
        StampRequestV1 calldata request,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration
    ) private view {
        if (
            request.chainId != CHAIN_ID || request.registryGeneration != REGISTRY_GENERATION
                || request.launchId != registration.launchId || request.chainId != registration.chainId
                || request.registryGeneration != registration.registryGeneration
        ) {
            revert InvalidBinding(bytes32("scope"));
        }

        IProgrammableCustomRegistryV1.LaunchStateV1 memory state = REGISTRY.launchState(request.launchId);
        bytes32 feePolicyHash = REGISTRY.computeFeePolicyHash(registration.feePolicy);
        bytes32 identityHash = REGISTRY.computeRegistrationBindingHash(registration, feePolicyHash);
        if (
            state.status != IProgrammableCustomRegistryV1.LaunchStatus.Observed || state.observedAtBlock != block.number
                || state.latestRecordRevision != 1 || state.latestRecordHash != registration.registeredRecordCommitment
                || state.identityHash != identityHash || state.feePolicyHash != feePolicyHash
        ) revert InvalidBinding(bytes32("registry-record"));
    }

    function _validateCapabilityBinding(
        StampRequestV1 calldata request,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability
    ) private view returns (bytes32 capabilityHash, address hook, bytes32 poolId, bytes32 poolKeyHash) {
        if (capability.routes.length != 1 || capability.launchId != request.launchId) {
            revert InvalidBinding(bytes32("single-route"));
        }
        capabilityHash = EXECUTION_POLICY_REGISTRY.computeTradeCapabilityHashV1(capability);
        if (
            capabilityHash != registration.capabilitySetHash
                || EXECUTION_POLICY_REGISTRY.tradeCapabilityHash(request.launchId) != capabilityHash
        ) revert InvalidBinding(bytes32("capability"));

        IProgrammableCustomExecutionPolicyV2.TradeRouteV1 calldata route = capability.routes[0];
        hook = address(request.poolKey.hooks);
        poolId = PoolId.unwrap(request.poolKey.toId());
        poolKeyHash = computePoolKeyHash(request.poolKey);
        address currency0 = Currency.unwrap(request.poolKey.currency0);
        address currency1 = Currency.unwrap(request.poolKey.currency1);
        if (
            request.token != registration.primaryContract
                || request.tokenRuntimeCodeHash != registration.primaryRuntimeCodeHash || request.token == address(0)
                || (request.token != currency0 && request.token != currency1)
                || uint160(currency0) >= uint160(currency1) || hook == address(0) || hook == request.token
                || route.hook != hook || route.hookRuntimeCodeHash != request.hookRuntimeCodeHash
                || route.poolManager != request.poolManager
                || route.poolManagerRuntimeCodeHash != request.poolManagerRuntimeCodeHash || route.marketId != poolId
        ) revert InvalidBinding(bytes32("v4-route"));

        _requireRuntime(request.token, request.tokenRuntimeCodeHash);
        _requireRuntime(hook, request.hookRuntimeCodeHash);
        _requireRuntime(request.poolManager, request.poolManagerRuntimeCodeHash);
        (uint160 sqrtPriceX96,,,) = IPoolManager(request.poolManager).getSlot0(PoolId.wrap(poolId));
        if (sqrtPriceX96 == 0) revert InvalidBinding(bytes32("pool-uninitialized"));
    }

    function _validateComponents(
        StampRequestV1 calldata request,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration,
        address hook
    ) private view returns (bytes32 componentSetHash) {
        uint256 length = request.components.length;
        if (length < 2) revert InvalidBinding(bytes32("components"));
        address previous;
        bool foundToken;
        bool foundHook;
        for (uint256 index; index < length; ++index) {
            ComponentV1 calldata component = request.components[index];
            if (component.account == address(0) || component.account == request.poolManager) {
                revert InvalidBinding(bytes32("component-address"));
            }
            if (index != 0 && uint160(component.account) <= uint160(previous)) {
                revert DuplicateOrUnsortedComponent(previous, component.account);
            }
            previous = component.account;
            bytes32 existingLaunchId = launchIdByComponent[component.account];
            if (existingLaunchId != bytes32(0)) revert ComponentAlreadyStamped(component.account, existingLaunchId);
            _requireRuntime(component.account, component.runtimeCodeHash);

            if (component.account == request.token) {
                if (
                    component.kind != ComponentKindV1.Token
                        || component.runtimeCodeHash != registration.primaryRuntimeCodeHash
                ) {
                    revert InvalidBinding(bytes32("token-component"));
                }
                foundToken = true;
            } else if (component.account == hook) {
                if (component.kind != ComponentKindV1.Hook || component.runtimeCodeHash != request.hookRuntimeCodeHash)
                {
                    revert InvalidBinding(bytes32("hook-component"));
                }
                foundHook = true;
            } else if (component.kind != ComponentKindV1.Other) {
                revert InvalidBinding(bytes32("component-kind"));
            }
        }
        if (!foundToken || !foundHook) revert InvalidBinding(bytes32("required-components"));
        componentSetHash = _computeComponentSetHash(request.components);
    }

    function _computeComponentSetHash(ComponentV1[] calldata components) private pure returns (bytes32) {
        uint256 length = components.length;
        bytes32[] memory hashes = new bytes32[](length);
        for (uint256 index; index < length; ++index) {
            ComponentV1 calldata component = components[index];
            hashes[index] = keccak256(
                abi.encode(COMPONENT_DOMAIN, component.account, component.runtimeCodeHash, uint8(component.kind))
            );
        }
        return keccak256(abi.encode(COMPONENT_SET_DOMAIN, hashes));
    }

    function _computeStampHash(
        StampRequestV1 calldata request,
        address hook,
        bytes32 poolId,
        bytes32 poolKeyHash,
        bytes32 componentSetHash,
        bytes32 capabilityHash
    ) private view returns (bytes32) {
        bytes32 scopeHash = keccak256(
            abi.encode(
                address(this), REGISTRY, ATOMIC_REGISTRAR, request.chainId, request.registryGeneration, request.launchId
            )
        );
        bytes32 assetHash =
            keccak256(abi.encode(request.token, request.tokenRuntimeCodeHash, hook, request.hookRuntimeCodeHash));
        bytes32 marketHash =
            keccak256(abi.encode(request.poolManager, request.poolManagerRuntimeCodeHash, poolId, poolKeyHash));
        return keccak256(abi.encode(STAMP_DOMAIN, scopeHash, assetHash, marketHash, componentSetHash, capabilityHash));
    }

    function _requireRuntime(address component, bytes32 supplied) private view {
        bytes32 actual = component.codehash;
        if (component.code.length == 0 || supplied == bytes32(0) || actual != supplied) {
            revert InvalidComponent(component, supplied, actual);
        }
    }
}
