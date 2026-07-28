// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { Test, Vm } from "forge-std/Test.sol";

import { DeepKeeperExecutorV1 } from "../src/DeepKeeperExecutorV1.sol";
import { LiquidityGrowthFullRangeAutomationV1 } from "../src/LiquidityGrowthFullRangeAutomationV1.sol";

contract MockDeepAutomationV1 {
    enum Behavior {
        Succeed,
        ReportFailure,
        RevertCall,
        ConsumeStipend,
        ReturnDifferentAction,
        Reenter
    }

    error ForcedAssessmentFailure(address vault);
    error ForcedExecutionFailure(address vault);

    mapping(address vault => LiquidityGrowthFullRangeAutomationV1.Action action) public actionOf;
    mapping(address vault => Behavior behavior) public behaviorOf;
    mapping(address vault => bool shouldRevert) public assessmentReverts;
    mapping(address vault => uint256 calls) public performCalls;
    mapping(address vault => uint256 gasAtEntry) public performGasAtEntry;
    DeepKeeperExecutorV1 public reentryTarget;

    function setAction(address vault, LiquidityGrowthFullRangeAutomationV1.Action action) external {
        actionOf[vault] = action;
    }

    function setBehavior(address vault, Behavior behavior) external {
        behaviorOf[vault] = behavior;
    }

    function setAssessmentRevert(address vault, bool shouldRevert) external {
        assessmentReverts[vault] = shouldRevert;
    }

    function setReentryTarget(DeepKeeperExecutorV1 target) external {
        reentryTarget = target;
    }

    function assessVault(address vault) external view returns (LiquidityGrowthFullRangeAutomationV1.Action action) {
        if (assessmentReverts[vault]) revert ForcedAssessmentFailure(vault);
        return actionOf[vault];
    }

    function performVault(address vault)
        external
        returns (bool succeeded, LiquidityGrowthFullRangeAutomationV1.Action action)
    {
        uint256 entryGas = gasleft();
        performCalls[vault]++;
        performGasAtEntry[vault] = entryGas;
        Behavior behavior = behaviorOf[vault];
        if (behavior == Behavior.RevertCall) revert ForcedExecutionFailure(vault);
        if (behavior == Behavior.ConsumeStipend) {
            assembly ("memory-safe") {
                invalid()
            }
        }

        action = actionOf[vault];
        if (behavior == Behavior.ReportFailure) return (false, action);
        if (behavior == Behavior.ReturnDifferentAction) {
            return (true, LiquidityGrowthFullRangeAutomationV1.Action.GrowOracle);
        }
        if (behavior == Behavior.Reenter) {
            DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](1);
            candidates[0] = DeepKeeperExecutorV1.Candidate({ vault: vault, expectedAction: action });
            reentryTarget.execute(candidates);
        }
        return (true, action);
    }
}

contract DeepKeeperExecutorV1Test is Test {
    bytes32 private constant CANDIDATE_RESULT_EVENT =
        keccak256("CandidateResult(bytes32,uint256,address,address,uint8,uint8,uint8,bytes4,uint256)");

    MockDeepAutomationV1 private automation;
    DeepKeeperExecutorV1 private executor;

    function setUp() public {
        automation = new MockDeepAutomationV1();
        executor = new DeepKeeperExecutorV1(LiquidityGrowthFullRangeAutomationV1(payable(address(automation))));
    }

    function test_constructorRejectsZeroAndCodeLessAutomation() public {
        vm.expectRevert(abi.encodeWithSelector(DeepKeeperExecutorV1.InvalidAutomation.selector, address(0)));
        new DeepKeeperExecutorV1(LiquidityGrowthFullRangeAutomationV1(payable(address(0))));

        address codeLess = makeAddr("codeLessAutomation");
        vm.expectRevert(abi.encodeWithSelector(DeepKeeperExecutorV1.InvalidAutomation.selector, codeLess));
        new DeepKeeperExecutorV1(LiquidityGrowthFullRangeAutomationV1(payable(codeLess)));
    }

    function test_rejectsEmptyZeroDuplicateAndNoneCandidates() public {
        DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](0);
        vm.expectRevert(DeepKeeperExecutorV1.EmptyBatch.selector);
        executor.execute(candidates);

        candidates = new DeepKeeperExecutorV1.Candidate[](1);
        candidates[0] = _candidate(address(0), LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        vm.expectRevert(abi.encodeWithSelector(DeepKeeperExecutorV1.ZeroVault.selector, 0));
        executor.execute(candidates);

        address vault = makeAddr("duplicateVault");
        candidates = new DeepKeeperExecutorV1.Candidate[](2);
        candidates[0] = _candidate(vault, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        candidates[1] = _candidate(vault, LiquidityGrowthFullRangeAutomationV1.Action.CompoundPending);
        vm.expectRevert(abi.encodeWithSelector(DeepKeeperExecutorV1.DuplicateVault.selector, vault, 0, 1));
        executor.execute(candidates);

        candidates = new DeepKeeperExecutorV1.Candidate[](1);
        candidates[0] = _candidate(vault, LiquidityGrowthFullRangeAutomationV1.Action.None);
        vm.expectRevert(abi.encodeWithSelector(DeepKeeperExecutorV1.InvalidExpectedAction.selector, 0));
        executor.execute(candidates);
    }

    function test_rejectsBatchAboveEight() public {
        uint256 maximum = executor.MAX_BATCH_SIZE();
        DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](maximum + 1);
        for (uint256 index; index < candidates.length; index++) {
            // The loop is bounded to nine, so this narrowing conversion cannot truncate.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint160 boundedAddress = uint160(index + 1);
            candidates[index] =
                _candidate(address(boundedAddress), LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        }

        vm.expectRevert(abi.encodeWithSelector(DeepKeeperExecutorV1.BatchTooLarge.selector, maximum + 1, maximum));
        executor.execute(candidates);
    }

    function test_skipsFreshNoneAndActionDriftWithoutCallingPerform() public {
        address noneVault = makeAddr("noneVault");
        address driftVault = makeAddr("driftVault");
        automation.setAction(noneVault, LiquidityGrowthFullRangeAutomationV1.Action.None);
        automation.setAction(driftVault, LiquidityGrowthFullRangeAutomationV1.Action.GrowOracle);

        DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](2);
        candidates[0] = _candidate(noneVault, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        candidates[1] = _candidate(driftVault, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);

        vm.recordLogs();
        (bytes32 batchHash, uint256 attempted, uint256 succeeded) = executor.execute(candidates);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(attempted, 0);
        assertEq(succeeded, 0);
        assertEq(automation.performCalls(noneVault), 0);
        assertEq(automation.performCalls(driftVault), 0);
        assertEq(logs.length, 2);
        _assertResult(
            logs[0],
            batchHash,
            0,
            noneVault,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            LiquidityGrowthFullRangeAutomationV1.Action.None,
            DeepKeeperExecutorV1.Outcome.SkippedNone,
            bytes4(0)
        );
        _assertResult(
            logs[1],
            batchHash,
            1,
            driftVault,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            LiquidityGrowthFullRangeAutomationV1.Action.GrowOracle,
            DeepKeeperExecutorV1.Outcome.SkippedActionDrift,
            bytes4(0)
        );
    }

    function test_unregisteredAssessmentFailureIsIsolatedAndExactlyReported() public {
        address unregistered = makeAddr("unregisteredVault");
        automation.setAssessmentRevert(unregistered, true);
        DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](1);
        candidates[0] = _candidate(unregistered, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);

        vm.recordLogs();
        (bytes32 batchHash, uint256 attempted, uint256 succeeded) = executor.execute(candidates);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(attempted, 0);
        assertEq(succeeded, 0);
        assertEq(logs.length, 1);
        _assertResult(
            logs[0],
            batchHash,
            0,
            unregistered,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            LiquidityGrowthFullRangeAutomationV1.Action.None,
            DeepKeeperExecutorV1.Outcome.AssessmentFailed,
            MockDeepAutomationV1.ForcedAssessmentFailure.selector
        );
    }

    function test_stipendOutOfGasCannotBlockLaterCandidateAndEveryCandidateHasOneExactResult() public {
        address gasBomb = makeAddr("gasBombVault");
        address healthy = makeAddr("healthyVault");
        automation.setAction(gasBomb, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        automation.setAction(healthy, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        automation.setBehavior(gasBomb, MockDeepAutomationV1.Behavior.ConsumeStipend);

        DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](2);
        candidates[0] = _candidate(gasBomb, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        candidates[1] = _candidate(healthy, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);

        vm.recordLogs();
        (bytes32 batchHash, uint256 attempted, uint256 succeeded) = executor.execute(candidates);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(attempted, 2);
        assertEq(succeeded, 1);
        assertEq(automation.performCalls(gasBomb), 0);
        assertEq(automation.performCalls(healthy), 1);
        assertEq(logs.length, 2);
        _assertResult(
            logs[0],
            batchHash,
            0,
            gasBomb,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            DeepKeeperExecutorV1.Outcome.ExecutionFailed,
            bytes4(0)
        );
        _assertResult(
            logs[1],
            batchHash,
            1,
            healthy,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            DeepKeeperExecutorV1.Outcome.Succeeded,
            bytes4(0)
        );
    }

    function test_executionReportedFailureAndReturnedActionDriftAreBoundToResults() public {
        address reportedFailure = makeAddr("reportedFailureVault");
        address returnedDrift = makeAddr("returnedDriftVault");
        automation.setAction(reportedFailure, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        automation.setAction(returnedDrift, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        automation.setBehavior(reportedFailure, MockDeepAutomationV1.Behavior.ReportFailure);
        automation.setBehavior(returnedDrift, MockDeepAutomationV1.Behavior.ReturnDifferentAction);

        DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](2);
        candidates[0] = _candidate(reportedFailure, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        candidates[1] = _candidate(returnedDrift, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);

        vm.recordLogs();
        (bytes32 batchHash, uint256 attempted, uint256 succeeded) = executor.execute(candidates);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(attempted, 2);
        assertEq(succeeded, 0);
        assertEq(logs.length, 2);
        _assertResult(
            logs[0],
            batchHash,
            0,
            reportedFailure,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            DeepKeeperExecutorV1.Outcome.ExecutionFailed,
            DeepKeeperExecutorV1.ExecutionReportedFailure.selector
        );
        _assertResult(
            logs[1],
            batchHash,
            1,
            returnedDrift,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            LiquidityGrowthFullRangeAutomationV1.Action.GrowOracle,
            DeepKeeperExecutorV1.Outcome.ExecutionFailed,
            DeepKeeperExecutorV1.ExecutionActionDrift.selector
        );
    }

    function test_executionRevertSelectorIsPreserved() public {
        address revertingVault = makeAddr("revertingVault");
        automation.setAction(revertingVault, LiquidityGrowthFullRangeAutomationV1.Action.CompoundPending);
        automation.setBehavior(revertingVault, MockDeepAutomationV1.Behavior.RevertCall);

        DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](1);
        candidates[0] = _candidate(revertingVault, LiquidityGrowthFullRangeAutomationV1.Action.CompoundPending);

        vm.recordLogs();
        (bytes32 batchHash, uint256 attempted, uint256 succeeded) = executor.execute(candidates);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(attempted, 1);
        assertEq(succeeded, 0);
        assertEq(logs.length, 1);
        _assertResult(
            logs[0],
            batchHash,
            0,
            revertingVault,
            LiquidityGrowthFullRangeAutomationV1.Action.CompoundPending,
            LiquidityGrowthFullRangeAutomationV1.Action.CompoundPending,
            DeepKeeperExecutorV1.Outcome.ExecutionFailed,
            MockDeepAutomationV1.ForcedExecutionFailure.selector
        );
    }

    function test_reentrantExecutionCannotCreateNestedCandidateResults() public {
        address reentrantVault = makeAddr("reentrantVault");
        automation.setAction(reentrantVault, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        automation.setBehavior(reentrantVault, MockDeepAutomationV1.Behavior.Reenter);
        automation.setReentryTarget(executor);

        DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](1);
        candidates[0] = _candidate(reentrantVault, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);

        vm.recordLogs();
        (bytes32 batchHash, uint256 attempted, uint256 succeeded) = executor.execute(candidates);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(attempted, 1);
        assertEq(succeeded, 0);
        assertEq(logs.length, 1);
        _assertResult(
            logs[0],
            batchHash,
            0,
            reentrantVault,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            DeepKeeperExecutorV1.Outcome.ExecutionFailed,
            ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector
        );
    }

    function test_forwardsTheExplicitStipendForEveryAction() public {
        _assertActionStipend(
            makeAddr("processVault"),
            LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees,
            executor.PROCESS_FEES_GAS_STIPEND()
        );
        _assertActionStipend(
            makeAddr("compoundVault"),
            LiquidityGrowthFullRangeAutomationV1.Action.CompoundPending,
            executor.COMPOUND_PENDING_GAS_STIPEND()
        );
        _assertActionStipend(
            makeAddr("oracleVault"),
            LiquidityGrowthFullRangeAutomationV1.Action.GrowOracle,
            executor.GROW_ORACLE_GAS_STIPEND()
        );
    }

    function test_rejectsTransactionGasBelowTheCompleteBatchEnvelope() public {
        address vault = makeAddr("gasEnvelopeVault");
        automation.setAction(vault, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);
        DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](1);
        candidates[0] = _candidate(vault, LiquidityGrowthFullRangeAutomationV1.Action.ProcessFees);

        vm.expectPartialRevert(DeepKeeperExecutorV1.InsufficientBatchGas.selector);
        executor.execute{ gas: 500_000 }(candidates);
    }

    function _assertActionStipend(address vault, LiquidityGrowthFullRangeAutomationV1.Action action, uint256 stipend)
        private
    {
        automation.setAction(vault, action);
        DeepKeeperExecutorV1.Candidate[] memory candidates = new DeepKeeperExecutorV1.Candidate[](1);
        candidates[0] = _candidate(vault, action);
        executor.execute(candidates);

        uint256 forwarded = automation.performGasAtEntry(vault);
        assertLe(forwarded, stipend);
        assertGt(forwarded, stipend - 5000);
    }

    function _assertResult(
        Vm.Log memory result,
        bytes32 batchHash,
        uint256 index,
        address vault,
        LiquidityGrowthFullRangeAutomationV1.Action expectedAction,
        LiquidityGrowthFullRangeAutomationV1.Action actualAction,
        DeepKeeperExecutorV1.Outcome outcome,
        bytes4 errorSelector
    ) private view {
        assertEq(result.emitter, address(executor));
        assertEq(result.topics.length, 4);
        assertEq(result.topics[0], CANDIDATE_RESULT_EVENT);
        assertEq(result.topics[1], batchHash);
        assertEq(result.topics[2], bytes32(index));
        assertEq(result.topics[3], bytes32(uint256(uint160(vault))));

        (
            address eventExecutor,
            uint8 eventExpectedAction,
            uint8 eventActualAction,
            uint8 eventOutcome,
            bytes4 eventErrorSelector,
            uint256 gasUsed
        ) = abi.decode(result.data, (address, uint8, uint8, uint8, bytes4, uint256));
        assertEq(eventExecutor, address(this));
        assertEq(eventExpectedAction, uint8(expectedAction));
        assertEq(eventActualAction, uint8(actualAction));
        assertEq(eventOutcome, uint8(outcome));
        assertEq(eventErrorSelector, errorSelector);
        assertGt(gasUsed, 0);
    }

    function _candidate(address vault, LiquidityGrowthFullRangeAutomationV1.Action action)
        private
        pure
        returns (DeepKeeperExecutorV1.Candidate memory)
    {
        return DeepKeeperExecutorV1.Candidate({ vault: vault, expectedAction: action });
    }
}
