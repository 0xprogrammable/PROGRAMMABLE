// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { LiquidityGrowthFullRangeAutomationV1 } from "./LiquidityGrowthFullRangeAutomationV1.sol";

/// @title DeepKeeperExecutorV1
/// @notice Immutable, permissionless relay that binds sponsored Deep keeper work to a fresh onchain assessment.
/// @dev The relay never holds funds and exposes no administrative controls. Every accepted candidate produces one
///      result event. Calls into the immutable automation contract use action-specific gas stipends so one failed
///      vault cannot consume the gas reserved for later candidates.
contract DeepKeeperExecutorV1 is ReentrancyGuardTransient {
    uint256 public constant MAX_BATCH_SIZE = 8;
    uint256 public constant ASSESSMENT_GAS_STIPEND = 150_000;
    uint256 public constant PROCESS_FEES_GAS_STIPEND = 700_000;
    uint256 public constant COMPOUND_PENDING_GAS_STIPEND = 220_000;
    uint256 public constant GROW_ORACLE_GAS_STIPEND = 450_000;
    uint256 public constant RESULT_GAS_RESERVE = 25_000;
    uint256 public constant FINAL_GAS_RESERVE = 25_000;

    enum Outcome {
        SkippedNone,
        SkippedActionDrift,
        AssessmentFailed,
        ExecutionFailed,
        Succeeded
    }

    struct Candidate {
        address vault;
        LiquidityGrowthFullRangeAutomationV1.Action expectedAction;
    }

    LiquidityGrowthFullRangeAutomationV1 public immutable automation;

    error BatchTooLarge(uint256 supplied, uint256 maximum);
    error DuplicateVault(address vault, uint256 firstIndex, uint256 duplicateIndex);
    error EmptyBatch();
    error ExecutionActionDrift(
        LiquidityGrowthFullRangeAutomationV1.Action assessedAction,
        LiquidityGrowthFullRangeAutomationV1.Action performedAction
    );
    error ExecutionReportedFailure();
    error InsufficientBatchGas(uint256 available, uint256 required);
    error InvalidAutomation(address automation);
    error InvalidExpectedAction(uint256 index);
    error MalformedAssessmentResult();
    error MalformedExecutionResult();
    error ZeroVault(uint256 index);

    event CandidateResult(
        bytes32 indexed batchHash,
        uint256 indexed candidateIndex,
        address indexed vault,
        address executor,
        LiquidityGrowthFullRangeAutomationV1.Action expectedAction,
        LiquidityGrowthFullRangeAutomationV1.Action actualAction,
        Outcome outcome,
        bytes4 errorSelector,
        uint256 gasUsed
    );

    constructor(LiquidityGrowthFullRangeAutomationV1 automation_) {
        if (address(automation_) == address(0) || address(automation_).code.length == 0) {
            revert InvalidAutomation(address(automation_));
        }
        automation = automation_;
    }

    /// @notice Reassesses and conditionally executes one bounded batch against the immutable automation contract.
    /// @dev A candidate is skipped when its expected action no longer matches the fresh assessment. Invalid input
    ///      reverts before execution; accepted input emits exactly one `CandidateResult` per candidate.
    function execute(Candidate[] calldata candidates)
        external
        nonReentrant
        returns (bytes32 batchHash, uint256 attempted, uint256 succeeded)
    {
        uint256 length = candidates.length;
        _validateCandidates(candidates);

        uint256 requiredGas = FINAL_GAS_RESERVE;
        for (uint256 index; index < length; index++) {
            requiredGas += _eip150Envelope(ASSESSMENT_GAS_STIPEND);
            requiredGas += _eip150Envelope(_executionGasStipend(candidates[index].expectedAction));
            requiredGas += RESULT_GAS_RESERVE;
        }
        uint256 availableGas = gasleft();
        if (availableGas < requiredGas) revert InsufficientBatchGas(availableGas, requiredGas);

        batchHash = keccak256(abi.encode(block.chainid, address(this), msg.sender, candidates));
        for (uint256 index; index < length; index++) {
            (bool wasAttempted, bool executionSucceeded) = _executeCandidate(batchHash, index, candidates[index]);
            if (wasAttempted) attempted++;
            if (executionSucceeded) succeeded++;
        }
    }

    function _executeCandidate(bytes32 batchHash, uint256 index, Candidate calldata candidate)
        private
        returns (bool attempted, bool succeeded)
    {
        uint256 gasBefore = gasleft();
        (bool assessmentSucceeded, LiquidityGrowthFullRangeAutomationV1.Action actualAction, bytes4 errorSelector) =
            _assess(candidate.vault);
        if (!assessmentSucceeded) {
            _emitResult(
                batchHash,
                index,
                candidate,
                actualAction,
                Outcome.AssessmentFailed,
                errorSelector,
                gasBefore - gasleft()
            );
            return (false, false);
        }
        if (actualAction == LiquidityGrowthFullRangeAutomationV1.Action.None) {
            _emitResult(
                batchHash, index, candidate, actualAction, Outcome.SkippedNone, bytes4(0), gasBefore - gasleft()
            );
            return (false, false);
        }
        if (actualAction != candidate.expectedAction) {
            _emitResult(
                batchHash, index, candidate, actualAction, Outcome.SkippedActionDrift, bytes4(0), gasBefore - gasleft()
            );
            return (false, false);
        }

        (succeeded, actualAction, errorSelector) = _perform(candidate.vault, actualAction);
        _emitResult(
            batchHash,
            index,
            candidate,
            actualAction,
            succeeded ? Outcome.Succeeded : Outcome.ExecutionFailed,
            errorSelector,
            gasBefore - gasleft()
        );
        return (true, succeeded);
    }

    function _emitResult(
        bytes32 batchHash,
        uint256 index,
        Candidate calldata candidate,
        LiquidityGrowthFullRangeAutomationV1.Action actualAction,
        Outcome outcome,
        bytes4 errorSelector,
        uint256 gasUsed
    ) private {
        emit CandidateResult(
            batchHash,
            index,
            candidate.vault,
            msg.sender,
            candidate.expectedAction,
            actualAction,
            outcome,
            errorSelector,
            gasUsed
        );
    }

    function _assess(address vault)
        private
        view
        returns (bool succeeded, LiquidityGrowthFullRangeAutomationV1.Action action, bytes4 errorSelector)
    {
        bytes memory payload = abi.encodeCall(LiquidityGrowthFullRangeAutomationV1.assessVault, (vault));
        bytes memory returnData;
        (succeeded, returnData) = address(automation).staticcall{ gas: ASSESSMENT_GAS_STIPEND }(payload);
        if (!succeeded) return (false, LiquidityGrowthFullRangeAutomationV1.Action.None, _errorSelector(returnData));
        if (returnData.length != 32) {
            return (
                false,
                LiquidityGrowthFullRangeAutomationV1.Action.None,
                DeepKeeperExecutorV1.MalformedAssessmentResult.selector
            );
        }

        uint256 rawAction;
        assembly ("memory-safe") {
            rawAction := mload(add(returnData, 0x20))
        }
        if (rawAction > uint256(LiquidityGrowthFullRangeAutomationV1.Action.GrowOracle)) {
            return (
                false,
                LiquidityGrowthFullRangeAutomationV1.Action.None,
                DeepKeeperExecutorV1.MalformedAssessmentResult.selector
            );
        }
        action = LiquidityGrowthFullRangeAutomationV1.Action(rawAction);
        return (true, action, bytes4(0));
    }

    function _perform(address vault, LiquidityGrowthFullRangeAutomationV1.Action assessedAction)
        private
        returns (bool succeeded, LiquidityGrowthFullRangeAutomationV1.Action performedAction, bytes4 errorSelector)
    {
        bytes memory payload = abi.encodeCall(LiquidityGrowthFullRangeAutomationV1.performVault, (vault));
        (bool callSucceeded, bytes memory returnData) =
            address(automation).call{ gas: _executionGasStipend(assessedAction) }(payload);
        if (!callSucceeded) return (false, assessedAction, _errorSelector(returnData));
        if (returnData.length != 64) {
            return (false, assessedAction, DeepKeeperExecutorV1.MalformedExecutionResult.selector);
        }

        uint256 rawSucceeded;
        uint256 rawAction;
        assembly ("memory-safe") {
            rawSucceeded := mload(add(returnData, 0x20))
            rawAction := mload(add(returnData, 0x40))
        }
        if (rawSucceeded > 1 || rawAction > uint256(LiquidityGrowthFullRangeAutomationV1.Action.GrowOracle)) {
            return (false, assessedAction, DeepKeeperExecutorV1.MalformedExecutionResult.selector);
        }

        performedAction = LiquidityGrowthFullRangeAutomationV1.Action(rawAction);
        if (performedAction != assessedAction) {
            return (false, performedAction, DeepKeeperExecutorV1.ExecutionActionDrift.selector);
        }
        if (rawSucceeded == 0) {
            return (false, performedAction, DeepKeeperExecutorV1.ExecutionReportedFailure.selector);
        }
        return (true, performedAction, bytes4(0));
    }

    function _validateCandidates(Candidate[] calldata candidates) private pure {
        uint256 length = candidates.length;
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge(length, MAX_BATCH_SIZE);

        for (uint256 index; index < length; index++) {
            address vault = candidates[index].vault;
            if (vault == address(0)) revert ZeroVault(index);
            if (candidates[index].expectedAction == LiquidityGrowthFullRangeAutomationV1.Action.None) {
                revert InvalidExpectedAction(index);
            }
            for (uint256 previous; previous < index; previous++) {
                if (candidates[previous].vault == vault) revert DuplicateVault(vault, previous, index);
            }
        }
    }

    function _executionGasStipend(LiquidityGrowthFullRangeAutomationV1.Action action) private pure returns (uint256) {
        if (action == LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees) {
            return PROCESS_FEES_GAS_STIPEND;
        }
        if (action == LiquidityGrowthFullRangeAutomationV1.Action.CompoundPending) {
            return COMPOUND_PENDING_GAS_STIPEND;
        }
        if (action == LiquidityGrowthFullRangeAutomationV1.Action.GrowOracle) {
            return GROW_ORACLE_GAS_STIPEND;
        }
        revert InvalidExpectedAction(type(uint256).max);
    }

    function _eip150Envelope(uint256 stipend) private pure returns (uint256) {
        return stipend + (stipend + 62) / 63;
    }

    function _errorSelector(bytes memory revertData) private pure returns (bytes4 selector) {
        if (revertData.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(revertData, 0x20))
        }
    }
}
