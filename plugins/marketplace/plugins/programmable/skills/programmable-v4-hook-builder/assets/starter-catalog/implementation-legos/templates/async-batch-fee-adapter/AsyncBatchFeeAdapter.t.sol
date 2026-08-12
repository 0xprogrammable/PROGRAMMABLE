// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AsyncBatchFeeAdapter} from "../src/AsyncBatchFeeAdapter.sol";

contract AsyncBatchFeeAdapterHarness is AsyncBatchFeeAdapter {
    function recordFill(bytes32 scopeId, bytes32 batchId, bytes32 fillId, uint256 grossVolume)
        external
        returns (uint256)
    {
        return _recordFill(scopeId, batchId, fillId, grossVolume);
    }

    function settleBatch(bytes32 scopeId, bytes32 batchId) external returns (uint256) {
        return _markSettled(scopeId, batchId);
    }

    function scopeTotals(bytes32 scopeId) external view returns (uint256, uint256) {
        return _scopeTotals(scopeId);
    }

    function batchState(bytes32 scopeId, bytes32 batchId)
        external
        view
        returns (uint256 grossVolume, uint256 platformLiability, bool initialized, bool settled)
    {
        Batch memory batch = _batchState(scopeId, batchId);
        return (batch.grossVolume, batch.platformLiability, batch.initialized, batch.settled);
    }
}

contract AsyncBatchFeeAdapterTest {
    bytes32 private constant SCOPE = keccak256("canonical-scope");
    bytes32 private constant BATCH_A = keccak256("batch-a");
    bytes32 private constant BATCH_B = keccak256("batch-b");
    bytes32 private constant FILL_A = keccak256("fill-a");
    bytes32 private constant FILL_B = keccak256("fill-b");

    function testRemainderContinuesAcrossBatchRotation() external {
        AsyncBatchFeeAdapterHarness harness = new AsyncBatchFeeAdapterHarness();
        require(harness.recordFill(SCOPE, BATCH_A, FILL_A, 999) == 0, "premature liability");
        require(harness.settleBatch(SCOPE, BATCH_A) == 0, "unexpected first-batch liability");
        require(harness.recordFill(SCOPE, BATCH_B, FILL_B, 1) == 1, "batch rotation reset remainder");

        (uint256 grossVolume, uint256 liability) = harness.scopeTotals(SCOPE);
        require(grossVolume == 1_000, "scope volume mismatch");
        require(liability == 1, "scope liability mismatch");
        (, uint256 batchLiability, bool initialized, bool settled) = harness.batchState(SCOPE, BATCH_B);
        require(batchLiability == 1 && initialized && !settled, "second batch state mismatch");
    }

    function testFillReplayFailsAcrossBatchesInOneScope() external {
        AsyncBatchFeeAdapterHarness harness = new AsyncBatchFeeAdapterHarness();
        harness.recordFill(SCOPE, BATCH_A, FILL_A, 1_000);
        try harness.recordFill(SCOPE, BATCH_B, FILL_A, 1_000) {
            revert("fill replay unexpectedly succeeded");
        } catch (bytes memory reason) {
            require(_selector(reason) == AsyncBatchFeeAdapter.FillAlreadyRecorded.selector, "wrong replay error");
        }
    }

    function testUnknownBatchCannotBeSettled() external {
        AsyncBatchFeeAdapterHarness harness = new AsyncBatchFeeAdapterHarness();
        try harness.settleBatch(SCOPE, BATCH_A) {
            revert("unknown batch settlement unexpectedly succeeded");
        } catch (bytes memory reason) {
            require(_selector(reason) == AsyncBatchFeeAdapter.UnknownBatch.selector, "wrong unknown-batch error");
        }
    }

    function _selector(bytes memory reason) private pure returns (bytes4 result) {
        if (reason.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            result := mload(add(reason, 0x20))
        }
    }
}
