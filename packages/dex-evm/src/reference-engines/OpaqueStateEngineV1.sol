// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IReturnOnlyEngineV1,
    OpaqueEngineRequestV1,
    OpaqueEngineResponseV1,
    ReturnOnlyEngineLimitsV1
} from "../interfaces/IReturnOnlyEngineV1.sol";

/// @notice Generality fixture with arbitrary Engine-owned state and no protected-settlement branch.
contract OpaqueStateEngineV1 is IReturnOnlyEngineV1 {
    uint8 internal constant ENGINE_PHASE = 2;

    error ActionPayloadTooLarge(uint256 actualLength, uint256 maximumLength);
    error SegmentOutOfRange(uint32 segmentIndex, uint32 maximumSegments);
    error InvalidEnginePhase(uint8 actualPhase);
    error ActionPayloadDigestMismatch(bytes32 expected, bytes32 actual);

    mapping(bytes32 executionTargetId => bytes32 stateCommitment) public stateByTarget;
    uint256 public proposalCount;

    function proposeOpaque(OpaqueEngineRequestV1 calldata request)
        external
        returns (OpaqueEngineResponseV1 memory response)
    {
        if (request.actionPayload.length > ReturnOnlyEngineLimitsV1.MAX_ACTION_PAYLOAD_BYTES) {
            revert ActionPayloadTooLarge(
                request.actionPayload.length, ReturnOnlyEngineLimitsV1.MAX_ACTION_PAYLOAD_BYTES
            );
        }
        if (request.segmentIndex >= ReturnOnlyEngineLimitsV1.MAX_SEGMENTS) {
            revert SegmentOutOfRange(request.segmentIndex, ReturnOnlyEngineLimitsV1.MAX_SEGMENTS);
        }
        if (request.phase != ENGINE_PHASE) revert InvalidEnginePhase(request.phase);

        bytes32 actualActionDigest = keccak256(request.actionPayload);
        if (actualActionDigest != request.actionPayloadDigest) {
            revert ActionPayloadDigestMismatch(request.actionPayloadDigest, actualActionDigest);
        }

        uint256 nextCount = proposalCount + 1;
        proposalCount = nextCount;
        bytes32 nextState = keccak256(
            abi.encode(
                stateByTarget[request.executionTargetId],
                request.sessionDigest,
                request.segmentIndex,
                actualActionDigest,
                nextCount
            )
        );
        stateByTarget[request.executionTargetId] = nextState;

        bytes memory opaqueData = abi.encode(nextState, nextCount);
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
            opaqueData: opaqueData
        });
    }
}
