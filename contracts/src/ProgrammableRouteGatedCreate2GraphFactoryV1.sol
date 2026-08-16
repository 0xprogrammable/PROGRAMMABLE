// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCreate2GraphDeployerV1 } from "./interfaces/IProgrammableCreate2GraphDeployerV1.sol";
import {
    IProgrammableRouteGatedCreate2GraphFactoryV1
} from "./interfaces/IProgrammableRouteGatedCreate2GraphFactoryV1.sol";

interface IProgrammableCustomRegistryV2Identity {
    function CHAIN_ID() external view returns (uint256);
    function REGISTRY_GENERATION() external view returns (uint64);
    function MINIMUM_FINALITY_BLOCKS() external view returns (uint64);
    function REGISTRY_POLICY_COMMITMENT() external view returns (bytes32);
}

/// @title ProgrammableRouteGatedCreate2GraphFactoryV1
/// @notice Candidate-neutral, gateway-only wrapper around the frozen Generic-v2 CREATE2 graph deployer.
/// @dev The first two storage slots intentionally reproduce ProgrammableCreate2GraphDeployerV1 exactly because
///      deployGraph executes that reviewed implementation with delegatecall. The wrapper exposes only the current
///      Generic-v2 ABI and refuses every launch not routed by the immutable Registry-v2 gateway.
contract ProgrammableRouteGatedCreate2GraphFactoryV1 is IProgrammableRouteGatedCreate2GraphFactoryV1 {
    uint256 public constant MAX_TARGETS = 16;
    uint256 public constant MAX_TOTAL_INPUT_BYTES = 524_288;
    uint256 public constant MAX_TARGET_INIT_CODE_BYTES = 49_152;
    uint256 public constant MAX_TARGET_INITIALIZER_BYTES = 131_072;
    uint256 public constant MAX_INITIALIZER_REVERT_BYTES = 2048;

    bytes32 public constant GRAPH_TARGET_COMMITMENT_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,bytes32 initializerCalldataHash)"
    );
    bytes32 public constant GRAPH_COMMITMENT_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,bytes32 targetCommitmentsHash)"
    );
    bytes32 public constant TARGET_SALT_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)"
    );
    bytes32 public constant GRAPH_AUTHORIZATION_KEY_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphAuthorizationKeyV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,address authorizedLauncher)"
    );
    bytes32 public constant GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphDeploymentAccumulatorV1(bytes32 previous,uint256 targetIndex,bytes32 targetIdHash,address deployment,bytes32 effectiveSalt,bytes32 initCodeHash,bytes32 initializerCalldataHash,bytes32 runtimeCodeHash,uint256 deploymentValue,uint256 initializerValue)"
    );

    uint256 public constant MAINNET_CHAIN_ID = 1;
    address public constant CANONICAL_REGISTRY_V2 = 0x845506084a1AfB969fa4DeF444A2bdeEe794AAad;
    bytes32 public constant CANONICAL_REGISTRY_V2_RUNTIME_CODE_HASH =
        0x74d8196e2d40d030c66b147e835cbdf6dd0ab61c964fb3ef3890d86ed7daf074;
    bytes32 public constant CANONICAL_REGISTRY_V2_POLICY_COMMITMENT =
        0xa51733b58306cf89580bd3c4f39935583db3196c3ab62ecd73644fff2e13b892;
    uint64 public constant CANONICAL_REGISTRY_V2_FINALITY_BLOCKS = 12;
    address public constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 public constant CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 public constant REVIEWED_IMPLEMENTATION_RUNTIME_CODE_HASH =
        0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8;
    bytes20 public constant GENERIC_V2_SOURCE_COMMIT = hex"0ab53dcc50e3245eb653eacadd10545a6df8d49c";
    bytes32 public constant GENERIC_V2_SOURCE_TREE = 0x64503ba709d7f60498588a00d928e5fa2a8f858e000000000000000000000000;
    bytes32 public constant GENERIC_V2_SOURCE_SHA256 =
        0x06a3acaf9beeb68647af231f5524c5a34dc013d99611a1b2d0a6c80895f595e9;

    address public immutable IMPLEMENTATION;
    address public immutable AUTHORIZED_GATEWAY;
    bytes32 public immutable ROUTE_ADAPTER_BINDING_HASH;
    address public immutable REGISTRY;
    address public immutable POOL_MANAGER;

    // Exact delegate implementation storage layout. Do not reorder or insert storage above these fields.
    mapping(bytes32 authorizationKey => bool consumed) public consumedGraphAuthorization;
    bool private graphDeploymentActive;

    error DependencyRuntimeCodeHashMismatch(address dependency, bytes32 expected, bytes32 actual);
    error InvalidBinding(bytes32 field);
    error InvalidChain(uint256 supplied, uint256 required);
    error RegistryIdentityMismatch(bytes32 field);
    error UnauthorizedGateway(address caller, address required);

    constructor(address implementation, address authorizedGateway, bytes32 routeAdapterBindingHash) {
        if (block.chainid != MAINNET_CHAIN_ID) revert InvalidChain(block.chainid, MAINNET_CHAIN_ID);
        if (implementation == address(0)) revert InvalidBinding(bytes32("implementation"));
        if (authorizedGateway == address(0)) revert InvalidBinding(bytes32("gateway"));
        if (routeAdapterBindingHash == bytes32(0)) revert InvalidBinding(bytes32("adapter-binding"));
        IMPLEMENTATION = implementation;
        AUTHORIZED_GATEWAY = authorizedGateway;
        ROUTE_ADAPTER_BINDING_HASH = routeAdapterBindingHash;
        REGISTRY = CANONICAL_REGISTRY_V2;
        POOL_MANAGER = CANONICAL_POOL_MANAGER;
        _validateDependencies();
        _validateRegistryIdentity();
    }

    function deployGraph(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        payable
        returns (
            address[] memory deployments,
            bytes32[] memory runtimeCodeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        )
    {
        authorization;
        targets;
        if (msg.sender != AUTHORIZED_GATEWAY) {
            revert UnauthorizedGateway(msg.sender, AUTHORIZED_GATEWAY);
        }
        _validateDependencies();
        (bool success, bytes memory returnData) = IMPLEMENTATION.delegatecall(msg.data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        return abi.decode(returnData, (address[], bytes32[], bytes[], bytes32));
    }

    function computeGraphCommitment(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        view
        returns (bytes32 commitment, uint256 targetValueSum)
    {
        return _reviewedGraphCommitment(authorization, targets);
    }

    function effectiveTargetSalt(GraphAuthorization calldata authorization, bytes32 targetIdHash, bytes32 applicantSalt)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                TARGET_SALT_TYPEHASH,
                block.chainid,
                address(this),
                authorization.routeNamespace,
                authorization.routeNonce,
                targetIdHash,
                applicantSalt,
                authorization.authorizedLauncher
            )
        );
    }

    function predictTarget(GraphAuthorization calldata authorization, Target calldata target)
        external
        view
        returns (address)
    {
        if (target.targetIdHash == bytes32(0) || target.initCode.length == 0) revert InvalidGraphTarget(0);
        bytes32 salt = effectiveTargetSalt(authorization, target.targetIdHash, target.applicantSalt);
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(target.initCode)))))
        );
    }

    function graphAuthorizationKey(GraphAuthorization calldata authorization) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                GRAPH_AUTHORIZATION_KEY_TYPEHASH,
                block.chainid,
                address(this),
                authorization.routeNamespace,
                authorization.routeNonce,
                authorization.authorizedLauncher
            )
        );
    }

    function validateDependencies() external view {
        _validateDependencies();
        _validateRegistryIdentity();
    }

    function _reviewedGraphCommitment(GraphAuthorization calldata authorization, Target[] calldata targets)
        private
        view
        returns (bytes32 commitment, uint256 targetValueSum)
    {
        uint256 targetCount = targets.length;
        if (targetCount == 0) revert EmptyGraph();
        if (targetCount > MAX_TARGETS) revert GraphTargetLimitExceeded(targetCount, MAX_TARGETS);
        bytes32[] memory targetCommitments = new bytes32[](targetCount);
        uint256 totalInputBytes;
        for (uint256 index; index < targetCount; ++index) {
            Target calldata target = targets[index];
            if (
                target.targetIdHash == bytes32(0) || target.initCode.length == 0
                    || target.initCode.length > MAX_TARGET_INIT_CODE_BYTES
                    || target.initializerCalldata.length > MAX_TARGET_INITIALIZER_BYTES
                    || (target.initializerValue != 0 && target.initializerCalldata.length == 0)
            ) revert InvalidGraphTarget(index);
            totalInputBytes += target.initCode.length + target.initializerCalldata.length;
            if (totalInputBytes > MAX_TOTAL_INPUT_BYTES) {
                revert GraphInputBytesLimitExceeded(totalInputBytes, MAX_TOTAL_INPUT_BYTES);
            }
            targetValueSum += target.deploymentValue + target.initializerValue;
            targetCommitments[index] = keccak256(
                abi.encode(
                    GRAPH_TARGET_COMMITMENT_TYPEHASH,
                    index,
                    target.targetIdHash,
                    target.applicantSalt,
                    target.deploymentValue,
                    target.initializerValue,
                    keccak256(target.initCode),
                    keccak256(target.initializerCalldata)
                )
            );
        }
        commitment = keccak256(
            abi.encode(
                GRAPH_COMMITMENT_TYPEHASH,
                block.chainid,
                address(this),
                authorization.routeNamespace,
                authorization.routeNonce,
                authorization.topologyHash,
                authorization.authorizedLauncher,
                authorization.totalValue,
                keccak256(abi.encode(targetCommitments))
            )
        );
    }

    function _validateDependencies() private view {
        _requireRuntime(IMPLEMENTATION, REVIEWED_IMPLEMENTATION_RUNTIME_CODE_HASH);
        _requireRuntime(REGISTRY, CANONICAL_REGISTRY_V2_RUNTIME_CODE_HASH);
        _requireRuntime(POOL_MANAGER, CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH);
    }

    function _validateRegistryIdentity() private view {
        IProgrammableCustomRegistryV2Identity registry = IProgrammableCustomRegistryV2Identity(REGISTRY);
        if (registry.CHAIN_ID() != MAINNET_CHAIN_ID) revert RegistryIdentityMismatch(bytes32("chain-id"));
        if (registry.REGISTRY_GENERATION() != 2) revert RegistryIdentityMismatch(bytes32("generation"));
        if (registry.MINIMUM_FINALITY_BLOCKS() != CANONICAL_REGISTRY_V2_FINALITY_BLOCKS) {
            revert RegistryIdentityMismatch(bytes32("finality"));
        }
        if (registry.REGISTRY_POLICY_COMMITMENT() != CANONICAL_REGISTRY_V2_POLICY_COMMITMENT) {
            revert RegistryIdentityMismatch(bytes32("policy"));
        }
    }

    function _requireRuntime(address dependency, bytes32 expected) private view {
        bytes32 actual = dependency.codehash;
        if (actual != expected) revert DependencyRuntimeCodeHashMismatch(dependency, expected, actual);
    }
}
