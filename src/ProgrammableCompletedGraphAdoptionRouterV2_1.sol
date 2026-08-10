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
import { LibRLP } from "solady/utils/LibRLP.sol";

import {
    IProgrammableCompletedGraphAdoptionRouterV2_1
} from "./interfaces/IProgrammableCompletedGraphAdoptionRouterV2_1.sol";
import { IProgrammableLaunchStampRouterV2 } from "./interfaces/IProgrammableLaunchStampRouterV2.sol";

interface IProgrammableLaunchStampRouterV2RoleView {
    function CAPABILITY_ADMIN() external view returns (address);

    function CAPABILITY_ADMIN_RUNTIME_CODE_HASH() external view returns (bytes32);
}

/// @title ProgrammableCompletedGraphAdoptionRouterV2_1
/// @notice Adoption-only Router for immutable, authority-permitted normal-CREATE component graphs.
/// @dev This is a separate inactive candidate because the frozen Router V2 runtime has insufficient EIP-170 margin.
///      It does not modify or inherit Router V2. The permit, replay, one-winner stamp, component collision, pool
///      collision, zero-value, and short-lived authority invariants are retained. A profile registration fixes one
///      schema and policy for any number of typed applicant plans. There is no external execution target, selector,
///      opaque payload, delegatecall, CREATE, token transfer, approval, or allowance path.
contract ProgrammableCompletedGraphAdoptionRouterV2_1 is
    IProgrammableCompletedGraphAdoptionRouterV2_1,
    EIP712,
    ReentrancyGuard
{
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint64 public constant MAX_PERMIT_LIFETIME = 1 hours;
    uint256 public constant CHAIN_ID = 1;
    uint256 public constant MIN_COMPONENTS = 2;
    uint256 public constant MAX_COMPONENTS = 16;
    uint256 public constant MIN_EDGES = 1;
    uint256 public constant MAX_EDGES = 32;

    address public constant MAINNET_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 public constant POOL_MANAGER_RUNTIME_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    address public constant SEALED_PARENT_CAPABILITY_ADMIN = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 public constant SEALED_PARENT_CAPABILITY_ADMIN_RUNTIME_CODE_HASH =
        0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;

    bytes32 private constant SHARDS_PROFILE_KEY = 0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
    address private constant SHARDS_FACTORY = 0x9442a520e7b31D10177C75A363355C2C29141ac5;
    address private constant SHARDS_RENDERER = 0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14;
    address private constant SHARDS_TOKEN = 0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF;
    address private constant SHARDS_HOOK = 0xbA318baA8649962fD77CC7082d098f2C09Fd60cC;
    address private constant SHARDS_NFT = 0x9fDA98dE1B7061ae02A9Aec7A6f8ed75a8Feb8F3;
    bytes32 private constant SHARDS_POOL_ID = 0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d;

    bytes32 public constant ROUTE_ID_HASH = keccak256("normal-create-adoption");
    bytes32 public constant ROUTE_VERSION_HASH = keccak256("1.0.0");
    bytes32 public constant NORMAL_CREATE_ADOPTION_PROFILE_ID_HASH = keccak256("NORMAL_CREATE_ADOPTION_V1");
    bytes32 public constant NORMAL_CREATE_ADOPTION_PROFILE_VERSION_HASH = keccak256("1.0.0");
    bytes32 public constant NORMAL_CREATE_ADOPTION_SCHEMA_HASH = keccak256(
        "ProgrammableNormalCreateAdoptionSchemaV1(adoptCompletedGraphV1(LaunchPermitV2_1,CompletedGraphPlanV1,StampRequestV2_1,ComponentV1[],GraphEdgeV1[],bytes),creator=launchWallet,reviewAdmission=immutable,currentPoolState=jit-permit-bound-slot0-liquidity-fee-growth,create=RLP,componentConfig=immutable-code-and-creation-evidence-only,parentCapabilityAdmin=sealed-canonical-create2-proxy,components=2..16,edges=1..32,value=0,allowances=empty,mode=COMPLETED_GRAPH_ADOPTED)"
    );
    bytes32 public constant EMPTY_ALLOWANCE_CAPS_HASH = keccak256("ProgrammableAllowanceCapsV1([])");

    bytes32 public constant PROFILE_KEY_TYPEHASH =
        keccak256("ProgrammableCompletedGraphProfileV1(bytes32 profileIdHash,bytes32 profileVersionHash)");
    bytes32 public constant COMPONENT_TYPEHASH = keccak256(
        "ProgrammableNormalCreateComponentV1(address account,uint8 kind,uint64 createNonce,bytes32 creationCodeHash,bytes32 runtimeCodeHash,bytes32 configurationHash,bytes32 creationEvidenceHash)"
    );
    bytes32 public constant IMMUTABLE_COMPONENT_CONFIGURATION_TYPEHASH = keccak256(
        "ProgrammableImmutableNormalCreateConfigurationV1(address account,uint8 kind,uint64 createNonce,bytes32 creationCodeHash,bytes32 runtimeCodeHash,bytes32 creationEvidenceHash)"
    );
    bytes32 public constant EDGE_TYPEHASH =
        keccak256("ProgrammableCompletedGraphEdgeV1(uint8 fromIndex,uint8 toIndex,uint8 kind,bytes32 relationHash)");
    bytes32 public constant COMPONENT_GRAPH_TYPEHASH =
        keccak256("ProgrammableCompletedGraphV1(address creator,bytes32 componentsHash,bytes32 edgesHash)");
    bytes32 public constant POOL_KEY_TYPEHASH = keccak256(
        "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"
    );
    bytes32 public constant CONFIGURATION_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphConfigurationV1(bytes32 componentGraphHash,bytes32 policyHash,bytes32 poolKeyHash)"
    );
    bytes32 public constant POOL_BINDING_RELATION_TYPEHASH =
        keccak256("ProgrammableCompletedGraphPoolBindingV1(bytes32 poolKeyHash)");
    bytes32 public constant POOL_RESULT_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphPoolResultV1(address poolManager,bytes32 poolId,bytes32 poolKeyHash,uint160 initializedSqrtPriceX96,bytes32 initializationEvidenceHash)"
    );
    bytes32 public constant POOL_STATE_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphPoolStateV1(address poolManager,bytes32 poolId,bytes32 poolKeyHash,uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee,uint128 activeLiquidity,uint256 feeGrowthGlobal0X128,uint256 feeGrowthGlobal1X128)"
    );
    bytes32 public constant RESULT_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphResultV1(bytes32 componentGraphHash,bytes32 configurationHash,bytes32 poolResultHash)"
    );
    bytes32 public constant PLAN_TYPEHASH = keccak256(
        "ProgrammableNormalCreateAdoptionPlanV1(bytes32 profileIdHash,bytes32 profileVersionHash,bytes32 routeSchemaHash,bytes32 sourceCommitHash,bytes32 sourceTreeHash,bytes32 manifestHash,bytes32 policyHash,bytes32 reviewAdmissionHash,address launchWallet,address creator,bytes32 creationEvidenceHash,bytes32 componentGraphHash,bytes32 configurationHash,bytes32 poolKeyHash,uint160 initializedSqrtPriceX96,bytes32 poolInitializationEvidenceHash,bytes32 poolResultHash,bytes32 resultHash,uint256 maxNativeValueWei,bytes32 allowanceCapsHash)"
    );
    bytes32 public constant LAUNCH_ID_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphLaunchIdV1(uint256 chainId,address launchWallet,bytes32 routeIdHash,bytes32 routeVersionHash,bytes32 profileKey,bytes32 planHash)"
    );
    bytes32 public constant STAMP_REQUEST_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphStampRequestV1(bytes32 launchId,bytes32 profileKey,bytes32 componentGraphHash,bytes32 poolId,bytes32 poolKeyHash,bytes32 resultHash,bytes32 currentPoolStateHash)"
    );
    bytes32 public constant LAUNCH_PERMIT_TYPEHASH = keccak256(
        "ProgrammableLaunchPermitV2_1(uint256 chainId,address router,address launchWallet,bytes32 routeIdHash,bytes32 routeVersionHash,bytes32 profileKey,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)"
    );
    bytes32 public constant LAUNCH_STAMP_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphStampV2_1(bytes32 permitDigest,bytes32 launchId,uint8 executionMode,bytes32 profileKey,bytes32 componentGraphHash,address poolManager,bytes32 poolId)"
    );

    string private constant EIP712_NAME = "ProgrammableCompletedGraphAdoptionRouter";
    string private constant EIP712_VERSION = "2.1.0";

    address public immutable PERMIT_AUTHORITY;
    bytes32 public immutable PERMIT_AUTHORITY_RUNTIME_CODE_HASH;
    address public immutable CAPABILITY_ADMIN;
    bytes32 public immutable CAPABILITY_ADMIN_RUNTIME_CODE_HASH;
    IProgrammableLaunchStampRouterV2 public immutable PARENT_ROUTER;
    bytes32 public immutable PARENT_ROUTER_RUNTIME_CODE_HASH;
    address public immutable PARENT_SHARDS_PROFILE;
    IPoolManager public immutable POOL_MANAGER;

    mapping(bytes32 profileKey => ProfileCapabilityV2_1 capability) private _profileCapability;
    mapping(bytes32 launchId => StampRecordV2_1 record) private _launchStamp;
    mapping(address launchWallet => mapping(bytes32 nonce => bool used)) private _usedNonce;
    mapping(bytes32 permitDigest => bool used) private _usedPermitDigest;
    mapping(bytes32 poolLookupKey => bytes32 launchId) private _launchIdByPool;

    mapping(address token => bytes32 launchId) public override launchIdByToken;
    mapping(address component => bytes32 launchId) public override launchIdByComponent;
    mapping(bytes32 componentGraphHash => bytes32 launchId) public override launchIdByGraphHash;
    mapping(address component => bytes32 runtimeCodeHash) public override componentRuntimeCodeHash;

    struct PreparedAdoptionV2_1 {
        bytes32 profileKey;
        bytes32 planHash;
        bytes32 launchId;
        bytes32 poolId;
        bytes32 poolKeyHash;
        address token;
        address hook;
        address nft;
    }

    struct ComponentRolesV1 {
        address token;
        address hook;
        address nft;
        uint8 tokenCount;
        uint8 hookCount;
        uint8 nftCount;
        uint8 tokenIndex;
        uint8 hookIndex;
    }

    struct PlanCommitmentV1 {
        bytes32 typeHash;
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
        bytes32 poolKeyHash;
        uint160 initializedSqrtPriceX96;
        bytes32 poolInitializationEvidenceHash;
        bytes32 poolResultHash;
        bytes32 resultHash;
        uint256 maxNativeValueWei;
        bytes32 allowanceCapsHash;
    }

    error ComponentAlreadyStamped(address component, bytes32 launchId);
    error GraphAlreadyStamped(bytes32 componentGraphHash, bytes32 launchId);
    error InvalidBinding(uint8 field);
    error InvalidComponent(uint256 index, address component, bytes32 supplied, bytes32 actual);
    error InvalidCreateAddress(uint256 index, address supplied, address expected);
    error InvalidGraphOrder(uint256 index);
    error InvalidGraphShape(uint256 componentCount, uint256 edgeCount);
    error InvalidPermitSignature();
    error LaunchAlreadyStamped(bytes32 launchId);
    error NonceAlreadyUsed(address launchWallet, bytes32 nonce);
    error PermitAlreadyUsed(bytes32 permitDigest);
    error PermitOutsideValidityWindow(uint256 timestamp, uint256 validAfter, uint256 deadline);
    error PoolAlreadyStamped(address poolManager, bytes32 poolId, bytes32 launchId);
    error PoolNotInitialized(address poolManager, bytes32 poolId);
    error ProfileAlreadyRegistered(bytes32 profileKey);
    error ProfileNotRegistered(bytes32 profileKey);
    error ResidualLaunchValue(uint256 expected, uint256 actual);
    error UnauthorizedCapabilityAdmin(address caller);
    error UnauthorizedLaunchWallet(address caller, address launchWallet);

    constructor(address permitAuthority, address capabilityAdmin, address parentRouter)
        EIP712(EIP712_NAME, EIP712_VERSION)
    {
        if (block.chainid != CHAIN_ID) revert InvalidBinding(1);
        _requireCode(2, permitAuthority);
        _requireCode(3, capabilityAdmin);
        _requireCode(4, parentRouter);
        _requireRuntime(MAINNET_POOL_MANAGER, POOL_MANAGER_RUNTIME_CODE_HASH);
        if (
            permitAuthority == capabilityAdmin || permitAuthority == parentRouter || capabilityAdmin == parentRouter
                || permitAuthority == MAINNET_POOL_MANAGER || capabilityAdmin == MAINNET_POOL_MANAGER
                || parentRouter == MAINNET_POOL_MANAGER
        ) revert InvalidBinding(5);

        IProgrammableLaunchStampRouterV2 typedParent = IProgrammableLaunchStampRouterV2(parentRouter);
        IProgrammableLaunchStampRouterV2RoleView parentRoles = IProgrammableLaunchStampRouterV2RoleView(parentRouter);
        if (
            parentRoles.CAPABILITY_ADMIN() != SEALED_PARENT_CAPABILITY_ADMIN
                || parentRoles.CAPABILITY_ADMIN_RUNTIME_CODE_HASH() != SEALED_PARENT_CAPABILITY_ADMIN_RUNTIME_CODE_HASH
        ) revert InvalidBinding(5);
        _requireRuntime(SEALED_PARENT_CAPABILITY_ADMIN, SEALED_PARENT_CAPABILITY_ADMIN_RUNTIME_CODE_HASH);
        IProgrammableLaunchStampRouterV2.ProfileCapabilityV2 memory shardsCapability =
            typedParent.profileCapability(SHARDS_PROFILE_KEY);
        if (
            !shardsCapability.enabled || !shardsCapability.builtin || shardsCapability.module == address(0)
                || shardsCapability.moduleRuntimeCodeHash == bytes32(0)
        ) revert InvalidBinding(5);
        _requireRuntime(shardsCapability.module, shardsCapability.moduleRuntimeCodeHash);

        PERMIT_AUTHORITY = permitAuthority;
        PERMIT_AUTHORITY_RUNTIME_CODE_HASH = permitAuthority.codehash;
        CAPABILITY_ADMIN = capabilityAdmin;
        CAPABILITY_ADMIN_RUNTIME_CODE_HASH = capabilityAdmin.codehash;
        PARENT_ROUTER = typedParent;
        PARENT_ROUTER_RUNTIME_CODE_HASH = parentRouter.codehash;
        PARENT_SHARDS_PROFILE = shardsCapability.module;
        POOL_MANAGER = IPoolManager(MAINNET_POOL_MANAGER);
    }

    /// @notice Registers one reusable normal-CREATE adoption profile. There is no replacement, removal, or per-plan
    ///         registration. The exact policy is profile/version-bound and cannot be supplied as a runtime fee input.
    function registerCompletedGraphProfileV1(
        bytes32 profileIdHash,
        bytes32 profileVersionHash,
        bytes32 schemaHash,
        bytes32 policyHash
    ) external override nonReentrant returns (bytes32 profileKey) {
        if (msg.sender != CAPABILITY_ADMIN) revert UnauthorizedCapabilityAdmin(msg.sender);
        _requireRuntime(CAPABILITY_ADMIN, CAPABILITY_ADMIN_RUNTIME_CODE_HASH);
        if (
            profileIdHash != NORMAL_CREATE_ADOPTION_PROFILE_ID_HASH
                || profileVersionHash != NORMAL_CREATE_ADOPTION_PROFILE_VERSION_HASH
                || schemaHash != NORMAL_CREATE_ADOPTION_SCHEMA_HASH || policyHash == bytes32(0)
        ) revert InvalidBinding(6);

        profileKey = computeProfileKey(profileIdHash, profileVersionHash);
        if (_profileCapability[profileKey].enabled) revert ProfileAlreadyRegistered(profileKey);
        _profileCapability[profileKey] = ProfileCapabilityV2_1({
            profileIdHash: profileIdHash,
            profileVersionHash: profileVersionHash,
            schemaHash: schemaHash,
            policyHash: policyHash,
            enabled: true
        });
        emit ProgrammableCompletedGraphProfileRegisteredV2_1(
            profileKey, profileIdHash, profileVersionHash, schemaHash, policyHash
        );
    }

    /// @notice Atomically validates and stamps a completed graph. It never calls any applicant component.
    /// @dev This profile admits only security-relevant component configuration committed by immutable runtime and
    ///      creation evidence; arbitrary mutable-storage configuration is unsupported. Runtime hashes, CREATE
    ///      addresses, graph shape, PoolKey, exact JIT pool state, all collisions, and the permit are checked onchain.
    function adoptCompletedGraphV1(
        LaunchPermitV2_1 calldata permit,
        CompletedGraphPlanV1 calldata plan,
        StampRequestV2_1 calldata request,
        ComponentV1[] calldata components,
        GraphEdgeV1[] calldata edges,
        bytes calldata signature
    ) external payable override nonReentrant returns (bytes32 stampHash) {
        uint256 baseline = address(this).balance - msg.value;
        PreparedAdoptionV2_1 memory state = _prepareAdoption(permit, plan, request, components, edges);
        bytes32 digest = _consumePermit(permit, signature);
        stampHash = _writeStamp(plan, request, components, state, digest);
        _requireBaseline(baseline);
    }

    function permitDigest(LaunchPermitV2_1 calldata permit) public view override returns (bytes32) {
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

    function computeProfileKey(bytes32 profileIdHash, bytes32 profileVersionHash)
        public
        pure
        override
        returns (bytes32)
    {
        return keccak256(abi.encode(PROFILE_KEY_TYPEHASH, profileIdHash, profileVersionHash));
    }

    function computeComponentGraphHash(address creator, ComponentV1[] calldata components, GraphEdgeV1[] calldata edges)
        public
        pure
        override
        returns (bytes32)
    {
        return _componentGraphHash(creator, components, edges);
    }

    function computeConfigurationHash(bytes32 componentGraphHash, bytes32 policyHash, bytes32 poolKeyHash)
        public
        pure
        override
        returns (bytes32)
    {
        return keccak256(abi.encode(CONFIGURATION_TYPEHASH, componentGraphHash, policyHash, poolKeyHash));
    }

    function computePoolKeyHash(PoolKey calldata poolKey) public pure override returns (bytes32) {
        return _poolKeyHash(poolKey);
    }

    function computePoolResultHash(
        PoolKey calldata poolKey,
        uint160 initializedSqrtPriceX96,
        bytes32 initializationEvidenceHash
    ) public pure override returns (bytes32) {
        return keccak256(
            abi.encode(
                POOL_RESULT_TYPEHASH,
                MAINNET_POOL_MANAGER,
                PoolId.unwrap(poolKey.toId()),
                _poolKeyHash(poolKey),
                initializedSqrtPriceX96,
                initializationEvidenceHash
            )
        );
    }

    function computePoolStateHash(
        PoolKey calldata poolKey,
        uint160 sqrtPriceX96,
        int24 tick,
        uint24 protocolFee,
        uint24 lpFee,
        uint128 activeLiquidity,
        uint256 feeGrowthGlobal0X128,
        uint256 feeGrowthGlobal1X128
    ) public pure override returns (bytes32) {
        return keccak256(
            abi.encode(
                POOL_STATE_TYPEHASH,
                MAINNET_POOL_MANAGER,
                PoolId.unwrap(poolKey.toId()),
                _poolKeyHash(poolKey),
                sqrtPriceX96,
                tick,
                protocolFee,
                lpFee,
                activeLiquidity,
                feeGrowthGlobal0X128,
                feeGrowthGlobal1X128
            )
        );
    }

    function computeResultHash(bytes32 componentGraphHash, bytes32 configurationHash, bytes32 poolResultHash)
        public
        pure
        override
        returns (bytes32)
    {
        return keccak256(abi.encode(RESULT_TYPEHASH, componentGraphHash, configurationHash, poolResultHash));
    }

    function computePlanHash(CompletedGraphPlanV1 calldata plan) public pure override returns (bytes32) {
        PlanCommitmentV1 memory commitment;
        commitment.typeHash = PLAN_TYPEHASH;
        commitment.profileIdHash = plan.profileIdHash;
        commitment.profileVersionHash = plan.profileVersionHash;
        commitment.routeSchemaHash = plan.routeSchemaHash;
        commitment.sourceCommitHash = plan.sourceCommitHash;
        commitment.sourceTreeHash = plan.sourceTreeHash;
        commitment.manifestHash = plan.manifestHash;
        commitment.policyHash = plan.policyHash;
        commitment.reviewAdmissionHash = plan.reviewAdmissionHash;
        commitment.launchWallet = plan.launchWallet;
        commitment.creator = plan.creator;
        commitment.creationEvidenceHash = plan.creationEvidenceHash;
        commitment.componentGraphHash = plan.componentGraphHash;
        commitment.configurationHash = plan.configurationHash;
        commitment.poolKeyHash = _poolKeyHash(plan.poolKey);
        commitment.initializedSqrtPriceX96 = plan.initializedSqrtPriceX96;
        commitment.poolInitializationEvidenceHash = plan.poolInitializationEvidenceHash;
        commitment.poolResultHash = plan.poolResultHash;
        commitment.resultHash = plan.resultHash;
        commitment.maxNativeValueWei = plan.maxNativeValueWei;
        commitment.allowanceCapsHash = plan.allowanceCapsHash;
        return keccak256(abi.encode(commitment));
    }

    function computeLaunchId(address launchWallet, bytes32 profileKey, bytes32 planHash)
        public
        pure
        override
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                LAUNCH_ID_TYPEHASH, CHAIN_ID, launchWallet, ROUTE_ID_HASH, ROUTE_VERSION_HASH, profileKey, planHash
            )
        );
    }

    function computeStampRequestHash(StampRequestV2_1 calldata request) public pure override returns (bytes32) {
        return _stampRequestHash(request);
    }

    function profileCapability(bytes32 profileKey) external view override returns (ProfileCapabilityV2_1 memory) {
        return _profileCapability[profileKey];
    }

    function launchStamp(bytes32 launchId) external view override returns (StampRecordV2_1 memory) {
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

    function _prepareAdoption(
        LaunchPermitV2_1 calldata permit,
        CompletedGraphPlanV1 calldata plan,
        StampRequestV2_1 calldata request,
        ComponentV1[] calldata components,
        GraphEdgeV1[] calldata edges
    ) private view returns (PreparedAdoptionV2_1 memory state) {
        state.profileKey = computeProfileKey(plan.profileIdHash, plan.profileVersionHash);
        ProfileCapabilityV2_1 memory capability = _profileCapability[state.profileKey];
        if (!capability.enabled) revert ProfileNotRegistered(state.profileKey);

        state.poolKeyHash = _validatePlanCommitments(plan, components, edges, capability);
        ComponentRolesV1 memory roles = _validateObservedComponents(plan, components);
        state.token = roles.token;
        state.hook = roles.hook;
        state.nft = roles.nft;
        _validatePoolRoles(plan.poolKey, roles, edges, state.poolKeyHash);

        state.poolId = PoolId.unwrap(plan.poolKey.toId());
        state.planHash = computePlanHash(plan);
        state.launchId = computeLaunchId(plan.launchWallet, state.profileKey, state.planHash);
        _validateStampRequest(plan, request, state);
        _validateCurrentPoolState(plan, state.poolId, request.currentPoolStateHash);
        _validatePermit(permit, plan, state, _stampRequestHash(request));
        _requireAvailable(state.launchId, plan.componentGraphHash, state.poolId);
    }

    function _validateStampRequest(
        CompletedGraphPlanV1 calldata plan,
        StampRequestV2_1 calldata request,
        PreparedAdoptionV2_1 memory state
    ) private pure {
        if (
            request.launchId != state.launchId || request.profileKey != state.profileKey
                || request.componentGraphHash != plan.componentGraphHash || request.poolId != state.poolId
                || request.poolKeyHash != state.poolKeyHash || request.resultHash != plan.resultHash
                || request.currentPoolStateHash == bytes32(0)
        ) revert InvalidBinding(15);
    }

    function _validateCurrentPoolState(CompletedGraphPlanV1 calldata plan, bytes32 poolId, bytes32 currentPoolStateHash)
        private
        view
    {
        PoolId typedPoolId = plan.poolKey.toId();
        (uint160 currentSqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) = POOL_MANAGER.getSlot0(typedPoolId);
        if (currentSqrtPriceX96 == 0) revert PoolNotInitialized(address(POOL_MANAGER), poolId);
        uint128 activeLiquidity = POOL_MANAGER.getLiquidity(typedPoolId);
        (uint256 feeGrowthGlobal0X128, uint256 feeGrowthGlobal1X128) = POOL_MANAGER.getFeeGrowthGlobals(typedPoolId);
        if (
            computePoolStateHash(
                    plan.poolKey,
                    currentSqrtPriceX96,
                    tick,
                    protocolFee,
                    lpFee,
                    activeLiquidity,
                    feeGrowthGlobal0X128,
                    feeGrowthGlobal1X128
                ) != currentPoolStateHash
        ) {
            revert InvalidBinding(17);
        }
    }

    function _validatePlanCommitments(
        CompletedGraphPlanV1 calldata plan,
        ComponentV1[] calldata components,
        GraphEdgeV1[] calldata edges,
        ProfileCapabilityV2_1 memory capability
    ) private view returns (bytes32 poolKeyHash) {
        if (
            plan.profileIdHash != capability.profileIdHash || plan.profileVersionHash != capability.profileVersionHash
                || plan.routeSchemaHash != NORMAL_CREATE_ADOPTION_SCHEMA_HASH
                || capability.schemaHash != NORMAL_CREATE_ADOPTION_SCHEMA_HASH
                || plan.policyHash != capability.policyHash || plan.sourceCommitHash == bytes32(0)
                || plan.sourceTreeHash == bytes32(0) || plan.manifestHash == bytes32(0)
                || plan.reviewAdmissionHash == bytes32(0) || plan.launchWallet == address(0)
                || plan.creator != plan.launchWallet || plan.creationEvidenceHash == bytes32(0)
                || plan.componentGraphHash == bytes32(0) || plan.configurationHash == bytes32(0)
                || plan.initializedSqrtPriceX96 == 0 || plan.poolInitializationEvidenceHash == bytes32(0)
                || plan.poolResultHash == bytes32(0) || plan.resultHash == bytes32(0) || plan.maxNativeValueWei != 0
                || plan.allowanceCapsHash != EMPTY_ALLOWANCE_CAPS_HASH
        ) revert InvalidBinding(7);
        if (plan.creator.code.length != 0) revert InvalidBinding(8);
        _requireRuntime(address(POOL_MANAGER), POOL_MANAGER_RUNTIME_CODE_HASH);
        _requireRuntime(address(PARENT_ROUTER), PARENT_ROUTER_RUNTIME_CODE_HASH);

        bytes32 graphHash = _componentGraphHash(plan.creator, components, edges);
        if (graphHash != plan.componentGraphHash) revert InvalidBinding(9);
        poolKeyHash = _poolKeyHash(plan.poolKey);
        if (computeConfigurationHash(graphHash, plan.policyHash, poolKeyHash) != plan.configurationHash) {
            revert InvalidBinding(10);
        }
        if (
            computePoolResultHash(plan.poolKey, plan.initializedSqrtPriceX96, plan.poolInitializationEvidenceHash)
                != plan.poolResultHash
        ) revert InvalidBinding(11);
        if (computeResultHash(graphHash, plan.configurationHash, plan.poolResultHash) != plan.resultHash) {
            revert InvalidBinding(12);
        }
    }

    function _validateObservedComponents(CompletedGraphPlanV1 calldata plan, ComponentV1[] calldata components)
        private
        view
        returns (ComponentRolesV1 memory roles)
    {
        for (uint256 i; i < components.length; ++i) {
            ComponentV1 calldata component = components[i];
            if (
                component.account == address(this) || component.account == address(PARENT_ROUTER)
                    || component.account == PARENT_SHARDS_PROFILE || _isExactShardsReservedComponent(component.account)
                    || component.account == PERMIT_AUTHORITY || component.account == CAPABILITY_ADMIN
                    || component.account == address(POOL_MANAGER) || component.account == plan.creator
            ) revert InvalidBinding(13);
            bytes32 actual = component.account.codehash;
            if (
                component.account.code.length == 0 || component.runtimeCodeHash == bytes32(0)
                    || actual != component.runtimeCodeHash
            ) revert InvalidComponent(i, component.account, component.runtimeCodeHash, actual);

            bytes32 existingLaunchId = launchIdByComponent[component.account];
            if (existingLaunchId != bytes32(0)) {
                revert ComponentAlreadyStamped(component.account, existingLaunchId);
            }
            existingLaunchId = PARENT_ROUTER.launchIdByComponent(component.account);
            if (existingLaunchId != bytes32(0)) {
                revert ComponentAlreadyStamped(component.account, existingLaunchId);
            }

            if (component.kind == ComponentKindV2_1.Token) {
                roles.token = component.account;
                // `components.length` is hard-capped at 16 by `_componentGraphHash`.
                // forge-lint: disable-next-line(unsafe-typecast)
                roles.tokenIndex = uint8(i);
                ++roles.tokenCount;
            } else if (component.kind == ComponentKindV2_1.Hook) {
                roles.hook = component.account;
                // `components.length` is hard-capped at 16 by `_componentGraphHash`.
                // forge-lint: disable-next-line(unsafe-typecast)
                roles.hookIndex = uint8(i);
                ++roles.hookCount;
            } else if (component.kind == ComponentKindV2_1.Nft) {
                roles.nft = component.account;
                ++roles.nftCount;
            }
        }
        bytes32 tokenLaunchId = launchIdByToken[roles.token];
        if (tokenLaunchId != bytes32(0)) revert ComponentAlreadyStamped(roles.token, tokenLaunchId);
        tokenLaunchId = PARENT_ROUTER.launchIdByToken(roles.token);
        if (tokenLaunchId != bytes32(0)) revert ComponentAlreadyStamped(roles.token, tokenLaunchId);
    }

    function _validatePoolRoles(
        PoolKey calldata poolKey,
        ComponentRolesV1 memory roles,
        GraphEdgeV1[] calldata edges,
        bytes32 poolKeyHash
    ) private pure {
        address currency0 = Currency.unwrap(poolKey.currency0);
        address currency1 = Currency.unwrap(poolKey.currency1);
        address poolHook = address(poolKey.hooks);
        if (
            currency0 >= currency1 || roles.tokenCount != 1 || (roles.token != currency0 && roles.token != currency1)
                || roles.nftCount > 1 || (poolHook == address(0) && roles.hookCount != 0)
                || (poolHook != address(0) && (roles.hookCount != 1 || roles.hook != poolHook))
        ) revert InvalidBinding(14);
        bytes32 expectedRelationHash = keccak256(abi.encode(POOL_BINDING_RELATION_TYPEHASH, poolKeyHash));
        uint256 poolBindingCount;
        for (uint256 i; i < edges.length; ++i) {
            if (edges[i].kind != EdgeKindV1.PoolBinds) continue;
            ++poolBindingCount;
            if (
                poolHook == address(0) || edges[i].fromIndex != roles.tokenIndex || edges[i].toIndex != roles.hookIndex
                    || edges[i].relationHash != expectedRelationHash
            ) revert InvalidBinding(14);
        }
        if ((poolHook == address(0) && poolBindingCount != 0) || (poolHook != address(0) && poolBindingCount != 1)) {
            revert InvalidBinding(14);
        }
    }

    function _validatePermit(
        LaunchPermitV2_1 calldata permit,
        CompletedGraphPlanV1 calldata plan,
        PreparedAdoptionV2_1 memory state,
        bytes32 stampRequestHash
    ) private view {
        _requireRuntime(PERMIT_AUTHORITY, PERMIT_AUTHORITY_RUNTIME_CODE_HASH);
        if (msg.sender != plan.launchWallet || permit.launchWallet != plan.launchWallet) {
            revert UnauthorizedLaunchWallet(msg.sender, plan.launchWallet);
        }
        if (
            permit.chainId != CHAIN_ID || block.chainid != CHAIN_ID || permit.router != address(this)
                || permit.routeIdHash != ROUTE_ID_HASH || permit.routeVersionHash != ROUTE_VERSION_HASH
                || permit.profileKey != state.profileKey || permit.routePayloadHash != state.planHash
                || permit.expectedResultHash != plan.resultHash || permit.stampRequestHash != stampRequestHash
                || permit.nonce != state.launchId || permit.value != msg.value || permit.value != 0
        ) revert InvalidBinding(15);
        // Timestamp bounds are the intended EIP-712 permit validity mechanism, not a source of entropy.
        uint256 currentTimestamp = block.timestamp;
        if (
            currentTimestamp < permit.validAfter || currentTimestamp > permit.deadline
                || permit.validAfter > permit.deadline
        ) revert PermitOutsideValidityWindow(currentTimestamp, permit.validAfter, permit.deadline);
        if (permit.deadline - permit.validAfter > MAX_PERMIT_LIFETIME) revert InvalidBinding(16);
    }

    function _consumePermit(LaunchPermitV2_1 calldata permit, bytes calldata signature)
        private
        returns (bytes32 digest)
    {
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

    function _requireAvailable(bytes32 launchId, bytes32 graphHash, bytes32 poolId) private view {
        if (poolId == SHARDS_POOL_ID) revert InvalidBinding(18);
        if (_launchStamp[launchId].stampHash != bytes32(0)) revert LaunchAlreadyStamped(launchId);
        bytes32 existingLaunchId = launchIdByGraphHash[graphHash];
        if (existingLaunchId != bytes32(0)) revert GraphAlreadyStamped(graphHash, existingLaunchId);
        existingLaunchId = _launchIdByPool[_poolLookupKey(address(POOL_MANAGER), poolId)];
        if (existingLaunchId != bytes32(0)) {
            revert PoolAlreadyStamped(address(POOL_MANAGER), poolId, existingLaunchId);
        }
        existingLaunchId = PARENT_ROUTER.launchIdByPool(address(POOL_MANAGER), poolId);
        if (existingLaunchId != bytes32(0)) {
            revert PoolAlreadyStamped(address(POOL_MANAGER), poolId, existingLaunchId);
        }
    }

    function _writeStamp(
        CompletedGraphPlanV1 calldata plan,
        StampRequestV2_1 calldata request,
        ComponentV1[] calldata components,
        PreparedAdoptionV2_1 memory state,
        bytes32 digest
    ) private returns (bytes32 stampHash) {
        ExecutionModeV2_1 executionMode = ExecutionModeV2_1.COMPLETED_GRAPH_ADOPTED;
        stampHash = _stampHash(
            digest, state.launchId, executionMode, state.profileKey, plan.componentGraphHash, state.poolId
        );
        StampRecordV2_1 storage record = _launchStamp[state.launchId];
        record.launchWallet = plan.launchWallet;
        record.creator = plan.creator;
        record.token = state.token;
        record.hook = state.hook;
        record.nft = state.nft;
        record.poolManager = address(POOL_MANAGER);
        record.poolId = state.poolId;
        record.poolKeyHash = state.poolKeyHash;
        record.routeIdHash = ROUTE_ID_HASH;
        record.routeVersionHash = ROUTE_VERSION_HASH;
        record.profileKey = state.profileKey;
        record.profileIdHash = plan.profileIdHash;
        record.profileVersionHash = plan.profileVersionHash;
        record.sourceCommitHash = plan.sourceCommitHash;
        record.sourceTreeHash = plan.sourceTreeHash;
        record.manifestHash = plan.manifestHash;
        record.policyHash = plan.policyHash;
        record.reviewAdmissionHash = plan.reviewAdmissionHash;
        record.creationEvidenceHash = plan.creationEvidenceHash;
        record.componentGraphHash = plan.componentGraphHash;
        record.configurationHash = plan.configurationHash;
        record.poolResultHash = plan.poolResultHash;
        record.currentPoolStateHash = request.currentPoolStateHash;
        record.resultHash = plan.resultHash;
        record.planHash = state.planHash;
        record.permitDigest = digest;
        record.stampHash = stampHash;
        record.executionMode = executionMode;

        launchIdByToken[state.token] = state.launchId;
        launchIdByGraphHash[plan.componentGraphHash] = state.launchId;
        _launchIdByPool[_poolLookupKey(address(POOL_MANAGER), state.poolId)] = state.launchId;
        for (uint256 i; i < components.length; ++i) {
            ComponentV1 calldata component = components[i];
            launchIdByComponent[component.account] = state.launchId;
            componentRuntimeCodeHash[component.account] = component.runtimeCodeHash;
            emit ProgrammableCompletedGraphComponentStampedV2_1(
                state.launchId,
                component.account,
                component.kind,
                component.runtimeCodeHash,
                component.configurationHash,
                ComponentScopeV2_1.Exclusive
            );
        }
        _emitRouteStamped(plan, request, state, digest, executionMode);
        emit ProgrammableCompletedGraphLaunchStampedV2_1(
            state.launchId,
            state.token,
            state.hook,
            state.nft,
            address(POOL_MANAGER),
            state.poolId,
            stampHash,
            executionMode
        );
    }

    function _emitRouteStamped(
        CompletedGraphPlanV1 calldata plan,
        StampRequestV2_1 calldata request,
        PreparedAdoptionV2_1 memory state,
        bytes32 digest,
        ExecutionModeV2_1 executionMode
    ) private {
        emit ProgrammableCompletedGraphRouteStampedV2_1(
            state.launchId,
            state.profileKey,
            plan.creator,
            state.planHash,
            plan.componentGraphHash,
            plan.manifestHash,
            plan.policyHash,
            plan.reviewAdmissionHash,
            plan.resultHash,
            request.currentPoolStateHash,
            digest,
            executionMode
        );
    }

    function _componentGraphHash(address creator, ComponentV1[] calldata components, GraphEdgeV1[] calldata edges)
        private
        pure
        returns (bytes32 graphHash)
    {
        uint256 componentCount = components.length;
        uint256 edgeCount = edges.length;
        if (
            creator == address(0) || componentCount < MIN_COMPONENTS || componentCount > MAX_COMPONENTS
                || edgeCount < MIN_EDGES || edgeCount > MAX_EDGES
        ) revert InvalidGraphShape(componentCount, edgeCount);

        bytes32[] memory componentHashes = new bytes32[](componentCount);
        uint64 previousNonce;
        for (uint256 i; i < componentCount; ++i) {
            ComponentV1 calldata component = components[i];
            uint8 kind = uint8(component.kind);
            if (
                component.account == address(0) || kind < uint8(ComponentKindV2_1.Factory)
                    || kind > uint8(ComponentKindV2_1.Auxiliary) || (i != 0 && component.createNonce <= previousNonce)
                    || component.creationCodeHash == bytes32(0) || component.runtimeCodeHash == bytes32(0)
                    || component.creationEvidenceHash == bytes32(0)
            ) revert InvalidGraphOrder(i);
            address expected = LibRLP.computeAddress(creator, component.createNonce);
            if (component.account != expected) revert InvalidCreateAddress(i, component.account, expected);
            bytes32 immutableConfigurationHash = keccak256(
                abi.encode(
                    IMMUTABLE_COMPONENT_CONFIGURATION_TYPEHASH,
                    component.account,
                    kind,
                    component.createNonce,
                    component.creationCodeHash,
                    component.runtimeCodeHash,
                    component.creationEvidenceHash
                )
            );
            if (component.configurationHash != immutableConfigurationHash) revert InvalidGraphOrder(i);
            previousNonce = component.createNonce;
            componentHashes[i] = keccak256(
                abi.encode(
                    COMPONENT_TYPEHASH,
                    component.account,
                    kind,
                    component.createNonce,
                    component.creationCodeHash,
                    component.runtimeCodeHash,
                    component.configurationHash,
                    component.creationEvidenceHash
                )
            );
        }

        bytes32[] memory edgeHashes = new bytes32[](edgeCount);
        uint256 reachable = 1;
        for (uint256 i; i < edgeCount; ++i) {
            GraphEdgeV1 calldata edge = edges[i];
            uint8 kind = uint8(edge.kind);
            if (
                edge.fromIndex >= componentCount || edge.toIndex >= componentCount || edge.fromIndex == edge.toIndex
                    || kind == 0 || kind > uint8(EdgeKindV1.PoolBinds) || edge.relationHash == bytes32(0)
                    || (i != 0 && !_edgeLess(edges[i - 1], edge))
            ) revert InvalidGraphOrder(componentCount + i);
            edgeHashes[i] = keccak256(abi.encode(EDGE_TYPEHASH, edge.fromIndex, edge.toIndex, kind, edge.relationHash));
        }
        for (uint256 pass; pass < componentCount; ++pass) {
            for (uint256 i; i < edgeCount; ++i) {
                uint256 fromMask = uint256(1) << edges[i].fromIndex;
                uint256 toMask = uint256(1) << edges[i].toIndex;
                if ((reachable & (fromMask | toMask)) != 0) reachable |= fromMask | toMask;
            }
        }
        if (reachable != (uint256(1) << componentCount) - 1) {
            revert InvalidGraphShape(componentCount, edgeCount);
        }
        graphHash = keccak256(
            abi.encode(
                COMPONENT_GRAPH_TYPEHASH,
                creator,
                keccak256(abi.encodePacked(componentHashes)),
                keccak256(abi.encodePacked(edgeHashes))
            )
        );
    }

    function _edgeLess(GraphEdgeV1 calldata left, GraphEdgeV1 calldata right) private pure returns (bool) {
        if (left.fromIndex != right.fromIndex) return left.fromIndex < right.fromIndex;
        if (left.toIndex != right.toIndex) return left.toIndex < right.toIndex;
        if (left.kind != right.kind) return uint8(left.kind) < uint8(right.kind);
        return uint256(left.relationHash) < uint256(right.relationHash);
    }

    function _isExactShardsReservedComponent(address component) private pure returns (bool) {
        return component == SHARDS_FACTORY || component == SHARDS_RENDERER || component == SHARDS_TOKEN
            || component == SHARDS_HOOK || component == SHARDS_NFT;
    }

    function _stampRequestHash(StampRequestV2_1 memory request) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                STAMP_REQUEST_TYPEHASH,
                request.launchId,
                request.profileKey,
                request.componentGraphHash,
                request.poolId,
                request.poolKeyHash,
                request.resultHash,
                request.currentPoolStateHash
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

    function _stampHash(
        bytes32 digest,
        bytes32 launchId,
        ExecutionModeV2_1 executionMode,
        bytes32 profileKey,
        bytes32 componentGraphHash,
        bytes32 poolId
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                LAUNCH_STAMP_TYPEHASH,
                digest,
                launchId,
                executionMode,
                profileKey,
                componentGraphHash,
                address(POOL_MANAGER),
                poolId
            )
        );
    }

    function _requireCode(uint8 field, address account) private view {
        if (account == address(0) || account.code.length == 0) revert InvalidBinding(field);
    }

    function _requireRuntime(address account, bytes32 expected) private view {
        bytes32 actual = account.codehash;
        if (account.code.length == 0 || expected == bytes32(0) || actual != expected) {
            revert InvalidComponent(type(uint256).max, account, expected, actual);
        }
    }

    function _requireBaseline(uint256 baseline) private view {
        if (address(this).balance != baseline) revert ResidualLaunchValue(baseline, address(this).balance);
    }

    function _poolLookupKey(address poolManager, bytes32 poolId) private pure returns (bytes32) {
        return keccak256(abi.encode(poolManager, poolId));
    }
}
