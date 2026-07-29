// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { LiquidityGrowthFullRangeAutomationV3 } from "./LiquidityGrowthFullRangeAutomationV3.sol";
import { LiquidityGrowthFullRangeVaultFactoryV3 } from "./LiquidityGrowthFullRangeVaultFactoryV3.sol";

interface IDeepV3LauncherBinding {
    function automation() external view returns (LiquidityGrowthFullRangeAutomationV3);
    function growthVaultFactory() external view returns (address);
}

/// @title DeepKeeperExecutorV2
/// @notice Immutable permissionless relay for bounded Deep work after a fresh onchain assessment.
contract DeepKeeperExecutorV2 is ReentrancyGuardTransient {
    uint256 public constant MAX_BATCH_SIZE = 4;
    uint256 public constant ASSESSMENT_GAS_STIPEND = 1_300_000;
    uint256 public constant COMPOUND_GAS_STIPEND = 3_000_000;
    uint256 public constant GROW_ORACLE_GAS_STIPEND = 600_000;
    uint256 public constant RESULT_GAS_RESERVE = 30_000;
    uint256 public constant FINAL_GAS_RESERVE = 30_000;

    enum Outcome {
        SkippedNone,
        SkippedActionDrift,
        AssessmentFailed,
        ExecutionFailed,
        Succeeded
    }

    struct Candidate {
        address vault;
        LiquidityGrowthFullRangeAutomationV3.Action expectedAction;
    }

    struct BoundedReturn {
        bool succeeded;
        uint256 size;
        uint256 word0;
        uint256 word1;
        bytes4 errorSelector;
    }

    LiquidityGrowthFullRangeAutomationV3 public immutable automation;

    error BatchTooLarge(uint256 supplied, uint256 maximum);
    error DuplicateVault(address vault, uint256 firstIndex, uint256 duplicateIndex);
    error EmptyBatch();
    error ExecutionActionDrift(
        LiquidityGrowthFullRangeAutomationV3.Action assessedAction,
        LiquidityGrowthFullRangeAutomationV3.Action performedAction
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
        LiquidityGrowthFullRangeAutomationV3.Action expectedAction,
        LiquidityGrowthFullRangeAutomationV3.Action actualAction,
        Outcome outcome,
        bytes4 errorSelector,
        uint256 gasUsed
    );

    constructor(LiquidityGrowthFullRangeAutomationV3 automation_) {
        address automationAddress = address(automation_);
        if (automationAddress == address(0) || automationAddress.code.length == 0) {
            revert InvalidAutomation(automationAddress);
        }
        address launcherAddress;
        address factoryAddress;
        try automation_.launcher() returns (address recordedLauncher) {
            launcherAddress = recordedLauncher;
        } catch {
            revert InvalidAutomation(automationAddress);
        }
        try automation_.vaultFactory() returns (LiquidityGrowthFullRangeVaultFactoryV3 recordedFactory) {
            factoryAddress = address(recordedFactory);
        } catch {
            revert InvalidAutomation(automationAddress);
        }
        if (launcherAddress.code.length == 0 || factoryAddress.code.length == 0) {
            revert InvalidAutomation(automationAddress);
        }
        try IDeepV3LauncherBinding(launcherAddress).automation() returns (
            LiquidityGrowthFullRangeAutomationV3 recordedAutomation
        ) {
            if (address(recordedAutomation) != automationAddress) revert InvalidAutomation(automationAddress);
        } catch {
            revert InvalidAutomation(automationAddress);
        }
        try IDeepV3LauncherBinding(launcherAddress).growthVaultFactory() returns (address recordedFactory) {
            if (recordedFactory != factoryAddress) revert InvalidAutomation(automationAddress);
        } catch {
            revert InvalidAutomation(automationAddress);
        }
        automation = automation_;
    }

    function execute(Candidate[] calldata candidates)
        external
        nonReentrant
        returns (bytes32 batchHash, uint256 attempted, uint256 succeeded)
    {
        uint256 length = candidates.length;
        _validateCandidates(candidates);

        uint256 requiredGas = FINAL_GAS_RESERVE;
        for (uint256 index; index < length; ++index) {
            requiredGas += _eip150Envelope(ASSESSMENT_GAS_STIPEND);
            requiredGas += _eip150Envelope(_executionGasStipend(candidates[index].expectedAction));
            requiredGas += RESULT_GAS_RESERVE;
        }
        uint256 availableGas = gasleft();
        if (availableGas < requiredGas) revert InsufficientBatchGas(availableGas, requiredGas);

        batchHash = keccak256(abi.encode(block.chainid, address(this), msg.sender, candidates));
        for (uint256 index; index < length; ++index) {
            (bool wasAttempted, bool executionSucceeded) = _executeCandidate(batchHash, index, candidates[index]);
            if (wasAttempted) ++attempted;
            if (executionSucceeded) ++succeeded;
        }
    }

    function _executeCandidate(bytes32 batchHash, uint256 index, Candidate calldata candidate)
        private
        returns (bool attempted, bool succeeded)
    {
        uint256 gasBefore = gasleft();
        (bool assessmentSucceeded, LiquidityGrowthFullRangeAutomationV3.Action actualAction, bytes4 errorSelector) =
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
        if (actualAction == LiquidityGrowthFullRangeAutomationV3.Action.None) {
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
        LiquidityGrowthFullRangeAutomationV3.Action actualAction,
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
        returns (bool succeeded, LiquidityGrowthFullRangeAutomationV3.Action action, bytes4 errorSelector)
    {
        bytes memory payload = abi.encodeCall(LiquidityGrowthFullRangeAutomationV3.assessVault, (vault));
        BoundedReturn memory returned = _boundedStaticCall(address(automation), payload, ASSESSMENT_GAS_STIPEND);
        if (!returned.succeeded) {
            return (false, LiquidityGrowthFullRangeAutomationV3.Action.None, returned.errorSelector);
        }
        if (returned.size != 32 || returned.word0 > uint256(LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle)) {
            return (
                false,
                LiquidityGrowthFullRangeAutomationV3.Action.None,
                DeepKeeperExecutorV2.MalformedAssessmentResult.selector
            );
        }
        return (true, LiquidityGrowthFullRangeAutomationV3.Action(returned.word0), bytes4(0));
    }

    function _perform(address vault, LiquidityGrowthFullRangeAutomationV3.Action assessedAction)
        private
        returns (bool succeeded, LiquidityGrowthFullRangeAutomationV3.Action performedAction, bytes4 errorSelector)
    {
        bytes memory payload = abi.encodeCall(LiquidityGrowthFullRangeAutomationV3.performVault, (vault));
        BoundedReturn memory returned = _boundedCall(address(automation), payload, _executionGasStipend(assessedAction));
        if (!returned.succeeded) return (false, assessedAction, returned.errorSelector);
        if (
            returned.size != 64 || returned.word0 > 1
                || returned.word1 > uint256(LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle)
        ) {
            return (false, assessedAction, DeepKeeperExecutorV2.MalformedExecutionResult.selector);
        }
        performedAction = LiquidityGrowthFullRangeAutomationV3.Action(returned.word1);
        if (performedAction != assessedAction) {
            return (false, performedAction, DeepKeeperExecutorV2.ExecutionActionDrift.selector);
        }
        if (returned.word0 == 0) {
            return (false, performedAction, DeepKeeperExecutorV2.ExecutionReportedFailure.selector);
        }
        return (true, performedAction, bytes4(0));
    }

    function _boundedStaticCall(address target, bytes memory payload, uint256 stipend)
        private
        view
        returns (BoundedReturn memory returned)
    {
        assembly ("memory-safe") {
            let output := mload(0x40)
            mstore(output, 0)
            mstore(add(output, 0x20), 0)
            let success := staticcall(stipend, target, add(payload, 0x20), mload(payload), output, 0x40)
            let size := returndatasize()
            mstore(returned, success)
            mstore(add(returned, 0x20), size)
            if success {
                let copySize := size
                if gt(copySize, 0x40) { copySize := 0x40 }
                returndatacopy(output, 0, copySize)
                mstore(add(returned, 0x40), mload(output))
                mstore(add(returned, 0x60), mload(add(output, 0x20)))
            }
            if iszero(success) {
                if iszero(lt(size, 4)) {
                    returndatacopy(output, 0, 4)
                    mstore(add(returned, 0x80), mload(output))
                }
            }
        }
    }

    function _boundedCall(address target, bytes memory payload, uint256 stipend)
        private
        returns (BoundedReturn memory returned)
    {
        assembly ("memory-safe") {
            let output := mload(0x40)
            mstore(output, 0)
            mstore(add(output, 0x20), 0)
            let success := call(stipend, target, 0, add(payload, 0x20), mload(payload), output, 0x40)
            let size := returndatasize()
            mstore(returned, success)
            mstore(add(returned, 0x20), size)
            if success {
                let copySize := size
                if gt(copySize, 0x40) { copySize := 0x40 }
                returndatacopy(output, 0, copySize)
                mstore(add(returned, 0x40), mload(output))
                mstore(add(returned, 0x60), mload(add(output, 0x20)))
            }
            if iszero(success) {
                if iszero(lt(size, 4)) {
                    returndatacopy(output, 0, 4)
                    mstore(add(returned, 0x80), mload(output))
                }
            }
        }
    }

    function _validateCandidates(Candidate[] calldata candidates) private pure {
        uint256 length = candidates.length;
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge(length, MAX_BATCH_SIZE);
        for (uint256 index; index < length; ++index) {
            address vault = candidates[index].vault;
            if (vault == address(0)) revert ZeroVault(index);
            if (candidates[index].expectedAction == LiquidityGrowthFullRangeAutomationV3.Action.None) {
                revert InvalidExpectedAction(index);
            }
            for (uint256 previous; previous < index; ++previous) {
                if (candidates[previous].vault == vault) revert DuplicateVault(vault, previous, index);
            }
        }
    }

    function _executionGasStipend(LiquidityGrowthFullRangeAutomationV3.Action action) private pure returns (uint256) {
        if (action == LiquidityGrowthFullRangeAutomationV3.Action.Compound) return COMPOUND_GAS_STIPEND;
        if (action == LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle) return GROW_ORACLE_GAS_STIPEND;
        revert InvalidExpectedAction(type(uint256).max);
    }

    function _eip150Envelope(uint256 stipend) private pure returns (uint256) {
        return stipend + (stipend + 62) / 63;
    }
}
