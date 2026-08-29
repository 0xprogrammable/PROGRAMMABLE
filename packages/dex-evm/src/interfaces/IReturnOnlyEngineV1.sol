// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Product-neutral request binding for the opaque, return-only Engine surface.
/// @dev CoreV1 does not invoke this interface while protected execution is BLOCKED_BY_SPEC.
///      The byte arrays deliberately have no protected-effect grammar in this release.
struct OpaqueEngineRequestV1 {
    bytes32 coreDeploymentId;
    bytes32 engineRevisionId;
    bytes32 marketId;
    bytes32 authorizationScopeId;
    bytes32 sessionDigest;
    bytes32 executionTargetId;
    bytes32 actionPayloadDigest;
    uint32 segmentIndex;
    uint8 phase;
    bytes actionPayload;
}

/// @notice A bounded opaque response. Proposal bytes confer no Core authority by themselves.
struct OpaqueEngineResponseV1 {
    bytes32 coreDeploymentId;
    bytes32 engineRevisionId;
    bytes32 marketId;
    bytes32 authorizationScopeId;
    bytes32 sessionDigest;
    bytes32 executionTargetId;
    bytes32 proposalCommitment;
    uint32 segmentIndex;
    uint8 phase;
    bytes proposal;
    bytes opaqueData;
}

interface IReturnOnlyEngineV1 {
    function proposeOpaque(OpaqueEngineRequestV1 calldata request)
        external
        returns (OpaqueEngineResponseV1 memory response);
}

/// @notice Binding-local resource limits for the opaque Engine interface.
library ReturnOnlyEngineLimitsV1 {
    uint256 internal constant MAX_ACTION_PAYLOAD_BYTES = 16_384;
    uint256 internal constant MAX_PROPOSAL_BYTES = 16_384;
    uint256 internal constant MAX_OPAQUE_DATA_BYTES = 8192;
    uint32 internal constant MAX_SEGMENTS = 16;
    uint256 internal constant ENGINE_CALL_GAS_LIMIT = 1_000_000;
    uint256 internal constant POST_ENGINE_GAS_RESERVE = 250_000;
    uint256 internal constant MAX_ENGINE_RETURNDATA_BYTES = 25_600;
}
