// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

abstract contract AsyncBatchFeeAdapter {
    address internal constant PROGRAMMABLE_FEE_OWNER = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint256 internal constant VOLUME_PER_FEE_UNIT = 1_000;

    struct ScopeAccounting {
        uint256 cumulativeGrossVolume;
        uint256 cumulativePlatformLiability;
    }

    struct Batch {
        uint256 grossVolume;
        uint256 platformLiability;
        bool initialized;
        bool settled;
    }

    mapping(bytes32 scopeId => ScopeAccounting) internal scopeAccounting;
    mapping(bytes32 scopeId => mapping(bytes32 batchId => Batch)) internal batches;
    mapping(bytes32 scopeId => mapping(bytes32 fillId => bool)) internal processedFills;

    error BatchAlreadySettled(bytes32 scopeId, bytes32 batchId);
    error FillAlreadyRecorded(bytes32 scopeId, bytes32 fillId);
    error InvalidIdentifier();
    error UnknownBatch(bytes32 scopeId, bytes32 batchId);
    error ZeroGrossVolume();

    function _recordFill(bytes32 scopeId, bytes32 batchId, bytes32 fillId, uint256 grossVolume)
        internal
        returns (uint256 newlyAccrued)
    {
        if (scopeId == bytes32(0) || batchId == bytes32(0) || fillId == bytes32(0)) revert InvalidIdentifier();
        if (grossVolume == 0) revert ZeroGrossVolume();
        Batch storage batch = batches[scopeId][batchId];
        if (batch.settled) revert BatchAlreadySettled(scopeId, batchId);
        if (processedFills[scopeId][fillId]) revert FillAlreadyRecorded(scopeId, fillId);

        ScopeAccounting storage accounting = scopeAccounting[scopeId];
        uint256 nextVolume = accounting.cumulativeGrossVolume + grossVolume;
        uint256 nextLiability = nextVolume / VOLUME_PER_FEE_UNIT;
        newlyAccrued = nextLiability - accounting.cumulativePlatformLiability;
        accounting.cumulativeGrossVolume = nextVolume;
        accounting.cumulativePlatformLiability = nextLiability;

        batch.grossVolume += grossVolume;
        batch.platformLiability += newlyAccrued;
        batch.initialized = true;
        processedFills[scopeId][fillId] = true;
    }

    function _markSettled(bytes32 scopeId, bytes32 batchId) internal returns (uint256 platformLiability) {
        Batch storage batch = batches[scopeId][batchId];
        if (!batch.initialized) revert UnknownBatch(scopeId, batchId);
        if (batch.settled) revert BatchAlreadySettled(scopeId, batchId);
        batch.settled = true;
        return batch.platformLiability;
    }

    function _scopeTotals(bytes32 scopeId)
        internal
        view
        returns (uint256 cumulativeGrossVolume, uint256 cumulativePlatformLiability)
    {
        ScopeAccounting storage accounting = scopeAccounting[scopeId];
        return (accounting.cumulativeGrossVolume, accounting.cumulativePlatformLiability);
    }

    function _batchState(bytes32 scopeId, bytes32 batchId) internal view returns (Batch memory) {
        return batches[scopeId][batchId];
    }
}
