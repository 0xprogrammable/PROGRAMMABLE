// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IReturnOnlyEngineV1,
    OpaqueEngineRequestV1,
    OpaqueEngineResponseV1,
    ReturnOnlyEngineLimitsV1
} from "../interfaces/IReturnOnlyEngineV1.sol";

/// @notice Opaque fixture whose Engine-owned behavior folds ordered batches into state.
/// @dev It returns no protected proposal and has no Core settlement branch.
contract OpaqueBatchAccumulatorEngineFixture is IReturnOnlyEngineV1 {
    uint8 internal constant ENGINE_PHASE = 2;
    uint256 internal constant MAX_BATCH_ITEMS = 64;

    error ActionPayloadTooLarge(uint256 actualLength);
    error InvalidPhase(uint8 actualPhase);
    error SegmentOutOfRange(uint32 segmentIndex);
    error BatchTooLarge(uint256 actualItems);
    error ActionPayloadDigestMismatch();

    mapping(bytes32 executionTargetId => bytes32 accumulator) public accumulatorByTarget;
    mapping(bytes32 executionTargetId => uint256 batches) public batchesByTarget;

    function proposeOpaque(OpaqueEngineRequestV1 calldata request)
        external
        returns (OpaqueEngineResponseV1 memory response)
    {
        if (request.actionPayload.length > ReturnOnlyEngineLimitsV1.MAX_ACTION_PAYLOAD_BYTES) {
            revert ActionPayloadTooLarge(request.actionPayload.length);
        }
        if (request.phase != ENGINE_PHASE) revert InvalidPhase(request.phase);
        if (request.segmentIndex >= ReturnOnlyEngineLimitsV1.MAX_SEGMENTS) {
            revert SegmentOutOfRange(request.segmentIndex);
        }
        if (keccak256(request.actionPayload) != request.actionPayloadDigest) revert ActionPayloadDigestMismatch();

        bytes32[] memory orderedItems = abi.decode(request.actionPayload, (bytes32[]));
        if (orderedItems.length > MAX_BATCH_ITEMS) revert BatchTooLarge(orderedItems.length);

        bytes32 accumulator = accumulatorByTarget[request.executionTargetId];
        for (uint256 i = 0; i < orderedItems.length; ++i) {
            accumulator = keccak256(abi.encode(accumulator, i, orderedItems[i]));
        }
        uint256 batches = batchesByTarget[request.executionTargetId] + 1;
        accumulatorByTarget[request.executionTargetId] = accumulator;
        batchesByTarget[request.executionTargetId] = batches;

        response =
            _emptyProtectedResponse(request, keccak256(""), abi.encode(accumulator, batches, orderedItems.length));
    }

    function _emptyProtectedResponse(
        OpaqueEngineRequestV1 calldata request,
        bytes32 proposalCommitment,
        bytes memory opaqueData
    ) private pure returns (OpaqueEngineResponseV1 memory response) {
        response = OpaqueEngineResponseV1({
            coreDeploymentId: request.coreDeploymentId,
            engineRevisionId: request.engineRevisionId,
            marketId: request.marketId,
            authorizationScopeId: request.authorizationScopeId,
            sessionDigest: request.sessionDigest,
            executionTargetId: request.executionTargetId,
            proposalCommitment: proposalCommitment,
            segmentIndex: request.segmentIndex,
            phase: request.phase,
            proposal: bytes(""),
            opaqueData: opaqueData
        });
    }
}
