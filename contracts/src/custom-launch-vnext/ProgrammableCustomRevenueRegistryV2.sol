// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {
    IProgrammableProtocolFeeSourceV1,
    ProtocolRevenueSourceConfigV1
} from "../protocol-revenue-vnext/IProgrammableProtocolFeeSourceV1.sol";
import {
    CustomRevenueApprovalStateV2,
    CustomRevenueLaunchStateV2,
    CustomRevenueLaunchStatusV2,
    IProgrammableCustomFeeSourceV2,
    IProgrammableCustomRevenueRegistryV2,
    IProgrammableLaunchStampRouterV1,
    IProtocolRevenueSourceRegistryCustomRegistrarV1,
    ProgrammableLaunchStampRecordV1
} from "../protocol-revenue-vnext/custom/IProgrammableCustomRevenueReleaseV2.sol";

interface IProtocolRevenueSourceRegistryProductionV1 is IProtocolRevenueSourceRegistryCustomRegistrarV1 {
    function SOURCE_ACTIVATOR_ROLE() external view returns (bytes32);
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/// @title ProgrammableCustomRevenueRegistryV2
/// @notice Minimal production admission record for future Custom native 10 bps fee sources.
/// @dev The contract is both the V2 revenue registry and its immutable launch-stamp reader. It never proposes,
///      activates, claims, transfers, swaps, or splits revenue. Source proposal remains with the separately deployed
///      ProtocolRevenueCustomLaunchRegistrarV1; source activation remains with an independent core-registry role.
contract ProgrammableCustomRevenueRegistryV2 is
    AccessControlDefaultAdminRules,
    IProgrammableCustomRevenueRegistryV2,
    IProgrammableLaunchStampRouterV1
{
    using SafeCast for uint256;

    bytes32 public constant APPROVER_ROLE = keccak256("programmable.custom-revenue.approver.v2");
    bytes32 public constant LAUNCH_RECORDER_ROLE = keccak256("programmable.custom-revenue.launch-recorder.v2");
    bytes32 public constant FINALIZER_ROLE = keccak256("programmable.custom-revenue.finalizer.v2");
    bytes32 public constant APPROVAL_BINDING_DOMAIN = keccak256("programmable.custom-revenue.approval.v2");
    bytes32 public constant LAUNCH_STAMP_DOMAIN = keccak256("programmable.custom-revenue.launch-stamp.v1");
    bytes32 public constant CUSTOM_LAUNCH_CLASS_ID = keccak256("programmable.custom-launch.v2");

    uint256 public constant SUPPORTED_CHAIN_ID = 1;
    uint64 public constant override REGISTRY_GENERATION = 2;
    uint64 public constant override MINIMUM_FINALITY_BLOCKS = 64;
    uint8 public constant CUSTOM_GRAPH_LAUNCH_KIND = 1;
    uint16 public constant PROGRAMMABLE_FEE_BPS = 10;
    address public constant NATIVE_ASSET = address(0);
    address public constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 public constant CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes4 public constant CLAIM_SELECTOR = IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector;
    bytes4 public constant STANDARD_SOURCE_INTERFACE_ID = type(IProgrammableProtocolFeeSourceV1).interfaceId;
    bytes4 private constant FEE_BPS_SELECTOR = IProgrammableCustomFeeSourceV2.programmableFeeBps.selector;
    bytes4 private constant TOTAL_CLAIMED_SELECTOR =
        IProgrammableProtocolFeeSourceV1.totalProgrammableFeesClaimed.selector;

    struct RegistryConfigV2 {
        uint48 initialAdminDelay;
        address initialAdmin;
        address initialApprover;
        address initialLaunchRecorder;
        address initialFinalizer;
        address independentSourceActivator;
        address sourceRegistry;
        bytes32 sourceRegistryRuntimeCodeHash;
    }

    struct SourceActivationEvidenceV2 {
        uint64 blockNumber;
        bytes32 blockHash;
        bytes32 transactionHash;
        uint32 transactionIndex;
        uint32 logIndex;
        uint256 totalClaimedBaseline;
    }

    struct LaunchObservationV2 {
        bytes32 launchId;
        bytes32 approvalId;
        ProgrammableLaunchStampRecordV1 stamp;
        SourceActivationEvidenceV2 sourceActivation;
    }

    struct LaunchFinalityProofV2 {
        bytes32 launchId;
        uint64 observedBlockNumber;
        bytes32 observedBlockHash;
        uint64 confirmedHeadBlockNumber;
        bytes32 confirmedHeadBlockHash;
        bytes32 finalityEvidenceHash;
    }

    uint256 public immutable override(IProgrammableCustomRevenueRegistryV2, IProgrammableLaunchStampRouterV1) CHAIN_ID;
    IProtocolRevenueSourceRegistryProductionV1 public immutable SOURCE_REGISTRY;
    bytes32 public immutable SOURCE_REGISTRY_RUNTIME_CODE_HASH;
    address public immutable INDEPENDENT_SOURCE_ACTIVATOR;

    mapping(bytes32 approvalId => CustomRevenueApprovalStateV2 state) private _approvals;
    mapping(bytes32 launchId => CustomRevenueLaunchStateV2 state) private _launches;
    mapping(bytes32 launchId => ProgrammableLaunchStampRecordV1 record) private _stamps;
    mapping(bytes32 launchId => bytes32 approvalId) public approvalIdForLaunch;
    mapping(bytes32 evidenceHash => bool used) public approvalEvidenceUsed;
    mapping(bytes32 evidenceHash => bool used) public finalityEvidenceUsed;
    mapping(address component => bytes32 launchId) public override launchIdByComponent;
    mapping(address component => bytes32 runtimeCodeHash) public override componentRuntimeCodeHash;

    error ApprovalAlreadyExists(bytes32 approvalId);
    error ApprovalBindingMismatch(bytes32 supplied, bytes32 expected);
    error ApprovalConsumed(bytes32 approvalId);
    error ApprovalExpired(uint64 expiresAtBlock, uint256 currentBlock);
    error ApprovalNotYetValid(uint64 validAfterBlock, uint256 currentBlock);
    error BlockHashMismatch(uint64 blockNumber, bytes32 supplied, bytes32 canonical);
    error ComponentAlreadyStamped(address component, bytes32 launchId);
    error EvidenceAlreadyUsed(bytes32 evidenceHash);
    error FinalityDepthInsufficient(uint64 observedBlock, uint64 confirmedHeadBlock);
    error HistoricalBlockUnavailable(uint64 blockNumber, uint256 currentBlock);
    error IncompatibleOperationalRoles(address account);
    error InfrastructureBindingMismatch(bytes32 field);
    error InvalidApprovalWindow(uint64 validAfterBlock, uint64 expiresAtBlock);
    error InvalidBinding(bytes32 field);
    error InvalidLaunchState(bytes32 launchId, CustomRevenueLaunchStatusV2 status);
    error LaunchAlreadyApproved(bytes32 launchId, bytes32 approvalId);
    error LaunchStampHashMismatch(bytes32 supplied, bytes32 expected);
    error SourceBindingMismatch(bytes32 field);
    error SourceNotExecutable(bytes32 sourceId);
    error SourceReturnMalformed(address source, bytes4 selector, uint256 size);
    error UnsupportedChain(uint256 supplied, uint256 expected);

    event CustomRevenueApprovalAuthorizedV2(
        bytes32 indexed approvalId,
        bytes32 indexed launchId,
        address indexed source,
        bytes32 approvalBindingHash,
        bytes32 registrationBindingHash,
        bytes32 expectedLaunchStampHash
    );
    event CustomRevenueLaunchObservedV2(
        bytes32 indexed launchId,
        bytes32 indexed approvalId,
        bytes32 indexed sourceId,
        address source,
        bytes32 launchStampHash,
        uint64 observedAtBlock
    );
    event CustomRevenueLaunchFinalizedV2(
        bytes32 indexed launchId,
        bytes32 indexed sourceId,
        bytes32 indexed finalityEvidenceHash,
        uint64 observedBlockNumber,
        bytes32 observedBlockHash,
        uint64 confirmedHeadBlockNumber,
        bytes32 confirmedHeadBlockHash,
        uint64 finalizedAtBlock
    );

    constructor(RegistryConfigV2 memory config)
        AccessControlDefaultAdminRules(config.initialAdminDelay, config.initialAdmin)
    {
        if (block.chainid != SUPPORTED_CHAIN_ID) revert UnsupportedChain(block.chainid, SUPPORTED_CHAIN_ID);
        _validateRoleAccounts(config);
        _requireRuntime(config.sourceRegistry, config.sourceRegistryRuntimeCodeHash, "source-registry");

        IProtocolRevenueSourceRegistryProductionV1 sourceRegistry =
            IProtocolRevenueSourceRegistryProductionV1(config.sourceRegistry);
        if (
            sourceRegistry.CHAIN_ID() != SUPPORTED_CHAIN_ID
                || sourceRegistry.MIN_ACTIVATION_DELAY_BLOCKS() < MINIMUM_FINALITY_BLOCKS
                || sourceRegistry.CLAIM_SELECTOR() != CLAIM_SELECTOR
                || sourceRegistry.SOURCE_INTERFACE_ID() != STANDARD_SOURCE_INTERFACE_ID
                || sourceRegistry.rewardWallet() != REWARD_WALLET
        ) revert InfrastructureBindingMismatch("source-registry-policy");
        bytes32 activatorRole = sourceRegistry.SOURCE_ACTIVATOR_ROLE();
        if (!sourceRegistry.hasRole(activatorRole, config.independentSourceActivator)) {
            revert InfrastructureBindingMismatch("independent-source-activator");
        }

        CHAIN_ID = block.chainid;
        SOURCE_REGISTRY = sourceRegistry;
        SOURCE_REGISTRY_RUNTIME_CODE_HASH = config.sourceRegistryRuntimeCodeHash;
        INDEPENDENT_SOURCE_ACTIVATOR = config.independentSourceActivator;
        _grantRole(APPROVER_ROLE, config.initialApprover);
        _grantRole(LAUNCH_RECORDER_ROLE, config.initialLaunchRecorder);
        _grantRole(FINALIZER_ROLE, config.initialFinalizer);
    }

    /// @notice Stores the exact predeployment approval read by ProtocolRevenueCustomLaunchRegistrarV1.
    function authorizeApproval(bytes32 approvalId, CustomRevenueApprovalStateV2 calldata approval)
        external
        onlyRole(APPROVER_ROLE)
    {
        _assertInfrastructure();
        if (approvalId == bytes32(0)) revert InvalidBinding("approval-id");
        if (_approvals[approvalId].launchId != bytes32(0)) revert ApprovalAlreadyExists(approvalId);
        bytes32 existingApproval = approvalIdForLaunch[approval.launchId];
        if (existingApproval != bytes32(0)) revert LaunchAlreadyApproved(approval.launchId, existingApproval);
        _validateApprovalShape(approvalId, approval);
        if (approvalEvidenceUsed[approval.evidenceHash]) revert EvidenceAlreadyUsed(approval.evidenceHash);

        bytes32 expectedApprovalBinding = _computeApprovalBindingHash(approvalId, approval);
        if (approval.approvalBindingHash != expectedApprovalBinding) {
            revert ApprovalBindingMismatch(approval.approvalBindingHash, expectedApprovalBinding);
        }

        _approvals[approvalId] = approval;
        approvalIdForLaunch[approval.launchId] = approvalId;
        approvalEvidenceUsed[approval.evidenceHash] = true;
        emit CustomRevenueApprovalAuthorizedV2(
            approvalId,
            approval.launchId,
            approval.source,
            approval.approvalBindingHash,
            approval.registrationBindingHash,
            approval.expectedLaunchStampHash
        );
    }

    /// @notice Records the launch and activation only after the delayed core source is independently executable.
    function observeLaunch(LaunchObservationV2 calldata observation) external onlyRole(LAUNCH_RECORDER_ROLE) {
        _assertInfrastructure();
        CustomRevenueApprovalStateV2 storage approval = _approvals[observation.approvalId];
        if (approval.launchId == bytes32(0)) revert InvalidBinding("approval-id");
        if (approval.launchId != observation.launchId) revert InvalidBinding("launch-id");
        if (approval.consumed) revert ApprovalConsumed(observation.approvalId);
        if (block.number < uint256(approval.validAfterBlock)) {
            revert ApprovalNotYetValid(approval.validAfterBlock, block.number);
        }
        if (block.number > uint256(approval.expiresAtBlock)) {
            revert ApprovalExpired(approval.expiresAtBlock, block.number);
        }
        if (_launches[observation.launchId].status != CustomRevenueLaunchStatusV2.None) {
            revert InvalidLaunchState(observation.launchId, _launches[observation.launchId].status);
        }

        _assertDeploymentBindings(approval);
        ProtocolRevenueSourceConfigV1 memory source = _sourceConfigFromStorage(approval);
        _assertExecutableSource(source, true);
        _validateSourceActivation(approval, observation.sourceActivation);
        _validateLaunchStamp(observation.launchId, approval, observation.stamp);

        uint64 observedAtBlock = block.number.toUint64();
        approval.consumed = true;
        _stamps[observation.launchId] = observation.stamp;
        launchIdByComponent[approval.source] = observation.launchId;
        componentRuntimeCodeHash[approval.source] = approval.sourceRuntimeCodeHash;
        _launches[observation.launchId] = CustomRevenueLaunchStateV2({
            status: CustomRevenueLaunchStatusV2.Observed,
            observedAtBlock: observedAtBlock,
            finalizedAtBlock: 0,
            approvalId: observation.approvalId,
            launchClassId: approval.launchClassId,
            approvalBindingHash: approval.approvalBindingHash,
            registrationBindingHash: approval.registrationBindingHash,
            finalityEvidenceHash: bytes32(0),
            launchWallet: approval.launchWallet,
            approvedFactory: approval.approvedFactory,
            approvedFactoryRuntimeCodeHash: approval.approvedFactoryRuntimeCodeHash,
            create2Deployer: approval.create2Deployer,
            create2DeployerRuntimeCodeHash: approval.create2DeployerRuntimeCodeHash,
            create2Salt: approval.create2Salt,
            creationCodeHash: approval.creationCodeHash,
            templateCommitment: approval.templateCommitment,
            sourceRegistry: address(SOURCE_REGISTRY),
            sourceRegistryRuntimeCodeHash: SOURCE_REGISTRY_RUNTIME_CODE_HASH,
            sourceId: source.sourceId,
            source: source.source,
            sourceRuntimeCodeHash: source.runtimeCodeHash,
            asset: NATIVE_ASSET,
            claimSelector: CLAIM_SELECTOR,
            standardInterfaceId: STANDARD_SOURCE_INTERFACE_ID,
            recipient: REWARD_WALLET,
            programmableFeeBps: PROGRAMMABLE_FEE_BPS,
            activationBlock: source.activationBlock,
            sourceActivatedAtBlock: observation.sourceActivation.blockNumber,
            sourceActivatedAtBlockHash: observation.sourceActivation.blockHash,
            sourceActivationTransactionHash: observation.sourceActivation.transactionHash,
            sourceActivationTransactionIndex: observation.sourceActivation.transactionIndex,
            sourceActivationLogIndex: observation.sourceActivation.logIndex,
            sourceActivatedTotalClaimedBaseline: observation.sourceActivation.totalClaimedBaseline,
            launchStampRouter: address(this),
            launchStampRouterRuntimeCodeHash: address(this).codehash,
            launchStampHash: observation.stamp.stampHash,
            launchStampBlockNumber: observedAtBlock,
            launchStampBlockHash: bytes32(0)
        });

        emit CustomRevenueLaunchObservedV2(
            observation.launchId,
            observation.approvalId,
            source.sourceId,
            source.source,
            observation.stamp.stampHash,
            observedAtBlock
        );
    }

    /// @notice Finalizes only a canonical observed block at the exact 64-block-or-greater policy depth.
    function finalizeLaunch(LaunchFinalityProofV2 calldata proof) external onlyRole(FINALIZER_ROLE) {
        _assertInfrastructure();
        CustomRevenueLaunchStateV2 storage launch = _launches[proof.launchId];
        if (launch.status != CustomRevenueLaunchStatusV2.Observed) {
            revert InvalidLaunchState(proof.launchId, launch.status);
        }
        if (proof.observedBlockNumber != launch.observedAtBlock) revert InvalidBinding("observed-block");
        if (
            uint256(proof.confirmedHeadBlockNumber)
                < uint256(proof.observedBlockNumber) + uint256(MINIMUM_FINALITY_BLOCKS)
        ) revert FinalityDepthInsufficient(proof.observedBlockNumber, proof.confirmedHeadBlockNumber);
        if (proof.finalityEvidenceHash == bytes32(0)) revert InvalidBinding("finality-evidence");
        if (finalityEvidenceUsed[proof.finalityEvidenceHash]) {
            revert EvidenceAlreadyUsed(proof.finalityEvidenceHash);
        }
        _requireCanonicalHistoricalBlock(proof.observedBlockNumber, proof.observedBlockHash);
        _requireCanonicalHistoricalBlock(proof.confirmedHeadBlockNumber, proof.confirmedHeadBlockHash);

        CustomRevenueApprovalStateV2 storage approval = _approvals[launch.approvalId];
        _assertDeploymentBindings(approval);
        _assertExecutableSource(_sourceConfigFromStorage(approval), false);
        _assertCurrentStamp(proof.launchId, approval);

        launch.status = CustomRevenueLaunchStatusV2.Finalized;
        launch.finalizedAtBlock = block.number.toUint64();
        launch.finalityEvidenceHash = proof.finalityEvidenceHash;
        launch.launchStampBlockHash = proof.observedBlockHash;
        finalityEvidenceUsed[proof.finalityEvidenceHash] = true;

        emit CustomRevenueLaunchFinalizedV2(
            proof.launchId,
            launch.sourceId,
            proof.finalityEvidenceHash,
            proof.observedBlockNumber,
            proof.observedBlockHash,
            proof.confirmedHeadBlockNumber,
            proof.confirmedHeadBlockHash,
            launch.finalizedAtBlock
        );
    }

    function approvalState(bytes32 approvalId)
        external
        view
        override
        returns (CustomRevenueApprovalStateV2 memory state)
    {
        return _approvals[approvalId];
    }

    function revenueLaunch(bytes32 launchId) external view override returns (CustomRevenueLaunchStateV2 memory state) {
        return _launches[launchId];
    }

    function launchStamp(bytes32 launchId)
        external
        view
        override
        returns (ProgrammableLaunchStampRecordV1 memory record)
    {
        return _stamps[launchId];
    }

    function stampProof(address component) external view override returns (bytes32 launchId, bytes32 stampHash) {
        launchId = launchIdByComponent[component];
        stampHash = _stamps[launchId].stampHash;
    }

    function computeApprovalBindingHash(bytes32 approvalId, CustomRevenueApprovalStateV2 calldata approval)
        external
        view
        returns (bytes32)
    {
        return _computeApprovalBindingHash(approvalId, approval);
    }

    function computeLaunchStampHash(bytes32 launchId, ProgrammableLaunchStampRecordV1 calldata stamp)
        external
        view
        returns (bytes32)
    {
        return _computeLaunchStampHash(launchId, stamp);
    }

    function _validateApprovalShape(bytes32 approvalId, CustomRevenueApprovalStateV2 calldata approval) private view {
        if (approval.launchId == bytes32(0)) revert InvalidBinding("launch-id");
        if (approval.launchWallet == address(0)) revert InvalidBinding("launch-wallet");
        if (approval.launchClassId != CUSTOM_LAUNCH_CLASS_ID) revert InvalidBinding("launch-class");
        if (approval.registrationBindingHash == bytes32(0)) revert InvalidBinding("registration-binding");
        if (approval.expectedLaunchStampHash == bytes32(0)) revert InvalidBinding("launch-stamp-hash");
        if (approval.evidenceHash == bytes32(0)) revert InvalidBinding("approval-evidence");
        if (approval.consumed) revert ApprovalConsumed(approvalId);
        if (
            approval.validAfterBlock == 0 || approval.expiresAtBlock < approval.validAfterBlock
                || block.number > uint256(approval.expiresAtBlock)
        ) revert InvalidApprovalWindow(approval.validAfterBlock, approval.expiresAtBlock);
        if (
            approval.approvedFactory == address(0) || approval.approvedFactoryRuntimeCodeHash == bytes32(0)
                || approval.create2Deployer == address(0) || approval.create2DeployerRuntimeCodeHash == bytes32(0)
                || approval.creationCodeHash == bytes32(0) || approval.templateCommitment == bytes32(0)
        ) revert InvalidBinding("deployment");
        _requireRuntime(approval.approvedFactory, approval.approvedFactoryRuntimeCodeHash, "approved-factory");
        _requireRuntime(approval.create2Deployer, approval.create2DeployerRuntimeCodeHash, "create2-deployer");
        if (
            approval.source
                != _create2Address(approval.create2Deployer, approval.create2Salt, approval.creationCodeHash)
        ) {
            revert SourceBindingMismatch("create2-prediction");
        }
        if (approval.source.code.length != 0) revert SourceBindingMismatch("future-source");
        if (
            approval.sourceRuntimeCodeHash == bytes32(0) || approval.asset != NATIVE_ASSET
                || approval.claimSelector != CLAIM_SELECTOR
                || approval.standardInterfaceId != STANDARD_SOURCE_INTERFACE_ID || approval.recipient != REWARD_WALLET
                || approval.programmableFeeBps != PROGRAMMABLE_FEE_BPS
                || uint256(approval.activationBlock) < block.number + uint256(MINIMUM_FINALITY_BLOCKS)
        ) revert SourceBindingMismatch("source-policy");

        ProtocolRevenueSourceConfigV1 memory source = _sourceConfigFromCalldata(approval);
        if (source.sourceId != SOURCE_REGISTRY.computeSourceId(source)) revert SourceBindingMismatch("source-id");
        (ProtocolRevenueSourceConfigV1 memory existing, bool registered, bool quarantined) =
            SOURCE_REGISTRY.sourceState(source.sourceId);
        if (registered || quarantined || existing.sourceId != bytes32(0)) {
            revert SourceBindingMismatch("already-registered");
        }
    }

    function _validateSourceActivation(
        CustomRevenueApprovalStateV2 storage approval,
        SourceActivationEvidenceV2 calldata activation
    ) private view {
        if (
            activation.blockNumber < approval.activationBlock || activation.blockNumber >= block.number
                || activation.transactionHash == bytes32(0) || activation.totalClaimedBaseline != 0
        ) revert SourceBindingMismatch("source-activation");
        _requireCanonicalHistoricalBlock(activation.blockNumber, activation.blockHash);
    }

    function _validateLaunchStamp(
        bytes32 launchId,
        CustomRevenueApprovalStateV2 storage approval,
        ProgrammableLaunchStampRecordV1 calldata stamp
    ) private view {
        if (launchIdByComponent[approval.source] != bytes32(0)) {
            revert ComponentAlreadyStamped(approval.source, launchIdByComponent[approval.source]);
        }
        if (
            stamp.kind != CUSTOM_GRAPH_LAUNCH_KIND || stamp.launchWallet != approval.launchWallet
                || stamp.token == address(0) || stamp.token == approval.source || stamp.hook != approval.source
                || stamp.poolManager == address(0) || stamp.poolId == bytes32(0) || stamp.poolKeyHash == bytes32(0)
                || stamp.componentSetHash == bytes32(0) || stamp.routePayloadHash == bytes32(0)
                || stamp.routeLauncher != approval.approvedFactory
                || stamp.routeLauncherRuntimeCodeHash != approval.approvedFactoryRuntimeCodeHash
                || stamp.expectedResultHash == bytes32(0) || stamp.permitDigest == bytes32(0)
        ) revert InvalidBinding("launch-stamp");
        _assertCanonicalPoolManager(stamp.poolManager);
        bytes32 expected = _computeLaunchStampHash(launchId, stamp);
        if (stamp.stampHash != expected) revert LaunchStampHashMismatch(stamp.stampHash, expected);
        if (stamp.stampHash != approval.expectedLaunchStampHash) {
            revert LaunchStampHashMismatch(stamp.stampHash, approval.expectedLaunchStampHash);
        }
    }

    function _assertCurrentStamp(bytes32 launchId, CustomRevenueApprovalStateV2 storage approval) private view {
        ProgrammableLaunchStampRecordV1 storage stamp = _stamps[launchId];
        if (
            launchIdByComponent[approval.source] != launchId
                || componentRuntimeCodeHash[approval.source] != approval.sourceRuntimeCodeHash
                || stamp.hook != approval.source || stamp.launchWallet != approval.launchWallet
                || stamp.routeLauncher != approval.approvedFactory
                || stamp.routeLauncherRuntimeCodeHash != approval.approvedFactoryRuntimeCodeHash
                || stamp.stampHash != approval.expectedLaunchStampHash
        ) revert InvalidBinding("launch-stamp-current");
    }

    function _assertExecutableSource(ProtocolRevenueSourceConfigV1 memory expected, bool requireZeroBaseline)
        private
        view
    {
        (ProtocolRevenueSourceConfigV1 memory actual, bool registered, bool quarantined) =
            SOURCE_REGISTRY.sourceState(expected.sourceId);
        if (
            !registered || quarantined || !_sameSource(actual, expected)
                || !SOURCE_REGISTRY.isExecutable(expected.sourceId)
        ) {
            revert SourceNotExecutable(expected.sourceId);
        }
        if (expected.source.code.length == 0 || expected.source.codehash != expected.runtimeCodeHash) {
            revert SourceBindingMismatch("source-runtime");
        }
        uint256 feeBps = _staticSourceWord(expected.source, FEE_BPS_SELECTOR, true);
        if (feeBps != PROGRAMMABLE_FEE_BPS) revert SourceBindingMismatch("source-fee-bps");
        if (requireZeroBaseline) {
            uint256 totalClaimed = _staticSourceWord(expected.source, TOTAL_CLAIMED_SELECTOR, true);
            if (totalClaimed != 0) revert SourceBindingMismatch("source-claimed-baseline");
        }
    }

    function _assertDeploymentBindings(CustomRevenueApprovalStateV2 storage approval) private view {
        _requireRuntime(approval.approvedFactory, approval.approvedFactoryRuntimeCodeHash, "approved-factory");
        _requireRuntime(approval.create2Deployer, approval.create2DeployerRuntimeCodeHash, "create2-deployer");
        _requireRuntime(approval.source, approval.sourceRuntimeCodeHash, "source");
    }

    function _assertInfrastructure() private view {
        _requireRuntime(address(SOURCE_REGISTRY), SOURCE_REGISTRY_RUNTIME_CODE_HASH, "source-registry");
        if (
            SOURCE_REGISTRY.CHAIN_ID() != CHAIN_ID || SOURCE_REGISTRY.CLAIM_SELECTOR() != CLAIM_SELECTOR
                || SOURCE_REGISTRY.SOURCE_INTERFACE_ID() != STANDARD_SOURCE_INTERFACE_ID
                || SOURCE_REGISTRY.rewardWallet() != REWARD_WALLET
                || !SOURCE_REGISTRY.hasRole(SOURCE_REGISTRY.SOURCE_ACTIVATOR_ROLE(), INDEPENDENT_SOURCE_ACTIVATOR)
        ) revert InfrastructureBindingMismatch("source-registry-policy");
    }

    function _computeApprovalBindingHash(bytes32 approvalId, CustomRevenueApprovalStateV2 calldata approval)
        private
        view
        returns (bytes32)
    {
        bytes32 scopeHash = keccak256(
            abi.encode(
                approval.launchId,
                approval.launchWallet,
                approval.launchClassId,
                approval.registrationBindingHash,
                approval.expectedLaunchStampHash
            )
        );
        bytes32 deploymentHash = keccak256(
            abi.encode(
                approval.approvedFactory,
                approval.approvedFactoryRuntimeCodeHash,
                approval.create2Deployer,
                approval.create2DeployerRuntimeCodeHash,
                approval.create2Salt,
                approval.creationCodeHash,
                approval.templateCommitment
            )
        );
        bytes32 sourceHash = keccak256(
            abi.encode(
                approval.source,
                approval.sourceRuntimeCodeHash,
                approval.asset,
                approval.claimSelector,
                approval.standardInterfaceId,
                approval.recipient,
                approval.programmableFeeBps,
                approval.activationBlock
            )
        );
        bytes32 windowHash =
            keccak256(abi.encode(approval.validAfterBlock, approval.expiresAtBlock, approval.evidenceHash));
        return keccak256(
            abi.encode(
                APPROVAL_BINDING_DOMAIN,
                CHAIN_ID,
                address(this),
                address(SOURCE_REGISTRY),
                approvalId,
                scopeHash,
                deploymentHash,
                sourceHash,
                windowHash
            )
        );
    }

    function _computeLaunchStampHash(bytes32 launchId, ProgrammableLaunchStampRecordV1 calldata stamp)
        private
        view
        returns (bytes32)
    {
        bytes32 componentsHash = keccak256(
            abi.encode(
                stamp.launchWallet,
                stamp.token,
                stamp.hook,
                stamp.poolManager,
                stamp.poolId,
                stamp.poolKeyHash,
                stamp.componentSetHash
            )
        );
        bytes32 routeHash = keccak256(
            abi.encode(
                stamp.routePayloadHash,
                stamp.routeLauncher,
                stamp.routeLauncherRuntimeCodeHash,
                stamp.expectedResultHash,
                stamp.permitDigest
            )
        );
        return keccak256(
            abi.encode(LAUNCH_STAMP_DOMAIN, CHAIN_ID, address(this), launchId, stamp.kind, componentsHash, routeHash)
        );
    }

    function _sourceConfigFromCalldata(CustomRevenueApprovalStateV2 calldata approval)
        private
        view
        returns (ProtocolRevenueSourceConfigV1 memory config)
    {
        config = ProtocolRevenueSourceConfigV1({
            sourceId: bytes32(0),
            source: approval.source,
            runtimeCodeHash: approval.sourceRuntimeCodeHash,
            asset: approval.asset,
            claimSelector: approval.claimSelector,
            recipient: approval.recipient,
            activationBlock: approval.activationBlock
        });
        config.sourceId = SOURCE_REGISTRY.computeSourceId(config);
    }

    function _sourceConfigFromStorage(CustomRevenueApprovalStateV2 storage approval)
        private
        view
        returns (ProtocolRevenueSourceConfigV1 memory config)
    {
        config = ProtocolRevenueSourceConfigV1({
            sourceId: bytes32(0),
            source: approval.source,
            runtimeCodeHash: approval.sourceRuntimeCodeHash,
            asset: approval.asset,
            claimSelector: approval.claimSelector,
            recipient: approval.recipient,
            activationBlock: approval.activationBlock
        });
        config.sourceId = SOURCE_REGISTRY.computeSourceId(config);
    }

    function _sameSource(ProtocolRevenueSourceConfigV1 memory left, ProtocolRevenueSourceConfigV1 memory right)
        private
        pure
        returns (bool)
    {
        return left.sourceId == right.sourceId && left.source == right.source
            && left.runtimeCodeHash == right.runtimeCodeHash && left.asset == right.asset
            && left.claimSelector == right.claimSelector && left.recipient == right.recipient
            && left.activationBlock == right.activationBlock;
    }

    function _requireCanonicalHistoricalBlock(uint64 blockNumber, bytes32 suppliedHash) private view {
        if (blockNumber >= block.number || block.number - uint256(blockNumber) > 256) {
            revert HistoricalBlockUnavailable(blockNumber, block.number);
        }
        bytes32 canonical = blockhash(blockNumber);
        if (suppliedHash == bytes32(0) || suppliedHash != canonical) {
            revert BlockHashMismatch(blockNumber, suppliedHash, canonical);
        }
    }

    function _staticSourceWord(address source, bytes4 selector, bool includeAsset)
        private
        view
        returns (uint256 result)
    {
        bytes memory callData = includeAsset
            ? abi.encodeWithSelector(selector, NATIVE_ASSET)
            : abi.encodeWithSelector(selector);
        bool success;
        uint256 size;
        assembly ("memory-safe") {
            success := staticcall(gas(), source, add(callData, 0x20), mload(callData), 0, 0)
            size := returndatasize()
            if and(success, eq(size, 0x20)) {
                returndatacopy(0, 0, 0x20)
                result := mload(0)
            }
        }
        if (!success || size != 32) revert SourceReturnMalformed(source, selector, size);
    }

    function _validateRoleAccounts(RegistryConfigV2 memory config) private pure {
        address[5] memory accounts = [
            config.initialAdmin,
            config.initialApprover,
            config.initialLaunchRecorder,
            config.initialFinalizer,
            config.independentSourceActivator
        ];
        for (uint256 i; i < accounts.length; ++i) {
            if (accounts[i] == address(0)) revert InvalidBinding("role-account");
            for (uint256 j = i + 1; j < accounts.length; ++j) {
                if (accounts[i] == accounts[j]) revert IncompatibleOperationalRoles(accounts[i]);
            }
        }
    }

    function _requireRuntime(address target, bytes32 expected, bytes32 field) private view {
        if (target == address(0) || target.code.length == 0 || expected == bytes32(0) || target.codehash != expected) {
            revert InfrastructureBindingMismatch(field);
        }
    }

    function _assertCanonicalPoolManager(address supplied) internal view virtual {
        if (
            supplied != CANONICAL_POOL_MANAGER || supplied.code.length == 0
                || supplied.codehash != CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH
        ) revert InfrastructureBindingMismatch("pool-manager");
    }

    function _create2Address(address deployer, bytes32 salt, bytes32 creationCodeHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, creationCodeHash)))));
    }

    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        bool operational = role == APPROVER_ROLE || role == LAUNCH_RECORDER_ROLE || role == FINALIZER_ROLE;
        if (role == DEFAULT_ADMIN_ROLE) {
            if (
                hasRole(APPROVER_ROLE, account) || hasRole(LAUNCH_RECORDER_ROLE, account)
                    || hasRole(FINALIZER_ROLE, account)
            ) revert IncompatibleOperationalRoles(account);
        } else if (operational) {
            if (
                account == address(0) || hasRole(DEFAULT_ADMIN_ROLE, account)
                    || (role != APPROVER_ROLE && hasRole(APPROVER_ROLE, account))
                    || (role != LAUNCH_RECORDER_ROLE && hasRole(LAUNCH_RECORDER_ROLE, account))
                    || (role != FINALIZER_ROLE && hasRole(FINALIZER_ROLE, account))
                    || account == INDEPENDENT_SOURCE_ACTIVATOR
            ) revert IncompatibleOperationalRoles(account);
        }
        return super._grantRole(role, account);
    }
}
