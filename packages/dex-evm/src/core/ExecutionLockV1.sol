// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Phase-specific mutation lock shared by the immutable Core foundation.
abstract contract ExecutionLockV1 {
    enum Phase {
        IDLE,
        AUTHENTICATE,
        ENGINE,
        VALIDATE,
        SETTLE,
        POSTCHECK,
        COMMIT
    }

    error NestedMutatingEntry(Phase activePhase);
    error InvalidPhaseTransition(Phase currentPhase, Phase expectedPhase, Phase requestedPhase);
    error EvidenceReadDuringExecution(Phase activePhase);

    Phase private _activePhase;

    modifier mutationEntry() {
        _enterMutation();
        _;
        _leaveMutation();
    }

    modifier committedEvidenceRead() {
        _requireCommittedEvidence();
        _;
    }

    function executionPhase() external view committedEvidenceRead returns (Phase) {
        return _activePhase;
    }

    function _enterMutation() internal {
        Phase active = _activePhase;
        if (active != Phase.IDLE) revert NestedMutatingEntry(active);
        _activePhase = Phase.AUTHENTICATE;
    }

    function _transitionPhase(Phase expected, Phase requested) internal {
        Phase active = _activePhase;
        if (active != expected) revert InvalidPhaseTransition(active, expected, requested);
        if (requested == Phase.IDLE) revert InvalidPhaseTransition(active, expected, requested);
        _activePhase = requested;
    }

    function _leaveMutation() internal {
        _activePhase = Phase.IDLE;
    }

    function _requireCommittedEvidence() internal view {
        Phase active = _activePhase;
        if (active != Phase.IDLE) revert EvidenceReadDuringExecution(active);
    }

    function _phaseForInternalUse() internal view returns (Phase) {
        return _activePhase;
    }
}
