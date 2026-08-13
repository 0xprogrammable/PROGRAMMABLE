// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

interface IProtocolRevenueCustomClaimRecorderV1 {
    function CHAIN_ID() external view returns (uint256);
    function AUTHORIZED_EXECUTOR() external view returns (address);
    function ACTIVATION_ID() external view returns (bytes32);

    function sourceBindingHash() external view returns (bytes32);

    function recordClaim(
        uint64 cycleId,
        bytes32 sourceTotalsHash,
        uint256 totalClaimedWei,
        bytes32 claimBatchCommitment
    ) external returns (bytes32 recordHash);

    function claimRecord(bytes32 recordHash)
        external
        view
        returns (
            bool exists,
            uint64 cycleId,
            uint256 totalClaimedWei,
            bytes32 sourceTotalsHash,
            bytes32 claimBatchCommitment,
            bytes32 sourceBindingHash_,
            uint256 claimBlockNumber
        );
}

/// @title ProtocolRevenueCustomClaimRecorderV1
/// @notice Immutable, stateful receipt port for exact Custom native-fee claim batches.
/// @dev The recorder has no admin, proxy, arbitrary writer, claim, transfer, split, swap or recovery surface. The
///      separately deployed exact ClaimExecutor is its sole writer. Zero-total batches are rejected so a permissionless
///      caller cannot preempt a later positive batch or fill the settlement queue with empty receipts. Multiple
///      disjoint bounded batches may be recorded in the same UTC cycle, so the future source set is not capped at one
///      executor transaction.
contract ProtocolRevenueCustomClaimRecorderV1 is IProtocolRevenueCustomClaimRecorderV1 {
    using SafeCast for uint256;

    uint256 public constant override CHAIN_ID = 1;
    bytes32 public constant SOURCE_KIND_HASH = keccak256("custom");
    bytes32 public constant CLAIM_RECORD_TYPE_HASH = keccak256(
        "ClaimOnlyClaimRecordV1(uint256 chainId,uint64 cycleId,bytes32 sourceKindHash,uint256 claimBlockNumber,bytes32 claimBatchCommitment,bytes32 sourceTotalsHash,uint256 totalClaimedWei,bytes32 sourceBindingHash)"
    );
    bytes32 public constant CYCLE_BATCH_DOMAIN = keccak256("programmable.custom-claim.cycle-batch.v1");

    address public immutable override AUTHORIZED_EXECUTOR;
    bytes32 public immutable override ACTIVATION_ID;

    struct StoredClaimRecordV1 {
        uint64 cycleId;
        uint256 totalClaimedWei;
        bytes32 sourceTotalsHash;
        bytes32 claimBatchCommitment;
        bytes32 sourceBindingHash;
        uint256 claimBlockNumber;
        bool exists;
    }

    mapping(bytes32 recordHash => StoredClaimRecordV1 record) private _records;
    mapping(bytes32 cycleBatchKey => bytes32 recordHash) public recordHashForCycleBatch;
    bytes32[] private _recordHashes;

    error BatchAlreadyRecorded(uint64 cycleId, bytes32 claimBatchCommitment, bytes32 recordHash);
    error InvalidBinding(bytes32 field);
    error InvalidCycle(uint64 supplied, uint64 current);
    error NoClaimedRevenue();
    error RecordAlreadyExists(bytes32 recordHash);
    error UnauthorizedWriter(address caller);
    error UnsupportedChain(uint256 supplied, uint256 expected);

    event ClaimOnlyClaimRecordedV1(
        uint64 indexed cycleId,
        bytes32 indexed recordHash,
        bytes32 sourceTotalsHash,
        uint256 totalClaimedWei,
        bytes32 claimBatchCommitment
    );

    constructor(address authorizedExecutor, bytes32 activationId) {
        if (block.chainid != CHAIN_ID) revert UnsupportedChain(block.chainid, CHAIN_ID);
        if (authorizedExecutor == address(0)) revert InvalidBinding("authorized-executor");
        if (activationId == bytes32(0)) revert InvalidBinding("activation-id");
        AUTHORIZED_EXECUTOR = authorizedExecutor;
        ACTIVATION_ID = activationId;
    }

    function sourceBindingHash() public view returns (bytes32) {
        return keccak256(abi.encode(address(this), address(this).codehash, ACTIVATION_ID));
    }

    function recordClaim(
        uint64 cycleId,
        bytes32 sourceTotalsHash,
        uint256 totalClaimedWei,
        bytes32 claimBatchCommitment
    ) external returns (bytes32 recordHash) {
        if (msg.sender != AUTHORIZED_EXECUTOR) revert UnauthorizedWriter(msg.sender);
        if (sourceTotalsHash == bytes32(0)) revert InvalidBinding("source-totals");
        if (claimBatchCommitment == bytes32(0)) revert InvalidBinding("claim-batch");

        uint64 currentCycle = (block.timestamp / 1 days).toUint64();
        if (cycleId != currentCycle) revert InvalidCycle(cycleId, currentCycle);
        bytes32 cycleBatchKey = keccak256(abi.encode(CYCLE_BATCH_DOMAIN, CHAIN_ID, cycleId, claimBatchCommitment));
        bytes32 existingRecord = recordHashForCycleBatch[cycleBatchKey];
        if (existingRecord != bytes32(0)) {
            revert BatchAlreadyRecorded(cycleId, claimBatchCommitment, existingRecord);
        }
        if (totalClaimedWei == 0) revert NoClaimedRevenue();

        uint256 claimBlockNumber = block.number;
        bytes32 bindingHash = sourceBindingHash();
        recordHash = keccak256(
            abi.encode(
                CLAIM_RECORD_TYPE_HASH,
                CHAIN_ID,
                cycleId,
                SOURCE_KIND_HASH,
                claimBlockNumber,
                claimBatchCommitment,
                sourceTotalsHash,
                totalClaimedWei,
                bindingHash
            )
        );
        if (_records[recordHash].exists) revert RecordAlreadyExists(recordHash);

        _records[recordHash] = StoredClaimRecordV1({
            cycleId: cycleId,
            totalClaimedWei: totalClaimedWei,
            sourceTotalsHash: sourceTotalsHash,
            claimBatchCommitment: claimBatchCommitment,
            sourceBindingHash: bindingHash,
            claimBlockNumber: claimBlockNumber,
            exists: true
        });
        recordHashForCycleBatch[cycleBatchKey] = recordHash;
        _recordHashes.push(recordHash);

        emit ClaimOnlyClaimRecordedV1(cycleId, recordHash, sourceTotalsHash, totalClaimedWei, claimBatchCommitment);
    }

    function claimRecord(bytes32 recordHash)
        external
        view
        returns (
            bool exists,
            uint64 cycleId,
            uint256 totalClaimedWei,
            bytes32 sourceTotalsHash,
            bytes32 claimBatchCommitment,
            bytes32 sourceBindingHash_,
            uint256 claimBlockNumber
        )
    {
        StoredClaimRecordV1 storage record = _records[recordHash];
        return (
            record.exists,
            record.cycleId,
            record.totalClaimedWei,
            record.sourceTotalsHash,
            record.claimBatchCommitment,
            record.sourceBindingHash,
            record.claimBlockNumber
        );
    }

    function recordCount() external view returns (uint256) {
        return _recordHashes.length;
    }

    function recordHashAt(uint256 index) external view returns (bytes32) {
        return _recordHashes[index];
    }
}
