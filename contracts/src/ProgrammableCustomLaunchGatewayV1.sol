// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCreate2GraphDeployerV1 } from "./interfaces/IProgrammableCreate2GraphDeployerV1.sol";
import { IProgrammableCustomLaunchGatewayV1 } from "./interfaces/IProgrammableCustomLaunchGatewayV1.sol";
import { IProgrammableCustomRegistryV2 } from "./interfaces/IProgrammableCustomRegistryV2.sol";
import {
    IProgrammableRouteGatedCreate2GraphFactoryV1
} from "./interfaces/IProgrammableRouteGatedCreate2GraphFactoryV1.sol";

/// @title ProgrammableCustomLaunchGatewayV1
/// @notice One-click user transaction route for a pre-authorized Registry-v2 descriptor.
/// @dev This contract deploys the exact reviewed graph but intentionally cannot register or finalize it: the live
///      Registry V2 assigns those transitions to independent registrar and finalizer controllers. A successful user
///      transaction therefore precedes registerLaunch and finalizeLaunch; it never claims either transition occurred.
contract ProgrammableCustomLaunchGatewayV1 is IProgrammableCustomLaunchGatewayV1 {
    bytes32 public constant EXECUTION_APPROVAL_ID_TYPEHASH = keccak256(
        "ProgrammableCustomGatewayExecutionApprovalIdV1(uint256 chainId,address gateway,address registry,address factory,bytes32 routeAdapterBindingHash,bytes32 descriptorHash,uint64 validAfterBlock,uint64 expiresAtBlock,bytes32 routeBindingHash,bytes32 outputBindingHash)"
    );
    bytes32 public constant EXECUTION_ROUTE_BINDING_TYPEHASH = keccak256(
        "ProgrammableCustomGatewayExecutionRouteBindingV1(bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,bytes32 graphCommitment,address authorizedLauncher,uint256 totalValue)"
    );
    bytes32 public constant EXECUTION_OUTPUT_BINDING_TYPEHASH = keccak256(
        "ProgrammableCustomGatewayExecutionOutputBindingV1(uint256 primaryTargetIndex,bytes32 expectedGraphDeploymentHash)"
    );

    uint256 public constant MAINNET_CHAIN_ID = 1;
    address public constant CANONICAL_REGISTRY_V2 = 0x845506084a1AfB969fa4DeF444A2bdeEe794AAad;
    bytes32 public constant CANONICAL_REGISTRY_V2_RUNTIME_CODE_HASH =
        0x74d8196e2d40d030c66b147e835cbdf6dd0ab61c964fb3ef3890d86ed7daf074;
    address public constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 public constant CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    uint64 public constant ROUTE_CONFIRMATION_BLOCKS = 12;
    uint64 public constant REGISTRAR_INCLUSION_BLOCKS = 1;
    uint64 public constant REGISTRATION_SAFETY_MARGIN_BLOCKS = ROUTE_CONFIRMATION_BLOCKS + REGISTRAR_INCLUSION_BLOCKS;

    IProgrammableCustomRegistryV2 public immutable REGISTRY;
    IProgrammableRouteGatedCreate2GraphFactoryV1 public immutable FACTORY;
    bytes32 public immutable FACTORY_RUNTIME_CODE_HASH;
    bytes32 public immutable ROUTE_ADAPTER_BINDING_HASH;
    address public immutable POOL_MANAGER;

    mapping(bytes32 approvalId => bytes32 descriptorHash) public executedDescriptorByApprovalId;
    bool private executionActive;

    error ApprovalAlreadyExecuted(bytes32 approvalId, bytes32 descriptorHash);
    error ApprovalExecutionBindingMismatch(bytes32 actual, bytes32 authorized);
    error ApprovalDescriptorMismatch(bytes32 actual, bytes32 authorized);
    error ApprovalExpired(uint64 expiresAtBlock, uint256 currentBlock);
    error ApprovalNotAuthorized(bytes32 approvalId);
    error ApprovalNotYetValid(uint64 validAfterBlock, uint256 currentBlock);
    error ApprovalRegistrationWindowInsufficient(uint64 expiresAtBlock, uint256 requiredThroughBlock);
    error ApprovalWasConsumed(bytes32 approvalId);
    error DependencyRuntimeCodeHashMismatch(address dependency, bytes32 expected, bytes32 actual);
    error FactoryBindingMismatch(bytes32 field);
    error GraphCommitmentMismatch(bytes32 actual, bytes32 reviewed);
    error GraphDeploymentHashMismatch(bytes32 actual, bytes32 expected);
    error GraphValueMismatch(uint256 actual, uint256 expected);
    error InvalidBinding(bytes32 field);
    error InvalidChain(uint256 supplied, uint256 required);
    error LaunchWalletMismatch(address caller, address approvedWallet);
    error PrimaryContractMismatch(address actual, address expected);
    error PrimaryRuntimeCodeHashMismatch(bytes32 actual, bytes32 expected);
    error PrimaryTargetIndexOutOfBounds(uint256 index, uint256 targetCount);
    error ReentrantExecution();
    error RouteAuthorizationMismatch(bytes32 field);

    constructor(
        IProgrammableRouteGatedCreate2GraphFactoryV1 factory,
        bytes32 factoryRuntimeCodeHash,
        bytes32 routeAdapterBindingHash
    ) {
        if (block.chainid != MAINNET_CHAIN_ID) {
            revert InvalidChain(block.chainid, MAINNET_CHAIN_ID);
        }
        if (address(factory) == address(0)) revert InvalidBinding(bytes32("factory"));
        if (factoryRuntimeCodeHash == bytes32(0)) revert InvalidBinding(bytes32("factory-runtime"));
        if (routeAdapterBindingHash == bytes32(0)) revert InvalidBinding(bytes32("adapter-binding"));
        REGISTRY = IProgrammableCustomRegistryV2(CANONICAL_REGISTRY_V2);
        FACTORY = factory;
        FACTORY_RUNTIME_CODE_HASH = factoryRuntimeCodeHash;
        ROUTE_ADAPTER_BINDING_HASH = routeAdapterBindingHash;
        POOL_MANAGER = CANONICAL_POOL_MANAGER;
        _validateDependencies();
        _validateFactoryBinding();
    }

    function executeApprovedGraph(
        ApprovedGraphExecutionV1 calldata execution,
        IProgrammableCreate2GraphDeployerV1.Target[] calldata targets
    )
        external
        payable
        returns (
            address[] memory deployments,
            bytes32[] memory runtimeCodeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        )
    {
        if (executionActive) revert ReentrantExecution();
        executionActive = true;
        _validateDependencies();
        _validateFactoryBinding();
        bytes32 descriptorHash = _validateAndConsumeApproval(execution, targets);

        (deployments, runtimeCodeHashes, runtimeCodes, graphDeploymentHash) =
            FACTORY.deployGraph{ value: msg.value }(execution.authorization, targets);
        address primaryContract = _validateOutputs(execution, deployments, runtimeCodeHashes, graphDeploymentHash);

        _emitExecution(execution, descriptorHash, primaryContract, graphDeploymentHash);
        executionActive = false;
    }

    function _validateAndConsumeApproval(
        ApprovedGraphExecutionV1 calldata execution,
        IProgrammableCreate2GraphDeployerV1.Target[] calldata targets
    ) private returns (bytes32 descriptorHash) {
        if (execution.approvalId == bytes32(0)) {
            revert InvalidBinding(bytes32("approval-id"));
        }
        if (execution.expectedGraphDeploymentHash == bytes32(0)) {
            revert InvalidBinding(bytes32("graph-deployment"));
        }
        if (msg.sender != execution.descriptor.launchWallet) {
            revert LaunchWalletMismatch(msg.sender, execution.descriptor.launchWallet);
        }
        if (execution.descriptor.chainId != MAINNET_CHAIN_ID) {
            revert InvalidChain(execution.descriptor.chainId, MAINNET_CHAIN_ID);
        }
        if (execution.primaryTargetIndex >= targets.length) {
            revert PrimaryTargetIndexOutOfBounds(execution.primaryTargetIndex, targets.length);
        }
        if (execution.authorization.routeNamespace == bytes32(0)) {
            revert InvalidBinding(bytes32("route-namespace"));
        }
        if (execution.authorization.authorizedLauncher != address(this)) {
            revert RouteAuthorizationMismatch(bytes32("authorized-launcher"));
        }
        if (execution.authorization.totalValue != msg.value) {
            revert GraphValueMismatch(msg.value, execution.authorization.totalValue);
        }

        descriptorHash = REGISTRY.computeDescriptorHash(execution.descriptor);
        (bytes32 actualGraphCommitment, uint256 targetValueSum) =
            FACTORY.computeGraphCommitment(execution.authorization, targets);
        IProgrammableCustomRegistryV2.ApprovalStateV2 memory approval = REGISTRY.approvalState(execution.approvalId);
        if (approval.descriptorHash == bytes32(0)) revert ApprovalNotAuthorized(execution.approvalId);
        if (approval.consumed) revert ApprovalWasConsumed(execution.approvalId);
        if (approval.descriptorHash != descriptorHash) {
            revert ApprovalDescriptorMismatch(descriptorHash, approval.descriptorHash);
        }
        if (block.number < approval.validAfterBlock) {
            revert ApprovalNotYetValid(approval.validAfterBlock, block.number);
        }
        if (block.number > approval.expiresAtBlock) revert ApprovalExpired(approval.expiresAtBlock, block.number);
        uint256 requiredThroughBlock = block.number + REGISTRATION_SAFETY_MARGIN_BLOCKS;
        if (requiredThroughBlock > approval.expiresAtBlock) {
            revert ApprovalRegistrationWindowInsufficient(approval.expiresAtBlock, requiredThroughBlock);
        }
        bytes32 expectedApprovalId = _executionApprovalId(
            execution, descriptorHash, actualGraphCommitment, approval.validAfterBlock, approval.expiresAtBlock
        );
        if (expectedApprovalId != execution.approvalId) {
            revert ApprovalExecutionBindingMismatch(expectedApprovalId, execution.approvalId);
        }
        bytes32 previousExecution = executedDescriptorByApprovalId[execution.approvalId];
        if (previousExecution != bytes32(0)) {
            revert ApprovalAlreadyExecuted(execution.approvalId, previousExecution);
        }

        if (actualGraphCommitment != execution.authorization.graphCommitment) {
            revert GraphCommitmentMismatch(actualGraphCommitment, execution.authorization.graphCommitment);
        }
        if (targetValueSum != msg.value) revert GraphValueMismatch(targetValueSum, msg.value);

        executedDescriptorByApprovalId[execution.approvalId] = descriptorHash;
    }

    function _validateOutputs(
        ApprovedGraphExecutionV1 calldata execution,
        address[] memory deployments,
        bytes32[] memory runtimeCodeHashes,
        bytes32 graphDeploymentHash
    ) private pure returns (address primaryContract) {
        if (graphDeploymentHash != execution.expectedGraphDeploymentHash) {
            revert GraphDeploymentHashMismatch(graphDeploymentHash, execution.expectedGraphDeploymentHash);
        }
        primaryContract = deployments[execution.primaryTargetIndex];
        if (primaryContract != execution.descriptor.primaryContract) {
            revert PrimaryContractMismatch(primaryContract, execution.descriptor.primaryContract);
        }
        bytes32 primaryRuntimeCodeHash = runtimeCodeHashes[execution.primaryTargetIndex];
        if (primaryRuntimeCodeHash != execution.descriptor.primaryRuntimeCodeHash) {
            revert PrimaryRuntimeCodeHashMismatch(primaryRuntimeCodeHash, execution.descriptor.primaryRuntimeCodeHash);
        }
    }

    /// @notice Derives the only approval ID this Gateway accepts for one exact descriptor, graph, output, and window.
    /// @dev The Registry approver must authorize this value; `execution.approvalId` itself is intentionally ignored.
    function computeExecutionApprovalId(
        ApprovedGraphExecutionV1 calldata execution,
        uint64 validAfterBlock,
        uint64 expiresAtBlock
    ) external view returns (bytes32) {
        bytes32 descriptorHash = REGISTRY.computeDescriptorHash(execution.descriptor);
        return _executionApprovalId(
            execution, descriptorHash, execution.authorization.graphCommitment, validAfterBlock, expiresAtBlock
        );
    }

    function _executionApprovalId(
        ApprovedGraphExecutionV1 calldata execution,
        bytes32 descriptorHash,
        bytes32 graphCommitment,
        uint64 validAfterBlock,
        uint64 expiresAtBlock
    ) private view returns (bytes32) {
        bytes32 routeBindingHash = keccak256(
            abi.encode(
                EXECUTION_ROUTE_BINDING_TYPEHASH,
                execution.authorization.routeNamespace,
                execution.authorization.routeNonce,
                execution.authorization.topologyHash,
                graphCommitment,
                execution.authorization.authorizedLauncher,
                execution.authorization.totalValue
            )
        );
        bytes32 outputBindingHash = keccak256(
            abi.encode(
                EXECUTION_OUTPUT_BINDING_TYPEHASH, execution.primaryTargetIndex, execution.expectedGraphDeploymentHash
            )
        );
        return sha256(
            abi.encode(
                EXECUTION_APPROVAL_ID_TYPEHASH,
                MAINNET_CHAIN_ID,
                address(this),
                address(REGISTRY),
                address(FACTORY),
                ROUTE_ADAPTER_BINDING_HASH,
                descriptorHash,
                validAfterBlock,
                expiresAtBlock,
                routeBindingHash,
                outputBindingHash
            )
        );
    }

    function _emitExecution(
        ApprovedGraphExecutionV1 calldata execution,
        bytes32 descriptorHash,
        address primaryContract,
        bytes32 graphDeploymentHash
    ) private {
        emit ProgrammableCustomGraphExecutedV1(
            execution.approvalId,
            descriptorHash,
            REGISTRY.computeLaunchId(descriptorHash),
            execution.descriptor.launchWallet,
            primaryContract,
            execution.authorization.graphCommitment,
            graphDeploymentHash,
            ROUTE_ADAPTER_BINDING_HASH
        );
    }

    function _validateDependencies() private view {
        _requireRuntime(address(REGISTRY), CANONICAL_REGISTRY_V2_RUNTIME_CODE_HASH);
        _requireRuntime(address(FACTORY), FACTORY_RUNTIME_CODE_HASH);
        _requireRuntime(POOL_MANAGER, CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH);
        FACTORY.validateDependencies();
    }

    function _validateFactoryBinding() private view {
        if (FACTORY.AUTHORIZED_GATEWAY() != address(this)) {
            revert FactoryBindingMismatch(bytes32("gateway"));
        }
        if (FACTORY.ROUTE_ADAPTER_BINDING_HASH() != ROUTE_ADAPTER_BINDING_HASH) {
            revert FactoryBindingMismatch(bytes32("adapter-binding"));
        }
        if (FACTORY.REGISTRY() != address(REGISTRY)) revert FactoryBindingMismatch(bytes32("registry"));
        if (FACTORY.POOL_MANAGER() != POOL_MANAGER) revert FactoryBindingMismatch(bytes32("pool-manager"));
    }

    function _requireRuntime(address dependency, bytes32 expected) private view {
        bytes32 actual = dependency.codehash;
        if (actual != expected) revert DependencyRuntimeCodeHashMismatch(dependency, expected, actual);
    }
}
