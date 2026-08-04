// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

interface IProtocolRevenuePermissionlessHookV2 {
    function launcherFeeRecipient() external view returns (address);

    function launcherFeesAccrued() external view returns (uint256);

    function claimLauncherFees() external returns (uint256 amount);
}

/// @title ProtocolRevenueClaimCoordinatorV2
/// @notice Batches the permissionless Classic V1 and V2 protocol-fee claims into one keeper transaction.
/// @dev The hooks always pay their immutable fee recipient. This contract never receives or redirects revenue and
///      exposes no owner, recovery, arbitrary-call, upgrade or configuration surface.
contract ProtocolRevenueClaimCoordinatorV2 is ReentrancyGuardTransient {
    uint64 public constant CLAIM_INTERVAL = 1 days;
    uint256 public constant MIN_ACCRUED_REVENUE = 0.001 ether;

    address public constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant CLASSIC_V1_HOOK = 0x48bB2672c7fd2a12e7fb5D46c441ccD3726520Cc;
    address public constant CLASSIC_V2_HOOK = 0x025a386eAa79f6067d29848FD05ccC71bEAb20CC;

    bytes32 private constant CLASSIC_V1_HOOK_CODE_HASH =
        0x60fd96af952730792036d43d806046675817a5a2de609d87c06203a8d6037650;
    bytes32 private constant CLASSIC_V2_HOOK_CODE_HASH =
        0x274e29fb8d19f0607533ac7582827db0236ab546bb393d52049229b2ffe74381;

    address public immutable keeper;
    uint64 public lastClaimedAt;
    uint256 public claimCount;
    uint256 public totalClaimed;

    error ClaimAccountingMismatch(uint256 returnedAmount, uint256 receivedAmount);
    error CodeHashMismatch(address target, bytes32 expected, bytes32 actual);
    error CooldownActive(uint256 nextClaimAt);
    error InsufficientAccruedRevenue(uint256 actual, uint256 minimum);
    error InvalidHookBinding(address hook);
    error InvalidKeeper(address keeper);
    error OnlyKeeper(address caller);

    event RevenueClaimed(
        uint256 indexed claimNumber,
        uint256 classicV1Amount,
        uint256 classicV2Amount,
        uint256 totalAmount,
        address indexed recipient
    );

    constructor(address keeper_) {
        if (block.chainid != 1) revert InvalidHookBinding(address(0));
        if (keeper_ == address(0) || keeper_ == REVENUE_AUTHORITY) revert InvalidKeeper(keeper_);
        keeper = keeper_;
        _assertHook(CLASSIC_V1_HOOK, CLASSIC_V1_HOOK_CODE_HASH);
        _assertHook(CLASSIC_V2_HOOK, CLASSIC_V2_HOOK_CODE_HASH);
    }

    /// @notice Claims all currently accrued Classic V1 and V2 launcher fees to the immutable revenue wallet.
    function claim() external nonReentrant returns (uint256 totalAmount) {
        if (msg.sender != keeper) revert OnlyKeeper(msg.sender);
        uint256 eligibleAt = uint256(lastClaimedAt) + CLAIM_INTERVAL;
        // A daily cadence is insensitive to a validator's seconds of timestamp discretion.
        // forge-lint: disable-next-line(block-timestamp)
        if (lastClaimedAt != 0 && block.timestamp < eligibleAt) revert CooldownActive(eligibleAt);

        IProtocolRevenuePermissionlessHookV2 classicV1 = IProtocolRevenuePermissionlessHookV2(CLASSIC_V1_HOOK);
        IProtocolRevenuePermissionlessHookV2 classicV2 = IProtocolRevenuePermissionlessHookV2(CLASSIC_V2_HOOK);
        uint256 classicV1Accrued = classicV1.launcherFeesAccrued();
        uint256 classicV2Accrued = classicV2.launcherFeesAccrued();
        uint256 totalAccrued = classicV1Accrued + classicV2Accrued;
        if (totalAccrued < MIN_ACCRUED_REVENUE) {
            revert InsufficientAccruedRevenue(totalAccrued, MIN_ACCRUED_REVENUE);
        }

        uint256 recipientBalanceBefore = REVENUE_AUTHORITY.balance;
        uint256 classicV1Amount = classicV1Accrued == 0 ? 0 : classicV1.claimLauncherFees();
        uint256 classicV2Amount = classicV2Accrued == 0 ? 0 : classicV2.claimLauncherFees();
        totalAmount = classicV1Amount + classicV2Amount;
        uint256 receivedAmount = REVENUE_AUTHORITY.balance - recipientBalanceBefore;
        if (totalAmount != receivedAmount) revert ClaimAccountingMismatch(totalAmount, receivedAmount);

        // Mainnet timestamps fit in uint64 for the lifetime of this immutable deployment.
        // forge-lint: disable-next-line(unsafe-typecast)
        // forge-lint: disable-next-line(block-timestamp)
        lastClaimedAt = uint64(block.timestamp);
        unchecked {
            ++claimCount;
        }
        totalClaimed += totalAmount;
        emit RevenueClaimed(claimCount, classicV1Amount, classicV2Amount, totalAmount, REVENUE_AUTHORITY);
    }

    function accruedRevenue() public view returns (uint256) {
        return IProtocolRevenuePermissionlessHookV2(CLASSIC_V1_HOOK).launcherFeesAccrued()
            + IProtocolRevenuePermissionlessHookV2(CLASSIC_V2_HOOK).launcherFeesAccrued();
    }

    function ready() external view returns (bool) {
        // A daily cadence is insensitive to a validator's seconds of timestamp discretion.
        // forge-lint: disable-next-line(block-timestamp)
        if (lastClaimedAt != 0 && block.timestamp < uint256(lastClaimedAt) + CLAIM_INTERVAL) return false;
        return accruedRevenue() >= MIN_ACCRUED_REVENUE;
    }

    function nextClaimAt() external view returns (uint256) {
        if (lastClaimedAt == 0) return block.timestamp;
        return uint256(lastClaimedAt) + CLAIM_INTERVAL;
    }

    function _assertHook(address hook, bytes32 expectedCodeHash) private view {
        bytes32 actualCodeHash = hook.codehash;
        if (actualCodeHash != expectedCodeHash) revert CodeHashMismatch(hook, expectedCodeHash, actualCodeHash);
        if (IProtocolRevenuePermissionlessHookV2(hook).launcherFeeRecipient() != REVENUE_AUTHORITY) {
            revert InvalidHookBinding(hook);
        }
    }
}
