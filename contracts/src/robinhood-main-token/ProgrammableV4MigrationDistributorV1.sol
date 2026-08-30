// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title Programmable V4 migration distributor V1
/// @notice Holds the complete Robinhood V4 supply before the source window and distributes the sealed 1:1 snapshot.
/// @dev The seal authority can set the snapshot commitment exactly once. It has no later administrative power.
contract ProgrammableV4MigrationDistributorV1 {
    using SafeERC20 for IERC20;

    uint256 public constant TARGET_CHAIN_ID = 4663;
    uint256 public constant TOKEN_TOTAL_SUPPLY_RAW = 1_000_000_000 ether;
    uint256 public constant MAX_BATCH_SIZE = 64;

    bytes32 public constant ALLOCATION_TYPEHASH = keccak256(
        "ProgrammableV4MigrationAllocationV1(uint256 targetChainId,bytes32 releaseIdHash,uint256 sourceChainId,address sourceToken,uint256 sourceDeadlineTimestampExclusive,bytes32 snapshotRuleHash,bytes32 sourceSnapshotSha256,uint256 index,address account,uint256 amountRaw)"
    );

    IERC20 public immutable TOKEN;
    bytes32 public immutable RELEASE_ID_HASH;
    uint256 public immutable SOURCE_CHAIN_ID;
    address public immutable SOURCE_TOKEN;
    uint256 public immutable SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE;
    bytes32 public immutable SNAPSHOT_RULE_HASH;
    address public immutable SEAL_AUTHORITY;
    address public immutable REMAINDER_RECIPIENT;

    bool public isSealed;
    bytes32 public merkleRoot;
    bytes32 public sourceSnapshotSha256;
    uint256 public migrationTotalRaw;
    uint256 public totalDistributedRaw;

    mapping(uint256 wordIndex => uint256 word) private _distributedBitMap;

    struct Allocation {
        uint256 index;
        address account;
        uint256 amountRaw;
        bytes32[] proof;
    }

    error AlreadyDistributed(uint256 index);
    error AlreadySealed();
    error BatchSizeOutsideBounds(uint256 actual, uint256 maximum);
    error DistributionBalanceInvariant(uint256 expected, uint256 actual);
    error DistributionNotSealed();
    error InvalidAccount(address account);
    error InvalidAmount(uint256 amountRaw);
    error InvalidChain(uint256 actual, uint256 expected);
    error InvalidCommitment(bytes32 commitment);
    error InvalidProof(uint256 index, address account, uint256 amountRaw);
    error InvalidSource(uint256 sourceChainId, address sourceToken);
    error InvalidSourceDeadline(uint256 deadline, uint256 deploymentTimestamp);
    error InvalidTargetToken(address token);
    error InvalidTokenBinding(address expected, address actual);
    error InvalidTokenSupply(uint256 actual, uint256 expected);
    error InvalidTotal(uint256 migrationTotalRaw);
    error SealBeforeSourceDeadline(uint256 timestamp, uint256 deadline);
    error UnauthorizedSeal(address caller);

    event AllocationDistributed(uint256 indexed index, address indexed account, uint256 amountRaw);
    event DistributionSealed(
        bytes32 indexed merkleRoot,
        bytes32 indexed sourceSnapshotSha256,
        uint256 migrationTotalRaw,
        uint256 remainderRaw,
        address indexed remainderRecipient
    );

    constructor(
        IERC20 token,
        bytes32 releaseIdHash,
        uint256 sourceChainId,
        address sourceToken,
        uint256 sourceDeadlineTimestampExclusive,
        bytes32 snapshotRuleHash,
        address sealAuthority,
        address remainderRecipient
    ) {
        if (block.chainid != TARGET_CHAIN_ID) {
            revert InvalidChain(block.chainid, TARGET_CHAIN_ID);
        }
        if (address(token) == address(0)) revert InvalidTargetToken(address(token));
        if (releaseIdHash == bytes32(0)) revert InvalidCommitment(releaseIdHash);
        if (sourceChainId == 0 || sourceToken == address(0)) revert InvalidSource(sourceChainId, sourceToken);
        if (sourceDeadlineTimestampExclusive <= block.timestamp) {
            revert InvalidSourceDeadline(sourceDeadlineTimestampExclusive, block.timestamp);
        }
        if (snapshotRuleHash == bytes32(0)) revert InvalidCommitment(snapshotRuleHash);
        if (sealAuthority == address(0)) revert UnauthorizedSeal(address(0));
        if (
            remainderRecipient == address(0) || remainderRecipient == address(this)
                || remainderRecipient == address(token)
        ) {
            revert InvalidAccount(remainderRecipient);
        }

        TOKEN = token;
        RELEASE_ID_HASH = releaseIdHash;
        SOURCE_CHAIN_ID = sourceChainId;
        SOURCE_TOKEN = sourceToken;
        SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE = sourceDeadlineTimestampExclusive;
        SNAPSHOT_RULE_HASH = snapshotRuleHash;
        SEAL_AUTHORITY = sealAuthority;
        REMAINDER_RECIPIENT = remainderRecipient;
    }

    /// @notice Permanently binds the finalized source snapshot and releases only the non-migration remainder.
    function seal(bytes32 root, bytes32 snapshotSha256, uint256 totalRaw) external {
        if (msg.sender != SEAL_AUTHORITY) revert UnauthorizedSeal(msg.sender);
        if (isSealed) revert AlreadySealed();
        if (block.timestamp < SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE) {
            revert SealBeforeSourceDeadline(block.timestamp, SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE);
        }
        if (root == bytes32(0)) revert InvalidCommitment(root);
        if (snapshotSha256 == bytes32(0)) revert InvalidCommitment(snapshotSha256);
        if (totalRaw == 0 || totalRaw > TOKEN_TOTAL_SUPPLY_RAW) revert InvalidTotal(totalRaw);

        IERC20 token = TOKEN;
        if (address(token).code.length == 0) revert InvalidTargetToken(address(token));
        uint256 actualSupply = token.totalSupply();
        if (actualSupply != TOKEN_TOTAL_SUPPLY_RAW) {
            revert InvalidTokenSupply(actualSupply, TOKEN_TOTAL_SUPPLY_RAW);
        }
        uint8 actualDecimals = IERC20Metadata(address(token)).decimals();
        if (actualDecimals != 18) revert InvalidTokenSupply(actualDecimals, 18);
        address actualDistributor = IProgrammableV4TokenBinding(address(token)).MIGRATION_DISTRIBUTOR();
        if (actualDistributor != address(this)) revert InvalidTokenBinding(address(this), actualDistributor);
        uint256 startingBalance = token.balanceOf(address(this));
        if (startingBalance != TOKEN_TOTAL_SUPPLY_RAW) {
            revert DistributionBalanceInvariant(TOKEN_TOTAL_SUPPLY_RAW, startingBalance);
        }

        isSealed = true;
        merkleRoot = root;
        sourceSnapshotSha256 = snapshotSha256;
        migrationTotalRaw = totalRaw;

        uint256 remainderRaw = TOKEN_TOTAL_SUPPLY_RAW - totalRaw;
        if (remainderRaw != 0) {
            uint256 recipientBefore = token.balanceOf(REMAINDER_RECIPIENT);
            token.safeTransfer(REMAINDER_RECIPIENT, remainderRaw);
            uint256 recipientAfter = token.balanceOf(REMAINDER_RECIPIENT);
            if (recipientAfter != recipientBefore + remainderRaw) {
                revert DistributionBalanceInvariant(recipientBefore + remainderRaw, recipientAfter);
            }
        }
        uint256 endingBalance = token.balanceOf(address(this));
        if (endingBalance != totalRaw) revert DistributionBalanceInvariant(totalRaw, endingBalance);

        emit DistributionSealed(root, snapshotSha256, totalRaw, remainderRaw, REMAINDER_RECIPIENT);
    }

    /// @notice Permissionlessly distributes one allocation to the exact address committed in the snapshot.
    function distribute(uint256 index, address account, uint256 amountRaw, bytes32[] calldata proof) external {
        _distribute(index, account, amountRaw, proof);
    }

    /// @notice Permissionlessly distributes a bounded atomic batch to the exact committed recipients.
    function distributeBatch(Allocation[] calldata allocations) external {
        uint256 length = allocations.length;
        if (length == 0 || length > MAX_BATCH_SIZE) revert BatchSizeOutsideBounds(length, MAX_BATCH_SIZE);
        for (uint256 offset; offset < length; ++offset) {
            Allocation calldata allocation = allocations[offset];
            _distribute(allocation.index, allocation.account, allocation.amountRaw, allocation.proof);
        }
    }

    function isDistributed(uint256 index) public view returns (bool) {
        uint256 wordIndex = index >> 8;
        uint256 bitIndex = index & 255;
        return (_distributedBitMap[wordIndex] & (1 << bitIndex)) != 0;
    }

    function allocationLeaf(uint256 index, address account, uint256 amountRaw) public view returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        ALLOCATION_TYPEHASH,
                        TARGET_CHAIN_ID,
                        RELEASE_ID_HASH,
                        SOURCE_CHAIN_ID,
                        SOURCE_TOKEN,
                        SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE,
                        SNAPSHOT_RULE_HASH,
                        sourceSnapshotSha256,
                        index,
                        account,
                        amountRaw
                    )
                )
            )
        );
    }

    function remainingMigrationRaw() external view returns (uint256) {
        return migrationTotalRaw - totalDistributedRaw;
    }

    function _distribute(uint256 index, address account, uint256 amountRaw, bytes32[] calldata proof) private {
        if (!isSealed) revert DistributionNotSealed();
        if (account == address(0) || account == address(this)) revert InvalidAccount(account);
        if (amountRaw == 0) revert InvalidAmount(amountRaw);
        if (isDistributed(index)) revert AlreadyDistributed(index);
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, allocationLeaf(index, account, amountRaw))) {
            revert InvalidProof(index, account, amountRaw);
        }

        uint256 updatedTotal = totalDistributedRaw + amountRaw;
        if (updatedTotal > migrationTotalRaw) revert InvalidAmount(amountRaw);
        _setDistributed(index);
        totalDistributedRaw = updatedTotal;

        IERC20 token = TOKEN;
        uint256 recipientBefore = token.balanceOf(account);
        uint256 distributorBefore = token.balanceOf(address(this));
        token.safeTransfer(account, amountRaw);
        uint256 recipientAfter = token.balanceOf(account);
        if (recipientAfter != recipientBefore + amountRaw) {
            revert DistributionBalanceInvariant(recipientBefore + amountRaw, recipientAfter);
        }
        uint256 expectedDistributorBalance = migrationTotalRaw - updatedTotal;
        uint256 actualDistributorBalance = token.balanceOf(address(this));
        if (
            distributorBefore < amountRaw || actualDistributorBalance != distributorBefore - amountRaw
                || actualDistributorBalance < expectedDistributorBalance
        ) {
            revert DistributionBalanceInvariant(expectedDistributorBalance, actualDistributorBalance);
        }

        emit AllocationDistributed(index, account, amountRaw);
    }

    function _setDistributed(uint256 index) private {
        uint256 wordIndex = index >> 8;
        uint256 bitIndex = index & 255;
        _distributedBitMap[wordIndex] |= 1 << bitIndex;
    }
}

interface IProgrammableV4TokenBinding {
    function MIGRATION_DISTRIBUTOR() external view returns (address);
}
