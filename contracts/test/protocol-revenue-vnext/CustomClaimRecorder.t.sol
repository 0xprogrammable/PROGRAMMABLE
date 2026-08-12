// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Vm } from "forge-std/Vm.sol";

import { ProtocolRevenueClaimExecutorV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueClaimExecutorV1.sol";
import {
    ProtocolRevenueCustomClaimRecorderV1
} from "../../src/protocol-revenue-vnext/custom/ProtocolRevenueCustomClaimRecorderV1.sol";
import { CoreStandardFeeSource, CoreTestBase } from "./CoreTestBase.t.sol";

contract ProtocolRevenueCustomClaimRecorderTest is CoreTestBase {
    struct ExpectedRecordV1 {
        uint64 cycleId;
        uint256 totalClaimedWei;
        bytes32 sourceTotalsHash;
        bytes32 claimBatchCommitment;
        bytes32 sourceBindingHash;
        uint256 claimBlockNumber;
        bytes32 recordHash;
    }

    function test_recordMatchesFrozenCommonHashEventAndDirectReadPort() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        source.accrueNative{ value: 0.41 ether }();
        bytes32[] memory sourceIds = _single(sourceId);
        uint64 cycleId = _currentCycleId();
        bytes32 claimBatchCommitment = executor.computeClaimBatchCommitment(cycleId, sourceIds);
        uint256[] memory totals = new uint256[](1);
        totals[0] = 0.41 ether;
        bytes32 sourceTotalsHash = executor.computeSourceTotalsHash(sourceIds, totals);
        ExpectedRecordV1 memory expected = ExpectedRecordV1({
            cycleId: cycleId,
            totalClaimedWei: 0.41 ether,
            sourceTotalsHash: sourceTotalsHash,
            claimBatchCommitment: claimBatchCommitment,
            sourceBindingHash: claimRecorder.sourceBindingHash(),
            claimBlockNumber: block.number,
            recordHash: bytes32(0)
        });
        expected.recordHash = keccak256(
            abi.encode(
                claimRecorder.CLAIM_RECORD_TYPE_HASH(),
                block.chainid,
                expected.cycleId,
                claimRecorder.SOURCE_KIND_HASH(),
                expected.claimBlockNumber,
                expected.claimBatchCommitment,
                expected.sourceTotalsHash,
                expected.totalClaimedWei,
                expected.sourceBindingHash
            )
        );

        vm.recordLogs();
        bytes32 recordHash = _recordedClaim(sourceIds);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(recordHash, expected.recordHash);
        _assertRecorderEvent(_recorderLog(logs), expected);
        _assertStoredRecord(expected);
        assertEq(claimRecorder.recordCount(), 1);
        assertEq(claimRecorder.recordHashAt(0), recordHash);

        bytes32 cycleBatchKey = keccak256(
            abi.encode(
                claimRecorder.CYCLE_BATCH_DOMAIN(), block.chainid, expected.cycleId, expected.claimBatchCommitment
            )
        );
        assertEq(claimRecorder.recordHashForCycleBatch(cycleBatchKey), recordHash);
    }

    function test_fabricatedRecordHashHasNoStatefulMembershipOrData() public view {
        (
            bool exists,
            uint64 cycleId,
            uint256 total,
            bytes32 totalsHash,
            bytes32 batchCommitment,
            bytes32 sourceBindingHash,
            uint256 claimBlockNumber
        ) = claimRecorder.claimRecord(keccak256("fabricated-record"));
        assertFalse(exists);
        assertEq(cycleId, 0);
        assertEq(total, 0);
        assertEq(totalsHash, bytes32(0));
        assertEq(batchCommitment, bytes32(0));
        assertEq(sourceBindingHash, bytes32(0));
        assertEq(claimBlockNumber, 0);
    }

    function test_onlyExactImmutableExecutorCanWrite() public {
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueCustomClaimRecorderV1.UnauthorizedWriter.selector, address(this))
        );
        claimRecorder.recordClaim(_currentCycleId(), keccak256("totals"), 1, keccak256("batch"));
        assertEq(claimRecorder.recordCount(), 0);
    }

    function test_sameCycleAndExactBatchCannotReplay() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        source.accrueNative{ value: 0.17 ether }();
        bytes32[] memory sourceIds = _single(sourceId);
        bytes32 firstRecord = _recordedClaim(sourceIds);
        bytes32 claimBatchCommitment = executor.computeClaimBatchCommitment(_currentCycleId(), sourceIds);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueCustomClaimRecorderV1.BatchAlreadyRecorded.selector,
                _currentCycleId(),
                claimBatchCommitment,
                firstRecord
            )
        );
        _recordedClaim(sourceIds);
        assertEq(claimRecorder.recordCount(), 1);
        assertEq(REWARD_WALLET.balance, 0.17 ether);
    }

    function test_disjointBoundedBatchesCanShareCycleForUnboundedFutureSet() public {
        CoreStandardFeeSource sourceA = new CoreStandardFeeSource();
        CoreStandardFeeSource sourceB = new CoreStandardFeeSource();
        bytes32 sourceIdA = _register(address(sourceA), address(0));
        bytes32 sourceIdB = _register(address(sourceB), address(0));
        sourceA.accrueNative{ value: 0.12 ether }();
        sourceB.accrueNative{ value: 0.23 ether }();

        bytes32 firstRecord = _recordedClaim(sourceIdA);
        bytes32 secondRecord = _recordedClaim(sourceIdB);
        assertNotEq(firstRecord, secondRecord);
        assertEq(claimRecorder.recordCount(), 2);
        assertEq(_recordTotal(firstRecord), 0.12 ether);
        assertEq(_recordTotal(secondRecord), 0.23 ether);
        assertEq(REWARD_WALLET.balance, 0.35 ether);
    }

    function test_zeroTotalBatchIsExplicitlyRejectedWithoutState() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        vm.expectRevert(ProtocolRevenueCustomClaimRecorderV1.NoClaimedRevenue.selector);
        _recordedClaim(sourceId);
        assertEq(claimRecorder.recordCount(), 0);
    }

    function test_wrongCycleRollsBackClaimAndRecorderState() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        source.accrueNative{ value: 0.29 ether }();
        bytes32[] memory sourceIds = _single(sourceId);
        uint64 wrongCycle = _currentCycleId() + 1;

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueCustomClaimRecorderV1.InvalidCycle.selector, wrongCycle, _currentCycleId()
            )
        );
        executor.claimBatchAndRecord(wrongCycle, sourceIds);
        assertEq(source.accruedProgrammableFees(address(0)), 0.29 ether);
        assertEq(source.totalProgrammableFeesClaimed(address(0)), 0);
        assertEq(REWARD_WALLET.balance, 0);
        assertEq(claimRecorder.recordCount(), 0);
    }

    function test_recorderRuntimeDriftStopsBeforeAnySourceCall() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        source.accrueNative{ value: 0.31 ether }();
        vm.etch(address(claimRecorder), hex"60006000fd");

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueClaimExecutorV1.ClaimRecorderBindingMismatch.selector, bytes32("runtime")
            )
        );
        _recordedClaim(sourceId);
        assertEq(source.accruedProgrammableFees(address(0)), 0.31 ether);
        assertEq(REWARD_WALLET.balance, 0);
    }

    function test_coreRegisteredSourceWithoutCurrentFinalizedCustomAdmissionIsNeverClaimed() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        customEligibility.revoke(sourceId);
        source.accrueNative{ value: 0.37 ether }();

        vm.expectRevert(ProtocolRevenueCustomClaimRecorderV1.NoClaimedRevenue.selector);
        _recordedClaim(sourceId);
        assertEq(source.accruedProgrammableFees(address(0)), 0.37 ether);
        assertEq(source.totalProgrammableFeesClaimed(address(0)), 0);
        assertEq(REWARD_WALLET.balance, 0);
        assertEq(claimRecorder.recordCount(), 0);
    }

    function test_unrecordedExecutorEntrypointsAreClosed() public {
        bytes32[] memory sourceIds = new bytes32[](1);
        sourceIds[0] = keccak256("source");

        vm.expectRevert(ProtocolRevenueClaimExecutorV1.RecordedBatchRequired.selector);
        executor.claimSource(sourceIds[0]);
        vm.expectRevert(ProtocolRevenueClaimExecutorV1.RecordedBatchRequired.selector);
        executor.observeSource(sourceIds[0]);
        vm.expectRevert(ProtocolRevenueClaimExecutorV1.RecordedBatchRequired.selector);
        executor.claimBatch(sourceIds);
    }

    function _single(bytes32 sourceId) private pure returns (bytes32[] memory sourceIds) {
        sourceIds = new bytes32[](1);
        sourceIds[0] = sourceId;
    }

    function _assertRecorderEvent(Vm.Log memory receiptLog, ExpectedRecordV1 memory expected) private view {
        assertEq(receiptLog.emitter, address(claimRecorder));
        assertEq(receiptLog.topics.length, 3);
        assertEq(receiptLog.topics[0], keccak256("ClaimOnlyClaimRecordedV1(uint64,bytes32,bytes32,uint256,bytes32)"));
        assertEq(receiptLog.topics[1], bytes32(uint256(expected.cycleId)));
        assertEq(receiptLog.topics[2], expected.recordHash);
        (bytes32 totalsHash, uint256 total, bytes32 batchCommitment) =
            abi.decode(receiptLog.data, (bytes32, uint256, bytes32));
        assertEq(totalsHash, expected.sourceTotalsHash);
        assertEq(total, expected.totalClaimedWei);
        assertEq(batchCommitment, expected.claimBatchCommitment);
    }

    function _assertStoredRecord(ExpectedRecordV1 memory expected) private view {
        (
            bool exists,
            uint64 cycleId,
            uint256 total,
            bytes32 totalsHash,
            bytes32 batchCommitment,
            bytes32 sourceBindingHash,
            uint256 claimBlockNumber
        ) = claimRecorder.claimRecord(expected.recordHash);
        assertTrue(exists);
        assertEq(cycleId, expected.cycleId);
        assertEq(total, expected.totalClaimedWei);
        assertEq(totalsHash, expected.sourceTotalsHash);
        assertEq(batchCommitment, expected.claimBatchCommitment);
        assertEq(sourceBindingHash, expected.sourceBindingHash);
        assertEq(claimBlockNumber, expected.claimBlockNumber);
    }

    function _recorderLog(Vm.Log[] memory logs) private view returns (Vm.Log memory receiptLog) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(claimRecorder)) return logs[i];
        }
        assertTrue(false, "recorder event missing");
    }
}
