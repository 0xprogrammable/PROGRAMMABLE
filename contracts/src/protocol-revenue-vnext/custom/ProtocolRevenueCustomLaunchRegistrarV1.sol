// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {
    IProgrammableProtocolFeeSourceV1,
    ProtocolRevenueSourceConfigV1
} from "../IProgrammableProtocolFeeSourceV1.sol";
import {
    CustomRevenueApprovalStateV2,
    CustomRevenueLaunchStateV2,
    CustomRevenueLaunchStatusV2,
    IProgrammableCustomFeeSourceV2,
    IProgrammableCustomRevenueRegistryV2,
    IProgrammableLaunchStampRouterV1,
    IProtocolRevenueSourceRegistryCustomRegistrarV1,
    ProgrammableLaunchStampRecordV1
} from "./IProgrammableCustomRevenueReleaseV2.sol";

/// @title ProtocolRevenueCustomLaunchRegistrarV1
/// @notice Preproposes only future Custom native-fee sources and admits them to worker enumeration only after finality.
/// @dev The registrar deliberately has no source-activation capability. ProtocolRevenueSourceRegistryV1's independent
///      activator must activate the exact mature proposal after deployment. This registrar then accepts the source only
///      when Custom Registry V2 and Launch Stamp V1 expose the same finalized, exact, 10 bps native binding.
contract ProtocolRevenueCustomLaunchRegistrarV1 is AccessControlDefaultAdminRules, ReentrancyGuard {
    using SafeCast for uint256;

    bytes32 public constant LAUNCH_ADMITTER_ROLE = keccak256("programmable.custom-revenue.launch-admitter.v1");
    bytes32 public constant PROPOSAL_DOMAIN = keccak256("programmable.custom-revenue.release-proposal.v1");
    bytes32 public constant CUSTOM_LAUNCH_CLASS_ID = keccak256("programmable.custom-launch.v2");
    uint256 public constant SUPPORTED_CHAIN_ID = 1;
    uint64 public constant MINIMUM_FINALITY_BLOCKS = 64;
    uint8 public constant CUSTOM_GRAPH_LAUNCH_KIND = 1;
    uint16 public constant PROGRAMMABLE_FEE_BPS = 10;
    address public constant NATIVE_ASSET = address(0);
    address public constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    bytes4 public constant CLAIM_SELECTOR = IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector;
    bytes4 public constant STANDARD_SOURCE_INTERFACE_ID = type(IProgrammableProtocolFeeSourceV1).interfaceId;
    bytes4 public constant FEE_BPS_SELECTOR = IProgrammableCustomFeeSourceV2.programmableFeeBps.selector;

    struct RegistrarConfigV1 {
        uint48 initialAdminDelay;
        address initialAdmin;
        address initialLaunchAdmitter;
        address sourceRegistry;
        bytes32 sourceRegistryRuntimeCodeHash;
        address customRegistryV2;
        bytes32 customRegistryV2RuntimeCodeHash;
        address launchStampRouter;
        bytes32 launchStampRouterRuntimeCodeHash;
    }

    struct FutureCustomProposalV1 {
        bytes32 launchId;
        bytes32 approvalId;
        address launchWallet;
        bytes32 approvalBindingHash;
        bytes32 registrationBindingHash;
        bytes32 expectedLaunchStampHash;
        address approvedFactory;
        bytes32 approvedFactoryRuntimeCodeHash;
        address create2Deployer;
        bytes32 create2DeployerRuntimeCodeHash;
        bytes32 create2Salt;
        bytes32 creationCodeHash;
        bytes32 templateCommitment;
        ProtocolRevenueSourceConfigV1 source;
    }

    struct FutureCustomLaunchRecordV1 {
        ProtocolRevenueSourceConfigV1 source;
        bytes32 approvalId;
        address launchWallet;
        bytes32 approvalBindingHash;
        bytes32 registrationBindingHash;
        bytes32 expectedLaunchStampHash;
        address approvedFactory;
        bytes32 approvedFactoryRuntimeCodeHash;
        address create2Deployer;
        bytes32 create2DeployerRuntimeCodeHash;
        bytes32 create2Salt;
        bytes32 creationCodeHash;
        bytes32 templateCommitment;
        bytes32 coreProposalHash;
        bytes32 proposalCommitment;
        uint64 proposedAtBlock;
        uint64 finalizedAtBlock;
        bytes32 finalityEvidenceHash;
        uint64 launchStampBlockNumber;
        bytes32 launchStampBlockHash;
        uint64 sourceActivatedAtBlock;
        bytes32 sourceActivatedAtBlockHash;
        bytes32 sourceActivationTransactionHash;
        uint32 sourceActivationTransactionIndex;
        uint32 sourceActivationLogIndex;
        bool confirmed;
    }

    IProtocolRevenueSourceRegistryCustomRegistrarV1 public immutable SOURCE_REGISTRY;
    bytes32 public immutable SOURCE_REGISTRY_RUNTIME_CODE_HASH;
    IProgrammableCustomRevenueRegistryV2 public immutable CUSTOM_REGISTRY_V2;
    bytes32 public immutable CUSTOM_REGISTRY_V2_RUNTIME_CODE_HASH;
    IProgrammableLaunchStampRouterV1 public immutable LAUNCH_STAMP_ROUTER;
    bytes32 public immutable LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH;
    uint64 public immutable CUSTOM_REGISTRY_GENERATION;
    uint64 public immutable CUSTOM_REGISTRY_FINALITY_BLOCKS;

    mapping(bytes32 launchId => FutureCustomLaunchRecordV1 record) private _launchRecords;
    mapping(bytes32 sourceId => bytes32 launchId) public launchIdForSource;
    bytes32[] private _finalizedLaunchIds;
    bytes32[] private _finalizedSourceIds;

    error ApprovalBindingMismatch(bytes32 field);
    error ApprovalConsumed(bytes32 approvalId);
    error ApprovalExpired(uint64 expiresAtBlock, uint256 currentBlock);
    error ApprovalNotYetValid(uint64 validAfterBlock, uint256 currentBlock);
    error CustomLaunchNotFinalized(bytes32 launchId, CustomRevenueLaunchStatusV2 status);
    error FinalityBindingMismatch(bytes32 field);
    error FinalityDepthInsufficient(uint64 observedAtBlock, uint64 finalizedAtBlock, uint64 minimum);
    error InfrastructureBindingMismatch(bytes32 field);
    error InvalidBinding(bytes32 field);
    error InvalidOperationalRoleAccount(address account);
    error LaunchAlreadyConfirmed(bytes32 launchId);
    error LaunchAlreadyProposed(bytes32 launchId);
    error LaunchNotProposed(bytes32 launchId);
    error SourceAlreadyProposed(bytes32 sourceId, bytes32 launchId);
    error SourceBindingMismatch(bytes32 field);
    error SourceNotExecutable(bytes32 sourceId);
    error SourceNotRegistered(bytes32 sourceId);
    error SourceQuarantined(bytes32 sourceId);
    error SourceReturnMalformed(address source, bytes4 selector, uint256 size);
    error SourceReturnValueInvalid(address source, bytes4 selector, uint256 value);
    error UnsupportedChain(uint256 supplied, uint256 expected);

    event FutureCustomRevenueSourceProposedV1(
        bytes32 indexed launchId,
        bytes32 indexed sourceId,
        address indexed source,
        bytes32 approvalId,
        bytes32 registrationBindingHash,
        bytes32 expectedLaunchStampHash,
        bytes32 proposalCommitment
    );

    event FutureCustomRevenueSourceFinalizedV1(
        bytes32 indexed launchId,
        bytes32 indexed sourceId,
        address indexed source,
        bytes32 launchStampHash,
        bytes32 finalityEvidenceHash,
        uint64 launchStampBlockNumber,
        bytes32 launchStampBlockHash,
        uint64 finalizedAtBlock
    );

    constructor(RegistrarConfigV1 memory config)
        AccessControlDefaultAdminRules(config.initialAdminDelay, config.initialAdmin)
    {
        if (block.chainid != SUPPORTED_CHAIN_ID) revert UnsupportedChain(block.chainid, SUPPORTED_CHAIN_ID);
        if (config.initialAdmin == address(0) || config.initialLaunchAdmitter == address(0)) {
            revert InvalidOperationalRoleAccount(address(0));
        }
        if (config.initialAdmin == config.initialLaunchAdmitter) {
            revert InvalidOperationalRoleAccount(config.initialLaunchAdmitter);
        }

        _requireRuntime(config.sourceRegistry, config.sourceRegistryRuntimeCodeHash, "source-registry");
        _requireRuntime(config.customRegistryV2, config.customRegistryV2RuntimeCodeHash, "custom-registry-v2");
        _requireRuntime(config.launchStampRouter, config.launchStampRouterRuntimeCodeHash, "launch-stamp-router");

        IProtocolRevenueSourceRegistryCustomRegistrarV1 sourceRegistry =
            IProtocolRevenueSourceRegistryCustomRegistrarV1(config.sourceRegistry);
        IProgrammableCustomRevenueRegistryV2 customRegistryV2 =
            IProgrammableCustomRevenueRegistryV2(config.customRegistryV2);
        IProgrammableLaunchStampRouterV1 launchStampRouter = IProgrammableLaunchStampRouterV1(config.launchStampRouter);

        if (
            sourceRegistry.CHAIN_ID() != SUPPORTED_CHAIN_ID || sourceRegistry.rewardWallet() != REWARD_WALLET
                || sourceRegistry.CLAIM_SELECTOR() != CLAIM_SELECTOR
                || sourceRegistry.SOURCE_INTERFACE_ID() != STANDARD_SOURCE_INTERFACE_ID
                || sourceRegistry.MIN_ACTIVATION_DELAY_BLOCKS() < MINIMUM_FINALITY_BLOCKS
        ) revert InfrastructureBindingMismatch("source-registry-policy");
        if (
            customRegistryV2.CHAIN_ID() != SUPPORTED_CHAIN_ID || customRegistryV2.REGISTRY_GENERATION() < 2
                || customRegistryV2.MINIMUM_FINALITY_BLOCKS() < MINIMUM_FINALITY_BLOCKS
        ) revert InfrastructureBindingMismatch("custom-registry-v2-policy");
        if (launchStampRouter.CHAIN_ID() != SUPPORTED_CHAIN_ID) {
            revert InfrastructureBindingMismatch("launch-stamp-chain");
        }

        SOURCE_REGISTRY = sourceRegistry;
        SOURCE_REGISTRY_RUNTIME_CODE_HASH = config.sourceRegistryRuntimeCodeHash;
        CUSTOM_REGISTRY_V2 = customRegistryV2;
        CUSTOM_REGISTRY_V2_RUNTIME_CODE_HASH = config.customRegistryV2RuntimeCodeHash;
        LAUNCH_STAMP_ROUTER = launchStampRouter;
        LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH = config.launchStampRouterRuntimeCodeHash;
        CUSTOM_REGISTRY_GENERATION = customRegistryV2.REGISTRY_GENERATION();
        CUSTOM_REGISTRY_FINALITY_BLOCKS = customRegistryV2.MINIMUM_FINALITY_BLOCKS();
        _grantRole(LAUNCH_ADMITTER_ROLE, config.initialLaunchAdmitter);
    }

    /// @notice Binds one V2-approved future source before any code exists at its predicted CREATE2 address.
    /// @dev This call requires the registrar to hold only the core SOURCE_PROPOSER_ROLE. It must never hold the core
    ///      SOURCE_ACTIVATOR_ROLE; the independent activator remains a separate operational authority.
    function proposeFutureCustom(FutureCustomProposalV1 calldata proposal)
        external
        onlyRole(LAUNCH_ADMITTER_ROLE)
        nonReentrant
        returns (bytes32 coreProposalHash, bytes32 proposalCommitment)
    {
        _assertInfrastructure();
        _validateProposalShape(proposal);
        if (_launchRecords[proposal.launchId].proposedAtBlock != 0) {
            revert LaunchAlreadyProposed(proposal.launchId);
        }
        bytes32 occupiedLaunchId = launchIdForSource[proposal.source.sourceId];
        if (occupiedLaunchId != bytes32(0)) {
            revert SourceAlreadyProposed(proposal.source.sourceId, occupiedLaunchId);
        }

        CustomRevenueApprovalStateV2 memory approval = CUSTOM_REGISTRY_V2.approvalState(proposal.approvalId);
        _validateApproval(proposal, approval);

        coreProposalHash = SOURCE_REGISTRY.proposeSource(proposal.source);
        uint64 proposedAtBlock = block.number.toUint64();
        proposalCommitment = _proposalCommitment(proposal, coreProposalHash, proposedAtBlock);

        FutureCustomLaunchRecordV1 storage record = _launchRecords[proposal.launchId];
        record.source = proposal.source;
        record.approvalId = proposal.approvalId;
        record.launchWallet = proposal.launchWallet;
        record.approvalBindingHash = proposal.approvalBindingHash;
        record.registrationBindingHash = proposal.registrationBindingHash;
        record.expectedLaunchStampHash = proposal.expectedLaunchStampHash;
        record.approvedFactory = proposal.approvedFactory;
        record.approvedFactoryRuntimeCodeHash = proposal.approvedFactoryRuntimeCodeHash;
        record.create2Deployer = proposal.create2Deployer;
        record.create2DeployerRuntimeCodeHash = proposal.create2DeployerRuntimeCodeHash;
        record.create2Salt = proposal.create2Salt;
        record.creationCodeHash = proposal.creationCodeHash;
        record.templateCommitment = proposal.templateCommitment;
        record.coreProposalHash = coreProposalHash;
        record.proposalCommitment = proposalCommitment;
        record.proposedAtBlock = proposedAtBlock;
        launchIdForSource[proposal.source.sourceId] = proposal.launchId;

        emit FutureCustomRevenueSourceProposedV1(
            proposal.launchId,
            proposal.source.sourceId,
            proposal.source.source,
            proposal.approvalId,
            proposal.registrationBindingHash,
            proposal.expectedLaunchStampHash,
            proposalCommitment
        );
    }

    /// @notice Adds an independently activated source to worker enumeration after exact V2 and Launch Stamp finality.
    function confirmFinalizedLaunch(bytes32 launchId) external nonReentrant {
        _assertInfrastructure();
        FutureCustomLaunchRecordV1 storage record = _launchRecords[launchId];
        if (record.proposedAtBlock == 0) revert LaunchNotProposed(launchId);
        if (record.confirmed) revert LaunchAlreadyConfirmed(launchId);

        _assertDeploymentInfrastructure(record);
        _assertCoreSource(record.source);
        CustomRevenueLaunchStateV2 memory finalized = CUSTOM_REGISTRY_V2.revenueLaunch(launchId);
        _assertFinalizedRegistryBinding(launchId, record, finalized);
        _assertLaunchStamp(launchId, record, finalized);

        record.confirmed = true;
        record.finalizedAtBlock = finalized.finalizedAtBlock;
        record.finalityEvidenceHash = finalized.finalityEvidenceHash;
        record.launchStampBlockNumber = finalized.launchStampBlockNumber;
        record.launchStampBlockHash = finalized.launchStampBlockHash;
        record.sourceActivatedAtBlock = finalized.sourceActivatedAtBlock;
        record.sourceActivatedAtBlockHash = finalized.sourceActivatedAtBlockHash;
        record.sourceActivationTransactionHash = finalized.sourceActivationTransactionHash;
        record.sourceActivationTransactionIndex = finalized.sourceActivationTransactionIndex;
        record.sourceActivationLogIndex = finalized.sourceActivationLogIndex;
        _finalizedLaunchIds.push(launchId);
        _finalizedSourceIds.push(record.source.sourceId);

        emit FutureCustomRevenueSourceFinalizedV1(
            launchId,
            record.source.sourceId,
            record.source.source,
            finalized.launchStampHash,
            finalized.finalityEvidenceHash,
            finalized.launchStampBlockNumber,
            finalized.launchStampBlockHash,
            finalized.finalizedAtBlock
        );
    }

    function launchRecord(bytes32 launchId) external view returns (FutureCustomLaunchRecordV1 memory) {
        return _launchRecords[launchId];
    }

    function finalizedSourceCount() external view returns (uint256) {
        return _finalizedSourceIds.length;
    }

    function finalizedLaunchIdAt(uint256 index) external view returns (bytes32) {
        return _finalizedLaunchIds[index];
    }

    function finalizedSourceIdAt(uint256 index) external view returns (bytes32) {
        return _finalizedSourceIds[index];
    }

    /// @notice Current fail-closed worker eligibility. A later V2 revocation or core quarantine returns false.
    function isFinalizedExecutable(bytes32 launchId) external view returns (bool) {
        FutureCustomLaunchRecordV1 storage record = _launchRecords[launchId];
        if (!record.confirmed || !_infrastructureMatches() || !_deploymentInfrastructureMatches(record)) return false;

        try SOURCE_REGISTRY.isExecutable(record.source.sourceId) returns (bool executable) {
            if (!executable) return false;
        } catch {
            return false;
        }

        try CUSTOM_REGISTRY_V2.revenueLaunch(launchId) returns (CustomRevenueLaunchStateV2 memory state) {
            if (!_currentRegistryBindingMatches(record, state)) return false;
        } catch {
            return false;
        }

        try LAUNCH_STAMP_ROUTER.launchStamp(launchId) returns (ProgrammableLaunchStampRecordV1 memory state) {
            if (
                state.kind != CUSTOM_GRAPH_LAUNCH_KIND || state.hook != record.source.source
                    || state.launchWallet != record.launchWallet || state.stampHash != record.expectedLaunchStampHash
                    || state.routeLauncher != record.approvedFactory
                    || state.routeLauncherRuntimeCodeHash != record.approvedFactoryRuntimeCodeHash
            ) return false;
        } catch {
            return false;
        }
        try LAUNCH_STAMP_ROUTER.launchIdByComponent(record.source.source) returns (bytes32 indexedLaunchId) {
            if (indexedLaunchId != launchId) return false;
        } catch {
            return false;
        }
        try LAUNCH_STAMP_ROUTER.componentRuntimeCodeHash(record.source.source) returns (bytes32 runtimeCodeHash) {
            if (runtimeCodeHash != record.source.runtimeCodeHash) return false;
        } catch {
            return false;
        }
        try LAUNCH_STAMP_ROUTER.stampProof(record.source.source) returns (
            bytes32 proofLaunchId, bytes32 proofStampHash
        ) {
            if (proofLaunchId != launchId || proofStampHash != record.expectedLaunchStampHash) return false;
        } catch {
            return false;
        }
        (bool feeBpsSuccess, uint256 feeBps,) = _tryStaticSourceWord(record.source.source, FEE_BPS_SELECTOR, true);
        if (!feeBpsSuccess || feeBps != PROGRAMMABLE_FEE_BPS) return false;
        return true;
    }

    function _validateProposalShape(FutureCustomProposalV1 calldata proposal) private view {
        if (proposal.launchId == bytes32(0)) revert InvalidBinding("launch-id");
        if (proposal.approvalId == bytes32(0)) revert InvalidBinding("approval-id");
        if (proposal.launchWallet == address(0)) revert InvalidBinding("launch-wallet");
        if (proposal.approvalBindingHash == bytes32(0)) revert InvalidBinding("approval-binding");
        if (proposal.registrationBindingHash == bytes32(0)) revert InvalidBinding("registration-binding");
        if (proposal.expectedLaunchStampHash == bytes32(0)) revert InvalidBinding("launch-stamp-hash");
        if (
            proposal.approvedFactory == address(0) || proposal.approvedFactoryRuntimeCodeHash == bytes32(0)
                || proposal.approvedFactory.codehash != proposal.approvedFactoryRuntimeCodeHash
        ) revert InvalidBinding("approved-factory");
        if (
            proposal.create2Deployer == address(0) || proposal.create2DeployerRuntimeCodeHash == bytes32(0)
                || proposal.create2Deployer.codehash != proposal.create2DeployerRuntimeCodeHash
        ) revert InvalidBinding("create2-deployer");
        if (proposal.creationCodeHash == bytes32(0)) revert InvalidBinding("creation-code-hash");
        if (proposal.templateCommitment == bytes32(0)) revert InvalidBinding("template-commitment");
        if (proposal.source.source == address(0) || proposal.source.source.code.length != 0) {
            revert SourceBindingMismatch("predicted-source");
        }
        if (proposal.source.runtimeCodeHash == bytes32(0)) revert SourceBindingMismatch("source-runtime");
        if (
            _create2Address(proposal.create2Deployer, proposal.create2Salt, proposal.creationCodeHash)
                != proposal.source.source
        ) {
            revert SourceBindingMismatch("create2-prediction");
        }
        if (proposal.source.asset != NATIVE_ASSET) revert SourceBindingMismatch("asset");
        if (proposal.source.claimSelector != CLAIM_SELECTOR) revert SourceBindingMismatch("claim-selector");
        if (proposal.source.recipient != REWARD_WALLET) revert SourceBindingMismatch("recipient");
        if (proposal.source.sourceId != SOURCE_REGISTRY.computeSourceId(proposal.source)) {
            revert SourceBindingMismatch("source-id");
        }
        uint256 minimumActivationBlock = block.number + uint256(MINIMUM_FINALITY_BLOCKS);
        if (uint256(proposal.source.activationBlock) < minimumActivationBlock) {
            revert SourceBindingMismatch("activation-block");
        }
    }

    function _proposalCommitment(
        FutureCustomProposalV1 calldata proposal,
        bytes32 coreProposalHash,
        uint64 proposedAtBlock
    ) private view returns (bytes32) {
        bytes32 infrastructureHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                address(SOURCE_REGISTRY),
                address(CUSTOM_REGISTRY_V2),
                address(LAUNCH_STAMP_ROUTER)
            )
        );
        bytes32 approvalHash = keccak256(
            abi.encode(
                proposal.launchId,
                proposal.approvalId,
                proposal.launchWallet,
                proposal.approvalBindingHash,
                proposal.registrationBindingHash,
                proposal.expectedLaunchStampHash
            )
        );
        bytes32 deploymentHash = keccak256(
            abi.encode(
                proposal.approvedFactory,
                proposal.approvedFactoryRuntimeCodeHash,
                proposal.create2Deployer,
                proposal.create2DeployerRuntimeCodeHash,
                proposal.create2Salt,
                proposal.creationCodeHash,
                proposal.templateCommitment
            )
        );
        return keccak256(
            abi.encode(
                PROPOSAL_DOMAIN,
                infrastructureHash,
                approvalHash,
                deploymentHash,
                proposal.source.sourceId,
                coreProposalHash,
                proposedAtBlock
            )
        );
    }

    function _validateApproval(FutureCustomProposalV1 calldata proposal, CustomRevenueApprovalStateV2 memory approval)
        private
        view
    {
        if (approval.launchId != proposal.launchId) revert ApprovalBindingMismatch("launch-id");
        if (approval.launchWallet != proposal.launchWallet) revert ApprovalBindingMismatch("launch-wallet");
        if (approval.launchClassId != CUSTOM_LAUNCH_CLASS_ID) revert ApprovalBindingMismatch("launch-class");
        if (approval.approvalBindingHash != proposal.approvalBindingHash) {
            revert ApprovalBindingMismatch("approval-binding");
        }
        if (approval.registrationBindingHash != proposal.registrationBindingHash) {
            revert ApprovalBindingMismatch("registration-binding");
        }
        if (approval.expectedLaunchStampHash != proposal.expectedLaunchStampHash) {
            revert ApprovalBindingMismatch("launch-stamp-hash");
        }
        if (approval.evidenceHash == bytes32(0)) revert ApprovalBindingMismatch("approval-evidence");
        if (
            approval.approvedFactory != proposal.approvedFactory
                || approval.approvedFactoryRuntimeCodeHash != proposal.approvedFactoryRuntimeCodeHash
        ) revert ApprovalBindingMismatch("approved-factory");
        if (
            approval.create2Deployer != proposal.create2Deployer
                || approval.create2DeployerRuntimeCodeHash != proposal.create2DeployerRuntimeCodeHash
                || approval.create2Salt != proposal.create2Salt
                || approval.creationCodeHash != proposal.creationCodeHash
        ) revert ApprovalBindingMismatch("create2-binding");
        if (approval.templateCommitment != proposal.templateCommitment) {
            revert ApprovalBindingMismatch("template-commitment");
        }
        if (
            approval.source != proposal.source.source
                || approval.sourceRuntimeCodeHash != proposal.source.runtimeCodeHash || approval.asset != NATIVE_ASSET
                || approval.claimSelector != CLAIM_SELECTOR
                || approval.standardInterfaceId != STANDARD_SOURCE_INTERFACE_ID || approval.recipient != REWARD_WALLET
                || approval.programmableFeeBps != PROGRAMMABLE_FEE_BPS
                || approval.activationBlock != proposal.source.activationBlock
        ) revert ApprovalBindingMismatch("source-policy");
        if (approval.consumed) revert ApprovalConsumed(proposal.approvalId);
        if (block.number < uint256(approval.validAfterBlock)) {
            revert ApprovalNotYetValid(approval.validAfterBlock, block.number);
        }
        if (block.number > uint256(approval.expiresAtBlock)) {
            revert ApprovalExpired(approval.expiresAtBlock, block.number);
        }
    }

    function _assertCoreSource(ProtocolRevenueSourceConfigV1 storage expected) private view {
        (ProtocolRevenueSourceConfigV1 memory config, bool registered, bool quarantined) =
            SOURCE_REGISTRY.sourceState(expected.sourceId);
        if (!registered) revert SourceNotRegistered(expected.sourceId);
        if (quarantined) revert SourceQuarantined(expected.sourceId);
        if (!_sameConfig(config, expected)) revert SourceBindingMismatch("core-source-state");
        if (!SOURCE_REGISTRY.isExecutable(expected.sourceId)) revert SourceNotExecutable(expected.sourceId);

        uint256 feeBps = _staticSourceWord(expected.source, FEE_BPS_SELECTOR, true);
        if (feeBps != PROGRAMMABLE_FEE_BPS) {
            revert SourceReturnValueInvalid(expected.source, FEE_BPS_SELECTOR, feeBps);
        }
    }

    function _assertFinalizedRegistryBinding(
        bytes32 launchId,
        FutureCustomLaunchRecordV1 storage record,
        CustomRevenueLaunchStateV2 memory finalized
    ) private view {
        if (finalized.status != CustomRevenueLaunchStatusV2.Finalized) {
            revert CustomLaunchNotFinalized(launchId, finalized.status);
        }
        if (finalized.approvalId != record.approvalId) revert FinalityBindingMismatch("approval-id");
        if (finalized.launchClassId != CUSTOM_LAUNCH_CLASS_ID) revert FinalityBindingMismatch("launch-class");
        if (finalized.approvalBindingHash != record.approvalBindingHash) {
            revert FinalityBindingMismatch("approval-binding");
        }
        if (finalized.registrationBindingHash != record.registrationBindingHash) {
            revert FinalityBindingMismatch("registration-binding");
        }
        if (finalized.finalityEvidenceHash == bytes32(0)) revert FinalityBindingMismatch("finality-evidence");
        if (finalized.launchWallet != record.launchWallet) revert FinalityBindingMismatch("launch-wallet");
        if (
            finalized.approvedFactory != record.approvedFactory
                || finalized.approvedFactoryRuntimeCodeHash != record.approvedFactoryRuntimeCodeHash
        ) revert FinalityBindingMismatch("approved-factory");
        if (
            finalized.create2Deployer != record.create2Deployer
                || finalized.create2DeployerRuntimeCodeHash != record.create2DeployerRuntimeCodeHash
                || finalized.create2Salt != record.create2Salt || finalized.creationCodeHash != record.creationCodeHash
                || finalized.templateCommitment != record.templateCommitment
        ) revert FinalityBindingMismatch("deployment-template");
        if (
            finalized.sourceRegistry != address(SOURCE_REGISTRY)
                || finalized.sourceRegistryRuntimeCodeHash != SOURCE_REGISTRY_RUNTIME_CODE_HASH
        ) revert FinalityBindingMismatch("source-registry");
        if (
            finalized.sourceId != record.source.sourceId || finalized.source != record.source.source
                || finalized.sourceRuntimeCodeHash != record.source.runtimeCodeHash
        ) revert FinalityBindingMismatch("source");
        if (
            finalized.asset != NATIVE_ASSET || finalized.claimSelector != CLAIM_SELECTOR
                || finalized.standardInterfaceId != STANDARD_SOURCE_INTERFACE_ID || finalized.recipient != REWARD_WALLET
                || finalized.programmableFeeBps != PROGRAMMABLE_FEE_BPS
                || finalized.activationBlock != record.source.activationBlock
        ) revert FinalityBindingMismatch("source-policy");
        if (
            finalized.launchStampRouter != address(LAUNCH_STAMP_ROUTER)
                || finalized.launchStampRouterRuntimeCodeHash != LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH
                || finalized.launchStampHash != record.expectedLaunchStampHash
                || finalized.launchStampBlockHash == bytes32(0)
        ) revert FinalityBindingMismatch("launch-stamp-binding");
        if (
            finalized.observedAtBlock != finalized.launchStampBlockNumber
                || finalized.launchStampBlockNumber < record.proposedAtBlock
                || finalized.finalizedAtBlock > block.number
        ) revert FinalityBindingMismatch("launch-stamp-block");
        if (
            finalized.sourceActivatedAtBlock < record.proposedAtBlock
                || finalized.sourceActivatedAtBlock < record.source.activationBlock
                || finalized.sourceActivatedAtBlock > finalized.launchStampBlockNumber
                || finalized.sourceActivatedAtBlockHash == bytes32(0)
                || finalized.sourceActivationTransactionHash == bytes32(0)
                || finalized.sourceActivatedTotalClaimedBaseline != 0
        ) revert FinalityBindingMismatch("source-activation-baseline");
        uint256 minimumFinalizedBlock =
            uint256(finalized.launchStampBlockNumber) + uint256(CUSTOM_REGISTRY_FINALITY_BLOCKS);
        if (uint256(finalized.finalizedAtBlock) < minimumFinalizedBlock) {
            revert FinalityDepthInsufficient(
                finalized.launchStampBlockNumber, finalized.finalizedAtBlock, CUSTOM_REGISTRY_FINALITY_BLOCKS
            );
        }
    }

    function _assertLaunchStamp(
        bytes32 launchId,
        FutureCustomLaunchRecordV1 storage record,
        CustomRevenueLaunchStateV2 memory finalized
    ) private view {
        ProgrammableLaunchStampRecordV1 memory stamp = LAUNCH_STAMP_ROUTER.launchStamp(launchId);
        if (
            stamp.kind != CUSTOM_GRAPH_LAUNCH_KIND || stamp.launchWallet != record.launchWallet
                || stamp.hook != record.source.source || stamp.stampHash != record.expectedLaunchStampHash
                || stamp.routeLauncher != record.approvedFactory
                || stamp.routeLauncherRuntimeCodeHash != record.approvedFactoryRuntimeCodeHash
        ) revert FinalityBindingMismatch("launch-stamp-record");
        if (LAUNCH_STAMP_ROUTER.launchIdByComponent(record.source.source) != launchId) {
            revert FinalityBindingMismatch("launch-stamp-component-index");
        }
        if (LAUNCH_STAMP_ROUTER.componentRuntimeCodeHash(record.source.source) != record.source.runtimeCodeHash) {
            revert FinalityBindingMismatch("launch-stamp-component-runtime");
        }
        (bytes32 proofLaunchId, bytes32 proofStampHash) = LAUNCH_STAMP_ROUTER.stampProof(record.source.source);
        if (proofLaunchId != launchId || proofStampHash != finalized.launchStampHash) {
            revert FinalityBindingMismatch("launch-stamp-proof");
        }
    }

    function _currentRegistryBindingMatches(
        FutureCustomLaunchRecordV1 storage record,
        CustomRevenueLaunchStateV2 memory current
    ) private view returns (bool) {
        return current.status == CustomRevenueLaunchStatusV2.Finalized && current.approvalId == record.approvalId
            && current.launchClassId == CUSTOM_LAUNCH_CLASS_ID
            && current.approvalBindingHash == record.approvalBindingHash
            && current.registrationBindingHash == record.registrationBindingHash
            && current.finalityEvidenceHash == record.finalityEvidenceHash
            && current.finalizedAtBlock == record.finalizedAtBlock
            && current.observedAtBlock == record.launchStampBlockNumber
            && current.launchStampBlockNumber == record.launchStampBlockNumber
            && current.launchStampBlockHash == record.launchStampBlockHash
            && current.launchWallet == record.launchWallet && current.sourceRegistry == address(SOURCE_REGISTRY)
            && current.approvedFactory == record.approvedFactory
            && current.approvedFactoryRuntimeCodeHash == record.approvedFactoryRuntimeCodeHash
            && current.create2Deployer == record.create2Deployer
            && current.create2DeployerRuntimeCodeHash == record.create2DeployerRuntimeCodeHash
            && current.create2Salt == record.create2Salt && current.creationCodeHash == record.creationCodeHash
            && current.templateCommitment == record.templateCommitment
            && current.sourceRegistryRuntimeCodeHash == SOURCE_REGISTRY_RUNTIME_CODE_HASH
            && current.sourceId == record.source.sourceId && current.source == record.source.source
            && current.sourceRuntimeCodeHash == record.source.runtimeCodeHash && current.asset == NATIVE_ASSET
            && current.claimSelector == CLAIM_SELECTOR && current.standardInterfaceId == STANDARD_SOURCE_INTERFACE_ID
            && current.recipient == REWARD_WALLET && current.programmableFeeBps == PROGRAMMABLE_FEE_BPS
            && current.activationBlock == record.source.activationBlock
            && current.launchStampRouter == address(LAUNCH_STAMP_ROUTER)
            && current.launchStampRouterRuntimeCodeHash == LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH
            && current.launchStampHash == record.expectedLaunchStampHash
            && current.sourceActivatedAtBlock == record.sourceActivatedAtBlock
            && current.sourceActivatedAtBlockHash == record.sourceActivatedAtBlockHash
            && current.sourceActivationTransactionHash == record.sourceActivationTransactionHash
            && current.sourceActivationTransactionIndex == record.sourceActivationTransactionIndex
            && current.sourceActivationLogIndex == record.sourceActivationLogIndex
            && current.sourceActivatedTotalClaimedBaseline == 0;
    }

    function _sameConfig(ProtocolRevenueSourceConfigV1 memory left, ProtocolRevenueSourceConfigV1 storage right)
        private
        view
        returns (bool)
    {
        return left.sourceId == right.sourceId && left.source == right.source
            && left.runtimeCodeHash == right.runtimeCodeHash && left.asset == right.asset
            && left.claimSelector == right.claimSelector && left.recipient == right.recipient
            && left.activationBlock == right.activationBlock;
    }

    function _assertInfrastructure() private view {
        if (!_infrastructureMatches()) revert InfrastructureBindingMismatch("runtime-code-hash");
    }

    function _assertDeploymentInfrastructure(FutureCustomLaunchRecordV1 storage record) private view {
        if (!_deploymentInfrastructureMatches(record)) {
            revert InfrastructureBindingMismatch("deployment-runtime-code-hash");
        }
    }

    function _deploymentInfrastructureMatches(FutureCustomLaunchRecordV1 storage record) private view returns (bool) {
        address approvedFactory = record.approvedFactory;
        address create2Deployer = record.create2Deployer;
        return approvedFactory.codehash == record.approvedFactoryRuntimeCodeHash
            && create2Deployer.codehash == record.create2DeployerRuntimeCodeHash;
    }

    function _infrastructureMatches() private view returns (bool) {
        return address(SOURCE_REGISTRY).codehash == SOURCE_REGISTRY_RUNTIME_CODE_HASH
            && address(CUSTOM_REGISTRY_V2).codehash == CUSTOM_REGISTRY_V2_RUNTIME_CODE_HASH
            && address(LAUNCH_STAMP_ROUTER).codehash == LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH;
    }

    function _requireRuntime(address target, bytes32 expected, bytes32 field) private view {
        if (target == address(0) || target.code.length == 0 || expected == bytes32(0) || target.codehash != expected) {
            revert InfrastructureBindingMismatch(field);
        }
    }

    function _create2Address(address deployer, bytes32 salt, bytes32 creationCodeHash)
        private
        pure
        returns (address predicted)
    {
        bytes32 digest = keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, creationCodeHash));
        predicted = address(uint160(uint256(digest)));
    }

    /// @dev Reads exactly one word without copying attacker-controlled return or revert data.
    function _staticSourceWord(address source, bytes4 selector, bool includeAsset)
        private
        view
        returns (uint256 result)
    {
        (bool exactSuccess, uint256 exactResult, uint256 returnDataSize) =
            _tryStaticSourceWord(source, selector, includeAsset);
        if (!exactSuccess) revert SourceReturnMalformed(source, selector, returnDataSize);
        return exactResult;
    }

    /// @dev Reads exactly one word and never copies attacker-controlled return or revert data.
    function _tryStaticSourceWord(address source, bytes4 selector, bool includeAsset)
        private
        view
        returns (bool exactSuccess, uint256 result, uint256 returnDataSize)
    {
        bytes memory callData =
            includeAsset ? abi.encodeWithSelector(selector, NATIVE_ASSET) : abi.encodeWithSelector(selector);
        bool callSuccess;
        assembly ("memory-safe") {
            callSuccess := staticcall(gas(), source, add(callData, 0x20), mload(callData), 0, 0)
            returnDataSize := returndatasize()
            if and(callSuccess, eq(returnDataSize, 0x20)) {
                returndatacopy(0, 0, 0x20)
                result := mload(0)
            }
        }
        exactSuccess = callSuccess && returnDataSize == 32;
    }

    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        if (role == LAUNCH_ADMITTER_ROLE && (account == address(0) || hasRole(DEFAULT_ADMIN_ROLE, account))) {
            revert InvalidOperationalRoleAccount(account);
        }
        if (role == DEFAULT_ADMIN_ROLE && hasRole(LAUNCH_ADMITTER_ROLE, account)) {
            revert InvalidOperationalRoleAccount(account);
        }
        return super._grantRole(role, account);
    }
}
