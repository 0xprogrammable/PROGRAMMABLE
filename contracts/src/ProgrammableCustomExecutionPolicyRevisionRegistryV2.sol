// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { ProgrammableCustomExecutionPolicyRegistryV2 } from "./ProgrammableCustomExecutionPolicyRegistryV2.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "./interfaces/IProgrammableCustomExecutionPolicyV2.sol";
import {
    IProgrammableCustomExecutionPolicyRevisionV2
} from "./interfaces/IProgrammableCustomExecutionPolicyRevisionV2.sol";
import { IProgrammableCustomRegistryV1 } from "./interfaces/IProgrammableCustomRegistryV1.sol";

/// @title ProgrammableCustomExecutionPolicyRevisionRegistryV2
/// @notice The sole Gen2 Registry corrector and atomic append-only trade-capability revision authority.
contract ProgrammableCustomExecutionPolicyRevisionRegistryV2 is
    AccessControlDefaultAdminRules,
    ReentrancyGuard,
    IProgrammableCustomExecutionPolicyRevisionV2
{
    bytes32 public constant REVISION_APPROVAL_DOMAIN =
        keccak256("programmable.custom-execution-policy-revision-approval.v1");
    bytes32 public constant CORRECTED_RECORD_DOMAIN =
        keccak256("programmable.custom-execution-policy-corrected-record.v1");
    bytes32 public constant APPROVER_ROLE = keccak256("programmable.custom-execution-policy.approver.v2");
    bytes32 public constant CORRECTOR_ROLE = keccak256("programmable.custom-execution-policy.corrector.v2");
    bytes32 public constant REVOKER_ROLE = keccak256("programmable.custom-execution-policy.revoker.v2");
    uint64 public constant REQUIRED_REGISTRY_GENERATION = 2;

    IProgrammableCustomRegistryV1 public immutable REGISTRY;
    ProgrammableCustomExecutionPolicyRegistryV2 public immutable INITIAL_POLICY_REGISTRY;
    uint256 public immutable CHAIN_ID;

    mapping(bytes32 approvalId => TradeCapabilityRevisionApprovalStateV1 state) private _approvalStates;
    mapping(bytes32 launchId => bytes32 approvalId) public pendingTradeCapabilityRevisionApprovalId;
    mapping(bytes32 launchId => bytes32 policyHash) private _currentPolicyHashes;
    mapping(bytes32 launchId => uint64 revision) private _currentPolicyRevisions;
    mapping(bytes32 launchId => mapping(uint64 revision => bytes32 policyHash)) private _policyHashesByRevision;
    mapping(bytes32 evidenceHash => bool consumed) public evidenceConsumed;

    error ApprovalAlreadyAuthorized(bytes32 approvalId);
    error ApprovalAlreadyConsumed(bytes32 approvalId);
    error ApprovalBindingMismatch(bytes32 supplied, bytes32 expected);
    error ApprovalExpired(uint64 expiresAtBlock, uint256 currentBlock);
    error ApprovalNotAuthorized(bytes32 approvalId);
    error ApprovalNotYetValid(uint64 validAfterBlock, uint256 currentBlock);
    error ApprovalRevoked(bytes32 approvalId);
    error CorrectionBindingMismatch(bytes32 field);
    error EvidenceAlreadyConsumed(bytes32 evidenceHash);
    error IncompatibleOperationalRoles(address account);
    error InvalidBinding(bytes32 field);
    error InvalidRegistryBinding(bytes32 field);
    error InvalidWindow(uint64 validAfterBlock, uint64 expiresAtBlock);
    error PendingApprovalExists(bytes32 launchId, bytes32 approvalId);
    error PolicyHashUnchanged(bytes32 policyHash);
    error RegistryScopeMismatch(uint256 suppliedChainId, uint64 suppliedGeneration);
    error RevisionMismatch(uint64 supplied, uint64 expected);

    constructor(
        IProgrammableCustomRegistryV1 predictedRegistry,
        ProgrammableCustomExecutionPolicyRegistryV2 initialPolicyRegistry,
        uint48 initialAdminDelay,
        address initialAdmin,
        address initialApprover,
        address initialCorrector,
        address initialRevoker
    ) AccessControlDefaultAdminRules(initialAdminDelay, initialAdmin) {
        if (address(predictedRegistry) == address(0)) {
            revert InvalidRegistryBinding(bytes32("registry"));
        }
        if (address(initialPolicyRegistry) == address(0) || address(initialPolicyRegistry).code.length == 0) {
            revert InvalidRegistryBinding(bytes32("initial-policy"));
        }
        if (address(initialPolicyRegistry.REGISTRY()) != address(predictedRegistry)) {
            revert InvalidRegistryBinding(bytes32("initial-policy-registry"));
        }
        if (initialApprover == address(0)) revert InvalidBinding(bytes32("approver"));
        if (initialCorrector == address(0)) revert InvalidBinding(bytes32("corrector"));
        if (initialRevoker == address(0)) revert InvalidBinding(bytes32("revoker"));
        if (
            initialApprover == initialCorrector || initialApprover == initialRevoker
                || initialCorrector == initialRevoker
        ) revert IncompatibleOperationalRoles(initialApprover);

        REGISTRY = predictedRegistry;
        INITIAL_POLICY_REGISTRY = initialPolicyRegistry;
        CHAIN_ID = block.chainid;
        _grantRole(APPROVER_ROLE, initialApprover);
        _grantRole(CORRECTOR_ROLE, initialCorrector);
        _grantRole(REVOKER_ROLE, initialRevoker);
    }

    function computeTradeCapabilityRevisionApprovalHashV1(TradeCapabilityRevisionApprovalV1 calldata approval)
        external
        pure
        returns (bytes32)
    {
        return _approvalHash(approval);
    }

    function computeTradeCapabilityRevisionRecordHashV1(TradeCapabilityRevisionApprovalV1 calldata approval)
        external
        pure
        returns (bytes32)
    {
        return _correctedRecordHash(approval);
    }

    function authorizeTradeCapabilityRevisionV1(TradeCapabilityRevisionApprovalV1 calldata approval)
        external
        onlyRole(APPROVER_ROLE)
    {
        _validateApproval(approval);
        bytes32 approvalBindingHash = _approvalHash(approval);
        if (_approvalStates[approval.approvalId].approvalBindingHash != bytes32(0)) {
            revert ApprovalAlreadyAuthorized(approval.approvalId);
        }
        bytes32 pending = pendingTradeCapabilityRevisionApprovalId[approval.launchId];
        if (pending != bytes32(0)) revert PendingApprovalExists(approval.launchId, pending);
        if (evidenceConsumed[approval.approvalEvidenceHash]) {
            revert EvidenceAlreadyConsumed(approval.approvalEvidenceHash);
        }
        if (evidenceConsumed[approval.correctionEvidenceHash]) {
            revert EvidenceAlreadyConsumed(approval.correctionEvidenceHash);
        }

        bytes32 correctedRecordHash = _correctedRecordHash(approval);
        TradeCapabilityRevisionApprovalStateV1 storage stored = _approvalStates[approval.approvalId];
        stored.chainId = approval.chainId;
        stored.registryGeneration = approval.registryGeneration;
        stored.launchId = approval.launchId;
        stored.revision = approval.revision;
        stored.previousPolicyHash = approval.previousPolicyHash;
        stored.newPolicyHash = approval.newPolicyHash;
        stored.policyReplacement = approval.policyReplacement;
        stored.previousRecordHash = approval.previousRecordHash;
        stored.correctedRecordPayloadHash = approval.correctedRecordPayloadHash;
        stored.correctionReasonCode = approval.correctionReasonCode;
        stored.correctionEvidenceHash = approval.correctionEvidenceHash;
        stored.validAfterBlock = approval.validAfterBlock;
        stored.expiresAtBlock = approval.expiresAtBlock;
        stored.approvalEvidenceHash = approval.approvalEvidenceHash;
        stored.approvalBindingHash = approvalBindingHash;
        stored.correctedRecordHash = correctedRecordHash;
        pendingTradeCapabilityRevisionApprovalId[approval.launchId] = approval.approvalId;
        evidenceConsumed[approval.approvalEvidenceHash] = true;
        evidenceConsumed[approval.correctionEvidenceHash] = true;

        _emitApproval(approval, approvalBindingHash, correctedRecordHash);
    }

    function revokeTradeCapabilityRevisionApprovalV1(bytes32 approvalId, bytes32 reasonCode, bytes32 evidenceHash)
        external
        onlyRole(REVOKER_ROLE)
    {
        TradeCapabilityRevisionApprovalStateV1 storage approval = _approvalStates[approvalId];
        if (approval.approvalBindingHash == bytes32(0)) revert ApprovalNotAuthorized(approvalId);
        if (approval.consumed) revert ApprovalAlreadyConsumed(approvalId);
        if (approval.revoked) revert ApprovalRevoked(approvalId);
        _requireBinding(reasonCode, bytes32("reason"));
        _requireBinding(evidenceHash, bytes32("evidence"));
        if (evidenceConsumed[evidenceHash]) revert EvidenceAlreadyConsumed(evidenceHash);
        approval.revoked = true;
        evidenceConsumed[evidenceHash] = true;
        delete pendingTradeCapabilityRevisionApprovalId[approval.launchId];
        emit CustomLaunchExecutionPolicyRevisionApprovalRevokedV2(
            approvalId, approval.launchId, approval.revision, reasonCode, evidenceHash
        );
    }

    /// @notice Atomically corrects the Registry record and publishes its exact approved policy revision.
    function correctAndBindRevisionV1(
        IProgrammableCustomRegistryV1.RecordCorrectionV1 calldata correction,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability,
        bytes32 approvalId
    ) external nonReentrant onlyRole(CORRECTOR_ROLE) {
        TradeCapabilityRevisionApprovalStateV1 storage approval = _approvalStates[approvalId];
        _validateCorrection(correction, capability, approvalId, approval);
        bytes32 actualPolicyHash = approval.newPolicyHash;
        if (!approval.policyReplacement) {
            _requireEmptyCapability(capability);
            actualPolicyHash = approval.previousPolicyHash;
        }

        // The fixed Registry call happens before companion state/events. Any later failure reverts both contracts.
        REGISTRY.correctLaunchRecord(correction);

        approval.consumed = true;
        delete pendingTradeCapabilityRevisionApprovalId[correction.launchId];
        _policyHashesByRevision[correction.launchId][correction.revision - 1] = approval.previousPolicyHash;
        _policyHashesByRevision[correction.launchId][correction.revision] = actualPolicyHash;
        _currentPolicyHashes[correction.launchId] = actualPolicyHash;
        _currentPolicyRevisions[correction.launchId] = correction.revision;

        emit CustomLaunchRecordRevisionSupersededV2(
            correction.launchId, correction.previousRecordHash, correction.correctedRecordHash, correction.revision
        );
        if (approval.policyReplacement) {
            actualPolicyHash = INITIAL_POLICY_REGISTRY.emitTradeCapabilityRevisionV1(capability, actualPolicyHash);
            emit CustomLaunchExecutionPolicySupersededV2(
                correction.launchId,
                approval.previousPolicyHash,
                actualPolicyHash,
                correction.revision,
                correction.reasonCode,
                correction.evidenceHash
            );
            emit CustomLaunchExecutionPolicyCorrectedV2(
                correction.launchId,
                actualPolicyHash,
                correction.correctedRecordHash,
                correction.revision,
                approvalId,
                approval.approvalEvidenceHash
            );
        } else {
            emit CustomLaunchExecutionPolicyRetainedV2(
                correction.launchId, actualPolicyHash, correction.correctedRecordHash, correction.revision, approvalId
            );
        }
        emit CustomLaunchExecutionPolicyRevisionBoundV2(
            correction.launchId,
            approvalId,
            correction.revision,
            approval.previousPolicyHash,
            actualPolicyHash,
            correction.correctedRecordHash,
            block.number
        );
    }

    function tradeCapabilityHash(bytes32 launchId) public view returns (bytes32) {
        bytes32 revised = _currentPolicyHashes[launchId];
        return revised == bytes32(0) ? INITIAL_POLICY_REGISTRY.tradeCapabilityHash(launchId) : revised;
    }

    function tradeCapabilityRevision(bytes32 launchId) public view returns (uint64) {
        uint64 revised = _currentPolicyRevisions[launchId];
        if (revised != 0) return revised;
        return INITIAL_POLICY_REGISTRY.tradeCapabilityHash(launchId) == bytes32(0) ? 0 : 1;
    }

    function tradeCapabilityHashAtRevision(bytes32 launchId, uint64 revision) external view returns (bytes32) {
        bytes32 revised = _policyHashesByRevision[launchId][revision];
        if (revised != bytes32(0)) return revised;
        return revision == 1 ? INITIAL_POLICY_REGISTRY.tradeCapabilityHash(launchId) : bytes32(0);
    }

    function tradeCapabilityRevisionApprovalState(bytes32 approvalId)
        external
        view
        returns (TradeCapabilityRevisionApprovalStateV1 memory)
    {
        return _approvalStates[approvalId];
    }

    function _validateApproval(TradeCapabilityRevisionApprovalV1 calldata approval) private view {
        if (approval.chainId != CHAIN_ID || approval.registryGeneration != REQUIRED_REGISTRY_GENERATION) {
            revert RegistryScopeMismatch(approval.chainId, approval.registryGeneration);
        }
        _requireBinding(approval.launchId, bytes32("launch-id"));
        _requireBinding(approval.approvalId, bytes32("approval-id"));
        _requireBinding(approval.previousPolicyHash, bytes32("previous-policy"));
        _requireBinding(approval.newPolicyHash, bytes32("new-policy"));
        _requireBinding(approval.previousRecordHash, bytes32("previous-record"));
        _requireBinding(approval.correctedRecordPayloadHash, bytes32("corrected-record-payload"));
        _requireBinding(approval.correctionReasonCode, bytes32("correction-reason"));
        _requireBinding(approval.correctionEvidenceHash, bytes32("correction-evidence"));
        _requireBinding(approval.approvalEvidenceHash, bytes32("approval-evidence"));
        if (approval.policyReplacement) {
            if (approval.newPolicyHash == approval.previousPolicyHash) {
                revert PolicyHashUnchanged(approval.newPolicyHash);
            }
        } else if (approval.newPolicyHash != approval.previousPolicyHash) {
            revert ApprovalBindingMismatch(approval.newPolicyHash, approval.previousPolicyHash);
        }
        if (
            approval.validAfterBlock == 0 || approval.expiresAtBlock == 0
                || approval.validAfterBlock > approval.expiresAtBlock
        ) revert InvalidWindow(approval.validAfterBlock, approval.expiresAtBlock);
        if (approval.expiresAtBlock < block.number) {
            revert ApprovalExpired(approval.expiresAtBlock, block.number);
        }

        IProgrammableCustomRegistryV1.LaunchStateV1 memory state = REGISTRY.launchState(approval.launchId);
        if (state.status != IProgrammableCustomRegistryV1.LaunchStatus.Finalized) {
            revert CorrectionBindingMismatch(bytes32("launch-status"));
        }
        uint64 expectedRevision = state.latestRecordRevision + 1;
        if (approval.revision != expectedRevision) revert RevisionMismatch(approval.revision, expectedRevision);
        if (approval.previousRecordHash != state.latestRecordHash) {
            revert CorrectionBindingMismatch(bytes32("previous-record"));
        }
        bytes32 currentPolicyHash = tradeCapabilityHash(approval.launchId);
        if (approval.previousPolicyHash != currentPolicyHash) {
            revert ApprovalBindingMismatch(approval.previousPolicyHash, currentPolicyHash);
        }
        if (tradeCapabilityRevision(approval.launchId) != state.latestRecordRevision) {
            revert CorrectionBindingMismatch(bytes32("revision-state"));
        }
    }

    function _validateCorrection(
        IProgrammableCustomRegistryV1.RecordCorrectionV1 calldata correction,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability,
        bytes32 approvalId,
        TradeCapabilityRevisionApprovalStateV1 storage approval
    ) private view {
        if (approval.approvalBindingHash == bytes32(0)) revert ApprovalNotAuthorized(approvalId);
        if (approval.consumed) revert ApprovalAlreadyConsumed(approvalId);
        if (approval.revoked) revert ApprovalRevoked(approvalId);
        if (block.number < approval.validAfterBlock) {
            revert ApprovalNotYetValid(approval.validAfterBlock, block.number);
        }
        if (block.number > approval.expiresAtBlock) {
            revert ApprovalExpired(approval.expiresAtBlock, block.number);
        }
        if (pendingTradeCapabilityRevisionApprovalId[approval.launchId] != approvalId) {
            revert ApprovalBindingMismatch(approvalId, pendingTradeCapabilityRevisionApprovalId[approval.launchId]);
        }
        if (
            correction.chainId != approval.chainId || correction.registryGeneration != approval.registryGeneration
                || correction.launchId != approval.launchId || correction.revision != approval.revision
                || correction.previousRecordHash != approval.previousRecordHash
                || correction.correctedRecordHash != approval.correctedRecordHash
                || correction.reasonCode != approval.correctionReasonCode
                || correction.evidenceHash != approval.correctionEvidenceHash
        ) revert CorrectionBindingMismatch(bytes32("correction"));
        if (
            approval.policyReplacement
                && (capability.chainId != approval.chainId
                    || capability.registryGeneration != approval.registryGeneration
                    || capability.launchId != approval.launchId)
        ) revert CorrectionBindingMismatch(bytes32("capability-scope"));

        IProgrammableCustomRegistryV1.LaunchStateV1 memory state = REGISTRY.launchState(correction.launchId);
        if (
            state.status != IProgrammableCustomRegistryV1.LaunchStatus.Finalized
                || state.latestRecordRevision + 1 != correction.revision
                || state.latestRecordHash != correction.previousRecordHash
                || tradeCapabilityHash(correction.launchId) != approval.previousPolicyHash
                || tradeCapabilityRevision(correction.launchId) != state.latestRecordRevision
        ) revert CorrectionBindingMismatch(bytes32("current-state"));
    }

    function _approvalHash(TradeCapabilityRevisionApprovalV1 calldata approval) private pure returns (bytes32) {
        bytes32 scopeHash = keccak256(
            abi.encode(approval.chainId, approval.registryGeneration, approval.launchId, approval.revision)
        );
        bytes32 policyHash =
            keccak256(abi.encode(approval.previousPolicyHash, approval.newPolicyHash, approval.policyReplacement));
        bytes32 correctionHash = keccak256(
            abi.encode(
                approval.previousRecordHash,
                approval.correctedRecordPayloadHash,
                approval.correctionReasonCode,
                approval.correctionEvidenceHash
            )
        );
        bytes32 authorityHash =
            keccak256(abi.encode(approval.validAfterBlock, approval.expiresAtBlock, approval.approvalEvidenceHash));
        return keccak256(
            abi.encode(
                REVISION_APPROVAL_DOMAIN, approval.approvalId, scopeHash, policyHash, correctionHash, authorityHash
            )
        );
    }

    function _correctedRecordHash(TradeCapabilityRevisionApprovalV1 calldata approval) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CORRECTED_RECORD_DOMAIN,
                approval.approvalId,
                _approvalHash(approval),
                approval.correctedRecordPayloadHash
            )
        );
    }

    function _emitApproval(
        TradeCapabilityRevisionApprovalV1 calldata approval,
        bytes32 approvalBindingHash,
        bytes32 correctedRecordHash
    ) private {
        emit CustomLaunchExecutionPolicyRevisionApprovedV2(
            approval.approvalId,
            approval.launchId,
            approval.revision,
            approval.previousPolicyHash,
            approval.newPolicyHash,
            approvalBindingHash,
            correctedRecordHash,
            approval.policyReplacement
        );
        emit CustomLaunchExecutionPolicyRevisionEvidenceBoundV2(
            approval.approvalId,
            approval.launchId,
            approval.revision,
            approval.previousRecordHash,
            approval.correctedRecordPayloadHash,
            approval.correctionReasonCode,
            approval.correctionEvidenceHash,
            approval.validAfterBlock,
            approval.expiresAtBlock,
            approval.approvalEvidenceHash
        );
    }

    function _requireBinding(bytes32 value, bytes32 field) private pure {
        if (value == bytes32(0)) revert InvalidBinding(field);
    }

    function _requireEmptyCapability(IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability)
        private
        pure
    {
        if (
            capability.chainId != 0 || capability.registryGeneration != 0 || capability.launchId != bytes32(0)
                || capability.marketSetHash != bytes32(0) || capability.executionEnabled
                || capability.routeSetHash != bytes32(0) || capability.routes.length != 0
                || capability.marketDataSourceSetHash != bytes32(0) || capability.marketDataSources.length != 0
                || capability.evidenceHash != bytes32(0) || capability.revocationPolicyHash != bytes32(0)
        ) revert CorrectionBindingMismatch(bytes32("retained-policy-capability"));
    }

    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        if (
            (role == APPROVER_ROLE && (hasRole(CORRECTOR_ROLE, account) || hasRole(REVOKER_ROLE, account)))
                || (role == CORRECTOR_ROLE && (hasRole(APPROVER_ROLE, account) || hasRole(REVOKER_ROLE, account)))
                || (role == REVOKER_ROLE && (hasRole(APPROVER_ROLE, account) || hasRole(CORRECTOR_ROLE, account)))
        ) revert IncompatibleOperationalRoles(account);
        return super._grantRole(role, account);
    }
}
