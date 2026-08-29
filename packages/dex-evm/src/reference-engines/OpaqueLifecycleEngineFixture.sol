// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IReturnOnlyEngineV1,
    OpaqueEngineRequestV1,
    OpaqueEngineResponseV1,
    ReturnOnlyEngineLimitsV1
} from "../interfaces/IReturnOnlyEngineV1.sol";

/// @notice Opaque fixture whose Engine-owned behavior advances independent object lifecycles.
/// @dev It returns no protected proposal and has no Core settlement branch.
contract OpaqueLifecycleEngineFixture is IReturnOnlyEngineV1 {
    uint8 internal constant ENGINE_PHASE = 2;
    uint256 internal constant EXACT_ACTION_BYTES = 96;

    struct LifecycleState {
        uint64 revision;
        bytes32 stateCommitment;
    }

    error InvalidActionLength(uint256 actualLength);
    error InvalidPhase(uint8 actualPhase);
    error SegmentOutOfRange(uint32 segmentIndex);
    error ActionPayloadDigestMismatch();
    error LifecycleRevisionMismatch(bytes32 objectId, uint64 expectedRevision, uint64 actualRevision);
    error LifecycleRevisionExhausted(bytes32 objectId);

    mapping(bytes32 objectId => LifecycleState state) public lifecycle;

    function proposeOpaque(OpaqueEngineRequestV1 calldata request)
        external
        returns (OpaqueEngineResponseV1 memory response)
    {
        if (request.actionPayload.length != EXACT_ACTION_BYTES) {
            revert InvalidActionLength(request.actionPayload.length);
        }
        if (request.phase != ENGINE_PHASE) revert InvalidPhase(request.phase);
        if (request.segmentIndex >= ReturnOnlyEngineLimitsV1.MAX_SEGMENTS) {
            revert SegmentOutOfRange(request.segmentIndex);
        }
        if (keccak256(request.actionPayload) != request.actionPayloadDigest) revert ActionPayloadDigestMismatch();

        (bytes32 objectId, uint64 expectedRevision, bytes32 nextStateCommitment) =
            abi.decode(request.actionPayload, (bytes32, uint64, bytes32));
        LifecycleState storage current = lifecycle[objectId];
        if (current.revision != expectedRevision) {
            revert LifecycleRevisionMismatch(objectId, expectedRevision, current.revision);
        }
        if (expectedRevision == type(uint64).max) revert LifecycleRevisionExhausted(objectId);

        uint64 nextRevision = expectedRevision + 1;
        current.revision = nextRevision;
        current.stateCommitment = nextStateCommitment;

        response = OpaqueEngineResponseV1({
            coreDeploymentId: request.coreDeploymentId,
            engineRevisionId: request.engineRevisionId,
            marketId: request.marketId,
            authorizationScopeId: request.authorizationScopeId,
            sessionDigest: request.sessionDigest,
            executionTargetId: request.executionTargetId,
            proposalCommitment: keccak256(""),
            segmentIndex: request.segmentIndex,
            phase: request.phase,
            proposal: bytes(""),
            opaqueData: abi.encode(objectId, nextRevision, nextStateCommitment)
        });
    }
}
