// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCustomExecutionPolicyV2 } from "./IProgrammableCustomExecutionPolicyV2.sol";
import { IProgrammableCustomRegistryV1 } from "./IProgrammableCustomRegistryV1.sol";

/// @notice Append-only Generation 2 approval and binding surface for post-launch trade-capability revisions.
interface IProgrammableCustomExecutionPolicyRevisionV2 {
    event CustomLaunchExecutionPolicyBoundV2(
        bytes32 indexed launchId,
        bytes32 indexed executionPolicyHash,
        bytes32 indexed routeSetHash,
        bytes32 marketSetHash,
        uint32 routeCount,
        bytes32 marketDataSourceSetHash,
        uint32 marketDataSourceCount,
        bool executionEnabled,
        bytes32 evidenceHash,
        bytes32 revocationPolicyHash
    );

    event CustomLaunchExecutionRouteBoundV2(
        bytes32 indexed launchId,
        bytes32 indexed executionPolicyHash,
        uint32 indexed routeIndex,
        bytes32 marketId,
        bytes32 marketPathId,
        uint8 mode,
        bytes32 executorId,
        address executionTarget,
        bytes32 executionTargetRuntimeCodeHash,
        bytes32 configurationHash,
        bytes32 dependencyRuntimeCodeSetHash,
        bytes32 proxyBindingHash,
        bytes32 routeHash
    );

    event CustomLaunchMarketDataSourceBoundV2(
        bytes32 indexed launchId,
        bytes32 indexed executionPolicyHash,
        uint32 indexed sourceIndex,
        bytes32 marketId,
        bytes32 sourceId,
        uint8 kind,
        address sourceTarget,
        bytes32 sourceRuntimeCodeHash,
        uint64 startBlock,
        bytes32 sourceIdentityHash,
        bytes32 metricsHash,
        bytes32 configurationHash,
        bytes32 sourceHash
    );

    event CustomLaunchMarketDataMetricsBoundV2(
        bytes32 indexed launchId,
        bytes32 indexed executionPolicyHash,
        uint32 indexed sourceIndex,
        bytes32 metricsHash,
        bytes32[] metricIds
    );

    struct TradeCapabilityRevisionApprovalV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 approvalId;
        bytes32 launchId;
        uint64 revision;
        bytes32 previousPolicyHash;
        bytes32 newPolicyHash;
        bool policyReplacement;
        bytes32 previousRecordHash;
        bytes32 correctedRecordPayloadHash;
        bytes32 correctionReasonCode;
        bytes32 correctionEvidenceHash;
        uint64 validAfterBlock;
        uint64 expiresAtBlock;
        bytes32 approvalEvidenceHash;
    }

    struct TradeCapabilityRevisionApprovalStateV1 {
        uint256 chainId;
        uint64 registryGeneration;
        bytes32 launchId;
        uint64 revision;
        bytes32 previousPolicyHash;
        bytes32 newPolicyHash;
        bool policyReplacement;
        bytes32 previousRecordHash;
        bytes32 correctedRecordPayloadHash;
        bytes32 correctionReasonCode;
        bytes32 correctionEvidenceHash;
        uint64 validAfterBlock;
        uint64 expiresAtBlock;
        bytes32 approvalEvidenceHash;
        bytes32 approvalBindingHash;
        bytes32 correctedRecordHash;
        bool consumed;
        bool revoked;
    }

    event CustomLaunchExecutionPolicyRevisionApprovedV2(
        bytes32 indexed approvalId,
        bytes32 indexed launchId,
        uint64 indexed revision,
        bytes32 previousPolicyHash,
        bytes32 newPolicyHash,
        bytes32 approvalBindingHash,
        bytes32 correctedRecordHash,
        bool policyReplacement
    );

    event CustomLaunchExecutionPolicyRevisionEvidenceBoundV2(
        bytes32 indexed approvalId,
        bytes32 indexed launchId,
        uint64 indexed revision,
        bytes32 previousRecordHash,
        bytes32 correctedRecordPayloadHash,
        bytes32 correctionReasonCode,
        bytes32 correctionEvidenceHash,
        uint64 validAfterBlock,
        uint64 expiresAtBlock,
        bytes32 approvalEvidenceHash
    );

    event CustomLaunchExecutionPolicyRevisionApprovalRevokedV2(
        bytes32 indexed approvalId,
        bytes32 indexed launchId,
        uint64 indexed revision,
        bytes32 reasonCode,
        bytes32 evidenceHash
    );

    event CustomLaunchExecutionPolicyRevisionBoundV2(
        bytes32 indexed launchId,
        bytes32 indexed approvalId,
        uint64 indexed revision,
        bytes32 previousPolicyHash,
        bytes32 newPolicyHash,
        bytes32 correctedRecordHash,
        uint256 boundAtBlock
    );

    event CustomLaunchExecutionPolicySupersededV2(
        bytes32 indexed launchId,
        bytes32 indexed previousPolicyHash,
        bytes32 indexed newPolicyHash,
        uint64 revision,
        bytes32 correctionReasonCode,
        bytes32 correctionEvidenceHash
    );

    event CustomLaunchExecutionPolicyCorrectedV2(
        bytes32 indexed launchId,
        bytes32 indexed newPolicyHash,
        bytes32 indexed correctedRecordHash,
        uint64 revision,
        bytes32 approvalId,
        bytes32 approvalEvidenceHash
    );

    event CustomLaunchRecordRevisionSupersededV2(
        bytes32 indexed launchId,
        bytes32 indexed previousRecordHash,
        bytes32 indexed correctedRecordHash,
        uint64 revision
    );

    event CustomLaunchExecutionPolicyRetainedV2(
        bytes32 indexed launchId,
        bytes32 indexed policyHash,
        bytes32 indexed correctedRecordHash,
        uint64 revision,
        bytes32 approvalId
    );

    function computeTradeCapabilityRevisionApprovalHashV1(TradeCapabilityRevisionApprovalV1 calldata approval)
        external
        pure
        returns (bytes32);
    function computeTradeCapabilityRevisionRecordHashV1(TradeCapabilityRevisionApprovalV1 calldata approval)
        external
        pure
        returns (bytes32);
    function authorizeTradeCapabilityRevisionV1(TradeCapabilityRevisionApprovalV1 calldata approval) external;
    function revokeTradeCapabilityRevisionApprovalV1(bytes32 approvalId, bytes32 reasonCode, bytes32 evidenceHash)
        external;
    function correctAndBindRevisionV1(
        IProgrammableCustomRegistryV1.RecordCorrectionV1 calldata correction,
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 calldata capability,
        bytes32 approvalId
    ) external;
    function tradeCapabilityHash(bytes32 launchId) external view returns (bytes32);
    function tradeCapabilityRevision(bytes32 launchId) external view returns (uint64);
    function tradeCapabilityHashAtRevision(bytes32 launchId, uint64 revision) external view returns (bytes32);
    function pendingTradeCapabilityRevisionApprovalId(bytes32 launchId) external view returns (bytes32);
    function tradeCapabilityRevisionApprovalState(bytes32 approvalId)
        external
        view
        returns (TradeCapabilityRevisionApprovalStateV1 memory);
}
