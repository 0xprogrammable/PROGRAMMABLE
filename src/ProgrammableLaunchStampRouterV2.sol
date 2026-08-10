// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { IProgrammableExactShardsProfileV1 } from "./interfaces/IProgrammableExactShardsProfileV1.sol";
import { IProgrammableLaunchStampRouterV2 } from "./interfaces/IProgrammableLaunchStampRouterV2.sol";
import { IProgrammableNestedFactoryV1 } from "./interfaces/IProgrammableNestedFactoryV1.sol";
import { IProgrammableNestedFactoryModuleV1 } from "./interfaces/IProgrammableNestedFactoryModuleV1.sol";
import { ProgrammableExactShardsProfileV1 } from "./ProgrammableExactShardsProfileV1.sol";

/// @title ProgrammableLaunchStampRouterV2
/// @notice Executes and atomically stamps authority-permitted deterministic nested-factory launches.
/// @dev The built-in Shards path calls the exact reviewed factory selector directly. Future profiles require an
///      add-only Safe registration and one fixed CALL-only module ABI. No user target, selector, opaque payload,
///      delegatecall, profile replacement, or removal exists.
contract ProgrammableLaunchStampRouterV2 is IProgrammableLaunchStampRouterV2, EIP712, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint64 public constant MAX_PERMIT_LIFETIME = 1 hours;
    uint256 public constant CHAIN_ID = 1;
    address public constant SHARDS_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 public constant POOL_MANAGER_RUNTIME_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    address public constant SHARDS_LAUNCH_WALLET = 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC;
    address private constant SHARDS_FACTORY = 0x9442a520e7b31D10177C75A363355C2C29141ac5;
    address private constant SHARDS_RENDERER = 0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14;
    address private constant SHARDS_TOKEN = 0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF;
    address private constant SHARDS_HOOK = 0xbA318baA8649962fD77CC7082d098f2C09Fd60cC;
    address private constant SHARDS_NFT = 0x9fDA98dE1B7061ae02A9Aec7A6f8ed75a8Feb8F3;

    bytes32 public constant ROUTE_ID_HASH = keccak256("nested-factory");
    bytes32 public constant ROUTE_VERSION_HASH = keccak256("1.0.0");
    bytes32 public constant PROFILE_ID_HASH = keccak256("exact-shards-nested-factory");
    bytes32 public constant PROFILE_VERSION_HASH = keccak256("1.0.0");
    bytes32 public constant PROFILE_KEY_TYPEHASH =
        keccak256("ProgrammableNestedFactoryProfileV1(bytes32 profileIdHash,bytes32 profileVersionHash)");
    bytes32 public constant SHARDS_PROFILE_KEY = 0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
    bytes32 public constant SHARDS_DIRECT_SCHEMA_HASH =
        keccak256("ProgrammableExactShardsProfileSchemaV1(validatePreV1,validatePostV1)");
    bytes32 public constant NESTED_FACTORY_MODULE_SCHEMA_HASH = keccak256(
        "ProgrammableNestedFactoryModuleSchemaV1(routerV1()->address,planV1()->PlanV1,executeNestedFactoryV1(address)->bytes32,validatePostV1()->(bytes4,bytes32))"
    );
    bytes32 public constant MODULE_PLAN_TYPEHASH = keccak256("ProgrammableNestedFactoryModulePlanV1(bytes32 planHash)");
    bytes32 public constant LAUNCH_ID_TYPEHASH = keccak256(
        "ProgrammableNestedFactoryLaunchIdV1(uint256 chainId,address launchWallet,bytes32 routeIdHash,bytes32 routeVersionHash,bytes32 profileKey,bytes32 routePayloadHash)"
    );

    string private constant EIP712_NAME = "ProgrammableLaunchStampRouter";
    string private constant EIP712_VERSION = "2";
    bytes32 private constant POOL_KEY_TYPEHASH = keccak256(
        "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"
    );
    bytes32 private constant STAMP_REQUEST_TYPEHASH = keccak256(
        "ProgrammableStampRequestV2(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,address hook,bytes32 hookRuntimeCodeHash,address nft,bytes32 nftRuntimeCodeHash,bytes32 poolKeyHash)"
    );
    bytes32 private constant EXPECTED_RESULT_TYPEHASH = keccak256(
        "ProgrammableNestedFactoryResultV1(address factory,bytes32 factoryRuntimeCodeHash,address renderer,bytes32 rendererRuntimeCodeHash,address token,bytes32 tokenRuntimeCodeHash,address hook,bytes32 hookRuntimeCodeHash,address nft,bytes32 nftRuntimeCodeHash,bytes32 configurationHash,bytes32 poolKeyHash,uint160 sqrtPriceX96)"
    );
    bytes32 private constant LAUNCH_PERMIT_TYPEHASH = keccak256(
        "ProgrammableLaunchPermitV2(uint256 chainId,address router,address launchWallet,bytes32 routeIdHash,bytes32 routeVersionHash,bytes32 profileKey,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)"
    );
    bytes32 private constant LAUNCH_STAMP_TYPEHASH = keccak256(
        "ProgrammableLaunchStampV2(bytes32 permitDigest,bytes32 launchId,address factory,address poolManager,bytes32 poolId)"
    );

    address public immutable PERMIT_AUTHORITY;
    bytes32 public immutable PERMIT_AUTHORITY_RUNTIME_CODE_HASH;
    address public immutable CAPABILITY_ADMIN;
    bytes32 public immutable CAPABILITY_ADMIN_RUNTIME_CODE_HASH;
    IPoolManager public immutable POOL_MANAGER;
    IProgrammableExactShardsProfileV1 public immutable SHARDS_PROFILE;
    bytes32 public immutable SHARDS_PROFILE_RUNTIME_CODE_HASH;

    mapping(bytes32 launchId => StampRecordV2 record) private _launchStamp;
    mapping(address token => bytes32 launchId) public override launchIdByToken;
    mapping(address component => bytes32 launchId) public override launchIdByComponent;
    mapping(address component => bytes32 runtimeCodeHash) public override componentRuntimeCodeHash;
    mapping(address launchWallet => mapping(bytes32 nonce => bool used)) private _usedNonce;
    mapping(bytes32 permitDigest => bool used) private _usedPermitDigest;
    mapping(bytes32 poolLookupKey => bytes32 launchId) private _launchIdByPool;
    mapping(bytes32 profileKey => ProfileCapabilityV2 capability) private _profileCapability;
    mapping(address component => bytes32 profileKey) private _registeredComponentProfile;

    struct WriteContextV2 {
        bytes32 launchId;
        bytes32 profileKey;
        bytes32 profileIdHash;
        bytes32 profileVersionHash;
        bytes32 sourceRevisionHash;
        bytes32 manifestHash;
        bytes32 revenuePolicyHash;
        address profileModule;
        address factory;
        bytes32 factoryRuntimeCodeHash;
        address renderer;
        bytes32 rendererRuntimeCodeHash;
        address token;
        bytes32 tokenRuntimeCodeHash;
        address hook;
        bytes32 hookRuntimeCodeHash;
        address nft;
        bytes32 nftRuntimeCodeHash;
        bytes32 poolId;
        bytes32 poolKeyHash;
        bytes32 configurationHash;
    }

    struct RegisteredLaunchStateV2 {
        ProfileCapabilityV2 capability;
        IProgrammableNestedFactoryModuleV1.PlanV1 plan;
        bytes32 routePayloadHash;
        bytes32 launchId;
        bytes32 poolId;
        bytes32 digest;
    }

    struct DirectLaunchStateV2 {
        bytes32 poolId;
        bytes32 poolKeyHash;
        bytes32 digest;
    }

    struct ExpectedResultCommitmentV2 {
        bytes32 typeHash;
        address factory;
        bytes32 factoryRuntimeCodeHash;
        address renderer;
        bytes32 rendererRuntimeCodeHash;
        address token;
        bytes32 tokenRuntimeCodeHash;
        address hook;
        bytes32 hookRuntimeCodeHash;
        address nft;
        bytes32 nftRuntimeCodeHash;
        bytes32 configurationHash;
        bytes32 poolKeyHash;
        uint160 sqrtPriceX96;
    }

    error AddressAlreadyOccupied(address account);
    error ComponentAlreadyStamped(address component, bytes32 launchId);
    error InvalidBinding(uint8 field);
    error InvalidComponent(address component, bytes32 supplied, bytes32 actual);
    error InvalidPermitSignature();
    error LaunchAlreadyStamped(bytes32 launchId);
    error NonceAlreadyUsed(address launchWallet, bytes32 nonce);
    error PermitAlreadyUsed(bytes32 permitDigest);
    error PermitOutsideValidityWindow(uint256 timestamp, uint256 validAfter, uint256 deadline);
    error PoolAlreadyInitialized(address poolManager, bytes32 poolId, uint160 sqrtPriceX96);
    error PoolAlreadyStamped(address poolManager, bytes32 poolId, bytes32 launchId);
    error ProfileAlreadyRegistered(bytes32 profileKey);
    error ProfileNotRegistered(bytes32 profileKey);
    error ResidualLaunchValue(uint256 expected, uint256 actual);
    error UnauthorizedCapabilityAdmin(address caller);
    error UnauthorizedLaunchWallet(address caller, address launchWallet);

    constructor(address permitAuthority, address capabilityAdmin) EIP712(EIP712_NAME, EIP712_VERSION) {
        if (block.chainid != CHAIN_ID) revert InvalidBinding(1);
        _requireCode(2, permitAuthority);
        _requireCode(3, capabilityAdmin);
        _requireRuntime(SHARDS_POOL_MANAGER, POOL_MANAGER_RUNTIME_CODE_HASH);
        if (permitAuthority == SHARDS_POOL_MANAGER || capabilityAdmin == SHARDS_POOL_MANAGER) {
            revert InvalidBinding(4);
        }

        IProgrammableExactShardsProfileV1 shardsProfile = new ProgrammableExactShardsProfileV1();

        PERMIT_AUTHORITY = permitAuthority;
        PERMIT_AUTHORITY_RUNTIME_CODE_HASH = permitAuthority.codehash;
        CAPABILITY_ADMIN = capabilityAdmin;
        CAPABILITY_ADMIN_RUNTIME_CODE_HASH = capabilityAdmin.codehash;
        POOL_MANAGER = IPoolManager(SHARDS_POOL_MANAGER);
        SHARDS_PROFILE = shardsProfile;
        SHARDS_PROFILE_RUNTIME_CODE_HASH = address(shardsProfile).codehash;
        _reserveProfileComponent(address(shardsProfile), SHARDS_PROFILE_KEY);
        _reserveProfileComponent(SHARDS_FACTORY, SHARDS_PROFILE_KEY);
        _reserveProfileComponent(SHARDS_RENDERER, SHARDS_PROFILE_KEY);
        _reserveProfileComponent(SHARDS_TOKEN, SHARDS_PROFILE_KEY);
        _reserveProfileComponent(SHARDS_HOOK, SHARDS_PROFILE_KEY);
        _reserveProfileComponent(SHARDS_NFT, SHARDS_PROFILE_KEY);

        emit ProgrammableNestedFactoryProfileRegisteredV2(
            SHARDS_PROFILE_KEY,
            PROFILE_ID_HASH,
            PROFILE_VERSION_HASH,
            address(shardsProfile),
            address(shardsProfile).codehash,
            SHARDS_DIRECT_SCHEMA_HASH,
            bytes32(0)
        );
    }

    /// @notice Direct exact-Shards hot path. The Router itself calls the reviewed factory selector.
    function launchAndStampV2(
        LaunchPermitV2 calldata permit,
        StampRequestV2 calldata request,
        NestedFactoryRouteV1 calldata route,
        bytes calldata signature
    ) external payable override nonReentrant returns (bytes32 stampHash) {
        uint256 baseline = address(this).balance - msg.value;
        DirectLaunchStateV2 memory state = _prepareDirect(permit, request, route);
        state.digest = _consumePermit(permit, signature);
        _executeDirect(route, request, permit.expectedResultHash);
        stampHash = _finishStamp(permit, _directWriteContext(route, request, state), state.digest);
        _requireBaseline(baseline);
    }

    function _prepareDirect(
        LaunchPermitV2 calldata permit,
        StampRequestV2 calldata request,
        NestedFactoryRouteV1 calldata route
    ) private view returns (DirectLaunchStateV2 memory state) {
        _requireRuntime(address(SHARDS_PROFILE), SHARDS_PROFILE_RUNTIME_CODE_HASH);
        bytes32 routePayloadHash = computeRoutePayloadHash(route);
        bytes32 launchId = computeLaunchId(SHARDS_LAUNCH_WALLET, SHARDS_PROFILE_KEY, routePayloadHash);
        if (
            route.profileIdHash != PROFILE_ID_HASH || route.profileVersionHash != PROFILE_VERSION_HASH
                || route.profileKey != SHARDS_PROFILE_KEY || request.launchId != launchId
        ) revert InvalidBinding(6);
        bytes32 expectedResultHash;
        (state.poolId, state.poolKeyHash, expectedResultHash) =
            SHARDS_PROFILE.validatePreV1(route, request, POOL_MANAGER);
        _validatePermit(
            permit,
            request.launchId,
            SHARDS_LAUNCH_WALLET,
            SHARDS_PROFILE_KEY,
            routePayloadHash,
            expectedResultHash,
            _stampRequestHashCalldata(request)
        );
        _requireAvailable(request.launchId, request.token, request.hook, request.nft, state.poolId);
    }

    function _executeDirect(
        NestedFactoryRouteV1 calldata route,
        StampRequestV2 calldata request,
        bytes32 expectedResultHash
    ) private {
        (address hook, address token, address nft) = IProgrammableNestedFactoryV1(route.factory)
            .launch(route.tokenSalt, route.hookSalt, route.hookCreationCode, route.params);
        if (hook != request.hook || token != request.token || nft != request.nft) revert InvalidBinding(7);
        _requireRuntime(address(SHARDS_PROFILE), SHARDS_PROFILE_RUNTIME_CODE_HASH);
        if (SHARDS_PROFILE.validatePostV1(route, request, POOL_MANAGER) != expectedResultHash) {
            revert InvalidBinding(8);
        }
    }

    function _directWriteContext(
        NestedFactoryRouteV1 calldata route,
        StampRequestV2 calldata request,
        DirectLaunchStateV2 memory state
    ) private view returns (WriteContextV2 memory context) {
        context.launchId = request.launchId;
        context.profileKey = SHARDS_PROFILE_KEY;
        context.profileIdHash = PROFILE_ID_HASH;
        context.profileVersionHash = PROFILE_VERSION_HASH;
        context.sourceRevisionHash = route.sourceRevisionHash;
        context.manifestHash = route.manifestHash;
        context.revenuePolicyHash = route.revenuePolicyHash;
        context.profileModule = address(SHARDS_PROFILE);
        context.factory = route.factory;
        context.factoryRuntimeCodeHash = route.factoryRuntimeCodeHash;
        context.renderer = route.renderer;
        context.rendererRuntimeCodeHash = route.rendererRuntimeCodeHash;
        context.token = request.token;
        context.tokenRuntimeCodeHash = request.tokenRuntimeCodeHash;
        context.hook = request.hook;
        context.hookRuntimeCodeHash = request.hookRuntimeCodeHash;
        context.nft = request.nft;
        context.nftRuntimeCodeHash = request.nftRuntimeCodeHash;
        context.poolId = state.poolId;
        context.poolKeyHash = state.poolKeyHash;
        context.configurationHash = route.expectedConfigurationHash;
    }

    /// @notice Future profile path. The selected audited module receives only the bound launch wallet.
    function launchRegisteredProfileAndStampV2(LaunchPermitV2 calldata permit, bytes calldata signature)
        external
        payable
        override
        nonReentrant
        returns (bytes32 stampHash)
    {
        uint256 baseline = address(this).balance - msg.value;
        RegisteredLaunchStateV2 memory state;
        state.capability = _profileCapability[permit.profileKey];
        if (!state.capability.enabled) revert ProfileNotRegistered(permit.profileKey);
        _requireRuntime(state.capability.module, state.capability.moduleRuntimeCodeHash);
        IProgrammableNestedFactoryModuleV1 module = IProgrammableNestedFactoryModuleV1(state.capability.module);
        state.plan = module.planV1();
        _validateRegisteredPlan(permit.profileKey, state.capability, state.plan);

        state.routePayloadHash = state.capability.planHash;
        state.launchId = computeLaunchId(state.plan.launchWallet, permit.profileKey, state.routePayloadHash);
        _validatePermitMemory(
            permit,
            state.launchId,
            state.plan.launchWallet,
            permit.profileKey,
            state.routePayloadHash,
            _planResultHash(state.plan, state.plan.configurationHash),
            _moduleStampRequestHash(state.plan, state.launchId)
        );
        state.poolId = PoolId.unwrap(state.plan.poolKey.toId());
        _requireAvailable(state.launchId, state.plan.token, state.plan.hook, state.plan.nft, state.poolId);
        _requireVacant(state.plan.token);
        _requireVacant(state.plan.hook);
        _requireVacant(state.plan.nft);
        (uint160 beforeSqrt,,,) = POOL_MANAGER.getSlot0(state.plan.poolKey.toId());
        if (beforeSqrt != 0) revert PoolAlreadyInitialized(address(POOL_MANAGER), state.poolId, beforeSqrt);
        state.digest = _consumePermit(permit, signature);

        _executeRegisteredProfile(state.capability, module, state.plan, permit.expectedResultHash);

        WriteContextV2 memory context =
            _moduleWriteContext(state.plan, state.capability.module, permit.profileKey, state.launchId, state.poolId);
        stampHash = _finishStamp(permit, context, state.digest);
        _requireBaseline(baseline);
    }

    function _executeRegisteredProfile(
        ProfileCapabilityV2 memory capability,
        IProgrammableNestedFactoryModuleV1 module,
        IProgrammableNestedFactoryModuleV1.PlanV1 memory plan,
        bytes32 expectedResultHash
    ) private {
        bytes32 executionConfigurationHash = module.executeNestedFactoryV1(plan.launchWallet);
        _requireRuntime(capability.module, capability.moduleRuntimeCodeHash);
        _requireRuntime(plan.factory, plan.factoryRuntimeCodeHash);
        _requireRuntime(plan.renderer, plan.rendererRuntimeCodeHash);
        _requireRuntime(plan.token, plan.tokenRuntimeCodeHash);
        _requireRuntime(plan.hook, plan.hookRuntimeCodeHash);
        _requireRuntime(plan.nft, plan.nftRuntimeCodeHash);
        (bytes4 magic, bytes32 observedConfigurationHash) = module.validatePostV1();
        if (
            magic != IProgrammableNestedFactoryModuleV1.validatePostV1.selector
                || executionConfigurationHash != plan.configurationHash
                || observedConfigurationHash != plan.configurationHash || module.routerV1() != address(this)
                || _modulePlanHash(module.planV1()) != capability.planHash
        ) revert InvalidBinding(9);
        (uint160 afterSqrt,,,) = POOL_MANAGER.getSlot0(plan.poolKey.toId());
        if (afterSqrt != plan.startSqrtPriceX96 || afterSqrt == 0) revert InvalidBinding(10);
        if (_planResultHash(plan, observedConfigurationHash) != expectedResultHash) revert InvalidBinding(11);
    }

    /// @notice Adds one capability forever. There is intentionally no replace, disable, or remove function.
    function registerProfileV2(
        bytes32 profileIdHash,
        bytes32 profileVersionHash,
        address module,
        bytes32 moduleRuntimeCodeHash,
        bytes32 schemaHash
    ) external override nonReentrant returns (bytes32 profileKey) {
        if (msg.sender != CAPABILITY_ADMIN) revert UnauthorizedCapabilityAdmin(msg.sender);
        _requireRuntime(CAPABILITY_ADMIN, CAPABILITY_ADMIN_RUNTIME_CODE_HASH);
        if (schemaHash != NESTED_FACTORY_MODULE_SCHEMA_HASH) revert InvalidBinding(12);
        if (
            module == address(this) || module == PERMIT_AUTHORITY || module == CAPABILITY_ADMIN
                || module == address(POOL_MANAGER)
        ) revert InvalidBinding(13);
        _requireRuntime(module, moduleRuntimeCodeHash);
        profileKey = computeProfileKey(profileIdHash, profileVersionHash);
        if (profileKey == SHARDS_PROFILE_KEY || _profileCapability[profileKey].enabled) {
            revert ProfileAlreadyRegistered(profileKey);
        }
        IProgrammableNestedFactoryModuleV1.PlanV1 memory plan = IProgrammableNestedFactoryModuleV1(module).planV1();
        bytes32 planHash = _modulePlanHash(plan);
        ProfileCapabilityV2 memory capability = ProfileCapabilityV2({
            profileIdHash: profileIdHash,
            profileVersionHash: profileVersionHash,
            module: module,
            moduleRuntimeCodeHash: moduleRuntimeCodeHash,
            schemaHash: schemaHash,
            planHash: planHash,
            enabled: true,
            builtin: false
        });
        _validateRegisteredPlan(profileKey, capability, plan);
        _requireUnreservedProfileComponent(module);
        _requireUnreservedProfileComponent(plan.factory);
        _requireUnreservedProfileComponent(plan.renderer);
        _requireUnreservedProfileComponent(plan.token);
        _requireUnreservedProfileComponent(plan.hook);
        _requireUnreservedProfileComponent(plan.nft);
        _requireVacant(plan.token);
        _requireVacant(plan.hook);
        _requireVacant(plan.nft);
        bytes32 poolId = PoolId.unwrap(plan.poolKey.toId());
        (uint160 sqrtPriceX96,,,) = POOL_MANAGER.getSlot0(plan.poolKey.toId());
        if (sqrtPriceX96 != 0) revert PoolAlreadyInitialized(address(POOL_MANAGER), poolId, sqrtPriceX96);

        _profileCapability[profileKey] = capability;
        _reserveProfileComponent(module, profileKey);
        _reserveProfileComponent(plan.factory, profileKey);
        _reserveProfileComponent(plan.renderer, profileKey);
        _reserveProfileComponent(plan.token, profileKey);
        _reserveProfileComponent(plan.hook, profileKey);
        _reserveProfileComponent(plan.nft, profileKey);
        emit ProgrammableNestedFactoryProfileRegisteredV2(
            profileKey, profileIdHash, profileVersionHash, module, moduleRuntimeCodeHash, schemaHash, planHash
        );
    }

    function permitDigest(LaunchPermitV2 calldata permit) public view override returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LAUNCH_PERMIT_TYPEHASH,
                    permit.chainId,
                    permit.router,
                    permit.launchWallet,
                    permit.routeIdHash,
                    permit.routeVersionHash,
                    permit.profileKey,
                    permit.routePayloadHash,
                    permit.expectedResultHash,
                    permit.stampRequestHash,
                    permit.nonce,
                    permit.validAfter,
                    permit.deadline,
                    permit.value
                )
            )
        );
    }

    function computeRoutePayloadHash(NestedFactoryRouteV1 calldata route) public pure override returns (bytes32) {
        return keccak256(abi.encode(route));
    }

    function computeProfileKey(bytes32 profileIdHash, bytes32 profileVersionHash)
        public
        pure
        override
        returns (bytes32)
    {
        return keccak256(abi.encode(PROFILE_KEY_TYPEHASH, profileIdHash, profileVersionHash));
    }

    function computeLaunchId(address launchWallet, bytes32 profileKey, bytes32 routePayloadHash)
        public
        pure
        override
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                LAUNCH_ID_TYPEHASH,
                CHAIN_ID,
                launchWallet,
                ROUTE_ID_HASH,
                ROUTE_VERSION_HASH,
                profileKey,
                routePayloadHash
            )
        );
    }

    function computeStampRequestHash(StampRequestV2 calldata request) public pure override returns (bytes32) {
        return _stampRequestHashCalldata(request);
    }

    function computeExpectedResultHash(NestedFactoryRouteV1 calldata route, StampRequestV2 calldata request)
        external
        view
        override
        returns (bytes32)
    {
        return SHARDS_PROFILE.computeExpectedResultHash(route, request);
    }

    function profileCapability(bytes32 profileKey)
        external
        view
        override
        returns (ProfileCapabilityV2 memory capability)
    {
        if (profileKey == SHARDS_PROFILE_KEY) {
            return ProfileCapabilityV2({
                profileIdHash: PROFILE_ID_HASH,
                profileVersionHash: PROFILE_VERSION_HASH,
                module: address(SHARDS_PROFILE),
                moduleRuntimeCodeHash: SHARDS_PROFILE_RUNTIME_CODE_HASH,
                schemaHash: SHARDS_DIRECT_SCHEMA_HASH,
                planHash: bytes32(0),
                enabled: true,
                builtin: true
            });
        }
        return _profileCapability[profileKey];
    }

    function launchStamp(bytes32 launchId) external view override returns (StampRecordV2 memory) {
        return _launchStamp[launchId];
    }

    function launchIdByPool(address poolManager, bytes32 poolId) external view override returns (bytes32) {
        return _launchIdByPool[_poolLookupKey(poolManager, poolId)];
    }

    function stampProof(address component) external view override returns (bytes32 launchId, bytes32 stampHash) {
        launchId = launchIdByComponent[component];
        if (launchId != bytes32(0)) stampHash = _launchStamp[launchId].stampHash;
    }

    function nonceUsed(address launchWallet, bytes32 nonce) external view override returns (bool) {
        return _usedNonce[launchWallet][nonce];
    }

    function permitDigestUsed(bytes32 digest) external view override returns (bool) {
        return _usedPermitDigest[digest];
    }

    function _validatePermit(
        LaunchPermitV2 calldata permit,
        bytes32 launchId,
        address launchWallet,
        bytes32 profileKey,
        bytes32 routePayloadHash,
        bytes32 expectedResultHash,
        bytes32 stampRequestHash
    ) private view {
        _validatePermitMemory(
            permit, launchId, launchWallet, profileKey, routePayloadHash, expectedResultHash, stampRequestHash
        );
    }

    function _validatePermitMemory(
        LaunchPermitV2 calldata permit,
        bytes32 launchId,
        address launchWallet,
        bytes32 profileKey,
        bytes32 routePayloadHash,
        bytes32 expectedResultHash,
        bytes32 stampRequestHash
    ) private view {
        _requireRuntime(PERMIT_AUTHORITY, PERMIT_AUTHORITY_RUNTIME_CODE_HASH);
        _requireRuntime(address(POOL_MANAGER), POOL_MANAGER_RUNTIME_CODE_HASH);
        if (msg.sender != launchWallet || permit.launchWallet != launchWallet || launchWallet == address(0)) {
            revert UnauthorizedLaunchWallet(msg.sender, launchWallet);
        }
        if (
            permit.chainId != CHAIN_ID || block.chainid != CHAIN_ID || permit.router != address(this)
                || permit.routeIdHash != ROUTE_ID_HASH || permit.routeVersionHash != ROUTE_VERSION_HASH
                || permit.profileKey != profileKey || permit.routePayloadHash != routePayloadHash
                || permit.expectedResultHash != expectedResultHash || permit.stampRequestHash != stampRequestHash
                || permit.nonce != launchId || permit.value != msg.value || permit.value != 0
        ) revert InvalidBinding(14);
        if (
            block.timestamp < permit.validAfter || block.timestamp > permit.deadline
                || permit.validAfter > permit.deadline
        ) revert PermitOutsideValidityWindow(block.timestamp, permit.validAfter, permit.deadline);
        if (permit.deadline - permit.validAfter > MAX_PERMIT_LIFETIME) revert InvalidBinding(15);
    }

    function _consumePermit(LaunchPermitV2 calldata permit, bytes calldata signature) private returns (bytes32 digest) {
        digest = permitDigest(permit);
        if (_usedPermitDigest[digest]) revert PermitAlreadyUsed(digest);
        if (_usedNonce[permit.launchWallet][permit.nonce]) {
            revert NonceAlreadyUsed(permit.launchWallet, permit.nonce);
        }
        if (!SignatureChecker.isValidERC1271SignatureNow(PERMIT_AUTHORITY, digest, signature)) {
            revert InvalidPermitSignature();
        }
        _usedPermitDigest[digest] = true;
        _usedNonce[permit.launchWallet][permit.nonce] = true;
    }

    function _requireAvailable(bytes32 launchId, address token, address hook, address nft, bytes32 poolId)
        private
        view
    {
        if (_launchStamp[launchId].stampHash != bytes32(0)) revert LaunchAlreadyStamped(launchId);
        _requireUnstamped(token);
        _requireUnstamped(hook);
        _requireUnstamped(nft);
        bytes32 existingTokenLaunchId = launchIdByToken[token];
        if (existingTokenLaunchId != bytes32(0)) revert ComponentAlreadyStamped(token, existingTokenLaunchId);
        bytes32 existingPoolLaunchId = _launchIdByPool[_poolLookupKey(address(POOL_MANAGER), poolId)];
        if (existingPoolLaunchId != bytes32(0)) {
            revert PoolAlreadyStamped(address(POOL_MANAGER), poolId, existingPoolLaunchId);
        }
    }

    function _validateRegisteredPlan(
        bytes32 profileKey,
        ProfileCapabilityV2 memory capability,
        IProgrammableNestedFactoryModuleV1.PlanV1 memory plan
    ) private view {
        if (
            capability.schemaHash != NESTED_FACTORY_MODULE_SCHEMA_HASH || capability.planHash == bytes32(0)
                || _modulePlanHash(plan) != capability.planHash
                || IProgrammableNestedFactoryModuleV1(capability.module).routerV1() != address(this)
                || plan.profileIdHash != capability.profileIdHash
                || plan.profileVersionHash != capability.profileVersionHash
                || computeProfileKey(plan.profileIdHash, plan.profileVersionHash) != profileKey
                || plan.sourceRevisionHash == bytes32(0) || plan.manifestHash == bytes32(0)
                || plan.revenuePolicyHash == bytes32(0) || plan.launchWallet == address(0)
                || plan.poolManager != address(POOL_MANAGER) || plan.configurationHash == bytes32(0)
                || plan.startSqrtPriceX96 == 0 || plan.factory == address(0) || plan.renderer == address(0)
                || plan.token == address(0) || plan.hook == address(0) || plan.nft == address(0)
                || plan.factory == plan.renderer || plan.factory == plan.token || plan.factory == plan.hook
                || plan.factory == plan.nft || plan.renderer == plan.token || plan.renderer == plan.hook
                || plan.renderer == plan.nft || plan.token == plan.hook || plan.token == plan.nft
                || plan.hook == plan.nft || _reservedPlanComponent(plan.factory, capability.module)
                || _reservedPlanComponent(plan.renderer, capability.module)
                || _reservedPlanComponent(plan.token, capability.module)
                || _reservedPlanComponent(plan.hook, capability.module)
                || _reservedPlanComponent(plan.nft, capability.module) || plan.factoryRuntimeCodeHash == bytes32(0)
                || plan.rendererRuntimeCodeHash == bytes32(0) || plan.tokenRuntimeCodeHash == bytes32(0)
                || plan.hookRuntimeCodeHash == bytes32(0) || plan.nftRuntimeCodeHash == bytes32(0)
        ) revert InvalidBinding(16);
        address currency0 = Currency.unwrap(plan.poolKey.currency0);
        address currency1 = Currency.unwrap(plan.poolKey.currency1);
        if (
            currency0 >= currency1 || (plan.token != currency0 && plan.token != currency1)
                || address(plan.poolKey.hooks) != plan.hook
        ) revert InvalidBinding(17);
        _requireRuntime(plan.factory, plan.factoryRuntimeCodeHash);
        _requireRuntime(plan.renderer, plan.rendererRuntimeCodeHash);
    }

    function _modulePlanHash(IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) private pure returns (bytes32) {
        return keccak256(abi.encode(MODULE_PLAN_TYPEHASH, keccak256(abi.encode(plan))));
    }

    function _moduleStampRequest(IProgrammableNestedFactoryModuleV1.PlanV1 memory plan, bytes32 launchId)
        private
        pure
        returns (StampRequestV2 memory request)
    {
        request.launchId = launchId;
        request.token = plan.token;
        request.tokenRuntimeCodeHash = plan.tokenRuntimeCodeHash;
        request.hook = plan.hook;
        request.hookRuntimeCodeHash = plan.hookRuntimeCodeHash;
        request.nft = plan.nft;
        request.nftRuntimeCodeHash = plan.nftRuntimeCodeHash;
        request.poolKey = plan.poolKey;
    }

    function _moduleStampRequestHash(IProgrammableNestedFactoryModuleV1.PlanV1 memory plan, bytes32 launchId)
        private
        pure
        returns (bytes32)
    {
        return _stampRequestHash(_moduleStampRequest(plan, launchId));
    }

    function _moduleWriteContext(
        IProgrammableNestedFactoryModuleV1.PlanV1 memory plan,
        address module,
        bytes32 profileKey,
        bytes32 launchId,
        bytes32 poolId
    ) private pure returns (WriteContextV2 memory context) {
        context.launchId = launchId;
        context.profileKey = profileKey;
        context.profileIdHash = plan.profileIdHash;
        context.profileVersionHash = plan.profileVersionHash;
        context.sourceRevisionHash = plan.sourceRevisionHash;
        context.manifestHash = plan.manifestHash;
        context.revenuePolicyHash = plan.revenuePolicyHash;
        context.profileModule = module;
        context.factory = plan.factory;
        context.factoryRuntimeCodeHash = plan.factoryRuntimeCodeHash;
        context.renderer = plan.renderer;
        context.rendererRuntimeCodeHash = plan.rendererRuntimeCodeHash;
        context.token = plan.token;
        context.tokenRuntimeCodeHash = plan.tokenRuntimeCodeHash;
        context.hook = plan.hook;
        context.hookRuntimeCodeHash = plan.hookRuntimeCodeHash;
        context.nft = plan.nft;
        context.nftRuntimeCodeHash = plan.nftRuntimeCodeHash;
        context.poolId = poolId;
        context.poolKeyHash = _poolKeyHash(plan.poolKey);
        context.configurationHash = plan.configurationHash;
    }

    function _planResultHash(IProgrammableNestedFactoryModuleV1.PlanV1 memory plan, bytes32 configurationHash)
        private
        pure
        returns (bytes32)
    {
        ExpectedResultCommitmentV2 memory result;
        result.typeHash = EXPECTED_RESULT_TYPEHASH;
        result.factory = plan.factory;
        result.factoryRuntimeCodeHash = plan.factoryRuntimeCodeHash;
        result.renderer = plan.renderer;
        result.rendererRuntimeCodeHash = plan.rendererRuntimeCodeHash;
        result.token = plan.token;
        result.tokenRuntimeCodeHash = plan.tokenRuntimeCodeHash;
        result.hook = plan.hook;
        result.hookRuntimeCodeHash = plan.hookRuntimeCodeHash;
        result.nft = plan.nft;
        result.nftRuntimeCodeHash = plan.nftRuntimeCodeHash;
        result.configurationHash = configurationHash;
        result.poolKeyHash = _poolKeyHash(plan.poolKey);
        result.sqrtPriceX96 = plan.startSqrtPriceX96;
        return keccak256(abi.encode(result));
    }

    function _finishStamp(LaunchPermitV2 calldata permit, WriteContextV2 memory context, bytes32 digest)
        private
        returns (bytes32 stampHash)
    {
        stampHash = _stampHash(context.launchId, context.factory, context.poolId, digest);
        StampRecordV2 storage record = _launchStamp[context.launchId];
        record.launchWallet = permit.launchWallet;
        record.factory = context.factory;
        record.renderer = context.renderer;
        record.token = context.token;
        record.hook = context.hook;
        record.nft = context.nft;
        record.poolManager = address(POOL_MANAGER);
        record.poolId = context.poolId;
        record.poolKeyHash = context.poolKeyHash;
        record.routeIdHash = permit.routeIdHash;
        record.routeVersionHash = permit.routeVersionHash;
        record.profileKey = context.profileKey;
        record.profileIdHash = context.profileIdHash;
        record.profileVersionHash = context.profileVersionHash;
        record.profileModule = context.profileModule;
        record.sourceRevisionHash = context.sourceRevisionHash;
        record.manifestHash = context.manifestHash;
        record.revenuePolicyHash = context.revenuePolicyHash;
        record.routePayloadHash = permit.routePayloadHash;
        record.expectedConfigurationHash = context.configurationHash;
        record.expectedResultHash = permit.expectedResultHash;
        record.permitDigest = digest;
        record.stampHash = stampHash;

        launchIdByToken[context.token] = context.launchId;
        _launchIdByPool[_poolLookupKey(address(POOL_MANAGER), context.poolId)] = context.launchId;
        _writeExclusiveComponent(context, context.token, context.tokenRuntimeCodeHash, ComponentKindV2.Token);
        _writeExclusiveComponent(context, context.hook, context.hookRuntimeCodeHash, ComponentKindV2.Hook);
        _writeExclusiveComponent(context, context.nft, context.nftRuntimeCodeHash, ComponentKindV2.Nft);
        _emitShared(context, context.profileModule, context.profileModule.codehash, ComponentKindV2.ProfileModule);
        _emitShared(context, context.factory, context.factoryRuntimeCodeHash, ComponentKindV2.Factory);
        _emitShared(context, context.renderer, context.rendererRuntimeCodeHash, ComponentKindV2.Renderer);
        emit ProgrammableNestedFactoryRouteStampedV2(
            context.launchId,
            context.profileKey,
            context.factory,
            permit.routePayloadHash,
            context.sourceRevisionHash,
            context.manifestHash,
            context.revenuePolicyHash,
            context.configurationHash,
            permit.expectedResultHash,
            digest
        );
        emit ProgrammableLaunchStampedV2(
            context.launchId,
            context.token,
            context.hook,
            context.nft,
            context.factory,
            context.renderer,
            address(POOL_MANAGER),
            context.poolId,
            stampHash
        );
    }

    function _writeExclusiveComponent(
        WriteContextV2 memory context,
        address component,
        bytes32 runtimeCodeHash,
        ComponentKindV2 kind
    ) private {
        launchIdByComponent[component] = context.launchId;
        componentRuntimeCodeHash[component] = runtimeCodeHash;
        emit ProgrammableComponentStampedV2(
            context.launchId, component, kind, runtimeCodeHash, ComponentScopeV2.Exclusive
        );
    }

    function _emitShared(
        WriteContextV2 memory context,
        address component,
        bytes32 runtimeCodeHash,
        ComponentKindV2 kind
    ) private {
        emit ProgrammableComponentStampedV2(
            context.launchId, component, kind, runtimeCodeHash, ComponentScopeV2.SharedInfrastructure
        );
    }

    function _stampHash(bytes32 launchId, address factory, bytes32 poolId, bytes32 digest)
        private
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(LAUNCH_STAMP_TYPEHASH, digest, launchId, factory, address(POOL_MANAGER), poolId));
    }

    function _stampRequestHashCalldata(StampRequestV2 calldata request) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                STAMP_REQUEST_TYPEHASH,
                request.launchId,
                request.token,
                request.tokenRuntimeCodeHash,
                request.hook,
                request.hookRuntimeCodeHash,
                request.nft,
                request.nftRuntimeCodeHash,
                _poolKeyHash(request.poolKey)
            )
        );
    }

    function _stampRequestHash(StampRequestV2 memory request) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                STAMP_REQUEST_TYPEHASH,
                request.launchId,
                request.token,
                request.tokenRuntimeCodeHash,
                request.hook,
                request.hookRuntimeCodeHash,
                request.nft,
                request.nftRuntimeCodeHash,
                _poolKeyHash(request.poolKey)
            )
        );
    }

    function _poolKeyHash(PoolKey memory poolKey) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POOL_KEY_TYPEHASH,
                Currency.unwrap(poolKey.currency0),
                Currency.unwrap(poolKey.currency1),
                poolKey.fee,
                poolKey.tickSpacing,
                address(poolKey.hooks)
            )
        );
    }

    function _requireCode(uint8 field, address account) private view {
        if (account == address(0) || account.code.length == 0) revert InvalidBinding(field);
    }

    function _requireRuntime(address account, bytes32 expected) private view {
        bytes32 actual = account.codehash;
        if (account.code.length == 0 || expected == bytes32(0) || actual != expected) {
            revert InvalidComponent(account, expected, actual);
        }
    }

    function _requireVacant(address account) private view {
        if (account.code.length != 0) revert AddressAlreadyOccupied(account);
    }

    function _reservedPlanComponent(address component, address module) private view returns (bool) {
        return component == address(this) || component == module || component == PERMIT_AUTHORITY
            || component == CAPABILITY_ADMIN || component == address(POOL_MANAGER);
    }

    function _requireUnreservedProfileComponent(address component) private view {
        bytes32 profileKey = _registeredComponentProfile[component];
        if (profileKey != bytes32(0)) revert ProfileAlreadyRegistered(profileKey);
        _requireUnstamped(component);
    }

    function _reserveProfileComponent(address component, bytes32 profileKey) private {
        _registeredComponentProfile[component] = profileKey;
    }

    function _requireUnstamped(address component) private view {
        bytes32 launchId = launchIdByComponent[component];
        if (launchId != bytes32(0)) revert ComponentAlreadyStamped(component, launchId);
    }

    function _requireBaseline(uint256 baseline) private view {
        if (address(this).balance != baseline) revert ResidualLaunchValue(baseline, address(this).balance);
    }

    function _poolLookupKey(address poolManager, bytes32 poolId) private pure returns (bytes32) {
        return keccak256(abi.encode(poolManager, poolId));
    }
}
